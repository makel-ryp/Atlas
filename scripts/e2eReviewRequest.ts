/**
 * END-TO-END: the player's review request, driven as a real player against the real route.
 *
 * Proves the whole chain Makel's alpha finding was blocked on — a player says "look at this" and
 * it lands where the coach reads it. Needs the server UP and pointed at a database that has
 * `golf.drill_review_requests` (see migrations/0007 in eco).
 *
 *   npm run dev:server      # in one shell
 *   npm run e2e:review      # in another
 */
import { eq, and } from 'drizzle-orm'
import { withRlsBypass } from '@ryp/eco/db'
import { users, golfDrillReviewRequests } from '@ryp/eco/schema'
import { pool } from '../server/db'
import { fetchAs } from './devSession'
import { buildAtlasData, HIDDEN_FOR_COACH } from '../server/protoData'

const STUDENT = 'demo.player1@rypgolf.com'
const COACH = 'demo.coach@rypgolf.com'
/**
 * A filmed drill (`review: true`) that NO coach has signed off.
 *
 * ⚠️ Not `plan:1-3`, which this suite used first and which failed the "waiting on you" check with
 * waiting = 0 — correctly. `e2eStepRollup` verifies every drill in step 1, so by the time this
 * ran the coach had already answered plan:1-3 and it was rightly not waiting on anybody. The
 * assertion was sound; the fixture was stale. Step 4 is untouched by the other suite.
 */
const DRILL = 'plan:4-B3'
let bad = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!c) bad++ }

const post = (email: string, drill: string, body: unknown) =>
  fetchAs(email, `/api/drills/${encodeURIComponent(drill)}/review-request`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const row = (uid: string) =>
  withRlsBypass(pool, 'e2e: read request', { golfDrillReviewRequests }, (db) =>
    db.query.golfDrillReviewRequests.findFirst({
      where: and(eq(golfDrillReviewRequests.userId, uid), eq(golfDrillReviewRequests.drillId, DRILL)),
    }))

const main = async () => {
  const stu = await withRlsBypass(pool, 'e2e: find student', { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, STUDENT) }))
  const uid = stu!.id
  const coach = await withRlsBypass(pool, 'e2e: find coach', { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, COACH) }))
  console.log(`\nstudent ${STUDENT}\ndrill   ${DRILL}\n${'─'.repeat(78)}`)

  // 1. The player asks for a look.
  const r1 = await post(STUDENT, DRILL, { requested: true, note: 'third rep is the one to watch' })
  ok('a player can request a review', r1.ok, `${r1.status} ${(await r1.clone().text()).slice(0, 120)}`)
  const after = await row(uid)
  ok('it is written to the database', !!after?.requestedAt, `requested_at = ${after?.requestedAt ?? 'null'}`)
  ok('the player’s note is stored', after?.note === 'third rep is the one to watch', String(after?.note))

  // 2. THE WHOLE POINT: the coach sees it in their queue.
  const cd = (await buildAtlasData(coach!.firebaseUid, 'roster', HIDDEN_FOR_COACH)) as any
  const student = cd.roster.find((p: any) => p.id === uid)
  ok('the COACH’s payload shows it as submitted', !!student?.submitted?.[DRILL],
     `submitted[${DRILL}] = ${student?.submitted?.[DRILL] ?? 'absent'}`)
  // `waiting` is NOT a payload field — rosterVals derives it in the client, by exactly this rule
  // (submitted, minus anything already verified). Applying the same rule here rather than
  // asserting a key that was never going to exist. Caught by this suite on its first run.
  const waiting = Object.keys(student?.submitted ?? {})
    .filter((id) => !((student?.drills ?? {})[id] ?? {}).verifiedAt).length
  ok('and it counts toward "waiting on you" by the client rule', waiting > 0, `waiting = ${waiting}`)

  // 3. A step cannot be submitted — there is no video of a step.
  const rStep = await post(STUDENT, 'plan:step-1', { requested: true })
  ok('a step cannot be sent for review', rStep.status === 409, String(rStep.status))

  // 4. An unknown drill id cannot create a row.
  const rBad = await post(STUDENT, 'not-a-drill', { requested: true })
  ok('an unknown drill id is refused', rBad.status === 400, String(rBad.status))

  // 5. The coach cannot forge a request on the student's behalf — the policy, through the route.
  // The route ALWAYS writes the caller's own id, so a coach POSTing here does not fail — it
  // creates the COACH's own request (coaches are golfers too, and that is legitimate). What must
  // hold is that the student's row is untouched. Withdrawn after, so no stray row is left behind.
  const rCoach = await post(COACH, DRILL, { requested: true })
  const coachRow = await row(uid)
  ok('a coach POST cannot touch the student row',
     coachRow?.requestedAt?.toISOString() === after?.requestedAt?.toISOString(),
     `coach POST ${rCoach.status}; student row must be unchanged`)
  await post(COACH, DRILL, { requested: false })

  // 6. Withdrawing.
  const r2 = await post(STUDENT, DRILL, { requested: false })
  ok('a player can withdraw the request', r2.ok, String(r2.status))
  const withdrawn = await row(uid)
  ok('requested_at is cleared, the row survives', withdrawn != null && withdrawn.requestedAt == null,
     `row ${withdrawn ? 'kept' : 'DELETED'}, requested_at = ${withdrawn?.requestedAt ?? 'null'}`)
  const cd2 = (await buildAtlasData(coach!.firebaseUid, 'roster', HIDDEN_FOR_COACH)) as any
  ok('and it leaves the coach’s queue',
     !cd2.roster.find((p: any) => p.id === uid)?.submitted?.[DRILL])

  console.log(bad ? `\n${bad} FAILED\n` : '\nall review-request checks passed\n')
  await pool.end()
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
