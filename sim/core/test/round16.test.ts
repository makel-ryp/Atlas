import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScorecard } from '../src/index.js';
import { nodeFiles } from '../../cli/files.js';

const RECORDING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');

/** Runs `body` with a folder of its own under the system temp folder, removed afterwards. No path is ever put in a message. */
function inTempDir(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'zzsim-r16-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bytes whose value depends on the position, so a misplaced or repeated chunk shows. */
function pattern(n: number): Buffer {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 8)) & 0xff;
  return b;
}

test('Z14. size() reports the file as opened, not whatever is at the path now', () => {
  inTempDir((dir) => {
    const path = join(dir, 'round.dat');
    writeFileSync(path, pattern(100));
    const f = nodeFiles.open(path);
    try {
      assert.equal(f.size(), 100);
      let renamed = true;
      try {
        renameSync(path, join(dir, 'moved.dat'));
      } catch (e) {
        renamed = false;
        // this PC refused to rename an open file: say so with the code, and test the append form instead
        console.log(`# rename of an open file refused: ${(e as { code?: string }).code}`);
      }
      if (renamed) {
        writeFileSync(path, pattern(5000));
        assert.equal(f.size(), 100, 'the opened file, not the larger file now at the path');
        assert.deepEqual(f.read(10_000), pattern(100), 'the bytes too come from the opened file');
      } else {
        appendFileSync(path, pattern(50));
        assert.equal(f.size(), 150, 'size follows the opened file when it grows');
      }
    } finally {
      f.close();
    }
  });
});

test('Z15. read(maxBytes) returns at most maxBytes from the start, and the whole file across chunks', () => {
  inTempDir((dir) => {
    const small = join(dir, 'small.dat');
    writeFileSync(small, pattern(10));
    const f = nodeFiles.open(small);
    try {
      assert.deepEqual(f.read(4), pattern(10).subarray(0, 4), 'exactly the first 4 bytes of a longer file');
      assert.deepEqual(f.read(4), pattern(10).subarray(0, 4), 'again from the start');
      assert.equal(f.read(1000).length, 10, 'a limit above the size gives the file');
      assert.equal(f.read(0).length, 0);
    } finally {
      f.close();
    }
    // a file over 1 MiB: more than one chunk
    const big = join(dir, 'big.dat');
    const content = pattern(2 * 1024 * 1024 + 12_345);
    writeFileSync(big, content);
    const g = nodeFiles.open(big);
    try {
      assert.equal(g.size(), content.length);
      assert.ok(content.length > 2 * (1 << 20));
      const all = g.read(50_000_001);
      assert.equal(all.length, content.length);
      assert.ok(Buffer.from(all).equals(content), 'byte for byte');
      // a limit that ends inside the second chunk
      const part = g.read((1 << 20) + 7);
      assert.equal(part.length, (1 << 20) + 7);
      assert.ok(Buffer.from(part).equals(content.subarray(0, (1 << 20) + 7)));
    } finally {
      g.close();
    }
  });
});

test('Z16. after close() a further size() or read() throws', () => {
  inTempDir((dir) => {
    const path = join(dir, 'round.dat');
    writeFileSync(path, pattern(20));
    const f = nodeFiles.open(path);
    assert.equal(f.size(), 20);
    f.close();
    assert.throws(() => f.size());
    assert.throws(() => f.read(10));
  });
});

test('Z17. a missing path and a folder each fail with a code the command turns into its one-line message', () => {
  inTempDir((dir) => {
    mkdirSync(join(dir, 'afolder'));
    const missing = runScorecard(join(dir, 'none.dat'), nodeFiles, RECORDING_DIR);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, '');
    assert.equal(missing.stderr, 'Cannot read none.dat (ENOENT)');
    const folder = runScorecard(join(dir, 'afolder'), nodeFiles, RECORDING_DIR);
    assert.equal(folder.exitCode, 1);
    assert.equal(folder.stdout, '');
    assert.match(folder.stderr, /^Cannot read afolder \([A-Z]+\)$/);
    assert.ok(!folder.stderr.includes(dir));
    // and the adapter itself throws an error with a string code for each
    for (const p of [join(dir, 'none.dat'), join(dir, 'afolder')]) {
      let code: unknown;
      try {
        const f = nodeFiles.open(p);
        try {
          f.read(10);
        } finally {
          f.close();
        }
      } catch (e) {
        code = (e as { code?: unknown }).code;
      }
      assert.equal(typeof code, 'string');
    }
  });
});

test('Z18. the real command reads a small round file through the real handle', () => {
  inTempDir((dir) => {
    const path = join(dir, 'ok.dat');
    writeFileSync(
      path,
      JSON.stringify([
        { ShotID: 's', UserGuid: 'g', PlayerName: 'ZZTEST-A', CourseKey: 'c', RoundID: 1, Hole: 0, HoleShot: 4, HolePar: 4, HoleResult: 7, ShotResult: 0 },
      ]),
    );
    const res = runScorecard(path, nodeFiles, RECORDING_DIR);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, 'Round 1  c\nP1 ZZTEST-A | hole 1: 4  total 4');
  });
});
