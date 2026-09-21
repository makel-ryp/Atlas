/**
 * Seeds the demo accounts: 2 players, 1 coach, and a coach_of edge between them.
 *
 * Run:  npm run seed
 * Idempotent — re-running reuses the Firebase users and upserts every row, so it is safe to run
 * against a database that already has them.
 *
 * ── Why this creates FIREBASE users and not just database rows ──────────────────────────────
 * `public.users.firebase_uid` is the join key. A seeded row with a made-up uid is an account nobody
 * can sign into, which would leave the two-account isolation demo with no accounts to run. So each
 * person is created in Firebase FIRST and the returned uid is what lands in the database.
 *
 * ── Why it uses two different roles ────────────────────────────────────────────────────────
 * Deliberately not one privileged connection doing everything. Each write goes through the same
 * path production uses, so a policy that would reject the real app rejects the seed too:
 *
 *   atlas_app   — public.users (insert scoped by app.firebase_uid, exactly like eco's attachUser),
 *                 golf.player_profile and public.user_relationships (self-scoped via withRls).
 *   billing_svc — public.user_app_roles ONLY, via withRlsBypass. That table is bypass-only by
 *                 policy and billing_svc is the only role holding write grants on it. Granting an
 *                 entitlement is the one thing an app may not do for itself; that is the whole
 *                 reason a user cannot make themselves an admin.
 *
 * Note that atlas_app does the users INSERT because billing_svc has no INSERT on public.users, and
 * billing_svc does the roles INSERT because atlas_app's policy refuses it. Neither role can seed
 * this alone, which is the separation working rather than an inconvenience.
 */
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { firebaseAuth } from '@ryp/eco/auth'
import { withRls, withRlsBypass } from '@ryp/eco/db'
import {
  coachProfiles,
  users,
  userAppRoles,
  userRelationships,
  golfPlayerProfile,
  golfHandicapHistory,
  atlasIntakeSubmissions,
} from '@ryp/eco/schema'

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'RypDemo!2026'

interface SeedPerson {
  email: string
  displayName: string
  role: 'user' | 'coach' | 'admin'
  /**
   * What state to leave this person's Practice DNA run in.
   *
   * 'fresh'     — reset to in_progress with every answer blanked. They land IN the intake.
   * 'completed' — marked complete. They land on their dashboard instead.
   *
   * This exists so the three demo entry points are ALL ready after one `npm run seed`, rather
   * than each needing the database nudged into a different state before it can be shown. Whoever
   * is demoing should never have to remember which account is in which condition.
   */
  intake?: 'fresh' | 'completed'
  /**
   * [year, month, day] — seeded because the consent gate (T-16) refuses an account whose age is
   * unknown, and "unknown" is not a demo state, it is a wall.
   *
   * Without this every demo entry point lands on the date-of-birth screen instead of the thing it
   * exists to show, and STATUS.md's "three demo entry points, ready after one npm run seed" stops
   * being true the moment the gate ships. Adults on purpose: a minor would additionally need
   * `parental_consent_at`, and a demo that silently consents on a child's behalf teaches exactly
   * the wrong thing about how that column gets written.
   *
   * These are synthetic people, so a birthday is seed data like their handicap — not a claim about
   * anyone real. REAL accounts are deliberately NOT backfilled: nobody has ever been asked, and
   * inventing a date of birth for a person is a No Fiction violation aimed at a human being.
   */
  dateOfBirth?: [number, number, number]
  profile?: {
    handicapIndex: string
    targetHandicap?: string
    driverCarryYds: number
    handedness: 'left' | 'right'
    ghinNumber: string
  }
}

// Two players with visibly different numbers — the isolation demo is only convincing if the second
// login obviously shows different data, not a different UUID in a debug panel.
const PEOPLE: SeedPerson[] = [
  {
    email: 'demo.player1@rypgolf.com',
    dateOfBirth: [1994, 6, 12],
    displayName: 'Avery Lane',
    role: 'user',
    // `targetHandicap` is what every benchmark on the coach dashboard reads against. Seeded so
    // the rail shows a real reference instead of the 5 it used to hardcode.
    profile: { handicapIndex: '4.2', targetHandicap: '2.0', driverCarryYds: 268, handedness: 'right', ghinNumber: '8801234' },
    // The PLAYER DASHBOARD entry point. Completed, so the intake gate lets her through.
    intake: 'completed',
  },
  {
    email: 'demo.player2@rypgolf.com',
    dateOfBirth: [1988, 11, 3],
    displayName: 'Jordan Reyes',
    role: 'user',
    profile: { handicapIndex: '17.8', targetHandicap: '12.0', driverCarryYds: 212, handedness: 'left', ghinNumber: '8809876' },
    // The INTAKE entry point. Left fresh so signing in drops straight into question one.
    intake: 'fresh',
  },
  {
    email: 'demo.coach@rypgolf.com',
    dateOfBirth: [1979, 2, 22],
    displayName: 'Coach Sam Ellis',
    role: 'coach',
    // A coach plays golf too, and the served prototype's rail is THEIR own reference block — it
    // prints their target and index on every screen. Without a profile it renders '—' throughout,
    // which is honest but makes the feature look unbuilt during a demo.
    profile: { handicapIndex: '6.8', targetHandicap: '3.0', handedness: 'right' },
  },
  // The ops account. Needed because `user_app_roles` writes are bypass-only, so the FIRST admin
  // cannot be created by any request path — it has to come from here or from raw SQL. No golf
  // profile: this is a role, not a golfer, and giving it one would put a fake player in the roster.
  {
    email: 'demo.admin@rypgolf.com',
    dateOfBirth: [1985, 9, 30],
    displayName: 'Admin (Ops)',
    role: 'admin',
  },
]

const schema = {
  users,
  userAppRoles,
  userRelationships,
  coachProfiles,
  golfPlayerProfile,
  golfHandicapHistory,
  atlasIntakeSubmissions,
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — copy .env.example and fill it in`)
  return value
}

// Reuse an existing auth user rather than failing on email-already-exists, so the script can be
// re-run. The password is reset on every run so a forgotten demo password is never a blocker.
async function upsertFirebaseUser(email: string, displayName: string): Promise<string> {
  const auth = firebaseAuth()
  try {
    const existing = await auth.getUserByEmail(email)
    await auth.updateUser(existing.uid, { password: SEED_PASSWORD, displayName })
    return existing.uid
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
    const created = await auth.createUser({ email, password: SEED_PASSWORD, displayName })
    return created.uid
  }
}

async function main() {
  const appPool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL') })
  const billingPool = new pg.Pool({ connectionString: requireEnv('BILLING_DATABASE_URL') })

  try {
    const seeded: { person: SeedPerson; userId: string; firebaseUid: string }[] = []

    for (const person of PEOPLE) {
      const firebaseUid = await upsertFirebaseUser(person.email, person.displayName)

      // Mirrors eco's attachUser cold start: app.firebase_uid set, no user id yet, so the insert
      // is authorised by `users_insert`'s firebase_uid = app_private.firebase_uid() branch.
      const client = await appPool.connect()
      let userId: string
      try {
        await client.query('begin')
        await client.query(
          `select set_config('app.firebase_uid', $1, true),
                  set_config('app.rls_bypass',  'false', true)`,
          [firebaseUid],
        )
        const db = drizzle(client, { schema })
        const inserted = await db
          .insert(users)
          .values({ firebaseUid, email: person.email, displayName: person.displayName })
          .onConflictDoNothing({ target: users.firebaseUid })
          .returning({ id: users.id })
        const row =
          inserted[0] ??
          (await db.query.users.findFirst({ where: eq(users.firebaseUid, firebaseUid) }))
        if (!row) throw new Error(`could not provision ${person.email}`)
        userId = row.id
        await client.query('commit')
      } catch (e) {
        await client.query('rollback').catch(() => {})
        throw e
      } finally {
        client.release()
      }

      // The date of birth, which the consent gate reads. Done as its own UPDATE rather than in the
      // insert above, because that insert is onConflictDoNothing and every demo account already
      // exists — so an insert-only value would never reach the rows that actually need it.
      // billing_svc, not the app pool: `parental_consent_at` is going to be revoked from the app
      // roles' column grant (docs/operations/CONSENT-GRANT-REVOKE.sql), and the seed should already
      // be writing through the path that survives that.
      if (person.dateOfBirth) {
        const [y, m, d] = person.dateOfBirth
        await withRlsBypass(
          billingPool,
          `seed: set date of birth for ${person.email}`,
          schema,
          (db) =>
            db
              .update(users)
              // Noon UTC — see shared/consent.ts. Midnight renders as the previous day in every US
              // time zone, and here a one-day slip can move a seeded account across the threshold.
              .set({ dateOfBirth: new Date(Date.UTC(y, m - 1, d, 12)), updatedAt: new Date() })
              .where(eq(users.id, userId)),
        )
      }

      // The entitlement. Without this row requireApp('atlas') 403s — which is the correct default,
      // and the reason a fresh Firebase signup cannot see Atlas until someone grants it.
      await withRlsBypass(
        billingPool,
        `seed: grant atlas '${person.role}' to ${person.email}`,
        schema,
        (db) =>
          db
            .insert(userAppRoles)
            .values({ userId, app: 'atlas', role: person.role })
            .onConflictDoUpdate({
              target: [userAppRoles.userId, userAppRoles.app],
              // deleted_at reset matters: a re-run must un-revoke, or a previously soft-deleted
              // entitlement stays invisible to attachUser and the account silently 403s.
              set: { role: person.role, deletedAt: null, updatedAt: new Date() },
            }),
      )

      // Return the Practice DNA intake to a pristine, unanswered state.
      //
      // The runbook promises `npm run seed` "resets all four accounts and their data", and until
      // now that was not true of this table — a demo rehearsal that finished the quiz left the
      // account permanently past the intake gate, so the signup → quiz → home flow could only ever
      // be shown once. (Hit for real on 2026-09-01: a smoke run completed player 1's intake and no
      // reseed could undo it.)
      //
      // RESET, not DELETE, and that is forced rather than stylistic: `atlas_app` holds no DELETE
      // privilege on this table, and withRlsBypass only flips a GUC — it does not change the
      // Postgres role, so it cannot conjure a grant. Blanking the answer columns is equivalent for
      // every consumer anyway, because the gate keys on `status`, and /intake/start would upsert
      // this same row back for a user who had none.
      //
      // The columns set below are exactly the ones atlas_app holds column-level UPDATE on.
      // id, user_id, instrument, source_app, quality_flag, started_at and deleted_at are withheld
      // on purpose — adding any of them here would fail with 42501, not be silently skipped.
      await withRls(appPool, { userId, firebaseUid, app: 'atlas' }, schema, (db) =>
        db
          .update(atlasIntakeSubmissions)
          .set(
            person.intake === 'completed'
              ? // Completed, but the ANSWERS are still cleared: this account exists to show the
                // dashboard, and leaving a half-finished run behind it would make the result
                // screen render against stale input if anyone navigated back to it.
                { status: 'completed', completedAt: new Date(), updatedAt: new Date() }
              : {
                  status: 'in_progress',
                  tierCompleted: 0,
                  profile: null,
                  volume: null,
                  alloc: null,
                  answers: {},
                  completedAt: null,
                  updatedAt: new Date(),
                },
          )
          .where(eq(atlasIntakeSubmissions.userId, userId)),
      )

      if (person.profile) {
        await withRls(appPool, { userId, firebaseUid, app: 'atlas' }, schema, async (db) => {
          await db
            .insert(golfPlayerProfile)
            .values({ userId, ...person.profile! })
            .onConflictDoUpdate({
              target: golfPlayerProfile.userId,
              set: { ...person.profile!, updatedAt: new Date() },
            })
          // One handicap_history row so the coach dashboard's METRIC tier has something to show —
          // it is gated on app_private.coaches() (approved relationship) rather than
          // coaches_or_pending(), so an empty table makes "hidden" and "no data" indistinguishable
          // when testing that boundary. Append-only by design, hence the existence check rather
          // than an upsert: re-running the seed must not add a second row for the same day.
          const existing = await db.query.golfHandicapHistory.findFirst({
            where: eq(golfHandicapHistory.userId, userId),
          })
          if (!existing) {
            await db.insert(golfHandicapHistory).values({
              userId,
              handicapIndex: person.profile!.handicapIndex,
              source: 'self_reported',
            })
          }
        })
      }

      // A coach gets a coach_profile, and it is not decoration: `coach_profiles_read_my_coach` lets a
      // student read the profile of anyone coaching them or requesting to. Without a row here that
      // policy is correct but has nothing to prove, and a student approving a request would see a
      // name with nothing behind it.
      if (person.role === 'coach') {
        await withRls(appPool, { userId, firebaseUid, app: 'atlas' }, schema, (db) =>
          db
            .insert(coachProfiles)
            .values({
              userId,
              coachType: 'independent',
              bio: 'PGA-certified. Short game and course management.',
              calendlyUrl: 'https://calendly.com/example/coach-sam',
            })
            .onConflictDoNothing(),
        )
      }

      seeded.push({ person, userId, firebaseUid })
      console.log(`  ✓ ${person.email.padEnd(30)} ${person.role.padEnd(6)} ${userId}`)
    }

    // The coach_of edge, through the REAL two-step consent loop rather than one privileged write.
    // The coach may only REQUEST (policy user_relationships_request forces status='pending' and a
    // null approved_at); only the subject may approve it (user_relationships_subject_decides). A
    // coach cannot approve their own request, which is what stops a coach granting themselves read
    // access to any player whose UUID they happen to know. Seeding it any other way would leave the
    // demo running on a path the product does not have.
    const coach = seeded.find((s) => s.person.role === 'coach')
    const firstPlayer = seeded.find((s) => s.person.role === 'user')
    if (coach && firstPlayer) {
      const existing = await withRls(
        appPool,
        { userId: coach.userId, firebaseUid: coach.firebaseUid, app: 'atlas' },
        schema,
        async (db) => {
          const found = await db.query.userRelationships.findFirst({
            where: and(
              eq(userRelationships.actorUserId, coach.userId),
              eq(userRelationships.subjectUserId, firstPlayer.userId),
              eq(userRelationships.relationship, 'coach_of'),
              eq(userRelationships.app, 'atlas'),
            ),
          })
          if (found) return found
          const [row] = await db
            .insert(userRelationships)
            .values({
              actorUserId: coach.userId,
              subjectUserId: firstPlayer.userId,
              // NOT NULL. The edge is app-scoped because "coaches you in Locker Room" and
              // "coaches you in Atlas" are different grants, even for the same two people.
              app: 'atlas',
              relationship: 'coach_of',
              // status and approved_at are left at their defaults ('pending', null) — the insert
              // policy would refuse anything else.
            })
            .returning()
          return row
        },
      )

      // Now as the PLAYER — the only party the policy lets set status='active'.
      if (existing.status !== 'active') {
        await withRls(
          appPool,
          { userId: firstPlayer.userId, firebaseUid: firstPlayer.firebaseUid, app: 'atlas' },
          schema,
          (db) =>
            db
              .update(userRelationships)
              .set({ status: 'active', approvedAt: new Date() })
              .where(eq(userRelationships.id, existing.id)),
        )
      }
      console.log(
        `  ✓ coach_of: ${coach.person.displayName} -> ${firstPlayer.person.displayName} (requested, then approved by the player)`,
      )

      // A SECOND edge, left PENDING on purpose. The roster then shows both states side by side —
      // one student with their handicap trend, one whose trend the metric tier withholds — so the
      // identity/metric boundary is visible on screen instead of only in a policy test.
      const secondPlayer = seeded.filter((s) => s.person.role === 'user')[1]
      if (secondPlayer) {
        await withRls(
          appPool,
          { userId: coach.userId, firebaseUid: coach.firebaseUid, app: 'atlas' },
          schema,
          async (db) => {
            const found = await db.query.userRelationships.findFirst({
              where: and(
                eq(userRelationships.actorUserId, coach.userId),
                eq(userRelationships.subjectUserId, secondPlayer.userId),
                eq(userRelationships.relationship, 'coach_of'),
                eq(userRelationships.app, 'atlas'),
              ),
            })
            if (found) return
            await db.insert(userRelationships).values({
              actorUserId: coach.userId,
              subjectUserId: secondPlayer.userId,
              app: 'atlas',
              relationship: 'coach_of',
            })
          },
        )
        console.log(
          `  ✓ coach_of: ${coach.person.displayName} -> ${secondPlayer.person.displayName} (PENDING — left unapproved deliberately)`,
        )
      }
    }

    console.log(`\nPassword for every seeded account: ${SEED_PASSWORD}`)
  } finally {
    await appPool.end()
    await billingPool.end()
  }
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
