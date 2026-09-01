/**
 * THE RUN — one golfer's attempt at the intake, and every way of changing it.
 *
 * Adapted from tgt's `useQuizRun.ts`. The one thing that changed is where the run's identity
 * lives: tgt's version resumed from a run id in `localStorage` (or a `?run=` link, for the
 * Klaviyo result email) because its golfer had no account. Atlas's golfer is signed in before
 * they ever see this screen, so the run's owner is the session, not a browser pointer.
 *
 * Deleting that logic instead of adapting it was deliberate, not a shortcut: a stored run id
 * is a shared-device bug waiting to happen (a coach's laptop, an academy iPad — the second
 * person to open this screen would resume the first person's intake), and a `?run=<uuid>` link
 * is an IDOR surface with no purpose here. Every method below is "my current run," full stop —
 * `id` is still threaded through to the api (that part of tgt's shape didn't need to change,
 * since `PATCH /api/intake/:id` needs one), it just never comes from anywhere but `run.id`.
 *
 * Three jobs:
 *   1. hold the current run, fetching (and auto-starting, if none exists) on mount
 *   2. once it's eligible, fire the one-time `completeRun` that reconciles into `golf.*`
 *   3. turn every failure into a plain sentence a golfer can read
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AllocInput,
  type Answers,
  isProfileFilled,
  type Profile,
  type QuizApi,
  QuizApiError,
  type QuizRun,
  type VolumeInput,
} from './contract';

export interface QuizRunState {
  run: QuizRun | null;
  /** True during the initial load/auto-start, and during every save. */
  busy: boolean;
  /** A sentence fit to show a golfer. Null when nothing is wrong. */
  error: string | null;
  saveVolume(volume: VolumeInput, alloc: AllocInput): Promise<void>;
  saveProfile(profile: Profile): Promise<void>;
  saveTier(tier: '1A' | '1B' | '2' | '3', answers: Answers): Promise<void>;
  dismissError(): void;
}

/**
 * `fallback` describes what the golfer was actually doing. Kept from tgt's version: a single
 * hardcoded sentence for every failure sent debugging down the wrong screen more than once.
 */
function messageFor(e: unknown, fallback: string): string {
  if (e instanceof QuizApiError) return e.message;
  return fallback;
}

export function useQuizRun(api: QuizApi): QuizRunState {
  const [run, setRun] = useState<QuizRun | null>(null);
  const [busy, setBusy] = useState(true); // starts true: the load-or-start check runs immediately
  const [error, setError] = useState<string | null>(null);

  // ── Load on mount, auto-starting if this golfer has never begun ────────────
  useEffect(() => {
    let cancelled = false; // ignore a late reply if this component unmounted first

    (async () => {
      try {
        const found = await api.getRun();
        if (!cancelled) setRun(found);
      } catch (e) {
        if (e instanceof QuizApiError && e.code === 'not_started') {
          // Not an error — this golfer's first visit. There is no email screen to click
          // "start" on any more, so the run begins itself.
          try {
            const started = await api.startRun();
            if (!cancelled) setRun(started);
          } catch (startErr) {
            if (!cancelled) {
              setError(messageFor(startErr, "We couldn't start your assessment. Please try again."));
            }
          }
        } else if (!cancelled) {
          setError(messageFor(e, "We couldn't load your assessment. Please try again."));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  /**
   * `POST /api/intake/:id/complete` reconciles `PRO_HAND`/`PRO_HCP_NOW` into
   * `golf.player_profile` — the shared layer other apps read. Fired once, silently, as soon as
   * the run is eligible (full profile + at least Tier 1A), rather than wired to a button: there
   * is no "Finish" step in this flow distinct from finishing Tier 1A, and the route is written
   * to be idempotent and to 400 harmlessly (`profile_incomplete`) if called too early, so calling
   * it as a side effect of `run` changing — instead of threading it through every save path that
   * might be the one that makes the run eligible — is the one place this belongs.
   *
   * `attempted` guards against re-firing on every render once `run.status` is already
   * `'completed'`, and against a second race if `run` updates again before the request returns.
   */
  const completeAttempted = useRef(false);
  useEffect(() => {
    if (!run || run.status === 'completed') return;
    if (run.tierCompleted === 0) return;
    if (!isProfileFilled(run.profile)) return;
    if (completeAttempted.current) return;
    completeAttempted.current = true;

    let cancelled = false;
    api
      .completeRun(run.id)
      .then((updated) => {
        if (!cancelled) setRun(updated);
      })
      .catch(() => {
        // Silent by design: this is a reconciliation into golf.player_profile, not something
        // the golfer asked for or is blocked on. Their own answers are already saved regardless
        // of whether this succeeds. Retried on the next eligible `run` change if it comes back
        // false — `completeAttempted` only blocks re-firing for the SAME run reference; a
        // subsequent save produces a new `run` object and gets its own attempt.
        completeAttempted.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [api, run]);

  /**
   * Every save funnels through here so the busy flag, the error handling, and the
   * "don't apply a stale reply" rule are written once instead of three times.
   */
  const mutate = useCallback(async (fn: () => Promise<QuizRun>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      setRun(await fn());
    } catch (e) {
      // See `QuizApiError.partialRun`'s doc: `saveVolume` can fail on its second of two PATCHes
      // after the first already landed server-side. Applying it here means the local `run`
      // reflects that half-success instead of silently staying one save behind until a reload.
      if (e instanceof QuizApiError && e.partialRun) setRun(e.partialRun);
      setError(messageFor(e, fallback));
      throw e; // let the calling screen know not to advance
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Guards every save that needs an existing run. Reaching one of these without a run means a
   * screen rendered out of order — a bug in the shell, not bad input.
   */
  const requireRun = useCallback((): QuizRun => {
    if (!run) throw new QuizApiError('No run in progress', 400, 'no_run');
    return run;
  }, [run]);

  return {
    run,
    busy,
    error,

    saveVolume: useCallback(
      (volume, alloc) =>
        mutate(
          () => api.saveVolume(requireRun().id, volume, alloc),
          "We couldn't save your practice week. Please try again.",
        ),
      [api, mutate, requireRun],
    ),

    saveProfile: useCallback(
      (profile) =>
        mutate(
          () => api.saveProfile(requireRun().id, profile),
          "We couldn't save your profile. Please try again.",
        ),
      [api, mutate, requireRun],
    ),

    saveTier: useCallback(
      (tier, answers) =>
        mutate(
          () => api.saveTier(requireRun().id, tier, answers),
          'Something went wrong saving your answers. Please try again.',
        ),
      [api, mutate, requireRun],
    ),

    dismissError: useCallback(() => setError(null), []),
  };
}
