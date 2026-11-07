// Dashboard customizing regression test (ui/Dashboard.tsx, model/dashboardLayout.ts): reordering cards (arrows and drag),
// hiding cards, summary tiles and device rows, favorites, reset, saving with the plan and syncing it to Home Assistant
// (fake live source), new rooms after customizing, touch. Run with the dev server open: `npm run check:dashboard`
import { chromium } from 'playwright'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'
let failures = 0
const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const p = await ctx.newPage()
p.on('pageerror', (e) => errors.push(e.message))
await p.goto(BASE)
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(1000)

const openDash = async () => {
  await p.click('button[role="tab"][aria-label="Dashboard"]')
  await p.waitForSelector('#dashboard')
  await p.waitForTimeout(700)
}
/** Room cards in their order on the Dashboard (the masonry columns put them in the DOM column by column) */
const rooms = () =>
  p.$$eval('#dashboard [data-dash-room]', (els) =>
    els
      .map((e) => ({ name: e.getAttribute('data-dash-room'), pos: Number(e.closest('[data-dash-pos]')?.getAttribute('data-dash-pos') ?? 0) }))
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.name),
  )
const dash = () => p.evaluate(() => window.__homescape.getState().layout.layout.dashboard ?? null)
const edit = async (on) => {
  if ((await p.getAttribute('#dash-customize', 'aria-pressed')) !== String(on)) await p.click('#dash-customize')
  await p.waitForTimeout(250)
}
const card = (room) => p.locator(`[data-dash-card]:has([data-dash-room="${room}"])`)

await openDash()
const start = await rooms()
ok(start.length >= 4 && (await p.isVisible('#dash-customize')), `The Dashboard shows the room cards and a Customize button (${start.length} rooms)`)

// --- Customizing: controls step aside, every card gets tools ---
await edit(true)
const inEdit = await p.evaluate(() => ({
  hint: Boolean(document.getElementById('dash-edit-hint')),
  switches: document.querySelectorAll('#dashboard [data-dash-room] [role="switch"]').length,
  grips: document.querySelectorAll('#dashboard [data-dash-grip]').length,
  pins: document.querySelectorAll('#dashboard [data-dash-pin]').length,
}))
ok(inEdit.hint && inEdit.switches === 0 && inEdit.grips >= start.length && inEdit.pins > 0, `Customizing: a hint, no device switches (${inEdit.switches}), a handle on every card (${inEdit.grips}), stars on the rows`)

// --- Arrows: the first room moves one place later ---
await card(start[0]).locator('button[aria-label="Move later"]').first().click()
await p.waitForTimeout(250)
let now = await rooms()
ok(now[0] === start[1] && now[1] === start[0], `"Move later" swaps the first two rooms (${now.slice(0, 2).join(', ')})`)

// --- Drag: the third room (same row, on screen) is dropped on the first one ---
const before = await rooms()
const last = before[2]
const grip = await card(last).locator('[data-dash-grip]').boundingBox()
const target = await card(before[0]).boundingBox()
await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
await p.mouse.down()
await p.mouse.move(target.x + 60, target.y + 80, { steps: 12 })
await p.mouse.up()
await p.waitForTimeout(300)
now = await rooms()
ok(now[0] === last && now[1] === before[0], `Dragging a room by its handle onto the first room puts it first (${now.slice(0, 2).join(', ')})`)

// --- Hide a room, a summary tile, a side card and a device row ---
const hideRoom = now[1]
await card(hideRoom).locator('[data-dash-hide]').first().click()
await p.locator('[data-dash-chip="chip:power"] [data-dash-hide]').click()
const sideCard = await p.$eval('#dashboard [data-dash-card^="side:"]', (el) => el.getAttribute('data-dash-card'))
await p.locator(`[data-dash-card="${sideCard}"] [data-dash-hide]`).first().click()
const rowRoom = now[0]
const rowId = await card(rowRoom).locator('[data-dash-row]').first().getAttribute('data-dash-row')
await card(rowRoom).locator('[data-dash-row-hide]').first().click()
await p.waitForTimeout(250)
ok((await p.locator(`[data-dash-card]:has([data-dash-room="${hideRoom}"])`).getAttribute('data-dash-hidden')) === '1', 'While customizing a hidden card stays, dimmed, so it can be shown again')

// --- Favorites: pin two devices; the order changes with the arrows ---
const pinned = []
for (const i of [0, 2]) {
  const row = p.locator(`[data-dash-card]:has([data-dash-room="${now[0]}"]) [data-dash-row]`).nth(i)
  pinned.push(await row.getAttribute('data-dash-row'))
  await row.locator('[data-dash-pin]').click()
}
await p.waitForTimeout(200)
await p.locator('#dash-favorites [data-dash-row]').first().locator('button[aria-label="Move later"]').click()
await p.waitForTimeout(200)
const favOrder = await p.$$eval('#dash-favorites [data-dash-row]', (els) => els.map((e) => e.getAttribute('data-dash-row')))
ok(favOrder.join() === [pinned[1], pinned[0]].join(), `Pinned devices gather in Favorites and can be reordered (${favOrder.join(', ')})`)

// --- Done: hidden things are gone, favorites work like any row ---
await edit(false)
const view = await p.evaluate(([hideRoom, side, row]) => ({
  room: Boolean(document.querySelector(`#dashboard [data-dash-room="${hideRoom}"]`)),
  chip: Boolean(document.querySelector('[data-dash-chip="chip:power"]')),
  side: Boolean(document.querySelector(`[data-dash-card="${side}"]`)) || document.querySelectorAll('#dashboard .glass').length === 0,
  row: [...document.querySelectorAll(`#dashboard [data-dash-room] [data-dash-row="${row}"]`)].length,
  fav: document.querySelectorAll('#dash-favorites [data-dash-row]').length,
}), [hideRoom, sideCard, rowId])
ok(!view.room && !view.chip && view.row === 0, `Done: the hidden room, summary tile and device row are not shown (room ${view.room}, tile ${view.chip}, row ${view.row})`)
ok(view.fav === 2, `Done: the Favorites card shows the pinned devices (${view.fav})`)
const favId = await p.$$eval('#dash-favorites [data-dash-row]', (els) => els.find((e) => e.querySelector('[role="switch"]'))?.getAttribute('data-dash-row') ?? null)
if (favId) {
  const s0 = (await p.evaluate((x) => window.__homescape.entity(x), favId)).state
  await p.click(`#dash-favorites [data-dash-row="${favId}"] [role="switch"]`)
  await p.waitForTimeout(400)
  const s1 = (await p.evaluate((x) => window.__homescape.entity(x), favId)).state
  ok(s0 !== s1, `A switch in Favorites controls the device (${s0} -> ${s1})`)
} else ok(true, 'Favorites hold no switchable device (control check skipped)')

// --- Saved with the plan: survives a reload ---
const saved = await dash()
await p.reload()
await p.waitForSelector('body[data-ready="1"]')
await p.waitForTimeout(800)
await openDash()
const after = await rooms()
ok(JSON.stringify(await dash()) === JSON.stringify(saved) && after[0] === last && !after.includes(hideRoom), `The layout is saved with the plan and comes back after a reload (${after.slice(0, 2).join(', ')})`)

// --- A room drawn after customizing still shows up ---
await p.evaluate(() => window.__homescape.getState().layout.addRoom({ name: 'New study', x: 40, z: 40, w: 3, d: 3, floor: 'wood', areaId: null }))
await p.waitForTimeout(400)
ok((await rooms()).includes('New study'), 'A room added after customizing appears on the Dashboard (new things are never hidden by a saved layout)')

// --- Syncs like the plan (fake live Home Assistant) ---
await p.evaluate(() => window.__homescape.fakeLive())
await p.waitForTimeout(800)
await edit(true)
await card(after[0]).locator('button[aria-label="Move later"]').first().click()
await p.waitForTimeout(1900)
const remote = await p.evaluate(() => window.__homescape.fakeRemote())
ok(Boolean(remote?.homes?.[0]?.layout?.dashboard?.order?.length), 'The Dashboard layout is stored in Home Assistant with the plan')

// --- Reset: back to the default arrangement ---
await p.click('#dash-reset')
await p.click('#dash-reset')
await p.waitForTimeout(300)
await edit(false)
const reset = await p.evaluate(() => ({ dash: window.__homescape.getState().layout.layout.dashboard ?? null, fav: Boolean(document.getElementById('dash-favorites')), chip: Boolean(document.querySelector('[data-dash-chip="chip:power"]')) }))
ok(reset.dash === null && !reset.fav && reset.chip, `"Reset layout" (two clicks) restores the default: nothing hidden, no favorites (${JSON.stringify(reset.dash)})`)
await p.screenshot({ path: 'shots/dashboard-customize.png' })

// --- Touch: the tools are tappable on a phone ---
{
  const t = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' })
  const q = await t.newPage()
  q.on('pageerror', (e) => errors.push(e.message))
  await q.goto(BASE)
  await q.waitForSelector('body[data-ready="1"]')
  await q.waitForTimeout(800)
  await q.tap('button[role="tab"][aria-label="Dashboard"]')
  await q.waitForSelector('#dashboard')
  await q.tap('#dash-customize')
  await q.waitForTimeout(300)
  const size = await q.$eval('[data-dash-pin]', (el) => el.getBoundingClientRect().width)
  await q.locator('[data-dash-pin]').first().tap()
  await q.waitForTimeout(300)
  const fav = await q.evaluate(() => window.__homescape.getState().layout.layout.dashboard?.favorites?.length ?? 0)
  const over = await q.evaluate(() => document.getElementById('dashboard').scrollWidth - document.getElementById('dashboard').clientWidth)
  ok(size >= 40 && fav === 1 && over <= 0, `On a phone the tools are finger-sized (${size} px), a tap pins a device, nothing overflows sideways (${over})`)
  await t.close()
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
