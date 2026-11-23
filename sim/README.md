# sim: read a recorded GSPro round

A small library and a command that read the round file GSPro writes (`currentRound.dat`, a JSON
array of shot records) and print each player's score per hole. It reads files and prints. It opens
no network connection and writes no file.

## The scoring rule

The hole number is `Hole + 1`. A hole is finished when a record for that round, player and hole has
`HoleResult` 7, and its score is that record's `HoleShot`; otherwise it is in play and shows the
highest `HoleShot` seen so far. Records are never counted, and `isHoled` and `isGimme` are never
read. A player's total is the finished holes only. Records with a negative `RoundID` (the practice
range) belong to no round. Players are kept per round and never merged across rounds; inside a
round a player is identified by `UserGuid`, so two ids with one name are two players, and one id
with two names is one player, shown under the name on the first record seen. Two finishing records
for one hole that disagree report the higher. This rule matches GSPro's own scorecard for the
recorded round.

## When a person should look

The score above never changes, but the library marks (`needsReview`) what a person should check. A
hole is marked when two finishing records disagree, when any record on the hole has a `HoleShot`
above the finished score, or when its records disagree on `HolePar`. A player is marked when any
hole is, or when one `UserGuid` arrived under two names in the round. A round is marked when any
player is, when its records name two courses, when two players in it share a name, or when the book
refused a record that touched it (below). `rounds()` returns the mark at all three levels. The
formatter prints ` (needs review)` after a marked hole, after a marked player's total and on a
marked round's heading, and when two players in a round share a name it adds the last four
characters of each one's `UserGuid` after the name, or more of the end if those four clash, up to
the whole id, so two different ids never print identical lines.

A shot never changes owner. If a record arrives whose `ShotID` the book already holds under another
`UserGuid` or another `RoundID`, it is not applied: `ingest` counts it in `conflicts`, and `issues()`
lists it (a kind, the round id and the shot id, nothing else from the file). Inside one call
every repeat of a `ShotID` is judged against the first record with that `ShotID` in the same call,
never against the book: a repeat with different content is a conflict and is not applied, and an
identical repeat changes nothing and is counted as `unchanged`. Only the first one in the call is
compared with the book. So reading the same file twice gives the same scores and flags both times. A later record with the same `ShotID`, owner and round and
different content is a revision.

## Limits on what is read and printed

The reader refuses (with `UnknownLayoutError`, naming the field) any integer field that is not a safe
integer, a `Hole` outside 0 to 99 and a `HoleShot` outside 1 to 999, and any record nested more than
32 levels deep (the record itself is level 1). `ingest` checks the nesting too and works in two
passes: a call that throws leaves the book as it was. The text formatter replaces control, format
and line or paragraph separator characters (Unicode classes Cc, Cf, Zl, Zp) in names and course
keys with a space and cuts them to 64 code points; `rounds()` returns them exactly as the file had
them. The command refuses a file over 50,000,000 bytes without reading it.

## What the book does not do

- It only adds and revises. A record missing from a later copy is kept.
- Copies must be fed in the order they were taken. For one shot the last version fed wins, so an
  older copy fed after a newer one rolls that shot back.
- A round stays in the book after GSPro empties its file.
- Duplicate keys inside one record follow JSON's rule: the last one wins.
- What GSPro does to the file on a mulligan, an edit, a concede or a resume is not yet known. The
  server card decides how whole copies replace each other once a recording shows it.

## Commands

```bash
npm run test:sim         # type-checks sim/ with sim/tsconfig.json, then runs the tests
npm run sim:scorecard    # replays the recording and prints every round
npm run sim:scorecard -- path/to/currentRound.dat   # prints one file
```

## The library

`sim/core/src/index.ts` exports `parseRoundFile(text)` (refuses a layout it does not know, with
`UnknownLayoutError`), `RoundBook` (`ingest(records)`, `rounds()`, `issues()`, `rangeShots`),
`formatScorecard` and `loadRecording(dir)`.

## The recording

`fixtures/gspro-4.1.13/2026-11-23/` holds a test of GSPro 4.1.13 with two test players, 38 copies of
the round file. It is stored compactly; see `SOURCE.md` there. Do not replace the recorded files
with real player data.
