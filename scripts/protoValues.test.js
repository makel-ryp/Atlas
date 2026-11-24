// Prototype value check (hq card 30, T-141). Run: node scripts/protoValues.test.js
//
// Runs the dashboard prototype's OWN inline component script in a node:vm context against test
// data, calls rosterVals(), profileVals() and intakeVals(), gathers every string they return and
// applies three rules. No database, no network, no server, no file written, no environment file.
//
//   Rule 1  no output string contains `undefined`, `NaN` or `nulld`.
//   Rule 2  every output value built from a handicap, a target handicap or a strokes-gained number
//           whose input is missing (null, undefined, absent, or an empty history) is exactly '—'.
//   Rule 3  with every number missing from the data, no output string holds a signed zero as a
//           whole token (+0, -0, +0.0, -0.0; '-' or '−'; not preceded by a digit, not followed by
//           a digit or by a point and a digit). With present numbers there is no test for +0.
//
// The text alone cannot tell a correct '+0.0' (fmtSG(0.03)) from a fabricated one (an unguarded
// hcpLabel(null)), so the rules are driven by the INPUT.
//
// Options:
//   --page <path>   run this copy of the page instead of proto/Dashboard.dc.html (mutation runs
//                   on a scratch copy; the page is executed as code, so only pass a file you trust)
//   --data <path>   run rules 1 and 2 only, against a saved copy of the injected data (JSON)
//
// Plain JavaScript, Node built-ins only. Exits 1 if any case fails.

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DASH = '—'
const MAX_DATA_CHARS = 5000000

// ─── arguments ───────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { page: path.resolve(HERE, '..', 'proto', 'Dashboard.dc.html'), data: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--page' || a === '--data') {
      const v = argv[++i]
      if (!v) throw new Error(a + ' needs a path')
      out[a.slice(2)] = path.resolve(v)
    } else {
      throw new Error('unknown argument ' + a + ' (use --page <path> or --data <path>)')
    }
  }
  return out
}

// ─── run the page's own script ───────────────────────────────────────────────────────────────
// The page's inline component script is the text between its <script type="text/x-dc"
// data-dc-script ...> tag and the </script> after it. It is run unchanged, except that one line is
// appended so the host can reach `class Component` (a top-level class declaration is not a
// property of the context): `;globalThis.__AtlasComponent = Component;`.
function extractScript(pageText) {
  const open = /<script type="text\/x-dc" data-dc-script[^>]*>/g
  const starts = []
  let m
  while ((m = open.exec(pageText))) starts.push(m.index + m[0].length)
  if (starts.length !== 1) throw new Error('expected exactly one data-dc-script block, found ' + starts.length)
  const end = pageText.indexOf('</script>', starts[0])
  if (end < 0) throw new Error('the data-dc-script block has no closing </script>')
  return pageText.slice(starts[0], end)
}

class DCLogic {
  setState() {}
}

function loadComponent(scriptSrc, data) {
  const win = { __ATLAS_DATA__: data, innerWidth: 1400 }
  const sandbox = { window: win, DCLogic, console: { log() {}, warn() {}, error() {}, info() {} } }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(scriptSrc + '\n;globalThis.__AtlasComponent = Component;\n', ctx, {
    filename: 'Dashboard.dc.html (inline script)',
    timeout: 10000,
  })
  return ctx.__AtlasComponent
}

// Everything the three functions return for one data set. `subjects` records, for each
// profileVals() call, what the page was looking at, so rule 2 can read the INPUT.
function runPage(scriptSrc, data) {
  const Component = loadComponent(scriptSrc, data)
  const inst = new Component()
  const roster = Array.isArray(data.roster) ? data.roster : []
  const result = { roster: inst.rosterVals(), profiles: [], intake: null }
  const base = inst.state
  if (roster.length === 0) {
    result.profiles.push({ label: 'profileVals(self)', kind: 'self', out: inst.profileVals() })
  } else {
    inst.state = Object.assign({}, base, { profileOf: null })
    result.profiles.push({ label: 'profileVals(no student selected)', kind: 'none', out: inst.profileVals() })
    roster.forEach((p, i) => {
      inst.state = Object.assign({}, base, { profileOf: p.id })
      result.profiles.push({ label: 'profileVals(roster[' + i + '])', kind: 'student', student: p, out: inst.profileVals() })
    })
    inst.state = base
  }
  result.intake = inst.intakeVals()
  return result
}

// ─── gathering strings ───────────────────────────────────────────────────────────────────────
function gather(value, where, acc, seen) {
  if (typeof value === 'string') { acc.push({ where, text: value }); return acc }
  if (value === null || typeof value !== 'object') return acc
  if (seen.has(value)) return acc
  seen.add(value)
  if (Array.isArray(value)) value.forEach((v, i) => gather(v, where + '[' + i + ']', acc, seen))
  else Object.keys(value).forEach(k => gather(value[k], where ? where + '.' + k : k, acc, seen))
  return acc
}

function allStrings(result) {
  const seen = new Set()
  const acc = []
  gather(result.roster, 'rosterVals()', acc, seen)
  result.profiles.forEach(p => gather(p.out, p.label, acc, seen))
  gather(result.intake, 'intakeVals()', acc, seen)
  return acc
}

// A copy that holds only data (strings, numbers, booleans, arrays, plain objects), so a negative
// case can edit one string without touching the real result.
function plain(v) {
  if (typeof v === 'function') return undefined
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(plain)
  const o = {}
  Object.keys(v).forEach(k => { const c = plain(v[k]); if (c !== undefined || v[k] === undefined) o[k] = c })
  return o
}
function plainResult(r) {
  return { roster: plain(r.roster), profiles: r.profiles.map(p => Object.assign({}, p, { out: plain(p.out) })), intake: plain(r.intake) }
}

// ─── rule 1 ──────────────────────────────────────────────────────────────────────────────────
const RULE1_WORDS = ['undefined', 'NaN', 'nulld']
function rule1(result) {
  const faults = []
  allStrings(result).forEach(s => {
    RULE1_WORDS.forEach(w => { if (s.text.indexOf(w) !== -1) faults.push({ where: s.where, token: w }) })
  })
  return faults
}

// ─── rule 3 ──────────────────────────────────────────────────────────────────────────────────
// A signed zero as a whole token: + or - or U+2212, then 0 or 0.0, not preceded by a digit, not
// followed by a digit or by a point and a digit.
const SIGNED_ZERO = /(?<![0-9])[+\-−]0(?:\.0)?(?![0-9]|\.[0-9])/g
function rule3(result) {
  const faults = []
  allStrings(result).forEach(s => {
    const hits = s.text.match(SIGNED_ZERO)
    if (hits) hits.forEach(h => faults.push({ where: s.where, token: h }))
  })
  return faults
}

// ─── rule 2 ──────────────────────────────────────────────────────────────────────────────────
// A number is missing when it is null, undefined, absent, not finite, or (the server sends `me`
// numbers as text) text that is not a finite number.
function missingNum(v) {
  if (v === null || v === undefined) return true
  if (typeof v === 'number') return !isFinite(v)
  if (typeof v === 'string') return v.trim() === '' || !isFinite(Number(v))
  return true
}
const firstOf = a => (Array.isArray(a) && a.length ? a[0] : undefined)
const lastOf = a => (Array.isArray(a) && a.length ? a[a.length - 1] : undefined)

// What the page treats as the subject's handicap and target. For a coach it is the selected
// student's row; for a player it is `me` (text from the server) when present, else `meRow`
// (Dashboard.dc.html:3291-3298 seeds the state from `me`; 4866 and 5404 fall back to who.*).
function subjectInputs(profile, data) {
  if (profile.kind === 'student') {
    const dna = profile.student.dna
    return { hcp: profile.student.hcp, target: profile.student.target, dna: dna || null }
  }
  if (profile.kind === 'none') return { hcp: null, target: null, dna: null }
  const me = data.me || {}
  const row = data.meRow || {}
  const pick = (meVal, rowVal) => (meVal === null || meVal === undefined ? rowVal : Number(meVal))
  return { hcp: pick(me.hcp, row.hcp), target: pick(me.target, row.target), dna: row.dna || null }
}

// The table: each output field, the input it is built from, and the page line that builds it
// (Dashboard.dc.html at dcd1a0d). `refs(result, data)` returns one entry per output value:
// { where, container, key, missing } so a negative case can overwrite the value in a copy.
const RULE2_TABLE = [
  { field: 'rosterVals().rosterRows[].hcp', from: 'roster[].hcp', line: 5676,
    refs: (r, d) => rosterRefs(r, d, 'hcp', p => missingNum(p.hcp)) },
  { field: 'rosterVals().rosterRows[].sg', from: 'last of roster[].sg', line: 5679,
    refs: (r, d) => rosterRefs(r, d, 'sg', p => missingNum(lastOf(p.sg))) },
  { field: 'rosterVals().rosterRows[].delta', from: 'first and last of roster[].sg', line: 5686,
    refs: (r, d) => rosterRefs(r, d, 'delta', p => missingNum(firstOf(p.sg)) || missingNum(lastOf(p.sg))) },
  { field: 'profileVals().pfHandicapReal', from: 'subject handicap (student hcp; player me.hcp, else meRow.hcp)', line: 5404,
    refs: (r, d) => profileRefs(r, d, 'pfHandicapReal', s => missingNum(s.hcp)) },
  { field: 'profileVals().pfHandicapTarget', from: 'subject target (student target; player me.target, else meRow.target)', line: 5409,
    refs: (r, d) => profileRefs(r, d, 'pfHandicapTarget', s => missingNum(s.target)) },
  { field: 'profileVals().dnaMiHcp', from: 'subject dna.mi.handicap (no dna counts as missing)', line: 5343,
    refs: (r, d) => profileRefs(r, d, 'dnaMiHcp', s => !s.dna || !s.dna.mi || missingNum(s.dna.mi.handicap)) },
  { field: 'profileVals().dnaMiGap', from: 'subject dna.mi.gap (no dna counts as missing)', line: 5344,
    refs: (r, d) => profileRefs(r, d, 'dnaMiGap', s => !s.dna || !s.dna.mi || missingNum(s.dna.mi.gap)) },
]

// rosterRows are sorted, so a row is matched to its student by name plus the server's `dupe` tag.
function rosterRefs(result, data, key, isMissing) {
  const roster = Array.isArray(data.roster) ? data.roster : []
  const rows = result.roster && result.roster.rosterRows ? result.roster.rosterRows : []
  if (rows.length !== roster.length) throw new Error('rosterRows has ' + rows.length + ' rows for ' + roster.length + ' students')
  return rows.map((row, i) => {
    const matches = roster.filter(p => p.n === row.name && (p.dupe || '') === (row.dupe || ''))
    if (matches.length !== 1) throw new Error('cannot match rosterRows[' + i + '] to one student (' + matches.length + ' matches)')
    return { where: 'rosterVals().rosterRows[' + i + '].' + key, container: row, key, missing: isMissing(matches[0]) }
  })
}
function profileRefs(result, data, key, isMissing) {
  return result.profiles.map(p => ({
    where: p.label + '.' + key, container: p.out, key, missing: isMissing(subjectInputs(p, data)),
  }))
}

function rule2Refs(result, data) {
  const refs = []
  RULE2_TABLE.forEach(t => t.refs(result, data).forEach(r => refs.push(Object.assign({ field: t.field }, r))))
  return refs
}
function rule2(result, data) {
  const faults = []
  rule2Refs(result, data).forEach(r => {
    if (r.missing && r.container[r.key] !== DASH) faults.push({ where: r.where, token: String(r.container[r.key]) })
  })
  return faults
}

// ─── test data (made-up names and ids only) ──────────────────────────────────────────────────
const row = over => Object.assign({
  id: '', n: '', tier: '', zone: '', hcp: null, target: null, days: null, leak: '', hand: '', carry: '',
  intake: '', dupe: '', sg: [], hist: {}, read: {}, note: {}, tone: {}, answer: {}, est: {}, grid: [],
  file: {}, drills: {}, notes: [], submitted: {}, messages: [], dna: null,
}, over)

const dna = (handicap, gap) => ({
  depth: 'baseline', depthLabel: 'First read', depthBasis: 'ZZTEST', archetype: 'ZZTEST', archetypeTagline: '',
  archetypeCoachLine: '', archetypeProvisional: false, archetypeProvisionalNote: '', tendency: 50,
  tendencyName: 'Blended', tendencyPole: 'Both', tendencyProvisional: false, growthZone: '',
  growthHeadline: '', growthMoves: [], zones: [], efficiency: null, efficiencyLabel: '',
  efficiencyMissing: '', pattern: '', patternHeadline: '', patternFix: '', ghostZone: '', chips: [],
  mi: { state: 'estimated', handicap, value: null, range: null, gap, verdict: '', estimable: true },
})

const coachMe = (hcp, target) => ({
  name: null, displayName: null, hcp, target, hand: null, carry: null, tier: '', zone: '', drills: {},
})
const coachData = (me, roster) => ({ view: 'roster', hidden: [], reviewItems: [], me, roster })

// Every number present. 0.03 prints '+0.0', -0.03 prints '-0.0', 0.5 prints '+0.5'.
const presentA = () => row({
  id: 'zz-test-1', n: 'ZZTEST-A', hcp: 12.4, target: 8, days: 2, tier: 'builder', zone: '2',
  sg: [-0.47, -0.2, 0.1, -0.1, 0.03], hist: { m3: 12.4, m6: 12.9, y1: 13.5, y3: 14, y5: 15, y10: null },
})
const presentB = () => row({
  id: 'zz-test-2', n: 'ZZTEST-B', hcp: -1.2, target: -2, days: 0, tier: 'competitive', zone: '3',
  sg: [0.5, 0.2, 0.1, 0, -0.03], hist: { m3: -1.2, m6: -1, y1: -0.5, y3: 0, y5: 1, y10: 3 }, dna: dna(-1.2, 0.03),
})
// Every number missing.
const missingA = () => row({ id: 'zz-test-1', n: 'ZZTEST-A' })
const missingB = () => row({ id: 'zz-test-2', n: 'ZZTEST-B', dna: dna(null, null) })

const DATA = {
  empty: () => ({ roster: [] }),
  present: () => coachData(coachMe('8.0', '5.0'), [presentA(), presentB()]),
  missing: () => coachData(coachMe(null, null), [missingA(), missingB()]),
  mixed: () => coachData(coachMe(null, null), [presentA(), missingB()]),
  playerWith: () => ({
    view: 'today', hidden: [], reviewItems: [], roster: [],
    me: coachMe('4.2', '2.5'), meRow: row({ id: 'zz-test-1', n: 'ZZTEST-A', hcp: 4.2, target: 2.5 }),
  }),
  playerWithout: () => ({
    view: 'today', hidden: [], reviewItems: [], roster: [],
    me: coachMe(null, null), meRow: row({ id: 'zz-test-1', n: 'ZZTEST-A' }),
  }),
}

// ─── case runner ─────────────────────────────────────────────────────────────────────────────
let passed = 0
let failed = 0
function runCase(name, fn) {
  try {
    fn()
    passed++
    console.log('ok   ' + name)
  } catch (e) {
    failed++
    console.log('FAIL ' + name + ' :: ' + (e && e.message ? e.message : String(e)))
  }
}
function fmt(faults) {
  return faults.slice(0, 6).map(f => f.where + ' holds ' + JSON.stringify(f.token)).join('; ') + (faults.length > 6 ? ' (+' + (faults.length - 6) + ' more)' : '')
}
function expectNone(faults, label) {
  if (faults.length) throw new Error(label + ' reported ' + faults.length + ': ' + fmt(faults))
}
function expectSome(faults, label) {
  if (!faults.length) throw new Error(label + ' reported nothing, and it must')
}
function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────
function mainData(opts) {
  // Rules 1 and 2 against a saved copy of the injected data. The file is parsed with JSON.parse
  // and handed to the page as data; its text is never joined into script source or evaluated.
  const size = fs.statSync(opts.data).size
  if (size > MAX_DATA_CHARS * 4) throw new Error('the data file is larger than ' + MAX_DATA_CHARS + ' characters; refusing it')
  const text = fs.readFileSync(opts.data, 'utf8')
  if (text.length > MAX_DATA_CHARS) throw new Error('the data file is larger than ' + MAX_DATA_CHARS + ' characters; refusing it')
  let data
  try { data = JSON.parse(text) } catch (e) { throw new Error('the data file is not valid JSON; refusing it') }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('the data file does not parse to an object; refusing it')
  const scriptSrc = extractScript(fs.readFileSync(opts.page, 'utf8'))
  const result = runPage(scriptSrc, data)
  runCase('saved data: rule 1 (no undefined, NaN or nulld)', () => expectNone(rule1(result), 'rule 1'))
  runCase('saved data: rule 2 (a missing handicap, target or strokes gained prints the dash)', () => {
    const refs = rule2Refs(result, data)
    if (!refs.length) throw new Error('rule 2 found no field to check')
    expectNone(rule2(result, data), 'rule 2')
  })
}

function mainTests(opts) {
  const scriptSrc = extractScript(fs.readFileSync(opts.page, 'utf8'))
  const runs = {}
  const datas = {}
  Object.keys(DATA).forEach(k => { datas[k] = DATA[k](); runs[k] = runPage(scriptSrc, datas[k]) })

  // Rules against each data set.
  runCase('empty roster: rule 1', () => expectNone(rule1(runs.empty), 'rule 1'))
  runCase('empty roster: rule 3', () => expectNone(rule3(runs.empty), 'rule 3'))

  runCase('present numbers: rule 1', () => expectNone(rule1(runs.present), 'rule 1'))
  runCase('present numbers: rule 2', () => {
    if (!rule2Refs(runs.present, datas.present).length) throw new Error('rule 2 found no field to check')
    expectNone(rule2(runs.present, datas.present), 'rule 2')
  })
  runCase('present numbers: +0.0, -0.0 and +0.5 are printed, and are correct output', () => {
    const rows = runs.present.roster.rosterRows
    const a = rows.filter(r => r.name === 'ZZTEST-A')[0]
    const b = rows.filter(r => r.name === 'ZZTEST-B')[0]
    expectEqual(a.sg, '+0.0', 'ZZTEST-A strokes gained 0.03')
    expectEqual(b.sg, '-0.0', 'ZZTEST-B strokes gained -0.03')
    expectEqual(a.delta, '+0.5', 'ZZTEST-A change over five reads')
    expectEqual(a.hcp, '12.4', 'ZZTEST-A handicap')
    expectEqual(b.hcp, '+1.2', 'ZZTEST-B handicap')
    const texts = allStrings(runs.present).map(s => s.text)
    ;['+0.0', '-0.0', '+0.5'].forEach(t => { if (texts.indexOf(t) === -1) throw new Error(t + ' is not among the output strings') })
  })

  runCase('missing numbers: rule 1', () => expectNone(rule1(runs.missing), 'rule 1'))
  runCase('missing numbers: rule 2', () => {
    if (!rule2Refs(runs.missing, datas.missing).length) throw new Error('rule 2 found no field to check')
    expectNone(rule2(runs.missing, datas.missing), 'rule 2')
  })
  runCase('missing numbers: rule 3', () => expectNone(rule3(runs.missing), 'rule 3'))
  runCase('missing numbers: the handicap and strokes-gained fields are the dash', () => {
    const refs = rule2Refs(runs.missing, datas.missing)
    const fields = {}
    refs.forEach(r => { fields[r.field] = (fields[r.field] || 0) + 1 })
    RULE2_TABLE.forEach(t => { if (!fields[t.field]) throw new Error('no value collected for ' + t.field) })
    refs.forEach(r => {
      if (!r.missing) throw new Error(r.where + ' is not missing in the all-missing data')
      expectEqual(r.container[r.key], DASH, r.where)
    })
  })

  runCase('mixed (one complete, one missing): rule 1', () => expectNone(rule1(runs.mixed), 'rule 1'))
  runCase('mixed (one complete, one missing): rule 2', () => {
    const refs = rule2Refs(runs.mixed, datas.mixed)
    if (!refs.some(r => r.missing) || !refs.some(r => !r.missing)) throw new Error('the mix holds both missing and present inputs, and the table did not see both')
    expectNone(rule2(runs.mixed, datas.mixed), 'rule 2')
  })

  runCase('player, target and handicap set: rule 1', () => expectNone(rule1(runs.playerWith), 'rule 1'))
  runCase('player, target and handicap set: rule 2', () => {
    const refs = rule2Refs(runs.playerWith, datas.playerWith)
    const own = refs.filter(r => r.field.indexOf('dna') === -1 && r.field.indexOf('rosterRows') === -1)
    if (own.length !== 2 || own.some(r => r.missing)) throw new Error('this player has a handicap and a target, and the table must see both as present')
    expectNone(rule2(runs.playerWith, datas.playerWith), 'rule 2')
  })
  runCase('player, target and handicap set: they are printed', () => {
    const out = runs.playerWith.profiles[0].out
    expectEqual(out.pfHandicapReal, '4.2', 'pfHandicapReal')
    expectEqual(out.pfHandicapTarget, '2.5', 'pfHandicapTarget')
  })
  runCase('player, no target and no handicap: rule 1', () => expectNone(rule1(runs.playerWithout), 'rule 1'))
  runCase('player, no target and no handicap: rule 2', () => {
    const refs = rule2Refs(runs.playerWithout, datas.playerWithout)
    if (!refs.length || refs.some(r => !r.missing)) throw new Error('every input of this player should be missing')
    expectNone(rule2(runs.playerWithout, datas.playerWithout), 'rule 2')
  })
  runCase('player, no target and no handicap: rule 3', () => expectNone(rule3(runs.playerWithout), 'rule 3'))
  runCase('player, no target and no handicap: handicap and target are the dash', () => {
    const out = runs.playerWithout.profiles[0].out
    expectEqual(out.pfHandicapReal, DASH, 'pfHandicapReal')
    expectEqual(out.pfHandicapTarget, DASH, 'pfHandicapTarget')
  })

  // Negative cases: each passes only when the rules report the fault. They edit one string in a
  // data-only copy of a real run.
  const missingCopy = () => plainResult(runs.missing)

  RULE1_WORDS.forEach(w => {
    runCase('negative: an output holding ' + w + ' is reported by rule 1', () => {
      const c = missingCopy()
      c.roster.rosterRows[0].name = 'x ' + w + ' y'
      expectSome(rule1(c), 'rule 1')
    })
  })
  ;[['+0.0', 'a signed 0.0'], ['+0', 'a signed 0']].forEach(pair => {
    runCase('negative: a table field holding ' + pair[0] + ' for a missing input is reported by rule 2 (every field in the table)', () => {
      RULE2_TABLE.forEach(t => {
        const c = missingCopy()
        const targets = t.refs(c, datas.missing)
        if (!targets.length) throw new Error('no value collected for ' + t.field)
        targets.forEach(r => {
          const c2 = missingCopy()
          const r2 = t.refs(c2, datas.missing).filter(x => x.where === r.where)[0]
          if (!r2.missing) throw new Error(r2.where + ' should have a missing input')
          r2.container[r2.key] = pair[0]
          const faults = rule2(c2, datas.missing).filter(f => f.where === r.where)
          if (!faults.length) throw new Error('rule 2 did not report ' + pair[0] + ' in ' + r.where + ' (' + pair[1] + ')')
        })
      })
    })
  })
  runCase('negative: +0.0 in a string outside the table, every number missing, is reported by rule 3', () => {
    const c = missingCopy()
    c.roster.rosterBlurb = 'Sorted +0.0'
    expectNone(rule2(c, datas.missing), 'rule 2 (the string is outside its table)')
    expectSome(rule3(c), 'rule 3')
  })
  runCase('positive: +0.0, -0.0 and +0.5 from present inputs are not reported', () => {
    const c = plainResult(runs.present)
    const texts = allStrings(c).map(s => s.text)
    ;['+0.0', '-0.0', '+0.5'].forEach(t => { if (texts.indexOf(t) === -1) throw new Error(t + ' is not in the present-numbers output') })
    expectNone(rule1(c), 'rule 1')
    expectNone(rule2(c, datas.present), 'rule 2')
  })
  runCase('rule 3 reads whole tokens: +0 -0 +0.0 -0.0 and the U+2212 minus are hits', () => {
    ;['+0', '-0', '+0.0', '-0.0', '−0', '−0.0', 'x +0.0 y', '(+0)'].forEach(t => {
      expectSome(rule3({ roster: { a: t }, profiles: [], intake: {} }), 'rule 3 on ' + JSON.stringify(t))
    })
  })
  runCase('rule 3 reads whole tokens: +0.5 2026-09-07 +00:00 +0.05 10+0 are not hits', () => {
    ;['+0.5', '2026-09-07', '+00:00', '+0.05', '10+0', '12-0.5'].forEach(t => {
      expectNone(rule3({ roster: { a: t }, profiles: [], intake: {} }), 'rule 3 on ' + JSON.stringify(t))
    })
  })
}

let opts
try {
  opts = parseArgs(process.argv.slice(2))
  if (opts.data) mainData(opts)
  else mainTests(opts)
} catch (e) {
  console.log('REFUSED: ' + (e && e.message ? e.message : String(e)))
  failed++
}
console.log(passed + ' passed, ' + failed + ' failed')
process.exitCode = failed ? 1 : 0
