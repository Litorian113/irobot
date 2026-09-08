// API-free GPU and UI checks for Dust's sharp-center radial filter.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/dust-radial-review'
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
  await page.setViewport({ width: 1000, height: 1000 })
  const visit = async (style = 'dust', extra = '') => {
    await page.goto(`${base}/?style=${style}&preview=neutral&mouth=0&freeze=1&${extra}`)
    await page.waitForFunction(() => window.__viki?.().headLoaded && window.__viki().current.face === 1)
    await pause(200)
  }
  const blurState = () => page.evaluate(() => {
    const f = window.__vikiFace, u = f.dustBlur.uniforms
    return { enabled: f.dustBlur.enabled, strength: u.uStrength.value, center: u.uCenter.value.toArray(), radius: u.uRadius.value.toArray(), texel: u.uTexel.value.toArray() }
  })
  await visit()
  assert.equal((await blurState()).strength, 0.7)

  // Compare final GPU pixels at the SAME frozen pose, rather than random particle resampling.
  const pixels = await page.evaluate(() => {
    const f = window.__vikiFace, pass = f.dustBlur, composer = f.composer
    const memory = { ...f.renderer.info.memory }, count = f.styles.dust.geometry.drawRange.count
    const snapshot = () => {
      composer.render(0)
      const gl = f.renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels
    }
    try {
      pass.enabled = false
      const off = snapshot(), repeated = snapshot()
      pass.enabled = true
      const on = snapshot(), center = pass.uniforms.uCenter.value, radius = pass.uniforms.uRadius.value
      const { width, height } = f.renderer.domElement
      let centerChanged = 0, centerSamples = 0, edgeChanged = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const r = Math.hypot(((x + 0.5) / width - center.x) / radius.x, ((y + 0.5) / height - center.y) / radius.y)
        const i = (y * width + x) * 4
        const changed = on[i] !== off[i] || on[i + 1] !== off[i + 1] || on[i + 2] !== off[i + 2]
        if (r < 0.55) { centerSamples++; if (changed) centerChanged++ }
        if (r > 0.85 && r < 1.4 && changed) edgeChanged++
      }
      pass.setStrength(0)
      const zero = snapshot(), index = composer.passes.indexOf(pass)
      composer.removePass(pass)
      let matchesOriginal
      try { matchesOriginal = snapshot().every((value, i) => value === zero[i]) }
      finally { composer.insertPass(pass, index) }
      return { centerChanged, centerSamples, edgeChanged, matchesOriginal, count, memory, memoryAfter: { ...f.renderer.info.memory }, repeatIdentical: repeated.every((v, i) => v === off[i]) }
    } finally { pass.setStrength(f.config.radialBlur) }
  })
  assert.equal(pixels.repeatIdentical, true, 'Frozen renders are stable for pixel comparison')
  assert.ok(pixels.centerSamples > 10000)
  assert.equal(pixels.centerChanged, 0, 'The center retains the exact unfiltered GPU pixels')
  assert.ok(pixels.edgeChanged > 10000, 'The filter visibly affects the silhouette')
  assert.equal(pixels.matchesOriginal, true, 'Zero strength restores the original pass chain output')
  assert.equal(pixels.count, 49000, 'Particle density is unchanged')
  assert.deepEqual(pixels.memoryAfter, pixels.memory, 'The filter needs no additional render textures or geometry')
  await page.screenshot({ path: `${output}/dust-radial-desktop.png` })

  const original = await blurState()
  await page.evaluate(() => {
    const f = window.__vikiFace
    f.applyConfig({ ...f.config, headY: -0.8, headScale: 0.3 })
  })
  await pause(200)
  const moved = await blurState()
  assert.ok(moved.center[1] < original.center[1] - 0.1, 'The focus follows head height')
  assert.ok(moved.radius[0] < original.radius[0] * 0.8, 'The focus follows head scale')

  // A saved config from before this filter receives the new default, retaining its other values.
  await page.evaluate(() => localStorage.setItem('viki.config.v6.dust', JSON.stringify({ gain: 1.24, colorA: '#623188' })))
  await visit()
  assert.deepEqual(await page.evaluate(() => {
    const { radialBlur, gain, colorA } = window.__vikiFace.config
    return { radialBlur, gain, colorA }
  }), { radialBlur: 0.7, gain: 1.24, colorA: '#623188' })
  const setSlider = async (value) => {
    await page.evaluate((v) => {
      const row = [...document.querySelectorAll('.slider')].find((el) => el.querySelector('.slider-label')?.textContent === 'Radial blur')
      const input = row.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await pause(150)
  }
  await page.click('.configure-btn')
  await setSlider(0)
  assert.equal((await blurState()).enabled, false)
  await setSlider(0.46)
  await page.click('.config-foot .btn:not(.ghost)')
  await visit()
  assert.equal((await blurState()).strength, 0.46, 'Save persists the filter strength')
  await page.click('.configure-btn')
  await setSlider(1)
  await page.click('.config-head [aria-label="Close"]')
  await pause(150)
  assert.equal((await blurState()).strength, 0.46, 'Close discards the draft')
  await page.click('.configure-btn')
  await page.click('.config-foot .ghost')
  await pause(150)
  assert.equal((await blurState()).strength, 0.7, 'Reset restores the default filter')

  await visit('dust', 'yaw=55&pitch=12')
  const rotated = await blurState()
  assert.ok(rotated.center[0] > original.center[0] + 0.02, 'The focus follows the turned face')
  assert.ok(rotated.radius.every((r) => Number.isFinite(r) && r > 0.05))
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await pause(300)
  const mobile = await blurState()
  assert.ok(mobile.radius[0] > mobile.radius[1], 'The focus ellipse accounts for the portrait viewport')
  assert.ok(Math.abs(mobile.texel[0] * 390 * (await page.evaluate(() => window.__viki().pixelRatio)) - 1) < 0.001)
  await page.screenshot({ path: `${output}/dust-radial-mobile.png` })

  // Switch the actual style menu with the filter enabled: it must not leak to other scenes.
  for (const style of ['LATTICE', 'VIKI', 'DUST']) {
    await page.click('[aria-label="Head style menu"]')
    await page.waitForSelector('.wheel-seg')
    await page.evaluate((label) => {
      [...document.querySelectorAll('.wheel-seg')].find((el) => el.querySelector('.seg-label')?.textContent === label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }, style)
    await pause(500)
    assert.equal(await page.evaluate(() => window.__viki().style), style.toLowerCase())
    assert.equal((await blurState()).enabled, style === 'DUST')
  }
  // Real formation, without the frozen preview: an active connection alone has no head yet.
  await page.setViewport({ width: 1000, height: 1000 })
  await page.goto(`${base}/?style=dust`)
  await page.waitForFunction(() => window.__viki?.().headLoaded)
  assert.equal((await blurState()).enabled, false, 'Inactive dust stays sharp')
  await page.evaluate(() => {
    const f = window.__vikiFace
    f.setActive(true)
    f.applyConfig({ ...f.config })
    f.setStyle('dust')
  })
  await pause(200)
  assert.equal((await blurState()).enabled, false, 'Connecting or reapplying settings cannot blur an absent head')
  await page.click('.preview-toggle')
  await page.waitForFunction(() => {
    const f = window.__vikiFace, strength = f.dustBlur.uniforms.uStrength.value
    return strength > 0 && strength < f.config.radialBlur * 0.9
  })
  await page.waitForFunction(() => window.__viki().current.face > 0.999)
  assert.ok(Math.abs((await blurState()).strength - 0.7) < 0.001, 'The formed head retains the selected strength')
  await page.click('.preview-toggle')
  await page.waitForFunction(() => {
    const strength = window.__vikiFace.dustBlur.uniforms.uStrength.value
    return strength > 0 && strength < 0.5
  })
  await page.waitForFunction(() => window.__vikiFace.headUniforms.uFormation.value === 0)
  assert.equal((await blurState()).enabled, false, 'The pass switches off after the head dissolves')
  assert.equal(await page.evaluate(() => window.__vikiFace.config.radialBlur), 0.7, 'Fading does not overwrite the slider')

  const disposed = await page.evaluate(() => {
    const f = window.__vikiFace
    let materialReleased = false
    f.dustBlur.material.addEventListener('dispose', () => { materialReleased = true })
    f.dispose()
    return materialReleased
  })
  assert.equal(disposed, true, 'Unmount disposes the filter material with the other passes')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('PASS: unchanged central pixels, blurred edges, exact zero-strength bypass, unchanged particle count, no added render targets, head tracking, mobile framing, saved settings, style isolation, inactive bypass, formation/dissolve fading and disposal.')
} finally { await browser.close() }
