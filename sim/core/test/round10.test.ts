import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, UnknownLayoutError, validateRecord } from '../src/index.js';
import type { ShotRecord } from '../src/index.js';
import { assertShallow, plainCopy } from '../src/parse.js';

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

function revoked(): object {
  const r = Proxy.revocable({}, {});
  r.revoke();
  return r.proxy;
}

/** A book that already holds one record, to show it is unchanged after a refusal. */
function withOne(): RoundBook {
  const b = new RoundBook();
  b.ingest([rec({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 }) as unknown as ShotRecord]);
  return b;
}

function listRefused(label: string, list: unknown) {
  const b = withOne();
  const before = snapshot(b);
  assert.throws(() => b.ingest(list as ShotRecord[]), (e: unknown) => e instanceof UnknownLayoutError, label);
  assert.deepEqual(snapshot(b), before, label);
}

// ---------------------------------------------------------------- A. the list given to ingest

test('Y1. a proxy as the list is refused and no trap runs; a revoked proxy gives UnknownLayoutError', () => {
  let traps = 0;
  const spy = new Proxy([rec({ ShotID: 'p' })], {
    get(t, k, r) { traps++; return Reflect.get(t, k, r); },
    has(t, k) { traps++; return Reflect.has(t, k); },
    ownKeys(t) { traps++; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { traps++; return Reflect.getOwnPropertyDescriptor(t, k); },
    getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); },
  });
  listRefused('spying proxy as the list', spy);
  assert.equal(traps, 0, 'no trap ran');
  listRefused('proxy with no traps', new Proxy([rec({ ShotID: 'p' })], {}));
  listRefused('revoked proxy as the list', revoked());
});

test('Y2. a getter on a list index is refused and never called; a hole and an extra key are refused', () => {
  let calls = 0;
  const getter: unknown[] = [rec({ ShotID: 'a' }), rec({ ShotID: 'b' })];
  Object.defineProperty(getter, 1, { enumerable: true, get() { calls++; return rec({ ShotID: 'b' }); } });
  listRefused('getter on a list index', getter);
  assert.equal(calls, 0, 'never called');
  // eslint-disable-next-line no-sparse-arrays
  listRefused('a hole in the list', [rec({ ShotID: 'a' }), , rec({ ShotID: 'c' })]);
  const extra: unknown[] = [rec({ ShotID: 'a' })];
  (extra as unknown as Record<string, unknown>)['x'] = 1;
  listRefused('a list with an extra key', extra);
  const sym: unknown[] = [rec({ ShotID: 'a' })];
  (sym as unknown as Record<symbol, unknown>)[Symbol('s')] = 1;
  listRefused('a list with a symbol key', sym);
});

test('Y3. a list of 20,001 entries is refused before any entry is read; a typed array and other non-lists are refused', () => {
  let calls = 0;
  const big: unknown[] = new Array(20_001).fill(null).map((_, i) => ({ i }));
  Object.defineProperty(big, 0, { enumerable: true, get() { calls++; return rec(); } });
  listRefused('20,001 entries', big);
  assert.equal(calls, 0, 'entry 0 was never read');
  listRefused('typed array as the list', new Uint8Array(3));
  listRefused('swapped typed array as the list', Object.setPrototypeOf(new Uint8Array(3), Array.prototype));
  listRefused('undefined', undefined);
  listRefused('null', null);
  listRefused('a string', 'abc');
  listRefused('an object', { length: 1, 0: rec() });
  listRefused('array subclass', new (class L extends Array {})());
  // 20,000 entries are still allowed
  const ok = new RoundBook();
  assert.equal(ok.ingest(Array.from({ length: 20_000 }, (_, i) => rec({ ShotID: `s${i}` }) as unknown as ShotRecord)).added, 20_000);
});

// ---------------------------------------------------------------- B. exported functions judge the copy

test('Y4. validateRecord judges the copy: a non-enumerable getter is not read and the field is reported missing', () => {
  let calls = 0;
  const r = rec();
  delete r['HoleShot'];
  Object.defineProperty(r, 'HoleShot', { enumerable: false, get() { calls++; return 4; } });
  assert.throws(() => validateRecord(r, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError && e.message.includes('field HoleShot is missing'));
  assert.equal(calls, 0, 'never called');
  const thrower = rec();
  delete thrower['HoleShot'];
  Object.defineProperty(thrower, 'HoleShot', { enumerable: false, get() { calls++; throw new Error('boom'); } });
  assert.throws(() => validateRecord(thrower, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError);
  assert.equal(calls, 0);
  // it says what ingest says
  const b = new RoundBook();
  assert.throws(() => b.ingest([r as unknown as ShotRecord]), (e: unknown) => e instanceof UnknownLayoutError && e.message.includes('field HoleShot is missing'));
  assert.equal(calls, 0);
  // a good record passes, and so does one with extra fields
  assert.doesNotThrow(() => validateRecord(rec(), 'record 0'));
  assert.doesNotThrow(() => validateRecord({ ...rec(), Extra: [1, { a: 2 }] }, 'record 0'));
});

test('Y5. validateRecord, plainCopy and assertShallow give UnknownLayoutError for a revoked proxy, before anything else looks at it', () => {
  const dead = revoked();
  assert.throws(() => validateRecord(dead, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError);
  assert.throws(() => plainCopy(dead, 'record 0', new Set()), (e: unknown) => e instanceof UnknownLayoutError);
  assert.throws(() => assertShallow(dead, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError);
  // a revoked proxy as an array too (Array.isArray would throw TypeError on it)
  const deadArray = Proxy.revocable([], {});
  deadArray.revoke();
  assert.throws(() => validateRecord(deadArray.proxy, 'record 0'), (e: unknown) => e instanceof UnknownLayoutError);
  assert.throws(() => plainCopy(deadArray.proxy, 'record 0', new Set()), (e: unknown) => e instanceof UnknownLayoutError);
});

// ---------------------------------------------------------------- C. one rule for an array's own keys

test('Y6. an array is accepted only if its own keys are exactly length and its indexes, each an enumerable data property', () => {
  const inRecord = (a: unknown) => ({ ...rec({ ShotID: 'arr' }), A: a }) as unknown as ShotRecord;
  const check = (label: string, a: unknown, message?: RegExp) => {
    const b = new RoundBook();
    assert.throws(() => b.ingest([inRecord(a)]), (e: unknown) => e instanceof UnknownLayoutError && (message === undefined || message.test(e.message)), label);
    assert.equal(b.rounds().length, 0, label);
  };
  // a hole together with an extra key (the key count alone does not catch it)
  const holeAndExtra: unknown[] = [1, 2, 3];
  delete holeAndExtra[1];
  (holeAndExtra as unknown as Record<string, unknown>)['x'] = 1;
  check('hole with an extra key', holeAndExtra, /holes/);
  // a non-enumerable index together with an extra key
  const hiddenAndExtra: unknown[] = [1, 2, 3];
  Object.defineProperty(hiddenAndExtra, 1, { enumerable: false, value: 2 });
  (hiddenAndExtra as unknown as Record<string, unknown>)['x'] = 1;
  check('non-enumerable index with an extra key', hiddenAndExtra);
  // a non-enumerable index alone
  const hidden: unknown[] = [1, 2, 3];
  Object.defineProperty(hidden, 1, { enumerable: false, value: 2 });
  check('non-enumerable index', hidden);
  // a symbol key, a non-enumerable extra key, an ordinary extra key
  const withSymbol: unknown[] = [1, 2];
  (withSymbol as unknown as Record<symbol, unknown>)[Symbol('s')] = 1;
  check('symbol key on an array', withSymbol);
  const hiddenExtra: unknown[] = [1, 2];
  Object.defineProperty(hiddenExtra, 'y', { enumerable: false, value: 1 });
  check('non-enumerable extra key', hiddenExtra);
  const extra: unknown[] = [1, 2];
  (extra as unknown as Record<string, unknown>)['z'] = 1;
  check('extra key', extra);
  // plain deleted entry
  const deleted: unknown[] = [1, 2, 3];
  delete deleted[0];
  check('deleted entry', deleted, /holes/);
  // and a clean array is still accepted, empty or not
  assert.equal(new RoundBook().ingest([inRecord([1, [2, []], { a: [] }])]).added, 1);
  assert.equal(new RoundBook().ingest([inRecord([])]).added, 1);
});

// ---------------------------------------------------------------- D. nothing here can run out of memory

test('Y7. typed arrays, buffers, strings and proxies of 20,000 entries with swapped prototypes are refused', () => {
  const swapped = <T extends object>(v: T, p: object | null): T => Object.setPrototypeOf(v, p);
  const cases: Array<[string, () => object]> = [
    ['Uint8Array proto Object.prototype', () => swapped(new Uint8Array(20_000), Object.prototype)],
    ['Buffer proto null', () => swapped(Buffer.alloc(20_000), null)],
    ['boxed String proto Object.prototype', () => swapped(new String('x'.repeat(20_000)), Object.prototype)],
    ['proxy over Uint8Array with a getPrototypeOf trap', () => new Proxy(new Uint8Array(20_000), { getPrototypeOf: () => Object.prototype })],
  ];
  for (const [label, make] of cases) {
    const b = new RoundBook();
    assert.throws(() => b.ingest([{ ...rec(), G: make() } as unknown as ShotRecord]), UnknownLayoutError, label);
    assert.equal(b.rounds().length, 0, label);
  }
});

test('Y8. the list limit: 20,000 clean records are accepted, 20,001 are refused with the book unchanged', () => {
  const clean = (n: number) => Array.from({ length: n }, (_, i) => rec({ ShotID: `s${i}`, UserGuid: 'guid-1' }) as unknown as ShotRecord);
  const ok = new RoundBook();
  assert.equal(ok.ingest(clean(20_000)).added, 20_000);
  const b = withOne();
  const before = snapshot(b);
  assert.throws(() => b.ingest(clean(20_001)), (e: unknown) => e instanceof UnknownLayoutError && /too many records/.test(e.message));
  assert.deepEqual(snapshot(b), before);
});
