# Build plan — the coach view, all three layers

**11 Sep 2026.** Written to be executed cold, by an agent or a person with no memory of this
conversation. Everything below was verified against the live repo and the live database on the date
above; line numbers are from `proto/Dashboard.dc.html` at commit `1d1a808`.

---

## 0. Orientation — read this before touching anything

| | |
| --- | --- |
| **Repo** | `/Users/makelmackbee/dev/ATR/atlas` — use ABSOLUTE paths |
| **⛔ Decoy** | `/Users/makelmackbee/Desktop/ATR/websites/atlas` is an old stub. Never edit it. The shell often starts there. |
| **Shared lib** | `/Users/makelmackbee/dev/ATR/eco` (`@ryp/eco`, vendored into Atlas as a tarball) |
| **DB** | Neon project `orange-mountain-36415593`, database `neondb`, app role `atlas_app` (NOBYPASSRLS) |
| **Deploy** | Railway, auto on push to `main`. `railway deployment list` to watch. |

**Three rules that are not negotiable:**

1. **Never edit `proto/support.js`.** It is Luke's homemade template runtime. It has no error
   boundary — one bad reference in a computed value blanks the entire page behind a red bar.
2. **Never print a number you do not have.** A fabricated value is the project's worst outcome; a
   dash is always correct. Most of the last week was removing invented numbers.
3. **Do not fork Luke's design.** `Dashboard.dc.html` IS the coach dashboard — his own handoff index
   says so. Sections are `sc-if`-guarded and filtered per role by `server/protoData.ts`.

**After EVERY edit to `Dashboard.dc.html`, run all four. A failure here is a blank page in production:**

```bash
cd /Users/makelmackbee/dev/ATR/atlas
F=proto/Dashboard.dc.html
echo "sc-if  $(grep -o '<sc-if' $F|wc -l) / $(grep -o '</sc-if>' $F|wc -l)"     # must match
echo "sc-for $(grep -o '<sc-for' $F|wc -l) / $(grep -o '</sc-for>' $F|wc -l)"   # must match
node --check <(sed -n '/<script type="text\/x-dc"/,/<\/script>/p' $F | sed '1d;$d')
npm run -s typecheck && npm run -s build
```

---

## The problem, in one measurement

Luke's file has 38 computed-value methods. **One** — `profileVals` — can render a person other than
the viewer. The other 37 read `this.state`, which is always the signed-in user. That is why a coach
sees a roster and one dossier and nothing else, however much data we load.

---

# Layer 1 — the SUBJECT  *(the real work; everything else is small)*

## What it is

One resolved answer to *"whose data is on screen"*, read by every method instead of `this.state`.

```
  player → subject = the viewer
  coach  → subject = the selected student (state.profileOf), else the viewer
```

## The exact work list — verified, not estimated

**24 methods read subject state. 24 distinct keys.** Ordered by size of change:

| Method | Lines | Subject keys it reads |
| --- | --- | --- |
| `renderVals` | 347 | disp, hand, impactOpp, log, sets, signed, speeds, tempo, ticked, tier |
| `planVals` | 107 | fitnessOn, phase, rebuild, signed, ticked, tier, verified, watched |
| `profileVals` | 210 | hand, hist, onboarding, profile, realHcp, targetHcp — **already subject-aware; this is the template** |
| `buildSteps` | 91 | pivot, signed, ticked, verified, watched |
| `forgeVals` | 213 | forge, realHcp, targetHcp |
| `intakeVals` | 110 | hist, onboarding, profile |
| `buildTarget` | 123 | realHcp, targetHcp |
| `stakeVals` | 43 | phase, rebuild, stake, tier |
| `demoVals` | 47 | impactOpp, signed, ticked, verified |
| `buildOnboarding` | 85 | onboarding |
| `autoVals` / `buildTrend` / `buildCoachCard` | 78 / 45 / 37 | forge, targetHcp |
| `greenChip` / `buildPlots` | 65 / 54 | disp, hand |
| `plannedZone` / `plannedWork` / `plannedMins` | 14 / 10 / 16 | phase, tier |
| `teamVals` | 50 | tier |
| `fitnessVals` | 26 | lifts |
| `buildImpactOpp` | 30 | impactOpp |
| `stepDrills` | 4 | pivot |
| `entry` / `patch` | 1 / 20 | log |

The 24 keys: `disp, fitnessOn, forge, hand, hist, impactOpp, lifts, log, onboarding, phase, pivot,
profile, realHcp, rebuild, sets, signed, speeds, stake, targetHcp, tempo, ticked, tier, verified,
watched`.

## Approach

Add ONE helper next to the existing `who` resolution (`:3774`) and thread it. Do **not** rewrite
`this.state` globally — only the 24 keys above are subject data; `view`, `railOpen`, `clock`, `vw`,
`session`, `tickErr` are viewer/UI state and must stay on `this.state`.

```js
// Beside the existing `who` at :3774.
subject() {
  const s = this.state;
  if (ROSTER.length === 0) return s;                 // a player: the subject is themselves
  const sel = ROSTER.filter(p => p.id === s.profileOf)[0];
  return sel ? Object.assign({}, s, subjectFrom(sel)) : s;
}
```

`subjectFrom(row)` maps a `RosterRow` onto the 24 keys, and **must return honest empties for keys
with no producer** — `forge`, `disp`, `speeds`, `log` etc. come back empty, not as the viewer's own
values. Falling through to `this.state` for a missing key is the one failure mode that matters: it
renders the COACH's numbers under the STUDENT's name.

### ⚠️ Fix `self` as part of this — it is currently unreachable

`:3775` is `const self = who.id === 'hale'`. `'hale'` is a sample id no real row carries, so the
self branch never runs, and a player's roster is `[]` so `who` falls back to `EMPTY_PLAYER`. Luke's
own comment: *"wiring it needs a product decision… guessing here is how the wrong player becomes
'you'."* Resolve it by injecting the caller's own id into `me` and comparing against that.

### Server side

`protoData.ts` ships thin roster rows today. Once a subject exists, the selected student needs a
full payload. **What is real and can be surfaced per student now:** handicap · target · driver carry
· handedness · coaching relationship + status · drill sign-off · intake (via `atlas.student_intake`).
**Needs an Atlas producer:** practice log, curriculum tier/zone, practice days. **Needs Forge:** the
four indices, transfer gap, SG, dispersion, radar.

## Definition of done

A coach selects a student and every unhidden screen shows **that student**, or an honest empty — and
never the coach's own numbers. Verify with two accounts side by side, not by reading the diff.

---

# Layer 2 — the RAIL

Today the rail shows the **viewer's own** golf: `EVERY NUMBER VS <target>`, `TARGET HANDICAP` slider,
`PRACTICE`, `REAL`, `TRANSFER GAP`, `THE GUARANTEE`. For a coach that is noise. Its **nav** half is
already role-correct — every item is `sc-if`-guarded and the server closes twelve for a coach.

**Step A (do first, ~30 min).** Add one key to the `hidden` mechanism — e.g. `railMetrics` — guard
the five metric blocks with it, and add it to `HIDDEN_FOR_COACH` in `server/protoData.ts`. Pattern to
copy: `FITNESS_SCREEN` / `showFitnessScreen`, added 2026-09-10.

**Step B (after Layer 1).** Re-point the same blocks at `subject()` so they become the selected
student's header. Then a coach reading a student always has that student's baseline on screen. This
is the one surface where a fresh design would genuinely help — if anything goes to Claude Design,
send *"a rail for a coach reading one student"*, not a copy of the player board.

---

# Layer 3 — NOTES  *(smallest; the backend and a working UI already exist)*

**Nothing needs building server-side. Verified 2026-09-11:**

- `atlas.coaching_notes` exists, with a `visibility` vocabulary.
- `server/routes/notes.ts` — GET, POST, PATCH, DELETE on `/coach/students/:userId/notes`, all on the
  standard four-link auth chain.
- `client/src/components/Roster.tsx:146,158` — a **working** compose-and-list UI.
- The RLS already routes a note to the student. `coaching_notes_select`:

  ```sql
  author_user_id = current_user_id()                                   -- the author
  OR (visibility IN ('coaching_team','shared') AND coaches(subject))   -- the coaching team
  OR (visibility = 'shared'   AND subject_user_id = current_user_id()) -- ← THE STUDENT
  ```

  **So a note written with `visibility = 'shared'` already reaches the student.** That is exactly
  "comment back to the student on fixes to make", and it needs no schema or policy change.

**The only gap is reachability.** `Roster.tsx` is never rendered — `App.tsx` redirects coaches to the
prototype, and `Roster` survives only in a comment at `App.tsx:224`.

**The work:** port the interaction into Luke's dossier pane (the cream pane, `:386`–`:474`) as a
notes block, rather than resurrecting `Roster.tsx`. Two surfaces:
1. **Coach, on a student's file** — list the notes, compose a new one, with a visibility control.
   Default `coaching_team`; **`shared` is the one the student sees, so label it plainly** — e.g.
   *"Send to the player"* vs *"Team only"*.
2. **Player, on their own file** — read-only list of `shared` notes. Same shape as the two-sided
   sign-off list shipped 2026-09-11 (`pfDrills`), which is the pattern to copy.

---

# Sequence

| # | Work | Size | Blocked by |
| --- | --- | --- | --- |
| 1 | **Layer 3 — notes** | ~half a day | nothing |
| 2 | **Layer 2 Step A — hide the rail metrics for a coach** | ~30 min | nothing |
| 3 | **Layer 1 — the subject** | ~1 day, one focused pass | nothing, but do not interleave |
| 4 | Layer 2 Step B — rail as student header | ~1 hr | Layer 1 |
| 5 | Per-student full payload in `protoData` | ~half a day | Layer 1 |

**Do 1 and 2 first** — they are independent, shippable, and each visibly changes the coach view,
which Layer 1 will not do until it is finished. Then do Layer 1 as one uninterrupted pass: it
touches 24 methods and a half-applied subject is worse than none, because it renders the coach's
numbers under the student's name.

# Open decisions — not for the implementer

- **Tier / phase selection** — what puts a player on a tier, what advances a phase. Blocks the
  curriculum surfaces. See `docs/operations/ASK-luke-coaching-ruleset-2026-09-09.md` (Luke).
- **Roster display names** — an account with no `display_name` renders its **email** as the student's
  name. Product call, not a bug.
- **`golf.player_metrics` does not exist** — gates strokes gained and club-head speed (T-36, T-51).

# Recently settled, so nobody re-asks

- **A coach MAY read a student's intake** — Makel, 2026-09-11. Built as `atlas.student_intake`, a
  view, never a policy. Withholds `quality_flag` and IPIP01–20; the injury narrative travels
  deliberately.
- **The coach's tick reaches the student** — shipped 2026-09-11, `me.drills` + two-sided `pfDrills`.
- **`Dashboard.dc.html` is the COACH dashboard**, per Luke's own handoff index. `AtlasPlayer.dc.html`
  is the player app.
