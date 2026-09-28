/**
 * END-TO-END: the coach⇄golfer thread, and the UNDER-18 RULE, through the real routes.
 *
 * The safeguarding cases are the point of this suite. Makel, 2026-09-28: "DMs are disabled for
 * anyone under 18." That is enforced by an RLS policy, and this proves the policy is reachable
 * from the application rather than merely present in a file.
 *
 * ⚠️ IT TEMPORARILY CHANGES A SEEDED STUDENT'S DATE OF BIRTH to test the minor branch, and puts it
 * back. Run it against a BRANCH, never production.
 *
 *   npm run dev:server      # in one shell
 *   npm run e2e:messages    # in another
 */
import { and, eq, or } from 'drizzle-orm'
import { withRlsBypass } from '@ryp/eco/db'
import { users, atlasMessages } from '@ryp/eco/schema'
import { pool } from '../server/db'
// billing_svc, because atlas_app's UPDATE grant on parental_consent_at was REVOKED on 2026-09-25 —
// a player must not be able to consent for themselves. withRlsBypass defeats policies, not
// privileges, so the app pool genuinely cannot write this column even under bypass.
import { billingPool } from '../server/billingDb'
import { fetchAs } from './devSession'

const COACH = 'demo.coach@rypgolf.com'
const STUDENT = 'demo.player1@rypgolf.com'   // approved coach_of edge
const NOLINK = 'demo.player2@rypgolf.com'    // edge exists but is PENDING — deliberately unapproved
let bad = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!c) bad++ }

const find = (email: string) =>
  withRlsBypass(pool, 'e2e: find', { users }, (db) => db.query.users.findFirst({ where: eq(users.email, email) }))
const setDob = (id: string, dob: Date | null) =>
  withRlsBypass(pool, 'e2e: set dob', { users }, (db) =>
    db.update(users).set({ dateOfBirth: dob }).where(eq(users.id, id)))
const setConsent = (id: string, at: Date | null) =>
  withRlsBypass(billingPool, 'e2e: set parental consent', { users }, (db) =>
    db.update(users).set({ parentalConsentAt: at }).where(eq(users.id, id)))
const send = (from: string, toId: string, body: string) =>
  fetchAs(from, `/api/messages/${toId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
/**
 * Read the error code ONCE.
 *
 * ⚠️ A fetch body is a stream and can only be consumed once. The first version called this twice
 * on the same Response — for the assertion and again for the detail string — and the second call
 * silently returned null, so a PASSING behaviour was reported as a failure ("403" instead of
 * "dm_unavailable_minor"). The test was wrong, not the route. Capture, then assert.
 */
const errOf = async (r: Response) => ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? String(r.status)

const main = async () => {
  const coach = (await find(COACH))!, stu = (await find(STUDENT))!, other = (await find(NOLINK))!
  const origDob = stu.dateOfBirth
  const origConsent = stu.parentalConsentAt
  console.log(`\ncoach ${COACH}\nstudent ${STUDENT}\n${'─'.repeat(78)}`)

  /**
   * ⚠️ NO DELETE, ANYWHERE IN THIS SUITE — and that is the schema working, not a limitation.
   *
   * The first version opened with `db.delete(atlasMessages)` and got 42501. atlas.messages has no
   * DELETE policy and no DELETE grant for any role, deliberately: "a message is a record of what
   * was said", and `deleted_at` is not in the UPDATE grant either, so there is no soft-delete
   * writer. `withRlsBypass` defeats POLICIES, not PRIVILEGES.
   *
   * So every assertion below is a DELTA against what was already there, which is the honest shape
   * for an append-only table anyway. Test rows are left behind; this suite is branch-only (it
   * mutates a date of birth) so that costs nothing.
   */
  const threadCount = async () =>
    (await withRlsBypass(pool, 'e2e: count thread', { atlasMessages }, (db) =>
      db.select().from(atlasMessages).where(
        or(
          and(eq(atlasMessages.senderUserId, coach.id), eq(atlasMessages.recipientUserId, stu.id)),
          and(eq(atlasMessages.senderUserId, stu.id), eq(atlasMessages.recipientUserId, coach.id)),
        ),
      ))).length
  const before = await threadCount()

  // ── BOTH ADULTS ────────────────────────────────────────────────────────────────────────────
  const r1 = await send(COACH, stu.id, 'Nice work on the pivot today.')
  ok('an ADULT coach can message an ADULT student', r1.ok, await errOf(r1))

  const r2 = await send(STUDENT, coach.id, 'Thanks — the trail heel cue helped.')
  ok('the student can reply', r2.ok, await errOf(r2))

  ok('exactly two messages were added', (await threadCount()) === before + 2, `before ${before}`)
  const thread = await fetchAs(STUDENT, `/api/messages/${coach.id}`)
  const msgs = ((await thread.json()) as { messages: { senderUserId: string }[] }).messages
  ok('the thread shows BOTH sides',
     msgs.some((m) => m.senderUserId === coach.id) && msgs.some((m) => m.senderUserId === stu.id),
     `${msgs.length} messages`)

  // ── NO COACHING LINK ───────────────────────────────────────────────────────────────────────
  const r3 = await send(COACH, other.id, 'hello')
  const er3 = await errOf(r3)
  ok('no live coaching edge is refused', r3.status === 403, er3)

  const r4 = await send(COACH, coach.id, 'note to self')
  const er4 = await errOf(r4)
  ok('you cannot message yourself', r4.status === 400, er4)

  /**
   * ⚠️ try/finally, AND THE REASON IS A BUG THIS SUITE ACTUALLY CAUSED.
   *
   * These checks borrow a real student's date of birth to exercise the minor branch. An earlier
   * version restored it on the happy path only — then an assertion threw partway through, the
   * restore never ran, and the seeded student was left permanently 15 years old on the branch.
   * Every later run then failed at step 1 with `dm_unavailable_minor`, which looked like a broken
   * route and was actually the test's own litter.
   *
   * A test that mutates shared state must give it back unconditionally, or its first failure
   * poisons every run after it.
   */
  try {
    // ── THE SAFEGUARDING RULE ──────────────────────────────────────────────────────────────────
    /**
   * ⚠️ A CONSENTED MINOR — and getting this wrong is what the first run of this suite revealed.
   *
   * Making the student a minor and stopping there does not test the DM rule at all: `requireConsent`
   * refuses their SESSION with 403 consent_required before any route runs, so the suite died at
   * POST /api/session and never reached atlas.messages.
   *
   * The scenario that matters is the one Makel actually described — "the minor is allowed to do
   * everything, just needs parental consent" — with DMs as the single carve-out on top. So the
   * student gets consent as well, becomes a fully usable account, and the DM must STILL be refused.
   * That proves the two rules are independent layers rather than one rule wearing two hats.
   */
  await setDob(stu.id, new Date(Date.UTC(new Date().getUTCFullYear() - 15, 0, 1, 12)))
  await setConsent(stu.id, new Date())
    const r5 = await send(COACH, stu.id, 'this must not be deliverable')
    const e5 = await errOf(r5)
    ok('an ADULT coach CANNOT message a MINOR', r5.status === 403, e5)
    ok('  …and is told WHY, so the coach is not staring at a dead button',
       e5 === 'dm_unavailable_minor', e5)

    // A CONSENTED minor: full access to the app, and still no private channel.
  const r6 = await send(STUDENT, coach.id, 'the same room, other door')
    const e6 = await errOf(r6)
    ok('a MINOR CANNOT message their coach', r6.status === 403, e6)
    ok('  …by the same rule, not a different one', e6 === 'dm_unavailable_minor', e6)

    // ── UNKNOWN AGE FAILS CLOSED ───────────────────────────────────────────────────────────────
    await setDob(stu.id, null)
    const r7 = await send(COACH, stu.id, 'unknown age')
    const er7 = await errOf(r7)
    ok('a student with NO date of birth is treated as a minor', r7.status === 403, er7)


  } finally {
    await setDob(stu.id, origDob)
    await setConsent(stu.id, origConsent)
  }
  const restored = await find(STUDENT)
  ok('the student\u2019s date of birth is restored',
     String(restored?.dateOfBirth) === String(origDob), String(restored?.dateOfBirth))

  // ── READ RECEIPTS ──────────────────────────────────────────────────────────────────────────
  const rr = await fetchAs(STUDENT, `/api/messages/${coach.id}/read`, { method: 'POST' })
  const marked = ((await rr.json()) as { marked: number }).marked
  ok('the RECIPIENT can mark messages read', rr.ok && marked >= 1, `marked ${marked}`)

  const rr2 = await fetchAs(STUDENT, `/api/messages/${coach.id}/read`, { method: 'POST' })
  ok('marking read twice marks nothing the second time',
     ((await rr2.json()) as { marked: number }).marked === 0)

  // ── A THIRD PARTY SEES NOTHING ─────────────────────────────────────────────────────────────
  const spy = await fetchAs(NOLINK, `/api/messages/${coach.id}`)
  ok('a third party sees an empty thread',
     ((await spy.json()) as { messages: unknown[] }).messages.length === 0)

  console.log(bad ? `\n${bad} FAILED\n` : '\nall message checks passed\n')
  await pool.end()
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
