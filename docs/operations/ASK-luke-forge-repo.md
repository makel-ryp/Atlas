# What I need from the Forge repo

**28 Aug 2026.** Luke is actively building Forge and will put it on GitHub. This is the specific list,
so the repo answers real questions rather than being browsed.

## Why it matters more than it looks

Of the **81 metrics** across Luke's three prototypes, **44 are produced by Forge** — 54%. Every raw
shot, every domain index, the composite, the transfer gap, strokes gained per domain, the skill radar,
calibration, the launch-monitor model. Atlas produces 25; Red 4; Locker Room 1.

So his coach Dashboard is largely a **display layer for Forge**. Six of its twelve screens — today,
cal, build, evidence, transfer, perf — cannot show real numbers until Forge does. That makes this repo
the single biggest unblock available, not a nice-to-have.

---

## 1. The three formula conflicts only his implementation can settle

The prototypes contain **multiple, disagreeing implementations of the same metric**. These are not
rounding differences and we should not pick a winner by guessing.

**a) Composite index — 5 sites, 3 distinct formulas.**
```
AtlasPlayer:1842   heroComp  = Σ shown[x] * DOMAIN_META[x].w / 100     ← fixed /100, ALL domains
AtlasPlayer:1937   composite = Σ scores[i.k] * i.w / wSum              ← normalised, PLAYED only
Dashboard:3070     (+4 identical copies) a third variant
```
`heroComp` makes an incomplete assessment read LOW; `composite` makes it read COMPARABLE. Same word,
two meanings, two screens of the same app. **Which is canonical?**

**b) Transfer gap — 5 sites, 3 sources of truth.** The literal `2.4` is hardcoded in *both* files
behind two different formulas, which suggests the constant was tuned until both screens agreed rather
than the maths being reconciled.

**c) `sgFor` — two incompatible functions with the same name.**
```
Dashboard:2715      (target - index) * SG_W[k]
AtlasPlayer:1130    (SG_EXP[k] * hcp - idx) * SG_F[k]
```
Two different numbers, both rendered to the user as "SG".

## 2. Where the benchmark tables actually live

`BENCH` (`Dashboard:3116`) and `SGA_BENCH` (`AtlasPlayer:1080`) are the same handicap→target curve in
two shapes, **already diverged** — the player app has an extra anchor at hcp30 the coach app lacks. So
coach and player compute different targets for the same handicap.

⚠️ These are the denominator of every strokes-gained figure. Editing one retroactively changes every
stored score, which is why they need to be **versioned reference data**, owned once. Which does Forge
use, and is there a third version in the real build?

## 3. Metrics that are rendered but derived by nothing

Found while working out the formulas — these appear on screen with no computation behind them:

- **the 5-axis skill radar (`dna`)** — stored as a literal in the Dashboard and rendered, but nothing
  derives it. Does Forge compute it? From what?
- **current curriculum zone** and **plan phase (1–4)** — displayed per player; no rule sets them
- **tolerance ladder rung / cleared level**
- **coaching credits** (allowance / used / banked) — no player dimension in the prototype's config
- **the "practice bar"** (planned vs logged) — the planned figure has no source

## 4. What I want to read, concretely

1. **The persistence layer** — what Forge stores, in what shape. Its prototype persists one
   localStorage blob (`atlas.player.v3`) **with no user id in it**, so the real build must have solved
   identity somewhere.
2. **The scoring module(s)** — the authoritative version of §1 and §2, ideally one file.
3. **Whether it writes anywhere shared.** If Forge is heading for its own database, that is the
   integration conversation; if it can write `golf.*`, the ecosystem plan already has per-table
   writers reserved for `forge_app`.
4. **The launch-monitor import** — which monitors, CSV or API, and whether imports are append-only or
   overwrite-per-club. The prototype overwrites, which loses history.
5. **What Forge expects FROM Atlas.** It reads a handicap and a target; both are ours. Better to agree
   the contract than to discover it.

## 5. What we can do without waiting

Atlas's own 25 metrics light up **roster** (done), **profile**, **intake**, **thread** and **plan**.
That work is unblocked and proceeds in parallel — see `PLAN-get-lukes-build-running.md`.
