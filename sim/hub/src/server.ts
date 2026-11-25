import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { RoundBook, UnknownLayoutError, validateRecord, MAX_RECORDS, type IngestCounts, type ShotRecord } from '../../core/src/index.js';
import { Journal, JournalError, JournalNotWritten, replayFile, type WriteLook, JOURNAL_NAME, MAX_LINE_BYTES, type JournalOptions } from './journal.js';
import { takeLock, type HeldLock } from './lock.js';

export const HOST = '127.0.0.1';
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Posts being read or waiting for their turn at once. A fifth is refused with 503 busy. */
export const MAX_ACTIVE_POSTS = 4;

export interface HubOptions {
  /** Folder that holds the journal. Created when missing. */
  dataDir: string;
  /** 0 picks a free port. Default 5077. */
  port?: number;
  /** For tests. Default 32 MB. */
  maxBodyBytes?: number;
  /** Where status lines go (counts and codes only). Default console.log. */
  log?: (line: string) => void;
  /** Where warnings go. Default console.warn. */
  warn?: (line: string) => void;
  /** For tests: the journal's piece size and line limit, and a seam that makes a write fail part-way. */
  journal?: JournalOptions;
  /** How long a post may take to send its whole body, from its headers. Default 30 seconds; settable for tests. */
  bodyTimeoutMs?: number;
  /** Test hooks, never set outside the tests. Each runs at a fixed point of a post and lets a test change the world there. */
  hooks?: HubHooks;
  /** Test only, reachable only through a hand-built call: a replaceable read of the lock file for the hub's look at the lock. */
  lockRead?: (path: string) => string;
}

export interface HubHooks {
  /** After all of a post's work and the bytes of its line are ready, immediately before the look at the lock that guards the write. */
  beforeWriteLook?: () => void;
  /** After the table is updated, immediately before the last look and the answer. It is told how many ShotIDs the table holds. */
  beforeLastLook?: (tableSize: number) => void;
}

export interface Hub {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  /** The bound address, or undefined before listen() and after close(). */
  address(): { host: string; port: number } | undefined;
}

/** The only addresses, and the one method each takes. */
const ROUTES = new Map<string, string>([
  ['/v0/shots', 'POST'],
  ['/v0/rounds', 'GET'],
  ['/healthz', 'GET'],
]);

class BodyTooLarge extends Error {}
/** The body was not complete in time. */
class BodyTimeout extends Error {}
/** The client dropped the connection before its body ended. */
class ClientAborted extends Error {}

function fingerprint(record: ShotRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

/**
 * The table of what the book is KNOWN to hold: ShotID to the fingerprint of the record. After a post the library accepted:
 * with no conflicts every record of the post is now held (a ShotID given twice was equal both times, so the first stands);
 * with any conflict the hub cannot tell which records were refused, so every ShotID of the post is forgotten and will be
 * journaled in full next time.
 */
function updateTable(table: Map<string, string>, records: readonly ShotRecord[], counts: IngestCounts): void {
  if (counts.conflicts > 0) {
    for (const r of records) table.delete(r.ShotID);
    return;
  }
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.ShotID)) continue;
    seen.add(r.ShotID);
    table.set(r.ShotID, fingerprint(r));
  }
}

/** True for a Content-Type whose media type is application/json (parameters such as charset are allowed). */
function isJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return (contentType.split(';')[0] as string).trim().toLowerCase() === 'application/json';
}

/** Builds the hub. Nothing runs, opens or listens until listen() is called. */
export function createHub(options: HubOptions): Hub {
  const log = options.log ?? ((l: string) => console.log(l));
  const warn = options.warn ?? ((l: string) => console.warn(l));
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const wantedPort = options.port ?? 5077;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 30_000;

  let book = new RoundBook();
  let table = new Map<string, string>();
  let journal: Journal | undefined;
  let server: Server | undefined;
  let bound: { host: string; port: number } | undefined;
  // True when a journal write failed and the file could not be cut back: no more posts until a restart.
  let unavailable = false;
  let lostNoticeGiven = false;
  // true from a look that could not tell until a look that succeeds: the "could not read" line is printed once for each stretch
  let cannotStretch = false;
  // true when a rebuild failed: the hub then has no book it can stand behind
  let rebuildFailed = false;
  let lock: HeldLock | undefined;
  // True from the moment the port is bound until the journal has been replayed: every request answers 503 busy.
  let starting = false;
  const maxLine = options.journal?.maxLineBytes ?? MAX_LINE_BYTES;
  let activePosts = 0;
  // Everything that changes the book runs one at a time, in arrival order.
  let chain: Promise<unknown> = Promise.resolve();

  function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...extra });
    res.end(text);
  }

  /**
   * Answers at once without keeping the body. What is still arriving is thrown away; if it has not ended after a short
   * grace the connection is cut, so the client can read the answer first.
   */
  function refuseAndDrain(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    send(res, status, body, extra);
    req.resume();
    const timer = setTimeout(() => req.destroy(), 2000);
    timer.unref();
    const stop = (): void => clearTimeout(timer);
    req.once('end', stop);
    req.once('close', stop);
  }

  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) {
        reject(new BodyTooLarge());
        return;
      }
      const parts: Buffer[] = [];
      let size = 0;
      let ended = false;
      // the hub's own time limit on a body: a sender that dribbles cannot hold a slot for ever
      const timer = setTimeout(() => {
        cleanup();
        reject(new BodyTimeout());
      }, bodyTimeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        req.off('close', onClose);
      };
      const onData = (c: Buffer): void => {
        size += c.length;
        if (size > limit) {
          cleanup(); // stop reading
          reject(new BodyTooLarge());
          return;
        }
        parts.push(c);
      };
      const onEnd = (): void => {
        ended = true;
        cleanup();
        resolve(Buffer.concat(parts));
      };
      const onError = (e: Error): void => {
        cleanup();
        // a client that drops the connection mid-body makes the request fail with ECONNRESET ("aborted")
        reject((e as NodeJS.ErrnoException).code === 'ECONNRESET' ? new ClientAborted() : e);
      };
      const onClose = (): void => {
        if (ended) return;
        cleanup();
        reject(new ClientAborted());
      };
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('close', onClose);
    });
  }

  /** Takes a batch of records the way both a post and a replay do: into the book, and the table follows the counts. */
  function apply(into: RoundBook, intoTable: Map<string, string>, records: ShotRecord[]): IngestCounts {
    const counts = into.ingest(records);
    updateTable(intoTable, records, counts);
    return counts;
  }

  /** Rebuilds the book and the table from the file, so memory and file agree again. */
  function rebuild(): void {
    const fresh = new RoundBook();
    const freshTable = new Map<string, string>();
    replayFile(join(options.dataDir, JOURNAL_NAME), (records) => void apply(fresh, freshTable, records as ShotRecord[]), () => undefined, options.journal);
    book = fresh;
    table = freshTable;
  }

  /** The records of a post that the journal line holds. Runs before the library has checked them, so it trusts nothing. */
  function keptRecords(records: ShotRecord[]): ShotRecord[] {
    const idOf = (r: unknown): string | undefined => (typeof r === 'object' && r !== null && typeof (r as { ShotID?: unknown }).ShotID === 'string' ? (r as ShotRecord).ShotID : undefined);
    const times = new Map<string, number>();
    for (const r of records) {
      const id = idOf(r);
      if (id !== undefined) times.set(id, (times.get(id) ?? 0) + 1);
    }
    return records.filter((r) => {
      const id = idOf(r);
      return !(id !== undefined && times.get(id) === 1 && table.get(id) === fingerprint(r));
    });
  }

  /** True when the journal line for these records would be longer than the limit the start reads. */
  function lineTooLong(kept: ShotRecord[], limitBytes: number): boolean {
    try {
      return Buffer.byteLength(JSON.stringify(kept), 'utf8') > limitBytes;
    } catch {
      return false; // too deep to write out: the library refuses such a post
    }
  }

  /**
   * The journal this hub holds open is still the file at its path, and this hub's own lock is still its own. If either is gone the
   * hub must never write again: a line written now would go into a file that has lost its name, or over another hub's lines.
   * It is called in three places. At the top of acceptBatch it is only a cheap refusal before any work is spent. THE LOOK THAT
   * PROTECTS THE WRITE is the one passed to Journal.commit: it runs after all of the post's work and the line's bytes are ready,
   * immediately before the first write call. The LAST look, after the table is updated, decides whether the answer may be 200.
   */
  function look(): WriteLook {
    const j = (journal as Journal).look();
    if (j.state === 'gone') return { state: 'gone' };
    const l = (lock as HeldLock).look(options.lockRead);
    if (l.state === 'gone') return { state: 'gone' };
    if (j.state === 'cannot') return { state: 'cannot', what: 'journal', code: j.code };
    if (l.state === 'cannot') return { state: 'cannot', what: 'lock', code: l.code };
    return { state: 'ok' };
  }

  /** A look that could not tell: one plain line for each stretch of such looks. The hub is NOT lost. */
  function noteCannot(r: { what: 'lock' | 'journal'; code: string }, written: boolean): void {
    if (cannotStretch) return;
    cannotStretch = true;
    const what = r.what === 'lock' ? `read its own lock ${(lock as HeldLock).name}` : `look at its journal ${JOURNAL_NAME}`;
    warn(`this hub could not ${what} (${r.code}): another program may be holding the file; ${written ? 'this post was answered 500, its line is in the journal and the post can be sent again' : 'this post was not taken'}; the hub looks again at the next post`);
  }

  /** A look that succeeded ends the stretch. */
  function noteOk(): void {
    cannotStretch = false;
  }

  /** Rebuilds the book and the table from the file; if that cannot be done the hub has no book it can stand behind. */
  function tryRebuild(): void {
    try {
      rebuild();
    } catch {
      unavailable = true;
      rebuildFailed = true;
    }
  }

  const busy = (): { status: number; body: unknown; extra: Record<string, string> } => ({ status: 503, body: { error: 'busy' }, extra: { 'Retry-After': '1' } });

  /** From now on this hub takes no posts until it is restarted; one plain line says so, once. */
  function markLost(): void {
    unavailable = true;
    if (!lostNoticeGiven) {
      lostNoticeGiven = true;
      warn('the data folder, its journal or this hub\'s lock was removed or replaced while the hub was running: this hub takes no more shots; restart it');
    }
  }

  /** Runs in the queue. The library's ingest and the journal write have no await between them. */
  function acceptBatch(records: ShotRecord[]): { status: number; body: unknown; extra?: Record<string, string> } {
    if (unavailable) return { status: 503, body: { error: 'journal_unavailable' } };
    // a cheap refusal before any work is spent; it does NOT protect the write (the post's work takes as long as the post is big)
    const first = look();
    if (first.state === 'gone') {
      markLost();
      return { status: 503, body: { error: 'journal_unavailable' } };
    }
    if (first.state === 'cannot') {
      // nothing was done and nothing is written; the hub is not lost, the bay program sends the post again
      noteCannot(first, false);
      return busy();
    }
    noteOk();
    // A record is left out of the journal only when its ShotID appears once in this post and the book is known to hold
    // exactly it: the library would count it unchanged and change nothing, so a replay cannot differ without it.
    // The line this post would write is known now, from the post and the table alone, and it is measured before the
    // library sees the post: the hub never writes a line it would refuse to read at the next start.
    // The library judges the post first: a record it would refuse is a 400, as it always was, and only a record it accepts
    // as a layout is fingerprinted and measured (JSON.stringify of a record nested too deep would throw here).
    if (records.length > MAX_RECORDS) return { status: 400, body: { error: 'unknown_layout' } };
    for (let i = 0; i < records.length; i++) {
      try {
        validateRecord(records[i], `record ${i}`);
      } catch (e) {
        if (e instanceof UnknownLayoutError) return { status: 400, body: { error: 'unknown_layout' } };
        throw e;
      }
    }
    const kept = keptRecords(records);
    if (kept.length > 0 && lineTooLong(kept, maxLine)) return { status: 413, body: { error: 'too_large' } };
    let counts: IngestCounts;
    try {
      counts = book.ingest(records); // a throw leaves the book as it was, and nothing is written
    } catch (e) {
      if (e instanceof UnknownLayoutError) return { status: 400, body: { error: 'unknown_layout' } };
      throw e;
    }
    if (kept.length > 0) {
      // all the work that grows with the post is done: the bytes of the line are built here, before the look
      const bytes = (journal as Journal).line(kept);
      options.hooks?.beforeWriteLook?.();
      try {
        // the look at the lock runs inside commit, after the size check and immediately before the first write call
        (journal as Journal).commit(bytes, look);
      } catch (e) {
        // The book holds a batch the file does not. If the line was written and failed, the journal has cut the file back to its last
        // good length; if it was not written at all (JournalNotWritten) nothing was cut: the file may hold another hub's lines.
        if (e instanceof JournalNotWritten) {
          if (e.look !== undefined && e.look.state === 'cannot') {
            // could not tell: nothing was written and nothing was cut; the book took the batch, so it is rebuilt from the file
            noteCannot(e.look, false);
            tryRebuild();
            return busy();
          }
          markLost();
          tryRebuild();
          // 503 means this post wrote nothing; 500 means a line was written and then found lost or failed
          return { status: 503, body: { error: 'journal_unavailable' } };
        }
        if ((journal as Journal).unavailable) unavailable = true;
        tryRebuild();
        throw e;
      }
      noteOk();
    }
    updateTable(table, records, counts);
    // the last look, last before the answer: a line in a file that has lost its name, or under a lock that is not ours, is not a 200.
    // rebuild() restores both the book and the table from what the path holds, and the answer is 500.
    options.hooks?.beforeLastLook?.(table.size);
    if (kept.length > 0) {
      const last = look();
      if (last.state === 'gone') {
        markLost();
        tryRebuild();
        throw new Error('the journal was lost while a line was being written');
      }
      if (last.state === 'cannot') {
        // the line is written and on the disk, but the hub cannot confirm it: 500, the book and table are rebuilt from the file
        noteCannot(last, true);
        tryRebuild();
        throw new Error('the journal could not be confirmed after a line was written');
      }
      noteOk();
    }
    return { status: 200, body: counts };
  }

  /** The POST /v0/shots work after the headers have been checked. Returns the status and a note for the console. */
  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<{ status: number; note: string }> {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        refuseAndDrain(req, res, 413, { error: 'too_large' });
        return { status: 413, note: '' };
      }
      if (e instanceof BodyTimeout) {
        refuseAndDrain(req, res, 408, { error: 'body_timeout' }, { Connection: 'close' });
        return { status: 408, note: '' };
      }
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      send(res, 400, { error: 'bad_json' });
      return { status: 400, note: '' };
    }
    const records = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as { records?: unknown }).records : undefined;
    if (!Array.isArray(records)) {
      send(res, 400, { error: 'bad_shape' });
      return { status: 400, note: '' };
    }
    const run = chain.then(() => acceptBatch(records as ShotRecord[]));
    chain = run.catch(() => undefined);
    const out = await run;
    let note = '';
    if (out.status === 200) {
      const c = out.body as IngestCounts;
      note = ` added=${c.added} revised=${c.revised} unchanged=${c.unchanged} conflicts=${c.conflicts}`;
    }
    send(res, out.status, out.body, out.extra);
    return { status: out.status, note };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? '';
    const path = (req.url ?? '').split('?')[0] ?? '';
    const wanted = ROUTES.get(path);
    // Only fixed words reach the console: never the raw path, which a client controls.
    const tag = wanted === undefined ? '-' : path;
    let status: number | 'aborted' = 500;
    let note = '';
    try {
      if (starting) {
        status = 503;
        refuseAndDrain(req, res, 503, { error: 'busy' }, { 'Retry-After': '1' });
        return;
      }
      // Who is asking comes first: a web page open in a browser on this PC reaches 127.0.0.1 too, but it cannot choose
      // its Host header. Nothing else is looked at and no body is read.
      const host = req.headers.host?.toLowerCase();
      const port = bound?.port;
      if (host === undefined || port === undefined || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
        status = 403;
        refuseAndDrain(req, res, 403, { error: 'bad_host' });
      } else if (wanted === undefined) {
        status = 404;
        refuseAndDrain(req, res, 404, { error: 'not_found' });
      } else if (method !== wanted) {
        status = 405;
        refuseAndDrain(req, res, 405, { error: 'method_not_allowed' }, { Allow: wanted });
      } else if (path === '/healthz') {
        status = 200;
        send(res, 200, { ok: true });
      } else if (path === '/v0/rounds' && rebuildFailed) {
        // a rebuild failed: the hub has no book it can stand behind, so it shows none (healthz still answers)
        status = 503;
        send(res, 503, { error: 'journal_unavailable' });
      } else if (path === '/v0/rounds') {
        status = 200;
        send(res, 200, { rounds: book.rounds(), rangeShots: book.rangeShots, issues: book.issues() });
      } else if (!isJson(req.headers['content-type'])) {
        // A web page can send a text/plain post to this address without asking first; application/json it cannot.
        status = 415;
        refuseAndDrain(req, res, 415, { error: 'unsupported_media_type' });
      } else if (unavailable) {
        status = 503;
        refuseAndDrain(req, res, 503, { error: 'journal_unavailable' });
      } else if (activePosts >= MAX_ACTIVE_POSTS) {
        status = 503;
        refuseAndDrain(req, res, 503, { error: 'busy' }, { 'Retry-After': '1' });
      } else {
        activePosts++;
        try {
          const out = await handlePost(req, res);
          status = out.status;
          note = out.note;
        } finally {
          activePosts--;
        }
      }
    } catch (e) {
      if (e instanceof ClientAborted) {
        // the client went away: not a failure of the hub, and there is nobody to answer
        status = 'aborted';
        res.destroy();
      } else {
        status = 500;
        if (!res.headersSent) send(res, 500, { error: 'internal' });
        else res.destroy();
      }
    } finally {
      log(`${method === 'GET' || method === 'POST' ? method : 'other'} ${tag} ${status}${note}`);
    }
  }

  return {
    async listen() {
      if (server) throw new Error('already listening');
      book = new RoundBook();
      table = new Map<string, string>();
      unavailable = false;
      rebuildFailed = false;
      cannotStretch = false;
      activePosts = 0;
      // Order: take the lock; bind the port; then open and replay the journal. Until the replay is done every request
      // answers 503 busy. A start that fails on the lock or on the port touches nothing in the folder but the lock.
      lock = takeLock(options.dataDir, warn);
      const s = createServer((req, res) => void handle(req, res));
      starting = true;
      try {
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(wantedPort, HOST, () => {
            s.off('error', reject);
            resolve();
          });
        });
        server = s;
        const a = s.address() as AddressInfo;
        bound = { host: a.address, port: a.port };
        try {
          journal = await Journal.open(options.dataDir, (records) => void apply(book, table, records as ShotRecord[]), warn, options.journal);
        } catch (e) {
          // a file-system error here would carry the data folder's path: say only which file and which error
          if (e instanceof JournalError) throw e;
          const code = (e as NodeJS.ErrnoException | undefined)?.code;
          throw new JournalError(`journal.jsonl could not be opened or read (${typeof code === 'string' ? code : 'error'})`);
        }
        starting = false;
      } catch (e) {
        starting = false;
        server = undefined;
        bound = undefined;
        await new Promise<void>((resolve) => {
          if (!s.listening) {
            resolve();
            return;
          }
          s.close(() => resolve());
          s.closeAllConnections();
        });
        journal?.close();
        journal = undefined;
        lock?.release();
        lock = undefined;
        throw e;
      }
      return bound as { host: string; port: number };
    },
    async close() {
      const s = server;
      server = undefined;
      bound = undefined;
      if (s) {
        await new Promise<void>((resolve) => {
          s.close(() => resolve());
          s.closeAllConnections();
        });
      }
      await chain; // let a batch in flight finish its write
      const j = journal;
      const l = lock;
      journal = undefined;
      lock = undefined;
      try {
        j?.close();
      } finally {
        l?.release(); // a close that throws must not leave the lock behind
      }
    },
    address: () => bound,
  };
}
