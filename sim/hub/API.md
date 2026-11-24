# sim hub API, version 0

This file is the contract. The bay program is built against it. The hub is a small server that
takes GSPro shot records and answers with each player's scores, using the library in `sim/core`.

**Where it listens:** `http://127.0.0.1:5077` by default (`SIM_HUB_PORT` changes the port). The
address is always `127.0.0.1`: this PC only. There is no sign-in, no key and no cross-origin
support (no `Access-Control-*` header is ever sent).

**Every answer** is JSON with `Content-Type: application/json`. An error answer is
`{ "error": "<word>" }` with a fixed word; it never carries anything from the request.

## `POST /v0/shots`

Sends a batch of shot records, exactly as GSPro writes them in `currentRound.dat` (a whole copy of
the file is fine: records already held come back as `unchanged`). Send copies in the order they
were taken: for one shot, the last version received wins.

Request: `Content-Type: application/json`, body `{ "records": [ ... ] }`, at most 32 MB.

| Status | Body | When |
|---|---|---|
| 200 | `{ "added", "revised", "unchanged", "conflicts" }` (whole numbers) | The batch was accepted and written to the journal before this answer was sent |
| 400 | `{ "error": "bad_json" }` | The body is not valid JSON |
| 400 | `{ "error": "bad_shape" }` | The body is not an object with a `records` array |
| 400 | `{ "error": "unknown_layout" }` | The library refused a record (a missing or wrong field, a value out of range, text too long, nesting too deep). The whole batch is refused and nothing changes |
| 405 | `{ "error": "method_not_allowed" }` | Any method but `POST` |
| 413 | `{ "error": "too_large" }` | The body is over 32 MB. Nothing changes |
| 500 | `{ "error": "internal" }` | Anything unexpected. The cause is not given |

`added` counts new shots, `revised` shots re-sent with different content, `unchanged` exact
repeats, `conflicts` records the library refused to apply (a shot that would change owner or
round). A 400 or 413 changes nothing: the scores and the journal are as before.

Example:

```
POST /v0/shots
{ "records": [ { "ShotID": "...", "RoundID": 19, "UserGuid": "...", "PlayerName": "...", "Hole": 2, "HoleShot": 1, "HoleResult": 0, "...": "..." } ] }

200 { "added": 1, "revised": 0, "unchanged": 0, "conflicts": 0 }
```

## `GET /v0/rounds`

The current rounds, straight from the library. Status 200 and
`{ "rounds": [...], "rangeShots": n, "issues": [...] }`.

- `rounds`: one entry per round: `roundId`, `courseKey`, `courseKeys`, `needsReview`, and
  `players` (each with `playerNumber`, `userGuid`, `name`, `total`, `needsReview` and `holes`; each
  hole has `hole`, `par`, `status` of `finished` or `in_play`, `strokes`, `strokesSoFar`,
  `needsReview`). The rule behind the numbers is in `sim/README.md`.
- `rangeShots`: practice-range shots, which belong to no round.
- `issues`: what the library refused, as `{ kind, roundId, shotId }`.

Any method but `GET`: 405.

Example: `GET /v0/rounds` gives `200 { "rounds": [ { "roundId": 19, "courseKey": "bluejack_gsp", "players": [ ... ] } ], "rangeShots": 0, "issues": [] }`.

## `GET /healthz`

`200 { "ok": true }`. Any method but `GET`: 405.

## Any other address

`404 { "error": "not_found" }`.

## Limits and behaviour

- Body: 32 MB at most (an eight-player round's whole file is about 13 MB). Over it, the hub answers
  413 and stops reading.
- The library's own limits apply to every record (text length, integer range, nesting depth).
- Anything that changes the scores is handled one request at a time, in arrival order.
- What it keeps: a journal file (`journal.jsonl`) in the data folder, one line per accepted batch.
  On start the hub replays it, so stopping and starting ends on the same answer. A half-written
  last line is skipped with a warning; a damaged line anywhere else stops the start.
- The hub's console shows only methods, fixed address words, status codes and counts. It never
  prints a name, an id or anything else from a request.
