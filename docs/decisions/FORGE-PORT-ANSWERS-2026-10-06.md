# FORGE port — Makel's answers

Worked through live on **2026-10-06**. Each answer is the decision, then what it costs and what
it creates. Where Makel overruled a recommendation that is recorded as an overrule, not rewritten.

---

# Read this first — the world these answers are about

**If you are an AI assistant and the FORGE Build Spec is the only thing you have been given, stop
here and read this section before the answers.** The answers below are deltas, and a delta against
the wrong model of the world produces confident, wrong code. Nothing here is a criticism of the Build
Spec — §2 (scoring), §3 (state machine), §4 (ladder), §5 (ownership) and §7 (outcomes) are intact and
authoritative. What changed is **where rows live and who may read them**, which is §1 and §6.2.

## The one-paragraph version

FORGE no longer has its own database. It runs against **`ryp-core`**, one Postgres (Neon) shared by
the whole RYP product family, where identity is **Firebase** and authorisation is **Postgres
row-level security**. FORGE's client does not hold a database credential and does not talk to
Postgres. It calls a JSON API inside RYP's own server, which authenticates the caller and runs every
query as that user. Three of the tables §1 specifies are not built, because equivalents already exist
and are already populated.

## Four things to unlearn before writing any code

| The Spec says | It is now |
| --- | --- |
| Supabase auth, `auth.uid()` | **Firebase**, resolved server-side to `public.users.id` (a uuid). `auth.uid()` does not exist in this database and never will. |
| FORGE has its own Postgres | One shared database. FORGE's client talks **only** to an HTTP API; it has no connection string. |
| *"Coaches use a separate web app; the two clients share the API and nothing else"* | **There is one coach surface and it is Atlas's**, decided 2026-08-24. The Coach Console's features are absorbed into it. Do not build a second coach client. |
| `players`, `coach_players`, `coach_notes` | **Not built.** Equivalents exist — see the translation table below. |

## How authorisation actually works here, and the part that is easy to get wrong

Each application connects as its own Postgres role (`forge_app` for FORGE, `atlas_app` for Atlas,
plus `red_app` and `lr_app` for the two shipped products). **Every one of those roles is
`NOBYPASSRLS`** — none of them can see past a policy, including the one your code uses.

Before any query, the server sets session variables identifying the caller, and policies read them
through small helper functions:

```sql
app_private.current_user_id()   -- the caller's public.users.id
app_private.firebase_uid()      -- their Firebase uid
app_private.coaches(subject)    -- true if the caller is an APPROVED coach of that player
```

`app_private.coaches()` is the single authorisation oracle for every coach read. It is true on two
paths — an approved coach relationship the player personally consented to, or shared academy
membership an academy admin granted. **Never inline the rule; always call the function.** There is a
weaker variant, `coaches_or_pending()`, for the identity tier only — a coach who has merely
*requested* a player may confirm they asked for the right person and may not see their numbers.

Three rules follow from this, and they are the ones an AI reasoning from general Postgres knowledge
gets wrong:

> **1. RLS scopes ROWS. It cannot refuse a COLUMN.** The only thing that can is a column-level
> `GRANT`. This is why the design withholds specific columns from specific roles rather than writing
> a cleverer policy. If you find yourself wanting a policy to protect one field, you want a grant —
> or a separate table.
>
> **2. A refused write usually does not raise an error.** An `UPDATE` that no policy admits matches
> **zero rows and returns success.** So "it didn't throw" is not evidence a write landed. Check
> `ROW_COUNT`, or read the row back. A missing *grant* does raise (`42501`); a failing *policy* does
> not. Those are two different failures with two different symptoms, and conflating them has already
> cost this project real time.
>
> **3. Nothing holds `DELETE` on any table, deliberately.** Removal is a soft delete — a `deleted_at`
> or `voided_at` column — and some tables are append-only by privilege, meaning even an author cannot
> edit their own row in place. A correction is a new row.

## The translation table — Spec §1 to what exists

| §1 table | Where it lives now | Why |
| --- | --- | --- |
| `players` | **`golf.player_profile`** (existing). One row per user, `user_id` is the primary key. | It already holds `handicap_index`, `target_handicap`, `driver_carry_yds`, `handedness`, `ghin_number`. Two profile tables means two answers to "what is this golfer's handicap". |
| `players.rungs` (jsonb) | **`golf.facet_rungs`** + **`golf.facet_rung_events`** (new) | A jsonb blob cannot be authorised per-facet or audited. The rung is writable only by the service principal that evaluates the ladder — which is §4's *"the ladder is the only thing that sets level"*, enforced rather than described. |
| `sessions` | **`golf.range_sessions`** (new) | ⚠️ **Not** `golf.practice_sessions`, which already exists and is **one row per player per DAY**. A range visit is not a day. Both are "practice"; they are different grains and they stay separate tables. |
| `session_facets` | **`golf.facet_scores`** (new) | |
| `shots` | **`golf.range_shots`** (new) | ⚠️ The bare name `golf.shots` is reserved for on-course shot data from the RYP Stick product. Yours is range data. |
| `putt18_holes` | **`golf.putt18_holes`** (new) | Name kept. |
| `assignments` | **`atlas.assignments`** (new) + **`atlas.assignment_completions`** | Your design was adopted nearly as specified — it is the table RYP had named in three files and defined in none. |
| `schedules` | **`golf.practice_commitment`** + **`..._history`** (new) | The history sibling exists so "were they behind in week N" stays answerable after someone changes their target. |
| `coach_notes` | **`atlas.coaching_notes`** (existing) | Already has three visibility tiers. FORGE notes stay coach-only, as §1 asks. Now **append-only by privilege** for both apps. |
| `coach_players` | **`public.user_relationships`** + `app_private.coaches()` (existing) | The consent loop is built, proven and in production. Atlas is the only door into it; FORGE reads the result and never writes it. |

## Conventions that are not stylistic

Code written against this database follows these, and a reviewer will reject code that does not:

- **No `CREATE TYPE ... AS ENUM`.** Controlled vocabularies are `text` columns plus a `CHECK` and a
  TypeScript constant. Adding a value must be a code change, not an `ALTER TYPE` migration.
- **No `ON DELETE` clause on a foreign key.** Nothing cascades. Nothing is deleted.
- **`timestamp without time zone`** for instants, **`date`** for calendar days, **`numeric`** for
  handicaps. ⚠️ A session's `played_on` is the **local date at the range**, not UTC — the Spec is
  right about this and the prototype gets it wrong.
- **Provenance is mandatory.** Rows carry `source_app` and a measurement time. Six applications write
  here; a row that cannot say where it came from is a row nobody can trust later.
- **Derived values are not stored.** §READ-THIS-FIRST's *"the composite index is derived, never
  stored"* is honoured. The narrow exceptions are values that must be **frozen at the time of play** —
  `expected_putts`, the level as played, the target in force — because recomputing those later
  rewrites history. That distinction is the whole game: freeze an input, derive an output.
- **Prefer a second table over a cleverer policy.** If two parties write different facts about the
  same subject, those are two tables. One shared row with a policy trying to keep the player out of
  the coach's field is the thing that breaks.

## What this means for FORGE's client, concretely

Today the prototype persists to `localStorage['forge.v5']` and makes **zero network calls**. That is
the gap, and it is the main build item:

1. **Keep the local write-through.** §6.3 is right and nothing here changes it: write to local storage
   on every tap, submit once at completion, retry quietly. Do **not** build an offline sync queue.
2. **Submit to the API, not to a database.** No Supabase client, no connection string, no SQL in the
   client. Sign-in is Firebase; the session cookie carries it.
3. **Carry a client-generated idempotency key** from the moment a session starts. §6.3 asks for this
   and the prototype does not do it. Without it a retried submit either duplicates a session or fails
   forever.
4. **Send the shots.** The prototype discards per-shot data at save. Server-side scoring cannot verify
   an index it cannot recompute, and §1 is explicit that backfill is impossible.
5. **Version the local payload and migrate on read.** The current key has no version field, so any
   change to its shape silently corrupts a returning user's data rather than cleanly discarding it.
   The Spec warns about exactly this.
6. **Delete the demo seed.** §6.4 already flags it: eight fabricated sessions ship as the default
   state. `boot()` also presets a handicap, a carry and a target, so accepting the onboarding defaults
   writes numbers as if the golfer had answered them. All of it goes, or goes behind a flag.

## Status, so nothing here is mistaken for shipped

The schema and the RLS layer are **written and reviewed, not applied.** No FORGE table exists in the
database yet, and the `forge_app` role has not been created. The design carries outstanding fixes and
is deliberately on a branch. **Treat this document as the agreed target, not as the current state** —
and if you are generating code, generate against the target and expect the first migration to land
before any of it runs.

---

## Settled before the walkthrough

| # | Question | Answer |
| --- | --- | --- |
| T-105 | One backend or two? | **ryp-core.** Build Spec §1 and §6.2 superseded. |
| T-119 | Is a FORGE rep something a coach verifies? | **No.** The scored session IS the evidence. |
| T-113 | Alpha on production or a branch? | **A new Neon branch.** |
| T-111 | Rotate the Firebase key? | Later. Exposure measured: ~84% of the body, local disk + Anthropic API, no third party. |

## Closed without asking — already answered elsewhere

| # | Question | Closed by |
| --- | --- | --- |
| 17 | Does `AGENT-BRIEF.md` exist? | It does — `docs/architecture/AGENT-BRIEF.md`. Two agents looked at the wrong path and wrote "missing" into shipped source. Corrected. |
| 16 | Does the FORGE Coach Console need its own DB role? | **No.** Atlas envelops the coach dashboard (2026-08-24). |
| 20 | Does a coach assign from Atlas or from Luke's Console? | **Atlas.** Same decision. |
| 33 | Does FORGE host relationship UI? | **No.** Atlas is the only consent door; `forge_app` is read-only on `public.user_relationships`. |

## Batch 1 — the ones that change the DDL

### 1 · Vocabulary → **`facet` · `assignments` · `range_sessions`**

Luke's table name wins. `facet` for the four-way split, matching the spec and `forge-math.js`.
`golf.range_sessions` for the per-visit grain, distinct from `golf.practice_sessions` (per DAY).

⚠️ **Creates work:** three eco files reserve the name `prescriptions`. They are now stale pointers
and must be repointed to `atlas.assignments` in the same change, or the next reader hunts a table
that does not exist. The player-facing string stays *"PRESCRIBED BY YOUR COACH"* and the coach UI
stays *"ASSIGN WORK"* — the table name is not the UI copy.

### 2 · `source='auto'` → **SHIPS IN v1** *(overrules the recommendation)*

The recommendation was to declare the value and leave it bypass-only, because `METRIC-MAP` states:
*"Forge's primaryLeak stays private precisely so two competing priority labels are never shown to
the same player."* Makel chose to ship it, so a player with no coach gets a suggestion instead of an
empty screen.

**Security is unchanged** — `auto` is reachable only through `TO forge_svc`, which is a service
principal, not a player. The escalation trap holds exactly as designed.

⚠️ **What it creates, and how it is handled:** an auto row's `note` would publish Forge's
`primaryLeak` into the shared layer, which is the thing METRIC-MAP forbids. The note on an auto row
is therefore **templated generically** rather than carrying the leak label. Raise it if you want the
leak itself shown.

⚠️ **Second-order:** with coach, player and auto rows all live, the precedence rule (coach > player
> auto) is now load-bearing in the UI, not just the schema. A coach order must visibly outrank a
Forge suggestion on the same screen.

### 3 · Shot-grain data → **COACHES SEE EVERY SHOT**

`atlas_app` gets SELECT on `golf.range_shots`. Enables shot-pattern coaching later.

⚠️ **Note the asymmetry it creates:** nothing in the product reads it yet — Luke's Console shows only
facet-level numbers — so this is a grant ahead of a screen. It is also a real privacy step: a coach
can reconstruct every ball of every session of every student. Ungranting it after coaches have used
it is a conversation with coaches, not a migration.

### 4 · `blocks_per_week` mid-week change → **ASK LUKE** (it is his cadence rule)

Building the history sibling **anyway**, because it is additive and free now and impossible to
backfill later. The apply-to-which-week logic ships behind a flag, defaulting to *next week*.

Why it matters: current-only storage is gameable. A player sitting at 1 of 5 blocks drops their
target to 1/week and is instantly "on track" — and the coach's "behind" flag silently clears.

**→ For Luke:** does a mid-week change to `blocks_per_week` apply to the current week or the next?

## Batch 2 — access, the note record, and the credential

### 5 · Forge access → **A `forge` ROLE ROW, GRANTED SEPARATELY**

Forge is opt-in per user. `user_app_roles_atlas_signup` keeps admitting only `('atlas','user')` and
does **not** auto-grant forge.

⚠️ **Creates work, and it is on the alpha's critical path:** an admin "grant Forge access" action
(the audited `billing_svc` + `withRlsBypass` pattern `parental-consent` already uses), one control in
`Admin.tsx`, and a line in the alpha runbook. **Without it every tester 403s on their first Forge
request** — so this ships before the first tester, not after.

Upside: a clean lever for a paid tier later without a migration, which matters because pricing is
frozen until Luke approves.

### 6 · Atlas-authored notes → **APPEND-ONLY FOR EVERYONE**

Narrow `atlas_app`'s grant on `atlas.coaching_notes` to `update (deleted_at, updated_at)`. The whole
table becomes append-only **by privilege**, for both apps, which drops the `source_app <> 'forge'`
policy predicate entirely. A correction is a new note.

This is the better shape for the reason the schema file already argues elsewhere: a rule enforced by
a grant cannot be "simplified away" by a later policy edit, and two halves of one table behaving
differently is exactly what a later edit flattens.

### 7 · Retracting a note → **AN AUDITED ADMIN PATH**

Coaches cannot retract. An admin can soft-delete through an audited route.

Mechanically this needs care, because of the defect that nearly shipped in this very file: an
`UPDATE` policy that merely *intends* to be bypass-only, with no policy referencing
`app_private.rls_bypass()`, is **denied by default and matches zero rows silently**. So the
retraction needs an **explicit** `FOR UPDATE USING (app_private.rls_bypass()) WITH CHECK (…)` policy
alongside the narrowed grant — the grant permits the column, the policy decides the principal.

⚠️ Also fix the route: it currently returns **404** on a refused retraction, which reads as "no such
note". It must return **409**.

### 8 · `forge_svc` → **ATLAS HOLDS IT**

FORGE's API runs inside Atlas's Express server as `server/routes/forge.ts`, behind `attachUser` and
`requireConsent`, alongside the nine existing routers. Luke's client calls that API; **he never holds
a database credential.**

One credential store, one deploy, and the ladder and assignment completion — the two things
`forge_svc` alone may stamp — cannot be written by code outside this repo. This also confirms the
assumption the whole gap assessment was built on, so it stops being an assumption.

## Batch 3 — behaviour, not schema

### 9 · Provisional sessions → **COUNT toward the streak and blocks-per-week**

The spec asks this of itself (§9) and does not answer. The answer is that **the streak measures
attendance, not quality.** A player who drove to the range and hit 12 balls was there.

The protection that matters is unchanged: a provisional session is still excluded from the current
picture and still never becomes a headline number (§READ THIS FIRST). So quality is protected where
it is actually at risk, and the streak stops creating an incentive to type in five fake shots —
which is the failure mode that corrupts the data this whole product exists to collect.

**Reads filter `completed_at IS NOT NULL` for the index, and do NOT filter it for the streak.**

### 10 · Today calendar → **TWO DISTINCT ROWS** *(overrules the recommendation)*

A Forge range visit and a self-logged practice day stay visually separate in the day cell.

The recommendation was to merge, on the grain argument. Makel chose separation, and the reason it is
a good call is **provenance**: a merged cell cannot show the player which part of their day was
*measured* and which part they *typed*. Keeping them apart makes the distinction visible at a glance
on the most-used screen — the same measured-vs-modelled discipline the rest of this port enforces.

No schema change either way; the join is `(user_id, played_on)` ↔ `(user_id, session_date)`.

### 11 · A player's self-set assignments → **COACH SEES THEM, READ-ONLY**

The spec flagged this as assumed rather than decided. Now decided, and it matches the assumption.

⚠️ **Changes a policy:** `assignments_update` must **exclude `source='player'` rows from coach
revocation**, not merely rely on precedence. As designed, any approved coach could reword or revoke
them. A coach needs to know what their student chose to work on; a student's own plan is not the
coach's to delete.

Conflict is already handled by precedence — a coach order outranks a player's on the same screen.

### 12 · Collapsed notes → **ONE RECORD PER PLAYER**

A Forge coach sees Atlas-authored notes and vice versa. That is the point of one backend and it is
the documented Locker Room fix.

**No note becomes visible to anyone who could not already read that student** — both sets are
coach-only and both sit behind `app_private.coaches()`. The change is between coaches of the same
student, not between a coach and a stranger. The failure it prevents: a colleague's note about a
safeguarding issue being invisible because it was typed in the other app.

## Batch 4 — authority, the consent tier, and two scoring calls

### 13 · Coach vs coach → **ANY APPROVED COACH MAY REVOKE OR REWORD** *(overrules the recommendation)*

Matches how an academy actually works: coaches cover for each other, and a student's plan should not
freeze because one coach is away. It also keeps the orphan fix — an order outliving the relationship
that created it can be cleared.

⚠️ **The hole this leaves open, stated plainly rather than argued away.** A player who creates a
second account, has account B request to coach account A, and approves it from A — which they can,
because they own both — reaches **another coach's orders** on their own record. The self-edge CHECK
closes "coach yourself"; it does not close "coach yourself through a second account."

**Mitigation built instead of re-asking:** every revoke and reword writes a `public.admin_audit` row
naming the acting coach. It does not prevent the move, but it stops it being silent — and a
same-player pair is visible in the audit the moment anyone looks. Raise it if you want the stronger
rule (author-only + admin cleanup); it is a policy change, not a migration.

### 14 · The pending-coach tier → **TIGHTEN IT**

`GET /api/coach/students` begins returning `profile: null` for a **pending** student. This is the
two-tier rule from 2026-08-24 finally being enforced rather than described: identity until approved,
metrics only after. Without it, approval on the direct-coach path grants nothing the coach could not
already read, and **the consent loop is decorative.**

⚠️ **Creates UI work:** the card must render *"awaiting approval"* rather than an empty profile.
A null that renders as blank reads as a bug and will be reported as one.

### 15 · Putt 18 "enter as a total" → **SURVIVES, flagged `entry_method='tally'`**

The fast path after a real round, and people will use it. It writes a complete Putt 18 with **zero**
per-hole rows, which is fine as long as it is labelled.

⚠️ **Consequence to accept and to state in the UI:** §7.4's correlation work reads per-hole grain, so
it will never see these sessions. That is honest and visible rather than silent — analytics filters
on `entry_method`, and the putting calibration work draws only from hole-by-hole rounds.

### 16 · Driving asymmetry → **SYMMETRIC. FIX IT.**

The spec calls the prototype's behaviour a bug and says the intent was symmetric; only a miss **left**
currently counts as a bad miss. A miss is a miss.

Storage is unaffected (`outcome_value` 0–4 either way), so this is a scoring-formula change rather
than a migration — **but it moves every driving index**, so it lands before the first row is written,
not after.

⚠️ Numbers will no longer match what Luke has been looking at in his prototype. That is the point,
and he should be told rather than left to notice.

## Batch 5 — the spec amendment, and three deferrals

### 17 · `baselineHandicap` → **INTERPOLATION. AMEND BUILD SPEC §2.3.**

🔴 **This is a spec amendment carrying Makel's signature, not a bugfix.** The Build Spec declares
itself the contract; this overrides it in one named place.

The three answers were: Spec step table **15**, `forge-math.js` linear interpolation **12.5**, test
fixture **7.5**. The module's own argument decides it and it checks out numerically — under the
spec's step model **234 yd → 15 and 236 yd → 10**. Two yards of carry, five handicap strokes. That
is indefensible to a player who gains a yard.

**Three things now change so that all three agree:**
1. Build Spec §2.3 — step table → linear interpolation. Record the amendment in
   `FORGE-ON-RYP-CORE.md`'s supersession table.
2. `forge-math.js` — **no change**. It was already right.
3. `forge-math.test.js:33` — the fixture's **input** is wrong, not its expectation: 245 yd is the
   midpoint of 10→5, not 225. Fix the input and the suite goes 57/57.

### 18 · Teams and leaderboards → **NOT IN v1**

They are already §6.4 toasts on no milestone. The roster-scoped option would require inventing a
**player-to-player access class** that nothing else in the ecosystem needs, and would make a
15-year-old's numbers visible to their peers — which drags parental consent into it too.

Deferring costs nothing. Building it wrong costs a privacy incident between students.

### 19 · Forge notes player-invisible → **A v1 DEFAULT, EXPECT TO RELAX**

The visibility column is built into Forge's insert path now; every Forge note stays coach-only.
Atlas's three tiers already exist, so relaxing later is **one grant line plus a UI control**, not a
migration. This is the cheap option taken deliberately: the mechanism goes in while it is free.

### 20 · Display name → **ATLAS OWNS IT. Forge reads, never writes.**

`forge_app` gets no write grant on `public.users`. That table stays writable by as few roles as
possible, which is the entire point of Atlas-as-identity-nucleus and the reason `atlas_app` was
narrowed to five columns in September. Forge's onboarding displays the name it already has.

### Closed without asking — follows from Batch 2

**Is Forge practice data plan-gated?** **No plan predicate in v1.** The `forge` role row (Batch 2 #5)
*is* the gate, and no `golf` table carries `plan_at_least()` today. Adding one later is a policy
change. Pricing stays frozen until Luke approves.

## Batch 6 — the last four

### 21 · Benchmarks → **KEEP `CAL.benchmarks`** *(overrules the recommendation)*

The recommendation was Arccos, on the grounds that it has a stated source and a stated method while
`CAL.benchmarks` does not. Makel chose `CAL.benchmarks`. It ships.

⚠️ **Two things to record, because they are facts rather than preferences:**

1. **A genuinely scratch player will read as roughly an 11-handicap driver** against this table
   (scratch = 250–280 yd carry / 62% fairways vs Arccos's ~230 / 45%). That is the first number a
   good player sees. It is now a known, chosen characteristic rather than a bug, and it should not be
   re-reported as one.
2. **The `MEASURED` tag on this table is unsupported as shipped** — the package contains no source
   for it, and the app's own comment contradicts it (*"flatter than folklore: scratch–4.9 hit 50%"*
   against the 62% the table claims). Choosing the numbers is Makel's call; the provenance tag is a
   separate claim. **→ Luke must supply the source, or the tag is downgraded from MEASURED.**

### 22 · Gender → **DON'T ASK FOR GENDER. ASK FOR THE CARRY REFERENCE DIRECTLY.**

Neither recommendation — Makel took the third option, and it is the better answer, because it is
honest about what the field actually does. The field never meant "who are you"; it meant "which
statistical reference class should we compare you against".

**So the column is not `gender`.** It is `golf.player_profile.carry_reference`, text, **nullable with
no default**, holding which scale to score driving against. The UI asks it by name — *"PGA
Tour–Scratch scale"* / *"LPGA–Division III scale"* — rather than asking a personal question to
derive it.

⚠️ **This dissolves T-125's silent fall-through by construction, and that is the main win.** The
failure was `CAL.carry[gender] || CAL.carry.m` — `'female'` yielding `undefined` and landing on the
men's table with no error. With a reference column there is no vocabulary to mismatch: a mapping
layer translates `carry_reference` to the module's key explicitly, and **null means no driving index
is computed at all**, which is the same rule every other unfitted number here follows.

⚠️ Asks a golfer to self-classify against a table they have never seen, so the UI copy has to carry
its weight — name the scale *and* show its range.

### 23 · The 30-minute block → **PERMANENT. STAYS UNSTORED.**

The spec says it twice and calls it "not configurable". A fixed unit is what makes *blocks per week*
comparable between two players; the moment one player's block is 45 minutes, the number stops
meaning anything shared. Leaving it unstored is the honest encoding of "this is not a variable".

If it ever changes, that is a migration — and it should be, because it reprices every historical
streak.

### 24 · The putting ladder → **MAKEABLES PROMOTES. PUTT 18 MEASURES.**

Three spec sections disagreed. §2.4 defines four levels for Makeables and the spec gives Putt 18
**none**, so Makeables is the only putting drill a ladder can run on.

The two jobs stay separate and that separation is the answer: **Putt 18 produces the Putting Index
for the composite; Makeables carries the rungs.** One number does not have to do both.

---

# Where this leaves it

**24 of 34 answered.** Four were closed without asking (already decided elsewhere), and six are
genuinely Luke's — collected in `ASK-LUKE-forge-port.md`.

**Three answers overruled a recommendation** and are recorded as overrules, not rewritten: `auto`
ships, the calendar shows two rows, and `CAL.benchmarks` stays. **One answer was better than either
recommendation** — asking for the carry reference instead of gender, which dissolves T-125 rather
than patching it.
