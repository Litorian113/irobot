import { readFileSync, renameSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { networkInterfaces } from 'node:os'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'
import { PeopleCounter, VISITOR_AFTER_MS, dayKey, type Stats } from './src/analytics.ts'
import { isLayout } from './src/layout.ts'
import { DEFAULT_SCHEDULE, changes, imacsProgram, isOn, isSchedule, type Schedule } from './src/schedule.ts'

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

/** The wall's times, from the Zeitplan page. Like the custom wall: `walls/` survives every deploy. */
const SCHEDULE_FILE = 'walls/schedule.json'
/** Written by scripts/windows/plan.ps1: `command|time` of what the iMacs were last programmed with. */
const SCHEDULE_APPLIED_FILE = 'walls/schedule-applied.txt'

/**
 * GET: the schedule, whether the wall should be on, its next changes, and `command`, what the iMacs should be
 * programmed with, which scripts/windows/plan.ps1 fetches and runs. PUT: save a schedule.
 */
function scheduleApi() {
  const load = async (): Promise<Schedule> => {
    try {
      const saved = JSON.parse(await readFile(SCHEDULE_FILE, 'utf8')) as unknown
      // Never let a broken file reach a command line.
      return isSchedule(saved) ? saved : DEFAULT_SCHEDULE
    } catch {
      return DEFAULT_SCHEDULE
    }
  }
  const report = async (schedule: Schedule) => {
    const now = new Date()
    const applied = await readFile(SCHEDULE_APPLIED_FILE, 'utf8').then((text) => text.trim().split('|')).catch(() => [])
    return {
      schedule,
      on: isOn(schedule, now),
      changes: changes(schedule, now).map((change) => ({ at: change.at.getTime(), on: change.on })),
      command: imacsProgram(schedule, now),
      applied: applied.length === 2 ? { command: applied[0], at: applied[1] } : null,
    }
  }
  return (request: IncomingMessage, response: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify(body))
    }
    if (request.method === 'GET') {
      load().then(report).then((body) => send(200, body)).catch((error: unknown) => send(500, { error: String(error) }))
      return
    }
    if (request.method !== 'PUT') return send(405, { error: 'GET or PUT' })
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk
      if (body.length > 65536) request.destroy()
    })
    request.on('end', () => {
      let schedule: unknown
      try {
        schedule = (JSON.parse(body) as { schedule?: unknown }).schedule
      } catch {
        return send(400, { error: 'invalid JSON' })
      }
      if (!isSchedule(schedule)) return send(400, { error: 'expected a week and exceptions' })
      const saved = schedule
      mkdir(dirname(SCHEDULE_FILE), { recursive: true })
        .then(() => writeFile(SCHEDULE_FILE, JSON.stringify(saved, null, 2) + '\n'))
        .then(() => report(saved))
        .then((reply) => send(200, reply))
        .catch((error: unknown) => send(500, { error: String(error) }))
    })
  }
}

/**
 * Counts people from the camera's messages and keeps the numbers per hour (src/analytics.ts).
 * Lives next to the custom wall: `walls/` survives every deploy and is not in the repo.
 */
const ANALYTICS_FILE = process.env.HFG_ANALYTICS_FILE ?? 'walls/analytics.json'
/** A crash or deploy loses at most this much counting. */
const ANALYTICS_SAVE_MS = 30000
/** The camera sends many times a second: this long silent, and it is off. Nobody is seen then. */
const CAMERA_LOST_MS = 5000

function analyticsRecorder() {
  let stats: Stats = {}
  try {
    stats = JSON.parse(readFileSync(ANALYTICS_FILE, 'utf8')) as Stats
  } catch (error) {
    // Nothing counted yet is normal; an unreadable file is kept to look at, not overwritten.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[analytics] ${ANALYTICS_FILE} nicht lesbar, beginne neu:`, error)
      renameSync(ANALYTICS_FILE, `${ANALYTICS_FILE}.bad`)
    }
  }
  const counter = new PeopleCounter(stats)
  let heard = 0
  let dirty = false
  let saving = false
  const update = (seen: number, now: number) => {
    if (counter.update(seen, now)) dirty = true
  }
  setInterval(() => {
    const now = Date.now()
    if (now - heard > CAMERA_LOST_MS) update(0, now)
  }, 1000).unref()
  setInterval(() => {
    if (!dirty || saving) return
    dirty = false
    saving = true
    const temporary = `${ANALYTICS_FILE}.tmp`
    mkdir(dirname(ANALYTICS_FILE), { recursive: true })
      .then(() => writeFile(temporary, JSON.stringify(stats)))
      .then(() => rename(temporary, ANALYTICS_FILE))
      .catch((error: unknown) => {
        dirty = true
        console.warn('[analytics] Speichern ging nicht:', error)
      })
      .finally(() => { saving = false })
  }, ANALYTICS_SAVE_MS).unref()

  return {
    /** Any message on the relay; only the camera's say how many people there are. */
    hear(data: unknown) {
      try {
        const count = (JSON.parse(String(data)) as { count?: unknown }).count
        if (typeof count !== 'number') return
        heard = Date.now()
        update(count, heard)
      } catch {
        /* not ours */
      }
    },
    api(request: IncomingMessage, response: ServerResponse) {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      if (request.method !== 'GET') {
        response.statusCode = 405
        response.end(JSON.stringify({ error: 'GET' }))
        return
      }
      response.end(JSON.stringify({ days: stats, today: dayKey(new Date()), present: counter.present, visitorAfterMs: VISITOR_AFTER_MS }))
    },
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
  const analytics = analyticsRecorder()
  relay.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      if (!isBinary) analytics.hear(data)
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
  const schedule = scheduleApi()
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
      server.middlewares.use('/api/analytics', analytics.api)
      server.middlewares.use('/api/schedule', schedule)
      server.middlewares.use('/api/log', screenLogApi())
      attach(server.httpServer as Server | null, 'dev')
    },
    configurePreviewServer: (server) => {
      server.middlewares.use('/api/custom-wall', api)
      server.middlewares.use('/api/analytics', analytics.api)
      server.middlewares.use('/api/schedule', schedule)
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
    // The wall server is opened by its network name from the HfG WLAN (hfg-wall.local), not just by IP.
    preview: { allowedHosts: ['.local', 'localhost'] },
    server: { allowedHosts: ['.local', 'localhost'] },
  }
})
