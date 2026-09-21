# The coaching ruleset — what Practice DNA should DO with an answer

**9 Sep 2026. For Luke, to work through with his AI.**

This is the companion to `ASK-luke-forge-repo.md`. That doc asks for the **numbers** (Forge, strokes
gained, the benchmark tables). This one asks for the **rules** — what the coaching system actually
does differently because a golfer answered the quiz one way rather than another.

Its §3 has a single line that this whole document expands:

> **current curriculum zone** and **plan phase (1–4)** — displayed per player; no rule sets them

> ⚠️ **Updated 21 Sep 2026 — that line is now half answered, so read this doc with the correction.**
>
> Atlas now **asks the golfer directly** at intake: practice intensity (Foundation ~2 hrs/week,
> Builder ~5, Competitive ~10) and which of the four phases they are in. Both are stored per player
> and drive the weekly floor, the prescribed week and the calendar. So "no rule sets them" has
> become "the golfer sets them, and nothing checks whether they are right."
>
> **What that changes for you:** the questions below about what *should* set a zone or a phase are
> still worth answering — but they are now about whether self-declared is good enough, and what
> should override it, rather than about filling a blank. If a golfer says Competitive and practises
> two hours a week, nothing currently notices.

---

## 0. How to use this

Every section below states **what the code does today**, with the real file and line so your AI can
check us, then asks **one question**. You are not being asked to write code or read it. You are being
asked for the *rule* — in a table, a list, or plain sentences. We turn that into code.

Where we already know the answer, we say so and do not ask. Where the answer is blocked on Forge, we
mark it 🔒 — skip those; the rest you can answer today.

A note on how we work, so the questions make sense: **we would rather print nothing than print a
number we made up.** Several questions below exist because the code currently fills a gap with an
assumption, and we want your rule instead of our guess.

---

## 1. The short version

The quiz works. It computes a rich, careful read of the golfer. Then it stops.

```
  71 quiz items exist  ──►  13 are asked  ──►  a full result is computed  ──►  one prose card
                                                                                    │
                                                     the dashboard never sees any of it
```

Three things are true at once, and each needs a decision from you:

1. **We only ask 13 of the 71 items** (Tier 1A). That was the right call for demo length, but it
   means 8 of the 17 measured scales are now permanently unmeasurable — including *calibration* and
   *performance mastery*, two of your four zones.
2. **The only coaching output is a 4-row table of static prose**, keyed on one variable. Two of its
   four rows can never be reached, because their zones are among the unmeasurable ones.
3. **None of it reaches the dashboard.** The prescription renders once, on the quiz result screen,
   and is never seen again. Your Plan page and Calendar run off `state.tier: 'builder'` and
   `state.phase: 2` — two literals at `Dashboard.dc.html:2783` — so every player sees the same week.

So: the quiz currently changes what a golfer is **told about themselves**, and changes nothing about
what the product **does with them**. Section 4 is the ask that fixes that — and §4.1 is the short
version, because the quiz already asks the two questions your tier table is keyed on.

---

## 2. What the quiz can actually see now

We cut intake to three sections before the demo. `nextTier()` returns `null` unconditionally
(`client/src/quiz/stages.ts:66`), so intake ends at Tier 1A. These are the 13 items asked:

| Item | What it measures |
| --- | --- |
| `ALLOC` | the 4-way practice-time split |
| `EA01` / `EA05` | Engineer / Artist tendency (one item each) |
| `CC01`, `CC_NEW01` | comfort-creature affinity |
| `QFJ01`, `QFJ02` | quick-fix seeking |
| `N01` | neuroticism |
| `TRA_NEW01` | transfer mastery |
| `MECH01`, `MECH02`, `MECH03` | mechanics / construction mastery |
| `FREQ01` | practice frequency |

### 2.1 The consequence: two of your four zones are invisible

Zone mastery is a mean of named items (`shared/practice-dna/config.ts:132`). Cross-referencing
against the 13 above:

| Zone | Items it needs | Asked | Result |
| --- | --- | --- | --- |
| **Construction** | `MECH01`, `MECH02`, `MECH03` | **3 of 3** | ✅ measured |
| **Transfer** | `TRA_MAS1`, `TRA_NEW01`, `TRA_NEW02`, `TRA_DISP`, `TRA_TRAP` | **1 of 5** | ⚠️ measured, but on a single item |
| **Calibration** | `CAL01`, `CAL_NEW01`, `MAS_CAL_LIGHT`, `CAL_NEW02`, `MAS_CAL`, `CAL_CONF` | **0 of 6** | ❌ always `null` → shows as *locked* |
| **Performance** | `PER_MAS_NEW1`, `PER_MAS01`, `MAS_CON`, `MAS_PER`, `MAS_CONTACT` | **0 of 5** | ❌ always `null` → shows as *locked* |

This cascades in three ways we can prove:

- **`computeGrowthZone` skips unmeasured zones** (`scoring.ts:389` — `if (v === null || v === undefined) continue`).
  The priority zone can therefore only ever be **construction or transfer**. Calibration and
  performance are unreachable, so two of your four prescriptions can never fire.
- **`recommendedAlloc` does NOT skip them.** It substitutes `zoneDeficit(null) = 0.5`, "unmeasured
  ⇒ moderate assumed need" (`scoring.ts:363`), so its calibration and performance shares rest on an
  assumption rather than on anything the golfer said. It is not on a screen today — `recommendedAlloc`
  is computed on every result and rendered **nowhere**, in neither the quiz nor your dashboard. We
  are not going to display it in that state, which is really Question 1 again.
- **The Architect archetype asserts "no zone is starving"** while two zones were never looked at
  (`scoring.ts:560`).

Also permanently null now: `computeArchitect` (needs `C01`/`A02`/`MAS_CAL_LIGHT`, none asked) and
`detectFalsePriors` (needs the `FP_*` items). What still works on 13 items: tendency (flagged
provisional), the archetype cascade, `detectPattern`, `detectChips`, and the Mechanics Index.

> ### ❓ Question 1 — the minimum instrument
> To grade a zone honestly we need at least one item per zone. **Which single item from each of
> calibration and performance would you add** to make all four zones measurable? Naming two existing
> item codes from the list above is a complete answer. (Two extra questions ≈ 20 seconds of intake.)
>
> ### ❓ Question 2 — what to show for a zone we cannot grade
> Until then, for calibration and performance: show them as *locked / not assessed*, or leave the
> zone off the display entirely? **We will not print an assumed value**, so those are the two
> options. Which?

---

## 3. What the quiz prescribes today

One table. Four rows. Three sentences each (`shared/practice-dna/results-content.ts:164`):

```
GROWTH[growthZone] = { headline, moves: [3 strings], cta }
```

For example, the whole of the construction prescription:

> **Shift practice into the Construction Zone.**
> · Add no-ball, camera-verified mechanics work — slow, with checkpoints.
> · Firewall it: declare the zone and the tools before each session, no scorekeeping inside.
> · Don't carry the build onto the course — that's the Artist's job.

That is good copy and we are not proposing to change a word of it. The issue is its **resolution**:

- It is keyed on **one** variable — the growth zone, 4 possible values (2 reachable).
- It is **identical** for a 2-handicap and a 28-handicap.
- Nothing else the quiz computes changes it. Not the archetype, not the Engineer↔Artist tendency,
  not the mastery band, not the pattern, not practice volume, not the chips.

So a golfer's archetype is *described* to them and then discarded.

> ### ❓ Question 3 — does the prescription vary, and by what?
> Should the three moves change with anything beyond the zone? The strongest candidates, in the
> order we would guess:
>
> 1. **Mastery band within the zone** — is *dim* different advice from *building*?
> 2. **Engineer ↔ Artist tendency** — same zone, but do you tell an Engineer and an Artist to do
>    different things in it?
> 3. **Handicap band.**
> 4. **Practice volume** — does someone with 2 hrs/wk get a different prescription from 10 hrs/wk?
>
> A "no, the zone is enough" is a perfectly good answer and we will build exactly that. If it IS
> more than the zone, section 4 is where we need the detail.

---

## 4. ⭐ The main ask: the curriculum ruleset

### First — you have already built most of this, and we should say so

The Plan page is not a sketch. `TIERS` at `Dashboard.dc.html:2678` is a real curriculum:

| Tier | Floor (hrs/wk) | Play | Speed | Home | Range |
| --- | --- | --- | --- | --- | --- |
| **Foundation** — *"the book default, fits around a full life"* | 2 | 2 | 0 | 15 min | 30 min |
| **Builder** | 5 | 5 | 3 | 30 min | 30 min |
| **Competitive** | 10 | 10 | 3 | 30 min | 30 min |

Three tiers, four phases each, and every one of those twelve cells carries a label, weekly hours, a
session mix, a home/range split and a **full seven-day schedule** — e.g. Foundation Phase 2,
*"Construction Primary"*, 2.0 hrs, `6 × 15 Home + 1 × 30 Range`, split 75/25, with each day named.

**So we are not asking you to invent a ladder. You wrote one.** We are asking for the two rules that
would make it run by itself.

### The two things it does not say

**A. What puts a player on a tier?** `state.tier` is the literal `'builder'` (`:2783`) for everyone.
Is the tier chosen by the player as a commitment level ("I can give 5 hrs/wk"), assigned by the
coach, or derived from something — handicap, the quiz, stated available hours? The `floor` column
reads like an hours-per-week commitment, which hints at self-selection; confirm?

**B. What advances a phase?** `state.phase` is the literal `2`. `phaseTabs` (`:3450`) is a manual
picker — you click Phase 1–4 to look at them. Nothing in the file *selects* a phase or moves anyone
between them. This is the real gap: a number of weeks, hitting the floor N weeks running, a coach
sign-off, a re-test, a measured improvement?

You have already answered this question **for the other ladder**, which is why we think it is a
small ask. Every step in `STEPS` (`:2509`) carries a `cond` — its advancement criterion, in your
words:

> Step 1 → *"All four drills verified on camera."*
> Step 2 → *"Path at zero, shaft lean right, ground force excellent, trunk angle decreasing."*
> Step 4 → *"Solid strikes at two seconds, on camera."*

Nothing evaluates those either — `cond` is rendered as text (`:782`) and never compared against
anything — but the *form* of the answer is exactly right. **A `cond` string per phase, in that same
style, is a complete answer to B.**

Worth knowing while you are here: the camera half of those conditions is now buildable. The coach's
Parallax check-off writes `golf.drill_progress.verified_at`, your drills already carry `cam: true`,
and `DONE` uses the same `'2-P1'` ref format. So *"all four drills verified on camera"* is a
condition we could evaluate today if you want the build ladder to advance itself.

Also worth answering while you are here: **can a player move down**, and does `rebuild` (the toggle
at `:2783`, which adds `t.play` hours in Phase 2 only, `:2973`) sit outside the ladder or inside it?

**C. Zone vs tier.** We compute a growth zone from the quiz (weakest measured zone by deficit ×
trainability, gated by the Mechanics Index). Your dashboard also carries a `zone`. Same concept, or
two things sharing a word? If the same, does our rule match what you intended?

### The shape of the answer

For A and B, prose is fine — this is two rules, not a table:

> *"Tier is the player's own commitment level, picked at signup from the three floors. Phase advances
> when they hit the floor four weeks running and the coach signs the phase off."*

Something that shape is a complete answer and we can build straight from it.

### 4.1 Why this is the only missing link — the quiz already asks your questions

This is the part worth seeing, because it makes A and B smaller than they look.

**Your tier table is keyed on exactly the two numbers the quiz already collects.** Intake asks two
typed questions (`shared/contract.ts:20`):

```ts
/** Weekly minutes on the full swing: range, garage, simulator. Excludes rounds. */
practiceMinutes: number;
/** Weekly hours playing on the course. Decimals ok. */
courseHours: number;
```

And your tiers are keyed on `floor` (practice hrs/wk) and `play` (course hrs/wk) — 2/2, 5/5, 10/10.
**Same two quantities, same units.** A player answering the volume screen is already stating which
of your three floors they clear. Nothing joins the two.

**The rest of the chain is already yours, and it already speaks the quiz's language.** Your phase
`week` arrays name each session by zone — 10 Construction, 6 Calibration, 6 Transfer, 8 Impact
Opposites — the same four zones the quiz grades. And the Plan page and the Calendar are not separate
logic: `weekRows` reads `ph.week` directly and `buildSchedule(ph)` feeds the schedule rows and the
`.ics` export from the same array (`planVals`, `:3426`). `practiceBar` then compares logged hours against
`floorHrs`.

So the whole thing is one chain with two broken links at the top:

```
  volume answers ──?──► TIER ──?──► PHASE ──► ph.week ──► Plan page
                                                    └──► Calendar + .ics
       quiz growth zone ──?──► which zone each session targets
```

Everything downstream of PHASE you have already built. The three `?` are the ask — and A and B
above are two of them. The third:

**D. Does the growth zone steer the schedule?** Your Phase 2 week is Construction-heavy by design.
If the quiz says a player's weakest zone is Transfer, should their Phase 2 week shift toward
Transfer, or does the phase's shape hold regardless and the zone only changes *emphasis within* a
session? Either is buildable; they are very different products.

That is the honest state of it: not "no ruleset exists", but "your ruleset has no inputs wired to
it." The demo shows Builder / Phase 2 for everyone because those are two literals at
`Dashboard.dc.html:2783`, not because the logic is missing underneath.

---

## 5. Strokes gained

`ASK-luke-forge-repo.md` §1c and §2 already cover the clashing `sgFor` implementations and the
`BENCH`/`SGA_BENCH` divergence. Not repeating the detail — but the short version matters here, so:

### 5.1 There are three different "SG" formulas, and they disagree

| Where | Formula | Constants |
| --- | --- | --- |
| `Dashboard.dc.html:2637` | `(target − index) × SG_W[k]` | `SG_W` = .30 / .35 / .15 / .20 |
| `AtlasPlayer.dc.html:1130` | `(SG_EXP[k] × hcp − idx) × SG_F[k]` | `SG_EXP` = 1.40 / .90 / .20 / .35 · `SG_F` = .12 / .30 / .12 / .20 |
| `Dashboard.dc.html:3088` | `(hcp − hcpFor(pts)) × SG_W.chipping` | reuses **.15** — chipping's *share of the composite* — as a strokes-per-point conversion |

Two functions with the same name, `sgFor`, computing different numbers, both shown to a user as
"SG". The third borrows a weight for a purpose it wasn't defined for.

### 5.2 ⚠️ One of these numbers is fabricated and still on screen

On the Performance screen, `forgeVals()` still computes:

```js
// Dashboard.dc.html:3017
const composite = +(d.driving*0.30 + d.approach*0.35 + d.chipping*0.15 + d.putting*0.20).toFixed(2);
// Dashboard.dc.html:3145
composite: fmtSG(tHcp - composite),
```

Its four inputs are **not measured**. They are hardcoded literals at `Dashboard.dc.html:2761`:

```js
forge: { driving: 14.0, approach: 8.0, chipping: -3.0, putting: 2.0, ... }
```

So the composite is always **6.95**, and against a target of 5 the screen prints **−2.0** under a
real student's name. It is the same figure for every player. We rewired the rail to print a dash for
exactly this reason; this screen was missed. **We are fixing it on our side** — flagged here only so
you know that number in the demo was never real.

### 5.3 What real strokes gained would require

Strokes gained is defined per shot, against a baseline:

```
  SG(shot) = E[strokes to hole from where it started]
           − E[strokes to hole from where it finished]
           − 1
```

summed over a round. None of the three formulas above is that — all three are
`(benchmark − index) × constant`, a linear rescaling of a drill score into stroke units. There is no
shot, no start position, no end position, no −1.

**One thing in the codebase is genuinely SG-shaped**, and it's yours — the launch-monitor screen:

```js
// AtlasPlayer.dc.html:1107
const lmStrokes = p => 1.75 + 0.41 * Math.log(Math.max(1, p));
// AtlasPlayer.dc.html:1674
sg = +(lmStrokes(exp) - lmStrokes(act)).toFixed(2);
```

That is `E[from A] − E[from B]` — the right structure, missing only the `−1` and any notion of lie.
But `lmStrokes` is a two-constant curve on proximity, not a table indexed by distance **and** lie
(tee / fairway / rough / sand / recovery / green), and it is used on three clubs only. Nothing else
in either app consumes it.

> ### ❓ Question 4 — proxy, or the real thing?
> **(a)** Is the 30/35/15/20 composite a deliberate proxy you stand behind? If yes we keep the maths
> exactly as written and change only the **label** — that is the one thing we can't leave, because a
> golfer who knows the term will read it as strokes gained. *"Index gap"* or *"Handicap delta"*?
>
> **(b)** Which of the three formulas is canonical? They cannot all stay.
>
> **(c)** If you want real strokes gained: whose baseline table — Broadie's published one, your own,
> or a licensed set? And the harder half: what records each shot's start and end position? Your own
> copy at `Dashboard.dc.html:1816` says *"On-course strokes gained comes from your Arccos rounds"*,
> and Arccos appears nowhere else in either codebase. Is that the intended source?

### 5.2 Good news on the denominator

Your rail prints *"Benchmarks read against a 5 handicap"* and that 5 used to be hardcoded, so every
student's number was computed against a target nobody set. There is now a real
`golf.player_profile.target_handicap` column and the dashboard reads it. Nothing needed from you —
noted so you know the number moves with the player now.

### 5.4 Where SG is meant to land does not exist yet

Our own architecture record already rules that **Atlas must never compute SG, only read it**
(`STATUS.md:127-128`): `forge.index_expected` is your expected-value model, and *"only the sg it
produces is promoted"*. We stand by
that; two SG figures for one player is worse than none.

Worth knowing that the receiving end isn't built. `golf.player_metrics` — the table that note points
at — **does not exist**. The `golf` schema today has exactly three tables: `player_profile`,
`handicap_history`, `drill_progress`. And the vocabulary that would gate the write
(`config.ts:78`) has eight metric types — `mechanics_index`, `club_head_speed`, `handicap`,
`on_course_score`, `mental_game_index`, `routine_adherence`, `pressure_performance`,
`decision_quality` — and **none of them is strokes gained**.

Nothing needed from you here; it's our build. It does mean "wire up SG" is further out than the
roadmap implies, and it is a reason Question 4a (the label) is worth answering now — it's a fix we
can ship without any of this.

> ### ❓ Question 5 — the four indices 🔒
> `driving`, `approach`, `chipping`, `putting` are Forge's. Confirming what we assume: they are
> **0–54 handicap-like indices per domain, where lower is better**, so the composite is on the same
> scale as a handicap. Yes or no is enough.

---

## 6. Constants we invented, that should be yours

These are live in the code and shaping output right now. Each was a reasonable guess by us. We would
rather they were your numbers, or that you tell us the guess is fine.

| Constant | Value now | What it controls | File |
| --- | --- | --- | --- |
| `MASTERY_BANDS` | strong ≥ 67, building ≥ 34 | when a zone reads strong / building / dim | `config.ts:139` |
| `ZONE_TRAINABILITY` | con .85, cal 1.0, tra .7, perf .5 | which zone wins as growth zone | `config.ts:150` |
| `zoneDeficit(null)` | 0.5 | the assumed need for an unmeasured zone (see §2.1) | `scoring.ts:363` |
| alloc `FLOOR` | 0.08 | minimum share every zone keeps in the recommendation | `scoring.ts:430` |
| `COURSE_SWING_CREDIT` | 0.25 | how much an hour on the course counts as practice | `shared/volume.ts` |
| MI construction need | 1.0 / 0.5 / 0.2 | how hard the Mechanics Index verdict pushes construction | `scoring.ts:423` |

> ### ❓ Question 6
> `ZONE_TRAINABILITY` is the one that most changes what golfers are told — it decides which zone
> wins when two are equally weak. We set calibration highest as "lowest-hanging fruit". **Is that
> your view?** And is an hour on the course really worth 15 minutes of practice (`0.25`)?

---

## 7. What we are NOT asking

So your AI doesn't spend effort here — these are settled and built:

- The quiz instrument itself. Pinned, byte-identical to the source, never edited.
- Tendency, archetype, pattern, chip, Mechanics Index and efficiency formulas — all specified and
  working.
- The `GROWTH` prescription copy. Good as written.
- Anything about how the coach signs off Parallax videos. Built and working.

---

## 8. Order to answer in

Later questions depend on earlier ones.

1. **Q1 + Q2** (the minimum instrument) — everything about zones depends on whether all four are
   measurable. Answer these first; they are also the quickest.
2. **Q4a** (the SG label) — one word, unblocks a visible fix.
3. **Q3** (does the prescription vary) — determines whether §4's table is 16 cells or something
   larger.
4. **§4 A/B/D** (what picks a tier, what advances a phase, does the zone steer the week) — the big
   one, and smaller than it looks; see §4.1. Everything on the dashboard's coaching surface waits
   on it.
5. **Q6** (the constants) — a ratification pass, safe to do last.
6. 🔒 **Q4b, Q5** — need Forge, so whenever that conversation happens.

Q1–Q4a are answerable in a sitting and would unblock real work immediately.
