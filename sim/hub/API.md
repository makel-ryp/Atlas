# sim hub API, version 0

This file is the contract. The bay program is built against it. The hub is a small server that
takes GSPro shot records and answers with each player's scores, using the library in `sim/core`.

**Where it listens:** `http://127.0.0.1:5077` by default (`SIM_HUB_PORT` changes the port). The
address is always `127.0.0.1`: this PC only. There is no sign-in, no key and no cross-origin
support (no `Access-Control-*` header is ever sent).

**Who may ask.** Two checks, on top of listening on this PC only:

- Every request, on every address, must carry a `Host` header that is exactly
  `127.0.0.1:<the port>` or `localhost:<the port>` (letter case ignored). Anything else, or none,
  answers `403 { "error": "bad_host" }` before anything else is looked at, and no body is read.
- `POST /v0/shots` must carry `Content-Type: application/json` (a `charset` parameter is fine).
  Anything else, or none, answers `415 { "error": "unsupported_media_type" }`; the body is not read
  and nothing changes.

Why: a web page open in a browser on this PC can reach `127.0.0.1` too. It can send a `text/plain`
post without asking first, and a page that tricks the browser's name lookup can read answers under
another `Host`. These two checks shut both. What is still open: **any program on this PC can post.**
The key per bay comes with the hosted server (card 13).

**Every answer the hub writes** is JSON with `Content-Type: application/json`. An error answer is
`{ "error": "<word>" }` with a fixed word; it never carries anything from the request. A request
that Node itself refuses before the hub sees it (a malformed request line or header, a header block
that is too large) gets Node's own plain answer, which is not JSON.

## `POST /v0/shots`

Sends a batch of shot records, exactly as GSPro writes them in `currentRound.dat`. A sender may post
whole copies of the file or only the new records: records already held come back as `unchanged`, and
the journal grows only by what changed. Send copies in the order they were taken: for one shot, the
last version received wins.

Request: `Content-Type: application/json`, body `{ "records": [ ... ] }`, at most 32 MB.

| Status | Body | When |
|---|---|---|
| 200 | `{ "added", "revised", "unchanged", "conflicts" }` (whole numbers) | The batch was accepted. What had to be written was written to the journal and `fsync`ed (on the disk, not only in the operating system's cache) before this answer was sent |
| 400 | `{ "error": "bad_json" }` | The body is not valid JSON |
| 400 | `{ "error": "bad_shape" }` | The body is not an object with a `records` array |
| 400 | `{ "error": "unknown_layout" }` | The library refused a record (a missing or wrong field, a value out of range, text too long, nesting too deep). The whole batch is refused and nothing changes |
| 403 | `{ "error": "bad_host" }` | The `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` |
| 405 | `{ "error": "method_not_allowed" }` | Any method but `POST` |
| 413 | `{ "error": "too_large" }` | The body is over 32 MB. Nothing changes |
| 415 | `{ "error": "unsupported_media_type" }` | The `Content-Type` is not `application/json` |
| 500 | `{ "error": "internal" }` | Anything unexpected, including a journal write that failed (the file is cut back to its last good length, the scores are as before the post, and the hub carries on). The cause is not given |
| 503 | `{ "error": "busy" }` with `Retry-After: 1` | Four posts are already being read or waiting for their turn. Send it again after a second |
| 503 | `{ "error": "journal_unavailable" }` | A journal write failed and the file could not be cut back. The hub takes no more posts until it is restarted; the two `GET` addresses still answer |

`added` counts new shots, `revised` shots re-sent with different content, `unchanged` exact
repeats, `conflicts` records the library refused to apply (a shot that would change owner or
round, or a `ShotID` given twice in one batch with different content). A 400, 403, 413, 415 or 503
changes nothing: the scores and the journal are as before.

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

Any method but `GET`: 405. A foreign `Host`: 403.

Example: `GET /v0/rounds` gives `200 { "rounds": [ { "roundId": 19, "courseKey": "bluejack_gsp", "players": [ ... ] } ], "rangeShots": 0, "issues": [] }`.

## `GET /healthz`

`200 { "ok": true }`. Any method but `GET`: 405. A foreign `Host`: 403.

## Any other address

`404 { "error": "not_found" }`.

## Limits and behaviour

- Body: 32 MB at most (an eight-player round's whole file is about 13 MB). Over it, the hub answers
  413 at once, then goes on reading and throwing away what still arrives for up to two seconds and
  cuts the connection if the body has not ended by then. A `503` is handled the same way.
- At most four posts are read or waiting at once; a fifth gets `503 busy`.
- The library's own limits apply to every record (text length, integer range, nesting depth).
- Anything that changes the scores is handled one request at a time, in arrival order.
- What it keeps: a journal file (`journal.jsonl`) in the data folder, one line per accepted batch.
  A record is left out of the line only when its `ShotID` appears once in the batch and the hub
  knows the scores already hold exactly that record (the library would count it `unchanged`). If
  nothing is left, nothing is written. So a whole copy posted twice adds nothing the second time.
  On start the hub reads the journal in pieces (never the whole file at once) and replays it, so
  stopping and starting ends on the same answer. A half-written last line is skipped with a
  warning; a damaged line anywhere else, or a line over 64 MB, stops the start.
- The hub's console shows only methods, fixed address words, status codes and counts. It never
  prints a name, an id or anything else from a request.
