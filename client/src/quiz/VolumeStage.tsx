/**
 * "YOUR PRACTICE WEEK" — three screens, one save.
 *
 *   1. full-swing minutes per week   (typed, with quick-tap presets)
 *   2. hours on the course per week  (typed, decimals ok)
 *   3. the allocation bar            (§4c)
 *
 * One stage rather than three because `saveVolume` writes all of it in a single call — see
 * `stages.ts`. There is no half-saved state to resume into, so a golfer who leaves midway
 * comes back to the start of this stage.
 *
 * Handoff §4a/§4c. UX rules: typed answers show a Continue gated on validity, Enter
 * advances, Back always works.
 */

import { useState } from 'react';
import { type AllocInput, VOLUME_LIMITS, type VolumeInput } from './contract';
import { AllocBar } from './AllocBar';

/**
 * §4a — offered alongside the field, not instead of it.
 *
 * Values stay in MINUTES, which is what the engine consumes; only the labels read in hours,
 * because raw minute counts sat oddly beside the word "hours" on screen. So `practiceMinutes`
 * and everything downstream of it are untouched by this.
 *
 * The 0 preset is gone. A golfer who genuinely doesn't practise can still type 0 — the field
 * accepts it and `VOLUME_LIMITS` allows it — so the no-volume result path stays reachable; it
 * just isn't two taps away by accident any more.
 */
const MINUTE_PRESETS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hr' },
  { value: 90, label: '1.5 hrs' },
  { value: 120, label: '2 hrs' },
  { value: 240, label: '4 hrs' },
] as const;

/**
 * A neutral starting split. Any non-even default would nudge the answer, and this screen
 * is an instrument first — the same reason Messy Middle isn't coloured as a warning.
 */
const STARTING_ALLOC: AllocInput = {
  construction: 25,
  calibration: 25,
  transfer: 25,
  messy: 25,
};

/**
 * Blank is not zero. Until the golfer types something we hold the empty string, so
 * Continue stays disabled instead of silently accepting a 0 they never chose.
 *
 * The upper bound is the server's own, from `VOLUME_LIMITS`. Without it the client accepted
 * anything finite and the golfer only found out at the save, as a bare "Invalid request" —
 * after answering both questions and setting their whole practice split.
 */
function parseInRange(raw: string, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

/** Said only once the golfer is actually over the line, so it reads as an answer not a rule. */
function overLimitNote(raw: string, max: number, unit: string): string | undefined {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return undefined;
  return n > max ? `That's more ${unit} than we can score — ${max} is the most.` : undefined;
}

export function VolumeStage({
  busy,
  onDone,
}: {
  busy: boolean;
  onDone: (volume: VolumeInput, alloc: AllocInput) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [minutesRaw, setMinutesRaw] = useState('');
  const [hoursRaw, setHoursRaw] = useState('');
  const [alloc, setAlloc] = useState<AllocInput>(STARTING_ALLOC);

  const minutes = parseInRange(minutesRaw, VOLUME_LIMITS.practiceMinutesMax);
  const hours = parseInRange(hoursRaw, VOLUME_LIMITS.courseHoursMax);

  function finish() {
    // Both are non-null by the time step 2 is reachable — each Continue is gated on its
    // own field parsing. The `?? 0` is belt-and-braces, not expected to fire.
    onDone({ practiceMinutes: minutes ?? 0, courseHours: hours ?? 0 }, alloc);
  }

  if (step === 0) {
    return (
      <TypedQuestion
        question="In an average week, how many minutes do you spend working on your full swing — range, garage, simulator — not counting rounds?"
        unit="minutes per week"
        value={minutesRaw}
        onChange={setMinutesRaw}
        presets={MINUTE_PRESETS}
        valid={minutes !== null}
        busy={busy}
        onBack={null}
        onNext={() => setStep(1)}
        max={VOLUME_LIMITS.practiceMinutesMax}
        note={overLimitNote(minutesRaw, VOLUME_LIMITS.practiceMinutesMax, 'minutes')}
      />
    );
  }

  if (step === 1) {
    return (
      <TypedQuestion
        question="In an average week, how many hours do you spend playing on the course?"
        unit="hours per week"
        value={hoursRaw}
        onChange={setHoursRaw}
        step="0.5"
        valid={hours !== null}
        busy={busy}
        onBack={() => setStep(0)}
        onNext={() => setStep(2)}
        max={VOLUME_LIMITS.courseHoursMax}
        note={overLimitNote(hoursRaw, VOLUME_LIMITS.courseHoursMax, 'hours')}
        // The §4b credit rule used to be disclosed here, mid-question. It's a modelling
        // assumption the No Fiction rule requires us to state, but stating it while the golfer
        // is still answering explains maths they have no result to attach it to yet. The
        // disclosure lives on the result screen instead, under the time bars, where the credited
        // minutes are actually visible ("Includes 25% of your course time credited as
        // ball-striking work"). Said once, at the point it means something.
      />
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <p className="mb-2 text-xl leading-snug font-medium">
        Of your practice time — not rounds — what share goes to each of these?
      </p>
      <p className="mb-8 text-sm text-muted">
        Drag the dividers. It always adds up to 100%.
      </p>

      <AllocBar value={alloc} onChange={setAlloc} />

      <div className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setStep(1)}
          disabled={busy}
          className="text-sm text-muted underline disabled:no-underline disabled:opacity-40"
        >
          ‹ Back
        </button>
        <button
          type="button"
          onClick={finish}
          disabled={busy}
          className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

/** The shared shape of both typed volume questions. */
function TypedQuestion({
  question,
  unit,
  value,
  onChange,
  presets,
  step,
  valid,
  busy,
  note,
  max,
  onBack,
  onNext,
}: {
  question: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  /** Value in the field's own unit; label is what the golfer reads. */
  presets?: readonly { value: number; label: string }[];
  step?: string;
  valid: boolean;
  busy: boolean;
  note?: string;
  /** The server's own ceiling, so the field agrees with what the save will accept. */
  max?: number;
  /** Null on the first screen, where there is nowhere back to. */
  onBack: (() => void) | null;
  onNext: () => void;
}) {
  return (
    <form
      className="mx-auto max-w-md"
      onSubmit={(e) => {
        // Enter advances — but only when the field is actually valid, and never by
        // reloading the page (which would lose the run).
        e.preventDefault();
        if (valid && !busy) onNext();
      }}
    >
      <p className="mb-8 text-xl leading-snug font-medium">{question}</p>

      <div className="mb-4 flex items-baseline gap-3">
        <input
          type="number"
          min={0}
          max={max}
          step={step ?? '1'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
          aria-label={unit}
          className="w-32 rounded-lg border border-ink/15 bg-ink/20 px-4 py-3 text-lg tabular-nums outline-none focus:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        />
        <span className="text-sm text-muted">{unit}</span>
      </div>

      {presets && (
        <div className="mb-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(String(p.value))}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                value === String(p.value)
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink/15 bg-ink/15 hover:border-ink/40'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {note && <p className="mb-4 text-sm leading-relaxed text-ink/60">{note}</p>}

      <div className="mt-8 flex items-center justify-between gap-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="text-sm text-muted underline disabled:no-underline disabled:opacity-40"
          >
            ‹ Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </form>
  );
}
