# V.I.K.I. — Technical Reference

The full engineering documentation. For the showcase, see the [README](../README.md).

## Run

```
cp .env.example .env   # then put your AssemblyAI key in ASSEMBLYAI_API_KEY
npm install
npm run dev
```

Click **Preview animation** to inspect the talking face without a microphone or API call.
Click **Initiate link**, allow the microphone, and talk to connect the real voice.
While idle, the face dissolves completely into the data cube. It reforms when the voice connection is ready;
ending the connection disperses it again. Preview animation and Configure also reveal the head without connecting. Drag to rotate the head and data field
(it eases back to the front unless you turn that off).

Three **head styles** live in the tabs — Lattice (the surface data portrait and cube), Dust (surface particles),
and VIKI (a mirrored, silver-green tiled cube). All share the same deformed head, expressions
and lip-sync; each tab keeps its own saved configuration.

**Configure** opens the character panel for the current tab: colors, head size and shape (jaw, chin, cheekbones, brow ridge, nose), hair,
eyes, mouth, lattice look and behaviour. Changes preview live on the active face; **Save** stores them in `localStorage`
(closing without saving discards them), **Reset to standard** returns to the built-in defaults.

> The key stays server-side. `api/token.js` mints single-use Voice Agent tokens; Vercel deploys it as a serverless
> function and `vite.config.ts` serves the same handler during `npm run dev` / `vite preview`, reading
> `ASSEMBLYAI_API_KEY` from `.env`.

## Voice pipeline

One WebSocket to `wss://agents.assemblyai.com/v1/ws?token=…` carries the whole conversation
(`src/viki/voiceAgent.ts`):

- **Capture** — `public/audio/pcm-capture-worklet.mjs` takes the AudioContext's native rate, linearly resamples to
  24 kHz mono PCM16 and posts 50 ms chunks, sent as `input.audio` once `session.ready` arrived. The context keeps
  its default rate on purpose: Firefox only feeds its echo canceller from the default graph and Safari ignores a
  requested rate. Echo cancellation stays on, noise suppression off (the server denoises already).
- **Session** — the first `session.update` carries the persona's `system_prompt`, the voice (`anna`, `eve`,
  `george`) and PCM formats inline; no stored agent is needed. `setPersona` sends a new `system_prompt`; the voice
  is immutable for the session.
- **Playback** — `reply.audio` chunks are decoded by `src/viki/PcmPlayer.ts` and scheduled back to back on the
  audio clock, then routed through `SpeechOutput.attachNode` into the same delay line and viseme detector the
  WebRTC track used before. `reply.done` only ends the *speaking* state once the scheduled tail has been heard.
- **Turns** — `src/viki/agentEvents.ts` maps `input.speech.*`, `reply.*`, `transcript.*` and `session.*` onto the
  head's status machine. Barge-in is semantic and decided server-side: `reply.done` with `status: "interrupted"`
  flushes the player and the delay line.
- **Greeting** — sent as `reply.create` once the face has formed (the API's own `greeting` would speak on connect).
- **Expression** — the persona rules make the model open every reply with a tag such as `[[curious]]`. Measured
  live: the TTS renders a double-bracket tag as a ~0.1–0.3 s pause and never as a word (single brackets, parentheses
  and asterisks *are* spoken), and the word-aligned `transcript.agent.delta` stream delivers the tag as the first
  word starts playing. `agentEvents.ts` turns it into `onExpression` and strips it from captions. A client tool
  cannot do this job on this API: every `tool.result` auto-fires another spoken reply, and an unanswered call makes
  the agent apologise after its timeout.
- **Teardown** — `disconnect` sends `session.end` before closing (a bare close leaves a billable 30 s resume
  window); `pagehide` does the same when the tab goes away.

The AssemblyAI documentation MCP server is registered in `.mcp.json` for Claude Code, so protocol questions
can be answered from the live docs while working on this file.

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

Dev aids: `?preview=happy` (any expression, no API calls), `?style=viki` (or `lattice` / `dust`, open a tab), `?facepass=1` (raw head textures),
`?inspect=1` (opaque gray diagnostic in Lattice), and `window.__viki()` (animated state).

To inspect speech without connecting, open **Configure** and enable its speech test, or use
`?preview=neutral` for animated speech. `&mouth=0` holds the lips closed; `&mouth=1` holds them open.
The preview includes phrase pauses. Blinking closes and opens smoothly, and the default expression has a slight smile.
Add `&wide=0.8&round=0.1` to compare lip shapes independently. Deterministic comparisons use
`?preview=neutral&mouth=0&freeze=1`: time and pose settle immediately, natural swaying/blinking pause.
Add `&blink=1` for closed lids (`0.5` for halfway), `&yaw=35&pitch=0` for rotation in degrees, or `&time=2` for a fixed shimmer time.

## Dust particle clouds and radial filter

While inactive, Dust expands into a full-screen particle volume: slow violet/blue cloud currents, small eddies,
sparse twinkling points and soft Gaussian haze. The field fits the camera frustum on wide and narrow screens,
independently of the head's size. Activation gathers those same particles into the existing head; disconnecting
releases them into the clouds again. The fully formed head keeps its original placement, point sizes and shading.
A quiet fringe of background dust remains at the left and right while active, softened by the existing radial filter.
**Dust → Configure → Cloud glow** adjusts the surrounding haze (using the existing saved Cage value).

The flow runs in the vertex shaders, using the existing head particles and 3,500 cage points. It needs no extra
particles, draw calls, textures or render targets. Some cage points become larger, faint haze sprites while idle,
so there is additional fragment work for their soft glow. The wide resting field is exclusive to Dust; Lattice's
transition keeps its original cube positions.

**Dust → Configure → Radial blur** keeps the center of the face sharp while stretching the surrounding particles
and their glow outward, like a radial zoom lens. The default strength is **0.70**; **0** restores the original Dust
rendering and skips the filter pass entirely. The blur fades in as the head forms and fades out as it dissolves;
inactive dust bypasses the filter. The focus follows the head's height, size, rotation and viewport framing.
It affects the rendered Dust scene; HTML controls and captions stay sharp. Saved Dust settings retain their other values.

`DustRadialBlur.ts` runs after bloom and before tone mapping. An elliptical falloff protects the eyes, nose and lips;
32 weighted samples soften the outer trails, with stable subpixel offsets to avoid repeated-dot banding. The pass reuses
the composer's existing buffers, adds no render targets, and preserves particle count, drawing resolution and frame cadence.
Lattice and VIKI bypass it. The pass material is released by the renderer's existing disposal path.

Run `node scripts/review-dust-browser.mjs` against the local server (`VIKI_URL`, optional `PUPPETEER_MODULE` and
`CHROME_PATH`). It checks the actual GPU output for an unchanged center and a zero-strength bypass, plus head tracking,
mobile framing, save/discard/reset, style switching and resource disposal without connecting the microphone or API.

## VIKI mirrored display

The independent **VIKI** tab uses muted silver, green-gray shadows and slightly warm highlights. Six outward-facing
tiled windows look into a 3D interior containing the actual animated head, mirrored on alternating faces. Mouth poses,
blinks and expressions stay synchronized. Each visible window renders its own perspective from the viewer's position,
so the nose, cheeks, foreground cells and rear layers have different parallax. Approximate refraction moderates grazing
angles. These are views into a shared virtual scene, rather than ray-traced reflections between physical mirrors.
The default corner view exposes two faces; dragging reveals the back, sides, top and bottom.

Individual tiles vary in size and intensity. Multiple short, 3–5-cell light trails turn left, right, up and down along
independent paths, suggesting local refreshes of the image. They run across the head tiles, data layers and inner walls.
The tiles are attached to the head's 3D surface, so they follow its contours and speech movements.
Four transparent matrix layers share that same tile spacing, fill and moving light pattern, extending it in front of
and behind the head. Their different depths produce parallax, while the inner walls continue the grid around the sides
and floor. Feathered edges and uneven brightness let parts of the enclosure disappear into darkness.
Local transmission diffusion and halation soften the light without bending the face. Slightly translucent windows
let the hall show through, while the eye sockets retain their shadows. VIKI's Bloom control changes the local optical
glow; the hall's existing bloom strength remains fixed at 0.46, so adjusting the hologram does not relight the backdrop.

Activation takes about **3.2 seconds**: columns of seven tiles descend from the top and assemble the cube.
Each column has its own start delay and travel duration, so some are settling while others have not yet arrived.
The face emerges during the final part of the sequence. Deactivation takes about **2.2 seconds**: the face fades,
the remaining tiles retract from bottom to top and the columns lift away at their individual timings. A disconnect or reconnect during the
sequence reverses from its current progress. When dormant the cube is fully absent and its interior captures stop.
The same sequence runs through the mic/session state and the **Preview** button, including connection setup.

Adjacent windows meet without transparent edge gutters, eliminating the bright hall-colored seams. A normalized
3×3 Gaussian kernel blends the visible tile layer with the matrix behind it; a wider highlight halo gives a soft
optical glow. Its radius varies slightly across the pane without displacing the underlying geometry.
The **VIKI shadows** lighting mode adds localized exposure pools over the forehead, nose bridge, upper cheeks and
lower lip. These multiply the existing lit skin, preserving socket and cavity shadows, and apply only to the VIKI
display. Sparse tiles glitter with smoothly pulsing, independently timed brightness; Pixel movement zero removes
their animation too. Existing saved colours, lighting and shape settings remain intact.

Inside the formed cube, **140 independent streams of 5–7 tiles** travel from a small rear-center region toward the
front window. These are moving 3D quads with depth occlusion and parallax, alongside the existing surface refresh
chains. Each tile is softened and stretched along its projected velocity to suggest a short exposure; no frame-history
blur is applied to the face, hall or UI. Pixel movement controls both layers; Flow speed controls their travel rate.

**Configure → VIKI display** offers **Pixel movement**, **Flow speed**, **Tile density**, **Tile fill**, **Background tiles**,
**Cube depth**, **Head recess**, **Tile diffusion**, brightness and bloom. Head recess moves the whole head farther
behind the window; Cube depth changes the outer enclosure's proportions. Set Pixel movement to zero to remove the animated light layer.
**Background tiles** controls the surrounding matrix independently of **Face brightness**, so a dimmer head does not
erase the cube. The film-inspired preset uses face brightness **0.66**, density **0.51**, tile fill
**0.78**, pixel movement **1.00**, flow speed **0.70**, background tiles **0.85**, cube depth **1.00**, head recess **0.00**,
diffusion **0.80**, local bloom **0.65**, key elevation **50°** and shadow fill **0.01**. The finalized head size **0.50**,
height **−0.59**, cube scale **0.44** and hall placement **(−1.60, 0.64)** are preserved. Narrow screens pull the
camera back only enough to keep that left-side placement visible; the established wide-screen framing stays the same.
Shape adjustments remain zero. Existing saved settings are preserved; use **Reset to standard** to adopt the new preset.
Save/Reset apply only to VIKI (`viki.config.v5.viki`). Dust and Lattice retain their existing defaults and materials.
The extra scene is allocated only when VIKI is first selected. It shares the original geometry and pose array.
Only windows facing the viewer render their interiors (up to three passes), into targets capped at 640²; hidden windows
skip rendering. This costs more GPU work than the previous flat portraits. No extra portrait passes run in Dust or Lattice.
The four matrix layers use one instanced draw per visible window (eight triangles), sharing the existing pixel-chain
texture and render targets. They add no new full-scene passes or render targets, and do not reduce existing particle counts.
Travelling depth tiles add one instanced draw per visible window; assembly columns add one point draw only during
the transition. All buffers are allocated once and disposed with the renderer. The additional glow uses thirteen local
texture samples per window pixel; it does add GPU work, without reducing particles, resolution or frame-rate targets.
Preview without connecting: `?style=viki&preview=neutral`; use `&mouth=0` to inspect only the moving tiles.
For a frozen assembly stage, append `&freeze=1&assembly=0.35` (0 = dormant, 1 = complete).

The VIKI shadow pass reuses its 1024² map when its exact geometry, pose and light inputs are unchanged. Speaking,
blinking, shape edits and light movement invalidate it; viewing-camera movement and pixel flow do not. The invisible
head is not submitted at formation zero, while all 19,040 interior data particles remain. That optimization preserves
resolution, head geometry, particle counts and frame-rate targets.

Chain motion shares one 128² RG texture between the materials. It uploads only when the chains advance a cell;
interpolation between steps runs on the GPU. Renderer teardown explicitly releases the post-processing passes and
their targets as well as the chain texture. Hidden tabs already pause the animation loop.

A bounded local still-pose comparison at 1000²/DPR 1 reduced submitted triangles from 114,939 to 76,643 per frame
by eliminating redundant shadow draws, with a pixel-identical output before the requested visual changes. That is
about 33% less triangle submission in that case, not a measurement of total GPU time or temperature. During speech
the shadow map still needs frequent updates; multi-view rendering and bloom remain significant GPU work.

## Analog optical enclosure

Lattice now starts with **Analog optical enclosure** enabled. The clean, animated head is captured behind a
slightly bowed pane. The pane's own material refracts that image through irregular vertical ribs, a weaker
horizontal weave and a narrow anisotropic diffusion lobe. There is no full-screen Gaussian blur pass. Fine
surface points become softly separated square tiles before transmission; the original geometry and speech poses stay intact.

The transmitted image uses a restrained blue-gray monochrome palette, softened highlights, faint material haze,
subtle highlight spill and mild grain. Cube edges disappear; softly lit patches of its cell volume remain behind the glass and fade irregularly into black. Automatic head sway
and breathing scale stop in this mode; dragging still rotates the scene.

**Configure → Optical surface** switches the enclosure off for a direct comparison with the data portrait.
**Optical enclosure** sliders tune Refraction, Diffusion, Fine ridges and Film grain.
The refraction stays small to avoid wavy face contours. **Tile density** and **Tile fill** tune the subtle cell
spacing and narrow seams; **Cube brightness** adjusts how much of the background display shows through. Save stores these per style;
closing without saving restores the saved values. Dust retains its existing rendering.

During optical previews/conversations, interface regions fade away. Hover near the top/right/bottom controls or
focus them with the keyboard to reveal them; hovering over the bottom controls also reveals transcripts. Initial
connection/preview controls, touch controls and errors remain visible. Configure keeps its normal visible panel.

Rendering uses a local HDR scene texture and one curved transmission mesh. The display pass omits the source
objects already captured into that texture, avoiding a second head/cube draw. Disabling the enclosure skips the
capture entirely. The extra material sampling still adds GPU work; use the clear comparison mode on slower devices.

Optional `scripts/review-optical-browser.mjs` uses the same browser environment variables described below. It checks
rendering, clean/optical switching, unchanged rig weights, idle/reformation/dissolve, saved settings, desktop chrome,
touch controls and resizing without API calls.

## Dissolve and lighting

The inactive head writes neither visible color nor depth, so it leaves no silhouette blocking the cube.
During activation/deactivation, matched surface and depth coverage dissolve the portrait while particles travel
between the animated skin and positions throughout the cube. Dust uses the same formation state. The head stays
fully formed while listening, thinking and speaking; only ending/failing the connection returns it to the cube.
The accepted head geometry, eyes and viseme rig are unchanged.

**Configure → Lighting** offers four saved presets:

- **Soft portrait**: the previous broad, gently filled lighting (no cast-shadow pass).
- **Cinema**: a high, nearly frontal key, minimal fill and cast shadows, without a projected grid.
- **Butterfly**: a centered elevated key with a little more fill.
- **VIKI shadows**: deep black eye sockets, dark outer cheeks and a crown fade above the forehead, leaving the central face lit.

**Lighting adjustment** controls key elevation (25–65°) and shadow fill. The projected grid and its control have been removed, including for older saved settings. Changing presets loads their lighting values only.
**Save** keeps the choice per style; closing without saving restores the saved lighting.
Cinema is the default for configurations without a saved lighting choice.

`HeadLight.ts` renders a 1024² light-space depth map of the same morphed head. Nose, eyelids and lips cast real
shadows, with filtered edges and a small depth bias. Lighting is shared by the portrait, Dust and cube helper pass
and stays attached to the head when it rotates. VIKI shadows adds feathered darkening tied to the head landmarks; this is an artistic match to the reference,
not a reconstruction of the movie's actual lighting setup. The extra shadow pass is skipped for Soft
portrait and fully dormant states.

## Audio-driven lip sync

The assistant's decoded PCM stream (see *Voice pipeline*) feeds a local **HeadAudio** AudioWorklet. Its trained MFCC classifier identifies
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
Voice Agent voice on the target device remains the final perceptual check.

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
shared depth animation, Lattice/Dust, configuration, saved settings and mobile controls. A real voice conversation
still needs a separate microphone/listening check.

`scripts/review-speech-browser.mjs` uses the same browser environment variables. It checks fixed visemes, the real
AudioWorklet, measured audio delay, interruption/restart and audible fallback on model failure. Optionally set
`VIKI_SPEECH_EN` and/or `VIKI_SPEECH_DE` to local WAV paths: these clips are passed through a local WebRTC peer pair
to verify remote-track detection, output and mouth closure. All tests block external requests and make no AssemblyAI calls.
`scripts/review-voice-agent-browser.mjs` separately drives `connectVoiceAgent` against a fake WebSocket: capture
worklet streaming, PCM playback reaching the output node, drain/interruption/greeting/teardown and a refused
handshake. Set `CHROME_NO_SANDBOX=1` on hosts where Chrome cannot create its sandbox namespace.
`scripts/voice-agent.test.mjs` (part of `npm test`) covers the event router, the PCM codec and the capture
worklet's resampler under node.

`scripts/review-viki-browser.mjs` checks all six windows, rendered parallax, shared lip poses, moving/stopped pixels, dissolve,
VIKI controls and saved settings, switching back to Dust/Lattice, pointer rotation and mobile framing. It uses the same
browser environment variables, blocks external requests and saves screenshots to `/tmp/viki-cube-review` by default.
`scripts/review-viki-performance.mjs` checks cached/full shadow image equivalence, invalidation on pose/shape/light
changes, unchanged particle count, stable GPU resource counts across style switches, pass disposal and render-loop
shutdown. It uses the same browser environment variables and makes no API calls.
`scripts/review-viki-hologram.mjs` checks top-down shader coverage, cube-before-face timing, travelling 5–7-tile
streams, the empty dormant hall, and Preview activation/cancellation/reconnection/shutdown. It saves staged screenshots
to `/tmp/viki-hologram-review`. `scripts/viki-assembly.test.mjs` checks the reversible clock and frame-rate independence.

## Layout

- `src/viki/HeadRig.ts` — canonical multi-part geometry and shared relative morph weights
- `src/viki/headShader.ts` — shared GLSL: morphs, proportions, hair, lighting and semantic eye/mouth shading
- `src/viki/SurfacePortrait.ts` — surface data pattern, depth occlusion and silhouette fade
- `src/viki/OpticalEnclosure.ts` — curved transmission pane, rib refraction, directional diffusion and local scene capture
- `src/viki/HeadLight.ts` — animated light-space depth map for the cinematic lighting presets
- `src/viki/FacePass.ts` — depth/luminance/mask texture for the cube; four views in debug mode
- `src/viki/DataCube.ts` — staggered rectangular cell volume, face occlusion and cube controls
- `src/viki/VikiCube.ts` — six mirrored portrait displays with local tile diffusion and travelling pixel light
- `src/viki/VikiInterior.ts` — shared 3D head, surface tiles and spatial data layers viewed through the cube windows
- `src/viki/VikiMatrix.ts` / `VikiTiles.ts` — transparent matrix depth layers and tile pattern shared with the head
- `src/viki/VikiAssembly.ts` / `VikiRain.ts` — reversible assembly clock, shared reveal front and descending/lifting columns
- `src/viki/VikiStreams.ts` — instanced 5–7-tile depth streams with directional exposure trails
- `src/viki/PixelChains.ts` — deterministic turning cell trails and their shared two-frame texture
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
- `src/viki/voiceAgent.ts` — Voice Agent WebSocket session, microphone capture, personas and duet rules
- `src/viki/agentEvents.ts` — pure event router: API events → status machine, captions, interruptions
- `src/viki/PcmPlayer.ts`, `src/viki/pcm.ts` — gapless PCM16 playback and the base64/PCM helpers
- `public/audio/pcm-capture-worklet.mjs` — microphone → 24 kHz PCM16 chunks
- `api/token.js` — serverless token minting (also served by Vite)
- `src/App.tsx` — HUD, status, captions
