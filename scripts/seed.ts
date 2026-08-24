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
import { users, userAppRoles, userRelationships, golfPlayerProfile } from '@ryp/eco/schema'

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'RypDemo!2026'

interface SeedPerson {
  email: string
  displayName: string
  role: 'user' | 'coach'
  profile?: {
    handicapIndex: string
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
    displayName: 'Avery Lane',
    role: 'user',
    profile: { handicapIndex: '4.2', driverCarryYds: 268, handedness: 'right', ghinNumber: '8801234' },
  },
  {
    email: 'demo.player2@rypgolf.com',
    displayName: 'Jordan Reyes',
    role: 'user',
    profile: { handicapIndex: '17.8', driverCarryYds: 212, handedness: 'left', ghinNumber: '8809876' },
  },
  {
    email: 'demo.coach@rypgolf.com',
    displayName: 'Coach Sam Ellis',
    role: 'coach',
  },
]

const schema = { users, userAppRoles, userRelationships, golfPlayerProfile }

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

      if (person.profile) {
        await withRls(appPool, { userId, firebaseUid, app: 'atlas' }, schema, (db) =>
          db
            .insert(golfPlayerProfile)
            .values({ userId, ...person.profile! })
            .onConflictDoUpdate({
              target: golfPlayerProfile.userId,
              set: { ...person.profile!, updatedAt: new Date() },
            }),
        )
      }

      seeded.push({ person, userId, firebaseUid })
      console.log(`  ✓ ${person.email.padEnd(30)} ${person.role.padEnd(6)} ${userId}`)
    }

    // The coach_of edge, written AS THE COACH — user_relationships' WITH CHECK only permits
    // actor_user_id = the caller, so this is the real path a coach would take, not a bypass.
    const coach = seeded.find((s) => s.person.role === 'coach')
    const firstPlayer = seeded.find((s) => s.person.role === 'user')
    if (coach && firstPlayer) {
      await withRls(
        appPool,
        { userId: coach.userId, firebaseUid: coach.firebaseUid, app: 'atlas' },
        schema,
        async (db) => {
          const existing = await db.query.userRelationships.findFirst({
            where: and(
              eq(userRelationships.actorUserId, coach.userId),
              eq(userRelationships.subjectUserId, firstPlayer.userId),
              eq(userRelationships.relationship, 'coach_of'),
              eq(userRelationships.app, 'atlas'),
            ),
          })
          if (existing) return
          await db.insert(userRelationships).values({
            actorUserId: coach.userId,
            subjectUserId: firstPlayer.userId,
            // NOT NULL. The edge is scoped to an app because "coaches you in Locker Room" and
            // "coaches you in Atlas" are different grants, even for the same two people.
            app: 'atlas',
            relationship: 'coach_of',
            // 'active' so golf_profile_coach_read actually resolves for the demo. ⚠️ That this is
            // settable by the actor is a real gap — the schema's 'pending' default and approved_at
            // column say the subject is meant to approve, but no policy enforces it. See
            // SPRINT-1-PREP.md.
            status: 'active',
            approvedAt: new Date(),
          })
        },
      )
      console.log(`  ✓ coach_of: ${coach.person.displayName} -> ${firstPlayer.person.displayName}`)
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
