import { closeSync, constants, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const JOURNAL_NAME = 'journal.jsonl';

/** The start reads the file in pieces of this size. */
export const DEFAULT_PIECE_BYTES = 1024 * 1024;
/** A line longer than this is treated as a bad line (the hub's own limit on a body is 32 MB). */
export const MAX_LINE_BYTES = 64 * 1024 * 1024;

/** Thrown when the journal cannot be trusted. The message never carries file content. */
/** A code that is plain (capital letters, digits, underscore), else the word error: only that is ever printed. */
function plainCodeOf(code: unknown): string {
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'error';
}

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
  /** The size of the file the descriptor holds, read from the descriptor itself. */
  size(fd: number): number;
  /** The device and file number of the file at a path (as big integers). */
  statPath(path: string): { dev: bigint; ino: bigint };
  /** The same, for the one look the start makes after its replay (a separate seam, so a test of the write's look does not reach the start). */
  statPathAtStart(path: string): { dev: bigint; ino: bigint };
  /** Closes the descriptor. */
  close(fd: number): void;
  /** Opens the journal for reading (the start's replay and every rebuild). */
  openRead(path: string): number;
  /** Opens the journal once, for reading and writing, creating it when it is absent (the start's one open). */
  openReadWrite(path: string): number;
}

/** The look before a write: ok, gone (lost for good), or could not tell (another program may be holding a file for a moment). */
export type WriteLook = { state: 'ok' } | { state: 'gone' } | { state: 'cannot'; what: 'lock' | 'journal'; code: string };

/** The journal's own look: same file, gone, or could not tell. */
export type JournalLook = { state: 'same' } | { state: 'gone' } | { state: 'cannot'; code: string };

/** A line was NOT written because the journal, or the lock beside it, is not as this hub left it. Nothing was cut back. */
export class JournalNotWritten extends Error {
  /** What the look said, when it was the look that refused: absent when the file was found a different length. */
  readonly look: WriteLook | undefined;
  constructor(message: string, look?: WriteLook) {
    super(message);
    this.name = 'JournalNotWritten';
    this.look = look;
  }
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
  size: (fd) => fstatSync(fd).size,
  statPath: (path) => statSync(path, { bigint: true }),
  statPathAtStart: (path) => statSync(path, { bigint: true }),
  close: (fd) => closeSync(fd),
  openRead: (path) => openSync(path, 'r'),
  openReadWrite: (path) => openSync(path, constants.O_RDWR | constants.O_CREAT),
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
  const fd = (options.io?.openRead ?? REAL_IO.openRead)(file);
  try {
    return yield* replayHeld(fd, onBatch, warn, options);
  } finally {
    closeSync(fd);
  }
}

/** The replay of a file that is already open: reads from the descriptor only, and never closes it. */
function* replayHeld(fd: number, onBatch: (records: unknown[]) => void, warn: (line: string) => void, options: JournalOptions): Generator<void, ReplayResult> {
  const pieceBytes = Math.max(1, Math.floor(options.pieceBytes ?? DEFAULT_PIECE_BYTES));
  const maxLine = options.maxLineBytes ?? MAX_LINE_BYTES;
  {
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
    public goodLength: number,
    io: Partial<JournalIO> | undefined,
  ) {
    this.fd = fd;
    this.io = { ...REAL_IO, ...io };
  }

  /**
   * Opens the file ONCE, for reading and writing (creating it when absent), and keeps that descriptor: the replay reads from it, a
   * repair is made on it, and every later append goes through it. After the open nothing here names the journal by path again except
   * the look. When the last piece has been read, and with no turn of the event loop before the repair, the journal looks at itself:
   * the held file must still be the file at the path and its size must be the bytes the replay read. If not, the descriptor is closed,
   * nothing is changed in any file, and the start is refused.
   */
  static async open(dir: string, onBatch: (records: unknown[]) => void, warn: (line: string) => void, options: JournalOptions = {}): Promise<Journal> {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, JOURNAL_NAME);
    const io: JournalIO = { ...REAL_IO, ...options.io };
    const fd = io.openReadWrite(file);
    let r: ReplayResult;
    try {
      const steps = replayHeld(fd, onBatch, warn, options);
      for (;;) {
        const step = steps.next();
        if (step.done) {
          r = step.value;
          break;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (e) {
      try {
        io.close(fd);
      } catch {
        // the refusal that is already on its way is the one to report
      }
      throw e;
    }
    // From here to the end of the repair there is no await: nothing else can run between the look and the repair.
    const j = new Journal(file, fd, r.size, options.io);
    const refuse = (message: string): never => {
      try {
        io.close(fd);
      } catch {
        // see above
      }
      j.fd = undefined;
      throw new JournalError(message);
    };
    const seen = j.look((p) => io.statPathAtStart(p));
    if (seen.state === 'gone') refuse(`the journal ${JOURNAL_NAME} was removed, replaced or changed while the hub was starting; nothing was changed; start the hub again`);
    if (seen.state === 'cannot') refuse(`the journal ${JOURNAL_NAME} could not be looked at while the hub was starting (${plainCodeOf(seen.code)}); nothing was changed; try again in a moment`);
    let heldSize: number;
    try {
      heldSize = io.size(fd);
    } catch (e) {
      return refuse(`the journal ${JOURNAL_NAME} could not be looked at while the hub was starting (${plainCodeOf((e as NodeJS.ErrnoException | undefined)?.code)}); nothing was changed; try again in a moment`);
    }
    if (heldSize !== r.size) refuse(`the journal ${JOURNAL_NAME} was removed, replaced or changed while the hub was starting; nothing was changed; start the hub again`);
    try {
      if (r.cutAt !== undefined) {
        io.truncate(fd, r.cutAt); // so the next append starts on a clean line
        j.goodLength = r.cutAt;
      } else if (r.missingNewline) {
        io.write(fd, Buffer.from('\n'), 0, 1, r.size); // a complete last line that only lacks its newline
        j.goodLength = r.size + 1;
      }
      if (r.cutAt !== undefined || r.missingNewline) io.sync(fd);
    } catch (e) {
      try {
        io.close(fd);
      } catch {
        // see above
      }
      j.fd = undefined;
      throw e;
    }
    return j;
  }

  /**
   * True while the file this journal holds open is still the file at the journal's path: the same device and file number
   * (read as big integers). A path that is gone, or now names another file, fails. Nothing is ever written to a file that
   * has lost its name.
   */
  look(statPath: (path: string) => { dev: bigint; ino: bigint } = (p) => this.io.statPath(p)): JournalLook {
    if (this.fd === undefined) return { state: 'gone' };
    const codeOf = (e: unknown): string => {
      const c = (e as NodeJS.ErrnoException | undefined)?.code;
      return typeof c === 'string' ? c : 'error';
    };
    let held: { dev: bigint; ino: bigint };
    try {
      held = fstatSync(this.fd, { bigint: true });
    } catch (e) {
      return { state: 'cannot', code: codeOf(e) };
    }
    let named: { dev: bigint; ino: bigint };
    try {
      named = statPath(this.file);
    } catch (e) {
      const code = codeOf(e);
      return code === 'ENOENT' || code === 'ENOTDIR' ? { state: 'gone' } : { state: 'cannot', code };
    }
    // The device half of this comparison has no test: two devices cannot be made in a test, and on one volume a different device
    // with the same file number does not occur, so dropping it changes nothing here. It is kept because a path may cross volumes.
    return held.dev === named.dev && held.ino === named.ino ? { state: 'same' } : { state: 'gone' };
  }

  /** True only when the look says the journal is the same file. */
  sameFile(): boolean {
    return this.look().state === 'same';
  }

  /** True when a write failed and the file could not be cut back: nothing more may be appended. */
  get unavailable(): boolean {
    return this.broken;
  }

  /** The bytes of the line for these records. All the work that grows with the post is done here, before the look at the lock. */
  line(records: unknown[]): Buffer {
    return Buffer.from(`${JSON.stringify(records)}\n`, 'utf8');
  }

  /**
   * Writes one line (built by line()) and returns only when all of it is written and on the disk (fsync).
   *
   * Before the first write call two things are checked, in this order, and if either fails NOTHING is written and the file is NOT cut
   * back (the bytes in it may be another hub's answered lines): the size of the file the journal holds open, read from its own
   * descriptor, must equal the length this journal remembers (otherwise another writer has added to it or cut it, and the journal
   * becomes unavailable until a restart); and `look` must say the lock is still this hub's own. The write call follows the look with
   * nothing between them but the start of the loop (no hashing, no JSON, no allocation).
   *
   * When a write of the line itself fails part-way the file is cut back to its last good length; if that fails too the journal is
   * unavailable until a restart.
   */
  commit(buf: Buffer, look: () => WriteLook): void {
    if (this.fd === undefined) throw new JournalError('journal is closed');
    if (this.broken) throw new JournalError('journal is unavailable');
    const fd = this.fd;
    if (this.io.size(fd) !== this.goodLength) {
      this.broken = true;
      throw new JournalNotWritten('the journal file is not the length this hub left it');
    }
    const seen = look();
    if (seen.state !== 'ok') throw new JournalNotWritten('the journal or its lock could not be confirmed as this hub\'s', seen);
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
    const fd = this.fd;
    if (fd === undefined) return;
    // forgotten BEFORE the close is called: a close that fails is never tried again on a number that may by now be another file's
    this.fd = undefined;
    try {
      fsyncSync(fd);
    } catch {
      // a journal that could not be cut back may fail here too; closing must still release the file
    }
    this.io.close(fd);
  }
}
