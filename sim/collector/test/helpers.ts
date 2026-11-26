import assert from 'node:assert/strict';
import { after } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHub, type Hub } from '../../hub/src/server.js';
import { loadRecording, type Copy } from '../../core/src/index.js';
import { createCollector, defaultPost, type Collector, type CollectorOptions, type PostFn, type PostResult } from '../src/collector.js';
import type { Files } from '../src/files.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SRC = join(HERE, '../src');
export const RECORDING = join(HERE, '../../fixtures/gspro-4.1.13/2026-11-23');
export const copies: Copy[] = loadRecording(RECORDING);
const temps: string[] = [];
export const hubs: Hub[] = [];
export const standIns: Server[] = [];

export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sim-collector-test-'));
  temps.push(d);
  return d;
}

export function removeTemps(): void {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
}

const quiet = { log: () => undefined, warn: () => undefined };

export async function startHub(dir: string, port = 0): Promise<{ hub: Hub; url: string; port: number }> {
  const hub = createHub({ dataDir: dir, port, ...quiet });
  hubs.push(hub);
  const a = await hub.listen();
  return { hub, url: `http://${a.host}:${a.port}`, port: a.port };
}

export async function closeAll(): Promise<void> {
  let closeError: unknown;
  for (const h of hubs) {
    try {
      await h.close();
    } catch (e) {
      closeError ??= e;
    }
  }
  hubs.length = 0;
  for (const s of standIns) {
    try {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    } catch (e) {
      closeError ??= e;
    }
  }
  standIns.length = 0;
  // A recorded overlap is reported for the test it happened in, even when closing a stand-in failed.
  reportOverlaps(closeError);
  if (closeError !== undefined) throw closeError;
}

/**
 * Fails with the message when two posts were ever unanswered at once since the last report, and empties the record.
 * closeAll() calls it after every test; a file's `after` hook calls settleAndReport() for what happens after its last test.
 */
export function reportOverlaps(alsoFailed?: unknown): void {
  if (overlapLog.length === 0) return;
  const first = overlapLog[0]!;
  const n = overlapLog.length;
  overlapLog.length = 0;
  const also = alsoFailed === undefined ? '' : ` (closing a stand-in also failed: ${alsoFailed instanceof Error ? alsoFailed.message : String(alsoFailed)})`;
  throw new Error(`${first} (${n} time${n === 1 ? '' : 's'} in this test)${also}`);
}

/**
 * For a file's `after` hook: a program left running may start a second post after the last test ended, or leave a timer
 * running (a second interval, a retry timer): wait a moment, then report both. A leaked timer would keep the test
 * process alive for ever, so after the report the process is ended, with a failing exit code, by a timer of its own that
 * does not keep it alive.
 */
export async function settleAndReport(): Promise<void> {
  await sleep(50);
  const timers = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  if (timers > 0) {
    console.error(`timers were left running at the end of this test file: ${timers}`);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500).unref();
  }
  reportOverlaps();
  if (timers > 0) throw new Error(`timers were left running at the end of this test file: ${timers}`);
}

// Every test file that imports these helpers gets this hook: an overlap after its last test is reported too.
after(settleAndReport);

export const OVERLAP_MESSAGE = 'OVERLAP: a second post was sent while one was still unanswered';
/** Filled by counted posts; read (and emptied) by closeAll(). A throw inside the post would be swallowed by the program as a failed post, so the failure is raised when the test ends. */
export const overlapLog: string[] = [];

/**
 * Wraps a post so that it counts the calls started and not yet ended. The moment a call starts while another is
 * unanswered, it records OVERLAP_MESSAGE (closeAll() then fails the test with it). The call itself still goes through,
 * so a test's own assertions see what they always saw. `allowOverlap` is for a test that needs two on purpose.
 */
export function counted(inner: PostFn, allowOverlap = false): PostFn {
  let inflight = 0;
  return async (url, body) => {
    if (!allowOverlap && inflight >= 1) overlapLog.push(OVERLAP_MESSAGE);
    inflight++;
    try {
      return await inner(url, body);
    } finally {
      inflight--;
    }
  };
}

export async function rounds(url: string): Promise<any> {
  const res = await fetch(`${url}/v0/rounds`);
  assert.equal(res.status, 200);
  return res.json();
}

export function assertKnownAnswer(data: any): void {
  const r19 = data.rounds.find((r: any) => r.roundId === 19);
  assert.ok(r19, 'round 19');
  const a = r19.players.find((p: any) => p.name === 'ZZTEST-A');
  const b = r19.players.find((p: any) => p.name === 'ZZTEST-B');
  assert.ok(a && b);
  const finished = (p: any) => p.holes.filter((h: any) => h.status === 'finished').map((h: any) => [h.hole, h.strokes]);
  assert.deepEqual(finished(a), [[3, 6], [12, 4], [15, 8]]);
  assert.equal(a.total, 18);
  assert.deepEqual(finished(b), [[3, 5], [12, 5], [15, 10]]);
  assert.equal(b.total, 20);
  const r18 = data.rounds.find((r: any) => r.roundId === 18);
  assert.ok(r18, 'round 18');
  assert.equal(r18.players.length, 2);
  for (const p of r18.players) {
    assert.equal(p.holes.length, 1);
    assert.equal(p.holes[0].status, 'in_play');
    assert.equal(p.holes[0].strokesSoFar, 1);
  }
  assert.deepEqual(data.issues, []);
}

export interface Rig {
  gspro: string;
  data: string;
  now: () => number;
  advance: (ms: number) => void;
  answers: PostResult[];
  posted: number[];
  lastWritten: string | undefined;
  write: (text: string) => void;
  writeCopy: (n: number) => void;
  /** A post handed in through `extra.post` is counted too. `allowOverlap: true` switches the counter off for that program. */
  make: (extra?: Partial<CollectorOptions> & { allowOverlap?: boolean }) => Collector;
  hubUrl: string;
}
export const rigs: Rig[] = [];

/** One pretend GSPro file, a data folder, a fake clock, and a post that checks the hub's counts add up to the batch. */
export function rig(hubUrl: string, strict = true): Rig {
  const dir = tempDir();
  let t = 1_000_000;
  const r: Rig = {
    gspro: join(dir, 'currentRound.dat'),
    data: join(dir, 'data'),
    now: () => t,
    advance: (ms) => void (t += ms),
    answers: [],
    posted: [],
    lastWritten: undefined,
    hubUrl,
    write(text) {
      writeFileSync(r.gspro, text);
      r.lastWritten = text;
    },
    writeCopy(n) {
      r.write(JSON.stringify(copies[n - 1]!.records));
    },
    make(extra = {}) {
      const { allowOverlap, ...options } = extra;
      const own: PostFn = async (url, body) => {
        const out = await defaultPost(url, body);
        const size = (JSON.parse(body).records as unknown[]).length;
        r.posted.push(size);
        r.answers.push(out);
        if (strict && out.status === 200) {
          const c = out.body as Record<string, number>;
          assert.equal(c.added + c.revised + c.unchanged + c.conflicts, size, 'the four counts add up to the batch');
        }
        return out;
      };
      return createCollector({
        gsproFile: r.gspro,
        dataDir: r.data,
        hubUrl: r.hubUrl,
        now: r.now,
        ...options,
        post: counted(options.post ?? own, allowOverlap === true),
      });
    },
  };
  rigs.push(r);
  return r;
}

export async function runCopies(r: Rig, c: Collector, from: number, to: number, advanceMs = 0): Promise<void> {
  for (let n = from; n <= to; n++) {
    r.writeCopy(n);
    r.advance(advanceMs);
    await c.tick();
  }
}

export function sumAnswers(r: Rig, key: string): number {
  return r.answers.filter((a) => a.status === 200).reduce((s, a) => s + (a.body as any)[key], 0);
}

export function outboxLines(r: Rig): string[] {
  return readFileSync(join(r.data, 'outbox.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
}

/** Wraps a real file module and records every call. `failWhen` makes the first call it accepts throw. */
export function spyFiles(real: Files, failWhen?: (method: string, name: string, previous: Array<[string, string]>) => boolean): { files: Files; calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  const history: Array<[string, string]> = [];
  let failed = false;
  const files = new Proxy(real, {
    get(target, prop: string) {
      const fn = (target as any)[prop];
      if (typeof fn !== 'function') return fn;
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        const name = String(args[0]);
        if (!failed && failWhen && failWhen(prop, name, history)) {
          failed = true;
          throw new Error('disk trouble (injected)');
        }
        history.push([prop, name]);
        return fn.apply(target, args);
      };
    },
  }) as Files;
  return { files, calls };
}

export interface StandIn {
  port: number;
  url: string;
  hits: Array<{ method: string; url: string; bodyBytes: number }>;
}

/** A tiny loopback server that answers every request through `answer`. Closed by closeAll(). */
export async function standIn(answer: (req: IncomingMessage, res: ServerResponse) => void): Promise<StandIn> {
  const hits: StandIn['hits'] = [];
  const server = createServer((req, res) => {
    let n = 0;
    req.on('data', (c: Buffer) => void (n += c.length));
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', bodyBytes: n });
      answer(req, res);
    });
  });
  standIns.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, url: `http://127.0.0.1:${port}`, hits };
}

/** n made-up records with placeholder names and ids, all in one made-up round. */
export function synth(n: number, prefix = 'PH'): any[] {
  const base = JSON.parse(JSON.stringify(copies[2]!.records[0]));
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ ...base, ShotID: `${prefix}-SHOT-${i}`, UserGuid: `${prefix}-GUID`, PlayerName: 'Placeholder', RoundID: 77, Hole: i % 18, HoleShot: 1, HoleResult: 0 });
  }
  return out;
}

// ---- round 3: one post in flight ----

import type { Timer } from '../src/collector.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Waits (in small real steps) until `cond` holds; fails with `what` after `ms`. */
export async function until(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(2);
  }
}

export interface ManualTimer extends Timer {
  /** Runs the handler the program gave to setInterval, as the timer would. Does nothing when none is set. */
  fire(): void;
  readonly active: boolean;
}

/** A timer that never fires by itself: the test fires the program's own handler. */
export function manualTimer(): ManualTimer {
  let fn: (() => void) | undefined;
  let current: object | undefined;
  return {
    setInterval(f) {
      fn = f;
      current = {};
      return current as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval(h) {
      if ((h as unknown) === current) {
        fn = undefined;
        current = undefined;
      }
    },
    fire() {
      fn?.();
    },
    get active() {
      return fn !== undefined;
    },
  };
}

export interface HeldCall {
  ids: string[];
  size: number;
  ended: boolean;
  /** Answers this call (default: a 200 whose four counts add up to the batch). */
  release(result?: PostResult): void;
}

export interface HeldPost {
  post: PostFn;
  calls: HeldCall[];
  /** Calls started and not yet answered. */
  inflight: number;
  maxInflight: number;
  /** From now on every call is answered at once, and the ones held are answered now. For cleaning up. */
  openUp(): void;
}

/** A stand-in post that answers only when the test lets it, and counts how many calls are unanswered at once. */
export function heldPost(): HeldPost {
  const answer = (n: number): PostResult => ({ status: 200, body: { added: n, revised: 0, unchanged: 0, conflicts: 0 } });
  let auto = false;
  const h: HeldPost = {
    calls: [],
    inflight: 0,
    maxInflight: 0,
    post: (_url, body) =>
      new Promise<PostResult>((resolve) => {
        const recs = (JSON.parse(body) as { records: Array<{ ShotID: string }> }).records;
        const call: HeldCall = {
          ids: recs.map((x) => x.ShotID),
          size: recs.length,
          ended: false,
          release(result) {
            if (call.ended) return;
            call.ended = true;
            h.inflight--;
            resolve(result ?? answer(recs.length));
          },
        };
        h.calls.push(call);
        h.inflight++;
        h.maxInflight = Math.max(h.maxInflight, h.inflight);
        if (auto) call.release();
      }),
    openUp() {
      auto = true;
      for (const c of h.calls) c.release();
    },
  };
  return h;
}
