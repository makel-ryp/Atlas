# RYP Ecosystem — the one architecture doc

**Updated 2026-08-18.** Supersedes the docs in [§9](#9-superseded-docs). If something here disagrees with another doc, this one wins. If it disagrees with **the code or the database**, the code wins — this doc is then wrong, so fix it.

> **Why this exists.** There were 193 markdown files, each describing one app in a vacuum, and several asserted things that were provably false — the old ecosystem guide named the identity anchor `public.players`, a table that has never existed. A package was then written *from* those docs, and nearly all of its schema was wrong. Prose can't be trusted to stay true. So: this doc is short, it points at code, and the code is checked by a test.

**The plan in one line:** stand up a **clean database**, build the target structure into it from the repos, re-point the apps, and leave the old one behind. No data migration — every current user is a friendly or internal tester.

## 1. Source of truth

| Question | Where the answer actually lives |
| --- | --- |
| What is the identity schema? | `@ryp/eco` → `src/schema/identity.ts` |
| Is the code still correct? | `cd eco && npm run verify:schema` — fails on drift |
| How is RLS configured? | `@ryp/eco` → `sql/rls_public.sql` |
| What does app X do? | that app's own `CLAUDE.md` — app-local, not superseded |
| What work is queued? | `RED-UPDATE-PLAN.md`, `YANNICK-UPDATE-PLAN.md` |

**No architectural claim is authoritative unless it's expressed in `@ryp/eco` or verifiable by query.** `verify:schema` is the enforcement — run it in CI.

## 2. The shape

One Postgres database in a new Neon project: **`ryp-core`** (decided 2026-08-18). The shared plane currently lives inside a project named `ryp-red`, which is backwards — identity isn't Red's, and that misnaming is part of what made this confusing. One Firebase project: **`rypstick-ios`** — credentials only; it also carries legacy RYPstick iOS users. Per-app servers on Railway. Cloudflare R2 for objects.

**Atlas is the nucleus** — the front door and system of record.

⚠️ **Nucleus means data gravity, not a runtime chokepoint.** Apps verify Firebase tokens independently and read the shared database directly. **No app calls Atlas at request time.** An Atlas outage must never take down Red, Locker Room or Debrief.

### Shared core — every app reads

| Schema | Holds | Writer |
| --- | --- | --- |
| `public` | identity: `users`, `user_app_roles`, `user_relationships`, `coach_profiles`, `feature_flags` | Atlas |
| `atlas` | the coaching brain: distilled tendencies, archetype, prescriptions | Atlas |
| `golf` | player profile, bag, courses/holes, rounds, shots, practice sessions | **per table** — Red writes rounds/shots, Forge writes practice results |

Migrations for `public` and `golf` are owned by **`@ryp/eco`**. `atlas` is owned by Atlas.

### App-private — nobody else reads

`ryp_red` · `forge` (Luke) · `locker_room` · `debrief` · `practice_dna` (later)

## 3. The four rules

1. **One app writes exactly one private schema**, named for it.
2. **Cross-app data lives in a shared schema.** If two apps need it, promote it — never cross-join into another app's schema.
3. **Raw stays private; distilled goes shared.** Red keeps its dispersion model internals; rounds and shots go to `golf.*`. Practice DNA (later) keeps raw quiz answers; the result goes to `atlas.*`.
4. **No new app introduces a second auth system.** Firebase is the only credential layer.

**Naming convention that encodes rules 1–2:** domain-named schemas are shared (`public`, `atlas`, `golf`, later `fitness`); app-named schemas are private (`ryp_red`, `locker_room`, `debrief`). That's why the shared golf schema is `golf` and not `golf_shared` — the suffix was redundant.

## 4. The apps

| App | Owner | Stack | Schema | Status |
| --- | --- | --- | --- | --- |
| **Atlas** | Makel | — | `public`, `atlas`, `golf` | **Not built.** The nucleus is a plan |
| **RYP-RED** | Makel / Luke | Express + Vite + Drizzle + neon-serverless | `ryp_red` | Live. Reference impl for RLS |
| **Locker Room** | Yannick | Express + Vite + Drizzle + pooled `pg` | `locker_room` | Live. **No RLS today** — app-code isolation only |
| **Debrief** | Yannick | Next.js + Supabase | `debrief` | Live in prod. **Yannick decides** — §6.2 |
| **Forge** | **Luke** | — | `forge` | External. On the critical path as a consumer |
| Practice DNA | Yannick (+Teddy) | Express + React + raw `pg` | `practice_dna` | **Out of scope this phase** — §6.1 |
| Inventory | — | Nuxt | — | **Scoped out.** Internal-only |
| RYPstick / fitness | — | — | `fitness` + `rypstick` | Likely future spoke |

**Yannick owns three of these.** Sequence asks of him accordingly.

## 5. Building the new database

Order matters. **Roles before tables** — that's what makes RLS real instead of retrofitted.

1. **New Neon project** (`ryp-core`), one database.
2. **Create the per-app roles first**, all `NOBYPASSRLS`: `atlas_app`, `red_app`, `lr_app`, `billing_svc` (+ `debrief_app` if Debrief joins). Neon only gives you `BYPASSRLS` roles by default — which is exactly why the current database's RLS is decorative.
3. **`app_private` helpers as `SECURITY DEFINER`** with pinned `search_path`, from `eco/sql/rls_public.sql`. Not optional — see §8.
4. **eco migrates `public` + `golf`**, then applies its RLS policies. Entitlement writes are **bypass-only from the start**, so the self-grant escalation never exists here.
5. **Grants per role, per table** — `red_app` gets no `USAGE` on `locker_room`, and so on. This is what turns rules 1–2 from convention into a database permission.
6. **Each app migrates its own schema** from its repo, with RLS on every table holding per-user data.
7. **Seed entitlements** — see §6.4.
8. **Re-point every `DATABASE_URL`**, then `npm run verify:schema` must pass.

Keep the old database read-only for a couple of weeks, then delete it.

### What we deliberately leave behind

All of this exists in the current database and none of it carries over:

- `users` carrying 16 columns that belong to Red — so **eco's lean `users` is correct on day one**, and the migration-ownership gate in `drizzle.config.ts` opens immediately
- `players_pkey` (a fossil from a rename) and `playing_with_neon` (a Neon demo table)
- `ghin_number`, `ryp_red.trainer_courses`, `ryp_red.trainer_holes` — live objects that exist in no repository
- a `drizzle.__drizzle_migrations` journal shared between apps
- `BYPASSRLS`-only roles, and the `user_app_roles` policy that lets a user self-grant `admin`
- Red's rounds/shots sitting in a private schema and needing promotion to `golf.*`

**Red's Phase R3 stops being a migration.** No create-backfill-repoint-drop. Red declares its analytics columns in `ryp_red.*` and reads the profile from `golf.*`. It's a code change.

### What is lost, and why that's fine

All current users are friendlies or internal testers. **Firebase is separate from the database, so nobody re-registers** — `attachUser` provisions a fresh `public.users` row from the existing `firebase_uid` on next sign-in.

Gone: 34 rounds, Locker Room's roster and check-ins, and Red's `blueprint_*` / `lateral_*` calibration — so the caddie recalibrates from scratch for 8 users. Acceptable; just don't be surprised by it.

## 6. Open decisions

### 6.1 Practice DNA — deferred

**Not this phase.** Separate project, currently launching. Nothing here blocks it; it blocks nothing here.

⚠️ **One guard:** don't point its `DATABASE_URL` at the shared database. `migrate()` runs on boot, so setting that variable *is* a schema-create. Give it its own database for launch.

Settled for whenever it joins: it will be the **only anonymous-write app** — cold quiz traffic has no Firebase token, so most rows keep `user_id NULL`, which means **owner-scoped RLS breaks it** and it needs an explicit carve-out. Its data split follows rule 3: raw runs private, distilled result to `atlas.*`, hcp/speed/handedness to `golf.player_profile`.

### 6.2 Debrief — Yannick's call

**Makel has handed this decision to Yannick.** Debrief is his app, it's live in production, and its data isn't comparable to a golf round: voice transcripts, coaching notes, and Register-4 safety flags with verbatim timestamped acknowledgments. There's also an open retention / legal-hold question.

Two things he should know first:
- **pgvector is vestigial.** Ask-mode retrieval is Postgres full-text search (`websearch_to_tsquery` + GIN). Voyage AI was removed; `debrief_embeddings` exists but nothing populates it. **The migration is smaller than previously scoped.**
- If Debrief joins, it lands in the **new** database — not the old one and then again.

Whatever he chooses, rule 4 still binds: no second auth system long-term.

### 6.3 ~~Schema name~~ — DECIDED: `golf`

Settled 2026-08-18; eco v0.3.0 ships it. Rationale is the naming convention in §3.

### 6.4 Entitlement seeding — comes out of the metric map

`user_app_roles` starts empty, so `requireApp` will 403 everyone out of their own apps, and `plan` resets to `free` for the 20 accounts currently showing `pro`. A ~15-line seed script fixes it — but it needs a who-gets-which-app-and-role list, which nothing currently defines.

**That list is an output of the metric map** (decided 2026-08-18), not a separate ask. The map answers "which app collects or needs which metric," and the role/plan matrix falls out of it: if a coach needs to see a player's zone grades, that's a `locker_room` coach role plus a read on `atlas.*`. So the metric map now has two required outputs:

1. **Per metric: shared-source or app-private-derived?** — decides which schema each table lives in (rules 2 and 3).
2. **Per app: which roles exist, what each one can reach, and which plan tier gates it** — becomes the seed script and the `GRANT` list in §5 step 5.

This is why the metric map is a prerequisite for standing up `ryp-core`, not a parallel nice-to-have.

### 6.5 Products absent from this architecture

Luke's strategy doc names two that appear nowhere above: **Parallax** (CV swing analysis — previously assumed to be an external `videoRef` only) and a **Stimp / green-conditions map** as a free front door for Forge. ~~Also: a second Practice DNA implementation reportedly lives in `lukeryp/atlas-golf`~~ — **CLOSED 2026-08-24: Makel confirmed that repo is not real.** There is no unexamined Atlas port; "Atlas: not built" was correct.

## 7. 🔴 Act on this now — unrelated to the database

**A committed API key.** `apps/RYP-RED/openapi.yml:19` contains a literal GolfCourseAPI key — `security: - ApiKeyAuth: [D646BVRET4TQXWGY6QVV7DQWDU]` — git-tracked since commit `5758dad`. The same service is otherwise supplied via `GOLFCOURSE_API_KEY`. **Rotate the key and scrub the file.** Flagged 2026-07-29; still there.

**A false statement in a legal document.** `apps/RYP-RED/docs/legal/DATA_HANDLING_PROCEDURE.md` claims as its primary security control that "Neon Postgres enforces per-user row-level security." Untrue today, and it feeds the Privacy Policy. The new database makes it true — until then, the document overstates.

## 8. Landmines

Hard-won; each cost time already. These still apply to the new database — starting fresh avoids the *data* cruft, not the *class* of mistake.

**RLS**
- A `SECURITY INVOKER` helper that selects the table its own policies guard **recurses**. `app_private.locker_room_is_admin()` did — it died with `stack depth limit exceeded`, *not* Postgres's "infinite recursion detected in policy", because the loop runs through a function. It only manifests when `current_user_id` is set, so a naive smoke test passes and real traffic dies. **Fix: `SECURITY DEFINER` + pinned `search_path`.**
- **Roles and bypass-only entitlement writes must ship together.** RLS bound but `user_app_roles` still self-writable means a user inserts their own `('locker_room','admin')` row and reads every user. Demonstrated: 1 row → all 24 users. In the new database, grants handle this at build time.
- `FORCE ROW LEVEL SECURITY` matters — without it the table owner silently bypasses policies. `BYPASSRLS` on the *role* defeats even that.
- `current_setting(x, true)` returns `''`, not NULL, when unset — and `''::uuid` raises. Always `nullif(...)`.
- eco sets `app.current_app` and **nothing reads it.** App scoping is enforced in memory by `requireApp`, never by the database.
- Red sets session vars with `set_config(..., false)` (**session**-scoped, on pool checkout); eco uses `true` (**transaction**-scoped). Both work; don't mix assumptions.

**Tooling**
- **`drizzle-kit`'s `schemaFilter` does not filter which *declared* tables get emitted** — only which schemas are introspected. Point `schema` at the file you own. Verified failing: with the barrel plus a `golf`-only filter, generate emitted `CREATE TABLE` for all five public tables.
- **Never run `db:push`.** `generate` → read the SQL → `migrate`. `push` diffs live state and drops anything undeclared.
- **Every app must override its migrations table.** A shared `drizzle.__drizzle_migrations` interleaves histories.

**Schema**
- **Never name an identity table `players`.** `locker_room.players` is a real roster table; "FK to players" binds the wrong one. This is exactly what the old guide got wrong.
- `user_app_roles.deleted_at` **is** per-app revocation. Any authorization read must filter `isNull(deletedAt)` or revoked access still works.
- `user_relationships` is **actor/subject**, not coach/player, with a `relationship` label and `status` defaulting to `'pending'` — the edge is a *request* until `approved_at`.
- Keep timestamps and FK behaviour consistent: `timestamp without time zone`, no `ON DELETE` cascade. Users are soft-deleted via `deleted_at`.

**Process**
- Working trees belong on a **non-synced path** (`~/dev/ATR`). iCloud on `~/Desktop` produced the `X 2.tsx` / `lib 2/` duplicates. GitHub is the sync layer. eco has moved; Red and others haven't.
- **S.C.O.R.E. means two incompatible things.** Debrief: Strategize/Commit/Observe/Reset/Engage, 1–10, 18 failure modes, LLM-extracted. Locker Room: Strategy/Commitment/Observation/Reset/Engage, 0–25, 26 archetypes, Typeform. Same acronym, different instrument — don't merge them by name.
- *(when Practice DNA joins)* It exists in **three places on disk**; ship from upstream `yanyanarti/practice-dna` or you'll patch a dead copy. Its scoring engine was copied from `lukeryp/forge` and **has since diverged**; the regression suite lives in Forge.

## 9. Superseded docs

Retired as ecosystem references. Their still-true content is in §8. Keep the files, but don't cite them.

| Doc | Why |
| --- | --- |
| ~~`docs/guides/RYP_Ecosystem_App_Guide.md`~~ **DELETED 28 Aug** | Named identity `public.players` (never existed); mandated `neon-http` (cannot do transactions); assumed one shared Platform API + Cloudflare Pages. It was the most actively misleading doc in the repo, and leaving a doc like that on disk marked "retired" is how it gets cited anyway |
| `ECOSYSTEM-ARCHITECTURE-ASSESSMENT.md` | Concludes Atlas is *not* the data hub — inverted here. Names the DB `ryp_golf`; assumes we build Forge |
| `RYP-ECOSYSTEM-BUILD-PLAN.md` | Phase ladder replaced. Its Forge data model is now Luke's spec, not ours |
| `RYP-ECO-PACKAGE-PHASE-1A.md` | Became shipped code, and its schema was largely wrong. `@ryp/eco` v0.3.0 is the truth |
| `apps/RYP-RED/app/ARCHITECTURE.md`, `RYP_RED_Architecture_Review.md`, `RYP_RED_Dev_Context.md` | Cite the "Shared Platform API" decision from the stale guide |
| `apps/{debrief,locker-room}/README.md` | Superseded by their `CLAUDE.md` |
| `docs/guides/RYP_Shared_Database_Security_Guide.md` | **Cited by Red's sprint plan but does not exist.** Stop citing it |

### Deleted 2026-08-28

Not just retired — **removed**, because keeping a superseded doc alongside its replacement is how the
wrong one gets cited. Recorded here so nobody hunts for a file that was deleted on purpose.

| Deleted | Replaced by |
| --- | --- |
| `ECOSYSTEM-ARCHITECTURE-ASSESSMENT.md` | this doc — it concluded the opposite about Atlas |
| `RYP-ECOSYSTEM-BUILD-PLAN.md` | `ROADMAP-atlas-to-launch.md` |
| `RYP-ECO-PACKAGE-PHASE-1A.md` | the shipped `@ryp/eco` package; its schema was largely wrong |
| `DEMO-PLAN-2WEEKS.md` | `DEMO-RUNBOOK-2026-09-07.md` |
| `SPRINT-PLAN-to-day0.md` | `DEMO-RUNBOOK-2026-09-07.md` + `SPRINT-1-PREP.md`; its sprints are done |
| `HANDOFF-atlas-admin-pricing.md` | the built admin panel; the unbuilt half stays in `ATLAS-ADMIN-PLAN.md` §5 |
| `LUKE-PROTOTYPE-GAP.md` | `GAP-REPORT-design-vs-build.md`, which covers it far more thoroughly. Its three answered decisions live in `DECISION-coach-dashboard.md` |

**Still authoritative:** `RED-UPDATE-PLAN.md`, `YANNICK-UPDATE-PLAN.md`, each app's `CLAUDE.md`, `apps/RYP-RED/docs/GITHUB_WORKFLOW_LUKE.md`, Practice DNA's `Hand-off/BUILD-PACKAGE/*` instrument specs, and all product/legal/patent specs (app-local by design).

## 10. Sequence

1. **Rotate the committed API key** (§7) — today, independent of everything
2. **Metric map** — per metric: shared or app-private; per app: roles, reach, plan tier (§6.4). Gates step 3, because it defines the schemas and the `GRANT` list
3. **Stand up `ryp-core`**: roles → `app_private` helpers → eco migrates `public` + `golf` → grants (§5)
4. **Red and Locker Room migrate their own schemas** into it, with RLS on per-user tables
5. **Seed entitlements**, re-point `DATABASE_URL`s, `verify:schema` must pass
6. **Build Atlas** as eco's reference consumer, and the writer of `public` + `atlas`
7. Decommission the old database

*Yannick's call:* whether Debrief joins (§6.2). *Later phase:* Practice DNA (§6.1); RYPstick / fitness.
