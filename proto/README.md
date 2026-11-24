# Luke's prototype — the working copy

**This directory is the WORKING copy. The pristine original stays at**
`~/Desktop/ATR/websites/atlas/handoff/Golf coaching website project/` **and is never edited.**

`Dashboard.dc.html` was committed here **unmodified first**, so `git log -p proto/` is the reference:
the diff between that first commit and now is exactly what was stripped and what replaced it. There
is no separate "original" file to drift out of sync.

## What is being done to it

The prototype hardcodes ~70 data literals. They are being replaced, one at a time, with reads from a
single injected blob:

```js
const ROSTER = window.__ATLAS_DATA__?.roster ?? []
```

The server (`server/routes/proto.ts`) builds `__ATLAS_DATA__` from `ryp-core` and injects it as one
`<script>` before the file's own scripts run.

**Why one blob and not string substitution.** The first version regex-replaced keys inside his
literals in memory. It worked, but each literal needed its own fragile pattern, and it failed silently
in a way that mattered: overrides were emitted *before* his keys, so his values won and a real student
rendered carrying another player's handicap. One declared injection point makes the file state what it
needs, and makes missing data render as empty rather than as someone else's sample.

## The rule

**A stripped literal must never fall back to sample data.** `?? []` and `?? null`, never `?? {his
original}`. A screen with no data should look empty, because the alternative is a screen that looks
live and isn't — and that is the failure mode this whole approach exists to avoid.

`support.js` is his framework, unmodified and not ours to change.

---

## State as of 2026-08-31 — ROSTER is live, and nothing else is

`ROSTER` is the only literal stripped so far. It is fed end to end: `/proto/dashboard` reads the
signed-in coach's students through `withRls` on the ordinary pool (no bypass) and injects them.

**Live in the served page** — name, handicap index, driver carry, handedness *where recorded*, and
the coaching-relationship status line. That is five fields of his ~20-field roster row.

**Empty, because no producing app exists** — `sg`, `grid`, `read`, `note`, `tone`, `leak` (Forge, not
shipped); `tier`, `zone`, `target`, `days`, `answer`, `est`, `file.*` (no table); `hist` (the table
exists, but nothing has ever written a historical row). 44 of the 81 metrics these screens display
are Forge's. **Most of this page going quiet is the correct outcome, not a regression.**

Two things were also fixed here and are worth knowing about:

- `data-props`' `playerName` default was a sample name, and `support.js` hydrates `this.props` from
  that JSON default — so the inline `?? 'sample'` fallback was dead code and the sample name was
  *always* what a served page showed. It now reads `__ATLAS_DATA__.me.name`.
- The Intake form pre-filled a new player's six handicap-lookback fields from `ROSTER[0]` — an
  arbitrary *other real student* — and persisted all six into that player's own state on the first
  edit. Same cross-player contamination the rule above is about, already in the code. Now `{}`.

## Empty-value guards, and why they were unavoidable

His render calls `.toFixed(1)` and `.split()` on roster fields unconditionally, and `rosterVals()`,
`profileVals()` and `intakeVals()` are all spread into the single `vals()` return on **every** render
regardless of the current view. So a single field arriving empty threw a `TypeError` and blanked the
entire document on every screen. Empty was not a survivable state.

The choice was: fabricate a value (`sg: [0,0,0,0,0]` renders "+0.0 · flat across five reads" — a
strokes-gained claim about reads that do not exist), or guard. Guarding strips no literal and adds no
data. Every guard renders `'—'` or drops the phrase; **none substitutes a number.** They carry
`GUARDED:` comments so `git log -p proto/` still reads as the full account.

The worst of the un-guarded outcomes, for the record: `target: null` reached
`t <= 0 ? ... '+' + Math.abs(t)`, and `null <= 0` is `true` in JS with `Math.abs(null) === 0` — so a
real student's target handicap printed as **`+0`**, a fabricated plus-handicap of scratch,
indistinguishable from a real figure. Not a crash, which is why it needed looking for.

Also honest now: `pfTestStatus` was hardcoded to "Ten shots filmed · read complete" for every
non-self player, so opening any real student asserted a coaching read that does not exist. It now
asks whether `read` has anything in it, which switches on the empty state his own code already had.

## Known, unfixed, and deliberately so

- **The `self` / own-file branch is unreachable.** `profileVals` decides "is this me?" with
  `who.id === 'hale'`, a sample slug no real uuid can match, and `profileOf` defaults to it. A coach
  opening the profile screen therefore lands on `ROSTER[0]` — real data under the right name, but an
  arbitrary student. Wiring this needs a product decision about what "self" means here (see
  `~/Desktop/ATR/pipeline/05-contract-roster.md` §4); guessing is how the wrong player becomes "you".
- **The `self` branches still contain sample literals** (`'265 yd driver carry'`, `11.4`,
  `'Day 41 of 90'`). Unreachable today, per the above. They must go when `self` becomes reachable.
- **`grid: []` renders zero strike-map cells**, so the 3×3 box collapses rather than showing nine
  visibly-empty cells. Empty, not wrong — a layout gap, not a data lie.
- **`/proto/support.js` is an allowlisted single route, not `express.static(PROTO_DIR)`.** Do not
  turn it back into a directory mount. Measured against the running server: a `.dc.html` → 404 filter
  in front of a static mount is bypassable — Express does not percent-decode `req.path` but
  `express.static` resolves the decoded form, so `/proto/Dashboard%2Edc%2Ehtml` returned **200**, the
  raw stripped file with no blob and no banner, to anyone with the URL and no session. The mount also
  served this README (200) to the public internet. `support.js` is the only local asset his page
  loads, so an allowlist costs nothing and makes both holes unreachable by construction.

## Two more guards, added after the above

- **Roster row `tier · zone` line.** The markup joined `p.tier` and `p.zone` with a literal `' · '`;
  a student with no tier or no zone assigned yet showed bare punctuation (`' · '`, or `'Zone '` with
  nothing after it). `rosterRows` now pre-joins into a single `meta` field
  (`[p.tier, p.zone ? 'Zone ' + p.zone : ''].filter(Boolean).join(' · ')`), same idiom as `pfMeta`
  above it, and the markup binds to that one field instead of two.
- **Intake NA toggle conflated "never answered" with "marked not playing."** `inHist` computed one
  `na` boolean from `v === null || v === undefined`, so a brand-new player's untouched form opened
  already asserting `naLabel: 'Not playing'` for all six lookback periods — the toggle-button text
  claimed a decision the player hadn't made. `null` (set only by clicking the toggle) and
  `undefined` (nothing typed yet) are now distinguished: `naLabel` reads `'Not playing'` only for
  the explicit `null`, `'Mark NA'` (an invitation, not a claim) for the untouched blank.

## Verifying it

Sign in as the demo coach, POST `/api/session`, GET `/proto/dashboard` with the cookie. Grep alone is
not enough — it passes while the page throws on first paint. Save the injected data to a file (it is the object after `window.__ATLAS_DATA__ =` in the `<script>` tag
the server writes before the page's own first script; the server writes `<` in it as `\u003c`, so parse the value
as JSON and do not copy it by eye) and run
`node scripts/protoValues.test.js --data <file>`: it runs his *actual* inline script against it (`class Component`
in a `vm` context with `DCLogic` stubbed), calls `rosterVals()`, `profileVals()` and `intakeVals()`, and applies
rules 1 and 2 to every string they return. The three rules are:

- **Rule 1.** No output string contains `undefined`, `NaN` or `nulld`. A plain test, with no exception. Before
  the page runs, the script copies the injected data and, in the fields that carry text a person typed (display
  names, note and message bodies, interview answers, drill sign-off notes and video references), replaces each of those
  three words, whatever its case, by `(typed)`; every other
  string, and every key, is left as the data has it. The page runs on the copy. So a word the server wrote into any
  other field and the page prints is reported, and a typed-text field missing from the script's list that holds one
  of the words fails the check until it is added.
- **Rule 2.** Every output value built from a missing input is exactly that field's own empty text: `—` for a
  handicap, a target handicap or a strokes-gained number (missing means null, undefined, absent, or an empty
  strokes-gained series); `NA` for a handicap-history value; `No handicap on record.` for the history note when
  the whole history is missing; the form's blank (an empty text) for the intake form's history fields.
- **Rule 3.** With every number missing from the data, no output string holds a signed zero (`+0`, `-0`,
  `+0.0`, `-0.0`, with `-` or `−`) as a whole token: not preceded by a digit, not followed by a digit or by
  a point and a digit. So `+0.5`, `2026-09-07` and `+00:00` are not hits.

A `+0.0`, `-0.0` or `+0.5` that comes from present numbers is correct output and passes: a strokes-gained value
keeps its decimal place (owner's ruling, 2026-11-24). This check used to fail any output containing `+0`, which
rejected those.

The text alone cannot tell the two cases apart: `fmtSG(0.03)` and an unguarded `hcpLabel(null)` both print
`+0.0`. So the check is driven by the input.

`node scripts/protoValues.test.js` runs the three rules against built-in test data, with no database: the sets hold every number present, every number
missing, and each number missing alone with the rest present, for a coach looking at students and for a player looking
at their own file. The built-in run is a smoke check of the shapes those sets hold, and the sets are not the
server's data: a page that borrows a number from a field they do not carry passes it. With
`--data <file>` it runs rules 1 and 2 (rule 3 does not run there) against a saved copy of the injected data, for
the signed-in run described above; it checks whatever mix of present and missing numbers the real data holds, and
that run is the real check.

Repeat with `{ roster: [] }` for the coach-with-no-students case; the built-in run does this one, and `--data`
on that file does not run rule 3.

**What this check does not cover.**

- The handicap-history note when part of the history is missing (T-142).
- A change printed from a single strokes-gained read (T-143).
- Numbers that are not a handicap, a target, a strokes-gained or a handicap-history value, such as counts and days.
- Anything outside `rosterVals()`, `profileVals()` and `intakeVals()`.
- Output the page builds from what a person has typed into the page since it loaded (the intake form's entries, an
  unsaved target or handicap, a history typed in): the script never sets that state.
- The mechanics card's handicap for a plus player, which the page prints with a minus (T-144).
- A present number being the right one (the right student's, with its plus sign): it is asserted on the built-in
  data sets (the coach's students, the player's own file), and the saved-data run (`--data`) does not assert it.
- A fault inside a listed typed-text field's own text, and a word the page builds from pieces of typed text (the
  initials of a three-part name, for example).
