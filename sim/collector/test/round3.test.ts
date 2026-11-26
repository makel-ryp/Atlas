import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createCollector, defaultPost, checkHubUrl, statusLine, type Collector, type PostResult } from '../src/collector.js';
import { createFiles } from '../src/files.js';
import {
  standIns, tempDir, removeTemps, startHub, closeAll, rounds, assertKnownAnswer, rig, rigs, sumAnswers, spyFiles, standIn, synth, sleep, until, manualTimer, heldPost,
} from './helpers.js';

afterEach(async () => {
  for (const r of rigs) {
    if (r.lastWritten !== undefined && existsSync(r.gspro)) assert.equal(readFileSync(r.gspro, 'utf8'), r.lastWritten, 'GSPro file changed');
  }
  rigs.length = 0;
  await closeAll();
});
after(removeTemps);

/** Gives anything wrongly started a few turns of the event loop to show itself. */
async function turns(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
}

const NO_HUB = 'http://127.0.0.1:1'; // a stand-in post is used, nothing ever connects here

function counts(n: number): string {
  return JSON.stringify({ added: n, revised: 0, unchanged: 0, conflicts: 0 });
}

/** Wraps defaultPost and records, in one sequence, when each call started and ended. */
function watchedPost() {
  let seq = 0;
  let inflight = 0;
  const w = {
    attempts: [] as Array<{ start: number; end?: number }>,
    maxInflight: 0,
    post: async (url: string, body: string): Promise<PostResult> => {
      const a: { start: number; end?: number } = { start: ++seq };
      w.attempts.push(a);
      inflight++;
      w.maxInflight = Math.max(w.maxInflight, inflight);
      try {
        return await defaultPost(url, body);
      } finally {
        inflight--;
        a.end = ++seq;
      }
    },
  };
  return w;
}

// ---- A: one post in flight ----

test('A1. 450 records, three batches, the timer\'s handler fired 60 times while each post is held: never more than one post unanswered, in outbox order, each record marked sent once', async () => {
  const r = rig(NO_HUB, false);
  const timer = manualTimer();
  const held = heldPost();
  const c = r.make({ post: held.post, timer });
  try {
    r.write(JSON.stringify(synth(450)));
    c.start();
    timer.fire();
    let fires = 1;
    for (let b = 0; b < 3; b++) {
      await until(() => held.calls.length >= b + 1, `post ${b + 1} started`);
      for (let i = 0; i < 60; i++) {
        timer.fire();
        fires++;
        await turns(1);
      }
      assert.equal(held.calls.length, b + 1, `while post ${b + 1} is held the handler starts no other post`);
      assert.equal(held.inflight, 1);
      assert.equal(held.maxInflight, 1);
      assert.equal(c.status().sent, b === 0 ? 0 : b === 1 ? 200 : 400, 'nothing is marked sent before the hub answered');
      held.calls[b]!.release();
    }
    await until(() => c.status().pending === 0, 'all sent');
    await turns();
    assert.ok(fires >= 150);
    assert.deepEqual(held.calls.map((x) => x.size), [200, 200, 50]);
    assert.deepEqual(held.calls.flatMap((x) => x.ids), synth(450).map((x) => x.ShotID), 'in outbox order');
    assert.equal(held.maxInflight, 1);
    assert.equal(c.status().sent, 450);
    assert.equal(c.status().pending, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(r.data, 'sent.json'), 'utf8')), { cursor: 450, sent: 450, refused: 0 });
  } finally {
    held.openUp();
    await c.stop();
  }
});

test('A2. the same through defaultPost and a real socket: a hub that holds each answer, the handler fired throughout, never more than one request open', async () => {
  const r = rig(NO_HUB, false);
  let open = 0;
  let maxOpen = 0;
  const seen: string[][] = [];
  const server: Server = createServer((req, res) => {
    open++;
    maxOpen = Math.max(maxOpen, open);
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      const recs = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { records: Array<{ ShotID: string }> }).records;
      seen.push(recs.map((x) => x.ShotID));
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(counts(recs.length));
        open--;
      }, 40);
    });
  });
  standIns.push(server);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const timer = manualTimer();
  const c: Collector = createCollector({ gsproFile: r.gspro, dataDir: r.data, hubUrl: url, timer }); // its own defaultPost
  try {
    r.write(JSON.stringify(synth(450)));
    c.start();
    let fires = 0;
    const end = Date.now() + 8000;
    while (c.status().pending > 0 || fires === 0) {
      for (let i = 0; i < 8; i++) {
        timer.fire(); // bursts, so that the count does not depend on how fast this PC's timers are
        fires++;
        await turns(1);
      }
      if (maxOpen > 1 || Date.now() > end) break;
      await sleep(2);
    }
    await until(() => open === 0 || maxOpen > 1, 'the last answer ended');
    assert.ok(fires >= 50, `the handler was fired ${fires} times`);
    assert.equal(maxOpen, 1, 'never more than one request open at the hub');
    assert.deepEqual(seen.map((x) => x.length), [200, 200, 50]);
    assert.deepEqual(seen.flat(), synth(450).map((x) => x.ShotID), 'arrived in outbox order');
    assert.equal(c.status().sent, 450);
    assert.equal(c.status().pending, 0);
  } finally {
    await c.stop();
  }
});

test('A3. a post that is given up: the first connection is closed before the second request arrives, never two open, nothing marked sent that the hub did not answer 200 for', { timeout: 12_000 }, async () => {
  const r = rig(NO_HUB, false);
  let seq = 0;
  let open = 0;
  let maxOpen = 0;
  const reqs: Array<{ arrived: number; closed?: number; answered?: number }> = [];
  let answered200 = 0;
  const server: Server = createServer((req, res) => {
    const q: (typeof reqs)[number] = { arrived: ++seq };
    const index = reqs.push(q) - 1;
    open++;
    maxOpen = Math.max(maxOpen, open);
    let done = false;
    const finish = (kind: 'closed' | 'answered'): void => {
      if (done) return;
      done = true;
      q[kind] = ++seq;
      open--;
    };
    req.socket.on('close', () => finish('closed'));
    if (index === 0) {
      req.resume(); // reads the body, never answers
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      const n = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { records: unknown[] }).records.length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(counts(n));
      answered200++;
      finish('answered');
    });
  });
  standIns.push(server);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const timer = manualTimer();
  const c = createCollector({ gsproFile: r.gspro, dataDir: r.data, hubUrl: url, now: r.now, timer }); // its own defaultPost, a clock the test moves
  try {
    r.writeCopy(6); // four records
    c.start();
    const t0 = Date.now();
    // the handler fires throughout the 10 seconds the program waits for an answer that never comes
    while (reqs[0]?.closed === undefined && Date.now() - t0 < 11_500) {
      timer.fire();
      await sleep(25);
    }
    const waited = Date.now() - t0;
    assert.equal(reqs.length, 1, 'no second request while the first is open');
    assert.notEqual(reqs[0]?.closed, undefined, 'the program gave up and closed the connection');
    assert.ok(waited >= 9_500 && waited <= 11_500, `it gave up after ${waited} ms`);
    // given up: nothing counted as sent; the program's clock has not moved, so it still waits before the next post
    await until(() => c.status().server === 'down', 'server=down');
    assert.equal(c.status().sent, 0);
    assert.equal(c.status().pending, 4);
    for (let i = 0; i < 12; i++) {
      timer.fire();
      await sleep(10);
    }
    assert.equal(reqs.length, 1, 'the wait after a failed post is kept');
    r.advance(1000);
    timer.fire();
    await until(() => reqs.length === 2 && reqs[1]!.answered !== undefined, 'the second request answered');
    assert.ok(reqs[0]!.closed! < reqs[1]!.arrived, 'the first connection was closed before the second request arrived');
    assert.equal(maxOpen, 1, 'at no instant were two requests open');
    await until(() => c.status().pending === 0, 'marked after the answer');
    assert.equal(answered200, 1);
    assert.equal(c.status().sent, 4);
    assert.equal(c.status().server, 'up');
  } finally {
    await c.stop();
  }
});

interface Case {
  name: string;
  /** undefined: nothing listens. */
  answer?: (res: import('node:http').ServerResponse, base: string) => void;
  server: string;
  wait: number;
}
const CASES: Case[] = [
  { name: 'a refused connection', server: 'down', wait: 1000 },
  { name: 'a 500', answer: (res) => (res.writeHead(500), res.end('{}')), server: 'refusing-500', wait: 1000 },
  { name: 'a 503 with Retry-After 20', answer: (res) => (res.writeHead(503, { 'Retry-After': '20' }), res.end('{}')), server: 'busy', wait: 20_000 },
  { name: 'a 503 without Retry-After', answer: (res) => (res.writeHead(503), res.end('{}')), server: 'busy', wait: 1000 },
  { name: 'a 302', answer: (res, base) => (res.writeHead(302, { Location: `${base}/elsewhere` }), res.end()), server: 'redirect', wait: 1000 },
  { name: 'a wrong 200', answer: (res) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end('{}')), server: 'unexpected', wait: 1000 },
];

test('A4. every answer that keeps the batch: the next post waits for the one before and for the wait, and the handler firing in between sends nothing', async () => {
  for (const k of CASES) {
    let url: string;
    let hits: Array<{ url: string }> | undefined;
    if (k.answer) {
      const answer = k.answer;
      let base = '';
      const s = await standIn((_q, res) => answer(res, base));
      base = s.url;
      url = s.url;
      hits = s.hits;
    } else {
      const probe = createServer();
      await new Promise<void>((res) => probe.listen(0, '127.0.0.1', res));
      url = `http://127.0.0.1:${(probe.address() as { port: number }).port}`;
      await new Promise<void>((res) => probe.close(() => res()));
    }
    const r = rig(url, false);
    const timer = manualTimer();
    const w = watchedPost();
    const c = r.make({ post: w.post, timer });
    try {
      r.writeCopy(6); // four records
      c.start();
      timer.fire();
      for (let i = 0; i < 20; i++) {
        timer.fire();
        await turns(1);
      }
      await until(() => c.status().retryDelayMs === k.wait && w.attempts[0]?.end !== undefined, `${k.name}: the first post ended`);
      assert.equal(c.status().server, k.server, k.name);
      for (let i = 0; i < 25; i++) {
        timer.fire();
        await sleep(2);
      }
      assert.equal(w.attempts.length, 1, `${k.name}: the handler during the wait sent nothing`);
      r.advance(k.wait - 1);
      for (let i = 0; i < 10; i++) {
        timer.fire();
        await turns(1);
      }
      assert.equal(w.attempts.length, 1, `${k.name}: not before the full wait`);
      r.advance(1);
      timer.fire();
      await until(() => w.attempts.length === 2 && w.attempts[1]!.end !== undefined, `${k.name}: the second post ended`);
      assert.ok(w.attempts[1]!.start > w.attempts[0]!.end!, `${k.name}: the second post started after the first ended`);
      assert.equal(w.maxInflight, 1, k.name);
      if (hits) assert.equal(hits.length, 2, `${k.name}: the hub saw two requests`);
      assert.equal(c.status().sent, 0, `${k.name}: nothing marked sent`);
      assert.equal(c.status().pending, 4, `${k.name}: the batch stays`);
    } finally {
      await c.stop();
    }
  }
});

test('A5. stop() called while a post is held and not awaited, then start() and the handler fired: still never two posts unanswered, and stop waits for the pass', async () => {
  const r = rig(NO_HUB, false);
  const timer = manualTimer();
  const held = heldPost();
  const c = r.make({ post: held.post, timer });
  try {
    r.write(JSON.stringify(synth(450)));
    c.start();
    timer.fire();
    await until(() => held.calls.length === 1, 'the first post started');
    let stopped = false;
    const stopping = c.stop().then(() => void (stopped = true)); // not awaited
    assert.equal(timer.active, false, 'stop took the timer away');
    await turns(5);
    assert.equal(stopped, false, 'stop does not return while the pass is in flight');
    c.start();
    assert.equal(timer.active, true);
    for (let b = 0; b < 3; b++) {
      await until(() => held.calls.length >= b + 1, `post ${b + 1} started`);
      for (let i = 0; i < 60; i++) {
        timer.fire();
        await turns(1);
      }
      assert.equal(held.calls.length, b + 1, `after stop and start the handler starts no second post (post ${b + 1} held)`);
      assert.equal(held.maxInflight, 1);
      assert.equal(stopped, false, 'stop still waits');
      held.calls[b]!.release();
    }
    await stopping;
    assert.equal(stopped, true);
    assert.equal(held.maxInflight, 1);
    assert.equal(c.status().sent, 450);
  } finally {
    held.openUp();
    await c.stop();
  }
});

test('A6. two copies of the program on one round file, each with its own data folder, against the real hub: interleaved passes end on the known answer, no conflict', async () => {
  const { url } = await startHub(tempDir());
  const a = rig(url);
  const b = rig(url);
  const ta = manualTimer();
  const tb = manualTimer();
  const ca = a.make({ timer: ta });
  const cb = b.make({ timer: tb, gsproFile: a.gspro }); // the one round file, its own data folder
  assert.notEqual(a.data, b.data);
  try {
    ca.start();
    cb.start();
    for (let n = 1; n <= 38; n++) {
      a.writeCopy(n);
      if (n % 3 === 0) {
        await ca.tick();
        await cb.tick();
      } else if (n % 3 === 1) {
        await Promise.all([ca.tick(), cb.tick()]); // the two passes overlap
      } else {
        await cb.tick();
        await ca.tick();
      }
    }
    assert.equal(ca.status().pending, 0);
    assert.equal(cb.status().pending, 0);
    assert.equal(sumAnswers(a, 'conflicts') + sumAnswers(b, 'conflicts'), 0, 'no conflict at the hub');
    assert.equal(sumAnswers(a, 'added') + sumAnswers(b, 'added'), 41, 'every record added once, the second copy of each only unchanged');
    assert.ok(a.posted.length > 0 && b.posted.length > 0, 'both programs posted');
    const data = await rounds(url);
    assertKnownAnswer(data);
    assert.ok(data.rounds.every((x: any) => x.needsReview === false));
  } finally {
    await ca.stop();
    await cb.stop();
  }
});

// ---- B: the six wrong versions the reviews left alive ----

test('B1 (X1). a batch stops before a ShotID already in it: a changed shot goes in the next post, in outbox order', async () => {
  const r = rig(NO_HUB, false);
  const sent: string[][] = [];
  let up = false;
  const c = r.make({
    post: async (_u, body) => {
      if (!up) throw new Error('hub down');
      const recs = (JSON.parse(body) as { records: Array<{ ShotID: string; HoleShot: number }> }).records;
      sent.push(recs.map((x) => `${x.ShotID}:${x.HoleShot}`));
      return { status: 200, body: { added: recs.length, revised: 0, unchanged: 0, conflicts: 0 } };
    },
  });
  const s1 = synth(2)[0];
  const t = synth(2)[1];
  const s2 = { ...s1, HoleShot: 2 };
  r.write(JSON.stringify([s1]));
  r.advance(31_000);
  await c.tick();
  r.write(JSON.stringify([s2, t]));
  r.advance(31_000);
  await c.tick();
  assert.equal(c.status().pending, 3);
  up = true;
  r.advance(31_000);
  await c.tick();
  assert.deepEqual(sent, [['PH-SHOT-0:1'], ['PH-SHOT-0:2', 'PH-SHOT-1:1']], 'S, then the changed S with T; the changed S is not skipped past');
  assert.equal(c.status().pending, 0);
});

test('B2 (X3). defaultPost gives up on a hub that never answers, by itself, in about 10 seconds', { timeout: 20_000 }, async () => {
  const s = await standIn(() => undefined); // never answers
  const t0 = Date.now();
  const outcome = await Promise.race([
    defaultPost(`${s.url}/v0/shots`, '{"records":[]}').then(() => 'answered', (e: unknown) => (e as Error).name),
    sleep(12_000).then(() => 'still waiting'),
  ]);
  const took = Date.now() - t0;
  assert.equal(outcome, 'TimeoutError');
  assert.ok(took >= 9_500 && took < 12_000, `gave up after ${took} ms`);
});

test('B3 (X4). the server address is used in its one fixed form: a trailing slash or a different spelling still posts to /v0/shots', async () => {
  const s = await standIn((q, res) => {
    res.writeHead(q.url === '/v0/shots' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(q.url === '/v0/shots' ? counts(4) : '{}');
  });
  assert.equal(checkHubUrl(`${s.url}/`), s.url);
  assert.equal(checkHubUrl(`http://LOCALHOST:${s.port}/`), `http://localhost:${s.port}`);
  for (const spelled of [`${s.url}/`, `http://LOCALHOST:${s.port}/`, `http://localhost:${s.port}`]) {
    s.hits.length = 0;
    const r = rig(spelled, false);
    const c = r.make();
    r.writeCopy(6);
    await c.tick();
    assert.deepEqual(s.hits.map((h) => h.url), ['/v0/shots'], spelled);
    assert.equal(c.status().sent, 4, spelled);
    assert.equal(c.status().server, 'up', spelled);
  }
});

test('B4 (X20). the status line says disk=error when the program could not write one of its own files, and not otherwise', async () => {
  const base = { copiesRead: 1, queued: 1, sent: 1, refused: 0, pending: 0, server: 'up' as const, file: 'ok' as const, retryDelayMs: 0 };
  assert.ok(statusLine({ ...base, store: 'error' }).endsWith(' disk=error'));
  assert.ok(!statusLine({ ...base, store: 'ok' }).includes('disk'));
  // and through a program whose outbox write fails once
  const s = await standIn((_q, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(counts(4));
  });
  const r = rig(s.url, false);
  const spy = spyFiles(createFiles(r.data, r.gspro), (method, name) => method === 'appendDurable' && name === 'outbox.jsonl');
  const lines: string[] = [];
  const c = r.make({ files: spy.files, onStatus: (st) => void lines.push(statusLine(st)) });
  r.writeCopy(6);
  await c.tick();
  assert.equal(c.status().store, 'error');
  assert.ok(statusLine(c.status()).endsWith(' disk=error'));
  assert.ok(lines.some((l) => l.endsWith(' disk=error')), 'the line printed says it');
  await c.tick(); // the same copy is read again, the write works now
  assert.equal(c.status().store, 'ok');
  assert.ok(!statusLine(c.status()).includes('disk'));
});

test('B5 (O1). every durable append forces the bytes onto the disk after writing them, on the file it wrote', () => {
  const dir = tempDir();
  const f = createFiles(join(dir, 'data'), join(dir, 'g.dat'));
  f.ensureDataDir();
  const target = join(dir, 'data', 'a.jsonl');
  const realFsync = fs.fsyncSync;
  const seen: Array<{ sizeOnFd: number; text: string }> = [];
  let hookCalls = 0;
  fs.fsyncSync = ((fd: number) => {
    hookCalls++;
    try {
      seen.push({ sizeOnFd: fs.fstatSync(fd).size, text: readFileSync(target, 'utf8') });
    } catch {
      // another file (a temporary one): not the append
    }
    return realFsync(fd);
  }) as typeof fs.fsyncSync;
  syncBuiltinESMExports();
  try {
    f.writeData('control.json', '{}'); // control: the hook is in place and sees a flush
    assert.ok(hookCalls >= 1, 'control: the hook sees fsync calls at all');
    hookCalls = 0;
    seen.length = 0;
    f.appendDurable('a.jsonl', 'one\n');
    assert.equal(hookCalls, 1, 'one flush for the append');
    f.appendDurable('a.jsonl', 'two\n');
    assert.equal(hookCalls, 2, 'one flush for each append');
  } finally {
    fs.fsyncSync = realFsync;
    syncBuiltinESMExports();
  }
  assert.deepEqual(seen.map((x) => x.text), ['one\n', 'one\ntwo\n'], 'the flush comes after the write');
  assert.deepEqual(seen.map((x) => x.sizeOnFd), [4, 8], 'and on the file that was written');
});

test('B6 (O2). the tidy-up writes one short line for each distinct ShotID, even when the last copy holds one ShotID twice', async () => {
  const r = rig(NO_HUB, false);
  const c = r.make({
    tidyOverBytes: 1,
    post: async (_u, body) => {
      const n = (JSON.parse(body) as { records: unknown[] }).records.length;
      return { status: 200, body: { added: n, revised: 0, unchanged: 0, conflicts: 0 } };
    },
  });
  const [a, b] = synth(2);
  const twice = { ...a, HoleShot: 2 }; // the same ShotID again, changed
  r.write(JSON.stringify([a, twice, b]));
  await c.tick();
  assert.equal(c.status().pending, 0);
  assert.equal(c.status().sent, 3, 'all three records were sent (two versions of one shot, in two posts)');
  const lines = readFileSync(join(r.data, 'outbox.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 2, 'two distinct ShotIDs, two short lines');
  assert.ok(lines.every((l) => (JSON.parse(l) as any).short !== undefined));
  assert.equal(JSON.parse(readFileSync(join(r.data, 'sent.json'), 'utf8')).cursor, 2);
  // and the program starts again from that folder
  const again = r.make({ post: async () => { throw new Error('nothing should be posted'); }, timer: manualTimer() });
  again.start();
  assert.equal(again.status().pending, 0);
  await again.stop();
});
