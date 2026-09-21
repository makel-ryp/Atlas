-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Close the self-consent hole: a minor can currently consent for themselves.
--
-- ⚠️ NOT APPLIED. Written 2026-09-21, never run against any database. Needs Makel's go-ahead and
--    an eco release, because eco owns public.* — Atlas cannot migrate this table.
--    Do not mark this done until someone has run it and re-run the falsification test at the end.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- THE HOLE
-- --------
-- Two independently correct facts combine into one wrong one:
--
--   grant update (display_name, email, date_of_birth, parental_consent_at, updated_at)
--     on public.users to atlas_app, red_app, lr_app;          -- privilege: yes
--
--   create policy users_update on public.users for update
--     using  (rls_bypass() OR id = current_user_id())          -- policy: your own row
--     with check (rls_bypass() OR id = current_user_id());
--
-- Privilege ✔ + policy ✔ = a 14-year-old's own session may write their own `parental_consent_at`.
-- RLS scopes ROWS, not COLUMNS, so no policy can express "…except this column". There is no
-- policy fix. The grant is the only layer that can refuse it.
--
-- This is precisely the argument the file already makes for `plan`, three lines above the grant:
-- "`users_update` says 'you may update your own row' — RLS cannot say '…but not this column', and
-- `plan` lives on that row." `plan` was left out of the grant for that reason. `parental_consent_at`
-- was not, and it is the more dangerous of the two: a self-granted plan costs money, a
-- self-granted consent defeats a child-protection control.
--
-- Today the only barrier is route surface — no route the account holder can reach writes that
-- column (asserted by scripts/smoke.ts section J). That is one layer. This makes it two, so that a
-- future careless `.set({ ...req.body })` is refused by the database rather than by a code review.
--
-- WHY date_of_birth STAYS
-- -----------------------
-- The account holder must be able to write their own date of birth once, or the gate has no exit
-- (see routes/me.ts `gatedChain` — the deadlock note). Write-once is enforced in the route, with
-- `where … and date_of_birth is null` so two concurrent tabs cannot both win. Self-asserted age is
-- defeatable by lying on the way in, which no schema prevents; what this stops is the SECOND lie,
-- an account editing its way out of a gate it already fell into.

begin;

revoke update (parental_consent_at) on public.users from atlas_app, red_app, lr_app;

-- billing_svc keeps `grant select, update on public.users` (table-wide, unchanged) — it is the
-- role behind withRlsBypass on billingPool, which is how routes/admin.ts records consent. Same
-- trusted-path shape as user_app_roles: the app that could abuse the write structurally cannot
-- make it.

commit;


-- ─── FALSIFICATION TEST — run this AFTER applying, or the change is unverified ────────────────
-- As atlas_app, impersonating an ordinary user writing their OWN row. Expected: ERROR 42501,
-- "permission denied for table users". If it reports UPDATE 0 or UPDATE 1 instead, the revoke did
-- not take and the hole is still open.
--
--   set role atlas_app;
--   begin;
--   select set_config('app.current_user_id', '<a real user uuid>', true),
--          set_config('app.rls_bypass', 'false', true);
--   update public.users set parental_consent_at = now() where id = '<that same uuid>';
--   rollback;
--
-- ⚠️ "No error" is NOT success here, and the two failure modes look nothing alike:
--     • ERROR 42501  → the revoke worked. This is the PASS.
--     • UPDATE 1     → the revoke did not apply. The hole is open.
--     • UPDATE 0     → RLS filtered the row; you set the wrong uuid. The test proved nothing —
--                      fix the uuid and run it again rather than reading it as a pass.
--
-- And the other direction, which must still work or admins cannot unblock anyone:
--   set role billing_svc;
--   begin;
--   select set_config('app.rls_bypass', 'true', true);
--   update public.users set parental_consent_at = now() where id = '<that uuid>';  -- expect UPDATE 1
--   rollback;
