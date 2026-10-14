# FORGE on ryp-core — the document that supersedes Build Spec §1, §6.1 and §6.2

**Read this with the FORGE Build Spec open beside you.**

The Build Spec opens with its own precedence rule:

> *"the HTML prototype is the visual reference; this document is the contract. Where the two
> disagree, this document wins."*

That rule is correct and still binds — against the prototype. It does **not** bind against this
document. This file exists because nothing else outranks the Spec, so an engineer who reads §1 and
§6.2 cold will build Supabase, a second Postgres, a second user table and a second coaching graph.
All four are wrong as of 2026-10-06.

**Precedence, stated once:** this document > FORGE Build Spec > the `.dc.html` prototypes.
Where this document is silent, the Spec wins exactly as it says.

---

## 1 · The decision, and what it overrides

**Makel, 2026-10-06, in his own words:**

> *"we will need to configure forge to work on our database. not his."*

**FORGE runs on `ryp-core`.** Neon project `orange-mountain-36415593`, database `neondb`, branch
`main`. Identity is **Firebase** (`rypstick-ios`) resolved through Atlas's `attachUser`.
**Supabase is off.** There is no second database and there will not be one.

What that decision overrides, and nothing more:

| Overridden | Why |
| --- | --- |
| **§1 Data model** — every table | Nine tables, re-homed into `public.*`, `golf.*` and `atlas.*`. Three collapse into tables that already exist; six are new; none is built in a Forge-private database. |
| **§6.1 API surface** — the endpoint list | The endpoints survive almost verbatim. What changes is what they run inside, and two of them stop being Forge's. |
| **§6.2 Auth and RLS** — in full | Supabase, `auth.uid()`, `coach_players` and *"coaches use a separate web app"* are all replaced. Its one **behavioural** rule survives and is enforced harder than the Spec asks. |

What the decision does **not** touch: §2, §3, §4, §5 and §7 — see **§5 of this document**, and read it
before you assume otherwise, because a handful of *storage mechanics* inside those sections do change
even though their rules do not.

A second decision, made earlier, rides along with this one:

> **Makel, 2026-08-24:** Atlas envelops the main coach dashboard — *"give the coach access to all
> Atlas app metrics for all of the coach's students."*

So §6.2's *"Coaches use a separate web app; the two clients share the API and nothing else"* is
superseded too. The coach surface is Atlas's dashboard, running as `atlas_app`. See **§7.3**.

---

## 2 · Supersession table

### §1 — Data model

The §1 preamble survives as intent and is satisfied by machinery that already exists:

> *"Every table is row-level-security scoped: a player reads only their own rows; a coach reads rows
> for players in a coaching relationship with them. No table is world-readable."*

True in ryp-core, but the coach test is **`app_private.coaches(subject)`** — a function, not a join
you write — and it admits a path Forge never modelled (shared-academy membership). No policy inlines
the rule. See §3.

| Spec table | What §1 says | What replaces it |
| --- | --- | --- |
| `players` | One row per golfer: `id` *"Matches auth user id"*, `name`, `gender` *(the Spec's column — **not built**)*, `usga_handicap`, `usga_updated_at`, `avg_carry_yds`, `target_handicap`, `rungs` jsonb | **Collapses into `golf.player_profile`**, whose PK is already `user_id`. `name` is `public.users.display_name`. `rungs` leaves the row entirely — see §4. 🔴 **`gender` becomes `golf.player_profile.carry_reference`** (`'pga_scratch'` \| `'lpga_d3'`, nullable, no default — answer 22, checklist B22). **There is no `gender` column and none is coming**; see §2.3 below for why. |
| `sessions` | One row per **range visit**, `played_on` local date, `seed` must persist | **New `golf.range_sessions`.** Not `golf.practice_sessions` — that is one row per player per **day**, unique-indexed. A grain conflict; they cannot be one table. |
| `session_facets` | One row per facet scored, `index_value` clamped −6…40, `is_complete` computed on write | **New `golf.facet_scores`.** `index_value` → `practice_index` (`golf` already owns "index" for handicaps). |
| `shots` | One row per ball struck. *"Store it from day one — the volume is trivial and backfill is impossible."* | **New `golf.range_shots`.** The bare name `golf.shots` is reserved for RYP-RED's on-course ball flight (`golf.ts:9`). |
| `putt18_holes` | One row per hole, `expected_putts` **stored, not recomputed** | **New `golf.putt18_holes`** — the one Forge table name that survives unchanged. |
| `assignments` | One per prescription, `source` enum `coach · player · auto`, **no `level` field** | **New `atlas.assignments`** — Luke's name, adopted (Makel, 2026-10-06). Three eco files had reserved `prescriptions` for this table and none defined it; they are repointed in the same change. Forge's design is the table Atlas has been missing. Plus an append-only child, `atlas.assignment_completions`. ⚠️ The table name is not UI copy: the player-facing string stays *"PRESCRIBED BY YOUR COACH"* and the coach UI stays *"ASSIGN WORK"*. |
| `schedules` | One per player, `blocks_per_week` 1–7, session length always 30 min and not stored | **New `golf.practice_commitment`.** Not `golf.schedules` — a bare "schedules" in a schema Locker Room reads means lesson bookings. |
| `coach_notes` | `player_id`, `coach_id`, `body`, `created_at`. Append-only; *"not visible to the player in v1"* | **Collapses into `atlas.coaching_notes`**, with `source_app = 'forge'`. Append-only is enforced by a withheld UPDATE grant; player-invisibility by a withheld `visibility` column grant. |
| `coach_players` | *"the relationship table RLS reads"* | **NOT BUILT.** `public.user_relationships` is it, read only through `app_private.coaches()`. |

> 🔴 **A tenth table the mappings do not cover.** §7.3 mandates an `outcomes` table —
> `player_id`, `measured_on`, `kind` (`putt18` · later `round_score` · `usga_handicap`), `value`,
> `session_id` — and §1 never defines it. No mapping in this round covers it, and §7.3's own words are
> *"the aggregate in `outcomes` is not sufficient on its own"*, i.e. it is additional to
> `putt18_holes`, not a substitute. **Unmapped, open.** Do not invent it; route it before you build
> it, and settle whether a Putt 18 score lives in `facet_scores`, in `outcomes`, or in one with the
> other derived. **Two copies will drift** — §1's own first rule.

### §2.3 — Baseline handicap from average carry *(amended, Makel, 2026-10-06)*

🔴 **This is a spec amendment carrying Makel's sign-off, not a bugfix.** The Build Spec declares
itself the contract; this overrides it in one named place and leaves every number in §2.3 alone.

| §2.3 clause | Replacement |
| --- | --- |
| *"First row where `carry ≥ threshold` wins; below the last threshold the baseline is 30."* — a **step table**. | **Linear interpolation between adjacent rows**, which is what `forge-math.js` (`baselineHandicap`) and the prototype's `baseHcp()` (`FORGE.dc.html:2692`) already do. Above the top row the value clamps (−5 men, −5 women). **The eight anchor pairs in each of the two carry tables are unchanged** (`CAL.carry.m` and `CAL.carry.f` in the module; which one applies is chosen by `carry_reference`, not by anything about the person) — *"copy the numbers, do not re-derive them"* still holds; only the lookup rule moves. |

**The argument that decided it, and it was checked against the Spec's own table:** under the step
model **234 yd → 15 and 236 yd → 10**. Two yards of carry, **five handicap strokes**. Every threshold
in the table is a five-stroke cliff, because the rows are five strokes apart. `drivingIndex` adds
`baselineHandicap` straight into its result, so a player who corrects a self-reported carry from 234
to 236 would watch their driving index move five strokes for a difference well inside the honest
error of *"average driver carry"*. Interpolated, the same two yards read **10.3 and 9.8**.

**Luke's own code comment makes exactly this case** — `forge-math.js`, `baselineHandicap`:
*"A step table would put 234 and 236 yards a full stroke apart."* It understates its own argument
fivefold; the table puts them **five** strokes apart.

**Three things change so the three artefacts agree:**

1. **Build Spec §2.3** — step table → linear interpolation (this row).
2. **`forge-math.js`** — **no change**. It was already right.
3. **`forge-math.test.js:33`** — the fixture's **input** was wrong, not its expectation. Midway
   between the 10 anchor (235 yd) and the 5 anchor (255 yd) is **245 yd**, not 225. The input was
   corrected 225 → 245 and the label with it. Run against `build/forge-math.js`: **57 passed, 0
   failed** (it was 56 passed, 1 failed).

⚠️ **What this amendment does NOT decide:** the behaviour *below the last populated row*. The module
treats the table's final `[0, 30]` row as a genuine anchor and interpolates across a 185-yard
segment (100 yd → 27.3; 184 yd → 25.0), while the Spec's flat 30 starts at 184 yd. Neither is
defended by the sign-off, which says only *"`forge-math.js` — no change"*. `FORGE-MATH-ADOPTION.md`
§3 argues for extrapolating the last real segment (reaching 30 at 170 yd men / 145 yd women); that
remains a **proposal awaiting Makel**, not part of this amendment.

> ⚠️ **Update 2026-10-14 — item 2 above ("`forge-math.js` — no change") describes the vendored file, not what ships.**
> The port (`@ryp/eco/scoring`, `eco/src/scoring/index.ts`) interpolates as this amendment says, and the tail is
> still `[0, 30]`-as-anchor (verified: `baselineHandicap(100, 'pga_scratch')` = 27.3). But its signature is no longer
> `(yards, gender = 'm')`: it is `(yards, carryReference)` and **returns `null` for a missing or unknown
> reference** — a null reference no longer reads the men's table. That is the T-125 fix landing in the scoring layer;
> the verified behaviour and every other departure from `forge-math.js` are listed once, in
> `FORGE-MATH-ADOPTION.md` §9.

---

### §6.1 — API surface

The endpoints survive. What changes is the runtime around them and the ownership of two.

| Endpoint | §6.1 says | What now applies |
| --- | --- | --- |
| `POST /sessions` | *"Allocates the seed server-side. Returns the full session."* | Stands. The row is **inserted here**, not at submit — the seed must be the one the holes were played with. Seed is a column default and is **withheld from the INSERT grant**, so "server-side" is a privilege, not route code. |
| `PATCH /sessions/:id` | *"Upserts facets and shots together, idempotent on `(facet, shot_index)`. Must tolerate replay from the offline queue."* | Stands. ⚠️ Every write here must be **raw SQL naming only the granted columns** — see §7.1. |
| `POST /sessions/:id/complete` | *"Computes indices server-side, evaluates ladder transitions and assignment completion, returns what changed."* | Stands, and is the **only** path that may write a rung, a completion or an `auto` assignment — so it is the only path that touches **`forge_svc`**, never `forge_app`. ⚠️ It is also a player-facing handler, which bounds what the role split buys: see §7.1. Replay protection moves here: if the session is already complete and the idempotency key matches, return the stored result and write nothing. |
| `GET /me/dashboard` | *"One call — Today must not fan out."* | Stands unchanged. |
| `PUT /me/schedule` · `PUT /me/profile` | *"Blocks per week, pinned focus; handicap, carry, target, gender."* — **the Spec's wording; the last word is superseded** | Stands, with one substitution: **the profile field is `carry_reference`** (`'pga_scratch'` \| `'lpga_d3'`, nullable, no default), asked as *"PGA Tour–Scratch scale"* / *"LPGA–Division III scale"* — answer 22, checklist B22. **Do not accept, store or derive a gender.** `/me/profile` now writes a row **two apps share** (`golf.player_profile`), so every handicap write must append `golf.handicap_history` in the same transaction. |
| `GET /coach/roster` | *"Per player: index, 30-day delta, days since last session, assigned/done, leak, levels. Server-computed."* | **No longer a Forge endpoint.** Atlas's coach dashboard owns it (2026-08-24). The roster is `app_private.coaches(u.id)` as the filter — never a `user_relationships` query, which misses the academy path. "Days since last session" is `greatest(max(practice_sessions.session_date), max(range_sessions.played_on))`. |
| `GET /coach/players/:id` | *"History, per-facet trends, queue, notes."* | **No longer a Forge endpoint**, same reason. "Notes" is a **thread** — `order by created_at desc` — not one string. |
| `POST /assignments` · `DELETE /assignments/:id` | *"Accepts multiple player ids. Delete expires rather than removes."* | The coach half moves to Atlas. **`DELETE` is not a DELETE**: no role holds a DELETE grant on `atlas.assignments`, so the endpoint is an UPDATE setting `revoked_at`. §5.3's *"Never delete on completion — expire, so history survives"* is enforced by privilege. |

**§6.3 (deferred submit) is NOT superseded.** *"Do not build an offline sync queue"*, local
write-through on every tap, one submit at completion with a client-generated idempotency key, retry
quietly on next app open — all of it stands verbatim.

### §6.2 — Auth and RLS, in full

| §6.2 clause | Replacement |
| --- | --- |
| *"Supabase auth."* | **Firebase** (`rypstick-ios`). Atlas's `attachUser` resolves `firebase_uid` → `public.users`, provisioning on first login, and loads the app entitlements. |
| *"A player reads and writes only rows where `player_id = auth.uid()`."* | `user_id = app_private.current_user_id()`, inside `withRls(pool, {userId, firebaseUid, app}, schema, cb)`. `auth.uid()` does not exist in this database. |
| *"A coach reads rows for players joined through an accepted `coach_players` row."* | `app_private.coaches(subject)`. `coach_players` is not built. The oracle is two paths: an approved `public.user_relationships` edge (`status='active'` **and** `approved_at is not null`) **or** shared `org_memberships` where the student's role is `'member'`. **Never inline the rule** — drift here fails silently. |
| *"...and writes only `assignments` and `coach_notes` — never a player's sessions or shots."* | **NOT superseded. Enforced harder than asked:** by GRANT, not only by policy. The coach surface is `atlas_app`, which holds **SELECT and nothing else** on every Forge data table. A coach write is refused by privilege (42501) before any policy is consulted. |
| *"Coaches use a separate web app; the two clients share the API and nothing else."* | **Superseded** by the 2026-08-24 decision. Atlas's coach dashboard is the coach surface. See §7.3. |

One tier distinction §6.2 has no concept of, and it matters: ryp-core splits coach visibility in two.
`coaches_or_pending()` is the **identity** tier — a coach who has only *requested* a player sees the
profile card. `coaches()` is the **metrics** tier, approved only. **Every Forge row is a metric.**
Gate on `coaches()`, never `coaches_or_pending()`.

---

## 3 · The identity mapping

```
Firebase (rypstick-ios)  ──▶  req.firebaseUid
        │                           │
        │                  attachUser (eco/src/auth/attachUser.ts)
        │                           │  resolves / provisions public.users
        ▼                           ▼
   id token / session        req.user.id : uuid  =  public.users.id
                                        │
                      withRls(pool, {userId, firebaseUid, app}, schema, cb)
                                        │  set_config('app.current_user_id', …)
                                        │  set_config('app.firebase_uid',    …)
                                        │  set_config('app.rls_bypass', 'false')
                                        ▼
                         app_private.current_user_id()  ◀── policies read this
```

**`players.id` — "Matches auth user id" — is `public.users.id`.** Not `firebase_uid`, not
`auth.uid()`. `firebase_uid` is the credential; `users.id` is the person. Every `player_id` in the
Spec becomes a `uuid` referencing `public.users(id)`, named `user_id` (or `subject_user_id` where the
table already uses the actor/subject vocabulary), with **no `on delete` clause**.

The three policy accessors are deliberately **SECURITY INVOKER** — they read session variables only,
touch no table, and therefore cannot recurse. The coach oracles are **SECURITY DEFINER with a pinned
`search_path`**, which is why a role needs no grant on `user_relationships` or `org_memberships` to be
authorized by them.

### A policy, before and after

**Before — what §6.2 implies you write:**

```sql
-- Supabase. The player's own rows.
create policy sessions_self on public.sessions
  for all
  using      (player_id = auth.uid())
  with check (player_id = auth.uid());

-- The coach, with the relationship rule inlined.
create policy sessions_coach_read on public.sessions
  for select
  using (exists (select 1 from public.coach_players cp
                  where cp.player_id = sessions.player_id
                    and cp.coach_id  = auth.uid()
                    and cp.status    = 'accepted'));
```

**After — what you write on ryp-core:**

```sql
alter table golf.range_sessions enable row level security;
alter table golf.range_sessions force row level security;   -- both; the owner is bound too

drop policy if exists range_sessions_select on golf.range_sessions;
create policy range_sessions_select on golf.range_sessions for select
  using (app_private.rls_bypass()
         or user_id = app_private.current_user_id()
         or app_private.coaches(user_id));          -- METRIC tier. Never coaches_or_pending().

drop policy if exists range_sessions_insert on golf.range_sessions;
create policy range_sessions_insert on golf.range_sessions for insert
  with check (app_private.rls_bypass() or user_id = app_private.current_user_id());
```

Four things changed, and each is load-bearing:

1. `auth.uid()` → `app_private.current_user_id()`, a session variable set by `withRls`.
2. The inlined `coach_players` join → `app_private.coaches(user_id)`, which also admits the academy
   path that has **no row** in `user_relationships` at all.
3. `force row level security` — without it the table owner is exempt and the policy is decorative.
4. `rls_bypass()` leads the disjunction — but **only because this policy is owner-scoped**. See the
   carve-out directly below; it is the one place this document's house style has an exception, and
   getting it wrong re-opens the escalation trap.

> ### ⚠️ The bypass-first convention has one carve-out — read it before copying the shape above
>
> Leading with `app_private.rls_bypass()` is correct for an **owner-scoped** policy like the one
> above: the predicate it short-circuits is only *"is this your row"*.
>
> It is **wrong on any write policy that pins an authority claim** — a column whose value says *who
> ordered this* or *which app produced this*. `rls_bypass()` is a session variable, not a role
> attribute, so an `rls_bypass() OR …` branch on such a policy means any code on that pool can write
> any value of the pinned column. Concretely, **these three must not carry it**:
>
> - `atlas.assignments` INSERT — the branch would let a player write `source='coach'` with any
>   `created_by_user_id` for any subject, which is the exact escalation §7.2 of this document exists
>   to close.
> - `atlas.coaching_notes` INSERT **for Forge** — the branch would let a note be filed under another
>   coach's `author_user_id`, or stamped `source_app='atlas'`. *(Originally also "which makes it
>   editable by Atlas's PATCH route and defeats append-only" — no longer true: since 2026-10-06 the
>   whole table is append-only by privilege, for both apps, and the PATCH route refuses with 409.
>   The author-and-relationship pin still stands on its own.)*
> - `golf.facet_scores` / `golf.range_shots` INSERT — the branch bypasses the parent-liveness test.
>
> Where a privileged write genuinely must happen, it does **not** get a bypass branch on the
> request-path policy. It gets its own policy scoped `TO forge_svc`, **row-pinned to the caller,
> with no bypass branch at all**, on a role the request path does not hold. See §7.1.
>
> 🔴 **CORRECTED 2026-10-14 — AN EARLIER DRAFT OF THIS LINE TAUGHT THE DEFECT THIS CHANGE SET
> NEARLY SHIPPED.** It prescribed `using (app_private.rls_bypass()) with check
> (app_private.rls_bypass())` for the `TO forge_svc` policies. That is wrong, and it is wrong in the
> quiet direction. `rls_bypass()` is a session GUC, so keying the policy on the **variable** instead
> of the **row** hands the whole control back to anything holding the connection. Worse, an
> implementer who followed it would run the evaluator inside `withRlsBypass` — with no
> `app.current_user_id` set — and get **two different failures**:
>
> 1. **`42501` on the INSERT.** Loud. This is the one you would notice.
> 2. **The UPDATE half of the rung upsert matches ZERO ROWS and raises nothing.** Silent. This is
>    the one that ships. A level that never moves is indistinguishable from a player who never
>    improved, and nothing in the logs says otherwise.
>
> **The shipped policies, quoted from `eco/sql/rls_forge.sql` as applied to branch `alpha`
> 2026-10-14. They are row-pinned to the role, with no bypass branch:**
>
> ```sql
> create policy facet_rungs_service_write on golf.facet_rungs for all to forge_svc
>   using      (user_id = app_private.current_user_id())
>   with check (user_id = app_private.current_user_id());
>
> create policy facet_rung_events_service_insert on golf.facet_rung_events for insert to forge_svc
>   with check (user_id = app_private.current_user_id());
>
> create policy assignment_completions_service_insert on atlas.assignment_completions
>   for insert to forge_svc
>   with check (subject_user_id = app_private.current_user_id());
>
> create policy facet_scores_service_recompute on golf.facet_scores for update to forge_svc
>   using      (user_id = app_private.current_user_id())
>   with check (user_id = app_private.current_user_id());
> ```
>
> Three details that are easy to copy wrong:
>
> - the two `for insert` policies have **only** a `WITH CHECK`. An INSERT policy has no `USING`;
> - `assignment_completions` keys on **`subject_user_id`**, not `user_id`;
> - `facet_scores_service_recompute` deliberately carries **no liveness test**. That absence is the
>   feature — a re-score has to reach a historic, completed session.
>
> **So `forge_svc` runs under `withRls(playerId)`, exactly like every other role — never under
> `withRlsBypass`.** The `TO forge_svc` clause decides only *which process may reach the verb*;
> authorization is still identity, and it shows up in `pg_policies.roles` where a gate can pin it.
>
> ⚠️ **And the residual, stated rather than hidden:** the row scope is the caller's own claim
> (`app.current_user_id` is a session GUC set by the same caller), so it stops a **bug**, not an
> attacker who already holds the credential. `rls_forge.sql` §1 struck its "a compromised request
> path cannot" sentence for exactly that reason. Do not reinstate that claim here.

### Four traps this ecosystem has already fallen into

1. **`rls_bypass()` is not a privilege boundary.** It is `current_setting('app.rls_bypass')`, which
   *any* code on *any* pool can set. It defeats **policies, not privileges**. "Bypass-only" is
   therefore not a security control on its own — a role that holds the grant can set the flag. Where
   a write must be privileged, it goes to a **separate role** (`forge_svc`) that the request path does
   not hold. See §7.1.
2. **A missing policy is not a deny-with-bypass.** With RLS enabled and **no** INSERT policy,
   Postgres denies every write *including* under bypass. If `forge_svc` is to write, it needs an
   explicit `TO forge_svc` policy. 🔴 **CORRECTED 2026-10-14:** this line used to prescribe
   `using (app_private.rls_bypass()) with check (app_private.rls_bypass())` for that policy. **It
   gets no bypass branch** — see the carve-out box above for the four shipped policies and for the
   two ways the bypass form fails, one of them silently. Omitting the policy altogether is still
   not "locked down"; it is "nothing can ever write this table".
3. **An RLS-filtered UPDATE matches 0 rows and raises nothing.** On 2026-09-25 a falsification test
   read that silence as success and reported a hole in a database where the policy was working
   perfectly. **Any test on a column the role CAN write must assert `GET DIAGNOSTICS n = ROW_COUNT`
   and read the value back.** Only a column the role *cannot* write (42501) is safe to test by
   exception.
4. **RLS scopes rows, not columns.** A column grant is the only layer that can refuse a column. This
   is why `seed`, `played_on`, `level`, `measured_at` and `source_app` are withheld from UPDATE
   grants: the row policy says "your own row", which a column-rewriting UPDATE still satisfies.

   🔴 **CORRECTED 2026-10-14 — this list named two columns wrongly.**
   - **There is no `scored_at` column**, here or anywhere in `forge.ts` or `rls_forge.sql`. The
     withheld re-dating column is **`measured_at`** on `golf.facet_scores` (re-dating a score fakes
     recency on the coach roster — the same class as `practice_sessions.session_date`).
   - **`entry_method` is NOT withheld.** It is in `forge_app`'s UPDATE grant on `golf.facet_scores`
     *and* `golf.range_shots` (checklist A2, 2026-10-09), because §3.3's *"log it shot by shot
     instead"* flow **reuses the same facet row** — the `(session_id, facet, mode)` unique key
     forbids a second one — so the relabel has to be legal or the Spec's own flow has no path at
     all, and an impossible flow is how a grant quietly becomes route code that bypasses it.
     **It is updatable only while the parent session is live.** `facet_scores_update` carries the
     liveness test, so once the session completes the identical statement matches **zero rows and
     raises nothing** — which is the behaviour §10.2 case 6 asserts in both directions. It stays
     withheld from `forge_svc`, whose UPDATE grant on `golf.facet_scores` is exactly
     `(practice_index, scoring_version, updated_at)`.

---

## 4 · The table map

> ### Cross-cutting rules — these apply to EVERY row below. Read them once; they are not repeated.
>
> **a. The role.** `create role forge_app login nobypassrls;` — ⚠️ **CORRECTED 2026-10-14: it now
> exists on the Neon branch `alpha` (`br-spring-dawn-auoaqi5p`), together with `forge_svc`, both
> verified `rolbypassrls = false`, `NOINHERIT`, not superuser. It still does NOT exist on `main`.**
> This line used to say flatly that it does not exist — even
> though `golf.drill_progress` already carries column comments calling `ticked_at`/`watched_at`
> *"forge_app's columns"*. All four live roles are `LOGIN NOBYPASSRLS`; do not make this one NOLOGIN.
> It also needs `grant usage on schema public, app_private, golf, atlas to forge_app` — PUBLIC holds
> no USAGE on `app_private` or `golf`, so without it **every policy fails before any logic runs**.
>
> **b. Drizzle will 42501 on a column-scoped INSERT.** `db.insert()` names *every* column and passes
> `default` for the unset ones, and Postgres requires INSERT privilege on every column a statement
> **names**, even where the value is DEFAULT. This 403'd `/api/intake/start` on 2026-09-01 (TASKS
> D-11) and the error reads exactly like an RLS failure. **Every Forge writer to a column-granted
> table must use raw SQL naming only the granted columns** — `atlas/server/routes/intake.ts:368-385`
> is the precedent.
>
> **c. Child INSERT must test parent liveness, not only UPDATE.** `facet_scores`, `range_shots` and
> `putt18_holes` all hang off a session. If only UPDATE is gated, a player appends new rows to a
> *completed* session and rewrites the trend behind the published index. One predicate, everywhere:
> `completed_at is null and abandoned_at is null` on the parent, with the parent owned by the caller.
>
> **d. The composite FK is the attribution control.** Every child carries a denormalised `user_id`
> (so the policy is a one-liner and never recurses into a parent's own RLS) **plus** a composite FK
> `(parent_id, user_id) → parent(id, user_id)`. The parent must therefore declare
> `unique (id, user_id)`. Without it, a forged `user_id` hangs your row on someone else's session.
>
> **e. Conventions.** Text columns + TypeScript consts, **never pg enums**. `timestamp without time
> zone`; `date` for calendar days; `numeric` for handicaps. **No `on delete` clause on FKs.** Every
> MEASURED or DERIVED row carries `source_app` (`APPS` already contains `'forge'`).
>
> **f. No new schema.** Everything lands in `public`, `golf` or `atlas`, all three already in eco's
> `drizzle.config.ts` `schemaFilter`. **If you propose a Forge-private schema, you must edit
> schemaFilter and say so.**
>
> **g. The apply path is split, and `generate emits nothing` does NOT mean the work is done.**
> Tables, columns, indexes and CHECKs come from `npm run db:generate` / `db:migrate`. The **role,
> `enable`+`force` RLS, policies and grants are emitted by none of that.** Put them in a
> **`drizzle-kit generate --custom` migration — that is the only apply vehicle.** It keeps them in
> `drizzle.__drizzle_migrations_eco`, which is what convention 7 requires: T-107 repaired that
> journal today and *nothing is to be hand-applied*. `eco/sql/rls_core.sql` has no npm script and is
> run against the database directly, so it is **not** an apply path — it is the **mirror**, and it
> must be updated in the same change so the file stays a faithful reproduction of the live database.
> **Order: create the table, enable and force RLS, create the policies, and only then grant
> `forge_app`.** A grant that lands while RLS is off is an open table.
>
> **h. 🔴 What node-pg hands the scoring module is not what it accepts — whoever writes
> `server/routes/forge.ts` meets this on the first real row.** node-pg returns a **`date` column as a
> JS `Date`** (parsed as *local* midnight) and a **`numeric` column as a *string***. `@ryp/eco/scoring`
> wants `YYYY-MM-DD` strings and finite numbers, and since the 2026-10-14 rulings it **throws** on a
> malformed date instead of returning `NaN`.
>
> - **Dates.** `daysBetween` (and so `currentFacet` / `currentPicture`) gets `session.date`; a `Date`
>   there throws `RangeError`. ⚠️ **Do not format it with `date.toISOString().slice(0, 10)`** — a
>   local-midnight `Date` serialises to the previous day anywhere east of UTC. Select `played_on::text`
>   in the query, or register a type parser for OID 1082 that returns the raw string.
> - **Numerics.** Coerced for you, by design (ruling 5): `clampIndex`, `currentFacet` values,
>   `practiceHandicap` weights, and `baselineHandicap`'s `yards` all accept a numeric string.
>   ⚠️ **Not coerced:** `drivingIndex`'s `zones` must be integers 0–4 — a string zone (`'2'`) makes the
>   whole index `null` (ruling 11), so coerce `outcome_value` yourself if the column is `numeric`.
> - 🔴 **Numeric strings silently break comparisons.** `isBetter` does `a <= b`, which on two strings is a
>   *lexicographic* comparison — `isBetter('facetIndex', '10.5', '9')` is **`true`** (verified against `dist`;
>   with numbers it is `false`), so the ladder's clear test (*index at or below target*, two `numeric` columns) would
>   record a **false clear** with no error. Convert both sides with `Number()` before calling it. Conditionally the
>   same for `headScoredIndex`: a string `base` makes `base + …` concatenate, and `{total: 8, shots: 20, base: '12',
>   slope: 0.6}` returns **40** against 16.8 for the number `12` (verified) — conditional only because `base`
>   currently comes from client constants, not the database.
> - **A second throw.** `currentFacet` throws `TypeError` for a facet that has a value but no `is_complete`
>   flag. Pass the stored `golf.facet_scores.is_complete`; there is no default, on purpose.
>
> Verified against `dist` on 2026-10-14: `daysBetween('2026-02-31', '2026-10-14')` throws `RangeError`;
> `practiceHandicap({driving: 10, approach: 20}, {driving: '0.3', approach: '0.35'})` = 15.4.
> **Not verified:** a round trip through a real node-pg connection — no database was touched.

| FORGE table | Verdict | Lands at | The one thing not to get wrong |
| --- | --- | --- | --- |
| `players` | **COLLAPSE** | `golf.player_profile` | Grains match exactly — `player_profile`'s PK **is** `user_id`. ⚠️ The prototype calls the **target** `hcp` and the **index** `myHcp` — inverted. Map explicitly, never by name. `rungs` does **not** land here (next row). ⚠️ `handedness` defaults to `'right'`; a Forge-first insert stamps a fabricated handedness on a left-hander. **Drop that default in the same migration.** |
| `players.rungs` | **NEW (split out)** | `golf.facet_rungs` + `golf.facet_rung_events` | Not on the profile row: that row is readable at the **pending**-coach tier, and `golf_profile_self` is `for all`, so a write grant there lets a player set their own level. Keep the Spec's **0..3** index base for both `rung` and `level`-as-played — converting one and not the other puts an off-by-one in the §5.5 qualifying test. Writes are **`forge_svc` only**, with an explicit `TO forge_svc` write policy, **row-pinned to the caller and carrying no bypass branch** (see the carve-out box in §3). 🔴 **ADDED 2026-10-14 — both tables carry `mode`** (checklist D2): chipping rungs track **independently per lie**, and the trail has to be able to say *which lie* moved, so `facet_rung_events` carries it too. The vocabulary is a CHECK, `facet_rungs_mode_per_facet`: `chipping → one of ('fairway','rough','bunker')`, `putting → 'makeables'`, `approach → null`. **Driving has no ladder at all**, so a `driving` rung is refused with `23514` — observed on branch `alpha`, 2026-10-14, when a test fixture tried exactly that and the schema was right. |
| `sessions` | **NEW** | `golf.range_sessions` | **Grain conflict with `golf.practice_sessions`** (one row per player per **day**, unique-indexed). Two tables, related on `(user_id, played_on) ↔ (user_id, session_date)` with **no FK**. **Forge does not write `practice_sessions`** — `session_date` is deliberately withheld from `atlas_app`'s UPDATE grant to stop streak forging, and a second writer re-opens it by another door. The roster's "days since" becomes `greatest(...)` of both. |
| `session_facets` | **NEW** | `golf.facet_scores` | Grain is `(session_id, facet, mode)`. `index_value` → `practice_index`. ⚠️ The launch-monitor import is **stubbed and fabricates values**, so `entry_method = 'monitor'` rows must be refused by CHECK until it is real — do not leave it to every consumer to remember a filter. |
| `shots` | **NEW** | `golf.range_shots` | Store `option_index` alongside `outcome_value`: the value alone is **lossy** — approach L1 scores both "Beyond 20%" and "Mishit" as `1`, and carry mode pairs every long bucket with its short twin, destroying the long/short bias §7 wants. ⚠️ `outcome_value` carries **two incomparable semantics** — a signed stroke delta for scored facets, a left-to-right **position** (2 = fairway, the best) for driving. Never average it across facets. |
| `putt18_holes` | **NEW** | `golf.putt18_holes` | `expected_putts` is **withheld from the INSERT grant** and filled by a BEFORE INSERT trigger, with a `curve_version` beside it. Not a GENERATED column: altering a generation expression recomputes every historical row, which is the exact rewrite the Spec forbids. ⚠️ The trigger **will not be emitted by `drizzle-kit generate`**. |
| `assignments` | **NEW** | `atlas.assignments` (+ append-only `atlas.assignment_completions`) | **The escalation trap lives here** — see §7.2. `source='auto'` is **`forge_svc`-only, not "bypass-only"**, and the request-path INSERT policy must **not** carry an `rls_bypass() OR` branch, or a bug on the Forge pool writes any `source` for any subject. 🔴 **CORRECTED 2026-10-14: there is no `completed_at` on `atlas.assignments`** — one nullable timestamp cannot carry a repeating order, and *"outstanding today"* must compare CALENDAR DAYS in the player's local time, which a UTC instant cannot. Completion is a **row** in `atlas.assignment_completions` (`played_on` is the date column), and INSERT on it is `forge_svc`'s alone, so a player tap gets 42501. |
| `schedules` | **NEW** | `golf.practice_commitment` | ⚠️ `blocks_per_week` drives the streak, the nag and the coach's "behind" flag — all judged over **past** weeks — so a current-only row lets a player clear their own flag retroactively with no trace. Ship the append-only history sibling, or get a written product rule that no past week is ever recomputed. **Do not ship current-only silently.** |
| `coach_notes` | **COLLAPSE** | `atlas.coaching_notes` (`source_app='forge'`) | **Superseded 2026-10-06 (answer 6): append-only for EVERYONE, by privilege.** `atlas_app` is narrowed to `update (deleted_at, updated_at)`, so `body` and `visibility` can never be rewritten by anyone, Forge-authored or not, and the `source_app <> 'forge'` predicate this row used to require is **dropped entirely**. A correction is a **new note** (`POST …/notes/:noteId/correct`); `PATCH` and a coach's `DELETE` answer **409** (`note_append_only`), and retraction is an audited admin action (answer 7). Player-invisibility is still a **withheld `visibility` column grant** on `forge_app`, so every Forge row takes the `'coaching_team'` default and the player branch of the select policy can never match. |
| `coach_players` | **NOT BUILT** | `public.user_relationships` | Verbs invert: `invited_at` → `created_at`, `accepted_at` → `approved_at`, and **"accepted" is the conjunction `status='active' AND approved_at is not null`**, never status alone. ⚠️ **The table is not empty** — 9 rows, 7 of them approved edges. An earlier "0 rows" reading was an RLS-filtered count. Any unique index needs a duplicate check first. |
| *(§7.3)* `outcomes` | **UNMAPPED — OPEN** | — | Mandated by §7.3, defined in §1 nowhere, covered by no mapping. Route it before building it. |

### Where the mappings disagreed with each other — settled here

The per-table mappings were written independently and collided. One answer each:

- **The day row.** Forge does **not** write `golf.practice_sessions`. Atlas derives Forge minutes at
  read time. (An earlier mapping had Forge upserting `source='forge', minutes=30`; Atlas's own
  `practice.ts` `on conflict do update set minutes = …` overwrites it, and two visits in one day
  collapse to 30.)
- **The calendar shows TWO rows per day, not one merged cell** (Makel, 2026-10-06 — overruling the
  recommendation to merge on the grain argument). A Forge range visit (`golf.range_sessions`, one row
  per visit) and a self-logged practice day (`golf.practice_sessions`, one row per day) stay visually
  separate. **No schema change.** The reason is provenance, and it is the reason a later edit would
  be wrong to "tidy" this into one cell: a merged cell cannot show the player which half of their day
  was *measured* (Forge counted the shots) and which half they *typed* (they said so). That
  distinction is the one the whole port exists to keep legible, and the day cell is the most-used
  screen it can be shown on. The join is `(user_id, played_on)` ↔ `(user_id, session_date)`, with no
  foreign key — see `golf.ts:481` for why the two tables stay unlinked. Do not sum the two rows into
  one minutes figure: the Forge row's minutes are derived, the typed row's are claimed.
- **Table names.** `golf.range_sessions`, `golf.facet_scores`, `golf.range_shots`,
  `golf.putt18_holes`. One name each, everywhere. `facet_scores` must declare
  `unique (id, user_id)` for its children's composite FKs; `range_sessions` likewise.
- **Session lifecycle.** The row is inserted at `POST /sessions`. The §6.3 idempotency key guards
  **completion**, not creation.
- **Putt 18's result.** One home, not two. `facet_scores` or §7.3 `outcomes` — decide, and derive the
  other. This is the `outcomes` open item above.
- **Rung index base.** 0..3, per the Spec, for both `rungs` and `session_facets.level`, with CHECKs.

---

## 5 · What is UNCHANGED — do not re-open these

**This decision is about where rows live and who may read them. Nothing else.** The following are
untouched and are not up for discussion as part of porting FORGE to ryp-core:

| Section | Status |
| --- | --- |
| **§2 Scoring engine** | **Untouched, with two named amendments — §2.3's baseline lookup (step table → linear interpolation, see §2 below) and the driving big-miss count (left-only → symmetric, `FORGE-MATH-ADOPTION.md` §2.5a).** Everything else: the handicap scale, the benchmark tables, `baselineHandicap`, the driving corridor, the option sets, the ATG allowance, the expected-putts curve, the composite weights and the renormalisation rule are all exactly as specified. `build/forge-math.js` is unaffected by this decision. ⚠️ **Update 2026-10-14 — "exactly as specified" is no longer true of the ported module** (`@ryp/eco/scoring` is not `forge-math.js`): `baselineHandicap` / `drivingIndex` now take a carry reference and return `null` without one; the Putt 18 constants moved; both carry tables are tagged `UNSOURCED`; and the remaining rulings change further behaviour. They are all listed once, in `FORGE-MATH-ADOPTION.md` §9 — **read it before treating a number that differs from the prototype as a porting mistake.** |
| **§3 Session state machine** | **Untouched.** `created → in_progress → complete, or abandoned`; complete is reached by explicit finish, never by scoring the last shot; players routinely re-score; the resume card and the 12-hour stale prompt; per-drill completeness. |
| **§4 Challenge ladder** | **Untouched.** Clear and miss definitions, three consecutive misses demote, counters per facet reset on any level change, driving is exempt, *"a level change never rewrites history"*, promotion is offered and the player confirms. |
| **§5 Assignments, schedule and ownership** | **Untouched.** Precedence `coach > player > auto`; §5.2 inertness; §5.3 cadences; §5.4 the player sets blocks per week and a coach adds work on top of it; §5.5 level is the ladder's. |
| **§6.3 Connectivity** | **Untouched.** Deferred submit, not a sync queue. |
| **§7 Outcomes and predictors** | **Untouched as doctrine** — but it mandates an `outcomes` table nobody has routed. See §2. |

### The qualifier — rules stand, four storage mechanics change

Saying "§2–§5 are untouched" without this list would be false, and `FORGE-CONTEXT.md:34` currently
makes the unqualified claim. The **rules** stand; these four **storage mechanics** inside them do not:

1. **§2.6's clamp-on-write** (*"Every index is clamped to −6…40 … on write and on read"*) does **not**
   apply to the shared `golf.player_profile.handicap_index`, where it would silently store a
   45-index beginner as 40. The database write bound is Atlas's existing −10…60. −6…40 is a
   display and benchmark-scale clamp. It still applies to `facet_scores.practice_index`.
2. **§2.5's putting mode `course`** is stored as **`putt18`** — which §7.3 already uses as the
   `outcomes.kind` value, so this aligns two halves of the Spec rather than deviating from it.
   `'course'` in a schema beside RYP-RED's on-course data would mean two different things.
3. **§3.1/§3.5's abandoned state** gets a column: `abandoned_at`, beside `completed_at`. So **"live"
   is `completed_at is null AND abandoned_at is null`**, not §1's `completed_at is null` alone. Every
   reader must use the new definition or it will treat abandoned sessions as resumable.
4. **§3.6's snooze mechanic** — *"Snoozing writes `now − 5 days`"* — is superseded. Writing a
   fabricated past timestamp into a provenance column makes "when was this handicap last written"
   a lie, and a coach reads that column as "how stale is this student's number". Store a snooze-until
   (or derive "due" from `handicap_updated_at` + cadence) and keep the provenance honest. **The 7-day
   re-ask, the confirm-re-bases-the-target behaviour and the cadence itself all stand.**

---

## 6 · The rules that survive the port verbatim

These are quoted, not paraphrased, because every one of them is a rule an engineer re-deriving the
system will break by accident. They are unaffected by anything in this document.

> **1.** *"The composite index is derived, never stored. Persist facet indices only; recompute the
> composite on read. **Two copies will drift.**"* — §1 READ THIS FIRST
>
> No composite column exists on any table in §4. Not on `facet_scores`, not on `player_profile`.

> **2.** *"An incomplete drill never becomes a headline number. Completeness is defined **per drill**
> (§3.4) — 20 shots for the shot-count drills, 18 holes played for Putt 18. **Never hard-code 20.**
> Incomplete results are stored, flagged provisional, and excluded from the current picture."*
>
> This is why `is_complete` is a stored flag and **not** a GENERATED column or a CHECK: both would
> bake `20` into a migration. It is also why `putt18_holes` is tested on `holes_played`, never on a
> shot count — *"a Putt 18 abandoned after six holes can already exceed 20 logged putts; testing
> `shot_count` there would publish a bogus Putting Index and satisfy an assignment."* ⚠️ Note where
> that test lives: `holes_played` and `is_complete` are columns on the **facet row**
> (`golf.facet_scores`), **not** on `golf.putt18_holes` — so completeness is never a `count(*)` of
> hole rows, which matters because the "enter as a total" path writes a complete round with **zero**
> of them (§8 Q22). And it is why
> `shot_index` carries `CHECK (shot_index >= 0)` with **no upper bound**: a `<= 19` CHECK is the
> hard-coded 20 re-expressed as a constraint.

> **3.** *"Lower is better, everywhere. Indices are handicap-scaled. Negative values print with a
> leading `+` (golf convention) — `-2.4` displays as `+2.4`."*
>
> ⚠️ One column breaks the direction and must be converted **before storage**: the Stroke Test is
> `better: 'up'` in raw units ("of 20 made"). Map it onto the scale first, or one column carries two
> directions.

> **4.** *"**There is no `level` field** — level is owned by the ladder, never by the assignment."*
> — §1, `assignments`. And §5.5: *"**A coach assigns the drill, never the level.** … an assignment created today may be
> satisfied at a different level tomorrow if the player promotes in between — that is correct and must
> not invalidate the assignment. A coach who wants a player working at an easier standard does not
> lower the assignment; the ladder does that on its own after three misses. **No API accepts a
> coach-supplied level.**"* — §5.5
>
> **There is no `level` column on `atlas.assignments`.** The absence is the enforcement: no column,
> so no grant and no policy can be got wrong. ⚠️ `FORGE.dc.html:4623` pushes a `rung` onto the
> player's queue and contradicts this; the Coach Console carries one in its draft and correctly
> **drops it at commit**. Whoever ports the coach panel must be told, because a `rung` field on an
> assignment is the thing §5.5 exists to prevent.

> **5.** *"…and writes only `assignments` and `coach_notes` — **never a player's sessions or
> shots**."* — §6.2
>
> The only clause of §6.2 that survives, and it is now enforced **by GRANT rather than by policy**:
> `atlas_app` — the coach surface — holds **SELECT and nothing else** on `golf.range_sessions`,
> `golf.facet_scores`, `golf.range_shots`, `golf.putt18_holes`, `golf.facet_rungs` and
> `golf.practice_commitment`. A coach write is refused by privilege before RLS is consulted. ⚠️ Note
> the limit of this: `atlas_app` is **one role serving both players and coaches**, so for the tables
> where it legitimately writes (`practice_sessions`, `player_profile`), the coach is held out by
> **policy**, not grant. Do not state it more strongly than that.

---

## 7 · What this decision creates work for

Three things exist because of this decision and do not exist today. None is optional.

⚠️ **CORRECTED 2026-10-14.** "Do not exist today" is now true only of `main`. The two roles, the ten
tables and the whole policy layer were created on the Neon branch `alpha`
(`br-spring-dawn-auoaqi5p`) on 2026-10-14 — migration `0010_equal_warbird.sql`, then
`eco/sql/rls_forge.sql` in one transaction: 120 policies, 7 restrictive, RLS enabled **and forced**
on all 18 `golf`/`atlas` tables, 430 column grants. §10 was then run **as real logins** to **46
cases, 46 pass** (of roughly eighty). Evidence:
`decisions/FORGE-FALSIFICATION-RUN-2026-10-14.md`. 🔴 **`main` is untouched**, and "applied once,
to a branch" is not "verified": `verify:schema` has still never been run against a database, both
triggers are untested, and the remaining §10 sections are predictions.

### 7.1 The `forge_app` role — and a second one, `forge_svc`

🔴 **`forge_app` does not exist on `main`.** Live `pg_roles` there holds `atlas_app`, `red_app`,
`lr_app`, `billing_svc` — all `LOGIN NOBYPASSRLS`. Yet `golf.drill_progress` already carries comments
calling `ticked_at`/`watched_at` *"forge_app's columns"*. The role was designed and never created.
⚠️ **CORRECTED 2026-10-14:** this said simply "`forge_app` does not exist". Both `forge_app` and
`forge_svc` now exist **on the `alpha` branch** — the run record says the roles were created, not
which block created them — verified
`rolbypassrls = false`, `NOINHERIT`, not superuser. Passwords were generated into a `0600` file and
never passed through tool output — that is how the T-111 Firebase key leaked.

```sql
create role forge_app login nobypassrls;   -- the request path: players AND, if Luke's console ships, coaches
create role forge_svc login nobypassrls;   -- ONE server process. The ladder, completion, `auto`.
grant usage on schema public, app_private, golf, atlas to forge_app, forge_svc;
```

**Why two roles and not one plus a bypass flag.** `app_private.rls_bypass()` reads
`current_setting('app.rls_bypass')`. It is a session variable, not a role attribute: any code on the
`forge_app` pool can set it, and `withRlsBypass` takes whatever pool it is handed. So "bypass-only"
on the same role as the player-facing API means the only thing separating *the ladder evaluator* from
*the player* is a variable the player's own request path can flip. The repo already states the
correct pattern, for `billing_svc`: its credential *"must be held by ONE process … the entire point of
it is that a compromised request path cannot grant entitlements."*

So: **`forge_svc` holds the writes that decide something** — `facet_rungs`, `facet_rung_events`,
`assignment_completions`, and `source='auto'` inserts. `forge_app`
holds **SELECT** on all of them.

*"The ladder is the only thing that sets level"* then becomes a privilege refusal (42501), not a
convention.

🔴 **CORRECTED 2026-10-14:** that list used to include `assignments.completed_at`. **There is no
such column.** Completion is a row in the append-only child `atlas.assignment_completions`, for the
reason given in §4's table map.

⚠️ **State the limit of this honestly, because `/complete` is a request handler.** `billing_svc`'s
credential is held by a webhook process with no player-facing surface. `forge_svc`'s, if
`/complete` runs inline, sits in the same process that serves every other Forge request. So the
split protects against **SQL from every other endpoint** — a bug in `PATCH /sessions/:id` cannot
reach a rung — but it does **not** protect against a bug in `/complete` itself, which is exactly
where the §5.3 qualifying test lives. Two honest options, and the choice is Makel's and Luke's
(§8 Q11):
1. **Enqueue completion**, and let a separate worker process hold `forge_svc` alone. This is the
   only arrangement in which the `billing_svc` sentence is true as written.
2. **Run it inline and say so** — then `forge_svc` is a blast-radius reduction, not a trust
   boundary, and the `/complete` handler is security-critical code that gets reviewed as such.
Do not claim (1)'s guarantee while shipping (2).

Also required, and easy to miss:

- `grant execute` on the coach oracles — the existing lists name roles explicitly
  (`to atlas_app, red_app, lr_app, billing_svc`), and `grant execute on all functions` binds only
  functions that existed when it ran.
- `~/Desktop/ATR/setup-db-roles.sh` generates **four** passwords and asserts *"Expect 4 rows"*. It
  needs a fifth and a sixth, and it does not create roles — it `ALTER ROLE … WITH LOGIN PASSWORD` on
  roles that must already exist.
- **Verify after creating:** `select rolbypassrls from pg_roles where rolname='forge_app'` must be
  `false`. The live RYP-RED database is the cautionary tale — its roles are all BYPASSRLS, so **no
  policy on it binds at all**.

⚠️ **Every falsification in the per-table mappings is unexecuted.** The role does not exist and
neither do the tables, so nothing has been run as `forge_app`. Treat all of it as design.

### 7.2 The consent gate on FORGE's write path

**Every player write in this ecosystem sits behind a consent gate, and FORGE does not inherit it
today.**

`requireConsent` lives in `atlas/server/requireConsent.ts` and `consentStateFor` in `atlas/shared/` —
**not in `@ryp/eco`**. A Forge server importing eco gets `attachUser`, `withRls` and the schema, and
**none of the gate**. Its own words on why it is server-side:

> *"A client-only gate hides the app from someone who does not know how to skip it. The account still
> exists, the token still works, and every route still accepts data."*

Three states: `ok`, `dob_required`, `consent_required`. It fails **closed** — an unknown state is
`dob_required`, which locks everybody out loudly rather than opening the gate quietly. Ordering is
`requireApp(…)` **then** `requireConsent`: entitlement first, then consent.

**The work:**

1. **Move `requireConsent` and `consentStateFor` into `eco/src/auth/`** so every app gets the same
   gate from the same source. Today a second app re-implementing it is a second chance to get it
   wrong, and FORGE collects a minor's practice data and feeds it to a coach.
2. **`requireApp('forge')` refuses everyone today.** Nothing writes `('forge', …)` rows to
   `public.user_app_roles`, and the live signup policy admits only `app='atlas'`. Decide who writes
   the Forge entitlement row and under what gate — which is the pricing question in §8.
3. **Decide whether FORGE runs inside eco's `attachUser`/`withRls` at all** — see §8. If Luke's server
   gets a raw connection string instead, it sets `app.current_user_id` itself, and every policy in
   this document is only as strong as that code. That is a trust decision, not a schema one.

### 7.3 The FORGE Coach Console belongs inside Atlas's coach dashboard

§6.2 says *"Coaches use a separate web app; the two clients share the API and nothing else."*
**Superseded.** Makel decided on 2026-08-24 that Atlas envelops the main coach dashboard, giving the
coach all Atlas metrics for all of their students. So:

- `GET /coach/roster` and `GET /coach/players/:id` are **Atlas routes**, running as `atlas_app`.
- A coach's writes — assignments and notes — land in `atlas.*` through `atlas_app`, where they
  already belong.
- `atlas_app` holds **SELECT only** on every Forge data table, which is how §6.2's surviving rule is
  enforced as a privilege.

**If Luke's standalone Coach Console ships anyway**, it does **not** get `forge_app`. It gets its own
`forge_coach_app`: `LOGIN NOBYPASSRLS`, SELECT only on the player data tables. The reason is specific:
`forge_app` serves players *and*, in that design, coaches — one role for two principals — so a coach
on `forge_app` is held out of a student's rows by the `WITH CHECK` **alone**, which is one layer
instead of two. No role ever holds both a coach identity and a write privilege on a player's data.

### 7.4 One pre-existing hole this work must close

Found while mapping, not introduced by it, and it defeats the escalation trap in §5 if left open:

**A player can make themselves their own coach.** `user_relationships_request` pins
`actor_user_id = current_user_id()` and `status='pending'` but says **nothing about
`subject_user_id`**; `user_relationships_subject_decides` lets the subject set `status='active'`. One
person can be both. `app_private.coaches(self)` then returns true, and a player can write
`source='coach'` assignments about themselves — **outranking their real coach**, which is precisely
what the `source` precedence rule exists to prevent. It equally lets them write
`atlas.coaching_notes` about themselves and sign off their own `drill_progress`.

```sql
alter table public.user_relationships
  add constraint user_relationships_no_self_edge check (actor_user_id <> subject_user_id);
```

Also add the `created_by_user_id <> subject_user_id` term to the assignments **UPDATE** branch, not
only INSERT, so the policy does not depend on a column grant to be correct.

⚠️ The table has **9 live rows, 7 of them approved edges** — not zero. Check for existing self-edges
before adding the constraint. (A scan under bypass found none, but re-check at apply time.)

---

## 8 · Still open — questions a human must answer

Ordered by blast radius. Each says what is blocked and, as importantly, what is **not**.

⚠️ **MARKED UP 2026-10-14.** Twelve more rows were ANSWERED and this table still presented them as
open — Q4, Q5, Q6, Q7, Q8, Q9, Q11, Q12, Q17, Q21, Q22 and Q23. Each now opens with its answer and
its source (`decisions/FORGE-PORT-ANSWERS-2026-10-06.md` by answer number, or
`decisions/FORGE-PORT-FIX-CHECKLIST.md` §C by item), **with the original question kept below it as
history** rather than deleted, so the reasoning survives and the question does not come back. Rows
left open, and the half-open parts of rows marked ANSWERED, are named here so the count is not
taken on trust: **Q2** (`CAL.putt18.base` still provisional, and the gate for it is built nowhere),
**Q13**'s successor questions (UI copy for the two carry scales, and the content of `CAL.carry.f`),
**Q18** (`outcomes` unrouted) and **Q24** (the server-allocated seed versus §6.3's "never blocked"
offline flow — the one place where two sections this document calls settled actually disagree).

| # | Question | Who | Blocks | Does NOT block |
| --- | --- | --- | --- | --- |
| 1 | **ANSWERED 2026-10-06 — interpolation; Build Spec §2.3 amended (see §2 below). Asked as:** **`baselineHandicap` has three answers for 225 yd: 15 (Spec step table) / 12.5 (`forge-math.js` interpolation) / 7.5 (the test fixture).** The Spec's precedence rule makes the shipped module non-conformant — but the module is probably right: *"A step table would put 234 and 236 yards a full stroke apart"*, and under the step model 234 → 15 and 236 → 10. Five strokes for two yards. | **Luke** | Every driving `practice_index` ever written. It must be settled **before the first row**, not patched after. | The schema. Column shapes are identical either way. |
| 2 | **PARTLY ANSWERED (Luke's Q1, checked in `decisions/ASK-LUKE-forge-port.md`, committed 2026-10-13) — `k` is no longer open; `base` still is.** Asked as: *`CAL.putt18.base` and `k` are PROVISIONAL* (`base: 8, k: 1.2`), and §7.2 is emphatic: *"Do not ship a guessed constant."* **Now:** `CAL.putt18 = { base: 10, k: 9.09 }`. `k` is **ESTIMATED** — `20 / (20 × CAL.sgRate.putting)` — and the shipped `1.2` was a bug, 7.58× too small. `base` is **PROVISIONAL**: 10 is the mid-scale value, kept until Luke supplies one reference round (a scratch player's Putt 18, a 20-handicap's) to pin the intercept. 🔴 **Not gated:** nothing in the module withholds a Putt 18 index while `base` is provisional — `putt18Handicap` returns a number for any strokes-gained it is given, and `PROVENANCE.putt18Index = 'provisional'` is a *label* for a screen, nothing more (the module header says **NOT BUILT**). Any gate is the caller's, so decide who writes it. | **Luke + Makel** | **Per Luke's Q1 decision, `base` stays behind the existing gate: a `(putting, putt18)` `practice_index` is not published until one reference round pins `base`.** ⚠️ No such gate is built in the module (§9.5 of `FORGE-MATH-ADOPTION.md`); whether the schema or a route enforces it was **not checked here**. A provisional constant stamped with a `scoring_version` is recoverable; a published number is not. | The `putt18_holes` table, which stores `putts` and `expected_putts` and not the index. |
| 3 | **ANSWERED 2026-10-06 — `CAL.benchmarks` ships, its tag is `UNSOURCED` (`FORGE-MATH-ADOPTION.md` §4.1) — and since 2026-10-14 it is, in `eco/src/scoring/index.ts`, together with `CAL.carry`, which feeds scoring (`FORGE-MATH-ADOPTION.md` §4.2). The vendored `forge-math.js:56` still says `MEASURED`, by design: `proto/forge/` is not edited. Asked as:** **Which benchmark table is real** — `CAL.benchmarks` (tagged MEASURED) or the Arccos-cited `BENCH`? 13 yards and ~5 fairway points apart at handicap 12.5, and the app's own comment contradicts the MEASURED tag. | **Luke** | Same blast radius as #1. | The schema. |
| 4 | **ANSWERED 2026-10-06 (answer 24) — **Makeables promotes, Putt 18 measures.** The ladder promotes on the Makeables drill, which has the four levels; the Putting Index still comes from Putt 18. `golf.facet_rungs` enforces it: `facet_rungs_mode_per_facet` admits only `putting → 'makeables'`, so a Putt 18 rung cannot be written at all. `level` is NULL on the Putt 18 facet row. Asked as:** **After §7.2, which putting drill does the ladder promote on?** §4 promotes on *"a session's facet index at or below the target"*; §7.2 made the Putting Index **Putt 18**, which the Spec gives no levels; §2.4 gives the four putting levels to **Makeables**, *"a putting predictor… The Putting Index comes from Putt 18."* So the only putting drill with levels never enters the Index, and §4's rule has no value to judge. **Unresolvable from the text.** | **Luke** | The ladder's putting branch, and whether `level` is NULL on the Putt 18 row. | Everything else. The column is nullable either way. |
| 5 | **ANSWERED 2026-10-09 (checklist C5 — decided without Luke, who supplied no answers) — **his spec wins: the ladder is the only thing that sets level.** The prototype's free rung tap (`FORGE.dc.html:3490`/`:4821`) is a debug affordance and does not survive. A rung is writable only by `forge_svc`, through `facet_rungs_service_write`; `forge_app`, `atlas_app` and `lr_app` hold SELECT and no write grant, so a player writing their own rung is **42501** — confirmed on branch `alpha`, 2026-10-14. A confirm endpoint is a product choice that does not change this. Asked as:** **Does the player confirm a promotion the server computed, or pick a rung freely?** The prototype lets a tap set any rung with no ladder event; §4 says *"the ladder is the only thing that sets level"* **and** that promotion is *"offered, not automatic — the player confirms."* Reconcilable or not. | **Luke** | Whether `facet_rungs` is `forge_svc`-write with a confirm endpoint, or player-writable — and therefore whether a player can trivially satisfy a coach's assignment at an easier level. | The rest of the profile mapping. |
| 6 | **ANSWERED 2026-10-06 (answer 9) — **they COUNT.** Both readings were only ever a filter, so no column and no migration moved. Asked as:** **Do provisional sessions count toward the streak and blocks-per-week?** The Spec flags this itself as an open decision. | **Luke / Makel** | What the coach dashboard's "behind" flag *means*. | The tables. Both readings are a filter, not a column. |
| 7 | **ANSWERED 2026-10-09 (checklist C2) — **build both, named separately; do not pick.** They are two different facts that disagree regularly (someone can practise five times a week and ignore every prescription). Both are derived on read: the coach sees `behind_cadence` and `behind_assigned`, and whichever Luke meant is already there. **No columns, no migration.** ⚠️ Still true and still unbuilt: neither the streak nor the nag has a formula anywhere in either prototype. Asked as:** **Which "behind" is the coach's flag?** §5.4 says `blocks_per_week` drives it — a **cadence** miss. Both prototypes compute something else and never read `blocks` — an **assignment-completion** miss. Different facts about different failures. ⚠️ **The streak and the nag have no formula anywhere in either prototype.** | **Luke, then Makel** | The roster's flag, and whether it is one column or two (`behind_on_cadence` / `behind_on_work`). | `practice_commitment`, which stores only the denominator. |
| 8 | **ANSWERED 2026-10-09 (checklist C3; answer 4 had referred it to Luke, who did not reply) — **history sibling built, default NEXT week.** Current-week-only storage is gameable exactly as described, so `golf.practice_commitment_history` exists and is declared in `forge.ts`. Asked as:** **Does a mid-week change to `blocks_per_week` apply to this week or the next?** Current-only storage is gameable: at 1 of 5 blocks on Sunday, set it to 1 and the flag clears retroactively with nothing in the database that could show it happened. | **Luke** | **The migration, not just the behaviour** — the answer decides whether a `practice_commitment_history` sibling is required. | Nothing else. |
| 9 | **ANSWERED 2026-10-09 (checklist C4) — **MOOT: there is no Coach Console.** Atlas has been the only coach surface since 2026-08-24, so `forge_coach_app` is not created. ⚠️ The rule this leaves unenforced: no coach screen touching player practice data may authenticate as `forge_app`. Through `forge_app` a coach write is refused by POLICY (silent zero rows), not by GRANT (42501). That rule lives in `rls_forge.sql` §4.1 and in nobody's code. Asked as:** **Is FORGE's Coach Console a real second client?** If it ships on `forge_app` it inherits that role's write grants and drops from two layers of defence to one. | **Makel + Luke** | Whether `forge_coach_app` is created (§7.3). | The policies, which hold either way. |
| 10 | **ANSWERED 2026-10-06 (answer 8) — inside eco. FORGE's API runs in Atlas's Express server as `server/routes/forge.ts`, behind `attachUser` and `requireConsent`, alongside the nine existing routers. Luke's client calls that API and **never holds a database credential**, so the trust model is Atlas's, not a connection string handed out. ⚠️ The cost of that answer is Q11's: `forge_svc` then sits in the same deploy as a request path, so `billing_svc`'s isolation rule does not transfer — see §7.1's "state the limit honestly" paragraph. Asked as:** **Does Forge's server run inside eco's `attachUser`/`withRls`, or does Luke's team get a connection string?** If the latter, that server sets `app.current_user_id` to any uuid it likes and every policy here is only as strong as its code. | **Makel + Yannick + Luke** | The entire trust model. This is the largest open item on the page. | Schema design, which is identical either way. |
| 11 | **ANSWERED 2026-10-06 (answer 8) — **Atlas holds it.** ⚠️ And the limit is recorded rather than hidden: `forge_svc` sits in the same deploy as a request path, so **do not copy `billing_svc`'s "ONE process / a compromised request path cannot" rule onto it**. The row scope (`user_id = app_private.current_user_id()`) stops a **bug**, not an attacker holding the credential. `rls_forge.sql` §1 struck its stronger claim for this reason. Asked as:** **Who holds `forge_svc`'s credential, given FORGE is Luke's app?** It is the only principal that may stamp a completion, write a rung or insert an `auto` assignment. | **Makel + Luke** | Creating `forge_svc` meaningfully. | `forge_app`, which can be created now. |
| 12 | **ANSWERED 2026-10-06 (answer 5) — **a separate, admin-granted `forge` row in `user_app_roles`.** Not bundled, not automatic. Pricing is Makel's and does not block the schema; the task row is T-127. Until something writes that row, `requireApp('forge')` correctly refuses everyone. Asked as:** **Is FORGE plan-gated?** `'forge'` is in `APPS` already, but nothing says what it costs or what gates it: a `user_app_roles` row with `app='forge'`, an `app_private.plan_at_least()` check, or neither. Nothing writes that row today, so `requireApp('forge')` refuses everyone. | **Makel** | The entitlement half of §7.2. | The data tables. |
| 13 | **ANSWERED 2026-10-06 (answer 22) — there is no `gender` column; ask for the carry reference directly.** The column is `golf.player_profile.carry_reference` (`'pga_scratch'` \| `'lpga_d3'`, nullable, no default), frozen at play as `golf.facet_scores.carry_reference_at_play`; a null reference means **no driving index is computed**, and the scoring module now enforces that itself (`baselineHandicap` returns `null`). The "neither" question dissolves (a player picks a scale, not an identity), the Firestore-vocabulary question dissolves (**no backfill from Firestore `gender`**), and the pending-coach exposure question is governed by answer 14 (a *pending* coach sees no profile at all) — **not checked here against the policy SQL**. ⚠️ Still true: asking a golfer to self-classify against a table they have never seen means the UI copy must name the scale *and* show its range. **Asked as — and the text below is the superseded question, kept as history:** **`gender`.** Binary because §2.6's named-level tables exist only for men and women, and it selects both the carry table and the slider floor. What does a player who is neither see? Is it asked in Forge at all, given `rypstick-ios` Firestore already holds it? ⚠️ The Firestore **vocabulary is unverified** — a backfill could write `'Male'`, `'m'`, `'other'` or blanks into the column that picks the benchmark table. | **Luke / Makel** | *(Was: a third value needs a third named-level table, and whether `gender` may sit on a row a self-requested pending coach can read — both moot, there is no such column.)* **New and open instead:** the UI copy for the two scales, and the content of `CAL.carry.f` (see `FORGE-MATH-ADOPTION.md` §4.2). | The rest of the profile collapse. |
| 14 | **ANSWERED 2026-10-06 (answer 20) — Atlas owns the display name; Forge reads and never writes it.** **Asked as:** **Does Forge own the display name?** Its onboarding captures one, but §6.1's `PUT /me/profile` lists only *"handicap, carry, target, gender"* (the Spec's wording; `gender` is superseded by `carry_reference`, see Q13). Writing it makes a second app a writer of an identity column, against `identity.ts`'s *"Atlas is the runtime writer; every other app reads it."* SELECT only, pending an answer. | **Luke / Makel** | One grant line. | Everything. |
| 15 | **ANSWERED 2026-10-06 — no: append-only for both apps by privilege; the `source_app <> 'forge'` predicate is dropped; a correction is a new note; an admin may retract through an audited path, a coach may not (409, not 404).** The predicate this question asked about is gone. **Asked as:** **Should Atlas-authored coaching notes stay editable at all?** If no, the whole table becomes append-only by **privilege** for both apps — stronger and simpler — at the cost of Atlas's note-editing route. ⚠️ Atlas also has a **soft-delete** route; under the `source_app <> 'forge'` predicate a coach could never retract their own Forge note. | **Makel** | Whether the policy predicate is needed at all. | The collapse itself. |
| 16 | **ANSWERED 2026-10-06 (answer 12) — YES, and it is the point: ONE NOTE RECORD PER PLAYER.** A Forge coach sees Atlas-authored notes and vice versa. **No note becomes visible to anyone who could not already read that student** — both sets are coach-only and both sit behind `app_private.coaches()`; the change is between coaches of the same student, never between a coach and a stranger. The failure it prevents is a colleague's safeguarding note being invisible because it was typed in the other app. Forge notes stay player-invisible by the withheld `visibility` grant (answer 19: a v1 default, expected to relax — one grant line plus a UI control, not a migration). **Asked as:** **Does a Forge coach seeing Atlas notes, and vice versa, need saying out loud?** That is the unified-profile intent, and it is a visible product change to both apps that nobody has agreed to. | **Makel / Luke** | Nothing technically. Confirm before build. | — |
| 17 | **ANSWERED 2026-10-06 (answer 3) — **coaches see every shot.** `atlas_app` holds SELECT on `golf.range_shots` and `golf.putt18_holes`. It was a privacy call, not a schema one, and the tables are unchanged either way. Asked as:** **Is shot-grain data visible to a coach in v1?** `atlas_app` SELECT exposes every individual ball a student hit; the Coach Console shows only facet-level numbers. | **Makel** | A privacy call, not a schema one. | The table. |
| 18 | **`outcomes` (§7.3) is unrouted.** See §2. | **Luke** | §7.4's correlation work. | Everything built in §4. |
| 19 | **ANSWERED 2026-10-06 — the table is `atlas.assignments`; `golf.range_sessions` stands.** The player-facing copy stays "PRESCRIBED BY YOUR COACH" and the coach UI stays "ASSIGN WORK": a table name is not UI copy. The three eco files that reserved the old name are repointed in the same change. **Asked as:** **Table naming:** `golf.range_sessions`? And one word for `assignments` vs the earlier reserved name — the Forge player screen says "PRESCRIBED BY YOUR COACH", the coach UI says "ASSIGN WORK", the Spec says `assignments`. | **Makel** | Nothing — but settle it **before the migration is generated**. Under the 2030 model plan a deferred rename is a migration. | — |
| 20 | **ANSWERED 2026-10-06 — symmetric (`FORGE-MATH-ADOPTION.md` §2.5a). Asked as:** **Driving asymmetry.** The Spec defers this itself: *"Asymmetry — prototype bug, decide before building. The formula above reproduces the prototype exactly: only column 0 (bad left) counts as a bad miss… the intended behaviour is symmetric."* | **Luke / Makel** | **Every historic driving index becomes non-comparable the day it changes** — same blast radius as Q1, and the Spec says decide *before* building. | Storage. `outcome_value` is 0–4 either way. |
| 21 | **ANSWERED 2026-10-06 (answer 2, an **OVERRULE** of the recommendation — do not reopen it) — **`source='auto'` SHIPS.** Security is unchanged: `auto` is reachable only through `assignments_insert_auto`, which is `TO forge_svc`. 🔴 The one obligation with **no enforcement behind it**: an auto row's `note` must be templated generically. Carrying Forge's `primaryLeak` label into `atlas.*` is what METRIC-MAP forbids, and no CHECK and no policy can tell a generic template from a leak label — `note` is free text shown verbatim to the player. It is the `forge_svc` proposer's job. Asked as:** **Does `source='auto'` ship in v1?** §5.1 requires it, but `auto` is derived from Forge's `primaryLeak`, and METRIC-MAP forbids promoting that into the shared layer — *"Forge's `primaryLeak` stays private precisely so two competing priority labels are never shown to the same player."* The Spec requires the thing the map forbids exposing. | **Makel** | Whether `forge_svc` needs an INSERT path on `atlas.assignments` at all, and whether a second priority label reaches the player. | The `source` column and its escalation close, which are needed for `coach`/`player` regardless. |
| 22 | **ANSWERED 2026-10-06 (answer 15) — **it survives, flagged `entry_method = 'tally'`.** So every consumer must handle an 18-hole round with **zero** `putt18_holes` rows, and §7.4's per-hole correlation work is starved of input whenever a player uses it. Completeness lives on the facet row, never on a `count(*)` over the holes. Asked as:** **Does Putt 18's "enter as a total" mode survive?** It writes a **complete** Putt 18 with **zero** `putt18_holes` rows — `complete: true`, `holesPlayed.putting = 18`, `holes: null`. The Spec never mentions it. Keeping it means every consumer must forever handle an 18-hole round with no holes, and §7.4's per-hole correlation work is starved of its only input whenever a player uses it. | **Luke / Makel** | Nothing structurally — completeness already lives on the facet row, not on a `count(*)` here. But it decides whether §7.4 has data. | The `putt18_holes` table. |
| 23 | **ANSWERED 2026-10-06 (answer 23) — **permanent, and it stays UNSTORED.** No `block_minutes` column. The risk is accepted and written down rather than mitigated: if a tier or an academy ever practises in 45- or 60-minute blocks, every historical `blocks_per_week` silently re-means and no migration can recover the original intent. Asked as:** **Is the 30-minute block permanent product policy, or a v1 simplification?** The Spec is emphatic twice — *"always 30 minutes and is not stored"*, *"the product's fixed unit and is not configurable"* — and this document builds to it. But `blocks_per_week` is a count whose unit is **implicit**: if a tier, an academy or a junior programme ever practises in 45- or 60-minute blocks, every historical row silently re-means and no migration can recover the original intent. | **Makel / Luke** | Nothing today. | Nothing — but a `block_minutes integer not null default 30` is **cheap now and un-backfillable later**. Answer it before the first row. |
| 24 | 🔴 **Server-allocated seed vs §6.3's "never blocked" — a conflict this document creates.** §4 puts the row insert at `POST /sessions` so the seed is the one the holes were played with. §6.3, listed as untouched, says *"Local write-through on every tap… the player is never blocked from continuing."* **A range with no signal means no `POST /sessions`, and therefore no seed and no session.** Either the client may generate a session id and seed offline and the server adopts them on submit (which gives up "allocates the seed server-side" as a privilege control), or a session genuinely cannot start offline. | **Luke + Makel** | The seed's provenance control, and `POST /sessions` vs the §6.3 flow. This is the one place where two sections this document calls settled actually disagree. | The columns. `seed` and `idempotency_key` exist either way; only the grant on `seed` changes. |

---

## 9 · Relationship to `FORGE-CONTEXT.md`

`FORGE-CONTEXT.md` is the first-hand record of what the package actually specifies. It is still the
map of what had to be reconciled. **It has already been reconciled with this decision** — its banner
carries the 2026-10-06 answer and links here, and its headline section has been retitled *"as
received"*. The premise that it *"states the opposite"* is stale. This document corrects it in three
places only:

1. **Its line 34** — *"the scoring engine (§2), the session state machine (§3), the challenge ladder
   (§4) and the ownership rules (§5) are untouched"* — is right about the **rules** and needs the
   qualifier in **§5 of this document**: four storage mechanics inside those sections do change.
2. **Its open question 3** (*"Whose handicap wins?"*) is **answered**: one column, `handicap_index`,
   plus a new `handicap_source`, with every writer appending `golf.handicap_history` in the same
   transaction. Forge's weekly self-report and Atlas's intake answer are the same number at two
   cadences, not two numbers.
3. **Its open question 4** (*"Do Forge's six drills and Atlas's plan drills ever meet?"*) is
   **answered: no.** Two catalogues, two tables, one deliberate absence of a join. Forge's drill
   identity is `(facet, mode, level)` on the facet row; `golf.drill_progress.drill_id` holds Atlas's
   catalogue. Never write one into the other.

Everything else in that document stands, including the unfitted-constants table, the three-way
`baselineHandicap` conflict and the stubs list — all of which feed §8 above.

⚠️ One stale comment to ignore while you work: `eco/src/db/pool.ts` still warns that *"every Postgres
role currently has BYPASSRLS, so these session vars do not actually constrain anything in
production."* That was true of the old database. On `ryp-core` all four app roles are
`NOBYPASSRLS` and the policies bind.

---

## 10 · How this document was built

Written against: the Build Spec as extracted plain text (`.spec-extracted.txt`), both `.dc.html`
prototypes, `eco/src/schema/{golf,atlas,identity,enums}.ts`, `eco/sql/rls_core.sql`,
`eco/src/db/pool.ts`, `eco/src/auth/attachUser.ts`, `atlas/server/requireConsent.ts`, and nine
per-table routing mappings each refuted twice by independent adversarial agents that never saw the
mapper's reasoning. **Every one of those eighteen refutations returned `refuted=true`**, and the
cross-cutting rules in §4 are what survived them — they are not the mappings as first written.

**What is NOT verified, and must not be read as if it were:**

- **No falsification has been executed.** `forge_app` does not exist and neither do the new tables,
  so every policy, grant and test in this document is **unexecuted design**. Run them, asserting
  `GET DIAGNOSTICS ROW_COUNT` and never "did it throw", before anything here is called working.
- The live-database facts quoted (role list, policy text, column ACLs, the 9 `user_relationships`
  rows, `forge_app`'s absence) were queried read-only on 2026-10-06 by the mapping and refutation
  agents. Re-check before applying; a migration is not the place to discover one has moved.
- `FORGE.dc.html` is 5,100 lines and has had fewer passes than the Spec. Treat line-level claims
  about the player prototype as the least settled material on this page.
