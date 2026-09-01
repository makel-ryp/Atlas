# Runbook — rotate `neondb_owner` on `ryp-red`

**Written 2026-08-26.** One coordinated session, ~15 minutes. **Two people: Makel + Yannick.**

## Why

Every login role on the `ryp-red` Neon project bypasses RLS, so **that one password is the entire
security boundary on live data** — 23 users and all 42 `locker_room` rows. It has appeared in
conversation, so it should be treated as known.

It is a bigger exposure than the `user_app_roles` self-grant hole, because the self-grant needs an
app endpoint that accepts a role parameter (none exists — verified) whereas the password needs
nothing but the string.

## What breaks, and why it must be one sitting

**RYP-RED and Locker Room both connect as `neondb_owner`.** The moment the password changes, every
service still holding the old string starts failing on its next connection. There is no grace period
and no dual-password window in Postgres.

So the rotation and every paste happen back to back, with both owners present. Do **not** start this
if Yannick is unavailable.

## Before you start

- [ ] Yannick on a call or actively responding.
- [ ] **List every place the string lives.** Expect four, confirm rather than assume:
      RYP-RED production, RYP-RED any preview/staging, Locker Room production, Locker Room staging.
      Yannick said Locker Room has **both Railway envs** pointed at this same database.
- [ ] Anywhere else? A local `.env.local`, a GitHub Action secret, a cron job, a Retool/Metabase
      connection, someone's `psql` history. **The rotation only helps if the old string stops
      working everywhere it is used — and only hurts if you miss a place that needed it.**
- [ ] Pick the quiet window. Not during a Debrief playtest session.

## Steps

1. **Neon console** → project `ryp-red` (`lucky-rain-86769207`) → **Roles** → `neondb_owner` →
   **Reset password**. Copy the new string immediately; Neon shows it once.
2. **Straight into your password manager**, before anything else. Not Slack, not a note.
3. **Update Railway**, all four places, one after another:
   - RYP-RED prod → `DATABASE_URL`
   - RYP-RED staging/preview → `DATABASE_URL`
   - Locker Room prod → `DATABASE_URL` *(Yannick)*
   - Locker Room staging → `DATABASE_URL` *(Yannick)*
   Railway redeploys on an env change. Let each finish before the next.
4. **Send Yannick the string through the password manager's share, not chat.**

## Verify — all four, not just the two you own

- [ ] RYP-RED prod: log in, load a round. Not just "the page renders" — a round read hits the DB.
- [ ] RYP-RED staging: same.
- [ ] Locker Room prod: log in, load the roster.
- [ ] Locker Room staging: same.
- [ ] Railway logs for all four: no `password authentication failed`.

If one of them is broken, the string in that service is wrong — re-paste it rather than rolling back.

## Rollback

There is none in the usual sense: you cannot restore the old password. If something is broken, the
fix is forward — find the service still holding the old string and paste the new one. That is why
step 2 (into the password manager first) is not optional; losing the new string mid-rotation is the
only genuinely bad outcome here.

## What this does NOT fix

- The `user_app_roles_all` self-grant policy. Unreachable today (no endpoint takes a role parameter,
  and RLS is not evaluated anyway) but it becomes live the moment a NOBYPASSRLS role is introduced.
  **Fix it in the migration, in the same change that creates that role.**
- The fact that both apps run as a superuser-equivalent. That is what the migration's `lr_app` /
  `red_app` roles are for.

---

## Related: the test branch, already cut

`lr-rls-test` on `ryp-red` — branch `br-winter-star-amr69w81`, forked from production, so it carries
the real schema and all 23 users.

A **`lr_app` role exists on that branch only** (`nobypassrls`, `login`, and confirmed absent from
production). **It has no password yet** — deliberately, so the secret never passed through a
transcript. Set one in the Neon console with the branch selected, then share it with Yannick through
the password manager.

**What the branch already proves** (run as `lr_app`, cleaned up afterwards — the branch now matches
production exactly at 21 role rows):

| Step | Result |
| --- | --- |
| `select count(*) from public.users`, no session vars | **0** — RLS binds, unlike production |
| same, acting as one ordinary user | **1** |
| self-insert `('locker_room','admin')` | **succeeded** |
| `select count(*) from public.users` again | **23** |

That is Yannick's escalation, demonstrated end to end: one user's own row, then every user in the
system. It is real, and it is exactly why the policy split belongs in the same change that
introduces the non-bypassing role — on production today the policy is never evaluated, so splitting
it there changes nothing.
