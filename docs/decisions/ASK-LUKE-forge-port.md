# For Luke — FORGE on ryp-core

**2026-10-07.** FORGE is being built against RYP's shared database (`ryp-core`) with Firebase
identity, not Supabase. Build Spec §1 and §6.2 are superseded — the replacement is
[`FORGE-ON-RYP-CORE.md`](../FORGE-ON-RYP-CORE.md). **Your §2, §3, §4, §5 and §7 are untouched.**

Makel has answered 24 of the 34 open questions the port raised. **Six need you.** Two further items
are notifications, not questions — numbers in your prototype will move, and you should hear it from
us rather than notice it.

> 📌 **If you are going to put this in front of an AI, give it
> [`FORGE-PORT-ANSWERS-2026-10-06.md`](FORGE-PORT-ANSWERS-2026-10-06.md) as well, and tell it to read
> the *"Read this first"* section before anything else.** That section is a standalone briefing on the
> database side — how identity and authorisation work now, which of your §1 tables exist under other
> names, and the handful of Postgres rules here that an assistant reasoning from the Build Spec alone
> will get confidently wrong. Without it, an AI handed a list of changes tends to either invent a
> schema or argue with decisions that are already closed.

---

## Six questions

### 1 · Putt 18 calibration — `putting_base` and `k` 🔴 blocks showing a putting index

Your own spec is emphatic, twice: §7.2 *"Neither `putting_base` nor `k` is derivable from the
prototype — they must be set against known reference rounds"*, and §7.4 *"Needs reference rounds, not
a guess."* They currently ship as `base 8, k 1.2`, tagged **PROVISIONAL**.

We are honouring that: **no `practice_index` is written for a (putting, Putt 18) row until these are
fitted.** A provisional constant stamped into stored history cannot be distinguished later from a
real one.

**What we need:** two reference rounds — a scratch player's Putt 18 and a 20-handicap's — or your
numbers plus where they came from.

### 2 · Which "behind" is the coach's flag? — two metrics with one name

§5.4 says `blocks_per_week` *"drives the streak, the nag, and the coach's 'behind' flag"* — i.e. a
**cadence** miss: they aren't practising as often as they committed to.

**Both of your prototypes compute something else entirely** — an **assignment-completion** miss:
they aren't doing the work I set. Those are different facts about a player and they disagree
regularly: someone can practise five times a week and ignore every prescription.

Neither the streak nor the nag has a formula anywhere in the package.

**What we need:** which one is the flag, and the formula for the streak and the nag.

### 3 · Does a mid-week `blocks_per_week` change apply to this week or next?

It is your cadence rule, but it decides whether the table needs a history sibling — so it decides a
**migration**, not just behaviour.

We are building the history sibling regardless, because it is additive and free now and impossible to
backfill later. Default is **next week**.

Why it matters: current-week-only is gameable. A player sitting at 1 of 5 blocks drops their target
to 1/week and is instantly "on track" — and the coach's "behind" flag silently clears.

### 4 · The Coach Console note panel prefills and overwrites

Your spec says `coach_notes` is **append-only, never edited in place**. Your Coach Console
(`:660`, `:825-828`) prefills the textarea with the existing note and overwrites it on save.

Under append-only storage — which is what we have built, and Makel has extended it to Atlas-authored
notes too, enforced by privilege rather than convention — **keeping the prefill means every save
silently duplicates the previous note.**

**What we need:** confirm the panel becomes an empty box that appends, and that the history displays
above it.

### 5 · The prototype lets a player set their own rung

§4 is unambiguous: *"The ladder is the only thing that sets level"*, and §5.5 *"No API accepts a
coach-supplied level."* But `FORGE.dc.html:3490` and `:4821` both `persist({ rungs: n })` straight
from a tap.

We have built your spec, not your prototype: **a rung is writable only by the service principal that
evaluates the ladder.** A player tapping a level will get a refusal.

**What we need:** confirm that is right, and tell us what the tap was for — if it is a debug affordance
it just goes; if players are meant to choose a difficulty, that is a different feature and it needs a
name that is not "level".

### 6 · `CAL.benchmarks` — where did it come from?

Makel has chosen to ship `CAL.benchmarks` over the Arccos-cited table, so the numbers are settled.
**The provenance tag is a separate question.**

It is tagged **MEASURED**, which is the strongest tag in your own scheme, but the package carries no
source for it — and the app's own comment contradicts it: *"flatter than folklore: scratch–4.9 hit
50%"*, against the 62% the table claims.

**What we need:** the source. Without one the tag is downgraded from MEASURED, because a provenance
tag that is not true is worse than no tag — everything downstream trusts it.

---

## Two notifications — numbers in your prototype will move

### `baselineHandicap` — Build Spec §2.3 is amended, step table → interpolation

**Makel has signed this off.** Three sources disagreed on `baselineHandicap(225)`: your §2.3 step
table says **15**, `forge-math.js` interpolates to **12.5**, and `forge-math.test.js:33` expects
**7.5**.

The module is right and the spec is being amended to match it, because the step model has a cliff:
**234 yd → 15 and 236 yd → 10.** Two yards of carry, five handicap strokes. Your own code comment
makes exactly this argument — *"a step table would put 234 and 236 yards a full stroke apart"* — and
it checks out numerically.

- Build Spec §2.3: step table → linear interpolation ✍️
- `forge-math.js`: **no change**, it was already correct
- `forge-math.test.js:33`: the **input** is wrong, not the expectation — 245 yd is the midpoint of
  10→5, not 225. Fix that one number and your suite goes **57/57**

### Driving asymmetry is being fixed to symmetric — as you flagged

Your spec calls it out: *"Asymmetry — prototype bug, decide before building. The formula above
reproduces the prototype exactly: only column 0 (bad left) counts as a bad miss… the intended
behaviour is symmetric."*

We are building **symmetric**. A miss is a miss. Storage is unaffected, so this is a formula change
rather than a migration — but **it moves every driving index**, so the numbers you have been looking
at will shift.

---

## One pre-existing item, still open from before this port

**Competitive Phase 3 is called "Transfer Introduced" and names Transfer on zero of its seven day
labels.** Raised before FORGE arrived; nothing in the package resolves it.

---

## What is NOT open, so you don't need to argue it

| Settled | By |
| --- | --- |
| One backend — ryp-core, Firebase identity. Supabase is off. | Makel, 2026-10-06 |
| Atlas is the only coach surface. The Coach Console's features are absorbed into it. | Makel, 2026-08-24 |
| A FORGE rep is **not** coach-verified. The scored session is the evidence. | Makel, 2026-10-06 |
| `forge_svc` lives inside Atlas's server. FORGE's client calls our API; no DB credential leaves it. | Makel, 2026-10-07 |
| `source='auto'` ships in v1, with a generic note so `primaryLeak` stays private. | Makel, 2026-10-07 |
| Makeables carries the putting rungs; Putt 18 produces the index. | Makel, 2026-10-07 |
| The 30-minute block is permanent and unstored. | Makel, 2026-10-07 |
| Teams and leaderboards are out of v1. | Makel, 2026-10-07 |
| We ask for a **carry reference scale**, not gender. | Makel, 2026-10-07 |

---

# Luke's answers, received 2026-10-13 — and what checking them found

Every claim below was checked against the **vendored** package (`proto/forge/`), not taken on trust.

## 🔴 He is working from a NEWER BUILD than the one we were given

Three of his line citations are **past the end of our file**, and one of his symbols does not exist in
it:

| Luke cites | In our copy |
| --- | --- |
| `:5423`, `:5460`, `:5719` | **`FORGE.dc.html` is 5,100 lines.** None of these exist. |
| `weekCountAt` (the Q2 bug) | **`grep` returns nothing.** The function is not in our copy. |
| `:4114` *"a goal, not a streak"* | Our `:4114` is `const dy = ((e.clientY - r.top) / r.height) * 2 - 1;` |
| Q5: *"the lines are `:4152` and `:5719`, not `:3490`/`:4821` — those are the dispersion block and p18Tap"* | **Inverted.** `:3490` and `:4821` are the **only two** `persist({ rungs })` writes in the file. His `:4152` is `v.p18Score = …`, the Putt 18 score display, and `:5719` is blank. |

That last one matters practically: **anyone following his line numbers would break the Putt 18 score
display and leave the rung write in place.**

➡️ **Asking for the full `.md` does not fix this. Ask for the FILE** — his current
`FORGE.dc.html`. His reasoning is sound; it is about a build we do not have.

## ✅ Q1 is the most valuable thing in the reply, and it checks out exactly

He derives Putt 18's `k` from a constant already in our copy rather than from a reference round:
`CAL.sgRate.putting = 0.11` (`forge-math.js:28`), 20 strokes scratch→20-handicap × 0.11 = 2.2 SG, so
**k = 20 / 2.2 = 9.09**. Shipped is `putt18: { base: 8, k: 1.2 }` (`:45`) — **7.58× too small.**

Run against the real module, over a realistic SG spread:

| SG | shipped `k = 1.2` | `k = 9.09` |
| --- | --- | --- |
| −1.1 | 9.30 | 18.00 |
| 0 | 8.00 | 8.00 |
| +1.1 | 6.70 | −2.00 |

**The shipped constant compresses every golfer alive into a 2.6-stroke band around 8.** His "~2.6" is
right to one decimal. That is a **bug, not a calibration preference**, and it is fixable today.

⚠️ **This overturns decision C1.** The putting `practice_index` was going to ship NULL until a
reference round arrived. It no longer has to: ship `k = 9.09` tagged **ESTIMATED** now, and keep
`base` behind the existing gate until Luke supplies one reference round. His reasoning for the split
is correct — **a slope survives a biased baseline; an intercept does not.**

## ✅ Q6 — his framing is sharper than mine, and I had the wrong pair of tables

I put the question to Makel as *"`CAL.benchmarks` vs the Arccos-cited `BENCH`"* — an external-source
question. **The real defect is internal**, and it is in one object with both halves tagged MEASURED:

- `CAL.carry.m` (`:30`) says scratch ↔ **280 yd** — and this is the table that **feeds scoring**.
- `CAL.benchmarks` (`:39`) says scratch ↔ **250 yd** — this is **display**.

They should be inverses of each other. They are 30 yards apart. Verified by running the module:

```
baselineHandicap(250, 'm') = 6.3     <- a player told "scratch carries 250", carrying exactly 250
baselineHandicap(280, 'm') = 0       <- what CAL.carry actually thinks scratch is
```

**So the app can tell a player a scratch golfer carries 250, watch them carry 250, and score them
6.3 — on the same screen.** Downgrade `MEASURED` → `ESTIMATED` as he says, numbers unchanged, and
record this as the real finding.

## Usable now, without his file

| | |
| --- | --- |
| **Q1** | ✅ Ship `k = 9.09` ESTIMATED; `base` stays gated. Overturns C1. |
| **Q3** | ✅ Next week, both directions, "takes effect Monday". Matches what is built. |
| **Q4** | ✅ Empty composer that appends. Moot anyway — there is no Console. |
| **Q6** | ✅ Tag downgraded; the internal 30-yard conflict recorded. |
| **Q2** | 🟡 **Decisions usable, citations not.** Coach's flag = assignment completion; cadence drives the weekly goal and one reminder; **no streak, and none should be built** — amend §5.4 rather than building one. The `weekCountAt` sessions-vs-distinct-days bug cannot be confirmed against our copy. |
| **Q5** | 🟡 **Decision usable, line numbers wrong.** Remove the write, keep the four-level list read-only. Use **`:3490` and `:4821`**. |
| Notifications | ✅ Both signed off — `baselineHandicap(225) = 12.5`, fixture input is the error, symmetric driving accepted. |
| Pre-existing | ✅ Moot — the phase structure was deleted in the 5-stage pivot. |
