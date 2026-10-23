import type { Vec3 } from './gaze'

/**
 * The only thing that travels between screens: whether someone is there and
 * where their face is, in wall metres. No image data, no identity.
 *
 * Every page connects to the relay at `/gaze` on the machine that serves it
 * (see vite.config.ts); the camera page sends, all screens receive.
 */
export interface GazeMessage {
  present: boolean
  person: Vec3 | null
  /** How many people are in view. */
  count: number
}

type Listener = (message: GazeMessage) => void

const listeners = new Set<Listener>()
const notify = (message: GazeMessage) => { for (const listener of listeners) listener(message) }

/** The server says a custom wall was saved (see vite.config.ts). */
type WallListener = (wall: string) => void
const wallListeners = new Set<WallListener>()

let socket: WebSocket | null = null
/** When the relay was last heard from; it sends a heartbeat every 5 s (vite.config.ts). */
let heard = 0
/** No heartbeat for this long: the connection died without saying so (a server reboot). */
const SILENT_MS = 15000

/** Connect, and keep reconnecting: screens survive a server restart on their own. */
function connect() {
  if (typeof WebSocket === 'undefined') return
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gaze`)
  socket = ws
  heard = Date.now()
  ws.onmessage = (event) => {
    heard = Date.now()
    try {
      const data = JSON.parse(String(event.data)) as GazeMessage | { kind: 'wall-saved' | 'tick'; wall?: string }
      if ('kind' in data) {
        if (data.kind === 'wall-saved') for (const listener of wallListeners) listener(data.wall ?? '')
        return
      }
      notify(data)
    } catch {
      /* ignore malformed messages */
    }
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    window.setTimeout(connect, 1000)
  }
}
connect()

// A connection that went silent is dropped and opened afresh, without waiting for it to time out.
if (typeof WebSocket !== 'undefined') {
  window.setInterval(() => {
    const ws = socket
    if (!ws || ws.readyState !== WebSocket.OPEN || Date.now() - heard < SILENT_MS) return
    ws.onclose = null
    ws.onmessage = null
    ws.close()
    socket = null
    connect()
  }, 5000)
}

export function publish(message: GazeMessage) {
  // The relay never echoes back to the sender, so this page is told directly.
  notify(message)
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function onWallSaved(listener: WallListener) {
  wallListeners.add(listener)
  return () => { wallListeners.delete(listener) }
}
