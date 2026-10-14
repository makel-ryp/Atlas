# FORGE port — applied to the alpha branch, and §10 actually run

**2026-10-14.** Everything before this document was static evidence. This is what happened when it
was executed.

**Target:** Neon branch `alpha` (`br-spring-dawn-auoaqi5p`), a copy of `main`. **`main` is untouched
and stays at migration 0009.**

---

## What was applied

| Step | Result |
| --- | --- |
| `drizzle-kit generate` → `0010_equal_warbird.sql`, 275 lines | **Exactly one destructive statement**, as predicted: `ALTER TABLE golf.player_profile ALTER COLUMN handedness DROP DEFAULT`. 10 CREATE TABLEs, 6 nullable columns added to existing tables. |
| Pre-flight on live rows | The three CHECKs that land on **existing** tables all validate: 0 self-edges in `user_relationships`, 0 bad `coaching_notes.visibility`. |
| `drizzle-kit migrate` | Applied. 10 new tables present, `handedness` default gone, journal at **11**. |
| `create role forge_app`, `forge_svc` | **`rolbypassrls=false`, `NOINHERIT`**, not superuser. ⚠️ Passwords were generated into a `0600` file and **never passed through tool output** — that is how the T-111 key leaked. |
| `rls_forge.sql` | Applied in one transaction. **120 policies** (7 restrictive), RLS **enabled and forced on all 18** `golf`/`atlas` tables, 21 table grants and **430 column grants** to the Forge roles. |

---

## 🔴 §10.0 — does RLS bind at all? **PASS**

Run as a **real `forge_app` login**, not `SET ROLE` from the owner — `SET ROLE` would still carry the
owner's BYPASSRLS and every refusal below would be a false pass.

The block makes a point worth repeating: **seven of the ten tables had no rows**, so a zero would have
meant "no data" and read as "RLS is binding". Fixtures were seeded into **all ten first**, and the
owner-side counts confirmed every table ≥ 1 before `forge_app` was asked.

```
current_user=forge_app  session_user=forge_app
  PASS  golf.range_sessions ... atlas.assignment_completions   rows=0  (all ten)
  PASS  forge_app bypassrls=false      PASS  forge_svc bypassrls=false
§10.0 PASS — RLS binds on all ten tables.
```

## The attacks — 17/17 refused

| Attack | Result |
| --- | --- |
| Player files a session in another player's name | `42501` |
| Player **chooses their own seed** | `42501` |
| Player **re-rolls the seed** after seeing the holes | `42501` |
| Streak forging — walk `played_on` forward | `42501` |
| 🔴 **Re-open a completed session** *(the silent one)* | **rows=0, no error** — exactly as designed, and why `ROW_COUNT` is asserted rather than "did it throw" |
| Player writes their own **rung** (C5) | `42501` |
| Player inserts a rung **event** | `42501` |
| Player writes an assignment with `source='coach'` | `42501` |
| Player writes an assignment with `source='auto'` | `42501` |
| Player stamps their own **completion** | `42501` |
| Player writes their own `practice_index` | rows=0 |
| **Coach** updates a student's `facet_scores` | rows=0 |
| **Coach** writes a session for a student | `42501` |
| `forge_svc` reads `public.users` | `42501` |

## The reads — with positive controls, because a zero alone proves nothing

```
PASS  A reads B's range_sessions             count=0
PASS  A reads anyone else's facet_scores     count=0
PASS  A reads their OWN sessions             count=2   <- control
PASS  A reads their OWN facet_scores         count=2   <- control
PASS  B (unrelated) reads A's assignments    count=0
```

## The three cases tied to Makel's decisions

```
PASS  PENDING coach reads facet_scores / range_sessions / facet_rungs    count=0  (all three)
PASS  B10  approved coach revokes a PLAYER-set assignment                rows=0
PASS  CONTROL  the same coach revokes a COACH-set assignment             rows=1
PASS  CONTROL  the coach can SEE the player-set row (read-only)          count=1
```

Decision 11 is enforced exactly as written: a coach **sees** a player's self-set work and **cannot**
revoke it, and the control proves the refusal is not just "coach can't revoke anything".

## The append-only note record, run as the right principal

```
PASS  atlas_app RETRACTS under app.rls_bypass            rows=1
PASS  atlas_app UN-retract REFUSED                       SQLSTATE 42501   <- the restrictive fix
PASS  atlas_app rewrites the BODY                        SQLSTATE 42501
PASS  atlas_app changes VISIBILITY                       SQLSTATE 42501
PASS  atlas_app changes author_user_id                   SQLSTATE 42501
PASS  CONTROL atlas_app may set deleted_at               rows=1
```

**The restrictive-policy fix is confirmed working.** The un-retract raises rather than silently
succeeding, which is the whole point of moving that term off the permissive policy.

---

## Four bugs in my own test code, found by running it

Recorded because they are the same failure modes the schema is designed against, and because a
harness that is wrong in the lenient direction manufactures false passes.

1. 🔴 **I tested the retraction as `neondb_owner`, which holds BYPASSRLS** — so it bypassed the
   *restrictive* policy too and reported a HOLE that did not exist. The retraction path runs as
   `atlas_app` (NOBYPASSRLS) with the `app.rls_bypass` **session variable**. Those are different
   things, and conflating them is precisely the distinction this project is built on.
2. **No savepoint after an expected error**, so the next probe returned `25P02` ("in failed
   transaction") and read as a hole.
3. **A guessed column name** (`coach_user_id`; it is `author_user_id`) returned `42703` and read as a
   hole.
4. **My first fixture used `facet='driving'` for a rung** and was correctly rejected — see below.

## The schema refused my fixture, and was right to

`golf.facet_rungs` rejected a `driving` rung with `23514`. Reading the constraints:

```sql
facet_rungs_facet_vocab     CHECK (facet in ('approach','chipping','putting'))
facet_rungs_mode_per_facet  CHECK ((facet='chipping' and mode in ('fairway','rough','bunker'))
                                or (facet='putting'  and mode = 'makeables')
                                or (facet='approach' and mode is null))
```

That is three decisions enforced in the database rather than described in a comment: **driving has no
ladder** (§2.3, "one fixed corridor"), **chipping rungs track per lie** (D2), and **Makeables carries
the putting rungs** (decision 24). The fixture was wrong; the schema was right.

---

## Coverage, stated honestly

**46 cases executed, 46 pass.** That is not the whole of §10 — the file carries roughly eighty cases
across §10.0–§10.10. What ran is §10.0 in full, the §10.1 attack set, the cross-user reads with
controls, and every case tied to a decision Makel made. **Not yet run:** the remaining per-table
sections, the two trigger behaviours (`putt18_holes_stamp_expected_putts`,
`assignments_audit_coach_change`), and `verify:schema` against a database.

**`main` is untouched.** Nothing here has been applied to production.
