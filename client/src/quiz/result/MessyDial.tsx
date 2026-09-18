/**
 * THE MESSY MIDDLE DIAL — the share of the week the Map's four tiles deliberately don't cover.
 *
 * The Map plots four zones whose percentages sum to 100 − messyShare (`volume.ts`), so a golfer
 * with a big Messy Middle reads four tiles totalling 57% and fairly concludes the picture is
 * broken. The honest fix is to show where the rest went, not to renormalise the tiles: squeezing
 * the four zones back up to 100 would erase the single most important finding the instrument
 * produces, and would contradict the time bars further down the same screen.
 *
 * So this sits beside the Map as the fifth quantity, not inside it. The Messy Middle has no
 * coordinate on the grid — it is by definition practice with no declared focus, which is what
 * makes it unplottable and why it needs its own mark.
 *
 * Screen-only, so unlike `PracticeMap` this one is free to use Tailwind classes: nothing
 * serialises it to a standalone PNG. The share card states the same number in its header.
 */

/** Donut geometry. r is chosen so the ring reads at ~96px without the stroke clipping. */
const R = 34;
const STROKE = 9;
const BOX = (R + STROKE) * 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * How much of the ring to fill, as an SVG dash length.
 *
 * Clamped both ends: `messyShare` is a computed percentage, and a golfer with zero effective
 * practice volume can hand us values outside 0–100 through no fault of their own.
 */
export function arcLength(share: number): number {
  const pct = Math.min(100, Math.max(0, Number.isFinite(share) ? share : 0));
  return (pct / 100) * CIRCUMFERENCE;
}

export function MessyDial({ share }: { share: number }) {
  const filled = arcLength(share);
  const rounded = Math.round(Math.min(100, Math.max(0, share)));

  return (
    <figure className="m-0 flex shrink-0 flex-col items-center gap-2 sm:w-28">
      <svg
        viewBox={`0 0 ${BOX} ${BOX}`}
        className="w-24 sm:w-full"
        role="img"
        aria-label={`Messy Middle: ${rounded}% of your week has no declared focus. It is not one of the four zones, which is why it sits beside the Map rather than on it.`}
      >
        {/* The track: the whole week. */}
        <circle
          cx={BOX / 2}
          cy={BOX / 2}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          opacity={0.12}
        />

        {/* The filled arc, started at 12 o'clock rather than 3. */}
        <circle
          cx={BOX / 2}
          cy={BOX / 2}
          r={R}
          fill="none"
          // The allocation bar's own Messy colour, so the two screens agree on what this is.
          // Follows AllocBar to --muted (#8d99a8) in the 2026-09-17 Atlas restyle.
          stroke="#8d99a8"
          strokeWidth={STROKE}
          strokeLinecap="butt"
          strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
          transform={`rotate(-90 ${BOX / 2} ${BOX / 2})`}
        />

        <text
          x={BOX / 2}
          y={BOX / 2 + 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink text-[20px] font-bold tabular-nums"
        >
          {rounded}%
        </text>
      </svg>

      <figcaption className="text-center">
        <span className="block text-xs font-bold tracking-[0.08em] uppercase">Messy Middle</span>
        <span className="block text-xs leading-snug text-muted">
          no declared focus — not a zone, so it isn&apos;t on the Map
        </span>
      </figcaption>
    </figure>
  );
}
