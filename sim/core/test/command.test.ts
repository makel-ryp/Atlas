import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issuesLine, runScorecard, type FileAccess } from '../src/command.js';

const RECORDING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ShotID: 'shot-1',
    UserGuid: 'guid-1',
    PlayerName: 'ZZTEST-A',
    CourseKey: 'test_course',
    RoundID: 1,
    Hole: 0,
    HoleShot: 4,
    HolePar: 4,
    HoleResult: 7,
    ShotResult: 0,
    ...over,
  };
}

/** A file system that holds text in memory and records every call. */
function fake(files: Record<string, string>, sizeOf?: (p: string) => number) {
  const calls: string[] = [];
  const access: FileAccess = {
    open(p) {
      calls.push(`open ${p}`);
      const t = files[p];
      if (t === undefined) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
      return {
        size() {
          calls.push('size');
          return sizeOf ? sizeOf(p) : Buffer.byteLength(t);
        },
        read(maxBytes) {
          calls.push(`read ${maxBytes}`);
          return Buffer.from(t).subarray(0, maxBytes);
        },
        close() {
          calls.push('close');
        },
      };
    },
  };
  return { access, calls };
}

test('N23. a file over 50,000,000 bytes is refused before anything is read', () => {
  const { access, calls } = fake({ '/some/where/big.dat': 'x' }, () => 50_000_001);
  const res = runScorecard('/some/where/big.dat', access, RECORDING_DIR);
  assert.equal(res.exitCode, 1);
  assert.equal(res.stdout, '');
  assert.deepEqual(calls, ['open /some/where/big.dat', 'size', 'close'], 'only the size was asked for; the file was never read');
  assert.match(res.stderr, /big\.dat/);
  assert.ok(!res.stderr.includes('/some/where'));
  assert.equal(res.stderr.trim().split('\n').length, 1);
  // exactly at the limit it is read
  const edge = fake({ '/p/edge.dat': '[]' }, () => 50_000_000);
  runScorecard('/p/edge.dat', edge.access, RECORDING_DIR);
  assert.deepEqual(edge.calls, ['open /p/edge.dat', 'size', 'read 50000001', 'close']);
});

test('K1. a read failure prints one line with the base name and the error code only', () => {
  const { access } = fake({});
  const res = runScorecard('/secret/folder/missing.dat', access, RECORDING_DIR);
  assert.equal(res.exitCode, 1);
  assert.equal(res.stderr.trim(), 'Cannot read missing.dat (ENOENT)');
});

test('K2. with no issues the command prints the rounds and nothing extra', () => {
  const text = JSON.stringify([rec()]);
  const res = runScorecard('/p/ok.dat', fake({ '/p/ok.dat': text }).access, RECORDING_DIR);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, 'Round 1  test_course\nP1 ZZTEST-A | hole 1: 4  total 4');
  assert.ok(!res.stdout.includes('Issues'));
});

test('K3. refused records are reported as one Issues line with the count of each kind, fixed words only', () => {
  const text = JSON.stringify([
    rec({ ShotID: 'SECRET-SHOT-1' }),
    rec({ ShotID: 'SECRET-SHOT-1', HoleShot: 5 }),
    rec({ ShotID: 'SECRET-SHOT-2', Hole: 1 }),
    rec({ ShotID: 'SECRET-SHOT-2', Hole: 1, UserGuid: 'guid-2', PlayerName: 'SECRET-NAME' }),
  ]);
  const res = runScorecard('/p/bad.dat', fake({ '/p/bad.dat': text }).access, RECORDING_DIR);
  assert.equal(res.exitCode, 0);
  const lines = res.stdout.split('\n');
  assert.equal(lines.at(-1), 'Issues: 2 (duplicate_shot_in_copy 2); records refused: 2');
  assert.ok(!res.stdout.includes('SECRET-SHOT') && !res.stdout.includes('SECRET-NAME'));
  assert.equal(lines.filter((l) => l.startsWith('Issues')).length, 1);
});

test('K3b. the Issues line counts each kind, in alphabetical order', () => {
  const issue = (kind: 'shot_owner_changed' | 'duplicate_shot_in_copy', shotId: string) => ({ kind, roundId: 1, shotId });
  assert.equal(
    issuesLine([issue('shot_owner_changed', 'a'), issue('duplicate_shot_in_copy', 'b'), issue('shot_owner_changed', 'c')]),
    'Issues: 3 (duplicate_shot_in_copy 1, shot_owner_changed 2)',
  );
  assert.equal(issuesLine([]), undefined);
  assert.equal(issuesLine([issue('shot_owner_changed', 'a')], 4), 'Issues: 1 (shot_owner_changed 1); records refused: 4');
});

test('K4. the recording prints the known scores with player numbers, no mark and no Issues line', () => {
  const res = runScorecard(undefined, fake({}).access, RECORDING_DIR);
  assert.equal(res.exitCode, 0);
  assert.equal(
    res.stdout,
    [
      'Round 18  bluejack_gsp',
      'P1 ZZTEST-A | hole 1: in play (1 stroke)  total 0',
      'P2 ZZTEST-B | hole 1: in play (1 stroke)  total 0',
      'Round 19  bluejack_gsp',
      'P1 ZZTEST-A | hole 3: 6  hole 12: 4  hole 15: 8  total 18',
      'P2 ZZTEST-B | hole 3: 5  hole 12: 5  hole 15: 10  total 20',
    ].join('\n'),
  );
});

test('K5. a file the reader refuses prints the error and exits 1', () => {
  const res = runScorecard('/p/x.dat', fake({ '/p/x.dat': 'not json' }).access, RECORDING_DIR);
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /UnknownLayoutError/);
  assert.equal(res.stdout, '');
});
