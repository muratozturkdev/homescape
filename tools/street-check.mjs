// Street life regression test (user request, 9 Oct 2026: "the ambient sounds should change at night, cars can pass on the road
// at intervals and people can walk on the sidewalk, children will play in the parks, there can be people walking dogs
// with a leash"): on an L road the car drives in the right lane, turns the corner, slows down in the bend; it does not pass while a
// pedestrian is on the crosswalk; pedestrians stay on the sidewalk, do not pass through items, cross at the crosswalk; the dog is
// leashed and sniffs; children play on the slide, trampoline, sandbox and swing, an adult waits on a bench, they leave at night;
// day and night sounds.
// `npm run dev` must be running first. Run: node tools/street-check.mjs
// Intermediate screenshots: shots/street-*.png. Everything the test adds is deleted at the end.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1200)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const shot = (name) => p.screenshot({ path: `shots/street-${name}.png` })
const street = () => p.evaluate(() => window.__homescape.street().then((s) => JSON.parse(JSON.stringify(s))))
const force = (kind, via) => p.evaluate(([k, v]) => window.__homescape.street().then((s) => s.force(k, v ?? undefined)), [kind, via ?? null])
const theme = (t) => p.evaluate((x) => window.__homescape.setTheme(x), t)
/** Collects the state every 100 ms for the given number of ms */
const sample = async (ms, step = 100) => {
  const out = []
  for (let t = 0; t < ms; t += step) {
    out.push(await street())
    await p.waitForTimeout(step)
  }
  return out
}

// --- Test street (x 700): an L road (crosswalk in the middle of the horizontal part), two sidewalks, a playground ---
const X = 700
const scene = await p.evaluate((X) => {
  const h = window.__homescape
  const s = h.getState().layout
  s.setMode('edit')
  // Keep the weather from being rainy (so the children come)
  for (const id of h.entityIds().filter((e) => e.startsWith('weather.'))) h.setEntity({ ...h.entity(id), state: 'sunny' })
  const R = (name, floor, x, z, w, d) => s.addRoom({ name, floor, x: X + x, z, w, d, type: 'garden', areaId: null })
  const rooms = {
    north: R('S north sidewalk', 'sidewalk', 0, -2.5, 30, 2.5),
    a1: R('S road 1', 'road', 0, 0, 10, 7),
    cross: R('S crosswalk', 'crosswalk', 10, 0, 3, 7),
    a2: R('S road 2', 'road', 13, 0, 17, 7),
    leg: R('S road arm', 'road', 23, 7, 7, 18),
    south: R('S south sidewalk', 'sidewalk', 0, 7, 23, 2.5),
    park: R('S park', 'grass', 0, 9.5, 16, 13),
  }
  const items = [
    ['streetTree', 6, -0.75],
    ['hydrant', 20, -0.4],
    ['streetLamp', 16, -2.2, Math.PI],
    ['slide', 4, 14, 0],
    ['trampoline', 10, 13.5, 0],
    ['sandbox', 4, 19.5, 0],
    ['swing', 11, 19.5, 0],
    ['bench', 14.5, 12, -Math.PI / 2],
  ]
  const ids = []
  for (const [kind, x, z, rot = 0] of items) {
    ids.push({ kind, id: s.addItem(kind, X + x, z, rot), x: X + x, z, rot })
  }
  s.setMode('view')
  return { rooms, ids }
}, X)
const roomIds = Object.values(scene.rooms)
const rects = await p.evaluate((ids) => {
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  return Object.fromEntries(lv.rooms.filter((r) => ids.includes(r.id)).map((r) => [r.name, { x: r.x, z: r.z, w: r.w, d: r.d }]))
}, roomIds)
const inside = (r, x, z, m = 0) => x >= r.x - m && x <= r.x + r.w + m && z >= r.z - m && z <= r.z + r.d + m
const roadRects = ['S road 1', 'S crosswalk', 'S road 2', 'S road arm'].map((n) => rects[n])
const walkRects = ['S north sidewalk', 'S south sidewalk', 'S crosswalk'].map((n) => rects[n])
const cross = rects['S crosswalk']

await p.evaluate((id) => {
  window.__homescape.select(null)
  window.__homescape.focusRoom(id)
}, scene.rooms.a2)
await theme('day')
// Keep the spontaneous ones from mixing with what the test forces
await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = false)))
await p.waitForTimeout(1800)
const s0 = await street()
ok(s0.active === true, `Street life is on in view mode (${s0.active})`)
// Street surfaces (road, sidewalk, crosswalk) are not rooms of the house (user feedback, 9 Oct 2026: "no need to add the sidewalk,
// road, crosswalk etc. here or to write on them with a badge"): no label in the bottom bar or in the view
const texts = () => p.evaluate(() => ({ bar: [...document.querySelectorAll('nav')].filter((n) => n.querySelector('button[title="Whole home"]')).flatMap((n) => [...n.querySelectorAll('button')].map((x) => x.textContent?.trim())), all: [...document.querySelectorAll('span')].map((x) => x.textContent?.trim()) }))
const STREET_NAMES = ['S north sidewalk', 'S road 1', 'S crosswalk', 'S south sidewalk', 'S road arm']
const v1 = await texts()
ok(STREET_NAMES.every((n) => !v1.bar.includes(n) && !v1.all.includes(n)) && v1.bar.includes('S park'), `Road, sidewalk and crosswalk have no label in the bottom bar and in the scene; the park (lawn) stays`)
await p.evaluate(() => window.__homescape.setMode('edit'))
await p.waitForTimeout(600)
const v2 = await texts()
ok(v2.all.includes('S road 1'), 'In edit mode the label of the street surface (with its size) stays')
await p.evaluate(() => window.__homescape.setMode('view'))
await p.waitForTimeout(600)

// --- Car: right lane, turns at the L corner, slows down in the bend, stays on the road ---
ok(await force('car'), 'A car passes on the road (forced to appear)')
const carRuns = await sample(9000)
const carPts = carRuns.flatMap((s) => s.cars)
const offRoad = carPts.filter((c) => !roadRects.some((r) => inside(r, c.x, c.z, 0.3)))
ok(carPts.length > 30 && offRoad.length === 0, `The car stays on the road (${carPts.length} samples, outside ${offRoad.length}${offRoad.length ? `: ${offRoad.slice(0, 2).map((c) => `${c.x.toFixed(1)},${c.z.toFixed(1)}`).join(' ')}` : ''})`)
const onA = carPts.filter((c) => c.z < 6 && c.x < X + 20)
const onLeg = carPts.filter((c) => c.z > 10)
ok(onA.length > 5 && onLeg.length > 5, `The car turns the corner of the L road (${onA.length} samples on the horizontal part, ${onLeg.length} on the arm)`)
// Right lane: heading east it is south of the middle of the road (z 3.5), heading west north of it; on the arm, heading south it is west of the middle
const wrongLane = [
  ...onA.filter((c) => (Math.sin(c.heading) > 0.9 && c.z < 3.6) || (Math.sin(c.heading) < -0.9 && c.z > 3.4)),
  ...onLeg.filter((c) => (Math.cos(c.heading) > 0.9 && c.x > X + 26.4) || (Math.cos(c.heading) < -0.9 && c.x < X + 26.6)),
]
ok(wrongLane.length === 0, `The car drives in the right lane (${wrongLane.length} samples in the wrong lane; z on the horizontal part ${onA.length ? onA[Math.floor(onA.length / 2)].z.toFixed(2) : '-'})`)
const corner = carPts.filter((c) => c.x > X + 20 && c.z > 1 && c.z < 10)
const straight = carPts.filter((c) => c.x < X + 15)
const vCorner = corner.length ? Math.min(...corner.map((c) => c.speed)) : 99
const vStraight = straight.length ? Math.max(...straight.map((c) => c.speed)) : 0
ok(vCorner < 4.5 && vStraight > 6, `It slows down in the bend (at least ${vCorner.toFixed(1)} m/s at the corner, ${vStraight.toFixed(1)} m/s on the straight)`)

// --- Pedestrians: on the sidewalk, without passing through items; across the crosswalk ---
const items = (await p.evaluate((ids) => {
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  return lv.items.filter((it) => ids.includes(it.id)).map((it) => ({ kind: it.kind, x: it.x, z: it.z }))
}, scene.ids.map((i) => i.id)))
const tree = items.find((i) => i.kind === 'streetTree')
const hydrant = items.find((i) => i.kind === 'hydrant')
const lamp = items.find((i) => i.kind === 'streetLamp')
ok(await force('walker', { x: tree.x, z: -1.25 }), 'Someone walking on the sidewalk appears (a route passing in front of the tree)')
ok(await force('walker', { x: X + 11.5, z: 3.5 }), 'Someone crossing at the crosswalk appears')
// Let there be cars approaching the crosswalk too
await force('car')
const walkRuns = []
let waitCar = 0
for (let t = 0; t < 26000; t += 150) {
  const s = await street()
  walkRuns.push(s)
  if (t % 4500 < 150) await force('car')
  await p.waitForTimeout(150)
  void waitCar
}
const wPts = walkRuns.flatMap((s) => s.walkers)
const offWalk = wPts.filter((w) => !walkRects.some((r) => inside(r, w.x, w.z, 0.05)))
ok(wPts.length > 40 && offWalk.length === 0, `Pedestrians stay on the sidewalk and the crosswalk (${wPts.length} samples, outside ${offWalk.length})`)
const near = (o, r) => wPts.filter((w) => Math.hypot(w.x - o.x, w.z - o.z) < r)
const nearTree = wPts.filter((w) => Math.abs(w.x - tree.x) < 0.6 && Math.abs(w.z - tree.z) < 0.6)
ok(nearTree.length === 0 && near(hydrant, 0.3).length === 0 && near(lamp, 0.3).length === 0, `Pedestrians do not pass through the tree, the hydrant or the lamp (at the tree ${nearTree.length}, at the hydrant ${near(hydrant, 0.3).length}, at the lamp ${near(lamp, 0.3).length})`)
const crossed = walkRuns.some((s) => s.walkers.some((w) => inside(cross, w.x, w.z) && w.z > 1 && w.z < 6))
ok(crossed, 'A pedestrian crosses at the crosswalk')
// Safety: while a pedestrian is on the crosswalk no car is inside it (a car already in the crosswalk drives through; a new car stops)
let clash = 0
let yielded = 0
for (const s of walkRuns) {
  const walkerOn = s.walkers.some((w) => inside(cross, w.x, w.z, 0.2))
  const carIn = s.cars.filter((c) => inside(cross, c.x, c.z, 0.2))
  if (walkerOn && carIn.some((c) => c.speed > 2)) clash++
  if (walkerOn && s.cars.some((c) => c.speed < 0.3 && Math.abs(c.z - 3.5) < 3.6 && Math.abs(c.x - (cross.x + cross.w / 2)) < 7)) yielded++
}
ok(clash === 0, `No car speeds through while a pedestrian is on the crosswalk (clashes ${clash}, ${yielded} samples of a car yielding)`)

// --- Dog walker: leashed, next to the owner, sniffs ---
await p.evaluate(() => window.__homescape.street().then((s) => (s.sniffChance = 1)))
ok(await force('dog', { x: hydrant.x, z: -1.25 }), 'A dog walker appears')
const dogRuns = await sample(16000, 150)
const dogs = dogRuns.flatMap((s) => s.dogs)
const owners = dogRuns.flatMap((s) => s.walkers.filter((w) => w.dog))
const spans = dogs.map((d) => d.leash)
ok(dogs.length > 20 && owners.length > 20, `The dog and its owner walk together (${dogs.length} dog samples, ${owners.length} owner samples)`)
const worst = dogRuns.reduce((m, s) => (s.dogs[0] && (!m || s.dogs[0].leash > m.dogs[0].leash) ? s : m), null)
ok(spans.every((l) => l > 0.2 && l < 2.2), `Leash from hand to neck (shortest ${Math.min(...spans).toFixed(2)} m, longest ${Math.max(...spans).toFixed(2)} m${Math.max(...spans) > 2.2 ? `: ${JSON.stringify({ dog: worst.dogs[0], owner: worst.walkers.find((w) => w.dog) })}` : ''})`)
const dogOff = dogs.filter((d) => !walkRects.some((r) => inside(r, d.x, d.z, 0.25)))
ok(dogOff.length === 0, `The dog stays on the sidewalk (outside ${dogOff.length})`)
ok(dogs.some((d) => d.sniff), `The dog stops and sniffs at a tree, hydrant or lamp`)
await p.evaluate(() => window.__homescape.street().then((s) => (s.sniffChance = 0.6)))
await shot('day')

// --- Playground: children play, an adult waits on the bench ---
await p.evaluate((id) => window.__homescape.focusRoom(id), scene.rooms.park)
await p.waitForTimeout(1200)
ok(await force('kids'), 'Children come to the playground')
const kidRuns = await sample(30000, 200)
const kids = kidRuns.flatMap((s) => s.kids)
const ids = new Set(kids.map((k) => k.id))
const slide = items.find((i) => i.kind === 'slide')
const tramp = items.find((i) => i.kind === 'trampoline')
ok(ids.size >= 1, `${ids.size} children came`)
const onSlide = kids.filter((k) => k.play === 'slide' && k.y > 1)
const onTramp = kids.filter((k) => k.play === 'trampoline' && k.y > 0.9)
const seated = kids.filter((k) => (k.play === 'sandbox' || k.play === 'swing') && k.act === 'sit')
ok(onSlide.length + onTramp.length + seated.length > 0, `Children play: ${onSlide.length} samples up on the slide, ${onTramp.length} in the air on the trampoline, ${seated.length} sitting in the sandbox or on the swing`)
// On the ground they do not pass through the play equipment (under the trampoline, the body of the slide)
const through = kids.filter((k) => k.act === 'walk' && ((Math.hypot(k.x - tramp.x, k.z - tramp.z) < 1.1) || (Math.abs(k.x - slide.x) < 0.3 && Math.abs(k.z - slide.z) < 1.2)))
ok(through.length === 0, `Children do not walk through the trampoline and the slide (${through.length})`)
const parent = kidRuns.map((s) => s.parent).filter(Boolean)
ok(parent.some((q) => q.seated), `An adult sits and waits on the nearby bench (${parent.length} samples)`)
await shot('playground')

// --- Sounds: birds and children by day; the car's sound goes with it ---
await p.mouse.click(800, 450)
await p.evaluate(() => window.__homescape.soundUnlock())
await p.evaluate(() => window.__homescape.street().then((s) => s.force('car')))
await p.waitForTimeout(1500)
const daySound = await p.evaluate(() => window.__homescape.sound())
const dayVoices = new Set(daySound.wanted.map((w) => w.voice))
ok(dayVoices.has('birds') && !dayVoices.has('night') && !dayVoices.has('crickets'), `Birds by day, no night sounds (${[...dayVoices].filter((v) => ['birds', 'night', 'crickets', 'city'].includes(v)).join(', ')})`)
ok(dayVoices.has('kids'), 'Children\'s voices at the playground')
ok(dayVoices.has('carDrive'), 'The sound of the passing car goes with the car')

// --- Night: the children leave, the ambience changes, the car's headlights ---
await theme('night')
await p.waitForTimeout(1200)
await p.evaluate(() => window.__homescape.soundNight())
await p.waitForTimeout(1200)
const nightSound = await p.evaluate(() => window.__homescape.sound())
const nightVoices = new Set(nightSound.wanted.map((w) => w.voice))
ok(nightVoices.has('night') && nightVoices.has('crickets') && !nightVoices.has('birds'), `Night ambience: night bed and crickets, no birds (${[...nightVoices].filter((v) => ['birds', 'night', 'crickets', 'city', 'frogs'].includes(v)).join(', ')})`)
const shots = nightSound.log.map((l) => l.name)
ok(shots.includes('owl') && shots.includes('barkFar'), `At night an owl hoots, a dog barks far away (${shots.filter((n) => n === 'owl' || n === 'barkFar').join(', ')})`)
let gone = false
for (let t = 0; t < 20000 && !gone; t += 500) {
  const s = await street()
  gone = s.kids.length === 0 && !s.parent
  if (!gone) await p.waitForTimeout(500)
}
ok(gone, 'At night the children and the adult leave the playground')
await p.evaluate((id) => window.__homescape.focusRoom(id), scene.rooms.a2)
await force('car')
await p.waitForTimeout(2600)
await shot('night')

// --- Setting: cars, pedestrians and children can be turned off separately (user request: "I should be able to turn the people
// and cars outside off and on whenever I want") ---
await theme('day')
await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = false)))
await force('car')
await force('walker')
await p.waitForTimeout(500)
const before = await street()
await p.click('button[title^="People:"]')
await p.waitForTimeout(300)
const sw = async (k) => p.click(`#street-${k}`)
const checked = (k) => p.getAttribute(`#street-${k}`, 'aria-checked')
await sw('cars')
await p.waitForTimeout(500)
const noCars = await street()
ok(before.cars.length > 0 && noCars.cars.length === 0 && noCars.walkers.length > 0 && (await checked('cars')) === 'false', `Turning off "Passing cars" removes the cars at once and leaves the pedestrians (${before.cars.length} cars before, ${noCars.cars.length} after; ${noCars.walkers.length} pedestrians)`)
ok((await force('car')) === false, 'No car appears while it is off')
await sw('walkers')
await p.waitForTimeout(500)
const noWalk = await street()
ok(noWalk.walkers.length === 0 && noWalk.dogs.length === 0 && (await force('walker')) === false, `Turning off "Pedestrians and dog walkers" removes the pedestrians (${noWalk.walkers.length})`)
await sw('kids')
await p.waitForTimeout(500)
ok((await street()).active === false, 'With all three off, street life is off entirely')
const kept = await p.evaluate(() => localStorage.getItem('homescape-street'))
ok(kept && JSON.parse(kept).cars === false && JSON.parse(kept).walkers === false, `The choice is remembered (${kept})`)
for (const k of ['cars', 'walkers', 'kids']) await sw(k)
await p.waitForTimeout(800)
await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = false)))
ok((await street()).active === true && (await force('car')) === true, 'Cars and pedestrians come back when turned on again')
await p.click('button[title^="People:"]')

// --- Cleanup ---
await theme('auto')
const left = await p.evaluate(
  ({ rooms, items }) => {
    const s = window.__homescape.getState().layout
    s.setMode('edit')
    for (const id of items) s.deleteItem(id)
    for (const id of rooms) s.deleteRoom(id)
    s.setMode('view')
    const st = window.__homescape.getState().layout
    const lv = st.layout.levels.find((l) => l.id === st.levelId) ?? st.layout.levels[0]
    return lv.rooms.filter((r) => rooms.includes(r.id)).length
  },
  { rooms: roomIds, items: scene.ids.map((i) => i.id) },
)
await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = true)))
ok(left === 0, 'The test deleted what it added')
// --- The user's road (user feedback, 9 Oct 2026: "the cars' turns are not good, they cannot make sharp turns; I have a
// stationary car on the road and the other car drives through it"): a 4.5 m vertical arm, a 2 m connecting piece at the
// corner and a crosswalk, a horizontal road; a parked car in the right lane of the vertical arm ---
{
  const U = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    s.setMode('edit')
    const R = (name, floor, x, z, w, d) => s.addRoom({ name, floor, x, z, w, d, type: 'garden', areaId: null })
    const rooms = [R('K arm', 'road', 760, 0, 4.5, 18.5), R('K link', 'road', 764.5, 0, 2, 4.75), R('K crossing', 'crosswalk', 766.5, 0, 2.5, 4.75), R('K road', 'road', 769, 0, 15, 4.75)]
    const car = s.addItem('car', 763.35, 12.1, Math.PI, null, undefined, { variant: 'hatch' })
    s.setMode('view')
    return { rooms, car }
  })
  await p.evaluate((id) => window.__homescape.focusRoom(id), U.rooms[0])
  await p.waitForTimeout(1500)
  await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = false)))
  const parked = { x: 763.35, z: 12.1 }
  const runs = []
  for (let t = 0; t < 26000; t += 100) {
    if (t % 6000 === 0) await force('car')
    runs.push(await street())
    await p.waitForTimeout(100)
  }
  const pts = runs.flatMap((s) => s.cars).filter((c) => c.x > 755 && c.x < 790)
  const near = Math.min(...pts.map((c) => Math.hypot(c.x - parked.x, c.z - parked.z)))
  ok(pts.length > 40 && near > 1.85, `A passing car does not drive through the parked car, it changes lanes and passes it (closest ${near.toFixed(2)} m, ${pts.length} samples)`)
  // Turning radius: speed / turn rate (from samples 100 ms apart)
  let minR = Infinity
  const byId = new Map()
  runs.forEach((s, i) => s.cars.forEach((c) => byId.set(c.id, [...(byId.get(c.id) ?? []), { ...c, t: i }])))
  for (const list of byId.values())
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]
      const c = list[i]
      if (c.t !== a.t + 1) continue
      const w = Math.abs(Math.atan2(Math.sin(c.heading - a.heading), Math.cos(c.heading - a.heading))) / 0.1
      const v = Math.hypot(c.x - a.x, c.z - a.z) / 0.1
      if (w > 0.05 && v > 0.3) minR = Math.min(minR, v / w)
    }
  const turned = [...byId.values()].some((l) => l.some((c) => c.z < 4.75 && c.x > 770) && l.some((c) => c.z > 8))
  ok(turned && minR > 3, `It turns wide despite the short link piece and the crossing at the corner (smallest turning radius ${minR.toFixed(1)} m)`)
  const offRoad = pts.filter((c) => !(c.x >= 759.7 && c.x <= 764.8 && c.z >= -0.3 && c.z <= 18.8) && !(c.x >= 764.2 && c.x <= 784.3 && c.z >= -0.3 && c.z <= 5.05))
  ok(offRoad.length === 0, `It does not leave the road in the turn (${offRoad.length})`)
  await shot('parked')
  await p.evaluate(({ rooms, car }) => {
    const s = window.__homescape.getState().layout
    s.setMode('edit')
    s.deleteItem(car)
    for (const r of rooms) s.deleteRoom(r)
    s.setMode('view')
  }, U)
}

// --- In the American sample home (user request: "let's do our tests there") ---
{
  const prev = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    return s.homeId ?? s.homes?.[0]?.id ?? 'home-main'
  })
  const usId = await p.evaluate(() => window.__homescape.loadDemo('american', true))
  await p.waitForTimeout(2500)
  const us = await p.evaluate(() => {
    const h = window.__homescape
    h.getState().layout.setMode('view')
    const st = h.getState().layout
    const lv = st.layout.levels.find((l) => l.id === st.levelId)
    const all = (r) => [{ x: r.x, z: r.z, w: r.w, d: r.d }, ...(r.parts ?? [])]
    return {
      road: lv.rooms.filter((r) => r.floor === 'road' || r.floor === 'crosswalk').flatMap(all),
      walk: lv.rooms.filter((r) => r.floor === 'sidewalk' || r.floor === 'crosswalk').flatMap(all),
      roadId: lv.rooms.find((r) => r.floor === 'road')?.id,
    }
  })
  await p.evaluate((id) => window.__homescape.focusRoom(id), us.roadId)
  await theme('day')
  await p.waitForTimeout(1500)
  await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = false)))
  const got = []
  for (const k of ['car', 'walker', 'walker', 'dog', 'kids']) got.push(await force(k))
  const runs = await sample(10000, 200)
  const cs = runs.flatMap((s) => s.cars)
  const ws = runs.flatMap((s) => s.walkers)
  const ks = runs.flatMap((s) => s.kids)
  const offR = cs.filter((c) => !us.road.some((r) => inside(r, c.x, c.z, 0.3))).length
  const offW = ws.filter((w) => !us.walk.some((r) => inside(r, w.x, w.z, 0.05))).length
  ok(got.every(Boolean) && cs.length > 10 && offR === 0, `On the American house's street the car stays on the road (${cs.length} samples, outside ${offR}; appeared ${got.join(', ')})`)
  ok(ws.length > 20 && offW === 0 && runs.some((s) => s.dogs.length), `Pedestrians and a dog walker on the American house's sidewalks (${ws.length} samples, outside ${offW})`)
  ok(ks.some((k) => k.act === 'bounce' || k.act === 'sit' || k.y > 1), `Children play in the backyard playground (${[...new Set(ks.map((k) => k.play))].join(', ')})`)
  await shot('us')
  await p.evaluate(() => window.__homescape.street().then((s) => (s.auto = true)))
  await p.evaluate(
    ([prev, id]) => {
      const s = window.__homescape.getState().layout
      s.switchHome(prev)
      s.deleteHome(id)
    },
    [prev, usId],
  )
  await theme('auto')
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
