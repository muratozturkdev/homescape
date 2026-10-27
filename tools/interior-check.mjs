// Regression test for cabinet interiors, opening doors and drawers, video playing on screens, people wandering a room and walking to
// press a newly switched-on device, and the built-in sink of the kitchen counter (user request, 9 Oct 2026). `npm run dev` must be
// running first. Run: npm run check:interior
// Intermediate screenshots: shots/interior-*.png
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto('http://localhost:5190/')
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1500)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const level = () =>
  p.evaluate(() => {
    const s = window.__homescape.getState().layout
    return s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  })
const it = async (id) => (await level()).items.find((i) => i.id === id)
// Live state comes from the app's own module (a direct import could load a second copy of a hot-updated module)
const opened = () => p.evaluate(() => window.__homescape.bins())
const inside = (id) =>
  p.evaluate(async (id) => {
    const m = await import('/src/model/containers.ts')
    const s = window.__homescape.getState().layout
    const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
    const item = lv.items.find((i) => i.id === id)
    const c = item && m.containerOf(lv.items, item)
    return c ? { box: c.box.id, index: c.index, label: c.comp.label } : null
  }, id)
const pick = async (id, compartment) => {
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), id)
  await p.waitForTimeout(350)
  await p.click(`#item-placement [data-compartment="${compartment}"]`)
  await p.waitForTimeout(250)
}

// --- Cabinet interiors: a console in the TV unit, a boiler in the single-door wardrobe, a router in the nightstand drawer, a bookshelf shelf ---
const r = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  const room = s.addRoom({ name: 'Cabinet room', floor: 'wood', x: 200, z: 0, w: 5, d: 4 })
  // Against the wall: inward from the wall, half a wall 5 cm + half the depth + 1 cm
  return {
    room,
    unit: s.addItem('tvUnit', 201.5, 0.27, 0),
    cons: s.addItem('console', 201.9, 0.27, 0, null, 0.5),
    ward: s.addItem('wardrobeSingle', 204, 0.36, 0),
    kombi: s.addItem('boiler', 204, 0.23, 0),
    night: s.addItem('nightstand', 202.5, 3.74, Math.PI),
    router: s.addItem('router', 202.5, 3.74, Math.PI, null, 0.48),
    shelf: s.addItem('bookshelf', 200.235, 2, Math.PI / 2),
  }
})
await p.evaluate((id) => window.__homescape.focusRoom(id), r.room)
await p.waitForTimeout(1500)
await pick(r.cons, 0)
const c1 = await inside(r.cons)
const cons = await it(r.cons)
ok(c1?.box === r.unit && c1.index === 0 && Math.abs(cons.y - 0.05) < 0.01, `Picking "Inside the unit" on the card lowers the console into the TV unit (y ${cons.y}, ${c1?.label})`)
ok((await inside(r.kombi))?.box === r.ward, 'The boiler on the wall inside the single-door wardrobe counts as inside the wardrobe')
await pick(r.router, 1)
const c2 = await inside(r.router)
ok(c2?.box === r.night && c2.label === 'Drawer' && Math.abs((await it(r.router)).y - 0.29) < 0.01, `The router is placed in the nightstand drawer (${c2?.label})`)
const shelfY = await p.evaluate(async () => {
  const m = await import('/src/model/containers.ts')
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  return m.shelfAt(lv.items, 200.25, 2, 'deskPlant')
})
ok(Math.abs(shelfY - 0.05) < 0.01, `A pot dropped on a bookshelf with no top sits on the first shelf (${shelfY})`)
await p.waitForTimeout(400)
let o = await opened()
ok(o[r.unit] && o[r.ward] && o[r.night], 'In edit mode, the doors and drawers of cabinets with items inside are open (TV unit, wardrobe, nightstand)')
await p.screenshot({ path: 'shots/interior-cabinets.png' })

// When a cabinet rotates, what is inside rotates with it (R key)
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), r.unit)
await p.waitForTimeout(200)
await p.keyboard.press('r')
await p.waitForTimeout(300)
const [u2, k2] = [await it(r.unit), await it(r.cons)]
ok(Math.abs(u2.rot - Math.PI / 2) < 1e-6 && Math.abs(k2.rot - u2.rot) < 1e-6 && (await inside(r.cons))?.box === r.unit, `When the TV unit rotates, the console inside rotates with it and stays inside (${k2.x.toFixed(2)}, ${k2.z.toFixed(2)})`)
await p.keyboard.press('Shift+R')
await p.waitForTimeout(200)

// In view mode it is closed; hovering does not open it, clicking the door opens it, clicking again closes it
// (user request, 9 Oct 2026: "it should open when I click the door, not when I hover")
await p.evaluate(() => {
  window.__homescape.select(null)
  window.__homescape.setMode('view')
})
await p.waitForTimeout(500)
o = await opened()
const closed = !o[r.unit]
const u = await it(r.unit)
const pt = await p.evaluate(([x, z]) => window.__homescape.project(x, 0.3, z + 0.2), [u.x, u.z])
await p.mouse.move(pt.x, pt.y, { steps: 3 })
await p.waitForTimeout(600)
const hoverShut = !(await opened())[r.unit]
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(500)
const clickedOpen = (await opened())[r.unit]
const noCard = !(await p.evaluate(() => window.__homescape.getState().layout.selection))
await p.screenshot({ path: 'shots/interior-click.png' })
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(500)
const clickedShut = !(await opened())[r.unit]
await p.mouse.move(40, 450, { steps: 3 })
ok(closed && hoverShut && clickedOpen && clickedShut && noCard, `In view mode the cabinet is closed, hovering does not open it, clicking opens it, clicking again closes it, no card opens (closed ${closed}, closed on hover ${hoverShut}, click ${clickedOpen}, second click ${clickedShut}, no card ${noCard})`)

// --- Screens: while the TV plays, the picture plays (asks for ambient frames), when off it stops ---
const L = await level()
const tv = L.items.find((i) => i.kind === 'tv' && i.entityId?.startsWith('media_player.'))
const ambient = async () => (await p.evaluate(() => window.__homescape.perf())).ambient
const e0 = await p.evaluate((id) => window.__homescape.entity(id), tv.entityId)
await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: 'off' }), e0)
await p.waitForTimeout(400)
const a0 = await ambient()
await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: 'playing' }), e0)
await p.waitForTimeout(400)
const a1 = await ambient()
ok(a1 > a0, `A moving picture on the screen while the TV plays (ambient animation ${a0} -> ${a1})`)
// A movie on the screen (user feedback, 9 Oct 2026: "show a picture as if a movie is playing on the TV,
// only boxes are visible"): the screen texture is a movie drawn on a canvas; the letterbox bars are black, the picture changes from frame
// to frame, and it freezes when paused
const frame = () =>
  p.evaluate(async () => {
    const m = await import('/src/scene/frame.ts')
    let out = null
    m.sceneRef.scene.traverse((o) => {
      const img = o.material?.map?.image
      if (out || !img || img.width !== 384 || img.height !== 216 || !img.getContext) return
      const c = img.getContext('2d')
      const px = (x, y) => [...c.getImageData(x, y, 1, 1).data].slice(0, 3)
      const mid = c.getImageData(0, 60, 384, 96).data
      let sum = 0
      let lit = 0
      for (let i = 0; i < mid.length; i += 16) {
        sum += mid[i] * 7 + mid[i + 1] * 13 + mid[i + 2] * 3
        if (mid[i] + mid[i + 1] + mid[i + 2] > 60) lit++
      }
      out = { bar: px(190, 4).concat(px(190, 212)), sum, lit }
    })
    return out
  })
// The movie draws a frame every 24 frames: wait so the same frame is not read twice
const f1 = await frame()
await p.waitForTimeout(700)
const f2 = await frame()
ok(f1 && f2 && f1.bar.every((v) => v < 8) && f1.lit > 50 && f1.sum !== f2.sum, `A movie plays on the TV: letterbox bars are black, the picture is bright (${f1?.lit} points) and changing`)
await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: 'paused' }), e0)
await p.waitForTimeout(500)
const g1 = await frame()
await p.waitForTimeout(700)
const g2 = await frame()
ok(g1 && g2 && g1.sum === g2.sum, 'The movie freezes when the TV is paused (the frame does not change)')
await p.evaluate((e) => window.__homescape.setEntity(e), e0)

// --- People: wander around the room; someone walks over and presses a newly switched-on TV ---
const people = await p.evaluate(async (tvId) => {
  const m = await import('/src/model/people.ts')
  const s = window.__homescape.getState().layout
  const lv0 = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  const living = lv0.rooms.find((r) => /living/i.test(r.name)) ?? lv0.rooms[0]
  const sensor = s.addItem('motionSensor', living.x + living.w / 2, living.z + living.d / 2, 0, 'binary_sensor.t_wander')
  const lv = (window.__homescape.getState().layout.layout.levels.find((l) => l.id === s.levelId) ?? window.__homescape.getState().layout.layout.levels[0])
  const now = Date.now()
  const since = now - 60 * 60_000
  const ents = Object.fromEntries(
    window.__homescape.entityIds().map((id) => {
      const e = window.__homescape.entity(id)
      // No other room should be active: lights, motion and TVs are old / off (people watch a TV that is on instead of moving)
      const quiet = /^(binary_sensor|light|media_player)\./.test(id) ? { ...e, state: 'off', last_changed: '2020-01-01T00:00:00Z' } : { ...e, last_changed: '2020-01-01T00:00:00Z' }
      return [id, quiet]
    }),
  )
  ents['binary_sensor.t_wander'] = { entity_id: 'binary_sensor.t_wander', state: 'on', attributes: { device_class: 'motion' }, last_changed: new Date(since).toISOString() }
  const at = (t) => m.planPeople({ level: lv, entities: ents, registry: null, alarm: 'disarmed', now: t, residents: 1 }).spots.filter((x) => x.roomId === living.id)
  const turns = [0, 1, 2, 3, 4].map((k) => at(since + k * m.WANDER_MS + 1000)[0]).map((x) => (x ? `${x.use ?? 'middle'}@${x.x.toFixed(2)},${x.z.toFixed(2)}` : 'none'))
  // The newly switched-on TV
  const e = ents[tvId]
  ents[tvId] = { ...e, state: 'playing', last_changed: new Date(now - 2000).toISOString() }
  const press = m.planPeople({ level: lv, entities: ents, registry: null, alarm: 'disarmed', now, residents: 2 }).spots.find((x) => x.activity === 'press')
  const later = m.planPeople({ level: lv, entities: ents, registry: null, alarm: 'disarmed', now: now + m.TOUCH_MS + 5000, residents: 2 }).spots.find((x) => x.activity === 'press')
  s.deleteItem(sensor)
  return { turns, press: press ? { use: press.use, reach: press.reach } : null, later: Boolean(later) }
}, tv.entityId)
ok(new Set(people.turns).size >= 3, `A person wanders the room: moves to other spots as activity continues (${people.turns.join(' | ')})`)
ok(people.press?.use === 'tv' && people.press.reach > 0.4 && !people.later, `Someone walks to the newly switched-on TV and presses it by hand, then goes back to what they were doing (${JSON.stringify(people.press)})`)

// --- While the TV is on, people at home sit facing it and watch, snack now and then, and sip from a mug (user request, 9 Oct 2026:
// "while the TV is on, the people in the house should sit and watch it, and eat and drink something") ---
const watch = await p.evaluate(async (tvId) => {
  const m = await import('/src/model/people.ts')
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  const ents = Object.fromEntries(
    window.__homescape.entityIds().map((id) => {
      const e = window.__homescape.entity(id)
      return [id, id.startsWith('binary_sensor.') || id.startsWith('light.') ? { ...e, state: 'off', last_changed: '2020-01-01T00:00:00Z' } : { ...e, last_changed: '2020-01-01T00:00:00Z' }]
    }),
  )
  const tv = lv.items.find((i) => i.entityId === tvId)
  const facing = (x) => {
    const dx = tv.x - x.x
    const dz = tv.z - x.z
    return (Math.sin(x.rot) * dx + Math.cos(x.rot) * dz) / (Math.hypot(dx, dz) || 1) > 0.5
  }
  const base = new Date(2026, 9, 9, 15, 0, 0).getTime()
  const plan = (now) => m.planPeople({ level: lv, entities: ents, registry: null, alarm: 'disarmed', now, residents: 2 })
  ents[tvId] = { ...ents[tvId], state: 'playing', last_changed: '2020-01-01T00:00:00Z' }
  const on = [0, 1, 2, 3].map((k) => plan(base + k * 75_000).spots)
  const watchers = on[0].filter((x) => x.pose === 'sit' && facing(x) && ['tv', 'snack'].includes(x.activity)).length
  const acts = [...new Set(on.flat().map((x) => x.activity))]
  ents[tvId] = { ...ents[tvId], state: 'off' }
  const off = plan(base).spots.filter((x) => x.activity === 'tv' || x.activity === 'snack').length
  return { watchers, acts, off }
}, tv.entityId)
ok(watch.watchers === 2 && watch.acts.includes('tv') && watch.acts.includes('snack') && watch.off === 0, `While the TV is on, the two people at home sit facing it and watch, snack and sip now and then (${watch.acts.join(', ')}); when the TV turns off nobody watches`)

// --- Idle people roam the house; walking does not pass through items or walls (user feedback, 9 Oct 2026) ---
const life = await p.evaluate(async () => {
  const m = await import('/src/model/people.ts')
  const pets = await import('/src/model/pets.ts')
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  const ents = Object.fromEntries(
    window.__homescape.entityIds().map((id) => {
      const e = window.__homescape.entity(id)
      // TVs off too: with a TV on, idle people sit and watch it instead of moving around
      return [id, /^(binary_sensor|light|media_player)\./.test(id) ? { ...e, state: 'off', last_changed: '2020-01-01T00:00:00Z' } : { ...e, last_changed: '2020-01-01T00:00:00Z' }]
    }),
  )
  // Daytime, no activity in any room: where do two people go over 10 turns (~33 min)
  const t0 = new Date(2026, 9, 9, 10, 0).getTime()
  const rooms = new Set()
  const uses = new Set()
  for (let k = 0; k < 10; k++) {
    const plan = m.planPeople({ level: lv, entities: ents, registry: null, alarm: 'disarmed', now: t0 + k * m.ROAM_MS, residents: 2 })
    for (const sp of plan.spots) {
      rooms.add(sp.roomId)
      uses.add(sp.use ?? 'middle')
    }
  }
  // A route from the middle of every indoor room to the middle of the others: the segments are open on the person's grid (through
  // walls only at doors, around items), and a route that changes rooms has several waypoints
  const g = pets.buildPetGrid(lv, 'person')
  // The rooms of the house (except the doorless cabinet room the test built far away)
  const inside = lv.rooms.filter((r) => !['garden', 'balcony', 'terrace'].includes(r.type ?? 'room') && r.x < 100)
  let total = 0
  let blocked = 0
  let straight = 0
  for (const a of inside)
    for (const b of inside) {
      if (a === b) continue
      const from = pets.nearestFree(g, a.x + a.w / 2, a.z + a.d / 2) ?? { x: a.x + a.w / 2, z: a.z + a.d / 2 }
      const to = pets.nearestFree(g, b.x + b.w / 2, b.z + b.d / 2) ?? { x: b.x + b.w / 2, z: b.z + b.d / 2 }
      const path = m.route(lv, from, { ...to, y: 0, rot: 0, pose: 'stand', roomId: b.id })
      total++
      if (path.length < 2) straight++
      let prev = from
      for (const q of path) {
        if (!pets.lineFree(g, prev, q, true)) {
          blocked++
          break
        }
        prev = q
      }
    }
  // The route to press each device (user feedback: "when it goes to switch on the diffuser it passes through the TV unit"):
  // as if the device had just been switched on, from the middle of the living room; no segment passes through an item or a wall
  const living = inside.find((r) => /living/i.test(r.name)) ?? inside[0]
  const start = pets.nearestFree(g, living.x + living.w / 2, living.z + living.d / 2)
  const presses = []
  let pressBlocked = 0
  for (const it of lv.items) {
    if (!it.entityId || !ents[it.entityId]) continue
    const e2 = { ...ents, [it.entityId]: { ...ents[it.entityId], state: 'on', last_changed: new Date().toISOString() } }
    const sp = m.touchSpots(lv, e2, Date.now()).find((x) => Math.hypot(x.x - it.x, x.z - it.z) < 2.5)
    if (!sp) continue
    const path = m.route(lv, start, sp)
    let prev = start
    let bad = false
    for (const q of path) {
      if (!pets.lineFree(g, prev, q, true)) bad = true
      prev = q
    }
    if (bad) pressBlocked++
    presses.push(`${it.kind}${bad ? '!' : ''}`)
  }
  return { rooms: rooms.size, uses: [...uses], total, blocked, straight, presses, pressBlocked }
})
ok(life.rooms >= 3 && life.uses.length >= 4, `Idle people roam the house in the daytime: ${life.rooms} rooms, ${life.uses.join(', ')}`)
ok(life.presses.length >= 3 && life.pressBlocked === 0, `None of the ${life.presses.length} routes to press a device passes through an item (${life.presses.join(', ')})`)
ok(life.total > 0 && life.blocked === 0 && life.straight === 0, `None of the ${life.total} routes between rooms passes through a wall or an item (through doors, around items; blocked ${life.blocked}, straight ${life.straight})`)

// A pet does not stay in one room: the dog goes to at least two rooms in a minute. The clock is fixed to daytime: at night pets and
// people sleep (when the test ran at night the dog never got up)
await p.clock.setFixedTime(new Date(2026, 9, 9, 15, 0, 0))
await p.waitForTimeout(500)
const dogId = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  const living = lv.rooms.find((r) => /living/i.test(r.name)) ?? lv.rooms[0]
  s.setMode('edit')
  const id = s.addItem('dog', living.x + 0.8, living.z + living.d - 0.8, 0)
  s.setMode('view')
  return id
})
const seenRooms = new Set()
for (let i = 0; i < 30; i++) {
  await p.waitForTimeout(2000)
  const d = await p.evaluate(async (id) => (await window.__homescape.pets()).pets.find((x) => x.id === id), dogId)
  if (d?.roomId) seenRooms.add(d.roomId)
  if (seenRooms.size >= 2) break
}
ok(seenRooms.size >= 2, `The dog roams from room to room (${seenRooms.size} rooms)`)
await p.evaluate((id) => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  s.deleteItem(id)
  s.setMode('view')
}, dogId)

// --- The built-in sink and tap of the kitchen counter (user request, 9 Oct 2026) ---
const k = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  s.setMode('edit')
  const room = s.addRoom({ name: 'Sink room', floor: 'tile', x: 210, z: 0, w: 4, d: 3 })
  return { room, counter: s.addItem('kitchenCounter', 211.6, 0.36, 0), sink: s.addItem('sink', 213.2, 0.36, 0) }
})
const sinkAt = (id) =>
  p.evaluate(async (id) => {
    const m = await import('/src/model/counter.ts')
    const s = window.__homescape.getState().layout
    const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
    return m.counterSink(lv.items, lv.items.find((i) => i.id === id))
  }, id)
ok(k.counter && k.sink && (await sinkAt(k.counter)) === null, 'A counter with a separate sink next to it does not get a second sink on its own')
await p.evaluate((id) => window.__homescape.getState().layout.deleteItem(id), k.sink)
ok((await sinkAt(k.counter)) === 0, 'A counter with no sink next to it has a built-in sink in the middle')
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), k.counter)
await p.waitForTimeout(350)
await p.click('#counter-sink [data-sink="left"]')
await p.waitForTimeout(200)
const left = await sinkAt(k.counter)
ok((await it(k.counter)).sink === 'left' && Math.abs(left + 0.55) < 0.01, `Picking "Sink: On the left" on the card moves the sink to the left of the counter (${left})`)
await p.click('#counter-sink [data-sink="center"]')
await p.waitForTimeout(200)
const wash = await p.evaluate(async (roomId) => {
  const m = await import('/src/model/people.ts')
  const s = window.__homescape.getState().layout
  const sensor = s.addItem('motionSensor', 212, 2.6, 0, 'binary_sensor.t_sink')
  const lv = window.__homescape.getState().layout.layout.levels.find((l) => l.id === s.levelId) ?? window.__homescape.getState().layout.layout.levels[0]
  const since = Date.now() - 60 * 60_000
  const ents = Object.fromEntries(
    window.__homescape.entityIds().map((id) => {
      const e = window.__homescape.entity(id)
      return [id, id.startsWith('binary_sensor.') || id.startsWith('light.') ? { ...e, state: 'off', last_changed: '2020-01-01T00:00:00Z' } : { ...e, last_changed: '2020-01-01T00:00:00Z' }]
    }),
  )
  ents['binary_sensor.t_sink'] = { entity_id: 'binary_sensor.t_sink', state: 'on', attributes: { device_class: 'motion' }, last_changed: new Date(since).toISOString() }
  const at = (k) => m.planPeople({ level: lv, entities: ents, registry: null, alarm: 'disarmed', now: since + k * m.WANDER_MS + 1000, residents: 1 }).spots.find((x) => x.roomId === roomId)
  const [a, b] = [at(0), at(1)]
  s.deleteItem(sensor)
  return { a: a && { use: a.use, activity: a.activity, x: a.x }, b: b && { use: b.use, activity: b.activity, x: b.x } }
}, k.room)
ok(wash.a?.use === 'sink' && wash.a.activity === 'wash' && Math.abs(wash.a.x - 211.6) < 0.05 && wash.b?.use === 'kitchenCounter' && Math.abs(wash.b.x - 211.6) > 0.5, `A person washes dishes at the counter's sink, then chops next to it (${JSON.stringify(wash)})`)
await p.evaluate(() => window.__homescape.setMode('view'))
await p.click('#fps-toggle')
await p.waitForSelector('#fps-hud')
await p.evaluate(() => window.__homescape.fpsTeleport(211.9, 1.55, 0.25, -0.55))
await p.waitForTimeout(1200)
await p.screenshot({ path: 'shots/interior-sink.png' })
await p.click('#fps-toggle')
await p.waitForTimeout(300)
await p.evaluate((room) => window.__homescape.getState().layout.deleteRoom(room), k.room)

await p.evaluate((room) => {
  window.__homescape.getState().layout.deleteRoom(room)
  window.__homescape.select(null)
}, r.room)
ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
