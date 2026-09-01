# Atlas admin panel — plan

**Rewritten 2026-08-28**, against Luke's running prototypes. The 19 Aug version scoped this as "edit
memberships and prices" and that scope was wrong — not incomplete, *wrong about what kind of thing
this is*. Companion to `GAP-REPORT-design-vs-build.md`.

---

## 1. What changed, and why it matters

The original plan listed eleven admin functions, and **all eleven were identity or billing**: user
lookup, role grants, comps, feature flags, orgs, credits, erasure, subscriptions, entitlements, audit.

Reading the prototypes shows a second category that was missing entirely, and it is the larger one:
**the coaching model itself is data, and someone has to administer it.**

`Dashboard.dc.html` and `AtlasPlayer.dc.html` between them hardcode ~70 reference structures. Not
player records — *the product*: the drill library, the build ladder, the four zones, the tolerance
bands, the coaching tiers, the course catalog, and the benchmark tables that every score is computed
against.

**Two things follow, and the second is the important one.**

### The admin panel is the control surface for the coaching model

Half of what it must edit is Luke's IP encoded as data. That is good — it is what makes the model
changeable without a deploy, the same reason `plans` holds pricing. But it means the panel is not an
ops tool bolted on the side; it is how the product gets tuned.

### ⚠️ Editing a benchmark retroactively changes what every stored score means

This is the constraint that shapes everything, and it is exactly analogous to the Stripe-immutability
problem the old plan was built around — but worse, because it is silent.

`BENCH = [[20,9],[10,24],[0,40],[-4,53]]` (`Dashboard.dc.html:3116`) maps handicap to a target score.
`targetFor()` interpolates between those anchors, and **that target is the denominator of every
strokes-gained figure in the product.** Move one anchor and every historical index shifts, with no
error, no migration, and nothing on screen to say the number means something different than it did
last week.

So a benchmark edit is not a settings change. It is a **new scoring version**, and stored results
must record which version produced them. This is the `scoring_version` rule from `AGENT-BRIEF.md` §6
arriving as a concrete UI requirement:

- Editing a benchmark **creates a new version**; it never mutates the current one in place.
- Every stored derived value carries the version it was computed under.
- The panel must show **what a change would do** before it is saved — how many stored results were
  computed under the outgoing version, and whether they will be recomputed or grandfathered.
- Recompute-vs-grandfather is an explicit choice, never a default.

**Today we are in the safe regime** — no stored scores exist, because none of the practice tables
exist. Build the versioning now, while a mistake costs nothing.

### ⚠️ And one benchmark is already forked

`SGA_BENCH = {tour:53, hcp0:40, hcp10:24, hcp20:9, hcp30:3}` (`AtlasPlayer.dc.html:1080`) is the same
curve as `BENCH`, in a different shape, **with an extra anchor the Dashboard does not have.**

The coach's app and the player's app therefore compute a different target for the same handicap at
the low end. That is a live product bug in the design, and it is the silo problem in miniature: one
number, two hardcoded copies, already diverged. It is also the clearest argument for this panel —
there should be one benchmark table, administered once, read by both.

---

## 2. Access — unchanged, and already built

The gate exists and is proven. `verifyToken → attachUser → requireAdmin('atlas')`, and **verify the
role before reaching for elevated credentials, never after.**

Two properties worth restating because the content half must not weaken them:

- **Reads go through the ordinary `atlas_app` pool** under the four `is_app_admin('atlas')` policies.
  No bypass on a read, ever.
- **Writes go through `billing_svc` inside `withRlsBypass`**, except role writes, which go through
  `atlas_app` so the per-app scoping policy actually binds. A policy a bypassing path skips is
  decorative — that is not theory here, it was a live bug on 26 Aug.

Reference-data writes are new and need the same discipline: bypass-only by policy, one credential,
and an `admin_audit` row **in the same transaction** as the change.

---

## 3. The function list

### A. Identity and billing — mostly built

| # | Function | State |
| --- | --- | --- |
| 1 | User lookup — plan, entitlements, app access, consent | ✅ built |
| 2 | Grant / revoke app access | ✅ built, scoped per app |
| 3 | Organizations — create an academy, assign members | ✅ built. **This is what unblocked "assign a kid to an academy"** |
| 4 | Audit log viewer | ✅ built |
| 5 | Memberships and pricing | ⏸ **blocked on Luke.** See §4 |
| 6 | Comp a plan — paid tier, no Stripe, with expiry and reason | not built |
| 7 | Feature flags — toggle and set `plan_required` per `(app, key)` | not built. The table exists |
| 8 | Coaching credits — grant, adjust, view redemptions | not built |
| 9 | Erasure queue — `deletion_requests`, mark complete | not built |
| 10 | Subscription support view — read-only Stripe state | not built, needs Stripe |
| 11 | Content entitlements — manually grant a course or book | not built |

### B. The coaching model — none built, none previously planned

| # | Function | Source | Why it needs an admin surface |
| --- | --- | --- | --- |
| 12 | **Benchmark tables** — `BENCH` / `ANCH` / `SGA_BENCH` / `PUTT_EXP` / `TOUR_K` | Dashboard 3116, 3128; Player 1080, 1336 | The denominators of every derived score. **Versioned, never edited in place.** Currently forked between two apps |
| 13 | **Drill library** — `DRILL_DEFS`, `DRILLS`, `DRILL_PICK` | Dashboard | 23 drills across 5 steps, with video, constraint, volume and checkpoint. Content, changed often, no deploy |
| 14 | **Build ladder** — `STEPS`, `BUILD_STEPS`, `RUNGS` | Dashboard, Player | The curriculum: order, lock-until-signed, which drills sit on which rung |
| 15 | **The four zones** — `BLOCKS` + the site's published attributes | Dashboard 2459; `Atlas.dc.html:158-220` | A 4-row reference table with place alias, persona, chapter range, trap, and "done when". ⚠️ Not the array named `ZONES`, which is a practice-logging picker |
| 16 | **Coaching tiers** — `TIERS` (Foundation / Builder / Competitive) | Dashboard | Distinct from `plans`. Practice volume and phase templates, not SKUs. ⚠️ `ROSTER` also contains a `contender` value `TIERS` does not define |
| 17 | **Tolerance bands** — `CHIP_TIERS`, `CHIP_LEVELS`, `SLOPES`, `FIRMS`, `WINDS` | Player | Scoring parameters. Same versioning rule as 12 |
| 18 | **Coach and faculty directory** — `COACHES` | Dashboard, site | ⚠️ Needs many-to-many roles: Dr. Raymond Prior appears on both lists |
| 19 | **Course catalog** — `RAW_COURSES` | Dashboard | Written by Red per the metric map. Atlas administers overrides, not the source |
| 20 | **Content / the Vault** — `BRIEFS`, `IMPACT_OPP`, chapters | Site, Player | No owner, no milestone, no table anywhere. Flagged in the gap report |

**12 through 17 are the real work**, and 12 is the one with a correctness constraint rather than just
a form.

---

## 4. Pricing — still blocked, and the block is now better understood

Deferred pending Luke. Two facts that decide it, both already established:

- **`plans` holds two rows** (`free`, `pro`, and `pro` has no price). The site sells **seven** price
  points: $99 / $199 / $299 / $399 one-time, $399/mo, $799/mo, plus free — cumulative, with a 3-month
  minimum on Coaching and an application gate on Elite.
- **`STACK-DECISIONS.md` records that the $99–$799 figures appear nowhere in the repo.** The only
  pricing research says $59.99–$99.99/**year**.

So the names and the numbers are both unresolved, and the metric map's proposal
(`free · pro · coaching · elite` + `content_entitlements` for the four one-time tiers) has never been
confirmed.

**Settle the names before the Stripe work, not after.** Stripe Price objects are immutable; after the
first customer, every one has to be recreated. Prices can stay `NULL` — the schema allows it
deliberately.

Also unmodelled: cumulative inclusion ("each tier includes everything below"), the minimum term, and
the application gate. Those are columns, not copy.

---

## 5. Build order

1. ~~Admin gate, user lookup, role grants, academies, audit~~ ✅ done
2. **Reference-data versioning** — the mechanism from §1, before any benchmark is editable. It is far
   cheaper now, with zero stored scores, than after the first one exists
3. **Benchmarks (12)** — starting with reconciling `BENCH` and `SGA_BENCH` into one table
4. **Drill library and build ladder (13, 14)** — the largest content surface, and what a coach touches
5. **Zones (15)** as a seeded 4-row reference table; the content is already written on the site
6. Tiers, tolerances, coach directory (16–18)
7. Pricing (5), once Luke answers
8. The remaining ops functions (6–11), as they are needed

⚠️ **Nothing here is a 7 Sep item.** The demo runs on the built half. This is what comes after.
