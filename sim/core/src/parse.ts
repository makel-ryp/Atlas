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
 * Refuses a value nested more than MAX_DEPTH levels deep (the value itself is level 1) and a value that
 * contains itself. Walks with its own stack, never by recursion, and visits each object once, so the
 * time is in proportion to the size of the graph however many references share an object.
 */
export function assertShallow(value: unknown, where: string): void {
  interface Frame {
    kids: unknown[];
    next: number;
    /** Levels in this object's subtree, itself included. */
    height: number;
    obj: object;
  }
  const heights = new Map<object, number>(); // finished objects and their heights
  const path = new Set<object>(); // objects on the way down from the top
  const stack: Frame[] = [];
  const tooDeep = () => new UnknownLayoutError(`${where} is nested more than ${MAX_DEPTH} levels deep`);

  /** Enters `v`; returns its height now when it needs no walk (not an object, or already finished). */
  const enter = (v: unknown): number | undefined => {
    if (v === null || typeof v !== 'object') return 0;
    if (path.has(v)) throw new UnknownLayoutError(`${where} contains itself`);
    const depth = stack.length + 1;
    if (depth > MAX_DEPTH) throw tooDeep();
    const known = heights.get(v);
    if (known !== undefined) {
      if (depth + known - 1 > MAX_DEPTH) throw tooDeep();
      return known;
    }
    path.add(v);
    stack.push({ kids: Object.values(v), next: 0, height: 1, obj: v });
    return undefined;
  };

  const top = enter(value);
  if (top !== undefined) return;
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.next < frame.kids.length) {
      const h = enter(frame.kids[frame.next++]);
      if (h !== undefined) frame.height = Math.max(frame.height, h + 1);
    } else {
      stack.pop();
      path.delete(frame.obj);
      heights.set(frame.obj, frame.height);
      const parent = stack[stack.length - 1];
      if (parent) parent.height = Math.max(parent.height, frame.height + 1);
    }
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
