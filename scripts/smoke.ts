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
import { drillIdsInStep, stepCompletionIdFor, isStepCompletionId } from '../shared/drills'

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

  // ── K. THE PROTOTYPE ITSELF IS SYNTACTICALLY SOUND ───────────────────────────────────────────
  // ⚠️ THIS IS THE GATE THE REPO HAS NEVER HAD, and the reason it matters is structural: `tsc`
  // CANNOT SEE INSIDE proto/Dashboard.dc.html. It is a 6.6k-line .html file holding ~4.2k lines of
  // JavaScript, and it is the file that IS the product — every screen a golfer or coach touches.
  // A stray bracket in it ships a blank page, and `npm run typecheck` passes happily.
  // Everything below is cheap and runs on every smoke.
  section('K. the prototype parses and its markup closes')

  const protoLines = PROTO.split('\n')
  const scriptStart = protoLines.findIndex((l) => l.includes('data-dc-script'))
  const scriptEnd = protoLines.length - 1 - [...protoLines].reverse().findIndex((l) => l.includes('</script>'))
  check('the logic block is locatable', scriptStart > 0 && scriptEnd > scriptStart, `${scriptStart}..${scriptEnd}`)
  const logic = protoLines.slice(scriptStart + 1, scriptEnd).join('\n')
  let parseErr = ''
  try {
    // Function() compiles without executing — exactly the syntax check, none of the side effects.
    new Function(logic)
  } catch (e) {
    parseErr = (e as Error).message
  }
  check('the prototype logic parses as JavaScript', parseErr === '', parseErr)

  // Markup balance. An unclosed <div> in a 2.4k-line markup half does not throw — it silently
  // reparents everything after it, which reads as "the page looks wrong" and is very hard to find
  // by eye. Comments are stripped FIRST: prose inside <!-- --> contains things like "<their>"
  // that a naive tag scan reads as markup. (Found the hard way on 2026-09-25.)
  const markupHalf = PROTO.slice(0, PROTO.indexOf('<script type="text/x-dc"')).replace(/<!--[\s\S]*?-->/g, '')
  const VOID = new Set(['br','hr','img','input','meta','link','source','path','circle','rect','line','polyline','polygon','use','stop','ellipse','area','base','col','embed','track','wbr'])
  const openStack: { tag: string; line: number }[] = []
  const tagErrs: string[] = []
  for (const m of markupHalf.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawTag, , selfClose] = m
    const tag = rawTag.toLowerCase()
    if (VOID.has(tag) || selfClose) continue
    const line = markupHalf.slice(0, m.index).split('\n').length
    if (!closing) openStack.push({ tag, line })
    else if (!openStack.length) tagErrs.push(`line ${line}: </${tag}> with nothing open`)
    else if (openStack[openStack.length - 1].tag !== tag) {
      tagErrs.push(`line ${line}: </${tag}> but <${openStack[openStack.length - 1].tag}> is open`)
    } else openStack.pop()
  }
  // html/body are legitimately left open at the split point — the logic <script> is where we cut.
  const unclosed = openStack.filter((o) => o.tag !== 'html' && o.tag !== 'body')
  check('every markup tag closes', unclosed.length === 0 && tagErrs.length === 0,
    [...unclosed.map((o) => `<${o.tag}> line ${o.line}`), ...tagErrs].slice(0, 4).join('; '))

  // ── L. THE 2026-09-25 ALPHA FIXES STAY FIXED ─────────────────────────────────────────────────
  section('L. Makel\'s alpha findings do not regress')

  // #12 — a coach opening Profile from the rail was pinned to an arbitrary student, and the note
  // composer / sign-off / plan pane all act on who.id. Worst case: prose written about the wrong
  // named person. `|| ROSTER[0]` is the whole of the bug.
  check('a coach with no student selected is NOT pinned to ROSTER[0]',
    !/ROSTER\.filter\(p => p\.id === s\.profileOf\)\[0\] \|\| ROSTER\[0\]/.test(PROTO),
    'the arbitrary-student fallback is back')
  check('the no-student-selected state says so',
    PROTO.includes("pfName: who.id ? who.n : 'No player selected'"),
    'an empty <h1> reads as a broken page, not as "pick someone"')

  // #2 — "it has me stuck in sep 18th". refreshDate() moved the header and the grid but never
  // state.sel, so the day panel kept the day the TAB WAS OPENED.
  check('the day rollover carries the selected day with it',
    /rollDay\(\)\s*\{[\s\S]*?sel: this\.state\.sel === prev \? TODAY : this\.state\.sel/.test(PROTO),
    'sel no longer follows the clock — the Sep 18 bug')
  check('both rollover triggers go through rollDay',
    (PROTO.match(/this\.rollDay\(\)/g) ?? []).length >= 2,
    'the 1s tick and visibilitychange must both use it')

  // #4 — two inert cards inviting a click and naming a door that is shut.
  check('the plan screen shows only the tier the golfer is on',
    PROTO.includes('Object.keys(TIERS).filter(k => k === s.tier)'),
    'off-tier cards are back')
  check('no card tells the golfer to change their plan in the intake',
    !PROTO.includes("'Change in your intake'"),
    'that surface cannot reopen a completed interview')

  // #8 — removed on request.
  check('course simulation is gone from the page', !PROTO.includes('>Course simulation<'))

  // Forge honesty: the last dead control still advertising a save.
  check('the Forge session button no longer claims to save',
    !PROTO.includes("'Save index'") && !PROTO.includes("'Save result'"),
    'finishDriving writes nothing — there is no route and no column')
  // ⚠️ Scanned with COMMENTS STRIPPED. The first version of this check failed on the comment that
  // documents the removal — the sentinel matched the note explaining why the literal is gone. Same
  // trap the section-E sentinels hit on 2026-09-21; a sentinel that cannot tell code from the
  // comment about the code reports its own documentation as the bug.
  // ⚠️ THREE comment styles, not two. Stripping only <!-- --> and // left JS /* */ BLOCKS in, and
  // this file's comments quote the very strings the sentinels look for — so a comment explaining
  // why a literal was removed reported that literal as still present. Third time this class of
  // self-match has bitten: a sentinel that cannot tell code from prose about code is a false alarm
  // generator.
  const protoDataSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'protoData.ts'), 'utf8')
  const practiceSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'practice.ts'), 'utf8')
  const PROTO_CODE = PROTO
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  check('no hardcoded Forge run date', !PROTO_CODE.includes('21 Jul · Q3 baseline'),
    'nothing records a Forge run')
  /**
   * ⚠️ THIS CHECK WAS INVERTED ON 2026-09-25, and the history is the point.
   *
   * This morning it asserted the ABSENCE of "Saved · visible to your coach", because that sentence
   * was false twice over: nothing persisted the log, and the roster row had no field to carry it.
   * It was the sentence that made Makel expect his sets to reach his coach.
   *
   * `golf.practice_sessions` landed the same afternoon, so both halves became true and this check
   * correctly went red. It now guards the opposite thing: the claim is allowed ONLY while the
   * producer behind it exists. Delete the table and this fails again — which is exactly the
   * coupling that was missing the first time.
   */
  check('the practice log may claim a coach can see it — because one now can',
    !PROTO_CODE.includes('On this device only')
      && protoDataSrc.includes('lastPractisedBy')
      && practiceSrc.includes("put('/practice/:day'"),
    'the claim and its producer must land and leave together')

  // ── M. AUTOMATIC STEP SIGN-OFF ───────────────────────────────────────────────────────────────
  // Makel, 2026-09-25: two facts, but the second is DERIVED — a coach verifies each drill and the
  // step signs itself off when all of them are verified. The behaviour is proven end to end by
  // `npm run e2e` (which needs a running server); these are the static halves that guard the
  // wiring, and the FIRST one is the f437aa6 check: a value written into a key the page does not
  // read is a feature that does nothing.
  section('M. the step rollup is wired end to end')

  // Asserted against a REAL built payload, and specifically on a `plan:step-N` row — the only
  // place signed_off_at is ever set. Checking the whole JSON for the substring would also pass on
  // a payload where every step row happened to be absent.
  const caseyStepRows = Object.entries((casey.me?.drills ?? {}) as Record<string, any>)
    .filter(([id]) => id.startsWith('plan:step-'))
  check('the payload carries signedOffAt on step rows',
    caseyStepRows.length > 0 && caseyStepRows.every(([, v]) => 'signedOffAt' in v),
    caseyStepRows.length === 0 ? 'fixture has no step rows — check is inert' : 'the route writes it; unread, it is f437aa6 again')
  // Derived from the prototype, not hardcoded — same rule as section A.
  check('the prototype reads signedOffAt for step completion',
    /plan:step-\)\s*===\s*0[\s\S]{0,200}signedOffAt/.test(PROTO) || PROTO.includes('drills[id].signedOffAt'),
    'the `signed` derivation must consult the derived column')
  check('a legacy manually-signed step still reads as complete',
    /signedOffAt \|\| drills\[id\]\.verifiedAt/.test(PROTO),
    'dropping the fallback would hide a real coach’s completed step')

  // The rollup rule itself, in shared/ so the server and the page cannot disagree.
  check('step 1 rolls up exactly its four plan drills', drillIdsInStep(1).length === 4, drillIdsInStep(1).join(','))
  check('a step id is never part of its own precondition',
    drillIdsInStep(1).every((id) => !isStepCompletionId(id)),
    'plan:step-1 starts with "plan:" — an id-shape rule would wrongly include it')
  check('every plan drill maps to its step', stepCompletionIdFor('plan:2-P1') === 'plan:step-2')
  check('a step id maps to no parent step', stepCompletionIdFor('plan:step-2') === null)
  for (const n of [1, 2, 3, 4, 5]) {
    check(`step ${n} has drills to roll up`, drillIdsInStep(n).length > 0)
  }

  // Two writers for one derived fact can contradict each other. Both are closed.
  check('the route refuses a manual step sign-off',
    readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'coach.ts'), 'utf8').includes("error: 'step_is_automatic'"),
    'plan:step-N is a valid review-item id, so the UI is not the gate')
  check('the coach’s step pill no longer posts',
    !/tick: ev => \{[\s\S]{0,160}completion\.toggle\(\)/.test(PROTO),
    'a control that posts and is refused is worse than one that never offered')

  // ── N. THE PLAYER CAN SAY SOMETHING ──────────────────────────────────────────────────────────
  // The first player-side write Atlas has ever had. Behaviour is proven by `npm run e2e:review`
  // against a database that has golf.drill_review_requests; these are the static halves.
  section('N. the player-side write path')

  const reviewSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'review.ts'), 'utf8')

  // The whole safety argument of this feature is that the player's router cannot reach the
  // coach's table. Asserted, because "it doesn't import it today" is exactly the kind of thing a
  // later convenience edit undoes.
  check('the player router cannot reach golf.drill_progress',
    !reviewSrc.includes('golfDrillProgress'),
    'a player must never be able to write a coach’s judgement')
  check('the subject is the caller, never the body',
    reviewSrc.includes('${me.id}') && !/user_id.*req\.body/.test(reviewSrc))
  check('a step cannot be sent for review', reviewSrc.includes("error: 'step_is_automatic'"),
    'there is no video of a step, so nothing could ever clear the request')
  check('an unknown drill id is refused', reviewSrc.includes('isReviewItemId'))
  // The silent-zero-rows trap, which has bitten this repo three times.
  check('a zero-row write is not reported as success',
    /if \(!row\)[\s\S]{0,120}403/.test(reviewSrc),
    'an RLS-filtered write matches nothing and throws nothing')

  // The payload half: submitted must have an Atlas-writable source, or the coach's whole
  // "waiting on you" machinery can only ever be fired by an app that has not shipped.
  // ⚠️ 2026-10-19, MAKEL'S CALL: ticking a FILMED plan drill DOES raise the submission, because
  // the build screen already renders it as "Awaiting review" to the player (`pending = d.cam &&
  // on && !vd`). Under the 2026-10-16 narrowing the coach's queue never heard about it — two
  // screens, two answers, and the player's was the one making a promise. The gate is `review`
  // (the plan's `cam: true`), NOT `group === 'plan'`: an unfilmed drill has nothing for a coach
  // to watch, so a request against one would sit in the queue with nothing that could clear it.
  check('submitted resolves from the player’s own review request',
    /const req = args\.reviewRequests\[item\.id\]/.test(protoDataSrc),
    'the explicit request is the claim a coach acts on')
  check('ticking a FILMED plan drill raises the submission',
    /const unfilmedPlanDrill = item\.group === 'plan' && !item\.review/.test(protoDataSrc)
      && /const t = unfilmedPlanDrill \? req : \(req \?\? args\.drills\[item\.id\]\?\.tickedAt\)/.test(protoDataSrc),
    'the player is already told "Awaiting review" when they tick one — the coach has to hear it too')
  check('ticking an UNFILMED plan drill does not',
    /item\.group === 'plan' && !item\.review/.test(protoDataSrc),
    'nothing for a coach to watch, so the queue item could never clear')
  check('both payload paths query the requests',
    (protoDataSrc.match(/golfDrillReviewRequests/g) ?? []).length >= 4,
    'the player path and the roster path each need it')

  // The control, and that it reads as live rather than as another dead button.
  check('the prototype posts a review request',
    PROTO.includes("'/api/drills/' + encodeURIComponent(drillId) + '/review-request'"))
  check('the live control is offered only on filmed drills',
    /onTick: \(d\.cam && !vd && !signedStep\)/.test(PROTO),
    'nothing to watch on an unfilmed drill')
  check('the live control looks live, unlike the disarmed ones around it',
    /tickCursor: \(d\.cam && !vd && !signedStep\) \? 'pointer'/.test(PROTO),
    'affordance follows capability — the rule this screen learned the hard way')
  check('a failed request rolls the optimistic write back',
    /catch\(err => \{[\s\S]{0,200}before === undefined \? delete sub\[drillId\]/.test(PROTO)
      || PROTO.includes('if (before === undefined) delete sub[drillId]; else sub[drillId] = before;'),
    'a request that silently failed is worse than one that visibly did')

  // ── N2. THE PLAYER'S TICK — "N of 23 drills completed" ───────────────────────────────────────
  // Makel's alpha finding #6. The build screen rendered that count, its progress bar and every
  // per-step `n / m` off `golf.drill_progress.ticked_at` — A COLUMN NOTHING IN ANY APP WROTE. So
  // every player was shown "0 of 23" as if it were a measurement. These are the static halves;
  // the database half is the falsification block in eco's sql/rls_core.sql, which must be run
  // against a database that has the policies AND the trigger.
  section('N2. the player can tick a drill, and only a drill')

  const tickSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'drillTicks.ts'), 'utf8')

  // 🔴 THE ONE THAT MATTERS. `atlas_app` is ONE role for players and coaches, so widening the
  // column grant put `verified_at` inside reach of the player's own row. Nothing in THIS repo can
  // close that — `app_private.drill_progress_column_owner()` does — so what is asserted here is
  // that the route does not even name the coach's columns, and that the reason is written down.
  check('the tick route never names a coach column',
    !/verified_at\s*=|signed_off_at\s*=|verified_by_user_id\s*=|verify_note\s*=/.test(tickSrc),
    'a player’s claim and a coach’s judgement share a row; only the trigger separates them')
  check('the trigger is cited where someone would otherwise "simplify" the route',
    tickSrc.includes('drill_progress_column_owner'),
    'if this guard is not named here, the next reader thinks the grant is the protection')
  check('the player router is still separate from review.ts',
    !reviewSrc.includes('golfDrillProgress') && tickSrc.includes('golfDrillProgress'),
    'review.ts’s header guarantees it cannot reach drill_progress — folding these together deletes that')

  // The denominator. `isReviewItemId` also admits assessments, the intake and plan:step-N, and
  // drill_id is unbounded text with no FK — so the wrong gate lets a legitimate-looking id inflate
  // the very count this feature exists to make honest.
  // ⚠️ `isReviewItemId` is NAMED in that file's comments as the gate it is NOT, so this matches a
  // CALL (`isReviewItemId(`) rather than the bare word — a substring check here would fail on the
  // explanation of why the gate is narrow, which is the one thing that must stay written down.
  check('only the 23 plan drills are tickable',
    /isPlanDrillId\(/.test(tickSrc) && !/isReviewItemId\(/.test(tickSrc),
    'a step is derived and an assessment is a scored test; neither is a rep you tick')
  check('the id gate reads the one shared list',
    /REVIEW_ITEMS\.some\(\(d\) => d\.id === id && d\.group === 'plan'\)/.test(
      readFileSync(join(import.meta.dirname, '..', 'shared', 'drills.ts'), 'utf8')),
    'client and server must not keep two copies of which ids exist')

  check('the subject is the caller, never the body', tickSrc.includes('${me.id}'))
  check('ticking is an upsert, because the coach may have made the row first',
    tickSrc.includes('on conflict (user_id, drill_id) do update set'))
  check('unticking is a null, never a DELETE',
    !/\bdelete from\b/i.test(tickSrc),
    'no role holds DELETE here — the row carries the coach’s judgement too')
  check('a verified drill cannot be unticked',
    tickSrc.includes("error: 'verified_cannot_untick'") && tickSrc.includes('verified_at is null'),
    'a row that says "Verified" and counts as not-done is a contradiction a coach cannot resolve')
  check('a zero-row write is not reported as success',
    /if \(!out\.row\)[\s\S]{0,500}403/.test(tickSrc),
    'an RLS-filtered write matches nothing and throws nothing')
  // ⚠️ THREE outcomes, not two. Zero rows from the untick means verified (409), no row at all
  // (200 — nothing to clear), or RLS (403). Collapsing the middle one into 403 makes an honest
  // no-op look like a refusal; collapsing it into the 200 hides a real RLS failure.
  check('unticking something never ticked is a 200, not a refusal',
    /if \(out\.absent\)[\s\S]{0,240}res\.json\(/.test(tickSrc),
    'there was nothing to clear, so the caller\u2019s desired state is already the state')
  check('untick never INSERTS a row',
    /: await db\.execute\(sql`\s*update golf\.drill_progress set ticked_at = null/.test(tickSrc),
    'writing tick and untick as one on-conflict statement created an all-null row out of nothing')
  check('watched is write-once, so re-opening a demo does not rewrite history',
    tickSrc.includes('coalesce(golf.drill_progress.watched_at, now())'))

  // The page half.
  check('the prototype posts the tick',
    PROTO.includes("'/api/drills/' + encodeURIComponent(id) + '/tick'"))
  check('the disarmed toggle is gone, not renamed',
    !/\btoggleDrill\s*=/.test(PROTO),
    'it also mutated `verified`, which is now a grant the same role holds')
  check('the drill row is live again',
    /onClick: frozen \|\| vd \|\| s\.tickBusy \? \(\) => \{\} : this\.tickPlanDrill\(key, !on\)/.test(PROTO),
    'affordance follows capability, in both directions')
  check('a failed tick rolls back and is shown',
    PROTO.includes('ticked: before, tickBusy:') && PROTO.includes('{{ buildErr }}'),
    'a tick that stays lit after a failed write is the lie this change exists to stop telling')
  check('the tick reconciles ATLAS_ME, not just the local list',
    /prev\.tickedAt = row \? row\.ticked_at : null/.test(PROTO),
    'a stale seed object makes the count jump back on the next re-seed')
  check('watched is seeded from the column, not from an empty literal',
    /watched: refs\(d => d && d\.watchedAt\)/.test(PROTO) && !/\n\s*watched: \[\],/.test(PROTO),
    'it sat AFTER the seeding spread and silently overwrote it')
  check('the count stays a true zero, not weekRead’s dash',
    PROTO.includes("buildRead: buildDone.length + ' of ' + buildTotal + ' drills completed'"),
    'a writer exists now, so 0 is measured — the dash would be the dishonest one')

  // ── The two counting defects, 2026-10-19. Giving ticked_at a writer did not by itself make
  // the headline honest, and both of these were live on real rows.
  check('a coach-verified drill COUNTS as completed',
    /if \(s\.ticked\.indexOf\(key\) > -1 \|\| s\.verified\.indexOf\(key\) > -1\) out\.push\(key\)/.test(PROTO),
    'Avery Lane had FOUR drills verified and none ticked, so the screen read "0 of 23" under four green checks \u2014 and the row\u2019s onClick is inert once verified, so the player could not fix it')
  check('the numerator is built FROM THE PLAN, so an orphan id cannot inflate it',
    /completedKeys\(\) \{[\s\S]{0,260}STEPS\.forEach\(st => this\.stepDrills\(st\)\.forEach/.test(PROTO),
    'drill_id is unbounded text with no FK \u2014 filtering the ROWS instead let a dropped id read "24 of 23", with no way to clear it')
  check('no count reads s.ticked directly any more',
    !/s\.ticked\.length/.test(PROTO) && !/\bticked\.indexOf\(st\.n/.test(PROTO),
    '`ticked` is the player\u2019s own claim and renders the checkbox; it is not the count')
  check('the bar, the headline and the ladder read the same two numbers',
    PROTO.includes("buildPct: (buildDone.length / buildTotal * 100) + '%'")
      && /const done = dr\.filter\(d => buildDone\.indexOf/.test(PROTO)
      && /const done = drills\.filter\(d => complete\.indexOf/.test(PROTO),
    'a bar that disagrees with the words under it is the same defect twice')

  /**
   * ⚠️ AND NOW EXECUTE IT, because every check above is a regex over source text and a regex
   * cannot tell correct code from code that merely still contains the string it matches.
   * Demonstrated: hardcoding `buildTotal` to 23, or regressing `all` to `ticked.length ===
   * drills.length`, both leave every assertion above passing. So the real `stepDrills`,
   * `completedKeys` and `planDrillCount` are lifted out of the prototype and RUN against
   * fixtures. `.dc.html` is invisible to tsc, so this is the only thing that compiles them.
   */
  const stepsSrc = PROTO.match(/const STEPS = \[[\s\S]*?\n\s*\];/)?.[0] ?? ''
  const countMethod = (name: string): string => {
    const start = PROTO.indexOf(`\n  ${name}(`)
    if (start === -1) return ''
    const open = PROTO.indexOf('{', start)
    if (open === -1) return ''
    let depth = 0
    for (let k = open; k < PROTO.length; k++) {
      if (PROTO[k] === '{') depth++
      else if (PROTO[k] === '}') { depth--; if (depth === 0) return PROTO.slice(start + 1, k + 1).trim() }
    }
    return ''
  }
  const countSrc = ['stepDrills', 'completedKeys', 'planDrillCount'].map(countMethod)
  check('the counting functions and STEPS are extractable',
    !!stepsSrc && countSrc.every(Boolean),
    'if this fails the five checks above are the only cover, and they pass on broken code')

  if (stepsSrc && countSrc.every(Boolean)) {
    const countOf = new Function(`
      ${stepsSrc}
      const api = {
        ${countSrc.map((f) => f.trim().replace(/^(\w+)\(/, '$1: function(')).join(',\n')}
      };
      return (ticked, verified, pivot) => {
        const self = Object.assign({ state: { ticked: ticked, verified: verified, pivot: pivot } }, api);
        return { done: api.completedKeys.call(self), total: api.planDrillCount.call(self) };
      };
    `)() as (t: string[], v: string[], p: string) => { done: string[]; total: number }

    const PIVOT = 'cannon'
    check('the denominator is the plan, computed — not the literal 23',
      countOf([], [], PIVOT).total === 23,
      'hardcoding 23 passes every source-text check; only running it catches that')
    check('a coach-verified drill counts even when never ticked',
      countOf([], ['1-1a', '1-1b', '1-2', '1-3'], PIVOT).done.length === 4,
      'Avery Lane: four green verified ticks above the words "0 of 23"')
    check('a drill both ticked and verified counts ONCE',
      countOf(['1-1a'], ['1-1a'], PIVOT).done.length === 1,
      'a union, not a sum')
    check('an id that is not in the plan cannot inflate the count',
      countOf(['9-ZZ', 'plan:1-1a', '', '1-1a'], [], PIVOT).done.length === 1,
      'drill_id is unbounded text with no FK; a dropped id must not read "24 of 23"')
    const flooded = countOf(
      Array.from({ length: 60 }, (_, i) => `9-JUNK${i}`).concat(['1-1a']), [], PIVOT)
    check('the count can never exceed the denominator',
      flooded.done.length <= flooded.total && flooded.done.length === 1,
      `${flooded.done.length} of ${flooded.total}`)
    check('switching the Step 1 variant does not change the count',
      countOf(['1-1a', '2-P1'], ['1-3'], 'cannon').done.length ===
        countOf(['1-1a', '2-P1'], ['1-3'], 'anchor').done.length,
      'stepDrills reads state.pivot, so the two variants must expose the same refs')
    check('both Step 1 variants expose the same drill refs',
      JSON.stringify(countOf([], [], 'cannon').done) === JSON.stringify(countOf([], [], 'anchor').done)
        && countOf([], [], 'cannon').total === countOf([], [], 'anchor').total,
      'if a ref ever diverges, ticks under the old one silently drop out of the numerator')
  }

  // The regress-to-`ticked` mutation that the string checks above do NOT catch: `all` drives
  // "Ready to complete", and it must be derived from `done` rather than recomputed from `ticked`.
  check('"Ready to complete" is derived from the same count as everything else',
    /const all = done === drills\.length && camPending === 0/.test(PROTO),
    'recomputing it from `ticked` leaves a step at 4/4 that never offers to complete')
  check('the denominator is bound from planDrillCount, not a literal',
    /buildTotal = this\.planDrillCount\(\)/.test(PROTO))
  check('a verified drill never reads "Not yet marked done"',
    /tickLabel: signedStep \? 'Locked — step completed'\s*\n\s*: vd \?/.test(PROTO),
    'three of Step 1’s four drills are unfilmed, so testing !d.cam first contradicted both the status line above it and the count on the build screen')

  // ── O. THE PRACTICE LOG, AND THE DAY-OF-MONTH REMAP ──────────────────────────────────────────
  // Behaviour is proven by `npm run e2e:practice`. These guard the REMAP, which is the part that
  // fails silently: the log used to be keyed by bare day-of-month, so 3 Oct and 3 Sep were one
  // entry. Harmless while nothing persisted; silent corruption the moment something did.
  section('O. the practice log is keyed by date, not day-of-month')

  check('the route takes a full ISO date, not a day number',
    /practiceRouter\.put\('\/practice\/:day'/.test(practiceSrc) && practiceSrc.includes('parseDay'))
  check('an impossible date is refused before Postgres sees it',
    practiceSrc.includes('getUTCDate() !== d'),
    'a regex alone accepts 2026-02-30 and turns a 400 into a 500')
  check('practice cannot be logged in the future', practiceSrc.includes("error: 'date_in_future'"),
    'a log is evidence of a week; it has to be believable')
  check('the subject is the caller, never the body', practiceSrc.includes('${me.id}'))
  check('a zero-row write is not reported as success',
    /if \(!row\)[\s\S]{0,120}403/.test(practiceSrc))

  // THE REMAP. Any surviving `log[<number>]` read is a day-of-month key and reintroduces the
  // collision — so this asserts the absence, derived from the prototype rather than assumed.
  const dayNumberReads = [...PROTO.matchAll(/\blog\[(d|sel|TODAY)\]/g)].map((m) => m[0])
  check('no log read still uses a bare day number', dayNumberReads.length === 0,
    dayNumberReads.slice(0, 4).join(', '))
  check('every log read converts through dayKey()',
    (PROTO.match(/log\[dayKey\(/g) ?? []).length >= 6,
    'the ISO conversion happens at the boundary and nowhere else')
  check('dayKey is built from _NOW at call time',
    /function dayKey\(d\) \{[\s\S]{0,200}_NOW\.getFullYear\(\)/.test(PROTO),
    'a captured key would write into last month after the midnight rollover')
  check('month totals are scoped to the displayed month',
    PROTO.includes('monthPrefix()') && PROTO.includes('const mkeys ='),
    'an unscoped total mixes other months into a month-labelled panel')
  check('the streak walks real dates across month boundaries',
    PROTO.includes('isoMinusDays(dayKey(TODAY), i)'),
    'counting down to the 1st made a streak crossing a month read as 1')

  // The payload, and the producer that had been missing since the roster was built.
  check('the practice log is seeded from the payload',
    PROTO.includes('window.__ATLAS_DATA__.me.practice'),
    'SEED = {} was the old "there is no practice table" state')
  check('practice is on me, not only meRow',
    JSON.stringify(casey.me ?? {}).includes('practice') || 'practice' in (casey.me ?? {}),
    'the state seed reads me.* — meRow-only is the f437aa6 trap')
  check('RosterRow.days finally has a producer',
    !protoDataSrc.includes('days: null, // needs a practice_days producer')
      && protoDataSrc.includes('lastPractisedBy.get(person.id)'),
    'the roster’s last-logged column, silence flag and default sort all read it')
  check('a logged rest day does not count as practice',
    /if \(r\.minutes == null \|\| r\.minutes <= 0\) continue/.test(protoDataSrc),
    'a rest day must not read as "practised today" on the coach’s roster')
  check('a failed save is surfaced, not swallowed',
    PROTO.includes('this.state.logErr ? this.state.logErr'),
    'a golfer must never be told a week was recorded when the PUT came back 403')

  // ── P. THE CLOCK WRITES, AND SPEED STAYS OUT OF THE FLOOR ────────────────────────────────────
  // The clock's arithmetic was silently wrong for months — it kept only the LAST zone and the
  // total, so 30 min Construction + 20 min Calibration logged as "50 min Calibration". This
  // section EXECUTES `summariseSession` out of the prototype rather than grepping for it: a rule
  // checked only by reading is not checked.
  section('P. the clock summarises a session correctly')

  const fnMatch = PROTO.match(/function summariseSession\(blocks, zones\) \{[\s\S]*?\n\}/)
  check('summariseSession is extractable from the prototype', !!fnMatch)
  const ZONES_FIXTURE = [
    { k: 'construction', label: 'Construction' },
    { k: 'calibration', label: 'Calibration' },
    { k: 'transfer', label: 'Transfer' },
    { k: 'performance', label: 'Performance' },
    { k: 'speed', label: 'Speed', workout: true },
  ]
  if (fnMatch) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const summarise = new Function(`${fnMatch[0]}; return summariseSession;`)() as (
      b: { zone: string; secs: number }[],
      z: typeof ZONES_FIXTURE,
    ) => { practiceMins: number; speedMins: number; dominant: string | null }

    const r1 = summarise([{ zone: 'construction', secs: 1800 }, { zone: 'calibration', secs: 1200 }], ZONES_FIXTURE)
    check('a split session files under the DOMINANT zone, not the last one',
      r1.dominant === 'Construction' && r1.practiceMins === 50,
      `${r1.practiceMins}m ${r1.dominant} — the old code said 50m Calibration`)

    const r2 = summarise([{ zone: 'construction', secs: 1800 }, { zone: 'speed', secs: 900 }], ZONES_FIXTURE)
    check('Speed minutes stay OUT of the practice floor',
      r2.practiceMins === 30 && r2.speedMins === 15,
      `practice ${r2.practiceMins}m, speed ${r2.speedMins}m — the floor must not include Speed`)

    const r3 = summarise([{ zone: 'speed', secs: 900 }], ZONES_FIXTURE)
    check('a Speed-only session logs no practice minutes',
      r3.practiceMins === 0 && r3.speedMins === 15 && r3.dominant === null)

    const r4 = summarise([{ zone: 'performance', secs: 3600 }], ZONES_FIXTURE)
    check('Performance is a clockable zone', r4.dominant === 'Performance' && r4.practiceMins === 60,
      'it was missing from the chip list entirely')

    const r5 = summarise([{ zone: 'construction', secs: 600 }, { zone: 'transfer', secs: 600 }], ZONES_FIXTURE)
    check('a tie breaks on curriculum order, not object key order',
      r5.dominant === 'Construction', String(r5.dominant))

    const r6 = summarise([{ zone: 'nonsense', secs: 600 }, { zone: 'construction', secs: 300 }], ZONES_FIXTURE)
    check('an unknown zone key is ignored, not counted',
      r6.practiceMins === 5 && r6.dominant === 'Construction', `${r6.practiceMins}m`)

    check('a zero-length session produces nothing',
      summarise([], ZONES_FIXTURE).practiceMins === 0 && summarise([{ zone: 'construction', secs: 20 }], ZONES_FIXTURE).practiceMins === 0)
  }

  // Wiring: the summary has to reach the log, and the in-progress block has to be closed off.
  check('stopClock writes the day through patch()',
    /stopClock: \(\) => \{[\s\S]{0,2200}this\.patch\(TODAY, next\)/.test(PROTO),
    'it used to write lastSession into React state and stop there')
  check('the in-progress block is closed before summarising',
    /const all = c\.blocks\.concat\(\[\{ zone: c\.zone, secs: Math\.max\(0, spent\) \}\]\)/.test(PROTO),
    'the running block is not in c.blocks until the golfer switches away')
  check('a clocked session merges with the day, never clobbers it',
    /const prev = this\.state\.log\[dayKey\(TODAY\)\] \|\| \{\}/.test(PROTO),
    'a hand-logged workout must survive a clocked practice session')
  check('Performance is in the clock chip list',
    /k: 'performance', label: 'Performance'/.test(PROTO))
  check('Speed is flagged as a workout, not a zone',
    /k: 'speed'[\s\S]{0,80}workout: true/.test(PROTO),
    'WORKS already lists it beside Lift, Mobility and Rest')
  check('the golfer is told which zone it filed under',
    PROTO.includes("s.lastSession.zone ? ' · ' + s.lastSession.zone : ''"),
    'a dominant-zone rule the golfer cannot see is a silent choice')

  // ── Q. MESSAGES, AND THE UNDER-18 RULE ───────────────────────────────────────────────────────
  // Behaviour is proven by `npm run e2e:messages` and by 9/9 falsification tests on production.
  // These guard the thing a UI change can quietly undo: that the rule is enforced in the DATABASE
  // and the page only explains it.
  section('Q. direct messages — the safeguarding rule')

  const msgSrc = readFileSync(join(import.meta.dirname, '..', 'server', 'routes', 'messages.ts'), 'utf8')

  check('the route does not gate on age itself',
    !/if\s*\([^)]*isMinor[^)]*\)\s*\{[\s\S]{0,120}(403|res\.status)/.test(msgSrc)
      || msgSrc.includes('explanation, never permission') || msgSrc.includes('never as the gate'),
    'the refusal must come from messages_insert, not from a branch a client bug can miss')
  check('a refusal is EXPLAINED to the caller',
    msgSrc.includes('dm_unavailable_minor') && msgSrc.includes('not_your_coach'),
    'a coach staring at a dead button deserves to know which rule stopped them')
  check('the sender is the caller, never the body', msgSrc.includes('${me.id}'))
  check('a zero-row write is not reported as success', /if \(!row\)[\s\S]{0,140}403/.test(msgSrc))
  check('you cannot message yourself', msgSrc.includes('cannot_message_yourself'))

  // The page half: hidden, not disabled, and never the gate.
  check('the compose box is HIDDEN when DMs are unavailable',
    /msgComposeShow: \(!dmBlocked/.test(PROTO),
    'a greyed box invites a click and then explains itself')
  check('the coach side is hidden for a minor student too',
    /pfMsgShow: \(ROSTER\.length > 0 && who\.id && !who\.dmBlocked\)/.test(PROTO))
  check('the player is told WHY, and where to read instead',
    PROTO.includes('Direct messages are turned off for players under 18'),
    'no compose box and no explanation reads as broken')
  check('the coach is pointed at Notes',
    PROTO.includes('Use Notes above') || PROTO.includes('Write a note instead.'))
  check('a message is not shown optimistically',
    !/sendMessage\(\)\s*\{[\s\S]{0,400}ATLAS_ME\.messages = \(ATLAS_ME\.messages \|\| \[\]\)\.concat[\s\S]{0,80}fetch\(/.test(PROTO),
    'a message that appears then vanishes reads as "my coach saw that"')
  check('the message draft is cleared when the subject changes',
    /NOTE_RESET = \{[\s\S]{0,400}pfMsgDraft: ''/.test(PROTO),
    'prose typed about student A must not sit in student B’s box')
  check('the thread is bucketed per student for a coach',
    protoDataSrc.includes('const msgsBy = new Map<string,'),
    'a merged inbox on a per-student screen attributes other people’s words to whoever is open')

  // ⚠️ THE THRESHOLD NOW EXISTS IN TWO LANGUAGES. A policy cannot import TypeScript, so
  // app_private.is_minor() hardcodes 18 alongside MINOR_AGE_THRESHOLD. If counsel moves it and only
  // one changes, the app and the database disagree about who is a child — silently, and in the
  // direction of permitting more.
  const ecoSql = join(import.meta.dirname, '..', '..', 'eco', 'sql', 'rls_core.sql')
  let sqlText = ''
  try {
    sqlText = readFileSync(ecoSql, 'utf8')
  } catch {
    /* eco is vendored as a tarball; the source repo may not be beside Atlas on every machine */
  }
  if (sqlText) {
    const m = sqlText.match(/interval '(\d+) years'/)
    check('the SQL minor threshold matches MINOR_AGE_THRESHOLD',
      !!m && Number(m[1]) === MINOR_AGE_THRESHOLD,
      `SQL says ${m?.[1] ?? 'nothing'}, TypeScript says ${MINOR_AGE_THRESHOLD}`)
    // Extract the FUNCTION BODY and assert against that, rather than a fixed-width window in the
    // whole file — the first version used {0,120} and failed on formatting alone while the
    // behaviour was correct (e2e proves an unknown DOB is refused). A check that breaks on
    // whitespace trains people to ignore it.
    const isMinorBody = sqlText.match(
      /create or replace function app_private\.is_minor[\s\S]*?\$\$;/,
    )?.[0] ?? ''
    check('is_minor fails closed on an unknown date of birth',
      isMinorBody.includes('date_of_birth is null') && /\),\s*true\)/.test(isMinorBody),
      'unknown age must never resolve to adult — the coalesce default is the control')
  } else {
    check('eco sql not readable from here — threshold check is inert', true,
      'run smoke from a checkout with ../../eco beside it to enable it')
  }

  // ── R. THE PRESCRIBED WEEK (T-103) ───────────────────────────────────────────────────────────
  // These EXECUTE the three pure functions out of the prototype across all 12 templates x 7 days,
  // the same way section P executes summariseSession. Every bug below was invisible to grep and
  // visible the moment the function was run: the phase-4 minutes were scraped out of English prose.
  section('R. the prescribed week says only what it can back')

  const tiersSrc = PROTO.match(/const TIERS = \{[\s\S]*?\n\};/)?.[0] ?? ''

  /**
   * Extract a method by BRACE MATCHING, not by regex.
   *
   * ⚠️ The first version used /\n  name\(...\) \{[\s\S]*?\n  \}/ and broke on the one-liner
   * `isPlaceholderRow(row) { return ...; }` — it has no `\n  }` to stop at, so the non-greedy
   * match ran straight on into the NEXT method and the harness failed to compile
   * ("Unexpected identifier 'plannedZone'"). Counting braces has no such edge case.
   */
  const methodSrc = (name: string): string => {
    const start = PROTO.indexOf(`\n  ${name}(`)
    if (start === -1) return ''
    const open = PROTO.indexOf('{', start)
    if (open === -1) return ''
    let depth = 0
    for (let k = open; k < PROTO.length; k++) {
      if (PROTO[k] === '{') depth++
      else if (PROTO[k] === '}') {
        depth--
        if (depth === 0) return PROTO.slice(start + 1, k + 1).trim()
      }
    }
    return ''
  }
  const fnSrc = ['isPlaceholderRow', 'plannedZone', 'plannedWork', 'plannedMins'].map(methodSrc)
  check('the week functions and TIERS are extractable',
    !!tiersSrc && fnSrc.every(Boolean), fnSrc.map((f, i) => (f ? '' : i)).filter(String).join(','))

  if (tiersSrc && fnSrc.every(Boolean)) {
    // A synthetic `this` — the functions only ever read this.state.tier/.phase and call each other.
    const harness = new Function(`
      ${tiersSrc}
      const api = {
        ${fnSrc.map((f) => f.trim().replace(/^(\w+)\(/, '$1: function(')).join(',\n')}
      };
      return (tier, phase) => {
        const self = Object.assign({ state: { tier, phase } }, api);
        return {
          zone: (d) => api.plannedZone.call(self, d),
          work: (d) => api.plannedWork.call(self, d),
          mins: (d) => api.plannedMins.call(self, d),
          row: (d) => (TIERS[tier].phases[phase].week[(d + 6) % 7] || [])[1] || '',
        };
      };
    `)() as (t: string, p: number) => {
      zone: (d: number) => string | null
      work: (d: number) => string | null
      mins: (d: number) => number
      row: (d: number) => string
    }

    const TIER_KEYS = ['foundation', 'builder', 'competitive']
    const DAYS = [0, 1, 2, 3, 4, 5, 6]

    // 1. PHASE 4 INVENTED PRACTICE OUT OF PROSE. Builder read 18 minutes from "3 × 15", and
    //    Competitive 4 from the words "Phase 4".
    const p4 = TIER_KEYS.flatMap((t) => DAYS.map((d) => ({ t, d, m: harness(t, 4).mins(d) })))
      .filter((x) => x.m > 0)
    check('phase 4 prescribes no minutes on any tier', p4.length === 0,
      p4.map((x) => `${x.t} day ${x.d} = ${x.m}m`).join(', '))
    const p4z = TIER_KEYS.flatMap((t) => DAYS.map((d) => harness(t, 4).zone(d))).filter(Boolean)
    check('phase 4 prescribes no zone either', p4z.length === 0, p4z.join(','))

    // 2. A LIFT ON A DAY WHOSE OWN TEXT SAYS REST.
    const restLift = TIER_KEYS.flatMap((t) =>
      [1, 2, 3].flatMap((ph) =>
        DAYS.filter((d) => /rest/i.test(harness(t, ph).row(d)) && harness(t, ph).work(d) === 'Lift')
          .map((d) => `${t} p${ph} day ${d}`)))
    check('no Lift is prescribed on a Rest day', restLift.length === 0, restLift.join(', '))

    // 3. MINUTES WITH NO ZONE — a ghost bar promising work the week cannot name. The DATA still
    //    contains these (they are Luke's labels); the fix is that the cell no longer draws a bar.
    //    Counted here so the number is visible rather than silently tolerated.
    const zoneless = TIER_KEYS.flatMap((t) =>
      [1, 2, 3].flatMap((ph) =>
        DAYS.filter((d) => harness(t, ph).mins(d) > 0 && !harness(t, ph).zone(d))
          .map((d) => `${t} p${ph} d${d}`)))
    // ⚠️ NOT `[^)]*` — the argument is `(OFFSET + d - 1) % 7`, which CONTAINS a ')', so a
    // negated-paren class stops early and the check fails against correct code. Bounded
    // wildcard instead.
    check('the ghost bar requires BOTH minutes and a zone',
      /ghostShow: \(this\.plannedMins\([\s\S]{0,40}?\) && this\.plannedZone\(/.test(PROTO),
      'otherwise it promises work the page cannot name')
    check(`${zoneless.length} zone-less cells exist and are Luke's to label, not ours`, true,
      zoneless.slice(0, 6).join(', '))

    // 4. Every phase-1..3 day now resolves coherently: minutes imply a zone OR the bar is hidden.
    for (const t of TIER_KEYS) {
      const weekMins = [1, 2, 3].map((ph) => DAYS.reduce((a, d) => a + harness(t, ph).mins(d), 0))
      check(`${t} phases 1-3 all prescribe real weekly minutes`, weekMins.every((m) => m > 0),
        weekMins.join('/'))
    }
  }

  // 5. FITNESS ROWS FOLLOW THE TIER. Foundation's own record says speed: 0 and the Plan screen
  //    already renders no speed chips for it — the Fitness card showed three anyway.
  check('the fitness speed rows are derived from TIERS[tier].speed',
    PROTO.includes('Math.min(tier.speed || 0, SPEED_DAYS.length)'),
    'Foundation (speed: 0) was shown three Speed sessions to tick')

  // 6. THE FOUR FABRICATED COMPLIANCE FIGURES — the last of the class.
  check('no hardcoded practice/play/speed compliance literal',
    !PROTO_CODE.includes('{ practice: 3.5, play: 4, speed: 2 }'),
    'every golfer was told they had logged 3.5 of 5.0 hrs')
  check('no hardcoded fitness count', !PROTO_CODE.includes("'1 of 2 this week'"))
  check('compliance is computed from the golfer’s own trailing week',
    PROTO.includes('const wk = last7.map(k => s.log[k]).filter(Boolean)'),
    'the same window weekDone and the practice strip already use')
  check('rounds played stay UNMEASURED rather than derived from the plan',
    /play: null,\s*\/\/ no producer/.test(PROTO) && PROTO.includes("not recorded yet"),
    'counting prescribed rounds would report the plan back as the record')
  check('an empty week reads as a dash, not 0.0',
    PROTO.includes('const hrsRead = anyLogged ?') && PROTO.includes('DASH'),
    '"nobody counted" is not "you did none"')

  // ── S. THE TODAY CARD DOES NOT INVENT A LEAK ─────────────────────────────────────────────────
  // Found 2026-09-30 by a full-project survey, AFTER T-103 was reported as "the last of the
  // fabrication class". It was not. The Tomorrow card on Today — the most-seen screen in the
  // product — printed a strokes-gained leak and a session built from it, for every golfer, off the
  // same hardcoded `state.forge` seed that got Transfer and Performance hidden.
  section('S. Today invents nothing')

  check('the Tomorrow card is gated', /tomorrowShow: 'none'/.test(PROTO),
    'autoVals computes from state.forge, which no code path overwrites')
  check('the card is gated in the markup too',
    PROTO.includes('display: {{ tomorrowShow }}'),
    'a vals flag nothing binds is not a gate')
  check('and an honest line replaces it',
    PROTO.includes('{{ tomorrowEmptyText }}') && /tomorrowEmptyShow: 'block'/.test(PROTO))
  check('the card is NOT deleted — it returns when a producer exists',
    PROTO.includes('autoLeakSG: fmtSG(worst.sg)'),
    'Luke’s design is kept; only the claim is withheld')

  // Every reader of the hardcoded seed must be either hidden or gated. This is the check that
  // would have caught it the first time.
  const forgeReaders = [...PROTO.matchAll(/\n\s*(\w+)\(\)\s*\{[\s\S]{0,400}?s\.forge/g)].map((m) => m[1])
  check('every state.forge reader is behind a gate or a hidden screen',
    forgeReaders.every((fn) => ['forgeVals', 'autoVals', 'buildTrend', 'buildCoachCard'].includes(fn)),
    `unexpected reader(s): ${forgeReaders.filter((f) => !['forgeVals','autoVals','buildTrend','buildCoachCard'].includes(f)).join(', ')}`)

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
