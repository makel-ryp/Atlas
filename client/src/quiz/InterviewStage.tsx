/**
 * THE INTERVIEW — the five free-text questions Luke's profile page has always rendered and
 * nothing ever asked.
 *
 * The page said so itself, in the copy a coach saw on every student: *"No intake answers on record
 * for this player. The intake form is not yet wired to a table, so nothing has been collected."*
 * This stage is the collection; `atlas.intake_submissions.interview` is the table.
 *
 * ── Why one page rather than one-question-at-a-time ───────────────────────────────────────────
 * `ProfileStage` steps through its fields because they are single values with an obvious right
 * answer and tapping one can advance you. These are paragraphs. A golfer writing an injury
 * history wants to see what they already wrote, and being marched through five prose prompts one
 * screen at a time reads like a form rather than an interview. Luke's own profile page renders
 * all five stacked, so this matches the surface the answers end up on.
 *
 * ── Why nothing is required except `goal` ─────────────────────────────────────────────────────
 * "No injuries" is a real answer and an empty box is the honest way to give it. Only `goal` gates
 * Continue, because it is the one question nobody legitimately leaves blank, and `stages.ts`
 * keys the stage on the same field — so a golfer cannot be bounced back here by a rule that
 * disagrees with the one that let them leave.
 */
import { useState } from 'react'
import { INTERVIEW_FIELDS, INTERVIEW_MAX_LEN, type InterviewKey } from '../../../shared/interview'

export function InterviewStage({
  busy,
  initial,
  onDone,
}: {
  busy: boolean
  /** Answers already stored, so a resumed run shows what was written rather than blank boxes. */
  initial?: Partial<Record<InterviewKey, string>>
  onDone: (interview: Partial<Record<InterviewKey, string>>) => void
}) {
  const [draft, setDraft] = useState<Partial<Record<InterviewKey, string>>>(initial ?? {})

  // Widened to cover both controls: `target` renders as an <input>, the other five as <textarea>.
  const set = (k: InterviewKey) =>
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [k]: e.target.value.slice(0, INTERVIEW_MAX_LEN) }))

  const canContinue = !!draft.goal?.trim() && !busy

  return (
    <div className="quiz-root">
      <div className="mx-auto max-w-2xl">
        <p className="mb-1 text-sm uppercase tracking-widest text-muted">The interview</p>
        <h2 className="mb-2 text-2xl font-bold tracking-tight">
          Now the part a form cannot score.
        </h2>
        <p className="mb-8 text-muted">
          Five questions, in your own words. Your coach reads these before they write anything —
          so answer them the way you would say them out loud, not the way you think they should
          sound.
        </p>

        <div className="flex flex-col gap-7">
          {INTERVIEW_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="font-medium">{f.label}</span>
              <span className="text-sm text-muted">{f.hint}</span>
              {/* `target` is the one field that is a number, not prose — it is reconciled into
                  golf.player_profile.target_handicap on completion. A textarea invites a sentence,
                  and a sentence fails parseHandicapIndex and silently sets no target. inputMode
                  "decimal" so phones open the number pad; type stays "text" because a golfer writes
                  a plus handicap as "+2" and type="number" rejects the leading plus. */}
              {f.options ? (
                /* tier and phase are CHOICES, not prose — the prototype indexes
                   TIERS[tier].phases[phase] directly, so a free-text answer is a crash rather
                   than a bad display. A select also states the three intensities and their hours
                   up front, which is the actual question being asked. */
                <select
                  value={draft[f.key] ?? ''}
                  onChange={set(f.key)}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-ink/20 bg-transparent px-3 py-2 leading-relaxed disabled:opacity-50"
                >
                  <option value="">Not sure yet</option>
                  {f.options.map((o, i) => (
                    <option key={o} value={o}>
                      {f.optionLabels?.[i] ?? o}
                    </option>
                  ))}
                </select>
              ) : f.key === 'target' ? (
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 8, or +2 if you are better than scratch"
                  value={draft[f.key] ?? ''}
                  onChange={set(f.key)}
                  disabled={busy}
                  maxLength={6}
                  className="mt-1 w-full rounded-lg border border-ink/20 bg-transparent px-3 py-2 leading-relaxed disabled:opacity-50"
                />
              ) : (
                <textarea
                  value={draft[f.key] ?? ''}
                  onChange={set(f.key)}
                  disabled={busy}
                  rows={f.key === 'limits' || f.key === 'sport' ? 3 : 2}
                  maxLength={INTERVIEW_MAX_LEN}
                  className="mt-1 w-full resize-y rounded-lg border border-ink/20 bg-transparent px-3 py-2 leading-relaxed disabled:opacity-50"
                />
              )}
            </label>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-end gap-4">
          {!draft.goal?.trim() && (
            <span className="text-sm text-muted">
              “Why you are here” is the one we need.
            </span>
          )}
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => onDone(draft)}
            className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
