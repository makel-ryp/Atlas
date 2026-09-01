/**
 * THE SHELL — the frame every screen lives inside.
 *
 * It owns three things and nothing else:
 *   1. which stage is showing        (see `stages.ts`)
 *   2. the run and every save        (see `useQuizRun.ts`)
 *   3. the chrome around the screen  — progress, errors, start-over
 *
 * Screens stay dumb on purpose: they take values in, hand answers back, and never touch
 * the api or decide what comes next. That is what makes them cheap to build one at a time.
 */

import { useEffect, useState } from 'react';
import type { QuizApi } from './contract';
import { type Tier, itemsForTier } from '../../../shared/practice-dna/items';
import { ErrorBoundary } from './ErrorBoundary';
import { NotBuiltYet } from './NotBuiltYet';
import { ProfileStage } from './ProfileStage';
import { ResultScreen } from './ResultScreen';
import { TierRunner, questionsFor } from './TierRunner';
import { VolumeStage } from './VolumeStage';
import { type Stage, STAGE_LABELS, STAGE_SEQUENCE, defaultStage, nextTier } from './stages';
import { useQuizRun } from './useQuizRun';

/** What the last button of each tier promises. The result is the reward for finishing. */
const DONE_LABELS: Record<'tier1A' | 'tier1B' | 'tier2' | 'tier3', string> = {
  tier1A: 'See my result',
  // Not "sharpened map": finishing this level can't move the Map's numbers. Share and heat are
  // both functions of the allocation screen alone, so all the extra answers change there is the
  // blur radius of the dots. What actually sharpens is the read — archetype, tendency, grades.
  tier1B: 'See my sharpened DNA',
  tier2: 'See my full diagnosis',
  tier3: 'Finish',
};

export function Shell({ api }: { api: QuizApi }) {
  const quiz = useQuizRun(api);
  const { run } = quiz;

  /**
   * Normally the stage is derived from the saved run, so a refresh lands in the right
   * place. The one exception is going forward into an opt-in level (§3: the result screen
   * sells the next tier) — the run can't express "they clicked Sharpen", so that intent
   * lives here instead.
   *
   * `defaultStage` needs a run — there is no `email` stage to fall back to any more, since
   * `useQuizRun` auto-starts one on mount. Until it exists (the initial load, or a failed
   * auto-start), `stage` is null and the render below shows loading/error instead of a screen.
   */
  const [override, setOverride] = useState<Stage | null>(null);
  const stage = override ?? (run ? defaultStage(run) : null);

  // The moment a tier saves, the run knows more than the override does — so drop it and
  // let the derived stage take over. Without this, finishing Tier 1B would leave the UI
  // pinned to Tier 1B forever.
  useEffect(() => {
    setOverride(null);
  }, [run?.tierCompleted]);

  /**
   * Start every screen at the top.
   *
   * The browser keeps the scroll position across a React re-render, and the "next level" CTA
   * sits at the bottom of a long result page — so tapping it dropped the golfer onto question
   * 1 of the next tier already scrolled to the bottom, looking at an empty page. `instant`
   * rather than smooth: this is a new screen, not a movement within one.
   */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [stage]);

  // -1 while `stage` is null (loading/error), same as any stage outside the main sequence —
  // the dots stay hidden either way, which is correct: there's nothing to show progress on yet.
  const stepIndex = stage ? STAGE_SEQUENCE.indexOf(stage) : -1;

  // HOME LINK DROPPED. tgt's version linked back to the host site the quiz was vendored into
  // (The Golf Textbook, via VITE_HOME_URL). Atlas is not vendored into anything — it IS the
  // host — so there is no "leave the quiz" destination and no config for one.

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between border-b border-ink/10 pb-4">
        <div>
          <p className="text-sm font-medium tracking-tight">
            Practice DNA
            {stage && <span className="ml-2 font-normal text-muted">{STAGE_LABELS[stage]}</span>}
          </p>
        </div>

        {/* Progress dots. Hidden on stages outside the main flow (the opt-in tiers), where
            a 5-step bar would misrepresent how much is left. */}
        {stepIndex >= 0 && (
          <div className="flex gap-1.5" aria-hidden>
            {STAGE_SEQUENCE.map((s, i) => (
              <span
                key={s}
                className={`h-1.5 w-1.5 rounded-full ${i <= stepIndex ? 'bg-ink' : 'bg-ink/20'}`}
              />
            ))}
          </div>
        )}
      </header>

      {quiz.error && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-clay/40 bg-clay/10 px-4 py-3 text-sm"
        >
          <span>{quiz.error}</span>
          <button
            type="button"
            onClick={quiz.dismissError}
            className="shrink-0 text-muted underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Covers both the initial load AND the auto-start (see `useQuizRun`) — there is no
          email screen to flash in between any more, but there is a beat before a brand-new
          golfer's run exists, and `stage` is null for exactly that beat. If the auto-start
          itself failed, the error banner above already says so — nothing extra to add here. */}
      {!stage ? (
        quiz.busy && <p className="text-muted">Loading…</p>
      ) : (
        // Keyed by stage so recovering from a failed screen doesn't leave the boundary
        // latched shut on the next one.
        //
        // CALLED, NOT RENDERED AS <StageView />, and the difference is not cosmetic.
        // `stageView` is declared inside this component, so a new function identity exists on
        // every render. React compares element types by identity, so `<StageView />` was a
        // DIFFERENT component type each time — it unmounted the whole stage and mounted a fresh
        // one on any Shell re-render, taking that stage's local state with it.
        //
        // Every save sets `busy` and then `error` or `run`, all of which re-render Shell, so a
        // failed save destroyed exactly the answers the golfer was trying to save: the volume
        // screen dropped its minutes, hours and practice split and reopened on question one, and
        // a failed `saveTier` threw away a whole tier's answers — 34 questions on Tier 2, since
        // `TierRunner` holds them locally until the end. Even `Dismiss` did it, because clearing
        // the error is itself a re-render.
        //
        // Calling the function inlines its result, so the children reconcile by position and
        // keep their state. The boundary above still remounts per stage, which is intended.
        <ErrorBoundary key={stage}>{stageView()}</ErrorBoundary>
      )}

      {/*
        "START OVER" DROPPED HERE, DELIBERATELY LEFT OUT RATHER THAN GUESSED AT.

        tgt's version called `quiz.reset()` — abandon this browser's localStorage pointer and
        land back on the email screen, where typing the same email resumed the same run
        anyway. That escape hatch doesn't translate: Atlas's run is one row keyed to
        `user_id NOT NULL`, so "start over" here would mean actually discarding or
        re-opening that row for editing, which is a server decision (a reset endpoint, or a
        policy that PATCHing profile/volume/tier after `completedAt` is allowed) — not
        something this lane should invent by giving the button a plausible-looking handler.
        NEEDED FROM THE ROUTE LANE: does a completed intake stay editable, and if not, what
        resets it?
      */}
    </main>
  );

  /**
   * Lowercase on purpose: it returns an element, it is not a component. Rendering it as
   * `<StageView />` remounts every stage on every Shell re-render — see the call site.
   */
  function stageView() {
    // `stage` is non-null here — the `!stage` branch above is what renders instead of this
    // function when it isn't — but the switch is written over `Stage`, not `Stage | null`,
    // so TypeScript still needs the assertion at the call site below.
    switch (stage as Stage) {
      case 'volume':
        return (
          <VolumeStage
            busy={quiz.busy}
            onDone={(volume, alloc) => void quiz.saveVolume(volume, alloc).catch(() => {})}
          />
        );

      case 'profile':
        return (
          <ProfileStage
            busy={quiz.busy}
            onDone={(profile) => void quiz.saveProfile(profile).catch(() => {})}
          />
        );

      case 'tier1A':
      case 'tier1B':
      case 'tier2':
      case 'tier3':
        // `stage` (the outer const, not the switch discriminant) is still typed `Stage | null`
        // here — TS doesn't narrow a closed-over variable through a switch on a cast expression
        // — but the four cases above are exactly `TierStageName`, so the assertion is sound.
        return <TierStage stage={stage as 'tier1A' | 'tier1B' | 'tier2' | 'tier3'} />;

      case 'result': {
        // The engine returns null until there's enough answered to say anything. Reaching
        // here without a result means the save didn't land — show the error, not a blank.
        if (!run?.result) {
          return <p className="text-muted">Scoring…</p>;
        }
        // Never advertise a level that has nothing to ask. Tier 3's items are all still
        // pending, so "Research grade" led to a screen with no questions and no way out —
        // the golfer's only escape was clearing the browser. Hiding the CTA removes the dead
        // end at its source; the placeholder's Back button below is the safety net.
        const offered = nextTier(run.tierCompleted);
        const next = offered && tierHasQuestions(offered) ? offered : null;
        return (
          <ResultScreen
            run={run}
            result={run.result}
            nextLabel={next ? STAGE_LABELS[next] : null}
            onNext={() => next && setOverride(next)}
          />
        );
      }
    }
  }

  /**
   * A tier's worth of questions, ending in the review step. Real for 1A/1B/2; still a
   * placeholder for Tier 3, whose items are all pending.
   */
  function TierStage({ stage }: { stage: 'tier1A' | 'tier1B' | 'tier2' | 'tier3' }) {
    const tier = stage.replace('tier', '') as Tier;
    // `questionsFor`, not `itemsForTier` — it accounts for retired items, ALLOC, and the
    // appended zone-effectiveness block, so this agrees with what the runner would render.
    if (!tierHasQuestions(stage)) {
      // Always reachable-from: clearing the override drops back to the derived stage, which
      // for anyone who opted in from a result screen is that result.
      return <TierPlaceholder stage={stage} onBack={() => setOverride(null)} />;
    }

    return (
      <TierRunner
        // Remounting per tier is what freezes the question list — see TierRunner.
        key={tier}
        tier={tier}
        saved={run?.answers ?? {}}
        busy={quiz.busy}
        doneLabel={DONE_LABELS[stage]}
        onDone={(answers) => void quiz.saveTier(tier, answers).catch(() => {})}
      />
    );
  }

}

type TierStageName = 'tier1A' | 'tier1B' | 'tier2' | 'tier3';

/** Does this tier have anything a golfer can actually answer? */
function tierHasQuestions(stage: TierStageName): boolean {
  return questionsFor(stage.replace('tier', '') as Tier).length > 0;
}

/**
 * Counts the questions each tier will actually render, so the placeholder tells the truth
 * about the work left. Tier 3 reports 0: its items are all still marked pending, waiting
 * on the Mini-IPIP swap (§10.1).
 *
 * `onBack` is not optional. A screen with no questions and no exit is a trap, and this one
 * caught a real golfer — Research grade led here and the only way out was wiping storage.
 */
function TierPlaceholder({
  stage,
  onBack,
}: {
  stage: TierStageName;
  onBack: () => void;
}) {
  const tier = stage.replace('tier', '') as Tier;
  const count = itemsForTier(tier).length;

  return (
    <div className="mx-auto max-w-md">
      <NotBuiltYet
        title={STAGE_LABELS[stage]}
        needs={
          count === 0
            ? `Tier ${tier} has no renderable questions yet — every item is still marked pending. Nothing to build here until the items are finalised.`
            : `${count} questions, one per screen. Tap to answer, auto-advance, Back always works. Freeze this list when the tier starts.`
        }
      />
      <button
        type="button"
        onClick={onBack}
        className="mt-6 w-full rounded-lg bg-ink px-5 py-3 font-medium text-paper"
      >
        ‹ Back to my result
      </button>
    </div>
  );
}
