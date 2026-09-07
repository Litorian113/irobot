import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/viki-optical-review'
await mkdir(output, { recursive: true })
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: ['--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage(), errors = [], external = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== new URL(base).origin) { external.push(r.url()); return r.abort() }
    return r.continue()
  })
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  const shot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) })
  const click = (label) => page.evaluate((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label).click(), label)
  await page.setViewport({ width: 1280, height: 1000 })
  await page.goto(`${base}/?freeze=1`)
  await page.waitForFunction(() => window.__viki?.().headLoaded)
  assert.equal(await page.$eval('.hud-bottom', (e) => getComputedStyle(e).opacity), '1', 'Initial controls remain discoverable')
  assert.equal(await page.evaluate(() => window.__vikiFace.headUniforms.uFormation.value), 0)
  await shot('dormant')
  await click('Preview animation')
  await pause(500)
  await page.mouse.move(0, 0)
  await pause(350)
  assert.equal(await page.$eval('.hud-top', (e) => getComputedStyle(e).opacity), '0')
  await shot('optical-talking')
  await click('Stop preview')
  await pause(250)
  assert.equal(await page.evaluate(() => window.__vikiFace.headUniforms.uFormation.value), 0)

  await page.goto(`${base}/?preview=neutral&freeze=1&mouth=0`)
  await page.waitForFunction(() => window.__viki?.().headLoaded)
  await pause(350)
  await shot('optical-front')
  const rig = await page.evaluate(() => window.__viki().morphs)
  await click('Configure')
  assert.equal(await page.evaluate(() => window.__vikiFace.enclosure.mesh.visible), true)
  await page.click('input[type=checkbox]') // Optical surface is the first checkbox.
  await pause(250)
  assert.equal(await page.evaluate(() => window.__vikiFace.enclosure.mesh.visible), false)
  assert.deepEqual(await page.evaluate(() => window.__viki().morphs), rig, 'Optical material does not change the head rig')
  await shot('clear-comparison')
  await click('Save')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('viki.config.v5.lattice')).optical), false)
  await page.click('input[type=checkbox]')
  await click('Save')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('viki.config.v5.lattice')).optical), true)
  await page.click('[aria-label="Close"]')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0.5 }))
  await pause(250)
  await shot('dissolving')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0 }))
  await pause(250)
  assert.equal(await page.evaluate(() => window.__vikiFace.headUniforms.uFormation.value), 0)
  await shot('dispersed')

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.goto(`${base}/?preview=neutral&freeze=1&mouth=0`)
  await page.waitForFunction(() => window.__viki?.().headLoaded)
  await pause(300)
  assert.equal(await page.$eval('.hud-bottom', (e) => getComputedStyle(e).opacity), '1', 'Touch controls stay visible')
  assert.equal(await page.evaluate(() => {
    const face = window.__vikiFace
    return face.enclosure.target.width === face.renderer.domElement.width && face.enclosure.target.height === face.renderer.domElement.height
  }), true)
  await shot('mobile')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('PASS: optical rendering, idle/activation/dissolve, unchanged rig, clear toggle, persistence, unobstructed preview, touch controls and resize.')
} finally { await browser.close() }
