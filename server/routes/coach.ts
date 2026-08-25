import { Router, type RequestHandler } from 'express'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { verifyToken, attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import {
  users,
  userRelationships,
  orgMemberships,
  organizations,
  golfPlayerProfile,
  golfHandicapHistory,
} from '@ryp/eco/schema'
import { pool } from '../db'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

const schema = {
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
