/** Reader for GSPro's `currentRound.dat`. The file is untrusted input: check what we rely on, refuse the rest. */

export const MAX_TEXT_CHARS = 50_000_000;
export const MAX_RECORDS = 20_000;

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
    const rec = item as Record<string, unknown>;
    for (const field of CHECK_ORDER) {
      const v = rec[field];
      if ((STRING_FIELDS as readonly string[]).includes(field)) {
        if (typeof v !== 'string' || (field === 'ShotID' && v === '')) {
          throw new UnknownLayoutError(`record ${i}: field ${field} is missing or not ${field === 'ShotID' ? 'a non-empty string' : 'a string'}`);
        }
      } else if (!(INTEGER_FIELDS as readonly string[]).includes(field) || !Number.isInteger(v)) {
        throw new UnknownLayoutError(`record ${i}: field ${field} is missing or not an integer`);
      }
    }
  });
  return data as ShotRecord[];
}
