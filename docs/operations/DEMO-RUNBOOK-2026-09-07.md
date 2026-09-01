# Demo runbook — Mon 7 Sep 2026

**Written 26 Aug.** The exact sequence, in order, with the one sentence to say at each step. Run it
end to end twice before the day. Nothing here is aspirational — every step is against live
`ryp-core` data, and §5 lists what is deliberately absent so a question doesn't become a surprise.

---

## 0. Cold start — 3 minutes before

```sh
cd ~/dev/ATR/atlas
npm run seed          # idempotent; resets all four accounts and their data
npm run dev:server    # API on :5055
npm run dev           # client on :5173  (separate terminal)
```

Then open `http://localhost:5173` and **sign out if a session is remembered**. The demo starts from
the login screen.

| Account | Password | Role |
| --- | --- | --- |
| `demo.player1@rypgolf.com` | `RypDemo!2026` | player — Avery Lane, 4.2 hcp |
| `demo.player2@rypgolf.com` | `RypDemo!2026` | player — Jordan Reyes, 17.8 hcp |
| `demo.coach@rypgolf.com` | `RypDemo!2026` | coach — Sam Ellis |
| `demo.admin@rypgolf.com` | `RypDemo!2026` | admin — Ops |

⚠️ **Do not run `npm run seed` mid-demo.** It resets the pending edge, which step 3 depends on.

---

## 1. One person, one record · sign in as **player 1**

**Say:** "This is Firebase sign-in going through the shared identity package into Postgres. Every
value on this screen came out of the database — nothing here is hardcoded."

Show: name, plan, Atlas user ID, handicap 4.2, driver carry 268, right-handed, GHIN.

**Then edit the handicap** to something visibly different, save, and point out it persisted.

**Say:** "That write went through row-level security as *this* user. And `plan` isn't on that form —
it's refused by the request schema and separately by a column-level grant in Postgres, because a
user editing their own record must not be able to give themselves a paid tier."

---

## 2. The strongest moment · sign out, sign in as **player 2**

Same screen, entirely different data: 17.8 handicap, 212 carry, left-handed, different GHIN,
different user ID.

**Say:** "Same code, same query, same database. The reason player 2 can't see player 1's numbers
isn't application logic — it's row-level security in the database. If the app had a bug that asked
for the wrong rows, Postgres would still return nothing."

---

## 3. What a coach sees · sign out, sign in as **the coach**

The roster shows **two** students in different states:

| | |
| --- | --- |
| **Avery Lane** — APPROVED | profile card **and** handicap history |
| **Jordan Reyes** — AWAITING APPROVAL | profile card, and *"Metrics hidden until Jordan Reyes approves you"* |

**Say:** "A coach requests a player; only the player can approve. Before approval the coach sees
just enough to confirm they asked for the right person. The metrics are held back by a different
policy — so approval actually grants something rather than being a formality."

**If asked how a coach could cheat this:** a coach inserting their own edge as already-approved is
refused by the database, and so is approving their own request. Both were tested as the app's own
Postgres role.

---

## 4. Academies · sign out, sign in as **the admin**

Go to the **Admin** tab (it does not render for a player or a coach).

1. **Create an academy** — name it, give a reason. Point at the reason field: "every admin action
   requires one, and it's written in the same transaction as the change."
2. **Assign Jordan Reyes to it as a member.**
3. **Show the audit trail** — both actions, with actor, before/after values, and the reasons.

Then **sign out and back in as the coach.**

**Say:** "Jordan was awaiting approval a minute ago. Now the roster shows them as an academy
student with metrics visible — because assigning a kid to an academy is the consent. The coach
didn't gain that access; the academy director granted it."

**That is the whole thesis in one move:** one identity, one record, and access that changes because
of a relationship rather than because an app decided to show it.

---

## 5. What is deliberately NOT in this demo

State this **before** the screen share, not in answer to a question.

- **No Forge or Red data.** Practice sessions, rounds and shot-level data belong to those apps and
  are built at their own milestones. The permission layer for reading them is done and tested; the
  tables are not created, because a table whose writing app doesn't exist yet is a guess.
- **No payments.** Stripe is not wired. `plans` holds `free` and `pro`; `pro` has no price because
  pricing isn't decided.
- **No marketing site**, no signup-with-payment flow.
- **Plain UI.** The visual design is not ported. Every number is real; none of it is styled yet.
- **Localhost.** Not deployed to Railway. Nothing in the demo depends on that.

**The one-sentence version if someone asks "so what works?":** identity, profile, the coach↔player
permission model, academies, and an audited admin panel — all on one shared database with row-level
security proven to hold.

---

## 6. If something breaks

| Symptom | Cause | Fix |
| --- | --- | --- |
| Login spins forever | API not running | `npm run dev:server` |
| `/api/...` returns HTML | vite proxy aimed at the wrong port | `PORT` in `.env` must match; vite reads it |
| "no Atlas access yet" screen | that account's entitlement is revoked | `npm run seed` **before** the demo, not during |
| Coach roster empty | seed's edges missing | `npm run seed` |
| Profile shows "not set" everywhere | signed in as the admin or coach — neither has a golf profile | expected, not a bug |

**Rehearse twice.** The failure mode that matters is not a crash — it's fumbling the *narration*
while the screen is fine.
