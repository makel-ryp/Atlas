import { Router, type RequestHandler } from 'express'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, atlasCoachingNotes, NOTE_VISIBILITIES } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

// Only the tables this router touches — see coach.ts for why a narrower schema object is a
// narrower blast radius, not just a smaller type.
const schema = { users, atlasCoachingNotes }

/**
 * Cookie OR bearer, not bearer alone.
 *
 * These four routes are called from Luke's served prototype, which authenticates with the httpOnly
 * session cookie — a browser navigation cannot carry an Authorization header. Bearer-only here
 * would return 401 for every note written from the only surface a coach actually writes notes on,
 * with a correct URL and a correct body. That is not hypothetical: it is precisely the bug that
 * shipped on the drill sign-off on 2026-09-01. See ../cookieOrBearer.
 */
const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
]

export const notesRouter = Router()

// Postgres raises 42501 for an RLS WITH CHECK failure (insert refused, not a missing-row 404). A
// raw Postgres error reaching the client would both read badly and disclose schema, so every write
// below translates that one code into a clean 403 — the database still did all the enforcing.
const RLS_VIOLATION = '42501'

/**
 * GET /api/coach/students/:userId/notes
 *
 * Deliberately no visibility or relationship filter in this query — atlas.coaching_notes_select
 * already restricts the rows to: notes the caller authored, notes on a student they coach (when
 * visibility is coaching_team/shared), and notes about the caller (when visibility is shared).
 * Re-deriving that here is how the app layer and the database start disagreeing.
 */
notesRouter.get('/coach/students/:userId/notes', ...identityChain, async (req, res, next) => {
  try {
    const me = (req as any).user as typeof users.$inferSelect
    const subjectUserId = req.params.userId as string

    const notes = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db
          .select({
            id: atlasCoachingNotes.id,
            subjectUserId: atlasCoachingNotes.subjectUserId,
            authorUserId: atlasCoachingNotes.authorUserId,
            authorDisplayName: users.displayName,
            body: atlasCoachingNotes.body,
            visibility: atlasCoachingNotes.visibility,
            createdAt: atlasCoachingNotes.createdAt,
          })
          .from(atlasCoachingNotes)
          .leftJoin(users, eq(users.id, atlasCoachingNotes.authorUserId))
          .where(
            and(
              eq(atlasCoachingNotes.subjectUserId, subjectUserId),
              isNull(atlasCoachingNotes.deletedAt),
            ),
          )
          .orderBy(desc(atlasCoachingNotes.createdAt)),
    )

    res.json(notes)
  } catch (err) {
    next(err)
  }
})

const createSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .strict()

/**
 * POST /api/coach/students/:userId/notes
 *
 * The insert is permitted only when author_user_id = the caller AND the caller has an APPROVED
 * coaching relationship to the subject — atlas.coaching_notes_insert enforces both, so a note about
 * a pending student is refused by the database, not by an `if` in here.
 */
notesRouter.post('/coach/students/:userId/notes', ...identityChain, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    const subjectUserId = req.params.userId as string
    const { body, visibility } = parsed.data

    const [created] = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db
          .insert(atlasCoachingNotes)
          .values({
            subjectUserId,
            authorUserId: me.id,
            body,
            visibility: visibility ?? 'coaching_team',
          })
          .returning(),
    )

    res.json(created)
  } catch (err) {
    if ((err as { code?: string }).code === RLS_VIOLATION) {
      res.status(403).json({ error: 'not_your_student' })
      return
    }
    next(err)
  }
})

const patchSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict()

/**
 * PATCH /api/coach/students/:userId/notes/:noteId
 *
 * atlas.coaching_notes_update is author-only, so a non-author's UPDATE matches zero rows and
 * commits without raising — Postgres does not distinguish "no such row" from "row filtered out by
 * policy". "No error" here is not "it worked", so an empty RETURNING is treated as 404, not 200.
 */
notesRouter.patch(
  '/coach/students/:userId/notes/:noteId',
  ...identityChain,
  async (req, res, next) => {
    try {
      const parsed = patchSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const { body, visibility } = parsed.data
      if (body === undefined && visibility === undefined) {
        res.status(400).json({ error: 'empty_update' })
        return
      }
      const me = (req as any).user as typeof users.$inferSelect
      const noteId = req.params.noteId as string

      const [updated] = await withRls(
        pool,
        { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
        schema,
        (db) =>
          db
            .update(atlasCoachingNotes)
            .set({
              ...(body !== undefined ? { body } : {}),
              ...(visibility !== undefined ? { visibility } : {}),
              updatedAt: new Date(),
            })
            .where(eq(atlasCoachingNotes.id, noteId))
            .returning(),
      )

      if (!updated) {
        res.status(404).json({ error: 'note_not_found' })
        return
      }
      res.json(updated)
    } catch (err) {
      if ((err as { code?: string }).code === RLS_VIOLATION) {
        res.status(403).json({ error: 'not_your_student' })
        return
      }
      next(err)
    }
  },
)

/**
 * DELETE /api/coach/students/:userId/notes/:noteId — soft delete, since atlas_app holds no delete
 * grant. Same author-only-via-policy reasoning as PATCH: zero rows back means "not yours", so it is
 * a 404, not a silent no-op reported as success.
 */
notesRouter.delete(
  '/coach/students/:userId/notes/:noteId',
  ...identityChain,
  async (req, res, next) => {
    try {
      const me = (req as any).user as typeof users.$inferSelect
      const noteId = req.params.noteId as string

      const [deleted] = await withRls(
        pool,
        { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
        schema,
        (db) =>
          db
            .update(atlasCoachingNotes)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(atlasCoachingNotes.id, noteId))
            .returning(),
      )

      if (!deleted) {
        res.status(404).json({ error: 'note_not_found' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      if ((err as { code?: string }).code === RLS_VIOLATION) {
        res.status(403).json({ error: 'not_your_student' })
        return
      }
      next(err)
    }
  },
)
