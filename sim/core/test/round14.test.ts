import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, parseRoundFile, formatScorecard } from '../src/index.js';

/** A hand-made record. Placeholders only: made-up ids, test names. */
function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ShotID: 'shot-1',
    UserGuid: 'guid-1',
    PlayerName: 'ZZTEST-A',
    CourseKey: 'c',
    RoundID: 1,
    Hole: 0,
    HoleShot: 1,
    HolePar: 4,
    HoleResult: 0,
    ShotResult: 0,
    ...over,
  };
}

function feed(b: RoundBook, copy: Array<Record<string, unknown>>) {
  return b.ingest(parseRoundFile(JSON.stringify(copy)));
}

function lines(b: RoundBook): string[] {
  return formatScorecard(b).split('\n');
}

test('X28. a later copy that revises a first shot in a field the score does not use keeps every player number', () => {
  const a1 = rec({ ShotID: 'a1', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A' });
  const b1 = rec({ ShotID: 'b1', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B' });
  const b = new RoundBook();
  feed(b, [a1, b1]);
  const numbers = () => b.rounds()[0]!.players.map((p) => [p.playerNumber, p.name]);
  assert.deepEqual(numbers(), [[1, 'ZZTEST-A'], [2, 'ZZTEST-B']]);
  // copy 2: the same two shots, a1 revised in a field the score does not read
  const counts = feed(b, [{ ...a1, ShotResult: 2 }, b1]);
  assert.equal(counts.revised, 1);
  assert.deepEqual(numbers(), [[1, 'ZZTEST-A'], [2, 'ZZTEST-B']]);
  const l = lines(b);
  assert.ok(l[1]!.startsWith('P1 ZZTEST-A | '), l[1]);
  assert.ok(l[2]!.startsWith('P2 ZZTEST-B | '), l[2]);
  // copy 3: b1 revised too, and a new player arrives mid-round: the new one is last, the others keep their numbers
  const c1 = rec({ ShotID: 'c1', UserGuid: 'guid-3', PlayerName: 'ZZTEST-C' });
  feed(b, [{ ...a1, ShotResult: 3 }, { ...b1, ShotResult: 3 }, c1]);
  assert.deepEqual(numbers(), [[1, 'ZZTEST-A'], [2, 'ZZTEST-B'], [3, 'ZZTEST-C']]);
  const l3 = lines(b);
  assert.ok(l3[1]!.startsWith('P1 ZZTEST-A | ') && l3[2]!.startsWith('P2 ZZTEST-B | ') && l3[3]!.startsWith('P3 ZZTEST-C | '), l3.join('\n'));
});

test('X13. one file holding a ShotID twice, differing only in a field the score does not use, is a conflict and marks the round', () => {
  const a = rec({ ShotID: 'a', HoleShot: 4, HoleResult: 7 });
  const b = new RoundBook();
  // the second copy differs only in a field outside the ten the library reads (a GhostData-style extra field)
  const counts = feed(b, [{ ...a, Extra: { n: 1 } }, { ...a, Extra: { n: 2 } }]);
  assert.deepEqual(counts, { added: 1, revised: 0, unchanged: 0, conflicts: 1 });
  const r = b.rounds()[0]!;
  assert.equal(r.players[0]!.holes[0]!.strokes, 4);
  assert.equal(r.needsReview, true);
  assert.deepEqual(b.issues(), [{ kind: 'duplicate_shot_in_copy', roundId: 1, shotId: 'a' }]);
  assert.match(lines(b)[0]!, /^Round 1 {2}c {2}\(needs review\)$/);
});

test('X30. records on the course keys c and C in one round mark the round: course keys are compared exactly', () => {
  const b = new RoundBook();
  feed(b, [rec({ ShotID: 'a', CourseKey: 'c' }), rec({ ShotID: 'b', CourseKey: 'C', Hole: 1 })]);
  const r = b.rounds()[0]!;
  assert.deepEqual(r.courseKeys, ['c', 'C']);
  assert.equal(r.needsReview, true);
  assert.match(lines(b)[0]!, /^Round 1 {2}c \/ C {2}\(needs review\)$/);
});

test('X31. two players ZZTEST-A1 and ZZTEST-A2 with different ids are not the same name: no mark', () => {
  const b = new RoundBook();
  feed(b, [
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A1' }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'ZZTEST-A2' }),
  ]);
  const r = b.rounds()[0]!;
  assert.equal(r.needsReview, false);
  assert.deepEqual(r.players.map((p) => p.needsReview), [false, false]);
  assert.ok(!formatScorecard(b).includes('needs review'));
  // names that really are the same after the comparison rules still mark
  const same = new RoundBook();
  feed(same, [rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A1' }), rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'zztest-a1 ' })]);
  assert.equal(same.rounds()[0]!.needsReview, true);
});
