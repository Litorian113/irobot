// API-free checks of actual GPU positions/velocities, rather than the UI's formation flag.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://localhost:5173'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: ['--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', r => r.url().startsWith('data:') || new URL(r.url()).origin === new URL(base).origin ? r.continue() : r.abort())
  await page.setViewport({ width: 900, height: 900 })
  await page.goto(`${base}/?style=lattice&preview=neutral&mouth=0`)
  await page.waitForFunction(() => window.__vikiFace?.portrait?.assembly === 1, { timeout: 60000 })
  const probe = () => page.evaluate(() => {
    const f = window.__vikiFace, d = f.portrait.dynamics, n = f.portrait.resolution
    const position = new Float32Array(4), velocity = new Float32Array(4)
    const x = Math.floor(n / 2), y = Math.floor(n * 0.58)
    f.renderer.readRenderTargetPixels(d.gpu.getCurrentRenderTarget(d.positions), x, y, 1, 1, position)
    f.renderer.readRenderTargetPixels(d.gpu.getCurrentRenderTarget(d.velocities), x, y, 1, 1, velocity)
    return { p: [...position], v: [...velocity] }
  })
  const before = await probe()
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0 }))
  const samples = []
  for (let i = 0; i < 28; i++) { await pause(65); samples.push(await probe()) }
  assert(samples[0].p[1] < before.p[1] - 0.004, 'Tiles should immediately descend')
  assert(samples[0].v[1] < -0.3, 'Release should immediately create downward velocity')
  assert(samples.some(s => s.v[1] > 0.2), 'A tile should rebound after impact')
  assert(samples.some(s => Math.abs(s.v[0]) > 0.04), 'Impact should produce sideways scatter')
  assert(samples.every(s => [...s.p, ...s.v].every(Number.isFinite)), 'Physics must remain finite')
  await pause(5500)
  const resting = await probe()
  assert(Math.hypot(...resting.v.slice(0, 3)) < 0.08, 'Ground friction should settle the tile')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 1 }))
  await pause(850)
  const lifting = await probe()
  assert(lifting.p[1] > resting.p[1] + 0.1 && lifting.v[1] > 0, 'Tiles should levitate before forming')
  // Reverse while airborne: simulation state should continue, without returning to a preset pile.
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 0 }))
  await pause(65)
  const reversed = await probe()
  assert(Math.abs(reversed.p[1] - lifting.p[1]) < 0.2, 'Midair reversal should not teleport')
  await page.evaluate(() => window.__vikiFace.setTarget({ face: 1 }))
  // The legacy formation flag can finish early after an interruption; inspect GPU state.
  let formed = await probe()
  for (let i = 0; i < 60 && formed.p[3] <= 0.99; i++) { await pause(80); formed = await probe() }
  assert(formed.p[3] > 0.99, 'Head should finish reassembling')
  assert.deepEqual(errors, [], 'No browser or WebGL errors')
  console.log('PASS: immediate fall, rebound, scatter, settling, levitation, midair reversal, reassembly')
} finally { await browser.close() }
