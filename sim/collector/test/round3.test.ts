import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync, existsSync, readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import ts from 'typescript';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createCollector, defaultPost, checkHubUrl, statusLine, type Collector, type PostFn, type PostResult } from '../src/collector.js';
import { createFiles, type Files } from '../src/files.js';
import {
  SRC, counted, hubs, overlapLog, OVERLAP_MESSAGE, reportOverlaps, standIns, tempDir, removeTemps, startHub, closeAll, rounds, assertKnownAnswer, rig, rigs, sumAnswers, spyFiles, standIn, synth, sleep, until, manualTimer, heldPost,
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
  const c: Collector = createCollector({ gsproFile: r.gspro, dataDir: r.data, hubUrl: url, timer, post: counted(defaultPost) }); // its own defaultPost, counted
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

test('A3. a post that is given up: the first connection is closed before the second request arrives, never two open, nothing marked sent that the hub did not answer 200 for', { timeout: 30_000 }, async () => {
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
  const c = createCollector({ gsproFile: r.gspro, dataDir: r.data, hubUrl: url, now: r.now, timer, post: counted(defaultPost) }); // its own defaultPost, counted, a clock the test moves
  try {
    r.writeCopy(6); // four records
    c.start();
    const t0 = Date.now();
    // the handler fires throughout the 10 seconds the program waits for an answer that never comes
    while (reqs[0]?.closed === undefined && Date.now() - t0 < 13_000) {
      timer.fire();
      await sleep(25);
    }
    const waited = Date.now() - t0;
    assert.equal(reqs.length, 1, 'no second request while the first is open');
    assert.notEqual(reqs[0]?.closed, undefined, 'the program gave up and closed the connection (it never gave up)');
    assert.ok(waited >= 9_500 && waited <= 12_000, `it gave up after ${waited} ms`);
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
    server.closeAllConnections(); // a program that never gives up must not keep this test alive
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

/** Fires the program's own handler n times, a turn of the event loop apart. */
async function fireMany(timer: { fire(): void }, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    timer.fire();
    await turns(1);
  }
}

const OVERLAP = 'OVERLAP: a second post was sent while one was still unanswered';

test('A7. a new copy arrives while a post is held: the handler fired 45 times after each answer, never two posts unanswered, no batch twice, outbox order, each record marked sent once', async () => {
  const r = rig(NO_HUB, false);
  const timer = manualTimer();
  const held = heldPost();
  const c = r.make({ post: held.post, timer });
  try {
    r.write(JSON.stringify(synth(10)));
    c.start();
    timer.fire();
    await until(() => held.calls.length === 1, 'the first post started');
    for (let stage = 0; stage < 3; stage++) {
      r.write(JSON.stringify(synth(30 + 20 * stage))); // a new copy, 20 records longer, while post stage+1 is held
      await fireMany(timer, 10);
      assert.equal(held.calls.length, stage + 1, `${OVERLAP} (the handler fired while post ${stage + 1} was held)`);
      held.calls[stage]!.release();
      await fireMany(timer, 45);
      assert.equal(held.calls.length, stage + 2, `${OVERLAP}, or a batch was posted twice (after the answer to post ${stage + 1}): ${held.calls.length} posts`);
      assert.ok(held.maxInflight <= 1, `${OVERLAP}: ${held.maxInflight} unanswered at once`);
    }
    held.calls[3]!.release();
    await until(() => c.status().pending === 0, 'all sent');
    await fireMany(timer, 40);
    assert.equal(held.calls.length, 4, OVERLAP);
    assert.equal(held.maxInflight, 1, OVERLAP);
    assert.deepEqual(held.calls.map((x) => x.size), [10, 20, 20, 20]);
    assert.equal(new Set(held.calls.map((x) => x.ids.join(','))).size, held.calls.length, 'no batch was posted twice');
    assert.deepEqual(held.calls.flatMap((x) => x.ids), synth(70).map((x) => x.ShotID), 'in outbox order');
    assert.equal(c.status().sent, 70);
    assert.deepEqual(JSON.parse(readFileSync(join(r.data, 'sent.json'), 'utf8')), { cursor: 70, sent: 70, refused: 0 });
  } finally {
    held.openUp();
    await c.stop();
  }
});

test('A8. the same through defaultPost and a real socket: a new copy written during each of three posts in a row, the handler fired throughout, never more than one request open', async () => {
  const r = rig(NO_HUB, false);
  let open = 0;
  let maxOpen = 0;
  let arrivals = 0;
  const seen: string[][] = [];
  const server: Server = createServer((req, res) => {
    open++;
    maxOpen = Math.max(maxOpen, open);
    const index = arrivals++;
    if (index < 3) r.write(JSON.stringify(synth(10 * (index + 2)))); // a new copy arrives while this post is out
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      const recs = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { records: Array<{ ShotID: string }> }).records;
      seen.push(recs.map((x) => x.ShotID));
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(counts(recs.length));
        open--;
      }, 60);
    });
  });
  standIns.push(server);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const timer = manualTimer();
  const c: Collector = createCollector({ gsproFile: r.gspro, dataDir: r.data, hubUrl: url, timer, post: counted(defaultPost) }); // its own defaultPost, counted
  try {
    r.write(JSON.stringify(synth(10)));
    c.start();
    let fires = 0;
    const end = Date.now() + 8000;
    while (c.status().sent < 40 || fires === 0) {
      for (let i = 0; i < 20; i++) {
        timer.fire();
        fires++;
        await turns(1);
      }
      if (maxOpen > 1 || Date.now() > end) break;
      await sleep(2);
    }
    await until(() => open === 0 || maxOpen > 1, 'the last answer ended');
    assert.equal(maxOpen, 1, `${OVERLAP}: ${maxOpen} requests open at the hub at once`);
    assert.ok(fires >= 120, `the handler was fired ${fires} times`);
    assert.deepEqual(seen.map((x) => x.length), [10, 10, 10, 10], `${OVERLAP}, or a batch was posted twice`);
    assert.equal(new Set(seen.map((x) => x.join(','))).size, seen.length, 'no batch was posted twice');
    assert.deepEqual(seen.flat(), synth(40).map((x) => x.ShotID), 'arrived in outbox order');
    assert.equal(c.status().sent, 40);
    assert.equal(c.status().pending, 0);
  } finally {
    await c.stop();
  }
});

for (const failure of ['a refused connection', 'a 503'] as const) {
  test(`A9. a new copy arrives while a post is failing (${failure}): the wait is kept, the handler sends nothing, then one post holds the old and the new records in outbox order, never two`, async () => {
    const r = rig(NO_HUB, false);
    const timer = manualTimer();
    const held = heldPost();
    let started = 0;
    let unanswered = 0;
    let maxUnanswered = 0;
    const post = async (url: string, body: string): Promise<PostResult> => {
      const n = ++started;
      unanswered++;
      maxUnanswered = Math.max(maxUnanswered, unanswered);
      try {
        if (n === 1) {
          await sleep(40); // the post is out for a moment; the test writes the new copy meanwhile
          if (failure === 'a refused connection') throw new Error('refused');
          return { status: 503, body: { error: 'busy' } };
        }
        return await held.post(url, body);
      } finally {
        unanswered--;
      }
    };
    const c = r.make({ post, timer });
    try {
      r.write(JSON.stringify(synth(10)));
      c.start();
      timer.fire();
      await until(() => started === 1, 'the first post started');
      r.write(JSON.stringify(synth(30))); // a new copy arrives while the first post is out
      await fireMany(timer, 20);
      assert.equal(started, 1, `${OVERLAP} (the handler fired while the first post was out)`);
      await until(() => c.status().retryDelayMs === 1000, 'the first post failed');
      assert.equal(c.status().server, failure === 'a refused connection' ? 'down' : 'busy');
      for (let i = 0; i < 30; i++) {
        timer.fire();
        await sleep(2);
      }
      assert.equal(started, 1, 'the wait after a failed post is kept: the handler sent nothing');
      r.advance(999);
      await fireMany(timer, 10);
      assert.equal(started, 1, 'not before the full wait');
      r.advance(1);
      timer.fire();
      await until(() => held.calls.length === 1, 'the post after the wait');
      assert.deepEqual(held.calls[0]!.ids, synth(30).map((x) => x.ShotID), 'one post, the old and the new records in outbox order');
      // and a third copy during that post, then the answer
      r.write(JSON.stringify(synth(50)));
      await fireMany(timer, 40);
      assert.equal(started, 2, `${OVERLAP} (the handler fired while the second post was held)`);
      held.calls[0]!.release();
      await fireMany(timer, 45);
      assert.equal(started, 3, `${OVERLAP}, or a batch was posted twice: ${started} posts`);
      assert.equal(maxUnanswered, 1, `${OVERLAP}: ${maxUnanswered} unanswered at once`);
      assert.deepEqual(held.calls[1]!.ids, synth(50).slice(30).map((x) => x.ShotID));
      held.calls[1]!.release();
      await until(() => c.status().pending === 0, 'all sent');
      assert.equal(c.status().sent, 50);
    } finally {
      held.openUp();
      await c.stop();
    }
  });
}

// ---- A10, A11: the two cases the round-4 review built wrong versions for ----

for (const refusal of [400, 413] as const) {
  test(`A10. a refused batch with more waiting (${refusal}): 250 records, the next post held, the handler fired 45 times: never two unanswered, the refused batch posted once and kept in the refused file, the 50 that follow posted once`, async () => {
    const r = rig(NO_HUB, false);
    const timer = manualTimer();
    const held = heldPost();
    const c = r.make({ post: held.post, timer });
    try {
      r.write(JSON.stringify(synth(250)));
      c.start();
      timer.fire();
      await until(() => held.calls.length === 1, 'the first post started');
      await fireMany(timer, 10);
      assert.equal(held.calls.length, 1, `${OVERLAP} (the handler fired while the first post was held)`);
      held.calls[0]!.release({ status: refusal, body: { error: 'refused' } });
      await fireMany(timer, 45);
      assert.equal(held.calls.length, 2, `${OVERLAP}, or a batch was posted twice (after the ${refusal}): ${held.calls.length} posts`);
      assert.equal(held.maxInflight, 1, `${OVERLAP}: ${held.maxInflight} unanswered at once`);
      assert.deepEqual(held.calls.map((x) => x.size), [200, 50]);
      assert.deepEqual(held.calls[1]!.ids, synth(250).slice(200).map((x) => x.ShotID), 'the 50 that follow, in order');
      const refused = readFileSync(join(r.data, 'refused.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
      assert.equal(refused.length, 1, 'the refused batch is in the refused file, once');
      const line = JSON.parse(refused[0]!) as { status: number; records: Array<{ ShotID: string }> };
      assert.equal(line.status, refusal);
      assert.deepEqual(line.records.map((x) => x.ShotID), synth(200).map((x) => x.ShotID));
      held.calls[1]!.release();
      await until(() => c.status().pending === 0, 'all dealt with');
      await fireMany(timer, 40);
      assert.equal(held.calls.length, 2, OVERLAP);
      assert.equal(c.status().sent, 50);
      assert.equal(c.status().refused, 200);
    } finally {
      held.openUp();
      await c.stop();
    }
  });
}

test('A11. GSPro empties its file for a new round while records wait: the post held after the wait, the handler fired 45 times: never two unanswered, the waiting batch posted once', async () => {
  const r = rig(NO_HUB, false);
  const timer = manualTimer();
  const held = heldPost();
  const c = r.make({ post: held.post, timer });
  try {
    r.write(JSON.stringify(synth(10)));
    c.start();
    timer.fire();
    await until(() => held.calls.length === 1, 'the first post started');
    held.calls[0]!.release({ status: 500, body: {} }); // the hub fails: the ten records wait
    await until(() => c.status().retryDelayMs === 1000, 'the wait began');
    assert.equal(c.status().pending, 10);
    r.write(''); // GSPro empties its file for a new round
    r.advance(5000); // past the wait
    await fireMany(timer, 45);
    assert.equal(held.calls.length, 2, `${OVERLAP}, or the waiting batch was posted twice: ${held.calls.length} posts`);
    assert.equal(held.maxInflight, 1, `${OVERLAP}: ${held.maxInflight} unanswered at once`);
    assert.deepEqual(held.calls[1]!.ids, synth(10).map((x) => x.ShotID), 'the waiting batch, once, after the failed post');
    held.calls[1]!.release();
    await until(() => c.status().pending === 0, 'sent');
    await fireMany(timer, 40);
    assert.equal(held.calls.length, 2, OVERLAP);
    assert.equal(c.status().sent, 10);
  } finally {
    held.openUp();
    await c.stop();
  }
});

// ---- A12: a seeded random drive ----

/** A tiny seeded generator (mulberry32): the same seed, the same run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The program's file module, in memory: fast, and the same contract as the real one. */
class MemFiles implements Files {
  src: string | undefined;
  version = 0;
  copy = '';
  data = new Map<string, string>();
  onEmptyCopy: () => void = () => undefined;
  /** How many of the next copies fail, as a busy file does (code EBUSY). */
  failReads = 0;
  onFailedRead: () => void = () => undefined;
  remove(): void {
    this.src = undefined;
    this.version++;
  }
  write(text: string): void {
    this.src = text;
    this.version++;
  }
  statSource(): { size: number; mtimeMs: number } | undefined {
    return this.src === undefined ? undefined : { size: Buffer.byteLength(this.src), mtimeMs: this.version };
  }
  copySource(): void {
    if (this.failReads > 0) {
      this.failReads--;
      this.onFailedRead();
      throw Object.assign(new Error('file busy (made up)'), { code: 'EBUSY' });
    }
    this.copy = this.src ?? '';
    if (this.copy === '') this.onEmptyCopy();
  }
  readCopy(): string {
    return this.copy;
  }
  ensureDataDir(): void {}
  readData(name: string): string | undefined {
    return this.data.get(name);
  }
  readLines(name: string, _pieceBytes: number, onLine: (line: string) => void): { validBytes: number; tornBytes: number } {
    const text = this.data.get(name) ?? '';
    const cut = text.lastIndexOf('\n') + 1;
    for (const line of text.slice(0, cut).split('\n').slice(0, -1)) onLine(line);
    return { validBytes: Buffer.byteLength(text.slice(0, cut)), tornBytes: Buffer.byteLength(text.slice(cut)) };
  }
  keepPrefix(name: string, bytes: number): void {
    this.data.set(name, Buffer.from(this.data.get(name) ?? '').subarray(0, bytes).toString());
  }
  appendData(name: string, text: string): void {
    this.data.set(name, (this.data.get(name) ?? '') + text);
  }
  appendDurable(name: string, text: string): void {
    this.appendData(name, text);
  }
  writeData(name: string, text: string): void {
    this.data.set(name, text);
  }
}

interface Tally {
  seeds: number;
  steps: number;
  posts: number;
  refusedWithMoreWaiting: number;
  emptyReadWhileWaiting: number;
  newCopyWhilePostOut: number;
  stopStartWhilePostOut: number;
  firedInsideWait: number;
  failedReadWhileWaiting: number;
  backlogOver600AtPostStart: number;
  fileGoneWhileWaiting: number;
}

function newTally(): Tally {
  return { seeds: 0, steps: 0, posts: 0, refusedWithMoreWaiting: 0, emptyReadWhileWaiting: 0, newCopyWhilePostOut: 0, stopStartWhilePostOut: 0, firedInsideWait: 0, failedReadWhileWaiting: 0, backlogOver600AtPostStart: 0, fileGoneWhileWaiting: 0 };
}

interface DriveCall {
  records: Array<Record<string, any>>;
  ended: boolean;
  resolve(r: PostResult): void;
  reject(e: Error): void;
}

/** `tidy`: the outbox is tidied when it is over 3 000 bytes (and what is checked at the end is less: see A12b). */
async function driveOne(seed: number, steps: number, tally: Tally, tidy = false): Promise<void> {
  const rand = seeded(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const mem = new MemFiles();
  let clock = 1_000_000;
  const timer = manualTimer();
  const calls: DriveCall[] = [];
  let unanswered = 0;
  let maxUnanswered = 0;
  let auto = false;
  const okBatches: Array<Array<Record<string, any>>> = [];
  const refusedBatches: Array<Array<Record<string, any>>> = [];
  const answeredBatches: Array<Array<Record<string, any>>> = []; // ok and refused, in the order the answers came
  let failedSize = 0;
  const post: PostFn = (_url, body) =>
    new Promise<PostResult>((resolve, reject) => {
      unanswered++;
      maxUnanswered = Math.max(maxUnanswered, unanswered);
      if (c.status().pending > 600) tally.backlogOver600AtPostStart++;
      const records = (JSON.parse(body) as { records: Array<Record<string, any>> }).records;
      const call: DriveCall = {
        records,
        ended: false,
        resolve(r) {
          if (call.ended) return;
          call.ended = true;
          unanswered--;
          resolve(r);
        },
        reject(e) {
          if (call.ended) return;
          call.ended = true;
          unanswered--;
          reject(e);
        },
      };
      calls.push(call);
      if (auto) call.resolve({ status: 200, body: { added: records.length, revised: 0, unchanged: 0, conflicts: 0 } });
    });
  const c = createCollector({ gsproFile: 'unused', dataDir: 'unused', hubUrl: 'http://127.0.0.1:1', files: mem, post, now: () => clock, timer, tidyOverBytes: tidy ? 3000 : Number.MAX_SAFE_INTEGER }); // A12 has no tidy-up: an empty read followed by a tidy-up forgets what was sent (a known minor of round 2), which would show as a record dealt with twice; A12b has it
  mem.onEmptyCopy = () => {
    if (c.status().pending > 0) tally.emptyReadWhileWaiting++;
  };
  mem.onFailedRead = () => {
    if (c.status().pending > 0) tally.failedReadWhileWaiting++;
  };
  const stops: Array<Promise<void>> = [];
  const out = (): DriveCall | undefined => calls.find((x) => !x.ended);
  const base = { ...(synth(1)[0] as Record<string, any>) };
  delete base.GhostData; // the two big fields (36 KB a record) make a long drive slow and add nothing here
  delete base.activeShot;
  let records: Array<Record<string, any>> = [];
  let lastFull: Array<Record<string, any>> | undefined;
  let nextId = 0;
  let version = 0;
  let waitUntil = 0;
  let step = 0;
  let what = 'start';

  const newRecord = (): Record<string, any> => ({ ...base, ShotID: `D${seed}-${nextId}`, Hole: nextId++ % 18, HoleResult: ++version }); // the version is in HoleResult: HoleShot may not pass 999
  const writeFull = (): void => {
    lastFull = records.map((x) => ({ ...x }));
    mem.write(JSON.stringify(records));
  };
  const answer = async (call: DriveCall, kind: number): Promise<void> => {
    const n = call.records.length;
    if (kind < 40) {
      okBatches.push(call.records);
      answeredBatches.push(call.records);
      call.resolve({ status: 200, body: { added: n, revised: 0, unchanged: 0, conflicts: 0 } });
    } else if (kind < 51) {
      if (c.status().pending > n) tally.refusedWithMoreWaiting++;
      refusedBatches.push(call.records);
      answeredBatches.push(call.records);
      call.resolve({ status: kind < 46 ? 400 : 413, body: { error: 'refused' } });
    } else {
      failedSize += n;
      if (kind < 59) call.resolve({ status: 500, body: {} });
      else if (kind < 66) call.resolve({ status: 503, body: {}, retryAfterSec: 1 + pick(60) });
      else if (kind < 73) call.resolve({ status: 503, body: {} });
      else if (kind < 79) call.resolve({ status: 302, body: undefined });
      else if (kind < 86) call.resolve({ status: 200, body: {} });
      else call.reject(new Error('connection failed'));
    }
    await turns(2);
    if (kind >= 51 && c.status().retryDelayMs > 0) waitUntil = clock + c.status().retryDelayMs;
  };
  const check = (): void => {
    assert.ok(unanswered <= 1 && maxUnanswered <= 1, `${OVERLAP} (${maxUnanswered} unanswered at once)`);
  };

  try {
    c.start();
    for (step = 1; step <= steps; step++) {
      const e = pick(110);
      if (e < 12) {
        what = 'a longer copy';
        const k = pick(100) < 5 && records.length < 60 ? 205 + pick(60) : 1 + pick(8); // now and then more than one batch (200) at once
        for (let i = 0; i < k && records.length < 450; i++) records.push(newRecord());
        if (out()) tally.newCopyWhilePostOut++;
        writeFull();
      } else if (e < 22) {
        what = 'an earlier record changed';
        if (records.length > 0) {
          const i = pick(records.length);
          records[i] = { ...records[i]!, HoleResult: ++version };
          if (out()) tally.newCopyWhilePostOut++;
          writeFull();
        }
      } else if (e < 28) {
        what = 'an empty file';
        mem.write('');
      } else if (e < 34) {
        what = 'a cut-off copy';
        const text = JSON.stringify(records);
        mem.write(records.length > 0 ? text.slice(0, Math.max(1, Math.floor(text.length * 0.5))) : '[{');
      } else if (e < 56) {
        what = 'the handler fired';
        const k = 1 + pick(20);
        const inWait = c.status().retryDelayMs > 0 && clock < waitUntil;
        const before = calls.length;
        for (let i = 0; i < k; i++) timer.fire();
        await turns(2);
        if (inWait) {
          tally.firedInsideWait++;
          assert.equal(calls.length, before, 'a post was started inside the wait after a failed post');
        }
      } else if (e < 68) {
        what = 'the clock moved on';
        clock += pick(41) * 1000;
      } else if (e < 90) {
        what = 'an answer to the post that is out';
        const call = out();
        if (call) await answer(call, pick(100));
      } else if (e < 95) {
        what = 'a post left unanswered';
      } else if (e < 100) {
        what = 'stop() not awaited, then start()';
        if (out()) tally.stopStartWhilePostOut++;
        stops.push(c.stop());
        c.start();
      } else if (e < 103) {
        what = 'the next copies fail to be read (EBUSY)';
        mem.failReads = 1 + pick(3);
      } else if (e < 105) {
        what = 'a backlog: up to 1 000 records at once';
        const k = 250 + pick(450);
        for (let i = 0; i < k && records.length < 1000; i++) records.push(newRecord());
        if (out()) tally.newCopyWhilePostOut++;
        writeFull();
      } else {
        what = 'the round file is gone for more than 30 seconds';
        mem.remove();
        clock += 31_000;
        for (let i = 1 + pick(4); i > 0; i--) timer.fire();
        await turns(2);
        if (c.status().file === 'not-found' && c.status().pending > 0) tally.fileGoneWhileWaiting++;
      }
      await turns(1);
      check();
    }
    tally.steps += steps;

    // The end: answer everything with 200, let the handler run until nothing waits.
    what = 'the end of the run';
    step = steps + 1;
    mem.failReads = 0;
    for (let i = 0; i < 600; i++) {
      const call = out();
      if (call) await answer(call, 0);
      if (lastFull !== undefined && i === 0) mem.write(JSON.stringify(lastFull));
      clock += 31_000;
      for (let k = 0; k < 3; k++) timer.fire();
      await turns(2);
      check();
      if (i >= 3 && c.status().pending === 0 && !out()) break; // at least three rounds after the last full copy was written again
    }
    await Promise.all(stops);
    await c.tick();
    check();
    assert.equal(c.status().pending, 0, 'everything was dealt with');
    assert.ok(!out(), 'no post is out at the end');

    const key = (x: Record<string, any>): string => JSON.stringify(x);
    const done = new Map<string, number>();
    const lastVersion = new Map<string, number>();
    for (const batch of answeredBatches) {
      for (const x of batch) {
        done.set(key(x), (done.get(key(x)) ?? 0) + 1);
        const before = lastVersion.get(x.ShotID) ?? 0;
        if (!tidy) assert.ok(x.HoleResult > before, `shot ${x.ShotID}: version ${x.HoleResult} dealt with after version ${before} (outbox order broken)`);
        lastVersion.set(x.ShotID, x.HoleResult);
      }
    }
    const okCount = okBatches.reduce((s, b) => s + b.length, 0);
    const refusedCount = refusedBatches.reduce((s, b) => s + b.length, 0);
    if (!tidy) for (const [k, n] of done) assert.equal(n, 1, `a record version was dealt with ${n} times: ${k.slice(0, 80)}`);
    for (const x of lastFull ?? []) assert.ok(done.has(key(x)), `a record of the last full copy is neither sent nor refused: ${x.ShotID}`);
    if (!tidy) {
      assert.equal(c.status().sent, okCount, 'sent is the records answered with a 200, no more');
      assert.equal(c.status().refused, refusedCount, 'refused is the records answered with a 400 or 413');
      const postedTotal = calls.reduce((s, x) => s + x.records.length, 0);
      assert.equal(postedTotal, okCount + refusedCount + failedSize, 'the sizes posted add up');
    }
    assert.ok(calls.every((x) => x.records.length <= 200), 'no batch over 200');
    tally.posts += calls.length;
    tally.seeds++;
  } catch (e) {
    throw new Error(`A12${tidy ? 'b' : ''} failed at seed ${seed}, step ${step} (${what}): ${(e as Error).message}. Run it again alone with ${tidy ? 'A12B_SEED' : 'A12_SEED'}=${seed}`, { cause: e });
  } finally {
    auto = true;
    for (const call of calls) call.resolve({ status: 200, body: { added: call.records.length, revised: 0, unchanged: 0, conflicts: 0 } });
    await c.stop();
  }
}

test('A12. a seeded random drive: 250 seeds of 80 steps (copies, changes, empty and cut-off files, handler firings, clock, every kind of answer, stop and start): after every step at most one post unanswered; at the end everything is sent or refused, once', { timeout: 120_000 }, async () => {
  const only = process.env.A12_SEED;
  const seeds = only !== undefined ? [Number(only)] : Array.from({ length: 250 }, (_, i) => i + 1);
  const tally = newTally();
  const t0 = Date.now();
  for (const seed of seeds) await driveOne(seed, 80, tally);
  console.log(`A12 tally over ${tally.seeds} seeds in ${Date.now() - t0} ms: ${JSON.stringify(tally)}`);
  if (only === undefined) {
    assert.equal(tally.seeds, 250);
    assert.ok(tally.steps >= 250 * 60);
    for (const k of ['refusedWithMoreWaiting', 'emptyReadWhileWaiting', 'newCopyWhilePostOut', 'stopStartWhilePostOut', 'firedInsideWait', 'failedReadWhileWaiting', 'backlogOver600AtPostStart', 'fileGoneWhileWaiting'] as const) {
      assert.ok(tally[k] > 0, `the drive never reached: ${k}`);
    }
  }
});

test('A12b. a shorter drive with the tidy-up on and a small size limit: 100 seeds of 60 steps; after every step at most one post unanswered; at the end every record of the last full copy is sent or refused', { timeout: 120_000 }, async () => {
  const only = process.env.A12B_SEED;
  const seeds = only !== undefined ? [Number(only)] : Array.from({ length: 100 }, (_, i) => 1000 + i);
  const tally = newTally();
  const t0 = Date.now();
  for (const seed of seeds) await driveOne(seed, 60, tally, true);
  console.log(`A12b tally over ${tally.seeds} seeds in ${Date.now() - t0} ms: ${JSON.stringify(tally)}`);
  if (only === undefined) {
    assert.equal(tally.seeds, 100);
    assert.ok(tally.steps >= 100 * 60);
  }
});

// ---- A13: the places a post can start are pinned ----

/**
 * The program's text as the TypeScript compiler reads it: the file is parsed, and comments, strings, templates and
 * regular expressions are found by the compiler, not by this test. Comments are dropped (a `//` comment to the end of
 * its line, a block comment made one space). A string or a template's own text is kept whole (`keepText`) or dropped
 * (`''` or an empty template), so a word that is only text does not count; the code inside a template's `${}` is
 * always kept. A name is given as the compiler reads it, whatever its spelling in the file (an escape counts as the letter it
 * stands for). A string used as a name in brackets (`options['post']`) counts as the word it holds. Everything else,
 * regular expressions included, is kept as it stands.
 */
function parseSource(src: string): ts.SourceFile {
  return ts.createSourceFile('source.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function leafTokens(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node): void => {
    const kids = n.getChildren(sf).filter((k) => !(k.kind >= ts.SyntaxKind.FirstJSDocNode && k.kind <= ts.SyntaxKind.LastJSDocNode));
    if (kids.length === 0) {
      if (n.kind !== ts.SyntaxKind.SyntaxList) out.push(n);
    } else {
      kids.forEach(walk);
    }
  };
  walk(sf);
  return out;
}

function withoutComments(trivia: string): string {
  let out = '';
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, trivia);
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
    if (k === ts.SyntaxKind.SingleLineCommentTrivia) continue;
    if (k === ts.SyntaxKind.MultiLineCommentTrivia) {
      out += ' ';
      continue;
    }
    out += sc.getTokenText();
  }
  return out;
}

function scanSource(src: string, keepText: boolean): string {
  const sf = parseSource(src);
  let out = '';
  for (const leaf of leafTokens(sf)) {
    out += withoutComments(src.slice(leaf.getFullStart(), leaf.getStart(sf)));
    const text = src.slice(leaf.getStart(sf), leaf.getEnd());
    switch (leaf.kind) {
      case ts.SyntaxKind.StringLiteral: {
        if (keepText) {
          out += text;
          break;
        }
        out += text[0]! + text[0]!;
        const parent = leaf.parent;
        const value = (leaf as ts.StringLiteral).text;
        if (parent !== undefined && ts.isElementAccessExpression(parent) && parent.argumentExpression === leaf && /^[A-Za-z_$][\w$]*$/.test(value)) out += ` ${value} `;
        break;
      }
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral: {
        out += keepText ? text : '`` ';
        const parent = leaf.parent;
        const value = (leaf as ts.NoSubstitutionTemplateLiteral).text;
        if (!keepText && parent !== undefined && ts.isElementAccessExpression(parent) && parent.argumentExpression === leaf && /^[A-Za-z_$][\w$]*$/.test(value)) out += ` ${value} `;
        break;
      }
      case ts.SyntaxKind.TemplateHead:
        out += keepText ? text : '``  ';
        break;
      case ts.SyntaxKind.TemplateMiddle:
        out += keepText ? text : '  ';
        break;
      case ts.SyntaxKind.TemplateTail:
        out += keepText ? text : ' ';
        break;
      case ts.SyntaxKind.Identifier:
      case ts.SyntaxKind.PrivateIdentifier:
        out += (leaf as ts.Identifier).text; // the name as the compiler reads it: an escaped spelling (defaultPost) is the same name
        break;
      default:
        out += text;
    }
  }
  return out;
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const wordCount = (text: string, word: string): number => (text.match(new RegExp(`\\b${word}\\b`, 'g')) ?? []).length;
const countOf = (re: RegExp, text: string): number => (text.match(re) ?? []).length;

/** Every node of a parsed file, in source order. */
function allNodes(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node): void => {
    out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** The text inside the braces of the function called `name` (comments dropped, strings kept, white space made one space). */
function functionBody(src: string, name: string): string | undefined {
  const sf = parseSource(src);
  for (const n of allNodes(sf)) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body !== undefined) return squash(scanSource(n.body.getText(sf).slice(1, -1), true));
  }
  return undefined;
}

/** The first statement (a variable statement or an expression statement, at any depth) whose text starts with `start`, inside `within` (a function's name, or the whole file). */
function statementStarting(src: string, start: string, within?: string): string | undefined {
  const sf = parseSource(src);
  let scope: ts.Node = sf;
  if (within !== undefined) {
    const f = allNodes(sf).find((n) => ts.isFunctionDeclaration(n) && n.name?.text === within);
    if (f === undefined) return undefined;
    scope = f;
  }
  for (const n of allNodes(scope as ts.SourceFile)) {
    if (ts.isVariableStatement(n) || ts.isExpressionStatement(n)) {
      const t = squash(scanSource(n.getText(sf), true));
      if (t.startsWith(start)) return t;
    }
  }
  return undefined;
}

interface ImportFacts {
  statements: string[];
  specifiers: string[];
  wholeModule: boolean;
}

/** Every import, re-export, `require(` and `import(` anywhere in a file, as the compiler parses it. */
function importFacts(src: string): ImportFacts {
  const sf = parseSource(src);
  const facts: ImportFacts = { statements: [], specifiers: [], wholeModule: false };
  const add = (n: ts.Node, spec: ts.Expression | undefined): void => {
    facts.statements.push(squash(scanSource(n.getText(sf), true)));
    if (spec !== undefined && ts.isStringLiteralLike(spec)) facts.specifiers.push(spec.text);
  };
  for (const n of allNodes(sf)) {
    if (ts.isImportDeclaration(n)) {
      add(n, n.moduleSpecifier);
      if (n.importClause?.namedBindings !== undefined && ts.isNamespaceImport(n.importClause.namedBindings)) facts.wholeModule = true;
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined) {
      add(n, n.moduleSpecifier);
      if (n.exportClause === undefined || ts.isNamespaceExport(n.exportClause)) facts.wholeModule = true;
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      add(n, n.moduleReference.expression);
      facts.wholeModule = true;
    } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      add(n, n.arguments[0]);
    }
  }
  return facts;
}

// ---- what the bay program's side uses: modules, global names, process members (A13) ----

/**
 * True when a declaration makes a value at run time. An ambient declaration (`declare ...`, anything inside one, a .d.ts),
 * an interface, a type alias, a type-only import and a namespace that holds only types make none: a name whose every
 * declaration is of that kind is, at run time, still the global of that name.
 */
function makesValue(decl: ts.Declaration): boolean {
  if ((decl.flags & (ts.NodeFlags as unknown as { Ambient: number }).Ambient) !== 0) return false; // the compiler's flag for a node inside a declare, or in a .d.ts
  if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) return false;
  if (ts.isImportClause(decl) && decl.isTypeOnly) return false;
  if (ts.isImportSpecifier(decl) && (decl.isTypeOnly || decl.parent.parent.isTypeOnly)) return false;
  if (ts.isNamespaceImport(decl) && decl.parent.isTypeOnly) return false;
  if (ts.isImportEqualsDeclaration(decl) && decl.isTypeOnly) return false;
  if (ts.isModuleDeclaration(decl) && !moduleHoldsValue(decl)) return false;
  return true;
}

/** The name a declaration gives (an import specifier, an interface, a type alias, a variable, a function...): the declaration itself, not a use of the name. */
function isDeclarationName(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return true;
  if (ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p) || ts.isNamespaceExport(p)) return (p as { name?: ts.Node }).name === n;
  if (
    ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isModuleDeclaration(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) ||
    ts.isClassDeclaration(p) || ts.isEnumDeclaration(p) || ts.isParameter(p) || ts.isTypeParameterDeclaration(p) || ts.isBindingElement(p) ||
    ts.isPropertyDeclaration(p) // the name of a class field (a `declare` field is inside the compiler's ambient flag, so it must not be read as a use)
  ) {
    return (p as { name?: ts.Node }).name === n;
  }
  return false;
}

function moduleHoldsValue(m: ts.ModuleDeclaration): boolean {
  const body = m.body;
  if (body === undefined) return false;
  if (ts.isModuleDeclaration(body)) return moduleHoldsValue(body);
  if (!ts.isModuleBlock(body)) return false;
  return body.statements.some((st) => !(ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || (ts.isModuleDeclaration(st) && !moduleHoldsValue(st)) || (ts.isImportDeclaration(st) && st.importClause?.isTypeOnly === true)));
}

/** Everything in a file that is declared with the `declare` modifier (a variable, function, class, namespace, module, `declare global`), as a short description each. */
function ambientUses(src: string): string[] {
  const sf = parseSource(src);
  const out: string[] = [];
  for (const n of allNodes(sf)) {
    if (!ts.canHaveModifiers(n)) continue;
    if (ts.isPropertyDeclaration(n)) continue; // a class field written `declare x: number` makes no name at all (only the type of a field the class gets some other way): it is not a declaration of a global
    if (!(ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    const named = ts.isVariableStatement(n) ? n.declarationList.declarations.map((d) => d.name.getText(sf)).join(', ') : ((n as { name?: ts.Node }).name?.getText(sf) ?? '');
    out.push(`${ts.isVariableStatement(n) ? 'a variable' : ts.SyntaxKind[n.kind]}${named === '' ? '' : ` ${named}`}`);
  }
  return out;
}

interface SideFacts {
  /** Names used as values that are declared nowhere in the program's own source (not a local, a parameter, an import or a declaration), sorted. */
  globals: string[];
  /** The member names read on `process`, and how many uses of `process` were something else (passed whole, brackets, destructured). */
  processMembers: string[];
  processOther: number;
  /** The same for `import.meta`. */
  metaMembers: string[];
  metaOther: number;
  /** How many times the name `constructor` is read: as a property, in brackets, as a key in a destructuring pattern, or as a string that is exactly that word. A class's own `constructor(...) {}` declaration is not a read. */
  constructorReads: number;
}

/**
 * The names each file uses, resolved by the compiler's own binder: a program is built from the files with no library
 * files (`noLib`) and no module resolution (`noResolve`), so every local, parameter, import and declaration has a
 * symbol and every global name (`fetch`, `JSON`, `process`, `globalThis`, `WebSocket`, ...) has none. That is exact for
 * scope: a local called `fetch` in one function does not make the global `fetch` in another function a local. It is quick,
 * because nothing is loaded but these files. Type positions do not count (a type named in an annotation is not a use).
 * `files` maps a path (with its folder, so the two folders stay apart) to its text.
 */
function sideFacts(files: Record<string, string>): Record<string, SideFacts> {
  const root = '/side/';
  const texts = new Map<string, string>();
  for (const [name, text] of Object.entries(files)) texts.set(root + name, text);
  // every file is made by the program's own host, with the options the program hands it, so that `moduleDetection: Force` is what decides whether a file is a module
  const made = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    getSourceFile: (f, languageVersionOrOptions) => {
      const text = texts.get(f);
      if (text === undefined) return undefined;
      const sf = ts.createSourceFile(f, text, languageVersionOrOptions, true, ts.ScriptKind.TS);
      made.set(f, sf);
      return sf;
    },
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => texts.has(f),
    readFile: (f) => texts.get(f),
  };
  // `moduleDetection: Force` makes every file a module, so a top-level `var` or `function` in a file with no import and no export stays that file's own and never becomes a global for the others
  const program = ts.createProgram({
    rootNames: [...texts.keys()],
    options: { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleDetection: ts.ModuleDetectionKind.Force, noEmit: true },
    host,
  });
  const sources = new Map<string, ts.SourceFile>();
  for (const f of texts.keys()) sources.set(f, program.getSourceFile(f) ?? made.get(f)!);
  const checker = program.getTypeChecker();

  const inTypePosition = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isExpressionWithTypeArguments(p) && ts.isHeritageClause(p.parent) && p.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(p.parent.parent)) return false; // `class X extends Error`: a value
      if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
    }
    return false;
  };

  const out: Record<string, SideFacts> = {};
  for (const [path, sf] of sources) {
    const globals = new Set<string>();
    const processMembers = new Set<string>();
    const metaMembers = new Set<string>();
    let processOther = 0;
    let metaOther = 0;
    let constructorReads = 0;
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'constructor') constructorReads++;
      else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && (n.propertyName === undefined ? ts.isIdentifier(n.name) && n.name.text === 'constructor' : ts.isIdentifier(n.propertyName) && n.propertyName.text === 'constructor')) constructorReads++;
      else if (ts.isStringLiteralLike(n) && n.text === 'constructor') constructorReads++; // a string or a template with no holes that is exactly the word: in brackets, in Reflect.get, in a descriptor lookup, anywhere
      if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
        const p = n.parent;
        if (ts.isPropertyAccessExpression(p) && p.expression === n) metaMembers.add(p.name.text);
        else metaOther++;
      } else if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isName =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isQualifiedName(p) && p.right === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n) ||
          (ts.isMetaProperty(p) && p.name === n) ||
          isDeclarationName(n) ||
          ((ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) && p.label === n);
        if (!isName && !inTypePosition(n)) {
          const symbol = ts.isShorthandPropertyAssignment(p) && p.name === n ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(n);
          const declared = symbol !== undefined && (symbol.declarations ?? []).some(makesValue); // a declaration that makes no value at run time (declare, an interface, a type alias, a type-only import) does not make a name local
          if (!declared) {
            globals.add(n.text);
            if (n.text === 'process') {
              if (ts.isPropertyAccessExpression(p) && p.expression === n) processMembers.add(p.name.text);
              else processOther++;
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    out[path.slice(root.length)] = { globals: [...globals].sort(), processMembers: [...processMembers].sort(), processOther, metaMembers: [...metaMembers].sort(), metaOther, constructorReads };
  }
  return out;
}

/** The script that starts the bay program, as it is in package.json. A preload (`--import`) or another entry file there runs before the program and is outside everything else the pin reads. */
const EXPECTED_START_SCRIPT = 'tsx sim/collector/src/main.ts';
const START_WHY = 'The script that starts the bay program (sim:collector in package.json) is held word for word: a preload (--import, --require) or another entry file there runs before the program and is outside everything else this pin reads. If the change is honest, update the text in this test in the same commit and say so in the commit message.';

function startScriptViolations(script: string | undefined): string[] {
  return script === EXPECTED_START_SCRIPT ? [] : [`sim:collector in package.json is now ${JSON.stringify(script)}, it was ${JSON.stringify(EXPECTED_START_SCRIPT)}`];
}

/** The files the bay program's side is made of: the exact names, in each of the two folders. A new file, a file of another kind (.js, .mts, .cts, .json, anything) and a removed one are each a finding that names the file. */
const EXPECTED_FILES = {
  collector: ['collector.ts', 'files.ts', 'main.ts', 'outbox.ts', 'program.ts'],
  core: ['book.ts', 'command.ts', 'format.ts', 'index.ts', 'parse.ts', 'recording.ts', 'text.ts'],
};

function fileListViolations(label: string, have: string[], want: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of have) if (!want.includes(n)) out.push(`${label}${n} is not one of the files this pin holds (${want.join(', ')}): a new file, or a file of another kind (.js, .mts, .cts, .json), is code or data the program may run`);
  for (const n of want) if (!have.includes(n)) out.push(`${label}${n} is not there any more: it is one of the files this pin holds`);
  return out;
}

const SOURCE_KIND = /\.(ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;

/** True when a source file has an import, an export or a re-export at its top level: a file with none is a script, and its top-level names are globals of every other file for a tool that reads files one by one. */
function hasModuleSyntax(src: string): boolean {
  const sf = parseSource(src);
  return sf.statements.some(
    (st) =>
      ts.isImportDeclaration(st) ||
      ts.isExportDeclaration(st) ||
      ts.isExportAssignment(st) ||
      ts.isImportEqualsDeclaration(st) ||
      (ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
  );
}

/** What npm runs around the start script: a pre or post script of the same name, and `node-options` in an .npmrc (which applies to every script). `npmrc` is the text of the repo root's .npmrc, or undefined when there is none. */
function npmRunsViolations(scripts: Record<string, string> | undefined, npmrc: string | undefined): string[] {
  const out: string[] = [];
  for (const name of ['presim:collector', 'postsim:collector']) if (scripts !== undefined && name in scripts) out.push(`package.json has a ${name} script: npm runs it around sim:collector, outside everything else this pin reads`);
  if (npmrc !== undefined && /^\s*node[-_]options\s*=/im.test(npmrc)) out.push('.npmrc holds a node-options line: it applies to every npm script, and can preload code before the start script');
  return out;
}

const PIN_PURPOSE =
  'A second place that starts a post is how two posts end up in flight, and the hub keeps the one that finished last. Whoever adds such a place on purpose must also show that the rule "one post in flight" still holds (and change this pin with that proof).';

/** What is wrong with the places a post, a flush or a pass can start, in the program's source files (name to text). */
function pinViolations(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const col = scanSource(files['collector.ts'] ?? '', true);
  const posts = countOf(/\bpost\(/g, col);
  if (posts !== 1) bad.push(`post( is called in ${posts} places in collector.ts, not exactly 1`);
  const flushes = countOf(/\bflushStage\(/g, col) - countOf(/function flushStage\(/g, col);
  if (flushes !== 1) bad.push(`flushStage( is called in ${flushes} places in collector.ts (besides its definition), not exactly 1`);
  const passes = countOf(/\bpass\(/g, col) - countOf(/function pass\(/g, col);
  if (passes !== 1) bad.push(`pass( is called in ${passes} places in collector.ts (besides its definition), not exactly 1`);
  const tick = functionBody(files['collector.ts'] ?? '', 'tick');
  if (tick === undefined) {
    bad.push('collector.ts has no function tick');
  } else {
    if (countOf(/\bpass\(/g, tick) !== 1) bad.push('the call of pass( is not inside tick');
    if (!tick.startsWith('if (running) return running;')) bad.push('the first statement of tick is not the guard that returns the running pass');
  }
  const handed = countOf(/\bdefaultPost\b/g, col);
  if (handed !== 2 || !/post = options\.post \?\? oneAtATime\(defaultPost\);/.test(col)) bad.push('defaultPost is used in collector.ts other than as the default handed to the program, behind the gate');
  for (const [name, text] of Object.entries(files)) {
    if (name === 'collector.ts') continue;
    const code = scanSource(text, true);
    for (const word of ['post(', 'flushStage(', 'pass(']) {
      if (new RegExp(`\\b${word.replace('(', '\\(')}`).test(code)) bad.push(`${name} calls ${word}`);
    }
    if (/\bdefaultPost\b/.test(code)) bad.push(`${name} uses defaultPost`);
  }
  return bad;
}

// ---- the argument for one post in flight, as text checks (A13) ----

const WATCHED = ['post', 'flushStage', 'pass', 'running', 'defaultPost', 'oneAtATime', 'fetch', 'timer', 'setTimeout', 'setImmediate', 'queueMicrotask', 'nextTick', 'setInterval', 'createCollector', 'startProgram'] as const;

/** For each file, the whole-word count of each watched word that is above zero (code only), and `.then(`. */
function watchedCounts(files: Record<string, string>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [name, text] of Object.entries(files)) {
    const code = scanSource(text, false);
    const row: Record<string, number> = {};
    for (const w of WATCHED) {
      const c = wordCount(code, w);
      if (c > 0) row[w] = c;
    }
    const then = (code.match(/\.\s*then\s*\(/g) ?? []).length;
    if (then > 0) row['.then('] = then;
    if (Object.keys(row).length > 0) out[name] = row;
  }
  return out;
}

const ARGUMENT = [
  'THE RULE rests first on one small function: `oneAtATime`, around the program\'s own sender (`const post = options.post ?? oneAtATime(defaultPost);`). It lets one post through at a time and refuses a second while the first is unanswered, so whatever else goes wrong around it, a second request does not leave the PC. A card that builds its own post (card 13 adds a key) must put it behind `oneAtATime`, and must not hand it in through `options.post`.',
  'SECOND LINE, the seven links that say why the program also has one post in flight without the gate. They are held as far as statements and counts go:',
  '  1. The only thing in the source that sends anything is one `fetch`, in `defaultPost`, called once per call of `defaultPost` and awaited (and nothing under sim/core/src sends).',
  '  2. The only place the program calls its post is one statement in `flushStage`, and it awaits the answer before anything else in that function runs.',
  '  3. `flushStage` is called from one place, in `pass`, and awaited. `pass` is called from one place, in `tick`.',
  '  4. `tick` starts a pass only when none is running; `running` is set there and cleared only when that pass has ended.',
  '  5. Nothing else in the source can run any of these later or by another name: no reference to `post`, `flushStage`, `pass` or `defaultPost` beyond the ones above; no timer but the one the program is handed and uses once, to call `tick`.',
  '  6. There is one program, and it hands in no post of its own: `createCollector` is called in one place (`startProgram`, in `program.ts`, whose whole body is pinned) and `startProgram` in one place (`main.ts`, which is pinned whole).',
  '  7. Only `collector.ts` knows about the post: every source file imports exactly the modules it imports now, no file imports a whole module as a namespace, and `outbox.ts` and `files.ts` never import `collector.ts` or `program.ts`.',
  'THE BAY PROGRAM\'S SIDE (every .ts file under sim/collector/src and under sim/core/src) may use only the modules, the global names and the process and import.meta members listed in this test. A new one is not wrong in itself: if it cannot send anything and cannot load or run other code, add it to the list in the same commit and say so in the commit message; if it can, the post it makes must go through `oneAtATime`, and must not be handed in through `options.post`. `globalThis`, `global`, `self` and `window` are in no list, so any use of them is found. Nothing there reads `.constructor` (as a property, in brackets, as a destructuring key or as a string that is exactly that word), because that is a road to running text as code; a class\'s own constructor declaration is not a read. Nothing there is declared with `declare` (no declare modifier, no .d.ts file, no /// <reference line), because that makes a global look like a local.',
  'THE KNOWN LIMIT of any test that reads text: a name built at run time (`options[\'po\' + \'st\']`, `Reflect.get`, `Object.values`) is code written so that a reader does not see the name; no test here holds against it, and the person reading the change is the check for it.',
].join('\n');

const WHAT_TO_DO =
  'WHAT TO DO: if you changed the gate or a link on purpose, re-read the rule and the seven links, show that "one post in flight" still holds, and update this pin in the same commit. An honest new import (one more name from `node:path`, say) only needs this pin\'s list of imports updated in the same commit. If a made-up edit of this pin reports that it no longer applies because its anchor line changed, update the anchor in the pin\'s table of edits, not the rule. If you did not mean to change a link, undo the change.';

/** What the watched words and timers count to at the head this pin was written against. Only files with a non-zero count are listed. */
const EXPECTED_COUNTS: Record<string, Record<string, number>> = {
  "collector.ts": {
    "post": 4,
    "flushStage": 2,
    "pass": 2,
    "running": 8,
    "defaultPost": 2,
    "oneAtATime": 2,
    "fetch": 1,
    "timer": 5,
    "setInterval": 7,
    "createCollector": 1
  },
  "main.ts": {
    "startProgram": 2,
    ".then(": 1
  },
  "program.ts": {
    "createCollector": 2,
    "startProgram": 1
  }
};

/** The exact import and re-export statements of each source file (white space made one space). */
const EXPECTED_CORE_IMPORTS: Record<string, string[]> = {
  "book.ts": [
    "import { isDeepStrictEqual } from 'node:util';",
    "import { UnknownLayoutError, checkRecordFields, newValueBudget, plainCopy, readList } from './parse.js';",
    "import { normalisedName } from './text.js';",
    "import type { ShotRecord } from './parse.js';"
  ],
  "command.ts": [
    "import { basename } from 'node:path';",
    "import { RoundBook, type BookIssue } from './book.js';",
    "import { formatScorecard } from './format.js';",
    "import { parseRoundFile } from './parse.js';",
    "import { loadRecording } from './recording.js';",
    "import { cleanText } from './text.js';"
  ],
  "format.ts": [
    "import type { HoleScore, RoundBook, RoundScore } from './book.js';",
    "import { safeText } from './text.js';"
  ],
  "index.ts": [
    "export { parseRoundFile, validateRecord, UnknownLayoutError, MAX_TEXT_CHARS, MAX_RECORDS, MAX_DEPTH, type ShotRecord } from './parse.js';",
    "export { RoundBook, type IngestCounts, type BookIssue, type HoleScore, type PlayerScore, type RoundScore } from './book.js';",
    "export { formatScorecard } from './format.js';",
    "export { normalisedName } from './text.js';",
    "export { runScorecard, issuesLine, type FileAccess, type OpenFile, type CommandResult } from './command.js';",
    "export { loadRecording, type Copy } from './recording.js';"
  ],
  "parse.ts": [
    "import { types } from 'node:util';"
  ],
  "recording.ts": [
    "import { readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "import { parseRoundFile, UnknownLayoutError, type ShotRecord } from './parse.js';"
  ],
  "text.ts": []
};

/** The names the bay program's side uses today: global names (declared nowhere in the program's own source) for each folder, and the members read on process and import.meta. */
const EXPECTED_SIDE = {
  "collectorGlobals": [
    "AbortSignal",
    "Array",
    "Buffer",
    "Date",
    "Error",
    "JSON",
    "Map",
    "Math",
    "Number",
    "Set",
    "URL",
    "clearInterval",
    "console",
    "fetch",
    "process",
    "setInterval",
    "undefined"
  ],
  "coreGlobals": [
    "Array",
    "ArrayBuffer",
    "Buffer",
    "Error",
    "JSON",
    "Map",
    "Math",
    "Number",
    "Object",
    "Reflect",
    "Set",
    "String",
    "structuredClone",
    "undefined"
  ],
  "processMembers": [
    "env",
    "exit",
    "on"
  ],
  "metaMembers": [
    "url"
  ]
};

const EXPECTED_IMPORTS: Record<string, string[]> = {
  "collector.ts": [
    "import { parseRoundFile, UnknownLayoutError, type ShotRecord } from '../../core/src/index.js';",
    "import { createFiles, type Files } from './files.js';",
    "import { CollectorError, Outbox, DEFAULT_PIECE_BYTES } from './outbox.js';",
    "export { CollectorError } from './outbox.js';"
  ],
  "files.ts": [
    "import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';",
    "import { join } from 'node:path';"
  ],
  "main.ts": [
    "import { startProgram } from './program.js';"
  ],
  "outbox.ts": [
    "import { createHash } from 'node:crypto';",
    "import type { ShotRecord } from '../../core/src/index.js';",
    "import type { Files } from './files.js';"
  ],
  "program.ts": [
    "import { homedir } from 'node:os';",
    "import { dirname, join } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { CollectorError, createCollector, statusLine, type Collector, type CollectorOptions } from './collector.js';"
  ]
};

const EXPECTED_LINKS = {
  "gateBody": "let busy = false; return async (url, body) => { if (busy) throw new Error('a post is already out; this one was not sent'); busy = true; try { return await send(url, body); } finally { busy = false; } };",
  "pickPost": "const post = options.post ?? oneAtATime(defaultPost);",
  "tick": "if (running) return running; running = pass().finally(() => { running = undefined; }); return running;",
  "postStatement": "res = await post(`${base}/v0/shots`, JSON.stringify({ records: batch }));",
  "passCallsFlush": "const sendOk = await flushStage();",
  "fetchStatement": "const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'manual', signal: AbortSignal.timeout(POST_TIMEOUT_MS), });",
  "timerStatement": "handle = timer.setInterval(() => { tick().catch((e: unknown) => { if (e instanceof CollectorError) options.onError?.(e); }); }, pollMs);",
  "startProgramBody": "const gsproFile = env.SIM_GSPRO_FILE || defaultGsproFile(env); const hubUrl = env.SIM_HUB_URL || 'http://127.0.0.1:5077'; const dataDir = env.SIM_COLLECTOR_DATA || join(dirname(fileURLToPath(import.meta.url)), '..', '.data'); let announced = false; try { const collector = createCollector({ gsproFile, dataDir, hubUrl, onStatus: (s) => { if (announced) io.log(statusLine(s)); }, onEvent: (e) => { if (e === 'not-found') io.log(watchingLine(gsproFile)); else io.log('sim collector: one unfinished line at the end of the outbox was dropped'); }, onError: (e) => { io.error(`sim collector stopped: ${e.message}`); io.exit(1); }, ...overrides, }); collector.start(); announced = true; io.log('sim collector started: reads the GSPro round file, never writes it, sends to this PC only'); io.log(watchingLine(gsproFile)); io.log(statusLine(collector.status())); return collector; } catch (e) { if (e instanceof CollectorError) { io.error(`sim collector did not start: ${e.message}`); } else { const code = (e as { code?: unknown } | null)?.code; const name = e instanceof Error ? e.name : 'Error'; io.error(`sim collector did not start: ${name}${typeof code === 'string' ? ` ${code}` : ''}`); } io.exit(1); return undefined; }",
  "mainTs": "import { startProgram } from './program.js'; const collector = startProgram(process.env, { log: (l) => console.log(l), error: (l) => console.error(l), exit: (n) => process.exit(n), }); if (collector) { for (const sig of ['SIGINT', 'SIGTERM'] as const) { process.on(sig, () => void collector.stop().then(() => process.exit(0))); } }"
};

/** What is wrong with the rule and the links in the program's source files (path under src to text), and in the core library (path under sim/core/src to text). Each entry says which one moved. */
function argumentViolations(files: Record<string, string>, core: Record<string, string> = {}, deep = false): string[] {
  const bad: string[] = [];
  const link = (what: string, text: string): void => void bad.push(`${what}: ${text}`);
  const linkOfWord = (w: string): string => (w === 'oneAtATime' ? 'the gate' : w === 'createCollector' || w === 'startProgram' ? 'link 6' : w === 'running' ? 'link 4' : 'link 5');

  // the watched words as whole words, wherever they stand, in exactly the files they are in now
  const actual = watchedCounts(files);
  for (const name of new Set([...Object.keys(actual), ...Object.keys(EXPECTED_COUNTS)])) {
    for (const w of [...WATCHED, '.then(']) {
      const have = actual[name]?.[w] ?? 0;
      const want = EXPECTED_COUNTS[name]?.[w] ?? 0;
      if (have !== want) link(linkOfWord(w), `${name} has ${have} of \`${w}\` as a whole word, it had ${want}`);
    }
  }

  const col = files['collector.ts'];
  if (col === undefined) {
    link('link 1', 'collector.ts is not there');
    return bad;
  }

  // the gate, and the links, word for word
  const same = (what: string, have: string | undefined, want: string): void => {
    if (have !== want) link(what, `${have === undefined ? 'missing' : `is now: ${have}`} (it was: ${want})`);
  };
  same('the gate (the body of oneAtATime)', functionBody(col, 'oneAtATime'), EXPECTED_LINKS.gateBody);
  same('the gate (the statement that picks the post)', statementStarting(col, 'const post =', 'createCollector'), EXPECTED_LINKS.pickPost);
  same('link 4 (the body of tick)', functionBody(col, 'tick'), EXPECTED_LINKS.tick);
  same('link 2 (the statement in flushStage that calls the post)', statementStarting(col, 'res = await post(', 'flushStage'), EXPECTED_LINKS.postStatement);
  same('link 3 (the statement in pass that calls flushStage)', statementStarting(col, 'const sendOk = await flushStage(', 'pass'), EXPECTED_LINKS.passCallsFlush);
  same('link 1 (the statement in defaultPost that calls fetch)', statementStarting(col, 'const res = await fetch(', 'defaultPost'), EXPECTED_LINKS.fetchStatement);
  same('link 5 (the one use of the handed timer)', statementStarting(col, 'handle = timer.setInterval(', 'createCollector'), EXPECTED_LINKS.timerStatement);
  const prog = files['program.ts'];
  same('link 6 (the body of startProgram, which hands in no post)', prog === undefined ? undefined : functionBody(prog, 'startProgram'), EXPECTED_LINKS.startProgramBody);
  const main = files['main.ts'];
  same('link 6 (the whole of main.ts)', main === undefined ? undefined : squash(scanSource(main, true)), EXPECTED_LINKS.mainTs);

  // one request per post
  const dpBodySrc = ((): string => {
    const sf = parseSource(col);
    const f = allNodes(sf).find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'defaultPost') as ts.FunctionDeclaration | undefined;
    return f?.body === undefined ? '' : scanSource(f.body.getText(sf).slice(1, -1), false);
  })();
  if (wordCount(dpBodySrc, 'fetch') !== 1) link('link 1', `defaultPost holds ${wordCount(dpBodySrc, 'fetch')} fetch, not exactly 1`);
  for (const w of ['for', 'while', 'do', 'defaultPost']) if (wordCount(dpBodySrc, w) > 0) link('link 1', `defaultPost holds \`${w}\`: a loop or a call of itself`);
  for (const re of [/\.\s*map\s*\(/, /\.\s*forEach\s*\(/, /\bPromise\s*\.\s*(all|race|allSettled|any)\b/]) {
    if (re.test(dpBodySrc)) link('link 1', `defaultPost holds ${re.source}: more than one request could be made`);
  }

  // who may know about the post: the exact imports of every file, as the compiler parses them (an import, a re-export, require( and import( anywhere in a file)
  for (const name of new Set([...Object.keys(files), ...Object.keys(EXPECTED_IMPORTS)])) {
    const src = files[name];
    const facts = src === undefined ? { statements: [], specifiers: [], wholeModule: false } : importFacts(src);
    const want = EXPECTED_IMPORTS[name] ?? [];
    if (JSON.stringify(facts.statements) !== JSON.stringify(want)) link('link 7', `${name} has other imports than it had: ${facts.statements.join(' | ') || 'none'}`);
    if (facts.wholeModule) link('link 7', `${name} takes a whole module (import * as, export *, require)`);
    if ((name === 'outbox.ts' || name === 'files.ts') && facts.specifiers.some((x) => /^\.\/(collector|program)(\.js)?$/.test(x))) link('link 7', `${name} imports collector.ts or program.ts`);
  }

  // no other way out of the PC: the program's files, and the core library's (its code runs on every copy)
  const sending = (label: string, set: Record<string, string>): void => {
    for (const [name, src] of Object.entries(set)) {
      const c = scanSource(src, false);
      const facts = importFacts(src);
      if (facts.specifiers.some((x) => /^(node:)?(http|https|http2|net|tls|dgram|child_process|worker_threads)$/.test(x))) link('link 1', `${label}${name} imports a module that can send (http, https, http2, net, tls, dgram, child_process or worker_threads)`);
      if (/\beval\b/.test(c) || /\bnew\s+Function\b/.test(c) || /\bimport\s*\(/.test(c)) link('link 1', `${label}${name} uses a way to run text: eval, new Function or import( (the other sending globals, WebSocket and the rest, are held by the global-name list)`);
      if (label !== '' && wordCount(c, 'fetch') > 0) link('link 1', `${label}${name} holds fetch: the core library sends nothing`);
    }
  };
  sending('', files);
  sending('sim/core/src/', core);

  // nothing is declared with `declare`, no .d.ts file, no /// <reference line (a declaration with no body makes a global look local to the binder pass)
  const noAmbient = (label: string, set: Record<string, string>): void => {
    for (const [name, src] of Object.entries(set)) {
      const where = `${label}${name}`;
      if (name.endsWith('.d.ts')) link("the bay program's side (declare)", `${where} is a .d.ts file: it declares names that exist only for the type check`);
      for (const u of ambientUses(src)) link("the bay program's side (declare)", `${where} declares ${u} with declare: at run time the name is still the global`);
      if (/^\s*\/\/\/\s*<reference/m.test(src)) link("the bay program's side (declare)", `${where} has a /// <reference line`);
    }
  };
  noAmbient('sim/collector/src/', files);
  noAmbient('sim/core/src/', core);

  // the files are the files, and each source file is a module (a script's top-level names are globals for the others)
  for (const x of fileListViolations('sim/collector/src/', Object.keys(files).sort(), EXPECTED_FILES.collector)) link('link 7', x);
  if (Object.keys(core).length > 0) for (const x of fileListViolations('sim/core/src/', Object.keys(core).sort(), EXPECTED_FILES.core)) link('link 7', x);
  const needModule = (label: string, set: Record<string, string>): void => {
    for (const [name, src] of Object.entries(set)) if (SOURCE_KIND.test(name) && !hasModuleSyntax(src)) link("the bay program's side (modules)", `${label}${name} has no import and no export: it is a script, not a module, and its top-level names would be global names for every other file`);
  };
  needModule('sim/collector/src/', files);
  needModule('sim/core/src/', core);

  // the core library's modules, held the way the program's are (an import, a re-export, require( and import( anywhere in a file)
  if (Object.keys(core).length > 0) {
    for (const name of new Set([...Object.keys(core), ...Object.keys(EXPECTED_CORE_IMPORTS)])) {
      const src = core[name];
      const facts = src === undefined ? { statements: [], specifiers: [], wholeModule: false } : importFacts(src);
      const want = EXPECTED_CORE_IMPORTS[name] ?? [];
      if (JSON.stringify(facts.statements) !== JSON.stringify(want)) link("the bay program's side (modules)", `sim/core/src/${name} has other imports than it had: ${facts.statements.join(' | ') || 'none'}`);
      if (facts.wholeModule) link("the bay program's side (modules)", `sim/core/src/${name} takes a whole module (import * as, export *, require)`);
    }
  }

  // the names every file uses, resolved by the compiler: modules are held above, here the global names and the members of process and import.meta
  if (deep) {
    const combined: Record<string, string> = {};
    for (const [n, t] of Object.entries(files)) combined[`collector/${n}`] = t;
    for (const [n, t] of Object.entries(core)) combined[`core/${n}`] = t;
    const known: Record<string, readonly string[]> = { collector: EXPECTED_SIDE.collectorGlobals, core: EXPECTED_SIDE.coreGlobals };
    for (const [path, f] of Object.entries(sideFacts(combined))) {
      const folder = path.slice(0, path.indexOf('/'));
      const where = `sim/${folder}/src/${path.slice(folder.length + 1)}`;
      for (const g of f.globals) if (!known[folder]!.includes(g)) link("the bay program's side (global names)", `${where} uses the global name \`${g}\`, which is not in the list for sim/${folder}/src`);
      for (const m of f.processMembers) if (!EXPECTED_SIDE.processMembers.includes(m)) link("the bay program's side (process)", `${where} reads process.${m}, which is not in the list (${EXPECTED_SIDE.processMembers.join(', ')})`);
      if (f.processOther > 0) link("the bay program's side (process)", `${where} uses process other than as process.<member> (${f.processOther} time${f.processOther === 1 ? '' : 's'}): passed whole, read with brackets or destructured`);
      for (const m of f.metaMembers) if (!EXPECTED_SIDE.metaMembers.includes(m)) link("the bay program's side (import.meta)", `${where} reads import.meta.${m}, which is not in the list (${EXPECTED_SIDE.metaMembers.join(', ')})`);
      if (f.constructorReads > 0) link("the bay program's side (constructor)", `${where} reads the name constructor (${f.constructorReads} time${f.constructorReads === 1 ? '' : 's'}): a road to running text as code`);
      if (f.metaOther > 0) link("the bay program's side (import.meta)", `${where} uses import.meta other than as import.meta.<member>`);
    }
  }
  return bad;
}


/** Every file under a folder, folders inside it included: path under it (with `/`) to text. */
function readTree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.isDirectory()) Object.assign(out, readTree(dir, `${rel}${e.name}/`));
    else out[`${rel}${e.name}`] = readFileSync(join(dir, rel, e.name), 'utf8');
  }
  return out;
}


test('A13. the places a post can start are pinned: one call of post, one of flushStage, one of pass (inside tick, after the guard), and no other source file starts one', () => {
  const files: Record<string, string> = {};
  for (const name of readdirSync(SRC)) if (name.endsWith('.ts')) files[name] = readFileSync(join(SRC, name), 'utf8');
  assert.ok(Object.keys(files).length >= 5 && 'collector.ts' in files, 'the source files were collected');
  const bad = pinViolations(files);
  assert.deepEqual(bad, [], `${PIN_PURPOSE} Found: ${bad.join('; ')}`);

  // the guard bites: each of these made-up edits must be found, and a comment must not count
  const col = files['collector.ts']!;
  const edits: Array<[string, Record<string, string>]> = [
    ['a second post', { ...files, 'collector.ts': col + "\nasync function more(): Promise<void> { await post('a', 'b'); }\n" }],
    ['a second flush', { ...files, 'collector.ts': col + '\nfunction more(): void { void flushStage(); }\n' }],
    ['a pass outside tick', { ...files, 'collector.ts': col + '\nfunction more(): void { void pass(); }\n' }],
    ['no guard in tick', { ...files, 'collector.ts': col.replace('if (running) return running;', '') }],
    ['a post in another file', { ...files, 'program.ts': files['program.ts'] + "\nvoid post('a', 'b');\n" }],
    ['defaultPost in another file', { ...files, 'program.ts': files['program.ts'] + '\nvoid defaultPost;\n' }],
  ];
  for (const [name, edited] of edits) assert.notDeepEqual(pinViolations(edited), [], `the pin does not see: ${name}`);
  assert.deepEqual(pinViolations({ ...files, 'collector.ts': col + '\n// post( flushStage( pass( in a comment\n/* post( */\n' }), [], 'a comment is not a place');
  // ---- the whole argument (links 1 to 5), over every file under src, folders inside it included ----
  const all = readTree(SRC);
  assert.ok(Object.keys(all).length >= 5 && 'collector.ts' in all, 'the source tree was collected');
  const coreTree = readTree(join(SRC, '..', '..', 'core', 'src'));
  assert.ok(Object.keys(coreTree).length >= 3 && 'parse.ts' in coreTree, 'the core library was collected');
  const startScript = (JSON.parse(readFileSync(join(SRC, '..', '..', '..', 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts?.['sim:collector'];
  assert.deepEqual(startScriptViolations(startScript), [], START_WHY);
  assert.notDeepEqual(startScriptViolations(`${startScript} --import ./x.mjs`), [], 'the pin does not see a preload added to the start script');
  assert.deepEqual(startScriptViolations(undefined).length, 1, 'a missing start script is found');
  // what npm runs around the start script: one assertion each, on the files as they are
  const repoRoot = join(SRC, '..', '..', '..');
  const packageScripts = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  assert.ok(!('presim:collector' in packageScripts) && !('postsim:collector' in packageScripts), 'package.json has a presim:collector or postsim:collector script: npm runs it around the start script (sim:collector), outside everything else this pin reads');
  const npmrcPath = join(repoRoot, '.npmrc');
  const npmrcText = existsSync(npmrcPath) ? readFileSync(npmrcPath, 'utf8') : undefined;
  assert.ok(npmrcText === undefined || !/^\s*node[-_]options\s*=/im.test(npmrcText), 'the repo root has an .npmrc with a node-options line: it applies to every npm script and can preload code before the start script (sim:collector), outside everything else this pin reads');
  assert.deepEqual(npmRunsViolations(packageScripts, npmrcText), [], 'what npm runs around the start script');
  const t0 = Date.now();
  const moved = argumentViolations(all, coreTree, true);
  console.log(`A13 reads the whole of the bay program's side in ${Date.now() - t0} ms`);
  assert.deepEqual(moved, [], `\n${ARGUMENT}\n\nWhat moved:\n  ${moved.join('\n  ')}\n\n${WHAT_TO_DO}`);

  // The guard bites: made-up edits. `edit` fails when its text is not in the file, so an edit can never silently do nothing.
  const edit = (name: string, from: string, to: string, tree: Record<string, string> = all): Record<string, string> => {
    assert.ok(tree[name]!.includes(from), `a made-up edit of this pin no longer applies because its anchor line changed (${name}: ${from.slice(0, 60)}): update the anchor in the pin's table of edits, not the rule`);
    return { ...tree, [name]: tree[name]!.replace(from, () => to) };
  };
  const POSTLINE = 'res = await post(`${base}/v0/shots`, JSON.stringify({ records: batch }));';
  const mustFind: Array<[string, Record<string, string>]> = [
    ['Q2: defaultPost sends a big body as two halves at once', edit('collector.ts', '  const res = await fetch(url, {', '  if (body.length > 1_000_000) {\n    const half = body.length >> 1;\n    void fetch(url, { method: "POST", body: body.slice(0, half) });\n  }\n  const res = await fetch(url, {')],
    ['Q3: a copy that cannot be taken retries by setTimeout(pass, 100)', edit('collector.ts', '      text = files.readCopy();\n    } catch {\n      copyProblem();', '      text = files.readCopy();\n    } catch {\n      setTimeout(pass, 100);\n      copyProblem();')],
    ['Q5: Retry-After honoured by setTimeout(flushStage, s)', edit('collector.ts', '        backoff(res.retryAfterSec);\n        return true;', '        backoff(res.retryAfterSec);\n        setTimeout(flushStage, (res.retryAfterSec ?? 1) * 1000);\n        return true;')],
    ['Q7: a backlog sends a batch ahead through const send = post', edit('collector.ts', '      let res: PostResult;\n', '      const send = post;\n      if (outbox.pending > 600) void send(`${base}/v0/shots`, "{}");\n      let res: PostResult;\n')],
    ['an alias: const p = post; p(...)', edit('collector.ts', '      let res: PostResult;\n', '      const p = post;\n      void p("u", "b");\n      let res: PostResult;\n')],
    ['post?.(', edit('collector.ts', POSTLINE, POSTLINE.replace('post(', 'post?.('))],
    ['post.call(', edit('collector.ts', POSTLINE, POSTLINE.replace('post(', 'post.call(null, '))],
    ['post (', edit('collector.ts', POSTLINE, POSTLINE.replace('post(', 'post ('))],
    ['a line break before the bracket', edit('collector.ts', POSTLINE, POSTLINE.replace('post(', 'post\n('))],
    ['setTimeout(flushStage, 0)', edit('collector.ts', '      if (handle !== undefined) return;', '      setTimeout(flushStage, 0);\n      if (handle !== undefined) return;')],
    ['setTimeout(pass, 0)', edit('collector.ts', '      if (handle !== undefined) return;', '      setTimeout(pass, 0);\n      if (handle !== undefined) return;')],
    ['flushStage.call(', edit('collector.ts', 'const sendOk = await flushStage();', 'const sendOk = await flushStage.call(null);')],
    ['a new file in a folder under src that calls fetch', { ...all, 'net/send.ts': 'export const send = (u: string) => fetch(u);\n' }],
    ['a second fetch in defaultPost', edit('collector.ts', "  const ra = res.headers.get('retry-after');", "  void fetch(url);\n  const ra = res.headers.get('retry-after');")],
    ['Promise.all in defaultPost', edit('collector.ts', "  const ra = res.headers.get('retry-after');", "  await Promise.all([]);\n  const ra = res.headers.get('retry-after');")],
    ['the guard of tick given a second condition', edit('collector.ts', '    if (running) return running;', '    if (running && !stale) return running;')],
    ['running cleared in stop()', edit('collector.ts', '      if (running) await running.catch(() => undefined);', '      running = undefined;\n      if (running) await running.catch(() => undefined);')],
    ['Y4: start() makes a second program with createCollector', edit('collector.ts', '      if (handle !== undefined) return;\n      ensureLoaded();\n      emit();', '      if (handle !== undefined) return;\n      ensureLoaded();\n      if (outbox.pending > 2000) void createCollector({ ...options }).tick().catch(() => undefined);\n      emit();')],
    ['Y6: outbox.ts imports the collector as a namespace and reaches defaultPost by a computed name', (() => {
      const withImport = edit('outbox.ts', "import { createHash } from 'node:crypto';\n", "import { createHash } from 'node:crypto';\nimport * as core from './collector.js';\n");
      return { ...withImport, 'outbox.ts': withImport['outbox.ts']!.replace('  markSent(n: number): void {\n', () => "  markSent(n: number): void {\n    if (n === 137) void (core as any)['default' + 'Post']('http://127.0.0.1:5077/v0/shots', '{}').catch(() => undefined);\n") };
    })()],
    ['an honest new import: one more name from node:path in program.ts', edit('program.ts', "import { dirname, join } from 'node:path';", "import { basename, dirname, join } from 'node:path';")],
    ['outbox.ts imports a name from collector.ts', edit('outbox.ts', "import { createHash } from 'node:crypto';\n", "import { createHash } from 'node:crypto';\nimport { checkHubUrl } from './collector.js';\n")],
    ['a second call of startProgram', edit('program.ts', 'export function startProgram(', 'startProgram({}, { log() {}, error() {}, exit() {} });\nexport function startProgram(')],
    ['the gate removed from the statement that picks the post', edit('collector.ts', 'options.post ?? oneAtATime(defaultPost)', 'options.post ?? defaultPost')],
    ["the gate's flag never set", edit('collector.ts', '    busy = true;\n', '')],
    ['the flag cleared before the answer', edit('collector.ts', '    busy = true;\n    try {', '    busy = true;\n    busy = false;\n    try {')],
    ['a second use of defaultPost on a line with a regular expression holding //', edit('collector.ts', '  const now = options.now ?? Date.now;', '  const now = options.now ?? Date.now;\n  if (/^https?:\\/\\//.test(base)) void defaultPost(base, "");')],
    ['a second use of defaultPost on a line with a regular expression holding a quote', edit('collector.ts', '  const now = options.now ?? Date.now;', '  const now = options.now ?? Date.now;\n  if (/[\'"]/.test(base)) void defaultPost(base, "");')],
    ["options['post'](...)", edit('collector.ts', '      let res: PostResult;\n', '      void (options as any)[\'post\']("u", "b");\n      let res: PostResult;\n')],
    ['startProgram handing in post: defaultPost', edit('program.ts', '      ...overrides,\n', '      post: defaultPost,\n      ...overrides,\n')],
    ['Z4: the not-found callback calls collector.tick()', edit('program.ts', "        if (e === 'not-found') io.log(watchingLine(gsproFile));", "        if (e === 'not-found') {\n          io.log(watchingLine(gsproFile));\n          void collector.tick();\n        }")],
    ['Z6: a second program made through a helper', ((): Record<string, string> => {
      const t1 = edit('program.ts', '    const collector = createCollector({', '    const make = (): Collector => createCollector({');
      return edit('program.ts', '      ...overrides,\n    });\n', '      ...overrides,\n    });\n    const collector = make();\n    if (!existsSync(gsproFile)) make().start();\n', t1);
    })()],
    ['a second statement on the line of an existing import', edit('program.ts', "import { homedir } from 'node:os';", "import { homedir } from 'node:os'; import { request } from 'undici';")],
    ['S1: an escaped spelling of defaultPost, called for a batch of exactly 137', edit('collector.ts', '      const batch = outbox.batch(BATCH_RECORDS);\n', '      const batch = outbox.batch(BATCH_RECORDS);\n      if (batch.length === 137) void d\\u0065faultPost(`${base}/v0/shots`, JSON.stringify({ records: batch })).catch(() => undefined);\n')],
    ['S2: an escaped spelling of fetch, a second request inside defaultPost', edit('collector.ts', "  const res = await fetch(url, {\n    method: 'POST',", "  if (body.length > 6_000_000) void f\\u0065tch(url, { method: 'POST', body: '{}', redirect: 'manual' }).catch(() => undefined);\n  const res = await fetch(url, {\n    method: 'POST',")],
    ['an escaped spelling of oneAtATime in a second use', edit('collector.ts', '      const batch = outbox.batch(BATCH_RECORDS);\n', '      const batch = outbox.batch(BATCH_RECORDS);\n      void \\u006fneAtATime;\n')],
    ['an escaped spelling of post as a bracket name', edit('collector.ts', '      let res: PostResult;\n', "      void (options as any)['po\\u0073t']('u', 'b');\n      let res: PostResult;\n")],
    ['an import of node:http', edit('program.ts', "import { homedir } from 'node:os';", "import { request } from 'node:http';\nimport { homedir } from 'node:os';")],
  ];
  for (const [name, edited] of mustFind) {
    const found = argumentViolations(edited);
    assert.notDeepEqual(found, [], `the pin does not see: ${name}`);
    assert.ok(found.every((x) => /^(link [1-7]|the gate)/.test(x)), 'each finding names the gate or the link that moved');
  }
  const mustNotFind: Array<[string, Record<string, string>]> = [
    ['a comment holding the words', { ...all, 'collector.ts': all['collector.ts'] + '\n// post( flushStage( pass( running defaultPost fetch setTimeout setInterval .then(\n/* post( fetch( */\n' }],
    ['a string holding post(', { ...all, 'collector.ts': all['collector.ts'] + "\nconst note = 'a post(...) and flushStage( in text' + \"pass( fetch\" + `post( ${'x'}`;\n" }],
    ['a change to a message wording', edit('collector.ts', 'For now this program sends only to this PC.', 'For now this program talks only to this PC.')],
    ['a new status word', edit('collector.ts', "export type ServerState = 'unknown' | 'up'", "export type ServerState = 'unknown' | 'paused' | 'up'")],
    ['a regular expression holding // on a line with nothing else of interest', { ...all, 'collector.ts': all['collector.ts'] + '\nconst notALink = /^https?:\\/\\//;\n' }],
    ['the same, with a comment after it on the same line holding defaultPost', { ...all, 'collector.ts': all['collector.ts'] + '\nconst notALinkEither = /^https?:\\/\\//; // defaultPost\n' }],
    ['a new setting read from the environment (in a function of its own: inside startProgram the whole body is pinned, so one there is found, rightly)', { ...all, 'program.ts': all['program.ts'] + '\nexport function extraNote(env: Env): string {\n  return env.SIM_EXTRA_NOTE || \'\';\n}\n' }],
  ];
  for (const [name, edited] of mustNotFind) assert.deepEqual(argumentViolations(edited), [], `the pin sees something it should not: ${name}`);
  // Z1 as the review wrote it: ordinary code in the core library, which runs on every copy, posts a big round file
  const parse = coreTree['parse.ts']!;
  const zAnchor = "  if (typeof text !== 'string') throw new UnknownLayoutError('round file text must be a string');";
  assert.ok(parse.includes(zAnchor), 'a made-up edit of this pin no longer applies because its anchor line changed (parse.ts): update the anchor in the pin\'s table of edits, not the rule');
  const z1 = argumentViolations(all, { ...coreTree, 'parse.ts': parse.replace(zAnchor, () => zAnchor + "\n  if (text.length > 5_000_000) void fetch('http://127.0.0.1:5077/v0/shots', { method: 'POST', body: '{}' }).catch(() => undefined);") });
  assert.notDeepEqual(z1, [], 'the pin does not see: Z1, a fetch in the core library');

  // ---- what the bay program's side uses: each of these is ordinary code, and each must be found (the compiler resolves the names) ----
  const stop = (name: string, from: string, tree: Record<string, string>): void => {
    assert.ok(tree[name]!.includes(from), `a made-up edit of this pin no longer applies because its anchor line changed (${name}: ${from.slice(0, 60)}): update the anchor in the pin's table of edits, not the rule`);
  };
  const inCore = (name: string, from: string, to: string, tree: Record<string, string> = coreTree): Record<string, string> => {
    stop(name, from, tree);
    return { ...tree, [name]: tree[name]!.replace(from, () => to) };
  };
  const TOP = "import { types } from 'node:util';";
  const addTo = (tree: Record<string, string>, name: string, text: string): Record<string, string> => ({ ...tree, [name]: tree[name]! + text });
  const BATCH = '      const batch = outbox.batch(BATCH_RECORDS);\n';
  const PARSE_ANCHOR = "  if (typeof text !== 'string') throw new UnknownLayoutError('round file text must be a string');";
  const TRIGGER = ' if (text.length > 5_000_000)';
  type Case = [string, Record<string, string>, Record<string, string>, string?];
  const side = (name: string, files: Record<string, string>, coreFiles: Record<string, string> = coreTree): Case => [name, files, coreFiles];
  /** A case may name the finding it expects, a phrase of the finding line written for it: "found" then means that finding is among those reported (an edit found only by another rule would not pass). */
  const own = (phrase: string, c: Case): Case => [c[0], c[1], c[2], phrase];
  const mustFindSide: Case[] = [
    own('has other imports than it had', side('V1: core imports undici and posts a big round file', all, inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void request('http://127.0.0.1:5077/v0/shots', { method: 'POST' });`, inCore('parse.ts', TOP, `${TOP}\nimport { request } from 'undici';`)))),
    own('uses process other than as process.<member>', side("V2: collector.ts, after four hours of the program's clock, process.getBuiltinModule('node:http')", edit('collector.ts', BATCH, `${BATCH}      if (now() - 14_400_000 > 0 && outbox.pending > 0) void (process as any).getBuiltinModule('node:http').request('http://127.0.0.1:5077/v0/shots', { method: 'POST' }).end();\n`))),
    own('uses process other than as process.<member>', side("V3: core parseRoundFile, process.getBuiltinModule('node:http')", all, inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void (process as any).getBuiltinModule('node:http').request('http://127.0.0.1:5077/v0/shots', { method: 'POST' }).end();`))),
    own('has other imports than it had', side("V4: core imports createRequire and loads node:http", all, inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void createRequire(import.meta.url)('node:http');`, inCore('parse.ts', TOP, `${TOP}\nimport { createRequire } from 'node:module';`)))),
    own('uses the global name `require`', side("require('node:http') in collector.ts", addTo(all, 'collector.ts', "\nfunction viaRequire(): void {\n  void require('node:http');\n}\n"))),
    own('has other imports than it had', side('a new import of node:module in outbox.ts', edit('outbox.ts', "import { createHash } from 'node:crypto';\n", "import { createHash } from 'node:crypto';\nimport { createRequire } from 'node:module';\n"))),
    own('uses the global name `WebSocket`', side('the global WebSocket used in collector.ts', addTo(all, 'collector.ts', "\nfunction viaSocket(): void {\n  void new WebSocket('ws://127.0.0.1:5077');\n}\n"))),
    own('uses the global name `navigator`', side('navigator.sendBeacon in the core library', all, addTo(coreTree, 'text.ts', "\nexport function beacon(): boolean {\n  return navigator.sendBeacon('http://127.0.0.1:5077', 'x');\n}\n"))),
    own('uses the global name `Worker`', side('new Worker(...) with Worker not imported, in collector.ts', addTo(all, 'collector.ts', "\nfunction viaWorker(): void {\n  void new Worker('x.js');\n}\n"))),
    own('uses the global name `eval`', side('eval in the core library', all, addTo(coreTree, 'text.ts', "\nexport function evaluate(): unknown {\n  return eval('1');\n}\n"))),
    own('uses the global name `Reflect`', side('Reflect.get(...) in collector.ts', addTo(all, 'collector.ts', "\nfunction viaReflect(o: object): unknown {\n  return Reflect.get(o, 'x');\n}\n"))),
    own('uses the global name `globalThis`', side('globalThis.fetch(...) in the core library', all, addTo(coreTree, 'text.ts', "\nexport function viaGlobal(): void {\n  void globalThis.fetch('http://127.0.0.1:5077');\n}\n"))),
    own('uses the global name `globalThis`', side('globalThis[`fetch`] in the core library', all, addTo(coreTree, 'text.ts', '\nexport function viaTemplate(): void {\n  void (globalThis as any)[`fetch`](\'http://127.0.0.1:5077\');\n}\n'))),
    own('uses process other than as process.<member>', side("process.binding('tcp_wrap') in collector.ts", addTo(all, 'collector.ts', "\nfunction viaBinding(): void {\n  void (process as any).binding('tcp_wrap');\n}\n"))),
    own('uses process other than as process.<member>', side('const p = process; (process passed whole) in collector.ts', addTo(all, 'collector.ts', '\nfunction viaWhole(): void {\n  const p = process;\n  void p;\n}\n'))),
    own('uses process other than as process.<member>', side("process['getBuiltinModule']('node:http') in collector.ts", addTo(all, 'collector.ts', "\nfunction viaBrackets(): void {\n  void (process as any)['getBuiltinModule']('node:http');\n}\n"))),
    own('of `fetch` as a whole word', side('a second function with a parameter named fetch, and the global fetch used in another function (found as a second fetch by the existing count; item 2 finds nothing new, because the global fetch is already in the list)', addTo(all, 'collector.ts', "\nfunction shadow(fetch: number): number {\n  return fetch;\n}\nfunction useReal(): void {\n  void fetch('http://127.0.0.1:5077');\n}\n"))),
    own('`post` as a whole word', side('options[`post`] called in collector.ts (a template with no holes in brackets)', addTo(all, 'collector.ts', '\nfunction viaOptions(options: any): void {\n  void options[`post`](\'u\', \'b\');\n}\n'))),
    own('uses the global name `structuredClone`', side('structuredClone used in outbox.ts (a global the program does not use there, and not in its folder\'s list)', addTo(all, 'outbox.ts', '\nfunction copyIt(x: object): object {\n  return structuredClone(x);\n}\n'))),
    own('has other imports than it had', side('a new import of node:crypto in the core library', all, edit('text.ts', 'export ', "import { createHash } from 'node:crypto';\nexport ", coreTree))),
  ];
  // the name constructor: a road to running text as code (Function reached as a property), nothing on the bay program's side reads it
  mustFindSide.push(
    own('reads the name constructor', side('T1b: (() => undefined).constructor(\'return fetch\')() in collector.ts for a batch of 137', edit('collector.ts', BATCH, `${BATCH}      if (batch.length === 137) void ((() => undefined).constructor('return fetch')() as any)(\`\${base}/v0/shots\`, { method: 'POST', body: JSON.stringify({ records: batch }) }).catch(() => undefined);\n`))),
    own('reads the name constructor', side("T2: ({}).constructor.constructor('return fetch')() in the core library, for a file over 5 MB", all, inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void (({}).constructor.constructor('return fetch')() as any)('http://127.0.0.1:5077/v0/shots', { method: 'POST', body: '{}' }).catch(() => undefined);`))),
    own('reads the name constructor', side("process.on.constructor('return fetch') with no fetch in a type", addTo(all, 'collector.ts', "\nfunction viaProcessOn(): unknown {\n  return (process.on as any).constructor('return fetch')();\n}\n"))),
    own('reads the name constructor', side('the destructuring form: const { constructor } = x', addTo(all, 'collector.ts', '\nfunction viaDestructuring(x: object): unknown {\n  const { constructor } = x;\n  return constructor;\n}\n'))),
    own('reads the name constructor', side('the destructuring form with a new name: const { constructor: c } = x', addTo(all, 'collector.ts', '\nfunction viaDestructuringAs(x: object): unknown {\n  const { constructor: c } = x;\n  return c;\n}\n'))),
    own('reads the name constructor', side("Reflect.get(parseRoundFile, 'constructor') in the core library", all, addTo(coreTree, 'parse.ts', "\nexport function viaReflect(): unknown {\n  return Reflect.get(parseRoundFile, 'constructor');\n}\n"))),
    own('reads the name constructor', side("Object.getOwnPropertyDescriptor(p, 'constructor') in the core library", all, addTo(coreTree, 'text.ts', "\nexport function viaDescriptor(p: object): unknown {\n  return Object.getOwnPropertyDescriptor(p, 'constructor');\n}\n"))),
    own('reads the name constructor', side("the bracket form with an escaped spelling: x['constru\\u0063tor']", addTo(all, 'collector.ts', "\nfunction viaBrackets(x: any): unknown {\n  return x['constru\\u0063tor'];\n}\n"))),
    own('reads the name constructor', side('the bracket form with a template with no holes: x[`constructor`]', addTo(all, 'collector.ts', '\nfunction viaTemplate(x: any): unknown {\n  return x[`constructor`];\n}\n'))),
    own('reads the name constructor', side('an escaped property name: x.constru\\u0063tor', addTo(all, 'collector.ts', '\nfunction viaEscapedName(x: any): unknown {\n  return x.constru\\u0063tor;\n}\n'))),
  );
  // declare: a declaration with no body makes a real global look local to the binder pass, so nothing on the bay program's side is declared with it
  const MARK_SENT = '  markSent(n: number): void {\n';
  mustFindSide.push(
    own('with declare:', side('A1b: outbox.ts declares WebSocket and opens one in markSent with over 600 waiting', addTo(edit('outbox.ts', MARK_SENT, `${MARK_SENT}    if (this.waiting.length > 600) void new WebSocket('ws://127.0.0.1:5077/v0/shots');\n`), 'outbox.ts', '\ndeclare const WebSocket: any;\n'))),
    own('with declare:', side('A2b: core parseRoundFile declares WebSocket and opens one for a file over 5 MB', all, addTo(inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void new WebSocket('ws://127.0.0.1:5077/v0/shots');`), 'parse.ts', '\ndeclare const WebSocket: any;\n'))),
    own('with declare:', side("A10: core declares Function and runs text as code: Function('return fetch')()", all, addTo(inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void (Function('return fetch')() as any)('http://127.0.0.1:5077/v0/shots', { method: 'POST', body: '{}' }).catch(() => undefined);`), 'parse.ts', '\ndeclare const Function: any;\n'))),
    own('with declare:', side('declare global { var WebSocket: any } in collector.ts, with a use', addTo(all, 'collector.ts', "\ndeclare global {\n  var WebSocket: any;\n}\nfunction viaGlobalDeclaration(): void {\n  void new WebSocket('ws://127.0.0.1:5077');\n}\n"))),
    own('with declare:', side('declare global { var WebSocket: any } in the core library, with a use', all, addTo(coreTree, 'text.ts', "\ndeclare global {\n  var WebSocket: any;\n}\nexport function viaCoreGlobalDeclaration(): void {\n  void new WebSocket('ws://127.0.0.1:5077');\n}\n"))),
    own('with declare:', side("declare function require(name: string): any, and a call of it, in collector.ts", addTo(all, 'collector.ts', "\ndeclare function require(name: string): any;\nfunction viaDeclaredRequire(): void {\n  void require('node:http');\n}\n"))),
    own('with declare:', side('export declare const WebSocket: any in files.ts, imported and used in outbox.ts', { ...addTo(all, 'files.ts', '\nexport declare const WebSocket: any;\n'), 'outbox.ts': all['outbox.ts']! + "\nimport { WebSocket } from './files.js';\nfunction viaImportedDeclaration(): void {\n  void new WebSocket('ws://127.0.0.1:5077');\n}\n" })),
    own('uses the global name `WebSocket`', side('an interface WebSocket {} beside new WebSocket(...) (a name whose every declaration makes no value at run time)', addTo(all, 'outbox.ts', "\ninterface WebSocket {\n  readonly url: string;\n}\nfunction viaInterface(): void {\n  void new WebSocket('ws://127.0.0.1:5077');\n}\n"))),
    own('is a .d.ts file', side('a new file globals.d.ts in sim/collector/src', { ...all, 'globals.d.ts': 'declare var NotUsed: any;\n' })),
    own('is a .d.ts file', side('a new file globals.d.ts in sim/core/src', all, { ...coreTree, 'globals.d.ts': 'declare var NotUsed: any;\n' })),
    own('has a /// <reference line', side('a /// <reference types="node" /> line in collector.ts', { ...all, 'collector.ts': `/// <reference types="node" />\n${all['collector.ts']!}` })),
  );
  assert.notDeepEqual(startScriptViolations(`${startScript} --import ./x.mjs`), [], 'the start script with --import ./x.mjs added is found');
  const mustNotFindSide: Case[] = [
    side('a new local variable named require, declared and used in one function (a local is not a global)', addTo(all, 'collector.ts', '\nfunction localRequire(): number {\n  const require = 1;\n  return require;\n}\n')),
    side('a new local variable named WebSocket, declared and used in one function', addTo(all, 'collector.ts', '\nfunction localSocket(): number {\n  const WebSocket = 1;\n  return WebSocket;\n}\n')),
    side('a global already in the list used in a new place (JSON.stringify in outbox.ts)', addTo(all, 'outbox.ts', '\nfunction asText(x: object): string {\n  return JSON.stringify(x);\n}\n')),
    side("a class with a constructor declaration added to a source file (a declaration is not a read)", addTo(all, 'outbox.ts', '\nclass Holder {\n  constructor(readonly value: number) {}\n}\nfunction hold(): Holder {\n  return new Holder(1);\n}\n')),
    side('a type alias and an interface used as types only', addTo(all, 'outbox.ts', '\ntype OnlyAlias = number;\ninterface OnlyShape {\n  a: OnlyAlias;\n}\nfunction useShape(x: OnlyShape): number {\n  return x.a;\n}\n')),
    side('the word declare inside a comment and inside a string', addTo(all, 'outbox.ts', "\nconst declareNote = 'declare const WebSocket: any;';\n// declare global { var WebSocket: any }\n")),
    side('a type named in a type position only (WebSocket in a type annotation)', addTo(all, 'outbox.ts', '\ntype OnlyAType = Record<string, WebSocket>;\n')),
  ];
  // round 10: every source file is a module, the files are the files, and a script file cannot make a global look local (the review's B2, C1 and C2)
  const HELPER = 'function helper() {}\n';
  const ENV_VAR = (name: string, type: string): string => `var ${name}: ${type};\n`;
  const coreEnv = (text: string): Record<string, string> => ({ ...coreTree, 'env.ts': text });
  const HTTP_CALL = "('node:http').request('http://127.0.0.1:5077/v0/shots', { method: 'POST' }).end();";
  mustFindSide.push(
    own('uses the global name `Function`', side("B2: core env.ts holds var Function: FunctionConstructor; (a script), parse.ts runs Function('return fetch')()", all, inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void (Function('return fetch')() as any)('http://127.0.0.1:5077/v0/shots', { method: 'POST', body: '{}' }).catch(() => undefined);`, coreEnv(ENV_VAR('Function', 'FunctionConstructor'))))),
    own('reads process.getBuiltinModule', side('C1: collector env.ts holds var process: NodeJS.Process; (a script), outbox.ts runs process.getBuiltinModule(node:http).request', { ...edit('outbox.ts', MARK_SENT, `${MARK_SENT}    if (this.waiting.length > 600) void process.getBuiltinModule${HTTP_CALL}\n`), 'env.ts': ENV_VAR('process', 'NodeJS.Process') })),
    own('reads process.getBuiltinModule', side('C2: core env.ts holds var process: NodeJS.Process; (a script), parse.ts runs process.getBuiltinModule(node:http).request', all, inCore('parse.ts', PARSE_ANCHOR, `${PARSE_ANCHOR}\n ${TRIGGER} void process.getBuiltinModule${HTTP_CALL}`, coreEnv(ENV_VAR('process', 'NodeJS.Process'))))),
    own('has no import and no export', side('a new env.ts in sim/collector/src holding only function helper() {}', { ...all, 'env.ts': HELPER })),
    own('has no import and no export', side('a new env.ts in sim/core/src holding only function helper() {}', all, coreEnv(HELPER))),
    own('is not one of the files this pin holds', side('a file send.mts in sim/collector/src', { ...all, 'send.mts': 'export const go = (u: string): string => u;\n' })),
  );
  mustNotFindSide.push(
    side('a class field written with declare (it makes no name at all)', addTo(all, 'outbox.ts', '\nclass FieldHolder {\n  declare x: number;\n  declare readonly y: string;\n}\nfunction makeHolder(): FieldHolder {\n  return new FieldHolder();\n}\n')),
  );
  // what npm runs around the start script, made up (the text of an .npmrc is handed to the pin; no such file is written anywhere)
  assert.notDeepEqual(npmRunsViolations({ ...packageScripts, 'presim:collector': 'node ./x.mjs' }, undefined), [], 'the pin does not see a presim:collector script');
  assert.notDeepEqual(npmRunsViolations({ ...packageScripts, 'postsim:collector': 'node ./x.mjs' }, undefined), [], 'the pin does not see a postsim:collector script');
  assert.ok(npmRunsViolations(packageScripts, 'node-options=--import ./x.mjs\n').some((x) => x.includes('node-options')), 'the pin does not see an .npmrc with node-options=--import ./x.mjs');
  assert.notDeepEqual(npmRunsViolations(packageScripts, '; a comment\nregistry=https://registry.npmjs.org/\nnode_options = --require ./y.cjs\n'), [], 'the pin does not see node_options (underscore, spaces) among other lines');
  assert.deepEqual(npmRunsViolations(packageScripts, 'registry=https://registry.npmjs.org/\n# node-options=--import ./x.mjs in a comment\n'), [], 'an .npmrc holding only a registry line (and a comment) is not a finding');
  const t1 = Date.now();
  for (const [name, f, c, expected] of mustFindSide) {
    const found = argumentViolations(f, c, true);
    assert.notDeepEqual(found, [], `the pin does not see: ${name}`);
    if (expected !== undefined) assert.ok(found.some((x) => x.includes(expected)), `the pin sees ${name}, but not by the rule written for it (it expects a finding holding: ${expected}); it reports: ${found.map((x) => x.slice(0, 120)).join(' | ')}`);
  }
  for (const [name, f, c] of mustNotFindSide) assert.deepEqual(argumentViolations(f, c, true), [], `the pin sees something it should not: ${name}`);
  console.log(`A13 side edits: ${mustFindSide.length} found, ${mustNotFindSide.length} not found, ${Date.now() - t1} ms`);
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

test('B2 (X3). defaultPost gives up on a hub that never answers, by itself, in about 10 seconds', { timeout: 30_000 }, async () => {
  const s = await standIn(() => undefined); // never answers
  const t0 = Date.now();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    defaultPost(`${s.url}/v0/shots`, '{"records":[]}').then(() => 'answered', (e: unknown) => (e as Error).name),
    new Promise<string>((resolve) => {
      watchdog = setTimeout(() => resolve('still waiting'), 12_000);
    }),
  ]);
  clearTimeout(watchdog); // the watchdog must not outlive the test: a timer left running is reported at the end of the file
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

// ---- A14: the counter reports every time ----

test('A14. an overlap recorded in a test is reported even when closing a stand-in hub throws; the record is emptied by each report', async () => {
  hubs.push({ close: async () => { throw new Error('close failed (made up)'); } } as never);
  overlapLog.push(OVERLAP_MESSAGE);
  await assert.rejects(closeAll(), (e: Error) => e.message.startsWith(OVERLAP_MESSAGE) && e.message.includes('close failed (made up)'));
  assert.equal(overlapLog.length, 0, 'reported once, then emptied');
  hubs.push({ close: async () => { throw new Error('close failed (made up)'); } } as never);
  await assert.rejects(closeAll(), /close failed \(made up\)/); // with no overlap, the close error is the failure
  overlapLog.push(OVERLAP_MESSAGE);
  assert.throws(() => reportOverlaps(), /OVERLAP/); // what a file's `after` hook does for a program left running
  assert.doesNotThrow(() => reportOverlaps());
});
