import { createEcoPool } from '@ryp/eco/db'

// Only the pool. eco deliberately publishes no unscoped drizzle instance: under FORCE RLS an
// unscoped query against a user-scoped table returns zero rows, which looks like data loss
// rather than a permission error. Routes build their own handle and say why it is safe.
export const { pool } = createEcoPool()
