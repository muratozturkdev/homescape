// Data safety regression test: a user's home plan must survive lost browser storage, unreadable or newer data in Home
// Assistant, dropped connections, other accounts and accidental wipes. The fake live source (dev/fakeLive.ts) imitates Home
// Assistant's user storage inside the page; each context is a separate device. Never connects to a real Home Assistant.
// Run with the dev server open: `npm run check:data`
import { chromium } from 'playwright'

const BASE = process.env.HOMESCAPE_URL ?? 'http://localhost:5190/'
let failures = 0
const ok = (c, m) => {
  if (!c) failures += 1
  console.log(`${c ? 'PASS ' : 'FAIL '} ${m}`)
}
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errors = []
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
const live = async (p) => {
  await H(p, 'fakeLive')
  await p.waitForTimeout(700)
}
const remote = (p) => H(p, 'fakeRemote')
const put = (p, v) => p.evaluate((v) => window.__homescape.fakeRemote(v), v)
const sync = (p) => H(p, 'sync')
const rooms = (p) => p.evaluate(() => window.__homescape.getState().layout.layout?.levels[0].rooms.map((r) => r.name) ?? [])
const addRoom = (p, name, x) => p.evaluate(([name, x]) => window.__homescape.getState().layout.addRoom({ name, x, z: 40, w: 2, d: 2, floor: 'wood', areaId: null }), [name, x])
const remoteRooms = (r) => r?.homes?.[0]?.layout?.levels?.[0]?.rooms?.map((x) => x.name) ?? []
const SAVE = 1700

/** A device with a hand-edited plan saved to Home Assistant; returns the page and what is stored in Home Assistant */
async function synced(room = 'Keep me') {
  const p = await device()
  await live(p)
  await addRoom(p, room, 20)
  await p.waitForTimeout(SAVE)
  return { p, r: await remote(p) }
}
const reloadWith = async (p, r) => {
  await p.reload()
  await p.waitForSelector('body[data-ready="1"]')
  await p.waitForTimeout(800)
  if (r !== undefined) await put(p, r)
  await live(p)
}

// --- The plan in this browser is lost, the sync record survives: the plan in Home Assistant must not be overwritten ---
{
  const { p, r } = await synced()
  await p.evaluate(() => localStorage.removeItem('homescape-layout-v1'))
  await reloadWith(p, r)
  await p.waitForTimeout(SAVE)
  ok(remoteRooms(await remote(p)).includes('Keep me'), `Browser plan lost: the plan in Home Assistant stays (${remoteRooms(await remote(p)).length} rooms)`)
  ok((await rooms(p)).includes('Keep me'), 'Browser plan lost: this device gets the plan back from Home Assistant')
}

// --- Data this version cannot read is never overwritten ---
{
  const { p, r } = await synced()
  const broken = { v: 1, updatedAt: 'x', homes: 'not a list' }
  await put(p, broken)
  await p.waitForTimeout(300)
  await addRoom(p, 'Local edit', 24)
  await p.waitForTimeout(SAVE)
  const now = await remote(p)
  ok(JSON.stringify(now) === JSON.stringify(broken), 'Unreadable data in Home Assistant is left untouched after an edit')
  ok((await sync(p)).status === 'blocked' && (await rooms(p)).includes('Local edit'), `Sync stops and the edit stays on this device (${(await sync(p)).status})`)
  const newerSchema = { ...r, schema: 99, updatedAt: new Date(Date.now() + 5000).toISOString() }
  await put(p, newerSchema)
  await p.waitForTimeout(300)
  await addRoom(p, 'Second edit', 26)
  await p.waitForTimeout(SAVE)
  ok((await remote(p)).schema === 99 && !(await rooms(p)).includes('nothing'), 'A plan saved by a newer Homescape version is not overwritten by this version')
  const newerFormat = { ...r, v: 2 }
  await put(p, newerFormat)
  await p.waitForTimeout(300)
  await addRoom(p, 'Third edit', 28)
  await p.waitForTimeout(SAVE)
  ok((await remote(p)).v === 2, 'A newer storage format is not overwritten either')
}

// --- A failed read is not "no plan in Home Assistant" ---
{
  const p = await device()
  await addRoom(p, 'Offline room', 22)
  await p.waitForTimeout(SAVE)
  const other = { v: 1, updatedAt: '2026-01-01T00:00:00.000Z', device: 'other', homeId: 'home-main', homes: [{ id: 'home-main', name: 'My home', layout: { version: 1, levels: [{ id: 'lvl-x', name: '', rooms: [{ id: 'room-x', name: 'Precious room', x: 0, z: 0, w: 4, d: 4, floor: 'wood', areaId: null }], items: [] }] } }] }
  await put(p, other)
  await H(p, 'fakeUser', { failing: true })
  await live(p)
  await addRoom(p, 'Edited while failing', 25)
  await p.waitForTimeout(SAVE)
  await H(p, 'fakeUser', { failing: false })
  await addRoom(p, 'Edited after recovery', 27)
  await p.waitForTimeout(SAVE)
  ok(remoteRooms(await remote(p)).includes('Precious room'), 'After a failed read an edit does not overwrite the plan in Home Assistant')
}

// --- Plans in Home Assistant are migrated when they arrive ---
{
  const { p, r } = await synced()
  const old = JSON.parse(JSON.stringify(r))
  old.schema = 3
  old.device = 'old-device'
  old.updatedAt = new Date(Date.now() + 2000).toISOString()
  old.homes[0].layout.levels[0].items.push({ id: 'it-oldtv', kind: 'tv', x: 21, z: 41, rot: 0 })
  await put(p, old)
  await p.waitForTimeout(600)
  const kinds = await p.evaluate(() => window.__homescape.getState().layout.layout.levels[0].items.filter((i) => i.id === 'it-oldtv' || i.kind === 'tvUnit').map((i) => `${i.kind}:${i.variant ?? ''}`))
  ok(kinds.includes('tv:stand') && kinds.some((k) => k.startsWith('tvUnit')), `A plan from an older version is migrated on arrival (${kinds.join(', ')})`)
}

// --- A version bump migrates every home, not only the open one ---
{
  const p = await device()
  await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('homescape-layout-v1'))
    const home2 = { id: 'home-2', name: 'Cottage', levelId: 'l2', layout: { version: 1, levels: [{ id: 'l2', name: '', rooms: [], items: [{ id: 'it-1', kind: 'tv', x: 1, z: 1, rot: 0 }] }] } }
    raw.state.homes = [{ id: 'home-main', name: 'My home' }, home2]
    raw.state.homeId = 'home-main'
    raw.version = 3
    localStorage.setItem('homescape-layout-v1', JSON.stringify(raw))
  })
  await p.reload()
  await p.waitForSelector('body[data-ready="1"]')
  const h2 = await p.evaluate(() => window.__homescape.getState().layout.homes.find((h) => h.id === 'home-2')?.layout?.levels[0].items.map((i) => i.kind).join())
  ok(h2?.includes('tvUnit'), `Saved plans of the other homes are migrated too (${h2})`)
}

// --- Every replaced plan can be restored ---
{
  const { p, r } = await synced('Before replace')
  const other = JSON.parse(JSON.stringify(r))
  other.device = 'other-device'
  other.updatedAt = new Date(Date.now() + 2000).toISOString()
  other.homes[0].layout.levels[0].rooms = other.homes[0].layout.levels[0].rooms.filter((x) => x.name !== 'Before replace')
  await put(p, other)
  await p.waitForTimeout(600)
  ok(!(await rooms(p)).includes('Before replace'), 'A change from another device replaces the plan here')
  await p.click('#home-switcher')
  await p.click('#plan-history-open')
  await p.waitForSelector('#plan-history')
  const shown = await p.locator('[data-plan-backup]').count()
  ok(shown >= 1, `Plan history lists the replaced plan (${shown})`)
  await p.locator('[data-plan-backup] button').first().click()
  await p.locator('[data-plan-backup] button').first().click()
  await p.waitForTimeout(SAVE)
  ok((await rooms(p)).includes('Before replace') && remoteRooms(await remote(p)).includes('Before replace'), 'Restoring brings the plan back here and in Home Assistant')
}

// --- A wipe keeps a copy in Home Assistant ---
{
  const { p } = await synced('Before wipe')
  await p.evaluate(() => window.__homescape.getState().layout.clearAll())
  await p.waitForTimeout(SAVE)
  const bk = await H(p, 'fakeBackups')
  ok(remoteRooms(bk?.items?.[0]).includes('Before wipe'), `After clearing the plan a copy stays in Home Assistant (${bk?.items?.length ?? 0} backups)`)
}

// --- Another Home Assistant account in the same browser ---
{
  const { p, r } = await synced('Account A room')
  const b2 = JSON.parse(JSON.stringify(r))
  b2.device = 'b-device'
  b2.updatedAt = new Date(Date.now() + 2000).toISOString()
  b2.homes[0].layout.levels[0].rooms = [{ id: 'room-b', name: 'Account B room', x: 0, z: 0, w: 4, d: 4, floor: 'wood', areaId: null }]
  await H(p, 'demo')
  await p.waitForTimeout(300)
  await put(p, b2)
  await H(p, 'fakeUser', { user: 'user-b' })
  await live(p)
  await p.waitForTimeout(400)
  ok((await p.isVisible('#sync-prompt')) && (await rooms(p)).includes('Account A room'), 'Another account: it asks instead of silently replacing this plan')
}

// --- Browser storage full: editing keeps working ---
{
  const p = await device()
  await p.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('full', 'QuotaExceededError')
    }
  })
  const n = errors.length
  await addRoom(p, 'Storage full', 30)
  await p.waitForTimeout(400)
  ok(errors.length === n && (await rooms(p)).includes('Storage full'), 'With browser storage full an edit still works')
  ok(/storage/i.test((await p.evaluate(() => document.querySelector('[role="status"]')?.textContent)) ?? ''), 'The user is told that this browser could not save')
}

// --- All homes can be downloaded ---
{
  const { p } = await synced('In the file')
  await p.click('#home-switcher')
  await p.click('#plan-history-open')
  await p.waitForSelector('#plan-history')
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#plan-history-export')])
  const path = await dl.path()
  const { readFileSync } = await import('node:fs')
  const file = JSON.parse(readFileSync(path, 'utf8'))
  ok(file.kind === 'homescape-homes' && remoteRooms(file).includes('In the file'), `All homes download as one file (${dl.suggestedFilename()})`)
}

// --- Inside the Home Assistant frontend: its connection is used, the app stores no login ---
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 }, locale: 'en-US' })
  const host = await ctx.newPage()
  host.on('pageerror', (e) => errors.push(e.message))
  const shell = `<!doctype html><home-assistant></home-assistant><script>
    window.calls = []; window.store = {}; let subs = {}
    const conn = {
      haVersion: '2026.9.1', connected: true, options: {},
      addEventListener() {}, removeEventListener() {}, suspendReconnectUntil() {}, close() { window.closed = true },
      async sendMessagePromise(m) {
        window.calls.push(m.type)
        if (m.type === 'auth/current_user') return { id: 'user-a', name: 'A', is_admin: true }
        if (m.type === 'get_states') return []
        if (m.type === 'frontend/get_user_data') return { value: window.store[m.key] ?? null }
        if (m.type === 'frontend/set_user_data') { window.store[m.key] = m.value; return null }
        if (m.type.endsWith('/list')) return []
        return null
      },
      async subscribeMessage(cb, m) {
        window.calls.push(m.type)
        if (m.type === 'subscribe_entities') cb({ a: { 'light.ha_lamp': { s: 'on', a: { friendly_name: 'HA lamp' }, c: '1', lc: 1 } } })
        if (m.type === 'frontend/subscribe_user_data') cb({ value: window.store[m.key] ?? null })
        return async () => {}
      },
    }
    document.querySelector('home-assistant').hass = { language: 'de' }
    window.hassConnection = Promise.resolve({ auth: { data: { hassUrl: location.origin }, accessToken: 'host-token' }, conn })
  </script><iframe id="app" src="/" style="width:1200px;height:760px;border:0"></iframe>`
  await host.route('**/__ha-shell', (route) => route.fulfill({ contentType: 'text/html', body: shell }))
  await host.goto(new URL('/__ha-shell', BASE).href)
  const frame = host.frameLocator('#app')
  await frame.locator('body[data-ready="1"]').waitFor({ timeout: 30000 })
  await host.waitForTimeout(1200)
  const inner = host.frames().find((f) => f !== host.mainFrame())
  const state = await inner.evaluate(() => ({ lang: document.documentElement.lang, auth: localStorage.getItem('homescape-auth'), conn: localStorage.getItem('homescape-connection'), ids: window.__homescape.entityIds() }))
  ok(state.ids.includes('light.ha_lamp'), `Inside Home Assistant the app uses the frontend's connection (${state.ids.length} entities, no sign-in)`)
  ok(state.lang === 'de', `Inside Home Assistant the language follows the Home Assistant user (${state.lang})`)
  ok(!state.auth, 'Inside Home Assistant the app stores no login token')
}

ok(errors.length === 0, `No page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await b.close()
console.log(failures ? `${failures} checks failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
