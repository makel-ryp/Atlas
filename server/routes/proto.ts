import { Router, type RequestHandler } from 'express'
import fs from 'fs/promises'
import path from 'path'
import {
  verifySessionCookieMiddleware,
  createSessionCookie,
  SESSION_COOKIE_NAME,
  verifyToken,
  attachUser,
  requireApp,
} from '@ryp/eco/auth'
import { pool } from '../db'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { buildAtlasData, HIDDEN_FOR_COACH, HIDDEN_FOR_PLAYER, NoAtlasRecordError } from '../protoData'

/**
 * Serves Luke's WORKING prototype with real data injected, rather than reimplementing his screens.
 *
 * The design is already built and it works — his `.dc.html` renders through `support.js`. So the
 * cheaper and more faithful move is to serve HIS file and give it one declared place to read data
 * from. His layout stays the source of truth; we supply the rows.
 *
 * ── ONE INJECTION POINT, not string substitution ────────────────────────────────────────────────
 * `injectRoster()` used to live here: it regex-rewrote keys inside his `ROSTER` literal in memory.
 * It is GONE, deliberately and completely, and should not come back in any form.
 *
 * It failed in the way that matters. Overrides were emitted BEFORE his own keys, so on duplicate
 * keys HIS value won, and a real student rendered carrying another player's handicap — a page that
 * looks live and is not. It also only ever patched five of his ~20 fields, which meant real names
 * and real handicaps sat on top of fictional shot-reads, strokes-gained series, zones and tiers,
 * held together by nothing but a disclosure banner. Disclosed is not prevented.
 *
 * Now: the working copy at `proto/Dashboard.dc.html` has its literal STRIPPED to
 * `const ROSTER = (window.__ATLAS_DATA__ && window.__ATLAS_DATA__.roster) || []`, and this route
 * injects `window.__ATLAS_DATA__` as one <script> before his own first <script>. A field with no
 * producer arrives EMPTY. Empty renders as empty; it never renders as somebody else's number.
 *
 * ── Why this needs a session COOKIE and not a Bearer token ──────────────────────────────────────
 * Every other authed route here is called by fetch(), which can set an Authorization header. A
 * browser navigating to a page cannot. eco has carried `createSessionCookie` and
 * `verifySessionCookieMiddleware` since the beginning for exactly this case; this is the first
 * consumer.
 */

/**
 * ⚠️ The VENDORED WORKING COPY — `~/dev/ATR/atlas/proto`, in this repo, git-tracked.
 *
 * This used to point at `~/Desktop/ATR/websites/atlas/handoff/...`, the pristine handoff copy, whose
 * `ROSTER` literal is NOT stripped. So the route served the unmodified sample file and the strip in
 * the working copy was dead code that no request ever reached. That single path was the reason eight
 * fictional students rendered for a real logged-in coach.
 *
 * `import.meta.dirname`, not `__dirname`: this is ESM running from source, where `__dirname` is
 * undefined. Same reason as `server/index.ts`.
 */
const PROTO_DIR = path.resolve(import.meta.dirname, '..', '..', 'proto')

export const protoRouter = Router()

// Bearer-authed: the SPA calls this after Firebase sign-in to get a cookie the browser will send on
// a plain navigation. 8 hours — long enough for a meeting, short enough not to be a standing key.
const bearerChain: RequestHandler[] = [
  verifyToken,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  // Do not mint an 8-hour credential for an account that may not be used. Refusing here is also
  // why the page below can never be reached by a blocked account with a *fresh* login — though it
  // carries its own check anyway, because a cookie issued before this shipped is still valid.
  requireConsent(),
]

protoRouter.post('/api/session', ...bearerChain, async (req, res, next) => {
  try {
    const header = req.headers.authorization
    const idToken = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!idToken) {
      res.status(401).json({ error: 'missing_token' })
      return
    }
    const cookie = await createSessionCookie(idToken, 8 * 60 * 60 * 1000)
    res.cookie(SESSION_COOKIE_NAME, cookie, {
      httpOnly: true,
      sameSite: 'lax',
      // secure would break plain-http localhost, which is where the demo runs. Set it in production.
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * End the browser's session. Called by `logout()` in client/src/lib/authContext.tsx.
 *
 * ── WHAT THIS DOES AND DOES NOT DO, because the difference matters ──────────────────────────
 * It clears the cookie from THE BROWSER. It does not revoke the session cookie's underlying
 * credential, so a cookie VALUE that someone had already extracted would keep working until it
 * expires (8h). Measured, not assumed: replaying a captured cookie after this call still returns
 * 200 from /proto/dashboard.
 *
 * That gap is deliberate. `verifySessionCookie` is called with checkRevoked=true
 * (eco/src/auth/verifySessionCookie.ts:41), so real revocation IS available — one call to
 * `revokeRefreshTokens(uid)` would kill this cookie immediately. It is not made because
 * `rypstick-ios` is SHARED with the live RYP Stick iOS app: revoking a user's refresh tokens
 * signs them out of every RYP app on every device they own. A coach tidying up after a lesson
 * would silently log themselves out of their phone.
 *
 * The threat this actually addresses is the shared laptop — a coach signs out, the next person
 * navigates to /proto/dashboard and reads the roster. `clearCookie` closes that completely,
 * because the browser no longer has the cookie to send. The residual risk is an attacker who has
 * already exfiltrated an httpOnly cookie, at which point they have a bigger foothold than this.
 *
 * If per-app revocation becomes possible (a session store, or Atlas getting its own Firebase
 * project), revoke here.
 */
protoRouter.post('/api/session/end', (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME)
  res.json({ ok: true })
})

/**
 * The single <script> that carries every real value into his page.
 *
 * Injected immediately BEFORE his first `<script>` (`<script src="./support.js">`, line 6) rather
 * than after `<body>`: his framework and his own inline script both run from the head, and
 * `window.__ATLAS_DATA__` has to exist before either does. After `<body>` would be too late.
 *
 * ⚠️ `</` is escaped. `displayName` and `email` are user-controlled strings, and a `</script>` in
 * either would close this tag early and put the rest of the payload into the document as markup.
 * `<` inside a JSON string literal is the same character to the JS parser and inert to the HTML
 * tokenizer.
 */
function injectData(html: string, data: unknown): string {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c')
  // `window.` explicitly: his file reads `window.__ATLAS_DATA__`, and a bare `const` in a classic
  // script would not be found as a window property.
  const tag = `<script>window.__ATLAS_DATA__ = ${payload};</script>\n`
  const first = html.indexOf('<script')
  // No first <script> means the file is not the file we think it is. Fail loudly rather than serving
  // a page with no data and no explanation — silent-empty is indistinguishable from a real empty.
  if (first === -1) throw new Error('proto: no <script> tag found — cannot inject __ATLAS_DATA__')
  return html.slice(0, first) + tag + html.slice(first)
}

/**
 * A banner naming what is live and what is EMPTY. It no longer says "sample", because there is no
 * longer any sample data in the served page — that is the whole point of the change above, and a
 * banner that still claimed a sample/live mix would be the same lie in the other direction.
 *
 * Kept as an injection rather than added to his file: it is a statement about the data pipeline, not
 * part of his design, and it should disappear the day nothing on the page is empty.
 */
function injectBanner(html: string, liveCount: number): string {
  // ⚠️ THE WAY BACK. His file is a standalone document with no link into the SPA, so a coach who
  // lands here has no route home but the browser's Back button — and once this is their sign-in
  // destination rather than a new tab, Back returns them to the login screen. Injected rather than
  // added to his markup, same reasoning as the banner it sits in: it is a statement about how
  // Atlas hosts this page, not part of Luke's design.
  const home = `<a href="/?home=1" style="color:#13110b;font-weight:700;text-decoration:none;border-bottom:1px solid rgba(19,17,11,0.4);margin-right:14px;">&larr; Atlas</a>`
  // ── SIGN OUT. Not optional here, and it is not a duplicate of the SPA's button. ─────────────
  // A coach LANDS on this page — App.tsx redirects them here on sign-in — and this page is a
  // standalone document with no React and no sign-out of its own. The "← Atlas" link above goes
  // to `/`, which redirects a coach straight back to this page, so a coach had no way to sign out
  // AT ALL: the only escape was clearing cookies. Which also made the sign-out fix that ends the
  // session cookie unreachable for the one role that has a session cookie.
  //
  // `?signout=1` rather than a POST from here: signing out has a Firebase half that only the SPA
  // can do (it owns the auth instance), so the SPA has to be the one to run it. App.tsx reads the
  // param, calls the same logout() as the button, and strips it from the URL.
  const signout = `<a href="/?signout=1" style="color:#13110b;font-weight:700;text-decoration:none;border-bottom:1px solid rgba(19,17,11,0.4);float:right;margin-left:14px;">Sign out</a>`
  const banner = `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#c8a05e;color:#13110b;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;padding:7px 14px;text-align:center;">
${home}${signout}Live from ryp-core: ${liveCount} student${liveCount === 1 ? '' : 's'} &mdash; name · handicap index · driver carry · handedness · target · practice intensity · phase · coaching relationship · sign-off · practice dna · coach notes · the interview &nbsp;·&nbsp; Empty, no producer app: strokes gained, strike grid, shot reads, practice log. Blank means not measured, not zero.
</div><div style="height:29px"></div>`
  return html.replace(/<body([^>]*)>/i, `<body$1>${banner}`)
}

// `attachUser` is not optional here even though the cookie already proves who you are.
// verifySessionCookieMiddleware sets `req.firebaseUid` and nothing else — it never touches the
// database — so without this the route has no `appRoleRows`, `isCoach` reads as false for
// everyone, and a coach is served the player tab with no error anywhere. Which is exactly what
// happened on the first attempt (2026-09-01): typecheck passed, the page rendered, and the only
// symptom was the wrong screen.
// ⚠️ FOUR LINKS, not two. This route ran `verifySessionCookieMiddleware, attachUser` and stopped,
// while every other authed chain on the server has four (coach.ts:57-63, intake.ts:69-74,
// me.ts:27-32, notes.ts:14-19, and proto.ts's own bearerChain at :62-67). The two it was missing
// are the ENTITLEMENT links: without `ensureAtlasAccess` a brand-new allowlisted account gets no
// atlas row created here, and without `requireApp('atlas')` a revoked account keeps the served
// dashboard until its session cookie expires — up to eight hours of access after the revocation.
// attachUser only resolves who you are; it does not ask whether you are still allowed in.
// ⚠️ FIVE LINKS NOW. `requireConsent('page')` is the link that makes the consent gate real rather
// than decorative, and it is the easiest one in the codebase to forget: this router is not the API,
// it serves a NAVIGATED DOCUMENT, and it injects `window.__ATLAS_DATA__` — the golfer's whole
// profile, their plan, their coach's roster — into the page before the browser sees it. Gating
// /api/* and skipping this route would leave every byte the gate exists to protect reachable at a
// URL a player is redirected to automatically after intake.
//
// 'page', not the default 'json': a browser navigation refused with a JSON body renders as raw
// text in a tab. See ../requireConsent for why it is a dead-end page and not a redirect.
protoRouter.get(
  '/proto/dashboard',
  verifySessionCookieMiddleware,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  requireConsent('page'),
  async (req, res, next) => {
  try {
    const firebaseUid = (req as any).firebaseUid as string
    const file = await fs.readFile(path.join(PROTO_DIR, 'Dashboard.dc.html'), 'utf8')

    let data
    try {
      // A coach opens on the roster tab; everyone else on their own day. Read off the role the
      // session already resolved rather than inferring it from whether the roster came back
      // non-empty — a coach with no students yet is still a coach, and would otherwise be dropped
      // onto a player's screen exactly like before.
      // The role decides both the landing view and how much of the app is shown. A coach opens
      // on their roster with the player-only screens closed; a player opens on their own day with
      // the roster closed. See HIDDEN_FOR_COACH / HIDDEN_FOR_PLAYER for why.
      const isCoach = ((req as any).appRoleRows as { app: string; role: string }[] | undefined)
        ?.some((r) => r.app === 'atlas' && r.role === 'coach') ?? false
      data = isCoach
        ? await buildAtlasData(firebaseUid, 'roster', HIDDEN_FOR_COACH)
        : await buildAtlasData(firebaseUid, 'today', HIDDEN_FOR_PLAYER)
    } catch (err) {
      // A Firebase account with no `public.users` row is an authorization answer, not a server
      // fault. Left to the global error handler it would come back as a 500 JSON body in a
      // navigated browser tab, which tells the reader nothing.
      if (err instanceof NoAtlasRecordError) {
        res.status(403).type('text').send('No Atlas record for this account.')
        return
      }
      throw err
    }

    res.type('html').send(injectBanner(injectData(file, data), data.roster.length))
  } catch (err) {
    next(err)
  }
})

/**
 * The ONE static asset his page pulls in: `<script src="./support.js">`, which resolves to
 * `/proto/support.js`. Checked — that is the only local `src`/`href` in the file; everything else is
 * a Google Fonts URL or a runtime-templated link.
 *
 * ⚠️ AN ALLOWLIST, NOT `express.static(PROTO_DIR)`. The static-directory version was written first
 * and was wrong twice over, both verified against the running server rather than reasoned about:
 *
 *   1. A `.dc.html` → 404 filter in front of it was BYPASSABLE. Express does not percent-decode
 *      `req.path` but `express.static` does resolve the encoded form, so `/proto/Dashboard.dc.html`
 *      404'd while `/proto/Dashboard%2Edc%2Ehtml` returned 200 — the raw stripped file, with no
 *      injected blob and no banner, so every screen silently empty, to anyone with the URL and no
 *      session. Exactly the failure the filter was there to prevent.
 *   2. It served the whole directory unauthenticated. `/proto/README.md` returned 200: internal
 *      notes on what is and is not wired up, with absolute paths to the pipeline documents.
 *
 * With no directory handler, the raw file and every encoded spelling of it 404 by construction
 * rather than by a regex someone has to keep correct. The only way in is `/proto/dashboard`.
 *
 * Left unauthenticated deliberately: it is Luke's framework, it carries no data, and the page tag
 * that loads it is a plain browser fetch. Everything that carries a real number goes through
 * `verifySessionCookieMiddleware` above.
 */
protoRouter.get('/proto/support.js', (_req, res, next) => {
  res.type('application/javascript').sendFile(path.join(PROTO_DIR, 'support.js'), (err) => {
    if (err) next(err)
  })
})
