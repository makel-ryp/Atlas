# sim collector

A small program that runs beside GSPro on the bay PC. It watches GSPro's round file
(`currentRound.dat`), finds shot records it has not sent yet and posts them, in order, to the
[sim hub](../hub/README.md). The hub answers with each player's scores.

```bash
npm run sim:hub         # in one window: the server
npm run sim:collector   # in another: this program
```

Run one copy of this program for a GSPro file. If a second one was started by mistake, close it and
then do the step in the section below, at once: two copies each post every shot, and the program's own
checks do not cover them. See
[One post at a time, and one copy of the program](#one-post-at-a-time-and-one-copy-of-the-program).

At start it prints one line naming the round file it watches. Then it prints one line of counts and
states whenever one changes, for example
`copies=12 queued=9 sent=9 refused=0 pending=0 server=up file=ok`. It never prints a player name,
an id or anything else from the file.

## The three settings

Read from the environment:

- `SIM_GSPRO_FILE`: the round file. Default: `currentRound.dat` in the folder `GSPro` inside the
  folder `GSPro` under the signed-in Windows user's `AppData\LocalLow` (two `GSPro` folders, one in
  the other; built from the environment at run time). If the file has not been seen for 30 seconds
  the status says `file=not-found` and the line naming the file is printed again: check the path.
- `SIM_HUB_URL`: where the hub listens. Default `http://127.0.0.1:5077`.
- `SIM_COLLECTOR_DATA`: its own folder for the copy, the outbox, the record of what was sent and
  the refused file. Default `sim/collector/.data`, which git ignores.

  **Keep or move the data folder only as a whole.** Never put back `sent.json` or `outbox.jsonl` on
  its own from a copy or a backup. The program cannot tell an older `sent.json` from an honest earlier
  state: it takes the shots after the position in that file as not yet sent and sends them again, the
  older versions of a shot first, and the hub then shows an older score for that shot until the newer
  version arrives in a later post. A whole folder put back from a copy is itself an old folder: if a
  shot was waiting in it when the copy was taken, the start sends that older version over the newer
  one the hub holds. So a data folder put back from a copy or a backup, whole or in part, must not be
  started. When a file of the data folder was lost, was put back from a copy, or is in doubt, there is
  one thing to do: stop the program, move the whole data folder aside, and start the program with an
  empty data folder. That sends the shots still in GSPro's file, read from that file and sent again at
  their latest versions (the hub answers `unchanged` for a shot it already holds in the same version
  and `revised` for one it holds in an older version); waiting shots that GSPro's file no longer holds
  are not sent. A later card (the server with a key per bay) numbers the posts so that the hub can
  refuse an older one; until then this is a rule for the person.

## What it never does to GSPro's file

It only reads it. It opens the file for reading, reads it to the end into memory, closes it at
once, and works on a copy in its own data folder. It never opens GSPro's file for writing, and never
renames, moves, truncates or deletes it. All file access is in one module (`src/files.ts`) that has
no call able to name GSPro's file for any of those.

Limits of that: reading this way did not make a writer that saves in place fail in the review's
test. A program that saves by replacing the file, or that allows no sharing at all, can fail
against any reader on Windows. The recorder used on 2026-11-23 read the file the same way through a
full round without trouble. A live check beside GSPro is the owner's, after the merge.

## Sends only to this PC, for now

`SIM_HUB_URL` must be `http://127.0.0.1:<port>` or `http://localhost:<port>`. Any other address, and
`https`, is refused at start with a plain message. A redirect from the server is never followed.
Only the hub's own answer counts as sent: a `200` whose body carries the four counts adding up to
the batch. The hub has no sign-in yet.

## What it does when things go wrong

The status word `server=` says why: `up`; `down` (no answer); `redirect` (a 3xx, never followed);
`unexpected` (a 200 that is not the hub's answer); `busy` (a 503); `refusing-<status>` (any other
answer). In every case except `up` the batch stays and it tries again, waiting longer each time, at
most 30 seconds; a `Retry-After` in whole seconds is honoured up to 30 seconds. A 400 or 413 moves
that batch to `refused.jsonl` and it is not retried.

- File missing (GSPro has not started a round): waits, no error.
- A copy cut off mid-write: tried again on the next look; the status says `broken` after ten seconds.
- A layout it does not know: sends nothing from that copy and says `layout_unknown`; what is already
  queued stays queued.
- GSPro empties its file at a new round: records of the earlier round still waiting are still sent.
- A shot is never twice in one post: if a record changes while its first version waits, the later
  version goes in the next post.
- Stopped and started again: it carries on from its data folder. A batch can be sent twice after a
  crash; the hub answers `unchanged` for it.
- A start that fails says what is wrong and to stop the program and move the data folder aside
  (it may hold shots not yet sent). It never says to delete it.

## One post at a time, and one copy of the program

The program sends one post at a time. It waits for the hub's answer, or gives up on it after 10
seconds, before it sends the next one. This is the rule the hub's [API.md](../hub/API.md) sets for
every sender, and the reason is that the hub keeps, of two overlapping posts that hold the same shot,
the one whose body finished last: with two posts in flight an older copy of a shot could be put over
a newer one.

Run one copy of the program for a GSPro file. The program's own sender refuses a second post while
one is unanswered (the refused post sends nothing and marks nothing, and the program tries again
after a wait); that gate is inside one copy of the program and does not cover two copies. Two copies,
each with its own data folder, post every
shot twice, and in the ordinary case, with both copies left running to the end, the hub still ends on the right
scores (a test of this program feeds the recorded round to two copies and the hub ends on the right
scores); that does not show that two copies are safe in every case: if one of them is closed early,
the hub can be left on an older version of a shot (see the step below). Two copies started without `SIM_COLLECTOR_DATA` share one data
folder, which is the easiest way to run two by mistake. The hub still ends on the right scores, but
both copies write every shot into the one outbox, and the record of what was sent is whichever copy wrote it last; so at the next start shots
already sent can be sent again, up to every shot of the round, and older versions of a shot can be sent
after newer ones: the hub can then show an older score for that shot until its newest version is sent again.
While both run, each may show `disk=error` for a moment. While two copies run on one GSPro file,
whether they share a data folder or not, the hub can also show an older version of a shot for a while
(an older copy of a shot is posted after a newer one was acknowledged), and two posts can be out at
once; the scores end right only while a copy that still has the newer version to send keeps running.
Once a copy is closed, the hub can be left on an older version until the step below is done. So run one
copy per bay PC. (A later card adds a lock on the data folder.)

**If two copies of the program ran at the same time for one GSPro file, do all of this at once:**
close the second window; stop the other copy too; move its data folder aside (both data folders, if
each copy had its own); start one copy with an empty data folder. The reason: a copy never sends again
a version of a shot it has already had acknowledged. So if the copy that was closed posted an older
version of a shot last, the hub keeps showing that older score, and the copy left running will not put
it right, however long it runs. One copy started on an empty data folder reads GSPro's file again and
sends every shot in it at its latest version (what that sends is said above, under
`SIM_COLLECTOR_DATA`), which puts it right.

A data folder that was moved aside and still holds shots not
yet sent must not be started again after the round it belongs to has been played on: its waiting shots
are older copies and would be put over newer ones. Keep such a folder, and do not start the program on
it again; the program cannot tell which round its waiting shots belong to, so there is no safe way yet
to send them.
If you move a data folder aside and start the program fresh, the shots of the round that is still in
GSPro's file are read from that file and sent again (the hub answers `unchanged` for a shot it
already holds in the same version and `revised` for one it holds in an older version); only waiting shots that GSPro's file no longer holds, from an earlier round or from before the
file was emptied, are never sent.

## Limits

- Shots are captured only while the program runs. If it is down while GSPro starts a new round,
  shots of the earlier round it had not yet queued are gone.
- While the hub cannot be reached, waiting shots are kept on disk and in memory (about 13 MB for an
  eight-player round).
- The outbox is tidied: when nothing is waiting and the file is over 1 MB it is rewritten to one
  short line per shot of the current round. Each append is forced onto the disk before it counts.
  A cut-short last line (a crash mid-write) is dropped at start, and one line says so.
  The tidy-up replaces the outbox first (it begins with a header line that numbers the tidy-up) and
  then writes the record of what was sent with the same number. If the program is stopped or crashes
  between the two, the next start sees that the outbox is one tidy-up ahead and finishes the job: shots
  already acknowledged are not sent again, except the one batch whose acknowledgement could not be saved,
  which is sent once more with the content the hub already holds. If the second write failed and the program went on, the
  shots it queued after the tidy-up wait on the disk after the tidy-up's lines; the next start finds
  them there and sends them. Files that do not belong together (any
  other pair of numbers) stop the start with a message to move the data folder aside. An empty read of
  GSPro's file never starts a tidy-up. The header costs one short line, read once at start, in the
  same pass over the file as every other line. A program from before this change refuses a data folder
  that this one has tidied ("The outbox file is damaged") and changes nothing in it, and this program
  still reads that folder afterwards; so to go back to an older version, move the data folder aside.
  When writing a shot to the outbox fails, the outbox is cut back to what the program had counted
  before anything else is written, so a shot is never in it twice.
- `refused.jsonl` is never cleared by the program.

Tests: `npm run test:sim`.
