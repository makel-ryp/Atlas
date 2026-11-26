import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createCollector, defaultPost, oneAtATime, type Collector, type PostFn, type PostResult } from '../src/collector.js';
import { standIns, tempDir, removeTemps, closeAll, synth, sleep, until, manualTimer } from './helpers.js';

afterEach(closeAll);
after(removeTemps);

const GATE_MESSAGE = 'a post is already out; this one was not sent';
const OK: PostResult = { status: 200, body: { added: 0, revised: 0, unchanged: 0, conflicts: 0 } };

/** A stand-in post that answers only when the test lets it. */
function held(): { post: PostFn; calls: number; release(i: number, r?: PostResult): void; fail(i: number, e: Error): void } {
  const waiting: Array<{ resolve: (r: PostResult) => void; reject: (e: Error) => void }> = [];
  const h = {
    calls: 0,
    post: ((): Promise<PostResult> => {
      h.calls++;
      return new Promise<PostResult>((resolve, reject) => waiting.push({ resolve, reject }));
    }) as PostFn,
    release(i: number, r: PostResult = OK): void {
      waiting[i]!.resolve(r);
    },
    fail(i: number, e: Error): void {
      waiting[i]!.reject(e);
    },
  };
  return h;
}

/** What a call ends with: the message of its rejection, 'not refused' when it was answered, or a line saying it had not settled (a gate that waits in line would not settle until the first is answered). */
async function refusal(p: Promise<unknown>): Promise<string> {
  const settled = p.then(
    () => 'not refused',
    (e: unknown) => (e as Error).message,
  );
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => {
    watchdog = setTimeout(() => resolve('did not settle: the call is waiting'), 500);
  });
  try {
    return await Promise.race([settled, late]);
  } finally {
    clearTimeout(watchdog); // no timer outlives the call
  }
}

// ---- B.1 the gate itself, with a held stand-in ----

test('G1. 50 calls made while the first is unanswered: the wrapped post is called once, the other 49 reject at once with the gate\'s message, and after the answer the next call goes through', async () => {
  const h = held();
  const gate = oneAtATime(h.post);
  const first = gate('http://127.0.0.1:1/v0/shots', 'body-first');
  const others = Array.from({ length: 49 }, (_, i) => refusal(gate(`http://127.0.0.1:${2 + i}/v0/shots`, `body-${i}`))); // another body and another address each time
  const results = await Promise.all(others); // they settle without the first being answered
  assert.deepEqual(new Set(results), new Set([GATE_MESSAGE]), 'each refused, with the gate\'s message');
  assert.equal(results.length, 49);
  assert.equal(h.calls, 1, 'the wrapped post was called once');
  assert.ok(!GATE_MESSAGE.includes('ZZTEST') && !/[0-9]{3}/.test(GATE_MESSAGE), 'the message holds nothing from GSPro\'s file');
  h.release(0);
  assert.deepEqual(await first, OK);
  const next = gate('u', 'b');
  assert.equal(h.calls, 2, 'after the answer the next call goes through');
  h.release(1);
  await next;
});

test('G1b. the gate is released by an answer of any status, by a rejection, and by a throw before the wrapped post\'s first await', async () => {
  for (const status of [200, 400, 413, 500, 503, 302]) {
    const h = held();
    const gate = oneAtATime(h.post);
    const p = gate('u', 'b');
    assert.equal(await refusal(gate('u', 'b')), GATE_MESSAGE, `refused while the ${status} is unanswered`);
    h.release(0, { status, body: undefined });
    assert.equal((await p).status, status);
    const again = gate('u', 'b');
    assert.equal(h.calls, 2, `after a ${status} the next call goes through`);
    h.release(1);
    await again;
  }
  const h = held();
  const gate = oneAtATime(h.post);
  const p = gate('u', 'b');
  const settled = p.then(() => 'answered', (e: Error) => e.message);
  h.fail(0, new Error('connection failed (made up)'));
  assert.equal(await settled, 'connection failed (made up)');
  const afterReject = gate('u', 'b');
  assert.equal(h.calls, 2, 'a rejection released the gate');
  h.release(1);
  await afterReject;

  let calls = 0;
  const thrower = oneAtATime((() => {
    calls++;
    throw new Error('thrown before the first await (made up)');
  }) as unknown as PostFn);
  assert.equal(await refusal(thrower('u', 'b')), 'thrown before the first await (made up)');
  assert.equal(await refusal(thrower('u', 'b')), 'thrown before the first await (made up)', 'a throw released the gate: the second call reached the wrapped post and was not refused');
  assert.equal(calls, 2);
});

test('G1c. 2 000 calls one after another, each awaited: none refused', async () => {
  let calls = 0;
  const gate = oneAtATime(async () => {
    calls++;
    return OK;
  });
  for (let i = 0; i < 2000; i++) assert.deepEqual(await gate('u', 'b'), OK);
  assert.equal(calls, 2000);
});

// ---- B.2 through defaultPost and a real loopback socket ----

interface Hub {
  url: string;
  requests: Array<{ res: ServerResponse; req: IncomingMessage; ended: boolean }>;
  open(): number;
}

async function holdingHub(): Promise<Hub> {
  const hub: Hub = {
    url: '',
    requests: [],
    open: () => hub.requests.filter((r) => !r.ended).length,
  };
  const server: Server = createServer((req, res) => {
    const entry = { res, req, ended: false };
    hub.requests.push(entry);
    res.on('close', () => void (entry.ended = true));
    req.resume();
  });
  standIns.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hub.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return hub;
}

function answerWith(entry: Hub['requests'][number], status = 200): void {
  entry.res.writeHead(status, { 'Content-Type': 'application/json' });
  entry.res.end(JSON.stringify({ added: 0, revised: 0, unchanged: 0, conflicts: 0 }));
}

test('G2. through oneAtATime(defaultPost) and a real loopback hub that holds each answer: two calls at once, the hub sees one request and the second rejects; after the answer a third goes through; a connection the hub destroys releases the gate', async () => {
  const hub = await holdingHub();
  const gate = oneAtATime(defaultPost);
  const url = `${hub.url}/v0/shots`;
  const body = '{"records":[]}';
  const first = gate(url, body);
  await until(() => hub.requests.length === 1, 'the hub saw the first request');
  assert.equal(await refusal(gate(url, body)), GATE_MESSAGE, 'the second call rejects');
  await sleep(60);
  assert.equal(hub.requests.length, 1, 'the hub saw one request, not two');
  assert.equal(hub.open(), 1);
  answerWith(hub.requests[0]!);
  assert.equal((await first).status, 200);
  const third = gate(url, body);
  await until(() => hub.requests.length === 2, 'a third call goes through');
  hub.requests[1]!.req.socket.destroy(); // the hub destroys the connection
  assert.notEqual(await refusal(third), GATE_MESSAGE, 'the destroyed connection is a failed post, not a refusal');
  const fourth = gate(url, body);
  await until(() => hub.requests.length === 3, 'the gate was released by the destroyed connection');
  answerWith(hub.requests[2]!);
  assert.equal((await fourth).status, 200);
  assert.equal(hub.open(), 0);
});

// ---- B.3 the default path end to end: no post handed in ----

test('G3. a collector built with no post option, against a loopback hub that holds each answer: its records arrive, the hub never has two requests open, and the status says up', async () => {
  const dir = tempDir();
  const gspro = join(dir, 'currentRound.dat');
  const data = join(dir, 'data');
  mkdirSync(dir, { recursive: true });
  const records = synth(450).map((x) => {
    const y = { ...x, PlayerName: 'ZZTEST-A' };
    delete y.GhostData;
    delete y.activeShot;
    return y;
  });
  writeFileSync(gspro, JSON.stringify(records));
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
        res.end(JSON.stringify({ added: recs.length, revised: 0, unchanged: 0, conflicts: 0 }));
        open--;
      }, 40);
    });
  });
  standIns.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const hubUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const c = createCollector({ gsproFile: gspro, dataDir: data, hubUrl, pollMs: 5 }); // no post: the statement that picks it, as the program runs it
  try {
    c.start();
    await until(() => c.status().sent === 450, 'all 450 sent', 15_000);
    assert.equal(maxOpen, 1, 'the hub never had two requests open');
    assert.deepEqual(seen.map((x) => x.length), [200, 200, 50]);
    assert.deepEqual(seen.flat(), records.map((x) => x.ShotID), 'its records arrived, in order');
    assert.equal(c.status().server, 'up');
    assert.equal(c.status().pending, 0);
  } finally {
    await c.stop();
  }
});

// ---- B.2 the clock: a gate that opens by itself is a second request (g10) ----

/** Waits until `ms` after `t0` on the real clock; the timer is its own and ends when it fires. */
function waitUntil(t0: number, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, t0 + ms - Date.now()));
  });
}

test('G8. a held stand-in post with no give-up, held 10.5 seconds: calls at about 1, 3, 5.5, 7, 8.5, 9.6, 9.99 and 10.2 seconds, each with another body and another address, are each refused with the gate\'s message and never reach the stand-in; after the answer the next call goes through', { timeout: 30_000 }, async () => {
  // No post of the program is out longer than about 10.02 seconds (defaultPost's give-up), so a gate that opens later than
  // this test's last call (10.2 s) cannot let a second request out in a bay; a gate that opens earlier is caught here.
  let reached = 0;
  let answerFirst: ((r: PostResult) => void) | undefined;
  const stub: PostFn = (url, body) => {
    reached++;
    void url;
    void body;
    if (reached > 1) return Promise.resolve(OK);
    return new Promise<PostResult>((resolve) => {
      answerFirst = resolve;
    });
  };
  const gate = oneAtATime(stub);
  const t0 = Date.now();
  const first = gate('http://127.0.0.1:1/v0/shots', 'body-first').then(
    (r) => r,
    (e: unknown) => e,
  );
  assert.equal(reached, 1);
  for (const [i, ms] of [1000, 3000, 5500, 7000, 8500, 9600, 9990, 10_200].entries()) {
    await waitUntil(t0, ms);
    assert.equal(await refusal(gate(`http://127.0.0.1:${2 + i}/v0/shots`, `body-${i}`)), GATE_MESSAGE, `the call at about ${ms / 1000} s is refused`);
    assert.equal(reached, 1, `the call at about ${ms / 1000} s never reached the stand-in`);
  }
  await waitUntil(t0, 10_500);
  answerFirst!(OK);
  assert.deepEqual(await first, OK, 'the first call ended with its answer, 10.5 seconds in');
  assert.deepEqual(await gate('http://127.0.0.1:99/v0/shots', 'body-after'), OK, 'after the answer the next call goes through');
  assert.equal(reached, 2);
});

test('G5. the give-up itself: a hub that never answers its first request; calls at about 9.5 and 9.93 seconds are refused; the first call ends at the 10 second give-up; a call made after that goes through to the hub', { timeout: 30_000 }, async () => {
  const requests: Array<{ arrivedAt: number }> = [];
  const server: Server = createServer((req, res) => {
    const index = requests.push({ arrivedAt: Date.now() }) - 1;
    req.resume();
    if (index === 0) return; // never answered
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ added: 0, revised: 0, unchanged: 0, conflicts: 0 }));
    });
  });
  standIns.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v0/shots`;
  const gate = oneAtATime(defaultPost);
  const t0 = Date.now();
  const first = gate(url, '{"records":[]}').then(
    () => 'answered',
    (e: unknown) => ({ name: (e as Error).name, at: Date.now() - t0 }),
  );
  await until(() => requests.length === 1, 'the hub saw the first request');
  await waitUntil(t0, 9500);
  assert.equal(await refusal(gate(url, '{"records":[],"n":1}')), GATE_MESSAGE, 'a call at about 9.5 seconds is refused');
  assert.equal(requests.length, 1, 'the hub saw one request');
  await waitUntil(t0, 9930);
  assert.equal(await refusal(gate(url, '{"records":[],"n":3}')), GATE_MESSAGE, 'a call at about 9.93 seconds, just before the give-up, is refused (a gate that opens again at 9.9 seconds would send it)');
  assert.equal(requests.length, 1, 'the hub still saw one request');
  const ended = (await first) as { name: string; at: number };
  assert.equal(ended.name, 'TimeoutError', 'the first call ends at the give-up');
  assert.ok(ended.at >= 9_500 && ended.at < 12_000, `it gave up after ${ended.at} ms`);
  assert.equal((await gate(url, '{"records":[],"n":2}')).status, 200, 'a call made after the give-up goes through');
  assert.equal(requests.length, 2);
  assert.ok(requests[1]!.arrivedAt - t0 >= 9_900, 'the second request came after the give-up');
});

// ---- B.3 by a model, with made-up time: every other rule ----

function seededGenerator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
}

/** The gate against its model: a call is let through if and only if no call is out. */
async function modelRun(seed: number, steps: number): Promise<void> {
  const rand = seededGenerator(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  let mode: 'hold' | 'reject' | 'throw' = 'hold';
  let heldCall: { resolve(r: PostResult): void; reject(e: Error): void } | undefined;
  let standOut = 0;
  let maxStandOut = 0;
  let standCalls = 0;
  const stub = ((_url: string, _body: string) => {
    standCalls++;
    standOut++;
    maxStandOut = Math.max(maxStandOut, standOut);
    if (mode === 'throw') {
      standOut--;
      throw new Error('thrown (made up)');
    }
    if (mode === 'reject') {
      standOut--;
      return Promise.reject(new Error('rejected (made up)'));
    }
    return new Promise<PostResult>((resolve, reject) => {
      heldCall = {
        resolve: (r) => {
          standOut--;
          resolve(r);
        },
        reject: (e) => {
          standOut--;
          reject(e);
        },
      };
    });
  }) as PostFn;
  const gate = oneAtATime(stub);
  let out = false; // the model: a call is out
  let step = 0;
  const where = (): string => `seed ${seed}, step ${step}`;
  let outcome: { state: 'pending' | 'ok' | 'refused' | 'failed'; message?: string } = { state: 'ok' };
  for (step = 1; step <= steps; step++) {
    const r = pick(100);
    if (r < 60) {
      mode = (['hold', 'hold', 'reject', 'throw'] as const)[pick(4)]!;
      const before = standCalls;
      const mine: { state: 'pending' | 'ok' | 'refused' | 'failed'; message?: string } = { state: 'pending' };
      gate(`http://127.0.0.1:${1 + pick(9)}/v0/shots`, `body-${seed}-${step}-${pick(1000)}`).then(
        () => void (mine.state = 'ok'),
        (e: Error) => {
          mine.state = e.message === GATE_MESSAGE ? 'refused' : 'failed';
          mine.message = e.message;
        },
      );
      await settleMicrotasks();
      if (out) {
        assert.equal(mine.state, 'refused', `${where()}: a call made while one is out must be refused with the gate's message (got ${mine.state}: ${mine.message})`);
        assert.equal(standCalls, before, `${where()}: a refused call must not reach the wrapped post`);
      } else {
        assert.equal(standCalls, before + 1, `${where()}: a call made while none is out must go through`);
        if (mode === 'hold') {
          assert.equal(mine.state, 'pending', `${where()}: a held call is pending`);
          out = true;
          outcome = mine;
        } else {
          assert.equal(mine.state, 'failed', `${where()}: a rejection or a throw ends the call`);
        }
      }
    } else if (r < 85) {
      if (out) {
        heldCall!.resolve({ status: [200, 400, 413, 500, 503, 302][pick(6)]!, body: undefined });
        await settleMicrotasks();
        assert.equal(outcome.state, 'ok', `${where()}: an answer ends the call`);
        out = false;
      }
    } else if (out) {
      heldCall!.reject(new Error('connection failed (made up)'));
      await settleMicrotasks();
      assert.equal(outcome.state, 'failed', `${where()}: a rejection ends the call`);
      out = false;
    }
    assert.ok(maxStandOut <= 1, `${where()}: the wrapped post had two calls out at once`);
  }
}

test('G6. the gate against a model with made-up time: 6 seeds of 4 000 steps (a call, an answer, a rejection or a throw, with another body and address each time): a call is let through if and only if no call is out, a refused call never reaches the wrapped post, never two out', { timeout: 60_000 }, async () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) await modelRun(seed, 4000);
});

// ---- B.4 the statement, by a run: a callback that calls tick() before tick has stored its running pass (gate-1) ----

test('G7. a collector built with no post option, whose onEvent calls tick() again while the pass that raised it is still starting (round 6\'s Z4 through the public interface): the hub never has two requests open and every record arrives once', async () => {
  const dir = tempDir();
  const gspro = join(dir, 'currentRound.dat');
  mkdirSync(dir, { recursive: true });
  const records = synth(10).map((x) => {
    const y = { ...x, PlayerName: 'ZZTEST-A' };
    delete y.GhostData;
    delete y.activeShot;
    return y;
  });
  writeFileSync(gspro, JSON.stringify(records));
  let open = 0;
  let maxOpen = 0;
  let requests = 0;
  const arrived: string[] = [];
  const server: Server = createServer((req, res) => {
    open++;
    maxOpen = Math.max(maxOpen, open);
    const index = requests++;
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      const recs = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { records: Array<{ ShotID: string }> }).records;
      setTimeout(
        () => {
          if (index === 0) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end('{}');
          } else {
            arrived.push(...recs.map((x) => x.ShotID));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ added: recs.length, revised: 0, unchanged: 0, conflicts: 0 }));
          }
          open--;
        },
        index === 0 ? 5 : 150,
      );
    });
  });
  standIns.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const hubUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let clock = 1_000_000;
  const timer = manualTimer();
  let collector: Collector | undefined;
  collector = createCollector({
    gsproFile: gspro,
    dataDir: join(dir, 'data'),
    hubUrl,
    now: () => clock,
    timer,
    onEvent: (e) => {
      if (e === 'not-found') void collector!.tick(); // before the pass that raised this has stored its running pass
    },
  }); // no post option: the statement that picks the sender, as the program runs it
  try {
    collector.start();
    timer.fire();
    await until(() => requests === 1, 'the first request (answered 500)');
    await until(() => collector!.status().retryDelayMs > 0, 'the wait after the 500');
    assert.equal(collector.status().pending, 10);
    rmSync(gspro); // the round file is gone
    clock += 31_000; // for more than 30 seconds of the program's clock, with records waiting
    timer.fire();
    await until(() => collector!.status().sent === 10, 'all ten sent', 15_000);
    assert.equal(maxOpen, 1, 'the hub never had two requests open');
    assert.equal(requests, 2, 'one failed request and one that went through');
    assert.deepEqual([...arrived].sort(), records.map((x) => x.ShotID).sort(), 'every record arrived once');
  } finally {
    await collector.stop();
  }
});
