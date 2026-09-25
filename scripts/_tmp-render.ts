import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAtlasData, HIDDEN_FOR_PLAYER, HIDDEN_FOR_COACH } from '../server/protoData'
import { pool } from '../server/db'

const OUT = process.env.OUT_DIR!
const PROTO = join(import.meta.dirname, '..', 'proto')

function inject(html: string, data: unknown) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c')
  const tag = `<script>window.__ATLAS_DATA__ = ${payload};</script>\n`
  const first = html.indexOf('<script')
  return html.slice(0, first) + tag + html.slice(first)
}

const main = async () => {
  const file = readFileSync(join(PROTO, 'Dashboard.dc.html'), 'utf8')
  copyFileSync(join(PROTO, 'support.js'), join(OUT, 'support.js'))

  // demo.player1 (Avery Lane) — the PLAYER dashboard entry point
  const p = await buildAtlasData('DEMO-avery-lane', 'today', HIDDEN_FOR_PLAYER).catch(async () => {
    // fall back: resolve the real firebase uid from the DB
    const { withRlsBypass } = await import('@ryp/eco/db')
    const { users } = await import('@ryp/eco/schema')
    const { eq } = await import('drizzle-orm')
    const u = await withRlsBypass(pool, 'render: find demo player', { users }, (db) =>
      db.query.users.findFirst({ where: eq(users.email, 'demo.player1@rypgolf.com') }))
    console.log('resolved uid', u!.firebaseUid)
    return buildAtlasData(u!.firebaseUid, 'today', HIDDEN_FOR_PLAYER)
  })
  writeFileSync(join(OUT, 'player.html'), inject(file, p))
  console.log('player  → me keys:', Object.keys((p as any).me).join(', '))

  const { withRlsBypass } = await import('@ryp/eco/db')
  const { users } = await import('@ryp/eco/schema')
  const { eq } = await import('drizzle-orm')
  const c = await withRlsBypass(pool, 'render: find demo coach', { users }, (db) =>
    db.query.users.findFirst({ where: eq(users.email, 'demo.coach@rypgolf.com') }))
  const cd = await buildAtlasData(c!.firebaseUid, 'roster', HIDDEN_FOR_COACH)
  writeFileSync(join(OUT, 'coach.html'), inject(file, cd))
  console.log('coach   → roster:', (cd as any).roster.map((r: any) => r.n).join(' | '))
  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
