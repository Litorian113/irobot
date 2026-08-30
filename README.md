# V.I.K.I. — particle-face voice hero

A single full-page hero inspired by the V.I.K.I. scene in *I, Robot*: a 3-D lattice of light particles that forms
a face and talks to you. Voice comes from OpenAI's Realtime API (WebRTC); the mouth is driven by live audio analysis
of her voice, and expressions are chosen by the model itself through a `set_expression` tool.

## Run

```
cp .env.example .env   # then put your key in VITE_OPENAI_API_KEY
npm install
npm run dev
```

Click **Initiate link**, allow the microphone, and talk.

> Note: `VITE_*` variables are inlined into the browser bundle. This is fine for a local prototype, but never deploy it
> publicly with a real key — mint ephemeral Realtime tokens from a small backend instead.

## Layout

- `src/viki/faceShader.ts` — GLSL: procedural face height-field evaluated per particle (mouth, brows, eyes, smile as uniforms)
- `src/viki/ParticleFace.ts` — three.js scene, bloom, easing of expression targets, blinking, parallax
- `src/viki/lipsync.ts` — band-energy analysis of the remote audio → mouth open / wide
- `src/viki/realtime.ts` — WebRTC handshake with `gpt-realtime`, event handling, tool round-trip
- `src/App.tsx` — HUD, status, captions
