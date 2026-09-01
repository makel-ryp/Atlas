/**
 * Practice DNA scoring engine — isomorphic (client preview + server authoritative).
 *
 * Pure function of (answers, profile, metrics, config) — no I/O — so any stored response
 * can be re-scored from raw inputs when the model evolves (see recompute.ts). Tunable
 * inputs (item membership, weights, thresholds, ROI, routing) live in config.ts and are
 * stamped onto every result by version. Item text lives in items.ts; copy in results-content.ts.
 */

import {
  Answers,
  AllocValue,
  ITEM_BY_CODE,
  Profile,
  QuizItem,
  ScaleId,
  Tier,
  itemsForTier,
} from './items';
import {
  ALLOC_BENCHMARK,
  ARTIST_ITEMS,
  CONFIG_VERSION,
  EFFICIENCY_WEIGHTS,
  ENGINEER_ITEMS,
  KERNEL_SIGMA,
  MASTERY_BANDS,
  MASTERY_ITEMS,
  MI_BALANCED_BAND,
  MI_ESTIMATE_HALF_WIDTH,
  RESULT_VERSION,
  SCORING_VERSION,
  TENDENCY_BANDS,
  THRESHOLDS,
  ZONE_BUILD_ORDER,
  ZONE_COORDS,
  ZONE_TRAINABILITY,
  isScored,
} from './config';

// Re-export the config constants that were previously part of this module's public API.
export { ALLOC_BENCHMARK, MASTERY_BANDS, TENDENCY_BANDS, ZONE_COORDS } from './config';
export { CONFIG_VERSION, RESULT_VERSION, SCORING_VERSION } from './config';
export type { MetricSource, MetricType } from './config';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PersonaId = 'engineer' | 'scientist' | 'warrior' | 'artist';
export type ZoneId = 'construction' | 'calibration' | 'transfer' | 'performance';
export type PatternId = 'ghost' | 'prisoner' | 'illusionist';
export type ChipId = 'comfortCreature' | 'quickFix' | 'scrappyGamer';
export type Confidence = 'baseline' | 'sharpened' | 'full';

/** Where you land on the one tendency axis. */
export type TendencyLabel = 'engineer' | 'blended' | 'artist';

/** Per-zone Skill Band status (mastery only). */
export type MasteryStatus = 'strong' | 'building' | 'dim' | 'locked';

/** One canonical archetype (tendency × pattern), framed as a changeable diagnosis. */
export type Archetype =
  | 'architect'
  | 'quickFixJunkie'
  | 'comfortCreature'
  | 'scrappyGamer'
  | 'naturalEngineer'
  | 'naturalArtist';

/** Objective measurements from the RYP ecosystem (Parallax / Strategy / Debrief / manual). */
export interface PlayerMetrics {
  /** Video-derived swing quality on the handicap scale — lower is better. */
  mechanicsIndex?: number;
  clubHeadSpeed?: number;
  /** Objective handicap (GHIN/Strategy); overrides the profile value when present. */
  handicap?: number;
  onCourseScore?: number;
}

export type MiState = 'none' | 'estimated' | 'measured';
/** What the handicap-vs-MI gap says to build next. */
export type MiVerdict = 'construction' | 'balanced' | 'downstream';

export interface MiDiagnostic {
  state: MiState;
  handicap: number | null;
  /** Point value when measured; band midpoint when estimated; null when unknowable. */
  mi: number | null;
  /** Estimate band [low, high] — shown instead of a point until a real MI lands. */
  miRange: [number, number] | null;
  /** handicap − mi. Positive ⇒ swing built ahead of scoring. */
  gap: number | null;
  verdict: MiVerdict | null;
}

export const PERSONA_HOME_ZONE: Record<PersonaId, ZoneId> = {
  engineer: 'construction',
  scientist: 'calibration',
  warrior: 'transfer',
  artist: 'performance',
};

export const ZONE_PERSONA: Record<ZoneId, PersonaId> = {
  construction: 'engineer',
  calibration: 'scientist',
  transfer: 'warrior',
  performance: 'artist',
};

export interface HeatKernel {
  zone: ZoneId;
  x: number;
  y: number;
  intensity: number; // 0–1
  sigma: number;
  /**
   * Region overlay kernel (comfort/danger corner), not one of the four zone anchors. When
   * set, HeatMap draws only its glow — no zone dot or label (the corner isn't a zone). Unset
   * for normal zone kernels, so the shipped fingerprint is unaffected. See regions.ts.
   */
  region?: boolean;
}

export interface AttentionReport {
  ATTN01: 'pass' | 'fail' | 'missing';
  ATTN02: 'pass' | 'fail' | 'missing';
  failures: number;
}

export interface FalsePriorFlags {
  construction: boolean; // can't tolerate poor results while building
  transfer: boolean; // grooves one shot instead of gamifying
  performance: boolean; // tinkers with swing thoughts mid-round
  calibration: boolean; // hits balls without reading flight
}

export interface PracticeDnaResult {
  quizConfidence: Confidence;
  scaleScores: Partial<Record<ScaleId, number>>; // 0–100, absent if unanswered
  architect: number | null; // meta-persona signal, null until 1B data exists

  // ── Axis 1: Tendency (Engineer ↔ Artist, the headline) ──
  tendency: number; // 0 = pure Engineer (thinker) · 100 = pure Artist (doer)
  tendencyLabel: TendencyLabel; // engineer-leaning / blended / artist-leaning
  tendencyProvisional: boolean; // true at Tier 1A (only EA01/EA05 answered)

  // ── Axis 2: Mastery (the Skill Band, per zone) ──
  mastery: Record<ZoneId, number | null>; // SELF-RATED capability 0–100, null if no data yet
  masteryStatus: Record<ZoneId, MasteryStatus>; // strong / building / dim / locked
  growthZone: ZoneId | null; // priority zone — what to build next (MI-gated, ROI-weighted)

  // ── Recognition (one canonical type, a diagnosis not a verdict) ──
  archetype: Archetype;
  archetypeProvisional: boolean;

  // ── Where your time goes vs where it should (the % time bars) ──
  zoneIntensity: Record<ZoneId, number>; // 0–1 heat-map brightness from ALLOC
  heatKernels: HeatKernel[];
  actualAlloc: Record<ZoneId, number>; // % of practice time, per zone (sums ~100)
  recommendedAlloc: Record<ZoneId, number>; // % of practice time, per zone (sums 100)

  // ── Mechanics Index ↔ handicap + Efficiency ──
  mi: MiDiagnostic;
  efficiency: number; // 0–100: how much of your practice moves your handicap

  // ── Diagnosis ──
  pattern: PatternId | null;
  ghostZone: ZoneId | null;
  chips: ChipId[];
  allocDelta: AllocValue; // user minus benchmark, percentage points
  falsePriors: FalsePriorFlags | null;
  attention: AttentionReport;

  // ── Provenance (for recompute + research) ──
  scoringVersion: string;
  configVersion: string;
  resultVersion: string;
}

// ── Normalization helpers ─────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Guard against NaN/Infinity reaching the UI; falls back to a safe default. */
const safe = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/** Normalize a raw answer to 0–1 with reverse handling. Returns null for non-scalar/unknown. */
function normalizeItem(item: QuizItem, raw: number): number | null {
  let norm: number;
  switch (item.type) {
    case 'likert':
      norm = clamp(raw, 0, 100) / 100;
      break;
    case 'stepper':
      norm = clamp(raw, 0, 7) / 7;
      break;
    case 'bipolar':
    case 'sliderCheck':
      norm = clamp(raw, 0, 100) / 100;
      break;
    default:
      return null;
  }
  return item.reverse ? 1 - norm : norm;
}

function isAlloc(v: unknown): v is AllocValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as AllocValue).construction === 'number' &&
    typeof (v as AllocValue).calibration === 'number' &&
    typeof (v as AllocValue).transfer === 'number' &&
    typeof (v as AllocValue).performance === 'number'
  );
}

/** Round a positive-weight distribution to integers summing to exactly 100. */
function toRounded100(raw: Record<ZoneId, number>): Record<ZoneId, number> {
  const total = ZONE_BUILD_ORDER.reduce((a, z) => a + safe(raw[z]), 0);
  if (total <= 0) {
    return { construction: 25, calibration: 25, transfer: 25, performance: 25 };
  }
  const out = {} as Record<ZoneId, number>;
  let acc = 0;
  ZONE_BUILD_ORDER.forEach((z, i) => {
    if (i === ZONE_BUILD_ORDER.length - 1) {
      out[z] = 100 - acc;
    } else {
      out[z] = Math.round((safe(raw[z]) / total) * 100);
      acc += out[z];
    }
  });
  return out;
}

// ── Scale scores ──────────────────────────────────────────────────────────────

/** Mean of answered, ACTIVE items per scale, 0–100. Attention checks and ALLOC excluded. */
export function computeScaleScores(answers: Answers): Partial<Record<ScaleId, number>> {
  const sums = new Map<ScaleId, { total: number; n: number }>();
  for (const [code, raw] of Object.entries(answers)) {
    if (!isScored(code)) continue; // candidate/retired items captured but not scored
    const item = ITEM_BY_CODE.get(code);
    if (!item || item.scale === 'attention' || item.scale === 'alloc') continue;
    if (typeof raw !== 'number') continue;
    const norm = normalizeItem(item, raw);
    if (norm === null) continue;
    const entry = sums.get(item.scale) ?? { total: 0, n: 0 };
    entry.total += norm;
    entry.n += 1;
    sums.set(item.scale, entry);
  }
  const out: Partial<Record<ScaleId, number>> = {};
  for (const [scale, { total, n }] of sums) {
    out[scale] = Math.round((total / n) * 100);
  }
  return out;
}

// ── Zone intensity (heat map) ─────────────────────────────────────────────────

function getAlloc(answers: Answers): AllocValue {
  const raw = answers['ALLOC'];
  if (isAlloc(raw)) return raw;
  return { construction: 25, calibration: 25, transfer: 25, performance: 25 };
}

/**
 * ALLOC → four zones, scaled by practice volume (FREQ01): a once-a-month golfer's
 * map is dimmer than a daily grinder's at the same split. ALLOC now has one bucket
 * per zone, so this is a direct pass-through.
 */
export function computeZoneIntensity(answers: Answers): Record<ZoneId, number> {
  const alloc = getAlloc(answers);

  const freqRaw = answers['FREQ01'];
  const freq = typeof freqRaw === 'number' ? clamp(freqRaw, 0, 7) : 3;
  const volumeFactor = 0.4 + 0.6 * (freq / 7);

  return {
    construction: clamp((alloc.construction / 100) * volumeFactor, 0, 1),
    calibration: clamp((alloc.calibration / 100) * volumeFactor, 0, 1),
    transfer: clamp((alloc.transfer / 100) * volumeFactor, 0, 1),
    performance: clamp((alloc.performance / 100) * volumeFactor, 0, 1),
  };
}

/** The user's actual practice split mapped to the four zones, as % of time (sums ~100). */
export function actualZoneAlloc(answers: Answers): Record<ZoneId, number> {
  const alloc = getAlloc(answers);
  return toRounded100({
    construction: alloc.construction,
    calibration: alloc.calibration,
    transfer: alloc.transfer,
    performance: alloc.performance,
  });
}

// ── Axis 1: Tendency (Engineer ↔ Artist) ──────────────────────────────────────

/** Mean of answered, ACTIVE items in a code list, 0–100, or null if none answered. */
function meanOf(answers: Answers, codes: readonly string[]): number | null {
  const vals = codes
    .filter((c) => isScored(c))
    .map((c) => answers[c])
    .filter((v): v is number => typeof v === 'number')
    .map((v) => clamp(v, 0, 100));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * Bipolar tendency on the book's diagonal: 0 = pure Engineer (thinker), 100 = pure
 * Artist (doer), ~50 = blended. Missing a pole ⇒ that side reads neutral (50).
 */
export function computeTendency(answers: Answers): number {
  const eng = meanOf(answers, ENGINEER_ITEMS) ?? 50;
  const art = meanOf(answers, ARTIST_ITEMS) ?? 50;
  return Math.round(clamp(50 + (art - eng) / 2, 0, 100));
}

export function tendencyLabel(tendency: number): TendencyLabel {
  if (tendency <= TENDENCY_BANDS.engineerMax) return 'engineer';
  if (tendency >= TENDENCY_BANDS.artistMin) return 'artist';
  return 'blended';
}

/** Tendency is firm once each pole has ≥2 answered items (arrives at Tier 1B). */
export function isTendencyProvisional(answers: Answers): boolean {
  const engCount = ENGINEER_ITEMS.filter((c) => isScored(c) && typeof answers[c] === 'number').length;
  const artCount = ARTIST_ITEMS.filter((c) => isScored(c) && typeof answers[c] === 'number').length;
  return engCount < 2 || artCount < 2;
}

// ── Axis 2: Mastery (the Skill Band, per zone) ────────────────────────────────

/** Self-rated mastery per zone, 0–100. Null when no mastery item is answered yet. */
export function computeMastery(answers: Answers): Record<ZoneId, number | null> {
  const out = {} as Record<ZoneId, number | null>;
  for (const zone of Object.keys(MASTERY_ITEMS) as ZoneId[]) {
    const mean = meanOf(answers, MASTERY_ITEMS[zone]);
    out[zone] = mean === null ? null : Math.round(mean);
  }
  return out;
}

export function masteryStatus(value: number | null): MasteryStatus {
  if (value === null) return 'locked';
  if (value >= MASTERY_BANDS.strongMin) return 'strong';
  if (value >= MASTERY_BANDS.buildingMin) return 'building';
  return 'dim';
}

export function computeMasteryStatus(
  mastery: Record<ZoneId, number | null>,
): Record<ZoneId, MasteryStatus> {
  const out = {} as Record<ZoneId, MasteryStatus>;
  for (const zone of Object.keys(mastery) as ZoneId[]) out[zone] = masteryStatus(mastery[zone]);
  return out;
}

/** Deficit (0–1) of a zone vs the "strong" bar — how far it has to climb. */
function zoneDeficit(value: number | null): number {
  if (value === null) return 0.5; // unmeasured ⇒ moderate assumed need
  return clamp((MASTERY_BANDS.strongMin - value) / MASTERY_BANDS.strongMin, 0, 1);
}

/**
 * Priority zone — what to build next. NOT automatically "transfer": the MI-vs-handicap
 * gap gates it, then ROI (deficit × trainability) picks among the candidates, with
 * calibration favored as the lowest-hanging fruit.
 *  - MI says swing isn't built (verdict 'construction') ⇒ Construction first.
 *  - MI says swing is built ahead of scoring ('downstream') ⇒ weakest of cal/transfer/perf by ROI.
 *  - No MI / balanced ⇒ weakest measured zone overall by ROI.
 */
export function computeGrowthZone(
  mastery: Record<ZoneId, number | null>,
  mi?: MiDiagnostic,
): ZoneId | null {
  if (mi && mi.verdict === 'construction') return 'construction';
  const candidates: readonly ZoneId[] =
    mi && mi.verdict === 'downstream'
      ? ['calibration', 'transfer', 'performance']
      : ZONE_BUILD_ORDER;

  let best: ZoneId | null = null;
  let bestScore = -Infinity;
  for (const zone of candidates) {
    const v = mastery[zone];
    if (v === null || v === undefined) continue;
    const score = zoneDeficit(v) * ZONE_TRAINABILITY[zone];
    if (score > bestScore) {
      bestScore = score;
      best = zone;
    }
  }
  // Fall back to the dimmest measured zone if nothing among the candidates was measured.
  if (best === null) {
    let lo = Infinity;
    for (const zone of ZONE_BUILD_ORDER) {
      const v = mastery[zone];
      if (v !== null && v !== undefined && v < lo) {
        lo = v;
        best = zone;
      }
    }
  }
  return best;
}

/**
 * Recommended practice split across the four zones (% of time, sums to 100), driven by
 * the MI diagnostic (Construction need) + downstream ROI (deficit × trainability). A
 * floor keeps it a real distribution, and you always keep some time on the course.
 */
export function recommendedAlloc(
  mastery: Record<ZoneId, number | null>,
  mi: MiDiagnostic,
): Record<ZoneId, number> {
  const need = {} as Record<ZoneId, number>;

  // Construction need comes from the MI verdict, not self-rated mastery.
  const constructionNeed =
    mi.verdict === 'construction' ? 1.0 : mi.verdict === 'downstream' ? 0.2 : 0.5;
  need.construction = constructionNeed * ZONE_TRAINABILITY.construction;

  for (const zone of ['calibration', 'transfer', 'performance'] as ZoneId[]) {
    need[zone] = zoneDeficit(mastery[zone]) * ZONE_TRAINABILITY[zone];
  }

  const FLOOR = 0.08; // every zone keeps a sliver so the bars read as a distribution
  const floored = {} as Record<ZoneId, number>;
  for (const zone of ZONE_BUILD_ORDER) floored[zone] = safe(need[zone]) + FLOOR;
  return toRounded100(floored);
}

/**
 * Practice Efficiency Score (0–100): how much of your practice actually moves your handicap.
 * Allocation fit (actual vs recommended) + practice quality (failure-mode penalties) +
 * transfer term. Monotonic in allocation fit. Sharpens when a real MI/Transfer number lands.
 */
export function computeEfficiency(
  actual: Record<ZoneId, number>,
  recommended: Record<ZoneId, number>,
  scales: Partial<Record<ScaleId, number>>,
  mastery: Record<ZoneId, number | null>,
): number {
  // Allocation fit: 1 − normalized L1 distance (max distance between two distributions = 200).
  let l1 = 0;
  for (const zone of ZONE_BUILD_ORDER) l1 += Math.abs(safe(actual[zone]) - safe(recommended[zone]));
  const allocationFit = clamp(1 - l1 / 200, 0, 1);

  // Practice quality: penalize comfort-seeking and quick-fixing.
  const cc = scales.comfortCreature ?? 0;
  const qfj = scales.quickFixJunkie ?? 0;
  const practiceQuality = clamp(1 - (cc + qfj) / 200, 0, 1);

  // Transfer term: higher transfer mastery ⇒ smaller gap ⇒ more of the work shows up scoring.
  const tra = mastery.transfer;
  const transferTerm = tra === null ? 0.5 : clamp(tra / 100, 0, 1);

  const score =
    EFFICIENCY_WEIGHTS.allocationFit * allocationFit +
    EFFICIENCY_WEIGHTS.practiceQuality * practiceQuality +
    EFFICIENCY_WEIGHTS.transferGap * transferTerm;
  return Math.round(clamp(safe(score), 0, 1) * 100);
}

// ── Mechanics Index ↔ handicap diagnostic ─────────────────────────────────────

/** Objective handicap (Strategy/GHIN) when present, else the profile value, else null. */
export function resolveHandicap(profile: Profile, metrics?: PlayerMetrics): number | null {
  if (metrics?.handicap != null && Number.isFinite(metrics.handicap)) return metrics.handicap;
  const h = Number.parseInt(profile.PRO_HCP_NOW, 10);
  return Number.isNaN(h) ? null : h;
}

/**
 * Estimate the Mechanics Index from self-rated mechanics, anchored to the handicap.
 * Neutral self-rating (50) ⇒ MI ≈ handicap. Confident (→100) ⇒ MI up to 8 strokes better;
 * doubtful (→0) ⇒ up to 8 worse. Deliberately a band, never trusted as a point.
 */
function estimateMi(handicap: number, scales: Partial<Record<ScaleId, number>>): number {
  const mech = scales.mechanics ?? 50;
  const shift = ((mech - 50) / 50) * 8;
  return clamp(handicap - shift, 0, 54);
}

export function miDiagnostic(
  profile: Profile,
  scales: Partial<Record<ScaleId, number>>,
  metrics?: PlayerMetrics,
): MiDiagnostic {
  const handicap = resolveHandicap(profile, metrics);

  const verdictFor = (gap: number): MiVerdict =>
    gap > MI_BALANCED_BAND ? 'downstream' : gap < -MI_BALANCED_BAND ? 'construction' : 'balanced';

  // Measured — a real MI from Parallax/Atlas/a teaching pro.
  if (metrics?.mechanicsIndex != null && Number.isFinite(metrics.mechanicsIndex)) {
    const mi = clamp(metrics.mechanicsIndex, 0, 54);
    const gap = handicap === null ? null : handicap - mi;
    return {
      state: 'measured',
      handicap,
      mi,
      miRange: null,
      gap,
      verdict: gap === null ? null : verdictFor(gap),
    };
  }

  // Estimated — from self-report, shown as a band, needs a handicap to anchor.
  if (handicap !== null) {
    const est = estimateMi(handicap, scales);
    const gap = handicap - est;
    return {
      state: 'estimated',
      handicap,
      mi: Math.round(est),
      miRange: [
        Math.round(clamp(est - MI_ESTIMATE_HALF_WIDTH, 0, 54)),
        Math.round(clamp(est + MI_ESTIMATE_HALF_WIDTH, 0, 54)),
      ],
      gap,
      verdict: verdictFor(gap),
    };
  }

  // No handicap ⇒ nothing to diagnose against yet.
  return { state: 'none', handicap: null, mi: null, miRange: null, gap: null, verdict: null };
}

// ── Archetype recognition (one canonical type) ────────────────────────────────

/**
 * Priority cascade → one canonical, book-named type. A diagnosis, not a verdict.
 * Healthy (Architect) wins first; then the loud failure modes; then tendency fallbacks.
 */
export function computeArchetype(args: {
  tendencyLabel: TendencyLabel;
  /** 0 = pure Engineer, 100 = pure Artist. Breaks the blended tie — see the tail of the cascade. */
  tendency: number;
  pattern: PatternId | null;
  chips: ChipId[];
  masteryStatus: Record<ZoneId, MasteryStatus>;
  hcpImprovement: number | null;
}): Archetype {
  const {
    tendencyLabel: tl,
    tendency,
    pattern,
    chips,
    masteryStatus: ms,
    hcpImprovement: hcp,
  } = args;
  const hasDim = (Object.values(ms) as MasteryStatus[]).some((s) => s === 'dim');

  // The Architect's copy asserts two checkable facts — "your handicap is falling and no zone is
  // starving" — so it may only be awarded where both hold.
  if ((hcp ?? 0) > 0 && !hasDim) return 'architect';
  if (chips.includes('quickFix')) return 'quickFixJunkie';
  if (chips.includes('comfortCreature')) return 'comfortCreature';
  if (chips.includes('scrappyGamer')) return 'scrappyGamer';
  if (
    tl === 'engineer' &&
    (pattern === 'prisoner' ||
      pattern === 'illusionist' ||
      ms.performance === 'dim' ||
      ms.transfer === 'dim')
  ) {
    return 'naturalEngineer';
  }
  if (tl === 'artist' && ms.construction === 'dim') return 'naturalArtist';
  if (tl === 'engineer') return 'naturalEngineer';
  if (tl === 'artist') return 'naturalArtist';

  /**
   * Blended tendency with no chip, no pattern, and no dim-zone signal.
   *
   * This used to `return 'architect'`, which bypassed the evidence gate at the top of the
   * cascade: a golfer whose handicap had gone from 12 to 20 was told "your handicap is falling",
   * and one with a starving zone was told "no zone is starving". Neither was checked on this
   * path, and a golfer who never entered a handicap at all got the same read. Two fabricated
   * claims — the exact thing the No Fiction rule exists to prevent.
   *
   * So the fallback now leans on whichever pole they sit nearer, whose copy makes no claim about
   * their handicap trend or their zones. 50 goes to the Artist: an arbitrary but deterministic
   * tie-break, and 50.0 exactly is vanishingly rare on a 0–100 scale.
   *
   * The Architect is now reachable only through the gate above, i.e. only on evidence.
   */
  return tendency < 50 ? 'naturalEngineer' : 'naturalArtist';
}

// ── Architect center (kept, minor) ────────────────────────────────────────────

export function computeArchitect(answers: Answers): number | null {
  const norm01 = (v: number) => clamp(v, 0, 100) / 100;
  const parts: number[] = [];
  const c01 = answers['C01'];
  if (typeof c01 === 'number') parts.push(norm01(c01));
  const a02 = answers['A02'];
  if (typeof a02 === 'number') parts.push(norm01(a02));
  const masCal = answers['MAS_CAL_LIGHT'];
  if (typeof masCal === 'number') parts.push(norm01(masCal));
  if (parts.length < 2) return null;
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

// ── Pattern (failure mode) detection ──────────────────────────────────────────

/** Handicap improvement over three years, positive = improving. Null when unknowable. */
export function hcpImprovement(profile: Profile): number | null {
  const now = Number.parseInt(profile.PRO_HCP_NOW, 10);
  if (Number.isNaN(now)) return null;
  const prevRaw = profile.PRO_HCP_3YR;
  if (prevRaw === 'About the same') return 0;
  if (prevRaw === "Wasn't playing") return null;
  const prev = prevRaw === 'Higher than 54' ? 55 : Number.parseInt(prevRaw, 10);
  if (Number.isNaN(prev)) return null;
  return prev - now;
}

export interface PatternDetection {
  pattern: PatternId | null;
  ghostZone: ZoneId | null;
}

/**
 * "Three patterns, one heat map." Priority: Illusionist > Prisoner > Ghost —
 * ordered by evidence specificity.
 */
export function detectPattern(
  profile: Profile,
  scales: Partial<Record<ScaleId, number>>,
  zones: Record<ZoneId, number>,
  answers: Answers,
): PatternDetection {
  const mech = scales.mechanics ?? 0;
  const cc = scales.comfortCreature ?? 0;
  const improvement = hcpImprovement(profile);

  if (
    mech >= THRESHOLDS.illusionistMechanics &&
    cc >= THRESHOLDS.illusionistComfort &&
    improvement !== null &&
    improvement <= 0
  ) {
    return { pattern: 'illusionist', ghostZone: null };
  }

  const alloc = getAlloc(answers);
  for (const bucket of Object.values(alloc)) {
    if (bucket >= THRESHOLDS.prisonerAllocShare && cc >= THRESHOLDS.prisonerAffinity) {
      return { pattern: 'prisoner', ghostZone: null };
    }
  }

  const zoneEntries = Object.entries(zones) as Array<[ZoneId, number]>;
  zoneEntries.sort((a, b) => a[1] - b[1]);
  const dimmest = zoneEntries[0];
  if (dimmest && dimmest[1] <= THRESHOLDS.ghostZoneIntensity) {
    return { pattern: 'ghost', ghostZone: dimmest[0] };
  }

  return { pattern: null, ghostZone: null };
}

export function detectChips(scales: Partial<Record<ScaleId, number>>): ChipId[] {
  const chips: ChipId[] = [];
  const cc = scales.comfortCreature ?? 0;
  const qfj = scales.quickFixJunkie ?? 0;
  const tra = scales.transfer ?? 0;
  if (cc >= THRESHOLDS.chipScale) chips.push('comfortCreature');
  if (qfj >= THRESHOLDS.chipScale) chips.push('quickFix');
  if (tra >= THRESHOLDS.chipScale && cc < THRESHOLDS.scrappyGamerComfortCeiling) {
    chips.push('scrappyGamer');
  }
  return chips;
}

// ── False priors (Tier 2) ─────────────────────────────────────────────────────

export function detectFalsePriors(answers: Answers): FalsePriorFlags | null {
  const fpCon = answers['FP_CON'];
  const fpTra = answers['FP_TRA'];
  const fpPer = answers['FP_PER'];
  const fpCal = answers['FP_CAL'];
  const answered = [fpCon, fpTra, fpPer, fpCal].filter((v) => typeof v === 'number');
  if (answered.length === 0) return null;
  return {
    construction: typeof fpCon === 'number' ? fpCon <= 25 : false,
    transfer: typeof fpTra === 'number' ? fpTra < 40 : false,
    performance: typeof fpPer === 'number' ? fpPer >= 75 : false,
    calibration: typeof fpCal === 'number' ? fpCal >= 75 : false,
  };
}

// ── Attention checks ──────────────────────────────────────────────────────────

export function checkAttention(answers: Answers): AttentionReport {
  const evaluate = (code: 'ATTN01' | 'ATTN02'): 'pass' | 'fail' | 'missing' => {
    const item = ITEM_BY_CODE.get(code);
    const raw = answers[code];
    if (!item?.check || typeof raw !== 'number') return 'missing';
    return raw >= item.check.passMin && raw <= item.check.passMax ? 'pass' : 'fail';
  };
  const a1 = evaluate('ATTN01');
  const a2 = evaluate('ATTN02');
  return {
    ATTN01: a1,
    ATTN02: a2,
    failures: (a1 === 'fail' ? 1 : 0) + (a2 === 'fail' ? 1 : 0),
  };
}

// ── Confidence + heat kernels ─────────────────────────────────────────────────

export function computeConfidence(answers: Answers): Confidence {
  let has1B = false;
  let has2 = false;
  for (const code of Object.keys(answers)) {
    const item = ITEM_BY_CODE.get(code);
    if (!item || item.scale === 'attention') continue;
    if (item.tier === '1B') has1B = true;
    if (item.tier === '2') has2 = true;
  }
  if (has2) return 'full';
  if (has1B) return 'sharpened';
  return 'baseline';
}

export function computeHeatKernels(
  zones: Record<ZoneId, number>,
  confidence: Confidence,
): HeatKernel[] {
  const sigma = KERNEL_SIGMA[confidence];
  return (Object.entries(zones) as Array<[ZoneId, number]>).map(([zone, intensity]) => ({
    zone,
    x: ZONE_COORDS[zone].x,
    y: ZONE_COORDS[zone].y,
    intensity,
    sigma,
  }));
}

// ── Adaptive-selection seam ───────────────────────────────────────────────────

/**
 * Which items to administer next for a tier. Fixed (config-driven, active-only,
 * unanswered) order today; IRT-driven adaptive (CAT) selection drops in here later
 * without touching the UI.
 */
export function selectNextItems(answers: Answers, tier: Tier): QuizItem[] {
  return itemsForTier(tier).filter((it) => isScored(it.code) && !(it.code in answers));
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export function computeResult(
  profile: Profile,
  answers: Answers,
  metrics?: PlayerMetrics,
): PracticeDnaResult {
  const scaleScores = computeScaleScores(answers);
  const zoneIntensity = computeZoneIntensity(answers);
  const tendency = computeTendency(answers);
  const tLabel = tendencyLabel(tendency);
  const mastery = computeMastery(answers);
  const masteryStat = computeMasteryStatus(mastery);
  const architect = computeArchitect(answers);
  const confidence = computeConfidence(answers);
  const { pattern, ghostZone } = detectPattern(profile, scaleScores, zoneIntensity, answers);
  const chips = detectChips(scaleScores);
  const alloc = getAlloc(answers);

  const mi = miDiagnostic(profile, scaleScores, metrics);
  const growthZone = computeGrowthZone(mastery, mi);
  const actualAlloc = actualZoneAlloc(answers);
  const recAlloc = recommendedAlloc(mastery, mi);
  const efficiency = computeEfficiency(actualAlloc, recAlloc, scaleScores, mastery);

  const tendencyProvisional = isTendencyProvisional(answers);
  const archetype = computeArchetype({
    tendencyLabel: tLabel,
    tendency,
    pattern,
    chips,
    masteryStatus: masteryStat,
    hcpImprovement: hcpImprovement(profile),
  });

  return {
    quizConfidence: confidence,
    scaleScores,
    architect,

    tendency,
    tendencyLabel: tLabel,
    tendencyProvisional,

    mastery,
    masteryStatus: masteryStat,
    growthZone,

    archetype,
    archetypeProvisional: tendencyProvisional || confidence === 'baseline',

    zoneIntensity,
    heatKernels: computeHeatKernels(zoneIntensity, confidence),
    actualAlloc,
    recommendedAlloc: recAlloc,

    mi,
    efficiency,

    pattern,
    ghostZone,
    chips,
    allocDelta: {
      construction: alloc.construction - ALLOC_BENCHMARK.construction,
      calibration: alloc.calibration - ALLOC_BENCHMARK.calibration,
      transfer: alloc.transfer - ALLOC_BENCHMARK.transfer,
      performance: alloc.performance - ALLOC_BENCHMARK.performance,
    },
    falsePriors: detectFalsePriors(answers),
    attention: checkAttention(answers),

    scoringVersion: SCORING_VERSION,
    configVersion: CONFIG_VERSION,
    resultVersion: RESULT_VERSION,
  };
}
