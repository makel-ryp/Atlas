import { useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/authContext'
import { apiFetch } from './lib/api'
import { Login } from './components/Login'
import { Profile } from './components/Profile'
import { Admin } from './components/Admin'
import { Shell as IntakeShell } from './quiz/Shell'
import { intakeApi } from './quiz/api'
import { QuizApiError } from './quiz/contract'

/**
 * Does this signed-in golfer still need to take Practice DNA before they see the rest of Atlas?
 *
 * A REDIRECT, not a tab (see the goal doc's "your call which, but say why"): the whole point of
 * this port is that intake IS account creation — sign up, take the quiz, the answers become the
 * profile. A tab makes that optional, which contradicts the premise; every other Atlas screen is
 * reading a profile this quiz is what fills in.
 *
 * `'unknown'` is the fail-open state: a network error, a 500, or this route lane's endpoint not
 * existing yet (its own schema import doesn't resolve as of 2026-08-31 — see `server/routes/
 * intake.ts`'s header) all land here, and `'unknown'` renders normal Atlas, never the quiz. A
 * redirect gate that can trap a signed-in golfer behind a screen the backend can't serve is worse
 * than no gate — empty/unknown must stay honest, not become a wall.
 */
type IntakeGate = 'checking' | 'needed' | 'satisfied' | 'unknown'

function useIntakeGate(active: boolean): [IntakeGate, () => void] {
  const [gate, setGate] = useState<IntakeGate>('checking')

  useEffect(() => {
    if (!active) return
    let cancelled = false
    intakeApi
      .getRun()
      .then((run) => {
        if (!cancelled) setGate(run.status === 'completed' ? 'satisfied' : 'needed')
      })
      .catch((err) => {
        if (cancelled) return
        // `not_started` (see `api.ts`'s `toQuizApiError`) is the one rejection that DOES mean
        // something definite — this golfer has never begun, so the quiz screen is right, and
        // `useQuizRun` inside it auto-starts a run rather than needing one to already exist.
        setGate(err instanceof QuizApiError && err.code === 'not_started' ? 'needed' : 'unknown')
      })
    return () => {
      cancelled = true
    }
  }, [active])

  // The gate is read once, when the session starts. Finishing the quiz in THIS session changes
  // the answer and nothing re-asks the server, so the golfer stayed on the result screen until
  // they reloaded. This lets the intake say "done" directly rather than making the reload the
  // only way out.
  return [gate, useCallback(() => setGate('satisfied'), [])]
}

/**
 * Sends a coach OR A PLAYER to the served prototype.
 *
 * Was coach-only, and that was the bug behind "why don't we have the player Dashboard anymore"
 * (2026-09-09). `/proto/dashboard` has never had a coach guard — it already builds the player
 * view (`buildAtlasData(uid, 'today', HIDDEN_FOR_PLAYER)`) and always did. Nothing routed a
 * player to it. A player who finished intake fell through to `<Profile />`, a bare React form,
 * and the only door to their own dashboard was a button on that form labelled "Open the coach
 * dashboard" that opened a new tab. So the player dashboard was built, wired to real data, and
 * unreachable — which reads from the outside as both "the UI is gone" and "the DB is broken."
 *
 * Two steps, and the first is the one that is easy to miss: a browser NAVIGATION cannot carry an
 * Authorization header, so the Firebase ID token has to be exchanged for an httpOnly session
 * cookie (POST /api/session) BEFORE the navigation, or `/proto/dashboard` answers 401 and the
 * user sees a bare error page instead of their dashboard.
 *
 * `location.replace`, not `href`: the SPA is not a place they chose to be, and leaving it in
 * history means their Back button lands on a screen that immediately redirects them forward again.
 * The way back is the "← Atlas" link injected into the page's banner (server/routes/proto.ts).
 */
function CoachDashboardRedirect() {
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/session', { method: 'POST', body: JSON.stringify({}) })
      .then(() => {
        if (!cancelled) window.location.replace('/proto/dashboard')
      })
      // Do not strand them on a spinner. A coach who cannot get a session still has a real
      // account, so fall through to the React screens rather than to nothing.
      .catch(() => {
        if (!cancelled) setFailed('Could not open the coach dashboard.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return (
      <>
        <main className="shell">
          <p className="error">{failed}</p>
        </main>
        <Profile />
      </>
    )
  }
  return (
    <main className="shell">
      <p className="muted">Opening your dashboard…</p>
    </main>
  )
}

/**
 * Honour `/?signout=1`, the served prototype's only way out.
 *
 * A coach is redirected to /proto/dashboard on sign-in. That page is a standalone document with no
 * React, so it cannot call Firebase's signOut itself, and its "← Atlas" link lands on `/` — which
 * redirects a coach straight back. Before this, a coach could not sign out at all.
 *
 * The param is stripped with replaceState so a refresh, or the back button, does not sign the next
 * person out the moment they arrive.
 */
function useSignoutParam(logout: () => Promise<void>, active: boolean): boolean {
  // Read the param during the FIRST render, not in the effect. A coach arriving at /?signout=1 is
  // still signed in for a moment, and `CoachDashboardRedirect` navigates away in its own effect —
  // it won the race and cancelled the in-flight /api/session/end, so the cookie survived and the
  // next person still reached the roster. Measured, not assumed: calling the endpoint by hand
  // cleared the cookie, the same call via the sign-out link did not.
  //
  // Returning `pending` lets Routes suppress that redirect until the sign-out finishes.
  const [pending, setPending] = useState(
    () => new URLSearchParams(window.location.search).get('signout') === '1',
  )

  useEffect(() => {
    if (!pending || !active) return
    // Strip the param first so a refresh or a back-button press does not sign the NEXT person out.
    //
    // `as` SURVIVES the strip. The demo links are `/?as=<email>&signout=1` — signout so the link
    // is deterministic no matter who was signed in before (a stale coach cookie is what made all
    // three demo URLs open the coach dashboard), `as` so Login can prefill the address. Stripping
    // the whole query string killed the prefill and traded one broken entry point for another.
    const keepAs = new URLSearchParams(window.location.search).get('as')
    const rest = keepAs ? `?as=${encodeURIComponent(keepAs)}` : ''
    window.history.replaceState({}, '', `${window.location.pathname}${rest}`)
    void logout().finally(() => setPending(false))
  }, [pending, active, logout])

  return pending
}

function Routes() {
  const { status, error, me, logout } = useAuth()
  const [tab, setTab] = useState<'profile' | 'admin'>('profile')
  const [intakeGate, satisfyIntakeGate] = useIntakeGate(status === 'signed_in')
  const signingOut = useSignoutParam(logout, status === 'signed_in')
  // `?home=1` — the prototype banner's "← Atlas" link, asking to stay in the SPA rather than be
  // bounced straight back to the dashboard.
  //
  // Read once on the first render, because the redirect below runs on EVERY render and reading the
  // live URL would fire it the moment anything stripped the param.
  //
  // ⚠️ But it must be CLEARABLE, and that is the bug this shape fixes (2026-09-10). A player who
  // clicked "← Atlas" and then discovered they still owed an intake did the whole quiz inside a
  // mount where this was latched true — so finishing it returned them to the profile form instead
  // of their dashboard. Completing intake is an explicit "take me in", so `satisfyIntakeGate`
  // clears it below.
  const [wantsSpa, setWantsSpa] = useState(
    () => new URLSearchParams(window.location.search).get('home') === '1',
  )

  // Strip the param so a refresh does not re-latch it after the redirect has been allowed through.
  useEffect(() => {
    if (!wantsSpa) return
    const q = new URLSearchParams(window.location.search)
    if (!q.has('home')) return
    q.delete('home')
    const qs = q.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }, [wantsSpa])

  // Finishing intake overrides an earlier "keep me in the SPA".
  const enterAtlas = useCallback(() => {
    setWantsSpa(false)
    satisfyIntakeGate()
  }, [satisfyIntakeGate])

  switch (status) {
    case 'loading':
      return <main className="shell"><p className="muted">Loading…</p></main>

    case 'signed_out':
      return <Login />

    case 'signed_in': {
      // Roles first, THEN the intake gate — the order is the point.
      //
      // Practice DNA is a golfer's onboarding: it asks your age, your handicap, your shot shape,
      // how you spend your practice week. Gating on it before checking the role marched a COACH
      // through 49 questions about their own game before they could see their students, and an
      // admin through the same before reaching the admin panel. Neither has an intake to complete;
      // the gate is about a player's profile being populated, and it does not describe them.
      //
      // Gate is on the atlas row specifically, same reasoning as isCoach in Profile — a
      // locker_room admin is not an Atlas admin and must not see this tab.
      const isAtlasAdmin = me?.roles.some((r) => r.app === 'atlas' && r.role === 'admin') ?? false
      const isCoach = me?.roles.some((r) => r.app === 'atlas' && r.role === 'coach') ?? false
      const isPlayer = !isAtlasAdmin && !isCoach

      // Checked before the player's screens render — see `useIntakeGate`. `'checking'` shows the
      // same loading shell as auth's own loading state; there is no version of this screen worth
      // flashing between "we don't know yet" and "we know."
      if (isPlayer && intakeGate === 'checking') {
        return <main className="shell"><p className="muted">Loading…</p></main>
      }
      if (isPlayer && intakeGate === 'needed') {
        return <IntakeShell api={intakeApi} onEnterAtlas={enterAtlas} />
      }

      // A COACH LANDS ON LUKE'S DESIGN, not on a React rebuild of it.
      //
      // `proto/Dashboard.dc.html` IS the coach dashboard, and it is already fed real data by
      // server/protoData.ts. Until now the only way to it was a "view the prototype" button buried
      // in Profile.tsx that opened a new tab, while a coach signing in got `<Roster />` — a
      // hand-built screen covering a fraction of the same ground. That is the reinvention this
      // repo exists to avoid, and it is why the app "looks nothing like the HTML demo".
      //
      // Admins keep the SPA, because the admin panel has no prototype and the tab strip is how
      // they reach it. A coach who is also an admin therefore stays here — the narrower role does
      // not get to hijack the wider one's only entry point.
      // `!signingOut`: a coach arriving at /?signout=1 must not be bounced back to the prototype
      // before their sign-out completes — that race is what left the session cookie alive.
      //
      // `!wantsSpa`: "← Atlas" in the prototype banner points at `/`, which used to redirect
      // straight back — a loop that left a coach with no way into the SPA at all. Now that a
      // PLAYER lands on the prototype too, that loop would also be the only thing standing
      // between them and their own profile form, so the banner link carries `?home=1` and this
      // honours it. Same idiom as `?signout=1`, for the same reason: the prototype is a plain
      // document and a query param is the only channel it has back into React.
      if (!isAtlasAdmin && !signingOut && !wantsSpa) {
        return <CoachDashboardRedirect />
      }
      if (signingOut) {
        return <main className="shell"><p className="muted">Signing out…</p></main>
      }
      return (
        <>
          {isAtlasAdmin && (
            <nav className="tabs">
              <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
                Profile
              </button>
              <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
                Admin
              </button>
            </nav>
          )}
          {tab === 'admin' && isAtlasAdmin ? <Admin /> : <Profile />}
        </>
      )
    }

    // Authenticated, but holds no role in 'atlas'. A public.users row DOES now exist — attachUser
    // created it before requireApp refused — so this is the entitlement gate, not a broken account.
    // Shown as its own state because the fix is someone granting access, which no amount of
    // retrying the login will do.
    case 'no_atlas_access':
      return (
        <main className="auth-shell">
          <h1>Almost there</h1>
          <p>
            Your RYP account works, but it doesn’t have Atlas access yet. Ask an administrator to
            add you.
          </p>
          <button onClick={logout}>Sign out</button>
        </main>
      )

    case 'error':
      return (
        <main className="auth-shell">
          <h1>Couldn’t load your account</h1>
          <p className="error">{error}</p>
          <button onClick={logout}>Sign out</button>
        </main>
      )
  }
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  )
}
