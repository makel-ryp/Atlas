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
  /** How many outbox lines are done with (sent or refused). The header line of a cleaned outbox is not a line of this count. */
  cursor: number;
  sent: number;
  refused: number;
  /** Which cleanup of the outbox this record goes with: 0 for a folder never cleaned (and for a record written without the field). */
  gen: number;
}

const BELONG = `The outbox file and the record of what was sent do not belong together. ${ASIDE}`;

/** The text of `sent.json`. The generation is written only from generation 1 on: a folder never cleaned has the file it always had. */
function sentJson(s: SentRecord): string {
  return JSON.stringify(s.gen === 0 ? { cursor: s.cursor, sent: s.sent, refused: s.refused } : { cursor: s.cursor, sent: s.sent, refused: s.refused, gen: s.gen });
}

function fingerprint(record: ShotRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

/**
 * Three files in the data folder:
 * - `outbox.jsonl`: one line per shot dealt with. A line is either `{"record": ...}` (a full record, waiting or
 *   done) or `{"short": {"id", "fp"}}` (only remembers a shot that is already dealt with). It is appended to, and
 *   rewritten to short lines only by `tidy`. An outbox written by `tidy` begins with one header line, `{"gen":n}`,
 *   the number of that cleanup; an outbox with no header is generation 0. The header is not a shot and is not counted.
 * - `sent.json`: how far into the outbox the work has got (`cursor`, the counts) and the generation (`gen`) of the
 *   outbox that position belongs to, written to a temporary file and renamed.
 * - `refused.jsonl`: batches the server refused for good. The program never clears it.
 * A record is in the outbox once. It is marked done only after the server has answered for it.
 *
 * The two files must belong together: the position means something only for the outbox of its own generation. A
 * cleanup changes both, so it is one step in two writes that a start can always finish (see `tidy` and `load`). If the
 * second write fails and the program goes on (the collector catches a failed cleanup and keeps running), records queued
 * after that are appended to the new outbox after its short lines; a start that finds the outbox one generation ahead
 * takes those records as waiting.
 */
export class Outbox {
  private seen = new Map<string, string>();
  private waiting: ShotRecord[] = [];
  private bytes = 0;
  private state: SentRecord = { cursor: 0, sent: 0, refused: 0, gen: 0 };
  /** The generation `sent.json` is known to hold on the disk (set by `load`, and by each write of `sent.json` that succeeds). */
  private savedGen = 0;
  /** True when a failed append could not be cut back: the outbox on the disk may be longer than `bytes`. `queue` appends nothing until a cut-back has succeeded; `load` clears it. */
  private maybeLonger = false;

  constructor(
    private readonly files: Files,
    private readonly pieceBytes: number = DEFAULT_PIECE_BYTES,
  ) {}

  /**
   * Reads the files and compares their generations. Equal: as always. The outbox one ahead of `sent.json`: a cleanup
   * replaced the outbox and its second write, the one of `sent.json`, did not happen (the process ended, or the write
   * failed and the program went on). The outbox is then the header, the cleanup's short lines, and zero or more full
   * records queued after them (a short line after a full record is a damaged folder). The position becomes the number of
   * short lines, the counts are kept, the full records after them wait, in order, and `sent.json` is written with the
   * outbox's generation before `load` returns; nothing is printed.
   *
   * Why that is right: every `markSent` or `markRefused` that succeeds writes `sent.json` with the generation the object
   * holds, and from then on the two files are equal again. So while the outbox is one ahead, no record after the short
   * lines has been saved as dealt with. At most one batch can have been acknowledged by the hub while the write that
   * would have said so failed; it is sent once more, with the content the hub already holds, as after any other cut.
   * Any other pair of generations is a damaged folder.
   * Returns true when a cut-short last line was found and dropped.
   */
  load(): { droppedLine: boolean } {
    this.files.ensureDataDir();
    this.seen = new Map();
    this.waiting = [];
    this.bytes = 0;
    this.state = { cursor: 0, sent: 0, refused: 0, gen: 0 };
    this.maybeLonger = false; // the file is read as it is

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
      const gen = p.gen === undefined ? 0 : p.gen; // a record written without the field is generation 0
      if (!Number.isSafeInteger(gen) || gen < 0) return damaged();
      this.state = { cursor: p.cursor!, sent: p.sent!, refused: p.refused!, gen };
    }

    let index = 0; // the lines that count: every line but the header
    let lineNo = 0;
    let outboxGen = 0;
    let shortCount = 0;
    let shortAfterRecord = false;
    const afterShorts: ShotRecord[] = []; // the full records, in order: what waits when the outbox is one ahead
    const res = this.files.readLines(OUTBOX_NAME, this.pieceBytes, (line) => {
      lineNo++;
      let parsed: { record?: ShotRecord; short?: { id: string; fp: string }; gen?: unknown };
      try {
        parsed = JSON.parse(line) as typeof parsed;
        if (parsed === null || typeof parsed !== 'object') throw new Error('shape');
        if (parsed.gen !== undefined) {
          // the header: only on the first line, and a whole number of 0 or more
          if (lineNo !== 1 || parsed.record !== undefined || parsed.short !== undefined || typeof parsed.gen !== 'number' || !Number.isSafeInteger(parsed.gen) || parsed.gen < 0) throw new Error('shape');
        } else if (parsed.record !== undefined) {
          if (parsed.record === null || typeof parsed.record !== 'object' || typeof parsed.record.ShotID !== 'string') throw new Error('shape');
        } else if (parsed.short === undefined || typeof parsed.short.id !== 'string' || typeof parsed.short.fp !== 'string') {
          throw new Error('shape');
        }
      } catch {
        throw new CollectorError(`The outbox file is damaged. ${ASIDE}`);
      }
      if (parsed.gen !== undefined) {
        outboxGen = parsed.gen as number;
        return;
      }
      if (parsed.record !== undefined) {
        afterShorts.push(parsed.record);
        this.seen.set(parsed.record.ShotID, fingerprint(parsed.record));
        if (index >= this.state.cursor) this.waiting.push(parsed.record);
      } else {
        if (afterShorts.length > 0) shortAfterRecord = true;
        shortCount++;
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
    if (outboxGen === this.state.gen + 1) {
      // A cleanup replaced the outbox and the write of `sent.json` did not follow (see the comment above). The position is the short lines;
      // the full records after them were queued since the cleanup and are not done.
      if (shortAfterRecord) throw new CollectorError(`The outbox file is damaged. ${ASIDE}`);
      this.state = { cursor: shortCount, sent: this.state.sent, refused: this.state.refused, gen: outboxGen };
      this.waiting = afterShorts;
      this.files.writeData(SENT_NAME, sentJson(this.state));
    } else if (outboxGen !== this.state.gen) {
      throw new CollectorError(BELONG);
    }
    this.savedGen = this.state.gen;
    if (this.state.cursor > index) {
      throw new CollectorError(`The outbox file is shorter than the record of what was sent. ${ASIDE}`);
    }
    return { droppedLine: dropped };
  }

  /**
   * Appends the records not already queued with this exact content, in the order given. Returns how many.
   *
   * If the append throws, the outbox on the disk is cut back to the length this object knows (`bytes`) before the error
   * leaves, whatever of the text landed (all, part, or none). Why that loses nothing: the bytes of a failed append were never
   * counted and never sent, and the same records are queued again from the next read of the copy; left in the file, they
   * would be there twice while this object counts them once, and the position on the disk would fall behind the file by a
   * line for every such failure, so that after a restart older revisions that were acknowledged would wait again.
   * If the cut-back fails too, the file may be longer than this object knows: nothing is appended until a cut-back has
   * succeeded (the next call that has something to append tries first, and throws, appending nothing, if it fails again).
   * A file that is not there is not an error of the cut-back only when nothing was counted in it (`bytes` is 0: the first append
   * failed before the file was made). When `bytes` is more than 0 the outbox is there, so a "not there" from the cut-back (its
   * temporary file gone before the rename, the folder not reachable for a moment) is a cut-back that failed, like any other.
   */
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
    if (this.maybeLonger) {
      const failed = this.cutBack();
      if (failed !== undefined) throw failed;
    }
    const text = fresh.map(([rec]) => JSON.stringify({ record: rec }) + '\n').join('');
    // On the disk before the records count as queued.
    try {
      this.files.appendDurable(OUTBOX_NAME, text);
    } catch (e) {
      this.cutBack();
      throw e;
    }
    for (const [rec, fp] of fresh) {
      this.seen.set(rec.ShotID, fp);
      this.waiting.push(rec);
    }
    this.bytes += Buffer.byteLength(text);
    return fresh.length;
  }

  /** Cuts the outbox on the disk back to `bytes`. Returns the error when that fails (and remembers it), undefined when it worked or when nothing was counted and the file is not there. */
  private cutBack(): unknown {
    try {
      this.files.keepPrefix(OUTBOX_NAME, this.bytes);
    } catch (e) {
      if (this.bytes === 0 && (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        this.maybeLonger = false;
        return undefined;
      }
      this.maybeLonger = true;
      return e;
    }
    this.maybeLonger = false;
    return undefined;
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
    const next = { ...this.state, cursor: this.state.cursor + n, sent: this.state.sent + n };
    this.files.writeData(SENT_NAME, sentJson(next));
    this.savedGen = next.gen;
    this.state = next;
    this.waiting.splice(0, n);
  }

  /** The server refused the first `n` waiting records for good: keep them in the refused file and move on. */
  markRefused(n: number, status: number, at: number): void {
    const batch = this.waiting.slice(0, n);
    this.files.appendData(REFUSED_NAME, JSON.stringify({ at, status, records: batch }) + '\n');
    const next = { ...this.state, cursor: this.state.cursor + n, refused: this.state.refused + n };
    this.files.writeData(SENT_NAME, sentJson(next));
    this.savedGen = next.gen;
    this.state = next;
    this.waiting.splice(0, n);
  }

  /** True when the outbox file is larger than `limit` bytes and nothing is waiting: time to tidy. */
  needsTidy(limit: number): boolean {
    return this.waiting.length === 0 && this.bytes > limit;
  }

  /**
   * Rewrites the outbox to one short line for each shot of `records` (the last complete copy), nothing else, and begins it
   * with a header line `{"gen":n}`, the number of this cleanup. Only when nothing is waiting, and never for no records: an
   * empty copy (GSPro's file read as empty at that moment) would forget every shot and have the whole round sent again.
   *
   * Two writes, **the outbox first, then `sent.json`** (position set to the number of short lines, the counts kept, the new
   * generation). The position of `sent.json` means something only for the outbox of its own generation, so the order is what
   * makes a cut harmless at every point:
   * - before the outbox is replaced (or inside its write: a leftover temporary file is ignored): nothing changed; the old
   *   outbox and the old `sent.json` still belong together;
   * - after the outbox is replaced and before `sent.json`: the outbox is one generation ahead. If the process ended there it holds
   *   the short lines only and the next `load` finishes the cleanup (writes `sent.json`) and sends nothing. If the write failed and
   *   the program went on, records queued since are after the short lines; the next `load` takes the short lines as the position
   *   and those records as waiting (none of them was saved as done: a write of `sent.json` that succeeds carries the new generation);
   * - inside the write of `sent.json`: the old `sent.json` is still whole (temporary file and rename), the same as the case before;
   * - after both: done.
   * (The other order, `sent.json` first, left the new small position beside the old long outbox, and every record past that
   * position, all of them already acknowledged, waited to be sent again, older revisions of a shot among them.)
   * A resend after a cut is only ever of the one batch whose acknowledgement was being written, the same content the hub already holds.
   * The new generation is counted from the generation `sent.json` is known to hold on the disk, so a cleanup that follows one whose second write failed is again exactly one ahead.
   */
  tidy(records: ShotRecord[]): void {
    if (this.waiting.length > 0 || records.length === 0) return;
    const latest = new Map<string, string>();
    for (const rec of records) latest.set(rec.ShotID, fingerprint(rec));
    const lines = [...latest].map(([id, fp]) => JSON.stringify({ short: { id, fp } }) + '\n');
    const gen = this.savedGen + 1; // from the generation on the disk, so that a cleanup after one whose second write failed is again exactly one ahead
    const text = JSON.stringify({ gen }) + '\n' + lines.join('');
    this.files.writeData(OUTBOX_NAME, text);
    // The outbox is replaced: what this object holds follows it, so that a failed write of `sent.json` below cannot leave the two out of step in memory.
    this.seen = latest;
    this.bytes = Buffer.byteLength(text);
    this.state = { cursor: lines.length, sent: this.state.sent, refused: this.state.refused, gen };
    this.files.writeData(SENT_NAME, sentJson(this.state));
    this.savedGen = gen;
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
