# Answers — Debrief & Locker Room

**2026-08-24.** Every claim below was verified against the live `ryp-core` database, not the plan docs. Two of your questions found real gaps; one found a design change I'm accepting.

---

# DEBRIEF

## 1. Can any other app read `debrief.*`? — **No. Confirmed in writing.**

**The mechanism, so you can audit it rather than trust it.** Isolation is at the *schema privilege* level, above RLS:

- `debrief_app` will hold `USAGE` on schema `debrief`. **No other role will be granted it — ever.**
- Without schema `USAGE`, a query doesn't return empty, it **errors**. I proved exactly this on the old database: as `red_app`, `select … from locker_room.daily_checkins` failed with `permission denied for schema locker_room`. Not a filtered result — a hard refusal before any policy is consulted.
- Verified today: no role holds any grant on any app-private schema it doesn't own.

I've written this into `eco/sql/rls_core.sql` as a standing rule, so the next person to add a role sees it.

### Your consent model changes my design, and I'm taking it

You're right to flag it. I had assumed cross-app sharing meant *readable shared tables*. Yours is better for this data, and it generalises — so the architecture now has **two** mechanisms, not one:

| Mechanism | For | Example |
| --- | --- | --- |
| **Shared table** | Facts with one meaning, no per-user sensitivity | `golf.rounds`, `golf.player_profile` |
| **Consented feed** | Anything the golfer must opt into per category | Debrief patterns, homework, coach memory |

**Nothing in `debrief.*` becomes a readable table to anyone.** What leaves is a projection you emit, per user, per category.

Two things I'd add on top:

**Clinical flags should be structurally unable to leave, not policy-blocked.** Keep them in their own table that no role but `debrief_app` has any grant on, and make sure the feed's projection cannot reference it — a function or view that has no path to those columns. Policy-blocked means one careless `create policy` away from leaking; structurally-unable means someone has to write and review a grant.

**Where does the consent record live?** If it stays Debrief-private, Atlas can't show a golfer one place to manage what they share, and every future app invents its own. I'd propose a shared `public.sharing_consents` — `(user_id, source_app, category, granted, updated_at)` — owned by eco, written only through the bypass path, with the *enforcement* still entirely yours: you read it and decide what to emit. **That's a proposal, not a decision** — you built the mechanism, so tell me if the shape is wrong.

## 2. How do our rounds join Red's? — **You found a real gap. Here's the mapping.**

You're right that nothing in the plan connects them. Answer:

**Add a nullable `round_id` on `debriefs`, referencing `golf.rounds.id`.**

- **Nullable is load-bearing.** A player must be able to debrief a round Red never tracked. So your local metadata (course, tees, score, holes) **stays** — it's the fallback for unlinked debriefs, not redundancy to delete.
- **Debrief reads `golf.rounds`. It never writes it.** Red is the writer. That keeps the per-table writer rule intact.
- Same treatment for `tournament_rounds` — `tournaments` and `tournament_rounds` stay app-private, but a tournament round that *is* a golf round carries the same nullable reference.

**On how the link gets made — do not match on date + course.** Fuzzy matching two records that are supposed to be the same round is how you get silent mis-joins that are very hard to unpick later. Two explicit paths instead:

1. Red deep-links into Debrief with the round id
2. Debrief asks "which round was this?" and lists the user's recent `golf.rounds`

Both are user-confirmed. An unlinked debrief stays unlinked, which is a perfectly good state.

## 3. What happens to existing logins? — **No re-registration. But there is a one-time remap.**

**Your 6-digit code survives.** Firebase has no first-class email-OTP provider, but it doesn't need one: keep sending your own code, verify it server-side, then mint a **Firebase custom token** (`createCustomToken`) and sign the user in with it. Same UX, Firebase becomes the session and identity layer underneath. Nobody sets a password, nobody re-registers.

That also sidesteps the reason you avoided magic links in the first place — Firebase's email-link is the same mechanism that broke for you, and we're not using it.

**The real work is an id remap, once.** Your rows are keyed to Supabase user ids today. Each user needs a Firebase account created server-side (`createUser` by email), which produces a new `firebase_uid`, which resolves to a `public.users.id`. Then `debrief.*` rows are re-keyed to that id.

At ~23 testers this is a script, not a project — but it is a real step, and it wants a mapping table kept until you're confident.

---

# LOCKER ROOM

## Blocker: private repo + `git+ssh` lockfile

**Recommendation: publish eco to GitHub Packages** (your option 2). Keeps it private, Railway authenticates with a token in an env var rather than an SSH key, and you get real versions instead of git refs.

**Not option 1.** eco is the auth spine. Security shouldn't depend on schema secrecy, but making the identity and RLS design public invites scrutiny for no benefit.

**To unblock you today**, option 3 as a bridge: a fine-grained read-only PAT, force the lockfile to HTTPS rather than `git+ssh`, and inject the token on Railway. That ships now; Packages is the proper fix right after.

I'll do the Packages setup — it's my repo, so it shouldn't be your problem.

## 1. GRANTs or policies? — **Both. And it's the case you feared.**

Verified in `ryp-core` before you touched anything: **`lr_app` had `SELECT` only on `public.user_app_roles`.** No `INSERT`.

So your instinct is exactly right: **`withRlsBypass` does nothing for a missing GRANT.** It clears *policies*; table privileges are checked separately and earlier. Wrapping the writes was necessary and would still have failed.

**Fixed, just now** — `lr_app` (and `red_app`, `atlas_app`) now hold `INSERT, UPDATE` on `user_app_roles`, **while the write policy stays bypass-only** (`using (app_private.rls_bypass())`).

That combination is the point:
- A user-facing query **still cannot write**, grant or no grant — the policy refuses it
- `withRlsBypass` now works, so your wrapped signup writes succeed
- The self-grant escalation stays closed
- **You don't need a second connection.** Your existing pool is enough

So: keep your wrapping. It's correct, and now it works.

## 2. Read policy on `public.user_app_roles`

Current shape, exactly:

| Policy | Rule |
| --- | --- |
| `user_app_roles_select` | `rls_bypass() OR user_id = current_user_id()` — self only |
| `user_app_roles_locker_admin_read` | `locker_room_is_admin() AND app = 'locker_room'` |
| `user_app_roles_write` | bypass only |

So yes — **your two admin reads are fine**, the `is_admin` escape exists and `locker_room_is_admin()` is already `SECURITY DEFINER` in `ryp-core` (the recursion trap is closed there).

**`routes.ts:2550` breaks**, as you predicted. A head coach reading assistants is neither self nor admin.

**Target shape: authorize it through `public.org_memberships`** — reader and subject share an organization, and the reader's org role is `admin` or `coach`. That's precisely why `organizations` and `org_memberships` exist in the shared core.

I deliberately won't write a policy on `public.user_app_roles` that reads `locker_room.*`. A shared table reaching into an app-private schema is the coupling the whole structure exists to prevent, and it's what `locker_room_scope_university_id()` does today.

**So: wrap 2550 in bypass with a clear reason for now**, and it becomes a real policy once your coaches and assistants exist in `org_memberships`. Flag it in a comment as interim so it doesn't calcify.

## 3. A non-bypassing role to test against — **yes, and the recipe is reusable**

Two options. Prefer the second for now, because your 17 policies live in `locker_room.*`, which exists in the **old** project, not `ryp-core`.

**Option A — `ryp-core`:** `lr_app` already exists with `NOBYPASSRLS`. It's `NOLOGIN` until Makel sets passwords; once he has, you get a real connection string.

**Option B — the recipe, today, no credentials needed.** This is what I used to prove the model:

```sql
-- 1. Branch the OLD project in the Neon console (copy-on-write, instant, throwaway)
-- 2. Against that branch, as owner:
create role lr_test nobypassrls;
grant usage on schema public, app_private, locker_room to lr_test;
grant select, insert, update on all tables in schema locker_room to lr_test;
grant select on all tables in schema public to lr_test;
grant execute on all functions in schema app_private to lr_test;
grant lr_test to neondb_owner;          -- lets you SET ROLE into it

-- 3. Then, in ONE transaction (session vars are transaction-scoped):
begin;
select set_config('app.current_user_id', '<a real user id>', true),
       set_config('app.rls_bypass', 'false', true);
set role lr_test;
select count(*) from locker_room.players;   -- should be scoped, not everything
reset role;
rollback;
```

**Two traps I hit, so you don't:**

- **Set `app.current_user_id` before `SET ROLE`**, and keep it all in one transaction. `set_config(..., true)` is transaction-local.
- **A helper that's `SECURITY INVOKER` and selects the table its own policies guard will recurse.** `locker_room_is_admin()` did — it died with `stack depth limit exceeded`, *not* Postgres's usual "infinite recursion detected in policy", because the loop runs through a function so the detector misses it. And it **only** happens when `current_user_id` is set — unset, the planner folds the scan away and a naive smoke test passes while real traffic dies. `SECURITY DEFINER` + a pinned `search_path` fixes it.

Run your policies through this **before** step 4. You're right that it's the wrong thing to discover afterwards.

---

# Your two notes

## Shared Neon database across `feature` and `production` — this is the most important thing in your message

You're right, and it changes the rollout. Consequences:

1. Your "test first" flow has only ever isolated **code**, never data. A boot-time migration on `feature` is instantly live on prod — and Locker Room does boot-time DDL, so this is real today, not theoretical.
2. **Step 4 can't be canaried.** Repointing `DATABASE_URL` has to happen on both envs together, or one breaks.

**Fix: give each environment its own Neon branch.** That's what branches are for — copy-on-write, instant, and `feature` gets real-shaped data without touching prod. It makes "test on the test instance" true for the first time.

I'll check whether Red has the same arrangement. Assume nothing until confirmed — worth every app answering it before step 4.

## `terms_accepted_at` / `terms_version` — **careful, these moved**

Don't write code against them. `public.users` now has exactly: `id`, `firebase_uid`, `display_name`, `email`, `plan`, `parental_consent_at`, `date_of_birth`, `created_at`, `updated_at`, `deleted_at`.

The two you named are now **`public.terms_acceptances`** — `(user_id, app, terms_version, accepted_at)`, one row per app per version.

**That's better for your case, and it was your app that motivated it.** A single global `terms_accepted_at` is overwritten on every re-acceptance, so it cannot answer "which version did they accept when they acknowledged that flag?" — which is exactly what a safety acknowledgment needs to prove. Per-app-per-version keeps the history.

`parental_consent_at` and `date_of_birth` stayed on `users`, since they're properties of the person rather than of accepting a document. So the COPPA/high-school groundwork is there — just split across two tables, deliberately.
