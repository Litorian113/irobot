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

Click **Initiate link**, allow the microphone, and talk. When she wakes up the head rises from deep inside the cube
towards the front and her eyes, brows and lips come out. Drag the cube to rotate it freely (it eases back to the front
unless you turn that off).

**Configure** opens the character panel: colors, head size and shape (jaw, chin, cheekbones, brow ridge, nose), hair,
eyes, mouth, lattice look and behaviour. Changes preview live on the active face; **Save** stores them in `localStorage`
(closing without saving discards them), **Reset to standard** returns to the built-in defaults.

> Note: `VITE_*` variables are inlined into the browser bundle. This is fine for a local prototype, but never deploy it
> publicly with a real key — mint ephemeral Realtime tokens from a small backend instead.

## Face model

The face is a real scanned human head — the **Lee Perry-Smith** head from the three.js examples
(`public/models/LeePerrySmith.glb`, © Infinite-Realities / Lee Perry-Smith, CC BY 3.0). It is rendered off-screen into a
depth + light texture that the particle lattice samples; jaw, smile and brows are procedural deformations in its vertex shader.

Dev aids: `?preview=happy` (any expression, no API calls; add `&mouth=0.7` to hold the mouth open), `?facepass=1` (shows the raw head texture), `window.__viki()`
(animated state in the console).

## Layout

- `src/viki/FacePass.ts` — head mesh rendered from four sides → depth/luminance/mask textures, expression + shape deformation
- `src/viki/config.ts` — configurator settings, defaults, persistence
- `src/ConfigPanel.tsx` — the configurator UI
- `src/viki/faceShader.ts` — GLSL: particles sample the face texture; surface shell + faint volumetric fill
- `src/viki/ParticleFace.ts` — three.js scene, bloom, easing of expression targets, blinking, parallax
- `src/viki/lipsync.ts` — band-energy analysis of the remote audio → mouth open / wide
- `src/viki/realtime.ts` — WebRTC handshake with `gpt-realtime`, event handling, tool round-trip
- `src/App.tsx` — HUD, status, captions
