# ATR — HANDOFF

**For an agent or developer with zero prior context.** Read this top to bottom once, then work
from [STATUS.md](STATUS.md) and [TASKS.md](TASKS.md).

---

## 0. Starting a new AI session — paste this first

Claude Code loads `CLAUDE.md` automatically. **Other tools (Codex, Cursor, ChatGPT, Copilot) do
not.** If you are not in Claude Code, the rules below are invisible unless you paste them. Send
this as the first message of any new session:

> Work in `~/dev/ATR/atlas` (the RYP Golf "Atlas" repo). Before doing anything, read
> `docs/HANDOFF.md`, then `docs/STATUS.md` and `docs/TASKS.md`. Never work in
> `~/Desktop/ATR/websites/atlas` — it is a dead stub. Do not rebuild anything listed as built in
> STATUS §2. When you change code, update `docs/STATUS.md` and `docs/TASKS.md` in the same turn and
> run `docs/refresh-status.sh`. Only mark something done if you actually ran it and can name the
> evidence.

---

## 1. The one-paragraph version

RYP Golf is building a multi-app golf coaching ecosystem. **Atlas is the identity and data
nucleus** — the front door where a golfer signs up, and the shared profile every other app reads
from and writes to. The other apps are **Forge** (Luke's, not delivered), **RYP Red**, **Locker
Room**, **Debrief**, **Inventory**, and **Practice DNA**. The long-term goal is one unified
golfer profile rich enough that a small language model can run on it as an AI coach (~2030) —
which is why naming and schema decisions are taken seriously *now*.

## 2. ⛔ The three landmines

1. **`~/Desktop/ATR/websites/atlas` is a decoy.** It is an old stub holding Luke's raw
   `.dc.html` handoff files, is not a git repo, and is not live. Some tool configurations open it
   as the working directory. **The real Atlas is `~/dev/ATR/atlas`.**
2. **Do not rebuild what exists.** The standing instruction from Makel:
   *"no more building functions and things that exist."* Luke's HTML prototypes are ~50% of the
   product. The job is to **strip their hardcoded data and wire them to the DB**, not to
   reimplement the screens. Check STATUS §2 before you build anything.
3. **Never edit `support.js`.** It is Luke's homemade mini-React (`{{ }}` bindings, `<sc-if>`,
   `<sc-for>`). It gets discarded in a real build. Leave it alone.

## 3. Where everything is

| What | Path | Notes |
| --- | --- | --- |
| **Atlas** (the app) | `~/dev/ATR/atlas` | `makel-ryp/Atlas`, branch `main` |
| **eco** (shared spine) | `~/dev/ATR/eco` | `RYPGolf/ryp-eco`, published as `@ryp/eco` |
| Luke's prototype, vendored | `~/dev/ATR/atlas/proto/` | Committed **unmodified first** (`27b7d4a`) so `git log -p proto/` is the pristine reference |
| **The RLS record** | `~/dev/ATR/eco/sql/rls_core.sql` | ⚠️ Authoritative. Read its inline warnings — they are load-bearing |
| Schema | `~/dev/ATR/eco/src/schema/` | Drizzle |
| Docs | `~/dev/ATR/atlas/docs/` | Index in `README.md` |
| Sibling apps | `~/Desktop/ATR/apps/*` | Red, Locker Room, Debrief, Inventory, Practice DNA |
| TGT (Practice DNA live site) | `~/Desktop/ATR/websites/tgt` | branch `dna` |

**Databases.** `ryp-core` is the shared Postgres (Neon) — Atlas, identity, entitlements.
`TGT-live` (Railway) holds the 118 live Practice DNA runs. Credentials are in
`~/dev/ATR/atlas/.env` — **never** commit or echo their values.

## 4. Booting Atlas

```bash
cd ~/dev/ATR/atlas && npm run dev:server
```

```bash
cd ~/dev/ATR/atlas && npm run dev
```

`dev:server` is the API (port from `PORT` in `.env`, currently **5055**); `dev` is the Vite
client. Typecheck with `npm run typecheck`. In eco, `npm run verify:schema` checks the RLS
posture — **it reads `pg_catalog`, deliberately** (see §6).

## 5. How to smoke test

Sign a demo user in against Firebase's REST endpoint with `VITE_FIREBASE_API_KEY`, then call the
API with `Authorization: Bearer <idToken>`:

```bash
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$VITE_FIREBASE_API_KEY" -H 'Content-Type: application/json' -d '{"email":"demo.player1@rypgolf.com","password":"RypDemo!2026","returnSecureToken":true}'
```

Demo users: `demo.player1@rypgolf.com`, `demo.player2@rypgolf.com` (player2 exists specifically
to prove cross-user isolation). A **browser navigation cannot carry an `Authorization` header** —
page routes like `/proto/dashboard` are gated by **session cookie**, not Bearer token.

The seven assertions the intake must pass are in STATUS §4.

## 6. Do NOT re-derive these — they cost real time to learn

**⛔ Before you design ANY coaching logic, or write any question for Luke — read
`docs/reports/PROTOTYPE-WHAT-LUKE-ALREADY-BUILT-2026-09-10.md`.**

`proto/Dashboard.dc.html` holds **33 top-level constants** that are the product spec, not sample
data: a 6-drill library with scoring rubrics and verdict functions (`DRILL_DEFS`), a 5-step build
ladder with per-step advancement criteria (`STEPS`), 3 tiers × 4 phases with full 7-day schedules
(`TIERS`), a 4-rung chipping tolerance ladder (`CHIP_LEVELS`), a carry→handicap baseline table, 28
drill rationales (`WHY`), and more.

**Luke specified the content AND the rules. Nothing evaluates them — every selector is a hardcoded
literal or a manual toggle.** We twice nearly asked him to invent something already in the file.
One grep prevents it:

```bash
grep -nE "^(const|let|function|class) " proto/Dashboard.dc.html
```

**Postgres / RLS**

- **RLS answers WHICH ROWS; grants answer WHICH COLUMNS.** A "you may edit your own record"
  policy without a column grant is an escalation waiting for an endpoint. This is how `users.plan`
  became self-writable.
- **A policy only binds if the write path does not bypass it.** `withRlsBypass` silences policies
  entirely. A per-app scoping policy once looked correct and did nothing, because the writes went
  through bypass.
- **An RLS-filtered UPDATE matches 0 rows SILENTLY.** "No error" is not success.
- **`information_schema` is privilege-filtered — use `pg_catalog`.** `verify:schema` once reported
  a table missing that existed, and worse, could not see an out-of-band table with no grant.
- **`verify:schema` must be schema-qualified.** It was once hardcoded to `public`, so from the
  moment `golf` existed it would have reported PASS with `golf.player_profile` wide open.
- `SECURITY DEFINER` helpers need a **pinned `search_path`**. The invoker versions recurse into
  `stack depth limit exceeded`.
- **`atlas_app` has no DDL rights.** Migrations need owner credentials and are applied via the
  Neon connector with a hand-inserted drizzle journal row. `drizzle-kit migrate` no longer works.
- **`ryp-red`'s RLS is decorative** — every role on that live DB is `BYPASSRLS`, so no policy binds.
- **Drizzle names EVERY column in an INSERT**, passing `default` for ones you did not set. So
  **column-level INSERT grants must cover every column in the table**, or the statement is refused
  with `42501 permission denied for table …` — which reads exactly like an RLS failure and is not
  one. This is the cause of B-1 and is a trap on every table using that grant pattern.
- **`42501` means "insufficient privilege", not "RLS refused you".** Column grants, table grants and
  RLS all raise it. Before blaming a policy, reproduce the statement by hand as the app role.

**Node / Express**

- **`firebase-admin`'s namespace import is broken under real ESM.** `import * as admin from
  'firebase-admin'` resolves to `{ default, 'module.exports' }` and every named property is
  `undefined`. Use the modular subpaths: `firebase-admin/app`, `firebase-admin/auth`.
- **Mount the prototype asset whitelist LAST.** Mounted first it 404s the page route, and the
  browser silently falls back to the SPA — which looks like the page "sort of works".
- Prototype data is injected **server-side**: serve Luke's `.dc.html` and inject
  `window.__ATLAS_DATA__` as one `<script>` before his scripts run.

**Domain vocabulary — getting these wrong corrupts the schema**

- The four practice **blocks** are `Construction`, `Calibration`, `Transfer`, **`Performance`**.
  *Speed is not one of them* — `Speed` belongs to `WORKS = ['Lift','Mobility','Speed','Rest']`.
- ⚠️ A variable literally named **`ZONES` holds the WRONG list** (it is a practice-logging picker).
  Do not read the block names off it.
- Practice DNA's result is **never stored** — it is recomputed from `answers` on every read.
- `quality_flag` and `IPIP01`–`IPIP20` (Mini-IPIP Big Five) are **private to the subject.** They
  must never appear in a response body or be exposed to a coach.

**Process**

- **Fabricated values are worse than crashes.** Stripping the prototype's hardcoded data exposed
  `hist: {}` rendering as *"Not playing"*, `target: null` rendering as **`+0`**, `"last logged
  nulld ago"`, and `who.file.limits.split()` throwing for every student. A confident wrong number
  in front of a coach is the worst outcome this project can produce.
- **A passing typecheck is not evidence that anything works.**
- A long-running agent workflow is **not** dead just because its journal looks idle. One ran 32
  minutes and completed every agent after being declared dead twice.
- Newly written agent definition files are **not visible until the session refreshes**.

## 7. People

| Who | Role | What that means |
| --- | --- | --- |
| **Makel** | Owner / director of the academy; the only developer | Has ADHD — **lead with the decision, keep answers to a few lines.** |
| **Luke** | Design & ideation | Builds `.dc.html` prototypes and is building Forge. Does **not** clone, review, or merge. |
| **Yannick** | Locker Room / Debrief | Migration asks are in `operations/YANNICK-UPDATE-PLAN.md`. |

## 8. Keeping these docs true

The rule is in [`~/Desktop/ATR/CLAUDE.md`](../CLAUDE.md) and in the Atlas repo's own `CLAUDE.md`,
so it loads automatically for any agent. In short: **if you changed code, update STATUS.md and
TASKS.md in the same turn, and run `docs/refresh-status.sh`.** A stale status doc is worse than
none, because the next agent will trust it.
