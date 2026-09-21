import { useCallback, useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import type { ConsentState } from '../../../shared/consent'
import { MINOR_AGE_THRESHOLD } from '../../../shared/consent'

/**
 * The screens that stand in front of Atlas until an account has established it may be used.
 *
 * ⚠️ THIS IS NOT THE GATE. `server/requireConsent.ts` is the gate; it refuses the request whatever
 * this file renders. What lives here is the courtesy half: a blocked account that saw only this
 * file would still be blocked, and a blocked account that never saw it would face a wall of 403s
 * with no way to act on them. Both halves are needed, but only one of them is a control — do not
 * "simplify" the server check away because this screen exists.
 *
 * Policy (Makel, 2026-09-21): a minor may do EVERYTHING an adult can; they just need a parent or
 * guardian to consent first. So there is no third screen for a restricted-but-allowed state —
 * either the account is usable or it is waiting, and there is nothing in between to render.
 */

type MeResponse = {
  user: { dateOfBirth: string | null; parentalConsentAt: string | null }
  consent: ConsentState
}

/**
 * 'checking' while we ask, then whatever the server says.
 *
 * 'unknown' is the FAIL-OPEN state, and that is deliberate and safe here for a reason that does not
 * apply to the server: a network error or a 500 means this screen cannot tell whether the account
 * owes anything, and trapping a signed-in adult behind a date-of-birth form they have already
 * filled in — because one fetch failed — is a worse outcome than letting them through to a server
 * that will refuse them anyway if they really are blocked. Same reasoning, and the same word, as
 * `useIntakeGate` in App.tsx.
 *
 * The inverse would be a real bug: fail-closed HERE plus fail-closed on the server means one flaky
 * request locks someone out of an app that has no other door.
 */
export type ConsentGate = 'checking' | 'unknown' | ConsentState

export function useConsentGate(active: boolean): [ConsentGate, (next: ConsentState) => void] {
  const [gate, setGate] = useState<ConsentGate>('checking')

  useEffect(() => {
    if (!active) return
    let cancelled = false
    apiFetch<MeResponse>('/api/users/me')
      .then((me) => {
        if (!cancelled) setGate(me.consent)
      })
      .catch((err) => {
        if (cancelled) return
        // A 403 from THIS endpoint is not a consent answer — /api/users/me is ungated on purpose
        // (see routes/me.ts `gatedChain`). It means no Atlas access, which App.tsx's own
        // `no_atlas_access` state already renders. Anything else is a genuine unknown.
        void (err instanceof ApiError)
        setGate('unknown')
      })
    return () => {
      cancelled = true
    }
  }, [active])

  // Answering the date-of-birth screen changes the state without a reload — the server returns the
  // recomputed state in the same round trip, so there is nothing to re-ask.
  return [gate, useCallback((next: ConsentState) => setGate(next), [])]
}

/** The three-integer body `POST /api/users/me/date-of-birth` expects. Never an ISO string — see the route. */
type DobResponse = { consent: ConsentState }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function messageFor(code: string): string {
  switch (code) {
    case 'date_of_birth_invalid':
      return 'That date does not exist. Check the day and month.'
    case 'date_of_birth_in_future':
      return 'That date is in the future.'
    case 'date_of_birth_implausible':
      return 'That date of birth does not look right.'
    case 'date_of_birth_already_set':
      return 'Your date of birth is already on file. Reload the page.'
    case 'invalid_body':
      return 'Fill in all three boxes.'
    default:
      return 'Could not save that. Please try again.'
  }
}

/**
 * Asks for a date of birth, once.
 *
 * Three separate fields rather than a single `<input type="date">`: the native date picker is a
 * miserable way to enter a year forty years back on a phone, and it hands the server a string
 * whose meaning depends on a time zone — the one thing the route refuses to accept, because a
 * one-day slip moves a person across the threshold (see shared/consent.ts).
 *
 * The copy says what the date is FOR. A form that demands a child's birthday with no explanation
 * is exactly the dark-pattern the age-appropriate-design rules exist to stop, and "we need it to
 * know whether to ask your parent" is the honest answer.
 */
export function DateOfBirthScreen({ onDone }: { onDone: (next: ConsentState) => void }) {
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const out = await apiFetch<DobResponse>('/api/users/me/date-of-birth', {
        method: 'POST',
        body: JSON.stringify({ year: Number(year), month: Number(month), day: Number(day) }),
      })
      onDone(out.consent)
    } catch (err) {
      setError(messageFor(err instanceof ApiError ? err.code : 'unexpected'))
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <h1>Your date of birth</h1>
      <p>
        Atlas asks once, and it is the only thing standing between you and the rest of the app. If
        you are under {MINOR_AGE_THRESHOLD} we need a parent or guardian to approve the account
        first — that is the only reason we ask.
      </p>
      <form className="edit" onSubmit={submit}>
        <label>
          Day
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </label>
        <label>
          Month
          <select value={month} onChange={(e) => setMonth(e.target.value)} required>
            <option value="">—</option>
            {MONTHS.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <input
            type="number"
            inputMode="numeric"
            min={1900}
            max={2200}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </form>
    </main>
  )
}

/**
 * Shown to a minor whose guardian has not consented yet.
 *
 * ⚠️ DELIBERATELY NO "send my parent an email" BUTTON. There is no guardian-email column on
 * `public.users` and no verified-consent flow behind it, so a field here would collect an address
 * that goes nowhere and a button that promises something the system cannot do — the same class of
 * fabrication as the stake feature and the invented message thread removed on 2026-09-20. When
 * counsel settles what counts as consent (docs/TASKS.md T-16), the mechanism slots in here and
 * this comment goes with it.
 *
 * Until then the honest instruction is the one that actually works today: a coach or an
 * administrator records the consent once they have it, through
 * POST /api/admin/users/:userId/parental-consent.
 */
export function GuardianPendingScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="auth-shell">
      <h1>Waiting on a parent or guardian</h1>
      <p>
        This account belongs to someone under {MINOR_AGE_THRESHOLD}, so a parent or guardian has to
        approve it before it can be used. Ask your coach to set that up — it takes one conversation,
        and nothing here is lost in the meantime.
      </p>
      <p className="small muted">
        Once the approval is recorded, sign in again and everything will be waiting.
      </p>
      <button onClick={onSignOut}>Sign out</button>
    </main>
  )
}
