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

## Batch 2 — access, the note record, and the credential

### 5 · Forge access → **A `forge` ROLE ROW, GRANTED SEPARATELY**

Forge is opt-in per user. `user_app_roles_atlas_signup` keeps admitting only `('atlas','user')` and
does **not** auto-grant forge.

⚠️ **Creates work, and it is on the alpha's critical path:** an admin "grant Forge access" action
(the audited `billing_svc` + `withRlsBypass` pattern `parental-consent` already uses), one control in
`Admin.tsx`, and a line in the alpha runbook. **Without it every tester 403s on their first Forge
request** — so this ships before the first tester, not after.

Upside: a clean lever for a paid tier later without a migration, which matters because pricing is
frozen until Luke approves.

### 6 · Atlas-authored notes → **APPEND-ONLY FOR EVERYONE**

Narrow `atlas_app`'s grant on `atlas.coaching_notes` to `update (deleted_at, updated_at)`. The whole
table becomes append-only **by privilege**, for both apps, which drops the `source_app <> 'forge'`
policy predicate entirely. A correction is a new note.

This is the better shape for the reason the schema file already argues elsewhere: a rule enforced by
a grant cannot be "simplified away" by a later policy edit, and two halves of one table behaving
differently is exactly what a later edit flattens.

### 7 · Retracting a note → **AN AUDITED ADMIN PATH**

Coaches cannot retract. An admin can soft-delete through an audited route.

Mechanically this needs care, because of the defect that nearly shipped in this very file: an
`UPDATE` policy that merely *intends* to be bypass-only, with no policy referencing
`app_private.rls_bypass()`, is **denied by default and matches zero rows silently**. So the
retraction needs an **explicit** `FOR UPDATE USING (app_private.rls_bypass()) WITH CHECK (…)` policy
alongside the narrowed grant — the grant permits the column, the policy decides the principal.

⚠️ Also fix the route: it currently returns **404** on a refused retraction, which reads as "no such
note". It must return **409**.

### 8 · `forge_svc` → **ATLAS HOLDS IT**

FORGE's API runs inside Atlas's Express server as `server/routes/forge.ts`, behind `attachUser` and
`requireConsent`, alongside the nine existing routers. Luke's client calls that API; **he never holds
a database credential.**

One credential store, one deploy, and the ladder and assignment completion — the two things
`forge_svc` alone may stamp — cannot be written by code outside this repo. This also confirms the
assumption the whole gap assessment was built on, so it stops being an assumption.

## Batch 3 — behaviour, not schema

### 9 · Provisional sessions → **COUNT toward the streak and blocks-per-week**

The spec asks this of itself (§9) and does not answer. The answer is that **the streak measures
attendance, not quality.** A player who drove to the range and hit 12 balls was there.

The protection that matters is unchanged: a provisional session is still excluded from the current
picture and still never becomes a headline number (§READ THIS FIRST). So quality is protected where
it is actually at risk, and the streak stops creating an incentive to type in five fake shots —
which is the failure mode that corrupts the data this whole product exists to collect.

**Reads filter `completed_at IS NOT NULL` for the index, and do NOT filter it for the streak.**

### 10 · Today calendar → **TWO DISTINCT ROWS** *(overrules the recommendation)*

A Forge range visit and a self-logged practice day stay visually separate in the day cell.

The recommendation was to merge, on the grain argument. Makel chose separation, and the reason it is
a good call is **provenance**: a merged cell cannot show the player which part of their day was
*measured* and which part they *typed*. Keeping them apart makes the distinction visible at a glance
on the most-used screen — the same measured-vs-modelled discipline the rest of this port enforces.

No schema change either way; the join is `(user_id, played_on)` ↔ `(user_id, session_date)`.

### 11 · A player's self-set assignments → **COACH SEES THEM, READ-ONLY**

The spec flagged this as assumed rather than decided. Now decided, and it matches the assumption.

⚠️ **Changes a policy:** `assignments_update` must **exclude `source='player'` rows from coach
revocation**, not merely rely on precedence. As designed, any approved coach could reword or revoke
them. A coach needs to know what their student chose to work on; a student's own plan is not the
coach's to delete.

Conflict is already handled by precedence — a coach order outranks a player's on the same screen.

### 12 · Collapsed notes → **ONE RECORD PER PLAYER**

A Forge coach sees Atlas-authored notes and vice versa. That is the point of one backend and it is
the documented Locker Room fix.

**No note becomes visible to anyone who could not already read that student** — both sets are
coach-only and both sit behind `app_private.coaches()`. The change is between coaches of the same
student, not between a coach and a stranger. The failure it prevents: a colleague's note about a
safeguarding issue being invisible because it was typed in the other app.
