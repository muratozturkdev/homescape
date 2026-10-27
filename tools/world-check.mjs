// Regression test for homes, floors, outdoor rooms, quick toggle, Dashboard, search and first-person walking (real mouse/keyboard).
// `npm run dev` must be running first. Run: npm run check:world  (all at once: npm run check)
// Intermediate screenshots: shots/world-*.png
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
const store = () => p.evaluate(() => window.__homescape.getState().layout)
const level = () =>
  p.evaluate(() => {
    const s = window.__homescape.getState().layout
    return s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
  })
const entity = (id) => p.evaluate((x) => window.__homescape.entity(x), id)
const roomAt = (L, x, z) => L.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d)
const focus = async (roomId) => {
  await p.evaluate((id) => window.__homescape.focusRoom(id), roomId)
  await p.waitForTimeout(1700)
}
const shot = (name) => p.screenshot({ path: `shots/world-${name}.png` })

// --- View mode: an unbound item cannot be clicked; hovering a bound item shows the quick toggle ---
let L = await level()
{
  const table = L.items.find((i) => i.kind === 'coffeeTable' && !i.entityId)
  await focus(roomAt(L, table.x, table.z).id)
  const pt = await p.evaluate(([x, z]) => window.__homescape.project(x, 0.43, z), [table.x, table.z])
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(250)
  const sel = (await store()).selection
  ok(sel === null, `In view mode an unbound item (coffee table) is not clickable, the room behind it is not selected either (selection: ${JSON.stringify(sel)})`)

  // The chandelier is in the middle of the room and visible from above (the floor lamp can end up behind an interior wall from this angle; a wall blocks hovering)
  const lamp = L.items.find((i) => i.kind === 'pendant' && i.entityId)
  const lp = await p.evaluate(([x, z]) => window.__homescape.project(x, 2.0, z), [lamp.x, lamp.z])
  await p.mouse.move(lp.x, lp.y, { steps: 4 })
  await p.waitForTimeout(400)
  const pillId = await p.locator('[data-quick]').getAttribute('data-quick', { timeout: 1500 }).catch(() => null)
  // One pill instance (ui/QuickPill.tsx), right above the cursor, horizontally aligned with the cursor, not overlapping the right panel
  // (user feedback, 9 Oct 2026: "it does not appear in a good place")
  const pr = await p.evaluate(() => {
    const all = document.querySelectorAll('[data-quick]')
    const r = all[0]?.getBoundingClientRect()
    return r ? { n: all.length, x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth } : null
  })
  ok(
    pr && pr.n === 1 && pr.y + pr.h < lp.y && lp.y - (pr.y + pr.h) < 70 && pr.x < lp.x && pr.x + pr.w > lp.x && pr.x + pr.w <= pr.vw - 404,
    `The pill is right above the cursor and aligned with it (${pr ? Math.round(lp.y - pr.y - pr.h) : '-'} px above), outside the right panel, a single instance (${pr?.n})`,
  )
  // When the camera pans, the pill moves with the item
  await p.evaluate(() => window.__homescape.cameraPan(1.5, 0))
  await p.waitForTimeout(1100)
  const lp2 = await p.evaluate(([x, z]) => window.__homescape.project(x, 2.0, z), [lamp.x, lamp.z])
  const pr2 = await p.evaluate(() => {
    const r = document.querySelector('[data-quick]')?.getBoundingClientRect()
    return r ? { x: r.x + r.width / 2, y: r.y + r.height } : null
  })
  const moved = Math.hypot(lp2.x - lp.x, lp2.y - lp.y)
  ok(pr && pr2 && moved > 20 && Math.abs(pr2.x - (pr.x + pr.w / 2) - (lp2.x - lp.x)) < 30, `The pill moves with the item when the camera pans (item shifted ${moved.toFixed(0)} px, pill ${pr2 ? Math.abs(pr2.x - (pr.x + pr.w / 2)).toFixed(0) : '-'} px)`)
  await p.evaluate(() => window.__homescape.cameraPan(-1.5, 0))
  await p.waitForTimeout(1100)
  const it = L.items.find((i) => i.id === pillId)
  const before = it?.entityId ? (await entity(it.entityId))?.state : null
  const tb = await p.locator('[data-quick-toggle]').boundingBox({ timeout: 1500 }).catch(() => null)
  if (tb) {
    await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 3 })
    await p.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2)
  }
  await p.waitForTimeout(300)
  const after = it?.entityId ? (await entity(it.entityId))?.state : null
  ok(Boolean(pillId) && Boolean(tb) && before !== after, `Hovering a bound item shows the pill, the power button toggles it (${it?.kind}: ${before} -> ${after})`)
  await shot('quick')
  await p.mouse.move(5, 450)
}

// --- Quick pill and card: only one of them at a time (user feedback, 9 Oct 2026: "the status cards and the quick action
// buttons overlap, they open at the same time, and also when clicked"); quick actions by type ("the best it can do") ---
{
  const lamp = L.items.find((i) => i.kind === 'pendant' && i.entityId)
  await focus(roomAt(L, lamp.x, lamp.z).id)
  const lp = await p.evaluate(([x, z]) => window.__homescape.project(x, 2.0, z), [lamp.x, lamp.z])
  await p.mouse.move(5, 450)
  await p.mouse.move(lp.x, lp.y, { steps: 4 })
  await p.waitForTimeout(450)
  const hovered = await p.isVisible(`[data-quick="${lamp.id}"]`)
  await p.mouse.click(lp.x, lp.y)
  await p.waitForTimeout(500)
  const after = await p.evaluate((id) => ({
    sel: window.__homescape.getState().layout.selection?.id === id,
    pill: Boolean(document.querySelector('[data-quick]')),
    tag: Boolean(document.querySelector(`[data-selected-tag="${id}"]`)),
  }), lamp.id)
  const card = await p.isVisible('#side-panel [data-testid], #side-panel h2')
  ok(hovered && after.sel && !after.pill && !after.tag && card, `Hovering shows only the quick pill; clicking shows only the card on the right (pill ${after.pill}, status tag ${after.tag})`)
  await p.keyboard.press('Escape')
  await p.mouse.move(5, 450)
  await p.waitForTimeout(500)

  // Brightness slider on a light
  const wl = L.items.find((i) => i.kind === 'wallLight' && i.entityId?.startsWith('light.'))
  await p.evaluate((id) => window.__homescape.call('light', 'turn_on', { entity_id: id, brightness_pct: 40 }), wl.entityId)
  await focus(roomAt(L, wl.x, wl.z).id)
  const wp = await p.evaluate(([x, z]) => window.__homescape.project(x, 1.9, z), [wl.x, wl.z])
  await p.mouse.move(wp.x, wp.y, { steps: 4 })
  await p.waitForTimeout(450)
  const sl = await p.locator('[data-quick-slider]').boundingBox().catch(() => null)
  const b0 = (await entity(wl.entityId))?.attributes?.brightness
  if (sl) {
    await p.mouse.move(sl.x + sl.width * 0.3, sl.y + sl.height / 2, { steps: 4 })
    await p.mouse.down()
    await p.mouse.move(sl.x + sl.width * 0.85, sl.y + sl.height / 2, { steps: 6 })
    await p.mouse.up()
    await p.waitForTimeout(500)
  }
  const b1 = (await entity(wl.entityId))?.attributes?.brightness
  // Each tile counts on its own (when the tiles wrap, the empty end of the second row is free)
  const kpiFree = await p.evaluate(() => {
    const a = document.querySelector('[data-quick]')?.getBoundingClientRect()
    const tiles = [...(document.getElementById('kpi-tiles')?.children ?? [])].map((c) => c.getBoundingClientRect())
    return !a || tiles.every((k) => a.right < k.left || a.left > k.right || a.bottom < k.top || a.top > k.bottom)
  })
  ok(Boolean(sl) && b1 !== b0 && kpiFree, `Brightness slider on the pill of a light that is on (${b0} -> ${b1}); the pill does not overlap the info tiles at the top`)
  await p.mouse.move(5, 450)
  await p.waitForTimeout(500)

  // Target temperature -/+ on an air conditioner
  const ac = L.items.find((i) => i.kind === 'acUnit' && i.entityId?.startsWith('climate.'))
  const e0 = await entity(ac.entityId)
  await p.evaluate((e) => window.__homescape.setEntity({ ...e, state: 'cool', attributes: { ...e.attributes, temperature: 22, target_temp_step: 0.5, min_temp: 16, max_temp: 30, hvac_modes: ['off', 'cool', 'heat'] } }), e0)
  await focus(roomAt(L, ac.x, ac.z).id)
  const ap = await p.evaluate(([x, z]) => window.__homescape.project(x, 2.15, z), [ac.x, ac.z])
  await p.mouse.move(ap.x, ap.y, { steps: 4 })
  await p.waitForTimeout(450)
  const plus = await p.locator('[data-quick-plus]').boundingBox().catch(() => null)
  if (plus) {
    await p.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2, { steps: 5 })
    await p.mouse.click(plus.x + plus.width / 2, plus.y + plus.height / 2)
    await p.waitForTimeout(400)
  }
  const t1 = (await entity(ac.entityId))?.attributes?.temperature
  ok(Boolean(plus) && t1 === 22.5, `Target temperature -/+ on the pill of a running air conditioner (22 -> ${t1})`)
  await p.evaluate((e) => window.__homescape.setEntity(e), e0)
  await p.mouse.move(5, 450)
  await p.waitForTimeout(400)
}

// --- Dashboard: rooms card by card, the switch in a row toggles the device ---
{
  await p.click('button[role="tab"][aria-label="Dashboard"]')
  await p.waitForSelector('#dashboard')
  // Switching to the Dashboard is animated (user request, 9 Oct 2026): the background fades in, the cards rise one after another
  const enter = await p.evaluate(() => ({ root: document.getElementById('dashboard').className.includes('dash-in'), rise: document.querySelectorAll('#dashboard .dash-rise').length }))
  ok(enter.root && enter.rise >= 3, `Switching to the Dashboard is animated (background dash-in, ${enter.rise} pieces rise in sequence)`)
  await p.waitForTimeout(900)
  // Masonry: cards are added to the shortest column, the difference between the column bottoms is less than the tallest card (no gaps)
  const mason = await p.evaluate(() => {
    const m = document.querySelector('[data-masonry]')
    if (!m) return null
    const cols = [...m.children].map((c) => {
      const kids = [...c.children]
      return { bottom: kids.length ? kids[kids.length - 1].getBoundingClientRect().bottom : c.getBoundingClientRect().top, tallest: Math.max(0, ...kids.map((k) => k.getBoundingClientRect().height)) }
    })
    const bottoms = cols.map((c) => c.bottom)
    return { n: cols.length, spread: Math.max(...bottoms) - Math.min(...bottoms), tallest: Math.max(...cols.map((c) => c.tallest)) }
  })
  ok(Boolean(mason) && mason.n >= 2 && mason.spread <= mason.tallest + 1, `Dashboard cards are in a masonry layout (${mason?.n} columns, ${mason?.spread.toFixed(0)} px between the bottoms, tallest card ${mason?.tallest.toFixed(0)} px)`)
  const cards = await p.locator('[data-dash-room]').count()
  const row = p.locator('[data-dash-row^="light."] button[role="switch"]').first()
  const id = await row.evaluate((el) => el.closest('[data-dash-row]').dataset.dashRow)
  const s0 = (await entity(id)).state
  await row.click()
  await p.waitForTimeout(200)
  const s1 = (await entity(id)).state
  const over = await p.evaluate(() => document.getElementById('dashboard').scrollWidth - document.getElementById('dashboard').clientWidth)
  ok(cards === L.rooms.length && s0 !== s1 && over <= 0, `Dashboard: ${cards} room cards (plan ${L.rooms.length}), the light switch works (${s0} -> ${s1}), no sideways overflow`)
  await shot('dashboard')
  await p.click('button[role="tab"][aria-label="View"]')
  await p.waitForTimeout(60)
  const leaving = await p.evaluate(() => document.getElementById('dashboard')?.className.includes('dash-out') ?? false)
  await p.waitForTimeout(400)
  const gone = await p.evaluate(() => !document.getElementById('dashboard'))
  ok(leaving && gone, `Leaving the Dashboard it fades out, then is removed (fading ${leaving}, removed ${gone})`)
}

// --- Quick search (⌘K): finds the item, Enter selects it ---
{
  await p.keyboard.press('Meta+k')
  await p.waitForSelector('#search-palette')
  await p.fill('#search-palette', 'floor lamp')
  await p.waitForTimeout(150)
  const hits = await p.locator('[data-search-hit]').count()
  await p.keyboard.press('Enter')
  await p.waitForTimeout(300)
  const sel = (await store()).selection
  const picked = sel?.type === 'item' ? (await level()).items.find((i) => i.id === sel.id) : null
  ok(hits >= 1 && picked?.kind === 'floorLamp', `⌘K search finds "floor lamp", Enter selects it (${hits} results, ${picked?.kind})`)
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Edit: item search and outdoor rooms ---
{
  await p.evaluate(() => window.__homescape.setMode('edit'))
  await p.waitForTimeout(600)
  await p.fill('#build-search', 'sofa')
  await p.waitForTimeout(150)
  const sofaCard = await p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Sofa"))').count()
  await p.fill('#build-search', 'qqqzz')
  await p.waitForTimeout(150)
  const none = await p.isVisible('text=No items found for')
  await p.fill('#build-search', '')
  await p.click('nav[aria-label="Build bar"] button:has-text("Rooms")')
  const outdoor = []
  for (const name of ['Garage', 'Balcony', 'Terrace', 'Garden']) if (await p.locator(`nav[aria-label="Build bar"] button:has(span:text-is("${name}"))`).count()) outdoor.push(name)
  ok(sofaCard >= 1 && none && outdoor.length === 4, `Search in the build bar ("sofa" is found, a notice for a missing item) and the ready-made outdoor rooms (${outdoor.join(', ')})`)

  // A balcony next to an indoor room: that edge of the room is an exterior wall, the balcony has no railing on its edge facing the house wall
  const walls = await p.evaluate(async () => {
    const g = await import('/src/model/geometry.ts')
    const A = { id: 'a', name: 'A', floor: 'wood', x: 0, z: 0, w: 4, d: 4 }
    const B = { id: 'b', name: 'B', floor: 'deck', x: 0, z: 4, w: 4, d: 1.5, type: 'balcony' }
    const front = g.wallRuns(A, [A, B]).find((r) => r.side === 'front')
    return { exterior: front && !front.interior, rails: g.wallRuns(B, [A, B]).map((r) => r.side).sort().join(), house: g.wallRuns(B, [A, B], 'house').map((r) => r.side).join() }
  })
  ok(walls.exterior && walls.rails === 'front,left,right' && walls.house === 'back', `The room edge next to the balcony is an exterior wall; the balcony railings are on the edges facing the void (${walls.rails}), the house wall is at the back (${walls.house})`)
}

// --- Floors: add a floor above (rooms are copied), the lower floor shows below, go back ---
{
  const ground = await level()
  await p.click('#floor-switcher')
  await p.click('#floor-add-up')
  await p.waitForTimeout(500)
  const s = await store()
  const up = s.layout.levels.find((l) => l.id === s.levelId)
  const calls0 = (await p.evaluate(() => window.__homescape.perf())).calls
  ok(s.layout.levels.length === 2 && up.elevation === 1 && up.rooms.length === ground.rooms.filter((r) => r.type !== 'garden').length && up.items.length === 0, `Floor added above: floor 1, ${up.rooms.length} rooms copied, no items`)
  await shot('floor')
  await p.click('#floor-switcher')
  await p.click(`[data-level="Ground floor"]`)
  await p.waitForTimeout(400)
  ok((await level()).id === ground.id, 'The floor menu returns to the ground floor')
  await p.evaluate((id) => window.__homescape.getState().layout.deleteLevel(id), up.id)
  await p.waitForTimeout(300)
  ok((await store()).layout.levels.length === 1 && calls0 > 0, 'The added floor was deleted')
}

// --- Homes: new home (empty plan), return to the old home (the plan comes back), delete ---
{
  /** Waits until the flight between homes ends (scene/HomeFlight.tsx) */
  const flightDone = async (runs) => {
    for (let k = 0; k < 80; k++) {
      const f = await p.evaluate(() => window.__homescape.homeFlight())
      if (f.stage === 'idle' && f.runs > runs) return f
      await p.waitForTimeout(100)
    }
    return p.evaluate(() => window.__homescape.homeFlight())
  }
  const before = (await level()).items.length
  const runs0 = (await p.evaluate(() => window.__homescape.homeFlight())).runs
  await p.click('#home-switcher')
  await p.click('#home-add')
  await p.keyboard.press('Meta+a')
  await p.keyboard.type('Cottage')
  await p.keyboard.press('Enter')
  await flightDone(runs0)
  let s = await store()
  const cottage = s.homes.find((h) => h.name === 'Cottage')
  ok(s.homes.length === 2 && s.homeId === cottage?.id && (await level()).rooms.length === 0, `New home "Cottage" opened with an empty plan (${s.homes.length} homes)`)
  await p.waitForTimeout(400)
  // Flight between homes (user request, 9 Oct 2026: "the camera should go up from that home and focus; we should not
  // see that home until the switch"): the camera rises and glides sideways, the home changes when the old home is out of frame, then it descends to the new home
  const runs1 = (await p.evaluate(() => window.__homescape.homeFlight())).runs
  const d0 = (await p.evaluate(() => window.__homescape.camera())).distance
  await p.click('#home-switcher')
  await p.click('[data-home="My home"]')
  const samples = []
  for (let k = 0; k < 80; k++) {
    // Stage, camera and home are read at the same time (the import that reads the stage can take a frame)
    const [f, cam, home] = await p.evaluate(() => window.__homescape.homeFlight().then((f) => [f, window.__homescape.camera(), window.__homescape.getState().layout.homeId]))
    samples.push({ stage: f.stage, d: cam.distance, home })
    if (f.stage === 'idle' && f.runs > runs1) break
    await p.waitForTimeout(60)
  }
  const f = await p.evaluate(() => window.__homescape.homeFlight())
  const out = samples.filter((q) => q.stage === 'out')
  const landed = samples.filter((q) => q.stage === 'in')
  const maxD = Math.max(...samples.map((q) => q.d))
  ok(out.length > 3 && out.every((q) => q.home === cottage.id) && landed.length > 3 && landed.every((q) => q.home !== cottage.id), `The home does not change at takeoff, the new home is not in the scene (${out.length} frames in the old home), at landing it is the new home (${landed.length} frames)`)
  ok(maxD > d0 * 1.3 && f.last.peakD > d0 * 1.3, `The camera rises (from ${d0.toFixed(1)} m to ${maxD.toFixed(1)} m)`)
  ok(f.last.oldInView === false && f.last.newInView === false && f.last.dir === -1, `At the moment the home changes both homes are out of frame (old ${f.last.oldInView}, new ${f.last.newInView}), it flies left to the previous home (${f.last.dir})`)
  const end = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const L = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
    return { want: window.__homescape.framePose(L.rooms, 0.4), cam: window.__homescape.camera() }
  })
  const wantD = Math.hypot(...end.want.position.map((v, i) => v - end.want.target[i]))
  const off = Math.hypot(end.cam.target[0] - end.want.target[0], end.cam.target[2] - end.want.target[2])
  ok(f.stage === 'idle' && off < 0.3 && Math.abs(end.cam.distance - wantD) < wantD * 0.03, `The camera descends to the usual framing of the home (target offset ${off.toFixed(2)} m, distance ${end.cam.distance.toFixed(1)}/${wantD.toFixed(1)} m), flight ${(f.last.totalMs / 1000).toFixed(1)} s`)
  s = await store()
  ok((await level()).items.length === before && s.homes.find((h) => h.id === s.homeId)?.name === 'My home', `The home menu returns to the first home, its plan comes back (${before} items)`)
  await p.evaluate((id) => window.__homescape.getState().layout.deleteHome(id), cottage.id)
  ok((await store()).homes.length === 1, 'The second home was deleted')
  await p.evaluate(() => window.__homescape.setMode('view'))
  await p.waitForTimeout(500)
}

// --- First-person walk: walking, wall collision, exit ---
{
  L = await level()
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.waitForTimeout(500)
  const room = L.rooms.find((r) => /living/i.test(r.name)) ?? L.rooms[0]
  const cx = room.x + room.w / 2
  const cz = room.z + room.d / 2
  await p.evaluate(([x, z]) => window.__homescape.fpsTeleport(x, z, Math.PI / 2), [cx, cz])
  await p.waitForTimeout(300)
  const a = await p.evaluate(() => window.__homescape.fps())
  await p.keyboard.down('KeyW')
  await p.waitForTimeout(700)
  await p.keyboard.up('KeyW')
  await p.waitForTimeout(200)
  const c = await p.evaluate(() => window.__homescape.fps())
  ok(Math.hypot(c.x - a.x, c.z - a.z) > 0.6, `Walking with W in the walk mode (${Math.hypot(c.x - a.x, c.z - a.z).toFixed(2)} m)`)
  await shot('fps')
  // Wall: a point outside the back wall of the room is pushed to the inner side of the wall
  const pushed = await p.evaluate(async (r) => {
    const f = await import('/src/scene/fps.ts')
    const s = window.__homescape.getState().layout
    const lv = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
    const { segs, boxes } = f.buildColliders(lv)
    // 5 cm outside the back wall (a place without a door: of 10 points along the wall, the one that does not fall on a door opening)
    for (let i = 1; i < 10; i++) {
      const x = r.x + (r.w * i) / 10
      const [nx, nz] = f.resolve(x, r.z + 0.1, segs, boxes)
      if (nz > r.z + 0.25) return { x: nx, z: nz, wall: r.z }
    }
    return null
  }, room)
  ok(Boolean(pushed), `The wall cannot be crossed: a point very close to the wall is pushed into the room (${pushed ? (pushed.z - pushed.wall).toFixed(2) : '-'} m)`)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(800)
  ok(!(await p.isVisible('#fps-hud')) && (await p.evaluate(() => window.__homescape.camera())) !== null, 'Esc leaves the walk mode, the orbit camera comes back')
}

// --- Stairs: in the first-person walk you go to the upper floor by walking up the stairs ---
{
  L = await level()
  const room = L.rooms.find((r) => /living/i.test(r.name)) ?? L.rooms[0]
  const st = await p.evaluate((r) => {
    const s = window.__homescape.getState().layout
    const ground = s.levelId
    const up = s.addLevel({ copyRooms: true })
    s.setLevel(ground)
    // The stairs are on the left side of the room, the lower end at +z (they go up toward -z)
    const x = r.x + 0.9
    const z = r.z + r.d / 2
    const id = s.addItem('stairs', x, z, 0)
    s.select(null)
    return { up, ground, id, x, z }
  }, room)
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.evaluate(([x, z]) => window.__homescape.fpsTeleport(x, z + 1.75, 0), [st.x, st.z])
  await p.waitForTimeout(300)
  await p.keyboard.down('KeyW')
  await p.waitForTimeout(2600)
  await p.keyboard.up('KeyW')
  await p.waitForTimeout(400)
  const s1 = await store()
  const f1 = await p.evaluate(() => window.__homescape.fps())
  ok(s1.levelId === st.up, `Walking up the stairs reaches the upper floor (floor: ${s1.layout.levels.find((l) => l.id === s1.levelId)?.name}, foot ${f1.h.toFixed(2)} m)`)
  await shot('stairs')
  // Back down: walk down from the upper end of the stairs
  await p.evaluate(([x, z]) => window.__homescape.fpsTeleport(x, z - 1.75, Math.PI), [st.x, st.z])
  await p.waitForTimeout(300)
  await p.keyboard.down('KeyW')
  await p.waitForTimeout(2600)
  await p.keyboard.up('KeyW')
  await p.waitForTimeout(400)
  ok((await store()).levelId === st.ground, 'Walking down the stairs from the upper floor reaches the lower floor')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)
  await p.evaluate((st) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(st.id)
    s.deleteLevel(st.up)
  }, st)
}

// --- Sun in the walk mode: comes at its real angle, the ceiling blocks it, it enters through the window; the plan bearing and the curtain affect it ---
{
  // Brightness of points on screen (6x6 average): the screenshot is decoded in the page
  const lum = async (pts) => {
    const png = await p.screenshot()
    return p.evaluate(
      async ({ b64, pts }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        return pts.map(([x, y]) => {
          const d = g.getImageData(Math.round(x) - 3, Math.round(y) - 3, 6, 6).data
          let s = 0
          for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
          return s / (d.length / 4)
        })
      },
      { b64: png.toString('base64'), pts },
    )
  }
  const sun0 = await entity('sun.sun')
  // A room with a window on the south wall (+z); the sun is due south, 60° high (the shadow of the south wall covers only the southern
  // half of the room: without a ceiling the floor in the northern half would get sun)
  const t = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setEntity({ entity_id: 'sun.sun', state: 'above_horizon', attributes: { friendly_name: 'Sun', elevation: 60, azimuth: 180 } })
    const room = s.addRoom({ name: 'Sun room', floor: 'wood', x: 140, z: 0, w: 4, d: 4 })
    return { room, win: s.addItem('window', 142, 4 - 0.21, Math.PI) }
  })
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.evaluate(() => window.__homescape.fpsTeleport(142, 0.25, Math.PI, -0.45))
  await p.waitForTimeout(1600)
  const li = await p.evaluate(() => window.__homescape.lighting())
  const near = (v, w) => v.every((x, i) => Math.abs(x - w[i]) < 0.02)
  ok(li.fps === 1 && li.indoor === 1 && near(li.sunDir, [0, 0.866, 0.5]) && li.hemiI < 1, `In the walk mode the sun comes from the angle set in HA (south, 60°: ${li.sunDir.map((n) => n.toFixed(2)).join(', ')}), the ambient light indoors is dim (${li.hemiI.toFixed(2)})`)
  // The sun enters through the window at 60°: the patch on the floor is level with the window, 0.5-1.2 m inside from the wall (z 2.8-3.5). The
  // northern half of the room (z 1.4) is outside the shadow of the south wall: only the ceiling blocks the sun there
  const sunny = await p.evaluate(() => window.__homescape.project(142.0, 0.01, 3.15))
  const shade = await p.evaluate(() => window.__homescape.project(142.0, 0.01, 1.4))
  const [a, c] = await lum([
    [sunny.x, sunny.y],
    [shade.x, shade.y],
  ])
  await shot('sun')
  ok(a > c * 1.3, `The sun enters through the window, not through the ceiling: the window patch is brighter than the floor under the ceiling (${a.toFixed(0)} / ${c.toFixed(0)})`)
  // No light leaks at the corners (user feedback): where the north wall facing the sun meets the ceiling and the corner where two walls meet
  // are as dark as the middle of the wall (there used to be a bright, jagged line where the thin ceiling met the wall)
  // The sun is from the southwest: the ray to the west corner of the north wall must pass through the west wall (be cut off)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'sun.sun', state: 'above_horizon', attributes: { friendly_name: 'Sun', elevation: 30, azimuth: 230 } }))
  await p.evaluate(() => window.__homescape.fpsTeleport(142, 2.6, 0.35, 0.32))
  await p.waitForTimeout(1200)
  // Ceiling edge: a few points 3-5 cm below the ceiling (2.6 m) (the brightest one; with the old thin ceiling the jagged leak was in exactly this band)
  const seam = await p.evaluate(() => [window.__homescape.project(141.2, 1.7, 0.06), window.__homescape.project(140.06, 1.7, 0.05), window.__homescape.project(140.5, 1.7, 0.06), ...[141, 141.6, 142.2].flatMap((x) => [2.55, 2.57].map((y) => window.__homescape.project(x, y, 0.06)))])
  const [mid, corner, wall, ...tops] = await lum(seam.map((q) => [q.x, q.y]))
  const top = Math.max(...tops)
  await shot('sun-corner')
  ok(top < mid * 1.12 && corner < wall * 1.12, `No light leaks where the ceiling meets the wall or where two walls meet (ceiling edge ${top.toFixed(0)} / wall ${mid.toFixed(0)}, corner ${corner.toFixed(0)} / wall ${wall.toFixed(0)})`)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'sun.sun', state: 'above_horizon', attributes: { friendly_name: 'Sun', elevation: 60, azimuth: 180 } }))
  await p.evaluate(() => window.__homescape.fpsTeleport(142, 0.25, Math.PI, -0.45))
  await p.waitForTimeout(600)
  // No unlit line where the two parts of the L corridor join (user feedback): the floor at the join is as bright as both sides
  const lr = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setEntity({ entity_id: 'light.t_corridor', state: 'on', attributes: { friendly_name: 'Corridor', brightness: 255 } })
    const room = s.addRoom({ name: 'L corridor', floor: 'wood', x: 150, z: 0, w: 4, d: 2 })
    s.addPart(room, { x: 150, z: 2, w: 2, d: 3 })
    return { room, lamp: s.addItem('pendant', 151, 1, 0, 'light.t_corridor') }
  })
  await p.evaluate(() => window.__homescape.fpsTeleport(151, 0.6, Math.PI, -0.5))
  await p.waitForTimeout(1200)
  const lpts = await p.evaluate(() => [1.85, 2.0, 2.15].map((z) => window.__homescape.project(151, 0.01, z)))
  const [before, seamL, after] = await lum(lpts.map((q) => [q.x, q.y]))
  await shot('l-corridor')
  ok(seamL > Math.min(before, after) * 0.94, `No unlit line where the L corridor joins (before ${before.toFixed(0)}, join ${seamL.toFixed(0)}, after ${after.toFixed(0)})`)
  await p.evaluate((lr) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(lr.lamp)
    s.deleteRoom(lr.room)
  }, lr)
  await p.evaluate(() => window.__homescape.fpsTeleport(142, 0.25, Math.PI, -0.45))
  await p.waitForTimeout(400)
  const dayOf = async () => (await p.evaluate(() => window.__homescape.roomLights())).filter((l) => l.type === 4 && l.pos[0] > 139)
  const d0 = await dayOf()
  // When the curtain closes, the daylight coming through the window decreases
  await p.evaluate((win) => {
    window.__homescape.setEntity({ entity_id: 'cover.t_sun_curtain', state: 'closed', attributes: { friendly_name: 'Curtain', current_position: 0, device_class: 'curtain' } })
    window.__homescape.getState().layout.bind(win, 'cover.t_sun_curtain')
  }, t.win)
  await p.waitForTimeout(300)
  const d1 = await dayOf()
  ok(d0.length === 1 && d1.length === 1 && d1[0].energy < d0[0].energy / 4, `The window gives the room daylight, it decreases when the curtain closes (${d0[0]?.energy} -> ${d1[0]?.energy})`)
  // The top of the plan is east: the sun from the south comes from the right (+x) in the plan
  await p.evaluate(() => window.__homescape.getState().layout.setBearing(90))
  await p.waitForTimeout(1200)
  const li2 = await p.evaluate(() => window.__homescape.lighting())
  ok(near(li2.sunDir, [0.5, 0.866, 0]), `When the plan bearing changes the sun comes from the other side of the home (${li2.sunDir.map((n) => n.toFixed(2)).join(', ')})`)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(600)
  await p.evaluate(
    ({ room, sun0 }) => {
      const s = window.__homescape.getState().layout
      s.setBearing(0)
      s.deleteRoom(room)
      if (sun0) window.__homescape.setEntity(sun0)
    },
    { room: t.room, sun0 },
  )
}

// --- Garage: the garage door opens a gap in the wall, a car is parked in the garage ---
{
  const r = await p.evaluate(async () => {
    const s = window.__homescape.getState().layout
    const rules = await import('/src/model/rules.ts')
    const g = await import('/src/model/geometry.ts')
    const id = s.addRoom({ name: 'Garage', floor: 'concrete', x: 120, z: 0, w: 3.5, d: 6, type: 'garage' })
    const lv = () => {
      const st = window.__homescape.getState().layout
      return st.layout.levels.find((l) => l.id === st.levelId) ?? st.layout.levels[0]
    }
    // Garage door on the front wall (local +z faces the room: rot π on the front wall), the car inside
    const door = s.addItem('garageDoor', 121.75, 6 - 0.21, Math.PI)
    const car = rules.checkItem(lv(), { kind: 'car', x: 121.75, z: 2.9, rot: Math.PI })
    const room = lv().rooms.find((q) => q.id === id)
    const front = g.wallRuns(room, lv().rooms).find((q) => q.side === 'front')
    const gap = g.runOpenings(front, lv().items).find((o) => o.a1 - o.a0 > 2)
    s.deleteRoom(id)
    return { car: car.ok, reason: car.reason, gap: gap ? [gap.a0, gap.a1, gap.y1] : null, door: Boolean(door) }
  })
  ok(r.car && r.gap && Math.abs(r.gap[1] - r.gap[0] - 2.4) < 0.01, `A car can be parked in the garage (${r.reason ?? 'ok'}), the garage door opens a 2.4 m gap in the front wall (${r.gap?.map((n) => n.toFixed(2)).join(', ')})`)
}

// --- Touch: one tap on a bound item toggles it ---
{
  const ctx = await b.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false, locale: 'en-US' })
  const t = await ctx.newPage()
  t.on('pageerror', (e) => errors.push(e.message))
  await t.goto('http://localhost:5190/')
  await t.waitForSelector('body[data-ready="1"]')
  await t.waitForTimeout(1200)
  const TL = await t.evaluate(() => window.__homescape.getState().layout.layout.levels[0])
  const lamp = TL.items.find((i) => i.kind === 'pendant' && i.entityId)
  await t.evaluate((id) => window.__homescape.focusRoom(id), roomAt(TL, lamp.x, lamp.z).id)
  await t.waitForTimeout(1700)
  const lp = await t.evaluate(([x, z]) => window.__homescape.project(x, 2.0, z), [lamp.x, lamp.z])
  const states0 = await t.evaluate(() => Object.fromEntries(window.__homescape.entityIds().map((id) => [id, window.__homescape.entity(id).state])))
  await t.touchscreen.tap(lp.x, lp.y)
  await t.waitForTimeout(400)
  const pill = await t.locator('[data-quick]').getAttribute('data-quick', { timeout: 1500 }).catch(() => null)
  const changed = await t.evaluate((s0) => window.__homescape.entityIds().filter((id) => window.__homescape.entity(id).state !== s0[id]), states0)
  if (!pill) console.log('   touch: changed entities', changed.join(', ') || 'none', '| selection', JSON.stringify(await t.evaluate(() => window.__homescape.getState().layout.selection)))
  const item = TL.items.find((i) => i.id === pill)
  const tapped = item?.entityId ? await t.evaluate((id) => window.__homescape.entity(id), item.entityId) : null
  const details = await t.isVisible('[data-quick] >> text=Details')
  ok(Boolean(item) && details && (await t.evaluate(() => window.__homescape.getState().layout.selection)) === null && tapped && tapped.state !== states0[item.entityId], `On touch a single tap toggles the item, the pill stays with "Details" (${item?.kind}: ${states0[item?.entityId]} -> ${tapped?.state})`)
  // A tap also counts when the finger slides a few pixels while touching (on iPad a tap was counted as a drag and did not toggle)
  {
    await t.touchscreen.tap(40, 520)
    await t.waitForTimeout(400)
    const before = (await t.evaluate((id) => window.__homescape.entity(id), item.entityId))?.state
    const cdp = await ctx.newCDPSession(t)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lp.x, y: lp.y }] })
    await t.waitForTimeout(50)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lp.x + 6, y: lp.y + 5 }] })
    await t.waitForTimeout(50)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await t.waitForTimeout(500)
    const now = (await t.evaluate((id) => window.__homescape.entity(id), item.entityId))?.state
    ok(now !== before && (await t.isVisible('[data-quick]')), `On touch the tap toggles the item even if the finger slides 8 px (${before} -> ${now})`)
    // back to the first state
    await t.touchscreen.tap(lp.x, lp.y)
    await t.waitForTimeout(400)
  }
  // Finger-sized button; tapping the button in the pill toggles again, the pill stays; tapping an empty spot closes it
  const btn = await t.locator('[data-quick-toggle]').boundingBox().catch(() => null)
  if (btn) await t.touchscreen.tap(btn.x + btn.width / 2, btn.y + btn.height / 2)
  await t.waitForTimeout(400)
  const again = item?.entityId ? (await t.evaluate((id) => window.__homescape.entity(id), item.entityId))?.state : null
  const stays = await t.isVisible('[data-quick]')
  await t.touchscreen.tap(40, 520)
  await t.waitForTimeout(400)
  const gone = !(await t.isVisible('[data-quick]').catch(() => false))
  ok(btn && btn.width >= 44 && btn.height >= 44 && again === states0[item?.entityId] && stays && gone, `On touch the pill button is finger-sized (${btn?.width}x${btn?.height} px), tapping it toggles (${tapped?.state} -> ${again}), tapping an empty spot closes the pill (${gone})`)
  // On iPad, WebKit can report the click that comes from a finger tap as "mouse": the tap still toggles, it does not select (user
  // feedback, 9 Oct 2026: "the quick actions never show up in the live home, it selects the item directly")
  {
    const ictx = await b.newContext({ viewport: { width: 1180, height: 760 }, hasTouch: true, locale: 'en-US' })
    await ictx.addInitScript(() => {
      const d = Object.getOwnPropertyDescriptor(PointerEvent.prototype, 'pointerType')
      Object.defineProperty(PointerEvent.prototype, 'pointerType', {
        get() {
          const v = d.get.call(this)
          return this.type === 'click' ? 'mouse' : v
        },
      })
    })
    const w = await ictx.newPage()
    w.on('pageerror', (e) => errors.push(e.message))
    await w.goto('http://localhost:5190/')
    await w.waitForSelector('body[data-ready="1"]')
    await w.waitForTimeout(1200)
    await w.evaluate((id) => window.__homescape.focusRoom(id), roomAt(TL, lamp.x, lamp.z).id)
    await w.waitForTimeout(1700)
    const wp = await w.evaluate(([x, z]) => window.__homescape.project(x, 2.0, z), [lamp.x, lamp.z])
    const w0 = (await w.evaluate((id) => window.__homescape.entity(id), lamp.entityId))?.state
    await w.touchscreen.tap(wp.x, wp.y)
    await w.waitForTimeout(500)
    const w1 = (await w.evaluate((id) => window.__homescape.entity(id), lamp.entityId))?.state
    const wsel = await w.evaluate(() => window.__homescape.getState().layout.selection)
    ok(w1 !== w0 && wsel === null && (await w.isVisible('[data-quick]')), `Even if the click is reported as "mouse" like on iPad, the tap toggles, the pill shows, nothing is selected (${w0} -> ${w1})`)
    // On a cabinet bound to a light (under-counter LED) a tap does not open the doors, it opens the pill: the LED and the doors are controlled from there
    // (user feedback, 9 Oct 2026: "when I press the counter cabinet its doors open directly, how will I turn on the under-counter LED")
    const WL = await w.evaluate(() => window.__homescape.getState().layout.layout.levels[0])
    const counter = WL.items.find((i) => i.kind === 'kitchenCounter')
    const led = WL.items.find((i) => i.kind === 'wallLight' && i.entityId?.startsWith('light.'))?.entityId
    await w.evaluate(([id, e]) => window.__homescape.getState().layout.updateItem(id, { entityId: e, led: 'cabinet' }), [counter.id, led])
    await w.evaluate((id) => window.__homescape.focusRoom(id), roomAt(WL, counter.x, counter.z).id)
    await w.waitForTimeout(1700)
    const cp = await w.evaluate(([x, z]) => window.__homescape.project(x, 0.5, z), [counter.x, counter.z])
    await w.touchscreen.tap(cp.x, cp.y)
    await w.waitForTimeout(500)
    const doors0 = (await w.evaluate(() => window.__homescape.bins()))[counter.id] ?? false
    const hasDoors = await w.isVisible('[data-quick-doors]')
    const l0 = (await w.evaluate((id) => window.__homescape.entity(id), led))?.state
    const pw = await w.locator('[data-quick-toggle]').boundingBox().catch(() => null)
    if (pw) await w.touchscreen.tap(pw.x + pw.width / 2, pw.y + pw.height / 2)
    await w.waitForTimeout(400)
    const l1 = (await w.evaluate((id) => window.__homescape.entity(id), led))?.state
    const dr = await w.locator('[data-quick-doors]').boundingBox().catch(() => null)
    if (dr) await w.touchscreen.tap(dr.x + dr.width / 2, dr.y + dr.height / 2)
    await w.waitForTimeout(400)
    const doors1 = (await w.evaluate(() => window.__homescape.bins()))[counter.id] ?? false
    ok(!doors0 && hasDoors && l1 !== l0 && doors1, `Tapping a counter bound to a light does not open the doors, the pill shows: LED (${l0} -> ${l1}) and doors (opened ${doors1}) on the pill`)
    await ictx.close()
  }
  await ctx.close()
}

// --- Tablet: the panel on the right narrows and widens, closes and opens; in portrait the card at the bottom grows and shrinks; the top bar fits
// (user request, 9 Oct 2026: "they do not fit the screen on a tablet, I should be able to shrink and enlarge the area on the right, close and open it")
{
  // Identity of Chrome on iPad (iPadOS asks for the desktop site: it looks like a Macintosh and has touch)
  const ipadUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1'
  const ctx = await b.newContext({ viewport: { width: 1180, height: 760 }, hasTouch: true, userAgent: ipadUA, locale: 'en-US' })
  const t = await ctx.newPage()
  t.on('pageerror', (e) => errors.push(e.message))
  await t.goto('http://localhost:5190/')
  await t.waitForSelector('body[data-ready="1"]')
  await t.waitForTimeout(1800)
  const box = () =>
    t.evaluate(() => {
      const r = document.querySelector('#side-panel').getBoundingClientRect()
      const m = document.querySelector('#panel-toggle').closest('.pointer-events-auto').getBoundingClientRect()
      return { left: r.left, w: r.width, mapRight: window.innerWidth - m.right, open: document.querySelector('#side-panel').dataset.open }
    })
  const b0 = await box()
  const g = await t.locator('#panel-resize').boundingBox()
  await t.mouse.move(g.x + g.width / 2, g.y + 160)
  await t.mouse.down()
  await t.mouse.move(g.x + g.width / 2 + 90, g.y + 160, { steps: 6 })
  await t.mouse.up()
  await t.waitForTimeout(600)
  const b1 = await box()
  ok(Math.abs(b0.w - 380) < 2 && Math.abs(b1.w - 290) < 3 && Math.abs(b1.mapRight - b1.w - 28) < 3, `Dragging the panel edge narrows it (${Math.round(b0.w)} -> ${Math.round(b1.w)} px), the tool column moves with it`)
  const off0 = await t.evaluate(() => window.__homescape.camera())
  await t.click('#panel-toggle')
  await t.waitForTimeout(700)
  const b2 = await box()
  const off1 = await t.evaluate(() => window.__homescape.camera())
  ok(b2.open === '0' && b2.left >= 1180 && Math.abs(b2.mapRight - 16) < 2 && Math.abs(off1.distance - off0.distance) < 0.5, `The panel closes (off screen), the tool column moves to the edge, the camera distance does not change`)
  await t.keyboard.press('p')
  await t.waitForTimeout(600)
  await t.reload()
  await t.waitForSelector('body[data-ready="1"]')
  await t.waitForTimeout(1200)
  const b3 = await box()
  ok(b3.open === '1' && Math.abs(b3.w - 290) < 3, `P opens the panel; the width is remembered after a reload (${Math.round(b3.w)} px)`)
  // On iPad (iPadOS desktop identity + touch) the fullscreen button opens the "Add to Home Screen" guide: the operating system does not hide
  // the clock bar and the X button in fullscreen (user feedback, 9 Oct 2026)
  await t.tap('#fullscreen-toggle')
  await t.waitForTimeout(300)
  const guide = await t.isVisible('#home-screen-guide')
  const full = await t.evaluate(() => Boolean(document.fullscreenElement))
  if (guide) await t.tap('#home-screen-guide >> text=Got it')
  ok(guide && !full, `On iPad the fullscreen button opens the add-to-home-screen guide (guide ${guide}, fullscreen ${full})`)
  await ctx.close()

  const ctx2 = await b.newContext({ viewport: { width: 820, height: 1100 }, hasTouch: true, locale: 'en-US' })
  const v = await ctx2.newPage()
  v.on('pageerror', (e) => errors.push(e.message))
  await v.goto('http://localhost:5190/')
  await v.waitForSelector('body[data-ready="1"]')
  await v.waitForTimeout(1800)
  const over = await v.evaluate(() => [...document.querySelectorAll('header *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length)
  const sheet = () => v.evaluate(() => document.querySelector('#side-panel').getBoundingClientRect().height)
  const h0 = await sheet()
  const sg = await v.locator('#sheet-resize').boundingBox()
  await v.mouse.move(sg.x + sg.width / 2, sg.y + sg.height / 2)
  await v.mouse.down()
  await v.mouse.move(sg.x + sg.width / 2, sg.y + sg.height / 2 + 240, { steps: 6 })
  await v.mouse.up()
  await v.waitForTimeout(400)
  const h1 = await sheet()
  await v.tap('#panel-close-sheet')
  await v.waitForTimeout(500)
  const closed = (await v.evaluate(() => document.querySelector('#side-panel').dataset.open)) === '0' && (await v.isVisible('#panel-open-sheet'))
  await v.tap('#panel-open-sheet')
  await v.waitForTimeout(500)
  const reopened = (await v.evaluate(() => document.querySelector('#side-panel').dataset.open)) === '1'
  ok(over === 0 && h1 < h0 - 150 && closed && reopened, `In portrait on a tablet the top bar fits (overflowing ${over}), the card at the bottom shrinks with the handle (${Math.round(h0)} -> ${Math.round(h1)} px), it closes and opens with the "Panel" button`)
  await ctx2.close()

  // The storage of an app opened from the home screen is separate from the browser: with no connection (demo) the connection dialog opens on the first
  // launch and says why, and does not open again once closed; there is no fullscreen button (user feedback, 9 Oct 2026: "after adding it to the
  // home screen the Home Assistant connection was gone, it opened an empty demo")
  const ctx3 = await b.newContext({ viewport: { width: 1180, height: 760 }, hasTouch: true, locale: 'en-US' })
  await ctx3.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
  const a = await ctx3.newPage()
  a.on('pageerror', (e) => errors.push(e.message))
  await a.goto('http://localhost:5190/')
  await a.waitForSelector('body[data-ready="1"]')
  await a.waitForTimeout(800)
  const asked = await a.isVisible('#standalone-welcome')
  const noFs = !(await a.isVisible('#fullscreen-toggle'))
  await a.click('[role="dialog"][aria-label="Home Assistant connection"] button[title="Close"]').catch(() => {})
  await a.reload()
  await a.waitForSelector('body[data-ready="1"]')
  await a.waitForTimeout(600)
  const again = await a.isVisible('#standalone-welcome')
  ok(asked && noFs && !again, `In the home screen app with no connection the connection dialog opens by itself with its explanation (${asked}), does not reopen once closed, no fullscreen button`)
  await ctx3.close()
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
