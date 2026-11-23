import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RoundBook, UnknownLayoutError, parseRoundFile, formatScorecard } from '../src/index.js';
import { loadRecording, type Copy } from '../src/recording.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');
const copies: Copy[] = loadRecording(FIXTURE_DIR);

function readText(p: string): string {
  return readFileSync(p, 'utf8');
}

function replay(book: RoundBook, upTo = copies.length) {
  const counts: Array<{ added: number; revised: number; unchanged: number; conflicts: number }> = [];
  for (const c of copies.slice(0, upTo)) counts.push(book.ingest(c.records));
  return counts;
}

function replayed(upTo = copies.length): RoundBook {
  const b = new RoundBook();
  replay(b, upTo);
  return b;
}

function round(book: RoundBook, id: number) {
  const r = book.rounds().find((x) => x.roundId === id);
  assert.ok(r, `round ${id} present`);
  return r;
}
function player(book: RoundBook, id: number, name: string) {
  const p = round(book, id).players.find((x) => x.name === name);
  assert.ok(p, `${name} in round ${id}`);
  return p;
}
function holeOf(p: ReturnType<typeof player>, n: number) {
  const h = p.holes.find((x) => x.hole === n);
  assert.ok(h, `hole ${n}`);
  return h;
}

test('1. replaying the 38 copies gives the known scorecard', () => {
  const book = replayed();
  const r19 = round(book, 19);
  assert.equal(r19.courseKey, 'bluejack_gsp');
  const a = player(book, 19, 'ZZTEST-A');
  assert.deepEqual(
    a.holes.map((h) => [h.hole, h.status, h.strokes]),
    [[3, 'finished', 6], [12, 'finished', 4], [15, 'finished', 8]],
  );
  assert.equal(a.total, 18);
  const b = player(book, 19, 'ZZTEST-B');
  assert.deepEqual(
    b.holes.map((h) => [h.hole, h.status, h.strokes]),
    [[3, 'finished', 5], [12, 'finished', 5], [15, 'finished', 10]],
  );
  assert.equal(b.total, 20);
  for (const name of ['ZZTEST-A', 'ZZTEST-B']) {
    const p = player(book, 18, name);
    assert.equal(p.holes.length, 1);
    const h = holeOf(p, 1);
    assert.equal(h.status, 'in_play');
    assert.equal(h.strokes, null);
    assert.equal(h.strokesSoFar, 1);
    assert.equal(p.total, 0);
  }
});

test('2. replaying all 38 copies a second time changes nothing', () => {
  const book = replayed();
  const before = structuredClone(book.rounds());
  const counts = replay(book);
  assert.equal(counts.length, 38);
  for (const c of counts) {
    assert.equal(c.added, 0);
    assert.equal(c.revised, 0);
    assert.ok(c.unchanged > 0);
  }
  assert.deepEqual(book.rounds(), before);
});

test('3. feeding one copy twice changes nothing', () => {
  const book = new RoundBook();
  const c = copies[10]!;
  const first = book.ingest(c.records);
  const snapshot = structuredClone(book.rounds());
  const second = book.ingest(c.records);
  assert.equal(first.added, c.records.length);
  assert.deepEqual(second, { added: 0, revised: 0, unchanged: c.records.length, conflicts: 0 });
  assert.deepEqual(book.rounds(), snapshot);
});

test('4. after copy 6 both players hole 3 is in play with no score', () => {
  const book = replayed(6);
  for (const name of ['ZZTEST-A', 'ZZTEST-B']) {
    const h = holeOf(player(book, 19, name), 3);
    assert.equal(h.status, 'in_play');
    assert.equal(h.strokes, null);
    assert.ok(h.strokesSoFar >= 1);
  }
});

test('5. records are not counted: player A hole 12 has five records and scores 4', () => {
  const book = replayed();
  const a = player(book, 19, 'ZZTEST-A');
  const all = copies[copies.length - 1]!.records;
  const n = all.filter((r) => r.UserGuid === a.userGuid && r.RoundID === 19 && r.Hole === 11).length;
  assert.equal(n, 5);
  assert.equal(holeOf(a, 12).strokes, 4);
});

test('6. same names in the two rounds have different ids and stay separate', () => {
  const book = replayed();
  for (const name of ['ZZTEST-A', 'ZZTEST-B']) {
    const p18 = player(book, 18, name);
    const p19 = player(book, 19, name);
    assert.notEqual(p18.userGuid, p19.userGuid);
    assert.equal(p18.total, 0);
  }
  assert.equal(round(book, 18).players.length, 2);
  assert.equal(round(book, 19).players.length, 2);
});

test('7. a record missing HoleResult throws UnknownLayoutError; so does a non-array', () => {
  const rec = { ...copies[0]!.records[0]! } as Record<string, unknown>;
  delete rec['HoleResult'];
  assert.throws(
    () => parseRoundFile(JSON.stringify([rec])),
    (e: unknown) => e instanceof UnknownLayoutError && /HoleResult/.test((e as Error).message),
  );
  assert.throws(() => parseRoundFile('{"a":1}'), UnknownLayoutError);
  assert.throws(() => parseRoundFile('not json'), UnknownLayoutError);
  const bad = { ...copies[0]!.records[0]!, Hole: '3' };
  assert.throws(() => parseRoundFile(JSON.stringify([bad])), /Hole/);
  assert.throws(() => parseRoundFile('x'.repeat(50_000_001)), /50000000/);
  assert.throws(() => parseRoundFile(JSON.stringify(new Array(20_001).fill({}))), /20000/);
  // a leading byte-order mark is accepted
  assert.equal(parseRoundFile('﻿' + JSON.stringify([copies[0]!.records[0]])).length, 1);
});

test('8. a record re-sent with a different HoleShot is revised and replaces the first', () => {
  const book = new RoundBook();
  const rec = copies[0]!.records[0]!;
  book.ingest([rec]);
  const changed = { ...rec, HoleShot: rec.HoleShot + 3 };
  const counts = book.ingest([changed]);
  assert.deepEqual(counts, { added: 0, revised: 1, unchanged: 0, conflicts: 0 });
  const h = holeOf(book.rounds()[0]!.players[0]!, rec.Hole + 1);
  assert.equal(h.strokesSoFar, rec.HoleShot + 3);
});

test('9. the recorded files hold only the two test names, no @ and no drive-letter path', () => {
  const names = new Set<string>();
  for (const c of copies) for (const r of c.records) names.add(r.PlayerName);
  assert.deepEqual([...names].sort(), ['ZZTEST-A', 'ZZTEST-B']);
  for (const f of ['round18-final.dat', 'round19-final.dat']) {
    const raw = readText(join(FIXTURE_DIR, f));
    assert.ok(!raw.includes('@'), `${f} has no @`);
    assert.ok(!/[A-Za-z]:[\\/]/.test(raw), `${f} has no drive path`);
  }
});

test('10. captures.json is sound', () => {
  const j = JSON.parse(readText(join(FIXTURE_DIR, 'captures.json'))) as {
    captures: Array<{ number: number; time: string; round: number; records: number }>;
  };
  const caps = j.captures;
  assert.equal(caps.length, 38);
  caps.forEach((c, i) => assert.equal(c.number, i + 1));
  for (const r of [18, 19]) {
    const inRound = caps.filter((c) => c.round === r);
    assert.ok(inRound.length > 0);
    for (let i = 1; i < inRound.length; i++) assert.ok(inRound[i]!.records >= inRound[i - 1]!.records);
  }
  const last = (r: number) => caps.filter((c) => c.round === r).at(-1)!.records;
  assert.equal(last(18), 2);
  assert.equal(last(19), 39);
  assert.equal(parseRoundFile(readText(join(FIXTURE_DIR, 'round18-final.dat'))).length, 2);
  assert.equal(parseRoundFile(readText(join(FIXTURE_DIR, 'round19-final.dat'))).length, 39);
  for (const c of caps) assert.match(c.time, /^\d{6}_\d{3}$/);
});

test('formatter prints the example lines', () => {
  const text = formatScorecard(replayed());
  assert.match(text, /^Round 18 {2}bluejack_gsp$/m);
  assert.match(text, /^Round 19 {2}bluejack_gsp$/m);
  assert.match(text, /^P1 ZZTEST-A {2}hole 3: 6 {2}hole 12: 4 {2}hole 15: 8 {2}total 18$/m);
  assert.match(text, /^P2 ZZTEST-B {2}hole 3: 5 {2}hole 12: 5 {2}hole 15: 10 {2}total 20$/m);
  assert.match(text, /hole 1: in play \(1 stroke\)/);
});
