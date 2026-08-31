import express, { Router, type RequestHandler } from 'express'
import fs from 'fs/promises'
import path from 'path'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  verifySessionCookieMiddleware,
  createSessionCookie,
  SESSION_COOKIE_NAME,
  verifyToken,
  attachUser,
  requireApp,
} from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, userRelationships, orgMemberships, golfPlayerProfile } from '@ryp/eco/schema'
import { pool } from '../db'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

/**
 * Serves Luke's WORKING prototype with real data injected, rather than reimplementing his screens.
 *
 * The design is already built and it works — his `.dc.html` files render through `support.js`. So the
 * cheaper and more faithful move is to serve HIS file and substitute the hardcoded literals on the
 * way out, leaving the file untouched on disk. His layout stays the source of truth; we supply the
 * rows.
 *
 * ── Why this needs a session COOKIE and not a Bearer token ─────────────────────────────────────
 * Every other authed route here is called by fetch(), which can set an Authorization header. A
 * browser navigating to a page cannot. eco has carried `createSessionCookie` and
 * `verifySessionCookieMiddleware` since the beginning for exactly this case and nothing had used
 * them; this is the first consumer.
 *
 * ── What is real and what is not ───────────────────────────────────────────────────────────────
 * His ROSTER row has ~20 fields. We have producers for five of them. The injection therefore MERGES:
 * identity, handicap, carry and handedness come from `ryp-core`; the shot reads, strokes-gained
 * series, zone and tier keep his sample values because Forge and Red do not write them yet.
 *
 * That mix is only acceptable because the page says so — see `injectBanner`. A screen that silently
 * blends live and sample data is the exact failure the demo plan calls its top risk.
 */
const PROTO_DIR = path.resolve(
  process.env.HOME ?? '',
  'Desktop/ATR/websites/atlas/handoff/Golf coaching website project',
)

export const protoRouter = Router()


// Bearer-authed: the SPA calls this after Firebase sign-in to get a cookie the browser will send on
// a plain navigation. 8 hours — long enough for a meeting, short enough not to be a standing key.
const bearerChain: RequestHandler[] = [
  verifyToken,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
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

protoRouter.post('/api/session/end', (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME)
  res.json({ ok: true })
})

const schema = { users, userRelationships, orgMemberships, golfPlayerProfile }

// A banner, injected rather than added to Luke's file, saying which numbers are live. Not optional:
// this page mixes real records with his sample values, and an unlabelled mix is worse than either.
function injectBanner(html: string, liveCount: number): string {
  const banner = `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#c8a05e;color:#13110b;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;padding:7px 14px;text-align:center;">
Live from ryp-core: ${liveCount} student${liveCount === 1 ? '' : 's'}, names · handicaps · carry · coaching relationships &nbsp;·&nbsp; Sample: shot reads, strokes gained, zone, tier &mdash; Forge and Red do not write these yet
</div><div style="height:29px"></div>`
  return html.replace(/<body([^>]*)>/i, `<body$1>${banner}`)
}

protoRouter.get('/proto/dashboard', verifySessionCookieMiddleware, async (req, res, next) => {
  try {
    const firebaseUid = (req as any).firebaseUid as string
    const file = await fs.readFile(path.join(PROTO_DIR, 'Dashboard.dc.html'), 'utf8')

    const me = await withRls(
      pool,
      { userId: '00000000-0000-0000-0000-000000000000', firebaseUid, app: 'atlas' },
      schema,
      (db) => db.query.users.findFirst({ where: eq(users.firebaseUid, firebaseUid) }),
    ).catch(() => null)
    if (!me) {
      res.status(403).send('No Atlas record for this account.')
      return
    }

    // The coach's real students, by the same two paths the roster API uses. RLS does the filtering.
    const rows = await withRls(
      pool,
      { userId: me.id, firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        const edges = await db
          .select({ subjectUserId: userRelationships.subjectUserId, status: userRelationships.status })
          .from(userRelationships)
          .where(
            and(
              eq(userRelationships.actorUserId, me.id),
              eq(userRelationships.relationship, 'coach_of'),
            ),
          )
        const ids = edges.map((e) => e.subjectUserId)
        if (ids.length === 0) return []
        const [people, profiles] = await Promise.all([
          db
            .select({ id: users.id, displayName: users.displayName, email: users.email })
            .from(users)
            .where(inArray(users.id, ids)),
          db
            .select({
              userId: golfPlayerProfile.userId,
              handicapIndex: golfPlayerProfile.handicapIndex,
              driverCarryYds: golfPlayerProfile.driverCarryYds,
              handedness: golfPlayerProfile.handedness,
            })
            .from(golfPlayerProfile)
            .where(inArray(golfPlayerProfile.userId, ids))
            .orderBy(asc(golfPlayerProfile.userId)),
        ])
        const profBy = new Map(profiles.map((p) => [p.userId, p]))
        return people.map((p) => ({
          person: p,
          profile: profBy.get(p.id) ?? null,
          status: edges.find((e) => e.subjectUserId === p.id)?.status ?? 'active',
        }))
      },
    )

    const injected = injectRoster(file, rows)
    res.type('html').send(injectBanner(injected, rows.length))
  } catch (err) {
    next(err)
  }
})

/**
 * Rewrites the first N rows of Luke's `ROSTER` literal with real people, keeping his field shape.
 *
 * MERGE, not replace: his row carries ~20 fields and we produce five. Overwriting the whole row with
 * nulls would blank half his UI and make the design look broken rather than incomplete, so his sample
 * values stay for anything without a producer — and the banner says which is which.
 *
 * Operates on the text of the literal because his file is the artifact; parsing and regenerating it
 * would mean owning a copy, which is the thing this route exists to avoid.
 */
function injectRoster(
  html: string,
  rows: { person: { id: string; displayName: string | null; email: string }; profile: { handicapIndex: string | null; driverCarryYds: number | null; handedness: string | null } | null; status: string }[],
): string {
  if (rows.length === 0) return html
  const open = html.indexOf('const ROSTER = [')
  if (open === -1) return html
  const close = html.indexOf('\n];', open)
  if (close === -1) return html

  const literal = html.slice(open, close)
  // Row boundaries are `{ id: '...'` — his shape throughout.
  const parts = literal.split(/(?=\{ id: ')/)
  let used = 0

  const rewritten = parts
    .map((part) => {
      if (used >= rows.length || !part.startsWith("{ id: '")) return part
      const r = rows[used++]!
      const name = (r.person.displayName ?? r.person.email).replace(/'/g, "\\'")
      const hcp = r.profile?.handicapIndex ? Number(r.profile.handicapIndex) : null
      const carry = r.profile?.driverCarryYds
      const hand = r.profile?.handedness === 'left' ? 'Left-handed' : 'Right-handed'

      // ⚠️ REPLACE each key IN PLACE. An earlier version appended overrides after `n:` and relied on
      // "later duplicate keys win" — but his `hcp` comes AFTER the name, so HIS value won and the
      // page showed a real student carrying a sample handicap. A real name beside a fake number is
      // worse than no injection at all: it looks live and is not.
      let out = part.replace(/n: '[^']*'/, `n: '${name}'`)
      if (hcp !== null) out = out.replace(/\bhcp: -?[\d.]+/, `hcp: ${hcp}`)
      if (carry) out = out.replace(/carry: '[^']*'/, `carry: '${carry} yd driver carry'`)
      out = out.replace(/hand: '[^']*'/, `hand: '${hand}'`)
      out = out.replace(
        /intake: '[^']*'/,
        `intake: '${r.status === 'active' ? 'Live from ryp-core — approved' : 'Live from ryp-core — awaiting approval'}'`,
      )
      return out
    })
    .join('')

  return html.slice(0, open) + rewritten + html.slice(close)
}
