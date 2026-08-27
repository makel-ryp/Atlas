import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/authContext'
import { Login } from './components/Login'
import { Profile } from './components/Profile'
import { Admin } from './components/Admin'

function Routes() {
  const { status, error, me, logout } = useAuth()
  const [tab, setTab] = useState<'profile' | 'admin'>('profile')

  switch (status) {
    case 'loading':
      return <main className="shell"><p className="muted">Loading…</p></main>

    case 'signed_out':
      return <Login />

    case 'signed_in': {
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
