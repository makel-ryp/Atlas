# Atlas — tester brief for Luke and Mike

**Prepared 2026-10-30.** Everything below was verified against the live build on that date, not
assumed. The short version to send is at the bottom.

---

## Where, and who

**https://atlas-testing.up.railway.app**

| Who | Address | What you get |
| --- | --- | --- |
| Luke | `luke@rypgolf.com` | **Coach.** Lands on the Roster, 8 students |
| Luke | `luke.benoit@gmail.com` | **Player.** Your own empty account, for driving the flows |
| Mike | `mike@rypgolf.com` | **Coach.** Lands on the Roster |
| Mike | `eisele.mike@gmail.com` | **Player.** On Luke's roster and Makel's |

Sign in with **Google** or email + password — both work on all four.

⚠️ **You each have two accounts and they are separate people to the system.** The coach one sees a
roster; the player one is your own golf. Each needs its own date of birth and its own intake.

⚠️ This is the **Testing** environment, not production. It runs on its own copy of the database, so
nothing either of you does can affect live data.

---

## 🔴 The first five minutes, so it isn't a surprise

Signing in does **not** land you on the dashboard. You get:

1. **A date-of-birth screen.** It is **write-once** — a typo needs a database fix, so type it
   carefully. It drives the under-18 rules, which is why it is asked before anything else.
2. **The whole Practice DNA intake.** Both of you have no completed run, so the questionnaire
   stands between you and Today.

**Do both before the session, not during it.** Otherwise the first twenty minutes are form-filling.
The intake answers are also not editable afterwards yet — send corrections rather than trying to
change them.

---

## What is real, what is blank on purpose, what is a placeholder

This is the part worth reading, because the three look alike on screen.

### ✅ Real — driven by the database, trust it

- The **roster** and everything on it: handicaps, phases, "waiting on you" chips, last-logged dates
- **Drills and tick counts** — ticking a drill saves, and the "N of 23" count moves
- **Coach verification** — and ticking a *filmed* drill raises a review on the coach's side
- **Coaching notes**, including the private tier (which another coach genuinely cannot see)
- **Intake answers** and the Practice DNA profile
- The **practice log** and the week strip

### ⬜ Deliberately blank — not broken, no producer yet

- Anything **strokes-gained**: "Total SG —", the Tomorrow card, the practice indices
- The **handicap history chart** — no history is recorded yet
- **03 Transfer** and **04 Performance** — hidden entirely, because every number on them came from
  a hardcoded demo seed. They come back when there is something honest behind them.
- **02 Calibration** — hidden; being revisited

Where you see a **dash**, it means "not measured". A zero would be a claim, and the dash is
deliberate.

### ⚠️ Sample content — ignore it, it is not yours

- The **Team** screen's four practitioners — not your actual coaches
- The **Fitness** programme and its session counts
- *"You're holding 6 seconds"* on the tempo ladder — a default, not a reading
- *"Your pivot: The Cannon"* — a default, not a decision about you

### Not in this build at all

**FORGE.** The API is live and healthy, but no screen calls it yet — "Launch Forge" still scores in
the browser only. Luke, this is the one you will go looking for.

---

## Reporting things

**The feedback button floats bottom-left on every page.** Use it for everything — it captures a
screenshot of what you are looking at and posts it, with the screen name and your note, into a
private Slack channel. Verified working end to end on 2026-10-30: note, thread and screenshot all
land.

- You get to **see the screenshot before it sends**
- Notes up to **2,000 characters**
- **10 reports per 10 minutes**, then it asks you to wait
- If a send fails twice, message Makel directly — it means the pipe is down, not that you are wrong

**Copy anything long before you reload.** A failed send keeps your note on screen, but a reload
loses it.

## Two practical things

- **The session lasts 8 hours.** After that, saves start failing and the message does not say why.
  Reload and sign in again.
- **Coaching notes are permanent.** A correction is appended, never erased — by design, since a note
  is a record of what a coach thought at the time.

---

## For a populated screen

Your own player accounts are **deliberately empty**, and **Mike's coach roster holds only his own
player account**. To see the product with data in it, open a student from **Luke's** roster:

- **Avery Lane** — 4 of 23 drills, four coach-verified. The best all-round example.
- **Casey Flint (TEST)** — 18 drill rows and 3 coaching notes. The fullest.

Do not try to sign in *as* them — open them from the roster.

---

## The short version, to paste

> Atlas is ready for you both: **https://atlas-testing.up.railway.app**
>
> You each have **two** logins — a coach one and a player one — and the system treats them as
> separate people, so each needs its own setup.
>
> Luke: `luke@rypgolf.com` (coach, 8 students) and `luke.benoit@gmail.com` (player).
> Mike: `mike@rypgolf.com` (coach) and `eisele.mike@gmail.com` (player).
>
> Google sign-in or email/password, both work on all four.
>
> **Please sign in and get through the setup before we meet — on both accounts.** Each one hits a
> date-of-birth screen and then the full Practice DNA intake before you see anything else, about ten
> minutes apiece. Type the date of birth carefully, it can't be changed yet.
>
> **Use the feedback button, bottom-left on every page, for everything.** It grabs a screenshot and
> sends it straight through with your note — it is the fastest way to tell me something and it
> shows me exactly what you were looking at.
>
> **What to expect:** the roster, drills, tick counts, coaching notes and intake answers are all
> real and saving. Anything strokes-gained is deliberately blank — there is no producer for it yet,
> and a dash means "not measured" rather than zero. Transfer, Performance and Calibration are hidden
> for the same reason. The Team screen and the Fitness programme are sample content, ignore them.
> **FORGE is not wired into any screen in this build** — the API is live but nothing calls it yet.
>
> Your own accounts are empty on purpose. For a populated view, open **Avery Lane** or **Casey
> Flint** from Luke's roster.
>
> One thing: the session expires after 8 hours and does not say so — if saves start failing, reload
> and sign in again.
