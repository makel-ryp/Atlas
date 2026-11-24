import { createHash } from 'node:crypto';
import type { ShotRecord } from '../../core/src/index.js';
import type { Files } from './files.js';

export const OUTBOX_NAME = 'outbox.jsonl';
export const SENT_NAME = 'sent.json';
export const REFUSED_NAME = 'refused.jsonl';

/** A problem with the collector's own files or settings. The message is plain and never holds anything from GSPro's file. */
export class CollectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectorError';
  }
}

interface SentRecord {
  /** How many outbox lines are done with (sent or refused). The outbox is only ever appended to. */
  cursor: number;
  sent: number;
  refused: number;
}

function fingerprint(record: ShotRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

/**
 * Three files in the data folder:
 * - `outbox.jsonl`: one line per queued record, appended in the order the records were found. Never rewritten
 *   (except to drop a torn last line on start).
 * - `sent.json`: how far into the outbox the work has got, written to a temporary file and renamed.
 * - `refused.jsonl`: batches the server refused for good.
 * A record is in the outbox once. It is marked done only after the server has answered for it.
 */
export class Outbox {
  private seen = new Map<string, string>();
  private waiting: ShotRecord[] = [];
  private total = 0;
  private state: SentRecord = { cursor: 0, sent: 0, refused: 0 };

  constructor(private readonly files: Files) {}

  load(): void {
    this.files.ensureDataDir();
    this.seen = new Map();
    this.waiting = [];
    this.total = 0;
    this.state = { cursor: 0, sent: 0, refused: 0 };

    const sentText = this.files.readData(SENT_NAME);
    if (sentText !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(sentText);
      } catch {
        throw new CollectorError('The record of what was sent is damaged. Stop the program and delete the data folder to start clean.');
      }
      const p = parsed as Partial<SentRecord> | null;
      if (!p || !Number.isSafeInteger(p.cursor) || !Number.isSafeInteger(p.sent) || !Number.isSafeInteger(p.refused) || p.cursor! < 0) {
        throw new CollectorError('The record of what was sent is damaged. Stop the program and delete the data folder to start clean.');
      }
      this.state = { cursor: p.cursor!, sent: p.sent!, refused: p.refused! };
    }

    let text = this.files.readData(OUTBOX_NAME) ?? '';
    if (text !== '' && !text.endsWith('\n')) {
      // A crash cut the last line short. It was never counted; drop it so the next append starts on a new line.
      text = text.slice(0, text.lastIndexOf('\n') + 1);
      this.files.writeData(OUTBOX_NAME, text);
    }
    const lines = text === '' ? [] : text.slice(0, -1).split('\n');
    const records: ShotRecord[] = [];
    for (const line of lines) {
      let rec: ShotRecord;
      try {
        rec = (JSON.parse(line) as { record: ShotRecord }).record;
        if (rec === null || typeof rec !== 'object' || typeof rec.ShotID !== 'string') throw new Error('shape');
      } catch {
        throw new CollectorError('The outbox file is damaged. Stop the program and delete the data folder to start clean.');
      }
      records.push(rec);
      this.seen.set(rec.ShotID, fingerprint(rec));
    }
    this.total = records.length;
    if (this.state.cursor > this.total) {
      throw new CollectorError('The outbox file is shorter than the record of what was sent. Stop the program and delete the data folder to start clean.');
    }
    this.waiting = records.slice(this.state.cursor);
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
    this.files.appendData(OUTBOX_NAME, fresh.map(([rec]) => JSON.stringify({ record: rec }) + '\n').join(''));
    for (const [rec, fp] of fresh) {
      this.seen.set(rec.ShotID, fp);
      this.waiting.push(rec);
    }
    this.total += fresh.length;
    return fresh.length;
  }

  /** The next records to send, in order, up to `max`. */
  batch(max: number): ShotRecord[] {
    return this.waiting.slice(0, max);
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

  get queued(): number {
    return this.total;
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
