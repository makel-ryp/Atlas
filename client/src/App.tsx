import { useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './lib/authContext'
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
      // Checked before anything else renders — see `useIntakeGate`. `'checking'` shows the same
      // loading shell as auth's own loading state; there is no version of this screen worth
      // flashing between "we don't know yet" and "we know."
      if (intakeGate === 'checking') {
        return <main className="shell"><p className="muted">Loading…</p></main>
      }
      if (intakeGate === 'needed') {
        return <IntakeShell api={intakeApi} onEnterAtlas={satisfyIntakeGate} />
      }

      // Gate is on the atlas row specifically, same reasoning as isCoach in Profile — a
      // locker_room admin is not an Atlas admin and must not see this tab.
      const isAtlasAdmin = me?.roles.some((r) => r.app === 'atlas' && r.role === 'admin') ?? false
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
