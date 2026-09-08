// Optional, API-free WebGL review of the independent VIKI display style.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/viki-cube-review'
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
  await page.evaluateOnNewDocument(() => {
    let seed = 371
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  })
  await page.setViewport({ width: 1000, height: 1000 })
  const visit = async (query) => {
    await page.goto(`${base}/?${query}`)
    await page.waitForFunction(() => window.__viki?.().headLoaded)
    await pause(250)
  }
  const shot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) })
  const click = (label) => page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text).click(), label)
  const tab = async (style) => {
    await page.evaluate((style) => [...document.querySelectorAll('.tab')].find((b) => b.textContent.toLowerCase().endsWith(style)).click(), style)
    await page.waitForFunction((style) => window.__viki().style === style, {}, style)
    await pause(150)
  }
  const slider = (label, value) => page.evaluate(({ label, value }) => {
    const input = [...document.querySelectorAll('.slider')].find((l) => l.querySelector('.slider-label').textContent === label).querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { label, value })

  // Render every outward face, including the usually hidden top and bottom.
  for (const [name, yaw, pitch] of [['corner', 45, -8], ['front', 0, 0], ['right', -90, 0], ['back', 180, 0], ['left', 90, 0], ['top', 0, 90], ['bottom', 0, -90]]) {
    await visit(`style=viki&preview=neutral&mouth=0&freeze=1&yaw=${yaw}&pitch=${pitch}`)
    await shot(name)
  }
  assert.equal(await page.evaluate(() => {
    const f = window.__vikiFace, cube = f.vikiCube
    return cube.views.length === 6 && new Set(cube.views.map((v) => v.target.texture)).size === 6
      && cube.views.every((v) => v.panel.material.uniforms.uFace.value === v.target.texture)
      && cube.interior.head.geometry === f.rig.geometry
      && cube.interior.head.morphTargetInfluences === f.rig.influences
      && cube.views.filter((v) => v.mirror).length === 3
  }), true, 'Six perspective windows share the actual head geometry and pose, with alternating mirroring')

  // Read the window texture itself: moving the viewer must change its contents,
  // not merely the screen projection of a flat image on a rotating plane.
  await visit('style=viki&preview=neutral&mouth=0&freeze=1&yaw=0&pitch=0')
  const readInterior = () => page.evaluate(() => {
    const f = window.__vikiFace, target = f.vikiCube.views[0].target
    const pixels = new Uint16Array(target.width * target.height * 4)
    f.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
    let hash = 2166136261, lit = 0
    for (let i = 1; i < pixels.length; i += 4) {
      hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0
      if (pixels[i] > 0) lit++
    }
    return { hash, lit }
  })
  const headOn = await readInterior()
  assert.ok(headOn.lit > 100, 'The interior render contains visible head pixels')
  await page.evaluate(() => { window.__vikiFace.camera.position.x = 0.6 })
  await pause(250)
  assert.notEqual((await readInterior()).hash, headOn.hash, 'The rendered head changes perspective inside the fixed window')
  assert.equal(await page.evaluate(() => {
    const f = window.__vikiFace, cam = f.vikiCube.views[0].camera
    const near = cam.position.clone().set(0, 0, -0.1).project(cam)
    const far = cam.position.clone().set(0, 0, -1.5).project(cam)
    return Math.abs(near.x - far.x) > 0.01
  }), true, 'Front and rear layers have different parallax')
  await shot('parallax-offset')

  const preview = 'style=viki&preview=neutral&mouth=0&freeze=1'
  const frames = []
  for (const time of [0, 3]) {
    await visit(`${preview}&time=${time}`)
    await page.addStyleTag({ content: '.hud,.corner{display:none!important}' })
    frames.push(await shot(`flow-${time}`))
  }
  assert.notDeepEqual(frames[0], frames[1], 'Cell highlights move while the pose stays still')
  await page.evaluate(() => localStorage.setItem('viki.config.v5.viki', JSON.stringify({ dataFlow: 0 })))
  for (const time of [0, 3]) {
    await visit(`${preview}&time=${time}`)
    await page.addStyleTag({ content: '.hud,.corner{display:none!important}' })
    frames[time === 0 ? 0 : 1] = await page.screenshot()
  }
  assert.deepEqual(frames[0], frames[1], 'Pixel movement zero removes the animated light layer')
  await page.evaluate(() => localStorage.clear())

  await visit(preview)
  const closed = await page.screenshot()
  await visit('style=viki&preview=neutral&viseme=aa&freeze=1')
  assert.notDeepEqual(await page.screenshot(), closed, 'Live lip poses reach the cube displays')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0.5 }))
  await pause(150)
  assert.equal(await page.evaluate(() => window.__vikiFace.styles.dust.visible), false, 'VIKI transitions never enable the Dust layer')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0 }))
  await pause(150)
  assert.equal(await page.evaluate(() => window.__vikiFace.headUniforms.uFormation.value), 0)
  await shot('dissolved')

  // VIKI controls, discard/save, style isolation and camera restoration.
  await visit(preview)
  await click('Configure')
  await slider('Head recess', 0.75)
  await slider('Pixel movement', 0.8)
  await click('Save')
  assert.equal(await page.evaluate(() => window.__vikiFace.vikiCube.interior.headMaterial.uniforms.uRecess.value), 0.75)
  await slider('Flow speed', 1.4)
  await page.click('[aria-label="Close"]')
  assert.equal(await page.evaluate(() => window.__vikiFace.config.flowSpeed), 0.7, 'Closing discards unsaved flow settings')
  await tab('dust')
  assert.equal(await page.evaluate(() => window.__vikiFace.vikiCube.group.visible), false)
  const dustConfig = await page.evaluate(() => window.__vikiFace.config)
  assert.equal(dustConfig.dataFlow, undefined)
  assert.equal(dustConfig.colorA, '#5b2a8a')
  await tab('lattice')
  assert.equal(await page.evaluate(() => window.__vikiFace.enclosure.mesh.visible), true)
  const latticeCamera = await page.evaluate(() => window.__vikiFace.camera.position.z)
  await tab('viki')
  assert.equal(await page.evaluate(() => window.__vikiFace.config.dataFlow), 0.8)
  assert.equal(await page.evaluate(() => window.__vikiFace.config.portraitDepth), 0.75)
  assert.equal(await page.evaluate(() => window.__vikiFace.enclosure.mesh.visible || window.__vikiFace.styles.dust.visible), false)
  await tab('dust')
  assert.deepEqual(await page.evaluate(() => window.__vikiFace.config), dustConfig)
  assert.equal(await page.evaluate(() => window.__vikiFace.camera.position.z), latticeCamera)
  await page.evaluate(() => localStorage.clear())

  // Real pointer rotation and small-screen framing, without a voice connection.
  await visit('style=viki&preview=neutral&mouth=0')
  await page.mouse.move(470, 400); await page.mouse.down()
  await page.mouse.move(650, 450, { steps: 10 }); await page.mouse.up()
  assert.ok(Math.abs(await page.evaluate(() => window.__viki().yaw)) > 0.1)
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await visit(preview)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await page.evaluate(() => {
    const f = window.__vikiFace
    return [-1, 1].every((x) => [-1, 1].every((y) => [-1, 1].every((z) => {
      const p = f.camera.position.clone().set(x, y, z).applyMatrix4(f.vikiCube.group.matrixWorld).project(f.camera)
      return Math.abs(p.x) < 1 && Math.abs(p.y) < 1
    })))
  }), true, 'All cube corners fit the mobile viewport')
  await shot('mobile')
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('PASS: six 3D windows, rendered head parallax, shared lip poses, moving/stopped pixels, dissolve, recess controls, persistence, style isolation, drag and mobile framing.')
} finally { await browser.close() }
