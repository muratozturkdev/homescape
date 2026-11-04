// Controls regression test: verifies camera, edit and placement behavior with real mouse and keyboard movements.
// `npm run dev` must be running first. Run: npm run check:controls
// Intermediate screenshots: shots/controls-*.png
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

const H = (fn, arg) => p.evaluate(fn, arg)
const level = () => H(() => {
  const s = window.__homescape.getState().layout
  const l = s.layout.levels[0]
  return {
    rooms: l.rooms.map(({ id, name, x, z, w, d }) => ({ id, name, x, z, w, d })),
    items: l.items.map(({ id, kind, x, z, rot }) => ({ id, kind, x, z, rot })),
    sel: s.selection,
    past: s.past.length,
  }
})
const cam = () => H(() => window.__homescape.camera())
const placement = () => H(() => window.__homescape.placement())
const project = (x, z, y = 0) => H(([x, y, z]) => window.__homescape.project(x, y, z), [x, y, z])
const room = (st, name) => st.rooms.find((r) => r.name === name)
const centerOf = (r) => project(r.x + r.w / 2, r.z + r.d / 2)
const overlapCount = (rooms) => {
  let n = 0
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]
      const c = rooms[j]
      if (Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 0.01 && Math.min(a.z + a.d, c.z + c.d) - Math.max(a.z, c.z) > 0.01) n++
    }
  return n
}
const labelCenter = (name) => H((n) => {
  const el = [...document.querySelectorAll('span')].find((s) => s.textContent === n && s.closest('[style*="translate3d"]'))
  const r = el.closest('div').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, name)
const onCanvas = (pt) => H(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', pt)
/** An empty ground point outside the home that is visible on screen (so the camera drag does not land on an item). */
const emptyPoint = async () => {
  const L0 = await level()
  const xs = L0.rooms.flatMap((r) => [r.x, r.x + r.w])
  const zs = L0.rooms.flatMap((r) => [r.z, r.z + r.d])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  for (const [wx, wz] of [[x0 - 1.5, (z0 + z1) / 2], [x1 + 1.5, (z0 + z1) / 2], [(x0 + x1) / 2, z0 - 1.5], [(x0 + x1) / 2, z1 + 1.5], [x0 - 1.5, z0 - 1.5], [x1 + 1.5, z1 + 1.5]]) {
    const sp = await project(wx, wz)
    if (sp && sp.x > 80 && sp.x < 1100 && sp.y > 110 && sp.y < 660 && (await onCanvas(sp))) return sp
  }
  return { x: 700, y: 300 }
}
const drag = async (from, dx, dy, button = 'left') => {
  await p.mouse.move(from.x, from.y)
  await p.mouse.down({ button })
  for (let i = 1; i <= 10; i++) await p.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10)
  await p.mouse.up({ button })
  await p.waitForTimeout(1200)
}
const bar = (text) => p.locator(`nav[aria-label="Build bar"] button:has-text("${text}")`).first()
/** Drags from a card to a point in the scene; `during` runs before the drop (screenshot, R key). */
const dragCard = async (text, to, during) => {
  const card = bar(text)
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await p.mouse.down()
  await p.mouse.move(to.x, to.y, { steps: 14 })
  await p.waitForTimeout(350)
  if (during) await during()
  await p.mouse.up()
  await p.waitForTimeout(500)
}
const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const near = (a, b2, eps = 1e-3) => Math.abs(a - b2) < eps

await H(() => window.__homescape.setMode('edit'))
await p.waitForTimeout(1800)

// --- Camera: by default left drag ROTATES (user decision), right drag pans ---
const moved = (a, b2) => Math.hypot(a.target[0] - b2.target[0], a.target[2] - b2.target[2])
let s0 = await level()
let c0 = await cam()
let pt = await labelCenter('Entrance')
await drag(pt, 160, 0)
let s1 = await level()
let c1 = await cam()
ok(room(s1, 'Entrance').x === room(s0, 'Entrance').x && room(s1, 'Entrance').z === room(s0, 'Entrance').z, 'Left drag on the floor of an unselected room does NOT move the room')
ok(Math.abs(c1.azimuth - c0.azimuth) > 0.2 && moved(c1, c0) < 0.05, 'Default: left drag (without Space) ROTATES the camera')
ok(s1.past === s0.past, 'Camera drag does NOT write an empty step to the undo history')

await drag({ x: 700, y: 300 }, 180, 0, 'right')
let c2 = await cam()
ok(moved(c2, c1) > 0.3 && near(c2.azimuth, c1.azimuth, 0.01), 'Right-click drag pans the camera')
await drag({ x: 700, y: 300 }, 0, 140, 'right')
const c2b = await cam()
ok(Math.abs(c2b.target[1]) < 0.01 && moved(c2b, c2) > 0.3, 'Vertical right drag pans FORWARD on the ground, the target does not rise into the air')

const sp0 = await cam()
await p.keyboard.down('Space')
await drag(await labelCenter('Entrance'), 0, 120)
await p.keyboard.up('Space')
ok(moved(await cam(), sp0) > 0.3, 'Space + left drag pans')

const wb = await cam()
await p.mouse.move(700, 300)
for (let i = 0; i < 6; i++) await p.mouse.wheel(40, 0)
await p.waitForTimeout(1200)
ok(Math.abs((await cam()).azimuth - wb.azimuth) > 0.2, 'Trackpad sideways scroll (horizontal wheel) rotates')

// Hand mode: left drag pans; ⌥ / ⇧ rotates; the choice is remembered
await p.click('button[title^="Left drag: pan"]')
await p.waitForTimeout(1500) // let the soft ending of the previous trackpad rotation settle
ok(await p.evaluate(() => localStorage.getItem('homescape-left-drag-v2') === 'pan'), 'The left drag choice is remembered')
const h0 = await cam()
const sh0 = await level()
await drag(await emptyPoint(), 160, 0)
const h1 = await cam()
ok(moved(h1, h0) > 0.3 && near(h1.azimuth, h0.azimuth, 0.03), 'In hand mode left drag pans')
ok(room(await level(), 'Entrance').x === room(sh0, 'Entrance').x, 'In hand mode dragging the floor does not move the room')
for (const key of ['Alt', 'Shift']) {
  const before = await cam()
  await p.keyboard.down(key)
  await p.waitForTimeout(150)
  await drag(await labelCenter('Entrance'), 160, 0)
  await p.keyboard.up(key)
  const after = await cam()
  ok(Math.abs(after.azimuth - before.azimuth) > 0.2 && moved(after, before) < 0.05, `In hand mode ${key === 'Alt' ? '⌥' : '⇧'} + left drag rotates`)
}
await p.click('button[title^="Left drag: rotate"]')
await p.waitForTimeout(200)
c2 = await cam()

await p.keyboard.press('q')
await p.waitForTimeout(2200)
let c3 = await cam()
ok(near(Math.abs(c3.azimuth - c2.azimuth), Math.PI / 4, 0.02), 'Q rotates the camera 45°')
await p.keyboard.press('e')
await p.waitForTimeout(2200)
ok(near((await cam()).azimuth, c2.azimuth, 0.02), 'E rotates 45° in the opposite direction')

await p.keyboard.press('w')
await p.waitForTimeout(700)
let c4 = await cam()
ok(Math.hypot(c4.target[0] - c2.target[0], c4.target[2] - c2.target[2]) > 0.8, 'W pans the camera forward')

// --- Room selection and moving ---
const entrance = room(s0, 'Entrance')
await H((id) => { window.__homescape.focusRoom(id); window.__homescape.select(null) }, entrance.id)
await p.waitForTimeout(1600)
pt = await labelCenter('Entrance')
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(400)
ok((await level()).sel?.id === entrance.id, 'A single click on the floor selects the room')

await drag({ x: 700, y: 200 }, -120, 40, 'right')
ok((await level()).sel?.id === entrance.id, 'Dragging the camera and releasing does NOT clear the selection')

let s3 = await level()
pt = await labelCenter('Entrance')
await p.keyboard.down('Space')
const panFlag = await H(() => document.body.dataset.pan)
await drag(pt, 0, 120)
await p.keyboard.up('Space')
let s4 = await level()
ok(panFlag === '1', 'While Space is held, pan mode turns on (the cursor is a hand)')
ok(room(s4, 'Entrance').x === room(s3, 'Entrance').x && room(s4, 'Entrance').z === room(s3, 'Entrance').z, 'Space + drag does NOT move even the selected room')
ok(await H(() => !document.body.dataset.pan), 'When Space is released, pan mode turns off')

await H((id) => { window.__homescape.focusRoom(id) }, entrance.id)
await p.waitForTimeout(1600)
pt = await labelCenter('Entrance')
// Moving toward a neighbor is blocked now; drag toward the outside of the home (away from the center).
const allX = s4.rooms.flatMap((r) => [r.x, r.x + r.w])
const allZ = s4.rooms.flatMap((r) => [r.z, r.z + r.d])
const house = await project((Math.min(...allX) + Math.max(...allX)) / 2, (Math.min(...allZ) + Math.max(...allZ)) / 2)
const gc = await centerOf(room(s4, 'Entrance'))
const len = Math.hypot(gc.x - house.x, gc.y - house.y) || 1
await drag(pt, ((gc.x - house.x) / len) * 90, ((gc.y - house.y) / len) * 90)
let s5 = await level()
ok(room(s5, 'Entrance').x !== room(s4, 'Entrance').x || room(s5, 'Entrance').z !== room(s4, 'Entrance').z, 'A selected room moves when dragged')
await p.keyboard.press('Meta+z')
await p.waitForTimeout(300)
let s6 = await level()
ok(room(s6, 'Entrance').x === room(s4, 'Entrance').x && room(s6, 'Entrance').z === room(s4, 'Entrance').z, '⌘Z undoes the room move in a single step')

await p.keyboard.press('ArrowRight')
await p.waitForTimeout(200)
ok(near(room(await level(), 'Entrance').x, room(s6, 'Entrance').x + 0.25), 'The arrow key nudges the selected room 25 cm')
await p.keyboard.press('Meta+z')
await p.waitForTimeout(200)

// Drag a room into its neighbor: the rooms must not overlap
pt = await labelCenter('Entrance')
const target = await centerOf(room(s6, 'Living Room'))
const pastBefore = (await level()).past
await drag(pt, target.x - pt.x, target.y - pt.y)
let s7 = await level()
ok(overlapCount(s7.rooms) === 0, 'A room dragged onto a neighboring room does NOT overlap it')
if (s7.past > pastBefore) await p.keyboard.press('Meta+z')
await H(() => { window.__homescape.select(null) })
await p.keyboard.press('f')
await p.waitForTimeout(1600)

// --- Build bar: room cards ---
await bar('Rooms').click()
const sBase = await level()
const living = await centerOf(room(sBase, 'Living Room'))
await dragCard('Small room', living, async () => {
  const pl = await placement()
  ok(pl.target?.type === 'room' && pl.result && !pl.result.ok, 'The room card ghost is RED over an existing room')
  await p.screenshot({ path: 'shots/controls-room-red.png' })
})
let s8 = await level()
ok(s8.rooms.length === sBase.rooms.length, 'A room CANNOT be dropped onto another room')
ok(/Can't place it here/.test((await placement()).notice ?? ''), 'A rejected drop states the reason')

// Find an empty spot around the home that is visible on screen
const xs = sBase.rooms.flatMap((r) => [r.x, r.x + r.w])
const zs = sBase.rooms.flatMap((r) => [r.z, r.z + r.d])
const bb = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
const cx = (bb.minX + bb.maxX) / 2
const cz = (bb.minZ + bb.maxZ) / 2
let spot = null
for (const [wx, wz] of [[bb.maxX + 2.5, cz], [cx, bb.maxZ + 2.5], [bb.minX - 2.5, cz], [cx, bb.minZ - 2.5], [bb.maxX + 2.5, bb.maxZ + 2.5], [bb.minX - 2.5, bb.maxZ + 2.5]]) {
  const sp = await project(wx, wz)
  if (sp.x > 60 && sp.x < 1150 && sp.y > 110 && sp.y < 680 && (await onCanvas(sp))) {
    spot = sp
    break
  }
}
ok(Boolean(spot), 'Found an empty spot next to the home')
if (spot) {
  await dragCard('Small room', spot, async () => {
    const pl = await placement()
    ok(pl.result?.ok === true, 'The room ghost is GREEN on an empty spot')
    await p.screenshot({ path: 'shots/controls-room-green.png' })
  })
  let s9 = await level()
  const added = s9.rooms.find((r) => !sBase.rooms.some((o) => o.id === r.id))
  ok(s9.rooms.length === sBase.rooms.length + 1 && Boolean(added), 'Dragging the room card onto an empty spot: room added')
  ok(overlapCount(s9.rooms) === 0, 'The new room overlaps no other room')

  // --- Build bar: item cards ---
  await bar('Furniture').click()
  const c = await centerOf(added)
  const before = s9.items.length
  await dragCard('Armchair', c, async () => {
    await p.keyboard.press('r')
    await p.waitForTimeout(250)
    const pl = await placement()
    ok(near(pl.rot, Math.PI / 2), 'While dragging, R rotates the ghost 90°')
    ok(pl.result?.ok === true, 'The item ghost is GREEN in the middle of an empty room')
    await p.screenshot({ path: 'shots/controls-item-green.png' })
  })
  let s10 = await level()
  const chair = s10.items.find((i) => !s9.items.some((o) => o.id === i.id))
  ok(s10.items.length === before + 1 && chair?.kind === 'armchair', 'Dragging the armchair card into the scene: item added')
  ok(chair && near(chair.rot, Math.PI / 2), 'The item is placed with the ghost rotation')

  await dragCard('Armchair', c, async () => {
    const pl = await placement()
    ok(pl.result?.ok === false && /Too close/.test(pl.result.reason ?? ''), 'Second armchair at the same spot: ghost RED, reason "Too close"')
    await p.screenshot({ path: 'shots/controls-item-red.png' })
  })
  ok((await level()).items.length === before + 1, 'An item CANNOT be dropped on an occupied spot')

  // Click and place
  const plantCard = bar('Potted plant')
  await plantCard.scrollIntoViewIfNeeded()
  await plantCard.click()
  ok((await placement()).via === 'click' && (await placement()).target?.kind === 'plant', 'Clicking the card switches to click-to-place mode')
  const corner = await project(added.x + added.w / 2, added.z + added.d / 2 + 0.95)
  await p.mouse.move(corner.x, corner.y, { steps: 8 })
  await p.waitForTimeout(300)
  await p.mouse.click(corner.x, corner.y)
  await p.waitForTimeout(400)
  let s11 = await level()
  ok(s11.items.length === before + 2 && s11.items.some((i) => i.kind === 'plant' && !s10.items.some((o) => o.id === i.id)), 'Click-to-place: clicking the scene placed the plant')
  ok(!(await placement()).target, 'The tool closes after placing')

  await bar('Coffee table').click()
  await p.keyboard.press('Escape')
  ok(!(await placement()).target, 'Esc cancels placement')
}

await p.click('button[title="Controls and shortcuts"]')
await p.waitForTimeout(300)
ok(await p.isVisible('text=Left click + drag'), 'The help card shows the new controls')
await p.screenshot({ path: 'shots/controls.png' })
ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
