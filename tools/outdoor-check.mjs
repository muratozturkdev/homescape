// Front-of-house and street regression test (user request, 9 Oct 2026: "I should be able to model the outside too, like the front of
// a house; roads, grass, concrete, trees and every other thing you can think of"): outdoor ground cards (road, sidewalk, crosswalk,
// parking lot, driveway, gravel path, pond, lawn and concrete area), the direction of the road markings, the cards and placement
// rules of street items, the street lamp lighting the road and sidewalk at night, the floor buttons on the room card.
// `npm run dev` must be running first. Run: node tools/outdoor-check.mjs
// Intermediate screenshots: shots/outdoor-*.png. Everything the test adds is deleted at the end.
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
await p.waitForTimeout(1200)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const level = () =>
  p.evaluate(() => {
    const s = window.__homescape.getState().layout
    return s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  })
const project = (x, z, y = 0) => p.evaluate(([x, y, z]) => window.__homescape.project(x, y, z), [x, y, z])
const placement = () => p.evaluate(() => window.__homescape.placement())
const onCanvas = (pt) => p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', pt)
const bar = (text) => p.locator(`nav[aria-label="Build bar"] button:has(span:text-is("${text}"))`).first()
const tab = (text) => p.locator(`nav[aria-label="Build bar"] button:has-text("${text}")`).first()
const shot = (name) => p.screenshot({ path: `shots/outdoor-${name}.png` })
/** Drag from the card to a point in the scene; `during` runs before releasing (R key, the ghost's result). */
const dragCard = async (text, to, during) => {
  const card = bar(text)
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await p.mouse.down()
  await p.mouse.move(to.x, to.y, { steps: 14 })
  await p.waitForTimeout(400)
  if (during) await during()
  await p.mouse.up()
  await p.waitForTimeout(500)
}

const STREET = ['streetLamp', 'bench', 'streetBin', 'wheelieBin', 'recycleBins', 'hydrant', 'trafficSign', 'bollard', 'bikeRack', 'busStop', 'steppingStones', 'rock', 'planter', 'pergola', 'fountain', 'birdBath', 'slide', 'trampoline', 'sandbox', 'streetTree', 'utilityPole', 'outdoorShower', 'manhole', 'speedBump', 'trafficCone', 'gardenShed', 'picnicTable']
const GROUNDS = ['Road', 'Sidewalk', 'Crosswalk', 'Parking lot', 'Driveway', 'Gravel path', 'Pond', 'Lawn', 'Concrete area']
const added = { rooms: [], items: [] }

// --- Build bar: outdoor ground cards and street items ---
await p.evaluate(() => window.__homescape.setMode('edit'))
await p.waitForTimeout(800)
await tab('Rooms').click()
await p.waitForTimeout(200)
const groundCards = []
for (const name of GROUNDS) if (await bar(name).count()) groundCards.push(name)
ok(groundCards.length === GROUNDS.length, `Outdoor ground cards on the Rooms tab (${groundCards.length}/${GROUNDS.length}: ${groundCards.join(', ')})`)
const labels = await p.evaluate(async (kinds) => {
  const c = await import('/src/model/catalog.ts')
  return kinds.map((k) => [k, c.CATALOG[k]?.label, c.CATALOG[k]?.group])
}, STREET)
ok(labels.every(([, l, g]) => l && g === 'outdoor'), `${labels.length} street items are in the catalog, in the Garden and balcony group`)
await tab('Garden and balcony').click()
await p.waitForTimeout(200)
const missing = []
for (const [k, l] of labels) if (!(await bar(l).count())) missing.push(k)
ok(missing.length === 0, `The Garden and balcony tab has a card for every street item${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)
await p.fill('#build-search', 'street')
await p.waitForTimeout(200)
const found = await p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Street lamp"))').count()
await p.fill('#build-search', 'cross')
await p.waitForTimeout(200)
const foundRoom = await p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Crosswalk"))').count()
await p.fill('#build-search', '')
ok(found >= 1 && foundRoom >= 1, 'Searching "street" finds the street lamp, searching "cross" finds the crosswalk ground')
// Thumbnails: ground cards show the ground's own texture, items show a 3D model (drawn one after another in the background)
let thumbs = { road: false, lamp: false }
for (let i = 0; i < 60 && !(thumbs.road && thumbs.lamp); i++) {
  await p.waitForTimeout(1000)
  thumbs = await p.evaluate(async () => {
    const u = (await import('/src/ui/thumbStore.ts')).useThumbs.getState().urls
    return { road: Boolean(u['floor:road']?.startsWith('data:image')), lamp: Boolean(u.streetLamp?.startsWith('data:image')) }
  })
}
await tab('Rooms').click()
await p.waitForTimeout(300)
const roadImg = await bar('Road').locator('img').getAttribute('src').catch(() => null)
ok(thumbs.road && thumbs.lamp && Boolean(roadImg?.startsWith('data:image')), 'Thumbnails: the "Road" card shows a road-textured tile, the street lamp a 3D model')

// --- The road markings follow the direction of the area ---
const marks = await p.evaluate(async () => {
  const t = await import('/src/scene/kit/textures.ts')
  /** Brightness (0-255) of pixel (x, y) on the texture's canvas. */
  const lum = (tex, x, y) => {
    const c = tex.image
    const d = c.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data
    return 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]
  }
  const along = t.floorTexture('road', 12, 7)
  const across = t.floorTexture('road', 7, 12)
  const shortPiece = t.floorTexture('road', 5, 7, 'x')
  const zebra = t.floorTexture('crosswalk', 3, 7, 'x')
  const zebraLong = t.floorTexture('crosswalk', 3, 7)
  const park = t.floorTexture('parking', 10, 5.5)
  const a = along.image
  const c = across.image
  return {
    along: { rep: [along.repeat.x, along.repeat.y], dash: lum(along, a.width * 0.2, a.height / 2), gap: lum(along, a.width * 0.75, a.height / 2) },
    across: { rep: [across.repeat.x, across.repeat.y], dash: lum(across, c.width / 2, c.height * 0.2), gap: lum(across, c.width / 2, c.height * 0.75) },
    shortPiece: [shortPiece.repeat.x, shortPiece.repeat.y],
    zebra: [zebra.repeat.x, zebra.repeat.y],
    zebraLong: [zebraLong.repeat.x, zebraLong.repeat.y],
    park: [park.repeat.x, park.repeat.y],
  }
})
ok(marks.along.rep[0] > 3 && marks.along.rep[1] === 1 && marks.along.dash > 200 && marks.along.gap < 150, `On a 12 × 7 m road the dashed center line runs along x (repeat ${marks.along.rep.map((n) => n.toFixed(1)).join(' × ')}, dash ${marks.along.dash.toFixed(0)}, gap ${marks.along.gap.toFixed(0)})`)
ok(marks.across.rep[0] === 1 && marks.across.rep[1] > 3 && marks.across.dash > 200 && marks.across.gap < 150, `On a 7 × 12 m (rotated) road the line runs along z (repeat ${marks.across.rep.map((n) => n.toFixed(1)).join(' × ')})`)
ok(marks.shortPiece[0] > 1 && marks.shortPiece[1] === 1, `A short connecting piece (5 × 7 m) attached to the road in the x direction is also drawn along x (repeat ${marks.shortPiece.map((n) => n.toFixed(2)).join(' × ')})`)
ok(marks.zebra[0] === 1 && marks.zebra[1] === 7 && marks.zebraLong[1] === 7, `The crosswalk stripes are parallel to the traffic, lined up in the crossing direction (repeat ${marks.zebra.join(' × ')})`)
ok(marks.park[0] === 4 && marks.park[1] === 1, `In the parking lot the 2.5 m parking spaces run along the long edge (${marks.park.join(' × ')})`)

// --- Drag a ground card into the scene: a road and a sidewalk (rotated with R) ---
const L0 = await level()
const xs = L0.rooms.flatMap((r) => [r.x, r.x + r.w])
const zs = L0.rooms.flatMap((r) => [r.z, r.z + r.d])
const bb = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
await p.click('button[title="Whole home (F)"]')
await p.waitForTimeout(1500)
let spot = null
for (const [wx, wz] of [[(bb.minX + bb.maxX) / 2, bb.maxZ + 6], [bb.maxX + 9, (bb.minZ + bb.maxZ) / 2], [bb.minX - 9, (bb.minZ + bb.maxZ) / 2], [(bb.minX + bb.maxX) / 2, bb.minZ - 6]]) {
  const sp = await project(wx, wz)
  if (sp && sp.x > 60 && sp.x < 1150 && sp.y > 110 && sp.y < 680 && (await onCanvas(sp))) {
    spot = sp
    break
  }
}
ok(Boolean(spot), 'Found a free spot for the road next to the house')
if (spot) {
  let ghost = null
  await dragCard('Road', spot, async () => {
    ghost = await placement()
  })
  const L1 = await level()
  const road = L1.rooms.find((r) => !L0.rooms.some((o) => o.id === r.id))
  if (road) added.rooms.push(road.id)
  ok(ghost?.result?.ok === true && road?.floor === 'road' && road.type === 'garden' && road.w === 12 && road.d === 7 && road.name === 'Road', `Dragging the "Road" card: a 12 × 7 m wall-less road ground (${road ? `${road.name}, ${road.floor}, ${road.type}, ${road.w} × ${road.d}` : 'not added'})`)
  // Rotate the sidewalk with R and drop it next to the road: 2.5 × 12 m (the first spot on screen that does not overlap the house)
  let side = null
  if (road) {
    // Let the camera frame the new road too
    await p.click('button[title="Whole home (F)"]')
    await p.waitForTimeout(1500)
  }
  if (road)
    for (const [cx, cz] of [
      [road.x + road.w + 1.3, road.z + road.d / 2],
      [road.x - 1.3, road.z + road.d / 2],
      [road.x + road.w + 1.3, road.z + 6.1],
      [road.x - 1.3, road.z + 6.1],
      [road.x + road.w - 6.1, road.z + road.d + 1.3],
    ]) {
      const free = await p.evaluate(async ([cx, cz]) => {
        const rules = await import('/src/model/rules.ts')
        const st = window.__homescape.getState().layout
        const l = st.layout.levels.find((q) => q.id === st.levelId) ?? st.layout.levels[0]
        return !rules.overlapsRoom({ x: cx - 1.2, z: cz - 5.95, w: 2.4, d: 11.9 }, l.rooms)
      }, [cx, cz])
      const sp = free ? await project(cx, cz) : null
      if (sp && sp.x > 60 && sp.x < 1150 && sp.y > 110 && sp.y < 680 && (await onCanvas(sp))) {
        side = sp
        break
      }
    }
  if (road) {
    let g2 = null
    if (side) await dragCard('Sidewalk', side, async () => {
      await p.keyboard.press('r')
      await p.waitForTimeout(300)
      g2 = await placement()
    })
    const L2 = await level()
    const walk = L2.rooms.find((r) => !L1.rooms.some((o) => o.id === r.id))
    if (walk) added.rooms.push(walk.id)
    ok(Boolean(g2?.result?.ok) && walk?.floor === 'sidewalk' && walk.w === 2.5 && walk.d === 12, `The "Sidewalk" rotates with R and is placed next to the road (${walk ? `${walk.w} × ${walk.d}, ${walk.floor}` : `not added: ${g2?.result?.reason ?? ''}`})`)
  }
}

// --- Street scene: grounds and items follow the rules ---
const X0 = 400
const scene = await p.evaluate(async (X0) => {
  const h = window.__homescape
  const s = h.getState().layout
  const rules = await import('/src/model/rules.ts')
  const lv = () => {
    const st = h.getState().layout
    return st.layout.levels.find((l) => l.id === st.levelId) ?? st.layout.levels[0]
  }
  h.setEntity({ entity_id: 'light.t_street', state: 'on', attributes: { friendly_name: 'Street lamp', brightness: 255 } })
  h.setEntity({ entity_id: 'switch.t_fountain', state: 'on', attributes: { friendly_name: 'Fountain pump' } })
  const R = (name, floor, x, z, w, d) => s.addRoom({ name, floor, x: X0 + x, z, w, d, type: 'garden', areaId: null })
  const rooms = {
    yard: R('T front yard', 'grass', 0, 0, 12, 5),
    walk: R('T sidewalk', 'sidewalk', 0, 5, 12, 2.5),
    road: R('T road', 'road', 0, 7.5, 7, 7),
    cross: R('T crosswalk', 'crosswalk', 7, 7.5, 3, 7),
    road2: R('T road 2', 'road', 10, 7.5, 5, 7),
    pond: R('T pond', 'water', 12, 0, 3, 3),
    park: R('T parking', 'parking', 15, 5, 10, 5.5),
    gravel: R('T gravel', 'gravel', 12, 3, 3, 2),
  }
  // [kind, x, z, rotation, extra]: street items on the sidewalk, road items on the road, playground and garden items in the yard
  const plan = [
    ['streetTree', 0.8, 6.25],
    ['streetLamp', 2.3, 7.2, 0, { entityId: 'light.t_street' }],
    ['bench', 3.9, 5.65],
    ['streetBin', 5.4, 6.9],
    ['hydrant', 6.2, 7.0],
    ['trafficSign', 7.0, 7.2, 0, { variant: 'crossing' }],
    ['bollard', 7.6, 7.2],
    ['bikeRack', 9.0, 5.7],
    ['recycleBins', 10.9, 5.65],
    ['utilityPole', 11.6, 7.1],
    ['wheelieBin', 11.0, 6.95, 0, { body: '#3e8e62' }],
    ['manhole', 2.0, 10.0],
    ['speedBump', 4.5, 11.0, Math.PI / 2],
    ['trafficCone', 11.0, 9.0],
    ['busStop', 20.0, 6.3],
    ['gardenShed', 1.3, 1.05],
    ['pergola', 4.2, 2.6],
    ['picnicTable', 4.2, 2.6],
    ['slide', 0.6, 3.5],
    ['sandbox', 2.0, 4.1],
    ['fountain', 7.0, 2.4, 0, { entityId: 'switch.t_fountain' }],
    ['steppingStones', 8.6, 2.5, Math.PI / 2, { len: 3.6 }],
    ['birdBath', 6.0, 0.5],
    ['rock', 7.0, 4.4],
    ['planter', 5.0, 4.6],
    ['trampoline', 10.5, 1.5],
    ['outdoorShower', 10.8, 4.1],
  ]
  const res = []
  for (const [kind, x, z, rot = 0, extra = {}] of plan) {
    const { entityId = null, ...opts } = extra
    const c = rules.checkItem(lv(), { kind, x: X0 + x, z, rot, ...opts })
    const id = c.ok ? s.addItem(kind, X0 + x, z, rot, entityId, undefined, opts) : null
    res.push({ kind, ok: c.ok, reason: c.reason, id })
  }
  // Negative cases: a second bench on top of a bench, a bus stop on the road with half of it spilling onto the sidewalk
  const bench = plan.find((q) => q[0] === 'bench')
  const twice = rules.checkItem(lv(), { kind: 'bench', x: X0 + bench[1] + 0.3, z: bench[2], rot: 0 })
  const outside = rules.checkItem(lv(), { kind: 'busStop', x: X0 + 3.9, z: 7.5, rot: 0 })
  return { rooms, res, twice, outside }
}, X0)
added.rooms.push(...Object.values(scene.rooms))
const bad = scene.res.filter((r) => !r.ok)
ok(bad.length === 0 && scene.res.length === STREET.length, `${scene.res.length} street and garden items were placed following the rules (on the sidewalk, road and yard)${bad.length ? `: ${bad.map((r) => `${r.kind} (${r.reason})`).join(', ')}` : ''}`)
ok(scene.res.find((r) => r.kind === 'picnicTable')?.ok === true, 'A picnic table can be placed under the pergola (the pergola is on the roof layer)')
ok(!scene.twice.ok && /Too close/.test(scene.twice.reason ?? ''), `A second bench cannot be placed on the same spot (${scene.twice.reason})`)
ok(!scene.outside.ok, `A bus stop spilling over the border of the sidewalk and road is rejected (${scene.outside.reason})`)

// Screenshots: the street by day, the street lamp at night
const focus = async (id) => {
  await p.evaluate((rid) => {
    window.__homescape.select(null)
    window.__homescape.focusRoom(rid)
  }, id)
  await p.waitForTimeout(1800)
}
await p.evaluate(() => window.__homescape.setMode('view'))
await focus(scene.rooms.walk)
await shot('street-day')

// --- Street lamp: lights the road (under the arm) and the sidewalk (the pole's room) at night ---
const lampId = scene.res.find((r) => r.kind === 'streetLamp').id
const lampLights = async () =>
  (await p.evaluate(() => window.__homescape.roomLights())).filter((l) => l.pos[0] > X0 + 1.5 && l.pos[0] < X0 + 3.1 && l.pos[1] > 3)
await p.evaluate(() => window.__homescape.setTheme('night'))
await p.waitForTimeout(1200)
const night = await lampLights()
// The light's area: a rectangle covering the point (an empty list means unbounded)
const covers = (l, x, z) => !l.rects.length || l.rects.some((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d)
const onRoad = night.find((l) => Math.abs(l.pos[2] - 8.22) < 0.05 && covers(l, X0 + 3, 10))
const onWalk = night.find((l) => covers(l, X0 + 2.3, 6.2))
ok(Boolean(onRoad) && Boolean(onWalk), `At night the street lamp lights the road under its arm (${onRoad ? onRoad.pos.map((n) => n.toFixed(2)).join(', ') : 'none'}) and the sidewalk where the pole stands (${night.length} lights)`)
// User feedback (9 Oct 2026: "I added a crosswalk but there is no light at all"): there are no walls outside, so the light also
// falls on neighboring open areas in range (the crosswalk, the road next to it)
const onCross = night.find((l) => l.rects.length && covers(l, X0 + 8.5, 10))
ok(Boolean(onCross), `The street lamp also lights the crosswalk next to it (${onCross ? onCross.rects.map((r) => `${(r.x - X0).toFixed(1)},${r.z.toFixed(1)} ${r.w.toFixed(1)}x${r.d.toFixed(1)}`).join(' | ') : 'none'})`)
await shot('street-night')
await p.evaluate(() => window.__homescape.setTheme('day'))
await p.waitForTimeout(800)
const day = await lampLights()
const dayRoad = day.find((l) => onRoad && Math.abs(l.pos[2] - onRoad.pos[2]) < 0.01)
ok(Boolean(dayRoad) && dayRoad.energy < onRoad.energy * 0.5, `The street lamp contributes little by day (${dayRoad?.energy} / night ${onRoad?.energy})`)
await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.t_street', state: 'off', attributes: { friendly_name: 'Street lamp', brightness: 0 } }))
await p.waitForTimeout(500)
ok((await lampLights()).length === 0, 'The light goes out when the lamp turns off')
// Models: the double-arm lamp gives two lights, the classic lantern one
await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.t_street', state: 'on', attributes: { friendly_name: 'Street lamp', brightness: 255 } }))
await p.evaluate((id) => window.__homescape.getState().layout.updateItem(id, { variant: 'double' }), lampId)
await p.waitForTimeout(500)
const dbl = (await lampLights()).filter((l) => Math.abs(l.pos[1] - 3.84) < 0.01)
await p.evaluate((id) => window.__homescape.getState().layout.updateItem(id, { variant: 'classic' }), lampId)
await p.waitForTimeout(500)
const cls = (await lampLights()).filter((l) => l.pos[1] > 3.1)
ok(dbl.length === 2 && cls.some((l) => Math.abs(l.pos[1] - 3.25) < 0.01 && Math.abs(l.pos[2] - 7.2) < 0.01), `The double-arm lamp lights to both sides (${dbl.length} lights), the classic lantern from its top (${cls.length})`)

// --- Room card: floor buttons; when the floor changes it becomes a pond ---
await p.evaluate(() => window.__homescape.setMode('edit'))
await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), scene.rooms.gravel)
await p.waitForTimeout(500)
const floorBtns = []
for (const f of ['Road', 'Sidewalk', 'Crosswalk', 'Parking', 'Gravel', 'Water']) if (await p.locator(`button:text-is("${f}")`).count()) floorBtns.push(f)
await p.locator('button:text-is("Water")').first().click()
await p.waitForTimeout(300)
const gravelRoom = (await level()).rooms.find((r) => r.id === scene.rooms.gravel)
ok(floorBtns.length === 6 && gravelRoom?.floor === 'water', `Outdoor floors on the room card (${floorBtns.join(', ')}); picking "Water" turns the floor into water (${gravelRoom?.floor})`)
await p.evaluate(() => window.__homescape.select(null))
await focus(scene.rooms.yard)
await shot('garden')

// --- Cleanup ---
await p.evaluate((ids) => {
  const s = window.__homescape.getState().layout
  for (const id of ids) s.deleteRoom(id)
  window.__homescape.setMode('view')
}, added.rooms)
const Lend = await level()
ok(Lend.rooms.length === L0.rooms.length && !Lend.items.some((i) => STREET.includes(i.kind) && i.x > X0 - 1), `The test deleted what it added (${Lend.rooms.length} rooms, ${L0.rooms.length} at the start)`)

// --- Road network markings (user feedback, 9 Oct 2026: "it draws the L road wrong, it needs to add the turns") ---
{
  const r = await p.evaluate(async () => {
    const m = await import('/src/scene/kit/roads.ts')
    const fmt = (pts) => pts.map((q) => `${+q.x.toFixed(2)},${+q.z.toFixed(2)}`).join(' > ')
    const L = m.roadMarks([
      { r: { x: 0, z: 0, w: 7, d: 24 }, kind: 'road' },
      { r: { x: 7, z: 17, w: 16, d: 7 }, kind: 'road' },
    ])
    const T = m.roadMarks([
      { r: { x: 0, z: 0, w: 30, d: 7 }, kind: 'road' },
      { r: { x: 12, z: 7, w: 7, d: 10 }, kind: 'road' },
    ])
    const C = m.roadMarks([
      { r: { x: 0, z: 0, w: 7, d: 10 }, kind: 'road' },
      { r: { x: 0, z: 10, w: 7, d: 3 }, kind: 'crosswalk' },
      { r: { x: 0, z: 13, w: 7, d: 10 }, kind: 'road' },
    ])
    return {
      L: L.centers.map((c) => fmt(c.pts)),
      Le: L.edges.map(([a, b]) => fmt([a, b])),
      T: T.centers.map((c) => fmt(c.pts)),
      C: C.centers.map((c) => fmt(c.pts)),
      Ce: C.edges.map(([a, b]) => fmt([a, b])),
    }
  })
  const lpts = r.L[0]?.split(' > ') ?? []
  const lEnds = [lpts[0], lpts[lpts.length - 1]].sort().join(' ')
  ok(r.L.length === 1 && lEnds === '23,20.5 3.5,0' && lpts.includes('3.5,20.5'), `On an L road the center line is a single piece and turns at the corner (${r.L.join(' | ')})`)
  const want = ['0.3,0 > 0.3,23.7', '0.3,23.7 > 23,23.7', '6.7,0 > 6.7,17.3', '6.7,17.3 > 23,17.3']
  ok(r.Le.length === 4 && want.every((w) => r.Le.includes(w)), `On an L road the edge lines join at the corners and dead ends stay open (${r.Le.join(' | ')})`)
  ok(r.T.length === 2 && r.T.includes('0,3.5 > 30,3.5') && r.T.some((c) => c.startsWith('15.5,3.5') || c.endsWith('15.5,3.5')), `At a T junction the side arm's center line joins the middle of the main road (${r.T.join(' | ')})`)
  ok(r.C.length === 2 && r.Ce.every((e) => !e.includes(',11') && !e.includes(',12')), `The center and edge lines stop at the crosswalk (${r.C.join(' | ')})`)
}

// --- A narrow gap between pieces (a hand-drawn road): no double line, the lines are continuous ---
{
  const g = await p.evaluate(async () => {
    const m = await import('/src/scene/kit/roads.ts')
    const r = m.roadMarks([
      { r: { x: 0, z: 0, w: 4.5, d: 17 }, kind: 'road' },
      { r: { x: 0, z: 17, w: 9, d: 7 }, kind: 'road' },
      { r: { x: 9.1, z: 17, w: 10, d: 7 }, kind: 'road' },
    ])
    // One arm overlaps the other by 1 m (the user's road): still a single center line, turning at the corner
    const o = m.roadMarks([
      { r: { x: 0, z: 0, w: 9, d: 24 }, kind: 'road' },
      { r: { x: 8, z: 15, w: 20, d: 9 }, kind: 'road' },
    ])
    const op = o.centers[0]?.pts ?? []
    return {
      gapEdges: r.edges.filter(([a, b]) => Math.abs(a.x - b.x) < 1e-6 && a.x > 8 && a.x < 10).length,
      centers: r.centers.length,
      overlap: o.centers.length === 1 && op.some((q) => Math.abs(q.x - 4.5) < 1e-6 && Math.abs(q.z - 19.5) < 1e-6) ? 'single, turns' : JSON.stringify(o.centers.map((c) => c.pts)),
    }
  })
  ok(g.overlap === 'single, turns', `On an L road where one arm overlaps the other the center line is a single piece and turns at the corner (${g.overlap})`)
  ok(g.gapEdges === 0 && g.centers === 1, `With road pieces 10 cm apart there is no double line in the gap and the center line is a single piece (${g.gapEdges} gap lines, ${g.centers} center lines)`)
}

// --- A placed room (road) rotates: R or "Rotate" on the card; its items rotate with it; it does not rotate if it would overlap another room ---
{
  const rt = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    s.setMode('edit')
    const road = s.addRoom({ name: 'Rotating road', floor: 'road', type: 'garden', x: 500, z: 0, w: 12, d: 7 })
    const cone = s.addItem('trafficCone', 504, 3.5, 0)
    const block = s.addRoom({ name: 'Obstacle', floor: 'grass', type: 'garden', x: 504, z: 7.5, w: 4, d: 2 })
    return { road, cone, block }
  })
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), rt.road)
  await p.waitForTimeout(300)
  const lvl = () =>
    p.evaluate(() => {
      const s = window.__homescape.getState().layout
      return s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
    })
  // There is an obstacle under it: it does not rotate
  await p.keyboard.press('r')
  await p.waitForTimeout(200)
  let L = await lvl()
  let road = L.rooms.find((r) => r.id === rt.road)
  const refused = road.w === 12 && road.d === 7
  await p.evaluate((id) => window.__homescape.getState().layout.deleteRoom(id), rt.block)
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), rt.road)
  await p.waitForTimeout(300)
  await p.click('#room-rotate')
  await p.waitForTimeout(200)
  L = await lvl()
  road = L.rooms.find((r) => r.id === rt.road)
  const cone = L.items.find((i) => i.id === rt.cone)
  const turned = road.w === 7 && road.d === 12 && Math.abs(road.x - 502.5) < 0.01 && Math.abs(road.z + 2.5) < 0.01
  // Clockwise around its center (506, 3.5): (504, 3.5) -> (506, 1.5), rotation -90°
  const moved = Math.abs(cone.x - 506) < 0.01 && Math.abs(cone.z - 1.5) < 0.01 && Math.abs(cone.rot + Math.PI / 2) < 1e-6
  await p.keyboard.press('Meta+z')
  await p.waitForTimeout(200)
  L = await lvl()
  road = L.rooms.find((r) => r.id === rt.road)
  const undone = road.w === 12 && road.d === 7
  ok(refused && turned && moved && undone, `The road turns 90°, the cone on it turns with it, ⌘Z undoes it; it does not turn if it would overlap another room (with obstacle ${refused}, turned ${turned}, cone ${moved}, undone ${undone})`)
  await p.evaluate(({ road, cone }) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(cone)
    s.deleteRoom(road)
    s.select(null)
    s.setMode('view')
  }, rt)
}

// --- A street lamp with no linked entity lights up by itself at night ---
{
  const lamp = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    s.setMode('edit')
    const room = s.addRoom({ name: 'Lamp road', floor: 'road', type: 'garden', x: 400, z: 0, w: 7, d: 12 })
    // A crosswalk next to it (open area) and a room (with walls): the light falls on the crosswalk and does not enter the room
    const cross = s.addRoom({ name: 'Lamp crosswalk', floor: 'crosswalk', type: 'garden', x: 407, z: 3, w: 3, d: 6 })
    const house = s.addRoom({ name: 'Lamp house', floor: 'wood', type: 'room', x: 400, z: 12, w: 7, d: 4 })
    const id = s.addItem('streetLamp', 400.4, 6, -Math.PI / 2)
    s.setMode('view')
    return { room, cross, house, id }
  })
  const near = async () => (await p.evaluate(() => window.__homescape.roomLights())).filter((l) => l.pos[0] > 390 && l.pos[0] < 410).length
  await p.evaluate(() => window.__homescape.setTheme('day'))
  await p.waitForTimeout(600)
  const day = await near()
  await p.evaluate(() => window.__homescape.setTheme('night'))
  await p.waitForTimeout(600)
  const night = await near()
  const lit = (await p.evaluate(() => window.__homescape.roomLights())).filter((l) => l.pos[0] > 390 && l.pos[0] < 410)
  await p.evaluate(() => window.__homescape.setTheme('auto'))
  ok(day === 0 && night >= 1, `A street lamp with no linked entity is off by day and lights up by itself at night (day ${day}, night ${night} lights)`)
  const at = (x, z) => lit.some((l) => !l.rects.length || l.rects.some((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d))
  ok(at(408.5, 6) && !at(403.5, 14), `The lamp's light falls on the crosswalk beside it (${at(408.5, 6)}) and does not enter the walled room (${at(403.5, 14)})`)
  await p.evaluate(({ room, cross, house, id }) => {
    const s = window.__homescape.getState().layout
    s.setMode('edit')
    s.deleteItem(id)
    for (const r of [room, cross, house]) s.deleteRoom(r)
    s.setMode('view')
  }, lamp)
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `\n${failures} checks failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
