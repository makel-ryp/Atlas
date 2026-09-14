/**
 * THE RESULT — the thing every screen before it was earning.
 *
 * Almost none of the words here are ours. `results-content.ts` holds the archetype copy,
 * tendency profiles, zone explainers, growth prescriptions, efficiency bands and the
 * disclaimer, all Luke-approved; the engine computes which of them apply. This file is
 * assembly, not authorship — if a sentence needs changing it changes in `results-content.ts`.
 *
 * Handoff §7. Level 1 (after Tier 1A) shows: a "continue the diagnosis" CTA at the top ·
 * archetype card with a provisional badge · tendency spectrum · time bars in real minutes with
 * the messy callout · efficiency tile · growth prescription. Level 2 (after Tier 1B) is where
 * the golfer first meets the Map fingerprint. Level 3 (after Tier 2) adds the MI-vs-handicap
 * verdict, the faulty-prior panel and the shareable card.
 *
 * Deliberately absent: the AI read (needs the server to hold the API key — `streamAiRead`
 * is optional on `QuizApi` for exactly this reason) and peer comparison, which ships behind
 * a flag and OFF until real population data exists. Both would be fiction today.
 */

import type { QuizRun } from './contract';
import { ALLOC_BENCHMARK, MESSY_THRESHOLDS } from '../../../shared/practice-dna/config';
import {
  ARCHETYPES,
  CHIPS,
  EFFICIENCY_CAPTION,
  GROWTH,
  MI_STATE_NOTE,
  MI_VERDICTS,
  PATTERNS,
  RESULT_DISCLAIMER,
  TENDENCIES,
  TIME_BARS_CAPTION,
  ZONES,
  efficiencyBand,
} from '../../../shared/practice-dna/results-content';
import type { Confidence, PracticeDnaResult, ZoneId } from '../../../shared/practice-dna/scoring';
import { type ZoneEffectiveness, computeZoneEffectiveness } from '../../../shared/zone-grades';
import { focusAdjustedEfficiency } from '../../../shared/efficiency';
import { type VolumeBreakdown, computeVolumeBreakdown } from '../../../shared/volume';
// DOWNLOADRESULTPDF DROPPED — its `resultPdf.tsx` dynamically imports `pdf-lib`, a dependency
// Atlas's package.json does not have (adding one the night before this shipped was out of
// scope for this lane). It was also tgt's answer to a problem Atlas doesn't have: the PDF's own
// comment says it exists because "the result lives behind a run id in localStorage" and a
// golfer needs an offline copy in case they lose that pointer. Atlas's run is a row owned by
// their signed-in account — it's already retrievable any time, from any device, no PDF needed.
import { MessyDial } from './result/MessyDial';
import { PracticeMap } from './result/PracticeMap';
import { ShareCard } from './result/ShareCard';
import { starvedZones } from './result/starvedZones';

const ZONE_ORDER: readonly ZoneId[] = ['construction', 'calibration', 'transfer', 'performance'];

/**
 * WHICH OF THE THREE READS THIS IS — the eyebrow above the archetype.
 *
 * Keyed on the confidence level, not on `archetypeProvisional`. That flag is
 * `tendencyProvisional || confidence === 'baseline'`, so a sharpened or full run whose tendency
 * is still provisional would have printed "First read" over the second or third screen — two
 * labels claiming to be the same one. The level is the thing being named here, so the level is
 * what it reads. At baseline nothing changes: `archetypeProvisional` is always true there.
 */
const READ_LABEL: Record<Confidence, string> = {
  baseline: 'First read',
  sharpened: 'Second read',
  full: 'Final verdict',
};

/** Minutes → "1h 20m", because 80 minutes is harder to feel than an hour and twenty. */
function formatMinutes(min: number): string {
  const rounded = Math.round(min);
  if (rounded < 60) return `${rounded}m`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function ResultScreen({
  run,
  result,
  nextLabel,
  onNext,
  onEnterAtlas,
}: {
  run: QuizRun;
  result: PracticeDnaResult;
  /** Null once every level is done — there is nothing left to sell. */
  nextLabel: string | null;
  onNext: () => void;
  /**
   * Leave the intake and go to Atlas proper. Absent in the standalone instrument, which had no
   * host app to return to — a result screen WAS the destination there. In Atlas the quiz is the
   * stretch between signing up and the dashboard, so without this the golfer finishes, sees their
   * read, and has nowhere to go: the only control on the page sells the next tier, and refreshing
   * was the sole escape. (Found by driving the flow in a browser, 2026-09-01.)
   */
  onEnterAtlas?: () => void;
}) {
  const archetype = ARCHETYPES[result.archetype];
  const tendency = TENDENCIES[result.tendencyLabel];
  const isFull = result.quizConfidence === 'full';

  // The volume model's real minutes (§4d) — ALWAYS NULL in this port, and deliberately so.
  //
  // tgt recomputes this from `run.volume`/`run.alloc` (the two raw practice-week answers) on
  // every render, because they're pure and derived rather than stored. Atlas's `QuizRun` has no
  // such fields (see `contract.ts`): `atlas.intake_submissions` has a home for the derived
  // `ALLOC` answer (used below via `result.actualAlloc`) but none yet for the two raw volume
  // numbers themselves, so there is nothing honest to recompute this FROM. Every place that
  // reads `breakdown` below already has a `?? result.actualAlloc` or an `if (breakdown)` guard
  // from tgt's own code — this renders those branches' empty state (no time bars, no messy
  // dial) rather than fabricating minutes from data that was never saved.
  // WIRED 2026-09-14. This was hardcoded `null as VolumeBreakdown | null`, written when the two
  // raw volume answers had no server-side home — so the Messy Middle dial and the two time-bar
  // sections it gates were unreachable, and a golfer who had just set their whole practice split
  // was shown nothing derived from it. `atlas.intake_submissions.volume` and `.alloc` are real
  // columns now and `toEnvelope` returns them, so the source exists. Still nullable on purpose:
  // a run resumed before the volume stage genuinely has neither, and the guards below handle it.
  const breakdown: VolumeBreakdown | null =
    run.volume && run.alloc ? computeVolumeBreakdown(run.volume, run.alloc) : null;

  /**
   * The displayed efficiency has to be the focus-adjusted one, not `result.efficiency`.
   *
   * The engine's number can't move when a golfer declares a zone: `actualZoneAlloc`
   * renormalises the four zones back to 100, redistributing the messy share away, so a
   * 50%-messy golfer scored identically to a fully focused one. Meanwhile the prescription
   * below tells them declaring one zone is "the fastest efficiency gain available" — pointing
   * at a number that could not respond. Luke confirmed messy practice should cost something.
   *
   * At messyShare = 0 this returns the engine's number unchanged, so nothing shifts for
   * focused golfers. Both halves call the same shared function, so the client and the server's
   * authoritative re-score agree.
   */
  const eff = focusAdjustedEfficiency(result, breakdown?.messyShare ?? null);

  // Band the adjusted number, not the raw one — otherwise the copy ("Dialed in") could
  // contradict the figure printed right next to it.
  const band = efficiencyBand(eff.value);

  const grades = computeZoneEffectiveness(run.answers);
  const hasGrades = ZONE_ORDER.some((zone) => grades[zone].answered > 0);

  /**
   * THE SHARPENED READ DROPS THE TIME BARS AND THE MESSY MIDDLE.
   *
   * Both are pure functions of the allocation screen: the volume breakdown reads only the two
   * typed volume answers plus the split, all of which are locked in before the first result ever
   * renders. So on this screen they would redraw byte-identical to what the golfer already
   * studied one level ago — same bars, same Messy share. Reprinting them implies the extra
   * questions moved something and invites exactly the "why haven't my numbers changed?" read
   * that they should never have provoked.
   *
   * What this level genuinely sharpens is the interpretation — archetype, tendency, mastery,
   * growth zone, efficiency and the targets — plus the Map, which this is now the only screen
   * to show: the baseline read no longer carries it, and the full diagnosis shows the share
   * card in its slot instead of redrawing the same picture a third time.
   */
  const isSharpened = result.quizConfidence === 'sharpened';

  /**
   * THE BASELINE READ CARRIES NO MAP AT ALL.
   *
   * The Map moved one level later, so the first result stays a short "here's what we've learned
   * so far" page fronted by the CTA into the rest of the diagnosis.
   */
  const isBaseline = result.quizConfidence === 'baseline';

  /**
   * The shares every "where your time goes" mark on this screen is drawn from — the Map tiles,
   * the time bars and the starved test all read this one value, so they can't disagree.
   */
  const shares = breakdown?.alloc ?? result.actualAlloc;

  /**
   * A golfer who answered 0 minutes and 0 hours. Typed rather than tapped now — the 0 preset
   * was dropped when the presets moved to hour labels — but still perfectly reachable, and the
   * volume adapter returns all zeros with `focusScore: 100`, which read out as "Declared
   * practice: 100% of 0m a week." 100% of nothing is not a finding, and every zone sitting at
   * 0% would light up as starved when there is no practice to be starved of.
   */
  const noVolume = breakdown !== null && breakdown.effectiveTotal === 0;

  /**
   * Not `result.ghostZone` directly: the engine breaks a tie by list order, which flagged
   * Construction as starved next to two other zones on the same percentage. See `starvedZones`.
   */
  const starved = noVolume ? [] : starvedZones(shares, result.ghostZone);

  return (
    <div className="mx-auto max-w-lg pb-4">
      {/*
        ── Next level, at the top ─────────────────────────────────────────

        On the baseline read the CTA leads rather than closes: this screen is the opening
        instalment, not the destination, and the line under the button says so. Every later level
        keeps its button at the foot of the page, where it follows the read it is selling.
      */}
      {isBaseline && (nextLabel || onEnterAtlas) && (
        <section className="mb-10">
          {nextLabel && (
            <button
              type="button"
              onClick={onNext}
              className="w-full rounded-lg bg-ink px-5 py-3 font-medium text-paper"
            >
              Click here to continue the diagnosis →
            </button>
          )}
          {/* Secondary on purpose: the diagnosis is what the screen is selling, and this is the
              door out for a golfer who has had enough for now. Their read is saved either way. */}
          {onEnterAtlas && (
            <button
              type="button"
              onClick={onEnterAtlas}
              className="mt-3 w-full rounded-lg border border-ink/25 px-5 py-3 font-medium text-ink"
            >
              Go to my Atlas →
            </button>
          )}
          <p className="mt-3 text-sm leading-relaxed text-ink/60">
            Here's what we've learned so far
          </p>
        </section>
      )}

      {/* ── Archetype ─────────────────────────────────────────────────────── */}
      <section className="mb-10">
        <p className="mb-2 text-xs tracking-[0.2em] text-muted uppercase">
          {READ_LABEL[result.quizConfidence]}
        </p>
        <h1 className="mb-3 text-3xl leading-tight font-bold tracking-tight">{archetype.name}</h1>
        <p className="mb-4 text-lg leading-snug text-ink/80">{archetype.tagline}</p>
        <p className="text-sm leading-relaxed text-ink/60">{archetype.coachLine}</p>
      </section>

      {/*
        The second read used to open with a line explaining that the Map and the time split were
        unchanged. Both halves of it stopped being true: the Map now makes its first appearance
        on this screen, and the time split appears on no read before the full diagnosis — so the
        sentence claimed something was unchanged that the golfer had never seen. Cut rather than
        rewritten (Teddy, 2026-08-13): it only ever existed to explain an absence, and there is
        no longer an absence to explain.
      */}

      {/* ── The Map fingerprint ───────────────────────────────────────────── */}
      {isSharpened && (
        <section className="mb-10">
          <h2 className="mb-4 font-bold tracking-tight">Where you land on the Map</h2>

          {/*
            The dial sits BESIDE the Map, never inside it. The four tiles sum to 100 − messyShare
            by design, so the remainder needs showing — but the Messy Middle has no coordinate on
            the grid, and renormalising the tiles to hide it would delete the finding.

            Stacks under the Map on a narrow phone. Side by side at 375px would drop the plot to
            ~270px, and the tiles' own labels stop being readable well before that.
          */}
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1">
              <PracticeMap
                kernels={result.heatKernels}
                starved={starved}
                share={shares}
                // The same grades the effectiveness list prints, on the tile they belong to.
                // Nothing else on the Map moves with the golfer's tier answers — share and heat
                // are both functions of the allocation screen alone.
                grades={hasGrades ? grades : null}
              />
            </div>

            {/* No volume answers means no messy share to show — the engine's fallback alloc
                already sums to 100 on its own. */}
            {breakdown && !noVolume && <MessyDial share={breakdown.messyShare} />}
          </div>
        </section>
      )}

      {/*
        ── The share card, in the Map's slot ──────────────────────────────

        The full diagnosis takes the card here rather than a third drawing of the Map. The card
        IS the Map — same `MapPlot`, framed with the archetype, the Messy Middle share and the
        wordmark — so printing both meant showing the golfer the same picture twice on one page,
        the second time captioned as something to keep. One picture, and it's the one they can
        take with them.

        It also means the Messy Middle survives the swap: the dial above belongs to the Map
        section, and the card carries the same share in its own title block.
      */}
      {isFull && (
        <section className="mb-10">
          <h2 className="mb-1 font-bold tracking-tight">Your share card</h2>
          <p className="mb-4 text-sm text-muted">
            Your Map, as a picture you can keep or send on.
          </p>
          <ShareCard
            kernels={result.heatKernels}
            starved={starved}
            share={shares}
            grades={hasGrades ? grades : null}
            archetype={archetype.name}
            messyShare={breakdown?.messyShare ?? 0}
            confidenceNote="Full diagnosis"
          />
        </section>
      )}

      {/*
        ── Tendency spectrum ──────────────────────────────────────────────

        Off the second read: that screen leads with the Map, which is the new thing it has to
        show, and the Engineer↔Artist bar would sit under it saying what the first read already
        said. It returns on the full diagnosis, where the read is the keepsake.
      */}
      {!isSharpened && (
        <section className="mb-10">
        <h2 className="mb-1 font-bold tracking-tight">
          {tendency.name}
          {result.tendencyProvisional && (
            <span className="ml-2 text-xs font-normal text-muted">provisional</span>
          )}
        </h2>
        <p className="mb-4 text-sm text-ink/70">{tendency.tagline}</p>

        <div className="mb-2 flex justify-between text-xs text-muted">
          <span>Engineer</span>
          <span>Artist</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-ink/10">
          <span
            // 0 = pure Engineer, 100 = pure Artist.
            style={{ left: `${result.tendency}%` }}
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
          />
        </div>

        <div className="mt-4 space-y-3">
          {tendency.profile.map((para) => (
            <p key={para.slice(0, 24)} className="text-sm leading-relaxed text-ink/70">
              {para}
            </p>
          ))}
        </div>
        </section>
      )}

      {/*
        ── Time bars ──────────────────────────────────────────────────────

        Full diagnosis only. The first read stops at the Skill Band by design — it is the
        "here's what we've learned so far" teaser, not the whole picture — and the second read
        never carried them.
      */}
      {breakdown && isFull && noVolume && (
        <section className="mb-10">
          <h2 className="mb-1 font-bold tracking-tight">Where your time actually goes</h2>
          <p className="text-sm leading-relaxed text-ink/60">
            You told us you don't practise or play in an average week, so there's no time split
            to show. Everything above reads your answers about how you practise — come back and
            change your practice week whenever that starts.
          </p>
        </section>
      )}

      {breakdown && isFull && !noVolume && (
        <section className="mb-10">
          <h2 className="mb-1 font-bold tracking-tight">Where your time actually goes</h2>
          <p className="mb-5 text-sm text-muted">{TIME_BARS_CAPTION}</p>

          <div className="space-y-4">
            {ZONE_ORDER.map((zone) => (
              <TimeBar
                key={zone}
                label={ZONES[zone].label}
                minutes={breakdown.minutes[zone]}
                share={breakdown.alloc[zone]}
                recommended={ALLOC_BENCHMARK[zone]}
                dim={starved.includes(zone)}
              />
            ))}
            <TimeBar
              label="Messy Middle"
              minutes={breakdown.minutes.messy}
              share={breakdown.messyShare}
              // §4e: the benchmark for undeclared practice is "roughly none".
              recommended={0}
              recommendedNote="0–10%"
            />
          </div>

          <p className="mt-5 text-sm text-ink/60">
            Declared practice: <strong>{Math.round(breakdown.focusScore)}%</strong> of{' '}
            {formatMinutes(breakdown.effectiveTotal)} a week.
            {/* `run.volume` doesn't exist in this port (see the `breakdown` comment above) —
                this whole block is currently unreachable since `breakdown` is always null, but
                the courseHours-credit caveat has no data to test once it isn't. */}
          </p>

          <MessyCallout share={breakdown.messyShare} />
        </section>
      )}

      {/* ── Efficiency ────────────────────────────────────────────────────── */}
      {/* Full diagnosis only, alongside the time bars whose shifts the score responds to. */}
      {isFull && (
        <section className="mb-10 rounded-lg border border-ink/10 bg-ink/10 p-5">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="font-bold tracking-tight">Practice efficiency</h2>
          <span className="text-2xl font-bold tabular-nums">{Math.round(eff.value)}</span>
        </div>
        <p className="mb-2 text-sm font-medium">{band.label}</p>
        <p className="mb-3 text-sm leading-relaxed text-ink/70">{band.blurb}</p>

        {/*
          Shown only when there's a penalty to explain. It makes the prescription's claim
          checkable — a golfer can see the points undeclared practice is costing them, which is
          the number declaring a zone gives back. Factual label rather than persuasion, but the
          wording is still mine and wants Luke's eye.
        */}
        {eff.penalty > 0 && (
          <p className="mb-3 text-sm leading-relaxed text-ink/70">
            That includes <strong>−{eff.penalty}</strong> for undeclared practice. Declaring a
            zone before each session is what earns those points back.
          </p>
        )}

        <p className="text-xs leading-relaxed text-muted">{EFFICIENCY_CAPTION}</p>
        </section>
      )}

      {/* ── Skill band ────────────────────────────────────────────────────── */}
      {/* The one block every read keeps — it is where the first read stops. */}
      <section className="mb-10">
        <h2 className="mb-4 font-bold tracking-tight">Your Skill Band</h2>
        <div className="space-y-4">
          {ZONE_ORDER.map((zone) => {
            const status = result.masteryStatus[zone];
            const content = ZONES[zone];
            return (
              <div key={zone}>
                <p className="flex items-baseline gap-2 font-medium">
                  {content.label}
                  <span className="text-xs text-muted capitalize">{status}</span>
                </p>
                <p className="text-sm leading-snug text-ink/70">
                  {/* 'locked' means not measured yet — its copy sells the next level. */}
                  {status === 'locked' ? content.locked : content.status[status]}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Zone effectiveness grades ─────────────────────────────────────── */}
      {/* `hasGrades` is already false before Tier 2, so `!isBaseline` is belt-and-braces —
          it keeps the first read's floor explicit rather than incidental. */}
      {hasGrades && !isBaseline && (
        <section className="mb-10">
          <h2 className="mb-1 font-bold tracking-tight">Zone effectiveness</h2>

          {/*
            ⚠️  CRITERION-REFERENCED, NOT NORM-REFERENCED. These grades measure distance from
            each zone's characteristic false prior — how well the golfer's thinking matches what
            that zone actually rewards. They are NOT a ranking against other golfers, and the
            copy must never imply one: there is no population data yet, so "C = average golfer"
            would be a claim we cannot back. That's the same No Fiction problem that put peer
            comparison behind a flag, switched off.

            This wording is mine and Luke is confirming the real thing. Whatever replaces it has
            to keep the second sentence's job — the disclaimer is load-bearing, not decoration.
          */}
          <p className="mb-5 text-sm text-muted">
            How closely your thinking in each zone matches what that zone actually rewards. Not a
            comparison against other golfers — it's measured against the zone itself.
          </p>

          <div className="space-y-3">
            {ZONE_ORDER.map((zone) => (
              <ZoneGradeRow
                key={zone}
                label={ZONES[zone].label}
                effectiveness={grades[zone]}
              />
            ))}
          </div>
        </section>
      )}

      {/*
        ── Pattern + chips ────────────────────────────────────────────────

        A Ghost read is the claim "there's a zone your game has never met", so it only makes
        sense while some zone is actually named as starved. When the tie rule withdraws that,
        this panel has to go with it — otherwise the screen announces a neglected zone and then
        declines to say which, with every bar sitting on the same percentage. Illusionist and
        Prisoner carry no ghostZone, so they are unaffected.

        Full diagnosis only. On the second read the Ghost panel named a starved zone next to a
        Map the golfer was meeting for the first time, and repeated the growth prescription's
        instruction in different words — two fixes for one finding, on the screen with the least
        room for it (Teddy, 2026-08-14).
      */}
      {isFull && result.pattern && (result.pattern !== 'ghost' || starved.length > 0) && (
        <section className="mb-10 rounded-lg border border-clay/40 bg-clay/5 p-5">
          <p className="mb-1 text-xs tracking-[0.2em] text-muted uppercase">
            {PATTERNS[result.pattern].name}
          </p>
          <h2 className="mb-2 font-bold tracking-tight">{PATTERNS[result.pattern].headline}</h2>
          <p className="mb-3 text-sm leading-relaxed text-ink/70">
            {PATTERNS[result.pattern].description}
          </p>
          <p className="text-sm leading-relaxed">
            <strong>The fix:</strong> {PATTERNS[result.pattern].fix}
          </p>
        </section>
      )}

      {!isBaseline && result.chips.length > 0 && (
        <section className="mb-10 space-y-4">
          {result.chips.map((chip) => (
            <div key={chip}>
              <p className="font-medium">{CHIPS[chip].label}</p>
              <p className="text-sm leading-snug text-ink/70">{CHIPS[chip].blurb}</p>
            </div>
          ))}
        </section>
      )}

      {/* ── Growth prescription ──────────────────────────────────────────── */}
      {!isBaseline && result.growthZone && (
        <section className="mb-10">
          <h2 className="mb-3 font-bold tracking-tight">{GROWTH[result.growthZone].headline}</h2>
          {/*
            NO PRODUCT CTA HERE YET. `GrowthPrescription.cta` still carries Flight School, the
            Practice Project and the Foundations Course, and this used to render the link and its
            blurb. None of those three are built — the hrefs are rypgolf.com paths that don't
            resolve — so the result screen was selling a golfer a ninety-day cohort, a money-back
            guarantee and a video course that they cannot buy, sign up for, or even look at
            (Teddy, 2026-08-10). Promising products that don't exist is the same No Fiction
            failure as asserting findings nothing measured, just aimed at the wallet.

            The prescription itself stays: the headline and the moves above are real practice
            advice that stands without anything to sell. The copy stays in `results-content.ts`
            too — it's Luke's, and it isn't wrong, only early. When a product actually ships, this
            is one anchor and one paragraph to put back.
          */}
          <ul className="space-y-2">
            {GROWTH[result.growthZone].moves.map((move) => (
              <li key={move} className="flex gap-2 text-sm leading-relaxed text-ink/80">
                <span aria-hidden className="text-muted">
                  —
                </span>
                {move}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        ── MI verdict ─────────────────────────────────────────────────────

        Despite the old "after Tier 2" heading this renders from the first read onward: the
        verdict only needs a handicap, which the profile screen collects, so `mi.verdict` is
        already set at baseline. Off the first read explicitly, which now stops at the Skill Band.
      */}
      {!isBaseline && result.mi.verdict && (
        <section className="mb-10">
          <h2 className="mb-2 font-bold tracking-tight">{MI_VERDICTS[result.mi.verdict].headline}</h2>
          <p className="mb-2 text-sm leading-relaxed text-ink/70">
            {MI_VERDICTS[result.mi.verdict].body}
          </p>
          <p className="text-xs leading-relaxed text-muted">
            {MI_STATE_NOTE[result.mi.state]}
            {result.mi.miRange && (
              <> Estimated Mechanics Index: {result.mi.miRange[0]}–{result.mi.miRange[1]}.</>
            )}
          </p>
        </section>
      )}

      {/* ── Next level ───────────────────────────────────────────────────── */}
      {/* Baseline's button already ran at the top of the page — one CTA per screen, not two. */}
      {!isBaseline && nextLabel && (
        <button
          type="button"
          onClick={onNext}
          className="mb-8 w-full rounded-lg bg-ink px-5 py-3 font-medium text-paper"
        >
          {nextLabel} →
        </button>
      )}

      {/* "Keep a copy" (a PDF download button) dropped here — see the import comment above.
          Nothing replaces it: the run is already a permanent row on this golfer's account. */}

      <p className="border-t border-ink/10 pt-5 text-xs leading-relaxed text-muted">
        {RESULT_DISCLAIMER}
      </p>
    </div>
  );
}

/**
 * One zone's letter grade.
 *
 * A zone the golfer hasn't reached yet renders as "—" rather than an F: no answers is not the
 * same as a bad score, and an unearned F on a screen someone paid attention to is a lie. A zone
 * they've only partly answered gets the grade plus a provisional marker.
 */
function ZoneGradeRow({
  label,
  effectiveness,
}: {
  label: string;
  effectiveness: ZoneEffectiveness;
}) {
  const { grade, score, answered, total } = effectiveness;
  const partial = answered > 0 && answered < total;

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/10 pb-3">
      <div className="min-w-0">
        <p className="font-medium">
          {label}
          {partial && (
            <span className="ml-2 text-xs font-normal text-muted">
              provisional · {answered} of {total}
            </span>
          )}
        </p>
        {grade === null && (
          <p className="text-sm text-muted">Measured in the full diagnosis.</p>
        )}
      </div>

      <div className="flex shrink-0 items-baseline gap-2">
        {score !== null && <span className="text-sm text-muted tabular-nums">{score}</span>}
        <span
          aria-label={grade === null ? 'Not yet measured' : `Grade ${grade}`}
          className={`text-2xl font-bold tabular-nums ${grade === null ? 'text-muted/50' : ''}`}
        >
          {grade ?? '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * One zone's real minutes against the benchmark. Two bars, not a single diverging one — the
 * question a golfer asks here is "how far off am I", and two lengths answer it faster than
 * a signed delta does.
 */
function TimeBar({
  label,
  minutes,
  share,
  recommended,
  recommendedNote,
  dim,
}: {
  label: string;
  minutes: number;
  share: number;
  recommended: number;
  recommendedNote?: string;
  dim?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">
          {label}
          {/* The starved zone is the headline of a Ghost pattern — say so where it shows. */}
          {dim && <span className="ml-2 text-xs font-normal text-clay">starved</span>}
        </span>
        <span className="text-muted tabular-nums">
          {formatMinutes(minutes)} · {Math.round(share)}%
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full bg-ink" style={{ width: `${Math.min(100, share)}%` }} />
      </div>

      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/5">
          <div
            className="h-full bg-muted"
            style={{ width: `${Math.min(100, recommended)}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-muted tabular-nums">
          target {recommendedNote ?? `${recommended}%`}
        </span>
      </div>
    </div>
  );
}

/** §4e — a headline card at ≥40%, a one-line note at 15–39%, nothing below that. */
function MessyCallout({ share }: { share: number }) {
  if (share >= MESSY_THRESHOLDS.headline) {
    return (
      <div className="mt-5 rounded-lg border border-clay/40 bg-clay/10 p-4">
        <p className="mb-2 font-bold tracking-tight">The Messy Middle is eating your practice.</p>
        <p className="text-sm leading-relaxed text-ink/70">
          Declare one zone per session before you start — the fastest efficiency gain available
          to you.
        </p>
      </div>
    );
  }

  if (share >= MESSY_THRESHOLDS.note) {
    return (
      <p className="mt-3 text-sm text-ink/60">
        A noticeable slice of your practice has no declared focus. Naming the zone before each
        session is the cheapest gain here.
      </p>
    );
  }

  return null;
}
