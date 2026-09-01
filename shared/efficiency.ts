/**
 * FORK NOTICE — copied from /Users/makelmackbee/Desktop/ATR/websites/tgt/shared/ on 2026-08-31,
 * pinned at CONFIG_VERSION cfg-2026.08-3 / SCORE_VERSION score-2026.08-1, same pin as
 * shared/practice-dna/config.ts. The live quiz at tgt is authoritative — this is a fork for
 * Atlas's account-creation intake. Do not edit tgt from here; do not port changes back without
 * re-checking against the live 118-run history this file was pinned against. Pure computation,
 * no server/client boundary — used by both the quiz UI (ResultScreen) and, later, the scoring
 * step of the intake API.
 */

/**
 * Focus-adjusted Practice Efficiency — makes the Messy Middle actually cost something.
 *
 * WHY THIS EXISTS. `computeEfficiency` in the engine derives its allocation-fit term
 * from `actualAlloc`, which has already been renormalised to sum 100 by
 * `toRounded100`. That silently redistributes undeclared "messy" time across the four
 * zones, so a 50%-messy golfer scores identically to a fully focused one. Luke
 * confirmed the intended behaviour (2026-08-06): *"messy middle is generally
 * considered less efficient."*
 *
 * WHY IT'S HERE AND NOT IN scoring.ts. Fixing `toRounded100` would touch the
 * canonical engine, whose regression suite lives in FORGE and can't be run from this
 * repo — so the change would be unverifiable from here. BUILD-PACKAGE/02 §4 already
 * sanctions rendering-layer adjustments for exactly this kind of correction. This is
 * a named, tested, shared function rather than a fudge buried in a component, so
 * both halves compute the same number and the eventual engine fix can delete it.
 *
 * Owner: Yannick. Remove once the engine handles messy natively.
 */

import { EFFICIENCY_WEIGHTS, ZONE_BUILD_ORDER } from './practice-dna/config';
import type { PracticeDnaResult } from './practice-dna/scoring';

export interface FocusAdjustedEfficiency {
  /** What to display. 0–100. */
  value: number;
  /** The engine's unadjusted number, kept for debugging and analytics. */
  raw: number;
  /** Points deducted for undeclared practice. 0 when fully focused. */
  penalty: number;
}

/**
 * Only *declared* practice can match a zone benchmark, so the allocation-fit term
 * earns credit for the declared fraction only. Everything else in the efficiency
 * formula (practice quality, transfer) is unaffected — those come from item
 * responses, not from the allocation.
 *
 * At messyShare = 0 the result is identical to the engine's, which matters: this must
 * not silently move the number for focused golfers.
 */
export function focusAdjustedEfficiency(
  result: PracticeDnaResult,
  messyShare: number | null,
): FocusAdjustedEfficiency {
  const raw = result.efficiency;
  if (messyShare === null || messyShare <= 0) return { value: raw, raw, penalty: 0 };

  const undeclared = Math.min(100, messyShare) / 100;

  // Recover the allocation-fit term from the result's own numbers, matching the
  // engine's formula: 1 − (L1 distance / 200).
  let l1 = 0;
  for (const zone of ZONE_BUILD_ORDER) {
    l1 += Math.abs((result.actualAlloc[zone] ?? 0) - (result.recommendedAlloc[zone] ?? 0));
  }
  const allocationFit = Math.min(1, Math.max(0, 1 - l1 / 200));

  const penalty = Math.round(
    EFFICIENCY_WEIGHTS.allocationFit * allocationFit * undeclared * 100,
  );

  return {
    value: Math.max(0, Math.min(100, raw - penalty)),
    raw,
    penalty,
  };
}
