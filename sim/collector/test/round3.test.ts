import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync, existsSync, readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createCollector, defaultPost, checkHubUrl, statusLine, type Collector, type PostFn, type PostResult } from '../src/collector.js';
import { createFiles, type Files } from '../src/files.js';
import {
  SRC, counted, standIns, tempDir, removeTemps, startHub, closeAll, rounds, assertKnownAnswer, rig, rigs, sumAnswers, spyFiles, standIn, synth, sleep, until, manualTimer, heldPost,
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
  write(text: string): void {
    this.src = text;
    this.version++;
  }
  statSource(): { size: number; mtimeMs: number } | undefined {
    return this.src === undefined ? undefined : { size: Buffer.byteLength(this.src), mtimeMs: this.version };
  }
  copySource(): void {
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
}

interface DriveCall {
  records: Array<Record<string, any>>;
  ended: boolean;
  resolve(r: PostResult): void;
  reject(e: Error): void;
}

async function driveOne(seed: number, steps: number, tally: Tally): Promise<void> {
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
  const c = createCollector({ gsproFile: 'unused', dataDir: 'unused', hubUrl: 'http://127.0.0.1:1', files: mem, post, now: () => clock, timer, tidyOverBytes: Number.MAX_SAFE_INTEGER }); // no tidy-up: an empty read followed by a tidy-up forgets what was sent (a known minor of round 2), which would show as a record dealt with twice
  mem.onEmptyCopy = () => {
    if (c.status().pending > 0) tally.emptyReadWhileWaiting++;
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

  const newRecord = (): Record<string, any> => ({ ...base, ShotID: `D${seed}-${nextId}`, Hole: nextId++ % 18, HoleShot: ++version });
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
      const e = pick(100);
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
          records[i] = { ...records[i]!, HoleShot: ++version };
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
      } else {
        what = 'stop() not awaited, then start()';
        if (out()) tally.stopStartWhilePostOut++;
        stops.push(c.stop());
        c.start();
      }
      await turns(1);
      check();
    }
    tally.steps += steps;

    // The end: answer everything with 200, let the handler run until nothing waits.
    what = 'the end of the run';
    step = steps + 1;
    for (let i = 0; i < 600; i++) {
      const call = out();
      if (call) await answer(call, 0);
      if (lastFull !== undefined && i === 0) mem.write(JSON.stringify(lastFull));
      clock += 31_000;
      for (let k = 0; k < 3; k++) timer.fire();
      await turns(2);
      check();
      if (c.status().pending === 0 && !out()) break;
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
        assert.ok(x.HoleShot > before, `shot ${x.ShotID}: version ${x.HoleShot} dealt with after version ${before} (outbox order broken)`);
        lastVersion.set(x.ShotID, x.HoleShot);
      }
    }
    const okCount = okBatches.reduce((s, b) => s + b.length, 0);
    const refusedCount = refusedBatches.reduce((s, b) => s + b.length, 0);
    for (const [k, n] of done) assert.equal(n, 1, `a record version was dealt with ${n} times: ${k.slice(0, 80)}`);
    for (const x of lastFull ?? []) assert.ok(done.has(key(x)), `a record of the last full copy is neither sent nor refused: ${x.ShotID}`);
    assert.equal(c.status().sent, okCount, 'sent is the records answered with a 200, no more');
    assert.equal(c.status().refused, refusedCount, 'refused is the records answered with a 400 or 413');
    const postedTotal = calls.reduce((s, x) => s + x.records.length, 0);
    assert.equal(postedTotal, okCount + refusedCount + failedSize, 'the sizes posted add up');
    assert.ok(calls.every((x) => x.records.length <= 200), 'no batch over 200');
    tally.posts += calls.length;
    tally.seeds++;
  } catch (e) {
    throw new Error(`A12 failed at seed ${seed}, step ${step} (${what}): ${(e as Error).message}. Run it again alone with A12_SEED=${seed}`, { cause: e });
  } finally {
    auto = true;
    for (const call of calls) call.resolve({ status: 200, body: { added: call.records.length, revised: 0, unchanged: 0, conflicts: 0 } });
    await c.stop();
  }
}

test('A12. a seeded random drive: 300 seeds of 80 steps (copies, changes, empty and cut-off files, handler firings, clock, every kind of answer, stop and start): after every step at most one post unanswered; at the end everything is sent or refused, once', { timeout: 120_000 }, async () => {
  const only = process.env.A12_SEED;
  const seeds = only !== undefined ? [Number(only)] : Array.from({ length: 300 }, (_, i) => i + 1);
  const tally: Tally = { seeds: 0, steps: 0, posts: 0, refusedWithMoreWaiting: 0, emptyReadWhileWaiting: 0, newCopyWhilePostOut: 0, stopStartWhilePostOut: 0, firedInsideWait: 0 };
  const t0 = Date.now();
  for (const seed of seeds) await driveOne(seed, 80, tally);
  console.log(`A12 tally over ${tally.seeds} seeds in ${Date.now() - t0} ms: ${JSON.stringify(tally)}`);
  if (only === undefined) {
    assert.equal(tally.seeds, 300);
    assert.ok(tally.steps >= 300 * 60);
    for (const k of ['refusedWithMoreWaiting', 'emptyReadWhileWaiting', 'newCopyWhilePostOut', 'stopStartWhilePostOut', 'firedInsideWait'] as const) {
      assert.ok(tally[k] > 0, `the drive never reached: ${k}`);
    }
  }
});

// ---- A13: the places a post can start are pinned ----

/** The text without comments. Strings and template texts are kept whole, so a `//` inside one is not a comment. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | undefined;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (quote !== undefined) {
      out += ch;
      if (ch === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const PIN_PURPOSE =
  'A second place that starts a post is how two posts end up in flight, and the hub keeps the one that finished last. Whoever adds such a place on purpose must also show that the rule "one post in flight" still holds (and change this pin with that proof).';

function countOf(re: RegExp, text: string): number {
  return (text.match(re) ?? []).length;
}

/** What is wrong with the places a post, a flush or a pass can start, in the program's source files (name to text). */
function pinViolations(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const col = stripComments(files['collector.ts'] ?? '');
  const posts = countOf(/\bpost\(/g, col);
  if (posts !== 1) bad.push(`post( is called in ${posts} places in collector.ts, not exactly 1`);
  const flushes = countOf(/\bflushStage\(/g, col) - countOf(/function flushStage\(/g, col);
  if (flushes !== 1) bad.push(`flushStage( is called in ${flushes} places in collector.ts (besides its definition), not exactly 1`);
  const passes = countOf(/\bpass\(/g, col) - countOf(/function pass\(/g, col);
  if (passes !== 1) bad.push(`pass( is called in ${passes} places in collector.ts (besides its definition), not exactly 1`);
  const at = col.indexOf('function tick(');
  if (at < 0) {
    bad.push('collector.ts has no function tick');
  } else {
    const open = col.indexOf('{', col.indexOf(')', at));
    let depth = 0;
    let end = open;
    for (; end < col.length; end++) {
      if (col[end] === '{') depth++;
      if (col[end] === '}' && --depth === 0) break;
    }
    const body = col.slice(open + 1, end).replace(/\s+/g, ' ').trim();
    if (countOf(/\bpass\(/g, body) !== 1) bad.push('the call of pass( is not inside tick');
    if (!body.startsWith('if (running) return running;')) bad.push('the first statement of tick is not the guard that returns the running pass');
  }
  const handed = countOf(/\bdefaultPost\b/g, col);
  if (handed !== 2 || !/post = options\.post \?\? defaultPost;/.test(col)) bad.push('defaultPost is used in collector.ts other than as the default handed to the program');
  for (const [name, text] of Object.entries(files)) {
    if (name === 'collector.ts') continue;
    const code = stripComments(text);
    for (const word of ['post(', 'flushStage(', 'pass(']) {
      if (new RegExp(`\\b${word.replace('(', '\\(')}`).test(code)) bad.push(`${name} calls ${word}`);
    }
    if (/\bdefaultPost\b/.test(code)) bad.push(`${name} uses defaultPost`);
  }
  return bad;
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
