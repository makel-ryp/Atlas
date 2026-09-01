import { formatHandicapIndex } from '../../../shared/handicap'
import { useState } from 'react'
import { useAuth } from '../lib/authContext'
import { ProfileForm } from './ProfileForm'
import { Roster } from './Roster'
import { apiFetch } from '../lib/api'

/**
 * The player's own record, in Luke's screen structure (`Dashboard.dc.html:isToday`): a mono eyebrow
 * at 0.28em, an Archivo-800 headline, a Newsreader subhead, then the numbers as stat blocks.
 *
 * Every value comes from `ryp-core`. Nothing on this screen is sample data, which is why the empty
 * states say "not set" rather than showing a plausible figure — on a screen whose whole claim is
 * that the numbers are real, a placeholder that looks like data is the one thing that breaks it.
 */
export function Profile() {
  const { me, logout, refresh } = useAuth()
  const [editing, setEditing] = useState(false)
  if (!me) return null

  const { user, roles, profile } = me
  const isCoach = roles.some((r) => r.app === 'atlas' && (r.role === 'coach' || r.role === 'admin'))
  const first = (user.displayName ?? user.email).split(/[\s@]/)[0]

  return (
    <main className="shell">
      <div className="row" style={{ marginBottom: '2rem' }}>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">
            {user.plan === 'free' ? 'Atlas · free' : `Atlas · ${user.plan}`}
          </div>
          <h1 className="hero-h1">{user.displayName ?? user.email}</h1>
          <p className="hero-sub">
            {profile
              ? 'Your record. Every number here came out of the database, not a mock.'
              : 'Your record is empty. Add your numbers and they become the ones every RYP app reads.'}
          </p>
        </div>
        <button onClick={logout}>Sign out</button>
      </div>

      <section>
        <div className="row">
          <h2>Golf profile</h2>
          <button className="link" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editing ? (
          <ProfileForm
            me={me}
            onSaved={async () => {
              await refresh()
              setEditing(false)
            }}
          />
        ) : profile ? (
          <div className="card">
            <div className="stat-row">
              <span>
                <span className="stat-label">Handicap index</span>
                {/* Golf convention: a better-than-scratch index is stored negative and PRINTED
                    with a plus. formatHandicapIndex owns that flip — see shared/handicap.ts. */}
                <span className="stat-value big gold">
                  {formatHandicapIndex(profile.handicapIndex) ?? '—'}
                </span>
              </span>
              <span>
                <span className="stat-label">Driver carry</span>
                <span className="stat-value big">
                  {profile.driverCarryYds ?? '—'}
                  {profile.driverCarryYds ? <span className="stat-label"> yds</span> : null}
                </span>
              </span>
              <span>
                <span className="stat-label">Handedness</span>
                <span className="stat-value">{profile.handedness ?? 'not set'}</span>
              </span>
              <span>
                <span className="stat-label">GHIN</span>
                <span className="stat-value">{profile.ghinNumber ?? 'not set'}</span>
              </span>
            </div>
          </div>
        ) : (
          <p className="hero-sub">No golf profile yet. Choose Edit to add one.</p>
        )}
      </section>

      {isCoach && (
        <section>
          <Roster />
          <OpenPrototype />
        </section>
      )}

      <section>
        <h2>Identity</h2>
        <div className="stat-row">
          <span>
            <span className="stat-label">App access</span>
            <span className="stat-value">
              {roles.length ? roles.map((r) => `${r.app}:${r.role}`).join(' · ') : 'none'}
            </span>
          </span>
          <span>
            <span className="stat-label">Member since</span>
            <span className="stat-value">
              {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
            </span>
          </span>
          <span>
            <span className="stat-label">Atlas user id</span>
            <span className="stat-value absent">{user.id}</span>
          </span>
        </div>
      </section>
    </main>
  )
}

/**
 * Opens Luke's actual coach dashboard with this coach's real students injected server-side.
 *
 * Two steps, and the first is the one that is easy to miss: a browser NAVIGATION cannot carry an
 * Authorization header, so the Firebase ID token is first exchanged for an httpOnly session cookie
 * (POST /api/session). Only then can a plain link to a server-rendered page be authenticated.
 */
function OpenPrototype() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/session', { method: 'POST', body: JSON.stringify({}) })
      window.open('/proto/dashboard', '_blank')
    } catch {
      setError('Could not start a session for the dashboard.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <button onClick={open} disabled={busy}>
        {busy ? 'Opening…' : 'Open the coach dashboard'}
      </button>
      <p className="small muted">
        Luke\'s design, served as-is, with your real students injected. The page banner says which
        numbers are live and which are still his sample data.
      </p>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
