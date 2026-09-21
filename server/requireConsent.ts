import type { RequestHandler } from 'express'
import { consentStateFor, type ConsentState } from '../shared/consent'

/**
 * Refuses a request from an account that has not established it may be used.
 *
 * ── Why this is server-side and not a screen ────────────────────────────────────────────────
 * A client-only gate hides the app from someone who does not know how to skip it. The account
 * still exists, the token still works, and every route still accepts data. This app collects a
 * minor's injury history, their free-text "why you are here", and a scored psychological read
 * that a coach then reads and writes prose about — so "the screen didn't render" is not a
 * control. The gate is here; the screen in client/src/App.tsx is a courtesy that keeps a blocked
 * account from staring at a wall of 403s.
 *
 * ── Zero extra queries ──────────────────────────────────────────────────────────────────────
 * `attachUser` does `db.query.users.findFirst` with NO column selector, so `req.user` is the full
 * `public.users` row and already carries `date_of_birth` and `parental_consent_at`. This
 * middleware therefore adds no round trip to any request. If someone ever narrows attachUser's
 * select, this silently starts reading `undefined` — which `consentStateFor` treats as
 * 'dob_required', i.e. it fails CLOSED and locks everybody out loudly rather than opening the
 * gate quietly. That is the correct direction for this failure, and is why there is no
 * `?? 'ok'` anywhere below.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────────────────────
 * Goes LAST, after requireApp('atlas'). Entitlement first, then consent: someone with no Atlas
 * access should be told that, not asked for their date of birth on the way to a 403 they were
 * always going to get.
 *
 * ── Who is deliberately NOT gated ───────────────────────────────────────────────────────────
 *   • `adminChain` (routes/admin.ts) — same reasoning that keeps `ensureAtlasAccess` out of it.
 *     An admin route must not be the thing that provisions or unblocks the caller, and the
 *     consent-recording endpoint itself lives there: gating it would mean an admin whose own DOB
 *     is unrecorded could not unblock anybody, including themselves.
 *   • `GET /api/users/me` and `POST /api/users/me/date-of-birth` (routes/me.ts) — the state
 *     read and the single write that ANSWERS 'dob_required'. Gating either is a deadlock: the
 *     only way out of the gate would be behind the gate.
 * Every other authenticated route is gated. `scripts/smoke.ts` section J asserts that by reading
 * the routers rather than trusting this comment.
 */

/**
 * How to refuse.
 *
 * 'json' — an API caller. `{ error: 'dob_required' | 'consent_required' }`, matching the shape the
 *          rest of the server uses so the client's existing error handling reads it unchanged.
 * 'page' — a BROWSER NAVIGATION (`GET /proto/dashboard`). A JSON 403 renders as a bare blob of
 *          text in a tab, which tells the reader nothing about what to do. This sends real HTML.
 *
 *          ⚠️ It does NOT redirect to '/'. The SPA's own consent check fails OPEN on a network
 *          error (see App.tsx), and a coach in that state would be bounced to /proto/dashboard,
 *          refused, redirected to '/', and bounced again — an infinite loop with no way to read
 *          the message. A dead-end page with a link out cannot loop.
 */
type RefusalMode = 'json' | 'page'

const PAGE_COPY: Record<Exclude<ConsentState, 'ok'>, { title: string; body: string }> = {
  dob_required: {
    title: 'One more thing',
    body: 'Atlas needs your date of birth before you can carry on. It takes a moment.',
  },
  consent_required: {
    title: 'Waiting on a parent or guardian',
    body:
      'This account belongs to someone under 18, so a parent or guardian has to approve it before ' +
      'it can be used. Nothing is lost — everything is here as soon as that approval is recorded.',
  },
}

function refusalPage(state: Exclude<ConsentState, 'ok'>): string {
  const copy = PAGE_COPY[state]
  // Inline styles, no assets: this page is served when the app is refusing to load, so it must not
  // depend on anything the app serves.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.title} — Atlas</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8e8ea;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif">
<main style="max-width:32rem;padding:2rem;text-align:center">
<h1 style="font-size:1.5rem;margin:0 0 .75rem">${copy.title}</h1>
<p style="margin:0 0 1.5rem;color:#a9adb8">${copy.body}</p>
<a href="/?home=1" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.5rem;background:#e8e8ea;color:#0f1115;text-decoration:none;font-weight:600">Back to Atlas</a>
</main></body></html>`
}

export function requireConsent(mode: RefusalMode = 'json'): RequestHandler {
  return (req, res, next) => {
    const user = (req as any).user as
      | { dateOfBirth: Date | string | null; parentalConsentAt: Date | string | null }
      | undefined
    // No user means attachUser already answered 401/403 — do not invent a second refusal on top
    // of the one the caller is about to receive.
    if (!user) return next()

    const state = consentStateFor(user)
    if (state === 'ok') return next()

    if (mode === 'page') {
      res.status(403).type('html').send(refusalPage(state))
      return
    }
    res.status(403).json({ error: state })
  }
}
