/**
 * FORK NOTICE — NOT a copy of tgt's `shared/contract.ts`. That file is shaped around tgt's
 * email-first anonymous run (`CreateRunInput { email }`, `QuizRun.email`, a `QuizApi` keyed on
 * a client-supplied run id) — a seam Atlas's authenticated intake deliberately removes. Porting
 * it here would smuggle that seam back in through a type import even after the code that used
 * it is gone.
 *
 * This file exists ONLY because `shared/volume.ts` (forked from tgt, see its own header) was
 * written against two of that file's types that have nothing to do with the email seam —
 * `VolumeInput` and `AllocInput` are just the two typed practice-week questions' shapes, needed
 * unchanged by both the client screens and, later, the server's scoring step. Rather than edit
 * `volume.ts`'s import to point at a client-only copy (wrong direction — server code must not
 * import from `client/src/quiz/`), those two shapes get this one shared, neutral home.
 *
 * The full `QuizRun`/`QuizApi`/`QuizApiError` — the pieces that DO change shape for Atlas — live
 * in `client/src/quiz/contract.ts`, which imports `VolumeInput`/`AllocInput`/`VOLUME_LIMITS` from
 * here rather than redeclaring them, so there is exactly one definition of each.
 */

export interface VolumeInput {
  /** Weekly minutes on the full swing: range, garage, simulator. Excludes rounds. */
  practiceMinutes: number;
  /** Weekly hours playing on the course. Decimals ok. */
  courseHours: number;
}

/**
 * The accepted range for the two volume answers, in ONE place so client and server can't drift.
 * Values unchanged from tgt's `shared/contract.ts`.
 */
export const VOLUME_LIMITS = {
  /** 3000 min/wk = 50 hours, well past any honest answer. */
  practiceMinutesMax: 3000,
  courseHoursMax: 60,
} as const;

/**
 * The 4-segment allocation of PRACTICE time (not rounds). Must sum to 100.
 * Performance is deliberately absent: it is derived from `courseHours`, not self-reported here.
 */
export interface AllocInput {
  construction: number;
  calibration: number;
  transfer: number;
  /** The Messy Middle — a diagnostic, NOT a fifth zone. */
  messy: number;
}
