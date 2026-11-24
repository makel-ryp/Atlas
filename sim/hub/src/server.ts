import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { RoundBook, UnknownLayoutError, type ShotRecord } from '../../core/src/index.js';
import { Journal, readBatches, JOURNAL_NAME } from './journal.js';

export const HOST = '127.0.0.1';
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

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

/** Builds the hub. Nothing runs, opens or listens until listen() is called. */
export function createHub(options: HubOptions): Hub {
  const log = options.log ?? ((l: string) => console.log(l));
  const warn = options.warn ?? ((l: string) => console.warn(l));
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const wantedPort = options.port ?? 5077;

  let book = new RoundBook();
  let journal: Journal | undefined;
  let server: Server | undefined;
  let bound: { host: string; port: number } | undefined;
  // Everything that changes the book runs one at a time, in arrival order.
  let chain: Promise<unknown> = Promise.resolve();

  function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...extra });
    res.end(text);
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
      const cleanup = (): void => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
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
        cleanup();
        resolve(Buffer.concat(parts));
      };
      const onError = (e: Error): void => {
        cleanup();
        reject(e);
      };
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
  }

  /** Runs in the queue. The library's ingest and the journal write have no await between them. */
  function acceptBatch(records: ShotRecord[]): { status: number; body: unknown } {
    let counts;
    try {
      counts = book.ingest(records); // a throw leaves the book as it was, and nothing is written
    } catch (e) {
      if (e instanceof UnknownLayoutError) return { status: 400, body: { error: 'unknown_layout' } };
      throw e;
    }
    try {
      (journal as Journal).append(records);
    } catch (e) {
      // The book holds a batch the file does not: rebuild the book from the file so memory and file agree.
      const fresh = new RoundBook();
      for (const b of readBatches(join(options.dataDir, JOURNAL_NAME), () => undefined).batches) fresh.ingest(b as ShotRecord[]);
      book = fresh;
      throw e;
    }
    return { status: 200, body: counts };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? '';
    const path = (req.url ?? '').split('?')[0] ?? '';
    const wanted = ROUTES.get(path);
    // Only fixed words reach the console: never the raw path, which a client controls.
    const tag = wanted === undefined ? '-' : path;
    let status = 500;
    let note = '';
    try {
      if (wanted === undefined) {
        status = 404;
        send(res, 404, { error: 'not_found' });
      } else if (method !== wanted) {
        status = 405;
        send(res, 405, { error: 'method_not_allowed' }, { Allow: wanted });
      } else if (path === '/healthz') {
        status = 200;
        send(res, 200, { ok: true });
      } else if (path === '/v0/rounds') {
        status = 200;
        send(res, 200, { rounds: book.rounds(), rangeShots: book.rangeShots, issues: book.issues() });
      } else {
        let body: Buffer;
        try {
          body = await readBody(req);
        } catch (e) {
          if (e instanceof BodyTooLarge) {
            status = 413;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too_large' }));
            // Nothing more is buffered: what is still coming is thrown away, and the connection is cut after a short grace
            // so the client can read the answer before the socket closes.
            req.resume();
            setTimeout(() => req.destroy(), 2000).unref();
            return;
          }
          throw e;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          status = 400;
          send(res, 400, { error: 'bad_json' });
          return;
        }
        const records = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as { records?: unknown }).records : undefined;
        if (!Array.isArray(records)) {
          status = 400;
          send(res, 400, { error: 'bad_shape' });
          return;
        }
        const run = chain.then(() => acceptBatch(records as ShotRecord[]));
        chain = run.catch(() => undefined);
        const out = await run;
        status = out.status;
        if (out.status === 200) {
          const c = out.body as { added: number; revised: number; unchanged: number; conflicts: number };
          note = ` added=${c.added} revised=${c.revised} unchanged=${c.unchanged} conflicts=${c.conflicts}`;
        }
        send(res, out.status, out.body);
      }
    } catch {
      status = 500;
      if (!res.headersSent) send(res, 500, { error: 'internal' });
      else res.destroy();
    } finally {
      log(`${method === 'GET' || method === 'POST' ? method : 'other'} ${tag} ${status}${note}`);
    }
  }

  return {
    async listen() {
      if (server) throw new Error('already listening');
      book = new RoundBook();
      journal = Journal.open(options.dataDir, (records) => void book.ingest(records as ShotRecord[]), warn);
      const s = createServer((req, res) => void handle(req, res));
      server = s;
      try {
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(wantedPort, HOST, () => {
            s.off('error', reject);
            resolve();
          });
        });
      } catch (e) {
        server = undefined;
        journal.close();
        journal = undefined;
        throw e;
      }
      const a = s.address() as AddressInfo;
      bound = { host: a.address, port: a.port };
      return bound;
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
      journal?.close();
      journal = undefined;
    },
    address: () => bound,
  };
}
