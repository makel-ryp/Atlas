# Gap assessment — FORGE + Atlas → testable

**2026-10-06.** What stands between today and a tester playing a real session that their coach can see.

Built by tracing six end-to-end journeys rather than inventorying components, because every gap in
this product sits at a seam between two apps built by different people against different
assumptions. 23 agents, 6 lanes, 12 refutation passes, 4 seam studies, 1 completeness critic.
**65 raw gaps → 8 real work groups.** Claims below are tagged **[V]** where verified in this survey
by a query or command, **[L]** where carried from a lane and not independently re-checked.

---

## 🔴 Do this first, and separately from everything else

**A Firebase Admin private key for `rypstick-ios` was printed into an agent transcript during this
survey.** One of my own agents ran `railway variables --kv | cut -d= -f1` to list variable *names*.
`FIREBASE_PRIVATE_KEY` is multi-line; its continuation lines contain no `=`, so `cut` passed the key
body through unchanged. **[V]** ~21 of ~26 base64 lines landed in
`~/.claude/projects/.../subagents/workflows/wf_33ff661d-bef/agent-ae107239d37294a37.jsonl`.

- That service account can mint sessions for the project behind **28k+ accounts** including the live
  iOS product.
- **Rotate it.** Google Cloud Console → IAM & Admin → Service Accounts → the Firebase Admin SDK
  account → Keys → add a new key, update `FIREBASE_PRIVATE_KEY` in Railway and `.env`, then delete
  the old key. Rotation makes the leaked copy worthless, which is a better fix than deleting the
  transcript — say the word and I'll scrub the file too.
- This is independent of the alpha. It does not wait for anything on the list below.

My agent caused this and disclosed it. The instruction to stay read-only was about the database; it
should have covered secrets, and the next survey brief will.

---

## The ordered list

Dependencies first. Groups 1–3 are prerequisites, 4–5 are the FORGE port, 6–8 are the product.

| # | Group | Why it is where it is | Size |
| --- | --- | --- | --- |
| **G0** | **Rehearse the migration; prove the restore path** | See below — this is a prerequisite to the prerequisites and was on nobody's list | days |
| **G1** | **Test boundary and recovery** | Everything downstream writes to production until this exists | days + a decision |
| **G2** | **"Log today" overwrites what the clock recorded** | Live data loss, today, on the most-used control | hours |
| **G3** | **Coach linkage + the admin-roster defect** | Without it "their coach sees it" cannot happen, and the roster actively misleads | days |
| **G4** | **FORGE persistence** | The port. ~13 claimed blockers, one sequenced item, three decisions inside it | weeks |
| **G5** | **Strip FORGE's baked-in literals** | Mechanical, but only once G4 exists | days |
| **G6** | **A persisted player-progress writer** | Highest-leverage single fix; blocked for a reason that no longer exists | days |
| **G7** | **The consumer-wiring pass** | No migration, no grant, no FORGE. Closes the coach-facing half | days |
| **G8** | **The numbers** | One real bug; the rest is labelling plus a tester briefing | hours + decisions |

---

## G0 · Rehearse the migration first — the largest risk nobody flagged

Every lane wrote "apply the data layer" as a prerequisite and moved on. Nobody asked what applying
it costs **if it goes wrong**. Assembled:

- Nine new tables, a new `NOBYPASSRLS` role and column grants land on `public` and `golf` — **the
  same schemas `red_app` and `lr_app` hold grants on**, serving the live RYP Stick iOS product.
- **[V]** Neon `ryp-core` history retention is **21,600 seconds — six hours**. Plan `free_v3`.
- **[V]** No app role holds `DELETE` on any table, by design.
- **[V]** `main` is `protected: false`.
- **[V]** One Railway environment, no CI, and **zero error reporting anywhere**.
- **[L]** 65 unresolved defects against the mapping being applied.

> A tester corrupts data Saturday morning. You notice Monday. It is gone. There is no undo, at any
> privilege level, by any route.

> ⚠️ **CORRECTED 2026-10-09, and it lowers this item's priority.** The original text here said a bad
> migration *"degrades RYP Stick, you hear about it from customers, and the restore window closed
> hours ago."* **That was wrong.** Verified by query: `ryp-core` has five schemas and **no `ryp_red`
> schema**; `user_app_roles` holds **0** rows for `ryp_red` and **0** for `locker_room` against **10**
> for `atlas`. RYP Stick runs on the old `ryp-red` Neon project — a different database — and roadmap
> M2/M3 are unstarted. `red_app` and `lr_app` hold grants here but **nothing connects as them.** The
> real blast radius is **Atlas and its 12 accounts.** Rehearsing on a branch is still right (one of
> seven free slots, and it is how T-107 was proven), and the 6-hour PITR, absent DELETE grant and
> unprotected `main` are all still true — they just guard 12 Atlas accounts, not a live iOS product.

**[V] And the excuse for not rehearsing was false.** `branches_limit: 10`, three exist, **seven
free**. Four lanes declined to run the server, the e2e suites and the live intake on the grounds
that "no Neon branch is available (T-108)." That was never true of the account — only of those
agents' toolsets. A large share of this survey's "could not determine" is recoverable for the cost
of one branch.

**Do:** rehearse the whole migration on a branch, verify the restore path, then write DDL to main.

---

## G1 · There is no test boundary

**[V]** Local `.env`, the hosted app and every script (`seed`, `smoke`, `devSession`, `e2e*`) point
at **one** database: production `ryp-core`, branch `br-curly-cloud-auqwnqtl`, endpoint
`ep-winter-math-aud1tkwf`. Railway has exactly one environment and the same endpoint.

- A tester is a real production user. **[V]** There are ~12 `public.users` rows.
- Running a gate *during* the alpha rewrites what testers see — `seed` reopens intakes and resets
  coach edges; `e2eMessages` rewrites a seeded student's date of birth.
- T-108's three weaknesses all live here: no CI, `devSession`'s production guard can never fire
  because no npm script sets `NODE_ENV`, and the e2e suites write over HTTP to one database while
  asserting in-process against another.
- **[L]** `seed.ts` mints real accounts in the **shared Firebase project** — so a Neon branch alone
  does not isolate identity.

**Needs your decision:** alpha on production, or on a branch with its own Railway environment.

**Also here, and not optional:** **[V]** `public.terms_acceptances` has **0 rows and no writer** —
no human has ever accepted terms in this product. **[V]** `public.deletion_requests` exists with no
route and no UI, and no role holds DELETE. You are about to have humans, possibly minors, generate
coach prose about themselves with no recorded terms acceptance and no way to remove them.

**And you cannot observe the alpha.** **[V]** `grep -rniE 'sentry|bugsnag|unhandledrejection|window.onerror'`
across `client/src`, `server/` and `proto/Dashboard.dc.html` returns **zero hits**. The first screen
already emits 8 SVG console errors, so a genuine exception inside a 7,000-line prototype is
invisible and indistinguishable from existing noise. The tester says "it froze" and you have
nothing. One thin client error hook changes whether the exercise returns information at all.

---

## G2 · "Log today" destroys what the clock recorded

The alpha finding *"Log today not working"* was recorded as fixed. **It is not — it came back as
data loss.**

```js
// Dashboard.dc.html:7079
this.patch(TODAY, Object.assign({}, log[dayKey(TODAY)], { m: mm, b: 'Construction' }))
```

`Object.assign` spreads the existing row first, so `w` (workout) survives but **`m` and `b` are
clobbered**. Clock 50 minutes of Calibration, tap the still-primary-styled button, and the database
holds **15 minutes of Construction**. **[V]** The button's `onClick` is unconditional even when the
label already reads "Logged ✓".

**[V] And the table has never held a surviving log.** `select … from golf.practice_sessions` →
**five rows, all one user, `minutes`/`zone`/`workout` NULL on every one** — e2e leftovers written
then cleared. The coach roster's "days since last session" producer skips `minutes == null`, so it
has never returned a non-null value on real data.

Four separate lanes called this fixed. Every one traced to the same `TASKS.md` row; nobody re-ran
it. **A doc row is not evidence.**

---

## G3 · Nothing links a tester to a coach — and the admin roster lies

- **[V]** `public.user_relationships` has policies for request and approve, but **no route and no
  screen writes it**. All 9 edges are seed data. A stranger's session is invisible to every coach.
- **[V]** `organizations` = 0 rows, `org_memberships` = 0. The academy path has never been used.
- **New defect, found by the critic:** **[V]** `coach.ts:113-117` filters the membership list only
  by `role === 'member' && userId !== me.id`, relying entirely on RLS to scope it. But
  `org_memberships_atlas_admin_read` is `is_app_admin('atlas')` and **returns every row in the
  table**. An Atlas admin who is also a coach sees every academy's members on their roster, labelled
  `active`, with no profile or practice data — because `coaches_via_academy` fails outside their own
  org. **If you check the alpha roster as admin without being org staff, you will see "never logged"
  for everyone and read it as a bug.**
- A minor cannot clear the consent gate without raw API access: the guardian screen says "ask your
  coach", coaches have no consent surface, and the only writer is
  `POST /api/admin/users/:id/parental-consent`. The gate is correct; the unblock is missing.

Smallest fix for the linkage: an audited admin "assign coach" action on the existing policies.

---

## G4 · FORGE persistence — the port itself

**[V]** FORGE has no auth code and makes zero network calls; it saves only to
`localStorage['forge.v5']`. **[V]** Atlas has no route for any of the Spec's eight endpoint groups.
**[V]** The database has no `forge_app` role and no table to write to.

A tester plays a session, sees **"Saved on device · queued for coach sync"** — a toast that is a
lie — and nothing leaves the phone. That is your alpha finding *"Forge results not saved."*

Absorbs ~13 separately-claimed blockers. **Three decisions sit inside it:**

1. **Seed lifecycle.** §6.1 has the server allocate the seed at session start; §6.3 says one submit
   at completion. At a range with one bar those conflict. **[V]** 3 of the 4 start paths set no seed
   and the saved record never stores one. Getting this wrong changes a Putt 18 index by up to 13
   handicap strokes for the same total.
2. **Idempotency.** On paper only — the key is nullable and the client never generates one. A lost
   ack either duplicates the session or errors forever.
3. **Where `gender` is captured.** **[V]** It exists nowhere in Atlas or ryp-core, and FORGE boots
   `gender:'m'`. It selects the carry→handicap table, so **every driving number is silently wrong
   for a woman** — it computes fine, on the men's table, with no error. That is the defect.

**[V] Two things are genuinely unrecoverable if not captured from day one** — everything else
`shots` + `raw_total` make recomputable later:
- the **carry snapshot** (`player_profile.driver_carry_yds` is a single mutable row with no history
  table, unlike `handicap_history`)
- **`short_sided`**, a captured per-target boolean with nowhere to land

Also: **[V]** `played_on` is stamped as the **UTC** date (`FORGE.dc.html:4253`), so US evening
sessions file under tomorrow. Server-side scoring does not exist, and the client discards per-shot
data at save, so there is nothing to verify an index against. (Scoring parity itself is not a
worry — the two JS copies agree on every function both contain.)

---

## G5 · FORGE ships with its own fabrications

§6.4 warned about this in Luke's own words: *"eight fabricated sessions ship as the default state,
so a genuinely new user starts with fake history and a fake leak."* It is worse than the warning —
`boot()` also bakes in `myHcp 11 / carry 235 / target 5 / gender 'm'`, so **accepting the onboarding
defaults writes a 235-yard carry as if the golfer had answered**. Plus `s.assignments || this.ASSIGNED`
gives every new user three "PRESCRIBED BY YOUR COACH" rows nobody wrote, one overdue and one done.

Same class Atlas spent a month removing. **[V]** Also: FORGE's `localStorage` key is a bare
`forge.v5` with no version field and **no migrate-on-read** — change the shape during the port and a
returning tester's blob parses as the new shape. Silent corruption, not a clean wipe. The Spec warns
about exactly this.

---

## G6 · The two alpha findings the port cannot fix

🔴 **This is the one to read.**

> *"Forge drills not showing as awaiting verification"*
> *"What have you watched doesnt populate player progress on forge protocols"*

**The delivered FORGE package never produces a tick, a watch, or a verification.** Not once, in
5,100 lines. And the port as designed deliberately routes FORGE into its own tables and keeps it out
of `golf.drill_progress`. So **both findings have no producer even after the port is built.**

Confirmed mechanically: **[V]** `Dashboard.dc.html:4464` computes `pending = d.cam && on && !vd`
where `on` reads `ticked_at` — **a column no role can write**. The modal one screen away uses
`submitted`, which does have a producer. Two screens, same drill, disagreeing.

**And the reason this is blocked no longer exists.** `golf.ts` says do not widen the `ticked_at`
grant because it would fork a data contract with an app we do not own. **T-105 destroyed that
premise on 2026-10-06** — there is no foreign app to fork a contract with any more. Nobody had
written that down.

**Needs your decision:** is a FORGE rep something a coach verifies at all? Either (a) the scored
session *is* the evidence and "awaiting verification" is dropped for FORGE work, or (b) FORGE writes
a progress row Atlas's loop can read. One table Atlas may write, plus one route, and it is the
single highest-leverage fix on this list.

---

## G7 · The coach-facing half, wired to nothing

No migration, no grant, no FORGE — all of it in the prototype's `vals`:
- **[V]** `refs()` at `:3363` filters `id.indexOf('plan:') === 0`, excluding all six assessments
  from `ticked`/`verified`, so build-screen counters can never move for a Forge protocol.
  (Partial — **[V]** the player's own profile panel *does* render assessment `verifiedAt`, because
  `pfDrills` is built from the server payload. Smaller than first claimed, still real.)
- **[V]** `SESSION_DOMAINS`' `'Next'`/`'Queued'` literals at `:2844-2848` are dead.
- The coach step pill reads `verified_at` while the route writes `signed_off_at`.
- The "Ask your coach" buttons are still dead — a div with no handler.

This is the half of the journey that **cannot be tested at all today**, and it is the cheapest group
on the list.

---

## G8 · The numbers

One is a real bug: **[V]** an inverted sign at `Dashboard.dc.html:2843` —
`idx = base + (8 - (fair - bad*2))` printed through `(idx > 0 ? '+' : '')`, so **a 21-handicap
renders as `+21.0`, tour-elite, on a player-reachable screen.**

Everything else here is labelling plus a tester briefing, and **none of it blocks flow testing**:
- `baselineHandicap(225)` — the Spec's step table says 15, `forge-math.js` interpolates to 12.5, the
  fixture expects 7.5. Needs one answer; changes a computed value, not a table shape.
- Two benchmark tables that disagree by 13 yards at handicap 12.5, one of them tagged MEASURED.
- `yardsPerShot`, the ATG constants (**GUESS**) and `putt18` (**PROVISIONAL**) are unfitted.

**Keep "the flow is testable" strictly separate from "the numbers are trustworthy."** They are
different failures with different fixes. But testers must be told which numbers are modelled
guesses, or they will file a calibration gap as a bug — and a coach may act on one.

---

## Your 13 alpha findings, reconciled

| # | Finding | State |
| --- | --- | --- |
| 3 | stuck on Sep 18 | ✅ fixed |
| 8 | Transfer window | ✅ hidden by your decision |
| 9 | course simulation useless | ✅ removed |
| 13 | coach: "Profile is attached to a single player" | ✅ fixed |
| 2 | "Log today" not working | 🔴 **open — and now destroys the clock's data (G2)** |
| 1 | sets not saving | 🔴 open — no producer (G6) |
| 6 | can't check off Construction drills | 🔴 open |
| 10 | Fitness workouts have no exercises | 🔴 open |
| 11 | "ask your coach" buttons dead | 🔴 open (G7) |
| 4 | Forge results not saved | 🟡 blocked on the port (G4) |
| 5 | can't select a higher-fidelity plan | 🟡 blocked on the port |
| 12 | Forge drills not awaiting verification | ⛔ **no producer even after the port (G6)** |
| 14 | what you've watched doesn't populate | ⛔ **no producer even after the port (G6)** |

**Four fixed. Seven still open. Two cannot be fixed by the port at all.**

---

## What this survey could not settle, and the one action that would

Four lanes declined to run the server, the e2e suites, the live intake and a real browser
click-through — all on a premise that was **[V] false** (seven Neon branch slots are free). So every
"T-86 / T-97 / T-99 / T-101 is fixed" claim in `TASKS.md` remains **unverified by execution**, and
T-99 is now **[V] disproven** on surviving data.

**Create a branch and run them.** That single action converts most of this document's "could not
determine" into fact.

Two more read-only checks worth running now:

```bash
grep -rn "Cache-Control\|no-store" server/
```

**[V] Zero hits.** `/proto/dashboard` returns per-user HTML carrying the coach's full roster inline
in `window.__ATLAS_DATA__`. `proto.ts:120-134` claims in its own comment that `clearCookie` closes
the shared-laptop threat "completely" — without `no-store`, **the back button defeats that today**,
with no service worker involved. One header.

```bash
awk 'NR<996 && /<sc-if value=/{l=NR": "$0} END{print l}' proto/Dashboard.dc.html
```

**[V]** → `915: isCal`. Atlas ships a **second, live, player-reachable FORGE capture surface** on the
Calendar screen, and `logFromToday` navigates the player straight onto it. Both earlier descriptions
of how it is reached were wrong.

---

## Method, and what is soft

Six journeys traced by a test-engineer agent, each refuted twice — once by an agent hunting for
things that already exist under another name (the `coach_profiles` precedent), once by an agent
demanding run evidence for anything claimed built. Four seam studies. One completeness critic, which
corrected the lanes on seven points and corrected itself on two.

**Soft:** no agent ran the app against a live server. FORGE was read, not clicked. The 65-defect
count against the port mapping is the refuters' own tally and one seam counted 66. `[L]` items
inherit their lane's evidence, not mine.

**Nothing in this survey wrote to the database or edited a file** — all DB access was `SELECT`, most
of it inside `BEGIN READ ONLY` … `ROLLBACK`.

**Re-verified by hand before publishing this document**, because they are the four claims it leads
with: zero telemetry hits; zero `no-store` hits; `915: isCal` is the last `sc-if` before the Launch
Forge control at `:996`; `Dashboard.dc.html:7079` is the clobbering `Object.assign`, and the same
handler ends `setState({ view: 'cal', sel: TODAY })` — so tapping "Log today" navigates the player
straight onto the screen that holds the second live FORGE capture surface. And
`select count(*), count(minutes), count(zone), count(distinct user_id) from golf.practice_sessions`
→ **5 rows, 0 with minutes, 0 with zone, 1 user.**
