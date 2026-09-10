// Mints a short-lived Realtime client secret so the real API key never
// reaches the browser. Deployed by Vercel as a serverless function; the key
// lives in the OPENAI_API_KEY environment variable (no VITE_ prefix, so it is
// never baked into the client bundle).
export default async function handler(req, res) {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    res.status(503).json({ error: 'voice-offline' })
    return
  }
  // The client may request a specific model (the Skynet duet needs the older,
  // more permissive one); allowlist it so only known models are ever minted.
  const ALLOWED = ['gpt-realtime-2.1', 'gpt-realtime']
  let model = 'gpt-realtime-2.1'
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (body && ALLOWED.includes(body.model)) model = body.model
  } catch {
    /* no/invalid body — keep the default */
  }
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Valid long enough to cover a slow WebRTC handshake; the conversation
        // itself continues past expiry, the secret only opens the session.
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: { type: 'realtime', model },
      }),
    })
    if (!upstream.ok) {
      res.status(502).json({ error: 'mint-failed' })
      return
    }
    const data = await upstream.json()
    res.status(200).json({ value: data.value })
  } catch {
    res.status(502).json({ error: 'mint-failed' })
  }
}
