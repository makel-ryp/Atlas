import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoundBook, UnknownLayoutError, parseRoundFile, formatScorecard, loadRecording } from '../src/index.js';
import type { ShotRecord } from '../src/index.js';

/** A hand-made record. Placeholders only: no real names or ids. */
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

function book(...copies: Array<Array<Record<string, unknown>>>): RoundBook {
  const b = new RoundBook();
  for (const c of copies) b.ingest(records(c));
  return b;
}

/** `n` arrays nested inside each other, built without recursion. */
function nested(n: number): unknown {
  let v: unknown = [];
  for (let i = 1; i < n; i++) v = [v];
  return v;
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');
const CLI = join(dirname(fileURLToPath(import.meta.url)), '../../cli/scorecard.ts');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------- A. review flags

test('A1. a hole holding more strokes than its finished score is flagged at hole, player and round level', () => {
  // finishing 4, then records 5 and 6 on the same hole
  const b = book([
    rec({ ShotID: 'a', HoleShot: 1 }),
    rec({ ShotID: 'b', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'c', HoleShot: 5 }),
    rec({ ShotID: 'd', HoleShot: 6 }),
  ]);
  const r = b.rounds()[0]!;
  const h = r.players[0]!.holes[0]!;
  assert.equal(h.strokes, 4, 'the proven number does not change');
  assert.equal(r.players[0]!.total, 4);
  assert.equal(h.needsReview, true);
  assert.equal(r.players[0]!.needsReview, true);
  assert.equal(r.needsReview, true);
  // a finishing HoleShot below strokes already recorded
  const low = book([1, 2, 3, 4, 5].map((n) => rec({ ShotID: `x${n}`, HoleShot: n })).concat([rec({ ShotID: 'fin', HoleShot: 3, HoleResult: 7 })]));
  const lr = low.rounds()[0]!;
  assert.equal(lr.players[0]!.holes[0]!.strokes, 3);
  assert.equal(lr.players[0]!.holes[0]!.needsReview, true);
  assert.equal(lr.players[0]!.needsReview, true);
  assert.equal(lr.needsReview, true);
});

test('A2. a clean finished hole, a clean in-play hole and two agreeing finishes are flagged nowhere', () => {
  const b = book([
    rec({ ShotID: 'a', HoleShot: 1 }),
    rec({ ShotID: 'b', HoleShot: 2 }),
    rec({ ShotID: 'c', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'd', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'e', Hole: 1, HoleShot: 1 }),
    rec({ ShotID: 'f', Hole: 1, HoleShot: 2 }),
  ]);
  const r = b.rounds()[0]!;
  for (const h of r.players[0]!.holes) assert.equal(h.needsReview, false);
  assert.equal(r.players[0]!.needsReview, false);
  assert.equal(r.needsReview, false);
  assert.ok(!formatScorecard(b).includes('needs review'));
});

test('A3. records of one hole that disagree on HolePar flag the hole, the player and the round', () => {
  const fin = book([rec({ ShotID: 'a', HolePar: 3 }), rec({ ShotID: 'b', HolePar: 5, HoleShot: 2, HoleResult: 7 })]);
  const fr = fin.rounds()[0]!;
  assert.equal(fr.players[0]!.holes[0]!.strokes, 2);
  assert.equal(fr.players[0]!.holes[0]!.needsReview, true);
  assert.equal(fr.players[0]!.needsReview, true);
  assert.equal(fr.needsReview, true);
  // an unfinished hole is flagged too
  const play = book([rec({ ShotID: 'a', HolePar: 3 }), rec({ ShotID: 'b', HolePar: 5, HoleShot: 2 })]);
  const pr = play.rounds()[0]!;
  assert.equal(pr.players[0]!.holes[0]!.status, 'in_play');
  assert.equal(pr.players[0]!.holes[0]!.needsReview, true);
  assert.equal(pr.players[0]!.needsReview, true);
  assert.equal(pr.needsReview, true);
  // agreeing pars flag nothing
  const same = book([rec({ ShotID: 'a', HolePar: 3 }), rec({ ShotID: 'b', HolePar: 3, HoleShot: 2 })]);
  assert.equal(same.rounds()[0]!.needsReview, false);
});

test('A4. one UserGuid under two names flags the player and the round; the first name seen is shown', () => {
  const b = book([
    rec({ ShotID: 'a', PlayerName: 'ZZTEST-A', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'b', PlayerName: 'ZZTEST-B', Hole: 1, HoleShot: 4, HoleResult: 7 }),
  ]);
  const r = b.rounds()[0]!;
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0]!.name, 'ZZTEST-A');
  assert.equal(r.players[0]!.needsReview, true);
  assert.equal(r.needsReview, true);
  assert.equal(r.players[0]!.holes.every((h) => !h.needsReview), true, 'the holes themselves are clean');
  assert.equal(r.players[0]!.total, 7);
  const line = formatScorecard(b).split('\n')[1]!;
  assert.match(line, /total 7 \(needs review\)$/);
});

test('A5. two players with the same name flag the round only, and the formatter tells them apart by the last four characters of the id', () => {
  const b = book([
    rec({ ShotID: 'a', UserGuid: 'guid-aaaa1111', PlayerName: 'ZZTEST-A', HoleShot: 3, HoleResult: 7 }),
    rec({ ShotID: 'b', UserGuid: 'guid-bbbb2222', PlayerName: 'ZZTEST-A', HoleShot: 5, HoleResult: 7 }),
  ]);
  const r = b.rounds()[0]!;
  assert.equal(r.needsReview, true);
  assert.equal(r.players.length, 2);
  assert.equal(r.players.every((p) => !p.needsReview), true);
  const lines = formatScorecard(b).split('\n');
  assert.match(lines[0]!, /\(needs review\)$/);
  assert.match(lines[1]!, /^ZZTEST-A .*1111.* {2}hole 1: 3 {2}total 3$/);
  assert.match(lines[2]!, /^ZZTEST-A .*2222.* {2}hole 1: 5 {2}total 5$/);
  assert.ok(!lines[1]!.includes('guid-aaaa'), 'only the last four characters');
  // two different names: no id is printed
  const diff = book([
    rec({ ShotID: 'a', UserGuid: 'guid-aaaa1111', PlayerName: 'ZZTEST-A' }),
    rec({ ShotID: 'b', UserGuid: 'guid-bbbb2222', PlayerName: 'ZZTEST-B' }),
  ]);
  const text = formatScorecard(diff);
  assert.ok(!text.includes('1111') && !text.includes('2222'));
  assert.equal(diff.rounds()[0]!.needsReview, false);
});

test('A6. a round whose records name two courses is flagged, and the heading prints the mark', () => {
  const b = book([rec({ ShotID: 'a', CourseKey: 'c1' }), rec({ ShotID: 'b', CourseKey: 'c2', Hole: 1 })]);
  assert.equal(b.rounds()[0]!.needsReview, true);
  assert.equal(b.rounds()[0]!.players[0]!.needsReview, false);
  const heading = formatScorecard(b).split('\n')[0]!;
  assert.match(heading, /^Round 1 {2}c1 \/ c2 {2}\(needs review\)$/);
  assert.equal(book([rec({ CourseKey: 'c1' })]).rounds()[0]!.needsReview, false);
});

test('A7. the formatter prints the review mark after a flagged hole, after a flagged total and on a flagged heading', () => {
  const b = book([
    rec({ ShotID: 'f-1', HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'f-2', HoleShot: 9, HoleResult: 7 }),
    rec({ ShotID: 'g-1', Hole: 1, HoleShot: 3, HoleResult: 7 }),
  ]);
  const [heading, line] = formatScorecard(b).split('\n');
  assert.match(heading!, /^Round 1 {2}test_course {2}\(needs review\)$/);
  assert.equal(line, 'ZZTEST-A  hole 1: 9 (needs review)  hole 2: 3  total 12 (needs review)');
  // a flagged in-play hole is marked too
  const play = formatScorecard(book([rec({ ShotID: 'a', HolePar: 3 }), rec({ ShotID: 'b', HolePar: 5, HoleShot: 2 })]));
  assert.match(play.split('\n')[1]!, /hole 1: in play \(2 strokes\) \(needs review\)/);
});

test('A8. the last finishing record does not win: the higher one does, in either order', () => {
  const higherFirst = book([
    rec({ ShotID: 'f-1', HoleShot: 6, HoleResult: 7 }),
    rec({ ShotID: 'f-2', HoleShot: 4, HoleResult: 7 }),
  ]);
  const h = higherFirst.rounds()[0]!.players[0]!.holes[0]!;
  assert.equal(h.strokes, 6);
  assert.equal(h.needsReview, true);
  assert.equal(higherFirst.rounds()[0]!.players[0]!.total, 6);
});

test('A9. in-play strokes are never added to the total', () => {
  const b = book([
    rec({ ShotID: 'a', Hole: 0, HoleShot: 4, HoleResult: 7 }),
    rec({ ShotID: 'b', Hole: 1, HoleShot: 1 }),
    rec({ ShotID: 'c', Hole: 1, HoleShot: 2 }),
    rec({ ShotID: 'd', Hole: 1, HoleShot: 3 }),
  ]);
  const p = b.rounds()[0]!.players[0]!;
  assert.equal(p.holes[1]!.status, 'in_play');
  assert.equal(p.holes[1]!.strokesSoFar, 3);
  assert.equal(p.total, 4);
  const only = book([rec({ ShotID: 'a', HoleShot: 3 })]);
  assert.equal(only.rounds()[0]!.players[0]!.total, 0);
  assert.match(formatScorecard(only), /hole 1: in play \(3 strokes\) {2}total 0$/m);
});

test('A10. the score is the HoleShot of the finishing record, not the highest HoleShot on the hole', () => {
  const b = book([
    rec({ ShotID: 'a', HoleShot: 1 }),
    rec({ ShotID: 'b', HoleShot: 2, HoleResult: 7 }),
    rec({ ShotID: 'c', HoleShot: 7 }),
  ]);
  const h = b.rounds()[0]!.players[0]!.holes[0]!;
  assert.equal(h.strokes, 2);
  assert.equal(h.strokesSoFar, 2);
  assert.equal(b.rounds()[0]!.players[0]!.total, 2);
});

test('A11. only HoleResult 7 finishes a hole', () => {
  for (const result of [1, 3, 6, 8, 9]) {
    const b = book([rec({ ShotID: 'a', HoleShot: 4, HoleResult: result })]);
    const p = b.rounds()[0]!.players[0]!;
    assert.equal(p.holes[0]!.status, 'in_play', `HoleResult ${result}`);
    assert.equal(p.holes[0]!.strokes, null);
    assert.equal(p.total, 0);
  }
  const mixed = book([
    rec({ ShotID: 'a', HoleShot: 3, HoleResult: 8 }),
    rec({ ShotID: 'b', HoleShot: 4, HoleResult: 7 }),
  ]);
  assert.equal(mixed.rounds()[0]!.players[0]!.holes[0]!.strokes, 4);
});

test('A12. RoundID 0 is a real round, not the practice range', () => {
  const b = book([rec({ ShotID: 'a', RoundID: 0, HoleShot: 2, HoleResult: 7 })]);
  assert.equal(b.rangeShots, 0);
  assert.deepEqual(b.rounds().map((r) => r.roundId), [0]);
  assert.equal(b.rounds()[0]!.players[0]!.total, 2);
  assert.match(formatScorecard(b), /^Round 0 /m);
});

test('A13. the formatter prints the practice-range line, and only when there are range shots', () => {
  const b = book([rec({ ShotID: 'a', RoundID: -1 }), rec({ ShotID: 'b', RoundID: -3 }), rec({ ShotID: 'c', RoundID: 1 })]);
  assert.match(formatScorecard(b), /^Practice range shots \(in no round\): 2$/m);
  assert.ok(!formatScorecard(book([rec()])).includes('Practice range'));
});

test('A14. the recording gives the known pars and nothing in it is flagged', () => {
  const b = new RoundBook();
  for (const c of loadRecording(FIXTURE_DIR)) b.ingest(c.records);
  const rounds = b.rounds();
  const r19 = rounds.find((r) => r.roundId === 19)!;
  const r18 = rounds.find((r) => r.roundId === 18)!;
  for (const p of r19.players) assert.deepEqual(p.holes.map((h) => [h.hole, h.par]), [[3, 3], [12, 3], [15, 3]]);
  for (const p of r18.players) assert.deepEqual(p.holes.map((h) => [h.hole, h.par]), [[1, 4]]);
  for (const r of rounds) {
    assert.equal(r.needsReview, false);
    for (const p of r.players) {
      assert.equal(p.needsReview, false);
      for (const h of p.holes) assert.equal(h.needsReview, false);
    }
  }
  assert.equal(b.issues().length, 0);
  assert.ok(!formatScorecard(b).includes('needs review'));
});

// ---------------------------------------------------------------- parser limits

test('P1. an empty ShotID is refused, and UserGuid must be a string', () => {
  assert.throws(
    () => parseRoundFile(JSON.stringify([rec({ ShotID: '' })])),
    (e: unknown) => e instanceof UnknownLayoutError && e.message.includes('field ShotID'),
  );
  for (const bad of [5, null, true, ['g'], { a: 1 }]) {
    assert.throws(
      () => parseRoundFile(JSON.stringify([rec({ UserGuid: bad })])),
      (e: unknown) => e instanceof UnknownLayoutError && e.message.includes('field UserGuid'),
      `UserGuid ${JSON.stringify(bad)}`,
    );
  }
  assert.equal(parseRoundFile(JSON.stringify([rec({ UserGuid: '' })])).length, 1);
});

// ---------------------------------------------------------------- B. a shot never changes owner

test('B1. a ShotID re-sent under another UserGuid is not applied: it is a conflict, the first owner keeps the score, both rounds are the same and flagged', () => {
  const b = new RoundBook();
  const first = b.ingest(records([rec({ ShotID: 'dup', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7 })]));
  assert.deepEqual(first, { added: 1, revised: 0, unchanged: 0, conflicts: 0 });
  const second = b.ingest(records([rec({ ShotID: 'dup', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B', HoleShot: 5, HoleResult: 7 })]));
  assert.deepEqual(second, { added: 0, revised: 0, unchanged: 0, conflicts: 1 });
  const r = b.rounds()[0]!;
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0]!.name, 'ZZTEST-A');
  assert.equal(r.players[0]!.total, 4);
  assert.equal(r.needsReview, true);
  assert.deepEqual(b.issues(), [{ kind: 'shot_owner_changed', roundId: 1, shotId: 'dup' }]);
  assert.match(formatScorecard(b).split('\n')[0]!, /\(needs review\)$/);
});

test('B2. a ShotID re-sent under another RoundID is a conflict and flags both rounds', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'dup', RoundID: 1, HoleShot: 4, HoleResult: 7 }), rec({ ShotID: 'ok', RoundID: 2, HoleShot: 3, HoleResult: 7 })]));
  const counts = b.ingest(records([rec({ ShotID: 'dup', RoundID: 2, HoleShot: 6, HoleResult: 7 })]));
  assert.equal(counts.conflicts, 1);
  assert.equal(counts.revised, 0);
  const rounds = b.rounds();
  assert.equal(rounds.length, 2);
  assert.equal(rounds.find((r) => r.roundId === 1)!.players[0]!.total, 4);
  assert.equal(rounds.find((r) => r.roundId === 2)!.players[0]!.total, 3);
  assert.equal(rounds.find((r) => r.roundId === 1)!.needsReview, true, 'the round that holds the original');
  assert.equal(rounds.find((r) => r.roundId === 2)!.needsReview, true, 'the round that was claimed');
  assert.deepEqual(b.issues(), [{ kind: 'shot_owner_changed', roundId: 2, shotId: 'dup' }]);
});

test('B3. one call holding the same ShotID twice with different content keeps the first and reports a conflict', () => {
  const b = new RoundBook();
  const counts = b.ingest(
    records([
      rec({ ShotID: 'dup', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A', HoleShot: 4, HoleResult: 7 }),
      rec({ ShotID: 'dup', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B', HoleShot: 5, HoleResult: 7 }),
    ]),
  );
  assert.deepEqual(counts, { added: 1, revised: 0, unchanged: 0, conflicts: 1 });
  const r = b.rounds()[0]!;
  assert.deepEqual(r.players.map((p) => [p.name, p.total]), [['ZZTEST-A', 4]]);
  assert.equal(r.needsReview, true);
  assert.deepEqual(b.issues(), [{ kind: 'duplicate_shot_in_copy', roundId: 1, shotId: 'dup' }]);
  // same owner, different content, inside one call: still a conflict, the first is kept
  const c = new RoundBook();
  const counts2 = c.ingest(records([rec({ ShotID: 's', HoleShot: 4, HoleResult: 7 }), rec({ ShotID: 's', HoleShot: 4, HoleResult: 0 })]));
  assert.deepEqual(counts2, { added: 1, revised: 0, unchanged: 0, conflicts: 1 });
  assert.equal(c.rounds()[0]!.players[0]!.holes[0]!.strokes, 4);
  // a revision of a held shot followed by a different second version in the same call
  const d = new RoundBook();
  d.ingest(records([rec({ ShotID: 's', HoleShot: 1 })]));
  const counts3 = d.ingest(records([rec({ ShotID: 's', HoleShot: 2 }), rec({ ShotID: 's', HoleShot: 3 })]));
  assert.deepEqual(counts3, { added: 0, revised: 1, unchanged: 0, conflicts: 1 });
  assert.equal(d.rounds()[0]!.players[0]!.holes[0]!.strokesSoFar, 2);
});

test('B4. the same ShotID twice in one call with identical content is unchanged, not a conflict', () => {
  const b = new RoundBook();
  const one = rec({ ShotID: 's', HoleShot: 4, HoleResult: 7 });
  const counts = b.ingest(records([one, one]));
  assert.deepEqual(counts, { added: 1, revised: 0, unchanged: 1, conflicts: 0 });
  assert.equal(b.rounds()[0]!.needsReview, false);
  assert.deepEqual(b.issues(), []);
});

test('B5. a later record with the same ShotID, owner and round but other content is still a revision', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 's', HoleShot: 4, HoleResult: 7 })]));
  const counts = b.ingest(records([rec({ ShotID: 's', HoleShot: 5, HoleResult: 7 })]));
  assert.deepEqual(counts, { added: 0, revised: 1, unchanged: 0, conflicts: 0 });
  assert.equal(b.rounds()[0]!.players[0]!.total, 5);
  assert.equal(b.rounds()[0]!.needsReview, false);
  assert.deepEqual(b.issues(), []);
});

test('B6. an issue holds exactly a kind, a round id and a shot id, nothing else from the file', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'dup', PlayerName: 'SECRET-NAME', CourseKey: 'SECRET-COURSE' })]));
  b.ingest(records([rec({ ShotID: 'dup', UserGuid: 'guid-2', PlayerName: 'OTHER-NAME', HoleShot: 9 })]));
  const issues = b.issues();
  assert.equal(issues.length, 1);
  assert.deepEqual(Object.keys(issues[0]!).sort(), ['kind', 'roundId', 'shotId']);
  assert.ok(!JSON.stringify(issues).includes('SECRET') && !JSON.stringify(issues).includes('OTHER'));
  // feeding the same refused copy again does not grow the list
  b.ingest(records([rec({ ShotID: 'dup', UserGuid: 'guid-2', PlayerName: 'OTHER-NAME', HoleShot: 9 })]));
  assert.equal(b.issues().length, 1);
  // the list handed out is a copy
  (b.issues() as unknown[]).push('x');
  assert.equal(b.issues().length, 1);
});

// ---------------------------------------------------------------- C. nesting and all-or-nothing

test('C1. parseRoundFile refuses a record nested more than 32 levels, and accepts 32', () => {
  // the record itself is level 1, so the field holds at most 31 nested arrays
  assert.equal(parseRoundFile(JSON.stringify([rec({ G: nested(31) })])).length, 1);
  assert.throws(
    () => parseRoundFile(JSON.stringify([rec({ G: nested(32) })])),
    (e: unknown) => e instanceof UnknownLayoutError && /32 levels/.test(e.message),
  );
  const objects = '{"a":'.repeat(40) + '1' + '}'.repeat(40);
  assert.throws(() => parseRoundFile(`[${JSON.stringify(rec()).slice(0, -1)},"G":${objects}}]`), UnknownLayoutError);
});

test('C2. a very deep record is refused with UnknownLayoutError, not a stack overflow', () => {
  const n = 200_000;
  const text = `[${JSON.stringify(rec()).slice(0, -1)},"G":${'['.repeat(n)}${']'.repeat(n)}}]`;
  assert.throws(
    () => parseRoundFile(text),
    (e: unknown) => e instanceof UnknownLayoutError && !(e instanceof RangeError),
  );
});

test('C3. ingest runs the same depth check on what it is given, without the parser', () => {
  const ok = { ...rec(), G: nested(31) } as unknown as ShotRecord;
  assert.deepEqual(new RoundBook().ingest([ok]), { added: 1, revised: 0, unchanged: 0, conflicts: 0 });
  for (const depth of [32, 100_000]) {
    const deep = { ...rec(), G: nested(depth) } as unknown as ShotRecord;
    assert.throws(() => new RoundBook().ingest([deep]), UnknownLayoutError, `depth ${depth}`);
  }
  // the same ShotID ingested again with a deep untouched field used to overflow the comparison
  const b = new RoundBook();
  const deep = { ...rec(), G: nested(100_000) } as unknown as ShotRecord;
  assert.throws(() => b.ingest([deep]), UnknownLayoutError);
  assert.throws(() => b.ingest([deep]), UnknownLayoutError);
});

test('C4. a call that throws leaves the book exactly as it was', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 }), rec({ ShotID: 'h2', RoundID: -1 })]));
  const before = structuredClone({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots });
  const deep = { ...rec({ ShotID: 'deep' }), G: nested(100) } as unknown as ShotRecord;
  const calls: ShotRecord[][] = [
    // a new record, a revision and a conflict come before the bad record
    [
      ...records([
        rec({ ShotID: 'new', Hole: 3, HoleShot: 2, HoleResult: 7 }),
        rec({ ShotID: 'h1', HoleShot: 5, HoleResult: 7 }),
        rec({ ShotID: 'h2', UserGuid: 'guid-9', RoundID: -1 }),
      ]),
      deep,
    ],
    // the bad record comes first
    [deep, ...records([rec({ ShotID: 'new2', Hole: 4 })])],
  ];
  for (const call of calls) {
    assert.throws(() => b.ingest(call), UnknownLayoutError);
    assert.deepEqual({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots }, before);
  }
  // after the failed calls a good call still works
  assert.deepEqual(b.ingest(records([rec({ ShotID: 'h1', HoleShot: 5, HoleResult: 7 })])), { added: 0, revised: 1, unchanged: 0, conflicts: 0 });
});

// ---------------------------------------------------------------- D. what the book does not do

test('D1. the book only adds and revises: a record missing from a later copy is kept', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'a', HoleShot: 1 }), rec({ ShotID: 'b', HoleShot: 4, HoleResult: 7 })]));
  const counts = b.ingest(records([rec({ ShotID: 'a', HoleShot: 1 })]));
  assert.deepEqual(counts, { added: 0, revised: 0, unchanged: 1, conflicts: 0 });
  assert.equal(b.rounds()[0]!.players[0]!.holes[0]!.strokes, 4);
  assert.equal(b.rounds()[0]!.players[0]!.total, 4);
});

test('D2. for one shot the last version fed wins, even when it is an older copy', () => {
  const newer = [rec({ ShotID: 'a', HoleShot: 5, HoleResult: 7 })];
  const older = [rec({ ShotID: 'a', HoleShot: 4, HoleResult: 7 })];
  const b = new RoundBook();
  b.ingest(records(newer));
  const counts = b.ingest(records(older));
  assert.equal(counts.revised, 1);
  assert.equal(b.rounds()[0]!.players[0]!.total, 4);
  const c = new RoundBook();
  c.ingest(records(older));
  c.ingest(records(newer));
  assert.equal(c.rounds()[0]!.players[0]!.total, 5);
});

test('D3. a round stays in the book after the file is emptied', () => {
  const b = new RoundBook();
  b.ingest(records([rec({ ShotID: 'a', HoleShot: 4, HoleResult: 7 })]));
  assert.deepEqual(b.ingest([]), { added: 0, revised: 0, unchanged: 0, conflicts: 0 });
  assert.deepEqual(b.rounds().map((r) => [r.roundId, r.players[0]!.total]), [[1, 4]]);
});

// ---------------------------------------------------------------- F. printing text from the file

test('F1. the formatter turns TAB, ESC and other control characters into one space each', () => {
  const name = 'a\tb\u001bc\u007fd\u0085e';
  const b = book([rec({ PlayerName: name, CourseKey: 'x\ty' })]);
  const [heading, line] = formatScorecard(b).split('\n');
  assert.equal(heading, 'Round 1  x y');
  assert.ok(line!.startsWith('a b c d e  hole 1'), line);
  assert.equal(b.rounds()[0]!.players[0]!.name, name, 'rounds() keeps the file text');
});

test('F2. the formatter replaces format characters and line and paragraph separators with a space', () => {
  const marks: Array<[string, string]> = [
    ['‮', 'right-to-left override'],
    ['⁦', 'isolate'],
    ['​', 'zero-width space'],
    ['‍', 'zero-width joiner'],
    ['﻿', 'byte-order mark'],
    [' ', 'line separator'],
    [' ', 'paragraph separator'],
    ['\u009b', 'C1 control'],
  ];
  for (const [ch, label] of marks) {
    const b = book([rec({ PlayerName: `P${ch}Q`, CourseKey: `C${ch}D` })]);
    const text = formatScorecard(b);
    assert.ok(text.startsWith('Round 1  C D\nP Q  hole 1'), `${label}: ${JSON.stringify(text)}`);
    assert.equal(text.split('\n').length, 2, label);
    assert.equal(b.rounds()[0]!.players[0]!.name, `P${ch}Q`, label);
  }
});

test('F3. the cut is at 64 code points, so a surrogate pair is never split', () => {
  const emoji = '\u{1F600}';
  const name = 'A'.repeat(63) + emoji + 'B'.repeat(10);
  const [, line] = formatScorecard(book([rec({ PlayerName: name })])).split('\n');
  assert.ok(line!.startsWith('A'.repeat(63) + emoji + '  hole 1'), 'cut after the pair');
  const many = emoji.repeat(100);
  const [heading, line2] = formatScorecard(book([rec({ PlayerName: many, CourseKey: many })])).split('\n');
  assert.ok(line2!.startsWith(emoji.repeat(64) + '  hole 1'));
  assert.equal(Array.from(heading!.slice('Round 1  '.length)).length, 64);
  // no lone surrogate anywhere
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(`${heading}\n${line2}`));
});

// ---------------------------------------------------------------- G. the command

function runCli(arg: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, arg], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('G1. the command refuses a file over 50,000,000 bytes without reading it, naming only the base name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zzsim-'));
  try {
    const file = join(dir, 'big-round.dat');
    writeFileSync(file, '');
    truncateSync(file, 50_000_001);
    const res = runCli(file);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    assert.ok(res.stderr.includes('big-round.dat'));
    assert.ok(!res.stderr.includes(dir), 'the folder is not printed');
    assert.equal(res.stderr.trim().split('\n').length, 1, 'one line');
    assert.ok(/50000000/.test(res.stderr));
    // a file exactly at the limit is not refused for size (it is refused as not JSON)
    truncateSync(file, 50_000_000);
    const atLimit = runCli(file);
    assert.equal(atLimit.status, 1);
    assert.ok(!/larger than/.test(atLimit.stderr), atLimit.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G2. a missing path or a folder prints one plain line with the base name only, exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zzsim-'));
  try {
    const missing = runCli(join(dir, 'no-such-file.dat'));
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, '');
    assert.ok(missing.stderr.includes('no-such-file.dat'));
    assert.ok(!missing.stderr.includes(dir));
    assert.equal(missing.stderr.trim().split('\n').length, 1);
    const folder = runCli(dir);
    assert.equal(folder.status, 1);
    assert.ok(folder.stderr.includes(join(dir).split(/[\\/]/).at(-1)!));
    assert.ok(!folder.stderr.includes(dirname(dir)));
    assert.equal(folder.stderr.trim().split('\n').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G3. the command still prints a readable file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zzsim-'));
  try {
    const file = join(dir, 'ok.dat');
    writeFileSync(file, JSON.stringify([rec({ HoleShot: 4, HoleResult: 7 })]));
    const res = runCli(file);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'Round 1  test_course\nZZTEST-A  hole 1: 4  total 4');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
