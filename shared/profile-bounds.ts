/**
 * Bounds Atlas applies to PROFILE_FIELDS that are WIDER than the instrument's own.
 *
 * ⚠️ ONE definition, imported by BOTH the quiz UI and the intake route, and that is the whole
 * point of the file. It used to live only in `client/src/quiz/ProfileStage.tsx`, so the client
 * accepted values the server then refused with a bare `invalid_profile_value` and no field the
 * golfer could act on:
 *
 *   - PRO_AGE  — client 13, server 18. Every junior in an academy was rejected on the FIRST
 *                profile question. Atlas's coaching product is built around academy juniors, so
 *                this locked out the exact cohort it exists for.
 *   - PRO_SPEED — client 40, server 60. 60 mph is a 156-yard drive; a junior swinging 55 could
 *                neither type their speed nor reach it through the distance box.
 *
 * Both were found by driving the deployed site on 2026-09-01, one after the other, because
 * mirroring them one at a time is exactly how the second one survived the fix for the first.
 *
 * `shared/practice-dna/items.ts` is the PINNED instrument, lifted from tgt and verified
 * byte-identical — its 18/60 floors are tgt's and must not be edited here. These widenings are
 * Atlas's own decision, so they live in Atlas's own file and are applied on top.
 */
export const WIDENED_BOUNDS: Record<string, { min?: number; max?: number }> = {
  PRO_AGE: { min: 13 },
  PRO_SPEED: { min: 40 },
}

/** The instrument's declared bounds with Atlas's widenings applied. */
export function effectiveBounds(
  code: string,
  declared: { min?: number; max?: number },
): { min?: number; max?: number } {
  const w = WIDENED_BOUNDS[code]
  if (!w) return declared
  return { min: w.min ?? declared.min, max: w.max ?? declared.max }
}
