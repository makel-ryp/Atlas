import { test, before, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub, type Hub } from '../../hub/src/server.js';
import { loadRecording, type Copy } from '../../core/src/index.js';
import { createCollector, statusLine, defaultPost, type Collector, type CollectorOptions, type PostResult } from '../src/collector.js';
import { createFiles, type Files } from '../src/files.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../src');
const RECORDING = join(HERE, '../../fixtures/gspro-4.1.13/2026-11-23');
const copies: Copy[] = loadRecording(RECORDING);
const temps: string[] = [];
const hubs: Hub[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sim-collector-test-'));
  temps.push(d);
  return d;
}

const quiet = { log: () => undefined, warn: () => undefined };

async function startHub(dir: string, port = 0): Promise<{ hub: Hub; url: string; port: number }> {
  const hub = createHub({ dataDir: dir, port, ...quiet });
  hubs.push(hub);
  const a = await hub.listen();
  return { hub, url: `http://${a.host}:${a.port}`, port: a.port };
}

async function rounds(url: string): Promise<any> {
  const res = await fetch(`${url}/v0/rounds`);
  assert.equal(res.status, 200);
  return res.json();
}

function assertKnownAnswer(data: any): void {
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
}

/** One pretend GSPro file, a data folder, a fake clock and a post that remembers every answer. */
interface Rig {
  gspro: string;
  data: string;
  now: () => number;
  advance: (ms: number) => void;
  answers: PostResult[];
  lastWritten: string | undefined;
  write: (text: string) => void;
  writeCopy: (n: number) => void;
  make: (extra?: Partial<CollectorOptions>) => Collector;
  hubUrl: string;
}
const rigs: Rig[] = [];

function rig(hubUrl: string): Rig {
  const dir = tempDir();
  let t = 1_000_000;
  const r: Rig = {
    gspro: join(dir, 'currentRound.dat'),
    data: join(dir, 'data'),
    now: () => t,
    advance: (ms) => void (t += ms),
    answers: [],
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
          if (out.status === 200) {
            const c = out.body as Record<string, number>;
            assert.equal(c.added + c.revised + c.unchanged + c.conflicts, (JSON.parse(body).records as unknown[]).length, 'the four counts add up to the batch');
          }
          r.answers.push(out);
          return out;
        },
        ...extra,
      });
    },
  };
  rigs.push(r);
  return r;
}

/** Writes copies from..to (1-based, inclusive) and ticks after each. */
async function runCopies(r: Rig, c: Collector, from: number, to: number, advanceMs = 0): Promise<void> {
  for (let n = from; n <= to; n++) {
    r.writeCopy(n);
    r.advance(advanceMs);
    await c.tick();
  }
}

function sumAnswers(r: Rig, key: string): number {
  return r.answers.filter((a) => a.status === 200).reduce((s, a) => s + (a.body as any)[key], 0);
}

function outboxLines(r: Rig): string[] {
  return readFileSync(join(r.data, 'outbox.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
}

/** Wraps a real file module and records every call. `failOnce` makes the first matching call throw. */
function spyFiles(real: Files, failOnce?: (method: string, name: string) => boolean): { files: Files; calls: Array<[string, ...unknown[]]> } {
  const calls: Array<[string, ...unknown[]]> = [];
  let failed = false;
  const files = new Proxy(real, {
    get(target, prop: string) {
      const fn = (target as any)[prop];
      if (typeof fn !== 'function') return fn;
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        if (!failed && failOnce && failOnce(prop, String(args[0]))) {
          failed = true;
          throw new Error('disk trouble (injected)');
        }
        return fn.apply(target, args);
      };
    },
  }) as Files;
  return { files, calls };
}

before(() => {
  assert.equal(copies.length, 38);
});

afterEach(async () => {
  // GSPro's file is byte for byte what the test wrote, after every test.
  for (const r of rigs) {
    if (r.lastWritten !== undefined) assert.equal(readFileSync(r.gspro, 'utf8'), r.lastWritten, 'GSPro file changed');
  }
  rigs.length = 0;
  for (const h of hubs) await h.close();
  hubs.length = 0;
});

after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

test('1. the 38 recorded copies, one tick each, end on the known answer', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make();
  await runCopies(r, c, 1, 38);
  assertKnownAnswer(await rounds(url));
  const s = c.status();
  assert.equal(s.queued, 41);
  assert.equal(s.sent, 41);
  assert.equal(s.pending, 0);
  assert.equal(s.refused, 0);
  assert.equal(s.copiesRead, 38);
  assert.equal(s.server, 'up');
  assert.equal(s.file, 'ok');
});

test('2. every record reached the server once as added', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make();
  await runCopies(r, c, 1, 38);
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'revised'), 0);
  assert.equal(sumAnswers(r, 'unchanged'), 0);
  assert.equal(sumAnswers(r, 'conflicts'), 0);
});

test('3. server stopped after copy 15, restarted on the same data folder: nothing lost, nothing doubled', async () => {
  const hubData = tempDir();
  const first = await startHub(hubData);
  const r = rig(first.url);
  const c = r.make();
  await runCopies(r, c, 1, 15, 31_000);
  await first.hub.close();
  await runCopies(r, c, 16, 30, 31_000);
  assert.ok(c.status().pending > 0);
  assert.equal(c.status().server, 'down');
  const second = await startHub(hubData, first.port);
  r.advance(31_000);
  await c.tick();
  await runCopies(r, c, 31, 38, 31_000);
  assertKnownAnswer(await rounds(second.url));
  assert.equal(c.status().pending, 0);
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'revised'), 0);
});

test('4. collector stopped after copy 20 and a new one made on the same data folder: no record queued twice', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const a = r.make();
  await runCopies(r, a, 1, 20);
  await a.stop();
  const b = r.make();
  await runCopies(r, b, 21, 38);
  assertKnownAnswer(await rounds(url));
  assert.equal(outboxLines(r).length, 41);
  assert.equal(b.status().queued, 41);
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'unchanged'), 0);
});

test('5. server down for the whole of round 18, file emptied, round 19 written, server up: round 18 still arrives', async () => {
  const hubData = tempDir();
  const first = await startHub(hubData);
  await first.hub.close();
  const r = rig(first.url);
  const c = r.make();
  await runCopies(r, c, 1, 2, 31_000);
  r.write('[]');
  r.advance(31_000);
  await c.tick();
  assert.equal(c.status().file, 'ok');
  await runCopies(r, c, 3, 10, 31_000);
  assert.equal(c.status().sent, 0);
  const second = await startHub(hubData, first.port);
  r.advance(31_000);
  await c.tick();
  const mid = await rounds(second.url);
  const r18 = mid.rounds.find((x: any) => x.roundId === 18);
  assert.ok(r18);
  assert.equal(r18.players.length, 2);
  await runCopies(r, c, 11, 38);
  assertKnownAnswer(await rounds(second.url));
  assert.equal(sumAnswers(r, 'added'), 41);
});

test('6. GSPro file never written: bytes unchanged, the file module saw only reads of it', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const spy = spyFiles(createFiles(r.data, r.gspro));
  const c = r.make({ files: spy.files });
  await runCopies(r, c, 1, 38);
  assert.equal(readFileSync(r.gspro, 'utf8'), r.lastWritten);
  const methods = new Set(spy.calls.map((x) => x[0]));
  assert.ok(methods.has('statSource') && methods.has('copySource'), 'it read the file');
  // The module has no method that takes GSPro's path, so no write, rename or delete can name it.
  assert.deepEqual(Object.keys(createFiles(r.data, r.gspro)).sort(), ['appendData', 'appendDurable', 'copySource', 'ensureDataDir', 'keepPrefix', 'readCopy', 'readData', 'readLines', 'statSource', 'writeData']);
  for (const call of spy.calls) {
    const [method, ...args] = call;
    if (method === 'appendData' || method === 'appendDurable' || method === 'writeData' || method === 'keepPrefix') {
      const name = String(args[0]);
      assert.ok(!/[\\/]/.test(name), 'a bare file name in the data folder');
      assert.notEqual(name, 'currentRound.dat');
    }
    if (method === 'copySource') assert.equal(args.length, 0);
  }
  for (const f of readdirSync(dirname(r.gspro))) assert.ok(['currentRound.dat', 'data'].includes(f), `unexpected file next to GSPro's: ${f}`);
});

test('6b. guard: only files.ts touches the disk (and the guard bites)', () => {
  const touches = (text: string): boolean => /from\s+['"](node:)?fs(\/promises)?['"]/.test(text) || /require\(['"](node:)?fs/.test(text);
  for (const f of ['collector.ts', 'outbox.ts', 'main.ts']) assert.equal(touches(readFileSync(join(SRC, f), 'utf8')), false, `${f} imports fs`);
  assert.equal(touches(readFileSync(join(SRC, 'files.ts'), 'utf8')), true, 'negative case: files.ts does import fs');
  assert.equal(touches("import { readFileSync } from 'node:fs';"), true);
  const files = readFileSync(join(SRC, 'files.ts'), 'utf8');
  for (const word of ['unlinkSync', 'rmSync', 'truncateSync', 'ftruncate', 'rmdirSync']) assert.ok(!files.includes(word), `files.ts uses ${word}`);
});

test('7. a copy cut off mid-record: nothing sent, nothing lost, next complete copy goes through; ten seconds on, status says so', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make();
  await runCopies(r, c, 1, 10);
  const before = c.status();
  const full = JSON.stringify(copies[10]!.records);
  r.write(full.slice(0, full.length - 40));
  await c.tick();
  assert.equal(c.status().queued, before.queued);
  assert.equal(c.status().file, 'retrying');
  r.advance(4_000);
  await c.tick();
  assert.equal(c.status().file, 'retrying');
  r.advance(7_000);
  await c.tick();
  assert.equal(c.status().file, 'broken');
  assert.equal(c.status().queued, before.queued);
  await runCopies(r, c, 11, 38);
  assert.equal(c.status().file, 'ok');
  assertKnownAnswer(await rounds(url));
  assert.equal(sumAnswers(r, 'added'), 41);
});

test('8. a record missing HoleResult: nothing from it sent, layout not known, earlier queue kept', async () => {
  const hubData = tempDir();
  const first = await startHub(hubData);
  await first.hub.close();
  const r = rig(first.url);
  const c = r.make();
  await runCopies(r, c, 1, 5, 31_000);
  const queued = c.status().queued;
  assert.ok(queued > 0);
  const broken = JSON.parse(JSON.stringify(copies[19]!.records));
  delete broken[broken.length - 1].HoleResult;
  r.write(JSON.stringify(broken));
  await c.tick();
  assert.equal(c.status().file, 'layout_unknown');
  assert.equal(c.status().queued, queued);
  assert.equal(c.status().pending, queued);
  const second = await startHub(hubData, first.port);
  r.advance(31_000);
  await runCopies(r, c, 20, 38, 0);
  assert.equal(c.status().file, 'ok');
  assertKnownAnswer(await rounds(second.url));
});

test('9a. a 400 answer moves the batch to the refused file and it is not sent again', async () => {
  const r = rig('http://127.0.0.1:1');
  let calls = 0;
  const c = r.make({
    post: async () => {
      calls++;
      return { status: 400, body: { error: 'unknown_layout' } };
    },
  });
  r.writeCopy(3);
  await c.tick();
  assert.equal(calls, 1);
  assert.equal(c.status().refused, 1);
  assert.equal(c.status().pending, 0);
  assert.equal(c.status().sent, 0);
  r.advance(60_000);
  await c.tick();
  await c.tick();
  assert.equal(calls, 1);
  const refused = readFileSync(join(r.data, 'refused.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
  assert.equal(refused.length, 1);
  assert.equal(JSON.parse(refused[0]!).status, 400);
  // a 413 is refused for good as well
  const r2 = rig('http://127.0.0.1:1');
  const c2 = r2.make({ post: async () => ({ status: 413 }) });
  r2.writeCopy(3);
  await c2.tick();
  assert.equal(c2.status().refused, 1);
  assert.equal(c2.status().pending, 0);
});

test('9b. a 500 answer keeps the batch and the wait grows, never beyond 30 seconds', async () => {
  const r = rig('http://127.0.0.1:1');
  let calls = 0;
  const c = r.make({
    post: async () => {
      calls++;
      return { status: 500, body: { error: 'internal' } };
    },
  });
  r.writeCopy(3);
  const waits: number[] = [];
  for (let i = 0; i < 9; i++) {
    r.advance(31_000);
    await c.tick();
    waits.push(c.status().retryDelayMs);
  }
  assert.equal(calls, 9);
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.equal(c.status().pending, 1);
  assert.equal(c.status().refused, 0);
  assert.equal(c.status().server, 'refusing-500');
  // within the wait, no new try
  await c.tick();
  assert.equal(calls, 9);
  r.advance(29_999);
  await c.tick();
  assert.equal(calls, 9);
  r.advance(1);
  await c.tick();
  assert.equal(calls, 10);
});

test('10. a non-loopback or https address is refused at start and nothing is read', () => {
  const bad = [
    'http://example.com:5077',
    'https://127.0.0.1:5077',
    'https://localhost:5077',
    'http://192.168.1.5:5077',
    'http://0.0.0.0:5077',
    'http://[::1]:5077',
    'http://localhost.example.com:5077',
    'http://127.0.0.1.example.com:5077',
    'http://user:pw@127.0.0.1:5077',
    'http://127.0.0.1',
    'ftp://127.0.0.1:5077',
    'not a url',
    '',
  ];
  const messages = new Set<string>();
  for (const hubUrl of bad) {
    const dir = tempDir();
    const gspro = join(dir, 'currentRound.dat');
    writeFileSync(gspro, '[]');
    const spy = spyFiles(createFiles(join(dir, 'data'), gspro));
    assert.throws(
      () => createCollector({ gsproFile: gspro, dataDir: join(dir, 'data'), hubUrl, files: spy.files }),
      (e: Error) => {
        messages.add(e.message);
        return /this PC/.test(e.message);
      },
      hubUrl,
    );
    assert.equal(spy.calls.length, 0, `nothing read for ${hubUrl}`);
    assert.equal(existsSync(join(dir, 'data')), false);
  }
  assert.equal(messages.size, 1, 'one fixed message, never echoing what was typed');
  for (const hubUrl of ['http://127.0.0.1:5077', 'http://localhost:5077', 'http://127.0.0.1:5077/']) {
    const dir = tempDir();
    assert.doesNotThrow(() => createCollector({ gsproFile: join(dir, 'x.dat'), dataDir: join(dir, 'data'), hubUrl }));
  }
});

test('11. the file missing at start and appearing later: no error, picked up', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make();
  for (let i = 0; i < 3; i++) await c.tick();
  assert.equal(c.status().file, 'waiting');
  assert.equal(c.status().copiesRead, 0);
  assert.ok(!existsSync(r.gspro));
  await runCopies(r, c, 1, 38);
  assert.equal(c.status().file, 'ok');
  assertKnownAnswer(await rounds(url));
});

test('11b. the file removed while running is not an error', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make();
  await runCopies(r, c, 1, 3);
  rmSync(r.gspro);
  r.lastWritten = undefined;
  await c.tick();
  assert.equal(c.status().file, 'waiting');
  assert.equal(c.status().queued, 3);
});

test('12. a crash between the post and the sent mark: after a restart the batch is sent again and the server says unchanged', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const spy = spyFiles(createFiles(r.data, r.gspro), (m, name) => m === 'writeData' && name === 'sent.json');
  const a = r.make({ files: spy.files });
  r.writeCopy(1);
  await a.tick();
  assert.equal(r.answers.length, 1);
  assert.equal((r.answers[0]!.body as any).added, 1);
  assert.equal(a.status().store, 'error');
  await a.stop();
  const b = r.make();
  await runCopies(r, b, 1, 38);
  assert.equal(r.answers[1]!.status, 200);
  assert.equal((r.answers[1]!.body as any).unchanged, 1);
  assert.equal((r.answers[1]!.body as any).added, 0);
  assertKnownAnswer(await rounds(url));
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'revised'), 0);
  assert.equal(b.status().store, 'ok');
  assert.equal(b.status().pending, 0);
});

test('13. nothing from the copies appears in what the program prints', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const NAME = 'QQNAME-UNIQUE-91';
  const ID = 'QQID-UNIQUE-77';
  const printed: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = (...a: unknown[]) => void printed.push(a.join(' '));
  console.warn = console.log;
  console.error = console.log;
  console.info = console.log;
  try {
    const c = r.make({ onStatus: (s) => printed.push(statusLine(s)) });
    c.start();
    for (const n of [1, 2, 10, 38]) {
      const recs = JSON.parse(JSON.stringify(copies[n - 1]!.records));
      recs.forEach((x: any, i: number) => {
        x.PlayerName = NAME;
        x.UserGuid = ID;
        x.ShotID = `${ID}-${n}-${i}`;
      });
      r.write(JSON.stringify(recs));
      await c.tick();
    }
    r.write('{"cut off ' + NAME + ID);
    await c.tick();
    r.advance(20_000);
    await c.tick();
    printed.push(JSON.stringify(c.status()));
    await c.stop();
  } finally {
    Object.assign(console, keep);
  }
  assert.ok(printed.length >= 3, 'something was printed');
  const all = printed.join('\n');
  assert.ok(!all.includes('QQNAME') && !all.includes('QQID') && !all.includes('UNIQUE'), 'file content on the console');
  assert.match(printed[0]!, /^copies=\d+ queued=\d+ sent=\d+ refused=\d+ pending=\d+ server=\w+ file=\w+$/);
});

test('14. start() runs tick on the timer, stop() clears it; a tick still running is not started twice', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  let handler: (() => void) | undefined;
  let interval = 0;
  let cleared = false;
  const c = r.make({
    timer: {
      setInterval: (fn, ms) => {
        handler = fn;
        interval = ms;
        return 'T' as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => void (cleared = true),
    },
  });
  c.start();
  assert.equal(interval, 500);
  r.writeCopy(1);
  handler!();
  handler!(); // overlaps the first: must not start a second pass
  await c.stop();
  assert.ok(cleared);
  assert.equal(c.status().queued, 1);
  assert.equal(r.answers.length <= 1, true);
});

test('15. a torn last line of the outbox is dropped on start; a damaged line elsewhere stops it with a plain message', async () => {
  const r = rig('http://127.0.0.1:1');
  const files = createFiles(r.data, r.gspro);
  files.ensureDataDir();
  const rec = JSON.stringify({ record: copies[2]!.records[0] });
  writeFileSync(join(r.data, 'outbox.jsonl'), rec + '\n' + rec.slice(0, 30));
  const c = r.make({ post: async () => ({ status: 500 }) });
  await c.tick();
  assert.equal(c.status().queued, 1);
  assert.equal(readFileSync(join(r.data, 'outbox.jsonl'), 'utf8'), rec + '\n');
  const r2 = rig('http://127.0.0.1:1');
  createFiles(r2.data, r2.gspro).ensureDataDir();
  writeFileSync(join(r2.data, 'outbox.jsonl'), 'garbage\n' + rec + '\n');
  const c2 = r2.make();
  await assert.rejects(c2.tick(), (e: Error) => /outbox/.test(e.message) && !e.message.includes('garbage') && !/delete/i.test(e.message));
});

test('16. a record whose content changed is sent again, in order', async () => {
  const r = rig('http://127.0.0.1:1');
  const sent: any[] = [];
  const c = r.make({
    post: async (_u, body) => {
      sent.push(...JSON.parse(body).records);
      return { status: 200, body: { added: JSON.parse(body).records.length, revised: 0, unchanged: 0, conflicts: 0 } };
    },
  });
  const recs = JSON.parse(JSON.stringify(copies[4]!.records));
  r.write(JSON.stringify(recs));
  await c.tick();
  const n = recs.length;
  assert.equal(sent.length, n);
  assert.deepEqual(sent.map((x) => x.ShotID), recs.map((x: any) => x.ShotID));
  recs[1].ShotResult = 99;
  r.write(JSON.stringify(recs));
  await c.tick();
  assert.equal(sent.length, n + 1);
  assert.equal(sent[n].ShotID, recs[1].ShotID);
  assert.equal(sent[n].ShotResult, 99);
  r.write(JSON.stringify(recs));
  await c.tick();
  assert.equal(sent.length, n + 1);
});

test('17. the file module: temp-then-rename writes leave no temp file, and names with a path are refused', () => {
  const dir = tempDir();
  const f = createFiles(join(dir, 'data'), join(dir, 'g.dat'));
  f.ensureDataDir();
  f.writeData('a.json', '1');
  f.writeData('a.json', '2');
  f.appendData('b.jsonl', 'x\n');
  f.appendData('b.jsonl', 'y\n');
  assert.equal(f.readData('a.json'), '2');
  assert.equal(f.readData('b.jsonl'), 'x\ny\n');
  assert.equal(f.readData('none.json'), undefined);
  assert.deepEqual(readdirSync(join(dir, 'data')).sort(), ['a.json', 'b.jsonl']);
  for (const bad of ['../x', 'a/b', 'a\\b', '', '.']) {
    assert.throws(() => f.writeData(bad, 'x'));
    assert.throws(() => f.appendData(bad, 'x'));
  }
  assert.equal(f.statSource(), undefined);
});
