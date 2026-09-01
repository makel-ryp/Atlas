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
 * Per-zone effectiveness grades — the thing Luke asked for in Slack.
 *
 * "Give them a grade in each zone. How effective is the practice in each zone…
 *  effectiveness basically relates directly to awareness of priors."
 *
 * Each zone has a characteristic false prior. Grade = how far the golfer sits from it.
 *
 * ── Why the items live here and not in practice-dna/items.ts ──────────────────
 * `shared/practice-dna/` is FORGE's canonical bank, dropped in verbatim, with FORGE's
 * regression suite behind it. Adding items there would fork our copy from theirs
 * invisibly. Keeping them in this file makes the divergence auditable in one place and
 * leaves the engine untouched. `zonePriorItems()` returns them in the engine's
 * `QuizItem` shape so the tier runner can render them with no special-casing.
 *
 * ── Provenance of the item text ───────────────────────────────────────────────
 * Every stem and pole label below is VERBATIM from Luke's own "Practice DNA quiz v2.0"
 * Typeform (form `SeCDaSnE`), where the zones were Workshop / Lab / Arena. The only
 * change is the mapping onto the book's four zones, which Luke reviewed on 2026-08-06
 * — he approved it and asked only that Calibration be strengthened. No copy was
 * written by us; the verbatim rule is intact.
 *
 * Owner: instrument = Luke · code = Yannick.
 */

import type { QuizItem, Tier } from './practice-dna/items';
import type { ZoneId } from './practice-dna/scoring';

/**
 * Bipolar 1–5, stored 0–100. LEFT pole = holds the zone's false prior,
 * RIGHT pole = holds the correct prior. So higher = more effective, always.
 */
interface ZonePriorItem {
  code: string;
  zone: ZoneId;
  stem: string;
  left: string;
  right: string;
  /** Measures self-rated diagnostic capability rather than a prior. See below. */
  capability?: true;
}

export const ZONE_PRIOR_ITEMS: readonly ZonePriorItem[] = [
  // ── Construction ────────────────────────────────────────────────────────────
  // False prior: trying to hit good shots instead of focusing on the movement.
  // (Luke dropped the forward-vs-backward-chain prior on 2026-08-06: "we can not
  // worry about the backward build here.")
  {
    code: 'ZP_CON1',
    zone: 'construction',
    stem: 'When I’m working on a swing change, my primary source of truth is…',
    left: 'How the ball flies',
    right: 'What the video shows',
  },
  {
    code: 'ZP_CON2',
    zone: 'construction',
    stem: 'I believe a better swing is built by…',
    left: 'Finding a magic "feel"',
    right: 'Video-based process',
  },
  {
    code: 'ZP_CON3',
    zone: 'construction',
    stem: 'When I hit a poor shot during mechanics work, my instinct is to…',
    left: 'Try to fix contact',
    right: 'Remain indifferent',
  },
  {
    code: 'ZP_CON4',
    zone: 'construction',
    stem: 'My mental model of my golf swing is…',
    left: 'Random tips',
    right: 'Step by step blueprint',
  },

  // ── Calibration ─────────────────────────────────────────────────────────────
  // False prior: fixing ball flight with internal/construction cues instead of the
  // external ones calibration runs on — path, face, contact, low point.
  {
    code: 'ZP_CAL1',
    zone: 'calibration',
    stem: 'My approach to new ideas is to…',
    left: 'Random tips',
    right: 'Systematic testing',
  },
  {
    code: 'ZP_CAL2',
    zone: 'calibration',
    stem: 'When I leave the range, I usually feel…',
    left: 'More confused',
    right: 'More clear',
  },
  // Luke, 2026-08-06: "Calibration looks weak… should look more at being able to
  // identify bias and fix it. How often do you find yourself missing one direction
  // and have trouble fixing it? How often do you notice a similar mishit?"
  //
  // That direction describes a block he had ALREADY written — the v2.0 "Golf Ball Lie
  // Detector Test". ZP_CAL_LD1 is "missing one direction and can't fix it"; ZP_CAL_LD4
  // is "notice a similar mishit". So Calibration is strengthened with his own approved
  // copy rather than new wording from us.
  {
    code: 'ZP_CAL_LD1',
    zone: 'calibration',
    stem: 'I can quickly fix a major directional miss (a slice or a hook).',
    left: 'No',
    right: 'Yes',
    capability: true,
  },
  {
    code: 'ZP_CAL_LD2',
    zone: 'calibration',
    stem: 'I can quickly fix a severe contact error (a chunk or a thin).',
    left: 'No',
    right: 'Yes',
    capability: true,
  },
  {
    code: 'ZP_CAL_LD3',
    zone: 'calibration',
    stem: 'I can quickly fix a catastrophic miss (a shank or a topped shot).',
    left: 'No',
    right: 'Yes',
    capability: true,
  },
  {
    code: 'ZP_CAL_LD4',
    zone: 'calibration',
    stem: 'I can reliably recognize where on the clubface I struck the ball.',
    left: 'No',
    right: 'Yes',
    capability: true,
  },
  {
    code: 'ZP_CAL_LD5',
    zone: 'calibration',
    stem: 'I can consciously control the curve and trajectory of my shots.',
    left: 'No',
    right: 'Yes',
    capability: true,
  },

  // ── Transfer ────────────────────────────────────────────────────────────────
  // False prior: practising easier than you should, chasing performance instead of
  // learning. Easy practice feels good and transfers badly.
  {
    code: 'ZP_TRA1',
    zone: 'transfer',
    stem: 'My primary goal on the range is to…',
    left: 'Groove repeatable swings',
    right: 'Build a skillset',
  },
  {
    code: 'ZP_TRA2',
    zone: 'transfer',
    stem: 'A typical range session for me is…',
    left: 'Repetitive',
    right: 'Deliberate and variable',
  },
  {
    code: 'ZP_TRA3',
    zone: 'transfer',
    stem: 'The difference between my range and course performance is…',
    left: 'Significant',
    right: 'Minimal; it transfers',
  },

  // ── Performance ─────────────────────────────────────────────────────────────
  // False prior: carrying swing thoughts onto the course instead of managing
  // attentional load and playing the task. That's the road to the danger zone.
  {
    code: 'ZP_PER1',
    zone: 'performance',
    stem: 'My focus on the course is on…',
    left: 'Swing mechanics',
    right: 'The target and shape',
  },
  {
    code: 'ZP_PER2',
    zone: 'performance',
    stem: 'When a round starts to go sideways, my instinct is to…',
    left: 'Find mechanical fix',
    right: 'Trust my ability to scramble',
  },
  {
    code: 'ZP_PER3',
    zone: 'performance',
    stem: 'Under pressure, my mind feels…',
    left: 'Cluttered with thoughts',
    right: 'Quiet and trusting',
  },
];

export type ZoneGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * Grade cut-points on the 0–100 prior-awareness scale. Luke chose A–F with "C being
 * average" (2026-08-06), so C straddles the midpoint and the bands widen at the edges.
 *
 * ⚠️  These are CRITERION-referenced, not NORM-referenced: they measure distance from
 * the zone's false prior, not rank against other golfers. That distinction is load
 * bearing — we have no population data, so a C cannot honestly mean "average golfer"
 * (that's the same No Fiction problem that put peer comparison behind a flag). It
 * means middling prior-awareness. Result copy must say which. Re-cut these against
 * real distributions once `pd_*` has them, and bump CONFIG_VERSION when you do.
 */
export const GRADE_BANDS: ReadonlyArray<{ min: number; grade: ZoneGrade }> = [
  { min: 80, grade: 'A' },
  { min: 65, grade: 'B' },
  { min: 45, grade: 'C' },
  { min: 30, grade: 'D' },
  { min: 0, grade: 'F' },
];

export function scoreToGrade(score: number): ZoneGrade {
  const band = GRADE_BANDS.find((b) => score >= b.min);
  return band?.grade ?? 'F';
}

export interface ZoneEffectiveness {
  /** 0–100 prior-awareness. Null when the golfer answered none of the zone's items. */
  score: number | null;
  grade: ZoneGrade | null;
  /** How many of the zone's items were answered — drives a "provisional" badge. */
  answered: number;
  total: number;
}

const ZONES: readonly ZoneId[] = ['construction', 'calibration', 'transfer', 'performance'];

/**
 * Unweighted mean of the zone's answered items. Deliberately not weighted: with no
 * item statistics yet, any weighting would be invented. Revisit at N≈300–500 when the
 * calibration loop in §10.3 has real data.
 */
export function computeZoneEffectiveness(
  answers: Record<string, unknown>,
): Record<ZoneId, ZoneEffectiveness> {
  const out = {} as Record<ZoneId, ZoneEffectiveness>;

  for (const zone of ZONES) {
    const items = ZONE_PRIOR_ITEMS.filter((i) => i.zone === zone);
    const values = items
      .map((i) => answers[i.code])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .map((v) => Math.min(100, Math.max(0, v)));

    const score = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;

    out[zone] = {
      score: score === null ? null : Math.round(score),
      grade: score === null ? null : scoreToGrade(score),
      answered: values.length,
      total: items.length,
    };
  }

  return out;
}

/**
 * The zone items in the engine's `QuizItem` shape, so the tier runner renders them
 * like anything else. They sit in Tier 2 — they're diagnostic depth, not cold-funnel
 * material, and Tier 2 is already where the false priors live.
 */
export function zonePriorItems(tier: Tier = '2'): QuizItem[] {
  return ZONE_PRIOR_ITEMS.map(
    (i): QuizItem => ({
      code: i.code,
      tier,
      type: 'bipolar',
      scale: 'falsePrior',
      text: i.stem,
      poles: { left: i.left, right: i.right },
    }),
  );
}
