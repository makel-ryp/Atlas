# Atlas — the identity and data nucleus

The front door of the RYP Golf ecosystem: where a golfer signs up, and the shared profile every
other app reads from and writes to. Shared backend spine is `@ryp/eco` (`~/dev/ATR/eco`).

**Full orientation:** `~/dev/ATR/atlas/docs/HANDOFF.md` · **State:** `~/dev/ATR/atlas/docs/STATUS.md` ·
**Board:** `~/dev/ATR/atlas/docs/TASKS.md`

## Boot

```bash
npm run dev:server   # API, port 5055
```

```bash
npm run dev          # Vite client
```

## House rules

- **Do not rebuild what exists.** Luke's prototypes are ~50% of the product; strip their
  hardcoded data and wire them to the DB. **Never edit `support.js`.**
- `proto/` is Luke's prototype, vendored **unmodified first** (`27b7d4a`) so `git log -p proto/`
  is the pristine reference. Keep it that way.
- Prototype data is injected **server-side** as `window.__ATLAS_DATA__`, before his scripts run.
  Mount the asset whitelist **LAST** or it 404s the page route.
- Page routes are gated by **session cookie**; API routes by **Bearer token**. A browser
  navigation cannot carry an `Authorization` header.
- Never `select *` in a response projection. `quality_flag` and `IPIP01`–`IPIP20` are private
  to the subject and must never reach a client or a coach.
- Schema and RLS live in eco, not here. The authoritative policy record is
  `~/dev/ATR/eco/sql/rls_core.sql` — **read its inline warnings, they are load-bearing.**
- `atlas_app` has no DDL rights, so `drizzle-kit migrate` does not work. Migrations are applied
  with owner credentials via the Neon connector, plus a hand-inserted journal row.

## Keeping the docs true — non-negotiable

These docs are the handoff to whoever works next (often a different AI on a different account).
A stale doc is worse than no doc, because the next agent trusts it.

**Before you end any turn in which you changed code, schema, or config:**

1. Update `~/dev/ATR/atlas/docs/TASKS.md` — move the row you worked, or add one. Never delete rows;
   move finished work to §5 Done with the date and the evidence.
2. Update `~/dev/ATR/atlas/docs/STATUS.md` — only if what is true changed. Mark something ✅ **only**
   when you observed it work and can name the evidence.
3. Run `~/dev/ATR/atlas/docs/refresh-status.sh` to regenerate the repo-state block.

**Never** write "done", "working", or "✅" for something you did not run. A passing typecheck is
not evidence. "No error" is not success — an RLS-filtered UPDATE matches 0 rows silently.
