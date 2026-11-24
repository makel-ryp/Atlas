import { appendFileSync, closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, truncateSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const JOURNAL_NAME = 'journal.jsonl';

/** The start reads the file in pieces of this size. */
export const DEFAULT_PIECE_BYTES = 1024 * 1024;
/** A line longer than this is treated as a bad line (the hub's own limit on a body is 32 MB). */
export const MAX_LINE_BYTES = 64 * 1024 * 1024;

/** Thrown when the journal cannot be trusted. The message never carries file content. */
export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

/** The file operations an append makes. Only tests replace them, to make a write fail part-way. */
export interface JournalIO {
  /** Writes len bytes of buf from off at the given file position; returns how many were written. */
  write(fd: number, buf: Buffer, off: number, len: number, position: number): number;
  sync(fd: number): void;
  truncate(fd: number, length: number): void;
}

export interface JournalOptions {
  /** Size of the pieces the start reads the file in. Default 1 MiB. Settable so a test can make lines straddle pieces. */
  pieceBytes?: number;
  /** A line longer than this is a bad line. Default 64 MB. */
  maxLineBytes?: number;
  /** Test-only seam for the append's file operations. */
  io?: Partial<JournalIO>;
}

const REAL_IO: JournalIO = {
  write: (fd, buf, off, len, position) => writeSync(fd, buf, off, len, position),
  sync: (fd) => fsyncSync(fd),
  truncate: (fd, length) => ftruncateSync(fd, length),
};

export interface ReplayResult {
  /** The byte where a cut-short last line began, when there was one. */
  cutAt: number | undefined;
  /** True when the last line is complete JSON but lacks its newline. */
  missingNewline: boolean;
  /** Bytes read. */
  size: number;
}

/**
 * Reads the journal in pieces, line by line, and hands each batch to onBatch in order. The whole file is never held
 * in one string or buffer. A last line that is not complete JSON (or is too long) and has no newline after it is skipped:
 * warn is called once, with no file content, and `cutAt` says where it began. A bad line anywhere else is an error:
 * it is never skipped silently. A batch that onBatch throws on is an error too.
 */
function* replaySteps(file: string, onBatch: (records: unknown[]) => void, warn: (line: string) => void, options: JournalOptions): Generator<void, ReplayResult> {
  if (!existsSync(file)) return { cutAt: undefined, missingNewline: false, size: 0 };
  const pieceBytes = Math.max(1, Math.floor(options.pieceBytes ?? DEFAULT_PIECE_BYTES));
  const maxLine = options.maxLineBytes ?? MAX_LINE_BYTES;
  const fd = openSync(file, 'r');
  try {
    const piece = Buffer.allocUnsafe(pieceBytes);
    let chunks: Buffer[] = [];
    let lineLen = 0;
    let tooLong = false;
    let lineNo = 0;
    let batchNo = 0;
    let pos = 0; // file offset of the start of the piece
    let lineStart = 0;

    const add = (from: number, to: number): void => {
      if (to <= from) return;
      lineLen += to - from;
      if (lineLen > maxLine) {
        tooLong = true;
        chunks = [];
      } else if (!tooLong) {
        chunks.push(Buffer.from(piece.subarray(from, to)));
      }
    };
    /** The parsed batch, or undefined when the line is not a JSON array. */
    const parse = (): unknown[] | undefined => {
      if (tooLong) return undefined;
      try {
        const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return Array.isArray(v) ? v : undefined;
      } catch {
        return undefined;
      }
    };
    const give = (batch: unknown[]): void => {
      batchNo++;
      try {
        onBatch(batch);
      } catch {
        throw new JournalError(`journal batch ${batchNo} was refused by the library; the hub will not start`);
      }
    };

    for (;;) {
      const n = readSync(fd, piece, 0, piece.length, pos);
      if (n === 0) break;
      const view = piece.subarray(0, n);
      let from = 0;
      for (;;) {
        const nl = view.indexOf(0x0a, from);
        if (nl < 0) {
          add(from, n);
          break;
        }
        add(from, nl);
        lineNo++;
        if (lineLen > 0) {
          const batch = parse();
          if (batch === undefined) throw new JournalError(`journal is corrupt at line ${lineNo}; the hub will not start until it is repaired or moved away`);
          give(batch);
        }
        chunks = [];
        lineLen = 0;
        tooLong = false;
        lineStart = pos + nl + 1;
        from = nl + 1;
      }
      pos += n;
      yield; // one piece done: the asynchronous reader lets the event loop run here
    }
    // what is left has no newline after it
    if (lineLen > 0) {
      lineNo++;
      const batch = parse();
      if (batch === undefined) {
        warn(`journal: the last line was incomplete and was skipped (line ${lineNo})`);
        return { cutAt: lineStart, missingNewline: false, size: pos };
      }
      give(batch);
      return { cutAt: undefined, missingNewline: true, size: pos };
    }
    return { cutAt: undefined, missingNewline: false, size: pos };
  } finally {
    closeSync(fd);
  }
}

/** The whole replay in one go. */
export function replayFile(file: string, onBatch: (records: unknown[]) => void, warn: (line: string) => void, options: JournalOptions = {}): ReplayResult {
  const steps = replaySteps(file, onBatch, warn, options);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The same replay, but the event loop runs between pieces, so a server that is already listening can answer "busy". */
export async function replayFileAsync(file: string, onBatch: (records: unknown[]) => void, warn: (line: string) => void, options: JournalOptions = {}): Promise<ReplayResult> {
  const steps = replaySteps(file, onBatch, warn, options);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** The append-only file of accepted batches: one JSON array of records per line. */
export class Journal {
  private fd: number | undefined;
  private broken = false;
  private readonly io: JournalIO;

  private constructor(
    readonly file: string,
    fd: number,
    /** The length of the file up to its last complete line: where an append starts and where a failed one is cut back to. */
    private goodLength: number,
    io: Partial<JournalIO> | undefined,
  ) {
    this.fd = fd;
    this.io = { ...REAL_IO, ...io };
  }

  /** Replays the file through onBatch in order, repairs a cut-short last line, and opens the file for appending. */
  static async open(dir: string, onBatch: (records: unknown[]) => void, warn: (line: string) => void, options: JournalOptions = {}): Promise<Journal> {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, JOURNAL_NAME);
    const r = await replayFileAsync(file, onBatch, warn, options);
    let good = r.size;
    if (r.cutAt !== undefined) {
      truncateSync(file, r.cutAt); // so the next append starts on a clean line
      good = r.cutAt;
    } else if (r.missingNewline) {
      appendFileSync(file, '\n'); // a complete last line that only lacks its newline
      good = r.size + 1;
    }
    if (!existsSync(file)) closeSync(openSync(file, 'a'));
    return new Journal(file, openSync(file, 'r+'), good, options.io);
  }

  /** True when a write failed and the file could not be cut back: nothing more may be appended. */
  get unavailable(): boolean {
    return this.broken;
  }

  /**
   * Writes one line and returns only when all of it is written and on the disk (fsync). When anything fails part-way the
   * file is cut back to its last good length; if that fails too the journal is unavailable until a restart.
   */
  append(records: unknown[]): void {
    if (this.fd === undefined) throw new JournalError('journal is closed');
    if (this.broken) throw new JournalError('journal is unavailable');
    const fd = this.fd;
    const buf = Buffer.from(`${JSON.stringify(records)}\n`, 'utf8');
    try {
      let off = 0;
      while (off < buf.length) off += this.io.write(fd, buf, off, buf.length - off, this.goodLength + off);
      this.io.sync(fd);
    } catch (e) {
      try {
        this.io.truncate(fd, this.goodLength);
      } catch {
        this.broken = true;
      }
      throw e;
    }
    this.goodLength += buf.length;
  }

  close(): void {
    if (this.fd === undefined) return;
    try {
      fsyncSync(this.fd);
    } catch {
      // a journal that could not be cut back may fail here too; closing must still release the file
    } finally {
      closeSync(this.fd);
      this.fd = undefined;
    }
  }
}
