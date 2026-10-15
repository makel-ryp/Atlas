/**
 * SLACK FEEDBACK — the "is this configured?" decision, made ONCE, in the forgeDb.ts shape.
 *
 * Both `server/index.ts` (mount the router, or answer 503) and `server/routes/proto.ts` (inject the
 * button, or don't) read `feedbackConfig`. Keeping the decision in one module is what stops the two
 * from disagreeing: a button on a page whose endpoint answers 503 is a feedback tool that eats
 * feedback, which is worse than having none.
 *
 * ⚠️ NEVER THROWS AT IMPORT. A missing Slack credential must take FEEDBACK down and leave Atlas up.
 * The failure is reported through `problems`, and index.ts is what refuses to mount and says so.
 *
 * ⚠️ A VALUE IS NEVER PRINTED OR RETURNED — not in a problem message, not in a log, not in a
 * response. Only the variable NAME and the expected shape are reported. The bot token is a
 * workspace-wide credential: anyone holding it can post as the bot and read every channel it is in.
 *
 * ── Why the shape of each value is checked here, not left to Slack ───────────────────────────
 *   SLACK_BOT_TOKEN        must be `xoxb-`. An incoming-webhook URL pasted here is the likely
 *                          mistake, and a webhook CANNOT upload a file — the screenshot would
 *                          silently never arrive while every note still "worked".
 *   SLACK_FEEDBACK_CHANNEL must be a channel ID (`C…`/`G…`), NOT `#name`. files.completeUploadExternal
 *                          and conversations.history both take an ID and answer `channel_not_found`
 *                          for a name, which would otherwise show up as a runtime 502 per report.
 *
 * Slack app scopes this needs (the brief named two; threading needs a third):
 *   files:write, chat:write                       post the note and attach the image
 *   channels:history (or groups:history, private) find today's thread parent
 * and the bot must be INVITED to the channel. Without the history scope nothing errors — the lookup
 * fails, the report posts top-level, and threading just never happens.
 */
export type FeedbackConfig =
  | { ok: true; token: string; channel: string }
  | { ok: false; problems: string[] }

/**
 * ⚠️ PREVIEW BEFORE SEND REPLACED THE TESTER ALLOWLIST. DO NOT REINSTATE THE LIST, AND DO NOT
 * REMOVE THE PREVIEW AS "REDUNDANT" — IT IS NOW THE WHOLE PRIVACY CONTROL.
 *
 * This used to be `SLACK_FEEDBACK_TESTERS`: the button reached named people only. Makel's decision
 * (2026-10-15) is that anyone who is signed in may give feedback, so WHO may send is no longer the
 * control. WHAT they knowingly send is.
 *
 * The risk that made the list necessary has not gone away. A screenshot captures whatever is on
 * screen, and this product shows one person's data to another by design. A coach's screen carries a
 * student's display name (falling back to their EMAIL), their handicap, their coaching notes
 * including the private tier, and their intake answers: "Physical limitations — injuries, surgeries"
 * and "Why you are here". Some of those students are minors (`requireConsent.ts` exists for them).
 * Consent covers the CHILD USING THE APP, not disclosure to a third-party processor with its own
 * retention and its own member list; T-16 — what counts as consent — is still open with counsel.
 * The image persists in Slack, visible to every member of the channel.
 *
 * So both widgets (`shared/feedback.ts` holds their copy, `server/feedbackWidget.ts` and
 * `client/src/components/FeedbackButton.tsx` implement them) show the EXACT image in the composer
 * before anything leaves the browser, say in one plain line where it goes, and offer "send without
 * screenshot". The person whose screen it is sees it and chooses. That is informed disclosure by the
 * account holder instead of silent capture. The widgets never capture at send time: the bytes
 * POSTed are the bytes previewed.
 *
 * ⚠️ THE RESIDUAL IS REAL AND IS NOT CLOSED. A coach can still choose to send a student's data, and
 * the student did not agree to that. The preview cannot stop it; it makes it a deliberate act, and
 * the copy tells them so. The server cannot verify a preview happened (it never sees the UI), so it
 * enforces only what it can: a signed-in identity, a rate limit, a size ceiling and PNG magic bytes.
 * The other mitigation is operational, not code: SLACK_FEEDBACK_CHANNEL must be a PRIVATE channel
 * with a short member list.
 */

function loadFeedbackConfig(): FeedbackConfig {
  const problems: string[] = []
  const token = process.env.SLACK_BOT_TOKEN?.trim()
  const channel = process.env.SLACK_FEEDBACK_CHANNEL?.trim()

  if (!token) problems.push('SLACK_BOT_TOKEN is not set')
  else if (!token.startsWith('xoxb-')) problems.push('SLACK_BOT_TOKEN is not a bot token (xoxb-…)')

  if (!channel) problems.push('SLACK_FEEDBACK_CHANNEL is not set')
  else if (!/^[CG][A-Z0-9]{6,}$/.test(channel)) {
    problems.push('SLACK_FEEDBACK_CHANNEL is not a channel ID (C… or G…), a #name will not work')
  }

  if (problems.length > 0 || !token || !channel) return { ok: false, problems }
  return { ok: true, token, channel }
}

export const feedbackConfig: FeedbackConfig = loadFeedbackConfig()
