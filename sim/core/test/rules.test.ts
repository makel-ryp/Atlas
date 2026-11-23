import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, UnknownLayoutError, parseRoundFile, formatScorecard } from '../src/index.js';

/** A hand-made record. Placeholders only: no real names or ids. */
function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ShotID: 'shot-1',
    UserGuid: 'guid-1',
    PlayerName: 'TEST-PLAYER',
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

function book(records: Array<Record<string, unknown>>): RoundBook {
  const b = new RoundBook();
  b.ingest(parseRoundFile(JSON.stringify(records)));
  return b;
}

test('R1. a negative RoundID is in no round and is counted in rangeShots', () => {
  const b = book([
    rec({ ShotID: 'r-1', RoundID: -1 }),
    rec({ ShotID: 'r-2', RoundID: -1, HoleShot: 2 }),
    rec({ ShotID: 'k-1', RoundID: 7 }),
  ]);
  assert.equal(b.rangeShots, 2);
  assert.deepEqual(b.rounds().map((r) => r.roundId), [7]);
  const onlyRange = book([rec({ ShotID: 'r-3', RoundID: -1 })]);
  assert.equal(onlyRange.rounds().length, 0);
  assert.equal(onlyRange.rangeShots, 1);
});

test('R2. two disagreeing finishing records: the higher is reported and needsReview is set', () => {
  const b = book([
    rec({ ShotID: 'f-1', Hole: 0, HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'f-2', Hole: 0, HoleShot: 6, HoleResult: 7 }),
  ]);
  const h = b.rounds()[0]!.players[0]!.holes[0]!;
  assert.equal(h.status, 'finished');
  assert.equal(h.strokes, 6);
  assert.equal(h.needsReview, true);
  assert.equal(b.rounds()[0]!.players[0]!.total, 6);
});

test('R3. one finishing record alone, or two that agree, does not set needsReview', () => {
  const one = book([rec({ ShotID: 'f-1', HoleShot: 4, HoleResult: 7 })]);
  assert.equal(one.rounds()[0]!.players[0]!.holes[0]!.needsReview, false);
  const agree = book([
    rec({ ShotID: 'f-1', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'f-2', HoleShot: 4, HoleResult: 7 }),
  ]);
  const h = agree.rounds()[0]!.players[0]!.holes[0]!;
  assert.equal(h.strokes, 4);
  assert.equal(h.needsReview, false);
});

test('R4. inside a round players are keyed by UserGuid: same name with two ids is two players', () => {
  const b = book([
    rec({ ShotID: 'p-1', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A' }),
    rec({ ShotID: 'p-2', UserGuid: 'guid-2', PlayerName: 'ZZTEST-A' }),
  ]);
  const players = b.rounds()[0]!.players;
  assert.equal(players.length, 2);
  assert.deepEqual(players.map((p) => p.userGuid), ['guid-1', 'guid-2']);
});

test('R5. same UserGuid with two names is one player, shown under the name of the first record seen', () => {
  const b = book([
    rec({ ShotID: 'p-1', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A' }),
    rec({ ShotID: 'p-2', UserGuid: 'guid-1', PlayerName: 'ZZTEST-B', Hole: 1 }),
  ]);
  const players = b.rounds()[0]!.players;
  assert.equal(players.length, 1);
  assert.equal(players[0]!.name, 'ZZTEST-A');
  assert.deepEqual(players[0]!.holes.map((h) => h.hole), [1, 2]);
});

test('R6. the formatter prints a name with a line break on one line', () => {
  const evil = 'ZZTEST-A\nRound 19  bluejack_gsp\r\nZZTEST-B  hole 3: 1  total 1\u007f\u0000';
  const b = book([rec({ PlayerName: evil, CourseKey: 'course\nRound 20  x' })]);
  const text = formatScorecard(b);
  assert.equal(text.split('\n').length, 2, 'one round line and one player line');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(text.replace(/\n/g, '')));
  // the library itself still returns the name exactly as the file had it
  assert.equal(b.rounds()[0]!.players[0]!.name, evil);
  assert.equal(b.rounds()[0]!.courseKey, 'course\nRound 20  x');
});

test('R7. the formatter cuts a name and a course key to 64 characters', () => {
  const b = book([rec({ PlayerName: 'N'.repeat(200), CourseKey: 'C'.repeat(200) })]);
  const [roundLine, playerLine] = formatScorecard(b).split('\n');
  assert.ok(roundLine!.startsWith(`Round 1  ${'C'.repeat(64)}`));
  assert.ok(!roundLine!.includes('C'.repeat(65)));
  assert.ok(playerLine!.startsWith(`P1 ${'N'.repeat(64)}  `));
  assert.ok(!playerLine!.includes('N'.repeat(65)));
});

test('R8. integer fields are range-checked: Hole 0 to 99, HoleShot 1 to 999, all safe integers', () => {
  const refused = (over: Record<string, unknown>, field: string) => {
    assert.throws(
      () => parseRoundFile(JSON.stringify([rec(over)])),
      (e: unknown) => e instanceof UnknownLayoutError && e.message.includes(`field ${field}`),
      `${field} ${JSON.stringify(over)}`,
    );
  };
  refused({ Hole: -5 }, 'Hole');
  refused({ Hole: 100 }, 'Hole');
  refused({ HoleShot: 0 }, 'HoleShot');
  refused({ HoleShot: 1e300 }, 'HoleShot');
  refused({ HoleShot: 1.5 }, 'HoleShot');
  refused({ HoleShot: 1000 }, 'HoleShot');
  refused({ RoundID: 1e300 }, 'RoundID');
  refused({ HolePar: 2 ** 53 }, 'HolePar');
  // the edges are accepted, and a negative RoundID (practice range) is accepted
  assert.equal(parseRoundFile(JSON.stringify([rec({ Hole: 0, HoleShot: 1 })])).length, 1);
  assert.equal(parseRoundFile(JSON.stringify([rec({ Hole: 99, HoleShot: 999 })])).length, 1);
  assert.equal(parseRoundFile(JSON.stringify([rec({ RoundID: -1 })])).length, 1);
});
