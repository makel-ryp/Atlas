import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createCollector, defaultPost, statusLine, type PostResult } from '../src/collector.js';
import { createFiles } from '../src/files.js';
import { defaultGsproFile, startProgram } from '../src/program.js';
import {
  SRC, copies, tempDir, removeTemps, startHub, closeAll, rounds, assertKnownAnswer, rig, rigs, runCopies, sumAnswers, outboxLines, spyFiles, standIn, synth,
} from './helpers.js';
import { readdirSync } from 'node:fs';

afterEach(async () => {
  for (const r of rigs) {
    if (r.lastWritten !== undefined && existsSync(r.gspro)) assert.equal(readFileSync(r.gspro, 'utf8'), r.lastWritten, 'GSPro file changed');
  }
  rigs.length = 0;
  await closeAll();
});
after(removeTemps);

// ---- A: a redirect is never followed, and only the hub's own answer counts as sent ----

test('R1. a 301, 302, 303, 307 or 308 is never followed: the second port gets nothing, the batch waits, server=redirect', async () => {
  for (const code of [301, 302, 303, 307, 308]) {
    const outside = await standIn((_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"added":4,"revised":0,"unchanged":0,"conflicts":0}');
    });
    const first = await standIn((_q, res) => {
      res.writeHead(code, { Location: `${outside.url}/stolen` });
      res.end();
    });
    const r = rig(first.url, false);
    const c = r.make();
    r.writeCopy(6);
    await c.tick();
    assert.equal(first.hits.length, 1, `status ${code}: the first port was asked once`);
    assert.equal(outside.hits.length, 0, `status ${code}: nothing reached the second port`);
    assert.equal(c.status().sent, 0);
    assert.ok(c.status().pending > 0);
    assert.equal(c.status().server, 'redirect');
    assert.equal(c.status().retryDelayMs, 1000);
  }
});

test('R2. a 200 that is not the hub\'s four counts adding up to the batch is a wrong answer: nothing marked sent, server=unexpected', async () => {
  const bodies = [
    '',
    '{}',
    '[]',
    'null',
    'not json',
    '{"added":1,"revised":0,"unchanged":0,"conflicts":0}', // copy 6 holds 4 records
    '{"added":9,"revised":0,"unchanged":0,"conflicts":0}',
    '{"added":4,"revised":0,"unchanged":0}',
    '{"added":4.5,"revised":-0.5,"unchanged":0,"conflicts":0}',
    '{"added":5,"revised":-1,"unchanged":0,"conflicts":0}',
    '{"added":"4","revised":0,"unchanged":0,"conflicts":0}',
  ];
  for (const body of bodies) {
    const s = await standIn((_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    });
    const r = rig(s.url, false);
    const c = r.make();
    r.writeCopy(6);
    await c.tick();
    assert.equal(c.status().sent, 0, `body ${JSON.stringify(body)}`);
    assert.ok(c.status().pending > 0);
    assert.equal(c.status().server, 'unexpected', `body ${JSON.stringify(body)}`);
    assert.equal(c.status().retryDelayMs, 1000);
  }
  // and the right answer is believed
  const good = await standIn((_q, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"added":4,"revised":0,"unchanged":0,"conflicts":0}');
  });
  const r = rig(good.url, false);
  const c = r.make();
  r.writeCopy(6);
  await c.tick();
  assert.equal(c.status().sent, 4);
  assert.equal(c.status().server, 'up');
});

// ---- B: one shot is never twice in one post ----

test('R3. a record changed while its first version waits goes in the next post, not the same one', async () => {
  const hubData = tempDir();
  const first = await startHub(hubData);
  await first.hub.close();
  const r = rig(first.url);
  const c = r.make();
  const recs = JSON.parse(JSON.stringify(copies[4]!.records)) as any[];
  r.write(JSON.stringify(recs));
  r.advance(31_000);
  await c.tick();
  const n = recs.length;
  recs[1].HoleShot = recs[1].HoleShot + 1;
  r.write(JSON.stringify(recs));
  r.advance(31_000);
  await c.tick();
  assert.equal(c.status().pending, n + 1);
  assert.equal(r.answers.length, 0);
  const second = await startHub(hubData, first.port);
  r.advance(31_000);
  await c.tick();
  assert.equal(c.status().pending, 0);
  assert.deepEqual(r.posted, [n, 1], 'two posts, the changed record alone in the second');
  assert.equal(sumAnswers(r, 'added'), n);
  assert.equal(sumAnswers(r, 'revised'), 1);
  assert.equal(sumAnswers(r, 'conflicts'), 0);
  const data = await rounds(second.url);
  assert.deepEqual(data.issues, []);
  assert.ok(data.rounds.every((x: any) => x.needsReview === false));
});

// ---- C: GSPro's file is read the way that cannot block a save ----

test('R4. guard: the words copyFile and cpSync appear nowhere under sim/collector/src (and the guard bites)', () => {
  const bad = (text: string): boolean => /copyFile|cpSync/.test(text);
  for (const f of readdirSync(SRC)) assert.equal(bad(readFileSync(join(SRC, f), 'utf8')), false, `${f} uses a whole-file copy`);
  assert.equal(bad('copyFileSync(a, b)'), true);
  assert.equal(bad('fs.cpSync(a, b)'), true);
});

test('R4b. copySource reads GSPro\'s file to the end and saves the same bytes, without changing the file', () => {
  const dir = tempDir();
  const gspro = join(dir, 'currentRound.dat');
  const body = Buffer.alloc(2_500_000, 'abcdefghij\n');
  writeFileSync(gspro, body);
  const f = createFiles(join(dir, 'data'), gspro);
  f.copySource();
  assert.ok(readFileSync(join(dir, 'data', 'copy.dat')).equals(body));
  assert.ok(readFileSync(gspro).equals(body));
  assert.equal(statSync(gspro).size, body.length);
  assert.throws(() => createFiles(join(dir, 'data'), join(dir, 'missing.dat')).copySource());
});

// ---- D: the right default file, and saying what it waits for ----

test('R5a. the default file is currentRound.dat in GSPro inside GSPro under AppData\\LocalLow of the user\'s folder', () => {
  const p = defaultGsproFile({ USERPROFILE: 'home-placeholder' });
  const parts = p.split(sep);
  assert.deepEqual(parts.slice(-5), ['AppData', 'LocalLow', 'GSPro', 'GSPro', 'currentRound.dat']);
  assert.equal(parts[parts.length - 6], 'home-placeholder');
});

test('R5b. a file not seen for 30 seconds becomes file=not-found and the line naming the file is printed again', async () => {
  const dir = tempDir();
  const gspro = join(dir, 'absent', 'currentRound.dat');
  const out: string[] = [];
  const errs: string[] = [];
  let t = 5_000;
  let exit: number | undefined;
  const c = startProgram(
    { SIM_GSPRO_FILE: gspro, SIM_HUB_URL: 'http://127.0.0.1:1', SIM_COLLECTOR_DATA: join(dir, 'data') },
    { log: (l) => out.push(l), error: (l) => errs.push(l), exit: (n) => void (exit = n) },
    { now: () => t, timer: { setInterval: () => 0 as unknown as ReturnType<typeof setInterval>, clearInterval: () => undefined } },
  )!;
  assert.ok(c);
  const naming = (): number => out.filter((l) => l.includes(gspro)).length;
  assert.equal(naming(), 1, 'named once at start');
  await c.tick();
  t += 29_000;
  await c.tick();
  assert.equal(c.status().file, 'waiting');
  assert.equal(naming(), 1);
  t += 2_000;
  await c.tick();
  assert.equal(c.status().file, 'not-found');
  assert.equal(naming(), 2, 'named again');
  await c.tick();
  assert.equal(naming(), 2, 'only once more');
  assert.ok(out.some((l) => l.includes('file=not-found')));
  // when it appears, it is picked up
  mkdirSync(join(dir, 'absent'));
  writeFileSync(gspro, JSON.stringify(copies[2]!.records));
  await c.tick();
  assert.equal(c.status().file, 'ok');
  assert.equal(exit, undefined);
  await c.stop();
});

// ---- E: the outbox is kept small, and a large one still starts ----

test('R6a. two rounds with the tidy-up size small: the outbox ends as one round\'s short lines, known answer, every record added once', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const c = r.make({ tidyOverBytes: 500 });
  await runCopies(r, c, 1, 38);
  assertKnownAnswer(await rounds(url));
  const lines = outboxLines(r);
  assert.ok(lines.length <= 39, `lines ${lines.length}`);
  assert.ok(lines.every((l) => JSON.parse(l).short !== undefined), 'only short lines');
  assert.ok(statSync(join(r.data, 'outbox.jsonl')).size < 39 * 200);
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'revised'), 0);
  assert.equal(sumAnswers(r, 'unchanged'), 0);
  assert.equal(c.status().sent, 41);
  assert.equal(c.status().queued, 41);
});

test('R6b. a restart mid-round after a tidy-up queues nothing twice', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const a = r.make({ tidyOverBytes: 500 });
  await runCopies(r, a, 1, 20);
  assert.ok(outboxLines(r).every((l) => JSON.parse(l).short !== undefined));
  await a.stop();
  const b = r.make({ tidyOverBytes: 500 });
  await runCopies(r, b, 21, 38);
  assertKnownAnswer(await rounds(url));
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'unchanged'), 0);
  assert.equal(b.status().sent, 41);
});

test('R6c. a crash after the first of the two tidy-up writes and before the second loses nothing', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const names = ['sent.json', 'outbox.jsonl'];
  const spy = spyFiles(createFiles(r.data, r.gspro), (m, name, history) => {
    const prev = history[history.length - 1];
    return m === 'writeData' && prev !== undefined && prev[0] === 'writeData' && names.includes(name) && names.includes(prev[1]) && prev[1] !== name;
  });
  const a = r.make({ files: spy.files, tidyOverBytes: 500 });
  let n = 1;
  for (; n <= 38; n++) {
    r.writeCopy(n);
    await a.tick();
    if (a.status().store === 'error') break;
  }
  assert.ok(n <= 38, 'the imitated crash happened');
  await a.stop();
  const b = r.make({ tidyOverBytes: 500 });
  await runCopies(r, b, n, 38);
  assertKnownAnswer(await rounds(url));
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'revised'), 0);
  assert.equal(b.status().pending, 0);
  assert.equal(b.status().store, 'ok');
});

test('R6d. the tidy-up writes the record of what was sent first, then the outbox', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const spy = spyFiles(createFiles(r.data, r.gspro));
  const c = r.make({ files: spy.files, tidyOverBytes: 500 });
  await runCopies(r, c, 1, 8);
  const writes = spy.calls.filter((x) => x[0] === 'writeData').map((x) => String(x[1]));
  const at = writes.indexOf('outbox.jsonl');
  assert.ok(at > 0, 'a tidy-up happened');
  assert.equal(writes[at - 1], 'sent.json');
});

test('R6e. the tidy-up never runs while a record is waiting: a hub outage with a tiny limit loses nothing', async () => {
  const hubData = tempDir();
  const first = await startHub(hubData);
  await first.hub.close();
  const r = rig(first.url);
  const c = r.make({ tidyOverBytes: 1 });
  await runCopies(r, c, 1, 12, 31_000);
  const waiting = c.status().pending;
  assert.ok(waiting > 0);
  assert.ok(outboxLines(r).some((l) => JSON.parse(l).record !== undefined));
  const second = await startHub(hubData, first.port);
  r.advance(31_000);
  await runCopies(r, c, 13, 38, 31_000);
  assertKnownAnswer(await rounds(second.url));
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(c.status().pending, 0);
});

test('R6f. the outbox is read in fixed pieces: lines (and multi-byte letters) straddling pieces come back whole', () => {
  const dir = tempDir();
  const f = createFiles(join(dir, 'data'), join(dir, 'g.dat'));
  f.ensureDataDir();
  const lines = ['alpha', 'béta ☃ gamma', '', 'x'.repeat(300), 'last \u{1F3CC}'];
  f.appendData('o.jsonl', lines.join('\n') + '\n' + 'torn tail');
  for (const piece of [1, 2, 3, 7, 64, 1000]) {
    const seen: string[] = [];
    const res = f.readLines('o.jsonl', piece, (l) => seen.push(l));
    assert.deepEqual(seen, lines, `piece ${piece}`);
    assert.equal(res.tornBytes, Buffer.byteLength('torn tail'));
    assert.equal(res.validBytes, Buffer.byteLength(lines.join('\n') + '\n'));
  }
  assert.deepEqual(f.readLines('missing.jsonl', 10, () => assert.fail('no lines')), { validBytes: 0, tornBytes: 0 });
  f.keepPrefix('o.jsonl', Buffer.byteLength(lines.join('\n') + '\n'));
  assert.equal(f.readData('o.jsonl'), lines.join('\n') + '\n');
});

test('R6g. a collector with a small piece size starts from a full outbox, queues nothing twice and sends nothing again', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const a = r.make();
  await runCopies(r, a, 1, 20);
  await a.stop();
  const b = r.make({ pieceBytes: 50 });
  await runCopies(r, b, 20, 38);
  assertKnownAnswer(await rounds(url));
  assert.equal(outboxLines(r).length, 41);
  assert.equal(sumAnswers(r, 'added'), 41);
  assert.equal(sumAnswers(r, 'unchanged'), 0);
});

// ---- F: the status says why ----

test('R7. 403, 415, 503 (with and without Retry-After) and 500: the status word, the wait, and nothing lost', async () => {
  const rows: Array<[number, number | undefined, string, number]> = [
    [403, undefined, 'refusing-403', 1000],
    [415, undefined, 'refusing-415', 1000],
    [500, undefined, 'refusing-500', 1000],
    [503, undefined, 'busy', 1000],
    [503, 20, 'busy', 20_000],
    [503, 120, 'busy', 30_000],
    [403, 7, 'refusing-403', 7_000],
    [500, 3, 'refusing-500', 3_000],
  ];
  for (const [status, retryAfterSec, word, wait] of rows) {
    const r = rig('http://127.0.0.1:1');
    let calls = 0;
    const c = r.make({
      post: async (): Promise<PostResult> => {
        calls++;
        return { status, body: { error: 'x' }, retryAfterSec };
      },
    });
    r.writeCopy(6);
    await c.tick();
    assert.equal(c.status().server, word, `${status}`);
    assert.equal(c.status().retryDelayMs, wait, `${status} retry-after ${retryAfterSec}`);
    assert.equal(c.status().pending, 4);
    assert.equal(c.status().sent, 0);
    assert.equal(c.status().refused, 0);
    r.advance(wait - 1);
    await c.tick();
    assert.equal(calls, 1, 'waits for the whole delay');
    r.advance(1);
    await c.tick();
    assert.equal(calls, 2);
  }
  // a network error is plain down
  const r = rig('http://127.0.0.1:1');
  const c = r.make({
    post: async () => {
      throw new Error('refused');
    },
  });
  r.writeCopy(6);
  await c.tick();
  assert.equal(c.status().server, 'down');
});

test('R7b. defaultPost reads Retry-After in whole seconds only, and never follows a redirect', async () => {
  const cases: Array<[string | undefined, number | undefined]> = [
    ['20', 20],
    ['0', 0],
    ['1.5', undefined],
    ['-5', undefined],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined],
    ['', undefined],
    [undefined, undefined],
  ];
  for (const [header, want] of cases) {
    const s = await standIn((_q, res) => {
      res.writeHead(503, header === undefined ? {} : { 'Retry-After': header });
      res.end('{"error":"busy"}');
    });
    const out = await defaultPost(`${s.url}/v0/shots`, '{"records":[]}');
    assert.equal(out.status, 503);
    assert.equal(out.retryAfterSec, want, String(header));
  }
  const outside = await standIn((_q, res) => void res.end('{}'));
  const s = await standIn((_q, res) => {
    res.writeHead(307, { Location: `${outside.url}/x` });
    res.end();
  });
  const out = await defaultPost(`${s.url}/v0/shots`, '{"records":[]}');
  assert.equal(out.status, 307);
  assert.equal(outside.hits.length, 0);
});

// ---- G: a cut-short line is said, and an append is on the disk before it counts ----

test('R8a. a cut-short last outbox line is dropped and one fixed line says so', () => {
  const dir = tempDir();
  const data = join(dir, 'data');
  mkdirSync(data);
  const rec = JSON.stringify({ record: copies[2]!.records[0] });
  writeFileSync(join(data, 'outbox.jsonl'), rec + '\n' + rec.slice(0, 40));
  const out: string[] = [];
  const c = startProgram(
    { SIM_GSPRO_FILE: join(dir, 'g.dat'), SIM_HUB_URL: 'http://127.0.0.1:1', SIM_COLLECTOR_DATA: data },
    { log: (l) => out.push(l), error: (l) => out.push(l), exit: () => undefined },
    { timer: { setInterval: () => 0 as unknown as ReturnType<typeof setInterval>, clearInterval: () => undefined } },
  );
  assert.ok(c);
  const said = out.filter((l) => /one unfinished line/.test(l));
  assert.equal(said.length, 1);
  assert.ok(!said[0]!.includes('record') && !said[0]!.includes('ShotID'));
  assert.equal(readFileSync(join(data, 'outbox.jsonl'), 'utf8'), rec + '\n');
});

test('R8b. every outbox append is followed by a flush to the disk before it counts', async () => {
  const { url } = await startHub(tempDir());
  const r = rig(url);
  const spy = spyFiles(createFiles(r.data, r.gspro));
  const c = r.make({ files: spy.files });
  await runCopies(r, c, 1, 38);
  const outboxAppends = spy.calls.filter((x) => (x[0] === 'appendData' || x[0] === 'appendDurable') && x[1] === 'outbox.jsonl');
  assert.ok(outboxAppends.length > 5);
  assert.ok(outboxAppends.every((x) => x[0] === 'appendDurable'), 'the durable append');
  assert.equal(spy.calls.filter((x) => x[0] === 'appendData' && x[1] === 'outbox.jsonl').length, 0);
});

test('R8c. appendDurable appends to the end and keeps what was there', () => {
  const dir = tempDir();
  const f = createFiles(join(dir, 'data'), join(dir, 'g.dat'));
  f.ensureDataDir();
  f.appendDurable('a.jsonl', 'one\n');
  f.appendDurable('a.jsonl', 'two\n');
  assert.equal(f.readData('a.jsonl'), 'one\ntwo\n');
});

// ---- H: messages that cannot cost shots ----

test('H1. a start that fails says to move the data folder aside, never to delete it, and does not say started', () => {
  const dir = tempDir();
  const data = join(dir, 'data');
  mkdirSync(data);
  const bads: Array<[string, string]> = [
    ['outbox.jsonl', 'garbage-line\n'],
    ['sent.json', 'not json'],
    ['sent.json', '{"cursor":5,"sent":5,"refused":0}'],
  ];
  for (const [file, text] of bads) {
    writeFileSync(join(data, file), text);
    if (file === 'sent.json' && text.startsWith('{')) writeFileSync(join(data, 'outbox.jsonl'), '');
    const out: string[] = [];
    let code: number | undefined;
    const c = startProgram(
      { SIM_GSPRO_FILE: join(dir, 'g.dat'), SIM_HUB_URL: 'http://127.0.0.1:1', SIM_COLLECTOR_DATA: data },
      { log: (l) => out.push(l), error: (l) => out.push(l), exit: (n) => void (code = n) },
      { timer: { setInterval: () => 0 as unknown as ReturnType<typeof setInterval>, clearInterval: () => undefined } },
    );
    assert.equal(c, undefined);
    assert.equal(code, 1);
    const all = out.join('\n');
    assert.match(all, /did not start/);
    assert.match(all, /move the data folder aside/);
    assert.doesNotMatch(all, /delete/i);
    assert.doesNotMatch(all, /started/);
    assert.doesNotMatch(all, /garbage-line/);
    writeFileSync(join(data, 'sent.json'), '{"cursor":0,"sent":0,"refused":0}');
    writeFileSync(join(data, 'outbox.jsonl'), '');
  }
});

test('H2. any other failure to start prints the error\'s name and code, never its content; a good start says started after the load', () => {
  const dir = tempDir();
  const base = createFiles(join(dir, 'data'), join(dir, 'g.dat'));
  const broken = {
    ...base,
    ensureDataDir: () => {
      throw Object.assign(new Error('SECRET-CONTENT'), { code: 'EPERM' });
    },
  };
  const out: string[] = [];
  let code: number | undefined;
  const c = startProgram(
    { SIM_GSPRO_FILE: join(dir, 'g.dat'), SIM_HUB_URL: 'http://127.0.0.1:1', SIM_COLLECTOR_DATA: join(dir, 'data') },
    { log: (l) => out.push(l), error: (l) => out.push(l), exit: (n) => void (code = n) },
    { files: broken, timer: { setInterval: () => 0 as unknown as ReturnType<typeof setInterval>, clearInterval: () => undefined } },
  );
  assert.equal(c, undefined);
  assert.equal(code, 1);
  const all = out.join('\n');
  assert.match(all, /Error EPERM/);
  assert.doesNotMatch(all, /SECRET-CONTENT|unknown error|started/);
  const ok: string[] = [];
  const c2 = startProgram(
    { SIM_GSPRO_FILE: join(dir, 'g2.dat'), SIM_HUB_URL: 'http://127.0.0.1:1', SIM_COLLECTOR_DATA: join(dir, 'data2') },
    { log: (l) => ok.push(l), error: (l) => ok.push(l), exit: () => undefined },
    { timer: { setInterval: () => 0 as unknown as ReturnType<typeof setInterval>, clearInterval: () => undefined } },
  );
  assert.ok(c2);
  assert.ok(ok.some((l) => /started/.test(l)));
  assert.ok(ok.some((l) => l.includes(join(dir, 'g2.dat'))));
  assert.ok(ok.every((l) => !/ZZTEST/.test(l)));
  assert.equal(statusLine(c2!.status()).startsWith('copies=0'), true);
});

// ---- I: two guards ----

test('I1. an outbox shorter than the record of what was sent stops the start with a plain message', async () => {
  const r = rig('http://127.0.0.1:1');
  const files = createFiles(r.data, r.gspro);
  files.ensureDataDir();
  const rec = JSON.stringify({ record: copies[2]!.records[0] });
  writeFileSync(join(r.data, 'outbox.jsonl'), rec + '\n' + rec.replace('"ShotID":"', '"ShotID":"x') + '\n');
  writeFileSync(join(r.data, 'sent.json'), JSON.stringify({ cursor: 5, sent: 5, refused: 0 }));
  const c = r.make();
  await assert.rejects(c.tick(), (e: Error) => /shorter than the record of what was sent/.test(e.message) && /move the data folder aside/.test(e.message));
  // the same files with a cursor inside the outbox start fine
  writeFileSync(join(r.data, 'sent.json'), JSON.stringify({ cursor: 2, sent: 2, refused: 0 }));
  const ok = r.make();
  await ok.tick();
  assert.equal(ok.status().pending, 0);
});

test('I2. more than one batch waiting (450 records after a hub outage): all sent in order, in batches of at most 200, none dropped', async () => {
  const hubData = tempDir();
  const first = await startHub(hubData);
  await first.hub.close();
  const r = rig(first.url);
  const c = r.make();
  r.write(JSON.stringify(synth(450)));
  r.advance(31_000);
  await c.tick();
  assert.equal(c.status().pending, 450);
  const second = await startHub(hubData, first.port);
  r.advance(31_000);
  await c.tick();
  assert.deepEqual(r.posted, [200, 200, 50]);
  assert.equal(c.status().pending, 0);
  assert.equal(c.status().sent, 450);
  assert.equal(sumAnswers(r, 'added'), 450);
  const data = await rounds(second.url);
  const round = data.rounds.find((x: any) => x.roundId === 77);
  assert.ok(round);
  assert.equal(round.players.length, 1);
  assert.equal(round.players[0].holes.length, 18);
});
