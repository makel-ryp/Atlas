import { isDeepStrictEqual } from 'node:util';
import { validateRecord } from './parse.js';
import { normalisedName } from './text.js';
import type { ShotRecord } from './parse.js';

/** GSPro's HoleResult value that marks the hole as finished. */
const HOLE_FINISHED = 7;

export interface IngestCounts {
  added: number;
  revised: number;
  unchanged: number;
  /** Records refused because a shot would have changed owner or round, or one call repeated a ShotID with other content. */
  conflicts: number;
}

/** What the book refused or flagged. Only these three fields: no other text from the file. */
export interface BookIssue {
  kind: 'shot_owner_changed' | 'duplicate_shot_in_copy';
  /** The round the refused record claimed. */
  roundId: number;
  shotId: string;
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
  /**
   * True when a person should look at the hole: two finishing records disagree (the higher is reported),
   * a record holds a HoleShot above the finished score, or the records disagree on HolePar.
   */
  needsReview: boolean;
}

export interface PlayerScore {
  /** 1, 2, ... in the order the players were first seen in the round. */
  playerNumber: number;
  userGuid: string;
  name: string;
  holes: HoleScore[];
  /** Sum of finished holes only. */
  total: number;
  /** True when any hole is flagged, or the same UserGuid arrived under two names in the round. */
  needsReview: boolean;
}

export interface RoundScore {
  roundId: number;
  /** The course key of the first record seen. */
  courseKey: string;
  /** Every distinct course key seen in the round, in the order first seen. */
  courseKeys: string[];
  /**
   * True when any player is flagged, the records name more than one course, two players share a name (by normalisedName),
   * or the book refused a record that touched this round.
   */
  needsReview: boolean;
  players: PlayerScore[];
}

/** Holds the records it has been given, keyed by ShotID, and works out the scores on demand. */
export class RoundBook {
  // Map: ShotID text comes from the file and must never become an object key.
  private readonly shots = new Map<string, ShotRecord>();
  private readonly issueList: BookIssue[] = [];
  private readonly issueKeys = new Set<string>();
  private readonly conflictRounds = new Set<number>();

  /**
   * Two passes: first decide what every record would do (this is where anything can throw), then change the book.
   * A call that throws leaves the book exactly as it was.
   */
  ingest(records: readonly ShotRecord[]): IngestCounts {
    const counts: IngestCounts = { added: 0, revised: 0, unchanged: 0, conflicts: 0 };
    const staged = new Map<string, ShotRecord>();
    // The first record with each ShotID in this call. Every repeat is judged against it, never against the book.
    const firstInCall = new Map<string, ShotRecord>();
    const found: Array<{ issue: BookIssue; rounds: number[] }> = [];
    for (const [i, rec] of records.entries()) {
      validateRecord(rec, `record ${i}`);
      const first = firstInCall.get(rec.ShotID);
      if (first !== undefined) {
        if (isDeepStrictEqual(first, rec)) {
          counts.unchanged++;
        } else {
          found.push({ issue: { kind: 'duplicate_shot_in_copy', roundId: rec.RoundID, shotId: rec.ShotID }, rounds: [first.RoundID, rec.RoundID] });
          counts.conflicts++;
        }
        continue;
      }
      firstInCall.set(rec.ShotID, rec);
      const held = this.shots.get(rec.ShotID);
      if (held === undefined) {
        staged.set(rec.ShotID, rec);
        counts.added++;
      } else if (isDeepStrictEqual(held, rec)) {
        counts.unchanged++;
      } else if (held.UserGuid !== rec.UserGuid || held.RoundID !== rec.RoundID) {
        found.push({ issue: { kind: 'shot_owner_changed', roundId: rec.RoundID, shotId: rec.ShotID }, rounds: [held.RoundID, rec.RoundID] });
        counts.conflicts++;
      } else {
        staged.set(rec.ShotID, rec);
        counts.revised++;
      }
    }

    for (const [id, rec] of staged) this.shots.set(id, rec);
    for (const { issue, rounds } of found) {
      const key = `${issue.kind}\u0000${issue.roundId}\u0000${issue.shotId}`;
      if (!this.issueKeys.has(key)) {
        this.issueKeys.add(key);
        this.issueList.push(issue);
      }
      for (const r of rounds) this.conflictRounds.add(r);
    }
    return counts;
  }

  /** What the book refused or flagged so far. */
  issues(): BookIssue[] {
    return this.issueList.map((i) => ({ ...i }));
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
      parsDisagree: boolean;
      maxShot: number;
      finishing: number[];
    }
    interface PlayerAcc {
      name: string;
      namesDisagree: boolean;
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
        player = { name: r.PlayerName, namesDisagree: false, holes: new Map() };
        round.players.set(r.UserGuid, player);
      } else if (player.name !== r.PlayerName) {
        player.namesDisagree = true;
      }
      let hole = player.holes.get(r.Hole);
      if (!hole) {
        hole = { par: r.HolePar, parsDisagree: false, maxShot: r.HoleShot, finishing: [] };
        player.holes.set(r.Hole, hole);
      } else if (hole.par !== r.HolePar) {
        hole.parsDisagree = true;
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
                needsReview: new Set(acc.finishing).size > 1 || acc.maxShot > score || acc.parsDisagree,
              };
            }
            return { hole: h + 1, par: acc.par, status: 'in_play', strokes: null, strokesSoFar: acc.maxShot, needsReview: acc.parsDisagree };
          });
        let total = 0;
        for (const h of holes) if (h.strokes !== null) total += h.strokes;
        players.push({ playerNumber: players.length + 1, userGuid, name: p.name, holes, total, needsReview: p.namesDisagree || holes.some((h) => h.needsReview) });
      }
      const names = players.map((p) => normalisedName(p.name));
      out.push({
        roundId,
        courseKey: round.courseKeys[0]!,
        courseKeys: [...round.courseKeys],
        needsReview:
          round.courseKeys.length > 1 ||
          players.some((p) => p.needsReview) ||
          new Set(names).size < names.length ||
          this.conflictRounds.has(roundId),
        players,
      });
    }
    return out;
  }
}
