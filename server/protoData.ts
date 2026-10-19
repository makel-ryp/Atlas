import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { withRls } from '@ryp/eco/db'
import {
  atlasCoachingNotes,
  golfDrillProgress,
  golfDrillReviewRequests,
  golfPracticeSessions,
  atlasMessages,
  golfPlayerProfile,
  orgMemberships,
  organizations,
  userRelationships,
  users,
} from '@ryp/eco/schema'
import { pool } from './db'
import { summarizeRun, type DnaSummary } from './dnaSummary'
import { REVIEW_ITEMS, type ReviewItem } from '../shared/drills'
// Mirrors app_private.is_minor() on the SQL side. Two copies of one threshold, asserted equal by
// scripts/smoke.ts — a policy cannot import TypeScript, so the duplication is unavoidable and the
// check is what keeps them honest.
import { isMinor } from '../shared/consent'

/**
 * The data half of serving Luke's prototype: builds the single blob the page reads as
 * `window.__ATLAS_DATA__`. `server/routes/proto.ts` injects it; `proto/Dashboard.dc.html` does
 * `const ROSTER = (window.__ATLAS_DATA__ && window.__ATLAS_DATA__.roster) || []`.
 *
 * ── The one rule this file exists to enforce ────────────────────────────────────────────────────
 * A field with no producer is EMPTY, never a sample value. His row carries ~20 keys; ryp-core has
 * producers for ten of them (id, n, hcp, carry, hand, intake, target, tier, zone, dupe) plus the
 * relational blocks (drills, notes, submitted, dna, file). The rest are Forge outputs that do not
 * exist yet, and they come back '' / {} / [] / null.
 * ⚠️ Counted 2026-09-21. The previous "six of them … other fourteen" was wrong in both numbers
 * and in the direction — it had been overtaken four times without being recounted.
 *
 * This is not fastidiousness. The earlier version of this page regex-substituted keys inside his
 * literal and a real student rendered carrying another player's handicap — a screen that looks live
 * and is not. Two fields are worse still: `read` and `note` are NARRATIVE PROSE ABOUT A PERSON. A
 * sentence about one golfer's L4/L5 disc under another golfer's name is not a cosmetic bug.
 *
 * ── Why the shape is duplicated here rather than imported from his file ─────────────────────────
 * `RosterRow` below is the contract, and it is deliberately declared on this side: his `.dc.html`
 * is the artifact and is not ours to import from. If he adds a key, this type is where it lands and
 * the compiler says so.
 */

/** Exactly the fields his render touches. Every one is populated below — none is optional. */
export type RosterRow = {
  /** Stable per player. His sample used slugs ('hale'); we use the uuid. */
  id: string
  /** Display name, or email when the account never set one. public.users. */
  n: string
  /** golf.player_profile.handicap_index. `numeric` arrives from pg as a string; converted once. */
  hcp: number | null
  /** e.g. '268 yd driver carry'. '' when golf.player_profile has no driver_carry_yds. */
  carry: string
  /** 'Right-handed' | 'Left-handed' | ''. See the note at `handLabel` — '' matters. */
  hand: string
  /** Status line describing how this student got onto the roster. From the edge / the membership. */
  intake: string
  /**
   * The student's email, but ONLY when another student on this roster shares their display name.
   * '' otherwise.
   *
   * Two real people can be called John Smith, and a roster that shows the name alone then gives a
   * coach no way to tell which row is which — the meta line underneath is no help either, since
   * on the ROSTER path tier, zone and practice days are still shipped empty (:1017-1018) and so
   * read identically for everyone. (A player's own `meRow` does carry tier/zone since 2026-09-17;
   * the roster does not.) Filled in
   * below, after the rows exist, because whether a name is ambiguous is a property of the SET and
   * not of the person.
   */
  dupe: string

  /**
   * Practice-intensity commitment: 'foundation' | 'builder' | 'competitive', or '' when the golfer
   * has not answered. REAL since 2026-09-17 — asked in the interview, and read back on BOTH `me`
   * and `meRow` (a value on only one of them was the bug f437aa6 shipped).
   * NOT billing: public.plans (free/pro) is a separate ladder and is not wired to this.
   * ⚠️ Still '' on the ROSTER path (:1017-1018) — a coach does not yet see a student's tier.
   */
  tier: string
  /**
   * Curriculum phase as a string, '1'..'4', or '' when unanswered. Carried on the `zone` key
   * because that is what Luke's markup reads; the interview stores it under `phase`. The profile
   * meta line prints it as "Phase N" — "zone" in the prototype means the four PRACTICE zones and
   * the phase numbers do not map onto them.
   * ⚠️ Same roster caveat as `tier`.
   */
  zone: string
  /** Target handicap. REAL since 2026-09-03 — `golf.player_profile.target_handicap` exists and is read below. */
  target: number | null

  // ── NO PRODUCER. Present so his render finds the key, empty because nothing writes it. ────────
  /** Practice days. Needs a `practice_days` producer; none exists. */
  days: number | null
  /** Primary leak. Forge. */
  leak: string
  /** Strokes-gained series. Forge. */
  sg: number[]
  /** Six fixed lookback buckets {m3,m6,y1,y3,y5,y10}. Always {} — see THE `hist` NOTE below. */
  hist: Record<string, number | null>
  /** ⚠️ Narrative prose about a person. Forge. */
  read: Record<string, string>
  /** ⚠️ Narrative prose about a person. Forge. */
  note: Record<string, string>
  /** Per-axis tone flags. Forge. */
  tone: Record<string, string>
  /**
   * NOT the intake answer sheet — I got this wrong on 2026-09-16 and the correction matters, because
   * the wrong reading invites someone to wire `atlas.intake_submissions.answers` to it and leak
   * personality and attention-check items to a coach.
   *
   * It is the player's four SELF-ESTIMATE bands (0-4) keyed by `path`/`face`/`contact`/`lowpoint`
   * — `who.answer[k]` in the `CATS` block in Dashboard.dc.html, sitting beside `read`,
   * `tone` and `note` for the same four axes. It belongs to the ten-shot video test, REMOVED
   * 2026-09-03 (see the `REMOVED 2026-09-03: the ten-shot video test` note in Dashboard.dc.html;
   * Makel: "we cant complete it properly").
   *
   * So this is permanently empty, not withheld and not awaiting a producer: the feature was
   * cancelled, its consumer was deleted, and the sections that rendered it (`intake`, `evidence`)
   * are hidden from BOTH audiences. The intake answers are a different thing entirely and never
   * leave the server — see `dnaSummary.ts`.
   */
  answer: Record<string, number>
  /** Coach estimates. No producer. */
  est: Record<string, number>
  /** Dispersion grid. Forge. */
  grid: number[]
  /**
   * The WHOLE `interview` object — EIGHT keys since 2026-09-17, not five: the five prose answers
   * plus `target` (a number), `tier` and `phase` (closed choices). His markup renders five of
   * them; the rest ride along because this spreads the column rather than picking keys. REAL
   * since the intake's `interview`
   * block landed: `atlas.intake_submissions.interview`, read at :820 for the player and :1006 for
   * a coach. Empty only for a run that never reached the interview screen.
   */
  file: Record<string, string>
  /**
   * Coach sign-off state, keyed by drill id. REAL — golf.drill_progress, written by a coach after
   * they watch the swing video in Parallax. `verifiedAt` null (or the key absent) means not yet
   * signed off; it never means the player did not do it, which is `tickedAt` — the player's own
   * claim, written by the player (routes/drillTicks.ts) since 2026-10-16.
   */
  drills: Record<
    string,
    {
      verifiedAt: string | null
      /**
       * When this step became COMPLETE. Derived, not judged — see the rollup in
       * routes/coach.ts. Only ever set on a `plan:step-N` row.
       *
       * ⚠️ Added 2026-09-25 and the payload is the point: the route began writing
       * `signed_off_at`, and `me.drills[id]` did not carry it, so the page could not have seen
       * it. That is precisely how f437aa6 shipped inert — a correct write into a key nothing
       * reads. Injected here, read by the `signed` derivation in the prototype's state seed.
       */
      signedOffAt: string | null
      videoRef: string | null
      verifyNote: string | null
      /**
       * THE PLAYER'S OWN CLAIM that they did the rep. ⚠️ NO LONGER READ-ONLY, 2026-10-16. This
       * note used to say `atlas_app` held SELECT and no INSERT or UPDATE and that "only
       * neondb_owner can write it" — true then, and the reason the build screen told every player
       * "0 of 23 drills completed" from a column nothing filled. The player writes it now, through
       * POST /api/drills/:id/tick. It is still never written on a COACH's path: the trigger
       * `app_private.drill_progress_column_owner()` raises 42501 if coach.ts ever tries.
       *
       * Why it travels: `ticked_at` set with `verified_at` null is a player WAITING ON THEIR
       * COACH. Without it the sign-off list renders that case identically to a drill nobody has
       * ever touched — which is what it did until now, while `Avery Lane / chip20` sat ticked with
       * a Parallax ref from 2026-09-08 and no one could see it was outstanding.
       */
      tickedAt: string | null
      /**
       * The player opened the demo video. Same ownership and the same trigger-enforced rule as
       * `tickedAt`.
       *
       * ⚠️ READ BY NOTHING UNTIL 2026-10-16 — "shipped and read by nothing (checked 2026-09-21)"
       * was the honest state while the prototype's `watched` list was per-session React state,
       * reset on every load. It is now seeded from this column, so the gold "not watched yet" dot
       * survives a reload, and POST /api/drills/:id/watched is what fills it.
       */
      watchedAt: string | null
    }
  >
  /**
   * Coaching notes ABOUT this student. REAL — atlas.coaching_notes.
   *
   * ⚠️ Not to be confused with `note` above, which is Forge narrative prose with no producer. This
   * is the written half of the coaching loop: the coach ticks a drill (`drills`) and says why
   * (`notes`). Newest first.
   *
   * Every row here arrived through `atlas.coaching_notes_select`, so the filtering is the
   * database's, not this file's — see the query for why that matters for `visibility`.
   */
  notes: CoachingNoteRow[]
  /**
   * WHEN THE STUDENT RAISED EACH REVIEW ITEM — keyed by `ReviewItem.id`, ISO timestamps.
   *
   * The trigger half of the review loop, resolved ONCE, server-side, for every source. A key
   * present means this student has done their part and is waiting on a coach; the resolution is
   * `drills[id].verifiedAt`, so the whole rule is:
   *
   *     waiting  =  submitted[id] && !drills[id]?.verifiedAt
   *
   * ⚠️ ONE RULE, ONE PLACE. The page used to derive this from `drills[id].tickedAt` itself, which
   * worked only because every reviewable thing happened to be a drill. Anything whose trigger
   * lives in another table (the intake already does) would have needed a second rule in the
   * client, and two rules that mean the same thing are how a submission goes unnoticed. The page
   * now reads this map and decides nothing.
   */
  submitted: Record<string, string>
  /**
   * The thread between the CALLER and this person. Empty for a student the coach has never
   * messaged, and empty for everyone when DMs are unavailable — see atlas.messages' insert policy,
   * which refuses when either party is under 18.
   */
  messages: { id: string; mine: boolean; who: string; body: string; at: string | null; read: boolean }[]
  /**
   * What the PLAYER sees on their own Practice DNA result screen, projected down to the parts a
   * coach may read. REAL — scored on the fly from `atlas.intake_submissions`, never stored.
   *
   * null means "no read on file": either no submission, or a submission whose profile block is
   * incomplete and therefore not scoreable. It is not the same as a read that came back thin —
   * a thin read has `depth: 'baseline'` and mostly `locked` zones, which is a real answer.
   *
   * ⚠️ The shape is an ALLOWLIST built in server/dnaSummary.ts. The full `PracticeDnaResult`
   * carries the attention-check report, the raw personality scale scores and the Mini-IPIP
   * traits; none of them reach this type, and the raw `answers` they are derived from never
   * leaves the server. See the header of that file before adding a field here.
   */
  dna: DnaSummary | null
}

/**
 * One coaching note, as the prototype receives it.
 *
 * `visibility` travels to the client because the COACH must see it: a note they can read is not
 * necessarily a note the student can read, and the difference has to be visible on the card or a
 * coach cannot tell what they have already said to whom. It is never a filter on the client —
 * `coaching_notes_select` has already decided which rows exist.
 */
export type CoachingNoteRow = {
  id: string
  body: string
  visibility: string
  /** Display name, or null when the author never set one. The client prints a dash, not an email. */
  author: string | null
  /** True when the caller wrote it. Drives 'You' vs the author's name. */
  mine: boolean
  createdAt: string
}

/**
 * Every RosterRow key at its honest empty.
 *
 * The base for `meRow` below, so that adding a key to RosterRow forces a decision here rather than
 * silently leaving the caller's own record missing it. Mirrors `EMPTY_PLAYER` in his file.
 */
const EMPTY_ROSTER_ROW: RosterRow = {
  id: '', n: '', tier: '', zone: '', hcp: null, target: null, days: null, leak: '',
  hand: '', carry: '', intake: '', dupe: '', sg: [], hist: {}, read: {}, note: {}, tone: {},
  answer: {}, est: {}, grid: [], file: {}, drills: {}, notes: [], submitted: {}, messages: [], dna: null,
}

/**
 * WHICH SECTIONS EACH ROLE SEES. This is the bifurcation — one list per audience, no second app.
 *
 * Luke's file is the whole product: twelve rail-routed player views plus a three-screen coach
 * triad (Roster -> Player file -> Intake) in the same shell. Serving it unfiltered gave a coach
 * eleven screens about their own golf and buried the one thing they came for. Building a separate
 * coach app would fork his design. Every section is `sc-if`-guarded, so filtering is a list.
 *
 * A COACH gets the roster and the player file. Nothing else: a coach signing in to see who needs
 * them does not need a tempo ladder, a fitness log or their own four-zone build (Makel,
 * 2026-09-01: "there doesn't need to be so much clutter for the coach").
 *
 * A PLAYER gets their own app, minus the roster they have no business seeing.
 *
 * BOTH lose 'intake' and 'evidence' — the ten-shots-one-7-iron video test. Four measured reads,
 * four self-estimates and a 3x3 strike map, all read by a coach off a filmed set. No
 * video-capture or coach-measurement pipeline exists and none is planned: "this whole 10 shots
 * one 7 iron section is unachievable".
 *
 * ⚠️ The player file (Luke's line 357) ALSO renders "Ten shots, one 7-iron", the strike map and
 * an awareness score — that content is inside the profile section, not inside 'evidence', so
 * hiding those two did not remove it. Tracked separately; see docs/TASKS.md.
 */
const VIDEO_TEST_SECTIONS = ['intake', 'evidence'] as const

/**
 * The physical movement screen inside the Fitness tab — pelvic rotation, torso separation, ankle
 * dorsiflexion, single-leg balance, overhead squat, each graded Pass/Limited by a named coach
 * (the `FITNESS` block in Dashboard.dc.html).
 *
 * Cut for v1 (Makel, 2026-09-10: "the whole physical screen thing is not doable"). It needs an
 * in-person screening by a movement coach on a four-week cadence, which is not a pipeline we have.
 *
 * NOT the whole Fitness tab — the programming and Speed blocks stay, because those are workouts a
 * player can actually be given. This is a sub-block guard, so it is its own key rather than a
 * member of the section list.
 */
const FITNESS_SCREEN = ['fitnessScreen'] as const

/**
 * The rail's METRIC blocks — every number vs / total SG, target handicap, practice, real,
 * transfer gap, the guarantee.
 *
 * Hidden for a coach, never for a player. On a coach's login every one of these is the COACH's own
 * golf: their handicap as the benchmark, their target, their transfer gap — printed beside a
 * student's file, where the only plausible reading is that they belong to the student. Three of
 * them already render as dashes for everyone because their inputs are Forge's, so what this
 * removes is mostly noise; what it prevents is the misattribution.
 *
 * ⚠️ NOT the rail's nav, and NOT the 'The four zones' group label, which is navigation and stays.
 * A sub-block guard like FITNESS_SCREEN, hence its own key rather than a member of the section list.
 */
const RAIL_METRICS = ['railMetrics'] as const

const PLAYER_ONLY = ['today', 'cal', 'plan', 'build', 'fitness', 'transfer', 'perf', 'thread'] as const

/**
 * Screens whose every number is a Forge output that has no producer yet — hidden from EVERYONE
 * until Forge ships, rather than rendered full of demo literals.
 *
 * ── Why, Makel 2026-09-25 ───────────────────────────────────────────────────────────────────
 * His alpha note said the Transfer window was "fine". It was the opposite. Every value on it —
 * the four practice indices, the transfer gap, the challenge level, the dated virtual rounds,
 * the quarterly history — comes from `forgeVals()`, whose only input is `state.forge`: a
 * HARDCODED object in the prototype's state seed that no code path ever overwrites. So every
 * account saw Luke's identical demo numbers presented as their own strokes-gained.
 *
 * Same class as the rail's fabricated figures (B-10), the fitness literals (T-85) and the
 * invented message thread (T-80) — and the largest one that was left.
 *
 * ── Why HIDE rather than EMPTY ──────────────────────────────────────────────────────────────
 * Makel's call, and it is the right one: "Hide but keep it ready for when we get a copy of
 * forge." Emptying `state.forge` would leave a skeleton screen of dashes that still has to be
 * designed, maintained and explained; hiding closes the section AND its nav item through the
 * mechanism Luke's markup already has (`sc-if`), and every line of forgeVals, the session flow
 * and the virtual-round picker stays exactly where it is. When Forge produces real indices,
 * deleting one entry here turns the whole screen back on.
 *
 * 'perf' (Performance) joined it on Makel's instruction, 2026-09-25 — "hide performance too". It
 * had the identical defect: every number on it comes from the same hardcoded `state.forge` seed,
 * so it rendered Luke's demo strokes-gained as the golfer's own. It was held back one round only
 * because he had named Transfer and nothing else, and pulling a second screen out from under five
 * testers on inference is not a call to make unasked.
 */
const FORGE_ONLY_SCREENS = ['transfer', 'perf'] as const

export const HIDDEN_FOR_COACH: readonly string[] = [
  ...VIDEO_TEST_SECTIONS, ...PLAYER_ONLY, ...FITNESS_SCREEN, ...RAIL_METRICS,
]
export const HIDDEN_FOR_PLAYER: readonly string[] = [
  ...VIDEO_TEST_SECTIONS, ...FITNESS_SCREEN, ...FORGE_ONLY_SCREENS, 'roster',
]

export type AtlasData = {
  /**
   * Which of the file's four views to open on: 'today' | 'roster' | 'profile' | 'cal'.
   *
   * Luke's Dashboard is ONE app for both audiences — everybody gets the same player dashboard
   * (today, the four zones, plan, calendar) and a coach's addition is the roster tab plus the
   * student dossiers it opens. Its initial state hardcoded 'today', so a coach signing in landed
   * on a player's screen and asked, reasonably, why they were looking at the wrong product.
   * Only the server knows who is asking, so the server picks the tab.
   */
  view: 'today' | 'roster'
  /**
   * Section keys the served page must not show. Each of Luke's sections is `sc-if`-guarded, so
   * this closes the section AND removes its nav item without touching his markup.
   *
   * 'intake' + 'evidence' are the ten-shots-one-7-iron video test: four measured reads, four
   * self-estimates and a 3x3 strike map, all read by a coach off a filmed set. There is no
   * video-capture or coach-measurement pipeline and there is not going to be one
   * (Makel, 2026-09-01: "this whole 10 shots one 7 iron section is unachievable").
   */
  hidden: readonly string[]
  roster: RosterRow[]
  /**
   * EVERYTHING A COACH SIGNS OFF — the six assessment drills plus the twenty-three plan drills.
   *
   * Injected rather than hardcoded in the page because the VERIFY ROUTE validates against the same
   * list (server/routes/coach.ts). A list in the HTML and a list in the route are two lists, and
   * the failure mode is a card a coach can click that the server then rejects.
   *
   * This is a catalogue, not per-player state. Whether a given player has been signed off on a
   * given item is `RosterRow.drills`, keyed by these ids.
   */
  reviewItems: readonly ReviewItem[]
  /** The signed-in coach. `hcp` is the raw `numeric` string here — see the type note below. */
  me: {
    name: string | null
    /** The real display name, or null when unset. `name` falls back to the email; this does not. */
    displayName: string | null
    hcp: string | null
    target: string | null
    /** 'left' | 'right' | null. Flips dispersion geometry and a bias sign in his file. */
    hand: string | null
    /** Driver carry in yards, or null. The baseline the driving index is scored from. */
    carry: number | null
    /**
     * Practice-intensity commitment ('foundation' | 'builder' | 'competitive') and curriculum
     * phase ('1'..'4'), both '' when unanswered. On `me` AND on `meRow` deliberately: the page
     * seeds its plan state from `me`, the dossier renders from `meRow`, and a value on only one
     * of them is the bug f437aa6 shipped.
     */
    tier: string
    zone: string
    /**
     * THE CALLER'S OWN coach sign-off state, keyed by drill id.
     *
     * The coach's tick has always written `golf.drill_progress.verified_at` correctly — and the
     * student never saw it. `drills` existed ONLY on `RosterRow`, and a player is nobody's coach,
     * so their roster is `[]` and the judgement died in the database. This is the return leg.
     */
    drills: RosterRow['drills']
    /**
     * THE CALLER'S OWN coaching notes — the same return leg as `drills`, for the written half.
     *
     * A player is nobody's coach, so their roster is `[]` and nothing on `RosterRow` can ever
     * reach them. Without this the coach's comment would land in the database exactly the way the
     * tick did before 2026-09-11, and the student would never read it.
     *
     * ⚠️ This is `shared`-only in practice, and NOT because anything here filters it.
     * `coaching_notes_select` grants the subject only `visibility = 'shared'`, so a
     * `coaching_team` or `private` note is not in the result set at all. The client never sees a
     * row it must not show, which is the only arrangement that cannot leak by omission.
     */
    notes: RosterRow['notes']
  }
  /**
   * The caller, shaped as a RosterRow — the SUBJECT of the profile screen when nobody else is.
   *
   * `me` above is the rail's shape (raw numeric strings, raw 'left'/'right'); this is the profile
   * screen's shape (converted, labelled), and they are deliberately different because their
   * consumers are. See the construction for why the conversion happens on this side.
   */
  meRow: RosterRow
}

/*
 * ── THE `hist` NOTE ─────────────────────────────────────────────────────────────────
 * WHY `hist` IS ALWAYS `{}`, on the evidence rather than on principle.
 *
 * His shape is six fixed lookback buckets: `{ m3, m6, y1, y3, y5, y10 }` — the player's handicap
 * index as it stood 3 months / 6 months / 1, 3, 5, 10 years ago.
 *
 * `golf.handicap_history` is the right table in principle: it is append-only, and `recorded_at` is
 * documented as when the handicap was TRUE (as opposed to `created_at`, when the row was written),
 * which is exactly the column an as-of read needs. The problem is that nothing has written a
 * historical row. The only writer in this repo is `scripts/seed.ts`, which inserts ONE row per
 * player with `recorded_at` left to default `now()`. No reading precedes any of the six cutoffs, so
 * not one bucket is fillable. There is nothing to approximate here; there is nothing at all.
 *
 * Filling a bucket from the newest row that happens to exist would put today's number under a label
 * that says "3 months ago" — the precise class of lie this file exists to prevent. Carrying an old
 * reading forward across a cutoff would be worse: a 13-month-old reading of 15.0 reported as
 * m3/m6/y1 all = 15.0 reads as "no improvement in a year" when the truth is "not measured".
 *
 * So the table is not even queried — a query whose result can only be discarded is a maintenance
 * trap that will one day get "helpfully" wired up.
 *
 * WHAT WOULD CHANGE THIS, both parts needed:
 *   1. ⚠️ PARTLY MET as of 2026-09-16. `golf.handicap_history` now holds seven rows for one account
 *      (Casey Flint) with genuine historical `recorded_at` spanning 2016→2026, and a coach can read
 *      them — proved by running as `atlas_app` with RLS forced on. So "nothing has written a
 *      historical row", above, is no longer true in general; it is true of every account but that
 *      one, which is a seed. A real producer (a GHIN backfill) is still the thing to build.
 *   2. a stated as-of rule: is a bucket the last reading at or before the cutoff, and how stale may
 *      that reading be before the bucket goes null? Nobody has specified that tolerance, and
 *      picking one here would be inventing product policy in a data-access file.
 * With both in hand this becomes six as-of reads and no change to the interface.
 */

/**
 * THE TRIGGER RESOLVER — one function, every source.
 *
 * Answers "when did this student raise each reviewable thing?" for all of REVIEW_ITEMS at once.
 * Each item declares where its trigger lives (`ReviewItem.source`); this is the only place that
 * knows how to read each of those places, and the only place that decides what counts as raised.
 *
 * Adding a reviewable thing is therefore: one entry in shared/drills.ts, and a case here IF it
 * introduces a genuinely new source. Nothing in the page, the route, the policies or the schema
 * changes — resolution is always `golf.drill_progress.verified_at`.
 *
 * Returns ISO strings so the client formats and never parses semantics out of them.
 */
function resolveSubmitted(args: {
  /** golf.drill_progress rows for this student, keyed by drill_id. */
  drills: RosterRow['drills']
  /** atlas.intake_submissions.completed_at for this student, if they finished one. */
  intakeCompletedAt: Date | string | null
  /**
   * Whether that intake actually SCORED.
   *
   * ⚠️ `completed_at` alone is not enough, and using it alone was a real bug caught on live data:
   * Avery Lane's row is marked completed while holding no profile at all, so the roster said "2
   * waiting on you" while the panel underneath said "no Practice DNA read on file for this
   * player". `status = 'completed'` on a row with nothing in it is a known state (docs/TASKS.md
   * T-61) — the old client waved it through the intake gate for the same reason.
   *
   * A trigger has to mean "there is something here to review", not "a column is non-null".
   */
  intakeScored: boolean
  /**
   * `golf.drill_review_requests.requested_at` for this student, keyed by drill_id.
   *
   * ⚠️ THE FIRST SOURCE HERE ATLAS CAN ACTUALLY WRITE, added 2026-09-25. Until then the only
   * 'drill' trigger was `ticked_at`, which belonged to forge_app — so `submitted` could only ever
   * be populated by an app that has not shipped, and the entire "waiting on you" machinery (the
   * coach's queue, the per-step counts, the badges) had no way to fire for a real golfer. That is
   * the mechanism behind Makel's *"This information is not relayed to the coach."*
   *
   * ⚠️ STILL THE ONLY SOURCE FOR A PLAN DRILL, even though Atlas can now write `ticked_at` too.
   * See the `case 'drill'` branch below for why that is a deliberate narrowing and not an
   * oversight.
   */
  reviewRequests: Record<string, string>
}): Record<string, string> {
  const out: Record<string, string> = {}
  const iso = (v: Date | string | null | undefined): string | null =>
    !v ? null : v instanceof Date ? v.toISOString() : String(v)

  for (const item of REVIEW_ITEMS) {
    switch (item.source ?? 'drill') {
      case 'drill': {
        /**
         * The PLAYER's claim that this rep is ready to be looked at.
         *
         * `requested_at` means "I have filmed this, please watch it" — the player pressing a
         * button that says so. `ticked_at` means "I did the rep", which is a weaker and different
         * statement. Atlas's own request always wins where both exist.
         *
         * ⚠️ NARROWED 2026-10-16 TO NON-PLAN IDS, and the narrowing is the whole point. This read
         * `reviewRequests[id] ?? drills[id]?.tickedAt` unconditionally, which was free while
         * NOTHING could write `ticked_at` on a plan drill. Atlas's new tick route can, on all 23
         * of them — so left alone, every tick on a camera drill would have appeared in the coach's
         * queue as "waiting on you", silently converting a progress checkbox into a submission the
         * player never made. That is a product change to a surface a coach reads, and it is not
         * one this change is entitled to make.
         *
         * The fallback survives only where no request path produced the row: the legacy
         * assessment ticks written by `neondb_owner` (`Avery Lane / chip20`, 2026-09-08). Dropping
         * it outright would make a real outstanding submission vanish from the queue.
         */
        const req = args.reviewRequests[item.id]
        const t = item.group === 'plan' ? req : (req ?? args.drills[item.id]?.tickedAt)
        if (t) out[item.id] = t
        break
      }
      case 'intake': {
        // Finishing the intake is the student action — but only counts as raised when the run
        // actually scored. See `intakeScored` above for the live case this guards.
        if (!args.intakeScored) break
        const t = iso(args.intakeCompletedAt)
        if (t) out[item.id] = t
        break
      }
    }
  }
  return out
}

/**
 * ⚠️ Explicit map, no `else` branch to 'Right-handed'.
 *
 * The previous injection did `handedness === 'left' ? 'Left-handed' : 'Right-handed'`, which makes
 * "we do not know" and "a player with no golf.player_profile row at all" both render as
 * "Right-handed" — a fabricated fact under a real name, and one no reader would think to doubt.
 * Roughly 1 in 10 golfers is left-handed, so this would be wrong often, and silently.
 */
function handLabel(handedness: string | null | undefined): string {
  if (handedness === 'left') return 'Left-handed'
  if (handedness === 'right') return 'Right-handed'
  return ''
}

/**
 * `numeric` comes back from node-postgres as a string, so this cannot be `Number(x)`.
 * `Number(null)` and `Number('')` are both `0` — a scratch handicap — and both typecheck happily.
 */
function toHcp(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * The status line. Three genuinely different truths, three strings.
 *
 * A direct edge that is `active` was approved by the student; a `pending` one was not, and the
 * student is on the roster because the coach asked, not because anyone consented. An academy
 * student had no approval step at all — `app_private.coaches_via_academy` grants on administrative
 * assignment — so labelling them "Approved" would credit an approval that never happened.
 */
function intakeLine(meta: Candidate): string {
  if (meta.source === 'academy') {
    return meta.orgName ? `Academy assignment — ${meta.orgName}` : 'Academy assignment'
  }
  // ⚠️ `status = 'active' AND approved_at IS NOT NULL`, both halves, because that is what
  // `app_private.coaches_directly()` requires and the comment above it in rls_core.sql calls the
  // second half out as load-bearing rather than belt-and-braces. Saying "Approved" on the looser
  // condition would print a label the database would refuse to honour. Unreachable today (such an
  // edge satisfies neither coaches_directly nor coach_requested, so users_coach_read drops the row
  // and it never reaches this function) — but the label should quote the rule, not paraphrase it.
  if (meta.status === 'active' && meta.approvedAt) return 'Approved — live'
  if (meta.status === 'pending') return 'Coach request — awaiting approval'
  // Any other status the consent loop grows later passes through rather than being guessed at.
  return `Coach request — ${meta.status}`
}

type Candidate = {
  status: string
  /** Non-null only when the SUBJECT approved. Part of the DB's definition of an active edge. */
  approvedAt: Date | null
  source: 'direct' | 'academy'
  orgName: string | null
}

/** Thrown when the Firebase account has no `public.users` row. See the note at the throw site. */
export class NoAtlasRecordError extends Error {
  constructor() {
    super('no_atlas_record')
    this.name = 'NoAtlasRecordError'
  }
}

/**
 * Builds `__ATLAS_DATA__` for the signed-in coach.
 *
 * ── Authorization is the database's job, not this function's ────────────────────────────────────
 * There is no "may this coach see that student" branch anywhere below, on purpose. Both reads run
 * inside `withRls` on the ordinary pool, so:
 *
 *   public.users, golf.player_profile   ->  coaches_or_pending()   identity tier, pending included
 *   golf.handicap_history              ->  coaches()              metric tier, approved only
 *
 * The query asks for candidates and RLS decides what comes back. Re-deriving the rule in TypeScript
 * is how the app layer and the database start to disagree, and the app layer is the one that fails
 * open. No `withRlsBypass`, and deliberately not `billingPool` — a demo page is the last place that
 * should hold a bypass.
 *
 * ⚠️ The two things TypeScript must still filter, because no policy does: `users.deleted_at` and
 * `org_memberships.deleted_at`. Neither appears in any policy predicate in `sql/rls_core.sql`
 * (checked), and `org_memberships.deleted_at` is documented there as the per-app revocation
 * mechanism. Without these a soft-deleted account renders as a live student. That is the soft-delete
 * rule, not visibility logic. `public.user_relationships` has no `deleted_at` column, so there is
 * nothing to filter there.
 */
export async function buildAtlasData(
  firebaseUid: string,
  /**
   * Which tab to open on. The caller knows the role; this module knows the data. A coach opens on
   * their roster, everyone else on their own day. Defaults to 'today' so a direct hit on the route
   * behaves the way the file does standalone.
   */
  view: AtlasData['view'] = 'today',
  /** Sections to withhold. Pass HIDDEN_FOR_COACH or HIDDEN_FOR_PLAYER. */
  hidden: readonly string[] = HIDDEN_FOR_PLAYER,
): Promise<AtlasData> {
  const schema = {
    users,
    userRelationships,
    orgMemberships,
    organizations,
    golfPlayerProfile,
    atlasCoachingNotes,
  }

  // Bootstrap read. The zero uuid is not a placeholder to be tidied away: at this point we do not
  // know our own user id, and `users_select` carries a `firebase_uid = app_private.firebase_uid()`
  // disjunct precisely so identity can be resolved before it is known. `app.current_user_id` must
  // still be a valid uuid literal or `set_config` + the uuid cast in the helpers fails.
  const me = await withRls(
    pool,
    { userId: '00000000-0000-0000-0000-000000000000', firebaseUid, app: 'atlas' },
    schema,
    (db) =>
      db
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
          deletedAt: users.deletedAt,
          // Needed to decide whether the compose box is offered — see `dmBlocked`. The DATABASE
          // still enforces the rule; this only decides what the page explains.
          dateOfBirth: users.dateOfBirth,
        })
        .from(users)
        .where(and(eq(users.firebaseUid, firebaseUid), isNull(users.deletedAt)))
        .limit(1),
  ).then((rows) => rows[0] ?? null)

  // Not an empty AtlasData. `{ roster: [], me: { name: null, hcp: null } }` renders as a coach with
  // no students, which is a legitimate state — so returning it here would disguise an auth failure
  // as an empty roster. The route must catch this and answer 403.
  if (!me) throw new NoAtlasRecordError()

  return withRls(pool, { userId: me.id, firebaseUid, app: 'atlas' }, schema, async (db) => {
    // ── 1. The caller's own card ────────────────────────────────────────────────────────────────
    // Owner-scoped policy, so this is just "my row". Note the type asymmetry the interface asks
    // for: `me.hcp` is the raw numeric STRING, while `RosterRow.hcp` is a number. His header prints
    // it verbatim; his roster does arithmetic on it.
    const myProfile = await db
      .select({
        handicapIndex: golfPlayerProfile.handicapIndex,
        targetHandicap: golfPlayerProfile.targetHandicap,
        driverCarryYds: golfPlayerProfile.driverCarryYds,
        handedness: golfPlayerProfile.handedness,
      })
      .from(golfPlayerProfile)
      .where(eq(golfPlayerProfile.userId, me.id))
      .limit(1)

    // The caller's OWN sign-off state. `drill_progress_select` permits this through its
    // `user_id = current_user_id()` clause — no new policy, no coach relationship required.
    const myProgress = await db
      .select({
        drillId: golfDrillProgress.drillId,
        verifiedAt: golfDrillProgress.verifiedAt,
        signedOffAt: golfDrillProgress.signedOffAt,
        videoRef: golfDrillProgress.videoRef,
        verifyNote: golfDrillProgress.verifyNote,
        // The player's own claim, read back to them. This is the one audience for whom these two
        // columns are not somebody else's data, and it is still read-only here: nothing in Atlas
        // may write them.
        tickedAt: golfDrillProgress.tickedAt,
        watchedAt: golfDrillProgress.watchedAt,
      })
      .from(golfDrillProgress)
      .where(eq(golfDrillProgress.userId, me.id))

    /**
     * The player's own review requests. `drill_review_requests_select` scopes to
     * `user_id = current_user_id()`, so this needs no extra clause — the same owner-scoped read
     * as the progress query above.
     */
    const myRequests = await db
      .select({ drillId: golfDrillReviewRequests.drillId, requestedAt: golfDrillReviewRequests.requestedAt })
      .from(golfDrillReviewRequests)
      .where(eq(golfDrillReviewRequests.userId, me.id))
    const myReviewRequests: Record<string, string> = {}
    for (const r of myRequests) {
      if (r.requestedAt) myReviewRequests[r.drillId] = r.requestedAt.toISOString()
    }

    /**
     * The player's own practice log, keyed by ISO DATE — never by day-of-month.
     *
     * The prototype's `log` used to be keyed `log[1..31]`, which made 3 October and 3 September
     * the same entry. That was survivable only because nothing persisted; the client was remapped
     * onto these keys in the same change that created this table.
     *
     * `session_date` is a Postgres `date`, which node-pg hands back as a 'YYYY-MM-DD' string
     * already — no Date round-trip, so no time zone can shift it.
     */
    const myPractice = await db
      .select({
        sessionDate: golfPracticeSessions.sessionDate,
        minutes: golfPracticeSessions.minutes,
        zone: golfPracticeSessions.zone,
        workout: golfPracticeSessions.workout,
      })
      .from(golfPracticeSessions)
      .where(eq(golfPracticeSessions.userId, me.id))
    const myLog: Record<string, { m?: number; b?: string; w?: string }> = {}
    for (const r of myPractice) {
      // Only keys the page actually reads, and only when set — an entry of all-undefined would
      // make `hasLog` true and turn every dashed total into a zero, which is the exact
      // "nobody counted" vs "you did none" distinction the dashes exist to preserve.
      const e: { m?: number; b?: string; w?: string } = {}
      if (r.minutes != null) e.m = r.minutes
      if (r.zone) e.b = r.zone
      if (r.workout) e.w = r.workout
      if (Object.keys(e).length) myLog[String(r.sessionDate)] = e
    }

    /**
     * THE CALLER'S OWN COACHES — the inverse of the roster query above.
     *
     * The roster asks "who do I coach" (`actor_user_id = me`). A player's thread needs "who
     * coaches me" (`subject_user_id = me`), which is the same edge read from the other end. Only
     * ACTIVE and APPROVED edges: a pending coach request is not a relationship, and messaging one
     * would be a channel the student never agreed to — the same rule `coaches_directly` applies.
     */
    const myCoachRows = await db
      .select({ coachId: userRelationships.actorUserId })
      .from(userRelationships)
      .where(
        and(
          eq(userRelationships.subjectUserId, me.id),
          eq(userRelationships.relationship, 'coach_of'),
          eq(userRelationships.status, 'active'),
          isNotNull(userRelationships.approvedAt),
        ),
      )
    const myCoachIds = [...new Set(myCoachRows.map((r) => r.coachId))]
    const coachNameRows = myCoachIds.length
      ? await db
          .select({ id: users.id, displayName: users.displayName, email: users.email })
          .from(users)
          .where(inArray(users.id, myCoachIds))
      : []
    const myCoaches = coachNameRows.map((c) => ({
      id: c.id,
      name: c.displayName ?? c.email ?? 'Your coach',
    }))

    /**
     * THE THREAD. `messages_select` already scopes to "I am one of the two", so this needs no
     * filter of its own beyond dropping soft-deleted rows.
     *
     * ⚠️ `dmBlocked` is EXPLANATION, NEVER PERMISSION. The refusal lives in `messages_insert`,
     * which checks `not is_minor(sender) and not is_minor(recipient)` in the database. This flag
     * exists so the page can say WHY the compose box is absent instead of rendering a control that
     * posts and gets a 403 — but if it were wrong in the permissive direction, the write would
     * still be refused. Makel, 2026-09-28: "DMs are disabled for anyone under 18."
     */
    const myMessageRows = await db
      .select({
        id: atlasMessages.id,
        senderUserId: atlasMessages.senderUserId,
        recipientUserId: atlasMessages.recipientUserId,
        body: atlasMessages.body,
        readAt: atlasMessages.readAt,
        createdAt: atlasMessages.createdAt,
      })
      .from(atlasMessages)
      .where(isNull(atlasMessages.deletedAt))
      .orderBy(atlasMessages.createdAt)
    const nameById = new Map(myCoaches.map((c) => [c.id, c.name]))
    const myMessages = myMessageRows.map((m) => ({
      id: m.id,
      mine: m.senderUserId === me.id,
      who: m.senderUserId === me.id ? 'You' : (nameById.get(m.senderUserId) ?? 'Your coach'),
      body: m.body,
      at: m.createdAt ? m.createdAt.toISOString() : null,
      read: !!m.readAt,
    }))
    // Mirrors app_private.is_minor(): unknown age counts as a minor, on both sides of the wire.
    const meIsMinor = !me.dateOfBirth || isMinor(new Date(me.dateOfBirth))

    const myDrills: RosterRow['drills'] = {}
    for (const r of myProgress) {
      myDrills[r.drillId] = {
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        signedOffAt: r.signedOffAt ? r.signedOffAt.toISOString() : null,
        videoRef: r.videoRef,
        verifyNote: r.verifyNote,
        tickedAt: r.tickedAt ? r.tickedAt.toISOString() : null,
        watchedAt: r.watchedAt ? r.watchedAt.toISOString() : null,
      }
    }


    // Everything about the caller EXCEPT their notes, which need the roster ids to be resolved
    // first so both audiences come out of one query. `meBlock` is assembled from this below.
    const meBase = {
      name: me.displayName ?? me.email ?? null,
      /**
       * The caller's REAL display name, or null — as distinct from `name` above, which falls back
       * to the email so the header always has something to print.
       *
       * Sent separately so the page can tell "has a name" from "is showing an email because there
       * is no name". Without the distinction the self-service field below would come pre-filled
       * with an email address, and the golfer would save that as their name — which is the state
       * the coach's roster is already complaining about.
       */
      displayName: me.displayName ?? null,
      hcp: myProfile[0]?.handicapIndex ?? null,
      /**
       * The caller's own target handicap, or null. The rail prints this as the reference every
       * benchmark on the page is read against, and it used to be the literal 5 baked into
       * `state.targetHcp`'s default — so "Benchmarks read against a 5 handicap" was true of the
       * code and false of the player. Null renders as '—'; nothing substitutes a number here.
       */
      target: myProfile[0]?.targetHandicap ?? null,
      /**
       * HANDEDNESS — 'left' | 'right' | null. Not cosmetic on this page.
       *
       * `state.hand` flips real geometry in Luke's file: the dispersion field mirrors on it
       * (the two `=== 'L'` mirror sites in Dashboard.dc.html) and a bias value changes SIGN. It was the
       * literal 'R' with a manual toggle (`:5236`), so a left-handed player was shown a
       * right-handed read of their own miss pattern until they noticed the toggle. About one
       * golfer in ten. `demo.player2` is left-handed in ryp-core today.
       *
       * Sent raw rather than as 'L'/'R' so the mapping lives in one place, in his file, next to
       * the code that consumes it. Null means not recorded — his default stands, unchanged.
       */
      hand: myProfile[0]?.handedness ?? null,
      /**
       * DRIVER CARRY, yards. The baseline the driving index is measured from.
       *
       * `PLAYER_CARRY = 265` was a literal feeding `drivingBaseline(PLAYER_CARRY)`
       * (`PLAYER_CARRY` in Dashboard.dc.html), so every golfer's driving index was scored
       * against a 265-yard carry. The bands are coarse enough that this is not a rounding
       * difference: 265 reads as a 5 handicap and 212 reads as a 20.
       *
       * Null when not recorded, and his file prints a dash rather than substituting a number.
       */
      carry: myProfile[0]?.driverCarryYds ?? null,
      drills: myDrills,
    }

    // ── 2. Candidates, by both paths ────────────────────────────────────────────────────────────
    // Direct `coach_of` edges. `user_relationships_select` already limits this to the caller's own
    // rows; `actor = me` is here for legibility. Deliberately NOT filtered by `app`:
    // `app_private.coaches_directly()` does not filter it either, and adding the condition here
    // would make the roster and the policy disagree about who counts as a student.
    const edges = await db
      .select({
        subjectUserId: userRelationships.subjectUserId,
        status: userRelationships.status,
        approvedAt: userRelationships.approvedAt,
      })
      .from(userRelationships)
      .where(
        and(
          eq(userRelationships.actorUserId, me.id),
          eq(userRelationships.relationship, 'coach_of'),
        ),
      )

    // Academy members. `org_memberships_staff_read` returns rows only for orgs the caller is
    // coach/admin of — plus the caller's OWN membership row, which is why `member` and `not me` are
    // filtered here rather than trusted from the policy. Without the `not me` a coach who is also a
    // member of their own academy appears on their own roster.
    const memberships = await db
      .select({
        userId: orgMemberships.userId,
        role: orgMemberships.role,
        orgName: organizations.name,
      })
      .from(orgMemberships)
      .leftJoin(organizations, eq(organizations.id, orgMemberships.orgId))
      .where(and(eq(orgMemberships.status, 'active'), isNull(orgMemberships.deletedAt)))

    const academy = memberships.filter((m) => m.role === 'member' && m.userId !== me.id)

    // Keyed by user id, so a student who arrives by BOTH paths is one row, not two. Academy wins
    // the label because it is the stronger claim: it is already assigned, where a direct edge may
    // still be pending.
    const candidates = new Map<string, Candidate>()
    for (const e of edges) {
      candidates.set(e.subjectUserId, {
        status: e.status,
        approvedAt: e.approvedAt,
        source: 'direct',
        orgName: null,
      })
    }
    for (const m of academy) {
      candidates.set(m.userId, {
        status: 'active',
        // Academy assignment has no per-player approval step, so there is no timestamp to carry.
        // intakeLine never reads this on the academy branch.
        approvedAt: null,
        source: 'academy',
        orgName: m.orgName ?? null,
      })
    }

    const ids = [...candidates.keys()]

    /**
     * Coaching notes — the caller's own AND every student's, in ONE query.
     *
     * Runs before the empty-roster return on purpose: a PLAYER has no students, and the player is
     * exactly who the `me` half of this exists for. Scoping it to the roster would have rebuilt
     * the bug this closes, where the coach's judgement reached the database and never the student.
     *
     * ── Why there is no `visibility` filter here ────────────────────────────────────────────
     * There must not be one. `atlas.coaching_notes_select` already answers it for both audiences
     * from a single predicate: the subject sees `shared` only; a coach sees `coaching_team` and
     * `shared` on their own students, plus anything they wrote themselves. Re-deriving that in
     * TypeScript yields two rules that agree until one is edited, and the failure mode is a
     * private note rendered under a student's login. The database decides; this only maps.
     *
     * Sorted newest-first here rather than in his file, so both surfaces agree without either
     * one sorting.
     */
    const noteRows = await db
      .select({
        id: atlasCoachingNotes.id,
        subjectUserId: atlasCoachingNotes.subjectUserId,
        authorUserId: atlasCoachingNotes.authorUserId,
        author: users.displayName,
        body: atlasCoachingNotes.body,
        visibility: atlasCoachingNotes.visibility,
        createdAt: atlasCoachingNotes.createdAt,
      })
      .from(atlasCoachingNotes)
      .leftJoin(users, eq(users.id, atlasCoachingNotes.authorUserId))
      .where(
        and(
          inArray(atlasCoachingNotes.subjectUserId, [me.id, ...ids]),
          isNull(atlasCoachingNotes.deletedAt),
        ),
      )
      .orderBy(desc(atlasCoachingNotes.createdAt))

    const notesBy = new Map<string, RosterRow['notes']>()
    for (const r of noteRows) {
      const list = notesBy.get(r.subjectUserId) ?? []
      list.push({
        id: r.id,
        body: r.body,
        visibility: r.visibility,
        author: r.author ?? null,
        mine: r.authorUserId === me.id,
        createdAt: r.createdAt ? r.createdAt.toISOString() : '',
      })
      notesBy.set(r.subjectUserId, list)
    }

    /**
     * THE CALLER'S OWN interview answers.
     *
     * Read from the BASE TABLE, not `atlas.student_intake`. That view is gated by
     * `app_private.coaches(s.user_id)` — it answers "may I read my STUDENT's intake" — and nobody
     * coaches themselves, so a player asking it about their own row gets nothing.
     * `intake_submissions_select_own` is the policy that applies here.
     *
     * `quality_flag` is still never selected. It is private to the subject even from the subject
     * in this file: nothing on this page needs it, and a column never selected cannot be leaked by
     * a later change to the page.
     *
     * `answers` IS selected here — a player's own row, read under `intake_submissions_select_own`,
     * so this is their own data and it includes IPIP01–20. It is passed straight into
     * `summarizeRun` and never assigned onto the row; the same discipline as the roster path
     * above, for the same reason: the projection is what travels, not the source.
     */
    const myIntake = (await db.execute(
      // `updated_at`, not `created_at` — this table has no created_at. Caught by running it;
      // raw SQL is invisible to the typechecker, so this would have 500'd every page load.
      sql`select interview, profile, volume, alloc, answers, completed_at
            from atlas.intake_submissions
          where user_id = ${me.id}::uuid and deleted_at is null
          order by updated_at desc limit 1`,
    )) as unknown as {
      rows: Array<{
        interview: Record<string, string> | null
        profile: unknown
        volume: unknown
        alloc: unknown
        answers: unknown
        completed_at: Date | string | null
      }>
    }

    /**
     * ⚠️ tier/zone MUST be on `me`, not only on `meRow`.
     *
     * f437aa6 put them on `meRow` alone and was therefore INERT: the prototype seeds its plan
     * state from `window.__ATLAS_DATA__.me.tier` / `.me.zone` (Dashboard.dc.html, the state
     * initialiser), so every player kept falling through to the Foundation/phase-1 default no
     * matter what they answered. Caught by the 2026-09-20 review, three agents independently.
     *
     * Worth recording WHY it shipped: it was "verified" against a hand-built payload with
     * `me.tier` set by the test itself, which proved the consumer and never the producer. The
     * check that finds this is reading the REAL buildAtlasData output — see the test at the
     * bottom of this change's commit message.
     */
    // One expression, two consumers (`me` and `meRow`) — so the page and the dossier cannot
    // disagree about which tier a golfer is on.
    const meIntake = myIntake.rows[0]?.interview as Record<string, unknown> | null
    const meRowTier = String(meIntake?.tier ?? '')
    const meRowZone = String(meIntake?.phase ?? '')

    const meBlock = {
      ...meBase,
      notes: notesBy.get(me.id) ?? [],
      tier: meRowTier,
      zone: meRowZone,
      /**
       * The practice log, keyed by ISO date. Read by the prototype's state seed in place of the
       * old `const SEED = {}`.
       *
       * ⚠️ ON `me`, NOT ONLY ON `meRow` — the trap f437aa6 shipped. The prototype's state seed
       * reads `window.__ATLAS_DATA__.me`, so a value written only to `meRow` is invisible to it
       * and the feature does nothing while every test against a hand-built payload passes.
       */
      practice: myLog,
      /** The caller's real coaches — who they may actually message. Not the hardcoded four. */
      coaches: myCoaches,
      messages: myMessages,
      /**
       * ⚠️ A REASON TO SHOW, NOT A GATE. See the query above — atlas.messages' insert policy is
       * the gate. If this said false for a 15-year-old the database would still refuse the write.
       */
      dmBlocked: meIsMinor,
    }

    /**
     * The caller, shaped EXACTLY like a RosterRow.
     *
     * His profile screen reads one variable — `who` — and until now a player had nothing to put in
     * it: a player's roster is `[]`, so `who` fell back to EMPTY_PLAYER and a player opening their
     * own profile saw a blank placeholder person with read-only fields. This is the record that
     * makes `who` mean "the subject of this screen" for both audiences.
     *
     * Built HERE rather than in his file so the conversions happen once, in the place they are
     * already tested: `toHcp` (which must not be `Number()` — a plus handicap is stored negative
     * and `Number('')` is a scratch 0) and `handLabel`. A second copy in the client is a second
     * chance to reintroduce the bug that printed a plus handicap as a minus.
     *
     * Everything without a producer is the same honest empty a real roster row carries.
     */
    // Scored ONCE. Both `dna` (what the panel renders) and `submitted` (whether the intake counts
    // as raised for review) read this same value, so the card and the chip cannot disagree.
    const myDna = myIntake.rows[0] ? summarizeRun(myIntake.rows[0]) : null

    const meRow: RosterRow = {
      ...EMPTY_ROSTER_ROW,
      id: me.id,
      n: me.displayName ?? me.email ?? '',
      hcp: toHcp(myProfile[0]?.handicapIndex),
      target: toHcp(myProfile[0]?.targetHandicap),
      hand: handLabel(myProfile[0]?.handedness),
      carry: myProfile[0]?.driverCarryYds ? `${myProfile[0].driverCarryYds} yd driver carry` : '',
      file: myIntake.rows[0]?.interview ?? {},
      // REAL since 2026-09-17. The golfer picks both in the interview ("let both be selectable").
      // `tier` is an hours-per-week COMMITMENT (foundation/builder/competitive), not billing —
      // the billing ladder is public.plans and is deliberately not wired to this. Empty string
      // when unanswered, so the prototype falls back to its own guard rather than to a literal.
      tier: meRowTier,
      zone: meRowZone,
      drills: myDrills,
      notes: notesBy.get(me.id) ?? [],
      // The same resolver the roster uses. A player reads their own submissions back — "with your
      // coach" rather than "awaiting your review" — off one rule, not a second copy of it.
      submitted: resolveSubmitted({
        drills: myDrills,
        intakeCompletedAt: myIntake.rows[0]?.completed_at ?? null,
        // Same guard as the roster: a row marked completed but holding nothing is not a
        // submission. `myDna` is computed once and used by both this and `dna` below.
        intakeScored: myDna !== null,
        reviewRequests: myReviewRequests,
      }),
      // Two-sided like `drills` and `notes`: the same panel, the same words, whichever side of the
      // conversation is reading it. That is the entire point of surfacing this to a coach.
      dna: myDna,
    }

    // The empty roster is a real, common answer — a coach with no students, or a player who opened
    // the page. It renders as an empty screen, which is correct.
    if (ids.length === 0) return { view, hidden, reviewItems: REVIEW_ITEMS, roster: [], me: meBlock, meRow }

    // ── 3. Identity tier ───────────────────────────────────────────────────────────────────────
    // Anything RLS refuses simply does not come back, so an edge pointing at an account the caller
    // may not read drops out instead of rendering as a half-empty row. `golf.handicap_history` is
    // NOT queried — see THE `hist` NOTE above.
    const [people, profiles] = await Promise.all([
      db
        .select({ id: users.id, displayName: users.displayName, email: users.email,
                  // Needed for the DM rule's EXPLANATION — the policy is what refuses the write.
                  dateOfBirth: users.dateOfBirth })
        .from(users)
        .where(and(inArray(users.id, ids), isNull(users.deletedAt))),
      db
        .select({
          userId: golfPlayerProfile.userId,
          handicapIndex: golfPlayerProfile.handicapIndex,
          targetHandicap: golfPlayerProfile.targetHandicap,
          driverCarryYds: golfPlayerProfile.driverCarryYds,
          handedness: golfPlayerProfile.handedness,
        })
        .from(golfPlayerProfile)
        .where(inArray(golfPlayerProfile.userId, ids)),
    ])

    const profileBy = new Map(profiles.map((p) => [p.userId, p]))

    // Sign-off state for everyone on the roster, in one read. Injected per row rather than fetched
    // when a student is opened: the roster is small, the page is server-rendered once, and Luke's
    // file has no loading state to render into. `drill_progress_select` already scopes this to
    // students this coach actually coaches, so an unapproved student's rows simply do not come
    // back — the same reason the roster itself needs no ownership filter here.
    // (Was `ids.length ? … : []`. The early return at the top of this block already exits when
    //  ids is empty, so the `: []` arm was unreachable.)
    const progressRows = await db
        .select({
          userId: golfDrillProgress.userId,
          drillId: golfDrillProgress.drillId,
          verifiedAt: golfDrillProgress.verifiedAt,
          signedOffAt: golfDrillProgress.signedOffAt,
          videoRef: golfDrillProgress.videoRef,
          verifyNote: golfDrillProgress.verifyNote,
          // Read-only. See the note on RosterRow.drills — these are the player's columns, and
          // the difference between "waiting on the coach" and "never started" is in them.
          tickedAt: golfDrillProgress.tickedAt,
          watchedAt: golfDrillProgress.watchedAt,
        })
        .from(golfDrillProgress)
        .where(inArray(golfDrillProgress.userId, ids))

    /**
     * THE STUDENT'S INTAKE — `atlas.student_intake`, the coach-safe view.
     *
     * Makel decided this on 2026-09-11 ("yes, that's the point of the intake"), and `rls_core.sql`
     * had been holding it open as the one call only he could make. The view — never a policy on the
     * base table — gates on `app_private.coaches(user_id)` and withholds `quality_flag` and the
     * Mini-IPIP items. See the long note in rls_core.sql for why that shape.
     *
     * Raw SQL because the view is not in eco's drizzle schema: adding it there means another eco
     * release, and this reads four columns. If a second caller ever needs it, promote it properly.
     *
     * The gate lives in the VIEW, so this query carries no ownership filter of its own — the same
     * reasoning as the roster and the drill progress above.
     */
    // (Was `ids.length ? … : []`. The early return at the top of this block already exits when
    //  ids is empty, so the `: []` arm was unreachable.)
    const intakeRows = ((await db.execute(
        sql`select user_id, interview, profile, volume, alloc, answers, tier_completed, status,
                   completed_at
              from atlas.student_intake`,
      )) as unknown as {
        rows: Array<{
          user_id: string
          interview: Record<string, string> | null
          profile: Record<string, unknown> | null
          volume: unknown
          alloc: unknown
          answers: unknown
          tier_completed: number | null
          status: string | null
          /** The student action that raises the intake for review. See resolveSubmitted. */
          completed_at: Date | string | null
        }>
      }).rows

    const intakeBy = new Map<string, Record<string, string>>()
    /**
     * The coach-safe read of each student's Practice DNA run.
     *
     * ⚠️ `r.answers` IS THE RAW ITEM RESPONSES. The view strips IPIP01–20 but NOT ATTN01/ATTN02,
     * so this object still carries the attention-check basis of `quality_flag`. It is consumed
     * here, inside `summarizeRun`, and the only thing that survives is the allowlisted projection.
     * `answers` itself must never be assigned onto a RosterRow — see server/dnaSummary.ts.
     */
    const dnaBy = new Map<string, DnaSummary>()
    /** When each student finished their intake — the 'intake' trigger source. */
    const intakeDoneBy = new Map<string, Date | string>()
    for (const r of intakeRows) {
      if (r.completed_at) intakeDoneBy.set(r.user_id, r.completed_at)
      // The WHOLE `interview` object travels into his `file` block — eight keys since 2026-09-17 (five prose, plus target/tier/phase), of which his markup renders five — that is exactly what his
      // FIELDS renders (sport, years, limits, time, goal).
      if (r.interview) intakeBy.set(r.user_id, r.interview)
      const dna = summarizeRun(r)
      if (dna) dnaBy.set(r.user_id, dna)
    }

    /**
     * Every student's review requests, in one query. `drill_review_requests_select` carries the
     * `app_private.coaches(user_id)` branch, so the DATABASE decides which students this coach may
     * see — this file adds no filter of its own, same discipline as the progress query.
     */
    const requestRows = await db
      .select({
        userId: golfDrillReviewRequests.userId,
        drillId: golfDrillReviewRequests.drillId,
        requestedAt: golfDrillReviewRequests.requestedAt,
      })
      .from(golfDrillReviewRequests)
    const requestsBy = new Map<string, Record<string, string>>()
    for (const r of requestRows) {
      if (!r.requestedAt) continue
      const bucket = requestsBy.get(r.userId) ?? {}
      bucket[r.drillId] = r.requestedAt.toISOString()
      requestsBy.set(r.userId, bucket)
    }

    /**
     * WHEN EACH STUDENT LAST PRACTISED — the producer `RosterRow.days` has been waiting for.
     *
     * The roster already renders `last: days === 0 ? 'Today' : days + 'd ago' : 'never logged'`
     * and flags a student silent for more than a week (`flag: p.days > 7`), and the default sort
     * uses it. All of that has been inert since the roster was built, because `days` was a
     * hardcoded null with the comment "needs a practice_days producer". This is that producer.
     *
     * `practice_sessions_select` carries the `coaches(user_id)` branch, so the DATABASE decides
     * which students appear here — this file adds no filter of its own.
     */
    const practiceRows = await db
      .select({
        userId: golfPracticeSessions.userId,
        sessionDate: golfPracticeSessions.sessionDate,
        minutes: golfPracticeSessions.minutes,
      })
      .from(golfPracticeSessions)
    // Midnight UTC today, compared against a 'YYYY-MM-DD' string parsed the same way — so the
    // difference is a whole number of days and cannot come out as 6.97.
    const todayMs = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    )
    const lastPractisedBy = new Map<string, number>()
    for (const r of practiceRows) {
      // A day with no minutes is not practice — a logged rest day must not read as "practised
      // today" on the coach's roster.
      if (r.minutes == null || r.minutes <= 0) continue
      const [y, m, d] = String(r.sessionDate).split('-').map(Number)
      const days = Math.round((todayMs - Date.UTC(y, m - 1, d)) / 86_400_000)
      if (days < 0) continue
      const prev = lastPractisedBy.get(r.userId)
      if (prev === undefined || days < prev) lastPractisedBy.set(r.userId, days)
    }

    /**
     * EVERY THREAD THIS COACH IS PART OF, bucketed by the student.
     *
     * `messages_select` scopes to "I am one of the two", so a coach sees only their own
     * conversations — this file adds no filter. Bucketing by the OTHER party is what turns one
     * flat list into per-student threads, which is the only shape that makes sense on a player
     * file: a merged inbox on a screen about one student would attribute other people's words to
     * the person whose file is open.
     */
    const coachMsgRows = await db
      .select({
        id: atlasMessages.id,
        senderUserId: atlasMessages.senderUserId,
        recipientUserId: atlasMessages.recipientUserId,
        body: atlasMessages.body,
        readAt: atlasMessages.readAt,
        createdAt: atlasMessages.createdAt,
      })
      .from(atlasMessages)
      .where(isNull(atlasMessages.deletedAt))
      .orderBy(atlasMessages.createdAt)
    const msgsBy = new Map<string, RosterRow['messages']>()
    for (const m of coachMsgRows) {
      const other = m.senderUserId === me.id ? m.recipientUserId : m.senderUserId
      const bucket = msgsBy.get(other) ?? []
      bucket.push({
        id: m.id,
        mine: m.senderUserId === me.id,
        who: m.senderUserId === me.id ? 'You' : '',
        body: m.body,
        at: m.createdAt ? m.createdAt.toISOString() : null,
        read: !!m.readAt,
      })
      msgsBy.set(other, bucket)
    }

    const progressBy = new Map<string, RosterRow['drills']>()
    for (const r of progressRows) {
      const bucket = progressBy.get(r.userId) ?? {}
      bucket[r.drillId] = {
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        signedOffAt: r.signedOffAt ? r.signedOffAt.toISOString() : null,
        videoRef: r.videoRef,
        verifyNote: r.verifyNote,
        tickedAt: r.tickedAt ? r.tickedAt.toISOString() : null,
        watchedAt: r.watchedAt ? r.watchedAt.toISOString() : null,
      }
      progressBy.set(r.userId, bucket)
    }

    const roster: RosterRow[] = people.map((person) => {
      const meta = candidates.get(person.id)!
      const profile = profileBy.get(person.id) ?? null

      return {
        // ── real ──
        id: person.id,
        // Email is the fallback because a blank name is unusable on a roster, and the coach already
        // knows the address: they had to identify the student to request them at all.
        n: person.displayName ?? person.email,
        hcp: toHcp(profile?.handicapIndex),
        carry: profile?.driverCarryYds ? `${profile.driverCarryYds} yd driver carry` : '',
        hand: handLabel(profile?.handedness),
        intake: intakeLine(meta),
        // Filled in after the map — see below.
        dupe: '',
        drills: progressBy.get(person.id) ?? {},
        notes: notesBy.get(person.id) ?? [],
        // One rule, one place — see resolveSubmitted. The page reads this and decides nothing.
        submitted: resolveSubmitted({
          drills: progressBy.get(person.id) ?? {},
          intakeCompletedAt: intakeDoneBy.get(person.id) ?? null,
          // The same object the panel renders from, so the chip and the panel cannot disagree.
          intakeScored: dnaBy.has(person.id),
          reviewRequests: requestsBy.get(person.id) ?? {},
        }),
        messages: msgsBy.get(person.id) ?? [],
        // Mirrors app_private.is_minor(): a coach must not be offered a compose box for a student
        // the database will refuse. The refusal is the policy's; this is the explanation.
        dmBlocked: !person.dateOfBirth || isMinor(new Date(person.dateOfBirth)),
        // The player's own result vocabulary — archetype, zones, growth zone, time split. null
        // when there is no scoreable run, which the page renders as "no read on file".
        dna: dnaBy.get(person.id) ?? null,

        // REAL since 2026-09-21. The student's own self-declared commitment and phase, from the
        // same `interview` jsonb `file` is read from three lines down — so a coach sees the tier
        // their student actually picked, not a blank. Empty when unanswered, never a default.
        //
        // Wired late: f437aa6 gave tier/phase a producer and connected only the self path, so for
        // four days the RosterRow doc said REAL while the roster shipped ''. The data was already
        // in `intakeBy` the whole time.
        tier: String(intakeBy.get(person.id)?.tier ?? ''),
        zone: String(intakeBy.get(person.id)?.phase ?? ''),

        // ── no producer. 44 of the 81 metrics on these screens are Forge outputs and Forge has not
        //    shipped, so most of his UI going quiet is the CORRECT outcome, not a regression. ──
        // REAL as of 2026-09-03. `golf.player_profile.target_handicap` — the handicap this student
        // is working toward, and the denominator of every benchmark on this dashboard. Null when
        // nobody has set one, which renders as '—' rather than as a default: a benchmark computed
        // against a target the coach never chose is the fabrication this column exists to end.
        target: toHcp(profile?.targetHandicap),
        // ✅ HAS A PRODUCER, 2026-09-25 (was `null` with "needs a practice_days producer").
        // Whole days since this student last logged practice; null still means NEVER, which the
        // roster renders as "never logged" rather than as a number.
        days: lastPractisedBy.get(person.id) ?? null,
        leak: '', // Forge
        sg: [], // Forge
        hist: {}, // see THE `hist` NOTE above
        read: {}, // ⚠️ Forge. Prose about a person — never another player's.
        note: {}, // ⚠️ Forge. Prose about a person — never another player's.
        tone: {}, // Forge
        answer: {},
        est: {},
        grid: [], // Forge
        // REAL since 2026-09-11 — the whole interview object (eight keys since 2026-09-17), via
        // atlas.student_intake.
        // `{}` when that student has not answered the interview stage; his render shows the
        // honest empty state rather than another student's words.
        file: intakeBy.get(person.id) ?? {},
      }
    })

    /**
     * Disambiguate students who share a display name.
     *
     * Only the ones that actually collide get an email, and only on a roster where the collision
     * exists — a name is ambiguous relative to the set it sits in, so this cannot be decided while
     * building a single row. The coach already sees these addresses (an account with no name
     * renders its email AS the name), so nothing is disclosed that was not already on screen.
     */
    const nameCount = new Map<string, number>()
    for (const r of roster) nameCount.set(r.n, (nameCount.get(r.n) ?? 0) + 1)
    /**
     * ⚠️ THE CALLER COUNTS TOO (added 2026-09-21, T-68).
     *
     * This used to count roster rows against each other only. But the caller's own name is built by
     * the identical formula (`meBase.name`, above) and renders in the persistent rail account chip
     * on EVERY screen — so a student who shares a name with the signed-in coach sat one column away
     * from an identical string, and `dupe` stayed silent because the collision was coach-vs-student
     * rather than row-vs-row.
     *
     * This is not hypothetical. On 2026-09-21 it produced a false entry in this repo's own task
     * board: `makel@rypgolf.com` coaching `makelmackbee@gmail.com` — two different accounts, one
     * display name — was recorded as a coach holding a `coach_of` edge to themself. That is exactly
     * the confusion this field exists to prevent, in the one configuration it did not cover.
     *
     * Counted, not force-flagged: seeding the map means a roster row only disambiguates when it
     * genuinely collides, and a coach with a unique name changes nothing.
     */
    if (meBlock.name) nameCount.set(meBlock.name, (nameCount.get(meBlock.name) ?? 0) + 1)
    for (const r of roster) {
      if ((nameCount.get(r.n) ?? 0) < 2) continue
      const person = people.find((x) => x.id === r.id)
      // Never fall back to the name here: repeating an ambiguous name under itself is noise, and
      // an account with no email at all has nothing to disambiguate WITH.
      r.dupe = person?.email ?? ''
    }

    return { view, hidden, reviewItems: REVIEW_ITEMS, roster, me: meBlock, meRow }
  })
}
