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
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Valid long enough to cover a slow WebRTC handshake; the conversation
        // itself continues past expiry, the secret only opens the session.
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: { type: 'realtime', model: 'gpt-realtime' },
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
