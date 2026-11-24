import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoundBook, UnknownLayoutError, parseRoundFile, formatScorecard, normalisedName } from '../src/index.js';
import type { ShotRecord } from '../src/index.js';
import { runScorecard, type FileAccess } from '../src/command.js';

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

function direct(over: Record<string, unknown> = {}): ShotRecord {
  return rec(over) as unknown as ShotRecord;
}

function snapshot(b: RoundBook) {
  return structuredClone({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots });
}

function book(list: Array<Record<string, unknown>>): RoundBook {
  const b = new RoundBook();
  b.ingest(parseRoundFile(JSON.stringify(list)));
  return b;
}

function refusedFast(label: string, make: () => ShotRecord) {
  const b = new RoundBook();
  b.ingest([direct({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 })]);
  const before = snapshot(b);
  const t0 = Date.now();
  assert.throws(() => b.ingest([direct({ ShotID: 'new' }), make()]), (e: unknown) => e instanceof UnknownLayoutError, label);
  assert.ok(Date.now() - t0 < 1000, `${label}: took ${Date.now() - t0} ms`);
  assert.deepEqual(snapshot(b), before, label);
}

// ---------------------------------------------------------------- A. the walk bounds what the copy will cost

test('V1. a sparse array of 1e8 or 1e7 entries is refused quickly, before anything is expanded', () => {
  for (const len of [1e8, 1e7, 100_001]) {
    refusedFast(`sparse ${len}`, () => {
      const a: unknown[] = [];
      a.length = len; // costs nothing: the array is sparse
      a[0] = 1;
      return { ...rec(), G: a } as unknown as ShotRecord;
    });
  }
});

test('V2. an array longer than 100,000 entries is refused, one of exactly 100,000 is accepted', () => {
  refusedFast('dense 100001', () => ({ ...rec(), G: new Array(100_001).fill(0) }) as unknown as ShotRecord);
  const ok = new RoundBook();
  assert.equal(ok.ingest([{ ...rec(), G: new Array(100_000).fill(0) } as unknown as ShotRecord]).added, 1);
});

test('V3. an array with holes is refused', () => {
  refusedFast('literal hole', () => ({ ...rec(), G: [1, , 3] }) as unknown as ShotRecord);
  refusedFast('deleted entry', () => {
    const a = [1, 2, 3];
    delete a[1];
    return { ...rec(), G: a } as unknown as ShotRecord;
  });
  refusedFast('hole in a nested array', () => ({ ...rec(), G: { H: [[1], [2, , 4]] } }) as unknown as ShotRecord);
});

test('V4. a record with more than 250,000 values is refused, by the parser and by ingest', () => {
  const chunk = () => new Array(90_000).fill(0);
  refusedFast('three arrays of 90,000', () => ({ ...rec(), A: chunk(), B: chunk(), C: chunk() }) as unknown as ShotRecord);
  refusedFast('wide object', () => {
    const o: Record<string, number> = {};
    for (let i = 0; i < 260_000; i++) o[`k${i}`] = i;
    return { ...rec(), W: o } as unknown as ShotRecord;
  });
  const text = JSON.stringify([{ ...rec(), A: chunk(), B: chunk(), C: chunk() }]);
  assert.throws(() => parseRoundFile(text), UnknownLayoutError);
  // two arrays of 100,000 are within the budget
  assert.equal(new RoundBook().ingest([{ ...rec(), A: new Array(100_000).fill(0), B: new Array(100_000).fill(0) } as unknown as ShotRecord]).added, 1);
});

// ---------------------------------------------------------------- B. only UnknownLayoutError leaves ingest

test('V5. a getter on an array index, a proxy that throws on length, and a throwing list all give UnknownLayoutError with the book unchanged', () => {
  const b = new RoundBook();
  b.ingest([direct({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 })]);
  const before = snapshot(b);
  const indexGetter: unknown[] = [1, 2];
  Object.defineProperty(indexGetter, 0, { enumerable: true, get() { throw new Error('boom'); } });
  const lengthProxy = new Proxy([1, 2], { get(t, k, r) { if (k === 'length') throw new Error('boom'); return Reflect.get(t, k, r); }, ownKeys() { throw new Error('boom'); } });
  const list = new Proxy([direct({ ShotID: 'x' })], { get(t, k, r) { if (k === 'length') throw new Error('boom'); return Reflect.get(t, k, r); } });
  const elementGetter: unknown[] = [];
  Object.defineProperty(elementGetter, 0, { enumerable: true, get() { throw new Error('boom'); } });
  elementGetter.length = 1;
  const cases: Array<[string, () => unknown]> = [
    ['array index getter', () => b.ingest([{ ...rec({ ShotID: 'n1' }), G: indexGetter } as unknown as ShotRecord])],
    ['array length proxy', () => b.ingest([{ ...rec({ ShotID: 'n2' }), G: lengthProxy } as unknown as ShotRecord])],
    ['list length throws', () => b.ingest(list as unknown as ShotRecord[])],
    ['list element getter throws', () => b.ingest(elementGetter as unknown as ShotRecord[])],
  ];
  for (const [label, run] of cases) {
    assert.throws(run, (e: unknown) => e instanceof UnknownLayoutError, label);
    assert.deepEqual(snapshot(b), before, label);
  }
});

// ---------------------------------------------------------------- C. "seen twice" is per record

test('V6. the same object twice in one call, or a sub-object shared by two records, is not refused; inside one record it is', () => {
  const one = direct({ HoleShot: 4, HoleResult: 7 });
  const b = new RoundBook();
  assert.deepEqual(b.ingest([one, one]), { added: 1, revised: 0, unchanged: 1, conflicts: 0 });
  const shared = { tag: ['x'] };
  const c = new RoundBook();
  assert.deepEqual(
    c.ingest([{ ...rec({ ShotID: 'a' }), S: shared } as unknown as ShotRecord, { ...rec({ ShotID: 'b', Hole: 1 }), S: shared } as unknown as ShotRecord]),
    { added: 2, revised: 0, unchanged: 0, conflicts: 0 },
  );
  shared.tag.push('changed');
  assert.deepEqual(c.ingest([{ ...rec({ ShotID: 'a' }), S: { tag: ['x'] } } as unknown as ShotRecord]), { added: 0, revised: 0, unchanged: 1, conflicts: 0 }, 'the book kept its own copy');
  // a differing repeat of the same object content is still judged by the first-in-call rule
  const d = new RoundBook();
  const first = direct({ HoleShot: 4, HoleResult: 7 });
  assert.equal(d.ingest([first, { ...first, HoleShot: 5 }]).conflicts, 1);
  // inside one record it is still refused
  const inner = [1];
  assert.throws(() => new RoundBook().ingest([{ ...rec(), A: inner, B: inner } as unknown as ShotRecord]), UnknownLayoutError);
});

// ---------------------------------------------------------------- D. the refused count where it differs from the issue count

function fake(files: Record<string, string>): FileAccess {
  return {
    size: (p) => Buffer.byteLength(files[p] ?? ''),
    read: (p) => files[p] ?? '',
  };
}

test('V7. three versions of one ShotID in one read: one issue, two records refused', () => {
  const text = JSON.stringify([rec({ HoleShot: 4, HoleResult: 7 }), rec({ HoleShot: 5, HoleResult: 7 }), rec({ HoleShot: 6, HoleResult: 7 })]);
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');
  const res = runScorecard('/p/three.dat', fake({ '/p/three.dat': text }), dir);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.split('\n').at(-1), 'Issues: 1 (duplicate_shot_in_copy 1); records refused: 2');
});

// ---------------------------------------------------------------- E. the example lines are really checked

test('V8. the scorecard test pins the known scores: no bare bar in a pattern', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const f of ['scorecard.test.ts', 'review.test.ts', 'rules.test.ts', 'round5.test.ts', 'round6.test.ts', 'command.test.ts', 'repeat.test.ts']) {
    const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      // a regular expression literal that holds a printed line shape ("P1 NAME | ...") with an unescaped bar
      assert.ok(!/\/\^?P\d[^/]*\| /.test(line.replace(/\\\|/g, '')), `${f}:${i + 1} ${line.trim()}`);
    });
  }
  // and the assertion itself fails when a total is wrong
  const text = readFileSync(join(dir, 'scorecard.test.ts'), 'utf8');
  assert.match(text, /\^P1 ZZTEST-A \\\| hole 3: 6/);
  assert.match(text, /\^P2 ZZTEST-B \\\| hole 3: 5/);
});

// ---------------------------------------------------------------- F. look-alike bars, blank-looking letters

test('V9. look-alikes of the bar in a printed name or course key become spaces', () => {
  const bars = ['¦', 'ǀ', '∣', '∥', '│', '┃', '┆', '┊', '║', '❘', '⏐', '｜', '￤'];
  for (const bar of bars) {
    const b = book([rec({ PlayerName: `ZZTEST-B ${bar} hole 1: 2  total 5`, CourseKey: `c${bar}d`, HoleShot: 9, HoleResult: 7 })]);
    const [heading, line] = formatScorecard(b).split('\n');
    assert.equal(heading, 'Round 1  c d', `U+${bar.charCodeAt(0).toString(16)}`);
    assert.ok(line!.startsWith('P1 ZZTEST-B   hole 1: 2  total 5 | hole 1: 9'), `U+${bar.charCodeAt(0).toString(16)}: ${line}`);
    assert.equal(b.rounds()[0]!.players[0]!.name, `ZZTEST-B ${bar} hole 1: 2  total 5`, 'rounds() keeps the name');
  }
});

test('V10. blank-looking letters count as spaces in the name comparison; a real inner space stays a different name', () => {
  for (const blank of ['ㅤ', 'ᅟ', 'ᅠ', 'ﾠ', '⠀']) {
    assert.equal(normalisedName(`ZZTEST-A${blank}`), normalisedName('ZZTEST-A'), `U+${blank.charCodeAt(0).toString(16)}`);
    assert.equal(normalisedName(`${blank}ZZTEST-A`), normalisedName('ZZTEST-A'));
    assert.equal(normalisedName(`ZZ${blank}${blank}TEST-A`), normalisedName('ZZ TEST-A'));
    const b = book([
      rec({ ShotID: 'a', UserGuid: 'g1', PlayerName: 'ZZTEST-A' }),
      rec({ ShotID: 'b', UserGuid: 'g2', PlayerName: `ZZTEST-A${blank}` }),
    ]);
    assert.equal(b.rounds()[0]!.needsReview, true);
  }
  assert.notEqual(normalisedName('ZZ TEST-A'), normalisedName('ZZTEST-A'));
  const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /real space inside a name/);
});
