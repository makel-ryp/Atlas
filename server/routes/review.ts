import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, golfDrillReviewRequests } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { isReviewItemId, isStepCompletionId } from '../../shared/drills'

/**
 * THE PLAYER'S HALF OF THE REVIEW LOOP — the first player-side write Atlas has ever had.
 *
 * Makel's alpha test, 2026-09-25: *"This information is not relayed to the coach."* It was not,
 * and the reason was structural rather than a bug: every control on the player's surface wrote to
 * React state and stopped there, because **there was no table in which a player could say
 * anything at all**. Six of his thirteen findings traced to that one absence.
 *
 * This closes the smallest, most load-bearing part of it: "I have filmed this rep, please look at
 * it." The coach's answer already existed (`golf.drill_progress.verified_at`); only the question
 * was missing.
 *
 * ── Why its own router ──────────────────────────────────────────────────────────────────────
 * `coach.ts` is coach-authored writes about a student. This is the opposite direction and the
 * opposite authority, and folding it in would put the two under one file where the next edit can
 * confuse whose row is whose. The tables enforce the split — this router cannot reach
 * drill_progress at all, because it is not in `schema` below — and the file boundary keeps that
 * legible.
 *
 * ── What this router structurally CANNOT do ─────────────────────────────────────────────────
 * Write a coach's judgement. Not by policy alone, but three ways over: `golf.drill_progress` is
 * absent from `schema`; the policy on drill_review_requests is `user_id = current_user_id()`; and
 * `verified_at` is not a column in that table. A player cannot forge a sign-off from here even if
 * every line below were wrong.
 */
const schema = { users, golfDrillReviewRequests }

const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  requireConsent(),
]

export const reviewRouter = Router()

const bodySchema = z
  .object({
    requested: z.boolean(),
    /**
     * The player's own line — "third rep is the one to watch". Bounded because it renders in the
     * coach's queue, and an unbounded free-text field on a surface another person reads is how a
     * list becomes unusable. Nullable: clearing the note is a real action.
     */
    note: z.string().trim().max(280).nullable().optional(),
  })
  .strict()

/**
 * Ask a coach to look at a rep — or withdraw the ask.
 *
 * Idempotent, and keyed (user_id, drill_id) like `drill_progress`, so re-requesting updates the
 * standing request rather than appending. Withdrawing sets `requested_at = null` rather than
 * deleting the row: "a tick is a state, not an event log", the same rule drill_progress follows,
 * and it means the row survives to carry a note.
 */
reviewRouter.post('/drills/:drillId/review-request', ...identityChain, async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const { requested, note } = parsed.data
    const me = (req as any).user as typeof users.$inferSelect
    const drillId = req.params.drillId as string

    // Same guard, same list, same reasoning as the coach's verify route: `drill_id` is unbounded
    // `text` with no CHECK and no FK, so without this any string in a URL becomes a permanent row.
    // Checked against the list the page renders from, so client and server cannot drift.
    if (!isReviewItemId(drillId)) {
      res.status(400).json({ error: 'unknown_drill' })
      return
    }

    /**
     * A STEP IS NOT A REP, so it cannot be submitted for review.
     *
     * `plan:step-N` is a DERIVED row — it signs itself off when every drill in the step is
     * verified (see coach.ts). There is no video of a step and nothing for a coach to watch, so a
     * request against one would sit in their queue forever with nothing that could clear it.
     * Refused for the same reason the coach cannot sign one by hand.
     */
    if (isStepCompletionId(drillId)) {
      res.status(409).json({ error: 'step_is_automatic' })
      return
    }

    const row = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        // `user_id` is the CALLER, never the body — and the insert policy pins it to
        // current_user_id() as well, so a forged subject is refused by the database and not
        // merely by this line.
        const out = await db.execute(sql`
          insert into golf.drill_review_requests
            (user_id, drill_id, requested_at, note, created_at, updated_at)
          values
            (${me.id}, ${drillId},
             ${requested ? sql`now()` : sql`null`},
             ${note ?? null}, now(), now())
          on conflict (user_id, drill_id) do update set
            requested_at = ${requested ? sql`now()` : sql`null`},
            note         = ${note === undefined ? sql`golf.drill_review_requests.note` : note},
            updated_at   = now()
          returning drill_id, requested_at, note
        `)
        return (out.rows as Record<string, unknown>[])[0] ?? null
      },
    )

    // ⚠️ ZERO ROWS IS NOT SUCCESS. An RLS-filtered write matches nothing and reports no error —
    // the silent failure this repo has been bitten by three times. Returning 200 here would tell
    // the player their coach had been notified when nothing was written.
    if (!row) {
      res.status(403).json({ error: 'not_written' })
      return
    }
    res.json(row)
  } catch (err) {
    const code = (err as { code?: string }).code
    // 42501 is the policy or a column grant refusing the write — the normal way this endpoint
    // says no. Left to the global handler it returns 500 with the raw Postgres text, which leaks
    // the policy and table names and is the wrong status.
    if (code === '42501') {
      res.status(403).json({ error: 'not_written' })
      return
    }
    next(err)
  }
})
