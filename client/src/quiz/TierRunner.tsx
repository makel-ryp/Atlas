/**
 * ONE QUESTION PER SCREEN — the screen the golfer spends almost the whole quiz on.
 *
 * Built once, used for all three tiers (12 + 13 + 32 questions). The tier is a prop, so
 * there is no per-tier copy of this file to keep in sync.
 *
 * Answers are held locally and sent in a single `saveTier` call at the end, because that
 * is the shape of the contract — one PATCH per tier (§8). The consequence, deliberately
 * accepted: abandoning a tier half-way loses that tier's answers, but everything from
 * earlier tiers is already saved and still scores.
 */

import { useEffect, useState } from 'react';
import type { Answers } from './contract';
import { itemStatus } from '../../../shared/practice-dna/config';
import { type QuizItem, type Tier, itemsForTier } from '../../../shared/practice-dna/items';
import { zonePriorItems } from '../../../shared/zone-grades';
import { LikertControl, SliderControl, StepperControl } from './QuestionControls';
import { ReviewStep } from './ReviewStep';

/**
 * The questions this tier will actually ask.
 *
 * RENDERED ≠ SCORED, and the filter here has to respect the difference. Three item states
 * (`itemStatus` in config.ts) behave differently:
 *
 *   - `retired`  — must NOT render. Removed from the instrument; `checkAttention` still reads
 *                  them so historical runs stay interpretable, but no golfer should see one.
 *   - `candidate` — MUST render. The 13 mindset/self-regulation items are deliberately
 *                  "rendered & captured in Tier 2 but kept OUT of the validated v1 score"
 *                  until they accrue calibration data. Dropping them collects no data and the
 *                  scale can never be validated.
 *   - `active`   — renders and scores.
 *
 * So this filters on `retired` alone. Two wrong answers were tried first, both worth naming:
 *
 *   `itemsForTier(tier)` filters only on `pending`, so retired items still rendered — with
 *   ATTN01/ATTN02 retired, Tier 2 asked 34 instead of 32 and golfers answered two dead items.
 *
 *   `selectNextItems({}, tier)` looks like the right seam and is not: it filters on `isScored`,
 *   which excludes candidates too. That cut Tier 2 to 19 questions, silently dropping the
 *   entire mindset scale — the handoff's "19 scored + 13 mindset" would have become 19 and the
 *   research data would never have existed. It also drops already-answered items, which would
 *   shrink the list mid-run (see the freeze note below).
 *
 * ALLOC is filtered out on top of that. It lives in Tier 1A's list, but the golfer already
 * answered it on the allocation screen and its value is derived by the volume adapter — asking
 * again would overwrite good data with a guess. That's why Tier 1A is "12 items" in the handoff
 * while the raw tier list holds 13.
 */
export function questionsFor(tier: Tier): QuizItem[] {
  const fromBank = itemsForTier(tier).filter(
    (item) => itemStatus(item.code) !== 'retired' && item.type !== 'alloc',
  );

  /**
   * The zone-effectiveness items are appended rather than living in the item bank, because
   * `shared/practice-dna/` is FORGE's canonical copy and adding to it would fork our version
   * from theirs invisibly. `zonePriorItems()` hands them back in the engine's `QuizItem` shape,
   * so they render as ordinary bipolar sliders with no special-casing here.
   *
   * They go last so the tier opens on familiar agreement items rather than 17 sliders.
   */
  return tier === '2' ? [...fromBank, ...zonePriorItems(tier)] : fromBank;
}

export function TierRunner({
  tier,
  saved,
  busy,
  doneLabel,
  onDone,
}: {
  tier: Tier;
  /** Previously stored answers, so re-entering a tier shows what was picked before. */
  saved: Answers;
  busy: boolean;
  doneLabel: string;
  onDone: (answers: Answers) => void;
}) {
  /**
   * FROZEN, and this is load-bearing — not a precaution.
   *
   * An earlier version of this comment claimed §3's freeze warning was obsolete because the
   * selection function took no answers. That was wrong — it was describing `itemsForTier`
   * while the warning is about `selectNextItems(answers, tier)`, which drops every
   * already-answered item. Anyone who "fixes" `questionsFor` to use that seam without
   * freezing gets a list that shrinks by one on every tap: the exact skips-questions bug §3
   * warns about, already hit once on this project.
   *
   * `questionsFor` doesn't read answers today, so freezing is belt-and-braces — but it is the
   * belt that makes the above unable to happen. The Shell remounts this component per tier
   * (`key={tier}`), which is what makes a `useState` initializer right here over a `useMemo`.
   */
  const [items] = useState(() => questionsFor(tier));

  const [answers, setAnswers] = useState<Answers>(() => {
    // Seed from storage, but only for questions in THIS tier — carrying unrelated codes
    // into the save would re-send another tier's answers on every PATCH.
    const seeded: Answers = {};
    for (const item of questionsFor(tier)) {
      const previous = saved[item.code];
      if (previous !== undefined) seeded[item.code] = previous;
    }
    return seeded;
  });

  const [idx, setIdx] = useState(0);
  // Set once the last question is answered. The review step (§3) sits between the final tap
  // and the save, so a mis-tap can still be corrected before it moves the result.
  const [reviewing, setReviewing] = useState(false);
  // True while re-answering a single question reached from the review step.
  const [editing, setEditing] = useState(false);

  /**
   * Same reason as the Shell's: the review list is long, so tapping a row near its bottom to
   * edit an answer used to open that question already scrolled past it. Keyed on the question
   * and on entering/leaving review, so it fires on a screen change and never mid-screen.
   */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [idx, reviewing]);

  if (reviewing) {
    return (
      <ReviewStep
        items={items}
        answers={answers}
        busy={busy}
        doneLabel={doneLabel}
        onEdit={(i) => {
          setIdx(i);
          setEditing(true);
          setReviewing(false);
        }}
        onConfirm={() => onDone(answers)}
      />
    );
  }

  const maybeItem = items[idx];
  if (!maybeItem) return null; // a tier with nothing renderable (Tier 3 today)

  // Re-binding after the guard keeps the "definitely present" type inside the callbacks
  // below; TypeScript drops that narrowing once it crosses into a nested function.
  const item = maybeItem;
  const value = answers[item.code];
  const numeric = typeof value === 'number' ? value : null;
  const isLast = idx === items.length - 1;

  /**
   * Where "forward" goes after an answer.
   *
   * Someone who arrived here by tapping a row on the review step goes straight back to
   * review — not onward through every remaining question they'd already answered.
   */
  function goForward() {
    if (editing) {
      setEditing(false);
      setReviewing(true);
    } else if (isLast) {
      setReviewing(true);
    } else {
      setIdx(idx + 1);
    }
  }

  /** Commit one answer, and optionally move on. */
  function record(code: string, v: number, thenAdvance: boolean) {
    // Build the next answers object explicitly rather than reading `answers` back after
    // setState — React hasn't updated it yet.
    setAnswers({ ...answers, [code]: v });
    if (thenAdvance) goForward();
  }

  /** Tap controls answer and advance in one gesture. The pause lets the fill register. */
  function pickAndAdvance(v: number) {
    setAnswers({ ...answers, [item.code]: v });
    setTimeout(goForward, 220);
  }

  return (
    <div className="mx-auto max-w-md">
      {/*
        Tapping an answer advances the screen without moving focus — good for a keyboard user
        (they keep their place in the list and can answer a run of questions with repeated
        Enter) but silent for a screen reader, which had no idea the question had changed.
        Someone would have been answering questions they never heard read out.

        A polite live region is the right tool rather than moving focus: it announces the new
        question without stealing the golfer's position.
      */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        Question {idx + 1} of {items.length}. {item.text}
      </p>

      <div className="mb-8">
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full bg-ink transition-[width] duration-200"
            style={{ width: `${((idx + 1) / items.length) * 100}%` }}
          />
        </div>
        <p className="text-xs text-muted">
          {idx + 1} of {items.length}
        </p>
      </div>

      {/* Keyed by code so React swaps the text rather than reusing the old node — without
          it, a screen reader can miss that the question changed. */}
      <p key={item.code} className="mb-8 text-xl leading-snug font-medium">
        {item.text}
      </p>

      <fieldset disabled={busy} className="disabled:opacity-50">
        {item.type === 'likert' && <LikertControl value={numeric} onPick={pickAndAdvance} />}

        {item.type === 'stepper' && <StepperControl value={numeric} onPick={pickAndAdvance} />}

        {(item.type === 'sliderCheck' || item.type === 'bipolar') && (
          <SliderControl
            key={item.code}
            // An untouched slider sits at the midpoint but is NOT recorded as an answer until
            // the golfer moves it or presses Continue.
            value={numeric ?? 50}
            onChange={(v) => record(item.code, v, false)}
            left={item.poles?.left}
            right={item.poles?.right}
          />
        )}
      </fieldset>

      <div className="mt-8 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setIdx(Math.max(0, idx - 1))}
          disabled={idx === 0 || busy}
          className="text-sm text-muted underline disabled:no-underline disabled:opacity-40"
        >
          ‹ Back
        </button>

        {/*
          Sliders get an explicit button: there is no single "tap" that means done.

          THE MIDPOINT IS AN ANSWER, so pressing this always records one (Teddy, 2026-08-10:
          "50 IS AN ANSWER. MAKE SURE EVERYONE GETS GRADES"). A golfer who reads a bipolar stem
          and sits between its two poles has told us something real, and every zone grade depends
          on these 17 items — if the midpoint recorded nothing, anyone moving quickly would finish
          the full diagnosis with no grades at all, which is worse than a middling one.

          ⚠️  THE COST, NAMED SO IT ISN'T REDISCOVERED: an untouched slider is indistinguishable
          from a deliberate midpoint. Both store 50, and 50 grades C — so clicking straight
          through Tier 2's sliders yields C in all four zones, which is exactly what got reported
          as "grading is broken". It isn't the maths; it's that a default answer and a chosen
          answer look identical. The durable cure is to render these as five discrete taps rather
          than a pre-positioned slider — `ZONE_PRIOR_ITEMS` documents them as "Bipolar 1–5"
          already, so a tap per point matches the instrument and leaves no default to inherit.
          That is a UI change awaiting a decision, not something to infer.
        */}
        {(item.type === 'sliderCheck' || item.type === 'bipolar') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => record(item.code, numeric ?? 50, true)}
            className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40"
          >
            {/* The last question now leads to the review step, not straight to scoring. */}
            {isLast ? 'Review my answers' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  );
}
