import { types } from 'node:util';

/** Reader for GSPro's `currentRound.dat`. The file is untrusted input: check what we rely on, refuse the rest. */

export const MAX_TEXT_CHARS = 50_000_000;
export const MAX_RECORDS = 20_000;
/** A record is level 1; anything nested deeper than this is refused. */
export const MAX_DEPTH = 32;

/** Thrown when the text is not a layout this reader knows. It never guesses. */
export class UnknownLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownLayoutError';
  }
}

/** The fields the scorer relies on. Every other field is kept untouched and never interpreted. */
export interface ShotRecord {
  ShotID: string;
  UserGuid: string;
  PlayerName: string;
  CourseKey: string;
  RoundID: number;
  Hole: number;
  HoleShot: number;
  HolePar: number;
  HoleResult: number;
  ShotResult: number;
  [other: string]: unknown;
}

// Longest text allowed per field, in characters.
const TEXT_LIMITS: Record<string, number> = { ShotID: 128, UserGuid: 128, PlayerName: 256, CourseKey: 256 };
const STRING_FIELDS = ['ShotID', 'UserGuid', 'PlayerName', 'CourseKey'] as const;
const INTEGER_FIELDS = ['RoundID', 'Hole', 'HoleShot', 'HolePar', 'HoleResult', 'ShotResult'] as const;
// Beyond being safe integers, these two must sit in a plausible range. Refuse, never clamp.
// RoundID has no limit here: it may be negative (the practice range).
const INTEGER_LIMITS: Partial<Record<string, readonly [number, number]>> = { Hole: [0, 99], HoleShot: [1, 999] };
// Checked in this order, so "the first missing or mistyped field" is well defined.
const CHECK_ORDER = [
  'ShotID',
  'UserGuid',
  'PlayerName',
  'CourseKey',
  'RoundID',
  'Hole',
  'HoleShot',
  'HolePar',
  'HoleResult',
  'ShotResult',
] as const;

/** The longest array a record may hold, and the most values (every entry of every array and object) in one record. */
export const MAX_ARRAY_LENGTH = 100_000;
export const MAX_VALUES = 250_000;

/**
 * Whether the walk may look inside an object. The tests run in this order and none of them runs any code of
 * the caller's: not a proxy (every proxy is refused, whatever it wraps); not a view of a buffer, not a buffer,
 * not a boxed primitive, not a module namespace object (these look at what the value really is, so a swapped
 * prototype does not fool them); then a true array (prototype exactly Array.prototype) or an object whose
 * prototype is exactly Object.prototype or null. Everything JSON.parse returns passes.
 */
function mayLookInside(v: object): boolean {
  if (types.isProxy(v)) return false;
  if (ArrayBuffer.isView(v) || types.isAnyArrayBuffer(v) || types.isBoxedPrimitive(v) || types.isModuleNamespaceObject(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return Array.isArray(v) ? proto === Array.prototype : proto === Object.prototype || proto === null;
}

/** An own data property's value, read once through its descriptor; a getter or a setter is refused (nothing is called). */
function dataValue(owner: object, key: string, where: string): unknown {
  const d = Object.getOwnPropertyDescriptor(owner, key);
  if (d === undefined) throw new UnknownLayoutError(`${where} holds an array with holes`);
  if (d.get !== undefined || d.set !== undefined) throw new UnknownLayoutError(`${where} holds a property that is a getter or a setter`);
  return d.value;
}

interface Job {
  src: object;
  /** The plain container being filled, or undefined when only checking. */
  dst: unknown[] | Record<string, unknown> | undefined;
  depth: number;
}

function define(dst: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(dst, key, { value, enumerable: true, writable: true, configurable: true });
  else dst[key] = value;
}

/**
 * One pass over a value: checks it and, when `build` is true, builds the plain copy as it goes. Nothing of the
 * caller's is called and each value is read once. Rules: a null, string, boolean or number is copied as JSON
 * writes it (a number that is not finite becomes null, minus zero becomes zero); a bigint is refused; a
 * function, a symbol or undefined is left out of an object and becomes null in an array. An object is looked
 * inside only if `mayLookInside`. A true array: its length is read, refused over MAX_ARRAY_LENGTH and counted
 * against MAX_VALUES before any entry is touched; it may carry no own enumerable key that is not an index; each
 * entry is read through its own descriptor (a hole, a getter or a setter is refused). A plain object: its own
 * enumerable string keys are counted against MAX_VALUES, then each is read through its own descriptor (a getter
 * or a setter is refused); symbol keys and non-enumerable keys are ignored; a property named toJSON is like
 * any other. Also refused: more than MAX_DEPTH levels (the value itself is level 1) and an object reached a
 * second time in one record (`seen`). Own stack, no recursion. Refusals are UnknownLayoutError.
 */
function walk(root: object, where: string, seen: Set<object>, build: boolean): unknown {
  const stack: Job[] = [];
  const enter = (src: object, depth: number): unknown[] | Record<string, unknown> | undefined => {
    if (!mayLookInside(src)) throw new UnknownLayoutError(`${where} holds a value that is not a plain array or object`);
    if (seen.has(src)) throw new UnknownLayoutError(`${where} refers to the same object more than once`);
    seen.add(src);
    if (depth > MAX_DEPTH) throw new UnknownLayoutError(`${where} is nested more than ${MAX_DEPTH} levels deep`);
    const dst = build ? (Array.isArray(src) ? [] : {}) : undefined;
    stack.push({ src, dst, depth });
    return dst;
  };
  /** The copy of a primitive or a leaf; for an object, enters it and returns its container. */
  const convert = (v: unknown, depth: number, inArray: boolean): { skip: boolean; value: unknown } => {
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return { skip: false, value: v };
      case 'number':
        return { skip: false, value: Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null };
      case 'bigint':
        throw new UnknownLayoutError(`${where} holds a bigint`);
      case 'undefined':
      case 'function':
      case 'symbol':
        return inArray ? { skip: false, value: null } : { skip: true, value: undefined };
      default:
        return v === null ? { skip: false, value: null } : { skip: false, value: enter(v as object, depth) };
    }
  };

  let values = 0;
  // the root is level 1
  const rootDst = enter(root, 1);
  while (stack.length > 0) {
    const { src, dst, depth } = stack.pop()!;
    if (Array.isArray(src)) {
      const length = src.length;
      if (length > MAX_ARRAY_LENGTH) throw new UnknownLayoutError(`${where} holds an array of more than ${MAX_ARRAY_LENGTH} entries`);
      values += length;
      if (values > MAX_VALUES) throw new UnknownLayoutError(`${where} holds more than ${MAX_VALUES} values`);
      if (Object.keys(src).length !== length) throw new UnknownLayoutError(`${where} holds an array with holes`);
      for (let i = 0; i < length; i++) {
        const c = convert(dataValue(src, String(i), where), depth + 1, true);
        if (dst !== undefined) (dst as unknown[])[i] = c.value;
      }
    } else {
      const keys = Object.keys(src);
      values += keys.length;
      if (values > MAX_VALUES) throw new UnknownLayoutError(`${where} holds more than ${MAX_VALUES} values`);
      for (const key of keys) {
        const c = convert(dataValue(src, key, where), depth + 1, false);
        if (dst !== undefined && !c.skip) define(dst as Record<string, unknown>, key, c.value);
      }
    }
  }
  return rootDst;
}

/**
 * Refuses a record that would cost too much to copy or compare (see `walk` for every rule) and builds nothing.
 * `seen` and the value count belong to one record: the objects of one record may not repeat, but a different
 * record may hold the same object. Records read from a file never share objects, so nothing from a file is
 * refused by the sharing rule.
 */
export function assertShallow(value: unknown, where: string, seen: Set<object> = new Set()): void {
  if (value === null || typeof value !== 'object') return;
  walk(value, where, seen, false);
}

/**
 * The book's own plain copy of a record given straight to `ingest`, built in one pass by `walk`: a getter, a
 * prototype field, a symbol key, `toJSON` or a later change by the caller cannot alter it, because nothing of
 * the caller's is called and each value is read once. Any failure on the way is an UnknownLayoutError, never
 * another error type. The copy still has to pass `validateRecord`.
 */
export function plainCopy(item: unknown, where: string, seen: Set<object>): unknown {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new UnknownLayoutError(`${where} is not an object`);
  }
  try {
    return walk(item, where, seen, true);
  } catch (e) {
    if (e instanceof UnknownLayoutError) throw e;
    throw new UnknownLayoutError(`${where} cannot be read as a plain record`);
  }
}

/**
 * The one set of checks for a record, used for every record of a file and for every record given straight
 * to `ingest`: an object, not nested too deep, and each field the scorer relies on present, of the right
 * type, in range and not too long. Throws UnknownLayoutError naming the field.
 */
export function validateRecord(item: unknown, where: string): asserts item is ShotRecord {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new UnknownLayoutError(`${where} is not an object`);
  }
  assertShallow(item, where);
  const rec = item as Record<string, unknown>;
  for (const field of CHECK_ORDER) {
    const v = rec[field];
    if ((STRING_FIELDS as readonly string[]).includes(field)) {
      if (typeof v !== 'string' || (field === 'ShotID' && v === '')) {
        throw new UnknownLayoutError(`${where}: field ${field} is missing or not ${field === 'ShotID' ? 'a non-empty string' : 'a string'}`);
      }
      const max = TEXT_LIMITS[field]!;
      if (v.length > max) {
        throw new UnknownLayoutError(`${where}: field ${field} is too long (more than ${max} characters)`);
      }
    } else if (!(INTEGER_FIELDS as readonly string[]).includes(field) || !Number.isSafeInteger(v)) {
      throw new UnknownLayoutError(`${where}: field ${field} is missing or not an integer`);
    } else {
      const limit = INTEGER_LIMITS[field];
      if (limit && ((v as number) < limit[0] || (v as number) > limit[1])) {
        throw new UnknownLayoutError(`${where}: field ${field} is out of range (${limit[0]} to ${limit[1]})`);
      }
    }
  }
}

export function parseRoundFile(text: string): ShotRecord[] {
  if (typeof text !== 'string') throw new UnknownLayoutError('round file text must be a string');
  if (text.length > MAX_TEXT_CHARS) {
    throw new UnknownLayoutError(`round file is too large: more than ${MAX_TEXT_CHARS} characters`);
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new UnknownLayoutError('round file is not valid JSON');
  }
  if (!Array.isArray(data)) throw new UnknownLayoutError('round file is not a JSON array');
  if (data.length > MAX_RECORDS) {
    throw new UnknownLayoutError(`round file holds too many records: more than ${MAX_RECORDS}`);
  }
  data.forEach((item: unknown, i: number) => validateRecord(item, `record ${i}`));
  return data as ShotRecord[];
}
