/**
 * Mint a REAL session cookie for a seeded account, without anyone typing a password.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 * Every bug found in this app so far was found by a human clicking it, because there was no way
 * to drive the real thing automatically. The smoke suite calls `buildAtlasData` directly, which
 * proves the SERVER builds a correct payload and proves nothing about what a signed-in golfer
 * actually sees — it skips the whole identity chain, the consent gate, the session cookie, and
 * every line of the page's own JavaScript. Rendering the injected HTML to a file and opening it
 * is worse still: it is a snapshot, so nothing that depends on a real request is exercised.
 *
 * This closes that gap. It walks the SAME three steps a browser sign-in walks:
 *
 *   1. firebase-admin mints a CUSTOM token for the uid           (server credential)
 *   2. Identity Toolkit exchanges it for an ID token             (the exact REST call the web
 *                                                                 SDK makes on sign-in)
 *   3. POST /api/session exchanges that for the httpOnly cookie  (the app's own route, running
 *                                                                 its own middleware chain)
 *
 * The result is indistinguishable from a real login to everything downstream — `verifyToken`,
 * `attachUser`, `ensureAtlasAccess`, `requireApp`, and `requireConsent` all run for real. A page
 * fetched with this cookie is the page that golfer gets.
 *
 * ⚠️ DEV ONLY, AND IT REFUSES TO RUN IN PRODUCTION. A custom token is minted with the service
 * account, so this can impersonate ANY account in a Firebase project shared with the live RYP
 * Stick iOS app (28k+ real customers). It is a test harness pointed at seeded demo accounts, and
 * the guard below is what keeps it one. It is never imported by server code — nothing under
 * server/ or client/ may depend on this file.
 *
 * Usage:
 *   npm run session -- demo.player1@rypgolf.com          # prints the cookie
 *   npm run session -- demo.coach@rypgolf.com --html     # prints /proto/dashboard's HTML
 */
import { eq } from 'drizzle-orm'
import { withRlsBypass } from '@ryp/eco/db'
import { users } from '@ryp/eco/schema'
import { pool } from '../server/db'
// eco's own accessor, NOT a bare `getAuth()` from firebase-admin. The init is LAZY and cached
// inside eco (see eco/src/auth/firebase.ts) — importing the module does not initialise anything,
// so a bare getAuth() throws "The default Firebase app does not exist". Going through eco also
// means this harness authenticates with exactly the credential the server uses, rather than a
// second app that could drift from it.
import { firebaseAuth } from '@ryp/eco/auth'

if (process.env.NODE_ENV === 'production') {
  throw new Error('devSession is a dev-only harness and must never run in production')
}

const API_KEY = process.env.VITE_FIREBASE_API_KEY
if (!API_KEY) throw new Error('VITE_FIREBASE_API_KEY is not set — cannot exchange the custom token')

const BASE = `http://localhost:${process.env.PORT ?? '5000'}`

export async function sessionCookieFor(email: string): Promise<{ cookie: string; uid: string; userId: string }> {
  const row = await withRlsBypass(pool, `devSession: resolve ${email}`, { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, email) }),
  )
  if (!row) throw new Error(`no public.users row for ${email} — run npm run seed`)

  // 1. Custom token, signed by the service account.
  const customToken = await firebaseAuth().createCustomToken(row.firebaseUid)

  // 2. Exchange for an ID token. This is literally what firebase/auth's signInWithCustomToken
  //    does in the browser; there is no separate "admin" path that skips it.
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  const body = (await res.json()) as { idToken?: string; error?: { message?: string } }
  if (!res.ok || !body.idToken) {
    throw new Error(`custom-token exchange failed: ${body.error?.message ?? res.status}`)
  }

  // 3. The app's own route. Runs the full chain, so a blocked account is refused HERE — which is
  //    correct: this harness must not be able to produce a session the real login could not.
  const sess = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.idToken}` },
    body: '{}',
  })
  if (!sess.ok) {
    const text = await sess.text()
    throw new Error(`POST /api/session ${sess.status}: ${text.slice(0, 200)}`)
  }
  const setCookie = sess.headers.get('set-cookie')
  if (!setCookie) throw new Error('POST /api/session returned no Set-Cookie')
  // "name=value; Path=/; HttpOnly; …" → just the name=value a Cookie header needs.
  const cookie = setCookie.split(';')[0]
  return { cookie, uid: row.firebaseUid, userId: row.id }
}

/** Fetch any page or API route AS that golfer. */
export async function fetchAs(email: string, path: string, init: RequestInit = {}) {
  const { cookie } = await sessionCookieFor(email)
  return fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } })
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
const isDirectRun = process.argv[1]?.endsWith('devSession.ts')
if (isDirectRun) {
  const email = process.argv[2]
  if (!email) {
    console.error('usage: npm run session -- <email> [--html]')
    process.exit(1)
  }
  const wantHtml = process.argv.includes('--html')
  const { cookie, uid, userId } = await sessionCookieFor(email)
  if (wantHtml) {
    const res = await fetch(`${BASE}/proto/dashboard`, { headers: { Cookie: cookie } })
    console.error(`GET /proto/dashboard → ${res.status}`)
    console.log(await res.text())
  } else {
    console.log(JSON.stringify({ email, uid, userId, cookie }, null, 2))
  }
  await pool.end()
}
