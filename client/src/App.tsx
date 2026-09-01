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
 * Sends a coach to the served prototype.
 *
 * Two steps, and the first is the one that is easy to miss: a browser NAVIGATION cannot carry an
 * Authorization header, so the Firebase ID token has to be exchanged for an httpOnly session
 * cookie (POST /api/session) BEFORE the navigation, or `/proto/dashboard` answers 401 and the
 * coach sees a bare error page instead of their roster.
 *
 * `location.replace`, not `href`: the SPA is not a place the coach chose to be, and leaving it in
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

function Routes() {
  const { status, error, me, logout } = useAuth()
  const [tab, setTab] = useState<'profile' | 'admin'>('profile')
  const [intakeGate, satisfyIntakeGate] = useIntakeGate(status === 'signed_in')

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
        return <IntakeShell api={intakeApi} onEnterAtlas={satisfyIntakeGate} />
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
      if (isCoach && !isAtlasAdmin) {
        return <CoachDashboardRedirect />
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
