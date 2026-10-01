# FORGE — context and quick reference

**Package received 2026-09-30** · `~/Downloads/FORGE-package/` · spec dated **v1 · August 2026**

Everything below was read first-hand from the package. Where a number is quoted, the provenance tag
Forge itself assigns is quoted with it — Forge tags its own constants, and that distinction is the
most important thing in the package.

| File | What it is |
| --- | --- |
| `FORGE Build Spec.dc.html` | **The contract.** 7 sections. Its own words: *"the HTML prototype is the visual reference; this document is the contract. Where the two disagree, this document wins."* |
| `build/forge-math.js` | 337 lines, pure scoring. No DOM, no state, **no clock reads** (today is always passed in). 22 exports. |
| `build/forge-math.test.js` | 57 fixtures. **56 pass, 1 fails — and the failing one is the TEST, not the code** (see below). |
| `FORGE.dc.html` | The player app prototype, 5,100 lines. |
| `FORGE Coach Console.dc.html` | Coach-side console, 922 lines. |
| `support.js`, `doc-page.js` | Runtime for the `.dc.html` files. Not product code. |

---

## 🔴 THE HEADLINE: Forge is specified as a SEPARATE application

This is the decision to make before anyone builds it, and it is not a detail.

**The spec never mentions Atlas, ryp-core, or a shared database.** Verified by search: zero
occurrences of "Atlas" or "ryp-core" in any of the three `.dc.html` files.

What it specifies instead:

- **`Supabase auth`** (§6.2) — Atlas authenticates against **Firebase** (`rypstick-ios`, the project
  shared with the live iOS app). `players.id` is documented as *"Matches auth user id"*, meaning
  Supabase's `auth.uid()`, not Atlas's `public.users.id` or `firebase_uid`.
- **Its own Postgres**, with its own RLS, its own migrations, its own API.
- **Its own copies of entities Atlas already owns:**

| Forge table | Atlas already has | Collision |
| --- | --- | --- |
| `players` (`usga_handicap`, `avg_carry_yds`, `target_handicap`, `gender`) | `golf.player_profile` (`handicap_index`, `driver_carry_yds`, `target_handicap`, `handedness`) | **Two sources of truth for a golfer's handicap.** |
| `coach_players` (`coach_id`, `player_id`, `status`, `accepted_at`) | `public.user_relationships` (`coach_of`, `status`, `approved_at`) | **Two coaching-relationship graphs.** |
| `coach_notes` (append-only, *"not visible to the player in v1"*) | `atlas.coaching_notes` (3 visibility tiers, **including shared-with-player**) | Two note stores, and **opposite defaults on player visibility**. |
| `assignments` | `atlas.prescriptions` — named in 3 files, **defined in none** | Forge has designed the table Atlas has been missing. |

**Why this matters:** the whole ecosystem architecture is Atlas-as-identity-nucleus — one
`firebase_uid` per human, one profile, read by every app. Two user tables on two auth providers is
the thing that architecture exists to prevent. §6.2 also says *"Coaches use a separate web app; the
two clients share the API and nothing else"* — so Forge assumes a second coach app too, while Atlas
already has a coach surface in production.

**This is Makel's call and it is urgent**, because the spec's stated purpose is *"everything needed
to rebuild FORGE against a real backend"* — i.e. someone is about to build exactly this.

---

## Forge's data model (§1)

| Table | Grain | Notes |
| --- | --- | --- |
| `players` | one per golfer | `rungs` jsonb = current ladder level per facet. |
| `sessions` | one per range visit | `played_on` is **local date at the range, not UTC**. `seed` drives all generated content and **must persist** — a new seed changes the test mid-session. |
| `session_facets` | one per facet scored | `index_value` clamped −6…40. `is_complete` computed on write; **every consumer reads the flag rather than re-deriving a threshold**. |
| `shots` | one per ball struck | **NEW — does not exist in the prototype.** *"The prototype discards all of this at save, which blocks every analytics feature. Store it from day one — the volume is trivial and backfill is impossible."* |
| `putt18_holes` | one per hole | `expected_putts` **stored, not recomputed** — so a future curve change cannot silently rewrite history. |
| `assignments` | one per prescription | `source` enum `coach·player·auto`. **No `level` field.** |
| `schedules` | one per player | `blocks_per_week` 1–7. Session length is **always 30 minutes** and is not stored. |
| `coach_notes`, `coach_players` | — | See the collision table above. |

### Four rules the spec flags as load-bearing

1. **The composite index is derived, never stored.** *"Two copies will drift."*
2. **An incomplete drill never becomes a headline number.** Completeness is **per drill** — 20 shots
   for shot-count drills, 18 holes for Putt 18. *"Never hard-code 20."*
3. **Lower is better, everywhere.** Negative indices print with a leading `+` (golf convention).
4. **Every assignment carries a `source`.** `coach` > `player` > `auto`.

---

## Ownership: who sets what (§5)

This answers *"wire it to each coach's profile"* — **but not in the way that was framed.**

- A coach assigns **facet, mode, cadence, note** — to one or more players.
- **§5.5: "A coach assigns the drill, never the level."** Level is owned by the ladder, earned by
  clearing and lost after three straight misses. *"No API accepts a coach-supplied level."*
- Coaches do **not** have a personal drill set on their profile. There is one shared set of six
  drills across four facets; the prescription is a per-player row authored by a coach.
- §5.2 **Inertness**: when an assignment is outstanding, other drills stay *tappable but marked
  inert* — they score and store normally but do not satisfy the assignment. *"A player who wanders
  is never blocked, but is never confused about whether the prescribed work is done."*
- Completion *"is computed from the arriving session, never from a player tapping done."*

➡️ So `public.coach_profiles` (which Atlas found exists, fully granted, and entirely unwired) is
**still not** the right home for a prescription. Forge agrees with Atlas's own finding: a
prescription is a (coach, player, drill, when) edge, not a column on a coach.

---

## The scoring module (`build/forge-math.js`)

Pure, testable, 22 exports. Highlights:

- `baselineHandicap(yards, gender)` — carry → handicap, **linearly interpolated**. *"A step table
  would put 234 and 236 yards a full stroke apart."*
- `drivingIndex`, `headScoredIndex`, `atgAllowance`, `expectedPutts`, `putt18Handicap`
- `currentFacet` / `currentPicture` — median of recent sessions with half-life weighting
- `facetStrokesGained`, `totalStrokesGained`, `practiceHandicap`
- `DIRECTION` + `isBetter(metric, a, b)` — so nothing has to remember which way a metric runs
- `PROVENANCE` — splits **measured** (`fairwaysHit`, `bigMisses`, `puttsTaken`, `drillScore`,
  `averageDistance`) from **modelled** (`facetIndex`, `strokesGained`, `biasCost`, `dispersion`,
  `practiceHandicap`). Atlas should carry this distinction through to the UI.

### ⚠️ Constants NOT yet fitted — do not present these as measurements

Forge tags every tunable. These are the ones it admits are unfitted:

| Constant | Tag | Value |
| --- | --- | --- |
| `yardsPerShot` | **GUESS** | `0.06` — yards of RMS dispersion per shot a round, for driving bias cost |
| `atg` | **GUESS** | `perYard 0.022, baseYards 12, rungStepYards 4, shortSided 0.35` |
| `putt18` | **PROVISIONAL** | `base 8, k 1.2` — *"Both numbers must be calibrated against known reference rounds."* |
| `sgRate`, `se20`, `expPutts` | ESTIMATED | derived from published slopes, defensible but not measured |
| `carry`, `window` | MEASURED | from published shot data / established practice |
| `benchmarks` | **MEASURED — but contradicted by Forge's own source** | see below |

### ⚠️ Two benchmark tables that disagree, one of them mis-tagged

Forge ships **two**:

- `forge-math.js:56` `CAL.benchmarks`, tagged **MEASURED**: hcp 0 → 250 yd / 62% fairways
- `FORGE.dc.html` a local `BENCH` cited to *"Arccos Driving Distance Report (men, ~25M rounds)"*,
  with yardages scaled by `ROLL_F = 0.92` to convert total into carry

At handicap 12.5 these give **220 yd / 50%** versus **207 yd / 45.3%** — 13 yards and ~5 fairway
points apart. And the app's own comment rejects the other table's number: *"flatter than folklore:
scratch–4.9 hit 50%"*, against the **62%** `CAL.benchmarks` carries under a MEASURED tag.

**Do not treat `CAL.benchmarks` as measured.** Decide which table is real before either is shown.

### ⚠️ The facet weights are not where the module says all numbers must live

`forge-math.js` opens with *"Nothing outside this object may contain a magic number."* The composite
weights break that rule: `practiceHandicap(valuesByFacet, weights)` takes them as a **parameter**,
and they are absent from `CAL` entirely. They live untagged in the app and the spec
(driving 0.30 · approach 0.35 · chipping 0.15 · putting 0.20).

🔴 **And `forge-math.test.js:136` has chipping and putting SWAPPED (0.20 / 0.15).** Copy the weights
from the Build Spec or the app — **never from the test file**.

The README says it plainly: *"Open guesses still to fit against real players: `yardsPerShot`, ATG
constants, Putt 18 calibration."*

### 🔴 The failing test is a THREE-WAY CONFLICT, not a typo

**This entry was wrong in the first draft of this document and is corrected here.** It was first
written up as "a bad fixture, one-line fix, the maths is sound." It is not that.

```
FAIL  225 yd is half way 10→5   expected 7.5   actual 12.5
```

Three different answers exist for the same input:

| `baselineHandicap(225)` | value | source |
| --- | --- | --- |
| **Build Spec** | **15** | *"First row where `carry ≥ threshold` wins"* — an explicit **STEP** table |
| **`forge-math.js`** | **12.5** | **linear interpolation** between table rows (`:96`) |
| **test fixture** | **7.5** | interpolation at **245**, not 225 (`forge-math.test.js:33`) |

So the fixture's yardage is wrong *and* the module does not implement what the spec specifies.
**By the spec's own precedence rule — *"where the two disagree, this document wins"* — the shipped
module is non-conformant.**

⚠️ **But the module is probably right and the spec probably wrong.** `forge-math.js:94` states the
reason: *"A step table would put 234 and 236 yards a full stroke apart."* Verified — under the
spec's step model **234 yd → 15 and 236 yd → 10**. Two yards of carry, five handicap strokes.

**This needs a decision, not a patch**, and it moves every driving index. Three things must end up
agreeing: the spec's model, the module's model, and the fixture's input.

---

## Known stubs — Forge's own list (§6.4)

Worth reading because one of them is the exact failure mode Atlas spent a month removing:

- **Demo seed** — *"eight fabricated sessions ship as the default state, so a genuinely new user
  starts with fake history and a fake leak. Must be behind a flag."*
- **Coach roster stats** — hardcoded to four seeded player ids; *"any real player renders as zeros."*
- **Launch-monitor import** — *"fabricates values, ignores the file."*
- **Teams and leaderboards** — *"data shapes with no server."* Invite/join/challenge are toasts.
- **Photo tally** — **cut, not deferred.**
- **Export my data**, **install to home screen** — toasts.

---

## What Atlas can use today

| Item | Usable now? |
| --- | --- |
| `forge-math.js` | **Yes** — pure, dependency-free, testable. Could be vendored like `@ryp/eco`. |
| The `assignments` design | **Yes as a design** — it is the `atlas.prescriptions` shape, already reasoned through. |
| `PROVENANCE` measured/modelled split | **Yes** — a convention Atlas should adopt verbatim. |
| Practice indices for Atlas's Transfer / Performance screens | **No.** Nothing persists them yet. Those screens stay hidden (`FORGE_ONLY_SCREENS`) until a producer exists. |
| Drill library | **No** — Forge has six drills across four facets; Atlas has 35 review items on a five-step build. **These are different catalogues, not one catalogue in two places.** |

---

## Open questions for Makel

1. **One backend or two?** Supabase + its own `players`/`coach_players`/`coach_notes`, or Forge
   built against ryp-core with Firebase identity? Everything else follows from this.
2. **If one backend:** `assignments` becomes `atlas.prescriptions`; `coach_players` collapses into
   `public.user_relationships`; `coach_notes` into `atlas.coaching_notes` — noting Forge wants them
   player-invisible in v1 and Atlas's already support a shared tier.
3. **Whose handicap wins?** Forge's `players.usga_handicap` is self-reported and re-asked weekly;
   Atlas's `golf.player_profile.handicap_index` is the intake answer. Two numbers, one golfer.
4. **Do Forge's six drills and Atlas's 23 plan drills ever meet?** They look like different
   products — Forge scores facets, Atlas runs a construction ladder.
5. **Who fits the GUESS constants**, and against which players?

---

## Against Atlas's three formula conflicts (`ASK-luke-forge-repo.md` §1)

| Conflict | Forge's answer |
| --- | --- |
| **§1a composite index** | ✅ **RESOLVED** in favour of the renormalised, played-only form. `practiceHandicap` (`forge-math.js:276`), stated as a contract in the Spec: *"Weights of scored facets are renormalised — a session that skipped putting is not penalised for it."* Plus the rule Atlas needs: **"The composite index is derived, never stored."** |
| **§1b transfer gap** | ❌ **NOT ANSWERED — Forge has no transfer gap at all.** The only occurrence of "transfer" in the whole package is marketing copy. Forge deliberately refuses the comparison: its own help text reads *"Practice Handicap — Not your USGA handicap."* **Atlas must define this itself or drop it.** |
| **§1c `sgFor`** | 🟡 **Shape resolved, constants are a THIRD set.** Forge uses `(target − value) × rate`, which is Dashboard's shape — AtlasPlayer's handicap-anchored model is rejected. But Forge's rates are `{driving .34, approach .42, chipping .13, putting .11}` (ESTIMATED) against Dashboard's `{.30, .35, .15, .20}`. ⚠️ **Dashboard's `SG_W` is literally the composite weight vector reused as an SG rate** — Forge separates the two explicitly: *"These are absolute rates, NOT shares."* |

⚠️ **Semantic trap in §1c:** Forge's `target` is the player's **self-set goal** handicap (*"the goal,
not the current state"*), not a peer expectation at their handicap. So Forge's figure means *strokes
between you and your goal* and **must not be labelled plain "SG"** beside a tour-style strokes-gained
number.

---

## Still unanswered by this package

- The **5-axis skill radar** and the **tolerance ladder** from §2 of the ask are not addressed.
  (The benchmark tables ARE addressed — twice, inconsistently. See above.)
- **No practice index is persisted anywhere**, so Atlas still has no producer to read.
- Nothing here resolves Atlas's own open question for Luke: **Competitive Phase 3 is called
  "Transfer Introduced" and names Transfer on zero of its seven day labels.**

---

## How this document was built, and what is still soft

Written from a first-hand read of the Build Spec and `forge-math.js`, then checked by a five-lane
survey with an adversarial verification pass. **All five verification lanes returned `holds=false`**
— they caught real precision failures in the first-pass survey, and two of those corrections landed
on this document (the failing test, and the benchmark tables).

Claims here are the ones that survived verification or that were re-checked by hand. The deeper
per-screen detail of `FORGE.dc.html` (5,100 lines) has had one pass, not two — treat specific
line-level claims about the player app as less settled than the Spec and `forge-math.js` material,
which have both been read directly.
