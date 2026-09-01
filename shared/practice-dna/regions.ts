/**
 * Practice DNA — comfort/danger REGION overlay for real-user heat fingerprints.
 *
 * REVIEW-GATED, default OFF (see `isPracticeDnaRegionsEnabled`). Today a real user's
 * fingerprint (`computeResult().heatKernels`) only places the four zone kernels along the
 * ideal arc (top-left → bottom-right). The gallery archetypes, by contrast, hand-place two
 * TRAP corners that aren't any single zone:
 *   • Comfort Creature → BOTTOM-LEFT (low Shot Difficulty + quiet mind)
 *   • Quick-Fix Junkie  → TOP-RIGHT DANGER (high Shot Difficulty + high Swing Thoughts)
 *
 * This module derives those same corners FROM A RESULT'S scale scores, so a real user who
 * scores high on Comfort-Creature / Quick-Fix-Junkie would get the matching corner glow —
 * making live fingerprints read like the gallery. It is pure, additive, and deterministic;
 * it does NOT touch `computeResult` (engine stays pure for recompute). It is wired only into
 * the dev preview harness for review until approved; the `regions` flag is the switch a
 * future ResultView integration would consult.
 *
 * Corner anchors mirror fingerprints.ts CUSTOM_KERNELS so the gallery and live results agree.
 */

import type { Confidence, HeatKernel } from './scoring';
import type { ScaleId } from './items';

/** Map corners (x = Shot Difficulty, y = Swing Thoughts; 0–100). */
export const COMFORT_CORNER = { x: 20, y: 18 } as const; // bottom-left
export const DANGER_CORNER = { x: 80, y: 80 } as const; // top-right (renders crimson)

/** A region kernel only appears once its signal clears this (0–100, above neutral 50). */
export const REGION_THRESHOLD = 55;

/** Region glow tightens as the read sharpens, like the zone kernels. */
const SIGMA_BY_CONFIDENCE: Record<Confidence, number> = {
  baseline: 20,
  sharpened: 17,
  full: 15,
};

/** Map a 0–100 signal (already ≥ threshold) to a visible kernel intensity in [0.35, 0.95]. */
function intensityFor(score: number): number {
  const t = (score - REGION_THRESHOLD) / (100 - REGION_THRESHOLD); // 0 at threshold, 1 at 100
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return 0.35 + clamped * 0.6;
}

/**
 * The extra corner kernels a result's scale scores imply (0, 1, or 2). Empty when neither
 * trap signal clears REGION_THRESHOLD. Pure — caller decides whether/where to overlay them.
 */
export function regionKernels(
  scaleScores: Partial<Record<ScaleId, number>>,
  confidence: Confidence = 'full',
): HeatKernel[] {
  const sigma = SIGMA_BY_CONFIDENCE[confidence];
  const out: HeatKernel[] = [];

  const comfort = scaleScores.comfortCreature ?? 0;
  if (comfort >= REGION_THRESHOLD) {
    out.push({
      zone: 'construction', // nearest-zone label only; HeatMap reads x/y/intensity/sigma
      x: COMFORT_CORNER.x,
      y: COMFORT_CORNER.y,
      intensity: intensityFor(comfort),
      sigma,
      region: true,
    });
  }

  const quickFix = scaleScores.quickFixJunkie ?? 0;
  if (quickFix >= REGION_THRESHOLD) {
    out.push({
      zone: 'performance',
      x: DANGER_CORNER.x,
      y: DANGER_CORNER.y,
      intensity: intensityFor(quickFix),
      sigma,
      region: true,
    });
  }

  return out;
}

/**
 * Base zone fingerprint with the comfort/danger overlay appended. Additive: the original
 * kernels are preserved and the corners are added only when their signals fire. Pure.
 */
export function heatKernelsWithRegions(
  base: readonly HeatKernel[],
  scaleScores: Partial<Record<ScaleId, number>>,
  confidence: Confidence = 'full',
): HeatKernel[] {
  return [...base, ...regionKernels(scaleScores, confidence)];
}
