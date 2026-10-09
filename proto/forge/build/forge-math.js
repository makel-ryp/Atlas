/**
 * FORGE — scoring math.
 *
 * Every number the app shows is computed here. Pure functions, no DOM, no state,
 * no dates read from the clock (today is always passed in). That is deliberate:
 * this file is the one part of FORGE that can be silently wrong, so it is the one
 * part that is fully testable. See forge-math.test.js for the fixture set.
 *
 * Conventions, stated once:
 *   handicap / facet index / drill score  → LOWER is better
 *   strokes gained                        → HIGHER is better
 * Anything that mixes the two goes through DIRECTION below rather than being
 * remembered by the caller.
 */

// ---------------------------------------------------------------------------
// CALIBRATION
// Every tunable number in FORGE, tagged by how far it can be trusted.
//   MEASURED  — taken from published shot data or an established practice.
//   ESTIMATED — derived from a measured quantity by a defensible model.
//   GUESS     — invented so the prototype produced plausible output. Must be
//               fitted against real players before launch.
// Nothing outside this object may contain a magic number.
// ---------------------------------------------------------------------------
export const CAL = {
  // ESTIMATED — shots per round a facet moves per stroke of its facet handicap,
  // from published strokes-gained-by-handicap slopes (scratch through 20).
  sgRate: { driving: 0.34, approach: 0.42, chipping: 0.13, putting: 0.11 },

  // ESTIMATED — standard error of a single 20-shot drill, in handicap strokes.
  se20: { driving: 1.9, approach: 1.6, chipping: 1.7, putting: 1.4 },

  // MEASURED practice — handicap systems average several rounds so that one bad
  // day cannot rewrite the number. take = how many recent scores enter the median.
  window: { take: 3, halfLifeDays: 30, staleDays: 60 },

  // GUESS — yards of RMS dispersion per shot a round, for driving bias cost.
  yardsPerShot: 0.06,

  // GUESS — ATG target pricing, in shots of allowance.
  atg: { perYard: 0.022, baseYards: 12, rungStepYards: 4, shortSided: 0.35 },

  // PROVISIONAL — maps a Putt 18 strokes-gained total onto the handicap scale.
  // Both numbers must be calibrated against known reference rounds.
  putt18: { base: 8, k: 1.2 },

  // MEASURED — average carry by handicap, men and women. Interpolated, never stepped.
  carry: {
    m: [[310, -5], [280, 0], [255, 5], [235, 10], [215, 15], [200, 20], [185, 25], [0, 30]],
    f: [[270, -5], [245, 0], [225, 5], [205, 10], [190, 15], [175, 20], [160, 25], [0, 30]]
  },

  // ESTIMATED — expected putts from d feet, fitted to tour and amateur data.
  expPutts: { a: 0.60, b: 0.46 },

  // MEASURED — typical distance and fairway rate by handicap, for comparisons.
  benchmarks: [
    { hcp: 0, yards: 250, fairwayPct: 62 },
    { hcp: 5, yards: 240, fairwayPct: 57 },
    { hcp: 10, yards: 226, fairwayPct: 52 },
    { hcp: 15, yards: 215, fairwayPct: 48 },
    { hcp: 20, yards: 202, fairwayPct: 44 },
    { hcp: 30, yards: 185, fairwayPct: 38 }
  ]
};

export const DIRECTION = {
  handicap: 'down', facetIndex: 'down', drillScore: 'down',
  strokesGained: 'up', fairwayPct: 'up', distance: 'up'
};

/** True when `a` is at least as good as `b` for the named metric. */
export function isBetter(metric, a, b) {
  return DIRECTION[metric] === 'up' ? a >= b : a <= b;
}

/** Whether a displayed figure was counted (measured) or computed (modelled). */
export const PROVENANCE = {
  fairwaysHit: 'measured', bigMisses: 'measured', puttsTaken: 'measured',
  drillScore: 'measured', averageDistance: 'measured',
  facetIndex: 'modelled', strokesGained: 'modelled', biasCost: 'modelled',
  dispersion: 'modelled', practiceHandicap: 'modelled'
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = v => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Baseline handicap from average driving distance, linearly interpolated between
 * table rows. A step table would put 234 and 236 yards a full stroke apart.
 */
export function baselineHandicap(yards, gender = 'm') {
  const T = CAL.carry[gender] || CAL.carry.m;
  const y = Number(yards) || 0;
  if (!y) return 30;
  if (y >= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (y >= T[i][0]) {
      const hi = T[i - 1], lo = T[i];
      const k = (y - lo[0]) / (hi[0] - lo[0]);
      return round1(lo[1] + (hi[1] - lo[1]) * k);
    }
  }
  return T[T.length - 1][1];
}

/** Benchmark distance and fairway rate for a handicap, interpolated. */
export function benchmarkAt(handicap) {
  const B = CAL.benchmarks;
  const h = clamp(handicap, B[0].hcp, B[B.length - 1].hcp);
  for (let i = 1; i < B.length; i++) {
    if (h <= B[i].hcp) {
      const a = B[i - 1], b = B[i], k = (h - a.hcp) / (b.hcp - a.hcp);
      return {
        yards: Math.round(a.yards + (b.yards - a.yards) * k),
        fairwayPct: Math.round(a.fairwayPct + (b.fairwayPct - a.fairwayPct) * k)
      };
    }
  }
  return { yards: B[B.length - 1].yards, fairwayPct: B[B.length - 1].fairwayPct };
}

// ---------------------------------------------------------------------------
// Facet indices
// ---------------------------------------------------------------------------

export function clampIndex(x) { return round1(clamp(x, -6, 40)); }

/**
 * Driving index. `zones` is one entry per drive: 2 fairway, 1 small miss, 0 big.
 * A small miss is deliberately neutral; a big miss costs two fairways.
 */
export function drivingIndex(zones, averageYards, gender = 'm') {
  if (!zones || zones.length < 5) return null;
  const fw = zones.filter(z => z === 2).length;
  const big = zones.filter(z => z === 0).length;
  const scale = 20 / zones.length;
  return clampIndex(baselineHandicap(averageYards, gender) + (8 - (fw - big * 2) * scale));
}

/**
 * Head-scored facet index: a level base plus the drill total on the level's slope.
 * `total` is the score the player counted; short sets are scaled to 20 shots.
 */
export function headScoredIndex({ total, shots, base, slope, allowance = 0 }) {
  if (shots < 5) return null;
  const scaled = total * (20 / shots);
  return clampIndex(base + (scaled - allowance) * slope);
}

/**
 * Shots of allowance for a set of ATG targets, priced against the baseline the
 * CURRENT rung already expects. Pricing against a fixed distance would hand back
 * allowance the rung's own base already charges for, so a promotion would improve
 * the index by itself.
 */
export function atgAllowance({ distances, shortSided = [], rung = 0, shots }) {
  if (!distances || !distances.length) return 0;
  const n = Math.max(1, shots || distances.length);
  const per = 20 / n;
  const rungBase = CAL.atg.baseYards + rung * CAL.atg.rungStepYards;
  return distances.slice(0, n).reduce((acc, yd, i) => {
    const hard = CAL.atg.perYard * (clamp(yd, 3, 40) - rungBase)
      + (shortSided[i] ? CAL.atg.shortSided : 0);
    return acc + hard * per;
  }, 0);
}

// ---------------------------------------------------------------------------
// Putting
// ---------------------------------------------------------------------------

export function expectedPutts(feet) {
  return CAL.expPutts.a + CAL.expPutts.b * Math.log(Math.max(feet, 2));
}

/** Putt 18 strokes gained → putting handicap. */
export function putt18Handicap(strokesGained) {
  if (strokesGained == null || isNaN(strokesGained)) return null;
  return clampIndex(CAL.putt18.base - strokesGained * CAL.putt18.k);
}

// ---------------------------------------------------------------------------
// Current picture — rolling, age-weighted, with a real sample size
// ---------------------------------------------------------------------------

export function daysBetween(isoDate, todayIso) {
  const p = String(isoDate).split('-').map(Number);
  const t = String(todayIso).split('-').map(Number);
  const then = Date.UTC(p[0], p[1] - 1, p[2]);
  const now = Date.UTC(t[0], t[1] - 1, t[2]);
  return Math.max(0, Math.round((now - then) / 864e5));
}

/**
 * The current value for one facet: the age-weighted median of the last few
 * qualifying scores, newest first. A median (not a mean) so one blow-up session
 * cannot drag the number, and age-weighted so a score from two months ago counts
 * for less than one from yesterday.
 *
 * Returns { value, n, se, days, stale } or null when nothing qualifies.
 */
export function currentFacet(sessions, facetId, todayIso, opts = {}) {
  const W = Object.assign({}, CAL.window, opts);
  const hits = [];
  for (let i = 0; i < sessions.length && hits.length < W.take; i++) {
    const s = sessions[i];
    const v = s.facets ? s.facets[facetId] : null;
    if (v == null) continue;
    if (s.complete && s.complete[facetId] === false) continue;
    if (!(s.complete && s.complete[facetId])) {
      const n = s.shots ? s.shots[facetId] : 20;
      if (n != null && n < 20) continue;      // provisional: never sets the number
    }
    hits.push({ v: clamp(v, -6, 40), days: daysBetween(s.date, todayIso) });
  }
  if (!hits.length) return null;

  const weight = h => Math.pow(0.5, h.days / W.halfLifeDays);
  const sorted = hits.slice().sort((a, b) => a.v - b.v);
  const total = sorted.reduce((a, h) => a + weight(h), 0);
  let acc = 0, median = sorted[sorted.length - 1].v;
  for (const h of sorted) { acc += weight(h); if (acc >= total / 2) { median = h.v; break; } }

  return {
    value: round1(median),
    n: hits.length,
    se: round1(CAL.se20[facetId] / Math.sqrt(hits.length)),
    days: hits[0].days,
    stale: hits[0].days > W.staleDays
  };
}

/** Every facet's current value, keyed by id. */
export function currentPicture(sessions, facetIds, todayIso) {
  const out = {};
  facetIds.forEach(id => { const c = currentFacet(sessions, id, todayIso); if (c) out[id] = c; });
  return out;
}

// ---------------------------------------------------------------------------
// Strokes gained
// ---------------------------------------------------------------------------

/**
 * Strokes gained for one facet, priced absolutely: how far the facet sits from
 * target, times how many shots a round that part of the game is worth.
 *
 * This does NOT share out a composite gap. Sharing meant a facet's number moved
 * when an unrelated drill was scored in the same session — improving your putting
 * changed your driving figure. Absolute pricing removes that entirely, at the cost
 * that the parts no longer sum to the handicap gap; they sum to the headline,
 * which is now defined as their sum.
 */
export function facetStrokesGained(facetId, value, target) {
  if (value == null) return null;
  return (target - value) * (CAL.sgRate[facetId] || 0);
}

export function totalStrokesGained(valuesByFacet, target) {
  let any = false, sum = 0;
  Object.keys(valuesByFacet).forEach(id => {
    const v = valuesByFacet[id];
    if (v == null) return;
    any = true;
    sum += facetStrokesGained(id, v, target);
  });
  return any ? round1(sum) : null;
}

/** Weighted mean of available facet indices — the Practice Handicap. */
export function practiceHandicap(valuesByFacet, weights) {
  let w = 0, t = 0;
  Object.keys(valuesByFacet).forEach(id => {
    const v = valuesByFacet[id];
    if (v == null) return;
    w += weights[id]; t += weights[id] * v;
  });
  return w ? round1(t / w) : null;
}

// ---------------------------------------------------------------------------
// Dispersion
// ---------------------------------------------------------------------------

/**
 * Bias and spread from a set of zone tallies, and what the bias costs.
 * Offset and width add in quadrature: a player centred µ off with width σ plays
 * like one centred with dispersion √(µ² + σ²). The cost is that difference,
 * Sign convention, defined once in missSide(): negative yards is LEFT of target.
 * converted to shots by CAL.yardsPerShot — the weakest constant in the file.
 */
export function missSide(meanYards, deadband = 3) {
  if (meanYards == null || isNaN(meanYards)) return 'centred';
  return Math.abs(meanYards) < deadband ? 'centred' : (meanYards < 0 ? 'left' : 'right');
}

export function dispersion(zones, zoneCentresYards = [-38, -18, 0, 18, 38]) {
  if (!zones || !zones.length) return null;
  const n = zones.length;
  const mean = zones.reduce((a, z) => a + zoneCentresYards[z], 0) / n;
  const variance = zones.reduce((a, z) => a + Math.pow(zoneCentresYards[z] - mean, 2), 0) / n;
  const sd = Math.sqrt(variance) || 1;
  const rms = Math.sqrt(mean * mean + sd * sd);
  return {
    meanYards: round1(mean),
    sdYards: round1(sd),
    side: missSide(mean),
    shotsLostToBias: round1((rms - sd) * CAL.yardsPerShot)
  };
}

// ---------------------------------------------------------------------------
// Formatting — one place, so no two screens disagree about a minus sign
// ---------------------------------------------------------------------------

export function formatHandicap(x) {
  if (x == null || isNaN(x)) return '—';
  const n = round1(x);
  return n < -0.05 ? '+' + Math.abs(n).toFixed(1) : n.toFixed(1);
}

export function formatStrokesGained(x) {
  if (x == null || isNaN(x)) return '—';
  const n = round1(x);
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);
}

/** "12.4 ± 1.1" — never show an index without the range it could honestly be. */
export function formatWithConfidence(value, se) {
  if (value == null) return '—';
  return formatHandicap(value) + (se ? ' ± ' + se.toFixed(1) : '');
}
