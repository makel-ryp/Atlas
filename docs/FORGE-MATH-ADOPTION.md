# FORGE scoring module — adoption plan

**Status:** proposal, awaiting Makel's sign-off on §3 and §4.
**Written:** 2026-10-06. Every number below was verified first-hand by running the code, not read
off a summary. Where this document contradicts `docs/FORGE-CONTEXT.md`, this one is newer and the
contradiction is called out in place.

**Subject:** `/Users/makelmackbee/Downloads/FORGE-package/build/forge-math.js` — 337 lines, pure,
dependency-free, clock-free. **23 exports** (not 22 — `grep -c '^export'` returns 23; the earlier
count missed one). Fixture file `build/forge-math.test.js`, 57 checks, one failing.

Baseline run, unmodified package:

```
$ node build/forge-math.test.js
FAIL  225 yd is half way 10→5
      expected 7.5
      actual   12.5

56 passed, 1 failed
```

---

## 0. What blocks the migration and what does not

The dividing line: **does it change table shape?** A wrong constant is recoverable as long as the
inputs are stored — you refit and recompute. A missing input column is not recoverable, because
backfill is impossible once the session is over. The Build Spec says this itself about `shots`:
*"Store it from day one — the volume is trivial and backfill is impossible."*

| 🔴 BLOCKS the migration (table shape) | ⚪ Does not block (a computed number, recomputable later) |
| --- | --- |
| **B1.** No **carry snapshot** on the driving facet row. `drivingIndex` reads `avg_carry_yds`, which the player can edit at any time. Without a snapshot, re-scoring an old session silently rewrites history. §2.1 | **N1.** The three-way `baselineHandicap(225)` conflict. Changes every driving index; changes no column. §3 |
| **B2.** No **gender column anywhere in eco.** `baselineHandicap(yards, gender)` selects between `CAL.carry.m` and `CAL.carry.f`. `golf.player_profile` has `handedness`, not gender; `identity.ts` has none. A scoring input with no home. §2.1 | **N2.** Which benchmark table is real. Display-only; feeds no stored column. §4 |
| **B3.** No **`scoring_version`** on the stored facet index. Several constants are GUESS and *will* be refitted. Precedent already exists in this codebase. §2.3 | **N3.** The facet weights, and the chipping/putting swap. The composite is derived-never-stored, so a wrong weight is a wrong pixel, not a wrong row. §5 |
| | **N4.** Every unfitted constant — `yardsPerShot`, the ATG set, `putt18`. §6 |
| | **N5.** Where the module lives, and the level/option tables moving into it. §1, §5.3 |
| | **N6.** `drivingIndex` counts only *left* big misses. A real defect the spec has already ruled on — but it is code, not shape, and `scoring_version` + stored `shots` make it recomputable. §2.5 |

B1–B3 are three columns. They are cheap now and impossible later. Everything in the right-hand
column can be decided after the tables exist, **provided** B1–B3 land.

---

## 1. Where it lives

### Decision: a new zero-dependency subpath export, `@ryp/eco/scoring`.

Not vendored into atlas, not left in place.

**Why it must be shared.** §6.1 specifies `POST /sessions/:id/complete` — *"Computes indices
server-side, evaluates ladder transitions and assignment completion, returns what changed."* That
settles where the **authoritative** number is computed, but not where the **only** number is
computed. The prototype shows a live index while the player scores, before any submit, and §6.3
forbids an offline queue while requiring *"local write-through on every tap"* — so the client is
holding and displaying a scored session that the server has not seen. The client must therefore
compute a preview. Two copies of the arithmetic means the preview and the committed number
disagree, which is the exact failure the spec calls *"plausible-but-wrong … not visible in QA."*
One module, imported by both, is the only arrangement where they cannot drift.

**Why eco and not atlas.** eco's own package description is *"The single source of truth every RYP
app imports."* Atlas is an app; the FORGE client is a different app; a server-side completion
endpoint is a third consumer. Vendoring into atlas would make the FORGE client depend on Atlas,
which inverts the dependency.

**Why a separate subpath and not the root.** This is the load-bearing constraint. `@ryp/eco`'s
root, `/db` and `/auth` entries pull `pg`, `firebase-admin` and `express` through peer
dependencies. The FORGE client is a browser PWA and cannot load any of them. The scoring module is
pure and imports nothing, so it gets its own entry with a clean graph:

```ts
// tsup.config.ts — add to entry
'scoring/index': 'src/scoring/index.ts',
```

```jsonc
// package.json — add to exports
"./scoring": {
  "types": "./dist/scoring/index.d.ts",
  "import": "./dist/scoring/index.js",
  "require": "./dist/scoring/index.cjs"
}
```

⚠️ `tsup.config.ts` sets `target: 'node20'` globally. The scoring entry must not inherit it — a
browser bundler should get `es2022`. Either split the config or set the target per entry.

**Port to TypeScript, don't `allowJs`.** eco runs `strict` with `noUncheckedIndexedAccess: true`.
That flag will reject the module's table indexing as written — `T[0][0]`, `T[i][0]`, `B[i - 1]`,
`zoneCentresYards[z]`, `p[0]` in `daysBetween` all become `T | undefined`. Those are not
ceremony: `zoneCentresYards[z]` genuinely returns `undefined` if a caller passes a zone index
outside 0–4, and the result propagates as `NaN` into a displayed handicap. The whole argument for
this module is that it is the one part that can be silently wrong, so it gets the stricter
compiler, not an escape hatch.

**eco has no test runner.** There is no `*.test.*` file in the repo and no `test` script. The
fixture file runs on bare node with no framework — that is a feature, and it becomes eco's first
test. Run it **against `dist`**, not against source, so it tests what actually ships:

```jsonc
"test": "npm run build && node scripts/scoring-fixtures.mjs"
```

**One consequence to accept.** Atlas installs eco as `"@ryp/eco": "file:vendor/ryp-eco-0.27.0.tgz"`
— a vendored tarball, not a registry install. So every scoring change requires re-vendoring the
tarball into each consumer. That is the cost already being paid for schema changes; scoring now
joins it. If a separate FORGE client repo is created, it consumes the same tarball the same way.
Worth noting as the first real argument for publishing eco to a private registry, but not a reason
to put scoring somewhere else.

---

## 2. What server-side scoring means for the schema

The governing principle is already written in this codebase, in `eco/src/schema/atlas.ts:198–213`
for `atlas.intake_submissions`:

> *"⚠️ THE RE-SCORE LIFELINE … Every raw item response, keyed by item code. The result is NEVER
> stored — it is recomputed by `computeResult()` from these on every read, which is what makes 'a
> stored run re-scores identically' true."*

Forge gets the same treatment. Store the inputs; recompute the outputs. The three columns below
are what Forge's spec is missing to make that true.

### 2.1 Inputs — stored, and the two snapshots the spec forgot

Spec §1 already stores most of what re-scoring needs, and it is well designed:

- `shots` — one row per ball: `shot_index`, `outcome_value`, `shape_call`, `target_yds`,
  `proximity`, `entry_method`. Spec: *"The prototype discards all of this at save, which blocks
  every analytics feature."*
- `putt18_holes` — `hole_index`, `distance_ft`, `putts`, `expected_putts`.
- `session_facets.level` — *"The level as played. Never restated when the player promotes —
  historic sessions keep the level they were scored at, or every trend lies."* This is exactly
  right and it already closes the `base`/`slope` snapshot problem for the head-scored facets.
- `session_facets.raw_total`, `shot_count`, `holes_played`, `mode`, `meta`.

🔴 **What is missing — and it is only missing for driving.** `drivingIndex(zones, averageYards,
gender)` depends on two values that live on the mutable player row and are snapshotted nowhere:

| Input | Lives on | Why a snapshot is required |
| --- | --- | --- |
| `avg_carry_yds` | the player row (spec §1), i.e. `golf.player_profile.driver_carry_yds` | The player edits it from `PUT /me/profile` (§6.1). Re-scoring a June session in December uses December's carry. `baselineHandicap` is added **directly** into the driving index, so a 20-yard carry edit moves every historic driving index by ~5 strokes. |
| `gender` | **nowhere** | Selects `CAL.carry.m` vs `CAL.carry.f`. 205 yd reads **18.3** as a man and **10.0** as a woman — **8.3 strokes**. |

The spec's own rationale for snapshotting `level` applies verbatim: *"or every trend lies."* Carry
is the same kind of value and got the same treatment nowhere.

**Fix (B1 + B2), two columns on the driving facet row** — not in `meta`, because `meta` is
untyped jsonb and these are scoring inputs that a re-score must not have to guess at:

```
carry_yds_at_play   integer   null    -- snapshot of driver_carry_yds when this facet was scored
gender_at_play      text      null    -- 'm' | 'f'; selects the carry table. Text + const, not an enum.
```

Null is honest for a session scored before the player supplied a carry — `baselineHandicap`
already returns 30 for a falsy input.

**And B2 has a second half: eco needs a gender column at all.** Grep confirms none exists —
`golf.player_profile` has `handedness` (which is not a proxy; a left-handed man and a woman select
different tables for different reasons) and `identity.ts` has nothing. Add to
`golf.player_profile`, alongside `handedness`, following the existing convention:

```
gender   text   -- 'm' | 'f'. Selects the carry→handicap table (Forge §2.3). Text + const, never a pg enum.
```

It belongs in `golf.*` by the placement rule — it is a shared golf attribute another app reads,
and it sits next to `handicap_index`, `driver_carry_yds` and `handedness` which are already there.

⚠️ **Do not add `avg_carry_yds` as a new column.** `golf.player_profile.driver_carry_yds` already
exists and is the same quantity. Forge's `players.avg_carry_yds` maps onto it.

### 2.2 Outputs — exactly one is stored

| Value | Stored? | Why |
| --- | --- | --- |
| `session_facets.index_value` | ✅ **stored** | The spec stores it and that is correct: the ladder, trends and assignment completion all read it, and recomputing 100 sessions on every dashboard load is not viable. It is the one *modelled* value that earns a column — which is precisely why it needs §2.3. |
| `session_facets.is_complete` | ✅ **stored** | Spec: *"Computed on write per §3.4. Every consumer reads this flag rather than re-deriving a threshold."* Completeness is per-drill (20 shots, or 18 holes for Putt 18), so deriving it at read time means every consumer re-implements §3.4. |
| `putt18_holes.expected_putts` | ✅ **stored** | Spec says *"Stored, not recomputed on read."* Agreed — it is a function of `expPutts`, which is a tunable; storing it freezes the hole against a later refit. |

### 2.3 🔴 `scoring_version` — B3

`index_value` and `expected_putts` are stored *modelled* values computed from constants that
**are documented as not yet fitted** (§6). When `putt18.k` is refitted, every stored putting index
was computed under the old one and there is no way to tell which. The composite silently mixes
two calibrations.

The precedent is in this repo, `eco/src/schema/atlas.ts:208–213`, and its comment is the argument:

> *"NOT NULL with NO DEFAULT on purpose: a database default would let a mis-wired route record a
> run stamped with a version it was not actually scored under, which is worse than a failed
> insert."*

Add to `session_facets`:

```
scoring_version   text   not null    -- no default. Stamped by the server from the imported
                                     -- module constant on every scoring pass. e.g. 'forge-2026.10-1'
```

This also satisfies the standing rule that **a scoring change needs a version bump** — the same
rule Atlas's DNA fork already operates under.

### 2.4 Never stored — recomputed on every read

| Value | Function | Why never |
| --- | --- | --- |
| The composite / practice handicap | `practiceHandicap` | Spec READ-THIS-FIRST rule 1: *"The composite index is derived, never stored. Persist facet indices only; recompute the composite on read. Two copies will drift."* |
| The current picture | `currentFacet` / `currentPicture` | A median over a rolling window with half-life weighting. Its value changes **with no new data**, purely because time passed and a score aged out or went stale. A stored copy is wrong by tomorrow. |
| Strokes gained | `facetStrokesGained` / `totalStrokesGained` | A pure function of (facet index, target handicap). The target is editable; storing SG means an edited target leaves stale SG everywhere. |
| Benchmark comparison | `benchmarkAt` | Pure display, and §4 shows the table itself is wrong. Storing it would bake the error into rows. |
| Dispersion / bias cost | `dispersion` | A function of the stored `shots` rows and `yardsPerShot`, which is a **GUESS** awaiting a refit. |

### 🔴 2.5 Two module defects to fix while porting, both found while checking the above

**(a) `drivingIndex` only counts half the big misses — and the spec has already ruled on it.**

`forge-math.js:139–140`:

```js
const fw  = zones.filter(z => z === 2).length;
const big = zones.filter(z => z === 0).length;     // ← only column 0
```

Build Spec §2.3 defines the columns as `0` big miss **left**, `1` small miss left, `2` fairway,
`3` small miss right, `4` big miss **right**. So a ball smashed 40 yards right counts as
**neutral**, exactly like a 20-yard push. The spec names this and decides it:

> *"**Asymmetry — prototype bug, decide before building.** … This is almost certainly unintended:
> **the intended behaviour is symmetric** — `bad = count(value == 0 or value == 4)`. Build it
> symmetric, and treat any prototype driving index as non-comparable."*

`forge-math.js` reproduces the bug. Fix on port: `z === 0 || z === 4`. Note the consequence the
spec spells out — **every driving index produced by the prototype is non-comparable** to one
produced after the fix, which is a second, independent reason `scoring_version` (§2.3) is not
optional. The existing fixtures encode the bug too (they only ever fill `0`), so add a case
asserting a right big miss costs the same as a left one.

Also from §2.3, worth recording against the `level` column: *"driving has one fixed corridor — no
levels, no ladder … its `level` is always 0 and no promotion or demotion applies."*

**(b) `currentFacet` hard-codes 20 shots.** At lines 216–217, in its fallback path:

```js
const n = s.shots ? s.shots[facetId] : 20;
if (n != null && n < 20) continue;      // provisional: never sets the number
```

This violates the spec's second load-bearing rule — *"Completeness is defined per drill (§3.4) …
**Never hard-code 20**"* — and it is wrong for Putt 18 specifically, whose completeness test is 18
holes. A complete Putt 18 round arriving without an explicit `complete` flag is silently dropped
as provisional. **Fix:** delete the fallback and require the caller to pass `is_complete`, which
the server now stores (§2.2). Non-blocking, but fix it in the port rather than carrying it over.

---

## 3. 🔴 The three-way conflict on `baselineHandicap(225)`

### Verdict: **12.5 is right.** Interpolation stands; the Build Spec's §2.3 step rule is amended; the fixture's input is a typo.

All three verified by running the code, not by reading:

| Source | `baselineHandicap(225)` | Mechanism |
| --- | --- | --- |
| Build Spec §2.3 | **15** | *"First row where `carry ≥ threshold` wins"* — an explicit step table. 225 ≥ 215 → 15. |
| `forge-math.js:96` | **12.5** | Linear interpolation. 225 sits midway between 215 (→15) and 235 (→10). |
| `forge-math.test.js:33` | **7.5** | Expects the midpoint of the *next* segment up. |

### The evidence that decides it

**1. The prototype interpolates too — this is the new fact, and it breaks the tie.**
`FORGE.dc.html:2692` contains `baseHcp()`: the same table, the same algorithm, and a comment that
is nearly word-for-word the module's:

> `// Linear between table rows, so 234 and 236 yards are not a full stroke apart.`

So **two of the three implementations agree**, and they are the two that actually run. The spec's
step rule has never matched the shipped behaviour. §2.3's *numbers* were copied faithfully into
`CAL.carry` — what diverges is the lookup rule, which the spec renders as a printable grid of
thresholds because that is how you print a table, not because anyone chose stepping.

> ⚠️ `docs/FORGE-CONTEXT.md` concluded *"the module does not implement what the spec specifies"*
> and left it open. That reading was based on the spec and the module only. With the prototype in
> evidence the spec is the outlier, not the module.

**2. The fixture's own label names a different yardage.** It reads `'225 yd is half way 10→5'`.
The 10 anchor is 235 yd and the 5 anchor is 255 yd; halfway between them is **245**. And
`baselineHandicap(245)` returns exactly **7.5** — verified. The author wrote a correct expectation
against the wrong input. 225 is halfway between 215 and 235, i.e. halfway 15→10.

**3. The module understates its own argument by 5×.** Line 94 claims *"a step table would put 234
and 236 yards a full stroke apart."* Checked numerically against the spec's actual table:

```
interpolated   234 → 10.3   236 → 9.8    diff 0.50
step (spec)    234 → 15     236 → 10     diff 5
max step cliff anywhere on the table: 5 strokes for 1 yard (at 185 yd)
```

It is **five** strokes, not one — every threshold is a 5-stroke cliff, because the rows are 5
strokes apart. This makes the case for interpolation stronger, not weaker. `drivingIndex` adds
`baselineHandicap` straight into its result, so under the spec's rule a player correcting their
self-reported carry from 234 to 236 — two yards, well inside the honest error of "average driver
carry" — would watch their driving index drop five strokes. That is indefensible in a number shown
to a user.

**4. The underlying quantity is a sampled function.** `CAL.carry` is tagged *"average carry by
handicap … Interpolated, never stepped."* It is one function sampled at eight handicap values.
Inverting a sampled function interpolates between samples; stepping asserts that every carry from
235 to 254 belongs to a 10-handicap, which the data never said.

### But the spec's precedence rule points the other way, so this is an amendment, not a bugfix

The Build Spec states: *"Where the two disagree, this document wins."* By that rule the shipped
module is non-conformant and 15 is the contractual answer. The evidence above says 15 is the
*wrong* answer. Both are true. So the deliverable here is **an amendment to §2.3 that Makel
signs**, recorded as a decision — not a silent code change that leaves the spec saying something
else. §2 opens with *"Copy the numbers; do not re-derive them"*, and the numbers are being kept;
it is the lookup rule that changes.

### 🔴 And the amendment must fix a real tail bug, found while checking this

The spec and the module **also** disagree below the last populated row, and **both are wrong there,
in opposite directions**:

```
 185 yd → 25.0   (spec: 25)   ✅ agree
 184 yd → 25.0   (spec: 30)   ← module too generous
 150 yd → 25.9   (spec: 30)
 100 yd → 27.3   (spec: 30)
   1 yd → 30.0   (spec: 30)   ✅
```

The final table row is `[0, 30]`, so the module treats **0 yards** as a genuine anchor and
interpolates across a 185-yard segment. A 100-yard carry reads 27.3. That row was only ever a
sentinel meaning "below this, 30".

⚠️ **But the obvious fix — clamp to 30 below 185 — reintroduces the exact cliff this whole section
argues against.** Verified:

```
clamp-to-30:   185 → 25     184 → 30     cliff = 5 strokes for 1 yard
```

That is the same 5-stroke jump the step table was rejected for. The spec's flat-30 tail has it too,
which is why "the spec is right here" is not available either.

**The consistent fix is to extrapolate the last real segment's slope until it reaches 30, then
clamp.** The last two populated rows are 200→20 and 185→25: five strokes per fifteen yards, which
reaches 30 at **170 yd**. Women's equivalent rows are 175→20 and 160→25, reaching 30 at **145 yd**.
Verified:

```
 200 → 20.0    185 → 25.0    184 → 25.3    175 → 28.3
 170 → 30.0    169 → 30.0    150 → 30.0    100 → 30.0
 continuity |bh(184) − bh(185)| = 0.30     ✅ no cliff
 women: 175 → 20.0   160 → 25.0   145 → 30.0   100 → 30.0
```

This keeps one rule across the whole domain — interpolate between real anchors, extrapolate the
final slope, clamp at 30 — instead of interpolating in the middle and stepping at the end.

> If Makel would rather keep a flat tail, that is a legitimate call: below 170 yards the driving
> index is not a meaningful number anyway. But it must be made knowing the floor clamp **brings the
> cliff back** at 185, and the §3 argument then applies to the module as much as to the spec.

### Exactly what changes, in each of the three places

| Place | Change |
| --- | --- |
| **Build Spec §2.3** | Replace *"First row where `carry ≥ threshold` wins"* with: *linear interpolation between adjacent rows; above the top row, clamp to the top value; below the last populated row, continue that row's slope until the baseline reaches 30, then clamp (30 at 170 yd men / 145 yd women).* The eight anchor pairs are unchanged. |
| **`forge-math.js`** | No change to the interpolation itself. **One fix:** `baselineHandicap` must stop treating the `[0, 30]` sentinel as an anchor — extrapolate the last real segment instead. Optionally correct the line-94 comment to say *five* strokes. |
| **`forge-math.test.js:33`** | Change the input 225 → 245 (the existing label is already correct for 245), and add a case pinning 225 → 12.5 so the interpolated midpoint of the *lower* segment is covered too. Add two tail cases: `100 yd → 30` and a continuity assertion `|bh(184) − bh(185)| < 0.6`, which is what stops a future "simplification" putting the cliff back. |

### Proof: the fixture fix, run

Luke's package was **not** modified. A copy was patched in scratchpad and run:

```
$ node forge-math.test.js      # patched copy, scratchpad
59 passed, 0 failed
```

The two changed/added distance cases, plus the new four-facet weights case from §5:

```js
check('245 yd is half way 10→5',  baselineHandicap(245), 7.5);
check('225 yd is half way 15→10', baselineHandicap(225), 12.5);
```

---

## 4. The two benchmark tables

### Verdict: use `BENCH`. `CAL.benchmarks` is **mis-tagged on both columns**, and its yardage is a units error, not a precision disagreement.

**The divergence at handicap 12.5, computed:**

| Table | Yards | Fairway % |
| --- | --- | --- |
| `forge-math.js:57` `CAL.benchmarks`, tagged **MEASURED** | **221** | **50** |
| `FORGE.dc.html:2952` `BENCH`, Arccos, × `ROLL_F = 0.92` | **207** | **45.3** |

**14 yards and 4.7 fairway points.** (`docs/FORGE-CONTEXT.md` records 220 yd / 13 yards — the
interpolation returns 220.5 and `Math.round` takes it to **221**. Minor, but the doc should be
corrected.)

### `CAL.benchmarks` is the Arccos table with the roll correction dropped

Laying the three side by side makes it unmistakable:

```
CAL.benchmarks     0→250   5→240   10→226  15→215  20→202  30→185
Arccos RAW         2.5→250 7.5→238 12.5→225 17.5→213 22.5→202 30→184   ← tracks within ~2 yd
Arccos ×ROLL_F     2.5→230 7.5→219 12.5→207 17.5→196 22.5→186 30→169
```

`CAL.benchmarks` matches the **raw** Arccos row-for-row (keyed 2.5 strokes off), not the corrected
one. The prototype's comment states what raw means:

> *"Distance is Arccos TOTAL (carry + roll); FORGE logs carry, so totals are scaled by ROLL_F
> below."*

So `CAL.benchmarks` holds **total distance** and the app compares it against a player's logged
**carry**. That is a units mismatch: every player is measured against a benchmark ~8% longer than
the thing they entered, and reads as short by **20 yards** at scratch (`CAL.benchmarks` 250 against a roll-corrected 230). It is an extraction defect —
the roll correction was left behind in the HTML.

### The fairway column is folklore, and the prototype says so

`CAL.benchmarks` runs 62% at scratch down to 38% at 30. `BENCH` runs 50% down to 40%. The
prototype's comment names the disagreement and takes a side:

> *"Fairway rates are Arccos as published — **flatter than folklore**: scratch-4.9 hit 50%, 30+ hit
> 40%."*

`CAL.benchmarks`'s 62% is the folklore number, carried under a **MEASURED** tag with no citation.

### Is the MEASURED tag correct? No — on either column.

- **Yards:** should be **ESTIMATED**, not MEASURED. The published figure is total distance; carry
  is derived from it through `ROLL_F = 0.92`, which the prototype itself tags *"ESTIMATED: roll ≈
  8% of total off the tee on typical fairways."* A measured quantity passed through an estimated
  transform is estimated.
- **Fairway %:** **MEASURED** is correct — but only for the `BENCH` values (50 / 45.3 / 40), which
  are Arccos as published. Not for `CAL.benchmarks`'s 62/52/38.

### Actions

1. Replace `CAL.benchmarks` with the `BENCH` anchors, roll-correction applied, carrying the
   citation (*Arccos Driving Distance Report, men, ~25M rounds*) and `ROLL_F` as a named `CAL`
   constant rather than a number folded into the table — so the correction is visible and a later
   refit changes one value.
2. Re-tag: yards ESTIMATED, fairway % MEASURED.
3. ⚠️ **Both tables are men-only, and `benchmarkAt(handicap)` takes no gender parameter** while
   `baselineHandicap(yards, gender)` does. A woman is currently benchmarked against men's driving
   distance. Either add the parameter with a women's table, or suppress the distance benchmark for
   women until one exists. Flagged, not solved — there is no women's source in the package.
4. The existing fixture `check('benchmark at 7.5 interpolates', benchmarkAt(7.5).yards, 233)` must
   change: under `BENCH` the answer is **219**. Update it in the same change, or the suite goes red
   for the right reason and gets "fixed" by reverting the table.

### 🔴 A larger contradiction this exposed, which needs a citation before any driving index ships

`CAL.carry` and the Arccos data **disagree by ~50 yards about the same golfer**, and they cannot
both be right:

- `CAL.carry` (tagged **MEASURED**, and identical in the Build Spec §2.3): a **scratch** player
  carries **280 yd**.
- Arccos, roll-corrected: a **2.5-handicap** carries **230 yd**.

Run forward, the consequence is severe. A genuinely scratch player — carrying Arccos's 230, hitting
12 of 20 fairways with 2 big misses — scores:

```
baselineHandicap(230)                    → 11.3
drivingIndex(12 FW / 2 big, 230 yd)      → 11.3
```

**A scratch golfer reads as an 11-handicap driver.** If `CAL.carry` is the optimistic table, every
driving index in the system is inflated by roughly ten strokes, and the composite with it.

I am **not** calling this proven. Two sourced tables disagree and the package contains no citation
for `CAL.carry` beyond the MEASURED tag — it may be measuring something else (a well-struck carry,
a launch-monitor figure, an aspirational ladder) rather than an average. What is certain is that
**they are not both "average carry by handicap"**, and one of the two tags is wrong.

This makes step-vs-interpolate (§3) a second-order question: a 2.5-stroke argument sits inside a
possible 10-stroke calibration error. **It blocks *showing* a driving index to a user. It does not
block the migration**, provided the carry snapshot from §2.1 exists — with `carry_yds_at_play`
stored, a refit recomputes every historic driving index correctly. Without it, a refit is
impossible. That is exactly why B1 is in the blocking column.

---

## 5. The facet weights

### 5.1 Where the one true copy goes: `CAL.weights`, in the eco module

The module opens with *"Nothing outside this object may contain a magic number"* and then breaks
its own rule — `practiceHandicap(valuesByFacet, weights)` takes the weights as a **parameter**, and
they appear nowhere in `CAL`. (Verified: `'weights' in CAL === false`.) So every caller supplies
its own copy, which is how the test file came to hold a different one.

### 5.2 Yes — the test file really does have chipping and putting swapped

Verified against **both** authorities, which agree with each other:

| Source | driving | approach | chipping (ATG) | putting |
| --- | --- | --- | --- | --- |
| Build Spec §2.1 | 0.30 | 0.35 | **0.15** | **0.20** |
| `FORGE.dc.html:2209–2245` `FACETS[].weight` | 0.30 | 0.35 | **0.15** | **0.20** |
| `forge-math.test.js:136` | 0.30 | 0.35 | 🔴 **0.20** | 🔴 **0.15** |

The spec and the running app agree. **The test file is the only wrong copy.** Take the weights
from either of the first two; never from the fixture.

**Why it slipped through:** both existing weight fixtures score only `driving` and `approach` —

```js
practiceHandicap({ driving: 10, approach: 10 }, W)        // → 10
practiceHandicap({ driving: 20, approach: null }, W)      // → 20
```

Weights renormalise over scored facets, so neither assertion touches chipping or putting and both
pass identically under either copy. A four-facet case discriminates, and is now proven to:

```js
check('all four facets use the spec weights',
  practiceHandicap({ driving: 10, approach: 20, chipping: 30, putting: 40 }, W), 22.5);
// spec weights    → 22.5   ✅
// swapped weights → 22.0   ❌ caught
```

Add it with the weights; the swap is invisible without it.

### 5.3 The same defect, larger: the level tables are not in the module either

`headScoredIndex({ total, shots, base, slope, allowance })` takes `base` and `slope` as parameters
too, and they are **not in `forge-math.js` at all**. They live in `FORGE.dc.html:2209–2245`:

| facet | `base` (per level L1–L4) | `slope` |
| --- | --- | --- |
| approach | `[20, 12, 5, 0]` | 0.6 |
| chipping (ATG) | `[20, 12, 5, 0]` | 0.6 |
| putting | `[8, 4, 1, -1]` | 0.9 |

And the per-level **option-set values** (§2.4 — the `opts` arrays, plus the nine-bucket carry game
under `optsByMode`) are absent from the module as well. The spec calls these *"the level
definitions — they are the product."*

So `forge-math.js` on its own **cannot compute a single head-scored index.** Three-quarters of the
facets need numbers that ship somewhere else. The weights argument applies with more force: if the
level tables stay in the client, the server's `POST /sessions/:id/complete` needs its own copy, and
the two drift. **All of it — weights, `base`/`slope`, and the option-set values — moves into
`CAL` in the eco module.** This does not block the migration (it is constants, not columns) but it
does block "the module is immediately usable": as extracted, it is not.

### 5.4 And the module still has loose magic numbers after that

*"Nothing outside this object may contain a magic number"* is violated in four more places. All of
them move into `CAL` with a tag during the port:

| Literal | Where | Note |
| --- | --- | --- |
| `zoneCentresYards = [-38, -18, 0, 18, 38]` | `dispersion` default arg | The yard placement of each driving column. Invented — ±38 for "beyond 30 yd off line" is a guess, and every `meanYards`/`sdYards` figure scales with it. Tag **GUESS**. |
| `deadband = 3` | `missSide` default arg | How far off centre still reads "centred". Tag **GUESS**. |
| `8`, `× 2`, `20 / shots` | `drivingIndex` body | These three *are* specified, in Build Spec §2.3 — `index = clamp(baseline_hcp + (8 − adj))`, `adj = (fairways − bad × 2) × scale`. Spec'd but still untagged in the module. |
| `-6`, `40` | `clampIndex` | The index clamp. Spec'd in §2.2. |

---

## 6. The unfitted constants

Forge tags its own honesty, and the README repeats it: *"Open guesses still to fit against real
players: `yardsPerShot`, ATG constants, Putt 18 calibration."*

| Constant | Tag | Reaches | Do not show until fitted |
| --- | --- | --- | --- |
| `yardsPerShot: 0.06` | **GUESS** | `dispersion().shotsLostToBias` | The **stroke cost** of a miss bias. Never *"your bias costs you 0.4 shots."* Show the bias direction and spread instead — but see the caveat below: those are modelled too, just less badly. |
| `atg: { perYard, baseYards, rungStepYards, shortSided }` | **GUESS** | `atgAllowance` → `headScoredIndex` allowance → **the ATG index itself** | The ATG/chipping index as a number. A GUESS is inside the index, not just a label on it. |
| `putt18: { base: 8, k: 1.2 }` | **PROVISIONAL** | `putt18Handicap` → **the putting index** | The putting index as a number. Module's own note: *"Both numbers must be calibrated against known reference rounds."* |
| `sgRate`, `se20`, `expPutts` | ESTIMATED | strokes gained, the ± confidence range, expected putts | Showable with the modelled marker. Defensible, not measured. |

### The cascade — this is the part that matters

Two of the four facet indices are contaminated at source. The composite sums **all four**:

```
practiceHandicap   = Σ weight × index   over driving, approach, chipping, putting
totalStrokesGained = Σ facetStrokesGained(...)   over the same four
```

So **the headline practice handicap and the headline strokes-gained figure both inherit a GUESS and
a PROVISIONAL.** They are the two biggest numbers on the screen and they are the least trustworthy.
Whatever marker §7 lands on, it must apply to them.

### What a fitting exercise needs

The external truth already exists in `golf.*`:

- `golf.player_profile.ghin_number` — the external handicap identity.
- `golf.player_profile.handicap_index` — the intake answer.
- `golf.handicap_history` — the append-only trail, so a session can be paired with the player's
  verified handicap **as of that date** rather than today's.

The input side is the `shots` / `putt18_holes` / `raw_total` rows from §2.1. The procedure:

1. Collect N players × M complete sessions, each with a contemporaneous verified handicap from
   `handicap_history` (not the self-reported `usga_handicap`, which §3.6 re-asks weekly and which
   is a *different number* from `player_profile.handicap_index` — see the open collision).
2. Recompute each facet index from stored shots, under the current constants.
3. Regress computed index against verified handicap per facet; solve for the constants that
   minimise the residual. `putt18.base`/`k` is a two-parameter linear fit and is the easiest win.
   The ATG set is four parameters and needs the most data.
4. Bump `scoring_version` (§2.3), recompute, keep both.

**Sample size is the gate, and it is why B1–B3 block.** Fitting cannot start until sessions with
stored shots exist, and a session scored without `carry_yds_at_play` can never be re-scored
correctly. Every session logged before those columns land is unusable for fitting driving.

---

## 7. The PROVENANCE map, and how it reaches the UI

The module ships a flat split:

```js
export const PROVENANCE = {
  fairwaysHit: 'measured', bigMisses: 'measured', puttsTaken: 'measured',
  drillScore: 'measured', averageDistance: 'measured',
  facetIndex: 'modelled', strokesGained: 'modelled', biasCost: 'modelled',
  dispersion: 'modelled', practiceHandicap: 'modelled'
};
```

The distinction is right and `docs/FORGE-CONTEXT.md` is correct that Atlas should carry it to the
UI. But as shipped it is not sufficient, for two reasons:

1. **It is incomplete.** No entry for the benchmark comparison (§4), none for `expectedPutts`, none
   for the confidence range `se`.
2. **It collapses the axis that matters.** `CAL`'s own tags — MEASURED / ESTIMATED / GUESS /
   PROVISIONAL — are a *finer* provenance that `PROVENANCE` throws away. `facetIndex` and
   `practiceHandicap` are both `'modelled'`, but the approach index is modelled from ESTIMATED
   constants while the ATG index is modelled from a **GUESS**. The UI cannot tell them apart, so
   it either marks everything or nothing.

### Recommendation: three values, derived from the constants each function touches

```
'measured'     the player counted it           → show plainly
'modelled'     computed from measured inputs
               + ESTIMATED constants           → show with a subtle modelled marker
'provisional'  computed from a constant tagged
               GUESS or PROVISIONAL            → visible marker, and never a headline
```

Under that rule the reclassification falls out mechanically:

| Figure | Today | Becomes | Because |
| --- | --- | --- | --- |
| `biasCost` | modelled | **provisional** | `yardsPerShot` is a GUESS |
| ATG / chipping `facetIndex` | modelled | **provisional** | the `atg` set is a GUESS |
| putting `facetIndex` | modelled | **provisional** | `putt18` is PROVISIONAL |
| `practiceHandicap` | modelled | **provisional** | sums both of the above (§6) |
| `strokesGained` (total) | modelled | **provisional** | same |
| `dispersion` (mean/sd/side) | modelled | **modelled** *(unchanged)* | ⚠️ Not measured. The zone **counts** are measured, but `meanYards`/`sdYards` convert them through `zoneCentresYards = [-38, -18, 0, 18, 38]` — an **untagged default parameter outside `CAL`**, where ±38 for "beyond 30 yd off line" is an invented placement. `side` additionally depends on `missSide`'s `deadband = 3`. Only its *cost* is `provisional`. |
| driving `facetIndex` | modelled | **provisional** *(provisionally)* | pending the §4 `CAL.carry` contradiction; downgrade to `modelled` once carry is cited |

### Mechanics

- **Ships with the module, not the database.** Provenance is a property of the *function*, not the
  row — it changes when a constant is refitted, with no row changing. Storing it would mean a
  migration every time a constant moves. Export it from `@ryp/eco/scoring` alongside `CAL`.
- **Derive it, don't hand-maintain it.** Key each export to the `CAL` entries it reads, and compute
  the provenance from the worst tag among them. Then refitting `putt18` from PROVISIONAL to
  MEASURED upgrades the putting index and the composite automatically, and nobody has to remember
  to edit a second list. A hand-written map will go stale on the first refit.
- **The `'provisional'` tier is a release gate, not just styling.** §6's rule — do not present a
  guess as a measurement — is enforceable in one place if the UI refuses to render a
  `'provisional'` figure as a headline. That is the cheapest available protection against the
  failure the spec names: *"plausible-but-wrong indices … not visible in QA, and it silently
  misdirects a player's practice for months."*

---

## 8. Sequence

1. **B1 + B2 + B3** — `gender` on `golf.player_profile`; `carry_yds_at_play` + `gender_at_play` +
   `scoring_version` on the Forge facet row. Generated normally with `drizzle-kit generate`; the
   journal was repaired under T-107 and `migrate` against production is a verified no-op.
2. **Port to `@ryp/eco/scoring`** — TS, strict, zero imports, own tsup entry, non-node target.
   Carry the three fixes: the `drivingIndex` big-miss asymmetry (§2.5a — the spec has already
   decided this one), the `currentFacet` hard-coded 20 (§2.5b), and the `baselineHandicap` tail
   (§3). Move `weights`, `base`/`slope`, the option-set values and the loose literals into `CAL`
   (§5.3, §5.4).
3. **Fixtures as eco's first test** — 59 cases against `dist`, including the two corrected distance
   cases and the four-facet weights case, plus new cases for each fix in step 2: a right big miss
   costing the same as a left one, a complete Putt 18 at 18 holes, and the tail continuity
   assertion.
4. **§3 amendment signed**, recorded as a decision under `docs/decisions/`, and §2.3 of the Build
   Spec edited to match. Not a silent code change.
5. **§4 benchmark swap**, with the `benchmarkAt(7.5)` fixture updated in the same change.
6. **Cite or refute `CAL.carry`** (§4, final subsection) before any driving index is shown to a
   user.
7. **Fitting exercise** once enough sessions with stored shots exist.

Steps 1–3 are mechanical. Steps 4 and 6 need Makel.
