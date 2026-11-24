import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoundBook, UnknownLayoutError, parseRoundFile, formatScorecard, normalisedName } from '../src/index.js';
import type { RoundScore, ShotRecord } from '../src/index.js';

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ShotID: 'shot-1',
    UserGuid: 'guid-1',
    PlayerName: 'ZZTEST-A',
    CourseKey: 'test_course',
    RoundID: 1,
    Hole: 0,
    HoleShot: 1,
    HolePar: 4,
    HoleResult: 0,
    ShotResult: 0,
    ...over,
  };
}

function book(list: Array<Record<string, unknown>>): RoundBook {
  const b = new RoundBook();
  b.ingest(parseRoundFile(JSON.stringify(list)));
  return b;
}

function direct(over: Record<string, unknown> = {}): ShotRecord {
  return rec(over) as unknown as ShotRecord;
}

function snapshot(b: RoundBook) {
  return structuredClone({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots });
}

// ---------------------------------------------------------------- A. Mv and Mf

test('Mv. two players with one name who are both still in play flag the round', () => {
  const b = book([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 1 }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'ZZTEST-A', HoleShot: 1 }),
  ]);
  assert.deepEqual(b.rounds()[0]!.players.map((p) => p.total), [0, 0]);
  assert.equal(b.rounds()[0]!.needsReview, true);
  assert.match(formatScorecard(b).split('\n')[0]!, /\(needs review\)$/);
});

test('Mf. each printed line carries its own playerNumber, whatever order the players are given in', () => {
  const players = [
    { playerNumber: 2, userGuid: 'g2', name: 'ZZTEST-B', holes: [], total: 3, needsReview: false },
    { playerNumber: 1, userGuid: 'g1', name: 'ZZTEST-A', holes: [], total: 6, needsReview: false },
    { playerNumber: 7, userGuid: 'g7', name: 'ZZTEST-C', holes: [], total: 1, needsReview: false },
  ];
  const round: RoundScore = { roundId: 1, courseKey: 'c', courseKeys: ['c'], needsReview: false, players };
  const lines = formatScorecard([round]).split('\n');
  assert.equal(lines[1], 'P2 ZZTEST-B | total 3');
  assert.equal(lines[2], 'P1 ZZTEST-A | total 6');
  assert.equal(lines[3], 'P7 ZZTEST-C | total 1');
  // and the same through a real book, sorted by total as a leaderboard would
  const b = book([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 6, HoleResult: 7 }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B', HoleShot: 3, HoleResult: 7 }),
  ]);
  const sorted = b.rounds().map((r) => ({ ...r, players: [...r.players].sort((x, y) => x.total - y.total) }));
  const out = formatScorecard(sorted).split('\n');
  assert.ok(out[1]!.startsWith('P2 ZZTEST-B | '));
  assert.ok(out[2]!.startsWith('P1 ZZTEST-A | '));
});

// ---------------------------------------------------------------- B. the book keeps its own plain copy

test('B1. a change the caller makes to its object after ingest does not alter what the book holds', () => {
  const r = direct({ HoleShot: 4, HoleResult: 7 });
  const b = new RoundBook();
  b.ingest([r]);
  const before = snapshot(b);
  (r as Record<string, unknown>)['HoleShot'] = 'nine';
  (r as Record<string, unknown>)['PlayerName'] = 'CHANGED';
  assert.deepEqual(snapshot(b), before);
  assert.equal(b.rounds()[0]!.players[0]!.total, 4);
  // and the same record fed again is seen as a change of content, not compared with the caller's own object
  assert.equal(b.ingest([direct({ HoleShot: 4, HoleResult: 7 })]).unchanged, 1);
});

test('B2. a getter that throws, a value JSON cannot hold and a non-array are UnknownLayoutError, and the book is unchanged', () => {
  const b = new RoundBook();
  b.ingest([direct({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 })]);
  const before = snapshot(b);
  const thrower = direct({ ShotID: 'g' });
  Object.defineProperty(thrower, 'PlayerName', { enumerable: true, get() { throw new Error('boom'); } });
  const withBigInt = { ...rec({ ShotID: 'big' }), G: 10n } as unknown as ShotRecord;
  const bad: Array<[string, () => unknown]> = [
    ['getter that throws', () => b.ingest([direct({ ShotID: 'new' }), thrower])],
    ['bigint', () => b.ingest([direct({ ShotID: 'new' }), withBigInt])],
    ['undefined', () => b.ingest(undefined as unknown as ShotRecord[])],
    ['not an array', () => b.ingest({ length: 1 } as unknown as ShotRecord[])],
    ['undefined record', () => b.ingest([undefined as unknown as ShotRecord])],
  ];
  for (const [label, run] of bad) {
    assert.throws(run, (e: unknown) => e instanceof UnknownLayoutError, label);
    assert.deepEqual(snapshot(b), before, label);
  }
});

test('B3. a field supplied by the prototype, a symbol key and a Map are not part of what the book holds', () => {
  const proto = { HoleResult: 7 };
  const noOwn = Object.create(proto) as Record<string, unknown>;
  Object.assign(noOwn, rec({ ShotID: 'p' }));
  delete noOwn['HoleResult'];
  assert.throws(() => new RoundBook().ingest([noOwn as unknown as ShotRecord]), (e: unknown) => e instanceof UnknownLayoutError && e.message.includes('HoleResult'));
  // a symbol key holding a very deep chain, and a very deep Map: ignored, no RangeError, on the first read or the second
  let chain: unknown[] = [];
  for (let i = 0; i < 20_000; i++) chain = [chain];
  let deepMap: Map<string, unknown> = new Map();
  for (let i = 0; i < 20_000; i++) deepMap = new Map([['k', deepMap]]);
  const odd = { ...rec({ ShotID: 'odd', HoleShot: 2, HoleResult: 7 }), [Symbol('s')]: chain, M: deepMap } as unknown as ShotRecord;
  const b = new RoundBook();
  assert.equal(b.ingest([odd]).added, 1);
  assert.equal(b.ingest([odd]).unchanged, 1);
  assert.equal(b.rounds()[0]!.players[0]!.total, 2);
});

test('B4. an object reached a second time (a shared reference or a cycle) is refused with UnknownLayoutError, fast', () => {
  const shared = [1];
  assert.throws(() => new RoundBook().ingest([{ ...rec(), A: shared, B: shared } as unknown as ShotRecord]), UnknownLayoutError);
  let g: unknown[] = [];
  for (let i = 0; i < 25; i++) g = [g, g];
  const t0 = Date.now();
  assert.throws(() => new RoundBook().ingest([{ ...rec(), G: g } as unknown as ShotRecord]), UnknownLayoutError);
  assert.ok(Date.now() - t0 < 1000);
  const loop: Record<string, unknown> = { a: 1 };
  loop['self'] = loop;
  assert.throws(() => new RoundBook().ingest([{ ...rec(), G: loop } as unknown as ShotRecord]), UnknownLayoutError);
  // two records of one call may share a nested object (each record is walked and copied by itself); equal but separate objects are fine too
  assert.equal(new RoundBook().ingest([{ ...rec({ ShotID: 'x' }), A: shared } as unknown as ShotRecord, { ...rec({ ShotID: 'y' }), A: shared } as unknown as ShotRecord]).added, 2);
  assert.equal(new RoundBook().ingest([{ ...rec(), A: [1], B: [1] } as unknown as ShotRecord]).added, 1);
  // nothing from a file is refused by this: parsed records never share objects
  assert.equal(parseRoundFile(JSON.stringify([{ ...rec(), A: [1], B: [1] }])).length, 1);
});

// ---------------------------------------------------------------- C. names compared as a reader would

test('C1. the name comparison drops format characters, treats every dash as a hyphen and ignores accents', () => {
  const n = normalisedName;
  assert.equal(n('ZZTEST​-A'), n('ZZTEST-A'), 'zero-width space');
  assert.equal(n('ZZTEST‍-A'), n('ZZTEST-A'), 'zero-width joiner');
  assert.equal(n('ZZ­TEST-A'), n('ZZTEST-A'), 'soft hyphen');
  assert.equal(n('ZZTEST﻿-A'), n('ZZTEST-A'), 'byte-order mark');
  for (const dash of ['‐', '‑', '‒', '–', '—', '−', '﹣', '－']) {
    assert.equal(n(`ZZTEST${dash}A`), n('ZZTEST-A'), `dash U+${dash.charCodeAt(0).toString(16)}`);
  }
  assert.equal(n('Zoë-Test'), n('Zoe-Test'), 'accent');
  assert.equal(n('Zoë-Test'), n('Zoe-Test'), 'combining mark');
  assert.equal(n('Zoë-Test'), n('Zoë-Test'));
  assert.equal(n('ZZTEST​–A'), n('ZZTEST-A'));
  // not claimed: another alphabet, and a different letter
  assert.notEqual(n('ZZTEST-A'), n('ZZTEST-А'));
  assert.notEqual(n('ZZTEST-A'), n('ZZTEST-B'));
  assert.notEqual(n('ZZTEST A'), n('ZZTESTA'), 'an inner space is still a space');
});

test('C2. players whose names differ only in invisible marks, dashes or accents flag the round; the printed name is unchanged', () => {
  for (const other of ['ZZTEST​-A', 'ZZ­TEST-A', 'ZZTEST–A', 'ZZTEST−A', 'ZZTÉST-A']) {
    const b = book([
      rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 6, HoleResult: 7 }),
      rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: other, HoleShot: 3, HoleResult: 7 }),
    ]);
    assert.equal(b.rounds()[0]!.needsReview, true, JSON.stringify(other));
    assert.equal(b.rounds()[0]!.players[1]!.name, other, 'rounds() keeps the name as the file had it');
  }
  const accent = book([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'Zoë-Test' }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'Zoë-Test' }),
  ]);
  assert.equal(accent.rounds()[0]!.needsReview, true);
  assert.equal(book([rec({ ShotID: 'a', UserGuid: 'g1', PlayerName: 'ZZTEST-A' }), rec({ ShotID: 'b', UserGuid: 'g2', PlayerName: 'ZZTEST-B' })]).rounds()[0]!.needsReview, false);
});

// ---------------------------------------------------------------- D. a name cannot pose as scores

test('D1. the formatter puts a bar between the name and the scores, and no bar from the file reaches the output', () => {
  const b = book([rec({ PlayerName: 'ZZTEST-B | hole 1: 2  hole 2: 3  total 5 |', CourseKey: 'c|d', HoleShot: 9, HoleResult: 7 })]);
  const [heading, line] = formatScorecard(b).split('\n');
  assert.equal(heading, 'Round 1  c d');
  assert.equal(line!.split('|').length, 2, 'exactly one bar on the line');
  assert.ok(line!.startsWith('P1 ZZTEST-B   hole 1: 2  hole 2: 3  total 5   | hole 1: 9  total 9'), line);
  assert.equal(b.rounds()[0]!.players[0]!.name, 'ZZTEST-B | hole 1: 2  hole 2: 3  total 5 |', 'rounds() keeps the name');
  assert.equal(formatScorecard(book([rec({ HoleShot: 4, HoleResult: 7 })])).split('\n')[1], 'P1 ZZTEST-A | hole 1: 4  total 4');
});

test('D2. the README example shows the bar', () => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../README.md'), 'utf8');
  assert.match(text, /P1 ZZTEST-A \| hole 3: 6/);
});

// ---------------------------------------------------------------- F. limits stated in the README

test('F1. the README states the three limits', () => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(text, /first-seen order within one book/);
  assert.match(text, /checked twice per read/);
  assert.match(text, /joined emoji prints with spaces between the parts/);
  assert.match(text, /records refused/);
});
