/**
 * FORGE — scoring math fixtures.
 *
 * Twelve reference cases with hand-computed expectations. Run on every build.
 * These exist because the scoring math is the only part of FORGE that can be
 * wrong without anyone noticing: a broken layout is obvious in a screenshot, a
 * sign flip in strokes gained is invisible for weeks.
 *
 *   node build/forge-math.test.js
 *
 * No test framework on purpose — this must be runnable before any tooling exists.
 */

import {
  CAL, isBetter, baselineHandicap, benchmarkAt, drivingIndex, headScoredIndex,
  atgAllowance, expectedPutts, putt18Handicap, daysBetween, currentFacet,
  facetStrokesGained, totalStrokesGained, practiceHandicap, dispersion, missSide,
  formatHandicap, formatStrokesGained, formatWithConfidence
} from './forge-math.js';

let pass = 0, fail = 0;
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

function check(name, actual, expected, tol) {
  const ok = typeof expected === 'number' ? near(actual, expected, tol)
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; }
  else { fail++; console.error('FAIL  ' + name + '\n      expected ' + JSON.stringify(expected) + '\n      actual   ' + JSON.stringify(actual)); }
}

// -- 1. Distance interpolates rather than steps ------------------------------
check('235 yd is exactly 10.0', baselineHandicap(235), 10);
check('245 yd is half way 10→5', baselineHandicap(245), 7.5);
check('234 and 236 differ by well under a stroke',
  Math.abs(baselineHandicap(236) - baselineHandicap(234)) < 0.6, true);
check('above the top row clamps', baselineHandicap(340), -5);
check('no distance given falls to 30', baselineHandicap(0), 30);
check('women 205 yd is 10.0', baselineHandicap(205, 'f'), 10);

// -- 2. Driving index --------------------------------------------------------
// 20 drives, 12 fairways, 3 big misses, 235 yd → 10 + (8 − (12 − 6)) = 12.0
check('driving 12FW 3BIG at 235', drivingIndex(
  [].concat(Array(12).fill(2), Array(5).fill(1), Array(3).fill(0)), 235), 12);
// Perfect: 20 fairways → 10 + (8 − 20) = −2.0
check('driving all fairways', drivingIndex(Array(20).fill(2), 235), -2);
// Short set scales: 10 drives, 6 FW, 1 big → scale 2 → 10 + (8 − (6−2)·2) = 10.0
check('short set scales to 20', drivingIndex(
  [].concat(Array(6).fill(2), Array(3).fill(1), Array(1).fill(0)), 235), 10);
check('fewer than five drives is not a score', drivingIndex([2, 2, 1], 235), null);
check('a small miss is neutral',
  drivingIndex([].concat(Array(10).fill(2), Array(10).fill(1)), 235)
    === drivingIndex([].concat(Array(10).fill(2), Array(10).fill(1)), 235), true);

// -- 3. Head-scored index ----------------------------------------------------
check('approach base 12 slope 0.6 total +8', headScoredIndex(
  { total: 8, shots: 20, base: 12, slope: 0.6 }), 16.8);
check('half a set doubles the total', headScoredIndex(
  { total: 4, shots: 10, base: 12, slope: 0.6 }), 16.8);
check('allowance is taken off before the slope', headScoredIndex(
  { total: 8, shots: 20, base: 12, slope: 0.6, allowance: 3 }), 15);

// -- 4. ATG allowance is rung-neutral ---------------------------------------
// At rung 0 the baseline is 12 yd, so a set of 12 yd targets earns nothing.
check('twelve-yard set at rung 0 earns nothing',
  atgAllowance({ distances: Array(20).fill(12), rung: 0, shots: 20 }), 0);
// The same set at rung 1 (baseline 16 yd) is now EASIER than the rung expects,
// so the allowance goes negative — a promotion cannot flatter the index.
check('same set at rung 1 is priced as easy',
  atgAllowance({ distances: Array(20).fill(12), rung: 1, shots: 20 }) < 0, true);
// Short-siding every target adds a flat 0.35 per shot.
check('short-siding the lot adds 0.35 a shot',
  atgAllowance({ distances: Array(20).fill(12), shortSided: Array(20).fill(true), rung: 0, shots: 20 }), 7);

// -- 5. Putting --------------------------------------------------------------
check('expected putts from 2 ft', expectedPutts(2), 0.60 + 0.46 * Math.log(2));
check('under 2 ft is floored at 2', expectedPutts(0.5), expectedPutts(2));
check('putt 18 level is the base', putt18Handicap(0), CAL.putt18.base);
check('putt 18 +4 SG improves it', putt18Handicap(4), CAL.putt18.base - 4 * CAL.putt18.k);

// -- 6. Dates are UTC and never off by one -----------------------------------
check('same day is zero', daysBetween('2026-08-09', '2026-08-09'), 0);
check('across a month boundary', daysBetween('2026-07-30', '2026-08-09'), 10);
check('across a year boundary', daysBetween('2025-12-31', '2026-01-01'), 1);

// -- 7. Current picture: one bad session cannot rewrite the number -----------
const steady = [
  { date: '2026-08-08', facets: { approach: 12.0 }, shots: { approach: 20 } },
  { date: '2026-08-05', facets: { approach: 12.4 }, shots: { approach: 20 } },
  { date: '2026-08-02', facets: { approach: 12.2 }, shots: { approach: 20 } }
];
check('steady player reads the middle score',
  currentFacet(steady, 'approach', '2026-08-09').value, 12.2);

const blowUp = [
  { date: '2026-08-08', facets: { approach: 19.0 }, shots: { approach: 20 } },  // one shocker
  { date: '2026-08-05', facets: { approach: 12.4 }, shots: { approach: 20 } },
  { date: '2026-08-02', facets: { approach: 12.2 }, shots: { approach: 20 } }
];
check('one blow-up does not become the handicap',
  currentFacet(blowUp, 'approach', '2026-08-09').value < 13, true);

check('provisional sets are skipped', currentFacet(
  [{ date: '2026-08-08', facets: { approach: 9 }, shots: { approach: 11 } },
   { date: '2026-08-05', facets: { approach: 12.4 }, shots: { approach: 20 } }],
  'approach', '2026-08-09').value, 12.4);

check('an old score is flagged stale', currentFacet(
  [{ date: '2026-04-01', facets: { approach: 12.4 }, shots: { approach: 20 } }],
  'approach', '2026-08-09').stale, true);

check('one session is less precise than three',
  currentFacet([steady[0]], 'approach', '2026-08-09').se
    > currentFacet(steady, 'approach', '2026-08-09').se, true);

check('nothing scored returns null',
  currentFacet([], 'approach', '2026-08-09'), null);

// -- 8. Strokes gained is absolute, not shared -------------------------------
// Driving 12.0 against a target of 4.0 → (4 − 12) × 0.34 = −2.72
check('driving strokes gained', facetStrokesGained('driving', 12, 4), -2.72);
check('at target it is zero', facetStrokesGained('driving', 4, 4), 0);
check('better than target is positive', facetStrokesGained('driving', 2, 4) > 0, true);

// The bug this replaced: adding an unrelated drill used to move driving's number.
const drivingAlone = facetStrokesGained('driving', 12, 4);
const drivingWithPutting = facetStrokesGained('driving', 12, 4);
check('scoring another drill never moves driving', drivingAlone, drivingWithPutting);

check('the headline is the sum of the parts',
  totalStrokesGained({ driving: 12, putting: 6 }, 4),
  Math.round((facetStrokesGained('driving', 12, 4) + facetStrokesGained('putting', 6, 4)) * 10) / 10);

check('nothing scored has no headline', totalStrokesGained({}, 4), null);

// -- 9. Practice handicap ----------------------------------------------------
const W = { driving: 0.30, approach: 0.35, chipping: 0.20, putting: 0.15 };
check('weights renormalise over what was scored',
  practiceHandicap({ driving: 10, approach: 10 }, W), 10);
check('a missing facet is not a zero',
  practiceHandicap({ driving: 20, approach: null }, W), 20);

// -- 10. Dispersion ----------------------------------------------------------
const centred = dispersion([2, 2, 2, 1, 3, 1, 3, 2]);
check('a symmetric pattern reads centred', centred.side, 'centred');
check('a centred pattern loses nothing to bias', centred.shotsLostToBias, 0);
const pushed = dispersion([3, 3, 4, 3, 4, 2, 3, 4]);
check('a right-side pattern reads right', pushed.side, 'right');
check('a biased pattern loses something', pushed.shotsLostToBias > 0, true);
check('negative yards is left', missSide(-8), 'left');
check('positive yards is right', missSide(8), 'right');
check('inside the deadband is centred', missSide(1.4), 'centred');
check('dispersion and missSide never disagree', pushed.side, missSide(pushed.meanYards));

// -- 11. Direction is never remembered by the caller -------------------------
check('lower handicap is better', isBetter('handicap', 8, 12), true);
check('higher strokes gained is better', isBetter('strokesGained', 1.2, -0.4), true);
check('lower drill score is better', isBetter('drillScore', 2, 5), true);

// -- 12. Formatting ----------------------------------------------------------
check('plus handicaps use the golf convention', formatHandicap(-2.4), '+2.4');
check('scratch prints as zero', formatHandicap(0), '0.0');
check('no value prints as a dash', formatHandicap(null), '—');
check('gains carry a plus', formatStrokesGained(2.44), '+2.4');
check('losses carry a true minus sign', formatStrokesGained(-2.44), '−2.4');
check('level is unsigned', formatStrokesGained(0), '0.0');
check('confidence rides with the number', formatWithConfidence(12.4, 1.1), '12.4 ± 1.1');
check('benchmark at 7.5 interpolates', benchmarkAt(7.5).yards, 233);

// ---------------------------------------------------------------------------
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
