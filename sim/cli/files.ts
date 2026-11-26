import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { FileAccess } from '../core/src/command.js';

/** The real file system for the command: one open, then size and bytes from that handle. */
export const nodeFiles: FileAccess = {
  open(path) {
    const fd = openSync(path, 'r');
    // each handle has its own flag: once closed, the descriptor number may belong to another file
    let closed = false;
    const live = (): void => {
      if (closed) throw new Error('this file handle is closed');
    };
    return {
      size() {
        live();
        return fstatSync(fd).size;
      },
      // at most maxBytes from the start of the opened file, in chunks, so a small file never allocates the limit
      read(maxBytes) {
        live();
        const chunks: Buffer[] = [];
        let total = 0;
        while (total < maxBytes) {
          const chunk = Buffer.allocUnsafe(Math.min(1 << 20, maxBytes - total));
          const n = readSync(fd, chunk, 0, chunk.length, total);
          if (n === 0) break;
          chunks.push(chunk.subarray(0, n));
          total += n;
        }
        return Buffer.concat(chunks, total);
      },
      close() {
        if (closed) return;
        // set before closeSync: a close that fails is never tried again on a number that may be another file's
        closed = true;
        closeSync(fd);
      },
    };
  },
};
