import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, openSync, unlinkSync, renameSync, truncateSync, closeSync, copyFileSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, statSync, writeSync, ftruncateSync, fsyncSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

type Kid = ChildProcessByStdio<Writable, Readable, null>;
import { createHub, type Hub, type HubOptions } from '../src/server.js';
import { takeLock } from '../src/lock.js';
import { Journal } from '../src/journal.js';
import { loadRecording, type Copy } from '../../core/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const RECORDING = join(HERE, '../../fixtures/gspro-4.1.13/2026-11-23');
const copies: Copy[] = loadRecording(RECORDING);
const temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sim-hub-test-'));
  temps.push(d);
  return d;
}

const quiet = { log: () => undefined, warn: () => undefined };

/**
 * Every test runs its hub through this: the hub is closed in a finally whether or not listen() worked, so a wrong
 * implementation ends a test red and never leaves a hub open that holds the process.
 */
async function withHub(dir: string, extra: Partial<HubOptions>, fn: (url: string, hub: Hub) => Promise<void>): Promise<void> {
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, ...extra });
  try {
    const a = await hub.listen();
    await fn(`http://${a.host}:${a.port}`, hub);
  } finally {
    await hub.close();
  }
}

async function post(url: string, records: unknown): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function rounds(url: string): Promise<any> {
  const res = await fetch(`${url}/v0/rounds`);
  assert.equal(res.status, 200);
  return res.json();
}

async function postCopies(url: string, from: number, to: number): Promise<void> {
  for (const c of copies.slice(from, to)) {
    const r = await post(url, c.records);
    assert.equal(r.status, 200);
  }
}

type Raw = { status: number; body: any; headers: Record<string, string | string[] | undefined> };

/** A raw request, so a test can set the Host header and leave the Content-Type out. */
function raw(url: string, o: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Raw> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    let answered: Raw | undefined;
    const req = request({ host: u.hostname, port: u.port, path: o.path, method: o.method ?? 'GET', headers: o.headers ?? {}, agent: false }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let body: any = text;
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON: left as text
        }
        answered = { status: res.statusCode ?? 0, body, headers: res.headers };
        resolve(answered);
      });
    });
    // a hub that refuses a post and closes may reset the connection while the body is still being sent: the answer it gave counts
    req.on('error', (e) => (answered ? resolve(answered) : reject(e)));
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

function journalOf(dir: string): string {
  return join(dir, 'journal.jsonl');
}
function journalSize(dir: string): number {
  return existsSync(journalOf(dir)) ? statSync(journalOf(dir)).size : 0;
}
function journalLines(dir: string): string[] {
  return existsSync(journalOf(dir)) ? readFileSync(journalOf(dir), 'utf8').split('\n').filter((l) => l !== '') : [];
}
function journalRecordCount(dir: string): number {
  return journalLines(dir).reduce((n, l) => n + (JSON.parse(l) as unknown[]).length, 0);
}

/** What a straight run (posting copies 0 to `to` into an empty folder, no restart) answers. */
async function straightRun(to: number): Promise<any> {
  let out: any;
  await withHub(tempDir(), {}, async (url) => {
    await postCopies(url, 0, to);
    out = await rounds(url);
  });
  return out;
}

/** What a hub started on a folder answers. */
async function answerOf(dir: string): Promise<any> {
  let out: any;
  await withHub(dir, {}, async (url) => {
    out = await rounds(url);
  });
  return out;
}

/** The known answer for the whole recording, checked on the data and never on printed lines. */
function assertKnownAnswer(data: any): void {
  const r19 = data.rounds.find((r: any) => r.roundId === 19);
  assert.ok(r19, 'round 19');
  assert.equal(r19.courseKey, 'bluejack_gsp');
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
    assert.equal(p.holes[0].hole, 1);
    assert.equal(p.holes[0].status, 'in_play');
    assert.equal(p.holes[0].strokesSoFar, 1);
  }
}

before(() => {
  assert.equal(copies.length, 38);
});

process.on('exit', () => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

test('1. the 38 recorded copies give the known scores', async () => {
  await withHub(tempDir(), {}, async (url) => {
    await postCopies(url, 0, 38);
    assertKnownAnswer(await rounds(url));
  });
});

test('2. posting the same copy again answers all unchanged and changes nothing', async () => {
  await withHub(tempDir(), {}, async (url) => {
    await postCopies(url, 0, 38);
    const before = await rounds(url);
    const last = copies[37]!;
    const r = await post(url, last.records);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { added: 0, revised: 0, unchanged: last.records.length, conflicts: 0 });
    assert.deepEqual(await rounds(url), before);
  });
});

test('3. a record re-sent with a different HoleShot answers revised 1 and replaces the first', async () => {
  await withHub(tempDir(), {}, async (url) => {
    await postCopies(url, 0, 38);
    const rec = structuredClone(copies[37]!.records[copies[37]!.records.length - 1]!) as any;
    const before = await rounds(url);
    const roundId = rec.RoundID;
    const player = before.rounds.find((r: any) => r.roundId === roundId).players.find((p: any) => p.userGuid === rec.UserGuid);
    const hole = player.holes.find((h: any) => h.hole === rec.Hole + 1);
    const oldShot = rec.HoleShot;
    rec.HoleShot = oldShot + 1;
    const r = await post(url, [rec]);
    assert.deepEqual(r.body, { added: 0, revised: 1, unchanged: 0, conflicts: 0 });
    const after = await rounds(url);
    const hole2 = after.rounds.find((x: any) => x.roundId === roundId).players.find((p: any) => p.userGuid === rec.UserGuid).holes.find((h: any) => h.hole === rec.Hole + 1);
    assert.ok(hole);
    assert.notDeepEqual(hole2, hole, 'the revised record is the one that is scored');
    assert.ok(hole2.strokesSoFar === oldShot + 1 || hole2.strokes === oldShot + 1);
  });
});

test('4a. stop after copy 20, start again on the same folder, post 21 to 38: the known answer', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 20);
  });
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 20, 38);
    assertKnownAnswer(await rounds(url));
  });
});

test('4b. a server started on the full journal with nothing posted gives the known answer', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 38);
  });
  await withHub(dir, {}, async (url) => {
    assertKnownAnswer(await rounds(url));
  });
});

test('5a. a journal whose last line is cut short starts, skips it, and keeps what is before it', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 38);
  });
  const lines = journalLines(dir);
  assert.ok(lines.length >= 3);
  // the last line is cut in half; what is before it is the journal as it was before that batch
  const kept = lines.slice(0, -1);
  const last = lines[lines.length - 1]!;
  writeFileSync(journalOf(dir), `${kept.join('\n')}\n${last.slice(0, Math.floor(last.length / 2))}`);
  const expectedDir = tempDir();
  writeFileSync(journalOf(expectedDir), `${kept.join('\n')}\n`);
  const expected = await answerOf(expectedDir);
  const warnings: string[] = [];
  await withHub(dir, { warn: (l) => warnings.push(l) }, async (url) => {
    assert.equal(warnings.length, 1);
    assert.deepEqual(await rounds(url), expected);
    // the next batch lands on a clean line, so the file is whole again after a restart
    await postCopies(url, 0, 38);
  });
  assertKnownAnswer(await answerOf(dir));
});

test('5b. a journal with a broken line in the middle refuses to start', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 5);
  });
  const lines = journalLines(dir);
  assert.ok(lines.length >= 3);
  lines[2] = lines[2]!.slice(0, 20);
  writeFileSync(journalOf(dir), `${lines.join('\n')}\n`);
  const hub = createHub({ dataDir: dir, port: 0, ...quiet });
  try {
    await assert.rejects(() => hub.listen(), /corrupt/);
    assert.equal(hub.address(), undefined);
  } finally {
    await hub.close();
  }
});

test('6. bad JSON, no records, and a record missing HoleResult answer 400 and change nothing', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 10);
    const before = await rounds(url);
    const size = journalSize(dir);
    const rawBody = async (body: string) => {
      const res = await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return { status: res.status, body: (await res.json()) as any };
    };
    assert.deepEqual(await rawBody('{not json'), { status: 400, body: { error: 'bad_json' } });
    assert.deepEqual(await rawBody('{"other":[]}'), { status: 400, body: { error: 'bad_shape' } });
    assert.deepEqual(await rawBody('[1,2]'), { status: 400, body: { error: 'bad_shape' } });
    assert.deepEqual(await rawBody('{"records":"x"}'), { status: 400, body: { error: 'bad_shape' } });
    // a good record first, then one missing HoleResult: the whole batch is refused
    const good = structuredClone(copies[37]!.records[0]!) as any;
    const bad = structuredClone(copies[37]!.records[1]!) as any;
    delete bad.HoleResult;
    assert.deepEqual(await rawBody(JSON.stringify({ records: [good, bad] })), { status: 400, body: { error: 'unknown_layout' } });
    assert.deepEqual(await rounds(url), before);
    assert.equal(journalSize(dir), size);
  });
});

test('7a. a body over the limit answers 413 and the journal does not grow', async () => {
  const dir = tempDir();
  const small = JSON.stringify({ records: copies[0]!.records }).length;
  await withHub(dir, { maxBodyBytes: small + 10 }, async (url) => {
    await postCopies(url, 0, 1);
    const size = journalSize(dir);
    const big = JSON.stringify({ records: copies[37]!.records });
    assert.ok(big.length > small + 10);
    const res = await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
    assert.equal(res.status, 413);
    assert.equal(journalSize(dir), size);
  });
});

test('7b. a real body over 32 MB is refused with 413 (or the connection is cut) and the journal does not grow', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    const u = new URL(url);
    const status = await new Promise<number | 'cut'>((resolve) => {
      const req = request({ host: u.hostname, port: u.port, path: '/v0/shots', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', () => resolve('cut'));
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      let sent = 0;
      const pump = (): void => {
        while (sent < 34) {
          sent++;
          if (!req.write(chunk)) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      pump();
    });
    assert.ok(status === 413 || status === 'cut', `status ${String(status)}`);
    assert.equal(journalSize(dir), 0);
  });
});

test('8. wrong method answers 405, unknown path 404', async () => {
  await withHub(tempDir(), {}, async (url) => {
    const a = await fetch(`${url}/v0/shots`);
    assert.equal(a.status, 405);
    const b = await fetch(`${url}/v0/rounds`, { method: 'POST', body: '{}' });
    assert.equal(b.status, 405);
    const c = await fetch(`${url}/nope`);
    assert.equal(c.status, 404);
    const d = await fetch(`${url}/healthz`);
    assert.equal(d.status, 200);
    assert.deepEqual(await d.json(), { ok: true });
    for (const r of [a, b, c, d]) assert.equal(r.headers.get('content-type'), 'application/json');
  });
});

test('9. the bound address is 127.0.0.1', async () => {
  const hub = createHub({ dataDir: tempDir(), port: 0, ...quiet });
  try {
    assert.equal(hub.address(), undefined);
    const a = await hub.listen();
    assert.equal(a.host, '127.0.0.1');
    assert.equal(hub.address()?.host, '127.0.0.1');
    assert.ok(a.port > 0);
  } finally {
    await hub.close();
  }
  assert.equal(hub.address(), undefined);
});

test('10. no answer carries an Access-Control-Allow-Origin header', async () => {
  await withHub(tempDir(), {}, async (url) => {
    const heads: Headers[] = [];
    heads.push((await fetch(`${url}/healthz`, { headers: { Origin: 'http://example.test' } })).headers);
    heads.push((await fetch(`${url}/v0/rounds`, { headers: { Origin: 'http://example.test' } })).headers);
    heads.push((await fetch(`${url}/v0/shots`, { method: 'OPTIONS', headers: { Origin: 'http://example.test' } })).headers);
    heads.push((await post(url, copies[0]!.records)).headers);
    heads.push((await fetch(`${url}/nope`)).headers);
    for (const h of heads) assert.equal(h.get('access-control-allow-origin'), null);
  });
});

test('11. the replay tool run against a test server prints the known scorecard', async () => {
  await withHub(tempDir(), {}, async (url) => {
    const script = join(HERE, '../src/replay.ts');
    const out = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, ['--import', 'tsx/esm', script, '--url', url], { cwd: ROOT }, (err, stdout, stderr) => {
        if (err) reject(new Error(`replay exited with an error: ${stderr}`));
        else resolve(stdout);
      });
    });
    assert.match(out, /ZZTEST-A/);
    assert.match(out, /ZZTEST-B/);
    assert.match(out, /total 18/);
    assert.match(out, /total 20/);
    assertKnownAnswer(await rounds(url));
  });
});

test('12. nothing a request contained appears in what the server wrote to the console', async () => {
  const NAME = 'QQNAME-7f3a9c';
  const GUID = 'QQGUID-51d2e8';
  const SHOT = 'QQSHOT-c04b17';
  const seen: string[] = [];
  const keep = (...a: unknown[]): void => void seen.push(a.map(String).join(' '));
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = keep;
  console.warn = keep;
  console.error = keep;
  console.info = keep;
  const hub = createHub({ dataDir: tempDir(), port: 0 });
  try {
    const a = await hub.listen();
    const url = `http://${a.host}:${a.port}`;
    const rec = structuredClone(copies[37]!.records[0]!) as any;
    rec.PlayerName = NAME;
    rec.UserGuid = GUID;
    rec.ShotID = SHOT;
    const ok = await post(url, [rec]);
    assert.equal(ok.status, 200);
    const bad = structuredClone(rec);
    delete bad.HoleResult;
    assert.equal((await post(url, [bad])).status, 400);
    await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"records": "${NAME}` });
    await fetch(`${url}/${NAME}?${GUID}=1`);
    await fetch(`${url}/v0/rounds?${SHOT}=1`);
    await raw(url, { path: `/${NAME}`, headers: { Host: `${NAME}.example` } });
  } finally {
    await hub.close();
    Object.assign(console, orig);
  }
  assert.ok(seen.length > 0, 'the server did write status lines');
  const text = seen.join('\n');
  for (const s of [NAME, GUID, SHOT]) assert.ok(!text.includes(s), `${s} leaked to the console`);
});

// ---- round 2, item A: the journal leaves out only a record the book provably already holds ----

test('13. the same whole copy posted twice adds nothing; all 38 copies journal 41 records; an empty post writes nothing', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 1);
    const size = journalSize(dir);
    assert.ok(size > 0);
    const again = await post(url, copies[0]!.records);
    assert.equal(again.status, 200);
    assert.equal(again.body.unchanged, copies[0]!.records.length);
    assert.equal(journalSize(dir), size, 'a whole copy posted twice must not grow the journal');
    await postCopies(url, 1, 38);
    assert.equal(journalRecordCount(dir), 41);
    const full = journalSize(dir);
    assert.equal((await post(url, copies[37]!.records)).status, 200);
    const empty = await post(url, []);
    assert.deepEqual([empty.status, empty.body], [200, { added: 0, revised: 0, unchanged: 0, conflicts: 0 }]);
    assert.equal(journalSize(dir), full);
    assertKnownAnswer(await rounds(url));
  });
});

test('13b. after a restart a copy the book already holds adds nothing to the journal', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 38);
  });
  const size = journalSize(dir);
  await withHub(dir, {}, async (url) => {
    for (const c of copies) assert.equal((await post(url, c.records)).status, 200);
    assert.equal(journalSize(dir), size, 'the table is rebuilt from the journal at start');
  });
});

/** The live answer and the answer of a hub started on the same folder afterwards. */
async function assertRestartEqualsLive(dir: string, hub: Hub, url: string, label: string): Promise<void> {
  const live = await rounds(url);
  await hub.close(); // one hub per data folder: the first lets go before the second starts
  assert.deepEqual(await answerOf(dir), live, label);
}

test('14. post [A], then [A, B] (B is A with HoleShot one higher): journal holds A, then A and B; a restart equals live', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url, hub) => {
    const a = structuredClone(copies[37]!.records[0]!) as any;
    const b = { ...structuredClone(a), HoleShot: a.HoleShot + 1 };
    const one = await post(url, [a]);
    assert.deepEqual(one.body, { added: 1, revised: 0, unchanged: 0, conflicts: 0 });
    const two = await post(url, [a, b]);
    assert.deepEqual(two.body, { added: 0, revised: 0, unchanged: 1, conflicts: 1 });
    const lines = journalLines(dir).map((l) => JSON.parse(l) as unknown[]);
    assert.deepEqual(lines, [[a], [a, b]]);
    const live = await rounds(url);
    assert.equal(live.issues.length, 1);
    assert.equal(live.issues[0].kind, 'duplicate_shot_in_copy');
    await assertRestartEqualsLive(dir, hub, url, 'restart after the duplicate in one post');
  });
});

test('15. a changed owner posted twice: both lines are written and a restart equals live', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url, hub) => {
    const a = structuredClone(copies[37]!.records[0]!) as any;
    const a2 = { ...structuredClone(a), UserGuid: `${a.UserGuid}-other` };
    assert.equal((await post(url, [a])).status, 200);
    assert.deepEqual((await post(url, [a2])).body, { added: 0, revised: 0, unchanged: 0, conflicts: 1 });
    assert.deepEqual((await post(url, [a2])).body, { added: 0, revised: 0, unchanged: 0, conflicts: 1 });
    assert.deepEqual(journalLines(dir).map((l) => JSON.parse(l) as unknown[]), [[a], [a2], [a2]]);
    await assertRestartEqualsLive(dir, hub, url, 'restart after a changed owner');
  });
});

test('16. a record that changes and later changes back is written all three times', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url, hub) => {
    const a = structuredClone(copies[37]!.records[0]!) as any;
    const b = { ...structuredClone(a), HoleShot: a.HoleShot + 1 };
    for (const r of [a, b, a]) assert.equal((await post(url, [r])).status, 200);
    assert.equal(journalLines(dir).length, 3);
    await assertRestartEqualsLive(dir, hub, url, 'restart after a change and a change back');
  });
});

/** A fixed generator: no real randomness, so a failing sequence can be named and run again. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('17. replay equivalence: 250 seeded sequences of posts, and a restart answers what the live hub answers', async () => {
  const pool = copies[37]!.records as any[];
  assert.ok(pool.length >= 6);
  const SEQUENCES = 250;
  let okPosts = 0;
  let badPosts = 0;
  let conflictPosts = 0;
  for (let seq = 0; seq < SEQUENCES; seq++) {
    const rnd = mulberry32(1000 + seq);
    const pick = (n: number): number => Math.floor(rnd() * n);
    const rec = (): any => pool[rnd() < 0.7 ? pick(6) : pick(pool.length)];
    const bump = (r: any): any => ({ ...structuredClone(r), HoleShot: r.HoleShot + 1 });
    const steps = 4 + pick(8);
    const described: string[] = [];
    let last: unknown[] = [];
    const dir = tempDir();
    let live: any;
    await withHub(dir, {}, async (url) => {
      for (let s = 0; s < steps; s++) {
        const kind = pick(13);
        let records: unknown[];
        let what: string;
        if (kind === 0 && rnd() < 0.4) {
          const k = pick(copies.length);
          records = copies[k]!.records;
          what = `whole copy ${k}`;
        } else if (kind === 1) {
          const r = rec();
          records = [r];
          what = `single ${r.ShotID}`;
        } else if (kind === 2) {
          records = last;
          what = 'exact repeat of the last post';
        } else if (kind === 3) {
          const r = rec();
          records = [bump(r)];
          what = `changed field ${r.ShotID}`;
        } else if (kind === 4) {
          const r = rec();
          records = [r];
          what = `change back ${r.ShotID}`;
        } else if (kind === 5) {
          const r = rec();
          records = [{ ...structuredClone(r), UserGuid: `${r.UserGuid}-x` }];
          what = `changed owner ${r.ShotID}`;
        } else if (kind === 6) {
          const r = rec();
          records = [{ ...structuredClone(r), RoundID: r.RoundID + 100 }];
          what = `changed round ${r.ShotID}`;
        } else if (kind === 7) {
          const r = rec();
          records = [r, structuredClone(r)];
          what = `same id twice, same content ${r.ShotID}`;
        } else if (kind === 8) {
          const r = rec();
          records = [r, bump(r)];
          what = `same id twice, [r, changed] ${r.ShotID}`;
        } else if (kind === 9) {
          const r = rec();
          records = [bump(r), r];
          what = `same id twice, [changed, r] ${r.ShotID}`;
        } else if (kind === 10) {
          const r = rec();
          records = [r, bump(r), structuredClone(r)];
          what = `same id three times ${r.ShotID}`;
        } else if (kind === 11) {
          records = [];
          what = 'empty post';
        } else {
          const n = 1 + pick(5);
          const set: any[] = [];
          for (let i = 0; i < n; i++) {
            const r = rec();
            const m = pick(4);
            set.push(m === 0 ? bump(r) : m === 1 ? { ...structuredClone(r), UserGuid: `${r.UserGuid}-y` } : r);
          }
          records = set;
          what = `mixed ${set.length} records`;
        }
        described.push(what);
        last = records;
        const res = await post(url, records);
        if (res.status === 200) {
          okPosts++;
          if (res.body.conflicts > 0) conflictPosts++;
        } else if (res.status === 400) badPosts++;
        else assert.fail(`unexpected status ${res.status} in sequence ${seq}`);
      }
      live = await rounds(url);
    });
    const again = await answerOf(dir);
    assert.deepEqual(again, live, `sequence ${seq} (seed ${1000 + seq}) differs after a restart: ${described.join(' | ')}`);
  }
  assert.ok(okPosts > 1000, `only ${okPosts} accepted posts`);
  assert.ok(conflictPosts > 100, `only ${conflictPosts} posts with conflicts`);
  assert.equal(badPosts, 0, 'the generator builds only valid records');
});

// ---- item B: the start reads the journal in pieces ----

test('18. a journal of many lines read in small pieces: lines that straddle pieces are read right', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    // every record posted on its own, in recording order: many short lines
    for (const c of copies) for (const r of c.records) assert.equal((await post(url, [r])).status, 200);
  });
  assert.ok(journalLines(dir).length >= 41);
  for (const pieceBytes of [7, 997, 65536]) {
    await withHub(dir, { journal: { pieceBytes } }, async (url) => {
      assertKnownAnswer(await rounds(url));
    });
  }
});

test('19. a line longer than the limit is a bad line: refused in the middle, skipped as a cut-short last line', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 6);
  });
  const lines = journalLines(dir);
  const longest = Math.max(...lines.map((l) => l.length));
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, journal: { maxLineBytes: longest - 1 } });
  try {
    await assert.rejects(() => hub.listen(), /corrupt/);
  } finally {
    await hub.close();
  }
  // the same long line as an unterminated last line is cut off, with the one warning
  const short = lines.filter((l) => l.length < longest);
  writeFileSync(journalOf(dir), `${short.join('\n')}\n${lines.find((l) => l.length === longest)}`);
  const warnings: string[] = [];
  await withHub(dir, { journal: { maxLineBytes: longest - 1 }, warn: (l) => warnings.push(l) }, async () => {
    assert.equal(warnings.length, 1);
  });
  assert.equal(readFileSync(journalOf(dir), 'utf8'), `${short.join('\n')}\n`);
});

// ---- item C: who is asking ----

test('20. a post that is not application/json answers 415 and changes nothing', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 5);
    const before = await rounds(url);
    const size = journalSize(dir);
    const body = JSON.stringify({ records: [{ ...structuredClone(copies[37]!.records[0]!) as any, HoleShot: 9 }] });
    const plain = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': String(Buffer.byteLength(body)) }, body });
    assert.deepEqual([plain.status, plain.body], [415, { error: 'unsupported_media_type' }]);
    const none = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Length': String(Buffer.byteLength(body)) }, body });
    assert.deepEqual([none.status, none.body], [415, { error: 'unsupported_media_type' }]);
    const form = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    assert.equal(form.status, 415);
    assert.equal(journalSize(dir), size);
    assert.deepEqual(await rounds(url), before);
    // application/json with a charset, in any letter case, is accepted
    const ok = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'Application/JSON; charset=utf-8' }, body: JSON.stringify({ records: [] }) });
    assert.equal(ok.status, 200);
  });
});

test('21. a foreign Host answers 403 on every address and changes nothing; localhost:<port> is accepted', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 5);
    const before = await rounds(url);
    const size = journalSize(dir);
    const port = new URL(url).port;
    const body = JSON.stringify({ records: [{ ...structuredClone(copies[37]!.records[0]!) as any, HoleShot: 9 }] });
    const hosts = ['attacker.example', `attacker.example:${port}`, '127.0.0.1', 'localhost', `127.0.0.1:${Number(port) + 1}`, `localhost.attacker.example:${port}`];
    for (const Host of hosts) {
      const targets: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }> = [
        { method: 'GET', path: '/healthz', headers: {} },
        { method: 'GET', path: '/v0/rounds', headers: {} },
        { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/json' }, body },
        { method: 'GET', path: '/nope', headers: {} },
      ];
      for (const t of targets) {
        const r = await raw(url, { ...t, headers: { ...t.headers, Host } });
        assert.deepEqual([r.status, r.body], [403, { error: 'bad_host' }], `${t.method} ${t.path} with Host ${Host}`);
      }
    }
    // no Host at all (HTTP/1.0 allows that): the hub refuses it too
    const text = await new Promise<string>((resolve, reject) => {
      const s = connect(Number(port), '127.0.0.1', () => s.write('GET /v0/rounds HTTP/1.0\r\n\r\n'));
      const parts: Buffer[] = [];
      s.on('data', (c) => parts.push(c));
      s.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      s.on('error', reject);
    });
    assert.match(text, /^HTTP\/1\.1 403 /);
    assert.match(text, /"bad_host"/);
    assert.equal(journalSize(dir), size);
    assert.deepEqual(await rounds(url), before);
    for (const Host of [`127.0.0.1:${port}`, `localhost:${port}`, `LocalHost:${port}`]) {
      const r = await raw(url, { path: '/healthz', headers: { Host } });
      assert.deepEqual([r.status, r.body], [200, { ok: true }], `Host ${Host}`);
    }
    const viaName = await raw(url, { method: 'POST', path: '/v0/shots', headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ records: copies[5]!.records }) });
    assert.equal(viaName.status, 200);
  });
});

// ---- item D: a failed journal write leaves the file whole ----

function faults() {
  const f = { write: 'none' as 'none' | 'half' | 'clean', truncate: false };
  const io = {
    write: (fd: number, buf: Buffer, off: number, len: number, position: number): number => {
      if (f.write === 'half') {
        writeSync(fd, buf, off, Math.max(1, Math.floor(len / 2)), position);
        throw new Error('disk full (test)');
      }
      if (f.write === 'clean') throw new Error('write failed (test)');
      return writeSync(fd, buf, off, len, position);
    },
    truncate: (fd: number, length: number): void => {
      if (f.truncate) throw new Error('cut failed (test)');
      ftruncateSync(fd, length);
    },
  };
  return { f, io };
}

for (const mode of ['half', 'clean'] as const) {
  test(`22-${mode}. a write that fails (${mode}): 500, nothing changes, later copies answer 200, a restart equals a straight run`, async () => {
    const dir = tempDir();
    const { f, io } = faults();
    const straight = await straightRun(38);
    await withHub(dir, { journal: { io } }, async (url) => {
      await postCopies(url, 0, 20);
      const before = await rounds(url);
      const size = journalSize(dir);
      f.write = mode;
      const failed = await post(url, copies[20]!.records);
      assert.deepEqual([failed.status, failed.body], [500, { error: 'internal' }]);
      f.write = 'none';
      assert.deepEqual(await rounds(url), before, 'the book is as it was before the failed post');
      assert.equal(journalSize(dir), size, 'the file is cut back to its last good length');
      assert.equal((await post(url, copies[5]!.records)).status, 200);
      assert.equal(journalSize(dir), size, 'after the rebuild the table still knows what the book holds: a held copy adds nothing');
      await postCopies(url, 20, 38);
      assert.deepEqual(await rounds(url), straight);
    });
    assert.deepEqual(await answerOf(dir), straight);
  });
}

test('23. after a failed half write a small post, then a restart: no stale bytes, no warning, every line whole', async () => {
  const dir = tempDir();
  const { f, io } = faults();
  await withHub(dir, { journal: { io } }, async (url) => {
    await postCopies(url, 0, 30);
    f.write = 'half';
    // a big post (every record of the last copy, each with one more stroke): its half line is longer than the small post after it
    const big = (copies[37]!.records as any[]).map((r) => ({ ...structuredClone(r), HoleShot: r.HoleShot + 1 }));
    assert.equal((await post(url, big)).status, 500);
    f.write = 'none';
    const rec = structuredClone(copies[0]!.records[0]!) as any;
    rec.HoleShot += 1;
    assert.equal((await post(url, [rec])).status, 200);
  });
  const text = readFileSync(journalOf(dir), 'utf8');
  assert.ok(text.endsWith('\n'));
  for (const l of text.split('\n').filter((x) => x !== '')) assert.ok(Array.isArray(JSON.parse(l)));
  const warnings: string[] = [];
  await withHub(dir, { warn: (l) => warnings.push(l) }, async () => {
    assert.deepEqual(warnings, []);
  });
});

test('24. a write that fails and a cut that fails: 503 journal_unavailable on every later post, GET still answers, a restart opens', async () => {
  const dir = tempDir();
  const { f, io } = faults();
  const upTo19 = await straightRun(20);
  await withHub(dir, { journal: { io } }, async (url) => {
    await postCopies(url, 0, 20);
    f.write = 'half';
    f.truncate = true;
    const failed = await post(url, copies[20]!.records);
    assert.deepEqual([failed.status, failed.body], [500, { error: 'internal' }]);
    f.write = 'none';
    f.truncate = false;
    for (const c of [copies[21]!, copies[22]!]) {
      const r = await post(url, c.records);
      assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }]);
    }
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.deepEqual(await rounds(url), upTo19);
  });
  assert.ok(!readFileSync(journalOf(dir), 'utf8').endsWith('\n'), 'the half line is the last line');
  const warnings: string[] = [];
  await withHub(dir, { warn: (l) => warnings.push(l) }, async (url) => {
    assert.equal(warnings.length, 1);
    assert.deepEqual(await rounds(url), upTo19);
  });
});

// ---- item F: at most four posts at once ----

test('25. five posts held open at once: the fifth answers 503 busy with Retry-After 1; the held ones finish', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    const u = new URL(url);
    const body = JSON.stringify({ records: copies[0]!.records });
    const held: Array<{ done: Promise<number>; finish: () => void; kill: () => void }> = [];
    try {
      for (let i = 0; i < 4; i++) {
        let resolveDone: (n: number) => void = () => undefined;
        const done = new Promise<number>((r) => (resolveDone = r));
        const req = request({ host: u.hostname, port: u.port, path: '/v0/shots', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } }, (res) => {
          res.resume();
          resolveDone(res.statusCode ?? 0);
        });
        req.on('error', () => resolveDone(0));
        req.write(body.slice(0, 10));
        held.push({ done, finish: () => req.end(body.slice(10)), kill: () => req.destroy() });
      }
      let fifth: Raw | undefined;
      for (let i = 0; i < 100; i++) {
        const r = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/json' }, body: '{"records":[]}' });
        if (r.status === 503) {
          fifth = r;
          break;
        }
        await new Promise((r2) => setTimeout(r2, 20));
      }
      assert.ok(fifth, 'a fifth post was never refused');
      assert.deepEqual(fifth.body, { error: 'busy' });
      assert.equal(fifth.headers['retry-after'], '1');
      for (const h of held) h.finish();
      assert.deepEqual(await Promise.all(held.map((h) => h.done)), [200, 200, 200, 200]);
      assert.equal((await post(url, [])).status, 200, 'room again once the held posts are done');
    } finally {
      for (const h of held) h.kill();
    }
  });
});

// ---- item G: all at once ----

test('26. all 38 copies sent at the same moment: 38 answers 200 (a busy answer is retried) and a restart equals live', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url, hub) => {
    const sendOne = async (c: Copy): Promise<number> => {
      for (let attempt = 0; attempt < 400; attempt++) {
        const r = await post(url, c.records);
        if (r.status !== 503) return r.status;
        assert.deepEqual(r.body, { error: 'busy' });
        await new Promise((res) => setTimeout(res, 20));
      }
      return 503;
    };
    const statuses = await Promise.all(copies.map((c) => sendOne(c)));
    assert.deepEqual(statuses, copies.map(() => 200));
    await assertRestartEqualsLive(dir, hub, url, 'restart after 38 posts sent at once');
  });
});

// ---- item H ----

test('27. importing the replay tool does nothing', async () => {
  const href = pathToFileURL(join(HERE, '../src/replay.ts')).href;
  const code = `globalThis.fetch = () => { console.log('FETCHED'); return Promise.reject(new Error('no')); }; import(${JSON.stringify(href)}).then(() => console.log('IMPORTED'));`;
  const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ['--import', 'tsx/esm', '-e', code], { cwd: ROOT }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0, stdout, stderr });
    });
  });
  assert.equal(out.stdout.trim(), 'IMPORTED', out.stderr);
  assert.equal(out.code, 0);
});

// ---- round 4: a line the hub could not read back is never written; one hub per data folder ----

test('28. a post whose journal line would be longer than the limit answers 413 and changes nothing; a restart equals live', async () => {
  const dir = tempDir();
  const rec = structuredClone(copies[37]!.records[0]!) as any;
  const big = structuredClone(copies[37]!.records[1]!) as any;
  // the reviewer's case: 1e20 is 4 bytes in the body and 21 bytes in the journal line
  const text = JSON.stringify(big);
  const LIMIT = text.length + 20000; // a normal record fits; 2000 values of 1e20 (10 KB in the body, 44 KB in the line) do not
  const pad = Array.from({ length: 2000 }, () => '1e20').join(',');
  const body = `{"records":[${text.slice(0, -1)},"Pad":[${pad}]}]}`;
  assert.ok(Buffer.byteLength(body) < LIMIT, 'the body itself is inside the limit');
  await withHub(dir, { journal: { maxLineBytes: LIMIT } }, async (url, hub) => {
    assert.equal((await post(url, [rec])).status, 200);
    const before = await rounds(url);
    const size = journalSize(dir);
    const r = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/json' }, body });
    assert.deepEqual([r.status, r.body], [413, { error: 'too_large' }]);
    assert.equal(journalSize(dir), size);
    assert.deepEqual(await rounds(url), before);
    // the table did not move either: the same record, small, is still written
    assert.equal((await post(url, [{ ...rec, HoleShot: rec.HoleShot + 1 }])).status, 200);
    await assertRestartEqualsLive(dir, hub, url, 'restart after a refused long line');
  });
});

test('29. a second hub on the same data folder is refused and changes nothing, while the first keeps answering', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 10);
    // a cut-short last line, as a crash would leave it: a second hub that opened the journal first would repair it
    appendFileSync(journalOf(dir), '[{"ShotID":"cut');
    const size = journalSize(dir);
    assert.deepEqual(lockFiles(dir), ['hub.lock.1']);
    const lock = readFileSync(join(dir, 'hub.lock.1'), 'utf8');
    const second = createHub({ dataDir: dir, port: 0, ...quiet });
    try {
      await assert.rejects(() => second.listen(), /holds this data folder/);
      assert.equal(second.address(), undefined);
    } finally {
      await second.close();
    }
    assert.equal(journalSize(dir), size, 'the refused hub did not touch the journal');
    assert.equal(readFileSync(join(dir, 'hub.lock.1'), 'utf8'), lock, 'the lock is the first hub\'s');
    assert.deepEqual(lockFiles(dir), ['hub.lock.1']);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  });
  assert.deepEqual(lockFiles(dir), [], 'close removes the lock');
});

test('30. a stale lock (its process is gone) is taken over, with one line saying so', async () => {
  const dir = tempDir();
  const gone = await deadPid();
  writeFileSync(join(dir, 'hub.lock.1'), `${gone} 000000000000000000000000\n`);
  const said: string[] = [];
  await withHub(dir, { warn: (l) => said.push(l) }, async (url) => {
    assert.equal(said.length, 1);
    assert.match(said[0]!, /replaced/);
    assert.deepEqual(lockFiles(dir), ['hub.lock.1', 'hub.lock.2'], 'the new lock is the next number; its predecessor is kept');
    assert.equal(readFileSync(join(dir, 'hub.lock.2'), 'utf8').split(' ')[0], String(process.pid));
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  });
  assert.deepEqual(lockFiles(dir), ['hub.lock.1'], 'close removes its own lock only');
});

test('31. a busy port leaves the folder as it was and removes the lock', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 5);
  });
  const before = readFileSync(journalOf(dir));
  const files = readdirSync(dir).sort();
  const blocker = createNetServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
  try {
    const port = (blocker.address() as { port: number }).port;
    const hub = createHub({ dataDir: dir, port, ...quiet });
    try {
      await assert.rejects(() => hub.listen());
      // checked before close(): a failed start must clean up after itself, not leave it to close()
      assert.deepEqual(readdirSync(dir).sort(), files);
      assert.ok(readFileSync(journalOf(dir)).equals(before));
    } finally {
      await hub.close();
    }
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('32. a post the client dropped before its body ended is logged as aborted, not 500', async () => {
  const lines: string[] = [];
  await withHub(tempDir(), { log: (l) => lines.push(l) }, async (url) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: '/v0/shots', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' } });
    req.on('error', () => undefined);
    req.write('{"records":');
    for (let i = 0; i < 100 && !lines.some((l) => l.includes('aborted')); i++) {
      if (i === 5) req.destroy();
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(lines.includes('POST /v0/shots aborted'), lines.join(' | '));
    assert.ok(!lines.some((l) => l.includes(' 500')), 'a dropped client is not an internal error');
  });
});

test('33. the replay tool runs as a command when started through a link to its folder', async (t) => {
  const linkDir = tempDir();
  const link = join(linkDir, 'src-link');
  try {
    symlinkSync(join(HERE, '../src'), link, 'junction');
  } catch {
    t.diagnostic('the OS did not allow a link or junction here: this test did not run');
    return;
  }
  await withHub(tempDir(), {}, async (url) => {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, ['--import', 'tsx/esm', join(link, 'replay.ts'), '--url', url], { cwd: ROOT }, (err, stdout, stderr) => {
        if (err) reject(new Error(`replay exited with an error: ${stderr}`));
        else resolve(stdout);
      });
    });
    assert.match(out, /total 18/);
    assertKnownAnswer(await rounds(url));
  });
});

test('34. the journal is synced after each write and before the answer is sent', async () => {
  const events: string[] = [];
  const io = {
    write: (fd: number, buf: Buffer, off: number, len: number, position: number): number => {
      events.push('write');
      return writeSync(fd, buf, off, len, position);
    },
    sync: (fd: number): void => {
      events.push('sync');
      fsyncSync(fd);
    },
  };
  await withHub(tempDir(), { journal: { io } }, async (url) => {
    await postCopies(url, 0, 1);
    events.push('answer');
    await postCopies(url, 0, 1); // nothing to write: nothing to sync
    assert.deepEqual(events, ['write', 'sync', 'answer']);
    const rec = structuredClone(copies[0]!.records[0]!) as any;
    rec.HoleShot += 1;
    events.length = 0;
    assert.equal((await post(url, [rec])).status, 200);
    events.push('answer');
    assert.deepEqual(events, ['write', 'sync', 'answer']);
  });
});

// ---- round 5: one winner on a stale lock; the library judges a post first; a failed start leaves the folder alone ----

let redrawn = 0;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The numbered lock files of a folder, lowest number first. */
function lockFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => /^hub\.lock\.[1-9][0-9]*$/.test(n))
    .sort((x, y) => Number(x.slice(9)) - Number(y.slice(9)));
}

/** A process id that is not running: a child the test started and waited to exit, checked just before it is used. */
async function deadPid(): Promise<number> {
  for (;;) {
    const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    const pid = child.pid!;
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    if (!isRunning(pid)) return pid;
    redrawn++;
  }
}

function startStarters(dir: string, starters: number, mode = 'plain', arg = ''): Kid[] {
  const startAt = Date.now() + 700;
  return Array.from({ length: starters }, () => spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(HERE, 'lock-child.mjs'), dir, String(startAt), mode, arg], { stdio: ['pipe', 'pipe', 'inherit'] }));
}

/** The lines a starter says, one at a time. A starter that exits says DIED. */
function lineQueue(k: Kid): { next(): Promise<string> } {
  const ready: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  let partial = '';
  let exited = false;
  k.stdout.on('data', (c: Buffer) => {
    partial += c.toString('utf8');
    for (let i = partial.indexOf('\n'); i >= 0; i = partial.indexOf('\n')) {
      const line = partial.slice(0, i);
      partial = partial.slice(i + 1);
      const w = waiting.shift();
      if (w) w(line);
      else ready.push(line);
    }
  });
  k.on('exit', () => {
    exited = true;
    for (const w of waiting.splice(0)) w('DIED');
  });
  return { next: () => (ready.length > 0 ? Promise.resolve(ready.shift()!) : exited ? Promise.resolve('DIED') : new Promise<string>((resolve) => waiting.push(resolve))) };
}

async function waitExit(k: Kid): Promise<void> {
  if (k.exitCode === null && k.signalCode === null) await new Promise<void>((resolve) => k.once('exit', () => resolve()));
}

function firstLine(k: Kid): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = '';
    k.stdout.on('data', (c: Buffer) => {
      text += c.toString('utf8');
      if (text.includes('\n')) resolve(text.trim());
    });
    k.on('error', reject);
    k.on('exit', () => resolve(text.trim() || 'DIED'));
  });
}

async function stopStarters(kids: Kid[]): Promise<void> {
  for (const k of kids) {
    k.stdin.end();
    k.kill();
  }
  await Promise.all(kids.map((k) => waitExit(k)));
}

type Trial = { redraw: true } | { redraw: false; results: string[]; winnerPid: number; dir: string; journalSame: boolean };

/** N starters, separate processes, leave the line together on a folder whose current lock's holder is not running. */
async function raceOnStaleLock(starters: number, leftovers: boolean): Promise<Trial> {
  const dir = tempDir();
  const dead = await deadPid();
  const journal = Buffer.from('[{"kept":"as it is"}]\n');
  writeFileSync(join(dir, 'journal.jsonl'), journal);
  writeFileSync(join(dir, 'hub.lock.1'), `${dead} 000000000000000000000000\n`);
  if (leftovers) {
    writeFileSync(join(dir, 'hub.lock.takeover'), `${dead}\n`); // a guard left by the round-5 layout
    writeFileSync(join(dir, `hub.lock.tmp-${dead}-abcdef`), `${dead} half\n`); // a temporary file of a starter that died
  }
  const kids = startStarters(dir, starters);
  try {
    const results = await Promise.all(kids.map(firstLine));
    if (isRunning(dead)) return { redraw: true }; // the "dead" id turned out to be running again: draw again
    const winner = kids[results.indexOf('WON')];
    return { redraw: false, results, winnerPid: winner?.pid ?? -1, dir, journalSame: readFileSync(join(dir, 'journal.jsonl')).equals(journal) };
  } finally {
    await stopStarters(kids);
  }
}

for (const [starters, leftovers] of [[2, false], [4, false], [2, true], [4, true]] as const) {
  test(`35-${starters}${leftovers ? 'L' : ''}. 40 trials of ${starters} starters racing on a stale lock${leftovers ? ' (with a leftover takeover file and a dead starter\'s temporary file)' : ''}: exactly one wins every time`, { timeout: 400000 }, async (t) => {
    const TRIALS = 40;
    let done = 0;
    let redraws = 0;
    while (done < TRIALS) {
      const r = await raceOnStaleLock(starters, leftovers);
      if (r.redraw) {
        redraws++;
        continue;
      }
      const label = `trial ${done}: ${r.results.join(',')}`;
      assert.equal(r.results.filter((x) => x === 'WON').length, 1, label);
      assert.equal(r.results.filter((x) => x === 'REFUSED').length, starters - 1, label);
      const locks = lockFiles(r.dir);
      assert.deepEqual(locks, ['hub.lock.1', 'hub.lock.2'], `${label}: the winner's lock and its predecessor`);
      assert.equal(Number(readFileSync(join(r.dir, 'hub.lock.2'), 'utf8').split(' ')[0]), r.winnerPid, `${label}: the lock names the winner`);
      assert.deepEqual(readdirSync(r.dir).filter((n) => n.startsWith('hub.lock.tmp-')), [], `${label}: no temporary file is left`);
      if (leftovers) assert.ok(existsSync(join(r.dir, 'hub.lock.takeover')), 'a leftover takeover file is not a lock and is left alone');
      assert.ok(r.journalSame, `${label}: the journal is as it was`);
      done++;
    }
    t.diagnostic(`${done} trials of ${starters} starters, ${redraws} drawn again because the dead id was running again; all had exactly one winner`);
  });
}

test('35-chain. six generations: start, kill without close, start again: at most two numbered lock files each time', { timeout: 120000 }, async () => {
  const dir = tempDir();
  for (let g = 1; g <= 6; g++) {
    const kids = startStarters(dir, 1);
    try {
      assert.equal(await firstLine(kids[0]!), 'WON', `generation ${g}`);
      const locks = lockFiles(dir);
      assert.deepEqual(locks, g === 1 ? ['hub.lock.1'] : [`hub.lock.${g - 1}`, `hub.lock.${g}`], `generation ${g}: at most two, the newest and its predecessor`);
    } finally {
      kids[0]!.kill(); // hard: no close, the lock is left behind
      await waitExit(kids[0]!);
    }
  }
});

test('36. a hub whose lock was replaced by another hub leaves that lock in place on close', async () => {
  const dir = tempDir();
  const other = `${process.pid} some-other-hubs-token\n`;
  await withHub(dir, {}, async () => {
    writeFileSync(join(dir, 'hub.lock.1'), other); // another hub's lock now sits where this hub's was
  });
  assert.equal(readFileSync(join(dir, 'hub.lock.1'), 'utf8'), other);
  rmSync(join(dir, 'hub.lock.1'));
  const foreign = `${await deadPid()} foreign\n`;
  await withHub(dir, {}, async () => {
    writeFileSync(join(dir, 'hub.lock.1'), foreign);
  });
  assert.equal(readFileSync(join(dir, 'hub.lock.1'), 'utf8'), foreign);
});

test('42. a start that fails on the lock gives a plain message with no part of the folder path', async () => {
  const messages: string[] = [];
  const attempt = async (dir: string): Promise<void> => {
    const hub = createHub({ dataDir: dir, port: 0, ...quiet });
    let started = false;
    try {
      await hub.listen();
      started = true;
    } catch (e) {
      messages.push(e instanceof Error ? e.message : String(e));
    } finally {
      await hub.close();
    }
    assert.equal(started, false, 'the start should have been refused');
  };
  const noPath = (dir: string, message: string): void => {
    assert.ok(!message.includes(dir), message);
    assert.ok(!message.toLowerCase().includes(basename(dir).toLowerCase()), message);
    assert.ok(!message.toLowerCase().includes(basename(dirname(dir)).toLowerCase()), message);
  };
  // 1. a folder that is not a folder
  const notAFolder = join(tempDir(), 'plain-file');
  writeFileSync(notAFolder, 'x');
  await attempt(notAFolder);
  noPath(notAFolder, messages[0]!);
  // 2. a lock file that cannot be read (a directory by that name)
  const dir2 = tempDir();
  mkdirSync(join(dir2, 'hub.lock.3'));
  await attempt(dir2);
  noPath(dir2, messages[1]!);
  assert.match(messages[1]!, /hub\.lock\.3/);
  // 3. a lock file that is not one this hub could have written
  const dir3 = tempDir();
  writeFileSync(join(dir3, 'hub.lock.2'), 'not a lock');
  await attempt(dir3);
  noPath(dir3, messages[2]!);
  assert.match(messages[2]!, /hub\.lock\.2/);
  assert.match(messages[2]!, /delete/);
  // 4. a folder with a read-only numbered lock of a running process is a plain live-holder refusal
  const dir4 = tempDir();
  const other = await stranger();
  try {
    writeFileSync(join(dir4, 'hub.lock.5'), `${other.pid} 000000000000000000000000\n`);
    await attempt(dir4);
  } finally {
    other.kill();
  }
  noPath(dir4, messages[3]!);
});

for (const depth of [10000, 100000]) {
  test(`37-${depth}. a record nested ${depth} deep answers 400 unknown_layout (not 500), changes nothing, and a restart equals live`, async () => {
    const dir = tempDir();
    const base = JSON.stringify(copies[37]!.records[1]!);
    const body = `{"records":[${base.slice(0, -1)},"Deep":${'['.repeat(depth)}${']'.repeat(depth)}}]}`;
    await withHub(dir, {}, async (url, hub) => {
      await postCopies(url, 0, 3);
      const before = await rounds(url);
      const size = journalSize(dir);
      const r = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/json' }, body });
      assert.deepEqual([r.status, r.body], [400, { error: 'unknown_layout' }]);
      assert.equal(journalSize(dir), size);
      assert.deepEqual(await rounds(url), before);
      await assertRestartEqualsLive(dir, hub, url, 'restart after a record nested too deep');
    });
  });
}

test('38. the line check counts bytes, and to the byte', async () => {
  const rec = structuredClone(copies[37]!.records[0]!) as any;
  const wide = { ...structuredClone(rec), Pad: '\u00e9'.repeat(200) }; // 200 characters, 400 bytes in the line
  const lineBytes = (r: unknown): number => Buffer.byteLength(JSON.stringify([r]), 'utf8');
  const lineChars = (r: unknown): number => JSON.stringify([r]).length;
  assert.equal(lineBytes(wide), lineChars(wide) + 200);
  const tryPost = async (record: unknown, maxLineBytes: number): Promise<number> => {
    let status = 0;
    await withHub(tempDir(), { journal: { maxLineBytes } }, async (url) => {
      status = (await post(url, [record])).status;
    });
    return status;
  };
  // under the limit in characters, over it in bytes: refused
  assert.equal(await tryPost(wide, lineChars(wide)), 413);
  assert.equal(await tryPost(wide, lineChars(wide) + 199), 413);
  // exactly the limit passes, one byte more does not
  assert.equal(await tryPost(wide, lineBytes(wide)), 200);
  assert.equal(await tryPost(wide, lineBytes(wide) - 1), 413);
  assert.equal(await tryPost(rec, lineBytes(rec)), 200);
  assert.equal(await tryPost(rec, lineBytes(rec) - 1), 413);
});

test('39. a busy port on a brand-new folder leaves no journal', async () => {
  const dir = join(tempDir(), 'fresh');
  const blocker = createNetServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
  try {
    const hub = createHub({ dataDir: dir, port: (blocker.address() as { port: number }).port, ...quiet });
    try {
      await assert.rejects(() => hub.listen());
      assert.deepEqual(readdirSync(dir), [], 'nothing but the folder itself is left (it was made for the lock)');
    } finally {
      await hub.close();
    }
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('40. a busy port leaves a journal with a cut-short last line byte for byte as it was', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 5);
  });
  appendFileSync(journalOf(dir), '[{"ShotID":"cut');
  const before = readFileSync(journalOf(dir));
  const blocker = createNetServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
  try {
    const hub = createHub({ dataDir: dir, port: (blocker.address() as { port: number }).port, ...quiet });
    try {
      await assert.rejects(() => hub.listen());
      assert.ok(readFileSync(journalOf(dir)).equals(before));
      assert.deepEqual(readdirSync(dir).sort(), ['journal.jsonl']);
    } finally {
      await hub.close();
    }
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test('41. while the journal is replayed every request answers 503 busy; afterwards the hub answers', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    await postCopies(url, 0, 38);
  });
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, journal: { pieceBytes: 256 } });
  try {
    let done = false;
    const started = hub.listen().finally(() => {
      done = true;
    });
    let address: { host: string; port: number } | undefined;
    while (!done && (address = hub.address()) === undefined) await new Promise((r) => setImmediate(r));
    assert.ok(address, 'the port is bound before the replay: the address is known while it runs');
    let busy: Raw | undefined;
    while (!done && busy === undefined) {
      const r = await raw(`http://${address.host}:${address.port}`, { path: '/healthz', headers: { Host: `127.0.0.1:${address.port}` } });
      if (r.status === 503) busy = r;
    }
    assert.ok(busy, 'a request during the replay was never answered busy');
    assert.deepEqual(busy.body, { error: 'busy' });
    assert.equal(busy.headers['retry-after'], '1');
    await started;
    assertKnownAnswer(await rounds(`http://${address.host}:${address.port}`));
  } finally {
    await hub.close();
  }
});

// ---- round 7: the re-list is guarded; crashes and Windows races at the hooks; no folder path from the journal ----

const GOOD_TOKEN = '0'.repeat(24);

/** A running process that is not a hub (it ends on its own after 60 seconds). */
async function stranger(): Promise<{ pid: number; kill: () => void }> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { pid: child.pid!, kill: () => void child.kill() };
}

test('43. a starter asleep while two generations pass is refused, and exactly one hub holds a lock (10 trials)', { timeout: 240000 }, async (t) => {
  const TRIALS = 10;
  let done = 0;
  let redraws = 0;
  while (done < TRIALS) {
    const dir = tempDir();
    const dead = await deadPid();
    writeFileSync(join(dir, 'hub.lock.1'), `${dead} ${GOOD_TOKEN}\n`);
    const go = join(tempDir(), 'go');
    const slow = startStarters(dir, 1, 'slow', go)[0]!;
    const slowSays = lineQueue(slow);
    const others: Kid[] = [];
    try {
      assert.equal(await slowSays.next(), 'PAUSED', 'the slow starter has listed the folder and is waiting before its link');
      // two hubs are started and killed without their close, then a live one takes the lock
      let live: Kid | undefined;
      for (let g = 1; g <= 3; g++) {
        const k = startStarters(dir, 1)[0]!;
        others.push(k);
        assert.equal(await lineQueue(k).next(), 'WON', `generation ${g}`);
        if (g < 3) {
          k.kill();
          await waitExit(k);
        } else live = k;
      }
      writeFileSync(go, 'go');
      const verdict = await slowSays.next();
      if (isRunning(dead)) {
        redraws++;
        continue;
      }
      assert.equal(verdict, 'REFUSED', `trial ${done}: the slow starter must end refused`);
      assert.deepEqual(lockFiles(dir), ['hub.lock.3', 'hub.lock.4'], `trial ${done}`);
      assert.equal(Number(readFileSync(join(dir, 'hub.lock.4'), 'utf8').split(' ')[0]), live!.pid, `trial ${done}: the one lock is the live hub's`);
      done++;
    } finally {
      await stopStarters([slow, ...others]);
    }
  }
  t.diagnostic(`${done} trials, ${redraws} drawn again; the slow starter was refused and one hub held the lock in every trial`);
});

test('44. a starter that exits at the hook (no close) leaves no numbered lock; its temporary file goes with the next winner', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const dead = await deadPid();
  writeFileSync(join(dir, 'hub.lock.1'), `${dead} ${GOOD_TOKEN}\n`);
  const crash = startStarters(dir, 1, 'crash')[0]!;
  try {
    await waitExit(crash);
  } finally {
    crash.kill();
  }
  assert.deepEqual(lockFiles(dir), ['hub.lock.1'], 'the crashed starter made no lock');
  assert.equal(readdirSync(dir).filter((n) => n.startsWith('hub.lock.tmp-')).length, 1, 'its temporary file is left behind');
  await withHub(dir, {}, async (url) => {
    assert.equal((await fetch(`${url}/healthz`)).status, 200, 'the next start succeeds');
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('hub.lock.tmp-')), [], 'the next winner removed the temporary file');
    assert.deepEqual(lockFiles(dir), ['hub.lock.1', 'hub.lock.2']);
  });
});

// Pinned because only a link makes the whole lock appear at once: a create followed by a write would leave an empty lock for a crash or a racing reader to meet.
test('45. the lock file is made whole by a hard link: right after the link it is a whole lock with two names', () => {
  const dir = tempDir();
  let seen: { text: string; links: number } | undefined;
  const held = takeLock(dir, () => undefined, {
    afterLink: (target) => {
      seen = { text: readFileSync(target, 'utf8'), links: statSync(target).nlink };
    },
  });
  try {
    assert.ok(seen, 'the hook ran');
    assert.match(seen.text, /^[1-9][0-9]* [0-9a-f]{24}\n$/);
    assert.equal(seen.links, 2, 'the lock is a hard link of the starter\'s temporary file, not a file created and then written');
  } finally {
    held.release();
  }
});

test('46. a current lock that vanishes between the listing and the read is looked at again, and the start succeeds', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hub.lock.1'), `${process.pid} ${GOOD_TOKEN}\n`);
  let once = true;
  const held = takeLock(dir, () => undefined, {
    beforeRead: () => {
      if (once) {
        once = false;
        unlinkSync(join(dir, 'hub.lock.1')); // its hub let go of it just now
      }
    },
  });
  try {
    assert.deepEqual(lockFiles(dir), ['hub.lock.1']);
    assert.equal(readFileSync(join(dir, 'hub.lock.1'), 'utf8').split(' ')[0], String(process.pid));
  } finally {
    held.release();
  }
});

test('47. a temporary file of a running starter is left alone by a winner', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const dead = await deadPid();
  writeFileSync(join(dir, 'hub.lock.1'), `${dead} ${GOOD_TOKEN}\n`);
  const mine = `hub.lock.tmp-${process.pid}-keep`; // this test's own process is running
  writeFileSync(join(dir, mine), 'x');
  const gone = `hub.lock.tmp-${dead}-gone`;
  writeFileSync(join(dir, gone), 'x');
  const kids = startStarters(dir, 1);
  try {
    assert.equal(await lineQueue(kids[0]!).next(), 'WON');
    assert.ok(existsSync(join(dir, mine)), 'a running starter\'s temporary file is not removed');
    assert.ok(!existsSync(join(dir, gone)), 'a dead starter\'s temporary file is removed');
  } finally {
    await stopStarters(kids);
  }
});

test('48. the highest number is the current lock: a live lock above a dead one refuses the start', { timeout: 60000 }, async () => {
  const dir = tempDir();
  const other = await stranger();
  try {
    writeFileSync(join(dir, 'hub.lock.1'), `99999999 ${GOOD_TOKEN}\n`); // no such process
    writeFileSync(join(dir, 'hub.lock.2'), `${other.pid} ${GOOD_TOKEN}\n`);
    assert.throws(() => takeLock(dir, () => undefined), /hub\.lock\.2 says process/);
    assert.deepEqual(lockFiles(dir), ['hub.lock.1', 'hub.lock.2']);
  } finally {
    other.kill();
  }
});

test('49. createHub never passes test hooks to the lock', () => {
  const source = readFileSync(join(HERE, '../src/server.ts'), 'utf8');
  const strict = /takeLock\(options\.dataDir, warn\)/;
  assert.match(source, strict);
  assert.equal(source.match(/takeLock\(/g)?.length, 1, 'one call');
  assert.ok(!/beforeLink|beforeRead|afterLink/.test(source), 'no hook is named in the server');
  // the guard bites: a call with a third argument does not match
  assert.ok(!strict.test('takeLock(options.dataDir, warn, { beforeLink() {} })'));
});

test('50. a journal that cannot be opened gives a plain message with no part of the folder path', async () => {
  const dir = tempDir();
  const file = join(dir, 'journal.jsonl');
  writeFileSync(file, '');
  chmodSync(file, 0o444);
  let message = '';
  try {
    const hub = createHub({ dataDir: dir, port: 0, ...quiet });
    try {
      await hub.listen();
      assert.fail('the start should have been refused');
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      await hub.close();
    }
  } finally {
    chmodSync(file, 0o666);
  }
  assert.match(message, /journal\.jsonl/);
  assert.match(message, /E[A-Z]+/);
  assert.ok(!message.includes(dir), message);
  assert.ok(!message.toLowerCase().includes(basename(dir).toLowerCase()), message);
  assert.deepEqual(lockFiles(dir), [], 'the lock is given back');
});

// ---- round 8: a folder or lock removed under a live hub; the lock's message; rules that had no test; body time limit; number cap ----

const REC = (n: number): any => structuredClone(copies[37]!.records[n]!);

test('51. the data folder removed under a live hub: the next post is 503, none is answered 200, a restart shows nothing missing', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const warnings: string[] = [];
  await withHub(dir, { warn: (l) => warnings.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(existsSync(dir), false, 'the folder is gone');
    for (let i = 1; i <= 3; i++) {
      const r = await post(url, [REC(i)]);
      assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }], `post ${i} after the removal`);
    }
    assert.equal((await fetch(`${url}/v0/rounds`)).status, 200, 'the read endpoints go on answering');
    assert.equal(warnings.length, 1, 'one plain line, once');
    assert.match(warnings[0]!, /removed or replaced/);
    assert.match(warnings[0]!, /restart/);
    assert.ok(!warnings[0]!.includes(dir) && !warnings[0]!.toLowerCase().includes(basename(dir).toLowerCase()), 'no path in it');
  });
  await withHub(dir, {}, async (url) => {
    assert.deepEqual((await rounds(url)).rounds, [], 'the restart starts empty: nothing was promised after the removal');
  });
});

test('52. the lock removed under a live hub and a second hub started: the first writes nothing more, the second keeps every line', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const warnings: string[] = [];
  let reference: any;
  await withHub(tempDir(), {}, async (url) => {
    for (const n of [0, 1, 3]) assert.equal((await post(url, [REC(n)])).status, 200);
    reference = await rounds(url);
  });
  await withHub(dir, { warn: (l) => warnings.push(l) }, async (urlA) => {
    assert.equal((await post(urlA, [REC(0)])).status, 200);
    unlinkSync(join(dir, 'hub.lock.1')); // a person deletes the lock, as the hub's own messages say to if no hub is running
    const b = createHub({ dataDir: dir, port: 0, ...quiet });
    try {
      const addr = await b.listen();
      const urlB = `http://${addr.host}:${addr.port}`;
      assert.equal((await post(urlB, [REC(1)])).status, 200);
      const before = readFileSync(journalOf(dir));
      const refused = await post(urlA, [REC(2)]);
      assert.deepEqual([refused.status, refused.body], [503, { error: 'journal_unavailable' }]);
      assert.ok(readFileSync(journalOf(dir)).equals(before), 'the first hub wrote nothing');
      assert.equal((await post(urlB, [REC(3)])).status, 200);
    } finally {
      await b.close();
    }
    assert.equal(warnings.length, 1);
  });
  assert.deepEqual(journalLines(dir).map((l) => JSON.parse(l) as unknown[]), [[REC(0)], [REC(1)], [REC(3)]], 'every line the second hub answered 200 is there, byte for byte');
  assert.deepEqual(await answerOf(dir), reference);
});

test('53. the journal file deleted, or replaced by another file, under a live hub: 503 and nothing written', { timeout: 120000 }, async () => {
  for (const how of ['deleted', 'replaced'] as const) {
    const dir = tempDir();
    await withHub(dir, {}, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      if (how === 'deleted') unlinkSync(journalOf(dir));
      else {
        renameSync(journalOf(dir), join(dir, 'journal.old'));
        writeFileSync(journalOf(dir), '');
      }
      const r = await post(url, [REC(1)]);
      assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }], how);
      if (how === 'replaced') assert.equal(statSync(journalOf(dir)).size, 0, 'nothing was written into the new file');
    });
  }
});

test('54. once the check has failed the hub takes no more posts until it is restarted, even if the lock comes back', { timeout: 120000 }, async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const text = readFileSync(join(dir, 'hub.lock.1'), 'utf8');
    unlinkSync(join(dir, 'hub.lock.1'));
    assert.equal((await post(url, [REC(1)])).status, 503);
    writeFileSync(join(dir, 'hub.lock.1'), text); // the very same lock back in place
    assert.equal((await post(url, [REC(1)])).status, 503, 'still unavailable: only a restart makes it take posts again');
  });
});

test('55. the folder removed while a line is being written: the post is not answered 200 and the live book keeps nothing it cannot give back', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let arm = false;
  const io = {
    write: (fd: number, buf: Buffer, off: number, len: number, position: number): number => {
      if (arm) rmSync(dir, { recursive: true, force: true }); // between the check before the write and the check after it
      return writeSync(fd, buf, off, len, position);
    },
  };
  await withHub(dir, { journal: { io } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    arm = true;
    const r = await post(url, [REC(1)]);
    arm = false;
    assert.notEqual(r.status, 200, 'a post whose line went into a removed folder is never answered 200');
    assert.deepEqual((await post(url, [REC(2)])).body, { error: 'journal_unavailable' });
    assert.deepEqual((await rounds(url)).rounds, [], 'the book holds only what a restart would find');
  });
});

test('56. a lock naming this very process with a token no hub here holds is a leftover and is replaced, with one line', { timeout: 60000 }, async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hub.lock.1'), `${process.pid} ${'1'.repeat(24)}\n`);
  const said: string[] = [];
  await withHub(dir, { warn: (l) => said.push(l) }, async (url) => {
    assert.equal(said.length, 1);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.deepEqual(lockFiles(dir), ['hub.lock.1', 'hub.lock.2']);
  });
});

test('57. a lock naming a running process that is not a hub is refused with a message that names the file and no path', { timeout: 60000 }, async () => {
  const dir = tempDir();
  const other = await stranger();
  try {
    writeFileSync(join(dir, 'hub.lock.7'), `${other.pid} ${GOOD_TOKEN}\n`);
    let message = '';
    try {
      takeLock(dir, () => undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.ok(message.startsWith(`hub.lock.7 says process ${other.pid} holds this data folder (the SIM_HUB_DATA setting).`), message);
    assert.match(message, /may be another program: stop nothing; once you are sure no hub is running on this folder, delete hub\.lock\.7 and start again\./);
    assert.ok(!message.includes(dir) && !message.toLowerCase().includes(basename(dir).toLowerCase()), message);
  } finally {
    other.kill();
  }
});

test('58. a journal whose one complete line lacks its newline: a second shot can be posted and both survive a restart', { timeout: 60000 }, async () => {
  const dir = tempDir();
  writeFileSync(journalOf(dir), JSON.stringify([REC(0)])); // no newline
  const reference = tempDir();
  await withHub(reference, {}, async (url) => {
    for (const n of [0, 1]) assert.equal((await post(url, [REC(n)])).status, 200);
  });
  await withHub(dir, {}, async (url) => {
    assert.equal((await post(url, [REC(1)])).status, 200);
  });
  assert.deepEqual(await answerOf(dir), await answerOf(reference), 'both shots are there after the restart');
});

test('59. a lock naming a process that answers "not permitted" to a signal is refused, never taken over', { timeout: 60000 }, (t) => {
  const pid = process.platform === 'win32' ? 4 : 1;
  let answer = '';
  try {
    process.kill(pid, 0);
    answer = 'allowed';
  } catch (e) {
    answer = (e as NodeJS.ErrnoException).code ?? 'error';
  }
  if (answer !== 'EPERM') {
    t.skip(`process ${pid} does not answer "not permitted" to a signal here (it answered ${answer})`);
    return;
  }
  const dir = tempDir();
  writeFileSync(join(dir, 'hub.lock.1'), `${pid} ${GOOD_TOKEN}\n`);
  assert.throws(() => takeLock(dir, () => undefined), /hub\.lock\.1 says process/);
  assert.deepEqual(lockFiles(dir), ['hub.lock.1']);
});

test('60. a post whose journal line is exactly the limit is 200, and the next start reads it', { timeout: 60000 }, async () => {
  const rec = REC(0);
  const exact = Buffer.byteLength(JSON.stringify([rec]), 'utf8');
  const dir = tempDir();
  await withHub(dir, { journal: { maxLineBytes: exact } }, async (url) => {
    assert.equal((await post(url, [rec])).status, 200);
  });
  await withHub(dir, { journal: { maxLineBytes: exact } }, async (url) => {
    assert.equal((await rounds(url)).rounds.length, 1, 'the start read the line');
  });
});

test('61. a refused post whose body keeps coming is cut about two seconds after the answer', { timeout: 60000 }, async () => {
  await withHub(tempDir(), {}, async (url) => {
    const port = Number(new URL(url).port);
    const result = await new Promise<{ closedAfterMs: number | undefined; answer: string }>((resolve) => {
      const sock = connect(port, '127.0.0.1');
      let text = '';
      const started = Date.now();
      let closedAt: number | undefined;
      sock.on('data', (c) => (text += c.toString('utf8')));
      sock.on('error', () => undefined);
      sock.on('close', () => {
        closedAt = Date.now() - started;
      });
      sock.on('connect', () => sock.write(`POST /v0/shots HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: text/plain\r\nContent-Length: 1000000\r\n\r\n`));
      const drip = setInterval(() => {
        if (!sock.destroyed) sock.write('x');
      }, 200);
      setTimeout(() => {
        clearInterval(drip);
        sock.destroy();
        resolve({ closedAfterMs: closedAt, answer: text });
      }, 7000);
    });
    assert.match(result.answer, /^HTTP\/1\.1 415 /);
    assert.ok(result.closedAfterMs !== undefined, 'the hub never cut the connection');
    assert.ok(result.closedAfterMs! >= 1500 && result.closedAfterMs! <= 4500, `cut after ${result.closedAfterMs} ms`);
  });
});

test('62. a body of exactly the limit is taken; one byte more is 413', { timeout: 60000 }, async () => {
  const body = JSON.stringify({ records: [REC(0)] });
  const exact = Buffer.byteLength(body);
  await withHub(tempDir(), { maxBodyBytes: exact }, async (url) => {
    const ok = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/json', 'Content-Length': String(exact) }, body });
    assert.equal(ok.status, 200);
    const more = `${body} `;
    const over = await raw(url, { method: 'POST', path: '/v0/shots', headers: { 'Content-Type': 'application/json', 'Content-Length': String(exact + 1) }, body: more });
    assert.equal(over.status, 413);
  });
});

test('63. a body that is not complete after the time limit is answered 408 body_timeout and frees its slot', { timeout: 60000 }, async () => {
  await withHub(tempDir(), { bodyTimeoutMs: 400 }, async (url) => {
    const port = Number(new URL(url).port);
    const socks: Array<{ text: () => string; stop: () => void }> = [];
    try {
      for (let i = 0; i < 4; i++) {
        const sock = connect(port, '127.0.0.1');
        let text = '';
        sock.on('data', (c) => (text += c.toString('utf8')));
        sock.on('error', () => undefined);
        sock.on('connect', () => sock.write(`POST /v0/shots HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n{`));
        const drip = setInterval(() => {
          if (!sock.destroyed) sock.write(' ');
        }, 100);
        socks.push({ text: () => text, stop: () => (clearInterval(drip), sock.destroy()) });
      }
      let fine = 0;
      for (let i = 0; i < 60 && fine !== 200; i++) {
        await new Promise((r) => setTimeout(r, 100));
        fine = (await post(url, [])).status;
      }
      assert.equal(fine, 200, 'a normal post is taken once the dribbling senders have timed out');
      for (const s of socks) assert.match(s.text(), /^HTTP\/1\.1 408 [\s\S]*"body_timeout"/);
    } finally {
      for (const s of socks) s.stop();
    }
  });
});

test('64. a current lock whose number is above a billion is refused with a plain message naming the file', { timeout: 60000 }, () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hub.lock.9007199254740991'), `${99999999} ${GOOD_TOKEN}\n`);
  let message = '';
  try {
    takeLock(dir, () => undefined);
  } catch (e) {
    message = (e as Error).message;
  }
  assert.match(message, /hub\.lock\.9007199254740991/);
  assert.match(message, /delete/);
  assert.ok(!message.includes(dir), message);
});

test('65. a start gives up after five seconds, with a plain message, when the current lock cannot be read on any attempt', { timeout: 60000 }, () => {
  const dir = tempDir();
  let n = 1;
  writeFileSync(join(dir, 'hub.lock.1'), `99999999 ${GOOD_TOKEN}\n`);
  const stopAt = Date.now() + 9000; // if the start never gives up, the hook lets it through so this test ends by itself
  const started = Date.now();
  let message = '';
  try {
    takeLock(dir, () => undefined, {
      beforeRead: () => {
        if (Date.now() > stopAt) return;
        // the lock that was listed vanishes and the next number appears: every read fails with ENOENT, forever
        unlinkSync(join(dir, `hub.lock.${n}`));
        n++;
        writeFileSync(join(dir, `hub.lock.${n}`), `99999999 ${GOOD_TOKEN}\n`);
      },
    });
  } catch (e) {
    message = (e as Error).message;
  }
  const took = Date.now() - started;
  assert.match(message, /cannot be read \(ENOENT\)/);
  assert.ok(!message.includes(dir), message);
  assert.ok(took >= 4500 && took <= 8000, `gave up after ${took} ms`);
});

// ---- round 9: the look at the lock is next to the write, and the journal refuses a file that changed under it ----

const lineOf = (records: unknown[]): string => `${JSON.stringify(records)}\n`;

/** The answer of two shots posted in a row to a fresh hub: what a restart on a journal holding both lines shows. */
async function referenceOf(...shots: number[]): Promise<any> {
  let out: any;
  await withHub(tempDir(), {}, async (url) => {
    for (const n of shots) assert.equal((await post(url, [REC(n)])).status, 200);
    out = await rounds(url);
  });
  return out;
}

test('66. the lock removed and a second writer line added after the work of the post, before the look: 503, that line is intact, and the first batch is not in the journal', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  const second = lineOf([REC(5)]); // what a second hub would have written and answered 200
  await withHub(dir, { hooks: { beforeWriteLook: () => {
    if (!armed) return;
    unlinkSync(join(dir, 'hub.lock.1'));
    appendFileSync(journalOf(dir), second);
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const before = readFileSync(journalOf(dir));
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }], 'a post that wrote nothing is 503');
    assert.ok(readFileSync(journalOf(dir)).equals(Buffer.concat([before, Buffer.from(second)])), 'the journal is exactly what it was plus the second writer\'s line');
  });
  assert.deepEqual(await answerOf(dir), await referenceOf(0, 5), 'the second writer\'s shot is there after a restart and the first hub\'s batch is not');
});

test('67. the lock removed, nothing else, after the post\'s work and before the look: 503 and nothing written', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  await withHub(dir, { hooks: { beforeWriteLook: () => {
    if (armed) unlinkSync(join(dir, 'hub.lock.1'));
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const before = readFileSync(journalOf(dir));
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }]);
    assert.ok(readFileSync(journalOf(dir)).equals(before), 'nothing was written');
    assert.deepEqual((await rounds(url)).rounds.length, 1, 'the book was rebuilt from the file: only the first shot');
  });
  assert.deepEqual(await answerOf(dir), await referenceOf(0));
});

test('68. a complete line added to the journal from outside, the lock left alone: 503, the line intact byte for byte, the file not cut, the next post 503 too', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  const outside = lineOf([REC(5)]);
  await withHub(dir, { hooks: { beforeWriteLook: () => {
    if (armed) appendFileSync(journalOf(dir), outside);
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const before = readFileSync(journalOf(dir));
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }]);
    assert.ok(readFileSync(journalOf(dir)).equals(Buffer.concat([before, Buffer.from(outside)])), 'the outside line is intact and the file is not cut');
    assert.deepEqual([(await post(url, [REC(2)])).status], [503], 'unavailable until a restart');
  });
});

test('69. the journal cut shorter from outside after the post\'s work: 503 and nothing written', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  await withHub(dir, { hooks: { beforeWriteLook: () => {
    if (armed) truncateSync(journalOf(dir), statSync(journalOf(dir)).size - 5);
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const size = statSync(journalOf(dir)).size;
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }]);
    assert.equal(statSync(journalOf(dir)).size, size - 5, 'nothing was written, and the file was not touched');
  });
});

test('70. an ordinary post is 200 and the journal grows by exactly its line; a failed write of the hub\'s own line is still cut back', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const { f, io } = faults();
  await withHub(dir, { journal: { io } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const size = statSync(journalOf(dir)).size;
    assert.equal((await post(url, [REC(1)])).status, 200);
    assert.equal(statSync(journalOf(dir)).size, size + Buffer.byteLength(lineOf([REC(1)])), 'grew by exactly its line');
    const size2 = statSync(journalOf(dir)).size;
    f.write = 'half';
    assert.equal((await post(url, [REC(2)])).status, 500);
    f.write = 'none';
    assert.equal(statSync(journalOf(dir)).size, size2, 'cut back to the last good length');
    assert.equal((await post(url, [REC(2)])).status, 200, 'and the hub goes on');
  });
});

test('71. the last look comes after the table is updated: a removal just before it gives 500 and a read address shows what the path holds', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  let tableSizeSeen = -1;
  await withHub(dir, { hooks: { beforeLastLook: (tableSize) => {
    if (!armed) return;
    tableSizeSeen = tableSize;
    unlinkSync(join(dir, 'hub.lock.1'));
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.equal(r.status, 500, 'a line was written and then found lost');
    assert.equal(tableSizeSeen, 2, 'the table already knew both shots when the last look was made (it comes after the table update)');
    assert.deepEqual(await rounds(url), await referenceOf(0, 1), 'the journal path holds both lines, and the book is rebuilt from it');
    assert.equal((await post(url, [REC(2)])).status, 503);
  });
});

test('72. a journal whose close fails: the hub\'s close still removes its lock, a new hub can start, a second close does nothing', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let calls = 0;
  const io = {
    close: (fd: number): void => {
      calls++;
      closeSync(fd); // the descriptor really is closed, then the close reports a failure
      throw new Error('close failed (test)');
    },
  };
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, journal: { io } });
  await hub.listen();
  await assert.rejects(() => hub.close(), /close failed/);
  assert.deepEqual(lockFiles(dir), [], 'the lock is gone although the journal\'s close threw');
  await hub.close(); // a second close does nothing
  assert.equal(calls, 1, 'the descriptor was closed once and never again');
  await withHub(dir, {}, async (url) => {
    assert.equal((await fetch(`${url}/healthz`)).status, 200, 'a new hub starts on the folder in this process');
  });
});

test('73. a journal whose close failed is never closed again: the descriptor is forgotten before the close is called', { timeout: 60000 }, async () => {
  const dir = tempDir();
  let calls = 0;
  const j = await Journal.open(dir, () => undefined, () => undefined, {
    io: {
      close: (fd: number): void => {
        calls++;
        closeSync(fd); // really closed, then the close reports a failure
        throw new Error('close failed (test)');
      },
    },
  });
  assert.throws(() => j.close(), /close failed/);
  j.close(); // does nothing: that number may by now belong to another file
  assert.equal(calls, 1);
});

test('74. the cheap look at the top: a post that would write nothing is still 503 once the lock is gone', { timeout: 60000 }, async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    unlinkSync(join(dir, 'hub.lock.1'));
    const again = await post(url, [REC(0)]); // already held exactly: nothing to write, so only the look at the top can refuse it
    assert.deepEqual([again.status, again.body], [503, { error: 'journal_unavailable' }]);
  });
});

// ---- round 10: a look that cannot tell is not a lost lock; tests for wrong versions that passed ----

/** A replaceable read of the lock for the hub's look: fails with an error code once or always, or returns other content. */
function lockSeam() {
  const seam = {
    mode: 'ok' as 'ok' | 'once' | 'fail' | 'other',
    code: 'EBUSY',
    read: (path: string): string => {
      if (seam.mode === 'other') return 'not this hub\'s lock\n';
      if (seam.mode === 'once' || seam.mode === 'fail') {
        if (seam.mode === 'once') seam.mode = 'ok';
        const e: NodeJS.ErrnoException = new Error(`read failed (${seam.code}, test)`);
        e.code = seam.code;
        throw e;
      }
      return readFileSync(path, 'utf8');
    },
  };
  return seam;
}

const CANNOT = /could not read its own lock/;
const REMOVED = /removed or replaced/;

test('75. the lock cannot be read at the look at the top (EBUSY, once): 503 busy with Retry-After, nothing written, the new line once, not lost, the next post is 200', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const seam = lockSeam();
  const said: string[] = [];
  await withHub(dir, { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const before = readFileSync(journalOf(dir));
    seam.mode = 'once';
    const r = await post(url, [REC(1)]);
    assert.deepEqual([r.status, r.body, r.headers.get('retry-after')], [503, { error: 'busy' }, '1']);
    assert.ok(readFileSync(journalOf(dir)).equals(before), 'the journal is unchanged');
    assert.equal(said.filter((l) => CANNOT.test(l)).length, 1);
    assert.match(said.join('\n'), /EBUSY/);
    assert.ok(!said.some((l) => REMOVED.test(l)), 'it must not say anything was removed or replaced');
    assert.equal((await post(url, [REC(1)])).status, 200, 'the hub carries on as if nothing had happened');
  });
  assert.deepEqual(await answerOf(dir), await referenceOf(0, 1), 'the shot answered 200 is there after a restart');
});

test('76. the lock cannot be read at the look next to the write: 503 busy, nothing written, the book rebuilt from the file, the next post is 200', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const seam = lockSeam();
  let armed = false;
  await withHub(dir, { lockRead: seam.read, hooks: { beforeWriteLook: () => {
    if (armed) seam.mode = 'once';
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const before = readFileSync(journalOf(dir));
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.deepEqual([r.status, r.body, r.headers.get('retry-after')], [503, { error: 'busy' }, '1']);
    assert.ok(readFileSync(journalOf(dir)).equals(before), 'the journal bytes are unchanged');
    assert.deepEqual(await rounds(url), await referenceOf(0), 'a read address shows what the path holds: the refused batch is not there');
    assert.equal((await post(url, [REC(1)])).status, 200);
  });
});

test('77. the lock cannot be read at the last look: 500, the line is in the journal, a read address shows the path, the same post again is 200 and all unchanged', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const seam = lockSeam();
  let armed = false;
  await withHub(dir, { lockRead: seam.read, hooks: { beforeLastLook: () => {
    if (armed) seam.mode = 'once';
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.equal(r.status, 500);
    assert.deepEqual(journalLines(dir).map((l) => JSON.parse(l) as unknown[]), [[REC(0)], [REC(1)]], 'the line stays in the journal');
    assert.deepEqual(await rounds(url), await referenceOf(0, 1), 'a read address shows what the path holds');
    const size = statSync(journalOf(dir)).size;
    const again = await post(url, [REC(1)]);
    assert.deepEqual([again.status, again.body], [200, { added: 0, revised: 0, unchanged: 1, conflicts: 0 }]);
    assert.equal(statSync(journalOf(dir)).size, size, 'the journal does not grow');
  });
});

test('78. EPERM and EACCES are as EBUSY; ENOENT and other content in the lock file still mark the hub lost, with the old line', { timeout: 240000 }, async () => {
  for (const code of ['EPERM', 'EACCES', 'EMFILE']) {
    const seam = lockSeam();
    seam.code = code;
    await withHub(tempDir(), { lockRead: seam.read, warn: () => undefined }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      seam.mode = 'once';
      assert.deepEqual((await post(url, [REC(1)])).body, { error: 'busy' }, code);
      assert.equal((await post(url, [REC(1)])).status, 200, `${code}: not lost`);
    });
  }
  for (const how of ['ENOENT', 'other'] as const) {
    const seam = lockSeam();
    const said: string[] = [];
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      if (how === 'ENOENT') {
        seam.code = 'ENOENT';
        seam.mode = 'fail';
      } else seam.mode = 'other';
      assert.deepEqual((await post(url, [REC(1)])).body, { error: 'journal_unavailable' }, how);
      seam.mode = 'ok';
      assert.equal((await post(url, [REC(1)])).status, 503, `${how}: lost until a restart`);
      assert.equal(said.filter((l) => REMOVED.test(l)).length, 1);
    });
  }
});

test('79. five posts that cannot tell print the line once; a post that reads, then one that cannot, prints it a second time', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam.mode = 'fail';
    for (let i = 0; i < 5; i++) assert.equal((await post(url, [REC(1)])).status, 503);
    assert.equal(said.filter((l) => CANNOT.test(l)).length, 1, 'once for the whole stretch');
    seam.mode = 'ok';
    assert.equal((await post(url, [REC(1)])).status, 200, 'a look that succeeds ends the stretch');
    seam.mode = 'fail';
    assert.equal((await post(url, [REC(2)])).status, 503);
    assert.equal(said.filter((l) => CANNOT.test(l)).length, 2, 'a new stretch prints the line again');
  });
});

test('80. a stat of the journal path that fails with EBUSY is 503 busy and not lost; ENOENT still marks the hub lost', { timeout: 120000 }, async () => {
  const state = { code: '' };
  const io = {
    statPath: (path: string): { dev: bigint; ino: bigint } => {
      if (state.code !== '') {
        const code = state.code;
        if (code === 'EBUSY') state.code = ''; // one look only
        const e: NodeJS.ErrnoException = new Error(`stat failed (${code}, test)`);
        e.code = code;
        throw e;
      }
      return statSync(path, { bigint: true });
    },
  };
  const said: string[] = [];
  await withHub(tempDir(), { journal: { io }, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    state.code = 'EBUSY';
    const r = await post(url, [REC(1)]);
    assert.deepEqual([r.status, r.body], [503, { error: 'busy' }]);
    assert.match(said.join('\n'), /could not look at its journal/);
    assert.ok(!said.some((l) => REMOVED.test(l)));
    assert.equal((await post(url, [REC(1)])).status, 200, 'not lost');
    state.code = 'ENOENT';
    assert.deepEqual((await post(url, [REC(2)])).body, { error: 'journal_unavailable' });
    assert.equal(said.filter((l) => REMOVED.test(l)).length, 1);
  });
});

test('81. when the look next to the write answers gone, the removed-or-replaced line is printed by that post', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const said: string[] = [];
  let armed = false;
  await withHub(dir, { warn: (l) => said.push(l), hooks: { beforeWriteLook: () => {
    if (armed) unlinkSync(join(dir, 'hub.lock.1'));
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.equal(r.status, 503);
    assert.equal(said.filter((l) => REMOVED.test(l)).length, 1, 'printed by that very post, not by a later one');
  });
});

test('82. a rebuild that fails: the read address no longer shows the refused shot; it answers 503 like the posts, and /healthz still 200', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  await withHub(dir, { hooks: { beforeWriteLook: () => {
    if (!armed) return;
    unlinkSync(join(dir, 'hub.lock.1'));
    appendFileSync(journalOf(dir), 'this line is damaged\n'); // complete, and not JSON: the rebuild cannot read the journal
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.equal(r.status, 503);
    const read = await fetch(`${url}/v0/rounds`);
    assert.deepEqual([read.status, await read.json()], [503, { error: 'journal_unavailable' }], 'never a 200 that shows the refused shot');
    assert.equal((await post(url, [REC(2)])).status, 503);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  });
});

test('83. the lock removed just before the last look and put back with the same bytes: 500, then 503 (V6)', { timeout: 120000 }, async () => {
  const dir = tempDir();
  let armed = false;
  await withHub(dir, { hooks: { beforeLastLook: () => {
    if (armed) unlinkSync(join(dir, 'hub.lock.1'));
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const text = readFileSync(join(dir, 'hub.lock.1'), 'utf8');
    armed = true;
    assert.equal((await post(url, [REC(1)])).status, 500);
    armed = false;
    writeFileSync(join(dir, 'hub.lock.1'), text); // the very same bytes back before the next post
    assert.equal((await post(url, [REC(2)])).status, 503, 'the hub was marked lost at the last look');
  });
});

test('84. a sender of headers only, no body byte, is answered 408 and the slot is free again (V5)', { timeout: 60000 }, async () => {
  await withHub(tempDir(), { bodyTimeoutMs: 400 }, async (url) => {
    const port = Number(new URL(url).port);
    const sock = connect(port, '127.0.0.1');
    let text = '';
    sock.on('data', (c) => (text += c.toString('utf8')));
    sock.on('error', () => undefined);
    try {
      sock.on('connect', () => sock.write(`POST /v0/shots HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n`));
      for (let i = 0; i < 40 && !/408/.test(text); i++) await new Promise((r) => setTimeout(r, 100));
      assert.match(text, /^HTTP\/1\.1 408 [\s\S]*"body_timeout"/);
      assert.equal((await post(url, [])).status, 200, 'the slot is free');
    } finally {
      sock.destroy();
    }
  });
});

test('85. at the real default a sender of headers only is answered 408 between 29 and 35 seconds (V4)', { timeout: 120000 }, async () => {
  await withHub(tempDir(), {}, async (url) => {
    const port = Number(new URL(url).port);
    const sock = connect(port, '127.0.0.1');
    let text = '';
    const started = Date.now();
    let answeredAt: number | undefined;
    sock.on('data', (c) => {
      text += c.toString('utf8');
      if (answeredAt === undefined && /408/.test(text)) answeredAt = Date.now() - started;
    });
    sock.on('error', () => undefined);
    try {
      sock.on('connect', () => sock.write(`POST /v0/shots HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n`));
      for (let i = 0; i < 380 && answeredAt === undefined; i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(answeredAt !== undefined, 'no answer within 38 seconds');
      assert.ok(answeredAt! >= 29000 && answeredAt! <= 35000, `answered after ${answeredAt} ms`);
    } finally {
      sock.destroy();
    }
  });
});

test('86. the journal moved away and a copy of the same length put at its path: 503, and neither file grows (V1)', { timeout: 120000 }, async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const old = join(dir, 'journal.old');
    renameSync(journalOf(dir), old);
    copyFileSync(old, journalOf(dir)); // same length, another file
    const sizeOld = statSync(old).size;
    const sizeNew = statSync(journalOf(dir)).size;
    assert.equal(sizeOld, sizeNew);
    const r = await post(url, [REC(1)]);
    assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }]);
    assert.equal(statSync(old).size, sizeOld);
    assert.equal(statSync(journalOf(dir)).size, sizeNew);
  });
});

test('87. the lock number cap: a dead 1000000000 is followed, a dead 1000000001 and a dead 2000000000 are refused, and the words say a hub may be running', { timeout: 60000 }, async () => {
  const dead = await deadPid();
  const dirA = tempDir();
  writeFileSync(join(dirA, 'hub.lock.1000000000'), `${dead} ${GOOD_TOKEN}\n`);
  const held = takeLock(dirA, () => undefined);
  try {
    assert.deepEqual(lockFiles(dirA).slice(-1), ['hub.lock.1000000001'], 'followed to the next number');
  } finally {
    held.release();
  }
  for (const n of ['1000000001', '2000000000']) {
    const dir = tempDir();
    writeFileSync(join(dir, `hub.lock.${n}`), `${dead} ${GOOD_TOKEN}\n`);
    let message = '';
    try {
      takeLock(dir, () => undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.match(message, new RegExp(`hub\\.lock\\.${n}`));
    assert.match(message, /a hub may be running under that lock and must be stopped first/);
    assert.match(message, /then delete/);
    assert.ok(!message.includes(dir) && !message.toLowerCase().includes(basename(dir).toLowerCase()), message);
  }
});

// ---- round 11: tests for the wrong versions round 10 let pass; a lock that stays unreadable says so each minute ----

const TOOK = /this post was not taken/;
const WRITTEN = /answered 500, its line is in the journal/;
const FIRST = /this hub could not (read its own lock|look at its journal)/;
const REPEAT = /this hub is still unable to (read its own lock|look at its journal)/;

test('88. the hub\'s own lock file with one byte appended, emptied, or cut one byte short is gone, not held', { timeout: 240000 }, async () => {
  for (const how of ['appended', 'emptied', 'cut'] as const) {
    const dir = tempDir();
    const said: string[] = [];
    await withHub(dir, { warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      const path = join(dir, 'hub.lock.1');
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, how === 'appended' ? `${text}x` : how === 'emptied' ? '' : text.slice(0, -1));
      const r = await post(url, [REC(1)]);
      assert.deepEqual([r.status, r.body], [503, { error: 'journal_unavailable' }], how);
      assert.equal(said.filter((l) => REMOVED.test(l)).length, 1, how);
    });
  }
});

test('89. the journal path answering ENOTDIR is gone: 503 journal_unavailable and the hub is lost', { timeout: 120000 }, async () => {
  const state = { code: '' };
  const io = {
    statPath: (path: string): { dev: bigint; ino: bigint } => {
      if (state.code !== '') {
        const e: NodeJS.ErrnoException = new Error('stat failed (test)');
        e.code = state.code;
        throw e;
      }
      return statSync(path, { bigint: true });
    },
  };
  const said: string[] = [];
  await withHub(tempDir(), { journal: { io }, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    state.code = 'ENOTDIR';
    assert.deepEqual((await post(url, [REC(1)])).body, { error: 'journal_unavailable' });
    state.code = '';
    assert.equal((await post(url, [REC(1)])).status, 503, 'lost until a restart');
    assert.equal(said.filter((l) => REMOVED.test(l)).length, 1);
  });
});

test('90. the cannot-tell line ends with the right words at each look, and not the other ending', { timeout: 120000 }, async () => {
  const check = async (where: 'top' | 'write' | 'last'): Promise<string> => {
    const seam = lockSeam();
    const said: string[] = [];
    let armed = false;
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l), hooks: {
      beforeWriteLook: () => {
        if (armed && where === 'write') seam.mode = 'once';
      },
      beforeLastLook: () => {
        if (armed && where === 'last') seam.mode = 'once';
      },
    } }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      armed = true;
      if (where === 'top') seam.mode = 'once';
      await post(url, [REC(1)]);
      armed = false;
    });
    assert.equal(said.length, 1, where);
    return said[0]!;
  };
  for (const where of ['top', 'write'] as const) {
    const line = await check(where);
    assert.match(line, TOOK, where);
    assert.doesNotMatch(line, WRITTEN, where);
  }
  const last = await check('last');
  assert.match(last, WRITTEN);
  assert.doesNotMatch(last, TOOK);
});

test('91. the same hub object stopped and started again: after a failed rebuild and a repaired journal the read address and posts work; a stretch is announced again', { timeout: 240000 }, async () => {
  // a failed rebuild, then a restart on a repaired journal
  const dir = tempDir();
  let armed = false;
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, hooks: { beforeWriteLook: () => {
    if (!armed) return;
    unlinkSync(join(dir, 'hub.lock.1'));
    appendFileSync(journalOf(dir), 'this line is damaged\n');
  } } });
  try {
    let a = await hub.listen();
    assert.equal((await post(`http://${a.host}:${a.port}`, [REC(0)])).status, 200);
    armed = true;
    assert.equal((await post(`http://${a.host}:${a.port}`, [REC(1)])).status, 503);
    armed = false;
    assert.equal((await fetch(`http://${a.host}:${a.port}/v0/rounds`)).status, 503);
    await hub.close();
    writeFileSync(journalOf(dir), lineOf([REC(0)])); // repaired
    a = await hub.listen();
    const url = `http://${a.host}:${a.port}`;
    assert.equal((await fetch(`${url}/v0/rounds`)).status, 200, 'the read address answers again after the restart');
    assert.equal((await post(url, [REC(1)])).status, 200, 'posts are taken again');
  } finally {
    await hub.close();
  }
  // a stretch, then a restart while the read still fails: the line is printed again
  const seam = lockSeam();
  const said: string[] = [];
  const hub2 = createHub({ dataDir: tempDir(), port: 0, log: () => undefined, warn: (l) => said.push(l), lockRead: seam.read });
  try {
    let a = await hub2.listen();
    seam.mode = 'fail';
    assert.equal((await post(`http://${a.host}:${a.port}`, [REC(0)])).status, 503);
    assert.equal(said.filter((l) => FIRST.test(l)).length, 1);
    await hub2.close();
    a = await hub2.listen();
    assert.equal((await post(`http://${a.host}:${a.port}`, [REC(0)])).status, 503);
    assert.equal(said.filter((l) => FIRST.test(l)).length, 2, 'a new start is a new stretch');
  } finally {
    await hub2.close();
  }
});

test('92. a stretch is ended by a post that has nothing to write; the next look that cannot tell prints the line again', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam.mode = 'fail';
    assert.equal((await post(url, [REC(1)])).status, 503);
    assert.equal(said.filter((l) => FIRST.test(l)).length, 1);
    seam.mode = 'ok';
    assert.equal((await post(url, [REC(0)])).status, 200, 'every record unchanged: nothing to write');
    seam.mode = 'fail';
    assert.equal((await post(url, [REC(1)])).status, 503);
    assert.equal(said.filter((l) => FIRST.test(l)).length, 2);
  });
});

test('93. a cannot tell at the look next to the write followed by a rebuild that throws: not 200, every later post 503, the read address 503, healthz 200', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const seam = lockSeam();
  let armed = false;
  await withHub(dir, { lockRead: seam.read, warn: () => undefined, hooks: { beforeWriteLook: () => {
    if (!armed) return;
    seam.mode = 'once';
    const fd = openSync(journalOf(dir), 'r+');
    try {
      writeSync(fd, 'X', 0, 'utf8'); // the same length, but the first line can no longer be read
    } finally {
      closeSync(fd);
    }
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    armed = true;
    const r = await post(url, [REC(1)]);
    armed = false;
    assert.notEqual(r.status, 200);
    assert.equal((await post(url, [REC(2)])).status, 503);
    assert.deepEqual((await post(url, [REC(2)])).body, { error: 'journal_unavailable' });
    assert.equal((await fetch(`${url}/v0/rounds`)).status, 503);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  });
});

test('94. a stretch that lasts: one line inside the first minute, a repeat each minute with its words, nothing in between, and a look that succeeds starts the next stretch with the first line', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  let t = 1_000_000;
  await withHub(tempDir(), { lockRead: seam.read, now: () => t, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam.mode = 'fail';
    const lines = (): { first: number; repeat: number } => ({ first: said.filter((l) => FIRST.test(l)).length, repeat: said.filter((l) => REPEAT.test(l)).length });
    for (const at of [0, 10, 20, 30, 50]) {
      t = 1_000_000 + at * 1000;
      assert.equal((await post(url, [REC(1)])).status, 503);
    }
    assert.deepEqual(lines(), { first: 1, repeat: 0 }, 'five looks inside one minute print one line');
    t = 1_000_000 + 61_000;
    await post(url, [REC(1)]);
    assert.deepEqual(lines(), { first: 1, repeat: 1 }, 'at 61 seconds the repeat');
    const repeat = said.find((l) => REPEAT.test(l))!;
    assert.match(repeat, /about 1 minute/);
    assert.match(repeat, /nothing is lost/);
    assert.match(repeat, /by itself/);
    assert.match(repeat, /look for the program that is holding/);
    assert.match(repeat, /data folder/);
    assert.doesNotMatch(repeat, /restart|delete/i);
    t = 1_000_000 + 90_000;
    await post(url, [REC(1)]);
    assert.deepEqual(lines(), { first: 1, repeat: 1 }, 'at 90 seconds nothing');
    t = 1_000_000 + 125_000;
    await post(url, [REC(1)]);
    assert.deepEqual(lines(), { first: 1, repeat: 2 }, 'at 125 seconds again');
    seam.mode = 'ok';
    t = 1_000_000 + 130_000;
    assert.equal((await post(url, [REC(1)])).status, 200, 'a look that succeeds ends the stretch');
    seam.mode = 'fail';
    t = 1_000_000 + 140_000;
    await post(url, [REC(2)]);
    assert.deepEqual(lines(), { first: 2, repeat: 2 }, 'the next stretch starts with the first line, not the repeat');
  });
});

test('95. the repeat is not printed at every look, not after the stretch has ended, and the interval is a minute and not ten', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  let t = 5_000_000;
  await withHub(tempDir(), { lockRead: seam.read, now: () => t, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam.mode = 'fail';
    await post(url, [REC(1)]);
    t += 65_000; // 65 seconds: due (a ten minute interval would not print)
    await post(url, [REC(1)]);
    assert.equal(said.filter((l) => REPEAT.test(l)).length, 1);
    seam.mode = 'ok';
    t += 300_000;
    assert.equal((await post(url, [REC(1)])).status, 200);
    assert.equal(said.filter((l) => REPEAT.test(l)).length, 1, 'no repeat after the stretch ended');
  });
});

test('96. the reason in the line depends on the code: EBUSY says another program may be holding the file, others say the hub cannot tell why', { timeout: 240000 }, async () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES', 'EISDIR']) {
    const seam = lockSeam();
    seam.code = code;
    const said: string[] = [];
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      seam.mode = 'once';
      await post(url, [REC(1)]);
    });
    const line = said.join('\n');
    assert.match(line, new RegExp(code), code);
    if (code === 'EBUSY') {
      assert.match(line, /another program may be holding the file/);
      assert.doesNotMatch(line, /cannot tell why/);
    } else {
      assert.match(line, /could not be read or looked at and the hub cannot tell why: it may be held by another program, be part-way through being removed, or the hub may no longer have the right to read its data folder/);
      assert.doesNotMatch(line, /another program may be holding the file/);
    }
  }
});

test('97. only a plain code reaches the console: a code that is a path and a name is printed as error', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  const odd = 'C:\\Users\\Somebody\\ZZTEST-A';
  seam.code = odd;
  await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam.mode = 'once';
    await post(url, [REC(1)]);
  });
  const text = said.join('\n');
  assert.match(text, /\(error\)/);
  assert.ok(!text.includes('Somebody') && !text.includes('ZZTEST-A') && !text.includes('Users'), text);
  // and the journal's look
  const said2: string[] = [];
  const io = {
    statPath: (): { dev: bigint; ino: bigint } => {
      const e: NodeJS.ErrnoException = new Error('stat failed (test)');
      e.code = 'lower-case and spaces / or a path';
      throw e;
    },
  };
  await withHub(tempDir(), { journal: { io }, warn: (l) => said2.push(l) }, async (url) => {
    await post(url, [REC(0)]);
  });
  assert.match(said2.join('\n'), /\(error\)/);
  assert.ok(!said2.join('\n').includes('lower-case'));
});

test('98. a second starter whose read of the current lock fails with EBUSY is refused with words that say a hub may be running; the folder is untouched', { timeout: 60000 }, async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hub.lock.1'), `${process.pid} ${'1'.repeat(24)}\n`);
  const before = readdirSync(dir).sort();
  let message = '';
  try {
    takeLock(dir, () => undefined, {
      read: () => {
        const e: NodeJS.ErrnoException = new Error('busy (test)');
        e.code = 'EBUSY';
        throw e;
      },
    });
  } catch (e) {
    message = (e as Error).message;
  }
  assert.match(message, /^hub\.lock\.1 cannot be read \(EBUSY\); a hub may be running under that lock and another program may be holding the file; try again in a moment; delete the file only when no hub is running/);
  assert.ok(!message.includes(dir) && !message.toLowerCase().includes(basename(dir).toLowerCase()), message);
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test('99. the same hub object lost, stopped, started on a good folder and lost again prints the removed-or-replaced line the second time too', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const said: string[] = [];
  const hub = createHub({ dataDir: dir, port: 0, log: () => undefined, warn: (l) => said.push(l) });
  try {
    for (let round = 1; round <= 2; round++) {
      const a = await hub.listen();
      const url = `http://${a.host}:${a.port}`;
      assert.equal((await post(url, [REC(round)])).status, 200);
      unlinkSync(join(dir, readdirSync(dir).find((n) => /^hub\.lock\.\d+$/.test(n))!));
      assert.equal((await post(url, [REC(round + 5)])).status, 503);
      assert.equal(said.filter((l) => REMOVED.test(l)).length, round, `round ${round}`);
      await hub.close();
    }
  } finally {
    await hub.close();
  }
});

test('100. a post with one ShotID twice and different content, answered 500 at the last look, sent again: 200, added 0, revised 0, conflicts 1', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  let armed = false;
  await withHub(tempDir(), { lockRead: seam.read, warn: () => undefined, hooks: { beforeLastLook: () => {
    if (armed) seam.mode = 'once';
  } } }, async (url) => {
    const a = REC(0);
    const b = { ...structuredClone(a), HoleShot: a.HoleShot + 1 };
    armed = true;
    assert.equal((await post(url, [a, b])).status, 500);
    armed = false;
    const again = await post(url, [a, b]);
    assert.equal(again.status, 200);
    assert.equal(again.body.added, 0);
    assert.equal(again.body.revised, 0);
    assert.equal(again.body.conflicts, 1);
  });
});

// ---- round 12: a hub that cannot read its journal back says so; a steady clock; tests for eight wrong versions ----

const JOURNAL_BACK = /could not read its journal journal\.jsonl back \((\w+)\)/;

function coded(code: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`failed (${code}, test)`);
  e.code = code;
  return e;
}

test('101. a failed write followed by a rebuild that cannot read the journal prints one line with the code; only the lost line if that came first; again after the same hub object is restarted', { timeout: 240000 }, async () => {
  // part 1: the journal's read fails with EBUSY while the rebuild reads it back
  const dir = tempDir();
  const state = { arm: false };
  const io = {
    write: (fd: number, buf: Buffer, off: number, len: number, position: number): number => {
      if (state.arm) throw coded('EIO');
      return writeSync(fd, buf, off, len, position);
    },
    openRead: (path: string): number => {
      if (state.arm) throw coded('EBUSY');
      return openSync(path, 'r');
    },
  };
  const said: string[] = [];
  const hub = createHub({ dataDir: dir, port: 0, log: () => undefined, warn: (l) => said.push(l), journal: { io } });
  try {
    let a = await hub.listen();
    let url = `http://${a.host}:${a.port}`;
    assert.equal((await post(url, [REC(0)])).status, 200);
    state.arm = true;
    assert.equal((await post(url, [REC(1)])).status, 500);
    state.arm = false;
    const lines = (): string[] => said.filter((l) => JOURNAL_BACK.test(l));
    assert.equal(lines().length, 1);
    assert.match(lines()[0]!, /\(EBUSY\)/);
    assert.match(lines()[0]!, /takes no more shots until it is restarted/);
    assert.match(lines()[0]!, /nothing it answered 200 for is lost/);
    assert.match(lines()[0]!, /stop this hub and start it again/);
    assert.ok(!lines()[0]!.includes(dir) && !lines()[0]!.toLowerCase().includes(basename(dir).toLowerCase()), 'no path in it');
    assert.equal((await post(url, [REC(2)])).status, 503);
    assert.equal((await fetch(`${url}/v0/rounds`)).status, 503);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.equal(lines().length, 1, 'nothing more is printed');
    await hub.close();
    // the same hub object, started again on the good folder, failing again: the line is printed again
    a = await hub.listen();
    url = `http://${a.host}:${a.port}`;
    assert.equal((await post(url, [REC(1)])).status, 200);
    state.arm = true;
    assert.equal((await post(url, [REC(2)])).status, 500);
    state.arm = false;
    assert.equal(lines().length, 2, 'once more after the next listen()');
  } finally {
    await hub.close();
  }
  // part 2: the lost line came first: only the lost line is printed
  const dir2 = tempDir();
  let armed = false;
  const said2: string[] = [];
  await withHub(dir2, { warn: (l) => said2.push(l), hooks: { beforeWriteLook: () => {
    if (!armed) return;
    unlinkSync(join(dir2, 'hub.lock.1'));
    appendFileSync(journalOf(dir2), 'this line is damaged\n');
  } } }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    armed = true;
    assert.equal((await post(url, [REC(1)])).status, 503);
    armed = false;
    assert.equal((await fetch(`${url}/v0/rounds`)).status, 503, 'the rebuild did fail');
  });
  assert.equal(said2.filter((l) => REMOVED.test(l)).length, 1);
  assert.equal(said2.filter((l) => JOURNAL_BACK.test(l)).length, 0, 'only the lost line');
});

test('102. a starter whose read of the current lock fails with EPERM every time is refused after five seconds with the "a hub may be running" words; the folder is untouched', { timeout: 60000 }, () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'hub.lock.1'), `${process.pid} ${'1'.repeat(24)}\n`);
  const before = readdirSync(dir).sort();
  const started = Date.now();
  let message = '';
  try {
    takeLock(dir, () => undefined, {
      read: () => {
        throw coded('EPERM');
      },
    });
  } catch (e) {
    message = (e as Error).message;
  }
  assert.ok(Date.now() - started >= 4500, 'it waited the five seconds');
  assert.match(message, /^hub\.lock\.1 cannot be read \(EPERM\); a hub may be running under that lock and another program may be holding the file; try again in a moment; delete the file only when no hub is running/);
  assert.doesNotMatch(message, /if no hub is running, delete it/);
  assert.ok(!message.includes(dir) && !message.toLowerCase().includes(basename(dir).toLowerCase()), message);
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test('103. a second start on a folder whose lock names a running process says to delete the file only once sure no hub is running', { timeout: 60000 }, async () => {
  const dir = tempDir();
  const other = await stranger();
  try {
    writeFileSync(join(dir, 'hub.lock.4'), `${other.pid} ${GOOD_TOKEN}\n`);
    let message = '';
    try {
      takeLock(dir, () => undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.match(message, /may be another program: stop nothing; once you are sure no hub is running on this folder, delete hub\.lock\.4 and start again\.$/);
    assert.doesNotMatch(message, /stop nothing, delete/);
  } finally {
    other.kill();
  }
});

test('104. the repeat is timed by a clock that does not jump: with the default clock, a Date.now that jumps an hour prints no repeat', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  // Date.now is replaced BEFORE the hub is made, by a function whose offset the test moves: a hub that took Date.now as its clock would follow it
  let offset = 0;
  const real = Date.now;
  Date.now = () => real() + offset;
  try {
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      seam.mode = 'fail';
      assert.equal((await post(url, [REC(1)])).status, 503);
      assert.equal(said.filter((l) => FIRST.test(l)).length, 1);
      offset = 3_600_000;
      assert.equal((await post(url, [REC(1)])).status, 503);
      assert.equal(said.filter((l) => REPEAT.test(l)).length, 0, 'a PC clock set an hour ahead is not an hour of stretch');
    });
  } finally {
    Date.now = real;
  }
});

test('105. the repeat\'s timing and words: none at 59.5 s, one at exactly 60 s ("about 1 minute"), one each minute counted from the start ("about 2 minutes"), minutes rounded', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  let t = 2_000_000;
  await withHub(tempDir(), { lockRead: seam.read, now: () => t, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam.mode = 'fail';
    const repeats = (): string[] => said.filter((l) => REPEAT.test(l));
    await post(url, [REC(1)]);
    t = 2_000_000 + 59_500;
    await post(url, [REC(1)]);
    assert.equal(repeats().length, 0, 'nothing at 59.5 seconds');
    t = 2_000_000 + 60_000;
    await post(url, [REC(1)]);
    assert.equal(repeats().length, 1, 'one at exactly 60 seconds');
    assert.match(repeats()[0]!, /after about 1 minute:/);
    t = 2_000_000 + 120_000;
    await post(url, [REC(1)]);
    assert.equal(repeats().length, 2);
    assert.match(repeats()[1]!, /after about 2 minutes:/, 'counted from the start of the stretch, not from the last line');
    t = 2_000_000 + 270_000;
    await post(url, [REC(1)]);
    assert.match(repeats()[2]!, /after about 5 minutes:/, '4.5 minutes is rounded, not cut');
  });
});

test('106. the code filter and the repeat: 33 characters print error, 32 are printed; the repeat prints the filtered code; the repeat names the journal when it is the journal', { timeout: 240000 }, async () => {
  // M1: the length of the code
  for (const [code, expected] of [['A'.repeat(33), '(error)'], ['A'.repeat(32), `(${'A'.repeat(32)})`]] as const) {
    const seam = lockSeam();
    seam.code = code;
    const said: string[] = [];
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      seam.mode = 'once';
      await post(url, [REC(1)]);
    });
    assert.ok(said.join('\n').includes(expected), `${code.length} characters: ${said.join(' ')}`);
  }
  // S2: the repeat prints the filtered code too
  const seam2 = lockSeam();
  seam2.code = 'C:\\Users\\Somebody\\ZZTEST-A';
  const said2: string[] = [];
  let t2 = 1_000;
  await withHub(tempDir(), { lockRead: seam2.read, now: () => t2, warn: (l) => said2.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    seam2.mode = 'fail';
    await post(url, [REC(1)]);
    t2 = 1_000 + 61_000;
    await post(url, [REC(1)]);
  });
  assert.equal(said2.filter((l) => REPEAT.test(l)).length, 1);
  assert.ok(!said2.join('\n').includes('Somebody') && !said2.join('\n').includes('ZZTEST-A'), said2.join(' | '));
  assert.match(said2.filter((l) => REPEAT.test(l))[0]!, /\(error\)/);
  // S3: the repeat names the file that cannot be looked at
  const io = {
    statPath: (): { dev: bigint; ino: bigint } => {
      throw coded('EBUSY');
    },
  };
  const said3: string[] = [];
  let t3 = 5_000;
  await withHub(tempDir(), { journal: { io }, now: () => t3, warn: (l) => said3.push(l) }, async (url) => {
    await post(url, [REC(0)]);
    t3 = 5_000 + 61_000;
    await post(url, [REC(0)]);
  });
  const repeat3 = said3.find((l) => REPEAT.test(l))!;
  assert.ok(repeat3, said3.join(' | '));
  assert.match(repeat3, /look at its journal/);
  assert.match(repeat3, /holding journal\.jsonl/);
  assert.doesNotMatch(repeat3, /hub\.lock/);
});
