// README media: screenshots and animations of the sample home for README.md. Run with a dev server that has no HA_URL
// (automated browsers use the sample data anyway): `npm run media`. The animations need ffmpeg and img2webp (libwebp's
// tools; macOS: `brew install ffmpeg webp`).
// Output: docs/screenshots/{overview,room,dashboard}.png and docs/media/{tour,walk}.webp (animated WebP: a fraction
// of the size of a GIF at better quality; GitHub shows it like any image)
//
//   npm run media                  everything
//   MEDIA=shots npm run media      screenshots only
//   MEDIA=tour,walk npm run media  the animations only
//
// Animations are recorded frame by frame on a paused clock (page.clock), so they are smooth however slowly the scene
// renders in a headless browser.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'
const ONLY = new Set((process.env.MEDIA ?? 'shots,tour,walk').split(','))
/** Frame rate and width of the animations in the README (record options can lower them to keep a file small) */
const FPS = 15
const OUT_W = 960
/** WebP quality */
const QUALITY = 68

mkdirSync('docs/screenshots', { recursive: true })
mkdirSync('docs/media', { recursive: true })
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []

/** A fresh page on the sample home, daytime, the camera framing the whole lot, no notice on screen */
async function open(width = 1600, height = 900) {
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-US' })
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
  return p
}
const H = (p, fn, ...a) => p.evaluate(([f, args]) => window.__homescape[f](...args), [fn, a])
/** Hides the walk's "click to start" card (a headless browser cannot lock the pointer) */
const hideWalkCard = (p) => p.evaluate(async () => (await import('/src/scene/fps.ts')).useFps.getState().setLocked(true))
const room = (p, name) =>
  p.evaluate((n) => {
    const s = window.__homescape.getState().layout
    for (const l of s.layout.levels) {
      const r = l.rooms.find((q) => q.name === n)
      if (r) return r
    }
    return null
  }, name)
const ease = (t) => t * t * (3 - 2 * t)
const mix = (a, c, t) => a + (c - a) * t

/** Records `seconds` of animation, calling `step(i, t)` (t from 0 to 1) before each frame; then encodes an animated WebP */
async function record(p, out, seconds, step, { fps = FPS, width = OUT_W } = {}) {
  const frames = Math.round(seconds * fps)
  const dir = mkdtempSync(join(tmpdir(), 'homescape-media-'))
  await p.clock.pauseAt(new Date(await p.evaluate(() => Date.now() + 50)))
  for (let i = 0; i < frames; i++) {
    await step(i, i / (frames - 1))
    await p.clock.runFor(Math.round(1000 / fps))
    await p.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.png`) })
  }
  await p.clock.resume()
  // Scaled down, then every frame encoded whole (-kmax 1: all key frames). Frames that only update what changed leave blocks
  // on the soft gradients of walls and ceilings, since small changes are skipped.
  mkdirSync(join(dir, 's'))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, 'f%04d.png'), '-vf', `scale=${width}:-1:flags=lanczos`, join(dir, 's', 'f%04d.png')])
  const scaled = readdirSync(join(dir, 's')).filter((f) => f.endsWith('.png')).sort()
  const delay = String(Math.round(1000 / fps))
  execFileSync('img2webp', ['-loop', '0', '-kmax', '1', ...scaled.flatMap((f) => ['-d', delay, '-lossy', '-q', String(QUALITY), '-m', '6', join(dir, 's', f)]), '-o', out], { stdio: 'pipe' })
  // MEDIA_KEEP=1 keeps the frames (to try other encodings)
  if (process.env.MEDIA_KEEP) console.log(`frames kept in ${dir}`)
  else rmSync(dir, { recursive: true, force: true })
  console.log(`${out}: ${frames} frames, ${(statSync(out).size / 1e6).toFixed(1)} MB`)
}

if (ONLY.has('shots')) {
  const p = await open()
  await p.screenshot({ path: 'docs/screenshots/overview.png' })
  console.log('docs/screenshots/overview.png')

  const living = await room(p, 'Living room')
  await H(p, 'focusRoom', living.id)
  await p.waitForTimeout(3000)
  await p.screenshot({ path: 'docs/screenshots/room.png' })
  console.log('docs/screenshots/room.png')

  await p.click('button[role="tab"][aria-label="Dashboard"]')
  await p.waitForSelector('#dashboard')
  await p.waitForTimeout(1500)
  await p.screenshot({ path: 'docs/screenshots/dashboard.png' })
  console.log('docs/screenshots/dashboard.png')
  await p.close()
}

if (ONLY.has('tour')) {
  // The camera circles the house: the side panel folded away, a little closer, a slow drag on the street (left drag rotates)
  const p = await open(1280, 720)
  await p.click('#panel-toggle')
  await p.mouse.move(640, 400)
  await p.mouse.wheel(0, -240)
  await p.waitForTimeout(1500)
  const [x0, x1, y] = [300, 820, 600]
  await p.mouse.move(x0, y)
  await p.mouse.down()
  await record(p, 'docs/media/tour.webp', 7, (_i, t) => p.mouse.move(mix(x0, x1, ease(t)), y), { fps: 12, width: 880 })
  await p.mouse.up()
  await p.close()
}

if (ONLY.has('walk')) {
  // First-person walk along a planned path: in through the front door, across the foyer past the stairs, through the
  // kitchen door, then a slow look around the kitchen and dining room. Positions come from the sample plan (front door,
  // foyer and kitchen door); the walk is driven by teleporting every frame, so it never bumps into a wall.
  const p = await open(1280, 720)
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await hideWalkCard(p)
  await p.waitForTimeout(2000)
  const start = await H(p, 'fps')
  const kitchen = await room(p, 'Kitchen and dining')
  const door = await p.evaluate((k) => {
    // The door in the kitchen's front wall that leads into the foyer
    const l = window.__homescape.getState().layout.layout.levels.find((v) => (v.elevation ?? 0) === 0)
    return l.items.filter((i) => i.kind === 'door' && Math.abs(i.z - (k.z + k.d)) < 0.4).sort((a, c) => Math.abs(a.x) - Math.abs(c.x))[0]
  }, kitchen)
  const keys = [
    { t: 0, x: start.x, z: start.z, yaw: start.yaw },
    { t: 0.42, x: door.x, z: door.z + 0.3, yaw: start.yaw },
    { t: 0.62, x: door.x, z: door.z - 1.6, yaw: start.yaw + 0.55 },
    { t: 1, x: door.x + 0.5, z: door.z - 2.2, yaw: start.yaw - 1.0 },
  ]
  const at = (t) => {
    const k = keys.findIndex((q, i) => i === keys.length - 1 || keys[i + 1].t >= t)
    const a = keys[Math.min(k, keys.length - 2)]
    const c = keys[Math.min(k + 1, keys.length - 1)]
    const u = Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t || 1)))
    return { x: mix(a.x, c.x, u), z: mix(a.z, c.z, u), yaw: mix(a.yaw, c.yaw, u) }
  }
  // Eased as a whole: starts and ends gently, no stop at the points in between
  await record(p, 'docs/media/walk.webp', 9, async (_i, t) => {
    const q = at(ease(t))
    await H(p, 'fpsTeleport', q.x, q.z, q.yaw, -0.05)
  })
  await p.close()
}

await b.close()
if (errors.length) console.log(`Page errors: ${errors.join(' | ')}`)
