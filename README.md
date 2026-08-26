# Atlas

The identity nucleus of the RYP ecosystem — the front door where a person logs in and maintains
one profile that RYP-RED, Locker Room, Debrief and Forge read instead of each keeping a copy.

Express + Vite + React + TypeScript. Firebase sign-in is wired through eco's middleware to a
profile screen whose every value comes from `ryp-core`.

## Where the schema lives

**Atlas does not own its tables.** `@ryp/eco` owns the `public.*` identity core and the `golf.*`
shared truth layer, including their migrations and the RLS policies. Atlas is the runtime *writer*
for those rows, but the declarations live in eco and `npm run verify:schema` there fails the build
if the live database and the declarations disagree. Never add a Drizzle table for `public.*` or
`golf.*` in this repo — change it in eco and bump the pinned version in `package.json`.

Anything Atlas-private would go in its own `atlas.*` schema. Nothing needs one yet.

## Setup

```sh
npm install
cp .env.example .env       # fill in DATABASE_URL and the Firebase values
```

`DATABASE_URL` must be the Neon **pooler** URL for `ryp-core`, connecting as the `atlas_app` role.
That role is `NOBYPASSRLS`, which is what makes `force row level security` actually bind — a role
with BYPASSRLS silently disables every policy.

`@ryp/eco` is a **private** repo, so `npm install` needs your GitHub credentials to have read
access to `RYPGolf/ryp-eco`.

### Firebase

Atlas authenticates against the **`rypstick-ios`** project, which is the same project RYP-RED and
Locker Room use. That is deliberate and load-bearing: `firebase_uid` is the key into
`public.users`, so one person signing into any RYP app resolves to one row. A separate project
would give the same human a different uid per app and every cross-app read would silently return
nothing. **Do not point Atlas at a new Firebase project.**

### Demo accounts

```sh
npm run seed
```

Creates two players, a coach, a `coach_of` edge between them, and a `golf.handicap_history` row per
player — in Firebase *and* in the database, because `firebase_uid` is the join key and a row with
an invented uid is an account nobody can sign into. Idempotent; re-running resets the values and the
password.

The `coach_of` edge is seeded through the real two-step consent loop rather than one privileged
write: a coach may only REQUEST it (`status='pending'`); only the student may approve it. The seed
runs both steps as the two different users, then deliberately leaves a SECOND `coach_of` edge
PENDING, so the roster shows both visibility tiers side by side.

The script needs `BILLING_DATABASE_URL` as well as `DATABASE_URL`, and that is the interesting
part: `atlas_app` writes the users, profiles and relationships through the same policies the live
app hits, while `billing_svc` writes `user_app_roles` through `withRlsBypass`. Neither role can
seed alone — `billing_svc` has no INSERT on `users`, and `atlas_app`'s policy refuses
`user_app_roles`. Granting an entitlement is the one thing an app may not do for itself, which is
why a user cannot make themselves an admin.

## Running

Two processes in dev. The API listens on `PORT` (5055 — **not** 5000, which RYP-RED and Locker
Room both take, and all three get run at once); Vite serves the client and proxies `/api` to it.
`vite.config.ts` reads the same `PORT`, so changing it in `.env` moves both halves.

```sh
npm run dev:server     # Express on :5055, loads .env.local then .env
npm run dev            # Vite on :5173, proxying /api → :5055
```

Production builds the client to `dist/public`, which the same Express process serves:

```sh
npm run build
npm start
```

`npm run typecheck` runs `tsc --noEmit`.

## Reads and RLS

`createEcoPool()` hands back only a pool — eco publishes no unscoped Drizzle instance, because
under `force row level security` an unscoped query against a user-scoped table returns **zero
rows** rather than an error, which reads like data loss. So every user-facing query belongs inside
`withRls(pool, ctx, schema, fn)`.

`GET /api/plans` is the exception and says so at the call site: `plans_select_all` is `using
(true)` by design, so a pricing page can render before anyone logs in. It needs no user context
and no bypass. `withRlsBypass` is for trusted non-user-facing paths only (billing webhooks,
backfills) and must never appear on a route shaped by user input.

## Auth

```
verifyToken  →  attachUser(pool)  →  ensureAtlasAccess(pool)  →  requireApp('atlas')
```

The outer three come from `@ryp/eco/auth`; `ensureAtlasAccess` is Atlas's own
(`server/ensureAtlasAccess.ts`), and the order matters. `verifyToken` turns the Bearer ID token
into `req.firebaseUid` — the only place Firebase is touched. `attachUser` resolves that to the
`public.users` row, **creating it on first login**, then loads the user's `user_app_roles`.
`ensureAtlasAccess` runs next and grants a brand-new signup the free `('atlas', 'user')`
entitlement, so signing up actually gets you in — that grant lives here rather than inside eco's
shared `attachUser` because auto-granting it there would mean signing into any app grants access to
that app, exactly the gate the ecosystem is built around; Atlas is the one app where "signed up"
and "may use it" are the same statement, because it IS the front door. Only then does `requireApp`
decide.

`requireApp` is deliberately last, and `ensureAtlasAccess` sits immediately before it rather than
being folded into it, because the two answer different questions: `ensureAtlasAccess` decides
whether a NEW person is entitled, while `requireApp` enforces that entitlement for everyone —
including someone whose access was REVOKED, who passes through `ensureAtlasAccess` untouched and is
still refused here. That "untouched" is deliberate: the grant is an `onConflictDoNothing` on
`(user_id, app)` rather than an upsert, because if an admin revoked this person by setting
`deleted_at`, the row already exists — a `DO UPDATE` would resurrect it and hand a banned user their
access back on every sign-in. `DO NOTHING` returns no row, and `requireApp` 403s them the same as
ever. None of this is an escalation: the insert is scoped by `user_app_roles_atlas_signup`, whose
`WITH CHECK` pins all three columns (`user_id` = you, `app` = 'atlas', `role` = 'user'), so another
app, a higher role, or another user's row are all refused by the database, not by this file — and
`UPDATE` on `user_app_roles` remains bypass-only, so the row can never be promoted afterwards. The
client shows a 403 as its own "no Atlas access yet" state instead of an error.

### Editing your own record

`users_update` lets a user write their own row, and **RLS cannot exclude a column** — while `plan`
lives on that row. So `UPDATE` on `public.users` is granted to `atlas_app` at **column level**
(`display_name`, `email`, `date_of_birth`, `parental_consent_at`, `updated_at`); `plan`,
`firebase_uid`, `id`, `created_at` and `deleted_at` belong to `billing_svc` alone. `PATCH
/api/users/me` also omits them from its zod schema, which is `.strict()` so an unknown key is a 400
rather than a silent no-op.

Two independent layers on purpose. RLS answers *which rows*; grants answer *which columns*. A
"you may edit your own record" policy without a column grant beside it is a privilege escalation
waiting for an endpoint.

## The coach roster

`GET /api/coach/students` returns a coach's roster, and what a coach can see is answered by RLS,
not by branches in the route. Two visibility tiers, on two different policies:

- **Identity tier** — `public.users` and `golf.player_profile` gate on `coaches_or_pending()`, so a
  student's name and profile card come back as soon as a request exists, approved or not.
- **Metric tier** — `golf.handicap_history`, and every future metric table, gates on `coaches()`,
  which requires an APPROVED relationship. A pending student's trend does not come back.

The rule for anyone adding a metric table later: gate it on `coaches()`, never on
`coaches_or_pending()` — the identity tier is the one deliberate exception, not a pattern to copy.

The route does not re-implement any of this. It collects the candidate user ids — direct `coach_of`
edges plus academy co-members — and lets RLS answer for each table, which is why there is no
`if (status === 'pending')` branch anywhere in it.

A coach reaches a student through one of two paths: an approved `coach_of` edge, or shared academy
membership via `org_memberships`. The academy path has no separate consent step because the
membership assignment IS the consent — those writes are bypass-only, made by staff, not by a
player accepting a request.
