/**
 * The saving indicator shown between questions.
 *
 * Each answer round-trips to the server, and while it does, `TierRunner` disables its fieldset —
 * which on its own just dims the options with no explanation. Reported as "it loads a shadow that
 * looks off-putting" (Makel, user test 2026-09-01), and that is exactly right: the dimming reads
 * as something going wrong rather than as a save in flight.
 *
 * Overlaid rather than replacing the question, so the layout does not jump and the golfer can
 * still read what they just answered. `aria-hidden` because the disabled fieldset and the
 * live-region error already carry the state for assistive tech; this is the visual half.
 */
export function SavingOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <span className="quiz-spinner" />
    </div>
  );
}
