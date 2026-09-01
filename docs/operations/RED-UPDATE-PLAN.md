# Update plan — RYP-RED

**Date:** 2026-08-13 · Companion to `YANNICK-UPDATE-PLAN.md` · Structure per the approved hub-and-spoke layout

---

## TL;DR

Red has the most work of any app, because it currently owns things the new structure moves to Atlas.

| Phase | What | Risk |
| --- | --- | --- |
| **R1** | Stop `db:push` from destroying live data (2 undeclared objects) | 🔴 do this first, today |
| **R2** | Hand identity ownership to eco/Atlas; adopt `@ryp/eco` | Low, mechanical |
| **R3** | Slim `public.users`; promote raw golf data to `golf.*` | 🟠 invasive, needs backfill |
| **R4** | Connect as `red_app`; read Practice DNA from `atlas.*` | Coordinated with Locker Room |

**Red's end state:** it keeps the caddie — its analytics model and playing UX — and stops being the system of record. Raw rounds/shots become shared truth; `blueprint_*` / `lateral_*` stay Red's.

---

## 🔴 R1 — Two undeclared objects that `db:push` would destroy

Red's `drizzle.config.ts` has `schemaFilter: ["public", "ryp_red"]`, so drizzle diffs **both** schemas against `shared/schema.ts`. Two live objects aren't declared there:

| Live object | Status | What `db:push` does |
| --- | --- | --- |
| `public.users.ghin_number` | text column, exists in prod, in no migration and no snapshot | `DROP COLUMN` |
| `ryp_red.trainer_courses`, `ryp_red.trainer_holes` | real tables with data, declared in no repo | `DROP TABLE` |

Both were created out-of-band directly against the database. Red declares 26 of `users`' 27 columns; `ghin_number` is the gap.

**Do now, pick one per object:**
1. Declare them in `shared/schema.ts` (`ghinNumber: text('ghin_number')`, plus the two trainer tables), **or**
2. Explicitly disown them — but then something else must declare them, or they stay unmanaged.

**And regardless: never run `db:push` against this database.** Use `generate` → review the SQL → `migrate`. `push` diffs live state and will happily drop anything undeclared. A one-line guard in `package.json` is worth it:

```json
"db:push": "echo 'db:push is banned on the shared DB — use db:generate + db:migrate' && exit 1"
```

Also worth knowing: `ryp_red.trainer_courses` and `trainer_holes` have **no RLS**, unlike Red's other six tables which are correctly enabled + forced. If they stay Red-private that's probably fine; if they move to `golf.*` as course reference data (see R3), decide deliberately.

---

## R2 — Hand identity to eco, adopt the package

Red is today's de facto identity owner: it declares `users`, `user_app_roles`, `coach_profiles`, `user_relationships`, `feature_flags`, migrates `public.*`, and provisions users at `server/auth.ts:115`, `server/storage.ts:15`, and `server/roles.ts:24`.

Under the new structure Atlas is the writer of `public.*`, and **`@ryp/eco` owns its migrations**.

### Steps

1. Add `"@ryp/eco": "github:RYPGolf/ryp-eco#v0.3.0"`.
2. In `shared/schema.ts`, replace the five `public` table declarations with re-exports:
   ```ts
   export { users, userAppRoles, coachProfiles, userRelationships, featureFlags } from '@ryp/eco/schema'
   ```
   Keep the `ryp_red.*` tables exactly as they are.
3. Change `drizzle.config.ts` to `schemaFilter: ["ryp_red"]` — Red stops migrating `public`.
4. Move the entitlement write at `server/roles.ts:24` to `withRlsBypass` (same change Locker Room is making, same reason — see R4).

### ⚠️ Ordering constraint worth understanding

eco's `users` is deliberately **lean** — 11 columns, because the other 16 belong to Red. So eco cannot safely own `public.*` migrations until those columns have moved out (R3). Until then:

- eco keeps `schemaFilter: ['golf']` and migrates nothing in `public`
- Red keeps applying `public` migrations, but **only additively and by hand-reviewed SQL**

**So R2 step 3 lands after R3, not before.** Steps 1, 2 and 4 can go now.

**✅ DECIDED 2026-08-17:** eco (not Atlas) owns `public.*` + `golf.*` migrations. Atlas is the runtime writer; eco is the migration owner. eco's config still excludes `public` on purpose — the handoff is gated on R3, and eco's `drizzle.config.ts` documents the exact ordered flip.

---

## 🟠 R3 — Slim `public.users`, promote raw golf data

The invasive phase. Each move is: **create → backfill → repoint reads → verify → drop.** Additive first, destructive last, and never in one migration.

### Where each of Red's 16 extra `users` columns goes

| Columns | Destination | Why |
| --- | --- | --- |
| `handicap_index`, `driver_carry_yds`, `handedness`, `ghin_number` | **`golf.player_profile`** | Shared golf profile — Atlas writes, every app reads |
| `blueprint_weight`, `blueprint_shot_count`, `lateral_sigma_model`, `lateral_sigma_measured`, `lateral_sigma_blended`, `lateral_bias_yds` | **`ryp_red.*`** | Red's dispersion model internals — derived, nobody else's business |
| `tutorial_completed_at` | **`ryp_red.*`** | Red's own onboarding state |
| `plan` | **stays `public.users`** | Entitlement tier; `feature_flags.plan_required` compares against it |
| `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `subscription_current_period_end` | **stays `public.users`** | Billing belongs to the nucleus, not the playing app. Ownership moves to Atlas/`billing_svc`; Red stops writing them |
| `date_of_birth` | **stays `public.users`** | Identity/compliance — it gates `parental_consent_at`, not golf |
| `terms_accepted_at`, `terms_version`, `parental_consent_at` | **stays `public.users`** | Already in eco; Atlas owns consent as the login front door |

That leaves eco's lean `users` complete and correct — which is exactly what unblocks R2 step 3.

### Raw golf data → `golf.*`

| Today | Becomes | Note |
| --- | --- | --- |
| `ryp_red.rounds` | `golf.rounds` | Red still the writer; Debrief and Atlas read |
| `ryp_red.shot_locations` | `golf.shots` | Forge will also write here |
| `ryp_red.holes` | `golf.holes` | |
| `ryp_red.course_geometry`, `course_geometry_overrides` | `golf.courses` (+ overrides) | Reference data everyone benefits from |
| `ryp_red.trainer_courses`, `trainer_holes` | `golf.*` or stay private | Decide with R1 |
| `ryp_red.club_profiles` | `golf.bag` | This is the "my bag" feature |

Red keeps `ryp_red.*` for the caddie logic and the dispersion model.

**Data sizes are small — this is the cheapest it will ever be:** 34 rounds across 8 users, 4 shot_locations, 23 users total, and nobody is actually being billed. Doing this at 34 rounds is a different exercise from doing it at 34,000.

**RLS must come with each table.** Red's existing policies are the right pattern — `rls_bypass() OR user_id = current_user_id()` — carry them over, and add a coach-read policy via `public.user_relationships` where a coach should see a player's rounds.

---

## R4 — Connect as `red_app`, read Practice DNA

1. `DATABASE_URL` points at the `red_app` role (`NOBYPASSRLS`) instead of `neondb_owner`. Grants are in eco's `sql/rls_public.sql` Part 0 — verified on a test branch.
2. **Prerequisite:** the four `app_private.locker_room_*` helpers must become `SECURITY DEFINER` first, or admin requests die with `stack depth limit exceeded`. Locker Room's plan covers this.
3. **Coordinated with Locker Room:** entitlement writes become bypass-only at the same time, so `server/roles.ts:24` must already be on `withRlsBypass`.
4. Red's own `server/lib/rlsPool.ts` and `server/auth.ts` keep working — they already set the right session vars. Swapping them for eco's is optional and not urgent.
5. **New capability:** Red reads `atlas.*` Practice DNA so the caddie is informed by Atlas's coaching philosophy rather than only Red's own model. This is the payoff — spec it once Atlas's schema exists.

---

## Housekeeping

- `app/server/` contains `lib 2/` and `middleware 2/` — iCloud sync duplicates. Same class of mess that motivated moving code off `~/Desktop`. Worth deleting and moving Red to `~/dev/ATR/` as eco already has been.
- Red is on branch `mac`, with a `luke` branch alongside. Land any in-flight merge before starting R3 — that phase touches migrations and is painful to rebase.

---

## Sequence

1. **R1** — declare the two undeclared objects, ban `db:push` ← today, independent of everything
2. **R2** steps 1, 2, 4 — adopt eco, move the entitlement write
3. **R3** — slim `users`, promote golf data (biggest piece; small data, so do it now)
4. **R2** step 3 — Red drops `public` from schemaFilter; eco takes over those migrations
5. **R4** — `red_app` role, coordinated with Locker Room's steps

## Decisions needed from Makel

2. `trainer_courses` / `trainer_holes` — shared course reference data, or Red-private?
3. Confirm **Stripe/billing columns stay in `public.users`** with ownership moving to Atlas, rather than getting their own `billing.*` schema.
