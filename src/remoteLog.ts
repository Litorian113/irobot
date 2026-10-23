/**
 * A screen of the wall (`?slot=N`) has no one looking at its console: errors and
 * warnings go to the server, which prints them with the screen's place (see
 * vite.config.ts, /api/log). Text only, a few lines a minute at most.
 */

const slot = new URLSearchParams(window.location.search).get('slot')
const MAX_PER_MINUTE = 30
const MAX_LENGTH = 2000

let sent = 0
let windowStart = 0

function send(level: string, parts: unknown[]) {
  const now = Date.now()
  if (now - windowStart > 60_000) { windowStart = now; sent = 0 }
  if (++sent > MAX_PER_MINUTE) return
  const message = parts
    .map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : typeof part === 'string' ? part : safeJson(part)))
    .join(' ')
    .slice(0, MAX_LENGTH)
  try {
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, level, message }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* the log must never break the page */
  }
}

/** Which GPU really draws: a software renderer here explains a slow head. */
function renderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return 'kein WebGL'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return `WebGL: ${String(name)}`
  } catch (error) {
    return `WebGL-Fehler: ${String(error)}`
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

if (slot !== null) {
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      send(level, args)
    }
  }
  window.addEventListener('error', (event) => send('error', [event.message, `${event.filename}:${event.lineno}`]))
  window.addEventListener('unhandledrejection', (event) => send('error', ['Unhandled rejection:', event.reason]))
  send('info', ['geladen', navigator.userAgent, '·', renderer()])
  // How the head is doing once it had time to load: model loaded, WebGL version, frame rate.
  window.setTimeout(() => {
    const heads = (window as unknown as { __heads?: () => unknown }).__heads
    send('info', ['Kopf nach 20 s:', heads ? heads() : 'kein Kopf'])
  }, 20_000)
}
