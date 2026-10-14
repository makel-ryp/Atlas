import type { Pool } from 'pg'
import { createEcoPool } from '@ryp/eco/db'

/**
 * THE TWO FORGE POOLS — and why this file refuses instead of falling back.
 *
 * `./db`'s `pool` connects as atlas_app. That role is the COACH's role: it holds SELECT on every
 * Forge table and write grants on none of them (rls_forge.sql §4: "a coach writes only assignments
 * and notes"). A FORGE route that quietly used it would either fail every write with 42501 or —
 * worse, if somebody then "fixed" that by widening atlas_app — hand the coach surface a player's
 * write path. So FORGE has its own two principals:
 *
 *   app  forge_app  the REQUEST path. Every player read and write. NOBYPASSRLS, NOINHERIT.
 *   svc  forge_svc  the SERVICE principal. The ONLY role that may stamp a ladder rung, a rung event
 *                   or an assignment completion. Used by POST /sessions/:id/complete and nowhere
 *                   else. It authenticates nobody: identity is resolved on the atlas pool first.
 *
 * ⚠️ NEVER THROWS AT IMPORT, unlike ./billingDb. billingDb throws because Atlas's admin surface is
 * useless without it; here a missing FORGE credential must take FORGE down and leave Atlas up. The
 * failure is reported through `forgeConfig` and index.ts is what refuses to mount and says so.
 *
 * ⚠️ `createEcoPool(undefined)` DOES NOT FAIL — its parameter is
 * `connectionString = process.env.DATABASE_URL`, so passing an unset FORGE_* variable would default
 * to the ATLAS url and silently build a pool as atlas_app. That is precisely the fallback this file
 * exists to forbid, which is why the variable is checked BEFORE the call and never passed through.
 *
 * ⚠️ A connection string is never printed or logged here, including in a problem message. The role
 * NAME in the URL's userinfo is compared (a URL that names the wrong role is as dangerous as a
 * missing one: FORGE_SVC_DATABASE_URL pasted with the forge_app login would let the request path
 * stamp rungs; the reverse would make every ladder write fail), but only the variable name and the
 * expected role are reported.
 */
export interface ForgePools {
  app: Pool
  svc: Pool
}

export type ForgeConfig = { ok: true; pools: ForgePools } | { ok: false; problems: string[] }

function roleIn(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username)
  } catch {
    return null // unparseable: reported by name below, never echoed
  }
}

function loadForgeConfig(): ForgeConfig {
  const problems: string[] = []
  const appUrl = process.env.FORGE_APP_DATABASE_URL?.trim()
  const svcUrl = process.env.FORGE_SVC_DATABASE_URL?.trim()

  if (!appUrl) problems.push('FORGE_APP_DATABASE_URL is not set (must connect as forge_app)')
  if (!svcUrl) problems.push('FORGE_SVC_DATABASE_URL is not set (must connect as forge_svc)')

  for (const [name, url, role] of [
    ['FORGE_APP_DATABASE_URL', appUrl, 'forge_app'],
    ['FORGE_SVC_DATABASE_URL', svcUrl, 'forge_svc'],
  ] as const) {
    if (!url) continue
    if (roleIn(url) !== role) problems.push(`${name} does not connect as ${role}`)
    // Identical to an Atlas credential means "the coach's grants" or "the billing grants".
    for (const [other, otherUrl] of [
      ['DATABASE_URL', process.env.DATABASE_URL],
      ['DATABASE_URL_UNPOOLED', process.env.DATABASE_URL_UNPOOLED],
      ['BILLING_DATABASE_URL', process.env.BILLING_DATABASE_URL],
    ] as const) {
      if (otherUrl && otherUrl.trim() === url) problems.push(`${name} is identical to ${other}`)
    }
  }
  if (appUrl && svcUrl && appUrl === svcUrl) {
    problems.push('FORGE_APP_DATABASE_URL and FORGE_SVC_DATABASE_URL are identical')
  }

  if (problems.length > 0 || !appUrl || !svcUrl) return { ok: false, problems }
  return {
    ok: true,
    pools: { app: createEcoPool(appUrl).pool, svc: createEcoPool(svcUrl).pool },
  }
}

export const forgeConfig: ForgeConfig = loadForgeConfig()
