/**
 * THE REAL `QuizApi` — talks to the route lane's actual `server/routes/intake.ts`, read
 * 2026-08-31 while that file was mid-build (its own schema import doesn't resolve yet — see its
 * header comment). Endpoints, body shapes and the response envelope below are copied from that
 * file, not invented, except for the one gap called out under `saveVolume`.
 *
 * There is no local/fake adapter here, unlike tgt: Atlas has no anonymous mode for this screen,
 * so there is nothing honest to fall back to when signed out. `apiFetch` already attaches the
 * Firebase ID token and throws `ApiError` on a non-2xx response; this file's job is calling the
 * right endpoint with the right body and translating failures into `QuizApiError`.
 */

import { apiFetch, ApiError } from '../lib/api';
import { computeVolumeBreakdown } from '../../../shared/volume';
import type {
  AllocInput,
  Answers,
  Profile,
  QuizApi,
  QuizRun,
  VolumeInput,
} from './contract';
import { QuizApiError, TIER_COUNTER } from './contract';

function toQuizApiError(err: unknown, fallback: string): QuizApiError {
  if (err instanceof ApiError) {
    // `submission_not_found` from GET /api/intake/me means "never started" — not a failure,
    // see `getRun`'s contract comment. Every other code is server-internal and must not leak
    // onto the screen as-is.
    if (err.status === 404 && err.code === 'submission_not_found') {
      return new QuizApiError('No intake run started', 404, 'not_started');
    }
    return new QuizApiError(fallback, err.status, err.code);
  }
  return new QuizApiError(fallback, 0, 'network_error');
}

/** PATCH /api/intake/:id — every save kind shares this envelope response. */
async function patchIntake(id: string, body: Record<string, unknown>): Promise<QuizRun> {
  return apiFetch<QuizRun>(`/api/intake/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export const intakeApi: QuizApi = {
  async getRun(): Promise<QuizRun> {
    try {
      return await apiFetch<QuizRun>('/api/intake/me');
    } catch (err) {
      throw toQuizApiError(err, "We couldn't load your assessment. Please try again.");
    }
  },

  async startRun(): Promise<QuizRun> {
    try {
      return await apiFetch<QuizRun>('/api/intake/start', { method: 'POST', body: '{}' });
    } catch (err) {
      throw toQuizApiError(err, "We couldn't start your assessment. Please try again.");
    }
  },

  /**
   * Two PATCHes, because the route models this stage's output as two different things:
   *
   * 1. `kind: 'alloc'` — the DERIVED allocation (`construction`/`calibration`/`transfer`/
   *    `performance`, i.e. `AllocValue`), computed here via the same `computeVolumeBreakdown`
   *    the result screen and the server's own re-score both use. The route already validates
   *    and stores this today (folded into `answers.ALLOC`).
   *
   * 2. `kind: 'volume'` — the two RAW answers (`practiceMinutes`, `courseHours`). ⚠️ THE ROUTE
   *    HAS NO BRANCH FOR THIS YET. Its `kind: 'volume'` case currently expects an `answers`
   *    record validated against `ITEM_BY_CODE` (its file, ~line 234) — `practiceMinutes`/
   *    `courseHours` are not instrument item codes, they're `VolumeInput`'s own fields, so this
   *    call 400s with `unknown_item_code` until the route grows a real `volume` branch (a
   *    `{ volume: { practiceMinutes, courseHours } }` body, stored somewhere other than
   *    `answers` — a jsonb column, same treatment as `profile`). Sent anyway, sequenced AFTER
   *    the alloc save: if it fails, the scored input (`ALLOC`) already saved, so `defaultStage`'s
   *    proxy check still advances the golfer — only the result screen's real-minutes time bars
   *    stay empty (see `ResultScreen.tsx`'s `breakdown` comment) until this lands.
   */
  async saveVolume(id: string, volume: VolumeInput, alloc: AllocInput): Promise<QuizRun> {
    const breakdown = computeVolumeBreakdown(volume, alloc);
    let run: QuizRun;
    try {
      run = await patchIntake(id, { kind: 'alloc', alloc: breakdown.alloc, tierCompleted: 0 });
    } catch (err) {
      throw toQuizApiError(err, "We couldn't save your practice week. Please try again.");
    }
    try {
      run = await patchIntake(run.id, { kind: 'volume', volume });
    } catch (err) {
      // Deliberately re-thrown, not swallowed: the golfer needs to know their time bars won't
      // show up, even though the part that scores them did save. See the method doc above.
      throw toQuizApiError(
        err,
        "Your practice split saved, but we couldn't save your weekly minutes yet.",
      );
    }
    return run;
  },

  async saveProfile(id: string, profile: Profile): Promise<QuizRun> {
    try {
      return await patchIntake(id, { kind: 'profile', profile });
    } catch (err) {
      throw toQuizApiError(err, "We couldn't save your profile. Please try again.");
    }
  },

  async saveTier(id: string, tier: '1A' | '1B' | '2' | '3', answers: Answers): Promise<QuizRun> {
    try {
      return await patchIntake(id, {
        kind: 'answers',
        answers,
        tierCompleted: TIER_COUNTER[tier],
      });
    } catch (err) {
      throw toQuizApiError(err, 'Something went wrong saving your answers. Please try again.');
    }
  },

  async completeRun(id: string): Promise<QuizRun> {
    try {
      return await apiFetch<QuizRun>(`/api/intake/${id}/complete`, {
        method: 'POST',
        body: '{}',
      });
    } catch (err) {
      throw toQuizApiError(err, "We couldn't finish your assessment. Please try again.");
    }
  },
};
