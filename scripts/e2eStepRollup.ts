/**
 * END-TO-END: the coach verify route, driven as a real coach against a real student.
 *
 * ── Why this is separate from `npm run smoke` ───────────────────────────────────────────────
 * Smoke is static — it reads source and calls `buildAtlasData` in-process. It cannot catch a
 * query that is only wrong when Postgres runs it. This suite caught exactly that on its first
 * run: `drill_id = any(${siblings})` typechecked, passed every smoke check, and 500'd on every
 * single verify with "op ANY/ALL (array) requires array on right side". No amount of grepping
 * would have found it.
 *
 * It needs the server UP (`npm run dev:server`) and it authenticates through `devSession.ts`,
 * which mints a real Firebase session — so the full chain runs: verifyToken, attachUser,
 * ensureAtlasAccess, requireApp, requireConsent, then RLS.
 *
 * ⚠️ IT WRITES. It ticks and unticks step 1 for the seeded demo student and puts the state back
 * when it is done. Point it at demo accounts only; `npm run seed` restores them either way.
 *
 *   npm run dev:server      # in one shell
 *   npm run e2e             # in another
 */
import { eq, and } from 'drizzle-orm'
import { withRlsBypass } from '@ryp/eco/db'
import { users, golfDrillProgress } from '@ryp/eco/schema'
import { pool } from '../server/db'
import { fetchAs } from './devSession'
import { drillIdsInStep } from '../shared/drills'

const STUDENT = 'demo.player1@rypgolf.com'
const COACH = 'demo.coach@rypgolf.com'
let bad = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!c) bad++ }

const stepRow = async (uid: string) =>
  withRlsBypass(pool, 'test: read step row', { golfDrillProgress }, (db) =>
    db.query.golfDrillProgress.findFirst({
      where: and(eq(golfDrillProgress.userId, uid), eq(golfDrillProgress.drillId, 'plan:step-1')),
    }))

const main = async () => {
  const stu = await withRlsBypass(pool, 'test: find student', { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, STUDENT) }))
  const uid = stu!.id
  const drills = drillIdsInStep(1)
  console.log(`\nstudent ${STUDENT} (${uid})\nstep 1 drills: ${drills.join(', ')}\n${'─'.repeat(78)}`)

  // A manual step sign-off must now be refused.
  const manual = await fetchAs(COACH, `/api/coach/students/${uid}/drills/plan:step-1/verify`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: true }) })
  ok('a manual step sign-off is refused', manual.status === 409,
     `${manual.status} ${JSON.stringify(await manual.json().catch(() => null))}`)

  // Verify every drill in step 1.
  for (const d of drills) {
    const r = await fetchAs(COACH, `/api/coach/students/${uid}/drills/${encodeURIComponent(d)}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: true }) })
    if (!r.ok) { ok(`verify ${d}`, false, `${r.status} ${(await r.text()).slice(0, 120)}`); }
  }
  const afterAll = await stepRow(uid)
  ok('ALL drills verified → the step signed itself off',
     !!afterAll?.signedOffAt, `signed_off_at = ${afterAll?.signedOffAt ?? 'null'}`)
  ok('the completing coach is recorded', !!afterAll?.verifiedByUserId)

  // Now untick ONE. The step must un-sign — this is the direction that makes it a derivation.
  const un = await fetchAs(COACH, `/api/coach/students/${uid}/drills/${encodeURIComponent(drills[0])}/verify`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: false }) })
  ok(`unticking ${drills[0]} succeeds`, un.ok, String(un.status))
  const afterOne = await stepRow(uid)
  ok('one drill un-verified → the step un-signs (not a latch)',
     afterOne?.signedOffAt == null, `signed_off_at = ${afterOne?.signedOffAt ?? 'null'}`)

  // Put it back, so the demo account is left complete rather than half-ticked.
  await fetchAs(COACH, `/api/coach/students/${uid}/drills/${encodeURIComponent(drills[0])}/verify`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: true }) })
  const restored = await stepRow(uid)
  ok('restored: the step is signed again', !!restored?.signedOffAt)

  console.log(bad ? `\n${bad} FAILED\n` : '\nall step-rollup checks passed\n')
  await pool.end()
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
