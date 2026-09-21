# What I need from the Forge repo

**28 Aug 2026 · revised 21 Sep 2026.** Luke is actively building Forge and will put it on GitHub.
This is the specific list, so the repo answers real questions rather than being browsed.

> ### What changed in the 21 Sep revision
>
> Three weeks of Atlas work has **answered three of the questions this doc used to ask**, and turned
> up **one new one that is now the most important thing in here** (§3a, the drill library).
>
> | Was asked | Now |
> | --- | --- |
> | Curriculum zone + plan phase — “no rule sets them” | **Answered by Atlas, not Forge.** The golfer picks both at intake. No longer an ask. |
> | Coaching credits — allowance / used / banked | **Half answered.** Makel set the real monthly allowances 17 Sep. Used/banked still has no producer. |
> | The practice bar — “the planned figure has no source” | **Half answered.** Planned now comes from the golfer’s own tier+phase. Logged still has no source. |
>
> Still fully open and unchanged: **§1 (the three formula conflicts)**, **§2 (the benchmark tables)**,
> the **5-axis skill radar**, and the **tolerance ladder**.
>
> Also on 21 Sep we lifted your 27 drill reasons out of the prototype into a shared module keyed by
> id, so the server can read them (§3a). Your file still opens standalone. The questions in §3a are
> narrower as a result — they are now only about whether Forge already owns a canonical version.
>
> One thing that got *easier*: Atlas now stores a **result snapshot** for Practice DNA, so changing
> that instrument no longer rewrites history. **§2’s warning still stands for strokes gained** — no
> equivalent snapshot exists for SG, so the benchmark tables remain retroactive.

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
  derives it. Does Forge compute it? From what? **(Still fully open, 21 Sep.)**
- **tolerance ladder rung / cleared level** **(Still fully open, 21 Sep.)**
- ~~**current curriculum zone** and **plan phase (1–4)** — displayed per player; no rule sets them~~
  **ANSWERED 17 Sep, and not by Forge.** Atlas asks the golfer directly at intake: practice
  intensity (Foundation ~2 hrs/wk, Builder ~5, Competitive ~10) and which of the four phases they
  are in. Both are stored and drive the weekly floor, the prescribed week and the calendar. **We are
  not asking you for a rule here any more** — but tell us if self-declared is the wrong model and
  something should derive it instead.
- **coaching credits** (allowance / used / banked) — ~~no player dimension in the prototype's
  config~~ **Allowance answered 17 Sep**: Luke 1/mo, Brock 4/mo, Yannick 2/mo, Phil 4/mo, flat
  rather than tier-varying. **Used and banked are still unproduced** — nothing records a session
  being taken, so the balance renders as a dash. Does Forge or anything else book sessions?
- **the "practice bar"** (planned vs logged) — ~~the planned figure has no source~~ **Planned is
  answered**: it now comes from the golfer's own tier + phase, and we verified it lands on the
  correct real weekdays. **Logged still has no source** — nothing anywhere records that a practice
  session happened, which is also why streaks, hours and "practiced n of N" all render as dashes.

## 3a. The drill library, and the reasons behind a prescription

**Added 21 Sep. This is the biggest open question in the document.**

Atlas can now record that a coach *judged* a drill — `golf.drill_progress`, 35 stable ids in
`shared/drills.ts`, RLS per player, live and tested. What Atlas cannot do is **give a player a
drill**. There is no assignment mechanism anywhere: the only two coach→student writes that exist are
sign-off and notes.

What stands in for assignment today is a **static template**: `TIERS[tier].phases[n].week`. Every
Builder-phase-2 golfer on earth gets the identical week. The calendar's "Programmed by Coach Phil"
is a literal string.

Meanwhile the *content* for doing this properly already exists — in your prototype, and it is good:

- **27 unique plan drills**, each with a name, a `std` (the condition that counts as done), and a
  `cam` flag for the ones that get filmed.
- **27 `WHY` entries** — one per drill, **complete, no gaps, no orphans** (we checked). Real
  prescription reasoning: *"Trail heel down removes the leg you cheat with, so the load has nowhere
  to go but the ground."*
- **Per-route blurbs** explaining when the Cannon applies versus the Anchor.

So the hard part — the coaching thinking — is done.

**We have since moved it somewhere a machine can use it (21 Sep).** Those 27 reasons and standards
now live in `shared/drills.ts` keyed by a stable id, rather than as JavaScript constants keyed by
display name inside the prototype. Three things were wrong with the old arrangement and are now
fixed: renaming a drill silently orphaned its reason, only the browser could read them, and changing
one meant editing a 390KB HTML file.

Two notes on that, because they affect what we need from you:

- **Your file still works standalone.** The literal map is kept as a fallback, so opening
  `Dashboard.dc.html` straight from disk with no server behaves exactly as before. We did not take
  anything away from how you work.
- **Step 1 needed a judgement call.** Its four drills each have a Cannon and an Anchor version with
  different reasons, and Atlas treats them as one reviewable item — so we carry both in one string
  (`"Cannon — … · Anchor — …"`). **Tell us if that is wrong**: if the two routes should be separately
  trackable, that is a change to the id space and better made now than later.

That move is why the questions below are now narrow. We are not asking you to write anything down —
we are asking whether a canonical version already exists on your side that ours should defer to.

**The questions:**

1. **Does Forge own a drill library?** If it has a canonical list — ids, names, standards, the
   reasons, video refs — that is the thing to build against, and `golf.drill_library` should be its
   shape rather than ours. (Atlas has that table *specified and not built*, deliberately, so as not
   to fork a list you own.)
2. **Is there an assignment rule, or is the tier/phase template the whole thing?** In other words:
   should a coach be able to hand a player a specific drill, or is "your plan gives you your week"
   the intended model? Both are defensible. We just need to know which, because they are different
   builds.
3. **If assignment exists, what drives it?** A coach picking by hand, a rule off the assessment, or
   Forge proposing from the numbers? This is the same question as §3's "no rule sets them", one
   level down.

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

**Revised 21 Sep.** That parallel work is now largely done, which has sharpened this ask rather than
softened it — the Forge-blocked surface is smaller and much more clearly drawn.

**Shipped and live on real data:** roster, player file, sign-off (35 items, both audiences), Practice
DNA read, coaching notes with three visibility tiers, the interview, the plan screen and its week,
the calendar (real dates), the Construction workbook.

**Blocked on Forge, precisely:**

| Screen | What is waiting |
| --- | --- |
| `03 Transfer`, `04 Performance` | The four domain indices, the composite, the transfer gap, the skill radar, round history — the whole screen |
| `Today` → "Tomorrow · built for you" | The −2.4 Driving SG and the facet-behind logic that picks tomorrow's session |
| `Today` → the prescription card | Which drill a golfer is given, and who prescribed it (see §3a) |
| `Fitness` | Clubhead speed history, and lift/speed compliance |

Everything on that list currently renders **your original demo values** to a real signed-in golfer.
We have stripped the ones that state a fabricated fact in the golfer's own voice — an invented coach
message thread, an invented curriculum tier, a frozen calendar date, a money stake — but the four
rows above are still showing numbers nobody measured, and they are the last of it.

Two consequences worth knowing:

1. **We would rather blank them than guess.** If Forge is far out, say so and we will gate those
   screens off for alpha rather than ship them reading fiction.
2. **A copy of the repo unblocks more than the formulas.** §3a means the drill library and the
   prescription reasons may be in there too — and that is the difference between a static weekly
   template and an actual coaching system.
