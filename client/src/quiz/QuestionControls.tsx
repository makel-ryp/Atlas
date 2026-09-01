/**
 * The three ways a golfer answers a question. One control per item type.
 *
 * Every answer is stored as a plain number, on the scale the engine expects
 * (items.ts:62): likert 0/25/50/75/100, stepper 0–7, sliders 0–100 continuous. Getting
 * that scale wrong wouldn't crash anything — it would quietly produce a wrong result,
 * which is far worse. So the mapping lives here, once, next to the control.
 *
 * `alloc` is the fourth item type and is deliberately absent: the allocation bar is its
 * own screen (§4c) and its value is derived from the volume adapter, not tapped in here.
 */

import { LIKERT_LABELS } from '../../../shared/practice-dna/items';

/**
 * Agreement, 5 tap targets. The whole quiz is mostly this control.
 *
 * One anchor set for every likert item. A version keyed on the item code — agreement for belief
 * statements, similarity for the rest — was built and then dropped: two frames in one quiz means
 * the golfer re-reads the options each time the wording flips, which costs more than the closer
 * fit on any single stem was worth.
 */
export function LikertControl({
  value,
  onPick,
}: {
  value: number | null;
  onPick: (v: number) => void;
}) {
  return (
    // The spoken prompt asks the same question the buttons underneath it answer.
    <div role="group" aria-label="How much do you agree?" className="flex flex-col gap-2">
      {LIKERT_LABELS.map((label, i) => {
        // 5 labels across 0–100: index 0 → 0, index 4 → 100.
        const v = i * 25;
        const selected = value === v;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(v)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              selected
                ? 'border-ink bg-ink text-paper'
                : 'border-ink/15 bg-ink/15 hover:border-ink/40'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** "How many times a week…" — 0 to 7+, stored as 0–7. */
export function StepperControl({
  value,
  onPick,
}: {
  value: number | null;
  onPick: (v: number) => void;
}) {
  return (
    <div role="group" aria-label="Times per week" className="flex flex-wrap gap-2">
      {Array.from({ length: 8 }, (_, i) => {
        const selected = value === i;
        return (
          <button
            key={i}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(i)}
            className={`h-12 w-12 rounded-lg border text-center transition-colors ${
              selected
                ? 'border-ink bg-ink text-paper'
                : 'border-ink/15 bg-ink/15 hover:border-ink/40'
            }`}
          >
            {/* 7 is the top of the scale and means "7 or more", not exactly 7. */}
            {i === 7 ? '7+' : i}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Continuous 0–100, used by bipolar items (two opposing poles) and attention checks.
 *
 * NO AUTO-ADVANCE. Sliders wait for Continue, unlike the tap controls above.
 *
 * It used to advance ~650ms after the last movement, and that was wrong twice over. It moved
 * the screen on while a golfer was still deciding — a slider invites adjustment in a way a tap
 * doesn't, and the pause before committing is the golfer thinking, not finishing. It also
 * recorded a stale value: the timer captured `onSettle` from the render that armed it, which
 * was one step behind the final drag position, so the number printed on screen and the number
 * stored disagreed by one. Both problems came from the same timer, so both left with it.
 */
export function SliderControl({
  value,
  onChange,
  left,
  right,
}: {
  value: number;
  onChange: (v: number) => void;
  left?: string;
  right?: string;
}) {
  return (
    <div>
      {left && right && (
        <div className="mb-2 flex justify-between text-sm text-muted">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label={left && right ? `${left} to ${right}` : 'Set the slider'}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-ink"
      />
      {/* Reads the same `value` that positions the thumb, so the printed number and the
          handle can never disagree. */}
      <p className="mt-2 text-center text-lg font-medium tabular-nums">{value}</p>
    </div>
  );
}
