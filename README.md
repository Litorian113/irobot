# V.I.K.I. — particle-face voice hero

A single full-page hero inspired by the V.I.K.I. scene in *I, Robot*: a human face formed by fine points of light
inside a layered cube of rectangular light cells. Voice comes from OpenAI's Realtime API (WebRTC); the mouth is driven by live audio analysis
of her voice, and expressions are chosen by the model itself through a `set_expression` tool.

## Run

```
cp .env.example .env   # then put your key in VITE_OPENAI_API_KEY
npm install
npm run dev
```

Click **Preview animation** to inspect the talking face without a microphone or API call.
Click **Initiate link**, allow the microphone, and talk to connect the real voice.
The portrait stays visible while idle and becomes clearer when connected. Drag to rotate the head and data field
(it eases back to the front unless you turn that off).

Five **head styles** live in the tabs — Lattice (the surface data portrait and cube), Contour (topographic lines), Dots (LED
matrix), Plasma (blurred colour flame) and Dust (surface particles). All of them share the same deformed head, expressions
and lip-sync; each tab keeps its own saved configuration.

**Configure** opens the character panel for the current tab: colors, head size and shape (jaw, chin, cheekbones, brow ridge, nose), hair,
eyes, mouth, lattice look and behaviour. Changes preview live on the active face; **Save** stores them in `localStorage`
(closing without saving discards them), **Reset to standard** returns to the built-in defaults.

> Note: `VITE_*` variables are inlined into the browser bundle. This is fine for a local prototype, but never deploy it
> publicly with a real key — mint ephemeral Realtime tokens from a small backend instead.

## Face model

The default is **VikiHead.glb**, a feminine head built from MakeHuman's CC0 base mesh, female shape targets,
fitted eyeballs and Mika Suominen's CC0 face units. It contains skin, eyes and a recessed mouth interior, with
nine named morph targets for the jaw, lip width/rounding, smile/frown, both eyelids and brows.
See [model sources and build instructions](scripts/model-source/SOURCES.md) for provenance and the bundled source archive.
No external model service is required at runtime.

All styles and the depth/helper passes share the same position/normal morphs. Lattice adds an antialiased surface
pattern, a depth prepass and a separate data cube. Eye shading is restricted to the actual eyeballs behind the lids;
eyes and mouth use one frontal point projection to avoid distorted overlapping patterns. Cube controls adjust cell
density, brightness, depth and spacing. The portrait's scalp, ears and neck fade into the data.

Audio analysis drives opening, width and rounding; it approximates speech motion from band energies, without
phoneme recognition. The previous **Lee Perry-Smith** scan remains available with `?model=legacy`
(`public/models/LeePerrySmith.glb`, © Infinite-Realities / Lee Perry-Smith, CC BY 3.0).

Settings now use `viki.config.v5.*`. Previous v3/v4 settings remain stored. New defaults apply automatically until
a v5 configuration is saved; use **Reset to standard** to restore them.

Dev aids: `?preview=happy` (any expression, no API calls), `?style=dots` (open a tab), `?facepass=1` (raw head textures),
`?inspect=1` (opaque gray diagnostic in Lattice), and `window.__viki()` (animated state).

To inspect speech without connecting, open **Configure** and enable its speech test, or use
`?preview=neutral` for animated speech. `&mouth=0` holds the lips closed; `&mouth=1` holds them open.
The preview includes phrase pauses. Blinking closes and opens smoothly, and the default expression has a slight smile.
Add `&wide=0.8&round=0.1` to compare lip shapes independently. Deterministic comparisons use
`?preview=neutral&mouth=0&freeze=1`: time and pose settle immediately, natural swaying/blinking pause.
Add `&blink=1` for closed lids (`0.5` for halfway), `&yaw=35&pitch=0` for rotation in degrees, or `&time=2` for a fixed shimmer time.

## Validation

```
npm test         # Node 22.6+; actual GLB, morphs, transforms and sampled particles
npm run lint
npm run build
```

Optional browser review: provide `puppeteer-core` (for example in a separate tooling directory), start the dev server,
then run `scripts/review-browser.mjs` with `PUPPETEER_MODULE` set to its module path, `CHROME_PATH` to a Chrome executable,
and `VIKI_URL` to the local server URL (default `http://127.0.0.1:5173`). `VIKI_REVIEW_DIR` selects screenshot output
(default `/tmp/viki-review`). The check uses API-free previews and a synthetic audio stream, and covers poses,
shared depth animation, all five styles, configuration, saved settings and mobile controls. A real voice conversation
still needs a separate microphone/listening check.

## Layout

- `src/viki/HeadRig.ts` — canonical multi-part geometry and shared relative morph weights
- `src/viki/headShader.ts` — shared GLSL: morphs, proportions, hair, lighting and semantic eye/mouth shading
- `src/viki/SurfacePortrait.ts` — surface data pattern, depth occlusion and silhouette fade
- `src/viki/FacePass.ts` — depth/luminance/mask texture for the cube; four views in debug mode
- `src/viki/DataCube.ts` — staggered rectangular cell volume, face occlusion and cube controls
- `src/viki/sampleSurface.ts` — surface sampling that preserves the morphs for Dust
- `src/viki/styles.ts` — contour / dots / plasma / dust materials and their post passes
- `src/viki/config.ts` — configurator settings, defaults, persistence
- `src/ConfigPanel.tsx` — the configurator UI
- `src/viki/faceShader.ts` — previous particle shader, retained for reference; no longer used by the renderer
- `src/viki/ParticleFace.ts` — three.js scene, bloom, easing of expression targets, blinking, parallax
- `src/viki/lipsync.ts` — band-energy analysis of the remote audio → mouth open / wide / round
- `src/viki/realtime.ts` — WebRTC handshake with `gpt-realtime`, event handling, tool round-trip
- `src/App.tsx` — HUD, status, captions
