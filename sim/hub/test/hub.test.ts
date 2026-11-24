import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, writeSync, ftruncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { request } from 'node:http';
import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { createHub, type Hub, type HubOptions } from '../src/server.js';
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
async function assertRestartEqualsLive(dir: string, url: string, label: string): Promise<void> {
  const live = await rounds(url);
  await withHub(dir, {}, async (url2) => {
    assert.deepEqual(await rounds(url2), live, label);
  });
}

test('14. post [A], then [A, B] (B is A with HoleShot one higher): journal holds A, then A and B; a restart equals live', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
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
    await assertRestartEqualsLive(dir, url, 'restart after the duplicate in one post');
  });
});

test('15. a changed owner posted twice: both lines are written and a restart equals live', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    const a = structuredClone(copies[37]!.records[0]!) as any;
    const a2 = { ...structuredClone(a), UserGuid: `${a.UserGuid}-other` };
    assert.equal((await post(url, [a])).status, 200);
    assert.deepEqual((await post(url, [a2])).body, { added: 0, revised: 0, unchanged: 0, conflicts: 1 });
    assert.deepEqual((await post(url, [a2])).body, { added: 0, revised: 0, unchanged: 0, conflicts: 1 });
    assert.deepEqual(journalLines(dir).map((l) => JSON.parse(l) as unknown[]), [[a], [a2], [a2]]);
    await assertRestartEqualsLive(dir, url, 'restart after a changed owner');
  });
});

test('16. a record that changes and later changes back is written all three times', async () => {
  const dir = tempDir();
  await withHub(dir, {}, async (url) => {
    const a = structuredClone(copies[37]!.records[0]!) as any;
    const b = { ...structuredClone(a), HoleShot: a.HoleShot + 1 };
    for (const r of [a, b, a]) assert.equal((await post(url, [r])).status, 200);
    assert.equal(journalLines(dir).length, 3);
    await assertRestartEqualsLive(dir, url, 'restart after a change and a change back');
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
  await withHub(dir, {}, async (url) => {
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
    await assertRestartEqualsLive(dir, url, 'restart after 38 posts sent at once');
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
