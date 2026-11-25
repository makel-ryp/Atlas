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
copy twice adds nothing. To start empty, stop the hub first, then delete the folder. If the folder, its journal or the hub's lock is removed or replaced while the hub is running, the hub notices before the next shot is written, prints one line, and answers every later post 503 until it is restarted. After that, `GET /v0/rounds` shows what the journal's path holds, not what the hub had (and answers 503 if that journal cannot be read back at all; `/healthz` still answers 200). Tests use temporary folders outside the
repository.

Why leaving a record out is safe: the hub keeps a table of the records it knows the scores hold. A
record is left out only when its `ShotID` appears once in the post and the table holds exactly that
record, so the library would count it `unchanged` and change nothing, and a replay cannot differ
without it. When a post has any conflict, the hub forgets every `ShotID` of that post and writes
them in full next time. The replay test in `sim/hub/test` checks 250 seeded sequences of posts: a
restart must answer what the live hub answered.

## One hub per data folder

The hub takes a lock, a numbered file `hub.lock.<n>` in the data folder, before it opens the journal. A second hub on
the same folder refuses to start and changes nothing; give it its own folder with `SIM_HUB_DATA`. If a
hub was killed, its lock is stale: the next start sees the process is gone, replaces the lock and says so
in one line. A start that fails on the lock or on a busy port changes nothing in the folder (the folder itself may be created, for the lock), and the journal is read only after the port is bound; a request that arrives while it is being read gets 503 busy. The refusal names the lock file and the process id in it, and says that the process may be another program: a lock only holds an id, and after a restart of the PC that id can belong to anything. Stop nothing; delete the named lock file and start again. (A lock that names the starting process itself, with a token no hub here holds, is a leftover and is replaced with one line.) If a start ever refuses wrongly (for example the lock names a process id that now belongs to
some other program), make sure no hub is running and delete the `hub.lock.<n>` file the message names from the data folder (any `hub.lock.tmp-*` leftover of a crash is removed by the next start; a plain `hub.lock` or `hub.lock.takeover` from an older build is ignored and may be deleted). The lock needs a file system that supports hard links (NTFS and ordinary Linux or macOS folders do; some network or removable drives do not): on one that does not, the hub refuses to start and says so, and `SIM_HUB_DATA` must point somewhere else.

## When the folder or the lock is removed under a running hub

A lock the hub cannot read is not a lost lock. If the lock file (or the journal) cannot be read or looked at for any reason other than "it is not there" or "it holds something else" (for example a backup or sync program is holding it open for a moment), the hub does not stop: that post is answered 503 busy (or 500 if its line was already written, in which case the line stays and sending the same post again adds and revises nothing: its records come back unchanged, and any conflicts the post itself holds are counted again), it prints one line saying it could not read the file, with the reason as far as the error tells it, and it looks again at the next post. The cost: posts are refused as busy while the other program holds the file; nothing is lost. The line is printed at the first look that cannot tell, and again each minute while it goes on (only when a post arrives; there is no timer and no line when it ends: the request log's 200 shows that). If busy lasts, look for the program that is holding the file (a backup, sync or scanner program) and check that the hub may still read its data folder; do not restart the hub while the console's last warning says the hub looks again at the next post, or takes posts again by itself (a start is refused while the lock cannot be read) and do not delete anything while a hub may be running. When the last warning says the hub takes no more shots (the "removed or replaced ... restart it" line, or the "could not read its journal ... back" line), stop the hub and start it again. The bay program shows both as busy, so the hub's console is where to look. The reason the line gives depends on the error: EBUSY says another program may be holding the file; any other code says the hub cannot tell why (the file may be held, be part-way through being removed, or the hub may no longer have the right to read its data folder).

The look at the lock is made next to the write, not before the post's work: the hub does all of a post's work first (checks,
fingerprints, the library, the bytes of the line), then checks that the journal is still the file at its path and the lock is
still its own, then writes. The journal itself also refuses to write if its file is not the length it remembers (another writer
has added to it or cut it): it writes nothing, does not cut the file back (those bytes may be another hub's answered lines),
and the hub takes no more posts until restarted. A post that wrote nothing is answered 503; a post whose line was written and
then found lost is answered 500. The last look is made after the table is updated, just before the answer.

What can still be lost, measured on the development PC in two series (seven posts in all, two of them of 16.7 MB): from the look to
the first write call 3.5 to 15 microseconds; from the last look to the start of the answer 7.5 to 17 microseconds, and handing the
answer to the socket took 0.11 to 1.6 milliseconds. If the lock is removed inside the first gap, the line can still go in over the bytes of a second
hub that answered 200 in that gap, and the size check cannot see it if that hub's line had not yet reached the file; if it is
removed between the last look and the answer, one answered post is in a file that has lost its name. Both need another program to act
inside those gaps. The hub notices at the next post.

## Tests

`npm run test:sim` runs the library's tests and the hub's (`sim/hub/test`).
