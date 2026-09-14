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

---

# ⚠️ CORRECTION — 14 Sep 2026, written while executing this plan

**The sequencing below is wrong, and this section supersedes it.** It was written from the *method
count* (38 methods, 1 subject-aware) without measuring the *reachability set* — which sections a
coach can actually open. Measured now:

```
HIDDEN_FOR_COACH = VIDEO_TEST_SECTIONS + PLAYER_ONLY + FITNESS_SCREEN + RAIL_METRICS
PLAYER_ONLY        = today, cal, plan, build, fitness, transfer, perf, thread   ← 8 sections
VIDEO_TEST_SECTIONS= intake, evidence                                           ← both audiences
⇒ a coach reaches exactly TWO sections: roster and profile.
```

`profileVals` — the one subject-aware method — is what powers `profile`. **So all 24 `this.state`
methods are real but unreachable by a coach, and there is no live misattribution in the sections.**
Threading a subject through them today surfaces nothing, because the eight screens stay hidden.

**And un-hiding them would not help either**, because the per-student data does not exist. Of
`RosterRow`'s ~22 keys, the ones with a producer are: `id, n, hcp, target, carry, hand, intake,
drills, notes, file`. `tier`, `zone`, `days`, `sg`, `leak`, `read`, `note`, `tone`, `answer`,
`est`, `grid`, `hist` are all `''`/`{}`/`[]`/`null`. Subject-without-data un-hides blank screens;
data-without-subject cannot render. **The dependency runs the opposite way to what is written below.**

### What Layer 1 is actually for, and the live bug it fixes

Its value is **not** the coach — it is the **player**, on the one screen both audiences share.

`const self = who.id === 'hale'` is never true. A player's roster is `[]`, so
`who` falls back to `EMPTY_PLAYER` (`id:''`, `n:''`, `hcp:null`, `file:{}`). **A player opening
their own profile sees a blank placeholder person** — no name, no handicap, no handedness, no
carry, an empty interview, and the fields `readOnly` because `readOnly: !self`. That is live today
and it is the real content of "fix `self`".

⚠️ **Do not simply make `self` true.** Three fabricated literals sit in its branches and would
switch on: `'Day 41 of 90'` (`:4021`), `'265 yd driver carry'` (`:4031` — the very literal the
`PLAYER_CARRY` work removed), and a default target handicap of `5` (`:3891`). Each self-branch must
fall back to the subject's real value, not to a literal.

### Corrected order

| # | Work | Why here |
| --- | --- | --- |
| 1 | ~~Layer 3 — notes~~ | ✅ shipped 2026-09-14 (`dff6de5`, `087130a`) |
| 2 | ~~Layer 2A — hide rail metrics~~ | ✅ shipped 2026-09-14 (`4361949`) |
| 3 | **Layer 1, scoped to `profile`** | fixes the live player bug above; the screen is reachable TODAY |
| 4 | **Per-student producers** (practice log, tier/zone, days) | must precede any un-hiding |
| 5 | Layer 1 across the other 23 methods + un-hide sections | only pays off once 4 exists |

Layer 1 across all 24 methods stays on the board — it is the gate for the eight hidden sections —
but it is **not** the next thing, and doing it before step 4 buys nothing.

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

Today the rail shows the **viewer's own** golf. For a coach that is noise: it is their handicap,
their target, their transfer gap. Its **nav** half is already role-correct — every item is
`sc-if`-guarded and the server closes twelve of them for a coach.

## The exact blocks — measured, with line numbers

| Block | Opens at | Label at | Bindings it consumes |
| --- | --- | --- | --- |
| `EVERY NUMBER VS <n> HANDICAP` + `TOTAL SG` | `~50` | `51` | `railHcp`, `railSG`, `railSGColor` |
| `THE FOUR ZONES` | `~62` | `72` | (zone links; nav-ish — see note) |
| `TARGET HANDICAP` + slider | `~108` | `109` | `targetHcp`, `targetRaw`, `targetSet`, `targetNote` |
| `PRACTICE` | `~115` | `116` | `practiceHcp` |
| `REAL` + ± steppers | `~121` | `122` | `realHcp`, `realHcpUp`, `realHcpDown`, `realHcpNote` |
| `TRANSFER GAP` | `~131` | `132` | `gapHcp`, `gapHcpColor`, `gapHcpLabel` |
| `THE GUARANTEE` | `~138` | `139` | `guaranteeRead`, `guaranteeBar` |

⚠️ **`THE FOUR ZONES` is navigation, not a metric — do not hide it.** It routes to the four zone
screens and a coach needs it once Layer 1 lands.

⚠️ Three of these already render honest dashes for everyone (`practiceHcp`, `gapHcp`,
`guaranteeRead`) because their inputs are Forge's or nonexistent. Hiding them for a coach removes
five lines of dashes; it does not remove information.

## Step A — hide the metric blocks for a coach  *(~30 min, no dependencies)*

Copy the `FITNESS_SCREEN` pattern added 2026-09-10, which is the working precedent for a
**sub-block** guard (as opposed to a whole section):

1. **`proto/Dashboard.dc.html`** — wrap each of the five metric blocks (rows 1, 3, 4, 5, 6, 7 above;
   NOT `THE FOUR ZONES`) in `<sc-if value="{{ showRailMetrics }}" hint-placeholder-val="{{ true }}">`.
   Six wraps. Balance `</sc-if>` for each.
2. Add the flag beside the other `show*` flags at **`:5137`**:
   `showRailMetrics: !isHidden('railMetrics'),`
3. **`server/protoData.ts`** — add the key next to `FITNESS_SCREEN` (`:123`) and include it in
   `HIDDEN_FOR_COACH` only (`:128`), never `HIDDEN_FOR_PLAYER` (`:131`):
   ```ts
   const RAIL_METRICS = ['railMetrics'] as const   // the viewer's OWN golf; noise for a coach
   ```

**Verify:** sign in as a coach — rail shows Atlas mark, nav, the four zones, and the account chip,
and nothing else. Sign in as a player — rail unchanged.

## Step B — the rail as the selected student's header  *(~1 hr, needs Layer 1)*

Re-point the same bindings at `subject()` and un-hide for a coach. `railHcp` / `realHcp` / `targetHcp`
become the **student's**, so a coach reading a student always has that student's baseline on screen —
which is the reason every benchmark on the page exists.

⚠️ `realHcpUp` / `realHcpDown` are **steppers that mutate**. A coach must not nudge a student's
self-reported handicap, so on the coach path they must be inert (`readOnly`, same treatment
`pfDrills` got on 2026-09-11) — not merely hidden.

**This is the one surface where a fresh design would genuinely help.** If anything goes to Claude
Design, send *"a rail for a coach reading one student — who they are, where they are, what needs
attention"*, not a restyled copy of the player board.

# Layer 3 — NOTES  *(smallest; backend and a working UI both already exist)*

## Nothing needs building server-side — verified 2026-09-11

**The table.** `atlas.coaching_notes`, with a `visibility` vocabulary.

**The endpoints.** `server/routes/notes.ts`, all four on one auth chain:

| | |
| --- | --- |
| `GET` | `/api/coach/students/:userId/notes` |
| `POST` | `/api/coach/students/:userId/notes` |
| `PATCH` | `/api/coach/students/:userId/notes/:noteId` |
| `DELETE` | `/api/coach/students/:userId/notes/:noteId` |

**The POST body** (`createSchema`, `notes.ts:73`) — `.strict()`, so an extra key is a 400:

```ts
{ body: string (trimmed, 1..4000), visibility?: 'coaching_team' | 'private' | 'shared' }
```

**The row shape** (`client/src/lib/types.ts:85`):

```ts
interface CoachingNote {
  id, subjectUserId, authorUserId, authorDisplayName: string | null,
  body: string, visibility: 'coaching_team' | 'private' | 'shared', createdAt: string
}
```

**The RLS already routes a note to the student.** `coaching_notes_select`:

```sql
   author_user_id = current_user_id()                                   -- the author
OR (visibility IN ('coaching_team','shared') AND coaches(subject))      -- the coaching team
OR (visibility = 'shared'   AND subject_user_id = current_user_id())    -- ← THE STUDENT
```

So **`visibility = 'shared'` is already "comment back to the student"**, with no schema or policy
change. `private` is author-only; `coaching_team` is coaches-only.

**A working UI already exists** at `client/src/components/Roster.tsx:146` (load) and `:158` (save) —
compose box, visibility select, list, error handling.

## The only gap is reachability — and one trap

`Roster.tsx` is never rendered. `App.tsx` redirects coaches to the prototype and `Roster` survives
only in a comment at `App.tsx:224`. **Port the interaction into Luke's dossier pane rather than
resurrecting `Roster.tsx`** — that pane is the cream block, `proto/Dashboard.dc.html:386`–`:474`.

### ⚠️ THE TRAP — read before writing a line of this

**`notes.ts` uses `verifyToken`, which is BEARER-ONLY** (`notes.ts:14-19`). The prototype page is a
server-rendered document authenticated by a **session cookie**; a browser navigation cannot carry an
Authorization header. Calling these endpoints from the prototype as-is returns **401**. This exact
bug already shipped once, on the coach's drill tick.

**The fix is one line, and the precedent is in the repo.** Change `notes.ts`'s chain to match
`coach.ts:57-62`:

```ts
const identityChain: RequestHandler[] = [
  cookieOrBearer,          // ← was verifyToken
  attachUser(pool), ensureAtlasAccess(pool), requireApp('atlas'),
]
```

and call it from the prototype the way `tickDrill` already does (`Dashboard.dc.html`):

```js
fetch('/api/coach/students/' + userId + '/notes', {
  method: 'POST', credentials: 'same-origin', ...
})
```

## The work — two surfaces, same block

1. **Coach, on a student's file.** List the notes, compose a new one, with a visibility control.
   Default `coaching_team`. **Label the options in plain language, because one of them is visible to
   the player** — e.g. *"Send to the player"* (`shared`) vs *"Team only"* (`coaching_team`) vs
   *"Just me"* (`private`). A coach must never discover after the fact that the student read it.
2. **Player, on their own file.** Read-only list of `shared` notes only. RLS enforces this already,
   so the client does not need to filter — but it must not offer a compose box.

**The pattern to copy is `pfDrills`**, made two-sided on 2026-09-11: one block, audience chosen by
`ROSTER.length === 0`, with `pfDrillsTitle` / `pfDrillsBlurb` switching the copy and the write path
disabled on the player side. Notes are the same shape.

⚠️ Use **Luke's dark palette** — `#1a222e` card, `#ece7db` name, `#8d99a8` meta, `#66717f` ref. The
sign-off block shipped with light-theme values and rendered as a grey slab until it was fixed.

**Verify end to end, with two accounts:** coach writes a `shared` note on a student → student signs
in and sees it; coach writes a `coaching_team` note → student does **not** see it. Check the second
case, not just the first.

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
