# ATR — STATUS

**Owner:** Makel (makel@rypgolf.com) · **Last hand-edited:** 2026-09-01 · **Demo:** 2026-09-07

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
_Regenerated 2026-09-01 11:59 CDT by `docs/refresh-status.sh`._

| repo | path | remote | branch | uncommitted | unpushed |
| --- | --- | --- | --- | --- | --- |
| atlas | `~/dev/ATR/atlas` | makel-ryp/Atlas | main | **2 file(s)** | pushed |
| eco | `~/dev/ATR/eco` | RYPGolf/ryp-eco | main | **1 file(s)** | **1 ahead** |
| tgt | `~/Desktop/ATR/websites/tgt` | makel-ryp/TGT | dna | clean | pushed |
| RYP-RED | `~/Desktop/ATR/apps/RYP-RED` | makel-ryp/RYP-RED | mac | **1 file(s)** | pushed |
| locker-room | `~/Desktop/ATR/apps/locker-room` | makel-ryp/locker-room | feature | clean | pushed |
| debrief | `~/Desktop/ATR/apps/debrief` | yanyanarti/debrief | master | clean | pushed |
| practice-dna | `~/Desktop/ATR/apps/practice-dna` | **not a git repo** | — | — | — |
| inventory | `~/Desktop/ATR/apps/inventory` | **not a git repo** | — | — | — |

- **@ryp/eco version:** `0.18.0`  •  **pinned in Atlas as:** `file:vendor/ryp-eco-0.18.0.tgz`
- **Atlas HEAD:** `0b65731 One source of truth for the widened profile bounds -- juniors were locked out`
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
| **Practice DNA intake, API** | ✅ verified | 18/18 smoke assertions, 2026-09-01 |
| **signup → quiz → result → home, in a browser** | ✅ verified | driven end to end 2026-09-01; `golf.player_profile` written by the quiz (4.2, right-handed), not the seed |
| **Deployed to Railway** | ✅ live | `https://atlas.ryptest.com` — project `proactive-comfort`, service `Atlas`. Health 200, SPA serves, API 404s as JSON, unauth 401 |
| Atlas auto-grant is gated | ✅ verified | `ATLAS_SIGNUP_ALLOWLIST=@rypgolf.com`; an account outside it gets 403, inside gets 200 |
| Juniors (13+) can complete the intake | ✅ verified live | ages 13/14/17/85 and a 45 mph swing all save; 12 and 90 refused |
| `npm run seed` resets the intake | ✅ verified | row back to `in_progress` / tier 0, confirmed in the DB |

## 3. What is BROKEN — top blocker

### ✅ B-1 · FIXED and VERIFIED 2026-09-01. Kept here as the record.

`POST /api/intake/start` returned `403` for every authenticated user. **18/18 smoke assertions now
pass**, including completion writing through to `golf.player_profile`.

**The cause.** Drizzle names **every column** in an INSERT, passing `default` for ones you did not
set. `atlas_app` holds **column-level** INSERT on 15 of the 18 columns; the three withheld are
`quality_flag`, `started_at`, `deleted_at` — deliberately, so a client cannot set its own quality
flag, backdate a run, or soft-delete on insert. **Postgres requires the INSERT privilege on every
column a statement NAMES, even where the value is `DEFAULT`**, so the statement was refused with
`42501 permission denied for table intake_submissions`, which `intake.ts` translates to
`403 forbidden`. It reads exactly like an RLS failure and is not one.

**The fix.** `/intake/start` now issues explicit-column SQL naming only the four granted columns,
then reads the row back through drizzle for a typed result. The grant model stays the real gate
rather than being widened to suit an ORM convenience. Marked `⚠️ RAW SQL ON PURPOSE` in the source
so it does not get "cleaned up" back into `db.insert()`.

**Scope — audited, 2026-09-01.** `atlas.intake_submissions` is the **only** affected table. Every
other table Atlas inserts into (`golf.player_profile`, `golf.handicap_history`,
`atlas.coaching_notes`, `public.users`, `public.user_app_roles`, `public.user_relationships`) holds
**table-level** INSERT and is unaffected. The rule for new tables: **if you use column-level INSERT
grants, they must cover every column, or drizzle's insert will fail.**

**Ruled out along the way — do not re-investigate:** the auth chain (`/api/users/me` uses the
identical `identityChain` and returned 200), `requireApp` (emits `app_access_denied`), the RLS
policy (a hand-written 4-column INSERT succeeds as `atlas_app`), a stale server process, and the
eco pin drift (v0.17.0→v0.18.0 is SQL-only).

### 🟢 B-2 · eco pin drift — RESOLVED 2026-08-31

Repinned and installed at v0.18.0; typecheck clean. Was never a candidate cause for B-1.

### 🟢 B-4, B-5, B-6 · Three quiz defects — ALL FIXED 2026-09-01

Found by driving the flow in a browser. **None was visible to the API smoke suite**, because in
each case both sides were individually correct and disagreed only at the seam. This is the
argument for keeping a browser pass in the loop.

| | Defect | Cause |
| --- | --- | --- |
| **B-4** | The quiz could never leave the volume stage | `stages.ts` keyed "volume done?" on `answers.ALLOC`, which the server **by design** never persists. A permanent loop: save succeeds, same screen returns. |
| **B-5** | Every real handicap was rejected | `PROFILE_FIELDS` types `PRO_HCP_NOW` as a select of whole numbers; the UI is a free-text box reading "8.4 — plus side: +2.1". The route enforced membership; **tgt's own validator never does**. Both demo players (4.2, 17.8) 400'd on the last screen. |
| **B-6** | No way out of the result screen | Its only control sold the next tier, and the gate is read once at sign-in. A finished golfer's sole escape was a page reload. Added "Go to my Atlas". |

### 🔴 B-7 · OPEN · Google sign-in needs one Firebase console click

`atlas.ryptest.com` is **not** in Firebase → Authentication → Settings → **Authorised domains**.
The browser console says so directly. This blocks `signInWithPopup` / `signInWithRedirect` only —
**email+password is unaffected**, which is why the deployed site logs in fine today. Nothing in the
code can fix this; it is a console setting. Tracked as **T-29**.

### 🟢 B-8 · Four client/server validation mismatches — FIXED 2026-09-01

All four were the same shape: **the server was stricter than its own UI**, so the quiz accepted a
value and the save then 400'd with a bare `invalid_profile_value` naming no field.

| Field | Client accepts | Server accepted | Who it locked out |
| --- | --- | --- | --- |
| `PRO_HCP_NOW/3YR` | `-2.1` (plus handicaps are normalised to negative) | no leading minus | **every better-than-scratch golfer** |
| `PRO_HCP_NOW/3YR` | unbounded decimals | 2 dp | anyone typing `8.456` |
| `PRO_SPEED` | ≥ 40 mph | ≥ 60 (items.ts) | juniors |
| `PRO_AGE` | ≥ 13 | ≥ 18 (items.ts) | **every academy junior, on the first question** |

Fixed at the root: `shared/profile-bounds.ts` holds `WIDENED_BOUNDS` and is imported by **both**
the quiz UI and the intake route, and every numeric check reads `effectiveBounds()` rather than
`field.min`. Mirroring them one at a time is how the age one survived the speed fix.

### 🟢 B-9 · Quiz contrast and divider alignment — FIXED 2026-09-01

Atlas styles the bare `button` **element** (gold pill, `color: var(--ink)`), which reached into the
ported quiz and repainted every button it did not explicitly override — tgt's unselected options
became near-black text on a near-black pill. Scoped reset inside `.quiz-root`, written with
`:where()` so it scores `(0,0,1)`: enough to cancel the element rule on source order, not enough to
beat the utility classes. Without `:where()` it also flattened the primary CONTINUE.

`AllocBar`'s `-ml-5.5` (centring a 44px handle) compiled to nothing — Tailwind v3's spacing scale
has no `5.5` step — so every divider sat **+22px** right of its colour boundary. Registered the
step; handle centres now measure 112/224/336 against boundaries of 112/224/336.

### 🟡 B-3 · Silent-looking PATCH — FIXED 2026-09-01

`toEnvelope` omitted `volume` and `alloc`, so a save returned 200 and the read-back showed nothing.
The write had landed; the projection dropped it. A resumed run rendered those two screens blank.
Both are now returned — they are the subject's own input, unlike `quality_flag`, which stays
server-side.

## 4. Intake smoke suite — 18/18 passing (2026-09-01)

All verified against a running server and confirmed in the database, not by response code alone:

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
