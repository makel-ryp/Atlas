# FORGE port — the fix checklist

**2026-10-09.** Everything that must change before the migration is generated. Assembled from the
reviewer's own fix list, `rls_forge.sql`'s own 15-item open list, and the consequences of Makel's 24
answers. **Luke will not be supplying answers**, so his six are decided here with the reasoning, and
every one of them is reversible.

Tick an item only with evidence — a file:line, a command and its output, or a query. "No error" is
not evidence.

---

## A · From the reviewer's fix list

| # | Item | Decision |
| --- | --- | --- |
| A1a | Two files claimed `AGENT-BRIEF.md` does not exist | ✅ **DONE** — corrected; the file is `atlas/docs/architecture/AGENT-BRIEF.md` |
| A1b | `golf.practice_commitment` has **no `source_app`**, against §6's "provenance is mandatory" | **Add it.** The deviation was argued from a brief its author had not read. |
| A2 | 🔴 **`entry_method` contradiction.** `forge.ts:387,487,692` say it IS updatable while the parent session is live, and argue the spec's re-entry flow is impossible otherwise. `rls_forge.sql:627,706-707` **withhold it from UPDATE** and `:1702` falsifies that the UPDATE fails. | **`forge.ts` wins — it is updatable while the session is live.** §3.3's "log it shot by shot instead" reuses the facet row, so relabelling must be legal or the flow has no path. Fix the grant and that falsification case. ⚠️ **Also:** `range_shots_facet_shot_uniq` is a **full** unique index while `putt18_holes_facet_hole_uniq` is **partial on `voided_at is null`**. Make `range_shots` partial too, or re-entry cannot void and re-insert. |
| A3 | 🔴 **The carry snapshot was declared blocking and never built.** `FORGE-MATH-ADOPTION.md:34,150-158` calls it *"impossible to backfill"*; `forge.ts` declares only `target_handicap_at_play`. | **Add two columns to the driving facet row:** `carry_yds_at_play` and `carry_reference_at_play`. Without them `drivingIndex` reads the live, player-editable profile and re-scoring a June session in December moves it ~5 strokes per 20 yd — the exact failure `target_handicap_at_play` exists to prevent, left open for the other two inputs of the same formula. |
| A4 | 🔴 **Gender vocabulary fails silently.** `enums.ts:253` ships `GENDERS = ['male','female']`; `forge-math.js:97` is `CAL.carry[gender] \|\| CAL.carry.m`, so `'female'` → `undefined` → **the men's table, no error.** 8.3 strokes at 205 yd. | **Replaced wholesale by Makel's answer (B-22).** There is no `gender` column. See B22. |
| A5 | `identity.ts` says the `created_by <> subject` term is *"NOT WRITTEN YET, see TASKS T-111"* | **It IS written** — `rls_forge.sql:992` and `:1003`. Correct the comment. ⚠️ And the pointer is now actively wrong: **T-111 is the Firebase-key task.** |
| A6 | `golf.handicap_history` gets a **table-wide** INSERT grant (`rls_forge.sql:1193`) in a file that is column-scoped everywhere else — so `forge_app` can write `source_app='atlas'`, `source='ghin'`, and an arbitrary `recorded_at` | **Apply the restrictive per-role pin** the same file already invented for `coaching_notes` (`:1283-1301`). Four lines. The file honestly calls these "unauthenticated labels" rather than claiming them closed — close them. |
| A7 | `verify-schema.mjs` **never iterates `cfg.uniqueConstraints`** | **Add it.** Those four `unique()` constraints are the FK targets for every composite FK in the change set. Drop one in production and `verify:schema` **passes** while the child FKs die. |
| A8 | **The recalibration path `scoring_version` exists for cannot run.** `facet_scores_update` requires `forge_session_is_live(session_id)` with **no bypass branch**, so no role can ever recompute a historic index — it is owner-only. | **Add an explicit `forge_svc` recompute branch.** 🔴 This is load-bearing twice over: it is also **the backfill path for the Putt 18 constants** (C1). Without it, "write the index later once calibrated" is impossible and the null is permanent. |
| A9 | **The 8 `rls_core.sql` §9 edits are not done**, and one silently reverts a security fix | **All eight.** 🔴 `:803` is `grant select, insert, update on atlas.coaching_notes to atlas_app` — **its next run restores table-wide UPDATE and re-opens the hole `rls_forge.sql:1343` just closed.** Restrictive policies survive a re-run; a grant does not. Also: `:441`/`:442` usage+execute for the Forge roles, `:135-136`/`:164-165` per-function EXECUTE, `:436-439` the `create role` block, `:413`/`:611` leave `golf_profile_coach_read` alone (narrowed additively in §5.0), record that `coaching_notes_select` does not filter visibility, and **fix the stale "ALL FOUR ROLES ARE CURRENTLY NOLOGIN" warning at `:425-430`** — all four have LOGIN. |

---

## B · Consequences of Makel's 24 answers

| # | Item | What changes |
| --- | --- | --- |
| B1 | **Rename `prescriptions` → `assignments`** | `atlas.prescriptions` → `atlas.assignments`; `prescription_completions` → `assignment_completions`; `PRESCRIPTION_SOURCES`/`PRESCRIPTION_CADENCES` → `ASSIGNMENT_*`; **all 43 pinned policy names**; and **repoint the three eco files that reserve the name `prescriptions`** or they become stale pointers to a table that does not exist. Gate: `grep -rn prescription` across eco and atlas hits only UI copy and historical docs. |
| B2 | `source='auto'` **ships** | Security unchanged — `auto` is reachable only `TO forge_svc`. But an auto row's `note` must be **templated generically**: carrying `primaryLeak` into `atlas.*` is what METRIC-MAP forbids. |
| B3 | Coaches see shot-grain data | `grant select on golf.range_shots to atlas_app`. |
| B4 | Cadence history | ✅ `golf.practice_commitment_history` already exists. Confirm the apply-to-which-week flag **defaults to next week**. |
| B5 | Forge access = a separate `forge` role row | `user_app_roles_atlas_signup` keeps admitting only `('atlas','user')` — **do not widen it.** ⚠️ An admin "grant Forge access" route + one `Admin.tsx` control is Atlas work and is **on the alpha's critical path**: without it every tester 403s on their first Forge request. Record as a task. |
| B6 | `coaching_notes` append-only **by privilege** | Narrow `atlas_app` to `update (deleted_at, updated_at)`; **drop the `source_app <> 'forge'` predicate entirely.** ⚠️ **`notes.ts` PATCH must change in the same commit or it raises 42501 on the first edit.** |
| B7 | An admin may retract a note | 🔴 Needs an **explicit** `FOR UPDATE USING (app_private.rls_bypass()) WITH CHECK (…)` policy. An intention to be bypass-only, with no policy naming `rls_bypass()`, is **denied by default and matches zero rows silently** — the exact defect this file already nearly shipped. The grant permits the column; the policy decides the principal. ⚠️ Route returns **409**, not 404. |
| B8 | Provisional sessions count toward the streak | Index reads filter `completed_at IS NOT NULL`; **streak and blocks-per-week reads do not.** |
| B9 | Calendar shows two rows | No schema change. Document only. |
| B10 | A coach sees a player's self-set work **read-only** | 🔴 **`assignments_update` must exclude `source='player'` from coach revocation** — not rely on precedence. As designed any approved coach could reword them. |
| B11 | Any approved coach may revoke another's order | Allowed. **Write a `public.admin_audit` row naming the acting coach on every revoke and reword** — it does not prevent the second-account path, it stops it being silent. |
| B12 | The pending-coach tier is enforced | `golf_profile_coach_read` narrowed to `coaches()` additively. ⚠️ `GET /api/coach/students` starts returning `profile: null` for a pending student — **the card must render "awaiting approval", not blank.** Atlas task. |
| B13 | Putt 18 enter-as-a-total survives | `entry_method='tally'`; a complete Putt 18 with **zero** hole rows is legal. §7.4's correlation work filters on `entry_method`. |
| B14 | Driving asymmetry → symmetric | Scoring, not schema. Record in `FORGE-MATH-ADOPTION.md`. Moves every driving index. |
| B15 | `baselineHandicap` → interpolation | **Amend Build Spec §2.3** in `FORGE-ON-RYP-CORE.md`'s supersession table. `forge-math.js` unchanged. **`forge-math.test.js:33`: the INPUT is wrong — 245, not 225.** Suite goes 57/57. |
| B16 | Leaderboards out of v1 | No player-to-player access class. Nothing to build. |
| B17 | Forge notes stay coach-only | Visibility column built into the insert path now; relaxing later is one grant line. |
| B18 | Atlas owns `display_name` | `forge_app` gets **no** write grant on `public.users`. |
| B19 | `CAL.benchmarks` ships | **Downgrade its `MEASURED` tag to `UNSOURCED`** — Makel chose the numbers; the provenance tag is a separate claim with no source in the package, and the app's own comment contradicts it. |
| B20 | 30-minute block permanent | ✅ Unstored. `BLOCK_MINUTES = 30` as a constant only. |
| B21 | Makeables carries the putting rungs | The rung applies to `mode='makeables'` only; Putt 18 produces the index and has no levels. |
| B22 | 🔴 **No `gender` column. Ask for the carry reference.** | `golf.player_profile.carry_reference`, `text`, **nullable, no default**. Replace `GENDERS` with `CARRY_REFERENCES`. An **explicit mapping layer** translates it to `forge-math`'s key. **Null ⇒ no driving index is computed at all.** This dissolves A4 by construction: there is no vocabulary left to mismatch. Gate: `grep -rn gender` across eco and atlas hits only historical docs. |

---

## C · Luke's six, decided without him

He is not supplying answers. Each of these is reversible, and none changes table shape except where
noted.

| # | Question | Decision, and why it is safe to make it |
| --- | --- | --- |
| C1 | **Putt 18 `base` / `k`** — his spec says twice they must not be guessed | **Store the measured part, withhold the modelled part.** `expected_putts` and per-hole SG are computed from a **published curve** (`0.60 + 0.46·ln(max(d,2))`) and frozen at time of play — those are measured and get stored. The handicap-scaled putting `practice_index` is **left NULL** until the constants are fitted. ⚠️ **This creates a backfill, so A8 is now mandatory, not optional** — the `forge_svc` recompute branch is the only path that can ever fill it. |
| C2 | **Which "behind" is the coach's flag** — his §5.4 says a cadence miss; both his prototypes compute an assignment-completion miss | **Build both, named separately. Do not pick.** They are two different facts about a player and they disagree regularly — someone can practise five times a week and ignore every prescription. Both are derived on read, so **no columns and no migration**. The coach sees `behind_cadence` and `behind_assigned`, and whichever one Luke meant is already there. |
| C3 | **Mid-week `blocks_per_week` change** | **History sibling built; default next week.** Already done. Current-week-only is gameable: drop your target to 1/week and you are instantly "on track" while the coach's flag silently clears. |
| C4 | **The Console note panel prefills and overwrites** | **Moot.** There is no Coach Console — Atlas is the only coach surface (2026-08-24). Close it. |
| C5 | **The prototype lets a player set their own rung** | **His spec wins.** §4: *"The ladder is the only thing that sets level"*; §5.5: *"No API accepts a coach-supplied level."* The tap at `FORGE.dc.html:3490`/`:4821` is a debug affordance and does not survive. A rung is writable only by `forge_svc`. |
| C6 | **Where `CAL.benchmarks` came from** | **No source exists, so the tag goes.** `MEASURED` → `UNSOURCED`. The numbers ship (Makel's call); the unsupported provenance claim does not, because everything downstream trusts a tag. |

---

## D · Found in `rls_forge.sql`'s own open list — not previously tracked

| # | Item | Decision |
| --- | --- | --- |
| D1 | 🔴 **`golf.facet_rung_events` has no idempotency key and completion is two transactions.** A retried `/complete` can double-promote. | **Add an idempotency key** and make the event insert `ON CONFLICT DO NOTHING` on `(session_id, facet)`. A ladder that can double-promote on a flaky connection is worse than one that is slow. |
| D2 | **Per-lie chipping rungs.** The spec says chipping levels *"track independently per lie"* (fairway, rough, bunker). | **Check whether `facet_rungs` models it.** If the key is `(user_id, facet)` it cannot — chipping needs `(user_id, facet, lie)`. Either widen the key or record the deviation explicitly. |
| D3 | **Grant/CHECK drift:** the live `player_profile_target_handicap_range` CHECK (−6..30) exists in the database and in `golf.ts`, but `drizzle-kit` does not emit it. | Record it in the migration note so the next `generate` diff is not read as a regression. |
| D4 | 🔴 **A LIVE ATLAS HOLE, found by this work and nothing to do with FORGE.** `users_coach_read` is `app_private.coaches_or_pending(id)` — and **a pending coach edge is SELF-ISSUED**: any signed-in user may INSERT a pending `coach_of` edge naming any stranger. RLS scopes ROWS, not COLUMNS, so that stranger's **whole `public.users` row** becomes readable — including **`date_of_birth`, `parental_consent_at` and `plan`, for a minor.** | **Separate task, higher priority than the port.** The fix is not a narrower grant — `attachUser` uses drizzle `findFirst`/`.returning()`, which name every column, so column-scoping breaks the lookup with 42501. It is a `security_invoker` **VIEW** projecting `(id, display_name)` for the coach read, with the base-table policy narrowed to `coaches()`. Same remedy already agreed for `atlas.intake_submissions`. The identity-card trade was defensible for a **name**; it was never argued for a date of birth. |

---

## Gates — none of these is "it compiles"

1. `npx tsc --noEmit` in eco → exit 0.
2. `grep -rn prescription` across eco + atlas → only UI copy and historical docs.
3. `grep -rn gender` across eco + atlas → only historical docs.
4. `drizzle-kit generate` → read the SQL. **The only expected DROP is `handedness`'s default.**
5. Every column named in a `grant (...)` in `rls_forge.sql` exists in `forge.ts` — mechanical diff, 0 mismatches.
6. Every policy created is pinned in `verify-schema.mjs`, and none pinned-but-absent.
7. A test asserting the `carry_reference` → `forge-math` key mapping: **the LPGA scale must not score on the men's table, and null must return no index.**
8. `node forge-math.test.js` → **57/57** after the fixture input is fixed.
9. Applied to the **alpha Neon branch**, never `main`. `rls_forge.sql` §10.0 runs **first** — if a policy does not bind, nothing below it means anything.
10. The falsification block runs as a **real login** as `forge_app`/`forge_svc`, not `SET ROLE` from the owner, and asserts `ROW_COUNT` **and** the SQLSTATE per case.
