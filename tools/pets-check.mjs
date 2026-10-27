// Pets and outdoor visitors regression test (user request, 9 Oct 2026: "add animals outside too, let them pass by now and then;
// I can add a cat and a dog inside the house, they should move on their own; I can interact with them").
// `npm run dev` must be running first. Run: node tools/pets-check.mjs
// Intermediate screenshots: shots/pets-*.png. The test deletes everything it adds at the end.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('shots', { recursive: true })
let failures = 0
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
const errors = []
p.on('pageerror', (e) => errors.push(`${e.message} ${(e.stack ?? '').split('\n').slice(1, 3).join(' ')}`))
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
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
/** The current state of the pets (without functions) */
const pets = () => p.evaluate(() => window.__homescape.pets().then((d) => JSON.parse(JSON.stringify(d))))
const cmd = (id, action, x, z) => p.evaluate(([id, action, x, z]) => window.__homescape.pets().then((d) => d.command(id, action, x, z)), [id, action, x, z])
const inRect = (r, x, z) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d
const roomAt = (L, x, z) => L.rooms.find((r) => [r, ...(r.parts ?? [])].some((q) => inRect(q, x, z)))
const shot = (name) => p.screenshot({ path: `shots/pets-${name}.png` })
const focus = async (roomId) => {
  await p.evaluate((id) => window.__homescape.focusRoom(id), roomId)
  await p.waitForTimeout(1700)
}
const added = []
let L = await level()
const living = L.rooms.find((r) => /living/i.test(r.name)) ?? L.rooms[0]
const kitchen = L.rooms.find((r) => /kitchen/i.test(r.name)) ?? L.rooms[1]
const bedroom = L.rooms.find((r) => /bedroom/i.test(r.name)) ?? L.rooms[2]
const perfOf = () => p.evaluate(() => window.__homescape.perf())

// --- Pure logic: a path only passes through doors, sleep at night, the dog greets during a walk, an over-petted cat hisses ---
{
  const r = await p.evaluate(
    ([liv, kit]) =>
      import('/src/model/pets.ts').then((m) => {
        const s = window.__homescape.getState().layout
        const L = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
        const g = m.buildPetGrid(L, 'cat')
        const from = { x: liv.x + liv.w / 2, z: liv.z + liv.d / 2 }
        const to = { x: kit.x + kit.w / 2, z: kit.z + kit.d / 2 }
        const path = m.findPath(g, from, to)
        // is every step of the path walkable (it does not enter a wall)
        let blocked = 0
        let prev = from
        for (const q of path ?? []) {
          if (!m.lineFree(g, prev, q)) blocked++
          prev = q
        }
        const doors = L.items.filter((i) => i.kind === 'door')
        const viaDoor = (path ?? []).some((q) => doors.some((d) => Math.hypot(d.x - q.x, d.z - q.z) < 1.2))
        const wallFree = !m.isFree(g, liv.x + liv.w, liv.z + 0.4) // the room border (wall) is closed
        const base = { species: 'cat', places: [], home: { x: 0, z: 0, rot: 0 }, pos: { x: 0, z: 0 }, needs: { energy: 0.9, food: 0.9, fun: 0.9, love: 0.9 }, day: true, people: [], taken: [], feeding: false, last: null, wander: () => ({ x: 1, z: 1 }), rnd: () => 0.3 }
        const night = m.chooseGoal({ ...base, mode: 'night' }).action
        const greet = m.chooseGoal({ ...base, species: 'dog', mode: 'home', player: { x: 2, z: 0 }, rnd: () => 0 }).action
        const hiss = m.chooseReaction('cat', { sleeping: false, recent: 4 }, () => 0.5).kind
        const bark = m.chooseReaction('dog', { sleeping: false, recent: 0 }, () => 0.1).bubble
        const mode = [m.petMode('armed_night', 14), m.petMode(undefined, 2), m.petMode('armed_away', 14), m.petMode(undefined, 14)]
        return { n: path?.length ?? 0, blocked, viaDoor, wallFree, night, greet, hiss, bark, mode }
      }),
    [living, kitchen],
  )
  ok(r.n > 0 && r.blocked === 0 && r.viaDoor && r.wallFree, `Path on the grid: ${r.n} steps from the living room to the kitchen, it passes through a door, wall cells are closed`)
  ok(r.night === 'sleep' && r.greet === 'greet' && r.hiss === 'hiss' && r.bark.startsWith('Woof'), `Decisions: night ${r.night}, dog on a walk ${r.greet}, over-petted cat ${r.hiss}, dog "${r.bark}"`)
  ok(r.mode.join() === 'night,night,away,home', `Mode: night alarm, night hour, away, daytime: ${r.mode.join(', ')}`)
}

// --- Build bar: the Pets tab and its cards ---
const before = await perfOf()
{
  await p.evaluate(() => window.__homescape.setMode('edit'))
  await p.waitForTimeout(600)
  await p.getByRole('button', { name: 'Pets', exact: true }).click()
  await p.waitForTimeout(400)
  const names = ['Cat', 'Dog', 'Cat bed', 'Dog bed', 'Food and water bowl', 'Smart pet feeder', 'Litter box', 'Cat tree', 'Dog house', 'Toy']
  const found = []
  for (const n of names) if (await p.getByText(n, { exact: true }).first().isVisible().catch(() => false)) found.push(n)
  ok(found.length === names.length, `The "Pets" tab has ${found.length}/${names.length} cards (${names.filter((n) => !found.includes(n)).join(', ') || 'all'})`)
}

// --- Placement: the cat, the dog and their items (in the living room) ---
const ids = await p.evaluate((liv) => {
  const s = window.__homescape.getState().layout
  const x0 = liv.x
  const z0 = liv.z
  return {
    cat: s.addItem('cat', x0 + 2.4, z0 + 1.45, 0, null, undefined, { variant: 'tabby' }),
    dog: s.addItem('dog', x0 + 5.6, z0 + 1.6, 0, null, undefined, { variant: 'golden' }),
    bowl: s.addItem('petBowl', x0 + 0.45, z0 + 3.6, Math.PI / 2),
    bed: s.addItem('catBed', x0 + 5.6, z0 + 4.35, 0),
    tree: s.addItem('catTree', x0 + 1.4, z0 + 1.05, 0),
    toy: s.addItem('petToy', x0 + 5.4, z0 + 2.45, 0),
  }
}, living)
added.push(...Object.values(ids))
{
  L = await level()
  const kinds = L.items.filter((i) => added.includes(i.id)).map((i) => i.kind)
  const checks = await p.evaluate(
    (ids) =>
      import('/src/model/rules.ts').then((m) => {
        const s = window.__homescape.getState().layout
        const L = s.layout.levels.find((l) => l.id === s.levelId) ?? s.layout.levels[0]
        return Object.values(ids).map((id) => {
          const it = L.items.find((i) => i.id === id)
          return `${it.kind}:${m.checkItem(L, it, it.id).ok ? 'valid' : m.checkItem(L, it, it.id).reason}`
        })
      }),
    ids,
  )
  ok(kinds.includes('cat') && kinds.includes('dog') && checks.every((c) => c.endsWith('valid')), `The cat, the dog and the items were placed on the plan and follow the rules (${checks.join(', ')})`)
}

// --- Edit mode: the pet stays in place (not live), it is selected and dragged ---
{
  await p.evaluate(() => window.__homescape.select(null))
  await focus(living.id)
  const d0 = await pets()
  // drag (with nothing selected; the label of a selected item would overlap): 60 px to the right from the cat
  L = await level()
  const cat0 = L.items.find((i) => i.id === ids.cat)
  const pt = await p.evaluate(([x, z]) => window.__homescape.project(x, 0.18, z), [cat0.x, cat0.z])
  await p.mouse.move(pt.x, pt.y)
  await p.mouse.down()
  await p.mouse.move(pt.x + 20, pt.y + 6, { steps: 3 })
  await p.mouse.move(pt.x + 60, pt.y + 14, { steps: 5 })
  await p.mouse.up()
  await p.waitForTimeout(300)
  L = await level()
  const cat1 = L.items.find((i) => i.id === ids.cat)
  const moved = Math.hypot(cat1.x - cat0.x, cat1.z - cat0.z)
  await p.evaluate((id) => window.__homescape.select({ type: 'item', id }), ids.cat)
  await p.waitForTimeout(500)
  const outlines = (await perfOf()).outlines
  await shot('edit')
  ok(d0.live === 0 && d0.pets.length === 0 && outlines > 0, `In edit mode the pets are not live (${d0.pets.length}), the cat is drawn in place and selected (outline ${outlines})`)
  ok(moved > 0.15, `In edit mode the cat is dragged like an item (${moved.toFixed(2)} m)`)
  await p.evaluate(() => window.__homescape.select(null))
}

// --- View mode: they come alive, walk, and only pass through doors ---
{
  await p.evaluate(() => window.__homescape.setMode('view'))
  await p.waitForTimeout(1200)
  let d = await pets()
  ok(d.live === 2 && d.pets.length === 2 && d.pets.some((q) => q.species === 'cat') && d.pets.some((q) => q.species === 'dog'), `In view mode the cat and the dog are live (${d.pets.map((q) => `${q.species}: ${q.label}`).join(', ')})`)
  // the cat is sent to the kitchen, the dog to the bedroom
  const catTo = { x: kitchen.x + 1.3, z: kitchen.z + kitchen.d - 1.1 }
  const dogTo = { x: bedroom.x + 0.9, z: bedroom.z + bedroom.d - 0.7 }
  const busy0 = d.busy
  await cmd(ids.cat, 'wander', catTo.x, catTo.z)
  await cmd(ids.dog, 'wander', dogTo.x, dogTo.z)
  L = await level()
  const doors = L.items.filter((i) => i.kind === 'door')
  const last = {}
  let outside = 0
  let badCross = 0
  const dist = { cat: 0, dog: 0 }
  for (let k = 0; k < 90; k++) {
    d = await pets()
    for (const q of d.pets) {
      if (!roomAt(L, q.x, q.z)) outside++
      const prev = last[q.id]
      if (prev) {
        dist[q.species] += Math.hypot(q.x - prev.x, q.z - prev.z)
        const r0 = roomAt(L, prev.x, prev.z)?.id
        const r1 = roomAt(L, q.x, q.z)?.id
        if (r0 && r1 && r0 !== r1 && !doors.some((dd) => Math.hypot(dd.x - (q.x + prev.x) / 2, dd.z - (q.z + prev.z) / 2) < 1.3)) badCross++
      }
      last[q.id] = { x: q.x, z: q.z }
    }
    const c = d.pets.find((q) => q.id === ids.cat)
    const g = d.pets.find((q) => q.id === ids.dog)
    if (c && g && Math.hypot(c.x - catTo.x, c.z - catTo.z) < 0.5 && Math.hypot(g.x - dogTo.x, g.z - dogTo.z) < 0.5 && !c.moving && !g.moving) break
    await p.waitForTimeout(250)
  }
  const c = d.pets.find((q) => q.id === ids.cat)
  const g = d.pets.find((q) => q.id === ids.dog)
  ok(dist.cat > 2 && dist.dog > 2 && d.busy === busy0 && d.ambient === 'full', `They walk their own paths (cat ${dist.cat.toFixed(1)} m, dog ${dist.dog.toFixed(1)} m), at ambient rate (without asking for a frame on every frame: ${d.busy - busy0})`)
  ok(c.roomId === kitchen.id && g.roomId === bedroom.id, `The cat reached the kitchen (${c.roomId === kitchen.id}), the dog the bedroom (${g.roomId === bedroom.id}) through doors`)
  ok(outside === 0 && badCross === 0 && d.wallCross === 0, `Always inside the rooms (outside ${outside}), they do not pass through walls (room changes away from a door ${badCross}, counter ${d.wallCross})`)
}

// --- On their own: over time they pick new activities (NPC) ---
{
  const seen = new Set()
  const t0 = Date.now()
  let moved = 0
  let last = null
  for (let k = 0; k < 40; k++) {
    const d = await pets()
    for (const q of d.pets) seen.add(`${q.species}:${q.action}`)
    const c = d.pets.find((q) => q.id === ids.cat)
    if (last) moved += Math.hypot(c.x - last.x, c.z - last.z)
    last = c
    if (seen.size >= 4 && moved > 0.5) break
    await p.waitForTimeout(500)
  }
  ok(seen.size >= 3, `They pick new activities on their own: ${[...seen].join(', ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}

// --- Reaction on click: the cat meows / purrs, the dog barks; nothing gets selected, the quick toggle still works ---
/**
 * Sits the pet at a spot and focuses on the room; clicks if it is in the open on screen (not under the cards; the cursor becomes a
 * hand: not behind a wall). If it ends up behind a full-height interior wall facing the camera, it tries the next spot.
 */
const skipped = []
async function clickPet(id, room, spots, y) {
  skipped.length = 0
  for (const s of spots) {
    await cmd(id, 'sit', s.x, s.z)
    await focus(room.id)
    await p.waitForTimeout(500)
    // Until it arrives and stops: if clicked while walking the cursor stays a hand (the mouse does not move) but the pet has left that spot by the time of the click
    let q = null
    for (let k = 0; k < 40; k++) {
      q = (await pets()).pets.find((v) => v.id === id)
      if (q && !q.moving) break
      await p.waitForTimeout(250)
    }
    await p.waitForTimeout(400)
    q = (await pets()).pets.find((v) => v.id === id)
    const pt = await p.evaluate(([x, y, z]) => window.__homescape.project(x, y, z), [q.x, y, q.z])
    if (pt.x < 60 || pt.x > 1180 || pt.y < 170 || pt.y > 810) {
      skipped.push(`off screen ${pt.x.toFixed(0)},${pt.y.toFixed(0)}`)
      continue
    }
    const tag = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [pt.x, pt.y])
    if (tag !== 'CANVAS') {
      skipped.push(`covered by ${tag}`)
      continue
    }
    await p.mouse.move(pt.x, pt.y, { steps: 3 })
    await p.waitForTimeout(150)
    const cursor = await p.evaluate(() => document.body.style.cursor)
    if (cursor !== 'pointer') {
      skipped.push(`cursor ${cursor || 'none'} (${q.x.toFixed(2)},${q.z.toFixed(2)} ${q.action})`)
      await p.mouse.move(5, 450)
      continue
    }
    await p.mouse.click(pt.x, pt.y)
    await p.waitForTimeout(350)
    const after = (await pets()).pets.find((v) => v.id === id)
    await p.mouse.move(5, 450)
    return { ...after, cursor }
  }
  return null
}
{
  const c = await clickPet(ids.cat, kitchen, [
    { x: kitchen.x + 1.6, z: kitchen.z + 1.6 },
    { x: kitchen.x + 2.2, z: kitchen.z + 2.4 },
    { x: kitchen.x + 4.2, z: kitchen.z + 1.6 },
  ], 0.2)
  const sel = (await p.evaluate(() => window.__homescape.getState().layout.selection)) ?? null
  await shot('cat-reaction')
  ok(Boolean(c?.react) && /Meow|Purr|Mrrr|Hiss/.test(c?.bubble ?? ''), `Clicking the cat (cursor ${c?.cursor ?? '-'}) gives a reaction: ${c?.react} "${c?.bubble}"`)
  ok(sel === null, `Clicking a pet does not select an item or a room (selection ${JSON.stringify(sel)})`)

  const g = await clickPet(ids.dog, bedroom, [
    { x: bedroom.x + 1.0, z: bedroom.z + bedroom.d - 0.8 },
    { x: bedroom.x + bedroom.w - 0.9, z: bedroom.z + bedroom.d - 0.8 },
    { x: bedroom.x + 0.9, z: bedroom.z + 0.9 },
  ], 0.4)
  await shot('dog-reaction')
  if (!g?.react) console.log('dog attempts:', JSON.stringify(skipped))
  ok(Boolean(g?.react) && /Woof/.test(g?.bubble ?? ''), `Clicking the dog gives a reaction: ${g?.react} "${g?.bubble}"`)

  // the quick toggle still works: a pill appears when hovering over the pendant lamp in the living room
  await p.mouse.move(5, 450)
  await focus(living.id)
  L = await level()
  const bound = L.items.find((i) => i.kind === 'pendant' && i.entityId)
  let pill = null
  if (bound) {
    const pb = await p.evaluate(([x, z]) => window.__homescape.project(x, 2.0, z), [bound.x, bound.z])
    await p.mouse.move(pb.x, pb.y, { steps: 4 })
    await p.waitForTimeout(500)
    pill = await p.locator('[data-quick]').getAttribute('data-quick', { timeout: 1500 }).catch(() => null)
  }
  ok(!bound || Boolean(pill), `The quick toggle pill still works (${bound?.kind ?? 'no bound item'}: ${pill ? 'the pill appeared' : 'it did not appear'})`)
  await p.mouse.move(5, 450)
}

// --- Walkthrough: the dog runs to the player ---
{
  await p.click('#fps-toggle')
  await p.waitForSelector('#fps-hud')
  await p.waitForTimeout(400)
  const d0 = await pets()
  const g0 = d0.pets.find((q) => q.id === ids.dog)
  // the player is 2.5 m from the dog, looking at the dog
  const px = bedroom.x + bedroom.w - 0.8
  const pz = bedroom.z + bedroom.d - 0.9
  await p.evaluate(([x, z, gx, gz]) => window.__homescape.fpsTeleport(x, z, Math.atan2(-(gx - x), -(gz - z)), -0.45), [px, pz, g0.x, g0.z])
  await cmd(ids.dog, 'greet')
  let near = 99
  for (let k = 0; k < 24; k++) {
    await p.waitForTimeout(250)
    const g = (await pets()).pets.find((q) => q.id === ids.dog)
    near = Math.hypot(g.x - px, g.z - pz)
    if (near < 1.2) break
  }
  await p.waitForTimeout(800)
  await shot('walk-dog')
  ok(near < 1.3, `In the walkthrough the dog runs to the player and comes next to them (${near.toFixed(2)} m)`)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
  if (await p.isVisible('#fps-hud')) await p.click('#fps-toggle')
  await p.waitForTimeout(500)
}

// --- Night: they sleep ---
{
  await p.evaluate(() => window.__homescape.pets().then((d) => d.setHour(2)))
  let d = null
  // the cat zooms around now and then at night (zoomies); waits at most 75 s
  for (let k = 0; k < 150; k++) {
    await p.waitForTimeout(500)
    d = await pets()
    if (d.pets.every((q) => q.action === 'sleep' && (q.pose === 'curl' || q.pose === 'lie'))) break
  }
  await focus(living.id)
  await shot('night-sleep')
  ok(d.mode === 'night' && d.pets.every((q) => q.action === 'sleep' && (q.pose === 'curl' || q.pose === 'lie')), `At night (02:00) the pets sleep: ${d.pets.map((q) => `${q.species} ${q.label} (${q.pose})`).join(', ')}`)
  await p.evaluate(() => window.__homescape.pets().then((d) => d.setHour(null)))
}

// --- Outdoor visitors: they pass by outside the house and leave ---
for (const kind of ['dog', 'birds', 'cat']) {
  const seen0 = (await pets()).visitorsSeen
  const forced = await p.evaluate((k) => window.__homescape.pets().then((d) => d.forceVisitor(k, 3)), kind)
  await p.waitForTimeout(300)
  const samples = []
  let ended = false
  let total = 0
  const t0 = Date.now()
  let shotTaken = false
  while (Date.now() - t0 < 30000) {
    const d = await pets()
    if (!d.visitor) {
      if (samples.length) {
        ended = true
        break
      }
    } else {
      samples.push(d.visitor)
      total = d.visitor.total
      if (!shotTaken && kind === 'birds' && d.visitor.act === 'peck') {
        await shot('visitor-birds')
        shotTaken = true
      }
    }
    await p.waitForTimeout(200)
  }
  L = await level()
  const inside = samples.filter((v) => L.rooms.some((r) => (r.type ?? 'room') !== 'garden' && [r, ...(r.parts ?? [])].some((q) => inRect(q, v.x, v.z))))
  const label = samples[0]?.label ?? kind
  ok(forced && samples.length > 3 && ended && inside.length === 0 && (await pets()).visitorsSeen > seen0, `Visitor (${label}) was called, always outside the house in ${samples.length} samples (inside ${inside.length}), finished its ${total.toFixed(0)} s route and left`)
}

// --- Performance: while asleep they do not ask for frames themselves (only the slow ambient rate), draw cost ---
{
  await p.evaluate(() => window.__homescape.pets().then((d) => d.setHour(2)))
  for (let k = 0; k < 40; k++) {
    await p.waitForTimeout(500)
    const d = await pets()
    if (d.pets.every((q) => q.action === 'sleep' && !q.moving && q.pose === 'curl')) break
  }
  await p.waitForTimeout(2500)
  const b0 = (await pets()).busy
  const f0 = await perfOf()
  await p.waitForTimeout(4000)
  const f1 = await perfOf()
  const d = await pets()
  const fps = (f1.frames - f0.frames) / 4
  console.log(`INFO  idle (pets asleep, including people and other ambient animations) ${fps.toFixed(1)} frames/s; draw calls ${f1.calls} (${before.calls} at startup without pets), triangles ${f1.triangles} (${before.triangles})`)
  ok(d.busy - b0 === 0 && d.ambient === 'slow', `While asleep the pets do not ask for a frame on every frame (${d.busy - b0} frames), ambient rate ${d.ambient} (half rate)`)
  await p.evaluate(() => window.__homescape.pets().then((d) => d.setHour(null)))
}

// --- Cleanup ---
await p.evaluate((ids) => {
  const s = window.__homescape.getState().layout
  for (const id of ids) s.deleteItem(id)
  s.select(null)
}, added)
await p.waitForTimeout(500)
const rest = (await level()).items.filter((i) => added.includes(i.id)).length
const live = (await pets()).live
ok(rest === 0 && live === 0, `The test items were deleted (${rest} left), no live pets (${live})`)

const errs = errors.filter((e) => !/THREE\.Clock|deprecated/i.test(e))
ok(errs.length === 0, `No page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`)

await b.close()
if (failures) {
  console.log(`\n${failures} checks failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
