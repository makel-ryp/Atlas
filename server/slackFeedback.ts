/**
 * The Slack half of the feedback feature: find-or-create today's thread, post the report, attach the
 * screenshot. No SDK, no new dependency — Node 22's global fetch / FormData is enough for five calls.
 *
 * ── THE CALL ORDER IS A DECISION. DO NOT "TIDY" IT. ─────────────────────────────────────────────
 *   1. conversations.history   find today's parent for this tester (marker `[fb:<userId>:<day>]`)
 *   2. chat.postMessage        the parent, ONLY if history succeeded and found none
 *   3. chat.postMessage        THE REPORT — the note, who, where. Before the image, on purpose.
 *   4. files.getUploadURLExternal → POST bytes to the returned URL → files.completeUploadExternal
 *   5. chat.getPermalink       of the step-3 message, for the `permalink` we hand back
 *
 * The note is posted BEFORE the upload so that no later failure can lose it. Uploading first with
 * the note as `initial_comment` would be one call shorter and would turn a flaky upload into a lost
 * report. An image that fails to attach after the note landed is reported as `screenshot: 'failed'`
 * on an `ok: true` response — the tester's words arrived, which is the thing that matters.
 *
 * ── A LOST THREAD MUST NEVER LOSE THE FEEDBACK ──────────────────────────────────────────────────
 * If step 1 fails (most likely `missing_scope` — it needs channels:history/groups:history, which the
 * two "obvious" scopes do not include), there is no parent. We then post the report top-level and do
 * NOT post a new parent: a parent per report would litter the channel with duplicates while history
 * stays broken. The image threads under the report instead, so note and picture stay together.
 *
 * ── SLACK ANSWERS HTTP 200 WITH {ok:false,error} ────────────────────────────────────────────────
 * Every call checks `.ok`, not the status. The one exception is 429 (rate limit), which Slack does
 * send as a real status.
 *
 * ⚠️ THE TOKEN NEVER LEAVES THIS FILE. Errors are built from the method name and Slack's error code
 * ONLY. A `fetch` error object (or a Response, or the request init) can carry request headers, and
 * the global error handler in index.ts does `console.error(err)` on whatever it is handed. Nothing
 * thrown from here holds anything but `method` and `code`.
 *
 * ⚠️ UNVERIFIED AGAINST A REAL WORKSPACE. The request shapes below are written from Slack's
 * documentation and exercised only against a stubbed fetch (see the report). Treat the first real
 * send as the test.
 */
const API = 'https://slack.com/api/'
const TIMEOUT_MS = 10_000

export class SlackError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`slack ${method}: ${code}`)
    this.name = 'SlackError'
  }
}

export interface SlackTarget {
  token: string
  channel: string
}

type SlackBody = Record<string, unknown> & { ok: boolean; error?: string }

async function call(t: SlackTarget, method: string, params: Record<string, string>): Promise<SlackBody> {
  let res: Response
  try {
    res = await fetch(API + method, {
      method: 'POST',
      // Form-encoded, not JSON: files.getUploadURLExternal refuses a JSON body, and one encoding
      // for all five calls means one shape to get right.
      headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    // The caught object is DISCARDED, not wrapped: see the token note at the top of the file.
    throw new SlackError(method, (err as { name?: string }).name === 'TimeoutError' ? 'timeout' : 'network')
  }
  if (res.status === 429) throw new SlackError(method, 'ratelimited')
  let body: SlackBody
  try {
    body = (await res.json()) as SlackBody
  } catch {
    throw new SlackError(method, 'bad_response')
  }
  if (!body.ok) throw new SlackError(method, typeof body.error === 'string' ? body.error : 'unknown')
  return body
}

/** Slack mrkdwn control characters. Without this a note containing `<!channel>` pings everyone. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// One thread per tester per UTC day. The in-process cache turns the common case (a tester sending
// several reports in a sitting) into zero history calls, and — because it stores the PROMISE — makes
// two near-simultaneous first reports share one parent instead of racing to create two. It is an
// optimisation only: a restart or a second instance simply falls back to the history lookup, which
// is the source of truth. A null (history failed) is never cached, so threading recovers by itself.
const parents = new Map<string, Promise<string | null>>()

async function findParent(t: SlackTarget, marker: string, dayStartEpoch: number): Promise<string | null> {
  let cursor = ''
  // A few pages, not unbounded: a channel busier than ~1000 messages/day will miss the parent and
  // start a second thread, which is a cosmetic failure, not a lost report.
  for (let page = 0; page < 5; page++) {
    const params: Record<string, string> = { channel: t.channel, oldest: String(dayStartEpoch), limit: '200' }
    if (cursor) params.cursor = cursor
    const body = await call(t, 'conversations.history', params)
    const messages = (body.messages as { text?: string; ts?: string; thread_ts?: string }[] | undefined) ?? []
    // Top-level only: a reply that merely quotes the marker is not a parent.
    const hit = messages.find((m) => m.text?.includes(marker) && (!m.thread_ts || m.thread_ts === m.ts))
    if (hit?.ts) return hit.ts
    cursor = (body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? ''
    if (!cursor) return null
  }
  return null
}

async function resolveParent(
  t: SlackTarget,
  who: { userId: string; label: string },
  day: string,
): Promise<string | null> {
  const key = `${who.userId}:${day}`
  const cached = parents.get(key)
  if (cached) {
    const ts = await cached
    if (ts) return ts
  }
  const attempt = (async () => {
    const marker = `[fb:${who.userId}:${day}]`
    const dayStart = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000)
    let found: string | null
    try {
      found = await findParent(t, marker, dayStart)
    } catch (err) {
      console.error('[feedback] thread lookup failed, posting top-level:', (err as SlackError).message)
      return null // history failed: NO new parent — see the header.
    }
    if (found) return found
    try {
      const posted = await call(t, 'chat.postMessage', {
        channel: t.channel,
        text: `Feedback from ${esc(who.label)}, ${day} UTC ${marker}`,
        unfurl_links: 'false',
      })
      return typeof posted.ts === 'string' ? posted.ts : null
    } catch (err) {
      console.error('[feedback] parent post failed, posting top-level:', (err as SlackError).message)
      return null
    }
  })()
  parents.set(key, attempt)
  if (parents.size > 1000) parents.clear()
  const ts = await attempt
  if (!ts) parents.delete(key)
  return ts
}

async function attach(t: SlackTarget, png: Buffer, threadTs: string): Promise<void> {
  const filename = 'feedback.png'
  const got = await call(t, 'files.getUploadURLExternal', { filename, length: String(png.length) })
  const uploadUrl = got.upload_url
  const fileId = got.file_id
  // The URL comes from Slack, but a bytes-POST to a non-https address is never right.
  if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://') || typeof fileId !== 'string') {
    throw new SlackError('files.getUploadURLExternal', 'bad_response')
  }
  let up: Response
  try {
    // Raw bytes, and NO Authorization header: the upload URL is pre-signed, and the token has no
    // business going to whatever host it names.
    up = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(png),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    throw new SlackError('upload', (err as { name?: string }).name === 'TimeoutError' ? 'timeout' : 'network')
  }
  if (!up.ok) throw new SlackError('upload', `http_${up.status}`)
  await call(t, 'files.completeUploadExternal', {
    files: JSON.stringify([{ id: fileId, title: 'Screenshot' }]),
    channel_id: t.channel,
    thread_ts: threadTs,
  })
}

export interface FeedbackReport {
  userId: string
  name: string | null
  email: string | null
  note: string
  screen?: string
  url?: string
  viewport?: { w: number; h: number }
  userAgent?: string
  png?: Buffer
}

export interface FeedbackResult {
  permalink: string | null
  /** 'none' = the tester sent no image; 'failed' = they did and it did not attach. */
  screenshot: 'attached' | 'none' | 'failed'
  threaded: boolean
}

export async function sendFeedback(t: SlackTarget, r: FeedbackReport): Promise<FeedbackResult> {
  const label = r.name && r.email ? `${r.name} (${r.email})` : (r.name ?? r.email ?? `user ${r.userId}`)
  const day = new Date().toISOString().slice(0, 10)

  const parent = await resolveParent(t, { userId: r.userId, label }, day)

  const lines = [`*Feedback from ${esc(label)}*`]
  if (r.screen) lines.push(`Screen: ${esc(r.screen)}`)
  if (r.viewport) lines.push(`Viewport: ${r.viewport.w}×${r.viewport.h}`)
  if (r.url) lines.push(`URL: ${esc(r.url)}`)
  if (r.userAgent) lines.push(`UA: ${esc(r.userAgent)}`)
  lines.push('', esc(r.note))

  const params: Record<string, string> = { channel: t.channel, text: lines.join('\n'), unfurl_links: 'false' }
  if (parent) params.thread_ts = parent
  const posted = await call(t, 'chat.postMessage', params) // throws: the report itself must land.
  const reportTs = typeof posted.ts === 'string' ? posted.ts : null

  let screenshot: FeedbackResult['screenshot'] = 'none'
  if (r.png) {
    const threadTs = parent ?? reportTs
    if (!threadTs) {
      screenshot = 'failed'
    } else {
      try {
        await attach(t, r.png, threadTs)
        screenshot = 'attached'
      } catch (err) {
        console.error('[feedback] screenshot did not attach:', (err as SlackError).message)
        screenshot = 'failed'
      }
    }
  }

  let permalink: string | null = null
  if (reportTs) {
    try {
      const p = await call(t, 'chat.getPermalink', { channel: t.channel, message_ts: reportTs })
      permalink = typeof p.permalink === 'string' ? p.permalink : null
    } catch {
      permalink = null // cosmetic: the report is already posted.
    }
  }

  return { permalink, screenshot, threaded: parent !== null }
}
