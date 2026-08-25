import { Router, type RequestHandler } from 'express'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyToken, attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, golfPlayerProfile } from '@ryp/eco/schema'
import { pool } from '../db'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

// Only the tables this router touches. withRls wants the caller's OWN schema object so drizzle
// types db.query.* against exactly what the route is allowed to read — a narrower object is a
// narrower blast radius, not just a smaller type.
const schema = { users, golfPlayerProfile }

// The identity chain, in the one order that works:
//   verifyToken       — Bearer ID token -> req.firebaseUid. The only Firebase touchpoint.
//   attachUser        — firebase_uid -> public.users row, PROVISIONING it on first login, then
//                       loads user_app_roles. After this, req.user.id is the identity for everything.
//   ensureAtlasAccess — grants the free ('atlas','user') entitlement to a brand-new signup, so
//                       signing up actually gets you in. Needs req.user.id, hence after attachUser.
//   requireApp        — 403s unless the user holds a role in 'atlas'.
//
// requireApp is last on purpose, and ensureAtlasAccess sits immediately before it rather than being
// folded into it: the two answer different questions. One decides whether a NEW person is entitled;
// the other enforces entitlement for everyone, including a person whose access was revoked — who
// passes through ensureAtlasAccess untouched and is still refused here.
const identityChain: RequestHandler[] = [
  verifyToken,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
]

export const meRouter = Router()

// Everything the profile screen needs, in one round trip. Deliberately NOT `select *`: the user row
// carries firebase_uid and internal timestamps that the client has no use for, and a response shape
// that grows silently as columns are added is how internal fields leak.
meRouter.get('/users/me', ...identityChain, async (req, res, next) => {
  try {
    const user = (req as any).user as typeof users.$inferSelect
    const roleRows = (req as any).appRoleRows as { app: string; role: string }[]

    const profile = await withRls(
      pool,
      { userId: user.id, firebaseUid: user.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db.query.golfPlayerProfile.findFirst({
          where: eq(golfPlayerProfile.userId, user.id),
        }),
    )

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        plan: user.plan,
        createdAt: user.createdAt,
      },
      // The client shows which apps this person can reach — the visible half of the nucleus idea.
      roles: roleRows,
      // null is a real answer: a signed-in user with no golf profile yet. The screen says
      // "not set" rather than treating it as a failed load.
      profile: profile ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// Profile edit. `plan` is absent from this schema AND from atlas_app's column-level UPDATE grant on
// public.users — two independent layers, because `users_update` says "you may write your own row"
// and RLS cannot add "…except this column". Without the grant, one careless spread of req.body into
// a users update would let any user set themselves to a paid tier.
const patchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable(),
    handicapIndex: z.number().min(-10).max(60).nullable(),
    driverCarryYds: z.number().int().min(50).max(400).nullable(),
    handedness: z.enum(['left', 'right']),
    ghinNumber: z.string().trim().max(32).nullable(),
  })
  .partial()
  .strict() // an unknown key is a 400, not a silently ignored field

meRouter.patch('/users/me', ...identityChain, async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const user = (req as any).user as typeof users.$inferSelect
    const { displayName, ...profileFields } = parsed.data

    const hasProfileEdit = Object.keys(profileFields).length > 0
    if (displayName === undefined && !hasProfileEdit) {
      res.status(400).json({ error: 'empty_update' })
      return
    }

    const updated = await withRls(
      pool,
      { userId: user.id, firebaseUid: user.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        if (displayName !== undefined) {
          await db
            .update(users)
            .set({ displayName, updatedAt: new Date() })
            .where(eq(users.id, user.id))
        }
        if (hasProfileEdit) {
          // Upsert, because a person can edit their profile before one exists — the row is created
          // by this screen, not by attachUser. handicapIndex is numeric in Postgres and drizzle
          // maps numeric to string, so it is stringified rather than passed as a JS number.
          const values = {
            ...profileFields,
            handicapIndex:
              profileFields.handicapIndex === undefined
                ? undefined
                : profileFields.handicapIndex === null
                  ? null
                  : String(profileFields.handicapIndex),
          }
          await db
            .insert(golfPlayerProfile)
            .values({ userId: user.id, ...values })
            .onConflictDoUpdate({
              target: golfPlayerProfile.userId,
              set: { ...values, updatedAt: new Date() },
            })
        }
        return db.query.golfPlayerProfile.findFirst({
          where: eq(golfPlayerProfile.userId, user.id),
        })
      },
    )

    res.json({ profile: updated ?? null })
  } catch (err) {
    next(err)
  }
})
