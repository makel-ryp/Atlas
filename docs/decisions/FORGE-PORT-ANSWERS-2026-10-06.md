# FORGE port — Makel's answers

Worked through live on **2026-10-06**. Each answer is the decision, then what it costs and what
it creates. Where Makel overruled a recommendation that is recorded as an overrule, not rewritten.

## Settled before the walkthrough

| # | Question | Answer |
| --- | --- | --- |
| T-105 | One backend or two? | **ryp-core.** Build Spec §1 and §6.2 superseded. |
| T-119 | Is a FORGE rep something a coach verifies? | **No.** The scored session IS the evidence. |
| T-113 | Alpha on production or a branch? | **A new Neon branch.** |
| T-111 | Rotate the Firebase key? | Later. Exposure measured: ~84% of the body, local disk + Anthropic API, no third party. |

## Closed without asking — already answered elsewhere

| # | Question | Closed by |
| --- | --- | --- |
| 17 | Does `AGENT-BRIEF.md` exist? | It does — `docs/architecture/AGENT-BRIEF.md`. Two agents looked at the wrong path and wrote "missing" into shipped source. Corrected. |
| 16 | Does the FORGE Coach Console need its own DB role? | **No.** Atlas envelops the coach dashboard (2026-08-24). |
| 20 | Does a coach assign from Atlas or from Luke's Console? | **Atlas.** Same decision. |
| 33 | Does FORGE host relationship UI? | **No.** Atlas is the only consent door; `forge_app` is read-only on `public.user_relationships`. |

## Batch 1 — the ones that change the DDL

### 1 · Vocabulary → **`facet` · `assignments` · `range_sessions`**

Luke's table name wins. `facet` for the four-way split, matching the spec and `forge-math.js`.
`golf.range_sessions` for the per-visit grain, distinct from `golf.practice_sessions` (per DAY).

⚠️ **Creates work:** three eco files reserve the name `prescriptions`. They are now stale pointers
and must be repointed to `atlas.assignments` in the same change, or the next reader hunts a table
that does not exist. The player-facing string stays *"PRESCRIBED BY YOUR COACH"* and the coach UI
stays *"ASSIGN WORK"* — the table name is not the UI copy.

### 2 · `source='auto'` → **SHIPS IN v1** *(overrules the recommendation)*

The recommendation was to declare the value and leave it bypass-only, because `METRIC-MAP` states:
*"Forge's primaryLeak stays private precisely so two competing priority labels are never shown to
the same player."* Makel chose to ship it, so a player with no coach gets a suggestion instead of an
empty screen.

**Security is unchanged** — `auto` is reachable only through `TO forge_svc`, which is a service
principal, not a player. The escalation trap holds exactly as designed.

⚠️ **What it creates, and how it is handled:** an auto row's `note` would publish Forge's
`primaryLeak` into the shared layer, which is the thing METRIC-MAP forbids. The note on an auto row
is therefore **templated generically** rather than carrying the leak label. Raise it if you want the
leak itself shown.

⚠️ **Second-order:** with coach, player and auto rows all live, the precedence rule (coach > player
> auto) is now load-bearing in the UI, not just the schema. A coach order must visibly outrank a
Forge suggestion on the same screen.

### 3 · Shot-grain data → **COACHES SEE EVERY SHOT**

`atlas_app` gets SELECT on `golf.range_shots`. Enables shot-pattern coaching later.

⚠️ **Note the asymmetry it creates:** nothing in the product reads it yet — Luke's Console shows only
facet-level numbers — so this is a grant ahead of a screen. It is also a real privacy step: a coach
can reconstruct every ball of every session of every student. Ungranting it after coaches have used
it is a conversation with coaches, not a migration.

### 4 · `blocks_per_week` mid-week change → **ASK LUKE** (it is his cadence rule)

Building the history sibling **anyway**, because it is additive and free now and impossible to
backfill later. The apply-to-which-week logic ships behind a flag, defaulting to *next week*.

Why it matters: current-only storage is gameable. A player sitting at 1 of 5 blocks drops their
target to 1/week and is instantly "on track" — and the coach's "behind" flag silently clears.

**→ For Luke:** does a mid-week change to `blocks_per_week` apply to the current week or the next?
