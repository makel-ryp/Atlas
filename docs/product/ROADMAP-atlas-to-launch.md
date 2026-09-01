# Atlas → ecosystem — milestone roadmap

**Written 20 Aug 2026 · revised 28 Aug** after reading Luke's running prototypes
(`GAP-REPORT-design-vs-build.md`). Per-app milestones, with cross-app data as the final gate.

⚠️ **The 28 Aug revision changes the shape of this roadmap, not just its contents.** The original put
*all* cross-app data at M5, behind three other apps. Makel's stated thesis — *"it all starts with us
integrating Atlas, red, forge, Debrief, locker room, and practice DNA"* — makes integration the
product rather than the last gate, and `DECISION-coach-dashboard.md` had already conceded in writing
that Atlas owning the coach dashboard "pulls a piece of M5 forward." That was never reflected here.
§0 and M5 below are rewritten accordingly; M1–M4 are unchanged.

---

## 0. The one distinction that defines every milestone

**Shared identity comes free. Shared domain data is the hard part.**

The moment an app adopts eco, it reads `public.users` — one account, one person, everywhere. That is *included* in standing up and costs nothing extra.

What is genuinely hard is `golf.*` and `atlas.*` — a round written by Red and read by Debrief, a profile written by Atlas and read by Locker Room. That needs two apps to agree on what a thing **means**, not just where it lives.

So:

| | Milestone content |
| --- | --- |
| **M1–M4 · each app stands** | Shared **identity** + that app's **own private schema**, on `ryp-core`, as its own non-bypassing role |
| **M5 · the gates open** | Shared **domain data** crossing app boundaries |

Each of M1–M4 is independently worth doing even if M5 never happened: RLS actually binds, no more hand-copied identity schema, one account across products.

### ⚠️ But "shared domain data" is two different jobs, and only one of them is hard

The original framing treated them as one thing and put both at the end. They are not the same:

| | What it is | Where it belongs |
| --- | --- | --- |
| **The spine** | One golfer's own record, assembled and read by the app that owns them. `golf.player_metrics`, the profile and practice read path, the coach↔student boundary | **Early.** It needs no second app to agree with anything. Atlas reading its own students is not a cross-app negotiation |
| **The gates** | Two apps agreeing what a metric *means* — a round written by Red and read by Debrief, revocation propagating across products | **Still M5.** This is the genuinely hard part and the original warning holds |

Atlas already shipped part of the spine — the coach↔student boundary, both access paths, the
identity/metric visibility split — while the roadmap still had all of it at Sprint 13. Treat the spine
as the thing M1–M4 hang off, not as a milestone after them.

---

## 1. Milestones

### M0 · Foundation — ✅ **DONE** (updated 28 Aug)
`ryp-core` exists: **18 tables** across `public` / `golf` / `atlas`, RLS enabled **and forced** on all
of them, **50+ policies**, four non-bypassing per-app roles with LOGIN, pricing as data.
`@ryp/eco` **v0.16.0**, with a schema-drift test that now covers all three schemas — it was silently
checking only `public` until 27 Aug.

### M1 · Atlas stands
**Done when:** a stranger signs up, manages their own profile, pays, and sees only their own data — with Atlas writing `public.*`, `atlas.*` and its own private state.
- Login (Firebase, email/password + Google) · identity via eco · profile read **and write**
- Marketing site, signup, pricing page reading `plans`
- Stripe: one webhook → `billing_subscriptions` → `user_app_roles`
- Admin panel: user lookup, role grants, academies, audit — ✅ **built**; pricing blocked on Luke
- **Demo checkpoint at Mon 7 Sep** — a slice of M1, not M1 itself

**Built as of 28 Aug:** login, profile read+write, signup provisioning, the coach roster with both
access paths, coaching notes, and the admin panel above. **Not built:** the marketing site, signup
with payment, and the Stripe webhook — those are the rest of M1.

### M2 · Red stands
**Done when:** Red runs on `ryp-core` as `red_app`, reads identity from eco, and keeps its caddie in `ryp_red.*`.
- R1: declare the two undeclared objects, ban `db:push`
- R2: adopt eco, entitlement writes to a trusted path
- R3: its analytics (`blueprint_*`, `lateral_*`) into `ryp_red.*` — a **fresh build**, not a backfill
- R4: connect as `red_app`; stop writing billing
- *Its rounds/shots stay Red-private at this milestone.* Promoting them is M5.

### M3 · Locker Room stands
**Done when:** Locker Room runs on `ryp-core` as `lr_app` with real RLS for the first time.
- Import identity from eco instead of hand-copying
- **Move its two role inserts to a trusted path — hard prerequisite.** `lr_app` has no write grant on `user_app_roles`, so signup breaks the instant it migrates otherwise
- RLS on the four tables that have none
- Its four `app_private` helpers into its own migrations, as `SECURITY DEFINER`
- *Owner: Yannick.*

### M4 · Debrief stands
**Done when:** Debrief authenticates through Firebase and its 11 tables live in `debrief.*`.
- Supabase Auth → Firebase (four files hold the auth; ~30 just consume the session)
- Data → `debrief.*`; storage → R2; RLS from `auth.uid()` to `app_private.current_user_id()`
- **pgvector is vestigial** — retrieval is Postgres full-text search, so this is smaller than first scoped
- *Owner: Yannick. Whether it happens at all is his call.*

### M4.5 · The coach product — **new, and it was on no milestone at all**
**Done when:** a coach opens a student and sees their golf record, prescribes from the build ladder,
and signs off work — on live data.

This is the largest surface Luke designed and it appeared nowhere in this roadmap. Atlas owns it
(`DECISION-coach-dashboard.md`), the permission layer is **built and proven**, and the tables are not.

- `golf.player_metrics` — **build this first.** One append-only stream
  `(user_id, metric_type, value, source, measured_at, ref)`. The metric map calls it the single
  highest-leverage promotion; it is the join point for every cross-app metric and the table the 2030
  model reads. Adding a tool becomes a vocabulary row, not a migration
- `golf.practice_sessions` / `practice_index_results` / `practice_days` — the facet indices, the
  composite, the transfer gap, the calendar
- `golf.drill_library` / `drill_progress` — the build ladder, with **per-column writers**
  (Forge writes ticked/watched; Atlas and Locker Room write verified/signed)
- `atlas.prescriptions` — what to work on next. One producer, or two apps contradict each other
- `atlas.messages` — a two-way thread. **`atlas.coaching_notes` is not this**: notes are coach-authored
  *about* a student; both prototypes show a conversation the player writes into
- `golf.player_profile.target_handicap` — one missing column that is the denominator of every
  strokes-gained figure on every coach screen
- Reference data + the versioning mechanism from `ATLAS-ADMIN-PLAN.md` §1

⚠️ **Scope is "design the coach product", not "port Luke's file."** `Dashboard.dc.html` is ~90% the
player app — `state.view` defaults to `'today'`, nine screens are hardwired to one player, and the
coach surface is Roster + Player file + a `coachMode` boolean. What it gives you is two excellent
screens and a verification toggle, not a dashboard to transcribe.

### M5 · The gates open — **the hard one, and now correctly scoped**
**Done when:** domain data crosses app *boundaries* under database-enforced authorisation.

Narrowed: the coach↔student boundary moved to M4.5, because it needs no second app's agreement.
What remains is the part that genuinely does.

- `golf.rounds` / `shots` / `bag` / `courses` promoted, with **per-table** grants — writers differ
- Atlas reads Red's rounds; Debrief reads them too
- **Revocation propagates** — losing an entitlement loses cross-app reads. Nothing does this yet, and
  a lapsed coaching subscription currently leaves an `active` edge and its access intact
- The async retrying ingest, so no app blocks on another at request time

⚠️ The original warning stands for **these** items: do not attempt them before three apps are standing.

---

## 2. Why M5 is the hard one

Not effort — *ambiguity*. Everything before it is one team agreeing with itself.

| Problem | Why it bites |
| --- | --- |
| **Semantic disagreement** | Two apps must agree what a metric *is*. The proof already exists: **S.C.O.R.E. means two incompatible things** — Debrief scores five pillars 1–10 with 18 failure modes from a voice transcript; Locker Room scores them 0–25 against 26 archetypes from a Typeform. Same acronym, different instrument. Merging them by name would silently corrupt both |
| **Provenance** | Red writes a round, Debrief reads it. Who may correct it? Whose number wins on conflict? |
| **Per-table writers** | `golf.*` has no single owner — Atlas writes the profile, Red writes rounds, Forge writes practice. Grants are per table, and one wrong grant is a cross-app write hole |
| **Coach authorisation** | The first policy that reads *another* table to decide access. The recursion trap already bit us once here |
| **Revocation across boundaries** | Losing access must remove cross-app reads too, not just the app's own screens |
| **External writers** | Forge is Luke's. `golf.*` becomes a contract with someone else's release schedule |

**Do not attempt M5 before three apps are standing.** Debugging a cross-app read while an app is mid-migration means you cannot tell which layer is wrong.

---

## 3. Sequencing

M1–M4 are largely parallel because they have different owners. M5 needs at least M1 + M2.

| Sprint | Dates | Your track (A) | Others (B) |
| --- | --- | --- | --- |
| 0 | Aug 20–21 | Roles LOGIN · scaffold Atlas · one live route | |
| 1 | Aug 24 – Sep 4 | **M1**: login, identity, profile, isolation → **demo Sep 7** | Yannick can start **M3** any time |
| 2 | Sep 7–18 | M1: profile write, account, consent, `handicap_history` | M3 |
| 3 | Sep 21 – Oct 2 | M1: marketing site, signup, pricing page | M3 → **M4** |
| 4 | Oct 5–16 | M1: Stripe end to end · **🔴 answer §4** | M4 |
| 5 | Oct 19–30 | M1: admin panel, tax, refunds → **M1 COMPLETE** | M4 |
| 6 | Nov 2–13 | R2 storage in eco · **M2** starts (R1–R2) · *re-plan from here* | M4 |
| 7 | Nov 16–27 | **M2**: R3–R4 → **M2 COMPLETE** | |
| 8 | Nov 30 – Dec 11 | Hardening: erasure, monitoring, backups tested, legal pass | |
| 9 | Dec 14–25 | Beta with 20–50 real users · *half speed* | |
| 10 | Dec 28 – Jan 8 | Buffer · *half speed* | |
| 11 | Jan 11–22 | **Atlas public launch readiness** · decommission old `ryp-red` | |
| 12 | Jan 25 – Feb 5 | **Atlas launches** | |
| 13+ | Feb onward | **M5 — the gates** | Needs M2 + M3 done |

**Confidence:** high through Sprint 4, moderate to 8, low beyond. Sprints 9–12 are a shape. Re-plan at Sprint 6.

---

## 4. 🔴 The decision due by Sprint 4

**Where does Atlas's coaching content come from?** Practice DNA is a separate project mid-launch and out of scope; Forge is Luke's.

| Option | Consequence |
| --- | --- |
| Atlas builds its own intake | On time, but two questionnaires in one company — forever |
| Integrate Practice DNA when it lands | No duplication; your date now belongs to a project you don't control |
| **Launch without it** ✅ | Atlas = identity + profile + billing. Genuinely useful, not yet the pitch. Add the brain after |

**Recommendation: launch without it, integrate immediately after.** Building a second intake because the first isn't ready is how you maintain both permanently.

---

## 5. Launch is not the last milestone

Worth being explicit, because your framing puts M5 at the end and that's right — **but it means Atlas launches publicly before the ecosystem is integrated.**

That is the correct order. Atlas standing alone is a real product: one account, one profile, one place that bills. Waiting for M5 to launch would hold a shippable product hostage to the hardest work in the plan.

**So: launch at M1 + hardening (Feb). M5 lands after, as the thing that makes the ecosystem more than a set of apps sharing a login.**

If you'd rather hold launch until the gates open, say so — it's defensible, but it pushes launch to roughly April and every week of M5 slip is a week of no revenue.

---

## 6. Gates

| Must be true | Before |
| --- | --- |
| A route returns real data as `atlas_app` | M1 work begins |
| eco's auth chain runs in a live app | anything else in M1 |
| Coaching-content decision made | Sprint 5 |
| Webhook idempotent and ordered | any real payment |
| Erasure provably deletes objects too | any real user |
| Privacy policy is true | launch |
| LR's role inserts moved | M3 migration |
| Three apps standing | **M5 starts** |

## 7. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **eco's first real integration** | Sprint 1 overruns | Two test/fix days already allocated |
| **M5 semantic disagreements** | Silent data corruption | Write the contract per table *before* the grant. Never merge two metrics by name |
| Yannick owns M3 **and** M4 | Both stall; M5 can't start | Nothing in M1 or M2 depends on him |
| Forge is external | `golf.*` becomes someone else's schedule | Keep Forge out of v1. It joins after M5 |
| Coaching decision drifts | Atlas launches without a differentiator | Forced at Sprint 4 |
| Solo builder | Everything stops | Docs current, handoff pattern proven. Keep both true |
| Scope creep from the prototypes | Launch slips a quarter | The live/sample panel list is the contract |

## 8. Not in v1

Forge · the RYPstick fitness spoke · Parallax video · org/academy billing · native mobile · Arccos
(link-only in the prototype — drop it and say so).

**Each is a decision, not an oversight.** Say it that way when asked.

### Moved off this list on 28 Aug

- **Coach↔player messaging** — both prototypes show a two-way thread and the site advertises a
  95%-within-24h response SLA. That is a product promise, not a nice-to-have. → **M4.5**
- **Practice DNA** — the *app* stays deferred (separate project, mid-launch, its own database, and it
  is the only anonymous-write surface in the ecosystem, which breaks owner-scoped RLS). **But its
  vocabulary does not wait.** Its `config.ts` already defines `METRIC_TYPES × METRIC_SOURCES` and
  `ZONE_TOOLS` — the reconciling enum for `golf.player_metrics`. Lift the vocabulary into `ryp-core`
  now, or the second producer invents its own.

### ⚠️ Three subsystems with no milestone and no owner

Named here so they stop being invisible. None is a v1 blocker; all three are real work someone will
eventually be surprised by.

| | What | Why it has no home |
| --- | --- | --- |
| **The Vault / CMS** | The content library the site sells and links to from ~9 of its click targets | No table, no owner, zero mentions in any planning doc before 28 Aug |
| **The book** | Volume One — chapters tied to zones, a cover prototype in the handoff | Referenced by the metric map, absent from every roadmap |
| **Brand implementation** | Applying Luke's design system | ⚠️ The Brand Guide is **a critique, not a spec** — it proposes two geometrically opposite logos and ships a third in its own masthead, and its "one accent, never green" rule is already violated by the semantic colour functions in both large prototypes. Eight values with one accent cannot do data visualisation, and the coach dashboard is almost entirely data visualisation. This needs a sanctioned data-viz ramp before it is a theme file |
