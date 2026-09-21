/**
 * Age and parental consent — the ONE place the thresholds live.
 *
 * Policy, Makel 2026-09-21: **"the minor is allowed to do everything, just needs to have parental
 * consent to use the app."** So this is a gate on ACCESS, not a gate on features. Once consent
 * exists, a 14-year-old's account is indistinguishable from an adult's. Nothing downstream of
 * `consentStateFor` may branch on age again — if you find yourself adding a second age comparison
 * somewhere else, that is the bug, not the feature.
 *
 * ── Why one constant and not a table of them ────────────────────────────────────────────────
 * The real thresholds are a legal question and they are NOT settled (see docs/TASKS.md T-16):
 * COPPA is under-13 and demands *verifiable* consent; the UK Age Appropriate Design Code governs
 * all under-18s and constrains design, not just consent; GDPR's digital-consent age varies by
 * member state between 13 and 16. Counsel decides. What code can do meanwhile is make that answer
 * a ONE-LINE change instead of an audit — so every age decision in Atlas reads this file.
 *
 * ⚠️ This module is the POLICY. It is not the enforcement. Enforcement is `server/requireConsent`
 * (server side, the real gate) and the consent screen in `client/src/App.tsx` (courtesy only).
 */

/**
 * Below this age, an account needs `users.parental_consent_at` before it may be used.
 *
 * 18 because Makel said under-18s will use the app and asked for one uniform rule. Deliberately
 * the STRICTEST of the candidate thresholds (13 / 16 / 18): if counsel later says 13 is enough,
 * lowering it releases accounts that were held, which is safe. Guessing low and raising it later
 * would mean minors had already been let in unconsented, which is not recoverable.
 */
export const MINOR_AGE_THRESHOLD = 18

/**
 * What an account still owes before it may be used.
 *
 *  'dob_required'     — we do not know how old they are, so we cannot know whether they need
 *                       consent. Fails CLOSED: unknown is not adult. This is the state every one
 *                       of the 12 existing accounts is in, because nothing has ever collected a
 *                       date of birth (0/12 rows carry one as of 2026-09-21).
 *  'consent_required' — under MINOR_AGE_THRESHOLD and `parental_consent_at` is null.
 *  'ok'               — an adult, or a minor whose guardian has consented. No further branching.
 */
export type ConsentState = 'dob_required' | 'consent_required' | 'ok'

/**
 * Whole years old, by the CALENDAR — not by division.
 *
 * `(now - dob) / 365.25` is wrong by a day around leap years, and a day is not a rounding error
 * here: it moves a person across the threshold and either admits an unconsented minor or holds an
 * adult out. Compare year/month/day directly and there is no arithmetic to be wrong.
 *
 * All accessors are getUTC*, matching how `storedDateOfBirth` writes the value. Mixing UTC and
 * local accessors reintroduces the ±1-day slip this function exists to avoid — the same class of
 * bug as the midnight-UTC seed dates that displayed a day early on 2026-09-20.
 */
export function ageInYears(dateOfBirth: Date, asOf: Date): number {
  const by = dateOfBirth.getUTCFullYear()
  const bm = dateOfBirth.getUTCMonth()
  const bd = dateOfBirth.getUTCDate()
  const ay = asOf.getUTCFullYear()
  const am = asOf.getUTCMonth()
  const ad = asOf.getUTCDate()
  let age = ay - by
  // Birthday has not happened yet this year.
  if (am < bm || (am === bm && ad < bd)) age -= 1
  return age
}

/**
 * The state machine, over the two `public.users` columns that have existed since the schema was
 * written and have never been read by anything (T-16).
 *
 * ⚠️ FAILS CLOSED on a missing date of birth, and that is deliberate even though it means every
 * existing account is gated on the day this ships. "We don't know" must not resolve to "adult" —
 * that is the whole failure mode. It is survivable precisely because 'dob_required' is answerable
 * in one screen by the account holder themselves; 'consent_required' is not, which is why the two
 * states are distinct rather than one 'blocked'.
 */
export function consentStateFor(
  user: { dateOfBirth: Date | string | null; parentalConsentAt: Date | string | null },
  asOf: Date = new Date(),
): ConsentState {
  if (!user.dateOfBirth) return 'dob_required'
  const dob = user.dateOfBirth instanceof Date ? user.dateOfBirth : new Date(user.dateOfBirth)
  // An unparseable stored value is not a licence to proceed — same fail-closed rule as above.
  if (Number.isNaN(dob.getTime())) return 'dob_required'
  if (ageInYears(dob, asOf) >= MINOR_AGE_THRESHOLD) return 'ok'
  return user.parentalConsentAt ? 'ok' : 'consent_required'
}

/** Convenience for screens that want to say "a guardian must approve this account". */
export function isMinor(dateOfBirth: Date, asOf: Date = new Date()): boolean {
  return ageInYears(dateOfBirth, asOf) < MINOR_AGE_THRESHOLD
}

/**
 * Build the value to STORE for a calendar date of birth, from plain year/month/day integers.
 *
 * ⚠️ NOON UTC, not midnight, and this is the bug-avoidance the whole module is built around.
 * `public.users.date_of_birth` is `timestamp` (no time zone). A value stored at 00:00 UTC is
 * rendered as the PREVIOUS DAY by anything reading it in a negative-offset zone — which is every
 * US time zone, and is exactly the defect found in the seed data on 2026-09-20. Noon leaves ±12
 * hours of slack, so the calendar date survives any zone on earth.
 *
 * Returns null for a date that does not exist (2026-02-30), which `new Date(Date.UTC(...))` would
 * otherwise silently roll forward into March.
 */
export function storedDateOfBirth(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  // Roll-forward check: Date.UTC(2026, 1, 30) silently becomes 2 March.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null
  }
  return d
}

/**
 * Sanity bounds on a submitted date of birth.
 *
 * ⚠️ These ARE gates, unlike `shared/profile-bounds.ts`, and the difference is the point. Those
 * are hints on golf measurements where refusing someone an account for swinging slowly is absurd.
 * This is identity: a date of birth in the future, or implying a 150-year-old, is not a person
 * being unusual, it is a typo or a probe. Refusing it protects the gate rather than the golfer.
 */
export const DOB_MAX_AGE = 120

export function dateOfBirthProblem(dob: Date, asOf: Date = new Date()): string | null {
  if (dob.getTime() > asOf.getTime()) return 'date_of_birth_in_future'
  if (ageInYears(dob, asOf) > DOB_MAX_AGE) return 'date_of_birth_implausible'
  return null
}
