import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { plansRouter } from './routes/plans'
import { meRouter } from './routes/me'
import { coachRouter } from './routes/coach'
import { protoRouter } from './routes/proto'
import { adminRouter } from './routes/admin'
import { notesRouter } from './routes/notes'
import { intakeRouter } from './routes/intake'
import { reviewRouter } from './routes/review'
import { practiceRouter } from './routes/practice'
import { messagesRouter } from './routes/messages'
import { forgeConfig } from './forgeDb'
import { createForgeRouter } from './routes/forge'
import { feedbackConfig } from './feedbackConfig'
import { createFeedbackRouter } from './routes/feedback'

const app = express()
const isProduction = process.env.NODE_ENV === 'production'

app.disable('x-powered-by')

// Behind Railway's edge the app sees plain HTTP on an internal port; the TLS terminates upstream.
// Without this, `req.protocol` reads 'http' and `req.secure` is false on a request that genuinely
// arrived over HTTPS — so anything that gates on either (the session cookie's own Secure attribute
// is set explicitly, but redirects and future checks are not) makes the wrong call. One hop,
// because exactly one proxy sits in front of us; `true` would trust a client-supplied
// X-Forwarded-For and let a caller spoof its own address.
if (isProduction) app.set('trust proxy', 1)

// ⚠️ `/api/feedback` is EXCLUDED from the 100 kb default parser on purpose. A screenshot is megabytes of
// base64, and a body over THIS parser's limit is rejected here with a 413 before the route is ever
// reached — so a bigger limit set inside routes/feedback.ts would silently never apply. That route
// parses its own body (6 MB, after authentication). Do not "simplify" this back to one parser, and do
// not raise this limit to make it work: that would let every route buffer six megabytes.
const defaultJson = express.json()
app.use((req, res, next) => (req.path === '/api/feedback' ? next() : defaultJson(req, res, next)))

// ── Baseline security headers. Four lines, no dependency. ──────────────────────────────────────
// Added 2026-10-15 after `curl -I` against the deployed Testing environment returned NONE of them.
//
// `nosniff` matters more here than it looks: `/proto/dashboard` serves a coach's whole roster as
// HTML, and a browser that content-sniffs a response into a type we did not intend is how an
// injected string becomes executable. `DENY` stops the authenticated app being framed by another
// site and clicked through. Referrer is trimmed so a path never leaks to a third party in a header.
//
// ⚠️ NOT a Content-Security-Policy. Luke's pages are a mass of inline styles and inline handlers,
// and a CSP strict enough to be worth having would break them — so it needs doing deliberately with
// his markup in hand, not bolted on here where it would either be useless or break the product.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

app.use('/api', plansRouter)
app.use('/api', meRouter)
app.use('/api', coachRouter)
// Mounted at the ROOT, not under /api: it serves pages a browser navigates to, and /api 404s as JSON.
app.use('/', protoRouter)
app.use('/api', adminRouter)
app.use('/api', notesRouter)
app.use('/api', intakeRouter)
app.use('/api', reviewRouter)
app.use('/api', practiceRouter)
app.use('/api', messagesRouter)

// FORGE gets its own two database principals (forge_app, forge_svc). If either credential is missing
// or names the wrong role the router is NOT mounted — there is deliberately no fallback to atlas_app,
// which would hand a player the coach's grants. A stub answers 503 so the client sees "FORGE is
// unavailable" rather than the 404 that means "no such route". It touches no database. This sits
// BEFORE the /api 404 below, which would otherwise swallow every /api/forge request.
if (forgeConfig.ok) {
  app.use('/api/forge', createForgeRouter(forgeConfig.pools))
} else {
  console.error(
    '[forge] NOT MOUNTED — /api/forge answers 503. ' + forgeConfig.problems.join('; ') +
      '. Set both in .env (see .env.example); a connection string is never printed.',
  )
  app.use('/api/forge', (_req, res) => {
    res.status(503).json({ error: 'forge_unavailable' })
  })
}

// SLACK FEEDBACK: same refuse-to-mount shape as FORGE above. Without a bot token AND a channel ID the
// router is not mounted and a stub answers 503 (the stub reads no body, so the global-parser skip
// above is harmless). proto.ts reads the same `feedbackConfig` and injects no button in that case.
// Names only are logged, never a value. Before the /api 404 below, which would swallow it.
if (feedbackConfig.ok) {
  app.use('/api/feedback', createFeedbackRouter(feedbackConfig))
} else {
  console.error(
    '[feedback] NOT MOUNTED — /api/feedback answers 503 and no feedback button is shown. ' +
      feedbackConfig.problems.join('; ') + '. Set both in .env (see .env.example); a value is never printed.',
  )
  app.use('/api/feedback', (_req, res) => {
    res.status(503).json({ error: 'feedback_unavailable' })
  })
}

// Unmatched /api/* fails as JSON, in BOTH environments. In prod it would otherwise reach the SPA
// fallback and return index.html with a 200 — the client then parses '<!doctype html>' and reports a
// JSON error instead of the 404 that happened. In dev it would hit Express's default HTML 404, so
// the same request would behave differently per environment.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

// Prod only — in dev the client is served by `npm run dev` (vite), which proxies /api here.
// Mounted after the API so the SPA fallback cannot swallow /health or /api.
if (isProduction) {
  // import.meta.dirname, not __dirname: this is ESM running from source, where __dirname
  // is undefined.
  const distPath = path.resolve(import.meta.dirname, '..', 'dist', 'public')
  if (!fs.existsSync(distPath)) {
    throw new Error(`Missing client build at ${distPath} — run npm run build first`)
  }
  app.use(express.static(distPath))
  app.use((_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'))
  })
}

// Last, so it also catches anything thrown by the static/SPA handlers above.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const typed = err as { status?: number; message?: string }
  console.error('Internal Server Error:', err)
  if (res.headersSent) return next(err)
  res.status(typed.status ?? 500).json({ message: typed.message ?? 'Internal Server Error' })
})

// Must match the vite dev proxy target in vite.config.ts.
const port = parseInt(process.env.PORT ?? '5000', 10)
app.listen(port, () => {
  console.log(`atlas serving on port ${port}`)
})
