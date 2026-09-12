// Mints a single-use AssemblyAI Voice Agent token so the real API key never
// reaches the browser. Deployed by Vercel as a serverless function and served
// locally by the Vite dev server (see vite.config.ts); the key lives in the
// ASSEMBLYAI_API_KEY environment variable (no VITE_ prefix, so it is never
// baked into the client bundle).
const TOKEN_URL = 'https://agents.assemblyai.com/v1/token'

/**
 * @param {string | undefined} key
 * @param {{ expiresIn?: number, maxSession?: number }} [options]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function mintToken(key, { expiresIn = 300, maxSession = 7200 } = {}) {
  if (!key) return { status: 503, body: { error: 'voice-offline' } }
  try {
    const url = new URL(TOKEN_URL)
    // The token only has to survive the WebSocket handshake; the conversation
    // itself may run up to maxSession seconds (the API caps it at 3 hours and
    // ends the session without warning when the cap is hit).
    url.searchParams.set('expires_in_seconds', String(expiresIn))
    url.searchParams.set('max_session_duration_seconds', String(maxSession))
    const upstream = await fetch(url, { headers: { Authorization: `Bearer ${key}` } })
    if (!upstream.ok) return { status: 502, body: { error: 'mint-failed', status: upstream.status } }
    const data = await upstream.json()
    if (typeof data.token !== 'string') return { status: 502, body: { error: 'mint-failed' } }
    return { status: 200, body: { token: data.token } }
  } catch {
    return { status: 502, body: { error: 'mint-failed' } }
  }
}

export default async function handler(_req, res) {
  const result = await mintToken(process.env.ASSEMBLYAI_API_KEY)
  res.status(result.status).json(result.body)
}
