# sim hub API, version 0

This file is the contract. The bay program is built against it. The hub is a small server that
takes GSPro shot records and answers with each player's scores, using the library in `sim/core`.

**Where it listens:** `http://127.0.0.1:5077` by default (`SIM_HUB_PORT` changes the port). The
address is always `127.0.0.1`: this PC only. There is no sign-in, no key and no cross-origin
support (no `Access-Control-*` header is ever sent).

**Who may ask.** Two checks, on top of listening on this PC only:

- Every request, on every address, must carry a `Host` header that is exactly
  `127.0.0.1:<the port>` or `localhost:<the port>` (letter case ignored). Anything else, or none,
  answers `403 { "error": "bad_host" }` before anything else is looked at; its body is thrown away, never read as a request.
- `POST /v0/shots` must carry `Content-Type: application/json` (a `charset` parameter is fine).
  Anything else, or none, answers `415 { "error": "unsupported_media_type" }`; the body is thrown
  away and nothing changes.

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
last version received wins. "Received" means the order the bodies finish arriving, so keep one post in flight for one round file (see the limits below).

Request: `Content-Type: application/json`, body `{ "records": [ ... ] }`, at most 32 MB.

| Status | Body | When |
|---|---|---|
| 200 | `{ "added", "revised", "unchanged", "conflicts" }` (whole numbers) | The batch was accepted. What had to be written was written to the journal and `fsync`ed (on the disk, not only in the operating system's cache) before this answer was sent |
| 400 | `{ "error": "bad_json" }` | The body is not valid JSON |
| 400 | `{ "error": "bad_shape" }` | The body is not an object with a `records` array |
| 400 | `{ "error": "unknown_layout" }` | The library refused a record (a missing or wrong field, a value out of range, text too long, nesting too deep). The whole batch is refused and nothing changes |
| 403 | `{ "error": "bad_host" }` | The `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` |
| 405 | `{ "error": "method_not_allowed" }` | Any method but `POST` |
| 408 | `{ "error": "body_timeout" }` | The body was not complete 30 seconds after the headers. The connection is closed and the slot is free again. Nothing changes |
| 413 | `{ "error": "too_large" }` | The body is over 32 MB, or the record would be too long to keep: the journal line this post would write (numbers such as `1e20` are longer written out than sent) is over 64 MB, the longest line the hub will read back at the next start. Nothing changes |
| 415 | `{ "error": "unsupported_media_type" }` | The `Content-Type` is not `application/json` |
| 500 | `{ "error": "internal" }` | Anything unexpected, including a journal write that failed (the file is cut back to its last good length and the scores are as before the post; the hub carries on if it can read the journal back, and if it cannot it prints one line and takes no more posts until it is restarted), or a line that was written and then could not be confirmed because the hub could not read its own lock or look at its journal (the line stays in the journal, the scores are rebuilt from it, the hub is not lost, and the same post sent again adds and revises nothing: its records come back `unchanged`, and any `conflicts` the post itself holds are counted again). The cause is not given |
| 503 | `{ "error": "busy" }` with `Retry-After: 1` | Four posts are already being read or waiting for their turn, or the hub has only just started and is still reading its journal (every request, on every address, gets this until it is done), or the hub could not read its own lock file or look at its journal just now (another program may be holding the file for a moment): nothing was written, the hub is not lost, and it looks again at the next post. Send it again after a second |
| 503 | `{ "error": "journal_unavailable" }` | A journal write failed and the file could not be cut back (the hub prints one line saying so; a restart is needed), or a journal write failed and the hub then could not read the journal back (it prints one line saying so; a restart is needed), or the hub found its folder, journal or lock gone (removed, or replaced by another file or another hub's lock). The hub takes no more posts until it is restarted. `GET /v0/rounds` shows what the journal's path holds; if the hub could not read that journal back at all, `GET /v0/rounds` answers this too, and `/healthz` still answers 200 |

`added` counts new shots, `revised` shots re-sent with different content, `unchanged` exact
repeats, `conflicts` records the library refused to apply (a shot that would change owner or
round, or a `ShotID` given twice in one batch with different content). A 400, 403, 413, 415 or 503
changes nothing: the scores and the journal are as before (a 503 means this post wrote nothing; a 500 may mean its line was written).

Example:

```
POST /v0/shots
{ "records": [ { "ShotID": "...", "RoundID": 19, "UserGuid": "...", "PlayerName": "...", "Hole": 2, "HoleShot": 1, "HoleResult": 0, "...": "..." } ] }

200 { "added": 1, "revised": 0, "unchanged": 0, "conflicts": 0 }
```

## `GET /v0/rounds`

The current rounds, straight from the library. Status 200 and
`{ "rounds": [...], "rangeShots": n, "issues": [...] }`. After the hub has found its folder, journal or lock gone, this shows what the journal's path holds, not what the hub had. If the hub could not read that journal back at all it answers 503 `{ "error": "journal_unavailable" }` here until it is restarted.

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
  cuts the connection if the body has not ended by then. Every answer given before the body is read (403, 404, 405, 413, 415 and the two 503s) is handled the same way.
- At most four posts are read or waiting at once; a fifth gets `503 busy`.
- The library's own limits apply to every record (text length, integer range, nesting depth).
- Anything that changes the scores is handled one request at a time, in the order the bodies finish arriving: a post takes its place when its whole body has been received, not when it begins, so that one slow or stalled sender (a body may take up to 30 seconds) never holds up another sender's post. A sender must keep one post in flight for one round file: wait for the answer, or for the failure, of one post before sending the next. Two overlapping posts that hold the same shot are applied in the order they finished arriving, and the one that finished last is the one kept, whichever began first. A caller that breaks this rule gets the following: if two posts for one round file overlap and a shot's record differs between them, the copy whose post finished last is kept even when it is the older one; the hub cannot tell which is newer, because a GSPro shot record carries no version, revision or save time; and the score stays as that copy says until the shot is sent again.
- What it keeps: a journal file (`journal.jsonl`) in the data folder, one line per accepted batch.
  A record is left out of the line only when its `ShotID` appears once in the batch and the hub
  knows the scores already hold exactly that record (the library would count it `unchanged`). If
  nothing is left, nothing is written. So a whole copy posted twice adds nothing the second time.
  On start the hub reads the journal in pieces (never the whole file at once) and replays it, so
  stopping and starting ends on the same answer. A half-written last line is skipped with a
  warning; a damaged line anywhere else, or a line over 64 MB, stops the start.
- One hub per data folder: the hub takes a lock in the data folder before it does anything else: a numbered file `hub.lock.<n>` (the highest number is the current lock) holding its process id and a token only it knows, made whole with a hard link so it is never seen half-written. It removes its own file when it stops, but only if it still holds its own id and token. A second hub on the same folder refuses to start and touches nothing; the refusal names the lock file and the process id in it and says that the process may be another program (a lock holds only an id), so nothing should be stopped on that account: delete the named file if no hub is running. A lock number above a billion is refused too. Before every post is written, and again once it is on the disk, the hub checks that its journal file is still the file at the journal's path (same device and file number) and that its own lock file still holds its id and token; if not, the post is answered 503 `journal_unavailable` (or 500 if it was already written), one plain line is printed once, and every later post is 503 until the hub is restarted. A look that cannot tell (the lock file or the journal cannot be read or looked at for a reason other than "not there", for example because another program holds it for a moment) is not a lost lock: that post is answered 503 busy (or 500 if its line was already written), one plain line is printed at the first such look of a stretch, and again at a later look that cannot tell once a minute has passed since it was last printed (it then says about how many minutes the stretch has lasted, that nothing is lost, that the hub takes posts again by itself once it can read the file, and what to check), and the hub looks again at the next post. A starter that finds the current lock unreadable is refused with "cannot be read" and the words that a hub may be running under that lock, that another program may be holding the file, to try again in a moment, and to delete the file only when no hub is running. When the last lock's process is gone, the next starter takes the next number; of two starters at once only one can create a given number. The winner removes locks older than the one before its own and the temporary files of starters that are gone. The data folder's file system must support hard links, or the hub refuses to start. Start order: the lock, then the port, then the journal is read (503 busy meanwhile). A start that fails on the lock or the port leaves the folder as it was, except that the folder itself may have been made for the lock.
- The hub's console shows only methods, fixed address words, status codes and counts (a post the client dropped before its body ended is logged as `aborted`). It never
  prints a name, an id or anything else from a request.
