# What Luke has already specified in `Dashboard.dc.html`

**10 Sep 2026.** Read end to end — all 5,270 lines, every top-level declaration and every method
signature. Written because we kept "discovering" content that had been sitting in the file since
the handoff, and twice nearly asked Luke to invent something he had already written.

**Read this before asking Luke anything, and before building any coaching logic.**

---

## The one-sentence finding

> **Luke specified the content AND the rules. Nothing evaluates them. Every selector is a hardcoded
> literal or a manual toggle.**

The gap is not design. It is the wiring between the quiz's answers and the tables he already wrote.

---

## 1. The structure of the file

| Lines | What |
| --- | --- |
| 1–2172 | Markup. 1,237 inline `style=` attributes, `{{ }}` bindings, `<sc-if>`/`<sc-for>`. |
| 2174–2721 | **33 top-level constants — the product spec. This is §2 below.** |
| 2723–2790 | `state` — 18 keys, all literals bar `view` and the two handicap IIFEs. |
| 2792–5268 | `class Component` — 39 methods, all computed-value builders. |

---

## 2. The content Luke has already written

Every row here is complete, specified, and in the file today. **None of it needs designing.**

| Constant | Line | What it is |
| --- | --- | --- |
| `DRILL_DEFS` | 2320 | **6 drills fully specified** — `sga30`, `chip20`, `ryp20`, `stroke20`, `appr20`, `drive20`. Each with setup steps, a scoring rubric, tally columns, conditions, and a `verdict(t)` **function** that turns tallies into a score. |
| `STEPS` | 2509 | **The 5-step build ladder** — Pivot → Freezers → Smoothie → Foam ball → Real ball. 23 drills, each with a `std` (pass standard) and a `cam` flag for camera verification. **Each step carries a `cond` — its advancement criterion.** |
| `TIERS` | 2678 | **3 tiers × 4 phases.** Foundation/Builder/Competitive with floors of 2/5/10 practice hrs/wk and 2/5/10 play hrs/wk. Every one of the 12 cells has a label, weekly hours, session mix, home/range split and a **full 7-day schedule**. |
| `CHIP_LEVELS` | 2191 | **A 4-rung tolerance ladder** — two drivers → one driver → one wedge → two feet. Full scoring rows per rung. |
| `WHY` | 2604 | **28 entries** — one sentence of mechanism per drill, keyed by drill name. |
| `BASELINE_CARRY_TABLE` | 2178 | Carry distance → handicap baseline, 8 bands. Drives `drivingBaseline()`. |
| `GAP_SAMPLE` | 2249 | 13-club gapping table — carry, spread, bias. |
| `COURSES` | 2267 | 12 real-shaped courses with rating, slope, par string; hole yardages derived from par + card total. |
| `IMPACT_OPP` | 2645 | 3 impact-opposite drills, each flagged `ball: true/false` — the ones needing a ball stay inert until real-ball transfer. |
| `FITNESS` | 2670 | 5 movement screens with pass/limited values. |
| `CLUBS` / `SCATTER` | 2654 / 2664 | Dispersion plot geometry, deterministic offsets. |
| `SESSION_DOMAINS`, `INDEX_GROUPS`, `DRILL_PICK` | 2484 / 2306 / 2312 | The 4-domain assessment session; index drill vs diagnostic drill per domain. |
| `SG_W` | 2636 | The strokes-gained weights, .30/.35/.15/.20. |
| `BLOCKS`, `ZONE_COLOR`, `ZONE_LETTER` | 2491–2493 | The four zones — the same vocabulary the Practice DNA quiz grades. |

---

## 3. The rules he stated but nothing evaluates

This is the actual gap, and it is narrow. In each case the rule is **written down in the file, in
prose**, and no code reads it.

| Rule, as Luke wrote it | Where | What decides it today |
| --- | --- | --- |
| Step advancement — e.g. *"All four drills verified on camera"*, *"Path at zero, shaft lean right, ground force excellent, trunk angle decreasing"* | `STEPS[n].cond` | **Nothing.** `cond` is rendered as text at `:782` and passed through at `:3579`. Never compared against drill progress. |
| Pivot route — *"The Anchor … the route when dorsiflexion or lead-hip depth is limited"* | `STEPS[1].variants.anchor.blurb`, 2518 | **Nothing.** `state.pivot: 'cannon'` is a literal (`:2757`); `:3599` is a manual toggle. `FITNESS` reports *"Ankle dorsiflexion: Limited"* and *"Overhead deep squat: Heels lift"* — exactly the stated criterion — and is never read. |
| Which tier a player is on | `TIERS` floors, 2678 | **Nothing.** `state.tier: 'builder'` literal (`:2783`). |
| Which phase they are in | `TIERS[t].phases`, 2679+ | **Nothing.** `state.phase: 2` literal. `phaseTabs` (`:3450`) is a manual 1–4 picker. |
| Which chipping rung applies | `CHIP_LEVELS`, 2191 | **Nothing.** No selector found. |

**The Practice DNA quiz is not consulted by any of them.** `buildAtlasData()` never calls the
scoring engine, so no answer a golfer gives reaches this file.

---

## 4. The joins that are one wire away

Where the two halves already exist in matching units and simply are not connected:

1. **Volume answers → tier.** Intake asks `practiceMinutes` (weekly, full swing, excludes rounds)
   and `courseHours` (weekly, on course) — `shared/contract.ts:20-25`. `TIERS` is keyed on `floor`
   (practice hrs/wk) and `play` (course hrs/wk): 2/2, 5/5, 10/10. **Same quantities, same units.**
2. **Drill sign-off → step advancement.** `STEPS[n].cond` says "verified on camera"; drills carry
   `cam: true`; `golf.drill_progress` has `verifiedAt` and is already written by the coach's
   Parallax check-off. `DONE` uses refs (`'2-P1'`) matching the step-ref format. The criterion, the
   flag and the data all exist.
3. **Fitness screen → pivot variant.** The blurb names the criterion; `FITNESS` reports it.
4. **Phase week → calendar.** `weekRows` reads `ph.week`, and `buildSchedule(ph)` feeds the schedule
   rows and the `.ics` export from the same array. The Calendar is downstream of tier+phase, not
   separate logic — fix those two and it lights up.

---

## 5. What is genuinely undecided

After all the above, the questions actually left for Luke:

- **What picks the tier** — self-selected commitment level, coach-assigned, or derived from the
  volume answers?
- **What advances a phase** — weeks at floor, coach sign-off, a re-test?
- **Does the growth zone reshape the week**, or only the emphasis within a session?
- **The SG label** — the composite is not strokes gained (see the ruleset doc §5).

That is four questions, not a curriculum.

---

## 6. Standing rule

Before proposing any coaching logic, or writing any question for Luke: **grep this file first.**

```bash
grep -nE "^(const|let|function|class) " /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html
```

33 constants. If the thing you are about to specify is a table of golf content, it is probably
already one of them.
