/**
 * FEEDBACK — the copy, the limits and the endpoint, written ONCE.
 *
 * Three things consume this: the injected widget on Luke's page (`server/feedbackWidget.ts`, a plain
 * <script> string), the React button on every SPA screen (`client/src/components/FeedbackButton.tsx`),
 * and the route that enforces the limits (`server/routes/feedback.ts`). The first two are different
 * technologies and cannot share code, only RULES — so the rules live here. Writing them twice is how
 * the sentence the user reads before sending ends up different on two screens, or the client's size
 * ceiling ends up looser than the server's.
 *
 * ⚠️ NOTHING IN THIS FILE MAY READ `process.env` OR NAME A CREDENTIAL. It is bundled into the browser
 * by vite and serialised into the injected script. The Slack token stays in `server/feedbackConfig.ts`.
 *
 * ⚠️ THE COPY BELOW IS PART OF A PRIVACY CONTROL — see PREVIEW BEFORE SEND in server/feedbackConfig.ts.
 * `whereItGoes` and `othersWarning` are what makes the preview informed rather than decorative. Soften
 * or delete them and the allowlist's replacement quietly stops being one.
 */

export const FEEDBACK_ENDPOINT = '/api/feedback'

export const FEEDBACK_NOTE_MAX = 2000

/** Decoded-PNG ceiling. Slack accepts far larger; this is what we are willing to relay. */
export const FEEDBACK_MAX_PNG_BYTES = 4 * 1024 * 1024

/**
 * The same ceiling as the CLIENT measures it: the length of a `data:image/png;base64,…` string.
 * 4 MiB of PNG is ~5.59M base64 characters plus the 22-char prefix; this sits just under that so a
 * capture the client keeps is one the server will not answer 413 to.
 */
export const FEEDBACK_MAX_DATA_URL_CHARS = 5_300_000

/**
 * html2canvas scale: tried in order until the PNG fits. The first is `min(devicePixelRatio, this)`.
 * A viewport PNG at DPR 3 is tens of megabytes; stepping down is what keeps a phone report whole.
 */
export const FEEDBACK_MAX_SCALE = 1.5
export const FEEDBACK_FALLBACK_SCALES = [1, 0.6] as const

/** Pinned. The injected widget also carries an SRI hash for the CDN copy; the SPA bundles this exact version. */
export const FEEDBACK_H2C_VERSION = '1.4.1'

export const FEEDBACK_COPY = {
  fab: 'Feedback',
  title: 'Send feedback',
  noteLabel: 'What happened, or what would you change?',
  notePlaceholder: 'What happened, or what would you change?',

  // The two lines that carry the privacy decision. Plain on purpose: no legalese, no shouting.
  whereItGoes: "This image goes to the RYP team's Slack.",
  othersWarning:
    "If someone else's details are on screen, like a student's, send without the screenshot.",
  noImage: 'No screenshot will be sent, just your note.',
  zoomHint: 'Click the image to see it full size.',

  capturing: 'Taking a screenshot…',
  captureFailed: "Couldn't take a screenshot of this page. You can still send your note.",
  captureTooLarge: 'That screenshot was too large to attach. You can still send your note.',
  libFailed: "The screenshot tool didn't load. You can still send your note.",
  recapture: 'Re-capture',
  retryCapture: 'Try again',
  removeShot: 'Send without screenshot',
  attachShot: 'Attach a screenshot',
  zoomClose: 'Close preview',

  close: 'Close',
  sendWithShot: 'Send with screenshot',
  sendNoteOnly: 'Send note only',

  writeNote: 'Write a note first.',
  sending: 'Sending…',
  sentWithShot: 'Sent, with a screenshot. Thank you.',
  sentShotFailed: 'Sent. The screenshot did not attach.',
  sentNoShot: 'Sent, without a screenshot. Thank you.',
  sessionExpired: 'Your session has expired. Reload the page and sign in again. Your note is still here.',
  rateLimited: 'Too many reports in a short time. Try again in a few minutes. Your note is still here.',
  unavailable: 'Feedback is not set up on this server.',
  failed: 'Could not send that. Your note is still here; try again.',
  offline: 'Could not send. Check your connection. Your note is still here.',
} as const

export type FeedbackCopy = typeof FEEDBACK_COPY

/**
 * What the widget reports as "where". PATHNAME ONLY — never a heading, never the query string.
 * A heading on a coach's screen is a student's name (it would land in Slack message TEXT, which is
 * searchable and pushed to every channel member's phone), and the query string carries things like
 * the `?as=<email>` demo link. The screenshot already shows the rest.
 */
export function feedbackWhere(pathname: string): string {
  return pathname.slice(0, 500)
}
