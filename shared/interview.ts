/**
 * The interview — five free-text questions Luke's profile page has always rendered and nothing
 * ever asked.
 *
 * ── Why this lives HERE and not in shared/practice-dna/ ────────────────────────────────────────
 * `shared/practice-dna/items.ts` is BYTE-IDENTICAL to tgt's copy (verified 2026-09-10 by diff).
 * tgt is a live product running the same instrument, so adding items there forks a shared
 * assessment to serve one app's screen. The interview is an ATLAS concept — it fills Luke's coach
 * dossier, it is not scored, and it feeds no scale — so it gets its own Atlas-owned module and its
 * own column rather than a seat in the item bank.
 *
 * ── Where the text comes from ──────────────────────────────────────────────────────────────────
 * Verbatim from `proto/Dashboard.dc.html:3957` (`intakeVals`'s `FIELDS`), which carries the longer
 * hints; the profile view at `:3783` has the same five keys with shortened ones. Taking the longer
 * pair means the question a golfer answers reads the same as the question the coach sees answered.
 * Do not reword: the profile page renders these keys directly, and `limits`' hint is load-bearing.
 *
 * ── The one field that is not just prose ───────────────────────────────────────────────────────
 * `limits` is the stated input to the pivot routing. `STEPS[1].variants.anchor`
 * (`Dashboard.dc.html:2518`) is "the route when dorsiflexion or lead-hip depth is limited", and the
 * Fitness screen that reported exactly that was cut for v1. So this answer is currently the ONLY
 * source that rule could ever read. See docs/reports/PROTOTYPE-WHAT-LUKE-ALREADY-BUILT-2026-09-10.md §3.
 */

import { parseHandicapIndex } from './handicap'

export interface InterviewField {
  /** Key in the stored jsonb AND in the prototype's `file` object. Luke's markup reads these. */
  key: InterviewKey
  label: string
  hint: string
}

export type InterviewKey = 'sport' | 'years' | 'limits' | 'time' | 'goal' | 'target'

export const INTERVIEW_FIELDS: readonly InterviewField[] = [
  {
    key: 'sport',
    label: 'Sports background',
    hint: 'What else did your body learn first, and to what level?',
  },
  {
    key: 'years',
    label: 'Years playing golf',
    hint: 'And how many of those were coached?',
  },
  {
    key: 'limits',
    label: 'Physical limitations',
    hint: 'Injuries, surgeries, ranges you cannot reach. Be complete — this decides which route you are given.',
  },
  {
    key: 'time',
    label: 'Honest weekly hours',
    hint: 'Not the number you wish were true.',
  },
  {
    key: 'goal',
    label: 'Why you are here',
    hint: 'In one sentence, in your own words.',
  },
  /**
   * TARGET HANDICAP — the one interview answer that is not prose, added 2026-09-17 on Makel's
   * ask: "We need to ask the target handicap in the intake and then use that a profile reference
   * every login."
   *
   * It lives here rather than in the item bank for the same reason the other five do: it is an
   * Atlas concept, it is not scored, and it feeds no scale. But unlike the other five it does not
   * stop at the jsonb — on completion it is reconciled into `golf.player_profile.target_handicap`,
   * which is what `__ATLAS_DATA__.me.target` reads and therefore what the rail, the benchmarks and
   * the coach's dossier all key on. Storing it only in the interview blob would answer the
   * question and change nothing on the page.
   *
   * Kept a STRING in the jsonb like its siblings, so the save-as-you-type patch path, the column
   * and the validator are unchanged; it is parsed at the reconciliation step. Plus handicaps are
   * entered the way a golfer writes them ("+2") and `parseHandicapIndex` signs them negative.
   */
  {
    key: 'target',
    label: 'Target handicap',
    hint: 'The number you are actually chasing. Every benchmark on your dashboard reads against it.',
  },
]

export const INTERVIEW_KEYS: readonly InterviewKey[] = INTERVIEW_FIELDS.map((f) => f.key)

/**
 * Per-answer cap. Generous because an injury history is genuinely long — the prototype's textarea
 * grows by `Math.ceil(v.length / 38)` rows and expects paragraphs — but bounded so one field
 * cannot be used to store an essay in a jsonb column that is read on every dashboard load.
 */
export const INTERVIEW_MAX_LEN = 2000

/**
 * Validate a partial interview patch. Returns an error code, or null when the shape is fine.
 *
 * Partial on purpose: the stage saves as the golfer types past a field, same as the profile
 * stage, so an object with one key is normal and an empty object is not an error.
 *
 * Empty strings are ALLOWED and meaningful — "I have no physical limitations" is an answer, and
 * distinguishing it from "not yet asked" is why the column is null until the stage is reached.
 */
export function validateInterviewPartial(input: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(input)) {
    if (!INTERVIEW_KEYS.includes(key as InterviewKey)) return `unknown_interview_field:${key}`
    if (typeof value !== 'string') return `invalid_interview_value:${key}`
    if (value.length > INTERVIEW_MAX_LEN) return `interview_value_too_long:${key}`
    // `target` is the one field that becomes a NUMBER downstream — it is reconciled into
    // golf.player_profile.target_handicap, whose CHECK is -6..30. Rejecting a bad value at the
    // patch is better than accepting it here and silently dropping it at completion, which would
    // read to the golfer as "I answered that and it did nothing".
    // Empty stays legal: it means "not answered yet", same as every other field.
    if (key === 'target' && value.trim() !== '') {
      const n = parseHandicapIndex(value)
      if (n === null) return 'invalid_interview_value:target'
      if (n < TARGET_MIN || n > TARGET_MAX) return 'interview_value_out_of_range:target'
    }
  }
  return null
}

/**
 * The bounds on `golf.player_profile.target_handicap`, mirrored from the live CHECK constraint
 * `player_profile_target_handicap_range` (-6 .. 30) so the client refuses what the column would.
 */
export const TARGET_MIN = -6
export const TARGET_MAX = 30
