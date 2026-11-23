import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_TEXT_CHARS, RoundBook, formatScorecard, loadRecording, parseRoundFile } from '../core/src/index.js';

// Reads files and prints. No network, no file written.
const arg = process.argv[2];
const book = new RoundBook();

/** The file as text, or undefined after one plain line naming only the file's base name (exit code 1). */
function readRoundFile(path: string): string | undefined {
  const name = basename(path);
  try {
    // the size is checked before the file is read
    if (statSync(path).size > MAX_TEXT_CHARS) {
      console.error(`Cannot read ${name}: the file is larger than ${MAX_TEXT_CHARS} bytes`);
      process.exitCode = 1;
      return undefined;
    }
    return readFileSync(path, 'utf8');
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    console.error(`Cannot read ${name}${typeof code === 'string' ? ` (${code})` : ''}`);
    process.exitCode = 1;
    return undefined;
  }
}

try {
  if (arg === undefined) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/gspro-4.1.13/2026-11-23');
    for (const copy of loadRecording(dir)) book.ingest(copy.records);
    console.log(formatScorecard(book));
  } else {
    const text = readRoundFile(arg);
    if (text !== undefined) {
      book.ingest(parseRoundFile(text));
      console.log(formatScorecard(book));
    }
  }
} catch (e) {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  process.exitCode = 1;
}
