// Bounded, API-free workload and resource checks. Counts are not a hardware GPU-temperature benchmark.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: ['--enable-unsafe-swiftshader'],
})
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', (r) => new URL(r.url()).origin === new URL(base).origin ? r.continue() : r.abort())
  await page.setViewport({ width: 1000, height: 1000 })
  await page.goto(`${base}/?style=viki&preview=neutral&freeze=1&mouth=0`)
  await page.waitForFunction(() => window.__viki?.().headLoaded)
  await page.addStyleTag({ content: '.hud,.corner{display:none!important}' })
  await pause(400)
  const before = await page.evaluate(() => window.__viki().shadows)
  const image = await page.screenshot()
  await pause(250)
  const after = await page.evaluate(() => window.__viki().shadows)
  assert.equal(after.renders, before.renders)
  assert.ok(after.reuses > before.reuses, 'Still geometry reuses its shadow map without dropping rendered frames')
  await page.evaluate(() => { const f = window.__vikiFace; f.headLight.render(f.renderer, false) })
  await pause(200)
  assert.deepEqual(await page.screenshot(), image, 'Forced full shadow rendering and cached rendering are pixel-identical')

  // Each kind of input that changes the shadow must invalidate it immediately.
  for (const change of ['mouth', 'shape', 'light']) {
    const count = await page.evaluate(() => window.__viki().shadows.renders)
    await page.evaluate((change) => {
      const f = window.__vikiFace
      if (change === 'mouth') f.setMouthSource(() => ({ open: 0.7, wide: 0.3 }))
      if (change === 'shape') f.applyConfig({ ...f.config, noseSize: 0.025 })
      if (change === 'light') f.applyConfig({ ...f.config, lightElevation: 35 })
    }, change)
    await page.waitForFunction((count) => window.__viki().shadows.renders > count, {}, count)
  }
  const count = await page.evaluate(() => window.__viki().shadows.renders)
  await page.evaluate(() => { window.__vikiFace.camera.position.x = 0.3 })
  await pause(200)
  assert.equal(await page.evaluate(() => window.__viki().shadows.renders), count, 'Moving the viewing camera does not change head-space lighting')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0 }))
  await pause(200)
  assert.equal(await page.evaluate(() => window.__vikiFace.vikiCube.interior.head.visible), false)
  assert.equal(await page.evaluate(() => window.__vikiFace.vikiCube.interior.cells.geometry.attributes.position.count), 19040)

  // Warm every window and style once; resource counts must then plateau across repeated switches.
  await page.evaluate(async () => {
    const f = window.__vikiFace, position = f.camera.position.clone()
    for (const point of [[0, 0, 5], [0, 0, -5], [5, 0, 0], [-5, 0, 0], [0, 5, 0], [0, -5, 0]]) {
      f.camera.position.fromArray(point); f.vikiCube.capture(f.renderer, f.camera)
    }
    f.camera.position.copy(position)
  })
  const cycle = async () => {
    for (const style of ['dust', 'lattice', 'viki']) {
      await page.evaluate((style) => [...document.querySelectorAll('.tab')].find((b) => b.textContent.toLowerCase().endsWith(style)).click(), style)
      await pause(250)
    }
  }
  const memory = () => page.evaluate(() => {
    const f = window.__vikiFace
    return { ...f.renderer.info.memory, programs: f.renderer.info.programs.length }
  })
  await cycle()
  const warm = await memory()
  await cycle(); await cycle()
  assert.deepEqual(await memory(), warm, 'GPU resources do not accumulate across style switches')

  const disposal = await page.evaluate(async () => {
    const f = window.__vikiFace, passes = f.composer.passes
    let disposedPasses = 0, bloomTargets = 0, chainTexture = 0, matrixResources = 0, subsequentRenders = 0
    for (const pass of passes) {
      const dispose = pass.dispose.bind(pass)
      pass.dispose = () => { disposedPasses++; dispose() }
    }
    for (const target of [...f.bloom.renderTargetsHorizontal, ...f.bloom.renderTargetsVertical, f.bloom.renderTargetBright]) {
      target.addEventListener('dispose', () => bloomTargets++)
    }
    f.vikiCube.interior.chains.texture.addEventListener('dispose', () => chainTexture++)
    const matrix = f.vikiCube.interior.matrix
    for (const resource of [matrix, matrix.geometry, matrix.material]) {
      resource.addEventListener('dispose', () => matrixResources++)
    }
    const render = f.renderer.render.bind(f.renderer)
    f.renderer.render = (...args) => { subsequentRenders++; return render(...args) }
    f.dispose(); f.dispose()
    await new Promise((resolve) => setTimeout(resolve, 250))
    return { disposedPasses, expected: passes.length, bloomTargets, chainTexture, matrixResources, subsequentRenders }
  })
  assert.equal(disposal.disposedPasses, disposal.expected)
  assert.equal(disposal.bloomTargets, 11)
  assert.equal(disposal.chainTexture, 1)
  assert.equal(disposal.matrixResources, 3, 'Matrix instance buffer, geometry and material are disposed once')
  assert.equal(disposal.subsequentRenders, 0, 'Disposal stops the render loop')
  assert.deepEqual(errors, [])
  console.log('PASS: identical cached shadows, invalidation, unchanged particle count, stable resources, disposed passes and stopped render loop.', { warm, disposal })
} finally { await browser.close() }
