# FORGE scoring module — adoption plan

**Status:** proposal, **with four of its questions now decided** (Makel, 2026-10-06 — decisions in
`decisions/FORGE-PORT-ANSWERS-2026-10-06.md`, consequences in `decisions/FORGE-PORT-FIX-CHECKLIST.md`):
**§3** interpolation is signed (the *tail* below the last row is NOT — see §3); **§4** is **overruled**
— `CAL.benchmarks` ships, tagged `UNSOURCED` (§4.1); **§2.5a** driving asymmetry is decided symmetric
and recorded as a formula change that lands before the first row; **§2.1 / B2** is **superseded by B22**
(answer 22) — there is **no `gender` column**, the field is `golf.player_profile.carry_reference` and the
snapshot is `carry_reference_at_play`. Text below that still recommends the opposite is retained as the
argument that was overruled, and says so where it appears.

**Updated 2026-10-14 — the scoring module is no longer a proposal; it is built (`@ryp/eco/scoring`,
`2a858d3`, 193 fixtures passing).** Sections 1–8 are the analysis of **`forge-math.js` as received** and keep
its signatures; **§9 says what the ported module actually does** — `SCORING_VERSION`, the carry-reference
change (T-125 closed in the scoring layer), every deliberate departure, the `UNSOURCED` tag now applied to
**both** `CAL.carry` and `CAL.benchmarks` (§4.2), and what is **NOT BUILT**. An earlier version of this
header said `CAL.benchmarks` was "tagged `UNSOURCED`" when it was not yet true in any code; it is now, in the
module — the vendored `forge-math.js:56` still says `MEASURED` and is never edited.
**Written:** 2026-10-06. Every number below was verified first-hand by running the code, not read
off a summary. Where this document contradicts `docs/FORGE-CONTEXT.md`, this one is newer and the
contradiction is called out in place.

**Subject:** `/Users/makelmackbee/Downloads/FORGE-package/build/forge-math.js` — 337 lines, pure,
dependency-free, clock-free. **23 exports** (not 22 — `grep -c '^export'` returns 23; the earlier
count missed one). Fixture file `build/forge-math.test.js`, 57 checks, one failing.

> ⚠️ **Read this before the numbers in §§2–5.** Those sections analyse **`forge-math.js` as received**, whose
> signatures are `baselineHandicap(yards, gender = 'm')` and `drivingIndex(zones, averageYards, gender = 'm')`.
> A call written `baselineHandicap(230)` below is **that** signature with the men's default. **The ported module,
> `@ryp/eco/scoring` (commit `2a858d3`), takes a carry reference instead, and a one-argument call returns `null`.**
> For `'pga_scratch'` these figures were re-run against the built module on 2026-10-14 and **are unchanged**:
> `baselineHandicap` of 245 → 7.5, 225 → 12.5, 234 → 10.3, 236 → 9.8, 230 → 11.3, 184 → 25.0, 150 → 25.9,
> 100 → 27.3; 205 → 18.3 on `'pga_scratch'` and 10.0 on `'lpga_d3'`; `drivingIndex(10 FW, 8 small, 2 big, 230)` →
> 13.3 and `(12 FW, 6 small, 2 big, 230)` → 11.3 (both with the big misses on the left, where the old and the
> symmetric formula agree); `benchmarkAt(12.5)` → 221 yd / 50%. **Not re-run:** the 8.6 and 12.5 comparison
> figures in §4.1, and every figure not listed here. What the ported module does differently — all of it —
> is in **§9**.

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
| **B2.** *(superseded by **B22**, answer 22 — read as "no home for the carry-table selector".)* eco had nowhere to hold *which carry table scores this player*. It is **not** a gender column and none is being added: the home is `golf.player_profile.carry_reference`, frozen per driving row as `carry_reference_at_play`. §2.1 | **N2.** Which benchmark table is real. Display-only; feeds no stored column. §4 |
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
carryReference)` depends on two values that live on the mutable player row and are snapshotted nowhere:

| Input | Lives on | Why a snapshot is required |
| --- | --- | --- |
| `avg_carry_yds` | the player row (spec §1), i.e. `golf.player_profile.driver_carry_yds` | The player edits it from `PUT /me/profile` (§6.1). Re-scoring a June session in December uses December's carry. `baselineHandicap` is added **directly** into the driving index, so a 20-yard carry edit moves every historic driving index by ~5 strokes. |
| the carry reference | `golf.player_profile.carry_reference` — `'pga_scratch'` \| `'lpga_d3'` | Selects `CAL.carry.m` vs `CAL.carry.f`. 205 yd reads **18.3** on `'pga_scratch'` and **10.0** on `'lpga_d3'` — **8.3 strokes**. The player can change it. |

> **Superseded — B22, 2026-10-09 (answer 22).** This section originally prescribed a `gender text` column
> (`'m'` \| `'f'`) on `golf.player_profile` and a `gender_at_play` snapshot on the facet row. Makel decided
> not to ask for gender at all: the field never meant "who are you", it meant "which statistical reference
> class should we compare you against". So the column is **`carry_reference`** and the snapshot is
> **`carry_reference_at_play`**. **Do not add a gender column; nothing is backfilled from RYP-RED's Firestore
> `gender`** (its vocabulary is unverified, and a reference class is not a gender). The structural argument
> for a snapshot is unchanged and stands below.

The spec's own rationale for snapshotting `level` applies verbatim: *"or every trend lies."* Carry
is the same kind of value and got the same treatment nowhere.

**Fix (B1 + B22), two columns on the driving facet row** — not in `meta`, because `meta` is
untyped jsonb and these are scoring inputs that a re-score must not have to guess at:

```
carry_yds_at_play         integer   null    -- snapshot of driver_carry_yds when this facet was scored
carry_reference_at_play   text      null    -- 'pga_scratch' | 'lpga_d3'; selects the carry table. Text + const, not an enum.
```

Declared on `golf.facet_scores` in `eco/src/schema/forge.ts` (`carryYdsAtPlay`, `carryReferenceAtPlay`), with
CHECKs for the vocabulary, for "driving rows only", and for *"a driving `practice_index` may be stored only if
both are set"* — read from the file, **not applied to any database as far as this document knows**.

**Null means two different things here, and one of them is a trap.** A null `carry_reference_at_play` is
honest and means *no driving index*: `drivingIndex` returns `null` (ruling 10, §9.3) and the CHECK above
refuses to store one. A null `carry_yds_at_play` **with a reference present** is *not* caught by the scorer:
`baselineHandicap` still returns **30** for a missing or zero distance, so `drivingIndex(10 FW + 10 small misses,
null, 'pga_scratch')` is **28**, a plausible number built on a baseline of 30 (verified against `dist`,
2026-10-14). Only the CHECK stops a *null* being stored — and it tests `is not null` only (no `carry_yds_at_play > 0` CHECK exists in `forge.ts`, grepped), so **a stored `0` passes it and scores on a baseline of 30**. The scorer behaviour is an open item — §9.5.

**And B2 has a second half — a home for the table selector — and B22 settled it differently from the first
draft of this section.** Grep confirmed there was no such column in eco: `golf.player_profile` has `handedness`
(not a proxy — a left-handed man and a woman select different tables for different reasons) and `identity.ts`
has nothing. Added to `golf.player_profile`, alongside `handedness`, following the existing convention:

```
carry_reference   text null, no default   -- 'pga_scratch' | 'lpga_d3'. Selects the carry→handicap table (Forge §2.3). Text + const, never a pg enum.
```

It belongs in `golf.*` by the placement rule — it is a shared golf attribute another app reads, and it sits
next to `handicap_index`, `driver_carry_yds` and `handedness` which are already there. The vocabulary is
`CARRY_REFERENCES` in `eco/src/schema/enums.ts`, CHECKed in `golf.ts`. The module imports nothing, so it holds
its own copy of the two names (`CARRY_TABLE_KEY` in `index.ts`); a fixture
(`scoring-fixtures.mjs:121–127`) proves the copy agrees with `CARRY_REFERENCES`.

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
rule Atlas's DNA fork already operates under. On ryp-core the table is `golf.facet_scores`, not
`session_facets` (`FORGE-ON-RYP-CORE.md` §2), and the module exports the string as `SCORING_VERSION` (§9.1).

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

> **DECIDED — SYMMETRIC (Makel, 2026-10-06, answer 16, checklist B14).** A miss is a miss: `bad =
> count(value === 0 || value === 4)`. Two things follow and both are stated so nobody has to
> rediscover them:
>
> 1. **Storage is unaffected** — `outcome_value` is 0–4 either way and the shots are stored whole.
>    So this is a **scoring-formula change, not a migration.**
> 2. **It moves EVERY driving index, so it lands before the first row is written, not after.** Any
>    driving number anyone has seen in Luke's prototype was computed left-only and is
>    **non-comparable** to every index this system will ever store. That is the point of the change,
>    and Luke should be told rather than left to notice. Because no stored row will ever have been
>    scored by the asymmetric formula, there is no historic population to recompute — which is why
>    this is cheap now and a refit across live rows later.
>
> The code change is `forge-math.js:140` (`z === 0` → `z === 0 || z === 4`), made on the eco port,
> not in Luke's package. ⚠️ The existing fixtures only ever fill zone `0`, so they encode the bug and
> **cannot catch its return** — add the case asserting a right big miss costs exactly what a left one
> does. ⚠️ And any driving expectation in the 57-case suite may move when the formula does; re-derive
> those by hand, do not adjust them to turn the suite green.

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

> **SIGNED 2026-10-06 (answer 17): interpolation, and Build Spec §2.3 is amended** — recorded in
> `FORGE-ON-RYP-CORE.md` §2 under *"§2.3 — Baseline handicap from average carry"*. **The sign-off
> says `forge-math.js` needs "no change", and the tail fix proposed below is a change.** So the
> **tail below the last populated row is NOT decided**: it remains a proposal awaiting Makel, and
> until it is, the module's behaviour (the `[0, 30]` row treated as an anchor; 100 yd → 27.3) is what
> the amendment leaves standing. Do not build the extrapolation on the strength of this section alone.

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

> 🔴 **OVERRULED — Makel, 2026-10-06 (answer 21). `CAL.benchmarks` SHIPS.** The verdict above, and
> Actions 1, 2 and 4 below, are retained as the argument that lost; do not build them. What survives
> of this section is §4.1, which records the one claim that is a fact rather than a preference.
> Action 3 (men-only, no carry-reference parameter on `benchmarkAt`) is unaffected and still open — the
> ported `benchmarkAt` still takes one argument.

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
3. ⚠️ **Both tables are men-only, and `benchmarkAt(handicap)` takes no carry-reference parameter** while
   `baselineHandicap(yards, carryReference)` does. A player on the `'lpga_d3'` scale is currently
   benchmarked against men's driving distance. Either add the parameter with a women's table, or suppress the distance benchmark for
   women until one exists. Flagged, not solved — there is no women's source in the package.
4. The existing fixture `check('benchmark at 7.5 interpolates', benchmarkAt(7.5).yards, 233)` must
   change: under `BENCH` the answer is **219**. Update it in the same change, or the suite goes red
   for the right reason and gets "fixed" by reverting the table.

### 4.1 `CAL.benchmarks` ships — and its provenance tag is `UNSOURCED` *(B19 / C6)*

Choosing the numbers is Makel's call and it is made. **The provenance tag is a separate claim**, and
everything downstream trusts a tag — `PROVENANCE` (§7) decides what the UI may show plainly.

| | |
| --- | --- |
| **Tag as shipped** | `MEASURED` (`forge-math.js:56`: *"MEASURED — typical distance and fairway rate by handicap"*) — the **strongest** tag in Luke's own scheme (`:19`: *"taken from published shot data or an established practice"*). |
| **Source in the package** | **None.** No citation, no dataset name, no method. The table's rows match the *raw* Arccos totals within ~2 yd (above), but the package does not say so and Arccos's fairway column is not what the table carries. |
| **Does the app contradict it?** | **Yes.** `FORGE.dc.html:2948`: *"Fairway rates are Arccos as published — flatter than folklore: scratch-4.9 hit 50%, 30+ hit 40%."* `CAL.benchmarks` claims **62%** at scratch (`forge-math.js:58`) and 38% at 30. The app's own comment names the 62% number as the folklore one. |
| **Decision** | Tag it **`UNSOURCED`**. The numbers stay; the claim that they were measured does not. If Luke supplies a source the tag can rise; nothing here requires him to. |

**The consequence, stated plainly so it is not reported as a bug.** Against these tables a
genuinely good player reads **worse than they are**. Computed from the module as shipped, for a
scratch-to-4.9 golfer taking the Arccos roll-corrected figures (≈230 yd carry, ≈50% fairways):

```
baselineHandicap(230)                      → 11.3   (CAL.carry alone, i.e. before any fairway adjustment)
drivingIndex(10 FW, 2 big, 8 small, 230)   → 13.3   (the same player at a true 50% fairways)
drivingIndex(12 FW, 2 big, 6 small, 230)   → 11.3   (at 60%: 12 FW − 2×2 big = 8, so the fairway term is 0)
fairway 50% read against CAL.benchmarks    → 12.5   (the table puts 52% at 10, 48% at 15)
carry 230 read against CAL.benchmarks      →  8.6   (the table puts 226 yd at 10, 240 at 5)
```

**So a genuinely scratch player reads as roughly an 11-handicap driver** — the 11.3 is the driving
index itself; the benchmark comparison lands between 8.6 and 12.5 depending on which column is
read. The mechanism is that scratch is **250–280 yd / 62%** in these tables and **~230 yd / ~50%** in
the published data the app's own comment cites. **This is a known, chosen characteristic of the
shipped calibration, not a defect to be re-reported.** The place it would be reported is the first
number a good player sees — which is why it is written down here, in the same breath as the choice
that causes it.

⚠️ **Scope note — and it is now decided.** The 11.3 comes from `CAL.carry`, not `CAL.benchmarks`, and `CAL.carry`
carried the same `MEASURED` tag with no source either. B19 re-tagged the *benchmarks* table only, and an earlier
version of this note said whether `CAL.carry` follows "is not decided here". **It is decided: ruling 8,
2026-10-14 — `UNSOURCED` too.** That is §4.2.

**Where each tag lives, so neither is re-reported.** `eco/src/scoring/index.ts` — the module that ships — tags
`CAL.benchmarks` `UNSOURCED` (and defines the tier in its legend; earlier text of this document said the tag
was applied when it was not). The vendored `atlas/proto/forge/build/forge-math.js:56` **still says `MEASURED`,
by design** — `proto/forge/` is the unedited record of Luke's delivery and is never edited. Both statements are
true and neither is a defect.

### 4.2 `CAL.carry` is `UNSOURCED` too, and it matters more than the benchmarks tag *(ruling 8, 2026-10-14)*

| | |
| --- | --- |
| **Tag as received** | `MEASURED` (`forge-math.js:47`: *"MEASURED — average carry by handicap, men and women"*), directly above a table the package does not source. The module's own comment now says so in the same place. |
| **Why it matters more** | `CAL.benchmarks` is display-only. **`CAL.carry` feeds scoring**: `baselineHandicap` reads it and `drivingIndex` adds the result straight in. A wrong tag on a display table is a wrong label; a wrong tag on this table is a wrong *number*. |
| **Both rows, not one** | The `UNSOURCED` tag is on the whole table, `m` and `f` alike. There is **no source for the women's rows** either; the `'lpga_d3'` scale's figures are exactly as unsupported as the men's. |
| **The contradiction** | `CAL.carry` and `CAL.benchmarks` **disagree with each other by 30 yards at scratch**: `CAL.carry.m` puts a scratch player at **280** yd (`[280, 0]`); `CAL.benchmarks` puts handicap 0 at **250** (`benchmarkAt(0).yards`, verified). They cannot both be "average carry by handicap". (This is **separate** from the ~50 yd disagreement with Arccos recorded in the subsection below — 280 vs 230. Two comparisons, two gaps, do not merge them.) |

**The consequence, concretely, verified against `dist` on 2026-10-14.** `baselineHandicap(250, 'pga_scratch')` is **6.3**,
while `CAL.benchmarks` says a scratch golfer carries 250. So **the app can tell a player a scratch golfer carries
250, watch them carry 250, and score them 6.3** — the benchmark display and the scoring table contradict each other on
the same screen, with no tag anywhere on that screen able to say which one is wrong. (On the `'lpga_d3'`
scale the same 250 yd scores −1.0, a plus handicap: `CAL.carry.f` reaches scratch at 245.)

The tag does not fix any of this — it **stops the table claiming a measurement it does not have**. Luke is
still asked for the source (ruling 7); the 30 yd conflict is his own Q6 finding (`decisions/ASK-LUKE-forge-port.md`), where he proposed `ESTIMATED` and ruling 8 chose `UNSOURCED` because nothing here is derived from a measurement. Until a source arrives the tag stays: a tag that is not
true is worse than no tag, because everything downstream trusts it. Citing or refuting `CAL.carry` before a
driving index reaches a user is still **Sequence step 6**, and still open.

---

### 🔴 A larger contradiction this exposed, which needs a citation before any driving index ships

*(Against **Arccos** — 280 vs 230, ~50 yd. The 30 yd gap against `CAL.benchmarks` is §4.2 above. Both stand.)*

`CAL.carry` and the Arccos data **disagree by ~50 yards about the same golfer**, and they cannot
both be right:

- `CAL.carry` (tagged **MEASURED** as received — `UNSOURCED` in the module now, §4.2 — and identical in the Build Spec §2.3): a **scratch** player
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

> 🔴 **Status in the eco port (`2a858d3`) — §§5.1, 5.3 and 5.4 are NOT BUILT, and the module header does not say so.**
> Verified by reading `index.ts` and `Object.keys(CAL)`: `CAL` holds `sgRate, se20, window, yardsPerShot, atg,
> putt18, carry, expPutts, benchmarks` — **there is no `CAL.weights`** (`practiceHandicap` still takes the weights as
> a parameter), **no level `base`/`slope` tables and no option-set values**, and the loose literals are all still
> literals: `zoneCentresYards` and `deadband` are default arguments, `8` / `× 2` / `20 / n` are in `drivingIndex`,
> `-6` / `40` are in `clampIndex`. So `headScoredIndex` still cannot compute an index without constants that live
> in the client, and the server and the client can still hold two copies of the weights. **Sequence step 2's
> "move … into `CAL`" has not happened.**

---

## 6. The unfitted constants

Forge tags its own honesty, and the README repeats it: *"Open guesses still to fit against real
players: `yardsPerShot`, ATG constants, Putt 18 calibration."*

| Constant | Tag | Reaches | Do not show until fitted |
| --- | --- | --- | --- |
| `yardsPerShot: 0.06` | **GUESS** | `dispersion().shotsLostToBias` | The **stroke cost** of a miss bias. Never *"your bias costs you 0.4 shots."* Show the bias direction and spread instead — but see the caveat below: those are modelled too, just less badly. |
| `atg: { perYard, baseYards, rungStepYards, shortSided }` | **GUESS** | `atgAllowance` → `headScoredIndex` allowance → **the ATG index itself** | The ATG/chipping index as a number. A GUESS is inside the index, not just a label on it. |
| `putt18: { base: 10, k: 9.09 }` — *received as `{ base: 8, k: 1.2 }`* | `k`: **ESTIMATED** · `base`: **PROVISIONAL** | `putt18Handicap` → **the putting index** | The putting index as a number, until `base` is pinned. `k = 20 / (20 × sgRate.putting)` = 9.09; the received `1.2` was a bug, 7.58× too small (Luke's Q1, `decisions/ASK-LUKE-forge-port.md`). `base` 10 is the mid-scale value. 🔴 **Not gated** — see §9.5. |
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
- ⚠️ **Status in the eco port: the tier exists; the derivation does not.** `PROVENANCE` in `index.ts` has the
  three-value type (`Provenance = 'measured' | 'modelled' | 'provisional'`) and **one** `'provisional'` entry,
  `putt18Index`, written by hand. The reclassification table above — `biasCost`, the ATG and putting
  `facetIndex`, `practiceHandicap`, `strokesGained`, driving — is **not applied**: those entries are still
  `'modelled'` (verified: `Object.keys(PROVENANCE)` is the ten original keys plus `putt18Index`). Nothing derives a
  tier from `CAL`'s tags, so the "refit upgrades it automatically" property does not exist yet. And, as §9.5
  says, nothing *acts* on `'provisional'`.
- **The `'provisional'` tier is a release gate, not just styling.** §6's rule — do not present a
  guess as a measurement — is enforceable in one place if the UI refuses to render a
  `'provisional'` figure as a headline. That is the cheapest available protection against the
  failure the spec names: *"plausible-but-wrong indices … not visible in QA, and it silently
  misdirects a player's practice for months."*

---

## 8. Sequence

1. **B1 + B22 + B3** — `carry_reference` on `golf.player_profile`; `carry_yds_at_play` +
   `carry_reference_at_play` + `scoring_version` on the Forge facet row (`golf.facet_scores`). Generated
   normally with `drizzle-kit generate`; the journal was repaired under T-107 and `migrate` against production
   is a verified no-op. *(An earlier draft of this step named a `gender` column and `gender_at_play`; B22
   removed both — see §2.1.)*
2. **Port to `@ryp/eco/scoring`** — TS, strict, zero imports, own tsup entry, non-node target.
   Carry the three fixes: the `drivingIndex` big-miss asymmetry (§2.5a — the spec has already
   decided this one), the `currentFacet` hard-coded 20 (§2.5b), and the `baselineHandicap` tail
   (§3). Move `weights`, `base`/`slope`, the option-set values and the loose literals into `CAL`
   (§5.3, §5.4).
3. **Fixtures as eco's first test** — *(planned as 59 cases; now 193, `node scripts/scoring-fixtures.mjs`
   → `193 passed, 0 failed`, run 2026-10-14)* against `dist`, including the two corrected distance
   cases and the four-facet weights case, plus new cases for each fix in step 2: a right big miss
   costing the same as a left one, a complete Putt 18 at 18 holes, and the tail continuity
   assertion.
4. **§3 amendment signed**, recorded as a decision under `docs/decisions/`, and §2.3 of the Build
   Spec edited to match. Not a silent code change.
5. ~~**§4 benchmark swap**, with the `benchmarkAt(7.5)` fixture updated in the same change.~~
   **Overruled 2026-10-06** — `CAL.benchmarks` ships; the table is **re-tagged `UNSOURCED`** (§4.1) and
   the `benchmarkAt(7.5)` fixture is left alone.
6. **Cite or refute `CAL.carry`** (§4, final subsection) before any driving index is shown to a
   user.
7. **Fitting exercise** once enough sessions with stored shots exist.

Steps 1–3 are mechanical. Steps 4 and 6 need Makel.

**Where each step stands (2026-10-14).** 1 — declared in the schema files, **applied nowhere** that this document
checked. 2 — the port exists with the symmetric driving fix, the stored-completeness fix and the carry-reference
change; **the `CAL` consolidation is not done** (§5 status note). 3 — done, 193 passing. 4 — signed (answer 17);
the tail extrapolation inside it is **not** signed (§3). 5 — overruled. 6 — **open**. 7 — **open**.

---

## 9. What the ported module does now *(`@ryp/eco/scoring`, commit `2a858d3`, 2026-10-14)*

Everything here was read from `eco/src/scoring/index.ts` and `eco/scripts/scoring-fixtures.mjs`, and the quoted
values were run against `eco/dist/scoring/index.js`. The fixtures were also run: **`193 passed, 0 failed`**.

### 9.1 `SCORING_VERSION`

`export const SCORING_VERSION = 'forge-2026.10-1'`. The fixtures assert its shape (`forge-<year>.<month>-<n>`) and
pin a **behaviour fingerprint** — a SHA-256 over every constant in `CAL` and the output of every index function
across a fixed battery (`scoring-fixtures.mjs:521–526`) — keyed by version. It **fails when `CAL` or an index
function changes without a bump**, which is what stops two calibrations sharing one stamp on a trend line. The
module header says the server stamps it into `golf.facet_scores.scoring_version` on every scoring pass (§2.3) — **no
route exists yet, so nothing has stamped anything.**

### 9.2 🔴 T-125 landing in the scoring layer

T-125 was a woman scored on the men's table through a vocabulary mismatch. B22 removed the `gender` column so no
vocabulary could mismatch — and, because there is no longer a column to default, the argument became *usually
absent*, and **absent still meant the men's table**. The port had inherited `CAL.carry[gender] || CAL.carry.m`.
Ruling 10 fixed it where it lived: `baselineHandicap(yards, carryReference)` maps the reference through an explicit
two-entry table (`pga_scratch` → men's rows, `lpga_d3` → women's) with **no fallback**, and returns `null` for
anything else — `null`, `undefined`, a one-argument call, a misspelling, **and the old `'m'` / `'f'` vocabulary,
which is now rejected rather than silently mapped**. `drivingIndex` propagates the `null`.

Verified against `dist`, 2026-10-14:

```
baselineHandicap(250, null)          = null        baselineHandicap(250)        = null
baselineHandicap(250, undefined)     = null        baselineHandicap(250, 'm')   = null
baselineHandicap(250, 'f')           = null        baselineHandicap(250, 'lpga_d3')      = -1
baselineHandicap(250, 'pga_scratch') = 6.3         drivingIndex(20 fairways, 250, null)  = null
```

The prototype scored a woman carrying 250 yd as 6.3 instead of a plus handicap; before the ruling the port still
returned 6.3 for `(250, null)` and −1 for `(250, 'f')`.

### 9.3 Every departure from `forge-math.js`, in one place

**If a number differs from the prototype, check this list before assuming a porting mistake.** The module header
carries the same list; this mirrors it. *Two numberings exist and are easy to confuse* — "port note N" is the
header's list, **[ruling N]** is `decisions/FORGE-PORT-RULINGS-2026-10-14.md`.

| Port note | Ruling | Departure | Why |
| --- | --- | --- | --- |
| 1 | *(authorised)* | `putt18` is `{ base: 10, k: 9.09 }`; was `{ 8, 1.2 }` | `1.2` was a bug, not a calibration gap — §6. |
| 2 | *(authorised)* | `drivingIndex` counts big misses on **both** sides (zones 0 and 4) | Answer 16 / §2.5a. |
| 3 | *(authorised)* | `currentFacet` takes the stored `is_complete` per facet; no hard-coded 20; **throws** if a facet has a value and no flag | §2.5b. |
| 4 | [10] | `baselineHandicap` / `drivingIndex` take a **carry reference**, not `gender`; `null` for a null / undefined / unknown one; the argument is **required** | §9.2. |
| 5 | [11] | `drivingIndex` returns `null` if **any** zone is not an integer 0–4 | The prototype scored a zone of 7 as a neutral small miss. |
| 6 | [12] | `clampIndex` returns `null` for NaN, ±Infinity or a non-numeric value; `currentFacet` **skips** a non-finite score like a missing one. So `headScoredIndex`, `drivingIndex`, `putt18Handicap` can return `null` where they returned `NaN` or `40` | The prototype clamped `Infinity` to 40.0 — a plausible worst handicap — and let `NaN` make the median depend on input order. |
| 7 | [1] | `facetStrokesGained` returns `null` for an unknown facet (prototype: `0`) | `0` reads as "gained no strokes". |
| 8 | [2] | `daysBetween` **throws** on a malformed or impossible date (prototype: `NaN`); validation is a shape regex plus a UTC round-trip | The first port's check let `'2026-08-'` through as day 0 and rolled `'2026-02-31'` over to March. |
| 9 | [3] | `dispersion` returns `null` for a zone outside the centres array (prototype: an object holding `NaN`) | An object containing `NaN` is silent wrongness with extra steps. |
| 10 | [4] | `totalStrokesGained` / `practiceHandicap` iterate the four known facets, not `Object.keys` | A stray key from a DB text column is ignored, not summed. |
| 11 | [5] | `practiceHandicap` coerces numeric-**string** weights with `Number()`. A null, blank or non-numeric weight for a **scored** facet gives `null` (the prototype counted a null weight as 0 and returned a number from the remaining facets). `currentFacet` and `clampIndex` accept numeric strings too | node-pg returns `numeric` as a string. Without the coercion every database-sourced composite is `null`. |

Added, **not** departures: `SCORING_VERSION` [6]; the `UNSOURCED` tier and its tags on `CAL.carry` and
`CAL.benchmarks` [7, 8], §4.1–§4.2; the `'provisional'` tier and `PROVENANCE.putt18Index` [9].

**Consequence:** any index computed by the prototype is non-comparable to one computed here — because of 1 and 2,
and because a driving index now needs a carry reference to exist at all.

### 9.4 Tags in the module

The legend has five tiers: `MEASURED`, `ESTIMATED`, `GUESS`, `PROVISIONAL` and **`UNSOURCED`** (a table with no
source anywhere in the package, so that neither measured nor derived is true of it). **`CAL.carry` and
`CAL.benchmarks` both carry `UNSOURCED`** (§4.1, §4.2). The fixtures read the tag text above each table
(`scoring-fixtures.mjs`, the `tagAbove('  carry: {')` and `tagAbove('  benchmarks: [')` checks), so a later edit
that restores `MEASURED` fails the suite.

### 9.5 NOT BUILT, and still open

The module header ends with a **NOT BUILT** paragraph naming two things. Both are carried forward:

1. **No gate on the provisional Putt 18 constants.** `CAL.putt18.base` is `PROVISIONAL`, and nothing in the module
   withholds a Putt 18 index: `putt18Handicap` returns a number for any strokes-gained it is given.
   `PROVENANCE.putt18Index = 'provisional'` is a **label** for a screen to read, and nothing reads it. Whoever
   builds the screen or the route owns the gate. (Checklist C1 had this index stored as NULL until fitted; Luke's
   Q1 overturned it for `k`, not for `base`.)
2. **`baselineHandicap` still returns 30 for a missing or zero distance** — `(null, 'pga_scratch')` and
   `(0, 'pga_scratch')` are both 30 (verified). The reference check runs *first*, so a missing **reference** is
   `null` and a missing **distance** is 30; the prototype did the same for distance. It is **not** a departure
   and **no ruling covers it** — which is exactly why it is open. Its effect is in §2.1: a driving index of 28 from
   no distance at all.

Also open, and recorded elsewhere in this document rather than in the header:

3. **The tail below the last populated row** — the `[0, 30]` row is still an anchor, `baselineHandicap(100,
   'pga_scratch')` is 27.3; the extrapolation in §3 is a proposal awaiting Makel, not built.
4. **§5.1 / §5.3 / §5.4** — `CAL.weights`, the level tables and the loose literals are not in `CAL` (§5 status note).
   **The module header's NOT BUILT paragraph does not list these.**
5. **§7** — the provenance reclassification and its derivation from `CAL` tags (§7 status note).
6. **Citing or refuting `CAL.carry`** — step 6, and Luke's Q6.

### 9.6 Where whoever writes `server/routes/forge.ts` will see the integration hazard

node-pg returns `date` as a JS `Date` and `numeric` as a string; the module wants `YYYY-MM-DD` strings and finite
numbers, and now **throws** on a malformed date. It is written up as cross-cutting rule **h** in
`FORGE-ON-RYP-CORE.md` §4, beside the raw-SQL rule every Forge writer already has to read. Not duplicated here.
