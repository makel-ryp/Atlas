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
| `carry`, `benchmarks`, `window` | MEASURED | from published shot data / established practice |

The README says it plainly: *"Open guesses still to fit against real players: `yardsPerShot`, ATG
constants, Putt 18 calibration."*

### The one failing test is the fixture, not the code

```
FAIL  225 yd is half way 10→5   expected 7.5   actual 12.5
```
The carry table is `255→5, 235→10, 215→15`. The midpoint of 10→5 is **245**, which returns 7.5
correctly. `225` is the midpoint of 15→10 and correctly returns 12.5. **The yardage in the fixture
is wrong** (`forge-math.test.js:33`). One-line fix; the maths is sound.

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

## Still unanswered by this package

- Atlas's `ASK-luke-forge-repo.md` §2 benchmark tables, the 5-axis skill radar and the tolerance
  ladder are **not** addressed in the Build Spec's seven sections.
- Nothing here resolves Atlas's own open question for Luke: **Competitive Phase 3 is called
  "Transfer Introduced" and names Transfer on zero of its seven day labels.**
