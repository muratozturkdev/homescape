// Sound regression test (user request, 9 Oct 2026: "add sound, there is no sound at all; you should add sound everywhere there
// could be sound"). `npm run dev` must be running first. Run: npm run check:sound
// Sounds cannot be listened to; the test checks them: every sound rendered offline has no broken values and is audible; the sound
// button and menu; opening on the first touch; continuous sounds (fridge, outdoors, TV show); short sounds on state changes (light
// switch, TV turning on, door, lock, doorbell); footsteps in the walkthrough and the muffling of a sound from another room; the cat's
// reaction; the cabinet door; the sound of placing an item in edit mode; going silent when turned off, muting a channel; saving the settings.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.evaluate(() => localStorage.removeItem('homescape-sound'))
await p.reload()
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1000)

const snd = () => p.evaluate(() => window.__homescape.sound())
const played = async (name, since) => (await snd()).log.filter((e) => e.name === name && e.played && e.at >= since)
const now = () => p.evaluate(() => Math.round(performance.now()))

// --- Every sound: offline render, no broken values, audible, not clipping ---
const levels = await p.evaluate(async () => {
  const V = await import('/src/audio/voices.ts')
  const S = await import('/src/audio/shots.ts')
  const out = []
  for (const n of V.VOICE_NAMES) out.push({ n, ...(await window.__homescape.soundMeasure('voice', n, { seconds: 8, p: 0.5 })) })
  for (const n of S.SHOT_NAMES) out.push({ n, ...(await window.__homescape.soundMeasure('shot', n, { v: n === 'carPass' ? '5' : undefined })) })
  return out
})
const bad = levels.filter((r) => r.nan || r.peak < 0.01 || r.peak > 1)
ok(levels.length > 90 && !bad.length, `${levels.length} sounds render; all are audible and do not clip${bad.length ? `: ${bad.map((r) => `${r.n} ${r.peak.toFixed(3)}`).join(', ')}` : ''}`)

// --- Button and menu; opens on the first touch ---
ok((await snd()).state === 'none', 'There is no audio context when the page opens (browser rule: it waits for the first touch)')
await p.click('#sound-toggle')
await p.waitForSelector('#sound-menu')
await p.waitForTimeout(800)
let s = await snd()
ok(s.state === 'running' && s.on, `Pressing the sound button turns the sound on (${s.state})`)
await p.screenshot({ path: 'shots/sound-menu.png' })
ok((await p.$$('#sound-menu [role="switch"]')).length === 9 && (await p.$$('#sound-menu input[id^="sound-level-"]')).length === 8, 'The menu has the sound switch and a switch and level slider for each of the eight sound types')
await p.mouse.click(800, 500)
await p.waitForTimeout(1200)

// --- Continuous sounds ---
s = await snd()
const voices = s.loops.map((l) => l.voice)
ok(voices.includes('fridge'), `The fridge hums (${voices.join(', ')})`)
ok(voices.includes('wind') && (voices.includes('birds') || voices.includes('crickets') || voices.includes('rain')), 'Outdoors: wind, and birds by day or crickets at night')
// Output level and channel gains are measured on the running audio graph. A machine without a working audio device leaves
// the audio clock frozen although the context says "running": these checks then say nothing about the app, so they are skipped
const clock0 = (await snd()).time
await p.waitForTimeout(400)
const audioRuns = (await snd()).time > clock0
const skip = (m) => console.log(`SKIP  ${m} (the audio clock of this machine is not running)`)
if (audioRuns) ok(s.rms > 0.0005, `There is sound at the output (RMS ${s.rms.toFixed(4)})`)
else skip('There is sound at the output')

// --- Short sounds on state changes ---
const ids = await p.evaluate(() => window.__homescape.entityIds())
const light = ids.find((i) => i.startsWith('light.'))
const tv = ids.find((i) => i.startsWith('media_player.'))
let t0 = await now()
const le = await p.evaluate((id) => window.__homescape.entity(id), light)
await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: e.state === 'on' ? 'off' : 'on' }), le)
await p.waitForTimeout(200)
ok((await played('click', t0)).length === 1, 'Switch sound when a light is turned on')
const te = await p.evaluate((id) => window.__homescape.entity(id), tv)
await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: 'off' }), te)
await p.waitForTimeout(300)
t0 = await now()
await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: 'playing' }), te)
await p.waitForTimeout(800)
s = await snd()
ok((await played('tvOn', t0)).length === 1 && s.loops.some((l) => l.voice === 'tvShow'), 'Turn-on sound when the TV turns on, the show\'s speech when it plays')
await p.evaluate((e) => window.__homescape.setEntity(e), te)
await p.evaluate((e) => window.__homescape.setEntity(e), le)

// Test room: a door with a sensor, a lock, a doorbell, a kitchen and a bedroom (muffling)
const r = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  const a = s.addRoom({ name: 'Sound A', floor: 'wood', x: 300, z: 0, w: 4, d: 4 })
  const b = s.addRoom({ name: 'Sound B', floor: 'tile', x: 304, z: 0, w: 4, d: 4 })
  const ent = (id, state, attrs = {}) => window.__homescape.setEntity({ entity_id: id, state, attributes: attrs })
  ent('binary_sensor.t_snd_door', 'off', { device_class: 'door' })
  ent('lock.t_snd_lock', 'locked')
  ent('binary_sensor.t_snd_bell', 'off', { device_class: 'occupancy' })
  ent('media_player.t_snd_speaker', 'playing')
  return {
    a,
    b,
    door: s.addItem('door', 304, 2, -Math.PI / 2, 'binary_sensor.t_snd_door'),
    lock: s.addItem('door', 302, 4 - 0.21, Math.PI, 'lock.t_snd_lock'),
    bell: s.addItem('doorbell', 306, 4 - 0.06, Math.PI, 'binary_sensor.t_snd_bell'),
    speaker: s.addItem('speaker', 307, 0.6, 0, 'media_player.t_snd_speaker'),
  }
})
// Short sounds do not play beyond 45 m: point the camera at the test rooms
await p.evaluate((id) => window.__homescape.focusRoom(id), r.a)
await p.waitForTimeout(1500)
t0 = await now()
await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'binary_sensor.t_snd_door', state: 'on', attributes: { device_class: 'door' } }))
await p.waitForTimeout(150)
await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'binary_sensor.t_snd_door', state: 'off', attributes: { device_class: 'door' } }))
await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'lock.t_snd_lock', state: 'unlocked', attributes: {} }))
await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'binary_sensor.t_snd_bell', state: 'on', attributes: { device_class: 'occupancy' } }))
await p.waitForTimeout(300)
const got = await Promise.all(['doorOpen', 'doorClose', 'unlock', 'dingDong'].map(async (n) => (await played(n, t0)).length > 0))
ok(got.every(Boolean), `Sounds when the door opens and closes, the lock opens, the doorbell rings (${['open', 'close', 'lock', 'bell'].map((x, i) => `${x} ${got[i]}`).join(', ')})`)
t0 = await now()
await p.evaluate(() => window.__homescape.getState().layout.addItem('plant', 301, 1, 0))
await p.waitForTimeout(200)
ok((await played('place', t0)).length === 1, 'Interface sound when an item is placed in edit mode')

// --- Walkthrough: footsteps, a speaker in another room is muffled, one in the same room is clear ---
await p.evaluate(() => window.__homescape.setMode('view'))
await p.click('#fps-toggle')
await p.waitForSelector('#fps-hud')
await p.evaluate(() => window.__homescape.fpsTeleport(301, 2, -Math.PI / 2))
await p.waitForTimeout(900)
s = await snd()
const far = s.loops.find((l) => l.key === r.speaker)
ok(far && far.muffle >= 0.25, `In the walkthrough the speaker in the next room sounds muffled (muffle ${far?.muffle})`)
t0 = await now()
await p.keyboard.down('KeyW')
await p.waitForTimeout(1500)
await p.keyboard.up('KeyW')
const steps = await played('step', t0)
ok(steps.length >= 2, `Footstep sounds while walking in the walkthrough (${steps.length} steps)`)
await p.evaluate(() => window.__homescape.fpsTeleport(306.5, 2, Math.PI))
await p.waitForTimeout(900)
s = await snd()
const near = s.loops.find((l) => l.key === r.speaker)
ok(near && near.muffle === 0 && near.voice === 'music', `In the same room the music sounds clear (muffle ${near?.muffle})`)
await p.screenshot({ path: 'shots/sound-walk.png' })
await p.click('#fps-toggle')
await p.waitForTimeout(300)

// --- Walking up to a closed exterior door in the walkthrough opens it (scene/doorTraffic.ts), opening sound ---
{
  const door = await p.evaluate(async () => {
    const geo = await import('/src/model/geometry.ts')
    const s = window.__homescape.getState().layout
    const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
    const d = lv.items.find((i) => i.kind === 'door' && !geo.doorSides(i, lv.rooms).back)
    if (!d) return null
    // A door with a sensor or a lock is decided by HA, a walker does not open it (scene/doorTraffic.ts > controlled): leave the
    // door unbound for the test (only the demo plan in this browser)
    if (d.entityId || d.extras?.length) s.updateItem(d.id, { entityId: null, extras: [] })
    // On the inner side of the door (local +z faces the room) 1.6 m away, facing the door
    return { x: d.x + Math.sin(d.rot) * 1.6, z: d.z + Math.cos(d.rot) * 1.6, yaw: d.rot }
  })
  if (door) {
    await p.click('#fps-toggle')
    await p.waitForSelector('#fps-hud')
    await p.evaluate(({ x, z, yaw }) => window.__homescape.fpsTeleport(x, z, yaw, 0), door)
    await p.waitForTimeout(600)
    t0 = await now()
    await p.keyboard.down('KeyW')
    await p.waitForTimeout(900)
    await p.keyboard.up('KeyW')
    await p.waitForTimeout(300)
    ok((await played('doorOpen', t0)).length >= 1, 'Walking up to a closed exterior door in the walkthrough opens it (opening sound)')
    await p.click('#fps-toggle')
    await p.waitForTimeout(300)
  } else ok(false, 'The sample home has no exterior door')
}

// --- A petted cat meows or purrs ---
const cat = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  const id = s.addItem('cat', 302, 2.5, 0)
  s.setMode('view')
  return id
})
await p.evaluate((id) => window.__homescape.focusRoom(id), r.a)
await p.waitForTimeout(1800)
t0 = await now()
await p.evaluate(async (id) => (await window.__homescape.pets()).poke(id), cat)
await p.waitForTimeout(300)
const petSounds = (await snd()).log.filter((e) => ['meow', 'purr', 'hiss'].includes(e.name) && e.played && e.at >= t0)
ok(petSounds.length >= 1, `The cat makes a sound when petted (${petSounds.map((e) => e.name).join(', ')})`)

// --- In view mode clicking a cabinet door opens it, clicking again closes it: a sound for both ---
const unit = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  const id = s.addItem('tvUnit', 301.5, 0.27, 0)
  s.setMode('view')
  return id
})
await p.waitForTimeout(800)
t0 = await now()
const pt = await p.evaluate(() => window.__homescape.project(301.5, 0.3, 0.47))
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(700)
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(700)
await p.mouse.move(40, 450, { steps: 3 })
ok((await played('cabinetOpen', t0)).length === 1 && (await played('cabinetClose', t0)).length === 1, 'Sound when the cabinet door opens and closes')

// --- Muting a channel, turning the sound off, saving the settings ---
await p.click('#sound-toggle')
await p.waitForSelector('#sound-menu')
await p.click('#sound-bus-nature')
await p.waitForTimeout(800)
s = await snd()
ok(!s.loops.some((l) => l.bus === 'nature'), 'When the outdoor type is turned off, birds and wind go silent')
await p.click('#sound-bus-nature')
// Type level: pulling the slider to zero silences that type, at halfway the level is kept. Since the scene is software-rendered in
// the test, the audio clock advances slowly: wait for the gain to reach its target
const gainOf = async (b, want) => {
  let g = null
  for (let i = 0; i < 40; i++) {
    g = (await snd()).gains[b]
    if (Math.abs(g - want) < 0.02) break
    await p.waitForTimeout(250)
  }
  return g
}
// The browser does not process a channel with no sound in it (the gain value is not updated): point the camera at the fridge's room
await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  const f = lv.items.find((i) => i.kind === 'fridge')
  const room = f && lv.rooms.find((r) => f.x >= r.x && f.x <= r.x + r.w && f.z >= r.z && f.z <= r.z + r.d)
  if (room) window.__homescape.focusRoom(room.id)
})
await p.waitForTimeout(1500)
await p.fill('#sound-level-appliance', '0')
const zero = await gainOf('appliance', 0)
const media = (await snd()).gains.media
await p.fill('#sound-level-appliance', '0.5')
const half = await gainOf('appliance', 0.25)
s = await snd()
if (audioRuns) ok(Math.abs(zero) < 0.02 && media > 0.9 && s.levels.appliance === 0.5 && Math.abs(half - 0.25) < 0.02, `With the appliance level at zero that type goes silent and the others continue; at 50% the channel gain is 0.25 (${zero}, ${media}, ${half})`)
else skip('Channel gains follow the appliance level')
await p.click('#sound-on')
await p.waitForTimeout(900)
s = await snd()
ok(!s.on && s.state === 'suspended' && s.loops.length === 0, `When the sound is turned off everything goes silent and the audio context suspends (${s.state})`)
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('homescape-sound') ?? 'null'))
ok(saved && saved.on === false && saved.buses.nature === true && saved.levels.appliance === 0.5, 'The setting (on, types and their levels) is saved in this browser')
await p.click('#sound-on')
await p.waitForTimeout(800)
ok((await snd()).state === 'running', 'The sound comes back when turned on again')

await p.evaluate(({ a, b, cat, unit }) => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  s.deleteItem(cat)
  s.deleteItem(unit)
  s.deleteRoom(a)
  s.deleteRoom(b)
  s.setMode('view')
}, { ...r, cat, unit })
ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
