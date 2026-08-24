import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import type { Student } from '../lib/types'

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
        </li>
      ))}
    </ul>
  )
}
