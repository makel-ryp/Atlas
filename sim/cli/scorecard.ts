import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScorecard } from '../core/src/command.js';

// Reads files and prints. No network, no file written. The work is in core/src/command.ts.
const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/gspro-4.1.13/2026-11-23');
const res = runScorecard(
  process.argv[2],
  {
    open(path) {
      const fd = openSync(path, 'r');
      return {
        size: () => fstatSync(fd).size,
        // at most maxBytes from the start of the opened file, in chunks, so a small file never allocates the limit
        read(maxBytes) {
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
        close: () => closeSync(fd),
      };
    },
  },
  dir,
);
if (res.stdout !== '') console.log(res.stdout);
if (res.stderr !== '') console.error(res.stderr);
process.exitCode = res.exitCode;
