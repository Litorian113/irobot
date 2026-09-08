// API-free checks for the staged hologram, travelling depth tiles and the actual Preview control.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/viki-hologram-review'
await mkdir(output, { recursive: true })
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: ['--enable-unsafe-swiftshader'],
})
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const page = await browser.newPage(), errors = [], external = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== new URL(base).origin) {
      external.push(r.url()); return r.abort()
    }
    return r.continue()
  })
  await page.setViewport({ width: 1100, height: 900 })
  const visit = async (query) => {
    await page.goto(`${base}/?style=viki&${query}`)
    await page.waitForFunction(() => window.__viki?.().headLoaded && window.__vikiFace.bgTexture?.image?.width > 0)
    await pause(200)
  }
  for (const progress of [0, 0.25, 0.45, 0.7, 1]) {
    await visit(`preview=neutral&mouth=0&freeze=1&assembly=${progress}&yaw=0&pitch=0`)
    await page.evaluate(() => {
      const f = window.__vikiFace
      f.applyConfig({ ...f.config, cubeScale: 0.85, cubeX: 0, cubeY: 0 })
    })
    await page.addStyleTag({ content: '.hud,.corner{display:none!important}' })
    await pause(200)
    await page.screenshot({ path: `${output}/assembly-${progress}.png` })
    const state = await page.evaluate(() => ({ ...window.__viki().assembly, face: window.__vikiFace.headUniforms.uFormation.value }))
    if (progress < 0.58) assert.equal(state.face, 0, 'The head stays absent while the first columns build the cube')
    if (progress === 0.7) assert.ok(state.cube > 0.99 && state.face > 0 && state.face < 0.3)
    if (progress === 0.25) {
      // Inspect a direct cube-only render: the top half must assemble first.
      const energy = await page.evaluate(() => {
        const f = window.__vikiFace, oldBackground = f.scene.background, oldTarget = f.renderer.getRenderTarget()
        const Target = f.vikiCube.views[0].target.constructor, target = new Target(256, 256)
        try {
          f.scene.background = null
          f.renderer.setRenderTarget(target); f.renderer.render(f.scene, f.camera)
          const pixels = new Uint8Array(256 * 256 * 4)
          f.renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels)
          let top = 0, bottom = 0
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const light = pixels[(y * 256 + x) * 4]
            if (y > 128) top += light; else bottom += light
          }
          return { top, bottom }
        } finally { f.scene.background = oldBackground; f.renderer.setRenderTarget(oldTarget); target.dispose() }
      })
      assert.ok(energy.top > energy.bottom * 2, 'The GPU reveal starts at the top, not as a whole-cube fade')
    }
  }

  // The moving layer changes the data channel, without altering the head's shape/light channel.
  const streams = await page.evaluate(() => {
    const f = window.__vikiFace, cube = f.vikiCube, interior = cube.interior, material = interior.streams.material
    const sample = (time) => {
      material.uniforms.uTime.value = time
      cube.capture(f.renderer, f.camera)
      const target = cube.views[0].target, pixels = new Uint16Array(target.width * target.height * 4)
      f.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
      let field = 2166136261, head = 2166136261
      for (let i = 0; i < pixels.length; i += 4) {
        field = Math.imul(field ^ pixels[i], 16777619) >>> 0
        head = Math.imul(head ^ pixels[i + 1], 16777619) >>> 0
      }
      return { field, head }
    }
    const a = sample(0), b = sample(2)
    const pose = f.rig.influences.slice()
    interior.tileUniforms.uTileTime.value = 2
    const glitter = sample(2)
    return { a, b, glitter, pose, glitterPose: f.rig.influences.slice(), counts: [...new Set(interior.streams.geometry.attributes.aCount.array)] }
  })
  assert.notEqual(streams.a.field, streams.b.field)
  assert.equal(streams.a.head, streams.b.head)
  assert.deepEqual(streams.counts.sort(), [5, 6, 7])
  assert.notEqual(streams.b.head, streams.glitter.head, 'Tile glitter visibly changes the lit face with other animations held still')
  assert.deepEqual(streams.pose, streams.glitterPose, 'Glitter does not deform the head or mouth')

  await visit('freeze=1')
  await page.addStyleTag({ content: '.hud,.corner{display:none!important}' })
  const dormant = await page.screenshot()
  await page.evaluate(() => { window.__vikiFace.group.visible = false })
  await pause(150)
  assert.deepEqual(await page.screenshot(), dormant, 'Inactive VIKI leaves only the hall, without a residual black box')

  // Exercise real activation, mid-assembly cancellation, then reconnect and full shutdown.
  await visit('')
  const preview = () => page.click('.preview-toggle')
  await preview()
  await page.waitForFunction(() => window.__viki().assembly.progress > 0.15)
  await preview()
  await page.waitForFunction(() => window.__viki().assembly.direction === -1)
  assert.equal(await page.evaluate(() => window.__vikiFace.vikiCube.rain.material.uniforms.uDirection.value), -1)
  await page.waitForFunction(() => window.__viki().assembly.progress === 0)
  await preview()
  await page.waitForFunction(() => window.__viki().assembly.progress === 1)
  assert.ok(await page.evaluate(() => window.__vikiFace.headUniforms.uFormation.value > 0.98))
  await page.screenshot({ path: `${output}/active-scene.png` })
  await preview()
  await page.waitForFunction(() => {
    const a = window.__viki().assembly
    return a.progress > 0.15 && a.progress < 0.45 && a.direction === -1
  })
  await page.screenshot({ path: `${output}/upward-dissolve.png` })
  await page.waitForFunction(() => window.__viki().assembly.progress === 0)
  assert.equal(await page.evaluate(() => {
    const cube = window.__vikiFace.vikiCube
    return cube.rain.visible || cube.views.some((v) => v.panel.visible)
  }), false)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('PASS: top-down GPU reveal, cube before face, moving 5–7-tile depth trails, independent tile glitter, clean inactive hall, Preview activation/cancellation/reconnect and upward shutdown.')
} finally { await browser.close() }
