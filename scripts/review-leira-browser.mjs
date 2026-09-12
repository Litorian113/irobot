// Optional browser regression check, using the same Puppeteer setup as the other review scripts.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/leira-review'
await mkdir(output, { recursive: true })
const browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setRequestInterception(true)
  page.on('request', request => {
    requests.push(request.url())
    return new URL(request.url()).origin === new URL(base).origin ? request.continue() : request.abort()
  })
  const click = selector => page.click(selector)
  const ready = style => page.waitForFunction(s => window.__viki?.().headLoaded && window.__viki().style === s, {}, style)
  const menuPage = async number => {
    await page.waitForFunction(n => document.querySelector('[role="menu"]')?.getAttribute('aria-label').includes(`page ${n}`), {}, number)
    await page.$eval('.wheel-fan', node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)))
  }
  const closeMenu = async () => {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'))
  }
  const select = async (name, secondPage = false) => {
    await click('.wheel-knob')
    if (secondPage) await click('.wheel-knob')
    await click(`[role="menuitem"][aria-label="${name}"] path`)
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'))
  }

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 })
  await page.goto(`${base}/?style=leira`)
  await ready('leira')
  await page.waitForFunction(() => window.__viki().drawCalls === 1)
  const initial = await page.evaluate(() => window.__viki())
  assert.deepEqual(initial.passes, ['direct'])
  assert.equal(initial.pixelRatio, 1)
  assert.equal(initial.geometries, 1)
  assert.ok(!requests.some(url => /\/images\/|\/api\/token/.test(url)), 'LEIRA loads no backdrop images and starts no voice session')
  await page.screenshot({ path: `${output}/leira-desktop.png` })

  await click('.wheel-knob')
  await menuPage(1)
  assert.deepEqual(await page.$$eval('[role="menuitem"]', nodes => nodes.map(n => n.getAttribute('aria-label'))), ['VIKI', 'Dust', 'Max', 'Docs'])
  await click('.wheel-knob')
  await menuPage(2)
  assert.equal(await page.$$eval('[role="menuitem"][aria-disabled="true"]', nodes => nodes.length), 3)
  await click('[aria-label="Empty slot 06"] path')
  await menuPage(2)
  assert.equal(await page.evaluate(() => window.__viki().style), 'leira')
  await page.screenshot({ path: `${output}/menu-page-two.png` })
  await click('.wheel-knob')
  await menuPage(1)
  await closeMenu()
  await click('.wheel-knob')
  await page.mouse.click(20, 300)
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'))

  await click('.preview-toggle')
  await page.waitForFunction(() => window.__viki().mouth.open > 0.1 && window.__viki().morphs.some(v => v > 0.1))
  await click('.preview-toggle')
  await page.waitForFunction(() => window.__viki().mouth.open < 0.01)
  await click('.configure-btn')
  assert.ok(!(await page.$eval('.config', node => node.textContent)).includes('Optical enclosure'))
  await page.$eval('input[type="color"]', input => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#102030'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForFunction(() => [...document.querySelectorAll('.config-foot button')].some(b => b.textContent === 'Save'))
  await page.evaluate(() => [...document.querySelectorAll('.config-foot button')].find(b => b.textContent === 'Save').click())
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('viki.config.v6.leira')).colorA), '#102030')
  await click('[aria-label="Close"]')

  for (const [label, style] of [['VIKI', 'viki'], ['Dust', 'dust'], ['Max', 'lattice']]) {
    await page.evaluate(() => { window.__oldLeira = window.__vikiFace })
    await select(label)
    await ready(style)
    assert.equal(await page.evaluate(() => window.__oldLeira.debug().disposed), true)
    await click('.preview-toggle')
    await page.waitForFunction(() => window.__viki().mouth.open > 0.1)
    await select('LEIRA', true)
    await ready('leira')
    assert.equal(await page.$eval('.preview-toggle', button => button.getAttribute('aria-pressed')), 'false')
    assert.equal(await page.evaluate(() => window.__viki().drawCalls), 1)
  }
  await page.goto(base)
  await ready('leira')
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.waitForFunction(() => window.__vikiFace.renderer.info.render.frame > 2 && window.__viki().drawCalls === 1)
  await page.screenshot({ path: `${output}/leira-mobile.png` })
  await click('.wheel-knob')
  await click('.wheel-knob')
  await menuPage(2)
  await page.screenshot({ path: `${output}/menu-mobile.png` })
  await closeMenu()
  assert.deepEqual(errors, [])
  console.log('PASS: LEIRA uses one draw call, one geometry and no backdrops; menu paging, empty slots, preview, settings, persistence, mobile and scene disposal work.', initial)
} finally { await browser.close() }
