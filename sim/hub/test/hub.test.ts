import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { execFile } from 'node:child_process';
import { createHub, type Hub } from '../src/server.js';
import { loadRecording, type Copy } from '../../core/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORDING = join(HERE, '../../fixtures/gspro-4.1.13/2026-11-23');
const copies: Copy[] = loadRecording(RECORDING);
const temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sim-hub-test-'));
  temps.push(d);
  return d;
}

const quiet = { log: () => undefined, warn: () => undefined };

async function start(dir: string, extra: Partial<Parameters<typeof createHub>[0]> = {}): Promise<{ hub: Hub; url: string }> {
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, ...extra });
  const a = await hub.listen();
  return { hub, url: `http://${a.host}:${a.port}` };
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

function journalOf(dir: string): string {
  return join(dir, 'journal.jsonl');
}
function journalSize(dir: string): number {
  return existsSync(journalOf(dir)) ? statSync(journalOf(dir)).size : 0;
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
  const { hub, url } = await start(tempDir());
  try {
    await postCopies(url, 0, 38);
    assertKnownAnswer(await rounds(url));
  } finally {
    await hub.close();
  }
});

test('2. posting the same copy again answers all unchanged and changes nothing', async () => {
  const { hub, url } = await start(tempDir());
  try {
    await postCopies(url, 0, 38);
    const before = await rounds(url);
    const last = copies[37]!;
    const r = await post(url, last.records);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { added: 0, revised: 0, unchanged: last.records.length, conflicts: 0 });
    assert.deepEqual(await rounds(url), before);
  } finally {
    await hub.close();
  }
});

test('3. a record re-sent with a different HoleShot answers revised 1 and replaces the first', async () => {
  const { hub, url } = await start(tempDir());
  try {
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
  } finally {
    await hub.close();
  }
});

test('4a. stop after copy 20, start again on the same folder, post 21 to 38: the known answer', async () => {
  const dir = tempDir();
  const one = await start(dir);
  await postCopies(one.url, 0, 20);
  await one.hub.close();
  const two = await start(dir);
  try {
    await postCopies(two.url, 20, 38);
    assertKnownAnswer(await rounds(two.url));
  } finally {
    await two.hub.close();
  }
});

test('4b. a server started on the full journal with nothing posted gives the known answer', async () => {
  const dir = tempDir();
  const one = await start(dir);
  await postCopies(one.url, 0, 38);
  await one.hub.close();
  const two = await start(dir);
  try {
    assertKnownAnswer(await rounds(two.url));
  } finally {
    await two.hub.close();
  }
});

test('5a. a journal whose last line is cut short starts, skips it, and keeps what is before it', async () => {
  const dir = tempDir();
  const one = await start(dir);
  await postCopies(one.url, 0, 38);
  await one.hub.close();
  const full = readFileSync(journalOf(dir), 'utf8');
  const lines = full.trimEnd().split('\n');
  assert.equal(lines.length, 38);
  writeFileSync(journalOf(dir), `${lines.slice(0, 37).join('\n')}\n${lines[37]!.slice(0, Math.floor(lines[37]!.length / 2))}`);
  const warnings: string[] = [];
  const two = await start(dir, { warn: (l) => warnings.push(l) });
  try {
    assert.equal(warnings.length, 1);
    const data = await rounds(two.url);
    const expected = await (async () => {
      const d2 = tempDir();
      const ref = await start(d2);
      try {
        await postCopies(ref.url, 0, 37);
        return await rounds(ref.url);
      } finally {
        await ref.hub.close();
      }
    })();
    assert.deepEqual(data, expected);
    // the next batch lands on a clean line, so the file is whole again after a restart
    await post(two.url, copies[37]!.records);
  } finally {
    await two.hub.close();
  }
  const three = await start(dir);
  try {
    assertKnownAnswer(await rounds(three.url));
  } finally {
    await three.hub.close();
  }
});

test('5b. a journal with a broken line in the middle refuses to start', async () => {
  const dir = tempDir();
  const one = await start(dir);
  await postCopies(one.url, 0, 5);
  await one.hub.close();
  const lines = readFileSync(journalOf(dir), 'utf8').trimEnd().split('\n');
  lines[2] = lines[2]!.slice(0, 20);
  writeFileSync(journalOf(dir), `${lines.join('\n')}\n`);
  const hub = createHub({ dataDir: dir, port: 0, ...quiet });
  await assert.rejects(() => hub.listen(), /corrupt/);
  assert.equal(hub.address(), undefined);
});

test('6. bad JSON, no records, and a record missing HoleResult answer 400 and change nothing', async () => {
  const dir = tempDir();
  const { hub, url } = await start(dir);
  try {
    await postCopies(url, 0, 10);
    const before = await rounds(url);
    const size = journalSize(dir);
    const raw = async (body: string) => {
      const res = await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return { status: res.status, body: (await res.json()) as any };
    };
    assert.deepEqual(await raw('{not json'), { status: 400, body: { error: 'bad_json' } });
    assert.deepEqual(await raw('{"other":[]}'), { status: 400, body: { error: 'bad_shape' } });
    assert.deepEqual(await raw('[1,2]'), { status: 400, body: { error: 'bad_shape' } });
    assert.deepEqual(await raw('{"records":"x"}'), { status: 400, body: { error: 'bad_shape' } });
    // a good record first, then one missing HoleResult: the whole batch is refused
    const good = structuredClone(copies[37]!.records[0]!) as any;
    const bad = structuredClone(copies[37]!.records[1]!) as any;
    delete bad.HoleResult;
    assert.deepEqual(await raw(JSON.stringify({ records: [good, bad] })), { status: 400, body: { error: 'unknown_layout' } });
    assert.deepEqual(await rounds(url), before);
    assert.equal(journalSize(dir), size);
  } finally {
    await hub.close();
  }
});

test('7a. a body over the limit answers 413 and the journal does not grow', async () => {
  const dir = tempDir();
  const small = JSON.stringify({ records: copies[0]!.records }).length;
  const { hub, url } = await start(dir, { maxBodyBytes: small + 10 });
  try {
    await postCopies(url, 0, 1);
    const size = journalSize(dir);
    const big = JSON.stringify({ records: copies[37]!.records });
    assert.ok(big.length > small + 10);
    const res = await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
    assert.equal(res.status, 413);
    assert.equal(journalSize(dir), size);
  } finally {
    await hub.close();
  }
});

test('7b. a real body over 32 MB is refused with 413 (or the connection is cut) and the journal does not grow', async () => {
  const dir = tempDir();
  const { hub, url } = await start(dir);
  try {
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
  } finally {
    await hub.close();
  }
});

test('8. wrong method answers 405, unknown path 404', async () => {
  const { hub, url } = await start(tempDir());
  try {
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
  } finally {
    await hub.close();
  }
});

test('9. the bound address is 127.0.0.1', async () => {
  const hub = createHub({ dataDir: tempDir(), port: 0, ...quiet });
  assert.equal(hub.address(), undefined);
  const a = await hub.listen();
  try {
    assert.equal(a.host, '127.0.0.1');
    assert.equal(hub.address()?.host, '127.0.0.1');
    assert.ok(a.port > 0);
  } finally {
    await hub.close();
  }
  assert.equal(hub.address(), undefined);
});

test('10. no answer carries an Access-Control-Allow-Origin header', async () => {
  const { hub, url } = await start(tempDir());
  try {
    const heads: Headers[] = [];
    heads.push((await fetch(`${url}/healthz`, { headers: { Origin: 'http://example.test' } })).headers);
    heads.push((await fetch(`${url}/v0/rounds`, { headers: { Origin: 'http://example.test' } })).headers);
    heads.push((await fetch(`${url}/v0/shots`, { method: 'OPTIONS', headers: { Origin: 'http://example.test' } })).headers);
    heads.push((await post(url, copies[0]!.records)).headers);
    heads.push((await fetch(`${url}/nope`)).headers);
    for (const h of heads) assert.equal(h.get('access-control-allow-origin'), null);
  } finally {
    await hub.close();
  }
});

test('11. the replay tool run against a test server prints the known scorecard', async () => {
  const { hub, url } = await start(tempDir());
  try {
    const script = join(HERE, '../src/replay.ts');
    const out = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, ['--import', 'tsx/esm', script, '--url', url], { cwd: join(HERE, '../../..') }, (err, stdout, stderr) => {
        if (err) reject(new Error(`replay exited with an error: ${stderr}`));
        else resolve(stdout);
      });
    });
    assert.match(out, /ZZTEST-A/);
    assert.match(out, /ZZTEST-B/);
    assert.match(out, /total 18/);
    assert.match(out, /total 20/);
    assertKnownAnswer(await rounds(url));
  } finally {
    await hub.close();
  }
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
    await fetch(`${url}/v0/shots`, { method: 'POST', body: `{"records": "${NAME}` });
    await fetch(`${url}/${NAME}?${GUID}=1`);
    await fetch(`${url}/v0/rounds?${SHOT}=1`);
  } finally {
    await hub.close();
    Object.assign(console, orig);
  }
  assert.ok(seen.length > 0, 'the server did write status lines');
  const text = seen.join('\n');
  for (const s of [NAME, GUID, SHOT]) assert.ok(!text.includes(s), `${s} leaked to the console`);
});
