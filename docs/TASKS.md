# ATR — TASKS
**Last updated:** 2026-09-01 · Board for [STATUS.md](STATUS.md) · Orientation in [HANDOFF.md](HANDOFF.md)

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
| T-04 | ⚪ open | Wire the quiz redirect gate end to end in a browser | AI | `client/src/quiz/` is lifted and wired as a redirect gate, not a tab. Never driven in a real browser. |
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
| T-12 | ⚪ open | Strip remaining prototype literals | AI | Next up: `state.forge` (sidebar), `SEED`, `DRILL_PICK`. |

## 3. Backlog — real, unscheduled

| ID | State | Task | Owner | Notes |
| --- | --- | --- | --- | --- |
| T-13 | ⚪ open | Rotate the old `ryp-red` owner credential | Makel | Runbook exists: `operations/RUNBOOK-rotate-ryp-red-owner.md`. |
| T-14 | ⚪ open | `ryp-red` RLS is decorative | AI | Every role on the LIVE Red DB is `BYPASSRLS`, so **no policy binds**. Fixing the policies alone would not close it. |
| T-15 | ⚪ open | Subscription → edge teardown | AI | — |
| T-16 | ⚪ open | Parental consent gate | AI | Known requirement for minors in academies. |
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

---
**Retired IDs** (closed, kept so no ID is ever reused): T-01 → D-12 · T-03 → D-12 · T-23 → D-14.

_Next free ID: **T-24** / **D-15**._