/**
 * EVERYTHING A COACH SIGNS OFF, IN ONE LIST.
 *
 * Makel, 2026-09-15: "implement the 'have you watched' to include the plan drills, and anything
 * else that needs review via the plan."
 *
 * Until now the coach's sign-off block listed three ids hardcoded in Dashboard.dc.html
 * (`['sga30','chip20','ryp20']`) while the file's own `DRILL_DEFS` defined six and its `STEPS`
 * defined twenty-three more. A coach could not sign off most of the work a player was actually
 * being asked to do, and the plan's camera drills — the ones whose whole point is that somebody
 * watches them — had no persisted review state at all.
 *
 * ── WHY THIS IS A SHARED MODULE AND NOT A LIST IN THE PAGE ────────────────────────────────────
 * Two consumers must agree on the id space:
 *   1. `proto/Dashboard.dc.html` renders the list.
 *   2. `POST /api/coach/students/:userId/drills/:drillId/verify` writes it.
 *
 * The route took `:drillId` straight from the path into the INSERT. `golf.drill_progress.drill_id`
 * is unbounded `text` with no CHECK and no FK (verified against the live schema, 2026-09-15), so
 * any string a coach could put in a URL became a row. With three client-side ids that was
 * theoretical; with two namespaces and twenty-nine ids it is worth closing, and it can only be
 * closed against a list both sides read.
 *
 * ── THE ID SPACE ─────────────────────────────────────────────────────────────────────────────
 * Assessment drills keep their bare `DRILL_DEFS` key (`sga30`), because rows already exist in
 * `golf.drill_progress` under those ids and renaming them would orphan every sign-off made since
 * 2026-09-01. Plan drills are namespaced `plan:<step>-<ref>` (`plan:2-P1`) so the two spaces can
 * never collide — the plan's refs are short and unqualified (`1a`, `P1`, `S3`) and would be a
 * genuine collision risk bare.
 *
 * ⚠️ NO MIGRATION. `drill_id` is free text; adding ids adds rows, not columns.
 *
 * ⚠️ SIGN-OFF IS WRITTEN TO `verified_at`, NOT `watched_at`, AND THAT HAS NOT CHANGED — only the
 * reason has. It used to be a privilege: `atlas_app` held no column grant on `watched_at` or
 * `ticked_at` because those belonged to forge_app. Since 2026-10-16 it holds both (T-105 removed
 * the foreign app; see server/routes/drillTicks.ts), so the rule is now a MEANING rule and the
 * database enforces it with a trigger rather than a missing grant:
 * `watched_at` is the PLAYER saying "I opened the demo" and `ticked_at` is the PLAYER saying "I
 * did the rep". A coach writing either would be forging somebody else's claim, and
 * `app_private.drill_progress_column_owner()` raises 42501 if the coach's verify route tries.
 */

export type DrillGroup = 'assessment' | 'plan' | 'step' | 'intake'

export type ReviewItem = {
  /** Stable key in `golf.drill_progress.drill_id`. */
  id: string
  name: string
  group: DrillGroup
  /** 'Chipping' for an assessment; 'Step 2 · Freezers' for a plan drill or a step completion. */
  context: string
  /**
   * '30 shots' for an assessment; the drill's standard for a plan drill; the step's ADVANCEMENT
   * CONDITION for a step completion.
   */
  detail: string
  /**
   * True when the plan marks this drill `cam: true` — it is filmed, and somebody is supposed to
   * watch it. These are the items "anything else that needs review via the plan" refers to.
   */
  review: boolean
  /**
   * WHY this drill is prescribed — the coaching reason, not the instruction.
   *
   * Lifted out of `proto/Dashboard.dc.html`'s `WHY` map on 2026-09-21 (T-83). It lived there as a
   * JS constant keyed by DISPLAY NAME, which meant renaming a drill silently orphaned its reason
   * with nothing to catch it, and — the reason this move matters — the SERVER could not read any of
   * it. Only the browser could explain a prescription, which blocks anything smarter than the fixed
   * weekly template.
   *
   * Keyed by the stable `id` here instead. Coverage was exact at the time of the lift: 27 unique
   * plan drills, 27 WHY entries, zero missing and zero orphaned, extracted programmatically rather
   * than retyped.
   *
   * ⚠️ Step 1's four ids carry BOTH routes in one string ("Cannon — … · Anchor — …"), because one
   * review item covers both and each route has its own reason. Same convention `detail` already
   * uses. Assessment drills, step completions and the intake have no `why` — the concept is
   * plan-drill-specific, so this is optional rather than empty-string-filled.
   */
  why?: string
  /**
   * Which of the plan's five steps this belongs to, 1-5. Absent on assessment drills, which are
   * not part of the step ladder.
   *
   * Present so the page can GROUP without parsing `context`. A fold-down bar per step needs to
   * know which drills sit under which bar, and deriving that from a display string is how a
   * renamed label silently empties a section.
   */
  step?: number
  /**
   * WHERE THE STUDENT'S SUBMISSION COMES FROM — the trigger half of the review loop.
   *
   * Every reviewable thing in Atlas has the same three parts:
   *   (1) a student-owned column that records the claim  → `source`
   *   (2) a coach-readable projection of it              → RosterRow.submitted
   *   (3) a coach action that resolves it                → golf.drill_progress.verified_at
   *
   * Only (3) is shared by every item, which is why resolution lives in one table for all of them
   * regardless of what was submitted. `source` is what makes (1) pluggable: a new reviewable thing
   * declares where its trigger lives and needs no new pill, route, or policy.
   *
   *   'drill'  → golf.drill_progress.ticked_at   (the player's claim that they did the rep)
   *   'intake' → atlas.intake_submissions.completed_at
   *
   * ✅ THE 'drill' WRITER EXISTS AS OF 2026-10-16 — `POST /api/drills/:drillId/tick`, in
   * server/routes/drillTicks.ts. This note used to read: *"NO ATLAS WRITER EXISTS FOR 'drill'
   * TODAY. golf.drill_progress has only `_coach_insert` / `_coach_update` — there is no
   * self-insert policy — and atlas_app holds no column grant on ticked_at … the rows that carry
   * ticked_at today were written by neondb_owner."* All three of those are now false: the two
   * `drill_progress_self_*` policies exist, the grant covers `ticked_at` / `watched_at`, and the
   * player writes their own rows. The READ side below was complete all along and lights up with it.
   */
  source?: 'drill' | 'intake'
}

/**
 * The six assessment drills, mirroring `DRILL_DEFS` in Dashboard.dc.html. Name / domain /
 * shots are copied verbatim from there; all six were verified to carry the same three keys the
 * sign-off card renders, so none of them renders a blank line.
 */
const ASSESSMENTS: ReviewItem[] = [
  { id: 'sga30', name: 'Short Game Assessment', context: 'Chipping', detail: '30 shots', group: 'assessment', review: false },
  { id: 'chip20', name: 'Chipping Index', context: 'Chipping', detail: '20 shots', group: 'assessment', review: false },
  { id: 'ryp20', name: 'Ryp Putting Drill', context: 'Putting', detail: '20 putts', group: 'assessment', review: false },
  { id: 'stroke20', name: 'Stroke Test', context: 'Putting', detail: '20 putts', group: 'assessment', review: false },
  { id: 'appr20', name: 'Approach Index', context: 'Approach', detail: '20 shots', group: 'assessment', review: false },
  { id: 'drive20', name: 'Driving Index', context: 'Driving', detail: '20 shots', group: 'assessment', review: false },
]

/**
 * The plan, mirroring `STEPS` in Dashboard.dc.html.
 *
 * ⚠️ STEP 1 IS ROUTE-DEPENDENT. Its four drills exist in two variants — The Cannon (…Explode) and
 * The Anchor (…Post) — that share refs (`1a`,`1b`,`2`,`3`) but differ in name and standard. Which
 * route a player is on is `s.pivot` in the page, a local default of 'cannon' with NO producer:
 * nothing stores a player's route, so this file cannot know it and must not print a name implying
 * it does. The names below are therefore the SHARED movement, with the route-specific finish left
 * out; the panel says so in as many words.
 *
 * ⚠️ THE STANDARDS, HOWEVER, ARE VERBATIM. An adversarial review (2026-09-15) caught this file
 * PARAPHRASING them: `1-1b` read "No early move", a string that appears NOWHERE in the plan (the
 * Cannon says "No early extension", the Anchor "No sway past trail hip"), and `1-1a` had taken the
 * ANCHOR's standard while its name followed the Cannon. A coach would have been signing off
 * against a criterion that does not exist, with the real one visible on the roadmap screen one tab
 * away. Where the two routes differ the card now names BOTH — which is the true state of a player
 * whose route nothing records — and where they agree it is the single shared string.
 */
const PLAN: ReviewItem[] = [
  // Step 1 · Pivot — route-dependent, see above.
  { id: 'plan:1-1a', name: 'Kickstand', context: 'Step 1 · Pivot', detail: 'Cannon: trail heel down · Anchor: trail heel loaded', step: 1, group: 'plan', review: false , why: 'Cannon — Trail heel down removes the leg you cheat with, so the load has nowhere to go but the ground.  ·  Anchor — Loads the trail side without letting you launch out of it — rotation against the ground, not off it.' },
  { id: 'plan:1-1b', name: 'Regular stance', context: 'Step 1 · Pivot', detail: 'Cannon: no early extension · Anchor: no sway past trail hip', step: 1, group: 'plan', review: false , why: 'Cannon — Same force, both feet available — this is where early extension shows up if it is going to.  ·  Anchor — Catches the sway. If you pass the trail hip, you have traded rotation for width.' },
  { id: 'plan:1-2', name: 'Shift', context: 'Step 1 · Pivot', detail: 'Lead hip clears (Cannon) · lead hip posts (Anchor)', step: 1, group: 'plan', review: false , why: 'Cannon — Adds the lateral move. Force is worthless if it fires before the weight has arrived.  ·  Anchor — Teaches the lead hip to accept the weight and stop it, which is what posting actually is.' },
  { id: 'plan:1-3', name: 'Load, shift, finish', context: 'Step 1 · Pivot', detail: 'Sequence intact', step: 1, group: 'plan', review: true , why: 'Cannon — The full sequence at speed. Out of order here means out of order with a club.  ·  Anchor — The full rotational sequence. The finish should look braced, never airborne.' },

  // Step 2 · Freezers
  { id: 'plan:2-F1', name: 'Choked sand wedge freezer', context: 'Step 2 · Freezers', detail: 'Held 3 seconds', step: 2, group: 'plan', review: false , why: 'Shortest lever, least speed — the only place you can hold a position long enough to feel it.' },
  { id: 'plan:2-F2', name: 'Full sand wedge freezer', context: 'Step 2 · Freezers', detail: 'Held 3 seconds', step: 2, group: 'plan', review: false , why: 'Same shape at full length. Length is what usually breaks the pattern.' },
  { id: 'plan:2-F3', name: '7-iron freezer', context: 'Step 2 · Freezers', detail: 'Held 3 seconds', step: 2, group: 'plan', review: false , why: 'The first club long enough to punish a shallow pattern. Hold it or go back a club.' },
  { id: 'plan:2-P1', name: 'Proof Swing — path at zero', context: 'Step 2 · Freezers', detail: 'Path at zero', step: 2, group: 'plan', review: true , why: 'Path is the one impact number you can measure without a ball, so it is the first one we fix.' },
  { id: 'plan:2-P2', name: 'Proof Swing — shaft lean', context: 'Step 2 · Freezers', detail: 'Shaft lean right', step: 2, group: 'plan', review: true , why: 'Shaft lean at impact is the proof that the low point moved forward with you.' },
  { id: 'plan:2-P3', name: 'Proof Swing — ground force', context: 'Step 2 · Freezers', detail: 'Force excellent', step: 2, group: 'plan', review: true , why: 'The force trace is the honest witness — it shows whether the pivot actually did anything.' },
  { id: 'plan:2-P4', name: 'Proof Swing — trunk angle', context: 'Step 2 · Freezers', detail: 'Decreases 5°+ (low dynamic lie angle)', step: 2, group: 'plan', review: true , why: 'A decreasing trunk angle means you are covering the ball rather than backing off it.' },

  // Step 3 · Smoothie
  { id: 'plan:3-S1', name: 'Time your smoothie', context: 'Step 3 · Smoothie', detail: 'Baseline logged', step: 3, group: 'plan', review: false , why: 'Your baseline tempo. Every rung after this is measured against this number, not a textbook.' },
  { id: 'plan:3-S2', name: 'First smoothie reviewed', context: 'Step 3 · Smoothie', detail: 'Tempo logged', step: 3, group: 'plan', review: true , why: 'A second pair of eyes before you drill the tempo in — you cannot see your own transition.' },
  { id: 'plan:3-S3', name: '5-second smoothie', context: 'Step 3 · Smoothie', detail: 'Pattern holds', step: 3, group: 'plan', review: true , why: 'Five seconds is slow enough to hold the pattern and fast enough to feel like a swing.' },
  { id: 'plan:3-S4', name: 'Tempo ladder — 8s to 5s', context: 'Step 3 · Smoothie', detail: 'Pattern holds', step: 3, group: 'plan', review: false , why: 'Speed is added a rung at a time so the pattern never has to survive a jump.' },

  // Step 4 · Foam ball
  { id: 'plan:4-B1', name: 'Foam ball freezer', context: 'Step 4 · Foam ball', detail: 'Contact centred', step: 4, group: 'plan', review: false , why: 'An object to hit changes everything. Foam gives you the intent without the consequence.' },
  { id: 'plan:4-B2', name: 'Foam ball — 10s to 5s', context: 'Step 4 · Foam ball', detail: 'Solid strikes', step: 4, group: 'plan', review: false , why: 'Re-earns the tempo ladder now that there is a target. Strike quality is the pass mark.' },
  { id: 'plan:4-B3', name: 'Foam ball — 5s to 2s', context: 'Step 4 · Foam ball', detail: 'Solid strikes', step: 4, group: 'plan', review: true , why: 'Two seconds is close to real speed. Solid here means the pattern is nearly yours.' },

  // Step 5 · Real ball
  { id: 'plan:5-R1', name: 'Re-entry protocol, session one', context: 'Step 5 · Real ball', detail: 'Foam to real', step: 5, group: 'plan', review: false , why: 'Real ball, deliberately under-dosed. Most players lose the build in the first ten real swings.' },
  { id: 'plan:5-R2', name: 'Calibration loop live', context: 'Step 5 · Real ball', detail: 'Dots plotted', step: 5, group: 'plan', review: false , why: 'Plotting starts now so the pattern is measured from the first real session, not remembered later.' },
  { id: 'plan:5-R3', name: 'Wedge dispersion held', context: 'Step 5 · Real ball', detail: 'No large miss', step: 5, group: 'plan', review: false , why: 'The wedge is the control. If the pattern holds anywhere, it holds here.' },
  { id: 'plan:5-R4', name: '7-iron dispersion held', context: 'Step 5 · Real ball', detail: 'No large miss', step: 5, group: 'plan', review: false , why: 'Mid-iron dispersion is the truest read on whether strike and path survived the transfer.' },
  { id: 'plan:5-R5', name: 'Driver dispersion held', context: 'Step 5 · Real ball', detail: 'No large miss', step: 5, group: 'plan', review: true , why: 'Longest club, biggest error multiplier — the last exam the build has to pass.' },
]

/**
 * STEP COMPLETIONS — the other thing the plan asks a coach to review.
 *
 * Makel, 2026-09-15: "the plan drills, AND ANYTHING ELSE that needs review via the plan."
 *
 * Each of Luke's five steps ends in a coach's judgement, not just a pile of ticked drills: the
 * roadmap renders a "Request completion" button that resolves to "Completed · Dr. Benoit"
 * (Dashboard.dc.html `signLabel`). That sign-off was `state.signed = [1, 2]` — a hardcoded array
 * in the page, local to the browser tab, lost on reload and never seen by the student. It is the
 * step-level twin of the drill tick and it gets the same persisted treatment.
 *
 * `detail` is the step's own `cond` — the advancement criterion Luke wrote and which nothing has
 * ever evaluated (docs/TASKS.md T-43). Nothing evaluates it here either: a coach reads the
 * condition and makes the call. That is honest, and it is what the button already claimed to do.
 */
const STEP_COMPLETIONS: ReviewItem[] = [
  { id: 'plan:step-1', name: 'Step 1 complete \u2014 Pivot', context: 'Step 1 \u00b7 Pivot', detail: 'All four drills verified on camera', step: 1, group: 'step', review: true },
  { id: 'plan:step-2', name: 'Step 2 complete \u2014 Freezers', context: 'Step 2 \u00b7 Freezers', detail: 'Path at zero, shaft lean right, ground force excellent, trunk angle decreasing', step: 2, group: 'step', review: true },
  { id: 'plan:step-3', name: 'Step 3 complete \u2014 Smoothie', context: 'Step 3 \u00b7 Smoothie', detail: 'A clean 5-second smoothie, reviewed', step: 3, group: 'step', review: true },
  { id: 'plan:step-4', name: 'Step 4 complete \u2014 Foam ball', context: 'Step 4 \u00b7 Foam ball', detail: 'Solid strikes at two seconds, on camera', step: 4, group: 'step', review: true },
  { id: 'plan:step-5', name: 'Step 5 complete \u2014 Real ball', context: 'Step 5 \u00b7 Real ball', detail: 'Dispersion held across all three clubs', step: 5, group: 'step', review: true },
]

/**
 * THE INTAKE — the one reviewable thing a student can actually trigger in Atlas today.
 *
 * `atlas.intake_submissions` is student-owned (`intake_submissions_insert_own` /
 * `_update_own`) and coach-readable through the `atlas.student_intake` view, so a student
 * finishing their Practice DNA IS a student-triggered event a coach should act on. It had no
 * resolution state anywhere — the coach could read the result and nothing recorded that they had.
 *
 * It resolves the same way everything else does: a row in `golf.drill_progress` keyed by this id.
 * `drill_id` is free text with no CHECK and no FK, so a non-drill review item costs no migration
 * and no second mechanism. That is the whole point of the `source` field above.
 */
const INTAKE: ReviewItem[] = [
  {
    id: 'intake:practice-dna',
    name: 'Practice DNA read',
    context: 'Intake',
    detail: 'Read through with the player',
    group: 'intake',
    review: true,
    source: 'intake',
  },
]

/**
 * Assessments first, then the plan in step order, then the five step completions, then the intake.
 * The order a coach reads them in: what was measured, what was practised, what that adds up to,
 * and who they are.
 */
export const REVIEW_ITEMS: readonly ReviewItem[] = [...ASSESSMENTS, ...PLAN, ...STEP_COMPLETIONS, ...INTAKE]

/**
 * The id allowlist the verify route checks a path param against. A Set so the check is O(1) and so
 * a duplicate id in the arrays above collapses instead of silently shadowing.
 */
export const REVIEW_ITEM_IDS: ReadonlySet<string> = new Set(REVIEW_ITEMS.map((d) => d.id))

/** True when this id is something a coach is allowed to sign off. */
export function isReviewItemId(id: string): boolean {
  return REVIEW_ITEM_IDS.has(id)
}

/**
 * True for the 23 PLAN DRILLS, and nothing else — the exact set a player may tick.
 *
 * ⚠️ NARROWER THAN `isReviewItemId` ON PURPOSE, and the difference is the denominator of "N of 23
 * drills completed". That function also admits the six assessments (scored tests, not reps you
 * tick), the intake, and `plan:step-N` (DERIVED — a step signs itself off when its drills are
 * verified, so a hand-written tick on one is refused for the same reason the coach's is). Using it
 * as the tick route's gate would let a legitimate-looking id inflate the numerator of the count
 * this whole feature exists to make honest.
 *
 * The same shape as `isStepCompletionId` deliberately: both read `group` off the one list, so a
 * drill moved between groups cannot leave two gates disagreeing.
 */
export function isPlanDrillId(id: string): boolean {
  return REVIEW_ITEMS.some((d) => d.id === id && d.group === 'plan')
}

/**
 * The step-completion ids (`plan:step-1` … `plan:step-5`), and the drills each one is made of.
 *
 * ── Why this exists, 2026-09-25 ─────────────────────────────────────────────────────────────
 * Makel settled the question `eco/sql/rls_core.sql:1213` was blocking on — "decide whether
 * verified/signed are genuinely two coach actions or one" — with a third answer: TWO facts, but
 * the second is DERIVED. A coach verifies each drill; the step signs itself off when all of its
 * drills are verified.
 *
 * That makes "which drills belong to step N" a rule the SERVER has to know, not just the page.
 * It lives here rather than in the route because `REVIEW_ITEMS` is already the one list both
 * sides read, and a second copy of the step→drills mapping in TypeScript is exactly the drift
 * this module exists to prevent.
 */
export function isStepCompletionId(id: string): boolean {
  return REVIEW_ITEMS.some((d) => d.id === id && d.group === 'step')
}

/** The `plan:step-N` id a plan drill rolls up into, or null if the id is not a plan drill. */
export function stepCompletionIdFor(drillId: string): string | null {
  const item = REVIEW_ITEMS.find((d) => d.id === drillId)
  if (!item || item.group !== 'plan' || item.step === undefined) return null
  return `plan:step-${item.step}`
}

/**
 * Every plan drill in a step — the set that must ALL be verified for the step to sign off.
 *
 * ⚠️ Deliberately excludes `group: 'step'` itself. Including the step row in its own precondition
 * is a rule that can never be satisfied, and it is an easy mistake to make from the id shape
 * alone (`plan:step-1` starts with `plan:`).
 */
export function drillIdsInStep(step: number): string[] {
  return REVIEW_ITEMS.filter((d) => d.group === 'plan' && d.step === step).map((d) => d.id)
}
