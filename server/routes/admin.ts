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

// Write side, and there are TWO of them on purpose — see auditedWrite vs auditedScopedWrite below.
//
// bypassWriteSchema: the tables atlas_app holds no privilege on at all. Passed to withRlsBypass on
// billingPool. Handing these to the normal pool cannot work no matter what — the grant is absent,
// which is exactly the guard that makes academy access safe.
// `users` is here for ONE column: parental_consent_at. atlas_app (the ordinary pool) holds a
// column-level UPDATE grant on it AND `users_update` permits writing your own row — so on the
// ordinary pool a minor could consent for themselves, and no RLS policy can prevent that because
// RLS scopes rows, not columns. Routing the write through billing_svc + withRlsBypass is what
// makes the account holder structurally unable to make it, the same argument that keeps
// user_app_roles off the ordinary pool. See POST /admin/users/:userId/parental-consent.
const bypassWriteSchema = { orgMemberships, organizations, adminAudit, users }

// scopedWriteSchema: user_app_roles, which atlas_app CAN write, gated per app by policy. Narrow on
// purpose — a smaller object is a smaller blast radius, not just a smaller type.
const scopedWriteSchema = { userAppRoles, adminAudit }

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

/**
 * A uuid from a path param, lower-cased — or null if it is not a uuid.
 *
 * ⚠️ THE LOWER-CASING IS THE SECURITY CONTROL, not tidiness. Postgres compares `uuid` values
 * case-insensitively; JavaScript compares strings case-sensitively. Every guard in this file that
 * asks "is this row mine?" does it in JavaScript against a value that then reaches Postgres, so an
 * admin passing their OWN id in uppercase failed the JS check and matched the DB row anyway.
 *
 * Verified exploitable 2026-09-03: `POST /api/admin/users/<OWN-ID-UPPERCASED>/app-roles` with
 * {app:'atlas', role:'user'} returned 200 and demoted the admin, while the lower-case form
 * correctly returned 400 cannot_modify_own_admin_role. That guard exists precisely so a real
 * escalation cannot be made to look ordinary in the audit trail, and case defeated it.
 *
 * Returns null rather than throwing so each route answers 400 in its own shape.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function normaliseUuid(raw: unknown): string | null {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) return null
  return raw.toLowerCase()
}

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
    db: NodePgDatabase<typeof bypassWriteSchema>,
  ) => Promise<{ entityId: string; oldValue: string | null; newValue: string | null; result: T }>,
): Promise<T> {
  return withRlsBypass(billingPool, reason, bypassWriteSchema, async (db) => {
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

/**
 * The same audited-single-transaction discipline, but through the ORDINARY pool with NO bypass —
 * and that difference is the whole point rather than an optimisation.
 *
 * `user_app_roles` carries a policy pair, `user_app_roles_app_admin_insert` / `_update`, whose check
 * is `is_app_admin(app)` — it reads the `app` column of the row being written. So an Atlas admin
 * writing `app='locker_room'` is refused BY THE DATABASE. Routing these writes through
 * withRlsBypass would silence that policy completely, and the restriction would exist only in
 * whatever `if` a future edit remembers to keep. Verified as atlas_app: granting atlas roles is
 * allowed, granting locker_room or ryp_red is "new row violates row-level security policy".
 *
 * The audit row rides along in the same transaction under `admin_audit_self_insert`, which permits
 * only `actor_user_id = current_user_id()`. That is strictly stronger than the bypass path it
 * replaces: bypass could attribute an action to any actor, this cannot.
 *
 * Org writes deliberately do NOT come here — atlas_app holds no privilege on org_memberships or
 * organizations at all, and that absence is load-bearing for academy-scoped coach access.
 */
async function auditedScopedWrite<T>(
  actor: { id: string; firebaseUid: string },
  reason: string,
  entry: { entity: string; field: string },
  fn: (
    db: NodePgDatabase<typeof scopedWriteSchema>,
  ) => Promise<{ entityId: string; oldValue: string | null; newValue: string | null; result: T }>,
): Promise<T> {
  return withRls(
    pool,
    { userId: actor.id, firebaseUid: actor.firebaseUid, app: 'atlas' },
    scopedWriteSchema,
    async (db) => {
      const { entityId, oldValue, newValue, result } = await fn(db)
      await db.insert(adminAudit).values({
        actorUserId: actor.id,
        entity: entry.entity,
        entityId,
        field: entry.field,
        oldValue,
        newValue,
        reason,
      })
      return result
    },
  )
}

const reasonSchema = z
  .object({ reason: z.string().trim().min(1) })
  .strict() // an unknown key is a 400, not a silently ignored field

// ─── GET /admin/users?q= ───────────────────────────────────────────────────────────────────────
// The database is the enforcement — `user_app_roles_app_admin_insert` refuses a row whose `app` the
// caller does not administer. This is only here so the caller gets a 403 saying WHY instead of a 500
// carrying a raw Postgres policy-violation string, which is both a poor error and an unnecessary
// disclosure of the schema. Never the other way round: if this check is ever the only thing standing
// between an Atlas admin and a locker_room grant, the restriction has been lost.
function callerAdminsApp(req: unknown, app: string): boolean {
  const rows = (((req as any).appRoleRows as { app: string; role: string }[]) ?? [])
  return rows.some((r) => r.app === app && r.role === 'admin')
}

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
    const userId = normaliseUuid(req.params.userId)
    if (!userId) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }

    // The caller already holds ('atlas','admin') to have reached this route, so their own atlas
    // row IS the admin row. Editing it here is either a mistake made under one's own credentials
    // or a way to make a real escalation look ordinary in the audit trail — a second admin should
    // be the one to touch it.
    if (userId === actor.id.toLowerCase() && app === 'atlas') {
      res.status(400).json({ error: 'cannot_modify_own_admin_role' })
      return
    }
    if (!callerAdminsApp(req, app)) {
      res.status(403).json({ error: 'not_admin_of_app', app })
      return
    }

    const result = await auditedScopedWrite(
      actor,
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
      const userId = normaliseUuid(req.params.userId)
    if (!userId) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
      const app = req.params.app as string

      if (userId === actor.id.toLowerCase() && app === 'atlas') {
        res.status(400).json({ error: 'cannot_modify_own_admin_role' })
        return
      }
      if (!callerAdminsApp(req, app)) {
        res.status(403).json({ error: 'not_admin_of_app', app })
        return
      }

      const result = await auditedScopedWrite(
        actor,
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

// ─── POST /admin/users/:userId/app-access ──────────────────────────────────────────────────────
/**
 * Grant or revoke ONE app role for ONE user, with a mandatory reason. Built for Forge (T-127).
 *
 * ── Why this route exists ──────────────────────────────────────────────────────────────────────
 * Forge access is opt-in per user: a ('forge', …) row in public.user_app_roles, granted separately
 * rather than at signup (docs/decisions/FORGE-PORT-ANSWERS-2026-10-06.md, Batch 2 #5).
 * `user_app_roles_atlas_signup` admits only ('atlas','user') and is deliberately not widened, so
 * NOTHING in the app could write that row — and the alpha branch sat with 10 atlas rows and zero
 * forge rows, every FORGE request 403ing for everyone, until someone unblocked it with hand-run
 * SQL. A change carried by no artifact is exactly how T-107 happened. THIS ROUTE IS THE ALTERNATIVE
 * TO HAND-RUN SQL: if you are about to `insert into user_app_roles` by hand, use it instead, so the
 * grant has an actor, a reason and an admin_audit row. Do not delete it because the SQL "still works".
 *
 * ── Which write path, and why there are two ───────────────────────────────────────────────────
 * `user_app_roles_app_admin_insert/_update` check `is_app_admin(app)`, so an Atlas admin — who holds
 * no ('forge','admin') row, and is not meant to — is REFUSED a forge write on the ordinary pool.
 * That refusal is correct for locker_room/ryp_red/debrief and it must stay. For forge the decision
 * (Answers #5) is the audited billing_svc + withRlsBypass pattern parental-consent uses. So:
 *
 *   BYPASS_GRANTABLE apps (forge)  -> auditedWrite on billingPool. NO POLICY BINDS on this path, so
 *                                     every restriction below is a plain `if` and is the ONLY gate.
 *   every other app               -> auditedScopedWrite on the ordinary pool, where the database
 *                                     decides via is_app_admin(app). Only reachable by an admin of
 *                                     that app (callerAdminsApp is a message-quality pre-check; the
 *                                     policy is the real gate).
 *
 * ⚠️ Adding an app to BYPASS_GRANTABLE REMOVES DATABASE ENFORCEMENT FOR THAT APP. Letting
 * locker_room fall through to bypass would reopen the 2026-08-26 hole in which an Atlas admin could
 * grant themselves Locker Room admin and read every Locker Room user. A narrow policy admitting an
 * Atlas admin to write ('forge', non-admin) would let forge move onto the scoped path and make the
 * `if`s below unnecessary — that is a schema decision (db-engineer), not this file's.
 *
 * ── What the bypass path refuses ──────────────────────────────────────────────────────────────
 * - role 'admin' for anybody. Minting a Forge admin would hand out scoped authority through a path
 *   nothing in the database checks, and it also covers "an admin grants THEMSELVES admin on an app
 *   they do not administer": requireAdmin('atlas') proves Atlas authority only, and on bypass no
 *   policy adds more. Refused here, stated here, because nothing else will.
 * - any app not in BYPASS_GRANTABLE unless the caller already administers it.
 * - self-modification of the caller's own ('atlas', …) row, matching the app-roles routes.
 *
 * ── Writes ────────────────────────────────────────────────────────────────────────────────────
 * (user_id, app) is UNIQUE, so there is one row per user per app. Grant is therefore insert-or-
 * revive-in-place: a revoked row still occupies the slot and re-granting clears deleted_at (a second
 * INSERT would hit the unique index). Revoke is a soft delete — deleted_at, never DELETE; no role
 * holds DELETE here. Every write is checked with .returning(): an RLS-filtered UPDATE matches ZERO
 * rows and raises nothing, so a 200 on an unchecked write is a lie. A refusal THROWS from inside the
 * transaction so the admin_audit row rolls back with it — an audit row for a change that did not
 * happen is worse than none.
 */
const BYPASS_GRANTABLE: Partial<Record<(typeof APPS)[number], readonly (typeof ROLES)[number][]>> = {
  forge: ROLES.filter((r) => r !== 'admin'),
}

const appAccessBodySchema = z
  .object({
    app: z.enum(APPS),
    role: z.enum(ROLES),
    action: z.enum(['grant', 'revoke']),
    // Required and non-empty: an audit row with no reason is a log nobody can read later.
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

// Thrown from inside the write transaction so it rolls back (audit row included), then translated
// to an HTTP status outside it.
class AccessRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

// Only select/insert/update are used, none of which depend on the schema generic, so one helper can
// run on either path's transaction handle.
type AccessDb = NodePgDatabase<any>

async function applyAccessChange(
  db: AccessDb,
  p: { userId: string; app: string; role: string; action: 'grant' | 'revoke' },
): Promise<{ oldValue: string | null; newValue: string }> {
  const { userId, app, role, action } = p
  const label = `${app}:${role}`

  if (action === 'revoke') {
    // Matches ONLY a live row holding exactly this role, so revoking something that is not granted
    // is a 404 rather than a quiet success, and an already-revoked row is not "revoked again".
    const done = await db
      .update(userAppRoles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(userAppRoles.userId, userId),
          eq(userAppRoles.app, app),
          eq(userAppRoles.role, role),
          isNull(userAppRoles.deletedAt),
        ),
      )
      .returning({ id: userAppRoles.id })
    if (done.length !== 1) throw new AccessRefused(404, 'no_active_role')
    return { oldValue: label, newValue: 'revoked' }
  }

  // The FK would catch a missing user (23503), but a deleted account must not be handed access
  // either, and attachUser refuses one anyway.
  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)
  if (target.length === 0) throw new AccessRefused(404, 'user_not_found')

  // Read INSIDE the transaction so old_value is what was actually overwritten.
  const [existing] = await db
    .select()
    .from(userAppRoles)
    .where(and(eq(userAppRoles.userId, userId), eq(userAppRoles.app, app)))
    .limit(1)

  if (existing && existing.deletedAt === null && existing.role === role) {
    throw new AccessRefused(409, 'already_granted')
  }

  // 🔴 NEVER SILENTLY OVERWRITE AN EXISTING `admin` ROW. Added 2026-10-15 after the route was
  // driven against the alpha branch and this came back as a real hole.
  //
  // The route already refuses GRANTING admin. It did not refuse OVERWRITING one: a plain grant of
  // 'user' over an existing ('forge','admin') row passed the already_granted check above and then
  // UPDATE … SET role='user' DEMOTED that admin — on the bypass path, where no policy binds and
  // nothing would have stopped it. An Atlas admin could strip a Forge admin without ever naming
  // the word admin in the request.
  //
  // Refused on BOTH paths rather than only on bypass, deliberately. On the ordinary pool the
  // policy already refuses it, so this check is redundant there — and that is the point: one rule
  // that reads the same wherever you find it, instead of a conditional whose safety depends on
  // remembering which pool you are on. Changing an admin role is a deliberate act and does not
  // belong behind a grant button.
  if (existing && existing.deletedAt === null && existing.role === 'admin') {
    throw new AccessRefused(403, 'role_not_grantable_here')
  }
  const oldValue = existing
    ? `${app}:${existing.role}${existing.deletedAt ? ' (revoked)' : ''}`
    : null

  if (existing) {
    const done = await db
      .update(userAppRoles)
      .set({ role, deletedAt: null, updatedAt: new Date() })
      .where(eq(userAppRoles.id, existing.id))
      .returning({ id: userAppRoles.id })
    if (done.length !== 1) throw new AccessRefused(404, 'no_rows_written')
  } else {
    const done = await db
      .insert(userAppRoles)
      .values({ userId, app, role })
      .returning({ id: userAppRoles.id })
    if (done.length !== 1) throw new AccessRefused(404, 'no_rows_written')
  }
  return { oldValue, newValue: label }
}

adminRouter.post('/admin/users/:userId/app-access', ...adminChain, async (req, res, next) => {
  try {
    const parsed = appAccessBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { app, role, action, reason } = parsed.data
    const actor = (req as any).user as typeof users.$inferSelect
    const userId = normaliseUuid(req.params.userId)
    if (!userId) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }

    if (userId === actor.id.toLowerCase() && app === 'atlas') {
      res.status(400).json({ error: 'cannot_modify_own_admin_role' })
      return
    }

    const bypassRoles = BYPASS_GRANTABLE[app]
    const viaBypass = bypassRoles !== undefined
    if (viaBypass) {
      // NO POLICY BINDS ON THIS PATH — these ifs are the only gate. See the header.
      if (!bypassRoles.includes(role)) {
        res.status(403).json({ error: 'role_not_grantable_here', app, role })
        return
      }
    } else if (!callerAdminsApp(req, app)) {
      // Pre-check for a readable 403 only. The database is the real gate on this path:
      // user_app_roles_app_admin_insert/_update refuse it via is_app_admin(app).
      res.status(403).json({ error: 'not_admin_of_app', app })
      return
    }

    const entry = { entity: 'user_app_roles', field: 'app_access' }
    // The path rides in the reason so GET /admin/audit answers who/whom/what/why/how with no join.
    const auditReason = `app access ${action} ${app}:${role} [${viaBypass ? 'bypass' : 'rls'}]: ${reason}`
    const change = { userId, app, role, action }

    const outcome = viaBypass
      ? await auditedWrite(actor.id, auditReason, entry, async (db) => {
          const c = await applyAccessChange(db, change)
          return { entityId: `${userId}:${app}`, ...c, result: c }
        })
      : await auditedScopedWrite(actor, auditReason, entry, async (db) => {
          const c = await applyAccessChange(db, change)
          return { entityId: `${userId}:${app}`, ...c, result: c }
        })

    res.json({ userId, app, role, action, active: action === 'grant', previous: outcome.oldValue })
  } catch (err) {
    if (err instanceof AccessRefused) {
      res.status(err.status).json({ error: err.code })
      return
    }
    // drizzle may wrap the pg error, so look one level down for the code.
    const code = (err as any)?.code ?? (err as any)?.cause?.code
    // 42501: a WITH CHECK / missing-grant refusal. A specific 403, never a 500 carrying the raw
    // Postgres policy string (schema disclosure, and it reads as a crash).
    if (code === '42501') {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (code === '23503') {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    if (code === '23505') {
      // Two admins granting the same (user, app) at once; the loser's transaction rolled back.
      res.status(409).json({ error: 'conflict_retry' })
      return
    }
    next(err)
  }
})

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
      const userId = normaliseUuid(req.params.userId)
    if (!userId) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
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

// ─── POST /admin/users/:userId/parental-consent ────────────────────────────────────────────────
/**
 * Record that a parent or guardian has consented to this account being used.
 *
 * ── Why an admin records it rather than the guardian clicking a link ────────────────────────
 * Because WHAT COUNTS AS CONSENT IS NOT SETTLED, and building the wrong mechanism is worse than
 * building none. COPPA requires *verifiable* parental consent for under-13s — a credit-card
 * check, a signed form, a phone call, an ID — and says explicitly that an email confirmation is
 * not sufficient for data disclosed to third parties, which a coach reading a student's file is.
 * For 13–17 a guardian email attestation is usually proportionate. Which applies, and where the
 * line sits, is a question for counsel (docs/TASKS.md T-16).
 *
 * This endpoint is deliberately AGNOSTIC to that answer. It records the fact that consent was
 * obtained and by what means, whoever obtained it and however. A phone call, a signed form handed
 * over at the academy, a verified email link built later — all of them end here. That makes it
 * correct under every candidate policy instead of correct under a guessed one, and it is also how
 * a small academy actually operates at alpha scale: the coach talks to the parent.
 *
 * `method` is stored in the audit trail rather than on `users`, because the column that exists is
 * a single timestamp and inventing a second one is an eco migration this does not need. The audit
 * row is the record of HOW; `parental_consent_at` is the record of WHETHER.
 *
 * ⚠️ This is a bypass write on `billingPool` and it must stay one. See bypassWriteSchema.
 */
const parentalConsentBodySchema = z
  .object({
    // Free text on purpose — the list of legitimate methods is exactly what is not yet decided,
    // and an enum written today would be a guess that later reads as a policy. Bounded so the
    // audit trail stays readable.
    method: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1),
  })
  .strict()

adminRouter.post('/admin/users/:userId/parental-consent', ...adminChain, async (req, res, next) => {
  try {
    const parsed = parentalConsentBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { method, reason } = parsed.data
    const actor = (req as any).user as typeof users.$inferSelect
    const userId = normaliseUuid(req.params.userId)
    if (!userId) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }

    const now = new Date()
    const result = await auditedWrite(
      actor.id,
      // The method rides in the reason too, so `GET /admin/audit` answers "how was this consent
      // obtained" without a join — the question anyone auditing this will actually ask.
      `parental consent recorded (${method}): ${reason}`,
      { entity: 'users', field: 'parental_consent_at' },
      async (db) => {
        // Read inside the transaction — see auditedWrite's note on old_value.
        const existing = await db.query.users.findFirst({ where: eq(users.id, userId) })
        if (!existing) return { entityId: userId, oldValue: null, newValue: null, result: null }

        await db.update(users).set({ parentalConsentAt: now, updatedAt: now }).where(eq(users.id, userId))

        return {
          entityId: userId,
          oldValue: existing.parentalConsentAt?.toISOString() ?? null,
          newValue: now.toISOString(),
          result: { userId, parentalConsentAt: now },
        }
      },
    )

    if (!result) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─── DELETE /admin/users/:userId/parental-consent ──────────────────────────────────────────────
/**
 * Withdraw consent. The account is blocked again from the next request.
 *
 * Not symmetry for its own sake: withdrawing consent is a right a guardian has, and a gate that
 * can only be opened is not a consent mechanism, it is a one-time waiver. Same bypass path, same
 * audit trail, so the withdrawal is as recorded as the grant.
 */
const withdrawConsentBodySchema = z.object({ reason: z.string().trim().min(1) }).strict()

adminRouter.delete('/admin/users/:userId/parental-consent', ...adminChain, async (req, res, next) => {
  try {
    const parsed = withdrawConsentBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const actor = (req as any).user as typeof users.$inferSelect
    const userId = normaliseUuid(req.params.userId)
    if (!userId) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }

    const result = await auditedWrite(
      actor.id,
      `parental consent withdrawn: ${parsed.data.reason}`,
      { entity: 'users', field: 'parental_consent_at' },
      async (db) => {
        const existing = await db.query.users.findFirst({ where: eq(users.id, userId) })
        if (!existing) return { entityId: userId, oldValue: null, newValue: null, result: null }

        await db
          .update(users)
          .set({ parentalConsentAt: null, updatedAt: new Date() })
          .where(eq(users.id, userId))

        return {
          entityId: userId,
          oldValue: existing.parentalConsentAt?.toISOString() ?? null,
          newValue: null,
          result: { userId, parentalConsentAt: null },
        }
      },
    )

    if (!result) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})
