/**
 * THE COACH-SAFE PROJECTION OF A PRACTICE DNA RUN.
 *
 * Makel, 2026-09-15: "we do need to surface the metrics and categories that the players are
 * seeing so that if they are speaking in person theres some correlative understanding there."
 *
 * The point is SHARED VOCABULARY, not a second copy of the player's app. A coach who says "your
 * Transfer Zone is dim" and a player who read the words "Transfer Zone" on their own result screen
 * are talking about the same thing. So everything here is a term the player has already seen.
 *
 * ── WHY THIS IS AN ALLOWLIST AND NOT A DELETE-LIST ───────────────────────────────────────────
 * `PracticeDnaResult` carries three things a coach must never receive:
 *
 *   1. `attention` — the ATTN01/ATTN02 report. This is the basis of `quality_flag`, i.e. "we think
 *      this person clicked through without reading". A coach seeing that about a student is a
 *      different product than the one we are building.
 *   2. `scaleScores` — keyed by ScaleId, which includes `neuroticism`, `extraversion`,
 *      `agreeableness` and `conscientiousness`. Raw personality proxies about a named human.
 *   3. `architect` — the meta-persona signal, an internal scoring intermediate the player never
 *      sees either.
 *
 * A delete-list would leak the next field someone adds to `PracticeDnaResult`. This builds a NEW
 * object field by field, so a field added upstream is excluded until somebody decides otherwise —
 * the same reasoning that made `atlas.student_intake` a view rather than a policy.
 *
 * ── AND WHY `answers` NEVER LEAVES THE SERVER ────────────────────────────────────────────────
 * `atlas.student_intake` strips IPIP01–20 from `answers` but NOT ATTN01/ATTN02. Scoring therefore
 * happens here, server-side, and only this projection is injected into the page. The raw item
 * responses are read, scored, and dropped inside one function.
 */
import { PROFILE_FIELDS, type Profile, type Answers } from '../shared/practice-dna/items'
import {
  computeResult,
  type Confidence,
  type MasteryStatus,
  type PracticeDnaResult,
  type ZoneId,
} from '../shared/practice-dna/scoring'
import {
  ARCHETYPES,
  CHIPS,
  GROWTH,
  MI_VERDICTS,
  PATTERNS,
  TENDENCIES,
  ZONE_LABELS,
  ZONES,
  efficiencyBand,
} from '../shared/practice-dna/results-content'
import { computeVolumeBreakdown } from '../shared/volume'

/**
 * The four zones in the order the instrument builds them. Not alphabetical and not a `Object.keys`
 * of anything — Construction → Calibration → Transfer → Performance is the progression the player
 * is shown, so a coach reading the same list top-to-bottom reads the same story.
 */
const ZONE_ORDER: readonly ZoneId[] = ['construction', 'calibration', 'transfer', 'performance']

/**
 * Mirrors `READ_LABEL` in client/src/quiz/ResultScreen.tsx:62. Deliberately duplicated rather than
 * imported: that constant lives in a React component the server must not pull in. If it changes
 * there it must change here — the whole value of this panel is that the coach's word and the
 * player's word are the same word.
 */
const READ_LABEL: Record<Confidence, string> = {
  baseline: 'First read',
  sharpened: 'Second read',
  full: 'Final verdict',
}

/** Which tiers a read is standing on. A thin panel must read as EARLY, never as broken. */
const READ_BASIS: Record<Confidence, string> = {
  baseline: 'Tier 1A only — the foundation questions',
  sharpened: 'Tiers 1A + 1B — sharpened',
  full: 'Tiers 1A + 1B + 2 — the full ladder',
}

const STATUS_LABEL: Record<MasteryStatus, string> = {
  strong: 'Strong',
  building: 'Building',
  dim: 'Dim',
  // NOT 'Locked'. The player's screen says locked because it is something they can unlock; on a
  // coach's screen 'locked' reads as a permission, which it is not.
  locked: 'Not measured',
}

export type DnaZoneRow = {
  zone: ZoneId
  /** 'Construction' — the short label, as the player's zone cards use. */
  label: string
  status: MasteryStatus
  statusLabel: string
  /** The one line the PLAYER is shown about this zone at this status. Their words, verbatim. */
  statusLine: string
  /** % of practice time now. null when ALLOC was never answered. */
  actual: number | null
  /** % of practice time the instrument recommends. */
  recommended: number
  /** actual − recommended, percentage points. null when `actual` is null. */
  delta: number | null
  /** True for the one zone the instrument says to build next. */
  growth: boolean
}

export type DnaSummary = {
  /** 'baseline' | 'sharpened' | 'full' — how deep the read goes. */
  depth: Confidence
  /** 'First read' | 'Second read' | 'Final verdict'. */
  depthLabel: string
  /** Which tiers that rests on, so a thin panel reads as early rather than empty. */
  depthBasis: string

  /** 'The Architect'. */
  archetype: string
  archetypeTagline: string
  /** The line the instrument writes FOR a coach. Already exists; this is its intended reader. */
  archetypeCoachLine: string
  archetypeProvisional: boolean
  /** The chip's wording — names WHY it is provisional. */
  archetypeProvisionalNote: string

  /** 0 = pure Engineer (thinker) · 100 = pure Artist (doer). */
  tendency: number
  /** 'The Engineer' | 'Blended' | 'The Artist'. */
  tendencyName: string
  /** One word: Engineer / Both / Artist. */
  tendencyPole: string
  tendencyProvisional: boolean

  /** 'Transfer Zone', or '' when no zone has enough data to be chosen. */
  growthZone: string
  growthHeadline: string
  /** The three moves the player was prescribed. What a coach would otherwise have to guess. */
  growthMoves: string[]

  zones: DnaZoneRow[]

  /**
   * 0–100: how much of their practice moves their handicap. **null when it cannot be computed
   * from answers the player actually gave.**
   *
   * ⚠️ FOUND BY AN ADVERSARIAL REVIEW, 2026-09-15, and confirmed by execution. This is a weighted
   * blend — 0.5·allocationFit + 0.3·practiceQuality + 0.2·transferTerm — and EVERY term has a
   * flattering fallback (scoring.ts:441-466): allocationFit off `getAlloc`'s invented
   * `{25,25,25,25}`, practiceQuality at a PERFECT 1.0 because `scales.comfortCreature ?? 0`, and
   * transferTerm at 0.5 because `mastery.transfer` is null. A player who answered NOTHING scored
   * `86 / "Dialed in"` — byte-identical to a player who reported a real even split, and BETTER
   * than one who honestly reported a badly skewed 85/5/5/5 (61 / "Leaking strokes").
   *
   * It printed in green beside four zone rows that correctly read "Their time —" / "Not measured".
   * The author guarded those and missed this. All three inputs are now required.
   */
  efficiency: number | null
  /** '' when `efficiency` is null. */
  efficiencyLabel: string
  /** What is still unanswered, when `efficiency` is null. '' otherwise. */
  efficiencyMissing: string

  /** 'The Ghost' etc, '' when no pattern fired. */
  pattern: string
  patternHeadline: string
  patternFix: string
  /** The starved zone behind a Ghost pattern. '' when none. */
  ghostZone: string

  /** Behavioural flags the player was shown. NOT personality scores — see the header. */
  chips: Array<{ label: string; blurb: string }>

  /** Mechanics Index ↔ handicap. Every field here is on the player's screen. */
  mi: {
    state: 'none' | 'estimated' | 'measured'
    handicap: number | null
    value: number | null
    /** [low, high] when estimated; null when a point value or unknowable. */
    range: [number, number] | null
    /** handicap − mi. Positive ⇒ swing built ahead of scoring. */
    gap: number | null
    /** '' when there is no verdict yet. */
    verdict: string
    /**
     * False when the estimate rests on nothing.
     *
     * ⚠️ FOUND BY AN ADVERSARIAL REVIEW, 2026-09-15. `estimateMi` (scoring.ts:482-486) is
     * `scales.mechanics ?? 50`, so with the mechanics scale unanswered the shift is exactly 0, the
     * estimate equals the handicap, the gap is structurally 0.0 and the verdict is ALWAYS
     * "Your swing and your scoring are in step." Every unanswered player read as perfectly
     * balanced — indistinguishable from a real balanced measurement, and a stated finding about a
     * student's swing derived from a default. The panel hides the card when this is false.
     */
    estimable: boolean
  }
}

/**
 * True only when every PROFILE_FIELD is filled. Moved here from server/routes/intake.ts so the two
 * callers share ONE definition — `cookieOrBearer` had to be extracted for exactly this reason on
 * 2026-09-14, and a second private copy of a scoring precondition is the same bug waiting.
 */
export function isProfileComplete(
  profile: Record<string, unknown>,
): profile is Record<string, unknown> & Profile {
  return PROFILE_FIELDS.every(
    (f) => profile[f.code] !== undefined && profile[f.code] !== null && profile[f.code] !== '',
  )
}

/**
 * Scores a run. `volume` and `alloc` are the RAW inputs; the engine wants shares of effective
 * total, which only the volume adapter can produce — so ALLOC is derived HERE, into a copy, and
 * never persisted. Mirrors `tgt/server/service.ts:180-191` deliberately.
 *
 * Recompute, never store — the point being that a run scored today survives the instrument
 * changing later. Only attempted once the profile is fully filled in: the live data shows the
 * profile block is observed ALL-OR-NOTHING (7/7 fields on every scored profile in 110/118 runs),
 * and `computeResult` takes a `Profile`, not a `Partial<Profile>`, so calling it against a partial
 * object would silently score against `undefined` fields rather than refuse.
 */
export function tryComputeResult(
  profile: unknown,
  answers: unknown,
  volume?: unknown,
  alloc?: unknown,
): PracticeDnaResult | null {
  const p = (profile ?? {}) as Record<string, unknown>
  const a = { ...((answers ?? {}) as Answers) }
  if (!isProfileComplete(p)) return null
  try {
    if (volume && alloc) {
      a.ALLOC = computeVolumeBreakdown(volume as never, alloc as never).alloc
    }
    return computeResult(p as unknown as Profile, a)
  } catch {
    // Scoring is defensive by design (Confidence grades partial `answers`), but a malformed stored
    // value should read as "not scoreable yet", not crash the request that's just trying to show
    // progress.
    return null
  }
}

/**
 * The projection itself. Every field is named explicitly — see the header for why that is the
 * whole safety argument rather than a style preference.
 */
export function toCoachSummary(result: PracticeDnaResult, hasAlloc: boolean): DnaSummary {
  const archetype = ARCHETYPES[result.archetype]
  const tendency = TENDENCIES[result.tendencyLabel]
  const growth = result.growthZone ? GROWTH[result.growthZone] : null
  const pattern = result.pattern ? PATTERNS[result.pattern] : null
  /**
   * ── THE THREE GUARDS ────────────────────────────────────────────────────────────────────────
   * Each one asks whether the PLAYER supplied the input, never whether the engine produced a
   * number — the engine always produces a number, which is exactly the problem. See the field
   * comments on DnaSummary for the executed evidence behind each.
   */
  const scales = result.scaleScores
  // Efficiency needs all three of its terms, because a missing term is not a small error: it is
  // silently replaced by a FLATTERING constant (1.0 for quality, 0.5 for transfer).
  const effMissing: string[] = []
  if (!hasAlloc) effMissing.push('their practice split')
  if (scales.comfortCreature === undefined || scales.quickFixJunkie === undefined) {
    effMissing.push('the practice-quality questions')
  }
  if (result.mastery.transfer === null) effMissing.push('their Transfer self-rating')
  const effOk = effMissing.length === 0
  const band = effOk ? efficiencyBand(result.efficiency) : null

  // The Mechanics Index estimate is `handicap − ((mechanics − 50)/50)·8`. Unanswered ⇒ shift 0 ⇒
  // the "estimate" is just the handicap back, and the gap is 0 by construction.
  const miEstimable = result.mi.state === 'measured' || scales.mechanics !== undefined

  // An archetype is a claim about zones. With none measured, the instrument's own
  // `archetypeProvisional` can still read false (it keys off tendency items, which are Tier 1A),
  // so a coach was handed "no zone is starving" as an unhedged 24px headline above four rows
  // reading "Not measured". The hedge is forced here rather than the claim suppressed, because the
  // archetype NAME is the shared vocabulary this panel exists to provide.
  const noZoneMeasured = ZONE_ORDER.every((z) => result.masteryStatus[z] === 'locked')

  const zones: DnaZoneRow[] = ZONE_ORDER.map((z) => {
    const status = result.masteryStatus[z]
    const content = ZONES[z]
    /**
     * `actualAlloc` is a FULL record even when ALLOC was never answered: `getAlloc`
     * (scoring.ts:262) falls back to `{25,25,25,25}`, and `actualZoneAlloc` passes that straight
     * through. Printing it would put four invented 25%s on a coach's screen beside a real
     * recommendation — a fabricated value, which this project treats as worse than a blank.
     *
     * ⚠️ It cannot be detected from the RESULT. An earlier version of this line tested
     * `zoneIntensity > 0`, which is never false: zoneIntensity is derived from the same
     * `getAlloc` fallback times a volume factor that floors at 0.4, so an unanswered run reads
     * 0.25 × 0.66 ≈ 0.16 on every zone. The only honest signal is whether the INPUT existed, so
     * it is passed in rather than inferred.
     */
    const actual = hasAlloc ? result.actualAlloc[z] : null
    const recommended = result.recommendedAlloc[z]
    return {
      zone: z,
      label: content.label,
      status,
      statusLabel: STATUS_LABEL[status],
      statusLine: status === 'locked' ? content.locked : content.status[status],
      actual,
      recommended,
      delta: actual === null ? null : actual - recommended,
      growth: result.growthZone === z,
    }
  })

  return {
    depth: result.quizConfidence,
    depthLabel: READ_LABEL[result.quizConfidence],
    depthBasis: READ_BASIS[result.quizConfidence],

    archetype: archetype.name,
    archetypeTagline: archetype.tagline,
    archetypeCoachLine: archetype.coachLine,
    archetypeProvisional: result.archetypeProvisional || noZoneMeasured,
    /** Why it is provisional, so the chip says something a coach can act on. */
    archetypeProvisionalNote: noZoneMeasured
      ? 'Provisional \u2014 no zone measured yet'
      : 'Provisional \u2014 may change with a deeper read',

    tendency: result.tendency,
    tendencyName: tendency.name,
    tendencyPole: tendency.pole,
    tendencyProvisional: result.tendencyProvisional,

    growthZone: result.growthZone ? ZONE_LABELS[result.growthZone] : '',
    growthHeadline: growth?.headline ?? '',
    growthMoves: growth ? [...growth.moves] : [],

    zones,

    efficiency: effOk ? result.efficiency : null,
    efficiencyLabel: band ? band.label : '',
    efficiencyMissing: effOk ? '' : 'Needs ' + effMissing.join(' and ') + '.',

    pattern: pattern?.name ?? '',
    patternHeadline: pattern?.headline ?? '',
    patternFix: pattern?.fix ?? '',
    ghostZone: result.ghostZone ? ZONE_LABELS[result.ghostZone] : '',

    chips: result.chips.map((c) => ({ label: CHIPS[c].label, blurb: CHIPS[c].blurb })),

    mi: {
      state: result.mi.state,
      handicap: result.mi.handicap,
      value: result.mi.mi,
      range: result.mi.miRange,
      // Both suppressed when the estimate rests on the `?? 50` default: a gap of 0.0 and
      // "in step" are the arithmetic of an unanswered question, not a finding about a swing.
      gap: miEstimable ? result.mi.gap : null,
      verdict: miEstimable && result.mi.verdict ? MI_VERDICTS[result.mi.verdict].headline : '',
      estimable: miEstimable,
    },
  }
}

/**
 * Read + score + project, in one call. The raw `answers` object exists only inside this function.
 * Returns null when the run is not scoreable yet (no completed profile), which the page renders as
 * "no read on file" rather than as an empty panel of dashes.
 */
export function summarizeRun(row: {
  profile: unknown
  answers: unknown
  volume?: unknown
  alloc?: unknown
}): DnaSummary | null {
  const result = tryComputeResult(row.profile, row.answers, row.volume, row.alloc)
  if (!result) return null
  // Mirrors `tryComputeResult` exactly: it derives ALLOC when volume+alloc are both present, and
  // otherwise leaves whatever `answers.ALLOC` held. Those are the only two ways a real split gets
  // into the engine, so they are the only two ways the coach is shown one.
  const hasAlloc = Boolean(row.volume && row.alloc) || isAllocShape((row.answers as Answers | null)?.ALLOC)
  return toCoachSummary(result, hasAlloc)
}

/**
 * The four-zone ALLOC shape, checked the same way `isAlloc` does inside scoring.ts — which is
 * module-private there, so this is a deliberate local copy rather than a widening of the
 * instrument's public surface. `shared/practice-dna/` is byte-identical to TGT and is not edited.
 */
function isAllocShape(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.construction === 'number' &&
    typeof o.calibration === 'number' &&
    typeof o.transfer === 'number' &&
    typeof o.performance === 'number'
  )
}
