# Building the coach view properly — the 1000ft view

---

## ⚠️ READ FIRST — Luke already built the coach view. It is `Dashboard.dc.html`.

Found 2026-09-11 in `handoff/Golf coaching website project/Atlas Handoff.dc.html`, an index page
Luke wrote listing his six artifacts. His own labels and blurbs:

| File | Luke's label | Luke's blurb |
| --- | --- | --- |
| `Atlas.dc.html` | Website | the method, the coaching tiers, and the book |
| `AtlasPlayer.dc.html` | **Player app** | *"What players carry to the range."* |
| `Dashboard.dc.html` | **Coach dashboard** | *"Practice calendar, calibration, the player file, the intake form, and the coach roster."* |

**This inverts what this repo assumed.** We had recorded Dashboard as "the whole player app with a
coach triad grafted in". Luke's index says the opposite: **Dashboard IS the coach dashboard**, and
the player's app is `AtlasPlayer`.

### The immediate consequence: our role filter contradicts the author

Luke names five surfaces for the coach. `HIDDEN_FOR_COACH` hides three of them:

| Luke's coach surface | Section | Status |
| --- | --- | --- |
| the coach roster | `roster` | ✓ shown |
| the player file | `profile` | ✓ shown |
| **practice calendar** | `cal` | ✗ **hidden** (in `PLAYER_ONLY`) |
| **calibration** | `build` | ✗ **hidden** (in `PLAYER_ONLY`) |
| **the intake form** | `intake` | ✗ **hidden** (in `VIDEO_TEST_SECTIONS`) |

The `intake` case is the subtle one and explains an earlier mistake. That section is **two things at
once**: the ten-shots-one-7-iron video test (correctly cut — unachievable) *and* the interview form
plus handicap history (which Luke calls "the intake form"). We cut the section for the video test
and took the interview with it — which is why the interview had no home, and why it was rebuilt as
a new intake stage. The stage was still right, but the coach should be able to **read** that intake
back, and today they cannot.

**So before building anything below: un-hide `cal` and `build` for a coach, and split `intake` so
the video test stays cut while the interview and handicap history reach the coach.** That is a
change to two lists, and it restores three of the five surfaces the author designed.


**11 Sep 2026.** Written after three days of fixing symptoms on this screen. The symptoms kept
recurring because the underlying shape is wrong, and this is that shape.

---

## The one number that explains everything

Luke's file has **38 computed-value methods**. Exactly **one** of them can render a person other
than the viewer:

```
  profileVals    27 references to `who`   ← SUBJECT-AWARE
  the other 37    0 references to `who`   ← read this.state, i.e. the viewer, only
```

So a coach can see exactly two things about a student: the **roster row** (`rosterVals`, a thin
summary) and the **dossier** (`profileVals`). Every other screen Luke built — today, plan, build,
transfer, perf, cal, fitness, thread — is **structurally incapable** of showing a student. Not
missing data. Incapable.

That is why the coach view feels empty no matter how much data we put in the database.

---

## The principle

> **Do not build a coach app. The coach view is the student dashboard with a SUBJECT.**

Luke has already designed and built every screen a coach needs to see, because a coach needs to see
*the same things the student sees* — their plan, their build progress, their practice log, their
transfer. What a coach does *not* need is those screens about **themselves**.

The product question is not "what screens does a coach need". It is **"whose data is on screen"** —
a single variable, threaded through surfaces that already exist.

```
          ┌─ player  → subject = me
 SUBJECT ─┤
          └─ coach   → subject = the selected student
```

This is why a second app, or a Claude-Design copy of the student board in "coach style", would be
the expensive way round: it forks a design that is already correct and doubles every future change.

---

## The three layers, in dependency order

### Layer 1 — SUBJECT (the blocker; nothing else works without it)

One resolved subject, read by every screen instead of `this.state`.

- Today: `this.state` **is** the subject, implicitly, and it is always the viewer.
- Needed: `subject()` — returns the viewer's own record for a player, and the selected student's
  record for a coach. Every `this.state.forge`, `this.state.log`, `this.state.tier` becomes
  `subject().forge`, etc.
- `profileVals` already demonstrates the pattern with `who`; it is the template, not the exception.

⚠️ **The `self` detection is broken and must be fixed as part of this.** `const self = who.id === 'hale'`
(`:3745`) — `'hale'` is a sample id no real row carries, so the self branch is **unreachable**, and
a player's roster is `[]` so `who` falls back to `EMPTY_PLAYER`. Luke's own comment says wiring it
"needs a product decision… guessing here is how the wrong player becomes 'you'." That decision is
Layer 1.

### Layer 2 — DATA (what fills the subject)

`protoData.ts` currently ships **one** `me` block plus a roster of thin rows. A coach selecting a
student needs that student's **full** payload, not a summary.

Of the 20 `RosterRow` keys, **13 are hardcoded empties** because Forge never shipped. That is not a
reason to wait: the seven that are real (name, handicap, target, carry, handedness, coaching
relationship, drill progress) already fill the dossier, and the honest-empty discipline means the
rest render as dashes rather than lies.

**What is real today and can be surfaced per student immediately:**
handicap · target handicap · driver carry · handedness · coaching relationship + status ·
drill sign-off state · intake answers (profile, volume, interview).

**What needs an Atlas producer:** practice log, curriculum tier/zone, practice days.
**What needs Forge:** the four indices, transfer gap, strokes gained, dispersion, the radar.

### Layer 3 — WRITE-BACK (the loop that makes it coaching, not reporting)

Three actions. **Two are already built and unreachable**, which is the recurring theme of this
codebase:

| Action | State | The actual gap |
| --- | --- | --- |
| **Tick a Parallax review** | ✅ writes `golf.drill_progress.verified_at` | **Does not reach the student.** `drills` exists only on `RosterRow`; the `me` block has none, and a player's roster is `[]`. The coach's judgement lands in the database and the student never sees it. |
| **Comment back to the student** | ✅ `atlas.coaching_notes`, `server/routes/notes.ts`, **and a working UI** in `Roster.tsx:146,158` | **Unreachable.** `Roster.tsx` is not rendered — `App.tsx` redirects coaches to the prototype, and `Roster` survives only in a code comment (`App.tsx:224`). The feature is built, tested and invisible. |
| **Gain a student** | ❌ nothing | **No endpoint writes `public.user_relationships`.** The RLS policies are correct and complete (request = pending-only, subject decides, actor can end). There is simply no route. Every roster row we have was inserted by hand. |

---

## What to do about the rail

The rail is the one surface that is **genuinely player-shaped** and cannot just take a subject:
`EVERY NUMBER VS <target>`, `TARGET HANDICAP` slider, `PRACTICE`, `REAL`, `TRANSFER GAP`,
`THE GUARANTEE`. For a coach those are their *own* golf numbers, which is noise.

Its **nav** half is already role-correct — every nav item is `sc-if`-guarded (`showToday`,
`showPlan`, …) and the server already closes twelve of them for a coach.

Two honest options, and they are not exclusive:

1. **Hide the player-metric blocks for a coach** (the same `hidden` mechanism, one new key). Cheap,
   immediate, removes the noise. Leaves a clean nav rail.
2. **Repurpose it as the selected student's header** once Layer 1 exists — same blocks, subject's
   numbers, so a coach reading a student always has that student's baseline on screen.

**Do (1) now, (2) after Layer 1.**

## Do we need a new design from Claude Design?

**For the screens, no** — and doing it would be the expensive mistake. Luke's screens are already
the right screens; they need a subject, not a restyle. A second "coach-style" copy doubles the
surface area of every future change and re-forks a design we have spent three days un-forking.

**For the rail, yes, eventually** — that is the one place where a coach genuinely needs a different
*shape*, not different data. If you want to send anything to Claude Design, send that: *"a rail for
a coach reading one student — who they are, where they are, what needs attention."*

---

## Sequence

1. **Subject resolution** (Layer 1) + fix the `self === 'hale'` bug. Nothing else is unblocked without it.
2. **Tick reaches the student** — add `drills` to the `me` block. Small, and it closes the loop the
   coach is already using. *This is the one the user asked to confirm, and today the answer is no.*
3. **Surface notes in the prototype** — the backend and the UI both exist; port the interaction into
   Luke's dossier pane rather than resurrecting `Roster.tsx`.
4. **Hide the player-metric rail blocks for a coach.**
5. **The consent loop** — `POST /coach/students` (request), `POST /me/coaches/:id/approve`. The
   policies are written and waiting.
6. **Per-student full payload** (Layer 2) once a subject exists to hang it on.

Steps 2–4 are each under an hour and independently shippable. Step 1 is the real work and gates 6.
