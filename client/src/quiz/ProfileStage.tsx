/**
 * "ABOUT YOUR GAME" — the 7 profile fields, one per screen (§3).
 *
 * Four of them are typed numbers even though `PROFILE_FIELDS` declares them as selects.
 * That's deliberate: the two handicap fields declare 55+ options each, and a 55-item
 * dropdown is a worse answer than a text field for a number the golfer already knows. The
 * options list still matters — it's where the non-numeric escape hatches ("I don't have
 * one", "Wasn't playing") come from, and those render as tap chips underneath the field.
 *
 * The parsing rules here are solved problems lifted from the Atlas reference. Don't
 * re-derive them.
 */

import { useState } from 'react';
import type { Profile } from './contract';
import { WIDENED_BOUNDS } from '../../../shared/profile-bounds';
import { PROFILE_FIELDS } from '../../../shared/practice-dna/items';

/** Typed rather than picked from their declared options. */
const TYPED_FIELDS = new Set(['PRO_AGE', 'PRO_SPEED', 'PRO_HCP_NOW', 'PRO_HCP_3YR']);

/**
 * FIELD BOUNDS WE DELIBERATELY WIDEN, held here rather than edited into the item bank.
 *
 * `PROFILE_FIELDS` floors age at 18, which turned juniors away on the very first screen — a
 * 15-year-old could not start the quiz at all. Practice DNA should be kid friendly (Teddy,
 * 2026-08-10), so the floor drops to 13.
 *
 * 13 IS A LEGAL FLOOR, NOT A GUESS ABOUT GOLF. The quiz is email-gated, so admitting under-13s
 * would mean collecting a child's email address and COPPA would require verifiable parental
 * consent — a consent flow, not a checkbox. 13 keeps junior golfers in and that obligation out.
 * Lowering it further is a product and legal decision before it is a code change: the gate is the
 * email, so anything under 13 needs either a consent flow or a route through the quiz that
 * collects no address (Teddy chose 13, 2026-08-10).
 *
 * WHY NOT EDIT `items.ts`: `shared/practice-dna/` is FORGE's bank, dropped in verbatim, and
 * CLAUDE.md keeps it unrewritten so our copy can't silently fork from theirs. `zone-grades.ts`
 * set the precedent — keep the divergence in our own file where it stays auditable in one place.
 *
 * No CONFIG_VERSION bump: no scoring path reads `PRO_AGE` at all, so every stored run re-scores
 * identically either way. The version stamp exists to keep re-scoring honest, and this can't
 * affect it.
 *
 * The server never enforced 18 in the first place — `profileSchema` builds from
 * `PROFILE_FIELDS` but only checks that numbers are finite, so this was always a client-side
 * gate and nothing downstream has to change.
 */
// Moved to shared/profile-bounds.ts so the intake route enforces the SAME numbers.
// See that file for why: the server used to refuse juniors the UI had just accepted.

function boundsFor(code: string, declared: { min?: number; max?: number }) {
  const widened = WIDENED_BOUNDS[code];
  return {
    min: widened?.min ?? declared.min,
    max: widened?.max ?? declared.max,
  };
}

/** The non-numeric states offered as chips under a typed field. */
const CHIPS: Record<string, readonly string[]> = {
  PRO_HCP_NOW: ["I don't have one"],
  PRO_HCP_3YR: ['About the same', "Wasn't playing", 'Higher than 54'],
};

/**
 * Driver distance → clubhead speed, for golfers who know how far they hit it but not how fast
 * they swing.
 *
 * CARRY AND TOTAL ARE DIFFERENT RATIOS AND THE OLD CODE MIXED THEM. It divided by 2.3 while
 * describing the input as "total carry+roll" — but 2.3× is the CARRY ratio; total, once roll is
 * included, runs nearer 2.6×. Running a total distance through the carry ratio overstated every
 * answer by about 13%: a 220-yard drive came out at 96 mph instead of 85 (Teddy, 2026-08-10).
 *
 * THE RATIO AND THE QUESTION HAVE TO DESCRIBE THE SAME SWING, and that is the part the first
 * fix got wrong. 2.6 is a PURE-STRIKE ratio, but the field asked for the golfer's AVERAGE drive
 * — and an average is dragged down by every thin, heeled and toe-ended one. Dividing a
 * mishit-inclusive average by a pure-strike ratio reads about 11% low: published amateur
 * averages sit near 93 mph and 215 total yards, a ratio of 2.31, so that golfer came out at 83
 * mph through 2.6. Two defensible numbers, multiplied into one wrong answer.
 *
 * So the question now asks for a WELL-STRUCK drive, which is the swing 2.6 actually describes.
 * The same 93 mph golfer flushes one around 240 total, and 240 / 2.6 = 92. Teddy, 2026-08-10:
 * "we want to calculate for a pure strike."
 *
 * Asking for a pure strike also asks for the number golfers quote most readily — nobody
 * volunteers their mishit average — though it does invite optimism, which is why the screen
 * prints the mph it derived and lets anyone who knows their real speed type it instead.
 *
 * `CARRY_YARDS_PER_MPH` is the same figure for a pure strike that stops short of the roll.
 */
/** Pure strike, carry only. Teddy: 2.3–2.4× speed. */
const CARRY_YARDS_PER_MPH = 2.35;
/** Pure strike, carry plus roll. Teddy: 2.55–2.65× speed. */
const TOTAL_YARDS_PER_MPH = 2.6;

export function speedFromTotalDistance(yards: number): number {
  return Math.round(yards / TOTAL_YARDS_PER_MPH);
}

/** The inverse, used to keep the distance field inside the speed field's own accepted range. */
export function totalDistanceFromSpeed(mph: number): number {
  return Math.round(mph * TOTAL_YARDS_PER_MPH);
}

/** Not used by a screen yet — here so the carry figure isn't lost or re-derived wrongly. */
export function speedFromCarryDistance(yards: number): number {
  return Math.round(yards / CARRY_YARDS_PER_MPH);
}

/**
 * Parse a typed handicap. Plus handicaps (better than scratch) are entered golf-style with
 * a leading "+" and stored as NEGATIVE numbers, which the engine's arithmetic (handicap
 * gap, 3-year improvement) then handles unchanged. Range +10 … 54.
 */
export function parseHcpInput(raw: string): number | null {
  const s = raw.trim();
  // Shape only, no range. The old version returned null outside -10…54, and null here means
  // "Continue stays disabled" — so a beginner on a 60 index was stuck on the screen with a
  // perfectly honest answer typed in. A handicap is an answer, not an entry requirement.
  if (!/^\+?\d{1,3}(\.\d+)?$/.test(s)) return null;
  const n = s.startsWith('+') ? -Number(s.slice(1)) : Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a typed handicap for the engine: "+2.1" → "-2.1". Chips pass through. */
export function hcpForEngine(raw: string): string {
  const n = parseHcpInput(raw);
  return n === null ? raw : String(n);
}

export function ProfileStage({
  busy,
  onDone,
}: {
  busy: boolean;
  onDone: (profile: Profile) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Which box the golfer typed the speed into. Only one is ever filled — entering a
  // distance clears the mph box and vice versa, so there's no ambiguity about which the
  // stored value came from.
  const [speedInput, setSpeedInput] = useState('');
  const [distanceInput, setDistanceInput] = useState('');

  const maybeField = PROFILE_FIELDS[idx];
  if (!maybeField) return null;

  // Re-bound after the guard so the callbacks below keep the "definitely present" type.
  const field = maybeField;

  const value = draft[field.code] ?? '';
  const isLast = idx === PROFILE_FIELDS.length - 1;
  const typed = TYPED_FIELDS.has(field.code);
  const isHcp = field.code === 'PRO_HCP_NOW' || field.code === 'PRO_HCP_3YR';
  const isSpeed = field.code === 'PRO_SPEED';
  const chips = CHIPS[field.code] ?? [];
  const onChip = chips.includes(value);
  const bounds = boundsFor(field.code, field);

  /**
   * ANSWERED, not APPROVED.
   *
   * This used to also require the number to sit inside the instrument's min/max, which disabled
   * Continue with nothing on screen explaining why — the golfer could see their answer typed in
   * and the button simply would not respond. A 12-year-old, a 60 handicap and a 38 mph swing were
   * each dead ends. None of those is a reason to refuse someone an account; the intake IS the
   * signup. Whatever they report, we take.
   *
   * The bounds still reach the inputs as `min`/`max` attributes below, where the browser renders
   * them as stepper limits and a soft hint — guidance, not a gate.
   */
  const valid = !typed || onChip || (isHcp ? parseHcpInput(value) !== null : value.trim() !== '' && Number.isFinite(Number(value)));

  function set(code: string, v: string) {
    setDraft((d) => ({ ...d, [code]: v }));
  }

  function finish(finalDraft: Record<string, string>) {
    // The engine's Profile is strings throughout except age. Handicaps go through
    // hcpForEngine so a plus handicap is stored as the negative the engine expects.
    onDone({
      PRO_AGE: Number(finalDraft.PRO_AGE) || 0,
      PRO_HAND: finalDraft.PRO_HAND ?? '',
      PRO_SPEED: finalDraft.PRO_SPEED ?? '',
      PRO_HCP_NOW: hcpForEngine(finalDraft.PRO_HCP_NOW ?? ''),
      PRO_HCP_3YR: hcpForEngine(finalDraft.PRO_HCP_3YR ?? ''),
      PRO_SHAPE: finalDraft.PRO_SHAPE ?? '',
      PRO_SHAPE_PREF: finalDraft.PRO_SHAPE_PREF ?? '',
    });
  }

  function advance() {
    if (isLast) finish(draft);
    else setIdx(idx + 1);
  }

  /** Tap answers commit and advance in one gesture, same rhythm as the quiz items. */
  function pickAndAdvance(v: string) {
    const next = { ...draft, [field.code]: v };
    setDraft(next);
    setTimeout(() => {
      if (isLast) finish(next);
      else setIdx((i) => i + 1);
    }, 180);
  }

  const inputClass =
    'w-40 rounded-lg border border-ink/15 bg-ink/20 px-4 py-3 text-lg tabular-nums outline-none focus:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-8">
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full bg-ink transition-[width] duration-200"
            style={{ width: `${((idx + 1) / PROFILE_FIELDS.length) * 100}%` }}
          />
        </div>
        <p className="text-xs text-muted">
          {idx + 1} of {PROFILE_FIELDS.length}
        </p>
      </div>

      <p className="mb-8 text-xl leading-snug font-medium">{field.label}</p>

      {!typed ? (
        <div className="flex flex-col gap-2">
          {field.options?.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={value === o}
              disabled={busy}
              onClick={() => pickAndAdvance(o)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                value === o
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink/15 bg-ink/15 hover:border-ink/40'
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      ) : isSpeed ? (
        // Two ways in, because most recreational golfers know their drive distance and not
        // their clubhead speed. Whichever they fill, we store mph.
        <>
        {/* Stacked on a phone, side by side once there's room. `flex-wrap` was doing this
            badly: the two boxes wrapped but "or" stayed on the first row, stranded to the
            right of the mph box instead of sitting between the two fields. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Clubhead speed (mph)</span>
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              min={bounds.min}
              max={bounds.max}
              placeholder="95"
              value={speedInput}
              onChange={(e) => {
                setSpeedInput(e.target.value);
                if (e.target.value !== '') setDistanceInput('');
                set(field.code, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid && !busy) advance();
              }}
              className={inputClass}
            />
          </label>

          <span className="text-sm text-muted sm:pb-3">or</span>

          <label className="flex flex-col gap-1">
            {/* Three things this label has to pin down, because leaving any of them to the
                golfer is what let a wrong ratio hide: well-struck rather than average, total
                rather than carry, and yards. */}
            <span className="text-sm text-muted">A well-struck drive, total (yards)</span>
            <input
              type="number"
              inputMode="numeric"
              // Bounded by what the speed field itself accepts, so a distance that would derive
              // an out-of-range mph can't be typed. Otherwise Continue just sat there disabled
              // with nothing explaining why.
              min={totalDistanceFromSpeed(bounds.min ?? 0)}
              max={totalDistanceFromSpeed(bounds.max ?? 200)}
              // 240 is a flushed drive for a mid-handicap swing, not an average one — the
              // placeholder has to model the question being asked or it re-anchors the golfer
              // back onto their average.
              placeholder="240"
              value={distanceInput}
              onChange={(e) => {
                const raw = e.target.value;
                setDistanceInput(raw);
                if (raw !== '') setSpeedInput('');
                const yards = Number(raw);
                set(
                  field.code,
                  raw !== '' && Number.isFinite(yards) && yards > 0
                    ? String(speedFromTotalDistance(yards))
                    : '',
                );
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid && !busy) advance();
              }}
              className={inputClass}
            />
          </label>
        </div>

        {/* Show the conversion rather than performing it silently: it's an estimate off a stated
            assumption, and a golfer who knows their real speed can see it's off and type it. */}
        {distanceInput !== '' && value !== '' && (
          <p className="mt-3 text-sm text-ink/60">
            Roughly <strong>{value} mph</strong>. Estimated from a well-struck drive, counting
            roll — type your speed instead if you know it.
          </p>
        )}
        </>
      ) : (
        <input
          type={isHcp ? 'text' : 'number'}
          inputMode={isHcp ? 'decimal' : 'numeric'}
          autoFocus
          min={bounds.min}
          max={bounds.max}
          placeholder={isHcp ? '8.4 — plus side: +2.1' : '44'}
          // A chip answer isn't a number, so the box shows empty rather than the chip text.
          value={onChip ? '' : value}
          onChange={(e) => set(field.code, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !busy) advance();
          }}
          className={isHcp ? inputClass.replace('w-40', 'w-56') : inputClass}
        />
      )}

      {isSpeed && distanceInput !== '' && value !== '' && (
        <p className="mt-3 text-sm text-ink/60">≈ {value} mph clubhead speed</p>
      )}

      {isHcp && (
        <p className="mt-3 text-sm text-ink/60">
          Better than scratch? Type it with a plus — +1 to +10 (e.g. +2.4).
        </p>
      )}

      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={value === c}
              disabled={busy}
              onClick={() => pickAndAdvance(c)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                value === c
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink/15 bg-ink/15 hover:border-ink/40'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setIdx(Math.max(0, idx - 1))}
          // Nowhere back to: the practice week before this is already saved, and this stage
          // starts fresh rather than re-editing it.
          disabled={idx === 0 || busy}
          className="text-sm text-muted underline disabled:no-underline disabled:opacity-40"
        >
          ‹ Back
        </button>

        {/* Typed fields need an explicit Continue; tap answers advance themselves. */}
        {typed && (
          <button
            type="button"
            disabled={!valid || busy}
            onClick={advance}
            className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40"
          >
            {busy ? 'Saving…' : isLast ? 'Start the quiz' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  );
}
