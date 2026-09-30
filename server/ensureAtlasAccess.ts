import type { RequestHandler } from 'express'
import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
// ⚠️ A CHECKED-OUT client emits 'error' ON ITSELF, and an unhandled 'error' event exits the
// process. `pool.on('error')` only covers clients sitting idle. Neon computes scale to zero, so
// any request holding a client when one suspends would take Atlas down. See eco's guardClient.
import { guardClient } from '@ryp/eco/db'
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
/**
 * WHO may be auto-granted Atlas on first sign-in.
 *
 * ⚠️ This gate exists because Atlas authenticates against `rypstick-ios` — the SAME Firebase
 * project as the live RYP Stick iOS app, which held **28,347 real customer accounts** on
 * 2026-09-01. That sharing is deliberate and load-bearing (one firebase_uid per human across every
 * RYP app, see client/src/lib/firebase.ts) — but it means "authenticated" and "invited" are
 * completely different questions, and the original version of this file conflated them. On a
 * public URL, every one of those 28k customers could sign in and be handed an Atlas entitlement
 * plus a row in ryp-core.
 *
 * Format: a comma-separated list of whole emails (`someone@example.com`) and/or domain suffixes
 * (`@rypgolf.com`). Case-insensitive.
 *
 * FAILS CLOSED in production: unset means nobody is auto-granted, because the failure mode of
 * guessing wrong here is handing the unfinished product to a paying customer. In development it is
 * open, so a local signup still works without ceremony.
 */
function signupAllowlist(): string[] {
  return (process.env.ATLAS_SIGNUP_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * May this email be auto-granted Atlas on first sign-in?
 *
 * ── EXACT ADDRESSES ONLY. Domain suffixes are NOT supported, and that is the security control. ──
 *
 * This gate stands in front of `rypstick-ios`, a Firebase project shared with the live RYP Stick
 * iOS app: 28,428 real customer accounts as of 2026-09-03. The email it checks is a token claim
 * (`decoded.email`) that nobody verifies — only 7.2% of that project's accounts have a verified
 * address, so REQUIRING verification is not available to us either; it would lock out every demo
 * account and most real customers.
 *
 * A suffix rule like `@rypgolf.com` was therefore a hole: `anyone@rypgolf.com` is an UNCLAIMED
 * address, and any client of the shared project that lets a person choose their own email — the
 * live iOS sign-up does — could register it and be auto-granted. Self-asserted claim, no
 * verification, whole company domain.
 *
 * An exact address closes that without needing verification, because Firebase enforces email
 * uniqueness: an address already belonging to an account CANNOT be registered by someone else. So
 * allowlisting addresses that already exist is safe even though the claim is unverified. The cost
 * is that inviting someone is a deliberate act — which for an invite-only pre-launch is the point,
 * not a regression.
 *
 * FAILS CLOSED in production: unset means nobody is auto-granted. Open in development.
 */
function mayBeAutoGranted(email: string | null | undefined): boolean {
  const list = signupAllowlist()
  if (list.length === 0) return process.env.NODE_ENV !== 'production'
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return false
  // Deliberately NOT `endsWith`. See the note above — a suffix match is the vulnerability.
  if (list.some((rule) => rule.startsWith('@'))) {
    // Loud, because a stale deploy could otherwise silently keep a domain rule alive.
    console.warn(
      '[ensureAtlasAccess] ATLAS_SIGNUP_ALLOWLIST contains a domain rule; domain rules are ignored. Use exact addresses.',
    )
  }
  return list.includes(e)
}

export function ensureAtlasAccess(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    const user = (req as any).user as { id: string; firebaseUid: string; email?: string | null } | undefined
    const appRoles = ((req as any).appRoles as string[] | undefined) ?? []
    if (!user) return next() // attachUser already answered 401/403
    if (appRoles.includes('atlas')) return next() // the overwhelmingly common case: no query at all

    // Already-entitled users are handled above, so this only ever gates a FIRST grant. Someone who
    // is refused here is not signed out and not errored: they fall through with no atlas role, and
    // requireApp('atlas') answers 403, which the client renders as the "no Atlas access yet"
    // screen. That is a real designed state, not a dead end.
    if (!mayBeAutoGranted(user.email)) return next()

    const client = await pool.connect()
    const unguard = guardClient(client)
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
      unguard()
      client.release()
    }
  }
}
