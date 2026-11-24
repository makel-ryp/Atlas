import { parseRoundFile, UnknownLayoutError, type ShotRecord } from '../../core/src/index.js';
import { createFiles, type Files } from './files.js';
import { CollectorError, Outbox } from './outbox.js';

export { CollectorError } from './outbox.js';

/** What the server answered. A network failure or a timeout is a thrown error, never a result. */
export interface PostResult {
  status: number;
  body?: unknown;
}

export type PostFn = (url: string, body: string) => Promise<PostResult>;

export interface Timer {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface CollectorOptions {
  /** GSPro's round file. Only ever read. */
  gsproFile: string;
  /** The collector's own folder: the copy, the outbox, the record of what was sent, the refused file. */
  dataDir: string;
  /** Must be http://127.0.0.1:<port> or http://localhost:<port>. */
  hubUrl: string;
  /** For tests. Default: the real file module for the two paths above. */
  files?: Files;
  /** For tests. Default: fetch with a 10 second timeout. */
  post?: PostFn;
  /** For tests. Default Date.now. */
  now?: () => number;
  /** For tests. Default the global timers. */
  timer?: Timer;
  /** How often start() looks at the file. Default 500. */
  pollMs?: number;
  /** Called with the counts and states whenever they change. Never carries anything from the file. */
  onStatus?: (status: Status) => void;
  /** Called when a timer pass hits a problem with the collector's own files (message is plain). */
  onError?: (error: CollectorError) => void;
}

export type FileState = 'starting' | 'waiting' | 'ok' | 'retrying' | 'broken' | 'layout_unknown';
export type ServerState = 'unknown' | 'up' | 'down';

export interface Status {
  /** Copies of GSPro's file read and understood since start. */
  copiesRead: number;
  /** Records ever queued, including earlier runs. */
  queued: number;
  sent: number;
  refused: number;
  pending: number;
  server: ServerState;
  /** waiting: no file yet. retrying: a copy could not be read, tried again each pass. broken: that has gone on 10 seconds. layout_unknown: read, but not a layout this program knows. */
  file: FileState;
  /** error when the last pass could not write one of the collector's own files. */
  store: 'ok' | 'error';
  /** The wait before the next try to reach the server, in ms; 0 when the last try worked. */
  retryDelayMs: number;
}

export interface Collector {
  start(): void;
  stop(): Promise<void>;
  /** One pass: look at the file, queue new records, try to send what is waiting. */
  tick(): Promise<void>;
  status(): Status;
}

export const BROKEN_AFTER_MS = 10_000;
export const MAX_RETRY_MS = 30_000;
const FIRST_RETRY_MS = 1_000;
const BATCH_RECORDS = 200;
const POST_TIMEOUT_MS = 10_000;

/** Checks the server address and returns it in one fixed form. Nothing but this PC is allowed in this card. */
export function checkHubUrl(raw: string): string {
  const refuse = (): never => {
    throw new CollectorError('SIM_HUB_URL must be http://127.0.0.1:<port> or http://localhost:<port>. For now this program sends only to this PC.');
  };
  let u: URL | undefined;
  try {
    u = new URL(raw);
  } catch {
    return refuse();
  }
  if (
    u.protocol !== 'http:' ||
    (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') ||
    u.port === '' ||
    u.username !== '' ||
    u.password !== '' ||
    u.pathname !== '/' ||
    u.search !== '' ||
    u.hash !== ''
  ) {
    return refuse();
  }
  return `http://${u.hostname}:${u.port}`;
}

export async function defaultPost(url: string, body: string): Promise<PostResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed };
}

/** One line of counts and states. Nothing from the file. */
export function statusLine(s: Status): string {
  return `copies=${s.copiesRead} queued=${s.queued} sent=${s.sent} refused=${s.refused} pending=${s.pending} server=${s.server} file=${s.file}${s.store === 'error' ? ' disk=error' : ''}`;
}

/** Builds the collector. It refuses a bad server address here, before any file is touched. */
export function createCollector(options: CollectorOptions): Collector {
  const base = checkHubUrl(options.hubUrl);
  const files = options.files ?? createFiles(options.dataDir, options.gsproFile);
  const post = options.post ?? defaultPost;
  const now = options.now ?? Date.now;
  const timer: Timer = options.timer ?? { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h) };
  const pollMs = options.pollMs ?? 500;
  const outbox = new Outbox(files);

  let loaded = false;
  let handle: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;

  let copiesRead = 0;
  let fileState: FileState = 'starting';
  let server: ServerState = 'unknown';
  let store: 'ok' | 'error' = 'ok';
  let lastStat: { size: number; mtimeMs: number } | undefined;
  let failureSince: number | undefined;
  let failures = 0;
  let retryDelayMs = 0;
  let nextAttemptAt = 0;
  let lastEmitted = '';

  function status(): Status {
    return { copiesRead, queued: outbox.queued, sent: outbox.sent, refused: outbox.refused, pending: outbox.pending, server, file: fileState, store, retryDelayMs };
  }

  function emit(): void {
    if (!options.onStatus) return;
    const s = status();
    const key = JSON.stringify(s);
    if (key === lastEmitted) return;
    lastEmitted = key;
    options.onStatus(s);
  }

  function ensureLoaded(): void {
    if (loaded) return;
    outbox.load();
    loaded = true;
  }

  function backoff(): void {
    failures++;
    retryDelayMs = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1));
    nextAttemptAt = now() + retryDelayMs;
  }

  function copyProblem(): void {
    failureSince ??= now();
    fileState = now() - failureSince >= BROKEN_AFTER_MS ? 'broken' : 'retrying';
  }

  /** Looks at GSPro's file. Returns false when the collector's own files could not be written. */
  function readStage(): boolean {
    let st: { size: number; mtimeMs: number } | undefined;
    try {
      st = files.statSource();
    } catch {
      copyProblem();
      return true;
    }
    if (st === undefined) {
      fileState = 'waiting';
      lastStat = undefined;
      failureSince = undefined;
      return true;
    }
    if (lastStat !== undefined && lastStat.size === st.size && lastStat.mtimeMs === st.mtimeMs) return true;

    let text: string;
    try {
      files.copySource();
      text = files.readCopy();
    } catch {
      copyProblem();
      return true;
    }

    let records: ShotRecord[] = [];
    const body = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
    if (body !== '') {
      try {
        JSON.parse(body);
      } catch {
        // Not complete JSON: GSPro was in the middle of writing. Try again on the next pass.
        copyProblem();
        return true;
      }
      try {
        records = parseRoundFile(text);
      } catch (e) {
        if (!(e instanceof UnknownLayoutError)) throw e;
        // A layout this program does not know. Send nothing from this copy, keep what is queued, never guess.
        fileState = 'layout_unknown';
        failureSince = undefined;
        lastStat = st;
        return true;
      }
    }

    try {
      outbox.queue(records);
    } catch {
      // Could not write the outbox. Nothing was counted; the same copy is read again on the next pass.
      return false;
    }
    copiesRead++;
    fileState = 'ok';
    failureSince = undefined;
    lastStat = st;
    return true;
  }

  /** Sends what is waiting, in order. Returns false when the collector's own files could not be written. */
  async function flushStage(): Promise<boolean> {
    while (outbox.pending > 0) {
      if (now() < nextAttemptAt) return true;
      const batch = outbox.batch(BATCH_RECORDS);
      let res: PostResult;
      try {
        res = await post(`${base}/v0/shots`, JSON.stringify({ records: batch }));
      } catch {
        server = 'down';
        backoff();
        return true;
      }
      if (res.status === 200) {
        server = 'up';
        try {
          outbox.markSent(batch.length);
        } catch {
          backoff();
          return false;
        }
        failures = 0;
        retryDelayMs = 0;
        nextAttemptAt = 0;
      } else if (res.status === 400 || res.status === 413) {
        // The server will never take this batch. Keep it in the refused file and move on.
        server = 'up';
        try {
          outbox.markRefused(batch.length, res.status, now());
        } catch {
          backoff();
          return false;
        }
        failures = 0;
        retryDelayMs = 0;
        nextAttemptAt = 0;
      } else {
        server = 'down';
        backoff();
        return true;
      }
    }
    return true;
  }

  async function pass(): Promise<void> {
    try {
      ensureLoaded();
      const readOk = readStage();
      const sendOk = await flushStage();
      store = readOk && sendOk ? 'ok' : 'error';
    } finally {
      emit();
    }
  }

  function tick(): Promise<void> {
    if (running) return running;
    running = pass().finally(() => {
      running = undefined;
    });
    return running;
  }

  return {
    start() {
      if (handle !== undefined) return;
      ensureLoaded();
      emit();
      handle = timer.setInterval(() => {
        tick().catch((e: unknown) => {
          if (e instanceof CollectorError) options.onError?.(e);
        });
      }, pollMs);
    },
    async stop() {
      if (handle !== undefined) {
        timer.clearInterval(handle);
        handle = undefined;
      }
      if (running) await running.catch(() => undefined);
    },
    tick,
    status,
  };
}
