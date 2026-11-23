import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, UnknownLayoutError, parseRoundFile, formatScorecard, normalisedName } from '../src/index.js';
import type { RoundScore, ShotRecord } from '../src/index.js';

/** A hand-made record. Placeholders only. */
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

function records(list: Array<Record<string, unknown>>): ShotRecord[] {
  return parseRoundFile(JSON.stringify(list));
}

function book(list: Array<Record<string, unknown>>): RoundBook {
  const b = new RoundBook();
  b.ingest(records(list));
  return b;
}

/** Direct input, as a later card might pass it: no parser in between. */
function direct(over: Record<string, unknown> = {}): ShotRecord {
  return rec(over) as unknown as ShotRecord;
}

function nested(n: number): unknown {
  let v: unknown = [];
  for (let i = 1; i < n; i++) v = [v];
  return v;
}

function snapshot(b: RoundBook) {
  return structuredClone({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots });
}

// ---------------------------------------------------------------- A. player numbers

test('Q1. every player line starts with the player number in the round, first seen first, and no id text is printed', () => {
  const b = book([
    rec({ ShotID: 'a', UserGuid: 'SECRETID-1', PlayerName: 'ZZTEST-B', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'b', UserGuid: 'SECRETID-2', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'c', UserGuid: 'SECRETID-3', PlayerName: 'ZZTEST-A', HoleShot: 5, HoleResult: 7, RoundID: 2 }),
  ]);
  assert.deepEqual(b.rounds().map((r) => r.players.map((p) => p.playerNumber)), [[1, 2], [1]]);
  const lines = formatScorecard(b).split('\n');
  assert.equal(lines[1], 'P1 ZZTEST-B  hole 1: 3  total 3');
  assert.equal(lines[2], 'P2 ZZTEST-A  hole 1: 4  total 4');
  assert.equal(lines[4], 'P1 ZZTEST-A  hole 1: 5  total 5', 'numbers restart in each round');
  assert.ok(!formatScorecard(b).includes('SECRETID'));
});

test('Q2. two players with one name print different lines, and nothing slows down with long ids', () => {
  const players = Array.from({ length: 2000 }, (_, i) => ({
    userGuid: `${'x'.repeat(5000)}${i}`,
    name: 'ZZTEST-A',
    holes: [],
    total: 0,
    needsReview: false,
    playerNumber: i + 1,
  }));
  const round: RoundScore = { roundId: 1, courseKey: 'c', courseKeys: ['c'], needsReview: true, players };
  const t0 = Date.now();
  const text = formatScorecard([round]);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `formatting took ${ms} ms`);
  const lines = text.split('\n').slice(1);
  assert.equal(lines.length, 2000);
  assert.equal(new Set(lines).size, 2000);
  assert.ok(text.length < 200_000, 'no part of the ids is printed');
});

// ---------------------------------------------------------------- B. same name to the eye

test('N1. normalisedName cleans, folds compatibility forms, collapses spaces, trims and lower-cases', () => {
  const n = normalisedName;
  assert.equal(n('ZZTEST-A'), 'zztest-a');
  assert.equal(n('  ZZTEST-A  '), 'zztest-a');
  assert.equal(n('ZZTEST-A '), 'zztest-a');
  assert.equal(n('ZZ  TEST\t-A'), 'zz test -a');
  assert.equal(n('ZZTEST-A\u0001'), 'zztest-a');
  assert.equal(n('ＺＺＴＥＳＴ-Ａ'), 'zztest-a', 'full-width letters');
  assert.equal(n('ZZTEST-A'), n('zztest-a'));
  assert.notEqual(n('ZZTEST-A'), n('ZZTEST-B'));
  // a Cyrillic A is a different letter: the rule does not claim to catch it
  assert.notEqual(n('ZZTEST-A'), n('ZZTEST-А'));
});

test('N2b. names that look the same flag the round; different alphabets are told apart by the player number', () => {
  const lookAlike = ['ZZTEST-A ', 'ZZTEST-A ', 'zztest-a', 'ZZTEST-A\u0001', ' ZZTEST-A', 'ZZTEST-A '];
  for (const other of lookAlike) {
    const b = book([
      rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 6, HoleResult: 7 }),
      rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: other, HoleShot: 3, HoleResult: 7 }),
    ]);
    assert.equal(b.rounds()[0]!.needsReview, true, JSON.stringify(other));
    assert.match(formatScorecard(b).split('\n')[0]!, /\(needs review\)$/);
  }
  const cyr = book([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 6, HoleResult: 7 }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'ZZTEST-А', HoleShot: 3, HoleResult: 7 }),
  ]);
  const lines = formatScorecard(cyr).split('\n');
  assert.ok(lines[1]!.startsWith('P1 '));
  assert.ok(lines[2]!.startsWith('P2 '));
  assert.notEqual(lines[1], lines[2]);
  // different names are not flagged
  assert.equal(book([rec({ ShotID: 'a', UserGuid: 'g1', PlayerName: 'ZZTEST-A' }), rec({ ShotID: 'b', UserGuid: 'g2', PlayerName: 'ZZTEST-B' })]).rounds()[0]!.needsReview, false);
});

// ---------------------------------------------------------------- C. ingest checks the layout

test('C5. records given straight to ingest are checked like file records, and a refusal leaves the book as it was', () => {
  const bad: Array<[string, unknown, string]> = [
    ['HoleResult as text', direct({ HoleResult: '7' }), 'HoleResult'],
    ['RoundID as text', direct({ RoundID: '-1' }), 'RoundID'],
    ['no ShotID', (() => { const r = rec(); delete r['ShotID']; return r as unknown as ShotRecord; })(), 'ShotID'],
    ['empty ShotID', direct({ ShotID: '' }), 'ShotID'],
    ['UserGuid a number', direct({ UserGuid: 5 }), 'UserGuid'],
    ['Hole out of range', direct({ Hole: 100 }), 'Hole'],
    ['HoleShot 0', direct({ HoleShot: 0 }), 'HoleShot'],
    ['HoleShot 1.5', direct({ HoleShot: 1.5 }), 'HoleShot'],
  ];
  for (const [label, bad1, field] of bad) {
    const b = book([rec({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 })]);
    const before = snapshot(b);
    assert.throws(
      () => b.ingest([direct({ ShotID: 'new', Hole: 3 }), direct({ ShotID: 'h1', HoleShot: 5, HoleResult: 7 }), bad1 as ShotRecord]),
      (e: unknown) => e instanceof UnknownLayoutError && e.message.includes(field),
      label,
    );
    assert.deepEqual(snapshot(b), before, label);
  }
  for (const notObject of [null, undefined, 5, 'x', [1]]) {
    const b = new RoundBook();
    assert.throws(() => b.ingest([notObject as unknown as ShotRecord]), UnknownLayoutError, JSON.stringify(notObject));
    assert.equal(b.rounds().length, 0);
  }
  // a good record given directly still works
  const ok = new RoundBook();
  assert.deepEqual(ok.ingest([direct({ HoleShot: 4, HoleResult: 7 })]), { added: 1, revised: 0, unchanged: 0, conflicts: 0 });
});

// ---------------------------------------------------------------- D. the walk visits each object once

test('D4. a graph with shared references is walked in time proportional to its size', () => {
  let g: unknown[] = [];
  for (let i = 0; i < 25; i++) g = [g, g];
  const r = { ...rec(), G: g } as unknown as ShotRecord;
  const t0 = Date.now();
  assert.equal(new RoundBook().ingest([r]).added, 1);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  // shared references too deep are refused quickly, not after 2^depth steps
  let tooDeep: unknown[] = [];
  for (let i = 0; i < 40; i++) tooDeep = [tooDeep, tooDeep];
  const t1 = Date.now();
  assert.throws(() => new RoundBook().ingest([{ ...rec(), G: tooDeep } as unknown as ShotRecord]), UnknownLayoutError);
  assert.ok(Date.now() - t1 < 1000, `took ${Date.now() - t1} ms`);
});

test('D5. a path that is deeper than the first one found is still refused', () => {
  const deep = nested(31); // 31 levels
  // the first path reaches `deep` at level 2 (total 32, allowed); the second at level 4 (total 34)
  const r = { ...rec(), A: deep, B: [[deep]] } as unknown as ShotRecord;
  assert.throws(() => new RoundBook().ingest([r]), UnknownLayoutError);
  const fine = { ...rec(), A: deep, B: deep } as unknown as ShotRecord;
  assert.equal(new RoundBook().ingest([fine]).added, 1);
});

test('D6. a cycle is refused with UnknownLayoutError', () => {
  const loop: Record<string, unknown> = { a: 1 };
  loop['self'] = loop;
  const b = new RoundBook();
  assert.throws(() => b.ingest([{ ...rec(), G: loop } as unknown as ShotRecord]), (e: unknown) => e instanceof UnknownLayoutError && /itself|cycle/.test(e.message));
  const arr: unknown[] = [];
  arr.push([arr]);
  assert.throws(() => b.ingest([{ ...rec(), G: arr } as unknown as ShotRecord]), UnknownLayoutError);
  assert.equal(b.rounds().length, 0);
});

// ---------------------------------------------------------------- E. text length limits

test('E1. ShotID and UserGuid are at most 128 characters, PlayerName and CourseKey at most 256', () => {
  const limits: Array<[string, number]> = [['ShotID', 128], ['UserGuid', 128], ['PlayerName', 256], ['CourseKey', 256]];
  for (const [field, max] of limits) {
    assert.equal(parseRoundFile(JSON.stringify([rec({ [field]: 'x'.repeat(max) })])).length, 1, `${field} at ${max}`);
    assert.throws(
      () => parseRoundFile(JSON.stringify([rec({ [field]: 'x'.repeat(max + 1) })])),
      (e: unknown) => e instanceof UnknownLayoutError && e.message.includes(`field ${field}`),
      `${field} at ${max + 1}`,
    );
    assert.throws(
      () => new RoundBook().ingest([direct({ [field]: 'x'.repeat(max + 1) })]),
      (e: unknown) => e instanceof UnknownLayoutError && e.message.includes(`field ${field}`),
      `ingest ${field}`,
    );
  }
});

// ---------------------------------------------------------------- G. repeats in one call

test('N2c. a repeat in one call under another UserGuid or RoundID is a conflict even when the strokes are the same', () => {
  const first = rec({ ShotID: 'x', HoleShot: 4, HoleResult: 7 });
  const cases: Array<[string, Record<string, unknown>]> = [
    ['another UserGuid', rec({ ShotID: 'x', UserGuid: 'guid-2', HoleShot: 4, HoleResult: 7 })],
    ['another RoundID', rec({ ShotID: 'x', RoundID: 2, HoleShot: 4, HoleResult: 7 })],
    ['another PlayerName', rec({ ShotID: 'x', PlayerName: 'ZZTEST-B', HoleShot: 4, HoleResult: 7 })],
  ];
  for (const [label, repeat] of cases) {
    const b = new RoundBook();
    const counts = b.ingest(records([first, repeat]));
    assert.deepEqual(counts, { added: 1, revised: 0, unchanged: 0, conflicts: 1 }, label);
    assert.equal(b.issues().length, 1, label);
    assert.equal(b.issues()[0]!.kind, 'duplicate_shot_in_copy', label);
  }
});

test('N24. a repeat under another round marks the round that keeps the score as well as the round that was claimed', () => {
  const b = new RoundBook();
  b.ingest(records([
    rec({ ShotID: 'x', RoundID: 1, HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'x', RoundID: 2, HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'other', RoundID: 2, HoleShot: 3, HoleResult: 7 }),
  ]));
  const rounds = b.rounds();
  assert.equal(rounds.find((r) => r.roundId === 1)!.needsReview, true, 'the round that keeps the shot');
  assert.equal(rounds.find((r) => r.roundId === 2)!.needsReview, true, 'the round that was claimed');
  assert.equal(rounds.find((r) => r.roundId === 1)!.players[0]!.total, 4);
});

test('N20. a repeat in one call is checked like any record: a deep or malformed repeat throws', () => {
  const first = direct({ ShotID: 'x', HoleShot: 4, HoleResult: 7 });
  const deepRepeat = { ...rec({ ShotID: 'x', HoleShot: 4, HoleResult: 7 }), G: nested(1000) } as unknown as ShotRecord;
  const b = new RoundBook();
  assert.throws(() => b.ingest([first, deepRepeat]), UnknownLayoutError);
  assert.equal(b.rounds().length, 0, 'nothing was applied');
  const badRepeat = direct({ ShotID: 'x', HoleResult: '7' });
  assert.throws(() => b.ingest([first, badRepeat]), UnknownLayoutError);
  assert.equal(b.rounds().length, 0);
});

test('H1. the README states the limits on a corrupt copy and on look-alike names', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(text, /single corrupt or crafted copy can flag many rounds/);
  assert.match(text, /different alphabets that only look alike are not detected/);
  assert.match(text, /player's number in the round/);
});
