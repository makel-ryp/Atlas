import { useState } from 'react'
import { useAuth } from '../lib/authContext'
import { ProfileForm } from './ProfileForm'
import { Roster } from './Roster'

// Every value on this screen comes from ryp-core over /api/users/me. Nothing here is hardcoded or
// sampled — which is the point of the demo, and the reason anything that IS sample data elsewhere
// has to be labelled as such.
export function Profile() {
  const { me, logout, refresh } = useAuth()
  const [editing, setEditing] = useState(false)
  if (!me) return null

  const { user, roles, profile } = me
  // Roles are per app, so "am I a coach" is a question about the atlas row specifically — a
  // locker_room coach is not an Atlas coach.
  const isCoach = roles.some((r) => r.app === 'atlas' && (r.role === 'coach' || r.role === 'admin'))

  return (
    <main className="shell">
      <header className="row">
        <div>
          <h1>{user.displayName ?? user.email}</h1>
          <p className="muted">{user.email}</p>
        </div>
        <button onClick={logout}>Sign out</button>
      </header>

      <section>
        <h2>Identity</h2>
        <dl>
          <Field label="Plan" value={user.plan} />
          <Field label="Atlas user ID" value={user.id} mono />
          <Field
            label="Member since"
            value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : null}
          />
        </dl>
      </section>

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
          <dl>
            {/* handicapIndex stays a string end to end: it is numeric in Postgres, and parsing it
                into a JS float to re-render it can only lose precision. */}
            <Field label="Handicap index" value={profile.handicapIndex} />
            <Field
              label="Driver carry"
              value={profile.driverCarryYds ? `${profile.driverCarryYds} yds` : null}
            />
            <Field label="Handedness" value={profile.handedness} />
            <Field label="GHIN" value={profile.ghinNumber} />
          </dl>
        ) : (
          <p className="muted">No golf profile yet. Choose Edit to add one.</p>
        )}
      </section>

      {isCoach && (
        <section>
          <h2>My students</h2>
          <Roster />
        </section>
      )}

      <section>
        <h2>App access</h2>
        {roles.length ? (
          <ul className="roles">
            {roles.map((r) => (
              <li key={`${r.app}:${r.role}`}>
                <strong>{r.app}</strong> <span className="muted">{r.role}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No app access granted.</p>
        )}
      </section>
    </main>
  )
}

// A null value is shown as "not set" rather than blank: an empty cell reads as a failed load, and
// on a screen whose whole claim is "these numbers are real" that distinction matters.
function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value ?? <span className="muted">not set</span>}</dd>
    </>
  )
}
