// Picks the facial expression for the reply she is about to give. The Voice
// Agent API cannot run a silent client tool mid-reply (every tool.result spawns
// another spoken reply), so the head's mood comes from a tiny LLM Gateway call
// on the user's final transcript instead - it runs while she is still
// "thinking", so the face is set before her voice starts. The gateway is rate
// limited per model, so a keyword heuristic answers whenever it is throttled.
// Vercel serverless function; the Vite dev server serves the same handler
// (see vite.config.ts).
const GATEWAY_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions'
// Small, AssemblyAI-hosted and fast (~0.6 s); the reply is a single word.
const MODEL = 'qwen3.5-4b-32k-fast'
export const EXPRESSIONS = ['neutral', 'happy', 'curious', 'thinking', 'surprised', 'concerned', 'sad', 'stern']
const CHARACTERS = {
  viki: 'V.I.K.I. - calm, coldly logical, composed, faintly ominous; rarely happy, often stern or curious',
  dust: 'D.U.S.T. - deeply warm and friendly, openhearted, easily delighted, caring when someone is hurting',
  lattice: 'M.A.X. - very funny, quick-witted, playful, mostly happy or surprised, kind when it matters',
}

// When the gateway is throttled or down, a keyword reading keeps the face alive.
const CUES = [
  ['sad', /\b(died|death|dead|funeral|cry|crying|grief|lonely|miss (him|her|them)|heartbroken|depress)/i],
  ['concerned', /\b(sorry|hurt|sick|ill|scared|afraid|worried|danger|help me|lost my|broke|pain|problem)/i],
  ['stern', /\b(stop|shut up|wrong|hate|angry|stupid|idiot|liar|obey|command|order you)/i],
  ['surprised', /\b(wow|really|no way|what\?!|seriously|unbelievable|whoa|omg|can't believe)/i],
  ['happy', /\b(joke|funny|haha|lol|love|great|awesome|thank|thanks|nice|wonderful|happy|congrat|birthday|cool)/i],
  ['thinking', /\b(why|how|explain|what do you think|opinion|philosoph|meaning|consider|difference between)/i],
]

/** @param {string} text @param {string} [style] */
export function heuristicExpression(text, style) {
  const said = String(text ?? '')
  for (const [expression, re] of CUES) if (re.test(said)) return expression
  if (/\?\s*$/.test(said.trim())) return 'curious'
  if (/!\s*$/.test(said.trim())) return style === 'viki' ? 'neutral' : 'happy'
  return 'neutral'
}

/**
 * @param {string | undefined} key
 * @param {{ style?: string, text?: string }} input
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function classifyExpression(key, { style, text } = {}) {
  if (!key) return { status: 503, body: { error: 'voice-offline' } }
  const character = CHARACTERS[style] ?? CHARACTERS.viki
  const said = String(text ?? '').trim().slice(0, 600)
  if (!said) return { status: 400, body: { error: 'no-text' } }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { authorization: key, 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You choose the facial expression an AI character shows while answering the person in front of it. Character: ${character}. Reply with exactly one word from this list and nothing else: ${EXPRESSIONS.join(', ')}.`,
          },
          { role: 'user', content: `The person just said: "${said}"` },
        ],
      }),
    })
    if (!res.ok) return { status: 200, body: { expression: heuristicExpression(said, style), source: 'heuristic', gateway: res.status } }
    const data = await res.json()
    const words = String(data.choices?.[0]?.message?.content ?? '').toLowerCase().match(/[a-z]+/g) ?? []
    const expression = words.find((w) => EXPRESSIONS.includes(w))
    return expression
      ? { status: 200, body: { expression, source: 'gateway' } }
      : { status: 200, body: { expression: heuristicExpression(said, style), source: 'heuristic' } }
  } catch {
    return { status: 200, body: { expression: heuristicExpression(said, style), source: 'heuristic' } }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end()
    return
  }
  let body = {}
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {}
  } catch {
    /* empty body */
  }
  const result = await classifyExpression(process.env.ASSEMBLYAI_API_KEY, body)
  res.status(result.status).json(result.body)
}
