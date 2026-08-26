import { createEcoPool } from '@ryp/eco/db'

// A second pool, deliberately separate from ./db's `pool`.
//
// `atlas_app` (the role behind ./db) is structurally unable to write user_app_roles,
// org_memberships or organizations — those writes are bypass-only by policy, and that inability
// is exactly what makes the entitlement gate mean anything: no user-facing code path, however
// buggy, can self-grant admin. Admin mutations still need to happen somewhere, so they run on the
// one role that DOES hold the grant, `billing_svc`, and only inside withRlsBypass.
//
// This must never be the pool a user-facing route reaches for. If a route imports billingPool for
// anything other than an audited admin write, that route has quietly regained the ability the
// entitlement gate exists to deny it.
if (!process.env.BILLING_DATABASE_URL) {
  throw new Error('BILLING_DATABASE_URL is not set — admin mutation routes cannot start without it')
}

export const { pool: billingPool } = createEcoPool(process.env.BILLING_DATABASE_URL)
