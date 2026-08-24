import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'client', 'src'),
    },
  },
  root: path.resolve(import.meta.dirname, 'client'),
  build: {
    // server/index.ts resolves this same path when NODE_ENV=production — keep the two in step.
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    // Two processes in dev (npm run dev + npm run dev:server), so the client proxies the API
    // instead of vite running as express middleware.
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
