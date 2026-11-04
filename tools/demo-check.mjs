// American sample home regression test (user request, 9 Oct 2026: "design a demo home from scratch, with everything added
// in it, let's do our tests there. An American house and its street"): opens the sample home through the hook
// (window.__homescape.loadDemo) and checks that every item type is present, every item obeys the placement rules, rooms
// do not overlap, a person and a dog can walk to every indoor room, every bound entity exists in the demo source, the stairs
// connect the two floors, the center lines of the road network, that the lights change when devices are switched on and
// off, that people and pets use the home, that unbound street lamps light up at night, that entities do not leak into
// other homes and that they come back after a page reload. At the end it returns to the previous home and deletes the
// sample home.
// `npm run dev` must be running first. Run: node tools/demo-check.mjs
// Screenshots: shots/us-*.png
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(`${e.message} ${(e.stack ?? '').split('\n').slice(1, 3).join(' ')}`))
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1500)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const shot = (name) => p.screenshot({ path: `shots/us-${name}.png` })
const NAME = 'Sample home: American house'
/**
 * Active home, homes, floors, entity ids. The stores (layoutStore, ha/store) are not imported in the test: after Vite HMR the
 * import address of the app gets ?t=, a separate import creates a second store. Always use window.__homescape.
 */
const store = () =>
  p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const list = s.homes?.length ? s.homes : [{ id: s.homeId ?? 'home-main', name: 'My home' }]
    const home = s.homeId ?? list[0].id
    return {
      home,
      name: list.find((h) => h.id === home)?.name,
      homes: list.length,
      mode: s.mode,
      levelId: s.levelId,
      levels: s.layout?.levels.map((l) => ({ id: l.id, elevation: l.elevation ?? 0, rooms: l.rooms.length, items: l.items.length })) ?? [],
      us: window.__homescape.entityIds().filter((id) => id.includes('.us_')),
    }
  })
const focus = async (roomName, wait = 2200) => {
  await p.evaluate((name) => {
    const h = window.__homescape
    const s = h.getState().layout
    for (const lv of s.layout.levels) {
      const r = lv.rooms.find((q) => q.name === name)
      if (!r) continue
      s.setLevel(lv.id)
      h.select(null)
      h.focusRoom(r.id)
      return
    }
  }, roomName)
  await p.waitForTimeout(wait)
}
const setLevel = (elevation) =>
  p.evaluate((e) => {
    const s = window.__homescape.getState().layout
    const lv = s.layout.levels.find((l) => (l.elevation ?? 0) === e)
    if (lv) s.setLevel(lv.id)
  }, elevation)

// --- Opening: set up through the hook, the previous home stays in place ---
const before = await store()
const usCount = await p.evaluate(async () => (await import('/src/demo/american.ts')).americanEntities().length)
const homeId = await p.evaluate(() => window.__homescape.loadDemo('american'))
await p.evaluate(() => window.__homescape.setTheme('day'))
await p.waitForTimeout(2500)
let st = await store()
ok(
  Boolean(homeId) && st.home === homeId && st.name === NAME && st.homes === before.homes + 1 && st.mode === 'view' && st.levels.length === 2 && st.levelId === st.levels.find((l) => l.elevation === 0)?.id,
  `Sample home opened through the hook: "${st.name}", ${st.levels.map((l) => `floor ${l.elevation}: ${l.rooms} rooms, ${l.items} items`).join(' · ')} (homes ${before.homes} -> ${st.homes})`,
)
ok(before.us.length === 0 && st.us.length === usCount, `The entities of the sample home are in the demo source only while that home is open (before ${before.us.length}, now ${st.us.length}/${usCount})`)
await shot('overview')

// --- Fog: scales with the distance of the camera to the target (the overview is from ~87 m), absent in plan view (Scene > FogRange) ---
const fogNow = () => p.evaluate(async () => ({ d: window.__homescape.camera().distance, fog: (await window.__homescape.lighting()).fog }))
const fogView = await fogNow()
await p.evaluate(() => window.__homescape.planView(true))
await p.waitForTimeout(2000)
const fogPlan = await fogNow()
await shot('plan')
await p.evaluate(() => window.__homescape.planView(false))
await p.waitForTimeout(2000)
ok(
  fogView.fog[0] > fogView.d * 1.3 && fogPlan.fog[0] > fogPlan.d * 2,
  `Fog scales with the camera distance: from ${fogView.d.toFixed(0)} m in the overview the home has no fog (fog ${fogView.fog.map(Math.round).join('-')} m), in plan view (${fogPlan.d.toFixed(0)} m) there is no fog (${fogPlan.fog.map(Math.round).join('-')} m)`,
)

// --- Plan: every kind, rules, rooms, windows, access, bindings, stairs, road network ---
const plan = await p.evaluate(async () => {
  const rules = await import('/src/model/rules.ts')
  const geo = await import('/src/model/geometry.ts')
  const cat = await import('/src/model/catalog.ts')
  const pets = await import('/src/model/pets.ts')
  const roads = await import('/src/scene/kit/roads.ts')
  const s = window.__homescape.getState().layout
  const layout = s.layout
  const ents = new Set(window.__homescape.entityIds())
  const out = { missing: [], bad: [], overlaps: [], windows: [], dark: [], unreachable: [], unbound: [], kinds: 0, items: 0, stairs: null, road: null }
  const kinds = new Set(layout.levels.flatMap((l) => l.items.map((i) => i.kind)))
  out.missing = Object.keys(cat.CATALOG).filter((k) => !kinds.has(k))
  out.kinds = kinds.size
  for (const lv of layout.levels) {
    out.items += lv.items.length
    // Rooms do not overlap
    for (let i = 0; i < lv.rooms.length; i++)
      for (let j = i + 1; j < lv.rooms.length; j++) if (rules.overlapsRoom(geo.rectsOf(lv.rooms[i]), [lv.rooms[j]])) out.overlaps.push(`${lv.rooms[i].name} / ${lv.rooms[j].name}`)
    for (const it of lv.items) {
      const meta = cat.CATALOG[it.kind]
      // Does a wall item really sit on a wall (as it would when dragged: geometry.ts > wallSnap)
      let onWall = true
      if (rules.snapsToWall(it.kind, it.mount) && (it.y == null || rules.isWallMounted(it.kind, it.variant, it.mount))) {
        const w = geo.wallSnap(lv.rooms, it.x, it.z, meta.size[1], 0.6, cat.sizeOf(it.kind, it.len)[0], geo.isAperture(it.kind), it.mount === 'wall')
        const da = w ? Math.atan2(Math.sin(w.rot - it.rot), Math.cos(w.rot - it.rot)) : 9
        onWall = Boolean(w) && Math.hypot(w.x - it.x, w.z - it.z) < 0.02 && Math.abs(da) < 0.01
        if (!onWall) out.bad.push(`${it.id}: not on a wall`)
      }
      const c = rules.checkItem(lv, it, it.id, onWall)
      if (!c.ok) out.bad.push(`${it.id}: ${c.reason}`)
      // Items on a surface are at the height of the surface (table, counter, unit; the dryer on top of the washer)
      if (it.y != null && it.y > 0.05 && !rules.isWallMounted(it.kind, it.variant, it.mount)) {
        const only = rules.APPLIANCE_STACK.includes(it.kind) ? rules.APPLIANCE_STACK : undefined
        const sf = rules.surfaceAt(lv.items, it.x, it.z, it.id, only)
        if (!sf || Math.abs(sf.y - it.y) > 0.011) out.bad.push(`${it.id}: not on the surface (${sf ? `${sf.item.kind} ${sf.y}` : 'no surface'}, y ${it.y})`)
      }
      // Every bound entity exists in the demo source
      for (const id of [it.entityId, ...(it.extras ?? [])]) if (id && !ents.has(id)) out.unbound.push(`${it.id} -> ${id}`)
      // Window on an exterior wall
      if (it.kind === 'window') {
        const back = geo.doorSides(it, lv.rooms).back
        if (back && !geo.isOutdoor(back)) out.windows.push(`${it.id} (on the ${back.name} side)`)
      }
    }
    // Every indoor room with an exterior wall has a window or an exterior door
    for (const r of lv.rooms.filter((q) => !geo.isOutdoor(q))) {
      const outer = geo.wallRuns(r, lv.rooms).some((run) => !run.interior)
      if (!outer) continue
      const lit = lv.items.some((i) => (i.kind === 'window' || i.kind === 'door' || i.kind === 'garageDoor') && geo.roomAt(lv.rooms, i.x, i.z)?.id === r.id && (() => {
        const back = geo.doorSides(i, lv.rooms).back
        return !back || geo.isOutdoor(back)
      })())
      if (!lit) out.dark.push(r.name)
    }
  }
  // Access: on the ground floor from inside the front door, on the upper floor from the top end of the stairs; A* on the person and dog grid
  const ground = layout.levels.find((l) => (l.elevation ?? 0) === 0)
  const upper = layout.levels.find((l) => (l.elevation ?? 0) === 1)
  const front = ground.items.find((i) => i.entityId === 'lock.us_front_door')
  const stair = ground.items.find((i) => i.kind === 'stairs')
  const top = { x: stair.x + Math.sin(stair.rot) * -1.95, z: stair.z + Math.cos(stair.rot) * -1.95 }
  for (const [lv, start] of [
    [ground, { x: front.x + Math.sin(front.rot) * 0.7, z: front.z + Math.cos(front.rot) * 0.7 }],
    [upper, top],
  ])
    for (const mover of ['person', 'dog']) {
      const g = pets.buildPetGrid(lv, mover)
      for (const r of lv.rooms.filter((q) => !geo.isOutdoor(q))) {
        let reached = false
        for (const q of geo.rectsOf(r))
          for (let k = 0; k < 60 && !reached; k++) {
            const x = q.x + 0.25 + ((k * 0.381) % 1) * (q.w - 0.5)
            const z = q.z + 0.25 + ((k * 0.613) % 1) * (q.d - 0.5)
            if (!pets.isFree(g, x, z)) continue
            const path = pets.findPath(g, start, { x, z })
            const end = path?.[path.length - 1]
            if (end && Math.hypot(end.x - x, end.z - z) < 0.3 && pets.gridRoom(g, end.x, end.z) === lv.rooms.indexOf(r)) reached = true
          }
        if (!reached) out.unreachable.push(`${mover}: ${r.name}`)
      }
    }
  // Stairs: in an indoor room on the lower floor; on the upper floor the same indoor room covers the top of the stairs and the area beyond its upper end
  const below = geo.roomAt(ground.rooms, stair.x, stair.z)
  const corners = [-1, 1].flatMap((sx) => [-1.6, 1.6].map((lz) => ({ x: stair.x + sx * 0.5 * Math.cos(stair.rot) + lz * Math.sin(stair.rot), z: stair.z - sx * 0.5 * Math.sin(stair.rot) + lz * Math.cos(stair.rot) })))
  const aboveRooms = new Set([...corners, top].map((c) => geo.roomAt(upper.rooms, c.x, c.z)?.id ?? null))
  const above = upper.rooms.find((r) => aboveRooms.has(r.id))
  out.stairs = { below: below?.name ?? null, belowIndoor: Boolean(below && !geo.isOutdoor(below)), above: above?.name ?? null, single: aboveRooms.size === 1 && !aboveRooms.has(null), stairs: ground.items.filter((i) => i.kind === 'stairs').length }
  // Road network: the dashed center line of the street (z = middle of the road), the center line of the side street, the edge lines
  const pieces = ground.rooms.filter((r) => r.floor === 'road' || r.floor === 'crosswalk').flatMap((r) => geo.rectsOf(r).map((q) => ({ r: q, kind: r.floor })))
  const marks = roads.roadMarks(pieces)
  const road = ground.rooms.find((r) => r.name === 'Street')
  const mid = road.z + road.d / 2
  const main = marks.centers.find((c) => c.pts.length >= 2 && c.pts.every((q) => Math.abs(q.z - mid) < 0.05) && Math.abs(c.pts[c.pts.length - 1].x - c.pts[0].x) > 20)
  const sideRoad = ground.rooms.find((r) => r.name === 'Side street')
  const sideMid = sideRoad.x + sideRoad.w / 2
  const side = marks.centers.find((c) => c.pts.some((q) => Math.abs(q.x - sideMid) < 0.05 && q.z > sideRoad.z))
  out.road = { centers: marks.centers.length, edges: marks.edges.length, main: Boolean(main && !main.double), side: Boolean(side), pieces: pieces.length }
  return out
})
ok(plan.missing.length === 0, `Every item type of the app is in the home (${plan.kinds} types, ${plan.items} items)${plan.missing.length ? `: missing ${plan.missing.join(', ')}` : ''}`)
ok(plan.bad.length === 0, `Every item obeys the placement rules (inside a room, wall and height, layer, overlap, doorway, surface and stacking)${plan.bad.length ? `: ${plan.bad.slice(0, 8).join(' | ')}` : ''}`)
ok(plan.overlaps.length === 0, `Rooms do not overlap${plan.overlaps.length ? `: ${plan.overlaps.join(', ')}` : ''}`)
ok(plan.windows.length === 0 && plan.dark.length === 0, `Windows are on exterior walls, every room with an exterior wall has a window or an exterior door${plan.windows.length || plan.dark.length ? `: ${[...plan.windows, ...plan.dark].join(', ')}` : ''}`)
ok(plan.unreachable.length === 0, `A person and a dog can walk to every indoor room from the front door (from the stairs on the upper floor)${plan.unreachable.length ? `: ${plan.unreachable.join(', ')}` : ''}`)
ok(plan.unbound.length === 0, `Every entity bound to an item exists in the demo source${plan.unbound.length ? `: ${plan.unbound.slice(0, 6).join(', ')}` : ''}`)
ok(plan.stairs.stairs === 1 && plan.stairs.belowIndoor && plan.stairs.single, `The stairs connect the two floors: ${plan.stairs.below} below, ${plan.stairs.above} above covers the opening and the exit`)
ok(plan.road.main && plan.road.side && plan.road.edges >= 4, `Road network: dashed center line on the street, center line on the side street, ${plan.road.edges} edge lines (${plan.road.pieces} pieces, ${plan.road.centers} center lines)`)

// --- Views: street, front yard, back yard, ground floor, upper floor ---
await focus('Sidewalk')
await shot('street')
await focus('Front yard (right)')
await shot('front-yard')
await focus('Pool area')
await shot('backyard')
await focus('Kitchen and dining')
await shot('ground-floor')
await focus('Upstairs hall')
await shot('upper-floor')
await focus("Ethan's room")
await shot('upper-floor-kid')
await setLevel(0)
await p.evaluate(() => window.__homescape.focusRoom(window.__homescape.getState().layout.layout.levels[0].rooms.find((r) => r.name === 'Family room').id))
await p.waitForTimeout(1500)

// --- Devices: switch on and off with a service call, the lights and the state change ---
const dev = await p.evaluate(async () => {
  const call = window.__homescape.call
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const near = async (x, z, r = 0.3) => (await window.__homescape.roomLights()).filter((l) => Math.hypot(l.pos[0] - x, l.pos[2] - z) < r).length
  const state = (id) => window.__homescape.entity(id)?.state
  const res = {}
  // Kitchen island pendants (two lamps in a group)
  res.islandOn = (await near(3.99, 1.25)) + (await near(3.99, 2.1))
  await call('light', 'turn_off', { entity_id: 'light.us_kitchen_island' })
  await wait(700)
  res.islandOff = (await near(3.99, 1.25)) + (await near(3.99, 2.1))
  await call('light', 'turn_on', { entity_id: 'light.us_kitchen_island' })
  await wait(700)
  res.islandBack = (await near(3.99, 1.25)) + (await near(3.99, 2.1))
  // The floor lamp of the family room is off: it lights up when turned on
  res.lampOff = await near(-6.7, 1.45, 0.5)
  await call('light', 'toggle', { entity_id: 'light.us_family_floor_lamp' })
  await wait(700)
  res.lampOn = await near(-6.7, 1.45, 0.5)
  await call('light', 'toggle', { entity_id: 'light.us_family_floor_lamp' })
  // TV, washer, garage door, lock, robot vacuum
  await call('media_player', 'toggle', { entity_id: 'media_player.us_family_tv' })
  await call('switch', 'turn_off', { entity_id: 'switch.us_washer' })
  await call('cover', 'close_cover', { entity_id: 'cover.us_garage_door_left' })
  await call('lock', 'unlock', { entity_id: 'lock.us_front_door' })
  await call('vacuum', 'return_to_base', { entity_id: 'vacuum.us_robot' })
  await wait(400)
  res.toggled = [state('media_player.us_family_tv'), state('switch.us_washer'), state('cover.us_garage_door_left'), state('lock.us_front_door'), state('vacuum.us_robot')]
  await call('media_player', 'toggle', { entity_id: 'media_player.us_family_tv' })
  await call('media_player', 'media_play_pause', { entity_id: 'media_player.us_family_tv' })
  await call('switch', 'turn_on', { entity_id: 'switch.us_washer' })
  await call('cover', 'open_cover', { entity_id: 'cover.us_garage_door_left' })
  await call('lock', 'lock', { entity_id: 'lock.us_front_door' })
  await call('vacuum', 'start', { entity_id: 'vacuum.us_robot' })
  await wait(400)
  res.back = [state('media_player.us_family_tv'), state('switch.us_washer'), state('cover.us_garage_door_left'), state('lock.us_front_door'), state('vacuum.us_robot')]
  res.washerPower = Number(window.__homescape.entity('sensor.us_washer_power')?.state)
  return res
})
ok(dev.islandOn === 2 && dev.islandOff === 0 && dev.islandBack === 2, `The two pendants of the kitchen island switch together with one light (on ${dev.islandOn}, off ${dev.islandOff}, on again ${dev.islandBack} lights)`)
ok(dev.lampOff === 0 && dev.lampOn >= 1, `The floor lamp that was off lights the room when turned on (${dev.lampOff} -> ${dev.lampOn} lights)`)
ok(
  dev.toggled.join() === 'off,off,closed,unlocked,docked' && dev.back.join() === 'playing,on,open,locked,cleaning' && dev.washerPower > 8,
  `The TV, washer (power ${dev.washerPower} W), garage door, lock and robot vacuum obey commands (${dev.toggled.join(', ')} / ${dev.back.join(', ')})`,
)

// --- People: rooms with motion and a computer that is on; the plan uses more than one room ---
await p.waitForTimeout(1500)
const ppl = await p.evaluate(async () => {
  const m = await import('/src/model/people.ts')
  const h = window.__homescape
  const entities = Object.fromEntries(h.entityIds().map((id) => [id, h.entity(id)]))
  const s = h.getState().layout
  const lv = s.layout.levels.find((l) => (l.elevation ?? 0) === 0)
  const alarm = Object.values(entities).find((e) => e.entity_id.startsWith('alarm_control_panel.'))
  const plan = m.planPeople({ level: lv, entities, registry: null, alarm: alarm?.state, now: Date.now(), residents: 3 })
  const name = (id) => lv.rooms.find((r) => r.id === id)?.name ?? '?'
  const live = await window.__homescape.people()
  return { mode: plan.mode, alarm: alarm?.entity_id, rooms: [...new Set(plan.spots.map((q) => name(q.roomId)))], acts: plan.spots.map((q) => q.activity), desk: plan.desk.map(name), shown: live?.persons?.length ?? 0 }
})
ok(ppl.alarm === 'alarm_control_panel.us_alarm' && ppl.mode === 'home' && ppl.rooms.length >= 2 && ppl.desk.includes('Office'), `People use the home (${ppl.mode}, alarm ${ppl.alarm}): ${ppl.rooms.join(', ')}; activities ${ppl.acts.join(', ')}; at the computer ${ppl.desk.join(', ')}`)
ok(ppl.shown >= 2, `People are in the scene in view mode (${ppl.shown})`)

// --- Exterior door (9 Oct 2026): a door with a porch or garden behind it is also an exterior door (geometry.ts > exteriorSide). It
// used to count only doors with empty space behind them: this home had no exterior door and the walk started in the middle of
// the hall. When nobody is home the people wait on the front porch facing the door, and one walks there from inside through
// the door; even when the door is placed from the outside (from the porch) the walk starts from the same place. ---
{
  const outer = await p.evaluate(async () => {
    const m = await import('/src/model/people.ts')
    const geo = await import('/src/model/geometry.ts')
    const fps = await import('/src/scene/fps.ts')
    const lv = window.__homescape.getState().layout.layout.levels.find((l) => (l.elevation ?? 0) === 0)
    const name = (q) => geo.roomAt(lv.rooms, q.x, q.z)?.name ?? 'outside'
    const doors = lv.items.filter((i) => i.kind === 'door' && geo.exteriorSide(i, lv.rooms) === 1).map((d) => geo.doorSides(d, lv.rooms).back?.name ?? 'void')
    const away = m.planPeople({ level: lv, entities: {}, registry: null, alarm: 'armed_away', now: Date.now(), residents: 3 })
    const spots = away.spots.map((s) => `${name(s)} -> ${name({ x: s.x + Math.sin(s.rot) * 2, z: s.z + Math.cos(s.rot) * 2 })}`)
    const k = lv.rooms.find((r) => r.name === 'Kitchen and dining')
    const path = m.route(lv, { x: k.x + k.w / 2, z: k.z + k.d / 2 }, away.spots[0]).map(name)
    // Move the front door to the other side of the wall (onto the porch, facing inside): the exterior door is still found, the inside is behind the door
    const front = lv.items.find((i) => i.kind === 'door' && geo.doorSides(i, lv.rooms).back?.name === 'Front porch')
    const a = geo.apertureOf(front)
    const f = { x: Math.sin(front.rot), z: Math.cos(front.rot) }
    const back = { ...front, x: a.horizontal ? front.x : a.line - f.x * geo.APERTURE_INSET, z: a.horizontal ? a.line - f.z * geo.APERTURE_INSET : front.z, rot: front.rot + Math.PI }
    const mirrored = { ...lv, items: lv.items.map((i) => (i === front ? back : i)) }
    const s0 = fps.spawnPoint(lv)
    const s1 = fps.spawnPoint(mirrored)
    const look = (s) => `${(-Math.sin(s.yaw)).toFixed(2)}, ${(-Math.cos(s.yaw)).toFixed(2)}`
    return { doors, spots, path, side: geo.exteriorSide(back, lv.rooms), backRoom: name(back), same: Math.hypot(s0.x - s1.x, s0.z - s1.z) < 0.01 && look(s0) === look(s1), s0: `${s0.x.toFixed(2)}, ${s0.z.toFixed(2)} (${name(s0)}, looking ${look(s0)})` }
  })
  ok(
    outer.doors.length === 3 && outer.doors.every((d) => /porch|deck|yard/.test(d)) && outer.spots.length === 3 && outer.spots.every((s) => s === 'Front porch -> Foyer') && outer.path.includes('Foyer') && outer.path.at(-1) === 'Front porch',
    `Exterior doors are found even when they open onto a porch or garden (${outer.doors.join(', ')}); waiting spots when nobody is home: ${outer.spots.join(' · ')}; route from the kitchen: ${[...new Set(outer.path)].join(' > ')}`,
  )
  ok(outer.side === -1 && outer.backRoom === 'Front porch' && outer.same, `A front door placed from the porch is also an exterior door (the inside is behind it: ${outer.side}); the walk still starts from ${outer.s0}`)
}

// --- Pets: the cat and the dog are alive, they go from room to room through doors ---
{
  const pets = () => p.evaluate(() => window.__homescape.pets().then((d) => JSON.parse(JSON.stringify({ live: d.live, wallCross: d.wallCross, pets: d.pets }))))
  let d = await pets()
  const cat = d.pets.find((q) => q.species === 'cat')
  const dog = d.pets.find((q) => q.species === 'dog')
  ok(d.live === 2 && Boolean(cat) && Boolean(dog), `The cat and the dog are alive on the ground floor (${d.pets.map((q) => `${q.species} ${q.label}`).join(', ')})`)
  const rooms = await p.evaluate(() => {
    const lv = window.__homescape.getState().layout.layout.levels[0]
    return Object.fromEntries(lv.rooms.map((r) => [r.name, { id: r.id, x: r.x, z: r.z, w: r.w, d: r.d }]))
  })
  // Each pet is sent to a room other than the one it is in (the pets also wander on their own during the test)
  const targets = [
    ['Kitchen and dining', 5.0, 2.0],
    ['Office', 3.7, 9.3],
    ['Family room', -4.0, 4.4],
    ['Living room', -3.0, 8.5],
  ]
  const nameOf = (id) => Object.entries(rooms).find(([, r]) => r.id === id)?.[0] ?? 'outside'
  const goal = {}
  for (const pet of [cat, dog].filter(Boolean)) {
    const [room, x, z] = targets.find(([n]) => rooms[n].id !== pet.roomId && !Object.values(goal).some((g) => g.room === n))
    goal[pet.id] = { room, id: rooms[room].id, x, z, from: nameOf(pet.roomId) }
  }
  if (cat && dog) {
    await p.evaluate((g) => window.__homescape.pets().then((q) => Object.entries(g).forEach(([id, t]) => q.command(id, 'wander', t.x, t.z))), goal)
    const seen = { [cat.id]: new Set([cat.roomId]), [dog.id]: new Set([dog.roomId]) }
    for (let k = 0; k < 120; k++) {
      d = await pets()
      for (const q of d.pets) if (q.roomId) seen[q.id]?.add(q.roomId)
      // While the people at home wander, the cat runs away from walkers and the dog tags along: it is enough for them to reach the target room once
      if (seen[cat.id].has(goal[cat.id].id) && seen[dog.id].has(goal[dog.id].id)) break
      await p.waitForTimeout(250)
    }
    const arrived = (pet) => seen[pet.id].has(goal[pet.id].id) && seen[pet.id].size >= 2
    const say = (pet, label) => `${label} ${goal[pet.id].from} -> ${goal[pet.id].room}: ${arrived(pet) ? 'arrived' : 'did not arrive'}, ${seen[pet.id].size} rooms`
    ok(arrived(cat) && arrived(dog) && d.wallCross === 0, `In view mode the cat and the dog go from room to room through doors (${say(cat, 'cat')}; ${say(dog, 'dog')}; wall crossings ${d.wallCross})`)
  }
}

// --- Night: unbound street lamps light up by themselves ---
await p.evaluate(() => window.__homescape.focusRoom(window.__homescape.getState().layout.layout.levels[0].rooms.find((r) => r.name === 'Street').id))
await p.evaluate(() => window.__homescape.setTheme('night'))
await p.waitForTimeout(2200)
const lamps = await p.evaluate(async () => {
  const lv = window.__homescape.getState().layout.layout.levels[0]
  const lights = await window.__homescape.roomLights()
  const all = lv.items.filter((i) => i.kind === 'streetLamp')
  const lit = (it) => lights.some((l) => l.pos[1] > 3 && Math.hypot(l.pos[0] - it.x, l.pos[2] - it.z) < 1.6)
  return { unbound: all.filter((i) => !i.entityId).length, unboundLit: all.filter((i) => !i.entityId && lit(i)).length, bound: all.filter((i) => i.entityId).length, boundLit: all.filter((i) => i.entityId && lit(i)).length, total: lights.length }
})
ok(lamps.unbound >= 3 && lamps.unboundLit === lamps.unbound && lamps.boundLit === lamps.bound, `At night all ${lamps.unbound} unbound street lamps light up by themselves, the ${lamps.bound} bound lamps light up with their state in HA (${lamps.unboundLit + lamps.boundLit} lamps, ${lamps.total} lights)`)
await shot('night')
await p.evaluate(() => window.__homescape.focusRoom(window.__homescape.getState().layout.layout.levels[0].rooms.find((r) => r.name === 'Family room').id))
await p.waitForTimeout(2000)
await shot('night-home')
await p.evaluate(() => window.__homescape.setTheme('day'))
await p.waitForTimeout(800)

// --- First-person walk: images from the entrance, the kitchen, the upper floor; changing floors by the stairs ---
{
  const st0 = await store()
  const ground = st0.levels.find((l) => l.elevation === 0).id
  const upper = st0.levels.find((l) => l.elevation === 1).id
  await setLevel(0)
  // With no selection the walk starts at the inner side of the front door, looking into the hall (behind the front door is the porch)
  await p.evaluate(() => window.__homescape.select(null))
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.waitForTimeout(600)
  const f0 = await p.evaluate(async () => {
    const geo = await import('/src/model/geometry.ts')
    const f = await window.__homescape.fps()
    const lv = window.__homescape.getState().layout.layout.levels.find((l) => (l.elevation ?? 0) === 0)
    return { ...f, room: geo.roomAt(lv.rooms, f.x, f.z)?.name }
  })
  ok(
    f0.room === 'Foyer' && Math.hypot(f0.x - 0.5, f0.z - 9.19) < 0.3 && -Math.cos(f0.yaw) < -0.9,
    `The walk starts at the front door (${f0.x.toFixed(2)}, ${f0.z.toFixed(2)}, ${f0.room}, looking ${(-Math.sin(f0.yaw)).toFixed(2)}, ${(-Math.cos(f0.yaw)).toFixed(2)}; it used to be the middle of the hall, 0, 7.75)`,
  )
  await p.evaluate(() => window.__homescape.fpsTeleport(0.6, 9.2, 0.25, -0.08))
  await p.waitForTimeout(1200)
  await shot('fps-entrance')
  await p.evaluate(() => window.__homescape.fpsTeleport(2.6, 4.9, 0.55, -0.22))
  await p.waitForTimeout(1200)
  await shot('fps-kitchen')
  // Up the stairs: walk toward -z from in front of the lower end
  await p.evaluate(() => window.__homescape.fpsTeleport(-0.94, 7.2 + 1.75, 0, 0))
  await p.waitForTimeout(300)
  await p.keyboard.down('KeyW')
  await p.waitForTimeout(2600)
  await p.keyboard.up('KeyW')
  await p.waitForTimeout(500)
  const up = await store()
  const f1 = await p.evaluate(() => window.__homescape.fps())
  ok(up.levelId === upper, `Walking up the stairs in the walk mode reaches the upper floor (floor ${up.levelId === upper ? '1' : '0'}, position ${f1.x.toFixed(2)}, ${f1.z.toFixed(2)})`)
  await p.evaluate(() => window.__homescape.fpsTeleport(-0.2, 5.0, Math.PI * 0.85, -0.05))
  await p.waitForTimeout(1200)
  await shot('fps-upper-floor')
  // Down: walk toward +z (into the stairwell) from in front of the upper end
  await p.evaluate(() => window.__homescape.fpsTeleport(-0.94, 7.2 - 1.75, Math.PI, 0))
  await p.waitForTimeout(300)
  await p.keyboard.down('KeyW')
  await p.waitForTimeout(2600)
  await p.keyboard.up('KeyW')
  await p.waitForTimeout(500)
  ok((await store()).levelId === ground, 'Walking down the stairs from the upper floor reaches the ground floor')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  if (await p.isVisible('#fps-hud')) await p.keyboard.press('Escape')
  await p.waitForTimeout(800)
}

// --- Reload: with the sample home open, its entities enter the demo source again ---
await p.reload()
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1800)
st = await store()
ok(st.home === homeId && st.us.length === usCount, `After a page reload the sample home is open and its entities are in the demo source again (${st.us.length}/${usCount})`)

// --- Isolation: back in the previous home, the entities of the sample home leave the source ---
await p.evaluate((id) => window.__homescape.getState().layout.switchHome(id), before.home)
await p.waitForTimeout(800)
st = await store()
const leaked = await p.evaluate(async () => {
  const gen = await import('/src/model/generate.ts')
  const bind = await import('/src/model/bindings.ts')
  const s = window.__homescape.getState().layout
  const items = s.layout.levels.flatMap((l) => l.items)
  const ents = window.__homescape.entityIds().map((id) => window.__homescape.entity(id))
  // The same filter as Inspector > "Devices not bound to any item"
  return ents.filter((e) => e.entity_id.includes('.us_') && !bind.boundAnywhere(items, e.entity_id) && gen.kindFor(e)).length
})
ok(st.home === before.home && st.us.length === 0 && leaked === 0, `Back in the previous home the entities of the sample home are gone: they do not leak into the list of unbound devices (${st.us.length} entities, ${leaked} in the list)`)

// --- Home menu: "Sample home: American house" switches to the existing home (no second copy); "Reset" returns the plan to its initial state ---
await p.click('#home-switcher')
await p.waitForSelector('#home-demo-american')
await p.click('#home-demo-american')
// Until the flight between homes (scene/HomeFlight.tsx) ends
for (let k = 0, runs = null; k < 80; k++) {
  const f = await p.evaluate(() => window.__homescape.homeFlight())
  runs ??= f.runs
  if (f.stage === 'idle' && f.runs > runs) break
  await p.waitForTimeout(100)
}
st = await store()
ok(st.home === homeId && st.homes === before.homes + 1 && st.us.length === usCount, `The sample home entry in the home menu switches to the existing home (homes ${st.homes}, entities ${st.us.length})`)
const moved = await p.evaluate(() => {
  const s = window.__homescape.getState().layout
  const it = s.layout.levels[0].items.find((i) => i.kind === 'sofa')
  s.updateItem(it.id, { x: it.x + 0.4 })
  return { id: it.id, x: it.x }
})
await p.click('#home-switcher')
await p.click('#home-demo-american-reset')
await p.click('#home-demo-american-reset')
await p.waitForTimeout(1000)
const after = await p.evaluate((id) => window.__homescape.getState().layout.layout.levels[0].items.find((i) => i.id === id)?.x, moved.id)
st = await store()
ok(Math.abs(after - moved.x) < 1e-6 && st.homes === before.homes + 1 && st.home === homeId, `"Reset" returns the sample home to its initial state with two clicks (sofa ${after?.toFixed(2)}), no other home is added`)
await p.keyboard.press('Escape')

// --- Sample home on a live connection (user request, 9 Oct 2026: "in the American demo home let us be able to switch objects
// on and off by clicking; since it is a demo we should not need to connect it to Home Assistant"): in a fake live source the
// entities of the sample home live in the local simulation, clicking toggles the item, the command does not go to the real HA ---
{
  await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    s.setMode('view')
    s.select(null)
    s.setLevel(s.layout.levels.find((l) => (l.elevation ?? 0) === 0).id)
  })
  await p.evaluate(() => window.__homescape.fakeLive())
  await p.waitForTimeout(800)
  const ids = await p.evaluate(() => window.__homescape.entityIds())
  const us = ids.filter((id) => id.includes('.us_')).length
  ok(ids.includes('light.real_lamp') && us === usCount, `Even on a live connection the entities of the sample home are in the local simulation (${us}/${usCount}, the real entity is there too)`)
  // Click an item that has a light: it toggles, the detail card does not open
  const lamps = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const l = s.layout.levels.find((x) => x.id === s.levelId)
    return l.items
      .filter((i) => i.entityId?.startsWith('light.us_') && ['floorLamp', 'tableLamp', 'deskLamp', 'pendant', 'ceilingLight'].includes(i.kind))
      .map((i) => ({ id: i.id, kind: i.kind, x: i.x, z: i.z, y: i.kind === 'pendant' || i.kind === 'ceilingLight' ? 2.2 : 0.9, entity: i.entityId, room: l.rooms.find((r) => [r, ...(r.parts ?? [])].some((q) => q.x <= i.x && q.x + q.w >= i.x && q.z <= i.z && q.z + q.d >= i.z))?.id }))
  })
  let done = null
  for (const lamp of lamps.slice(0, 8)) {
    await p.evaluate((id) => window.__homescape.focusRoom(id), lamp.room)
    await p.waitForTimeout(1800)
    const pt = await p.evaluate(([x, y, z]) => window.__homescape.project(x, y, z), [lamp.x, lamp.y, lamp.z])
    if (!pt || pt.x < 60 || pt.x > 1180 || pt.y < 170 || pt.y > 810) continue
    if ((await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [pt.x, pt.y])) !== 'CANVAS') continue
    await p.mouse.move(pt.x, pt.y, { steps: 3 })
    await p.waitForTimeout(200)
    if ((await p.evaluate(() => document.body.style.cursor)) !== 'pointer') continue
    const before = (await p.evaluate((id) => window.__homescape.entity(id), lamp.entity))?.state
    await p.mouse.click(pt.x, pt.y)
    await p.waitForTimeout(500)
    const after = (await p.evaluate((id) => window.__homescape.entity(id), lamp.entity))?.state
    const sel = await p.evaluate(() => window.__homescape.getState().layout.selection)
    done = { kind: lamp.kind, before, after, sel }
    await p.mouse.move(5, 450)
    break
  }
  ok(Boolean(done) && done.before !== done.after && !done.sel, `Clicking a light in the sample home toggles it (${done ? `${done.kind}: ${done.before} -> ${done.after}` : 'no lamp to click was found'}), the detail card does not open`)
  const calls = await p.evaluate(() => window.__homescape.fakeLiveCalls())
  ok(calls.every((c) => !JSON.stringify(c.data).includes('.us_')), `The commands of the sample home do not go to the real Home Assistant (${calls.length} calls to the live source, none from the sample home)`)
  await shot('live-click')
  await p.evaluate(() => window.__homescape.demo())
  await p.waitForTimeout(800)
}

// --- Cleanup: back to the previous home, delete the sample home ---
await p.evaluate(
  ([prev, id]) => {
    const s = window.__homescape.getState().layout
    s.switchHome(prev)
    s.deleteHome(id)
    s.setMode('view')
    window.__homescape.setTheme('auto')
  },
  [before.home, homeId],
)
await p.waitForTimeout(600)
st = await store()
ok(st.home === before.home && st.homes === before.homes && st.us.length === 0, `Back in the previous home, the sample home is deleted (homes ${st.homes})`)

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
