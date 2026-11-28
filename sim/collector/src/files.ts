import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The only module that touches the disk. It is built for one GSPro file and one data folder.
 *
 * GSPro's file has exactly two operations here: `statSource` and `copySource`. `copySource` opens it for reading
 * only, reads it to the end into memory, closes it at once, and then writes the bytes into the data folder. There
 * is no method that takes GSPro's path, so no write, rename, move, truncate or delete of it can be asked for.
 * Every other method works on a bare file name inside the data folder.
 */
export interface Files {
  /** Size and modified time of GSPro's file, or undefined when it does not exist. */
  statSource(): { size: number; mtimeMs: number } | undefined;
  /** Reads GSPro's file (read only, closed at once) and saves what it held as `copy.dat` in the data folder. */
  copySource(): void;
  /** The text of the copy made by the last `copySource`. */
  readCopy(): string;
  ensureDataDir(): void;
  /** Text of a (small) file in the data folder, or undefined when it does not exist. */
  readData(name: string): string | undefined;
  /**
   * Reads a file in the data folder line by line, in pieces of `pieceBytes`, never as one string or one buffer.
   * Calls `onLine` for every line that ends with a newline. `validBytes` is the size of those lines (newlines
   * included); `tornBytes` is what follows the last newline (a line cut short). A missing file reads as empty.
   */
  readLines(name: string, pieceBytes: number, onLine: (line: string) => void): { validBytes: number; tornBytes: number };
  /** Rewrites a file in the data folder to hold only its first `bytes` bytes (temporary file, then rename). */
  keepPrefix(name: string, bytes: number): void;
  /** Appends to a file in the data folder, creating it. */
  appendData(name: string, text: string): void;
  /** Appends and forces the bytes onto the disk before returning. */
  appendDurable(name: string, text: string): void;
  /** Writes a file in the data folder to a temporary name, forces it onto the disk, then renames it over the real one. */
  writeData(name: string, text: string): void;
}

const COPY_NAME = 'copy.dat';
const READ_CHUNK = 1024 * 1024;

function bare(name: string): string {
  if (name === '' || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('not a bare file name');
  return name;
}

function isMissing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function createFiles(dataDir: string, gsproFile: string): Files {
  return {
    statSource() {
      try {
        const s = statSync(gsproFile);
        return { size: s.size, mtimeMs: s.mtimeMs };
      } catch (e) {
        if (isMissing(e)) return undefined;
        throw e;
      }
    },
    copySource() {
      // Read only, shared with the writer, closed at once: GSPro's file is open for as short a time as possible.
      const chunks: Buffer[] = [];
      const fd = openSync(gsproFile, 'r');
      try {
        const buf = Buffer.allocUnsafe(READ_CHUNK);
        for (;;) {
          const n = readSync(fd, buf, 0, buf.length, null);
          if (n === 0) break;
          chunks.push(Buffer.from(buf.subarray(0, n)));
        }
      } finally {
        closeSync(fd);
      }
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, COPY_NAME), Buffer.concat(chunks));
    },
    readCopy() {
      return readFileSync(join(dataDir, COPY_NAME), 'utf8');
    },
    ensureDataDir() {
      mkdirSync(dataDir, { recursive: true });
    },
    readData(name) {
      try {
        return readFileSync(join(dataDir, bare(name)), 'utf8');
      } catch (e) {
        if (isMissing(e)) return undefined;
        throw e;
      }
    },
    readLines(name, pieceBytes, onLine) {
      let fd: number;
      try {
        fd = openSync(join(dataDir, bare(name)), 'r');
      } catch (e) {
        if (isMissing(e)) return { validBytes: 0, tornBytes: 0 };
        throw e;
      }
      try {
        const buf = Buffer.allocUnsafe(Math.max(1, pieceBytes));
        let carry: Buffer = Buffer.alloc(0);
        let valid = 0;
        for (;;) {
          const n = readSync(fd, buf, 0, buf.length, null);
          if (n === 0) break;
          const data = carry.length > 0 ? Buffer.concat([carry, buf.subarray(0, n)]) : Buffer.from(buf.subarray(0, n));
          let start = 0;
          for (let i = data.indexOf(10, start); i !== -1; i = data.indexOf(10, start)) {
            onLine(data.toString('utf8', start, i));
            valid += i - start + 1;
            start = i + 1;
          }
          carry = Buffer.from(data.subarray(start));
        }
        return { validBytes: valid, tornBytes: carry.length };
      } finally {
        closeSync(fd);
      }
    },
    keepPrefix(name, bytes) {
      const target = join(dataDir, bare(name));
      const temp = `${target}.tmp`;
      const src = openSync(target, 'r');
      const dst = openSync(temp, 'w');
      try {
        const buf = Buffer.allocUnsafe(READ_CHUNK);
        let left = bytes;
        while (left > 0) {
          const n = readSync(src, buf, 0, Math.min(buf.length, left), null);
          if (n === 0) break;
          writeSync(dst, buf, 0, n);
          left -= n;
        }
        fsyncSync(dst);
      } finally {
        closeSync(src);
        closeSync(dst);
      }
      renameSync(temp, target);
    },
    appendData(name, text) {
      appendFileSync(join(dataDir, bare(name)), text);
    },
    appendDurable(name, text) {
      const fd = openSync(join(dataDir, bare(name)), 'a');
      try {
        writeSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    writeData(name, text) {
      const target = join(dataDir, bare(name));
      const temp = `${target}.tmp`;
      const fd = openSync(temp, 'w');
      try {
        writeSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, target);
    },
  };
}
