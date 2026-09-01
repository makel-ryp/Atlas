/**
 * Practice DNA — result copy. EDITABLE CONFIG: Luke redlines this file.
 *
 * Model: ONE tendency axis (Engineer ↔ Artist) + FOUR zone-mastery scores (the Skill Band).
 * Voice: first-person practitioner-confident, no AI cadence, No Fiction policy.
 * Trademark style: FORGE (no periods) · S.C.O.R.E. (with periods) · Practice DNA.
 */

import type {
  Archetype,
  ChipId,
  MasteryStatus,
  MiVerdict,
  PatternId,
  PersonaId,
  TendencyLabel,
  ZoneId,
} from './scoring';

export interface ProductCta {
  label: string;
  href: string;
  blurb: string;
}

export const ZONE_LABELS: Record<ZoneId, string> = {
  construction: 'Construction Zone',
  calibration: 'Calibration Zone',
  transfer: 'Transfer Zone',
  performance: 'Performance Zone',
};

const FLIGHT_SCHOOL: ProductCta = {
  label: 'Explore Flight School',
  href: 'https://rypgolf.com/Flight-School',
  blurb:
    'A ninety-day online cohort and coaching program — every zone of the Map, ten minutes a day, a measurable swing change or your money back.',
};
const PRACTICE_PROJECT: ProductCta = {
  label: 'Join the Practice Project',
  href: 'https://rypgolf.com/Build',
  blurb: 'Free FORGE drill tracking, Transfer Index, and session logging — the software that runs the methodology.',
};
const FOUNDATIONS: ProductCta = {
  label: 'See the Foundations Course',
  href: 'https://rypgolf.com/Foundations',
  blurb: 'The video-guided, station-by-station build of the Construction Zone — coached feedback alongside the book.',
};

// ── Axis 1: Tendency (Engineer ↔ Artist) ──────────────────────────────────────

export interface TendencyContent {
  name: string; // headline
  pole: string; // one-word: Engineer / Artist / Both
  tagline: string;
  profile: string[];
  /** Short label for the share card. */
  shareName: string;
}

export const TENDENCIES: Record<TendencyLabel, TendencyContent> = {
  engineer: {
    name: 'The Engineer',
    pole: 'Engineer',
    tagline: 'You build. You want to know what your body did, not just where the ball went.',
    profile: [
      "Your answers place you toward the Engineer pole. You'd rather groove a repeatable swing than improvise, and a session feels good when the mechanics improved even if the ball hasn't caught up yet.",
      "Faldo won six majors from this end of the spectrum. The strength is real and the trap is real: the garage can start to feel like the only place that counts, and the game gets left on the range. Practice DNA isn't destiny — it's a starting diagnosis.",
    ],
    shareName: 'an Engineer',
  },
  blended: {
    name: 'Blended',
    pole: 'Both',
    tagline: 'You move between the Engineer and the Artist — neither pole owns you.',
    profile: [
      "Your answers land near the middle of the Engineer↔Artist spectrum. You can build when it's time to build and play when it's time to play — a genuine advantage, if it's intentional rather than drift.",
      'The risk for a blended player is doing a little of everything and never finishing anything. The edge comes from knowing which mode the moment calls for — and your Skill Band below shows where to point it.',
    ],
    shareName: 'Blended',
  },
  artist: {
    name: 'The Artist',
    pole: 'Artist',
    tagline: "You play. Your best golf happens when you're not thinking about the swing.",
    profile: [
      'Your answers place you toward the Artist pole. You shape shots, invent escapes, and play by feel; your best practice happens on the course, not the range.',
      "Seve won five majors from this end. The strength is real and the trap is real: feel that was never calibrated is a rumor, and slumps last longer when there's no garage to go back to. Practice DNA isn't destiny — it's a starting diagnosis.",
    ],
    shareName: 'an Artist',
  },
};

// ── Axis 2: Mastery zones (the Skill Band) ────────────────────────────────────

export interface ZoneContent {
  label: string; // "Construction"
  persona: PersonaId; // the zone's craft-persona
  personaSkill: string; // "the Engineer's craft"
  what: string; // what mastering this zone means
  status: Record<Exclude<MasteryStatus, 'locked'>, string>;
  locked: string; // copy when not yet measured
}

export const ZONES: Record<ZoneId, ZoneContent> = {
  construction: {
    label: 'Construction',
    persona: 'engineer',
    personaSkill: "the Engineer's craft",
    what: 'Building a swing that holds its shape — the mechanics, verified on camera.',
    status: {
      strong: 'Your swing does what you tell it to. The machine is built.',
      building: 'The pattern is coming together but not yet automatic.',
      dim: "The machine isn't built yet — this is where lasting change starts.",
    },
    locked: 'Measured when you sharpen your map.',
  },
  calibration: {
    label: 'Calibration',
    persona: 'scientist',
    personaSkill: "the Scientist's craft",
    what: 'Reading ball flight, owning your numbers, diagnosing a miss inside one session.',
    status: {
      strong: 'You read the ball and fix yourself. This is the foundation everything else stands on.',
      building: 'You can diagnose some misses — sharpen it and it travels to every zone.',
      dim: "You're guessing more than reading. Calibration is the fastest mastery to build.",
    },
    locked: 'Measured when you sharpen your map.',
  },
  transfer: {
    label: 'Transfer',
    persona: 'warrior',
    personaSkill: "the Warrior's craft",
    what: 'Making a built swing survive pressure — practice with stakes, not just reps.',
    status: {
      strong: 'What you build holds up when it counts. Your practice carries consequence.',
      building: 'Some pressure-testing, but the gap between range and course is still open.',
      dim: 'Untested under pressure — this is usually why the range game evaporates on the first tee.',
    },
    locked: 'Measured when you sharpen your map.',
  },
  performance: {
    label: 'Performance',
    persona: 'artist',
    personaSkill: "the Artist's craft",
    what: 'Committing to the target and trusting the swing on the course — no mechanics.',
    status: {
      strong: 'You let go and play. The technique disappears into the shot.',
      building: 'You commit on good days; under pressure the Engineer still sneaks onto the course.',
      dim: "Mechanical thoughts are following you onto the first tee — that's a tax on every score.",
    },
    locked: 'Measured in the deeper assessment.',
  },
};

// ── Prescription: build the dim zone (drives practice allocation) ──────────────

export interface GrowthPrescription {
  headline: string;
  moves: string[];
  cta: ProductCta;
}

export const GROWTH: Record<ZoneId, GrowthPrescription> = {
  construction: {
    headline: 'Shift practice into the Construction Zone.',
    moves: [
      'Add no-ball, camera-verified mechanics work — slow, with checkpoints.',
      'Firewall it: declare the zone and the tools before each session, no scorekeeping inside.',
      "Don't carry the build onto the course — that's the Artist's job.",
    ],
    cta: FOUNDATIONS,
  },
  calibration: {
    headline: 'Shift practice into the Calibration Zone.',
    moves: [
      'Run Impact Opposites and intentional shot shapes — read what the ball is telling you.',
      'Learn your carry numbers within a few yards; log them, then put the numbers down.',
      'Make every session diagnostic before it becomes a build.',
    ],
    cta: PRACTICE_PROJECT,
  },
  transfer: {
    headline: 'Shift practice into the Transfer Zone.',
    moves: [
      'Put something on the line — games, points, penalties — so reps carry consequence.',
      'Stack the Five Desirable Difficulties: randomize, raise stakes, make it harder than the course.',
      'Track your Transfer Index so progress shows up where it counts.',
    ],
    cta: FLIGHT_SCHOOL,
  },
  performance: {
    headline: 'Shift practice into the Performance Zone.',
    moves: [
      'Run S.C.O.R.E. on every round: strategize, commit, observe, reset, engage.',
      'Lock onto an external target — no swing thoughts once you cross the commitment line.',
      'Train the ten-second Reset until it is automatic after every shot.',
    ],
    cta: FLIGHT_SCHOOL,
  },
};

// ── Patterns (failure modes) — unchanged framing ──────────────────────────────

export interface PatternContent {
  id: PatternId;
  name: string;
  headline: string;
  description: string;
  fix: string;
}

export const PATTERNS: Record<PatternId, PatternContent> = {
  ghost: {
    id: 'ghost',
    name: 'The Ghost',
    headline: 'There’s a zone your game has never met.',
    description:
      'Your fingerprint shows a zone running near zero. Ghosts narrow the Skill Band by leaving zones untrained — the dim region is where your next strokes are hiding.',
    fix: 'Schedule the starved zone first, before the comfortable work. Ten deliberate minutes in a dim zone beats an hour in a bright one.',
  },
  prisoner: {
    id: 'prisoner',
    name: 'The Prisoner',
    headline: 'One zone has become home — and the door locked behind you.',
    description:
      'Most of your practice time concentrates in a single zone, and your answers suggest it’s the one that feels safest. Prisoners cap the Skill Band by refusing to leave home.',
    fix: 'Set an exit criterion before each session — a measurable standard that moves you to the next zone whether it feels finished or not.',
  },
  illusionist: {
    id: 'illusionist',
    name: 'The Illusionist',
    headline: 'The range says one thing. The scorecard says another.',
    description:
      'You rate your mechanics strong, but your handicap trend and range-vs-course gap suggest it isn’t transferring. Illusionists distort the map by misreading where they are.',
    fix: 'Let objective measures arbitrate: video for the swing, Transfer Index for the practice, the handicap trend for the truth.',
  },
};

export const CHIPS: Record<ChipId, { label: string; blurb: string }> = {
  comfortCreature: {
    label: 'Comfort Creature tendencies',
    blurb:
      'Practice structured to produce the feeling of competence rather than to test it. Expect a wide Transfer Gap until Overload gets turned up.',
  },
  quickFix: {
    label: 'Quick-Fix pull',
    blurb:
      'A steady appetite for new tips, feels, and swing thoughts. Changes rarely get enough reps to prove themselves before the next one arrives.',
  },
  scrappyGamer: {
    label: 'Scrappy Gamer',
    blurb:
      'Performance travels — your practice already carries consequence, so what you build tends to show up on the course.',
  },
};

// ── Archetype recognition (one canonical type — a diagnosis, not a verdict) ────

export interface ArchetypeContent {
  name: string;
  tagline: string;
  coachLine: string;
}

export const ARCHETYPES: Record<Archetype, ArchetypeContent> = {
  architect: {
    name: 'The Architect',
    tagline: "You build deliberately, and it's working — your handicap is falling and no zone is starving.",
    coachLine:
      'Keep the discipline that got you here: a plan per session, an exit criterion per zone. A diagnosis, not a verdict — the day a zone goes dim, this changes.',
  },
  quickFixJunkie: {
    name: 'The Quick-Fix Junkie',
    tagline: 'You chase the next tip before the last one had a chance to prove itself.',
    coachLine:
      "Pick one change and give it real reps before you judge it — the swing you already have is usually better than the one you're about to try. A diagnosis, not a verdict.",
  },
  comfortCreature: {
    // "The Range Hero" — the comfort-zone golfer (great on the range, doesn't transfer).
    // Internal key stays `comfortCreature`; only the displayed name changes (Luke, book-align).
    name: 'The Range Hero',
    tagline: "You're a hero on the range — but that range game doesn't follow you to the course.",
    coachLine:
      'Turn the difficulty up on purpose: worst club, bad lies, something on the line. Discomfort is where transfer is built. A diagnosis, not a verdict.',
  },
  scrappyGamer: {
    name: 'The Scrappy Gamer',
    tagline: 'Your practice already carries consequence — what you build tends to show up when it counts.',
    coachLine:
      'Your transfer is a weapon; now give it more to carry. A little camera-verified construction means there’s more swing to bring to the course. A diagnosis, not a verdict.',
  },
  naturalEngineer: {
    name: 'The Natural Engineer',
    tagline: 'You love the build — but the strokes are hiding past the range, in transfer and on the course.',
    coachLine:
      'The machine is built; stop polishing it. Spend your next block taking it to the course under pressure. A diagnosis, not a verdict — your pole isn’t a cage.',
  },
  naturalArtist: {
    name: 'The Natural Artist',
    tagline: "You play by feel and it's real — but feel that was never calibrated is a rumor.",
    coachLine:
      'Give your skill a foundation: a little camera-verified construction so the good days repeat. A diagnosis, not a verdict — your pole isn’t a cage.',
  },
};

// ── Practice Efficiency Score copy ────────────────────────────────────────────

export interface EfficiencyBand {
  label: string;
  blurb: string;
}

/** Band the 0–100 Efficiency Score into a label + one-liner. */
export function efficiencyBand(score: number): EfficiencyBand {
  if (score >= 75) {
    return {
      label: 'Dialed in',
      blurb: 'Most of your practice is pointed where it actually moves your handicap.',
    };
  }
  if (score >= 50) {
    return {
      label: 'Leaking strokes',
      blurb: "A chunk of your practice isn't translating to scores yet — the bars below show where to shift.",
    };
  }
  return {
    label: 'Misallocated',
    blurb: "Most of your practice is going where it feels good, not where it lowers scores. The one move below is the fastest fix.",
  };
}

export const EFFICIENCY_CAPTION =
  'How much of your practice actually moves your handicap — allocation, practice quality, and how well it transfers.';

// ── Mechanics Index ↔ handicap diagnostic copy ────────────────────────────────

export const MI_VERDICTS: Record<MiVerdict, { headline: string; body: string }> = {
  downstream: {
    headline: 'Your swing is built ahead of your scoring.',
    body: "You own more swing than your scores show. The strokes aren't in mechanics — they're downstream, in calibration, transfer, and on the course.",
  },
  construction: {
    headline: 'Your scoring is ahead of your swing.',
    body: 'Short game and scrambling are carrying you. Building the swing itself is where the next, durable strokes live.',
  },
  balanced: {
    headline: 'Your swing and your scoring are in step.',
    body: 'Neither is dragging the other. Keep both moving and let your weakest zone set the next block.',
  },
};

export const MI_STATE_NOTE = {
  estimated: 'Estimated from your answers.',
  none: "Add your handicap to unlock this — it's the scale your Mechanics Index is measured against.",
  measured: 'Measured from your swing.',
} as const;

export const TIME_BARS_CAPTION =
  'Where your practice time goes now versus where it should go — as a share of total time.';

export const RESULT_DISCLAIMER =
  'Practice DNA is a starting diagnosis, not a verdict. Your tendency is where your personality pulls you — not a cage. Mastering all four zones is the work, whatever your pole. The personality-to-practice links are strong hypotheses we’re testing through the Golf Practice Project.';
