import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import type { Student, CoachingNote } from '../lib/types'

const NOTE_ERRORS: Record<string, string> = {
  not_your_student: 'You can only write notes on a student who has approved you.',
  invalid_body: 'That note was rejected — check the length.',
  note_not_found: 'That note no longer exists.',
}
const noteError = (err: unknown) =>
  err instanceof ApiError ? (NOTE_ERRORS[err.code] ?? `Failed (${err.code}).`) : 'Failed.'

const initials = (name: string | null, email: string) =>
  (name ?? email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/**
 * The coach roster, in Luke's own row structure (`Dashboard.dc.html:479-530`): avatar, name in
 * Newsreader, then fixed-width stat columns of a mono micro-label over an Archivo-800 value.
 *
 * ⚠️ His row has columns we have no producer for — Total SG, the five-read sparkline, tier, zone,
 * last-log recency. Those render as `absent`, in mono, deliberately: a 0 or a dash styled like a
 * number is inventing data, and this screen's entire claim is that its numbers are real. The slot
 * stays visible so the shape of the design is honest about what is missing.
 */
export function Roster() {
  const [students, setStudents] = useState<Student[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Student[]>('/api/coach/students')
      .then(setStudents)
      .catch(() => setError('Could not load your students.'))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!students) return <p className="hero-sub">Loading…</p>

  return (
    <div>
      <div className="eyebrow coach">Coach view · {students.length}</div>
      <h1 className="hero-h1">Who needs you today.</h1>
      <p className="hero-sub">
        Sorted by who is waiting on you, not by handicap. A player who hasn’t approved you yet shows
        their card and nothing else.
      </p>

      {students.length === 0 ? (
        <p className="hero-sub">No students yet.</p>
      ) : (
        <ul className="roster">
          {[...students]
            // Pending first: the row that needs an action from someone comes before the ones that don't.
            .sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0))
            .map((s) => (
              <StudentRow key={s.userId} student={s} />
            ))}
        </ul>
      )}
    </div>
  )
}

function StudentRow({ student: s }: { student: Student }) {
  const [open, setOpen] = useState(false)
  const trendPoints = s.handicapTrend?.length ?? 0

  return (
    <li className={s.status === 'active' ? undefined : 'pending'}>
      <span className="avatar">{initials(s.displayName, s.email)}</span>

      <span className="roster-name">
        <span style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
          <b>{s.displayName ?? s.email}</b>
          <span className={s.status === 'active' ? 'tag' : 'tag pending'}>
            {s.status === 'active'
              ? s.source === 'academy'
                ? (s.orgName ?? 'academy')
                : 'approved'
              : 'awaiting approval'}
          </span>
        </span>
        <span className="roster-meta">
          {s.source === 'academy' ? 'Academy' : 'Direct'} · {s.profile?.handedness ?? '—'}
        </span>
      </span>

      <span className="col">
        <span className="stat-label">Hcp</span>
        <span className="stat-value">{s.profile?.handicapIndex ?? '—'}</span>
      </span>

      <span className="col">
        <span className="stat-label">Carry</span>
        <span className="stat-value">{s.profile?.driverCarryYds ?? '—'}</span>
      </span>

      {/* Total SG and the sparkline are his design and have no producer yet — Forge and Red own
          them, at M2 and beyond. Named, not faked. */}
      <span className="col">
        <span className="stat-label">Total SG</span>
        <span className="stat-value absent">no producer</span>
      </span>

      <span className="col wide">
        <span className="stat-label">Handicap trail</span>
        <span className="stat-value">
          {s.handicapTrend === null ? (
            <span className="stat-value absent">withheld</span>
          ) : trendPoints === 0 ? (
            <span className="stat-value absent">none yet</span>
          ) : (
            `${trendPoints} pt${trendPoints === 1 ? '' : 's'}`
          )}
        </span>
      </span>

      <span className="col wide">
        <button className="link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide notes' : 'Notes'}
        </button>
      </span>

      {open && (
        <div style={{ flex: '1 1 100%' }}>
          <StudentNotes student={s} />
        </div>
      )}
    </li>
  )
}

function StudentNotes({ student: s }: { student: Student }) {
  const [notes, setNotes] = useState<CoachingNote[] | null>(null)
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('coaching_team')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    apiFetch<CoachingNote[]>(`/api/coach/students/${s.userId}/notes`)
      .then(setNotes)
      .catch((err) => setError(noteError(err)))

  useEffect(() => {
    load()
  }, [s.userId])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/api/coach/students/${s.userId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body, visibility }),
      })
      setBody('')
      await load()
    } catch (err) {
      setError(noteError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notes-panel">
      {notes === null ? (
        <p className="small muted">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="small muted">No notes yet.</p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <span className="roster-meta" style={{ marginTop: 0 }}>
                {n.authorDisplayName ?? 'Unknown'} ·{' '}
                {n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ''}
              </span>
              <p className="stat-prose" style={{ margin: '6px 0 0' }}>
                {n.body}
              </p>
              <span className="chip">{n.visibility.replace('_', ' ')}</span>
            </li>
          ))}
        </ul>
      )}

      {/* No compose box for a pending student: the database refuses the write, so the control would
          be a button that always fails. Say why instead. */}
      {s.status === 'active' ? (
        <div className="note-compose">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note…"
            maxLength={4000}
          />
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="coaching_team">coaching team</option>
            <option value="private">private</option>
            <option value="shared">shared with player</option>
          </select>
          <button onClick={save} disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <p className="small muted withheld">
          Notes unlock once {s.displayName ?? 'this player'} approves you.
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
