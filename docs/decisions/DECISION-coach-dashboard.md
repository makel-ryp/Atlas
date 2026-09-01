# Decision — Atlas owns the coach dashboard

**Decided Mon 2026-08-24 by Makel.** Closed the open question of who owns the coach dashboard.
(The gap analysis that raised it has been superseded by `GAP-REPORT-design-vs-build.md`.)

> Atlas would envelop the main coach dashboard view, although a retention of the Locker Room one
> with LR-specific metrics may still be necessary. The Atlas coaching dashboard should give the
> coach access to all Atlas app metrics for all of the coach's students.

> Kids can be assigned to an academy and the coaches also assigned to that academy can see the kids
> in it.

> Basic profile info and forge/red metrics — identity only until approved.

All three are built and proven — §3, §3a, §3b.

Also settled the same day: **`lukeryp/atlas-golf` is not real** — `ECOSYSTEM.md` §6.5's "live
front-door port" question is closed. There is no unexamined Atlas port. Nothing changes.

---

## 1. What this means structurally

**Atlas becomes the only surface that reads across users.** Until now every policy in `ryp-core` was
self-scoped: you see your own row and nothing else. A coach dashboard that shows "all Atlas metrics
for all my students" is by definition cross-user, so this decision **pulls a piece of M5 — "the
gates open," the milestone flagged as hardest — forward into Atlas's own scope.**

That is not an argument against it. Atlas is the identity nucleus; it already owns
`user_relationships`, so it is the only app that *can* enforce the boundary honestly. But it does
mean the coach dashboard is not "another screen" — it is the first consumer of cross-app data, and
it should be planned as its own milestone rather than folded into M1.

---

## 2. The line between the two dashboards

Both exist. They are not the same screen with different logos.

| | **Atlas coach dashboard** | **Locker Room coach dashboard** |
| --- | --- | --- |
| Answers | "How is my student's golf developing?" | "How is my program running?" |
| Population | The coach's own students, individually | A roster, as a squad |
| Scoped by | `user_relationships` (`coach_of`, approved) | `organizations` / `org_memberships` |
| Reads | `golf.*` + `atlas.*` — profile, handicap history, practice sessions, indices, rounds, drill progress, prescriptions, coaching notes | `locker_room.*` — roster, assessments, conflict scripts, player notes, recruits |
| LR-specific metrics that stay | — | GPA, class year, position, pulse streak, recruiting, the dyadic coach↔player assessment |

**The test for "which dashboard does this belong on":** does the metric exist for a golfer with no
team? If yes it is Atlas. If it only means something inside a program, it is Locker Room.

That keeps `locker_room.*` app-private (rule 1 holds) and keeps Atlas from growing a roster/recruiting
surface it has no business owning. The one thing to watch is the **player file** — both will want
one. Atlas's is the golf record; Locker Room's is the program record. If they converge, Locker Room's
should embed or link Atlas's, not copy it.

---

## 3. Built today — the authorization boundary

This decision made a gap I had flagged as "deferred" into the thing the whole dashboard rests on, so
it is fixed and proven rather than documented.

**Before:** `user_relationships` had one `FOR ALL` policy whose `WITH CHECK` required only
`actor_user_id = me` and said nothing about `status`. A coach could insert their own edge with
`status='active'` and immediately read that player's profile — **no consent step, for any player
whose UUID they knew.** The schema already disagreed: `status` defaults to `'pending'` and there is an
`approved_at` column.

**Now:**

- **`app_private.coaches(subject uuid)`** — one `SECURITY DEFINER` oracle, requiring an *approved*
  active `coach_of` edge. Every cross-user coach policy calls it; nothing inlines the rule. The two
  policies that previously inlined it were both missing the `approved_at` check.
- **Per-command policies.** A coach may only **request** (`status='pending'`, `approved_at` null).
  Only the **subject** may set `'active'`. The actor may only set `'ended'`. Delete is bypass-only.
- **`UPDATE` restricted to `(status, approved_at)`** by column grant. This is doing real work: without
  it an actor could rewrite `subject_user_id` on their own row and evade the policies entirely. The
  row's identity is now immutable after insert, so policies only police *who* and *what status*.
- **`users_coach_read`** added — a coach previously could not read their own student's **name**, so
  the dashboard could not have rendered a roster at all.

**Verified over a real `atlas_app` connection** (`NOBYPASSRLS`, not `SET ROLE`):

| Attempt as the coach | Result |
| --- | --- |
| Insert edge with `status='active'` | **refused** — violates RLS policy |
| Insert edge with defaults | allowed → `pending` |
| Approve own request | **refused** — violates RLS policy |
| Read un-approved player's profile | 0 rows |
| Read approved student's profile + name | 1 row each |
| Then, as the **player**, approve it | allowed — and the coach's read starts working |

The seed script now runs that real two-step loop instead of one privileged write, so the demo path
and the product path are the same path.

---

## 3a. Academy-scoped access — built and proven

Two paths now, kept as **separate functions** so each can be audited, tested and revoked without
touching the other:

| | Granted by | Consent is |
| --- | --- | --- |
| `coaches_directly()` | an approved `coach_of` edge | the **student** personally approving |
| `coaches_via_academy()` | shared academy membership | the **academy admin** making the assignment |

`coaches()` is the OR of the two, and it is the only thing policies call.

**Why path 2 needs no per-student approval, precisely:** `org_memberships_write` is bypass-only and
**only `billing_svc` holds a write grant** on that table. `atlas_app` has `SELECT` and nothing else.
So a coach can neither add themselves to an academy nor add a student to one — membership is
administratively assigned, and the assignment *is* the consent. **Those two facts are one mechanism.**
If that write grant is ever loosened, `coaches_via_academy()` silently becomes a self-service grant
to every student's data.

Also: `student.role` must be `'member'`, so two coaches in the same academy do not gain access to
each other. And `org_memberships_staff_read` was added — without it a coach could not list their own
academy's members, so no roster would render. It calls `is_org_staff()`, which **must** stay
`SECURITY DEFINER`: it is a policy on `org_memberships` whose predicate reads `org_memberships`, and
the invoker version dies with `stack depth limit exceeded`.

**Verified as `atlas_app`** with an academy where the coach is staff, student S is a member, and
outsider O is in no academy:

| Attempt | Result |
| --- | --- |
| coach reads S's profile and name | 1 row each |
| coach reads a **direct-edge** student not in the academy | 1 row — both paths work |
| coach lists the academy roster | all members |
| **S reads O's profile** | 0 rows — kids cannot read kids |
| **O reads S's profile** | 0 rows |
| S lists the roster | 1 row — only their own membership |
| **coach inserts any `org_memberships` row** | `permission denied for table` |
| **coach promotes themselves to admin** | `permission denied for table` |

The last two are **privilege** denials, not policy denials — stronger, and the load-bearing fact
behind path 2 having no approval step.

### ⚠️ Two consequences worth deciding on

**Only `billing_svc` can assign anyone to an academy.** There is no admin path for it yet — so
"assign this kid to the academy" currently has no user interface at any privilege level. That belongs
in the Atlas admin panel (roadmap M1 already lists an admin panel; this is one more thing it owns),
running as `billing_svc`, with an `admin_audit` row per assignment.

**"Kids" makes parental consent a real gate, not a column.** `users.date_of_birth` and
`users.parental_consent_at` both exist and **nothing reads or enforces either one.** `ROLES` includes
`'parent'` and `RELATIONSHIPS` includes `'parent_of'`, both unused. If academy members are minors,
then several adults reading a child's performance record is a consent question that the RLS layer
cannot answer — it enforces *who*, not *whether it was permitted*. The cheap version: capture consent
at academy assignment (the admin path above is the natural chokepoint) and refuse the assignment when
`date_of_birth` implies a minor and `parental_consent_at` is null. Worth settling before real
academies are onboarded rather than after.

## 3b. What a coach sees — two tiers

A coach sees **basic profile info and Forge/Red metrics** of a student. But only an **approved**
student shows the metrics half.

| Tier | Gated by | Tables | Visible when |
| --- | --- | --- | --- |
| **Identity** | `coaches_or_pending()` | `public.users`, `golf.player_profile` | active relationship **or** an outstanding request |
| **Metrics** | `coaches()` | `golf.handicap_history` + every future metric table | approved relationship / academy membership only |

On a pending request the coach gets just enough to confirm they asked for the right person — name and
the profile card. **Without this split, approval on the direct-coach path would grant nothing the
coach could not already read, and the consent loop in §3 would be decorative.**

The academy path has no pending state — assignment is immediate — so for an academy student the two
tiers coincide. That is correct: the academy admin already made the call.

**This line is enforceable in the database only because the metrics live in different *tables* from
the profile.** Worth protecting as more tables arrive: every metric table gates on `coaches()`, never
`coaches_or_pending()`. `eco/sql/rls_core.sql` carries the falsification table for it.

**Verified as `atlas_app`**, with a `handicap_history` row present for each student so that 0 rows
means *hidden* and not *no data*:

| Relationship | `public.users` | `golf.player_profile` | `golf.handicap_history` |
| --- | --- | --- | --- |
| none | 0 | 0 | 0 |
| **pending request** | 1 | 1 | **0** ← the whole point |
| approved / academy | 1 | 1 | 1 |
| peer (student → student) | 0 | 0 | 0 |

### One residual, and one hard fact

**Residual:** RLS is row-level, so a pending-visible `users` row exposes every column `atlas_app` has
a grant on — including `email`, not only `display_name`. Tolerable today because a coach must already
identify a student in order to request them, so they know it already. If that stops being true (a
search-by-name endpoint), the fix is a `security_invoker` view projecting the identity columns — a
policy cannot express "this row, but only these columns, and only when pending".

**Hard fact: the Forge and Red metrics have nowhere to live yet.** `ryp-core` has exactly **two**
`golf` tables — `player_profile` and `handicap_history`. The `ryp_red` and `forge` schemas do not
exist at all, and neither do `golf.practice_sessions`, `practice_index_results`, `rounds`,
`round_shots` or `player_metrics`. The authorization layer for "Forge/Red metrics" is now complete and
proven; **the metrics themselves are 24 tables that have not been created.** That is what M2 (Red
stands) and Luke's Forge data contract deliver, and it is the real gate on the coach dashboard — not
the policies.

## 4. What is still needed for the dashboard itself

Not started — this is the scope, so it can be planned rather than discovered.

1. **A milestone.** It is currently on none. Given §1 it belongs between M4 and M5, or as the first
   half of M5 — not inside M1, and not in "Not in v1."
2. **The data does not exist yet — this is the real gate.** `atlas.*` has no tables at all
   (`prescriptions`, `coaching_notes`, `messages`, `zone_grades`), and `golf` has only 2 of its 26.
   `ryp_red` and `forge` are not schemas yet. Everything in §3b authorizes reads against tables that
   have to be created first, by M2 and by Luke's Forge contract.
3. **~10–20 more coach-read policies**, one per table the dashboard reads. All are one line now that
   `coaches()` exists — that was the point of building the oracle first.
4. ~~Decide: does org membership also grant coach access?~~ **ANSWERED and built — §3a.**
5. ~~Decide: what does a coach see of a pending student?~~ **ANSWERED and built — §3b.**
6. **Cancellation must end the edge.** `METRIC-MAP.md`:606 flags this: if a coaching subscription
   lapses and the edge stays `'active'`, the ex-subscriber keeps RLS read access to their students.
   Billing has to write `status='ended'`, and nothing does that yet.
7. **The four zones** (Construction → Calibration → Transfer → **Performance** (NOT 'Speed' — I had that wrong; verified against `BLOCKS` in Dashboard.dc.html. Speed belongs to the separate fitness axis `WORKS = ['Lift','Mobility','Speed','Rest']`)) and the **stakes**
   mechanic from Luke's prototype are the dashboard's actual content, and appear in no schema. If the
   dashboard is being built, these need a home in `atlas.*`.

None of this touches Sprint 1 or the 7 Sep demo. Items 4 and 6 want answers before any of it is built.
