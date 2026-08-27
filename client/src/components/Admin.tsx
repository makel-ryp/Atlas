import { useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import type { AdminUser, AdminOrg, AuditRow } from '../lib/types'

// Server error codes mapped to a sentence a demo audience can read, not a stack trace. Anything not
// in this map still shows the code itself rather than going blank — an unmapped code is a bug in this
// map, not a reason to hide the error.
const ERROR_SENTENCES: Record<string, string> = {
  not_admin_of_app: 'You administer Atlas, not that app — its own admins have to grant this role.',
  cannot_modify_own_admin_role: 'You cannot change your own admin role.',
  invalid_body: 'That reason (or field) did not pass validation.',
  not_signed_in: 'Your session expired — sign in again.',
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return ERROR_SENTENCES[err.code] ?? `${err.code} (${err.status})`
  return 'Something went wrong.'
}

// The one page an admin needs for the 7 Sep demo: find a kid, put them on an academy roster, and
// show the row that proves it happened. Three sections on one scroll — no sub-routing, per the spec,
// because a demo audience should never wonder whether a click changed the URL and lost their place.
export function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null)
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // The active search lives here rather than only in UsersSection, so a post-mutation refetch
  // reuses it. Calling loadUsers() with no argument after an assignment would otherwise wipe the
  // admin's search out from under them.
  const lastQuery = useRef('')

  const loadUsers = (q = lastQuery.current) => {
    lastQuery.current = q
    return apiFetch<AdminUser[]>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then(setUsers)
      .catch((err) => setListError(describeError(err)))
  }

  const loadOrgs = () =>
    apiFetch<AdminOrg[]>('/api/admin/orgs')
      .then(setOrgs)
      .catch((err) => setListError(describeError(err)))

  const loadAudit = () =>
    apiFetch<AuditRow[]>('/api/admin/audit?limit=100')
      .then(setAudit)
      .catch((err) => setListError(describeError(err)))

  useEffect(() => {
    loadUsers()
    loadOrgs()
    loadAudit()
  }, [])

  // Users AND audit, never audit alone — this was a real bug caught only by clicking through it.
  // An org-membership change alters `users[].orgs`, which is where each academy's member list is
  // derived from. Refetching just the orgs list moved the member COUNT while the LIST stayed stale,
  // so the screen read "1 members" with nothing listed. Typecheck and build both passed on that.
  const refreshAfterMutation = async () => {
    await Promise.all([loadUsers(), loadAudit()])
  }

  return (
    <main className="shell admin-shell">
      <header className="row">
        <h1>Admin</h1>
      </header>
      {listError && <p className="error">{listError}</p>}

      <UsersSection users={users} orgs={orgs} onReload={loadUsers} onMutated={refreshAfterMutation} />
      <OrgsSection orgs={orgs} users={users} onReload={loadOrgs} onMutated={refreshAfterMutation} />
      <AuditSection audit={audit} />
    </main>
  )
}

function UsersSection({
  users,
  orgs,
  onReload,
  onMutated,
}: {
  users: AdminUser[] | null
  orgs: AdminOrg[] | null
  onReload: (q?: string) => Promise<void>
  onMutated: () => Promise<void>
}) {
  const [q, setQ] = useState('')

  return (
    <section>
      <h2>Users</h2>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          onReload(q)
        }}
      >
        <input
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {!users ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="muted">No users match.</p>
      ) : (
        <ul className="admin-users">
          {users.map((u) => (
            <UserRow key={u.id} user={u} orgs={orgs} onMutated={onMutated} onReload={() => onReload(q)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function UserRow({
  user,
  onMutated,
  onReload,
}: {
  user: AdminUser
  orgs: AdminOrg[] | null
  onMutated: () => Promise<void>
  onReload: () => Promise<void>
}) {
  const [role, setRole] = useState('user')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grant = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/api/admin/users/${user.id}/app-roles`, {
        method: 'POST',
        body: JSON.stringify({ app: 'atlas', role, reason }),
      })
      setReason('')
      await Promise.all([onReload(), onMutated()])
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li>
      <div className="row">
        <div>
          <strong>{user.displayName ?? user.email}</strong> <span className="muted">{user.email}</span>
        </div>
        <span className="muted">{user.plan}</span>
      </div>

      <div className="chips">
        {user.appRoles.map((r) => (
          <span key={`${r.app}:${r.role}`} className={r.revoked ? 'chip revoked' : 'chip'}>
            {r.app}:{r.role}
          </span>
        ))}
        {user.orgs.map((o) => (
          <span key={o.orgId} className="chip org">
            {o.orgName} ({o.role})
          </span>
        ))}
      </div>

      <div className="grant-role">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="user">user</option>
          <option value="coach">coach</option>
          <option value="admin">admin</option>
        </select>
        <input
          placeholder="reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button disabled={busy || !reason} onClick={grant}>
          Grant Atlas role
        </button>
      </div>
      {/* Granting roles for other apps is refused by the database (not_admin_of_app), and that app's
          own admin is the right place to do it — building a UI for a request the API will reject
          would just move the confusion here. */}
      <p className="muted small">Only Atlas roles can be granted here — other apps refuse the grant.</p>
      {error && <p className="error small">{error}</p>}
    </li>
  )
}

function OrgsSection({
  orgs,
  users,
  onReload,
  onMutated,
}: {
  orgs: AdminOrg[] | null
  users: AdminUser[] | null
  onReload: () => Promise<void>
  onMutated: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('academy')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/admin/orgs', {
        method: 'POST',
        body: JSON.stringify({ name, type, reason }),
      })
      setName('')
      setReason('')
      await Promise.all([onReload(), onMutated()])
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2>Academies</h2>

      <div className="grant-role">
        <input placeholder="Academy name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="academy">academy</option>
          <option value="university">university</option>
          <option value="team">team</option>
        </select>
        <input
          placeholder="reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button disabled={busy || !name || !reason} onClick={create}>
          Create academy
        </button>
      </div>
      {error && <p className="error small">{error}</p>}

      {!orgs ? (
        <p className="muted">Loading…</p>
      ) : orgs.length === 0 ? (
        <p className="muted">No academies yet.</p>
      ) : (
        <ul className="admin-orgs">
          {orgs.map((o) => (
            <OrgRow key={o.id} org={o} users={users} onMutated={onMutated} onReload={onReload} />
          ))}
        </ul>
      )}
    </section>
  )
}

function OrgRow({
  org,
  users,
  onMutated,
  onReload,
}: {
  org: AdminOrg
  users: AdminUser[] | null
  onMutated: () => Promise<void>
  onReload: () => Promise<void>
}) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('member')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Members of THIS org, drawn from the already-loaded users list rather than a second fetch —
  // there is no GET /admin/orgs/:id/members endpoint, and for a four-account demo one fetch is
  // plenty. The catch is that a SEARCH narrows `users`, so this list can then show fewer people
  // than memberCount claims. Rather than let those two silently disagree on screen, the mismatch is
  // stated below. If this list ever needs to stand alone, the fix is that endpoint, not more
  // client-side reconciliation.
  const members = (users ?? []).flatMap((u) =>
    u.orgs.filter((o) => o.orgId === org.id).map((o) => ({ user: u, role: o.role })),
  )
  const listIsPartial = members.length < org.memberCount + org.coachCount

  const addMember = async () => {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/api/admin/orgs/${org.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId, role, reason }),
      })
      setReason('')
      await Promise.all([onReload(), onMutated()])
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  // Reuses the row's own reason input rather than window.prompt. A native dialog is browser chrome
  // that looks nothing like the app, it cannot be styled, and it stops the page dead — not something
  // to hit in front of an audience. Remove is disabled until a reason is typed, which also makes the
  // required-reason rule visible instead of surfacing as a 400.
  const removeMember = async (memberUserId: string) => {
    if (!reason.trim()) return
    setError(null)
    try {
      await apiFetch(`/api/admin/orgs/${org.id}/members/${memberUserId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      })
      setReason('')
      await Promise.all([onReload(), onMutated()])
    } catch (err) {
      setError(describeError(err))
    }
  }

  return (
    <li className="org-card">
      <div className="row">
        <strong>{org.name}</strong>
        <span className="muted">
          {org.type} · {org.memberCount} members · {org.coachCount} coaches
        </span>
      </div>

      {listIsPartial && (
        <p className="muted small">
          Showing {members.length} of {org.memberCount + org.coachCount} — clear the search above to
          see the rest.
        </p>
      )}

      {members.length > 0 && (
        <ul className="org-members">
          {members.map(({ user, role: memberRole }) => (
            <li key={user.id}>
              <span>
                {user.displayName ?? user.email} <span className="muted">{memberRole}</span>
              </span>
              <button
                className="link"
                disabled={!reason.trim()}
                title={reason.trim() ? 'Remove from this academy' : 'Type a reason below first'}
                onClick={() => removeMember(user.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The assign-to-academy control the demo hinges on: pick a kid already loaded from Users
          above, pick a role, give a reason, done. */}
      <div className="assign-member">
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Assign a user…</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ?? u.email}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="coach">coach</option>
          <option value="admin">admin</option>
        </select>
        <input
          placeholder="reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button disabled={busy || !userId || !reason} onClick={addMember}>
          Assign to academy
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </li>
  )
}

function AuditSection({ audit }: { audit: AuditRow[] | null }) {
  return (
    <section>
      <h2>Audit trail</h2>
      {!audit ? (
        <p className="muted">Loading…</p>
      ) : audit.length === 0 ? (
        <p className="muted">Nothing recorded yet.</p>
      ) : (
        <table className="audit">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Change</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.actorDisplayName ?? a.actorUserId}</td>
                <td>
                  {a.entity}
                  {a.field ? ` / ${a.field}` : ''}
                </td>
                <td className="mono">
                  {a.oldValue ?? '—'} → {a.newValue ?? '—'}
                </td>
                {/* Not truncated: the reason is the point of the whole audit trail, and a clipped
                    sentence here would defeat it. */}
                <td>{a.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
