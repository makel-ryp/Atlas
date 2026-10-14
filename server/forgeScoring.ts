import {
  SCORING_VERSION,
  atgAllowance,
  drivingIndex,
  headScoredIndex,
  type CarryReference,
} from '@ryp/eco/scoring'

/**
 * FORGE's route-side rules: the vocabulary of what may be submitted, the arithmetic that is NOT in
 * `@ryp/eco/scoring`, the ladder's decision function, and calendar arithmetic. Everything here is
 * PURE — no I/O, no clock — so it can be exercised without a database.
 *
 * ─── 🔴 THE ONE PLACE THIS FILE COPIES NUMBERS THE SCORING MODULE DOES NOT OWN ────────────────
 * `headScoredIndex` takes `base` and `slope` from its caller; `@ryp/eco/scoring` does not hold the
 * per-level tables. They are copied here from Build Spec §2.2 ("Copy the numbers; do not re-derive
 * them"), and the prototype's `FACETS` array agrees with them. Consequence, stated rather than
 * hidden: **`SCORING_VERSION` does not cover these constants.** Change one and the module's
 * fingerprint test will not notice. HEAD_SCORED_CAL_VERSION is stamped into `facet_scores.meta` on
 * every head-scored row so a stored index can be told apart from one computed under a later table,
 * and the proper fix — moving these into eco's CAL under SCORING_VERSION — is an eco change, not a
 * route change. It is carried to the report as an open item.
 *
 * Outcome values are bounds-checked PER FACET, not per level. Spec §2.4 and the prototype disagree
 * on the exact option sets (approach L2: spec "eagle −2", prototype "birdie −1"), and rejecting a
 * legitimate submission on a disagreement between two documents would be a worse failure than
 * accepting a value in the union range. The range is a plausibility guard, not an option-set check.
 */

export const HEAD_SCORED_CAL_VERSION = 'forge-route-cal-2026.10-1'

/** Mirrors the ladder's own contract: written on every rung and every rung event. */
export const LADDER_VERSION = 'forge-ladder-2026.10-1'

export type FacetName = 'driving' | 'approach' | 'chipping' | 'putting'

const HEAD_SCORED = {
  approach: { base: [20, 12, 5, 0], slope: 0.6 },
  chipping: { base: [20, 12, 5, 0], slope: 0.6 },
  makeables: { base: [8, 4, 1, -1], slope: 0.9 },
} as const

/** Build Spec §2.1. A weight system for COMBINING FACETS — not §7.2's predictor weights. */
export const FACET_WEIGHTS: Readonly<Record<FacetName, number>> = {
  driving: 0.3,
  approach: 0.35,
  chipping: 0.15,
  putting: 0.2,
}
export const FACET_NAMES: readonly FacetName[] = ['driving', 'approach', 'chipping', 'putting']

/** Plausibility bounds for `range_shots.outcome_value`. Driving is a column POSITION, not a stroke delta. */
export const OUTCOME_RANGE: Record<'driving' | 'approach' | 'chipping' | 'makeables', [number, number]> = {
  driving: [0, 4],
  approach: [-2, 3],
  chipping: [-2, 3],
  makeables: [-1, 1],
}

/** A drill is complete at 20 balls (Spec §3.4 — decided once, here, and written to is_complete). */
export const COMPLETE_SHOTS = 20
export const COMPLETE_HOLES = 18

// ─── What a (facet, mode) is ─────────────────────────────────────────────────────────────────

export const MODES_BY_FACET: Record<FacetName, readonly string[]> = {
  driving: ['stock', 'variable'],
  approach: ['stock', 'variable'],
  chipping: ['fairway', 'rough', 'bunker'],
  putting: ['putt18', 'makeables', 'lag', 'stroke'],
}

/**
 * The key a (facet, mode) carries on `golf.facet_rungs`, or null when it has no ladder.
 * Driving: none (§4). Approach: ONE rung, mode null — 'stock' and 'variable' are the same test.
 * Chipping: one rung PER LIE. Putting: Makeables only — Putt 18 measures, it does not promote
 * (Answers #24); lag and stroke test have no levels. The database enforces the same three rules
 * (`facet_rungs_mode_per_facet`, `facet_scores_level_only_where_a_ladder_exists`).
 */
export function rungKeyFor(
  facet: FacetName,
  mode: string | null,
): { facet: 'approach' | 'chipping' | 'putting'; mode: string | null } | null {
  if (facet === 'approach') return { facet, mode: null }
  if (facet === 'chipping' && mode) return { facet, mode }
  if (facet === 'putting' && mode === 'makeables') return { facet, mode }
  return null
}

// ─── Scoring one facet ───────────────────────────────────────────────────────────────────────

export interface ShotForScoring {
  outcome_value: number
  target_yds: number | null
}
export interface HoleForScoring {
  putts: number
}

export type WithheldReason =
  | 'too_few_shots'
  | 'no_carry_reference'
  | 'no_carry_distance'
  | 'putt18_calibration_provisional'
  | 'predictor_not_an_index'
  | 'no_scoring_defined'
  | 'invalid_zone'

export interface ScoredFacet {
  shotCount: number
  holesPlayed: number | null
  rawTotal: number | null
  isComplete: boolean
  /** The handicap-scaled index. NEVER set for a predictor, and never for Putt 18 yet. */
  practiceIndex: number | null
  /** A predictor's own score (Makeables). Never enters the composite. */
  predictorScore: number | null
  withheld: WithheldReason | null
  /** Frozen onto the driving row only; the CHECK forbids it elsewhere. */
  carry: { yds: number | null; ref: CarryReference | null } | null
}

export interface ScoreInput {
  facet: FacetName
  mode: string | null
  /** The level AS PLAYED (0-based rung), or null where no ladder exists. */
  level: number | null
  shots: readonly ShotForScoring[]
  holes: readonly HoleForScoring[]
  /** Tally Putt 18 only: there are no hole rows to count, so the client's claim is all there is. */
  tally: { holesPlayed: number; rawTotal: number } | null
  profile: { carryReference: CarryReference | null; driverCarryYds: number | null }
}

/**
 * Score one facet from what is STORED. Total over its inputs: every "cannot compute" answer is a
 * null with a named reason, never a default number (the scoring module's own rule, applied here).
 */
export function scoreFacet(i: ScoreInput): ScoredFacet {
  const base = {
    shotCount: 0,
    holesPlayed: null as number | null,
    rawTotal: null as number | null,
    isComplete: false,
    practiceIndex: null as number | null,
    predictorScore: null as number | null,
    withheld: null as WithheldReason | null,
    carry: null as ScoredFacet['carry'],
  }

  // Putt 18 is graded per HOLE, in feet. Completeness is 18 holes — NEVER a putt count, because a
  // round abandoned after six holes can already exceed 20 putts (Spec §3.4).
  if (i.facet === 'putting' && i.mode === 'putt18') {
    const holesPlayed = i.tally ? i.tally.holesPlayed : i.holes.length
    const rawTotal = i.tally ? i.tally.rawTotal : i.holes.reduce((a, h) => a + h.putts, 0)
    return {
      ...base,
      holesPlayed,
      rawTotal,
      isComplete: holesPlayed === COMPLETE_HOLES,
      // 🔴 NO INDEX. CAL.putt18.base is PROVISIONAL and ungated (scoring header, "NOT BUILT").
      // The measured half — expected_putts per hole, frozen at play by trigger — is stored and
      // forge_svc's recompute path is the backfill. Do not "helpfully" call putt18Handicap here.
      withheld: 'putt18_calibration_provisional',
    }
  }

  const shotCount = i.shots.length
  const complete = shotCount >= COMPLETE_SHOTS
  const total = i.shots.reduce((a, s) => a + s.outcome_value, 0)

  if (i.facet === 'driving') {
    const ref = i.profile.carryReference
    const yds = i.profile.driverCarryYds
    const carry = { yds: yds !== null && yds > 0 ? yds : null, ref }
    let withheld: WithheldReason | null = null
    let index: number | null = null
    if (shotCount < 5) withheld = 'too_few_shots'
    else if (ref === null) withheld = 'no_carry_reference'
    // baselineHandicap(null/0, ref) returns 30 — a plausible fabricated number. Refuse before it.
    else if (carry.yds === null) withheld = 'no_carry_distance'
    else {
      index = drivingIndex(
        i.shots.map((s) => s.outcome_value),
        carry.yds,
        ref,
      )
      if (index === null) withheld = 'invalid_zone'
    }
    return { ...base, shotCount, isComplete: complete, practiceIndex: index, withheld, carry }
  }

  if (i.facet === 'approach' || i.facet === 'chipping') {
    const cal = HEAD_SCORED[i.facet]
    const lvl = i.level ?? 0
    const b = cal.base[lvl]
    if (b === undefined) return { ...base, shotCount, rawTotal: total, isComplete: complete, withheld: 'no_scoring_defined' }
    // ATG's target pricing needs a distance for EVERY shot; one missing and the set is unpriced
    // (allowance 0), not partially priced. Short-sided flags are not stored, so none are assumed.
    const priced =
      i.facet === 'chipping' && shotCount > 0 && i.shots.every((s) => s.target_yds !== null)
    const allowance = priced
      ? atgAllowance({ distances: i.shots.map((s) => s.target_yds as number), rung: lvl, shots: shotCount })
      : 0
    const index = headScoredIndex({ total, shots: shotCount, base: b, slope: cal.slope, allowance })
    return {
      ...base,
      shotCount,
      rawTotal: total,
      isComplete: complete,
      practiceIndex: index,
      withheld: index === null ? 'too_few_shots' : null,
    }
  }

  if (i.facet === 'putting' && i.mode === 'makeables') {
    const cal = HEAD_SCORED.makeables
    const b = cal.base[i.level ?? 0]
    const score =
      b === undefined ? null : headScoredIndex({ total, shots: shotCount, base: b, slope: cal.slope })
    return {
      ...base,
      shotCount,
      rawTotal: total,
      isComplete: complete,
      predictorScore: score,
      withheld: 'predictor_not_an_index',
    }
  }

  // lag / stroke test: predictors with no scoring formula in the spec. Stored, not scored.
  return { ...base, shotCount, isComplete: complete, withheld: 'no_scoring_defined' }
}

// ─── The ladder ──────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 OFF, ON PURPOSE. The putting ladder runs on Makeables (Answers #24), but Makeables produces a
 * PREDICTOR score on its own scale (base [8, 4, 1, −1], one option set), and the spec never says what
 * it clears against. Compared with a handicap target, an all-par session scores 8 / 4 / 1 at L1 / L2 /
 * L3 — a "clear" at every rung for any realistic target, so a player would climb to the top in three
 * sessions on a number that means nothing. The scoring module ranks a plausible wrong number as the
 * worst failure here, so the rung is NOT moved and `ladder_skipped` says why. Turn this on only when
 * the clear criterion is specified (a Makeables-scale target, or a make-rate), and bump the ladder version.
 */
export const MAKEABLES_LADDER_ENABLED = false

export const MISSES_TO_DEMOTE = 3
export const TOP_RUNG = 3

export type LadderDecision =
  | { kind: 'none' }
  | { kind: 'promoted'; to: number }
  | { kind: 'demoted'; to: number }

/**
 * Spec §4: one clear promotes; three CONSECUTIVE misses demote; bounded at both ends; counters
 * reset on a level change. `priorMisses` is the number of unbroken misses immediately before this
 * session SINCE THE LAST RUNG EVENT (the caller applies that reset in its query). A session with no
 * value or no target is neither a clear nor a miss — it is not passed here.
 *
 * "Clear" is `value <= target`. For Makeables the value is the PREDICTOR score, because that is the
 * only number the drill produces and Answers #24 makes it the putting ladder; the spec does not say
 * what Makeables clears against, so this comparison is an inference that is reported, not settled.
 */
export function decideRung(pre: number, value: number, target: number, priorMisses: number): LadderDecision {
  if (value <= target) return pre < TOP_RUNG ? { kind: 'promoted', to: pre + 1 } : { kind: 'none' }
  if (priorMisses + 1 >= MISSES_TO_DEMOTE) return pre > 0 ? { kind: 'demoted', to: pre - 1 } : { kind: 'none' }
  return { kind: 'none' }
}

// ─── Calendar arithmetic: YYYY-MM-DD strings, UTC, no Date leaks ─────────────────────────────

/**
 * A real calendar day or null. The shape regex alone accepts 2026-02-30, which Postgres would
 * reject as 22008 and the scoring module's own `daysBetween` would THROW on — so the round-trip.
 */
export function parseDay(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return raw
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The Monday of `day`'s ISO week. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(day, -((dow + 6) % 7))
}

export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** node-pg `numeric` arrives as a string; the scoring module wants a finite number. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export { SCORING_VERSION }
