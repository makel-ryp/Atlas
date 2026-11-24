// Prototype value check (hq card 30, T-141). Run: node scripts/protoValues.test.js
//
// Runs the dashboard prototype's OWN inline component script in a node:vm context against test
// data, calls rosterVals(), profileVals() and intakeVals(), gathers every string they return and
// applies three rules. No database, no network, no server, no file written, no environment file.
//
//   Rule 1  no output string contains `undefined`, `NaN` or `nulld`. Text a person typed is not
//           tested: a string in the injected data that holds one of the three words and at least four
//           other characters is taken out of an output string, wherever it occurs in it, before the
//           test. A data string that is just the word, or the word with up to three other characters
//           (a name, a one-word note), is never taken out: it is tested like any other output, fails
//           the check, and the reader settles that by eye.
//   Rule 2  every output value built from a handicap, a target handicap, a strokes-gained number or a
//           handicap-history value whose input is missing is exactly that field's own empty text
//           (see RULE2_TABLE: the dash, `NA`, `No handicap on record.`, or the form's blank).
//   Rule 3  with every number missing from the data, no output string holds a signed zero as a
//           whole token (+0, -0, +0.0, -0.0; '-' or '−'; not preceded by a digit, not followed by
//           a digit or by a point and a digit). With present numbers there is no test for +0.
//           Rule 3 does not run under --data.
//
// The text alone cannot tell a correct '+0.0' (fmtSG(0.03)) from a fabricated one (an unguarded
// hcpLabel(null)), so the rules are driven by the INPUT.
//
// Not covered (README "What this check does not cover"): the history note when part of the history
// is missing (T-142); a change printed from a single strokes-gained read (T-143); numbers that are
// not a handicap, target, strokes-gained or history value; anything outside the three functions;
// output built from what a person typed into the page since it loaded (the script never sets that
// state); a fault that prints a rule 1 word only where the data holds a text with that word and at
// least four other characters.
//
// Options:
//   --page <path>   run this copy of the page instead of proto/Dashboard.dc.html (mutation runs
//                   on a scratch copy; the page is executed as code, so only pass a file you trust)
//   --data <path>   run rules 1 and 2 only, against a saved copy of the injected data (JSON)
// Each option may be given once.
//
// node:vm is not a security boundary. The page is run as trusted repo code (pass --page only a file you
// trust); the only untrusted input is the --data text, which is why it is parsed with JSON.parse and
// never evaluated or joined into source.
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
  const out = { page: path.resolve(HERE, '..', 'proto', 'Dashboard.dc.html'), pageArg: null, data: null, dataArg: null }
  const seen = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--page' || a === '--data') {
      if (seen[a]) throw new Error(a + ' was given more than once; give it once')
      seen[a] = true
      const v = argv[++i]
      if (!v) throw new Error(a + ' needs a path')
      out[a.slice(2)] = path.resolve(v)
      out[a.slice(2) + 'Arg'] = v
    } else {
      throw new Error('unknown argument ' + a + ' (use --page <path> or --data <path>)')
    }
  }
  return out
}

// A page file that cannot be read is refused with the argument as given: no resolved path, no
// system text.
function readPage(opts) {
  try {
    return fs.readFileSync(opts.page, 'utf8')
  } catch (e) {
    throw new Error('the page file ' + (opts.pageArg || 'proto/Dashboard.dc.html') + ' cannot be read; refusing it')
  }
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

// setState does nothing but remember its argument, so a roster row's `open` handler can tell the
// host which student it opens (`profileOf`).
class DCLogic {
  setState(s) { this.lastSetState = s }
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

// Everything the three functions return for one data set. Each profileVals() call records what
// the page was looking at, so rule 2 can read the INPUT. `rowIds[i]` is the id of the student that
// rosterRows[i] opens (read from the row's own `open` handler), so rows are matched to students by
// id and not by name.
function runPage(scriptSrc, data) {
  const Component = loadComponent(scriptSrc, data)
  const inst = new Component()
  const roster = Array.isArray(data.roster) ? data.roster : []
  const result = { roster: inst.rosterVals(), rowIds: [], profiles: [], intake: null }
  const rows = result.roster && Array.isArray(result.roster.rosterRows) ? result.roster.rosterRows : []
  rows.forEach(r => {
    inst.lastSetState = null
    r.open()
    result.rowIds.push(inst.lastSetState ? inst.lastSetState.profileOf : undefined)
  })
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
  return {
    roster: plain(r.roster), rowIds: r.rowIds ? r.rowIds.slice() : [],
    profiles: r.profiles.map(p => Object.assign({}, p, { out: plain(p.out) })), intake: plain(r.intake),
  }
}

// ─── rule 1 ──────────────────────────────────────────────────────────────────────────────────
const RULE1_WORDS = ['undefined', 'NaN', 'nulld']
// Every string in the injected data that holds a rule 1 word and at least TYPED_FLOOR other characters
// (a coach's note, a message, an interview answer): text a person typed. A shorter one (a name that
// is just the word) is not taken out. Longest first, so a long text goes before a part of it.
const TYPED_FLOOR = 4
function typedTexts(data) {
  const found = new Set()
  const walk = (v, seen) => {
    if (typeof v === 'string') { if (RULE1_WORDS.some(w => v.indexOf(w) !== -1 && v.length - w.length >= TYPED_FLOOR)) found.add(v); return }
    if (v === null || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    Object.keys(v).forEach(k => walk(v[k], seen))
  }
  walk(data, new Set())
  return Array.from(found).sort((a, b) => b.length - a.length)
}
function rule1(result, data) {
  const typed = data ? typedTexts(data) : []
  const faults = []
  allStrings(result).forEach(s => {
    let text = s.text
    typed.forEach(t => { text = text.split(t).join('') })
    RULE1_WORDS.forEach(w => { if (text.indexOf(w) !== -1) faults.push({ where: s.where, token: w }) })
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
// numbers as text) text that is blank or not a finite number.
function missingNum(v) {
  if (v === null || v === undefined) return true
  if (typeof v === 'number') return !isFinite(v)
  if (typeof v === 'string') return v.trim() === '' || !isFinite(Number(v))
  return true
}
const firstOf = a => (Array.isArray(a) && a.length ? a[0] : undefined)
const lastOf = a => (Array.isArray(a) && a.length ? a[a.length - 1] : undefined)
const HIST_KEYS = ['m3', 'm6', 'y1', 'y3', 'y5', 'y10']

// What the page treats as the subject's handicap and target. For a coach it is the selected
// student's row; for a player it is `me` (text from the server) when present, else `meRow`
// (Dashboard.dc.html:3291-3298 seeds the state from `me`; 4866 and 5404 fall back to who.*).
// A blank or non-numeric `me` text counts as missing here, whatever the page does with it.
function subjectInputs(profile, data) {
  if (profile.kind === 'student') {
    const dna = profile.student.dna
    return { hcp: profile.student.hcp, target: profile.student.target, dna: dna || null }
  }
  if (profile.kind === 'none') return { hcp: null, target: null, dna: null }
  const me = data.me || {}
  const row = data.meRow || {}
  const pick = (meVal, rowVal) => (missingNum(meVal) ? rowVal : Number(meVal))
  return { hcp: pick(me.hcp, row.hcp), target: pick(me.target, row.target), dna: row.dna || null }
}
// The handicap history of the subject: the student's, or the player's own `meRow`.
function subjectHist(profile, data) {
  if (profile.kind === 'student') return profile.student.hist || {}
  if (profile.kind === 'none') return {}
  return (data.meRow && data.meRow.hist) || {}
}

// The table: each output field, the input it is built from, the page line that builds it
// (Dashboard.dc.html at dcd1a0d) and the field's own empty text. `refs(result, data)` returns one
// entry per output value: { where, container, key, missing } so a negative case can overwrite the
// value in a copy.
const RULE2_TABLE = [
  { field: 'rosterVals().rosterRows[].hcp', from: 'roster[].hcp', line: 5676, empty: DASH,
    refs: (r, d) => rosterRefs(r, d, 'hcp', p => missingNum(p.hcp)) },
  { field: 'rosterVals().rosterRows[].sg', from: 'last of roster[].sg', line: 5679, empty: DASH,
    refs: (r, d) => rosterRefs(r, d, 'sg', p => missingNum(lastOf(p.sg))) },
  { field: 'rosterVals().rosterRows[].delta', from: 'first and last of roster[].sg', line: 5686, empty: DASH,
    refs: (r, d) => rosterRefs(r, d, 'delta', p => missingNum(firstOf(p.sg)) || missingNum(lastOf(p.sg))) },
  { field: 'profileVals().pfHandicapReal', from: 'subject handicap (student hcp; player me.hcp, else meRow.hcp)', line: 5404, empty: DASH,
    refs: (r, d) => profileRefs(r, d, 'pfHandicapReal', s => missingNum(s.hcp)) },
  { field: 'profileVals().pfHandicapTarget', from: 'subject target (student target; player me.target, else meRow.target)', line: 5409, empty: DASH,
    refs: (r, d) => profileRefs(r, d, 'pfHandicapTarget', s => missingNum(s.target)) },
  { field: 'profileVals().dnaMiHcp', from: 'subject dna.mi.handicap (no dna counts as missing)', line: 5343, empty: DASH,
    refs: (r, d) => profileRefs(r, d, 'dnaMiHcp', s => !s.dna || !s.dna.mi || missingNum(s.dna.mi.handicap)) },
  { field: 'profileVals().dnaMiGap', from: 'subject dna.mi.gap (no dna counts as missing)', line: 5344, empty: DASH,
    refs: (r, d) => profileRefs(r, d, 'dnaMiGap', s => !s.dna || !s.dna.mi || missingNum(s.dna.mi.gap)) },
  { field: 'profileVals().pfHist[].value', from: 'one lookback of the subject handicap history', line: 5436, empty: 'NA',
    refs: (r, d) => histRefs(r) },
  { field: 'profileVals().pfHistNote', from: 'the whole subject handicap history (checked only when every lookback is missing)', line: 5451, empty: 'No handicap on record.',
    refs: (r, d) => r.profiles.map(p => ({
      where: p.label + '.pfHistNote', container: p.out, key: 'pfHistNote',
      missing: HIST_KEYS.every(k => missingNum(subjectHist(p, d)[k])),
    })) },
  { field: 'intakeVals().inHist[].value', from: 'one lookback of the player\'s own history (state.hist, which this script never sets)', line: 5560, empty: '',
    refs: (r, d) => (r.intake && Array.isArray(r.intake.inHist) ? r.intake.inHist : []).map((c, i) => ({
      where: 'intakeVals().inHist[' + i + '].value', container: c, key: 'value', missing: true,
    })) },
]

// rosterRows are sorted; each row is matched to its student by the id its own `open` handler carries.
function rosterRefs(result, data, key, isMissing) {
  const roster = Array.isArray(data.roster) ? data.roster : []
  const rows = result.roster && result.roster.rosterRows ? result.roster.rosterRows : []
  if (rows.length !== roster.length) throw new Error('rosterRows has ' + rows.length + ' rows for ' + roster.length + ' students')
  // Each row's own `open` handler must open one student, and together they must open every student once.
  const opened = result.rowIds.slice().map(String).sort().join('|')
  const wanted = roster.map(p => String(p.id)).sort().join('|')
  if (result.rowIds.length !== roster.length || opened !== wanted) throw new Error('the roster rows do not open their own students (the ids their open handlers set are not the roster ids, each once)')
  return rows.map((row, i) => {
    const matches = roster.filter(p => p.id === result.rowIds[i])
    if (matches.length !== 1) throw new Error('cannot match rosterRows[' + i + '] to one student (' + matches.length + ' matches)')
    return { where: 'rosterVals().rosterRows[' + i + '].' + key, container: row, key, missing: isMissing(matches[0]) }
  })
}
function profileRefs(result, data, key, isMissing) {
  return result.profiles.map(p => ({
    where: p.label + '.' + key, container: p.out, key, missing: isMissing(subjectInputs(p, data)),
  }))
}
function histRefs(result, data) {
  const refs = []
  result.profiles.forEach(p => {
    const list = p.out.pfHist
    if (!Array.isArray(list) || list.length !== HIST_KEYS.length) throw new Error(p.label + '.pfHist is not a list of ' + HIST_KEYS.length)
    list.forEach((c, i) => refs.push({ where: p.label + '.pfHist[' + i + '].value', container: c, key: 'value', histKey: HIST_KEYS[i], profile: p }))
  })
  return refs
}

function rule2Refs(result, data) {
  const refs = []
  RULE2_TABLE.forEach(t => {
    t.refs(result, data).forEach(r => {
      // The history rows need the data to know which lookback is missing.
      if (r.histKey) r = Object.assign({}, r, { missing: missingNum(subjectHist(r.profile, data)[r.histKey]) })
      refs.push(Object.assign({ field: t.field, empty: t.empty }, r))
    })
  })
  return refs
}
function rule2(result, data) {
  const faults = []
  rule2Refs(result, data).forEach(r => {
    if (r.missing && r.container[r.key] !== r.empty) faults.push({ where: r.where, token: String(r.container[r.key]), kind: 'value' })
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
  name: null, displayName: null, hcp, target, hand: null, carry: null, tier: '', zone: '', drills: {}, notes: [],
})
// The server sends a coach a `meRow` as well (server/protoData.ts); its numbers follow `me`.
const coachData = (me, roster) => ({
  view: 'roster', hidden: [], reviewItems: [], me, roster,
  meRow: row({ id: 'zz-test-0', n: '', hcp: me.hcp === null ? null : Number(me.hcp), target: me.target === null ? null : Number(me.target) }),
})
const playerData = (hcp, target) => ({
  view: 'today', hidden: [], reviewItems: [], roster: [],
  me: coachMe(hcp, target),
  meRow: row({ id: 'zz-test-1', n: 'ZZTEST-A', hcp: hcp === null ? null : Number(hcp), target: target === null ? null : Number(target) }),
})

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

// Text a person typed, which holds rule 1 words (a coach's note and a message).
const NOTE_TEXT = 'ZZ low point is still undefined after six reads.'
const MESSAGE_TEXT = 'ZZ the range finder said NaN yards.'

const DATA = {
  empty: () => ({ roster: [] }),
  present: () => coachData(coachMe('8.0', '5.0'), [presentA(), presentB()]),
  missing: () => coachData(coachMe(null, null), [missingA(), missingB()]),
  mixed: () => coachData(coachMe(null, null), [presentA(), missingB()]),
  playerWith: () => playerData('4.2', '2.5'),
  playerWithout: () => playerData(null, null),
  // One number present and the other missing, coach and player.
  coachHcpOnly: () => coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', hcp: 9.1 })]),
  coachTargetOnly: () => coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', target: 6 })]),
  playerHcpOnly: () => playerData('9.1', null),
  playerTargetOnly: () => playerData(null, '6.0'),
  // Two students nobody can tell apart by name (no email, so `dupe` is empty); one has a handicap.
  twins: () => coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', hcp: 4.2 }), row({ id: 'zz-test-2', n: 'ZZTEST-A' })]),
  // A coach's note and a message that hold rule 1 words.
  prose: () => coachData(coachMe(null, null), [row({
    id: 'zz-test-1', n: 'ZZTEST-A',
    notes: [{ id: 'zz-note-1', body: NOTE_TEXT, visibility: 'shared', author: null, mine: false, createdAt: null }],
    messages: [{ mine: false, at: null, body: MESSAGE_TEXT }],
  })]),
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
// Under --data the value of a rule 2 fault is the file's own text, so it is printed only when it is
// short and made only of digits, + - U+2212 . space and the dash; otherwise only its length.
function safeValue(s) {
  return s.length <= 12 && /^[0-9+\-\u2212. \u2014]*$/.test(s) ? JSON.stringify(s) : 'text of length ' + s.length
}
function fmt(faults, safe) {
  const show = f => (safe && f.kind === 'value' ? safeValue(f.token) : JSON.stringify(f.token))
  return faults.slice(0, 6).map(f => f.where + ' holds ' + show(f)).join('; ') + (faults.length > 6 ? ' (+' + (faults.length - 6) + ' more)' : '')
}
function expectNone(faults, label, safe) {
  if (faults.length) throw new Error(label + ' reported ' + faults.length + ': ' + fmt(faults, safe))
}
function expectSome(faults, label) {
  if (!faults.length) throw new Error(label + ' reported nothing, and it must')
}
function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}
function failsWith(fn) {
  try { fn() } catch (e) { return e && e.message ? e.message : String(e) }
  return null
}

// ─── the saved-data mode ─────────────────────────────────────────────────────────────────────
// Rules 1 and 2 against one data object. `hook(result)` lets a built-in case edit the page's output
// before the rules read it (to plant a fault without a mutated page). Returns the checks; the caller
// runs them. Rule 3 is not run here.
function savedChecks(data, scriptSrc, hook) {
  const result = runPage(scriptSrc, data)
  if (hook) hook(result)
  return [
    {
      name: 'saved data: rule 1 (no undefined, NaN or nulld; rule 3 is not run on saved data)',
      run: () => expectNone(rule1(result, data), 'rule 1'),
    },
    {
      name: 'saved data: rule 2 (a missing number prints its own empty text; rule 3 is not run on saved data)',
      run: () => {
        if (!rule2Refs(result, data).length) throw new Error('rule 2 found no field to check')
        expectNone(rule2(result, data), 'rule 2', true)
      },
    },
  ]
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────
function mainData(opts) {
  // The file is parsed with JSON.parse and handed to the page as data; its text is never joined
  // into script source or evaluated.
  let size
  let text
  const unreadable = () => new Error('the data file ' + opts.dataArg + ' cannot be read; refusing it')
  try { size = fs.statSync(opts.data).size } catch (e) { throw unreadable() }
  if (size > MAX_DATA_CHARS * 4) throw new Error('the data file is larger than ' + MAX_DATA_CHARS + ' characters; refusing it')
  try { text = fs.readFileSync(opts.data, 'utf8') } catch (e) { throw unreadable() }
  if (text.length > MAX_DATA_CHARS) throw new Error('the data file is larger than ' + MAX_DATA_CHARS + ' characters; refusing it')
  let data
  try { data = JSON.parse(text) } catch (e) { throw new Error('the data file is not valid JSON; refusing it') }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('the data file does not parse to an object; refusing it')
  const scriptSrc = extractScript(readPage(opts))
  savedChecks(data, scriptSrc).forEach(c => runCase(c.name, c.run))
}

function mainTests(opts) {
  const scriptSrc = extractScript(readPage(opts))
  const runs = {}
  const datas = {}
  Object.keys(DATA).forEach(k => { datas[k] = DATA[k](); runs[k] = runPage(scriptSrc, datas[k]) })
  const r1 = k => rule1(runs[k], datas[k])
  const r2 = k => rule2(runs[k], datas[k])
  const refsOf = k => rule2Refs(runs[k], datas[k])

  // Rules against each data set.
  runCase('empty roster: rule 1', () => expectNone(r1('empty'), 'rule 1'))
  runCase('empty roster: rule 3', () => expectNone(rule3(runs.empty), 'rule 3'))

  runCase('present numbers: rule 1', () => expectNone(r1('present'), 'rule 1'))
  runCase('present numbers: rule 2', () => {
    if (!refsOf('present').length) throw new Error('rule 2 found no field to check')
    expectNone(r2('present'), 'rule 2')
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

  runCase('missing numbers: rule 1', () => expectNone(r1('missing'), 'rule 1'))
  runCase('missing numbers: rule 2', () => {
    if (!refsOf('missing').length) throw new Error('rule 2 found no field to check')
    expectNone(r2('missing'), 'rule 2')
  })
  runCase('missing numbers: rule 3', () => expectNone(rule3(runs.missing), 'rule 3'))
  runCase('missing numbers: every table field prints its own empty text', () => {
    const refs = refsOf('missing')
    const fields = {}
    refs.forEach(r => { fields[r.field] = (fields[r.field] || 0) + 1 })
    RULE2_TABLE.forEach(t => { if (!fields[t.field]) throw new Error('no value collected for ' + t.field) })
    refs.forEach(r => {
      if (!r.missing) throw new Error(r.where + ' is not missing in the all-missing data')
      expectEqual(r.container[r.key], r.empty, r.where)
    })
  })

  runCase('mixed (one complete, one missing): rule 1', () => expectNone(r1('mixed'), 'rule 1'))
  runCase('mixed (one complete, one missing): rule 2', () => {
    const refs = refsOf('mixed')
    if (!refs.some(r => r.missing) || !refs.some(r => !r.missing)) throw new Error('the mix holds both missing and present inputs, and the table did not see both')
    expectNone(r2('mixed'), 'rule 2')
  })

  runCase('player, target and handicap set: rule 1', () => expectNone(r1('playerWith'), 'rule 1'))
  runCase('player, target and handicap set: rule 2', () => {
    const own = refsOf('playerWith').filter(r => /pfHandicap(Real|Target)$/.test(r.field))
    if (own.length !== 2 || own.some(r => r.missing)) throw new Error('this player has a handicap and a target, and the table must see both as present')
    expectNone(r2('playerWith'), 'rule 2')
  })
  runCase('player, target and handicap set: they are printed', () => {
    const out = runs.playerWith.profiles[0].out
    expectEqual(out.pfHandicapReal, '4.2', 'pfHandicapReal')
    expectEqual(out.pfHandicapTarget, '2.5', 'pfHandicapTarget')
  })
  runCase('player, no target and no handicap: rule 1', () => expectNone(r1('playerWithout'), 'rule 1'))
  runCase('player, no target and no handicap: rule 2', () => {
    const refs = refsOf('playerWithout')
    if (!refs.length || refs.some(r => !r.missing)) throw new Error('every input of this player should be missing')
    expectNone(r2('playerWithout'), 'rule 2')
  })
  runCase('player, no target and no handicap: rule 3', () => expectNone(rule3(runs.playerWithout), 'rule 3'))
  runCase('player, no target and no handicap: handicap and target are the dash', () => {
    const out = runs.playerWithout.profiles[0].out
    expectEqual(out.pfHandicapReal, DASH, 'pfHandicapReal')
    expectEqual(out.pfHandicapTarget, DASH, 'pfHandicapTarget')
  })

  // One number present and the other missing: rules 1 and 2, and the present number is printed
  // while the missing one prints the dash.
  const partial = (set, label, expectOut) => {
    runCase(label + ': rule 1', () => expectNone(r1(set), 'rule 1'))
    runCase(label + ': rule 2', () => {
      const refs = refsOf(set).filter(r => /pfHandicap(Real|Target)$|rosterRows\[\]\.hcp$/.test(r.field))
      if (!refs.some(r => r.missing) || !refs.some(r => !r.missing)) throw new Error('this set must hold one number present and one missing, and the table must see both')
      expectNone(r2(set), 'rule 2')
    })
    runCase(label + ': the present number is printed and the missing one is the dash', () => expectOut(runs[set]))
  }
  partial('coachHcpOnly', 'coach, handicap and no target', r => {
    expectEqual(r.roster.rosterRows[0].hcp, '9.1', 'roster handicap')
    expectEqual(r.profiles[1].out.pfHandicapReal, '9.1', 'student handicap')
    expectEqual(r.profiles[1].out.pfHandicapTarget, DASH, 'student target')
  })
  partial('coachTargetOnly', 'coach, target and no handicap', r => {
    expectEqual(r.roster.rosterRows[0].hcp, DASH, 'roster handicap')
    expectEqual(r.profiles[1].out.pfHandicapReal, DASH, 'student handicap')
    expectEqual(r.profiles[1].out.pfHandicapTarget, '6', 'student target')
  })
  partial('playerHcpOnly', 'player, handicap and no target', r => {
    expectEqual(r.profiles[0].out.pfHandicapReal, '9.1', 'handicap')
    expectEqual(r.profiles[0].out.pfHandicapTarget, DASH, 'target')
  })
  partial('playerTargetOnly', 'player, target and no handicap', r => {
    expectEqual(r.profiles[0].out.pfHandicapReal, DASH, 'handicap')
    expectEqual(r.profiles[0].out.pfHandicapTarget, '6', 'target')
  })

  // Two students who cannot be told apart by name: rows are matched by the id the row's own `open`
  // handler carries, so each student's own input is read.
  runCase('twins (same name, no email): rule 1 and rule 2 pass on a correct page', () => {
    expectNone(r1('twins'), 'rule 1')
    expectNone(r2('twins'), 'rule 2')
    const ids = runs.twins.rowIds.slice().sort()
    expectEqual(ids.join(','), 'zz-test-1,zz-test-2', 'the ids the two rows open')
  })
  runCase('the ids the rows open must be the roster ids, each once (else rule 2 refuses with a plain line)', () => {
    const c = plainResult(runs.twins)
    c.rowIds = ['zz-test-1', 'zz-test-1']
    const e = failsWith(() => rule2Refs(c, datas.twins))
    if (!e || e.indexOf('do not open their own students') === -1) throw new Error('every row opening one student was not refused: ' + e)
    c.rowIds = ['zz-test-1']
    if (!failsWith(() => rule2Refs(c, datas.twins))) throw new Error('a missing id was not refused')
    c.rowIds = ['zz-test-2', 'zz-test-1']
    if (failsWith(() => rule2Refs(c, datas.twins))) throw new Error('the right ids in the other order were refused')
    // a missing handicap printed as a number must not go unseen when every row opens one student
    const d = plainResult(runs.missing)
    d.rowIds = ['zz-test-1', 'zz-test-1']
    d.roster.rosterRows[1].hcp = '5.0'
    const e2 = failsWith(() => expectNone(rule2(d, datas.missing), 'rule 2'))
    if (!e2) throw new Error('rows that all open one student, with a number printed for a missing handicap, passed rule 2')
  })
  runCase('negative: twins, the one with a missing handicap printing a number is reported by rule 2', () => {
    const c = plainResult(runs.twins)
    const i = c.rowIds.indexOf('zz-test-2')
    if (i < 0) throw new Error('row for zz-test-2 not found')
    c.roster.rosterRows[i].hcp = '4.2'
    const hits = rule2(c, datas.twins).filter(f => f.where === 'rosterVals().rosterRows[' + i + '].hcp')
    if (!hits.length) throw new Error('rule 2 did not report the twin whose handicap is missing')
  })

  // Text a person typed (rule 1 does not test it).
  runCase('prose: a note and a message holding undefined or NaN are printed, and rule 1 passes them', () => {
    const where = allStrings(runs.prose).filter(s => s.text === NOTE_TEXT || s.text === MESSAGE_TEXT).map(s => s.where)
    if (!where.some(w => /pfNotes\[0\]\.body$/.test(w)) || !where.some(w => /pfThread\[0\]\.body$/.test(w))) throw new Error('the page did not print the note and the message: ' + where.join(', '))
    expectNone(r1('prose'), 'rule 1')
    expectNone(r2('prose'), 'rule 2')
    if (rule1(runs.prose).length < 2) throw new Error('without the data, rule 1 should have reported the two texts')
  })
  const mk = text => ({ roster: { a: text }, profiles: [], intake: {} })
  const typedData = { roster: [{ notes: [{ body: NOTE_TEXT }] }], me: { messages: [{ body: MESSAGE_TEXT }] } }
  runCase('rule 1: a note body holding undefined, a message body holding NaN, and a note inside a longer string pass', () => {
    expectNone(rule1(mk(NOTE_TEXT), typedData), 'rule 1 on the note')
    expectNone(rule1(mk(MESSAGE_TEXT), typedData), 'rule 1 on the message')
    expectNone(rule1(mk('Note: ' + NOTE_TEXT + ' (shared)'), typedData), 'rule 1 on the note inside a longer string')
    expectNone(rule1(mk(NOTE_TEXT + ' | ' + NOTE_TEXT), typedData), 'rule 1 on the note twice')
  })
  runCase('rule 1: the note body and a second undefined outside it is reported', () => {
    expectSome(rule1(mk(NOTE_TEXT + ' and undefined'), typedData), 'rule 1 on the note and a second undefined')
    expectSome(rule1(mk('undefined ' + MESSAGE_TEXT), typedData), 'rule 1 on a leading undefined')
  })
  runCase('rule 1: undefined or NaN when no input string holds it is reported', () => {
    expectSome(rule1(mk('x undefined y'), typedData), 'rule 1 with data that holds other text')
    expectSome(rule1(mk('x NaN y'), { roster: [{ n: 'ZZTEST-A' }] }), 'rule 1 with data holding no rule 1 word')
    expectSome(rule1(mk('nulld ago')), 'rule 1 with no data')
  })
  // A data string that is just a rule 1 word, or the word with up to three other characters, is never
  // taken out, so it cannot hide the same word printed in another field. With four other characters
  // it is taken out, and the word printed elsewhere is still reported.
  RULE1_WORDS.forEach(w => {
    runCase('rule 1: a data string that is ' + w + ' (alone, or with one, two or three other characters) does not hide ' + w + ' printed elsewhere', () => {
      ;['', 'a', 'ab', 'abc'].forEach(extra => {
        ;[w + extra, extra + w].forEach(s => {
          ;[{ roster: [{ n: s }] }, { roster: [{ notes: [{ body: s }] }] }].forEach(data => {
            expectSome(rule1(mk('x ' + w + ' y'), data), 'rule 1 with a data string ' + JSON.stringify(s) + ' printed elsewhere')
            expectSome(rule1(mk(s), data), 'rule 1 on the string ' + JSON.stringify(s) + ' itself (a name or note that is just the word fails, settled by eye)')
          })
        })
      })
    })
    runCase('rule 1: a data string with ' + w + ' and four other characters is taken out; ' + w + ' printed elsewhere is still reported', () => {
      ;[w + 'abcd', 'abcd' + w, 'ab' + w + 'cd'].forEach(s => {
        ;[{ roster: [{ n: s }] }, { roster: [{ notes: [{ body: s }] }] }].forEach(data => {
          expectNone(rule1(mk(s), data), 'rule 1 on ' + JSON.stringify(s))
          expectNone(rule1(mk('Note: ' + s + ' (shared)'), data), 'rule 1 on ' + JSON.stringify(s) + ' inside a longer string')
          expectSome(rule1(mk(s + ' and ' + w), data), 'rule 1 on ' + JSON.stringify(s) + ' and a second ' + w)
          expectSome(rule1({ roster: { a: s, b: 'x ' + w + ' y' }, profiles: [], intake: {} }, data), 'rule 1 on the word in another field')
        })
      })
    })
    runCase('saved-data mode: a ' + w + ' printed in an unrelated field is reported when the data holds a name or note that is just ' + w, () => {
      ;[{ n: w }, { notes: [{ body: w }] }, { n: w + 'ab' }].forEach(extra => {
        const data = DATA.missing()
        Object.assign(data.roster[0], extra)
        const checks = savedChecks(data, scriptSrc, res => { res.roster.rosterRows[0].leak = 'x ' + w + ' y' })
        if (!failsWith(checks[0].run)) throw new Error('rule 1 did not report ' + w + ' with data ' + JSON.stringify(extra))
      })
    })
  })
  runCase('rule 1: only input strings that hold a rule 1 word are taken out (a short string without one is not)', () => {
    expectSome(rule1(mk('x undefined y'), { roster: [{ a: 'd', b: 'n', c: 'e', d: 'u' }] }), 'rule 1 with short input strings')
  })

  // Negative cases: each passes only when the rules report the fault. They edit one string in a
  // data-only copy of a real run.
  const missingCopy = () => plainResult(runs.missing)

  // A literal list, not RULE1_WORDS: removing a word from the rule must turn one of these red. Each
  // word is planted bare, at the start, at the end and in the middle.
  ;['undefined', 'NaN', 'nulld'].forEach(w => {
    runCase('negative: an output holding ' + w + ' (bare, at the start, at the end, in the middle) is reported by rule 1', () => {
      ;[w, w + ' y', 'x ' + w, 'x ' + w + ' y'].forEach(text => {
        const c = missingCopy()
        c.roster.rosterRows[0].name = text
        const hits = rule1(c, datas.missing).filter(f => f.where === 'rosterVals().rosterRows[0].name' && f.token === w)
        if (!hits.length) throw new Error('rule 1 did not report ' + JSON.stringify(text))
      })
    })
  })
  ;[['+0.0', 'a signed 0.0'], ['+0', 'a signed 0'], ['0.0', 'an unsigned 0.0']].forEach(pair => {
    runCase('negative: a table field holding ' + pair[0] + ' for a missing input is reported by rule 2 (every field in the table)', () => {
      RULE2_TABLE.forEach(t => {
        const c = missingCopy()
        const targets = rule2Refs(c, datas.missing).filter(r => r.field === t.field)
        if (!targets.length) throw new Error('no value collected for ' + t.field)
        targets.forEach(r => {
          const c2 = missingCopy()
          const r2x = rule2Refs(c2, datas.missing).filter(x => x.where === r.where)[0]
          if (!r2x.missing) throw new Error(r2x.where + ' should have a missing input')
          r2x.container[r2x.key] = pair[0]
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
    expectNone(rule1(c, datas.present), 'rule 1')
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

  // ── the lists the rules read are pinned by literal copies written out a second time ───────────
  runCase('rule 2 table: every row and its empty text matches a literal list (a row dropped, added or changed is red)', () => {
    const literal = [
      ['rosterVals().rosterRows[].hcp', DASH],
      ['rosterVals().rosterRows[].sg', DASH],
      ['rosterVals().rosterRows[].delta', DASH],
      ['profileVals().pfHandicapReal', DASH],
      ['profileVals().pfHandicapTarget', DASH],
      ['profileVals().dnaMiHcp', DASH],
      ['profileVals().dnaMiGap', DASH],
      ['profileVals().pfHist[].value', 'NA'],
      ['profileVals().pfHistNote', 'No handicap on record.'],
      ['intakeVals().inHist[].value', ''],
    ]
    const actual = RULE2_TABLE.map(t => [t.field, t.empty])
    expectEqual(JSON.stringify(actual), JSON.stringify(literal), 'the rows of RULE2_TABLE')
  })

  // ── the gathering is pinned: rules 1 and 3 must really see all three functions ──────────────
  const SETS_RULE1 = Object.keys(datas)
  const SETS_RULE3 = ['empty', 'missing', 'playerWithout']
  const HEAD = { roster: 'rosterVals()', profile: 'profileVals(', intake: 'intakeVals()' }
  runCase('gathering: each function contributes strings, and a text only it holds is found, in every data set', () => {
    SETS_RULE1.forEach(k => {
      const g = allStrings(runs[k])
      const from = pre => g.filter(s => s.where.indexOf(pre) === 0)
      ;[HEAD.roster, HEAD.profile, HEAD.intake].forEach(pre => {
        if (!from(pre).length) throw new Error(k + ': no string gathered from ' + pre)
      })
      const n = Array.isArray(datas[k].roster) ? datas[k].roster.length : 0
      const one = (where, text) => {
        const hit = g.filter(s => s.where === where)
        if (hit.length !== 1 || hit[0].text !== text) throw new Error(k + ': ' + where + ' should be gathered once as ' + JSON.stringify(text))
      }
      one('rosterVals().rosterCount', n + ' active')
      one('intakeVals().inStatus', 'Incomplete. Your coach cannot write a block from a half-filled form.')
      runs[k].profiles.forEach(p => one(p.label + '.dnaTitle', n === 0 ? 'What your coach sees of your read.' : 'What this player sees.'))
    })
  })
  const planted = [
    ['profileVals', c => { c.profiles[0].out.pfName = 'PLANT'; return c.profiles[0].label + '.pfName' }],
    ['intakeVals', c => { c.intake.inStatus = 'PLANT'; return 'intakeVals().inStatus' }],
  ]
  planted.forEach(pl => {
    ;['undefined', 'NaN', 'nulld'].forEach(w => {
      runCase('negative: ' + w + ' planted in a ' + pl[0] + ' string is reported by rule 1', () => {
        const c = missingCopy()
        const where = pl[1](c)
        const text = 'x ' + w + ' y'
        if (pl[0] === 'profileVals') c.profiles[0].out.pfName = text
        else c.intake.inStatus = text
        const hits = rule1(c, datas.missing).filter(f => f.where === where && f.token === w)
        if (!hits.length) throw new Error('rule 1 did not report ' + w + ' at ' + where)
      })
    })
    runCase('negative: +0.0 planted in a ' + pl[0] + ' string, every number missing, is reported by rule 3', () => {
      const c = missingCopy()
      const where = pl[1](c)
      if (pl[0] === 'profileVals') c.profiles[0].out.pfName = 'Sorted +0.0'
      else c.intake.inStatus = 'Sorted +0.0'
      const hits = rule3(c).filter(f => f.where === where)
      if (!hits.length) throw new Error('rule 3 did not report +0.0 at ' + where)
    })
  })

  // Rule 3 is only sound when the data holds no number a signed zero could come from.
  const SCOPE_KEYS = ['hcp', 'target', 'sg', 'hist', 'mi', 'realHcp']
  function numbersIn(v, where, inScope, acc) {
    if (typeof v === 'number') { if (inScope && isFinite(v)) acc.push(where); return acc }
    if (typeof v === 'string') { if (inScope && v.trim() !== '' && isFinite(Number(v))) acc.push(where); return acc }
    if (v === null || typeof v !== 'object') return acc
    Object.keys(v).forEach(k => numbersIn(v[k], where + '.' + k, inScope || SCOPE_KEYS.indexOf(k) !== -1, acc))
    return acc
  }
  runCase('rule 3 data sets hold no handicap, target, strokes-gained, history or mechanics number', () => {
    SETS_RULE3.forEach(k => {
      const found = numbersIn(datas[k], k, false, [])
      if (found.length) throw new Error(k + ' holds a number at ' + found.slice(0, 4).join(', '))
    })
  })
  runCase('the number walk finds numbers where there are some', () => {
    ;['present', 'playerWith'].forEach(k => {
      if (!numbersIn(datas[k], k, false, []).length) throw new Error('the walk found nothing in ' + k)
    })
    const seeded = DATA.empty()
    seeded.me = coachMe('4.2', null)
    if (!numbersIn(seeded, 'x', false, []).length) throw new Error('the walk missed me.hcp')
  })
  runCase('the number walk: its key list is the literal list (a renamed, dropped or added key is red)', () => {
    expectEqual(JSON.stringify(SCOPE_KEYS), JSON.stringify(['hcp', 'target', 'sg', 'hist', 'mi', 'realHcp']), 'the walk\'s key list')
  })
  runCase('the no-number walk finds a number planted under each key of its list, alone', () => {
    SCOPE_KEYS.forEach(key => {
      if (!numbersIn({ [key]: 4.2 }, 'x', false, []).length) throw new Error('a number under ' + key + ' was not found')
      if (!numbersIn({ a: { [key]: '4.2' } }, 'x', false, []).length) throw new Error('numeric text under ' + key + ' was not found')
      if (!numbersIn({ a: { b: { [key]: [1] } } }, 'x', false, []).length) throw new Error('a number in a list under ' + key + ' was not found')
    })
    if (numbersIn({ tendency: 50, days: 3 }, 'x', false, []).length) throw new Error('the walk flagged a key outside its list')
  })
  runCase('under --data a rule 2 value is printed only when short and numeric', () => {
    expectEqual(safeValue('+0.0'), '"+0.0"', 'short numeric')
    expectEqual(safeValue('−1.5 —'), JSON.stringify('−1.5 —'), 'minus, space, dash')
    expectEqual(safeValue('ZZ-FILE-CONTENT-TOKEN'), 'text of length 21', 'file text')
    expectEqual(safeValue('1234567890123'), 'text of length 13', 'over 12 characters')
    // Short texts that are not numeric must be reduced to their length (a hyphen inside a class once
    // read as a range and let every short text through).
    ;[['Zzname', 6], ['ab@c.de', 7], ['Жж', 2], ['  ж  ', 5], ['   a   ', 7], ['1a', 2], ['4.2%', 4]].forEach(p => {
      expectEqual(safeValue(p[0]), 'text of length ' + p[1], JSON.stringify(p[0]))
    })
    // Numeric texts are printed in full, including a 12-character one; 13 characters is a length.
    ;['+0.0', '-0.0', '−0.0', '—', '12.4', '123456789.01', '', ' '].forEach(s => {
      expectEqual(safeValue(s), JSON.stringify(s), JSON.stringify(s))
    })
    expectEqual(safeValue('123456789.012'), 'text of length 13', '13-character numeric text')
  })
  runCase('profileVals is gathered once with no student selected and once per student, in every coach data set', () => {
    let coachSets = 0
    SETS_RULE1.forEach(k => {
      const roster = Array.isArray(datas[k].roster) ? datas[k].roster : []
      const profiles = runs[k].profiles
      if (roster.length === 0) {
        if (profiles.length !== 1 || profiles[0].kind !== 'self') throw new Error(k + ': expected one self profile, got ' + profiles.length)
        return
      }
      coachSets++
      if (profiles.length !== roster.length + 1) throw new Error(k + ': expected ' + (roster.length + 1) + ' profileVals calls, got ' + profiles.length)
      if (profiles.filter(p => p.kind === 'none').length !== 1) throw new Error(k + ': no-student-selected call is not there exactly once')
      roster.forEach(p => {
        if (profiles.filter(x => x.kind === 'student' && x.student === p).length !== 1) throw new Error(k + ': ' + p.id + ' is not gathered exactly once')
      })
    })
    if (!coachSets) throw new Error('no coach data set was checked')
  })

  // ── the saved-data mode is run by the built-in run, on made-up data held here (no file) ──────
  runCase('saved-data mode (rule 3 is not run on saved data): the case names say so', () => {
    savedChecks(datas.missing, scriptSrc).forEach(c => {
      if (c.name.indexOf('rule 3 is not run on saved data') === -1) throw new Error('"' + c.name + '" does not say rule 3 is not run')
    })
  })
  runCase('saved-data mode: a clean data set passes both checks', () => {
    ;['missing', 'present', 'twins', 'prose', 'playerWithout', 'empty'].forEach(k => {
      savedChecks(datas[k], scriptSrc).forEach(c => {
        const e = failsWith(c.run)
        if (e) throw new Error(k + ': ' + c.name + ' failed: ' + e)
      })
    })
  })
  runCase('saved-data mode: a rule 1 word that is not a person\'s text is reported (and rule 2 is not)', () => {
    const checks = savedChecks(DATA.missing(), scriptSrc, res => { res.profiles[0].out.pfName = 'x undefined y' })
    if (!failsWith(checks[0].run)) throw new Error('rule 1 did not report the planted word')
    const e = failsWith(checks[1].run)
    if (e) throw new Error('rule 2 should pass here: ' + e)
  })
  runCase('saved-data mode: a number printed for a missing input is reported by rule 2 (and rule 1 is not)', () => {
    const checks = savedChecks(DATA.missing(), scriptSrc, res => { res.roster.rosterRows[0].hcp = '5.0' })
    const e = failsWith(checks[1].run)
    if (!e) throw new Error('rule 2 did not report the planted number')
    if (e.indexOf('rosterRows[0].hcp') === -1) throw new Error('the report does not name the field: ' + e)
    const e1 = failsWith(checks[0].run)
    if (e1) throw new Error('rule 1 should pass here: ' + e1)
  })

  // ── the check's own inputs ───────────────────────────────────────────────────────────────────
  runCase('a blank or non-numeric me.hcp / me.target counts as missing', () => {
    ;['', ' ', '  ', 'abc'].forEach(t => {
      const got = subjectInputs({ kind: 'self' }, { me: { hcp: t, target: t }, meRow: { hcp: null, target: null } })
      if (!missingNum(got.hcp) || !missingNum(got.target)) throw new Error('me text ' + JSON.stringify(t) + ' was taken as a number')
    })
    const got = subjectInputs({ kind: 'self' }, { me: { hcp: '0.0', target: '5' }, meRow: { hcp: null, target: null } })
    if (missingNum(got.hcp) || missingNum(got.target)) throw new Error('"0.0" and "5" are numbers')
  })
  runCase('arguments: --data or --page given twice is refused with one plain line', () => {
    ;['--data', '--page'].forEach(o => {
      const e = failsWith(() => parseArgs([o, 'a', o, 'b']))
      if (!e || e.indexOf(o + ' was given more than once') === -1 || e.indexOf('\n') !== -1) throw new Error(o + ' twice gave ' + JSON.stringify(e))
    })
    parseArgs(['--data', 'a', '--page', 'b'])
  })
  runCase('arguments: an unreadable --page file is refused with the argument as given, no resolved path and no system text', () => {
    const arg = 'zz-no-such-page.html'
    const e = failsWith(() => readPage(parseArgs(['--page', arg])))
    if (!e) throw new Error('no refusal')
    if (e.indexOf(arg) === -1) throw new Error('the message lacks the argument: ' + e)
    if (e.indexOf(path.resolve(arg)) !== -1 || /ENOENT|no such file|open '/.test(e)) throw new Error('the message holds a path or system text: ' + e)
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
