import express, { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { attachUser, requireApp } from '@ryp/eco/auth'
import type { users } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { sendFeedback, SlackError, type SlackTarget } from '../slackFeedback'
import { FEEDBACK_MAX_PNG_BYTES, FEEDBACK_NOTE_MAX } from '../../shared/feedback'

/**
 * POST /api/feedback — a tester's note, with a screenshot, into a Slack thread.
 *
 * Two widgets call this: the one injected into Luke's page by routes/proto.ts, and the React
 * <FeedbackButton /> on every SPA screen. Both exist only while the config in ../feedbackConfig is
 * complete. This router is mounted under the same condition (index.ts); when it is not,
 * /api/feedback answers 503 from a stub (every method) and nothing here is reachable.
 *
 * Any SIGNED-IN user may send. There is no tester list — see PREVIEW BEFORE SEND in
 * ../feedbackConfig for what replaced it and why it must stay replaced.
 *
 * ── NO `requireConsent()`, deliberately ─────────────────────────────────────────────────────────
 * The other identity chains end in it. This one does not, and a later "make it consistent" edit would
 * be wrong: a minor whose consent is outstanding cannot use the app, and "I can't get in" is exactly
 * the report that most needs to reach us. The route reads no golfer data and writes none — it carries
 * what the person typed, plus their name and email, to a channel Makel owns. The SPA button DOES
 * appear on the consent screens (date of birth, guardian pending) for exactly that reason. The route
 * is simply not the thing that should close it.
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

/** Decoded-PNG ceiling, shared with the client so the two cannot drift. */
const MAX_PNG_BYTES = FEEDBACK_MAX_PNG_BYTES
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
    note: z.string().trim().min(1).max(FEEDBACK_NOTE_MAX),
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

  // "Is feedback configured?" for the SPA. This router is mounted ONLY when the Slack config is
  // complete and a stub answers 503 to every method otherwise, so reaching this handler IS the
  // answer. It exists so the React button is not drawn over a 503 that would eat a person's words.
  // Same identity chain as the POST, so an anonymous caller learns nothing about the deployment.
  router.get('/', ...identityChain, (_req, res) => {
    res.json({ enabled: true })
  })

  router.post('/', ...identityChain, jsonBody, async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const me = (req as any).user as typeof users.$inferSelect

      // ⚠️ NO ALLOWLIST CHECK HERE, ON PURPOSE — any signed-in user may send. It was removed in
      // favour of PREVIEW BEFORE SEND (see ../feedbackConfig), which is enforced in the widgets, not
      // here: the server cannot see whether the person was shown the image. What it CAN and does
      // enforce is below — identity (the chain above), a size ceiling, PNG magic bytes and a per-user
      // rate limit. Do not read this gap as an oversight and re-add a list, and do not drop the
      // preview because the server "has checks".

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
