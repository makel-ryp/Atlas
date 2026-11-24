import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoundBook, UnknownLayoutError, parseRoundFile } from '../src/index.js';
import type { ShotRecord } from '../src/index.js';
import * as parseModule from '../src/parse.js';
import * as indexModule from '../src/index.js';

const LIMIT = 10_000_000;

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

/**
 * The counting rule: an object counts its own enumerable keys, an array counts its length. The ten fields of
 * rec() plus the key A plus an array A of 989 entries count 10 + 1 + 989 = 1,000 values, so 10,000 listings
 * are exactly the limit (not over it) and 10,001 pass it.
 */
function thousand(): Record<string, unknown> {
  return rec({ A: new Array(989).fill(0) });
}

function snapshot(b: RoundBook) {
  return structuredClone({ rounds: b.rounds(), issues: b.issues(), range: b.rangeShots });
}

function withOne(): RoundBook {
  const b = new RoundBook();
  b.ingest([rec({ ShotID: 'h1', HoleShot: 4, HoleResult: 7 }) as unknown as ShotRecord]);
  return b;
}

function listing(record: Record<string, unknown>, times: number): ShotRecord[] {
  return new Array(times).fill(record) as ShotRecord[];
}

test('Z1. MAX_TOTAL_VALUES is 10,000,000 and is exported from parse.ts, not from index.ts', () => {
  assert.equal((parseModule as Record<string, unknown>)['MAX_TOTAL_VALUES'], LIMIT);
  assert.equal((indexModule as Record<string, unknown>)['MAX_TOTAL_VALUES'], undefined);
});

test('Z2. one record of 1,000 values listed 10,000 times is accepted, listed 10,001 times it is refused, and the book is unchanged', () => {
  const record = thousand();
  const ok = new RoundBook();
  assert.deepEqual(ok.ingest(listing(record, 10_000)), { added: 1, revised: 0, unchanged: 9_999, conflicts: 0 });
  const b = withOne();
  const before = snapshot(b);
  assert.throws(() => b.ingest(listing(record, 10_001)), (e: unknown) => e instanceof UnknownLayoutError && /whole call/.test(e.message));
  assert.deepEqual(snapshot(b), before);
  const fewer = new RoundBook();
  assert.equal(fewer.ingest(listing(record, 9_999)).added, 1);
});

test('Z3. one sub-object shared by many records is counted every time it is reached', () => {
  // each record counts 10 + 1 keys and the shared array's 1,000 entries: 1,011 values; 9,891 of them are 9,999,801
  const shared = new Array(1_000).fill(0);
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...rec({ ShotID: `s${i}` }), S: shared }) as unknown as ShotRecord);
  assert.equal(new RoundBook().ingest(many(9_891)).added, 9_891);
  const b = withOne();
  const before = snapshot(b);
  assert.throws(() => b.ingest(many(9_892)), (e: unknown) => e instanceof UnknownLayoutError && /whole call/.test(e.message));
  assert.deepEqual(snapshot(b), before);
});

test('Z4. the parser has the same limit for a whole file', () => {
  // one record of 1,000 values written 10,000 times is a text of about 22 million characters
  const one = JSON.stringify(thousand());
  const file = (n: number) => `[${new Array(n).fill(one).join(',')}]`;
  assert.ok(file(10_001).length < 50_000_000);
  assert.equal(parseRoundFile(file(10_000)).length, 10_000);
  assert.throws(() => parseRoundFile(file(10_001)), (e: unknown) => e instanceof UnknownLayoutError && /whole file/.test(e.message));
  assert.equal(parseRoundFile(file(9_999)).length, 9_999);
});

test('Z5. a record that is over the limit by itself is still refused by the per-record limit, and small calls are unaffected', () => {
  const big = rec({ A: new Array(90_000).fill(0), B: new Array(90_000).fill(0), C: new Array(90_000).fill(0) });
  assert.throws(() => new RoundBook().ingest([big as unknown as ShotRecord]), (e: unknown) => e instanceof UnknownLayoutError && /more than 250000 values/.test(e.message));
  assert.equal(new RoundBook().ingest(listing(rec(), 20_000)).added, 1);
});
