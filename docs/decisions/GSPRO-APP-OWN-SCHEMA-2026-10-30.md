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

## What we need from him at integration time

1. The schema itself (DDL or an ORM definition).
2. The data dictionary above.
3. **A sample export with real-shaped rows** — 20 shots is enough. A schema shows the columns; only
   data shows the units, the nulls and the edge cases.
4. How a player is identified in his model, and whether it can be made to carry our `users.id`.

Item 4 is the one that is painful to retrofit. Everything else converts; identity does not, because
a shot attached to a name instead of a uuid cannot be joined to anything we hold.
