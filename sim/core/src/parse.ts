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
 * Refuses a value nested more than MAX_DEPTH levels deep (the value itself is level 1).
 * Walks with its own stack, never by recursion, so it cannot overflow however deep the input is.
 */
export function assertShallow(value: unknown, where: string): void {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (depth > MAX_DEPTH) throw new UnknownLayoutError(`${where} is nested more than ${MAX_DEPTH} levels deep`);
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
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
  data.forEach((item: unknown, i: number) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new UnknownLayoutError(`record ${i} is not an object`);
    }
    assertShallow(item, `record ${i}`);
    const rec = item as Record<string, unknown>;
    for (const field of CHECK_ORDER) {
      const v = rec[field];
      if ((STRING_FIELDS as readonly string[]).includes(field)) {
        if (typeof v !== 'string' || (field === 'ShotID' && v === '')) {
          throw new UnknownLayoutError(`record ${i}: field ${field} is missing or not ${field === 'ShotID' ? 'a non-empty string' : 'a string'}`);
        }
      } else if (!(INTEGER_FIELDS as readonly string[]).includes(field) || !Number.isSafeInteger(v)) {
        throw new UnknownLayoutError(`record ${i}: field ${field} is missing or not an integer`);
      } else {
        const limit = INTEGER_LIMITS[field];
        if (limit && ((v as number) < limit[0] || (v as number) > limit[1])) {
          throw new UnknownLayoutError(`record ${i}: field ${field} is out of range (${limit[0]} to ${limit[1]})`);
        }
      }
    }
  });
  return data as ShotRecord[];
}
