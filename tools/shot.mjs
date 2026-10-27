// The agent's eyes: opens the running dev server in headless Chrome and takes a screenshot once the scene is ready.
// `npm run dev` must be running first. Output: shots/<name>.png (not in git).
//
//   npm run shot
//   SHOT_NAME=night SHOT_THEME=night npm run shot
//   SHOT_NAME=edit SHOT_MODE=edit SHOT_ROOM=<room-id> npm run shot
//   SHOT_NAME=plan SHOT_PLAN=1 npm run shot
//   SHOT_W=390 SHOT_H=844 SHOT_NAME=phone npm run shot
//   SHOT_LITE=1 SHOT_NAME=lite npm run shot   (lite mode)
//
// By default the Google Chrome on this computer is used (no download needed).
// Without Chrome: `npx playwright install chromium` and SHOT_CHANNEL=chromium.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const env = process.env
const URL = env.SHOT_URL ?? 'http://localhost:5190/'
const NAME = env.SHOT_NAME ?? 'scene'
const W = Number(env.SHOT_W ?? 1600)
const H = Number(env.SHOT_H ?? 900)
const WAIT = Number(env.SHOT_WAIT ?? 2400)
const CHANNEL = env.SHOT_CHANNEL ?? 'chrome'

mkdirSync('shots', { recursive: true })

const browser = await chromium.launch({
  ...(CHANNEL === 'chromium' ? {} : { channel: CHANNEL }),
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US' })
if (env.SHOT_LITE) await page.addInitScript(() => localStorage.setItem('homescape-lite', '1'))

const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'load', timeout: 60_000 })
await page.waitForSelector('body[data-ready="1"]', { timeout: 60_000 }).catch(() => logs.push('[warning] the scene did not set the ready marker (data-ready)'))
await page.waitForTimeout(600)

await page.evaluate(
  ({ mode, theme, plan, room, item }) => {
    const h = window.__homescape
    if (!h) return
    if (theme) h.setTheme(theme)
    if (mode) h.setMode(mode)
    if (plan) h.planView(true)
    const level = h.getState().layout.layout?.levels?.[0]
    const findRoom = (q) => level?.rooms.find((r) => r.id === q || r.name.toLowerCase() === q.toLowerCase())
    if (room) {
      const r = findRoom(room)
      if (r) {
        h.select({ type: 'room', id: r.id })
        h.focusRoom(r.id)
      }
    }
    if (item) {
      const it = level?.items.find((i) => i.entityId === item || i.id === item)
      if (it) h.select({ type: 'item', id: it.id })
    }
  },
  { mode: env.SHOT_MODE, theme: env.SHOT_THEME, plan: env.SHOT_PLAN, room: env.SHOT_ROOM, item: env.SHOT_ITEM },
)

await page.waitForTimeout(WAIT)
await page.screenshot({ path: `shots/${NAME}.png` })
console.log(`shots/${NAME}.png`)
if (logs.length) console.log(logs.join('\n'))
await browser.close()
