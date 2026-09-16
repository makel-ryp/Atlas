# Player-surface audit — 2026-09-16

**Generated from the audit run, not transcribed.** 16 agents: 8 auditors bounded to one render
method each, 8 independent adversarial verifiers that never saw the auditors' reasoning.
**59 findings survived refutation. Every one is player-visible.**

## Why this audit had never been run

`PLAYER_ONLY = [today, cal, plan, build, fitness, transfer, perf, thread]` is hidden from
COACHES. Every prior review (T-57, T-59, T-63, T-66) looked at a coach screen, so none of these
surfaces was ever in front of one. T-67 caught five rail badges; this is the remainder.

## Ground truth for the account these were observed on

`makel@pixelcaddie.com`, a real `atlas:user`, signed in live on 2026-09-16:
**0 signed-off drills. 2 `drill_progress` rows, both null. No practice log. No SG. No speed data.**
**`target` null. `carry` null.** Everything below rendered anyway.

## What is NOT broken, and should not be touched

The rail's metric blocks are all honest: `TARGET HANDICAP —` "No target set", `PRACTICE —`
"Earned, not entered", `TRANSFER GAP —` "Needs a practice index — no producer yet",
`THE GUARANTEE` "Not started — no programme start date on record", `REAL -1.0 Self-reported`.
T-52 and T-59 held. T-67's five blanked badges are confirmed blank on the live site.

## Money and compliance claims (15)

### Rail badge beside TEAM

- **Player reads:** TEAM   6 left   (computed from the seeded tier:'builder'; the badge sits in the persistent left rail on every screen)
- **Binding:** sessionsLeft — proto/Dashboard.dc.html:3637 (`sessionsLeft: totalLeft + ' left'`), summed at :3613/:3617
- **Literal source:** ALLOW/USED/BANKED literal maps at Dashboard.dc.html:3596-3602, selected by `s.tier`, itself the literal `tier: 'builder'` at :3151
- **Asserts:** That this player currently owns 6 unspent prepaid coaching sessions. public.coaching_credits exists in ryp-core with exactly the right shape (credits_granted, credits_used, coach_user_id, expires_at) and has 0 rows; server/protoData.ts never queries it and no key for it exists in the injected blob.
- **Honest fix:** Render nothing (empty span, as showProfile's badge already does at :107) until a coaching_credits read exists. A blank badge is correct — 'blank means not measured, not zero'.
- *(surface: team)*

### Per-coach balance on each of the four TEAM cards

- **Player reads:** '2 available' / '2 / month' (Luke), '0 available' / '1 / month' (Brock), '3 available' / '1 / month' (Yannick), '1 available' / '1 / month' (Phil), each over a filled/unfilled pip row
- **Binding:** c.leftRead, c.allowRead, c.pips, c.leftColor — Dashboard.dc.html:3620-3621, 3626-3629; rendered at :2445 and :2449
- **Literal source:** Same ALLOW map (:3596-3600), USED (:3601), BANKED (:3602); no input from window.__ATLAS_DATA__ anywhere in teamVals()
- **Asserts:** That this player has a specific monthly session allowance per named coach and has already used some of it. Nothing measures allowance (no plan/tier producer — public.plans has 2 rows but is never read here, billing_subscriptions has 0 rows) and nothing measures usage.
- **Honest fix:** Suppress the balance row and the pip strip entirely until coaching_credits is wired; keep the coach identity block only if the relationship itself is verified (see the COACHES finding).
- **Verifier note:** Confirmed. Exact rendered strings under the seeded 'builder' branch: Luke '2 available' / '2 / month' (2 pips, both filled), Brock '0 available' / '1 / month' (1 pip, unfilled), Yannick '3 available' / '1 / month', Phil '1 available' / '1 / month'. Matches the auditor verbatim.
- *(surface: team)*

### Banked-credit expiry warning

- **Player reads:** '1 BANKED · EXPIRES IN 18 DAYS' (Luke card) and '2 BANKED · EXPIRES IN 6 DAYS' (Yannick card), in warning orange #cf7d5c
- **Binding:** c.bankedRead + c.expiry, gated by c.hasExpiry — Dashboard.dc.html:3622-3625; rendered at :2454
- **Literal source:** BANKED = { luke: 1, brock: 0, yannick: 2, phil: 0 } at :3602 and EXPIRY = { luke: '18 days', brock: null, yannick: '6 days', phil: null } at :3603
- **Asserts:** That this player has paid-for sessions rolled over from a previous month that will be forfeited on a specific date. This is the sharpest item on the surface: it is a deadline against money, styled as an alert, and the explanatory copy directly beneath it (:2458, '...expire 90 days after they were issued') frames it as a real contractual term. coaching_credits.expires_at exists and is empty.
- **Honest fix:** Delete the sc-if block from the served render until expires_at is read per credit row. Never print a forfeiture date that no row backs.
- **Verifier note:** Confirmed, and I agree it is the sharpest item. Supporting detail I verified independently of the DB: the explanatory copy at :2458 ('...expire 90 days after they were issued') sits 3 lines below in the same isThread block, which is what converts an invented number into an apparent contractual deadline.
- *(surface: team)*

### Booking call-to-action on each card

- **Player reads:** 'BOOK' (Luke, Yannick, Phil) / 'NONE LEFT THIS MONTH' (Brock, greyed and unclickable-looking)
- **Binding:** c.cta / c.ctaColor / c.ctaBg / c.ctaBorder — Dashboard.dc.html:3630-3633; rendered at :2457
- **Literal source:** Derived from `left`, i.e. the same ALLOW/USED/BANKED literals at :3596-3602
- **Asserts:** That this player has been denied a booking they are entitled to ('None left this month' on the Brock card, purely because USED.brock is the literal 1). On the 'foundation' branch it instead reads 'Upgrade to book' / 'Not in Foundation', telling a player they must pay more to reach a coach — off a literal tier. Behaviourally distinct from the balance display: this is a refusal, not just a number.
- **Honest fix:** Render one neutral CTA ('Request a session') for every coach, or none, until entitlement is real. Never print a denial derived from a literal.
- **Verifier note:** Confirmed, with one narrowing the parent should have: the DENIAL ('None left this month', greyed via ctaColor '#66717f' / transparent ctaBg) is live on first paint today. The 'Upgrade to book' / 'Not in Foundation' upgrade-wall copy is a LATENT branch — it needs locked, i.e. allow===0 && banked===0, unreachable while s.tier is seeded 'builder'. Real, but only if the tier literal is ever flipped rather than removed.
- *(surface: team)*

### The stake · pledge receipt

- **Player reads:** Pledge recorded · 24 Jul
- **Binding:** pledgeLabel — stakeVals(), proto/Dashboard.dc.html:3368
- **Literal source:** state.stake.pledged === true (and the hardcoded date string '24 Jul' in the ternary itself) — proto/Dashboard.dc.html:3126
- **Asserts:** That this player recorded a sixty-second to-camera pledge, and did it on 24 July. The card immediately above it reads 'Put money behind the week. Miss 80% of your floor and it is gone' and the copy below reads 'Sixty seconds to camera, recorded now while you mean it. If you forfeit, that is what plays before you can restart.' So the screen tells the player a forfeit-triggering video of them exists. No video exists, no pledge was made, and there is no pledge table in ryp-core. The blue tick-circle next to it renders filled. Worse, because pledged is already true, the onClick `recordPledge` is a no-op — the player cannot correct it by making a real pledge.
- **Honest fix:** Default state.stake.pledged to false so the control reads its unpledged label ('Record your pledge'), and drop the literal '24 Jul' — a pledge date must come from a record or not render at all. Longer term the whole stake block needs a producer before it can assert anything.
- **Verifier note:** Two trims. (1) The blue tick-circle at :2403 is NOT bound to `pledged` — its fill is static inline style (`background:rgba(127,168,201,0.18); border:1px solid #7fa8c9`) and renders identically when unpledged, so 'the blue tick-circle renders filled' is true but is not evidence of the fabrication; drop it from the claim. (2) Everything else stands. Note for the parent: `notPledged` (:3366) is computed and has no render site either, so there is currently no unpledged UI branch in the markup at all — the fix must add one, not just flip the seed.
- *(surface: plan)*

### The stake · declared misses + amount/destination selection

- **Player reads:** "2 of 2 declared misses left this phase" (proto/Dashboard.dc.html:2409); the $25 chip and the 'To your charity' chip render selected (gold / blue fill) among $10/$25/$50/$100 and charity/coaching-session
- **Binding:** missesRead — stakeVals(), proto/Dashboard.dc.html:3370; stakeChips/destChips selection — proto/Dashboard.dc.html:3348-3364, rendered at 2390 and 2397
- **Literal source:** state.stake = { active: true, amount: 25, dest: 'charity', pledged: true, misses: 2 } — proto/Dashboard.dc.html:3126
- **Asserts:** That this player has a live $25 stake pledged to charity, and a 2-of-2 miss allowance standing in a phase they were never assigned. 'declared misses LEFT this phase' is a running balance — it reads as their account state, not as a default. The 'Declare' control next to it spends from that invented balance. The plan-screen stake card is NOT wrapped in the `sc-if stakeOn` guard (verified at 2381-2412; only the TODAY banner at :186 is guarded), so it renders for every player regardless of stake.active.
- **Honest fix:** Nothing about a stake is measured. Render the amount and destination chips with none selected, and suppress the misses line entirely until a stake record exists — a miss balance is meaningless without a stake. Cross-reference for the parent: the same `const logged = 3.5` literal at proto/Dashboard.dc.html:3342 also drives weekPct/weekBar/weekVerdict/atRisk/thresholdRead, which render at proto/Dashboard.dc.html:186-195 under `isToday` — that is the today auditor's surface, not filed here, but it is the same one-line fix.
- **Verifier note:** Add one fact that strengthens it: `stakeOff` (:3346) is also computed with no render site, so the card has no 'stake is off' state in the markup — a player with no stake cannot see one. Also the auditor's cross-reference is correct and worth carrying: `const logged = 3.5` at :3342 (their line ref is exact) drives weekPct/weekBar/weekVerdict/atRisk/thresholdRead, which render only at :190-195 under the `stakeOn` guard in the today banner — that IS guarded, unlike the plan card, so it is a strictly smaller exposure than the plan one.
- *(surface: plan)*

### Today week-strip — money at risk

- **Player reads:** $25 AT RISK  (rendered uppercase at :195; the $25 chip also renders pre-selected/gold in the Plan stake panel at :2390)
- **Binding:** `atRisk` — stakeVals(), Dashboard.dc.html:3376. Same literal also drives `stakeChips` pre-selection (:3348-3354) and `destChips` pre-selection (:3355-3363), and gates the whole strip via `stakeOn: k.active` (:3345).
- **Literal source:** `stake: { active: true, amount: 25, dest: 'charity', pledged: true, misses: 2 }` — Dashboard.dc.html:3126. Nothing in window.__ATLAS_DATA__ touches `stake`.
- **Asserts:** That this player has an active $25 wager riding on this week's practice, forfeiting to their chosen charity. It is a live financial commitment stated to them as fact; they never set it, and no stake record exists anywhere.
- **Honest fix:** Blank the entire strip (`stakeOn` false) and de-select every amount/destination chip until a real stake record is injected. There is no producer: the SQL above returns zero stake/wager/amount columns in ryp-core. A player who has not opted in must see no money figure at all.
- *(surface: auto+stake+shell)*

### Plan stake panel — pledge receipt

- **Player reads:** PLEDGE RECORDED · 24 JUL
- **Binding:** `pledgeLabel` — stakeVals(), Dashboard.dc.html:3367
- **Literal source:** `stake: { ... pledged: true ... }` at :3126 selects the true branch; the date string '24 Jul' is itself a hardcoded literal inside the expression at :3367.
- **Asserts:** That this player recorded a sixty-second video pledge on 24 July. The adjacent copy at :2405 compounds it — 'If you forfeit, that is what plays before you can restart' — asserting a stored video of this person exists. No such artifact exists. Worse, the date is a constant: even if a player clicks recordPledge this session, the receipt still reads '24 Jul'.
- **Honest fix:** Force the false branch ('Record your pledge') until a real pledge row exists. When one does, the date must come from that row — delete the '24 Jul' literal outright, since it fabricates a timestamp even on the player's own action.
- *(surface: auto+stake+shell)*

### Rail badge: TEAM · "6 LEFT" — coaching sessions the player does not have

- **Player reads:** Rail nav row "Team" with the badge "6 LEFT" (blue), visible on EVERY screen. Behind it the Team screen reads "2 available / 1 banked" (Dr. Luke Benoit), "3 available / 2 banked · expires in 6 days" (Yannick Artigolle), "1 available" (Phil Herder), each with a live "Book" button.
- **Binding:** sessionsLeft — proto/Dashboard.dc.html:3637 (teamVals), rendered at proto/Dashboard.dc.html:99
- **Literal source:** ALLOW/USED/BANKED/EXPIRY literal maps at proto/Dashboard.dc.html:3596-3602, indexed by the literal state `tier: 'builder'` at proto/Dashboard.dc.html:3151. builder → luke 2-1+1=2, brock 1-1+0=0, yannick 1-0+2=3, phil 1-0+0=1 → totalLeft 6.
- **Asserts:** That this player has six paid coaching sessions available this month, one of them expiring in six days, from four named real coaches. Nothing measures this. public.coaching_credits EXISTS in ryp-core (columns credits_granted, credits_used, expires_at) and holds ZERO rows (verified 2026-09-16 via run_sql), and public.billing_subscriptions is also empty — so the real entitlement for every live account is nil. This is a monetary/entitlement claim contradicted by the billing tables, and the badge is on every screen.
- **Honest fix:** Blank the badge (`sessionsLeft: ''`) and blank the per-coach allow/left/banked/expiry reads until a producer reads public.coaching_credits. The coach names, roles and credentials are Luke's real content and stay; the counts, the expiry and the enabled "Book" CTA must not.
- *(surface: rail+cal)*

### $25 AT RISK (stake bar, TODAY)

- **Player reads:** $25 AT RISK
- **Binding:** atRisk — proto/Dashboard.dc.html:3376 (stakeVals), rendered at proto/Dashboard.dc.html:195
- **Literal source:** state.stake = { active: true, amount: 25, dest: 'charity', pledged: true, misses: 2 } — proto/Dashboard.dc.html:3126. `atRisk: '$' + k.amount + ' at risk'`. Nothing in window.__ATLAS_DATA__ touches `stake`.
- **Asserts:** That this player has an active money stake of $25 on this week's practice, and that it is currently at risk of forfeit. A real financial commitment is asserted against a real person. I queried ryp-core: there is no stake, pledge, or forfeit table in atlas/golf/public — no record of this money exists anywhere in the system. The section guard `stakeOn` is itself the literal `active: true` at :3126, so the bar renders for every player on load, including one who never opted into a stake.
- **Honest fix:** Suppress the whole block, not blank the number. A card reading '$— at risk / —% / Completed at — of — hrs' still asserts the player has a pledged stake with a live compliance threshold — the container is the claim. Hide the `stakeOn` section until stake state has a producer, and drive the guard from injected data rather than the literal `active: true`.
- **Verifier note:** Sustained in full. Two additions the auditor missed that strengthen it and narrow the fix: (1) `toggleStake` (:3369) has NO `{{ }}` render site either — same as the dead `stakeOff`/`stakeAmountRead` they correctly identified. So there is no off switch anywhere in the markup; the bar renders for every player on load with no way to dismiss it, and no opt-in UI exists that a fix would need to preserve. Driving `stakeOn` from injected data is the only route. (2) Their supporting claim about ryp-core having no stake table I could not verify from here, but it is not load-bearing — protoData.ts having no `stake` key in AtlasData is decisive on its own.
- *(surface: session)*

### Week compliance percentage + progress bar (TODAY)

- **Player reads:** 70%  (with a gold/blue bar filled to 70% of its width)
- **Binding:** weekPct — proto/Dashboard.dc.html:3373; weekBar :3374; weekColor :3375. Rendered at proto/Dashboard.dc.html:193 (the number) and :190 (the bar fill).
- **Literal source:** `const logged = 3.5` — proto/Dashboard.dc.html:3342, a bare literal inside stakeVals(). `pct = Math.round(logged / floor * 100)`; floor comes from TIERS[state.tier].phases[state.phase].hrs = TIERS.builder.phases[2].hrs = 5.0 (:3051), off the literals `tier: 'builder', phase: 2, rebuild: false` at :3151. 3.5/5.0 = 70%, matching the live page exactly.
- **Asserts:** That this player has logged 3.5 practice hours this week and is at 70% of their weekly requirement — i.e. currently FAILING the 80% compliance threshold that the $25 stake is pledged against. Nobody measured a single one of those hours; no practice-hours table exists in ryp-core.
- **Honest fix:** Suppress with the rest of the stake block. If the block is kept for layout, the bar must render at zero width with no percentage at all — a '0%' would be its own fabrication ('nobody measured' is not 'you did nothing').
- *(surface: session)*

### Compliance threshold line (TODAY)

- **Player reads:** COMPLETED AT 4.0 OF 5.0 HRS · 80%
- **Binding:** thresholdRead — proto/Dashboard.dc.html:3377, rendered at proto/Dashboard.dc.html:191 under the progress bar
- **Literal source:** `(floor * 0.8).toFixed(1) + ' of ' + floor.toFixed(1)`, where floor = TIERS.builder.phases[2].hrs = 5.0 (proto/Dashboard.dc.html:3051), selected by the literals `tier: 'builder', phase: 2` at :3151.
- **Asserts:** That this player is on the Builder tier in Phase 2, and therefore owes 5.0 practice hours a week with 4.0 as their pass mark. ⚠️ NOT a re-report of T-67: T-67 removed the *badge* that displayed 'PLAN · BUILDER'. The literal `tier: 'builder'` survived at :3151 and is now the silent denominator of this weekly floor — and of the $25 stake's pass/fail. `phase: 2` and `rebuild: false` are the other two inputs to the same chain. protoData.ts:69 confirms tier has no producer ('Atlas curriculum tier. Not built.').
- **Honest fix:** Suppress with the block. The deeper fix is to stop letting `tier`/`phase` fall back to literals anywhere — protoData.ts already ships tier as '' for exactly this reason, and stakeVals reads the client literal instead.
- *(surface: session)*

### Week verdict (TODAY)

- **Player reads:** 0.5 hrs to go
- **Binding:** weekVerdict — proto/Dashboard.dc.html:3375, rendered at proto/Dashboard.dc.html:194
- **Literal source:** `(Math.max(0, floor * 0.8 - logged)).toFixed(1) + ' hrs to go'` = 4.0 − 3.5, from `const logged = 3.5` (:3342) and the builder/phase-2 floor (:3151, :3051).
- **Asserts:** An instruction derived from a fabricated position: that this player is half an hour of practice away from saving their $25 this week. It is the most directly actionable sentence on the screen and it is invented end to end.
- **Honest fix:** Suppress with the block.
- *(surface: session)*

### Declared misses remaining (PLAN screen, same stake feature)

- **Player reads:** 2 OF 2 DECLARED MISSES LEFT THIS PHASE
- **Binding:** missesRead — proto/Dashboard.dc.html:3370, rendered at proto/Dashboard.dc.html:2409 inside the `isPlan` guard
- **Literal source:** `k.misses + ' of 2 declared misses left this phase'` with `misses: 2` in the state literal at proto/Dashboard.dc.html:3126.
- **Asserts:** That this player has an allowance of 2 declared misses this phase and has used none of them — a compliance balance against a stake, adjacent to a 'Declare' button that decrements it client-side only (:3371). A player who declares a miss sees the balance drop to 1, reloads, and it is 2 again; the week they relied on it, the miss was never recorded.
- **Honest fix:** Suppress with the stake panel. If the panel stays, the counter must not render a balance, and the 'Declare' control must be disabled rather than mutating a number nothing stores.
- *(surface: session)*

### Rail nav badge on 'Team'

- **Player reads:** 6 LEFT
- **Binding:** sessionsLeft — computed in teamVals() at /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html:3637 (`sessionsLeft: totalLeft + ' left'`), rendered at proto/Dashboard.dc.html:105
- **Literal source:** Three hardcoded maps at proto/Dashboard.dc.html:3596-3602. ALLOW is keyed off `state.tier`, still the literal 'builder' (:3151) — T-67 blanked the *display* binding `tierName` (:6043) but left the literal that drives this lookup — giving ALLOW={luke:2,brock:1,yannick:1,phil:1}; USED={luke:1,brock:1,yannick:0,phil:0} (:3601); BANKED={luke:1,brock:0,yannick:2,phil:0} (:3602). left = max(0,allow-used)+banked → luke 2, brock 0, yannick 3, phil 1 = totalLeft 6.
- **Asserts:** That this player currently holds 6 unused coaching sessions with the RYP coaching staff. This is an entitlement/credit balance — a money claim. public.coaching_credits EXISTS in ryp-core (columns user_id, coach_user_id, credits_granted, credits_used, expires_at) and holds ZERO rows (verified by query today), and nothing in server/ or shared/ reads it (grep for coaching_credits returns nothing). So the badge asserts a balance of 6 against a real, empty ledger: every live player's true balance is 0.
- **Honest fix:** Blank badge. A credit balance must come from public.coaching_credits or not be shown at all — 'no sessions on file' is the true state, and 6 is the worst possible direction to be wrong in. NOTE 1: shared render — the computing method teamVals() belongs to the 'thread' surface; dedupe with that auditor. NOTE 2: the same ALLOW/USED/BANKED literals feed a full per-coach entitlement panel on the Team screen (coachCards: allowRead '2 / month', leftRead 'N available', bankedRead 'N banked', expiry '18 days'/'6 days', cta 'Book') — a much larger fabrication of the same class, not audited here, route it to the thread auditor.
- *(surface: profile)*

## Contradicts real data (the page disagrees with the database, or with another page) (10)

### The four coach cards themselves, under the heading 'Your team.'

- **Player reads:** 'THE PEOPLE ON YOUR SIDE' / 'Your team.' / 'Every reply comes from someone who has read your whole file.' then four cards: Dr. Luke Benoit (Method · swing construction), Brock Winter (Swing), Yannick Artigolle (Mental performance), Phil Herder (Fitness & speed)
- **Binding:** coachCards, from the COACHES literal — Dashboard.dc.html:3604-3609; rendered at :2435-2443
- **Literal source:** COACHES array at :3604-3609
- **Asserts:** That these four specific named people are this player's coaching team and have read their file. The coach names and credentials are real product content, but asserting the RELATIONSHIP is a claim about the player. ryp-core does record this: public.user_relationships holds 9 coach_of rows (7 active, 2 pending) and protoData.ts reads that table — but only in the coach direction (actorUserId = me.id, :677-678) to build the roster; the player direction is never queried and no coach list is injected. public.coach_profiles has exactly 1 row, so three of the four named cards have no coach record at all.
- **Honest fix:** Build coachCards from a reverse user_relationships lookup (subjectUserId = me.id, relationship 'coach_of', status 'active') joined to coach_profiles; render an empty state when there are none. Lower priority than the credit lines only because the names are plausibly this org's real staff.
- *(surface: team)*

### The message thread below the cards — INCLUDING one attributed to the player

- **Player reads:** Three messages. 'You · Friday · 7:40am — Felt like I lost the left side on the third rep. Sending all four sets rather than my best one.' plus 'Dr. Luke Benoit · Yesterday · 6:12pm — Watched the three reps from Friday. Ground force is holding at 6 seconds...' and 'Coach Reyes · Performance · Wed · 11:05am — Adding a hip-hinge pattern before your lift days...'
- **Binding:** messages — Dashboard.dc.html:6238-6242; rendered at :2462-2470, inside the same isThread guard as the rest of this surface
- **Literal source:** Hardcoded array literal at :6238-6242. NOTE: this binding sits outside my assigned 3594-3708 range — I am reporting it because it renders on the TEAM screen and a reviewer assigned by line number near 6238 would not recognise it as such.
- **Asserts:** The most severe item on the surface. It puts words in the player's own mouth about their own swing ('I lost the left side on the third rep'), and has two coaches give specific technical feedback on reps nobody filmed or watched. This is exactly the class protoData.ts's own header calls 'worse still' — narrative prose about a person. It also invents a fifth coach, 'Coach Reyes', not in the COACHES array and not in the database.
- **Honest fix:** Render an empty thread state ('No messages yet') until a real messaging producer exists. There is no table for this in ryp-core at all.
- *(surface: team)*

### Step ladder · coach sign-off

- **Player reads:** Steps 1 and 2 render state "Completed" with a green ✓ node and the sign-off line "Completed · Dr. Benoit"; Step 3 renders unlocked and open; Steps 4 and 5 render "Locked" / "Locked until Step 3"
- **Binding:** buildSteps() — state/accent/node/signLabel, proto/Dashboard.dc.html:3941-3955 and 4008. NOTE: this renders in the `isBuild` section at proto/Dashboard.dc.html:1019 (guard `isBuild` at :979), not on plan — it is reported here only because buildSteps() sits inside my assigned line range. `build` is also in PLAYER_ONLY (server/protoData.ts:264), so it is player-visible; parent should dedupe against any build auditor.
- **Literal source:** state.signed: [1, 2] — proto/Dashboard.dc.html:3148 (plus the hardcoded coach name 'Dr. Benoit' in the signLabel ternary at proto/Dashboard.dc.html:4008)
- **Asserts:** That a named coach signed off two full construction steps of this player's build, and that their curriculum has advanced to Step 3 with Steps 4-5 gated behind work they have not done. Nobody signed anything. This is not merely invented: golf.drill_progress EXISTS with ticked_at / verified_at / verified_by_user_id / signed_off_at columns, and server/protoData.ts injects it as `me.drills` — but buildSteps() never reads `who.drills` (the only consumer of the injected drills map is the profile screen at proto/Dashboard.dc.html:4202). The screen prints a fiction over real data it already has in hand. Same state literal T-67 blanked on the rail badge only.
- **Honest fix:** Seed state.signed from `me.drills` signed-off/verified records (the injected data is already there), and drop the hardcoded 'Dr. Benoit' in favour of the verifying user. Until that is wired, seed signed: [] — no step completed, no step locked behind a fiction.
- **Verifier note:** Their proposed fix is incomplete and the parent should know before acting. Seeding `signed: []` does not close this: `requestSignOff` at :3897-3900 lets the PLAYER write their own step number into `signed`, after which :4009 prints 'Completed · Dr. Benoit' — a named coach credited for a sign-off the player gave themselves. The hardcoded name must go in the same change as the seed, not after it. Minor line drift: signLabel is :4009.
- *(surface: plan)*

### Step ladder · drill ticks, verifications and progress bars

- **Player reads:** Per-step counts like "4 / 4" with a filled gold/green progress bar; individual drills reading "Completed" or "Verified" (green) instead of their curriculum standard; demo thumbnails rendering as already-watched (no gold unwatched dot); the pivot variant chip 'cannon' rendered as the player's selected pattern
- **Binding:** buildSteps() — done/pct/count (proto/Dashboard.dc.html:3940, 3956, 3958), drills[].std/boxBg/tick/unwatched (proto/Dashboard.dc.html:3980-3994), variantChips (proto/Dashboard.dc.html:3963-3972). Renders under `isBuild` at proto/Dashboard.dc.html:1019/1062 — see the note on the previous finding.
- **Literal source:** state.ticked: DONE (12 keys — proto/Dashboard.dc.html:2885, referenced 3147), state.verified: ['1-3','2-P1','2-P2','2-P3','3-S2'] (proto/Dashboard.dc.html:3147), state.watched: DONE.slice() (proto/Dashboard.dc.html:3148), state.pivot: 'cannon' (proto/Dashboard.dc.html:3125)
- **Asserts:** Twelve drill reps the player never claimed, five of them marked coach-'Verified' in green, every demo video marked already watched, and progress bars filled to match — plus a pivot pattern ('cannon') presented as their chosen variant. Same contradiction as above: golf.drill_progress carries the real ticked_at / watched_at / verified_at and is injected as `me.drills`, and this method ignores it in favour of the literal.
- **Honest fix:** Seed ticked/verified/watched from the injected `me.drills` map (ticked_at → ticked, verified_at → verified, watched_at → watched), which already arrives on the page. Until wired, seed all three as [] so counts read 0 / N and every drill shows its curriculum standard. For `pivot`, render no variant chip selected until the player picks one.
- **Verifier note:** Add one item their fix misses: even with variantChips deselected, the static markup line at :1057 still reads 'Assigned by Dr. Benoit from your movement screen' — it is hardcoded text in the hasVariants block, not a binding, so blanking `pivot` leaves that assertion standing. It must be removed or gated in the same change. Line drift: verified :3149, watched :3150.
- *(surface: plan)*

### Calendar: "Saved · visible to your coach" — nothing is saved anywhere

- **Player reads:** Bottom-right of the day panel, after logging (or on any pre-seeded day): "SAVED · VISIBLE TO YOUR COACH"
- **Binding:** savedRead — proto/Dashboard.dc.html:6156; rendered at proto/Dashboard.dc.html:971
- **Literal source:** No literal — the defect is the absence of any producer. The page makes exactly three network calls (proto/Dashboard.dc.html:4975 coach verify, :5011 coach notes, :5061 /api/users/me); there is no write path for the practice log, no localStorage, and no practice table in ryp-core.
- **Asserts:** Tells the player their log was persisted and that their coach can see it. Both halves are false: the entry lives in browser memory and is gone on reload, and no coach surface reads it. It also fires over the SEED days (selecting day 25 shows it against an entry the player never made), so it vouches for the fabricated history as coach-visible.
- **Honest fix:** Blank `savedRead` until a real POST exists. Ranked last deliberately — it is a false status string rather than a literal-derived metric, and the parent may judge it out of this bug class; it should not displace the findings above.
- *(surface: rail+cal)*

### TRANSFER GAP

- **Player reads:** "TRANSFER GAP" / a large signed number / "TRANSFERS CLEAN" | "SOME LEAKAGE" | "RANGE HERO", captioned "Strokes between what you practise like and what you score like. The whole method exists to close this number." A player whose index is 4.2 reads "-2.8 / TRANSFERS CLEAN"; a player with NO handicap on file reads "+4.5 / RANGE HERO".
- **Binding:** transferGap / transferLabel / transferColor, computed in the IIFE at proto/Dashboard.dc.html:3518-3525; rendered proto/Dashboard.dc.html:2083-2084
- **Literal source:** composite = 6.95, from state.forge driving 14.0 / approach 8.0 / chipping -3.0 / putting 2.0 at proto/Dashboard.dc.html:3129; plus a SECOND literal on the same line — `const real = s.realHcp === undefined ? 11.4 : s.realHcp` at proto/Dashboard.dc.html:3519, the same 11.4 that T-59 removed from the rail steppers. With nothing on file BOTH operands are fiction: 11.4 - 6.95.
- **Asserts:** That the gap between how they practise and how they score is this many strokes, and a verdict on whether their range game travels. Nobody measured the practice half — it is the same number for every player alive. This is T-52's exact bug, unfixed: the rail two inches away prints '—' for the same quantity with the caption 'Needs a practice index — no producer yet', so one screen contradicts the other.
- **Honest fix:** Mirror the rail fix at 5496-5505 verbatim: prac = null, gap = null, render '—' with 'Needs a practice index — no producer yet' and no colour verdict. Delete the 11.4 fallback so an unrecorded index cannot manufacture a gap.
- **Verifier note:** Confirmed as stated. Minor: the IIFE runs 3518-3526, not 3518-3525. The contradiction they describe is real — the same page prints '—' in the rail and '+4.5 / Range hero' in the zone.
- *(surface: forge)*

### STROKES GAINED · PRACTICE

- **Player reads:** "STROKES GAINED · PRACTICE" then "-2.0" at clamp(42px,11vw,64px) — the largest number on the Performance screen — subtitled "PLAYS TO 7.0 · TARGET 5.0".
- **Binding:** composite / compositeSub / compositeColor, proto/Dashboard.dc.html:3513-3515 (composite computed at :3385); rendered proto/Dashboard.dc.html:2117-2118
- **Literal source:** state.forge driving 14.0 / approach 8.0 / chipping -3.0 / putting 2.0 at proto/Dashboard.dc.html:3129, weighted 0.30/0.35/0.15/0.20. Always exactly 6.95.
- **Asserts:** Their headline strokes-gained figure and the handicap their practice 'plays to' — the single number the whole Performance zone is built around. It is identical for every player who signs in. This is T-41's fabricated composite; the rail's twin was fixed to practiceHcp:'—' at 5408 with the note that golf.practice_index_results does not exist (I confirmed it does not), but the zone copy was never touched.
- **Honest fix:** '—' for composite, blank compositeSub, neutral colour — matching practiceHcp:'—' at 5408. The panel's 'On course · Arccos' legend and Connect link can stay; they claim nothing.
- **Verifier note:** Confirmed as stated. I did not re-check whether golf.practice_index_results exists in ryp-core — it cannot change whether 3129 is a literal, so it moves no verdict.
- *(surface: forge)*

### Silent target-handicap default of 5 (and the 'your handicap' captions it writes)

- **Player reads:** "TARGET · 5 HANDICAP TARGET" (2011), "VS YOUR 5.0 HANDICAP" (1970), "· TARGET 5.0" (2118) — plus every SG number and every "Plays to …" subtitle in both zones, all computed against 5.
- **Binding:** tHcp at proto/Dashboard.dc.html:3384 and hcp at proto/Dashboard.dc.html:3430, both `=== undefined ? 5`; surfaces as sgHcp (:3498), sgVerdict (:3496), compositeSub (:3514) and every sgFor() call in the method
- **Literal source:** the bare literal 5 at proto/Dashboard.dc.html:3384 and :3430
- **Asserts:** Says 'your 5.0 handicap' to a player who never entered a target handicap. It breaks the contract written directly above the seed at proto/Dashboard.dc.html:3095-3100 — 'Both stay undefined when nothing is recorded, so the guards downstream still fire and the display shows \'—\'. A number is never substituted for a missing one.' The seed at :3101-3110 is correct; forgeVals is one of the places that was supposed to be fixed by it and still substitutes. The rail renders targetHcp as '—' (5391) on the same page load.
- **Honest fix:** Drop the `? 5`. When targetHcp is undefined, sgVerdict / sgHcp / compositeSub render blank and every SG value renders '—' — the same guard the rail already uses at 5391.
- *(surface: forge)*

### Pledge state (PLAN screen, same stake feature)

- **Player reads:** PLEDGE RECORDED · 24 JUL
- **Binding:** pledgeLabel — proto/Dashboard.dc.html:3367, rendered at proto/Dashboard.dc.html:2404 inside `<sc-if value="{{ isPlan }}">` (guard opens at :2236)
- **Literal source:** `k.pledged ? 'Pledge recorded · 24 Jul' : 'Record your pledge'` with `pledged: true` in the state literal at proto/Dashboard.dc.html:3126. Both the boolean and the date string are literals.
- **Asserts:** That this player recorded a to-camera forfeit pledge, and did so on 24 July. It is a dated event in their history that never happened, and it renders the action as already completed so the player cannot perform it. The only writer is `recordPledge` (:3368), client-side setState — nothing persists, and ryp-core has no pledge table.
- **Honest fix:** Default `pledged` to false so the control reads 'Record your pledge', or suppress the stake panel entirely until a pledge producer exists. The hardcoded '24 Jul' must go regardless — a date string in a ternary can never be right for a real user.
- *(surface: session)*

### Date line, TODAY header

- **Player reads:** SUNDAY · JULY 26
- **Binding:** Static markup, not a binding — proto/Dashboard.dc.html:182, inside `<sc-if value="{{ isToday }}">` (guard at :180)
- **Literal source:** The string is hardcoded in the HTML at proto/Dashboard.dc.html:182. It is the same frozen date as the calendar's `const TODAY = 26` at :2821.
- **Asserts:** That today is Sunday 26 July, directly above the heading 'One thing today.' Today is Wednesday 16 September 2026. Every dated thing on the screen is anchored to this line, and the app already holds the true date — `now: Date.now()` is in state at :3150 and componentDidMount runs a live interval (:3735) — so the page contradicts a real value it is already carrying. Lower stakes than the money block: it misdates the player's day rather than inventing a fact about their golf.
- **Honest fix:** Render it from the live clock the page already keeps (`state.now`), formatted in the player's locale — this one can be honest today, no producer needed.
- *(surface: session)*

## Invented metrics (a measured-looking number nobody measured) (11)

### Tier card selection + the entire phase prescription

- **Player reads:** The Builder card renders selected — gold border, lifted background, gold name, badge "Current plan" (the other two read "Switch"); the Phase 2 tab renders selected in gold; heading "Construction Primary"; Weekly floor "5.0 hrs", Play target "~5 hrs", Speed "3 × 15", Con / Trans "70 / 30"; mix line "7 × 30 Home + 3 × 30 Range"; and the seven-row representative week ("Mon · 30 Home + 30 Range · Calibration Check" … )
- **Binding:** tierCards.badge/border/bg/nameColor, phaseTabs, phaseLabel, phaseMix, floorRead, playRead, speedRead, splitRead, weekRows, hasSpeed — planVals(), proto/Dashboard.dc.html:3795-3842; schedRows day/duration columns inherit it via buildSchedule(ph) at proto/Dashboard.dc.html:3837 → 5684. Rendered at proto/Dashboard.dc.html:2243-2296 and 2298-2306.
- **Literal source:** state.tier: 'builder', state.phase: 2 — proto/Dashboard.dc.html:3149, read into TIERS/phases literals at proto/Dashboard.dc.html:3030-3070
- **Asserts:** That this player is on the Builder tier and in Phase 2, and therefore owes 5.0 hours of structured practice a week, ~5 hours of play, 3 × 15-min speed sessions, a 70/30 construction-transfer split and a specific seven-day schedule. No tier or phase was ever assigned: verified by query, ryp-core has no tier or phase column anywhere (golf.player_profile holds only handicap_index, driver_carry_yds, handedness, ghin_number, target_handicap), and server/protoData.ts:RosterRow documents `tier` and `zone` as 'Atlas curriculum. Not built.' This is the same literal T-67 blanked on the rail badge; T-67 left this screen. IMPORTANT SCOPE NOTE for the fix: the tier cards' own content (T.name, T.floor '5 hrs / week', T.who, T.speed) and the phase tab labels are honest curriculum catalog copy Luke owns — do not blank those. The fabrication is the SELECTION: 'Current plan', the gold highlight, and every number downstream of `TIERS[s.tier].phases[s.phase]` being presented as this player's prescription rather than as a catalog sample.
- **Honest fix:** Seed state.tier and state.phase as undefined. With no tier selected: no card carries 'Current plan' (all read 'Switch' or similar), no phase tab is highlighted, and the prescription panel renders '—' / withheld until the player picks one — at which point it becomes their own input this session and is honest. Keep the catalog copy on the three cards intact.
- **Verifier note:** Two things the parent must not trip over. (1) Grepping 'tier' in the eco schema DOES return hits — identity.ts:69 (subscription entitlement tier), enums.ts:28-55 (plan ranks), atlas.ts:151 `tier_completed` (intake-funnel counter 0-4). None of these is a practice tier; a careless reader could see 'tier exists in the DB' and wrongly unwind this finding. (2) The seven-row week renders under an explicit 'Representative week' header (:2270), which hedges that sub-part as a sample; the four-cell strip above it (Weekly floor / Play target / Speed / Con·Trans, :2274-2277) carries no hedge and is the hard prescription. Keep the finding; narrate the week rows as the weaker half. Their scope note (keep t.name/t.floor/t.who/t.speed and the phase labels as catalog copy) is right.
- *(surface: plan)*

### Tomorrow card — strokes-gained number

- **Player reads:** -2.7   (large, in the warm/red tone #d9885e) above the caption "DRIVING SG"
- **Binding:** `autoLeakSG` / `autoLeakName` / `autoLeakColor` — autoVals(), Dashboard.dc.html:4087-4089, from `worst` (:4079) over `scored` (:4078) via `sgFor` (:2985, `(target - index) * SG_W[k]`).
- **Literal source:** `forge: { driving: 14.0, approach: 8.0, chipping: -3.0, putting: 2.0, ... }` — Dashboard.dc.html:3129. Second literal in the same expression: the `s.targetHcp === undefined ? 5` fallback at :4027. With defaults this computes driving (5-14.0)*0.30 = -2.70, approach -1.05, chipping +1.20, putting +0.60.
- **Asserts:** That this player has been measured losing 2.7 strokes a round off the tee, and that driving is the worst of their four facets. Nobody measured any of it. This is the T-41 fabricated strokes-gained composite reappearing on a player-only screen.
- **Honest fix:** Render '—' and suppress the number block until real facet indices are injected. No producer exists: the SQL above finds no strokes_gained/driving/approach/chipping/putting column in ryp-core, and server/protoData.ts declares the key unpopulated — `sg: number[] /** Strokes-gained series. Forge. */`. Separately, the comment at :3096-3100 asserting 'A number is never substituted for a missing one' is false — `targetHcp === undefined ? 5` still stands at :3384, :3430, :4027, :5525 and :5626, so a player with no recorded target is silently given a 5 and this arithmetic runs anyway.
- *(surface: auto+stake+shell)*

### Tomorrow card — verdict prose and selected drill set

- **Player reads:** Header "TOMORROW · BUILT FOR YOU"; headline "Driving is where the strokes go."; body "Of the four facets, driving is furthest behind your target handicap. Tomorrow is built there — you do not get to pick the comfortable one."; three blocks: Calibration/20 min/"Driver dispersion, 15 balls", Construction/15 min/"Load, shift, explode ×20", Transfer/15 min/"Driving Index, 20 shots"; footer "50 minutes · regenerates every Sunday".
- **Binding:** `autoHeadline` (:4081), `autoRationale` (:4084), `autoBlocks` (:4090), `autoStamp` (:4097) — every one keyed off `worst` (:4079), the same literal-driven selection as the row above.
- **Literal source:** `forge` facet literals at Dashboard.dc.html:3129 plus the `targetHcp === undefined ? 5` fallback at :4027, selecting `FACETS[0]` (driving) out of the literal FACETS array defined in-method at :4028-4076.
- **Asserts:** That this player's four facets were assessed, that driving is the one furthest behind their target handicap, and that these three specific drills were therefore prescribed to them for tomorrow. The drill content is Luke's curriculum and is fine; the fabrication is the diagnosis and the 'built for you' selection wrapped around it.
- **Honest fix:** Suppress the whole card — header included — until forge indices are real; a generic prescription is still a prescription once it is labelled 'built for you' and justified by a measurement. Minor note in the same card: `autoAcceptLabel` (:4092) flips to 'On tomorrow's calendar' on click, but nothing is written to any calendar — the state is browser-local only.
- **Verifier note:** Confirmed for the DIAGNOSIS only. Scope-trim the fix: the fabrication is (a) the selection of driving as 'furthest behind your target handicap', (b) the 'built for you' framing at :266, and (c) the rationale sentence at :4084. The drill text inside autoBlocks — zone names, minute counts, drill names and 'why' lines — is Luke's curriculum and MUST survive the fix; the auditor scoped this right in prose but over-listed it under 'reads'. autoStamp's sum (20+15+15=50) is arithmetically correct over that curriculum. Same root literal as finding 3 — count as ONE fix, not two. Their minor note on autoAcceptLabel (:4092, 'On tomorrow's calendar' with no calendar write) is accurate and correctly kept as a note, not a finding.
- *(surface: auto+stake+shell)*

### Calendar stat row: Streak 6 days · Practiced 22 / 26 · Hours 9.3 · Workouts 9

- **Player reads:** Four large numerals under the grid: "Streak 6 days", "Practiced 22 / 26", "Hours 9.3 hrs", "Workouts 9"
- **Binding:** streak / pDays / wDays / totalHrs — computed proto/Dashboard.dc.html:5947-5951, returned at :6098; rendered at proto/Dashboard.dc.html:923-926
- **Literal source:** const SEED at proto/Dashboard.dc.html:2823-2832; the "/ 26" denominator is the literal TODAY = 26 at proto/Dashboard.dc.html:2821 hardcoded into the markup at :924
- **Asserts:** Four headline numbers about this player's month — a six-day streak, 22 practice days out of 26, 9.3 hours, 9 workouts — none of which was measured. Both the numerator and the denominator of "22 / 26" are invented.
- **Honest fix:** Falls out automatically once `log` stops defaulting to SEED (all four read 0 / 0.0 on an empty log). If the log source stays absent, prefer rendering '—' rather than 0 for Streak/Hours, per "blank means not measured, not zero"; the hardcoded "/ 26" denominator must be dropped or bound regardless.
- *(surface: rail+cal)*

### Today screen: "You're holding 6 seconds."

- **Player reads:** Headline above the tempo ladder: "You're holding 6 seconds." [CROSS-SURFACE: computed inside my range (renderVals) but rendered in the TODAY section — dedup against the 'today' auditor.]
- **Binding:** tempoLabel — proto/Dashboard.dc.html:6086; rendered at proto/Dashboard.dc.html:299
- **Literal source:** `tempo: 6` at proto/Dashboard.dc.html:3085
- **Asserts:** States this player's current smoothie tempo as a measured fact. On a fresh load nobody has touched the ladder — 6 is the literal seed, not the player's selection, and the sentence is phrased as a present-tense assertion about them.
- **Honest fix:** Seed `tempo: undefined` and render "Pick the rung you're holding." (or blank) until the player taps a rung; the ladder itself is fine and its rungs are curriculum.
- **Verifier note:** Confirmed, and it is broader than they state — see `missed`: the ladder's own fill (`t >= s.tempo` at :6088) paints rungs 10s→6s gold off the same literal, so the graphic asserts the descent even with the sentence blanked. Their proposed fix (tempo undefined) does handle both. Cross-surface with the 'today' auditor.
- *(surface: rail+cal)*

### Practice vs on-course domain rows (Performance)

- **Player reads:** Four rows, e.g. "Driving · Plays to 14.0    +5.0 Leaks badly" with bars, practice value "-2.7" and on-course value "-4.2"; then "Approach · Plays to 8.0  +2.5 Some leak", "Chipping · Plays to +3.0  +2.0 Some leak", "Putting · Plays to 2.0  +1.5 Holds up".
- **Binding:** domainRows, proto/Dashboard.dc.html:3526-3543 (domains built at :3386-3391); rendered proto/Dashboard.dc.html:2128-2149
- **Literal source:** state.forge.driving/approach/chipping/putting and state.forge.tr.* at proto/Dashboard.dc.html:3129-3130
- **Asserts:** A per-domain breakdown of where this player gains and gives away strokes, and a graded verdict ('Leaks badly' / 'Some leak' / 'Holds up') on each. Every player sees the same four verdicts. The 'On course · Arccos' legend directly above (2121) frames the trValue column as coming from their connected rounds; it comes from state.forge.tr.
- **Honest fix:** Empty array until a producer exists, so the panel renders no rows rather than four fabricated ones.
- **Verifier note:** Confirmed. Line range is 3527-3547.
- *(surface: forge)*

### PRIMARY STROKE LEAK

- **Player reads:** "PRIMARY STROKE LEAK" / "Driving +14.0" / "Carries 30% of the composite and holds your widest variance. This is what the next block should attack."
- **Binding:** leakLabel / leakValue / leakWeight, proto/Dashboard.dc.html:3544 (leak selected at :3392); rendered proto/Dashboard.dc.html:2157-2158
- **Literal source:** state.forge.driving 14.0 at proto/Dashboard.dc.html:3129 — leak is just the max of the four literals, so it is always Driving
- **Asserts:** Names this player's single biggest weakness and prescribes the next block of work from it. Identical for everyone. Two separate defects: the diagnosis is invented, and leakValue is `fmt(leak.v)` — the RAW index 14.0 printed as '+14.0' beside genuine strokes-gained figures, so it reads as '+14 strokes gained' when it is a handicap index. Also note the follow-on claim 'holds your widest variance': no variance is computed anywhere in this method.
- **Honest fix:** Blank the whole card (leakLabel '', leakValue '', leakWeight '') so the 'Primary stroke leak' panel renders empty. Do not keep the prose, which asserts the variance claim on its own.
- **Verifier note:** Confirmed on both defects. Binding is 3556.
- *(surface: forge)*

### Skill radar — "You vs scratch baseline"

- **Player reads:** A filled gold pentagon labelled "YOU" plotted against a dashed "SCRATCH BASELINE", across the axes Off the tee / Approach / Around the green / Putting / Speed / distance.
- **Binding:** radarYou, proto/Dashboard.dc.html:3545 (you computed at :3409 from AX at :3395-3401); rendered proto/Dashboard.dc.html:2180
- **Literal source:** state.forge.dna { offTheTee:74, approach:46, aroundTheGreen:81, putting:63, speedDistance:38 } at proto/Dashboard.dc.html:3132
- **Asserts:** A five-axis picture of this player's game against scratch — the most immediately legible claim on the screen, read at a glance without any number. The shape is the same for every player. Note the shape is real-looking precisely because the literals are uneven (81 vs 38), so it never looks like placeholder.
- **Honest fix:** Omit the radarYou polygon when no DNA exists. radarBase / radarRings / radarSpokes / radarLabels are pure geometry and chrome and can stay — the empty web with only the scratch baseline is the honest render.
- **Verifier note:** Confirmed. Binding is 3557. Their fix is right that radarBase/Rings/Spokes/Labels are pure geometry and can stay — I checked 3403-3410 and 3558-3573 and none of them read player data.
- *(surface: forge)*

### Short game assessment (30 shots)

- **Player reads:** "STROKES GAINED" / "-0.1" / "VS YOUR 5.0 HANDICAP"; six scored rows, e.g. "Short chip · fairway | 15–20 ft, low runner | 7 pts | +0.8 | plays to +0.6" and "Bunker | 20–25 ft, your lie | 2 pts"; "YOUR TOTAL 32 pts"; "Strength — Flop" and "Weakness — Bunker".
- **Binding:** sgRows / sgTotal / sgDiff / sgDiffColor / sgVerdict / sgBest / sgWorst / sgAxisMark, proto/Dashboard.dc.html:3462-3501 (SG array at :3419-3426, sgTotal :3428, sgaSG :3455); rendered proto/Dashboard.dc.html:1969-2025
- **Literal source:** the pts field of the SG array at proto/Dashboard.dc.html:3419-3426 — 7 / 5 / 6 / 4 / 2 / 8. sgTotal is their sum, always 32.
- **Asserts:** Six per-situation scores for a thirty-shot assessment this player may never have taken, a total labelled 'YOUR TOTAL', a strokes-gained reading, and a named strength and weakness ('Strength — Flop', 'Weakness — Bunker'). All identical for every player. The six situation names and notes are Luke's curriculum and are fine; the pts are not.
- **Honest fix:** Empty sgRows; sgTotal, sgDiff, sgBest, sgWorst blank or '—'. Keep sgTarget and sgBenchmarks — those are standards, not claims (see clean).
- **Verifier note:** Confirmed. Binding range is 3460-3493 (not 3462-3501). One over-reach in their fix: `sgAxisMark` (3473) is `axis(hcp)` — the position of the player's own target handicap on the axis. It becomes honest the moment the `? 5` at 3430 goes and does not need blanking alongside the pts.
- *(surface: forge)*

### UNDER THE ROUND — the four indices inside a simulated round

- **Player reads:** "UNDER THE ROUND" / "The same four indices, scored inside a simulated round instead of a drill." / four rows: "Driving · Plays to 19.0   -4.2", "Approach · Plays to 10.5  -1.9", "Chipping · Plays to +1.0  +0.9", "Putting · Plays to 3.5  +0.3".
- **Binding:** transferRows, proto/Dashboard.dc.html:3536-3543; rendered proto/Dashboard.dc.html:2064-2075
- **Literal source:** state.forge.tr { driving:19.0, approach:10.5, chipping:-1.0, putting:3.5 } at proto/Dashboard.dc.html:3130
- **Asserts:** How each of this player's four indices held up under simulated-round pressure — the specific evidence the Transfer zone exists to present. Nobody measured it; the four values are fixed.
- **Honest fix:** Empty array so the panel renders its heading and explanation with no rows.
- **Verifier note:** Confirmed. Binding range is 3548-3555.
- *(surface: forge)*

### Tempo ladder position (TODAY, sibling card)

- **Player reads:** You're holding 6 seconds.  (ladder rungs 10s-6s rendered gold, 5s-2s dimmed)
- **Binding:** tempoLabel — proto/Dashboard.dc.html:6086, rendered at proto/Dashboard.dc.html:299; `ladder` :6087-6091 drives the bar colours off the same value
- **Literal source:** `tempo: 6` in the state literal at proto/Dashboard.dc.html:3085. No injected source — ryp-core has no tempo table, and protoData.ts never mentions tempo.
- **Asserts:** A first-person claim that this player is currently holding a 6-second smoothie, with the ladder graphic shading every rung from 10s down to 6s as already achieved. Nobody measured it. Just outside my assigned line range (it is a sibling card on the same TODAY screen, not part of stakeVals/sessionVals), reported because the sentence is addressed to the player in the second person and is the highest-signal fabrication on the screen after the money block.
- **Honest fix:** With no producer, the headline should not name a rung ('Tap the rung you held cleanly for a full set' already stands on its own) and no rung should render as achieved. A player tap this session is legitimate input and may light up from there.
- *(surface: session)*

## Invented progress (standing, streaks, completion) (21)

### Left rail, Fitness nav item — badge on the right of the row

- **Player reads:** FITNESS    2 OF 5 LOGGED
- **Binding:** liftCompliance — /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html:3731 (`done.length + ' of ' + ROWS.length + ' logged'`); rendered at Dashboard.dc.html:101
- **Literal source:** `lifts: ['lift-a', 'speed-1']` in the initial state object, Dashboard.dc.html:3153. ROWS is a 5-element literal array declared inside fitnessVals() at Dashboard.dc.html:3711-3717.
- **Asserts:** That this player has already completed two of the five workouts prescribed for them this week. Nobody measured it: `grep lifts` over the whole file hits only 3153, 3718, 3728 — nothing seeds it from window.__ATLAS_DATA__, and ryp-core has no table that could (queried orange-mountain-36415593: no lift/fitness/workout/speed/session/compliance table exists; the full 22-table list has no candidate).
- **Honest fix:** Seed `lifts: []` so the count starts at '0 of 5 logged', or render nothing until a real producer exists. Preferred: blank the badge entirely — with no persistence there is nothing true to say here.
- *(surface: fitness+clock)*

### Fitness screen, under 'This week's programming' — the footer row labelled COMPLIANCE THIS WEEK

- **Player reads:** COMPLIANCE THIS WEEK        2 OF 5 LOGGED
- **Binding:** liftCompliance — same binding, Dashboard.dc.html:3731; second render site at Dashboard.dc.html:1419. One fix covers both sites.
- **Literal source:** `lifts: ['lift-a', 'speed-1']`, Dashboard.dc.html:3153
- **Asserts:** Same fabricated count, here under an explicit 'compliance' label — i.e. an adherence score against a coach's prescription. Section guard is `isFitness` (Dashboard.dc.html:1395); 'fitness' is in PLAYER_ONLY and NOT in HIDDEN_FOR_PLAYER, so players see it and coaches do not. The `showFitnessScreen` sub-block guard opens at 1424, below this row — it hides only the 'Fitness screen' card, not the lift log or the compliance line.
- **Honest fix:** Same as the rail badge — count from an empty seed, or suppress the row until compliance has a producer.
- *(surface: fitness+clock)*

### Fitness screen, 'This week's programming' — the five-row session log, rows 1 and 3

- **Player reads:** Row 1: [✓] Lower push · hinge complex — LIFT — MON (filled blue tick, text greyed to #8d99a8 = done). Row 3: [✓] Flight School · Preflight — SPEED · 15M — TUE (same done styling). Rows 2, 4, 5 render unticked and bright.
- **Binding:** liftRows[].tick / tickBg / tickBorder / color — Dashboard.dc.html:3720-3729 (`const on = done.indexOf(r.k) > -1`); rendered at Dashboard.dc.html:1409-1415
- **Literal source:** `lifts: ['lift-a', 'speed-1']`, Dashboard.dc.html:3153 — the two ids name exactly these two rows in the ROWS literal at 3712 and 3714.
- **Asserts:** A more specific claim than the count: that this player did a lower-push/hinge lift on Monday and a Flight School Preflight speed session on Tuesday. There is no localStorage or sessionStorage anywhere in the file, so the state is memory-only and reseeds on every load: a player who unticks both rows to correct the record gets them back — and the rail re-asserts '2 OF 5 LOGGED' on every screen — as soon as the page reloads.
- **Honest fix:** `lifts: []`. Every row then renders unticked, which is the true statement ('not logged'), and the player's own taps this session remain honest until they reload.
- *(surface: fitness+clock)*

### This week · Practice / Play / Speed

- **Player reads:** Practice "3.5 of 5.0 hrs" with a 70%-filled gold bar; Play "4 of ~5 hrs" with an 80%-filled bar; Speed "2 of 3 this week" with 2 of 3 chips lit blue
- **Binding:** practiceRead/practiceBar/playReadWk/playBar/speedCount/speedChips — planVals(), proto/Dashboard.dc.html:3838-3847; rendered at proto/Dashboard.dc.html:2335, 2337, 2343, 2345, 2352, 2355 under the heading 'This week'
- **Literal source:** const logged = { practice: 3.5, play: 4, speed: 2 } — proto/Dashboard.dc.html:3799
- **Asserts:** Three separate measurements of what this player did this week — hours practised, hours played, speed sessions completed — plus three progress bars showing them most of the way to their floor. Nobody logged any of it. Confirmed by query: ryp-core has no practice-session, session-log or hours table in public, atlas or golf. The denominators ('of 5.0 hrs', 'of 3') are separately fabricated via s.tier (see the tier finding).
- **Honest fix:** Delete the `logged` literal. With no producer, the numerator side must render '—' and the bars must render at 0 width (or the whole 'This week' card must be withheld). 'Blank means not measured, not zero' — a 0% bar is the lesser evil, a dash is better.
- **Verifier note:** Only the line number: the literal is :3800, not :3799. Claim, visibility and source all confirmed as stated.
- *(surface: plan)*

### This week · Fitness

- **Player reads:** Fitness "1 of 2 this week" with 1 of 2 chips lit blue
- **Binding:** fitnessCount / fitnessChips — planVals(), proto/Dashboard.dc.html:3856-3860; rendered at proto/Dashboard.dc.html:2366 and 2369
- **Literal source:** fitnessCount is the bare string literal '1 of 2 this week' (proto/Dashboard.dc.html:3860) — it is not even derived from state; fitnessChips fills the first chip via a hardcoded `i < 1` (proto/Dashboard.dc.html:3856-3859)
- **Asserts:** That this player completed one of two programmed lifts this week. Nothing is logged, no lift table exists in ryp-core, and the literal is not conditioned on anything at all — it renders identically for every player forever.
- **Honest fix:** Blank the count and render both chips unfilled, or withhold the Fitness row of the 'This week' card until a lift log exists.
- **Verifier note:** Line drift to fix before the parent acts: fitnessCount is :3864 (auditor said 3860), fitnessChips is :3860-3863, and the sc-if guard is :2362 (auditor said 2363). Substance confirmed.
- *(surface: plan)*

### Today week-strip — practice hours logged

- **Player reads:** A gold progress bar filled to 70%, beside "70%" and "0.5 hrs to go"
- **Binding:** `weekPct` (:3372), `weekBar` (:3373), `weekVerdict` (:3375), `weekColor` (:3374) — all from `pct` (:3343), which is `logged / floor`.
- **Literal source:** `const logged = 3.5;` — Dashboard.dc.html:3342. A bare literal declared inside stakeVals itself, never read from anywhere.
- **Asserts:** That this player has logged 3.5 hours of practice this week, is at 70% of their requirement, and is 0.5 hours short of keeping their money. It is their practice history, stated as a number, and nothing measured it.
- **Honest fix:** Blank the bar, the percentage and the verdict. No producer: the SQL above finds no practice/session/hours/logged table or column in ryp-core. Blank means not measured, not zero — do not render 0%.
- *(surface: auto+stake+shell)*

### Today week-strip — assigned weekly floor

- **Player reads:** COMPLETED AT 4.0 OF 5.0 HRS · 80%
- **Binding:** `thresholdRead` — stakeVals(), Dashboard.dc.html:3377, via `floor` (:3341) ← `TIERS[s.tier].phases[s.phase]` (:3340).
- **Literal source:** `tier: 'builder', phase: 2` — Dashboard.dc.html:3151, resolving to TIERS.builder.phases[2].hrs = 5.0 at :3051.
- **Asserts:** That this player is on the Builder tier, in Phase 2, and owes 5.0 hours a week with a 4.0-hour threshold. Nobody assigned them a tier or a phase.
- **Honest fix:** NOT the already-fixed T-67 item — that blanked the rail label (`tierName: ''` at :6043) but left `tier: 'builder'` alive at :3151, and this is a surviving consumer of the same literal rendering real numbers at a different site. server/protoData.ts states there is no source: `tier: string /** Atlas curriculum tier. Not built. */`. Blank the threshold line, and audit the other `TIERS[s.tier]` readers for the same leftover.
- *(surface: auto+stake+shell)*

### Plan stake panel — miss allowance

- **Player reads:** 2 OF 2 DECLARED MISSES LEFT THIS PHASE
- **Binding:** `missesRead` — stakeVals(), Dashboard.dc.html:3370
- **Literal source:** `stake: { ... misses: 2 }` at :3126, plus the second hardcoded '2' inside the string at :3370.
- **Asserts:** That this player has a two-miss allowance in the current phase and has used none of it. Lowest harm of the set, because 2-of-2 reads as a fresh start rather than a fabricated history — but the allowance itself was never granted, and `declareMiss` (:3371) decrements browser-local state only.
- **Honest fix:** Blank alongside the rest of the stake block; it has no meaning without a real stake record.
- *(surface: auto+stake+shell)*

### Today prescription card — coach attribution and step number (STATIC, outside assigned range)

- **Player reads:** STEP 3 · SMOOTHIES & THE TEMPO LADDER  (left)   PRESCRIBED BY DR. BENOIT  (right)
- **Binding:** None — this is static HTML at Dashboard.dc.html:238-239, not a binding. Answering the lead directly: autoVals does NOT produce 'Work the smoothie down to five seconds' or 'Prescribed by Dr. Benoit'; autoVals only drives the separate Tomorrow card at :265-292.
- **Literal source:** The literal strings at :238 and :239. 'Dr. Benoit' is a real person in this file's own team roster — `{ k: 'luke', name: 'Dr. Luke Benoit', role: 'Method · swing construction', cred: 'PhD · PGA' }` at :3605.
- **Asserts:** That a named, real coach personally prescribed this drill to this player, and that the player has reached Step 3 of the build. Both are constants shown to every player. The drill body itself ('Work the smoothie down to five seconds', Feet together / 4 sets × 15 / Film 3 reps DTL) is Luke's curriculum and is NOT a fabrication — only the attribution and the step number are.
- **Honest fix:** Drop the 'Prescribed by Dr. Benoit' attribution and the 'Step 3 · ' prefix, leaving the curriculum text. Two caveats for the parent: (a) this is outside my assigned line ranges, so dedupe against whoever audits the today header; (b) it is adjacent to, but a different render site from, the T-67 'Step 3/5' zone badge already fixed.
- *(surface: auto+stake+shell)*

### Rail badge: CALENDAR · "6/6" — a practice week nobody logged

- **Player reads:** Rail nav row "Calendar" with the gold badge "6/6", visible on EVERY screen. (Note: the task lead reports "4/6" on the live page; that does not reproduce from the current file — trailing days are TODAY-6..TODAY = 20..26, SEED has minutes on 20,21,22,23,24,25 and nothing on 26, so a fresh load computes 6. Nothing patches `log` after mount — componentDidMount at :3734 only sets a clock interval and a resize listener, and there is no localStorage or fetch for the log anywhere in the file. Treat 4/6 as a stale or mid-session observation.)
- **Binding:** weekRead — proto/Dashboard.dc.html:6068, from weekDone at proto/Dashboard.dc.html:5956; rendered at proto/Dashboard.dc.html:81
- **Literal source:** const SEED = {...} at proto/Dashboard.dc.html:2823-2832 (22 hardcoded practice days), seeded as `log: SEED` at proto/Dashboard.dc.html:3084; TODAY = 26 literal at proto/Dashboard.dc.html:2821
- **Asserts:** That this player practised on six of the last seven days. No practice-log producer exists — ryp-core has no practice/session table at all (verified: the 22 tables are atlas.coaching_notes/intake_submissions/student_intake, golf.drill_progress/handicap_history/player_profile, and the public.* account tables), and the served page's own banner already lists "practice log" under "Empty, no producer app". This is the most-seen fabricated value in the app.
- **Honest fix:** `weekRead: ''` while `log` has no injected source (same treatment T-67 gave tierName and the four zone badges two rows away in the same rail).
- *(surface: rail+cal)*

### Calendar grid: 22 fabricated practice sessions under the player's name

- **Player reads:** A 31-cell July grid where 22 days carry logged work, e.g. day 1 "15m / C", day 4 "45m / L", day 11 "45m / P S", day 18 "60m / P", day 25 "45m / P F" — each with a coloured zone bar. Header "July 2026" (hardcoded; today is September 2026). Clicking any seeded day renders the right-hand panel as "July 25 · 45 minutes · Performance · Lift".
- **Binding:** cells — proto/Dashboard.dc.html:5926-5945 (via this.daySegs / this.dayLoad at :3684-3707); selSummary — proto/Dashboard.dc.html:6100. Rendered at proto/Dashboard.dc.html:897-918 (grid) and :932-933 (day panel); month header literal at :883.
- **Literal source:** const SEED at proto/Dashboard.dc.html:2823-2832, seeded as `log: SEED` at proto/Dashboard.dc.html:3084
- **Asserts:** A complete month of practice history — dates, durations and which zone each session belonged to — for a player who has logged nothing. Worse than a single bad number: it is a falsified record, and the screen's own copy tells the player "the record is what your coach reads before he reads your swing" (:878).
- **Honest fix:** Seed `log` from __ATLAS_DATA__ (`log: (window.__ATLAS_DATA__ && window.__ATLAS_DATA__.me || {}).log || {}`) so it is empty until a producer exists — an empty grid is correct and the day panel already has honest empty copy ("Nothing logged. Log it honestly, even a zero."). Second half of the fix: the "July 2026" / "July {{ selDay }}" literals at :883 and :932 must go too, or an empty September calendar is still labelled July.
- *(surface: rail+cal)*

### Today screen: "Standard met — 6 of 7 days." + the seven-day dot strip

- **Player reads:** Under "Last seven days": headline "Standard met — 6 of 7 days.", and a seven-box strip (Mon..Sun) with six gold practice dots and green workout dots filled in. [CROSS-SURFACE: computed inside my range but rendered in the TODAY section — dedup against the 'today' auditor.]
- **Binding:** weekHeadline — proto/Dashboard.dc.html:6093; weekStrip — proto/Dashboard.dc.html:5957-5967, returned :6094. Rendered at proto/Dashboard.dc.html:313 and :316-323.
- **Literal source:** const SEED at proto/Dashboard.dc.html:2823-2832 via weekDone at :5956
- **Asserts:** Tells the player they met the programme's weekly standard, and shows which specific days they practised and worked out. Congratulation on unmeasured work is the same class as T-52's "Day 41 of 90".
- **Honest fix:** Resolves with the SEED fix (empty log → "0 of 6 days in.", empty dots). If SEED stays for now, blank weekHeadline. The paragraph beneath it ("The standard is six days out of seven...") is curriculum copy and stays.
- *(surface: rail+cal)*

### Calendar prescription: ghost bars and "Programmed by Coach Phil" off the literal tier 'builder' / phase 2

- **Player reads:** Every calendar cell carries a dashed "Planned" ghost bar sized to a prescribed volume. The selected-day panel reads "Assignment — 0 of 2 completed" above two tappable rows: "30 minutes · Construction / Tap when it is done" and "Speed / Programmed by Coach Phil".
- **Binding:** plannedMins / plannedZone / plannedWork — proto/Dashboard.dc.html:3643-3681; consumed at :5941 (cells ghostW/ghostShow) and in the assignments IIFE at :6102-6139. Rendered at proto/Dashboard.dc.html:918 (ghost bar), :937 (assignRead) and :940-947 (assignment rows).
- **Literal source:** `tier: 'builder', phase: 2` at proto/Dashboard.dc.html:3151, indexed into the TIERS literal at :3045-3057 (builder phase 2 week array)
- **Asserts:** That THIS player is on the Builder tier in Construction Primary, and that their week prescribes 30 minutes of Construction on Sunday plus a Speed session "Programmed by Coach Phil" — naming a real coach as the author of a prescription nobody wrote. Same root literal T-67 already blanked one row above in the rail (`tierName`), still live here. The TIERS curriculum content itself is Luke's and is real; asserting this player's membership in it is not.
- **Honest fix:** Gate on a real tier: when `tier` is not injected, return null/0 from plannedZone/plannedMins/plannedWork so `ghostShow` is 'none', `assignments` is empty and the honest "Rest day. Nothing is assigned" fallback at :949 shows. Do not substitute a default tier.
- *(surface: rail+cal)*

### Rail badge: FITNESS · "2 of 5 logged"

- **Player reads:** Rail nav row "Fitness" with the badge "2 of 5 logged" (blue), visible on EVERY screen
- **Binding:** liftCompliance — proto/Dashboard.dc.html:3731 (fitnessVals); rendered at proto/Dashboard.dc.html:103
- **Literal source:** `lifts: ['lift-a', 'speed-1']` at proto/Dashboard.dc.html:3153, counted against the 5-row ROWS literal at :3711-3717
- **Asserts:** That this player has completed two of their five prescribed fitness sessions this week. Nothing records fitness compliance — the row list is a literal and the two "done" keys are a literal. Fresh-load state, not player input.
- **Honest fix:** Seed `lifts: []` (and blank the badge until a producer exists). The five ROWS are curriculum and can stay as unticked prescriptions only once the tier they imply is real — see the tier finding.
- **Verifier note:** Confirmed. Cite fix: the rail renders it at :101, not :103. There is a second render at :1419 (the Fitness screen, also player-visible) that their finding does not mention — same binding, same literal, so it is the same defect and falls out with the same fix.
- *(surface: rail+cal)*

### Forge session index rows — values and the "Logged" tag

- **Player reads:** Four rows under "Eighty shots. Four indices. One number.": "01 Chipping Index · 20 shots" with "+1.2" / "Plays to +3.0" / tag "LOGGED"; likewise 02 Putting "+0.6 / Plays to 2.0 / LOGGED", 03 Approach "-1.0 / Plays to 8.0 / LOGGED", 04 Driving "-2.7 / Plays to 14.0 / PRIMARY LEAK".
- **Binding:** forgeDrills[].value / .sub / .color / .barW / .barLeft / .tag / .tagColor, proto/Dashboard.dc.html:3502-3512; rendered proto/Dashboard.dc.html:1857-1880
- **Literal source:** d[x.k] — state.forge.driving/approach/chipping/putting at proto/Dashboard.dc.html:3129; the tag comes from `leak`, itself the max of those four literals
- **Asserts:** Two claims. The numbers assert an index score for each of the four Forge drills. The tag is worse: "LOGGED" states that this player has RUN that index, on a screen whose whole premise is that you run the session once a quarter — it is a progress claim, not a metric. A player who has never opened Atlas sees all four indices marked Logged and Driving marked Primary leak.
- **Honest fix:** value/sub blank, zero-width bar, and tag '' for every row (blank, not 'Not run' — the row already reads as un-run when empty). The step numbers, drill names, shot counts and notes are Luke's curriculum and stay. .onClick is real behaviour and stays.
- **Verifier note:** Confirmed on both halves. The tag is the worse of the two — it is a progress claim, not a metric. Their read of the onClick (3496-3503) as real behaviour is correct: it only mutates `session`.
- *(surface: forge)*

### Course simulation history

- **Player reads:** "VIRTUAL ROUND · 4 LOGGED"; four bars — "+4 / Jun 14 / 3 MECHANICAL LEAKS", "+3 / Jun 28 / 2 MECHANICAL LEAKS", "+3 / Jul 09 / ZERO MECHANICS", "+1 / Jul 21 / ZERO MECHANICS"; "ROUND AVERAGE +2.8"; "MECHANICAL LEAK RATE 7%".
- **Binding:** simRounds / simCount / simAvg / simLeakPct, proto/Dashboard.dc.html:3572-3586; rendered proto/Dashboard.dc.html:2034-2055
- **Literal source:** state.forge.sim — the four dated entries at proto/Dashboard.dc.html:3133-3138
- **Asserts:** A dated four-round practice history with per-round scores and mechanical-leak counts, an average, and a leak rate. Dates in the past attached to a named player are the most concrete possible fabrication — the player is told they played on 14 June. The one honest path exists (line 5378 appends a round the player logs this session), which makes this worse, not better: a real fifth round lands on top of four invented ones and is averaged with them.
- **Honest fix:** Seed state.forge.sim as []. simCount then reads 'Virtual round · 0 logged', the bars vanish, simAvg and simLeakPct render '—' (they currently divide by Math.max(1, len), which would print '+0.0' and '0%' on an empty array — guard those to '—' so zero rounds is not reported as zero strokes over par).
- **Verifier note:** Confirmed. Binding range is 3574-3586. Their divide-by-Math.max(1,...) guard note is correct — I read 3582 and 3586. Also dead seed data to clean up at 3139: `simAvg: 2.8, simLeakPct: 12`, shadowed by the computed keys and read by nothing.
- *(surface: forge)*

### Challenge mode

- **Player reads:** "CHALLENGE MODE" / "LEVEL 2" / "-3" at 40px, with a marker positioned on a Lose +5 … Win −5 track.
- **Binding:** challengeScore / challengePos / challengeColor / challengeLevel, proto/Dashboard.dc.html:3587-3590; rendered proto/Dashboard.dc.html:2091-2095
- **Literal source:** state.forge.challenge -3 and state.forge.level 2 at proto/Dashboard.dc.html:3131
- **Asserts:** That this player has reached Level 2 and currently stands at −3, two strokes from levelling up. Same class as the T-67 'Step 3/5' badge — a standing in a ladder nobody recorded. Nothing writes challenge or level; grep shows state.forge has exactly one writer (5378, sim only).
- **Honest fix:** challengeScore '—', challengeLevel blank, no marker on the track. The 'No fixed shot count…' copy below is instructional and stays.
- **Verifier note:** Confirmed exactly as stated, including the grep claim.
- *(surface: forge)*

### Last run · 21 Jul · Q3 baseline

- **Player reads:** "LAST RUN" / "21 Jul · Q3 baseline", in the header card of the Transfer zone directly beside the "Start Forge session" button.
- **Binding:** none — it is static template text at proto/Dashboard.dc.html:1970, not a binding (flagging it because it sits inside the forge surface and is the caption the four fabricated index rows below it hang off)
- **Literal source:** the string literal "21 Jul · Q3 baseline" hardcoded at proto/Dashboard.dc.html:1970
- **Asserts:** That this player last ran a Forge session on 21 July and that it was their Q3 baseline. It is the date that makes the four 'LOGGED' index rows beneath it read as a real session. Because it is markup rather than a binding, a fix to forgeVals will not touch it — it needs its own edit, and it will otherwise survive every other fix on this list.
- **Honest fix:** Replace with a binding that reads a real last-run timestamp, or delete the 'Last run' label and date entirely, leaving the Start Forge session button. No producer exists today (no forge/session table in ryp-core), so deletion is the correct move now.
- **Verifier note:** Confirmed with two corrections. (1) The line is 1844, not 1970. (2) There is a SECOND copy they missed: `ccDate: '21 Jul · Q3 baseline'` at 5637, rendered at 2198 in the 'Send-to-player card' inside isPerf. Their stated fix touches neither location correctly — both need deleting.
- *(surface: forge)*

### Prescription header, 'one thing today' card

- **Player reads:** STEP 3 · SMOOTHIES & THE TEMPO LADDER  (with 'PRESCRIBED BY DR. BENOIT' opposite)
- **Binding:** Static markup, not a binding — proto/Dashboard.dc.html:238 (and :239), inside the `isToday` guard
- **Literal source:** Hardcoded in the HTML at proto/Dashboard.dc.html:238. Nothing reads the player's actual build position; the neighbouring step state (`openStep: 3`, `signed: [1,2]` at :3149) is itself literal.
- **Asserts:** That this player is on Step 3 of the Construction build, and that Step 3 work is what is prescribed for them today. This is the same class as T-67's 'Step 3/5' zone badge but a different, unfixed instance — that one was a computed badge off `signed:[1,2]`, this one is raw markup on the main prescription card. The card's body ('Hold the ground-force pattern you earned in Step 2') compounds it by asserting the player already earned Step 2. The drill content itself ('Work the smoothie down to five seconds', constraint/volume/checkpoint) is Luke's curriculum and is fine — it is the 'Step 3' positioning and the 'you earned in Step 2' that claim progress.
- **Honest fix:** The step number must come from the player's real build position, or the card must carry no step number at all. 'Prescribed by Dr. Benoit' is product attribution, not a claim about the player — leave it.
- *(surface: session)*

### Rail nav badge on 'Fitness'

- **Player reads:** 2 OF 5 LOGGED
- **Binding:** liftCompliance — computed in fitnessVals() at /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html:3731 (`done.length + ' of ' + ROWS.length + ' logged'`), rendered in the rail at proto/Dashboard.dc.html:101 and again on the fitness screen at :1419
- **Literal source:** `lifts: ['lift-a', 'speed-1']` — initial state literal at proto/Dashboard.dc.html:3150. `done = s.lifts` (:3719), so done.length is 2 from nothing; ROWS is the 5-item curriculum array at :3711-3717 (real product content, fine as the denominator).
- **Asserts:** That this player has completed 2 of their 5 prescribed weekly gym/speed sessions — specifically the Monday lower-push lift and the Tuesday Flight School speed block, which also render pre-ticked in the fitness list. Nobody measured this: no workout/fitness log table exists in ryp-core (full table listing queried today — atlas.coaching_notes, atlas.intake_submissions, atlas.student_intake, golf.drill_progress, golf.handicap_history, golf.player_profile, and public.* account tables; no fitness or session log anywhere), and nothing on the server injects one.
- **Honest fix:** Blank badge, and no pre-ticked rows. A compliance count needs a fitness-log producer; until one exists, 0 ticks and no count. Shared render — the computing method fitnessVals() belongs to the 'fitness' surface; dedupe with that auditor.
- *(surface: profile)*

### Rail nav badge on 'Calendar'

- **Player reads:** 6/6
- **Binding:** weekRead — computed in renderVals() at /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html:6068 (`weekDone + '/6'`), off `weekDone` at :5956, rendered at proto/Dashboard.dc.html:81
- **Literal source:** `log: SEED` (:3084) where SEED is a 22-day fictional practice log at proto/Dashboard.dc.html:2823-2833, plus `TODAY = 26`, a hardcoded day-of-month at :2821. trailing = [20..26]; SEED has minutes on 20,21,22,23,24,25 → weekDone = 6.
- **Asserts:** That this player practised on 6 of the last 7 days and has met the weekly standard. Nothing measured it: there is no practice-log table in ryp-core (verified by full table listing today) and the server injects no log. Two independent fabrication vectors — the log is invented AND the seven-day window is computed from the hardcoded TODAY=26 rather than the real date (today is the 16th), so even against a real log the window would be fiction.
- **Honest fix:** Blank badge until a practice-log producer exists, and the window must derive from the real date, not a constant. Shared render — SEED also drives the whole 'cal' screen (streak, pDays, wDays, mins, weekHeadline at :6093); dedupe with the cal/today auditor.
- *(surface: profile)*

## Cosmetic (2)

### Fitness screen, session log — the right-hand day column on each of the five rows

- **Player reads:** MON / THU / TUE / THU / SUN (one per row)
- **Binding:** liftRows[].day — Dashboard.dc.html:3722, from `r.day`; rendered at Dashboard.dc.html:1414
- **Literal source:** the `day:` keys of the ROWS literal inside fitnessVals(), Dashboard.dc.html:3712-3716
- **Asserts:** That this player's week is scheduled on those specific days. Borderline — the parent may wave this off in five seconds. The discriminator: `name` and `kind` ('Speed · 15m') are properties of a DRILL and are Luke's curriculum; a day is not a property of a drill, only of a schedule, and nothing schedules these. No producer exists (same DB check as above).
- **Honest fix:** Drop the day column, or keep it only once a real weekly schedule exists. Lowest priority of the four.
- *(surface: fitness+clock)*

### Rail 'Target handicap' slider thumb (low priority)

- **Player reads:** Thumb seated at the midpoint of a -6..30 track, i.e. reading as ~12, while the label above it correctly reads '—' and the note below reads 'No target set. Set one and every benchmark on this page reads against it.'
- **Binding:** targetRaw — buildTarget() at /Users/makelmackbee/dev/ATR/atlas/proto/Dashboard.dc.html:5391-5393 (`const t = this.state.targetHcp === undefined ? NaN : this.state.targetHcp; ... targetRaw: t`), rendered at proto/Dashboard.dc.html:132 as `<input type="range" min="-6" max="30" step="1" value="{{ targetRaw }}">`
- **Literal source:** No literal — the NaN comes from the honest 'unset' guard. The rendered position comes from the browser's own fallback for an invalid range value (midpoint of min/max), i.e. from the markup's min=-6/max=30 attributes at :132.
- **Asserts:** Weakly implies a target handicap of ~12 for a player who has set none. All three text bindings beside it stay honest ('—', 'No target set'), so the numeric claim is only positional — this is the mildest item here and is listed for completeness, not as a peer of the three above.
- **Honest fix:** Give the slider an explicit unset presentation (e.g. hide the thumb or gray the track while targetHcp is undefined) rather than letting the browser seat it at the midpoint. Low priority; do not let it displace the three above.
- *(surface: profile)*

## What the verifiers found that the auditors missed

### fitness+clock

ONE MISS, in their clean list — and it is a gap in what they checked, not a disagreement about what they found.

`clockZoneLabel` / the zone carried into `lastSession` — Dashboard.dc.html:3769, 3763, 3773, 3789. They cleared this by proving the `'Construction'` FALLBACK at 3763 (`cur ? cur.label : 'Construction'`) is unreachable inside the `clockRunning` guard. That is true — I confirmed `c.zone` is only ever set to a ZONES key — and it is the wrong thing to have checked. 'Construction' reaches the screen by the REACHABLE path, through `cur.label`, because `startClock` at 3769 seeds `zone: 'construction'` from a literal. Confirmed consequences, all read in the file:
  - :207 renders 'In {{ clockZoneLabel }}' → 'In Construction' from the instant the player taps Clock in, having selected nothing — while the adjacent copy at :226 says 'Select the Zone and track your hours of practice', implying they do the selecting.
  - The Construction chip renders selected at :211-215 (`on = c && c.zone === z.k`, 3776), and `zoneChips.onClick` returns early on `c.zone === z.k` (3783), so no unselected state is reachable.
  - `stopClock` (3773) carries the literal into `lastSession: { mins: total, zone: c.zone }`, which :231 renders via `lastRead` (3789) as e.g. 'X MIN LOGGED · CONSTRUCTION'. A player who practises 45 minutes of putting without ever tapping a chip is shown a record saying they practised Construction.
Same shape as T-59's 'Right-handed' printed for a NULL handedness: a literal default rendered as the player's own attribute. Honest caveats for the parent to weigh: it follows the player's own tap, it is corrigible in one tap during the session, and it never persists (grep confirms 0 localStorage/sessionStorage). So it is weaker than the four confirmed above — but it is a literal-sourced claim about what this player did, and the audit's clean list asserts the clock is 'clean end to end', which it is not.

Everything else in their clean list checks out on my own reads: `clockRead` (3754-3756, from `s.now - c.start`, ticked by the 1s interval at 3736); `clockOverrun` (3758, `secs > 5400`); `hasLast`/`lastRead` gated on `lastSession: null` at 3152, set only by stopClock — I grepped `clock:|lastSession` and the only seeds are 3152, 3769, 3773, 3785, so nothing renders at :231 until the player clocks out this session; `clockBlocks` (3764-3767) is genuinely dead — grep for the name across the whole file returns only the definition, no render site. Minor: `zoneChips[].note` (3778) is also computed-but-unrendered — :212 renders only `z.label` — so the note strings never reach a screen at all.

OUT OF RANGE, adding one to their list for whoever audits the markup: alongside their 'Coach Phil · Coach Reyes' (:1397) and 'This week's programming … Coach Phil' (:1403-1404), line :237 renders the static string 'Prescribed by Dr. Benoit' inside the `isToday` section, which I confirmed is player-visible ('today' is in PLAYER_ONLY, absent from HIDDEN_FOR_PLAYER). A third named practitioner attributing this player's prescription to someone nobody recorded. Static markup with no binding, so like theirs it does not fit this schema — noted for the markup pass, not reported as a binding fabrication.

### forge

Three fabrications render inside the forge surface that the audit did not report. All three are BOUND just outside 3381-3593 (at 5517, 5624 and 5748) but RENDER inside `isTransfer`/`isPerf`, so they are in scope by the auditor's own standard — they went outside the range themselves for finding 12, and their coverage note asserts the surface is fully covered. I have named both the binding and the render line so the parent knows where to edit.

1. THE INDEX-HISTORY TREND CHART — and it refutes their clean list. They cleared `trendEmptyShow` at 1957 as "the correct pattern and what the rest of this surface should look like when unmeasured." That empty state is UNREACHABLE. `buildTrend` (5517) does `const H = this.state.forge.history || []`, and `history` is the four literal quarters at 3140-3145 (Oct/Jan/Apr/Jul, with driving 19.0→14.0, approach 11.5→8.0, chipping 1.0→-3.0, putting 4.5→2.0). Nothing ever writes `history` — the only writer of `state.forge` is 5378, which touches `sim`. So `H.length === 4` always, `trendEmptyShow` is permanently `'none'` (5533) and `trendShow` permanently `'block'` (5532). What actually renders at 1934-1956 inside `isTransfer` is a four-point quarterly strokes-gained trend: four facet polylines (1943-1945), the quarter labels Oct/Jan/Apr/Jul (1949-1951), the axis extremes {{ trendHi }}/{{ trendLo }} (1936), and a zero line captioned "level with your target handicap" (1955) — computed against the same `? 5` fallback at 5525. A player who has never run a Forge session is shown four quarters of improvement. Their one cited example of the honest pattern is the one thing on this screen that never fires. Fix: seed `history: []`, which then makes 1957 render for real.

2. THE CHALLENGE LADDER — the T-67 'Step 3/5' bug, unfixed. `buildLadder` at 5748 reads `const cleared = this.state.levels || { chipping: 2, putting: 1, approach: 1, driving: 1 }`. I grepped `levels` across the whole file: it appears at 5748 and in unrelated prose at 2760. `state.levels` is never seeded and never written, so `cleared` is ALWAYS that literal. It renders via `ladderRows` (5761) at 1885-1930 inside `isTransfer`, directly beneath the four fabricated Forge index rows: "Chipping · L2" (the `at` field), "Average 0 or better over your last five to reach L3" (`next`), a positioned "Next → ≈ 10 hcp" arrow at `(cleared-0.5)/4*100%` (`arrowLeft`/`arrowTo`, rendered 1897-1901), and four rung chips coloured by whether they are cleared, held or locked (`bg`/`color`/`border`). That is a standing in a ladder nobody recorded, plus a prescription ("your last five") for sessions nobody logged — the same class as the 'Step 3/5' badge and the Plotted/Active/Locked zone badges fixed in T-67. The rung names, the AVG bands and the HCP anchors are Luke's curriculum and stay; `cleared` is the fabrication. Fix: `cleared` must come from a producer or the L-marker, arrow and per-rung state must render neutral.

3. THE "SEND-TO-PLAYER CARD" — an entire panel, missed. `buildCoachCard` (5624-5655) rebuilds the composite from the same literals (`const composite = +(d.driving*0.30 + ... ).toFixed(1)` at 5632) against the same `? 5` fallback (5625), and renders at 2195-2231 inside `isPerf` under the heading "Send-to-player card" with the subtitle "Save as image · fits a text message" (2192-2193). It carries: `ccComposite` at 66px labelled "Strokes gained · per round" (2202-2203), `ccCompositeSub` "Plays to 7.0" (2204), `ccTarget` (2208), four `ccRows` with per-facet SG and "Plays to …" subtitles (2212-2225), `ccLeak` → "Primary leak · Driving" (2228), and `ccPrescription` — a hardcoded prescription string, "Corridor work off the tee, three range sessions a week, called shape on every fifth ball." (5652-5654, rendered 2229) — plus the second `ccDate` "21 Jul · Q3 baseline" (5637 → 2198). This is the worst of the three by consequence: it is explicitly designed to be rasterised (`data-om-raster="true"` at 2195) and sent to someone as a record of that player's game. Fixing `forgeVals` leaves it completely untouched.

Everything else on their clean list I checked and agree with. `vrCourseName` (5286) is genuinely honest — `course` resolves from `V.courseId` with no default (5270) and `state.vr` seeds no courseId, so an untouched session reads 'No course selected'. The BENCH/targetFor (3431-3440), ANCH/hcpFor (3443-3452), axis (3453), sgTarget (3440, 3480) and sgBenchmarks (3487-3493) are standards a player is measured against, not measurements of them. The DRILLS (3412-3417) and SG situation names/notes (3419-3426) are curriculum. pt/ring/R/CXY (3403-3410), the radar chrome (3557-3573), fmt (3393) and the shared helpers at 2984-2989 make no claim.

### plan

Four things, ranked.

1. STRONGEST — nobody owns it. `stepLadder`, `buildPct` and `buildRead` at proto/Dashboard.dc.html:6160-6174 derive from the SAME `s.ticked`/`s.signed` literals but sit outside this auditor's range (3794-4025), and outside the plan surface, so neither they nor any build auditor scoped to buildSteps will file them. They render on the player-visible build screen: `{{ buildRead }}` at :1005 prints "12 of 23 drills completed" (s.ticked.length = DONE's 12 keys, :2885) with `{{ buildPct }}` at :1004 driving a ~52%-filled gradient bar; `{{ stepLadder }}` at :988 prints per-step "Completed" / "Locked" / "n / m" states from the same literals. This is the whole-build progress headline — arguably the most prominent fabricated number on the build screen — and fixing buildSteps alone does not touch it. Same one-line seed fix (ticked/signed from me.drills, else []).

2. Line :1057, static markup: "Assigned by Dr. Benoit from your movement screen" — inside the hasVariants block, rendered whenever a step with variants is open on the player-visible build screen. A named coach + a movement screen the player does not have on file (fitnessScreen is in HIDDEN_FOR_PLAYER and has no producer). Not a binding, so it survives every seed change proposed above. The auditor cited the variantChips selection but not this line.

3. `requestSignOff` at :3897-3900 (inside my range, unreported) is a second, independent path to the same fabrication: it writes the step number into `signed` on a player click, which immediately makes :4009 render "Completed · Dr. Benoit". Seeding `signed: []` leaves this live — the player self-signs and the screen credits a coach. Filed as a correction on their sign-off finding, repeated here because it changes the fix.

4. Their clean list is otherwise sound and I am not padding it. I independently re-checked and agree with: `buildImpactOpp` (:3907-3934 — `impactOpp: []` at :3125, `d.std` from the IMPACT_OPP curriculum literal, nothing renders as done); the null-handling praise (floorRead :3839, playRead :3840, speedRead :3841, splitRead :3842 all render '—' or 'Not fixed' correctly, and `bar()` at :3801 guards divide-by-zero); `rebuild: false` at :3151 asserting nothing; `stakeAmountRead` (:3347) being a genuinely dead binding — I grepped, it has no render site, correctly withheld; the tier/phase catalog copy; and the prefilled scheduling times. Their `BASE = [2026, 7, 27]` note is also right to park on the bug board — I confirmed the date never reaches on-screen text.

One over-caution check I ran and cleared: `openStep: 3`, `lifts: ['lift-a','speed-1']` and `coachMode: false` are state literals in the same block that they did not report. `openStep` is accordion expansion state and `coachMode` is a view toggle — neither asserts anything about the player, so excluding them is correct. `lifts` I could not tie to a plan-surface render site and leave to whoever owns the fitness surface.

### profile

ONE MISSED ITEM, inside my assigned range, hedged honestly because it is markup copy rather than a computed binding.

**Handicap-history caption — proto/Dashboard.dc.html:501** reads, in italic directly beneath the six bars: "NA where they were not playing. Taller is lower."

Why it is a claim about the player, not neutral design copy: `hist` is UNCONDITIONALLY `{}` for every player. server/protoData.ts:77 documents it ("Always {} — see THE `hist` NOTE below"), :206 sets it in EMPTY_ROSTER_ROW, :1014 hardcodes `hist: {}` on the roster path, and `meRow` (:829-852) spreads EMPTY_ROSTER_ROW and never overrides it — `golf.handicap_history` is deliberately not queried (:861-862). So `pfHist` (:4650-4674) renders all six buckets as `value: 'NA'`, every time, for everyone. The caption then assigns those six blanks a cause: it tells a real golfer that at 3 months, 6 months, 1/3/5/10 years they were NOT PLAYING GOLF. Nobody measured that. It is the house rule exactly inverted — "blank means not measured, not zero" — and `pfHistNote`'s honest "No handicap on record." does not neutralize it, because that string renders in the right-aligned gold eyebrow at :485, at the top of the block, while the caption sits under the bars at :501 as the last word on them.

Hedge: this is static markup copy, so it is a copy fix and NOT a peer of the three confirmed badges. Fix: drop or condition the first sentence (e.g. "Taller is lower." alone, or "NA where no handicap is on record.").

TWO CLEAN CLAIMS OF THEIRS I RE-CHECKED AND CAN CONFIRM (offered so the parent does not re-spend the tokens):

1. `dnaTendencyPos: dna ? Math.max(0,Math.min(100,dna.tendency)) : 50` (:4557) is the same shape of trap as the slider — a midpoint fallback on an Engineer↔Artist line. I checked the markup rather than inferring it: the dot at :662 sits inside the `<div style="display: {{ dnaShow }}">` block opened at :633 and not closed before :670, and `dnaShow` is 'none' when dna is null (:4532). The `: 50` branch is unreachable on screen, and when dna exists `tendency` is a real scored value from server/dnaSummary.ts:322 carrying its own `tendencyProvisional` hedge (:325). Clean.

2. The rail METRIC block, which they called clean: I read it myself at :5387-5512 rather than taking it on their word. `railHcp` (:5445) — which they did NOT name — reads `__ATLAS_DATA__.me.target` with the state override and prints '—' when unknown; it renders twice, at :66 and in the mobile bar at :42, both under `showRailMetrics`. Honest. `railSG` '—' (:5447), `practiceHcp` '—' (:5408), `gapHcp` '—' + "Needs a practice index — no producer yet" (:5502-5504), `guaranteeRead`/`guaranteeBar` (:5477-5478), `realHcpNote` 'Not recorded' (:5462), and both steppers no-op on undefined (:5459-5460). All clean.

I also independently confirmed the rest of their clean list: `hist`, `profile` and `onboarding` are genuinely ABSENT from the initial state object (:3077-3155 read in full; they appear only in setState writers at :4160/:4771/:4798/:4803/:4829/:5222), so the self branches fall through to `who.*`; `handLabel` returns '' for null (protoData.ts:445-449) and `toHcp` returns null for empty (:455-459), so pfHand/pfHandicapReal/pfHandicapTarget cannot substitute; `pfCarry` is `${driverCarryYds} yd driver carry` or '' (:837); the profile markup :411-528 carries no hardcoded player value; and the ten-shot bindings (pfAware*, pfTestStatus*, pfRows, pfCells) appear nowhere but in the removal comments at :479-480 and :4702 — genuinely dead.

NOT REPORTED, deliberately: `golf.handicap_history` existing but unqueried is a missing feature, not a fabrication — I agree with their call. And I have left the `coachCards` entitlement panel and `teamVals`/`fitnessVals`/SEED ownership alone: those render on other surfaces and routing is not mine to assign.

### rail+cal

Three items, two of them errors in their clean list.

1. **Clean item (8) is wrong on a fresh load: the day panel opens asserting the wrong date as "today".** They cleared `selDay`/`selWeekday` as "derived from the day the player clicked" — but nothing is clicked on load. `sel: TODAY` is the literal 26 (:3084, TODAY=26 at :2821), so `selWeekday` (:6099) = `DOWS[(3+26-1)%7]` = DOWS[0] = 'Sun', plus ' · today' because `sel === TODAY`, and the panel header at :932 prints the literal "July " + selDay. A player opening Calendar on 2026-09-16 (a Wednesday) is told **"Sun · today"** over **"July 26"**. That is a literal-sourced claim about the player's present, and it is the one piece of the calendar that does NOT fall out of emptying `log` — it needs `sel` bound to a real date and the "July" literals at :883 and :932 replaced. Their finding 3 put those literals in a fix note rather than making them a finding; with `log` empty the grid is still laid out and labelled for July (OFFSET=3 correctly places July 1 2026 on Wednesday), so an "empty calendar is honest" fix leaves a September player looking at July.

2. **Clean item (10)'s "the ladder itself is fine and its rungs are curriculum" is wrong.** `ladder` at :6087-6092 sets `bg: t >= s.tempo ? GOLD : 'rgba(200,160,94,0.16)'`, so with the literal `tempo: 6` the rungs 10s, 9s, 8s, 7s and 6s render filled gold and 5s→2s dim. The graphic asserts this player's descent to 6 independently of the headline sentence — blanking `tempoLabel` alone would leave the claim on screen in picture form. Same root literal as their finding 8, so it is one fix, not a new one; but it should not have been on the clean list.

3. Latent only, not a finding: `isRoster` at :6013 is `view === 'roster'` with no `&& !isHidden('roster')`, unlike every sibling section flag on that line and the ones around it. Unreachable today (a player's injected `view` is never 'roster' and `roster` is `[]`), but it is the one section whose gate does not honour the hidden list, and their clean item (5) reasons only about the nav row.

I found nothing else in :5883-6100 or the `isCal` section (:873-977) that they missed. `setSlots`/`setsRead`/`resetSets`/`todayLogLabel`/`minChips`/`clearDay`/`dows` are genuinely session-input or honest as they say; `blockChips`, `workChips`, `prescribedZone` and `prescribedShow` are genuinely dead (no `{{ }}` site); the rail header (:50-53), mobile bar (:24-45) and account chip (:171-174) carry no player claim beyond `railSG`/`railHcp`, which are honest.

### session

Nothing in 3183-3337 that they cleared is a fabrication — I read the whole range rather than grading their list, and sessionVals is genuinely clean. Every value traces to `S.tally` (starts [0,0,0,0,0] at :3127, moved only by the abacus add/sub handlers at :3324-3325), to `score`/`level`/`mode`/`chipLevel` (reset to 0 on every drill pick at :3216 and :3219), or to the DRILL_DEFS / CHIP_LEVELS / INDEX_GROUPS curriculum tables. Their `finishDriving` observation is correct and load-bearing: `if (!isAbacus || total >= 20)` at :3217 is what stops a half-logged driving index producing a number at :1817.

ONE GAP, flagged low-confidence — they cleared "SESSION_DOMAINS names/steps/shot-counts" and did not mention its `state` field. SESSION_DOMAINS at :2810-2813 carries `state: 'Next'` on chipping and `state: 'Queued'` on putting, approach and driving. These render through `roadmapRows` — `state: r.state` at :3297, with `stateColor: i === 0 ? '#c8a05e' : '#8d99a8'` at :3299 highlighting the first row gold. That is four bare status strings off a literal table, identical in kind to T-67's 'Plotted' / 'Active' / 'Locked' zone badges, rendering the same for every player forever. I rank it LOW and would not lead with it: unlike the zone badges it plausibly describes a fixed curriculum ordering (the session roadmap always starts at chipping) rather than asserting measured progress, and it names no number. Worth the parent's eye, not worth a fix on its own.

Two smaller notes, neither a finding:
- `chipLevel = S.chipLevel || 2` (:3200) — I chased this the same way they did and agree it is clean. CHIP_LEVELS[2].note at :2528 ("the standard index level — the one your baseline is set against") is curriculum describing the rung. But the `|| 2` does render the L2 chip pre-selected gold (:3283-3285) for a player who never chose, which reads softly as a level they were placed at. Cosmetic; mention only.
- Non-abacus drills have no equivalent of the `total >= 20` guard at :3217, so a player who taps "Save index" without touching the +/− steppers gets "0" printed as their index at :1817. That is their own affirmative save, so I do not call it fabricated — but it is the "blank means not measured, not zero" boundary and belongs to whoever owns the save path.

Outside my range, confirming their hand-off note rather than claiming it: `railMetrics` is in HIDDEN_FOR_COACH but NOT in HIDDEN_FOR_PLAYER (protoData.ts:266-271), so `guaranteeRead` / `guaranteeBar` at :166-167 DO render for players. Whoever audits the rail needs that; I did not trace their sources.

### team

CONFIRMED MISS, inside the assigned 3594-3708 range: `daySegs(e)` (:3684-3693) and `dayLoad(e)` (:3697-3707) render a fabricated 22-day PRACTICE HISTORY for the player.

The auditor parked these under "NOT VERIFIED, needs the cal/plan owner" and guessed their input was `TIERS[this.state.tier]`. That guess is wrong, which is why it stayed unreported — neither helper touches tier or phase. Their input is `e`, and I traced it: :5929 `const e = log[d] || {}`, :3084 `log: SEED`, and SEED is a hardcoded literal at :2823-2833 — 22 seeded days: `1:{m:15,b:'Construction'}, 2:{m:30,b:'Construction',w:'Lift'}, 4:{m:45,b:'Calibration'}, 11:{m:45,b:'Performance',w:'Speed'}, 18:{m:60,b:'Performance'}, 25:{m:45,b:'Performance',w:'Lift'}` and so on.

Rendered, player-visible: cells is built at :5926-5942 and bound at :6097, rendered at :901-914 inside `<sc-if value="{{ isCal }}">`. `cal` is in PLAYER_ONLY (protoData.ts:264) and absent from HIDDEN_FOR_PLAYER, so isCal (:6002) is live for a player. The player reads `{{ c.mins }}` at :905 ('45m', '60m', '15m' per day from dayLoad), the per-zone letter tags from ZONE_LETTER, and the colored segment bars `{{ sg.bg }}` / `{{ sg.w }}` at :914 from daySegs. Downstream at :5946-5949 the same SEED is reduced into practice-day and total-minute counts.

That is a month of practice sessions — how long, what kind, which days — asserted about a real person who logged none of it. Same class as T-52's 'Day 41 of 90'. Note `log` IS player-mutable this session (:5081-5085 entry/pick → setState), so a day the player edits themselves is legitimately theirs; the defect is the 22 pre-filled days present on first paint. Fix shape: seed `log: {}` and let the grid render empty — blank means not measured.

STRENGTHENED, not a miss: plannedZone (:3644), plannedWork (:3658), plannedMins (:3668). The auditor explicitly wrote "do not treat them as cleared", so this is not an omission — but I traced the render sites they did not. They ARE player-visible and ARE literal-derived: plannedMins feeds `ghostW` and `ghostShow` at :5940-5941 (the prescription ghost bar behind each cal cell), and plannedZone feeds `prescribedZone` / `prescribedShow` at :6152-6153 plus the zone-chip `want` highlight at :6142. All read `TIERS[this.state.tier].phases[this.state.phase]` with BOTH `tier:'builder'` and `phase:2` still literal at :3151. Player-visible via isCal. Parent can treat these as confirmed literal-sourced without a second pass.

Their clean list otherwise holds, checked independently: `hasBanked` (:3622) is genuinely inert — grep across the whole file returns only the assignment at :3622, no render. `c.border`/`c.opacity`/`p.bg`/`p.border`/`c.ctaBg` are color derivations of values already reported. The :2458 explainer and the :2431-2433 headings are product-policy and design copy making no claim about this specific player — correctly excluded under the stated rule, and I would not relitigate it.

Their ROOT CAUSE line is right and worth passing up verbatim: T-67 blanked the tier at the render (`tierName: ''`, :6043) and left the seed alive at :3151, so teamVals() still keys off it. But note the root cause does NOT cover everything on these surfaces — the SEED practice log at :2823 is a second, independent literal source, so fixing :3151 alone would leave the fabricated month standing.

