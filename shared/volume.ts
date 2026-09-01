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
 * The volume + allocation adapter — PRACTICE-DNA-TEAM-HANDOFF.md §4d.
 *
 * Turns the two typed volume answers plus the 4-segment practice split into:
 *   - real minutes per zone (what the result screen's time bars render)
 *   - the engine's ALLOC input, as % of effective total
 *   - messyShare / focusScore (the Messy Middle diagnostic)
 *
 * Pure. No I/O. Called client-side for provisional results and server-side for
 * authoritative ones — both must agree, which is why it lives in shared/.
 *
 * Owner: Yannick (backend). The worked example in §4d is the unit test in
 * volume.test.ts — if you change the math, that test must still pass or the
 * handoff's "definition of done for scoring" is broken.
 */

import type { AllocInput, VolumeInput } from './contract';
import { COURSE_SWING_CREDIT } from './practice-dna/config';
import type { AllocValue } from './practice-dna/items';

export interface VolumeBreakdown {
  /** Real weekly minutes per zone — the time bars. */
  minutes: {
    construction: number;
    calibration: number;
    transfer: number;
    performance: number;
    messy: number;
  };
  /** Practice minutes + credited course minutes. The denominator for ALLOC. */
  effectiveTotal: number;
  /** The engine's ALLOC answer: share of effectiveTotal per zone. Sums to 100 − messyShare. */
  alloc: AllocValue;
  /** % of effective total that is undeclared, mixed practice. §4e. */
  messyShare: number;
  /** 100 − messyShare. Displayed as "Declared practice". */
  focusScore: number;
}

/**
 * §4b — credited on-course ball-striking minutes. All of it lands in Performance.
 * This is a stated modeling assumption, not a research finding: the result screen
 * must say so out loud (No Fiction). Constant is tunable in config.ts.
 */
export function creditedCourseMinutes(courseHours: number): number {
  return courseHours * 60 * COURSE_SWING_CREDIT;
}

export function computeVolumeBreakdown(
  volume: VolumeInput,
  alloc: AllocInput,
): VolumeBreakdown {
  const practiceMinutes = Math.max(0, volume.practiceMinutes || 0);
  const performanceMin = creditedCourseMinutes(Math.max(0, volume.courseHours || 0));

  const share = (pct: number) => (practiceMinutes * (pct || 0)) / 100;
  const minutes = {
    construction: share(alloc.construction),
    calibration: share(alloc.calibration),
    transfer: share(alloc.transfer),
    performance: performanceMin,
    messy: share(alloc.messy),
  };

  const effectiveTotal = practiceMinutes + performanceMin;

  // Degenerate case: a golfer who neither practices nor plays. Return zeros rather
  // than NaN — the result screen renders "no practice volume" copy off focusScore.
  if (effectiveTotal <= 0) {
    return {
      minutes,
      effectiveTotal: 0,
      alloc: { construction: 0, calibration: 0, transfer: 0, performance: 0 },
      messyShare: 0,
      focusScore: 100,
    };
  }

  const pctOfTotal = (min: number) => (min / effectiveTotal) * 100;
  return {
    minutes,
    effectiveTotal,
    alloc: {
      construction: pctOfTotal(minutes.construction),
      calibration: pctOfTotal(minutes.calibration),
      transfer: pctOfTotal(minutes.transfer),
      performance: pctOfTotal(minutes.performance),
    },
    messyShare: pctOfTotal(minutes.messy),
    focusScore: 100 - pctOfTotal(minutes.messy),
  };
}
