// Prototype value check (hq card 30, T-141). Run: node scripts/protoValues.test.js
//
// Runs the dashboard prototype's OWN inline component script in a node:vm context against test
// data, calls rosterVals(), profileVals() and intakeVals(), gathers every string they return and
// applies three rules. No database, no network, no server, no file written, no environment file.
//
//   Rule 1  no output string contains `undefined`, `NaN` or `nulld`. A plain substring test with no
//           exception. Before the page runs, the script copies the injected data and, in the fields
//           that carry text a person typed (TYPED_FIELDS: display names, note and message bodies,
//           interview answers, sign-off notes and video references), replaces every occurrence of
//           those three words, whatever their case (the page changes the case of typed text), by the marker
//           `(typed)`. Every other string, and every key, is left exactly as the data has it. The page
//           runs on the copy and every rule reads its inputs from it. So a word the server wrote into
//           any other field and the page prints is reported; a typed-text field missing from the list
//           and holding a word fails the check until it is added (it fails closed).
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
// is missing (T-142); a change printed from a single strokes-gained read (T-143); the mechanics
// card's handicap for a plus player (T-144); numbers that are not a handicap, target, strokes-gained
// or history value; anything outside the three functions; output built from what a person typed
// into the page since it loaded (the script never sets that state); a present number being the
// right one (the right student's, with its plus sign), asserted on one built-in data set only and
// not under --data; a fault inside a listed typed-text field's own text, and a word the page builds
// from pieces of typed text (for example the initials of a three-part name).
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
function runPage(scriptSrc, original) {
  // The page runs on the copy; the original is not used again. `result.data` is the copy: every rule
  // reads its inputs from it.
  const data = sanitize(original)
  const Component = loadComponent(scriptSrc, data)
  const inst = new Component()
  const roster = Array.isArray(data.roster) ? data.roster : []
  const result = { data, roster: inst.rosterVals(), rowIds: [], profiles: [], intake: null }
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
    data: r.data, roster: plain(r.roster), rowIds: r.rowIds ? r.rowIds.slice() : [],
    profiles: r.profiles.map(p => Object.assign({}, p, { out: plain(p.out) })), intake: plain(r.intake),
  }
}

// ─── rule 1 ──────────────────────────────────────────────────────────────────────────────────
const RULE1_WORDS = ['undefined', 'NaN', 'nulld']
const MARKER = '(typed)'
const WORD_RE = new RegExp(RULE1_WORDS.join('|'), 'gi')
const scrub = s => s.replace(WORD_RE, MARKER)
// The fields of the injected data that carry text a person typed, and nothing else. Read from
// server/protoData.ts (the types AtlasData, RosterRow, CoachingNoteRow); a field the server composes
// (a status line, a label, a date, an id, a number as text) is not on the list. Only fields the
// three functions print are listed. Pattern: dots step into an object, [] steps into each item of a list,
// * steps into each value of a map. (The organisation name inside the composed `intake` line, protoData.ts:615,
// is not listed: the server composes that line, and a name holding one of the words is not plausible.)
const TYPED_FIELDS = [
  // a student's display name, or their email when they set none (protoData.ts:1386; type, line 52)
  'roster[].n',
  // the student's email, shown when two names collide (protoData.ts:1482)
  'roster[].dupe',
  // the interview's five prose answers, spread from the stored interview (protoData.ts:1445; the type, lines 130-138; the page's FIELDS)
  'roster[].file.sport', 'roster[].file.years', 'roster[].file.limits', 'roster[].file.time', 'roster[].file.goal',
  // a coaching note's body, and its author's display name (protoData.ts:1024, 1026; type CoachingNoteRow, lines 246-249)
  'roster[].notes[].body', 'roster[].notes[].author',
  // a message body in the thread with a student (protoData.ts:1356; type, line 219)
  'roster[].messages[].body',
  // the same for the signed-in person's own row (protoData.ts:1133, 1138, 1146)
  'meRow.n',
  'meRow.file.sport', 'meRow.file.years', 'meRow.file.limits', 'meRow.file.time', 'meRow.file.goal',
  'meRow.notes[].body', 'meRow.notes[].author',
  // the signed-in person's own display name, as they typed it (protoData.ts:886)
  'me.displayName',
  // a coach's sign-off note on a drill and the pasted video reference: the type (protoData.ts:159-160), a roster row
  // (1369-1370, 1393) and the caller's own row (865-866, 1145). `*` steps into each value of the drills map.
  'roster[].drills.*.verifyNote', 'roster[].drills.*.videoRef',
  'meRow.drills.*.verifyNote', 'meRow.drills.*.videoRef',
]
// A copy of the injected data. Structure, keys and every string are as the data has them, except the
// values at TYPED_FIELDS, in which every occurrence of a rule 1 word (whatever its case) is replaced by
// MARKER. Numbers, booleans and null are kept; the original is not touched. Keys are defined with
// defineProperty so that a key such as __proto__ stays a plain own key.
function cloneData(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(cloneData)
  const o = {}
  Object.keys(v).forEach(k => {
    Object.defineProperty(o, k, { value: cloneData(v[k]), enumerable: true, writable: true, configurable: true })
  })
  return o
}
function scrubAt(node, segs) {
  if (node === null || typeof node !== 'object') return
  if (segs[0] === '*') {
    Object.keys(node).forEach(k => scrubAt(node[k], segs.slice(1)))
    return
  }
  const list = segs[0].slice(-2) === '[]'
  const key = list ? segs[0].slice(0, -2) : segs[0]
  if (!Object.prototype.hasOwnProperty.call(node, key)) return
  const val = node[key]
  if (list) {
    if (Array.isArray(val)) val.forEach(item => scrubAt(item, segs.slice(1)))
  } else if (segs.length === 1) {
    if (typeof val === 'string') node[key] = scrub(val)
  } else {
    scrubAt(val, segs.slice(1))
  }
}
function sanitize(v) {
  const copy = cloneData(v)
  TYPED_FIELDS.forEach(p => scrubAt(copy, p.split('.')))
  return copy
}
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
  // `data` is the copy the page ran on (result.data).
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
// (Dashboard.dc.html at dcd1a0d) and the field's own empty text. `refs(result)` returns one
// entry per output value: { where, container, key, missing } so a negative case can overwrite the
// value in a copy.
const RULE2_TABLE = [
  { field: 'rosterVals().rosterRows[].hcp', from: 'roster[].hcp', line: 5676, empty: DASH,
    refs: (r) => rosterRefs(r, 'hcp', p => missingNum(p.hcp)) },
  { field: 'rosterVals().rosterRows[].sg', from: 'last of roster[].sg', line: 5679, empty: DASH,
    refs: (r) => rosterRefs(r, 'sg', p => missingNum(lastOf(p.sg))) },
  { field: 'rosterVals().rosterRows[].delta', from: 'first and last of roster[].sg', line: 5686, empty: DASH,
    refs: (r) => rosterRefs(r, 'delta', p => missingNum(firstOf(p.sg)) || missingNum(lastOf(p.sg))) },
  { field: 'profileVals().pfHandicapReal', from: 'subject handicap (student hcp; player me.hcp, else meRow.hcp)', line: 5404, empty: DASH,
    refs: (r) => profileRefs(r, 'pfHandicapReal', s => missingNum(s.hcp)) },
  { field: 'profileVals().pfHandicapTarget', from: 'subject target (student target; player me.target, else meRow.target)', line: 5409, empty: DASH,
    refs: (r) => profileRefs(r, 'pfHandicapTarget', s => missingNum(s.target)) },
  { field: 'profileVals().dnaMiHcp', from: 'subject dna.mi.handicap (no dna counts as missing)', line: 5343, empty: DASH,
    refs: (r) => profileRefs(r, 'dnaMiHcp', s => !s.dna || !s.dna.mi || missingNum(s.dna.mi.handicap)) },
  { field: 'profileVals().dnaMiGap', from: 'subject dna.mi.gap (no dna counts as missing)', line: 5344, empty: DASH,
    refs: (r) => profileRefs(r, 'dnaMiGap', s => !s.dna || !s.dna.mi || missingNum(s.dna.mi.gap)) },
  { field: 'profileVals().pfHist[].value', from: 'one lookback of the subject handicap history', line: 5436, empty: 'NA',
    refs: (r) => histRefs(r) },
  { field: 'profileVals().pfHistNote', from: 'the whole subject handicap history (checked only when every lookback is missing)', line: 5451, empty: 'No handicap on record.',
    refs: (r) => r.profiles.map(p => ({
      where: p.label + '.pfHistNote', container: p.out, key: 'pfHistNote',
      missing: HIST_KEYS.every(k => missingNum(subjectHist(p, r.data)[k])),
    })) },
  { field: 'intakeVals().inHist[].value', from: 'one lookback of the player\'s own history (state.hist, which this script never sets)', line: 5560, empty: '',
    refs: (r) => (r.intake && Array.isArray(r.intake.inHist) ? r.intake.inHist : []).map((c, i) => ({
      where: 'intakeVals().inHist[' + i + '].value', container: c, key: 'value', missing: true,
    })) },
]

// rosterRows are sorted; each row is matched to its student by the id its own `open` handler carries.
function rosterRefs(result, key, isMissing) {
  const roster = Array.isArray(result.data.roster) ? result.data.roster : []
  const rows = result.roster && result.roster.rosterRows ? result.roster.rosterRows : []
  if (rows.length !== roster.length) throw new Error('rosterRows has ' + rows.length + ' rows for ' + roster.length + ' students')
  // Each row's own `open` handler must open one student, and together they must open every student once.
  const opened = result.rowIds.slice().map(String).sort().join('|')
  const wanted = roster.map(p => String(p.id)).sort().join('|')
  if (result.rowIds.length !== roster.length || opened !== wanted) throw new Error('the roster rows do not open their own students (the ids their open handlers set are not the roster ids, each once)')
  return rows.map((row, i) => {
    const matches = roster.filter(p => p.id === result.rowIds[i])
    if (matches.length !== 1) throw new Error('cannot match rosterRows[' + i + '] to one student (' + matches.length + ' matches)')
    if (row.name !== matches[0].n) throw new Error('rosterRows[' + i + '] shows one student but opens another (the roster rows do not open their own students)')
    return { where: 'rosterVals().rosterRows[' + i + '].' + key, container: row, key, missing: isMissing(matches[0]) }
  })
}
function profileRefs(result, key, isMissing) {
  return result.profiles.map(p => ({
    where: p.label + '.' + key, container: p.out, key, missing: isMissing(subjectInputs(p, result.data)),
  }))
}
function histRefs(result) {
  const refs = []
  result.profiles.forEach(p => {
    const list = p.out.pfHist
    if (!Array.isArray(list) || list.length !== HIST_KEYS.length) throw new Error(p.label + '.pfHist is not a list of ' + HIST_KEYS.length)
    list.forEach((c, i) => refs.push({ where: p.label + '.pfHist[' + i + '].value', container: c, key: 'value', histKey: HIST_KEYS[i], profile: p }))
  })
  return refs
}

function rule2Refs(result) {
  const refs = []
  RULE2_TABLE.forEach(t => {
    t.refs(result).forEach(r => {
      // The history rows need the data to know which lookback is missing.
      if (r.histKey) r = Object.assign({}, r, { missing: missingNum(subjectHist(r.profile, result.data)[r.histKey]) })
      refs.push(Object.assign({ field: t.field, empty: t.empty }, r))
    })
  })
  return refs
}
function rule2(result) {
  const faults = []
  rule2Refs(result).forEach(r => {
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

// The scored intake as the dashboard really builds it (shared/practice-dna/scoring.ts:493-530 through
// server/dnaSummary.ts:350-360; the call has no metrics, server/dnaSummary.ts:237):
//  - with a handicap, the intake is 'estimated' and carries a mechanics value and a range (miDiagnostic,
//    scoring.ts:513-524); the gap is null (and estimable false) only when the mechanics scale was not
//    answered (dnaSummary.ts:275, 357);
//  - without a handicap, it is the 'none' shape (scoring.ts:529): handicap, value, range and gap all null.
//    So "the mechanics handicap missing" always comes with the gap missing, from one cause (the intake's
//    handicap answer); the server never sends a gap beside a missing handicap.
// The value and range differ from every other number in a set: a counter gives each scored intake its own.
let miCounter = 0
const dna = (handicap, gap) => {
  let mi
  if (handicap === null) {
    mi = { state: 'none', handicap: null, value: null, range: null, gap: null, verdict: '', estimable: true }
  } else {
    miCounter++
    const value = 100 + miCounter * 10
    mi = { state: 'estimated', handicap, value, range: [value - 3, value + 3], gap, verdict: '', estimable: gap !== null }
  }
  return {
    depth: 'baseline', depthLabel: 'First read', depthBasis: 'ZZTEST', archetype: 'ZZTEST', archetypeTagline: '',
    archetypeCoachLine: '', archetypeProvisional: false, archetypeProvisionalNote: '', tendency: 50,
    tendencyName: 'Blended', tendencyPole: 'Both', tendencyProvisional: false, growthZone: '',
    growthHeadline: '', growthMoves: [], zones: [], efficiency: null, efficiencyLabel: '',
    efficiencyMissing: '', pattern: '', patternHeadline: '', patternFix: '', ghostZone: '', chips: [],
    mi,
  }
}

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

// The set that covers the class: a coach with their own handicap and target, and students who each
// have exactly one input missing and every other field present (handicap, target, strokes-gained
// series, the intake's handicap, the mechanics gap, one history lookback; the tier, the five
// interview answers and a note are present for all). Every present number is different from every
// other, so a number borrowed from another field is seen as wrong. The intake's handicap missing brings
// the gap with it (one cause, see dna()). A seventh set of the same kind, `coachEmptyHist`, has the
// whole history missing, which is what the server sends for every person today (`hist: {}`, protoData.ts:1434).
// Rows of rule 2's table a student's data cannot make missing: the intake form's history fields (page state).
const EACH_MISSING = [
  { n: 'ZZTEST-A', hcp: null, target: 3.1, sg: [0.12, 0.62, 0.32, 0.92, 1.12], miHcp: 21.7, miGap: 1.3 },
  { n: 'ZZTEST-B', hcp: 12.2, target: null, sg: [0.23, 0.73, 0.43, 1.33, 2.23], miHcp: 22.8, miGap: 2.4 },
  { n: 'ZZTEST-C', hcp: 13.3, target: 6.2, sg: [], miHcp: 23.9, miGap: 3.6 },
  { n: 'ZZTEST-D', hcp: 14.4, target: 7.4, sg: [-0.66, 0.84, 1.54, 2.64, 3.34], miHcp: null, miGap: null },
  { n: 'ZZTEST-E', hcp: 15.5, target: 8.6, sg: [0.46, 1.96, 2.76, 4.36, 5.46], miHcp: 25.4, miGap: null },
  { n: 'ZZTEST-F', hcp: 16.6, target: 9.1, sg: [1.67, 2.87, 3.97, 5.07, 7.67], miHcp: 26.3, miGap: 6.9, noY10: true },
]
const eachStudent = (i, o) => row({
  id: 'zz-test-' + (i + 1), n: o.n, tier: ['foundation', 'builder', 'competitive'][i % 3], zone: String((i % 4) + 1), days: i + 1,
  hcp: o.hcp, target: o.target, sg: o.sg.slice(),
  hist: o.emptyHist ? {} : { m3: 30.4 + i * 6, m6: 31.4 + i * 6, y1: 32.4 + i * 6, y3: 33.4 + i * 6, y5: 34.4 + i * 6, y10: o.noY10 ? null : 35.4 + i * 6 },
  dna: dna(o.miHcp, o.miGap),
  file: { sport: 'ZZ sport ' + o.n, years: String(41 + i), limits: 'ZZ limits ' + o.n, time: 'ZZ time ' + o.n, goal: 'ZZ goal ' + o.n },
  notes: [{ id: 'zz-note-' + (i + 1), body: 'ZZ note ' + o.n, visibility: 'shared', author: null, mine: false, createdAt: null }],
  messages: [{ id: 'zz-msg-' + (i + 1), mine: false, who: '', body: 'ZZ message ' + o.n, at: null, read: false }],
})
const eachMissingData = () => coachData(coachMe('3.3', '1.1'), EACH_MISSING.map((o, i) => eachStudent(i, o)))
const coachEmptyHistData = () => coachData(coachMe('3.3', '1.1'), [
  eachStudent(1, { n: 'ZZTEST-A', hcp: 12.2, target: 6.2, sg: [0.23, 0.73, 0.43, 1.33, 2.23], miHcp: 22.8, miGap: 2.4, emptyHist: true }),
])

// The same class for a player looking at their own file (`me` and `meRow` as the server sends them to a
// player, roster empty): six sets, each with exactly one input missing and everything else present: the
// handicap, the target, the intake's handicap (the gap goes with it), the mechanics gap, one history lookback
// (y10), and the whole history (`hist: {}`, which is what the server sends today). Each carries a tier, the
// five interview answers, a scored intake with its value and range, and a note; every present number is
// different from every other in the set (`me` mirrors `meRow`, as the server builds both from the same
// profile). There is no message in these sets: the page prints a player's thread from `meRow.messages`
// (page 5211), which the server never fills (protoData.ts:264, 1130-1150; the thread it sends is `me.messages`,
// 853, which the three functions never read). Rows of rule 2's table a player's data cannot make missing: the
// roster rows (a player has no roster) and the intake form's history fields (page state).
const PLAYER_BASE = { hcp: 9.1, target: 4.3, miHcp: 21.7, miGap: 1.3, noY10: false, emptyHist: false }
const playerEachData = over => {
  const o = Object.assign({}, PLAYER_BASE, over)
  const d = playerData(o.hcp === null ? null : String(o.hcp), o.target === null ? null : String(o.target))
  d.me.tier = 'builder'
  d.me.zone = '2'
  d.me.coaches = [{ name: 'ZZTEST-G' }]
  Object.assign(d.meRow, {
    tier: 'builder', zone: '2',
    file: { sport: 'ZZ sport', years: '41', limits: 'ZZ limits', time: 'ZZ time', goal: 'ZZ goal' },
    dna: dna(o.miHcp, o.miGap),
    hist: o.emptyHist ? {} : { m3: 30.4, m6: 31.4, y1: 32.4, y3: 33.4, y5: 34.4, y10: o.noY10 ? null : 35.4 },
    notes: [{ id: 'zz-note-1', body: 'ZZ note', visibility: 'shared', author: null, mine: false, createdAt: null }],
  })
  return d
}

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
  // Two students who both have every number: one ordinary, one plus player (stored negative).
  bothPresent: () => coachData(coachMe(null, null), [
    row({ id: 'zz-test-1', n: 'ZZTEST-A', hcp: 12.4, target: 8, dna: dna(12.4, 1.5) }),
    row({ id: 'zz-test-2', n: 'ZZTEST-B', hcp: -1.2, target: -2, dna: dna(-1.2, -0.4) }),
  ]),
  // A coach who plays: `me` carries the coach's own numbers; one student has neither, one has both.
  coachOwn: () => coachData(coachMe('5.0', '3.0'), [
    row({ id: 'zz-test-1', n: 'ZZTEST-A' }),
    row({ id: 'zz-test-2', n: 'ZZTEST-B', hcp: 7, target: 4 }),
  ]),
  // The page sorts rows by how many submissions wait on the coach, so a submission on the second
  // student renders that student first.
  reordered: () => coachData(coachMe(null, null), [
    row({ id: 'zz-test-1', n: 'ZZTEST-A' }),
    row({ id: 'zz-test-2', n: 'ZZTEST-B', hcp: 4.2, submitted: { 'plan:2-P1': '2026-01-01T00:00:00Z' } }),
  ]),
  // A history with only the three-month value is not a wholly missing history.
  m3Only: () => coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', hcp: 12.4, hist: { m3: 12.4 } })]),
  // A player whose own history is present in the data (the type allows it; the server sends {} today).
  playerHist: () => {
    const d = playerData('12.4', null)
    d.meRow.hist = { m3: 12.4, m6: 12.9, y1: 13.5, y3: 14, y5: null, y10: null }
    return d
  },
  // Each number missing alone with the rest present, and the coach's own numbers (see EACH_MISSING).
  eachMissing: eachMissingData,
  // The player's own file, each number missing alone (see PLAYER_BASE).
  playerNoHcp: () => playerEachData({ hcp: null }),
  playerNoTarget: () => playerEachData({ target: null }),
  playerNoMiHcp: () => playerEachData({ miHcp: null }),
  playerNoMiGap: () => playerEachData({ miGap: null }),
  playerNoY10: () => playerEachData({ noY10: true }),
  // The whole history missing (hist: {}) with everything else present, for a coach's student and for a player.
  coachEmptyHist: coachEmptyHistData,
  playerEmptyHist: () => playerEachData({ emptyHist: true }),
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
function expectOneOf(actual, options, label) {
  if (options.indexOf(actual) === -1) throw new Error(label + ': expected ' + options.join(' or ') + ', got ' + JSON.stringify(actual))
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
      run: () => expectNone(rule1(result), 'rule 1'),
    },
    {
      name: 'saved data: rule 2 (a missing number prints its own empty text; rule 3 is not run on saved data)',
      run: () => {
        if (!rule2Refs(result).length) throw new Error('rule 2 found no field to check')
        expectNone(rule2(result), 'rule 2', true)
      },
    },
  ]
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────
// The text of a saved-data file to the data: parsed with JSON.parse (never evaluated or joined into source),
// and it must be the object the page was given: an object whose `roster` is a list (an empty list is the
// no-students file). The server always sends `roster` as a list, for a coach and for a player
// (server/protoData.ts:381, 1164, 1485). Every refusal is one plain line that never quotes the file.
function parseSavedData(text) {
  if (text.length > MAX_DATA_CHARS) throw new Error('the data file is larger than ' + MAX_DATA_CHARS + ' characters; refusing it')
  let data
  try { data = JSON.parse(text) } catch (e) { throw new Error('the data file is not valid JSON; refusing it') }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('the data file does not parse to an object; refusing it')
  if (!Array.isArray(data.roster)) throw new Error('the data file holds no roster list; it is not the dashboard\'s injected data; refusing it')
  if (!data.roster.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) throw new Error('the data file\'s roster list holds an entry that is not an object; it is not the dashboard\'s injected data; refusing it')
  return data
}

// The checks for a saved-data file: from the file named by --data, or (the built-in cases only) from
// `opts.dataText`, so the same path runs in both. The script writes no file.
function loadSavedChecks(opts) {
  let text
  if (opts.dataText !== undefined) {
    text = opts.dataText
  } else {
    let size
    const unreadable = () => new Error('the data file ' + opts.dataArg + ' cannot be read; refusing it')
    try { size = fs.statSync(opts.data).size } catch (e) { throw unreadable() }
    if (size > MAX_DATA_CHARS * 4) throw new Error('the data file is larger than ' + MAX_DATA_CHARS + ' characters; refusing it')
    try { text = fs.readFileSync(opts.data, 'utf8') } catch (e) { throw unreadable() }
  }
  const data = parseSavedData(text)
  const scriptSrc = extractScript(readPage(opts))
  return savedChecks(data, scriptSrc)
}
function mainData(opts) {
  loadSavedChecks(opts).forEach(c => runCase(c.name, c.run))
}

function mainTests(opts) {
  const scriptSrc = extractScript(readPage(opts))
  const runs = {}
  const datas = {}
  Object.keys(DATA).forEach(k => { datas[k] = DATA[k](); runs[k] = runPage(scriptSrc, datas[k]) })
  const r1 = k => rule1(runs[k])
  const r2 = k => rule2(runs[k])
  const refsOf = k => rule2Refs(runs[k])

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
    const e = failsWith(() => rule2Refs(c))
    if (!e || e.indexOf('do not open their own students') === -1) throw new Error('every row opening one student was not refused: ' + e)
    c.rowIds = ['zz-test-1']
    if (!failsWith(() => rule2Refs(c))) throw new Error('a missing id was not refused')
    c.rowIds = ['zz-test-2', 'zz-test-1']
    if (failsWith(() => rule2Refs(c))) throw new Error('the right ids in the other order were refused')
    // a missing handicap printed as a number must not go unseen when every row opens one student
    const d = plainResult(runs.missing)
    d.rowIds = ['zz-test-1', 'zz-test-1']
    d.roster.rosterRows[1].hcp = '5.0'
    const e2 = failsWith(() => expectNone(rule2(d), 'rule 2'))
    if (!e2) throw new Error('rows that all open one student, with a number printed for a missing handicap, passed rule 2')
  })
  runCase('negative: twins, the one with a missing handicap printing a number is reported by rule 2', () => {
    const c = plainResult(runs.twins)
    const i = c.rowIds.indexOf('zz-test-2')
    if (i < 0) throw new Error('row for zz-test-2 not found')
    c.roster.rosterRows[i].hcp = '4.2'
    const hits = rule2(c).filter(f => f.where === 'rosterVals().rosterRows[' + i + '].hcp')
    if (!hits.length) throw new Error('rule 2 did not report the twin whose handicap is missing')
  })

  // ── typed text is kept out at the input ──────────────────────────────────────────────────────
  const mk = text => ({ roster: { a: text }, profiles: [], intake: {} })
  runCase('prose: a note and a message holding undefined or NaN are printed (with the marker), and rule 1 passes them', () => {
    const want = [scrub(NOTE_TEXT), scrub(MESSAGE_TEXT)]
    const where = allStrings(runs.prose).filter(s => want.indexOf(s.text) !== -1).map(s => s.where)
    if (!where.some(w => /pfNotes\[0\]\.body$/.test(w)) || !where.some(w => /pfThread\[0\]\.body$/.test(w))) throw new Error('the page did not print the note and the message: ' + where.join(', '))
    expectNone(r1('prose'), 'rule 1')
    expectNone(r2('prose'), 'rule 2')
  })
  runCase('typed text: an interview answer holding undefined passes the saved-data function', () => {
    const d = coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', file: { limits: 'Knee pain of undefined origin, since spring.' } })])
    const res = runPage(scriptSrc, d)
    if (!allStrings(res).some(s => s.where.indexOf('pfInterviewIntro') !== -1 && s.text.indexOf(MARKER) !== -1)) throw new Error('the page did not print the (reshaped) answer, so this case proves nothing')
    savedChecks(d, scriptSrc).forEach(c => { const e = failsWith(c.run); if (e) throw new Error(c.name + ' failed: ' + e) })
  })
  RULE1_WORDS.forEach(w => {
    runCase('typed text: a display name, a note body and a message body that are exactly ' + w + ' pass; the same word printed by a faulty result elsewhere is reported', () => {
      const d = coachData(coachMe(null, null), [row({
        id: 'zz-test-1', n: w,
        notes: [{ id: 'zz-note-1', body: w, visibility: 'shared', author: null, mine: false, createdAt: null }],
        messages: [{ mine: false, at: null, body: w }],
      })])
      savedChecks(d, scriptSrc).forEach(c => { const e = failsWith(c.run); if (e) throw new Error(c.name + ' failed: ' + e) })
      const checks = savedChecks(d, scriptSrc, res => { res.roster.rosterRows[0].leak = 'x ' + w + ' y' })
      if (!failsWith(checks[0].run)) throw new Error('rule 1 did not report ' + w + ' printed by a faulty result')
    })
  })
  const typedData = () => ({
    roster: [{
      id: 'zz-undefined-1', n: 'undefined x', dupe: 'a@NaN.zz', intake: 'Coach request — undefined', carry: 'NaN yd driver carry', tier: 'nulld',
      hcp: 4.2, ok: true, nothing: null,
      file: { sport: 'NaN', years: 'nulld', limits: 'a undefined', time: 'x', goal: 'y', tier: 'undefined', phase: 'NaN' },
      notes: [{ id: 'n1', body: 'NaN', author: 'nulld y', visibility: 'undefined', mine: false }],
      messages: [{ id: 'm1', body: 'undefined', who: 'NaN', mine: false }],
    }],
    me: { name: 'NaN', displayName: 'NaN z', coaches: [{ name: 'undefined' }], hcp: '4.2' },
    meRow: { id: 'zz-NaN-0', n: 'undefined', file: { limits: 'NaN' }, notes: [{ body: 'undefined', author: 'NaN' }], messages: [{ body: 'undefined' }] },
  })
  runCase('the copy: only the listed typed-text fields are changed; numbers, booleans, null and every other string are kept; the original is not changed', () => {
    const orig = typedData()
    const before = JSON.stringify(orig)
    const copy = sanitize(orig)
    expectEqual(JSON.stringify(orig), before, 'the original after making the copy')
    const r = copy.roster[0]
    expectEqual(r.n, MARKER + ' x', 'roster n')
    expectEqual(r.dupe, 'a@' + MARKER + '.zz', 'roster dupe')
    expectEqual(r.file.sport, MARKER, 'file.sport')
    expectEqual(r.file.years, MARKER, 'file.years')
    expectEqual(r.file.limits, 'a ' + MARKER, 'file.limits')
    expectEqual(r.notes[0].body, MARKER, 'note body')
    expectEqual(r.notes[0].author, MARKER + ' y', 'note author')
    expectEqual(r.messages[0].body, MARKER, 'message body')
    expectEqual(copy.me.displayName, MARKER + ' z', 'me.displayName')
    expectEqual(copy.meRow.n, MARKER, 'meRow.n')
    expectEqual(copy.meRow.file.limits, MARKER, 'meRow.file.limits')
    expectEqual(copy.meRow.notes[0].body, MARKER, 'meRow note body')
    // everything else is exactly as it was
    expectEqual(r.id, 'zz-undefined-1', 'id')
    expectEqual(r.intake, 'Coach request — undefined', 'server-composed intake line')
    expectEqual(r.carry, 'NaN yd driver carry', 'server-composed carry')
    expectEqual(r.tier, 'nulld', 'tier')
    expectEqual(r.file.tier, 'undefined', 'file.tier (a closed choice)')
    expectEqual(r.file.phase, 'NaN', 'file.phase (a closed choice)')
    expectEqual(r.notes[0].visibility, 'undefined', 'note visibility')
    expectEqual(r.messages[0].who, 'NaN', 'message who')
    expectEqual(copy.me.name, 'NaN', 'me.name (not printed by the three functions)')
    expectEqual(copy.me.coaches[0].name, 'undefined', 'me.coaches[].name (not printed by the three functions)')
    expectEqual(copy.meRow.messages[0].body, 'undefined', 'meRow.messages (the server never fills it)')
    expectEqual(r.hcp, 4.2, 'number')
    expectEqual(r.ok, true, 'boolean')
    expectEqual(r.nothing, null, 'null')
    expectEqual(copy.me.hcp, '4.2', 'a number as text')
    if (copy === orig || copy.roster === orig.roster || copy.roster[0].file === orig.roster[0].file || copy.roster[0].notes === orig.roster[0].notes) throw new Error('the copy shares objects with the original')
  })
  runCase('the copy: keys are never changed (keys that would collide after a replacement stay two keys), and __proto__ stays a plain own key', () => {
    const o = JSON.parse('{"roster": [], "drills": {"NaN": 1, "(typed)": 2, "k undefined": 3}, "__proto__": {"x": "NaN"}}')
    const c2 = sanitize(o)
    expectEqual(Object.keys(c2.drills).join('|'), 'NaN|(typed)|k undefined', 'the keys of drills')
    expectEqual(c2.drills.NaN, 1, 'the value under the key NaN')
    if (Object.keys(c2).indexOf('__proto__') === -1 || Object.getPrototypeOf(c2) !== Object.prototype) throw new Error('__proto__ did not stay an own key')
  })
  runCase('typed-text list: TYPED_FIELDS is compared with a second literal list (a field dropped, added or renamed is red)', () => {
    const literal = [
      'roster[].n', 'roster[].dupe',
      'roster[].file.sport', 'roster[].file.years', 'roster[].file.limits', 'roster[].file.time', 'roster[].file.goal',
      'roster[].notes[].body', 'roster[].notes[].author', 'roster[].messages[].body',
      'meRow.n',
      'meRow.file.sport', 'meRow.file.years', 'meRow.file.limits', 'meRow.file.time', 'meRow.file.goal',
      'meRow.notes[].body', 'meRow.notes[].author',
      'me.displayName',
      'roster[].drills.*.verifyNote', 'roster[].drills.*.videoRef',
      'meRow.drills.*.verifyNote', 'meRow.drills.*.videoRef',
    ]
    expectEqual(JSON.stringify(TYPED_FIELDS), JSON.stringify(literal), 'TYPED_FIELDS')
  })
  // Whether a field, set to 'ZZMARK undefined' in a fresh data set, reaches an output through the real page
  // with the word replaced: the marker itself must be there (a field the page never prints, a path that
  // matches nothing, or a field the copy does not replace all read as not reached).
  const setAt = (node, segs, value) => {
    if (segs[0] === '*') {
      if (node['zz-drill-1'] === undefined || node['zz-drill-1'] === null || typeof node['zz-drill-1'] !== 'object') node['zz-drill-1'] = {}
      setAt(node['zz-drill-1'], segs.slice(1), value)
      return
    }
    const list = segs[0].slice(-2) === '[]'
    const key = list ? segs[0].slice(0, -2) : segs[0]
    if (list) {
      if (!Array.isArray(node[key]) || !node[key].length) node[key] = [{}]
      setAt(node[key][0], segs.slice(1), value)
    } else if (segs.length === 1) {
      node[key] = value
    } else {
      if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
      setAt(node[key], segs.slice(1), value)
    }
  }
  const reaches = p => {
    const d = /^roster/.test(p) ? coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A' })]) : playerData(null, null)
    if (/drills/.test(p)) d.reviewItems = [{ id: 'zz-drill-1', name: 'ZZ drill', group: 'assessment', context: 'ZZ', detail: 'ZZ', review: true }]
    setAt(d, p.split('.'), 'ZZMARK undefined')
    const res = runPage(scriptSrc, d)
    return { ok: allStrings(res).some(s => s.text.indexOf('ZZMARK ' + MARKER) !== -1), res }
  }
  runCase('typed-text list: each listed field reaches an output through the real page (a field the page never prints, or a path that matches nothing, is seen)', () => {
    TYPED_FIELDS.forEach(p => {
      const r = reaches(p)
      if (!r.ok) throw new Error('the listed field ' + p + ' reaches no output string')
      expectNone(rule1(r.res), 'rule 1 with a word in ' + p)
    })
  })
  runCase('typed-text list: a field that is not listed does not read as reached (the reach check looks for the marker)', () => {
    if (reaches('roster[].leak').ok) throw new Error('an unlisted field read as reached')
    if (reaches('roster[].intake').ok) throw new Error('an unlisted field read as reached')
  })
  runCase('a word the server wrote into a field that is not on the list is reported (and a listed field is not)', () => {
    const cases = [
      ['intake', 'Coach request — undefined', 'pfIntake'],
      ['carry', 'NaN yd driver carry', 'pfCarry'],
      ['leak', 'nulld leak', 'leak'],
    ]
    cases.forEach(cs => {
      const d = coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', [cs[0]]: cs[1] })])
      const checks = savedChecks(d, scriptSrc)
      const e = failsWith(checks[0].run)
      if (!e) throw new Error('a word in ' + cs[0] + ' was not reported')
      if (e.indexOf(cs[2]) === -1) throw new Error('the report does not name ' + cs[2] + ': ' + e)
    })
  })
  runCase('typed text: a capitalised or upper-case word in a listed field passes (the page changes the case of typed text)', () => {
    const d = coachData(coachMe(null, null), [row({
      id: 'zz-test-1', n: 'ZZTEST-A',
      file: { limits: 'Undefined lower back pain, since spring.', goal: 'NAN is not a goal', time: 'Nulld hours, mostly' },
    })])
    const res = runPage(scriptSrc, d)
    if (!allStrings(res).some(s => s.where.indexOf('pfInterviewIntro') !== -1 && s.text.indexOf(MARKER) !== -1)) throw new Error('the page did not print the lowercased answer, so this case proves nothing')
    savedChecks(d, scriptSrc).forEach(c2 => { const e = failsWith(c2.run); if (e) throw new Error(c2.name + ' failed: ' + e) })
    expectEqual(sanitize(d).roster[0].file.goal, MARKER + ' is not a goal', 'upper case replaced')
  })
  runCase('typed text: a word twice in one field, and a word in the second note of a list, are fully replaced', () => {
    const d = coachData(coachMe(null, null), [row({
      id: 'zz-test-1', n: 'ZZTEST-A',
      notes: [
        { id: 'n1', body: 'plain note', visibility: 'shared', author: null, mine: false, createdAt: null },
        { id: 'n2', body: 'undefined and undefined and NaN NaN nulld', visibility: 'shared', author: null, mine: false, createdAt: null },
      ],
      messages: [{ id: 'm1', mine: false, who: '', body: 'x', at: null, read: false }, { id: 'm2', mine: false, who: '', body: 'NaN then NaN', at: null, read: false }],
    })])
    const c3 = sanitize(d).roster[0]
    expectEqual(c3.notes[1].body, MARKER + ' and ' + MARKER + ' and ' + MARKER + ' ' + MARKER + ' ' + MARKER, 'the second note, all occurrences')
    expectEqual(c3.messages[1].body, MARKER + ' then ' + MARKER, 'the second message')
    savedChecks(d, scriptSrc).forEach(c2 => { const e = failsWith(c2.run); if (e) throw new Error(c2.name + ' failed: ' + e) })
  })
  runCase('typed text: the word in the second drill\'s sign-off note and video reference is replaced too (every drill, not only the first)', () => {
    const drills = () => ({
      'zz-drill-1': { verifyNote: 'plain note', videoRef: 'plain ref' },
      'zz-drill-2': { verifyNote: 'grip is undefined', videoRef: 'NaN ref' },
    })
    const d = coachData(coachMe(null, null), [row({ id: 'zz-test-1', n: 'ZZTEST-A', drills: drills() })])
    d.meRow.drills = drills()
    const cp = sanitize(d)
    expectEqual(cp.roster[0].drills['zz-drill-2'].verifyNote, 'grip is ' + MARKER, 'roster, second drill note')
    expectEqual(cp.roster[0].drills['zz-drill-2'].videoRef, MARKER + ' ref', 'roster, second drill reference')
    expectEqual(cp.meRow.drills['zz-drill-2'].verifyNote, 'grip is ' + MARKER, 'meRow, second drill note')
    expectEqual(cp.meRow.drills['zz-drill-2'].videoRef, MARKER + ' ref', 'meRow, second drill reference')
    expectEqual(cp.roster[0].drills['zz-drill-1'].verifyNote, 'plain note', 'the first drill is unchanged')
    // and through the real page: both drills printed, no rule 1 fault
    d.reviewItems = [
      { id: 'zz-drill-1', name: 'ZZ one', group: 'assessment', context: 'ZZ', detail: 'ZZ', review: true },
      { id: 'zz-drill-2', name: 'ZZ two', group: 'assessment', context: 'ZZ', detail: 'ZZ', review: true },
    ]
    const res = runPage(scriptSrc, d)
    if (!allStrings(res).some(s => s.text === 'grip is ' + MARKER)) throw new Error('the page did not print the second drill\'s note')
    savedChecks(d, scriptSrc).forEach(c2 => { const e = failsWith(c2.run); if (e) throw new Error(c2.name + ' failed: ' + e) })
  })
  runCase('the copy: the marker is not empty and holds none of the three words, in any case', () => {
    if (!MARKER.length) throw new Error('the marker is empty')
    RULE1_WORDS.forEach(w => { if (MARKER.toLowerCase().indexOf(w.toLowerCase()) !== -1) throw new Error('the marker holds ' + w) })
    expectEqual(scrub(MARKER), MARKER, 'scrubbing the marker')
  })
  runCase('an id that holds a rule 1 word is left as it is, and the rows still open their own students', () => {
    const d = coachData(coachMe(null, null), [row({ id: 'zz-undefined-1', n: 'ZZTEST-A', hcp: 4.2 }), row({ id: 'zz-NaN-2', n: 'ZZTEST-B' })])
    const res = runPage(scriptSrc, d)
    expectEqual(res.rowIds.slice().sort().join(','), 'zz-NaN-2,zz-undefined-1', 'the ids the rows open')
    expectEqual(res.data.roster[0].id, 'zz-undefined-1', 'the roster id in the copy')
    expectNone(rule2(res), 'rule 2')
  })
  runCase('rule 1 is a plain substring test: a word in an output string is reported whatever the data holds', () => {
    expectSome(rule1(mk('x undefined y')), 'rule 1')
    expectSome(rule1(mk('nulld ago')), 'rule 1')
    expectSome(rule1(mk('NaN')), 'rule 1')
    expectNone(rule1(mk('(typed)')), 'rule 1 on the marker')
  })

  // ── present numbers are asserted on one data set (not run under --data) ───────────────────────
  runCase('present numbers: each student\'s own file and roster row print the exact texts (one ordinary, one plus player)', () => {
    const res = runs.bothPresent
    const rowOf = n => res.roster.rosterRows.filter(r => r.name === n)[0]
    const fileOf = n => res.profiles.filter(p => p.kind === 'student' && p.student.n === n)[0].out
    // hand-written from what the page prints (page lines: hcpLabel 3179, hcp row 5676, pfHandicapReal 5404,
    // pfHandicapTarget 5409, dnaMiHcp 5343, dnaMiGap 5344)
    const expected = {
      'ZZTEST-A': { row: '12.4', real: '12.4', target: '8', miHcp: '12.4', miGap: '+1.5' },
      // The plus player's dnaMiHcp is asserted to be that player's own number in either sign form, and nothing else:
      // the page prints the minus today (T-144), and the fix would print the plus; neither may turn this red.
      'ZZTEST-B': { row: '+1.2', real: '+1.2', target: '+2', miHcpEither: ['-1.2', '+1.2'], miGap: '-0.4' },
    }
    // Every assertion that runs is recorded, and the list is compared with a literal one, so a skipped
    // student or a skipped check turns this red.
    const done = []
    const chk = (label, fn) => { fn(); done.push(label) }
    Object.keys(expected).forEach(n => {
      const e = expected[n]
      const o = fileOf(n)
      chk(n + ' roster', () => expectEqual(rowOf(n).hcp, e.row, n + ' roster handicap'))
      chk(n + ' real', () => expectEqual(o.pfHandicapReal, e.real, n + ' pfHandicapReal'))
      chk(n + ' target', () => expectEqual(o.pfHandicapTarget, e.target, n + ' pfHandicapTarget'))
      if (e.miHcp !== undefined) chk(n + ' miHcp', () => expectEqual(o.dnaMiHcp, e.miHcp, n + ' dnaMiHcp'))
      if (e.miHcpEither) chk(n + ' miHcpEither', () => expectOneOf(o.dnaMiHcp, e.miHcpEither, n + ' dnaMiHcp'))
      chk(n + ' miGap', () => expectEqual(o.dnaMiGap, e.miGap, n + ' dnaMiGap'))
    })
    expectEqual(done.join('|'),
      'ZZTEST-A roster|ZZTEST-A real|ZZTEST-A target|ZZTEST-A miHcp|ZZTEST-A miGap|ZZTEST-B roster|ZZTEST-B real|ZZTEST-B target|ZZTEST-B miHcpEither|ZZTEST-B miGap',
      'the assertions that ran')
  })
  runCase('the either-sign check fires on a wrong value and accepts both signs', () => {
    expectEqual(failsWith(() => expectOneOf('12.4', ['-1.2', '+1.2'], 'x')) === null, false, 'a wrong value was accepted')
    expectEqual(failsWith(() => expectOneOf('-1.2', ['-1.2', '+1.2'], 'x')), null, 'the minus form')
    expectEqual(failsWith(() => expectOneOf('+1.2', ['-1.2', '+1.2'], 'x')), null, 'the plus form')
  })
  runCase('both students with every number: rule 1 and rule 2', () => {
    expectNone(r1('bothPresent'), 'rule 1')
    if (refsOf('bothPresent').some(r => r.missing && /pfHandicap|dnaMi|rosterRows\[\]\.hcp/.test(r.field) && !/no student selected/.test(r.where))) throw new Error('every number of both students should be present')
    expectNone(r2('bothPresent'), 'rule 2')
  })

  // ── each number missing alone, the rest present ─────────────────────────────────────────────
  // Targets print without a decimal place today (String(t), page line 5409), and several expected texts in this
  // file ('6', '8', '4', '+2', and the like) pin that. A deliberate change to that format means updating those texts.
  const assertDistinct = items => {
    const seen = {}
    items.forEach(it => {
      const x = Number(it[0])
      if (seen[x] !== undefined) throw new Error('the number ' + x + ' appears twice: ' + seen[x] + ' and ' + it[1])
      seen[x] = it[1]
    })
  }
  const rowNumbers = (p, tag, hasSeries) => {
    const items = []
    if (p.hcp !== null) items.push([p.hcp, tag + ' hcp'])
    if (p.target !== null) items.push([p.target, tag + ' target'])
    if (hasSeries) p.sg.forEach((v, i) => items.push([v, tag + ' sg ' + i]))
    Object.keys(p.hist).forEach(k => { if (p.hist[k] !== null) items.push([p.hist[k], tag + ' hist ' + k]) })
    const mi = p.dna.mi
    if (mi.handicap !== null) items.push([mi.handicap, tag + ' mi.handicap'])
    if (mi.value !== null) items.push([mi.value, tag + ' mi.value'])
    if (mi.range !== null) { items.push([mi.range[0], tag + ' mi.range 0']); items.push([mi.range[1], tag + ' mi.range 1']) }
    if (mi.gap !== null) items.push([mi.gap, tag + ' mi.gap'])
    return items
  }
  const coachNumbers = d => {
    const items = [[d.me.hcp, 'me.hcp'], [d.me.target, 'me.target']]
    d.roster.forEach(p => rowNumbers(p, p.n, true).forEach(it => items.push(it)))
    return items
  }
  const playerNumbers = d => rowNumbers(d.meRow, 'meRow', false)
  // how many inputs a person's data lacks: the handicap, the target, the series, the intake's handicap, the mechanics
  // gap (only when the handicap is there: without a handicap the gap goes with it), the history (whole or one lookback)
  const inputsMissing = (p, hasSeries) => [
    p.hcp === null, p.target === null, hasSeries && p.sg.length === 0,
    p.dna.mi.handicap === null, p.dna.mi.handicap !== null && p.dna.mi.gap === null,
    Object.keys(p.hist).length === 0 || Object.keys(p.hist).some(k => p.hist[k] === null),
  ].filter(Boolean).length
  const steps = []
  const step = (name, fn) => { fn(); steps.push(name) }
  runCase('the distinct-numbers check bites: a repeated number in the series, the target, a history value, the mechanics value, range or gap is seen', () => {
    const clone = o => JSON.parse(JSON.stringify(o))
    expectEqual(failsWith(() => assertDistinct(coachNumbers(datas.eachMissing))), null, 'the real set is distinct')
    const edits = {
      sg: w => { w.roster[1].sg[0] = w.roster[0].target },
      target: w => { w.roster[0].target = w.roster[2].hcp },
      hist: w => { w.roster[1].hist.m3 = w.roster[0].hist.m6 },
      'mi.value': w => { w.roster[1].dna.mi.value = w.roster[0].dna.mi.value },
      'mi.range': w => { w.roster[2].dna.mi.range[0] = w.roster[0].dna.mi.value },
      'mi.gap': w => { w.roster[0].dna.mi.gap = w.roster[1].hcp },
    }
    Object.keys(edits).forEach(k => {
      const w = clone(datas.eachMissing)
      edits[k](w)
      if (!failsWith(() => assertDistinct(coachNumbers(w)))) throw new Error('a repeated number in ' + k + ' was not seen')
    })
    const pc = clone(datas.playerNoY10)
    pc.meRow.dna.mi.value = pc.meRow.hist.m3
    if (!failsWith(() => assertDistinct(playerNumbers(pc)))) throw new Error('a repeated number in a player set was not seen')
  })
  const checkCoachSet = (set, expectStudents) => {
    steps.length = 0
    const d = datas[set]
    step('rule 1', () => expectNone(r1(set), 'rule 1'))
    step('rule 2', () => expectNone(r2(set), 'rule 2'))
    step('distinct', () => assertDistinct(coachNumbers(d)))
    step('one input missing per student', () => expectEqual(d.roster.map(p => inputsMissing(p, true)).join(','), d.roster.map(() => '1').join(','), 'inputs missing per student'))
    step('carries', () => d.roster.forEach(p => { if (!p.tier || !p.file.limits || !p.dna || !p.notes.length) throw new Error(p.n + ' must carry a tier, interview answers, a scored intake and a note') }))
    expectEqual(steps.join('|'), 'rule 1|rule 2|distinct|one input missing per student|carries', 'the checks that ran')
    expectEqual(d.roster.length, expectStudents, 'the students in the set')
  }
  runCase('each number missing alone: rule 1, rule 2, and the data set holds what it claims', () => checkCoachSet('eachMissing', 6))
  runCase('each number missing alone: the one missing field shows its empty text and the fields beside it show their own values', () => {
    const res = runs.eachMissing
    const rowOf = n => res.roster.rosterRows.filter(r => r.name === n)[0]
    const fileOf = n => res.profiles.filter(p => p.kind === 'student' && p.student.n === n)[0].out
    const hist = (i, no10) => [0, 1, 2, 3, 4, 5].map(j => (no10 && j === 5 ? 'NA' : (30.4 + i * 6 + j).toFixed(1)))
    // hand-written from what the page prints: hcpLabel 3179 (a handicap, one decimal), String(target) 5409, fmtSG 3176 for the
    // strokes-gained now and change (5679, 5686), String(mi.handicap) 5343, the signed mi.gap 5344, pfHist 5436. Student D's
    // intake has no handicap, so its mechanics gap is missing with it (the 'none' shape, see dna()).
    const expected = [
      { n: 'ZZTEST-A', row: ['—', '+1.1', '+1.0'], real: '—', target: '3.1', miHcp: '21.7', miGap: '+1.3', hist: hist(0) },
      { n: 'ZZTEST-B', row: ['12.2', '+2.2', '+2.0'], real: '12.2', target: '—', miHcp: '22.8', miGap: '+2.4', hist: hist(1) },
      { n: 'ZZTEST-C', row: ['13.3', '—', '—'], real: '13.3', target: '6.2', miHcp: '23.9', miGap: '+3.6', hist: hist(2) },
      { n: 'ZZTEST-D', row: ['14.4', '+3.3', '+4.0'], real: '14.4', target: '7.4', miHcp: '—', miGap: '—', hist: hist(3) },
      { n: 'ZZTEST-E', row: ['15.5', '+5.5', '+5.0'], real: '15.5', target: '8.6', miHcp: '25.4', miGap: '—', hist: hist(4) },
      { n: 'ZZTEST-F', row: ['16.6', '+7.7', '+6.0'], real: '16.6', target: '9.1', miHcp: '26.3', miGap: '+6.9', hist: hist(5, true) },
    ]
    // every assertion that runs is recorded, and the count of students and checks is what is compared
    const done = []
    let students = 0
    const chk = (label, fn) => { fn(); done.push(label) }
    expected.forEach(e => {
      students++
      const r = rowOf(e.n)
      const o = fileOf(e.n)
      chk(e.n + ' row handicap', () => expectEqual(r.hcp, e.row[0], e.n + ' roster handicap'))
      chk(e.n + ' row strokes gained', () => expectEqual(r.sg, e.row[1], e.n + ' roster strokes gained'))
      chk(e.n + ' row change', () => expectEqual(r.delta, e.row[2], e.n + ' roster change'))
      chk(e.n + ' real', () => expectEqual(o.pfHandicapReal, e.real, e.n + ' pfHandicapReal'))
      chk(e.n + ' target', () => expectEqual(o.pfHandicapTarget, e.target, e.n + ' pfHandicapTarget'))
      chk(e.n + ' miHcp', () => expectEqual(o.dnaMiHcp, e.miHcp, e.n + ' dnaMiHcp'))
      chk(e.n + ' miGap', () => expectEqual(o.dnaMiGap, e.miGap, e.n + ' dnaMiGap'))
      chk(e.n + ' hist', () => expectEqual(o.pfHist.map(h => h.value).join(' '), e.hist.join(' '), e.n + ' history values'))
    })
    // the coach's own numbers are not shown on a student
    const none = res.profiles.filter(p => p.kind === 'none')[0].out
    chk('none real', () => expectEqual(none.pfHandicapReal, '—', 'no student selected, handicap'))
    chk('none target', () => expectEqual(none.pfHandicapTarget, '—', 'no student selected, target'))
    expectEqual(students, 6, 'the students asserted')
    expectEqual(done.length, 6 * 8 + 2, 'the assertions that ran')
  })

  // ── the whole history missing (hist: {}, what the server sends today), everything else present ──
  runCase('coach, the whole history missing: rule 1, rule 2, and the set holds what it claims', () => checkCoachSet('coachEmptyHist', 1))
  runCase('coach, the whole history missing: six history values, the history note and the intake form fields show their empty text; the rest shows its own values', () => {
    const res = runs.coachEmptyHist
    const r = res.roster.rosterRows[0]
    const o = res.profiles.filter(p => p.kind === 'student')[0].out
    const done = []
    const chk = (label, fn) => { fn(); done.push(label) }
    chk('row', () => expectEqual([r.hcp, r.sg, r.delta].join(' '), '12.2 +2.2 +2.0', 'roster row'))
    chk('real', () => expectEqual(o.pfHandicapReal, '12.2', 'pfHandicapReal'))
    chk('target', () => expectEqual(o.pfHandicapTarget, '6.2', 'pfHandicapTarget'))
    chk('miHcp', () => expectEqual(o.dnaMiHcp, '22.8', 'dnaMiHcp'))
    chk('miGap', () => expectEqual(o.dnaMiGap, '+2.4', 'dnaMiGap'))
    chk('hist', () => expectEqual(o.pfHist.map(h => h.value).join(' '), 'NA NA NA NA NA NA', 'history values'))
    chk('note', () => expectEqual(o.pfHistNote, 'No handicap on record.', 'history note'))
    chk('form', () => expectEqual(res.intake.inHist.map(h => h.value).join('|'), '|||||', 'the intake form history fields'))
    expectEqual(done.join(','), 'row,real,target,miHcp,miGap,hist,note,form', 'the assertions that ran')
  })

  // ── a player's own file, each number missing alone ──────────────────────────────────────────
  // Expected texts, hand-written from what the page prints on a player's own file: hcpLabel (3179) of
  // 9.1, String(4.3) (5409), String(mi.handicap) (5343), the signed gap (5344), pfHist (5436), pfHistNote (5451).
  // Page state: the script's fresh page seeds `realHcp` and `targetHcp` from `me.hcp` and `me.target`
  // (3291-3298), and the player's branches (4866, 5404) read that state first and `meRow` second. So a
  // data set reaches both: a present `me` number is read through the state, a missing one falls to
  // `meRow`. The script never sets state typed since load (README: not covered).
  const HIST_TEXTS = ['30.4', '31.4', '32.4', '33.4', '34.4', '35.4']
  const NA6 = ['NA', 'NA', 'NA', 'NA', 'NA', 'NA']
  const playerEachCases = [
    ['playerNoHcp', 'the handicap', { real: DASH, target: '4.3', miHcp: '21.7', miGap: '+1.3', hist: HIST_TEXTS }],
    ['playerNoTarget', 'the target', { real: '9.1', target: DASH, miHcp: '21.7', miGap: '+1.3', hist: HIST_TEXTS }],
    ['playerNoMiHcp', 'the intake handicap (the mechanics gap goes with it)', { real: '9.1', target: '4.3', miHcp: DASH, miGap: DASH, hist: HIST_TEXTS }],
    ['playerNoMiGap', 'the mechanics gap', { real: '9.1', target: '4.3', miHcp: '21.7', miGap: DASH, hist: HIST_TEXTS }],
    ['playerNoY10', 'the ten-year history lookback', { real: '9.1', target: '4.3', miHcp: '21.7', miGap: '+1.3', hist: HIST_TEXTS.slice(0, 5).concat(['NA']) }],
    ['playerEmptyHist', 'the whole history', { real: '9.1', target: '4.3', miHcp: '21.7', miGap: '+1.3', hist: NA6, note: 'No handicap on record.', form: true }],
  ]
  const playerAsserted = []
  playerEachCases.forEach(pc => {
    const set = pc[0]
    runCase('player, ' + pc[1] + ' missing alone: rule 1, rule 2, and the set holds what it claims', () => {
      steps.length = 0
      const d = datas[set]
      step('rule 1', () => expectNone(r1(set), 'rule 1'))
      step('rule 2', () => expectNone(r2(set), 'rule 2'))
      step('distinct', () => assertDistinct(playerNumbers(d)))
      step('one input missing', () => expectEqual(inputsMissing(d.meRow, false), 1, 'inputs missing'))
      step('carries', () => {
        const m = d.meRow
        if (!m.tier || !m.file.limits || !m.dna || !m.notes.length) throw new Error('the set must carry a tier, interview answers, a scored intake and a note')
      })
      expectEqual(steps.join('|'), 'rule 1|rule 2|distinct|one input missing|carries', 'the checks that ran')
    })
    runCase('player, ' + pc[1] + ' missing alone: the missing field shows its empty text and the fields beside it show their own values', () => {
      const o = runs[set].profiles[0].out
      const e = pc[2]
      const done = []
      const chk = (label, fn) => { fn(); done.push(label) }
      chk('real', () => expectEqual(o.pfHandicapReal, e.real, 'pfHandicapReal'))
      chk('target', () => expectEqual(o.pfHandicapTarget, e.target, 'pfHandicapTarget'))
      chk('miHcp', () => expectEqual(o.dnaMiHcp, e.miHcp, 'dnaMiHcp'))
      chk('miGap', () => expectEqual(o.dnaMiGap, e.miGap, 'dnaMiGap'))
      chk('hist', () => expectEqual(o.pfHist.map(h => h.value).join(' '), e.hist.join(' '), 'history values'))
      if (e.note) chk('note', () => expectEqual(o.pfHistNote, e.note, 'history note'))
      if (e.form) chk('form', () => expectEqual(runs[set].intake.inHist.map(h => h.value).join('|'), '|||||', 'the intake form history fields'))
      expectEqual(done.length, 5 + (e.note ? 1 : 0) + (e.form ? 1 : 0), 'the assertions that ran')
      playerAsserted.push(set)
    })
  })
  runCase('every player set was asserted (the six of the list, none skipped)', () => {
    expectEqual(playerAsserted.join(','), 'playerNoHcp,playerNoTarget,playerNoMiHcp,playerNoMiGap,playerNoY10,playerEmptyHist', 'the player sets asserted')
  })

  // ── a coach with their own numbers, and a student with none ──────────────────────────────────
  runCase('coach with own handicap and target, one student with neither: rules 1 and 2, and nothing of the coach\'s is shown on the student', () => {
    expectNone(r1('coachOwn'), 'rule 1')
    expectNone(r2('coachOwn'), 'rule 2')
    const res = runs.coachOwn
    const a = res.profiles.filter(p => p.kind === 'student' && p.student.n === 'ZZTEST-A')[0].out
    const b = res.profiles.filter(p => p.kind === 'student' && p.student.n === 'ZZTEST-B')[0].out
    const none = res.profiles.filter(p => p.kind === 'none')[0].out
    expectEqual(a.pfHandicapReal, DASH, 'A handicap')
    expectEqual(a.pfHandicapTarget, DASH, 'A target')
    expectEqual(b.pfHandicapReal, '7.0', 'B handicap')
    expectEqual(b.pfHandicapTarget, '4', 'B target')
    expectEqual(none.pfHandicapReal, DASH, 'no student selected, handicap')
    expectEqual(none.pfHandicapTarget, DASH, 'no student selected, target')
    expectEqual(res.roster.rosterRows.filter(r => r.name === 'ZZTEST-A')[0].hcp, DASH, 'A roster handicap')
    if (!(res.data.me.hcp === '5.0' && res.data.me.target === '3.0')) throw new Error('the coach must carry own numbers in this set')
  })

  // ── rows in another order than the roster ────────────────────────────────────────────────────
  runCase('reordered: the page renders the rows in another order than the roster, and rule 2 passes', () => {
    const res = runs.reordered
    expectEqual(res.rowIds.join(','), 'zz-test-2,zz-test-1', 'the ids the rows open, in render order')
    expectEqual(res.roster.rosterRows[0].name, 'ZZTEST-B', 'first rendered row')
    expectEqual(res.roster.rosterRows[0].hcp, '4.2', 'its handicap')
    expectEqual(res.roster.rosterRows[1].hcp, DASH, 'the other row')
    expectNone(r1('reordered'), 'rule 1')
    expectNone(r2('reordered'), 'rule 2')
  })
  runCase('rows that open each other\'s students are refused, naming the fault (and rule 2 catches them on the reordered set)', () => {
    const c = plainResult(runs.missing)
    c.rowIds = ['zz-test-2', 'zz-test-1']
    const e = failsWith(() => rule2Refs(c))
    if (!e || e.indexOf('shows one student but opens another') === -1) throw new Error('a swap was not named: ' + e)
    const d = plainResult(runs.reordered)
    d.rowIds = ['zz-test-1', 'zz-test-2']
    if (!failsWith(() => rule2Refs(d))) throw new Error('rows swapped on the reordered set were accepted')
  })

  // ── the history ──────────────────────────────────────────────────────────────────────────────
  runCase('a history with only the three-month value is not treated as wholly missing', () => {
    const refs = refsOf('m3Only').filter(r => /pfHistNote$/.test(r.field) && /roster\[0\]/.test(r.where))
    if (refs.length !== 1 || refs[0].missing) throw new Error('the m3-only history was taken as wholly missing')
    const m3 = refsOf('m3Only').filter(r => /pfHist\[\]\.value$/.test(r.field) && /roster\[0\]/.test(r.where))
    if (m3.length !== 6 || m3[0].missing || !m3.slice(1).every(r => r.missing)) throw new Error('only the m3 lookback should be present')
    expectNone(r2('m3Only'), 'rule 2')
  })
  runCase('a player\'s own history, present in the data, is read', () => {
    const refs = refsOf('playerHist').filter(r => /pfHist\[\]\.value$/.test(r.field))
    if (refs.length !== 6) throw new Error('expected six lookbacks')
    expectEqual(refs.map(r => r.missing).join(','), 'false,false,false,false,true,true', 'which lookbacks are present')
    expectEqual(runs.playerHist.profiles[0].out.pfHist[0].value, '12.4', 'the page prints the player\'s own m3')
    expectNone(r2('playerHist'), 'rule 2')
    const note = refsOf('playerHist').filter(r => /pfHistNote$/.test(r.field))[0]
    if (note.missing) throw new Error('a player with a history was taken as having none')
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
        const hits = rule1(c).filter(f => f.where === 'rosterVals().rosterRows[0].name' && f.token === w)
        if (!hits.length) throw new Error('rule 1 did not report ' + JSON.stringify(text))
      })
    })
  })
  ;[['+0.0', 'a signed 0.0'], ['+0', 'a signed 0'], ['0.0', 'an unsigned 0.0']].forEach(pair => {
    runCase('negative: a table field holding ' + pair[0] + ' for a missing input is reported by rule 2 (every field in the table)', () => {
      RULE2_TABLE.forEach(t => {
        const c = missingCopy()
        const targets = rule2Refs(c).filter(r => r.field === t.field)
        if (!targets.length) throw new Error('no value collected for ' + t.field)
        targets.forEach(r => {
          const c2 = missingCopy()
          const r2x = rule2Refs(c2).filter(x => x.where === r.where)[0]
          if (!r2x.missing) throw new Error(r2x.where + ' should have a missing input')
          r2x.container[r2x.key] = pair[0]
          const faults = rule2(c2).filter(f => f.where === r.where)
          if (!faults.length) throw new Error('rule 2 did not report ' + pair[0] + ' in ' + r.where + ' (' + pair[1] + ')')
        })
      })
    })
  })
  runCase('negative: +0.0 in a string outside the table, every number missing, is reported by rule 3', () => {
    const c = missingCopy()
    c.roster.rosterBlurb = 'Sorted +0.0'
    expectNone(rule2(c), 'rule 2 (the string is outside its table)')
    expectSome(rule3(c), 'rule 3')
  })
  runCase('positive: +0.0, -0.0 and +0.5 from present inputs are not reported', () => {
    const c = plainResult(runs.present)
    const texts = allStrings(c).map(s => s.text)
    ;['+0.0', '-0.0', '+0.5'].forEach(t => { if (texts.indexOf(t) === -1) throw new Error(t + ' is not in the present-numbers output') })
    expectNone(rule1(c), 'rule 1')
    expectNone(rule2(c), 'rule 2')
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
        const hits = rule1(c).filter(f => f.where === where && f.token === w)
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
      runs[k].data.roster.forEach(p => {
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
    const checked = []
    Object.keys(datas).forEach(k => {
      checked.push(k)
      savedChecks(datas[k], scriptSrc).forEach(c => {
        const e = failsWith(c.run)
        if (e) throw new Error(k + ': ' + c.name + ' failed: ' + e)
      })
    })
    expectEqual(checked.join(','), Object.keys(DATA).join(','), 'the built-in sets run through the saved-data function')
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

  // ── the saved-data run refuses a file that is not the dashboard's data (outside review) ─────────
  const savedOpts = text => ({ dataText: text, page: opts.page, pageArg: opts.pageArg })
  runCase('saved data: a file with no roster list is refused by the script\'s own line, which does not quote the file', () => {
    const marker = 'ZZMARKERWORD'
    const bad = [
      '{"zz":"' + marker + '","n":1}', '{}', '{"roster":"' + marker + '"}', '{"roster":5}',
      '{"roster":null}', '{"roster":true}', '{"roster":{"a":"' + marker + '"}}',
    ]
    bad.forEach(text => {
      ;[() => parseSavedData(text), () => loadSavedChecks(savedOpts(text))].forEach(run => {
        const e = failsWith(run)
        if (!e) throw new Error('a file with no roster list was accepted: ' + text.slice(0, 40))
        if (e.indexOf('holds no roster list') === -1) throw new Error('refused, but not by the roster rule: ' + e)
        if (e.indexOf(marker) !== -1) throw new Error('the refusal quotes the file: ' + e)
      })
    })
  })
  runCase('saved data: a roster list that holds an entry that is not an object is refused by the script\'s own line', () => {
    const marker = 'ZZMARKERWORD'
    ;['[1,2]', '[null]', '[[]]', '["' + marker + '"]', '[true]', '[{"id":"zz1"},"' + marker + '"]'].forEach(list => {
      const text = '{"roster":' + list + '}'
      ;[() => parseSavedData(text), () => loadSavedChecks(savedOpts(text))].forEach(run => {
        const e = failsWith(run)
        if (!e) throw new Error('a roster list with a non-object entry was accepted: ' + list)
        if (e.indexOf('holds an entry that is not an object') === -1) throw new Error('refused, but not by the entry rule: ' + e)
        if (e.indexOf(marker) !== -1) throw new Error('the refusal quotes the file: ' + e)
      })
    })
    parseSavedData('{"roster":[{}]}')
  })
  runCase('saved data: { "roster": [] } is accepted, and the two saved-data checks run and pass on it', () => {
    const data = parseSavedData('{"roster":[]}')
    expectEqual(Array.isArray(data.roster) && data.roster.length === 0, true, 'the parsed no-students file')
    const checks = loadSavedChecks(savedOpts('{"roster":[]}'))
    expectEqual(checks.length, 2, 'the saved-data checks')
    checks.forEach(c2 => { const e = failsWith(c2.run); if (e) throw new Error(c2.name + ' failed: ' + e) })
  })
  runCase('saved data: every built-in set, written out as text and read back through the same function, is accepted', () => {
    const names = Object.keys(DATA)
    names.forEach(k => {
      const back = parseSavedData(JSON.stringify(DATA[k]()))
      if (!Array.isArray(back.roster)) throw new Error(k + ' lost its roster')
    })
    expectEqual(names.length >= 20, true, 'the built-in sets read back')
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
