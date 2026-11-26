import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createCollector, defaultPost, oneAtATime, type PostFn, type PostResult } from '../src/collector.js';
import { standIns, tempDir, removeTemps, closeAll, synth, sleep, until } from './helpers.js';

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
  const first = gate('u', 'b');
  const others = Array.from({ length: 49 }, () => refusal(gate('u', 'b')));
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
