# Data provenance sweep — every value a user can see

**2026-10-16.** Five surfaces, 35 agents. Every value classified, then every *raw* and *derived*
claim independently attacked — because the interesting failure is not "no source found", it is
**"a source was named and it does not run"**.

| Class | Count |
| --- | --- |
| RAW | 60 |
| DERIVED | 72 |
| FABRICATED | 22 |
| PLACEHOLDER | 16 |
| GATED | 15 |
| **total** | **185** |

🔴 **22 fabricated, and 15 of the producer claims did not survive scrutiny.**
A value classed RAW or DERIVED by the first pass and downgraded by the second is the worst kind:
it looked sourced.

---

## The one that writes fabrication to the database

Everything else here is a display defect. This one persists.

**"Log today"** (`Dashboard.dc.html:7077-7081`) computes `mm = 15 + sets.filter(Boolean).length * 5`
and patches it as `{m: mm, b: 'Construction'}` through `PUT /api/practice/:day` into
`golf.practice_sessions`.

Nothing was timed. Nothing was reported. A **prescription is persisted as a measurement** — and the
calendar's minutes, the Today week strip and the coach's "days since" all read it back as practice
the player actually did. It is also the T-115 clobber: `Object.assign` spreads the existing row
first, so clocking 50 minutes of Calibration and then tapping the button stores **15 minutes of
Construction**.

---

## False claims about a named person

These are the ones that will read worst to anyone who knows the product.

- **`:1107` — "Assigned by Dr. Benoit from your movement screen".** A hardcoded string. No movement
  screen exists, no assignment exists, and a real coach's decision is attributed to him.
- **`:1187` — "Demo — <ref> · Dr. Benoit"** on every drill thumbnail and in the modal, with play
  triangles. **No video element or source exists anywhere in the template.** The play button opens
  an empty modal with his name on it.

## Seeded literals presented in the first person

Every account sees the same value, phrased as a fact about them.

- **Tempo — "You're holding 6 seconds"** (`:309`, seed `:3274 tempo: 6`) with the ladder rungs
  filled to match, before the player has touched anything. Lost on reload, invisible to a coach.
- **"Your pivot" — Cannon** (`:1096-1106`, seed `:3314 pivot: 'cannon'`) with a blurb about *their
  hip and ankle range*. Nothing was assessed. Switching to Anchor is local only.

## Counts read from a column nothing writes

- **"N of 23 drills completed"**, the whole-build bar, and every per-step `n / m` count
  (`:1070-1075`, `:7205-7206`) read `golf.drill_progress.ticked_at`. Grep across `server/`,
  `shared/` and `scripts/` finds **only SELECTs and type declarations** — no INSERT, no UPDATE.
  Every player reads **"0 of 23"** as a measured count. By the file's own dash convention
  (`weekRead`) it should be a dash, not a zero — and it contradicts the coach's verified marks on
  the same row.
- **The gold "unwatched" dot** (`:1121`) asserts *you have not watched this* from `state.watched`,
  seeded `[]`. `golf.drill_progress.watched_at` has no writer either.

## Copy that states system behaviour the system does not have

- **`:215` — "We'll close this at 90 minutes and ask you to confirm the length."** `over = secs >
  5400` only toggles the sentence on. **Nothing closes the clock or asks anything.** A forgotten
  clock logs its full elapsed time unprompted.
- **Coach, `:5292` — "No handicap on record."** Returned whenever every history bucket is null, and
  rendered *directly beside the handicap on file*.
- **Coach, `~:5310` — "the intake form is not yet wired to a table, so nothing has been collected".**
  Untrue in general; `atlas.intake_submissions` exists and is written.
- **Coach, `:5497` — the "Furthest behind" sort blurb** narrates a sort by distance-to-target that
  the comparator at `:5486` does not perform.

---

## Everything classed FABRICATED

1. **'Still practising? We'll close this at 90 minutes and ask you to confirm the length.'** — `:215 {{ clockOverrun }}; clockVals :4113 `over = secs > 5400``
   - source: Literal promise of system behaviour. `over` only toggles the sentence on. No code closes the clock or asks for confirmation at 5400s.
   - why it matters: The player is told the system will close the session and ask them to confirm. It does nothing, so a forgotten clock logs the full elapsed time unprompted.

2. **Minutes written by the 'Log today' button** — `:252 {{ logFromToday }}; renderVals :7077-7081`
   - source: `const mm = 15 + s.sets.filter(Boolean).length * 5` then patch(TODAY, {m: mm, b: 'Construction'}) -> PUT /api/practice/:day -> golf.practice_sessions
   - why it matters: A prescription is persisted as a measurement. The calendar's minutes and zone, the Today week strip and the coach's `days` read it as practice time the player did, though nothing was timed or reported. This is the one fabricated value in this audit that is written to the database.

3. **Tempo ladder: "You're holding 6 seconds." and the highlighted rungs** — `:309 {{ tempoLabel }}; :7082-7088; seed :3274 `tempo: 6``
   - source: state.tempo, seeded to the literal 6 for every account. The only writer is a local setState from a rung tap. Nothing persists it.
   - why it matters: Every player is told, in the first person, that they hold a 6-second tempo and sees the rungs filled to match, before they have touched anything. It is lost on reload and invisible to a coach.

4. **Rail badge: Team `sessionsLeft` ('11 / mo')** — `rail nav; teamVals :3885`
   - source: Sum of the hardcoded ALLOW constants {luke:1, brock:4, yannick:2, phil:4} at :3836. There is no plan or entitlement table behind it.
   - why it matters: A documented product decision rather than an invented number, so low severity. It is still a hardcoded per-player-looking figure with no per-user producer.

5. **Whole-build bar and 'N of 23 drills completed', per-step 'n / m drills' counts and bars** — `:1070-1075 {{ buildPct }} {{ buildRead }}; :7205-7206; buildSteps `count`/`pct` :4434, :4440`
   - source: s.ticked, from me.drills[...].tickedAt (golf.drill_progress.ticked_at). The only matches for tickedAt/ticked_at in server/, shared/ and scripts/ are SELECTs and type declarations (protoData.ts:170, :714, :837, :1178, :1341; coach.ts:249). No INSERT or UPDATE sets ticked_at.
   - why it matters: Every player reads '0 of 23 drills completed' as a measured count, from a column nothing writes. Under the file's own dash rule (weekRead) it should be a dash, not 0. It also contradicts the coach's verified marks on the same row.

6. **Gold 'unwatched' dot on each unlocked drill thumbnail** — `:1121 {{ d.unwatched }}; buildSteps :4490`
   - source: state.watched, seeded [] (:3338) and appended by openDemo (:4377-4378) in local state only. golf.drill_progress.watched_at has no writer (grep: reads only).
   - why it matters: Asserts 'you have not watched this' for drills the player opened last session. Persisting it needs a writer for watched_at.

7. **'Your pivot' chips (Cannon/Anchor) and the variant blurb** — `:1096-1106 {{ s.variantChips }} {{ s.variantBlurb }}; seed :3314 `pivot: 'cannon'``
   - source: state.pivot, seeded to the literal 'cannon' for every account. The chip onClick only calls setState. No column, route or intake answer assigns a pivot.
   - why it matters: Every player is shown the Cannon route as 'your pivot' with a blurb about their hip and ankle range. Nothing was assessed, and switching to Anchor is local only.

8. **'Assigned by Dr. Benoit from your movement screen'** — `:1107`
   - source: Hardcoded string in the template
   - why it matters: Straight false attribution of a named coach's decision, in the same file that deleted its siblings as fabrication.

9. **Demo modal: 'Demo — <ref> · Dr. Benoit', play-triangle thumbnails** — `:1187 and the 74px thumbnails at :1117-1121 and :1198-1204`
   - source: Hardcoded name in the markup; no video element or source exists anywhere in the template
   - why it matters: Every drill thumbnail and the modal imply a recorded demo by Dr. Benoit. None exists, and the play button opens an empty modal with his name on it.

10. **Sort blurb for 'Furthest behind' (standing)** — `Dashboard:5497-5499 (blurb), :5486 (comparator)`
   - source: Literal string: 'Sorted by who is furthest from their target. Handicap index is real; the target is only set for players who have one on file.'
   - why it matters: The page narrates a sort it does not perform, and a coach picking 'Furthest behind' sees an unsorted list described as sorted by distance to target. A hardcoded claim, not a number.

11. **Handicap history note 'No handicap on record.'** — `Dashboard:5292-5305 pfHistNote; markup :495`
   - source: Literal string returned when every hist bucket is null: `if (!first) return 'No handicap on record.'`
   - why it matters: A hardcoded sentence that is false for every player who has a handicap on file, shown directly beside that handicap. A user would believe the system has lost their number.

12. **Interview intro paragraph (empty-state branch)** — `Dashboard:~5310-5315 pfInterviewIntro; markup :516`
   - source: Literal string: 'No intake answers on record for this player. The intake form is not yet wired to a table, so nothing has been collected — read nothing into the blanks below.'
   - why it matters: A coach is told the form is not wired and nothing was collected. Both halves are untrue in general. Hardcoded claim about system state.

13. **Coach 'Open your dashboard' helper text: 'The page banner names what is live and what is still empty for want of a producer app.'** — `client/src/components/Profile.tsx:153-155`
   - source: Hardcoded literal. It reads `Luke\'s`: a backslash inside JSX text is not an escape, so the backslash renders on screen.
   - why it matters: Cosmetic, plus an unverified claim about another page's banner. Low severity, listed because the brief asks for every literal.

14. **Login: 'Demo · <view name>' under the heading** — `client/src/components/Login.tsx:62-67,119`
   - source: DEMO_VIEWS, a hardcoded map from email to a view label.
   - why it matters: It asserts which view an account lands on, but the file's own comment (59-61) says the app decides that from the run status. If the seed changes, the label silently lies. Low severity, because it only shows when ?as= is present and matches.

15. **Intake interview intro: 'Eight questions — five in your own words, three you pick from a list.'** — `client/src/quiz/InterviewStage.tsx:53`
   - source: Hardcoded literal.
   - why it matters: The count is wrong ('three'). Low severity, but it is a hardcoded fact that disagrees with its own source.

16. **Archetype name, tagline and coach line (e.g. 'The Architect: your handicap is falling and no zone is starving')** — `client/src/quiz/ResultScreen.tsx:231-233; shared/practice-dna/scoring.ts:539-593; results-content.ts:266-305`
   - source: computeArchetype: the Architect gate is `(hcp ?? 0) > 0 && !hasDim` (scoring.ts:560). hcp is hcpImprovement(profile), which parseInt-truncates PRO_HCP_NOW against PRO_HCP_3YR (self-reported).
   - why it matters: The Architect tagline asserts 'no zone is starving'. The gate only tests mastery !== 'dim', and a 'locked' (unmeasured) zone passes it. Allocation is never checked. So a golfer can be told 'no zone is starving' on the same full screen that says 'There's a zone your game has never met', and a baseline golfer with nothing measured gets the same claim. dnaSummary.ts:287-296 guards exactly this case for the coach's view. ResultScreen has no such guard. archetypeProvisional is never rendered (grep in client/src finds only comments at ResultScreen.tsx:56,60), although the file header promises a provisional badge. The only hedge is the 'First read' eyebrow.

17. **'Your swing is built ahead of your scoring' / 'Your scoring is ahead of your swing' verdict plus 'Estimated Mechanics Index: a–b'** — `client/src/quiz/ResultScreen.tsx:568-581; scoring.ts:482-531; results-content.ts:339-358`
   - source: estimateMi = clamp(handicap − ((mechanics−50)/50)·8, 0, 54). gap = handicap − est. verdict = gap > 2 ? downstream : gap < −2 ? construction : balanced. resolveHandicap uses parseInt, which truncates (scoring.ts:471-475).
   - why it matters: The headline reads as a comparison of an objective swing measure against scoring. It is a re-expression of one self-rated mechanics scale. The handicap input cancels out except at the 0 clamp. For plus-handicap golfers the verdict is 'Your scoring is ahead of your swing. Short game and scrambling are carrying you' no matter how they rated their swing, and no short-game data exists anywhere. Only the small grey line 'Estimated from your answers' hedges it. This verdict also gates the growth zone (scoring.ts:379).

18. **Practice efficiency (and Map tiles, Messy dial) for a golfer who reports zero practice and zero course hours** — `client/src/quiz/ResultScreen.tsx:181,365,405-409; scoring.ts:218-223,262-266; dnaSummary.ts:~234`
   - source: computeVolumeBreakdown returns alloc {0,0,0,0}. toRounded100 maps a zero total to {25,25,25,25}, so efficiency is scored against an invented even split.
   - why it matters: A golfer who said they do not practise sees 'Practice efficiency 67 · Leaking strokes' computed from an invented 25/25/25/25 split. The share card also prints '0% Messy Middle' (ResultScreen.tsx:302 passes breakdown?.messyShare ?? 0, and noVolume returns 0). 100% or 0% of nothing is not a finding. The coach summary guards this (dnaSummary.ts:287-296); the player's screen does not.

19. **Time bars: per-zone minutes, share, 'starved' tag, 'Declared practice: N% of Xh Ym a week'** — `client/src/quiz/ResultScreen.tsx:365-399; shared/volume.ts:25-66; config.ts:57`
   - source: Performance minutes = courseHours × 60 × COURSE_SWING_CREDIT (0.25), a 'STATED MODELLING ASSUMPTION, NOT A RESEARCH FINDING … awaiting Luke's sign-off' (config.ts:52-57). Other zones are practiceMinutes × the golfer's own split.
   - why it matters: The Performance bar prints modelled minutes (e.g. '30m' from 2 course hours) as if the golfer reported them, and 'Declared practice … a week' includes those credited minutes in effectiveTotal. The disclosure the source says is required was moved and never landed. This is a modelled figure presented as measured. The 25% is unsigned-off.

20. **facets[].practice_index: CHIPPING when target_yds is not sent for every shot** — `forgeScoring.ts:198-205`
   - source: Fallback: `const allowance = priced ? atgAllowance(...) : 0`, where priced requires every shot to carry target_yds (forgeScoring.ts:200-201)
   - why it matters: A 'cannot price' case is answered with a substituted number. The same chipping performance reads 3.4 strokes apart depending on an optional field, and the player cannot tell. Cannot-compute should be withheld or flagged. The ATG constants (CAL.atg) are also tagged GUESS. This matches the exclusion 'a fallback that substitutes a number where cannot compute is the truth'.

21. **POST /sessions: seed_honoured** — `forge.ts:530`
   - source: Hardcoded literal: `res.json({ ...out, seed_honoured: true })`, on both the fresh and the replay path
   - why it matters: The file header (forge.ts:59-75) still says the seed is NOT stored and every response returns seed_honoured:false. That is now false documentation. On a replay the original seed comes back with seed_honoured:true, though the replayed body's seed was ignored. Low severity, since the field is not a user-facing metric, but it is a literal standing in for a check.

22. **dispersion / missSide (meanYards, sdYards, side, shotsLostToBias)** — `index.ts:626-659`
   - source: Zone centres [-38,-18,0,18,38] yd (default arg, untagged GUESS per docs 5.4), deadband 3, yardsPerShot 0.06 (GUESS), and `sd = Math.sqrt(variance)
   - why it matters: 

23. **Today headline and sub-copy ('One thing today.' / 'Fifteen minutes. You don't choose what to practice — the build does.')** — `:187-188`
   - source: Literal marketing copy in markup. It makes no per-user claim about a measured value.
   - why it matters: Low. A player on a different prescription is still told 'fifteen minutes'.

24. **Session clock (mm:ss) and 'In <zone>'** — `:196-204 {{ clockRead }} {{ clockZoneLabel }}; clockVals :4082-4126`
   - source: Math.floor((state.now - clock.start)/1000); `now` is set by the 1s interval only while a clock runs; zone is the player's chip choice, defaulting to 'construction'
   - why it matters: A running session is lost on reload.

25. **Set 1..4 chips and '<n> of 4 sets logged'** — `:242-251 {{ setSlots }} {{ setsRead }}; renderVals :7066-7075; state seed :3274`
   - source: state.sets, four local booleans with no persistence, filtered to a count. The denominator '4' is a literal.
   - why it matters: The player's own tick, ephemeral. The '4' is an unsourced prescription and resets on reload. It is not a plausible fabricated measurement, but it states a target nobody set.

26. **Rail: Real handicap value, ± steppers, 'Self-reported' note** — `:99-104; buildTarget :6296-6305`
   - source: Initial value is golf.player_profile.handicap_index (me.hcp -> state.realHcp seed :3293-3296). The ± steppers call setState only.
   - why it matters: After a tap the rail shows a value labelled 'Self-reported' that was never saved, and it reverts on reload. The stored value is real, but the edited one is not.

27. **Build header copy ('Check it off when you've earned it … Tick a drill only when you've hit its condition')** — `:1026-1028`
   - source: Literal copy. The drill tick `onClick` is `() => {}` and `cursor: 'default'` (buildSteps :4488-4495).
   - why it matters: The copy tells the player to tick drills, but no drill can be ticked from this screen. The legend swatch 'You logged it' (:1071) can never appear.

28. **Five-step ladder (step names, Completed/Locked/Not started) and step card state/lock** — `:1039-1049 {{ stepLadder }}, {{ steps }}; renderVals :7192-7203, buildSteps :4410-4530`
   - source: `signed` from me.drills['plan:step-N'].signedOffAt. The writer is coach.ts:~380-405 (rolls up when all sibling drills have verified_at not null). Locks follow previous-step signed.
   - why it matters: Step state 'Not started' and the per-step counts depend on ticked (see the completion-counts row), so a step with coach-verified drills reads 'Not started'.

29. **Drill names, standards, '· Parallax' tags, 'why this drill' text, step bodies and conditions** — `:1124-1165; STEPS :2994-3068; whyFor :3155; shared/drills.ts`
   - source: Static curriculum literals (Luke's content) in STEPS, plus the shared/drills.ts ids used by the review and verify routes
   - why it matters: Content, not per-user metrics. Not a defect.

30. **Step footer: 'N drills to go' / 'Ready — waiting on your coach' / 'Completed' / 'Locked until Step n'** — `:1168-1170 {{ s.signLabel }}; buildSteps :4521`
   - source: ticked and signed counts
   - why it matters: Wrong while verified drills exist and ticked is empty.

31. **Impact opposites: 'Centred 0 / 1', row ticks, 'Centred' standard** — `:1186-1215 {{ ioCount }} {{ ioDrills }}; :7230; buildImpactOpp :4388-4420; seed :3314 impactOpp: []`
   - source: state.impactOpp, local toggles with no persistence. The '/ 1' is a literal for the one non-ball drill.
   - why it matters: A player's own self-claim ('Centred'), unverified, not visible to a coach and lost on reload. Starts honestly at 0 / 1.

## Producer claims that did not survive the second pass

- Today headline and sub-copy ('One thing today.' / 'Fifteen minutes. You don't choose what to practice — the build does.') (:187-188): claimed RAW -> actually FABRICATED — proto/Dashboard.dc.html:187-188 on branch forge-port. The h1 "One thing today." and the sub-copy "Fifteen minutes. You don't choose what to practice — the build does." are bare literals printed to every golfer on the Today header, outside any gate. Read-only, no DB query or app run. Three things in the same file contradict them. (1) The file's own TIERS table at :3221-3249 gives per-player durations. Foundation has home 15 and range 30. Builder and Competitive have home 30. Foundation phase 1 is '4 × 30 Range'. Phase 3 has '30 Range · Transfer' days. Phase 4 is 'No fixed cadence'. So a Builder or Competitive golfer, or a Foundation golfer in phase 1 or 3, is told "Fifteen minutes" when their own plan prescribes 30. (2) The Today step card was already stripped of "Volume 4 sets × 15" at :6774, with the comment "have no per-step source". The 15 was removed from the card and left in the header. Step 2 has 7 drills including 4 Proof Swing exams, and step 5 has 5 drills. No STEPS entry carries a duration. (3) "You don't choose what to practice" sits above the clock card, where the golfer picks their own zone from the chips built at :4102-4107. Another card on the same screen, the Tomorrow card, is hidden by the tomorrowShow gate. The claim "the build does" also depends on a prescription that is not shown. The headline also says "One thing today" while the step card is followed by the tempo ladder, the seven-day strip and the clock. No smoke check covers this copy, and a grep outside proto/Dashboard.dc.html found no other file naming it. The claimed producer ("makes no per-user claim about a measured value") is wrong, because "Fifteen minutes" is a per-user duration claim and it is false for some players. It is not RAW, DERIVED, PLACEHOLDER or GATED. It is a fixed prescription presented as true for everyone, which is FABRICATED, though low severity.

- Session clock (mm:ss) and 'In <zone>' (:196-204 {{ clockRead }} {{ clockZoneLabel }}; clockVals :4082-4126): claimed DERIVED -> actually FABRICATED — Checked on branch forge-port. (1) The mm:ss formula exists and is correct. clockVals at proto/Dashboard.dc.html:4111-4118 computes secs = floor((s.now - c.start)/1000). startClock (:4127) sets both start and now. The 1s interval (:4063) refreshes now only while state.clock is set. Initial state is `clock: null` (:3410), so the clock is not persisted across reload, as the claim says. This part is DERIVED from a user action and Date.now(). (2) The zone is not derived from anything. startClock hardcodes `zone: 'construction'` (:4127), so the player sees 'In Construction' without choosing it. clockZoneLabel also has a `cur ? cur.label : 'Construction'` fallback (:4118), which is unreachable because the block only renders when a clock runs. The default then persists. stopClock (:4152-4175) feeds blocks into summariseSession, takes the dominant zone as `next.b`, and calls patch(TODAY, next). patch PUTs /api/practice/:day, and server/routes/practice.ts:47-48 writes minutes and zone to golf.practice_sessions. A player who never taps a chip files their session as Construction in the DB and on the coach roster, whatever they did. That is a substituted value. The claim names the default but still calls it DERIVED. (3) Line :215 shows the text 'Still practising? We'll close this at 90 minutes and ask you to confirm the length.' The only code that uses 5400 is `const over = secs > 5400` (:4113), which feeds clockOverrun, and that only toggles this message. grep found no auto-close, no confirm dialog and no timer that stops the clock. The surfaced promise has no producer. A forgotten clock keeps running. The server accepts at most 1440 minutes (practice.ts:47), so anything over 24h gets a 400 and a rollback with 'Could not save'. (4) Writer exists (patch -> practice.ts), so the mm:ss and the write path are not dead code. I could not read golf.practice_sessions on alpha. The Neon MCP tool was not available in this session. TASKS.md T-115 reports 5 rows, 0 minutes and 0 zone on real data. That matches no real user clocking a session yet, though I did not verify it.

- 'N min logged · Zone' line after Clock out (:229 {{ lastRead }}; clockVals :4178): claimed DERIVED -> actually DERIVED — The formula and the writer both exist, so the number is not fabricated. What fails is the word "logged" and the claim that the line is persisted.

WHAT HOLDS
- summariseSession is at proto/Dashboard.dc.html:2938-2956 and does what is cited. It rounds seconds to minutes per block, drops blocks of 0 minutes, and routes Speed to speedMins instead of the floor. The dominant zone is the practice zone with the most minutes, with ties broken in ZONES order.
- Its inputs are measured. c.start comes from Date.now() at Clock in, and c.blocks from the zone-chip handler. stopClock closes the in-progress block before summarising (:4148-4156).
- The writer exists. patch() at :5880 PUTs /api/practice/:day, and server/routes/practice.ts:69-125 upserts into golf.practice_sessions with user_id taken from the caller. It is mounted at server/index.ts:72.
- There is no number fallback: lastRead is null until a session is clocked, and a zero-minute session prints nothing.

WHAT DOES NOT HOLD
1. The line itself is not persisted. lastRead reads s.lastSession (:4199-4205), which is React state only (initialised null at :3410). What gets PUT is the cumulative day total, `next.m = (prev.m||0) + practiceMins` (:4163). A reload loses the line, and the line shows the session minutes while the stored value is the day total.
2. The line says "logged" unconditionally. stopClock calls setState({lastSession}) at :4170, before and independent of the PUT. When the PUT fails (403 not_written, 400 date_in_future, or a 400 from the 1440 cap when prev.m + mins > 1440), patch() rolls state.log back (:5903-5907) and sets logErr. lastSession is not rolled back, so "N min logged · Zone" stays on screen although nothing was saved.
3. The failure is invisible where the clock lives. logErr is rendered only through savedRead at :1015, which sits inside the isCal block (:915-1020). The "Clock out" line is on the Today view (:184, :205, :229), so a failed save shows "N min logged" with no error. That is the false claim the code comments say must never happen: "a golfer must never be told their week was recorded when the request came back 403".
4. I could not confirm the rows exist. The .env connection runs as atlas_app, and `select count(*) from golf.practice_sessions` returned 0 rows. Under RLS with no user context that is ambiguous between no data and hidden rows, and I could not confirm the host is the alpha branch. STATUS.md says the table is live on production with `e2e:practice` 10/10. I did not re-run that.

- Set 1..4 chips and '<n> of 4 sets logged' (:242-251 {{ setSlots }} {{ setsRead }}; renderVals :7066-7075; state seed :3274): claimed DERIVED -> actually FABRICATED — Branch forge-port, file /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html. The citation is accurate as far as it goes. The chips and counter come from `s.sets` (seed `sets: [false,false,false,false]` at :3274), and `setsRead` is `filter(Boolean).length + ' of 4 sets logged'` (:7074). The '4' is a literal. server/ and shared/ contain no persistence for sets or tempo, so the chips and counter are ephemeral. The claim missed the downstream path. `logFromToday` (:7077-7080) computes `mm = 15 + s.sets.filter(Boolean).length * 5` and calls `this.patch(TODAY, {m: mm, b: 'Construction'})`. `patch()` (:5880-5895) PUTs `/api/practice/<day>` with `minutes: e.m, zone: e.b`. `server/routes/practice.ts:107` inserts that into `golf.practice_sessions`. The UI then shows 'Saved · your coach can see this' (:7183), and `protoData.ts:1268` says the coach reads the same table through RLS. So tapping 'Log today' with 0 sets ticked writes 15 minutes. Each set adds 5 minutes. The 15 and 5 are invented constants. The zone 'Construction' is hardcoded and is not read from the player's current step. The result is a plausible stored minutes figure, not a measurement, and the coach sees it as the player's logged practice. It also feeds `hasLog`, `streak`, `pDays` and `totalHrs`: `hasLog` is true once any day has `.m`, and 15 is truthy. Because of that, a log with nothing measured stops showing the honest dash and starts showing a streak and hours. The 4-slot UI, the ' of 4' string and the unsourced 4-set target remain even though the comment at :6767-6770 says the '4 sets x 15' prescription was dropped for lacking a per-step source. I did not query the alpha DB: the Neon run_sql tool was unavailable to me. Row contents for `golf.practice_sessions` are therefore not checked, and the verdict rests on the source path alone.

- Rail: Real handicap value, ± steppers, 'Self-reported' note (:99-104; buildTarget :6296-6305): claimed RAW -> actually FABRICATED — Branch forge-port. The initial value is real. proto/Dashboard.dc.html:3294-3297 seeds state.realHcp from __ATLAS_DATA__.me.hcp. That comes from server/protoData.ts:857, :1104 and :1357, which read myProfile[0]?.handicapIndex, i.e. golf.player_profile.handicap_index. With no value it stays undefined and the rail shows '—' and 'Not recorded' (:6296, :6305). The earlier `?? 11.4` fallback is gone from the rail and steppers. The 11.4 literal remains in a gated Transfer path (see note).

The steppers do not persist. :6303-6304 are `this.setState(st => ... realHcp ± 0.1)` and nothing else. `grep -n handicapIndex proto/Dashboard.dc.html` returns no matches, so the page never sends handicap to the server. The only PATCH /api/users/me calls in the page are saveName (:5813, body {displayName}) and saveTarget (:5845, body {targetHandicap}). Neither writes handicap_index.

The server could accept the write: server/routes/me.ts:118 has a handicapIndex zod field and :175-180 write it. No client calls it with a handicap.

After a tap, the rail keeps the label 'Self-reported'. :6305 depends only on whether realHcp is undefined, not on whether the value was saved. So the edited number carries a label implying a recorded value, and it is lost on reload. The same unsaved value also reaches the Player file header: :5249 `pfHandicapReal: self ? (s.realHcp ?? who.hcp)`, which the code comment calls 'the viewer's own unsaved edit winning', and :6332 reads it for the gap. By contrast the sibling saveTarget does PATCH and shows an error on failure. The handicap stepper has no equivalent.

I did not query the alpha branch. The conclusion rests on the missing writer, not on row contents. I did not run the page in a browser. This is a static read of the source.

- Build header copy ('Check it off when you've earned it … Tick a drill only when you've hit its condition') (:1026-1028): claimed RAW -> actually FABRICATED — The claim classes the header copy as RAW. It is literal copy, so nothing is read from storage, and the action it describes does not exist on this screen.

1. Location. /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html on branch forge-port has the h1 "Check it off when you've earned it." at :1026. The paragraph "Tick a drill only when you've hit its condition — your coach sees the same page you do, and nothing unlocks until it's completed." is at :1027. The citation points where it says.

2. The tick is inert. buildSteps sets `onClick: () => {}` and `cursor: 'default'` (:4488-4489). The old `toggleDrill` (:4359-4370) is documented as dead, with no call sites. The step's `signOff` is also `() => {}` (:4523-4526). Nothing on the Build screen can tick a drill.

3. The "You logged it" legend (:1071) has no Atlas writer.
   - The gold fill `boxBg: on && !pending ? GOLD` is driven by `ticked`. That is built from `drills[id].tickedAt` (:3383), which is `golf.drill_progress.ticked_at`.
   - A grep of the whole repo, excluding node_modules, finds no INSERT or UPDATE of ticked_at or watched_at anywhere in server/, shared/ or client/. Every hit is a reader (protoData.ts:714, 837, 1178, 1341; coach.ts:249) or a comment saying "never write".
   - I ran a read-only query as `atlas_app`, which has `rolbypassrls=false`. Its only privilege on ticked_at and watched_at is SELECT. That matches the 42501 claim in docs/STATUS.md:73.
   - docs/TASKS.md T-119 records Makel's answer on 2026-10-06 that ticked_at and watched_at stay unwritten on purpose, with no producer to be built. Under that decision the gold "You logged it" state is permanently unreachable through Atlas.

4. A player-side write path exists but does not feed this screen. T-97 and `requestReview` (:5687, :6731) let a player flag a filmed drill as ready, but only from the demo modal, and they write `drill_review_requests`. buildSteps ignores that source and reads only `ticked`, so the Build screen and the modal disagree about the same drill.

5. Accuracy of the copy. "nothing unlocks until it's completed" is true: `locked = !prevSigned`. "Tick a drill" is a false instruction. "your coach sees the same page you do" is the sentence an earlier sweep removed from the seed comment at :3340-3343 because the two screens disagreed.

6. Incidental fabrication on the same screen. A static literal "Assigned by Dr. Benoit from your movement screen" sits in the pivot-variant block at about :1117, inside the Build template. It is an invented name for every player who sees the variants. The note at ~:4506 says "Dr. Benoit removed 2026-09-21", but only the isSigned label was fixed.

Limit: I could not query the alpha branch. The only connection string in .env is for main (ep-winter-math), and the Neon MCP was not callable. On main, `atlas_app` sees 0 rows in golf.drill_progress. That is ambiguous (RLS or no data), so the verdict rests on the missing writer and the grant, not on row counts.

- Five-step ladder (step names, Completed/Locked/Not started) and step card state/lock (:1039-1049 {{ stepLadder }}, {{ steps }}; renderVals :7192-7203, buildSteps :4410-4530): claimed DERIVED -> actually FABRICATED — SPLIT FINDING. The signed/Completed/Locked half holds. The "Not started" / "n / m" / "In progress" / "Ready" half does not, because it is driven by a column nothing writes.

HOLDS (DERIVED, with a running writer):
- proto/Dashboard.dc.html:3363-3384 builds `signed` from me.drills['plan:step-N'].signedOffAt, with a `|| verifiedAt` compatibility fallback. `locked` is `!prevSigned` in buildSteps (:4414-4418) and stepLadder (:7197).
- The writer is server/routes/coach.ts:~342-405. After the drill verify, it counts verified siblings via `drillIdsInStep` and upserts `plan:step-N` `signed_off_at`, in both directions, in the same transaction. It refuses a manual step write with 409 `step_is_automatic` (review.ts:92).
- server/protoData.ts:708 and :834 carry signedOffAt into me.drills.
- docs/TASKS.md T-94 and e2eStepRollup record a 6/6 run of the live route (verified, then signed, then un-signed, then restored). I did not re-run it.

FAILS (FABRICATED in effect):
- buildSteps :4414-4416 computes `done` only from `ticked`.
- `ticked` is `refs(d => d.tickedAt)` at :3363-3385, which reads golf.drill_progress.ticked_at.
- Nothing writes ticked_at. I grepped server/, shared/, scripts/ and client/: there are readers only (protoData.ts:714, :837, :1178 and others) and no INSERT or UPDATE.
- atlas_app has no grant on the column (shared/drills.ts:34, rls_core.sql:1429).
- rls_forge.sql:1907 says the forge_app grant is "NOT ISSUED" and "nothing in the Forge build writes a tick against an Atlas drill". The forge_app role also did not exist when that was written.
- Result: `done` is always 0, so these unsigned, unlocked states are never reached:
  - 'In progress' (:4430)
  - 'Ready to complete' (`all` needs done === drills.length)
  - stepLadder's `done + ' / ' + n`
  - 'N drills to go' and 'Ready — waiting on your coach' in signLabel
- Every step that is unsigned and unlocked prints state 'Not started', count '0 / N', pct '0%', and signLabel 'N drills to go' or similar. This is a constant, not a computation.
- If a coach has verified 2 of 4 drills but the step is not yet signed, those drill rows print std 'Verified' (they read `ver`) while the step header says 'Not started 0 / 4'. That contradicts the page itself.
- Roll-up keys off verified_at, but the state label ignores verified_at, so the two disagree.
- buildPct and buildRead (:7211-7212) use `s.ticked.length`, so the headline is "0 of 23 drills completed" regardless of coach verifications.
- 'Not started' here is not an honest empty state, because it asserts something false once any verification exists.

Fallback check: no numeric `?? n` substitution. The failure is a missing producer, not a substituted number.

Populated check: not settled. The DATABASE_URL_UNPOOLED in .env connects as atlas_app and returns 0 rows from golf.drill_progress. That is RLS-ambiguous, and I could not confirm it is the alpha branch. Neon MCP tools were not available to me.

- Drill row: gold ✓ 'Completed' and '·' 'Awaiting review' (buildSteps :4476-4510): claimed RAW -> actually PLACEHOLDER — The column exists, but nothing writes it, so RAW with a producer does not hold. The path is dead and not fabricated.

1. Column exists. Dashboard.dc.html:3383 sets `ticked: refs(d => d && d.tickedAt)`. server/protoData.ts:714 and :837 read `golfDrillProgress.tickedAt`. eco `src/schema/golf.ts:356` declares `ticked_at`, and `pg_attribute` on the live DB lists it. The row logic at proto :4476-4510 is `std: vd ? 'Verified' : pending ? 'Awaiting review' : on ? 'Completed' : d.std`, and `on` is true only if the key is in `ticked`.

2. No writer. I grepped atlas (excluding node_modules, .git and docs) and eco for `ticked_at` and `tickedAt`.
- Every hit is a read, a comment, schema, or a migration snapshot.
- The only inserts into `golf.drill_progress` are in server/routes/coach.ts at :342 and :401. They name the columns `verified_at`, `verified_by_user_id`, `video_ref`, `verify_note`, `signed_off_at` and `updated_at`. Neither names `ticked_at`.
- The client side is disarmed. `onClick: () => {}`, `toggleDrill` is documented as dead, and `signOff` is inert.
- eco `sql/rls_forge.sql` §6 says the `forge_app` grant is "NOT ISSUED HERE" because "nothing in the Forge build writes a tick against an Atlas drill".

3. Grants, queried as `atlas_app` with `pg_catalog`. This connection is the `main` database: `forge` schema count is 0 and no `forge_app` role exists.
- `has_column_privilege(...,'ticked_at','INSERT')` and `'UPDATE'` are both false for `atlas_app`, `red_app`, `lr_app` and `billing_svc`.
- `relacl` is `{neondb_owner=arwdDxtm/neondb_owner, atlas_app=r/neondb_owner}`.
- `attacl` is NULL for `ticked_at` and `watched_at`.
- Only the table owner could write the column, and no code connects as the owner to do so.

4. Populated? Unproven.
- As `atlas_app` with no RLS context, `count(ticked_at)` returned 0.
- `pg_stat_user_tables` shows `n_live_tup` of 30 on `golf.drill_progress`. So 0 is RLS-hidden, not "no data".
- I could not read the real `ticked_at` count. The Neon MCP tool was unavailable to me, so I did not query `alpha` (`orange-mountain-36415593`).

5. Fallback. None substitutes a number. With no ticked rows the label falls through to `d.std`, the standard text, and the tick box and colours stay empty. That is an honest empty state.

Verdict on the claim: the cited producer has no writer, so this is not RAW. The 'Completed' and 'Awaiting review' labels cannot appear unless a future forge_app grant and writer ship. Nothing fabricated is shown in the meantime.

- Drill names, standards, '· Parallax' tags, 'why this drill' text, step bodies and conditions (:1124-1165; STEPS :2994-3068; whyFor :3155; shared/drills.ts): claimed RAW -> actually FABRICATED — Checked on branch forge-port. HOLDS: the plan content is consistent between the page and the server. I eval'd STEPS from proto/Dashboard.dc.html and compared it with REVIEW_ITEMS from shared/drills.ts. Output was "steps drills 23 plan items 23 step 5 total ids 35" and "NO MISMATCH". Every plan:<n>-<ref> id exists, with no orphans. For steps 2-5, name equals name, std equals detail, cam equals review, and the WHY literal equals the shared why. server/protoData.ts:1134 and :1455 inject reviewItems: REVIEW_ITEMS. server/routes/review.ts:84 and server/routes/coach.ts:310 gate on isReviewItemId, so the id link is real and runs. REFUTES: (1) The Step 1 block is a per-user claim with no producer. proto/Dashboard.dc.html:3314 hardcodes `pivot: 'cannon'`, and nothing stores a player's route (shared/drills.ts says so, and so does docs/TASKS.md T-43). So every player is shown the Cannon names ("Kickstand Explode", "Trail heel down") by default. Line 1099 labels the chips "Your pivot". Line 1107 is static markup inside the always-true sc-if hasVariants and says "Assigned by Dr. Benoit from your movement screen". That is an invented assignment attributed to a named coach, over a default selection. It sits on the same Build screen and the same Step 1 drills as the claim. smoke.ts:156-160 bans "Verified by Dr. Benoit" and "Completed · Dr. Benoit" but not this string. (2) The d.std cell is not a static standard. At :4478 it is `vd ? 'Verified' : pending ? 'Awaiting review' : on ? 'Completed' : d.std`. Three of four branches derive from golf.drill_progress verified_at and ticked_at. Atlas has no writer for ticked_at (shared/drills.ts documents it; I found no write in server/). (3) The class is wrong. RAW means a measured value read from storage, and static literals are neither. (4) Smaller errors in the evidence: the "33 plan: entries" count is wrong, because shared/drills.ts has 28 'plan:' ids (23 drills plus 5 step rows) and 35 ids in total. whyFor is at :3137, not :3155.

- Step footer: 'N drills to go' / 'Ready — waiting on your coach' / 'Completed' / 'Locked until Step n' (:1168-1170 {{ s.signLabel }}; buildSteps :4521): claimed DERIVED -> actually FABRICATED — 1) Citation is accurate. Dashboard.dc.html:4511 is `signLabel: isSigned ? 'Completed' : locked ? 'Locked until Step n' : all ? 'Ready - waiting on your coach' : done < drills.length ? (drills.length - done) + ' drills to go' : camPending + ' awaiting Parallax review'`. At :4425 `done = drills.filter(d => ticked.indexOf(st.n+'-'+d.ref) > -1).length`. Only `ticked` feeds the count; `ver` (verified) is used only for camPending. 2) ticked has no writer. The seed at :3383 is `ticked: refs(d => d && d.tickedAt)`, which reads golf.drill_progress.ticked_at through server/protoData.ts:714 and :1178 (SELECT only). The only two INSERTs into golf.drill_progress are in server/routes/coach.ts:342 (columns user_id, drill_id, verified_at, verified_by_user_id, video_ref, verify_note, updated_at) and :401 (signed_off_at, verified_by_user_id). Neither sets ticked_at. grep for `insert(golfDrillProgress|update(golfDrillProgress|tickedAt: (new|true|now|sql)` across server, shared and scripts returns only those two raw SQL inserts. The client onClick is a no-op (:4483). The page comments (:4357-4363, :4480) say atlas_app has no write grant on the column (42501). eco rls_forge.sql:1907-1925 says the forge_app grant was deliberately NOT issued, and no forge_app role exists. 3) Population: I connected as atlas_app (read-only transaction) to the DATABASE_URL in .env. That is probably main, since there is no forge schema, so it is NOT the alpha branch. RLS hid every row (0 total), which is ambiguous. pg_stat_user_tables shows 30 live rows in golf.drill_progress, so data exists. I could not read the ticked_at distribution. docs/TASKS.md T-64 and CODE-REVIEW-2026-09-20 record that the few rows with ticked_at were hand-written by neondb_owner in September. 4) Input is not produced. The coach verify route writes verified_at, not ticked_at. So for any real player whose coach has verified drills, ticked is empty and done = 0. In an unsigned, unlocked step with a coach-verified drill, the footer reads '(N - 0) drills to go' for ALL N drills. The same row renders std 'Verified' in green (:4476, vd from verifiedAt) and the step's own pill. A partly-verified step therefore prints "5 drills to go" beside drills marked Verified. State is also wrong ('Not started', count '0 / N', pct 0%). The all-verified case is rescued only because the server rolls signed_off_at up into 'Completed'. 5) The fallback is the bad case. When done < length, it substitutes a plausible count for "cannot know", because the player-claim column nobody writes is read as if its emptiness meant "not done". The 'Completed' and 'Locked until Step n' branches do trace to real signed_off_at/verified_at, so they stand. The 'N drills to go' and 'Ready - waiting on your coach' branches depend on ticked and do not. The 'Ready' branch can only fire if every drill is ticked, which nothing can do.

- Impact opposites: 'Centred 0 / 1', row ticks, 'Centred' standard (:1186-1215 {{ ioCount }} {{ ioDrills }}; :7230; buildImpactOpp :4388-4420; seed :3314 impactOpp: []): claimed DERIVED -> actually FABRICATED — Read on branch forge-port, /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html. (1) The cited lines exist and match: seed `impactOpp: []` at :3314; buildImpactOpp :4388-4420 sets `std: on ? 'Centred' : d.std`; ioCount at :7230 is `(this.state.impactOpp||[]).length + ' / 1'`. (2) Nothing writes it. `grep -rIl impactOpp` over the repo (excluding node_modules, .git and .next) returns only proto/Dashboard.dc.html, three docs, and one json inventory. There is no server, route, schema or smoke-test reference. The only writers are two `setState` toggles, at :4401 and :6685. No fetch, no localStorage, no column. The sibling mechanism does persist: main-ladder ticks are seeded from golf.drill_progress (`ticked: refs(d => d && d.tickedAt)` at :3383), and the coach's tickDrill POSTs to /api/coach/students/.../verify. impactOpp is the one tick set with no storage behind it. The `IO1` ref is not in any ts, tsx or sql file, so it cannot be a drill_progress row. (3) I did not query alpha. There is no table or column to query, and the repo-wide grep finds no writer. (4) The input is a player's own click, with no formula over produced inputs, so it is not DERIVED. The denominator `' / 1'` is a hardcoded literal (:7230). It is not computed from `IMPACT_OPP.filter(d => !d.ball).length`. If a second non-ball drill is added, the count would be wrong with no error. (5) The seed is honest: it starts at 0 / 1 and renders nothing as done. There is no number-substituting fallback. Both the seed and the fallback pass.

- Demo modal status, tick label, 'Why this drill' (:1217-1230; demoVals :6673-6770): claimed DERIVED -> actually DERIVED — The status and tick label in the main (non-impact-opposite) branch of demoVals are DERIVED where they can be reached. The claim fails because its producer list leaves out the impact-opposite branch, and two label branches have no producer at all.

WHAT HOLDS
- Verified: `coach.ts` writes `verified_at` (server/routes/coach.ts:338-355). protoData.ts:837 and :1341 read it into `drills[id].verifiedAt`. The page maps it to `state.verified` at Dashboard.dc.html:3383.
- "Awaiting Parallax review" and "Sent — waiting on your coach": `review.ts` has a real writer. POST /api/drills/:id/review-request upserts `golf.drill_review_requests.requested_at`. The router is mounted at server/index.ts:71. protoData.ts:726-731 reads the table and `resolveSubmitted` returns it as `ATLAS_ME.submitted`. Every filmed drill's page key matches a server id, for example `plan:1-3`, `plan:2-P1` and `plan:5-R5`, so the id mapping holds.
- "Locked — step completed" comes from `signed_off_at`, which coach.ts:402 writes.
- "Why this drill" is static. `whyFor` reads the literal maps `WHY_BY_ID` and `WHY` (Dashboard.dc.html:3137-3162). That is authored copy, not a metric. Each `why` is the same text for every golfer.

WHAT FAILS
1. Nothing writes `ticked_at`. I grepped server/, scripts/, shared/ and the proto page. Atlas only reads it (protoData.ts:714, 837, 1178, 1341 and coach.ts:249). The eco grant to `forge_app` appears only in a commented-out block (eco rls_forge.sql:1917-1918). So `state.ticked` (Dashboard.dc.html:3383) is always empty. That makes "Logged by you" (:6736) and "You marked this done" (:6745) dead branches, which matches the filer's concern.
   - Every non-filmed drill is stuck at "Not started" / "Not yet marked done" whatever the player did. Those drills have no control and nothing could ever change the label.
   - The producer string in the claim lists `ticked`. That is a column with no writer.
   - `resolveSubmitted` also falls back to `args.drills[id]?.tickedAt` (protoData.ts:534). That fallback is always null in practice.
2. The impact-opposite (`IO`) branch of demoVals (:6677-6696) is in the cited range but not covered by the producer line.
   - "Centred" and "Not started" come from `state.impactOpp`, which starts as `[]` at :3314.
   - "Mark centred" at :6685 only toggles React state. There is no fetch and no persistence. It resets on reload.
   - The value feeds the visible `ioCount` ("N / 1") at :7230.
   - No measurement or table backs it. It is a self-attested, unpersisted status shown as progress. I would classify that sub-branch as FABRICATED (client-only, no producer).
3. The "Upload rep to Parallax" pill (:1208) is shown when `d.cam && !vd`. It has no onClick handler, so it advertises an action that does nothing. It is not a value, but it is a dead control in this modal.
4. The label "Awaiting Parallax review" names Parallax, but the request goes to the coach's queue. This is a mild mislabel.

DB check, alpha branch
- I could not query alpha. The only connection string available (`.env`) is an `atlas_app` connection to `neondb`, and I could not tell which branch it points at.
- As `atlas_app` with `bypass=false` and RLS on, `drill_progress` and `drill_review_requests` both count 0, with `ticked_at`, `verified_at` and `requested_at` all 0.
- That 0 is ambiguous. RLS with no user context hides rows, so it proves nothing. The no-writer grep for `ticked_at` is the real evidence.

- Roster meta line 'tier · Zone N' (Dashboard:~5516 (meta), markup :~873): claimed RAW -> actually DERIVED — The producer exists and runs. The label is wrong, and that is the defect.

1. Column and writer exist. server/protoData.ts:1210-1216 selects `interview` from atlas.student_intake. Lines 1388-1389 set `tier: String(intakeBy.get(person.id)?.tier ?? '')` and `zone: String(intakeBy.get(person.id)?.phase ?? '')`. The writer is PATCH /api/intake/:id with `kind:'interview'` (server/routes/intake.ts:443, merged at :526-527). The client control is the tier/phase <select> in client/src/quiz/InterviewStage.tsx:69. There is no `?? 5`-style fallback: an absent answer gives '' and the meta line drops that half.

2. The label is the defect. proto/Dashboard.dc.html:5518 is `meta: [p.tier, p.zone ? 'Zone ' + p.zone : ''].filter(Boolean).join(' · ')`. It prints the interview PHASE (1-4) as "Zone N". The same file's player-file code at :5232-5238 says `who.zone` carries the PHASE, that "zone" means the four practice zones (01 Construction, 02 Calibration, 03 Transfer, 04 Performance), and that phase 1 is zone 02 and phase 2 is zone 01. That code was fixed to print 'Phase ' + who.zone. The roster at :5518 was not. A coach reading "Zone 3" on the roster gets Transfer, which is a gated area, when the real value is phase 3. :5514 (`zone: 'Zone ' + p.zone`) repeats the mislabel and also prints a bare 'Zone ' when the value is empty.

3. Stale comments are confirmed. server/protoData.ts:66-68 says tier and zone are "still shipped empty (:1017-1018)" on the roster. The `tier` doc at ~:80 says "Still '' on the ROSTER path". The `zone` doc at ~:91 says "Same roster caveat as tier". Dashboard markup ~:872-873 says "tier, zone and practice days have no producer". All of these contradict :1388-1389, which has populated them since 2026-09-21 per the comment there.

I did not query the alpha branch, so I can't say whether any row has a non-empty tier or phase.

- Roster 'Last logged' ('Today' / 'Nd ago' / 'never logged') (Dashboard:5538; protoData.ts:~1255-1285): claimed DERIVED -> actually DERIVED — The formula and the writer both exist. The claim still fails on completeness and input honesty, and I could not confirm alpha has data.

EXISTS AND WRITTEN
- server/protoData.ts:1265-1295 builds lastPractisedBy as the minimum of (UTC today minus session_date). It skips minutes null or <=0 and skips negative (future) days. Line 1401 sets `days: lastPractisedBy.get(person.id) ?? null`.
- proto/Dashboard.dc.html:5537 renders null as 'never logged', not a number. No number fallback exists, so the `?? 5` class is absent.
- The writer is server/routes/practice.ts:107, an insert ... on conflict do update into golf.practice_sessions. It sets source 'atlas', rejects future dates, and returns 403 on zero rows.
- The client calls it from proto/Dashboard.dc.html:5888 (`patch()` does fetch PUT /api/practice/<iso>).

WHERE THE CLAIM FAILS
1. Forge's sessions are ignored. golf.range_sessions is written on this branch (server/routes/forge.ts:407, with completed_at set at :672). protoData.ts has zero references to range_sessions.
   - docs/FORGE-ON-RYP-CORE.md:142 and docs/TASKS.md T-111 both say the roster must read greatest(max(practice_sessions.session_date), max(range_sessions.played_on)). That is not done.
   - A player who practises only in Forge reads 'never logged'. A player with an older calendar row plus fresh Forge sessions reads 'Nd ago' in orange. The silence flag (days>7, Dashboard:5471) and the 'Who to call' sort fire falsely on people who are practising.
   - The label says 'Last logged' but the flag implies 'has gone quiet'. On this branch that implication is false.
2. The minutes input includes invented values, so 'minutes > 0' does not mean the player entered minutes.
   - Dashboard:7078-7079 (logFromToday) writes `mm = 15 + sets*5`, so 'Log today' with 0 sets writes 15 minutes. It also clobbers the clock's m and b via Object.assign (T-115, still live and unfixed).
   - Dashboard:5916 (setBlock) writes `m: e.m || 15`, so tapping a zone chip alone writes 15 minutes.
   - Either click turns a day into 'practised today' on the coach roster, with a minute count the player never entered.
3. Population. I connected read-only as atlas_app and queried golf.practice_sessions, which returned 0 rows with no user context. The same query showed golf.range_sessions does not exist on that database, so it is not alpha. Zero rows there is ambiguous between RLS hiding rows and no data. docs/TASKS.md T-115 records 5 rows, 0 minutes, 1 user, all e2e leftovers. So 'Today' and 'Nd ago' may never have rendered from real data.
4. Doc text at Dashboard:5496 is stale. It says 'nothing records practice yet, so this order is not yet meaningful', which contradicts the claimed producer.

CAVEATS
- The Neon MCP run_sql tool was unavailable, so the alpha branch (orange-mountain-36415593) was never queried.
- The writer works only when the player uses the Atlas Calendar.

- Roster 'Call' chip and last-logged colour (>7d red, >3d amber) (Dashboard:5481 `flag: p.days > 7`; :5539-5540): claimed DERIVED -> actually DERIVED — REFUTED on the claim as written. The mechanism exists and runs, but the input is incomplete, so the "Call" chip and last-logged colour can assert silence that did not happen.

Thresholds (the claim's 7 and 3), confirmed:
- /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html:5471 has `flag: p.days > 7`.
- Lines 5538-5539 have `lastColor: p.days > 7 ? red : p.days > 3 ? amber : grey`. The claim cited :5481 and :5539-40, so its line numbers are off by about 10.
- The 7 and 3 are literal policy and nothing sources them.

Producer exists and has a writer:
- /Users/makelmackbee/dev/ATR/atlas/server/protoData.ts:1270-1294 builds `lastPractisedBy` from `golf.practice_sessions` (user_id, session_date, minutes).
- Line 1401 sets `days: lastPractisedBy.get(person.id) ?? null`.
- Rows with minutes <= 0 are skipped. Future dates are skipped.
- The writer is `PUT /api/practice/:day` in server/routes/practice.ts. It is mounted at server/index.ts:72 and does an upsert into golf.practice_sessions.
- The client calls it at proto/Dashboard.dc.html:5888.
- The column exists in eco's schema (/Users/makelmackbee/dev/ATR/eco/src/schema/golf.ts:482). The vendored eco is 0.29.0.

Incomplete input:
- eco's own comment at golf.ts:519-535 says this table is "NO LONGER THE WHOLE PRODUCER" (2026-10-06). It says the roster read "must become greatest(max(practice_sessions.session_date), max(range_sessions.played_on)) or it reports a player who trained four times this week as silent".
- docs/FORGE-ON-RYP-CORE.md:142 and :436 say the same.
- The Forge router writes `golf.range_sessions` (server/routes/forge.ts:407) and is mounted at server/index.ts:81 when configured.
- `grep range_sessions server/protoData.ts` returns nothing, so the roster never reads them. A golfer who trains only through Forge shows "never logged", or N days ago, with a red Call chip or amber colour. That is a false positive on whom a coach calls.

Null handling, a second gap:
- A never-logged student has `days: null`, so `p.days > 7` is false and no Call chip shows.
- Once any one student has a number, `rosterFlagged` (Dashboard:5551) counts only flagged rows.
- The student who has never logged anything, who is the most silent, is therefore not flagged and not counted in "N need a call". The label does print "never logged", so this is not a fabricated number. It is an unflagged absence.

No substituted number: there is no `?? 5`-style fallback. Null renders as the text "never logged".

Populated on alpha: I could not confirm this. The only connection I had was the repo .env, which is not the alpha branch. It connected as atlas_app and returned 0 rows from golf.practice_sessions with no user context set, which is ambiguous (RLS or no data). golf.range_sessions does not exist on that branch.

## Concerns on values that DO have producers

- [RAW] Today headline and sub-copy ('One thing today.' / 'Fifteen minutes. You don't choose what to practice — the build does.') (:187-188): Low. A player on a different prescription is still told 'fifteen minutes'.
- [DERIVED] Session clock (mm:ss) and 'In <zone>' (:196-204 {{ clockRead }} {{ clockZoneLabel }}; clockVals :4082-4126): A running session is lost on reload.
- [DERIVED] Today step card: 'Step N · Title', title, body, 'What counts as done', 'From your plan' (:235-257; todayStepVals :6778-6791): Low. Copy is static curriculum text, not user data.
- [DERIVED] Set 1..4 chips and '<n> of 4 sets logged' (:242-251 {{ setSlots }} {{ setsRead }}; renderVals :7066-7075; state seed :3274): The player's own tick, ephemeral. The '4' is an unsourced prescription and resets on reload. It is not a plausible fabricated measurement, but it states a target nobody set.
- [GATED] Tomorrow · built for you card (headline, leak SG, 3 blocks, Accept, Second choice) (:258-300 {{ tomorrowShow }}; autoVals :4534-4625): The gate is CSS display:none, not sc-if, so the leak text and blocks are still in the DOM (view-source or DOM inspection shows them). autoVals still uses `targetHcp === undefined ? 5` at :4535. Flip the gate and every golfer gets an identical 'leak' again.
- [DERIVED] 'Last seven days' headline and 7-day strip (:322-345; renderVals :7089-7092, :6926-6941): Latent undercount on the 1st-6th of a month (today is Oct 16 so it is not live). Also the stale comment at :6826 says 'Nothing writes `log`', which is false now.
- [PLACEHOLDER] Rail: Total SG, Practice, Transfer gap (+ gap label), mobile-bar SG (:22, :92, :108-110; :6244, :6283, :6337-6339): Caption 'Your composite index. Earned, not entered.' stays under the dash. Honest, but it reads as a promise.
- [RAW] Rail: Real handicap value, ± steppers, 'Self-reported' note (:99-104; buildTarget :6296-6305): After a tap the rail shows a value labelled 'Self-reported' that was never saved, and it reverts on reload. The stored value is real, but the edited one is not.
- [PLACEHOLDER] Rail: The guarantee text and bar (:119-123; :6314-6315): 'Not started' is a status assertion beside a 0% bar, not a dash. Minor.
- [DERIVED] Rail badge: Calendar `weekRead` (:78 area; renderVals :7064): Low.
- [DERIVED] Rail badge: Fitness `liftCompliance` (rail nav; fitnessVals :4023): Appears only after the player ticks a lift in-session. Not persisted.
- [GATED] Rail badges: Plan `tierName`, zone badges Build/Cal/Transfer/Perf (:6xxx renderVals tierName '' and zoneBuild/zoneCal/zoneTransfer/zonePerf ''): tierName is blank only because nobody decided to show it; a real producer exists (me.tier from the intake interview).
- [RAW] Build header copy ('Check it off when you've earned it … Tick a drill only when you've hit its condition') (:1026-1028): The copy tells the player to tick drills, but no drill can be ticked from this screen. The legend swatch 'You logged it' (:1071) can never appear.
- [DERIVED] Five-step ladder (step names, Completed/Locked/Not started) and step card state/lock (:1039-1049 {{ stepLadder }}, {{ steps }}; renderVals :7192-7203, buildSteps :4410-4530): Step state 'Not started' and the per-step counts depend on ticked (see the completion-counts row), so a step with coach-verified drills reads 'Not started'.
- [RAW] Drill row: gold ✓ 'Completed' and '·' 'Awaiting review' (buildSteps :4476-4510): A dead path. It is never shown as fabricated data, but never reachable either. See the completion-counts row.
- [RAW] Drill names, standards, '· Parallax' tags, 'why this drill' text, step bodies and conditions (:1124-1165; STEPS :2994-3068; whyFor :3155; shared/drills.ts): Content, not per-user metrics. Not a defect.
- [DERIVED] Step footer: 'N drills to go' / 'Ready — waiting on your coach' / 'Completed' / 'Locked until Step n' (:1168-1170 {{ s.signLabel }}; buildSteps :4521): Wrong while verified drills exist and ticked is empty.
- [DERIVED] Impact opposites: 'Centred 0 / 1', row ticks, 'Centred' standard (:1186-1215 {{ ioCount }} {{ ioDrills }}; :7230; buildImpactOpp :4388-4420; seed :3314 impactOpp: []): A player's own self-claim ('Centred'), unverified, not visible to a coach and lost on reload. Starts honestly at 0 / 1.
- [DERIVED] Demo modal status, tick label, 'Why this drill' (:1217-1230; demoVals :6673-6770): 'Logged by you' is unreachable (ticked has no writer).
- [PLACEHOLDER] 'Upload rep to Parallax ↗' button (:1244 {{ demoParallaxShow }}): A dead control styled as live, not visibly disabled. It is not a value, so it is not counted as fabricated.
- [DERIVED] Avatar initials (Dashboard:5511; pfInitials): An email-as-name gives one initial. Cosmetic.
- [RAW] Roster meta line 'tier · Zone N' (Dashboard:~5516 (meta), markup :~873): The roster labels a curriculum phase as 'Zone N'. A coach reads 'Zone 3' as Transfer when it is phase 3. The player file was fixed to say 'Phase N'; the roster was not. Stale comments in protoData.ts and the markup still say tier and zone ship empty on the roster, which is false.
- [RAW] Roster 'Hcp' column (Dashboard:5521; markup :~886): Self-reported, not GHIN-verified. A coach reads it as a fact about the player.
- [PLACEHOLDER] Roster 'Total SG' column (Dashboard:5525 `sg`; markup :~889): The dash is honest. The dash is coloured orange, the negative colour, because `undefined >= 0` is false. Forge-port now writes practice_index but the coach roster never reads it, so even a golfer with scored sessions shows a dash.
- [PLACEHOLDER] Roster 'Five reads' sparkline and delta (+x.x, 'no reads yet') (Dashboard:5528-5535): The column header 'Five reads' stays visible above empty space, with no dash.
- [PLACEHOLDER] Roster 'Leak' column (Dashboard:5536 `leak: p.leak`; markup :~904): The header 'Leak' sits over blank space. It reads as 'no leak', not 'not measured'. Should show a dash.
- [DERIVED] Roster 'Last logged' ('Today' / 'Nd ago' / 'never logged') (Dashboard:5538; protoData.ts:~1255-1285): Self-logged minutes, not measured practice. Rows are only written from the Atlas calendar.
- [DERIVED] Roster 'Call' chip and last-logged colour (>7d red, >3d amber) (Dashboard:5481 `flag: p.days > 7`; :5539-5540): The 7 and 3 are unsourced product policy, not a tuned measure. Low risk, but they decide whom a coach calls.
- [DERIVED] Roster 'N waiting on you' chip (Dashboard:5470-5472; protoData.ts resolveSubmitted ~505-560): The ticked_at input has no writer in this repo. It is dead until the Forge app ships. The live producers are the review-request route and the intake.
- [DERIVED] Roster header 'N active' (Dashboard:5554; markup :848): 'active' is not computed from anything. A coach with three students, two of whom never approved or never logged, sees '3 active'. The literal word is the claim.
- [DERIVED] Rail badge 'N need a call' / 'no practice log' (Dashboard:5551-5553; markup :117): If any one student has logged, the badge reads e.g. '0 need a call' even when every other student has never logged. Never-logged students are excluded from the count.
- [PLACEHOLDER] Sort chips and blurb: waiting, silence, movement (Dashboard:5492-5499): The movement sort comparator `a.delta - b.delta` is NaN for every row, so it is a no-op, and its blurb says so. Honest.
- [RAW] Player file header: Real handicap, Target (Dashboard:5249 pfHandicapReal; :5254 pfHandicapTarget; markup :460-464): The label 'Real' is a self-reported value, not verified. Positive targets print `String(t)` ('4') while the real handicap prints toFixed(1) ('4.0'); formatting only.
- [RAW] Player file 'Build': handedness and driver carry (Dashboard:5262-5263; markup :468-469): Carry has one writer, the profile form. For anyone who never opened it, it is blank, which is honest.
- [PLACEHOLDER] Handicap history bars (six buckets, 'NA') (Dashboard:5265-5290; markup :~499-511): The legend under the bars reads 'NA where they were not playing', which asserts a reason the data cannot support. NA here means 'not recorded'.
- [RAW] Drill card: video ref line and verify note (Dashboard:4798-4799; markup :558, :618, :1684): These display fields have no producer in the product. The route's `verify_note = ${note ?? null}` means a toggle from this page nulls any stored note while the optimistic UI keeps showing it.
- [RAW] Player's own 'ticked' claim and 'watched' flag (protoData.ts RosterRow.drills tickedAt/watchedAt; Dashboard:3345 `ticked: refs(d => d.tickedAt)`): Both columns have no producer in this repo. `ticked` is [] for everyone and the watched dot reads nothing. Nothing is shown as a number, so no user is misled today.
- [DERIVED] Practice DNA panel: archetype, zones, growth zone, time split, efficiency, Mechanics Index vs handicap (Dashboard:~4985-5005 dnaZones; protoData.ts dna via server/dnaSummary.ts): A modelled score from self-report, labelled 'Provisional' when thin. Constants such as the MI shift ((mechanics-50)/50)*8 and the recommended allocation are eco's; I did not trace their sources.
- [GATED] Today 'Tomorrow' card (T-103/T-106) (Dashboard:268-300 (markup), :4534-4624 (autoVals)): Player surface, not coach. Note `t = s.targetHcp === undefined ? 5` still sits at :4535 behind the gate. Smoke section S could not be run here (DB needed).
- [GATED] Coach rail: 'Every number vs' handicap, Total SG, target slider and practice/real/transfer blocks (Dashboard:62-76, :126-175, :36-44; :6281-6288): B-10 held for the coach. The ± steppers for a player still mutate local state only.

## Lane verdicts

- Player Today and Build screens (proto/Dashboard.dc.html, branch forge-port) plus the rail and mobile header that wrap them: 9 fabricated — Nine FABRICATED findings remain on Today, Build and the rail. The T-106 class is closed here, but the Build screen still prints several things no code produces. The worst two are 'Assigned by Dr. Benoit from your movement screen' with a hardcoded 'cannon' pivot, and the Build completion counts, which read a column nobody writes. I confirmed the earlier fixes held (T-103/T-106 and the nulling of the Tomorrow card and rail SG/practice/gap). Limits: no Neon MCP tool was available in this session, and the only credential in .env is atlas_app on an unidentified branch. So I did not query alpha, and 'no writer' below means no writer found in code, not an empty table. I did not run scripts/smoke.ts, which needs DATABASE_URL and could write to an unidentified branch. Fix held: 'tomorrowShow' is 'none' at :4623, and the template at :268 binds display to it. The remaining state.forge readers are forgeVals :3619, autoVals :4535, buildTrend :6353 and buildCoachCard :6461. They feed only the Transfer, Performance and gated Tomorrow sections; server/protoData.ts puts 'transfer' and 'perf' in HIDDEN_FOR_PLAYER and in HIDDEN_FOR_COACH via PLAYER_ONLY. Five '?? number' fallbacks (`targetHcp === undefined ? 5` at :3620, :3666, :4535, :6361, :6462, plus `realHcp ... 11.4` at :3755) are still live code behind those gates. The comment at :3281 saying the seed 'fixes all six at once' is untrue. The gated Tomorrow card is display:none, not sc-if, so its text is still in the DOM.
- Coach surface: roster and player file in proto/Dashboard.dc.html, plus the data server/protoData.ts injects for them (branch forge-port, eco 0.29.0): 3 fabricated — The spec section 6.4 claim is no longer true. `ROSTER` is stripped to `window.__ATLAS_DATA__.roster || []` (Dashboard:3058), and there is no `'hale'` or any seeded id left (grep returns only a comment). Every roster number is either read from ryp-core, derived, or an honest dash. A real player no longer renders as zeros; the columns with no producer render as dashes or empty.

I found three FABRICATED items. All three are hardcoded claims in prose, not plausible numbers:
1. The "Furthest behind" sort blurb.
2. The "No handicap on record." sentence.
3. The "intake form is not yet wired to a table" sentence.

There are also four misleading labels on real data: "Zone N" for a phase, "N active" counting pending students, "Real" for a self-reported handicap, and a "0 need a call" count that ignores never-logged students.

Roster "Total SG", "Five reads" and "Leak" are still empty for everyone, because `protoData.ts` never reads the Forge scoring tables, even though `server/routes/forge.ts` writes `practice_index`.

I could not query the alpha Neon branch. The Neon MCP tools are not in my toolset, and `.env` DATABASE_URL is the `atlas_app` role on an unknown branch, so RLS would hide rows anyway. Every producer claim below is from reading source. Whether a column is actually populated is unverified.

I could not run `scripts/smoke.ts`: it needs a live DB. The T-106 gate was verified by reading the markup instead.

Of the already-fixed items, T-103/T-106 and B-10 held:
- `tomorrowShow` is the literal `'none'` (4623), and every `autoVals` binding is inside that gated div.
- The coach rail metrics are behind `showRailMetrics`, which is false for a coach (7004), including the mobile header copy (:41).
- `railSG` is the literal `'—'` (6283).

I did not check T-125 or its propagation into `drivingIndex`.

`targetHcp ?? 5` survives at 4535 and 3619, but only inside gated or hidden code.

The `+21.0` sign inversion is still live, now at line 2840.

Not rendered on the roster at all, so there is nothing to classify: assigned/done counts, and any "levels" column apart from the tier and phase text.

Not queried: `golf.handicap_history`. Its writers do exist (`intake.ts` complete, `scripts/seed.ts`), so Hist is a placeholder by decision, not by lack of data.

**Stale comments.** Comments in `protoData.ts` (about lines 62-70), `Dashboard.dc.html` and the roster markup still say tier, zone and days are shipped empty. They are populated. Nobody reading the comments would know.

**Side effect.** A coach toggling a sign-off sends `{verified}` only. The route then sets `verify_note = null`, wiping any stored note. The optimistic UI keeps showing the old note.

**Coach-reachable but not on the roster:** the DNA panel, coach notes and the message thread. I classified them from their producers and did not trace every field.

<br>

The rows below follow the surface in order: roster, player file, drill sign-off, other panels.
<br>

**Surface rows**

| Row | Class |
| --- | --- |
| Roster list | RAW |
| Name | RAW |
| Avatar initials | DERIVED |
| Tiebreaker email | DERIVED |
| Tier and zone line | RAW with mislabel |
| Hcp column | RAW |
| Total SG | PLACEHOLDER |
| Five reads and delta | PLACEHOLDER |
| Leak | PLACEHOLDER |
| Last logged | DERIVED |
| Call chip | DERIVED |
| Waiting chip | DERIVED |
| Roster count | DERIVED with mislabel |
| Rail badge | DERIVED |
| Blurb (waiting, silence, movement) | PLACEHOLDER |
| Blurb (standing) | FABRICATED |
| Profile header | RAW |
| Handicap history | PLACEHOLDER |
| History note | FABRICATED |
| Interview intro | FABRICATED |
| Interview fields | RAW |
| Sign-off cards | RAW |
| Video ref and verify note | RAW |
| Drill ticked and watched | RAW (unwritten) |
| Step and plan counters | DERIVED |
| DNA panel | DERIVED |
| Coach notes and messages | RAW |
| `state.forge` | GATED |
| Driving index | DERIVED (live bug) |

<br>
Seven of the statements above are contradicted or qualified in the rows that follow, with their evidence.

<br>
Roster rows, in order, continue below.

<br>
(See `rows`.)

<br>
Open question for Makel: should "N active" count only approved students? The code has the data to do it.

<br>
Priority order for fixing: the three FABRICATED sentences first, then the "Zone N" mislabel, then the "N active" label.

<br>
End of verdict.
- SPA: client/src (App, Login, Profile, ProfileForm, Roster, ConsentGate, Admin, FeedbackButton, quiz/*, quiz/result/*) plus shared/practice-dna scoring, shared/volume.ts, shared/efficiency.ts, shared/zone-grades.ts: 8 fabricated — REFUTED: the SPA is not clean. There are 8 FABRICATED rows, 5 of them with real impact, and I reproduced each with executed output (npx tsx against shared/practice-dna/scoring.ts and server/dnaSummary.ts).

HIGH:
1. The MI verdict ('Your scoring is ahead of your swing / Short game and scrambling are carrying you') ignores the handicap. The handicap cancels out of the gap, so the verdict is the self-rated mechanics scale re-expressed. For plus-handicap golfers it is 'construction' at mechanics 30, 50 and 90.
2. The Architect archetype claims 'no zone is starving'. It fires with all four zones 'locked', and also alongside a Ghost panel on the same full screen. archetypeProvisional is never rendered.
3. Efficiency 67, 'Leaking strokes', prints for a golfer who reports no practice. It is scored against an invented 25/25/25/25 split, and the share card prints '0% Messy Middle'.
4. The Performance time bar and 'Declared practice … a week' include a 25% course-time credit, a modelled and unsigned-off figure. The disclosure the source says must be on the result screen is not there.

LOW: the interview copy says 'three you pick from a list' (it is two), Login's DEMO_VIEWS label asserts a view the app decides, and `Luke\'s` renders a literal backslash.

Defaults recorded as answers (DERIVED, concern stated): the untouched alloc bar saves 25/25/25/25, and untouched sliders save 50, which grades C.

The other rows (Profile, Roster, Admin, consent screens, Login errors) have named producers. I did not find an invented number among them.

Limits:
- No Neon MCP tool was reachable, so I could not query alpha. I used the app's .env connection (role atlas_app, a read-only transaction, pg_stat_user_tables only). That endpoint has no forge schema, so it is main, not alpha.
- Row counts: player_profile 8, handicap_history 14, intake_submissions 8, users 12, coaching_notes 3, organizations 0, org_memberships 0, billing_subscriptions 0.
- Column-level population is unverified. count(*) on golf.player_profile returned 0 because RLS hides rows without a user context, and pg_stats came back empty for the same reason. Neither is evidence of absence.
- How many stored runs hold the default alloc or slider values is unmeasured.
- T-125 held: proto/Dashboard.dc.html:2836 returns '—' when base is null.
- Out of the SPA surface: the '+21.0' literal is not at line 2843 any more. The nearest sign-prefix construct, `(idx > 0 ? '+' : '')`, is still at proto/Dashboard.dc.html:2840. I did not evaluate whether it is inverted.
- T-103/T-106 gating and smoke section S are not SPA code and were not re-run.
- FORGE API response bodies: /Users/makelmackbee/dev/ATR/atlas/server/routes/forge.ts (POST /sessions, POST /sessions/:id/complete, GET /me/dashboard, PUT /me/profile, PUT /me/schedule), branch forge-port, eco 0.29.0 (installed version confirmed in node_modules/@ryp/eco/package.json): 2 fabricated — The FORGE API surface is mostly honest. I found no hardcoded demo seed and no plausible-number fallback on the dashboard path. The T-106, T-125 and `targetHcp ?? 5` fixes all held: every "cannot compute" case I ran returns null with a reason code. I found two FABRICATED items, one real and one low-severity.

**Real defect.** Chipping `practice_index` silently substitutes `allowance = 0` when any shot lacks `target_yds` (`forgeScoring.ts:200-205`). I ran 20 identical chips. Priced, the index is 16.6. Unpriced, it is 20. Both return `withheld: null` and nothing is stored to say which was used. That is the "fallback that substitutes a number" class.

**Low severity.** `seed_honoured: true` at `forge.ts:530` is a hardcoded literal. It is not checked against the stored seed. The file header (lines 59-75) still says the opposite.

**Derived values that mislead without being invented:**
- `picture.composite` renormalises over whichever facets exist. Putting can never appear today, because Putt 18 is withheld and Makeables writes only `predictor_score`. So the composite is always at most a 3-facet figure, with putting's 0.20 weight dropped and no coverage field.
- `streak.weeks_met` is silently capped at 8.
- `picture.facets` takes the first-created facet row per session. That mixes chipping lies and approach modes arbitrarily.
- `se` is a constant divided by the square root of n, not a measured spread.
- No response field carries the modelled/measured provenance tag.

**Columns with no writer in this repo:**
- `handicap_checkin_cadence`, `handicap_checkin_snoozed_until` and `pinned_*` are read but never written. They are honest nulls.
- When something does write `pinned_*`, the dashboard will return an expired pin as active, because it skips the read-time expiry test the schema documents.
- `atlas.assignments` also has no writer, so `assignments` is `[]` unless rows are seeded.

**Absent from the response:** the dashboard has no trend and no leak. Leak is withheld by decision. Trend is simply unbuilt, with no named gate.

**Not checked:** I did not query the alpha Neon branch. No Neon MCP tool was available in this session, and I did not use the `.env` connection string. So "column populated" is unproven for every RAW row. Whether the seed insert grant is live on alpha is also unproven.

**Incidental:** the prototype's `+` prefix on a positive handicap index is still present, now at `proto/Dashboard.dc.html:2840` (previously reported at 2843). It is outside this surface and I did not trace the +21.0 report itself.
- Scoring module outputs (eco/src/scoring/index.ts, installed 0.29.0 dist, SCORING_VERSION forge-2026.10-1) and every place Atlas serves them: server/forgeScoring.ts, server/routes/forge.ts (/sessions/:id/complete, /me/dashboard), plus the served proto Dashboard: 1 fabricated — No scoring output reaching a user is FABRICATED. Every shipped index traces to stored rows, named constants and a named formula. The one FABRICATED row is a latent `sd || 1` fallback in dispersion(), which nothing in Atlas calls. What the surface does fail is the confidence test you asked about. (1) Nothing in the product labels any number with its tier. PROVENANCE, formatWithConfidence, formatHandicap and formatStrokesGained have zero importers, and the API ships no provenance field. The only 'provisional' field in the API means something else (fewer than 20 shots). (2) The Practice Handicap composite is the worst offender. It is built from UNSOURCED (driving), GUESS (chipping) and untiered (approach) inputs. Putting is never in it, because no code writes a putting practice_index. It carries no se, n, stale or coverage field, and a driving-only golfer's composite is simply their driving index. (3) The '±' (CAL.se20/sqrt(n)) is a constant lookup that covers sampling only. Measured against it, the carry-table disagreement moves a driving index about 6 strokes (se 1.9), and the GUESS ATG allowance moves a chipping index about 4.75 strokes (se 1.7). (4) The approach/chipping/makeables base and slope tables are not in CAL and not covered by SCORING_VERSION. (5) scoring_version is reported from the running constant, not the row's stored stamp. (6) The served proto Dashboard computes its own driving index. It uses a men's-only step table with no carry_reference, so it has the T-125 defect again, and the +21.0 sign inversion (T-121) at line 2843 is still live. The `targetHcp ? 5` fallbacks and the state.forge seed also remain in that file, behind the tomorrowShow gate only. Limits: I had no Neon MCP tools in this session, and the repo's .env points at `main` (golf.facet_scores does not exist there), so I could not query alpha. The claim that putting practice_index is never written rests on reading the only writer, forge.ts:653, not on counting rows. I did not run scripts/smoke.ts section S.

---

## What this does not cover

Luke's `AtlasPlayer.dc.html` and the FORGE package's own `.dc.html` screens were out of scope —
neither is served by Atlas today. The FORGE client, when one ships, needs its own pass: §6.4 of the
Build Spec already admits eight fabricated sessions ship as its default state.