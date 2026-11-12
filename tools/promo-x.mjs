// Short promo of the sample home for X and other feeds (1920x1080 MP4, silent, about 26 s): the strongest moment first, hard
// cuts, and a caption on every shot (feeds play videos muted). Shots: the dark home at night lighting up room by room,
// lamps switched on with clicks, the cat and the dog petted, rain then snow by day, a first-person walk in through the front
// door, an armchair dragged in like in a building game, and the lit home at night with the project's address.
// Recorded frame by frame on a paused clock (page.clock), like tools/promo-video.mjs, so it is smooth however slowly the scene
// renders headless; frames are 2560x1440 (capture mode, `homescape-capture`) scaled down to 1080p by ffmpeg. Run with a dev
// server open (automated browsers use the sample data): `npm run promo:x`. Needs ffmpeg. Output: shots/promo-x.mp4
// (PROMO_OUT to change it).
//
//   FPS=12 npm run promo:x   quick preview at a lower frame rate
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, renameSync, statSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'
const FPS = Number(process.env.FPS ?? 30)
const OUT = process.env.PROMO_OUT ?? 'shots/promo-x.mp4'
const LIVING = 'us-g-living'
const CAT = 'us-g-cat-1'
const DOG = 'us-g-dog-1'
/** Indoor rooms of the sample home's ground floor (the framing of the whole house) */
const HOUSE = ['Foyer', 'Living room', 'Office', 'Powder room', 'Pantry', 'Family room', 'Kitchen and dining', 'Laundry room', 'Garage']

mkdirSync('shots', { recursive: true })
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.addInitScript(() => {
  localStorage.setItem('homescape-hint-controls', '1')
  localStorage.setItem('homescape-labels', '0')
  localStorage.setItem('homescape-capture', '1')
  // No roof: every shot looks into the rooms
  localStorage.setItem('homescape-roof-v2', 'off')
})
await p.clock.install({ time: new Date('2026-10-27T13:00:00') })
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
const H = (fn, ...a) => p.evaluate(([f, args]) => window.__homescape[f](...args), [fn, a])
await p.evaluate(() => {
  window.__homescape.loadDemo('american', true)
  window.__homescape.setTheme('night')
})
// The notice "Sample home opened" goes away after 4.5 s
await p.waitForTimeout(5500)
await p.click('#panel-toggle')
// The camera module of the running app (same URL, same instance): framing and turning without a mouse
await p.evaluate(async () => {
  window.__cam = (await import('/src/scene/camera.ts')).cameraApi
  window.__view = (await import('/src/scene/camera.ts')).useView
})

// A clean frame: no status tiles and no map tools; the drawn cursor, the click ring and the caption above everything
await p.addStyleTag({
  content: `#kpi-tiles,[data-promo-hide]{display:none!important}
#promo-cursor{position:fixed;left:0;top:0;width:30px;height:30px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));opacity:0}
#promo-ring{position:fixed;left:0;top:0;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:3px solid #ffd166;pointer-events:none;z-index:2147483646;opacity:0}
#promo-cap{position:fixed;left:50%;top:86px;transform:translateX(-50%);pointer-events:none;z-index:2147483645;opacity:0;text-align:center;font-family:var(--font-sans);white-space:nowrap}
#promo-cap .t{display:inline-block;padding:12px 26px;border-radius:18px;background:rgba(14,16,38,.8);color:#fff;font-size:32px;font-weight:800;letter-spacing:-.01em;box-shadow:0 10px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px)}
#promo-cap .s{display:block;margin-top:10px;font-family:var(--font-mono);font-size:19px;font-weight:600;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.6)}
#promo-cap .s:empty{display:none}`,
})
/** Hides the map tools (again after a mode change: React may draw them anew) */
const clean = () => p.evaluate(() => document.getElementById('panel-toggle')?.closest('div.absolute')?.setAttribute('data-promo-hide', ''))
await clean()
await p.evaluate(() => {
  const c = document.createElement('div')
  c.id = 'promo-cursor'
  c.innerHTML =
    '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="#ffffff" stroke="#1b2042" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const r = document.createElement('div')
  r.id = 'promo-ring'
  const cap = document.createElement('div')
  cap.id = 'promo-cap'
  cap.innerHTML = '<span class="t"></span><span class="s"></span>'
  document.body.append(c, r, cap)
})

const ground = await p.evaluate((names) => {
  const l = window.__homescape.getState().layout.layout.levels.find((v) => (v.elevation ?? 0) === 0)
  const lights = {}
  for (const i of l.items) if (i.entityId?.startsWith('light.')) (lights[i.entityId] ??= []).push([i.x, i.z])
  return { rooms: l.rooms.filter((r) => names.includes(r.name)), lights: Object.entries(lights).map(([e, at]) => ({ e, x: at.reduce((s, a) => s + a[0], 0) / at.length, z: at.reduce((s, a) => s + a[1], 0) / at.length })) }
}, HOUSE)
if (ground.rooms.length < 6) throw new Error(`sample home rooms not found (${ground.rooms.length})`)
const lightIds = ground.lights.map((l) => l.e)
const allLights = (on) => Promise.all(lightIds.map((e) => H('call', 'light', on ? 'turn_on' : 'turn_off', { entity_id: e })))
const frameHouse = (pad) => p.evaluate(([rooms, pad]) => window.__cam.frame(rooms, pad), [ground.rooms, pad])
const turn = (rad) => p.evaluate((r) => window.__cam.rotateBy(r), rad)

const cur = { x: 1190, y: 700, alpha: 0 }
let ring = null
const cap = { text: '', sub: '', f: 0, alpha: 0 }
let frame = 0
/** Called before every frame (camera turns and the like) */
let onFrame = null
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const smooth = (t) => t * t * (3 - 2 * t)
const mix = (a, c, t) => a + (c - a) * t
const scr = (x, y, z) => H('project', x, y, z)
const center = async (locator) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// ffmpeg starts only once the page is up; it writes to a .tmp.mp4 file that replaces the output only when all went well
const tmp = OUT.replace(/\.mp4$/, '.tmp.mp4')
const ffmpeg = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(FPS), '-i', '-',
  '-vf', 'scale=1920:1080:flags=lanczos',
  // x264 at a high quality; aq-mode 3 keeps the dark night gradients from banding
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-x264-params', 'aq-mode=3', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp,
], { stdio: ['pipe', 'inherit', 'inherit'] })
const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))))
const write = (buf) => (ffmpeg.stdin.write(buf) ? Promise.resolve() : new Promise((r) => ffmpeg.stdin.once('drain', r)))

await p.clock.pauseAt(new Date(await p.evaluate(() => Date.now() + 50)))

/** One frame: cursor, ring and caption drawn, the clock moved on by one frame, a screenshot */
async function shot() {
  if (onFrame) await onFrame()
  const r = ring ? Math.min(1, ring.f / (0.45 * FPS)) : 1
  cap.alpha = cap.text ? Math.min(1, cap.f / (0.3 * FPS)) : 0
  await p.evaluate(
    ([c, rg, r, cp]) => {
      const el = document.getElementById('promo-cursor')
      el.style.transform = `translate(${c.x - 4}px, ${c.y - 3}px)`
      el.style.opacity = String(c.alpha)
      const ring = document.getElementById('promo-ring')
      if (rg) {
        ring.style.transform = `translate(${rg.x}px, ${rg.y}px) scale(${0.35 + r * 1.1})`
        ring.style.opacity = String(0.95 * (1 - r))
      } else ring.style.opacity = '0'
      const k = document.getElementById('promo-cap')
      if (k.dataset.text !== cp.text) {
        k.dataset.text = cp.text
        k.querySelector('.t').textContent = cp.text
        k.querySelector('.s').textContent = cp.sub
      }
      const a = 1 - (1 - cp.alpha) ** 3
      k.style.opacity = String(a)
      k.style.transform = `translate(-50%, ${(1 - a) * 14}px)`
    },
    [cur, ring, r, cap],
  )
  if (ring && ++ring.f > 0.45 * FPS) ring = null
  cap.f++
  await p.clock.runFor(Math.round(1000 / FPS))
  await write(await p.screenshot())
  frame++
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
/** Moves the cursor (and, unless `real` is false, the real mouse, for hover and drags) to a point on screen */
const moveTo = async (pt, sec, real = true) => {
  const [x0, y0] = [cur.x, cur.y]
  const n = Math.max(1, Math.round(sec * FPS))
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    cur.x = x0 + (pt.x - x0) * t
    cur.y = y0 + (pt.y - y0) * t
    if (real) await p.mouse.move(cur.x, cur.y)
    await shot()
  }
}
const drag = async (to, sec) => {
  await p.mouse.down()
  await moveTo(to, sec)
  await p.mouse.up()
}
/** A cut: the next shot is set up off camera (time runs on, nothing is recorded); the caption and cursor start over */
const cut = async (setup, ms = 1500) => {
  onFrame = null
  ring = null
  cur.alpha = 0
  await park()
  await setup()
  await p.clock.runFor(ms)
  await clean()
}
const caption = (text, sub = '') => Object.assign(cap, { text, sub, f: 0 })
/**
 * Clicks a lamp: the cursor goes to it, the ring is drawn and the light is switched by the same service call a click makes.
 * The real mouse stays parked, so no item's pill opens (a pill left on the first lamp would sit there while others switch).
 */
const clickLamp = async (entity, at, sec = 0.6) => {
  await moveTo(await scr(...at), sec, false)
  await hold(0.12)
  ring = { x: cur.x, y: cur.y, f: 0 }
  await H('call', 'light', 'turn_on', { entity_id: entity })
  await shot()
}
const pet = (id) =>
  p.evaluate(async (i) => {
    const q = (await window.__homescape.pets()).pets.find((x) => x.id === i)
    return q ? { x: q.x, y: q.y, z: q.z } : null
  }, id)
/** Clicks a pet: the cursor follows it there, the ring is drawn and the pet is petted (like a click on its hit box) */
const clickPet = async (id, sec = 0.6) => {
  const q = await pet(id)
  await moveTo(await scr(q.x, q.y + 0.25, q.z), sec, false)
  ring = { x: cur.x, y: cur.y, f: 0 }
  const bubble = await p.evaluate(async (i) => (await window.__homescape.pets()).poke(i), id)
  await shot()
  return bubble
}
/** An unrecorded click (between shots): straight to the element's center, no waiting for it to settle */
const tap = async (locator) => {
  const c = await center(locator)
  await p.mouse.click(c.x, c.y)
}
/** The real mouse out of the way (on the far right edge of the scene), so no item's pill opens under it */
const park = () => p.mouse.move(1272, 360)
const tab = (label) => p.locator(`button[role="tab"][aria-label="${label}"]`)
const bar = (text) => p.locator(`nav[aria-label="Build bar"] button:has-text("${text}")`).first()

// The cat and the dog are sent to the free floor of the living room now, so they are there by the third shot
await p.evaluate(async ([c, d]) => {
  const g = await window.__homescape.pets()
  // In front of the TV, between it and the coffee table: away from the stairwell wall that hides the right side of the room
  g.command(c, 'sit', -5.7, 6.6)
  g.command(d, 'sit', -4.7, 6.7)
}, [CAT, DOG])

// 1. The hook: the dark home at night lights up room by room, from the front door outwards, while the camera turns
await cut(async () => {
  await allLights(false)
  await frameHouse(0.5)
  await turn(-0.18)
}, 2500)
caption('My Home Assistant, as a live 3D home')
onFrame = () => turn(0.0025 * (30 / FPS))
await hold(0.45)
const door = { x: 0, z: 7.75 }
const wave = [...ground.lights].sort((a, c) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(c.x - door.x, c.z - door.z))
for (const l of wave) {
  await H('call', 'light', 'turn_on', { entity_id: l.e })
  await hold(0.08)
}
await hold(1.2)

// 2. The living room, lamps off: one click after another lights it up
await cut(async () => {
  for (const e of ['light.us_living_floor_lamp', 'light.us_living_table_lamp', 'light.us_living_downlights']) await H('call', 'light', 'turn_off', { entity_id: e })
  await H('focusRoom', LIVING)
}, 2200)
caption('Click a lamp, the real one turns on')
Object.assign(cur, { x: 700, y: 560 })
await fade(1, 0.2)
await clickLamp('light.us_living_floor_lamp', [-3.55, 1.35, 9.4], 0.55)
await hold(0.35)
await clickLamp('light.us_living_table_lamp', [-6.55, 0.75, 9.45], 0.55)
await hold(0.3)
await clickLamp('light.us_living_downlights', [-4, 2.55, 7], 0.5)
await hold(0.8)

// 3. Closer: the cat and the dog, petted
const [c0, d0] = [await pet(CAT), await pet(DOG)]
console.log(`pets at ${c0.x.toFixed(1)},${c0.z.toFixed(1)} and ${d0.x.toFixed(1)},${d0.z.toFixed(1)}`)
await cut(async () => {
  // Centered a little behind them: the pets sit mid-screen and their speech bubbles stay clear of the caption
  await p.evaluate(([x, z]) => window.__cam.focusPoint(x, 0.2, z), [(c0.x + d0.x) / 2, (c0.z + d0.z) / 2 - 0.3])
}, 2200)
caption('Pets you can play with')
Object.assign(cur, { x: 760, y: 600 })
onFrame = () => turn(0.0012 * (30 / FPS))
await fade(1, 0.2)
let said = await clickPet(CAT, 0.5)
await hold(1.0)
// A plain meow has no hearts: once more
if (said === 'Meow!') {
  said = await clickPet(CAT, 0.2)
  await hold(0.8)
}
await clickPet(DOG, 0.45)
await hold(1.2)

// 4. By day: rain, then snow, the camera turning around the house
await cut(async () => {
  await H('setTheme', 'day')
  await H('weatherPreview', 'pour')
  await frameHouse(2)
  await turn(0.25)
}, 3000)
caption('Live weather, day and night')
onFrame = () => turn(-0.003 * (30 / FPS))
await hold(1.8)
await H('weatherPreview', 'snow')
await hold(2.1)

// 5. The first-person walk: in through the front door, across the foyer, into the kitchen, a look around
await cut(async () => {
  await H('weatherPreview', null)
  await tap(p.locator('#fps-toggle'))
  await p.clock.runFor(1000)
  if (!(await p.locator('#fps-hud').count())) throw new Error('the walk did not start')
  await p.evaluate(async () => (await import('/src/scene/fps.ts')).useFps.getState().setLocked(true))
}, 2000)
const start = await H('fps')
const kitchen = ground.rooms.find((r) => r.name === 'Kitchen and dining')
const kdoor = await p.evaluate((k) => {
  // The door in the kitchen's front wall that leads into the foyer
  const l = window.__homescape.getState().layout.layout.levels.find((v) => (v.elevation ?? 0) === 0)
  return l.items.filter((i) => i.kind === 'door' && Math.abs(i.z - (k.z + k.d)) < 0.4).sort((a, c) => Math.abs(a.x) - Math.abs(c.x))[0]
}, kitchen)
const keys = [
  { t: 0, x: start.x, z: start.z, yaw: start.yaw },
  { t: 0.45, x: kdoor.x, z: kdoor.z + 0.3, yaw: start.yaw },
  { t: 0.68, x: kdoor.x, z: kdoor.z - 1.6, yaw: start.yaw + 0.55 },
  { t: 1, x: kdoor.x + 0.5, z: kdoor.z - 2.2, yaw: start.yaw - 0.9 },
]
const at = (t) => {
  const k = keys.findIndex((q, i) => i === keys.length - 1 || keys[i + 1].t >= t)
  const a = keys[Math.min(k, keys.length - 2)]
  const c = keys[Math.min(k + 1, keys.length - 1)]
  const u = Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t || 1)))
  return { x: mix(a.x, c.x, u), z: mix(a.z, c.z, u), yaw: mix(a.yaw, c.yaw, u) }
}
caption('Walk through it in first person')
const walkN = Math.round(4.6 * FPS)
for (let i = 0; i < walkN; i++) {
  const q = at(smooth(i / (walkN - 1)))
  await H('fpsTeleport', q.x, q.z, q.yaw, -0.05)
  await shot()
}

// 6. Edit mode: an armchair dragged into the living room like in a building game
await cut(async () => {
  await p.evaluate(() => window.__view.getState().setFps(false))
  await p.clock.runFor(800)
  await H('focusRoom', LIVING)
  await tap(tab('Edit'))
  await p.clock.runFor(600)
  await tap(bar('Furniture'))
}, 1800)
caption('Build your home like a game')
Object.assign(cur, { x: 640, y: 420 })
await fade(1, 0.15)
await moveTo(await center(bar('Armchair')), 0.55)
await drag(await scr(-4.6, 0, 6.0), 0.85)
await hold(0.25)
await H('select', null)
const plant = bar('Potted plant')
await plant.scrollIntoViewIfNeeded()
await moveTo(await center(plant), 0.5)
await drag(await scr(-2.2, 0, 8.2), 0.8)
await hold(0.45)

// 7. The lit home at night, turning, with the address: the end (and close to the first shot, so it loops)
await cut(async () => {
  await H('select', null)
  await H('setMode', 'view')
  await H('setTheme', 'night')
  await allLights(true)
  await frameHouse(-1.5)
  await turn(0.1)
}, 2500)
caption('Free and open source', 'github.com/muratozturkdev/homescape')
onFrame = () => turn(0.0025 * (30 / FPS))
await hold(3.2)

await b.close()
ffmpeg.stdin.end()
await done
renameSync(tmp, OUT)
console.log(`${frame} frames (${(frame / FPS).toFixed(1)} s)`)
console.log(`${OUT}: ${(statSync(OUT).size / 1e6).toFixed(1)} MB`)
if (errors.length) console.log(`Page errors: ${errors.join(' | ')}`)
