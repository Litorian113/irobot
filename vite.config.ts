import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { networkInterfaces } from 'node:os'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'

/** The middle screen (see src/wall.ts): the promo, with the camera above it. */
const PROMO_SLOT = 4

/** The custom wall built in the editor tab, shared by every screen (`?wall=custom`). */
const CUSTOM_WALL_FILE = 'walls/custom.json'
const WALL_KEY = /^[a-z0-9-]{1,40}$/

function isWall(value: unknown): value is (string | null)[] {
  return Array.isArray(value) && value.length === 9
    && value.every((key) => key === null || (typeof key === 'string' && WALL_KEY.test(key)))
}

/** GET returns the saved wall (or null), PUT saves one and tells every screen. */
function customWallApi(broadcast: (message: unknown) => void) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify(body))
    }
    if (request.method === 'GET') {
      readFile(CUSTOM_WALL_FILE, 'utf8')
        .then((text) => send(200, { keys: JSON.parse(text) as unknown }))
        .catch(() => send(200, { keys: null }))
      return
    }
    if (request.method !== 'PUT') return send(405, { error: 'GET or PUT' })
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk
      if (body.length > 4096) request.destroy()
    })
    request.on('end', () => {
      let keys: unknown
      try {
        keys = (JSON.parse(body) as { keys?: unknown }).keys
      } catch {
        return send(400, { error: 'invalid JSON' })
      }
      if (!isWall(keys)) return send(400, { error: 'expected nine keys or nulls' })
      mkdir(dirname(CUSTOM_WALL_FILE), { recursive: true })
        .then(() => writeFile(CUSTOM_WALL_FILE, JSON.stringify(keys, null, 2) + '\n'))
        .then(() => {
          broadcast({ kind: 'wall-saved', wall: 'custom' })
          send(200, { keys })
        })
        .catch((error: unknown) => send(500, { error: String(error) }))
    })
  }
}

/**
 * The gaze relay: the camera window sends where the person is to `/gaze`,
 * and every screen on the network receives it. Also serves the custom wall.
 * Runs inside `vite` and `vite preview`.
 */
function gazeRelay(): Plugin {
  const relay = new WebSocketServer({ noServer: true })
  relay.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      for (const client of relay.clients) {
        if (client !== socket && client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
      }
    })
  })
  const broadcast = (message: unknown) => {
    const text = JSON.stringify(message)
    for (const client of relay.clients) if (client.readyState === WebSocket.OPEN) client.send(text)
  }
  const api = customWallApi(broadcast)
  const attach = (httpServer: Server | null, label: string) => {
    httpServer?.on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith('/gaze')) return // Vite's own live-reload socket
      relay.handleUpgrade(request, socket, head, (client) => relay.emit('connection', client, request))
    })
    httpServer?.once('listening', () => {
      const address = httpServer.address()
      if (address && typeof address === 'object') printLinks(address.port, label)
    })
  }
  return {
    name: 'irobot-gaze-relay',
    configureServer: (server) => {
      server.middlewares.use('/api/custom-wall', api)
      attach(server.httpServer as Server | null, 'dev')
    },
    configurePreviewServer: (server) => {
      server.middlewares.use('/api/custom-wall', api)
      attach(server.httpServer as Server, 'wall')
    },
  }
}

/** One link per screen, for every network this machine is on. */
function printLinks(port: number, label: string) {
  if (process.env.HFG_QUIET) return // e.g. the snapshot script
  const addresses = Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address)
  const lines = [``, `  HfG Köpfe (${label})`, ``, `  Kamera (dieser Rechner):  http://localhost:${port}/?slot=${PROMO_SLOT}&camera=1&preview=1`]
  for (const ip of addresses) {
    lines.push(``, `  Screens über ${ip}:`)
    for (let slot = 0; slot < 9; slot++) {
      lines.push(`    ${slot}${slot === PROMO_SLOT ? ' (Mitte)' : '        '}  http://${ip}:${port}/?slot=${slot}`)
    }
  }
  if (!addresses.length) lines.push(``, `  Kein Netzwerk gefunden - Kabel / WLAN prüfen.`)
  console.log(lines.join('\n') + '\n')
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Cameras need a secure origin. `npm run dev:https` serves a self-signed
  // certificate so the camera can also live on another machine than the server.
  const https = env.VIKI_HTTPS === '1' || process.env.VIKI_HTTPS === '1'
  return {
    plugins: [react(), gazeRelay(), ...(https ? [basicSsl()] : [])],
    // The iMacs run OS X 10.11: Chrome 103 at most (Firefox ESR 78 as a fallback).
    build: { target: ['chrome87', 'firefox78', 'safari14'] },
    // ONNX Runtime locates its .wasm files next to its own module; pre-bundling would move it.
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    worker: { format: 'es' },
  }
})
