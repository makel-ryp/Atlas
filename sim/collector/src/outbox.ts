import { createHash } from 'node:crypto';
import type { ShotRecord } from '../../core/src/index.js';
import type { Files } from './files.js';

export const OUTBOX_NAME = 'outbox.jsonl';
export const SENT_NAME = 'sent.json';
export const REFUSED_NAME = 'refused.jsonl';

export const DEFAULT_PIECE_BYTES = 64 * 1024;

/** A problem with the collector's own files or settings. The message is plain and never holds anything from GSPro's file. */
export class CollectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectorError';
  }
}

const ASIDE = 'Stop the program and move the data folder aside (it may hold shots not yet sent), then start again.';

interface SentRecord {
  /** How many outbox lines are done with (sent or refused). */
  cursor: number;
  sent: number;
  refused: number;
}

function fingerprint(record: ShotRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

/**
 * Three files in the data folder:
 * - `outbox.jsonl`: one line per shot dealt with. A line is either `{"record": ...}` (a full record, waiting or
 *   done) or `{"short": {"id", "fp"}}` (only remembers a shot that is already dealt with). It is appended to, and
 *   rewritten to short lines only by `tidy`.
 * - `sent.json`: how far into the outbox the work has got, written to a temporary file and renamed.
 * - `refused.jsonl`: batches the server refused for good. The program never clears it.
 * A record is in the outbox once. It is marked done only after the server has answered for it.
 */
export class Outbox {
  private seen = new Map<string, string>();
  private waiting: ShotRecord[] = [];
  private bytes = 0;
  private state: SentRecord = { cursor: 0, sent: 0, refused: 0 };

  constructor(
    private readonly files: Files,
    private readonly pieceBytes: number = DEFAULT_PIECE_BYTES,
  ) {}

  /** Reads the files. Returns true when a cut-short last line was found and dropped. */
  load(): { droppedLine: boolean } {
    this.files.ensureDataDir();
    this.seen = new Map();
    this.waiting = [];
    this.bytes = 0;
    this.state = { cursor: 0, sent: 0, refused: 0 };

    const sentText = this.files.readData(SENT_NAME);
    if (sentText !== undefined) {
      const damaged = (): never => {
        throw new CollectorError(`The record of what was sent is damaged. ${ASIDE}`);
      };
      let parsed: unknown;
      try {
        parsed = JSON.parse(sentText);
      } catch {
        return damaged();
      }
      const p = parsed as Partial<SentRecord> | null;
      if (!p || !Number.isSafeInteger(p.cursor) || !Number.isSafeInteger(p.sent) || !Number.isSafeInteger(p.refused) || p.cursor! < 0) return damaged();
      this.state = { cursor: p.cursor!, sent: p.sent!, refused: p.refused! };
    }

    let index = 0;
    const res = this.files.readLines(OUTBOX_NAME, this.pieceBytes, (line) => {
      let parsed: { record?: ShotRecord; short?: { id: string; fp: string } };
      try {
        parsed = JSON.parse(line) as typeof parsed;
        if (parsed.record !== undefined) {
          if (parsed.record === null || typeof parsed.record !== 'object' || typeof parsed.record.ShotID !== 'string') throw new Error('shape');
        } else if (parsed.short === undefined || typeof parsed.short.id !== 'string' || typeof parsed.short.fp !== 'string') {
          throw new Error('shape');
        }
      } catch {
        throw new CollectorError(`The outbox file is damaged. ${ASIDE}`);
      }
      if (parsed.record !== undefined) {
        this.seen.set(parsed.record.ShotID, fingerprint(parsed.record));
        if (index >= this.state.cursor) this.waiting.push(parsed.record);
      } else {
        this.seen.set(parsed.short!.id, parsed.short!.fp);
      }
      index++;
    });
    let dropped = false;
    if (res.tornBytes > 0) {
      // A crash cut the last line short. It was never counted; drop it so the next append starts on a new line.
      this.files.keepPrefix(OUTBOX_NAME, res.validBytes);
      dropped = true;
    }
    this.bytes = res.validBytes;
    if (this.state.cursor > index) {
      throw new CollectorError(`The outbox file is shorter than the record of what was sent. ${ASIDE}`);
    }
    return { droppedLine: dropped };
  }

  /** Appends the records not already queued with this exact content, in the order given. Returns how many. */
  queue(records: ShotRecord[]): number {
    const fresh: Array<[ShotRecord, string]> = [];
    const local = new Map<string, string>();
    for (const rec of records) {
      const fp = fingerprint(rec);
      const known = local.get(rec.ShotID) ?? this.seen.get(rec.ShotID);
      if (known === fp) continue;
      local.set(rec.ShotID, fp);
      fresh.push([rec, fp]);
    }
    if (fresh.length === 0) return 0;
    const text = fresh.map(([rec]) => JSON.stringify({ record: rec }) + '\n').join('');
    // On the disk before the records count as queued.
    this.files.appendDurable(OUTBOX_NAME, text);
    for (const [rec, fp] of fresh) {
      this.seen.set(rec.ShotID, fp);
      this.waiting.push(rec);
    }
    this.bytes += Buffer.byteLength(text);
    return fresh.length;
  }

  /**
   * The next records to send, in order, up to `max`. It stops just before a record whose ShotID is already in
   * the batch: the hub would refuse the second version as a duplicate, so the later version goes in the next post.
   */
  batch(max: number): ShotRecord[] {
    const out: ShotRecord[] = [];
    const ids = new Set<string>();
    for (const rec of this.waiting) {
      if (out.length >= max || ids.has(rec.ShotID)) break;
      ids.add(rec.ShotID);
      out.push(rec);
    }
    return out;
  }

  /** The server accepted the first `n` waiting records. */
  markSent(n: number): void {
    this.files.writeData(SENT_NAME, JSON.stringify({ cursor: this.state.cursor + n, sent: this.state.sent + n, refused: this.state.refused }));
    this.state = { cursor: this.state.cursor + n, sent: this.state.sent + n, refused: this.state.refused };
    this.waiting.splice(0, n);
  }

  /** The server refused the first `n` waiting records for good: keep them in the refused file and move on. */
  markRefused(n: number, status: number, at: number): void {
    const batch = this.waiting.slice(0, n);
    this.files.appendData(REFUSED_NAME, JSON.stringify({ at, status, records: batch }) + '\n');
    this.files.writeData(SENT_NAME, JSON.stringify({ cursor: this.state.cursor + n, sent: this.state.sent, refused: this.state.refused + n }));
    this.state = { cursor: this.state.cursor + n, sent: this.state.sent, refused: this.state.refused + n };
    this.waiting.splice(0, n);
  }

  /** True when the outbox file is larger than `limit` bytes and nothing is waiting: time to tidy. */
  needsTidy(limit: number): boolean {
    return this.waiting.length === 0 && this.bytes > limit;
  }

  /**
   * Rewrites the outbox to one short line for each shot of `records` (the last complete copy), nothing else.
   * Only when nothing is waiting. Two writes, in this order so that a crash between them loses nothing: first the
   * record of what was sent (position set to the new number of lines, counts kept), then the outbox. If the crash
   * comes between them, the old outbox is read with the new position: at worst some records are sent again, and
   * the hub answers `unchanged` for them.
   */
  tidy(records: ShotRecord[]): void {
    if (this.waiting.length > 0) return;
    const latest = new Map<string, string>();
    for (const rec of records) latest.set(rec.ShotID, fingerprint(rec));
    const lines = [...latest].map(([id, fp]) => JSON.stringify({ short: { id, fp } }) + '\n');
    const text = lines.join('');
    this.files.writeData(SENT_NAME, JSON.stringify({ cursor: lines.length, sent: this.state.sent, refused: this.state.refused }));
    this.files.writeData(OUTBOX_NAME, text);
    this.state = { cursor: lines.length, sent: this.state.sent, refused: this.state.refused };
    this.seen = latest;
    this.bytes = Buffer.byteLength(text);
  }

  /** Records ever queued (sent, refused and waiting), counted across runs. */
  get queued(): number {
    return this.state.sent + this.state.refused + this.waiting.length;
  }
  get sent(): number {
    return this.state.sent;
  }
  get refused(): number {
    return this.state.refused;
  }
  get pending(): number {
    return this.waiting.length;
  }
}
