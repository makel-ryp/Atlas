import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, parseRoundFile, formatScorecard } from '../src/index.js';

/** A hand-made record. Placeholders only: made-up ids, test names. */
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

function ingestAll(...copies: Array<Array<Record<string, unknown>>>): RoundBook {
  const b = new RoundBook();
  for (const c of copies) b.ingest(parseRoundFile(JSON.stringify(c)));
  return b;
}

function strokesTo(n: number, extra: Record<string, unknown> = {}): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => rec({ ShotID: `st-${i + 1}`, HoleShot: i + 1, ...extra }));
}

test('N9. the higher of two disagreeing finishes is chosen as a number: 9 and 10 give 10, 10 and 11 give 11', () => {
  for (const [low, high] of [[9, 10], [10, 11], [2, 10], [99, 100]] as const) {
    const b = ingestAll([
      ...strokesTo(Math.min(low, 8)),
      rec({ ShotID: 'fin-low', HoleShot: low, HoleResult: 7 }),
      rec({ ShotID: 'fin-high', HoleShot: high, HoleResult: 7 }),
    ]);
    const p = b.rounds()[0]!.players[0]!;
    assert.equal(p.holes[0]!.strokes, high, `${low} and ${high}`);
    assert.equal(p.holes[0]!.needsReview, true);
    assert.equal(p.total, high);
    assert.match(formatScorecard(b), new RegExp(`hole 1: ${high} \\(needs review\\)`));
    // and in the other order
    const rev = ingestAll([
      rec({ ShotID: 'fin-high', HoleShot: high, HoleResult: 7 }),
      rec({ ShotID: 'fin-low', HoleShot: low, HoleResult: 7 }),
    ]);
    assert.equal(rev.rounds()[0]!.players[0]!.holes[0]!.strokes, high, `${high} then ${low}`);
  }
  // totals add numbers, not text
  const t = ingestAll([rec({ ShotID: 'a', Hole: 0, HoleShot: 10, HoleResult: 7 }), rec({ ShotID: 'b', Hole: 1, HoleShot: 9, HoleResult: 7 })]);
  assert.equal(t.rounds()[0]!.players[0]!.total, 19);
});

test('N4. a shot seen under guid-2 with the same name is still a conflict: guid-1 keeps it, the round is marked, one conflict is counted', () => {
  const b = new RoundBook();
  b.ingest(parseRoundFile(JSON.stringify([rec({ ShotID: 'x', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7 })])));
  const counts = b.ingest(parseRoundFile(JSON.stringify([rec({ ShotID: 'x', UserGuid: 'guid-2', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7, ShotResult: 1 })])));
  assert.deepEqual(counts, { added: 0, revised: 0, unchanged: 0, conflicts: 1 });
  const r = b.rounds()[0]!;
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0]!.userGuid, 'guid-1');
  assert.equal(r.needsReview, true);
  assert.deepEqual(b.issues(), [{ kind: 'shot_owner_changed', roundId: 1, shotId: 'x' }]);
});

test('N10. the par shown is the first par seen on the hole, and a disagreement in either order flags the hole', () => {
  for (const [first, second] of [[3, 5], [5, 3]] as const) {
    const b = ingestAll([rec({ ShotID: 'a', HolePar: first }), rec({ ShotID: 'b', HolePar: second, HoleShot: 2 })]);
    const h = b.rounds()[0]!.players[0]!.holes[0]!;
    assert.equal(h.par, first, `pars ${first} then ${second}`);
    assert.equal(h.needsReview, true, `pars ${first} then ${second}`);
    assert.equal(b.rounds()[0]!.needsReview, true);
  }
});

test('N11. a repeat inside one call is judged against the first record of that ShotID, not the one before it', () => {
  const a = rec({ ShotID: 'x', HoleShot: 4, HoleResult: 7 });
  const other = rec({ ShotID: 'x', HoleShot: 5, HoleResult: 7 });
  const b = new RoundBook();
  const counts = b.ingest(parseRoundFile(JSON.stringify([a, other, a])));
  assert.deepEqual(counts, { added: 1, revised: 0, unchanged: 1, conflicts: 1 });
  assert.equal(b.rounds()[0]!.players[0]!.holes[0]!.strokes, 4, 'the first record is kept');
});

test('N12. players are numbered in the order they were first seen, whatever their ids or names sort like', () => {
  const b = ingestAll([
    rec({ ShotID: 's1', UserGuid: 'guid-9', PlayerName: 'ZZTEST-Z', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 's2', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 's3', UserGuid: 'guid-5', PlayerName: 'ZZTEST-M', HoleShot: 5, HoleResult: 7 }),
  ]);
  const players = b.rounds()[0]!.players;
  assert.deepEqual(players.map((p) => [p.playerNumber, p.userGuid]), [[1, 'guid-9'], [2, 'guid-1'], [3, 'guid-5']]);
  const lines = formatScorecard(b).split('\n');
  assert.ok(lines[1]!.startsWith('P1 ZZTEST-Z | '));
  assert.ok(lines[2]!.startsWith('P2 ZZTEST-A | '));
  assert.ok(lines[3]!.startsWith('P3 ZZTEST-M | '));
  // another round starts again at 1, in its own order
  const two = ingestAll([
    rec({ ShotID: 'a', RoundID: 1, UserGuid: 'guid-9', PlayerName: 'ZZTEST-Z' }),
    rec({ ShotID: 'b', RoundID: 2, UserGuid: 'guid-1', PlayerName: 'ZZTEST-A' }),
  ]);
  assert.deepEqual(two.rounds().map((r) => r.players.map((p) => p.playerNumber)), [[1], [1]]);
});

test('N13. the same name is found among any of the players, not only the first two or when all share it', () => {
  const b = ingestAll([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'c', UserGuid: 'guid-3', PlayerName: 'ZZTEST-A', HoleShot: 5, HoleResult: 7 }),
  ]);
  assert.equal(b.rounds()[0]!.needsReview, true);
  assert.deepEqual(b.rounds()[0]!.players.map((p) => p.needsReview), [false, false, false], 'only the round is marked');
  // three players, three names: no mark
  const clean = ingestAll([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A' }),
    rec({ ShotID: 'b', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B' }),
    rec({ ShotID: 'c', UserGuid: 'guid-3', PlayerName: 'ZZTEST-C' }),
  ]);
  assert.equal(clean.rounds()[0]!.needsReview, false);
});

test('N14. one UserGuid under two names that differ only by letter case flags the player and the round', () => {
  const b = ingestAll([
    rec({ ShotID: 'a', PlayerName: 'ZZTEST-A', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'b', PlayerName: 'zztest-a', Hole: 1, HoleShot: 4, HoleResult: 7 }),
  ]);
  assert.equal(b.rounds()[0]!.players[0]!.needsReview, true);
  assert.equal(b.rounds()[0]!.needsReview, true);
});

test('N15. one flagged player marks the round, even when the other players are clean', () => {
  const b = ingestAll([
    rec({ ShotID: 'a', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'b', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 6, HoleResult: 7 }),
    rec({ ShotID: 'c', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B', HoleShot: 5, HoleResult: 7 }),
  ]);
  const r = b.rounds()[0]!;
  assert.deepEqual(r.players.map((p) => p.needsReview), [true, false]);
  assert.equal(r.needsReview, true);
});

test('N16. a conflict marks the round even when that round has only one player, and the course shown is the first one seen', () => {
  const two = ingestAll([rec({ ShotID: 'a', CourseKey: 'c_first' }), rec({ ShotID: 'b', CourseKey: 'c_second', Hole: 1 })]);
  assert.equal(two.rounds()[0]!.courseKey, 'c_first');
  assert.deepEqual(two.rounds()[0]!.courseKeys, ['c_first', 'c_second']);
  const b = new RoundBook();
  b.ingest(parseRoundFile(JSON.stringify([rec({ ShotID: 'x', HoleShot: 4, HoleResult: 7 })])));
  b.ingest(parseRoundFile(JSON.stringify([rec({ ShotID: 'x', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B', HoleShot: 5, HoleResult: 7 })])));
  assert.equal(b.rounds()[0]!.players.length, 1);
  assert.equal(b.rounds()[0]!.needsReview, true);
});
