# ATLAS — full project readout

**2026-09-30.** Produced by two parallel surveys with adversarial verification, plus direct
checks against the live database and the running app. Counts below were executed or queried, not
estimated. Where a survey and a verifier disagreed, the verifier won and the correction is noted.

Companion: **`FORGE-CONTEXT.md`** — the Forge package in detail.

---

## 1. Where the project actually is

Atlas is a working product with a real backend. The player can log practice, ask a coach to review a
rep, and message them; the coach can judge drills, write notes, and reply. All of it is enforced in
the database rather than the UI, and all of it is tested against production.

**What it cannot yet do** is prescribe. No coach can assign a drill, change a tier, or alter a
prescribed week — there is no assignment table anywhere. That is the single biggest functional gap,
and Forge has just delivered a design for it.

---

## 2. The data layer — real and binding

| | |
| --- | --- |
| Tables live in ryp-core | **23 + 1 view** (public 15, golf 5, atlas 3) |
| RLS policies | **72**, and **23 of 23 tables are ENABLE + FORCE** |
| App roles | **4** — `atlas_app`, `red_app`, `lr_app`, `billing_svc` |
| All four `rolbypassrls` | **false** — so the policies genuinely bind |

That last line is the one that matters. In ryp-red every role is BYPASSRLS and the policy file is
decorative; here it is not. Verified by live query.

**Row counts:** users 12 · user_app_roles 10 · user_relationships 9 · drill_progress 30 ·
handicap_history 14 · player_profile 8 · intake_submissions 8 · practice_sessions 5 ·
coaching_notes 3 · drill_review_requests 2 · **messages 0** · coach_profiles 1. Ten tables hold
zero rows.

### Column grants are doing work RLS cannot

RLS scopes rows; it cannot scope columns. Four separate escalations are closed by grants alone:

- `public.users` — `plan` unreachable by any app role (billing_svc only)
- `golf.practice_sessions` — `session_date` withheld from UPDATE, so a player cannot walk a session
  forward to manufacture a streak
- `golf.drill_review_requests` — `user_id`/`drill_id` withheld, so a request cannot be re-pointed
- `atlas.messages` — UPDATE granted on `read_at` alone, so a sender cannot edit a sent message

### 🔴 Open holes in the data layer

1. **`red_app` and `lr_app` hold TABLE-LEVEL INSERT on `public.users`** — covering `plan`,
   `parental_consent_at`, `deleted_at` and `id`. `atlas_app` was narrowed to 5 columns; these were
   deliberately left because RYP-RED owns 16 columns on that table and its cold-start path cannot be
   tested from here. **Needs an owner outside Atlas.**
2. **Grant drift on `atlas.intake_submissions`** — production holds TABLE-LEVEL INSERT for
   `atlas_app`, so `quality_flag` is writable despite the schema documenting it as withheld. The
   file and the database disagree.
3. **`rls_core.sql` is not re-runnable** despite its own header saying it is.
4. **No `forge_app` role exists**, and `drill_progress.ticked_at` / `watched_at` — the two columns
   reserved for Forge — have **no writer in any role**.

### ⚠️ Caused by me, this week

**Migrations 0007, 0008 and 0009 are applied to production but have no journal row.** I applied them
statement-by-statement through the Neon API rather than through `drizzle-kit migrate`, so drizzle's
view of production is three migrations behind reality. The tables are correct and verified; the
bookkeeping is not. This needs reconciling before anyone runs a migration normally.

---

## 3. The server

**10 routers, 34 endpoints** (+ `/health`): admin 10 · intake 4 · notes 4 · proto 4 · me 3 ·
coach 3 · messages 3 · plans 1 · review 1 · practice 1.

The identity chain, in the one order that works:
`cookieOrBearer → attachUser → ensureAtlasAccess → requireApp('atlas') → requireConsent`

Two endpoints are deliberately **not** consent-gated — `GET /users/me` and
`POST /users/me/date-of-birth` — because they are how an account answers the gate. Gating either
would make the only exit from the gate sit inside it. A smoke check enforces that.

---

## 4. The player surface

**7 of 12 rail screens shown**, 5 hidden. Hidden: `intake`, `evidence`, `fitnessScreen`,
`transfer`, `perf`, `roster`.

Transfer and Performance are hidden because every number on them came from `state.forge`, a
hardcoded demo seed that no code path overwrites. The screens are intact and return the day Forge
produces a real index.

### 🔴 Found today, and it corrects a claim I made

**The Tomorrow card on Today was still reading that same seed.** It printed a strokes-gained leak
("Driving −1.2 SG"), a named weakest facet, and three prescribed blocks — identical for every
golfer, on the most-seen screen in the product.

I reported T-103 as clearing "the last of the fabrication class." **That was wrong.** This was
missed because Transfer and Performance are whole screens on the `hidden` list, and this is one card
inside a screen that is otherwise real. Now gated, with an honest line in its place, five smoke
checks, and a check that every `state.forge` reader is behind a gate.

---

## 5. The coach surface

Real and narrow. A coach can **judge, annotate and message** — and nothing else.

**5 coach→student write endpoints across 3 tables:** drill verify (`golf.drill_progress`), note
create/edit/soft-delete (`atlas.coaching_notes`), and message send/read (`atlas.messages`).

One coach action writes **two rows in one transaction**: the drill, then the `plan:step-N` rollup —
and both directions, so unticking a drill un-signs the step.

**A coach cannot:** assign a drill, change a tier or phase, alter a prescribed week, or recruit a
student. `public.user_relationships` and `public.coach_profiles` have policies and grants but **no
write surface at all** — all 9 relationship rows came from the seed. So `app_private.coaches()`,
which every cross-user policy calls, currently rests on seed data, and the academy fallback
(`org_memberships`) has zero rows.

---

## 6. Testing

**5 gates, 265 assertions.** Smoke 171 (runtime, 19 sections) · e2e 42 across 4 suites ·
eco verify-schema 73 · Forge's own math tests 57.

The direction of travel is from grepping toward **executing**: sections K, M, P, R and S compile or
run the prototype's own functions rather than pattern-matching them. That is what caught the
phase-4 prose scraping and the clock's dominant-zone bug.

### ⚠️ Three weaknesses in the harness, all mine

1. **Nothing runs in CI.** There is no `.github/`. Every gate is run by hand.
2. **`devSession`'s production guard can never fire.** It throws when `NODE_ENV === 'production'`,
   and no npm script sets `NODE_ENV`. The guard is decorative.
3. **Split brain in the e2e suites.** They WRITE over HTTP to `ATLAS_BASE` but READ and assert
   in-process against `.env`'s `DATABASE_URL` — so they can silently test two different databases.
   `e2eMessages` says "run against a BRANCH, never production" and temporarily rewrites a seeded
   student's date of birth, and **nothing enforces that rule.**

---

## 7. What is open

**97 task rows: 50 done, 43 open, 4 frozen.** Of the 43 open: 27 are mine, 8 are Makel's, 4 are
Luke's, 2 need eco, 2 need counsel.

### The decisions only Makel can make

| | |
| --- | --- |
| 🔴 **One backend or two?** | Forge is specified on Supabase with its own `players`, `coach_players`, `coach_notes`. **Gates everything else.** (T-105) |
| 🔴 **Transfer / Performance** | Hidden. Empty the fabricated seed, or wait for Forge? (T-91) |
| 🟡 **What counts as consent** | COPPA wants *verifiable* consent under 13; email attestation is proportionate for 13–17. Counsel's call. (T-16) |
| 🟡 **verified vs signed-off** | Answered — two facts, second derived. Built. |

### Waiting on Luke

- **Competitive Phase 3 is called "Transfer Introduced" and names Transfer on zero of its seven day
  labels.** Label wrong or week wrong — one line either way.
- Fitness programme content: the five rows are titles with no exercises behind them.
- The drill library question, now partly answered by Forge's own six-drill set.

### Needs an owner outside Atlas

- `red_app` / `lr_app` table-level INSERT on `public.users`.

---

## 8. What Forge changes

Forge delivering **does not create a writer for anything.** It persists to
`localStorage['forge.v5']`, makes zero network calls, and has no identity. Of the 13 `golf.*` tables
METRIC-MAP assigns it as read dependencies, **exactly one exists.**

What it does deliver: a **real scoring module** (337 lines, pure, 56/57 fixtures), an **assignment
design** that is the `atlas.prescriptions` shape Atlas has been missing, and **answers to two of the
three formula conflicts**. See `FORGE-CONTEXT.md`.

⚠️ `build/forge-math.js` is referenced by **zero** of the three `.dc.html` files — the shipped
screens run their own duplicated copies. So the tested module is not the code that renders.

---

## 9. Confidence

Everything in §2 was queried against the live database. §3–§6 counts were executed or read directly.
Both surveys had every lane returned `holds=false` by their verifier on first pass — the corrections
are folded in above, and the places where detail is thinner are called out rather than smoothed
over. Specific line-level claims about the 5,100-line Forge player app are the least settled
material here.
