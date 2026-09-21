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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAtlasData, HIDDEN_FOR_PLAYER, HIDDEN_FOR_COACH } from '../server/protoData'
import { INTERVIEW_FIELDS } from '../shared/interview'
import { REVIEW_ITEMS } from '../shared/drills'

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
