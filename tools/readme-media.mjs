// README screenshots of the sample home: docs/screenshots/overview.png (the Home Assistant app page, homescape/README.md)
// and docs/screenshots/dashboard.png (README.md). Run with a dev server that has no HA_URL (automated browsers use the
// sample data anyway): `npm run media`. The README video comes from `npm run promo:x` (tools/promo-x.mjs).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('docs/screenshots', { recursive: true })
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []

const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'en-US' })
p.on('pageerror', (e) => errors.push(e.message))
await p.clock.install({ time: new Date('2026-10-27T13:00:00') })
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.evaluate(() => {
  const h = window.__homescape
  h.loadDemo('american', true)
  h.setTheme('day')
})
// The notice "Sample home opened" goes away after 4.5 s
await p.waitForTimeout(5500)
await p.screenshot({ path: 'docs/screenshots/overview.png' })
console.log('docs/screenshots/overview.png')

await p.click('button[role="tab"][aria-label="Dashboard"]')
await p.waitForSelector('#dashboard')
await p.waitForTimeout(1500)
await p.screenshot({ path: 'docs/screenshots/dashboard.png' })
console.log('docs/screenshots/dashboard.png')

await b.close()
if (errors.length) console.log(`Page errors: ${errors.join(' | ')}`)
