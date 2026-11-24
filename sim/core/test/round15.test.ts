import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoundBook, UnknownLayoutError, loadRecording, parseRoundFile, formatScorecard, runScorecard } from '../src/index.js';
import type { FileAccess, ShotRecord } from '../src/index.js';

const RECORDING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gspro-4.1.13/2026-11-23');
const LIMIT = 50_000_000;

/** A hand-made record. Placeholders only: made-up ids, test names. */
function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ShotID: 'shot-1',
    UserGuid: 'guid-1',
    PlayerName: 'ZZTEST-A',
    CourseKey: 'c',
    RoundID: 1,
    Hole: 0,
    HoleShot: 1,
    HolePar: 4,
    HoleResult: 0,
    ShotResult: 0,
    ...over,
  };
}

function feed(b: RoundBook, copy: Array<Record<string, unknown>>) {
  return b.ingest(parseRoundFile(JSON.stringify(copy)));
}

// ---------------------------------------------------------------- A. a player keeps the first name seen

test('Z1. a later read that renames a player keeps the first name, flags the player and the round, and still applies the revision', () => {
  const a1 = rec({ ShotID: 'a1', HoleShot: 3, HoleResult: 7 });
  const b = new RoundBook();
  feed(b, [a1]);
  assert.equal(b.rounds()[0]!.players[0]!.needsReview, false);
  const counts = feed(b, [{ ...a1, PlayerName: 'ZZTEST-B', HoleShot: 4 }]);
  assert.equal(counts.revised, 1);
  const r = b.rounds()[0]!;
  assert.equal(r.players[0]!.name, 'ZZTEST-A');
  assert.equal(r.players[0]!.needsReview, true);
  assert.equal(r.needsReview, true);
  assert.equal(r.players[0]!.total, 4, 'the score follows the newest record');
  const line = formatScorecard(b).split('\n')[1]!;
  assert.ok(line.startsWith('P1 ZZTEST-A | '), line);
  assert.match(line, /\(needs review\)$/);
  assert.deepEqual(b.issues(), [], 'no new issue kind: the flag is the mark');
});

test('Z2. every record of a player renamed in a later read: still the first name, flagged', () => {
  const a1 = rec({ ShotID: 'a1' });
  const a2 = rec({ ShotID: 'a2', Hole: 1 });
  const b = new RoundBook();
  feed(b, [a1, a2]);
  const counts = feed(b, [{ ...a1, PlayerName: 'ZZTEST-B' }, { ...a2, PlayerName: 'ZZTEST-B' }]);
  assert.equal(counts.revised, 2);
  const p = b.rounds()[0]!.players[0]!;
  assert.equal(p.name, 'ZZTEST-A');
  assert.equal(p.needsReview, true);
  assert.ok(formatScorecard(b).split('\n')[1]!.startsWith('P1 ZZTEST-A | '));
});

test('Z3. a rename that is read and then read back to the first name keeps the first name and the flag', () => {
  const a1 = rec({ ShotID: 'a1' });
  const b = new RoundBook();
  feed(b, [a1]);
  feed(b, [{ ...a1, PlayerName: 'ZZTEST-B' }]);
  const counts = feed(b, [{ ...a1, PlayerName: 'ZZTEST-A', HoleShot: 2 }]);
  assert.equal(counts.revised, 1);
  const p = b.rounds()[0]!.players[0]!;
  assert.equal(p.name, 'ZZTEST-A');
  assert.equal(p.needsReview, true, 'the flag is kept once a differing name was accepted');
  assert.equal(b.rounds()[0]!.needsReview, true);
});

test('Z4. a refused record with another name sets no name and adds no player flag of its own', () => {
  const b = new RoundBook();
  feed(b, [rec({ ShotID: 's1', UserGuid: 'guid-1', PlayerName: 'ZZTEST-A' })]);
  // same ShotID under another player: refused as a conflict
  const counts = feed(b, [rec({ ShotID: 's1', UserGuid: 'guid-2', PlayerName: 'ZZTEST-B' })]);
  assert.equal(counts.conflicts, 1);
  assert.equal(b.rounds()[0]!.players.length, 1);
  assert.equal(b.rounds()[0]!.players[0]!.needsReview, false, 'the player of the held record is not flagged by the refused one');
  // the refused record's name was not kept for guid-2: its first accepted record decides
  feed(b, [rec({ ShotID: 's2', UserGuid: 'guid-2', PlayerName: 'ZZTEST-C' })]);
  const p2 = b.rounds()[0]!.players.find((p) => p.userGuid === 'guid-2')!;
  assert.equal(p2.name, 'ZZTEST-C');
  assert.equal(p2.needsReview, false);
  // inside one call a repeat refused as a conflict does not flag the player either
  const d = new RoundBook();
  feed(d, [rec({ ShotID: 'd1', HoleShot: 3 }), rec({ ShotID: 'd1', HoleShot: 4, PlayerName: 'ZZTEST-B' })]);
  assert.equal(d.rounds()[0]!.players[0]!.name, 'ZZTEST-A');
  assert.equal(d.rounds()[0]!.players[0]!.needsReview, false);
});

test('Z5. a call that throws sets no name', () => {
  const b = new RoundBook();
  const good = parseRoundFile(JSON.stringify([rec({ ShotID: 'g1', UserGuid: 'guid-9', PlayerName: 'ZZTEST-A' })]));
  assert.throws(() => b.ingest([good[0]!, { ShotID: 'broken' } as unknown as ShotRecord]), UnknownLayoutError);
  assert.deepEqual(b.rounds(), []);
  feed(b, [rec({ ShotID: 'g2', UserGuid: 'guid-9', PlayerName: 'ZZTEST-B' })]);
  const p = b.rounds()[0]!.players[0]!;
  assert.equal(p.name, 'ZZTEST-B', 'the name of the call that threw was not kept');
  assert.equal(p.needsReview, false);
});

test('Z6. the first name is per round: the same guid in another round starts its own', () => {
  const b = new RoundBook();
  feed(b, [rec({ ShotID: 'r1', RoundID: 1, PlayerName: 'ZZTEST-A' }), rec({ ShotID: 'r2', RoundID: 2, PlayerName: 'ZZTEST-B' })]);
  const rounds = b.rounds();
  assert.deepEqual(rounds.map((r) => [r.players[0]!.name, r.players[0]!.needsReview]), [['ZZTEST-A', false], ['ZZTEST-B', false]]);
});

// ---------------------------------------------------------------- B. one open, never more than the limit read

interface Probe {
  opened: number;
  closed: number;
  sizeCalls: number;
  readAsked: number[];
}

/** A file handle that logs what is asked of it. `bytes` is what read can give; read never returns more than it is asked for. */
function files(spec: { size: number | (() => number); bytes?: Uint8Array; readThrows?: boolean; openThrows?: boolean }): { access: FileAccess; probe: Probe } {
  const probe: Probe = { opened: 0, closed: 0, sizeCalls: 0, readAsked: [] };
  const access: FileAccess = {
    open() {
      if (spec.openThrows) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
      probe.opened++;
      return {
        size() {
          probe.sizeCalls++;
          return typeof spec.size === 'function' ? spec.size() : spec.size;
        },
        read(maxBytes: number) {
          probe.readAsked.push(maxBytes);
          if (spec.readThrows) throw Object.assign(new Error('io'), { code: 'EIO' });
          return (spec.bytes ?? new Uint8Array(0)).subarray(0, maxBytes);
        },
        close() {
          probe.closed++;
        },
      };
    },
  };
  return { access, probe };
}

const TOO_LARGE = `the file is larger than ${LIMIT} bytes`;

test('Z7. a file whose size says small but whose read returns one byte over the limit is refused, and read was asked for no more than the limit plus one', () => {
  const { access, probe } = files({ size: 10, bytes: new Uint8Array(LIMIT + 5) });
  const res = runScorecard('/some/where/grown.dat', access, RECORDING_DIR);
  assert.equal(res.exitCode, 1);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, `Cannot read grown.dat: ${TOO_LARGE}`);
  assert.equal(probe.opened, 1, 'one open');
  assert.deepEqual(probe.readAsked, [LIMIT + 1]);
  assert.equal(probe.closed, 1);
});

test('Z8. a file over the limit by size() is refused with read never called, and the handle is closed', () => {
  const { access, probe } = files({ size: LIMIT + 1, bytes: new Uint8Array(4) });
  const res = runScorecard('/p/big.dat', access, RECORDING_DIR);
  assert.equal(res.exitCode, 1);
  assert.equal(res.stderr, `Cannot read big.dat: ${TOO_LARGE}`);
  assert.deepEqual(probe.readAsked, [], 'read was never called');
  assert.equal(probe.opened, 1);
  assert.equal(probe.closed, 1);
});

test('Z9. the handle is closed on every path, including a throwing read, and the file is opened once', () => {
  const json = Buffer.from(JSON.stringify([rec()]));
  const paths: Array<[string, ReturnType<typeof files>]> = [
    ['read ok', files({ size: json.length, bytes: json })],
    ['over by size', files({ size: LIMIT + 1 })],
    ['over after read', files({ size: 1, bytes: new Uint8Array(LIMIT + 1) })],
    ['read throws', files({ size: 5, readThrows: true })],
    [
      'size throws',
      files({
        size: () => {
          throw Object.assign(new Error('x'), { code: 'EIO' });
        },
      }),
    ],
    ['not a round file', files({ size: 4, bytes: Buffer.from('nope') })],
  ];
  for (const [label, { access, probe }] of paths) {
    runScorecard('/p/f.dat', access, RECORDING_DIR);
    assert.equal(probe.opened, 1, `${label}: opened once`);
    assert.equal(probe.closed, 1, `${label}: closed`);
  }
  const thrown = runScorecard('/p/f.dat', files({ size: 5, readThrows: true }).access, RECORDING_DIR);
  assert.equal(thrown.stderr, 'Cannot read f.dat (EIO)');
  // a path that cannot be opened has no handle to close
  const missing = files({ size: 0, openThrows: true });
  const res = runScorecard('/p/none.dat', missing.access, RECORDING_DIR);
  assert.equal(res.stderr, 'Cannot read none.dat (ENOENT)');
  assert.equal(missing.probe.closed, 0);
});

test('Z10. multi-byte characters under the limit in characters and over it in bytes are refused, by size() and by what read returns', () => {
  // 17,000,000 euro signs: 17,000,000 characters (under 50,000,000), 51,000,000 bytes (over)
  const bytes = Buffer.from('€'.repeat(17_000_000));
  assert.equal(bytes.length, 51_000_000);
  const bySize = files({ size: bytes.length, bytes });
  const r1 = runScorecard('/p/wide.dat', bySize.access, RECORDING_DIR);
  assert.equal(r1.stderr, `Cannot read wide.dat: ${TOO_LARGE}`);
  assert.deepEqual(bySize.probe.readAsked, []);
  const byRead = files({ size: 100, bytes });
  const r2 = runScorecard('/p/wide.dat', byRead.access, RECORDING_DIR);
  assert.equal(r2.stderr, `Cannot read wide.dat: ${TOO_LARGE}`);
  assert.equal(byRead.probe.closed, 1);
});

test('Z11. a file within the limit is decoded as UTF-8 and scored; exactly the limit is not refused for size', () => {
  const text = JSON.stringify([rec({ PlayerName: 'ZZTEST-Ä', HoleShot: 4, HoleResult: 7 })]);
  const { access, probe } = files({ size: Buffer.byteLength(text), bytes: Buffer.from(text) });
  const res = runScorecard('/p/ok.dat', access, RECORDING_DIR);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, 'Round 1  c\nP1 ZZTEST-Ä | hole 1: 4  total 4');
  assert.deepEqual(probe.readAsked, [LIMIT + 1]);
  const edge = files({ size: LIMIT, bytes: new Uint8Array(LIMIT) });
  const atLimit = runScorecard('/p/edge.dat', edge.access, RECORDING_DIR);
  assert.ok(!/larger than/.test(atLimit.stderr), atLimit.stderr);
});

// ---------------------------------------------------------------- C. each capture has its own records

test('Z12. no record object is shared between two captures, and changing one leaves every other capture as it was', () => {
  const copies = loadRecording(RECORDING_DIR);
  // every object and array reached from every record of every capture, at every depth: none may be reached twice
  const seen = new Map<object, string>();
  let reached = 0;
  const walk = (v: unknown, where: string): void => {
    if (typeof v !== 'object' || v === null) return;
    const before = seen.get(v);
    assert.equal(before, undefined, `an object reached from ${where} is also reached from ${before}`);
    seen.set(v, where);
    reached++;
    for (const child of Object.values(v)) walk(child, where);
  };
  let records = 0;
  for (const c of copies) {
    // the walk goes through the capture's array and into every record, so two records of one capture are covered too
    walk(c.records, `capture ${c.number}`);
    records += c.records.length;
  }
  assert.ok(records > 100, `found ${records} records`);
  assert.ok(reached > records * 2, `reached ${reached} objects: nested ones were walked`);
  // a nested value changed in the last capture leaves every earlier capture as it was
  const snapshot = structuredClone(copies);
  const round19 = copies.filter((c) => c.round === 19);
  assert.ok(round19.length > 2);
  const last = round19.at(-1)!;
  const first = last.records[0]! as unknown as Record<string, unknown>;
  const nestedKey = Object.keys(first).find((k) => typeof first[k] === 'object' && first[k] !== null);
  assert.ok(nestedKey !== undefined, 'a record holds a nested value');
  const nested = first[nestedKey!] as Record<string, unknown>;
  const leaf = Object.keys(nested)[0]!;
  nested[leaf] = 'ZZTEST-B';
  last.records[0]!.HoleShot = 999;
  for (const c of round19.slice(0, -1)) {
    const s = snapshot.find((x) => x.number === c.number)!;
    assert.deepEqual(c.records, s.records, `capture ${c.number} unchanged`);
  }
  // a second load is independent of the first
  assert.deepEqual(loadRecording(RECORDING_DIR), snapshot);
});

// ---------------------------------------------------------------- D. the file name is cleaned before it is printed

test('Z13. a file name holding a line break or a right-to-left override prints on one line with no such character', () => {
  const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
  const names = ['two\nlines.dat', 'a\r\nb.dat', 'sep arator.dat', 'rtl‮tad.dat'];
  for (const n of names) {
    // the read fails: one line, code only
    const missing = runScorecard(`/p/${n}`, files({ size: 0, openThrows: true }).access, RECORDING_DIR);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr.split('\n').length, 1, JSON.stringify(missing.stderr));
    assert.ok(!FORBIDDEN.test(missing.stderr), JSON.stringify(missing.stderr));
    assert.match(missing.stderr, /\(ENOENT\)$/);
    // the file is over the limit
    const big = runScorecard(`/p/${n}`, files({ size: LIMIT + 1 }).access, RECORDING_DIR);
    assert.equal(big.stderr.split('\n').length, 1, JSON.stringify(big.stderr));
    assert.ok(!FORBIDDEN.test(big.stderr), JSON.stringify(big.stderr));
    assert.match(big.stderr, /larger than 50000000 bytes$/);
  }
});
