# ATR — STATUS

**Owner:** Makel (makel@rypgolf.com) · **Last hand-edited:** 2026-09-01 (paused) · **Demo:** 2026-09-07

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
_Regenerated 2026-10-15 10:35 CDT by `docs/refresh-status.sh`._

| repo | path | remote | branch | uncommitted | unpushed |
| --- | --- | --- | --- | --- | --- |
| atlas | `~/dev/ATR/atlas` | makel-ryp/Atlas | forge-port | **3 file(s)** | pushed |
| eco | `~/dev/ATR/eco` | RYPGolf/ryp-eco | forge-port-design | clean | pushed |
| tgt | `~/Desktop/ATR/websites/tgt` | makel-ryp/TGT | dna | clean | pushed |
| RYP-RED | `~/Desktop/ATR/apps/RYP-RED` | makel-ryp/RYP-RED | mac | **1 file(s)** | pushed |
| locker-room | `~/Desktop/ATR/apps/locker-room` | makel-ryp/locker-room | feature | clean | pushed |
| debrief | `~/Desktop/ATR/apps/debrief` | yanyanarti/debrief | master | clean | pushed |
| practice-dna | `~/Desktop/ATR/apps/practice-dna` | **not a git repo** | — | — | — |
| inventory | `~/Desktop/ATR/apps/inventory` | **not a git repo** | — | — | — |

- **@ryp/eco version:** `0.29.0`  •  **pinned in Atlas as:** `file:vendor/ryp-eco-0.29.0.tgz`
- **Atlas HEAD:** `a1ba584 A private #atlas-feedback channel, and the Slack app setup`
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
| Luke's prototype served from real DB | ✅ live | commit `d15d7a4`; zero sample names **on the coach roster and dossier**, which is what was verified. ⚠️ NOT true of the player-only surfaces — see T-70 — where named fictional coaches still appear |
| `atlas.intake_submissions` table + RLS applied to ryp-core | ✅ applied | one Neon transaction, journal hash `26ba3786…` |
| Migration journal reconciled with production (T-107) | ✅ fixed 2026-10-06 | `drizzle.__drizzle_migrations_eco` = 10 rows; `drizzle-kit migrate` against `main` is a measured no-op; `generate` prints "No schema changes". Reproduced the 42P07 failure first on branch `br-mute-sound-auuco5s2`. ⚠️ 4 objects are still in production but in no migration — `golf.drill_progress`, `player_profile.target_handicap`, `intake_submissions.interview`, `intake_submissions.result`. |
| `POST /api/intake/start` unauthenticated → 401 | ✅ verified | smoke test 2026-08-31 |
| **Practice DNA intake, API** | ✅ verified | 18/18 smoke assertions, 2026-09-01 |
| **signup → quiz → result → home, in a browser** | ✅ verified | driven end to end 2026-09-01; `golf.player_profile` written by the quiz (4.2, right-handed), not the seed |
| **Deployed to Railway** | ✅ live | `https://atlas.ryptest.com` — project `proactive-comfort`, service `Atlas`. Health 200, SPA serves, API 404s as JSON, unauth 401 |
| Atlas auto-grant is gated | ✅ verified | `ATLAS_SIGNUP_ALLOWLIST=@rypgolf.com`; an account outside it gets 403, inside gets 200 |
| **No profile answer refuses an account** | ✅ verified live | 9 and 95 year olds, 38 mph, a 60 and a 108 handicap, plus handicaps and "I don't have one" all save |
| Google sign-in on the login screen | ✅ live | domain authorised; popup path accepted |
| **Coach view, bifurcated by role** | ✅ verified | coach lands on the roster with a 2-item rail (Profile, Roster); player keeps their own 12-view app. One list per role — `HIDDEN_FOR_COACH` / `HIDDEN_FOR_PLAYER` |
| **`golf.drill_progress` + coach sign-off** | ✅ verified | 17 assertions + a leak test. Per-COLUMN grants proven: `atlas_app` gets `42501` writing `ticked_at` |
| **Three demo entry points** | ✅ verified | `/?as=<email>` — intake / player dashboard / coach dashboard, all three ready after one `npm run seed`. ⚠️ **Re-verified 2026-09-21 after the consent gate:** the seed now writes a date of birth for all four demo accounts, or every entry point would land on the DOB screen instead of the thing it exists to show. Confirmed in the DB: four demo accounts `ok`, real accounts still `dob_required` — real people's birthdays are deliberately NOT invented |
| **Sign-out ends the server session** | ✅ verified | `/proto/dashboard` answers `missing_session` afterwards; it used to serve the previous coach's roster |
| **Ticking a Parallax video in the browser** | ✅ verified | NOT SIGNED OFF → ✓ SIGNED OFF, persisted, `verified_by` = the coach, `ticked_at` still null |
| **Luke's design IS the app now** | ✅ live | sign-in lands on `Dashboard.dc.html`, fed from ryp-core. Not a React rebuild |
| Plus handicaps store and display | ✅ verified | `-2.1` stored, `+2.1` shown; was written to neither golf table before |
| Intake trimmed to 3 sections | ✅ live | 23 answers, not 100 — Tiers 1B/2/3 cut from the flow |
| Video/strike-map sections hidden | ✅ live | `hidden: ['intake','evidence','roster']` |
| **Whole intake, live, in a browser** | ✅ verified | signup → quiz → result → dashboard on `atlas.ryptest.com`, 2026-09-01 |
| `handicap_history` is a trend, not a log | ✅ verified | appends only when the index actually moved |
| `npm run seed` resets the intake | ✅ verified | row back to `in_progress` / tier 0, confirmed in the DB |
| **The practice log persists, and drives the coach's roster** | ✅ live | 2026-09-25. `golf.practice_sessions` on production. The log was remapped from day-of-month to ISO date in the same change — `log[1..31]` made 3 Oct and 3 Sep one key, harmless only while nothing persisted. **`RosterRow.days` finally has a producer**, so the roster's last-logged column, its silence flag (`days > 7`) and its default sort stop being inert. `npm run e2e:practice` 10/10 and 9/9 falsification tests, both against production |
| **A player can tell their coach a rep is ready** | ✅ live | 2026-09-25. `golf.drill_review_requests` applied to production ryp-core. The FIRST player-side write Atlas has ever had — before this, every control on the player's surface wrote to React state and stopped, which is why six of thirteen alpha findings were "nothing I do reaches my coach". **8/8 falsification tests on production as `atlas_app`** (incl. `rolbypassrls` = false, so policies bind — unlike ryp-red); `npm run e2e:review` 11/11 through the real route, ending on the request appearing in the COACH's payload |
| **Parental consent gate — access is refused server-side** | ✅ verified | 2026-09-21. `requireConsent` in every chain that gates on Atlas entitlement, incl. `/proto/dashboard` in page mode. Real middleware vs. all 12 live rows + 4 synthetic: 14yo-no-consent → 403 `consent_required`, 14yo-with-consent → allowed, no-DOB → 403 `dob_required`, adult → allowed. 24 smoke checks, **falsified first** — 3 deliberate regressions each produced the expected FAIL. The DOB write itself was round-tripped against live ryp-core: `returning()` yields a row (so no silent-zero-row lockout), 14 March reads back as the 14th, and a second write matches 0 rows so write-once is the database's rule and not just an `if`. ⚠️ **0/12 accounts carry a DOB, so everyone sees the one-field screen once on next sign-in.** What counts as consent is still counsel's (T-16) |
| Consent cannot be self-granted | 🟡 one layer, not two | The route surface refuses it and a smoke check enforces that. **The DB still permits it — MEASURED, not inferred:** on 2026-09-21 the probe account wrote its own `parental_consent_at` through `withRls` under its own identity, 1 row, no error (reset immediately). `grant update (… parental_consent_at …)` + `users_update`'s own-row rule, and RLS scopes rows not columns. `docs/operations/CONSENT-GRANT-REVOKE.sql` closes it: **written, NOT applied** |

## 3. What is BROKEN — top blocker

### 🟢 Five security/correctness fixes — 2026-09-08

From a six-agent review of every surface. Each was reproduced before fixing and re-tested on live.

| | was | now |
| --- | --- | --- |
| **Sign-out left the session cookie live** | next person on a shared laptop typed `/proto/dashboard` and got the coach's roster — `/api/session/end` had **zero callers** | ends the session; `missing_session` |
| **Uppercase uuid defeated the admin self-guard** | `UPPERCASE own id` → **200**, admin demoted; the guard exists so an escalation can't look ordinary in the audit trail | `normaliseUuid()`; → 400 |
| **Allocation derived twice** | golfer's 25/25/25/messy-25 stored as `11.11/11.11/11.11`, and `messy` stored **nowhere** | raw shape stored; `actualAlloc` = `{20,20,20,40}` |
| **Allowlist trusted a self-asserted email** | `@rypgolf.com` suffix over a project with 28,428 live iOS accounts | exact addresses only |
| **A coach could not sign out at all** | my own bug — the prototype has no sign-out and `← Atlas` bounced them back | `Sign out` in the banner |

⚠️ `/api/session/end` clears the cookie from the **browser**; it does not revoke it. Revocation is
available (`checkRevoked` is already on) but `revokeRefreshTokens` would sign the user out of RYP
Stick on their phone — the Firebase project is shared. Written up in `server/routes/proto.ts`.

**Discarded from the review as false:** "no INSERT grant on `user_app_roles`; signup 500s".
`atlas_app` holds INSERT, SELECT, UPDATE and signup demonstrably works.

### 🟢 B-10 · The rail's fabricated numbers — FIXED 2026-09-03

Every number in the rail is now read from ryp-core or shows a dash:

| shown | source | was |
| --- | --- | --- |
| `EVERY NUMBER VS n HANDICAP` | `golf.player_profile.target_handicap` | `5` |
| `TARGET HANDICAP n` + slider | same | `5` |
| `Benchmarks read against n` | same, in the copy | "a 5 handicap" |
| `REAL n` | `golf.player_profile.handicap_index` | `11.4` |
| `PRACTICE` | **dash** — Forge's composite has no producer | `7.0` |
| `TOTAL SG` | **dash** — see below | `−2.0` |

**Why TOTAL SG is a dash and not a number.** The formula was
`target − (driving·0.30 + approach·0.35 + chipping·0.15 + putting·0.20)`. That is **not strokes
gained** — real SG is per-shot, `E[from here] − E[from there] − 1`, summed. It is "the gap between
your target and your composite practice index": a legitimate metric under a misleading name. Its
four inputs are Forge's `golf.practice_index_results`, which does not exist; they were being read
from `state.forge`'s literals (14.0 / 8.0 / −3.0 / 2.0), giving a composite of 6.95 and, against a
target of 5, the −2.0 that sat under Avery's name.

The weights are Luke's model and are kept. METRIC-MAP already ruled who computes the result:
`forge.index_expected` is his expected-value model, *"only the sg it produces is promoted"* — to
`golf.player_metrics`. **Atlas must never compute SG, only read it.** Two SG figures for one player
is worse than none.

`target_handicap` (eco 0.20.0) is **player-writable only**: RLS scopes rows not columns, so a
coach-write policy on `player_profile` would also let a coach rewrite the student's index, carry,
handedness and GHIN. A coach *prescribing* a target is `atlas.prescriptions`.

### 🟢 B-11 · The ten-shot video test — REMOVED 2026-09-03

Deleted from the profile section, along with the 33 lines of `profileVals` that fed it
(`pfTestStatus*`, `pfRows`, `pfAware*`, `pfCells`) and one orphaned rail badge that would have
rendered `undefined`. Boundaries were asserted from content before cutting — the block had to
contain the strike map and must NOT contain "Handicap history" or "The interview".

A second copy remains inside the `intake` section, which is hidden from both roles and therefore
never renders. Left alone on purpose.

The player file now reads: Handicap history → The interview → the assessment sign-off list →
**the plan, as five fold-down bars** → **what the player sees (Practice DNA)** → coaching notes.

### 🔴→🟢 Three more fabrications on the DNA panel, found by review — 2026-09-15

An adversarial pass (15 agents, 11 findings, 6 survived) on the two commits above. The pattern is
worth keeping: **I guarded one fabrication on that panel and shipped three more beside it.**

| | |
| --- | --- |
| **Efficiency** | Every term of the blend has a flattering fallback. A player who answered NOTHING scored `86 / "Dialed in"` in green — identical to one reporting a real even split, and better than one honestly reporting 85/5/5/5 (`61`). Now null unless all three inputs exist. |
| **Mechanics Index** | `estimateMi` is `scales.mechanics ?? 50`, so unanswered ⇒ shift 0 ⇒ gap **0.0** and "your swing and your scoring are in step" **for every player alive**. Card hidden unless answered. |
| **Archetype** | "no zone is starving" as an unhedged headline above four "Not measured" rows. Forced provisional; the chip names why. |
| **A fabricated standard** | `plan:1-1b` read "No early move" — **a string that appears nowhere in the plan**. My own pre-review check compared ids/steps/cam-flags/contexts but NOT standard text, and I reported it as broader than it was. All 23 now verified verbatim. |
| **"Build next" empty box** | Rendered `BUILD NEXT · —` with no gate. ⚠️ A verifier **refuted** this; the browser settled it. Trust the render over the verdict. |

### 🟢 One review-trigger structure, every source — 2026-09-15

"Awaiting your review" is a model, not a property of drill cards. Every reviewable thing has the
same three parts, and only the third is shared:

| | |
| --- | --- |
| **(1) the student's claim** | a student-owned column. `ReviewItem.source` says which one: `drill` → `golf.drill_progress.ticked_at`, `intake` → `atlas.intake_submissions.completed_at`. |
| **(2) the coach's view of it** | `resolveSubmitted()` in protoData.ts — the ONE place that knows how to read each source, emitting a single `submitted` map per student. The page reads it and decides nothing. |
| **(3) the coach's resolution** | always `golf.drill_progress.verified_at`. `drill_id` is free text, so a non-drill review item needs no migration and no second mechanism. |
| **what a student can actually raise today** | ⚠️ **Not a drill.** `golf.drill_progress` has only `drill_progress_coach_insert`/`_coach_update` — **no self-insert policy** — and `atlas_app` holds no column grant on `ticked_at`; the rows carrying it were written by `neondb_owner`. Nor a message: `coaching_notes_insert` requires `coaches(subject_user_id)` and nobody coaches themselves. **The intake is the one path**, hence the `intake:practice-dna` review item. The read side is complete and lights up when the owning app writes. |
| **surfaced at the roster** | a gold "N waiting on you" chip, a gold row edge outranking the silence flag, and a new default sort. The old default keyed on `p.days`, which has no producer, so it never ordered anything; the blurb now describes the sort actually running. |

### 🟢 The coach can see what the player sees — 2026-09-15

Two halves of one ask: give a coach the player's own vocabulary, and let them sign off everything
the plan actually asks for.

| | |
| --- | --- |
| **The shared vocabulary** | `server/dnaSummary.ts` scores a run server-side and projects it to a coach-safe **allowlist** — archetype + the instrument's own coach line, tendency, the four zones with status and their-time-vs-recommended, growth zone + the three prescribed moves, efficiency, Mechanics Index, pattern, chips. Every term is one the player already read on their result screen. Not a copy of that screen: no map, no heat kernels, no share card. |
| **Allowlist, never a delete-list** | `PracticeDnaResult` carries `attention` (the `quality_flag` basis), `scaleScores` (which includes `neuroticism`/`extraversion`/`agreeableness`/`conscientiousness`) and `architect`. A new object is built field by field, so anything added upstream is excluded by default — the same reasoning that made `atlas.student_intake` a view rather than a policy. |
| **`answers` never leaves the server** | The view strips IPIP01–20 but **not** ATTN01/02, so the raw column is read, scored and dropped inside one function. Verified by string-scanning the **actual wire payload** for a real 5-student roster — clean, both audiences. |
| **A fabrication caught before shipping** | The first guard on "their time %" tested `zoneIntensity > 0`. That is never false: `getAlloc` (scoring.ts:262) falls back to `{25,25,25,25}` and the volume factor floors at 0.4, so an unanswered run reads ≈0.16 on every zone and four invented 25%s would have printed beside a real recommendation. The signal has to come from the **input**; proved by scoring one real run twice, with and without volume/alloc — dashes, not 25s. |
| **Sign-off widened 3 → 34** | Was three ids hardcoded in the page, of the six `DRILL_DEFS` defines and none of the 23 the plan defines. Now `shared/drills.ts`: 6 assessments (bare ids kept, so no live sign-off is orphaned) + 23 plan drills (`plan:<step>-<ref>`) + 5 step completions (`plan:step-N`), replacing `state.signed = [1,2]` — a literal array local to the browser tab. 14 items need a coach's judgement. **No migration**: `drill_id` is unbounded `text`, no CHECK, no FK. |
| **Still `verified_at`, not `watched_at`** | Despite the feature being called "have you watched", `atlas_app` holds no column grant on `watched_at` or `ticked_at` — the player's own claim, forge_app's to write. |
| **Fold-down bars** | Folded by default, and the **closed** bar carries the whole progress: the step's sign-off pill plus `n / m signed off`. Five bars place the player without a click. The bar folds, the pill inside it ticks and stops the event, or one click would do both. |
| **A hole the widening opened** | The verify route took `:drillId` straight from the path into the INSERT — any string in a URL became a permanent row. Now checked against the **same list the page renders from**, injected as `AtlasData.reviewItems` rather than hardcoded, because two lists drift. |
| **Verified** | Live tick+untick of `plan:2-P1` through `withRls` as the coach succeeded; the same write against a `pending` student was refused **42501**. Both views driven in a browser: 0 unbound bindings, fold opens to 7 drills with the others folded, the step pill leaves the bar open and surfaces a failed write rather than a false sign-off. ⚠️ The independent refutation pass did **not** run — all six agents died on the org monthly spend limit. |

### 🟢 The coaching loop closed — 2026-09-14

A coach could tick a drill and could not say a word about it. Both halves now run, on the one screen
both audiences share:

| | |
| --- | --- |
| **Notes reach the page** | `server/routes/notes.ts` was **bearer-only** (`verifyToken`), and Luke's page is a server-rendered document authenticated by a session cookie — a browser navigation cannot carry an `Authorization` header, so every note written from the only surface a coach would use returned 401. The same bug shipped on the drill tick in Sep 2026. `cookieOrBearer` extracted to `server/cookieOrBearer.ts`, shared by `coach.ts` and `notes.ts`. |
| **Two-sided, one block** | Coach: the selected student's notes plus a compose box with plain-language visibility chips (*Player can read* / *Coaches only* / *Just me*, defaulting to Coaches only). Player: read-only, no compose box. Audience chosen by `ROSTER.length === 0`, the `pfDrills` pattern. |
| **The client never filters by visibility** | `atlas.coaching_notes_select` grants a subject `'shared'` only, so a `private`/`coaching_team` note is not in the payload at all. **Verified both directions on live data**: a `shared` note reached the student; `coaching_team` and `private` did not. |
| **The subject is resolved** | `self` was `who.id === 'hale'` — never true — so a player opening their own profile saw a **blank placeholder person** with read-only fields. `meRow` (the caller shaped as a `RosterRow`, converted server-side) fixes it. Four fabricated values that this made reachable were removed in the same pass. |
| **The coach's rail** | No longer prints the coach's own handicap, target, practice, real and transfer gap beside a student's file. One key, `HIDDEN_FOR_COACH` only; a player's rail is unchanged. |

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

### 🟢 B-7 · Google sign-in — DONE 2026-09-01

`atlas.ryptest.com` added to Firebase Authorised domains (Makel). "Continue with Google" is live on
the login screen. Verified the domain is accepted: clicking it errors `auth/popup-blocked` (the
automated browser), **not** `auth/unauthorized-domain` — Firebase accepted the origin and tried to
open the window. Completing a real Google sign-in needs Makel's own account and is his to do.

A Google signup also now gets a name: eco's `attachUser` stores only `firebase_uid` + `email`
(correct for a shared spine that cannot assume a provider gave one), so `Profile.tsx`'s
`displayName ?? email` would have shown an email address where a name belongs. The client adopts
the provider's name once, onto a row that has never had one.

### 🟢 B-8 · Four client/server validation mismatches — FIXED 2026-09-01

All four were the same shape: **the server was stricter than its own UI**, so the quiz accepted a
value and the save then 400'd with a bare `invalid_profile_value` naming no field.

| Field | Client accepts | Server accepted | Who it locked out |
| --- | --- | --- | --- |
| `PRO_HCP_NOW/3YR` | `-2.1` (plus handicaps are normalised to negative) | no leading minus | **every better-than-scratch golfer** |
| `PRO_HCP_NOW/3YR` | unbounded decimals | 2 dp | anyone typing `8.456` |
| `PRO_SPEED` | ≥ 40 mph | ≥ 60 (items.ts) | juniors |
| `PRO_AGE` | ≥ 13 | ≥ 18 (items.ts) | **every academy junior, on the first question** |

**Then removed entirely** (Makel, same day: *"why are we not allowing the user in bc of speed, or
age, or handicap?"*). Widening the bounds was the wrong fix — the ranges should not refuse anyone
at all. In tgt they are input hints on a marketing quiz; in Atlas the same screens **are account
creation**. Validation now checks TYPE and closed vocabularies only. `shared/profile-bounds.ts`
survives as `suggestedRange()` feeding the inputs' `min`/`max` attributes — stepper hints, never a
gate — and carries the warning that any comparison returning an error there is the gate coming
back.

> ⚠️ **Consequence worth a decision:** with no age floor, an under-13 can now create an account.
> That is the right default for an academy, and it makes the parental-consent gate (**T-16**) a
> real requirement rather than a nice-to-have. COPPA applies to under-13s in the US.

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

- **Forge is the critical dependency — and it ARRIVED 2026-09-30.** Of the 81 metrics in Luke's
  prototypes, **44 (54%) are produced by Forge**. Six of his twelve Dashboard screens cannot show
  real numbers until Forge exists. ✅ The package is in hand (`~/Downloads/FORGE-package/`) and
  **Makel decided 2026-10-06 that it is ported onto ryp-core, not Luke's Supabase** — see
  [FORGE-ON-RYP-CORE.md](FORGE-ON-RYP-CORE.md) and [FORGE-CONTEXT.md](FORGE-CONTEXT.md).
  ⚠️ **Arrival is not a producer.** The package persists to `localStorage['forge.v5']` and makes
  **zero network calls**, so until the port is built and running there is still nothing for Atlas
  to read, and Transfer / Performance / the Tomorrow card stay gated.
- **Practice DNA has 118 real runs** (2026-08-19 → 08-31) in the TGT-live DB. 48% reach tier 3,
  **39% stall at tier 1**, tier 4 is never used. `user_id` is populated on **zero** rows — the
  live quiz is anonymous, so none of that data can be attached to an Atlas account retroactively.
- **Luke is ideation only.** He does not clone, review, or merge. There is no second developer.
- **Pricing is frozen** until Luke approves. The $99–$799 tiers appear nowhere in the repo.

## 5a. Luke's prototypes — what they are (established 2026-09-01)

All three now vendored **unmodified** in `proto/`, with `proto/DESIGNS.md` recording which is wired.

| File | What it is | Wired? |
| --- | --- | --- |
| `Dashboard.dc.html` (390 KB) | **The product.** ONE app for both audiences — 16 comment-marked sections, 14 `sc-if`-guarded. Everyone gets the player dashboard; a coach's addition is the roster tab + student dossiers | ✅ served, ROSTER fed from ryp-core |
| `AtlasPlayer.dc.html` (174 KB) | **The Forge front-end, renamed.** Its own localStorage migrates `atlas.forge.v1/v2/v3` → `atlas.player.v*`. 45 constants, mostly strokes-gained / launch monitor / test conditions | ❌ reference only |
| `Atlas.dc.html` (190 KB) | Main / marketing site | ❌ reference only |

**Sections hide by flag, not by cutting markup.** `__ATLAS_DATA__.hidden` is a list of section keys;
every `isX` guard ANDs against it and the nav items read the same list. Removing a key restores the
section and its tab. Currently hidden: `intake`, `evidence` (the ten-shot video test — no capture
pipeline, ruled unachievable) and `roster` (tucked while the coach product is not the focus).

⚠️ **Still fabricated on the main page:** the sidebar's "5 HANDICAP" and "TOTAL SG −2.0" come from
the `state.forge` literal. Avery is 4.2 and Total SG has no producer. **This is the most visible
wrong number in the app** and is the next literal to strip. Held at Makel's instruction.

⚠️ The served banner still lists "intake answers" among the empty fields; that section is now hidden.

## 5b. Demo data — the state `npm run seed` restores

| | |
| --- | --- |
| 4 accounts | player1 (Avery, 4.2), player2 (Jordan, 17.8), coach (Sam Ellis), admin |
| Coach edges | Avery **approved**, Jordan **pending** — runbook step 3 depends on both |
| `handicap_history` | exactly one point each, dated 2026-08-24 |
| Intakes | both reset to `in_progress`, so the signup flow can be rehearsed repeatedly |

⚠️ One inert row remains in `public.users`: `gate.probe.delete.me@example.com`, left by the
allowlist test. It holds **no** Atlas entitlement and its Firebase account is deleted, so nobody
can sign in as it — but it **will appear in the admin panel's user list** during runbook step 4.
`atlas_app` has no DELETE on `public.users` by design (identity rows are soft-deleted), so removing
it needs the Neon owner connection.

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
