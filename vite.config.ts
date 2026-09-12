import type { IncomingMessage, ServerResponse } from 'node:http'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { mintToken } from './api/token.js'

type Result = Promise<{ status: number; body: Record<string, unknown> }>

/**
 * Serves the same /api endpoint Vercel runs in production, from the
 * ASSEMBLYAI_API_KEY in .env. The key stays on this side of the wire.
 */
function apiEndpoints(env: Record<string, string>): Plugin {
  const key = () => env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLYAI_API_KEY
  const routes: Record<string, (req: IncomingMessage) => Result> = {
    '/api/token': () => mintToken(key()),
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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Microphones need a secure origin. `npm run dev:https` serves a self-signed
  // certificate so the prototype can be tried from another device on the LAN.
  const https = env.VIKI_HTTPS === '1' || process.env.VIKI_HTTPS === '1'
  return { plugins: [react(), apiEndpoints(env), ...(https ? [basicSsl()] : [])] }
})
