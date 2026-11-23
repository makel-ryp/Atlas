# sim: read a recorded GSPro round

A small library and a command that read the round file GSPro writes (`currentRound.dat`, a JSON
array of shot records) and print each player's score per hole. It reads files and prints. It opens
no network connection and writes no file.

## The scoring rule

The hole number is `Hole + 1`. A hole is finished when a record for that round, player and hole has
`HoleResult` 7, and its score is that record's `HoleShot`; otherwise it is in play and shows the
highest `HoleShot` seen so far. Records are never counted, and `isHoled` and `isGimme` are never
read. A player's total is the finished holes only. Records with a negative `RoundID` (the practice
range) belong to no round. Players are kept per round and never merged across rounds. This rule
matches GSPro's own scorecard for the recorded round.

## Commands

```bash
npm run test:sim         # type-checks sim/ with sim/tsconfig.json, then runs the tests
npm run sim:scorecard    # replays the recording and prints every round
npm run sim:scorecard -- path/to/currentRound.dat   # prints one file
```

## The library

`sim/core/src/index.ts` exports `parseRoundFile(text)` (refuses a layout it does not know, with
`UnknownLayoutError`), `RoundBook` (`ingest(records)`, `rounds()`, `rangeShots`), `formatScorecard`
and `loadRecording(dir)`.

## The recording

`fixtures/gspro-4.1.13/2026-11-23/` holds a test of GSPro 4.1.13 with two test players, 38 copies of
the round file. It is stored compactly; see `SOURCE.md` there. Do not replace the recorded files
with real player data.
