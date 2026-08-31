import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // '' (no prefix filter) so PORT is visible here too. loadEnv only hands values to this config —
  // nothing reaches the browser bundle unless it is VITE_-prefixed or listed in `define`.
  // envDir is the project root, not `root` below: .env sits next to package.json, not in client/.
  const env = loadEnv(mode, import.meta.dirname, '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'client', 'src'),
      },
    },
    root: path.resolve(import.meta.dirname, 'client'),
    envDir: import.meta.dirname,
    build: {
      // server/index.ts resolves this same path when NODE_ENV=production — keep the two in step.
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      // Two processes in dev (npm run dev + npm run dev:server), so the client proxies the API
      // instead of vite running as express middleware.
      //
      // The target is read from PORT rather than hardcoded because server/index.ts binds PORT and
      // Atlas deliberately does NOT use the default 5000 — Red and Locker Room both take it, and
      // all three get run at once. A hardcoded 5000 here proxies to whichever of those is up, so
      // /api returns another app's 404 (or, worse, its data) instead of failing loudly.
      proxy: {
        '/api': `http://localhost:${env.PORT || '5000'}`,
        // Luke's prototype is served BY Express (see server/routes/proto.ts), not by vite, because
        // the injection happens server-side and the auth is a session cookie.
        '/proto': `http://localhost:${env.PORT || '5000'}`,
      },
    },
  }
})
