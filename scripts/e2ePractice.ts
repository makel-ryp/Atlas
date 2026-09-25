/**
 * END-TO-END: the practice log, driven as a real player against the real route.
 *
 * Ends on the check that matters — the COACH's roster row shows how many days ago this student
 * last practised. `RosterRow.days` had been a hardcoded null with the comment "needs a
 * practice_days producer" since the roster was built; the roster's "last logged" column, its
 * silence flag (`days > 7`) and its default sort have all been inert that whole time.
 *
 *   npm run dev:server      # in one shell
 *   npm run e2e:practice    # in another
 */
import { eq, and } from 'drizzle-orm'
import { withRlsBypass } from '@ryp/eco/db'
import { users, golfPracticeSessions } from '@ryp/eco/schema'
import { pool } from '../server/db'
import { fetchAs } from './devSession'
import { buildAtlasData, HIDDEN_FOR_COACH, HIDDEN_FOR_PLAYER } from '../server/protoData'

const STUDENT = 'demo.player1@rypgolf.com'
const COACH = 'demo.coach@rypgolf.com'
let bad = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!c) bad++ }

const iso = (offsetDays = 0) => {
  const n = new Date()
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - offsetDays))
  return d.toISOString().slice(0, 10)
}
const put = (email: string, day: string, body: unknown) =>
  fetchAs(email, `/api/practice/${day}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
/**
 * Clear every day this student has, the way the APP clears one: minutes/zone/workout to null,
 * row kept.
 *
 * WARNING — NOT a DELETE, and the first version of this suite failed on exactly that:
 * "permission denied for table practice_sessions", 42501, from inside `withRlsBypass`. That is
 * the schema working. There is no DELETE grant for any Atlas role, deliberately, and
 * **rls_bypass defeats POLICIES, not PRIVILEGES**. A test that needs a permission the app does
 * not have is testing something the app cannot do.
 */
const clearAll = (uid: string) =>
  withRlsBypass(pool, 'e2e: clear', { golfPracticeSessions }, (db) =>
    db.update(golfPracticeSessions)
      .set({ minutes: null, zone: null, workout: null })
      .where(eq(golfPracticeSessions.userId, uid)))

const row = (uid: string, day: string) =>
  withRlsBypass(pool, 'e2e: read session', { golfPracticeSessions }, (db) =>
    db.query.golfPracticeSessions.findFirst({
      where: and(eq(golfPracticeSessions.userId, uid), eq(golfPracticeSessions.sessionDate, day)),
    }))

const main = async () => {
  const stu = await withRlsBypass(pool, 'e2e: student', { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, STUDENT) }))
  const coach = await withRlsBypass(pool, 'e2e: coach', { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, COACH) }))
  const uid = stu!.id
  const today = iso(0)
  console.log(`\nstudent ${STUDENT}\ntoday   ${today}\n${'─'.repeat(78)}`)

  // Start clean so the assertions mean something.
  await clearAll(uid)

  // 1. Log today.
  const r1 = await put(STUDENT, today, { minutes: 45, zone: 'Construction', workout: null })
  ok('a player can log practice', r1.ok, `${r1.status} ${(await r1.clone().text()).slice(0, 100)}`)
  const w = await row(uid, today)
  ok('it is written to the database', w?.minutes === 45 && w?.zone === 'Construction', `${w?.minutes}m ${w?.zone}`)

  // 2. IT SURVIVES A RELOAD — the literal complaint.
  const p1 = (await buildAtlasData(stu!.firebaseUid, 'today', HIDDEN_FOR_PLAYER)) as any
  ok('it comes back in the player payload, keyed by ISO date', p1.me?.practice?.[today]?.m === 45,
     JSON.stringify(p1.me?.practice ?? {}))

  // 3. THE POINT: the coach sees when they last practised.
  const c1 = (await buildAtlasData(coach!.firebaseUid, 'roster', HIDDEN_FOR_COACH)) as any
  const seen = c1.roster.find((p: any) => p.id === uid)
  ok('the COACH sees days-since-last-practice', seen?.days === 0, `days = ${seen?.days}`)

  // 4. Idempotent — logging again updates the day rather than appending.
  await put(STUDENT, today, { minutes: 60, zone: 'Calibration', workout: 'Lift' })
  const sameDay = await withRlsBypass(pool, 'e2e: count', { golfPracticeSessions }, (db) =>
    db.select().from(golfPracticeSessions)
      .where(and(eq(golfPracticeSessions.userId, uid), eq(golfPracticeSessions.sessionDate, today))))
  ok('re-logging updates the day, never appends',
     sameDay.length === 1 && sameDay[0].minutes === 60, `${sameDay.length} row(s) for ${today}`)

  // 5. A rest day is not practice — it must not read as "practised today" on the roster.
  await clearAll(uid)
  await put(STUDENT, today, { minutes: null, zone: null, workout: 'Rest' })
  const c2 = (await buildAtlasData(coach!.firebaseUid, 'roster', HIDDEN_FOR_COACH)) as any
  ok('a rest day does not count as practice', c2.roster.find((p: any) => p.id === uid)?.days === null,
     `days = ${c2.roster.find((p: any) => p.id === uid)?.days}`)

  // 6. Days-ago arithmetic, on a real past date.
  await put(STUDENT, iso(3), { minutes: 30, zone: 'Transfer', workout: null })
  const c3 = (await buildAtlasData(coach!.firebaseUid, 'roster', HIDDEN_FOR_COACH)) as any
  ok('three days ago reads as 3', c3.roster.find((p: any) => p.id === uid)?.days === 3,
     `days = ${c3.roster.find((p: any) => p.id === uid)?.days}`)

  // 7. You cannot log practice you have not done yet.
  const rFuture = await put(STUDENT, iso(-1), { minutes: 60 })
  ok('a future day is refused', rFuture.status === 400, String(rFuture.status))

  // 8. A nonsense date is refused before it reaches Postgres.
  const rBad = await put(STUDENT, '2026-02-30', { minutes: 30 })
  ok('30 February is refused', rBad.status === 400, String(rBad.status))

  // 9. Clearing a day keeps the row — which is why no DELETE grant exists.
  await put(STUDENT, iso(3), { minutes: null, zone: null, workout: null })
  const cleared = await row(uid, iso(3))
  ok('clearing a day keeps the row', cleared != null && cleared.minutes == null,
     cleared ? 'row kept' : 'ROW DELETED')

  await clearAll(uid)
  console.log(bad ? `\n${bad} FAILED\n` : '\nall practice-log checks passed\n')
  await pool.end()
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
