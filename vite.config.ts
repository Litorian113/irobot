import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { classifyExpression } from './api/expression.js'
import { mintToken } from './api/token.js'

type Result = Promise<{ status: number; body: Record<string, unknown> }>

const readJson = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
  })

/**
 * Serves the same /api endpoints Vercel runs in production, from the
 * ASSEMBLYAI_API_KEY in .env. The key stays on this side of the wire.
 */
function apiEndpoints(env: Record<string, string>): Plugin {
  const key = () => env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLYAI_API_KEY
  const routes: Record<string, (req: IncomingMessage) => Result> = {
    '/api/token': () => mintToken(key()),
    '/api/expression': async (req) => classifyExpression(key(), await readJson(req)),
  }
  const install = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void } }) => {
    for (const [path, run] of Object.entries(routes)) {
      server.middlewares.use(path, (req, res) => {
        if (req.method !== 'POST' && req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        void run(req).then((result) => {
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result.body))
        })
      })
    }
  }
  return { name: 'viki-api-endpoints', configureServer: install, configurePreviewServer: install }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), apiEndpoints(loadEnv(mode, process.cwd(), ''))],
}))
