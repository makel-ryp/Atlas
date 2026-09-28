import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { attachUser, requireApp } from '@ryp/eco/auth'
import { withRls } from '@ryp/eco/db'
import { users, atlasMessages } from '@ryp/eco/schema'
import { pool } from '../db'
import { cookieOrBearer } from '../cookieOrBearer'
import { requireConsent } from '../requireConsent'
import { ensureAtlasAccess } from '../ensureAtlasAccess'
import { consentStateFor, isMinor } from '../../shared/consent'

/**
 * THE COACH ⇄ GOLFER THREAD.
 *
 * ⚠️ DMs ARE DISABLED FOR ANYONE UNDER 18, AND THIS FILE IS NOT WHAT ENFORCES THAT.
 *
 * Makel, 2026-09-28: *"DMs are disabled for anyone under 18 and just the profile comments will
 * then be visible coach to coach."* The refusal lives in `messages_insert` on atlas.messages,
 * which checks `not is_minor(sender) and not is_minor(recipient)` in the database. Everything
 * below is explanation, never permission: if every line of this file were wrong, the write would
 * still be refused 42501.
 *
 * That split is deliberate and it is the whole reason the rule is not a React branch. A hidden
 * compose box is not a safeguarding control — this endpoint is reachable with a session cookie
 * whatever the page renders. A private, unobserved channel between an adult coach and a minor is
 * the most scrutinised surface in youth sport, so the gate has to sit where no client bug can
 * route around it.
 *
 * What a minor gets instead is `atlas.coaching_notes`, which already works: written on their file,
 * read by the coaching team, never in private. That is the third-party-observable property the
 * rule is protecting, and it is why "no DMs" does not mean "no communication".
 */
const schema = { users, atlasMessages }

const identityChain: RequestHandler[] = [
  cookieOrBearer,
  attachUser(pool),
  ensureAtlasAccess(pool),
  requireApp('atlas'),
  requireConsent(),
]

export const messagesRouter = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bodySchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict()

/**
 * WHY a send was refused — for the message shown to a human, never as the gate.
 *
 * The database answers 42501 for both "you do not coach them" and "one of you is a minor", and a
 * caller staring at a dead button deserves to know which. Computed only AFTER the database has
 * already refused, and only between two people who are in a coaching relationship — so it
 * discloses nothing to anyone who was not already entitled to the student's file.
 */
async function explainRefusal(
  me: typeof users.$inferSelect,
  otherId: string,
): Promise<'dm_unavailable_minor' | 'not_your_coach'> {
  if (consentStateFor(me) !== 'ok' || (me.dateOfBirth && isMinor(new Date(me.dateOfBirth)))) {
    return 'dm_unavailable_minor'
  }
  const other = await withRls(
    pool,
    { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
    schema,
    (db) => db.query.users.findFirst({ where: eq(users.id, otherId) }),
  )
  // `users_select` is self/coach-scoped, so a row we cannot see is someone we do not coach.
  if (!other) return 'not_your_coach'
  if (!other.dateOfBirth || isMinor(new Date(other.dateOfBirth))) return 'dm_unavailable_minor'
  return 'not_your_coach'
}

/** The thread with one other person, oldest first. */
messagesRouter.get('/messages/:withUserId', ...identityChain, async (req, res, next) => {
  try {
    const other = String(req.params.withUserId)
    if (!UUID_RE.test(other)) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    const rows = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db
          .select({
            id: atlasMessages.id,
            senderUserId: atlasMessages.senderUserId,
            body: atlasMessages.body,
            readAt: atlasMessages.readAt,
            createdAt: atlasMessages.createdAt,
          })
          .from(atlasMessages)
          // `messages_select` already scopes to "I am one of the two", so this narrows to the
          // conversation rather than granting anything. Both directions, or a thread shows only
          // half of itself.
          .where(
            and(
              isNull(atlasMessages.deletedAt),
              or(
                and(eq(atlasMessages.senderUserId, me.id), eq(atlasMessages.recipientUserId, other)),
                and(eq(atlasMessages.senderUserId, other), eq(atlasMessages.recipientUserId, me.id)),
              ),
            ),
          )
          .orderBy(atlasMessages.createdAt),
    )
    res.json({ messages: rows })
  } catch (err) {
    next(err)
  }
})

messagesRouter.post('/messages/:withUserId', ...identityChain, async (req, res, next) => {
  try {
    const other = String(req.params.withUserId)
    if (!UUID_RE.test(other)) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    if (other === me.id) {
      res.status(400).json({ error: 'cannot_message_yourself' })
      return
    }

    const row = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      async (db) => {
        // sender is the CALLER, never the body — and messages_insert pins it to current_user_id()
        // as well, so a forged sender is refused by the database and not merely by this line.
        const out = await db.execute(sql`
          insert into atlas.messages (sender_user_id, recipient_user_id, body, created_at)
          values (${me.id}, ${other}, ${parsed.data.body}, now())
          returning id, sender_user_id, body, read_at, created_at
        `)
        return (out.rows as Record<string, unknown>[])[0] ?? null
      },
    )

    // ⚠️ Zero rows is not success — an RLS-filtered write matches nothing and throws nothing.
    if (!row) {
      res.status(403).json({ error: await explainRefusal(me, other) })
      return
    }
    res.json(row)
  } catch (err) {
    if ((err as { code?: string }).code === '42501') {
      const me = (req as any).user as typeof users.$inferSelect
      res.status(403).json({ error: await explainRefusal(me, String(req.params.withUserId)) })
      return
    }
    next(err)
  }
})

/** Mark everything this person sent me as read. Recipient-only, enforced by policy AND grant. */
messagesRouter.post('/messages/:withUserId/read', ...identityChain, async (req, res, next) => {
  try {
    const other = String(req.params.withUserId)
    if (!UUID_RE.test(other)) {
      res.status(400).json({ error: 'invalid_user_id' })
      return
    }
    const me = (req as any).user as typeof users.$inferSelect
    const updated = await withRls(
      pool,
      { userId: me.id, firebaseUid: me.firebaseUid, app: 'atlas' },
      schema,
      (db) =>
        db
          .update(atlasMessages)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(atlasMessages.senderUserId, other),
              eq(atlasMessages.recipientUserId, me.id),
              isNull(atlasMessages.readAt),
            ),
          )
          .returning({ id: atlasMessages.id }),
    )
    // Zero here is ordinary — nothing unread — so it is NOT an error, unlike the send path.
    res.json({ marked: updated.length })
  } catch (err) {
    next(err)
  }
})
