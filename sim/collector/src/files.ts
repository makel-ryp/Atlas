import { appendFileSync, copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The only module that touches the disk. It is built for one GSPro file and one data folder.
 *
 * GSPro's file has exactly two operations here: `statSource` and `copySource` (which opens it for reading and
 * writes the copy into the data folder). There is no method that takes GSPro's path, so no write, rename, move,
 * truncate or delete of it can be asked for. Every other method works on a bare file name inside the data folder.
 */
export interface Files {
  /** Size and modified time of GSPro's file, or undefined when it does not exist. */
  statSource(): { size: number; mtimeMs: number } | undefined;
  /** Copies GSPro's file into the data folder as `copy.dat` (read only on GSPro's side). */
  copySource(): void;
  /** The text of the copy made by the last `copySource`. */
  readCopy(): string;
  ensureDataDir(): void;
  /** Text of a file in the data folder, or undefined when it does not exist. */
  readData(name: string): string | undefined;
  /** Appends to a file in the data folder, creating it. */
  appendData(name: string, text: string): void;
  /** Writes a file in the data folder to a temporary name, then renames it over the real one. */
  writeData(name: string, text: string): void;
}

const COPY_NAME = 'copy.dat';

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
      mkdirSync(dataDir, { recursive: true });
      copyFileSync(gsproFile, join(dataDir, COPY_NAME));
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
    appendData(name, text) {
      appendFileSync(join(dataDir, bare(name)), text);
    },
    writeData(name, text) {
      const target = join(dataDir, bare(name));
      const temp = `${target}.tmp`;
      writeFileSync(temp, text);
      renameSync(temp, target);
    },
  };
}
