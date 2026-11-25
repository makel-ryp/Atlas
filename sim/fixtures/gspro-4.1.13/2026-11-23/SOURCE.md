# Source of this recording

A test of GSPro 4.1.13 on 2026-11-23, played at Bluejack National (`bluejack_gsp`) by two test
players named `ZZTEST-A` and `ZZTEST-B`. While it ran, GSPro's `currentRound.dat` was copied 38
times (capture times are in `captures.json`, local time, taken from the copies' file names).

## How the compact form was made

The 38 copies are cumulative: each is the previous copy with records added, and no record changed
between copies (checked copy against copy). GSPro emptied the file between round 18 (copies 1 and
2) and round 19 (copies 3 to 38). So the repo holds only:

- `round18-final.dat`: byte for byte the last copy of round 18 (copy 2, 2 records);
- `round19-final.dat`: byte for byte the last copy of round 19 (copy 38, 39 records);
- `captures.json`: for each of the 38 copies, its number, its capture time, its round, and how many
  records it held.

Copy N is the first `records` records of its round's final file. `loadRecording` in
`sim/core/src/recording.ts` rebuilds the copies that way.

## How it was proved

A throwaway script (not committed) rebuilt each of the 38 copies from these files and compared it,
record for record, to the original parsed as JSON: 38 of 38 equal. The checksums of the two recorded
files equal those of the originals (SHA-256 `773dcb43...b208c` for round 18, `99cafbfd...21396` for
round 19). `sim/.gitattributes` stops git rewriting line endings in this folder.

## Known answer

GSPro's own scorecard for round 19 (holes 3, 12 and 15): `ZZTEST-A` 6, 4, 8 = 18; `ZZTEST-B` 5, 5, 10
= 20. Round 18: both players on hole 1, one stroke each, in play. The two players have the same
names in both rounds but different GSPro ids, and are not merged.
