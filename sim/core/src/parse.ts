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
 * True for a value the walk may look inside: a true array (its prototype is exactly Array.prototype) or a
 * plain object (its prototype is exactly Object.prototype or null). Everything JSON.parse returns is one of
 * these. Anything else that is an object (a typed array or other view of a buffer, a boxed String, Number
 * or Boolean, a Map, a Set, a Date, an instance of a class) is not looked inside.
 */
function isPlainValue(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return Array.isArray(v) ? proto === Array.prototype : proto === Object.prototype || proto === null;
}

/**
 * Refuses a record that would cost too much to copy or compare: an object that is neither a true array nor
 * a plain object (refused first, before its keys, length or entries are read), nested more than MAX_DEPTH levels deep (the
 * value itself is level 1), an object reached a second time (a shared reference or a cycle), an array longer
 * than MAX_ARRAY_LENGTH, an array with holes (its length is not the number of entries it has), or more than
 * MAX_VALUES values in all, counted as the walk goes. Only plain values are looked inside, and lengths and
 * counts are read before an array or object is expanded, so a record that will be refused is refused quickly
 * and cheaply. Walks with its own stack, never
 * by recursion, and visits each object once. `seen` and the value count belong to one record: the objects of
 * one record may not repeat, but a different record may hold the same object. Records read from a file never
 * share objects, so nothing from a file is refused by the sharing rule.
 */
export function assertShallow(value: unknown, where: string, seen: Set<object> = new Set()): void {
  const stack: Array<[unknown, number]> = [[value, 1]];
  let values = 0;
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    // first of all, before Object.keys or anything else that could expand the value
    if (!isPlainValue(v)) throw new UnknownLayoutError(`${where} holds a value that is not a plain array or object`);
    if (seen.has(v)) throw new UnknownLayoutError(`${where} refers to the same object more than once`);
    seen.add(v);
    if (depth > MAX_DEPTH) throw new UnknownLayoutError(`${where} is nested more than ${MAX_DEPTH} levels deep`);
    let kids: unknown[];
    if (Array.isArray(v)) {
      const length = v.length;
      if (length > MAX_ARRAY_LENGTH) throw new UnknownLayoutError(`${where} holds an array of more than ${MAX_ARRAY_LENGTH} entries`);
      values += length;
      if (values > MAX_VALUES) throw new UnknownLayoutError(`${where} holds more than ${MAX_VALUES} values`);
      if (Object.keys(v).length !== length) throw new UnknownLayoutError(`${where} holds an array with holes`);
      kids = Object.values(v);
    } else {
      const keys = Object.keys(v);
      values += keys.length;
      if (values > MAX_VALUES) throw new UnknownLayoutError(`${where} holds more than ${MAX_VALUES} values`);
      kids = Object.values(v);
    }
    for (const child of kids) stack.push([child, depth + 1]);
  }
}

/**
 * The book's own plain copy of a record given straight to `ingest`: walked first (depth and sharing), then
 * converted to JSON text and back, so a getter, a prototype field, a symbol key or a later change by the
 * caller cannot alter it. Any failure on the way (a getter that throws, a value JSON cannot hold) is an
 * UnknownLayoutError, never another error type. The copy still has to pass `validateRecord`.
 */
export function plainCopy(item: unknown, where: string, seen: Set<object>): unknown {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new UnknownLayoutError(`${where} is not an object`);
  }
  try {
    assertShallow(item, where, seen);
    return JSON.parse(JSON.stringify(item));
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
