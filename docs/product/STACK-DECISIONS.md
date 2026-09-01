# Login, payment, storage — decision sheet

**2026-08-19, revised.** Every current-state claim was read from the code, not inferred.
Companion to `ECOSYSTEM.md`; the database is already standing (see the `ryp-core` notes).

> **Revision note.** A deeper pass on payment corrected three things in the first draft:
> the **£/$ price ladder has no basis in the repo** (§2.0), **the roles being `NOLOGIN` is the top
> blocker, not a footnote** (§0), and **the plan gate's comparison semantics** — not the tier names —
> are what actually block a tier ladder (§2.2, now fixed in eco `v0.4.1`).

---

## 0. 🔴 The nearest-term blocker

**All four Postgres roles have `rolcanlogin = false`.** `atlas_app`, `red_app`, `lr_app` and
`billing_svc` exist, are `NOBYPASSRLS`, hold correct per-table grants, and are protected by 30
policies — and **nothing can connect as any of them.** The entire security model is provisioned and
unreachable.

Nothing downstream can happen until this is fixed: no entitlement write, no feature-flag seed, no
Atlas login provisioning, and neither Red's nor Locker Room's migration onto `ryp-core`.

```sql
alter role atlas_app   login password '<from-secret-manager>';
alter role red_app     login password '<from-secret-manager>';
alter role lr_app      login password '<from-secret-manager>';
alter role billing_svc login password '<from-secret-manager>';
```

Reversible in one statement each. **`billing_svc`'s credential must live in exactly one process and
never in a request-path config** — the whole point of it is that a compromised request path cannot
grant entitlements. And when a write fails, check `pg_roles` before debugging application config.

---

## 1. LOGIN

### What is actually true today

| App | Sign-in method | Session | Verified at |
| --- | --- | --- | --- |
| **Red** | email + password only | Firebase ID token as `Bearer` (SPA) | `verifyIdToken` |
| **Locker Room** | email + password only | Firebase ID token as `Bearer` (SPA) | `verifyIdToken` |
| **Debrief** | **email OTP** (`signInWithOtp` + `verifyOtp`) | **cookies, SSR** (`createServerClient` in `middleware.ts`) | Supabase |

**No Google, no Apple, no phone, no magic link anywhere.** Debrief differs on both axes — method *and* session model — which is the whole of the login problem.

Also live: Red reads legacy profile data from the **`rypstick-ios` Firestore** `users/{uid}` document (`server/routes.ts:216-238`). That is the only Firestore dependency in the ecosystem.

### Decide now

**1.1 — Session model. Recommend: ID token in a header as the default, session cookies for SSR, both from eco.**

Red, Locker Room and Atlas-as-SPA all work with `Authorization: Bearer <idToken>`, which eco's `verifyToken` already does. Debrief is Next.js and genuinely needs a cookie, because SSR renders before any client JS runs. Firebase supports this directly: `createSessionCookie` on login, `verifySessionCookie` per request.

So eco grows a second verifier and both apps share one identity layer:
- `verifyToken` — header, for SPAs *(exists)*
- `verifySessionCookie` — cookie, for Next.js *(to add)*

Both land on the same `req.firebaseUid`, so `attachUser` and `requireApp` are untouched. **Reversible** — adding the second verifier is additive.

**1.2 — Sign-in methods. Recommend: email + password, plus Google, as the ecosystem standard.**

Email+password already works in two of three apps, so it is the least disruptive baseline. Add Google because it removes the largest signup drop-off and Firebase gives it for free.

⚠️ **Debrief's OTP is the exception to resolve.** It was a deliberate choice (magic links reportedly broke something), and Firebase's email-link is the same mechanism that broke. Converting Debrief's users to email+password is a real UX change for real users. **Ask Yannick before assuming it converts** — an OTP flow can be preserved on Firebase, it is just more work.

**1.3 — Roles stay in Postgres, not in Firebase custom claims. Recommend: state this as a rule so nobody "optimises" it later.**

Custom claims travel in the token and are cached until it refreshes — up to an hour. That means a revoked entitlement keeps working for up to an hour, and `user_app_roles.deleted_at` becomes advisory. Reading roles from Postgres costs one query inside a transaction we are already opening for RLS. **One-way door if we get it wrong**, because once clients depend on claims, removing them is a breaking change.

### Decide later

| Question | Trigger |
| --- | --- |
| Account linking (same human, Google + password) | first user complaint about a duplicate account |
| Legacy RYPstick users: what entitlement do they get on first Atlas login? | before any RYPstick-to-Atlas announcement |
| Retire the Firestore profile read, or port it into `golf.player_profile`? | when Red's R3 lands |
| University SSO for academies | first academy that asks |

---

## 2. PAYMENT

### 2.0 ⚠️ The price ladder has no basis in the repository

The first draft of this sheet repeated a **$99–$799/mo** range. **That figure appears nowhere** in
any code or document in the tree — it came from an old Atlas analysis and I restated it as fact.

The only actual pricing research in the repo (`apps/debrief/docs/competitive-landscape-2026-07.md`)
recommends **$59.99–$99.99 per YEAR** and explicitly names a **"$60 category ceiling"**, citing
Centered Golf at $59.99/yr, DECADE at ~$8/mo and Headspace at ~$69.99/yr. That is a **12–160×** gap
against $99–$799/mo. **The tier mapping is unanswerable until this is resolved, because the price
point spans two orders of magnitude.**

One reading reconciles it, and the schema already supports it: **$99/mo is credible as a top
individual tier; $799/mo is credible as an academy licence** (~15 seats at ~$53/seat). `organizations`
carries its own `plan` separately from `users.plan` precisely so an org can be priced differently
from a person. If that is the intent, nothing is wrong — but it needs saying out loud, because
launching individual tiers at an academy price means later migrating paying customers between a
personal subscription and an org subscription: different tables, different seat logic.

Also worth knowing: **Locker Room's academy revenue figures are fabricated seed data**
(`revenue: 24000`, `dau: 34`, `compliance_rate: 92` in `server/seed.ts:173-179`). Any projection
built on those is built on fiction.

*(Premise correction: Debrief's `register-4-tier-b-proposal.md` is a **clinical safety** document
about handling disclosures of imminent danger — not a pricing proposal. Debrief has no billing
surface at all.)*

### What is actually true today

Red is the only implementation, and it is **switched off end-to-end** — `BILLING_ENABLED` gates the
client off unless `VITE_BILLING_ENABLED === 'true'`, the UI reads "Pro tier launching in Phase 2",
and the server 503s without `STRIPE_SECRET_KEY`. Keep that kill switch; Atlas will want it too.

- **Three routes**: checkout (subscription mode, monthly|annual price from env), billing portal, webhook. Stripe SDK 22.1.1.
- **Signature verification is correct** — `constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET)`, with raw bytes captured by the `express.json` `verify` hook. Copy this verbatim.
- **Three events only**: `customer.subscription.created` / `.updated` / `.deleted`.
- **Two prices**: `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL` — one Pro tier, no ladder.
- **It never writes `user_app_roles`.** Payment and app entitlement are entirely disconnected today.
- **Live data**: 23 users, **0 with a Stripe customer id, 0 with a subscription id**, and all 20 `pro` accounts are `subscription_status = 'admin_override'`. **Red has never charged anyone.**

### Five defects in the current webhook

Fix these before reusing it — they are not stylistic:

1. **`subscription_current_period_end` is written NULL on every sync.** Stripe moved
   `current_period_end` off `Subscription` onto `SubscriptionItem`, and the SDK pins API version
   `2026-04-22.dahlia`. An `as unknown as { current_period_end?: number }` cast at `stripe.ts:41`
   silenced the compiler, so the read yields `undefined`. Use
   `subscription.items.data[0].current_period_end` — and note a subscription with mixed billing
   intervals has more than one item, so "first item" is itself an assumption.
2. **It returns HTTP 200 when it matches zero users.** The update is `where stripe_customer_id = …`
   and the response is unconditionally `{received:true}`. A Customer created outside the checkout
   flow pays and gets nothing, with a green tick in the Stripe event log. **Fail loudly (500)** so
   Stripe retries and the failure is visible.
3. **No ordering guard.** Stripe does not guarantee event order, so a retried older `.updated` can
   overwrite newer state or resurrect a cancelled subscription. ⚠️ **Do not reach for an event-id
   dedupe table** — duplicate delivery is already harmless here because the sync overwrites with
   identical values. The fix is comparing the event timestamp or subscription version against the
   stored row.
4. **The identity fix is half-built and unused.** Checkout already writes
   `subscription_data.metadata.userId`, but the webhook only ever matches on customer id. Resolve by
   `metadata.userId` first, customer id as fallback, hard-fail if neither resolves.
5. **`customer.subscription.deleted` unconditionally sets `plan = 'free'`.** Combined with the
   `admin_override` path, any Stripe cancellation on that customer silently erases a staff comp.

Two more, adjacent: a **120-request/15-minute per-IP rate limiter sits in front of the webhook** —
Stripe delivers from a pool of IPs and bursts on retries, and rate-limiting a signature-verified
endpoint buys very little. And **`checkout.session.completed` is unhandled**, so one-time purchases
would never be recorded and `content_entitlements` would stay permanently empty.

### Decide now

**2.1 — One Stripe account, Atlas as seller of record. Recommend: yes, and there is nothing to migrate.**

Verified against the live database rather than the code: zero Stripe customers, zero subscriptions.
The "what happens to Red's existing customers" question has no subject. Use Product + Price objects
whose metadata says which app a purchase entitles, one Customer per human keyed to `public.users.id`,
one webhook endpoint. Stripe Connect only if coaches are ever paid out directly.
**Splitting one account later is genuinely painful** (Customers cannot be moved between accounts);
deciding now, at zero customers, costs nothing.

**2.2 — Plan gates must compare RANK, not equality. ✅ Done in eco v0.4.1.**

This was the real blocker, and it is easy to mistake for a naming question. Red gates on literal
string equality in **two** places — `requirePro.ts:8` (`plan !== 'pro'`) and `feature-flags.ts:89`
(the `locked` computation). Under equality, a tier ranked *above* `pro` **fails every flag marked
`pro`** — the highest-paying account silently loses access.

eco now exports `PLAN_RANK` and `planAtLeast(userPlan, required)`, failing closed on an unrecognised
plan. Red's two gates become `requirePlan('pro')` and a `planAtLeast` call. **Cheap now** (two
functions, six flag rows, zero customers); expensive after launch, when changing gate semantics
means changing access for real subscribers.

**2.3 — One webhook, owned by Atlas, writing through `billing_svc`.**

It must: verify the signature (reuse Red's), resolve identity by metadata, upsert
`billing_subscriptions`, set `users.plan`, grant/revoke `user_app_roles`, and be safe to replay.
Add `checkout.session.completed` and `invoice.payment_failed`; handle `charge.refunded` or a
refunded customer keeps access indefinitely.

**2.4 — Separate identity provisioning from billing. Recommend: split on *why* the row is written.**

"Only `billing_svc` writes `user_app_roles`" is right for money but under-specified for identity —
and Red proves it. **Four of its five write sites are identity, not billing**: `auth.ts:120`
(auto-provision), `routes.ts:158` (signup), `routes.ts:370` (per-app delete), `routes.ts:399`
(reactivate). Only a purchase-driven grant is billing.

So: a named provisioning path uses `withRlsBypass` with an explicit reason, restricted in code to
the caller's own user and roles in `['user','player']`; `billing_svc` owns tier grants, revocations
and org seats. **Do not "fix" this with a policy permitting self-insert** — that is exactly the
escalation that was just closed.

**2.5 — Replace the `admin_override` sentinel. Recommend: yes, and you must anyway.**

All 20 `pro` accounts are `admin_override`, and **none can survive the move** — `ryp-core`'s
`users` has no `subscription_status` column at all. Keep the enum value for compatibility, but make
the real record a `billing_subscriptions` row with `provider='manual'`, the plan it confers, an
optional expiry, plus who granted it and why. That also fixes defect 5 above.

**2.6 — Enable Stripe Tax before the first charge.** A checkbox now; a back-taxes problem later.
Digital-goods VAT applies from the first international sale. **This is the one asymmetric item** —
retroactive tax registration cannot be fixed forward.

### Decide later

| Question | Trigger |
| --- | --- |
| Trial vs freemium — the webhook already treats `trialing` as entitled, and `trial_will_end` is unhandled | before offering a trial |
| Proration on upgrades | the second paid tier exists |
| Dunning — configure Smart Retries in the dashboard (no code) | first real payment fails |
| Coaching credits: add a redemption **ledger**, not just the `credits_used` counter — an increment is not idempotent and cannot support a partial refund | before selling coaching |
| Server-side enforcement of the free round cap — `FREE_TIER_ROUND_CAP = 3` is **client-side only** and its own comment calls it "a UX hint, not a hard gate". Anyone with devtools has unlimited rounds | if round count is a paid boundary |
| Manual invoicing for academies | first academy |

### Red will not compile against `ryp-core`

Two concrete breakages to expect, both consequences of decisions already made:
- `stripe.ts` reads and writes `users.stripeCustomerId` (lines 83, 93, 124, 134). **That column does
  not exist in `ryp-core`** — customer id now lives in `billing_subscriptions`.
- `seedDefaultFlags()` (`feature-flags.ts:57-61`) inserts without an `app` value and **will fail on
  the NOT NULL column**, since `feature_flags` is now keyed `(app, key)`. Its admin PATCH route keys
  on `key` alone too.

## 3. STORAGE

### What is actually true today

**There is no R2 or S3 client anywhere in the ecosystem yet.** This is genuinely greenfield except for Debrief.

| App | Reality |
| --- | --- |
| **Debrief** | Two Supabase buckets. `audio` (uploaded **server-side** in `app/api/transcribe/route.ts:33`, deleted by a cron on a grace-day window tied to `deletion_requested_at`) and `feedback` (screenshots, served by `createSignedUrl`) |
| **Red** | **Persists nothing.** `scan-card.ts` and `feedback.ts` take images, process them in-memory, and discard. No bucket, no writes |
| **Locker Room** | `avatar` is a plain `text` URL column — no managed storage |
| **Atlas** | Not built. Its design implies drill video, book/course assets, and share cards |

⚠️ **Debrief's signed URLs have a 30-day TTL** (`SIGNED_URL_TTL = 60 * 60 * 24 * 30`). A 30-day signed URL is a public link for a month — if it leaks, into an email, a log, a Slack paste, it stays live. Worth fixing on the way past.

### Decide now

**3.1 — R2 for everything except video; Cloudflare Stream for video. Recommend: this split.**

R2 is object storage with zero egress fees, which is ideal for audio, images, PDFs and course assets. But it only stores and serves bytes. Raw phone swing video is large, in device-specific codecs, and needs transcoding plus adaptive bitrate to play reliably — that is Cloudflare **Stream**, a different product with per-minute pricing.

| Media | Where | Why |
| --- | --- | --- |
| Voice notes (Debrief) | **R2** | small, played once, zero egress matters |
| Screenshots, avatars | **R2** | trivial |
| Book / course assets, share cards, PDFs | **R2** | static, cacheable |
| **Swing / drill video** | **Stream** | needs transcode + HLS; shipping raw MP4s from R2 will play unreliably |

Rough cost shape — **estimates, verify against current pricing:** R2 is ~$0.015/GB-month with no egress, so Debrief-style audio at 1,000 active players is single-digit dollars a month. Stream is ~$5 per 1,000 minutes stored plus ~$1 per 1,000 minutes delivered, so video cost tracks *watching*, not storing, and grows cumulatively as a library builds. At 100 players it is rounding-error; at 1,000 players with real video use it becomes the largest line item in the stack.

**3.2 — One bucket per app, keys prefixed by user. Recommend: `ryp-{app}` with keys `{user_id}/{yyyy}/{mm}/{uuid}.{ext}`.**

Per-app buckets mean an app's credentials cannot reach another app's objects — the storage analogue of "one app writes one schema." The `user_id` prefix makes erasure a prefix delete you can verify by listing.

**3.3 — Uploads through the server; reads via short-lived signed URLs minted after an RLS check. Recommend, and make the TTL minutes not days.**

R2 has no concept of your users, so **every** access decision happens in your app. The convention:
- **Upload**: client → your server → R2. The server knows who the caller is before the object exists, so it controls the key. Debrief already does this — keep it.
- **Read**: the server does an RLS-scoped ownership check, *then* mints a signed URL with a **~5 minute** TTL.
- A coach reading a player's media authorises through `public.user_relationships`, the same edge the database policies already use.
- **Never persist a signed URL** anywhere — not in a table, not in an email. Mint on demand.

The failure mode to design out is treating an unguessable URL as access control. It isn't; it is a bearer token with no expiry unless you give it one.

**3.4 — Erasure must delete objects, and prove it. Recommend: the app that owns the bucket does it, driven by `deletion_requests`.**

`public.deletion_requests` records the request; something has to act on it. Because keys are user-prefixed, deletion is a prefix delete followed by a listing that returns empty — which is the evidence. Debrief's existing grace-day cron is the right shape; generalise it.

### Decide later

| Question | Trigger |
| --- | --- |
| Retention per media type (how long do voice notes live?) | before real users, and **needs legal input** for Debrief's clinical content |
| Whether Atlas stores swing video itself or keeps Parallax's `videoRef` | when Atlas shows video in-product |
| CDN / custom domain for public course assets | first public-facing asset |
| Thumbnail and poster generation | when a video library exists |

---

## 4. Where the three collide

These are the cross-cutting cases that break if the three stacks are designed independently:

1. **Erasure touches all three.** A `deletion_request` must cancel the Stripe subscription, revoke `user_app_roles`, soft-delete the `users` row, *and* prefix-delete objects in R2/Stream. One orchestrated path, or data survives in a bucket after the account is gone.
2. **Signed URLs depend on the session model.** Minting requires a verified identity, so Debrief's cookie session and the SPAs' bearer token must both resolve to the same `req.user` before any storage code runs. That is why 1.1 comes first.
3. **Org billing depends on org membership, which depends on identity.** Academy access is `organizations` + `org_memberships`, so effective-access must consider org before a webhook can grant anything.
4. **Entitlement revocation is only as fast as the slowest cache.** This is exactly why roles stay in Postgres (1.3) rather than in a token that outlives the revocation.

## 5. Build order

1. **Enable LOGIN on the four roles** (§0) — one statement each, and it unblocks everything else
2. ✅ **Plan gates compare rank** — done in eco `v0.4.1` (`PLAN_RANK`, `planAtLeast`)
3. **Resolve the price ladder** (§2.0) — individual vs academy — then the tier mapping and the seed
4. **eco: add `verifySessionCookie`** beside `verifyToken` — unblocks Debrief, no change to the SPAs
5. **Atlas's single webhook** through `billing_svc`: the five defect fixes, plus
   `checkout.session.completed`, `invoice.payment_failed` and `charge.refunded`
6. **Enable Stripe Tax** before the first charge (§2.6)
7. **Red stops writing billing**; its two gates move to `planAtLeast`; `seedDefaultFlags` gains `app`
8. **R2 buckets + a sign-on-demand helper in eco** (short TTL), so every app shares one implementation
9. **Erasure orchestration** across subscription, entitlement, row and objects
10. **Cloudflare Stream** only when video actually ships
