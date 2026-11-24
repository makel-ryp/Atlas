import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const JOURNAL_NAME = 'journal.jsonl';

/** Thrown when the journal cannot be trusted. The message never carries file content. */
export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

/**
 * Reads the journal's batches in order. A last line that is not complete JSON is skipped (warn is called once, with no
 * file content) and `cutAt` says the byte where it began. A bad line anywhere else is an error: it is never skipped silently.
 */
export function readBatches(file: string, warn: (line: string) => void): { batches: unknown[][]; cutAt: number | undefined } {
  if (!existsSync(file)) return { batches: [], cutAt: undefined };
  const text = readFileSync(file, 'utf8');
  const batches: unknown[][] = [];
  let pos = 0;
  let cutAt: number | undefined;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const start = pos;
    pos += Buffer.byteLength(line, 'utf8') + 1;
    if (line === '') continue;
    const isLast = lines.slice(i + 1).every((l) => l === '');
    const unterminated = i === lines.length - 1; // nothing after it, not even a newline: a write cut short
    let batch: unknown[] | undefined;
    try {
      const v: unknown = JSON.parse(line);
      if (Array.isArray(v)) batch = v;
    } catch {
      batch = undefined;
    }
    if (batch === undefined) {
      if (isLast && unterminated) {
        warn(`journal: the last line was incomplete and was skipped (line ${i + 1})`);
        cutAt = start;
        break;
      }
      throw new JournalError(`journal is corrupt at line ${i + 1}; the hub will not start until it is repaired or moved away`);
    }
    batches.push(batch);
  }
  return { batches, cutAt };
}

/** The append-only file of accepted batches: one JSON array of records per line. */
export class Journal {
  private fd: number | undefined;

  private constructor(readonly file: string, fd: number) {
    this.fd = fd;
  }

  /** Replays the file through onBatch in order, repairs a cut-short last line, and opens the file for appending. */
  static open(dir: string, onBatch: (records: unknown[]) => void, warn: (line: string) => void): Journal {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, JOURNAL_NAME);
    const { batches, cutAt } = readBatches(file, warn);
    for (let i = 0; i < batches.length; i++) {
      try {
        onBatch(batches[i] as unknown[]);
      } catch {
        throw new JournalError(`journal batch ${i + 1} was refused by the library; the hub will not start`);
      }
    }
    if (cutAt !== undefined) {
      truncateSync(file, cutAt); // so the next append starts on a clean line
    } else if (existsSync(file)) {
      const bytes = readFileSync(file);
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
        // a complete last line that only lacks its newline
        const fd = openSync(file, 'a');
        writeSync(fd, '\n');
        closeSync(fd);
      }
    }
    return new Journal(file, openSync(file, 'a'));
  }

  /** Writes one line and returns only when all of it is written. */
  append(records: unknown[]): void {
    if (this.fd === undefined) throw new JournalError('journal is closed');
    const buf = Buffer.from(`${JSON.stringify(records)}\n`, 'utf8');
    let off = 0;
    while (off < buf.length) off += writeSync(this.fd, buf, off, buf.length - off);
  }

  close(): void {
    if (this.fd === undefined) return;
    try {
      fsyncSync(this.fd);
    } finally {
      closeSync(this.fd);
      this.fd = undefined;
    }
  }
}
