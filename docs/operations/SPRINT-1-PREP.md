# Sprint 1 prep — identity live

**Written Mon 2026-08-24.** Records what is
already built, the two defects the first integration surfaced, and the three decisions that are
still open. Demo is **Mon 7 Sep**.

---

## 1. Repo

`makel-ryp/Atlas` — private, pushed, 3 commits.

Two things worth deciding rather than drifting into:

- **It is under the personal account, while `ryp-eco` is under the `RYPGolf` org.** Transfer
  preserves history and is one click, so this is cheap to change later — but the longer Luke has a
  clone, the more it looks settled. Org ownership is the safer default for anything the company
  depends on: it survives an account change and it is where the other repos already are.
- **Luke cannot `npm install` this repo yet.** `package.json` depends on
  `github:RYPGolf/ryp-eco#v0.7.0`, a private repo. He needs read access to `RYPGolf/ryp-eco` as
  well as to Atlas. This is the same blocker Yannick hit for Railway; publishing eco to GitHub
  Packages solves both at once.

---

## 2. Built and typechecking

| Piece | Where | Notes |
| --- | --- | --- |
| Identity chain | `server/routes/me.ts` | `verifyToken` → `attachUser(pool)` → `requireApp('atlas')` |
| Profile read | `GET /api/users/me` | Identity + roles + `golf.player_profile`, one round trip, via `withRls` |
| Profile write | `PATCH /api/users/me` | zod `.strict()`; `plan` absent from the schema *and* from the DB grant |
| Firebase client | `client/src/lib/firebase.ts` | Project **rypstick-ios** — see §3 |
| Auth state | `client/src/lib/authContext.tsx` | Distinguishes 403-no-access from a real error |
| Login screen | `client/src/components/Login.tsx` | Email + password, non-enumerating error copy |
| Profile screen | `client/src/components/Profile.tsx` | Every value live from `ryp-core` |
| Seed | `scripts/seed.ts` — `npm run seed` | 2 players, 1 coach, 1 `coach_of`. Idempotent |

**The seed creates Firebase users, not just database rows.** `users.firebase_uid` is the join key, so
rows with invented uids would be accounts nobody can sign into — and the two-account isolation
sequence, which the demo plan calls its strongest moment, would have no accounts to run with.

**It also uses two different database roles on purpose.** `atlas_app` writes `public.users`,
`golf.player_profile` and `user_relationships` through the same policies the live app hits;
`billing_svc` writes `user_app_roles` through `withRlsBypass`. Neither role can seed alone —
`billing_svc` has no INSERT on `users`, and `atlas_app`'s policy refuses `user_app_roles`. That is
the separation of duties working, not an inconvenience to route around.

---

## 3. One Firebase project, and it matters

Red and Locker Room both authenticate against **`rypstick-ios`** — same project, same web API key,
same service account (`firebase-adminsdk-g4tfp@rypstick-ios`). Verified in both `.env.local` files.
(`ryp-red-5cc0c` in Red's `.firebaserc` is a Hosting project, not an auth project.)

Atlas therefore uses `rypstick-ios` too, and that is load-bearing: `firebase_uid` is what resolves a
person to their `public.users` row. A separate project would give the same human a different uid per
app, and every cross-app read — the entire nucleus thesis — would silently return nothing.

---

## 4. Two defects found and fixed

### Firebase Admin was broken in every consumer (eco v0.7.0)

`import * as admin from 'firebase-admin'` resolves, under real ESM, to `{ default, 'module.exports' }`
with **every named property undefined**:

```
admin.apps          // undefined
admin.auth          // undefined
admin.initializeApp // undefined
```

So `admin.apps.length` inside `firebaseAdmin()` threw on the first authenticated request — meaning
`verifyToken` could never have worked in any app that imported eco. firebase-admin is CJS and
declares those names through getters on `module.exports`, which Node's cjs-module-lexer cannot see.
The modular subpaths (`firebase-admin/app`, `firebase-admin/auth`) are real ESM exports.

`firebaseAdmin()` is now `firebaseApp()` + `firebaseAuth()`. Not shimmed under the old name — the old
name could not have worked, so nothing can depend on it.

**This is exactly what Sprint 1's dedicated test/fix day was reserved for, and it appeared on the
first hour of the first day.** eco had never been executed by an application; it typechecked, built,
and passed a schema-drift test, and none of those touch a module resolution.

### `users.plan` was self-writable

`users_update` permits a user to update their own row, and **RLS cannot exclude a column**. With a
table-wide `UPDATE` grant, any authenticated user hitting a profile-edit endpoint could have set
`plan = 'pro'` on themselves, and every rank-based gate in the ecosystem would have honoured it.

`UPDATE on public.users` is now **column-level** for `atlas_app` / `red_app` / `lr_app` —
`display_name`, `email`, `date_of_birth`, `parental_consent_at`, `updated_at` only. `plan`,
`firebase_uid`, `id`, `created_at` and `deleted_at` belong to `billing_svc` alone. Applied to
`ryp-core` and recorded in `eco/sql/rls_core.sql`.

Worth noting the general shape: **RLS answers "which rows", grants answer "which columns."** Any
"you may edit your own record" policy needs a column grant beside it, or it is a privilege
escalation waiting for an endpoint.

---

## 5. Open decisions

### 5a. How does a person get the `atlas` role? — ✅ DECIDED AND BUILT 24 Aug

A brand-new Firebase user who signs into Atlas gets a `public.users` row (`attachUser` creates it)
and then a **403** from `requireApp('atlas')`. Nothing in Atlas can fix that for itself:
`user_app_roles` writes are bypass-only by policy.

That 403 is correct — it is the reason a user cannot make themselves an admin. But it means "sign up
and use Atlas" does not exist yet.

**Chose (a): the narrow policy.** `user_app_roles_atlas_signup` pins all three columns —
`user_id = yourself`, `app = 'atlas'`, `role = 'user'` — so it can say nothing except "this person
signed up for the free front door". It cannot reach another app, cannot grant coach or admin, and
cannot grant anyone else. `atlas_app` already held the INSERT *privilege*, so this was a policy
addition rather than a grant change.

Two things keep it from being an escalation, and both are pinned by `verify:schema`:

- **UPDATE stays bypass-only**, so a self-inserted row can never be promoted. ⚠️ Note the failure
  mode when testing: an UPDATE whose `USING` fails matches **0 rows silently** — it does not raise.
  "No error" is not "it worked"; re-read the row.
- **Revocation survives.** `(user_id, app)` is unique and the app's insert is `onConflictDoNothing`,
  so a soft-deleted entitlement is left alone rather than resurrected. A `DO UPDATE` would have
  handed a banned user their access back on every sign-in.

The "your account doesn't have Atlas access yet" screen stays — it is now the *revoked* state rather
than the new-signup state.

### 5b. A coach can grant themselves read access to any player — the cross-app gate item

`user_relationships` WITH CHECK permits an insert where `actor_user_id = current_user_id`, and it does
**not** constrain `status`. `golf_profile_coach_read` grants profile read on any `coach_of` edge with
`status = 'active'`. So a coach can insert their own edge, set it active, and read that player's
profile — no consent step.

The schema already disagrees with the policy: `status` defaults to `'pending'` and there is an
`approved_at` column, i.e. the edge was designed as a request the subject approves.

Mitigating today: it needs the target's UUID, which no API returns. Not a live exposure — a design
gap. **This is the first concrete item for the "opening the gates of data crossing apps" milestone**,
which is the one flagged as hardest. The fix is to split the `FOR ALL` policy per command: the actor
may INSERT only `status = 'pending'`; only the subject may UPDATE it to `'active'`.

### 5c. Red's RLS is incompatible with the pooler

`RYP-RED/server/lib/rlsPool.ts` uses `set_config(..., false)` — session-scoped. Neon's `-pooler` host
is PgBouncer in transaction mode and drops session state, so Red's session variables do not survive
and its policies evaluate against nothing. At M2, Red either moves to the direct host or adopts eco's
transaction-local pattern. The second is correct; the first is the fast escape hatch.

---

## 6. Sprint 1 status

Verified in the browser at `:5173`, not just against the API — the dev proxy, `onAuthStateChanged`,
the login form and the profile screen are all in the tested path.

- [x] Sign in as a seeded player → profile screen shows that player's live values
- [x] **403 demonstrated, not assumed** — a throwaway Firebase user with no `atlas` role got
      `403 app_access_denied`, and a `public.users` row was still created for them
- [x] **Two-account isolation run by hand** — signed out, signed in as player 2: different UUID,
      handicap 4.2 → 17.8, carry 268 → 212, right → left, different GHIN. Zero console errors
- [x] `PATCH /api/users/me` rejects `plan` at **both** layers — 400 `unrecognized_keys` from zod,
      and `permission denied for table users` from the column grant when attempted in raw SQL as
      `atlas_app` (`firebase_uid` and `deleted_at` likewise; `display_name` succeeds)
- [x] `npm run seed` idempotent — re-run clean, resets values and password
- [x] 401 for no token and for a garbage token

Also built ahead of schedule (Mon 24 Aug), both Sprint 2 items:

- [x] **Profile editing** — `PATCH /api/users/me` had no screen; M1 says "manages their own
      profile". Created a profile from the form, confirmed the row in Postgres, cleared it back to
      nulls through the same route
- [x] **Coach roster** — `GET /api/coach/students`, and it does not re-implement the visibility
      rules: it collects candidates and lets RLS answer, so the identity/metric tiers show up as
      data rather than as `if (status === 'pending')` branches. Verified in the browser: one
      student APPROVED with her handicap history, one AWAITING APPROVAL showing the profile card
      and *"Metrics hidden until Jordan Reyes approves you"* where the trend would be

Remaining:

- [x] **5a decided and built** — a narrow `user_app_roles_atlas_signup` policy pinning all three
      columns to `(yourself, atlas, user)`, plus `ensureAtlasAccess` middleware between `attachUser`
      and `requireApp`. A brand-new account's first request now returns 200 with `atlas:user`.
      Self-granting `atlas/admin`, `atlas/coach`, `locker_room/user`, `ryp_red/user` or a row for
      anyone else are all refused, and a **revoked** account still gets 403 with `deleted_at` intact
- [ ] A lapsed coaching subscription must write `status='ended'` on the edge, or an ex-subscriber
      keeps RLS read access to their students. Nothing does that yet
- [x] ~~Luke items~~ — **moot: Luke is ideation only, not development** (Makel, 24 Aug). No clone,
      no `ryp-eco` access needed, no design port to hand him
- [ ] Decide whether `Atlas` moves to the `RYPGolf` org (still on the personal account)
- [ ] Sprint 2's remaining P0s are now **test/fix and rehearse**, plus sample-data labels if any
      sample panel gets added. Nothing sampled is on screen today — every value is live

### One incidental finding worth keeping

Port **5000 on macOS is owned by ControlCenter** (AirPlay Receiver), not by Red or Locker Room. So
the original hardcoded `/api → :5000` dev proxy was aimed at a system service that answers but is
not an API. Anything in the ecosystem still defaulting to 5000 is worth a second look.
