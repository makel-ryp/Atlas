import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import type { CoachingNote, Student } from '../lib/types'

// One sentence per code the notes UI can receive, so an error reads as English instead of a raw
// API error code. Anything unlisted falls back to a generic line rather than showing 'undefined'.
const NOTE_ERROR_MESSAGES: Record<string, string> = {
  not_your_student: 'This student has not approved you as a coach, so the note was refused.',
  invalid_body: 'That note could not be saved — check the text and try again.',
  note_not_found: 'That note is no longer editable.',
}

function noteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return NOTE_ERROR_MESSAGES[err.code] ?? 'Something went wrong saving that note.'
  return 'Something went wrong saving that note.'
}

// One student's notes: the toggle, the list, and (when allowed) the compose box. Kept as its own
// component rather than inlined in the list item so each student's notes/compose state is its own
// set of hooks, not one big map keyed by userId in the parent.
function StudentNotes({ student }: { student: Student }) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState<CoachingNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftBody, setDraftBody] = useState('')
  const [draftVisibility, setDraftVisibility] = useState<CoachingNote['visibility']>('coaching_team')
  const [saving, setSaving] = useState(false)

  function load() {
    setError(null)
    apiFetch<CoachingNote[]>(`/api/coach/students/${student.userId}/notes`)
      .then(setNotes)
      .catch((err) => setError(noteErrorMessage(err)))
  }

  useEffect(() => {
    if (expanded && notes === null) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/api/coach/students/${student.userId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: draftBody.trim(), visibility: draftVisibility }),
      })
      setDraftBody('')
      // Refetch rather than append locally — the server, not this form, decides the row's real
      // shape (id, createdAt, author name), and a note that RLS then hides from a future read
      // should not linger in local state pretending it is still there.
      load()
    } catch (err) {
      setError(noteErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="notes">
      <button className="link" onClick={() => setExpanded((v) => !v)}>
        Notes {notes ? `(${notes.length})` : ''}
      </button>

      {expanded && (
        <div className="notes-panel">
          {error && <p className="error small">{error}</p>}

          {notes === null ? (
            <p className="muted small">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="muted small">No notes yet.</p>
          ) : (
            <ul className="note-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <div className="row">
                    <span className="small">
                      {n.authorDisplayName ?? 'Unknown'} ·{' '}
                      {new Date(n.createdAt).toLocaleDateString()}
                    </span>
                    <span className="chip">{n.visibility}</span>
                  </div>
                  <p className="small">{n.body}</p>
                </li>
              ))}
            </ul>
          )}

          {/* A pending student cannot be written about — atlas.coaching_notes_insert requires an
              APPROVED relationship, so the database would refuse this write every time. Offering
              the control anyway would be a button that always fails; the muted line says why it's
              missing instead of leaving a silent gap where the compose box usually is. */}
          {student.status === 'pending' ? (
            <p className="muted small withheld">
              Notes unlock once {student.displayName ?? 'this player'} approves you.
            </p>
          ) : (
            <div className="note-compose">
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="Add a note…"
                rows={3}
              />
              <div className="row">
                <select
                  value={draftVisibility}
                  onChange={(e) => setDraftVisibility(e.target.value as CoachingNote['visibility'])}
                >
                  <option value="coaching_team">coaching_team</option>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
                <button onClick={save} disabled={draftBody.trim().length === 0 || saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// The coach's students. Only rendered for a coach, but safe for anyone to call — a player gets an
// empty array, because RLS finds them no students rather than the route forbidding the request.
export function Roster() {
  const [students, setStudents] = useState<Student[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Student[]>('/api/coach/students')
      .then(setStudents)
      .catch(() => setError('Could not load your students.'))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!students) return <p className="muted">Loading…</p>
  if (students.length === 0) return <p className="muted">No students yet.</p>

  return (
    <ul className="students">
      {students.map((s) => (
        <li key={s.userId}>
          <div className="row">
            <strong>{s.displayName ?? s.email}</strong>
            <span className={s.status === 'active' ? 'tag' : 'tag pending'}>
              {s.status === 'active'
                ? s.source === 'academy'
                  ? (s.orgName ?? 'academy')
                  : 'approved'
                : 'awaiting approval'}
            </span>
          </div>

          {s.profile ? (
            <p className="muted small">
              {s.profile.handicapIndex ?? '—'} hcp · {s.profile.driverCarryYds ?? '—'} yds ·{' '}
              {s.profile.handedness ?? '—'}
            </p>
          ) : (
            <p className="muted small">no profile yet</p>
          )}

          {/* null is not the same as an empty list, and saying so is the honest version: the data
              exists, this coach is not cleared to see it. Drawing a blank chart would read as
              "this student has no history", which is a different and false claim. */}
          {s.handicapTrend === null ? (
            <p className="muted small withheld">
              Metrics hidden until {s.displayName ?? 'this player'} approves you
            </p>
          ) : s.handicapTrend.length === 0 ? (
            <p className="muted small">No handicap history recorded yet</p>
          ) : (
            <p className="small">
              Handicap history:{' '}
              {s.handicapTrend
                .map((t) => `${t.handicapIndex} (${new Date(t.recordedAt).toLocaleDateString()})`)
                .join(' → ')}
            </p>
          )}

          <StudentNotes student={s} />
        </li>
      ))}
    </ul>
  )
}
