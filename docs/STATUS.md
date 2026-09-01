# ATR — STATUS

**Owner:** Makel (makel@rypgolf.com) · **Last hand-edited:** 2026-08-31 · **Demo:** 2026-09-07

> ### ⛔ READ THIS BEFORE ANY OTHER LINE
> **The real Atlas repo is `~/dev/ATR/atlas`.**
> `~/Desktop/ATR/websites/atlas` is a **decoy** — an old stub holding Luke's raw `.dc.html`
> handoff files and nothing else. It is not a git repo and nothing there is live. Some tool
> configurations still open it as the working directory. If you `ls` and see a `handoff/`
> folder, **you are in the wrong place.**
>
> The shared backend library is `~/dev/ATR/eco` (published as `@ryp/eco`). Everything else
> (`~/Desktop/ATR/apps/*`, `~/Desktop/ATR/websites/tgt`) is a sibling app, not Atlas.

New here? Read **[HANDOFF.md](HANDOFF.md)** first — it is the zero-context orientation.
Work items live in **[TASKS.md](TASKS.md)**.

---

## 1. Repo state

<!-- AUTO:START -->
_Regenerated 2026-08-31 21:17 CDT by `docs/refresh-status.sh`._

| repo | path | remote | branch | uncommitted | unpushed |
| --- | --- | --- | --- | --- | --- |
| atlas | `~/dev/ATR/atlas` | makel-ryp/Atlas | main | **4 file(s)** | **1 ahead** |
| eco | `~/dev/ATR/eco` | RYPGolf/ryp-eco | main | **1 file(s)** | **1 ahead** |
| tgt | `~/Desktop/ATR/websites/tgt` | makel-ryp/TGT | dna | clean | **1 ahead** |
| RYP-RED | `~/Desktop/ATR/apps/RYP-RED` | makel-ryp/RYP-RED | mac | **1 file(s)** | pushed |
| locker-room | `~/Desktop/ATR/apps/locker-room` | makel-ryp/locker-room | feature | clean | pushed |
| debrief | `~/Desktop/ATR/apps/debrief` | yanyanarti/debrief | master | clean | pushed |
| practice-dna | `~/Desktop/ATR/apps/practice-dna` | **not a git repo** | — | — | — |
| inventory | `~/Desktop/ATR/apps/inventory` | **not a git repo** | — | — | — |

- **@ryp/eco version:** `0.18.0`  •  **pinned in Atlas as:** `github:RYPGolf/ryp-eco#v0.18.0`
- **Atlas HEAD:** `0f125a7 Add CLAUDE.md — repo rules and the doc-maintenance contract`
<!-- AUTO:END -->

Regenerate the block above with:

```bash
~/dev/ATR/atlas/docs/refresh-status.sh
```

---

## 2. What is BUILT and VERIFIED

Each line here was observed working. Do not rebuild any of it.

| Area | State | Evidence |
| --- | --- | --- |
| Firebase login → session cookie → `public.users` row | ✅ live | Sprint 1 end-to-end run, 2026-08-24 |
| Signup auto-provisioning (`ensureAtlasAccess`) | ✅ live | grants `('atlas','user')` via the `user_app_roles_atlas_signup` policy |
| Per-app admin scoping (`is_app_admin(app)`) | ✅ live | an admin of one app cannot write roles for another |
| Coach ⇄ player consent loop | ✅ live | request / subject_decides / actor_ends, per-command policies |
| Academies (coach sees players in their academy) | ✅ live | `coaches_via_academy()` |
| Two visibility tiers (identity vs metrics) | ✅ live | `coaches_or_pending()` = identity, `coaches()` = metrics |
| Admin API + admin screen | ✅ live | commit `29e2c5c`, `b471183` |
| Coaching notes — first cross-user write | ✅ live | commit `3750cff`; exposed and closed 2 RLS holes |
| Luke's prototype served from real DB | ✅ live | commit `d15d7a4`; **zero sample names remain** |
| `atlas.intake_submissions` table + RLS applied to ryp-core | ✅ applied | one Neon transaction, journal hash `26ba3786…` |
| `POST /api/intake/start` unauthenticated → 401 | ✅ verified | smoke test 2026-08-31 |

## 3. What is BROKEN — top blocker

### 🔴 B-1 · `POST /api/intake/start` → 403. Root cause found 2026-08-31.

```
[[DIAG]] code 42501  "permission denied for table intake_submissions"
```

**Observed, not inferred** — captured by temporarily logging `err` in the `intake.ts` catch and
hitting the endpoint on a scratch server.

**The cause.** Drizzle names **every column** in an INSERT, passing `default` for the ones you did
not set:

```sql
insert into "atlas"."intake_submissions"
  ("id","user_id","instrument","source_app","tier_completed","profile","volume","alloc",
   "answers","config_version","scoring_version","result_version","status",
   "quality_flag","started_at","completed_at","updated_at","deleted_at")
values (default,$1,default,default,default,default,default,default,default,$2,$3,$4,
        default,default,default,default,default,default)
```

`atlas_app` holds **column-level** INSERT on 15 of the 18 columns. The three it does *not* hold are
**`quality_flag`, `started_at`, `deleted_at`** — deliberately withheld, because a client must not be
able to set its own quality flag, backdate a run, or soft-delete on insert.

**Postgres requires the INSERT privilege on every column the statement NAMES — even when the value
is `DEFAULT`.** So the statement is refused, and `intake.ts:280` translates `42501` into
`403 forbidden`.

**Ruled out, with evidence — do not re-investigate these:**

| Suspect | Ruled out by |
| --- | --- |
| The auth chain | `GET /api/users/me` uses the *identical* `identityChain` and returns 200 |
| `requireApp('atlas')` | it emits `{"error":"app_access_denied"}`, a different body |
| The RLS policy | a hand-written INSERT naming only the 4 granted columns **succeeds** as `atlas_app` |
| Missing column grants generally | all 18 columns have SELECT; 15 have INSERT |
| A stale server process | server started 20:58:35, commit `4e1dec2` landed 20:57:06 |
| The eco pin drift | v0.17.0 → v0.18.0 is a **SQL-only** change; the TypeScript is identical |

**The fix is a design decision, not a one-liner.** Granting INSERT on those three columns defeats
why they were withheld. The options are (a) have the route insert with explicit SQL naming only the
granted columns, (b) insert through a `security_invoker` view that exposes only the writable
columns, or (c) accept table-level INSERT and enforce the three columns with a `BEFORE INSERT`
trigger or a `WITH CHECK` that pins them to their defaults. Tracked as **T-01**.

> ### ⚠️ This is not an intake bug — it is an ecosystem-wide pattern
> **Every table in this project that uses column-level INSERT grants with a drizzle insert has this
> bug**, and it will present as a confusing `42501` that looks like RLS. Audit the others before
> assuming intake is special.

### 🟢 B-2 · eco pin drift — RESOLVED 2026-08-31

Atlas was pinned to `@ryp/eco#v0.17.0` while eco's HEAD was v0.18.0. **Repinned and installed at
v0.18.0**; typecheck clean. Worth knowing: v0.18.0 is a *SQL-only* revert, so this was **never** a
candidate cause for B-1. Recorded so nobody spends an hour on it.

## 4. What is UNVERIFIED (blocked behind B-1)

These assertions are written and ready to run, but have never passed:

1. `start` twice for one user resumes the same row (no `42P10`)
2. ALLOC summing to 87.5 is **accepted**; a single share of 150 is **rejected**
3. `answers` must **not** contain an `ALLOC` key after save (derived at score time only)
4. `PATCH {kind:'volume'}` → 200
5. A second user reading the first's submission → 404/403, **never 200**
6. `quality_flag` never appears in any response body
7. Setting `deleted_at` fails **loudly** with `permission denied for table intake_submissions`

The smoke-test harness that runs these is described in [HANDOFF.md](HANDOFF.md) §5.

## 5. Structural facts that constrain everything

- **Forge is the critical dependency.** Of the 81 metrics in Luke's prototypes, **44 (54%) are
  produced by Forge**, which Luke is actively building and has **not delivered**. Six of his
  twelve Dashboard screens cannot show real numbers until Forge exists. No amount of Atlas work
  changes this.
- **Practice DNA has 118 real runs** (2026-08-19 → 08-31) in the TGT-live DB. 48% reach tier 3,
  **39% stall at tier 1**, tier 4 is never used. `user_id` is populated on **zero** rows — the
  live quiz is anonymous, so none of that data can be attached to an Atlas account retroactively.
- **Luke is ideation only.** He does not clone, review, or merge. There is no second developer.
- **Pricing is frozen** until Luke approves. The $99–$799 tiers appear nowhere in the repo.

## 6. Deferred by decision — do not raise these as blockers

| Item | Why |
| --- | --- |
| Practice DNA standalone product | Separate project mid-launch; out of scope until a later phase |
| Pricing / billing | Awaiting Luke's approval |
| TGT push (`dna` branch, 1 commit unpushed) | Makel: "don't worry about it right now" |
| Subscription → edge teardown | Not yet scheduled |
| Parental consent gate | Known requirement, not yet scheduled |

---

**Maintenance rule:** if you changed code, you change this file in the same turn. See
[CLAUDE.md](../CLAUDE.md).
