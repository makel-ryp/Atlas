import { Router, type RequestHandler } from 'express'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { verifyToken, attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
// ⚠️ SCHEMA DEPENDENCY NOT YET PUBLISHED — see the block comment below. `atlasIntakeSubmissions`
// does not exist in @ryp/eco@0.15.0 (the version this repo is pinned to, verified by grepping the
// installed dist for "intake": zero hits, and by `git log` in ~/dev/ATR/eco showing no commit for
// it). This import is written against the table the db lane is building from the same spec this
// route was scoped from. It will not resolve — and `npm run typecheck` will fail on this line
// specifically — until: (1) db lane adds `atlas.intake_submissions` to eco/src/schema, (2) eco cuts
// a new tag, (3) this repo's package.json is bumped to it and reinstalled. Steps 2-3 are outside
// this route's fence (server/routes/intake.ts + a mount line in server/index.ts only).
import { users, golfPlayerProfile, golfHandicapHistory, atlasIntakeSubmissions } from '@ryp/eco/schema'
import { pool } from '../db'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { PROFILE_FIELDS, ITEM_BY_CODE, type Profile, type Answers, type AnswerValue } from '../../shared/practice-dna/items'
import { computeResult, type PracticeDnaResult } from '../../shared/practice-dna/scoring'
import { computeVolumeBreakdown } from '../../shared/volume'
// The instrument's own version constants, stamped onto every run. Imported from the copied
// instrument so they can never drift from the scoring that actually ran.
import { CONFIG_VERSION, SCORING_VERSION, RESULT_VERSION } from '../../shared/practice-dna/config'

/**
 * ASSUMED SHAPE of `atlas.intake_submissions` — this route is written against it, not the other
 * way around. Documented here so the db lane can diff against what this route actually needs
 * rather than guessing from the goal doc a second time.
 *
 *   id             uuid, pk
 *   user_id        uuid, NOT NULL, references public.users(id), UNIQUE — "one submission per
 *                  user: resume rather than create a second" is enforced by this constraint, not
 *                  just app-level find-then-insert (which would still race across two tabs).
 *   profile        jsonb, NOT NULL default '{}' — a Partial<Profile>. All-or-nothing is a PRODUCT
 *                  fact observed in the live data (7/7 fields on every scored profile), not a DB
 *                  constraint; the column itself tolerates partial writes so a resume mid-form
 *                  doesn't lose earlier answers.
 *   answers        jsonb, NOT NULL default '{}' — an Answers (Record<string, AnswerValue>). Every
 *                  item the lifted instrument scores lives here by code, INCLUDING the alloc slider
 *                  (code 'ALLOC') and the volume stepper (code 'FREQ01') — see the note on the PATCH
 *                  handler below for why "volume" and "alloc" are not separate columns.
 *   tier_completed integer, NOT NULL default 0 — 0..4, mirrors the live funnel's counter.
 *   status         text, NOT NULL default 'in_progress' — 'in_progress' | 'completed'.
 *   quality_flag   boolean, NOT NULL default false — ⚠️ NEVER read by this route into a response.
 *   completed_at   timestamp, nullable.
 *   created_at     timestamp, default now().
 *   updated_at     timestamp, default now().
 *
 * Deliberately NOT modeled as separate `volume` / `alloc` jsonb columns even though the goal doc
 * names four PATCH "kinds" (profile | volume | alloc | answers). Read against the actual lifted
 * instrument (shared/practice-dna/items.ts): the alloc slider is item code 'ALLOC' (type 'alloc')
 * and the practice-frequency question is item code 'FREQ01' (type 'stepper') — both are ordinary
 * entries in the SAME `answers: Record<string, AnswerValue>` map as every likert item. tgt's own
 * `VolumeInput`/`AllocInput` types (practiceMinutes/courseHours, a "messy" fifth segment) live in
 * tgt's `shared/contract.ts`, which the lift explicitly did NOT copy — so those are tgt-product
 * concepts, not instrument concepts, and inventing a matching pair of columns here would be forking
 * a screen's-worth of app logic into the shared table. "volume" and "alloc" are kept as CLIENT-
 * FACING SAVE KINDS below (so ui-engineer's four screens map 1:1 onto four small, targeted request
 * bodies) but they write into the same two real columns as "profile" and "answers".
 */
const schema = { users, golfPlayerProfile, golfHandicapHistory, atlasIntakeSubmissions }

const identityChain: RequestHandler[] = [
  verifyToken,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
]

export const intakeRouter = Router()

// Postgres 42501 = an RLS WITH CHECK failure. Translate it to a clean 403 rather than let a raw
// Postgres error string (which names the policy and the schema) reach the client. Every insert user
// data is always written as the caller's OWN userId — from req.user, never from the body — so this
// should be unreachable in normal use; it stays here as the same defense-in-depth every other
// mutating route in this repo keeps (see notes.ts), not as the primary gate. The database is the
// real gate.
const RLS_VIOLATION = '42501'

// ── shared response projection ──────────────────────────────────────────────────────────────────
// Never `select *` — and specifically NEVER include quality_flag. The live design keeps it
// invisible to the golfer; it is an internal signal about the run's data quality, not a datum
// about the golfer.
type SubmissionRow = typeof atlasIntakeSubmissions.$inferSelect

function isProfileComplete(profile: Record<string, unknown>): profile is Record<string, unknown> & Profile {
  return PROFILE_FIELDS.every((f) => profile[f.code] !== undefined && profile[f.code] !== null && profile[f.code] !== '')
}

// Recompute, never store — the whole point being that a run scored today survives the instrument
// changing later. Only attempted once the profile is fully filled in: the live data shows the
// profile block is observed ALL-OR-NOTHING (7/7 fields on every scored profile in 110/118 runs), and
// computeResult takes a `Profile`, not a `Partial<Profile>` — calling it against a partial object
// would silently score against `undefined` fields rather than refuse.
/**
 * Scores a run. `volume` and `alloc` are the RAW inputs; the engine wants shares of effective total,
 * which only the volume adapter can produce — so ALLOC is derived HERE, into a copy, and never
 * persisted. Mirrors `tgt/server/service.ts:180-191` deliberately.
 *
 * ⚠️ An earlier version of this route stored a CLIENT-computed ALLOC into `answers`, the column eco
 * calls "the re-score lifeline — every raw item response". That put a derived, client-produced value
 * in the raw column with no provenance, and dropped the raw minutes/hours entirely, so a run could
 * never be re-scored after the adapter changed. Raw goes in `volume`/`alloc`; derived is computed on
 * every read.
 */
function tryComputeResult(
  profile: unknown,
  answers: unknown,
  volume?: unknown,
  alloc?: unknown,
): PracticeDnaResult | null {
  const p = (profile ?? {}) as Record<string, unknown>
  const a = { ...((answers ?? {}) as Answers) }
  if (!isProfileComplete(p)) return null
  try {
    if (volume && alloc) {
      a.ALLOC = computeVolumeBreakdown(volume as never, alloc as never).alloc
    }
    return computeResult(p as unknown as Profile, a)
  } catch {
    // Scoring is defensive by design (Confidence grades partial `answers`), but a malformed stored
    // value should read as "not scoreable yet", not crash the request that's just trying to show
    // progress.
    return null
  }
}

function toEnvelope(row: SubmissionRow) {
  return {
    id: row.id,
    tierCompleted: row.tierCompleted,
    status: row.status,
    profile: row.profile ?? {},
    answers: row.answers ?? {},
    // The golfer's OWN saved answers for the two screens that write dedicated columns rather than
    // into `answers`. Omitting them made every PATCH look like a silent no-op from the client's
    // side — the write landed, the read-back never showed it — so a resumed run rendered its
    // volume and allocation screens blank. Safe to return: this is the subject's own input, unlike
    // quality_flag, which stays server-side. (Caught by the smoke suite 2026-09-01.)
    volume: row.volume ?? null,
    alloc: row.alloc ?? null,
    completedAt: row.completedAt,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    result: tryComputeResult(row.profile, row.answers, row.volume, row.alloc),
  }
}

// ── PROFILE value validation, sourced from PROFILE_FIELDS (items.ts) — one place, not re-typed ──
const profileFieldByCode = new Map(PROFILE_FIELDS.map((f) => [f.code, f]))

// `field.kind` ('number' | 'select') is a RENDER hint from PROFILE_FIELDS, not the wire type — and
// the two disagree for exactly one field. `interface Profile` types PRO_AGE as `number` but
// PRO_SPEED as `string`, even though both carry `kind: 'number'`. Confirmed against tgt's own
// ProfileStage.tsx submit mapping: `PRO_AGE: Number(finalDraft.PRO_AGE) || 0` (a real number) vs
// `PRO_SPEED: finalDraft.PRO_SPEED ?? ''` (the raw string, never coerced). A validator keyed only on
// `kind` would either reject the number PRO_AGE really is sent as, or accept a JS number for
// PRO_SPEED and store the wrong wire type into jsonb, which computeResult's `as Profile` cast would
// then silently trust. So PRO_AGE is checked as a number; every other 'number'-kind field
// (currently just PRO_SPEED) is checked as a numeric STRING, matching what is actually sent and
// what `Profile` actually declares.
const NUMERIC_WIRE_FIELDS = new Set(['PRO_AGE'])

// The two handicap fields carry an `options` list that is a PICKER SUGGESTION, not a vocabulary.
// PROFILE_FIELDS types them as `select` with options ['0'…'54', "I don't have one"] — whole numbers
// — but a handicap index is a decimal, and plus handicaps are negative and written with a leading
// '+'. The lifted UI renders both as a FREE TEXT box whose own placeholder reads
// "8.4 — plus side: +2.1", and the instrument's own fixtures use '11.2' and '12.0'
// (tgt/server/{service,email,ai-read,routes}.test.ts).
//
// Decisive: tgt's own validator (tgt/server/validation.ts:79-88) checks select fields as
// `z.string().trim().min(1).max(40)` and NEVER tests membership in `options`. This route was
// stricter than the instrument it ports, and that strictness rejected every real handicap — the
// seeded demo players are 4.2 and 17.8, so the intake 400'd for both of them on the last screen.
// (Found by driving the quiz in a browser, 2026-09-01.)
//
// Membership IS still enforced for every other select, because those vocabularies really are
// closed and the UI renders them as buttons: PRO_HAND, PRO_SHAPE, PRO_SHAPE_PREF.
const HANDICAP_FIELDS = new Set(['PRO_HCP_NOW', 'PRO_HCP_3YR'])

// '4.2', '17.8', '0', '+2.1', '54'. Two decimal places tolerated; the governing bodies publish one.
const HANDICAP_PATTERN = /^\+?\d{1,2}(\.\d{1,2})?$/

function validateProfilePartial(input: Record<string, unknown>): string | null {
  for (const [code, value] of Object.entries(input)) {
    const field = profileFieldByCode.get(code)
    if (!field) return `unknown_profile_field:${code}`
    if (field.kind === 'number' && NUMERIC_WIRE_FIELDS.has(code)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `invalid_profile_value:${code}`
      if (field.min !== undefined && value < field.min) return `invalid_profile_value:${code}`
      if (field.max !== undefined && value > field.max) return `invalid_profile_value:${code}`
    } else if (field.kind === 'number') {
      // Numeric-but-string-typed (PRO_SPEED): a numeric string, bounds-checked as a number,
      // stored as a string.
      if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return `invalid_profile_value:${code}`
      const n = Number(value)
      if (!Number.isFinite(n)) return `invalid_profile_value:${code}`
      if (field.min !== undefined && n < field.min) return `invalid_profile_value:${code}`
      if (field.max !== undefined && n > field.max) return `invalid_profile_value:${code}`
    } else if (HANDICAP_FIELDS.has(code)) {
      // A sentinel from the options list ("I don't have one", "Wasn't playing", …) OR a real
      // handicap index. See the note on HANDICAP_FIELDS above.
      if (typeof value !== 'string') return `invalid_profile_value:${code}`
      const v = value.trim()
      if (field.options?.includes(v)) continue
      if (!HANDICAP_PATTERN.test(v)) return `invalid_profile_value:${code}`
      // A '+' prefix means BETTER than scratch, so it reads as a negative index.
      const n = v.startsWith('+') ? -Number(v.slice(1)) : Number(v)
      if (!Number.isFinite(n) || n < -10 || n > 54) return `invalid_profile_value:${code}`
    } else {
      // 'select' with a genuinely closed vocabulary — the UI renders these as buttons, so anything
      // off the list did not come from the product.
      if (typeof value !== 'string' || (field.options && !field.options.includes(value))) {
        return `invalid_profile_value:${code}`
      }
    }
  }
  return null
}

// ── ANSWERS value validation, sourced from ITEM_BY_CODE (items.ts) ──────────────────────────────
function isAllocValue(v: unknown): v is { construction: number; calibration: number; transfer: number; performance: number } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const keys = ['construction', 'calibration', 'transfer', 'performance']
  // Each share bounded 0..100 and NO SUM CONSTRAINT — copied from the instrument's own authority,
  // `tgt/server/validation.ts:23-29`, not inferred.
  //
  // ⚠️ An earlier version here required the four to sum to 99..101 "because the spec says sum to
  // 100". The spec says no such thing and the shares legitimately do not sum to 100: the allocation
  // is DERIVED by the volume adapter from practice time, and time spent in the Messy Middle is
  // counted in none of the four zones. With `messy: 20` the adapter returns a total of 83.33, and
  // TGT's own conformance fixture stores {25, 12.5, 0, 50} = 87.5. That rule would have rejected
  // every golfer who reported any messy time — a 400 on the most common answer.
  return keys.every((k) => {
    const n = o[k]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
  })
}

function validateAnswersPartial(input: Record<string, unknown>): string | null {
  for (const [code, value] of Object.entries(input)) {
    const item = ITEM_BY_CODE.get(code)
    if (!item) return `unknown_item_code:${code}`
    if (item.type === 'alloc') {
      if (!isAllocValue(value)) return `invalid_answer_value:${code}`
    } else if (item.type === 'stepper') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 7) {
        return `invalid_answer_value:${code}`
      }
    } else {
      // likert / sliderCheck / bipolar — instrument's stored scale is 0-100
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        return `invalid_answer_value:${code}`
      }
    }
  }
  return null
}

/**
 * POST /api/intake/start
 *
 * Creates this user's submission, or resumes the existing one — never a second row. Race-safe
 * against two concurrent "start" calls (e.g. two tabs) via onConflictDoNothing rather than a
 * check-then-insert, which would still race.
 */
intakeRouter.post('/intake/start', ...identityChain, async (req, res, next) => {
  try {
    const bodySchema = z.object({}).strict()
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect

    const row = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        // ⚠️ RAW SQL ON PURPOSE — do not "clean this up" back into db.insert(). Drizzle names
        // EVERY column of the table in an INSERT, passing `default` for the ones you did not set:
        //
        //   insert into atlas.intake_submissions
        //     ("id","user_id",...,"quality_flag","started_at",...,"deleted_at")
        //   values (default,$1,...,default,default,...,default)
        //
        // `atlas_app` holds COLUMN-LEVEL insert on 15 of the 18 columns. quality_flag, started_at
        // and deleted_at are withheld deliberately — a client must not be able to set its own
        // quality flag, backdate a run, or soft-delete on insert. Postgres requires the INSERT
        // privilege on every column a statement NAMES, even where the value is `DEFAULT`, so
        // drizzle's form is refused with 42501 "permission denied for table intake_submissions",
        // which reads exactly like an RLS failure and is not one. (Observed 2026-08-31; it is what
        // made every call to this endpoint 403 without ever reaching the database's row check.)
        //
        // Naming only the four granted columns keeps the grant model as the real gate rather than
        // widening it to make an ORM convenience work.
        await db.execute(sql`
          insert into atlas.intake_submissions
            (user_id, config_version, scoring_version, result_version)
          values
            (${me.id}, ${CONFIG_VERSION}, ${SCORING_VERSION}, ${RESULT_VERSION})
          on conflict (user_id, instrument) do nothing
        `)
        // Read back through drizzle so the caller gets the typed, camel-cased row either way — a
        // fresh insert and a resumed run take the identical path, and the conflict case needs this
        // select regardless. Both statements run inside the one withRls transaction, so the row is
        // still subject to the SELECT policy: if RLS would not show it to this user, this returns
        // undefined and the caller 500s rather than silently handing back someone else's run.
        return await db.query.atlasIntakeSubmissions.findFirst({
          where: eq(atlasIntakeSubmissions.userId, me.id),
        })
      },
    )

    if (!row) {
      // Only reachable if the conflict-target insert AND the follow-up select both miss, which
      // should not happen inside one transaction — but "no error" is not "it worked" (AGENT-BRIEF
      // §8), so this is surfaced rather than silently returning an empty 200.
      res.status(500).json({ error: 'submission_not_created' })
      return
    }
    res.json(toEnvelope(row))
  } catch (err) {
    if ((err as { code?: string }).code === RLS_VIOLATION) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    next(err)
  }
})

/**
 * PATCH /api/intake/:id
 *
 * `kind` selects which of the four client screens is saving (profile | volume | alloc | answers).
 * "volume" and "alloc" are validated and merged exactly like "answers" — see the ASSUMED SHAPE
 * comment above for why there are only two real destination columns, not four.
 *
 * `tierCompleted`, if present, only ever moves FORWARD (max of stored and provided) — a client
 * re-saving an earlier tier (e.g. "Back") must not regress funnel progress that a later save
 * already recorded.
 */
const patchBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile'), profile: z.record(z.string(), z.unknown()), tierCompleted: z.number().int().min(0).max(4).optional() }).strict(),
  // `volume` carries the RAW inputs (practice minutes, course hours, messy time) — the client sends
  // `volume`, and an earlier version of this line demanded `answers`, so every volume save 400'd on
  // `.strict()` before validation even ran.
  z.object({ kind: z.literal('volume'), volume: z.record(z.string(), z.unknown()), tierCompleted: z.number().int().min(0).max(4).optional() }).strict(),
  z.object({ kind: z.literal('alloc'), alloc: z.record(z.string(), z.unknown()), tierCompleted: z.number().int().min(0).max(4).optional() }).strict(),
  z.object({ kind: z.literal('answers'), answers: z.record(z.string(), z.unknown()), tierCompleted: z.number().int().min(0).max(4).optional() }).strict(),
])

intakeRouter.patch('/intake/:id', ...identityChain, async (req, res, next) => {
  try {
    const parsed = patchBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const body = parsed.data
    const me = (req as any).user as typeof users.$inferSelect
    const submissionId = req.params.id as string

    // Domain validation against the instrument's own metadata, not a re-typed zod schema — one
    // source of truth for "what is a legal answer" (see PROFILE_FIELDS / ITEM_BY_CODE above).
    let profilePatch: Record<string, unknown> | undefined
    let answersPatch: Record<string, unknown> | undefined
    // Raw inputs get their own columns. They are NOT merged into `answers` — see tryComputeResult.
    let volumePatch: Record<string, unknown> | undefined
    let allocPatch: Record<string, unknown> | undefined
    if (body.kind === 'profile') {
      const err = validateProfilePartial(body.profile)
      if (err) {
        res.status(400).json({ error: err })
        return
      }
      profilePatch = body.profile
    } else if (body.kind === 'alloc') {
      if (!isAllocValue(body.alloc)) {
        res.status(400).json({ error: 'invalid_answer_value:ALLOC' })
        return
      }
      // The RAW alloc column — not answers. The engine's ALLOC is derived from this at score time.
      allocPatch = body.alloc
    } else if (body.kind === 'volume') {
      // Raw practice minutes / course hours / messy time. Stored as given so the run stays
      // re-scoreable if the volume adapter changes.
      volumePatch = body.volume
    } else {
      const err = validateAnswersPartial(body.answers)
      if (err) {
        res.status(400).json({ error: err })
        return
      }
      answersPatch = body.answers
    }

    const updated = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        // Read-then-merge-then-write inside this one transaction. Two concurrent PATCHes from the
        // SAME user (e.g. two tabs) can still interleave — jsonb has no server-side merge helper
        // in this route without dropping to raw SQL, and that race is a narrow, self-inflicted edge
        // case (a user racing their own two tabs), not a cross-user integrity issue. Flagging
        // rather than silently declaring it solved.
        const current = await db.query.atlasIntakeSubmissions.findFirst({
          where: and(eq(atlasIntakeSubmissions.id, submissionId), eq(atlasIntakeSubmissions.userId, me.id)),
        })
        if (!current) return undefined

        const nextProfile = profilePatch ? { ...(current.profile as object ?? {}), ...profilePatch } : current.profile
        const nextAnswers = answersPatch ? { ...(current.answers as object ?? {}), ...answersPatch } : current.answers
        const nextVolume = volumePatch ? { ...(current.volume as object ?? {}), ...volumePatch } : current.volume
        const nextAlloc = allocPatch ? { ...(current.alloc as object ?? {}), ...allocPatch } : current.alloc
        const nextTier =
          body.tierCompleted !== undefined ? Math.max(current.tierCompleted ?? 0, body.tierCompleted) : current.tierCompleted

        const [row] = await db
          .update(atlasIntakeSubmissions)
          .set({
            profile: nextProfile,
            answers: nextAnswers,
            volume: nextVolume,
            alloc: nextAlloc,
            tierCompleted: nextTier,
            updatedAt: new Date(),
          })
          .where(and(eq(atlasIntakeSubmissions.id, submissionId), eq(atlasIntakeSubmissions.userId, me.id)))
          .returning()
        return row
      },
    )

    // An RLS-filtered UPDATE matches 0 rows SILENTLY — no exception. The `and(id, userId)` guard
    // above means "0 rows" covers both "no such id" and "not yours"; both are a 404 to the caller,
    // not a 200 that did nothing (AGENT-BRIEF §8 / the note on RLS-filtered updates).
    if (!updated) {
      res.status(404).json({ error: 'submission_not_found' })
      return
    }
    res.json(toEnvelope(updated))
  } catch (err) {
    if ((err as { code?: string }).code === RLS_VIOLATION) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    next(err)
  }
})

/**
 * POST /api/intake/:id/complete
 *
 * Marks the submission complete and reconciles into `golf.player_profile` (+ a
 * `golf.handicap_history` row) — the shared truth layer other apps read. Idempotent: calling it
 * again on an already-completed submission is a no-op that returns the current state, rather than
 * writing a second handicap_history row for a double-click or a retried request.
 *
 * Gated on a complete profile (400 `profile_incomplete` otherwise) — reconciliation has nothing
 * to write without it, and the live data shows the profile block is all-or-nothing in practice, so
 * this is enforcing an observed invariant, not inventing a new rule. It does NOT gate on how much
 * of `answers` is filled in: the live funnel shows most runs stall before Tier 3, and completion of
 * the ACCOUNT-CREATION intake is a product decision the client makes, not something this route
 * should second-guess by requiring every tier.
 *
 * Only two of the seven profile fields have a home in the shared schema today: PRO_HAND →
 * `golf.player_profile.handedness`, PRO_HCP_NOW → `golf.player_profile.handicapIndex` (only when it
 * parses as a number — "I don't have one" is a real answer, not a handicap) plus a
 * `golf.handicap_history` row (source 'self_reported'). PRO_AGE, PRO_SPEED, PRO_HCP_3YR, PRO_SHAPE,
 * PRO_SHAPE_PREF have no shared-schema column yet and are left only in `atlas.intake_submissions`.
 * PRO_SPEED (driver clubhead speed, mph) is deliberately NOT written to `driverCarryYds` (driver
 * carry distance, yards) — same club, different metric, different units; conflating them is exactly
 * the "two metrics with one name" trap AGENT-BRIEF §4 warns about. `driverCarryYds`/`ghinNumber`
 * are left untouched (no source for them here) rather than nulled out on upsert.
 */
intakeRouter.post('/intake/:id/complete', ...identityChain, async (req, res, next) => {
  try {
    const bodySchema = z.object({}).strict()
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    const submissionId = req.params.id as string

    const outcome = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        const current = await db.query.atlasIntakeSubmissions.findFirst({
          where: and(eq(atlasIntakeSubmissions.id, submissionId), eq(atlasIntakeSubmissions.userId, me.id)),
        })
        if (!current) return { kind: 'not_found' as const }

        if (current.status === 'completed') {
          return { kind: 'ok' as const, row: current }
        }

        const profile = (current.profile as Record<string, unknown>) ?? {}
        if (!isProfileComplete(profile)) {
          return { kind: 'incomplete' as const }
        }

        const [row] = await db
          .update(atlasIntakeSubmissions)
          .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(atlasIntakeSubmissions.id, submissionId), eq(atlasIntakeSubmissions.userId, me.id)))
          .returning()
        if (!row) return { kind: 'not_found' as const }

        // ── reconciliation into the shared golf truth layer ──
        const profileValues: Partial<typeof golfPlayerProfile.$inferInsert> = {}
        const hand = profile.PRO_HAND
        if (hand === 'Right') profileValues.handedness = 'right'
        else if (hand === 'Left') profileValues.handedness = 'left'

        const hcpNow = profile.PRO_HCP_NOW
        const hcpNumeric = typeof hcpNow === 'string' && /^\d+(\.\d+)?$/.test(hcpNow) ? Number(hcpNow) : null
        if (hcpNumeric !== null) {
          profileValues.handicapIndex = String(hcpNumeric)
        }

        await db
          .insert(golfPlayerProfile)
          .values({ userId: me.id, ...profileValues })
          .onConflictDoUpdate({
            target: golfPlayerProfile.userId,
            set: { ...profileValues, updatedAt: new Date() },
          })

        if (hcpNumeric !== null) {
          await db.insert(golfHandicapHistory).values({
            userId: me.id,
            handicapIndex: String(hcpNumeric),
            source: 'self_reported',
          })
        }

        return { kind: 'ok' as const, row }
      },
    )

    if (outcome.kind === 'not_found') {
      res.status(404).json({ error: 'submission_not_found' })
      return
    }
    if (outcome.kind === 'incomplete') {
      res.status(400).json({ error: 'profile_incomplete' })
      return
    }
    res.json(toEnvelope(outcome.row))
  } catch (err) {
    if ((err as { code?: string }).code === RLS_VIOLATION) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    next(err)
  }
})

/**
 * GET /api/intake/me
 *
 * 404s if this user has never started an intake — nothing to resume, and that is a different
 * state from "started but empty" (which POST /start would have created a row for).
 */
intakeRouter.get('/intake/me', ...identityChain, async (req, res, next) => {
  try {
    const me = (req as any).user as typeof users.$inferSelect

    const row = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      (db) => db.query.atlasIntakeSubmissions.findFirst({ where: eq(atlasIntakeSubmissions.userId, me.id) }),
    )

    if (!row) {
      res.status(404).json({ error: 'submission_not_found' })
      return
    }
    res.json(toEnvelope(row))
  } catch (err) {
    next(err)
  }
})
