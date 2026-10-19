import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, golfDrillProgress } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { isPlanDrillId } from '../../shared/drills'

/**
 * THE PLAYER'S TICK — "I did that rep", and "I have watched the demo".
 *
 * Makel's alpha finding #6, *"can't check off Construction drills"*. The build screen rendered
 * **"0 of 23 drills completed"** to every player, with a progress bar and a per-step `n / m` count
 * off the same number — all of it read from `golf.drill_progress.ticked_at`, A COLUMN NOTHING IN
 * THE SYSTEM WROTE. Not a bug in the control: there was no writer anywhere, in any app.
 *
 * ── Why the column was unwritable, and why that reason died ──────────────────────────────────
 * METRIC-MAP assigned `ticked_at` / `watched_at` to **forge_app**, so atlas_app held no grant on
 * them and `shared/drills.ts`, `protoData.ts` and the page all said so. That was CORRECT WHEN
 * WRITTEN. T-105 (2026-10-06) ended it: FORGE is built on ryp-core and its API runs inside this
 * same Express server, so there is no foreign app whose data contract widening the grant could
 * fork. T-119 then settled that a FORGE rep is not coach-verified — the scored session is the
 * evidence — and the delivered FORGE package produces no tick and no watch anywhere. The column
 * had no owner and no future producer. It is Atlas's now, and this is its writer.
 *
 * ── 🔴 WHY THIS IS ITS OWN ROUTER AND NOT PART OF review.ts ──────────────────────────────────
 * `review.ts` opens with a guarantee — "this router cannot reach drill_progress at all, because it
 * is not in `schema` below" — and that guarantee is load-bearing: it is what makes a player's
 * review request structurally unable to forge a sign-off. Adding this table to that file's schema
 * would quietly delete it. Two tables, two routers, each saying what it can touch.
 *
 * ── 🔴 WHAT STOPS A PLAYER WRITING `verified_at` FROM HERE, and it is NOT this file ──────────
 * `atlas_app` is ONE role serving both players and coaches. The self-UPDATE policy this feature
 * needed puts the player's own row in reach, and that same role's UPDATE grant covers
 * `verified_at` — so the obvious "just widen the column grant" would have let a player sign off
 * their own work with one extra assignment in an upsert. A grant separates ROLES; it cannot
 * separate two kinds of human inside one. The refusal is
 * `app_private.drill_progress_column_owner()`, a BEFORE INSERT OR UPDATE trigger that RAISES
 * 42501 when a caller changes a column that is not theirs — in both directions, because widening
 * the grant also made it possible for a COACH to forge a player's claim for the first time.
 * See the `golf.drill_progress` block in eco's `sql/rls_core.sql`. ⚠️ If you ever find this route
 * able to write `verified_at` in a test, the trigger is missing from that database, not from here.
 */
const schema = { users, golfDrillProgress }

const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  requireConsent(),
]

export const drillTicksRouter = Router()

const tickBody = z.object({ ticked: z.boolean() }).strict()

/**
 * ⚠️ PLAN DRILLS ONLY, AND THE DENOMINATOR IS THE REASON.
 *
 * `golf.drill_progress.drill_id` is unbounded `text` with no CHECK and no FK, so any string a
 * client can put in a URL becomes a permanent row — the same hole `shared/drills.ts` was created
 * to close for the coach's verify route. Here it is worse than a junk row: the page's "N of 23"
 * is `ticked.length` over the plan, so a typo'd id that got written would inflate the NUMERATOR of
 * the exact count this whole change exists to make honest.
 *
 * `isReviewItemId` is the wrong gate — it also admits assessments, the intake and `plan:step-N`.
 * A step is DERIVED (it signs itself off when its drills are verified, see coach.ts) and an
 * assessment is a scored test, not a rep you tick. Only the 23 plan drills are tickable.
 */
function rejectUntickableId(drillId: string): string | null {
  return isPlanDrillId(drillId) ? null : 'unknown_drill'
}

/**
 * Tick or untick a drill.
 *
 * ⚠️ AN UPSERT, NOT AN INSERT. `drill_progress_user_drill_uniq` is on (user_id, drill_id) — one
 * row per player per drill, because a tick is a STATE and not an event log. A coach may already
 * have created the row by verifying it, so the INSERT half is routinely the one that loses.
 *
 * ⚠️ UNTICK IS `ticked_at = null`, NEVER A DELETE. No role holds DELETE on this table and that is
 * deliberate: the row carries the coach's judgement too, and erasing it to clear a player's tick
 * would take a sign-off with it.
 *
 * ── Unticking a drill a coach has already verified is REFUSED (409) ─────────────────────────
 * A decision, not an oversight. The coach watched that rep and recorded a judgement about it;
 * letting the player retract the claim underneath it leaves a row that says "verified" and counts
 * as not-done, which is a contradiction a coach reading the roster cannot resolve. The remedy a
 * player actually wants here is a message or a review request, both of which exist. The guard is
 * in the statement (`where ... verified_at is null`), not in a read-then-write, so two tabs cannot
 * race past it.
 */
drillTicksRouter.post('/drills/:drillId/tick', ...identityChain, async (req, res, next) => {
  try {
    const parsed = tickBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { ticked } = parsed.data
    const me = (req as any).user as typeof users.$inferSelect
    const drillId = String(req.params.drillId)

    const bad = rejectUntickableId(drillId)
    if (bad) {
      res.status(400).json({ error: bad })
      return
    }

    const out = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        /**
         * ⚠️ EXPLICIT-COLUMN SQL, NEVER `db.insert()`. Drizzle names every column of the table and
         * passes `default` for the ones you did not set; with column-level INSERT grants Postgres
         * refuses that as `42501 permission denied for table drill_progress`, which reads exactly
         * like an RLS failure and is not one. This table has no grant on nothing — `user_id` and
         * `drill_id` are not in the UPDATE grant at all, so naming them in a SET would 42501 too.
         *
         * `user_id` is the CALLER and never the body; the self-insert policy pins it to
         * `current_user_id()` as well, so a forged subject is refused by the database rather than
         * merely by this line.
         */
        /**
         * ⚠️ TICK UPSERTS; UNTICK ONLY EVER UPDATES. These are not symmetric and writing them as
         * one `on conflict` statement created a row out of nothing: unticking a drill with no row
         * ran the INSERT half with `ticked_at = null`, leaving an all-null row that then showed
         * up in the coach's student drill list as a drill the player had neither done nor been
         * verified on. Nothing on this page can reach that path — the control only unticks a lit
         * checkbox — but the route is the API, not the page, and "clear a thing that does not
         * exist" must write nothing at all.
         */
        const w = ticked
          ? await db.execute(sql`
              insert into golf.drill_progress
                (user_id, drill_id, ticked_at, created_at, updated_at)
              values
                (${me.id}, ${drillId}, now(), now(), now())
              on conflict (user_id, drill_id) do update set
                ticked_at  = now(),
                updated_at = now()
              returning drill_id, ticked_at, watched_at, verified_at
            `)
          : await db.execute(sql`
              update golf.drill_progress set ticked_at = null, updated_at = now()
               where user_id = ${me.id} and drill_id = ${drillId}
                 and verified_at is null
              returning drill_id, ticked_at, watched_at, verified_at
            `)
        const row = (w.rows as Record<string, unknown>[])[0] ?? null
        if (row) return { row, verified: false, absent: false }

        /**
         * ⚠️ ZERO ROWS IS NOT SUCCESS — and here it has THREE causes that must not share a
         * message. The untick either hit a row the coach has verified (409, a product rule the
         * player can understand), hit NO ROW AT ALL (200 — there was nothing to clear and the
         * caller's desired state is already the state), or was filtered by RLS (403, a failure).
         * Collapsing the middle one into 403 would make the honest no-op look like a refusal.
         * This read runs only on this path and only to tell the three apart; it is not a
         * pre-check the write depends on.
         */
        const r = await db.execute(sql`
          select verified_at from golf.drill_progress
           where user_id = ${me.id} and drill_id = ${drillId}
        `)
        const prior = (r.rows as Record<string, unknown>[])[0] ?? null
        if (!prior) return { row: null, verified: false, absent: true }
        return { row: null, verified: !!prior.verified_at, absent: false }
      },
    )

    if (!out.row) {
      if (out.verified) {
        res.status(409).json({ error: 'verified_cannot_untick' })
        return
      }
      // Unticking something that was never ticked. No row was written and none should have been;
      // the answer the caller needs is the state, which is "not ticked", and it is a 200.
      if (out.absent) {
        res.json({ drill_id: drillId, ticked_at: null, watched_at: null, verified_at: null })
        return
      }
      res.status(403).json({ error: 'not_written' })
      return
    }
    res.json(out.row)
  } catch (err) {
    if ((err as { code?: string }).code === '42501') {
      // The policy, a column grant, or the column-owner trigger refusing the write — the normal
      // way this endpoint says no. Left to the global handler it becomes a 500 carrying the raw
      // Postgres text, which leaks the policy and table names and is the wrong status.
      res.status(403).json({ error: 'not_written' })
      return
    }
    next(err)
  }
})

/**
 * "I have watched the demo for this drill."
 *
 * ⚠️ WRITE-ONCE AND IDEMPOTENT, which is why there is no `watched: false`. The page's gold dot
 * means "you have not opened this yet"; once you have, that is a fact about the past and there is
 * no action that makes it untrue. `coalesce(watched_at, now())` keeps the FIRST time rather than
 * stamping the latest, so re-opening a demo does not rewrite history — and it means a double-fire
 * from a fast double-click changes nothing.
 *
 * ⚠️ Until 2026-10-16 this was `watched: []` in React state, reset on every page load, which is
 * why 12 drills showed "not watched yet" dots to a player who had watched all of them.
 */
drillTicksRouter.post('/drills/:drillId/watched', ...identityChain, async (req, res, next) => {
  try {
    const me = (req as any).user as typeof users.$inferSelect
    const drillId = String(req.params.drillId)

    const bad = rejectUntickableId(drillId)
    if (bad) {
      res.status(400).json({ error: bad })
      return
    }

    const row = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        const out = await db.execute(sql`
          insert into golf.drill_progress
            (user_id, drill_id, watched_at, created_at, updated_at)
          values
            (${me.id}, ${drillId}, now(), now(), now())
          on conflict (user_id, drill_id) do update set
            watched_at = coalesce(golf.drill_progress.watched_at, now()),
            updated_at = now()
          returning drill_id, ticked_at, watched_at, verified_at
        `)
        return (out.rows as Record<string, unknown>[])[0] ?? null
      },
    )

    if (!row) {
      res.status(403).json({ error: 'not_written' })
      return
    }
    res.json(row)
  } catch (err) {
    if ((err as { code?: string }).code === '42501') {
      res.status(403).json({ error: 'not_written' })
      return
    }
    next(err)
  }
})
