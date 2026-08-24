import { useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import type { Me, PlayerProfile } from '../lib/types'

// Text state, not numbers: an <input> is a string, and parsing on every keystroke makes "1." and a
// half-typed "-" unrepresentable. Parsed once on submit, where a bad value can be reported.
interface Draft {
  displayName: string
  handicapIndex: string
  driverCarryYds: string
  handedness: string
  ghinNumber: string
}

function draftFrom(me: Me): Draft {
  return {
    displayName: me.user.displayName ?? '',
    handicapIndex: me.profile?.handicapIndex ?? '',
    driverCarryYds: me.profile?.driverCarryYds?.toString() ?? '',
    handedness: me.profile?.handedness ?? 'right',
    ghinNumber: me.profile?.ghinNumber ?? '',
  }
}

// '' means "cleared" -> null, which the API accepts and stores. Undefined would mean "unchanged",
// and the two must not collapse or clearing a field would silently do nothing.
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

export function ProfileForm({ me, onSaved }: { me: Me; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(me))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setDraft((d) => ({ ...d, [k]: e.target.value }))
    setSaved(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)

    const hcp = orNull(draft.handicapIndex)
    const carry = orNull(draft.driverCarryYds)
    // Checked here as well as server-side. The server is the authority — this only spares the user a
    // round trip and a 400 whose message is a zod issue array.
    if (hcp !== null && Number.isNaN(Number(hcp))) {
      setError('Handicap index must be a number.')
      setBusy(false)
      return
    }
    if (carry !== null && !/^\d+$/.test(carry)) {
      setError('Driver carry must be a whole number of yards.')
      setBusy(false)
      return
    }

    try {
      await apiFetch<{ profile: PlayerProfile | null }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: orNull(draft.displayName),
          handicapIndex: hcp === null ? null : Number(hcp),
          driverCarryYds: carry === null ? null : Number(carry),
          handedness: draft.handedness,
          ghinNumber: orNull(draft.ghinNumber),
        }),
      })
      // Refetch rather than trusting the local draft: the row that matters is the one the database
      // returns, and on a demo screen whose whole claim is "these numbers are real", showing an
      // optimistic value would be the one place it stops being true.
      await onSaved()
      setSaved(true)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'Some values were rejected. Check the handicap and carry figures.'
          : 'Could not save. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="edit">
      <label>
        Display name
        <input value={draft.displayName} onChange={set('displayName')} maxLength={120} />
      </label>
      <label>
        Handicap index
        <input value={draft.handicapIndex} onChange={set('handicapIndex')} inputMode="decimal" />
      </label>
      <label>
        Driver carry (yds)
        <input value={draft.driverCarryYds} onChange={set('driverCarryYds')} inputMode="numeric" />
      </label>
      <label>
        Handedness
        <select value={draft.handedness} onChange={set('handedness')}>
          <option value="right">right</option>
          <option value="left">left</option>
        </select>
      </label>
      <label>
        GHIN
        <input value={draft.ghinNumber} onChange={set('ghinNumber')} maxLength={32} />
      </label>

      {/* `plan` is deliberately absent. It is refused by the request schema AND by atlas_app's
          column-level UPDATE grant on public.users — a paid tier is billing's to write. */}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="muted">Saved</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  )
}
