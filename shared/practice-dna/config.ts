/**
 * FORK NOTICE — copied from /Users/makelmackbee/Desktop/ATR/websites/tgt/shared/practice-dna/ on
 * 2026-08-31, pinned at CONFIG_VERSION cfg-2026.08-3 / SCORE_VERSION score-2026.08-1. The live
 * quiz at tgt is the authoritative instrument — this is a fork for Atlas's account-creation
 * intake. Do not edit tgt from here; do not port changes back without re-checking against the
 * live 118-run history this file was pinned against.
 */

/**
 * Practice DNA — versioned configuration registry.
 *
 * Single source of truth for the tunable scoring inputs: item membership, scale
 * weights, decision thresholds, zone ROI/trainability, the Mechanics-Index diagnostic
 * band, and the zone↔tool routing for the RYP ecosystem. Lives in-repo (not the DB) so
 * the funnel scores deterministically and works offline — but every stored response
 * stamps the CONFIG_VERSION it was scored under, so the self-optimizing analytics loop
 * can retire/reweight/promote items in a NEW version and recompute history without a
 * code rewrite (see analytics/item-stats.ts + recompute.ts).
 *
 * NOTE: the `import type` below is erased at runtime, so there is no import cycle even
 * though scoring.ts imports the values from this file.
 */

import type { Confidence, ZoneId } from './scoring';

// ── Versions — bump whenever a change here can move a score ────────────────────
// cfg-2026.08-1: added COURSE_SWING_CREDIT + MESSY_THRESHOLDS for the §4 volume model
//                (instrument change per BUILD-PACKAGE/02).
// cfg-2026.08-2: retired ATTN01/ATTN02 into RETIRED_ITEMS per team-handoff §6.
// cfg-2026.08-3: LIKERT_LABELS moved from a similarity scale ("Not like me"…"Exactly me") to the
//                standard 5-point agreement scale ("Strongly disagree" / "Disagree" / "Neither
//                agree nor disagree" / "Agree" / "Strongly agree"), across every likert item.
//                Belief statements — the Tier 2 mindset block — don't parse on similarity:
//                "Exactly me" is not an answer to a claim about how golf works. The numeric scale
//                is untouched at 0/25/50/75/100, so nothing re-scores differently, but the
//                MIDPOINT changed meaning: "Somewhat" was a middling degree of similarity, the
//                neutral anchor is the absence of a lean. A 50 before this stamp is not the same
//                datum as a 50 after it — don't pool answers across the boundary.
export const CONFIG_VERSION = 'cfg-2026.08-3';
// score-2026.08-1: the archetype cascade's terminal fallback no longer awards The Architect
// without evidence. Its copy asserts a falling handicap and no starved zone; a blended golfer
// with neither (or with no handicap at all) was getting both claims made about them. Stored runs
// re-score to a different archetype on that path, which is why this is a version bump.
export const SCORING_VERSION = 'score-2026.08-1';
export const RESULT_VERSION = 'result-2026.06-1';

// ── §4b — the on-course credit rule ───────────────────────────────────────────
/**
 * Share of on-course time credited as full-swing / ball-striking work, all of it
 * landing in the Performance zone.
 *
 * ⚠️  A STATED MODELLING ASSUMPTION, NOT A RESEARCH FINDING. The No Fiction rule
 * requires the result screen to say so out loud ("we credit 25% of your course
 * time as ball-striking work"). Awaiting Luke's sign-off on the value — changing
 * it bumps CONFIG_VERSION.
 */
export const COURSE_SWING_CREDIT = 0.25;

// ── §4e — Messy Middle callout thresholds (% of effective total) ──────────────
/** ≥ headline ⇒ full callout card. ≥ note ⇒ one-line note in the time-bars panel. */
export const MESSY_THRESHOLDS = { headline: 40, note: 15 } as const;

// ── Ecosystem metric registry (the metrics-stream vocabulary) ─────────────────
// Adding a tool = adding a `source` value here — zero schema change downstream.
// Runtime arrays (not just types) so the ingestion webhook can validate inbound
// `source`/`metric_type` with a zod enum — and so they stay the single source of truth
// the DB CHECK constraint and the metrics route are both derived from.
export const METRIC_SOURCES = [
  'parallax',
  'ryp_strategy',
  'debrief',
  'teaching_pro',
  'manual',
  'self_report',
] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export const METRIC_TYPES = [
  'mechanics_index',
  'club_head_speed',
  'handicap',
  'on_course_score',
  'mental_game_index',
  'routine_adherence',
  'pressure_performance',
  'decision_quality',
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

// ── Item lifecycle (the self-optimizing bank) ─────────────────────────────────
/** Items removed from scoring by the analytics loop (kept in the bank for history). */
export const RETIRED_ITEMS: readonly string[] = [
  // Overt attention checks, retired 2026-08-05 per team-handoff §6: jarring for a
  // motivated audience. NOT deleted — historical FORGE data references them, and
  // `checkAttention` still reads them so old runs stay interpretable. Retiring them
  // is what removes them from the rendered flow, since `selectNextItems` filters on
  // `isScored`. Replaced by server-side consistency flags → `qualityFlag`.
  'ATTN01',
  'ATTN02',
];
/** Items trialed unscored to gather calibration data before promotion. */
export const CANDIDATE_ITEMS: readonly string[] = [
  // Mindset + self-regulation (Raymond Prior feedback, 2026-06-17). Rendered & captured
  // in Tier 2 but kept OUT of the validated v1 score until they accrue calibration data
  // and (for mindset) the 12-item scale's reliability is confirmed on real data. Promote
  // by removing from this list (bump CONFIG_VERSION when you do — it will move scores).
  'MIND01', 'MIND02', 'MIND03', 'MIND04', 'MIND05', 'MIND06',
  'MIND07', 'MIND08', 'MIND09', 'MIND10', 'MIND11', 'MIND12',
  'SREG01',
];

export function itemStatus(code: string): 'active' | 'retired' | 'candidate' {
  if (RETIRED_ITEMS.includes(code)) return 'retired';
  if (CANDIDATE_ITEMS.includes(code)) return 'candidate';
  return 'active';
}
/** Only `active` items contribute to scores; candidates are captured but excluded. */
export const isScored = (code: string): boolean => itemStatus(code) === 'active';

// ── Axis 1: Tendency (Engineer ↔ Artist) poles ────────────────────────────────
export const ENGINEER_ITEMS = [
  'EA01', 'EA02', 'EA04', 'ENG_NEW01', 'ENG_NEW02', 'EA03', 'ENG_NEW03',
] as const;
export const ARTIST_ITEMS = [
  'EA05', 'EA06', 'EA08', 'ART_NEW01', 'ART_NEW02', 'EA07', 'ART_NEW03',
] as const;
/** Tendency label bands on the 0–100 Engineer(0)↔Artist(100) axis. */
export const TENDENCY_BANDS = { engineerMax: 38, artistMin: 62 } as const;

// ── Axis 2: Mastery (the Skill Band) — self-rated items per zone ───────────────
// TRA_MAS1 / PER_MAS_NEW1 (Tier 1B) make Transfer & Performance non-null by the sharpen.
export const MASTERY_ITEMS: Record<ZoneId, readonly string[]> = {
  construction: ['MECH01', 'MECH02', 'MECH03'],
  calibration: ['CAL01', 'CAL_NEW01', 'MAS_CAL_LIGHT', 'CAL_NEW02', 'MAS_CAL', 'CAL_CONF'],
  transfer: ['TRA_MAS1', 'TRA_NEW01', 'TRA_NEW02', 'TRA_DISP', 'TRA_TRAP'],
  performance: ['PER_MAS_NEW1', 'PER_MAS01', 'MAS_CON', 'MAS_PER', 'MAS_CONTACT'],
};
/** Mastery status thresholds (0–100 self-rated capability). */
export const MASTERY_BANDS = { strongMin: 67, buildingMin: 34 } as const;

/** Build the earlier-on-the-diagonal zone first when scores tie. */
export const ZONE_BUILD_ORDER: readonly ZoneId[] = [
  'construction', 'calibration', 'transfer', 'performance',
];

// ── ROI / trainability — calibration is the lowest-hanging fruit ──────────────
// Prescription priority = (mastery gap) × (trainability). Higher = more strokes per
// practice hour. Calibration is most mechanical / fastest feedback, so it is fixed
// first when weak; performance (mental game) is real but the slowest to move.
export const ZONE_TRAINABILITY: Record<ZoneId, number> = {
  construction: 0.85, // gated separately by the MI-vs-handicap diagnostic
  calibration: 1.0,
  transfer: 0.7,
  performance: 0.5,
};

// ── Mechanics Index ↔ handicap diagnostic ─────────────────────────────────────
/** |handicap − MI| within this ⇒ "balanced" (book direction: lower MI is better). */
export const MI_BALANCED_BAND = 2;
/** Estimated MI (pre-real-measurement) renders as estimate ± this, never a point. */
export const MI_ESTIMATE_HALF_WIDTH = 3;

// ── Zone → tool routing (the RYP ecosystem map) ───────────────────────────────
// Each zone has an objective measurement source AND a training tool. New tools
// (Parallax/Strategy/Debrief) light up here without touching the engine.
export interface ZoneTooling {
  measuredBy: MetricType[];
  trainedIn: string;
}
export const ZONE_TOOLS: Record<ZoneId, ZoneTooling> = {
  construction: { measuredBy: ['mechanics_index'], trainedIn: 'Forge' },
  calibration: { measuredBy: ['mechanics_index'], trainedIn: 'Forge' },
  transfer: { measuredBy: ['on_course_score'], trainedIn: 'Forge' },
  performance: { measuredBy: ['mental_game_index', 'on_course_score'], trainedIn: 'Debrief' },
};

// ── Allocation benchmark (Ch.16 mid-arc guidance midpoints, one per zone) ─────
export const ALLOC_BENCHMARK = {
  construction: 30,
  calibration: 20,
  transfer: 20,
  performance: 30,
} as const;

// ── Pattern (failure mode) decision thresholds ────────────────────────────────
export const THRESHOLDS = {
  illusionistMechanics: 70,
  illusionistComfort: 60,
  prisonerAllocShare: 60, // percentage points of one ALLOC bucket
  prisonerAffinity: 65,
  ghostZoneIntensity: 0.1, // 0–1 zone intensity
  chipScale: 65,
  scrappyGamerComfortCeiling: 40,
} as const;

/** Heat-map kernel sigma by confidence — lower sigma = sharper fingerprint. */
export const KERNEL_SIGMA: Record<Confidence, number> = {
  baseline: 24,
  sharpened: 17,
  full: 14,
};

/** The book's Map (cover): x = Shot Difficulty / external load (0–100), y = Swing Thoughts / internal load (0–100). */
export const ZONE_COORDS: Record<ZoneId, { x: number; y: number }> = {
  construction: { x: 12, y: 88 },
  calibration: { x: 40, y: 64 },
  transfer: { x: 68, y: 34 },
  performance: { x: 92, y: 10 },
};

// ── Practice Efficiency Score weights (0–100: how much practice moves handicap) ─
export const EFFICIENCY_WEIGHTS = {
  allocationFit: 0.5, // time spent in dim/growth zones vs comfort/already-mastered
  practiceQuality: 0.3, // failure-mode penalties (quick-fix, drift, comfort)
  transferGap: 0.2, // self-rated (or MI-measured) transfer deficit
} as const;
