// Promo video of the sample home for social media (1920x1080 MP4, silent), in close shots: the home by day, furniture placed
// in edit mode like in a building game, night falls, lights switched on with clicks, the whole home at night, every light off
// from the Dashboard, and day again (it ends where it starts, so it loops).
// Recorded frame by frame on a paused clock (page.clock), so it is smooth however slowly the scene renders headless. A drawn
// cursor and click ring show what is clicked (a screenshot has no mouse pointer). Run with a dev server open (automated
// browsers use the sample data): `npm run promo`. Needs ffmpeg. Output: shots/promo.mp4 (PROMO_OUT to change it).
//
//   FPS=12 npm run promo   quick preview at a lower frame rate
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'
const FPS = Number(process.env.FPS ?? 30)
const OUT = process.env.PROMO_OUT ?? 'shots/promo.mp4'
const LIVING = 'us-g-living'

mkdirSync('shots', { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'homescape-promo-'))
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.addInitScript(() => {
  localStorage.setItem('homescape-hint-controls', '1')
  localStorage.setItem('homescape-labels', '0')
})
await p.clock.install({ time: new Date('2026-10-27T13:00:00') })
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
const H = (fn, ...a) => p.evaluate(([f, args]) => window.__homescape[f](...args), [fn, a])
await p.evaluate(() => {
  window.__homescape.loadDemo('american', true)
  window.__homescape.setTheme('day')
})
await p.waitForTimeout(4500)
await p.click('#panel-toggle')
// Every light off: when night falls the home is dark
const lights = await p.evaluate(() => window.__homescape.entityIds().filter((e) => e.startsWith('light.us_')))
for (const id of lights) await H('call', 'light', 'turn_off', { entity_id: id })
await H('focusRoom', LIVING)
await p.waitForTimeout(4000)

// The drawn cursor (Lucide "mouse-pointer-2") and the click ring, above everything, never catching the pointer
await p.addStyleTag({
  content: `#promo-cursor{position:fixed;left:0;top:0;width:30px;height:30px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));opacity:0}
#promo-ring{position:fixed;left:0;top:0;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:3px solid #ffd166;pointer-events:none;z-index:2147483646;opacity:0}`,
})
await p.evaluate(() => {
  const c = document.createElement('div')
  c.id = 'promo-cursor'
  c.innerHTML =
    '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="#ffffff" stroke="#1b2042" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const r = document.createElement('div')
  r.id = 'promo-ring'
  document.body.append(c, r)
})

const cur = { x: 1190, y: 700, alpha: 0 }
let ring = null
let frame = 0
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const scr = (x, y, z) => H('project', x, y, z)
const center = async (locator) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

await p.clock.pauseAt(new Date(await p.evaluate(() => Date.now() + 50)))

/** One frame: the cursor and ring drawn, the clock moved on by one frame, a screenshot */
async function shot() {
  const r = ring ? Math.min(1, ring.f / (0.45 * FPS)) : 1
  await p.evaluate(
    ([c, rg, r]) => {
      const el = document.getElementById('promo-cursor')
      el.style.transform = `translate(${c.x - 4}px, ${c.y - 3}px)`
      el.style.opacity = String(c.alpha)
      const ring = document.getElementById('promo-ring')
      if (rg) {
        ring.style.transform = `translate(${rg.x}px, ${rg.y}px) scale(${0.35 + r * 1.1})`
        ring.style.opacity = String(0.95 * (1 - r))
      } else ring.style.opacity = '0'
    },
    [cur, ring, r],
  )
  if (ring && ++ring.f > 0.45 * FPS) ring = null
  await p.clock.runFor(Math.round(1000 / FPS))
  await p.screenshot({ path: join(dir, `f${String(frame++).padStart(5, '0')}.png`) })
}
const hold = async (sec) => {
  for (let i = 0; i < Math.round(sec * FPS); i++) await shot()
}
const fade = async (to, sec) => {
  const from = cur.alpha
  const n = Math.max(1, Math.round(sec * FPS))
  for (let i = 1; i <= n; i++) {
    cur.alpha = from + (to - from) * (i / n)
    await shot()
  }
}
/** Moves the cursor (and the real mouse, for hover and drags) to a point on screen */
const moveTo = async (pt, sec) => {
  const [x0, y0] = [cur.x, cur.y]
  const n = Math.max(1, Math.round(sec * FPS))
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    cur.x = x0 + (pt.x - x0) * t
    cur.y = y0 + (pt.y - y0) * t
    await p.mouse.move(cur.x, cur.y)
    await shot()
  }
}
const click = async () => {
  await p.mouse.down()
  ring = { x: cur.x, y: cur.y, f: 0 }
  await shot()
  await p.mouse.up()
  await shot()
}
const drag = async (to, sec) => {
  await p.mouse.down()
  await moveTo(to, sec)
  await p.mouse.up()
}
/** Item under the cursor, from the quick pill's state (it opens after a short pause on an item) */
const hovered = () => p.evaluate(async () => (await import('/src/ui/quickState.ts')).useQuick.getState().id)
const lightStates = () => p.evaluate(() => Object.fromEntries(window.__homescape.entityIds().filter((e) => e.startsWith('light.')).map((e) => [e, window.__homescape.entity(e).state])))
/**
 * Clicks a light in the scene. The cursor goes to the light, waits for its pill and, when another item is under it,
 * nudges a little until it is on one of `items` (like a hand aiming). Anything the click switched by mistake is put back.
 */
const clickLight = async (entity, items, at, sec = 0.7, tries = 3) => {
  const base = await scr(...at)
  await moveTo(base, sec)
  await hold(0.2)
  const nudges = [[0, -12], [0, 12], [-12, 0]].slice(0, tries)
  for (let k = 0; !items.includes(await hovered()) && k < nudges.length; k++) {
    await moveTo({ x: base.x + nudges[k][0], y: base.y + nudges[k][1] }, 0.12)
    await hold(0.15)
  }
  const before = await lightStates()
  if (items.includes(await hovered())) await click()
  else {
    // Not under the cursor (seen in the kitchen): the same switch through the app's service call, the click drawn
    console.log(`no aim on ${entity}, switched by a service call`)
    ring = { x: cur.x, y: cur.y, f: 0 }
    await H('call', 'light', 'turn_on', { entity_id: entity })
    await shot()
  }
  await hold(0.05)
  const after = await lightStates()
  for (const [id, state] of Object.entries(after)) if (id !== entity && state !== before[id]) await H('call', 'light', before[id] === 'on' ? 'turn_on' : 'turn_off', { entity_id: id })
  if ((await H('entity', entity))?.state !== 'on') await H('call', 'light', 'turn_on', { entity_id: entity })
}
/** The visible button lowest on screen with this text: a room in the room bar at the bottom */
const chip = (text) =>
  p.evaluate((t) => {
    const all = [...document.querySelectorAll('button')].filter((b) => b.textContent.includes(t) && b.offsetParent)
    const r = all.map((b) => b.getBoundingClientRect()).sort((a, c) => c.top - a.top)[0]
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, text)
/** The theme button in the top bar (Automatic, Day, Night in turn) */
const themeButton = () => p.locator('button[title^="Theme: "]').first()
const tab = (label) => p.locator(`button[role="tab"][aria-label="${label}"]`)
const bar = (text) => p.locator(`nav[aria-label="Build bar"] button:has-text("${text}")`).first()

// 1. The home by day, close: a turn around the living room (left drag rotates)
await fade(1, 0.2)
await moveTo({ x: 150, y: 470 }, 0.6)
await drag({ x: 450, y: 455 }, 2.0)
await hold(0.3)

// 2. Edit mode: furniture dragged into the living room like in a building game
await H('focusRoom', LIVING)
await moveTo(await center(tab('Edit')), 1.0)
await click()
await hold(0.7)
await moveTo(await center(bar('Furniture')), 0.5)
await click()
await hold(0.3)
await moveTo(await center(bar('Armchair')), 0.6)
await drag(await scr(-4.6, 0, 6.0), 1.2)
await hold(0.4)
await H('select', null)
const plant = bar('Potted plant')
await plant.scrollIntoViewIfNeeded()
await moveTo(await center(plant), 0.6)
await drag(await scr(-2.2, 0, 8.2), 1.1)
await hold(0.4)
await H('select', null)
await moveTo(await center(tab('View')), 0.8)
await click()
await hold(0.4)

// 3. Night falls (theme button), the living room is dark: one click after another lights it up
await moveTo(await center(themeButton()), 0.9)
await click()
await hold(1.2)
await clickLight('light.us_living_floor_lamp', ['us-g-floorLamp-1'], [-3.55, 1.35, 9.4], 0.8)
await hold(0.5)
await clickLight('light.us_living_table_lamp', ['us-g-tableLamp-1'], [-6.55, 0.75, 9.45])
await hold(0.35)
await clickLight('light.us_living_downlights', ['us-g-downlight-1', 'us-g-downlight-2', 'us-g-downlight-3', 'us-g-downlight-4'], [-4, 2.55, 7])
await hold(0.9)

// 4. Over to the kitchen from the room bar, its lights on
await moveTo(await chip('Kitchen and dining'), 0.8)
await click()
await hold(1.4)
await clickLight('light.us_kitchen_island', ['us-g-pendant-2', 'us-g-pendant-3'], [3.99, 1.95, 1.7], 0.7, 0)
await hold(0.25)
await clickLight('light.us_kitchen_dining', ['us-g-pendant-4'], [1.6, 1.95, 3.6], 0.5, 0)
await hold(0.25)
await clickLight('light.us_kitchen_downlights', ['us-g-downlight-5', 'us-g-downlight-6', 'us-g-downlight-7'], [1.2, 2.2, 1.15], 0.5, 0)
await hold(0.7)

// 5. Away from the house: the whole home at night (about twice the distance, the zoom goes toward the middle of the view)
await H('focusRoom', LIVING)
await moveTo({ x: 140, y: 520 }, 1.0)
const near = (await H('camera')).distance
for (let i = 0; i < 12 && (await H('camera')).distance < near * 2.1; i++) {
  await p.mouse.wheel(0, 90)
  await hold(0.1)
}
await hold(0.4)
await drag({ x: 520, y: 500 }, 2.6)
await hold(0.4)

// 6. The Dashboard: every light off with one click, back to the dark home
await moveTo(await center(tab('Dashboard')), 0.8)
await click()
await hold(1.1)
await moveTo(await center(p.locator('#dash-lights-off')), 0.8)
await hold(0.2)
await click()
await hold(1.1)
await moveTo(await center(tab('View')), 0.8)
await click()
await hold(0.9)

// 7. Day again (Automatic: the sun is up at 13:00), back down to the living room as at the start: the video loops
await moveTo(await center(themeButton()), 0.8)
await click()
await H('focusRoom', LIVING)
await hold(1.2)
await moveTo({ x: 1190, y: 700 }, 0.9)
await fade(0, 0.3)

await b.close()
console.log(`${frame} frames (${(frame / FPS).toFixed(1)} s)`)
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%05d.png'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT,
])
if (process.env.PROMO_KEEP) console.log(`frames kept in ${dir}`)
else rmSync(dir, { recursive: true, force: true })
console.log(`${OUT}: ${(statSync(OUT).size / 1e6).toFixed(1)} MB`)
if (errors.length) console.log(`Page errors: ${errors.join(' | ')}`)
