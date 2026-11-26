// Round 13: the start keeps one journal handle and fails closed on a change; the order of overlapping posts; a failed undo;
// the six wrong versions of the repeat's clock and code filter. Self-contained: it does not import the other test file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, ftruncateSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { request } from 'node:http';
import { createHub, type Hub, type HubOptions } from '../src/server.js';
import { Journal, JournalError, JOURNAL_NAME, type JournalIO } from '../src/journal.js';
import { loadRecording, type Copy } from '../../core/src/index.js';

const RECORDING = join(import.meta.dirname, '../../fixtures/gspro-4.1.13/2026-11-23');
const copies: Copy[] = loadRecording(RECORDING);
const temps: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sim-hub-test-r13-'));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const quiet = { log: () => undefined, warn: () => undefined };
const REC = (n: number): any => structuredClone(copies[37]!.records[n]!);
const lineOf = (records: unknown[]): string => `${JSON.stringify(records)}\n`;
const journalOf = (dir: string): string => join(dir, JOURNAL_NAME);
const lockFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.startsWith('hub.lock'));
const coded = (code: unknown): NodeJS.ErrnoException => {
  const e: NodeJS.ErrnoException = new Error(`failed (${String(code)}, test)`);
  e.code = code as string;
  return e;
};

async function withHub(dir: string, extra: Partial<HubOptions>, fn: (url: string, hub: Hub) => Promise<void>): Promise<void> {
  const hub = createHub({ dataDir: dir, port: 0, ...quiet, ...extra });
  try {
    const a = await hub.listen();
    await fn(`http://${a.host}:${a.port}`, hub);
  } finally {
    await hub.close();
  }
}
async function post(url: string, records: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}/v0/shots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) });
  return { status: res.status, body: await res.json() };
}
async function rounds(url: string): Promise<any> {
  const res = await fetch(`${url}/v0/rounds`);
  assert.equal(res.status, 200);
  return res.json();
}
/** What a fresh hub shows for the journal in this folder. */
async function answerOf(dir: string): Promise<any> {
  let out: any;
  await withHub(dir, {}, async (url) => {
    out = await rounds(url);
  });
  return out;
}

const REFUSED = /^the journal journal\.jsonl was removed, replaced or changed while the hub was starting; nothing was changed; start the hub again$/;

/** A journal (a cut-short last line, or a complete one without its newline, or a whole one), and the journal that takes its place. */
function layout(kind: 'cut' | 'nonewline' | 'whole' | 'samelength'): { dir: string; path: string; x: string; y: string; other: string; moved: string } {
  const dir = tempDir();
  let x: string;
  let y: string;
  if (kind === 'cut') {
    x = lineOf([REC(0)]) + lineOf([REC(4)]) + '[{"cut":';
    y = lineOf([REC(1)]) + lineOf([REC(2)]) + lineOf([REC(3)]) + lineOf([REC(5)]) + lineOf([REC(6)]);
  } else if (kind === 'nonewline') {
    x = lineOf([REC(0)]) + lineOf([REC(4)]).slice(0, -1);
    y = lineOf([REC(1)]) + lineOf([REC(2)]) + lineOf([REC(3)]) + lineOf([REC(5)]) + lineOf([REC(6)]);
  } else if (kind === 'whole') {
    x = lineOf([REC(0)]) + lineOf([REC(4)]);
    y = lineOf([REC(1)]) + lineOf([REC(2)]) + lineOf([REC(3)]);
  } else {
    x = lineOf([REC(0)]);
    y = lineOf([REC(1)]);
    const w = Math.max(x.length, y.length);
    x = x.slice(0, -1) + ' '.repeat(w - x.length) + '\n';
    y = y.slice(0, -1) + ' '.repeat(w - y.length) + '\n';
    assert.equal(Buffer.byteLength(x), Buffer.byteLength(y));
  }
  const path = journalOf(dir);
  writeFileSync(path, x);
  return { dir, path, x, y, other: join(dir, 'other.tmp'), moved: join(dir, 'moved-away.tmp') };
}
const swap = (l: { path: string; other: string; moved: string; y: string }): void => {
  writeFileSync(l.other, l.y);
  renameSync(l.path, l.moved); // a file that is open cannot be renamed over: move it aside first, then move the other into place
  renameSync(l.other, l.path);
};

const KINDS = ['cut', 'nonewline', 'whole', 'samelength'] as const;

for (const [i, kind] of KINDS.entries()) {
  test(`A${i + 1}. Journal.open: the journal (${kind}) is moved aside and another put in its place from the hub's own batch callback: the start is refused, both files are byte for byte as they were`, { timeout: 60000 }, async () => {
    const l = layout(kind);
    let swapped = false;
    let message = '';
    let opened: Journal | undefined;
    try {
      opened = await Journal.open(l.dir, () => {
        if (!swapped) {
          swapped = true;
          swap({ ...l, y: l.y });
        }
      }, () => undefined);
    } catch (e) {
      assert.ok(e instanceof JournalError);
      message = (e as Error).message;
    } finally {
      opened?.close();
    }
    assert.equal(swapped, true);
    assert.match(message, REFUSED);
    assert.ok(!message.includes(l.dir) && !message.toLowerCase().includes(basename(l.dir).toLowerCase()), 'no path');
    assert.equal(readFileSync(l.path, 'utf8'), l.y, 'the replacement is untouched');
    assert.equal(readFileSync(l.moved, 'utf8'), l.x, 'the file that was moved aside is untouched');
    // a fresh start succeeds and shows the file now at the path
    rmSync(l.moved);
    const j = await Journal.open(l.dir, () => undefined, () => undefined);
    j.close();
  });
}

test('A5. the swap is made by the test from a setImmediate between two pieces of the replay (a small piece size), no callback of the hub involved: refused, nothing touched, a fresh start works', { timeout: 60000 }, async () => {
  const l = layout('cut');
  let opened: Journal | undefined;
  let message = '';
  const opening = Journal.open(l.dir, () => undefined, () => undefined, { pieceBytes: 64 });
  setImmediate(() => swap(l)); // runs in one of the turns between pieces
  try {
    opened = await opening;
  } catch (e) {
    message = (e as Error).message;
  } finally {
    opened?.close();
  }
  assert.match(message, REFUSED);
  assert.equal(readFileSync(l.path, 'utf8'), l.y);
  assert.equal(readFileSync(l.moved, 'utf8'), l.x);
  rmSync(l.moved);
  (await Journal.open(l.dir, () => undefined, () => undefined)).close();
});

test('A6. through createHub(...).listen(): the swap made between two pieces of the replay is refused, the folder keeps only the two journals, no lock file is left, a fresh start has the replacement\'s scores', { timeout: 120000 }, async () => {
  for (const kind of ['cut', 'nonewline'] as const) {
    const l = layout(kind);
    const lines: string[] = [];
    const io: Partial<JournalIO> = {
      openReadWrite: (path: string): number => {
        const fd = openSync(path, constants.O_RDWR | constants.O_CREAT);
        setImmediate(() => swap(l)); // before the replay's second piece
        return fd;
      },
    };
    const hub = createHub({ dataDir: l.dir, port: 0, log: () => undefined, warn: (s) => lines.push(s), journal: { pieceBytes: 64, io } });
    await assert.rejects(hub.listen(), (e: Error) => REFUSED.test(e.message));
    await hub.close();
    assert.equal(readFileSync(l.path, 'utf8'), l.y);
    assert.equal(readFileSync(l.moved, 'utf8'), l.x);
    assert.deepEqual(lockFiles(l.dir), [], 'no lock file is left');
    assert.deepEqual(readdirSync(l.dir).sort(), ['journal.jsonl', 'moved-away.tmp']);
    // a fresh start: the scores are those of the file now at the path
    rmSync(l.moved);
    const other = tempDir();
    writeFileSync(journalOf(other), l.y);
    assert.deepEqual(await answerOf(l.dir), await answerOf(other));
  }
});

test('A7. the size half of the look (through the io.size seam): a held file whose size is not the bytes the replay read is refused and nothing is repaired; the identity half alone is not enough', { timeout: 60000 }, async () => {
  const l = layout('cut');
  const real = readFileSync(l.path);
  let message = '';
  try {
    await Journal.open(l.dir, () => undefined, () => undefined, { io: { size: (fd: number): number => fstatSync(fd).size + 1 } });
  } catch (e) {
    message = (e as Error).message;
  }
  assert.match(message, REFUSED);
  assert.ok(readFileSync(l.path).equals(real), 'the cut-short last line was NOT repaired');
  (await Journal.open(l.dir, () => undefined, () => undefined)).close();
  assert.equal(readFileSync(l.path, 'utf8'), lineOf([REC(0)]) + lineOf([REC(4)]), 'the ordinary repair still works');
});

test('A8. a look that cannot tell refuses the start with the code and no path: the path look failing (EACCES), a code that is not plain (error), the size read failing (EIO); nothing is changed', { timeout: 60000 }, async () => {
  for (const [io, expected] of [
    [{ statPathAtStart: (): never => { throw coded('EACCES'); } }, 'EACCES'],
    [{ statPathAtStart: (): never => { throw coded('C:\\Users\\Somebody\\ZZTEST-A'); } }, 'error'],
    [{ size: (): never => { throw coded('EIO'); } }, 'EIO'],
  ] as const) {
    const l = layout('cut');
    let message = '';
    try {
      await Journal.open(l.dir, () => undefined, () => undefined, { io: io as Partial<JournalIO> });
    } catch (e) {
      message = (e as Error).message;
    }
    assert.equal(message, `the journal journal.jsonl could not be looked at while the hub was starting (${expected}); nothing was changed; try again in a moment`);
    assert.ok(!message.includes('Somebody') && !message.includes(l.dir));
    assert.equal(readFileSync(l.path, 'utf8'), l.x, 'nothing was changed');
  }
});

test('A9. the start opens the journal by path once (the second open of the old code is a failure here), creates it when absent, and a refused start closes the descriptor it looked at', { timeout: 60000 }, async () => {
  const dir = tempDir();
  let opens = 0;
  const j = await Journal.open(dir, () => undefined, () => undefined, {
    io: {
      openReadWrite: (path: string): number => {
        opens++;
        return openSync(path, constants.O_RDWR | constants.O_CREAT);
      },
      openRead: (): never => {
        throw new Error('the start must not open the journal a second time');
      },
    },
  });
  assert.equal(opens, 1);
  assert.equal(readFileSync(journalOf(dir), 'utf8'), '');
  j.close();
  // a refused start closes the descriptor it opened
  const l = layout('cut');
  const seen: number[] = [];
  const closed: number[] = [];
  await assert.rejects(
    Journal.open(l.dir, () => undefined, () => undefined, {
      io: {
        size: (fd: number): number => {
          seen.push(fd);
          return 0;
        },
        close: (fd: number): void => {
          closed.push(fd);
          closeSync(fd);
        },
      },
    }),
    (e: Error) => REFUSED.test(e.message),
  );
  assert.deepEqual(closed, seen, 'the descriptor the look read is the one that was closed');
});

// ---------------------------------------------------------------- item B

function slowPost(url: string, body: string): { sendRest: () => void; done: Promise<{ status: number; body: any }> } {
  const u = new URL(url);
  const buf = Buffer.from(body, 'utf8');
  const half = Math.floor(buf.length / 2);
  let req!: ReturnType<typeof request>;
  const done = new Promise<{ status: number; body: any }>((resolve, reject) => {
    req = request({ host: u.hostname, port: u.port, path: '/v0/shots', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': String(buf.length) } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(parts).toString('utf8')) }));
    });
    req.on('error', reject);
    req.write(buf.subarray(0, half));
  });
  return { sendRest: () => req.end(buf.subarray(half)), done };
}

test('B1. two overlapping posts for one shot, the older copy\'s post begun first and finished last: the copy kept is the one that finished last, live and after a restart, and a restart equals live', { timeout: 60000 }, async () => {
  const dir = tempDir();
  const older = REC(0);
  const newer = REC(0);
  newer.HoleShot = Number(older.HoleShot) + 1;
  let live: any;
  await withHub(dir, {}, async (url) => {
    const first = slowPost(url, JSON.stringify({ records: [older] })); // begins first
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await post(url, [newer])).status, 200); // begins later, finishes first
    first.sendRest();
    assert.equal((await first.done).status, 200); // finishes last: its copy is the one kept
    const probe = await post(url, [older]);
    assert.deepEqual([probe.body.unchanged, probe.body.revised], [1, 0], `the copy that finished last (the older one) is held: ${JSON.stringify(probe.body)}`);
    live = await rounds(url);
  });
  assert.deepEqual(await answerOf(dir), live, 'a restart equals live');
});

test('B2. a quick post that begins after a slow one is answered 200 while the slow one\'s body is still open: the slow sender did not hold it up', { timeout: 60000 }, async () => {
  await withHub(tempDir(), {}, async (url) => {
    const slow = slowPost(url, JSON.stringify({ records: [REC(1)] }));
    await new Promise((r) => setTimeout(r, 300));
    const quick = await post(url, [REC(2)]);
    assert.equal(quick.status, 200, 'answered while the slow body is still open');
    slow.sendRest();
    assert.equal((await slow.done).status, 200);
  });
});

// ---------------------------------------------------------------- item C

const UNDO = /could not undo a failed write to its journal journal\.jsonl \((\w+)\)/;
const BACK = /could not read its journal journal\.jsonl back \((\w+)\)/;
const ENDING = /; stop this hub and start it again, and read what the start prints$/;

function failingIO(state: { arm: boolean }, extra: Partial<JournalIO> = {}): Partial<JournalIO> {
  return {
    write: (fd: number, buf: Buffer, off: number, len: number, position: number): number => {
      if (state.arm) throw coded('EIO');
      return writeSync(fd, buf, off, len, position);
    },
    truncate: (fd: number, length: number): void => {
      if (state.arm) throw coded('EPERM');
      ftruncateSync(fd, length);
    },
    ...extra,
  };
}

test('C1. a write that fails and a cut-back that fails: one line with the write error\'s code, then 503 journal_unavailable for later posts, nothing removed from the journal', { timeout: 120000 }, async () => {
  const dir = tempDir();
  const state = { arm: false };
  const said: string[] = [];
  await withHub(dir, { journal: { io: failingIO(state) }, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    const before = readFileSync(journalOf(dir));
    state.arm = true;
    assert.equal((await post(url, [REC(1)])).status, 500);
    state.arm = false;
    const lines = said.filter((l) => UNDO.test(l));
    assert.equal(lines.length, 1, said.join(' | '));
    assert.equal(said.length, 1, 'exactly one console line for that post');
    assert.match(lines[0]!, /\(EIO\)/);
    assert.match(lines[0]!, ENDING);
    assert.match(lines[0]!, /it takes no more shots until it is restarted; this hub has removed nothing it answered 200 for;/);
    assert.ok(!lines[0]!.includes(dir) && !lines[0]!.includes('ZZTEST') && !lines[0]!.includes('ShotID'));
    assert.deepEqual((await post(url, [REC(2)])).body, { error: 'journal_unavailable' });
    assert.equal(said.length, 1, 'nothing more is printed');
    assert.ok(readFileSync(journalOf(dir)).subarray(0, before.length).equals(before), 'what the hub answered 200 for is still in the journal');
  });
});

test('C1b. the combinations: the read-back fails too: only the could-not-read-back line (with the new ending); a code that is not plain prints error', { timeout: 120000 }, async () => {
  const state = { arm: false };
  const said: string[] = [];
  const io = failingIO(state, {
    openRead: (path: string): number => {
      if (state.arm) throw coded('EBUSY');
      return openSync(path, 'r');
    },
  });
  await withHub(tempDir(), { journal: { io }, warn: (l) => said.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    state.arm = true;
    assert.equal((await post(url, [REC(1)])).status, 500);
    state.arm = false;
  });
  assert.equal(said.length, 1, said.join(' | '));
  assert.match(said[0]!, BACK);
  assert.doesNotMatch(said[0]!, UNDO);
  assert.match(said[0]!, ENDING, 'the new ending of the read-back line');
  assert.match(said[0]!, /\(EBUSY\)/);
  // the code of the write error is filtered too
  const said2: string[] = [];
  const state2 = { arm: false };
  const io2 = failingIO(state2, {
    write: (fd: number, buf: Buffer, off: number, len: number, position: number): number => {
      if (state2.arm) throw coded('C:\\Users\\Somebody\\ZZTEST-A');
      return writeSync(fd, buf, off, len, position);
    },
  });
  await withHub(tempDir(), { journal: { io: io2 }, warn: (l) => said2.push(l) }, async (url) => {
    assert.equal((await post(url, [REC(0)])).status, 200);
    state2.arm = true;
    assert.equal((await post(url, [REC(1)])).status, 500);
  });
  assert.equal(said2.length, 1);
  assert.match(said2[0]!, /\(error\)/);
  assert.ok(!said2.join('\n').includes('Somebody') && !said2.join('\n').includes('ZZTEST-A'));
});

// ---------------------------------------------------------------- C4

function lockSeam() {
  const seam = {
    mode: 'ok' as 'ok' | 'once' | 'fail',
    code: 'EBUSY' as unknown,
    read: (path: string): string => {
      if (seam.mode === 'once' || seam.mode === 'fail') {
        if (seam.mode === 'once') seam.mode = 'ok';
        throw coded(seam.code);
      }
      return readFileSync(path, 'utf8');
    },
  };
  return seam;
}
const FIRST = /this hub could not (read its own lock|look at its journal)/;
const REPEAT = /this hub is still unable to (read its own lock|look at its journal)/;

test('C4a. T7 and U7: the default clock is in milliseconds (performance.now replaced for the test and restored): no repeat at 59,999 ms, a repeat at 60,000', { timeout: 120000 }, async () => {
  const seam = lockSeam();
  const said: string[] = [];
  const realNow = performance.now;
  let t = 5_000;
  performance.now = (): number => t;
  try {
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      seam.mode = 'fail';
      await post(url, [REC(1)]);
      assert.equal(said.filter((l) => FIRST.test(l)).length, 1);
      t = 5_000 + 59_999;
      await post(url, [REC(1)]);
      assert.equal(said.filter((l) => REPEAT.test(l)).length, 0, 'none at 59,999 ms');
      t = 5_000 + 60_000;
      await post(url, [REC(1)]);
      assert.equal(said.filter((l) => REPEAT.test(l)).length, 1, 'one at 60,000 ms');
    });
  } finally {
    performance.now = realNow;
  }
});

test('C4b. T14, T2, T1, U13: a lower-case code, an empty code and a number print error; a code with a digit (E2BIG) is printed', { timeout: 240000 }, async () => {
  for (const [code, expected] of [['ebusy', '(error)'], ['', '(error)'], [5, '(error)'], ['E2BIG', '(E2BIG)']] as const) {
    const seam = lockSeam();
    seam.code = code;
    const said: string[] = [];
    await withHub(tempDir(), { lockRead: seam.read, warn: (l) => said.push(l) }, async (url) => {
      assert.equal((await post(url, [REC(0)])).status, 200);
      seam.mode = 'once';
      await post(url, [REC(1)]);
    });
    const line = said.filter((l) => FIRST.test(l));
    assert.equal(line.length, 1, `${JSON.stringify(code)}: ${said.join(' ')}`);
    assert.ok(line[0]!.includes(`${expected}:`), `${JSON.stringify(code)} should print ${expected}: ${line[0]}`);
  }
});

export type { HubOptions };
