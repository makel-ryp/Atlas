# Plan — get Luke's build running

**28 Aug 2026.** Replaces the framing that produced the earlier schema work. The goal is not a data
model; it is **Luke's prototypes running on real data.** Schema work is justified only by which of
his screens it turns on.

---

## 1. Where his build actually stands

Proven approach (shipped 28 Aug): Atlas's Express serves his `.dc.html` untouched and substitutes the
hardcoded literals server-side. His `support.js`, his layout, his screens — our rows. `/proto/dashboard`
does this today for the roster.

His coach Dashboard has **12 screens**. Scored by whether we can feed them *now*:

| # | Screen | Feeds from | State |
| --- | --- | --- | --- |
| 10 | **roster** | `users`, `user_relationships`, `org_memberships`, `player_profile` | ✅ **RUNNING on real data** |
| 11 | **profile** (player file) | identity + `handicap_history` real; reads/intake/strike map not | 🟡 **PARTIAL — cheapest next win** |
| 9 | **thread** (Team) | needs `atlas.messages` — a two-way thread. `coaching_notes` is NOT this | ⛔ 1 table |
| 12 | **intake** (form) | needs `atlas.intake_submissions` | ⛔ 1 table |
| 1 | **today** | needs `drill_library`, `practice_days`, stake config | ⛔ 3 tables |
| 2 | **cal** (Calendar) | needs `practice_days` | ⛔ 1 table |
| 3 | **plan** | needs commitment/tier reference + `practice_days` | ⛔ 2 tables |
| 4 | **build** (01 Construction) | needs `drill_library` + `drill_progress` | ⛔ 2 tables |
| 5 | **evidence** (02 Calibration) | needs calibration, LM imports, `target_handicap` | ⛔ 3+ tables. **His largest screen** |
| 6 | **transfer** (03 Transfer) | needs `practice_days` + `drill_progress` | ⛔ |
| 7 | **perf** (04 Performance) | needs `practice_index_results`, sim rounds, SGA | ⛔ |
| 8 | **fitness** | `FITNESS` literal is referenced by **no markup** — dead in this build | — ask Luke |

**1 running · 1 partial · 9 blocked on tables · 1 dead.**

## 2. What that means

**Getting his build running IS the schema work** — but ordered by his screens rather than by an
abstract model. That is the only change of direction needed. The earlier pipeline was not wasted: its
extraction and routing artifacts are the input to this, and they say exactly which literal each screen
reads.

Two rules, both learned the hard way:

- **Merge, never replace.** His rows carry ~20 fields; we produce five. Overwrite the row and half his
  UI blanks, making the design look broken rather than incomplete.
- **Never a real name beside a fake number.** It reads as live and is not. Either inject the whole
  row's meaning or leave his sample and label it. The injected banner is not decoration.

## 3. Order of work — each step turns on named screens

| Step | Build | Turns on |
| --- | --- | --- |
| **1** | Widen injection into `state.forge` + the player-file fields we already have | finishes **profile**, adds real numbers to **perf**'s header |
| **2** | `golf.practice_days` (the practice log) | **cal**, and the log half of **transfer** and **today** |
| **3** | `golf.drill_library` + `golf.drill_progress`, per-column writers | **build**, **today**'s prescription, the ladder in **transfer** |
| **4** | `golf.player_metrics` + `practice_index_results` | **perf**, the composite and DNA radar |
| **5** | `atlas.messages` | **thread** |
| **6** | `atlas.intake_submissions` + the read/strike tables | **intake**, finishes **profile** |
| **7** | calibration + LM imports + `target_handicap` | **evidence** — largest, so last |

⚠️ **Nothing here is built until it feeds one of his screens.** A table with no screen reading it is
the fiction this plan exists to avoid.

## 4. Decisions that block steps, not guesses to make

- **`fitness`** — dead literal, no markup reference. Cut, or a dropped screen? *(Luke)*
- **Three composite formulas, five sites** — which is authoritative? Blocks step 4. *(Luke)*
- **`Contender`** in `ROSTER[].tier` is not a key in `TIERS`. Stale rename, or a fourth tier? *(Luke)*
- **`target_handicap`** has no column and is the denominator of every strokes-gained figure on his
  screens. Blocks step 7; trivial to add once the meaning is confirmed. *(Luke)*
