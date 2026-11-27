// Round 14: the outbox cleanup is one recoverable step. A cleanup cut off at any point resends nothing that was acknowledged.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { Outbox, OUTBOX_NAME, SENT_NAME, REFUSED_NAME, CollectorError } from '../src/outbox.js';
import { createFiles, type Files } from '../src/files.js';
import { createCollector, type PostFn } from '../src/collector.js';
import type { ShotRecord } from '../../core/src/index.js';
import { tempDir, removeTemps, startHub, closeAll, rounds, rig, runCopies, standIns } from './helpers.js';

afterEach(closeAll);
after(removeTemps);

const rec = (id: string, state: string): ShotRecord => ({ ShotID: id, PlayerName: 'ZZTEST-A', State: state }) as unknown as ShotRecord;
const label = (r: ShotRecord): string => `${r.ShotID}:${(r as unknown as { State: string }).State}`;

// ---- a Files that can be cut at the next write of a file ----

type Variant = 'before' | 'temp' | 'after' | 'torn';
interface Arm {
  file: string;
  op: 'write' | 'append';
  variant: Variant;
}
interface Cutting extends Files {
  arm(a: Arm | undefined): void;
  readonly fired: Arm[];
}

/**
 * Wraps a Files. The next write that matches `arm` is cut: 'before' writes nothing; 'temp' writes the temporary file and
 * does not rename it (the leftover temporary file stays in the folder); 'after' completes the write and then fails (the
 * process died before it could go on); 'torn' appends half of the first line of the text, with no newline. Every cut throws.
 */
function cutting(inner: Files): Cutting {
  let armed: Arm | undefined;
  const fired: Arm[] = [];
  const hit = (name: string, op: Arm['op']): Arm | undefined => {
    if (armed === undefined || armed.file !== name || armed.op !== op) return undefined;
    const a = armed;
    armed = undefined;
    fired.push(a);
    return a;
  };
  return {
    ...inner,
    arm: (a) => void (armed = a),
    fired,
    writeData(name, text) {
      const a = hit(name, 'write');
      if (a === undefined) return inner.writeData(name, text);
      if (a.variant === 'temp') inner.writeData(`${name}.tmp`, text);
      if (a.variant === 'after') inner.writeData(name, text);
      throw new Error('cut off here');
    },
    appendDurable(name, text) {
      const a = hit(name, 'append');
      if (a === undefined) return inner.appendDurable(name, text);
      if (a.variant === 'torn') inner.appendData(name, text.slice(0, Math.max(1, Math.floor(text.indexOf(String.fromCharCode(10)) / 2))));
      throw new Error('cut off here');
    },
    appendData(name, text) {
      const a = hit(name, 'append');
      if (a === undefined) return inner.appendData(name, text);
      if (a.variant === 'torn') inner.appendData(name, text.slice(0, Math.max(1, Math.floor(text.indexOf(String.fromCharCode(10)) / 2))));
      throw new Error('cut off here');
    },
  };
}

// ---- C.1 the reviewer's regression, at the outbox ----

const CUTS: Array<[string, Arm | undefined]> = [
  ['before the outbox is written', { file: OUTBOX_NAME, op: 'write', variant: 'before' }],
  ['after the outbox is replaced and before sent.json is written', { file: SENT_NAME, op: 'write', variant: 'before' }],
  ['inside the write of the outbox (the temporary file written, not renamed)', { file: OUTBOX_NAME, op: 'write', variant: 'temp' }],
  ['inside the write of sent.json (the temporary file written, not renamed)', { file: SENT_NAME, op: 'write', variant: 'temp' }],
  ['after both writes', undefined],
];

/** Three shots, the first revised twice, every post acknowledged: the history of the reviewer's case. */
function history(files: Files): Outbox {
  const a = new Outbox(files);
  a.load();
  assert.equal(a.queue([rec('S1', 'in play'), rec('S2', 'finished'), rec('S3', 'finished')]), 3);
  a.markSent(3);
  assert.equal(a.queue([rec('S1', 'in play 2')]), 1);
  a.markSent(1);
  assert.equal(a.queue([rec('S1', 'finished')]), 1);
  a.markSent(1);
  assert.equal(a.pending, 0);
  return a;
}
const LATEST = [rec('S1', 'finished'), rec('S2', 'finished'), rec('S3', 'finished')];

for (const [where, arm] of CUTS) {
  test(`C1. a cleanup cut off ${where}: after a restart nothing is waiting, nothing is resent, the counts are kept, and the round goes on`, () => {
    const dir = tempDir();
    const data = join(dir, 'data');
    const real = createFiles(data, join(dir, 'round.dat'));
    history(real);
    const cut = cutting(real);
    const b = new Outbox(cut);
    b.load();
    cut.arm(arm);
    if (arm === undefined) b.tidy(LATEST);
    else assert.throws(() => b.tidy(LATEST), /cut off here/);
    assert.equal(cut.fired.length, arm === undefined ? 0 : 1, 'the cut happened');

    const c = new Outbox(real);
    c.load();
    const again = c.batch(200).map(label);
    assert.equal(c.pending, 0, `acknowledged records are waiting to be sent again after the restart: ${JSON.stringify(again)}`);
    assert.deepEqual(again, [], 'the next batch is empty');
    assert.equal(c.sent, 5, 'the count of sent is what it was');
    assert.equal(c.refused, 0, 'the count of refused is what it was');
    const sentText = readFileSync(join(data, SENT_NAME), 'utf8');
    const outText = readFileSync(join(data, OUTBOX_NAME), 'utf8');
    // a second load gives the same, and writes nothing that changes the answer
    const d = new Outbox(real);
    d.load();
    assert.equal(d.pending, 0);
    assert.equal(d.sent, 5);
    assert.equal(d.refused, 0);
    assert.equal(readFileSync(join(data, SENT_NAME), 'utf8'), sentText, 'a second load leaves sent.json as it was');
    assert.equal(readFileSync(join(data, OUTBOX_NAME), 'utf8'), outText, 'a second load leaves the outbox as it was');
    // the round goes on: a known copy queues nothing; a new shot and a new revision are queued and only those wait
    assert.equal(d.queue(LATEST), 0, 'what is already known is not queued again');
    assert.equal(d.queue([rec('S4', 'in play'), rec('S2', 'revised')]), 2);
    assert.deepEqual(d.batch(200).map(label), ['S4:in play', 'S2:revised']);
    assert.equal(d.pending, 2);
  });
}

// ---- C.2 the same through the program and the real hub: after the restart the hub receives no request at all ----

/** A loopback proxy in front of the hub that counts every request that reaches it. */
async function countingProxy(targetUrl: string): Promise<{ url: string; count(): number; reset(): void }> {
  const target = new URL(targetUrl);
  let n = 0;
  const server: Server = createServer((req, res) => {
    n++;
    const up = httpRequest({ host: target.hostname, port: Number(target.port), method: req.method, path: req.url, headers: { ...req.headers, host: target.host } }, (u) => {
      res.writeHead(u.statusCode ?? 502, u.headers);
      u.pipe(res);
    });
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  standIns.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, count: () => n, reset: () => void (n = 0) };
}

for (const [where, arm] of [CUTS[1]!, CUTS[0]!] as Array<[string, Arm]>) {
  test(`C2. through the program and the real hub: a cleanup cut off ${where}; the program is stopped and another started on the same folder: the hub receives no request at all, its answer is byte for byte what it was, nothing is pending`, async () => {
    const { url } = await startHub(tempDir());
    const proxy = await countingProxy(url);
    const r = rig(proxy.url);
    const first = r.make();
    await runCopies(r, first, 1, 38); // the whole recorded round, shots revised along the way, every post acknowledged
    await first.stop();
    const before = JSON.stringify(await rounds(url));
    assert.ok(proxy.count() > 5, 'the first program posted');

    // the cleanup is made due (a tiny limit) and cut off
    const cut = cutting(createFiles(r.data, r.gspro));
    const second = r.make({ files: cut, tidyOverBytes: 1 });
    cut.arm(arm);
    await second.tick();
    assert.equal(cut.fired.length, 1, 'the cleanup was cut off');
    await second.stop();

    // a new program on the same data folder and the same round file
    proxy.reset();
    const third = r.make();
    third.start();
    for (let i = 0; i < 5; i++) {
      await third.tick();
      assert.equal(proxy.count(), 0, `the hub received a request after the restart (tick ${i + 1})`);
      assert.equal(JSON.stringify(await rounds(url)), before, `the hub's rounds answer changed after the restart (tick ${i + 1})`);
      assert.equal(third.status().pending, 0, 'nothing is pending');
    }
    await third.stop();
  });
}

// ---- C.3 generations that do not belong together ----

const SHORT = (id: string): string => JSON.stringify({ short: { id, fp: 'f'.repeat(64) } }) + '\n';
const BAD = /^(The outbox file (and the record of what was sent do not belong together|is damaged)|The record of what was sent is damaged)\. Stop the program and move the data folder aside/;

function plant(outboxText: string | undefined, sent: object | undefined): { dir: string; files: Files } {
  const dir = tempDir();
  const data = join(dir, 'data');
  mkdirSync(data, { recursive: true });
  if (outboxText !== undefined) writeFileSync(join(data, OUTBOX_NAME), outboxText);
  if (sent !== undefined) writeFileSync(join(data, SENT_NAME), JSON.stringify(sent));
  return { dir, files: createFiles(data, join(dir, 'round.dat')) };
}

const MISMATCHES: Array<[string, string, object]> = [
  ['sent.json ahead of the outbox', SHORT('S1') + SHORT('S2'), { cursor: 2, sent: 2, refused: 0, gen: 1 }],
  ['the outbox two ahead of sent.json', '{"gen":2}\n' + SHORT('S1'), { cursor: 1, sent: 1, refused: 0, gen: 0 }],
  ['the outbox two ahead of a sent.json with no gen', '{"gen":2}\n' + SHORT('S1'), { cursor: 1, sent: 1, refused: 0 }],
  ['a header on a later line', SHORT('S1') + '{"gen":1}\n' + SHORT('S2'), { cursor: 1, sent: 1, refused: 0, gen: 0 }],
  ['a header that is a string', '{"gen":"1"}\n' + SHORT('S1'), { cursor: 1, sent: 1, refused: 0, gen: 0 }],
  ['a header that is negative', '{"gen":-1}\n' + SHORT('S1'), { cursor: 1, sent: 1, refused: 0, gen: 0 }],
  ['a header that is not whole', '{"gen":1.5}\n' + SHORT('S1'), { cursor: 1, sent: 1, refused: 0, gen: 0 }],
  ['a repair that would find a full record', '{"gen":1}\n' + JSON.stringify({ record: rec('S1', 'x') }) + '\n', { cursor: 1, sent: 1, refused: 0, gen: 0 }],
  ['a sent.json whose gen is not a whole number', SHORT('S1'), { cursor: 1, sent: 1, refused: 0, gen: 'one' }],
];

for (const [name, outboxText, sent] of MISMATCHES) {
  test(`C3. ${name}: refused with the plain message, nothing sent`, async () => {
    const { files } = plant(outboxText, sent);
    assert.throws(
      () => new Outbox(files).load(),
      (e: unknown) => e instanceof CollectorError && BAD.test(e.message) && !/ZZTEST|S1|S2|fff/.test(e.message),
    );
    // through the program: the start stops with the same refusal and no post is made
    const dir = tempDir();
    const data = join(dir, 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, OUTBOX_NAME), outboxText);
    writeFileSync(join(data, SENT_NAME), JSON.stringify(sent));
    writeFileSync(join(dir, 'round.dat'), JSON.stringify([rec('S9', 'x')]));
    let posts = 0;
    const post: PostFn = async () => {
      posts++;
      return { status: 200, body: { added: 1, revised: 0, unchanged: 0, conflicts: 0 } };
    };
    const c = createCollector({ gsproFile: join(dir, 'round.dat'), dataDir: data, hubUrl: 'http://127.0.0.1:1', post });
    await assert.rejects(c.tick(), (e: unknown) => e instanceof CollectorError && BAD.test(e.message));
    assert.equal(posts, 0, 'nothing was sent');
  });
}

// ---- C.4 a folder written by today's program ----

test('C4. a folder written by today\'s program (no gen, no header): it loads, sends what waits, and its first cleanup moves it to generation 1; a start after that reads it', () => {
  const a = rec('A1', 'one');
  const b = rec('A2', 'two');
  const c = rec('A3', 'three');
  const { dir, files } = plant([a, b, c].map((x) => JSON.stringify({ record: x }) + '\n').join(''), { cursor: 1, sent: 1, refused: 0 });
  const data = join(dir, 'data');
  const ob = new Outbox(files);
  ob.load();
  assert.equal(ob.pending, 2);
  assert.deepEqual(ob.batch(10).map(label), ['A2:two', 'A3:three']);
  ob.markSent(2);
  assert.equal(JSON.parse(readFileSync(join(data, SENT_NAME), 'utf8')).gen, undefined, 'still generation 0 (no field) until a cleanup');
  ob.tidy([a, b, c]);
  assert.equal(JSON.parse(readFileSync(join(data, SENT_NAME), 'utf8')).gen, 1);
  assert.equal(readFileSync(join(data, OUTBOX_NAME), 'utf8').split('\n')[0], '{"gen":1}', 'the outbox begins with its header');
  const after = new Outbox(files);
  after.load();
  assert.equal(after.pending, 0);
  assert.equal(after.sent, 3);
  assert.equal(after.queue([a, b, c]), 0, 'the shots are remembered');
  after.tidy([a, b, c]);
  assert.equal(JSON.parse(readFileSync(join(data, SENT_NAME), 'utf8')).gen, 2);
  const third = new Outbox(files);
  third.load();
  assert.equal(third.pending, 0);
});

// ---- C.5 a seeded random drive of the outbox, with a cut at a random write ----

/** An in-memory data folder: the same operations as the real file module, with no disk, so thousands of steps are cheap. */
function memFiles(): Files {
  const store = new Map<string, string>();
  const cut = (name: string, bytes: number): void => void store.set(name, Buffer.from(store.get(name) ?? '', 'utf8').subarray(0, bytes).toString('utf8'));
  return {
    statSource: () => undefined,
    copySource: () => undefined,
    readCopy: () => '',
    ensureDataDir: () => undefined,
    readData: (name) => store.get(name),
    readLines(name, _piece, onLine) {
      const text = store.get(name);
      if (text === undefined) return { validBytes: 0, tornBytes: 0 };
      const end = text.lastIndexOf('\n') + 1;
      for (const line of text.slice(0, end === 0 ? 0 : end - 1).split('\n')) if (end > 0) onLine(line);
      return { validBytes: Buffer.byteLength(text.slice(0, end)), tornBytes: Buffer.byteLength(text.slice(end)) };
    },
    keepPrefix: (name, bytes) => cut(name, bytes),
    appendData: (name, text) => void store.set(name, (store.get(name) ?? '') + text),
    appendDurable: (name, text) => void store.set(name, (store.get(name) ?? '') + text),
    writeData: (name, text) => void store.set(name, text),
  };
}

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

const rev = (r: ShotRecord): number => (r as unknown as { Rev: number }).Rev;
const shot = (id: string, n: number): ShotRecord => ({ ShotID: id, PlayerName: 'ZZTEST-A', Rev: n }) as unknown as ShotRecord;
const same = (x: ShotRecord, y: ShotRecord): boolean => x.ShotID === y.ShotID && rev(x) === rev(y);

type Op = 'queue' | 'ack' | 'refuse' | 'tidy';
/** What the drive counts: every kind of write cut, with the variant of the cut. */
type Tally = Record<string, number>;

/**
 * One seed. The model the test keeps: `pending` (queued, not yet done), `done` (the latest revision of each shot that is
 * certainly acknowledged or refused), `latest` (the latest revision of each shot, the copy a cleanup is given) and `uncertain`
 * (the one batch whose acknowledgement was the write that was cut: the hub already holds that content).
 */
function driveOne(seed: number, steps: number, tally: Tally): void {
  const rand = seeded(seed);
  const pick = (n: number): number => Math.floor(rand() * n);
  const mem = cutting(memFiles());
  let ob = new Outbox(mem);
  ob.load();
  let pending: ShotRecord[] = [];
  const done = new Map<string, number>();
  const latest = new Map<string, number>();
  let uncertain: ShotRecord[] = [];
  let doneCount = 0; // sent + refused, certainly
  let nextShot = 1;
  let step = 0;
  const where = (): string => `seed ${seed}, step ${step}`;

  const restartAndCheck = (what: string): void => {
    const fresh = new Outbox(mem);
    fresh.load();
    const waiting = (fresh as unknown as { waiting: ShotRecord[] }).waiting.slice();
    // a second load gives the same
    const again = new Outbox(mem);
    again.load();
    assert.deepEqual((again as unknown as { waiting: ShotRecord[] }).waiting, waiting, `${where()} (${what}): a second load gives the same`);
    for (const w of waiting) {
      const inU = uncertain.some((u) => same(u, w));
      const inPending = pending.some((p) => same(p, w));
      assert.ok(inU || inPending, `${where()} (${what}): a record waits that was neither never acknowledged nor the batch whose acknowledgement was cut: ${label(w)}`);
      const d = done.get(w.ShotID);
      assert.ok(inU || d === undefined || rev(w) > d, `${where()} (${what}): an older revision of an acknowledged shot waits: ${label(w)} (revision ${d} was acknowledged)`);
    }
    for (const p of pending) if (!uncertain.some((u) => same(u, p))) assert.ok(waiting.some((w) => same(w, p)), `${where()} (${what}): a record that was queued and never acknowledged is missing: ${label(p)}`);
    // the order of what waits is the order it was queued in
    const order = waiting.map((w) => uncertain.findIndex((u) => same(u, w)) >= 0 ? -1 : pending.findIndex((p) => same(p, w)));
    for (let i = 1; i < order.length; i++) assert.ok(order[i]! > order[i - 1]! || order[i - 1]! === -1 || order[i]! === -1, `${where()} (${what}): the waiting records are out of order`);
    // the counts: certainly done, plus the uncertain batch if its write took
    const total = fresh.sent + fresh.refused;
    const resent = waiting.filter((w) => uncertain.some((u) => same(u, w))).length;
    assert.ok(total === doneCount || total === doneCount + uncertain.length, `${where()} (${what}): the counts of sent and refused are ${total}, expected ${doneCount} or ${doneCount + uncertain.length}`);
    // sync the model with what the disk says
    for (const u of uncertain) {
      if (!waiting.some((w) => same(w, u))) {
        done.set(u.ShotID, Math.max(done.get(u.ShotID) ?? 0, rev(u)));
        doneCount++;
      }
    }
    void resent;
    pending = waiting.filter((w) => pending.some((p) => same(p, w)) || uncertain.some((u) => same(u, w)));
    uncertain = [];
    ob = fresh;
  };

  const markDone = (batch: ShotRecord[]): void => {
    for (const b of batch) done.set(b.ShotID, Math.max(done.get(b.ShotID) ?? 0, rev(b)));
    doneCount += batch.length;
    pending = pending.filter((p) => !batch.some((b) => same(b, p)));
  };

  for (step = 1; step <= steps; step++) {
    const op: Op = (['queue', 'queue', 'queue', 'ack', 'ack', 'refuse', 'tidy', 'tidy'] as const)[pick(8)]!;
    const cutHere = rand() < 0.35;
    const variants = (): Variant => (['before', 'temp', 'after', 'torn'] as const)[pick(4)]!;
    let arm: Arm | undefined;
    if (cutHere) {
      if (op === 'queue') arm = { file: OUTBOX_NAME, op: 'append', variant: rand() < 0.5 ? 'before' : 'torn' };
      else if (op === 'ack') arm = { file: SENT_NAME, op: 'write', variant: (['before', 'temp', 'after'] as const)[pick(3)]! };
      else if (op === 'refuse') arm = rand() < 0.4 ? { file: REFUSED_NAME, op: 'append', variant: rand() < 0.5 ? 'before' : 'torn' } : { file: SENT_NAME, op: 'write', variant: (['before', 'temp', 'after'] as const)[pick(3)]! };
      else arm = { file: rand() < 0.5 ? OUTBOX_NAME : SENT_NAME, op: 'write', variant: (['before', 'temp', 'after'] as const)[pick(3)]! };
      void variants;
    }
    mem.arm(arm);
    const firedBefore = mem.fired.length;
    let batch: ShotRecord[] = [];
    let threw = false;
    try {
      if (op === 'queue') {
        const records: ShotRecord[] = [];
        const n = 1 + pick(3);
        for (let i = 0; i < n; i++) {
          if (latest.size > 0 && rand() < 0.5) {
            const ids = [...latest.keys()];
            const id = ids[pick(ids.length)]!;
            const r = shot(id, latest.get(id)! + 1 + (records.some((x) => x.ShotID === id) ? 1 : 0));
            if (!records.some((x) => x.ShotID === id)) records.push(r);
          } else {
            records.push(shot(`S${nextShot++}`, 1));
          }
        }
        const got = ob.queue(records);
        assert.equal(got, records.length, `${where()}: every new record is queued`);
        for (const r of records) {
          pending.push(r);
          latest.set(r.ShotID, rev(r));
        }
      } else if (op === 'ack') {
        batch = ob.batch(1 + pick(4));
        if (batch.length > 0) {
          uncertain = batch;
          ob.markSent(batch.length);
          uncertain = [];
          markDone(batch);
        }
      } else if (op === 'refuse') {
        batch = ob.batch(1 + pick(3));
        if (batch.length > 0) {
          uncertain = batch;
          ob.markRefused(batch.length, 400, step);
          uncertain = [];
          markDone(batch);
        }
      } else if (ob.needsTidy(1)) {
        ob.tidy([...latest].map(([id, n]) => shot(id, n)));
      }
    } catch (e) {
      assert.equal((e as Error).message, 'cut off here', `${where()}: ${(e as Error).message}`);
      threw = true;
    }
    mem.arm(undefined);
    if (threw) {
      const a = mem.fired[mem.fired.length - 1]!;
      assert.equal(mem.fired.length, firedBefore + 1);
      const key = `${op}/${a.file}/${a.op}/${a.variant}`;
      tally[key] = (tally[key] ?? 0) + 1;
      if (op !== 'ack' && op !== 'refuse') uncertain = [];
      // a queue that was cut did not queue: nothing of it is in the model
      restartAndCheck(`after a cut of ${key}`);
    } else if (mem.fired.length === firedBefore && rand() < 0.1) {
      restartAndCheck('a plain restart');
    }
  }
}

test('C5. a seeded random drive of the outbox with a cut at a random write: after every restart no acknowledged older revision waits, nothing queued and not acknowledged is missing, the counts are right; every kind of write is cut many times (counted and asserted)', () => {
  const tally: Tally = {};
  const SEEDS = 40;
  for (let seed = 1; seed <= SEEDS; seed++) driveOne(seed, 400, tally);
  const kinds = [
    'queue/outbox.jsonl/append/before',
    'queue/outbox.jsonl/append/torn',
    'ack/sent.json/write/before',
    'ack/sent.json/write/temp',
    'ack/sent.json/write/after',
    'refuse/refused.jsonl/append/before',
    'refuse/refused.jsonl/append/torn',
    'refuse/sent.json/write/before',
    'refuse/sent.json/write/temp',
    'refuse/sent.json/write/after',
    'tidy/outbox.jsonl/write/before',
    'tidy/outbox.jsonl/write/temp',
    'tidy/outbox.jsonl/write/after',
    'tidy/sent.json/write/before',
    'tidy/sent.json/write/temp',
    'tidy/sent.json/write/after',
  ];
  console.log(`C5 cuts: ${JSON.stringify(tally)}`);
  for (const k of kinds) assert.ok((tally[k] ?? 0) >= 20, `coverage shrank: ${k} was cut ${tally[k] ?? 0} times, at least 20 are asked for (${JSON.stringify(tally)})`);
});

// ---- C.6 an empty copy never starts a cleanup ----

test('C6. an empty copy when a cleanup is due changes nothing in the data folder, and the next full read queues nothing', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make({ tidyOverBytes: 1 });
  await runCopies(r, c, 1, 10);
  const outBefore = readFileSync(join(r.data, OUTBOX_NAME), 'utf8');
  const sentBefore = readFileSync(join(r.data, SENT_NAME), 'utf8');
  const queuedBefore = c.status().queued;
  r.write('[]'); // GSPro's file reads as empty at the moment a cleanup is due
  await c.tick();
  assert.equal(readFileSync(join(r.data, OUTBOX_NAME), 'utf8'), outBefore, 'the outbox is as it was');
  assert.equal(readFileSync(join(r.data, SENT_NAME), 'utf8'), sentBefore, 'sent.json is as it was');
  r.writeCopy(10);
  await c.tick();
  assert.equal(c.status().queued, queuedBefore, 'the next full read queues nothing');
  assert.equal(c.status().pending, 0);
  assert.ok(existsSync(join(r.data, OUTBOX_NAME)));
  await c.stop();
  // the same at the outbox
  const dir = tempDir();
  const real = createFiles(join(dir, 'data'), join(dir, 'round.dat'));
  const ob = history(real);
  ob.tidy(LATEST);
  const o1 = readFileSync(join(dir, 'data', OUTBOX_NAME), 'utf8');
  const s1 = readFileSync(join(dir, 'data', SENT_NAME), 'utf8');
  ob.tidy([]);
  assert.equal(readFileSync(join(dir, 'data', OUTBOX_NAME), 'utf8'), o1);
  assert.equal(readFileSync(join(dir, 'data', SENT_NAME), 'utf8'), s1);
});
