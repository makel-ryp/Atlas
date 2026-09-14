/**
 * WHICH SCREEN ARE WE ON — the one place that answers that question.
 *
 * The rule (handoff §3): the saved run is the source of truth, not the UI. Whatever
 * is already stored on the run tells us where the golfer got to, so a refresh, a
 * closed tab, or a link opened tomorrow all resume in the right place. Nothing about
 * "where we are" is kept only in React state, because React state dies on reload.
 *
 * Stages are deliberately coarse. `volume` is ONE stage covering two typed questions
 * plus the allocation bar, because `saveVolume` writes all of it in a single call —
 * there is no half-saved state to resume into.
 *
 * `email` is DROPPED from this port. Atlas already knows who the golfer is — the run is
 * created from the session (`useQuizRun`'s auto-start), so `defaultStage` can assume `run`
 * is non-null by the time it's called; `Shell` only renders a stage once `useQuizRun` has
 * finished loading/starting one.
 */

import { isProfileFilled, type QuizRun, type TierCompleted } from './contract';

export type Stage =
  | 'volume'
  | 'profile'
  | 'interview'
  | 'tier1A'
  | 'tier1B'
  | 'tier2'
  | 'tier3'
  | 'result';

/**
 * The furthest-along screen this run has earned. Order matters: each check assumes
 * everything above it already passed.
 *
 * Note it never returns a tier past 1A. Levels 2–4 are opt-in (§3: each result screen
 * sells the next level), so after Tier 1A the default landing spot is always the
 * result — the golfer chooses to go further from there.
 *
 * The volume check uses the REAL signal, `!run.volume || !run.alloc`, matching tgt.
 *
 * It used to proxy on `answers.ALLOC === undefined`, written when `QuizRun` had no volume/alloc
 * fields. That was a DEADLOCK, not an approximation: the server derives ALLOC at score time into
 * a throwaway copy and deliberately never writes it into `answers`, so the proxy was waiting on a
 * key that by design can never appear. Every golfer got the volume stage, saved it successfully,
 * and was handed the volume stage again — forever. Found by driving the quiz in a browser on
 * 2026-09-01; the API smoke suite could not see it, because both sides were individually correct.
 * `atlas.intake_submissions.volume` and `.alloc` are real columns and `toEnvelope` returns them.
 */
export function defaultStage(run: QuizRun): Stage {
  if (!run.volume || !run.alloc) return 'volume';
  if (!isProfileFilled(run.profile)) return 'profile';
  // The interview sits between the profile and the items: it is the same kind of question as the
  // profile (about you, not about your practice) and it is what fills the coach's dossier, so a
  // golfer answers it while still in that frame rather than after being scored.
  //
  // Gated on `goal` alone, not on all five. `limits` is legitimately empty for most people and
  // `isInterviewFilled` would then loop them back here forever. `goal` is the one question nobody
  // has a blank answer to.
  if (!run.interview?.goal) return 'interview';
  if (run.tierCompleted === 0) return 'tier1A';
  return 'result';
}

/**
 * Which tier a "keep going" button should offer next, or null when they're done.
 *
 * ── THE FULL LADDER IS BACK. Decision, Makel, 2026-09-14. ───────────────────────────────────
 * This supersedes the 2026-09-01 decision recorded here, which cut everything past Tier 1A and
 * read "the intake ends at Tier 1A". Two things that decision could not have weighed:
 *
 *  1. The MAP has never rendered, for anyone. `ResultScreen` gates it on `quizConfidence`, and
 *     confidence only leaves 'baseline' once a Tier 1B answer exists (scoring.ts `computeConfidence`).
 *     Returning null here pinned it to 'baseline' forever, so `PracticeMap` — the product's
 *     central metaphor, fully built and identical to TGT's — was unreachable code.
 *  2. The three SLIDER items (ATTN01, ATTN02, FP_TRA) are all Tier 2. `QuestionControls` already
 *     renders them; only the flow withheld them. The two ATTN items are the attention checks that
 *     `quality_flag` is derived from, so without Tier 2 there is no response-quality signal at all.
 *
 * This is the same ladder TGT runs today (yanyanarti/practice-dna), which is the instrument this
 * is a port of. It stays OPT-IN: `defaultStage` still lands on the result after Tier 1A, and each
 * result screen sells the next level. Nobody is made to answer 60 items before seeing anything.
 *
 * Tier 3 is offered by this function and then filtered out by `tierHasQuestions` in Shell — all
 * 15 of its items are `pending: true` with empty text, and the Mini-IPIP block that would fill it
 * is deliberately held out of `ALL_ITEMS`. Leaving the case here rather than returning null keeps
 * this function a faithful mirror of the instrument; the guard in Shell is what protects the
 * golfer from a screen with no questions.
 */
export function nextTier(tierCompleted: TierCompleted): 'tier1B' | 'tier2' | 'tier3' | null {
  switch (tierCompleted) {
    case 1:
      return 'tier1B';
    case 2:
      return 'tier2';
    case 3:
      return 'tier3';
    default:
      return null;
  }
}

/** Progress dots in the header. Tier 3 is excluded: it is research opt-in, not the flow. */
export const STAGE_SEQUENCE: readonly Stage[] = ['volume', 'profile', 'interview', 'tier1A', 'tier1B', 'tier2', 'result'];

export const STAGE_LABELS: Record<Stage, string> = {
  volume: 'Your practice week',
  profile: 'About your game',
  interview: 'The interview',
  tier1A: 'The Read',
  tier1B: 'Sharpen your map',
  tier2: 'The Full Diagnosis',
  tier3: 'Research grade',
  result: 'Your result',
};
