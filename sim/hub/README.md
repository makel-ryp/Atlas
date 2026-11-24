# sim hub

A small server that takes GSPro shot records and answers with each player's scores. It uses the
library in `sim/core` for the scores and keeps what it receives in a file, so it can be stopped and
started again without losing the round. The contract for callers is [API.md](API.md).

**It listens on this PC only (127.0.0.1) and has no sign-in. Do not expose it to a network.**

Two checks keep a web page open in a browser on this PC from using it: every request must carry a
`Host` of `127.0.0.1:<port>` or `localhost:<port>`, and a post must be `application/json`. What is
still open: any program on this PC can post. The key per bay comes with the hosted server (card 13).

## The two commands

```bash
npm run sim:hub      # starts it; prints one line saying where it listens
npm run sim:replay   # posts the 38 recorded copies to it, then prints the scorecard
```

`sim:hub` reads `SIM_HUB_PORT` (default 5077) and `SIM_HUB_DATA` (default `sim/hub/.data`, which
git ignores). `sim:replay` takes `--url` (default `http://127.0.0.1:5077`):
`npm run sim:replay -- --url http://127.0.0.1:5078`.

## Where the data is

`journal.jsonl` in the data folder: one line per accepted batch that changed something, only ever
appended to and `fsync`ed. A record the hub already holds exactly is left out, so posting a whole
copy twice adds nothing. Delete the folder to start empty. Tests use temporary folders outside the
repository.

Why leaving a record out is safe: the hub keeps a table of the records it knows the scores hold. A
record is left out only when its `ShotID` appears once in the post and the table holds exactly that
record, so the library would count it `unchanged` and change nothing, and a replay cannot differ
without it. When a post has any conflict, the hub forgets every `ShotID` of that post and writes
them in full next time. The replay test in `sim/hub/test` checks 250 seeded sequences of posts: a
restart must answer what the live hub answered.

## One hub per data folder

The hub takes a lock, the file `hub.lock` in the data folder, before it opens the journal. A second hub on
the same folder refuses to start and changes nothing; give it its own folder with `SIM_HUB_DATA`. If a
hub was killed, its lock is stale: the next start sees the process is gone, replaces the lock and says so
in one line. A start that fails on the lock or on a busy port changes nothing in the folder (the folder itself may be created, for the lock), and the journal is read only after the port is bound; a request that arrives while it is being read gets 503 busy. If a start ever refuses wrongly (for example the lock names a process id that now belongs to
some other program), make sure no hub is running and delete `hub.lock` from the data folder (and a leftover `hub.lock.takeover`, if one is there after a crash).

## Tests

`npm run test:sim` runs the library's tests and the hub's (`sim/hub/test`).
