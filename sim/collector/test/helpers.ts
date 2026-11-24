import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHub, type Hub } from '../../hub/src/server.js';
import { loadRecording, type Copy } from '../../core/src/index.js';
import { createCollector, defaultPost, type Collector, type CollectorOptions, type PostResult } from '../src/collector.js';
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
  for (const h of hubs) await h.close();
  hubs.length = 0;
  for (const s of standIns) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  standIns.length = 0;
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
  make: (extra?: Partial<CollectorOptions>) => Collector;
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
      return createCollector({
        gsproFile: r.gspro,
        dataDir: r.data,
        hubUrl: r.hubUrl,
        now: r.now,
        post: async (url, body) => {
          const out = await defaultPost(url, body);
          const size = (JSON.parse(body).records as unknown[]).length;
          r.posted.push(size);
          r.answers.push(out);
          if (strict && out.status === 200) {
            const c = out.body as Record<string, number>;
            assert.equal(c.added + c.revised + c.unchanged + c.conflicts, size, 'the four counts add up to the batch');
          }
          return out;
        },
        ...extra,
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
