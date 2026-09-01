/**
 * THE SEAM between the quiz screens and Atlas's intake API — Atlas's own copy of tgt's
 * `shared/contract.ts`, reshaped for the one thing that changed: **who the run belongs to**.
 *
 * tgt's contract is email-first: `CreateRunInput { email }`, `QuizRun.email`, an anonymous
 * golfer identified by a run id in localStorage. Atlas's intake is authenticated — sign up,
 * THEN quiz — so there is no email screen and no anonymous run. The server resolves "whose run
 * is this" from the session (`verifyToken → attachUser`), never from a client-supplied id.
 *
 * `Answers`, `Profile`, `PracticeDnaResult` are NOT redefined here — they come straight from the
 * forked instrument in `shared/practice-dna/{items,scoring}`, pinned to cfg-2026.08-3 /
 * score-2026.08-1. `VolumeInput`, `AllocInput`, `VOLUME_LIMITS` are also not redefined — they
 * never had an email seam to remove, and `shared/volume.ts` (also forked from tgt, unmodified)
 * already depends on them living in `shared/contract.ts`, so that is where they stayed; this
 * file re-exports them.
 *
 * `QuizRun`'s shape below is NOT this file's opinion — it mirrors `toEnvelope()` in the route
 * lane's `server/routes/intake.ts` field for field (read there, 2026-08-31, while that file was
 * mid-build). Endpoints are that file's, too: `POST /api/intake/start`, `GET /api/intake/me`,
 * `PATCH /api/intake/:id`, `POST /api/intake/:id/complete`. See `api.ts` for the one place that
 * shape is NOT yet satisfiable — the two raw volume answers have no server-side home.
 */

import { PROFILE_FIELDS, type Answers, type Profile } from '../../../shared/practice-dna/items';
import type { PracticeDnaResult } from '../../../shared/practice-dna/scoring';
import type { AllocInput, VolumeInput } from '../../../shared/contract';
import { VOLUME_LIMITS } from '../../../shared/contract';

export type { Answers, Profile, PracticeDnaResult, AllocInput, VolumeInput };
export { VOLUME_LIMITS };

// ── Level / tier progression ──────────────────────────────────────────────────
// Mirrors `tier_completed` on atlas.intake_submissions. 0 = run started, nothing answered yet.
export type TierCompleted = 0 | 1 | 2 | 3 | 4;

/** Tier name → the funnel counter it represents. The route only ever moves this forward. */
export const TIER_COUNTER: Record<'1A' | '1B' | '2' | '3', TierCompleted> = {
  '1A': 1,
  '1B': 2,
  '2': 3,
  '3': 4,
};

export type IntakeStatus = 'in_progress' | 'completed';

// ── The run as the client sees it ─────────────────────────────────────────────
//
// Matches `toEnvelope()` in `server/routes/intake.ts`: `{ id, tierCompleted, status, profile,
// answers, completedAt, createdAt, updatedAt, result }`. Two differences from tgt's `QuizRun`:
// no `email` (the seam this port removes), and no top-level `volume`/`alloc` — the server folds
// the allocation answer into `answers.ALLOC` and has no column at all for the two raw volume
// questions (practiceMinutes/courseHours). See `api.ts`'s header for what that means in practice
// and exactly what's being asked of the route lane to close it.
export interface QuizRun {
  id: string;
  status: IntakeStatus;
  tierCompleted: TierCompleted;
  /** `{}` until saved — never null; the server always returns an object (see `toEnvelope`). */
  profile: Partial<Profile>;
  /** `{}` until saved — includes the derived `ALLOC` entry once the volume stage is done. */
  answers: Answers;
  /** Null until enough is answered to score (Tier 1A complete + full profile). */
  result: PracticeDnaResult | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/**
 * All 7 profile fields present — the product's observed all-or-nothing shape, not a DB rule
 * (the route's own `isProfileComplete` in `server/routes/intake.ts` runs the same check before
 * it will score a run or accept `/complete`; mirrored here rather than re-typed differently, so
 * `useQuizRun`'s auto-`completeRun` doesn't fire a doomed request on every partial profile save).
 */
export function isProfileFilled(profile: Partial<Profile>): boolean {
  return PROFILE_FIELDS.every((f) => {
    const v = (profile as Record<string, unknown>)[f.code];
    return v !== undefined && v !== null && v !== '';
  });
}

// ── The interface the quiz screens code against ───────────────────────────────

export interface QuizApi {
  /**
   * GET /api/intake/me — the signed-in user's run.
   * Rejects with `QuizApiError(..., 404, 'not_started')` if they have never begun one — that is
   * how `useQuizRun` knows to call `startRun` rather than showing an error.
   */
  getRun(): Promise<QuizRun>;

  /**
   * POST /api/intake/start — starts a run owned by the signed-in user. Idempotent: if one
   * already exists, the route returns it unchanged rather than resetting it.
   */
  startRun(): Promise<QuizRun>;

  /**
   * The volume stage's save. Two PATCHes under the hood (see `api.ts`) — `kind: 'alloc'`, which
   * the route already supports, and `kind: 'volume'`, which it does not yet. Kept as ONE method
   * here because the screen only knows "I finished the volume stage," not that it is secretly
   * two requests with different odds of succeeding right now.
   */
  saveVolume(id: string, volume: VolumeInput, alloc: AllocInput): Promise<QuizRun>;

  /**
   * PATCH /api/intake/:id { kind: 'profile' } — the 7 profile fields. This save is the point of
   * the whole port: these answers are what becomes the golfer's profile, not a copy of it.
   */
  saveProfile(id: string, profile: Profile): Promise<QuizRun>;

  /**
   * PATCH /api/intake/:id { kind: 'answers', tierCompleted } — saves the tier's answers and
   * advances the funnel counter. The server recomputes `result` from `answers` on every read
   * (`tryComputeResult` in `toEnvelope`) — never trust a client-sent score.
   */
  saveTier(id: string, tier: '1A' | '1B' | '2' | '3', answers: Answers): Promise<QuizRun>;

  /**
   * POST /api/intake/:id/complete — marks the run complete and reconciles the two profile
   * fields that have a shared-schema home (`PRO_HAND`, `PRO_HCP_NOW`) into `golf.player_profile`.
   * Idempotent; 400s `profile_incomplete` if called too early, which `useQuizRun` guards against.
   */
  completeRun(id: string): Promise<QuizRun>;
}

// ── Errors the UI must handle ────────────────────────────────────────────────

export class QuizApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'QuizApiError';
  }
}
