import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { plansRouter } from './routes/plans'
import { meRouter } from './routes/me'

const app = express()
const isProduction = process.env.NODE_ENV === 'production'

app.disable('x-powered-by')
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

app.use('/api', plansRouter)
app.use('/api', meRouter)

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
