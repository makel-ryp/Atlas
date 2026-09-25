import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, golfPracticeSessions } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

/**
 * THE PRACTICE LOG — "did the work happen, and for how long".
 *
 * Makel's alpha test, 2026-09-25: *"I can not click the log today button to save my progress.
 * after a revisit to the page my progress is erased."* The button fired every time; there was
 * simply nowhere for it to go. `const SEED = {}` in the prototype carried the honest comment —
 * *"Nothing records practice: there is no practice-session table anywhere in ryp-core"* — and the
 * whole log lived in React state until the tab closed.
 *
 * ⚠️ A DATE IN THE PATH, NOT A DAY NUMBER. The prototype keys its log by bare day-of-month, so 3
 * October and 3 September are the same key. Harmless while nothing persisted; silent corruption
 * the moment something did. This route accepts only a full ISO date and the client was remapped
 * onto it in the same change.
 */
const schema = { users, golfPracticeSessions }

const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  requireConsent(),
]

export const practiceRouter = Router()

/** Construction | Calibration | Transfer | Performance — the log's four zones (ZONE_COLOR). */
const ZONES = ['Construction', 'Calibration', 'Transfer', 'Performance'] as const
/** Lift | Mobility | Speed | Rest — WORKS in the prototype. */
const WORKOUTS = ['Lift', 'Mobility', 'Speed', 'Rest'] as const

const bodySchema = z
  .object({
    // Nullable is a real state, not an omission: clearing a day sets these null and KEEPS the row,
    // which is why no DELETE grant exists anywhere in this feature.
    minutes: z.number().int().min(0).max(1440).nullable(),
    zone: z.enum(ZONES).nullable(),
    workout: z.enum(WORKOUTS).nullable(),
  })
  .partial()
  .strict()

/**
 * The calendar day, validated as a real date rather than a shape.
 *
 * `/^\d{4}-\d{2}-\d{2}$/` alone accepts 2026-02-30 and 2026-13-01, which Postgres would then
 * reject as a 22008 — a 500 carrying the raw driver text. Round-tripping through Date catches the
 * roll-forward the same way `storedDateOfBirth` does for a birthday.
 */
function parseDay(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return raw
}

practiceRouter.put('/practice/:day', ...identityChain, async (req, res, next) => {
  try {
    const day = parseDay(String(req.params.day))
    if (!day) {
      res.status(400).json({ error: 'invalid_date' })
      return
    }
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    const { minutes = null, zone = null, workout = null } = parsed.data

    /**
     * ⚠️ NO LOGGING PRACTICE YOU HAVE NOT DONE YET.
     *
     * The calendar already refuses to render a future day as loggable ("Not yet — this day is
     * ahead of you"), but that is a screen, not a gate. Without this the endpoint would accept any
     * date, and the first thing a practice log has to be is believable — a coach reads it as
     * evidence of a week. The comparison is on the DATE STRING, in UTC, so it cannot drift by a
     * time zone the way a Date comparison would.
     */
    const todayUtc = new Date().toISOString().slice(0, 10)
    if (day > todayUtc) {
      res.status(400).json({ error: 'date_in_future' })
      return
    }

    const row = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        // `user_id` is the CALLER, never the body, and the insert policy pins it to
        // current_user_id() too — so a forged subject is refused by the database, not by this line.
        const out = await db.execute(sql`
          insert into golf.practice_sessions
            (user_id, session_date, minutes, zone, workout, source, created_at, updated_at)
          values
            (${me.id}, ${day}::date, ${minutes}, ${zone}, ${workout}, 'atlas', now(), now())
          on conflict (user_id, session_date) do update set
            minutes    = ${minutes},
            zone       = ${zone},
            workout    = ${workout},
            updated_at = now()
          returning session_date, minutes, zone, workout
        `)
        return (out.rows as Record<string, unknown>[])[0] ?? null
      },
    )

    // ⚠️ ZERO ROWS IS NOT SUCCESS — an RLS-filtered write matches nothing and throws nothing.
    // Returning 200 here would tell a golfer their week was recorded when it was not, which is
    // the precise complaint this endpoint exists to answer.
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
