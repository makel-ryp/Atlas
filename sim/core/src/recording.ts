import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoundFile, UnknownLayoutError, type ShotRecord } from './parse.js';

export interface Copy {
  number: number;
  /** Capture time from the file name, HHMMSS_mmm, local time. */
  time: string;
  round: number;
  records: ShotRecord[];
}

interface CaptureEntry {
  number: number;
  time: string;
  round: number;
  records: number;
}

/**
 * Rebuilds the recorded copies of GSPro's round file. Each copy is the first `records` records of its
 * round's last copy (the copies are cumulative and no record ever changed; see SOURCE.md in the fixture folder).
 */
export function loadRecording(dir: string): Copy[] {
  const meta: unknown = JSON.parse(readFileSync(join(dir, 'captures.json'), 'utf8'));
  const list = (meta as { captures?: unknown }).captures;
  if (!Array.isArray(list)) throw new UnknownLayoutError('captures.json has no captures list');
  const finals = new Map<number, ShotRecord[]>();
  const copies: Copy[] = [];
  for (const raw of list as CaptureEntry[]) {
    if (!Number.isInteger(raw.number) || !Number.isInteger(raw.round) || !Number.isInteger(raw.records) || typeof raw.time !== 'string') {
      throw new UnknownLayoutError('captures.json entry has the wrong shape');
    }
    let final = finals.get(raw.round);
    if (!final) {
      final = parseRoundFile(readFileSync(join(dir, `round${raw.round}-final.dat`), 'utf8'));
      finals.set(raw.round, final);
    }
    if (raw.records < 0 || raw.records > final.length) {
      throw new UnknownLayoutError(`capture ${raw.number} claims ${raw.records} records, the round file holds ${final.length}`);
    }
    copies.push({ number: raw.number, time: raw.time, round: raw.round, records: final.slice(0, raw.records) });
  }
  return copies;
}
