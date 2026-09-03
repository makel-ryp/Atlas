import { and, eq, inArray, isNull } from 'drizzle-orm'
import { withRls } from '@ryp/eco/db'
import {
  golfDrillProgress,
  golfPlayerProfile,
  orgMemberships,
  organizations,
  userRelationships,
  users,
} from '@ryp/eco/schema'
import { pool } from './db'

/**
 * The data half of serving Luke's prototype: builds the single blob the page reads as
 * `window.__ATLAS_DATA__`. `server/routes/proto.ts` injects it; `proto/Dashboard.dc.html` does
 * `const ROSTER = (window.__ATLAS_DATA__ && window.__ATLAS_DATA__.roster) || []`.
 *
 * ── The one rule this file exists to enforce ────────────────────────────────────────────────────
 * A field with no producer is EMPTY, never a sample value. His row carries ~20 keys; ryp-core has
 * producers for six of them (id, n, hcp, carry, hand, intake). The other fourteen are Forge and
 * Atlas-curriculum outputs that do not exist yet, and they come back '' / {} / [] / null.
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

  // ── NO PRODUCER. Present so his render finds the key, empty because nothing writes it. ────────
  /** Atlas curriculum tier. Not built. */
  tier: string
  /** Atlas curriculum zone. Not built. */
  zone: string
  /** Target handicap. There is no `target_handicap` COLUMN in ryp-core, not merely no data. */
  target: number | null
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
  /** Intake answers. No producer. */
  answer: Record<string, number>
  /** Coach estimates. No producer. */
  est: Record<string, number>
  /** Dispersion grid. Forge. */
  grid: number[]
  /** Intake file prose. No producer. */
  file: Record<string, string>
  /**
   * Coach sign-off state, keyed by drill id. REAL — golf.drill_progress, written by a coach after
   * they watch the swing video in Parallax. `verifiedAt` null (or the key absent) means not yet
   * signed off; it never means the player did not do it, which is `tickedAt` and belongs to Forge.
   */
  drills: Record<string, { verifiedAt: string | null; videoRef: string | null; verifyNote: string | null }>
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

const PLAYER_ONLY = ['today', 'cal', 'plan', 'build', 'fitness', 'transfer', 'perf', 'thread'] as const

export const HIDDEN_FOR_COACH: readonly string[] = [...VIDEO_TEST_SECTIONS, ...PLAYER_ONLY]
export const HIDDEN_FOR_PLAYER: readonly string[] = [...VIDEO_TEST_SECTIONS, 'roster']

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
  /** The signed-in coach. `hcp` is the raw `numeric` string here — see the type note below. */
  me: { name: string | null; hcp: string | null }
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
 *   1. a producer writing rows with genuine historical `recorded_at` (a GHIN backfill is the
 *      obvious one — the schema comment already anticipates it), and
 *   2. a stated as-of rule: is a bucket the last reading at or before the cutoff, and how stale may
 *      that reading be before the bucket goes null? Nobody has specified that tolerance, and
 *      picking one here would be inventing product policy in a data-access file.
 * With both in hand this becomes six as-of reads and no change to the interface.
 */

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
      .select({ handicapIndex: golfPlayerProfile.handicapIndex })
      .from(golfPlayerProfile)
      .where(eq(golfPlayerProfile.userId, me.id))
      .limit(1)

    const meBlock = {
      name: me.displayName ?? me.email ?? null,
      hcp: myProfile[0]?.handicapIndex ?? null,
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
    // The empty roster is a real, common answer — a coach with no students, or a player who opened
    // the page. It renders as an empty screen, which is correct.
    if (ids.length === 0) return { view, hidden, roster: [], me: meBlock }

    // ── 3. Identity tier ───────────────────────────────────────────────────────────────────────
    // Anything RLS refuses simply does not come back, so an edge pointing at an account the caller
    // may not read drops out instead of rendering as a half-empty row. `golf.handicap_history` is
    // NOT queried — see THE `hist` NOTE above.
    const [people, profiles] = await Promise.all([
      db
        .select({ id: users.id, displayName: users.displayName, email: users.email })
        .from(users)
        .where(and(inArray(users.id, ids), isNull(users.deletedAt))),
      db
        .select({
          userId: golfPlayerProfile.userId,
          handicapIndex: golfPlayerProfile.handicapIndex,
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
    const progressRows = ids.length
      ? await db
          .select({
            userId: golfDrillProgress.userId,
            drillId: golfDrillProgress.drillId,
            verifiedAt: golfDrillProgress.verifiedAt,
            videoRef: golfDrillProgress.videoRef,
            verifyNote: golfDrillProgress.verifyNote,
          })
          .from(golfDrillProgress)
          .where(inArray(golfDrillProgress.userId, ids))
      : []

    const progressBy = new Map<string, RosterRow['drills']>()
    for (const r of progressRows) {
      const bucket = progressBy.get(r.userId) ?? {}
      bucket[r.drillId] = {
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        videoRef: r.videoRef,
        verifyNote: r.verifyNote,
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
        drills: progressBy.get(person.id) ?? {},

        // ── no producer. 44 of the 81 metrics on these screens are Forge outputs and Forge has not
        //    shipped, so most of his UI going quiet is the CORRECT outcome, not a regression. ──
        tier: '',
        zone: '',
        target: null, // no `target_handicap` column exists to read
        days: null, // needs a practice_days producer
        leak: '', // Forge
        sg: [], // Forge
        hist: {}, // see THE `hist` NOTE above
        read: {}, // ⚠️ Forge. Prose about a person — never another player's.
        note: {}, // ⚠️ Forge. Prose about a person — never another player's.
        tone: {}, // Forge
        answer: {},
        est: {},
        grid: [], // Forge
        file: {},
      }
    })

    return { view, hidden, roster, me: meBlock }
  })
}
