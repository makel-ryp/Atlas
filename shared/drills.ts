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
 * ⚠️ SIGN-OFF IS WRITTEN TO `verified_at`, NOT `watched_at`. Despite the feature being called
 * "have you watched", `atlas_app` holds NO column grant on `watched_at` or `ticked_at` — those are
 * the PLAYER's own claim and belong to forge_app. Column privileges confirmed on the live DB:
 * atlas_app has INSERT+UPDATE on signed_off_at / verified_at / verified_by_user_id / verify_note /
 * video_ref / updated_at only. Writing `watched_at` would raise 42501.
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
   * ⚠️ NO ATLAS WRITER EXISTS FOR 'drill' TODAY. `golf.drill_progress` has only
   * `drill_progress_coach_insert` / `_coach_update` — there is no self-insert policy — and
   * `atlas_app` holds no column grant on `ticked_at`. A student therefore cannot raise a drill for
   * review from inside Atlas; the rows that carry `ticked_at` today were written by
   * `neondb_owner`. The READ side below is complete and will light up the moment the owning app
   * writes. Recorded rather than hidden: see docs/TASKS.md.
   */
  source?: 'drill' | 'intake'
}

/**
 * The six assessment drills, mirroring `DRILL_DEFS` in Dashboard.dc.html:2438-2600. Name / domain /
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
 * The plan, mirroring `STEPS` in Dashboard.dc.html:2632-2681.
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
  { id: 'plan:1-1a', name: 'Kickstand', context: 'Step 1 · Pivot', detail: 'Cannon: trail heel down · Anchor: trail heel loaded', step: 1, group: 'plan', review: false },
  { id: 'plan:1-1b', name: 'Regular stance', context: 'Step 1 · Pivot', detail: 'Cannon: no early extension · Anchor: no sway past trail hip', step: 1, group: 'plan', review: false },
  { id: 'plan:1-2', name: 'Shift', context: 'Step 1 · Pivot', detail: 'Lead hip clears (Cannon) · lead hip posts (Anchor)', step: 1, group: 'plan', review: false },
  { id: 'plan:1-3', name: 'Load, shift, finish', context: 'Step 1 · Pivot', detail: 'Sequence intact', step: 1, group: 'plan', review: true },

  // Step 2 · Freezers
  { id: 'plan:2-F1', name: 'Choked sand wedge freezer', context: 'Step 2 · Freezers', detail: 'Held 3 seconds', step: 2, group: 'plan', review: false },
  { id: 'plan:2-F2', name: 'Full sand wedge freezer', context: 'Step 2 · Freezers', detail: 'Held 3 seconds', step: 2, group: 'plan', review: false },
  { id: 'plan:2-F3', name: '7-iron freezer', context: 'Step 2 · Freezers', detail: 'Held 3 seconds', step: 2, group: 'plan', review: false },
  { id: 'plan:2-P1', name: 'Proof Swing — path at zero', context: 'Step 2 · Freezers', detail: 'Path at zero', step: 2, group: 'plan', review: true },
  { id: 'plan:2-P2', name: 'Proof Swing — shaft lean', context: 'Step 2 · Freezers', detail: 'Shaft lean right', step: 2, group: 'plan', review: true },
  { id: 'plan:2-P3', name: 'Proof Swing — ground force', context: 'Step 2 · Freezers', detail: 'Force excellent', step: 2, group: 'plan', review: true },
  { id: 'plan:2-P4', name: 'Proof Swing — trunk angle', context: 'Step 2 · Freezers', detail: 'Decreases 5°+ (low dynamic lie angle)', step: 2, group: 'plan', review: true },

  // Step 3 · Smoothie
  { id: 'plan:3-S1', name: 'Time your smoothie', context: 'Step 3 · Smoothie', detail: 'Baseline logged', step: 3, group: 'plan', review: false },
  { id: 'plan:3-S2', name: 'First smoothie reviewed', context: 'Step 3 · Smoothie', detail: 'Tempo logged', step: 3, group: 'plan', review: true },
  { id: 'plan:3-S3', name: '5-second smoothie', context: 'Step 3 · Smoothie', detail: 'Pattern holds', step: 3, group: 'plan', review: true },
  { id: 'plan:3-S4', name: 'Tempo ladder — 8s to 5s', context: 'Step 3 · Smoothie', detail: 'Pattern holds', step: 3, group: 'plan', review: false },

  // Step 4 · Foam ball
  { id: 'plan:4-B1', name: 'Foam ball freezer', context: 'Step 4 · Foam ball', detail: 'Contact centred', step: 4, group: 'plan', review: false },
  { id: 'plan:4-B2', name: 'Foam ball — 10s to 5s', context: 'Step 4 · Foam ball', detail: 'Solid strikes', step: 4, group: 'plan', review: false },
  { id: 'plan:4-B3', name: 'Foam ball — 5s to 2s', context: 'Step 4 · Foam ball', detail: 'Solid strikes', step: 4, group: 'plan', review: true },

  // Step 5 · Real ball
  { id: 'plan:5-R1', name: 'Re-entry protocol, session one', context: 'Step 5 · Real ball', detail: 'Foam to real', step: 5, group: 'plan', review: false },
  { id: 'plan:5-R2', name: 'Calibration loop live', context: 'Step 5 · Real ball', detail: 'Dots plotted', step: 5, group: 'plan', review: false },
  { id: 'plan:5-R3', name: 'Wedge dispersion held', context: 'Step 5 · Real ball', detail: 'No large miss', step: 5, group: 'plan', review: false },
  { id: 'plan:5-R4', name: '7-iron dispersion held', context: 'Step 5 · Real ball', detail: 'No large miss', step: 5, group: 'plan', review: false },
  { id: 'plan:5-R5', name: 'Driver dispersion held', context: 'Step 5 · Real ball', detail: 'No large miss', step: 5, group: 'plan', review: true },
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
