// Doors and Home Assistant binding regression test (real mouse/keyboard).
// `npm run dev` must be running first. Run: npm run check:home  (both at once: npm run check)
// Intermediate screenshots: shots/home-*.png
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1500)

const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const level = () => p.evaluate(() => window.__homescape.getState().layout.layout.levels[0])
const placement = () => p.evaluate(() => window.__homescape.placement())
const project = (x, z) => p.evaluate(([x, z]) => window.__homescape.project(x, 0, z), [x, z])
const bindings = (i) => [i.entityId, ...(i.extras ?? [])].filter(Boolean)
const roomAt = (L, x, z) => L.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d)
const doorRooms = (L, d) => {
  const fx = Math.sin(d.rot)
  const fz = Math.cos(d.rot)
  return [roomAt(L, d.x, d.z), roomAt(L, d.x - fx * 0.51, d.z - fz * 0.51)]
}
/** Number of separate room groups when walking through doors (1 = every room is reachable). */
const components = (L) => {
  const parent = new Map(L.rooms.map((r) => [r.id, r.id]))
  const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)))
  for (const d of L.items.filter((i) => i.kind === 'door')) {
    const [a, c] = doorRooms(L, d)
    if (a && c && a.id !== c.id) parent.set(find(a.id), find(c.id))
  }
  return new Set(L.rooms.map((r) => find(r.id))).size
}

// --- Doors ---
let L = await level()
const doors = L.items.filter((i) => i.kind === 'door')
ok(components(L) === 1, `Every room is reachable through a door in the automatic plan (${L.rooms.length} rooms, ${doors.length} doors)`)
ok(doors.some((d) => !doorRooms(L, d)[1]), 'There is an outer (entrance) door')
const bathAsHub = doors.filter((d) => {
  const [front, back] = doorRooms(L, d)
  return back && /bath/i.test(back.name) && front && !/bath/i.test(front.name)
})
ok(bathAsHub.length === 0, 'No room is entered by passing through the bathroom')
{
  // The light behind the TV is not a separate strip: in the automatic plan it is bound to the TV as an extra entity, backlight on
  const tv0 = L.items.find((i) => i.kind === 'tv')
  const nearStrip = L.items.some((i) => i.kind === 'ledStrip' && Math.hypot(i.x - tv0.x, i.z - tv0.z) < 0.6)
  ok(tv0.led === 'back' && (tv0.extras ?? []).some((id) => id.startsWith('light.')) && !nearStrip, `TV backlight is bound to the TV (${(tv0.extras ?? []).join(', ')}), no separate strip behind it`)
}

await p.evaluate(() => window.__homescape.setMode('edit'))
await p.waitForTimeout(1800)

// Drag an armchair in front of the door: red, and the reason mentions the doorway
const inner = doors.find((d) => doorRooms(L, d)[1] && /office/i.test(doorRooms(L, d)[0]?.name ?? '')) ?? doors.find((d) => doorRooms(L, d)[1])
const front = await project(inner.x + Math.sin(inner.rot) * 0.55, inner.z + Math.cos(inner.rot) * 0.55)
const card = p.locator('nav[aria-label="Build bar"] button:has-text("Armchair")').first()
const box = await card.boundingBox()
const before = L.items.length
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await p.mouse.down()
await p.mouse.move(front.x, front.y, { steps: 14 })
await p.waitForTimeout(400)
const pl = await placement()
ok(pl.result?.ok === false && /doorway/i.test(pl.result.reason ?? ''), `Nothing can be placed in front of a door (reason: ${pl.result?.reason})`)
await p.screenshot({ path: 'shots/home-door-front.png' })
await p.mouse.up()
await p.waitForTimeout(400)
ok((await level()).items.length === before, 'The item dropped in front of the door was not added')

// Delete an inner door, then complete it with the toolbar button
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), inner.id)
await p.keyboard.press('Delete')
await p.waitForTimeout(300)
ok(components(await level()) > 1, 'Deleting the inner door made a room unreachable')
await p.click('button[title^="Complete the inner doors"]')
await p.waitForTimeout(400)
L = await level()
ok(components(L) === 1, 'Complete the inner doors: every room is reachable again')
await p.screenshot({ path: 'shots/home-doors.png' })

// --- Opening direction: the hinge and which room the door opens into ---
ok(L.items.filter((i) => i.kind === 'door' && doorRooms(L, i)[1]).every((d) => d.hinge === 'left' || d.hinge === 'right'), 'Automatic inner doors have the hinge on the corner side')
const dr = L.items.find((i) => i.kind === 'door' && doorRooms(L, i)[1])
const [frontRoom, backRoom] = doorRooms(L, dr)
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), dr.id)
await p.waitForTimeout(400)
ok(await p.isVisible('text=Opening direction'), 'Selecting a door shows the "Opening direction" section')
ok(await p.isVisible(`aside button:has-text("${backRoom.name}")`), `Inner door has direction buttons with room names (${frontRoom.name} / ${backRoom.name})`)
const hingeBefore = dr.hinge ?? 'left'
await p.click(`aside button:has-text("${hingeBefore === 'left' ? 'Right' : 'Left'}")`)
await p.click(`aside button:has-text("${backRoom.name}")`)
await p.waitForTimeout(300)
let dd = (await level()).items.find((i) => i.id === dr.id)
ok(dd.hinge !== hingeBefore && dd.swing === 'out', `Hinge moved to the ${dd.hinge === 'right' ? 'right' : 'left'}, the door opens toward ${backRoom.name}`)
await p.screenshot({ path: 'shots/home-door-direction.png' })

// The clearance area flipped too: nothing can be placed in front of the door in the neighboring room now
await p.evaluate(() => window.__homescape.select(null))
const behind = await project(dd.x - Math.sin(dd.rot) * 0.95, dd.z - Math.cos(dd.rot) * 0.95)
const card3 = p.locator('nav[aria-label="Build bar"] button:has-text("Armchair")').first()
const b3 = await card3.boundingBox()
await p.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2)
await p.mouse.down()
await p.mouse.move(behind.x, behind.y, { steps: 14 })
await p.waitForTimeout(400)
const pl3 = await placement()
ok(pl3.result?.ok === false && /doorway/i.test(pl3.result.reason ?? ''), `The front of an outward-opening door (neighboring room) must stay clear (reason: ${pl3.result?.reason})`)
await p.keyboard.press('Escape')
await p.mouse.up()
await p.waitForTimeout(300)

// "Flip the opening direction" in the bubble cycles through the directions
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), dr.id)
await p.waitForTimeout(400)
const seen = new Set()
for (let i = 0; i < 4; i++) {
  await p.click('button[title="Flip the opening direction"]')
  await p.waitForTimeout(150)
  const it2 = (await level()).items.find((x) => x.id === dr.id)
  seen.add(`${it2.hinge ?? 'left'}-${it2.swing ?? 'in'}`)
}
ok(seen.size === 4, `The flip button cycles through all four directions (${[...seen].join(', ')})`)
await p.evaluate(() => window.__homescape.select(null))

// --- Bindings: bind any entity you like to furniture ---
const sofa = L.items.find((i) => i.kind === 'sofa')
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), sofa.id)
await p.waitForTimeout(400)
ok(await p.isVisible('text=Home Assistant bindings'), 'Furniture (sofa) has a bindings section too')
const search = p.locator(`#q-${sofa.id}`)
ok(await search.isVisible(), 'The picker opens by default on an item with no bound entity')
await search.fill('temperature')
await p.waitForTimeout(200)
const first = p.locator('[data-testid="entity-list"] [data-entity]').first()
const tempId = await first.getAttribute('data-entity')
await first.click()
await p.waitForTimeout(200)
let it = (await level()).items.find((i) => i.id === sofa.id)
ok(it.entityId === tempId, `The first bound entity becomes the main one (${tempId})`)
await search.fill('humidity')
await p.waitForTimeout(200)
const humRow = p.locator('[data-testid="entity-list"] [data-entity]').first()
const humId = await humRow.getAttribute('data-entity')
await humRow.click()
await p.waitForTimeout(200)
it = (await level()).items.find((i) => i.id === sofa.id)
ok(it.extras?.includes(humId), `The second bound entity becomes an extra (${humId})`)
await p.screenshot({ path: 'shots/home-binding-picker.png' })
await p.click('button:has-text("Done")')
await p.click('button[title^="Make main"]')
await p.waitForTimeout(200)
it = (await level()).items.find((i) => i.id === sofa.id)
ok(it.entityId === humId && it.extras?.includes(tempId), 'The star makes an extra the main one, the old main one becomes an extra')

await p.evaluate(() => window.__homescape.setMode('view'))
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), sofa.id)
await p.waitForTimeout(500)
const card2 = await p.locator('aside').innerText()
ok(/Temperature/.test(card2), 'The view card shows a tile for the extra entity (Temperature)')
await p.screenshot({ path: 'shots/home-binding-card.png' })

await p.evaluate(() => window.__homescape.setMode('edit'))
await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), sofa.id)
await p.waitForTimeout(300)
await p.locator('button[title="Remove binding"]').first().click()
await p.waitForTimeout(200)
it = (await level()).items.find((i) => i.id === sofa.id)
ok(it.entityId === tempId && !(it.extras ?? []).length, 'Removing the main one makes the first extra the main one')

// --- L, T, U shaped rooms: ready-made L hallway, adding a part, moving together ---
await p.evaluate(() => {
  window.__homescape.setMode('edit')
  window.__homescape.select(null)
})
await p.waitForTimeout(600)
L = await level()
{
  const xs = L.rooms.flatMap((r) => [r.x, r.x + r.w, ...(r.parts ?? []).flatMap((q) => [q.x, q.x + q.w])])
  const zs = L.rooms.flatMap((r) => [r.z, r.z + r.d, ...(r.parts ?? []).flatMap((q) => [q.z, q.z + q.d])])
  const bbx = { minX: Math.min(...xs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }
  await p.click('nav[aria-label="Build bar"] button:has-text("Rooms")')
  const lc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("L hallway"))').first()
  const lb = await lc.boundingBox()
  const spot2 = await project((bbx.minX + bbx.maxX) / 2 - 1, bbx.maxZ + 2.6)
  await p.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
  await p.mouse.down()
  await p.mouse.move(spot2.x, spot2.y, { steps: 12 })
  await p.waitForTimeout(250)
  const r0 = (await placement()).result
  await p.keyboard.press('r')
  await p.waitForTimeout(300)
  const r1 = (await placement()).result
  ok(r1?.ok === true && Math.abs(r1.rot - r0.rot - Math.PI / 2) < 1e-6, 'L hallway ghost is green, R rotates it by 90°')
  await p.mouse.up()
  await p.waitForTimeout(500)
}
L = await level()
const hall = L.rooms.find((r) => r.parts?.length)
ok(Boolean(hall) && hall.name === 'Hallway' && hall.parts.length === 1, 'L hallway was added as one room with two parts')
const allRects = (rm) => [{ x: rm.x, z: rm.z, w: rm.w, d: rm.d }, ...(rm.parts ?? [])]
const roomsOverlap = (Lv) => {
  let n = 0
  for (let i = 0; i < Lv.rooms.length; i++)
    for (let j = i + 1; j < Lv.rooms.length; j++)
      for (const a of allRects(Lv.rooms[i]))
        for (const c of allRects(Lv.rooms[j]))
          if (Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 0.01 && Math.min(a.z + a.d, c.z + c.d) - Math.max(a.z, c.z) > 0.01) n++
  return n
}
ok(roomsOverlap(L) === 0, 'L hallway does not overlap any room')

// Items may sit across the joint: a plant at the corner where the two parts meet
{
  const [m, q] = allRects(hall)
  // Middle of the edge the parts share (one is next to the other)
  const jx = Math.abs(m.x - (q.x + q.w)) < 0.01 ? m.x : Math.abs(m.x + m.w - q.x) < 0.01 ? m.x + m.w : null
  const jz = Math.abs(m.z - (q.z + q.d)) < 0.01 ? m.z : Math.abs(m.z + m.d - q.z) < 0.01 ? m.z + m.d : null
  const px = jx ?? (Math.max(m.x, q.x) + Math.min(m.x + m.w, q.x + q.w)) / 2
  const pz = jz ?? (Math.max(m.z, q.z) + Math.min(m.z + m.d, q.z + q.d)) / 2
  await p.click('nav[aria-label="Build bar"] button:has-text("Furniture")')
  const pc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Potted plant"))').first()
  await pc.scrollIntoViewIfNeeded()
  const pb = await pc.boundingBox()
  const jp = await project(px, pz)
  await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
  await p.mouse.down()
  await p.mouse.move(jp.x, jp.y, { steps: 12 })
  await p.waitForTimeout(300)
  const pr = (await placement()).result
  ok(pr?.ok === true, `No wall where the parts join: an item can be placed across the joint (${pr?.reason ?? 'fits'})`)
  await p.mouse.up()
  await p.waitForTimeout(400)
}
await p.screenshot({ path: 'shots/home-l-hallway.png' })

// Add a part to an existing room (outward from the Entrance), then move the room: the parts come along
L = await level()
const entr = L.rooms.find((r) => r.name === 'Entrance')
await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), entr.id)
await p.waitForTimeout(400)
await p.click('aside button:has-text("Add a part")')
await p.waitForTimeout(200)
const ea = await project(entr.x + entr.w - 0.1, entr.z + 0.5)
const eb = await project(entr.x + entr.w + 1.5, entr.z + 2.0)
await p.mouse.move(ea.x, ea.y)
await p.mouse.down()
await p.mouse.move(eb.x, eb.y, { steps: 12 })
await p.mouse.up()
await p.waitForTimeout(500)
L = await level()
const entr2 = L.rooms.find((r) => r.id === entr.id)
ok(entr2.parts?.length === 1 && roomsOverlap(L) === 0, `A part was added to Entrance (${entr2.parts?.[0]?.w} × ${entr2.parts?.[0]?.d} m), no overlap`)
await p.keyboard.press('ArrowLeft')
await p.waitForTimeout(200)
L = await level()
const entr3 = L.rooms.find((r) => r.id === entr.id)
// The left arrow may hit a neighbor, so instead of undo check that the part and the main rectangle slide together.
ok(Math.abs(entr3.x - entr2.x - (entr3.parts[0].x - entr2.parts[0].x)) < 1e-6, 'When the room moves its parts slide by the same amount')
await p.keyboard.press('Meta+z')
await p.keyboard.press('Meta+z')
await p.waitForTimeout(300)
ok(!(await level()).rooms.find((r) => r.id === entr.id).parts?.length, '⌘Z undoes adding the part')
// Remove the hallway placed apart from the house in the test (so it does not break the later "every room is reachable" check).
await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), hall.id)
await p.waitForTimeout(300)
await p.keyboard.press('Delete')
await p.waitForTimeout(300)
await p.evaluate(() => window.__homescape.select(null))

// --- Delete a room with everything in it: its items, its doors and the doors opening into it go; ⌘Z brings them back ---
{
  const inRect = (r, x, z) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d
  const inRm = (rm, x, z) => allRects(rm).some((r) => inRect(r, x, z))
  const orphans = (Lv) => Lv.items.filter((it) => !Lv.rooms.some((rm) => inRm(rm, it.x, it.z))).length
  L = await level()
  const bath = L.rooms.find((r) => /bath/i.test(r.name))
  const insideBath = L.items.filter((it) => inRm(bath, it.x, it.z) && !L.rooms.some((o) => o.id !== bath.id && inRm(o, it.x, it.z)))
  const intoBath = L.items.filter((it) => it.kind === 'door' && doorRooms(L, it)[1]?.id === bath.id && doorRooms(L, it)[0]?.id !== bath.id)
  const before = { rooms: L.rooms.length, items: L.items.length }
  ok(orphans(L) === 0, 'No item is without a room before deleting')
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), bath.id)
  await p.waitForTimeout(300)
  await p.keyboard.press('Delete')
  await p.waitForTimeout(400)
  L = await level()
  ok(!L.rooms.some((r) => r.id === bath.id) && L.items.length === before.items - insideBath.length - intoBath.length,
    `Delete: ${bath.name} deleted with its ${insideBath.length} items and the ${intoBath.length} doors opening into it`)
  ok(orphans(L) === 0, 'No item is left hanging in the void after deleting')
  ok(/deleted/.test((await placement()).notice ?? ''), 'The number of deleted items is announced')
  await p.keyboard.press('Meta+z')
  await p.waitForTimeout(300)
  L = await level()
  ok(L.rooms.length === before.rooms && L.items.length === before.items, '⌘Z brings back the room and its contents in one step')

  // A door opening into this room from a neighbor goes too (e.g. the Entrance door in the Kitchen), and the neighbor's wall closes
  const entrance = L.rooms.find((r) => r.name === 'Entrance')
  const into = L.items.filter((it) => it.kind === 'door' && doorRooms(L, it)[1]?.id === entrance.id && doorRooms(L, it)[0]?.id !== entrance.id)
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), entrance.id)
  await p.waitForTimeout(300)
  await p.keyboard.press('Delete')
  await p.waitForTimeout(400)
  const afterGir = await level()
  ok(into.length > 0 && into.every((d) => !afterGir.items.some((it) => it.id === d.id)), `The ${into.length} doors opening into Entrance from neighbors were deleted too`)
  await p.keyboard.press('Meta+z')
  await p.waitForTimeout(300)

  // With the button: the first click asks for confirmation, the second deletes
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), bath.id)
  await p.waitForTimeout(300)
  ok(await p.isVisible(`aside button:has-text("The ${insideBath.length + intoBath.length} item")`), 'The delete button says how many items will go')
  await p.click('aside button:has-text("Delete the room with everything in it")')
  await p.waitForTimeout(200)
  ok((await level()).rooms.some((r) => r.id === bath.id) && (await p.isVisible('aside button:has-text("Are you sure")')), 'The first click does not delete, it asks for confirmation')
  await p.click('aside button:has-text("Are you sure")')
  await p.waitForTimeout(300)
  ok(!(await level()).rooms.some((r) => r.id === bath.id), 'The second click deletes the room with everything in it')
  await p.keyboard.press('Meta+z')
  await p.waitForTimeout(300)
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Select an area and bulk delete ---
{
  await p.evaluate(() => {
    window.__homescape.setMode('edit')
    window.__homescape.select(null)
  })
  await p.waitForTimeout(400)
  L = await level()
  const bath = L.rooms.find((r) => /bath/i.test(r.name))
  const before = { rooms: L.rooms.length, items: L.items.length }
  await p.click('button[title^="Select an area"]')
  await p.waitForTimeout(200)
  const c0 = await project(bath.x - 0.05, bath.z - 0.05)
  const c1 = await project(bath.x + bath.w + 0.05, bath.z + bath.d + 0.05)
  await p.mouse.move(c0.x, c0.y)
  await p.mouse.down()
  await p.mouse.move(c1.x, c1.y, { steps: 12 })
  await p.mouse.up()
  await p.waitForTimeout(400)
  const multi = await p.evaluate(() => window.__homescape.getState().layout.multi)
  ok(multi?.rooms.includes(bath.id) && multi.items.length > 0, `Select an area: ${bath.name} and ${multi?.items.length} items selected`)
  ok(await p.isVisible('text=/\\d+ (rooms?|items?) selected/'), 'The selection bar shows how many rooms and items are selected')
  await p.screenshot({ path: 'shots/home-area-select.png' })
  await p.keyboard.press('Delete')
  await p.waitForTimeout(400)
  L = await level()
  ok(!L.rooms.some((r) => r.id === bath.id) && L.items.length < before.items && !(await p.evaluate(() => window.__homescape.getState().layout.multi)), 'Delete: the selected area was deleted in bulk')
  await p.keyboard.press('Meta+z')
  await p.waitForTimeout(300)
  L = await level()
  ok(L.rooms.length === before.rooms && L.items.length === before.items, '⌘Z undoes the bulk delete in one step')
}

// --- Work desk: length, drawers, color; desktop items; aquarium ---
{
  L = await level()
  const desk = L.items.find((i) => i.kind === 'desk')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), desk.id)
  await p.waitForTimeout(300)
  await p.locator(`#len-${desk.id}`).evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    // Shorter than the default 1.4 m: in the sample home a fan stands next to the desk, a longer desk would hit it
    set.call(el, '1.2')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await p.click('aside button:has-text("On the left")')
  await p.click('aside button[title="Light oak"] >> nth=0')
  await p.click('aside button[title="White"] >> nth=1')
  await p.waitForTimeout(300)
  const d2 = (await level()).items.find((i) => i.id === desk.id)
  ok(d2.len === 1.2 && d2.drawers === 'left' && d2.top === '#dcb98c' && d2.body === '#ffffff', 'Desk: length 1.2 m, drawers on the left, oak top, white body')
  await p.evaluate(() => window.__homescape.select(null))
  const card4 = async (label) => {
    await p.click('nav[aria-label="Build bar"] button:has-text("Desk and decor")')
    const c = p.locator(`nav[aria-label="Build bar"] button:has(span:text-is("${label}"))`).first()
    await c.scrollIntoViewIfNeeded()
    return c.boundingBox()
  }
  const kb = await card4('Keyboard')
  const onDesk = await project(d2.x + Math.sin(d2.rot) * 0.15, d2.z + Math.cos(d2.rot) * 0.15)
  await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await p.mouse.down()
  const room0 = L.rooms.find((r) => r.id === L.rooms.find((rr) => d2.x >= rr.x && d2.x <= rr.x + rr.w && d2.z >= rr.z && d2.z <= rr.z + rr.d)?.id)
  const floorPt = await project(room0.x + room0.w / 2, room0.z + room0.d - 0.6)
  await p.mouse.move(floorPt.x, floorPt.y, { steps: 8 })
  await p.waitForTimeout(250)
  const rFloor = (await placement()).result
  await p.mouse.move(onDesk.x, onDesk.y, { steps: 8 })
  await p.waitForTimeout(250)
  const rDesk = (await placement()).result
  await p.mouse.up()
  await p.waitForTimeout(300)
  ok(rFloor?.ok === false && /desk/i.test(rFloor.reason ?? '') && rDesk?.ok === true && rDesk.y === 0.75, 'The keyboard cannot go on the floor, it goes on top of the desk (0.75 m)')

  // Aquarium: place it somewhere empty, feed it in view mode
  L = await level()
  const kit = L.rooms.find((r) => /kitchen/i.test(r.name))
  const ab = await card4('Aquarium')
  await p.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2)
  await p.mouse.down()
  for (const [fx, fz] of [[0.82, 0.35], [0.18, 0.35], [0.82, 0.45], [0.7, 0.25]]) {
    const t = await project(kit.x + kit.w * fx, kit.z + kit.d * fz)
    await p.mouse.move(t.x, t.y, { steps: 5 })
    await p.waitForTimeout(150)
    if ((await placement()).result?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(400)
  const aq = (await level()).items.find((i) => i.kind === 'aquarium')
  ok(Boolean(aq), 'Aquarium placed')
  if (aq) {
    await p.evaluate(() => window.__homescape.setMode('view'))
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), aq.id)
    await p.waitForTimeout(400)
    await p.click('aside button:has-text("Feed")')
    await p.waitForTimeout(300)
    const fed = (await level()).items.find((i) => i.id === aq.id).fedAt
    ok(Boolean(fed) && Date.now() - Date.parse(fed) < 10000 && (await p.isVisible('text=Last fed: just now')), 'Feed: the last feeding was saved and shows on the card')
    await p.evaluate(() => window.__homescape.setMode('edit'))
  }
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Items follow when a room grows and shrinks ---
{
  await p.evaluate(() => {
    window.__homescape.setMode('edit')
    window.__homescape.select(null)
  })
  await p.waitForTimeout(300)
  L = await level()
  const entrance = L.rooms.find((r) => r.name === 'Entrance')
  const frontDoor = L.items.find((i) => i.kind === 'door' && !doorRooms(L, i)[1] && i.z > entrance.z + entrance.d - 0.5 && i.x > entrance.x && i.x < entrance.x + entrance.w)
  const far = L.items.filter((i) => i.x > entrance.x && i.x < entrance.x + entrance.w && i.z > entrance.z && i.z < entrance.z + 1.2 && i.kind !== 'door')
  await p.evaluate((id) => window.__homescape.select({ type: 'room', id }), entrance.id)
  await p.waitForTimeout(300)
  await p.fill(`#d-${entrance.id}`, String(entrance.d + 0.5))
  await p.waitForTimeout(300)
  L = await level()
  const fd2 = L.items.find((i) => i.id === frontDoor.id)
  ok(Math.abs(fd2.z - frontDoor.z - 0.5) < 1e-6, 'When Entrance gets 50 cm deeper the door on the front wall moves 50 cm too')
  ok(far.every((f) => L.items.find((i) => i.id === f.id).z === f.z), 'Items at the back stayed in place')
  await p.fill(`#d-${entrance.id}`, String(entrance.d - 1.5))
  await p.waitForTimeout(300)
  L = await level()
  const g2 = L.rooms.find((r) => r.id === entrance.id)
  const outside = L.items.filter((i) => i.x > g2.x && i.x < g2.x + g2.w && i.z > g2.z + g2.d)
  ok(outside.length === 0, 'When the room shrinks no item stays outside, they are pushed in')
  await p.keyboard.press('Meta+z')
  await p.keyboard.press('Meta+z')
  await p.waitForTimeout(300)
  ok((await level()).rooms.find((r) => r.id === entrance.id).d === entrance.d, '⌘Z undoes the size and the items')
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Inner walls full height / low button ---
{
  const before = await p.evaluate(() => localStorage.getItem('homescape-inner-walls') ?? 'full')
  await p.click('button[title^="Inner walls"]')
  await p.waitForTimeout(200)
  const after = await p.evaluate(() => localStorage.getItem('homescape-inner-walls'))
  ok(before === 'full' && after === 'low', 'Inner walls are full height by default; the button makes them low (sketch)')
  await p.click('button[title^="Inner walls"]')
  await p.waitForTimeout(200)
}

// --- Shower cabin shape and the small round aquarium ---
{
  L = await level()
  const bath2 = L.rooms.find((r) => /bath/i.test(r.name))
  await p.click('nav[aria-label="Build bar"] button:has-text("Bathroom")')
  const sc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Shower cabin"))').first()
  await sc.scrollIntoViewIfNeeded()
  const sb = await sc.boundingBox()
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await p.mouse.down()
  for (const [x, z] of [[bath2.x + 0.5, bath2.z + bath2.d - 0.5], [bath2.x + bath2.w - 0.5, bath2.z + bath2.d - 0.5], [bath2.x + 0.5, bath2.z + bath2.d * 0.6]]) {
    const t = await project(x, z)
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(150)
    if ((await placement()).result?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(400)
  const sh = (await level()).items.find((i) => i.kind === 'shower')
  ok(Boolean(sh), 'Shower cabin placed in the bathroom')
  if (sh) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), sh.id)
    await p.waitForTimeout(300)
    await p.click('aside button:has-text("Round")')
    await p.click('aside button:has-text("Right wall")')
    await p.waitForTimeout(200)
    const sh2 = (await level()).items.find((i) => i.id === sh.id)
    ok(sh2.shape === 'round' && sh2.hinge === 'right', 'Shower cabin can be made round with the right corner')
    await p.evaluate(() => window.__homescape.select(null))
  }
  await p.click('nav[aria-label="Build bar"] button:has-text("Desk and decor")')
  const fc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Fishbowl"))').first()
  await fc.scrollIntoViewIfNeeded()
  const fb = await fc.boundingBox()
  const dk = (await level()).items.find((i) => i.kind === 'desk')
  await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
  await p.mouse.down()
  const fl = await project(bath2.x + bath2.w / 2, bath2.z + bath2.d / 2)
  await p.mouse.move(fl.x, fl.y, { steps: 6 })
  await p.waitForTimeout(200)
  const onFloor = (await placement()).result
  const onDk = await project(dk.x, dk.z)
  await p.mouse.move(onDk.x, onDk.y, { steps: 6 })
  await p.waitForTimeout(200)
  const onDesk2 = (await placement()).result
  await p.mouse.up()
  await p.waitForTimeout(300)
  ok(onFloor?.ok === false && onDesk2?.ok === true && onDesk2.y === 0.75, 'The fishbowl cannot go on the floor, it goes on the desk')
}

// --- Dresser with mirror: stands against the wall, takes a color, a lamp goes on top ---
{
  L = await level()
  const bedr = L.rooms.find((r) => /bedroom/i.test(r.name))
  await p.click('nav[aria-label="Build bar"] button:has-text("Furniture")')
  const dc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Dresser with mirror"))').first()
  await dc.scrollIntoViewIfNeeded()
  const db = await dc.boundingBox()
  await p.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
  await p.mouse.down()
  for (const [fx, fz] of [[0.5, 0.95], [0.85, 0.95], [0.97, 0.5], [0.15, 0.95]]) {
    const t = await project(bedr.x + bedr.w * fx, bedr.z + bedr.d * fz)
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(150)
    if ((await placement()).result?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(400)
  const drs = (await level()).items.find((i) => i.kind === 'dresser')
  ok(Boolean(drs), 'Dresser with mirror placed in the bedroom against the wall')
  if (drs) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), drs.id)
    await p.waitForTimeout(300)
    await p.click('aside button[title="Walnut"] >> nth=0')
    await p.waitForTimeout(200)
    ok((await level()).items.find((i) => i.id === drs.id).top === '#8a5a3b', 'The dresser top color can be chosen')
    await p.evaluate(() => window.__homescape.select(null))
    await p.click('nav[aria-label="Build bar"] button:has-text("Lights")')
    const lc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Desk lamp"))').first()
    const lb = await lc.boundingBox()
    const tp = await project(drs.x + 0.3 * Math.cos(drs.rot), drs.z - 0.3 * Math.sin(drs.rot))
    await p.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
    await p.mouse.down()
    await p.mouse.move(tp.x, tp.y, { steps: 8 })
    await p.waitForTimeout(250)
    const lr = (await placement()).result
    await p.mouse.up()
    await p.waitForTimeout(300)
    ok(lr?.ok === true && lr.y === 0.81, 'A lamp goes on top of the dresser (0.81 m)')
  }
}

// --- Stacking appliances, soap dispenser, oven and mirror types ---
{
  const putCard = async (tab, label, pts) => {
    await p.click(`nav[aria-label="Build bar"] button:has-text("${tab}")`)
    const c = p.locator(`nav[aria-label="Build bar"] button:has(span:text-is("${label}"))`).first()
    await c.scrollIntoViewIfNeeded()
    const bb = await c.boundingBox()
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await p.mouse.down()
    let r = null
    for (const [x, z] of pts) {
      const t = await project(x, z)
      await p.mouse.move(t.x, t.y, { steps: 6 })
      await p.waitForTimeout(160)
      r = (await placement()).result
      if (r?.ok) break
    }
    await p.mouse.up()
    await p.waitForTimeout(350)
    return r
  }
  L = await level()
  const kit2 = L.rooms.find((r) => /kitchen/i.test(r.name))
  const spots = [[kit2.x + kit2.w - 0.35, kit2.z + kit2.d * 0.55], [kit2.x + kit2.w - 0.35, kit2.z + kit2.d * 0.75], [kit2.x + 0.35, kit2.z + kit2.d * 0.75]]
  const w1 = await putCard('Kitchen and appliances', 'Washing machine', spots)
  const d1 = await putCard('Kitchen and appliances', 'Dryer', [[w1.x, w1.z]])
  ok(w1?.ok && d1?.ok && d1.y === 0.86, 'The dryer goes on top of the washing machine (0.86 m)')
  const basin2 = (await level()).items.find((i) => i.kind === 'washbasin')
  const rFloor = await putCard('Bathroom', 'Soap dispenser', [[kit2.x + kit2.w / 2, kit2.z + kit2.d / 2]])
  ok(rFloor?.ok === false, 'The soap dispenser cannot go on the floor')
  const rBasin = await putCard('Bathroom', 'Soap dispenser', [[basin2.x + 0.2 * Math.cos(basin2.rot), basin2.z - 0.2 * Math.sin(basin2.rot)]])
  ok(rBasin?.ok === true && rBasin.y === 0.8, 'The soap dispenser goes on top of the washbasin (0.8 m)')
  const oven = await putCard('Kitchen and appliances', 'Oven', [[kit2.x + 0.35, kit2.z + kit2.d * 0.45], [kit2.x + 0.35, kit2.z + kit2.d * 0.6], [kit2.x + kit2.w * 0.4, kit2.z + kit2.d - 0.35]])
  const ov = (await level()).items.find((i) => i.kind === 'oven')
  if (oven?.ok && ov) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ov.id)
    await p.waitForTimeout(300)
    await p.click('aside button:has-text("Tall unit")')
    await p.waitForTimeout(200)
  }
  ok((await level()).items.find((i) => i.kind === 'oven')?.variant === 'tall', 'The oven can be made a tall unit (eye level)')
  await p.evaluate(() => window.__homescape.select(null))
  const bedr2 = L.rooms.find((r) => /bedroom/i.test(r.name))
  const mr = await putCard('Desk and decor', 'Mirror', [[bedr2.x + bedr2.w - 0.15, bedr2.z + bedr2.d * 0.3], [bedr2.x + 0.15, bedr2.z + bedr2.d * 0.85], [bedr2.x + bedr2.w * 0.3, bedr2.z + bedr2.d - 0.15]])
  const mi = (await level()).items.find((i) => i.kind === 'mirror')
  if (mr?.ok && mi) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), mi.id)
    await p.waitForTimeout(300)
    await p.click('aside button:has-text("Small round")')
    await p.waitForTimeout(200)
  }
  ok((await level()).items.find((i) => i.kind === 'mirror')?.variant === 'small', 'The mirror is placed on the wall and can be made small round')
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Water dispenser and the TV backlight option ---
{
  L = await level()
  const kits = L.rooms.find((r) => /kitchen/i.test(r.name))
  await p.click('nav[aria-label="Build bar"] button:has-text("Kitchen and appliances")')
  const wc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Water dispenser"))').first()
  await wc.scrollIntoViewIfNeeded()
  const wb = await wc.boundingBox()
  await p.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
  await p.mouse.down()
  let wr = null
  for (const [fx, fz] of [[0.97, 0.4], [0.03, 0.4], [0.97, 0.25], [0.5, 0.97], [0.03, 0.85]]) {
    const t = await project(kits.x + kits.w * fx, kits.z + kits.d * fz)
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(160)
    wr = (await placement()).result
    if (wr?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(350)
  const wd = (await level()).items.find((i) => i.kind === 'waterDispenser')
  ok(wr?.ok && Boolean(wd), 'The water dispenser is placed on the kitchen wall')
  if (wd) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), wd.id)
    await p.waitForTimeout(300)
    await p.click('aside button:has-text("At the bottom (in the cabinet)")')
    await p.waitForTimeout(200)
    ok((await level()).items.find((i) => i.id === wd.id).variant === 'bottom', 'The water dispenser bottle can be moved to the bottom (in the cabinet)')
  }
  const tv1 = (await level()).items.find((i) => i.kind === 'tv')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), tv1.id)
  await p.waitForTimeout(300)
  ok(await p.isVisible('aside >> text=TV backlight'), 'The TV card has a "TV backlight" option')
  await p.click('aside button:text-is("None")')
  await p.waitForTimeout(150)
  const offLed = (await level()).items.find((i) => i.id === tv1.id).led
  await p.click('aside button:text-is("Yes")')
  await p.waitForTimeout(150)
  ok(offLed === 'none' && (await level()).items.find((i) => i.id === tv1.id).led === 'back', 'The TV backlight can be turned off and on')
  // The backlight entity is chosen separately from the TV: the chosen one becomes an extra entity and its row says "Backlight"; it goes away when set back to automatic
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.test_back', state: 'on', attributes: { friendly_name: 'Test back light', brightness: 255 } }))
  await p.waitForTimeout(200)
  await p.click(`#ledent-${tv1.id}`)
  await p.waitForTimeout(150)
  // The picker stays inside the card (no sideways overflow) and its rows are easy to tap (at least 40 px)
  const fit = await p.evaluate((id) => {
    const body = document.querySelector('aside .panel-body')
    const rows = [...document.querySelectorAll('aside [data-ledent]')].map((r) => r.getBoundingClientRect().height)
    const btn = document.getElementById(`ledent-${id}`).getBoundingClientRect()
    return { over: body.scrollWidth - body.clientWidth, rows: rows.length, minRow: Math.min(...rows), btn: btn.height }
  }, tv1.id)
  ok(fit.over <= 0 && fit.rows > 1 && fit.minRow >= 40 && fit.btn >= 44, `The LED entity picker fits in the card and its rows are large (overflow ${fit.over} px, ${fit.rows} rows, shortest ${Math.round(fit.minRow)} px, button ${Math.round(fit.btn)} px)`)
  if (await p.isVisible(`#ledent-q-${tv1.id}`)) await p.fill(`#ledent-q-${tv1.id}`, 'test back')
  await p.click('aside [data-ledent="light.test_back"]')
  await p.waitForTimeout(200)
  const tvPicked = (await level()).items.find((i) => i.id === tv1.id)
  const rowText = await p.locator('aside').innerText()
  ok(tvPicked.ledEntity === 'light.test_back' && tvPicked.extras.includes('light.test_back') && tvPicked.entityId === tv1.entityId && /Backlight/.test(rowText), "The TV and its backlight are bound separately (the backlight entity is chosen on its own, the TV's own entity does not change)")
  await p.click(`#ledent-${tv1.id}`)
  await p.waitForTimeout(150)
  await p.click('aside [data-ledent=""]')
  await p.waitForTimeout(200)
  const tvAuto = (await level()).items.find((i) => i.id === tv1.id)
  ok(!tvAuto.ledEntity && !(tvAuto.extras ?? []).includes('light.test_back'), 'When the backlight goes back to automatic the chosen entity is unbound')
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Power strip: numbered outlets in one item; placed on a desk; outlet count 2-5 ---
{
  L = await level()
  const outletItems = L.items.filter((i) => bindings(i).some((id) => /(?:outlet|socket)_\d+$/.test(id)))
  const okGroup = outletItems.every((i) => {
    const ids = bindings(i)
    const nums = ids.map((id) => Number(id.match(/(\d+)$/)?.[1]))
    return i.kind === 'powerStrip' && nums.every((n, k) => k === 0 || n > nums[k - 1]) && i.variant === String([2, 3, 4, 5, 6, 8].find((k) => k >= ids.length) ?? 8)
  })
  ok(okGroup, `Numbered outlets are in a single power strip, in order (${outletItems.map((i) => `${i.variant} outlets: ${bindings(i).join(', ')}`).join(' | ') || 'no numbered outlet in this home'})`)
  const desk = L.items.find((i) => i.kind === 'desk')
  await p.click('nav[aria-label="Build bar"] button:has-text("Smart devices")')
  const sc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Power strip"))').first()
  await sc.scrollIntoViewIfNeeded()
  const sb = await sc.boundingBox()
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await p.mouse.down()
  let sr = null
  for (const [dx, dz] of [[0.45, -0.2], [-0.45, -0.2], [0.45, 0.15], [-0.45, 0.15], [0, -0.22]]) {
    const t = await project(desk.x + dx * Math.cos(desk.rot) + dz * Math.sin(desk.rot), desk.z - dx * Math.sin(desk.rot) + dz * Math.cos(desk.rot))
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(160)
    sr = (await placement()).result
    if (sr?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(350)
  ok(sr?.ok === true && sr.y === 0.75, `The power strip goes on top of the desk (${sr?.reason ?? sr?.y})`)
  const strip = (await level()).items.filter((i) => i.kind === 'powerStrip').at(-1)
  if (strip && sr?.ok) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), strip.id)
    await p.waitForTimeout(300)
    const def = await p.locator(`aside button:text-is("5 outlets")`).getAttribute('class')
    await p.click(`aside button:text-is("3 outlets")`)
    await p.waitForTimeout(200)
    const s2 = (await level()).items.find((i) => i.id === strip.id)
    ok(/bg-brand/.test(def ?? '') && s2.variant === '3' && s2.len === 0.29 && (await p.isVisible('aside >> text=binding order')), 'The power strip defaults to 5 outlets; choosing 3 outlets makes it 29 cm long')
    await p.evaluate(() => window.__homescape.select(null))
  }
}

// --- A power strip also hangs on the wall: card "Placement: Floor or table / On the wall", height setting, ready-made card dropped on a wall ---
{
  const ps = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('edit')
    const room = s.addRoom({ name: 'Outlet test', floor: 'wood', x: 50, z: 0, w: 4, d: 4 })
    return { room, strip: s.addItem('powerStrip', 52, 0.45, 0) }
  })
  const getIt = async (id) => (await level()).items.find((i) => i.id === id)
  await p.evaluate((id) => window.__homescape.focusRoom(id), ps.room)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ps.strip)
  await p.waitForTimeout(1500)
  await p.click('aside button:text-is("On the wall")')
  await p.waitForTimeout(250)
  const w1 = await getIt(ps.strip)
  ok(w1.mount === 'wall' && Math.abs(w1.z - 0.1) < 0.011 && Math.abs(w1.rot) < 1e-6 && w1.y == null && (await p.isVisible(`#mount-${ps.strip}`)), `With "On the wall" on the card the power strip hangs on the nearest wall and its height can be adjusted (z ${w1.z?.toFixed(3)})`)
  await p.keyboard.press('PageUp')
  await p.waitForTimeout(150)
  const w2 = await getIt(ps.strip)
  // On the wall: outlet counts 6 and 8, dragging moves it along the wall (the height handle does not interfere), arrow keys
  await p.click(`aside button:text-is("6 outlets")`)
  await p.waitForTimeout(150)
  const w6 = await getIt(ps.strip)
  const pa = await project(w6.x, w6.z)
  const from = await p.evaluate(([x, y, z]) => window.__homescape.project(x, y, z), [w6.x, 0.35, w6.z])
  const to = await p.evaluate(([x, y, z]) => window.__homescape.project(x, y, z), [w6.x + 0.8, 0.35, w6.z])
  await p.mouse.move(from.x, from.y)
  await p.mouse.down()
  await p.mouse.move(to.x, to.y, { steps: 12 })
  await p.waitForTimeout(150)
  await p.mouse.up()
  await p.waitForTimeout(250)
  const wd = await getIt(ps.strip)
  ok(w6.variant === '6' && w6.len === 0.5 && pa && Math.abs(wd.x - (w6.x + 0.8)) < 0.12 && wd.y === w6.y && wd.mount === 'wall', `On the wall 6 outlets can be chosen, dragging slides it along the wall, the height does not change (x ${w6.x} -> ${wd.x})`)
  await p.keyboard.press('ArrowLeft')
  await p.waitForTimeout(120)
  const wl = await getIt(ps.strip)
  await p.keyboard.press('ArrowUp')
  await p.waitForTimeout(120)
  const wu = await getIt(ps.strip)
  for (let k = 0; k < 14; k++) await p.keyboard.press('Shift+ArrowRight')
  await p.waitForTimeout(150)
  const we = await getIt(ps.strip)
  const endX = 54 - 0.05 - 0.25
  ok(Math.abs(wl.x - (wd.x - 0.05)) < 1e-6 && Math.abs(wu.y - (wd.y + 0.05)) < 1e-6 && Math.abs(we.x - endX) < 1e-6 && we.z === wd.z, `Arrow keys move the wall power strip along the wall and up; it stops at the end of the wall (x ${we.x})`)
  await p.click(`aside button:text-is("8 outlets")`)
  await p.waitForTimeout(150)
  const w8 = await getIt(ps.strip)
  ok(w8.variant === '8' && w8.len === 0.64 && Math.abs(w8.x - (54 - 0.05 - 0.32)) < 1e-6, `At the end of the wall a power strip with 8 outlets does not stick out, it slides inward (x ${w8.x})`)
  await p.click('aside button:text-is("Floor or table")')
  await p.waitForTimeout(250)
  const w3 = await getIt(ps.strip)
  ok(w2.y === 0.05 && w3.mount === undefined && w3.y == null && w3.z > w1.z + 0.05, `The wall power strip rises 5 cm with Page Up and goes back to the floor with "Floor or table" (y ${w2.y}, z ${w3.z?.toFixed(3)})`)
  // The "Wall power strip" card in the build bar is dropped on a wall
  await p.evaluate(() => window.__homescape.select(null))
  await p.click('nav[aria-label="Build bar"] button:has-text("Smart devices")')
  const wc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Wall power strip"))').first()
  await wc.scrollIntoViewIfNeeded()
  const wb = await wc.boundingBox()
  await p.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
  await p.mouse.down()
  const tgt = await project(53.85, 2)
  await p.mouse.move(tgt.x, tgt.y, { steps: 10 })
  await p.waitForTimeout(250)
  const wr = (await placement()).result
  await p.mouse.up()
  await p.waitForTimeout(350)
  const hung = (await level()).items.filter((i) => i.kind === 'powerStrip' && i.mount === 'wall').at(-1)
  ok(wr?.ok === true && Boolean(hung) && Math.abs(hung.x - (54 - 0.1)) < 0.011, `The "Wall power strip" card is dropped on a wall and added hanging on it (${wr?.reason ?? 'fits'})`)
  await p.evaluate(({ room }) => {
    const s = window.__homescape.getState().layout
    for (const it of s.layout.levels[0].items.filter((i) => i.x > 49.5 && i.x < 54.5 && i.z > -0.5 && i.z < 4.5)) s.deleteItem(it.id)
    s.deleteRoom(room)
  }, ps)
  await p.keyboard.press('f')
  await p.waitForTimeout(1500)
}

// --- The TV unit is a separate item: the TV sits on the unit or hangs on the wall; the unit can be lengthened ---
{
  L = await level()
  const tvA = L.items.find((i) => i.kind === 'tv')
  const unitA = L.items.find((i) => i.kind === 'tvUnit')
  ok(Boolean(unitA) && tvA.variant === 'stand' && tvA.y === 0.5 && Math.hypot(tvA.x - unitA.x, tvA.z - unitA.z) < 0.3, 'In the automatic plan the TV unit is a separate item and the TV stands on it (0.5 m)')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), tvA.id)
  await p.waitForTimeout(300)
  await p.click('aside button:has-text("On the wall")')
  await p.waitForTimeout(200)
  const tvW = (await level()).items.find((i) => i.id === tvA.id)
  await p.click('aside button:has-text("On a unit / table")')
  await p.waitForTimeout(200)
  const tvS = (await level()).items.find((i) => i.id === tvA.id)
  ok(tvW.variant === 'wall' && tvW.y == null && tvS.variant === 'stand' && tvS.y === 0.5, 'The TV hangs on the wall (no height) and goes back on its unit (0.5 m)')
  // A new TV from the build bar: over the unit it stands on its stand (0.5 m), over an empty wall it hangs
  await p.evaluate(() => window.__homescape.select(null))
  await p.click('nav[aria-label="Build bar"] button:has-text("Media")')
  const tc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("TV"))').first()
  await tc.scrollIntoViewIfNeeded()
  const tb = await tc.boundingBox()
  await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
  await p.mouse.down()
  const onUnit = await project(unitA.x + 0.6 * Math.cos(unitA.rot), unitA.z - 0.6 * Math.sin(unitA.rot))
  await p.mouse.move(onUnit.x, onUnit.y, { steps: 8 })
  await p.waitForTimeout(250)
  const rUnit = (await placement()).result
  const bed0 = L.rooms.find((r) => /bedroom/i.test(r.name))
  const bare = await project(bed0.x + 0.15, bed0.z + bed0.d * 0.55)
  await p.mouse.move(bare.x, bare.y, { steps: 8 })
  await p.waitForTimeout(250)
  const rWall = (await placement()).result
  await p.keyboard.press('Escape')
  await p.mouse.up()
  await p.waitForTimeout(200)
  ok(rUnit?.y === 0.5 && rWall && rWall.y == null, `A new TV is placed on the unit with its stand (${rUnit?.y}) and hanging on an empty wall (${rWall?.y ?? 'hanging off the floor'})`)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), unitA.id)
  await p.waitForTimeout(300)
  await p.locator(`#len-${unitA.id}`).evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '1.4')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await p.waitForTimeout(200)
  ok((await level()).items.find((i) => i.id === unitA.id).len === 1.4, 'The TV unit length changes with the slider (1.4 m)')
  await p.keyboard.press('Meta+z')
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Window curtain: the type is chosen, the curtain motor (cover) is bound, opening and slat tilt on the card ---
{
  L = await level()
  const liv = L.rooms.find((r) => /living/i.test(r.name))
  const winId = await p.evaluate((r) => window.__homescape.getState().layout.addItem('window', r.x + 1.6, r.z + 0.21, 0), liv)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), winId)
  await p.waitForTimeout(300)
  const kinds = []
  for (const label of ['Roller blind', 'Zebra blind', 'Venetian blind', 'None', 'Drapes']) {
    await p.click(`aside button:text-is("${label}")`)
    await p.waitForTimeout(120)
    kinds.push((await level()).items.find((i) => i.id === winId).variant)
  }
  ok(kinds.join() === 'roller,zebra,blinds,none,curtain' && (await p.isVisible('aside >> text=current_position')), `The curtain type can be chosen (${kinds.join(', ')}) and the card has the curtain motor note`)
  // Add a curtain motor to the demo source (30% open, with slats) and bind it to the window; opening and slat tilt on the view card
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'cover.test_curtain', state: 'open', attributes: { friendly_name: 'Test curtain', device_class: 'blind', current_position: 30, current_tilt_position: 60 } }))
  await p.evaluate((id) => window.__homescape.getState().layout.updateItem(id, { extras: ['cover.test_curtain'] }), winId)
  await p.evaluate(() => window.__homescape.setMode('view'))
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), winId)
  await p.waitForTimeout(400)
  await p.click('aside button:has-text("Test curtain")')
  await p.waitForTimeout(200)
  ok((await p.isVisible('aside >> text=Position')) && (await p.isVisible('aside >> text=Slat tilt')), 'The position and slat tilt of the curtain motor bound to the window can be set on the card')
  const kpi = await p.locator('text=Doors / windows').locator('..').innerText()
  await p.evaluate(() => window.__homescape.setMode('edit'))
  await p.evaluate((id) => {
    window.__homescape.select(null)
    window.__homescape.getState().layout.deleteItem(id)
  }, winId)
  ok(!/Curtain/.test(kpi), 'An open curtain is not counted as an open door / window')
}

// --- Height of a wall item: handle, Page Up/Down, card; height conflicts on the wall; window opening ---
{
  const ids = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('edit')
    const room = s.addRoom({ name: 'Height test', floor: 'wood', x: 40, z: 0, w: 6, d: 4 })
    return { room, pic: s.addItem('painting', 42, 0.085, 0), plug: s.addItem('plug', 42, 0.115, 0), win: s.addItem('window', 44.5, 0.21, 0) }
  })
  const getIt = async (id) => (await level()).items.find((i) => i.id === id)
  ok((await p.evaluate((ids) => window.__homescape.getState().layout.layout.levels[0].items.filter((i) => i.id === ids.pic || i.id === ids.plug).length, ids)) === 2, 'A painting can hang above a plug (their heights on the wall are separate)')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.pic)
  await p.evaluate((id) => window.__homescape.focusRoom(id), ids.room)
  await p.waitForTimeout(1800)
  ok(await p.isVisible(`#mount-${ids.pic}`), 'The card has a "Height on the wall" slider')
  // Handle: to the right of the painting, level with its middle (the painting is 0.8 m wide, its middle is at 1.55 m)
  const h = await p.evaluate(() => window.__homescape.project(42.56, 1.55, 0.155))
  await p.mouse.move(h.x, h.y)
  await p.mouse.down()
  await p.mouse.move(h.x, h.y - 25, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(300)
  const up = (await getIt(ids.pic)).y
  ok(up > 0.05, `The up/down handle raises the painting on the wall (+${up} m)`)
  // Move it sideways: it keeps its height
  const c = await p.evaluate((dy) => window.__homescape.project(42, 1.55 + dy, 0.1), up)
  await p.mouse.move(c.x, c.y)
  await p.mouse.down()
  await p.mouse.move(c.x - 50, c.y, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(300)
  const moved = await getIt(ids.pic)
  ok(Math.abs(moved.x - 42) > 0.1 && moved.y === up, `It keeps its height when moved sideways (x ${moved.x.toFixed(2)}, y ${moved.y})`)
  await p.evaluate(({ pic }) => window.__homescape.getState().layout.updateItem(pic, { x: 42, y: undefined }), ids)
  // Page Down: it cannot go down to the plug's level (their heights collide), so it stops at the last valid place
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.pic)
  for (let i = 0; i < 8; i++) await p.keyboard.press('Shift+PageDown')
  await p.waitForTimeout(300)
  const low = (await getIt(ids.pic)).y
  const notice = (await placement()).notice ?? ''
  ok(Math.abs(low - -0.75) < 1e-9 && /Smart plug|Plug/i.test(notice), `Page Down lowers the painting and it stops where it would collide with the plug (${low} m: ${notice})`)
  // Window: Page Up twice = +10 cm, the opening in the wall moves too
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.win)
  await p.keyboard.press('PageUp')
  await p.keyboard.press('PageUp')
  await p.waitForTimeout(300)
  const w = await getIt(ids.win)
  const ap = await p.evaluate(async (w) => (await import('/src/model/geometry.ts')).apertureOf(w), w)
  ok(w.y === 0.1 && Math.abs(ap.y0 - 1.0) < 1e-9 && Math.abs(ap.y1 - 2.2) < 1e-9, `The window rises 10 cm, and so does its opening in the wall (${ap.y0.toFixed(2)}-${ap.y1.toFixed(2)} m)`)
  await p.evaluate((id) => {
    window.__homescape.select(null)
    window.__homescape.getState().layout.deleteRoom(id)
  }, ids.room)
  // Camera back to the whole house (later tests pick points in the view of the house)
  await p.keyboard.press('f')
  await p.waitForTimeout(1500)
}

// --- Gaming chair: tucks under the desk, the stripe color is one of the bright colors ---
{
  L = await level()
  const deskG = L.items.find((i) => i.kind === 'desk')
  const tuck = await p.evaluate(async ({ d, lv }) => {
    const r = await import('/src/model/rules.ts')
    // Try without the chair in front of the desk (it tucks under the desk too and would collide with the armchair)
    lv = { ...lv, items: lv.items.filter((i) => i.kind !== 'chair') }
    const at = { x: d.x + Math.sin(d.rot) * 0.35, z: d.z + Math.cos(d.rot) * 0.35, rot: d.rot + Math.PI }
    return { gaming: r.checkItem(lv, { kind: 'gamingChair', ...at }).ok, armchair: r.checkItem(lv, { kind: 'armchair', ...at }).ok }
  }, { d: deskG, lv: L })
  ok(tuck.gaming && !tuck.armchair, 'The gaming chair can tuck under the desk (the armchair cannot)')
  const gid = await p.evaluate((d) => window.__homescape.getState().layout.addItem('gamingChair', d.x + Math.sin(d.rot) * 0.75, d.z + Math.cos(d.rot) * 0.75, d.rot + Math.PI), deskG)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), gid)
  await p.waitForTimeout(300)
  await p.click('aside button[title="Green"]')
  await p.click('aside button[title="White"] >> nth=1')
  await p.waitForTimeout(150)
  const g = (await level()).items.find((i) => i.id === gid)
  ok(g.top === '#2fbf71' && g.body === '#ffffff', 'The stripe (green) and body (white) colors of the gaming chair can be chosen')
  await p.evaluate((id) => {
    window.__homescape.select(null)
    window.__homescape.getState().layout.deleteItem(id)
  }, gid)
}

// --- Headboard light: None / Strip / From behind; it glows with the bound light, lights the room, counts in the light counter ---
{
  L = await level()
  const bedB = L.items.find((i) => i.kind === 'bed')
  // In the automatic plan the "headboard" light is not a separate wall light, it is the headboard light of the bed
  const headIds = L.items.flatMap((i) => [i.entityId, ...(i.extras ?? [])]).filter((id) => id && /headboard/.test(id))
  ok(headIds.every((id) => L.items.some((i) => i.kind === 'bed' && i.extras?.includes(id) && i.led === 'strip')), `In the automatic plan the headboard light is bound to the bed (${headIds.join(', ') || 'none in this home'})`)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.test_headboard', state: 'on', attributes: { friendly_name: 'Test headboard', brightness: 200, rgb_color: [255, 120, 60], color_mode: 'rgb', supported_color_modes: ['rgb'] } }))
  const prev = { extras: bedB.extras, led: bedB.led }
  await p.evaluate((id) => window.__homescape.getState().layout.updateItem(id, { extras: ['light.test_headboard'], led: undefined }), bedB.id)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), bedB.id)
  await p.waitForTimeout(300)
  const modes = []
  for (const label of ['From behind', 'None', 'Strip']) {
    await p.click(`aside button:text-is("${label}")`)
    await p.waitForTimeout(120)
    modes.push((await level()).items.find((i) => i.id === bedB.id).led)
  }
  ok(modes.join() === 'back,none,strip' && (await p.isVisible('aside >> text=Headboard light')), `The headboard light can be chosen on the bed card (${modes.join(', ')})`)
  const c = Math.cos(bedB.rot)
  const s = Math.sin(bedB.rot)
  const hx = bedB.x - 0.88 * s
  const hz = bedB.z - 0.88 * c
  const lights = await p.evaluate(() => window.__homescape.roomLights())
  // The color is multiplied by power and the daylight factor (linear); the share of the orange light is kept: red > green > blue
  const warm = (hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    return r > g && g > b
  }
  const head = lights.find((l) => Math.abs(l.pos[0] - hx) < 0.01 && Math.abs(l.pos[2] - hz) < 0.01 && Math.abs(l.pos[1] - 0.9) < 0.01)
  ok(Boolean(head) && head.type === 3 && warm(head.color), `The headboard strip glows with the bound light, takes its color and lights the room along the strip (line light) (${head?.color ?? 'no light'})`)
  const bedRoom = roomAt(L, bedB.x, bedB.z)
  await p.evaluate(() => window.__homescape.select(null))
  await p.evaluate(() => window.__homescape.setMode('view'))
  await p.waitForTimeout(300)
  const row = await p.locator(`aside button:has-text("${bedRoom.name}")`).first().innerText()
  ok(/[1-9]\/[1-9]\s*light/.test(row.replace(/\n/g, ' ')), `The headboard light counts in the room's light counter (${row.replace(/\n/g, ' ')})`)
  await p.evaluate(() => window.__homescape.setMode('edit'))
  await p.evaluate(({ id, prev }) => window.__homescape.getState().layout.updateItem(id, prev), { id: bedB.id, prev })
}

// --- Mini palm: a desk plant, cannot go on the floor, goes on top of the desk ---
{
  L = await level()
  const deskP = L.items.find((i) => i.kind === 'desk')
  const roomP = roomAt(L, deskP.x, deskP.z)
  await p.click('nav[aria-label="Build bar"] button:has-text("Desk and decor")')
  const pc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Mini palm"))').first()
  await pc.scrollIntoViewIfNeeded()
  const pb = await pc.boundingBox()
  await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
  await p.mouse.down()
  const fl = await project(roomP.x + roomP.w / 2, roomP.z + roomP.d - 0.6)
  await p.mouse.move(fl.x, fl.y, { steps: 8 })
  await p.waitForTimeout(200)
  const rF = (await placement()).result
  let rD = null
  for (const [dx, dz] of [[0.55, -0.15], [-0.55, -0.15], [0.55, 0.1], [-0.55, 0.1]]) {
    const t = await project(deskP.x + dx * Math.cos(deskP.rot) + dz * Math.sin(deskP.rot), deskP.z - dx * Math.sin(deskP.rot) + dz * Math.cos(deskP.rot))
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(160)
    rD = (await placement()).result
    if (rD?.ok) break
  }
  await p.keyboard.press('Escape')
  await p.mouse.up()
  await p.waitForTimeout(200)
  ok(rF?.ok === false && rD?.ok === true && rD.y === 0.75, `The mini palm cannot go on the floor, it goes on top of the desk (${rD?.reason ?? rD?.y})`)
}

// --- HomePod: recognized from the device model in the registry, goes on the TV unit; goes on a surface, model and color are chosen, volume on the card while playing ---
{
  L = await level()
  const gen = L.items.find((i) => i.kind === 'homepod')
  if (gen) {
    const unitH = L.items.find((i) => i.kind === 'tvUnit' && Math.hypot(i.x - gen.x, i.z - gen.z) < 1.2)
    ok(gen.variant === 'mini' && gen.name === 'HomePod mini' && gen.y === 0.5 && Boolean(unitH), `A HomePod named after its room was recognized from the HomePod mini model, on top of the TV unit (${gen.name}, ${gen.variant}, y ${gen.y})`)
  } else ok(true, 'No HomePod in this snapshot (auto-plan check skipped)')
  const table = L.items.find((i) => i.kind === 'coffeeTable')
  await p.click('nav[aria-label="Build bar"] button:has-text("Media")')
  const hc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("HomePod"))').first()
  await hc.scrollIntoViewIfNeeded()
  const hb = await hc.boundingBox()
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await p.mouse.down()
  let hr = null
  for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0.3, 0.12], [-0.3, -0.12], [0, 0]]) {
    const t = await project(table.x + dx * Math.cos(table.rot) + dz * Math.sin(table.rot), table.z - dx * Math.sin(table.rot) + dz * Math.cos(table.rot))
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(160)
    hr = (await placement()).result
    if (hr?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(350)
  ok(hr?.ok === true && hr.y === 0.44, `The HomePod goes on top of the coffee table (${hr?.reason ?? hr?.y})`)
  const pod = (await level()).items.filter((i) => i.kind === 'homepod').at(-1)
  if (pod && hr?.ok) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), pod.id)
    await p.waitForTimeout(300)
    const miniCls = await p.locator('aside button:text-is("HomePod mini")').getAttribute('class')
    await p.click('aside button:text-is("HomePod")')
    await p.click('aside button[aria-label="Midnight"]')
    await p.waitForTimeout(200)
    const pod2 = (await level()).items.find((i) => i.id === pod.id)
    ok(/bg-brand/.test(miniCls ?? '') && pod2.variant === 'full' && pod2.body === '#2c2f37', 'The HomePod defaults to mini; the full-size HomePod and the midnight color can be chosen')
    // Playing HomePod: pause and volume on the card; when paused it shows "Play"
    await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'media_player.test_homepod', state: 'playing', attributes: { friendly_name: 'Test HomePod', volume_level: 0.35, media_title: 'Test track' } }))
    await p.evaluate((id) => window.__homescape.getState().layout.updateItem(id, { entityId: 'media_player.test_homepod' }), pod.id)
    await p.evaluate(() => window.__homescape.setMode('view'))
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), pod.id)
    await p.waitForTimeout(400)
    const vol = await p.isVisible('aside >> text=Volume')
    const pct = await p.isVisible('aside >> text=35%')
    await p.click('aside button:has-text("Pause")')
    await p.waitForTimeout(300)
    ok(vol && pct && (await p.isVisible('aside button:has-text("Play")')), 'The playing HomePod card shows the volume (35%) and pause; when paused it shows Play')
    await p.evaluate((id) => window.__homescape.getState().layout.deleteItem(id), pod.id)
    await p.evaluate(() => window.__homescape.setMode('edit'))
    await p.evaluate(() => window.__homescape.select(null))
  }
}

// --- Light intensity: an item that gives light has a 10%-300% slider on the card; the light falling on the room scales with it. Stick vacuum ---
{
  L = await level()
  const bedI = L.items.find((i) => i.kind === 'bed')
  const sofaI = L.items.find((i) => i.kind === 'sofa')
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.test_head', state: 'on', attributes: { friendly_name: 'Test headboard', brightness: 255 } }))
  await p.evaluate((b) => window.__homescape.getState().layout.updateItem(b.id, { led: 'strip', ledEntity: 'light.test_head', extras: [...(b.extras ?? []), 'light.test_head'], intensity: undefined }), bedI)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), bedI.id)
  await p.waitForTimeout(400)
  const bedLight = async () => (await p.evaluate(() => window.__homescape.roomLights())).find((l) => l.type === 3 && !l.portal && Math.hypot(l.pos[0] - bedI.x, l.pos[2] - bedI.z) < 1.3)
  const e1 = (await bedLight())?.energy ?? 0
  const visible = await p.isVisible(`#intensity-${bedI.id}`)
  const setRange = (sel, v) =>
    p.locator(sel).evaluate((el, val) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
  await setRange(`#intensity-${bedI.id}`, 200)
  await p.waitForTimeout(400)
  const e2 = (await bedLight())?.energy ?? 0
  const i2 = (await level()).items.find((i) => i.id === bedI.id).intensity
  ok(visible && i2 === 2 && e1 > 0 && Math.abs(e2 / e1 - 2) < 0.01 && (await p.isVisible('aside >> text=200%')), `The headboard light intensity can be set on the card: at 200% the light falling on the room doubles (${e1} -> ${e2})`)
  await p.click('aside button:text-is("Default")')
  await p.waitForTimeout(200)
  ok((await level()).items.find((i) => i.id === bedI.id).intensity === undefined, 'Light intensity returns to 100% with "Default"')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), sofaI.id)
  await p.waitForTimeout(300)
  ok(!(await p.isVisible(`#intensity-${sofaI.id}`)), 'An item that gives no light (sofa) has no light intensity slider')
  await p.evaluate(() => window.__homescape.select(null))

  // The charging plug of a stick vacuum ("Dyson Vacuum") is recognized by its name; an item is added by hand to try the card
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'switch.bedroom_dyson_vacuum', state: 'on', attributes: { friendly_name: 'Dyson Vacuum' } }))
  const vacKind = await p.evaluate(async () => (await import('/src/model/generate.ts')).kindFor(window.__homescape.entity('switch.bedroom_dyson_vacuum'), ''))
  const vac = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const room = s.addRoom({ name: 'Vacuum test', floor: 'wood', x: 110, z: 0, w: 3, d: 3 })
    return { room, id: s.addItem('stickVacuum', 111.5, 0.15, 0, 'switch.bedroom_dyson_vacuum') }
  })
  ok(vacKind === 'stickVacuum' && (await level()).items.some((i) => i.id === vac.id && i.entityId === 'switch.bedroom_dyson_vacuum'), `The "Dyson Vacuum" charging plug is recognized as a stick vacuum (${vacKind})`)
  await p.click('nav[aria-label="Build bar"] button:has-text("Smart devices")')
  const vc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Stick vacuum"))').first()
  await vc.scrollIntoViewIfNeeded()
  ok(await vc.isVisible(), 'The build bar has a "Stick vacuum" card')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), vac.id)
  await p.waitForTimeout(300)
  await p.click('aside button[aria-label="Purple"]')
  await p.waitForTimeout(150)
  ok((await level()).items.find((i) => i.id === vac.id).body === '#7a4fc4', 'The stick vacuum body color can be chosen')
  await p.evaluate(() => window.__homescape.select(null))
  await p.evaluate(({ room, id }) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(id)
    s.deleteRoom(room)
  }, vac)
}

// --- Diffuser light: the ring strip is bound to a separate light and lights the room; the desk camera goes on a desk ---
{
  L = await level()
  const dif = L.items.find((i) => i.kind === 'diffuser')
  if (dif) {
    // The diffuser of the sample home has no light of its own: bind one, the ring strip then turns on by itself
    await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.diffuser_light', state: 'on', attributes: { friendly_name: 'Diffuser Light', brightness: 255 } }))
    await p.evaluate((d) => window.__homescape.getState().layout.updateItem(d.id, { extras: [...(d.extras ?? []), 'light.diffuser_light'], led: undefined }), dif)
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), dif.id)
    await p.waitForTimeout(300)
    const stripCls = await p.locator('aside button:text-is("Ring strip")').getAttribute('class')
    await p.click('aside button:text-is("None")')
    await p.waitForTimeout(150)
    const off = (await level()).items.find((i) => i.id === dif.id).led
    await p.click('aside button:text-is("Ring strip")')
    await p.waitForTimeout(150)
    ok(/bg-brand/.test(stripCls ?? '') && off === 'none' && (await level()).items.find((i) => i.id === dif.id).led === 'strip', 'The diffuser card offers "Light: None / Ring strip"')
    // The light entity is chosen separately; while it is on, the diffuser lights the room with colored light from its base
    await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.test_diffuser', state: 'on', attributes: { friendly_name: 'Test diffuser light', brightness: 255, rgb_color: [255, 80, 160] } }))
    await p.waitForTimeout(200)
    await p.click(`#ledent-${dif.id}`)
    await p.waitForTimeout(150)
    if (await p.isVisible(`#ledent-q-${dif.id}`)) await p.fill(`#ledent-q-${dif.id}`, 'test diffuser')
    await p.click('aside [data-ledent="light.test_diffuser"]')
    await p.waitForTimeout(400)
    const d2 = (await level()).items.find((i) => i.id === dif.id)
    const tag = await p.isVisible('aside >> text=Ring light')
    const lights = await p.evaluate(() => window.__homescape.roomLights())
    const near = lights.some((l) => Math.hypot(l.pos[0] - dif.x, l.pos[2] - dif.z) < 0.05 && Math.abs(l.pos[1] - ((dif.y ?? 0) + 0.06)) < 0.02)
    ok(d2.ledEntity === 'light.test_diffuser' && d2.extras.includes('light.test_diffuser') && tag && near, `The diffuser light is bound to the separately chosen light ("Ring light") and lights the room while on (${near ? 'light present' : 'no light'})`)
    await p.click(`#ledent-${dif.id}`)
    await p.waitForTimeout(150)
    await p.click('aside [data-ledent=""]')
    await p.waitForTimeout(200)
    await p.evaluate((d) => window.__homescape.getState().layout.updateItem(d.id, { extras: d.extras ?? [], led: d.led }), dif)
    await p.evaluate(() => window.__homescape.select(null))
  } else ok(true, 'No diffuser in this snapshot (diffuser light check skipped)')

  const cam = L.items.find((i) => i.kind === 'deskCamera')
  if (cam) {
    const deskC = L.items.find((i) => i.kind === 'desk' && Math.hypot(i.x - cam.x, i.z - cam.z) < 0.8)
    ok(cam.y === 0.75 && Boolean(deskC), `A camera with "desk" in its name became a desk camera, on top of the desk (y ${cam.y})`)
  } else ok(true, 'No desk camera in this snapshot (auto-plan check skipped)')
  const table = L.items.find((i) => i.kind === 'coffeeTable')
  await p.click('nav[aria-label="Build bar"] button:has-text("Security")')
  const cc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Desk camera"))').first()
  await cc.scrollIntoViewIfNeeded()
  const cb = await cc.boundingBox()
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await p.mouse.down()
  let cr = null
  for (const [dx, dz] of [[-0.4, 0], [0.4, 0], [-0.35, 0.15], [0.35, -0.15], [0, 0.1]]) {
    const t = await project(table.x + dx * Math.cos(table.rot) + dz * Math.sin(table.rot), table.z - dx * Math.sin(table.rot) + dz * Math.cos(table.rot))
    await p.mouse.move(t.x, t.y, { steps: 6 })
    await p.waitForTimeout(160)
    cr = (await placement()).result
    if (cr?.ok) break
  }
  await p.mouse.up()
  await p.waitForTimeout(350)
  ok(cr?.ok === true && cr.y === 0.44, `The desk camera goes on top of the coffee table (${cr?.reason ?? cr?.y})`)
  const camNew = (await level()).items.filter((i) => i.kind === 'deskCamera').at(-1)
  if (camNew && cr?.ok) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), camNew.id)
    await p.waitForTimeout(300)
    await p.click('aside button[aria-label="Black"]')
    await p.waitForTimeout(150)
    ok((await level()).items.find((i) => i.id === camNew.id).body === '#26282f' && (await p.isVisible('aside >> text=privacy mode')), 'The desk camera color can be chosen and the card has the binding note')
    await p.evaluate((id) => window.__homescape.getState().layout.deleteItem(id), camNew.id)
    await p.evaluate(() => window.__homescape.select(null))
  }
}

// --- Notes while the HomePod plays; diffuser body color; downlight beam angle; light groups ---
{
  L = await level()
  const perfNow2 = () => p.evaluate(() => window.__homescape.perf())
  const hpI = L.items.find((i) => i.kind === 'homepod')
  if (hpI?.entityId) {
    await p.evaluate((id) => window.__homescape.setEntity({ entity_id: id, state: 'paused', attributes: { friendly_name: 'HomePod', volume_level: 0.5 } }), hpI.entityId)
    await p.waitForTimeout(300)
    const a0 = (await perfNow2()).ambient
    await p.evaluate((id) => window.__homescape.setEntity({ entity_id: id, state: 'playing', attributes: { friendly_name: 'HomePod', volume_level: 0.5 } }), hpI.entityId)
    await p.waitForTimeout(300)
    const a1 = (await perfNow2()).ambient
    ok(a1 >= a0 + 2, `When the HomePod plays the wave and music notes come alive (live effects ${a0} -> ${a1})`)
    await p.evaluate((id) => window.__homescape.setEntity({ entity_id: id, state: 'off', attributes: { friendly_name: 'HomePod' } }), hpI.entityId)
  } else ok(true, 'No bound HomePod in this plan (notes check skipped)')

  const difI = L.items.find((i) => i.kind === 'diffuser')
  if (difI) {
    await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), difI.id)
    await p.waitForTimeout(300)
    await p.click('aside button[aria-label="Dark wood"]')
    await p.waitForTimeout(150)
    ok((await level()).items.find((i) => i.id === difI.id).body === '#8a5634', 'The diffuser body can be chosen (light wood, dark wood, white)')
    await p.evaluate(() => window.__homescape.select(null))
  }

  const setRange = (sel, v) =>
    p.locator(sel).evaluate((el, val) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
  const g = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('edit')
    window.__homescape.setEntity({ entity_id: 'light.t_g1', state: 'on', attributes: { friendly_name: 'Group 1', brightness: 255 } })
    window.__homescape.setEntity({ entity_id: 'light.t_g2', state: 'off', attributes: { friendly_name: 'Group 2' } })
    const room = s.addRoom({ name: 'Spot test', floor: 'wood', x: 50, z: 0, w: 5, d: 3 })
    return { room, a: s.addItem('downlight', 51, 1.5, 0, 'light.t_g1'), b: s.addItem('downlight', 52.5, 1.5, 0), c: s.addItem('downlight', 54, 1.5, 0) }
  })
  const it = async (id) => (await level()).items.find((i) => i.id === id)
  const coneOf = async (x) => (await p.evaluate(() => window.__homescape.roomLights())).find((l) => l.type === 1 && !l.portal && Math.abs(l.pos[0] - x) < 0.05)?.cone
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), g.a)
  await p.waitForTimeout(300)
  const c90 = await coneOf(51)
  await setRange(`#beam-${g.a}`, 140)
  await p.waitForTimeout(300)
  const c140 = await coneOf(51)
  ok((await it(g.a)).beam === 140 && Math.abs(c90[0] - Math.cos(Math.PI / 4)) < 1e-3 && Math.abs(c140[0] - Math.cos((70 * Math.PI) / 180)) < 1e-3 && (await p.isVisible('aside >> text=140°')), `The downlight beam angle can be set: 90° -> 140°, the light cone widens (cos ${c90[0].toFixed(3)} -> ${c140[0].toFixed(3)})`)
  await p.click('aside button:text-is("Default")')
  await p.waitForTimeout(150)
  ok((await it(g.a)).beam === undefined, 'Beam angle returns to 90° with "Default"')

  // Grouping: in a multi selection "Group N lights"; the entity of the first bound member goes to all; an entity bound later goes to all too
  await p.evaluate((g) => window.__homescape.getState().layout.setMulti({ rooms: [], items: [g.b, g.a, g.c] }), g)
  await p.waitForTimeout(200)
  await p.click('button:has-text("Group 3 lights")')
  await p.waitForTimeout(250)
  const [ga, gb, gc] = [await it(g.a), await it(g.b), await it(g.c)]
  ok(Boolean(ga.group) && ga.group === gb.group && gb.group === gc.group && [ga, gb, gc].every((x) => x.entityId === 'light.t_g1'), 'The 3 selected spots became one group, all bound to the same entity (light.t_g1)')
  await p.evaluate((g) => window.__homescape.getState().layout.bind(g.b, 'light.t_g2'), g)
  await p.waitForTimeout(150)
  const both = [await it(g.a), await it(g.b), await it(g.c)].every((x) => x.extras?.includes('light.t_g2'))
  await p.evaluate((g) => window.__homescape.getState().layout.makeMain(g.c, 'light.t_g2'), g)
  await p.waitForTimeout(150)
  const mains = [await it(g.a), await it(g.b), await it(g.c)].every((x) => x.entityId === 'light.t_g2')
  ok(both && mains, 'An entity bound to one light of the group and made main applies to the whole group')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), g.c)
  await p.waitForTimeout(300)
  const info = await p.isVisible('aside >> text=Group of 3 lights')
  await p.click('aside button:text-is("Remove from group")')
  await p.waitForTimeout(200)
  const out1 = (await it(g.c)).group === undefined && Boolean((await it(g.a)).group)
  await p.evaluate((id) => window.__homescape.getState().layout.deleteItem(id), g.b)
  await p.waitForTimeout(150)
  ok(info && out1 && (await it(g.a)).group === undefined, 'The card says "Group of 3 lights"; the one removed leaves the group, and the group dissolves when one member is left')
  await p.evaluate(({ room, a, c }) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(a)
    s.deleteItem(c)
    s.deleteRoom(room)
  }, g)
  await p.evaluate(() => window.__homescape.select(null))

  // Heating group (user request: "I should be able to group boilers and radiators"): the boiler and the radiators form one group, the boiler's entity is bound to the radiators;
  // summary on the card; a radiator turns into a boiler with one click; in the automatic plan the boiler has its own kind
  const h = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setEntity({ entity_id: 'climate.t_boiler', state: 'heat', attributes: { friendly_name: 'Boiler', hvac_modes: ['off', 'heat'], hvac_action: 'heating', current_temperature: 21, temperature: 23 } })
    const room = s.addRoom({ name: 'Heated room', floor: 'wood', x: 74, z: 0, w: 5, d: 4 })
    // The boiler is on the back wall (z 0), the radiators on the front and left walls; one stands alone (its kind will change)
    // In from the wall: half wall 5 cm + half the item depth + 1 cm (boiler 0.23, radiator 0.135)
    const boiler = s.addItem('boiler', 75.2, 0.23, 0, 'climate.t_boiler')
    const r1 = s.addItem('radiator', 76.5, 4 - 0.135, Math.PI)
    const r2 = s.addItem('radiator', 74.135, 2, Math.PI / 2)
    const r3 = s.addItem('radiator', 79 - 0.135, 2, -Math.PI / 2)
    s.setMulti({ rooms: [], items: [r1, boiler, r2] })
    return { room, boiler, r1, r2, r3 }
  })
  await p.waitForTimeout(250)
  const label = await p.locator('#group-heating').innerText()
  await p.click('#group-heating')
  await p.waitForTimeout(250)
  const [hb, h1, h2] = [await it(h.boiler), await it(h.r1), await it(h.r2)]
  ok(/Group the boiler with 2 radiators/.test(label) && Boolean(hb.group) && hb.group === h1.group && h1.group === h2.group && [hb, h1, h2].every((x) => x.entityId === 'climate.t_boiler'), `The boiler and radiators became one heating group and the boiler's entity was bound to the radiators ("${label}")`)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), h.r1)
  await p.waitForTimeout(300)
  const hInfo = await p.isVisible('aside >> text=Heating group: 1 boiler, 2 radiators')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), h.r3)
  await p.waitForTimeout(250)
  await p.click('aside [data-heat-kind="boiler"]')
  await p.waitForTimeout(250)
  const r3 = await it(h.r3)
  const gen = await p.evaluate(async () => {
    const g = await import('/src/model/generate.ts')
    const e = (id, name) => ({ entity_id: id, state: 'heat', attributes: { friendly_name: name } })
    return [g.kindFor(e('climate.boiler_thermostat', 'Boiler Thermostat'), ''), g.kindFor(e('climate.living_room_radiator', 'Living room radiator'), '')]
  })
  ok(hInfo && r3.kind === 'boiler' && Math.abs(r3.x - 78.77) < 0.02 && gen[0] === 'boiler' && gen[1] === 'radiator', `The card says "Heating group: 1 boiler, 2 radiators"; a radiator turns into a wall boiler with one click (x ${r3.x.toFixed(2)}); in the automatic plan the boiler has its own kind (${gen.join(', ')})`)
  await p.evaluate((h) => {
    const s = window.__homescape.getState().layout
    for (const id of [h.boiler, h.r1, h.r2, h.r3]) s.deleteItem(id)
    s.deleteRoom(h.room)
    window.__homescape.select(null)
  }, h)

  // ⌘-click adds items to the multi selection (⇧ rotates the camera)
  // From this angle the sofa is behind an inner wall (the wall cuts the click); use the visible coffee table
  const sofaS = L.items.find((i) => i.kind === 'coffeeTable')
  const armS = L.items.find((i) => i.kind === 'armchair')
  await p.evaluate((id) => window.__homescape.focusRoom(id), roomAt(L, sofaS.x, sofaS.z).id)
  await p.waitForTimeout(1800)
  const ps1 = await p.evaluate(([x, z]) => window.__homescape.project(x, 0.45, z), [sofaS.x, sofaS.z])
  const ps2 = await p.evaluate(([x, z]) => window.__homescape.project(x, 0.45, z), [armS.x, armS.z])
  await p.keyboard.down('Meta')
  await p.mouse.click(ps1.x, ps1.y)
  await p.waitForTimeout(150)
  await p.mouse.click(ps2.x, ps2.y)
  await p.keyboard.up('Meta')
  await p.waitForTimeout(200)
  const multiIds = await p.evaluate(() => window.__homescape.getState().layout.multi?.items ?? [])
  ok(multiIds.includes(sofaS.id) && multiIds.includes(armS.id), `In edit mode ⌘-click adds to the multi selection (${multiIds.length} items)`)
  await p.evaluate(() => window.__homescape.getState().layout.setMulti(null))
  await p.keyboard.press('f')
  await p.waitForTimeout(1500)
}

// --- Downlight in all directions; game console model and pose; "Charging" on the stick vacuum ---
{
  L = await level()
  const ids = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('edit')
    window.__homescape.setEntity({ entity_id: 'light.t_omni', state: 'on', attributes: { friendly_name: 'Omni', brightness: 255 } })
    window.__homescape.setEntity({ entity_id: 'switch.t_console', state: 'on', attributes: { friendly_name: 'Console' } })
    window.__homescape.setEntity({ entity_id: 'switch.bedroom_dyson_vacuum', state: 'on', attributes: { friendly_name: 'Dyson Vacuum' } })
    const room = s.addRoom({ name: 'Omni test', floor: 'wood', x: 60, z: 0, w: 4, d: 3 })
    return { room, dl: s.addItem('downlight', 62, 1.5, 0, 'light.t_omni'), con: s.addItem('console', 61, 1.5, 0, 'switch.t_console'), vac: s.addItem('stickVacuum', 63.2, 2.8, 0, 'switch.bedroom_dyson_vacuum') }
  })
  const it = async (id) => (await level()).items.find((i) => i.id === id)
  const lightAt = async () => (await p.evaluate(() => window.__homescape.roomLights())).find((l) => !l.portal && Math.abs(l.pos[0] - 62) < 0.05 && Math.abs(l.pos[2] - 1.5) < 0.05)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.dl)
  await p.waitForTimeout(300)
  const spot = await lightAt()
  const beamShown = await p.isVisible(`#beam-${ids.dl}`)
  await p.click('aside button:text-is("All directions")')
  await p.waitForTimeout(300)
  const omni = await lightAt()
  ok(spot?.type === 1 && beamShown && (await it(ids.dl)).variant === 'omni' && omni?.type === 0 && omni.range >= 5 && !(await p.isVisible(`#beam-${ids.dl}`)), `With "All directions" the downlight lights the whole room like a pendant light (type ${spot?.type} -> ${omni?.type}, range ${omni?.range?.toFixed(1)} m), the angle slider is hidden`)
  await p.click('aside button:text-is("Spot")')
  await p.waitForTimeout(250)
  ok((await lightAt())?.type === 1 && (await p.isVisible(`#beam-${ids.dl}`)), 'Choosing Spot brings back the cone and the beam angle')

  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.con)
  await p.waitForTimeout(300)
  const c0 = await it(ids.con)
  await p.click('aside button:text-is("Xbox")')
  await p.waitForTimeout(150)
  const c1 = await it(ids.con)
  await p.click('aside button:text-is("Horizontal")')
  await p.waitForTimeout(150)
  const c2 = await it(ids.con)
  await p.click('aside button:text-is("PlayStation")')
  await p.waitForTimeout(150)
  const c3 = await it(ids.con)
  ok(c0.variant === undefined && c1.variant === 'xbox-v' && c1.len === 0.08 && c2.variant === 'xbox-h' && c2.len === 0.28 && c3.variant === 'ps5-h' && c3.len === 0.37, `The game console can be PlayStation / Xbox and vertical / horizontal, and the footprint follows (${c1.variant}, ${c2.variant}, ${c3.variant})`)
  const gen = L.items.find((i) => i.kind === 'console' && i.entityId)
  if (gen) ok(gen.variant === (/xbox/i.test(gen.entityId) ? 'xbox-v' : 'ps5-v') && gen.len === (gen.variant === 'xbox-v' ? 0.08 : 0.13), `In the automatic plan the console takes its model from its name (${gen.entityId}: ${gen.variant})`)

  // The charging plug of the stick vacuum says "Charging" when it is on and "Not charging" when it is off
  await p.evaluate(() => window.__homescape.setMode('view'))
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.vac)
  await p.waitForTimeout(400)
  const charging = await p.isVisible('aside >> text=Charging')
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'switch.bedroom_dyson_vacuum', state: 'off', attributes: { friendly_name: 'Dyson Vacuum' } }))
  await p.waitForTimeout(300)
  ok(charging && (await p.isVisible('aside >> text=Not charging')), 'While the stick vacuum plug is on the card says "Charging", while it is off "Not charging"')
  await p.evaluate(() => window.__homescape.setMode('edit'))
  await p.evaluate(({ room, dl, con, vac }) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(dl)
    s.deleteItem(con)
    s.deleteItem(vac)
    s.deleteRoom(room)
  }, ids)
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Climate control (dial, mode, fan, vane, preset), security system (modes, trigger alarm), people at home ---
{
  L = await level()
  await p.evaluate(() => window.__homescape.setMode('view'))
  const ac = L.items.find((i) => i.kind === 'acUnit')
  const prevAc = ac.entityId
  await p.evaluate(() =>
    window.__homescape.setEntity({
      entity_id: 'climate.test_ac',
      state: 'cool',
      attributes: { friendly_name: 'Test AC', hvac_modes: ['off', 'cool', 'heat', 'dry', 'fan_only'], min_temp: 16, max_temp: 30, target_temp_step: 0.5, current_temperature: 26.5, temperature: 22, hvac_action: 'cooling', fan_modes: ['auto', 'quiet', '1', '2', '3'], fan_mode: 'auto', swing_modes: ['stop', 'swing'], swing_mode: 'stop', preset_modes: ['none', 'boost'], preset_mode: 'none', supported_features: 441 },
    }),
  )
  await p.evaluate((id) => window.__homescape.getState().layout.updateItem(id, { entityId: 'climate.test_ac' }), ac.id)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ac.id)
  await p.waitForTimeout(400)
  const dial = await p.isVisible('aside [role="slider"][aria-label="Target temperature"]')
  await p.click('aside [data-hvac="heat"]')
  await p.click('aside button:text-is("3")')
  await p.click('aside button:text-is("Swing")')
  await p.click('aside button:text-is("Boost")')
  await p.click('aside button[aria-label="Increase"]')
  await p.waitForTimeout(1200)
  const ent = await p.evaluate(() => window.__homescape.entity('climate.test_ac'))
  ok(dial && ent.state === 'heat' && ent.attributes.fan_mode === '3' && ent.attributes.swing_mode === 'swing' && ent.attributes.preset_mode === 'boost' && ent.attributes.temperature === 22.5, `Climate card: dial, mode (Heat), fan (3), vane (Swing), preset (Boost), + raises the target to 22.5° (${ent.state}, ${ent.attributes.fan_mode}, ${ent.attributes.temperature})`)
  // A boiler thermostat that only supports heat and off shows just those modes, with no fan or vane
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'climate.boiler_thermostat', state: 'heat', attributes: { friendly_name: 'Boiler Thermostat', hvac_modes: ['off', 'heat'], hvac_action: 'heating', current_temperature: 21, temperature: 23 } }))
  const boilerItem = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const room = s.addRoom({ name: 'Boiler test', floor: 'wood', x: 120, z: 0, w: 3, d: 3 })
    return { room, id: s.addItem('boiler', 121.2, 0.23, 0, 'climate.boiler_thermostat') }
  })
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), boilerItem.id)
  await p.waitForTimeout(300)
  const modes = await p.locator('aside [data-hvac]').count()
  ok(modes === 2 && !(await p.isVisible('aside >> text=Fan')), `A boiler shows only the supported modes (Heat, Off), with no fan or vane (${modes} modes)`)
  await p.evaluate(({ room, id }) => {
    const s = window.__homescape.getState().layout
    window.__homescape.select(null)
    s.deleteItem(id)
    s.deleteRoom(room)
  }, boilerItem)
  await p.evaluate(({ id, e }) => window.__homescape.getState().layout.updateItem(id, { entityId: e }), { id: ac.id, e: prevAc })
  await p.evaluate(() => window.__homescape.select(null))

  // Security: the modes HA supports (14: away, night, trigger) plus Disarmed; Trigger floods the house with red alarm light
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'alarm_control_panel.house_alarm', state: 'disarmed', attributes: { friendly_name: 'Home Alarm', supported_features: 14, code_format: null, code_arm_required: false } }))
  await p.waitForTimeout(200)
  if (await p.isVisible('#kpi-security')) {
    await p.click('#kpi-security')
    await p.waitForTimeout(200)
    const labels = await p.locator('[aria-label="Security mode"] [data-alarm]').evaluateAll((els) => els.map((e) => e.getAttribute('data-alarm')))
    ok(labels.join(',') === 'disarmed,armed_away,armed_night,triggered', `Security modes as in HA: Disarmed, Away, Night, Trigger (${labels.join(', ')})`)
    await p.click('[aria-label="Security mode"] [data-alarm="armed_away"]')
    await p.waitForTimeout(250)
    const away = await p.isVisible('#kpi-security >> text=Away')
    await p.click('[aria-label="Security mode"] [data-alarm="triggered"]')
    await p.waitForTimeout(400)
    const banner = await p.isVisible('[role="alert"] >> text=Alarm is sounding')
    const alarmLights = (await p.evaluate(() => window.__homescape.roomLights())).filter((l) => l.alarm).length
    const rooms = (await level()).rooms.length
    await p.click('[role="alert"] button:has-text("Disarm alarm")')
    await p.waitForTimeout(300)
    ok(away && banner && alarmLights === Math.min(16, rooms) && !(await p.isVisible('[role="alert"]')), `Away can be set; Trigger gives a red alarm light in every room (${alarmLights}/${rooms}) and an "Alarm is sounding" strip; "Disarm alarm" turns it off`)
    await p.click('#kpi-security')
  } else ok(false, 'The security tile is not visible')

  // People: motion in two rooms -> at least two people in those rooms; Night -> in bed; Away -> outside
  // Lights that earlier tests just turned on must not count as "fresh" hints: make the lit lights old (on for a long time)
  // The random motion pulse of the demo must not make the test depend on luck: the demo motion sensors are unavailable in this block
  const demoSensors = await p.evaluate(() => {
    const out = []
    for (const id of window.__homescape.entityIds()) {
      const e = window.__homescape.entity(id)
      // Lights, plugs, climate, media and other devices (someone goes to press a device that was just turned on: people.ts > touchSpots)
      if (!id.startsWith('binary_sensor.') && !id.startsWith('sun.')) window.__homescape.setEntity({ ...e, last_changed: '2020-01-01T00:00:00Z' })
      if (id.startsWith('binary_sensor.') && ['motion', 'occupancy', 'presence', 'vibration'].includes(e.attributes.device_class)) {
        out.push(e)
        window.__homescape.setEntity({ ...e, state: 'unavailable' })
      }
    }
    return out
  })
  const roomNames = async (ids) => {
    const lv = await level()
    return ids.map((id) => lv.rooms.find((r) => r.id === id)?.name ?? id).join(', ')
  }
  L = await level()
  const roomsP = L.rooms.filter((r) => !/entr/i.test(r.name)).slice(0, 3)
  const sens = await p.evaluate((rs) => {
    const s = window.__homescape.getState().layout
    return rs.map((r, k) => {
      const id = `binary_sensor.t_motion_${k}`
      window.__homescape.setEntity({ entity_id: id, state: 'on', attributes: { friendly_name: `Motion ${k}`, device_class: 'motion' } })
      return s.addItem('motionSensor', r.x + r.w / 2, r.z + r.d / 2, 0, id)
    })
  }, roomsP)
  await p.waitForTimeout(400)
  let pp = await p.evaluate(() => window.__homescape.people())
  const inRooms = roomsP.every((r) => pp.plan.spots.some((sp) => sp.roomId === r.id))
  ok(pp.plan.mode === 'home' && pp.plan.count === 3 && inRooms && roomsP.every((r) => pp.plan.active.includes(r.id)), `Motion in three rooms at once: 3 people, each in a room with motion (${pp.plan.count} people, ${pp.plan.spots.map((x) => x.pose).join(', ')}; active: ${await roomNames(pp.plan.active)})`)
  // Someone sitting on the sofa is on top of the cushion (0.49 m), not sunk into it; the back leans slightly
  const sofa = L.items.find((i) => i.kind === 'sofa')
  const onSofa = sofa && pp.plan.spots.find((x) => x.pose === 'sit' && Math.hypot(x.x - sofa.x, x.z - sofa.z) < 1.1)
  ok(!sofa || (onSofa && Math.abs(onSofa.y - (sofa.y ?? 0) - 0.48) < 0.01 && onSofa.lean > 0), `Someone sitting on the sofa is on top of the cushion, not sunk into it (seat ${onSofa ? onSofa.y : 'none'} m)`)
  await p.waitForTimeout(9000)
  pp = await p.evaluate(() => window.__homescape.people())
  ok(pp.persons.length === 3 && pp.persons.filter((x) => !x.walking).length >= 1, `People are in the scene and walking to their places (${pp.persons.map((x) => `${x.pose}${x.walking ? '*' : ''}`).join(', ')})`)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'alarm_control_panel.house_alarm', state: 'armed_night', attributes: { friendly_name: 'Home Alarm', supported_features: 14 } }))
  await p.evaluate(() => {
    for (let k = 0; k < 3; k++) window.__homescape.setEntity({ entity_id: `binary_sensor.t_motion_${k}`, state: 'off', attributes: { device_class: 'motion' }, last_changed: '2020-01-01T00:00:00Z' })
  })
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  const lying = pp.plan.spots.filter((x) => x.pose === 'lie').length
  ok(pp.plan.mode === 'sleep' && lying >= 1, `In Night mode people are in bed (${lying} lying, ${pp.plan.count} people; active: ${await roomNames(pp.plan.active)})`)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'alarm_control_panel.house_alarm', state: 'armed_away', attributes: { friendly_name: 'Home Alarm', supported_features: 14 } }))
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  ok(pp.plan.mode === 'away' && pp.plan.spots.every((x) => x.roomId === null), `In Away mode everyone is outside the house (${pp.plan.count} people)`)
  await p.click('button[title^="People:"]')
  await p.click('#people-panel button:text-is("4")')
  await p.waitForTimeout(200)
  pp = await p.evaluate(() => window.__homescape.people())
  const status = await p.locator('#people-status').innerText()
  ok(pp.plan.count === 4 && /Out · 4 people/.test(status), `The household can be set to 4 from the panel (${status})`)
  await p.click('#people-panel button:text-is("2")')
  await p.click('button[title^="People:"]')
  // Light: someone goes to the room of a light that is turned on and leaves when it is turned off (even without a motion sensor)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'alarm_control_panel.house_alarm', state: 'disarmed', attributes: { friendly_name: 'Home Alarm', supported_features: 14 } }))
  const lr = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setEntity({ entity_id: 'light.t_room_light', state: 'on', attributes: { friendly_name: 'Room light', brightness: 255 } })
    const room = s.addRoom({ name: 'Lit room', floor: 'wood', x: 70, z: 0, w: 3, d: 3 })
    return { room, lamp: s.addItem('pendant', 71.5, 1.5, 0, 'light.t_room_light') }
  })
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  const onIn = pp.plan.active.includes(lr.room) && pp.plan.spots.some((x) => x.roomId === lr.room)
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.t_room_light', state: 'off', attributes: { friendly_name: 'Room light' } }))
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  const offOut = !pp.plan.active.includes(lr.room) && !pp.plan.spots.some((x) => x.roomId === lr.room)
  ok(onIn && offOut, 'Someone goes to a room whose light was just turned on and leaves when the light goes off')
  // When a desk lamp is turned on, a person sits on the chair of that desk
  const deskLamp = (await level()).items.find((i) => i.kind === 'deskLamp' && i.entityId)
  if (deskLamp) {
    await p.evaluate((id) => window.__homescape.setEntity({ entity_id: id, state: 'on', attributes: { friendly_name: 'Desk lamp' } }), deskLamp.entityId)
    await p.waitForTimeout(300)
    pp = await p.evaluate(() => window.__homescape.people())
    const atDesk = pp.plan.spots.find((x) => x.pose === 'sit' && Math.hypot(x.x - deskLamp.x, x.z - deskLamp.z) < 1.6)
    ok(Boolean(atDesk), `When the desk lamp turns on someone sits at that desk (${atDesk ? Math.hypot(atDesk.x - deskLamp.x, atDesk.z - deskLamp.z).toFixed(2) + ' m' : 'none'})`)
    await p.evaluate((id) => window.__homescape.setEntity({ entity_id: id, state: 'off', attributes: { friendly_name: 'Desk lamp' } }), deskLamp.entityId)
  } else ok(true, 'No desk lamp in the plan (desk check skipped)')
  // A light left on for a long time is a weak hint: it does not raise the count
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.t_room_light', state: 'on', attributes: { friendly_name: 'Room light' }, last_changed: '2020-01-01T00:00:00Z' }))
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  ok(pp.plan.lit.includes(lr.room) && !pp.plan.active.includes(lr.room) && pp.plan.count === 2, `A light left on does not raise the number of people, it is a weak hint (${pp.plan.count} people)`)
  await p.evaluate(({ room, lamp }) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(lamp)
    s.deleteRoom(room)
  }, lr)
  // When a computer is on (Ping) someone sits at it; a second computer on the same desk is not a second person; they get up when it turns off
  const pc = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    const ping = (id, name) => window.__homescape.setEntity({ entity_id: id, state: 'on', attributes: { friendly_name: name, device_class: 'connectivity' } })
    ping('binary_sensor.t_mac', 'Mac')
    ping('binary_sensor.t_windows', 'Windows PC')
    const room = s.addRoom({ name: 'Computer room', floor: 'wood', x: 80, z: 0, w: 3, d: 3 })
    return {
      room,
      ids: [s.addItem('desk', 81.5, 0.5, 0), s.addItem('computer', 81.2, 0.45, 0, 'binary_sensor.t_mac'), s.addItem('monitor', 81.8, 0.4, 0, 'binary_sensor.t_windows')],
      chair: { id: s.addItem('chair', 81.5, 1.25, Math.PI), x: 81.5, z: 1.25 },
    }
  })
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  const atPc = pp.plan.spots.filter((x) => x.roomId === pc.room)
  const seated = atPc.length === 1 && atPc[0].pose === 'sit' && Math.hypot(atPc[0].x - pc.chair.x, atPc[0].z - pc.chair.z) < 0.1
  const pcCount = pp.plan.count
  await p.evaluate(() => {
    for (const id of ['binary_sensor.t_mac', 'binary_sensor.t_windows']) window.__homescape.setEntity({ entity_id: id, state: 'off', attributes: { device_class: 'connectivity' } })
  })
  await p.waitForTimeout(300)
  pp = await p.evaluate(() => window.__homescape.people())
  const leftPc = !pp.plan.desk.includes(pc.room) && !pp.plan.spots.some((x) => x.roomId === pc.room)
  ok(seated && pcCount === 2 && leftPc, `While the computer is on someone sits in the chair at it, two computers on one desk are one person, and they get up when it turns off (${atPc.map((x) => x.pose).join(', ') || 'nobody'}, ${pcCount} people)`)
  await p.evaluate(({ room, ids, chair }) => {
    const s = window.__homescape.getState().layout
    for (const id of [...ids, chair.id]) s.deleteItem(id)
    s.deleteRoom(room)
  }, pc)
  // Motion or a light in the room with a toilet: someone sits on the toilet (not standing in front of the washbasin)
  const wc = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setEntity({ entity_id: 'binary_sensor.t_wc_motion', state: 'on', attributes: { friendly_name: 'WC motion', device_class: 'motion' } })
    window.__homescape.setEntity({ entity_id: 'light.t_wc_light', state: 'off', attributes: { friendly_name: 'WC light' } })
    const room = s.addRoom({ name: 'Toilet', floor: 'tile', x: 90, z: 0, w: 2.5, d: 2.5 })
    // The toilet is on the back wall (local +z faces the room), the washbasin on the side wall
    const ids = [s.addItem('toilet', 90.8, 0.33, 0), s.addItem('washbasin', 92.29, 1.5, -Math.PI / 2), s.addItem('motionSensor', 91.25, 2.4, Math.PI, 'binary_sensor.t_wc_motion'), s.addItem('pendant', 91.25, 1.25, 0, 'light.t_wc_light')]
    return { room, ids, seat: { x: 90.8, z: 0.33 + 0.04 } }
  })
  await p.waitForTimeout(300)
  const onWc = async () => {
    const pl = (await p.evaluate(() => window.__homescape.people())).plan
    return pl.spots.find((x) => x.roomId === wc.room && x.pose === 'sit' && Math.hypot(x.x - wc.seat.x, x.z - wc.seat.z) < 0.05 && Math.abs(x.y - 0.43) < 0.01)
  }
  const byMotion = Boolean(await onWc())
  // The motion sensor is ignored; turning on only the light puts them on the toilet too
  await p.evaluate(() => {
    window.__homescape.setEntity({ entity_id: 'binary_sensor.t_wc_motion', state: 'unavailable', attributes: { device_class: 'motion' } })
    window.__homescape.setEntity({ entity_id: 'light.t_wc_light', state: 'on', attributes: { friendly_name: 'WC light', brightness: 255 } })
  })
  await p.waitForTimeout(300)
  const byLight = Boolean(await onWc())
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'light.t_wc_light', state: 'off', attributes: { friendly_name: 'WC light' } }))
  await p.waitForTimeout(300)
  const gone = !(await p.evaluate(() => window.__homescape.people())).plan.spots.some((x) => x.roomId === wc.room)
  ok(byMotion && byLight && gone, `With motion or a light in the room with a toilet someone sits on it, and gets up when the light goes off (motion: ${byMotion}, light: ${byLight}, empty when off: ${gone})`)
  await p.evaluate(({ room, ids }) => {
    const s = window.__homescape.getState().layout
    for (const id of ids) s.deleteItem(id)
    s.deleteRoom(room)
  }, wc)
  // People do chores at their spots (user request: "they do no work at all"): by the item at the spot and the room
  const acts = await p.evaluate(async () => {
    const m = await import('/src/model/people.ts')
    const s = window.__homescape.getState().layout
    window.__homescape.setEntity({ entity_id: 'media_player.t_chore_tv', state: 'playing', attributes: { friendly_name: 'TV' } })
    const room = s.addRoom({ name: 'Chore room', floor: 'tile', x: 96, z: 0, w: 4, d: 4 })
    const ids = [s.addItem('diningTable', 97, 2, 0), s.addItem('tv', 99, 0.35, 0, 'media_player.t_chore_tv')]
    const st = window.__homescape.getState().layout
    const lv = st.layout.levels.find((l) => l.id === st.levelId) ?? st.layout.levels[0]
    const ents = Object.fromEntries(window.__homescape.entityIds().map((id) => [id, window.__homescape.entity(id)]))
    const sp = (use, x, z, pose = 'stand') => ({ x, z, y: 0, rot: 0, pose, roomId: room, use })
    const cases = [
      ['kitchenCounter', sp('kitchenCounter', 97, 1)],
      ['stove', sp('stove', 97, 1)],
      ['sink', sp('sink', 97, 1)],
      ['washbasin', sp('washbasin', 97, 1)],
      ['fridge', sp('fridge', 97, 1)],
      ['dresser', sp('dresser', 97, 1)],
      ['chair', sp('chair', 97, 2.6, 'sit')],
      ['sofa', sp('sofa', 98.5, 3, 'sit')],
      ['bed', sp('bed', 98, 3, 'lie')],
      ['toilet', sp('toilet', 98, 3, 'sit')],
    ]
    const out = Object.fromEntries(cases.map(([k, spot]) => [k, m.activityFor(spot, 0, lv, ents, 0)]))
    for (const id of ids) s.deleteItem(id)
    s.deleteRoom(room)
    return out
  })
  const want = { kitchenCounter: 'cook', stove: 'stir', sink: 'wash', washbasin: 'brush', fridge: 'fridge', dresser: 'fold', chair: 'eat', sofa: 'tv', bed: 'sleep', toilet: 'phone' }
  const wrong = Object.entries(want).filter(([k, v]) => acts[k] !== v)
  const live = (await p.evaluate(() => window.__homescape.people())).persons
  ok(!wrong.length && live.every((x) => typeof x.activity === 'string'), `People do chores at their spots: chop at the counter, stir at the stove, wash at the sink, brush teeth at the washbasin, look in the fridge, fold, eat at the dining table, watch the TV when it is on, sleep in bed, check the phone on the toilet${wrong.length ? ` (wrong: ${wrong.map(([k]) => `${k}=${acts[k]}`).join(', ')})` : ''}; in the scene: ${live.map((x) => x.activity).join(', ')}`)
  await p.evaluate(({ ids, demo }) => {
    const s = window.__homescape.getState().layout
    for (const id of ids) s.deleteItem(id)
    for (const e of demo) window.__homescape.setEntity({ ...e, state: 'off' })
    window.__homescape.setEntity({ entity_id: 'alarm_control_panel.house_alarm', state: 'disarmed', attributes: { friendly_name: 'Home Alarm', supported_features: 14 } })
    window.__homescape.setMode('edit')
  }, { ids: sens, demo: demoSensors })
  await p.waitForTimeout(200)
}

// --- An item behind a wall cannot be clicked (a visible wall in front cuts the event); it can when the inner wall is low ---
{
  const w = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('view')
    const a = s.addRoom({ name: 'Wall A', floor: 'wood', x: 100, z: 0, w: 4, d: 4 })
    const b = s.addRoom({ name: 'Wall B', floor: 'wood', x: 104, z: 0, w: 4, d: 4 })
    // In view mode only bound items are clickable: a (demo) plug is bound to the armchair
    window.__homescape.setEntity({ entity_id: 'switch.t_armchair', state: 'off', attributes: { friendly_name: 'Armchair plug' } })
    return { a, b, sofa: s.addItem('armchair', 103.45, 2, -Math.PI / 2, 'switch.t_armchair') }
  })
  await p.evaluate((id) => window.__homescape.focusRoom(id), w.b)
  await p.waitForTimeout(1800)
  const cam = await p.evaluate(() => window.__homescape.camera())
  const pt = await p.evaluate(() => window.__homescape.project(103.45, 0.45, 2))
  await p.evaluate(() => window.__homescape.select(null))
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(250)
  const blocked = (await p.evaluate(() => window.__homescape.getState().layout.selection))?.id !== w.sofa
  await p.click('button[title^="Inner walls at full height"]')
  await p.waitForTimeout(900)
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(250)
  const picked = (await p.evaluate(() => window.__homescape.getState().layout.selection))?.id === w.sofa
  await p.click('button[title^="Inner walls low"]')
  ok(cam.target[0] > 100 && blocked && picked, `The armchair behind the wall cannot be clicked; it can when the inner wall is low (${blocked}, ${picked})`)
  await p.evaluate((w) => {
    const s = window.__homescape.getState().layout
    s.deleteItem(w.sofa)
    s.deleteRoom(w.a)
    s.deleteRoom(w.b)
    window.__homescape.select(null)
    window.__homescape.setMode('edit')
  }, w)
  await p.keyboard.press('f')
  await p.waitForTimeout(1200)
}

// --- Window size and full-height window ---
{
  const ids = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('edit')
    const room = s.addRoom({ name: 'Window test', floor: 'wood', x: 50, z: 0, w: 6, d: 4 })
    return { room, win: s.addItem('window', 51.5, 0.21, 0) }
  })
  const setRange = (sel, v) =>
    p.locator(sel).evaluate((el, val) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.win)
  await p.waitForTimeout(300)
  await setRange(`#len-${ids.win}`, 2)
  await setRange(`#len2-${ids.win}`, 1.5)
  await p.waitForTimeout(200)
  let w = (await level()).items.find((i) => i.id === ids.win)
  const ap = await p.evaluate(async (w) => (await import('/src/model/geometry.ts')).apertureOf(w), w)
  ok(w.len === 2 && w.len2 === 1.5 && Math.abs(ap.half - 0.98) < 1e-9 && Math.abs(ap.y1 - 2.4) < 1e-9, `The window width and height change, and so does the opening in the wall (${(ap.half * 2).toFixed(2)} × ${(ap.y1 - ap.y0).toFixed(2)} m)`)
  await setRange(`#len2-${ids.win}`, 2.3)
  await p.waitForTimeout(200)
  w = (await level()).items.find((i) => i.id === ids.win)
  ok(w.len2 === 1.5 && /doesn't fit/.test((await placement()).notice ?? ''), 'A window height that would stick out through the ceiling is rejected')
  await p.click('aside button:text-is("Full height")')
  await p.waitForTimeout(200)
  w = (await level()).items.find((i) => i.id === ids.win)
  ok(w.len2 === 2.1 && w.y === -0.82, 'With "Full height" on the card the window is 8 cm off the floor and 2.1 m tall')
  // "Full-height window" from the build bar: drop it on the back wall
  await p.evaluate(() => window.__homescape.select(null))
  await p.evaluate((id) => window.__homescape.focusRoom(id), ids.room)
  await p.waitForTimeout(1500)
  await p.click('nav[aria-label="Build bar"] button:has-text("Doors and windows")')
  const fc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Full-height window"))').first()
  const fb = await fc.boundingBox()
  await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
  await p.mouse.down()
  const t = await project(54, 0.3)
  await p.mouse.move(t.x, t.y, { steps: 8 })
  await p.waitForTimeout(250)
  const r = (await placement()).result
  await p.mouse.up()
  await p.waitForTimeout(300)
  const full = (await level()).items.find((i) => i.kind === 'window' && i.id !== ids.win && i.x > 50)
  ok(r?.ok && r.y === -0.82 && full?.len2 === 2.1 && full?.y === -0.82, `The "Full-height window" card puts a full-height window on the wall (${full ? `${full.len2} m, off the floor ${(0.9 + full.y).toFixed(2)} m` : r?.reason})`)
  await p.evaluate((id) => {
    window.__homescape.select(null)
    window.__homescape.getState().layout.deleteRoom(id)
  }, ids.room)
  await p.keyboard.press('f')
  await p.waitForTimeout(1500)
}

// --- Kitchen counter: length, L shape, LED; ceiling LED strip and downlight ---
{
  const setRange = (sel, v) =>
    p.locator(sel).evaluate((el, val) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
  const putCard = async (tab, label, pts) => {
    await p.click(`nav[aria-label="Build bar"] button:has-text("${tab}")`)
    const c = p.locator(`nav[aria-label="Build bar"] button:has(span:text-is("${label}"))`).first()
    await c.scrollIntoViewIfNeeded()
    const bb = await c.boundingBox()
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await p.mouse.down()
    let r = null
    for (const [x, z] of pts) {
      const t = await project(x, z)
      await p.mouse.move(t.x, t.y, { steps: 6 })
      await p.waitForTimeout(160)
      r = (await placement()).result
      if (r?.ok) break
    }
    await p.mouse.up()
    await p.waitForTimeout(350)
    return r
  }
  L = await level()
  const kitc = L.rooms.find((r) => /kitchen/i.test(r.name))
  const ctr = L.items.find((i) => i.kind === 'kitchenCounter')
  // Remove what earlier tests put in the kitchen: make room for the L arm
  await p.evaluate(
    (ids) => ids.forEach((id) => window.__homescape.getState().layout.deleteItem(id)),
    L.items.filter((i) => i.id !== ctr.id && !['door', 'window'].includes(i.kind) && roomAt(L, i.x, i.z)?.id === kitc.id).map((i) => i.id),
  )
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ctr.id)
  await p.waitForTimeout(300)
  await setRange(`#len-${ctr.id}`, 1.6)
  await p.waitForTimeout(200)
  ok((await level()).items.find((i) => i.id === ctr.id).len === 1.6, 'The counter length is set to 1.6 m with the slider')
  const along = Math.abs(Math.sin(ctr.rot)) < 0.5 ? kitc.w : kitc.d
  if (along < 3.9) {
    await setRange(`#len-${ctr.id}`, 4)
    await p.waitForTimeout(200)
    ok((await level()).items.find((i) => i.id === ctr.id).len === 1.6 && (await p.isVisible("text=doesn't fit")), `A length that does not fit the room (4 m, wall ${along.toFixed(1)} m) is rejected`)
  }
  ok(!(await p.isVisible(`#len2-${ctr.id}`)), 'A straight counter has no L arm setting')
  await p.click('aside button:has-text("L (right corner)")')
  await p.waitForTimeout(200)
  if ((await level()).items.find((i) => i.id === ctr.id).variant !== 'lRight') await p.click('aside button:has-text("L (left corner)")')
  await p.waitForTimeout(200)
  let c2 = (await level()).items.find((i) => i.id === ctr.id)
  ok(c2.variant === 'lRight' || c2.variant === 'lLeft', `The counter can be made L-shaped (${c2.variant})`)
  ok(await p.isVisible(`#len2-${ctr.id}`), 'An L counter shows the arm length slider')
  await setRange(`#len2-${ctr.id}`, 1.5)
  await p.waitForTimeout(200)
  c2 = (await level()).items.find((i) => i.id === ctr.id)
  ok(c2.len2 === 1.5, 'The L arm is set to 1.5 m')
  const across = Math.abs(Math.sin(ctr.rot)) < 0.5 ? kitc.d : kitc.w
  if (across < 3.9) {
    await setRange(`#len2-${ctr.id}`, 4)
    await p.waitForTimeout(200)
    ok((await level()).items.find((i) => i.id === ctr.id).len2 === 1.5, `An L arm that sticks out of the room (4 m) is rejected`)
  }
  await p.click('aside button:has-text("Under wall cabinets")')
  await p.waitForTimeout(200)
  ok((await level()).items.find((i) => i.id === ctr.id).led === 'under', 'The counter LED turns on (under wall cabinets)')
  await p.evaluate(() => window.__homescape.select(null))
  await p.waitForTimeout(200)
  // The inside corner of the L is empty: a plant can go there, but not on top of the arm
  const sx = c2.variant === 'lRight' ? 1 : -1
  const D = 0.62
  const local = (lx, lz) => [c2.x + lx * Math.cos(c2.rot) + lz * Math.sin(c2.rot), c2.z - lx * Math.sin(c2.rot) + lz * Math.cos(c2.rot)]
  await p.click('nav[aria-label="Build bar"] button:has-text("Furniture")')
  const plc = p.locator('nav[aria-label="Build bar"] button:has(span:text-is("Potted plant"))').first()
  await plc.scrollIntoViewIfNeeded()
  const plb = await plc.boundingBox()
  await p.mouse.move(plb.x + plb.width / 2, plb.y + plb.height / 2)
  await p.mouse.down()
  const legPt = await project(...local(sx * (0.8 - D / 2), D / 2 + 0.5))
  await p.mouse.move(legPt.x, legPt.y, { steps: 8 })
  await p.waitForTimeout(200)
  const onLeg = (await placement()).result
  const cornerPt = await project(...local(sx * (0.8 - D - 0.33), D / 2 + 0.33))
  await p.mouse.move(cornerPt.x, cornerPt.y, { steps: 8 })
  await p.waitForTimeout(200)
  const inCorner = (await placement()).result
  await p.mouse.up()
  await p.waitForTimeout(300)
  ok(onLeg?.ok === false && inCorner?.ok === true, `The top of the L arm is occupied and the inside corner is free: the plant goes in the inside corner (${onLeg?.reason ?? 'arm counted as free'})`)
  await p.screenshot({ path: 'shots/home-counter-l.png' })

  // A ceiling LED strip covers the room it is dropped in (15 cm in from the edges)
  L = await level()
  const bedc = L.rooms.find((r) => /bedroom/i.test(r.name))
  const sr = await putCard('Lights', 'Ceiling LED strip', [[bedc.x + bedc.w / 2, bedc.z + bedc.d / 2]])
  const strip = (await level()).items.find((i) => i.kind === 'ceilingStrip')
  const host = [bedc, ...(bedc.parts ?? [])].find((r) => sr && sr.x >= r.x && sr.x <= r.x + r.w && sr.z >= r.z && sr.z <= r.z + r.d) ?? bedc
  ok(
    sr?.ok && strip && Math.abs(strip.len - (host.w - 0.3)) < 0.01 && Math.abs(strip.len2 - (host.d - 0.3)) < 0.01 && Math.abs(strip.x - (host.x + host.w / 2)) < 0.01,
    `The ceiling LED strip fits the room (${strip?.len?.toFixed(2)} × ${strip?.len2?.toFixed(2)} m, room ${host.w} × ${host.d})`,
  )
  // A downlight on the ceiling: it can go right above the bed and inside the strip, and two downlights fit side by side
  const bed = L.items.find((i) => i.kind === 'bed' && roomAt(L, i.x, i.z)?.id === bedc.id) ?? L.items.find((i) => i.kind === 'bed')
  const s1 = await putCard('Lights', 'Downlight', [[bed.x, bed.z]])
  const s2 = await putCard('Lights', 'Downlight', [[bed.x + 0.6, bed.z], [bed.x - 0.6, bed.z], [bed.x, bed.z + 0.6]])
  const spots = (await level()).items.filter((i) => i.kind === 'downlight')
  ok(s1?.ok && s2?.ok && spots.length === 2, 'A downlight goes on the ceiling above the bed; a second one can be added beside it')
  await p.evaluate(() => window.__homescape.select(null))
}

// --- Walls are centered on the boundary: a wall item sticks to the inner face (5 cm from the boundary), a door stays relative to the boundary ---
{
  const g = await p.evaluate(async () => {
    const m = await import('/src/model/geometry.ts')
    const room = { id: 'r', name: 'R', floor: 'wood', x: 0, z: 0, w: 4, d: 3 }
    const pic = m.wallSnap([room], 2, 0.3, 0.05, 0.6, 0.8)
    const door = m.wallSnap([room], 2, 0.3, 0.2, 0.6, 1, true)
    return { WALL_IN: m.WALL_IN, pic: pic?.z, door: door?.z }
  })
  ok(g.WALL_IN === 0.05 && Math.abs(g.pic - (0.05 + 0.025 + 0.01)) < 1e-9 && Math.abs(g.door - 0.21) < 1e-9, `A wall item sticks to the inner face of the centered wall (painting ${g.pic?.toFixed(3)} m), the door is relative to the room boundary (${g.door} m)`)
}

// --- Night/day transition, room lights (do not pass through walls, fill the room), ceiling strip, selection outline ---
{
  const perfNow = () => p.evaluate(() => window.__homescape.perf())
  await p.evaluate(() => window.__homescape.setTheme('night'))
  await p.waitForTimeout(1500)
  const night = (await perfNow()).skyBlend
  await p.evaluate(() => window.__homescape.setTheme('day'))
  await p.waitForTimeout(1500)
  const day = (await perfNow()).skyBlend
  ok(night === 1 && day === 0, `Night to day switches completely (night ${night}, day ${day})`)

  // A lamp in the plan: turn it on from the view card, its light must stay inside its own room only
  L = await level()
  const lamp = L.items.find((i) => ['pendant', 'wallLight', 'floorLamp'].includes(i.kind) && i.entityId && roomAt(L, i.x, i.z))
  const lampRoom = roomAt(L, lamp.x, lamp.z)
  await p.evaluate(() => window.__homescape.setMode('view'))
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), lamp.id)
  await p.waitForTimeout(300)
  if (await p.isVisible('aside button:text-is("Turn on")')) await p.click('aside button:text-is("Turn on")')
  await p.waitForTimeout(400)
  const near = (a, b) => Math.abs(a - b) < 1e-6
  const lights = await p.evaluate(() => window.__homescape.roomLights())
  const own = lights.find((l) => l.type === 0 && near(l.rects[0]?.x, lampRoom.x) && near(l.rects[0]?.z, lampRoom.z))
  ok(Boolean(own) && own.rects.length === 1 + (lampRoom.parts?.length ?? 0) && own.range >= 5, `The light of the lamp that was turned on stays only in its own room (${lampRoom.name}), range ${own?.range.toFixed(1)} m`)
  if (lamp.kind === 'floorLamp' || lamp.kind === 'wallLight') ok(own.range >= 8, `Floor lamps and wall lights shine farther (${own.range} m)`)
  // A ceiling strip bound to the same light: a room-long light covering the whole room
  await p.evaluate(({ room, id }) => window.__homescape.getState().layout.addItem('ceilingStrip', room.x + room.w / 2, room.z + room.d / 2, 0, id), { room: lampRoom, id: lamp.entityId })
  await p.waitForTimeout(400)
  const strip = (await p.evaluate(() => window.__homescape.roomLights())).find((l) => l.type === 2)
  ok(Boolean(strip) && near(strip.rects[0].x, lampRoom.x) && near(strip.rects[0].w, lampRoom.w) && near(strip.rects[0].d, lampRoom.d), 'The ceiling LED strip lights the whole room from above (room-long light)')
  await p.keyboard.press('Meta+z')
  await p.evaluate(() => window.__homescape.select(null))
  await p.evaluate(() => window.__homescape.setMode('edit'))

  // Light through a door: two rooms side by side far away, a door between them, a pendant bound to the same (on) lamp in one of them
  const far = await p.evaluate((ent) => {
    const s = window.__homescape.getState().layout
    const a = s.addRoom({ name: 'Light A', floor: 'tile', x: 30, z: 0, w: 4, d: 4 })
    const b = s.addRoom({ name: 'Light B', floor: 'tile', x: 34, z: 0, w: 4, d: 4 })
    s.addItem('door', 34 - 0.21, 2, -Math.PI / 2)
    s.addItem('pendant', 32, 2, 0, ent)
    return { a, b }
  }, lamp.entityId)
  await p.waitForTimeout(400)
  const spill = (await p.evaluate(() => window.__homescape.roomLights())).find((l) => l.portal && near(l.rects[0].x, 34))
  ok(Boolean(spill) && !spill.portal.horizontal && near(spill.portal.line, 34) && near(spill.portal.a0, 1.54) && near(spill.portal.a1, 2.46), 'Light passes through the open inner door into the next room (only through the door opening)')
  await p.evaluate(({ a, b }) => {
    const s = window.__homescape.getState().layout
    s.deleteRoom(a)
    s.deleteRoom(b)
  }, far)
  await p.waitForTimeout(300)

  // Light limit (HS_MAX; written for 16, now 24 for walk-through windows): with 9 downlights on in one room, the spill through the door must not push the next room's desk lamp off the list;
  // spills through the same door are merged into one light (user feedback: when 3 lights were turned on in the entrance, the desk lamp went out)
  const busy = await p.evaluate(() => {
    window.__homescape.setEntity({ entity_id: 'light.test_spot', state: 'on', attributes: { friendly_name: 'Test spot', brightness: 255 } })
    window.__homescape.setEntity({ entity_id: 'light.test_desk', state: 'on', attributes: { friendly_name: 'Test desk lamp', brightness: 255 } })
    const s = window.__homescape.getState().layout
    const before = new Set(s.layout.levels[0].items.map((i) => i.id))
    const a = s.addRoom({ name: 'Spots', floor: 'tile', x: 30, z: 0, w: 4, d: 4 })
    const b = s.addRoom({ name: 'Study', floor: 'tile', x: 34, z: 0, w: 4, d: 4 })
    s.addItem('door', 34 - 0.21, 2, -Math.PI / 2)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s.addItem('downlight', 30.8 + i * 1.2, 0.8 + j * 1.2, 0, 'light.test_spot')
    s.addItem('deskLamp', 36, 2, 0, 'light.test_desk')
    const added = window.__homescape.getState().layout.layout.levels[0].items.filter((i) => !before.has(i.id)).map((i) => i.id)
    return { a, b, added }
  })
  await p.waitForTimeout(400)
  const many = await p.evaluate(() => window.__homescape.roomLights())
  const hsMax = await p.evaluate(async () => (await import('/src/scene/roomLights.ts')).HS_MAX)
  const deskLight = many.find((l) => !l.portal && Math.abs(l.pos[0] - 36) < 0.2 && Math.abs(l.pos[2] - 2.1) < 0.2)
  const intoB = many.filter((l) => l.portal && near(l.rects[0].x, 34))
  ok(Boolean(deskLight) && intoB.length === 1 && many.length <= hsMax, `With many lights on the desk lamp does not go out; 9 spots spilling through the same door are one light (${many.length}/${hsMax} lights, through the door ${intoB.length})`)
  await p.evaluate(({ a, b, added }) => {
    const s = window.__homescape.getState().layout
    for (const id of added) s.deleteItem(id)
    s.deleteRoom(a)
    s.deleteRoom(b)
  }, busy)
  await p.waitForTimeout(300)

  // Selection: a single selection adds an outline to the edge of the object, and it goes away when the selection clears
  const chairLike = L.items.find((i) => i.kind === 'armchair') ?? L.items.find((i) => i.kind === 'sofa')
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), chairLike.id)
  await p.waitForTimeout(500)
  const on = (await perfNow()).outlines
  await p.evaluate(() => window.__homescape.select(null))
  await p.waitForTimeout(400)
  const off = (await perfNow()).outlines
  ok(on > 0 && off === 0, `The edge of the selected item is outlined (${on} parts), and the outline goes away when the selection clears`)
}

// --- Start from scratch: clear, draw, persistence, restore ---
await p.evaluate(() => {
  window.__homescape.setMode('edit')
  window.__homescape.select(null)
})
await p.waitForTimeout(600)
const roomsBefore = (await level()).rooms.length
await p.click('button[title^="Start from scratch"]')
await p.waitForTimeout(300)
ok(await p.isVisible('text=Draw the home from scratch'), 'The start from scratch confirmation dialog opens')
await p.screenshot({ path: 'shots/home-reset-confirm.png' })
await p.click('button:has-text("Clear and start")')
await p.waitForTimeout(1200)
L = await level()
ok(L.rooms.length === 0 && L.items.length === 0, 'Clear: no rooms or items left')
ok(await p.evaluate(() => Boolean(window.__homescape.getState().layout.backup)), 'The cleared plan was backed up')
ok(await p.isVisible('text=Empty ground: draw your home'), 'The empty plan has a starting hint in the scene')
await p.screenshot({ path: 'shots/home-empty.png' })
ok(await p.isVisible('nav[aria-label="Build bar"] button:has-text("Medium room")'), 'The build bar opens with the Rooms tab')
const mid = await project(0, 0)
const roomCard = p.locator('nav[aria-label="Build bar"] button:has-text("Medium room")').first()
const rb = await roomCard.boundingBox()
await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2)
await p.mouse.down()
await p.mouse.move(mid.x, mid.y, { steps: 14 })
await p.waitForTimeout(400)
await p.mouse.up()
await p.waitForTimeout(600)
ok((await level()).rooms.length === 1, 'The first room was drawn on the empty ground')
await p.screenshot({ path: 'shots/home-from-scratch.png' })
await p.reload()
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1000)
ok((await level()).rooms.length === 1, 'The drawn plan stays after a page reload (saved in the browser)')
await p.evaluate(() => {
  window.__homescape.setMode('edit')
  window.__homescape.select(null)
})
await p.waitForTimeout(400)
await p.click('button:has-text("Restore the previous plan")')
await p.waitForTimeout(600)
ok((await level()).rooms.length === roomsBefore, `The previous plan was restored (${roomsBefore} rooms)`)

// Old saved plan (version 0, no inner doors): the inner doors are added once when it opens
await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('homescape-layout-v1'))
  const lvl = raw.state.layout.levels[0]
  lvl.items = lvl.items.filter((i) => i.kind !== 'door' || i.entityId)
  raw.version = 0
  localStorage.setItem('homescape-layout-v1', JSON.stringify(raw))
})
await p.reload()
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(800)
L = await level()
ok(components(L) === 1, `Inner doors are added when an old plan (without inner doors) opens (${L.items.filter((i) => i.kind === 'door').length} doors)`)

// Old saved plan (version 1): the separate backlight strip behind the TV joins the TV when it opens
{
  const tvId = L.items.find((i) => i.kind === 'tv').id
  await p.evaluate((tvId) => {
    const raw = JSON.parse(localStorage.getItem('homescape-layout-v1'))
    const lvl = raw.state.layout.levels[0]
    const t = lvl.items.find((i) => i.id === tvId)
    delete t.led
    t.extras = []
    // Old one-piece TV (with its unit): no placement variant or height, no separate unit
    delete t.variant
    delete t.y
    lvl.items = lvl.items.filter((i) => i.kind !== 'tvUnit')
    lvl.items.push({ id: 'old-strip', kind: 'ledStrip', x: t.x, z: t.z - 0.12, rot: t.rot, y: 0.95, entityId: 'light.old_tv_backlight', name: 'TV Backlight' })
    // A painting stuck to the old inner face (10 cm from the boundary): the version 3 migration should bring it 5 cm closer to the wall
    const rm = lvl.rooms[0]
    lvl.items.push({ id: 'old-painting', kind: 'painting', x: rm.x + rm.w / 2, z: rm.z + 0.1 + 0.025 + 0.01, rot: 0 })
    raw.version = 1
    localStorage.setItem('homescape-layout-v1', JSON.stringify(raw))
  }, tvId)
  await p.reload()
  await p.waitForSelector('body[data-ready="1"]')
  await p.waitForTimeout(800)
  L = await level()
  const t2 = L.items.find((i) => i.id === tvId)
  ok(!L.items.some((i) => i.id === 'old-strip') && t2.led === 'back' && t2.extras?.includes('light.old_tv_backlight'), "The TV backlight strip of the old plan joined the TV (its binding kept)")
  const units = L.items.filter((i) => i.kind === 'tvUnit')
  ok(units.length === 1 && t2.variant === 'stand' && t2.y === 0.5 && Math.hypot(units[0].x - t2.x, units[0].z - t2.z) < 0.1, 'The old one-piece TV became a TV unit plus a TV on its stand on top')
  const pt = L.items.find((i) => i.id === 'old-painting')
  ok(pt && Math.abs(pt.z - (L.rooms[0].z + 0.085)) < 1e-6, `A wall item of the old plan moved to the face of the centered wall (from the boundary ${pt ? (pt.z - L.rooms[0].z).toFixed(3) : '?'} m)`)
}

// When the backlight is bound to the TV first and the TV later, the TV becomes the main entity (the screen follows the TV); an old save (version 5 migration) is fixed too
{
  L = await level()
  const tvB = L.items.find((i) => i.kind === 'tv')
  await p.evaluate(() => {
    window.__homescape.setEntity({ entity_id: 'light.test_bl', state: 'off', attributes: { friendly_name: 'Test TV Backlight' } })
    window.__homescape.setEntity({ entity_id: 'remote.test_tv', state: 'on', attributes: { friendly_name: 'Test TV' } })
  })
  await p.evaluate((id) => {
    const s = window.__homescape.getState().layout
    s.updateItem(id, { entityId: 'light.test_bl', extras: [], ledEntity: undefined })
    s.bind(id, 'remote.test_tv')
  }, tvB.id)
  await p.waitForTimeout(200)
  const tb = (await level()).items.find((i) => i.id === tvB.id)
  ok(tb.entityId === 'remote.test_tv' && tb.extras[0] === 'light.test_bl', `When the TV remote is bound to a TV that had its backlight bound first, the remote becomes main and the light stays the backlight (${tb.entityId} + ${tb.extras.join(', ')})`)
  // Old save: the main entity is the light, the TV is an extra (version 4) -> the TV becomes main when it opens
  await p.evaluate((id) => {
    const raw = JSON.parse(localStorage.getItem('homescape-layout-v1'))
    const t = raw.state.layout.levels[0].items.find((i) => i.id === id)
    t.entityId = 'light.tv_backlight'
    t.extras = ['remote.tv']
    raw.version = 4
    localStorage.setItem('homescape-layout-v1', JSON.stringify(raw))
  }, tvB.id)
  await p.reload()
  await p.waitForSelector('body[data-ready="1"]')
  await p.waitForTimeout(800)
  const tm = (await level()).items.find((i) => i.id === tvB.id)
  const pre4 = await p.evaluate(() => localStorage.getItem('homescape-layout-v1-backup-s4') ?? '')
  ok(tm.entityId === 'remote.tv' && tm.extras.includes('light.tv_backlight') && pre4.includes('"version":4'), `In an old plan the remote became main on a TV whose main entity was the backlight (${tm.entityId}), raw backup taken`)
}

// --- Ceiling fan (on the ceiling, fan is the main entity, light kit, spinning blades, diameter); rug shape, size and ready-made cards ---
{
  const setRange = (sel, v) =>
    p.locator(sel).evaluate((el, val) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, v)
  const ids = await p.evaluate(() => {
    const s = window.__homescape.getState().layout
    window.__homescape.setMode('edit')
    window.__homescape.setEntity({ entity_id: 'fan.t_ceiling', state: 'off', attributes: { friendly_name: 'Ceiling fan', percentage: 0 } })
    window.__homescape.setEntity({ entity_id: 'light.t_ceiling_light', state: 'on', attributes: { friendly_name: 'Fan light', brightness: 255 } })
    const room = s.addRoom({ name: 'Fan test', floor: 'wood', x: 80, z: 0, w: 5, d: 4 })
    return { room, sofa: s.addItem('sofa', 82.5, 2, 0), rug: s.addItem('rug', 82.5, 1.6, 0), fan: s.addItem('ceilingFan', 82.5, 2, 0, 'light.t_ceiling_light') }
  })
  const it = async (id) => (await level()).items.find((i) => i.id === id)
  const fits = await p.evaluate(async () => {
    const { checkItem, layerOf } = await import('/src/model/rules.ts')
    const lv = window.__homescape.getState().layout.layout.levels[0]
    return { layer: layerOf('ceilingFan'), ok: checkItem(lv, { kind: 'ceilingFan', x: 82.5, z: 2.3, rot: 0 }, lv.items.find((i) => i.kind === 'ceilingFan' && i.x === 82.5)?.id).ok }
  })
  ok(fits.layer === 'ceiling' && fits.ok, `The ceiling fan is on the ceiling: it can go above the sofa and the rug (layer ${fits.layer})`)
  await p.evaluate((id) => window.__homescape.getState().layout.bind(id, 'fan.t_ceiling'), ids.fan)
  await p.waitForTimeout(250)
  const fanI = await it(ids.fan)
  const lit = (await p.evaluate(() => window.__homescape.roomLights())).find((l) => !l.portal && Math.abs(l.pos[0] - 82.5) < 0.05 && Math.abs(l.pos[1] - 2.15) < 0.01)
  ok(fanI.entityId === 'fan.t_ceiling' && fanI.extras?.includes('light.t_ceiling_light') && lit?.type === 0, `When a fan is bound to a ceiling fan that had its light bound first, the fan becomes main and the light kit lights the room (${fanI.entityId} + ${fanI.extras?.join(', ')})`)
  const a0 = (await p.evaluate(() => window.__homescape.perf())).ambient
  await p.evaluate(() => window.__homescape.setEntity({ entity_id: 'fan.t_ceiling', state: 'on', attributes: { friendly_name: 'Ceiling fan', percentage: 80 } }))
  await p.waitForTimeout(300)
  const a1 = (await p.evaluate(() => window.__homescape.perf())).ambient
  ok(a1 >= a0 + 1, `The blades spin when the fan turns on (live effects ${a0} -> ${a1})`)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.fan)
  await p.waitForTimeout(300)
  await setRange(`#len-${ids.fan}`, 1.6)
  await p.click('aside button:text-is("5 blades")')
  await p.waitForTimeout(200)
  const fan2 = await it(ids.fan)
  ok(fan2.len === 1.6 && fan2.variant === '5' && (await p.isVisible(`#intensity-${ids.fan}`)), `The blade diameter and count can be changed on the card, and the light intensity can be set (${fan2.len} m, ${fan2.variant} blades)`)

  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.rug)
  await p.waitForTimeout(300)
  const sliders = (await p.isVisible(`#len-${ids.rug}`)) && (await p.isVisible(`#len2-${ids.rug}`))
  await p.click('aside button:text-is("Round")')
  await setRange(`#len-${ids.rug}`, 2)
  await setRange(`#len2-${ids.rug}`, 2)
  await p.waitForTimeout(200)
  const round = await it(ids.rug)
  ok(sliders && round.variant === 'round' && round.len === 2 && round.len2 === 2, `The rug becomes round and its width and length are set separately (${round.len} × ${round.len2} m)`)
  await setRange(`#len2-${ids.rug}`, 5)
  await p.waitForTimeout(200)
  ok((await it(ids.rug)).len2 === 2 && /doesn't fit/.test((await placement()).notice ?? ''), 'A rug length that does not fit the room is rejected')
  await p.click('aside button:text-is("Cowhide")')
  await p.click('aside button[aria-label="Brown"]')
  await p.waitForTimeout(200)
  const hide = await it(ids.rug)
  ok(hide.variant === 'cowhide' && hide.body === '#6e4b33', 'The rug becomes a cowhide and the color of the spots can be chosen')
  await p.evaluate(() => window.__homescape.select(null))
  await p.click('nav[aria-label="Build bar"] button:has-text("Furniture")')
  const cards = []
  for (const name of ['Round rug', 'Cowhide', 'Sheepskin']) if (await p.locator(`nav[aria-label="Build bar"] button:has(span:text-is("${name}"))`).first().isVisible()) cards.push(name)
  ok(cards.length === 3, `Ready-made rug cards in the build bar (${cards.join(', ')})`)
  const kinds = await p.evaluate(async () => {
    const { kindFor } = await import('/src/model/generate.ts')
    const e = (entity_id, friendly_name) => ({ entity_id, state: 'on', attributes: { friendly_name } })
    return [kindFor(e('switch.living_room_ceiling_fan', 'Living room ceiling fan')), kindFor(e('fan.bedroom_ceiling', 'Bedroom ceiling fan')), kindFor(e('light.ceiling_fan_light', 'Ceiling fan light')), kindFor(e('light.living_room_ceiling_lamp', 'Living room ceiling lamp')), kindFor(e('fan.desk', 'Desk fan'))]
  })
  ok(kinds.join() === 'ceilingFan,ceilingFan,ceilingFan,pendant,fan', `In the automatic plan the ceiling fan is recognized and a ceiling light stays a pendant (${kinds.join(', ')})`)
  // The monitor screen follows the computer's Ping sensor: even if the plug is on, the screen is off when the computer is not on the network
  const screens = await p.evaluate(async () => {
    const { monitorOn, OFF_VISUAL } = await import('/src/scene/kit/visual.ts')
    const ping = (state) => ({ entity_id: 'binary_sensor.192_168_1_18', state, attributes: { device_class: 'connectivity' } })
    const sw = (on, related = []) => ({ ...OFF_VISUAL, bound: true, on, domain: 'switch', state: on ? 'on' : 'off', related })
    return [
      monitorOn(sw(true, [ping('off')])),
      monitorOn(sw(true, [ping('on')])),
      monitorOn(sw(false, [ping('on')])),
      monitorOn({ ...OFF_VISUAL, bound: true, on: true, domain: 'binary_sensor', state: 'on', attrs: { device_class: 'connectivity' } }),
      monitorOn(sw(true)),
    ]
  })
  ok(screens.join() === 'false,true,false,true,true', `The monitor screen follows the computer's Ping sensor (plug+ping off/on, plug off, ping only, plug only: ${screens.join(', ')})`)
  await p.evaluate((id) => {
    window.__homescape.select(null)
    window.__homescape.getState().layout.deleteRoom(id)
    window.__homescape.setMode('view')
  }, ids.room)
  await p.keyboard.press('f')
  await p.waitForTimeout(1200)
}

// Save protection: before a migration a raw copy of the old version is kept; an unreadable record is copied to the rescue key before it can be overwritten
{
  const pre = await p.evaluate(() => localStorage.getItem('homescape-layout-v1-backup-s1') ?? '')
  ok(pre.includes('old-strip') && pre.includes('"version":1'), 'A raw copy of the old record was kept before the migration (backup-s1)')
  await p.evaluate(() => localStorage.setItem('homescape-layout-v1', '{"state":{"layout":BROKEN'))
  await p.reload()
  await p.waitForSelector('body[data-ready="1"]')
  await p.waitForTimeout(800)
  const rescue = await p.evaluate(() => localStorage.getItem('homescape-layout-v1-rescue'))
  ok(rescue === '{"state":{"layout":BROKEN', 'The unreadable record was copied to the rescue key before being overwritten')
  errors.splice(0, errors.length, ...errors.filter((m) => !/JSON|BROKEN|Unexpected token/i.test(m)))
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
