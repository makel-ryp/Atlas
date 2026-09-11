# ATR — TASKS
**Last updated:** 2026-09-01 (paused) · Board for [STATUS.md](STATUS.md) · Orientation in [HANDOFF.md](HANDOFF.md)

## How to maintain this file
- One task = one row. **Never delete a row** — move it to §5 Done with the date.
- `ID` is permanent. Next free ID is recorded at the bottom; bump it when you add one.
- Change `State` only to something you *observed*. `✅` requires evidence you can name.
- If you are blocked, say **what** blocks you in `Notes`, not "blocked".

**States:** `🔴 blocked` · `🟡 in progress` · `⚪ open` · `🔵 waiting on someone` · `✅ done`

---

## 1. Now — the critical path to the 2026-09-07 demo

| ID | State | Task | Owner | Notes |
| --- | --- | --- | --- | --- |
| T-02 | ✅ done | Repin Atlas to `@ryp/eco#v0.18.0` | AI | Done 2026-08-31, typecheck clean. Was **not** related to T-01 (v0.18.0 is a SQL-only change). |
| T-24 | ✅ done | **Host on Railway so nothing is demoed from localhost** | AI | Project `proactive-comfort`, service `Atlas`. Env vars set from `.env` via the CLI; `railway.json` added; eco vendored to fix the build. Live at `https://atlas.ryptest.com`, verified end to end. |
| T-44 | 🟡 collection built | The interview — 5 profile questions intake never asked | AI | Luke's profile page renders `FIELDS` (sport, years, limits, time, goal, Dashboard:3783) and said so itself: *"the intake form is not yet wired to a table"*. Built: `shared/interview.ts` (Atlas-owned — items.ts is byte-identical to tgt, verified by diff, so the instrument was NOT forked), `atlas.intake_submissions.interview` jsonb + column grants, PATCH kind 'interview', toEnvelope, and an `InterviewStage` between profile and tier1A. **DISPLAY NOT WIRED** — see T-45. |
| T-49 | ✅ fixed | `/proto/dashboard` was missing its two entitlement middlewares | AI | Its chain was `verifySessionCookieMiddleware, attachUser` — two links where every other authed chain on the server has four (coach.ts:57, intake.ts:69, me.ts:27, notes.ts:14, and proto.ts's own bearerChain at :62). `attachUser` resolves WHO you are, not whether you are still allowed in, so a revoked Atlas entitlement kept the served dashboard until the session cookie expired — up to 8 hours. Added `ensureAtlasAccess(pool)` + `requireApp('atlas')`; both were already imported. |
| T-50 | ⚪ open | `eco/sql/rls_core.sql` is STALE — a rebuild from it breaks signup and intake | AI | Verified live against ep-winter-math-aud1tkwf. (a) rls_core.sql:457 grants `atlas_app` SELECT only on `public.user_app_roles`, but the live DB has INSERT/SELECT/UPDATE and `ensureAtlasAccess` requires the INSERT. (b) no grant at all for `atlas.intake_submissions.interview`, which I added by hand on 2026-09-10 and every intake PATCH now needs. Replaying the checked-in SQL onto a fresh DB breaks signup, admin role writes and all intake writes. |
| T-51 | ⚪ open | The `quality_flag` privilege wall does not exist on INSERT | AI | `intake.ts:369-371` and `eco/src/schema/atlas.ts:241-243` both assert `atlas_app` holds COLUMN-LEVEL insert on 15 of 18 columns with `quality_flag` withheld as 'the enforcement'. Live DB disagrees: `information_schema.table_privileges` shows a TABLE-level INSERT, and `has_column_privilege(atlas_app, quality_flag, INSERT)` is **true**. UPDATE genuinely is column-restricted (false), so the wall is half real. Not exploitable today — `/intake/start` uses explicit-column raw SQL and never names it — but the documented control is fiction. Fix = revoke table-level INSERT, re-grant the 16 intended columns. Not done unilaterally: getting the column list wrong breaks signup. |
| T-46 | ✅ fixed | ProfileForm inverted a plus handicap into the shared golf layer | AI | `handicapIndex: Number(hcp)` — `Number('+2.1')` is `2.1`, but '+2.1' is the golf convention for 2.1 BETTER than scratch and must store as −2.1. A plus golfer typing the convention wrote a 4.2-stroke error into `golf.player_profile.handicap_index`, the layer every RYP app reads, which their coach then saw on the roster. Now uses `parseHandicapIndex` — the same parser intake.ts:606 uses. Proved by running both: Number('+2.1')=2.1 vs parseHandicapIndex('+2.1')=-2.1. |
| T-47 | ✅ fixed | ProfileForm stamped a fabricated handedness on every save | AI | `me.profile?.handedness ?? 'right'` in draftFrom, and submit always sent all five fields — so the first save of ANY field wrote a handedness nobody supplied. Not cosmetic: the dashboard mirrors its dispersion geometry and flips a bias sign on that value (T-42). Select now offers '— not recorded —', submit sends null, and `me.ts` accepts `z.enum([...]).nullable()`. |
| T-48 | ✅ fixed | Intake PATCH kind 'volume' had no domain validation | AI | The one kind with no validator — assigned straight off `z.record(z.unknown())`. That object feeds `computeVolumeBreakdown`, which divides by the effective total to derive `answers.ALLOC`, so a string or a negative reached the scoring adapter and came back as NaN shares in a stored result. Added `validateVolumeInput` to shared/contract.ts; 7 cases run and passing. |
| T-45 | ⚪ open | Show the interview back on the profile page | AI | Two blockers, both flagged in code. (1) `const self = who.id === 'hale'` (Dashboard:3745) — a sample id no real row carries, so the self branch is unreachable, and a player's roster is `[]` anyway, so `who` falls back to EMPTY_PLAYER and `file` is `{}`. (2) A COACH reading a student's interview means reading `atlas.intake_submissions`, and the rls_core tripwire forbids adding a policy there — it needs a `security_invoker` VIEW. |
| T-43 | ⚪ open | Evaluate the rules Luke already wrote | AI | `docs/reports/PROTOTYPE-WHAT-LUKE-ALREADY-BUILT-2026-09-10.md`. `STEPS[n].cond` (advancement criteria) is rendered as text at Dashboard:782 and never evaluated; `FITNESS` reports the exact criterion the `anchor` pivot variant names and is never read; `state.pivot`/`tier`/`phase` are literals with manual togglers. The content and the criteria exist — nothing consumes them. Drill sign-off (`golf.drill_progress.verified_at`) can already satisfy the `cam: true` half. |
| T-42 | ⚪ open | Wire the player's own profile + drill progress into their dashboard | AI | Quick wins from `docs/reports/PLAYER-DASHBOARD-DATA-STATE-2026-09-10.md` §1. `golf.player_profile.handedness` and `.driver_carry_yds` exist and are read for roster rows, but `meBlock` (protoData.ts:318) ships only name/hcp/target, so a player sees `hand:'R'` hardcoded. `golf.drill_progress` likewise reaches a coach via `who.drills` but never the player, so they see 12 fake ticked drills (DONE, Dashboard:2560). No new tables needed. |
| T-41 | ⚪ open | Fabricated SG still rendered on the Performance screen | AI | `Dashboard.dc.html:3017` computes the composite from the `state.forge` literals (14.0/8.0/-3.0/2.0 → 6.95) and `:3145` renders `fmtSG(tHcp - composite)` → -2.0, identical for every player. The rail was rewired to a dash; this screen was missed. STATUS.md said the fabricated numbers were retired — T-12 was right that they were not. Also: two incompatible `sgFor` (Dashboard:2637 vs AtlasPlayer:1130) plus a third borrowing `SG_W.chipping` at :3088. |
| T-40 | 🟡 draft | Coaching-ruleset spec for Luke | Luke | `docs/operations/ASK-luke-coaching-ruleset-2026-09-09.md`. The quiz asks 13 of 71 items, so calibration + performance mastery are permanently null; `computeGrowthZone` skips null zones (scoring.ts:389) so only construction/transfer can ever be the growth zone and 2 of the 4 `GROWTH` prescriptions are unreachable; `recommendedAlloc` instead substitutes `zoneDeficit(null)=0.5` (scoring.ts:363) — a printed assumption. Prescription is consumed only by ResultScreen.tsx; `protoData` sets `tier:''`/`zone:''`. 6 questions for Luke, ordered. |
| T-39 | 🟡 partly verified | Player was routed away from their own dashboard | AI | **Fixed f470dee.** `/proto/dashboard` never had a coach guard and always built the player view (`buildAtlasData(uid,'today',HIDDEN_FOR_PLAYER)`); `App.tsx` routed only coaches to it, so a player fell through to `<Profile />` and the only door was a button labelled "Open the coach dashboard". Also: `?as=` links now carry `&signout=1` (they only prefilled the form, so a stale session made all three demo URLs open the coach view), `as` survives the query strip, and the banner's "← Atlas" points at `/?home=1` so the SPA is reachable. **Verified on live:** all three entry points show distinct labels and correct prefills. **NOT verified:** the signed-in landing for each role — needs a password, which the AI must not use. |
| T-37 | ⚪ open | Remaining review findings | AI | `ProfileForm` handedness defaults to 'right'; a completed run stays PATCHable so an edited handicap never re-reconciles; `isPlausibleIndex` has no caller; `Admin.tsx` grant button demotes, shared reason box, no revoke; `ErrorBoundary` falsely claims answers are saved. |
| T-38 | ⚪ open | Player-side "ready for review" tick | AI | Decision recorded in `eco/sql/rls_core.sql`: a player-owned table, not a column on `drill_progress`. Needs a player-facing surface, which does not exist. |
| T-35 | ⚪ open | Persist a target-handicap slider drag | AI | The slider moves the value for the session but does not save. `PATCH /api/users/me` already owns that row; it needs `targetHandicap` added to its schema and the slider wired to it. |
| T-36 | 🔵 waiting | Read strokes gained from `golf.player_metrics` | Luke | Atlas must not compute SG — `forge.index_expected` is Luke's model and only its output is promoted. `TOTAL SG` stays a dash until Forge writes the metric. |
| T-34 | ⚪ open | `golf.drill_library` so `drill_id` has a referent | AI | `drill_id` is free text today. The three ids come from Luke's `DRILL_DEFS`. Add the FK when the library lands — making it one now would block the feature on a table Luke owns. |
| T-27 | ⚪ open | Publish `@ryp/eco` to a private registry | AI | It is currently vendored into Atlas as a committed `.tgz` because the GitHub SSH form breaks Railway's builder. Works, but every eco release needs a manual repack. GitHub Packages + an `NPM_TOKEN` is the real fix. |
| T-28 | ⚪ open | Migrate `railway.json` to the new config format | AI | Railway CLI warns the old file format stops working **2026-12-01**. `railway config migrate`. |
| T-25 | ⚪ open | Rewrite the demo runbook around the intake | AI | The runbook was written 26 Aug and has 4 steps; it predates Practice DNA and Luke's prototype entirely. Its "cold start" also still says localhost. |

| T-05 | 🔵 waiting | Forge repo from Luke | Luke | **44 of 81 metrics (54%) come from Forge.** Six Dashboard screens cannot show real numbers until it exists. Ask recorded in `operations/ASK-luke-forge-repo.md`. |
| T-06 | ⚪ open | Rehearse `operations/DEMO-RUNBOOK-2026-09-07.md` | Makel | Four steps + break-glass table. Not yet rehearsed against the current build. |

## 2. Next — the intake is proven; these are what follow

| ID | State | Task | Owner | Notes |
| --- | --- | --- | --- | --- |
| T-07 | ⚪ open | Build the **distilled-result table** | AI | The missing third destination. Answers both "can a coach read the result?" and cross-app inference. Today the result is recomputed from `answers` on every read and never stored. |
| T-08 | ⚪ open | Coach read of intake via a `security_invoker` **VIEW** | AI | ⚠️ **Do NOT add a policy to `intake_submissions`.** `rls_core.sql` carries a tripwire saying so; a policy there exposes IPIP01–IPIP20 (Mini-IPIP Big Five) and `quality_flag` to coaches. This was attempted once and reverted in v0.18.0. |
| T-09 | ⚪ open | Fix `contract.ts` / route field mismatch | AI | `contract.ts` declares `createdAt`; the route returns `startedAt`. |
| T-10 | ⚪ open | Retake / lockout semantics | AI | The unique index is **not partial**, and `deleted_at` is **not** in the UPDATE grant — so a retake cannot currently be modelled either way. |
| T-11 | ⚪ open | Version-stamp integrity | AI | `CONFIG_VERSION` / `SCORING_VERSION` / `RESULT_VERSION` are stamped once at write, but the result is recomputed by whatever code is deployed at read time. Those two facts disagree. |
| T-12 | 🔴 next | **Strip `state.forge` — the sidebar shows a fake handicap** | AI | "5 HANDICAP" / "TOTAL SG −2.0" on the main page. Avery is 4.2; Total SG has no producer. Most visible wrong number in the app. Then `SEED`, `DRILL_PICK`. |
| T-32 | ⚪ open | Update the served banner text | AI | Still lists "intake answers" as empty; that section is hidden now. |
| T-33 | ✅ fixed | Luke's coach dashboard printed a plus handicap as `-2.1` | AI | Live reproduction: `makel@pixelcaddie.com` is stored `-1` (a plus-1) and rendered **-1.0** on the coach roster. Two sites used `fx1` (a plain `toFixed`) for a handicap — `rosterVals` (:4098) and `pfHandicapReal` (:3867) — while six others already used Luke's correct `hcpLabel`. Fixed with a guarded `hcpText`, because `hcpLabel(null)` returns '+0.0' (`null <= 0` is true in JS) — the same trap the file's own comment records hitting on `target`. Also removed the `11.4` literal fallback. |

## 3. Backlog — real, unscheduled

| ID | State | Task | Owner | Notes |
| --- | --- | --- | --- | --- |
| T-13 | ⚪ open | Rotate the old `ryp-red` owner credential | Makel | Runbook exists: `operations/RUNBOOK-rotate-ryp-red-owner.md`. |
| T-14 | ⚪ open | `ryp-red` RLS is decorative | AI | Every role on the LIVE Red DB is `BYPASSRLS`, so **no policy binds**. Fixing the policies alone would not close it. |
| T-15 | ⚪ open | Subscription → edge teardown | AI | — |
| T-16 | ⚪ open | **Parental consent gate** | AI | Upgraded from nice-to-have 2026-09-01: the age floor is gone, so an under-13 can now create an account. COPPA applies to under-13s in the US. |
| T-17 | ⚪ open | Put `practice-dna` and `inventory` under git | Makel | Both are currently **not git repos**. Unversioned work is at risk. |
| T-18 | ⚪ open | `drizzle-kit` can no longer migrate | AI | `atlas_app` has no DDL rights. Migrations are applied by hand via the Neon connector with a hand-inserted journal row. Document or fix. |
| T-19 | ⚪ open | Commit the dirty file in `RYP-RED` (`mac` branch) | Makel | 1 uncommitted file. |

## 4. Frozen by decision — do not action, do not re-raise

| ID | Task | Why |
| --- | --- | --- |
| T-20 | Pricing / billing tiers | Awaiting Luke's approval. $99–$799 appears nowhere in the repo. |
| T-21 | Practice DNA as a standalone product | Separate project mid-launch; out of scope until a later phase. |
| T-22 | Push the TGT `dna` branch (1 commit ahead) | Makel: "don't worry about it right now." |

## 5. Done

| ID | Date | Task | Evidence |
| --- | --- | --- | --- |
| D-01 | 2026-08-24 | Firebase login end to end | Sprint 1 run |
| D-02 | 2026-08-24 | Signup auto-provisioning | `ensureAtlasAccess` + `user_app_roles_atlas_signup` |
| D-03 | 2026-08-28 | Coach consent loop, academies, two visibility tiers | eco `5702f81`, `5a8c820` |
| D-04 | 2026-08-28 | Per-app admin scoping | eco `0e9ede2`, atlas `5d19612` |
| D-05 | 2026-08-28 | Admin API + admin screen | atlas `29e2c5c`, `b471183` |
| D-06 | 2026-08-29 | Coaching notes — first cross-user write | atlas `3750cff`; closed 2 RLS holes |
| D-07 | 2026-08-30 | Serve Luke's prototype from real data | atlas `d15d7a4`; zero sample names |
| D-08 | 2026-08-31 | `atlas.intake_submissions` applied to ryp-core | Neon txn, journal hash `26ba3786…` |
| D-09 | 2026-08-31 | Four intake blockers fixed in code | atlas `4e1dec2` (**fixed, not proven** — see T-03) |
| D-10 | 2026-08-31 | Handoff doc set + maintenance rule | this file, STATUS.md, HANDOFF.md, CLAUDE.md ×4, moved into the Atlas repo |
| D-11 | 2026-08-31 | Root-caused B-1 | `42501` observed directly; drizzle-names-all-columns vs column-level INSERT grants |
| D-12 *(closes T-01, T-03)* | 2026-09-01 | **Fixed B-1 — the intake works end to end** | 18/18 smoke assertions; completion verified in `golf.player_profile` + `golf.handicap_history` |
| D-13 | 2026-09-01 | Fixed the silent-looking PATCH (B-3) | `volume`/`alloc` added to `toEnvelope`; resumed runs rehydrate |
| D-14 *(closes T-23)* | 2026-09-01 | Audited every table for the drizzle column-grant bug | `atlas.intake_submissions` was the only one; the other six hold table-level INSERT |
| D-15 | 2026-09-01 | `npm run seed` resets the intake | Row back to `in_progress` / tier 0, confirmed in the DB |
| D-16 *(closes T-04)* | 2026-09-01 | **signup → quiz → result → home driven in a browser** | Fixed 3 defects the API suite could not see (STATUS §3 B-4/5/6); profile written through by the quiz |
| D-17 *(closes T-24)* | 2026-09-01 | **Deployed to Railway** | `https://atlas.ryptest.com`; eco vendored to fix the build, Node pinned to 22, trust proxy |
| D-18 | 2026-09-01 | Closed the open auto-grant | 28,347 shared Firebase accounts could have self-provisioned; `ATLAS_SIGNUP_ALLOWLIST` now fails closed in production |
| D-19 | 2026-09-01 | Fixed 4 client/server validation mismatches | Root-caused into `shared/profile-bounds.ts`; **academy juniors could not complete the intake at all** |
| D-20 | 2026-09-01 | Fixed quiz contrast + divider alignment | `:where(.quiz-root)` reset; registered Tailwind's missing `5.5` spacing step |
| D-21 *(closes T-29/T-30/T-31)* | 2026-09-01 | **Google sign-in live** | Domain authorised; popup path accepted (`popup-blocked`, not `unauthorized-domain`); provider name adopted so a Google user is not shown their email as their name |
| D-26 | 2026-09-01 | **Luke's design is the app** | Sign-in lands on `Dashboard.dc.html`; roles resolve before the intake gate |
| D-27 | 2026-09-01 | Vendored all 3 prototypes + `DESIGNS.md` | AtlasPlayer identified as the Forge front-end from its own localStorage migration |
| D-28 | 2026-09-01 | Intake trimmed to 3 sections | 23 answers not 100; Tiers 1B/2/3 cut from the flow, items left in the pinned instrument |
| D-29 | 2026-09-01 | Video/strike-map + roster hidden by flag | `hidden` list; markup untouched, pristine recoverable from `27b7d4a` |
| D-30 | 2026-09-01 | Fixed plus-handicap data loss | Was written to neither `player_profile` nor `handicap_history` |
| D-22 | 2026-09-01 | **Removed the profile eligibility gates** | No age, speed or handicap refuses an account. 9 and 95 year olds, 38 mph, 60 and 108 handicaps all verified live |
| D-23 *(closes T-26)* | 2026-09-01 | `handicap_history` appends only on a real change | 3 rehearsals at 17.8 append nothing; 15.2 then 16.0 each do |
| D-24 | 2026-09-01 | **Full intake driven end to end on the LIVE site** | Sign-in → 2 volume screens → allocation → 7 profile → 12 items → review → result → "Go to my Atlas" → dashboard. `golf.player_profile` written by the quiz |
| D-25 | 2026-09-01 | Cleaned 6 test rows out of `handicap_history` | Deleted by explicit id via the Neon owner connection, after Makel confirmed; each player left with their one seeded point |
| D-26 | 2026-09-03 | **Coach view bifurcated by role** | Coach rail is Profile + Roster; 12 items → 2. One list per audience, no second app |
| D-27 | 2026-09-03 | **`golf.drill_progress` applied** | 3 policies, RLS forced, per-COLUMN grants — `atlas_app` cannot write `ticked_at`/`watched_at` (`42501` proven) |
| D-28 | 2026-09-03 | **Coach sign-off works end to end in a browser** | Tick persists, `verified_by` = the coach. Browser caught 3 bugs API tests structurally could not — chief among them: the served page authenticates by cookie, and the routes were bearer-only |
| D-34 | 2026-09-08 | **Three demo entry points** | `/?as=<email>`; one seed readies all three. Password deliberately not in the URL |
| D-33 | 2026-09-08 | **Fixed 5 review findings** | Session cookie surviving sign-out; uppercase-uuid audit bypass; alloc derived twice; suffix allowlist; coach unable to sign out |
| D-32 | 2026-09-08 | Six-surface code review | 15 findings, 13 high; one discarded as false after checking |
| D-31 *(closes T-32)* | 2026-09-03 | **Rail rewired — no fabricated numbers left** | `target_handicap` added to eco 0.20.0 and wired; index read from the profile; the two Forge-derived figures show honest dashes |
| D-30 *(closes T-33)* | 2026-09-03 | **Removed the ten-shot video test** | Deleted from the profile section + its 33 lines of bindings + an orphaned rail badge. Player file now reads Handicap history → The interview → sign-off |
| D-29 | 2026-09-03 | Intake tier-2 rejection confirmed fixed on live | The exact 17-slider payload that broke the demo run now returns 200; and the tier is unreachable anyway |

---
**Retired IDs** (closed, kept so no ID is ever reused): T-01 → D-12 · T-03 → D-12 · T-04 → D-16 · T-23 → D-14.

**Retired IDs:** T-26 → D-23 · T-29 → D-21 · T-30 → D-21 · T-31 → D-21.

**Retired IDs:** T-32 → D-31 · T-33 → D-30.

_Next free ID: **T-52** / **D-35**._