import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { attachUser, requireApp, verifyToken } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import {
  users,
  userRelationships,
  orgMemberships,
  organizations,
  golfPlayerProfile,
  golfHandicapHistory,
  golfDrillProgress,
} from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import {
  isReviewItemId,
  isStepCompletionId,
  stepCompletionIdFor,
  drillIdsInStep,
} from '../../shared/drills'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

const schema = {
  golfDrillProgress,
  users,
  userRelationships,
  orgMemberships,
  organizations,
  golfPlayerProfile,
  golfHandicapHistory,
}

const identityChain: RequestHandler[] = [
  verifyToken,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  // Last link: an account that has not established it may be used gets nothing. See
  // ../requireConsent — the gate is here, not in the client.
  requireConsent(),
]

const pageOrApiChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  // Last link: an account that has not established it may be used gets nothing. See
  // ../requireConsent — the gate is here, not in the client.
  requireConsent(),
]

export const coachRouter = Router()

/**
 * GET /api/coach/students — the roster.
 *
 * ── The one design decision here ────────────────────────────────────────────────────────────
 * This route does NOT re-implement "who may this coach see". It asks for candidates and lets RLS
 * answer, which is why the two visibility tiers show up as data rather than as branches:
 *
 *   users + golf.player_profile   -> policy gates on coaches_or_pending()  (identity tier)
 *   golf.handicap_history         -> policy gates on coaches()             (metric tier)
 *
 * So a pending student's name and profile card come back and their trend does not, without a single
 * `if (status === 'pending')` anywhere in this file. Re-deriving the rule in TypeScript is how the
 * app layer and the database start disagreeing, and the app layer is the one that fails open.
 *
 * There is deliberately no coach-role gate beyond requireApp('atlas') either. A player calling this
 * gets an empty array, because they have no coach_of edges and are not org staff — RLS makes the
 * route safe rather than a role check making it forbidden. One less rule to keep in sync.
 */
coachRouter.get('/coach/students', ...identityChain, async (req, res, next) => {
  try {
    const me = (req as any).user as typeof users.$inferSelect

    const roster = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        // 1. Direct coach_of edges. user_relationships_select shows the caller their own rows, so
        //    this needs no ownership filter beyond actor = me for clarity.
        const edges = await db
          .select({
            subjectUserId: userRelationships.subjectUserId,
            status: userRelationships.status,
          })
          .from(userRelationships)
          .where(
            and(
              eq(userRelationships.actorUserId, me.id),
              eq(userRelationships.relationship, 'coach_of'),
            ),
          )

        // 2. Academy members. org_memberships_staff_read returns rows only for orgs the caller is
        //    coach/admin of — plus the caller's own membership row, which is why `member` and
        //    `not me` are both filtered here rather than trusted from the policy.
        const memberships = await db
          .select({
            userId: orgMemberships.userId,
            role: orgMemberships.role,
            orgId: orgMemberships.orgId,
            orgName: organizations.name,
          })
          .from(orgMemberships)
          .leftJoin(organizations, eq(organizations.id, orgMemberships.orgId))
          .where(eq(orgMemberships.status, 'active'))

        const academy = memberships.filter((m) => m.role === 'member' && m.userId !== me.id)

        // A student can arrive by both paths. Academy wins the label because it is the stronger
        // claim — it is already approved, where a direct edge may still be pending.
        const candidates = new Map<
          string,
          { status: string; source: 'direct' | 'academy'; orgName: string | null }
        >()
        for (const e of edges) {
          candidates.set(e.subjectUserId, { status: e.status, source: 'direct', orgName: null })
        }
        for (const m of academy) {
          candidates.set(m.userId, { status: 'active', source: 'academy', orgName: m.orgName })
        }
        const ids = [...candidates.keys()]
        if (ids.length === 0) return []

        // 3. Identity tier. Anything RLS refuses simply does not come back — an edge to a
        //    soft-deleted account, for instance, silently drops out instead of rendering as a
        //    half-empty row.
        const [people, profiles, history] = await Promise.all([
          db
            .select({ id: users.id, displayName: users.displayName, email: users.email })
            .from(users)
            .where(inArray(users.id, ids)),
          db
            .select({
              userId: golfPlayerProfile.userId,
              handicapIndex: golfPlayerProfile.handicapIndex,
              driverCarryYds: golfPlayerProfile.driverCarryYds,
              handedness: golfPlayerProfile.handedness,
            })
            .from(golfPlayerProfile)
            .where(inArray(golfPlayerProfile.userId, ids)),
          // 4. Metric tier — same query, stricter policy. Returns nothing for a pending student.
          db
            .select({
              userId: golfHandicapHistory.userId,
              handicapIndex: golfHandicapHistory.handicapIndex,
              recordedAt: golfHandicapHistory.recordedAt,
            })
            .from(golfHandicapHistory)
            .where(inArray(golfHandicapHistory.userId, ids))
            .orderBy(asc(golfHandicapHistory.recordedAt)),
        ])

        const profileBy = new Map(profiles.map((p) => [p.userId, p]))
        const trendBy = new Map<string, { handicapIndex: string; recordedAt: Date }[]>()
        for (const h of history) {
          const list = trendBy.get(h.userId) ?? []
          list.push({ handicapIndex: h.handicapIndex, recordedAt: h.recordedAt })
          trendBy.set(h.userId, list)
        }

        return people.map((person) => {
          const meta = candidates.get(person.id)!
          const trend = trendBy.get(person.id) ?? []
          return {
            userId: person.id,
            displayName: person.displayName,
            email: person.email,
            status: meta.status,
            source: meta.source,
            orgName: meta.orgName,
            profile: profileBy.get(person.id) ?? null,
            // [] and null mean different things: [] is "approved, no rows recorded yet", null is
            // "the metric tier withheld this". The UI says so rather than drawing an empty chart.
            handicapTrend: meta.status === 'active' ? trend : null,
          }
        })
      },
    )

    res.json(roster)
  } catch (err) {
    next(err)
  }
})


/**
 * ── DRILL SIGN-OFF ────────────────────────────────────────────────────────────────────────────
 * The Parallax loop, without a Parallax integration.
 *
 * A player submits a swing video in Parallax. The coach watches it THERE, then ticks it here.
 * Atlas never fetches, stores or renders the video — `videoRef` is a string the coach keeps for
 * their own record, and nothing reads it. That is deliberate (METRIC-MAP: "Parallax video stays
 * an external videoRef string, not modelled") and it is why this ships without an API contract
 * with a third party.
 *
 * COACH-INITIATED. There is no submission queue and no player-facing surface: the coach opens a
 * student's file, sees the drills, and ticks what they have watched. The alternative — the player
 * records "submitted, here is the ref" — needs a player screen in an intake we deliberately cut
 * down to three sections, so it is not this change.
 *
 * ⚠️ The writes below use EXPLICIT-COLUMN SQL, not db.insert()/db.update(). `atlas_app` holds
 * column-level grants here — it may write the verified / signed_off / video_ref / verify_note columns and must
 * NEVER write ticked_at/watched_at, which are the player's own claim and belong to forge_app.
 * Drizzle names every column of a table in an INSERT, passing `default` for unset ones, which
 * with column grants is refused as `42501 permission denied for table drill_progress`. That is
 * the bug that 403'd every call to /api/intake/start on 2026-09-01.
 */

const verifyBodySchema = z
  .object({
    verified: z.boolean(),
    videoRef: z.string().trim().max(500).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict()

/** A student's drill sign-off state. RLS decides whether the caller may see it at all. */
coachRouter.get('/coach/students/:userId/drills', ...pageOrApiChain, async (req, res, next) => {
  try {
    // A path param goes straight into SQL, so it is validated here rather than trusted. Without
    // this, `/drills/undefined/verify` reached Postgres and came back 500 with
    // `22P02 invalid input syntax for type uuid: "undefined"` — the wrong status for a malformed
    // request, and it leaks the column type. Caught by a test script of my own that guessed the
    // wrong response shape, 2026-09-01.
    const userId = req.params.userId as string
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    const subjectId = req.params.userId as string

    const rows = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db
          .select({
            drillId: golfDrillProgress.drillId,
            tickedAt: golfDrillProgress.tickedAt,
            watchedAt: golfDrillProgress.watchedAt,
            verifiedAt: golfDrillProgress.verifiedAt,
            verifiedByUserId: golfDrillProgress.verifiedByUserId,
            videoRef: golfDrillProgress.videoRef,
            verifyNote: golfDrillProgress.verifyNote,
            updatedAt: golfDrillProgress.updatedAt,
          })
          .from(golfDrillProgress)
          .where(eq(golfDrillProgress.userId, subjectId)),
    )

    // An empty list is a legitimate answer — a student a coach has never ticked anything for. It is
    // NOT distinguishable from "not your student", and that is on purpose: drill_progress_select
    // filters rows the caller may not read, so a stranger gets [] rather than a 403 that confirms
    // the account exists.
    res.json({ drills: rows })
  } catch (err) {
    next(err)
  }
})

/** Tick or untick one drill for one student. Idempotent — re-ticking updates the row. */
coachRouter.post(
  '/coach/students/:userId/drills/:drillId/verify',
  ...pageOrApiChain,
  async (req, res, next) => {
    try {
    // A path param goes straight into SQL, so it is validated here rather than trusted. Without
    // this, `/drills/undefined/verify` reached Postgres and came back 500 with
    // `22P02 invalid input syntax for type uuid: "undefined"` — the wrong status for a malformed
    // request, and it leaks the column type. Caught by a test script of my own that guessed the
    // wrong response shape, 2026-09-01.
    const userId = req.params.userId as string
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
      const parsed = verifyBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const { verified, videoRef, note } = parsed.data
      const me = (req as any).user as typeof users.$inferSelect
      const subjectId = req.params.userId as string
      const drillId = req.params.drillId as string

      /**
       * `drill_id` is unbounded `text` with no CHECK and no FK, so until this line any string a
       * coach could put in a URL became a permanent row in golf.drill_progress. That was tolerable
       * while the page hardcoded three ids; on 2026-09-15 the sign-off list widened to 29 across
       * two namespaces (shared/drills.ts), which is the point at which "whatever is in the path"
       * stops being a small surface.
       *
       * Checked against the SAME list the page renders from, so the two cannot drift: an id the
       * client can display is an id the server accepts, and nothing else is.
       *
       * Verified before shipping that every drill_id already in the live table (`chip20`, `sga30`)
       * is in the list — otherwise this would have made existing sign-offs impossible to revoke.
       */
      if (!isReviewItemId(drillId)) {
        res.status(400).json({ error: 'unknown_drill' })
        return
      }

      /**
       * A STEP CANNOT BE SIGNED BY HAND — Makel's decision, 2026-09-25.
       *
       * He chose "two facts, but sign-off is automatic": a coach verifies each drill, and the step
       * signs itself off when all of its drills are verified. That makes `plan:step-N` a DERIVED
       * row, and a derived row with a second, manual writer is a row that can contradict itself —
       * sign the step, then untick one of its drills, and the two facts disagree with no rule for
       * which wins.
       *
       * Refused here rather than hidden in the UI alone, because the UI is not the gate: this
       * endpoint is reachable from the served page with a session cookie, and `plan:step-N` is a
       * perfectly valid `isReviewItemId`.
       */
      if (isStepCompletionId(drillId)) {
        res.status(409).json({ error: 'step_is_automatic' })
        return
      }

      const row = await withRls(
        pool,
        { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
        schema,
        async (db) => {
          // Explicit columns, and `verified_by_user_id` is the CALLER — never taken from the body.
          // The insert policy pins it to current_user_id() as well, so a forged verifier is
          // refused by the database and not merely by this line.
          const out = await db.execute(sql`
            insert into golf.drill_progress
              (user_id, drill_id, verified_at, verified_by_user_id, video_ref, verify_note, updated_at)
            values
              (${subjectId}, ${drillId},
               ${verified ? sql`now()` : sql`null`},
               ${verified ? me.id : null},
               ${videoRef ?? null}, ${note ?? null}, now())
            on conflict (user_id, drill_id) do update set
              verified_at         = ${verified ? sql`now()` : sql`null`},
              verified_by_user_id = ${verified ? me.id : null},
              video_ref           = coalesce(${videoRef ?? null}, golf.drill_progress.video_ref),
              verify_note         = ${note ?? null},
              updated_at          = now()
            returning drill_id, verified_at, verified_by_user_id, video_ref, verify_note
          `)
          const written = (out.rows as Record<string, unknown>[])[0] ?? null
          // RLS refused the write — do not then go and roll up a step off a change that did not
          // happen. The caller gets the 403 below.
          if (!written) return null

          /**
           * ── ROLL THE STEP UP, IN THIS SAME TRANSACTION ─────────────────────────────────────
           *
           * The step is complete when every plan drill in it is verified, and NOT complete the
           * moment one of them is not. Both directions, deliberately: implementing only the
           * forward one builds a latch, not a derivation — a coach who unticks a drill would
           * leave the step asserting a completion that no longer holds, and the player's
           * `openStep` is derived from exactly that row, so a stale sign-off silently advances
           * them to work they have not earned.
           *
           * Same transaction as the verify above so the drill and its step commit together. Split
           * across two transactions, a failure between them leaves the pair disagreeing, which is
           * the one state this rule exists to make impossible.
           */
          const stepId = stepCompletionIdFor(drillId)
          if (stepId) {
            const step = Number(stepId.slice('plan:step-'.length))
            const siblings = drillIdsInStep(step)
            // ⚠️ The query builder, NOT a raw `= any(${siblings})`. A JS array does not bind as
            // a Postgres array through drizzle's sql template — it produced
            // "op ANY/ALL (array) requires array on right side" and every verify 500'd. Caught by
            // the live round-trip, invisible to typecheck and to every static check in the smoke
            // suite, because the SQL is only wrong at execution.
            const seen = await db
              .select({ drillId: golfDrillProgress.drillId })
              .from(golfDrillProgress)
              .where(
                and(
                  eq(golfDrillProgress.userId, subjectId),
                  inArray(golfDrillProgress.drillId, siblings),
                  isNotNull(golfDrillProgress.verifiedAt),
                ),
              )
            const complete = seen.length === siblings.length

            // `verified_by_user_id` is a real fact even here: it is the coach whose verification
            // completed the step. It is NOT a claim that anyone judged the step itself — that is
            // what `signed_off_at` now means, and why the two columns are not interchangeable.
            await db.execute(sql`
              insert into golf.drill_progress
                (user_id, drill_id, signed_off_at, verified_by_user_id, updated_at)
              values
                (${subjectId}, ${stepId},
                 ${complete ? sql`now()` : sql`null`},
                 ${complete ? me.id : null}, now())
              on conflict (user_id, drill_id) do update set
                signed_off_at       = ${complete ? sql`now()` : sql`null`},
                verified_by_user_id = ${complete ? me.id : null},
                updated_at          = now()
            `)
          }
          return written
        },
      )

      // RLS matched no row and permitted no insert — the caller does not coach this student. An
      // RLS-filtered write matches zero rows SILENTLY, so this is the only place that failure is
      // visible; returning 200 here would report a sign-off that never happened.
      if (!row) {
        res.status(403).json({ error: 'not_your_student' })
        return
      }
      res.json(row)
    } catch (err) {
      // 42501 here is the INSERT policy refusing the row, and it is the normal way this endpoint
      // says no — a coach ticking a student they do not coach, or anyone trying to sign off their
      // own work. Left to the global handler it came back as a 500 carrying the raw Postgres text
      // ("new row violates row-level security policy for table \"drill_progress\""), which is both
      // the wrong status and a leak of the policy and table names.
      //
      // `!row` above covers the OTHER shape of the same refusal: an UPDATE filtered to zero rows,
      // which is silent rather than thrown. Both paths have to be handled or one of them reports a
      // sign-off that never happened.
      if ((err as { code?: string }).code === '42501') {
        res.status(403).json({ error: 'not_your_student' })
        return
      }
      next(err)
    }
  },
)
