# sim hub

A small server that takes GSPro shot records and answers with each player's scores. It uses the
library in `sim/core` for the scores and keeps what it receives in a file, so it can be stopped and
started again without losing the round. The contract for callers is [API.md](API.md).

**It listens on this PC only (127.0.0.1) and has no sign-in. Do not expose it to a network.**

## The two commands

```bash
npm run sim:hub      # starts it; prints one line saying where it listens
npm run sim:replay   # posts the 38 recorded copies to it, then prints the scorecard
```

`sim:hub` reads `SIM_HUB_PORT` (default 5077) and `SIM_HUB_DATA` (default `sim/hub/.data`, which
git ignores). `sim:replay` takes `--url` (default `http://127.0.0.1:5077`):
`npm run sim:replay -- --url http://127.0.0.1:5078`.

## Where the data is

`journal.jsonl` in the data folder: one line per accepted batch, only ever appended to. Delete the
folder to start empty. Tests use temporary folders outside the repository.

## Tests

`npm run test:sim` runs the library's tests and the hub's (`sim/hub/test`).
