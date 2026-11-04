// Home plan sync regression test (user request, 9 Oct 2026: "the same home does not show on the iPad, I need to see it like
// on the PC; if the home is connected to Home Assistant, that data should drive it"; ha/planSync.ts). The fake live source
// (dev/fakeLive.ts) imitates HA's user storage inside the page; each context is a separate device. Never connects to a real HA.
// Run with the dev server open: `npm run check:sync`
import { chromium } from 'playwright'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'

let failures = 0
const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []
/** New device: a separate browser context (its own local storage) */
const device = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 }, locale: 'en-US' })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(BASE)
  await p.waitForSelector('body[data-ready="1"]')
  await p.waitForTimeout(800)
  return p
}
const H = (p, fn, ...a) => p.evaluate(([f, args]) => window.__homescape[f](...args), [fn, a])
const live = (p) => H(p, 'fakeLive')
const remote = (p) => H(p, 'fakeRemote')
const put = (p, v) => p.evaluate((v) => window.__homescape.fakeRemote(v), v)
const sync = (p) => H(p, 'sync')
const rooms = (p) => p.evaluate(() => window.__homescape.getState().layout.layout.levels[0].rooms.map((r) => r.name))
const toast = (p) => p.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? '')
const addRoom = (p, name, x) => p.evaluate(([name, x]) => window.__homescape.getState().layout.addRoom({ name, x, z: 40, w: 2, d: 2, floor: 'wood', areaId: null }), [name, x])
const remoteRooms = (r) => r?.homes?.[0]?.layout?.levels?.[0]?.rooms?.map((x) => x.name) ?? []

// --- A: no sync on the demo connection; on live, a fresh plan is not written while HA is empty ---
const A = await device()
ok((await sync(A)).status === 'off', 'Sync is off on the demo connection')
await live(A)
await A.waitForTimeout(700)
let s = await sync(A)
ok(s.status === 'waiting' && (await remote(A)) === null, `A fresh plan (not hand-edited) is not written to HA while HA is empty, it waits (${s.status})`)
await A.click('#home-switcher')
const waitingText = await A.isVisible('text=No home plan is stored in Home Assistant yet')
await A.keyboard.press('Escape')
ok(waitingText, 'The home menu says no plan is stored in HA')

// --- Hand-editing on A: written to HA ---
await addRoom(A, 'Pantry A', 20)
await A.waitForTimeout(1700)
let r = await remote(A)
s = await sync(A)
const saved = await toast(A)
ok(s.status === 'synced' && r?.homes?.length === 1 && remoteRooms(r).includes('Pantry A') && r.device === s.meta.device, `A hand-edited plan is saved to HA (${r?.homes?.length} home, ${remoteRooms(r).length} rooms)`)
ok(/saved/.test(saved), `Notice on the first save: "${saved}"`)

// --- Another device writes to HA: A picks it up right away ---
const other = JSON.parse(JSON.stringify(r))
other.device = 'other-device'
other.updatedAt = new Date(Date.now() + 1000).toISOString()
other.homes[0].layout.levels[0].rooms[0].name = 'Remote Living Room'
await put(A, other)
await A.waitForTimeout(500)
s = await sync(A)
ok((await rooms(A))[0] === 'Remote Living Room' && s.meta.base === other.updatedAt, `A change another device wrote to HA arrives right away (${(await rooms(A))[0]})`)

// --- A edits again: HA is updated ---
await A.evaluate(() => {
  const st = window.__homescape.getState().layout
  st.updateRoom(st.layout.levels[0].rooms[1].id, { name: 'A Kitchen' })
})
await A.waitForTimeout(1700)
r = await remote(A)
ok(remoteRooms(r)[1] === 'A Kitchen' && r.device === (await sync(A)).meta.device, 'The next edit on this device goes to HA too')

// --- The sample home is not synced; switching homes does not count as an edit ---
const edited0 = (await sync(A)).meta.editedAt
const usId = await H(A, 'loadDemo', 'american')
await A.waitForTimeout(2500)
await A.evaluate(() => {
  const st = window.__homescape.getState().layout
  st.switchHome(st.homes.find((h) => h.name === 'My home').id)
})
await A.waitForTimeout(1800)
r = await remote(A)
s = await sync(A)
ok(Boolean(usId) && r.homes.map((h) => h.name).join() === 'My home' && s.meta.editedAt === edited0, `The sample home is not written to HA (in HA: ${r.homes.map((h) => h.name).join(', ')}), switching homes does not count as an edit`)

// --- B: fresh device, HA has a plan: takes it ---
const B = await device()
await put(B, r)
const before = (await rooms(B)).length
await live(B)
await B.waitForTimeout(900)
const bRooms = await rooms(B)
const got = await toast(B)
ok(bRooms.length === remoteRooms(r).length && bRooms[0] === 'Remote Living Room' && (await sync(B)).status === 'synced', `A new device (like an iPad) takes the plan in HA (${before} -> ${bRooms.length} rooms)`)
ok(/loaded/.test(got) && !(await B.evaluate(() => localStorage.getItem('homescape-sync-backup'))), `Notice: "${got}"; no backup is kept of the fresh plan`)

// --- C: hand-edited plan that was never synced, HA has a different plan: asks; picks the one in HA ---
const C = await device()
await addRoom(C, 'C Room', 30)
await C.waitForTimeout(1700)
await put(C, r)
await live(C)
await C.waitForSelector('#sync-prompt', { timeout: 3000 }).catch(() => null)
const asked = await C.isVisible('#sync-prompt')
ok(asked && (await remote(C)).updatedAt === r.updatedAt, 'If the edited plan on this device differs from the one in HA, it asks; nothing is written to HA')
if (asked) await C.click('#sync-use-remote')
await C.waitForTimeout(400)
const backup = await C.evaluate(() => JSON.parse(localStorage.getItem('homescape-sync-backup') ?? '[]')[0])
ok(!(await C.isVisible('#sync-prompt')) && !(await rooms(C)).includes('C Room') && backup?.homes?.[0]?.layout?.levels?.[0]?.rooms?.some((x) => x.name === 'C Room'), '"Use the one in Home Assistant": the HA plan arrives, the plan on this device is backed up')

// --- D: same question, saves the one on this device ---
const D = await device()
await addRoom(D, 'D Room', 32)
await D.waitForTimeout(1700)
await put(D, r)
await live(D)
await D.waitForSelector('#sync-prompt', { timeout: 3000 }).catch(() => null)
if (await D.isVisible('#sync-prompt')) await D.click('#sync-use-local')
await D.waitForTimeout(600)
const rd = await remote(D)
ok(remoteRooms(rd).includes('D Room') && rd.device === (await sync(D)).meta.device, '"Save the one on this device": the plan in HA is replaced by this device\'s')

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
