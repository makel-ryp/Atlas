import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoundBook, formatScorecard, loadRecording, parseRoundFile } from '../core/src/index.js';

// Reads files and prints. No network, no file written.
const arg = process.argv[2];
const book = new RoundBook();
try {
  if (arg === undefined) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/gspro-4.1.13/2026-11-23');
    for (const copy of loadRecording(dir)) book.ingest(copy.records);
  } else {
    book.ingest(parseRoundFile(readFileSync(arg, 'utf8')));
  }
  console.log(formatScorecard(book));
} catch (e) {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  process.exitCode = 1;
}
