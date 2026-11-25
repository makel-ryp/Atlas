import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, UnknownLayoutError, parseRoundFile, validateRecord } from '../src/index.js';
import type { ShotRecord } from '../src/index.js';

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

function snapshot(b: RoundBook) {
  return structuredClone({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots });
}

class Thing {
  x = 1;
}

/** Small non-plain objects: each must be refused before anything is looked inside. */
function oddValues(): Array<[string, unknown]> {
  const proto = { HoleResult: 7 };
  return [
    ['Uint8Array', new Uint8Array(3)],
    ['Float64Array', new Float64Array(3)],
    ['DataView', new DataView(new ArrayBuffer(4))],
    ['ArrayBuffer', new ArrayBuffer(4)],
    ['Buffer', Buffer.from([1, 2, 3])],
    ['boxed String', new String('abc')],
    ['boxed Number', new Number(5)],
    ['boxed Boolean', new Boolean(true)],
    ['Map', new Map([['k', 1]])],
    ['Set', new Set([1])],
    ['Date', new Date(0)],
    ['class instance', new Thing()],
    ['object with a prototype', Object.create(proto)],
    ['array subclass', new (class Sub extends Array {})()],
  ];
}

function snapshotAfterRefusal(label: string, record: unknown) {
  const b = new RoundBook();
  b.ingest([rec({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 }) as unknown as ShotRecord]);
  const before = snapshot(b);
  assert.throws(
    () => b.ingest([rec({ ShotID: 'new' }) as unknown as ShotRecord, record as ShotRecord]),
    (e: unknown) => e instanceof UnknownLayoutError,
    label,
  );
  assert.deepEqual(snapshot(b), before, label);
}

test('W1. a non-plain object inside a record is refused with UnknownLayoutError and the book is unchanged', () => {
  for (const [label, value] of oddValues()) {
    snapshotAfterRefusal(`${label} in a field`, { ...rec({ ShotID: 'odd' }), G: value });
    snapshotAfterRefusal(`${label} in a nested array`, { ...rec({ ShotID: 'odd' }), G: [[value]] });
    snapshotAfterRefusal(`${label} in a nested object`, { ...rec({ ShotID: 'odd' }), G: { H: { I: value } } });
  }
});

test('W2. the same values are refused by the parser walk (validateRecord) too', () => {
  for (const [label, value] of oddValues()) {
    assert.throws(
      () => validateRecord({ ...rec(), G: value }, 'record 0'),
      (e: unknown) => e instanceof UnknownLayoutError,
      label,
    );
  }
});

test('W3. a typed array of 10,000,000 entries is refused in under 100 ms', () => {
  const big = new Uint8Array(10_000_000);
  const b = new RoundBook();
  const t0 = performance.now();
  assert.throws(() => b.ingest([{ ...rec(), G: big } as unknown as ShotRecord]), UnknownLayoutError);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
  assert.equal(b.rounds().length, 0);
});

test('W4. everything JSON.parse returns, and plain objects without a prototype, are still accepted', () => {
  const text = JSON.stringify([{ ...rec(), G: [[1, { a: [true, null, 'x'] }], { b: {} }] }]);
  assert.equal(parseRoundFile(text).length, 1);
  const bare = Object.create(null) as Record<string, unknown>;
  bare['k'] = [1, 2];
  assert.equal(new RoundBook().ingest([{ ...rec(), G: bare } as unknown as ShotRecord]).added, 1);
  assert.equal(new RoundBook().ingest([{ ...rec(), G: [1, 'two', null, false, { n: 3 }] } as unknown as ShotRecord]).added, 1);
});
