/**
 * WHICH ZONES THE RESULT SCREEN IS ALLOWED TO CALL STARVED.
 *
 * The engine hands back a single `ghostZone`, chosen by sorting the four zones by intensity and
 * taking the first ([scoring.ts] `detectPattern`). On a tie `Array.prototype.sort` is stable, so
 * the winner is just whichever zone `ZONE_COORDS` happens to list first — Construction, always.
 * That produced a screen reading "Construction · starved · 17%" directly above Calibration 17%
 * and Transfer 17%: three zones equally low, one of them singled out for no reason the golfer
 * can see, and the two others let off.
 *
 * So a tie withdraws the claim. If the lowest share is shared, no zone is distinctly the dimmest
 * and naming one is arbitrary — say nothing rather than something arbitrary.
 *
 * ZERO IS THE EXCEPTION, and it's the reason this isn't just "drop ties". A zone with no time in
 * it at all is a real finding however many others are also empty: three zones at 0% means three
 * zones the golfer has never practised, and every one of them deserves the flag. Suppressing
 * that would hide the strongest version of exactly the thing the badge exists to report.
 *
 * 0% DOESN'T WAIT FOR THE ENGINE'S PERMISSION EITHER. The ghost check only fires when no earlier
 * pattern claimed the read — an Illusionist or Prisoner verdict returns `ghostZone: null` and
 * short-circuits it — so three zones could sit at 0m · 0% with nothing marked at all, which is
 * what Teddy hit. An empty zone is self-evident from the number printed beside it and needs no
 * pattern detection to corroborate it, so it is flagged on sight. Only the tie-breaking case
 * below still defers to the engine having found a ghost.
 *
 * Compared on the ROUNDED percentages, deliberately — the tie that matters is the one the golfer
 * can see. 16.6% and 16.7% both print "17%", and flagging one of those as starved while the
 * other reads identically is the same arbitrary call in a subtler form.
 *
 * This is a display rule, not a scoring change: `shared/practice-dna/` is canonical and not ours
 * to rewrite, and `result.pattern`/`ghostZone` still carry whatever the engine decided. If Luke
 * wants the tie handled in the scoring itself, that's a `detectPattern` change and a
 * CONFIG_VERSION bump.
 */

import type { ZoneId } from '../../../../shared/practice-dna/scoring';

/** The four zones. Messy Middle is not one of them, so it can never be starved. */
const ZONES: readonly ZoneId[] = ['construction', 'calibration', 'transfer', 'performance'];

export function starvedZones(
  share: Record<ZoneId, number>,
  ghostZone: ZoneId | null,
): readonly ZoneId[] {
  const shown = (zone: ZoneId) => Math.round(share[zone] ?? 0);

  // Empty is empty: flag every zone with nothing in it, whatever pattern the engine settled on.
  const empty = ZONES.filter((zone) => shown(zone) === 0);
  if (empty.length > 0) return empty;

  // Past here we're ranking non-empty zones, which is a judgement the engine owns. No ghost
  // pattern means it found nothing dim enough to report.
  if (!ghostZone) return [];

  const lowest = Math.min(...ZONES.map(shown));
  const tied = ZONES.filter((zone) => shown(zone) === lowest);

  // One zone has to stand alone to be named.
  return tied.length > 1 ? [] : tied;
}
