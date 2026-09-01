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

app.use(express.json())

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
