import { Router } from 'express'
import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { plans } from '@ryp/eco/schema'
import { pool } from '../db'

// Unscoped on purpose. `plans_select_all` is `using (true)` and atlas_app holds `select` on
// public.plans, so this needs neither withRls (there is no user yet — the pricing page renders
// before login) nor withRlsBypass (never on a user-facing route). Writes stay bypass-only.
const db = drizzle(pool, { schema: { plans } })

export const plansRouter = Router()

plansRouter.get('/plans', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        code: plans.code,
        name: plans.name,
        rank: plans.rank,
        audience: plans.audience,
        isActive: plans.isActive,
        priceCents: plans.priceCents,
        currency: plans.currency,
        interval: plans.interval,
      })
      .from(plans)
      // Gates compare rank, never string equality, so rank is also the display order.
      .orderBy(asc(plans.rank))
    res.json(rows)
  } catch (err) {
    next(err)
  }
})
