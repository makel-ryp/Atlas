import { Router, type RequestHandler } from 'express'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, golfPlayerProfile } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { requireConsent } from '../requireConsent'
import { consentStateFor, storedDateOfBirth, dateOfBirthProblem } from '../../shared/consent'

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
/**
 * Cookie OR bearer. Third route to need this, after coach.ts and notes.ts — see ../cookieOrBearer.
 *
 * The SPA sends a bearer token, but Luke's served prototype authenticates with the session cookie
 * and is where a PLAYER actually lives. `PATCH /api/users/me` is how a golfer sets their own
 * display name, and bearer-only made that unreachable from the only page they see — which is a
 * large part of why the coach's roster prints email addresses where names belong.
 */
const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
]

/**
 * The same chain plus the consent gate — used by everything in this file EXCEPT the two routes
 * that answer the gate.
 *
 * ⚠️ THE SPLIT IS THE DESIGN, not an oversight. `requireConsent` refuses an account whose date of
 * birth is unrecorded, and the only way to record one is `POST /users/me/date-of-birth`. Put that
 * route behind the gate and the sole exit from the gate sits inside it — every one of the 12
 * existing accounts, including every admin, would be permanently locked out with no code path back
 * in. `GET /users/me` is ungated for the same reason one step earlier: the client has to be able
 * to ASK what it still owes.
 *
 * Nothing else may join them. `PATCH /users/me` is gated because it writes a golf profile, which
 * is data collection — the thing consent is for.
 */
const gatedChain: RequestHandler[] = [...identityChain, requireConsent()]

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
        // Identity, and deliberately part of the ungated response: this is how the client knows
        // which screen to show instead of walking the user into a wall of 403s. `dateOfBirth` is
        // echoed so the DOB screen can render read-only once set rather than inviting a re-entry
        // it would refuse; `parentalConsentAt` so a guardian-pending screen can say whether the
        // approval has landed yet.
        dateOfBirth: user.dateOfBirth,
        parentalConsentAt: user.parentalConsentAt,
      },
      // The single source of truth for "what does this account still owe", computed server-side
      // from shared/consent.ts so the client cannot drift from the middleware's answer — the same
      // rule as never re-deriving an RLS predicate in TypeScript.
      consent: consentStateFor(user),
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
    // Nullable: 'not recorded' is a real state and must be storable. The form used to default
    // to 'right', which stamped a fabricated handedness on the first save of any field — and the
    // dashboard mirrors its dispersion geometry and flips a bias sign on that value.
    handedness: z.enum(['left', 'right']).nullable(),
    ghinNumber: z.string().trim().max(32).nullable(),
    /**
     * The handicap the golfer is working TOWARD. Added 2026-09-21 (T-35).
     *
     * The rail has always had a slider for this and it has never saved — it moved the value for the
     * session and lost it on reload, under a caption reading "Set one and every benchmark on this
     * page reads against it". A control that states what it will do and then does not is worse than
     * no control.
     *
     * Bounds mirror the live CHECK `player_profile_target_handicap_range` (-6..30), the same source
     * `shared/interview.ts` mirrors — a value outside it would abort the write at the database.
     * Nullable: clearing a target is a real action, and null reads as "no target set", not zero.
     */
    targetHandicap: z.number().min(-6).max(30).nullable(),
  })
  .partial()
  .strict() // an unknown key is a 400, not a silently ignored field

meRouter.patch('/users/me', ...gatedChain, async (req, res, next) => {
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
            // Same numeric→string treatment as handicapIndex, and for the same drizzle reason.
            targetHandicap:
              profileFields.targetHandicap === undefined
                ? undefined
                : profileFields.targetHandicap === null
                  ? null
                  : String(profileFields.targetHandicap),
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

/**
 * Record this account's date of birth. WRITE ONCE.
 *
 * ── Why this is its own route and not a field on PATCH /users/me ────────────────────────────
 * Three reasons, and all three are load-bearing:
 *
 * 1. **It has to be reachable from inside the gate.** PATCH is consent-gated; this cannot be, or
 *    the only way to answer 'dob_required' would sit behind 'dob_required'. See `gatedChain`.
 * 2. **It is write-once and PATCH is not.** Mixing a field that refuses its own second write into
 *    a general-purpose partial update makes "empty_update" and "already set" the same request
 *    shape, and the caller cannot tell which happened.
 * 3. **Age is the input to a legal gate.** A route whose entire job is one guarded write is a
 *    route someone reviewing the gate can read in full. Buried as the eleventh key of a partial
 *    update, it would not be.
 *
 * ── Why write-once ──────────────────────────────────────────────────────────────────────────
 * Self-asserted age is always defeatable — a 15-year-old can type 1990 on the way in, and no
 * software fixes that; what stops it is the same thing that stops it everywhere, namely that
 * lying is the user's act and not the system's. What software CAN stop is the second lie: an
 * account that established itself as a consented minor editing its way out of the gate the moment
 * it finds the gate inconvenient. So the first answer binds, and changing it afterwards is an
 * administrative act with an audit row, exactly like consent itself.
 *
 * ⚠️ `parental_consent_at` is NOT writable here, and NOT in `patchSchema` either. That is
 * deliberate and it is the single most important line in this file. `public.users` grants
 * atlas_app column-level UPDATE on `parental_consent_at`, and `users_update` permits updating
 * your OWN row — so the database, today, would happily let a 14-year-old consent for themselves.
 * RLS scopes rows and not columns, so there is no policy that fixes it; the only barrier is that
 * no route the account holder can reach ever writes that column. `patchSchema` is `.strict()`, so
 * keeping the key absent is an active refusal (400), not an oversight. Consent is written in
 * routes/admin.ts, through billing_svc, audited. Do not add it here "for completeness".
 * (docs/operations/CONSENT-GRANT-REVOKE.sql removes the grant so this is two layers, not one.)
 */
const dobSchema = z
  .object({
    // Y/M/D integers, NOT an ISO string. A string is parsed by whatever zone the server happens to
    // run in, and a one-day slip here moves a person across the 18 threshold — it either admits an
    // unconsented minor or holds an adult out. Integers cannot be time-zone-shifted.
    year: z.number().int().min(1900).max(2200),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict()

meRouter.post('/users/me/date-of-birth', ...identityChain, async (req, res, next) => {
  try {
    const parsed = dobSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const user = (req as any).user as typeof users.$inferSelect

    // Write-once, checked here AND enforced by the WHERE clause below — the check is for a clean
    // error message, the WHERE is for the race between two tabs.
    if (user.dateOfBirth) {
      res.status(409).json({ error: 'date_of_birth_already_set' })
      return
    }

    const { year, month, day } = parsed.data
    // Rejects 30 February rather than letting Date roll it into March. Stored at noon UTC so the
    // calendar date survives every time zone — see shared/consent.ts.
    const dob = storedDateOfBirth(year, month, day)
    if (!dob) {
      res.status(400).json({ error: 'date_of_birth_invalid' })
      return
    }
    const problem = dateOfBirthProblem(dob)
    if (problem) {
      res.status(400).json({ error: problem })
      return
    }

    const written = await withRls(
      pool,
      { userId: user.id, firebaseUid: user.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db
          .update(users)
          .set({ dateOfBirth: dob, updatedAt: new Date() })
          // `isNull(dateOfBirth)` is the write-once guard that actually holds: two tabs posting at
          // once both pass the check above, and without this the second would overwrite the first.
          .where(and(eq(users.id, user.id), isNull(users.dateOfBirth)))
          .returning({ dateOfBirth: users.dateOfBirth, parentalConsentAt: users.parentalConsentAt }),
    )

    // ⚠️ ZERO ROWS IS NOT SUCCESS. An RLS-filtered UPDATE matches nothing and reports no error —
    // the exact silent failure CLAUDE.md names. Returning 200 here would tell the client the gate
    // was answered when the column is still null, and the client would loop on a screen that
    // appears to save and never does.
    const row = written[0]
    if (!row) {
      res.status(409).json({ error: 'date_of_birth_already_set' })
      return
    }

    res.json({
      dateOfBirth: row.dateOfBirth,
      parentalConsentAt: row.parentalConsentAt,
      // Recomputed from what was actually stored, so the client learns in the same round trip
      // whether it is through ('ok') or now waiting on a guardian ('consent_required').
      consent: consentStateFor(row),
    })
  } catch (err) {
    next(err)
  }
})
