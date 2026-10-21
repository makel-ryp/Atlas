# Incident — Railway platform breach, 2026-10-21

**Status: open.** Railway published a security notice and a Major Outage, recommending customers
**"revoke all environment variables stored in Railway, including API keys and private registry
credentials, and review your service logs for unusual activity."** Deployments are paused,
including for Enterprise. Notice: `blog.railway.com/p/security-disclosure-wednesday-october-21st`
(status update 2026-10-21 21:59 UTC).

Every secret this project kept in Railway must be treated as exposed. Both environments —
**Testing** and **production** — are in scope.

---

## 🔴 Ranked by blast radius, not by alphabet

| # | Variable | Where | Why it ranks here |
| --- | --- | --- | --- |
| **1** | `FIREBASE_PRIVATE_KEY` + `FIREBASE_CLIENT_EMAIL` | both | Service account for **`rypstick-ios`** — the Firebase project behind the **live RYP Stick iOS app, ~28,428 real customer accounts** (`server/ensureAtlasAccess.ts` header, 2026-09-03 count). An Admin SDK private key can **mint a session token as ANY user** and read or modify every auth record in that project. Nothing else here is close. |
| **2** | `BILLING_DATABASE_URL` | both | Connects as `billing_svc`, the only role that writes `public.user_app_roles` — the bypass path for granting app access. Compromise here is self-granted admin. |
| **3** | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | both | `atlas_app` on **alpha** (Testing) and **`main`** (production). NOBYPASSRLS, so RLS still binds — but it reads and writes every Atlas surface as a legitimate app. |
| **4** | `FORGE_APP_DATABASE_URL`, `FORGE_SVC_DATABASE_URL` | Testing | `forge_app` / `forge_svc` on alpha. `forge_svc` is the elevated one (ladder + completion stage). |
| **5** | `SLACK_BOT_TOKEN` | Testing | Added 2026-10-21. Posts to `#atlas-feedback` and, with `groups:history`, **reads it** — and that channel carries screenshots of coach screens: student names, coaching notes **including the private tier**, and intake answers. Private channel; small membership. |
| — | `VITE_FIREBASE_*` | both | Client-side by design, shipped in the browser bundle. Not a secret; no action. |
| — | `ATLAS_SIGNUP_ALLOWLIST`, `NODE_ENV`, `NPM_CONFIG_INCLUDE`, `RAILWAY_*` | both | Not credentials. The allowlist is 16 colleague email addresses — disclosure, not access. |

⚠️ **Inventory caveat.** Railway's API (`backboard.railway.com`) is part of the outage and could not
be re-read while writing this. The Testing list above was enumerated from the live API earlier on
2026-10-21; **production's full list was not enumerated** — only `FIREBASE_PROJECT_ID`,
`ATLAS_SIGNUP_ALLOWLIST` and the five DB URLs were confirmed there. Re-enumerate production when
the API returns and extend this table.

---

## What was checked, and what that does and does not prove

Queried both Neon branches directly (not through Railway) on 2026-10-21:

| Check | `main` | `alpha` |
| --- | --- | --- |
| Current connections | `cloud_admin`, `neondb_owner` from `127.0.0.1` — Neon's own proxy | same, plus `::1` |
| Unexpected login roles | none | none |
| `public.users` rows | 12 | 12 |
| Rows touched in last 24h | `makel@pixelcaddie.com` (Makel's own sign-in) | `eisele.mike@gmail.com`, `makelmackbee@gmail.com` |
| New `user_app_roles` in 24h | none | `eisele.mike@gmail.com` = atlas:user, forge:user |
| `golf.drill_progress` writes in 24h | 0 | 0 |

**Every one of those is accounted for by this session's own work** — Mike's account was created
today, `makelmackbee@gmail.com` was an RLS test that was written and reverted, and the two role
grants came with Mike's account.

🔴 **This is "no sign of it", NOT "it did not happen."** `pg_stat_activity` is a point-in-time view
of *current* connections; it carries no history. Postgres is not logging connections here, so an
access that has already closed leaves nothing in these queries. Neon's own branch-level logs are
the place to look for history, and they were not consulted.

---

## The bind, and why it is smaller than it looks

Railway deployments are paused, so **a rotated value cannot reach a running app.** Rotate now and
the service breaks with no way to fix it until builds are restored.

Two things make that cheap here:

1. **Atlas has 12 accounts and all of them are internal or demo.** Breaking Atlas — either
   environment — costs no real user anything. There is no customer on Atlas to protect from an
   outage, only data to protect from an intruder.
2. 🔴 **Rotating the Firebase service-account key does not sign out a single iOS user.** The iOS app
   authenticates with the **client** SDK and the public API key; the **admin** private key is
   server-side only, for verifying tokens and minting custom ones. So the highest-value rotation is
   also the lowest user-impact one.

⚠️ **The one thing to establish before pulling that key: what else consumes it.** It is a shared
project (`rypstick-ios`), and anything else in RYP that verifies Firebase tokens server-side will
stop when the old key is deleted. Not checkable from this repo.

---

## Checklist — work through as Railway comes back

**Do now, no Railway needed:**

- [ ] **Firebase service account** — in Google Cloud console, **create a new key first**, then delete
      the old one. *Creation does not revoke; deletion does.* Atlas will break until the new key is
      deployed, which is acceptable per above. ⚠️ Confirm what else uses it first.
- [ ] **Slack bot token** — regenerate in the Slack app config. Only the feedback button breaks.
- [ ] **Review the `#atlas-feedback` channel** for anything posted that should not persist — the
      token could read its history.

**Needs a decision, then can be done from here:**

- [ ] **Neon role passwords** — `atlas_app`, `billing_svc`, `forge_app`, `forge_svc` (and `red_app`
      / `lr_app` if their URLs were ever stored in Railway). Can be reset through the Neon MCP or
      console. This breaks both environments immediately. Sequence it so the new values are ready
      to paste the moment builds return.

**When Railway restores builds:**

- [ ] Re-enumerate **production's** variable list and extend the table above.
- [ ] Set every rotated value in both environments, then redeploy both.
- [ ] Confirm a Testing sign-in **before** telling Luke to resume — a broken login mid-test is worse
      than a delayed one.
- [ ] Re-run `npm run smoke` against alpha and `node scripts/verify-schema.mjs` to confirm the new
      credentials reach the right branch with the right grants.

**Worth doing regardless:**

- [ ] Ask Neon for connection history on both branches over the exposure window — that is the only
      place a closed session would show.
- [ ] Decide whether `main` should hold real data at all while Atlas has no real users. A branch
      with nothing valuable on it is the cheapest mitigation available.

---

## Related

- The deferred Firebase rotation (T-111, *"will do later, fine for now"*) is **overtaken by this.**
  That decision was reasonable when the exposure was local disk; the key has since sat in a
  breached platform.
- `docs/operations/slack-feedback-app.md` — what the Slack token can reach.
