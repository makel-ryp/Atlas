# The GSPro app builds its own schema — decided 2026-10-30

Luke has a developer building an app that **live-intercepts GSPro data** and renders a dashboard
around it, for the academy.

**Makel's decision:** *"lets just give him his own then and we can evaluate his schema and then have
a conversion guide when implementation comes."*

So: he designs his own data model, we do not constrain it, and the mapping into `golf.*` is written
at integration time rather than imposed up front.

## What this is NOT, so nobody re-derives it

- ❌ **Not a spoke.** He gets no `sim_app` role, no Neon branch, no Firebase service account and no
  credential of any kind. **All of his builds are local only** — *"we're going to have the only
  build connected to a live service."* The connected build is ours, deployed by us.
- ❌ **Not blocked on T-136.** An earlier read of this had the GSPro app waiting on
  `golf.rounds` / `round_holes` / `round_shots`. It is not. **T-136 blocks Transfer (T-134) and
  Performance (T-135), and nothing else.**
- ❌ **Not a schema review.** He is not being asked to match METRIC-MAP. Evaluating his model comes
  later, with the model in hand.

## The risk that was weighed and accepted

Raised before deciding: he builds a shot model shaped by GSPro's output, we later build ours, the
two disagree, and the translation layer becomes permanent because it is never anyone's job.

Accepted, because the alternative is Luke's developer idle while `golf.rounds` gets designed — and
that design is owed to **Transfer and Performance first**, where the question *"does practice
transfer to the course"* decides the shape. Letting GSPro drive that schema would be the tail
wagging the dog.

## 🔴 The one thing to ask for now, because it costs him nothing and decides everything later

**A data dictionary alongside the schema.** Not a format, not a review — just, per field: what it
means, its **units**, and **where in GSPro it came from**.

Converting one schema into another is routine. Converting a schema whose units and provenance are
undocumented is archaeology, and it is what makes integrations slip. Carry distance in yards or
metres, club path sign convention, whether a "session" is a bucket or a round, whether a shot's
lie is recorded or inferred — every one of those is free to write down today and expensive to
recover in six months.

Ask for it while he is building, not when he is done.

## ✅ AMENDED 2026-11-09 — he gets his own DATABASE too, not just his own schema

The developer has a name — **Paul** — and the app is **Golf Tracker**.

**Makel, 2026-11-09:** *"I dont want him to conform to our schema if he doesnt have to. Id like to
learn how hes moving data and then we can adapt."*

That is a sharper version of the 30 October decision and it changes the delivery, so the "all his
builds are local only" line above is **superseded**:

| | |
| --- | --- |
| **Project** | **Golf Tracker** — `divine-scene-09465448` |
| Default branch | `main` — `br-shiny-resonance-bc27mdw7` |
| Database / role | `neondb` / `neondb_owner` |
| Region / version | `aws-us-east-1`, Postgres **17.11** |
| Contents | **0 tables.** He designs everything in it. |

Same region as `ryp-core` on purpose, so moving data between them later is cheap.

### 🔴 Why a SEPARATE PROJECT and not a branch of ryp-core

A branch was created (`tracker-dev`, `br-dry-heart-auicqqq6`) and **deleted the same hour**, once the
requirement above was clear. Recording why, because "give him a sister copy of the DB" sounds like a
branch and a branch is the wrong instrument:

**A Neon branch copies the DATA, not the schema.** That branch contained, verified by query:

- **10 real (non-demo) accounts** — Makel's four, Mike's two, Luke's two
- **9 stored dates of birth**
- **10 intake submissions** — which carry injuries, surgeries and the free-text *"why you are here"*
- **3 coaching notes, one of them private-tier**
- 10 player profiles, 31 drill rows, 21 populated tables

All of it handed to a developer whose app reads **none** of it. A branch would also sit those tables
physically beside his work, where one mistaken grant exposes them. There is no upside to that when
he is not querying them.

His own project gives him owner rights on an empty database, zero exposure to ours, and — because it
is in the same Neon account — **we can still read his model whenever we like.** That is the whole
point: we learn how he moves data without his build touching anything of ours.

### What this does NOT change

- He still designs his own model. We still convert at integration time.
- **T-137 is still the instrument** for "learn how he's moving data" — a data dictionary written
  while he builds, one line per field: meaning, **units**, and where in GSPro it came from. A
  database shows the columns; only the dictionary shows what they mean.
- Conversion remains a one-off script between two databases, which is easier than untangling his
  tables from ours would have been.

### What Makel does next

Give Paul access to the **Golf Tracker** project only — either as a member on that project in the
Neon console, or just the connection string. ⚠️ **Not** an account-wide invitation: `ryp-core` lives
in the same account, and project-scoped access is the thing keeping these separate.

## What we need from him at integration time

1. The schema itself (DDL or an ORM definition).
2. The data dictionary above.
3. **A sample export with real-shaped rows** — 20 shots is enough. A schema shows the columns; only
   data shows the units, the nulls and the edge cases.
4. How a player is identified in his model, and whether it can be made to carry our `users.id`.

Item 4 is the one that is painful to retrofit. Everything else converts; identity does not, because
a shot attached to a name instead of a uuid cannot be joined to anything we hold.
