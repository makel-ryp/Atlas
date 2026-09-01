# Atlas — Design vs Build Gap Report

**28 Aug 2026.** Written against Luke's four prototypes (site, AtlasPlayer, coach Dashboard, Brand Guide), `METRIC-MAP.md`, `ECOSYSTEM.md`, and the live state of `ryp-core`.

⚠️ **Scope warning, up front.** The prototypes cover **three of the six apps** in your integration set — Atlas (the marketing site), Forge (the AtlasPlayer PWA), and the coach Dashboard. **Debrief, Locker Room and Practice DNA have no prototype in this handoff.** Debrief exists only as a name on a pricing card. Everything I say about those three comes from `METRIC-MAP.md`'s August inventory of their live codebases, not from a surveyed design. That is a real asymmetry and I flag it in section 5 row by row.

---

## 1. The one-paragraph answer

**The design and the data model are close. The design and the *build* are a year apart, and the *plan* has the integration in the wrong place.** `METRIC-MAP.md` already absorbed almost everything in Luke's prototypes — the build ladder, drill sign-off, the composite indices, the stake, credits, the transfer gap, the archetype collisions. That work is done and it is good. What has actually been built is **18 tables, all of them identity plumbing**: 15 in `public`, 2 in `golf` (of ~26 planned), 1 in `atlas` (of ~14 planned). Every single screen in all three prototypes reads from tables that do not exist. So the honest number is: **the product surface is 0% built, the identity substrate is ~90% built, and the map between them is ~85% written but 0% applied.** The drift you're sensing is not the data model drifting from Luke's design — it's two other things: (a) the roadmap puts cross-app integration at **M5, Sprint 13+, Feb 2027**, when your own thesis makes it the product rather than the last gate, and (b) three of the largest surfaces Luke specified — the coach dashboard, the Construction build ladder, and the Forge scoring engine — **appear on no milestone at all**. Nothing here endangers 7 Sep.

---

## 2. What the design assumes exists that does not

Ranked by how much it changes the plan, not by size.

**1. `golf.player_metrics` — the append-only metric stream. `METRIC-MAP` calls it "THE SINGLE HIGHEST-LEVERAGE PROMOTION" and it is not built.**
One table: `(user_id, metric_type, value, source, measured_at, ref)`. It is the join point for mechanics index, club head speed, on-course score, mental game index, decision quality, routine adherence, pressure performance. Without it, every app invents its own column for a metric another app measures — which is precisely what all three prototypes already do. **This is the table the 2030 model reads.** Build it before anything else in `golf.*`.

**2. `target_handicap` — one missing column with more downstream reach than anything else in the handoff.**
The Dashboard's rail slider (−6..30) is the denominator of *every* strokes-gained figure on *every* screen, the roster's Total SG column, the DNA radar baseline, the send-to-player card, and the BENCH/ANCH interpolation tables. `golf.player_profile.handicap_index` maps only to self-reported *real* handicap. Adding it costs nothing. Not adding it means nothing on the coach dashboard can render.

**3. The entire practice/assessment layer — 4 tables, zero built.**
`golf.practice_sessions`, `golf.practice_index_results`, `golf.practice_shots`, `golf.practice_days`. These carry the four facet indices, the composite, the transfer gap, the per-shot logs (chipping `{outcome,lie,yds,high}`, approach bucket + shape calls, putting positional distance, driving 5-bucket tally), and the practice calendar. AtlasPlayer's entire persistence today is one localStorage blob at `atlas.player.v3` **with no user id in it**, and `"Send to Atlas"` is literally `sync: () => this.setState({synced: true})`. There is no wire format, no auth, no retry, no idempotency — no contract to build against.

**4. The build ladder — `golf.drill_library` + `golf.drill_progress`. This is the actual coach mechanic and it has no tables.**
Five steps, 23 drills, two pivot variants, four parallel progress arrays (`ticked`/`verified`/`signed`/`watched`), lock-until-signed, and coach attribution on verification. `METRIC-MAP` already specified it correctly with **per-column writers** (forge writes ticked/watched, atlas+lr write verified/signed). It is the one place where the plan and the prototype match exactly. Build it as specified.

**5. The coach dashboard's actual content — `atlas.intake_submissions`, `atlas.impact_notes`, `golf.impact_reads`.**
The Player file is what a coach reads: six prose intake answers, six handicap-history marks with an explicit **"not playing"** state distinct from missing, four measured impact reads with coach notes and tones, four player self-estimates, an awareness score, and a 3×3 strike map over ten filmed shots. None of it exists, and the reads/strike map presuppose a video-capture and coach-measurement pipeline that does not exist either.

**6. `atlas.messages` — a two-way thread. `atlas.coaching_notes` is not it.**
All four readers found this independently. `coaching_notes` is a coach-authored note *about* a student with coaching_team/private/shared visibility. Both prototypes show a continuous two-way conversation the player writes into, with multiple coach roles and (on the site) a stated **95%-within-24h SLA**. Different entity. `METRIC-MAP` already assigned it as the one documented exception to Atlas-writes-atlas: INSERT from `atlas_app`, `forge_app`, `lr_app`.

**7. The commercial layer. `public.plans` has two rows; the site sells seven price points.**
$99 / $199 / $299 / $399 one-time, $399/mo, $799/mo, plus free. Cumulative ("each tier includes everything below"), a 3-month minimum on Coaching, an application gate on Elite. No price, no currency, no interval, no commitment term, no include-below relation, no checkout, no Stripe. And `STACK-DECISIONS.md` records that the $99–$799 figures **appear nowhere in the repo** — the only pricing research says $59.99–$99.99/**year**. Names and prices are both unresolved.

**8. Object storage. Not a table — a decision nobody has made.**
Required by: drill videos (5+ tests × 40s), Parallax camera reps, the intake ten-ball film, the stake's 60-second forfeit video, launch-monitor screenshot upload, coach headshots, and every image on the marketing site (there are **zero** image assets in 190K of site markup). `forge.lm_imports` is specified as "raw file in R2 with a key reference." R2 is named nowhere else as decided.

**9. `golf.courses` / `course_holes` — the consumer exists before the producer.**
The Dashboard's virtual round needs rating, slope, par and hole yardages, and invents 12 fictional courses. `METRIC-MAP` assigns writing to `red_app`, and Red today has **five incompatible course identities and zero canonical rows**.

**10. Verification / attestation — the Brand Guide asserts a data model that has no table.**
SELF-REPORTED (gold) / COACH VERIFIED (steel) / LOCKED (hairline) is the reason `steel` exists as a token. Across ~18 built tables there is **no `verified_by`, `verified_at`, `claim_state` or `unlock_gate` column anywhere**. `golf.drill_progress` covers the drill case; the pill trio appears on every player-facing surface.

**11. The Mechanics Index — a refund obligation bound to a metric with no producer.** (Detail in §6.)

---

## 3. What we built that the design does not ask for

**Almost nothing — and that is the diagnosis, not the reassurance.** Everything in `ryp-core` today is identity plumbing the design demands: users, roles, relationships, coach profiles, orgs, invites, terms, deletion requests, audit. The design asks for all of it. It also asks for a product on top, and there is none.

Four genuine mismatches, none of them "extra scope":

- **`atlas.coaching_notes`' visibility model** (coaching_team / private / shared) is invented. Neither prototype asks for it; both ask for a two-way thread. It is the **only** table in `atlas.*` and it does not match either prototype's need. Keep it — Debrief has a real precedent for coach↔coach notes — but do not let it stand in for the thread.
- **`public.plans` free/pro** is not extra, it is *wrong*. Two rows against seven price points.
- **`ghin_number` and `handedness`** on `player_profile` are a **reverse gap**: the built table is *wider* than AtlasPlayer's onboarding, which captures only handicap and driver carry. So a shared profile screen has to reconcile two capture surfaces, not simply extend one.
- **The two-tier coach visibility (identity vs metrics)** is yours, not Luke's. It is correct and it is also a fifth meaning of the word "tier" (§7).

---

## 4. Vocabulary clashes

These are the expensive ones because a language model cannot disambiguate them after the fact.

| Word | Meanings in play | Verdict |
|---|---|---|
| **Forge** | (a) the legacy app reassigned to Luke; (b) the AtlasPlayer PWA, which *is* that app, branded "Atlas" in all copy while shipping `forge-192.png` icons and migrating `atlas.forge.v1/v2/v3` keys; (c) the name of the core quarterly 80-shot assessment *inside* the Atlas Dashboard; (d) a product the site sells as included app access at $399 | **Worst collision in the set.** Spans product, branding, schema and a live pricing page. Decide before anything ships |
| **Atlas** | the consumer brand · the marketing site · the player PWA's self-name · the identity nucleus app · the `atlas.*` schema | Every doc saying "Atlas" is ambiguous today |
| **Tier** | training volume (Foundation/Builder/Competitive) · commercial SKU (six) · `chipTier` scoring tolerance (1–3) · coach visibility (identity vs metrics) · LR license (Starter/Pro/Enterprise) · `plans` (free/pro) | **Six meanings.** Ban the bare word in schema columns |
| **Plan** | `public.plans` (billing) · the Plan screen (practice commitment + floor) · "the plan your plan calls for" (clinical care plan) · `forge.plans` in the old build plan | The prototype has **no third word** for a coaching programme. `METRIC-MAP` resolved it: `atlas.prescriptions` |
| **Index** | facet handicap (driving/chipping index) · USGA handicap index · Mechanics/Practice/Performance Index · "Current handicap index" stepper on the same screen as a facet index | Ambiguous *inside one screen* today |
| **Session** | practice session · Forge assessment session · paid coaching session (credits) · launch-monitor export session · a practice-log day | Four granularities |
| **DNA** | Forge's 5-axis skill radar · the Atlas Practice DNA archetype instrument | **Already ruled**: `forge.skill_radar`; "Practice DNA" reserved for the Atlas instrument. Both prototypes render the radar and call it Practice DNA. Rename decided, unapplied |
| **S.C.O.R.E.** | LR: Strategy/Commitment/Observation/Reset/Engage, 0–25, Typeform, 26 archetypes · Debrief: Strategize/Commit/Observe/Reset/Engage, 1–10, LLM per transcript, 18 failure codes | **DO NOT MERGE.** Split and rename now — `atlas.score_profile` vs `debrief.mental_pillars` |
| **Archetype** | LR's 26 · Debrief's dead Scientist/Engineer/Warrior/Artist · Atlas/Practice DNA's 6 · **and Luke's own site uses Engineer/Artist/Architect for two different things on adjacent pages** (book parts tied to zones, and player practice personalities) | Three ecosystem vocabularies plus one internal collision |
| **Zone vs Phase** | Zones 01–04 Construction/Calibration/Transfer/**Performance** · Phases 1–4 Assessment/Construction Primary/Transfer Introduced/Mechanical Ceiling | Two orthogonal 1–4 models. A roster row shows "Zone 01" while the tier's phase is a different number |
| **Leak** | the facet losing most strokes (roster column) · a shot where you thought about mechanics (virtual-round audit) | Two meanings, same product |
| **Contender** | Three ROSTER players are tagged it; `TIERS` has no such key (the third is `competitive`) | Undefined enum value in the data. Ask Luke — do not silently reconcile |
| **Coach vs Faculty** | The site draws a real distinction and **Dr. Raymond Prior is on both lists** | `coach_profiles` needs many-to-many role tagging, not one role column |

---

## 5. The six-app integration map

**This is the section that matters.** `METRIC-MAP.md` §2 already ruled on most of these. What is new is the last column — the prototypes now show what each app *actually computes locally today*, which the August inventory could only infer. **Every row where that column is populated is a reconciliation, not missing work.**

Legend: **SETTLED** = `METRIC-MAP` ruled and nothing contradicts it · **CONTESTED** = two apps model it incompatibly · **NO PRODUCER** = nothing measures it anywhere · *(no prototype)* = ruled from code inventory, not from a surveyed design.

### A. Identity & the golfer record

| Metric | Measured by | Consumed by | Lives | Status | What a prototype does instead |
|---|---|---|---|---|---|
| firebase_uid / email / name | Atlas | all six | `public.users` | **SETTLED** | AtlasPlayer's persisted blob has **no user id of any kind** — 14 keys, none identify anyone. Identity must be injected at the Forge↔Atlas boundary and the prototype gives no hint where |
| `handicap_index` | Red, Atlas, GHIN | all six | `golf.player_profile` + `handicap_history` | **SETTLED** | **The biggest reconciliation in the handoff.** AtlasPlayer uses a self-reported ±0.5 stepper with no history and no GHIN. SG, the SGA target, the LM expectation, the transfer gap and Practice DNA all derive from it. The product's emotional centre — "you're 2.4 strokes better on the range than on your card" — rests on a number the player typed, when a measured one is one read away |
| handedness | Atlas (profile) | Red, Forge, Debrief, LR | `golf.player_profile` | **SETTLED** | Dashboard stores `'Right-handed'` as a **prose display string**. Debrief *infers* it from casual chat into an uncontrolled jsonb blob — the literal "Luke forgets I am left-handed" bug |
| GHIN | external service | Atlas, Red | `golf.player_profile.ghin_number` | **SETTLED, no integration** | Built column, captured by nothing. Dashboard's code comment: "self-reported until it can be pulled from a handicap service" |
| **target_handicap** | player + coach | Dashboard (every screen), Forge | `golf.player_profile` | **NO COLUMN** | Rail slider. Denominator of every SG figure in the product |
| handicap history, 6 lookbacks | intake form | Dashboard Player file | `golf.handicap_history` | **SETTLED, needs shape change** | Needs an explicit **"not playing"** state distinct from unanswered, and the six fixed buckets (3mo/6mo/1y/3y/5y/10y) are a presentation contract |
| the bag | Red, Forge | Atlas, Debrief | `golf.bag` | **SETTLED** | Red's `club_profiles` *is* the bag. Debrief re-extracts clubs from chat. Forge can't prescribe without it |
| per-club carry & dispersion | Red + Forge (both write) | Atlas, Debrief | `golf.club_measurements` | **SETTLED** | **THREE sources for one number.** `player_profile.driver_carry_yds` is demoted to a cached self-report, explicitly not truth |
| coach identity, specialty, bio, **calendly_url** | Atlas | LR, Forge, the site | `public.coach_profiles` | **SETTLED, column missing** | Site promises a Calendly-booked directory "in your dashboard." Five of five coach bios read "Full bio coming soon." Needs many-to-many roles (Prior is coach *and* faculty) |
| coach↔player edge | Atlas | all | `public.user_relationships` (approved) + `org_memberships` | **BUILT & PROVEN** | Dashboard's `coachMode` is a **boolean on the player's own state**, not a role. There is no coach identity in that file at all |

### B. Golf truth — rounds, shots, courses

| Metric | Measured by | Consumed by | Lives | Status | What a prototype does instead |
|---|---|---|---|---|---|
| the round | Red (real), Forge (simulated), Debrief (scheduled shell) | all six | `golf.rounds`, `is_simulated NOT NULL DEFAULT false` | **SETTLED** | Dashboard's virtual round computes `(strokes − rating) × 113 / slope` and appends to `forge.sim`, keeping the last 6. That's `golf.rounds is_simulated=true` + `round_holes`, already assigned. Debrief today makes the golfer **re-type the same round by hand** |
| per-hole record | Red | Debrief, Forge, Atlas | `golf.course_holes` (static) / `golf.round_holes` (scored) | **SETTLED — rename supersedes ECOSYSTEM §2's `golf.holes`** | Must be settled before any DDL. Red's `holes` is a ~50-column per-round scorecard |
| course identity | Red | all five others | `golf.courses` + `course_holes` | **CONTESTED — five identities, zero canonical rows** | Dashboard hardcodes 12 **invented** courses with fake rating/slope. The differential formula is the standard one, so input accuracy matters |
| round shots (GPS) | Red | Forge, Debrief, Atlas | `golf.round_shots` | **SETTLED (two tables, not one — needs Luke's sign-off)** | Red's synthetic hash-jittered scatter must never be read as real positions |
| **raw launch-monitor shots** | Red + Forge | Atlas, Debrief | `golf.practice_shots` + `club_measurements` | **SETTLED** | **Cleanest reconciliation in the report.** Red ingests 2MB GSpro CSVs and **throws the shots away**. AtlasPlayer parses Trackman/GCQuad/Mevo+ CSVs in-browser (header sniffing, tab-vs-comma, feet-vs-yards, `L12.3`/`R4.5`) and **throws them away too — and doesn't even persist the summary**. Dashboard's `GAP_SAMPLE` is 13 hardcoded rows behind an Upload button that assigns a constant. **Three apps parsing launch-monitor files; zero retaining a shot** |
| recorded conditions (wind, firmness, green speed, slope) | Red (per hole), Forge (per session) | Debrief, Atlas | shared on `round_holes`; modelled effect stays app-private | **SETTLED** | AtlasPlayer's brief screen makes conditions **mandatory** — you cannot start a test without them — then never persists them and never attaches them to the saved index. Its own copy says "record the surface or the index is not comparable." Intent explicit, plumbing absent |
| self-reported dispersion ellipses | player (Atlas/Dashboard) | coach | **no home** | **NO PRODUCER** | Per club: centre, four asymmetric radii, rotation, handedness mirror. A stored *geometry*, not a metric — easy to miss. Site has a third, different version (3 clubs, `{x%,y%,rx,ry}` dots, 44/56 buckets, fake confidence `min(95, 45+n*8)`) |
| tournaments / scheduled rounds | Debrief *(no prototype)* | Red, LR, Forge | `golf.tournaments` + `rounds.scheduled_at` | **SETTLED** | That FK is what turns Debrief from standalone into part of the ecosystem |
| seasons | LR *(no prototype)* | Forge, Red, Atlas | `golf.seasons` | **SETTLED** | A calendar convention duplicated by hand in four places today |

### C. Practice, the build, and the assessment engine

| Metric | Measured by | Consumed by | Lives | Status | What a prototype does instead |
|---|---|---|---|---|---|
| practice session + facet indices | **Forge** | Atlas, Debrief, LR | `golf.practice_sessions`, `practice_index_results` | **SETTLED** | AtlasPlayer has **no session entity** — "the current session" is the implicit union of `data`+`saved`+`timers`, and the only way to start a new one is to destroy the old one. History, trends and coach comparison all break on this |
| **transfer_gap** | Forge | Atlas | `golf.practice_sessions.transfer_gap` — **deliberately promoted so Atlas does not compute a rival number** | **SETTLED — and already violated** | The two prototypes compute it **differently**: Dashboard `real − practice`; AtlasPlayer `max(0, sgTotal)` off `playsLike = hcp − sgTotal`. AtlasPlayer's Today screen also **hardcodes** `'Transfer gap 2.4'` beside the computed one. Two rival numbers already exist inside Luke's own two files |
| **primary_leak** | Forge | *nobody — deliberately not promoted* | `forge.session_meta` (private) | **SETTLED — and already violated** | The rule exists so two competing priority labels never reach one player. Dashboard shows "Leak" on **every roster row**; AtlasPlayer's Complete screen makes it the headline. "What to work on next" is `atlas.prescriptions.growth_zone` |
| practice day log | Forge | Atlas coach view, Debrief | `golf.practice_days` | **SETTLED** | Both prototypes key on a **bare day-of-month integer inside a hardcoded July 2026** (`CAL_OFFSET 3`, `CAL_DAYS 31`, `CAL_TODAY 26`) with no year, no duration. Deliberately mirrored between them, so both move together. Days-since-last-log is the roster's **primary triage signal** |
| drill library | Forge + Atlas write | all | `golf.drill_library` | **SETTLED** | Forge has `DRILL_DEFS`/`STEPS` as code literals; Debrief's table is dead **and stale** (zone enum `Lab/AssemblyLine/Crucible/Arena`); LR hardcodes 24 conflict scripts in two places, already drifting |
| **drill progress + coach sign-off** | Forge writes ticked/watched; Atlas + LR write verified/signed | all | `golf.drill_progress`, **per-COLUMN writers** | **SETTLED — plan is already right** | Dashboard's four parallel arrays (`ticked`/`verified`/`signed`/`watched`) map **exactly** onto the specified columns. This is the one place the prototype confirms the plan unchanged. Build it as written |
| scored drill results (per-column tally) | Forge | Atlas | `golf.practice_index_results` + `practice_shots` | **SETTLED, shape unspecified** | Needs: player, drill id, timestamp, per-column tally, mode (test\|challenge), level, derived score, recorded conditions, and **whether it feeds the composite** (`sga30` and `stroke20` explicitly do not — the composite rests on exactly four drills) |
| `chipTier` / calibration tolerance | Forge (SGA sets it) | Forge (rewrites future scoring) | `forge.calibration` | **SETTLED, two-way contract** | **The only bidirectional dependency in the product**: a measurement changes how future measurements are scored. It lives in localStorage and is never sent with the index it governed. A server recomputing a chipping index needs the tier in force **at capture time**. Atlas must both receive it and hand it back |
| composite / practice handicap | Forge | Atlas roster, Dashboard rail | derived from `practice_index_results` | **SETTLED** | AtlasPlayer computes a composite over *played* indices only and prints one even from a single index, substituting `BASELINE` constants — two different composites from the same data, one labelled as seeded |
| quarterly baselines | Forge | Atlas trend chart | `practice_index_results` over time | **NO TABLE** | "baseline" appears **0×** in any planning doc |
| 5-axis radar | Forge | Forge only | **`forge.skill_radar`** (renamed) | **SETTLED — rename unapplied** | Both prototypes render it and call it "Practice DNA." Formulas (`70 − index*2.2`; carry scaled 150–320) are a de facto spec someone will be held to |
| fitness screen / speed / lift compliance | **nobody** | Dashboard, LR | `fitness` schema — "likely future spoke" | **NO PRODUCER** | Five screen measures re-taken every 4 weeks where a **"Limited" result changes which drill the player is given** — so it feeds the prescription. Plus an 8-point clubhead-speed series. Attributed to two named coaches who aren't the same list as `COACHES` |
| weekly readiness (physical/mental battery) | **LR** *(no prototype)* | Atlas, Forge | `golf.player_checkins` — **narrowed grant** | **SETTLED** | LR's `pulse_entries` is the only live source of the injured flag. Five downstream rollup columns are dead seed fiction still feeding an AI prompt |
| injury / availability | LR + Atlas write | Forge, Red (status only), Debrief | `golf.player_availability` — **health data, narrow grant** | **SETTLED, contested intake** | **Three intake mechanisms and the worst one is winning.** Debrief extracts it from casual chat with no confirmation step. And the Dashboard's intake `limits` field **decides which pivot variant the coach assigns** (Cannon vs Anchor) — so a health field is load-bearing on the prescription |

### D. The coaching brain

| Metric | Measured by | Consumed by | Lives | Status | What a prototype does instead |
|---|---|---|---|---|---|
| prescriptions / homework | **Atlas is the single writer**; Debrief + LR POST to an async ingest route | all | `atlas.prescriptions` | **SETTLED — but FIVE parallel producers exist today** | Debrief `practice_focus`; Forge's build ladder + primaryLeak; LR `ai_protocols` from its own Gemini call; Red's `/trends` with named metrics and CTAs; Atlas's growthZone. The Dashboard's "Tomorrow · built for you" is presented as the product's intelligence and is a hardcoded 4×2×3 matrix of 24 hand-written blocks plus one `reduce` |
| coaching notes | Atlas | coach team | `atlas.coaching_notes` | **BUILT** | The only `atlas.*` table that exists, and it matches neither prototype's need |
| coach↔player messages | Atlas, Forge, LR all INSERT | player + coaches | `atlas.messages` — **the one documented exception** | **SETTLED** | Dashboard: "one continuous conversation, not a ticket queue." AtlasPlayer: read-only, **no compose box**, three hardcoded messages, no ids, no timestamps, no read state. Site promises 95%-within-24h — a measurable SLA with no timestamped request entity to measure against |
| archetype | **Atlas / Practice DNA** (6 values) | Forge, Debrief, LR read | `atlas.practice_dna_results.archetype` | **SETTLED — three vocabularies, one already diverged** | LR's 26 labels computed in **client** code so every consumer re-implements it; Debrief's persona is dead; and §4 Q8 records the scoring engine **was copied from Forge and has since diverged, with the regression suite living in Forge.** The name-clash-resolved-later approach has already failed here once |
| S.C.O.R.E. | LR (Typeform, trait-level) **and** Debrief (LLM, per-round) | coaches | `atlas.score_profile` + snapshots / `debrief.mental_pillars` | **SETTLED: SPLIT AND RENAME NOW** | Same acronym, two instruments. Only Debrief's **longitudinal failure-mode trend** promotes, to `atlas.tendencies`. Merging by name would silently fuse two measurement systems |
| communication / coaching register | **Debrief only** | Red's caddie voice, Forge's prescription register | `atlas.communication_profile` | **SETTLED — single point of failure** | If Debrief stays standalone, **four `atlas.*` tables lose their only producer**. Two bugs to fix on the way in: the smoothing constant disagrees between prompt (0.8/0.2) and code (0.7/0.3), and `psychological_sophistication` is clinically-framed naming on a profile about to become ecosystem-readable |
| coachability dimensions | LR (23-item dyadic audit) | Atlas | `atlas.coachability_dimensions` | **SETTLED** | Raw items + free-text stay LR-private; only the distilled 7 leave |
| player goals / why-statement | LR, Debrief, Atlas intake | all | `golf.player_goals` (canonical, not an opinion) | **SETTLED** | Debrief **overwrites** why_statement per debrief — wrong for a durable fact. Dashboard captures a 7th intake field (`file.best`) that **no screen renders** |
| awareness score (estimate vs measurement) | **nobody** | Dashboard Player file, badges every screen | `atlas.impact_notes` / `golf.impact_reads` | **NO PRODUCER — genuinely novel** | Stores the player's *guess* alongside the measurement and scores the delta (exact 1.0, one-bucket-off 0.5). At low awareness the verdict is "every drill gets a camera until the feel catches up" — **the score changes the coaching protocol.** Needs video capture + a coach-entered measurement |
| knowledge corpus / the Vault | a content ingest service | all five apps | `golf.knowledge_chunks` | **SETTLED, unbuilt** | Corpus lives in Debrief's DB but serves Yannick *and* Luke. Site pitches 1,000+ pages, 41 studies, 18 chapters, 14 named articles, all hrefless. **Clinical material must get a separate table granted to `debrief_app` alone** and never be reachable by a general RAG query in Red or Forge |

### E. Entitlements & the commercial layer

| Metric | Measured by | Consumed by | Lives | Status | What a prototype does instead |
|---|---|---|---|---|---|
| plan / entitlement tier | `billing_svc` | all | `public.plans` + `content_entitlements` | **CONTESTED — four models, none confirmed** | Site: six tiers. Dashboard: three (Foundation/Builder/Competitive). Red: free\|pro. LR: Tier 1–3 + Starter/Pro/Enterprise, **stored, displayed and never read to authorize**. DB: two rows |
| coaching session credits | `billing_svc` issues, Atlas decrements | Dashboard Team screen | `public.coaching_credits` | **BUILT, wrong shape in the prototype** | Prototype's ALLOW/USED/BANKED are code literals keyed tier→coach with **no player dimension** — it breaks the moment there's a second player — and the 90-day expiry is the literal string `'18 days'` |
| the money stake | Atlas | player | `forge.stakes` (one passing mention) | **NO PRODUCT DECISION** | $10–100/week, forfeit routes to charity or buys a coaching session, a 60-second to-camera video recorded at pledge and replayed before restart, 2 declared misses/phase, 80%-of-floor threshold evaluated weekly. Reads as a motivational flourish; **it is payments + media storage + a scheduled evaluation job** |
| academy / org / **cohort** | Atlas admin | LR, Forge | `public.organizations` + `org_memberships` | **BUILT — cohort missing** | Site says "90-day academy pass" (entitlement) and "solo or in a cohort" (a time-boxed group with a start date and a shared 90-day build). Three concepts, two words, one table |
| **Mechanics Index** | **nobody** | the refund guarantee | `golf.player_metrics` + `parallax_svc` | **NO PRODUCER — highest stakes in the report** | See §6 |
| Parallax | third party | the entire coach sign-off loop | external `videoRef` | **UNRESOLVED BUILD-OR-BUY** | Site states the entitlement **three contradictory ways on one page**: 30-day free trial / 90-day academy pass / 90 days included. Dashboard routes every camera drill verification through it; the Upload button is inert |
| Arccos | third party | Dashboard Performance screen | nothing | **DROP — say so explicitly** | The site reader found **zero** Arccos hits in 190K and asked where the assumption came from. Answer: `Dashboard.dc.html`, as an outbound link to arccosgolf.com with on-course SG framed as coming from Arccos rounds. Link-only. Cutting it was already the recommendation |
| notifications | each app | — | **stays app-private per app** | **SETTLED** | Only `users.timezone` promotes. A user with Red, Forge and Debrief installed gets three registrations and three chances to double-notify about the same round — a notification-layer problem, not a schema merge |

**Practice DNA's row across all of this:** it is the app with **no prototype and the most cross-app reach**. It writes the archetype every other app reads, it holds both a self-estimated and an objective handicap (and `resolveHandicap()` already prefers the objective one), and — see §8 — **its `config.ts` already contains the metric vocabulary the whole ecosystem needs.**

---

## 6. What the unified profile needs that nothing currently produces

Assembling the top-to-bottom golfer from the prototypes' own metrics, here is what has **no producer at all** — not "no table," no *source*:

1. **Mechanics Index.** The 90-day guarantee is contractually bound to "a camera-verified Mechanics-Index improvement, or we keep coaching you free." There is no definition, no formula, no table, and no measuring instrument. `METRIC-MAP` provisions a `parallax_svc` role that writes `metric_type='mechanics_index', source='parallax'` — and warns in the same breath that **MI is only *estimated* today and an estimate must never be written with `source='parallax'`.** Parallax itself is an unresolved build-or-buy. **This is a public refund promise with a measurable trigger you cannot compute.** Either define and instrument it, or rewrite the copy. Not both later.
2. **The awareness score.** Player's pre-video estimate vs measured truth, scored. Requires video capture *and* a coach-entered measurement pipeline. Nothing produces either. It badges the Profile nav item on every screen and it changes the coaching protocol.
3. **Impact reads** (path / face / contact / low point as measured values). Same pipeline. `golf.impact_reads` is assigned to `atlas_app` and nothing writes it.
4. **Fitness screening + clubhead speed.** No app owns them. `fitness`/`rypstick` is a "likely future spoke." A "Limited" screen result changes which drill is prescribed, so this is not cosmetic.
5. **Zone and phase state.** The four-zone spine is the book's structure, the player app's tab bar, the Dashboard's calendar colours, the site's coordinate system and the roster's per-player badge — and **there is no table for a zone, a zone state, or the "Done when" completion criteria the site publishes as objective gates.**
6. **The player's position on The Map.** A coordinate in a 2-axis space (swing thoughts × internal load) with DANGER/COMFORT zones and a diagonal. Nav pillar, Ch. 06, first-class product concept, zero representation.
7. **Course reference data.** Consumer exists, producer doesn't (Red will write it; Red hasn't).
8. **Target handicap.** No column, and everything is measured against it.
9. **Video / object storage.** No decision, and six features depend on it.
10. **A verification/attestation record.** The brand's central semantic and the coach's whole job, with no column anywhere.
11. **Communication profile** — conditionally. Debrief is the sole producer; if Debrief stays standalone, this and three sibling `atlas.*` tables have no producer at all. **§6.2 is still Yannick's open call and it silently gates a quarter of the coaching brain.**

**And three properties the 2030 model needs that nothing currently enforces:**

- **Provenance.** `METRIC-MAP` got this right for `atlas.*` (every table carries `source_app` + `config_version`/`scoring_version`/`result_version`) and for `player_metrics` (`source` + `measured_at`). It is **not** specified for the `golf.practice_*` tables — and that is exactly where it is most needed, because the prototypes pin nothing. `PUTT_SEQ` distances are **positional** (a putting session is 20 integers; the distances live only in a constant). Approach proximity is a **bucket index** resolved through `APP_B` to a representative feet value. `SG_EXP`, `SG_F`, `CHIP_SEQ`, `SGA_CATS` and the composite weights are all code literals. **Change any one and every historical row silently re-means.** Drill sequences are versioned product content and must be pinned to any stored result.
- **Append-only.** `player_metrics`, `handicap_history` and `score_profile_snapshots` are right. The prototypes are the opposite: AtlasPlayer's only way to start a new session is `discardRun` (wipes data, saved, timers); Debrief overwrites `why_statement`; LR overwrites `players.score_*` in place. Current value on the profile, trail in a history table — enforce it in the DDL, not in convention.
- **A single metric vocabulary.** See §8.

---

## 7. Naming decisions that get expensive if deferred

Ranked. All of these are free today and cost a migration later.

1. **"Forge."** Four referents including one on a live pricing page. Decide: is the quarterly assessment renamed inside Atlas, is the PWA renamed, or is the legacy-app-to-Luke decision revisited? Blocks the PWA icons, the manifest, the localStorage keys, and Tier 4's contents.
2. **The plan vocabulary.** `METRIC-MAP` §4 Q4 proposed `free · pro · coaching · elite` + `content_entitlements` for the four one-time tiers and flagged it as needing confirmation. **That confirmation never happened.** It decides the seed script, every `feature_flags.plan_required` value, and whether Foundation/Builder/Competitive survives at all. **Cost of deferring past the Stripe work: Stripe Price objects are immutable — every one has to be recreated.**
3. **"Tier."** Six meanings. Pick a distinct noun per concept *before* any column is named `tier`: commitment level, SKU, tolerance level, visibility level, license.
4. **The metric vocabulary itself** — `METRIC_TYPES × METRIC_SOURCES`. See §8. This is the CHECK constraint on the table every app writes into.
5. **The four zones as a shared enum.** Construction / Calibration / Transfer / **Performance** — the spine of the book, the app, the calendar and the roster, repeated as string literals in at least six places in one file, and already drifted once in Debrief (`Lab/AssemblyLine/Crucible/Arena`).
6. **S.C.O.R.E.** Split and rename now, while nothing in `eco` defines either.
7. **"DNA."** Rename Forge's to `skill_radar` before a second producer exists. The ruling is made; apply it.
8. **"Archetype."** One vocabulary (the 6), one writer (Atlas), everyone else renders. And settle Luke's own internal collision: Engineer/Artist/Architect cannot be both book parts tied to zones and Practice DNA player types.
9. **Coach vs Faculty**, and **academy vs cohort vs org**.
10. **"Contender."** Ask Luke whether it is a stale rename of `competitive` or a cut fourth tier.

---

## 8. What this changes about the plan

Six concrete revisions. Two of them say a milestone is wrong.

**1. M5 is not a late milestone. It is the product, and the roadmap has it at Sprint 13+ / Feb 2027.**
Your thesis — "it all starts with us integrating Atlas, red, forge, Debrief, locker room, and practice DNA" — makes cross-app domain data the thing being built, not the final gate. `DECISION-coach-dashboard.md` §1 **already conceded this in writing** ("pulls a piece of M5 forward into Atlas's own scope") and the roadmap was never updated. So M5 is already partially inside M1 and the plan doesn't know. **Revision:** stop treating M5 as a milestone. Treat `golf.player_metrics` + the profile/practice read path as the spine that M1–M4 hang off, and keep the *hard* parts of M5 (Red's rounds promotion, Debrief cross-reads, revocation propagation) where they are. `ROADMAP` §2's warning — "do not attempt M5 before three apps are standing" — remains right about *those* parts and does not apply to Atlas reading its own students.

**2. The coach dashboard is on no milestone, and the decision to give it to Atlas was made on evidence that doesn't contain it.**
This was flagged on 24 Aug and is still true. Worse: `Dashboard.dc.html` is **~90% the player app** — `state.view` defaults to `'today'`, the component takes one prop (`playerName`, default "Marcus Hale"), 10 of 12 nav items are player screens, and the coach surface is Roster + Player file + a `coachMode` **boolean on the player's own state**. Nine screens are hardwired to one player; re-keying them by `profileOf` is not a small change. **The decision is probably still right** — Atlas owns `user_relationships`, so it is the only app that *can* enforce the boundary honestly — but it was made on a file that mostly contains something else. **Revision:** the coach dashboard needs its own milestone, and its scope is "design the coach product," not "port Luke's file." What the file gives you is two excellent screens (Roster triage sorted by silence; the Player file dossier) and a verification toggle.

**3. Practice DNA: defer the *app*, lift the *vocabulary* now.**
"Deferred" is still tenable for the app and I would keep it — separate project, mid-launch, its own database, the `DATABASE_URL` guard stands. **But it is not tenable for the vocabulary,** and this is the sharpest finding in the report. `METRIC-MAP` records that Practice DNA's `config.ts:60-80` **already defines `METRIC_TYPES × METRIC_SOURCES`** (parallax, ryp_strategy, debrief, teaching_pro, manual, self_report), described in-code as backing a DB CHECK constraint and an ingestion webhook — and `ZONE_TOOLS` already says which app measures and which trains each zone. **The deferred app is the one that already wrote the reconciling vocabulary for `golf.player_metrics`, the table `METRIC-MAP` calls the single highest-leverage promotion.** Defer the app; lift the enum into `ryp-core` now, or the second producer invents its own.
Two things that change if you include the app now, and they are architectural, not scheduling:
   - **It is the only anonymous-write surface in the ecosystem.** Most rows keep `user_id NULL`, which **breaks owner-scoped RLS** in a database whose entire thesis is that RLS binds. That is a real policy carve-out, not a scheduling detail.
   - **Its instrument-QA fields** (attention checks, server-side `quality_flag`) must never leak into `atlas.*` where a coach's app could read "this player answered carelessly."
   And the archetype engine **has already diverged once** — copied from Forge, drifted, with the regression suite still living in Forge (§4 Q8). That is the evidence that resolving name clashes later does not work here.

**4. A planning doc of yours has the zone vocabulary wrong.**
An earlier planning note said the four-phase model was "Construction · Calibration · Transfer · **Speed**." It is **Performance** — corrected everywhere on 28 Aug. The Dashboard's `BLOCKS` array is `['Construction','Calibration','Transfer','Performance']`; Speed is not a zone at all — it is one of `WORKS = ['Lift','Mobility','Speed','Rest']`, the fitness axis that sits alongside practice and is explicitly never subtracted from the practice floor. `METRIC-MAP` corroborates by name when it calls Debrief's zone enum stale. **Fix the doc.** A planning document carrying a wrong enum value is exactly how a wrong enum gets built.

**5. Three subsystems in the design have no milestone and no owner.** The Vault/CMS (0 mentions in any doc; it is the top-of-funnel asset and the destination of 9 of ~37 site click targets). The book (Volume One — `METRIC-MAP` 4×, roadmap 0×). Brand implementation. On brand: the Brand Guide is **a critique, not a spec** — half of it is unexecuted remediation, it recommends **two geometrically opposite logos** and ships a third in its own masthead, and its "Never green / never a second accent" rules are already violated by the semantic colour functions in both large prototypes (`STRONG='#4FBF7C'`, `sgColor()` returning `#7fae8e`, `ZONE_COLOR.Performance='#cf7d5c'`). **Eight values with one accent and no green cannot do data visualisation, and the Dashboard is almost entirely data visualisation.** Either the palette gains a sanctioned named data-viz ramp, or the Dashboard cannot be brought on-brand. That is a front-end workstream, not a theme file.

**6. What does *not* change.** The demo runbook's §5 line — "the tables are not created, because a table whose writing app doesn't exist yet is a guess" — is correct and this report does not contradict it. Nothing above says the built work was wrong. It says the built work is the substrate and nobody has started the product.

---

## 9. What is still safe to do before 7 Sep

**Nothing in this report requires a schema change before the demo. Do not touch `ryp-core`.** The runbook is four steps on live data with `npm run seed`; the failure mode that matters is fumbling the narration, not a missing table.

**Do these — all decisions or documents, zero code:**

1. 🔴 **Confirm whether the eight hardcoded ROSTER players in `Dashboard.dc.html` are real clients, and scrub if so.** `METRIC-MAP` §4 Q10 flagged this "URGENT AND NOT A SCHEMA QUESTION" on 18 Aug. Names, handicaps, injuries and verbatim interview answers sitting in an unauthenticated file. Independent of everything else here.
2. 🔴 **Rotate the committed GolfCourseAPI key** at `apps/RYP-RED/openapi.yml:19` and scrub the file. Flagged 2026-07-29 (`ECOSYSTEM` §7). Still there.
3. **Confirm the plan vocabulary.** `free · pro · coaching · elite` + `content_entitlements`, or something else. Names only — prices can stay NULL, the schema allows it deliberately. **This must land before the Stripe work, not after.**
4. **Answer the "Forge" naming question.** One sentence from you unblocks the PWA icons, the manifest, Tier 4's contents and every doc.
5. **Write down the metric vocabulary** — `METRIC_TYPES × METRIC_SOURCES` and `ZONE_TOOLS`, lifted from Practice DNA's `config.ts`, as the documented enum for `golf.player_metrics`. A file, not a migration.
6. ~~Fix the Speed→Performance error~~ **DONE 28 Aug** — corrected in every doc and memory note. Still to do: add the four zones to `ECOSYSTEM.md`, as a 4-row reference table rather than a string enum (see the critique).
7. **Write down what is cut from v1**, explicitly: Arccos (link-only, drop it), the Vault CMS, the book, quarterly baselines, the stake. Writing them down as cut is what stops them reappearing as a surprise mid-demo.
8. **Ask Luke three questions**, all cheap: is `Contender` a stale rename or a fourth tier? Which drill had `unverified` set before the flag was cleared (`stroke20` still carries `optional:true`, and the composite currently rests on exactly four drills)? Which logo — ascending or descending?
9. **Add one sentence to §5 of the runbook**, so the biggest open question doesn't ambush you: *"The coach dashboard, the build ladder and the practice engine are designed and specified, not built — they're the next milestone, and the permission layer they need is what you just watched work."*

Everything else waits until 8 Sep.

---

# Completeness critique

## WHAT THE REPORT MISSED

### 1. The handoff is six deliverables, not four — and two were never opened

`Atlas Handoff.dc.html` is the index shell for the whole package. Its own `TABS` array (lines ~120–133) enumerates exactly six: Website, Player app, Coach dashboard, Brand guide, **Book cover**, **Directions**. The report opens "written against Luke's four prototypes." `BookCover.dc.html` wasn't even in the file list the report was given. Both unopened files carry load-bearing content (below).

### 2. THE SHOP / THE LAB / THE FIELD / THE ARENA — the single biggest miss

Ten occurrences in the live site at three separate sections (`Atlas.dc.html:162, 167, 179, 213, 438–441, 845–848`). Not one of four readers named it. It is a **1:1 alias set for the four zones**, and each zone is published with ~10 coordinated attributes:

| Zone | Place | Neuroanatomy | Persona | Chapters | The trap | "Done when" |
|---|---|---|---|---|---|---|
| 01 Construction | THE SHOP | prefrontal cortex | The Engineer | 08–13 | The Prisoner | camera confirms position without conscious effort |
| 02 Calibration | THE LAB | cerebellum/parietal | The Scientist | 05–07 | The Illusionist | your strike prediction matches the data, repeatedly |
| 03 Transfer | THE FIELD | basal ganglia | The Warrior | 14–15 | The Ghost | random practice holds up as well as blocked |
| 04 Performance | THE ARENA | motor cortex | The Artist | 16 | Reinvestment | full round with external focus, start to finish |

Three consequences the report gets wrong:

- **§5C is wrong that Debrief's `Lab/AssemblyLine/Crucible/Arena` is "dead and stale."** Lab and Arena are *exactly current*. Only AssemblyLine (→Shop) and Crucible (→Field) drifted. It's a two-value rename, not a discard — the report's advice throws away a correct mapping.
- **§7.5's "add the four zones as a named shared enum" is the wrong artifact.** A zone is not a scalar; it's a record with a place alias, a substrate, a persona, a chapter range, a false prior, a named trap, and a completion gate. This is `golf.zones` — a 4-row reference table seeded from `Atlas.dc.html:158–220` — and it is *also* the answer to §6.5's "no table for the 'Done when' criteria." The report lists that gap and never notices the content already exists, fully written.
- **Part of §4's "Archetype" collision dissolves.** Engineer/Scientist/Warrior/Artist are *zone attributes*, not a rival archetype vocabulary. Debrief's "dead Scientist/Engineer/Warrior/Artist" is the zone persona set. Reconcile, don't discard.

### 3. Zones are the primary IA of the coach dashboard, and one screen is unnamed

`Dashboard.dc.html:2848–2853`:
```js
titles = { today:'Today', cal:'Calendar', plan:'Plan', build:'01 Construction',
  evidence:'02 Calibration', transfer:'03 Transfer', perf:'04 Performance', ... }
```
Four of twelve nav items *are* zones. The report treats zone as a badge/enum with no table; it's the navigation spine.

**`evidence` — the Calibration screen — is named by no reader.** It is the largest surface in the app, composing eight subsystems (`Dashboard.dc.html:5081–5087`): `buildOnboarding, buildVirtualRound, buildTarget, buildTrend, buildGapping, buildLadder, buildCoachCard, buildPlots`. Every artifact the report discusses as a separate item (the gapping table, the virtual round, the target-handicap slider, the trend chart) lives inside this one zone screen. That materially changes §8.2's scoping: the coach product isn't "Roster + Player file," it's four zone screens plus those two.

### 4. Field Mode — an entire offline/hardware subsystem in AtlasPlayer

Nobody mentioned any of it:
- **Sunlight mode** (`:1493–1494`): persisted preference applying `filter: contrast(1.16) brightness(1.26) saturate(0.86)` and swapping bg to `#111820`. **This is a brand constraint** — the palette must survive a contrast/saturation filter — and it intersects §8.5's data-viz-ramp problem, which never mentions it.
- **Wake Lock** (`:1563–1575`): `navigator.wakeLock.request('screen')`, held per drill screen, re-acquired on visibility change.
- **Offline queue** (`:1406, 1417, 1505–1510`): persisted `queue[]`, copy reads `"N sessions waiting to sync"` / `"Offline · saving on device"` / `"All synced"`.
- **Install prompt** (`:1431`): `beforeinstallprompt` → `canInstall`.
- **SW registration + cache eviction** (`:1433–1436`), `sw.js` cache `atlas-player-v4`.

**Framing correction:** the report's "no wire format, no auth, no retry, no idempotency" is *literally correct* — the drain is `setTimeout(() => this.setState({queue:[], synced:true}), 1400)` with no network call. What's missed is the **requirement**, not the implementation. The prototype commits to a UX contract — sessions queue on device, pending count visible, drain on reconnect — which forces **client-generated session IDs and idempotent ingest** into the schema. That belongs in §6's list of properties the 2030 model needs (currently provenance + append-only only). Separately, `"N sessions waiting to sync"` establishes that **the sync unit is a session** — which *corroborates* and pins the granularity of the report's own `golf.practice_sessions` recommendation.

### 5. The Map's axes are wrong in the report

§6.6: "a 2-axis space (swing thoughts × internal load)." `BookCover.dc.html` labels the axes **SWING THOUGHTS (INTERNAL LOAD)** and **SHOT DIFFICULTY (EXTERNAL LOAD)**. Swing thoughts *is* internal load — the report split one axis in two and dropped the other axis entirely. This is the same failure mode the report itself flags in §8.4 (a planning doc carrying a wrong enum).

### 6. The brand palette is an open decision with five candidates, not a settled rule being violated

`Atlas Team - Directions.dc.html` (72KB, unopened) is a brand exploration deck, not "where to find us" as Luke's own index mislabels it. Turn 1: five art directions (Laboratory, Clubhouse, Private Practice, Dossier, Field Guide). Turn 2: five complete palettes with hex, explicitly offered against "the current ink-and-brass":

- 2a Pine & Bone `#0E241D #143026 #0A1913 #C2A24E #ECE5D3` — **green primary**
- 2b Oxblood & Parchment `#2A1013 …`
- 2c Slate & Copper `#1B2025 …`
- 2d Navy & Champagne `#0D1B2C …`
- 2e Bone & Graphite `#ECE5D6 #F5F0E6 #23211C #2F5646 #C9B98F` — **a light theme with a green accent**

§8.5 reasons from "the Brand Guide's never-green rule is already violated by the prototypes." Backwards: Luke is proposing green-primary and light-theme directions as brand candidates. A light theme is absent from the report's model entirely and would change every token. Also: nav in all ten mockups is `Atlas · Practice DNA · Research · Coaching · The Team · GET THE SYSTEM`.

### 7. Zero hrefs sitewide — the auth seam is the missing piece

The report says the Vault's 14 articles are "hrefless." Understated: **`Atlas.dc.html` contains exactly three `href`s, all Google Fonts, and zero `id=` anchors.** Nothing links anywhere. Most consequential: the nav is `Atlas · Map · Practice DNA · The Book ↳ Vault · Research ↳ False Priors · Coaching · The Team · **Log in** · **JOIN**`. Log in / JOIN are the one place the design touches the auth chain that is *actually built and proven* — and they are dead labels with no route. That's the cheapest high-value pre-demo item in the whole handoff and it appears nowhere in §9.

### 8. Practice DNA: §8.3's "defer the app" has an unowned funnel dependency

The report's claim that the *app* has no prototype stands — no instrument, no scoring, no results screen. But `Atlas.dc.html:35, 228–320` puts Practice DNA in **primary nav** with a live **"Take the Practice DNA Quiz"** CTA, a three-archetype interactive comparator, and a three-forces model (Personality / Culture / Coaching) citing `Vault 3.9` and `Vault 0.6`. Deferring the app defers the site's top-of-funnel acquisition path. Also note the Vault is cited with **stable numeric IDs** — a content addressing scheme already exists in copy.

### 9. Smaller, verified

- **Performance zone is deferred by Luke himself**: `AtlasPlayer.dc.html:1227` — `{ k:'perform', num:'04', label:'Performance', soon: true }`. §6.5 treats all four zones as equally specified.
- **Player screens no reader named**: `roadmap`, `capture`, `domain`, `intro`, `sga`/`sgaResult` (16 total). `capture` matters — the report says video capture "does not exist" as a pipeline; the screen exists.
- **The book is a revenue line outside Stripe**: `Atlas.dc.html:295–296` — "Get it on Amazon" + "Read a free sample." §2.7's commercial analysis covers seven price points and never mentions it. Copy is also internally inconsistent: "five hundred pages" then "450+ pages."
- **Three logo variants ship in the deliverables**, not two recommendations plus a masthead: site header is **ascending** (`screenshots/logo-check.png`, and it visibly collides with the MAP nav item), the Handoff masthead is **descending gold gradient**, and `icons/forge-512.png` — the icon a user installs — is **descending bone monochrome**. §9's "ask Luke which logo" understates it; the installed artifact is already a committed answer.
- **`uploads/` = 126 files, ~72MB, dated 23–28 Jul 2026.** Not junk. It contains rendered site sections **with finished illustration assets in place** (e.g. `Screenshot 2026-07-24 at 8.46.56 AM.png` — "THE BREAKTHROUGH / Build without a ball. Golf's Fosbury Flop." with two commissioned line-art high-jumper illustrations; "Fosbury"/"foam pit" appears 7× in the live site). So §2.8 is stronger than stated: it isn't that no imagery exists — **the imagery was produced and the handoff wires none of it up.** Also `Screenshot 2026-07-25 at 5.19.07 PM.png` is Luke's concept art mapping SHOP/LAB/ARENA onto brain regions with "RUN S.C.O.[RE]" — independent evidence that the place-alias vocabulary is live, not stale.
- **`support.js` is not product code** — it's a generated Design Canvas runtime (`// GENERATED from dc-runtime/src/*.ts`) that compiles `<x-dc>` templates at runtime against `window.React`. There is no build, no components, no package. §8.2 reaches the right conclusion ("design the coach product, not port Luke's file") for the wrong reason: porting isn't hard, it's *undefined*.

### What's solid — verified, don't revisit

Zero `<img>` in the site (confirmed 0). Arccos absent from the site (confirmed 0 hits). Five build steps with Cannon/Anchor pivot variants and per-drill `cam: true` (`Dashboard.dc.html:2477+`). `atlas.player.v3` with `OLD_KEYS = ['atlas.forge.v1','atlas.forge.v2','atlas.forge.v3','atlas.player.v1','atlas.player.v2']` (`:1044–1045`) — the Forge→Atlas migration claim is exact. No user id anywhere in player state (`:1369–1378`). The 95%/<24h SLA and Parallax's three contradictory entitlements are on a single line (`Atlas.dc.html:488`). `playerName` default `'Marcus Hale'` as the only prop (`Dashboard.dc.html:4906`).

**One report item I checked and am dropping rather than manufacturing:** the sample testimonials are labeled honestly in both files — `Atlas.dc.html:682` reads "Sample testimonials · replace with verified client results" under a heading "The record — sample results." Not a risk. The §9.1 ROSTER-PII concern is the real one and stands.