# Shared brief — read this first

Every agent on the Atlas metric pipeline reads this before doing anything. It exists so the same
facts are not restated in five prompts and allowed to drift apart.

---

## 1. What is being built

Six apps around one shared Postgres (Neon, project `ryp-core`), with row-level security actually
enforced. The product thesis, in Makel's words:

> "Luke has built this with the idea that each app will be their own but there's a lot of correlating
> metrics that can be supplied by other apps, AND more importantly allow us to build a really robust
> profile of a golfer from top to bottom combining all the data from each app. Eventually we want to
> run a small language model on our db that can act as an AI coach but that's a 2030 plan."

| App | Where | State |
| --- | --- | --- |
| **Atlas** | `~/dev/ATR/atlas` | Being built. Identity nucleus + coach dashboard. Express + Vite + React + Drizzle |
| **@ryp/eco** | `~/dev/ATR/eco` | Shared package. **Owns migrations for `public.*`, `golf.*`, `atlas.*`** |
| **RYP-RED** | `~/Desktop/ATR/apps/RYP-RED` | Live. The on-course caddie |
| **Locker Room** | `~/Desktop/ATR/apps/locker-room` | Live. Academy/team management. Yannick's |
| **Debrief** | `~/Desktop/ATR/apps/debrief` | Live in prod. Voice post-round reflection. Yannick's. Next.js + Supabase |
| **Practice DNA** | `~/Desktop/ATR/apps/practice-dna` | Separate project mid-launch. App deferred; **its vocabulary is not** |
| **Forge** | not built | Luke's. The player practice PWA |

⚠️ Those app copies are SNAPSHOTS and some are stale. Check dates before trusting them, and say when
a conclusion rests on possibly-stale code.

## 2. The prototypes are a spec for the SCREENS, not the DATA MODEL

`~/Desktop/ATR/websites/atlas/handoff/Golf coaching website project/` — `Atlas.dc.html` (site),
`AtlasPlayer.dc.html` (Forge PWA), `Dashboard.dc.html` (coach), `Brand Guide.dc.html`,
`Atlas Handoff.dc.html` (the index), `BookCover.dc.html`, `Atlas Team - Directions.dc.html`.

They render through `support.js`, a toy framework that is **discarded** in a real build. The product
model lives in the inline `<script>` data literals, not the markup.

**Each prototype is a silo that hardcodes its own copy of the same fictional player.** Where a
prototype computes or stores a metric another app measures, the correct answer is a READ FROM THE
SHARED LAYER — that is a reconciliation, not missing work. Say which it is, every time.

None of the hardcoded people are real (confirmed by Makel, 2026-08-28).

## 3. What actually exists in `ryp-core` today

Do **not** assume anything in `METRIC-MAP.md` is built. It is a proposal. Built means:

- `public.*` — users, user_app_roles, user_relationships, coach_profiles, feature_flags, plans,
  organizations, org_memberships, terms_acceptances, app_invites, billing_subscriptions,
  content_entitlements, coaching_credits, deletion_requests, admin_audit
- `golf.*` — **only** `player_profile` and `handicap_history`
- `atlas.*` — **only** `coaching_notes`
- **No `ryp_red`, `forge`, `locker_room` or `debrief` schema exists.**

## 4. The three metric classes — pinned definitions, use these words exactly

| Class | Means | Test | Example |
| --- | --- | --- | --- |
| **MEASURED** | An instrument or external system produced it | Could a machine disagree with a human about it? | launch-monitor carry, GHIN handicap, Arccos strokes gained |
| **ENTERED** | A human typed or chose it, stored as given | Is it someone's assertion? | self-reported handicap, target handicap, handedness, a coach note |
| **DERIVED** | Computed from other metrics | Does it change when an input changes? | composite index, transfer gap, awareness score, any strokes-gained we compute |

A metric that is measured by one app and typed in another is **two metrics with one name** — the
worst case, and common here. Say so rather than picking one.

## 5. Rules that constrain every answer

1. **Shared schemas, per-table writers.** `public`/`golf`/`atlas` are shared. Writers are assigned
   PER TABLE, never per schema. An app-private schema is readable by nobody else.
2. **RLS is the enforcement, not app code.** Every table `enable` + `force` row level security. App
   roles are `NOBYPASSRLS`. A policy that a bypassing write path can skip is decorative.
3. **RLS answers WHICH ROWS; grants answer WHICH COLUMNS.** A "you may edit your own record" policy
   without a column grant beside it is an escalation waiting for an endpoint.
4. **No request-time chokepoint.** One app being down must not break another. Cross-app writes go
   through an async, retrying ingest, not a synchronous call.

### The RLS vocabulary that already exists — reuse it, do not invent a parallel model

`app_private.current_user_id()` · `firebase_uid()` · `rls_bypass()` · `is_app_admin(app)` ·
`plan_at_least(plan, required)` · `coaches(subject)` (approved coach OR academy staff) ·
`coaches_directly(subject)` · `coaches_via_academy(subject)` · `coaches_or_pending(subject)`
(identity tier) · `coached_by_or_requested(candidate)` (the mirror) · `is_org_staff(org)` ·
`coach_requested(subject)`.

Established patterns: identity tier vs metric tier (`coaches_or_pending` vs `coaches`);
entitlement writes are bypass-only via `billing_svc`; per-app admin authority via `is_app_admin(app)`;
soft delete everywhere, never DELETE.

## 6. Rules the 2030 language-model plan imposes NOW

Not a far-future note — these are cheap today and expensive later.

- **One name, one meaning.** A model cannot disambiguate collisions. Resolve a clash when the SECOND
  producer appears, never after. Known live collisions: **Forge** (4 referents), **Tier** (6),
  **Index**, **Session**, **DNA**, **Zone vs Phase**, **Archetype**, **S.C.O.R.E.**
  (⚠️ Locker Room's and Debrief's are **incompatible — DO NOT MERGE**).
- **Provenance is mandatory** — `source_app`, `measured_at`, and a `*_version` on anything derived.
  Without it a stored result is uninterpretable after the instrument changes, and an estimate reads
  as a measurement.
- **Append-only beats overwrite** — current value on the profile, trail in a history table, rows
  never updated. `golf.player_profile.handicap_index` + `golf.handicap_history` is the pattern.
- **One metric, one table.** `golf.player_metrics (user_id, metric_type, value, source, measured_at,
  ref)` is the highest-leverage table in the plan and is NOT built yet.

## 7. The four zones — a record, not an enum

`BLOCKS = ['Construction','Calibration','Transfer','Performance']` (verified in `Dashboard.dc.html`).

⚠️ The fourth is **Performance**, not "Speed". Speed belongs to a different array,
`WORKS = ['Lift','Mobility','Speed','Rest']`, the fitness axis.

⚠️⚠️ **A TRAP: the variable named `ZONES` is NOT the zones.** `Dashboard.dc.html` holds two different
four-item arrays that share three names:

| Array | Line | Contents | What it actually is |
| --- | --- | --- | --- |
| `BLOCKS` | 2459 | Construction · Calibration · Transfer · **Performance** | **the real zones** — the curriculum model. Corroborated by the site, where zone 04 is THE ARENA |
| `ZONES` | 3433 | construction · calibration · transfer · **speed** | a practice-LOGGING picker — *where* you practised (Home · Range · Range/course · 15 min). Its fourth matches `WORKS = ['Lift','Mobility','Speed','Rest']`, the fitness axis |

Anyone porting reaches for `ZONES` and gets the wrong list. Use `BLOCKS`. And when naming our own
column, do not call it `zone` without saying which of the two it means — this collision already
exists inside a single file, before any integration.

Each zone carries ~10 published attributes — a place alias (**THE SHOP / THE LAB / THE FIELD / THE
ARENA**), neuroanatomy, a persona (Engineer / Scientist / Warrior / Artist), a chapter range, a named
trap, and a "done when" criterion — all written in `Atlas.dc.html:158-220`. So a zone is a **4-row
reference table**, not a string enum. The zone personas are NOT a rival archetype vocabulary.

## 8. Honesty rules

- **A passing typecheck or build is not evidence anything works.**
- **"No error" is not success.** An RLS-blocked `UPDATE` matches 0 rows *silently*.
- **0 rows is ambiguous** between "hidden by policy" and "no data". Prove data exists first.
- **`information_schema` is privilege-filtered** — absence there is not absence. Use `pg_catalog`.
- Distinguish **recovered from the source** from **inferred by you**. Every time. An inferred formula
  presented as recovered is how fiction enters the schema, and this project has been burned by it.

Reference docs: `ECOSYSTEM.md` (architecture), `METRIC-MAP.md` (the metric proposal, §2 is the
cross-app reconciliation), `GAP-REPORT-design-vs-build.md` (design vs build, 28 Aug),
`eco/sql/rls_core.sql` (every policy, with the reasoning).
