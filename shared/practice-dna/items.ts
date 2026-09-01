/**
 * Practice DNA Assessment — item bank.
 *
 * Source of truth: Luke's item spec (2026-06-09). Item text is VERBATIM — do not
 * reword without flagging. Scoring rules live in docs/practice-dna-scoring-spec.md;
 * weights and decision rules live in scoring.ts. Result copy lives in results-content.ts.
 *
 * Items with `pending: true` have no approved text yet (the Tier 3 scale items).
 * The UI must not render pending items; scoring ignores unanswered items by design.
 *
 * Two separate reasons an item may not reach a golfer, and they aren't interchangeable:
 * `pending` means Luke hasn't written the copy; `MINI_IPIP_ITEMS` is complete but held out
 * of `ALL_ITEMS` until a research-consent screen exists. See the gate on that export.
 */

export const QUIZ_VERSION = 'v1';

export type Tier = '1A' | '1B' | '2' | '3';

export type ScaleId =
  | 'engineer'
  | 'artist'
  | 'comfortCreature'
  | 'quickFixJunkie'
  | 'neuroticism'
  | 'extraversion'
  | 'agreeableness'
  | 'conscientiousness'
  | 'calibration'
  | 'transfer'
  | 'mechanics'
  | 'volume'
  | 'falsePrior'
  | 'performanceMastery'
  | 'mindset'
  | 'selfRegulation'
  | 'attention'
  | 'alloc'
  /**
   * Mini-IPIP, one scale per Big Five trait (§10.1). Replaces the old `bfi` id, which had
   * zero items behind it — the BFI-2-XS placeholder was never filled because it's
   * copyrighted. Five ids rather than one so `computeScaleScores` yields the five trait
   * scores the spec asks for; a single scale would average all twenty into one number.
   *
   * The four golf proxies above (`neuroticism`, `extraversion`, `agreeableness`,
   * `conscientiousness`) are NOT these. They are 1–2 single golf-context items each, with
   * no Openness at all, and they steer archetypes. These measure the traits properly.
   */
  | 'ipipO'
  | 'ipipC'
  | 'ipipE'
  | 'ipipA'
  | 'ipipN';

export type ItemType = 'likert' | 'alloc' | 'stepper' | 'sliderCheck' | 'bipolar';

export interface QuizItem {
  code: string;
  tier: Tier;
  type: ItemType;
  scale: ScaleId;
  text: string;
  /** Reverse-scored: high agreement counts AGAINST the scale construct. */
  reverse?: boolean;
  /** Attention checks: exact-target slider with pass tolerance. */
  check?: { target: number; passMin: number; passMax: number };
  /** Bipolar slider pole labels (0 = left pole, 100 = right pole). */
  poles?: { left: string; right: string };
  /** No approved text yet — must not render. */
  pending?: boolean;
}

export interface AllocValue {
  construction: number;
  calibration: number;
  transfer: number;
  performance: number;
}

/**
 * Stored answer scale (the instrument's 0–100, "Strongly disagree ↔ Strongly agree"):
 *   likert: 0–100 via 5 discrete tap targets → 0 / 25 / 50 / 75 / 100
 *   stepper: 0–7 (7 = "7+")
 *   sliderCheck / bipolar: 0–100 continuous
 *   alloc: AllocValue (four 0–100 sliders summing to 100)
 */
export type AnswerValue = number | AllocValue;
export type Answers = Record<string, AnswerValue>;

/**
 * The standard 5-point agreement scale, index 0 = lowest. Every likert item uses it.
 *
 * These were "Not like me / A little / Somewhat / Mostly / Exactly me" — a similarity scale.
 * It reads fine on a self-descriptive stem but not on the belief statements the Tier 2 mindset
 * block is built from: "Your ball-striking ability is something basic about you that you can't
 * change much" answered "Exactly me" is barely English. Teddy settled it on 2026-08-10: one
 * standard agreement scale across the whole instrument, after a scoped-to-six-items version was
 * tried and rejected as inconsistent.
 *
 * "NEITHER AGREE NOR DISAGREE", NOT "NOT SURE". They look interchangeable and are not. "Not sure"
 * reports uncertainty about the question — I don't know — while the neutral anchor reports a
 * position on it: I hold neither side. On a belief item the second is the midpoint you want,
 * because a golfer with genuinely no lean is data, not a gap. It is also the conventional
 * wording, which matters for comparing against anything published.
 *
 * ⚠️  THE MIDPOINT CHANGED MEANING, so this is a measurement change and not a copy tweak.
 *     "Somewhat" was a middling degree of similarity; the neutral anchor is the absence of a
 *     lean. A 50 recorded before cfg-2026.08-3 is not the same datum as a 50 after it, and the
 *     two should not be pooled on any scale.
 *
 * ⚠️  LUKE OWNS INSTRUMENT COPY and CLAUDE.md says item text is verbatim and not ours to edit;
 *     response anchors are instrument copy by any reading. Teddy directed this. The midpoint is
 *     the part worth Luke's attention rather than the poles.
 */
export const LIKERT_LABELS = [
  'Strongly disagree',
  'Disagree',
  'Neither agree nor disagree',
  'Agree',
  'Strongly agree',
] as const;

// ── Player Profile (one form, all 7 fields at once) ──────────────────────────

export interface ProfileField {
  code: string;
  label: string;
  kind: 'number' | 'select';
  min?: number;
  max?: number;
  options?: readonly string[];
}

export const PROFILE_FIELDS: readonly ProfileField[] = [
  { code: 'PRO_AGE', label: 'Your age', kind: 'number', min: 18, max: 85 },
  { code: 'PRO_HAND', label: 'Handedness', kind: 'select', options: ['Right', 'Left'] },
  {
    code: 'PRO_SPEED',
    label: 'Approx. driver club head speed (mph)',
    kind: 'number',
    min: 60,
    max: 135,
  },
  {
    code: 'PRO_HCP_NOW',
    label: 'Current handicap index',
    kind: 'select',
    options: [
      ...Array.from({ length: 55 }, (_, i) => String(i)),
      "I don't have one",
    ],
  },
  {
    code: 'PRO_HCP_3YR',
    label: 'Handicap three years ago',
    kind: 'select',
    options: [
      ...Array.from({ length: 55 }, (_, i) => String(i)),
      'Higher than 54',
      'About the same',
      "Wasn't playing",
    ],
  },
  {
    code: 'PRO_SHAPE',
    label: 'Typical shot shape on good shots',
    kind: 'select',
    options: ['Draw', 'Fade', 'Straight', 'Varies'],
  },
  {
    code: 'PRO_SHAPE_PREF',
    label: 'Which way would you like your shot shape to move?',
    kind: 'select',
    options: ['More draw', 'Less curve', 'More fade'],
  },
] as const;

export interface Profile {
  PRO_AGE: number;
  PRO_HAND: string;
  PRO_SPEED: string;
  PRO_HCP_NOW: string;
  PRO_HCP_3YR: string;
  PRO_SHAPE: string;
  PRO_SHAPE_PREF: string;
}

// ── Item bank ─────────────────────────────────────────────────────────────────

export const ITEMS: readonly QuizItem[] = [
  // ── Tier 1A — cold funnel (result renders after #13) ──
  {
    code: 'ALLOC',
    tier: '1A',
    type: 'alloc',
    scale: 'alloc',
    text: 'Of the time you spend on your golf game, how does it split between…',
  },
  {
    code: 'EA01',
    tier: '1A',
    type: 'likert',
    scale: 'engineer',
    text: "A session feels good if my mechanics improved — even if I'm not hitting good shots yet.",
  },
  {
    code: 'EA05',
    tier: '1A',
    type: 'likert',
    scale: 'artist',
    text: "Practice is boring. Let's play.",
  },
  {
    code: 'CC01',
    tier: '1A',
    type: 'likert',
    scale: 'comfortCreature',
    text: 'I hit it noticeably better on the range than on the course.',
  },
  {
    code: 'CC_NEW01',
    tier: '1A',
    type: 'likert',
    scale: 'comfortCreature',
    text: 'I really enjoy hitting well-struck shots to the same target, grooving a feel.',
  },
  {
    code: 'QFJ01',
    tier: '1A',
    type: 'likert',
    scale: 'quickFixJunkie',
    text: 'I rarely stick with one swing change long enough to know if it worked.',
  },
  {
    code: 'QFJ02',
    tier: '1A',
    type: 'likert',
    scale: 'quickFixJunkie',
    text: "It's not uncommon for me to switch swing thoughts multiple times during a round.",
  },
  {
    code: 'N01',
    tier: '1A',
    type: 'likert',
    scale: 'neuroticism',
    text: 'A stretch of bad shots on the course makes me want to find something to fix in my swing.',
  },
  {
    code: 'TRA_NEW01',
    tier: '1A',
    type: 'likert',
    scale: 'transfer',
    text: "When I practice, there's usually something on the line — a game, a challenge, a target that counts.",
  },
  {
    code: 'MECH01',
    tier: '1A',
    type: 'likert',
    scale: 'mechanics',
    text: "I'm pretty good at making my swing look the way I want it to look.",
  },
  {
    code: 'MECH02',
    tier: '1A',
    type: 'likert',
    scale: 'mechanics',
    text: "I've been successful in changing my swing over time.",
  },
  {
    code: 'MECH03',
    tier: '1A',
    type: 'likert',
    scale: 'mechanics',
    text: "Right now, I'm striking the ball about as well as I ever have.",
  },
  {
    code: 'FREQ01',
    tier: '1A',
    type: 'stepper',
    scale: 'volume',
    text: 'On average, how many times per week do you practice or play?',
  },

  // ── Tier 1B — "Sharpen your map" (post-result, pre-email) ──
  {
    code: 'EA02',
    tier: '1B',
    type: 'likert',
    scale: 'engineer',
    text: 'I want to know exactly what my body did — not just where the ball went.',
  },
  {
    code: 'EA04',
    tier: '1B',
    type: 'likert',
    scale: 'engineer',
    text: "I'd rather groove one repeatable swing than improvise shots.",
  },
  {
    code: 'EA06',
    tier: '1B',
    type: 'likert',
    scale: 'artist',
    text: "When I'm stuck, I'd rather just go play than work on it.",
  },
  {
    code: 'EA08',
    tier: '1B',
    type: 'likert',
    scale: 'artist',
    text: "My best golf happens when I'm not thinking about my swing.",
  },
  {
    code: 'ENG_NEW01',
    tier: '1B',
    type: 'likert',
    scale: 'engineer',
    text: 'Figuring out my swing is genuinely interesting — almost like solving a puzzle.',
  },
  {
    code: 'ENG_NEW02',
    tier: '2',
    type: 'likert',
    scale: 'engineer',
    text: "After a bad round, I'm more likely to head to the range than brush it off.",
  },
  {
    code: 'ART_NEW01',
    tier: '1B',
    type: 'likert',
    scale: 'artist',
    text: 'I enjoy trying to shape shots, hit unusual trajectories, invent ways out of trouble.',
  },
  {
    code: 'ART_NEW02',
    tier: '2',
    type: 'likert',
    scale: 'artist',
    text: 'My best practice happens on the course, not the range.',
  },
  {
    code: 'CC02',
    tier: '1B',
    type: 'likert',
    scale: 'comfortCreature',
    text: 'Before I add anything new, I want my current swing consistent and repeatable.',
  },
  {
    code: 'CC_NEW02',
    tier: '2',
    type: 'likert',
    scale: 'comfortCreature',
    text: 'I practice with clubs I hit well rather than my weakest ones.',
  },
  {
    code: 'CC_NEW03',
    tier: '2',
    type: 'likert',
    scale: 'comfortCreature',
    text: 'I rarely practice in uncomfortable conditions — wind, bad lies, pressure.',
  },
  {
    code: 'ATTN01',
    tier: '2',
    type: 'sliderCheck',
    scale: 'attention',
    text: 'Please move the slider to exactly 25.',
    check: { target: 25, passMin: 18, passMax: 32 },
  },
  {
    code: 'QFJ03',
    tier: '1B',
    type: 'likert',
    scale: 'quickFixJunkie',
    text: "There's usually a new tip, drill, or feel I'm itching to try.",
  },
  {
    code: 'QFJ_NEW01',
    tier: '2',
    type: 'likert',
    scale: 'quickFixJunkie',
    text: 'After a bad round, I spend time looking for what went wrong in my swing.',
  },
  {
    code: 'QFJ_NEW02',
    tier: '2',
    type: 'likert',
    scale: 'quickFixJunkie',
    text: 'The right swing thought could unlock a big improvement fairly quickly.',
  },
  {
    code: 'N02',
    tier: '2',
    type: 'likert',
    scale: 'neuroticism',
    text: "I find it hard to enjoy a round when my swing doesn't feel right.",
  },
  {
    code: 'E01',
    tier: '2',
    type: 'likert',
    scale: 'extraversion',
    text: "I play my best golf in competition or when something's on the line.",
  },
  {
    code: 'A01',
    tier: '2',
    type: 'likert',
    scale: 'agreeableness',
    text: "When a coach contradicts what I believe, I'm genuinely open to being wrong.",
  },
  {
    code: 'C01',
    tier: '2',
    type: 'likert',
    scale: 'conscientiousness',
    text: "I go to the range with a specific plan for what I'll work on.",
  },
  {
    code: 'CAL01',
    tier: '1B',
    type: 'likert',
    scale: 'calibration',
    text: 'I regularly practice intentional shot shapes — draws, fades, highs, lows.',
  },
  {
    code: 'CAL_NEW01',
    tier: '1B',
    type: 'likert',
    scale: 'calibration',
    text: 'I know my carry distances for every club within a few yards.',
  },
  {
    code: 'MAS_CAL_LIGHT',
    tier: '1B',
    type: 'likert',
    scale: 'calibration',
    text: 'When my ball-striking goes off, I can usually diagnose and fix it within a session.',
  },
  {
    code: 'TRA_NEW02',
    tier: '2',
    type: 'likert',
    scale: 'transfer',
    text: 'I regularly play games against myself on the range — points, targets, penalties.',
  },
  {
    code: 'TRA_MAS1',
    tier: '1B',
    type: 'likert',
    scale: 'transfer',
    text: "What I build in practice usually holds up when I'm playing for real.",
  },
  {
    code: 'PER_MAS_NEW1',
    tier: '1B',
    type: 'likert',
    scale: 'performanceMastery',
    text: 'On the course, I get the most out of whatever swing I brought that day — I score better than my ball-striking alone would predict.',
  },

  // ── Tier 2 — email-gated (Mastery / false-prior layer) ──
  {
    code: 'FP_CON',
    tier: '2',
    type: 'likert',
    scale: 'falsePrior',
    reverse: true,
    text: "I'm really good at hitting poor shots and not caring about the result when I work on my swing.",
  },
  {
    code: 'FP_TRA',
    tier: '2',
    type: 'bipolar',
    scale: 'falsePrior',
    text: 'When you practice with a ball, which end of this spectrum sounds more like you?',
    poles: {
      left: 'groove one consistent shot',
      right: 'make it difficult, switch targets, gamify',
    },
  },
  {
    code: 'FP_PER',
    tier: '2',
    type: 'likert',
    scale: 'falsePrior',
    text: "If I hit a few poor shots, I'll try new swing thoughts to fix it rather than stick with what I have.",
  },
  {
    code: 'ATTN02',
    tier: '2',
    type: 'sliderCheck',
    scale: 'attention',
    text: 'Please set this to 75.',
    check: { target: 75, passMin: 68, passMax: 82 },
  },
  {
    code: 'CC_NEW04',
    tier: '2',
    type: 'likert',
    scale: 'comfortCreature',
    text: "If I start hitting it poorly, I'll switch to something I do well to finish on a good note.",
  },
  {
    code: 'E02',
    tier: '2',
    type: 'likert',
    scale: 'extraversion',
    text: "I'd rather play a casual round with friends than practice alone the same time.",
  },
  {
    code: 'A02',
    tier: '2',
    type: 'likert',
    scale: 'agreeableness',
    text: 'I stick with the practice plan I set, even when I feel like doing something different.',
  },
  {
    code: 'FP_CAL',
    tier: '2',
    type: 'likert',
    scale: 'falsePrior',
    text: "When I practice with a ball, I'm mostly trying to hit good shots — not studying what my ball flight is telling me.",
  },
  {
    code: 'PER_MAS01',
    tier: '2',
    type: 'likert',
    scale: 'performanceMastery',
    text: "On the course, I commit to the target and trust my swing — even when I'm not striking it well.",
  },

  // ── Mindset + self-regulation (Raymond Prior feedback, 2026-06-17) ──
  // Added per Raymond's review of the Practice DNA instrument:
  //   • "Mindset measures need 10–12 Likert items to meet reliability/validity for peer
  //      review … include beliefs about effort and struggle (fixed: struggle means you
  //      don't have it · growth: struggle is the key ingredient)."  → MIND01–MIND06.
  //   • "Confidence is not that you can, it's that I'm willing to try and find out."
  //      → SREG01 is phrased as willingness-to-try, not certainty-of-outcome.
  // SCOPE: expanded 2026-06-18 to a 12-item mindset measure (MIND01–12) to meet the
  // 10–12-item bar Raymond flagged for peer-review reliability/validity, mixing ability
  // beliefs and effort/struggle/setback facets. Plus SREG01 (self-regulation). All are in
  // CANDIDATE_ITEMS (config.ts) so they are CAPTURED but excluded from the validated v1
  // score until they accrue calibration data and the scale's reliability is confirmed.
  // mindset scale: higher = growth; fixed-mindset items are reverse-scored.
  {
    code: 'MIND01',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    reverse: true,
    text: "Your ball-striking ability is something basic about you that you can't change much.",
  },
  {
    code: 'MIND02',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    text: 'No matter where you start, you can substantially change how good a ball-striker you become.',
  },
  {
    code: 'MIND03',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    text: 'How good a golfer you end up is mostly down to the work you put in.',
  },
  {
    code: 'MIND04',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    reverse: true,
    text: "Being a naturally gifted ball-striker is something you either have or you don't.",
  },
  {
    code: 'MIND05',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    text: 'When a swing change gets hard and I start to struggle, I take it as a sign I’m on the verge of improving.',
  },
  {
    code: 'MIND06',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    reverse: true,
    text: 'When I keep struggling with a swing change, it makes me think I might not have what it takes.',
  },
  {
    code: 'MIND07',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    text: 'The harder I have to work at a part of my game, the more it tends to pay off in the end.',
  },
  {
    code: 'MIND08',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    reverse: true,
    text: "If I have to try really hard at a part of my game, it usually means I'm just not cut out for it.",
  },
  {
    code: 'MIND09',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    text: 'A bad stretch is information I can learn from, not a verdict on how good I am.',
  },
  {
    code: 'MIND10',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    reverse: true,
    text: "Once you've played for a while, your ceiling as a ball-striker is basically set.",
  },
  {
    code: 'MIND11',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    text: "I'd rather take on a part of my game that's hard for me than stick to what already comes easily.",
  },
  {
    code: 'MIND12',
    tier: '2',
    type: 'likert',
    scale: 'mindset',
    reverse: true,
    text: 'Some people are just natural ball-strikers, and no amount of practice closes that gap.',
  },
  {
    code: 'SREG01',
    tier: '2',
    type: 'likert',
    scale: 'selfRegulation',
    text: 'When a practice goal gets hard or boring, I’m willing to keep at it to find out what I’m capable of.',
  },

  // ── Tier 3 — research / Forge opt-in only ──
  // Scale items: codes reserved by Luke's spec; text not yet provided. pending=true ⇒ never rendered.
  { code: 'EA03', tier: '3', type: 'likert', scale: 'engineer', text: '', pending: true },
  { code: 'EA07', tier: '3', type: 'likert', scale: 'artist', text: '', pending: true },
  { code: 'CC03', tier: '3', type: 'likert', scale: 'comfortCreature', text: '', pending: true },
  { code: 'ENG_NEW03', tier: '3', type: 'likert', scale: 'engineer', text: '', pending: true },
  { code: 'ART_NEW03', tier: '3', type: 'likert', scale: 'artist', text: '', pending: true },
  { code: 'QFJ_NEW03', tier: '3', type: 'likert', scale: 'quickFixJunkie', text: '', pending: true },
  { code: 'CAL_NEW02', tier: '3', type: 'likert', scale: 'calibration', text: '', pending: true },
  { code: 'MAS_CAL', tier: '3', type: 'likert', scale: 'calibration', text: '', pending: true },
  { code: 'CAL_CONF', tier: '3', type: 'likert', scale: 'calibration', text: '', pending: true },
  { code: 'MAS_CON', tier: '3', type: 'likert', scale: 'performanceMastery', text: '', pending: true },
  { code: 'MAS_PER', tier: '3', type: 'likert', scale: 'performanceMastery', text: '', pending: true },
  { code: 'MAS_CONTACT', tier: '3', type: 'likert', scale: 'performanceMastery', text: '', pending: true },
  { code: 'TRA_DISP', tier: '3', type: 'likert', scale: 'transfer', text: '', pending: true },
  { code: 'TRA_TRAP', tier: '3', type: 'likert', scale: 'transfer', text: '', pending: true },
] as const;

/**
 * Mini-IPIP — 20 items, verbatim, replacing the empty BFI-2-XS placeholder.
 *
 * Per PRACTICE-DNA-TEAM-HANDOFF.md §10.1 (decided 2026-07-31). Donnellan, Oswald, Baird &
 * Lucas (2006). All five traits, validated short form, and **public domain** via the
 * International Personality Item Pool — so there is no licensing exposure from commercial
 * use, unlike the BFI-2 family, which needs permission outside non-commercial research.
 * That licence is the reason for the swap: the instrument is meant to be published from.
 *
 * Attribution, required on the consent screen: items from the International Personality
 * Item Pool (ipip.ori.org), public domain; Mini-IPIP scale per Donnellan et al. (2006).
 *
 * ⚠️  NOT LIVE. See MINI_IPIP_ITEMS below for why, and what activating it requires.
 */
const MINI_IPIP_RAW: ReadonlyArray<{
  code: string;
  trait: 'O' | 'C' | 'E' | 'A' | 'N';
  text: string;
  reverse?: boolean;
}> = [
  { code: 'IPIP01', trait: 'E', text: 'Am the life of the party.' },
  { code: 'IPIP02', trait: 'E', text: "Don't talk a lot.", reverse: true },
  { code: 'IPIP03', trait: 'E', text: 'Talk to a lot of different people at parties.' },
  { code: 'IPIP04', trait: 'E', text: 'Keep in the background.', reverse: true },
  { code: 'IPIP05', trait: 'A', text: "Sympathize with others' feelings." },
  { code: 'IPIP06', trait: 'A', text: "Am not interested in other people's problems.", reverse: true },
  { code: 'IPIP07', trait: 'A', text: "Feel others' emotions." },
  { code: 'IPIP08', trait: 'A', text: 'Am not really interested in others.', reverse: true },
  { code: 'IPIP09', trait: 'C', text: 'Get chores done right away.' },
  { code: 'IPIP10', trait: 'C', text: 'Often forget to put things back in their proper place.', reverse: true },
  { code: 'IPIP11', trait: 'C', text: 'Like order.' },
  { code: 'IPIP12', trait: 'C', text: 'Make a mess of things.', reverse: true },
  { code: 'IPIP13', trait: 'N', text: 'Have frequent mood swings.' },
  { code: 'IPIP14', trait: 'N', text: 'Am relaxed most of the time.', reverse: true },
  { code: 'IPIP15', trait: 'N', text: 'Get upset easily.' },
  { code: 'IPIP16', trait: 'N', text: 'Seldom feel blue.', reverse: true },
  { code: 'IPIP17', trait: 'O', text: 'Have a vivid imagination.' },
  { code: 'IPIP18', trait: 'O', text: 'Am not interested in abstract ideas.', reverse: true },
  { code: 'IPIP19', trait: 'O', text: 'Have difficulty understanding abstract ideas.', reverse: true },
  { code: 'IPIP20', trait: 'O', text: 'Do not have a good imagination.', reverse: true },
];

/** Trait → scale id. One scale PER TRAIT, not a single `ipip` scale — see below. */
const IPIP_TRAIT_SCALE = {
  O: 'ipipO',
  C: 'ipipC',
  E: 'ipipE',
  A: 'ipipA',
  N: 'ipipN',
} as const satisfies Record<'O' | 'C' | 'E' | 'A' | 'N', ScaleId>;

/**
 * The 20 items in the engine's shape.
 *
 * ⚠️  DELIBERATELY ABSENT FROM `ALL_ITEMS` — these do not render, and must not until a
 *     research-consent screen exists.
 *
 *     `Shell.tsx` hides the "Research grade" CTA using `tierHasQuestions('3')`, which is
 *     false today only because every Tier 3 item is `pending`. Adding 20 renderable items
 *     flips that to true and reopens the path — straight into a personality questionnaire
 *     with no consent step. §10.1 requires "explicit opt-in + consent" and an attribution
 *     line, and collecting Big Five data for a research dataset without it is not a
 *     detail we get to defer. Gating here is what keeps that impossible by construction
 *     rather than by everyone remembering.
 *
 *     TO ACTIVATE, all four:
 *       1. Build the consent screen (opt-in + the attribution line above).
 *       2. Add `...MINI_IPIP_ITEMS` to `ALL_ITEMS`.
 *       3. Bump CONFIG_VERSION — at that point the answerable item set really does change.
 *       4. Give this block its own anchors: §10.1 specifies a 5-tap
 *          "Very inaccurate … Very accurate" control, NOT the global
 *          "Not like me … Exactly me". These are trait statements, not golf self-reports.
 *
 * Scales are per-trait (`ipipO/C/E/A/N`) rather than one `ipip` scale. §10.1 says "rename
 * `bfi` → `ipip`" but its schema line calls for five trait scores 0–100, and one scale
 * would average all twenty items into a single meaningless number. Five scale ids get the
 * five scores out of `computeScaleScores` as it already stands, with no parallel scorer.
 */
export const MINI_IPIP_ITEMS: readonly QuizItem[] = MINI_IPIP_RAW.map((raw) => ({
  code: raw.code,
  tier: '3' as Tier,
  type: 'likert' as ItemType,
  scale: IPIP_TRAIT_SCALE[raw.trait] as ScaleId,
  text: raw.text,
  ...(raw.reverse ? { reverse: true } : {}),
}));

// ── Lookups ───────────────────────────────────────────────────────────────────

/**
 * `MINI_IPIP_ITEMS` is NOT included — see the gate above. Adding it here is step 2 of
 * activation and is the single line that makes the block live.
 */
const ALL_ITEMS: readonly QuizItem[] = [...ITEMS];

export const ITEM_BY_CODE: ReadonlyMap<string, QuizItem> = new Map(
  ALL_ITEMS.map((item) => [item.code, item]),
);

export function itemsForTier(tier: Tier, opts?: { includePending?: boolean }): QuizItem[] {
  return ALL_ITEMS.filter(
    (item) => item.tier === tier && (opts?.includePending || !item.pending),
  );
}

export function renderableTier3ScaleItems(): QuizItem[] {
  return itemsForTier('3');
}
