/**
 * THE ALLOCATION BAR — one bar, four segments, three draggable dividers.
 *
 * Not four independent 0–100 sliders. That was tried and abandoned (see the Atlas
 * reference): independent sliders can't structurally sum to 100, so they had to be
 * rescaled for display, and then the handle position and the printed % disagreed with each
 * other. Dragging a divider only trades share between its two neighbours, so the total is
 * always exactly 100 and what the golfer sees is what gets stored.
 *
 * FOUR segments, not five. Performance is deliberately absent: it's derived from course
 * hours via the 25% credit rule (§4b), not self-reported here. Handoff §4c — "Four segments
 * in the control, five names in the model." (`BUILD-PACKAGE/02` describes a five-segment
 * version with Performance included; §4c and `AllocInput` in the contract both supersede it.)
 */

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useRef } from 'react';
import type { AllocInput } from './contract';

type SegmentKey = keyof AllocInput;

/** Left-to-right order in the bar. Also the order the legend reads. */
const SEGMENTS: readonly SegmentKey[] = ['construction', 'calibration', 'transfer', 'messy'];

/**
 * Labels are the book's own zone names, on purpose — the quiz teaches the vocabulary from
 * the first screen (Luke, 2026-07-31). The behavioral anchor underneath does the actual
 * locating, because the book's core claim is that golfers *can't* place themselves by feel.
 *
 * Copy is verbatim from handoff §4c. Luke owns the wording — don't paraphrase it.
 */
const SEGMENT_COPY: Record<SegmentKey, { label: string; anchor: string }> = {
  construction: {
    label: 'Construction',
    anchor:
      'Drilling movement patterns with video feedback — no concern for where the ball goes',
  },
  calibration: {
    label: 'Calibration',
    anchor:
      'Working on strike location, face, path, or low point — reading what the ball tells you',
  },
  transfer: {
    label: 'Transfer',
    anchor: 'Games and tests on the range — targets that count, consequences, score kept',
  },
  messy: {
    label: 'Messy Middle',
    anchor: 'A bit of mechanics, some ball flight, switching targets — no single focus',
  },
};

/**
 * Four clearly distinct colours (Teddy, 2026-08-06). The previous set was four steps down one
 * blue ramp, which read as a gradient rather than four separate things — hard to tell apart at
 * a glance and impossible to match against the legend. The two darker blues became black and
 * white; the light blue and gold stayed as they were.
 *
 * Still deliberately NOT flagging Messy Middle in a warning colour, even though a high share
 * triggers a callout on the result screen: colouring it as a problem while the golfer is
 * answering would bias the answer, and this is an instrument before it is a marketing page.
 */
const SEGMENT_COLOR: Record<SegmentKey, string> = {
  // ── RESTYLED TO THE ATLAS PALETTE, 2026-09-17 ───────────────────────────────────────────────
  // Was TGT's book-cover palette (#1a1a1a / #ffffff / #8fa9b5 / #c9c2b6), which is a different
  // product's look and broke Luke's Brand Guide twice: the ground is a COLD near-black where Atlas
  // uses a warm one, and #ffffff is pure white, which the guide rules out ("warm off-white, never
  // pure white"). The comments were stale too — `messy` was labelled gold and was not.
  //
  // The three real zones now take the dashboard's own `ZONE_COLOR` values (Dashboard.dc.html),
  // so a golfer sees one colour per zone across the quiz AND the dashboard rather than learning
  // the mapping twice.
  construction: '#c8a05e', // --gold
  calibration: '#7fa8c9', // --blue
  transfer: '#ece7db', // --paper
  // Messy has no zone, so it takes --muted: neutral and clearly the odd one out, without reading
  // as a warning. Flagging it red while the golfer is still answering would bias the answer — the
  // original note about that still holds and is the reason this is not the clay accent.
  messy: '#8d99a8', // --muted
};

/**
 * Label colour per segment, because a fixed white would vanish on three of the four.
 * White only survives on the black segment; ink carries the contrast on the rest.
 */
const SEGMENT_TEXT: Record<SegmentKey, string> = {
  // All four segments are now mid-to-light, so ink carries the contrast on every one — the old
  // white-on-black case is gone with the black.
  construction: '#13110b', // --ink
  calibration: '#13110b',
  transfer: '#13110b',
  messy: '#13110b',
};

/**
 * The divider maths, kept pure and outside the component so the sum-to-100 invariant can be
 * tested directly rather than by driving a browser. See `AllocBar.test.ts`.
 *
 * The three boundaries — running totals from the left edge — are the real state of the
 * control. The four segment widths are just differences between them, which is precisely
 * why the total can never drift off 100.
 */
export type Dividers = [number, number, number];

export function toDividers(v: AllocInput): Dividers {
  return [v.construction, v.construction + v.calibration, v.construction + v.calibration + v.transfer];
}

export function fromDividers(d: Dividers): AllocInput {
  return {
    construction: d[0],
    calibration: d[1] - d[0],
    transfer: d[2] - d[1],
    messy: 100 - d[2],
  };
}

/**
 * The divider closest to a tapped position.
 *
 * Why this exists: the handles need ≥44px touch targets, but two dividers can sit 5% apart —
 * 16px on a phone — so their hit areas overlap. When they did, the later-rendered handle won
 * every tap, which meant a golfer who squeezed a segment small could no longer grab the
 * divider on its left: every attempt moved the one on its right, and the segment was stuck at
 * that size. Choosing by distance instead of by hit area removes the ambiguity entirely, and
 * makes the whole bar tappable rather than just the handles.
 *
 * TIES MATTER, and getting them wrong is what deadlocked the bar. Coincident dividers are
 * common — slam one to an edge and two or three stack up on the same pixel. Always resolving to
 * the lowest index meant that with all three at 100, every tap moved divider 0, so the
 * right-hand boundary could never travel back left and Messy Middle was stuck at 0% for the rest
 * of the quiz.
 *
 * PICK THE TIED DIVIDER WHOSE MOVE OPENS A GAP, which is the one that leaves its twins behind.
 * `moveDivider` has to push everything left of the moved boundary left with it, and everything
 * right of it right, or the boundaries would cross. So:
 *
 *   - dragging RIGHT takes the HIGHEST of the tied dividers — the ones below it stay put
 *     (`min` of a smaller number is a no-op), and the segment to its left opens up
 *   - dragging LEFT takes the LOWEST — the ones above it stay put, and the segment to its
 *     right opens up
 *
 * Taking the outermost divider in the direction of travel instead — the previous rule, and the
 * reason Teddy found this — moves the whole stack as one body: drag Construction out until
 * Transfer hits 0 and every later gesture slid all three together, so Calibration and Transfer
 * read 0% with no gesture able to grow either. That looked like the Transfer handle vanishing,
 * because three handles were stacked on one pixel and nothing could separate them.
 */
export function nearestDivider(dividers: Dividers, pct: number): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  let bestDistance = Infinity;

  for (const i of [0, 1, 2] as const) {
    const distance = Math.abs(dividers[i] - pct);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
      continue;
    }

    // Only a genuine stack needs the rule below. Two dividers that merely happen to be
    // equidistant from the tap are an ambiguous gesture either way, so the nearer-first
    // pass keeps the lower index and the golfer's next move disambiguates.
    if (distance === bestDistance && dividers[i] === dividers[best] && pct > dividers[i]) {
      best = i;
    }
  }

  return best;
}

/**
 * All the dividers sitting on the same position as `pressed` — the stack the golfer grabbed.
 */
function stackAround(dividers: Dividers, pressed: 0 | 1 | 2): (0 | 1 | 2)[] {
  return ([0, 1, 2] as const).filter((i) => dividers[i] === dividers[pressed]);
}

/**
 * Which divider of a pressed stack to move, once the gesture finally reveals a direction.
 *
 * PRESSING ON A STACK NAMES NO DIRECTION, and that is why `nearestDivider` alone couldn't fix
 * the deadlock. The natural gesture is to put a finger on the handle and then drag, so the
 * pointerdown lands exactly on the stacked boundaries with zero travel to read intent from. Any
 * choice made at that instant is a guess, and guessing wrong glues the stack together for the
 * rest of the gesture — Construction just kept eating the bar and Transfer never came back.
 *
 * So the decision waits for the first move that leaves the stack, and then picks the divider
 * whose travel opens a gap: the far end going right, the near end going left.
 */
export function dividerInStack(dividers: Dividers, pressed: 0 | 1 | 2, pct: number): 0 | 1 | 2 {
  const stack = stackAround(dividers, pressed);
  const picked = pct > dividers[pressed] ? stack[stack.length - 1] : stack[0];
  return picked ?? pressed;
}

/**
 * Moves one boundary to an absolute position, PUSHING any boundary it would cross.
 *
 * This used to clamp against its neighbours, which deadlocked the control. Drag the last
 * divider fully right and all three end up at 100; from there every tap resolves to the same
 * divider, and because each one is clamped by the one on its left, none of them can travel back
 * left. Messy Middle sits at 0% and cannot be recovered — the golfer has to start the quiz over.
 * Reported from real use, 2026-08-06.
 *
 * Pushing makes a divider's position mean exactly what it looks like: everything left of it is
 * at most that value, everything right at least. Nothing can cross, nothing can go negative, and
 * no arrangement is a dead end. The cost is that one drag can collapse more than one segment —
 * correct, since dragging a boundary past another is a request to do just that.
 */
export function moveDivider(dividers: Dividers, i: 0 | 1 | 2, pct: number): AllocInput {
  const target = Math.min(100, Math.max(0, Math.round(pct)));
  const next: Dividers = [...dividers];
  next[i] = target;

  // Push the boundaries on each side out of the way rather than refusing to move.
  for (const j of [0, 1, 2] as const) {
    const current = next[j];
    if (j < i) next[j] = Math.min(current, target);
    if (j > i) next[j] = Math.max(current, target);
  }

  return fromDividers(next);
}

/**
 * The two segments each boundary sits between, as a fixed 3-tuple so indexing by 0|1|2 is
 * provably in range. Moving one divider always trades share between exactly these two.
 */
const DIVIDER_PAIRS: readonly [
  readonly [SegmentKey, SegmentKey],
  readonly [SegmentKey, SegmentKey],
  readonly [SegmentKey, SegmentKey],
] = [
  ['construction', 'calibration'],
  ['calibration', 'transfer'],
  ['transfer', 'messy'],
];

/** Screen-reader names for the three boundaries, in bar order. */
const DIVIDER_LABELS: readonly [string, string, string] = [
  `${SEGMENT_COPY.construction.label} and ${SEGMENT_COPY.calibration.label}`,
  `${SEGMENT_COPY.calibration.label} and ${SEGMENT_COPY.transfer.label}`,
  `${SEGMENT_COPY.transfer.label} and ${SEGMENT_COPY.messy.label}`,
];

/**
 * What a screen reader should say when a boundary moves. Without it, `aria-valuenow` is read
 * as a bare number — "29" — which says nothing about what changed.
 */
export function dividerValueText(value: AllocInput, i: 0 | 1 | 2): string {
  const [left, right] = DIVIDER_PAIRS[i];
  return `${SEGMENT_COPY[left].label} ${value[left]}%, ${SEGMENT_COPY[right].label} ${value[right]}%`;
}

export function AllocBar({
  value,
  onChange,
}: {
  value: AllocInput;
  onChange: (v: AllocInput) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<0 | 1 | 2 | null>(null);
  /**
   * True while a press has landed on a stack of coincident dividers and we're still waiting to
   * see which way the golfer pulls. See `dividerInStack`.
   */
  const awaitingDirection = useRef(false);

  const dividers = toDividers(value);

  function drag(i: 0 | 1 | 2, pct: number) {
    onChange(moveDivider(dividers, i, pct));
  }

  function pctFromClientX(clientX: number): number {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return ((clientX - rect.left) / rect.width) * 100;
  }

  /**
   * Pointer handling lives on the BAR, not on the handles.
   *
   * The handles are 44px wide for touch, so two dividers a few percent apart overlap and
   * whichever renders last swallows every tap — see `nearestDivider`. Selecting by distance
   * from one handler on the bar removes that failure mode, and means a golfer can grab a
   * divider by tapping anywhere near it rather than having to hit it.
   */
  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const pct = pctFromClientX(e.clientX);
    const pressed = nearestDivider(dividers, pct);
    // Pointer capture keeps the drag alive when the finger strays off the bar — without it,
    // dragging to the very edge drops the gesture.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = pressed;

    // A press landing exactly on stacked boundaries has to wait for a direction before it can
    // know which one the golfer means. Moving anything now would pick the wrong one and lock it
    // in for the whole gesture.
    awaitingDirection.current =
      Math.round(pct) === dividers[pressed] && stackAround(dividers, pressed).length > 1;
    if (awaitingDirection.current) return;

    // Jump straight to the tapped position, so a tap moves the divider rather than only
    // arming a drag that then needs a separate movement.
    drag(pressed, pct);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragging.current === null) return;
    const pct = pctFromClientX(e.clientX);

    if (awaitingDirection.current) {
      // Still sitting on the stack — no direction to read yet.
      if (Math.round(pct) === dividers[dragging.current]) return;
      dragging.current = dividerInStack(dividers, dragging.current, pct);
      awaitingDirection.current = false;
    }

    drag(dragging.current, pct);
  }

  function stopDrag() {
    dragging.current = null;
    awaitingDirection.current = false;
  }

  /** Keyboard equivalent of dragging: ±1, or ±5 with shift. */
  function nudge(i: 0 | 1 | 2) {
    return (e: ReactKeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowLeft') {
        drag(i, dividers[i] - step);
        e.preventDefault();
      }
      if (e.key === 'ArrowRight') {
        drag(i, dividers[i] + step);
        e.preventDefault();
      }
    };
  }

  return (
    <div>
      <div
        ref={barRef}
        onPointerDown={startDrag}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        // The ring matters now that one segment is white: without it, Calibration bleeds into
        // the paper background and the bar looks like it has a hole in it.
        className="relative flex h-16 touch-none overflow-hidden rounded-lg ring-1 ring-ink/20 select-none ring-inset"
      >
        {SEGMENTS.map((key) => (
          <div
            key={key}
            style={{
              width: `${value[key]}%`,
              background: SEGMENT_COLOR[key],
              color: SEGMENT_TEXT[key],
            }}
            className="flex items-center justify-center text-sm font-medium transition-[width] duration-75"
          >
            {/* Below ~9% the number doesn't fit and turns into visual noise. */}
            {value[key] >= 9 && `${value[key]}%`}
          </div>
        ))}

        {([0, 1, 2] as const).map((i) => (
          <div
            key={i}
            role="slider"
            tabIndex={0}
            aria-label={`Boundary between ${DIVIDER_LABELS[i]}`}
            aria-valuemin={i === 0 ? 0 : dividers[i - 1]}
            aria-valuemax={i === 2 ? 100 : dividers[i + 1]}
            aria-valuenow={dividers[i]}
            aria-valuetext={dividerValueText(value, i)}
            style={{ left: `${dividers[i]}%` }}
            onKeyDown={nudge(i)}
            // `pointer-events-none` on purpose: the bar owns pointer input so overlapping
            // handles can't steal each other's taps. Focus and arrow keys still work, because
            // tabbing doesn't go through hit testing. The whole 64px-tall bar is the touch
            // target now, which is more forgiving than a 44px handle ever was.
            className="pointer-events-none absolute top-0 -ml-5.5 flex h-full w-11 cursor-ew-resize items-center justify-center focus-visible:outline-2 focus-visible:outline-ink"
          >
            {/* Paper with an ink ring, so the line reads against all four segments — a plain
                white line disappeared on the white one and a plain dark line on the black. */}
            <span className="h-full w-1 bg-paper ring-1 ring-ink/50 ring-inset" />
          </div>
        ))}
      </div>

      <dl className="mt-6 space-y-4">
        {SEGMENTS.map((key) => (
          <div key={key} className="flex gap-3">
            <span
              aria-hidden
              style={{ background: SEGMENT_COLOR[key] }}
              // Ringed for the same reason as the bar: a white dot on paper is invisible.
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-ink/25"
            />
            <div className="min-w-0">
              <dt className="flex items-baseline gap-2 font-medium">
                {SEGMENT_COPY[key].label}
                <span className="text-sm text-muted tabular-nums">{value[key]}%</span>
              </dt>
              <dd className="text-sm leading-snug text-ink/60">{SEGMENT_COPY[key].anchor}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}
