import express, { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { attachUser, requireApp } from '@ryp/eco/auth'
import type { users } from '@ryp/eco/schema'
import { pool } from '../db'
import { feedbackConfig } from '../feedbackConfig'
import { cookieOrBearer } from '../cookieOrBearer'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { sendFeedback, SlackError, type SlackTarget } from '../slackFeedback'

/**
 * POST /api/feedback — a tester's note, with a screenshot, into a Slack thread.
 *
 * The widget that calls this is injected by routes/proto.ts and exists only while the config in
 * ../feedbackConfig is complete. This router is mounted under the same condition (index.ts); when it
 * is not, /api/feedback answers 503 from a stub and nothing here is reachable.
 *
 * ── NO `requireConsent()`, deliberately ─────────────────────────────────────────────────────────
 * The other identity chains end in it. This one does not, and a later "make it consistent" edit would
 * be wrong: a minor whose consent is outstanding cannot use the app, and "I can't get in" is exactly
 * the report that most needs to reach us. The route reads no golfer data and writes none — it carries
 * what the tester typed, plus their name and email, to a channel Makel owns. (Today the widget only
 * appears on /proto/dashboard, which is itself consent-gated, so that case is not yet reachable from
 * the button; the route is simply not the thing that should close it.)
 *
 * No database is touched, so no pool, no withRls, and no admin_audit row: there is no mutation of
 * Atlas state to audit. `pool` is passed to attachUser/ensureAtlasAccess only, as everywhere else.
 */
const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
]

/** Decoded-PNG ceiling. Slack accepts far larger; this is what we are willing to relay. */
const MAX_PNG_BYTES = 4 * 1024 * 1024
/**
 * Parser ceiling: 4 MiB of PNG is ~5.4 MiB once base64'd, so 6 MiB leaves room for the note and
 * JSON framing. The size that actually matters is MAX_PNG_BYTES, checked on the DECODED bytes below.
 */
const BODY_LIMIT = '6mb'

/**
 * ⚠️ WHY THE PARSER LIVES HERE AND index.ts SKIPS THIS PATH. index.ts runs `express.json()` (100 kb)
 * before every router, and a body over its limit is rejected THERE with a 413 — a larger limit set in
 * this file would never be reached. So the global parser steps aside for `/api/feedback` and this
 * one runs instead, AFTER the identity chain: an unauthenticated caller gets a 401 without us ever
 * buffering six megabytes for them.
 */
const jsonBody: RequestHandler = (req, res, next) => {
  express.json({ limit: BODY_LIMIT })(req, res, (err?: unknown) => {
    if (!err) return next()
    const type = (err as { type?: string }).type
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'screenshot_too_large' })
      return
    }
    res.status(400).json({ error: 'invalid_body' })
  })
}

const bodySchema = z
  .object({
    note: z.string().trim().min(1).max(2000),
    // No `.max()` on the screenshot: a zod length error is a 400, and an oversize image must be a
    // clear 413. Size is enforced below.
    screenshot: z.string().startsWith('data:image/png;base64,').optional(),
    screen: z.string().trim().max(200).optional(),
    url: z.string().trim().max(500).optional(),
    viewport: z
      .object({ w: z.number().int().min(0).max(20000), h: z.number().int().min(0).max(20000) })
      .strict()
      .optional(),
  })
  .strict()

// A runaway client loop must not be able to flood the channel. Per user, in process; a second
// instance would double the allowance, which is fine for a safety valve.
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 10
const recent = new Map<string, number[]>()
function rateLimited(userId: string): boolean {
  const now = Date.now()
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) {
    recent.set(userId, hits)
    return true
  }
  hits.push(now)
  recent.set(userId, hits)
  if (recent.size > 1000) recent.clear()
  return false
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const PREFIX = 'data:image/png;base64,'

export function createFeedbackRouter(target: SlackTarget): Router {
  const router = Router()

  router.post('/', ...identityChain, jsonBody, async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const me = (req as any).user as typeof users.$inferSelect

      // ⚠️ THE ALLOWLIST IS ENFORCED HERE TOO, not only at injection. Hiding the button stops the
      // button; it does not stop a POST. Anyone with a session could call this endpoint directly
      // and have the server put an arbitrary image into the Slack. Two checks, one list.
      if (!feedbackConfig.ok || !me.email || !feedbackConfig.testers.has(me.email.toLowerCase())) {
        res.status(403).json({ error: 'not_a_feedback_tester' })
        return
      }

      let png: Buffer | undefined
      if (parsed.data.screenshot) {
        const b64 = parsed.data.screenshot.slice(PREFIX.length)
        // Cheap length test first so an oversize string is never decoded into a second big buffer.
        if (b64.length > Math.ceil((MAX_PNG_BYTES * 4) / 3) + 4) {
          res.status(413).json({ error: 'screenshot_too_large' })
          return
        }
        png = Buffer.from(b64, 'base64')
        if (png.length > MAX_PNG_BYTES) {
          res.status(413).json({ error: 'screenshot_too_large' })
          return
        }
        // Not a PNG means not an image we should be relaying, whatever the prefix claimed.
        if (png.length < 8 || !png.subarray(0, 4).equals(PNG_MAGIC)) {
          res.status(400).json({ error: 'invalid_screenshot' })
          return
        }
      }

      if (rateLimited(String(me.id))) {
        res.status(429).json({ error: 'rate_limited' })
        return
      }

      const result = await sendFeedback(target, {
        userId: String(me.id),
        name: me.displayName ?? null,
        email: me.email ?? null,
        note: parsed.data.note,
        screen: parsed.data.screen,
        url: parsed.data.url,
        viewport: parsed.data.viewport,
        userAgent: req.get('user-agent')?.slice(0, 300),
        png,
      })
      res.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof SlackError) {
        // Method + Slack's own error code, nothing else: no token, no request, no raw upstream body.
        // The code is returned (e.g. `not_in_channel`) because Makel is the one who has to fix it.
        console.error('[feedback] send failed:', err.message)
        res.status(502).json({ error: 'slack_failed', reason: /^[a-z0-9_]{1,40}$/.test(err.code) ? err.code : 'unknown' })
        return
      }
      next(err)
    }
  })

  return router
}
