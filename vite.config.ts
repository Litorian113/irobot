import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { networkInterfaces } from 'node:os'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'
import { isLayout } from './src/layout.ts'

/** The middle screen (see src/wall.ts): the promo, with the camera above it. */
const PROMO_SLOT = 4

/** How often the relay tells every screen it is still there. */
const HEARTBEAT_MS = 5000

/** The custom wall built in the editor tab, shared by every screen (`?wall=custom`). */
const CUSTOM_WALL_FILE = 'walls/custom.json'

/**
 * GET returns the saved wall: `{ layout }` (rows of screens, src/layout.ts), or `{ keys }` for a
 * wall saved as nine keys before rows existed, or nothing. PUT saves a layout and tells every screen.
 */
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
        .then((text) => {
          const saved = JSON.parse(text) as unknown
          send(200, Array.isArray(saved) ? { keys: saved } : { layout: (saved as { layout?: unknown }).layout ?? null })
        })
        .catch(() => send(200, { layout: null }))
      return
    }
    if (request.method !== 'PUT') return send(405, { error: 'GET or PUT' })
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk
      if (body.length > 16384) request.destroy()
    })
    request.on('end', () => {
      let layout: unknown
      try {
        layout = (JSON.parse(body) as { layout?: unknown }).layout
      } catch {
        return send(400, { error: 'invalid JSON' })
      }
      if (!isLayout(layout)) return send(400, { error: 'expected rows of {slot, key}' })
      mkdir(dirname(CUSTOM_WALL_FILE), { recursive: true })
        .then(() => writeFile(CUSTOM_WALL_FILE, JSON.stringify({ layout }, null, 2) + '\n'))
        .then(() => {
          broadcast({ kind: 'wall-saved', wall: 'custom' })
          send(200, { layout })
        })
        .catch((error: unknown) => send(500, { error: String(error) }))
    })
  }
}

/** Screens of the wall post their console errors here (src/remoteLog.ts); printed with their place. */
function screenLogApi() {
  return (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      response.statusCode = 405
      return response.end()
    }
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk
      if (body.length > 8192) request.destroy()
    })
    request.on('end', () => {
      response.statusCode = 204
      response.end()
      try {
        const { slot, level, message } = JSON.parse(body) as { slot?: unknown; level?: unknown; message?: unknown }
        const from = request.socket.remoteAddress?.replace('::ffff:', '') ?? '?'
        const time = new Date().toLocaleTimeString('de-DE')
        console.log(`  ${time} [Platz ${String(slot)} ${from}] ${String(level)}: ${String(message).slice(0, 2000)}`)
      } catch {
        /* not a log line */
      }
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
  // A heartbeat: screens only listen, so without it they never notice a connection that died
  // with a server reboot, and wait on it forever (src/tracking/bus.ts reconnects when it stops).
  setInterval(() => broadcast({ kind: 'tick' }), HEARTBEAT_MS).unref()
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
      server.middlewares.use('/api/log', screenLogApi())
      attach(server.httpServer as Server | null, 'dev')
    },
    configurePreviewServer: (server) => {
      server.middlewares.use('/api/custom-wall', api)
      server.middlewares.use('/api/log', screenLogApi())
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
