import { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { currentPicture, practiceHandicap, type CarryReference, type ScoredSession, type FacetId } from '@ryp/eco/scoring'
import { CARRY_REFERENCES, ENTRY_METHODS, FACET_MODES, FACETS, PROXIMITY_UNITS, SHAPE_CALLS } from '@ryp/eco/schema'
import { pool } from '../db'
import type { ForgePools } from '../forgeDb'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import {
  FACET_NAMES,
  FACET_WEIGHTS,
  LADDER_VERSION,
  MODES_BY_FACET,
  OUTCOME_RANGE,
  SCORING_VERSION,
  HEAD_SCORED_CAL_VERSION,
  addDays,
  decideRung,
  MISSES_TO_DEMOTE,
  MAKEABLES_LADDER_ENABLED,
  num,
  parseDay,
  rungKeyFor,
  scoreFacet,
  utcToday,
  weekStart,
  type FacetName,
} from '../forgeScoring'

/**
 * FORGE — the player practice API, living inside Atlas's Express (Answers #8).
 *
 *   POST /api/forge/sessions               the ONE submit: session + facets + shots + holes
 *   POST /api/forge/sessions/:id/complete  score it, freeze it, then (as forge_svc) ladder + assignments
 *   GET  /api/forge/me/dashboard           one call, no fan-out (Spec §6.1)
 *   PUT  /api/forge/me/profile             carry reference, handicap, carry, target
 *   PUT  /api/forge/me/schedule            blocks per week — effective NEXT week
 *
 * NOT BUILT HERE (deliberately, scoped out of this pass): the coach roster/player surface, assignment
 * CRUD, abandon, the admin "grant Forge access" action (T-127), and generation of `source='auto'`
 * assignments. The brief for the auto row is already decided and is restated where it will bite: its
 * `note` is TEMPLATED GENERICALLY and never carries Forge's `primaryLeak` (Answers #2).
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 DEVIATION FROM BUILD SPEC §6.1, AND WHY IT IS NOT AN OVERSIGHT
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * §6.1: `POST /sessions` "allocates the seed server-side" at session START. §6.3: do not build an
 * offline sync queue; write through to local storage on every tap; SUBMIT ONCE AT COMPLETION. At a
 * driving range on one bar of signal those cannot both hold — a server-allocated seed needs the
 * network at the moment the player starts. §6.3 wins because it is specific about the failure mode.
 * So there is no start call: the client generates `seed` and `idempotency_key` offline, submits the
 * whole session once, and the unique index on (user_id, idempotency_key) makes a replayed submit a
 * no-op that returns the original.
 *
 * 🔴 AND THE DATABASE DOES NOT AGREE WITH THAT DEVIATION — READ THIS BEFORE DEBUGGING A "WRONG SEED".
 * `seed` is WITHHELD from forge_app's INSERT grant (rls_forge.sql §4.1) and the falsification run
 * records "player chooses their own seed → 42501" as a PASSING attack: a player who picks the seed
 * picks their Putt 18 holes. So this route CANNOT store the client's seed. It bounds-checks it (an
 * integer in 1..9972, so a garbage client is still a 400), does NOT name the column in the INSERT,
 * and the database allocates its own random seed at submit time. The stored seed therefore does not
 * regenerate the holes the player actually played; those are preserved as data in
 * `golf.putt18_holes` (distance_ft per hole), which is what analysis reads, so nothing the player
 * did is lost — only the regenerability. Every response says so (`seed_honoured: false`).
 * The decision to make is db-engineer's: grant `insert (seed)` to forge_app (reverses a tested
 * refusal) or move seed allocation to a start call (reverses §6.3). Neither is this file's to do.
 * Do NOT "fix" it here by smuggling the client seed into `meta` or `player_note`.
 *
 * CONSEQUENCE OF THE SAME DEVIATION: `started_at` is the INSERT instant (also not grantable), and
 * `range_sessions_played_on_window` requires `played_on` within one day of it. A §6.3 retry that lands
 * more than a day after the range visit is refused by the database (23514) and answered 422
 * `played_on_out_of_window`. That is the database's rule, correctly applied to a deferred submit.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * THE POOLS — the split is the security boundary
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *   atlas pool (./db, atlas_app)  ONLY the identity chain (attachUser / ensureAtlasAccess), which must
 *                                 resolve a first-time user before any role can be reached. No FORGE row.
 *   forge_app                     EVERY player read and write.
 *   forge_svc                     ONLY the ladder rung, the rung event and the assignment completion,
 *                                 inside /complete's second stage. No other route touches it.
 *   billingPool / withRlsBypass   NEVER. Nothing here is something forge_app structurally cannot write.
 *
 * ⚠️ EVERY READ BELOW FILTERS `user_id = <caller>` EXPLICITLY, although the policy would too. The
 * SELECT policies on every FORGE table admit `app_private.coaches(user_id)`, so a COACH who is also a
 * player would otherwise see their students' rows mixed into their own dashboard and could pass a
 * student's session id to /complete. The filter is what makes these routes "mine only"; the policy is
 * what makes a forged id match nothing. Neither is the backstop for the other.
 *
 * ⚠️ NO DRIZZLE `.insert().values()` ANYWHERE. It names every column of the table with `default` for
 * the ones not supplied — including `seed`, `started_at`, `source_app` and `expected_putts`, none of
 * which forge_app may name — and the statement dies 42501. Raw `sql` with an explicit column list, as
 * practice.ts does. `public.users` is deliberately in NO schema object here (forge_app has no grant).
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * DB REFUSALS BECOME HONEST HTTP, NEVER A RAW POLICY STRING
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * 42501 → 403; 23505 → 409; 23514 → 422 (named for the one we know, generic otherwise); 23503 → 422;
 * anything unexpected → a bare 500 `internal_error` — the global handler in index.ts would otherwise
 * echo `err.message`, constraint text included. Every rowCount below is checked, because a
 * policy-filtered write matches ZERO rows and raises nothing; `rows: 0` is a refusal, not a success.
 * Where a handler pre-checks something purely for a better message, it says so: the database is the
 * real gate and the `if` must not outlive the policy it mirrors.
 */

const NO_SCHEMA = {}

/** Cookie OR bearer — Luke's served prototype authenticates by the httpOnly cookie. See ../cookieOrBearer. */
const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  // Forge is opt-in per user: the ('forge', …) role row IS the gate (Answers #5) and signup does not
  // grant it. Until the admin action (T-127) ships, a tester needs that row seeded or every request
  // here is 403 app_access_denied — which is the correct answer for a user who was not given access.
  requireApp('forge'),
  requireConsent(),
]

interface Me {
  id: string
  firebaseUid: string
}
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const rowsOf = (r: { rows: unknown[] }): Row[] => r.rows as Row[]

/** `timestamp without time zone` → ISO-8601 UTC text. node-pg would parse the bare timestamp in the PROCESS's local zone. */
const iso = (col: string): SQL => sql.raw(`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)

/** A refusal this file chose to make; carries its own HTTP answer. Thrown inside a transaction so it rolls back. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error))
  }
}
/** Another request completed the session between our read and our write. Not an error: stage 2 runs. */
class RaceLost extends Error {}

function fail(res: Response, err: unknown): void {
  if (err instanceof Refusal) {
    res.status(err.status).json(err.body)
    return
  }
  const e = err as { code?: string; constraint?: string }
  switch (e.code) {
    case '42501':
      res.status(403).json({ error: 'not_permitted' })
      return
    case '23505':
      res.status(409).json({ error: 'conflict' })
      return
    case '23514':
      if (e.constraint === 'range_sessions_played_on_window') {
        res.status(422).json({
          error: 'played_on_out_of_window',
          message: 'played_on must be within one day of when the session is submitted.',
        })
        return
      }
      res.status(422).json({ error: 'value_out_of_bounds' })
      return
    case '23503':
      res.status(422).json({ error: 'reference_not_found' })
      return
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      res.status(422).json({ error: 'invalid_value' })
      return
  }
  console.error('[forge] unexpected error', err)
  res.status(500).json({ error: 'internal_error' })
}

const ctxOf = (me: Me) => ({ userId: me.id, firebaseUid: me.firebaseUid, app: 'forge' })
const uuid = z.string().uuid()

/**
 * The caller's local calendar day. The client knows it; the server cannot. Accepted only within one
 * day of UTC "today" so it cannot be used to place a streak or a schedule in the far future.
 */
function resolveToday(raw: unknown): string | null {
  const utc = utcToday()
  if (raw === undefined || raw === null || raw === '') return utc
  const day = typeof raw === 'string' ? parseDay(raw) : null
  if (!day) return null
  const lo = addDays(utc, -1)
  const hi = addDays(utc, 1)
  return day >= lo && day <= hi ? day : null
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// POST /sessions
// ═════════════════════════════════════════════════════════════════════════════════════════════

const shotBody = z
  .object({
    shot_index: z.number().int().min(0).max(59),
    option_index: z.number().int().min(0).max(20).nullish(),
    outcome_value: z.number().int().min(-3).max(4),
    shape_call: z.enum(SHAPE_CALLS).nullish(),
    target_yds: z.number().int().min(1).max(600).nullish(),
    carry_yds: z.number().int().min(0).max(500).nullish(),
    offline_yds: z.number().int().min(-300).max(300).nullish(),
    proximity: z.number().min(0).max(1000).nullish(),
    proximity_unit: z.enum(PROXIMITY_UNITS).nullish(),
  })
  .strict()

const holeBody = z
  .object({
    hole_index: z.number().int().min(0).max(17),
    distance_ft: z.number().min(3).max(50),
    putts: z.number().int().min(1).max(9),
    first_putt_leave_ft: z.number().min(0).max(60).nullish(),
    miss_dx: z.number().min(-100).max(100).nullish(),
    miss_dy: z.number().min(-100).max(100).nullish(),
  })
  .strict()

/** driving and approach have one test per facet, so an omitted mode is 'stock'; the other two must say. */
function resolveMode(facet: FacetName, mode: string | null | undefined): string | null {
  if (mode) return mode
  return facet === 'driving' || facet === 'approach' ? 'stock' : null
}

const facetBody = z
  .object({
    facet: z.enum(FACETS),
    mode: z.enum(FACET_MODES).nullish(),
    // Optional and NEVER trusted: the level a drill is played at is the player's rung (§5.5), which
    // the server reads. A level that disagrees with it is refused 409; one that agrees is redundant.
    level: z.number().int().min(0).max(3).nullish(),
    entry_method: z.enum(ENTRY_METHODS),
    shots: z.array(shotBody).max(60).default([]),
    holes: z.array(holeBody).max(18).default([]),
    /** Tally Putt 18 only: the round has no hole rows, so these two are the whole record. */
    holes_played: z.number().int().min(0).max(18).optional(),
    raw_total: z.number().int().min(0).max(200).optional(),
    /** Stroke test writes a number, never a display string (Spec §7.3). */
    on_line_pct: z.number().min(0).max(1).optional(),
    /** Lag writes a number, never a display string (Spec §7.3). */
    avg_proximity_ft: z.number().min(0).max(300).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const bad = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path })
    const mode = resolveMode(f.facet, f.mode)
    if (mode === null || !MODES_BY_FACET[f.facet].includes(mode)) {
      bad(`mode must be one of ${MODES_BY_FACET[f.facet].join(', ')}`, ['mode'])
      return
    }
    // Driving "level 0" is accepted from a client that follows the spec and stored as NULL — the
    // database refuses a level on any row with no ladder (facet_scores_level_only_where_a_ladder_exists).
    if (f.level != null && rungKeyFor(f.facet, mode) === null && !(f.facet === 'driving' && f.level === 0)) {
      bad('level does not apply to this facet and mode', ['level'])
    }
    if (f.on_line_pct !== undefined && mode !== 'stroke') bad('on_line_pct is for the stroke test only', ['on_line_pct'])
    if (f.avg_proximity_ft !== undefined && mode !== 'lag') bad('avg_proximity_ft is for lag only', ['avg_proximity_ft'])

    if (f.facet === 'putting' && mode === 'putt18') {
      if (f.shots.length > 0) bad('Putt 18 takes holes, not shots', ['shots'])
      if (f.entry_method === 'tally') {
        // ⚠️ A tally Putt 18 legitimately has ZERO hole rows. The two numbers are its whole record.
        if (f.holes.length > 0) bad('a tally Putt 18 carries no hole rows', ['holes'])
        if (f.holes_played === undefined || f.raw_total === undefined) {
          bad('a tally Putt 18 needs holes_played and raw_total', ['holes_played'])
        }
      } else {
        if (f.holes_played !== undefined || f.raw_total !== undefined) {
          bad('holes_played and raw_total are for a tally Putt 18 only', ['holes_played'])
        }
        if (new Set(f.holes.map((h) => h.hole_index)).size !== f.holes.length) bad('duplicate hole_index', ['holes'])
      }
      return
    }

    if (f.holes.length > 0 || f.holes_played !== undefined || f.raw_total !== undefined) {
      bad('holes, holes_played and raw_total are for Putt 18 only', ['holes'])
    }
    if (new Set(f.shots.map((s) => s.shot_index)).size !== f.shots.length) bad('duplicate shot_index', ['shots'])
    // §3.3: a counted entry "must sum to 20 to be complete; over 20 is an error state".
    if (f.entry_method !== 'shot_by_shot' && f.shots.length > 20) bad('a counted entry cannot exceed 20 balls', ['shots'])
    const rangeKey = f.facet === 'putting' ? (mode === 'makeables' ? 'makeables' : null) : f.facet
    const range = rangeKey ? OUTCOME_RANGE[rangeKey] : ([-3, 4] as [number, number])
    f.shots.forEach((s, i) => {
      if (s.outcome_value < range[0] || s.outcome_value > range[1]) {
        bad(`outcome_value must be ${range[0]}..${range[1]} for ${f.facet}/${mode}`, ['shots', i, 'outcome_value'])
      }
    })
  })

export const submitBody = z
  .object({
    /** The LOCAL date at the range — not UTC, which would file an evening session on tomorrow. */
    played_on: z.string().refine((s) => parseDay(s) !== null, 'must be a real YYYY-MM-DD date'),
    /** Bounds-checked and then NOT STORED — see the header. 1..9972, never 0 (0 and 1 generate the same holes). */
    seed: z.number().int().min(1).max(9972),
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
    assignment_id: uuid.nullish(),
    notes: z.string().trim().max(2000).nullish(),
    facets: z.array(facetBody).min(1).max(8),
  })
  .strict()
  .superRefine((b, ctx) => {
    const seen = new Set<string>()
    for (const [i, f] of b.facets.entries()) {
      const key = `${f.facet}|${resolveMode(f.facet, f.mode)}`
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'duplicate facet+mode', path: ['facets', i] })
      seen.add(key)
    }
  })

const SESSION_COLS = sql`
  s.id, s.played_on::text as played_on, ${iso('s.started_at')} as started_at,
  ${iso('s.completed_at')} as completed_at, ${iso('s.abandoned_at')} as abandoned_at,
  s.seed, s.assignment_id, s.player_note`

const FACET_COLS = sql`
  f.id, f.facet, f.mode, f.level, f.entry_method, f.shot_count, f.holes_played, f.is_complete,
  f.raw_total, f.practice_index::float8 as practice_index, f.predictor_score::float8 as predictor_score,
  f.meta`

function shapeSession(s: Row) {
  return {
    id: s.id as string,
    played_on: s.played_on as string,
    started_at: s.started_at as string,
    completed_at: (s.completed_at ?? null) as string | null,
    abandoned_at: (s.abandoned_at ?? null) as string | null,
    status: s.abandoned_at ? 'abandoned' : s.completed_at ? 'completed' : 'live',
    // The DATABASE's seed, not the client's — see the header. Do not read it as the seed that was played.
    seed: s.seed as number,
    assignment_id: (s.assignment_id ?? null) as string | null,
    notes: (s.player_note ?? null) as string | null,
  }
}

function shapeFacet(f: Row) {
  const meta = (f.meta ?? {}) as { scored?: boolean; withheld?: string | null }
  return {
    id: f.id as string,
    facet: f.facet as string,
    mode: (f.mode ?? null) as string | null,
    /** 0-based rung as played (0 = L1 … 3 = L4); null where no ladder exists (driving, Putt 18, lag, stroke). */
    level: (f.level ?? null) as number | null,
    entry_method: f.entry_method as string,
    shot_count: f.shot_count as number,
    holes_played: (f.holes_played ?? null) as number | null,
    is_complete: f.is_complete as boolean,
    provisional: !f.is_complete,
    raw_total: (f.raw_total ?? null) as number | null,
    practice_index: (f.practice_index ?? null) as number | null,
    predictor_score: (f.predictor_score ?? null) as number | null,
    scored: meta.scored === true,
    /** Why `practice_index` is null when it is. null before scoring and when an index exists. */
    index_withheld: meta.withheld ?? null,
  }
}

type Db = Parameters<Parameters<typeof withRls<typeof NO_SCHEMA, unknown>>[3]>[0]

async function loadSession(db: Db, userId: string, where: SQL) {
  const s = rowsOf(
    await db.execute(sql`
      select ${SESSION_COLS} from golf.range_sessions s
      where s.user_id = ${userId}::uuid and ${where}`),
  )[0]
  if (!s) return null
  const facets = rowsOf(
    await db.execute(sql`
      select ${FACET_COLS} from golf.facet_scores f
      where f.session_id = ${s.id}::uuid and f.user_id = ${userId}::uuid
      order by f.created_at, f.id`),
  )
  return { session: shapeSession(s), facets: facets.map(shapeFacet) }
}

export function createForgeRouter(pools: ForgePools): Router {
  const forgeRouter = Router()

  forgeRouter.post('/sessions', ...identityChain, async (req, res) => {
    const parsed = submitBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const b = parsed.data
    const me = (req as unknown as { user: Me }).user
    try {
      const out = await withRls(pools.app, ctxOf(me), NO_SCHEMA, async (db) => {
        // `user_id` is the CALLER and the insert policy pins it too, so a forged subject is refused
        // by the database. NOT named: seed, started_at, source_app, generator_version, completed_at,
        // abandoned_at — all withheld from forge_app's INSERT grant (see the header on seed).
        // The conflict target is NAMED (user_id, idempotency_key) on purpose: the one-live-session
        // unique index must still RAISE (23505 → 409), not be swallowed as though it were a replay.
        const ins = await db.execute(sql`
          insert into golf.range_sessions (user_id, played_on, assignment_id, player_note, idempotency_key, seed)
          values (${me.id}::uuid, ${b.played_on}::date, ${b.assignment_id ?? null}::uuid,
                  ${b.notes ?? null}::text, ${b.idempotency_key}::text, ${b.seed}::int)
          on conflict (user_id, idempotency_key) do nothing
          returning id`)
        const created = rowsOf(ins)[0]

        if (!created) {
          // REPLAY: same caller, same key. Return what is stored — whatever the payload now says — and
          // write nothing. A body that DIFFERS from the original is answered with the original; the
          // key, not the content, is the identity (Spec §6.3).
          const prior = await loadSession(db, me.id, sql`s.idempotency_key = ${b.idempotency_key}::text`)
          if (!prior) throw new Refusal(409, { error: 'conflict' }) // key exists but not readable: not ours
          return { replayed: true as const, ...prior }
        }
        const sessionId = created.id as string

        const rungs = new Map<string, number>()
        for (const r of rowsOf(
          await db.execute(sql`
            select facet, mode, rung from golf.facet_rungs where user_id = ${me.id}::uuid`),
        )) {
          rungs.set(`${r.facet}|${r.mode ?? ''}`, Number(r.rung))
        }

        for (const f of b.facets) {
          const mode = resolveMode(f.facet, f.mode)
          const rk = rungKeyFor(f.facet, mode)
          let level: number | null = null
          if (rk) {
            const expected = rungs.get(`${rk.facet}|${rk.mode ?? ''}`) ?? 0
            // Pre-check purely for a better message: nothing in the database compares `level` to the
            // rung, so THIS is the gate (and the ladder evaluator independently ignores a session whose
            // level is not the pre-promotion rung). A player-chosen level would otherwise pick their
            // own base in the index formula.
            if (f.level != null && f.level !== expected) {
              throw new Refusal(409, {
                error: 'level_mismatch',
                facet: f.facet,
                mode,
                expected_level: expected,
                message: 'The level is set by your ladder. Refresh your dashboard and replay this drill at that level.',
              })
            }
            level = expected
          }

          const scored = scoreFacet({
            facet: f.facet,
            mode,
            level,
            shots: f.shots.map((s) => ({ outcome_value: s.outcome_value, target_yds: s.target_yds ?? null })),
            holes: f.holes.map((h) => ({ putts: h.putts })),
            tally:
              f.facet === 'putting' && mode === 'putt18' && f.entry_method === 'tally'
                ? { holesPlayed: f.holes_played ?? 0, rawTotal: f.raw_total ?? 0 }
                : null,
            profile: { carryReference: null, driverCarryYds: null },
          })

          // scoring_version is NOT NULL with no default, so it is stamped now; the INDEX is null until
          // /complete computes it (Spec §6.1: "Computes indices server-side"). meta.scored = false says so.
          const fr = await db.execute(sql`
            insert into golf.facet_scores
              (session_id, user_id, facet, mode, level, shot_count, holes_played, is_complete, raw_total,
               meta, on_line_pct, avg_proximity_ft, entry_method, scoring_version)
            values
              (${sessionId}::uuid, ${me.id}::uuid, ${f.facet}::text, ${mode}::text, ${level}::int,
               ${scored.shotCount}::int, ${scored.holesPlayed}::int, ${scored.isComplete}::boolean,
               ${scored.rawTotal}::int, ${JSON.stringify({ scored: false })}::jsonb,
               ${f.on_line_pct ?? null}::numeric, ${f.avg_proximity_ft ?? null}::numeric,
               ${f.entry_method}::text, ${SCORING_VERSION}::text)
            returning id`)
          const facetRowId = rowsOf(fr)[0]?.id as string | undefined
          if (!facetRowId) throw new Refusal(403, { error: 'not_written' })

          if (f.shots.length > 0) {
            // entry_method is set from the facet's entry PATH, never per shot from the body (schema doc).
            const values = sql.join(
              f.shots.map(
                (s) => sql`(${facetRowId}::uuid, ${me.id}::uuid, ${s.shot_index}::int, ${s.option_index ?? null}::int,
                  ${s.outcome_value}::int, ${s.shape_call ?? null}::text, ${s.target_yds ?? null}::int,
                  ${s.carry_yds ?? null}::int, ${s.offline_yds ?? null}::int, ${s.proximity ?? null}::numeric,
                  ${s.proximity_unit ?? null}::text, ${f.entry_method}::text)`,
              ),
              sql`, `,
            )
            const r = await db.execute(sql`
              insert into golf.range_shots
                (session_facet_id, user_id, shot_index, option_index, outcome_value, shape_call, target_yds,
                 carry_yds, offline_yds, proximity, proximity_unit, entry_method)
              values ${values}`)
            if (r.rowCount !== f.shots.length) throw new Refusal(403, { error: 'not_written' })
          }

          if (f.holes.length > 0) {
            // expected_putts and its curve version are NOT named: a BEFORE INSERT trigger stamps them
            // (frozen at play) and neither is in the grant. Naming either is a 42501.
            const values = sql.join(
              f.holes.map(
                (h) => sql`(${facetRowId}::uuid, ${me.id}::uuid, ${h.hole_index}::int, ${h.distance_ft}::numeric,
                  ${h.putts}::int, ${h.first_putt_leave_ft ?? null}::numeric, ${h.miss_dx ?? null}::numeric,
                  ${h.miss_dy ?? null}::numeric)`,
              ),
              sql`, `,
            )
            const r = await db.execute(sql`
              insert into golf.putt18_holes
                (session_facet_id, user_id, hole_index, distance_ft, putts, first_putt_leave_ft, miss_dx, miss_dy)
              values ${values}`)
            if (r.rowCount !== f.holes.length) throw new Refusal(403, { error: 'not_written' })
          }
        }

        const stored = await loadSession(db, me.id, sql`s.id = ${sessionId}::uuid`)
        if (!stored) throw new Refusal(403, { error: 'not_written' })
        return { replayed: false as const, ...stored }
      })

      // ✅ The client's seed is now STORED (eco 0.29.0 / migration 0012 grants forge_app
      // `insert (seed)`). It was withheld until 2026-10-14, which left the stored seed unable to
      // regenerate the Putt 18 holes the player actually played — the one job §1 gives it. Re-rolling
      // on UPDATE is still refused; that was always where the protection belonged.
      res.status(out.replayed ? 200 : 201).json({ ...out, seed_honoured: true })
    } catch (err) {
      const e = err as { code?: string; constraint?: string }
      if (e.code === '23505' && e.constraint === 'range_sessions_one_live_uniq') {
        // One unfinished session per player. The client resolves it by completing that one — every
        // submitted session is complete-able — so say which it is.
        try {
          const live = await withRls(pools.app, ctxOf(me), NO_SCHEMA, (db) =>
            loadSession(db, me.id, sql`s.completed_at is null and s.abandoned_at is null`),
          )
          res.status(409).json({ error: 'live_session_exists', live_session_id: live?.session.id ?? null })
          return
        } catch {
          res.status(409).json({ error: 'live_session_exists', live_session_id: null })
          return
        }
      }
      fail(res, err)
    }
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // POST /sessions/:id/complete
  //
  // TWO STAGES, TWO PRINCIPALS, TWO TRANSACTIONS — and the second must be safe to run again.
  //
  //   Stage 1 (forge_app)  score every facet from its STORED shots, freeze the inputs, stamp
  //                        scoring_version, set completed_at. One transaction. facet_scores can only
  //                        be updated while the session is LIVE (forge_session_is_live), so the facets
  //                        are written FIRST and completed_at LAST; the reverse order would freeze the
  //                        rows before they were scored.
  //   Stage 2 (forge_svc)  ladder + assignment completions. A different pool, so it cannot share a
  //                        transaction with stage 1. If it fails the session is already completed and
  //                        unevaluated — so a second POST on a completed session SKIPS stage 1 and
  //                        RE-RUNS stage 2, and stage 2 is a pure function of rows that exist BEFORE
  //                        this session (see the reads), keyed idempotently on its writes.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  forgeRouter.post('/sessions/:id/complete', ...identityChain, async (req, res) => {
    const idParsed = uuid.safeParse(req.params.id)
    if (!idParsed.success) {
      res.status(400).json({ error: 'invalid_session_id' })
      return
    }
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      // Nothing about scoring is the client's to say. A body is a client trying to.
      res.status(400).json({ error: 'invalid_body', message: 'This endpoint takes no body.' })
      return
    }
    const sessionId = idParsed.data
    const me = (req as unknown as { user: Me }).user

    try {
      let alreadyCompleted = false
      try {
        alreadyCompleted = await withRls(pools.app, ctxOf(me), NO_SCHEMA, async (db) => {
          const s = rowsOf(
            await db.execute(sql`
              select completed_at is not null as completed, abandoned_at is not null as abandoned
              from golf.range_sessions
              where id = ${sessionId}::uuid and user_id = ${me.id}::uuid`),
          )[0]
          if (!s) throw new Refusal(404, { error: 'session_not_found' })
          if (s.abandoned) throw new Refusal(409, { error: 'session_abandoned' })
          if (s.completed) return true

          const profile = rowsOf(
            await db.execute(sql`
              select target_handicap::float8 as target_handicap, driver_carry_yds, carry_reference
              from golf.player_profile where user_id = ${me.id}::uuid`),
          )[0]
          const target = num(profile?.target_handicap)
          const carryYds = num(profile?.driver_carry_yds)
          const ref = (CARRY_REFERENCES as readonly string[]).includes(profile?.carry_reference)
            ? (profile?.carry_reference as CarryReference)
            : null

          const facets = rowsOf(
            await db.execute(sql`
              select id, facet, mode, level, entry_method, holes_played, raw_total, meta
              from golf.facet_scores
              where session_id = ${sessionId}::uuid and user_id = ${me.id}::uuid
              order by created_at, id`),
          )
          if (facets.length === 0) throw new Refusal(409, { error: 'session_has_no_facets' })

          for (const f of facets) {
            const shots = rowsOf(
              await db.execute(sql`
                select outcome_value, target_yds from golf.range_shots
                where session_facet_id = ${f.id}::uuid and user_id = ${me.id}::uuid and voided_at is null
                order by shot_index`),
            )
            const holes = rowsOf(
              await db.execute(sql`
                select putts from golf.putt18_holes
                where session_facet_id = ${f.id}::uuid and user_id = ${me.id}::uuid and voided_at is null`),
            )
            const isPutt18 = f.facet === 'putting' && f.mode === 'putt18'
            const scored = scoreFacet({
              facet: f.facet as FacetName,
              mode: f.mode ?? null,
              level: f.level ?? null,
              shots: shots.map((s) => ({ outcome_value: Number(s.outcome_value), target_yds: num(s.target_yds) })),
              holes: holes.map((h) => ({ putts: Number(h.putts) })),
              tally:
                isPutt18 && f.entry_method === 'tally'
                  ? { holesPlayed: Number(f.holes_played ?? 0), rawTotal: Number(f.raw_total ?? 0) }
                  : null,
              profile: { carryReference: ref, driverCarryYds: carryYds },
            })

            // Freeze at play: the target in force on EVERY row (forge_svc has no grant on the profile,
            // so the ladder can only read the target from here), the carry snapshot on DRIVING only
            // (the CHECK refuses it elsewhere), and the version that scored it.
            const meta = {
              scored: true,
              withheld: scored.withheld,
              ...(f.facet === 'approach' || f.facet === 'chipping' || (f.facet === 'putting' && f.mode === 'makeables')
                ? { head_scored_cal: HEAD_SCORED_CAL_VERSION }
                : {}),
            }
            const upd = await db.execute(sql`
              update golf.facet_scores set
                practice_index          = ${scored.practiceIndex}::numeric,
                predictor_score         = ${scored.predictorScore}::numeric,
                target_handicap_at_play = ${target}::numeric,
                carry_yds_at_play       = ${scored.carry?.yds ?? null}::int,
                carry_reference_at_play = ${scored.carry?.ref ?? null}::text,
                shot_count              = ${scored.shotCount}::int,
                holes_played            = ${scored.holesPlayed}::int,
                is_complete             = ${scored.isComplete}::boolean,
                raw_total               = ${scored.rawTotal}::int,
                meta                    = meta || ${JSON.stringify(meta)}::jsonb,
                scoring_version         = ${SCORING_VERSION}::text,
                updated_at              = now()
              where id = ${f.id}::uuid and user_id = ${me.id}::uuid and session_id = ${sessionId}::uuid`)
            // ROWCOUNT, because a live-session policy that no longer admits this row matches ZERO rows
            // and raises nothing — which is exactly what a concurrent /complete looks like from here.
            if (upd.rowCount !== 1) throw new RaceLost()
          }

          const done = await db.execute(sql`
            update golf.range_sessions set completed_at = now(), updated_at = now()
            where id = ${sessionId}::uuid and user_id = ${me.id}::uuid
              and completed_at is null and abandoned_at is null`)
          if (done.rowCount !== 1) throw new RaceLost()
          return false
        })
      } catch (err) {
        if (!(err instanceof RaceLost)) throw err
        alreadyCompleted = true // another request finished it first; its stage 1 committed, ours rolled back
      }

      let report: Awaited<ReturnType<typeof evaluateAndReport>>
      try {
        report = await withRls(pools.svc, ctxOf(me), NO_SCHEMA, (db) => evaluateAndReport(db, me.id, sessionId))
      } catch (err) {
        if (err instanceof Refusal) throw err
        console.error('[forge] stage 2 (ladder/assignments) failed; session is completed and unevaluated', err)
        res.status(503).json({ error: 'evaluation_incomplete', session_completed: true, retry: true })
        return
      }
      res.json({ already_completed: alreadyCompleted, ...report })
    } catch (err) {
      fail(res, err)
    }
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // GET /me/dashboard
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  forgeRouter.get('/me/dashboard', ...identityChain, async (req, res) => {
    const today = resolveToday(req.query.today)
    if (!today) {
      res.status(400).json({ error: 'invalid_today' })
      return
    }
    const me = (req as unknown as { user: Me }).user
    try {
      const body = await withRls(pools.app, ctxOf(me), NO_SCHEMA, async (db) => {
        const uid = me.id
        const thisWeek = weekStart(today)
        const eightWeeksAgo = addDays(thisWeek, -7 * 7)

        const profileRow = rowsOf(
          await db.execute(sql`
            select handicap_index::float8 as handicap_index, target_handicap::float8 as target_handicap,
                   driver_carry_yds, carry_reference, handicap_source,
                   ${iso('handicap_updated_at')} as handicap_updated_at,
                   handicap_checkin_cadence, handicap_checkin_snoozed_until::text as handicap_checkin_snoozed_until
            from golf.player_profile where user_id = ${uid}::uuid`),
        )[0]

        const rungs = rowsOf(
          await db.execute(sql`
            select facet, mode, rung from golf.facet_rungs where user_id = ${uid}::uuid order by facet, mode`),
        )

        // THE CURRENT PICTURE. Reads filter on the SESSION being completed AND the facet being complete
        // AND an index existing — provisional work is excluded here and only here. (The streak below
        // does the opposite on purpose: attendance, not quality — Answers #9.)
        const scoredRows = rowsOf(
          await db.execute(sql`
            select s.id as session_id, s.played_on::text as played_on, f.facet, f.practice_index::float8 as v
            from golf.facet_scores f
            join golf.range_sessions s on s.id = f.session_id and s.user_id = f.user_id
            where f.user_id = ${uid}::uuid and s.completed_at is not null and f.is_complete
              and f.practice_index is not null
            order by s.completed_at desc, f.created_at
            limit 60`),
        )
        const bySession = new Map<string, ScoredSession>()
        for (const r of scoredRows) {
          let sc = bySession.get(r.session_id)
          if (!sc) {
            sc = { date: r.played_on, facets: {}, complete: {} }
            bySession.set(r.session_id, sc)
          }
          const id = r.facet as FacetId
          if (sc.facets[id] === undefined) {
            sc.facets[id] = r.v
            sc.complete[id] = true // the SQL above already required is_complete — the module wants the flag, not an inference
          }
        }
        const picture = currentPicture([...bySession.values()], FACET_NAMES, today)
        const values: Partial<Record<FacetId, number>> = {}
        for (const id of FACET_NAMES) if (picture[id]) values[id] = picture[id]!.value

        // The two column lists collide on `id`, so read the sessions and their facets separately:
        // one query per grain is clearer than a join whose rows are ambiguous by name.
        const sessionRows = rowsOf(
          await db.execute(sql`
            select ${SESSION_COLS} from (
              select * from golf.range_sessions
              where user_id = ${uid}::uuid and abandoned_at is null
              order by played_on desc, started_at desc limit 10
            ) s
            order by s.played_on desc, s.started_at desc`),
        )
        const facetRows = rowsOf(
          await db.execute(sql`
            select f.session_id, ${FACET_COLS} from golf.facet_scores f
            join (
              select id from golf.range_sessions
              where user_id = ${uid}::uuid and abandoned_at is null
              order by played_on desc, started_at desc limit 10
            ) s on s.id = f.session_id
            where f.user_id = ${uid}::uuid
            order by f.created_at, f.id`),
        )
        const facetsBySession = new Map<string, ReturnType<typeof shapeFacet>[]>()
        for (const f of facetRows) {
          const list = facetsBySession.get(f.session_id) ?? []
          list.push(shapeFacet(f))
          facetsBySession.set(f.session_id, list)
        }
        const recentSessions = sessionRows.map((s) => ({ ...shapeSession(s), facets: facetsBySession.get(s.id) ?? [] }))
        // Its own read, not a find() over the ten above: a live session is whatever is unfinished, however old its played_on.
        const live = await loadSession(db, uid, sql`s.completed_at is null and s.abandoned_at is null`)

        // ASSIGNMENTS — outstanding only. Precedence coach > player > auto (Spec §5.1) is load-bearing in
        // the UI now that all three sources are live, so it is the sort order, not a suggestion.
        const assignmentRows = rowsOf(
          await db.execute(sql`
            select id, source, facet, mode, cadence, note, expires_on::text as expires_on,
                   ${iso('created_at')} as created_at
            from atlas.assignments
            where subject_user_id = ${uid}::uuid and revoked_at is null
              and (expires_on is null or expires_on >= ${today}::date)`),
        )
        const completionRows = rowsOf(
          await db.execute(sql`
            select assignment_id,
                   count(*)::int as n_total,
                   count(*) filter (where played_on >= ${thisWeek}::date)::int as n_week,
                   count(*) filter (where played_on = ${today}::date)::int as n_today
            from atlas.assignment_completions
            where subject_user_id = ${uid}::uuid
            group by assignment_id`),
        )
        const completions = new Map(completionRows.map((c) => [c.assignment_id as string, c]))
        const precedence: Record<string, number> = { coach: 0, player: 1, auto: 2 }
        const assignments = assignmentRows
          .filter((a) => {
            const c = completions.get(a.id)
            if (a.cadence === 'once') return !(c && c.n_total > 0)
            if (a.cadence === 'week') return !(c && c.n_week > 0)
            return !(c && c.n_today > 0) // 'day': appears every block, satisfied per day
          })
          .sort((a, b) => (precedence[a.source] ?? 9) - (precedence[b.source] ?? 9))
          .map((a) => ({
            id: a.id as string,
            source: a.source as string,
            facet: a.facet as string,
            mode: (a.mode ?? null) as string | null,
            cadence: a.cadence as string,
            note: (a.note ?? null) as string | null,
            expires_on: (a.expires_on ?? null) as string | null,
            created_at: a.created_at as string,
          }))

        // THE COMMITMENT. The row mirrors the player's LATEST ask; what is IN FORCE is resolved through
        // history, because a change takes effect next week (Answers #4).
        const commitment = rowsOf(
          await db.execute(sql`
            select blocks_per_week, pinned_facet, pinned_on::text as pinned_on, pinned_until::text as pinned_until
            from golf.practice_commitment where user_id = ${uid}::uuid`),
        )[0]
        const history = rowsOf(
          await db.execute(sql`
            select blocks_per_week, effective_from::text as effective_from
            from golf.practice_commitment_history where user_id = ${uid}::uuid
            order by effective_from desc, created_at desc, id desc limit 100`),
        )
        const inForceAt = (day: string): number | null => {
          const h = history.find((r) => r.effective_from <= day)
          return h ? Number(h.blocks_per_week) : null
        }
        const pendingRow = history.find((r) => r.effective_from > today)
        const inForceNow = inForceAt(today) ?? (commitment ? Number(commitment.blocks_per_week) : null)

        // STREAK / BLOCKS — attendance. Filters abandoned and NOTHING ELSE: a provisional session counts,
        // and so does one not yet completed (Answers #9: "the streak measures attendance, not quality").
        const attendance = rowsOf(
          await db.execute(sql`
            select played_on::text as played_on, count(*)::int as n
            from golf.range_sessions
            where user_id = ${uid}::uuid and abandoned_at is null and played_on >= ${eightWeeksAgo}::date
            group by played_on`),
        )
        const weeks: { week_start: string; blocks: number; target: number | null; met: boolean }[] = []
        for (let w = 0; w < 8; w++) {
          const ws = addDays(thisWeek, -7 * w)
          const we = addDays(ws, 6)
          const blocks = attendance
            .filter((r) => r.played_on >= ws && r.played_on <= we)
            .reduce((a, r) => a + Number(r.n), 0)
          // In force on the LAST day of the week (or today, for this one): a mid-week change is effective
          // next Monday so it cannot reach back into the week it was made, and a first-ever target set
          // mid-week is in force by Sunday.
          const target = inForceAt(w === 0 ? today : we)
          weeks.push({ week_start: ws, blocks, target, met: target !== null && blocks >= target })
        }
        // The current week never BREAKS a streak (it is not over); it extends one when already met.
        let streakWeeks = weeks[0]?.met ? 1 : 0
        for (const w of weeks.slice(1)) {
          if (!w.met) break
          streakWeeks++
        }

        return {
          today,
          scoring_version: SCORING_VERSION,
          profile: profileRow
            ? {
                handicap_index: num(profileRow.handicap_index),
                target_handicap: num(profileRow.target_handicap),
                driver_carry_yds: num(profileRow.driver_carry_yds),
                carry_reference: (profileRow.carry_reference ?? null) as string | null,
                handicap_source: (profileRow.handicap_source ?? null) as string | null,
                handicap_updated_at: (profileRow.handicap_updated_at ?? null) as string | null,
                handicap_checkin_cadence: (profileRow.handicap_checkin_cadence ?? null) as string | null,
                handicap_checkin_snoozed_until: (profileRow.handicap_checkin_snoozed_until ?? null) as string | null,
              }
            : null,
          picture: {
            composite: practiceHandicap(values, FACET_WEIGHTS),
            facets: Object.fromEntries(
              FACET_NAMES.flatMap((id) => (picture[id] ? [[id, picture[id]]] : [])),
            ) as Partial<Record<FacetName, { value: number; n: number; se: number; days: number; stale: boolean }>>,
          },
          rungs: rungs.map((r) => ({ facet: r.facet as string, mode: (r.mode ?? null) as string | null, rung: Number(r.rung) })),
          recent_sessions: recentSessions,
          assignments,
          commitment: {
            blocks_per_week: inForceNow,
            pending: pendingRow
              ? { blocks_per_week: Number(pendingRow.blocks_per_week), effective_from: pendingRow.effective_from as string }
              : null,
            pinned:
              commitment?.pinned_facet != null
                ? { facet: commitment.pinned_facet as string, on: commitment.pinned_on as string, until: commitment.pinned_until as string }
                : null,
          },
          streak: { weeks_met: streakWeeks, blocks_this_week: weeks[0]?.blocks ?? 0, weeks },
          live_session: live ? { ...live.session, facets: live.facets } : null,
        }
      })
      res.json(body)
    } catch (err) {
      fail(res, err)
    }
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // PUT /me/profile
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  const profileBody = z
    .object({
      carry_reference: z.enum(CARRY_REFERENCES).nullable().optional(),
      handicap_index: z.number().min(-10).max(54).nullable().optional(),
      driver_carry_yds: z.number().int().min(50).max(450).nullable().optional(),
      target_handicap: z.number().min(-6).max(30).nullable().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'at least one field is required')

  const round1 = (v: number | null | undefined) => (v == null ? v : Math.round(v * 10) / 10)

  forgeRouter.put('/me/profile', ...identityChain, async (req, res) => {
    const parsed = profileBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const p = parsed.data
    const me = (req as unknown as { user: Me }).user
    const has = {
      hi: p.handicap_index !== undefined,
      carry: p.driver_carry_yds !== undefined,
      target: p.target_handicap !== undefined,
      ref: p.carry_reference !== undefined,
    }
    const hi = round1(p.handicap_index) ?? null
    const target = round1(p.target_handicap) ?? null
    try {
      const out = await withRls(pools.app, ctxOf(me), NO_SCHEMA, async (db) => {
        // forge_app's columns only: handicap_index, handicap_source, handicap_updated_at, driver_carry_yds,
        // target_handicap, carry_reference, updated_at. A column NOT supplied is left exactly as it was
        // (the `case when` keeps the stored value) — a partial PUT must not null what it did not mention.
        // Answering the handicap question makes the value a SELF-REPORT as of now, whatever it was before.
        const upsert = await db.execute(sql`
          insert into golf.player_profile
            (user_id, handicap_index, handicap_source, handicap_updated_at, driver_carry_yds,
             target_handicap, carry_reference, updated_at)
          values
            (${me.id}::uuid, ${hi}::numeric,
             ${has.hi ? 'self_reported' : null}::text, ${has.hi ? sql`now()` : sql`null`},
             ${p.driver_carry_yds ?? null}::int, ${target}::numeric, ${p.carry_reference ?? null}::text, now())
          on conflict (user_id) do update set
            handicap_index      = case when ${has.hi}::boolean then excluded.handicap_index else player_profile.handicap_index end,
            handicap_source     = case when ${has.hi}::boolean then 'self_reported' else player_profile.handicap_source end,
            handicap_updated_at = case when ${has.hi}::boolean then now() else player_profile.handicap_updated_at end,
            driver_carry_yds    = case when ${has.carry}::boolean then excluded.driver_carry_yds else player_profile.driver_carry_yds end,
            target_handicap     = case when ${has.target}::boolean then excluded.target_handicap else player_profile.target_handicap end,
            carry_reference     = case when ${has.ref}::boolean then excluded.carry_reference else player_profile.carry_reference end,
            updated_at          = now()
          returning handicap_index::float8 as handicap_index, target_handicap::float8 as target_handicap,
                    driver_carry_yds, carry_reference, handicap_source`)
        if (upsert.rowCount !== 1) throw new Refusal(403, { error: 'not_written' })

        // 🔴 A WEEKLY HANDICAP ANSWER ALSO APPENDS. The current value lives on the profile; the TRAIL is
        // handicap_history, and it is the input Atlas's transfer gap reads. `source_app` must be named
        // ('forge' — a restrictive policy pins it and the column has no default); `source` must NOT be
        // (not in the grant; its default is 'self_reported', which is true). A null answer clears the
        // profile value but appends nothing: handicap_index is NOT NULL on the trail.
        let appended = false
        if (has.hi && hi !== null) {
          const h = await db.execute(sql`
            insert into golf.handicap_history (user_id, handicap_index, source_app)
            values (${me.id}::uuid, ${hi}::numeric, 'forge')
            returning id`)
          if (h.rowCount !== 1) throw new Refusal(403, { error: 'not_written' })
          appended = true
        }
        const r = rowsOf(upsert)[0]!
        return {
          profile: {
            handicap_index: num(r.handicap_index),
            target_handicap: num(r.target_handicap),
            driver_carry_yds: num(r.driver_carry_yds),
            carry_reference: (r.carry_reference ?? null) as string | null,
            handicap_source: (r.handicap_source ?? null) as string | null,
          },
          handicap_history_appended: appended,
        }
      })
      res.json(out)
    } catch (err) {
      fail(res, err)
    }
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // PUT /me/schedule
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  const scheduleBody = z
    .object({
      blocks_per_week: z.number().int().min(1).max(7),
      /** The caller's local day, as for the dashboard. */
      today: z.string().optional(),
    })
    .strict()

  forgeRouter.put('/me/schedule', ...identityChain, async (req, res) => {
    const parsed = scheduleBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const today = resolveToday(parsed.data.today)
    if (!today) {
      res.status(400).json({ error: 'invalid_today' })
      return
    }
    const blocks = parsed.data.blocks_per_week
    const me = (req as unknown as { user: Me }).user
    try {
      const out = await withRls(pools.app, ctxOf(me), NO_SCHEMA, async (db) => {
        const existing = rowsOf(
          await db.execute(sql`
            select blocks_per_week from golf.practice_commitment where user_id = ${me.id}::uuid`),
        )[0]

        // WHEN IT TAKES EFFECT. A first-ever commitment starts today; any CHANGE starts next Monday.
        // Applying a lowered target to the week already in progress would let a player at 1 of 5 blocks
        // drop to 1/week and be instantly "on track" — the coach's "behind" flag clearing by edit.
        // The history row is what keeps "were they behind in week N" answerable afterwards; its insert
        // policy (effective_from >= current_date - 1) is the database's own limit on back-dating it.
        const effectiveFrom = existing ? addDays(weekStart(today), 7) : today

        if (existing) {
          const u = await db.execute(sql`
            update golf.practice_commitment set blocks_per_week = ${blocks}::int, updated_at = now()
            where user_id = ${me.id}::uuid`)
          if (u.rowCount !== 1) throw new Refusal(403, { error: 'not_written' })
        } else {
          const i = await db.execute(sql`
            insert into golf.practice_commitment (user_id, blocks_per_week)
            values (${me.id}::uuid, ${blocks}::int)`)
          if (i.rowCount !== 1) throw new Refusal(403, { error: 'not_written' })
        }
        const h = await db.execute(sql`
          insert into golf.practice_commitment_history (user_id, blocks_per_week, effective_from)
          values (${me.id}::uuid, ${blocks}::int, ${effectiveFrom}::date)
          returning id`)
        if (h.rowCount !== 1) throw new Refusal(403, { error: 'not_written' })

        // In force now = latest history row already effective; a change made today is NOT yet.
        const inForce = rowsOf(
          await db.execute(sql`
            select blocks_per_week from golf.practice_commitment_history
            where user_id = ${me.id}::uuid and effective_from <= ${today}::date
            order by effective_from desc, created_at desc, id desc limit 1`),
        )[0]
        return {
          blocks_per_week: inForce ? Number(inForce.blocks_per_week) : null,
          pending: effectiveFrom > today ? { blocks_per_week: blocks, effective_from: effectiveFrom } : null,
        }
      })
      res.json(out)
    } catch (err) {
      fail(res, err)
    }
  })

  return forgeRouter
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Stage 2 of /complete — runs as forge_svc inside withRls(userId = the player).
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate the ladder and stamp assignment completions for ONE completed session, then read back
 * what changed. Safe to run any number of times:
 *
 *   • Every decision is a function of rows that existed BEFORE this session (`completed_at < this`):
 *     the pre-promotion rung comes from the last rung EVENT before it, the consecutive-miss count from
 *     earlier sessions since that event. A replay after later sessions have landed therefore reaches
 *     the SAME decision, rather than judging an old session against a newer ladder.
 *   • The event insert is a BARE `on conflict do nothing`. A NAMED target covers only one of the two
 *     unique indexes (idempotency key, and one-promotion-per-session) and lets the other raise 23505
 *     on a retry. The key is deterministic: session:facet:mode.
 *   • The event and the rung are written in this one transaction, and the rung is set ABSOLUTELY
 *     (`rung = to_rung`) and only when the event insert actually inserted. Never `rung + 1`: a retry
 *     would climb twice. And never rewritten when the event conflicted: a later event may have moved
 *     the rung on, and re-asserting this one would put it back.
 *   • The completion insert is a bare `on conflict do nothing` on (assignment, session).
 *
 * A facet counts toward the ladder only if its stored level equals the pre-promotion rung — so a
 * client that claimed a different level (or a stale one) is harmless here even if it got past the
 * submit check — and only if it is complete, has an index (Makeables: its predictor score; see
 * decideRung), and has a frozen target.
 */
async function evaluateAndReport(db: Db, userId: string, sessionId: string) {
  const sess = rowsOf(
    await db.execute(sql`
      select id, played_on::text as played_on, ${iso('completed_at')} as completed_at
      from golf.range_sessions
      where id = ${sessionId}::uuid and user_id = ${userId}::uuid and completed_at is not null`),
  )[0]
  if (!sess) throw new Refusal(409, { error: 'session_not_completed' })

  /** The session's own completed_at, evaluated by the database — no timestamp round-trips through JS. */
  const sc = sql`(select completed_at from golf.range_sessions where id = ${sessionId}::uuid and user_id = ${userId}::uuid)`

  const facets = rowsOf(
    await db.execute(sql`
      select id, facet, mode, level, is_complete,
             practice_index::float8 as practice_index, predictor_score::float8 as predictor_score,
             target_handicap_at_play::float8 as target
      from golf.facet_scores
      where session_id = ${sessionId}::uuid and user_id = ${userId}::uuid
      order by created_at, id`),
  )

  // THE RUNG AS IT STOOD WHEN THIS SESSION WAS PLAYED, from the one timeline every other reader also
  // uses: the rung row is the CURRENT value, the events are its trail, and the two agree whenever the row
  // is written only with its event (as this file does). Reading the row alone would judge a replayed
  // session against a ladder later sessions have moved; reading events alone would see NOTHING for a
  // player whose rung row was written without one (fixtures, a future backfill) and silently skip every
  // facet. So, in order:
  //   1. the last event BEFORE this session  → its to_rung
  //   2. else the first event AT/AFTER it     → its from_rung  (the rung that event moved off)
  //   3. else the rung row                    → ?? 0 (no event ever touched it)
  const rungAtPlay = new Map<string, number>()
  const preRung = async (rk: { facet: string; mode: string | null }): Promise<number> => {
    const key = `${rk.facet}|${rk.mode ?? ''}`
    const cached = rungAtPlay.get(key)
    if (cached !== undefined) return cached
    const before = rowsOf(
      await db.execute(sql`
        select to_rung from golf.facet_rung_events
        where user_id = ${userId}::uuid and facet = ${rk.facet}::text and mode is not distinct from ${rk.mode}::text
          and occurred_at < ${sc}
        order by occurred_at desc, id desc limit 1`),
    )[0]
    let pre: number
    if (before) {
      pre = Number(before.to_rung)
    } else {
      const after = rowsOf(
        await db.execute(sql`
          select from_rung from golf.facet_rung_events
          where user_id = ${userId}::uuid and facet = ${rk.facet}::text and mode is not distinct from ${rk.mode}::text
            and occurred_at >= ${sc}
          order by occurred_at asc, id asc limit 1`),
      )[0]
      if (after && after.from_rung !== null) {
        pre = Number(after.from_rung)
      } else {
        const row = rowsOf(
          await db.execute(sql`
            select rung from golf.facet_rungs
            where user_id = ${userId}::uuid and facet = ${rk.facet}::text and mode is not distinct from ${rk.mode}::text`),
        )[0]
        pre = row ? Number(row.rung) : 0
      }
    }
    rungAtPlay.set(key, pre)
    return pre
  }

  // ── The ladder ──
  const evaluatedKeys = new Set<string>()
  const levelOk = new Map<string, boolean>() // facet row id → qualifies on level, for the assignment test
  // A facet that is NOT evaluated says why, in the response. An empty `ladder` alone cannot tell "no
  // promotion was due" from "this facet was never looked at", and that difference is the whole point.
  const skipped: { facet: string; mode: string | null; reason: string }[] = []
  for (const f of facets) {
    const rk = rungKeyFor(f.facet as FacetName, f.mode ?? null)
    if (!rk) {
      levelOk.set(f.id, true) // no ladder, no level to compare
      continue
    }
    const pre = await preRung(rk)
    const ok = f.level === pre
    levelOk.set(f.id, ok)
    const key = `${rk.facet}|${rk.mode ?? ''}`
    const skip = (reason: string) => skipped.push({ facet: f.facet as string, mode: (f.mode ?? null) as string | null, reason })
    if (!ok) { skip('level_not_current'); continue }
    if (evaluatedKeys.has(key)) { skip('duplicate_rung_key_in_session'); continue } // approach stock+variable share one rung
    if (rk.facet === 'putting' && !MAKEABLES_LADDER_ENABLED) { skip('makeables_clear_criterion_undefined'); continue }
    const value = f.facet === 'putting' ? f.predictor_score : f.practice_index
    if (!f.is_complete) { skip('provisional'); continue } // provisional counts as neither a clear nor a miss
    if (value === null) { skip('no_score'); continue }
    if (f.target === null) { skip('no_target_handicap'); continue }
    evaluatedKeys.add(key)

    const priors = rowsOf(
      await db.execute(sql`
        select (case when f.facet = 'putting' then f.predictor_score else f.practice_index end)::float8 as v,
               f.target_handicap_at_play::float8 as t
        from golf.facet_scores f
        join golf.range_sessions s on s.id = f.session_id and s.user_id = f.user_id
        where f.user_id = ${userId}::uuid and f.facet = ${rk.facet}::text
          and (${rk.mode}::text is null or f.mode = ${rk.mode}::text)
          and f.is_complete and f.target_handicap_at_play is not null
          and (case when f.facet = 'putting' then f.predictor_score else f.practice_index end) is not null
          and s.completed_at is not null and s.completed_at < ${sc}
          and s.completed_at > coalesce(
                (select max(e.occurred_at) from golf.facet_rung_events e
                  where e.user_id = ${userId}::uuid and e.facet = ${rk.facet}::text
                    and e.mode is not distinct from ${rk.mode}::text and e.occurred_at < ${sc}),
                'epoch'::timestamp)
        order by s.completed_at desc
        limit ${MISSES_TO_DEMOTE - 1}`),
    )
    let priorMisses = 0
    for (const p of priors) {
      if (Number(p.v) > Number(p.t)) priorMisses++
      else break
    }

    const decision = decideRung(pre, value, f.target, priorMisses)
    if (decision.kind === 'none') continue

    const ev = await db.execute(sql`
      insert into golf.facet_rung_events
        (user_id, facet, mode, from_rung, to_rung, session_id, idempotency_key, ladder_version)
      values
        (${userId}::uuid, ${rk.facet}::text, ${rk.mode}::text, ${pre}::int, ${decision.to}::int,
         ${sessionId}::uuid, ${`${sessionId}:${rk.facet}:${rk.mode ?? ''}`}::text, ${LADDER_VERSION}::text)
      on conflict do nothing
      returning id`)
    if (ev.rowCount === 1) {
      const rg = await db.execute(sql`
        insert into golf.facet_rungs (user_id, facet, mode, rung, ladder_version)
        values (${userId}::uuid, ${rk.facet}::text, ${rk.mode}::text, ${decision.to}::int, ${LADDER_VERSION}::text)
        on conflict on constraint facet_rungs_user_facet_mode_uniq do update set
          rung = excluded.rung, ladder_version = excluded.ladder_version, updated_at = now()`)
      if (rg.rowCount !== 1) throw new Error('rung write matched no row') // rolls the event back with it
    }
  }

  // ── Assignment completions: computed from the arriving session, never from a tap ──
  const wk = weekStart(sess.played_on as string)
  const outstanding = rowsOf(
    await db.execute(sql`
      select id, facet, mode, cadence from atlas.assignments
      where subject_user_id = ${userId}::uuid and revoked_at is null
        and (expires_on is null or expires_on >= ${sess.played_on}::date)
        and created_at <= ${sc}`),
  )
  for (const a of outstanding) {
    // Qualifying = matching facet, matching mode when the assignment names one, COMPLETE (§3.4),
    // and played at the player's current rung (§5.3). A provisional score never completes one.
    const qualifies = facets.some(
      (f) => f.facet === a.facet && (a.mode === null || a.mode === f.mode) && f.is_complete && levelOk.get(f.id) === true,
    )
    if (!qualifies) continue
    if (a.cadence === 'week' || a.cadence === 'once') {
      // Satisfied already by an EARLIER session (`completed_at < this`, so a replay judges the same way).
      const prior = rowsOf(
        await db.execute(sql`
          select 1 from atlas.assignment_completions c
          join golf.range_sessions s2 on s2.id = c.session_id and s2.user_id = c.subject_user_id
          where c.assignment_id = ${a.id}::uuid and c.subject_user_id = ${userId}::uuid
            and c.session_id <> ${sessionId}::uuid and s2.completed_at < ${sc}
            and (${a.cadence}::text = 'once' or (c.played_on >= ${wk}::date and c.played_on <= (${wk}::date + 6)))
          limit 1`),
      )
      if (prior.length > 0) continue
    }
    await db.execute(sql`
      insert into atlas.assignment_completions (assignment_id, subject_user_id, session_id, played_on)
      values (${a.id}::uuid, ${userId}::uuid, ${sessionId}::uuid, ${sess.played_on}::date)
      on conflict do nothing`)
  }

  // ── What changed, READ BACK by session id — so a replay returns the same body as the first call ──
  const scoredFacets = rowsOf(
    await db.execute(sql`
      select ${FACET_COLS} from golf.facet_scores f
      where f.session_id = ${sessionId}::uuid and f.user_id = ${userId}::uuid
      order by f.created_at, f.id`),
  )
  const events = rowsOf(
    await db.execute(sql`
      select facet, mode, from_rung, to_rung from golf.facet_rung_events
      where user_id = ${userId}::uuid and session_id = ${sessionId}::uuid order by facet, mode`),
  )
  const done = rowsOf(
    await db.execute(sql`
      select c.assignment_id, a.facet, a.mode, a.cadence, a.source
      from atlas.assignment_completions c
      join atlas.assignments a on a.id = c.assignment_id and a.subject_user_id = c.subject_user_id
      where c.session_id = ${sessionId}::uuid and c.subject_user_id = ${userId}::uuid
      order by a.facet, a.mode`),
  )
  return {
    session: {
      id: sess.id as string,
      played_on: sess.played_on as string,
      completed_at: sess.completed_at as string,
      scoring_version: SCORING_VERSION,
    },
    facets: scoredFacets.map(shapeFacet),
    ladder_skipped: skipped,
    ladder: events.map((e) => ({
      facet: e.facet as string,
      mode: (e.mode ?? null) as string | null,
      from_rung: e.from_rung === null ? null : Number(e.from_rung),
      to_rung: Number(e.to_rung),
      change: Number(e.to_rung) > Number(e.from_rung ?? 0) ? ('promoted' as const) : ('demoted' as const),
    })),
    assignments_completed: done.map((d) => ({
      assignment_id: d.assignment_id as string,
      source: d.source as string,
      facet: d.facet as string,
      mode: (d.mode ?? null) as string | null,
      cadence: d.cadence as string,
    })),
  }
}
