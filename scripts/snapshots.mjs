// Photographs every head for the lists of the custom wall: public/snapshots/<key>.jpg
// Needs Google Chrome installed. Run again whenever a head changes:  npm run snapshots
import { mkdir } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const OUT = new URL('../public/snapshots/', import.meta.url)
const only = process.argv.slice(2) // optional: just these keys

process.env.HFG_QUIET = '1'
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5299 } })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  await mkdir(OUT, { recursive: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 })
  await page.goto(`${base}?snapshot=list`)
  await page.waitForFunction(() => window.__catalogKeys)
  const keys = (await page.evaluate(() => window.__catalogKeys)).filter((key) => !only.length || only.includes(key))
  for (const key of keys) {
    await page.goto(`${base}?snapshot=${key}`)
    await page.waitForFunction(() => window.__snapshotHead?.debug().headLoaded, { timeout: 60000 })
    // Let the head settle into its pose, and never catch it mid-glitch.
    await new Promise((resolve) => setTimeout(resolve, 3500))
    await page.waitForFunction(() => {
      const d = window.__snapshotHead.debug()
      return !d.glitch && !d.error
    }, { timeout: 30000, polling: 50 })
    const path = new URL(`${key}.jpg`, OUT)
    await page.screenshot({ path: path.pathname, type: 'jpeg', quality: 82 })
    console.log('✓', key)
  }
} finally {
  await browser.close()
  await server.close()
}
