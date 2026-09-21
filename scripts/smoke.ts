/**
 * The smoke suite. `npm run smoke`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * Until 2026-09-21 this repo had NO linter, NO test runner and NO test file. `tsc --noEmit` and
 * `vite build` were the only automated gates — and `tsc` cannot see inside `proto/Dashboard.dc.html`,
 * which is the 390KB file that IS the product. Three separate comments credited a "smoke suite" or a
 * `.test.ts` that did not exist, so the codebase read as having coverage it had never had.
 *
 * The Sunday 2026-09-20 review found 43 defects. TWO OF THEM WERE FEATURES THAT SHIPPED COMPLETELY
 * INERT — tier/phase written to the wrong object, and target handicap never reconciling — and both
 * were "verified" at the time against hand-built payloads that set the value the test was checking.
 * That is the failure this file is shaped around: **assert against what the real producer emits, not
 * against a fixture you wrote.** Every check below reads live `buildAtlasData` output or the real
 * prototype file.
 *
 * ── DELIBERATELY DEPENDENCY-FREE ───────────────────────────────────────────────────────────────
 * No vitest, no jsdom, no new packages. It runs the same way `seed.ts` does. A gate nobody installs
 * is a gate nobody runs, and this repo has already proved it will carry a citation to a test suite
 * for weeks without noticing the suite is missing.
 *
 * ── WHAT IT DOES NOT COVER ─────────────────────────────────────────────────────────────────────
 * No browser, so no layout, no click behaviour, no CSS. Section D is a STATIC approximation of "did
 * every binding resolve" — it proves a producer exists in the file, not that it ran. A real render
 * check still means opening a browser. Said plainly here so nobody reads a green run as more than
 * it is.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildAtlasData, HIDDEN_FOR_PLAYER, HIDDEN_FOR_COACH } from '../server/protoData'
import { INTERVIEW_FIELDS } from '../shared/interview'
import { REVIEW_ITEMS } from '../shared/drills'
import { consentStateFor, storedDateOfBirth, ageInYears, MINOR_AGE_THRESHOLD } from '../shared/consent'

// ── tiny harness ───────────────────────────────────────────────────────────────────────────────
let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`)
}

/**
 * The accounts this runs against. Firebase uids, because that is what the real route passes.
 * Casey is the seeded full-slate account and is the only one with a complete answer set, so it is
 * the one that can prove a value actually travels end to end.
 */
const CASEY = 'TESTSEED-casey-flint-fullslate'
const COACH = 'k3spybkuThUdRRrzQ4uz3YNUhRn1'

const PROTO = readFileSync(join(import.meta.dirname, '..', 'proto', 'Dashboard.dc.html'), 'utf8')

async function main() {
  console.log('Atlas smoke suite\n')

  // ── A. THE PAYLOAD CONTRACT ──────────────────────────────────────────────────────────────────
  // The prototype reads `window.__ATLAS_DATA__.me.<key>` in its state seeder. A key that is absent
  // there is the exact bug f437aa6 shipped: the value was written to `meRow` instead, the seeder
  // silently fell through to its default, and the feature did nothing for four days.
  section('A. me/meRow contract — the keys the prototype seeds from')
  const casey = (await buildAtlasData(CASEY, 'today', HIDDEN_FOR_PLAYER)) as any

  // Derived from the prototype itself rather than hardcoded, so adding a `me.x` read to the page
  // automatically extends this check instead of silently escaping it.
  // One Set over BOTH patterns, not two Sets concatenated — the latter deduped within each pattern
  // and not across them, so keys matched by both (carry, target, hand) were checked and reported
  // twice. Harmless, but a duplicated line reads as two distinct checks and inflated the count.
  const seededKeys = [
    ...new Set([
      ...[...PROTO.matchAll(/__ATLAS_DATA__\s*&&\s*window\.__ATLAS_DATA__\.me\s*\|\|\s*\{\}\)\.(\w+)/g)].map((m) => m[1]),
      ...[...PROTO.matchAll(/\bme\.(\w+)/g)].map((m) => m[1]),
    ]),
  ]
  for (const k of seededKeys) {
    if (['id', 'email', 'displayName'].includes(k)) continue
    check(`me.${k} exists in the payload`, k in casey.me, `the page reads me.${k}`)
  }

  // ── B. VALUES TRAVEL END TO END ──────────────────────────────────────────────────────────────
  // Not "the key is present" but "the golfer's actual answer arrives". Reads the interview and
  // asserts the payload matches it — the check that would have caught the inert tier/phase.
  section('B. the interview answer reaches the payload')
  // ⚠️ Read through `meRow.file`, NOT a raw `pool.query`. RLS is on and a pool query carries no
  // identity, so the direct query returned ZERO rows and this check silently proved nothing. That
  // is the same trap the payload itself exists to avoid, and it failed here first.
  // `file` is the whole interview jsonb, which is the real producer path.
  const interview = (casey.meRow.file ?? {}) as Record<string, string>
  check('the fixture account has an interview to test against', Object.keys(interview).length > 0)
  if (interview.tier) {
    check('interview.tier reaches me.tier', casey.me.tier === interview.tier, `db=${interview.tier} payload=${casey.me.tier}`)
    check('interview.tier reaches meRow.tier', casey.meRow.tier === interview.tier)
  }
  if (interview.phase) {
    check('interview.phase reaches me.zone', casey.me.zone === interview.phase, `db=${interview.phase} payload=${casey.me.zone}`)
  }

  // ── C. NO FABRICATED DEFAULTS ────────────────────────────────────────────────────────────────
  // The house rule: blank means not measured, not zero. An unanswered account must come back empty
  // rather than carrying somebody else's value.
  section('C. an unanswered account gets blanks, not defaults')
  const coach = (await buildAtlasData(COACH, 'roster', HIDDEN_FOR_COACH)) as any
  const unanswered = coach.roster.filter((r: any) => !r.tier)
  check('at least one roster row is unanswered (otherwise this proves nothing)', unanswered.length > 0)
  for (const r of unanswered) {
    check(`${r.n}: tier is '' not a default`, r.tier === '')
    check(`${r.n}: zone is '' not a default`, r.zone === '')
  }
  const answered = coach.roster.filter((r: any) => r.tier)
  check('a coach can see an answered student\'s tier', answered.length > 0, 'roster tier was shipped empty for four days')

  // ── D. EVERY BINDING HAS A PRODUCER ──────────────────────────────────────────────────────────
  // Static approximation of "nothing renders as literal {{ braces }}". Not a render — it proves a
  // producer exists in the file, not that it ran.
  section('D. every {{ binding }} in the markup has a producer')
  const scripts = [...PROTO.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const js = scripts.reduce((a, b) => (a.length > b.length ? a : b), '')
  const markup = PROTO.slice(0, PROTO.indexOf('<script'))
  const bindings = new Set(
    [...PROTO.matchAll(/\{\{\s*([A-Za-z_$][\w$]*)\s*[.}]/g)].map((m) => m[1]),
  )
  // `sc-for` aliases (`as="d"`) are loop-locals, not producers.
  const aliases = new Set([...PROTO.matchAll(/as="(\w+)"/g)].map((m) => m[1]))
  const missing: string[] = []
  // `hint-placeholder-val="{{ true }}"` puts JS literals in binding position; they are not names.
  const literals = new Set(['true', 'false', 'null', 'undefined'])
  for (const b of bindings) {
    if (aliases.has(b) || literals.has(b)) continue
    const produced =
      new RegExp(`\\b${b}\\s*:`).test(js) || new RegExp(`\\b(const|let|var|function)\\s+${b}\\b`).test(js)
    if (!produced) missing.push(b)
  }
  check('no binding lacks a producer', missing.length === 0, missing.slice(0, 8).join(', '))

  // ── E. FABRICATION SENTINELS ─────────────────────────────────────────────────────────────────
  // Literal strings that were removed because they stated something false about a real person.
  // Each one cost a review to find; this is what stops it coming back.
  section('E. removed fabrications have not returned')
  const banned: [string, string][] = [
    ['12 of 23 drills completed', 'the hardcoded workbook total (f6089e0)'],
    ["const DONE = ['1-1a'", 'the 12-ref fiction literal'],
    ['$25 AT RISK', 'the stake bar (7132b9e)'],
    ["stake: { active: true", 'the stake state literal'],
    ['Pledge recorded · 24 Jul', 'the fabricated pledge date'],
    ["TODAY = 26", 'the frozen calendar date (04a350e)'],
    ["tier: 'builder'", 'the curriculum-tier literal (f437aa6)'],
    ['Verified by Dr. Benoit', 'an invented coach over real drill_progress'],
    ['Completed · Dr. Benoit', 'ditto, on the step pill'],
    ["lifts: ['lift-a'", 'the fitness compliance seed — made every player read "2 of 5 logged"'],
    ['speeds: [94', 'eight invented clubhead-speed readings, with CURRENT/BEST computed off them'],
    ["who: 'Dr. Luke Benoit'", 'the fabricated coach message thread'],
  ]
  // ⚠️ Comments are stripped first. Every one of these strings is quoted in a comment explaining
  // why it was removed — scanning the raw file matched those and reported seven false regressions
  // on this suite's first run. The question is whether the fabrication is in LIVE CODE.
  const code = PROTO
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n')
  for (const [needle, why] of banned) {
    check(`absent: ${needle}`, !code.includes(needle), why)
  }

  // ── F. SHARED CONTRACTS AGREE ────────────────────────────────────────────────────────────────
  section('F. shared definitions line up with the prototype')
  check(
    'every review item id is referenced by the prototype or is a plan/step id',
    REVIEW_ITEMS.every((i) => i.id.startsWith('plan:') || i.id.startsWith('intake:') || PROTO.includes(i.id)),
  )
  const choiceFields = INTERVIEW_FIELDS.filter((f) => f.options)
  check('interview choice fields declare option labels', choiceFields.every((f) => f.optionLabels?.length === f.options?.length))

  // ── G. THE DRILL REASONS ─────────────────────────────────────────────────────────────────────
  // T-83 lifted the `WHY` map out of the prototype into shared/drills.ts, keyed by id instead of by
  // display name. The point was that the SERVER can now read a prescription's reason — so the
  // checks are: every plan drill still has one, they reach the injected payload, and the prototype
  // has not quietly regrown a second copy as the source of truth.
  section('G. drill reasons are in the shared module and reach the page')
  const planItems = REVIEW_ITEMS.filter((i) => i.group === 'plan')
  const noWhy = planItems.filter((i) => !i.why)
  check('every plan drill has a reason', noWhy.length === 0, noWhy.map((i) => i.id).join(', '))
  check(
    'reasons reach the injected payload',
    (casey.reviewItems ?? []).filter((i: any) => i.why).length === planItems.length,
    `${(casey.reviewItems ?? []).filter((i: any) => i.why).length} of ${planItems.length}`,
  )
  // Step 1's ids cover both routes, so their reason must name both — same convention as `detail`.
  const step1 = planItems.filter((i) => i.step === 1)
  check(
    'step 1 reasons name both the Cannon and the Anchor route',
    step1.every((i) => (i.why ?? '').includes('Cannon') && (i.why ?? '').includes('Anchor')),
    step1.filter((i) => !(i.why ?? '').includes('Anchor')).map((i) => i.id).join(', '),
  )
  // The literal map survives ONLY as a standalone fallback (Luke opens the file straight from disk).
  // If the id-keyed lookup ever disappears, the fallback silently becomes the source again.
  check('the prototype resolves reasons by id', PROTO.includes('WHY_BY_ID') && PROTO.includes('whyFor('))
  check('no consumer still keys a reason by display name', !/why:\s*WHY\[d\.name\]/.test(PROTO))

  // ── H. THE pool.query RLS TRAP ───────────────────────────────────────────────────────────────
  // A raw `pool.query` carries NO RLS identity, so it returns ZERO ROWS with no error. That is
  // invisible by construction — zero rows looks exactly like "no data" — and it has already caused
  // three separate silent failures, including one inside this very suite, where a check passed
  // while proving nothing. `withRls` is the only sanctioned read path.
  //
  // `pool.connect()` is allowed WHEN the code sets the identity itself: ensureAtlasAccess does
  // exactly that, because it runs before a user has an Atlas role and so cannot use withRls.
  section('H. no unguarded pool access on the server')
  const serverFiles = readdirSync(join(import.meta.dirname, '..', 'server'), { recursive: true, encoding: 'utf8' })
    .filter((f) => typeof f === 'string' && f.endsWith('.ts'))
  const offenders: string[] = []
  for (const rel of serverFiles) {
    const body = readFileSync(join(import.meta.dirname, '..', 'server', rel), 'utf8')
    const code = body
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    if (/\bpool\.query\s*\(/.test(code)) offenders.push(`${rel}: bare pool.query — use withRls`)
    if (/\bpool\.connect\s*\(/.test(code) && !code.includes("set_config('app.current_user_id'")) {
      offenders.push(`${rel}: pool.connect without setting app.current_user_id`)
    }
  }
  check('every server DB read carries an RLS identity', offenders.length === 0, offenders.join('; '))

  // ── I. NAME DISAMBIGUATION INCLUDES THE CALLER ───────────────────────────────────────────────
  // `dupe` used to compare roster rows only, so a student sharing a name with the SIGNED-IN COACH
  // sat one column from an identical string in the rail chip with nothing to tell them apart. That
  // produced a false entry in this repo's own task board on 2026-09-21.
  section('I. a student sharing the coach\'s name is disambiguated')
  const clash = coach.roster.filter((r: any) => r.n === coach.me.name)
  if (clash.length) {
    check('a roster row matching the caller carries an email', clash.every((r: any) => r.dupe), clash.map((r: any) => r.n).join(', '))
  } else {
    check('fixture has no coach/student name clash (this check is inert here)', true)
  }
  // And the other half: a unique name must NOT be flagged.
  const unique = coach.roster.filter((r: any) => coach.roster.filter((x: any) => x.n === r.n).length === 1 && r.n !== coach.me.name)
  check('uniquely-named students are not flagged', unique.every((r: any) => !r.dupe), unique.filter((r: any) => r.dupe).map((r: any) => r.n).join(', '))

  // ── J. THE CONSENT GATE IS REAL, NOT DECORATIVE ──────────────────────────────────────────────
  // Two failure modes, and the checks below are split along them.
  //
  //   1. THE GATE IS NOT WIRED IN. This is how f437aa6 shipped inert: the code was correct and
  //      nothing called it. So the wiring checks READ THE ROUTERS rather than trusting a comment,
  //      and they are written to catch the NEXT router someone adds, not just today's five.
  //   2. THE GATE IS WIRED BUT WRONG. Those are the pure-logic checks: a day either side of a
  //      birthday decides whether a 17-year-old is admitted unconsented, and no amount of grepping
  //      finds an off-by-one in the arithmetic.
  section('J. parental consent — wiring')

  const routeFiles = readdirSync(join(import.meta.dirname, '..', 'server', 'routes'), {
    encoding: 'utf8',
  }).filter((f) => f.endsWith('.ts'))

  // The predicate is deliberately "does this router gate on Atlas entitlement", NOT a hardcoded
  // list of filenames. Any new router that authenticates a golfer is therefore covered the day it
  // is written. admin.ts drops out on its own because it uses requireAdmin, not requireApp —
  // which is also exactly why it is the one place consent may be RECORDED.
  const ungated: string[] = []
  for (const f of routeFiles) {
    const src = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', f), 'utf8')
    if (!src.includes("requireApp('atlas')")) continue
    if (!src.includes('requireConsent')) ungated.push(f)
  }
  check(
    'every router that gates on Atlas entitlement also gates on consent',
    ungated.length === 0,
    ungated.join(', '),
  )

  // Called out separately because it is the single easiest link to miss in the codebase: a
  // different router, a navigated document rather than an API call, and it injects the golfer's
  // whole profile into the page before the browser sees it. Gate /api/* and skip this and the
  // gate protects nothing a player is redirected to automatically.
  const protoSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'proto.ts'), 'utf8')
  const dashChain = protoSrc.slice(
    protoSrc.indexOf("protoRouter.get(\n  '/proto/dashboard'"),
    protoSrc.indexOf('async (req, res, next) => {', protoSrc.indexOf("'/proto/dashboard'")),
  )
  check(
    'the served dashboard page carries requireConsent in PAGE mode',
    dashChain.includes("requireConsent('page')"),
    'a JSON 403 renders as raw text in a navigated tab',
  )

  // The deadlock check. requireConsent refuses an account with no date of birth, and the ONLY way
  // to record one is POST /users/me/date-of-birth. If that route is ever gated, the sole exit from
  // the gate sits inside it and every account — including every admin — is locked out for good.
  const meSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'me.ts'), 'utf8')
  check(
    'the date-of-birth route is NOT behind the consent gate (deadlock)',
    /meRouter\.post\('\/users\/me\/date-of-birth', \.\.\.identityChain/.test(meSrc),
    'gating this route makes the only exit from the gate unreachable',
  )
  check(
    'GET /users/me is NOT behind the consent gate (deadlock)',
    /meRouter\.get\('\/users\/me', \.\.\.identityChain/.test(meSrc),
    'the client must be able to ask what it still owes',
  )
  // …but everything that COLLECTS must be.
  check(
    'PATCH /users/me IS behind the consent gate',
    /meRouter\.patch\('\/users\/me', \.\.\.gatedChain/.test(meSrc),
    'it writes a golf profile, which is collection',
  )

  // ── the self-consent hole ────────────────────────────────────────────────────────────────────
  // public.users grants atlas_app column-level UPDATE on parental_consent_at AND users_update
  // permits writing your own row, so the DATABASE would let a 14-year-old consent for themselves.
  // RLS scopes rows, not columns — there is no policy that closes it. The only barrier is that no
  // route the account holder can reach writes that column.
  const selfConsentWriters: string[] = []
  for (const f of routeFiles) {
    if (f === 'admin.ts') continue // the one sanctioned writer, via billing_svc + withRlsBypass
    const src = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', f), 'utf8')
    // A `.set({ … parentalConsentAt … })` anywhere outside admin.ts is the hole reopening.
    if (/\.set\(\s*\{[^}]*parentalConsentAt/s.test(src)) selfConsentWriters.push(f)
  }
  check(
    'no user-facing route writes parental_consent_at',
    selfConsentWriters.length === 0,
    selfConsentWriters.join(', '),
  )
  // patchSchema is .strict(), so the KEY being absent is an active 400 rather than a silent
  // ignore. This asserts the absence, because "add it for completeness" is a one-line regression.
  const patchSchemaBlock = meSrc.slice(meSrc.indexOf('const patchSchema'), meSrc.indexOf('.strict()'))
  check(
    'parentalConsentAt is absent from PATCH /users/me’s schema',
    !patchSchemaBlock.includes('parentalConsentAt'),
    'a .strict() schema refuses the key only while the key is absent',
  )
  check(
    'the consent write goes through billing_svc, not the app pool',
    /adminRouter\.post\('\/admin\/users\/:userId\/parental-consent'/.test(
      readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'admin.ts'), 'utf8'),
    ),
    'the recording endpoint is missing',
  )

  section('J2. parental consent — the arithmetic')

  // A day either side of a birthday is the whole gate. `(now - dob) / 365.25` gets these wrong.
  const NOW = new Date(Date.UTC(2026, 8, 21, 12)) // 2026-09-21
  const dobAged = (years: number, offsetDays = 0) => {
    const d = new Date(Date.UTC(2026 - years, 8, 21, 12))
    d.setUTCDate(d.getUTCDate() + offsetDays)
    return d
  }

  check('null date of birth fails CLOSED', consentStateFor({ dateOfBirth: null, parentalConsentAt: null }, NOW) === 'dob_required')
  check(
    'an unparseable stored date of birth fails CLOSED',
    consentStateFor({ dateOfBirth: 'not-a-date', parentalConsentAt: null }, NOW) === 'dob_required',
  )
  check(
    'a consent timestamp does NOT substitute for a date of birth',
    consentStateFor({ dateOfBirth: null, parentalConsentAt: NOW }, NOW) === 'dob_required',
    'unknown age must never resolve to adult',
  )
  check(
    `a ${MINOR_AGE_THRESHOLD}-year-old ON their birthday is through`,
    consentStateFor({ dateOfBirth: dobAged(MINOR_AGE_THRESHOLD), parentalConsentAt: null }, NOW) === 'ok',
  )
  check(
    'one day BEFORE that birthday still needs a guardian',
    consentStateFor({ dateOfBirth: dobAged(MINOR_AGE_THRESHOLD, 1), parentalConsentAt: null }, NOW) === 'consent_required',
  )
  check(
    'a 14-year-old without consent is refused',
    consentStateFor({ dateOfBirth: dobAged(14), parentalConsentAt: null }, NOW) === 'consent_required',
  )
  check(
    'a 14-year-old WITH consent is allowed everything',
    consentStateFor({ dateOfBirth: dobAged(14), parentalConsentAt: new Date() }, NOW) === 'ok',
    'the policy is a gate on access, not on features',
  )
  // Leap day: born 29 Feb 2008, on 28 Feb 2026 they are 17; on 1 March they are 18.
  const leap = new Date(Date.UTC(2008, 1, 29, 12))
  check('leap-day birthday: 28 Feb is still 17', ageInYears(leap, new Date(Date.UTC(2026, 1, 28, 12))) === 17)
  check('leap-day birthday: 1 Mar is 18', ageInYears(leap, new Date(Date.UTC(2026, 2, 1, 12))) === 18)

  // Storage shape. A midnight-UTC timestamp renders as the previous day in every US time zone —
  // the defect found in the seed data on 2026-09-20 — and here a one-day slip moves someone
  // across the threshold.
  const stored = storedDateOfBirth(2010, 3, 14)
  check('a stored date of birth keeps its calendar date', !!stored && stored.getUTCFullYear() === 2010 && stored.getUTCMonth() === 2 && stored.getUTCDate() === 14)
  check('a stored date of birth is noon UTC, not midnight', !!stored && stored.getUTCHours() === 12, 'midnight shifts a day in negative-offset zones')
  check('30 February is refused, not rolled into March', storedDateOfBirth(2010, 2, 30) === null)
  check('month 13 is refused', storedDateOfBirth(2010, 13, 1) === null)

  // ── report ───────────────────────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(74)}`)
  if (failures.length) {
    console.log(`FAILED — ${failures.length} of ${passed + failures.length} checks\n`)
    for (const f of failures) console.log(`  · ${f}`)
    console.log()
    process.exit(1)
  }
  console.log(`PASSED — ${passed} checks\n`)
  process.exit(0)
}

main().catch((e) => {
  console.error('\nsmoke suite ERRORED (this is a failure, not a skip):\n', e)
  process.exit(1)
})
