# FORGE port — verification findings, 2026-10-13

Four adversarial lenses over the change set at commit `f90319e`. **`clean: false` on all four.**
39 blocking-or-serious findings, 17 minor. Static reads only — no database was touched, and §10's
falsification block has still never been executed.

## What the lenses confirmed GOOD, so it is not re-litigated

- `npx tsc --noEmit` in eco exits 0.
- `node forge-math.test.js` → **57 passed, 0 failed.**
- 🔴 **No non-comment line in `rls_forge.sql` calls `coaches_or_pending()` or `coach_requested()`** —
  the T-126 constraint holds, which was the one thing that would have been a live security hole.
- The security lens tried to defeat the escalation trap (reach `source='coach'`/`'auto'` as a player),
  the B10 self-set exclusion, the pending-coach path and the `public.users` write ban. **All hold.**
- `rls_forge.sql` is structurally complete and balanced: `begin;` → `commit;`, the `/* */` block opens
  at :2112 and closes at :2931, §10.0–§10.10 and §11 all present. It is **not** truncated.

## Blocking and serious

### B1 · [blocking] The B7 admin-retract policy does not enforce what its comment says. An admin retraction can be undone, and body, visibility, author and subject are not held still. The §10.9 case 9 expectation is also wrong.

**Evidence.** rls_forge.sql:1759-1769. `coaching_notes_append_only` is RESTRICTIVE with only `using (rls_bypass())`. `coaching_notes_admin_retract` is PERMISSIVE with `with check (rls_bypass() and deleted_at is not null)`. rls_core.sql:961-965 `coaching_notes_update` is also permissive, with WITH CHECK `rls_bypass() or (...)`, which is true under bypass. Permissive WITH CHECKs OR together, so the `deleted_at is not null` term never binds, and `set deleted_at = null` succeeds under bypass with ROW_COUNT 1. Comment :1730-1739 says 'body / visibility / author / subject UNCHANGED ... compared to themselves ... belt and braces'. No such terms exist in the policy, and RLS cannot reference OLD anyway. §10.9 case 9 (:2850-2852) expects `deleted_at = null` to give ROW_COUNT 0 'WITH CHECK: deleted_at is not null'. That is wrong twice: the OR defeats it, and a failed WITH CHECK on UPDATE raises 42501 rather than returning zero rows. Static read only, nothing run against a database.

**Fix.** Put `with check (deleted_at is not null)` on the RESTRICTIVE `coaching_notes_append_only`, because restrictive checks AND. Delete the 'compared to themselves' sentence at :1734-1739. Rewrite case 9 to expect ROW_COUNT 1 for the retract and the real outcome for the un-retract.

### B2 · [blocking] The verify-schema gate fails after rls_forge.sql is applied. Four live policies are unpinned and one pinned policy no longer exists. The SQL's own §8 and §11 say the pins were left undone.

**Evidence.** verify-schema.mjs FORGE_LAYER['golf.facet_scores'] (:205-210) lacks `facet_scores_service_recompute`. FORGE_RESTRICTIVE_POLICIES (:306-317) lacks `coaching_notes_append_only`, `coaching_notes_admin_retract` and `handicap_history_forge_source_pin`. It still pins `coaching_notes_forge_append_only` (:316), which rls_forge.sql:1755 drops. The reverse sweeps at :763-770 and :837-846 turn all of these into errors. `facet_scores_service_recompute`, which carries the `TO forge_svc` role pin, is pinned nowhere. Policy-name diff: rls_forge.sql creates 45 policies and the pin lists total 43, which accounts for these gaps. rls_forge.sql:1845-1852 and :3019-3025 admit the four edits were not made. Checklist gate 6 is unmet.

**Fix.** Add `facet_scores_service_recompute: ['forge_svc']`. Add `handicap_history_forge_source_pin: {table:'golf.handicap_history', roles:['forge_app']}`. Pin `coaching_notes_append_only` as restrictive. Pin `coaching_notes_admin_retract` in a permissive list. Remove `coaching_notes_forge_append_only`.

### B3 · [blocking] forge.ts claims D1, D2-events and A1b are done. They are not built, and the SQL already knows this.

**Evidence.** forge.ts:41-46 and :119-120 say facet_rung_events gains `mode` and `idempotency_key`, and practice_commitment gains `source_app`. The declarations at forge.ts:1242-1271 (facet_rung_events) and :1307-1337 (practice_commitment) contain none of those columns. rls_forge.sql:987-1012, :1057-1067 and §11 items 11/11b/11c confirm it. Consequences: a retried /complete double-promotes (§10.4 case 11 is 'expected to fail'). The ladder trail cannot say which chipping lie moved. Provenance is unmet on practice_commitment. The `ON CONFLICT DO NOTHING` remedy has no arbiter. A false header in the schema source is the exact failure class this lens exists for.

**Fix.** Declare the three columns, the partial unique index (user_id, facet, mode, session_id) where session_id is not null, and `source_app` on practice_commitment in forge.ts. Add them to the grants. Otherwise, correct the forge.ts header to say 'NOT BUILT'.

### B4 · [serious] forge.ts still describes facet_rungs, facet_rung_events and assignment_completions as bypass-only, and still has two 'OPEN (Luke)' blocks. All of this contradicts forge.ts's own header and the SQL. Someone may 'fix' the SQL to match the stale prose.

**Evidence.** forge.ts:1103 and :1229 ('bypass-only'). forge.ts:1120-1125: 'the only WRITE policy is using/with check (app_private.rls_bypass())'. forge.ts:1568: assignment_completions 'service role only, under bypass'. The SQL has `facet_rungs_service_write FOR ALL TO forge_svc` with `user_id = current_user_id()` and deliberately no bypass branch (rls_forge.sql:931-937, :1142-1148). rls_forge.sql:912-916 itself calls the forge.ts prose 'STALE PROSE ... THIS FILE DELIBERATELY DOES NOT MAKE IT TRUE', and the stale text is still in forge.ts. forge.ts:1134-1140 ('OPEN AND BLOCKING (Luke)') and :1378-1386 ('STILL OPEN (Luke)') contradict the header at forge.ts:29-32 and the decided C2/C3/C5.

**Fix.** Rewrite those paragraphs to say forge_svc, row-pinned, no bypass branch. Delete the two OPEN (Luke) blocks and record C2/C3/C5 as decided.

### B5 · [serious] The forge_svc recompute and Putt 18 backfill path is claimed to work. forge_svc has no read grant on the table whose rows are the input.

**Evidence.** forge.ts:491-495 and rls_forge.sql:678-682 name forge_svc through `facet_scores_service_recompute` as the Putt 18 backfill route. The putt18_holes grant is `grant select on golf.putt18_holes to forge_app, atlas_app` (rls_forge.sql:871), which omits forge_svc. range_shots (:795) also omits it. The comment at :544-550 argues forge_svc needs reads, but covers only range_sessions and facet_scores. The putting index is `clampIndex(base - strokesGained*k)`, which needs per-hole strokes gained from putt18_holes (forge.ts:482-490). Unless that input is stored on the facet row, the backfill hits 42501. Tally rounds have no holes at all. Not run.

**Fix.** Either `grant select on golf.putt18_holes to forge_svc`, or state which stored facet-row column the backfill reads and add a falsification case that reads it as forge_svc.

### B6 · [serious] The A5 fix and the B1 repoint were not applied. Schema and SQL source still point at a table that does not exist and at a task that is not the right one.

**Evidence.** identity.ts:169-173 still says 'atlas.prescriptions' and 'NOT WRITTEN YET, see TASKS T-111'. The term is written at rls_forge.sql:1177 and :1188, and T-111 is the Firebase-key task. atlas.ts:21 and :35, and rls_core.sql:545, still say `atlas.prescriptions`. golf.ts:116-118 cites 'rls_core.sql:465' (the line is :545) and an 'edit 9' that rls_forge.sql §9 does not contain. §9's 'ninth edit' is the coaching_notes paragraph. `grep -n -i prescription` over eco src, sql and scripts shows these live pointers, so checklist gate 2 fails.

**Fix.** Repoint the three files to `atlas.assignments`, correct the identity.ts sentence to cite rls_forge.sql, and fix golf.ts's line and edit references.

### B7 · [serious] atlas.ts still documents the dropped B6 design: 'append-only is the withheld UPDATE grant plus a `source_app <> forge` term on the update policy's USING'.

**Evidence.** atlas.ts:90-93. B6 and rls_forge.sql §7.3 dropped that predicate and replaced it with a restrictive `coaching_notes_append_only`. A later reader will 'restore' the predicate, and verify-schema.mjs:302 still describes it too.

**Fix.** Rewrite the comment to describe the restrictive bypass-only policy plus the `update (deleted_at, updated_at)` grant.

### B8 · [serious] The Atlas docs contradict the schema they describe.

**Evidence.** FORGE-ON-RYP-CORE.md:255-256 and :267-268 prescribe `using (rls_bypass()) with check (rls_bypass())` for forge_svc policies. The SQL deliberately has no such branch. FORGE-ON-RYP-CORE.md:276 says `entry_method` (and a nonexistent `scored_at`) is withheld from UPDATE grants, which is the A2 contradiction again, since entry_method is now in the grants (rls_forge.sql:675 and :801). FORGE-ON-RYP-CORE.md:335 and :489 name `assignments.completed_at`, which does not exist (forge.ts:1445 says explicitly there is none). FORGE-ON-RYP-CORE.md §8 presents Q4-8, 11-14, 17 and 21-23 as open although the answers decided them, and Q13 is still about a `gender` column. FORGE-MATH-ADOPTION.md:159-160, :166-172 and :766 still prescribe `gender_at_play` and a `gender` column on player_profile (the header at :3-9 omits B22), so Sequence step 1 re-adds what B22 removed and gate 3 fails. Neither doc mentions `carry_reference_at_play` or `facet_rungs.mode`.

**Fix.** Update both docs to carry_reference / carry_reference_at_play / facet_rungs.mode. Replace the forge_svc policy text with the row-pinned, no-bypass form. Remove completed_at and entry_method-withheld. Mark the §8 rows answered.

### B9 · [serious] The documented apply order is mutually inconsistent across three files, and rls_core.sql's own forge_app/forge_svc grants fail under rls_forge.sql's stated order.

**Evidence.** rls_forge.sql:13-16 says 'rls_core first (it owns the roles)'. rls_core.sql:139-144 and :498-506 say the Forge roles must exist first, via 'rls_forge.sql §2's do $roles$ block'. That block is §1, inside a begin/commit file whose §0 pre-flight refuses to run until the migration has landed (rls_forge.sql:66-104). forge.ts:106-108 says migration then rls_core. Under rls_forge.sql's stated order, rls_core.sql:144 and :519-522 raise 42704 for forge_app/forge_svc.

**Fix.** Pick one order and state it identically in all three files. Extract the role-creation block so it can run before rls_core, and fix the §1/§2 reference.

### B10 · [serious] rls_core.sql's coaching_notes comments are stale against what rls_forge.sql now enforces.

**Evidence.** rls_core.sql:904-913 says a coach CAN still soft-delete their own note and that the conflict is 'left open ... whoever builds B7 decides'. rls_forge.sql §7.3 closes it with the restrictive append_only policy, and §9 item 5 asks rls_core to point at it. rls_core.sql:904-906 says the PATCH route will raise 42501 and 'must change in the same commit', and :918-922 warns that rls_forge.sql 'still says four columns', but notes.ts now answers 409 and rls_forge.sql says two. notes.ts's DELETE docblock still says the policy 'is eco's to write'. The grants themselves agree (both files: `revoke update ...; grant update (deleted_at, updated_at)`).

**Fix.** Update rls_core.sql:904-923 and the notes.ts docblock to point at `coaching_notes_append_only` and `coaching_notes_admin_retract`.

### B11 · [serious] The B7 admin-retraction pin does not pin. `coaching_notes_admin_retract`'s WITH CHECK `deleted_at is not null` is ORed with the live permissive `coaching_notes_update`, whose WITH CHECK opens with `rls_bypass() or ...`. Under bypass `set deleted_at = null` (un-retraction) therefore passes. The restrictive `coaching_notes_append_only` has no WITH CHECK, so its USING (`rls_bypass()`) is reused as the check and is also true. §7.3 also claims body, visibility, author and subject are 'held still by comparing them to themselves', but no such terms exist in the policy, and RLS cannot see OLD anyway. §10.9 case 9 expects ROW_COUNT 0 for the un-retract, which is wrong twice: the statement succeeds, and a failed UPDATE WITH CHECK raises 42501 rather than returning 0 rows.

**Evidence.** rls_forge.sql:1764-1769 (`using (rls_bypass()) with check (rls_bypass() and deleted_at is not null)`); rls_core.sql:961-965 (`coaching_notes_update ... with check (app_private.rls_bypass() or (author_user_id = ... ))`); rls_forge.sql:1730-1739 (comment claims the four unchanged-column terms); rls_forge.sql:2850-2852 (case 9 expectation).

**Fix.** Give the restrictive `coaching_notes_append_only` a `with check (app_private.rls_bypass() and deleted_at is not null)`. A restrictive policy ANDs, so it is the only place the pin can bind. Delete the 'comparing them to themselves' paragraph. Correct §10.9 case 9 to expect 42501 for the un-retract, not ROW_COUNT 0. The real control for body/visibility is the (deleted_at, updated_at) column grant, so say that.

### B12 · [serious] The B11 audit trigger can be bypassed by `expires_on`. An approved coach can silently end another coach's order, with no audit row, by setting `expires_on` to a past date. The schema defines 'outstanding iff expires_on is null or >= local today', so this is a revoke. The trigger fires only on `update of note, revoked_at`. `expires_on` is in the UPDATE grant for atlas_app and forge_app, and the coach branch of `assignments_update` admits it. The file calls B11 'non-optional', but this path skips it.

**Evidence.** rls_forge.sql:1271 `grant update (note, expires_on, revoked_at, updated_at) on atlas.assignments to atlas_app, forge_app`; :1363-1366 `after update of note, revoked_at ... when (old.source='coach')`; forge.ts:1507-1514 (outstanding iff expires_on null or >= today).

**Fix.** Change the trigger to `after update of note, revoked_at, expires_on`, and add a third branch in `forge_audit_assignment_change()` for expires_on. Add a §10.6 case for it. Or withhold expires_on from coach UPDATE if rewording and revoking are the only intended pulls.

### B13 · [serious] Trap (a) survives as committed prose in forge.ts. Four places tell the implementer that the ladder and completion writes are 'bypass-only' / 'under bypass', and one says the only WRITE policy is `using/with check (rls_bypass())`. rls_forge.sql deliberately has no bypass branch on those tables; the write policies are `TO forge_svc` and pinned to `current_user_id()`. Someone following forge.ts runs forge_svc under withRlsBypass. INSERT then raises 42501, and the UPDATE half of the rung upsert silently matches 0 rows. rls_forge.sql §4.5 flags :1103, :1120-1125 and :1229 as stale but leaves them unfixed. It does NOT flag forge.ts:1567 (assignment_completions: 'service role only, under bypass').

**Evidence.** grep on forge.ts: 1103 `WRITES: **bypass-only**, by the ladder evaluator`; 1121-1123 `the only WRITE policy is using/with check (app_private.rls_bypass())`; 1229 `WRITES: bypass-only / forge_svc`; 1567 `WRITES: **service role only, under bypass.**`. Contradicted by rls_forge.sql:935 and :1400-1403.

**Fix.** Rewrite those four headers to 'forge_svc under withRls(playerId), no bypass branch'. Add :1567 to the stale list.

### B14 · [serious] (g) Nothing in the chain stops a NULL carry_reference becoming a men's-table score. The DB CHECK only refuses a driving practice_index with no snapshot. `carry_reference_at_play`, `carry_yds_at_play` and `practice_index` are all client-supplied in forge_app's INSERT and UPDATE grants, and none is tied to `player_profile.carry_reference`, so a client or route that defaults to 'pga_scratch' is indistinguishable from an honest snapshot. The only code guard, `carryTableKeyFor()`, has zero callers. The vendored forge-math.js is unmodified: `gender = 'm'` defaults at :96 and :137, and :97 still does `CAL.carry[gender] || CAL.carry.m`. `carryTableKeyFor` returns null, and `CAL.carry[null] || CAL.carry.m` lands on the men's table. Checklist gate 7 (test that LPGA must not score on the men's table and null must return no index) does not exist. The checklist's own gate, 'grep gender hits only historical docs', is not met: FORGE-ON-RYP-CORE.md:133 (`PUT /me/profile ... gender` marked 'Stands'), :611 (an open question about a gender column), and FORGE-MATH-ADOPTION.md:150-172 (instructs adding a `gender` column) all stay live and unmarked.

**Evidence.** grep -rl carryTableKeyFor eco atlas -> only enums.ts, golf.ts, forge.ts, rls_forge.sql (definition and comments, no caller, no test). atlas/proto/forge/build/forge-math.js:96-97,137. rls_forge.sql:668-677 (grants). FORGE-PORT-FIX-CHECKLIST.md:55 and :94.

**Fix.** Add the gate-7 test, and a wrapper that returns no index when carryTableKeyFor is null instead of calling baselineHandicap. In forge-math.js (or its wrapper) drop the `|| CAL.carry.m` fallback and the 'm' default. Mark FORGE-ON-RYP-CORE.md:133 and :611-612 and FORGE-MATH-ADOPTION B2 as superseded by B22.

### B15 · [serious] golf.player_profile is a bypass-write hole that this file newly extends to forge_app. `golf_profile_self` is FOR ALL with `rls_bypass() OR user_id = current_user_id()`. §5.1 grants forge_app INSERT and UPDATE on handicap_index, target_handicap, driver_carry_yds, handicap_source and carry_reference. There is no restrictive per-role pin on that table, only a restrictive SELECT. A bypassing Forge handler can therefore rewrite ANY player's handicap, target and carry_reference. That is the scoring-table selector, and the same class of bug as the T-125 men's-table fall-through. The file's own §4 rule says 'a bypass branch on a write policy is an escape hatch handed to the attacker', and it applied a restrictive pin to handicap_history for exactly this reason, but not here.

**Evidence.** rls_core.sql:434-437 (golf_profile_self for all, bypass in USING and WITH CHECK); rls_forge.sql:1481-1489 (grants); only golf_profile_no_pending_metrics (for select) exists at :1474; contrast handicap_history_forge_source_pin :1549-1552.

**Fix.** Add `create policy golf_profile_forge_owner_pin on golf.player_profile as restrictive for insert, update to forge_app using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())`, and pin it in verify-schema (roles ['forge_app']).

### B16 · [serious] The two files contradict each other on how forge_svc's credential is held. rls_forge §1 says forge_svc follows the billing_svc pattern: 'ONE process', and 'a compromised request path cannot' write a rung. §11 item 6 treats that as the standard it must meet and lists it as an open Makel question. rls_core.sql says the opposite and says not to copy billing_svc's rule: forge_svc 'sits in the same deploy as a request path'. Because the row scope is set by the same caller (`current_user_id()` is a session GUC), an in-process request path holding that credential can write any player's rung, completion or auto assignment. The stronger of the two statements is false.

**Evidence.** rls_forge.sql:127-131, :138, :143-147 and :2973-2976 versus rls_core.sql:477-480.

**Fix.** Pick one and delete the other. If rls_core is right (Answers #8), strike the 'compromised request path cannot' claims in rls_forge §1 and state the actual control: forge_svc is reachable only from the completion module, and the row scope stops a bug, not an attacker.

### B17 · [serious] (e) For the forge_app surface, the 'a coach never writes a player's sessions, shots or commitment' rule is enforced by policy (silent zero rows), not by a GRANT (42501). forge_app holds INSERT/UPDATE grants on range_sessions, facet_scores, range_shots, putt18_holes and practice_commitment and serves every caller, so a coach connecting through forge_app is refused only by the owner-scoped policy. The atlas_app and lr_app SELECT-only grants are correct. §10.2 case 9b and §4.6 write that outcome down as acceptable, and §4.1 describes the refusal as a privilege without qualification. The task rule requires a grant.

**Evidence.** rls_forge.sql:551-569, :667-677, :795-802, :1040-1044, :1048-1051 (admits the asymmetry), :2317-2320 (case 9b expects ROW_COUNT 0).

**Fix.** Either state a hard rule that no coach surface may authenticate as forge_app (Atlas coach routes stay on atlas_app), or issue a separate coach role. Do not call the forge_app half a privilege refusal.

### B18 · [serious] The change set is unfinished at the gate. verify-schema.mjs has none of the four §8 pins. `facet_scores_service_recompute` is absent from FORGE_LAYER, so the `TO forge_svc` that keeps the recompute out of the player's role is pinned nowhere. `coaching_notes_forge_append_only` is still pinned at :316 although the policy was dropped. The handicap pin and the two coaching_notes pins are missing. A stale comment at :247-254 still says rls_forge uses the old `prescriptions` names. The gate will fail, and rls_forge §8 admits it. verify-schema also has no pg_trigger check for the two triggers.

**Evidence.** grep verify-schema.mjs: no match for facet_scores_service_recompute, coaching_notes_append_only, coaching_notes_admin_retract or handicap_history_forge_source_pin; :316 coaching_notes_forge_append_only; rls_forge.sql:1845-1891.

**Fix.** Add FORGE_LAYER['golf.facet_scores'].facet_scores_service_recompute: ['forge_svc']; add the restrictive pins and a permissive-pin slot; remove :316; add the pg_trigger assertions.

### B19 · [serious] False statements in forge.ts's header. :41-46 claim that facet_rung_events gains `mode` and `idempotency_key` (D1/D2) and that practice_commitment gains `source_app` (A1b). None of the three is declared. Consequences: a retried /complete double-promotes (wrong data, and §10.4 case 11 is expected to fail), the trail cannot say which chipping lie moved, and provenance is missing on one table. rls_forge.sql admits all three at :987-1013, :1057-1067 and :3000-3013, but the schema file still claims them.

**Evidence.** forge.ts:41-46 versus grep: no `idempotency_key` on facet_rung_events (only range_sessions:294) and no `source_app` in the practice_commitment block (:1307-1337); rls_forge.sql:987-1013.

**Fix.** Either declare the columns and the partial unique (user_id, facet, mode, session_id) where session_id is not null, or strike the three claims from the header.

### B20 · [serious] rls_forge.sql §7.3 says the retract policy's WITH CHECK pins body/visibility/author/subject unchanged and keeps the bypass branch from being a general-purpose edit door. The policy has no such terms. The `deleted_at is not null` term never binds either, because the live permissive `coaching_notes_update` already admits bypass in both USING and WITH CHECK. The 'explicit policy is not redundant' argument and §10.9 case 9 are therefore wrong.

**Evidence.** rls_forge.sql:1730-1739 lists 'four terms'. The actual policy at :1764-1769 is `using (rls_bypass()) with check (rls_bypass() and deleted_at is not null)`. RLS cannot reference the OLD row, so 'comparing columns to themselves' is vacuous. rls_core.sql:961-965 is `create policy coaching_notes_update ... using (rls_bypass() or author=me) with check (rls_bypass() or (...))`. Permissive policies OR, so under bypass `set deleted_at = null` passes via that policy. §10.9 case 9 (rls_forge.sql:2851) expects ROW_COUNT 0 for it and would observe 1. Un-retraction is not blocked and the case would misreport.

**Fix.** Put the constraint in the RESTRICTIVE policy: `coaching_notes_append_only ... as restrictive for update using (rls_bypass()) with check (rls_bypass() and deleted_at is not null)`. Restrictive checks AND with the permissive set. Delete the 'four unchanged terms' text, say the grant alone holds body/visibility, and correct §10.9 case 9 and :1718-1723.

### B21 · [serious] forge.ts's header claims three structural changes landed that are not declared: `facet_rung_events` gains `mode` and `idempotency_key` (D1/D2), and `golf.practice_commitment` gains `source_app` (A1b). It also claims five tables are affected by withheld grants. Checklist items D1, the D2 half and A1b are not done.

**Evidence.** forge.ts:41-46 and :119-120 make the claims. The `golfFacetRungEvents` columns at forge.ts:1242-1271 are id, userId, facet, fromRung, toRung, sessionId, ladderVersion, occurredAt, sourceApp, createdAt. There is no mode, no idempotency_key and no unique arbiter. `golfPracticeCommitment` (forge.ts:1307-1337) has seven columns and no sourceApp. `grep -n idempotency_key forge.ts` hits only :43, :190 (range_sessions) and :294. rls_forge.sql:987-1013, :1057-1067 and §11 items 11/11b/11c admit this.

**Fix.** Either declare the columns and the partial unique `(user_id, facet, mode, session_id) where session_id is not null`, or delete forge.ts:41-46 and :119-120. Until then D1's double-promote stays open, and `ON CONFLICT DO NOTHING` has nothing to arbitrate.

### B22 · [serious] A5 is not applied. identity.ts still says the `created_by <> subject` term is 'NOT WRITTEN YET, see TASKS T-111'. It IS written (rls_forge.sql:1177/1188), and T-111 is ambiguous.

**Evidence.** identity.ts:172-173: 'created_by <> subject as well — NOT WRITTEN YET, see TASKS T-111'. TASKS.md has two rows with id T-111: line 104 (FORGE tables declared) and line 108 (Firebase key rotation). `git status` shows identity.ts unmodified.

**Fix.** Replace the sentence with a pointer to rls_forge.sql §4.7 (assignments_insert_atlas/_forge). Renumber the duplicate T-111 row in TASKS.md.

### B23 · [serious] The B1 'repoint' is incomplete, and FORGE-ON-RYP-CORE.md:72 says it was done: 'Three eco files had reserved `prescriptions` for this table ... they are repointed in the same change.' Gate 2 (grep prescription) fails.

**Evidence.** identity.ts:169,172, atlas.ts:21,26,35 and rls_core.sql:545 still say `atlas.prescriptions` as a live name (atlas.ts:35: 'Forge reading `atlas.prescriptions`'). golf.ts:116 says 'edit 9 in rls_forge.sql §9' but §9 has no edit that touches rls_core.sql:545, and the cited `rls_core.sql:465` is wrong (the text is at :545). `grep -rni prescription src sql scripts` returns 12 hits outside historical explanation. identity.ts and atlas.ts are unmodified in git.

**Fix.** Repoint identity.ts:169/172, atlas.ts:21/26/35 and rls_core.sql:545 to `atlas.assignments`. Fix golf.ts:116's line number and remove the nonexistent 'edit 9'. Correct FORGE-ON-RYP-CORE.md:72.

### B24 · [serious] B19/C6 is not applied anywhere, yet docs state `CAL.benchmarks` ships 're-tagged UNSOURCED'. The MEASURED tag with no source (one of the three known fabrications) is still in the only copy of the module.

**Evidence.** proto/forge/build/forge-math.js:56: `// MEASURED — typical distance and fairway rate by handicap, for comparisons.` proto/forge/VENDORED.md says the copy is unmodified except forge-math.test.js:33. FORGE-MATH-ADOPTION.md:6 says 'ships, tagged UNSOURCED', :781 says 'the table is re-tagged UNSOURCED', and FORGE-ON-RYP-CORE.md:601 says 'its tag is UNSOURCED'. `grep UNSOURCED` finds it only in docs, never in code.

**Fix.** Edit forge-math.js:56 to UNSOURCED and record it as the second modified line in VENDORED.md. Or reword the three docs to 'will be re-tagged when ported'.

### B25 · [serious] B22 / gate 3: the atlas docs still instruct building a `gender` column. FORGE-ON-RYP-CORE.md:133 says `PUT /me/profile` 'handicap, carry, target, gender' 'Stands'. FORGE-MATH-ADOPTION.md §2.1 and §8 specify `gender` on player_profile and `gender_at_play`, with no supersession note. Neither doc contains the string carry_reference.

**Evidence.** `grep -n carry_reference` in both docs returns 0. FORGE-MATH-ADOPTION.md:40, 145-172 and 766 ('B1 + B2 + B3 — gender on golf.player_profile ... gender_at_play'). FORGE-MATH-ADOPTION.md:6-9 lists only §3, §4 and §2.5a as decided. FORGE-ON-RYP-CORE.md:611 (open question 13 'gender') is not marked answered.

**Fix.** Add a B22 supersession banner to the FORGE-MATH-ADOPTION.md header and §8 (carry_reference, carry_reference_at_play). Amend FORGE-ON-RYP-CORE.md:133 and mark :611 ANSWERED.

### B26 · [serious] verify-schema.mjs and rls_forge.sql §8 contain false statements about the gate. (a) rls_forge.sql:31-33 says §8 'adds the ten new tables to MUST_FORCE_RLS'. (b) §8 says FORGE_POLICIES 'all 40' names, but only 39 are pinned. (c) verify-schema.mjs says three policies' names 'do not exist yet' and cannot be pinned, but they are written. (d) The 'ten names ahead of rls_forge.sql' comment is stale. (e) A 'fixture harness' is cited that is not in the repo. The gate will also fail for the wrong reason after a correct apply.

**Evidence.** (a) MUST_FORCE_RLS (verify-schema.mjs:68-76) contains none of the ten Forge tables. (b) FORGE_LAYER pins 4+4+4+4+3+3+4+3+7+3 = 39. `facet_scores_service_recompute` is absent from FORGE_LAYER, and rls_forge.sql has 40 per-table `create policy` statements on Forge tables (46 total minus 6 on existing tables). (c) The verify-schema.mjs comment ('the B7 admin retraction policy ... the A6 per-role pin ... the A8 forge_svc recompute branch. None of their names exists yet') versus rls_forge.sql:655, :1549, :1765. (d) verify-schema.mjs:247-254 says rls_forge.sql 'still said `create policy prescriptions_select`'; rls_forge.sql now has 0 prescription hits. (e) verify-schema.mjs:603 cites 'a fixture harness over synthetic pg_constraint rows'; scripts/ contains only verify-schema.mjs. The gate pins `coaching_notes_forge_append_only`, which rls_forge.sql drops, and does not pin `coaching_notes_append_only`, `coaching_notes_admin_retract`, `handicap_history_forge_source_pin` or `facet_scores_service_recompute`. rls_forge.sql §8 a-d admits the four edits are outstanding.

**Fix.** Make the four pin edits (§8 a-d). Delete or correct the stale comments (a)-(e). State 39 or 40 truthfully. Either commit the harness or drop the claim.

### B27 · [serious] A quotation attributed to rls_core.sql no longer exists, and many rls_forge.sql citations into rls_core.sql point at the wrong lines after rls_core.sql was edited.

**Evidence.** rls_forge.sql:497-499 quotes rls_core.sql:146-147 as: 'coaches_or_pending() → public.users, golf.player_profile (identity + profile card)'. rls_core.sql:155-156 now reads 'public.users (identity ONLY)' and puts player_profile on the coaches() side. Stale line numbers: :441-442 (actual :519-522, which now already includes forge_app/forge_svc, so rls_forge.sql:217's 'CLOSED LIST of four roles' is false); :425-433 billing_svc quote (now :475-476); :167-171 residual (now :194-199); :1127 drill_progress (now :1268); :1356-1362 practice_sessions (now :1500). Correct: :30-32, :621-624, :908-917.

**Fix.** Re-derive each rls_core.sql citation by text rather than line number, or cite the policy name. Remove the quotation marks around text that was rewritten.

### B28 · [serious] rls_forge.sql states questions are unresolved that Makel answered, and holds forge_svc to a standard rls_core.sql explicitly rejects.

**Evidence.** rls_forge.sql:315-318 and §11 item 5 (:2969-2972) say who writes the ('forge',…) role row is 'Makel's pricing decision ... NOT resolved'. Answers #5 (ANSWERS:209-219) decided a separate admin-granted `forge` row, and T-127 exists. §11 item 6 (:2973-2976) asks who holds forge_svc's credential and says 'billing_svc rule ... is the standard it has to meet'. Answers #8 says Atlas holds it, and rls_core.sql:477-481 says 'do not copy billing_svc's rule onto it'.

**Fix.** Mark §11 items 5 and 6 ANSWERED (B5/T-127, Answers #8). Align :128-131 and :138-141 with rls_core.sql:477-481.

### B29 · [serious] The documented apply order cannot be followed. rls_core.sql now grants to forge_app/forge_svc, so it needs the roles first and says they are created by 'rls_forge.sql §2's do $roles$ block'. That block is §1, and rls_forge.sql §0's pre-flight aborts unless the ten tables exist (they need db:migrate, which the order puts after rls_core).

**Evidence.** rls_core.sql:139-141 ('fails with 42704'), :144, :519-522 and the numbered order (create six roles, then rls_core.sql, then migrate, then rls_forge.sql). rls_forge.sql §0 (:77-93) raises 'these tables do not exist yet', and the roles block is §1 (:166). rls_forge.sql:13-14 and :24-35 say rls_core.sql first, with no role-creation step, and call rls_core.sql the owner of the roles.

**Fix.** Add an explicit 'create the two roles by hand' step to rls_forge.sql's APPLY ORDER. Correct '§2' to '§1' in rls_core.sql. Or move the role block into its own pre-flight-free file.

### B30 · [blocking] D1 NOT APPLIED. golf.facet_rung_events has no idempotency key, no unique index, and the file's top header claims it does. A retried /complete still double-promotes.

**Evidence.** forge.ts:1242-1271 declares columns id,user_id,facet,from_rung,to_rung,session_id,ladder_version,occurred_at,source_app,created_at and only index/check entries (no unique). forge.ts:43-44 header says it 'gains idempotency_key'. rls_forge.sql:987-1008 admits 'D1 IS NOT APPLIED'. Case 11 at :2540 is 'expected to FAIL'. The INSERT grant at :985 cannot name the column.

**Fix.** In forge.ts add idempotencyKey (or just rely on a unique arbiter) plus uniqueIndex on (user_id,facet,mode,session_id) where session_id is not null; add the column to the grant at rls_forge.sql:985; flip case 11 to a positive control. Until then delete the false claim at forge.ts:43-44.

### B31 · [blocking] D2 only HALF applied. facet_rungs has mode, but facet_rung_events has no mode column, so the trail cannot say which chipping lie moved.

**Evidence.** forge.ts:1242-1271 (no mode); forge.ts:41-42 header says both ladder tables gain it; rls_forge.sql:1009-1012 and :3012 record the deviation. facet_rungs.mode exists at forge.ts:1166-1186 with CHECK facet_rungs_mode_per_facet.

**Fix.** Add mode text to facet_rung_events (with the same per-facet CHECK) and to the :985 INSERT grant, or delete the claim from forge.ts:41-42 and record the deviation in forge.ts itself.

### B32 · [serious] A1b NOT APPLIED. golf.practice_commitment has no source_app, against AGENT-BRIEF section 6. forge.ts's own header claims it was added and the FORGE header at ~:114-118 repeats 'added 2026-10-09'.

**Evidence.** forge.ts:1307-1337 columns are user_id, blocks_per_week, pinned_facet, pinned_on, pinned_until, created_at, updated_at. forge.ts:45-46 claims 'gains source_app'. rls_forge.sql:1057-1067 and :3004-3008 say 'NOT APPLIED'. Sibling practice_commitment_history has it (forge.ts:1399).

**Fix.** Add sourceApp text('source_app').default('forge').notNull() plus the check source_app in APP_SQL to practice_commitment; leave it out of both :1041/:1043 grants. Or delete the claim.

### B33 · [serious] Gate 6 FAILS: four policies created in rls_forge.sql are not pinned in verify-schema.mjs, and one policy is pinned but no longer created. The file's own section 8 says so.

**Evidence.** Every create-policy name in rls_forge.sql was checked against verify-schema.mjs. Unpinned: facet_scores_service_recompute, coaching_notes_append_only, coaching_notes_admin_retract, handicap_history_forge_source_pin. Pinned-but-absent: coaching_notes_forge_append_only (verify-schema.mjs:316; rls_forge.sql:1755 only drops it). rls_forge.sql:1845-1878 lists these as items a-d.

**Fix.** Add the three pins (facet_scores_service_recompute: ['forge_svc']; handicap_history_forge_source_pin with roles ['forge_app']; coaching_notes_append_only), give coaching_notes_admin_retract a permissive slot, remove line 316.

### B34 · [serious] A5 NOT APPLIED. identity.ts still says the created_by <> subject term is 'NOT WRITTEN YET, see TASKS T-111'. It is written, and T-111 is the Firebase-key task. A false statement committed to source. identity.ts is unmodified since 26b0eae.

**Evidence.** identity.ts:172-173. The term is written at rls_forge.sql:1177 and :1188. git log -- src/schema/identity.ts shows last commit 26b0eae.

**Fix.** Edit identity.ts:169-173: drop 'NOT WRITTEN YET, see TASKS T-111', cite rls_forge.sql:1177/1188, and rename atlas.prescriptions to atlas.assignments.

### B35 · [serious] B1 gate 2 FAILS: live-sounding pointers to the nonexistent table atlas.prescriptions remain in eco.

**Evidence.** grep -rn prescription src sql scripts: atlas.ts:21,35 (the atlas.ts header also still says 'NEITHER GRANT IS ISSUED AND THE ROLE DOES NOT EXIST - see TASKS T-111', now false); identity.ts:169,172; rls_core.sql:545; verify-schema.mjs:191 (`prescriptions_insert_auto`) and :247-254 (says rls_forge.sql still uses the old names, which is no longer true). grep gender hits only historical/explanatory comments (gate 3 passes). rls_forge.sql has zero 'prescription' hits.

**Fix.** Repoint the listed lines to atlas.assignments / assignments_insert_auto and delete the stale :247-254 paragraph. Fix atlas.ts:21-23 and :35 text.

### B36 · [serious] Gate 7 NOT MET: no test asserts the carry_reference to forge-math key mapping. carryTableKeyFor exists but nothing exercises it.

**Evidence.** grep -rl carryTableKeyFor over eco and atlas (excluding node_modules/dist/.git) returns only src/schema/golf.ts, enums.ts, forge.ts and sql/rls_forge.sql, all definitions or comments. The only test file in either repo is atlas/proto/forge/build/forge-math.test.js, which does not call it.

**Fix.** Add a test: carryTableKeyFor('lpga_d3') === 'f' and never 'm'; ('pga_scratch') === 'm'; (null)/(undefined)/('female') === null.

### B37 · [serious] Section 10 contradicts gate 10: the falsification block runs as SET ROLE from the owner, not a real login as forge_app/forge_svc.

**Evidence.** rls_forge.sql:2106, 2116, 2143, 2208, 2321, 2367, 2442, 2485, 2529, 2599, 2697, 2869 all use `set role ...`. The checklist gate 10 requires 'a real login ... not SET ROLE from the owner'.

**Fix.** Rewrite the section 10 preamble and each block opener to connect as the role (psql postgres://forge_app@...), or change the gate wording explicitly.

### B38 · [serious] Apply order is circular and contradicts itself across files. rls_core.sql now grants to forge_app/forge_svc and aborts with 42704 if they do not exist; rls_forge.sql says to run rls_core first.

**Evidence.** rls_core.sql:139-144 'ROLE PRECONDITION ... fails with 42704'; rls_core.sql apply-order note says create roles from 'rls_forge.sql section 2 do $roles$' but that block is section 1 (rls_forge.sql:166) and sits in one begin/commit file behind section 0's preflight (:77-104), which raises if the ten tables do not exist. rls_forge.sql:15-16 says 'rls_core.sql first (it owns the roles...)' and :217 still says rls_core grants to 'a CLOSED LIST of four roles'.

**Fix.** State one apply order in both files. Easiest: extract the section-1 role block to its own tiny preamble file run first, fix the section number, and update rls_forge.sql:12-16 and :217.

### B39 · [serious] A false statement in source: the B7 comment says the retract policy's WITH CHECK holds body/visibility/author/subject unchanged. The actual WITH CHECK does not, and a policy cannot compare old and new rows.

**Evidence.** rls_forge.sql:1734-1739 ('body / visibility / author / subject UNCHANGED ... held still by comparing them to themselves ... Belt and braces') vs the real policy at :1764-1769, which is `using (rls_bypass()) with check (rls_bypass() and deleted_at is not null)`. Only the atlas_app column grant at :1791 holds those columns, and not for the owner or a future role.

**Fix.** Delete the four-term claim at :1734-1739; the grant is the control. (Do not add a policy to 'fix' it; RLS cannot see OLD.)

## Minor

- **[minor] Several rls_forge.sql §10 falsification cases cannot return what they claim.** — §10.0 (:2123-2132) expects count 0 on ten tables, but the SETUP fixtures (:2084-2100) create no rows for range_shots, putt18_holes, facet_rungs, facet_rung_events, practice_commitment, practice_commitment_history or assignment_completions. A 0 there is 'no data', indistinguishable from 'hidden', whi → *Add fixtures and owner-side counts > 0 before §10.0. Run the unset-actor case as the owner. Make the §10.4 control a ROW_COUNT = 1 write as forge_svc.*
- **[minor] Assorted false statements committed to source.** — rls_forge.sql:31-33 says §8 'adds the ten new tables to MUST_FORCE_RLS', but verify-schema.mjs:68-78 lists none of them (FORGE_LAYER covers them conditionally). verify-schema.mjs:168-170, :247-254 and :813-819 say the policies 'do not exist yet' and that ten pinned names are ahead of rls_forge.sql,  → *Correct each statement.*
- **[minor] `grant select on public.users to forge_app` ships a measured date-of-birth exposure to a new role. The file records the 2026-10-09 result `after_pending=t | DOB EXPOSED (1985-09-30)` for the identical `users_coach_read`/`coaches_or_pending` path, and withholds the grant from forge_svc as 'surface area with no reader'. But Answers #8 puts Forge's API inside Atlas's Express under `attachUser` as atlas_app, and the roster is produced by Atlas, so forge_app has no named reader either. No FORGE table policy calls the forbidden accessors, so rule (d) holds. This is the same hole's reach being widened.** — rls_forge.sql:257-289 (grant plus falsification text); :250-256 (forge_app no longer authenticates). → *Drop the grant until the (id, display_name) security_invoker view exists (T-126), or name the concrete forge_app reader.*
- **[minor] §10 contains cases that cannot work as written, and several named controls are prose-only stubs. (1) Case 20 ends in the XX999 sentinel, which rolls back the revoke and its audit row. The 'separate transaction as OWNER' read can then never find a row, so it will always report the trigger as missing. (2) Case 20's unset-actor variant, if run as atlas_app or forge_app, matches 0 rows (coaches() is false with a null id) and never reaches the trigger, so 22023 cannot appear. It is only reachable as the owner. (3) §10.6 case 4 says the insert 'MUST NOT fail here' while expecting 42501; the wording is inverted. (4) :1148 cites '§10.7 case 4' but the case is §10.6 case 4. (5) :2005-2006 and :2018-2020 still describe ending each block with `raise exception 'rollback'`, contradicting :1977-1992. (6) Nothing tests rule (i) (a forge_app write on public.users) or the expires_on revoke. (7) Cases without runnable SQL: §10.3 beyond 3a/3b, §10.4 cases 4-10, §10.6 cases 10-18, all of §10.7. (8) forge_svc holds SELECT on neither golf.range_shots nor golf.putt18_holes (:795 and :871 grant forge_app and atlas_app only), yet :678-683 names a forge_svc job as 'THE PUTT 18 BACKFILL ROUTE'. The job cannot read the holes it must rescore, and case 11a tests only the write.** — rls_forge.sql:2724-2753, :2634-2635, :1148, :2005-2006, :871, :678-683. → *Rewrite case 20 to commit the audit write and read it in the same transaction as the owner. Add the missing cases. Grant forge_svc SELECT on putt18_holes (and range_shots if the evaluator needs it), o*
- **[minor] Stale cross-references and doc claims in the change set. rls_core.sql:487/:508 says roles are created by 'rls_forge.sql §2's do $roles$' (it is §1). The stated apply order is circular: rls_core must run after the roles exist, but rls_forge, which creates them, refuses to run before the drizzle migration and rls_core. rls_forge.sql:1284-1287 says atlas.ts's header 'has been amended in the same change'; atlas.ts is unchanged and still says forge_app grants are 'NOT ISSUED' and mentions `atlas.prescriptions`. rls_forge.sql:31-33 (§8 'adds the ten tables to MUST_FORCE_RLS') and :57-59 ('§6 honours it') point at the wrong sections. rls_forge.sql:468 says 'NO WRITE POLICY ... HAS an rls_bypass() branch' while all ten `*_delete` policies are bypass-only (inert only until a DELETE grant). Stale `prescription` names remain at atlas.ts:21,35, golf.ts:110,116, identity.ts:169-172 and verify-schema.mjs:168,191,247.** — As cited per item. → *Fix the pointers. State one workable apply order, for example create roles by hand, then migration, then rls_core, then rls_forge. Amend atlas.ts's header or drop the claim.*
- **[minor] rls_forge.sql:484 says atlas_app and lr_app 'HOLD NO WRITE GRANT ON ANY TABLE IN §4 at all'. This is false: atlas_app has INSERT and UPDATE on atlas.assignments, which is §4.7.** — rls_forge.sql:1268-1272 grants insert (...) and update (...) on atlas.assignments to atlas_app. Line :484-485 makes the universal claim. The header at atlas.ts:19-22 says 'forge_app on two tables' and omits forge_svc, which writes assignments and assignment_completions. rls_forge.sql:1284 says the h → *Reword :484 to 'no write grant on any Forge-owned golf.* table; atlas_app writes atlas.assignments under identity-pinned policies'.*
- **[minor] Wrong section and case cross-references in rls_forge.sql §10 and its comments.** — rls_forge.sql:528 says 'Test it with ROW_COUNT (§10.1 case 6)'; the re-open case is §10.1 case 7 (:2183), and case 6 is the second-live-session 23505. :1148 says '(§10.7 case 4 is the falsification for exactly this)'; the bypass case is §10.6 case 4 (:2633), and §10.7 case 4 is the forge_svc positiv → *Correct the three case references and the 'THREE'. Rewrite :2005-2006 and :2019-2020 to describe the sentinel pattern actually used.*
- **[minor] Comments in forge.ts, enums.ts and rls_core.sql describe code or locations that no longer exist.** — forge.ts:1103, :1120-1125 and :1229 say the rung tables are 'bypass-only' with a bypass write policy. forge.ts:1134-1140 still says 'OPEN AND BLOCKING (Luke)' while forge.ts:465-470 says C5 is decided. rls_forge.sql:903-906 says the 'OPEN AND BLOCKING' text 'used to be' at forge.ts:1134-1140, but it → *Rewrite these comments to match the SQL and the route. The rung and completion tables are forge_svc under withRls with no bypass branch.*
- **[minor] Count claims are off. Six `unique()` constraints exist in forge.ts, but 'five' and 'fifth' are claimed.** — `grep -c '^    unique('` in forge.ts returns 6 (:313, :637, :644, :652, :1196, :1528). rls_forge.sql:1840 says 'five `unique()` constraints'. forge.ts:1192 says 'the fifth'. verify-schema.mjs:576-584 lists four FK targets plus 'a fifth' and omits `facet_rungs_user_facet_mode_uniq`. setup-db-roles.sh → *Say six, and name facet_rungs_user_facet_mode_uniq.*
- **[minor] The checklist's gate 7 test is cited as if it exists, and no test exists.** — enums.ts:293-296 says 'Gate 7 of the fix checklist is the test that proves it'. There is no test file or script in eco (package.json scripts are build/typecheck/verify:schema/db:*), and `find` for *.test.* and *.spec.* returns nothing. rls_forge.sql §10.2 case 12(e) also defers to 'checklist gate 7' → *Write the carryTableKeyFor test (null returns null, lpga_d3 returns 'f', 'female' returns null), or reword the comment as 'not yet built'.*
- **[minor] golf.ts:29 says the golf schema 'does not exist in the live database (verified 2026-08-05)'. This predates the change but is false now.** — golf.ts:29-30. rls_core.sql dumps live golf.player_profile policies (:435-440). verify-schema.mjs:77-80 lists golf.player_profile and golf.handicap_history in MUST_FORCE_RLS and notes 'golf.* exists in ryp-core'. → *Delete or date-qualify the status line.*
- **[minor] forge.ts still labels closed decisions as OPEN and contradicts its own top header. Also stale 'bypass-only' prose that rls_forge.sql explicitly says it does not make true.** — forge.ts:1134 'OPEN AND BLOCKING (Luke)' on facet_rungs (closed by C5). The practice_commitment_history header (~:1380-1392) says 'STILL OPEN (Luke): ... current week or next' and 'ALSO OPEN: WHICH behind' (closed by C3/C2). rls_forge.sql:912-916 names forge.ts:1103,1120-1125,1229 as stale 'bypass-o → *Replace the OPEN blocks with the C2/C3/C5 decisions; reword the 'bypass-only' lines to 'TO forge_svc'.*
- **[minor] B19/C6 applied in docs only. The vendored forge-math.js:56 still carries '// MEASURED' for CAL.benchmarks, and VENDORED.md says the copy is unmodified except one line. The two statements conflict.** — proto/forge/build/forge-math.js:56 `// MEASURED - typical distance and fairway rate by handicap`; FORGE-MATH-ADOPTION.md:502-512 says tag is UNSOURCED; proto/forge/VENDORED.md says only forge-math.test.js:33 changed. → *Either edit line 56 to UNSOURCED and amend VENDORED.md to name the second change, or state in VENDORED.md that the tag is overridden by the adoption doc. Do not leave both.*
- **[minor] Stale statements in rls_core.sql about coaching_notes.** — rls_core.sql:905 says notes.ts DELETE 'sets deletedAt' (it now returns 409 and never updates, notes.ts:293-317); :907-914 still calls the coach soft-delete conflict 'LEFT OPEN' and warns rls_forge.sql 'still says four columns' although rls_forge.sql section 7.3 closed it and section 7.4 says two (rl → *Edit those comments to point at coaching_notes_append_only / coaching_notes_admin_retract and drop the four-column warning.*
- **[minor] Section 10 internal inconsistencies: wrong cross-refs, fixtures missing, descriptions of a superseded harness, and no falsification of A2's second half.** — rls_forge.sql:528 cites '10.1 case 6' (it is case 7); :1148 cites '10.7 case 4' (it is 10.6 case 4). :2003 calls the range_shots unique a full index, contradicting A2. :2005-2006 and :2019-2020 still describe the old 'raise exception rollback' control that :1977-1981 says was replaced. <SHOT_ON_SESS → *Fix the two refs, add SHOT_ON_SESS_A to SETUP, delete the stale harness description, add a range_shots void-and-reinsert case (expect ROW_COUNT 1, then 23505 on a second live insert).*
- **[minor] B12 Atlas task not recorded as a task row. T-125 still says 'open' though A4 was dissolved by B22.** — grep 'awaiting approval' atlas/docs/TASKS.md returns nothing (appears only in FORGE-PORT-ANSWERS:326 and the checklist). TASKS.md:123 T-125 'open', `GENDERS` text now false. T-111 appears twice (lines 104 and 108). → *Add a TASKS row for the 'awaiting approval' card; mark T-125 dissolved; renumber the duplicate T-111.*
- **[minor] B2 has no enforcement or template, only a comment. Its producer does not exist yet.** — rls_forge.sql:1288-1296 and :3047-3050 state the obligation. No CHECK or template exists. Could be enforced by CHECK (source <> 'auto' or note is null) in forge.ts:1551-1557. → *Optional: add that CHECK so an auto row cannot carry free text at all.*

## Checklist rows reported NOT applied

- A1b practice_commitment.source_app: NOT applied (forge.ts:1307-1337)
- A1b: golf.practice_commitment has no source_app (forge.ts:1307-1337)
- A1b: golf.practice_commitment.source_app - not declared
- A1b: practice_commitment has no source_app column in forge.ts, though the header claims it does
- A5 identity.ts stale comment: NOT applied (identity.ts:173, unmodified since 26b0eae)
- A5: identity.ts:173 still says 'NOT WRITTEN YET, see TASKS T-111'
- A5: the identity.ts comment still says 'NOT WRITTEN YET, see TASKS T-111'
- A8 pin edits in scripts/verify-schema.mjs (facet_scores_service_recompute, coaching_notes_append_only, coaching_notes_admin_retract, handicap_history_forge_source_pin; remove coaching_notes_forge_append_only) - not made
- A9, 'ninth edit': rls_core.sql:904-913 not updated to point at the B7 policies
- B1 (repoint): identity.ts:169/172, atlas.ts:21/26/35 and rls_core.sql:545 still name atlas.prescriptions; gate 2 fails
- B1 / gate 2: atlas.prescriptions pointers remain in atlas.ts, identity.ts and rls_core.sql:545
- B1 repointing: PARTIAL; stale atlas.prescriptions pointers in atlas.ts:21,35, identity.ts:169,172, rls_core.sql:545, verify-schema.mjs:191, :247-254. rls_forge.sql itself is fully renamed.
- B11 audit coverage: expires_on revoke path is not audited
- B12 Atlas 'awaiting approval' card: no TASKS row (T-127 covers B5 only)
- B12: coach.ts:65-68 still says a pending student's profile card comes back, and no 'awaiting approval' card exists (grep found none). This is pending the apply.
- B19/C6 UNSOURCED tag: docs only; forge-math.js:56 still MEASURED
- B19/C6: forge-math.js:56 still tags CAL.benchmarks MEASURED
- B19: prose only, and FORGE-MATH-ADOPTION.md:6 says 'tagged UNSOURCED' while forge-math.js:56 still says MEASURED
- B2 templated auto note: documentation only, nothing enforced
- B22 (gate 3 in atlas docs): FORGE-ON-RYP-CORE.md:133 and FORGE-MATH-ADOPTION.md §2.1/§8 still specify gender
- B22 / gate 3: FORGE-MATH-ADOPTION.md still prescribes gender and gender_at_play
- B22 gate: `grep -rn gender` hits only historical docs - FORGE-ON-RYP-CORE.md:133,611-612 and FORGE-MATH-ADOPTION.md:40,145-172 are live-looking
- B4: no 'defaults to next week' flag exists anywhere to verify
- B5/T-127 and D3 are recorded in TASKS.md and in rls_forge.sql §11 item 12 only as notes. No code exists.
- B7: coaching_notes_admin_retract WITH CHECK does not hold (permissive coaching_notes_update admits bypass)
- Checklist gate 7: test that carryTableKeyFor(null) yields no index and 'lpga_d3' never scores on the men's table - no test exists, and carryTableKeyFor has no caller
- D1 facet_rung_events idempotency key: NOT applied (forge.ts:1242-1271)
- D1: facet_rung_events has no idempotency_key and no unique arbiter
- D1: facet_rung_events has no idempotency_key or unique arbiter (forge.ts:1242-1271)
- D1: golf.facet_rung_events.idempotency_key + partial unique - not declared in forge.ts (header claims it)
- D2 (events half): facet_rung_events has no mode column
- D2 (half): facet_rung_events has no mode, so the trail cannot say which chipping lie moved
- D2 half: golf.facet_rung_events.mode - not declared
- D2 per-lie rungs: facet_rungs done, facet_rung_events NOT (no mode column)
- D3: recorded in rls_forge.sql:3014, golf.ts:231 and verify-schema.mjs:23, but there is no 'migration note' file because no migration has been generated
- Gate 10 real-login falsification: section 10 uses SET ROLE
- Gate 10: §10 uses set role, not a real login
- Gate 1: npx tsc --noEmit in eco exit 0 (no output)
- Gate 2: fails on stale non-historical pointers (see B1)
- Gate 4 drizzle-kit generate: NOT RUN (writes files, outside the read-only brief); the partial-index emission for range_shots_facet_shot_uniq is unverified
- Gate 5: all 24 column-list grants in rls_forge.sql diffed against schema/*.ts, 0 mismatches. Vacuous for A1b/D1 because the grants were written around the missing columns.
- Gate 6 policy pins: FAILS (4 unpinned, 1 pinned-but-absent)
- Gate 6: four pins missing and one stale pin in verify-schema.mjs
- Gate 6: four verify-schema pins are missing or stale, and rls_forge.sql §8 admits it
- Gate 7 carry-mapping test: NOT present
- Gate 7: no carry_reference-to-forge-math mapping test exists
- Gate 7: no test of carryTableKeyFor exists; the repo has no test dir, only scripts/verify-schema.mjs
- Gate 8: `node forge-math.test.js` runs 57 passed, 0 failed. I ran it and this one is satisfied.
- Verified APPLIED with evidence: A1a; A2 grant (rls_forge.sql:674-676 facet_scores, :800-802 range_shots) and partial index (forge.ts:909-911); A3 columns (forge.ts:518/535/549) plus 3 CHECKs; A4/B22 (CARRY_REFERENCES enums.ts:283; carry_reference golf.ts:179; no gender column); A6 (rls_forge.sql:1532, :1548-1552); A7 (verify-schema.mjs:606,:663); A8 (rls_forge.sql:654-657, :683); A9 items 1-8 (rls_core.sql:144, :520-522, :916-917, :487 inventory); B3 (:795); B6 (:1791, notes.ts:166-176 returns 409); B7 policy (:1764-1769); B10 (:1243-1251); B11 trigger (:1332-1367); B17/B18; B20 (enums.ts:364); B21 (forge.ts:1214); C2-C5; ASSIGNMENT_SOURCES = coach/player/auto; forge-math.test.js 57 passed 0 failed with fixture input 245

## Signs of unfinished work

- Checked and clean: `tsc --noEmit` exits 0, and forge-math.test.js reports 57 passed, 0 failed. No non-comment line in rls_forge.sql calls `coaches_or_pending` or `coach_requested`. FACET_MODES and APPS match MODE_SQL and APP_SQL. The entry_method grants on facet_scores and range_shots (rls_forge.sql:675 and :801) agree with forge.ts. The rls_core and rls_forge coaching_notes grants agree on `update (deleted_at, updated_at)`. admin_audit.entity has no CHECK constraint, so the B11 trigger's `entity='assignment'` is not blocked.
- FORGE-ON-RYP-CORE.md §8 and FORGE-MATH-ADOPTION.md §2.1/§8 were never updated for B22, A3 or D2.
- Findings are against commit f90319e (landed 12:23 CDT during this run; line counts unchanged at 3055 and 1650). rls_forge.sql is tracked in that commit despite the brief saying untracked.
- Four verify-schema.mjs pin edits are outstanding (rls_forge.sql §8 a-d), plus a pg_trigger check for `putt18_holes_stamp_expected_putts` and `assignments_audit_coach_change`.
- No trigger pins exist for the expected-putts stamp or the B11 audit.
- Nothing was applied or run: §10 has never executed, the roles do not exist, and no live figure was re-checked (no DB connection, as instructed). `npx tsc --noEmit` in eco exits 0 and `node --check scripts/verify-schema.mjs` passes. Neither is evidence.
- Stale section-10 harness text at rls_forge.sql:2005-2006 and :2019-2020 describes the superseded control, which suggests an incomplete edit pass.
- The 'repoint prescriptions' step of B1 was done only in golf.ts (and partly). identity.ts and atlas.ts are unmodified.
- The B19 re-tag and the B22 atlas doc amendments were not applied.
- The fixture harness cited at verify-schema.mjs:603 is not in the repo.
- The forge.ts header claims D1, D2 (events), A1b and a five-table withheld-grant count that are not built.
- The four verify-schema.mjs pin edits are admitted as outstanding at rls_forge.sql:1845-1852 and §11 item 13.
- The rls_core.sql comment at :904-923 was never reconciled with rls_forge.sql §7.3/§7.4.
- The three forge.ts column additions (facet_rung_events.mode and idempotency_key, practice_commitment.source_app) were claimed in the header and never written.
- The §8 a-d verify-schema pins were explicitly left undone and are still undone (confirmed by grep); the gate will FAIL.
- `npx tsc --noEmit` in eco exits 0, which is not evidence of any of the above. `node --check scripts/verify-schema.mjs` also passes.
- atlas.ts header, golf.ts, identity.ts and verify-schema comments still carry `prescription` names. Atlas docs still carry `gender`.
- forge.ts header :41-46 and ~:114-118 assert D1, D2-events and A1b as done; they are not. The writer or the schema agent stopped before declaring them, and the header was written as if the work had landed.
- forge.ts keeps stale 'bypass-only' prose at :1103, :1121-1123, :1229 and :1567, and a header claiming three columns it does not declare.
- rls_forge.sql is NOT truncated: it ends at :3055 with a closing ==== rule; the section-10 block comment opens at :2112 and closes at :2931 with no nesting; sections 10.0-10.10 are all present. But the file's own section 11 (:2997-3011) states that D1, D2-half and A1b were left unbuilt in forge.ts.
- rls_forge.sql is structurally complete. The `/* ... */` falsification block is balanced (open at :2112, close at :2931). It covers §10.0-§10.10 and §11 follows. It is internally inconsistent in the places listed, not truncated. Cases §10.5, §10.7 and parts of §10.3/§10.4 are one-line expectations, not runnable DO blocks.
- rls_forge.sql itself is structurally complete: it opens with `begin;`, closes with `commit;` at :1950, §10 is a balanced /* */ block (:2112-2931), §11 follows, and there are 46 create-policy statements. It is not abandoned mid-edit. But §10 is partly stubs: §10.3, §10.4 cases 4-10, §10.6 cases 10-18 and all of §10.7 are prose with no runnable SQL, and case 20 cannot work as written.
- verify-schema.mjs is missing the four pin edits (a-d) that rls_forge.sql section 8 assigns to 'the owner of that file'; they were never made.
- §10 is structurally complete, ending at §10.10 with a closed comment block and §11, but many cases are prose with no statement or expected message prefix: §10.1 cases 5, 6, 8 and 9; most of §10.3 and §10.5-§10.7.