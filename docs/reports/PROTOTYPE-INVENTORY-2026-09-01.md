# Prototype inventory — 1 Sep 2026

Machine-extracted from the three vendored prototypes, each claim carrying a file:line the reader
actually opened. Three independent readers; the reconciliation step died twice to connection
drops, so **this is raw inventory, not a plan**. Totals are the readers' own counts.

## AtlasPlayer.dc.html

**17 screens · 181 fields · 46 hardcoded data objects**

> This is the Forge shot-capture engine renamed and absorbed into Atlas as Zones 01–04: a 460px offline-first PWA (line 1038 preview 460x900, service worker 1435, wake-lock 1562) that logs 80 shots across four indices plus a 30-shot short-game assessment entirely to localStorage under KEY='atlas.player.v3' (1044) while purging atlas.forge.v1/v2/v3 (1045), computes every displayed number client-side, has zero network I/O other than 'sync' being a bare setState (2571), and labels its own hero metric 'Sample data' (325) sourced 'Q3 baseline · 21 Jul' (1979) until the player logs something real — the belief that it is the Forge front-end is CONFIRMED by the migration keys plus the orphaned handler goForgeTab: this.leave('forge') (2377), which points at a tab key absent from TABS (1223-1229) and is bound nowhere in the template.

| field source | count |
| --- | --- |
| FORGE | 124 |
| computed-in-page | 41 |
| unknown | 10 |
| golf-profile | 7 |
| coach-relationship | 5 |
| DEBRIEF | 1 |

<details><summary>screens</summary>

- **App shell (persistent header + bottom nav)** (L29) — Chrome rendered around every screen: brand mark, sync dot, handicap chip that opens Profile, and the five-tab Zone nav (hidden unless state.screen is one of the TABS keys, navShow line 1024). · 4 fields
- **intro** (L47) — Zone 00 Baseline setup — first-run onboarding. Four domain-interest checkboxes and two steppers (handicap, driver carry), then route to the short game assessment or skip. Gate onIntro line 2137. · 5 fields
- **transfer** (L91) — Zone 03 Transfer — the Forge session launcher plus the practice-log calendar. TWO <sc-if> blocks share the same onTransfer gate (91 and 372) and render together as one screen. Gate onTransfer line 2293. · 12 fields
- **calibrate** (L128) — Zone 02 Calibration — chipping tolerance tier readout, launch-monitor CSV/TSV import with a client-side strokes-gained + bias model, and putting-model status. Gate onCalibrate line 2295. · 15 fields
- **profile** (L205) — Player profile sheet reached from the header chip — the two identity numbers plus last-recorded test conditions and a PWA install prompt. Gate onProfile line 2072. · 3 fields
- **perform** (L242) — Zone 04 Performance — a pure placeholder. Renders 'In development' and a five-bullet list of what Debrief will cover; no data, no controls. Gate onPerform line 2296. · 1 fields
- **home (Today)** (L269) — The default landing screen (state.screen starts 'home', line 1370). Renders the 5-axis Practice DNA radar, the transfer-gap hero, four strokes-gained domain rows, and a weighted weekly practice recommendation. Gate onToday line 2293. · 28 fields
- **domain** (L421) — Domain deep dive, opened by tapping a Today stat row. Shows SG vs handicap, index vs expected, last-run timer, what the index measures and a strong/weak read. Gate onDomain line 2315. · 11 fields
- **build** (L464) — Zone 01 Construction — a four-step coach-prescribed drill ladder with completion state and unlock conditions. Entirely hardcoded and suppressed until hasHistory (buildSteps line 2353). Gate onBuild line 2295. · 6 fields
- **coach** (L502) — Coach message thread, reached from the Today coach card. Three hardcoded messages, suppressed until hasHistory (messages line 2362). Gate onCoach line 2296. · 3 fields
- **roadmap** (L530) — Live Forge session roadmap — four index cards with per-index shot count, accumulated timer and logged value, plus the session total. Gate onRoadmap line 2364. · 9 fields
- **brief** (L564) — Pre-drill brief plus the mandatory conditions gate. Renders the drill rules then wind/firmness/speed/slope choosers, only those TEST_CONDS says this test is sensitive to; the Begin button stays dead until all required conditions are set. Gate onBrief line 2078. · 14 fields
- **capture** (L651) — The shot-logging surface — one screen with four mutually exclusive domain sub-views (showChip 716, showBuckets 753, showPutt 765, showDriving 787) plus a called-shape gate (showCall 701) and a drill-video overlay (drillOpen 677). Holds a wake lock while open (1581). Gate onCapture line 2365. · 31 fields
- **sga** (L820) — Short game assessment capture — six situations, five shots each, five point buttons. Does not feed the composite; it sets the chipping tolerance tier. Gate onSga line 2173. · 10 fields
- **sgaResult** (L880) — Short game assessment result — total vs a handicap-derived target, per-situation breakdown, strength/weakness, and the chipping tier it just set. Gate onSgaResult line 2173. · 9 fields
- **result** (L918) — Single-index result after saving 20 shots — value, verdict, per-domain stat block, and for putting a fitted make-rate curve (MLE over line dispersion k plus pace-hold rate q, lines 1312-1335, 1794-1832). showCurve (934) is a putting-only sub-view. Gate onResult line 2365. · 18 fields
- **complete** (L991) — Forge complete — weighted composite across whichever indices were logged, per-index SG rows, the primary leak, and a 'Send to Atlas' button that is a bare setState with no network call (sync, line 2571). Gate onComplete line 2366. · 9 fields

</details>

## Atlas.dc.html

**11 screens · 227 fields · 4 hardcoded data objects**

> An 11-view static marketing brochure for Atlas Golf with NO data layer at all: all 106 unique {{ }} bindings are navigation handlers, hex colors, CSS transforms, or local demo-widget state — not one renders a value belonging to a user, a coach, or a round. There are ZERO ALL-CAPS data constants in this file (verified across the whole script block, 804–930; DESIGNS.md reports 45 for AtlasPlayer.dc.html); the only three consts are function-locals holding marketing copy — phases (807), profiles (828), zones (844). The file contains exactly one <input> (a 0–2 range slider, 141), no <form>, no file input, only onClick/onChange handlers, and only three href attributes in the entire file (all Google Fonts, 11–13) — so every commercial CTA is an inert div: 'Take the Practice DNA Quiz' (236, and the site's primary closing CTA at 774 which routes to /coaching instead of any quiz), 'Get it on Amazon' (295), 'Read a free sample' (296), 'Coach directory & booking' (496), the four 'Start here' rungs (513–516), and all six price-ladder buttons (594–599). Its only genuine contact with the live schema is literal text: six prices ($99/$199/$299/$399/$399mo/$799mo, 594–599 → public.plans.price_cents) and a set of coach names (644–648, 656–658 → public.coach_profiles), all five coach bios reading 'Full bio coming soon.' FIELD SELECTION RULE: rows below are data a reader SEES; ~60 pure-styling bindings (col*, t*, z*Bg/Border, c*Color/Bg/Border, prof*Color/Bg/Border, f*Display/Sign) are deliberately excluded as CSS, not data.

| field source | count |
| --- | --- |
| static-content | 143 |
| static-content (const phases, 807) | 5 |
| static-content (const profiles, 828) | 5 |
| computed-in-page (local UI state, 795) | 4 |
| public.coach_profiles - BIO IS A STUB | 4 |
| unknown - UNFILLED ASSET PLACEHOLDER | 3 |
| FORGE - drill library | 3 |
| public.coach_profiles | 3 |
| static-content (const zones, 844) | 2 |
| public.plans - no plan code in file | 2 |

<details><summary>screens</summary>

- **Nav (persistent chrome)** (L29) — Sticky top bar on every page: wordmark, 8 in-page destinations, Log in, JOIN. · 9 fields
- **Home** (L46) — Marketing landing: hero, the four-domain flip cards, a proof-stat band, team teaser. · 17 fields
- **Map** (L111) — Interactive positioning model: a 2-axis map, a 3-step 'Seve' phase slider, and four zone dossiers. · 21 fields
- **Practice DNA** (L231) — Archetype explainer: a 4-axis radar toggled across three FIXED example archetypes, plus the three forces that shape practice. · 17 fields
- **The Book** (L286) — Product page for The Golf Textbook: pitch, 6-part TOC, 2 appendices, the Fosbury Flop chapter excerpt. · 20 fields
- **Research** (L351) — Evidence page: a 7-row false-prior comparison table, 4 research lines, a zone-neuroanatomy selector, 6 foundations. · 32 fields
- **Coaching** (L461) — The commercial page: service model, standards, inclusions, a 4-rung entry chooser, a FAKE dashboard preview with a click-to-plot dispersion widget, a 4-step progression, and a 6-tier price ladder. · 46 fields
- **The Team** (L611) — Roster page: a founder 'case file', 5 coaches, 3 faculty, and a 3-row results ledger explicitly labelled fake. · 25 fields
- **Vault** (L690) — Free deep-dive library index: three counters, five browse-by-zone groups, one featured study. · 12 fields
- **False Priors** (L722) — A claimed 20-item catalogue of false priors; only 14 are actually written, in 3 of 5 categories. · 22 fields
- **CTA + Footer** (L770) — Closing conversion band and footer, present on every page. · 6 fields

</details>

## Dashboard.dc.html

**15 screens · 392 fields · 59 hardcoded data objects**

> This is NOT a coach dashboard — it is the entire Atlas PLAYER app (12 rail-routed views at sc-if lines 125/277/357/479/538/644/834/1060/1492/1769/1899/2092 plus two phone-surface modals at 1132 and 1266) with a three-screen coach triad (Roster 479 → Player file 357 → Intake 277) grafted into the same shell; the rail carries a personal target-handicap slider (85), the signed-in player's name (117) and a hardcoded 'Day 41 of 90' guarantee bar (113–114, literal width:45.5%), and renderVals() spreads profileVals/intakeVals/rosterVals into every render regardless of view (4885–4889), which is exactly why the empty-value guards at 2560–2571 exist.

| field source | count |
| --- | --- |
| computed-in-page | 133 |
| unknown | 78 |
| STATIC-CONTENT | 70 |
| FORGE | 62 |
| atlas-intake | 15 |
| RED | 12 |
| identity | 8 |
| golf-profile | 7 |
| coach-relationship | 6 |

<details><summary>screens</summary>

- **Rail + mobile bar (persistent chrome, all views)** (L43) — Left navigation column on desktop / drawer under 900px, plus a sticky mobile header. Carries the reference handicap and total SG on every screen, the target-handicap slider, and a per-nav-item badge. · 30 fields
- **Today** (L125) — The one prescribed thing for today: stake/week compliance bar, a running practice clock with zone chips, the current build step card with set slots, an auto-generated session from the worst facet, the tempo ladder, and a 7-day strip. · 36 fields
- **Intake form** (L277) — A new player's own onboarding questionnaire on cream paper: six handicap-lookback fields, five free-text background questions, four self-estimate categories against the ten-shot video, and a completion %. · 13 fields
- **Player file (Profile)** (L357) — One roster row opened up, printed cream-on-dark as a dossier. Coach-readable (read-only) or the player's own (editable). Header identity + handicaps, the ten-shot intake test with estimate-vs-read scoring, a strike map, six-point handicap history, and the interview answers. · 27 fields
- **Roster (coach view)** (L479) — The coach's whole book on one screen, sorted by silence / least movement / furthest behind. One row per student; clicking a row opens that player's Player file. This is the only screen whose data literal has already been stripped and wired to ryp-core. · 16 fields
- **Calendar** (L538) — A 31-day July grid of logged practice minutes and workouts with a ghost bar showing the plan's prescription, month totals, and a day-detail editor with assignment tick-offs and minute chips. · 20 fields
- **01 Construction (The Build)** (L644) — The five-step swing-change workbook. A step ladder, per-step accordions with pivot variants and per-drill tick/verify state, an 'Impact opposites' range block, and a drill demo overlay. · 35 fields
- **02 Calibration (Evidence)** (L834) — Step 00 onboarding ten-shot test (watch-then-estimate, coach read, strike map), the launch-monitor club gapping ladder plus three derived reads, and three draggable dispersion plots (sand wedge / 7-iron / driver). · 33 fields
- **Fitness** (L1060) — This week's lift and speed programming with tick-off compliance, the four-weekly movement screen results, and a clubhead-speed bar chart. · 15 fields
- **Virtual round (phone-surface modal)** (L1132) — Course picker with favourites and search, then an 18-hole self-graded round played in the player's head on the range, with a ball-abacus for strokes over par, a mechanical-leak audit, and a scorecard that logs back into the sim history. · 22 fields
- **Forge capture (phone-surface modal)** (L1266) — The scored-session capture flow: four-domain roadmap → drill picker → drill brief (setup, level, scoring, conditions) → live tally/score entry with an abacus → a done screen reporting the index. · 35 fields
- **03 Transfer** (L1492) — The Forge quarterly session (four indices), the Challenge Ladder, a four-quarter SG trend chart, the 30-shot Short Game Assessment scored on points and converted to SG, course-simulation history, on-course index rows, and the transfer gap. · 44 fields
- **04 Performance** (L1769) — The composite SG number, practice-vs-on-course diverging bars per facet, the five-axis Practice DNA radar against a scratch baseline, and a screenshot-able send-to-player coach card. · 20 fields
- **Plan** (L1899) — Tier chooser (Foundation/Builder/Competitive), four phase tabs with hours/split/mix and a 7-row prescribed week, a scheduler that emits .ics and Google Calendar links, weekly volume meters, the Fitness and Rebuild Mode toggles, and the money 'stake'. · 34 fields
- **Team (Thread)** (L2092) — Four coach cards showing monthly session allowance, sessions used/banked and expiry, plus a three-message conversation feed. · 11 fields

</details>
