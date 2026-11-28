// What the gate's tests hold, and what they do not (rounds 10 to 12).
// They hold: a flag that is not set, or is released early or late; a gate that waits in line instead of refusing; and a rule that
// depends on the body (its content or its size, up to the 7 MB of a bay's largest batch), on the address, on a count of calls or of
// refusals, on a timer of the gate's own, on the wall clock at any horizon (the hour of the day, the day of the month, the weekday,
// the first second of a minute, a clock set back, the offset of the time zone and a change of the clocks), or on a count and a time
// together (for example "after 12 refusals and 2 s").
// The time zone is the test's own: G9 and G10 set process.env.TZ themselves (New York, Lord Howe, Kolkata, UTC, Berlin, Chatham) and
// put it back, so the result and the printed coverage do not depend on the PC that runs them.
// G9 shows the plain cases (a mocked clock stepped through every hour of 32 days, from the real date and from two fixed instants
// whose 32 days cross a change of the clocks and the 29th to 31st of a month, each second of a minute, back by an hour and by a day,
// with 300 quick calls first and a 7 MB body); G10 is the seeded model with a clock, counts and sizes together and asserts what it
// met while a call was out; G6 is the same model with no clock; G8 and G5 run on real time inside the first 10 s.
// The reach of a count, in numbers: one gate of G10 meets up to about 19 000 calls and about 19 000 refusals in its life (the long seed
// is asserted to meet its 10 000th refusal and its 16 384th call), and a hold sees up to about 950 refusals in G10 and about 2 500 in
// G9. A rule on a count beyond that (the 20 000th call, more than about 2 500 refusals in one hold) is not met.
// They do not hold: a gate that reads a clock the test cannot turn (for example performance.now() or process.uptime() past G8's
// last call), or one that waits for a magic value (for example one particular body), or a count beyond the reach above. Those are
// held by the pin's word-for-word text of the gate (A13 in round3.test.ts), which is what holds a twelve-line function in the end.
import { test, afterEach, after, mock } from 'node:test';
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
  // G8 covers rules that open on real time inside the first 10 seconds or so, by any clock (including one the test cannot turn).
  // What happens later, or when the thread is held, is G9's: it turns a mocked clock on by days.
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
  let openSockets = 0;
  server.on('connection', (sock) => {
    openSockets++;
    sock.on('close', () => void openSockets--);
  });
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
  // Leave nothing behind (round 13): the given-up request has settled (awaited above); now close the hub's open connections, wait for them to be closed,
  // and let the client side see it, so that nothing of the aborted request or of the kept-alive connection runs after the test has ended.
  server.closeAllConnections();
  await until(() => openSockets === 0, 'the connections of the stand-in hub are closed', 2000);
  await sleep(50);
});

// ---- B.2b the clock, by a clock the test turns (rounds 10 and 11): a held thread stretches every real deadline, so no real-time test bounds a time-based gate ----

/** Lets the pending microtasks run; setImmediate is not mocked in G9 and G10, so it is a real turn of the loop. */
async function turn(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

/** What a call ends with, without a timer of its own (the clock is mocked): the message of its rejection, 'not refused' when answered, or 'did not settle' after one real turn of the loop. */
async function refusalNoTimer(p: Promise<unknown>): Promise<string> {
  const settled = p.then(
    () => 'not refused',
    (e: unknown) => (e as Error).message,
  );
  const late = turn().then(() => 'did not settle: the call is waiting');
  return Promise.race([settled, late]);
}

const STEPS_MS = [1000, 5000, 9970, 10_300, 11_000, 60_000, 600_000, 3_600_000, 86_400_000, 30 * 86_400_000];
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The body of a bay's largest batch (200 full records): about 7 MB. Built once; every call adds its own few characters in front, so no two bodies are the same. */
const BIG_BODY = 'x'.repeat(7_000_000);

/** The time zone a test sets for itself, and puts back (or removes, when there was none) in its `finally`. A running Node process honours a change of `process.env.TZ`; the runner gives each test file its own process and the tests of a file run one after another, so no other test or file sees it. */
function setZone(zone: string): () => void {
  const was = process.env.TZ;
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone; // the zone's name as it is now, kept so that it can be put back
  process.env.TZ = zone;
  return () => {
    if (was === undefined) {
      // Node does not go back to the PC's zone when the variable is only deleted: set it to the name kept above, then delete it (checked: the offsets are the PC's again)
      process.env.TZ = resolved;
      delete process.env.TZ;
    } else {
      process.env.TZ = was;
    }
  };
}
/** What the zone was before any test of this file ran: the variable, and the offsets of a January and a July instant (the last test of the file checks them again). */
const ZONE_AT_LOAD = { tz: process.env.TZ, offsets: [Date.UTC(2026, 0, 15), Date.UTC(2026, 6, 15)].map((t) => new Date(t).getTimezoneOffset()) };
const offsetNow = (): number => new Date(Date.now()).getTimezoneOffset();

/** G9's plain cases are run from the real date (as in round 10) and from fixed instants, in zones that change their clocks. Each fixed instant is chosen so that its 32 days cross a change of the clocks and contain the 29th, 30th and 31st of a month: 28 October 2026 (the 29th to 31st of October; the clocks of New York go back on 1 November) and 28 March 2026 (the 29th to 31st of March; the clocks of Lord Howe, which change by half an hour, go back on 5 April). */
const G9_SCENARIOS: Array<{ zone: string; start: number | undefined; crossesChange: boolean }> = [
  { zone: 'America/New_York', start: undefined, crossesChange: false },
  { zone: 'America/New_York', start: Date.UTC(2026, 9, 28), crossesChange: true },
  { zone: 'Australia/Lord_Howe', start: Date.UTC(2026, 2, 28), crossesChange: true },
];

test('G9. a clock the test turns, in a zone the test sets (New York and Lord Howe, which change their clocks; from the real date and from two fixed instants whose 32 days cross a change of the clocks and the 29th to 31st of a month): a few hundred quick calls (one with a 7 MB body), then one call is held while the clock is stepped through ten steps up to 30 days, through every hour of 32 days, through each second of a whole minute, and back by an hour and by a day; at every step calls with another body and address (one with a 7 MB body) are refused with the gate\'s message and never reach the stand-in; when the held call is answered, and again when it is rejected, the next call goes through', { timeout: 30_000 }, async () => {
  const realNow = Date.now();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: realNow }); // the mocked Date starts at the real wall clock, so a rule about a calendar date is reached by the steps too
  let putZoneBack: (() => void) | undefined;
  try {
    for (const sc of G9_SCENARIOS) {
      putZoneBack?.();
      putZoneBack = setZone(sc.zone);
      const offsetsSeen = new Set<number>();
    for (const ending of ['answered', 'rejected'] as const) {
      mock.timers.setTime(sc.start ?? realNow); // both endings start from the same instant
      let reached = 0;
      let heldCall: { resolve: (r: PostResult) => void; reject: (e: Error) => void } | undefined;
      let holdNext = false;
      const stub: PostFn = () => {
        reached++;
        return new Promise<PostResult>((resolve, reject) => {
          if (holdNext) {
            heldCall = { resolve, reject };
            return;
          }
          setTimeout(() => resolve(OK), 3); // a quick call: answered after 3 ms of the mocked clock
        });
      };
      const gate = oneAtATime(stub);
      let refused = 0;
      const mustRefuse = async (label: string, body: string): Promise<void> => {
        const before = reached;
        assert.equal(await refusalNoTimer(gate(`http://127.0.0.1:${2 + ((refused * 1237) % 65_000)}/v0/shots${'/x'.repeat(refused % 40)}`, body)), GATE_MESSAGE, `${ending}: ${label}: the call is refused`);
        assert.equal(reached, before, `${ending}: ${label}: the call never reached the stand-in`);
        refused++;
      };
      // a few hundred quick calls first (one of them with a 7 MB body), each answered 3 mocked ms after it was made, so a rule that measures or counts earlier calls has something to measure and count
      const QUICK = 300;
      for (let i = 0; i < QUICK; i++) {
        const quick = gate(`http://127.0.0.1:${100 + (i % 9)}/v0/shots`, i === 7 ? `quick-${i}${BIG_BODY}` : `quick-${i}`);
        mock.timers.tick(3);
        assert.deepEqual(await quick, OK, `quick call ${i} was answered`);
        mock.timers.tick(7);
      }
      assert.equal(reached, QUICK);
      // then one call that is held
      holdNext = true;
      const first = gate('http://127.0.0.1:1/v0/shots', 'body-held').then(
        (r) => r,
        (e: unknown) => e,
      );
      assert.equal(reached, QUICK + 1, 'the held call reached the stand-in');
      // the ten steps up to 30 days
      let at = 0;
      for (const [i, ms] of STEPS_MS.entries()) {
        mock.timers.tick(ms - at);
        at = ms;
        await turn();
        await mustRefuse(`after ${ms / 1000} s of the mocked clock`, `body-${i}`);
      }
      // the 7 MB body, refused
      await mustRefuse('a 7 MB body', `big-${BIG_BODY}`);
      // the clock is set back 30 days to where it started (a clock correction), then every hour of 32 days from there, at least three refused calls at each step
      mock.timers.setTime(sc.start ?? realNow);
      await mustRefuse('after the clock was set back to its start', 'back-start');
      for (let h = 0; h < 32 * 24; h++) {
        mock.timers.tick(HOUR_MS);
        await turn();
        offsetsSeen.add(offsetNow());
        for (let k = 0; k < 3; k++) await mustRefuse(`hour step ${h}, call ${k}`, `hour-${h}-${k}`);
      }
      // each second of one whole minute: first to the start of a minute, then 61 steps of one second (the first second of a minute among them)
      mock.timers.tick(60_000 - (Date.now() % 60_000));
      await turn();
      assert.equal(Date.now() % 60_000, 0, 'the clock is at the start of a minute');
      for (let sec = 0; sec <= 60; sec++) {
        for (let k = 0; k < 3; k++) await mustRefuse(`second ${sec} of a minute, call ${k}`, `second-${sec}-${k}`);
        mock.timers.tick(1000);
        await turn();
      }
      // the clock set back, once by an hour and once by a day (a clock correction)
      mock.timers.setTime(Date.now() - HOUR_MS);
      for (let k = 0; k < 3; k++) await mustRefuse(`after the clock was set back by an hour, call ${k}`, `back-hour-${k}`);
      mock.timers.setTime(Date.now() - DAY_MS);
      for (let k = 0; k < 3; k++) await mustRefuse(`after the clock was set back by a day, call ${k}`, `back-day-${k}`);
      mock.timers.tick(HOUR_MS);
      await mustRefuse('and forward again', 'back-forward');
      holdNext = false;
      if (ending === 'answered') {
        heldCall!.resolve(OK);
        assert.deepEqual(await first, OK, 'the held call ended with its answer');
      } else {
        heldCall!.reject(new Error('ZZTEST-A held call failed'));
        const e = await first;
        assert.equal((e as Error).message, 'ZZTEST-A held call failed', 'the held call ended with its rejection');
      }
      const next = gate('http://127.0.0.1:99/v0/shots', 'body-after');
      assert.equal(reached, QUICK + 2, `${ending}: the next call goes through`);
      mock.timers.tick(3);
      assert.deepEqual(await next, OK, `${ending}: the next call was answered`);
    }
      if (sc.crossesChange) assert.ok(offsetsSeen.size >= 2, `${sc.zone} from ${new Date(sc.start!).toISOString()}: the 32 days cross a change of the clocks (offsets seen: ${[...offsetsSeen].join(', ')})`);
    }
  } finally {
    putZoneBack?.();
    mock.timers.reset(); // the real clock comes back whatever the test did
  }
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

// ---- B.3b the model with a clock, counts and body sizes together (round 11) ----

/**
 * The gate against its model, under the mocked clock: the same checks as modelRun (a call goes through if and only if none is out; a refused
 * call has the gate's message and never reaches the stand-in; never two out), with time, counts and body sizes together, because a wrong rule a
 * person would write ("after N refusals and T seconds assume the flag is stuck") lives where they meet.
 *
 * The steps: a call (a body of a random size: mostly a few bytes to 200, some of about 1 kB, 100 kB, 1 MB and 7 MB; an address of a random host, port and length);
 * an answer; a rejection; a throw (the stand-in's mode when a call is made with none out); a move of the clock forward by an amount drawn evenly
 * across the scales from 1 ms to 40 days; and now and then a move of the clock backward (set back by up to two days). A call that goes out is held
 * for a number of steps drawn evenly across the scales from 1 to 1 500, so many holds see hundreds of calls and dozens of clock moves before the call
 * that is out is settled. `cover` counts what was met while a call was out, and G10 asserts the counts afterwards.
 */
interface Coverage {
  refusals: number;
  hourLocal: number[];
  hourUtc: number[];
  dayOfMonth: number[];
  weekday: number[];
  firstSecondOfMinute: number;
  oddMinute: number;
  sizeClass: number[];
  refusedAfter12CallsAnd2s: number;
  refusedAfter40CallsAnd60s: number;
  refusedAfter300CallsAnd1h: number;
  backwardMovesWhileOut: number;
  forwardMovesWhileOut: number;
  maxRefusalsInOneHold: number;
  maxMovesInOneHold: number;
  longestHoldMs: number;
  settledAfterDays: number;
  offsetChangesWhileOut: number;
  hourChangesWhileOut: number;
  halfHourChangesWhileOut: number;
  repeatedLocalHourRefusals: number;
  skippedLocalHourRefusals: number;
  mostCallsInOneGate: number;
  mostRefusalsInOneGate: number;
}

const SIZE_NAMES = ['a few bytes', 'about 1 kB', 'about 100 kB', 'about 1 MB', 'about 7 MB'];
const SIZE_BASES = [0, 1000, 100_000, 1_000_000, 7_000_000].map((n) => (n === 7_000_000 ? BIG_BODY : n === 0 ? '' : 'y'.repeat(n)));

function newCoverage(): Coverage {
  return {
    refusals: 0,
    hourLocal: new Array<number>(24).fill(0),
    hourUtc: new Array<number>(24).fill(0),
    dayOfMonth: new Array<number>(32).fill(0),
    weekday: new Array<number>(7).fill(0),
    firstSecondOfMinute: 0,
    oddMinute: 0,
    sizeClass: new Array<number>(5).fill(0),
    refusedAfter12CallsAnd2s: 0,
    refusedAfter40CallsAnd60s: 0,
    refusedAfter300CallsAnd1h: 0,
    backwardMovesWhileOut: 0,
    forwardMovesWhileOut: 0,
    maxRefusalsInOneHold: 0,
    maxMovesInOneHold: 0,
    longestHoldMs: 0,
    settledAfterDays: 0,
    offsetChangesWhileOut: 0,
    hourChangesWhileOut: 0,
    halfHourChangesWhileOut: 0,
    repeatedLocalHourRefusals: 0,
    skippedLocalHourRefusals: 0,
    mostCallsInOneGate: 0,
    mostRefusalsInOneGate: 0,
  };
}

/** The next instant after `from` at which the zone's offset changes (within 400 days), to the second; undefined in a zone that never changes. */
function nextOffsetChange(from: number): number | undefined {
  const o = new Date(from).getTimezoneOffset();
  for (let d = 1; d <= 400; d++) {
    const t = from + d * DAY_MS;
    if (new Date(t).getTimezoneOffset() !== o) {
      let a = t - DAY_MS;
      let b = t;
      while (b - a > 1000) {
        const m = Math.floor((a + b) / 2);
        if (new Date(m).getTimezoneOffset() === o) a = m;
        else b = m;
      }
      return b;
    }
  }
  return undefined;
}

async function timeModelRun(seed: number, steps: number, cover: Coverage): Promise<{ calls: number; refusals: number }> {
  const rand = seededGenerator(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const scale = (lo: number, hi: number): number => Math.floor(Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)))); // evenly across the scales
  mock.timers.setTime(Date.UTC(2026, 0, 1) + pick(2 * 365) * DAY_MS + pick(DAY_MS));
  let lastOffset = offsetNow();
  let refusedInLife = 0;
  let mode: 'hold' | 'now' | 'reject' | 'throw' = 'hold';
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
    if (mode === 'now') {
      standOut--;
      return Promise.resolve(OK);
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
  // the hold that is out now
  let holdSteps = 0;
  let stepsOut = 0;
  let callsInHold = 0;
  let movesInHold = 0;
  let outSince = 0;
  let callsInAll = 0;
  const settle = async (how: 'answer' | 'reject'): Promise<void> => {
    if (how === 'answer') {
      heldCall!.resolve({ status: [200, 400, 413, 500, 503, 302][pick(6)]!, body: undefined });
      await settleMicrotasks();
      assert.equal(outcome.state, 'ok', `${where()}: an answer ends the call`);
    } else {
      heldCall!.reject(new Error('connection failed (made up)'));
      await settleMicrotasks();
      assert.equal(outcome.state, 'failed', `${where()}: a rejection ends the call`);
    }
    cover.maxRefusalsInOneHold = Math.max(cover.maxRefusalsInOneHold, callsInHold);
    cover.maxMovesInOneHold = Math.max(cover.maxMovesInOneHold, movesInHold);
    cover.longestHoldMs = Math.max(cover.longestHoldMs, Date.now() - outSince);
    if (Date.now() - outSince > DAY_MS) cover.settledAfterDays++;
    out = false;
  };
  for (step = 1; step <= steps; step++) {
    const r = rand();
    if (out) stepsOut++;
    if (out && stepsOut >= holdSteps) {
      await settle(rand() < 0.7 ? 'answer' : 'reject');
    } else if (r < (out ? 0.66 : 0.6)) {
      mode = (['hold', 'hold', 'hold', 'hold', 'hold', 'now', 'now', 'now', 'reject', 'reject', 'throw'] as const)[pick(11)]!;
      const sizeClass = rand() < 0.75 ? 0 : 1 + pick(4);
      const body = `body-${seed}-${step}-${pick(1000)}` + (sizeClass === 0 ? 'z'.repeat(pick(200)) : SIZE_BASES[sizeClass]!);
      const before = standCalls;
      const mine: { state: 'pending' | 'ok' | 'refused' | 'failed'; message?: string } = { state: 'pending' };
      gate(`http://${['127.0.0.1', 'localhost', '[::1]'][pick(3)]}:${1 + pick(65_535)}/v0/${['shots', 'shots', 'rounds'][pick(3)]}${'/x'.repeat(pick(30))}`, body).then(
        () => void (mine.state = 'ok'),
        (e: Error) => {
          mine.state = e.message === GATE_MESSAGE ? 'refused' : 'failed';
          mine.message = e.message;
        },
      );
      await settleMicrotasks();
      callsInAll++;
      if (out) {
        assert.equal(mine.state, 'refused', `${where()}: a call made while one is out must be refused with the gate's message (got ${mine.state}: ${mine.message}; body ${SIZE_NAMES[sizeClass]}, ${callsInHold} calls and ${Date.now() - outSince} ms into the hold, ${callsInAll} calls in all, the clock at ${new Date(Date.now()).toISOString()})`);
        assert.equal(standCalls, before, `${where()}: a refused call must not reach the wrapped post`);
        // what was met while a call was out
        callsInHold++;
        cover.refusals++;
        const d = new Date(Date.now());
        cover.hourLocal[d.getHours()]!++;
        cover.hourUtc[d.getUTCHours()]!++;
        cover.dayOfMonth[d.getDate()]!++;
        cover.weekday[d.getDay()]!++;
        if (d.getSeconds() === 0) cover.firstSecondOfMinute++;
        if (d.getMinutes() % 2 === 1) cover.oddMinute++;
        cover.sizeClass[sizeClass]!++;
        refusedInLife++;
        const hourBefore = new Date(Date.now() - HOUR_MS).getHours();
        if (hourBefore === d.getHours()) cover.repeatedLocalHourRefusals++; // a local hour that exists twice (the clocks went back)
        else if ((d.getHours() - hourBefore + 24) % 24 === 2) cover.skippedLocalHourRefusals++; // a local hour that does not exist (the clocks went forward)
        const outFor = Date.now() - outSince;
        if (callsInHold >= 12 && outFor >= 2000) cover.refusedAfter12CallsAnd2s++;
        if (callsInAll >= 40 && outFor >= 60_000) cover.refusedAfter40CallsAnd60s++;
        if (callsInHold >= 300 && outFor >= HOUR_MS) cover.refusedAfter300CallsAnd1h++;
      } else {
        assert.equal(standCalls, before + 1, `${where()}: a call made while none is out must go through (body ${SIZE_NAMES[sizeClass]}, ${callsInAll} calls in all, the clock at ${new Date(Date.now()).toISOString()})`);
        if (mode === 'hold') {
          assert.equal(mine.state, 'pending', `${where()}: a held call is pending`);
          out = true;
          outcome = mine;
          holdSteps = scale(1, 1500);
          stepsOut = 0;
          callsInHold = 0;
          movesInHold = 0;
          outSince = Date.now();
        } else if (mode === 'now') {
          assert.equal(mine.state, 'ok', `${where()}: a call answered at once ends with the answer`);
        } else {
          assert.equal(mine.state, 'failed', `${where()}: a rejection or a throw ends the call`);
        }
      }
    } else if (r < (out ? 0.92 : 0.9)) {
      mock.timers.tick(scale(1, 40 * DAY_MS)); // a move of the clock forward, evenly across the scales from 1 ms to 40 days
      if (out) {
        movesInHold++;
        cover.forwardMovesWhileOut++;
      }
    } else if (r < (out ? 0.94 : 0.93)) {
      mock.timers.setTime(Date.now() - 1 - pick(2 * DAY_MS)); // the clock set back by up to two days
      if (out) {
        movesInHold++;
        cover.backwardMovesWhileOut++;
      }
    } else if (r < (out ? 0.96 : 0.95)) {
      // the clock moved to within an hour and a half of the zone's next change of the clocks (nothing happens in a zone that has none)
      const change = nextOffsetChange(Date.now());
      if (change !== undefined) {
        const target = change + Math.floor((rand() - 0.5) * 3 * HOUR_MS);
        if (target > Date.now()) mock.timers.tick(target - Date.now());
        else mock.timers.setTime(target);
        if (out) movesInHold++;
      }
    } else if (out) {
      await settleMicrotasks(); // nothing happens
    }
    assert.ok(maxStandOut <= 1, `${where()}: the wrapped post had two calls out at once`);
    const offset = offsetNow();
    if (offset !== lastOffset) {
      if (out) {
        cover.offsetChangesWhileOut++;
        if (Math.abs(offset - lastOffset) === 60) cover.hourChangesWhileOut++;
        else if (Math.abs(offset - lastOffset) === 30) cover.halfHourChangesWhileOut++;
      }
      lastOffset = offset;
    }
  }
  if (out) await settle('answer'); // a hold still out at the end ends with an answer, so no promise is left
  cover.mostCallsInOneGate = Math.max(cover.mostCallsInOneGate, callsInAll);
  cover.mostRefusalsInOneGate = Math.max(cover.mostRefusalsInOneGate, refusedInLife);
  return { calls: callsInAll, refusals: refusedInLife };
}

/** The zone of each seed is drawn from the seed: New York (an hour at each change of the clocks), Lord Howe (half an hour at each change), Kolkata (a half-hour offset, no change), UTC, Berlin (an hour) and Chatham (a 45-minute offset, an hour at each change). */
const G10_ZONES = ['America/New_York', 'Australia/Lord_Howe', 'Asia/Kolkata', 'UTC', 'Europe/Berlin', 'Pacific/Chatham'];
/** Eight seeds of 6 000 steps, and one long seed of 30 000 steps, long enough that one gate meets its 10 000th call, its 10 000th refusal and its 16 384th call. */
const G10_RUNS = [...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => ({ seed, steps: 6000, zone: G10_ZONES[(seed - 1) % G10_ZONES.length]! })), { seed: 9, steps: 30_000, zone: 'America/New_York' }];
const COVER_MIN = 100;

test('G10. the gate against a model with a clock, counts and body sizes together: 8 seeds of 6 000 steps (a call with a body of a few bytes up to 7 MB, an address of any length, an answer, a rejection, a throw, a move of the clock from 1 ms to 40 days, sometimes backward), holds of up to 1 500 steps with hundreds of calls and dozens of clock moves; every hour of the day, every day of the month, every weekday, the first second of a minute and each size of body are each met many times while a call is out (counted and asserted)', { timeout: 60_000 }, async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const cover = newCoverage();
  let putZoneBack: (() => void) | undefined;
  let long = { calls: 0, refusals: 0 };
  try {
    for (const run of G10_RUNS) {
      putZoneBack?.();
      putZoneBack = setZone(run.zone);
      const got = await timeModelRun(run.seed, run.steps, cover);
      if (run.seed === 9) long = got;
    }
  } finally {
    putZoneBack?.();
    mock.timers.reset(); // the real clock comes back whatever the test did
  }
  console.log(`G10 coverage: ${JSON.stringify(cover)}`);
  const need = (what: string, have: number, least: number): void => assert.ok(have >= least, `coverage shrank: ${what} was met ${have} times while a call was out, at least ${least} are asked for (${JSON.stringify(cover)})`);
  for (let h = 0; h < 24; h++) {
    need(`the hour ${h} (local)`, cover.hourLocal[h]!, COVER_MIN);
    need(`the hour ${h} (UTC)`, cover.hourUtc[h]!, COVER_MIN);
  }
  for (let d = 1; d <= 31; d++) need(`the ${d}th day of the month`, cover.dayOfMonth[d]!, COVER_MIN);
  for (let d = 0; d < 7; d++) need(`weekday ${d}`, cover.weekday[d]!, COVER_MIN);
  need('the first second of a minute', cover.firstSecondOfMinute, COVER_MIN);
  need('an odd minute', cover.oddMinute, COVER_MIN);
  for (let s = 0; s < 5; s++) need(`a body of ${SIZE_NAMES[s]}`, cover.sizeClass[s]!, COVER_MIN);
  need('a refusal after 12 refusals and 2 s', cover.refusedAfter12CallsAnd2s, 100);
  need('a refusal after 40 calls and 60 s', cover.refusedAfter40CallsAnd60s, 100);
  need('a refusal after 300 refusals and an hour', cover.refusedAfter300CallsAnd1h, COVER_MIN);
  need('a clock set back while a call was out', cover.backwardMovesWhileOut, COVER_MIN);
  need('a clock moved forward while a call was out', cover.forwardMovesWhileOut, 100);
  need('refusals in one hold', cover.maxRefusalsInOneHold, 300);
  need('clock moves in one hold', cover.maxMovesInOneHold, 24);
  need('holds settled after more than a day', cover.settledAfterDays, 5);
  need('a change of the offset of the zone', cover.offsetChangesWhileOut, 100);
  need('a change of the clocks by an hour', cover.hourChangesWhileOut, 50);
  need('a change of the clocks by half an hour', cover.halfHourChangesWhileOut, 20);
  need('a refusal in a local hour that exists twice', cover.repeatedLocalHourRefusals, 20);
  need('a refusal in a local hour that does not exist', cover.skippedLocalHourRefusals, 20);
  assert.ok(long.calls >= 16_384 && long.refusals >= 10_000, `the long seed's gate met ${long.calls} calls and ${long.refusals} refusals in its life; 16 384 calls and 10 000 refusals are asked for`);
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

test('G11. the time zone is what it was before G9 ran (the variable, and the offsets of a January and a July instant), whether TZ was set from outside or not', () => {
  assert.equal(process.env.TZ, ZONE_AT_LOAD.tz, 'process.env.TZ is as it was');
  assert.deepEqual([Date.UTC(2026, 0, 15), Date.UTC(2026, 6, 15)].map((t) => new Date(t).getTimezoneOffset()), ZONE_AT_LOAD.offsets, 'the offsets are those of the zone before the file ran');
});
