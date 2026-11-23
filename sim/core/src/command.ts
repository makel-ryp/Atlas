import { basename } from 'node:path';
import { RoundBook, type BookIssue } from './book.js';
import { formatScorecard } from './format.js';
import { MAX_TEXT_CHARS, parseRoundFile } from './parse.js';
import { loadRecording } from './recording.js';

/** The two things the command asks of the file system, so a test can watch what is read. */
export interface FileAccess {
  size(path: string): number;
  read(path: string): string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** One line: how many issues and how many of each kind. Fixed words only; no id or other file text. */
export function issuesLine(issues: readonly BookIssue[]): string | undefined {
  if (issues.length === 0) return undefined;
  const byKind = new Map<string, number>();
  for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const parts = [...byKind.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k} ${n}`);
  return `Issues: ${issues.length} (${parts.join(', ')})`;
}

/** Reads one file (or replays the recording when there is no path) and returns what to print. Writes and prints nothing itself. */
export function runScorecard(arg: string | undefined, files: FileAccess, recordingDir: string): CommandResult {
  const book = new RoundBook();
  try {
    if (arg === undefined) {
      for (const copy of loadRecording(recordingDir)) book.ingest(copy.records);
    } else {
      const name = basename(arg);
      let text: string;
      try {
        // the size is checked before the file is read
        if (files.size(arg) > MAX_TEXT_CHARS) {
          return { stdout: '', stderr: `Cannot read ${name}: the file is larger than ${MAX_TEXT_CHARS} bytes`, exitCode: 1 };
        }
        text = files.read(arg);
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        return { stdout: '', stderr: `Cannot read ${name}${typeof code === 'string' ? ` (${code})` : ''}`, exitCode: 1 };
      }
      book.ingest(parseRoundFile(text));
    }
    const extra = issuesLine(book.issues());
    return { stdout: extra === undefined ? formatScorecard(book) : `${formatScorecard(book)}\n${extra}`, stderr: '', exitCode: 0 };
  } catch (e) {
    return { stdout: '', stderr: e instanceof Error ? `${e.name}: ${e.message}` : String(e), exitCode: 1 };
  }
}
