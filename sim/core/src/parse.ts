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

/**
 * Refuses a value nested more than MAX_DEPTH levels deep (the value itself is level 1) and any object
 * reached a second time (a shared reference or a cycle). Walks with its own stack, never by recursion,
 * and visits each object once, so the time is in proportion to the size of the value. `seen` lets one
 * walk cover several values (every record of one `ingest` call). Records read from a file never share
 * objects, so nothing from a file is refused by the sharing rule.
 */
export function assertShallow(value: unknown, where: string, seen: Set<object> = new Set()): void {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (seen.has(v)) throw new UnknownLayoutError(`${where} refers to the same object more than once`);
    seen.add(v);
    if (depth > MAX_DEPTH) throw new UnknownLayoutError(`${where} is nested more than ${MAX_DEPTH} levels deep`);
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
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
