# The three hidden zones — Makel reopens two, and reframes the third

**2026-10-21.** Supersedes the "hidden, no producer" reasoning in `server/protoData.ts`
(`FORGE_ONLY_SCREENS`, `VIDEO_TEST_SECTIONS`) for the zones named below. **Nothing is unhidden
yet** — this records the direction and what each one now needs, so the next agent does not read the
old comments as settled.

## What was true, and why it is changing

Three of the four zones are hidden from every account:

| Zone | Why it was hidden | Status now |
| --- | --- | --- |
| 02 Calibration | *"this whole 10 shots one 7 iron section is unachievable"* | 🔄 **Revisit** |
| 03 Transfer | every number came from a hardcoded `state.forge` seed | 🔄 **Reopened — FORGE exists now** |
| 04 Performance | same hardcoded seed | 🔄 **Reframed** |

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

So: FORGE supplies one half. The other half needs a source — a round entry, a scorecard import, or
strokes-gained from somewhere. **Name that source before building the screen**, or Transfer
returns to being a gap rendered as a number.

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

## What has NOT changed

- All three stay **hidden** in this build. None of the above is implemented.
- `FORGE_ONLY_SCREENS` and `VIDEO_TEST_SECTIONS` in `server/protoData.ts` still hide them, and the
  mechanism (one entry per screen, `sc-if` in Luke's markup) is unchanged — unhiding is still one
  line each, once there is something honest behind it.
- Luke's 2026-10 handoff build shows **01 Construction only**. If he asks why — and he will, because
  he designed all four — the answer is capability, not progress: nothing gates them behind
  finishing zone 1.
