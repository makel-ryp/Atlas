# The coaching ruleset — what Practice DNA should DO with an answer

**9 Sep 2026. For Luke, to work through with his AI.**

This is the companion to `ASK-luke-forge-repo.md`. That doc asks for the **numbers** (Forge, strokes
gained, the benchmark tables). This one asks for the **rules** — what the coaching system actually
does differently because a golfer answered the quiz one way rather than another.

Its §3 has a single line that this whole document expands:

> **current curriculum zone** and **plan phase (1–4)** — displayed per player; no rule sets them

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
   and is never seen again. On the dashboard, `tier` and `zone` are empty strings with the comment
   *"Atlas curriculum tier. Not built."*

So: the quiz currently changes what a golfer is **told about themselves**, and changes nothing about
what the product **does with them**. Section 4 is the ask that fixes that.

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
  ⇒ moderate assumed need" (`scoring.ts:363`). So the recommended-practice bars show calibration and
  performance figures derived from an assumption, not from anything the golfer said. This is the one
  place in the pipeline we are currently printing a made-up number, and we would like to stop.
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

This is the piece that does not exist in any form, and the reason for this document.

On your dashboard every player carries a **tier** and a **zone**. In our data layer both are the
empty string, with this comment (`server/protoData.ts:49`):

```js
// ── NO PRODUCER. Present so his render finds the key, empty because nothing writes it.
/** Atlas curriculum tier. Not built. */   tier: string
/** Atlas curriculum zone. Not built. */   zone: string
```

Nothing sets them because no rule exists that says what they should be. The quiz result is not
passed to the dashboard at all — `buildAtlasData()` never calls the scoring engine.

### What we need from you

**A. The tier ladder.** Your prototype shows a plan phase 1–4.

- What are the four tiers called, and what does each one mean?
- What puts a new golfer on a tier on day one — handicap? the quiz? a coach's judgement?
- **What advances someone?** This is the important one. A number of sessions, a coach sign-off, a
  measured improvement, a re-test? Advancement criteria are the difference between a label and a
  curriculum.
- Can a player move *down*?

**B. The zone assignment.** We already compute a growth zone from the quiz. Is that the same thing as
your dashboard's "zone", or are they different concepts that happen to share a word? If the same:
does our rule (weakest measured zone by deficit × trainability, gated by the Mechanics Index) match
what you intended, or would you assign it differently?

**C. The drill mapping.** 🔒 partly — the drill library itself is Forge's, but the *rule* is yours:
given a tier and a zone, how are drills chosen? A fixed list per tier-and-zone cell? A pool the coach
picks from? Ordered, or parallel?

### The shape of the answer

The most useful artifact is a **table**, and it does not need to be complete on the first pass — one
filled row tells us the shape and we can bring you the rest:

| Tier | Zone | What the player is told to do | What advances them |
| --- | --- | --- | --- |
| 1 | Construction | … | … |
| 1 | Calibration | … | … |
| … | … | … | … |

Four tiers × four zones is sixteen cells. If a cell is unreachable or meaningless, say so — that is
information too. If the real structure is not a grid, tell us what it is and we will build that
instead; a decision tree or "tier sets the intensity, zone sets the content" both work fine.

---

## 5. Strokes gained

`ASK-luke-forge-repo.md` §1c and §2 already cover the two `sgFor` implementations and the
`BENCH`/`SGA_BENCH` divergence. Not repeating those. Two things are new since it was written.

### 5.1 What the dashboard computes today

`proto/Dashboard.dc.html:2636` and `:3017`:

```js
const SG_W = { driving: 0.30, approach: 0.35, chipping: 0.15, putting: 0.20 };
const composite = +(d.driving*0.30 + d.approach*0.35 + d.chipping*0.15 + d.putting*0.20).toFixed(2);
```

and the figure labelled **Total SG** is then `targetHandicap − composite`.

**This is not strokes gained.** Strokes gained is defined per shot, against a baseline:

```
  SG(shot) = E[strokes to hole from where it started]
           − E[strokes to hole from where it finished]
           − 1
```

summed over a round. It requires a **baseline expected-strokes table** indexed by distance and lie
(the tour-average tables from Broadie's work, or your own). **No such table exists anywhere in either
codebase, and nothing references one.** What the formula above produces is a handicap-gap figure —
useful, arguably more useful for coaching — but a golfer who knows the term will read it as strokes
gained and it isn't.

> ### ❓ Question 4 — proxy or the real thing?
> **(a)** Is the 30/35/15/20 composite a deliberate proxy you stand behind? If yes we keep it exactly
> as written and only change the **label**, because the current one is the one thing we can't leave.
> What should it be called? *"Index gap"* and *"Handicap delta"* are two options.
>
> **(b)** If you want real strokes gained: whose baseline table, and — the harder half — what
> measures each shot's start and end position? That is a per-shot data capture we do not have today
> and it is a Forge question before it is an Atlas one.

### 5.2 Good news on the denominator

Your rail prints *"Benchmarks read against a 5 handicap"* and that 5 used to be hardcoded, so every
student's number was computed against a target nobody set. There is now a real
`golf.player_profile.target_handicap` column and the dashboard reads it. Nothing needed from you —
noted so you know the number moves with the player now.

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
4. **§4 A/B/C** (the tier ladder) — the big one. Everything on the dashboard's coaching surface waits
   on it.
5. **Q6** (the constants) — a ratification pass, safe to do last.
6. 🔒 **Q4b, Q5** — need Forge, so whenever that conversation happens.

Q1–Q4a are answerable in a sitting and would unblock real work immediately.
