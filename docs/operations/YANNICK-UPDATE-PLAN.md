# Update plan — Locker Room & Debrief

**For:** Yannick · **From:** Makel · **Date:** 2026-08-12 · **Supersedes** the 2026-08-05 draft

---

## TL;DR

| App | Ask | Size |
| --- | --- | --- |
| **Locker Room** | Import identity from `@ryp/eco` instead of hand-copying it. Move 2 role-inserts to a trusted path. Add RLS to 4 tables. | Small — 1–2 days |
| **Debrief** | Full migration: Supabase → Firebase auth + Neon (`debrief.*`) + R2 storage. | Large — your estimate needed |

**What you get out of it:** Locker Room coaches see each player's Atlas coaching data, and Debrief can pull real rounds from Red and practice results from Forge instead of living in isolation.

---

## The structure this is moving toward

One Postgres database. Atlas is the hub — it owns identity and the coaching brain; every app reads from the shared core and keeps its own private schema.

**Shared core — every app reads:**

| Schema | Holds | Writer |
| --- | --- | --- |
| `public` | identity — users, roles, relationships | Atlas |
| `atlas` | **Practice DNA** — intake, mental + physical tendencies, coaching prescriptions | Atlas |
| `golf` | player profile, bag, courses, **rounds, shots, practice sessions** | whichever app produces it |

**App-private — nobody else reads:** `ryp_red` (caddie logic, analytics), `forge` (Luke), `locker_room` (yours), `debrief` (yours).

The product logic: Atlas's Practice DNA is the intake path that learns a player's tendencies. Red and Forge feed it physical golf data. Practice DNA then drives how Forge prescribes practice and how Red caddies. Locker Room gives academy coaches a view of all of it per player. Debrief analyzes moments from Red rounds and results from Forge sessions.

*(A RYPstick-based fitness app is a likely future spoke — not scoped, nothing needed from you now.)*

---

## Locker Room

Your app is the reference for how this should work already — shared Firebase, shared Neon, `schemaFilter: ["locker_room"]` so you never migrate `public.*`. Your hand-copied schema is actually **more correct than the first version of `@ryp/eco` was**; eco has been corrected to match yours.

### 1. Import identity instead of copying it — `shared/schema.ts`

Delete the `─── Shared tables (public schema) ───` block (`users`, `userAppRoles`, and the `User` / `InsertUser` / `UserAppRole` types) and re-export:

```ts
export { users, userAppRoles, userRelationships, coachProfiles, featureFlags } from '@ryp/eco/schema'
export type { User, InsertUser, UserAppRole } from '@ryp/eco/schema'
```

Add to `package.json`:
```json
"@ryp/eco": "github:RYPGolf/ryp-eco#v0.3.0"
```

Everything downstream keeps importing from `@shared/schema` — **no changes in `server/routes.ts`, `server/storage.ts`, or `server/defaultUniversity.ts`.**

One thing you gain: eco declares `deleted_at` on `user_app_roles`, which your copy is missing. That column is how a per-app entitlement gets revoked (Red writes it on per-app account deletion). Your auth gate at `server/auth.ts:101` and `server/roles.ts:7` currently can't filter it because it isn't in your schema object. After the swap, add `isNull(userAppRoles.deletedAt)` to both — otherwise a user who deleted their Locker Room account still authenticates.

### 2. Move the two role-inserts to a trusted path

`server/routes.ts:396` (role `user`) and `:1896` (role `coach`) insert into `public.user_app_roles` on the user's own connection.

That has to change, because we're making entitlement writes bypass-only. Reason: the current policy lets any user insert **any** `(app, role)` for themselves — including `('locker_room','admin')`, which unlocks read access to every row of `public.users`. We reproduced that end-to-end on a test branch: one INSERT took a normal user from seeing 1 user to seeing all 24.

Use eco's `withRlsBypass` for those two inserts:

```ts
import { withRlsBypass } from '@ryp/eco/db'

await withRlsBypass(pool, 'locker room signup: grant user role', schema, (db) =>
  db.insert(userAppRoles).values({ userId: sharedUser.id, app: 'locker_room', role: 'user' }),
)
```

**This is a hard prerequisite** — if it isn't done before the DB roles land, Locker Room signup breaks.

### 3. Add RLS to 4 tables

These have no row-level security at all, while your other 13 tables do:

`access_requests` · `achievements` · `daily_checkins` · `daily_rep_log`

They hold per-player data, so once apps connect as restricted roles these are readable across every university. Same pattern as your existing policies:

```sql
alter table locker_room.daily_checkins enable row level security;
alter table locker_room.daily_checkins force row level security;
create policy daily_checkins_scope on locker_room.daily_checkins for all
  using (app_private.rls_bypass()
         or player_id in (select id from locker_room.players
                          where university_id = app_private.locker_room_scope_university_id()));
```

Adjust per table — you know the scoping rules better than we do.

### 4. Heads-up: your `app_private` helpers aren't in any repo

`migrations/001_locker_room_rls.sql` **references** `app_private.locker_room_is_admin`, `locker_room_is_coach`, `locker_room_university_id` and `locker_room_scope_university_id` — but defines none of them. Neither does any other repo. They exist only in the live database.

So rebuilding the DB from migrations breaks all 13 of your policies. They're currently reproduced in `@ryp/eco`'s `sql/rls_public.sql` as the only version-controlled copy; they should really move into your migrations.

Related: all four need to become `SECURITY DEFINER`. As `SECURITY INVOKER` they recurse once RLS actually binds — `locker_room_is_admin()` selects `user_app_roles`, whose policy calls `locker_room_is_admin()`. We hit `stack depth limit exceeded` on the test branch. The fix is verified:

```sql
create or replace function app_private.locker_room_is_admin()
returns boolean language sql stable
security definer set search_path = pg_catalog, public as $$ ... $$;
```

### Not being asked
- No data migration. Zero rows move.
- No change to your 17 `locker_room.*` tables, your stack, or your deploy.
- No change to your RLS pool or auth middleware (`server/lib/rlsPool.ts`, `server/auth.ts`) — they work; eco's equivalents are optional.

---

## Debrief — full migration

Makel chose the full path rather than identity-only. End state: Debrief on the shared stack, able to read `golf.rounds` / `golf.shots` from Red and practice results from Forge.

### Scope

| Piece | From | To |
| --- | --- | --- |
| Auth | Supabase Auth (`@supabase/ssr` cookies) | Firebase + `@ryp/eco` |
| Data | Supabase Postgres, 11 tables | `debrief.*` in Neon |
| Vectors | pgvector, `vector(1536)`, HNSW, match RPC | same in Neon — **pgvector is supported**, this ports |
| Storage | 2 Supabase buckets (`audio`, `feedback`) | Cloudflare R2 |
| RLS | policies on `auth.uid()` | `app_private.current_user_id()` |
| Migrations | 20+ in `supabase/migrations/` | Drizzle, `schemaFilter: ['debrief']` |

Tables: `debriefs`, `debrief_embeddings`, `knowledge_chunks`, `ask_sessions`, `coaching_notes`, `prescriptions`, `digests`, `tournaments`, `tournament_rounds`, `push_subscriptions`, `user_profiles`.

### Suggested order

1. **Auth first, data second.** Auth is concentrated in four files — `middleware.ts`, `lib/supabase/{client,server,admin}.ts` — while the other ~30 files just consume the session. Swapping auth alone is a contained change.
2. **Map `user_profiles` → `public.users`.** Only 23 users ecosystem-wide, so this is small. Decide what stays Debrief-specific vs. what belongs in shared identity.
3. **Port schema + pgvector**, keeping HNSW indexes. The `match` RPC in `20260522000001_ask_mode_support.sql` becomes a regular function or an app-side query.
4. **Storage → R2**, including the `cleanup-audio` cron and the signed-URL flow in `app/api/feedback/route.ts`.
5. **Rewrite RLS** onto `app_private.current_user_id()`.

### The sharp edge

Your Supabase RLS policies key on `auth.uid()`, which stops being populated the moment auth moves. Options: keep a Supabase session alongside Firebase during transition, or move those checks app-side until the data lands in Neon. **Worth agreeing on this before you start** — it's the piece most likely to bite.

### Not being asked
- Not moving off Next.js or Railway.
- Not changing your product surface, UX, or schema design.
- Not adopting Express/Vite to match the other apps.

---

## Sequence across both apps

1. `@ryp/eco` v0.2.0 — **done**, tagged and pushed
2. `app_private` helpers → `SECURITY DEFINER` (Locker Room §4)
3. Locker Room role-inserts → `withRlsBypass` (§2)
4. Per-app DB roles + bypass-only entitlement writes; repoint `DATABASE_URL`
5. Locker Room RLS on the 4 tables (§3)
6. Debrief migration (independent of 2–5; can run in parallel)

Steps 2–4 are coordinated — they land together or RLS ends up enforced-but-escapable.

## What I need from you

1. Sanity-check the Locker Room items — is §1 as small as it looks?
2. A Debrief estimate, and your read on the `auth.uid()` problem.
3. Tell us if the shared-core layout misses something Locker Room or Debrief needs.

---

### Appendix — how this was verified

Schema claims were read from the live Neon database, not from docs. The RLS findings come from a disposable Neon branch (`rls-role-experiment`, forked from production, since expired): a non-bypassing role saw 0 of 23 users with no session context and exactly 1 with its own; `red_app` was denied `locker_room` at the schema level; the self-grant escalation and the `SECURITY DEFINER` recursion fix were both reproduced there.

Worth knowing: **RLS is currently inert in production** — every login-capable Postgres role has `BYPASSRLS`, so today's policies are decorative. That's what step 4 fixes, and it's why step 3 has to come first.
