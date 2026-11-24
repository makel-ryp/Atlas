import { basename } from 'node:path';
import { RoundBook, type BookIssue } from './book.js';
import { formatScorecard } from './format.js';
import { parseRoundFile } from './parse.js';
import { loadRecording } from './recording.js';
import { cleanText } from './text.js';

/** The most bytes the command reads from one file. (The parser's own limit is a count of characters and stays as it is.) */
const MAX_FILE_BYTES = 50_000_000;

/** One opened file. Every call goes to the same handle, so a file replaced after the open is never what is asked about. */
export interface OpenFile {
  /** The size in bytes of the file as opened. */
  size(): number;
  /** At most `maxBytes` bytes from the start of the same file. */
  read(maxBytes: number): Uint8Array;
  close(): void;
}

/** The one thing the command asks of the file system, so a test can watch what is read. */
export interface FileAccess {
  open(path: string): OpenFile;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** One line: how many issues and how many of each kind. Fixed words only; no id or other file text. */
export function issuesLine(issues: readonly BookIssue[], refused?: number): string | undefined {
  if (issues.length === 0) return undefined;
  const byKind = new Map<string, number>();
  for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const parts = [...byKind.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k} ${n}`);
  return `Issues: ${issues.length} (${parts.join(', ')})${refused === undefined ? '' : `; records refused: ${refused}`}`;
}

/** Reads one file (or replays the recording when there is no path) and returns what to print. Writes and prints nothing itself. */
export function runScorecard(arg: string | undefined, files: FileAccess, recordingDir: string): CommandResult {
  const book = new RoundBook();
  let refused = 0; // conflicts over every read made
  try {
    if (arg === undefined) {
      for (const copy of loadRecording(recordingDir)) refused += book.ingest(copy.records).conflicts;
    } else {
      // the file name is text from outside: cleaned before it enters any message
      const name = cleanText(basename(arg));
      const tooLarge = { stdout: '', stderr: `Cannot read ${name}: the file is larger than ${MAX_FILE_BYTES} bytes`, exitCode: 1 };
      let text: string;
      let file: OpenFile | undefined;
      try {
        // one open: the size and the bytes both come from this handle
        file = files.open(arg);
        if (file.size() > MAX_FILE_BYTES) return tooLarge;
        // never more than the limit plus one byte; one byte over means the file is over, whatever size() said
        const bytes = file.read(MAX_FILE_BYTES + 1);
        if (bytes.byteLength > MAX_FILE_BYTES) return tooLarge;
        // the same decoding as readFileSync(path, 'utf8')
        text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        return { stdout: '', stderr: `Cannot read ${name}${typeof code === 'string' ? ` (${code})` : ''}`, exitCode: 1 };
      } finally {
        try {
          file?.close();
        } catch {
          // the file was only read; a failing close changes nothing that was printed
        }
      }
      refused += book.ingest(parseRoundFile(text)).conflicts;
    }
    const extra = issuesLine(book.issues(), refused);
    return { stdout: extra === undefined ? formatScorecard(book) : `${formatScorecard(book)}\n${extra}`, stderr: '', exitCode: 0 };
  } catch (e) {
    return { stdout: '', stderr: e instanceof Error ? `${e.name}: ${e.message}` : String(e), exitCode: 1 };
  }
}
