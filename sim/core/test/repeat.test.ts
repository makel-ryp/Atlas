import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, parseRoundFile, formatScorecard } from '../src/index.js';
import type { ShotRecord } from '../src/index.js';

/** A hand-made record. Placeholders only. */
function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ShotID: 'x',
    UserGuid: 'guid-1',
    PlayerName: 'ZZTEST-A',
    CourseKey: 'test_course',
    RoundID: 1,
    Hole: 0,
    HoleShot: 5,
    HolePar: 4,
    HoleResult: 7,
    ShotResult: 0,
    ...over,
  };
}

function records(list: Array<Record<string, unknown>>): ShotRecord[] {
  return parseRoundFile(JSON.stringify(list));
}

const five = rec({ HoleShot: 5 });
const four = rec({ HoleShot: 4 });
const score = (b: RoundBook) => b.rounds()[0]!.players[0]!.holes[0]!.strokes;

test('T1. the book holds x finishing 5; one call brings that record and then x finishing 4: the score stays 5, one conflict, issue recorded, round flagged', () => {
  const b = new RoundBook();
  b.ingest(records([five]));
  const counts = b.ingest(records([five, four]));
  assert.deepEqual(counts, { added: 0, revised: 0, unchanged: 1, conflicts: 1 });
  assert.equal(score(b), 5);
  assert.deepEqual(b.issues(), [{ kind: 'duplicate_shot_in_copy', roundId: 1, shotId: 'x' }]);
  assert.equal(b.rounds()[0]!.needsReview, true);
  assert.match(formatScorecard(b).split('\n')[0]!, /\(needs review\)$/);
});

test('T2. the same call made again gives the same result: the score is still 5', () => {
  const b = new RoundBook();
  b.ingest(records([five]));
  const call = records([five, four]);
  for (let i = 0; i < 3; i++) {
    const counts = b.ingest(call);
    assert.deepEqual(counts, { added: 0, revised: 0, unchanged: 1, conflicts: 1 }, `call ${i + 1}`);
    assert.equal(score(b), 5, `call ${i + 1}`);
  }
  assert.equal(b.issues().length, 1);
});

test('T3. a fresh book reading one such file twice shows 5 both times and a conflict both times', () => {
  const file = JSON.stringify([five, four]);
  const b = new RoundBook();
  const first = b.ingest(parseRoundFile(file));
  assert.equal(score(b), 5);
  const second = b.ingest(parseRoundFile(file));
  assert.equal(score(b), 5);
  assert.equal(first.conflicts, 1);
  assert.equal(second.conflicts, 1);
  assert.equal(b.rounds()[0]!.needsReview, true);
  // and the file that starts from a book that already holds the first record
  const c = new RoundBook();
  c.ingest(records([five]));
  assert.equal(c.ingest(parseRoundFile(file)).conflicts, 1);
  assert.equal(c.ingest(parseRoundFile(file)).conflicts, 1);
  assert.equal(score(c), 5);
});

test('T4. a differing repeat is a conflict whether the first in the call was added, revised or unchanged', () => {
  const cases: Array<[string, Array<Record<string, unknown>>, Array<Record<string, unknown>>, number]> = [
    ['added', [], [five, four], 5],
    ['revised', [rec({ HoleShot: 3 })], [five, four], 5],
    ['unchanged', [five], [five, four], 5],
  ];
  for (const [label, held, call, expected] of cases) {
    const b = new RoundBook();
    if (held.length > 0) b.ingest(records(held));
    const counts = b.ingest(records(call));
    assert.equal(counts.conflicts, 1, label);
    assert.equal(counts.added + counts.revised + counts.unchanged, 1, `${label}: the repeat is counted only as a conflict`);
    assert.equal(counts[label as 'added' | 'revised' | 'unchanged'], 1, label);
    assert.equal(score(b), expected, label);
    assert.deepEqual(b.issues(), [{ kind: 'duplicate_shot_in_copy', roundId: 1, shotId: 'x' }], label);
    assert.equal(b.rounds()[0]!.needsReview, true, label);
  }
});

test('T5. three versions of one ShotID in one call: the first is kept and there are two conflicts', () => {
  const b = new RoundBook();
  const counts = b.ingest(records([five, four, rec({ HoleShot: 6 })]));
  assert.deepEqual(counts, { added: 1, revised: 0, unchanged: 0, conflicts: 2 });
  assert.equal(score(b), 5);
  assert.equal(b.rounds()[0]!.needsReview, true);
  // three versions where the first equals the book
  const c = new RoundBook();
  c.ingest(records([five]));
  assert.deepEqual(c.ingest(records([five, four, rec({ HoleShot: 6 })])), { added: 0, revised: 0, unchanged: 1, conflicts: 2 });
  assert.equal(score(c), 5);
});

test('T6. an identical repeat in one call is no conflict and no flag; it is counted as unchanged', () => {
  const b = new RoundBook();
  assert.deepEqual(b.ingest(records([five, five, five])), { added: 1, revised: 0, unchanged: 2, conflicts: 0 });
  assert.equal(score(b), 5);
  assert.equal(b.rounds()[0]!.needsReview, false);
  assert.deepEqual(b.issues(), []);
  const c = new RoundBook();
  c.ingest(records([five]));
  assert.deepEqual(c.ingest(records([five, five])), { added: 0, revised: 0, unchanged: 2, conflicts: 0 });
  assert.equal(c.rounds()[0]!.needsReview, false);
});

test('S1. two same-name players whose ids share their last four characters still print different lines', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'a', UserGuid: 'xx-1234' }), rec({ ShotID: 'b', UserGuid: 'yy-1234' })]));
  const [, l1, l2] = formatScorecard(b).split('\n');
  assert.notEqual(l1, l2);
  // the ends "-1234" clash, so the suffix grows by one character
  assert.ok(l1!.startsWith('ZZTEST-A [x-1234]'), l1);
  assert.ok(l2!.startsWith('ZZTEST-A [y-1234]'), l2);
});

test('S2. ids that share their last twelve characters grow the suffix until they differ; ids that differ in four characters keep four', () => {
  const tail = 'abcdefghijkl';
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'a', UserGuid: `1${tail}` }), rec({ ShotID: 'b', UserGuid: `2${tail}` })]));
  const [, l1, l2] = formatScorecard(b).split('\n');
  assert.notEqual(l1, l2);
  assert.ok(l1!.startsWith(`ZZTEST-A [1${tail}]`), l1);
  assert.ok(l2!.startsWith(`ZZTEST-A [2${tail}]`), l2);
  const short = new RoundBook();
  short.ingest(records([rec({ ShotID: 'a', UserGuid: 'guid-aaaa1111' }), rec({ ShotID: 'b', UserGuid: 'guid-bbbb2222' })]));
  const lines = formatScorecard(short).split('\n');
  assert.ok(lines[1]!.startsWith('ZZTEST-A [1111]'), lines[1]);
  assert.ok(lines[2]!.startsWith('ZZTEST-A [2222]'), lines[2]);
  // one id is the end of the other: the whole shorter id is printed
  const nest = new RoundBook();
  nest.ingest(records([rec({ ShotID: 'a', UserGuid: '1234' }), rec({ ShotID: 'b', UserGuid: 'xx1234' })]));
  const n = formatScorecard(nest).split('\n');
  assert.notEqual(n[1], n[2]);
});
