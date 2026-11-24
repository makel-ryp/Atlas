# sim collector

A small program that runs beside GSPro on the bay PC. It watches GSPro's round file
(`currentRound.dat`), finds shot records it has not sent yet and posts them, in order, to the
[sim hub](../hub/README.md). The hub answers with each player's scores.

```bash
npm run sim:hub         # in one window: the server
npm run sim:collector   # in another: this program
```

It prints one line of counts and states whenever one changes, for example
`copies=12 queued=9 sent=9 refused=0 pending=0 server=up file=ok`. It never prints a player name,
an id or anything else from the file.

## The three settings

Read from the environment:

- `SIM_GSPRO_FILE`: the round file. Default: `currentRound.dat` in the GSPro folder under the
  signed-in Windows user's `AppData\LocalLow` (built from the environment at run time). Set it if
  GSPro keeps the file elsewhere.
- `SIM_HUB_URL`: where the hub listens. Default `http://127.0.0.1:5077`.
- `SIM_COLLECTOR_DATA`: its own folder for the copy, the outbox, the record of what was sent and
  the refused file. Default `sim/collector/.data`, which git ignores.

## What it never does to GSPro's file

It only reads it. It copies the file into its own data folder and works on the copy. It never
opens GSPro's file for writing, and never renames, moves, truncates or deletes it. All file access
is in one module (`src/files.ts`) that has no call able to name GSPro's file for any of those.

## Sends only to this PC, for now

`SIM_HUB_URL` must be `http://127.0.0.1:<port>` or `http://localhost:<port>`. Any other address, and
`https`, is refused at start with a plain message. The hub has no sign-in yet.

## What it does when things go wrong

- File missing (GSPro has not started a round): waits, no error.
- A copy cut off mid-write: tried again on the next look; the status says `broken` after ten seconds.
- A layout it does not know: sends nothing from that copy and says `layout_unknown`; what is already
  queued stays queued.
- Hub unreachable or answering 5xx: the records wait in the outbox and it tries again, waiting longer
  each time, at most 30 seconds. A 400 or 413 moves that batch to `refused.jsonl` and it is not
  retried.
- GSPro empties its file at a new round: records of the earlier round still waiting are still sent.
- Stopped and started again: it carries on from its data folder. A batch can be sent twice after a
  crash; the hub answers `unchanged` for it.

Tests: `npm run test:sim`.
