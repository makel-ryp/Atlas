import type { RequestHandler } from 'express'
import { verifySessionCookieMiddleware, verifyToken } from '@ryp/eco/auth'

/**
 * Accept EITHER a session cookie or a bearer token.
 *
 * The SPA holds a Firebase ID token and sends `Authorization: Bearer`. The served prototype does
 * not — it is a plain server-rendered page, and a browser navigation cannot carry an Authorization
 * header, so it authenticates with the httpOnly session cookie minted by POST /api/session.
 *
 * The drill sign-off is called from BOTH: eventually from the SPA, and today from Luke's page,
 * which is the only surface a coach actually ticks a drill on. Bearer-only meant every tick from
 * that page returned 401 while the POST body and URL were perfectly correct — the UI rolled the
 * tick back and said "Could not save that sign-off", which is honest but not the bug. Found by
 * clicking the row in a browser on 2026-09-01; no amount of API testing could see it, because
 * every API test sends a bearer token.
 *
 * ── Why this is its own module (2026-09-14) ─────────────────────────────────────────────────
 * It was a module-private const in routes/coach.ts. Coaching notes then had to be callable from
 * the same prototype page, and bearer-only would have reproduced the 2026-09-01 bug exactly: a
 * correct URL and a correct body returning 401 from a page that cannot send a bearer token.
 * Copying the middleware would have copied the reasoning above with it, and the second copy is
 * the one that drifts. One definition, two importers.
 */
export const cookieOrBearer: RequestHandler = (req, res, next) => {
  const hasBearer = req.headers.authorization?.startsWith('Bearer ')
  // Both middlewares set `req.firebaseUid` and nothing else, so whichever runs, the rest of the
  // chain is identical. Cookie first: a page-served request is the common case for these routes.
  if (hasBearer) return verifyToken(req, res, next)
  return verifySessionCookieMiddleware(req, res, next)
}
