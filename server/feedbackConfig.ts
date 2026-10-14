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
  | { ok: true; token: string; channel: string; testers: ReadonlySet<string> }
  | { ok: false; problems: string[] }

/**
 * ⚠️ THE ALLOWLIST IS A PRIVACY CONTROL, NOT A CONVENIENCE, AND IT IS WHY THIS FEATURE IS SAFE.
 *
 * A screenshot captures whatever is on screen, and this product shows one person's data to another
 * by design. Without this list the button is injected for EVERY user who passes the consent gate —
 * every player, and every coach. A coach's screen carries a student's display name (falling back to
 * their EMAIL), their handicap, their coaching notes including the private tier, and their intake
 * answers: "Physical limitations — injuries, surgeries" and "Why you are here". Some of those
 * students are minors; `requireConsent.ts` exists for them.
 *
 * And consent does not cover this. What a guardian agreed to is the CHILD USING THE APP, not the
 * disclosure of their injury history to a third-party processor with its own retention and its own
 * member list. T-16 — what counts as consent — is still open with counsel.
 *
 * So the button reaches named testers only. Empty list = feature off, which is the safe default.
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

  const testers = new Set(
    (process.env.SLACK_FEEDBACK_TESTERS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
  if (testers.size === 0) {
    problems.push('SLACK_FEEDBACK_TESTERS is empty — set the testers\' emails, comma separated')
  }

  if (problems.length > 0 || !token || !channel) return { ok: false, problems }
  return { ok: true, token, channel, testers }
}

export const feedbackConfig: FeedbackConfig = loadFeedbackConfig()
