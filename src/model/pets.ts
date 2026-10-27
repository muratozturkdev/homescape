import type { Entities } from '@/ha/types'
import { t } from '@/i18n'
import { sizeOf } from './catalog'
import { bounds, isOutdoor, rectsOf, runOpenings, WALL_IN, wallRuns } from './geometry'
import { footprints, layerOf } from './rules'
import type { Item, ItemKind, Level, Rect, Room } from './types'

/*
 * Pets and animals passing by outside: animals pass outside now and then; cats and dogs can be added to the house as pets.
 * They move on their own with their own mechanics, like NPCs, and can be interacted with.
 *
 * Pure logic (independent of the scene, testable): the walkable grid (walls are only crossed through doors, large
 * furniture is walked around), A* path finding, the pet's favorite places (bed, sofa, cat tree, window sill, sunny spot,
 * food and water bowl, litter box, toy), needs (energy, food, fun, love) and the next activity based on them, the reaction
 * to a click, the paths of outdoor visitors. Drawing and movement: scene/Pets.tsx.
 */

export type Species = 'cat' | 'dog'
export const PET_KINDS: ItemKind[] = ['cat', 'dog']
/** Pet items (the "Pets" tab of the build bar) */
export const PET_GEAR: ItemKind[] = ['catBed', 'dogBed', 'petBowl', 'petFeeder', 'litterBox', 'catTree', 'dogHouse', 'petToy']

export type PetPose = 'stand' | 'sit' | 'lie' | 'curl'
export type PetAction =
  | 'idle'
  | 'wander'
  | 'sit'
  | 'rest'
  | 'sleep'
  | 'groom'
  | 'stretch'
  | 'eat'
  | 'drink'
  | 'play'
  | 'zoomies'
  | 'pounce'
  | 'follow'
  | 'greet'
  | 'watch'
  | 'perch'
  | 'scratch'
  | 'litter'
  | 'rub'
  | 'avoid'
  | 'sniff'

/** Plain name of the activity (debug values for tests, not shown in the UI) */
export const ACTION_LABEL: Record<PetAction, string> = {
  idle: 'looking around',
  wander: 'wandering',
  sit: 'sitting',
  rest: 'resting',
  sleep: 'sleeping',
  groom: 'grooming',
  stretch: 'stretching',
  eat: 'eating',
  drink: 'drinking',
  play: 'playing',
  zoomies: 'zooming around',
  pounce: 'lying in wait',
  follow: 'following',
  greet: 'greeting',
  watch: 'watching outside',
  perch: 'perching',
  scratch: 'scratching',
  litter: 'in the litter box',
  rub: 'rubbing',
  avoid: 'moving away',
  sniff: 'sniffing',
}

/* ---------- needs ---------- */

/** 0-1 (1 full): energy, food, fun, love. They drop over time; sleep, food, play and affection fill them up. */
export interface PetNeeds {
  energy: number
  food: number
  fun: number
  love: number
}

export const freshNeeds = (rnd: () => number): PetNeeds => ({ energy: 0.65 + rnd() * 0.3, food: 0.55 + rnd() * 0.35, fun: 0.35 + rnd() * 0.4, love: 0.4 + rnd() * 0.4 })

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Change of the needs over dt seconds (by the current activity). nearPeople: someone within 1.5 m. */
export function tickNeeds(n: PetNeeds, action: PetAction, dt: number, moving: 'still' | 'walk' | 'run', nearPeople: boolean): PetNeeds {
  const resting = action === 'sleep' ? 0.022 : action === 'rest' || action === 'perch' || action === 'watch' ? 0.004 : 0
  const tire = moving === 'run' ? 0.012 : moving === 'walk' ? 0.005 : 0.002
  const play = action === 'play' || action === 'zoomies' || action === 'pounce' || action === 'scratch' ? 0.07 : 0
  return {
    energy: clamp01(n.energy + (resting - (resting ? 0 : tire)) * dt),
    food: clamp01(n.food + (action === 'eat' ? 0.12 : action === 'drink' ? 0.02 : -0.0025) * dt),
    fun: clamp01(n.fun + (play - 0.004) * dt),
    love: clamp01(n.love + ((nearPeople ? 0.02 : 0) + (action === 'rub' || action === 'greet' ? 0.04 : 0) - 0.003) * dt),
  }
}

/* ---------- mode ---------- */

export type PetMode = 'home' | 'night' | 'away'

/**
 * Mode of the pets: with the alarm on Away / Vacation the house is empty (they stay inside and mostly sleep); night mode or
 * 23:00-07:00 is night (they mostly sleep; the same hours as people.ts > peopleMode).
 */
export function petMode(alarm: string | undefined, hour: number): PetMode {
  if (alarm === 'armed_away' || alarm === 'armed_vacation') return 'away'
  if (alarm === 'armed_night') return 'night'
  if (hour >= 23 || hour < 7) return 'night'
  return 'home'
}

/* ---------- walkable grid ---------- */

export interface PetGrid {
  x0: number
  z0: number
  cell: number
  nx: number
  nz: number
  /** 0 blocked (wall, furniture, outside the rooms), 1 indoor, 2 outdoor (garden, balcony, terrace) */
  walk: Uint8Array
  /** The cell's room (index into level.rooms; -1 none) */
  room: Int16Array
  rooms: Room[]
}

/** Who walks on the grid: pets and the people at home (model/people.ts > route) */
export type Mover = Species | 'person'
/** Clearance kept from walls and items (m) */
export const CLEAR: Record<Mover, number> = { cat: 0.1, dog: 0.15, person: 0.18 }
/** Items it can pass under (table, chair); people none */
const UNDER: Record<Mover, ItemKind[]> = {
  person: [],
  cat: ['diningTable', 'coffeeTable', 'roundTable', 'desk', 'chair', 'gamingChair', 'outdoorTable', 'lounger', 'swing', 'clothesRack', 'workbench'],
  dog: ['diningTable', 'desk', 'outdoorTable', 'swing', 'clothesRack'],
}
/** Items that can be walked over or through */
const PASS: ItemKind[] = ['rug', 'doormat', 'robotVacuum', 'lawnMower', 'leakSensor', 'sprinkler', 'door', 'window', 'garageDoor', 'stringLights', 'gardenLight', 'parasol', 'cat', 'dog', 'petToy', 'stairs']

/** Area with walls or railings: indoor room, garage, balcony, terrace (not gardens and similar open ground) */
const solid = (r: Room) => !isOutdoor(r) || r.type === 'balcony' || r.type === 'terrace'

/** Distance of a point to a line segment */
function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1
  const dz = z2 - z1
  const l2 = dx * dx + dz * dz || 1e-9
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l2))
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t))
}

/**
 * Walkable grid of a level: the inside of rooms is open; walls (except door openings; windows are no passage) and balcony
 * railings are blocked, as are the footprints of large floor items (tables can be passed under). Cells are 12 cm.
 * Cached per level (the same grid while the level object does not change), so pets and people do not rebuild it when the
 * level changes in walk mode. Stairwell holes on the level above (model/stairwell.ts) are not walkable: the scene gives
 * the holes.
 */
const gridCache = new WeakMap<Level, Map<string, PetGrid>>()
let holeSource: (level: Level) => Rect[] = () => []
export function setGridHoles(fn: (level: Level) => Rect[]) {
  holeSource = fn
}

export function buildPetGrid(level: Level, species: Mover, cell = 0.12): PetGrid {
  const holes = holeSource(level)
  const key = `${species}|${cell}|${JSON.stringify(holes)}`
  let m = gridCache.get(level)
  if (!m) gridCache.set(level, (m = new Map()))
  let g = m.get(key)
  if (!g) {
    g = makeGrid(level, species, cell)
    for (const h of holes) {
      const i0 = Math.max(0, Math.floor((h.x - g.x0) / cell))
      const i1 = Math.min(g.nx - 1, Math.floor((h.x + h.w - g.x0) / cell))
      const j0 = Math.max(0, Math.floor((h.z - g.z0) / cell))
      const j1 = Math.min(g.nz - 1, Math.floor((h.z + h.d - g.z0) / cell))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.walk[j * g.nx + i] = 0
    }
    m.set(key, g)
  }
  return g
}

function makeGrid(level: Level, species: Mover, cell: number): PetGrid {
  const rooms = level.rooms
  const b = bounds(rooms)
  const x0 = b.minX - cell
  const z0 = b.minZ - cell
  const nx = Math.max(1, Math.ceil((b.maxX - b.minX) / cell) + 2)
  const nz = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell) + 2)
  const walk = new Uint8Array(nx * nz)
  const room = new Int16Array(nx * nz).fill(-1)
  const clear = CLEAR[species]
  if (!rooms.length) return { x0, z0, cell, nx, nz, walk, room, rooms }
  const rects = rooms.map((r, i) => ({ i, rs: rectsOf(r) }))
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell
      const z = z0 + (j + 0.5) * cell
      const hit = rects.find((r) => r.rs.some((q) => x > q.x && x < q.x + q.w && z > q.z && z < q.z + q.d))
      if (!hit) continue
      room[j * nx + i] = hit.i
      walk[j * nx + i] = isOutdoor(rooms[hit.i]) ? 2 : 1
    }
  const block = (minX: number, maxX: number, minZ: number, maxZ: number, test: (x: number, z: number) => boolean) => {
    const i0 = Math.max(0, Math.floor((minX - x0) / cell))
    const i1 = Math.min(nx - 1, Math.floor((maxX - x0) / cell))
    const j0 = Math.max(0, Math.floor((minZ - z0) / cell))
    const j1 = Math.min(nz - 1, Math.floor((maxZ - z0) / cell))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i
        if (walk[k] && test(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) walk[k] = 0
      }
  }
  // walls and railings: door (and garage door) openings are passages
  const doors = level.items.filter((i) => i.kind === 'door' || i.kind === 'garageDoor')
  for (const r of rooms) {
    if (!solid(r)) continue
    const rail = isOutdoor(r)
    for (const run of wallRuns(r, rooms)) {
      const gaps = rail ? [] : runOpenings(run, doors).sort((a, c) => a.a0 - c.a0)
      const half = (rail ? 0.03 : WALL_IN) + clear
      let a = run.a0 - (rail ? 0 : WALL_IN)
      const end = run.a1 + (rail ? 0 : WALL_IN)
      const push = (s: number, e: number) => {
        if (e - s < 0.01) return
        const [x1, z1, x2, z2] = run.horizontal ? [s, run.line, e, run.line] : [run.line, s, run.line, e]
        block(Math.min(x1, x2) - half, Math.max(x1, x2) + half, Math.min(z1, z2) - half, Math.max(z1, z2) + half, (x, z) => segDist(x, z, x1, z1, x2, z2) < half)
      }
      for (const g of gaps) {
        push(a, g.a0)
        a = Math.max(a, g.a1)
      }
      push(a, end)
    }
  }
  // large floor items (tables and chairs can be passed under; small items are no obstacle)
  const under = UNDER[species]
  for (const it of level.items) {
    if (PASS.includes(it.kind) || under.includes(it.kind)) continue
    if (layerOf(it.kind, it.y, it.variant, it.mount) !== 'floor') continue
    for (const f of footprints({ kind: it.kind, x: it.x, z: it.z, rot: it.rot, len: it.len, len2: it.len2, variant: it.variant, mount: it.mount })) {
      if (Math.min(f.maxX - f.minX, f.maxZ - f.minZ) < 0.1) continue
      const m = clear * 0.7
      block(f.minX - m, f.maxX + m, f.minZ - m, f.maxZ + m, () => true)
    }
  }
  return { x0, z0, cell, nx, nz, walk, room, rooms }
}

const cellOf = (g: PetGrid, x: number, z: number): [number, number] => [Math.floor((x - g.x0) / g.cell), Math.floor((z - g.z0) / g.cell)]
const centerOf = (g: PetGrid, i: number, j: number) => ({ x: g.x0 + (i + 0.5) * g.cell, z: g.z0 + (j + 0.5) * g.cell })
const inGrid = (g: PetGrid, i: number, j: number) => i >= 0 && j >= 0 && i < g.nx && j < g.nz
const allowed = (g: PetGrid, k: number, outdoor: boolean) => g.walk[k] === 1 || (outdoor && g.walk[k] === 2)

/** The point's room (from the grid; index into level.rooms, -1 none) */
export function gridRoom(g: PetGrid, x: number, z: number) {
  const [i, j] = cellOf(g, x, z)
  return inGrid(g, i, j) ? g.room[j * g.nx + i] : -1
}

/** Whether the point is walkable */
export function isFree(g: PetGrid, x: number, z: number, outdoor = false) {
  const [i, j] = cellOf(g, x, z)
  return inGrid(g, i, j) && allowed(g, j * g.nx + i, outdoor)
}

/** Center of the nearest walkable cell; with room, only in that room (so it does not jump to the other side of a wall). */
export function nearestFree(g: PetGrid, x: number, z: number, opts: { room?: number; outdoor?: boolean; max?: number } = {}) {
  const [ci, cj] = cellOf(g, x, z)
  const maxR = Math.ceil((opts.max ?? 2.5) / g.cell)
  for (let r = 0; r <= maxR; r++) {
    let best: { x: number; z: number } | null = null
    let bd = Infinity
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !inGrid(g, i, j)) continue
        const k = j * g.nx + i
        if (!allowed(g, k, Boolean(opts.outdoor))) continue
        if (opts.room != null && opts.room >= 0 && g.room[k] !== opts.room) continue
        const c = centerOf(g, i, j)
        const d = Math.hypot(c.x - x, c.z - z)
        if (d < bd) {
          bd = d
          best = c
        }
      }
    if (best) return best
  }
  return null
}

/** Whether the straight line between two points is open (in half-cell steps) */
export function lineFree(g: PetGrid, a: { x: number; z: number }, b: { x: number; z: number }, outdoor = false) {
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const n = Math.max(1, Math.ceil(d / (g.cell * 0.5)))
  for (let s = 0; s <= n; s++) {
    const t = s / n
    if (!isFree(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, outdoor)) return false
  }
  return true
}

/**
 * Path with A* (8 neighbors); a start or goal in a blocked cell (on an item, at a wall) uses the nearest open cell in the
 * same room. Returns the waypoints (without the start, the last one is the arrival point; straight stretches shortened).
 * null when there is no path.
 */
export function findPath(g: PetGrid, from: { x: number; z: number }, to: { x: number; z: number }, outdoor = false): { x: number; z: number }[] | null {
  const s0 = isFree(g, from.x, from.z, outdoor) ? from : nearestFree(g, from.x, from.z, { room: gridRoom(g, from.x, from.z), outdoor, max: 1.5 }) ?? nearestFree(g, from.x, from.z, { outdoor, max: 1.5 })
  const goalRoom = gridRoom(g, to.x, to.z)
  const t0 = isFree(g, to.x, to.z, outdoor) ? to : nearestFree(g, to.x, to.z, { room: goalRoom, outdoor })
  if (!s0 || !t0) return null
  const [si, sj] = cellOf(g, s0.x, s0.z)
  const [ti, tj] = cellOf(g, t0.x, t0.z)
  const N = g.nx * g.nz
  const start = sj * g.nx + si
  const goal = tj * g.nx + ti
  if (start === goal) return [{ x: t0.x, z: t0.z }]
  const gs = new Float32Array(N).fill(Infinity)
  const came = new Int32Array(N).fill(-1)
  const closed = new Uint8Array(N)
  // binary heap: (priority, cell)
  const heap: number[] = []
  const pri: number[] = []
  const push = (k: number, f: number) => {
    heap.push(k)
    pri.push(f)
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (pri[p] <= pri[c]) break
      ;[heap[p], heap[c]] = [heap[c], heap[p]]
      ;[pri[p], pri[c]] = [pri[c], pri[p]]
      c = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const lk = heap.pop()!
    const lf = pri.pop()!
    if (heap.length) {
      heap[0] = lk
      pri[0] = lf
      let c = 0
      for (;;) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        if (l < heap.length && pri[l] < pri[m]) m = l
        if (r < heap.length && pri[r] < pri[m]) m = r
        if (m === c) break
        ;[heap[m], heap[c]] = [heap[c], heap[m]]
        ;[pri[m], pri[c]] = [pri[c], pri[m]]
        c = m
      }
    }
    return top
  }
  const h = (k: number) => {
    const dx = Math.abs((k % g.nx) - ti)
    const dz = Math.abs(Math.floor(k / g.nx) - tj)
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz)
  }
  gs[start] = 0
  push(start, h(start))
  let found = false
  let steps = 0
  while (heap.length && steps++ < N * 4) {
    const k = pop()
    if (closed[k]) continue
    if (k === goal) {
      found = true
      break
    }
    closed[k] = 1
    const i = k % g.nx
    const j = Math.floor(k / g.nx)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        if (!inGrid(g, ni, nj)) continue
        const nk = nj * g.nx + ni
        if (closed[nk] || !allowed(g, nk, outdoor)) continue
        // no corner cutting on diagonals
        if (di && dj && (!allowed(g, j * g.nx + ni, outdoor) || !allowed(g, nj * g.nx + i, outdoor))) continue
        const ng = gs[k] + (di && dj ? 1.414 : 1)
        if (ng < gs[nk]) {
          gs[nk] = ng
          came[nk] = k
          push(nk, ng + h(nk))
        }
      }
  }
  if (!found) return null
  const cells: { x: number; z: number }[] = []
  for (let k = goal; k !== -1 && k !== start; k = came[k]) cells.unshift(centerOf(g, k % g.nx, Math.floor(k / g.nx)))
  cells[cells.length - 1] = { x: t0.x, z: t0.z }
  // shorten straight stretches (line of sight)
  const out: { x: number; z: number }[] = []
  let from0 = s0
  let k = 0
  while (k < cells.length) {
    let far = k
    for (let m = cells.length - 1; m > k; m--)
      if (lineFree(g, from0, cells[m], outdoor)) {
        far = m
        break
      }
    out.push(cells[far])
    from0 = cells[far]
    k = far + 1
  }
  return out
}

/** Random walkable point in the rooms (weighted by area); indoor only while outdoor is false. */
export function randomSpot(g: PetGrid, rnd: () => number, outdoor = false, room?: number) {
  for (let tries = 0; tries < 40; tries++) {
    const i = Math.floor(rnd() * g.nx)
    const j = Math.floor(rnd() * g.nz)
    const k = j * g.nx + i
    if (!allowed(g, k, outdoor)) continue
    if (room != null && g.room[k] !== room) continue
    return centerOf(g, i, j)
  }
  return null
}

/* ---------- favorite places ---------- */

export type PlaceKind = 'bed' | 'nap' | 'perch' | 'food' | 'water' | 'litter' | 'scratch' | 'toy' | 'sun' | 'sill' | 'house'

export interface PetPlace {
  kind: PlaceKind
  x: number
  z: number
  /** Height of the surface (sofa cushion, cat tree platform, window sill) */
  y: number
  /** Direction it faces there (like an item's rot: local +z forward) */
  rot: number
  pose: PetPose
  itemId: string
  /** This place is outside the house (garden, terrace) */
  outdoor: boolean
}

const local = (it: Item, lx: number, lz: number) => ({ x: it.x + lx * Math.cos(it.rot) + lz * Math.sin(it.rot), z: it.z - lx * Math.sin(it.rot) + lz * Math.cos(it.rot) })
/** Distance the head reaches into a bowl (where to stand in front of it) */
const REACH: Record<Species, number> = { cat: 0.2, dog: 0.34 }

/**
 * The pet's favorite places: beds and the dog house (sleep), sofa, armchair and bed (naps; for cats the sofa's back and
 * armrest, the cat tree's platforms, the window sill: high places), food and water bowls (in front, facing the bowl),
 * litter box, scratching post, toy, the sunny floor in front of a window. Furniture sizes match kit/furniture.tsx.
 */
export function petPlaces(level: Level, species: Species): PetPlace[] {
  const out: PetPlace[] = []
  const cat = species === 'cat'
  const outdoorAt = (x: number, z: number) => {
    const r = level.rooms.find((q) => rectsOf(q).some((p) => x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d))
    return r ? isOutdoor(r) : true
  }
  const add = (it: Item, kind: PlaceKind, lx: number, lz: number, y: number, rot: number, pose: PetPose) => {
    const p = local(it, lx, lz)
    out.push({ kind, ...p, y: y + (it.y ?? 0), rot, pose, itemId: it.id, outdoor: outdoorAt(p.x, p.z) })
  }
  for (const it of level.items) {
    const [w, d] = sizeOf(it.kind, it.len, it.len2)
    switch (it.kind) {
      case 'catBed':
        // too small for a dog
        if (cat) add(it, 'bed', 0, 0, 0.07, it.rot, 'curl')
        break
      case 'dogBed':
        add(it, 'bed', 0, 0.02, 0.08, it.rot + Math.PI / 2, cat ? 'curl' : 'lie')
        break
      case 'dogHouse':
        if (!cat) add(it, 'house', 0, 0.05, 0.05, it.rot, 'lie')
        break
      case 'sofa': {
        const seats = w >= 2 ? [-0.6, 0, 0.6] : [-0.3, 0.3]
        for (const x of seats) add(it, 'nap', x, 0.12, 0.49, it.rot + (cat ? 0 : Math.PI / 2), cat ? 'curl' : 'lie')
        if (cat) {
          add(it, 'perch', w * 0.25, -0.33, 0.93, it.rot + Math.PI / 2, 'lie')
          add(it, 'perch', -w / 2 + 0.11, 0.05, 0.64, it.rot, 'sit')
        }
        break
      }
      case 'armchair':
        if (cat) add(it, 'nap', 0, 0.1, 0.44, it.rot, 'curl')
        break
      case 'bed':
        add(it, 'nap', cat ? 0.35 : 0, 0.62, 0.54, it.rot + Math.PI / 2, cat ? 'curl' : 'lie')
        break
      case 'catTree':
        if (cat) {
          add(it, 'perch', 0, 0, 1.22, it.rot, 'lie')
          add(it, 'perch', 0.08, 0.1, 0.72, it.rot, 'sit')
          add(it, 'scratch', 0, d / 2 + 0.16, 0, it.rot + Math.PI, 'stand')
        }
        break
      case 'petBowl': {
        const v = it.variant ?? 'double'
        if (v !== 'water') add(it, 'food', v === 'double' ? -0.1 : 0, d / 2 + REACH[species], 0, it.rot + Math.PI, 'stand')
        if (v !== 'food') add(it, 'water', v === 'double' ? 0.1 : 0, d / 2 + REACH[species], 0, it.rot + Math.PI, 'stand')
        break
      }
      case 'petFeeder':
        add(it, 'food', 0, d / 2 + REACH[species], 0, it.rot + Math.PI, 'stand')
        break
      case 'litterBox':
        if (cat) add(it, 'litter', 0, 0, 0.06, it.rot, 'sit')
        break
      case 'petToy':
        add(it, 'toy', 0, 0, 0, it.rot, 'stand')
        break
      case 'window': {
        // window facing outside: the sill (cat) and the sunny floor in front of it
        const bx = it.x - Math.sin(it.rot) * 0.6
        const bz = it.z - Math.cos(it.rot) * 0.6
        if (!outdoorAt(bx, bz)) break
        const sill = 0.9 + (it.y ?? 0)
        if (cat && sill > 0.3 && sill < 1.4) add(it, 'sill', 0, -0.05, sill - 0.01 - (it.y ?? 0), it.rot + Math.PI, 'sit')
        add(it, 'sun', 0, 0.8, 0, it.rot + Math.PI / 2, 'curl')
        break
      }
    }
  }
  return out
}

/* ---------- next activity ---------- */

export interface PetGoal {
  action: PetAction
  x: number
  z: number
  /** Height of the surface to reach (0 on the floor) */
  y: number
  /** Direction to face on arrival; null: as it is */
  rot: number | null
  pose: PetPose
  /** How long it stays there (s) */
  stay: number
  pace: 'walk' | 'trot' | 'run'
  place?: PetPlace
  /** Follows a person (index) or the player in walk mode */
  follow?: 'person' | 'player'
  who?: number
}

export interface Person {
  x: number
  z: number
  sitting: boolean
  walking: boolean
}

export interface ChooseInput {
  species: Species
  places: PetPlace[]
  home: { x: number; z: number; rot: number }
  pos: { x: number; z: number }
  needs: PetNeeds
  mode: PetMode
  /** Whether it is daytime (sunny spot) */
  day: boolean
  people: Person[]
  /** The player's position in first-person walk mode */
  player?: { x: number; z: number } | null
  /** Targets of the other pets: two pets do not go to the same place */
  taken: { x: number; z: number }[]
  /** The smart feeder just dispensed food */
  feeding: boolean
  last: PetAction | null
  /** Random walkable place (for wandering) */
  wander: () => { x: number; z: number } | null
  /** Whether window sills can be used now (walls not cut away) */
  sillOk?: (p: PetPlace) => boolean
  /** Whether it may go outside (garden) */
  outdoor?: boolean
  rnd: () => number
}

const range = (rnd: () => number, a: number, b: number) => a + rnd() * (b - a)

/**
 * The pet's next activity (a weighted choice, like a game NPC): food when hungry, sleep in its bed or on the sofa when
 * tired, play when bored (the dog runs to its toy or zooms around, the cat lies in wait or scratches), when it wants
 * affection the dog follows someone and the cat curls up next to someone sitting; cats love high and warm places (cat
 * tree, sofa back, sill, sunny spot) and sometimes run from someone walking. At night and while the house is empty they
 * mostly sleep and stay inside. In walk mode the dog runs to the player; the cat either rubs against them or moves away.
 */
export function chooseGoal(c: ChooseInput): PetGoal {
  const cat = c.species === 'cat'
  const rnd = c.rnd
  const n = c.needs
  const free = (p: { x: number; z: number }) => !c.taken.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 0.45)
  const usable = c.places.filter((p) => free(p) && (!p.outdoor || (c.outdoor && c.mode === 'home')) && (p.kind !== 'sill' || (c.sillOk?.(p) ?? true)) && (p.kind !== 'sun' || c.day))
  const of = (...kinds: PlaceKind[]) => usable.filter((p) => kinds.includes(p.kind))
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]
  const nearest = (list: PetPlace[]) => list.slice().sort((a, b) => Math.hypot(a.x - c.pos.x, a.z - c.pos.z) - Math.hypot(b.x - c.pos.x, b.z - c.pos.z))[0]
  const at = (p: PetPlace, action: PetAction, stay: number, pace: PetGoal['pace'] = 'walk', pose: PetPose = p.pose): PetGoal => {
    // not onto the toy but 40 cm in front of it (from the side it comes from)
    if (p.kind === 'toy') {
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z) || 1
      return { action, x: p.x + ((c.pos.x - p.x) / d) * 0.4, z: p.z + ((c.pos.z - p.z) / d) * 0.4, y: 0, rot: null, pose, stay, pace, place: p }
    }
    return { action, x: p.x, z: p.z, y: p.y, rot: p.rot, pose, stay, pace, place: p }
  }
  const spot = (x: number, z: number, action: PetAction, stay: number, pose: PetPose, pace: PetGoal['pace'] = 'walk', rot: number | null = null): PetGoal => ({ action, x, z, y: 0, rot, pose, stay, pace })
  const homeGoal = (action: PetAction, pose: PetPose, stay: number) => spot(c.home.x, c.home.z, action, stay, pose, 'walk', c.home.rot)

  const options: { w: number; make: () => PetGoal | null }[] = []
  const opt = (w: number, make: () => PetGoal | null) => {
    if (w > 0) options.push({ w, make })
  }
  const sleepGoal = (long: boolean) => {
    const stay = long ? range(rnd, 70, 160) : range(rnd, 25, 60)
    const beds = of('bed', 'house')
    const naps = of('nap')
    const sun = of('sun')
    const p = beds.length && rnd() < 0.7 ? nearest(beds) : naps.length && rnd() < (cat ? 0.75 : 0.45) ? pick(naps) : sun.length && rnd() < 0.6 ? pick(sun) : beds.length ? nearest(beds) : null
    if (p) return at(p, 'sleep', stay, 'walk', cat ? 'curl' : p.pose === 'curl' ? 'curl' : 'lie')
    return homeGoal('sleep', cat ? 'curl' : 'lie', stay)
  }
  const food = of('food')
  const water = of('water')
  const near = (list: { x: number; z: number }[], d: number) => list.map((p, i) => ({ p, i, d: Math.hypot(p.x - c.pos.x, p.z - c.pos.z) })).filter((q) => q.d < d).sort((a, b) => a.d - b.d)[0]

  // walk mode: the dog greets the player; the cat either rubs or runs away
  if (c.player && c.mode !== 'night') {
    const d = Math.hypot(c.player.x - c.pos.x, c.player.z - c.pos.z)
    if (!cat && d < 5 && c.last !== 'greet') opt(8, () => ({ ...spot(c.player!.x, c.player!.z, 'greet', range(rnd, 6, 10), 'sit', 'run'), follow: 'player' }))
    if (cat && d < 1.6 && c.last !== 'rub' && c.last !== 'avoid') {
      opt(2, () => ({ ...spot(c.player!.x, c.player!.z, 'rub', range(rnd, 4, 7), 'stand', 'walk'), follow: 'player' }))
      opt(1.2, () => {
        const w = c.wander()
        return w ? spot(w.x, w.z, 'avoid', range(rnd, 3, 6), 'sit', 'trot') : null
      })
    }
  }

  if (c.mode === 'night') {
    opt(12, () => sleepGoal(true))
    // the cat's night zoomies (rarely)
    if (cat) opt(0.25, () => zoom())
    if (water.length) opt(0.4, () => at(pick(water), 'drink', range(rnd, 4, 6)))
    if (cat) opt(0.25, () => litter())
  } else {
    const away = c.mode === 'away'
    // food: running if the smart feeder just dispensed
    if (food.length) opt(c.feeding ? 14 : n.food < 0.35 ? 7 : n.food < 0.6 ? 0.6 : 0, () => at(nearest(food), 'eat', range(rnd, 7, 11), c.feeding ? 'run' : 'trot'))
    if (water.length) opt(0.5, () => at(pick(water), 'drink', range(rnd, 4, 6)))
    opt(n.energy < 0.3 ? 6 : n.energy < 0.55 ? (cat ? 1.6 : 0.8) : cat ? 0.35 : 0.15, () => sleepGoal(false))
    if (away) opt(3, () => sleepGoal(true))
    if (c.last === 'sleep') opt(4, () => spot(c.pos.x, c.pos.z, 'stretch', 2.4, 'stand'))
    // play
    const toys = of('toy')
    const bored = n.fun < 0.5 ? 2.2 : 0.6
    if (cat) {
      opt(bored * 0.8, () => {
        const w = c.wander()
        return w ? spot(w.x, w.z, 'pounce', range(rnd, 4, 6), 'stand', 'walk') : null
      })
      if (of('scratch').length) opt(bored * 0.6, () => at(pick(of('scratch')), 'scratch', range(rnd, 4, 6)))
      if (toys.length) opt(bored * 0.5, () => at(pick(toys), 'play', range(rnd, 5, 8), 'trot'))
      opt(bored * 0.2, () => zoom())
    } else {
      if (toys.length) opt(bored * 1.4, () => at(pick(toys), 'play', range(rnd, 6, 10), 'run'))
      opt(bored * (away ? 0.2 : 0.7), () => zoom())
    }
    // affection: the dog follows someone, the cat sits next to someone seated
    if (!away && c.people.length) {
      const lonely = n.love < 0.5 ? 2.5 : 0.7
      if (!cat) {
        opt(lonely * 1.6, () => {
          const who = Math.floor(rnd() * c.people.length)
          const p = c.people[who]
          return { ...spot(p.x, p.z, 'follow', range(rnd, 18, 35), 'sit', 'trot'), follow: 'person', who }
        })
      } else {
        const sitting = c.people.map((p, i) => ({ p, i })).filter((q) => q.p.sitting)
        if (sitting.length)
          opt(lonely, () => {
            const q = pick(sitting)
            const seat = of('nap').filter((p) => Math.hypot(p.x - q.p.x, p.z - q.p.z) < 1.1 && Math.hypot(p.x - q.p.x, p.z - q.p.z) > 0.3)[0]
            if (seat) return at(seat, 'rest', range(rnd, 25, 50), 'walk', 'curl')
            return spot(q.p.x + (rnd() - 0.5) * 1.2, q.p.z + 0.6, 'sit', range(rnd, 10, 20), 'sit')
          })
        // sometimes runs off when someone walks past closely
        const walker = near(
          c.people.filter((p) => p.walking),
          1.3,
        )
        if (walker) opt(1.5, () => {
          const w = c.wander()
          return w ? spot(w.x, w.z, 'avoid', range(rnd, 3, 6), 'sit', 'trot') : null
        })
      }
    }
    // cat: high and warm places, watching from the window, grooming
    if (cat) {
      const perch = of('perch')
      if (perch.length) opt(1.3, () => at(pick(perch), 'perch', range(rnd, 12, 28), 'walk'))
      const sill = of('sill')
      if (sill.length) opt(1.1, () => at(pick(sill), 'watch', range(rnd, 10, 22), 'walk'))
      const sun = of('sun')
      if (sun.length) opt(0.9, () => at(pick(sun), 'rest', range(rnd, 20, 45), 'walk', 'curl'))
      opt(1.2, () => spot(c.pos.x, c.pos.z, 'groom', range(rnd, 6, 12), 'sit'))
      opt(0.25, () => litter())
    } else {
      opt(0.8, () => spot(c.pos.x, c.pos.z, 'sit', range(rnd, 4, 9), 'sit'))
      const house = of('house', 'bed')
      if (house.length) opt(0.5, () => at(pick(house), 'rest', range(rnd, 15, 30)))
    }
    // wandering and sniffing (mostly in another room), going home to sit
    opt(cat ? 2.2 : 2.8, () => {
      const w = c.wander()
      return w ? spot(w.x, w.z, rnd() < 0.5 ? 'sniff' : 'wander', range(rnd, 2, 5), rnd() < 0.4 ? 'sit' : 'stand', !cat && rnd() < 0.4 ? 'trot' : 'walk') : null
    })
    opt(0.3, () => homeGoal('sit', 'sit', range(rnd, 5, 12)))
  }

  function zoom(): PetGoal | null {
    const w = c.wander()
    return w ? spot(w.x, w.z, 'zoomies', 0.6, 'stand', 'run') : null
  }
  function litter(): PetGoal | null {
    const l = of('litter')
    return l.length ? at(pick(l), 'litter', range(rnd, 5, 7)) : null
  }

  // weighted choice (options returning nothing are skipped)
  for (let tries = 0; tries < 6 && options.length; tries++) {
    const total = options.reduce((a, o) => a + o.w, 0)
    let r = rnd() * total
    let k = 0
    for (; k < options.length - 1; k++) {
      r -= options[k].w
      if (r <= 0) break
    }
    const g = options[k].make()
    if (g) return g
    options.splice(k, 1)
  }
  return homeGoal('sit', 'sit', range(rnd, 4, 8))
}

/* ---------- reaction to a click ---------- */

export type Reaction = 'meow' | 'purr' | 'roll' | 'hiss' | 'yawn' | 'bark' | 'spin' | 'jump' | 'sitPretty'

export interface ReactionPlan {
  kind: Reaction
  /** Duration (s) */
  dur: number
  /** Speech bubble (translated text) */
  bubble: string
  /** Hearts */
  hearts: boolean
}

/**
 * Reaction to a click (a tap, E in walk mode): the cat meows, purrs (hearts) or rolls on its back; asleep it wakes up with a
 * yawn; petted too much in a short time it gets fed up, hisses and walks away. The dog barks, wags its tail fast, spins,
 * jumps or sits pretty; asleep it wakes up with a "Woof?".
 */
export function chooseReaction(species: Species, s: { sleeping: boolean; recent: number }, rnd: () => number): ReactionPlan {
  if (species === 'cat') {
    if (s.recent >= 4) return { kind: 'hiss', dur: 1.4, bubble: t('Hiss!'), hearts: false }
    if (s.sleeping) return { kind: 'yawn', dur: 2.2, bubble: t('Mrrr...'), hearts: false }
    const r = rnd()
    if (r < 0.4) return { kind: 'meow', dur: 1.6, bubble: t('Meow!'), hearts: false }
    if (r < 0.72) return { kind: 'purr', dur: 3, bubble: t('Purr purr'), hearts: true }
    return { kind: 'roll', dur: 3.4, bubble: t('Meow'), hearts: true }
  }
  if (s.sleeping) return { kind: 'bark', dur: 1.6, bubble: t('Woof?'), hearts: false }
  const r = rnd()
  if (r < 0.35) return { kind: 'bark', dur: 1.5, bubble: rnd() < 0.5 ? t('Woof!') : t('Woof woof!'), hearts: false }
  if (r < 0.6) return { kind: 'spin', dur: 1.4, bubble: t('Woof!'), hearts: false }
  if (r < 0.8) return { kind: 'jump', dur: 1.3, bubble: t('Woof woof!'), hearts: true }
  return { kind: 'sitPretty', dur: 2.6, bubble: t('Woof!'), hearts: true }
}

/* ---------- smart pet feeder ---------- */

/** If the feeder ran (dispensed food) within this time, the pets run to it. */
export const FEED_FRESH_MS = 90_000

/** Whether a smart feeder in the plan (or an entity bound to it) just dispensed food. */
export function feedingNow(level: Level, entities: Entities, now: number) {
  for (const it of level.items) {
    if (it.kind !== 'petFeeder' && it.kind !== 'petBowl') continue
    const ids = [it.entityId, ...(it.extras ?? [])].filter((x): x is string => Boolean(x))
    for (const id of ids) {
      const e = entities[id]
      if (!e) continue
      const at = Date.parse(e.last_changed ?? '') || 0
      const fed = id.startsWith('button.') || id.startsWith('input_button.') ? true : e.state === 'on' || id.startsWith('sensor.')
      if (fed && now - at < FEED_FRESH_MS && now >= at) return true
    }
  }
  return false
}

/* ---------- outdoor visitors ---------- */

export type VisitorKind = 'birds' | 'cat' | 'dog' | 'butterflies' | 'squirrel'
/** Plain name of the visitor (debug values for tests, not shown in the UI) */
export const VISITOR_LABEL: Record<VisitorKind, string> = { birds: 'birds', cat: "neighbor's cat", dog: 'stray dog', butterflies: 'butterflies', squirrel: 'squirrel' }

export type VisitorAct = 'walk' | 'trot' | 'run' | 'fly' | 'hop' | 'peck' | 'sit' | 'climb' | 'flutter' | 'sniff' | 'groom' | 'jump'

export interface VisitorStep {
  x: number
  y: number
  z: number
  /** Travel time from the previous point to here (s); for an activity on the spot, the same point and a wait */
  dur: number
  act: VisitorAct
}

export interface VisitorPlan {
  kind: VisitorKind
  steps: VisitorStep[]
  total: number
  /** Number of animals in the flock (birds, butterflies) */
  count: number
  seed: number
}

interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Area taken by the house: indoor rooms and balconies / terraces with railings (not the garden; visitors may roam it). */
export function houseBox(level: Level): Box | null {
  const rooms = level.rooms.filter(solid)
  if (!rooms.length) return null
  return bounds(rooms)
}

/** Whether the point is inside the house (indoor room or balcony / terrace) */
export function insideHouse(level: Level, x: number, z: number) {
  return level.rooms.some((r) => solid(r) && rectsOf(r).some((p) => x >= p.x && x <= p.x + p.w && z >= p.z && z <= p.z + p.d))
}

/** Choice of visitor: at night only the neighbor's cat; by day birds, cat, dog, butterflies (with a flower bed), squirrel (with a tree). */
export function pickVisitor(level: Level, night: boolean, rnd: () => number): VisitorKind {
  if (night) return 'cat'
  const box = houseBox(level)
  const outside = (it: Item) => !insideHouse(level, it.x, it.z) && (!box || it.x < box.minX - 0.3 || it.x > box.maxX + 0.3 || it.z < box.minZ - 0.3 || it.z > box.maxZ + 0.3)
  const opts: [VisitorKind, number][] = [
    ['birds', 3],
    ['cat', 2],
    ['dog', 1.6],
  ]
  if (level.items.some((i) => i.kind === 'flowerBed' && outside(i))) opts.push(['butterflies', 2.2])
  if (level.items.some((i) => i.kind === 'tree' && outside(i))) opts.push(['squirrel', 1.8])
  const total = opts.reduce((a, o) => a + o[1], 0)
  let r = rnd() * total
  for (const [k, w] of opts) {
    r -= w
    if (r <= 0) return k
  }
  return 'birds'
}

export interface VisitorView {
  /** Direction from the center of the house to the camera */
  view: { x: number; z: number }
  /** Whether a point is visible on screen (visible ones first when choosing a place) */
  seen?: (x: number, z: number) => boolean
  /** Test: the side to pass on */
  side?: 'front' | 'back' | 'left' | 'right'
}

/**
 * The visitor's path (it stays outside the house and passes on the side facing the camera and visible on screen):
 * - stray dog: trots in from afar, stops to sniff while passing the front of the house, goes on to the other side;
 * - neighbor's cat: with a fence it jumps onto it and walks along, sits in the middle and grooms; otherwise it walks along
 *   the house's outer wall and stops to look at the camera;
 * - birds: fly in and land in the garden (else in front of the house), peck, hop and peck again, fly off;
 * - butterflies: flutter around the flower bed, land on a flower, move away;
 * - squirrel: runs to a tree in stops and starts, climbs the trunk, sits on a branch and vanishes in the leaves.
 * view: direction from the center of the house to the camera (need not be a unit vector).
 */
export function planVisitor(kind: VisitorKind, level: Level, opts: VisitorView, rnd: () => number): VisitorPlan | null {
  const box = houseBox(level)
  if (!box) return null
  const cx = (box.minX + box.maxX) / 2
  const cz = (box.minZ + box.maxZ) / 2
  const seen = opts.seen ?? (() => true)
  // the side to pass on: visible on screen and facing the camera (the outer walls there are low, the far side shows)
  const sides = (['front', 'back', 'left', 'right'] as const).map((side) => {
    const front = side === 'front' || side === 'back'
    const sgn = side === 'front' || side === 'right' ? 1 : -1
    const edge = front ? (sgn > 0 ? box.maxZ : box.minZ) : sgn > 0 ? box.maxX : box.minX
    const mid = front ? { x: cx, z: edge + sgn * 1.2 } : { x: edge + sgn * 1.2, z: cz }
    const facing = (front ? opts.view.z * sgn : opts.view.x * sgn) > 0
    return { front, sgn, edge, score: (seen(mid.x, mid.z) ? 0 : 4) + (facing ? 0 : 2) + (side === opts.side ? -10 : 0) }
  })
  const pickSide = sides.sort((a, b) => a.score - b.score)[0]
  const { front, sgn, edge } = pickSide
  const [lo, hi] = front ? [box.minX, box.maxX] : [box.minZ, box.maxZ]
  /** a along the edge, m meters out from it: world point */
  const P = (a: number, m: number, y = 0) => (front ? { x: a, y, z: edge + sgn * m } : { x: edge + sgn * m, y, z: a })
  const steps: VisitorStep[] = []
  const go = (p: { x: number; y: number; z: number }, speed: number, act: VisitorAct) => {
    const prev = steps[steps.length - 1]
    const d = prev ? Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) : 0
    steps.push({ ...p, dur: prev ? Math.max(0.2, d / speed) : 0, act })
  }
  const wait = (dur: number, act: VisitorAct) => {
    const prev = steps[steps.length - 1]
    steps.push({ x: prev.x, y: prev.y, z: prev.z, dur, act })
  }
  const dir = rnd() < 0.5 ? 1 : -1
  const a0 = dir > 0 ? lo - 9 : hi + 9
  const a1 = dir > 0 ? hi + 9 : lo - 9
  const seed = Math.floor(rnd() * 1e6)
  const outsideItem = (it: Item) => !insideHouse(level, it.x, it.z) && (it.x < box.minX - 0.3 || it.x > box.maxX + 0.3 || it.z < box.minZ - 0.3 || it.z > box.maxZ + 0.3)

  if (kind === 'dog') {
    const m = range(rnd, 0.9, 1.7)
    const mid = range(rnd, lo + 0.5, hi - 0.5)
    go(P(a0, m), 1, 'trot')
    go(P(mid, m), 1.3, 'trot')
    wait(range(rnd, 2, 3.2), 'sniff')
    go(P(mid + dir * 1.2, m + 0.4), 1.2, 'walk')
    wait(1.4, 'sit')
    go(P(a1, m), 1.35, 'trot')
  } else if (kind === 'cat') {
    const fence = level.items.find((i) => i.kind === 'fence' && outsideItem(i) && (i.len ?? 2) >= 1.5)
    if (fence) {
      const L = fence.len ?? 2
      const ax = Math.cos(fence.rot)
      const az = -Math.sin(fence.rot)
      const e0 = { x: fence.x - (ax * L) / 2, z: fence.z - (az * L) / 2 }
      const e1 = { x: fence.x + (ax * L) / 2, z: fence.z + (az * L) / 2 }
      const [s, t] = dir > 0 ? [e0, e1] : [e1, e0]
      const out = { x: s.x - (t.x - s.x) / L * 0.8 + Math.sin(fence.rot) * 0.6, z: s.z - (t.z - s.z) / L * 0.8 + Math.cos(fence.rot) * 0.6 }
      const ol = Math.hypot(out.x - cx, out.z - cz) || 1
      const far = { x: out.x + ((out.x - cx) / ol) * 7, z: out.z + ((out.z - cz) / ol) * 7 }
      go({ x: far.x, y: 0, z: far.z }, 0.8, 'walk')
      go({ x: out.x, y: 0, z: out.z }, 0.8, 'walk')
      go({ x: s.x, y: 1.06, z: s.z }, 1.6, 'jump')
      go({ x: (s.x + t.x) / 2, y: 1.06, z: (s.z + t.z) / 2 }, 0.45, 'walk')
      wait(range(rnd, 3, 5), 'groom')
      go({ x: t.x, y: 1.06, z: t.z }, 0.45, 'walk')
      const land = { x: t.x + (t.x - s.x) / L * 0.7, z: t.z + (t.z - s.z) / L * 0.7 }
      go({ x: land.x, y: 0, z: land.z }, 1.6, 'jump')
      const ll = Math.hypot(land.x - cx, land.z - cz) || 1
      go({ x: land.x + ((land.x - cx) / ll) * 7, y: 0, z: land.z + ((land.z - cz) / ll) * 7 }, 0.8, 'walk')
    } else {
      // 42 cm outside the house's outer wall (half wall thickness 5 cm)
      const m = 0.42
      const mid = range(rnd, lo + 0.6, hi - 0.6)
      const [c0, c1] = dir > 0 ? [lo - 0.6, hi + 0.6] : [hi + 0.6, lo - 0.6]
      go(P(a0, 2.4), 0.75, 'walk')
      go(P(c0, m), 0.75, 'walk')
      go(P(mid, m), 0.65, 'walk')
      wait(range(rnd, 3, 4.5), 'sit')
      wait(range(rnd, 2, 3), 'groom')
      go(P(c1, m), 0.65, 'walk')
      go(P(a1, 2.4), 0.8, 'walk')
    }
  } else if (kind === 'birds') {
    const gardens = level.rooms.filter((r) => r.type === 'garden')
    let land: { x: number; z: number } | null = null
    for (const gd of gardens)
      for (let k = 0; k < 16 && !land; k++) {
        const r0 = rectsOf(gd)[0]
        const p = { x: r0.x + 0.5 + rnd() * Math.max(0.1, r0.w - 1), z: r0.z + 0.5 + rnd() * Math.max(0.1, r0.d - 1) }
        if ((p.x < box.minX - 0.8 || p.x > box.maxX + 0.8 || p.z < box.minZ - 0.8 || p.z > box.maxZ + 0.8) && seen(p.x, p.z)) land = p
      }
    if (!land) {
      const q = P(range(rnd, lo + 1, hi - 1), range(rnd, 1, 2.2))
      land = { x: q.x, z: q.z }
    }
    const ox = land.x - cx
    const oz = land.z - cz
    const ol = Math.hypot(ox, oz) || 1
    const sx = land.x + (ox / ol) * 12 + (rnd() - 0.5) * 6
    const sz = land.z + (oz / ol) * 12 + (rnd() - 0.5) * 6
    go({ x: sx, y: 6, z: sz }, 4, 'fly')
    go({ x: land.x, y: 0, z: land.z }, 4.2, 'fly')
    wait(range(rnd, 2.5, 4), 'peck')
    const hop = { x: land.x + (rnd() - 0.5) * 0.8, y: 0, z: land.z + (rnd() - 0.5) * 0.8 }
    go(hop, 1.2, 'hop')
    wait(range(rnd, 2.5, 4), 'peck')
    go({ x: hop.x + (ox / ol) * 12 + (rnd() - 0.5) * 6, y: 7, z: hop.z + (oz / ol) * 12 + (rnd() - 0.5) * 6 }, 4.5, 'fly')
    return finish(kind, steps, 2 + Math.floor(rnd() * 2), seed)
  } else if (kind === 'butterflies') {
    const all = level.items.filter((i) => i.kind === 'flowerBed' && outsideItem(i))
    const beds = all.filter((i) => seen(i.x, i.z)).length ? all.filter((i) => seen(i.x, i.z)) : all
    const fb = beds.length ? beds[Math.floor(rnd() * beds.length)] : null
    const c0 = fb ? { x: fb.x, z: fb.z } : (() => {
      const q = P(range(rnd, lo + 1, hi - 1), 1.5)
      return { x: q.x, z: q.z }
    })()
    const ox = c0.x - cx
    const oz = c0.z - cz
    const ol = Math.hypot(ox, oz) || 1
    go({ x: c0.x + (ox / ol) * 7, y: 1.8, z: c0.z + (oz / ol) * 7 }, 1, 'flutter')
    go({ x: c0.x, y: 0.6, z: c0.z }, 0.9, 'flutter')
    wait(range(rnd, 6, 9), 'flutter')
    wait(range(rnd, 2.5, 3.5), 'sit')
    wait(range(rnd, 2, 3), 'flutter')
    go({ x: c0.x + (ox / ol) * 8 + (rnd() - 0.5) * 3, y: 2.2, z: c0.z + (oz / ol) * 8 + (rnd() - 0.5) * 3 }, 1, 'flutter')
    return finish(kind, steps, 2, seed)
  } else {
    const all = level.items.filter((i) => i.kind === 'tree' && outsideItem(i))
    const trees = all.filter((i) => seen(i.x, i.z)).length ? all.filter((i) => seen(i.x, i.z)) : all
    if (!trees.length) return planVisitor('dog', level, opts, rnd)
    const t = trees[Math.floor(rnd() * trees.length)]
    const ox = t.x - cx
    const oz = t.z - cz
    const ol = Math.hypot(ox, oz) || 1
    const ux = ox / ol
    const uz = oz / ol
    const trunk = t.variant === 'pine' ? 0.17 : 0.22
    const base = { x: t.x + ux * trunk, z: t.z + uz * trunk }
    go({ x: t.x + ux * 9, y: 0, z: t.z + uz * 9 }, 3, 'run')
    go({ x: t.x + ux * 5.5 + uz * 0.8, y: 0, z: t.z + uz * 5.5 - ux * 0.8 }, 3, 'run')
    wait(range(rnd, 0.8, 1.4), 'sit')
    go({ x: t.x + ux * 2.4 - uz * 0.5, y: 0, z: t.z + uz * 2.4 + ux * 0.5 }, 3, 'run')
    wait(range(rnd, 0.6, 1.1), 'sit')
    go({ x: base.x, y: 0, z: base.z }, 3, 'run')
    go({ x: base.x, y: t.variant === 'pine' ? 1.2 : 1.7, z: base.z }, 1.1, 'climb')
    wait(range(rnd, 1.5, 2.5), 'sit')
    go({ x: t.x + ux * 0.1, y: t.variant === 'pine' ? 1.6 : 2.3, z: t.z + uz * 0.1 }, 0.8, 'climb')
  }
  return finish(kind, steps, 1, seed)
}

function finish(kind: VisitorKind, steps: VisitorStep[], count: number, seed: number): VisitorPlan {
  return { kind, steps, total: steps.reduce((a, s) => a + s.dur, 0), count, seed }
}

/** The visitor's position, activity and heading at time t (linear along the path). null when finished. */
export function visitorAt(plan: VisitorPlan, t: number) {
  if (t >= plan.total || plan.steps.length < 2) return null
  let acc = 0
  for (let k = 1; k < plan.steps.length; k++) {
    const s = plan.steps[k]
    if (t <= acc + s.dur) {
      const p = plan.steps[k - 1]
      const f = s.dur > 0 ? (t - acc) / s.dur : 1
      const dx = s.x - p.x
      const dz = s.z - p.z
      // heading: along the motion while moving, toward the next move while waiting
      let hx = dx
      let hz = dz
      for (let m = k; Math.hypot(hx, hz) < 1e-3 && m < plan.steps.length - 1; m++) {
        hx = plan.steps[m + 1].x - plan.steps[m].x
        hz = plan.steps[m + 1].z - plan.steps[m].z
      }
      return { x: p.x + dx * f, y: p.y + (s.y - p.y) * f, z: p.z + dz * f, act: s.act, f, step: k, heading: Math.atan2(hx, hz), moving: Math.hypot(dx, dz, s.y - p.y) > 1e-3 }
    }
    acc += s.dur
  }
  return null
}
