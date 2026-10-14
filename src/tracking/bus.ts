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

let socket: WebSocket | null = null

/** Connect, and keep reconnecting: screens survive a server restart on their own. */
function connect() {
  if (typeof WebSocket === 'undefined') return
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gaze`)
  socket = ws
  ws.onmessage = (event) => {
    try {
      notify(JSON.parse(String(event.data)) as GazeMessage)
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

export function publish(message: GazeMessage) {
  // The relay never echoes back to the sender, so this page is told directly.
  notify(message)
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
