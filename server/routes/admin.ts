import { Router, type RequestHandler } from 'express'
import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { verifyToken, attachUser, requireAdmin } from '@ryp/eco/auth'
import { withRls, withRlsBypass } from '@ryp/eco/db'
import {
  users,
  userAppRoles,
  orgMemberships,
  organizations,
  adminAudit,
  APPS,
  ROLES,
  ORG_TYPES,
  ORG_ROLES,
} from '@ryp/eco/schema'
import { pool } from '../db'
import { billingPool } from '../billingDb'

// Read side: everything this router SELECTs, via the normal pool. Reachable with no bypass because
// four admin-read policies (users/user_app_roles/org_memberships/organizations) and
// admin_audit_select_admin already let an Atlas admin see every row through this pool. Never widen
// this schema to a write path — a read-shaped object here is a reminder that this half of the file
// never needs the second pool.
const readSchema = { users, userAppRoles, orgMemberships, organizations, adminAudit }

// Write side: only the tables that are bypass-only by policy, plus admin_audit. Passed to
// withRlsBypass on billingPool — never to the normal pool, which cannot write any of these no
// matter what schema object you hand it.
const writeSchema = { userAppRoles, orgMemberships, organizations, adminAudit }

// Gate, in the one order that answers "who is this" before "may they do admin things":
//   verifyToken   — Bearer ID token -> req.firebaseUid.
//   attachUser    — firebase_uid -> public.users row, loads user_app_roles into req.appRoleRows.
//   requireAdmin  — 403s unless req.appRoleRows holds ('atlas','admin').
//
// ensureAtlasAccess is deliberately ABSENT. It exists to grant a brand-new signup the free
// ('atlas','user') entitlement so signing up actually gets you in — the right behaviour on a
// user-facing route. An admin route must never auto-provision anyone: a caller who is not already
// entitled has to stay refused, not get quietly granted a role on their way to the admin check.
const adminChain: RequestHandler[] = [verifyToken, attachUser(pool), requireAdmin('atlas')]

export const adminRouter = Router()

// ─── audited write helper ─────────────────────────────────────────────────────────────────────
// Every mutation in this file goes through here rather than calling withRlsBypass directly. The
// mutation and the admin_audit insert happen inside the SAME withRlsBypass transaction, so they
// commit or fail together — an audit row written in a separate transaction could go missing for a
// change that actually happened, and an entitlement change with no trail is exactly what this
// table exists to prevent. `fn` reads whatever "before" state it needs INSIDE the transaction
// (never from a value read before the call) so old_value reflects what was actually overwritten,
// not a guess made under a race.
async function auditedWrite<T>(
  actorUserId: string,
  reason: string,
  entry: { entity: string; field: string },
  fn: (
    db: NodePgDatabase<typeof writeSchema>,
  ) => Promise<{ entityId: string; oldValue: string | null; newValue: string | null; result: T }>,
): Promise<T> {
  return withRlsBypass(billingPool, reason, writeSchema, async (db) => {
    const { entityId, oldValue, newValue, result } = await fn(db)
    await db.insert(adminAudit).values({
      actorUserId,
      entity: entry.entity,
      entityId,
      field: entry.field,
      oldValue,
      newValue,
      reason,
    })
    return result
  })
}

const reasonSchema = z
  .object({ reason: z.string().trim().min(1) })
  .strict() // an unknown key is a 400, not a silently ignored field

// ─── GET /admin/users?q= ───────────────────────────────────────────────────────────────────────
adminRouter.get('/admin/users', ...adminChain, async (req, res, next) => {
  try {
    const admin = (req as any).user as typeof users.$inferSelect
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    const result = await withRls(
      pool,
      { userId: admin.id, firebaseUid: admin.firebaseUid, app: 'atlas' },
      readSchema,
      async (db) => {
        const matches = q
          ? await db
              .select()
              .from(users)
              .where(or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`)))
              .limit(50)
          : await db.select().from(users).orderBy(desc(users.createdAt)).limit(50)

        const ids = matches.map((u) => u.id)
        if (ids.length === 0) return []

        const [roleRows, memberRows] = await Promise.all([
          db.select().from(userAppRoles).where(inArray(userAppRoles.userId, ids)),
          db
            .select({
              userId: orgMemberships.userId,
              orgId: orgMemberships.orgId,
              orgName: organizations.name,
              role: orgMemberships.role,
              status: orgMemberships.status,
            })
            .from(orgMemberships)
            .leftJoin(organizations, eq(organizations.id, orgMemberships.orgId))
            .where(and(inArray(orgMemberships.userId, ids), isNull(orgMemberships.deletedAt))),
        ])

        const rolesByUser = new Map<string, { app: string; role: string; revoked: boolean }[]>()
        for (const r of roleRows) {
          const list = rolesByUser.get(r.userId) ?? []
          // revoked = deleted_at is not null — kept in the list (not filtered out) so an admin
          // can see a REVOKED grant, not just current ones.
          list.push({ app: r.app, role: r.role, revoked: r.deletedAt !== null })
          rolesByUser.set(r.userId, list)
        }
        const orgsByUser = new Map<
          string,
          { orgId: string; orgName: string | null; role: string; status: string }[]
        >()
        for (const m of memberRows) {
          const list = orgsByUser.get(m.userId) ?? []
          list.push({ orgId: m.orgId, orgName: m.orgName, role: m.role, status: m.status })
          orgsByUser.set(m.userId, list)
        }

        return matches.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          plan: u.plan,
          createdAt: u.createdAt,
          deletedAt: u.deletedAt,
          appRoles: rolesByUser.get(u.id) ?? [],
          orgs: orgsByUser.get(u.id) ?? [],
        }))
      },
    )

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─── POST /admin/users/:userId/app-roles ───────────────────────────────────────────────────────
const appRoleBodySchema = z
  .object({
    app: z.enum(APPS),
    role: z.enum(ROLES),
    reason: z.string().trim().min(1),
  })
  .strict()

adminRouter.post('/admin/users/:userId/app-roles', ...adminChain, async (req, res, next) => {
  try {
    const parsed = appRoleBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { app, role, reason } = parsed.data
    const actor = (req as any).user as typeof users.$inferSelect
    const userId = req.params.userId as string

    // The caller already holds ('atlas','admin') to have reached this route, so their own atlas
    // row IS the admin row. Editing it here is either a mistake made under one's own credentials
    // or a way to make a real escalation look ordinary in the audit trail — a second admin should
    // be the one to touch it.
    if (userId === actor.id && app === 'atlas') {
      res.status(400).json({ error: 'cannot_modify_own_admin_role' })
      return
    }

    const result = await auditedWrite(
      actor.id,
      reason,
      { entity: 'user_app_roles', field: 'role' },
      async (db) => {
        // Read the previous role INSIDE this transaction — reading it before the call would race
        // against another admin's concurrent write and old_value would be a guess.
        const existing = await db.query.userAppRoles.findFirst({
          where: and(eq(userAppRoles.userId, userId), eq(userAppRoles.app, app)),
        })
        const oldValue = existing?.role ?? null

        await db
          .insert(userAppRoles)
          .values({ userId, app, role })
          .onConflictDoUpdate({
            target: [userAppRoles.userId, userAppRoles.app],
            // Clearing deleted_at is the point of this endpoint doubling as "re-grant": a
            // previously revoked row still occupies the (user_id, app) slot, so bringing someone
            // back is an UPDATE, never a second INSERT.
            set: { role, deletedAt: null, updatedAt: new Date() },
          })

        return { entityId: `${userId}:${app}`, oldValue, newValue: role, result: { app, role } }
      },
    )

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /admin/users/:userId/app-roles/:app ────────────────────────────────────────────────
adminRouter.delete(
  '/admin/users/:userId/app-roles/:app',
  ...adminChain,
  async (req, res, next) => {
    try {
      const parsed = reasonSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const { reason } = parsed.data
      const actor = (req as any).user as typeof users.$inferSelect
      const userId = req.params.userId as string
      const app = req.params.app as string

      if (userId === actor.id && app === 'atlas') {
        res.status(400).json({ error: 'cannot_modify_own_admin_role' })
        return
      }

      const result = await auditedWrite(
        actor.id,
        reason,
        { entity: 'user_app_roles', field: 'deleted_at' },
        async (db) => {
          const existing = await db.query.userAppRoles.findFirst({
            where: and(eq(userAppRoles.userId, userId), eq(userAppRoles.app, app)),
          })
          const oldValue = existing?.deletedAt ? existing.deletedAt.toISOString() : null
          const now = new Date()

          await db
            .update(userAppRoles)
            .set({ deletedAt: now, updatedAt: now })
            .where(and(eq(userAppRoles.userId, userId), eq(userAppRoles.app, app)))

          return {
            entityId: `${userId}:${app}`,
            oldValue,
            newValue: now.toISOString(),
            result: { app, revoked: true },
          }
        },
      )

      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

// ─── GET /admin/orgs ────────────────────────────────────────────────────────────────────────────
adminRouter.get('/admin/orgs', ...adminChain, async (req, res, next) => {
  try {
    const admin = (req as any).user as typeof users.$inferSelect

    const result = await withRls(
      pool,
      { userId: admin.id, firebaseUid: admin.firebaseUid, app: 'atlas' },
      readSchema,
      async (db) => {
        const orgs = await db.select().from(organizations)
        const activeMembers = await db
          .select({ orgId: orgMemberships.orgId, role: orgMemberships.role })
          .from(orgMemberships)
          .where(and(eq(orgMemberships.status, 'active'), isNull(orgMemberships.deletedAt)))

        const counts = new Map<string, { memberCount: number; coachCount: number }>()
        for (const m of activeMembers) {
          const c = counts.get(m.orgId) ?? { memberCount: 0, coachCount: 0 }
          if (m.role === 'coach') c.coachCount += 1
          else if (m.role === 'member') c.memberCount += 1
          counts.set(m.orgId, c)
        }

        return orgs.map((o) => ({
          ...o,
          memberCount: counts.get(o.id)?.memberCount ?? 0,
          coachCount: counts.get(o.id)?.coachCount ?? 0,
        }))
      },
    )

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─── POST /admin/orgs ───────────────────────────────────────────────────────────────────────────
const createOrgSchema = z
  .object({
    name: z.string().trim().min(1),
    type: z.enum(ORG_TYPES),
    reason: z.string().trim().min(1),
  })
  .strict()

adminRouter.post('/admin/orgs', ...adminChain, async (req, res, next) => {
  try {
    const parsed = createOrgSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { name, type, reason } = parsed.data
    const actor = (req as any).user as typeof users.$inferSelect

    const org = await auditedWrite(
      actor.id,
      reason,
      { entity: 'organizations', field: 'created' },
      async (db) => {
        const [inserted] = await db.insert(organizations).values({ name, type }).returning()
        // entity_id is only known once the row exists — computed here, not passed in from the
        // route, which is why it lives in fn's return rather than the fixed `entry` above.
        return { entityId: inserted.id, oldValue: null, newValue: name, result: inserted }
      },
    )

    res.json(org)
  } catch (err) {
    next(err)
  }
})

// ─── POST /admin/orgs/:orgId/members ───────────────────────────────────────────────────────────
// This is the endpoint that unblocks "assign this kid to the academy" — nothing else at any
// privilege level can currently write org_memberships.
const addMemberSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(ORG_ROLES),
    reason: z.string().trim().min(1),
  })
  .strict()

adminRouter.post('/admin/orgs/:orgId/members', ...adminChain, async (req, res, next) => {
  try {
    const parsed = addMemberSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { userId, role, reason } = parsed.data
    const orgId = req.params.orgId as string
    const actor = (req as any).user as typeof users.$inferSelect

    const result = await auditedWrite(
      actor.id,
      reason,
      { entity: 'org_memberships', field: 'role' },
      async (db) => {
        // No unique constraint on (org_id, user_id) — check first, or a re-add creates a
        // duplicate row instead of reviving the existing one.
        const existing = await db.query.orgMemberships.findFirst({
          where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
        })
        const oldValue = existing?.role ?? null

        if (existing) {
          await db
            .update(orgMemberships)
            .set({ role, status: 'active', deletedAt: null })
            .where(eq(orgMemberships.id, existing.id))
        } else {
          await db.insert(orgMemberships).values({ orgId, userId, role, status: 'active' })
        }

        return {
          entityId: `${orgId}:${userId}`,
          oldValue,
          newValue: role,
          result: { orgId, userId, role },
        }
      },
    )

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /admin/orgs/:orgId/members/:userId ─────────────────────────────────────────────────
adminRouter.delete(
  '/admin/orgs/:orgId/members/:userId',
  ...adminChain,
  async (req, res, next) => {
    try {
      const parsed = reasonSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const { reason } = parsed.data
      const orgId = req.params.orgId as string
      const userId = req.params.userId as string
      const actor = (req as any).user as typeof users.$inferSelect

      const result = await auditedWrite(
        actor.id,
        reason,
        { entity: 'org_memberships', field: 'deleted_at' },
        async (db) => {
          const existing = await db.query.orgMemberships.findFirst({
            where: and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
          })
          const oldValue = existing?.deletedAt ? existing.deletedAt.toISOString() : null
          const now = new Date()

          await db
            .update(orgMemberships)
            .set({ deletedAt: now })
            .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))

          return {
            entityId: `${orgId}:${userId}`,
            oldValue,
            newValue: now.toISOString(),
            result: { orgId, userId, revoked: true },
          }
        },
      )

      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

// ─── GET /admin/audit?limit= ────────────────────────────────────────────────────────────────────
adminRouter.get('/admin/audit', ...adminChain, async (req, res, next) => {
  try {
    const admin = (req as any).user as typeof users.$inferSelect
    const rawLimit = Number(req.query.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100

    const rows = await withRls(
      pool,
      { userId: admin.id, firebaseUid: admin.firebaseUid, app: 'atlas' },
      readSchema,
      (db) =>
        db
          .select({
            id: adminAudit.id,
            actorUserId: adminAudit.actorUserId,
            actorDisplayName: users.displayName,
            entity: adminAudit.entity,
            entityId: adminAudit.entityId,
            field: adminAudit.field,
            oldValue: adminAudit.oldValue,
            newValue: adminAudit.newValue,
            reason: adminAudit.reason,
            createdAt: adminAudit.createdAt,
          })
          .from(adminAudit)
          .leftJoin(users, eq(users.id, adminAudit.actorUserId))
          .orderBy(desc(adminAudit.createdAt))
          .limit(limit),
    )

    res.json(rows)
  } catch (err) {
    next(err)
  }
})
