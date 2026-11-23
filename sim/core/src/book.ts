import { isDeepStrictEqual } from 'node:util';
import type { ShotRecord } from './parse.js';

/** GSPro's HoleResult value that marks the hole as finished. */
const HOLE_FINISHED = 7;

export interface IngestCounts {
  added: number;
  revised: number;
  unchanged: number;
}

export interface HoleScore {
  /** Hole number as a golfer reads it: GSPro's `Hole` plus one. */
  hole: number;
  par: number;
  status: 'finished' | 'in_play';
  /** The score when finished, otherwise null. */
  strokes: number | null;
  /** The highest HoleShot seen for the hole (the score itself when finished). */
  strokesSoFar: number;
  /** True when two finishing records disagreed (the higher is reported). */
  needsReview: boolean;
}

export interface PlayerScore {
  userGuid: string;
  name: string;
  holes: HoleScore[];
  /** Sum of finished holes only. */
  total: number;
}

export interface RoundScore {
  roundId: number;
  /** The course key of the first record seen. */
  courseKey: string;
  /** Every distinct course key seen in the round, in the order first seen. */
  courseKeys: string[];
  /** True when the round's records name more than one course. */
  needsReview: boolean;
  players: PlayerScore[];
}

/** Holds the records it has been given, keyed by ShotID, and works out the scores on demand. */
export class RoundBook {
  // Map: ShotID text comes from the file and must never become an object key.
  private readonly shots = new Map<string, ShotRecord>();

  ingest(records: readonly ShotRecord[]): IngestCounts {
    const counts: IngestCounts = { added: 0, revised: 0, unchanged: 0 };
    for (const rec of records) {
      const prior = this.shots.get(rec.ShotID);
      if (prior === undefined) {
        this.shots.set(rec.ShotID, rec);
        counts.added++;
      } else if (isDeepStrictEqual(prior, rec)) {
        counts.unchanged++;
      } else {
        this.shots.set(rec.ShotID, rec);
        counts.revised++;
      }
    }
    return counts;
  }

  /** Practice-range records (negative RoundID) belong to no round. */
  get rangeShots(): number {
    let n = 0;
    for (const r of this.shots.values()) if (r.RoundID < 0) n++;
    return n;
  }

  rounds(): RoundScore[] {
    interface HoleAcc {
      par: number;
      maxShot: number;
      finishing: number[];
    }
    interface PlayerAcc {
      name: string;
      holes: Map<number, HoleAcc>;
    }
    interface RoundAcc {
      courseKeys: string[];
      players: Map<string, PlayerAcc>;
    }
    const rounds = new Map<number, RoundAcc>();
    for (const r of this.shots.values()) {
      if (r.RoundID < 0) continue;
      let round = rounds.get(r.RoundID);
      if (!round) {
        round = { courseKeys: [], players: new Map() };
        rounds.set(r.RoundID, round);
      }
      if (!round.courseKeys.includes(r.CourseKey)) round.courseKeys.push(r.CourseKey);
      let player = round.players.get(r.UserGuid);
      if (!player) {
        player = { name: r.PlayerName, holes: new Map() };
        round.players.set(r.UserGuid, player);
      }
      let hole = player.holes.get(r.Hole);
      if (!hole) {
        hole = { par: r.HolePar, maxShot: r.HoleShot, finishing: [] };
        player.holes.set(r.Hole, hole);
      }
      if (r.HoleShot > hole.maxShot) hole.maxShot = r.HoleShot;
      if (r.HoleResult === HOLE_FINISHED) hole.finishing.push(r.HoleShot);
    }

    const out: RoundScore[] = [];
    for (const [roundId, round] of rounds) {
      const players: PlayerScore[] = [];
      for (const [userGuid, p] of round.players) {
        const holes: HoleScore[] = [...p.holes.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([h, acc]): HoleScore => {
            if (acc.finishing.length > 0) {
              const score = Math.max(...acc.finishing);
              return {
                hole: h + 1,
                par: acc.par,
                status: 'finished',
                strokes: score,
                strokesSoFar: score,
                needsReview: new Set(acc.finishing).size > 1,
              };
            }
            return { hole: h + 1, par: acc.par, status: 'in_play', strokes: null, strokesSoFar: acc.maxShot, needsReview: false };
          });
        let total = 0;
        for (const h of holes) if (h.strokes !== null) total += h.strokes;
        players.push({ userGuid, name: p.name, holes, total });
      }
      out.push({
        roundId,
        courseKey: round.courseKeys[0]!,
        courseKeys: [...round.courseKeys],
        needsReview: round.courseKeys.length > 1,
        players,
      });
    }
    return out;
  }
}
