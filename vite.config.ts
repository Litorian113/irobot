import type { Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'

/** The middle screen (see src/wall.ts): the promo, with the camera above it. */
const PROMO_SLOT = 4

/**
 * The gaze relay: the camera window sends where the person is to `/gaze`,
 * and every screen on the network receives it. Runs inside `vite` and `vite preview`.
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
    configureServer: (server) => attach(server.httpServer as Server | null, 'dev'),
    configurePreviewServer: (server) => attach(server.httpServer as Server, 'wall'),
  }
}

/** One link per screen, for every network this machine is on. */
function printLinks(port: number, label: string) {
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
