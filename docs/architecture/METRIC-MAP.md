# Metric map — synthesis

**Generated 2026-08-18** from an app-by-app inventory of RYP-RED, Locker Room, Debrief, and the Atlas/Forge specs.

Its job was to answer two questions: **which schema owns each metric**, and **what each role may reach**. Companion to `ECOSYSTEM.md`; the live database state is in the `ryp-core` notes.


> ⚠️ This is a *proposal* produced by analysis, not a decision. Several entries conflict with what already exists in `ryp-core` — those are called out in the last section. Review before applying.


---

## 1. Schema assignment


### `public`

- `users`
- `user_app_roles`
- `user_relationships`
- `coach_profiles`
- `feature_flags`
- `organizations`
- `org_memberships`
- `terms_acceptances`
- `app_invites`
- `billing_subscriptions`
- `content_entitlements`
- `coaching_credits`
- `deletion_requests`


IDENTITY. Writer: atlas_app, EXCEPT user_app_roles / feature_flags / billing_subscriptions / content_entitlements / coaching_credits which are billing_svc-write-only from day one (that is what makes the demonstrated self-grant escalation never exist here). 8 of these 13 are ADDITIONS to eco's identity.ts and need a verify:schema update, since eco owns public.* migrations. users is LEAN: id, firebase_uid, email, display_name, date_of_birth, timezone, plan, parental_consent_at, deleted_at, created_at, updated_at. It carries NO golf columns (-> golf.player_profile), NO Red analytics (-> ryp_red.user_blueprint), NO Stripe columns (-> billing_subscriptions), NO tutorial flag (-> ryp_red). feature_flags gains an `app` column with composite PK (app, key). user_relationships gains the unique index on (actor_user_id, subject_user_id, app, relationship) that production lacks. Every authorization read must filter isNull(deleted_at) on user_app_roles and require status='active' AND approved_at IS NOT NULL on user_relationships. Keep timestamp without time zone, no ON DELETE cascade, soft delete only.



### `atlas`

- `practice_dna_results`
- `practice_dna_scales`
- `zone_grades`
- `prescriptions`
- `coaching_notes`
- `communication_profile`
- `score_profile`
- `score_profile_snapshots`
- `coachability_dimensions`
- `tendencies`
- `impact_notes`
- `intake_submissions`
- `ai_reads`
- `messages`


THE COACHING BRAIN. Writer: atlas_app ONLY — ECOSYSTEM.md §2 deliberately contrasts atlas (writer: Atlas) with golf (writer: per table), and that contrast is preserved. Producers in other apps re-point to an ASYNC, RETRYING Atlas ingest API rather than writing atlas.* directly: the Typeform S.C.O.R.E. webhook moves out of Locker Room and becomes an Atlas endpoint (it is already just a shared-secret webhook); Debrief POSTs its distilled communication_profile, longitudinal failure-mode trend, and practice_focus; Locker Room POSTs the distilled coachability dimensions. Async + retrying means an Atlas outage never takes down Red, Locker Room or Debrief, so the no-request-time-chokepoint rule holds. ONE DOCUMENTED EXCEPTION: atlas.messages takes INSERT from atlas_app, forge_app and lr_app. RESTRICTED GRANT (atlas_app only, pending a consent decision): practice_dna_scales (Mini-IPIP Big Five trait scores about a named person) and intake_submissions (injury narrative, interview answers). Every table carries source_app plus config_version / scoring_version / result_version — a stored result is uninterpretable after the instrument changes, and the A-F grade bands are already slated for re-cutting. Zone grades are criterion-referenced, not norm-referenced: a C means middling prior-awareness, not 'average golfer'. Heat-kernel geometry and the AI read are computed/cached at read time, never stored as truth.



### `golf`

- `player_profile`
- `handicap_history`
- `bag`
- `club_measurements`
- `player_metrics`
- `impact_reads`
- `player_goals`
- `player_checkins`
- `player_availability`
- `courses`
- `course_holes`
- `course_geometry`
- `course_geometry_overrides`
- `seasons`
- `tournaments`
- `rounds`
- `round_holes`
- `round_shots`
- `practice_sessions`
- `practice_shots`
- `practice_index_results`
- `practice_days`
- `drill_library`
- `drill_progress`
- `knowledge_chunks`
- `weather_cache`


SHARED GOLF TRUTH. WRITERS ARE PER TABLE — grant per table, never per schema. atlas_app: player_profile, seasons, impact_reads, drill_library. red_app: courses, course_holes, course_geometry(+overrides), rounds (real), round_holes, round_shots, bag, club_measurements, handicap_history, tournaments. forge_app: practice_sessions, practice_shots, practice_index_results, practice_days, club_measurements, drill_progress (ticked/watched columns), rounds (is_simulated=true), skill inputs. lr_app: player_checkins, player_availability, player_goals, drill_progress (verified/signed columns). debrief_app: tournaments, rounds (scheduled shell only), player_goals. Per-source writers on player_metrics (forge/red/debrief/atlas/parallax_svc). RENAMES that supersede ECOSYSTEM.md §2's `golf.holes`: course_holes = static reference, round_holes = the scored per-round record. rounds.is_simulated NOT NULL DEFAULT false so Red's analytics filter without a later migration. NARROWED GRANT GROUP: player_checkins + player_availability are health-adjacent — SELECT to atlas_app/lr_app/forge_app; red_app gets status only, not the mental/physical battery. knowledge_chunks is authenticated-read, ingest-service-write; clinical reference material goes in a SEPARATE table granted to debrief_app alone and must never be reachable by a general RAG query in Red or Forge.



### `ryp_red`

- `user_blueprint`
- `club_dispersion`
- `round_analytics`
- `hole_analytics`
- `esg_rolling_window`
- `round_entry_state`
- `app_state`
- `feedback`


APP-PRIVATE. red_app full CRUD; no other role gets USAGE. user_blueprint holds what leaves public.users: blueprint_weight, blueprint_shot_count, lateral_sigma_model/measured/blended, lateral_bias_yds — Red's FCF/SAF opinion, not a measurement (note the live inconsistency to resolve: the maturity threshold is shots/80 in ssg-engine but shots/40 in the GSpro import). club_dispersion = per-club lateral_sigma_yds / lateral_bias_yds / shot_count, now derivable from shared golf.practice_shots instead of from a discarded CSV. round_analytics = ssg_total, esg_total, predicted_score, sim_score, ai_insight, card_image_url. hole_analytics = ssg, esg, shape_ssg, pin_location_confidence, aim_provenance_valid (schema.ts already labels this block 'Computed, not extracted' — the file draws the boundary itself). Everything response-only stays response-only: the dispersion model outputs, per-shot optimal-aim solution, the four analysis pages, /trends, the hash-jittered scatter, wind effect, the Aim Trainer, the free-tier counters. esg_rolling_window is a BUILD-OR-DROP call: the drift monitor is implemented but every caller passes an empty window, so it never fires. app_state = tutorial_completed_at. FREE-TIER CAP: today client-only (FREE_TIER_ROUND_CAP=3, its own comment concedes it is 'a UX hint, not a hard gate') — a free user bypasses it by calling the API. Add server enforcement or drop the cap.



### `locker_room`

- `roster`
- `assessments`
- `conflict_scripts`
- `player_notes`
- `ai_protocols`
- `recruits`
- `notifications`
- `app_state`
- `feedback`


APP-PRIVATE. lr_app full CRUD. roster = the trimmed players table: player_user_id (NULLABLE on purpose so a roster slot can exist before an account does — that nullability is load-bearing), org_id, year, position, gpa, major, onboarded, pulse_streak. DROP AND DO NOT RECREATE 11 dead columns: universities.player_count/coach_count/revenue/dau/compliance_rate/red_flags_generated and players.current_physical/current_mental/prev_pulse/motivation/pulse_compliance/injury_status/learning_style — all seed-only fiction, several still feeding the AI prompt or driving the coach watchlist. name/avatar are dropped (read public.users). assessments keeps the RAW dyadic items q1..q23 + the free-text contexts (a player describing what their coach does wrong — the highest-sensitivity text in the app) + respondent role + assessment_type + season; only the distilled 7 dimensions leave. conflict_scripts becomes a real table instead of being hardcoded in two places in routes.ts, and the conflict scoring logic (triplicated across client scoreLogic.ts:113, routes.ts:1189 and routes.ts:764, already drifting) collapses to one server-side implementation. player_notes: state the policy explicitly — today RLS keys on coach_user_id alone, so a head coach and their assistant cannot see each other's notes on the same player; the redundant university_id column is dropped. ai_protocols survives only if Atlas does not take over prescription generation. recruits stays private: hand-typed scouting numbers about people who have never played a round in the system, and they must NOT be merged with golf.rounds.



### `debrief`

- `debriefs`
- `mental_pillars`
- `digests`
- `ask_sessions`
- `knowledge_tags`
- `push_subscriptions`
- `notification_prefs`
- `round_notify_state`
- `clinical_reference`


APP-PRIVATE, and the most sensitive schema in the ecosystem. debrief_app full CRUD; NO other role gets USAGE — in particular lr_app must never reach it, because the product intent ('academy players appear in Locker Room so their coach sees their Atlas data') is the concrete leak path. HARD CONSTRAINTS: register_snapshot (clinical level 1-4 with verbatim signals — level 4 is self-harm language), flagged_thoughts (3-6 quotes the prompt forbids paraphrasing), register_flagged_at (fired live mid-conversation, independent of the post-hoc snapshot, so the two can disagree), and register_acknowledged/ack_at/ack_text (a legal record snapshotted verbatim — do NOT let a rebuild replace it with a boolean plus a copy lookup) are never promoted and never reachable through public.user_relationships. The 30-day audio TTL survives verbatim; it is the named mitigation for the legal-hold exposure. mental_pillars is the RENAMED S.C.O.R.E. (see overlaps). debriefs FKs to golf.rounds (nullable, for pre-round). DROP: debrief_embeddings (dead — nothing writes or queries it; pgvector is vestigial and retrieval is Postgres FTS), the prescriptions table (dead AND stale zone vocabulary), user_profiles (decomposed into public/golf/atlas + notification_prefs), the five re-typed round columns, the player_facts jsonb blob (an unbounded LLM-written key space whose keys duplicate real columns), and the never-read role CHECK. clinical_reference exists only if clinical material is actually ingested. Also DECIDE: the /api/session-summary route generates the most user-legible homework in the app and throws it away — persist it into atlas.coaching_notes or delete the route.



### `forge`

- `index_expected`
- `session_meta`
- `skill_radar`
- `sga_results`
- `calibration`
- `lm_imports`
- `player_state`
- `stakes`


APP-PRIVATE, Luke's. Needs a forge_app NOBYPASSRLS login role with per-table grants on golf.* (INSERT/UPDATE on practice_*, drill_progress player columns, club_measurements, player_metrics; SELECT on player_profile, bag, courses, drill_library, atlas.prescriptions/zone_grades) — whoever stands up ryp-core has to create a role for an app they do not own, so this is part of the data contract with Luke. index_expected is Luke's expected-value model, the direct parallel to Red's blueprint internals staying private; only the sg it produces is promoted. session_meta holds level, challenge, primary_leak (deliberately NOT promoted — 'what to work on next' is atlas.prescriptions.growth_zone, and two competing priority labels shown to one player is a product contradiction), recap and conditions. skill_radar is the RENAMED 5-axis `dna` (see the name-collision overlap). calibration: the coach override (setBy='coach') must be an API call to Luke's service, never a cross-schema INSERT, or rule 1 breaks. lm_imports keeps the raw file in R2 with a key reference, not in Postgres. player_state must NOT duplicate handicap/carry/handedness — those come from golf.player_profile.



### `atlas_private`

- `ui_state`
- `onboarding_state`
- `notification_prefs`
- `dashboard_state`


NEW, and it resolves a real hole: Atlas owns public + atlas + golf, all shared, so rule 1 leaves its own UI/session state homeless. Putting the coach Dashboard's active tab, open build step, watched/expanded flags, demo mode, onboarding step and notification prefs in atlas.* would make every app able to read widget state and pollute the coaching brain. atlas_private breaks the app-named-equals-private convention only cosmetically (the _private suffix preserves the intent) and it is cheap. atlas_app only. If Makel prefers, the alternative is client-side-only — but then coach Dashboard state does not survive a device change.



### `practice_dna`

- `quiz_runs`


DEFERRED — out of scope this phase, and EXCLUDED from the seed script and the GRANT list. Listed only so a schema author does not invent tables for it. When it joins: raw quiz answers stay here (the answers column is the re-score lifeline — results are recomputed from it on every read), the distilled result goes to atlas.*, and hcp/speed/handedness go to golf.player_profile. Two carve-outs it will need: it is the ONLY anonymous-write surface in the ecosystem (most rows keep user_id NULL, so owner-scoped RLS breaks it), and its instrument-QA fields (attention checks, server-side quality_flag) are explicitly never shown to the golfer and must not leak into atlas.* where a coach's app could read 'this player answered carelessly'. GUARD: do not point its DATABASE_URL at ryp-core — migrate() runs on boot, so setting that variable IS a schema-create.



---

## 2. Cross-app overlaps


A metric appearing in more than one app belongs in a shared schema by definition. Where two apps model the same thing incompatibly, the conflict is stated rather than merged.


### Identity anchor (firebase_uid, email, display_name)

**Apps:** ryp_red, locker_room, debrief, atlas, forge

**Verdict:** public.users owns it; atlas_app is the only writer. Every other app is SELECT-only and provisions through eco's shared attachUser cold-start path, not a direct INSERT. Debrief's Supabase auth and handle_new_user() trigger are deleted; Debrief re-points to Firebase. This is a blocking code change for Locker Room (4 write sites) and a full auth swap for Debrief.


> **Conflict:** THREE apps mint the human today. Locker Room INSERTs public.users on first token (auth.ts:92-96) and again on recruit conversion (routes.ts:390, which also calls Firebase createUser with a plaintext password from the coach's request body). Red onboards via its own route. Debrief has a Supabase handle_new_user() trigger on auth.users and its own user_profiles.name. Debrief is not even on Firebase (6-digit email OTP), breaking rule 4.


### App role vocabulary

**Apps:** ryp_red, locker_room, debrief, atlas

**Verdict:** public.user_app_roles with eco's enums.ts vocabulary. Seed 'player' for every player row in every app; 'user' stays in the vocabulary only until Locker Room's two inserts are patched, then is retired. Do NOT seed 'golfer' — map it to 'player'. Do NOT seed red/parent or debrief/coach at all (no reader exists; for debrief/coach it is the exact grant that must not exist).


> **Conflict:** Four vocabularies. Red writes 'player' and accepts player|coach|admin|parent. Locker Room writes 'user' (routes.ts:396) and 'coach' (:1896) and its RLS helper reads 'assistant_coach'. Debrief declares a CHECK for golfer|coach|admin that is NEVER READ anywhere in the codebase. eco enums.ts declares user|player|coach|assistant_coach|admin.


### Terms acceptance / consent record

**Apps:** ryp_red, debrief, atlas, locker_room

**Verdict:** NEW public.terms_acceptances (user_id, app, terms_version, accepted_at) — one row per app per version. atlas_app writes; each app writes its own row through the Atlas ingest path. Retire the single nullable column. parental_consent_at stays on public.users.


> **Conflict:** Red models one global public.users.terms_accepted_at + terms_version. Debrief's Register-4 acknowledgment text explicitly cites 'the terms I accepted when joining Debrief' — i.e. consent to clinical-adjacent flagging. A single nullable timestamp means a user who accepted Red's terms is treated as having consented to Debrief's clinical flagging.


### Plan / entitlement tier

**Apps:** ryp_red, locker_room, atlas, debrief

**Verdict:** public.users.plan with PLANS = ['free','pro','coaching','elite'] — the SUBSCRIPTION ladder only. The four one-time content tiers become rows in NEW public.content_entitlements(user_id, sku, granted_at), because 'all eight Impact Opposites' is content ownership, not a tier. Org-level entitlement moves to public.organizations.plan/license/status. billing_svc is the only writer of plan; Stripe state moves off users entirely (see below).


> **Conflict:** FOUR incompatible models. Red: public.users.plan free|pro, Stripe monthly|annual, with an 'admin_override' sentinel in subscription_status. Locker Room: universities.tier (Tier 1-3) + .license (Starter/Pro/Enterprise) + .status — all validated, stored, displayed, and NEVER read to authorize anything. Atlas site: six tiers, four one-time and two subscriptions. Atlas coach Dashboard: three tiers (Foundation/Builder/Competitive). Database: two values.


### Stripe / billing state

**Apps:** ryp_red, atlas

**Verdict:** NEW public.billing_subscriptions (user_id, provider, stripe_customer_id, stripe_subscription_id, status, current_period_end, price_interval). billing_svc is the sole writer; red_app loses UPDATE on users entirely. Keep 'admin_override' as a recognised status sentinel. Red's Stripe webhook becomes a billing_svc-credentialed service, not a red_app path.


> **Conflict:** Red writes public.users.stripe_customer_id / stripe_subscription_id / subscription_status / subscription_current_period_end directly from its own webhook, and its admin route forces plan='pro' with subscription_status='admin_override'. Under the target, Atlas owns public.* — so Red's webhook is writing another app's schema.


### Feature flags

**Apps:** ryp_red, atlas, forge, debrief, locker_room

**Verdict:** public.feature_flags gains an `app` column with composite PK (app, key). Writes stay bypass-only (billing_svc). Red's lazy seed-on-first-read is DELETED — all keys move into the seed script. RESOLVE THE CONTRADICTION IN THE SEED, do not average it: set ryp_red/trainer.enabled plan_required='pro' to match requirePro.


> **Conflict:** public.feature_flags has NO app column while every seeded key is Red-specific (analysis.*, gps.range, trainer.enabled). Keys are global and collide the moment a second app seeds. Worse, Red seeds trainer.enabled with plan_required='free' while the endpoint it gates sits behind requirePro — a free user sees the Aim Trainer unlocked and then gets a 402.


### Coach identity

**Apps:** locker_room, atlas, ryp_red, forge

**Verdict:** public.coach_profiles is the single record, plus a NEW calendly_url column. locker_room.profiles is deleted: name/avatar are dropped (read public.users), university_id becomes public.org_memberships, and the 7 coach-style dimensions go to atlas.coachability_dimensions keyed (user_id, respondent_role='coach').


> **Conflict:** public.coach_profiles is declared and RLS'd but NO Red route touches it. Locker Room maintains locker_room.profiles as a full shadow (name, avatar, university_id) and auth.ts:233 already falls back profile.name -> users.displayName -> email, so the two silently diverge. The Atlas site promises a Calendly-booked coach directory but coach_profiles has no calendly_url column.


### Coach-to-player linkage

**Apps:** locker_room, atlas, forge, ryp_red, debrief

**Verdict:** BOTH, deliberately. public.user_relationships (actor/subject/app/relationship/status) is the direct edge for 1:1 coaching, gated on status='active' AND approved_at NOT NULL. NEW public.organizations + public.org_memberships is the team/academy scope Locker Room's RLS keys off. Add the unique index on (actor_user_id, subject_user_id, app, relationship) that production lacks. atlas_app writes both.


> **Conflict:** Two incompatible mechanisms. Locker Room scopes entirely by shared organization (app_private.locker_room_scope_university_id() COALESCEs players.university_id ahead of profiles.university_id — players scope by roster row, coaches by profile row); every LR RLS policy keys off it. Atlas models a direct coach->player edge (public.user_relationships) and its prototype hardcodes eight players. Red declares user_relationships but no route touches it, and its policy only exposes rows where the caller is actor or subject, so no coach-reads-player path exists at all.


### Organization / university / team

**Apps:** locker_room, atlas, forge, debrief

**Verdict:** NEW public.organizations (name, type academy|university|team, status, plan, license) + public.org_memberships (user_id, org_id, role, status). This is a genuine ADDITION to the stated public.* list. All six dead counter columns are dropped, not migrated. Require explicit tenant assignment — no auto-link, no unscoped fallback.


> **Conflict:** Only Locker Room has it today, as locker_room.universities — carrying six DEAD columns (player_count, coach_count, revenue, dau, compliance_rate, red_flags_generated) with zero writers whose displayed values are all seed fiction, while routes.ts:1943 recomputes the real numbers live. Also a tenancy hazard: getDefaultUniversityId() creates a university from one env var and silently links every new coach and player to it, and two routes fall back to querying ALL players/recruits unscoped when universityId is null.


### Invites / access grants

**Apps:** locker_room, atlas

**Verdict:** NEW public.app_invites (email stored lowercased with a CHECK, app, org_id, role, invited_by_user_id, accepted_at, revoked_at). atlas_app writes. Acceptance mints the user_app_roles row via billing_svc, never from lr_app.


> **Conflict:** locker_room.coach_invites is consumed as identity provisioning: an unrecognized email is matched against an open invite, an assistant_coach role row is minted, and profiles.university_id is auto-linked. Revocation also deletes the role row, so the invite table and public.user_app_roles are already one coupled mechanism in two schemas. Three different email-case treatments exist (lowercased lookup, non-normalized insert, lower()=lower() in RLS).


### Account deletion and purge

**Apps:** ryp_red, debrief, atlas, locker_room, forge

**Verdict:** public.users.deleted_at is the account-level tombstone; user_app_roles.deleted_at stays per-app revocation. NEW public.deletion_requests (user_id, requested_at, purge_after, completed_at) is the fan-out coordinator — each app runs its own purge job against it and stamps its own completion. Debrief keeps its 30-day audio TTL and grace window verbatim; it is the named legal mitigation.


> **Conflict:** Red's DELETE marks the user_app_roles row deleted and soft-deletes rounds in one transaction (per-app erasure, correct). Debrief's purgeUser() clears only its own 6 tables then calls auth.admin.deleteUser() — under a shared public.users that orphans Red, Locker Room and Forge rows. Locker Room has no deletion path at all.


### handicap_index

**Apps:** ryp_red, debrief, atlas, forge, locker_room

**Verdict:** golf.player_profile.handicap_index + handicap_source, plus NEW golf.handicap_history (user_id, handicap_index, source, measured_at) — the history series is the evidence behind the 90-day guarantee. atlas_app writes the profile; red_app may append history. Delete Debrief's copy.


> **Conflict:** Red keeps it on public.users (player-stated or from the RYPstick Firestore profile) and consumes it as the input to buildDispersionModel. Debrief keeps a second numeric copy on user_profiles that no prompt reads. eco already declares golf.player_profile.handicap_index. Practice DNA has BOTH a self-estimate and an objective value and resolveHandicap() prefers the objective one. Locker Room stores ZERO handicap for its own players (recruits.scoring_avg is hand-typed scouting data about non-users — explicitly NOT the same metric and must not be merged with it).


### handedness

**Apps:** debrief, ryp_red, forge, atlas, locker_room

**Verdict:** golf.player_profile.handedness, atlas_app write, everyone else SELECT. The fix is a read, not a better extractor. Debrief's player_facts jsonb blob is decomposed into named columns and NOT carried over.


> **Conflict:** The sharpest instance of the two-sources problem. eco already declares golf.player_profile.handedness (default 'right'), Red keeps it on public.users, and Debrief INFERS it from casual chat with a Haiku call into an uncontrolled player_facts jsonb key. That is literally the documented 'Luke forgets I am left-handed' bug.


### Driver carry / per-club carry distance

**Apps:** ryp_red, forge, atlas, debrief

**Verdict:** NEW golf.club_measurements (user_id, club, source, carry_yds, ball_speed, spin, measured_at) is ground truth — forge_app and red_app both write, tagged by source. golf.player_profile.driver_carry_yds is demoted to a cached self-reported headline, explicitly not a second source of truth.


> **Conflict:** THREE sources for one number. Red collects a self-reported users.driver_carry_yds at onboarding AND holds club_profiles.measured_carry_yds from a launch monitor AND derives a round-history carry capped by maxPlausibleCarryYds. Forge's lm_imports is the same measurement from Luke's side. eco declares golf.player_profile.driver_carry_yds.


### The bag (which clubs the player carries)

**Apps:** ryp_red, forge, atlas, debrief

**Verdict:** NEW golf.bag (user_id, club_name, source, in_bag). red_app and forge_app write; debrief_app SELECT-only so Yannick stops asking 'what did you hit?'. Red's per-club dispersion statistics stay private (below).


> **Conflict:** Red's ryp_red.club_profiles IS the bag, canonicalised against VALID_CLUB_NAMES and provenance-tagged, managed by PUT /api/ryp-red/bag. Debrief re-extracts clubs/equipment from chat into player_facts. Forge cannot prescribe practice without it.


### Raw launch-monitor shots

**Apps:** ryp_red, forge, atlas, debrief

**Verdict:** golf.practice_shots (session_id, domain, shot_index, measured_at, payload jsonb whose shape Luke owns) plus golf.club_measurements for the parsed per-club summary. forge_app and red_app write. This is a real GAP, not just a classification — and it is the clean resolution of the club_profiles.lateral_sigma_yds tension: persist the raw shots shared, let each app derive its own sigma privately.


> **Conflict:** Red ingests up to 2MB of GSpro CSV, computes per-club summaries, and THROWS THE SHOTS AWAY — no table anywhere holds them. Forge's whole protocol is built on practice shots. Two apps then each derive their own per-club sigma from data neither retains.


### The round record

**Apps:** ryp_red, debrief, forge, locker_room, atlas

**Verdict:** golf.rounds — user_id, course_id, tee_set, played_at, scheduled_at, tee_time, holes_played, round_type (controlled vocabulary), competition_mode, is_simulated NOT NULL DEFAULT false, total_score, total_putts, status, tournament_id, geometry_id, deleted_at. red_app writes real rounds, forge_app writes simulated ones (per-table writers is already golf.*'s model). Debrief's five typed columns are DELETED and replaced by a nullable round_id FK — nullable because pre-round reflections attach to a scheduled round before it is played. Red's analytics MUST filter is_simulated.


> **Conflict:** Red's ryp_red.rounds is canonical. Debrief makes the golfer RE-TYPE the same round by hand (round_date, course free text, tees free text, score, holes, round_type) and holds exactly one score integer with zero per-hole data. Forge tracks simulated rounds as their own separate series (score vs par, clean flag, leak count). Locker Room holds no rounds for its own players.


### Course identity

**Apps:** ryp_red, debrief, forge, locker_room, atlas

**Verdict:** NEW golf.courses (name, club_name, external_ids jsonb reconciling golfcourseapi_id + osm_relation_id, city/state/country) + golf.course_holes (course_id, tee_set, hole_number, par, yardage, hdcp). red_app writes, everyone FKs. This is a genuine schema gap, not a classification call — nothing downstream ('does he play worse at his home track?') works until it exists.


> **Conflict:** FIVE incompatible course identities and ZERO canonical rows. Red alone has three: free-text rounds.course_name, an external golfcourseapi integer with no FK (the course is never cached in Postgres — golf-courses.ts is a live passthrough), and course_geometry.osm_relation_id from OpenStreetMap. Debrief adds free-text debriefs.course and user_profiles.home_course. Forge's prototype hardcodes RAW_COURSES.


### Per-hole record — NAME COLLISION

**Apps:** ryp_red, debrief, forge, atlas

**Verdict:** RENAME BOTH: golf.course_holes for the static reference, golf.round_holes for the scored record. This supersedes the golf.holes name in ECOSYSTEM.md §2. red_app writes round_holes; Red's computed block (ssg, esg, shape_ssg, pin_location_confidence, aim_provenance_valid) stays in ryp_red.hole_analytics.


> **Conflict:** The target names golf.holes as static course hole reference. Red's `holes` table is the PER-ROUND scorecard, ~50 columns of card entry (tee/layup/approach/ATG blocks, wind, pin wheel, score, putts, shot counters). Both cannot be golf.holes. This must be settled before any DDL.


### Shots

**Apps:** ryp_red, forge, debrief, atlas

**Verdict:** TWO tables: golf.round_shots (red_app writes) and golf.practice_shots (forge_app writes). Not one table with two nullable FKs — the payloads genuinely differ and every consumer would carry a discriminator forever. Debrief unions them when it needs cross-context analysis. Red's plot-space scatter stays response-only in ryp_red.


> **Conflict:** Red's shot_locations are GPS marks from a played round. Forge's are typed practice shots with per-domain payloads (chip/putt/approach/driving). Debrief needs both — its Observe failure codes (invented_pattern, self_serving_distortion) are falsifiable claims that today the model can only take the golfer's word on. Red also computes a synthetic hash-jittered scatter for its dispersion plot that would be actively misleading if any app read it as real positions.


### Recorded conditions (wind, weather)

**Apps:** ryp_red, forge, debrief, atlas

**Verdict:** The recorded observation is shared: wind columns stay on golf.round_holes; optional golf.weather_cache if it is ever cached — once for the ecosystem, not per app. The MODELLED adjustment (Red's applyWindToDispersion, Forge's conditions math) stays app-private; Forge would legitimately model wind differently.


> **Conflict:** Red records six wind columns per hole (legacy wind_* mirrors tee wind for old clients) and fetches live weather as an uncached passthrough with coords rounded to 2dp. Forge keeps a private conditions payload on its session. Each app models the wind EFFECT with its own coefficients.


### Practice sessions and results

**Apps:** forge, atlas, debrief, locker_room

**Verdict:** golf.practice_sessions (started/completed, domains[], composite, transfer_gap), golf.practice_index_results (domain, index_value, sg), golf.practice_shots, golf.practice_days (a practice day can exist with no Forge session — gym work, putting at home). forge_app writes; atlas/debrief/lr read. Promote index_value and sg only — Luke's `expected` benchmark stays forge-private. transfer_gap is promoted deliberately so Atlas does not compute a rival number.


> **Conflict:** Forge produces them; Atlas's efficiency formula, Debrief's homework follow-through, and the Locker Room coach view all read them. Today Debrief's computeFollowThrough() measures pillar movement across ROUNDS and silently assumes the homework was practised — it conflates 'did not practise' with 'practice did not help' because there is no practice table to join.


### Drill library

**Apps:** debrief, forge, atlas, locker_room

**Verdict:** NEW golf.drill_library (code, name, zone, domain, steps jsonb, video_ref, plan_required) — forge_app and atlas_app write, everyone reads. Debrief's dead table is DROPPED, not carried over. Locker Room's conflict scripts become locker_room.conflict_scripts (its own coaching voice, and it must stop being source code).


> **Conflict:** Debrief has a prescriptions table that is DEAD (zero reads or writes anywhere) AND STALE — its zone enum (Lab/AssemblyLine/Crucible/Arena) has drifted from the vocabulary the shipped textbook actually uses (Construction/Calibration/Transfer/Performance). Forge has DRILL_DEFS and STEPS as code literals. Locker Room hardcodes a 24-item conflict script library in TWO places in routes.ts, already drifting.


### Drill progress and coach sign-off

**Apps:** forge, atlas, locker_room

**Verdict:** NEW golf.drill_progress (user_id, drill_id, ticked_at, watched_at, verified_at, verified_by_user_id, signed_off_at). Per-COLUMN writers: **ATLAS** writes ticked/watched, atlas_app and lr_app write verified/signed. Parallax video stays an external videoRef string, not modelled.

> ⚠️ **AMENDED 2026-10-19 (T-131).** This said *"forge_app writes ticked/watched"*, and it was correct when written. **T-105** moved FORGE onto ryp-core inside Atlas's own Express server, so there is no foreign app whose contract a grant could fork; **T-119** settled that a FORGE rep is not coach-verified, and the delivered FORGE package produces no tick or watch anywhere. The column therefore had no writer and no future producer, and the build screen rendered **"0 of 23 drills completed"** off it for every player. `ticked_at` / `watched_at` are Atlas's, written by the player on the build screen.
> 🔴 **And "per-COLUMN writers" is not a grant.** `atlas_app` is ONE role serving both players and coaches, and a grant is per ROLE — so the split between the player's claim and the coach's judgement is carried by the BEFORE INSERT OR UPDATE trigger `app_private.drill_progress_column_owner()`, which raises 42501 in both directions. See the `golf.drill_progress` block of eco's `sql/rls_core.sql`.


> **Conflict:** The player ticks and watches (Forge); the coach verifies and signs off (Atlas coach Dashboard / Locker Room). The build plan puts it in forge.*, which would require Atlas to write another app's private schema — a direct rule-1 violation.


### Coaching knowledge corpus (the golf textbook RAG)

**Apps:** debrief, forge, atlas, locker_room, ryp_red

**Verdict:** NEW golf.knowledge_chunks (source, chapter, concept_name, content, token_count, fts) — a content ingest service writes, all apps SELECT. Per-app retrieval tagging (related_pillar, related_failure_mode, tier) does NOT promote — it is keyed to Debrief's 18-code instrument and stays debrief.knowledge_tags. Clinical material gets a SEPARATE table with a grant to debrief_app only; it must never be reachable by a general RAG query in Red or Forge.


> **Conflict:** The corpus is in Debrief's database but serves both Yannick AND Luke (Forge's coach), and it is the same textbook Forge's zone model is built on. Its schema anticipates a source='clinical' value sitting in the same authenticated-read-to-everyone table as swing content. pgvector is vestigial — retrieval is Postgres FTS; nothing populates the embedding column.


### S.C.O.R.E. — THE KNOWN INCOMPATIBILITY. DO NOT MERGE.

**Apps:** locker_room, debrief

**Verdict:** SPLIT AND RENAME NOW, while it is still cheap (nothing in eco defines either). Locker Room's promotes to atlas.score_profile + atlas.score_profile_snapshots (the snapshots exist only because players.score_* overwrites in place). Debrief's is RENAMED debrief.mental_pillars and stays app-private — it is one app's opinion over one transcript. Only Debrief's LONGITUDINAL failure-mode trend (incidence in the recent 5-round window vs the prior 5, filtered to modes seen >=2 times, computed in lib/progress.ts and never persisted) promotes, to atlas.tendencies. That trend is the one thing in Debrief that genuinely is a distilled tendency rather than a session opinion.


> **Conflict:** Same acronym, two different instruments. Locker Room: Strategy/Commitment/Observation/Reset/Engage, 0-25 each, sourced from an EXTERNAL Typeform webhook that Locker Room never computes, producing 26 archetypes. Debrief: Strategize/Commit/Observe/Reset/Engage, 1-10 each plus 18 failure-mode codes, LLM-extracted from one post-round transcript by a Haiku pass against Yannick's rubric. Locker Room's is trait-level; Debrief's is per-round. Merging them by name would silently fuse two measurement systems.


### Archetype / persona — THREE incompatible vocabularies

**Apps:** locker_room, debrief, atlas, forge

**Verdict:** atlas.practice_dna_results.archetype (the 6-value Practice DNA vocabulary) is THE archetype — Atlas writes it, Forge/Debrief/Locker Room read it. Locker Room's 26 labels become a rendering of atlas.score_profile, moved server-side out of client code. Debrief's persona column is DELETED (it is dead) and Debrief reads the Atlas archetype to pick a coaching register.


> **Conflict:** Locker Room: 26 S.C.O.R.E. archetypes (Architect, Tactician, Zealot, Zen Master...) computed in CLIENT code (scoreLogic.ts) so every consumer must re-implement it. Debrief: persona Scientist|Engineer|Warrior|Artist, which is DEAD — nothing writes it, the only reference sets it back to null, and its extraction prompt does not produce it, yet knowledge_chunks.related_persona is built to filter on it. Atlas/Practice DNA: 6 archetypes (architect, quickFixJunkie, comfortCreature, scrappyGamer, naturalEngineer, naturalArtist).


### 'DNA' — name collision

**Apps:** forge, atlas

**Verdict:** RENAME Forge's to forge.skill_radar and keep it APP_PRIVATE_DERIVED (it is a Forge visualization of Forge's own indices, fully derivable from the promoted index results). 'Practice DNA' refers only to the Atlas instrument.


> **Conflict:** Forge's prototype has a 5-axis skill radar it calls `dna` (offTheTee, approach, aroundTheGreen, putting, speedDistance). Atlas's Practice DNA is a mental archetype/tendency instrument. A schema author will merge them by name — the same class of error as the two S.C.O.R.E.s.


### Communication / coaching register profile

**Apps:** debrief, ryp_red, forge, locker_room

**Verdict:** atlas.communication_profile. Atlas writes; Debrief POSTs the smoothed profile to an Atlas ingest route. Pick ONE smoothing constant and rename the clinical-sounding dimension before it is readable by every app.


> **Conflict:** Debrief's register_profile is a smoothed 5-dimension profile of HOW to talk to this golfer, explicitly independent of performance. Red's caddie voice and Forge's prescription register both need it and would each re-derive their own. Two bugs to fix on the way: the prompt's smoothing constant (0.8/0.2) disagrees with the code (0.7/0.3), and 'psychological_sophistication' is clinically-framed naming on a profile that is about to become ecosystem-readable.


### Coaching output / homework / prescriptions — FIVE parallel producers

**Apps:** debrief, forge, atlas, locker_room, ryp_red

**Verdict:** atlas.prescriptions (growth_zone, ordered ladder steps, recommended_alloc, source_app, status) and atlas.coaching_notes (source, content, done, target_user_id, author_user_id) — Atlas is the SINGLE WRITER; Debrief and Locker Room POST to an async, retrying Atlas ingest route rather than writing atlas.* directly. This fixes the build plan's rule-1 violation (forge.plans becomes atlas.prescriptions, forge.drill_progress becomes golf.drill_progress). Forge's primaryLeak stays private precisely so two competing priority labels are never shown to the same player. Red's ai_insight and trends insights stay in ryp_red for now and are flagged as parallel coaching — see open questions. Debrief's discarded session summary is either persisted into atlas.coaching_notes or the route is deleted.


> **Conflict:** Product intent says Atlas is the coaching brain, but five surfaces already produce coaching output. Debrief: practice_focus (the homework), coaching_notes with a CHECK allowing source 'luke' OR 'coach' where each reads the other's rows so they do not contradict, plus a session summary that is generated and THROWN AWAY. Forge/build plan: forge.plans (the build ladder) and primaryLeak. Locker Room: ai_protocols from its own Gemini call. Red: rounds.ai_insight (an LLM round narrative) plus /trends shipping named metrics ('Decision Gap', 'Strike Score'), severity-rated insights and CTAs. Atlas: growthZone and recommendedAlloc.


### Player goals / stated intent / why-statement

**Apps:** locker_room, debrief, atlas, forge, ryp_red

**Verdict:** NEW golf.player_goals (user_id, content, kind goal|why_statement, status active|completed|dropped, source_app, stated_at). It goes in golf.* rather than atlas.* because a player-stated goal is a canonical record, not Atlas's opinion — and golf.* is already per-table writers, so lr_app writes it directly with no ingest hop. Debrief's why_statement gets history instead of being overwritten.


> **Conflict:** Locker Room has locker_room.player_goals (player-written, coach-readable). Debrief has why_statement (durable motivation, but OVERWRITTEN per debrief, which is wrong for a durable fact) plus a player_facts.goals jsonb key extracted from chat. Nothing outside Locker Room reads goals today.


### Injury / availability — health data

**Apps:** locker_room, debrief, forge, atlas, ryp_red

**Verdict:** NEW golf.player_availability (user_id, status healthy|minor|out, source, note, effective_from) — TREAT AS HEALTH DATA with a narrower grant than the rest of golf.*: SELECT to atlas_app, lr_app, forge_app; red_app gets SELECT on status only. lr_app and atlas_app write. Chat extraction is the wrong intake mechanism for a field with a safety consequence — it must have a confirmation step.


> **Conflict:** THREE intake mechanisms for the same safety-relevant fact, and the worst one is winning. Locker Room's players.injury_status is a DEAD column (seed-only, zero writers) yet gemini.ts:123 feeds the stale seed value into an AI prompt; the live signal is pulse_entries.injured. Debrief extracts physical_limits/injuries from casual chat with a Haiku call and no confirmation step. Atlas collects an injury narrative at intake. Forge cannot safely prescribe practice volume without it and Red should not caddie a player into a shot their back cannot make.


### Weekly readiness check-in (physical / mental battery)

**Apps:** locker_room, atlas, forge, ryp_red, debrief

**Verdict:** NEW golf.player_checkins (user_id, week, physical, mental, injured, exam_week) with the SAME narrowed grant group as player_availability — the mental/physical battery is lower-sensitivity than Debrief's register but must not be a default read for every app role. lr_app writes. exam_week stays as a nullable column on the shared row rather than splitting one row across two schemas. Pick ONE week algorithm. Drop all five dead rollup columns and recompute.


> **Conflict:** Locker Room's pulse_entries is the canonical raw self-report and the only live source of the injured flag. Note it is WEEKLY, not daily (keyed 'YYYY-Wnn'), and the repo has TWO different week-string algorithms (proper ISO week in routes.ts:56 vs a naive calc in cron.ts:9) so reminders can key off a different week than the one stored. Five columns downstream of it (current_physical, current_mental, prev_pulse, motivation, pulse_compliance) are dead seed-only values that the client already ignores and the AI prompt still consumes.


### The player-metric stream (mechanics index, club head speed, on-course score, mental game index, decision quality, routine adherence, pressure performance)

**Apps:** atlas, forge, ryp_red, debrief, locker_room

**Verdict:** THE SINGLE HIGHEST-LEVERAGE PROMOTION: one append-only golf.player_metrics (user_id, metric_type, value, source, measured_at, ref). Per-source writers — forge_app writes club_head_speed, red_app writes on_course_score, debrief_app writes mental_game_index and decision_quality, a parallax_svc role writes mechanics_index. Adding a tool becomes a vocabulary row, not a schema change. Mechanics Index MUST carry its source: the 90-day guarantee is contractually tied to a camera-verified improvement, MI is only estimated today, and an estimate must never render as a measurement.


> **Conflict:** Each app is on course to invent its own one-off column for a metric another app measures. Practice DNA's config.ts:60-80 ALREADY defines the reconciling vocabulary in code — METRIC_TYPES x METRIC_SOURCES (parallax, ryp_strategy, debrief, teaching_pro, manual, self_report) — described in-code as backing a DB CHECK constraint and an ingestion webhook, and ZONE_TOOLS already says which app measures and which trains each zone.


### Tournaments and scheduled rounds

**Apps:** debrief, ryp_red, locker_room, forge

**Verdict:** NEW golf.tournaments (name, course_id, start/end) and scheduled rounds are golf.rounds rows with scheduled_at/tee_time set and a null result. That single FK is what turns Debrief from standalone into part of the ecosystem: the pre-round reflection points at the scheduled row, the post-round at the same row once Red fills in the score, and debriefs.linked_debrief_id becomes redundant. Debrief's cron idempotency stamps (pre_notified_at/post_notified_at) do NOT promote.


> **Conflict:** Debrief owns tournaments + tournament_rounds (with tee_time) because it nudges before and after. Red records the round that actually gets played but has no calendar — only a competition_mode boolean. Locker Room has recruits.upcoming_tournaments as hand-maintained jsonb about non-users.


### Season definition

**Apps:** locker_room, forge, ryp_red, atlas

**Verdict:** NEW golf.seasons (season_code, starts_on, ends_on) as shared reference. The season STAMP on a Locker Room assessment stays private; the DEFINITION does not.


> **Conflict:** A calendar convention (Aug->Jul academic year) implemented as a private function in one app, with the prior-season arithmetic and the season window duplicated by hand in three more places. Forge blocks, Red rounds and Locker Room seasons must bucket to the same boundary or cross-app season reports disagree.


### Coach-to-player messages

**Apps:** forge, atlas, locker_room

**Verdict:** atlas.messages, as the ONE DOCUMENTED EXCEPTION to Atlas-writes-atlas: INSERT granted to atlas_app, forge_app and lr_app. Named as an exception rather than used to justify relaxing the rule generally. The alternative (a fourth `coaching` schema for two tables) is not worth the migration ownership it creates.


> **Conflict:** Genuinely homeless. The build plan puts it in forge.messages, which would mean Atlas writing another app's private schema. It is multi-party canonical data — both apps write and both read — but it is not identity, not golf truth, and not a distilled assessment, so none of public/atlas/golf fits cleanly.


### Coaching session credits

**Apps:** atlas, forge, locker_room

**Verdict:** NEW public.coaching_credits (player_user_id, coach_user_id, allowed, used, banked, issued_at, expires_at). It goes in public.* because it is an entitlement — it is what the $399/mo and $799/mo tiers actually buy. billing_svc issues; atlas_app decrements.


> **Conflict:** The prototype's ALLOW/USED/BANKED/EXPIRY are code literals keyed by tier->coach and by coach only. It has NO player dimension — it breaks the moment there is more than one player — and the 90-day expiry is the literal string '18 days' rather than a timestamp.


### Notification registries and preferences

**Apps:** locker_room, debrief, ryp_red, forge

**Verdict:** Registrations and prefs stay APP_PRIVATE_STATE in each app schema. Only public.users.timezone promotes — every app that schedules needs it, and capturing it opportunistically as a side effect of enabling push (as Debrief does) means a user who never enables push has a null timezone. Double-notification is a product problem to solve at the notification layer, not a schema merge.


> **Conflict:** Locker Room stores an FCM token + a pulse reminder toggle; Debrief stores WebPush endpoint/p256dh/auth rows bound to its own VAPID keypair and service worker, plus five notify_* flags. Both are per-origin and literally unusable by another app. But a user with Red, Forge and Debrief installed ends up with three registrations and three chances to double-notify them about the same round. Debrief's push keys are also secrets and are included verbatim in its account-export download.


### Learning style

**Apps:** locker_room, atlas, forge

**Verdict:** Drop the column; the q5-derived dimension flows into atlas.coachability_dimensions. Do not keep both.


> **Conflict:** locker_room.players.learning_style (Visual/Verbal) is seed-only AND a duplicate of assessment item q5 'Learning Modality', which is the live measured version.


### In-app feedback channels

**Apps:** ryp_red, locker_room, debrief

**Verdict:** Stays app-private in each schema — this is not a promotion candidate. But the Debrief screenshot path is a LIVE data-exposure decision, not a design question: shorten the signed URL to hours or disable capture on the register-flagged screen before it is carried into ryp-core.


> **Conflict:** Three parallel implementations: Red's is in-memory plus a Slack webhook with no table at all; Locker Room has locker_room.feedback plus Slack; Debrief uses a private bucket plus Slack. Debrief's egresses a viewport screenshot to Slack behind a 30-DAY signed URL and its own code comment concedes the capture 'may show private reflection content' — so a user who taps feedback on the register-flagged screen ships a clinically sensitive screen to Slack for 30 days.


---

## 3. Role matrix — the seed script and GRANT list


| App | Role | Plan | Reads / writes |
| --- | --- | --- | --- |
| atlas | `player` | free | READ own: public.users/user_app_roles/feature_flags/terms_acceptances/content_entitlements, golf.* own rows (profile, bag, rounds, round_holes/shots, practice_*, player_metrics, impact_reads, goals, drill_progress) + all golf reference (courses, course_holes, drill_library, knowledge_chunks, seasons), atlas.* own rows (practice_dna_results, zone_grades, prescriptions, coaching_notes, communication_profile, score_profile, tendencies). WRITE own: golf.player_profile, golf.bag, golf.player_goals, atlas.intake_submissions (own), atlas.messages (own thread), atlas_private.*. NO write on public.user_app_roles / plan / feature_flags — bypass-only. |
| atlas | `coach` | coaching ($399/mo) or elite ($799/mo) | Everything atlas/player has for themselves, PLUS on players reached by an ACTIVE approved public.user_relationships edge (status='active' AND approved_at IS NOT NULL) or shared public.org_memberships: READ atlas.practice_dna_results / zone_grades / prescriptions / coachability_dimensions / score_profile / tendencies / impact_notes, golf.practice_sessions / practice_index_results / practice_days / rounds / player_metrics / impact_reads / drill_progress / player_goals / player_availability. WRITE atlas.prescriptions (the build ladder), atlas.coaching_notes, atlas.impact_notes, golf.drill_progress (verified_at / verified_by_user_id / signed_off_at only), atlas.messages, public.coaching_credits (decrement). NOT granted: atlas.practice_dna_scales (Big Five) or atlas.intake_submissions pending the consent decision; nothing in debrief.*, ever. Cancelling the subscription must END the edge (status='ended'), not just flip a flag — otherwise a lapsed subscriber's coach keeps RLS read access. |
| atlas | `admin` | n/a (staff) | Cross-user read on public.*, atlas.*, golf.*. WRITE golf.drill_library, golf.courses/course_holes/course_geometry_overrides, golf.seasons, public.coach_profiles, public.organizations, public.app_invites. Reconcile entitlements only by CALLING billing_svc — admin does not get direct INSERT on user_app_roles. NOT granted USAGE on debrief.* or any app-private schema. |
| ryp_red | `player` | free | READ public.users (SELECT-ONLY — see the breaking-change note below), public.user_app_roles/feature_flags own rows, golf.player_profile / bag / club_measurements / handicap_history / courses / course_holes / course_geometry(+overrides) / seasons / player_availability.status. WRITE own golf.rounds (is_simulated=false) / round_holes / round_shots / bag / club_measurements / handicap_history / player_metrics(on_course_score), ryp_red.* full CRUD. Free tier: no analysis pages, no GPS range layer, no Aim Trainer; the 3-round cap must become a SERVER gate or be dropped. BREAKING: red_app loses UPDATE on public.users entirely (Stripe -> billing_subscriptions/billing_svc, golf profile -> golf.player_profile/atlas_app, analytics -> ryp_red.user_blueprint) and loses its lazy feature_flags seeding (writes are bypass-only) — those keys move into the seed script. Red must call an Atlas endpoint or write golf.player_profile directly per the per-table grant; the Stripe webhook becomes a billing_svc service. |
| ryp_red | `player` | pro | Everything free has, plus the 5 requirePro endpoints: /trainer/aim, /course-geometry, /shot-dispersion, /analysis, /trends. Flag keys to seed under app='ryp_red': analysis.approach, analysis.atg, analysis.off_tee, analysis.putting, gps.range = plan_required 'pro'; trainer.enabled = plan_required 'pro' (RESOLVING the live contradiction where it is seeded 'free' while its endpoint sits behind requirePro — pick one, do not average). |
| ryp_red | `admin` | n/a (staff) | Everything a player can, plus cross-user search and billing read. BUT the escalation paths move: forcing plan='pro' with subscription_status='admin_override' and patching feature_flags become billing_svc operations behind an admin UI, NOT red_app grants; setting any user's role likewise. Retains ryp_red-scoped powers: purge soft-deleted accounts past the retention window (dry-run unless confirmed), acting against public.deletion_requests. |
| ryp_red | `coach` | n/a | NOT SEEDED. 'coach' is accepted by Red's roleUpgradeSchema and can be written into user_app_roles, but no route, middleware or RLS policy reads it, coach_profiles and user_relationships are untouched by every Red route, and the relationship policy only exposes rows where the caller is actor or subject — so no coach-reads-player path exists. Seeding it creates a phantom entitlement. |
| ryp_red | `parent` | n/a | NOT SEEDED, and 'parent' is not even in eco's ROLES vocabulary. Same status as red/coach: a writable enum value with no reader. The guardian-consent mechanism that actually works is a COLUMN (public.users.parental_consent_at), not this role — no parent user is ever linked to a minor. If guardian access is wanted, it is a public.user_relationships relationship='parent_of' edge, not a role. |
| locker_room | `player` | free (org plan gates the coach side) | READ public.users own row, public.org_memberships own, locker_room.roster own row, locker_room.notifications own, locker_room.ai_protocols WHERE shared_to_player=true (that flag is load-bearing for security, not UI state), golf.player_checkins own, atlas.score_profile / coachability_dimensions own. WRITE own golf.player_checkins (the weekly pulse), golf.player_goals, locker_room.assessments (own 23-item audit), locker_room.roster (onboarding: year/major/GPA), locker_room.app_state (FCM token, reminder toggle). Seed 'player', not 'user'. BREAKING: lr_app gets NO INSERT on public.users or public.user_app_roles — that breaks first-token auto-provision (auth.ts:92-96), the two role inserts (routes.ts:396, :1896), invite acceptance (auth.ts:148-151) and recruit->player conversion's four direct writes. All four must move to the shared eco provisioning path or a billing_svc-credentialed route BEFORE grants land, or Locker Room signup breaks. Blocking code change for Yannick. |
| locker_room | `coach` | org plan (organizations.license Starter|Pro|Enterprise — today validated, stored, displayed and NEVER enforced) | Within their own org via public.org_memberships: READ locker_room.roster / assessments / player_notes(own) / recruits / conflict_scripts, golf.player_checkins / player_availability / player_goals, atlas.score_profile / score_profile_snapshots / coachability_dimensions / tendencies / archetype. WRITE locker_room.player_notes, locker_room.ai_protocols + share flag, locker_room.recruits (full CRUD incl. CSV import), locker_room.assessments (own coach audit), golf.player_availability, golf.drill_progress (verified/signed columns), atlas.messages. POSTs distilled coachability dimensions to the Atlas ingest route — no direct atlas.* write. NEVER granted USAGE on debrief.*. The only real usage limit today is HARDCODED (5 AI protocols per player per day) — that is the obvious first thing to move behind a real plan tier as flag key locker_room/ai_protocols.daily_cap. |
| locker_room | `assistant_coach` | org plan | READ-MOSTLY, and DO NOT DERIVE THIS FROM THE RLS HELPER. app_private.locker_room_is_coach() accepts role IN ('coach','assistant_coach'), so at the DB layer an assistant has full coach-equivalent read/write across the tenant, while the app layer then rejects them with role !== 'coach'. Copying the helper into the GRANT list over-grants. Explicit allow: SELECT locker_room.roster, one player, conflict-detail, season-report, development-arc, team readiness-history, trend-alerts. Explicit deny: all recruiting, player_notes, ai_protocols, share-protocol/share-conflict, player goals, another player's assessment, invite management. FIX: tighten locker_room_is_coach() to exclude assistant_coach and add a separate read-only predicate — do not leave the app layer as the only thing stopping an assistant from writing recruits. |
| locker_room | `admin` | n/a (staff) | Cross-org: READ locker_room.* and golf.player_checkins unscoped (the global engagement stats are deliberately unfiltered — that is what makes them admin-only, and the GRANT list has to allow it), triage locker_room.feedback, suspend/activate public.organizations. WRITE public.organizations, public.app_invites. Creating a university's first coach (which today mints a Firebase user + public.users + user_app_roles + profiles) becomes an atlas_app/billing_svc provisioning call. Provisioned today purely from a LOCKER_ROOM_ADMINS env list — that plus LOCKER_ROOM_COACHES / LOCKER_ROOM_USERS / LOCKER_ROOM_PLAYER_DOMAIN / LOCKER_ROOM_DEFAULT_UNIVERSITY_NAME must become real seed rows. Also retire the X-Dev-Role impersonation header outside local dev. |
| debrief | `player` | pro (Foundations tier unlocks debrief.access) | CONDITIONAL ON §6.2 — Yannick decides whether Debrief joins at all; if it stays standalone, no debrief_app role is created and four atlas.* tables lose their producer. If it joins: READ public.users own row, golf.rounds / round_holes / round_shots / tournaments / practice_sessions / practice_index_results own, golf.player_profile / bag / courses / knowledge_chunks, atlas.archetype / communication_profile / prescriptions / coaching_notes / tendencies own. WRITE own debrief.* full CRUD, golf.rounds (scheduled shell for a pre-round reflection only), golf.tournaments, golf.player_goals, golf.player_metrics (mental_game_index, decision_quality). POSTs the distilled register profile, failure-mode trend and practice_focus to the Atlas ingest route. ADD the owner-DELETE policies that are missing on debriefs / ask_sessions / user_profiles today — their absence is the only reason account reset and purge have to run as service_role with every statement hand-scoped, which is a correctness hazard. |
| debrief | `coach` | n/a | NOT SEEDED, AND MUST NOT BE. The role is declared in a CHECK constraint that is never read anywhere in app/, lib/, scripts/ or middleware.ts; there is no coach-facing view, no cross-user policy and no relationship table. Given register_snapshot and flagged_thoughts hold verbatim self-harm language by prompt design, and the core audience is explicitly junior players and the adults around them, this is the exact grant that must not exist by default. Retrofitting a narrower grant later is far harder than starting narrow — resolve the Register-4 visibility question with counsel and a licensed clinician BEFORE the GRANT list is written. |
| debrief | `admin` | n/a | NOT SEEDED. Same status: declared in the CHECK, never read. Debrief's operational needs (audio TTL cron, notification cron, knowledge ingest, purge) are served by service paths using withRlsBypass, not by a user-facing admin role. Any per-app NOBYPASSRLS design has to explicitly account for those deliberate bypass paths. |
| forge | `player` | pro (Foundations $399 one-time unlocks forge.access) | READ golf.player_profile / bag / club_measurements / courses / course_holes / drill_library / seasons / player_availability / knowledge_chunks, atlas.prescriptions (growth_zone + the build ladder) / zone_grades / practice_dna_results / communication_profile own. WRITE own golf.practice_sessions / practice_shots / practice_index_results / practice_days / club_measurements / player_metrics(club_head_speed) / rounds(is_simulated=true) / drill_progress(ticked_at, watched_at), forge.* full CRUD, atlas.messages. Requires a forge_app NOBYPASSRLS login role with per-table grants — created by whoever stands up ryp-core, for an app they do not own, so confirm it with Luke as part of the data contract. |
| forge | `coach` | coaching or elite | Within Forge, on players reached by an ACTIVE approved public.user_relationships edge: READ golf.practice_sessions / practice_index_results / practice_shots / practice_days / drill_progress / player_availability, atlas.prescriptions / zone_grades. WRITE forge.calibration (setBy='coach' override) and atlas.messages. The calibration override is a Forge-service API call from the Atlas surface, never a cross-schema INSERT. |
| n/a (service role) | `billing_svc` | n/a | THE ONLY writer of entitlements — this is what makes the demonstrated one-INSERT-to-full-table-read escalation impossible here. Full CRUD on public.user_app_roles, public.feature_flags, public.billing_subscriptions, public.content_entitlements, public.coaching_credits; SELECT+UPDATE public.users.plan; INSERT/UPDATE public.user_relationships (a coaching subscription buys an APPROVED edge; cancelling sets status='ended'). No USAGE on any app-private schema. Grant no user-facing role INSERT or UPDATE on user_app_roles, ever. |
| n/a (service role) | `content_svc` | n/a | INSERT/UPDATE/DELETE on golf.knowledge_chunks, golf.drill_library, golf.courses, golf.course_holes, golf.seasons. SELECT only elsewhere. This is the knowledge-ingest and drill-authoring path; today Debrief's ingest script uses service_role, which is what let the anon key both read AND write the proprietary corpus before it was hardened. |
| n/a (service role) | `parallax_svc` | n/a | INSERT on golf.player_metrics WHERE metric_type='mechanics_index' AND source='parallax', and INSERT on golf.impact_reads. Exists only if Parallax is built or bought (an unresolved build-or-buy). It matters because the 90-day guarantee is contractually tied to a camera-verified Mechanics-Index improvement, and MI is only ESTIMATED today — so an estimate must never be written with source='parallax'. |

---

## 4. Open questions

1. 1. BLOCKING — Confirm atlas.* stays SINGLE-WRITER (Atlas) with producers POSTing to an async Atlas ingest API, which is what I assumed. ECOSYSTEM.md §2 contrasts golf (writer: per table) with atlas (writer: Atlas) deliberately, and async+retrying ingest does not violate 'no app calls Atlas at request time' (the stated harm is an Atlas outage taking down another app). The cost is real, though: it means building an Atlas ingest API before Debrief or Locker Room can contribute anything to the coaching brain, moving the Typeform S.C.O.R.E. webhook out of Locker Room, and accepting one documented exception (atlas.messages takes INSERT from three roles). The alternative — per-table writers in atlas.*, exactly like golf.* — is simpler and needs no new API, but weakens the contrast the doc draws. Choosing per-table writers changes the atlas.* portion of the GRANT list and ~6 table placements. Everything else in this map is stable either way.

2. 2. BLOCKING — Debrief in or out (§6.2, already handed to Yannick). It is not just Debrief's own schema: four atlas.* tables (communication_profile, tendencies, and the debrief-sourced rows of prescriptions and coaching_notes) have NO producer if Debrief stays standalone, and the golf.rounds FK that turns Debrief from standalone into part of the ecosystem never gets built. It also carries the only rule-4 violation left (Supabase email OTP, not Firebase), so joining means a full auth swap, not a schema migration. Decide before writing the atlas.* DDL.

3. 3. BLOCKING BEFORE ANY GRANT IS WRITTEN — Register-4 visibility to an academy coach or the parent of a junior. Debrief's register_snapshot.signals[] holds verbatim self-harm language by prompt design; its core audience is explicitly juniors and the adults around them; and the product intent says academy players appear in Locker Room so their coach sees their Atlas data. I have classified all of it debrief-private and granted no coach role. But 'a 16-year-old disclosed clinical distress and their coach and parent cannot see it' is a decision for counsel and a licensed clinician, not for a schema — and there is an explicit, UNAPPROVED Tier-B proposal awaiting exactly that sign-off. Starting narrow is cheap; retrofitting narrow later is not.

4. 4. Plan vocabulary. I collapsed four contradictory models into PLANS = ['free','pro','coaching','elite'] plus a new public.content_entitlements for the four one-time content tiers, because 'all eight Impact Opposites' is content ownership rather than a rung on a monthly ladder. Confirm, because it decides the seed script, every feature_flags.plan_required value, and whether the coach Dashboard's Foundation/Builder/Competitive naming survives at all. Related: is 'pro' one ecosystem-wide entitlement, or could a user be Red-Pro and Forge-Free? I assumed ecosystem-wide.

5. 5. One shots table or two. I chose TWO (golf.round_shots + golf.practice_shots) because the payloads genuinely differ and one table means a nullable round_id and a nullable practice_session_id on every row forever. One table means Debrief queries once for cross-context analysis. This is the single biggest shape decision in golf.* and it is Red's and Luke's payloads that have to agree — get Luke's sign-off before the DDL.

6. 6. Does public.organizations get created? Locker Room's entire tenancy mechanism keys off locker_room.universities, and Atlas/Forge/Debrief need team grouping the moment academy players matter to them — but the stated public.* list has no org table, so this is a real ADDITION, not a move. I also kept public.user_relationships alongside it because Atlas models 1:1 coaching as a direct edge while Locker Room scopes by shared org. Confirm both mechanisms are wanted, or pick one.

7. 7. Atlas coach Dashboard vs Locker Room — one coach surface or two? The Atlas prototype has a full coach Dashboard (roster, plans, sign-off, credits) and Locker Room has one too. If both ship, the same workflow is built twice over the same public.user_relationships + atlas.* + golf.* data, and Locker Room (no RLS today) gains read access to atlas.*. This directly changes lr_app's grant list, so it is not a product-only question.

8. 8. Who owns the Practice DNA instrument for logged-in users? Atlas is the nucleus whose intake learns tendencies, but Practice DNA is a separate deferred app. If Atlas reimplements the instrument, two engines diverge — and that has ALREADY happened once (the scoring engine was copied from Forge and has since diverged, with the regression suite living in Forge). If Atlas calls Practice DNA as a service, a deferred app lands on Atlas's critical path. I assumed Atlas owns the logged-in intake and writes atlas.* itself.

9. 9. Raw intake and Big Five in a shared schema. Rule 3 says raw stays private, but Atlas's only homes are shared — so injury narratives, interview answers and Mini-IPIP personality trait scores about a named person would sit where every app's role can read them. I put them in atlas.intake_submissions and atlas.practice_dna_scales with an atlas_app-only grant, but that is a policy patch over a structural mismatch. Options: column-level restriction, a policy allowing only the player and an actively-rostered coach, or a genuinely restricted schema. Also needs an explicit consent basis and a call on whether coaches see trait scores or only the golf-facing archetype.

10. 10. URGENT AND NOT A SCHEMA QUESTION — are the eight hardcoded ROSTER players in the Atlas prototype real clients? Their names, handicaps, injuries and interview answers are in an unauthenticated file today. Confirm and scrub before hosting, independent of everything else here.

11. 11. Red's parallel coaching layer. Red's /trends already ships named metrics ('Decision Gap', 'Strike Score' — rebrandings of ssgTotal/esgTotal), hand-tuned severity thresholds, coaching copy and CTAs, plus rounds.ai_insight, an LLM round narrative. Product intent says Atlas is the coaching brain. Does this stay Red-private (two apps coaching in parallel, in different voices, from the same data) or move to atlas.* with Red rendering Atlas's output? I left it in ryp_red to avoid blocking, but it is the clearest overlap with Atlas's mandate.

12. 12. Where does Atlas's own UI state live? I created atlas_private, which breaks the app-named-equals-private convention cosmetically. The alternatives are tolerating session state in atlas.* (readable by every app) or client-side only (does not survive a device change). Cheap to decide, but it must be decided before the atlas.* migration so atlas.* stays purely the coaching brain.

13. 13. Terms per-app or global? I created public.terms_acceptances (one row per user per app per version) because Debrief's terms specifically cover clinical flagging and a single nullable timestamp would treat Red's acceptance as consent to it. This is an addition to eco's identity.ts, so it needs a verify:schema update and Atlas's login flow has to write a row per app.

14. 14. forge_app role: confirm with Luke that ryp-core creates a NOBYPASSRLS login role for an app he owns, with per-table grants on golf.* and atlas.* — and that his practice-shot payload shape is what golf.practice_shots.payload will carry. Without this, Forge cannot write anything and three golf.* tables have no writer.

15. 15. Two dead-code calls to make rather than carry over: (a) Red's blueprint drift monitor is fully implemented but every caller passes an empty rolling window, so it never fires — build it a ryp_red.esg_rolling_window table or delete it; (b) Locker Room's ai_protocols is structurally identical to an Atlas prescription built from Atlas-owned inputs — if Atlas takes over generation, that table is DELETED, not moved, and Locker Room becomes a reader. Both are small, but each is a table that either exists or does not.

---

## 5. ⚠️ Where this contradicts what is already built in `ryp-core`

`ryp-core` was stood up before this synthesis landed, from eco's schema. These items would change it. All are cheap now — the database is empty — and all are additive except the two marked **modify**.

### Additions to `public`
| Table | Why the map wants it |
| --- | --- |
| `organizations` + `org_memberships` | Academy / university / team is currently only `locker_room.universities`, carrying six dead columns. Atlas, Forge and Debrief all need the concept |
| `terms_acceptances` | One row per app per version, replacing the single global `users.terms_accepted_at` / `terms_version`. Debrief's Register-4 acknowledgment cites a specific accepted version, which a global column can't represent |
| `billing_subscriptions` | Billing state as its own table rather than four columns on `users` — eco's lean `users` already omits them, so this is the natural home |
| `content_entitlements`, `coaching_credits` | One-time purchases and coaching credits are not a subscription tier and don't fit `plan` |
| `app_invites` | Locker Room already uses invites as an identity-provisioning path; nothing shared models it |
| `deletion_requests` | Per-app erasure exists in Red; the request/audit trail does not |

### Modifications
| Object | Change | Reason |
| --- | --- | --- |
| `feature_flags` | **modify** — add an `app` column, composite PK `(app, key)` | Built with `key` alone as PK. Every seeded key today is Red-specific (`analysis.*`, `gps.range`, `trainer.enabled`), so keys collide across apps |
| `coach_profiles` | **modify** — add `calendly_url` | Present in the Atlas prototype, missing from the table |

### Vocabulary
eco's `ROLES` is `user · player · coach · assistant_coach · admin`. The map found **four** live vocabularies across the apps, including `parent` in Red. `PLANS` is currently `free · pro`; the map proposes `free · pro · coaching · elite`. Both need a decision before entitlements are seeded.

### `golf` and `atlas`
`ryp-core` currently has only `golf.player_profile`. The map assigns many more to both schemas (handicap history, bag, club measurements, courses/holes, seasons; and for `atlas`, the Practice DNA results, zone grades, prescriptions, tendencies). These are new tables, so they are pure additions whenever you choose to build them.

**Nothing here is broken** — `ryp-core` is a correct subset. The question is which of these to add before Red and Locker Room migrate in.
