import { parseRoundFile, UnknownLayoutError, type ShotRecord } from '../../core/src/index.js';
import { createFiles, type Files } from './files.js';
import { CollectorError, Outbox, DEFAULT_PIECE_BYTES } from './outbox.js';

export { CollectorError } from './outbox.js';

/** What the server answered. A network failure or a timeout is a thrown error, never a result. */
export interface PostResult {
  status: number;
  body?: unknown;
  /** The Retry-After header, when it is a whole number of seconds. */
  retryAfterSec?: number;
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
  /** For tests. Default: fetch with a 10 second timeout, behind a gate that refuses a second post while one is unanswered. A post handed in is not gated; the program's own sender is. */
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
  /** Called for the two events worth a line of their own. Carries nothing from the file. */
  onEvent?: (event: CollectorEvent) => void;
  /** The outbox is tidied to short lines when nothing waits and it is larger than this. Default 1 MB. */
  tidyOverBytes?: number;
  /** The outbox is read at start in pieces of this many bytes. Default 64 KB. */
  pieceBytes?: number;
}

/** not-found: the round file has not been seen for 30 seconds. dropped-line: a cut-short last outbox line was dropped at start. */
export type CollectorEvent = 'not-found' | 'dropped-line';

export type FileState = 'starting' | 'waiting' | 'not-found' | 'ok' | 'retrying' | 'broken' | 'layout_unknown';
/** up: answered well. down: no answer. redirect: a 3xx (never followed). unexpected: a 200 that is not the hub's counts. busy: 503. refusing-N: any other answer. */
export type ServerState = 'unknown' | 'up' | 'down' | 'redirect' | 'unexpected' | 'busy' | `refusing-${number}`;

export interface Status {
  /** Copies of GSPro's file read and understood since start. */
  copiesRead: number;
  /** Records ever queued, including earlier runs. */
  queued: number;
  sent: number;
  refused: number;
  pending: number;
  server: ServerState;
  /** waiting: no file yet. not-found: none seen for 30 seconds. retrying: a copy could not be read, tried again each pass. broken: that has gone on 10 seconds. layout_unknown: read, but not a layout this program knows. */
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
export const NOT_FOUND_AFTER_MS = 30_000;
const DEFAULT_TIDY_BYTES = 1_000_000;

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
    // A redirect is never followed: the batch goes to the checked address and nowhere else.
    redirect: 'manual',
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  const ra = res.headers.get('retry-after');
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed, retryAfterSec: ra !== null && /^\d+$/.test(ra) ? Number(ra) : undefined };
}

/**
 * The program's own sender, behind a gate: one post at a time. A call made while one is unanswered is refused at once
 * (it rejects, holding nothing from GSPro's file, and the wrapped post is not called); an answer, a rejection or a throw
 * releases the gate.
 */
export function oneAtATime(send: PostFn): PostFn {
  let busy = false;
  return async (url, body) => {
    if (busy) throw new Error('a post is already out; this one was not sent');
    busy = true;
    try {
      return await send(url, body);
    } finally {
      busy = false;
    }
  };
}

/** True only for the hub's own answer: its four counts, whole numbers of zero or more, adding up to the batch. */
export function countsAddUp(body: unknown, batchSize: number): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  let sum = 0;
  for (const key of ['added', 'revised', 'unchanged', 'conflicts']) {
    const v = b[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return false;
    sum += v;
  }
  return sum === batchSize;
}

/** One line of counts and states. Nothing from the file. */
export function statusLine(s: Status): string {
  return `copies=${s.copiesRead} queued=${s.queued} sent=${s.sent} refused=${s.refused} pending=${s.pending} server=${s.server} file=${s.file}${s.store === 'error' ? ' disk=error' : ''}`;
}

/** Builds the collector. It refuses a bad server address here, before any file is touched. */
export function createCollector(options: CollectorOptions): Collector {
  const base = checkHubUrl(options.hubUrl);
  const files = options.files ?? createFiles(options.dataDir, options.gsproFile);
  const post = options.post ?? oneAtATime(defaultPost);
  const now = options.now ?? Date.now;
  const timer: Timer = options.timer ?? { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h) };
  const pollMs = options.pollMs ?? 500;
  const outbox = new Outbox(files, options.pieceBytes ?? DEFAULT_PIECE_BYTES);
  const tidyOver = options.tidyOverBytes ?? DEFAULT_TIDY_BYTES;

  let loaded = false;
  let handle: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;

  let copiesRead = 0;
  let fileState: FileState = 'starting';
  let server: ServerState = 'unknown';
  let store: 'ok' | 'error' = 'ok';
  let lastStat: { size: number; mtimeMs: number } | undefined;
  let failureSince: number | undefined;
  let lastSeenAt: number | undefined;
  let lastCopy: ShotRecord[] | undefined;
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
    const { droppedLine } = outbox.load();
    loaded = true;
    if (droppedLine) options.onEvent?.('dropped-line');
  }

  function backoff(retryAfterSec?: number): void {
    failures++;
    const own = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1));
    // The server's own Retry-After is honoured, never beyond the ceiling.
    retryDelayMs = Math.min(MAX_RETRY_MS, Math.max(own, (retryAfterSec ?? 0) * 1000));
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
    lastSeenAt ??= now();
    if (st === undefined) {
      lastStat = undefined;
      failureSince = undefined;
      if (now() - lastSeenAt >= NOT_FOUND_AFTER_MS) {
        if (fileState !== 'not-found') {
          fileState = 'not-found';
          options.onEvent?.('not-found');
        }
      } else {
        fileState = 'waiting';
      }
      return true;
    }
    lastSeenAt = now();
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
    lastCopy = records;
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
      if (res.status === 200 && countsAddUp(res.body, batch.length)) {
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
        // Nothing is marked: a redirect (never followed), a 200 that is not the hub's own answer, or any other answer.
        server = res.status === 200 ? 'unexpected' : res.status >= 300 && res.status < 400 ? 'redirect' : res.status === 503 ? 'busy' : `refusing-${res.status}`;
        backoff(res.retryAfterSec);
        return true;
      }
    }
    return true;
  }

  async function pass(): Promise<void> {
    try {
      ensureLoaded();
      lastCopy = undefined;
      const readOk = readStage();
      const sendOk = await flushStage();
      let tidyOk = true;
      if (lastCopy !== undefined && outbox.needsTidy(tidyOver)) {
        try {
          outbox.tidy(lastCopy);
        } catch {
          tidyOk = false;
        }
      }
      store = readOk && sendOk && tidyOk ? 'ok' : 'error';
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
