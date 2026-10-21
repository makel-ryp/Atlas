# The three hidden zones — Makel reopens two, and reframes the third

**2026-10-21.** Supersedes the "hidden, no producer" reasoning in `server/protoData.ts`
(`FORGE_ONLY_SCREENS`, `VIDEO_TEST_SECTIONS`) for the zones named below. **Nothing is unhidden
yet** — this records the direction and what each one now needs, so the next agent does not read the
old comments as settled.

## What was true, and why it is changing

Three of the four zones are hidden from every account:

| Zone | Why it was hidden | Status now |
| --- | --- | --- |
| 02 Calibration | *"this whole 10 shots one 7 iron section is unachievable"* | 🔄 **Revisit — capture via Parallax** |
| 03 Transfer | every number came from a hardcoded `state.forge` seed | 🔄 **Reopened — practice from FORGE, on-course from RED** |
| 04 Performance | same hardcoded seed | 🔄 **Reframed — on-course dashboard, RED involved** |

## 🔴 THE SINGLE FACT THAT GOVERNS ALL THREE

**`golf.rounds`, `golf.round_holes`, `golf.round_shots` and `golf.player_metrics` DO NOT EXIST.**
Verified on alpha 2026-10-21: of that group only `golf.handicap_history` is live (7 columns, 14
rows). METRIC-MAP §`golf` already specifies all of them and already names their writers — but a
specified table is not a table.

So two of these three zones are blocked on the **same** missing thing, and it is not a screen: it
is the on-course record. Building either screen before those tables exist reproduces exactly the
defect that got them hidden — a number with no producer.

Role readiness, checked the same day: **`red_app` EXISTS** in ryp-core (NOBYPASSRLS, can log in),
so Red has a door and nothing to write through it. **`parallax_svc` does NOT exist**, though
METRIC-MAP names it as a per-source writer on `player_metrics`.

## 02 Calibration — revisit, because the objection was to the SPEC, not the idea

**Makel, 2026-10-21:** *"in context the 10 shots 7 iron was unachievable bc it described the iphone
camera as being able to capture a multitude of data, some of which was completely unrealistic.
lets revisit that."*

🔴 **This matters for how it comes back.** The screen was cut as a whole, which recorded the
*conclusion* and lost the *reason*. The reason was specific: the spec claimed an iPhone camera
could measure things it cannot. It was never "a filmed calibration set is impossible".

So the work is **not** "unhide 02". It is: go through what that screen claims to measure, and
separate
- what a phone camera can honestly produce,
- what a COACH can judge from watching the same ten shots, and
- what was invented for the spec and should not come back at all.

The third bucket is the one that got the whole screen cut. Whatever survives buckets one and two
is buildable. ⚠️ Until that split exists, do not unhide the section — it still renders the full
unrealistic set.

### ✅ The capture answer, Makel 2026-10-21

> *"we can make a calibration filming sequence for the user to follow using Parallax."*

That resolves HOW the shots get filmed, and it fits what already exists — but note what it does and
does not settle:

- **Parallax is EXTERNAL.** Atlas has never stored video: `golf.drill_progress.video_ref` is *"an
  external videoRef string, not modelled"* (`eco/src/schema/golf.ts:350`), and the coach watches in
  Parallax and ticks in Atlas. A guided filming sequence therefore lives in **Parallax**, and Atlas
  holds the reference.
- 🔴 **The open question is whether Parallax returns DATA or only VIDEO.** Today's integration is
  video-plus-coach-judgement: a human watches and records a verdict. Calibration as designed wants
  *measured* reads. METRIC-MAP anticipated this — it lists **`parallax_svc`** among the per-source
  writers on `golf.player_metrics` — but that role does not exist and neither does that table. So
  "use Parallax" answers capture and leaves measurement open.
- ⚠️ There is also an existing mislabel to clear up while here: the drill status **"Awaiting
  Parallax review"** names Parallax, but the request goes to the COACH's queue
  (`DATA-PROVENANCE-SWEEP-2026-10-16.md` §4). If Parallax becomes a real producer, that string has
  to stop meaning two things.
- An open stack decision already covers the next step: *"Whether Atlas stores swing video itself or
  keeps Parallax's videoRef"* (`docs/product/STACK-DECISIONS.md:280`).

## 03 Transfer — reopened, and it now has a real question

**Makel, 2026-10-21:** *"now we have forge so transfer can start to be completed as far as does
your on course performance match your practice tendencies or are you struggling to transfer the
skills."*

That is a **sharper definition than the screen was built with.** The old Transfer rendered four
practice indices and a "transfer gap" with no stated question. The question is now explicit:

> **Does on-course performance match practice tendencies, or is the skill not transferring?**

Which makes the inputs legible for the first time:
- **the practice side** — FORGE's scored sessions per facet (`golf.facet_scores`, `golf.range_sessions`)
- **the on-course side** — ⚠️ **there is no producer for this yet.** Nothing in Atlas or FORGE
  records what happened in a real round. This is the gap that decides whether Transfer can ship,
  and it is NOT closed by FORGE existing.

### ✅ The source answer, Makel 2026-10-21

> *"The on course data will eventually come from RED."*

That is the right answer and METRIC-MAP already assumed it — `red_app` is listed as the writer of
`golf.rounds`, `round_holes`, `round_shots`, `courses`, `course_holes`, `bag`, `handicap_history`,
and `rounds.is_simulated NOT NULL DEFAULT false` exists precisely so FORGE's simulated rounds and
Red's real ones sit in one table without a later migration. The practice/on-course split Makel
describes is the split the schema was designed around.

🔴 **But "eventually" is doing real work in that sentence, and the distance is not a screen.**
None of those tables exist in ryp-core, and **Red is still the system of record.** The RED update
plan's **R3** (*"promote raw golf data to `golf.*`"* — marked invasive, needs backfill) and **R4**
(*"connect as `red_app`"*) are both outstanding, and R1 is a live hazard in that repo
(`db:push` would drop `ryp_red.trainer_courses` and `public.users.ghin_number`).

So Transfer is blocked on a **cross-app migration**, not on a design. Sequence: create the round
tables in eco → land RED's R3/R4 → then build the screen. Anything built before that renders a gap
as a number, which is what got it hidden.

## 04 Performance — a dashboard, not a Forge screen

**Makel, 2026-10-21:** *"Performance is more like a dashboard where all metrics live and are
visible as it pertains to your performance."*

So Performance is **not** a fourth zone in the build sense and should stop being treated as one. It
is the place every performance metric in the system surfaces — which means it is mostly a
**composition** problem, not a measurement one: it has no metrics of its own, it shows the ones
other surfaces already produce.

Consequence worth stating: a dashboard of everything is the single easiest screen on which to
present a fabricated number as a real one, because its whole job is to show numbers out of their
original context. Every tile needs its provenance tier carried with it
(`docs/DATA-PROVENANCE-SWEEP-2026-10-16.md`) — MEASURED, DERIVED or absent — and an absent one
renders as the dash convention, never as zero.

### ✅ Scope, Makel 2026-10-21 — marked for completion

> *"Reading the book it looks like Performance is on course focused. Theres an element of Red that
> will have to be worked into that. lets mark that for completion as well."*

So Performance is **on-course focused**, which makes it share Transfer's blocker exactly: it needs
`golf.rounds` and Red writing them. It is **not** independently schedulable — marking it for
completion means scheduling it BEHIND the round tables and RED's R3/R4, not beside them.

The useful consequence of reading it this way: Performance and Transfer are two views of one
dataset, not two datasets. Transfer asks *does practice transfer to the course*; Performance shows
*what happened on the course*. One producer, two questions — so the round tables are the whole
critical path for half the remaining product.

## What has NOT changed

- All three stay **hidden** in this build. None of the above is implemented.
- `FORGE_ONLY_SCREENS` and `VIDEO_TEST_SECTIONS` in `server/protoData.ts` still hide them, and the
  mechanism (one entry per screen, `sc-if` in Luke's markup) is unchanged — unhiding is still one
  line each, once there is something honest behind it.
- Luke's 2026-10 handoff build shows **01 Construction only**. If he asks why — and he will, because
  he designed all four — the answer is capability, not progress: nothing gates them behind
  finishing zone 1.
