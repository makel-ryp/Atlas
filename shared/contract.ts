/**
 * FORK NOTICE — NOT a copy of tgt's `shared/contract.ts`. That file is shaped around tgt's
 * email-first anonymous run (`CreateRunInput { email }`, `QuizRun.email`, a `QuizApi` keyed on
 * a client-supplied run id) — a seam Atlas's authenticated intake deliberately removes. Porting
 * it here would smuggle that seam back in through a type import even after the code that used
 * it is gone.
 *
 * This file exists ONLY because `shared/volume.ts` (forked from tgt, see its own header) was
 * written against two of that file's types that have nothing to do with the email seam —
 * `VolumeInput` and `AllocInput` are just the two typed practice-week questions' shapes, needed
 * unchanged by both the client screens and, later, the server's scoring step. Rather than edit
 * `volume.ts`'s import to point at a client-only copy (wrong direction — server code must not
 * import from `client/src/quiz/`), those two shapes get this one shared, neutral home.
 *
 * The full `QuizRun`/`QuizApi`/`QuizApiError` — the pieces that DO change shape for Atlas — live
 * in `client/src/quiz/contract.ts`, which imports `VolumeInput`/`AllocInput`/`VOLUME_LIMITS` from
 * here rather than redeclaring them, so there is exactly one definition of each.
 */

export interface VolumeInput {
  /** Weekly minutes on the full swing: range, garage, simulator. Excludes rounds. */
  practiceMinutes: number;
  /** Weekly hours playing on the course. Decimals ok. */
  courseHours: number;
}

/**
 * The accepted range for the two volume answers, in ONE place so client and server can't drift.
 * Values unchanged from tgt's `shared/contract.ts`.
 */
export const VOLUME_LIMITS = {
  /** 3000 min/wk = 50 hours, well past any honest answer. */
  practiceMinutesMax: 3000,
  courseHoursMax: 60,
} as const;

/**
 * Validate a `VolumeInput` off the wire. Returns an error code, or null when the shape is fine.
 *
 * The volume PATCH was the one intake kind with NO domain validation — profile, alloc, answers and
 * interview each ran a validator and `volume` was assigned straight off `z.record(z.unknown())`.
 * That object is not inert: `computeVolumeBreakdown` divides by the effective total to derive
 * `answers.ALLOC`, so a string, a negative, or a missing key reached the scoring adapter and came
 * back as NaN shares in a stored result.
 *
 * Both keys are REQUIRED. This is not a partial patch like the others — the volume screen saves
 * both numbers together or neither, and a half-saved volume is what makes the breakdown lie.
 */
export function validateVolumeInput(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'invalid_volume';
  const v = input as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (k !== 'practiceMinutes' && k !== 'courseHours') return `unknown_volume_field:${k}`;
  }
  const pm = v.practiceMinutes;
  const ch = v.courseHours;
  if (typeof pm !== 'number' || !Number.isFinite(pm)) return 'invalid_volume_value:practiceMinutes';
  if (typeof ch !== 'number' || !Number.isFinite(ch)) return 'invalid_volume_value:courseHours';
  if (pm < 0 || pm > VOLUME_LIMITS.practiceMinutesMax) return 'invalid_volume_value:practiceMinutes';
  if (ch < 0 || ch > VOLUME_LIMITS.courseHoursMax) return 'invalid_volume_value:courseHours';
  return null;
}

/**
 * The 4-segment allocation of PRACTICE time (not rounds). Must sum to 100.
 * Performance is deliberately absent: it is derived from `courseHours`, not self-reported here.
 */
export interface AllocInput {
  construction: number;
  calibration: number;
  transfer: number;
  /** The Messy Middle — a diagnostic, NOT a fifth zone. */
  messy: number;
}
