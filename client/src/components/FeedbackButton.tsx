import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/authContext'
import { apiFetch, ApiError } from '../lib/api'
import {
  FEEDBACK_COPY as C,
  FEEDBACK_ENDPOINT,
  FEEDBACK_FALLBACK_SCALES,
  FEEDBACK_MAX_DATA_URL_CHARS,
  FEEDBACK_MAX_SCALE,
  FEEDBACK_NOTE_MAX,
  feedbackWhere,
} from '../../../shared/feedback'

/**
 * The feedback button on EVERY SPA screen: login aside, a first-run tester gets stuck in intake, the
 * profile form, the consent screens or the admin panel, and the injected widget on Luke's page
 * cannot reach any of those. Mounted once in App.tsx as a sibling of <Routes />.
 *
 * ── 🔴 PREVIEW BEFORE SEND IS THE PRIVACY CONTROL — DO NOT "SIMPLIFY" IT AWAY ───────────────────
 * Anyone signed in may send; the tester allowlist is gone (server/feedbackConfig.ts has the full
 * reasoning and the residual that remains). What replaced it is this composer: it captures when it
 * OPENS (or when the person presses re-capture), shows the exact image large enough to read, says in
 * one plain line where it goes, and offers to send without it. ⚠️ send() NEVER captures — the bytes
 * posted are the bytes previewed. Capture-on-send, a dropped warning line, or a removed
 * "send without screenshot" control makes the preview decorative and reopens the hole: a coach's
 * screen carries a student's name, notes and intake answers, and some students are minors.
 * The copy, limits and endpoint come from shared/feedback.ts, which the injected widget also reads,
 * so the two cannot say different things or enforce different ceilings.
 *
 * ── OTHER DECISIONS ─────────────────────────────────────────────────────────────────────────────
 *  - RENDERS ONLY WHEN SIGNED IN. An anonymous visitor has no session and the POST would 401.
 *    `signed_in` also means the person holds an Atlas role, which the route requires.
 *  - ASKS THE SERVER WHETHER FEEDBACK IS CONFIGURED (GET /api/feedback) and draws nothing on any
 *    failure. A button over a 503 takes someone's words and loses them. The check is cosmetic; the
 *    route is the real gate.
 *  - html2canvas is BUNDLED (pinned 1.4.1, same version as the injected widget's CDN copy) and
 *    imported lazily, so the ~200 kB is only fetched when someone opens the composer.
 *  - NO CREDENTIAL IS HERE. The Slack token is server-side only; this posts to our own API with the
 *    person's Firebase bearer token, like every other call in the SPA.
 *  - `screen`/`url` are the PATHNAME only: not a heading (a student's name, on a coach's screen) and
 *    not the query string (the ?as= demo link carries an email address).
 */

type ShotState = 'capturing' | 'ready' | 'failed' | 'off'
type CaptureResult = { url: string } | { err: 'libFailed' | 'captureFailed' | 'captureTooLarge' }

const ROOT_ATTR = 'data-feedback-root'

/** Never throws. Steps the scale down until the PNG fits the ceiling the server enforces. */
async function capture(): Promise<CaptureResult> {
  let html2canvas: typeof import('html2canvas').default
  try {
    html2canvas = (await import('html2canvas')).default
  } catch {
    return { err: 'libFailed' }
  }
  const first = Math.min(window.devicePixelRatio || 1, FEEDBACK_MAX_SCALE)
  const scales = [first, ...FEEDBACK_FALLBACK_SCALES.filter((s) => s < first)]
  let tooBig = false
  for (const scale of scales) {
    try {
      const canvas = await html2canvas(document.body, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: window.innerHeight,
        scale,
        useCORS: true,
        logging: false,
        // The composer is not part of what the person was looking at.
        ignoreElements: (el) => el.hasAttribute(ROOT_ATTR),
      })
      const url = canvas.toDataURL('image/png') // a tainted canvas throws here
      if (url.length <= FEEDBACK_MAX_DATA_URL_CHARS) return { url }
      tooBig = true
    } catch {
      return { err: 'captureFailed' }
    }
  }
  return { err: tooBig ? 'captureTooLarge' : 'captureFailed' }
}

export function FeedbackButton() {
  const { status } = useAuth()
  if (status !== 'signed_in') return null
  return <Composer />
}

function Composer() {
  // False until GET /api/feedback answers 200 (not configured = 503). Nothing is drawn while false.
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [shotState, setShotState] = useState<ShotState>('off')
  const [shot, setShot] = useState<string | null>(null)
  const [failKey, setFailKey] = useState<'libFailed' | 'captureFailed' | 'captureTooLarge'>('captureFailed')
  const [zoom, setZoom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const token = useRef(0)
  const closeTimer = useRef<number>()
  const fabRef = useRef<HTMLButtonElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<{ enabled: boolean }>(FEEDBACK_ENDPOINT)
      .then((r) => !cancelled && setEnabled(r.enabled === true))
      .catch(() => !cancelled && setEnabled(false)) // 503 (not configured), 401, network: draw nothing
    return () => {
      cancelled = true
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  const startCapture = useCallback(() => {
    const mine = ++token.current
    setShot(null)
    setShotState('capturing')
    capture().then((r) => {
      if (mine !== token.current) return // superseded, cancelled, or the composer was closed
      if ('url' in r) {
        setShot(r.url)
        setShotState('ready')
      } else {
        setFailKey(r.err)
        setShotState('failed')
      }
    })
  }, [])

  const dropShot = useCallback(() => {
    token.current++
    setShot(null)
    setZoom(false)
  }, [])

  const openComposer = () => {
    window.clearTimeout(closeTimer.current)
    setOpen(true)
    setMsg(null)
    startCapture()
    setTimeout(() => noteRef.current?.focus(), 0)
  }
  const closeComposer = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    dropShot()
    setShotState('off')
    setOpen(false)
    fabRef.current?.focus()
  }, [dropShot])

  // Escape closes the full-size preview first, then the composer. Capture phase so it also wins over
  // a screen's own Escape handler.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      if (zoom) setZoom(false)
      else closeComposer()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, zoom, closeComposer])

  const send = async () => {
    if (busy || shotState === 'capturing') return
    const text = note.trim()
    if (!text) {
      setMsg({ text: C.writeNote, err: true })
      noteRef.current?.focus()
      return
    }
    setBusy(true)
    setMsg({ text: C.sending, err: false })
    // Attach ONLY the image that is on screen in the preview. No capture here.
    let attached = shotState === 'ready' && shot !== null
    const payload: Record<string, unknown> = {
      note: text,
      screen: feedbackWhere(window.location.pathname),
      url: feedbackWhere(window.location.pathname),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    }
    const post = (body: Record<string, unknown>) =>
      apiFetch<{ ok: true; screenshot: 'attached' | 'none' | 'failed' }>(FEEDBACK_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    try {
      let result
      try {
        result = await post(attached ? { ...payload, screenshot: shot } : payload)
      } catch (err) {
        // Too large for the server: send the note alone. The status line says so afterwards.
        if (err instanceof ApiError && err.status === 413 && attached) {
          attached = false
          result = await post(payload)
        } else {
          throw err
        }
      }
      setNote('')
      setMsg({
        text:
          result.screenshot === 'attached'
            ? C.sentWithShot
            : result.screenshot === 'failed'
              ? C.sentShotFailed
              : C.sentNoShot,
        err: false,
      })
      closeTimer.current = window.setTimeout(closeComposer, 2200)
    } catch (err) {
      if (err instanceof ApiError) {
        const text =
          err.status === 401 || err.status === 403
            ? C.sessionExpired
            : err.status === 429
              ? C.rateLimited
              : err.status === 503
                ? C.unavailable
                : C.failed
        setMsg({ text, err: true })
      } else {
        setMsg({ text: C.offline, err: true })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!enabled) return null

  const ready = shotState === 'ready' && shot !== null

  return (
    <div {...{ [ROOT_ATTR]: '' }} className="fb-root">
      <style>{CSS}</style>
      {open && (
        <div
          className="fb-panel"
          role="dialog"
          aria-label={C.title}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
        >
          <p className="fb-t">{C.title}</p>
          <textarea
            ref={noteRef}
            className="fb-ta"
            value={note}
            maxLength={FEEDBACK_NOTE_MAX}
            aria-label={C.noteLabel}
            placeholder={C.notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="fb-pv">
            {ready && (
              <>
                <p className="fb-why">{C.whereItGoes}</p>
                <button type="button" className="fb-thumb" aria-label={C.zoomHint} onClick={() => setZoom(true)}>
                  <img src={shot!} alt={C.whereItGoes} />
                </button>
                <p className="fb-note">
                  {C.othersWarning} {C.zoomHint}
                </p>
              </>
            )}
            <p className={'fb-note' + (shotState === 'failed' ? ' fb-err' : '')} role="status" aria-live="polite">
              {shotState === 'capturing'
                ? C.capturing
                : shotState === 'failed'
                  ? C[failKey]
                  : shotState === 'off'
                    ? C.noImage
                    : ''}
            </p>
            <div className="fb-row2">
              {shotState !== 'capturing' && (
                <button type="button" className="fb-b" disabled={busy} onClick={startCapture}>
                  {ready ? C.recapture : shotState === 'failed' ? C.retryCapture : C.attachShot}
                </button>
              )}
              {(ready || shotState === 'capturing') && (
                <button
                  type="button"
                  className="fb-b"
                  disabled={busy}
                  onClick={() => {
                    dropShot()
                    setShotState('off')
                  }}
                >
                  {C.removeShot}
                </button>
              )}
            </div>
          </div>

          <div className="fb-row">
            <span className={'fb-s' + (msg?.err ? ' fb-err' : '')} role="status" aria-live="polite">
              {msg?.text ?? ''}
            </span>
            <button type="button" className="fb-b" disabled={busy} onClick={closeComposer}>
              {C.close}
            </button>
            <button
              type="button"
              className={'fb-b fb-go' + (ready ? '' : ' fb-noimg')}
              disabled={busy || shotState === 'capturing'}
              onClick={() => void send()}
            >
              {ready ? C.sendWithShot : C.sendNoteOnly}
            </button>
          </div>
        </div>
      )}

      {open && zoom && shot && (
        <div
          className="fb-zoom"
          role="dialog"
          aria-label={C.zoomClose}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onClick={() => setZoom(false)}
        >
          <img src={shot} alt={C.whereItGoes} />
        </div>
      )}

      <button
        ref={fabRef}
        type="button"
        className="fb-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closeComposer() : openComposer())}
      >
        {C.fab}
      </button>
    </div>
  )
}

// Self-contained so the component needs nothing from index.css; the palette is the same.
const CSS = `
.fb-root{position:fixed;left:0;bottom:0;z-index:2000;font-family:var(--mono,"IBM Plex Mono",ui-monospace,monospace)}
.fb-root *{box-sizing:border-box}
.fb-fab,.fb-panel{position:fixed;left:max(16px,env(safe-area-inset-left))}
.fb-fab{bottom:max(16px,env(safe-area-inset-bottom));background:#c8a05e;color:#13110b;border:0;border-radius:999px;padding:11px 16px;font:700 11px/1 var(--mono,monospace);letter-spacing:.14em;text-transform:uppercase;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.fb-panel{bottom:calc(max(16px,env(safe-area-inset-bottom)) + 52px);width:min(900px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;background:#0e141b;color:#ece7db;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5)}
.fb-t{font:700 10px/1 var(--mono,monospace);letter-spacing:.2em;text-transform:uppercase;color:#c8a05e;margin:0 0 10px}
.fb-ta{display:block;width:100%;height:90px;resize:vertical;background:#171f29;color:#ece7db;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:9px;font:14px/1.45 system-ui,sans-serif}
.fb-root button:focus-visible,.fb-ta:focus-visible{outline:2px solid #c8a05e;outline-offset:2px}
.fb-pv{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12)}
.fb-why{margin:0 0 8px;font:600 13px/1.4 system-ui,sans-serif;color:#ece7db}
.fb-thumb{display:block;width:100%;padding:0;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:#000;cursor:zoom-in;overflow:hidden}
.fb-thumb img{display:block;width:100%;max-height:min(60vh,560px);object-fit:contain;object-position:top left}
.fb-note{margin:8px 0 0;font:12px/1.45 system-ui,sans-serif;color:#9aa5b1}
.fb-note:empty{display:none}
.fb-row2{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.fb-row2:empty{display:none}
.fb-row{display:flex;align-items:center;gap:8px;margin-top:12px}
.fb-s{flex:1;font:11px/1.35 system-ui,sans-serif;color:#9aa5b1;min-height:15px}
.fb-err{color:#e8917a}
.fb-b{background:transparent;color:#ece7db;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:8px 12px;font:700 10px/1 var(--mono,monospace);letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
.fb-go{background:#c8a05e;color:#13110b;border-color:#c8a05e}
.fb-go.fb-noimg{background:transparent;color:#c8a05e}
.fb-b:disabled{opacity:.5;cursor:default}
.fb-zoom{position:fixed;inset:0;overflow:auto;padding:16px;background:rgba(8,10,14,.9);cursor:zoom-out;z-index:1}
.fb-zoom img{display:block;margin:0 auto;max-width:100%;height:auto;background:#000}
@media print{.fb-root{display:none}}
`
