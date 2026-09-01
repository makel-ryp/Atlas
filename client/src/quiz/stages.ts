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

export type Stage = 'volume' | 'profile' | 'tier1A' | 'tier1B' | 'tier2' | 'tier3' | 'result';

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
  if (run.tierCompleted === 0) return 'tier1A';
  return 'result';
}

/** Which tier a "keep going" button should offer next, or null when they're done. */
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
export const STAGE_SEQUENCE: readonly Stage[] = ['volume', 'profile', 'tier1A', 'result'];

export const STAGE_LABELS: Record<Stage, string> = {
  volume: 'Your practice week',
  profile: 'About your game',
  tier1A: 'The Read',
  tier1B: 'Sharpen your map',
  tier2: 'The Full Diagnosis',
  tier3: 'Research grade',
  result: 'Your result',
};
