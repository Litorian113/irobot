// Optional visual integration check; see README for browser setup.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/viki-review'
await mkdir(output, { recursive: true })
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== new URL(base).origin) {
      external.push(r.url())
      return r.abort()
    }
    return r.continue()
  })
  const visit = async (query) => {
    await page.goto(`${base}/?${query}`)
    await page.waitForFunction(() => window.__viki?.().headLoaded)
    await pause(500)
  }
  const shot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) })
  const click = (text) => page.evaluate((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label).click(), text)
  const slider = (label, value) => page.evaluate(({ label, value }) => {
    const input = [...document.querySelectorAll('.slider')].find((l) => l.querySelector('.slider-label').textContent === label).querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { label, value })

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
  for (const [name, pose] of [
    ['front', 'mouth=0'], ['speaking', 'mouth=.7&wide=.3&round=.4'],
    ['blink', 'mouth=0&blink=1'], ['half-blink', 'mouth=0&blink=.5&yaw=25'],
    ['three-quarter', 'mouth=.5&yaw=35'], ['profile', 'mouth=.3&yaw=80'],
    ['clay', 'mouth=0&inspect=1'],
  ]) {
    await visit(`style=lattice&preview=neutral&freeze=1&${pose}`)
    assert.equal(await page.evaluate(() => window.__viki().rigged), true)
    assert.equal(await page.evaluate(() => {
      const f = window.__vikiFace
      return f.rig.geometry.morphTargetsRelative && f.facePass.head.morphTargetInfluences === f.rig.influences
        && f.portrait.group.children.every((m) => m.morphTargetInfluences === f.rig.influences)
    }), true)
    await shot(name)
  }

  await visit('style=lattice')
  await click('Preview animation')
  await page.waitForFunction(() => window.__viki().mouth.open > 0.1)
  await pause(3000)
  console.log('Active renderer:', await page.evaluate(() => window.__viki()))
  await shot('preview')
  await click('Stop preview')
  await page.waitForFunction(() => window.__viki().mouth.open < 0.01 && window.__viki().mouth.round < 0.01)
  assert.equal(await page.evaluate(() => window.__viki().active), false)

  // Real audio analyser, driven by a local synthetic voiced signal without a microphone.
  const audio = await page.evaluate(async () => {
    const { LipSync } = await import('/src/viki/lipsync.ts')
    const ctx = new AudioContext()
    await ctx.resume()
    const gain = ctx.createGain(), destination = ctx.createMediaStreamDestination()
    gain.gain.value = 0.05
    gain.connect(destination)
    const sources = [130, 260, 390, 520, 780, 1040, 1560].map((hz) => {
      const osc = ctx.createOscillator()
      osc.frequency.value = hz
      osc.connect(gain)
      osc.start()
      return osc
    })
    const sync = new LipSync(ctx, destination.stream)
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    await wait(350)
    const voiced = sync.sample()
    gain.gain.value = 0
    for (let i = 0; i < 15; i++) { await wait(35); sync.sample() }
    const silent = sync.sample()
    for (const source of sources) { source.stop(); source.disconnect() }
    sync.dispose()
    gain.disconnect()
    destination.stream.getTracks().forEach((track) => track.stop())
    await ctx.close()
    return { voiced, silent }
  })
  assert.ok(audio.voiced.open > 0.1 && audio.voiced.round > 0)
  assert.equal(audio.silent.open, 0)
  assert.equal(audio.silent.round, 0)
  console.log('Audio analyser:', audio)

  for (const style of ['contour', 'dots', 'plasma', 'dust', 'lattice']) {
    await page.evaluate((id) => [...document.querySelectorAll('.tab')].find((b) => b.textContent.toLowerCase().includes(id)).click(), style)
    await page.waitForFunction((id) => window.__viki().style === id, {}, style)
    await pause(500)
    await shot(`style-${style}`)
  }
  await click('Configure')
  await page.evaluate(() => localStorage.setItem('viki.config.v4.lattice', '{"gain":1.37}'))
  const cellCount = await page.evaluate(() => window.__vikiFace.cube.cells.geometry.attributes.position.count)
  await slider('Cube cells', 0.8)
  await slider('Cube depth', 1.2)
  await slider('Cube spacing', 0.15)
  await slider('Point density', 0.4)
  await slider('Articulation', 1.2)
  await slider('Voice delay (ms)', 140)
  await pause(150)
  assert.ok(await page.evaluate(() => window.__vikiFace.cube.cells.geometry.attributes.position.count) > cellCount)
  assert.equal(await page.evaluate(() => window.__vikiFace.cube.material.uniforms.uDepth.value), 1.2)
  assert.equal(await page.evaluate(() => window.__vikiFace.cube.material.uniforms.uGap.value), 0.15)
  await click('Save')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('viki.config.v5.lattice')).density), 0.4)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('viki.config.v5.lattice')).speechStrength), 1.2)
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('viki.config.v5.lattice')).speechDelay), 140)
  await click('Reset to standard')
  assert.equal(await page.evaluate(() => window.__vikiFace.cube.cells.geometry.attributes.position.count), cellCount)
  assert.equal(await page.evaluate(() => localStorage.getItem('viki.config.v5.lattice')), null)
  assert.equal(await page.evaluate(() => localStorage.getItem('viki.config.v4.lattice')), '{"gain":1.37}')
  await page.click('[aria-label="Close"]')

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await click('Preview animation')
  await pause(800)
  await shot('mobile')
  const boxes = await page.$$eval('.controls button', (buttons) => buttons.map((b) => {
    const r = b.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  }))
  assert.ok(boxes.every((b) => b.left >= 0 && b.right <= 390 && b.top >= 0 && b.bottom <= 844))
  await click('Configure')
  await pause(400)
  await shot('mobile-config')
  const panel = await page.$eval('.config', (element) => {
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  })
  assert.ok(panel.left >= 0 && panel.right <= 390 && panel.top >= 0 && panel.bottom <= 844)
  await page.click('[aria-label="Close"]')
  await visit('style=lattice&model=legacy&preview=neutral&mouth=0&freeze=1')
  assert.equal(await page.evaluate(() => window.__viki().rigged), false)
  assert.deepEqual(errors, [], 'No runtime or GLSL errors')
  assert.deepEqual(external, [], 'No external requests during preview')
  console.log(`PASS: poses, shared depth animation, audio/silence, preview, all styles, cube controls, persistence, mobile and legacy. Screenshots: ${output}`)
} finally {
  await browser.close()
}
