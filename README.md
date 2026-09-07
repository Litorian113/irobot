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
While idle, the face dissolves completely into the data cube. It reforms when the voice connection is ready;
ending the connection disperses it again. Preview animation and Configure also reveal the head without connecting. Drag to rotate the head and data field
(it eases back to the front unless you turn that off).

Two **head styles** live in the tabs — Lattice (the surface data portrait and cube) and Dust (surface particles).
Both share the same deformed head, expressions
and lip-sync; each tab keeps its own saved configuration.

**Configure** opens the character panel for the current tab: colors, head size and shape (jaw, chin, cheekbones, brow ridge, nose), hair,
eyes, mouth, lattice look and behaviour. Changes preview live on the active face; **Save** stores them in `localStorage`
(closing without saving discards them), **Reset to standard** returns to the built-in defaults.

> Note: `VITE_*` variables are inlined into the browser bundle. This is fine for a local prototype, but never deploy it
> publicly with a real key — mint ephemeral Realtime tokens from a small backend instead.

## Face model

The default is **VikiHead.glb**, a feminine head built from MakeHuman's CC0 base mesh, female shape targets,
fitted eyeballs and Mika Suominen's CC0 face units. It contains skin, eyes and a recessed mouth interior, with
sixteen named morph targets for the jaw, lips, smile/frown, both eyelids and brows.
See [model sources and build instructions](scripts/model-source/SOURCES.md) for provenance and the bundled source archive.
No external model service is required at runtime.

All styles and the depth/helper passes share the same position/normal morphs. Lattice adds an antialiased surface
pattern, a depth prepass and a separate data cube. Eye shading is restricted to the actual eyeballs behind the lids;
eyes and mouth use one frontal point projection to avoid distorted overlapping patterns. Cube controls adjust cell
density, brightness, depth and spacing. The portrait's scalp, ears and neck fade into the data.

The previous **Lee Perry-Smith** scan remains available with `?model=legacy`
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

## Dissolve and lighting

The inactive head writes neither visible color nor depth, so it leaves no silhouette blocking the cube.
During activation/deactivation, matched surface and depth coverage dissolve the portrait while particles travel
between the animated skin and positions throughout the cube. Dust uses the same formation state. The head stays
fully formed while listening, thinking and speaking; only ending/failing the connection returns it to the cube.
The accepted head geometry, eyes and viseme rig are unchanged.

**Configure → Lighting** offers three saved presets:

- **Soft portrait**: the previous broad, gently filled lighting (no cast-shadow pass).
- **Cinema grid**: a high, nearly frontal key, minimal fill, cast shadows and a subtle projected grid.
- **Butterfly**: a centered elevated key with a little more fill and no grid by default.

**Lighting adjustment** controls key elevation (25–65°), shadow fill and projected-grid strength. The latter
applies to Cinema/Butterfly; Soft portrait disables it. Changing presets loads their lighting values only.
**Save** keeps the choice per style; closing without saving restores the saved lighting.
Cinema grid is the default for configurations without a saved lighting choice.

`HeadLight.ts` renders a 1024² light-space depth map of the same morphed head. Nose, eyelids and lips cast real
shadows, with filtered edges and a small depth bias. Lighting is shared by the portrait, Dust and cube helper pass
and stays attached to the head when it rotates. The projected grid is an artistic approximation of the reference;
it is not a reconstruction of the movie's actual lighting setup. The extra shadow pass is skipped for Soft
portrait and fully dormant states.

## Audio-driven lip sync

The assistant's remote WebRTC track feeds a local **HeadAudio** AudioWorklet. Its trained MFCC classifier identifies
15 visemes (including silence), mapped to the same head's jaw and lips. The microphone drives only the input meter;
captions are not used to guess timing. The bundled detector and model have no extra runtime service or API cost.
See [pinned HeadAudio assets and license](public/vendor/headaudio/README.md).

```
Assistant audio ─┬─ HeadAudio → timestamped visemes → smooth lip poses
                └─ adjustable delay → speakers
```

**Configure → Speech** provides:

- **Articulation**: 0.5–1.5, default 1. Smaller values give subtler lips/jaw movement.
- **Voice delay (ms)**: 40–250, default 100. Gives detection time to prepare the pose before playback.

Both settings preview live and are saved per style with **Save**. Existing v5 head/eye settings stay intact.
The animation samples the audio output clock, blends neighboring shapes, rejects isolated detection flicker,
and anticipates the sound slightly while the lips travel. B/P/M use a faster closed-lip pose and suppress the
smile; jaw opening stays modest. The last mouth movement drains with the delayed voice after the server finishes.
Interrupting speech clears both the delayed audio and queued poses. The remote-track media element is muted;
WebAudio is the single audible path. If the detector fails, voice playback continues with basic band-driven motion.

Preview animation uses a scripted viseme sequence without audio; it is not a detector accuracy test.
Use `?preview=neutral&freeze=1&viseme=PP` to inspect a fixed pose (`aa`, `E`, `I`, `O`, `U`, `PP`, `SS`, `TH`,
`DD`, `FF`, `kk`, `nn`, `RR`, `CH`, `sil`). `window.__vikiSpeech()` reports the live detector state after connecting.

This is approximate speech articulation, not exact word alignment. The supplied model was trained on English;
German audio works through the same classifier but needs voice-specific listening/visual tuning. Tongue-dependent
consonants are approximated with lip poses; the head has no animated tongue. A real conversation with the selected
Realtime voice on the target device remains the final perceptual check.

## Validation

```
npm test         # Node 22.6+; GLB, lip poses, detector model, timing, blending and silence
npm run lint
npm run build
```

Optional browser review: provide `puppeteer-core` (for example in a separate tooling directory), start the dev server,
then run `scripts/review-browser.mjs` with `PUPPETEER_MODULE` set to its module path, `CHROME_PATH` to a Chrome executable,
and `VIKI_URL` to the local server URL (default `http://127.0.0.1:5173`). `VIKI_REVIEW_DIR` selects screenshot output
(default `/tmp/viki-review`). The check uses API-free previews and a synthetic audio stream, and covers poses,
shared depth animation, both styles, configuration, saved settings and mobile controls. A real voice conversation
still needs a separate microphone/listening check.

`scripts/review-speech-browser.mjs` uses the same browser environment variables. It checks fixed visemes, the real
AudioWorklet, measured audio delay, interruption/restart and audible fallback on model failure. Optionally set
`VIKI_SPEECH_EN` and/or `VIKI_SPEECH_DE` to local WAV paths: these clips are passed through a local WebRTC peer pair
to verify remote-track detection, output and mouth closure. All tests block external requests and make no OpenAI calls.
`scripts/review-realtime-browser.mjs` separately checks start/end/interruption events and failed-handshake cleanup
with a simulated connection and the same browser setup.

## Layout

- `src/viki/HeadRig.ts` — canonical multi-part geometry and shared relative morph weights
- `src/viki/headShader.ts` — shared GLSL: morphs, proportions, hair, lighting and semantic eye/mouth shading
- `src/viki/SurfacePortrait.ts` — surface data pattern, depth occlusion and silhouette fade
- `src/viki/HeadLight.ts` — animated light-space depth map for Cinema/Butterfly cast shadows
- `src/viki/FacePass.ts` — depth/luminance/mask texture for the cube; four views in debug mode
- `src/viki/DataCube.ts` — staggered rectangular cell volume, face occlusion and cube controls
- `src/viki/sampleSurface.ts` — surface sampling that preserves the morphs for Dust
- `src/viki/styles.ts` — contour / dots / plasma / dust materials and their post passes
- `src/viki/config.ts` — configurator settings, defaults, persistence
- `src/ConfigPanel.tsx` — the configurator UI
- `src/viki/faceShader.ts` — previous particle shader, retained for reference; no longer used by the renderer
- `src/viki/ParticleFace.ts` — three.js scene, bloom, easing of expression targets, blinking, parallax
- `src/viki/SpeechOutput.ts` — single audible output, detector lifecycle, playback clock and interruption
- `src/viki/visemes.ts` — viseme timeline, temporal smoothing and authored lip poses
- `src/viki/visemeModel.ts` — decoder for the pinned HeadAudio model
- `public/audio/viseme-worklet.mjs` — local detector adapter with audio timestamps and interruption generations
- `src/viki/lipsync.ts` — microphone level meter and basic mouth fallback
- `src/viki/realtime.ts` — WebRTC handshake with `gpt-realtime`, event handling, tool round-trip
- `src/App.tsx` — HUD, status, captions
