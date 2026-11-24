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
marked round's heading.

"Share a name" is decided by `normalisedName`: format characters (zero-width characters, the soft
hyphen) removed, other control and separator characters turned into spaces, every dash-like
character and the minus sign taken as a plain hyphen, compatibility normalisation, accents ignored
(decompose, drop combining marks), runs of spaces collapsed, trimmed and lower-cased. Only the
comparison changes; the printed name does not. Letters from different alphabets that only look alike
are not detected, and a real space inside a name keeps it a different name from one without the space.
The blank-looking letters (the Hangul fillers and the braille blank) count as spaces in the comparison.
That is why every player line starts with the player's number in the round, `P1`, `P2`
and so on in the order the players were first seen (`playerNumber` in `rounds()`): two lines in one
round are never identical, whatever the names or ids are, and no part of an id is printed. For
example `P1 ZZTEST-A | hole 3: 6  hole 12: 4  hole 15: 8  total 18`. A bar separates the name from the
scores, and every bar in a printed name or course key (and every look-alike of the bar: the full-width
bar, the box-drawing verticals, the broken bar, the divides sign and so on) is replaced by a space, so nothing a file
contains can put text to the right of the bar.

Player numbers are first-seen order within one book: a fresh book reading the same records in another
order can number the players differently, so a number is only meaningful inside one book's output.

A shot never changes owner. If a record arrives whose `ShotID` the book already holds under another
`UserGuid` or another `RoundID`, it is not applied: `ingest` counts it in `conflicts`, and `issues()`
lists it (a kind, the round id and the shot id, nothing else from the file). Inside one call
every repeat of a `ShotID` is judged against the first record with that `ShotID` in the same call,
never against the book: a repeat with different content is a conflict and is not applied, and an
identical repeat changes nothing and is counted as `unchanged`. Only the first one in the call is
compared with the book. So reading the same file twice gives the same scores and flags both times.
A later record with the same `ShotID`, owner and round and different content is a revision.

## Limits on what is read and printed

The reader refuses (with `UnknownLayoutError`, naming the field) any integer field that is not a safe
integer, a `Hole` outside 0 to 99 and a `HoleShot` outside 1 to 999, a `ShotID` or `UserGuid` longer
than 128 characters, a `PlayerName` or `CourseKey` longer than 256, and any record nested more than
32 levels deep (the record itself is level 1). One validator does all of this, and `ingest` runs it
on every record it is given, so a record passed straight in (not through the parser) is checked the
same way.

What `ingest` does with a record it is given, in one pass that builds the book's own plain copy as it
goes (the copy is what is checked, stored and compared). Nothing of the caller's is ever called, and
each value is read once:

- A null, string, boolean or number is copied as JSON writes it (a number that is not finite becomes
  null, minus zero becomes zero). A bigint is refused. A function, a symbol or undefined is left out
  of an object and becomes null in an array.
- An object is looked inside only if it passes these tests, in this order, none of which runs any
  code of the caller's: it is not a proxy (every proxy is refused, whatever it wraps); it is not a
  view of a buffer, a buffer, a boxed primitive or a module namespace object (these look at what the
  value really is, so a swapped prototype does not fool them); it is a true array (prototype exactly
  `Array.prototype`) or an object whose prototype is exactly `Object.prototype` or null. Anything
  else (a typed array, a `Map`, a `Set`, a `Date`, an instance of a class, an object from another
  realm) is refused with `UnknownLayoutError`.
- A true array: its length is read, refused over 100,000 entries and counted against the 250,000
  values a record may hold, all before any entry is touched; it may carry no own enumerable key that
  is not an index; each entry is read through its own property descriptor, and a hole, a getter or a
  setter is refused.
- A plain object: its own enumerable string keys are counted against the 250,000 values, then each is
  read through its own property descriptor (a getter or a setter is refused). Symbol keys and
  non-enumerable keys are ignored. A property named `toJSON` is like any other property: it is never
  called.
- Also refused: more than 32 levels, and any object reached a second time inside one record (a shared
  reference or a cycle; records read from a file never share objects; the same object as two records
  of one call, or a sub-object shared between two records, is not refused, because each record is
  walked and copied by itself).

Everything `JSON.parse` returns is a true array, a plain object or a primitive, so nothing from a file
is refused by these tests; the parser's records go through the same rules (without building a copy).
`JSON.stringify` is not applied to anything the caller gave. Every refusal is an `UnknownLayoutError`,
and anything that throws while a record is read is turned into one. `ingest` works in two passes: a call that throws leaves the book as it was. Each
record is checked twice per read (once by the parser, once by `ingest`), so a crafted file near the
size limit can take several seconds. The text formatter replaces control, format
and line or paragraph separator characters (Unicode classes Cc, Cf, Zl, Zp) in names and course
keys with a space (a name that uses joined emoji prints with spaces between the parts) and cuts them
to 64 code points; `rounds()` returns them exactly as the file had
them. The command refuses a file over 50,000,000 bytes without reading it. After the rounds it
prints one line when the book refused anything, for example
`Issues: 2 (duplicate_shot_in_copy 1, shot_owner_changed 1); records refused: 3`: the count of each
kind (fixed words only) and the number of records refused over every read the command made.

## What the book does not do

- It only adds and revises. A record missing from a later copy is kept.
- Copies must be fed in the order they were taken. For one shot the last version fed wins, so an
  older copy fed after a newer one rolls that shot back.
- A round stays in the book after GSPro empties its file.
- Duplicate keys inside one record follow JSON's rule: the last one wins.
- A single corrupt or crafted copy can flag many rounds, earlier ones included, for the life of the
  book, because a conflict flags both the round that keeps the shot and the round that claimed it.
  The server card decides how to treat a bay whose file is corrupt.
- The separator on a printed player line is the plain bar. Some other marks and letters can look like
  one (a lower-case `l`, the double vertical line, some script marks); the scores are what follows
  the first plain bar on the line. The list of look-alikes that are spaced out of a printed name is
  not complete and is not meant to be.
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
`formatScorecard`, `normalisedName`, `runScorecard` (the command's work, with the file access passed
in) and `loadRecording(dir)`.

## The recording

`fixtures/gspro-4.1.13/2026-11-23/` holds a test of GSPro 4.1.13 with two test players, 38 copies of
the round file. It is stored compactly; see `SOURCE.md` there. Do not replace the recorded files
with real player data.
