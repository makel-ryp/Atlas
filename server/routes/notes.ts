import { Router, type RequestHandler } from 'express'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, atlasCoachingNotes, NOTE_VISIBILITIES } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'

// Only the tables this router touches — see coach.ts for why a narrower schema object is a
// narrower blast radius, not just a smaller type.
const schema = { users, atlasCoachingNotes }

/**
 * Cookie OR bearer, not bearer alone.
 *
 * These routes are called from Luke's served prototype, which authenticates with the httpOnly
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
  // Coaching notes are prose an adult writes ABOUT a named golfer. If that golfer is an
  // unconsented minor, this is the route that must not work. See ../requireConsent.
  requireConsent(),
]

export const notesRouter = Router()

// Postgres raises 42501 for an RLS WITH CHECK failure (insert refused, not a missing-row 404). A
// raw Postgres error reaching the client would both read badly and disclose schema, so every INSERT
// below translates that one code into a clean 403 — the database still did all the enforcing. No
// route here issues an UPDATE any more (the grant is `update (deleted_at, updated_at)`), so 42501
// can only mean an insert was refused.
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

// The one sentence every refusal below carries, so the three routes cannot drift into three
// different explanations of the same rule.
const APPEND_ONLY_MESSAGE =
  'Coaching notes are an append-only record. A note cannot be edited in place, and a coach cannot ' +
  'retract one. Post a correction as a new note; retraction is an audited administrator action.'

const correctSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
  })
  .strict()

/**
 * PATCH /api/coach/students/:userId/notes/:noteId — REFUSED, always, with 409.
 *
 * atlas_app's grant on atlas.coaching_notes is `update (deleted_at, updated_at)`: a note is
 * append-only BY PRIVILEGE, so an UPDATE that touches `body` or `visibility` raises 42501 before any
 * policy is consulted. This route used to do exactly that update; left as it was it would have
 * answered 403 `not_your_student` — the catch below maps 42501 to that — which is a lie about a
 * note that IS theirs. So it never issues the UPDATE: it says what is true and where to go instead.
 * 409, not 404 — the note exists; it is immutable, which is a different fact from "no such note".
 *
 * Kept as a route rather than deleted so a stale caller gets this explanation instead of Express's
 * generic 404, which would read as "no such note" all over again.
 */
notesRouter.patch(
  '/coach/students/:userId/notes/:noteId',
  ...identityChain,
  (req, res) => {
    res.status(409).json({
      error: 'note_append_only',
      message: APPEND_ONLY_MESSAGE,
      correctWith: `POST /api/coach/students/${req.params.userId}/notes/${req.params.noteId}/correct`,
    })
  },
)

/**
 * POST /api/coach/students/:userId/notes/:noteId/correct
 *
 * A correction is a NEW note; the original stays exactly as it was and stays visible. Both must —
 * "set deleted_at on the old one" would be a coach retracting a note, which this record forbids —
 * so the thread, newest first (GET above), reads as the original followed by what corrected it.
 *
 * Checked before inserting, because the insert's WITH CHECK validates the AUTHOR and the
 * relationship but knows nothing about which note is being corrected:
 *   - The original is read under RLS, so a note the caller cannot see is a 404 and the existence of
 *     other people's notes is not disclosed.
 *   - Its `subject_user_id` is used, never `:userId` from the URL. Taking the URL's value would make
 *     this a POST alias that could land a note on a different student than the one corrected.
 *   - Only the author corrects their own note. Another coach on the team simply posts their own note.
 *   - Visibility defaults to the original's, so a correction of a `private` note does not quietly
 *     become `coaching_team`.
 *
 * ⚠️ THE LINK LIVES ONLY IN THE RESPONSE (`corrects`). atlas.coaching_notes has no column that
 * records which note a later one corrects, so a correction read back from GET is, to the database, an
 * ordinary note. If the UI must render "this corrects that", that needs a `corrects_note_id` column —
 * a schema decision for the eco side, not something to fake here by parsing the body.
 */
notesRouter.post(
  '/coach/students/:userId/notes/:noteId/correct',
  ...identityChain,
  async (req, res, next) => {
    try {
      const parsed = correctSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
        return
      }
      const me = (req as any).user as typeof users.$inferSelect
      const noteId = req.params.noteId as string
      // Lower-cased because Postgres compares uuids case-insensitively and JS does not: an upper-case
      // :userId would match the row in SQL and then 404 on the comparison below — a refusal that lies.
      // Same bug class as routes/admin.ts's own-id guard (verified exploitable 2026-09-03).
      const urlSubjectId = (req.params.userId as string).toLowerCase()
      const { body, visibility } = parsed.data

      const outcome = await withRls(
        pool,
        { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
        schema,
        async (db) => {
          const [original] = await db
            .select()
            .from(atlasCoachingNotes)
            .where(eq(atlasCoachingNotes.id, noteId))
            .limit(1)

          if (!original || original.subjectUserId.toLowerCase() !== urlSubjectId) return { kind: 'missing' as const }
          if (original.authorUserId !== me.id) return { kind: 'not_author' as const }
          if (original.deletedAt) return { kind: 'retracted' as const }

          const [created] = await db
            .insert(atlasCoachingNotes)
            .values({
              subjectUserId: original.subjectUserId,
              authorUserId: me.id,
              body,
              visibility: visibility ?? original.visibility,
            })
            .returning()
          return { kind: 'created' as const, created }
        },
      )

      switch (outcome.kind) {
        case 'missing':
          res.status(404).json({ error: 'note_not_found' })
          return
        case 'not_author':
          res.status(403).json({ error: 'not_your_note' })
          return
        case 'retracted':
          res.status(409).json({
            error: 'note_retracted',
            message: 'That note has been retracted, so there is nothing left to correct.',
          })
          return
        case 'created':
          res.json({ ...outcome.created, corrects: noteId })
      }
    } catch (err) {
      // With no UPDATE issued anywhere above, 42501 can only come from the INSERT's WITH CHECK —
      // author or approved-relationship failed — so "not your student" is the true reading here.
      if ((err as { code?: string }).code === RLS_VIOLATION) {
        res.status(403).json({ error: 'not_your_student' })
        return
      }
      next(err)
    }
  },
)

/**
 * DELETE /api/coach/students/:userId/notes/:noteId — a coach may NOT retract a note. 409.
 *
 * The decision (2026-10-06): the record is append-only and only an admin may retract, through an
 * audited path (public.admin_audit row, bypass write) that belongs in routes/admin.ts, not here.
 * This route used to soft-delete, and a refused soft-delete matched zero rows and was reported as
 * 404 note_not_found — which says "no such note" about a note that exists. It must say what is true.
 *
 * ⚠️ DELIBERATELY NO UPDATE IS ATTEMPTED, even though the author-only UPDATE policy may still admit
 * a `deleted_at` write from the note's author. The grant decides which COLUMNS; only a policy can
 * decide which PRINCIPAL — the grant permits the column, the policy decides who may write it — and
 * that policy is eco's to write. Trying the UPDATE and
 * reading a successful row back as "allowed" would let this route's behaviour depend on a policy
 * that may not exist yet. The rule is stated here AND enforced there; neither is the backstop for
 * the other.
 *
 * The note is looked up under RLS first, so an invisible id is still a 404 — not a 409 that would
 * confirm a note exists to someone who cannot see it.
 */
notesRouter.delete(
  '/coach/students/:userId/notes/:noteId',
  ...identityChain,
  async (req, res, next) => {
    try {
      const me = (req as any).user as typeof users.$inferSelect
      const noteId = req.params.noteId as string

      const [visible] = await withRls(
        pool,
        { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
        schema,
        (db) =>
          db
            .select({ id: atlasCoachingNotes.id })
            .from(atlasCoachingNotes)
            .where(eq(atlasCoachingNotes.id, noteId))
            .limit(1),
      )

      if (!visible) {
        res.status(404).json({ error: 'note_not_found' })
        return
      }
      res.status(409).json({ error: 'note_append_only', message: APPEND_ONLY_MESSAGE })
    } catch (err) {
      next(err)
    }
  },
)
