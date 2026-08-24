# Atlas

The identity nucleus of the RYP ecosystem — the front door where a person logs in and maintains
one profile that RYP-RED, Locker Room, Debrief and Forge read instead of each keeping a copy.

This is a skeleton: Express + Vite + React + TypeScript, with one real route (`GET /api/plans`)
proving the database path end to end. No auth wired yet.

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

## Running

Two processes in dev. The API listens on 5000; Vite serves the client and proxies `/api` to it.

```sh
npm run dev:server     # Express on :5000, loads .env.local then .env
npm run dev            # Vite on :5173, proxying /api → :5000
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
