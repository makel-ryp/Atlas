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

/** Strokes 1 to 3 in play on hole 1, as GSPro writes them before a finish. */
function strokes(): Array<Record<string, unknown>> {
  return [1, 2, 3].map((n) => rec({ ShotID: `st-${n}`, HoleShot: n }));
}

test('S27. two finishing records that disagree by one (4 and 5) flag the hole and the round, and show the higher', () => {
  const b = ingestAll([
    ...strokes(),
    rec({ ShotID: 'fin-4', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'fin-5', HoleShot: 5, HoleResult: 7 }),
  ]);
  const r = b.rounds()[0]!;
  const h = r.players[0]!.holes[0]!;
  assert.equal(h.strokes, 5);
  assert.equal(h.needsReview, true);
  assert.equal(r.players[0]!.needsReview, true);
  assert.equal(r.needsReview, true);
  assert.match(formatScorecard(b), /hole 1: 5 \(needs review\)/);
});

test('S28. a stroke record one above the finishing score flags the hole', () => {
  const b = ingestAll([
    ...strokes(),
    rec({ ShotID: 'fin-4', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'late-5', HoleShot: 5 }),
  ]);
  const r = b.rounds()[0]!;
  const h = r.players[0]!.holes[0]!;
  assert.equal(h.strokes, 4);
  assert.equal(h.needsReview, true);
  assert.equal(r.needsReview, true);
  assert.match(formatScorecard(b), /hole 1: 4 \(needs review\)/);
  // a stroke equal to the finish is not above it: no flag
  const same = ingestAll([...strokes(), rec({ ShotID: 'fin-4', HoleShot: 4, HoleResult: 7 }), rec({ ShotID: 'same-4', HoleShot: 4 })]);
  assert.equal(same.rounds()[0]!.players[0]!.holes[0]!.needsReview, false);
});

test('S35. a finishing record with ShotResult 2 still finishes the hole with its HoleShot', () => {
  const b = ingestAll([...strokes(), rec({ ShotID: 'fin-4', HoleShot: 4, HoleResult: 7, ShotResult: 2 })]);
  const p = b.rounds()[0]!.players[0]!;
  assert.equal(p.holes[0]!.status, 'finished');
  assert.equal(p.holes[0]!.strokes, 4);
  assert.equal(p.total, 4);
  assert.match(formatScorecard(b), /hole 1: 4 {2}total 4$/m);
});

test('S24. a finishing record revised by a later copy to in play shows the hole in play, not the old score', () => {
  const first = [...strokes(), rec({ ShotID: 'f4', HoleShot: 4, HoleResult: 7 })];
  const second = [...strokes(), rec({ ShotID: 'f4', HoleShot: 4, HoleResult: 0 })];
  const b = new RoundBook();
  b.ingest(parseRoundFile(JSON.stringify(first)));
  assert.equal(b.rounds()[0]!.players[0]!.holes[0]!.strokes, 4);
  const counts = b.ingest(parseRoundFile(JSON.stringify(second)));
  assert.equal(counts.revised, 1);
  const p = b.rounds()[0]!.players[0]!;
  assert.equal(p.holes[0]!.status, 'in_play');
  assert.equal(p.holes[0]!.strokes, null);
  assert.equal(p.holes[0]!.strokesSoFar, 4);
  assert.equal(p.total, 0);
  assert.match(formatScorecard(b), /hole 1: in play \(4 strokes\) {2}total 0$/m);
});

test('S12. one UserGuid seen under two names that differ only by a trailing space flags the player and the round', () => {
  const b = ingestAll([
    rec({ ShotID: 'a', PlayerName: 'ZZTEST-A', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'b', PlayerName: 'ZZTEST-A ', Hole: 1, HoleShot: 4, HoleResult: 7 }),
  ]);
  const r = b.rounds()[0]!;
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0]!.name, 'ZZTEST-A', 'the first name seen is shown');
  assert.equal(r.players[0]!.needsReview, true);
  assert.equal(r.needsReview, true);
});

test('S39. every negative RoundID is the practice range: -2 is counted like -1 and is not printed as a round', () => {
  const b = ingestAll([
    rec({ ShotID: 'r1', RoundID: -1 }),
    rec({ ShotID: 'r2', RoundID: -2 }),
    rec({ ShotID: 'k1', RoundID: 5, HoleShot: 4, HoleResult: 7 }),
  ]);
  assert.equal(b.rangeShots, 2);
  assert.deepEqual(b.rounds().map((r) => r.roundId), [5]);
  const only = ingestAll([rec({ ShotID: 'r3', RoundID: -2 })]);
  assert.equal(only.rounds().length, 0);
  assert.equal(only.rangeShots, 1);
  assert.ok(!/Round -2/.test(formatScorecard(only)));
  assert.match(formatScorecard(only), /Practice range shots \(in no round\): 1/);
});
