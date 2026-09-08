# Demo runbook — Mon 7 Sep 2026

**Rewritten 1 Sep 2026.** The Aug 26 version is gone: it predated the Practice DNA intake, Luke's
prototype and the Railway deploy, and its cold-start section still told you to run two local
servers. Every step below is against **live `ryp-core` data over the internet**.

Run it end to end **twice** before the day. §6 lists what is deliberately absent, so a question
does not become a surprise.

---

## 0. Cold start — 3 minutes before

**The app is hosted. Nothing runs on your laptop during the demo.**

> ### https://atlas.ryptest.com

The one thing you still run locally is the reset, because the seed script lives in the repo and
writes to the same `ryp-core` database the hosted app reads:

```bash
cd ~/dev/ATR/atlas && npm run seed
```

Then open the site in a **private window** — a remembered session skips the login screen, and step 1
is the login screen. (From inside the coach dashboard there is now a **Sign out** link in the top
banner; before it existed a coach had no way out at all.)

### The three entry points

Each URL lands in ONE view. A single `npm run seed` leaves all three ready at the same time — you
never have to put the database into a different state between them.

| Show | URL | Why it lands there |
| --- | --- | --- |
| **Practice DNA intake** | `atlas.ryptest.com/?as=demo.player2@rypgolf.com` | Jordan's run is seeded **fresh**, so signing in drops straight into question one |
| **Player dashboard** | `atlas.ryptest.com/?as=demo.player1@rypgolf.com` | Avery's run is seeded **completed**, so the intake gate lets her through |
| **Coach dashboard** | `atlas.ryptest.com/?as=demo.coach@rypgolf.com` | Sam holds the `coach` role, so he is routed to Luke's roster |

The link fills in the address and names the view under the heading. **You still type the password.**
That is deliberate: the site is public and these accounts hold real entitlements against the
Firebase project shared with the live iOS app, so a self-signing link would let in anyone who saw
it.

⚠️ Which view an account reaches is decided by the APP, not asserted by the link — the gate reads
the run's status and the role picks coach vs player. So if an entry point lands in the wrong place,
the fix is `npm run seed`, not the URL.

| Account | Password | Who |
| --- | --- | --- |
| `demo.player1@rypgolf.com` | `RypDemo!2026` | Avery Lane — 4.2 handicap, approved student |
| `demo.player2@rypgolf.com` | `RypDemo!2026` | Jordan Reyes — 17.8, **pending** approval |
| `demo.coach@rypgolf.com` | `RypDemo!2026` | Sam Ellis, coach |
| `demo.admin@rypgolf.com` | `RypDemo!2026` | Ops, admin |

⚠️ **Do not run `npm run seed` mid-demo.** It resets the pending coach edge, which step 4 needs, and
it reopens every intake.

⚠️ **Only `@rypgolf.com` addresses can get in.** `ATLAS_SIGNUP_ALLOWLIST` gates the first grant,
because Atlas shares a Firebase project with the RYP Stick iOS app and its ~28,000 real customers.
To let a guest sign in, add them **before** the demo:

```bash
railway variables --set "ATLAS_SIGNUP_ALLOWLIST=@rypgolf.com,someone@example.com"
```

---

## 1. The intake IS the signup · sign in as **player 1**

This is the new opening and the strongest thing to lead with. Signing in drops you straight into
Practice DNA — there is no dashboard to reach first.

**Say:** "This is the whole space between signing up and having an account. It's not a quiz bolted
onto onboarding — it *is* the onboarding. Every answer becomes part of one golfer profile."

Walk it: two practice-week questions → the allocation bar → seven profile questions → twelve items
→ the review → **the result**.

At the result, before clicking anything:

**Say:** "That read came out of the answers just given. Nothing here is a canned response." Point at
the line about their handicap falling — it is inferred from the two handicap answers, three years
apart.

Then click **Go to my Atlas →**.

**Say:** "And the handicap they just typed is now on their profile, in the shared database, where
every other RYP app reads it from."

## 2. One person, one record

You are now on the player's record. Name, plan, Atlas user ID, handicap, driver carry, handedness,
GHIN.

**Say:** "Every value came out of the database. The handicap arrived through the quiz you just
watched — nothing here is hardcoded."

**Then edit the handicap**, save, and point out it persisted.

**Say:** "That write went through row-level security as *this* user. `plan` isn't on that form — it's
refused by the request schema and separately by a column-level grant in Postgres, because a user
editing their own record must not be able to give themselves a paid tier."

## 3. The strongest moment · sign out, sign in as **player 2**

Same screen, entirely different data: 17.8, 212 carry, left-handed, different GHIN, different ID.

**Say:** "Same code, same query, same database. The reason player 2 can't see player 1's numbers
isn't application logic — it's row-level security in the database. If the app had a bug that asked
for the wrong rows, Postgres would still return nothing."

## 4. What a coach sees · sign out, sign in as **the coach**

Two students, deliberately in different states:

| | |
| --- | --- |
| **Avery Lane** — APPROVED | profile card **and** handicap history |
| **Jordan Reyes** — AWAITING APPROVAL | profile card, and *"Metrics hidden until Jordan Reyes approves you"* |

**Say:** "A coach requests a player; only the player can approve. Before approval the coach sees just
enough to confirm they asked for the right person. The metrics are held back by a different policy —
so approval actually grants something rather than being a formality."

**If asked how a coach could cheat this:** a coach inserting their own edge as already-approved is
refused by the database, and so is approving their own request. Both were tested as the app's own
Postgres role.

## 5. Academies · sign out, sign in as **the admin**

Go to the **Admin** tab — it does not render for a player or a coach.

1. **Create an academy** — name it, give a reason. Point at the reason field: "every admin action
   requires one, and it's written in the same transaction as the change."
2. **Assign Jordan Reyes to it as a member.**
3. **Show the audit trail** — both actions, with actor, before/after values, and the reasons.

Then **sign out and back in as the coach.**

**Say:** "Jordan was awaiting approval a minute ago. Now the roster shows them as an academy student
with metrics visible — because assigning a kid to an academy is the consent. The coach didn't gain
that access; the academy director granted it."

**That is the whole thesis in one move:** one identity, one record, and access that changes because
of a relationship rather than because an app decided to show it.

---

## 6. What is deliberately NOT in this demo

State this **before** the screen share, not in answer to a question.

- **No Forge or Red data.** Practice sessions, rounds and shot-level data belong to those apps.
  **44 of the 81 metrics in Luke's designs come from Forge**, which is still being built — six of
  his twelve dashboard screens cannot show real numbers until it exists. The permission layer for
  reading them is done and tested; the tables are not created, because a table whose writing app
  does not exist yet is a guess.
- **Luke's dashboard design is not what you are looking at.** His prototype is served, with real
  data injected, at `/proto/dashboard` — show it only if asked, and say plainly that it is his
  design running on live data, not the finished product.
- **No payments.** Stripe is not wired. `pro` has no price because pricing is not decided.
- **No marketing site**, and signup is invite-only by the allowlist above.
- **Tiers 1B, 2 and 3 of the intake exist but are opt-in.** The demo shows Tier 1A, which is what a
  new golfer completes.

**The one-sentence version if someone asks "so what works?":** signup through a real intake,
identity, the golfer profile, the coach↔player permission model, academies, and an audited admin
panel — all on one shared database with row-level security proven to hold.

---

## 7. If something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No Atlas access yet" screen | that email is not in `ATLAS_SIGNUP_ALLOWLIST` | add it and redeploy — **not** fixable mid-demo |
| Sign-in spins, console says `unauthorized-domain` | Google only; the host is not an authorised domain in Firebase | use email + password |
| Signed in but land on the dashboard, not the quiz | that account already completed its intake | `npm run seed` reopens it — before the demo, not during |
| Coach roster empty, or Jordan already approved | seed edges missing or consumed | `npm run seed` |
| Profile shows "not set" everywhere | signed in as the admin or coach — neither has a golf profile | expected, not a bug |
| Site is down | Railway | `railway logs`; `curl https://atlas.ryptest.com/health` should return `{"status":"ok"}` |

**Rehearse twice.** The failure mode that matters is not a crash — it is fumbling the *narration*
while the screen is fine.
