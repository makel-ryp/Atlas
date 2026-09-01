/**
 * Suggested input ranges for the profile questions — HINTS, NEVER GATES.
 *
 * These reach the number inputs as `min`/`max` attributes, where a browser uses them for stepper
 * limits and a soft nudge. Nothing refuses a value for falling outside them, on either side of
 * the wire.
 *
 * That is a deliberate reversal. The instrument's own PROFILE_FIELDS declare age 18–85, speed
 * 60–135 and handicap 0–54, and both the quiz and the intake route once ENFORCED them. In tgt
 * those numbers are reasonable: it is a marketing quiz and the bounds shape a good answer. In
 * Atlas the same screens are account creation, so enforcing them meant refusing someone an
 * account for being 13, for swinging 45 mph, or for playing off 60 — and the refusals surfaced
 * as a disabled Continue button with no explanation, or a bare `invalid_profile_value` on the
 * final save. Makel, 2026-09-01: "why are we not allowing the user in bc of speed, or age, or
 * handicap?"
 *
 * The widenings below stay because they make the STEPPERS sane for juniors. If you find yourself
 * adding a `min`/`max` comparison that can return an error, you are re-introducing the gate.
 *
 * `shared/practice-dna/items.ts` is the pinned instrument, byte-identical to tgt — its declared
 * bounds are tgt's and are not edited here. These are Atlas's suggestions layered on top.
 */
export const WIDENED_BOUNDS: Record<string, { min?: number; max?: number }> = {
  PRO_AGE: { min: 8 },
  PRO_SPEED: { min: 30 },
}

/** The instrument's declared range with Atlas's widenings applied. For input hints only. */
export function suggestedRange(
  code: string,
  declared: { min?: number; max?: number },
): { min?: number; max?: number } {
  const w = WIDENED_BOUNDS[code]
  if (!w) return declared
  return { min: w.min ?? declared.min, max: w.max ?? declared.max }
}
