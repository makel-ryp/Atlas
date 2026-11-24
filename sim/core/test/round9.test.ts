import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, UnknownLayoutError, loadRecording, validateRecord } from '../src/index.js';
import * as namespaceObject from '../src/text.js';
import type { ShotRecord } from '../src/index.js';
import { assertShallow, plainCopy } from '../src/parse.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RECORDING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');

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

/** Ingest `record` after a good one; it must be refused with UnknownLayoutError and leave the book as it was. */
function refused(label: string, record: unknown) {
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

function swapped<T extends object>(value: T, proto: object | null): T {
  Object.setPrototypeOf(value, proto);
  return value;
}

// ---------------------------------------------------------------- the type tests cannot be fooled by a prototype

test('X1. a typed array, buffer, view or boxed primitive with a swapped prototype is still refused', () => {
  const cases: Array<[string, () => object]> = [
    ['Uint8Array proto Object.prototype', () => swapped(new Uint8Array(3), Object.prototype)],
    ['Uint8Array proto null', () => swapped(new Uint8Array(3), null)],
    ['Float64Array proto null', () => swapped(new Float64Array(3), null)],
    ['Buffer proto null', () => swapped(Buffer.from([1, 2, 3]), null)],
    ['Buffer proto Object.prototype', () => swapped(Buffer.from([1, 2, 3]), Object.prototype)],
    ['boxed String proto Object.prototype', () => swapped(new String('abc'), Object.prototype)],
    ['boxed String proto null', () => swapped(new String('abc'), null)],
    ['boxed Number proto null', () => swapped(new Number(5), null)],
    ['boxed Boolean proto Object.prototype', () => swapped(new Boolean(true), Object.prototype)],
    ['DataView proto null', () => swapped(new DataView(new ArrayBuffer(4)), null)],
    ['ArrayBuffer proto null', () => swapped(new ArrayBuffer(4), null)],
    ['SharedArrayBuffer proto null', () => swapped(new SharedArrayBuffer(4), null)],
    ['module namespace object', () => namespaceObject],
  ];
  for (const [label, make] of cases) {
    refused(`${label} in a field`, { ...rec({ ShotID: 'odd' }), G: make() });
    refused(`${label} nested`, { ...rec({ ShotID: 'odd' }), G: [{ H: make() }] });
    assert.throws(() => validateRecord({ ...rec(), G: make() }, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError, `${label} by validateRecord`);
    assert.throws(() => assertShallow({ ...rec(), G: make() }, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError, `${label} by assertShallow`);
  }
});

test('X2. every proxy is refused before any trap runs, whatever it wraps', () => {
  let trapCalls = 0;
  const spy = <T extends object>(target: T, extra: ProxyHandler<T> = {}): T =>
    new Proxy(target, {
      get(t, k, r) { trapCalls++; return Reflect.get(t, k, r); },
      has(t, k) { trapCalls++; return Reflect.has(t, k); },
      ownKeys(t) { trapCalls++; return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor(t, k) { trapCalls++; return Reflect.getOwnPropertyDescriptor(t, k); },
      getPrototypeOf(t) { trapCalls++; return Reflect.getPrototypeOf(t); },
      ...extra,
    });
  const throwing = new Proxy({}, { getPrototypeOf() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); }, get() { throw new Error('boom'); } });
  const cases: Array<[string, () => object]> = [
    ['over a plain object, no traps', () => new Proxy({ a: 1 }, {})],
    ['over a plain array, no traps', () => new Proxy([1, 2], {})],
    ['over a typed array with a getPrototypeOf trap', () => spy(new Uint8Array(3), { getPrototypeOf: () => { trapCalls++; return Object.prototype; } })],
    ['spying proxy over a plain object', () => spy({ a: 1 })],
    ['spying proxy over a plain array', () => spy([1, 2])],
    ['proxy whose traps throw', () => throwing],
  ];
  for (const [label, make] of cases) {
    trapCalls = 0;
    refused(`${label} in a field`, { ...rec({ ShotID: 'odd' }), G: make() });
    refused(`${label} nested`, { ...rec({ ShotID: 'odd' }), G: [[make()]] });
    assert.throws(() => validateRecord({ ...rec(), G: make() }, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError, `${label} by validateRecord`);
    assert.equal(trapCalls, 0, `${label}: no trap ran`);
  }
  // a proxy as the record itself
  assert.throws(() => new RoundBook().ingest([new Proxy(rec(), {}) as unknown as ShotRecord]), UnknownLayoutError);
  assert.throws(() => validateRecord(throwing, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError);
});

// ---------------------------------------------------------------- nothing of the caller's is called

test('X3. toJSON is never called: it is a property like any other', () => {
  let called = 0;
  const record = {
    ...rec({ ShotID: 't', HoleShot: 4, HoleResult: 7 }),
    toJSON() { called++; return { ShotID: 'changed' }; },
    Inner: { toJSON() { called++; return 'x'; }, keep: 1 },
    Text: { toJSON: 'a string, kept' },
  } as unknown as ShotRecord;
  const b = new RoundBook();
  assert.equal(b.ingest([record]).added, 1);
  assert.equal(called, 0, 'toJSON was never called');
  assert.equal(b.rounds()[0]!.players[0]!.total, 4, 'the record kept its own values');
  const copy = plainCopy(record, 'record 0', new Set()) as Record<string, unknown>;
  assert.equal(called, 0);
  assert.equal('toJSON' in copy, false, 'a function property is left out of the copy');
  assert.deepEqual(copy['Inner'], { keep: 1 });
  assert.deepEqual(copy['Text'], { toJSON: 'a string, kept' });
});

test('X4. a getter or a setter is refused and never called; a getter that changes its answer is refused too', () => {
  let calls = 0;
  const onField = rec({ ShotID: 'g1' });
  Object.defineProperty(onField, 'PlayerName', { enumerable: true, get() { calls++; return 'ZZTEST-A'; } });
  const onNested = { ...rec({ ShotID: 'g2' }), N: {} };
  Object.defineProperty(onNested.N, 'x', { enumerable: true, get() { calls++; return 1; } });
  const arr: unknown[] = [1, 2, 3];
  Object.defineProperty(arr, 1, { enumerable: true, get() { calls++; return 2; } });
  const onIndex = { ...rec({ ShotID: 'g3' }), A: arr };
  const setterOnly = rec({ ShotID: 'g4' });
  Object.defineProperty(setterOnly, 'Q', { enumerable: true, set(_v: unknown) { calls++; } });
  let n = 0;
  const changing = rec({ ShotID: 'g5' });
  Object.defineProperty(changing, 'HoleShot', { enumerable: true, get() { calls++; return ++n; } });
  const cases: Array<[string, unknown]> = [
    ['getter on a record field', onField],
    ['getter on a nested field', onNested],
    ['getter on an array index', onIndex],
    ['setter without getter', setterOnly],
    ['getter that returns a different value each time', changing],
  ];
  for (const [label, value] of cases) {
    calls = 0;
    refused(label, value);
    assert.equal(calls, 0, `${label}: never called`);
    assert.throws(() => validateRecord(value, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError, `${label} by validateRecord`);
    assert.equal(calls, 0, `${label}: never called by validateRecord`);
  }
});

test('X5. every value is read once, through its own descriptor: a getter on an own key cannot answer differently for the check and the copy', () => {
  // a data property that is read through the descriptor gives the same value to the check and to the copy
  const record = { ...rec({ ShotID: 'd', HoleShot: 4, HoleResult: 7 }), A: [1, { b: [2] }] };
  const b = new RoundBook();
  b.ingest([record as unknown as ShotRecord]);
  (record.A[1] as { b: number[] }).b.push(99);
  assert.equal(b.ingest([{ ...rec({ ShotID: 'd', HoleShot: 4, HoleResult: 7 }), A: [1, { b: [2] }] } as unknown as ShotRecord]).unchanged, 1, 'the book kept its own copy');
});

// ---------------------------------------------------------------- the copy agrees with what JSON would make

test('X6. for every recorded record the copy equals the JSON round trip', () => {
  let n = 0;
  for (const copy of loadRecording(RECORDING_DIR)) {
    for (const r of copy.records) {
      assert.deepEqual(plainCopy(r, 'record 0', new Set()), JSON.parse(JSON.stringify(r)));
      n++;
    }
  }
  assert.ok(n > 100, `compared ${n} records`);
});

test('X7. the copy follows the JSON rules without calling anything', () => {
  const sym = Symbol('s');
  const source = {
    ...rec(),
    Negz: -0,
    Nan: NaN,
    Inf: Infinity,
    Undef: undefined,
    Fn: () => 1,
    Sym: sym,
    List: [undefined, () => 1, sym, NaN, -0, 'x', null, true],
    [Symbol('key')]: 5,
  };
  const copy = plainCopy(source, 'record 0', new Set()) as Record<string, unknown>;
  const viaJson = JSON.parse(JSON.stringify(source));
  assert.deepEqual(copy, viaJson);
  assert.ok(Object.is(copy['Negz'], 0));
  assert.equal(copy['Nan'], null);
  assert.equal('Undef' in copy, false);
  assert.deepEqual(copy['List'], [null, null, null, null, 0, 'x', null, true]);
  assert.throws(() => plainCopy({ ...rec(), Big: 10n }, 'record 0', new Set()), UnknownLayoutError);
  assert.throws(() => plainCopy({ ...rec(), List: [10n] }, 'record 0', new Set()), UnknownLayoutError);
  // an own key named __proto__ stays an own property and does not change the copy's prototype
  const own = JSON.parse('{"__proto__": {"polluted": 1}, "k": 2}');
  const c = plainCopy({ ...rec(), O: own }, 'record 0', new Set()) as { O: Record<string, unknown> };
  assert.equal(Object.getPrototypeOf(c.O), Object.prototype);
  assert.deepEqual(Object.keys(c.O), ['__proto__', 'k']);
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
});

// ---------------------------------------------------------------- cost

test('X8. a typed array, buffer, string or proxy of ten million entries is refused in under 100 ms, with a swapped prototype too', () => {
  const big: Array<[string, () => object]> = [
    ['Uint8Array proto Object.prototype', () => swapped(new Uint8Array(10_000_000), Object.prototype)],
    ['Uint8Array proto null', () => swapped(new Uint8Array(10_000_000), null)],
    ['Buffer proto null', () => swapped(Buffer.alloc(10_000_000), null)],
    ['boxed String proto Object.prototype', () => swapped(new String('x'.repeat(10_000_000)), Object.prototype)],
    ['proxy over Uint8Array with a getPrototypeOf trap', () => new Proxy(new Uint8Array(10_000_000), { getPrototypeOf: () => Object.prototype })],
  ];
  for (const [label, make] of big) {
    const value = make();
    const b = new RoundBook();
    const t0 = performance.now();
    assert.throws(() => b.ingest([{ ...rec(), G: value } as unknown as ShotRecord]), UnknownLayoutError, label);
    const ms = performance.now() - t0;
    assert.ok(ms < 100, `${label}: took ${ms.toFixed(1)} ms`);
    assert.equal(b.rounds().length, 0);
  }
});
