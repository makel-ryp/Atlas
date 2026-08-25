import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { userAppRoles } from '@ryp/eco/schema'

const schema = { userAppRoles }

/**
 * Grants a brand-new signup the free Atlas entitlement, so signing up actually gets you in.
 *
 * Runs AFTER attachUser (which needs req.user.id) and BEFORE requireApp('atlas'). Without it a new
 * Firebase account gets a public.users row and then a permanent 403, and no Atlas code path could
 * fix that — user_app_roles writes are bypass-only by policy, deliberately, because that is what
 * stops a user granting themselves admin.
 *
 * ── Why this lives in Atlas and not in eco's attachUser ─────────────────────────────────────
 * attachUser is shared by every app. Auto-granting an entitlement there would mean signing into any
 * app grants access to that app, which is exactly the gate the ecosystem is built around. Atlas is
 * the one app where "signed up" and "may use it" are the same statement, because it IS the front
 * door. That is a fact about Atlas, so it belongs in Atlas.
 *
 * ── Why this is not an escalation ───────────────────────────────────────────────────────────
 * The insert is permitted by `user_app_roles_atlas_signup`, whose WITH CHECK pins all three columns:
 * user_id = you, app = 'atlas', role = 'user'. Another app, a higher role, or another user's row are
 * all refused by the database, not by this file. UPDATE remains bypass-only, so the row it writes can
 * never be promoted afterwards.
 */
export function ensureAtlasAccess(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    const user = (req as any).user as { id: string; firebaseUid: string } | undefined
    const appRoles = ((req as any).appRoles as string[] | undefined) ?? []
    if (!user) return next() // attachUser already answered 401/403
    if (appRoles.includes('atlas')) return next() // the overwhelmingly common case: no query at all

    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `select set_config('app.current_user_id', $1, true),
                set_config('app.firebase_uid',    $2, true),
                set_config('app.rls_bypass',      'false', true)`,
        [user.id, user.firebaseUid],
      )
      const db = drizzle(client, { schema })
      const inserted = await db
        .insert(userAppRoles)
        .values({ userId: user.id, app: 'atlas', role: 'user' })
        // onConflictDoNothing, and this is the revocation guard rather than race handling.
        // (user_id, app) is unique, so if an admin has REVOKED this person's Atlas access by setting
        // deleted_at, the row still exists — a DO UPDATE would resurrect it and hand a banned user
        // their access back every time they signed in. DO NOTHING returns no row, we add nothing to
        // req.appRoles, and requireApp('atlas') 403s them, which is the intended outcome.
        .onConflictDoNothing({ target: [userAppRoles.userId, userAppRoles.app] })
        .returning({ app: userAppRoles.app, role: userAppRoles.role })
      await client.query('commit')

      if (inserted[0]) {
        // Reflect it into this request so the very first call after signup succeeds rather than
        // 403ing once and working on retry.
        ;(req as any).appRoles = [...appRoles, 'atlas']
        ;(req as any).appRoleRows = [
          ...(((req as any).appRoleRows as { app: string; role: string }[]) ?? []),
          inserted[0],
        ]
      }
      next()
    } catch (e) {
      await client.query('rollback').catch(() => {})
      next(e)
    } finally {
      client.release()
    }
  }
}
