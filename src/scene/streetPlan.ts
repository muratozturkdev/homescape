import { isOutdoor, rectsOf, roomAt } from '@/model/geometry'
import { personGrid } from '@/model/people'
import { findPath, isFree } from '@/model/pets'
import { footprints, type Box2 } from '@/model/rules'
import type { Item, ItemKind, Level, Rect } from '@/model/types'
import { netPaths, type NetPiece } from './kit/roads'

/*
 * Street life: cars pass on the roads now and then, people walk on the sidewalks, some walk a dog on a leash, kids play in
 * the playgrounds; the night changes the ambient sounds. This file draws nothing: car and pedestrian routes from the
 * plan's road and sidewalk network, spots in the playground, frequency by hour and weather. Motion and drawing in
 * scene/StreetLife.tsx, sounds in audio/SoundScape.tsx (reads streetDebug).
 * - Route: the center polylines of the network (kit/roads.ts > netPaths; crosswalks are part of the network). Where a
 *   branch joins the middle of another branch (T), the route continues from there in a random direction. Corners are
 *   rounded (car 4.5 m, pedestrian 1.2 m radius).
 * - Cars drive on the right: the lane is a quarter of the road width right of center (in the middle on roads narrower
 *   than 4 m). The route is simplified first (collinear points dropped, so short pieces and crosswalks do not count as
 *   corners), turns use a radius up to 5 m, speed drops with the turn radius, and the body turns by where the front and
 *   rear axles are on the route. Cars change lane to pass items on the road (parked car, cone, trash can) instead of
 *   driving through them; if there is no room to pass, that route is not used.
 * - Pedestrians walk slightly right of the sidewalk center; they sidestep items such as trees, benches and lamps using the
 *   people walk grid (model/people.ts > personGrid) without leaving the sidewalk. The dog walks beside its owner.
 */

export interface P {
  x: number
  z: number
}

/** Sampled route: base line, right normal at each point, cumulative length; off is the lateral offset (pedestrian), off2 the dog's offset */
export interface Track {
  base: P[]
  nrm: P[]
  cum: number[]
  len: number
  off: Float32Array
  off2?: Float32Array
  /** Speed limit (m/s; lower in bends) */
  limit?: Float32Array
  /** Stretches that cross a crosswalk */
  cross: { s0: number; s1: number; r: Rect }[]
}

export type PlayKind = 'slide' | 'trampoline' | 'sandbox' | 'swing'
export const PLAY_KINDS: PlayKind[] = ['slide', 'trampoline', 'sandbox', 'swing']
/** How many kids at a time */
export const PLAY_CAP: Record<PlayKind, number> = { slide: 2, trampoline: 2, sandbox: 2, swing: 1 }

export interface StreetNet {
  key: string
  roads: P[][]
  roadPieces: NetPiece[]
  walks: P[][]
  walkRects: Rect[]
  crossings: Rect[]
  play: Item[]
  benches: Item[]
  /** Spots the dog sniffs: tree, hydrant, lamp, pole, planter */
  sniff: P[]
  /** Footprints of the items on the road (passing cars drive around them) */
  roadBlocks: Box2[]
}

/** Flat items cars drive over */
const FLAT: ItemKind[] = ['manhole', 'speedBump', 'rug', 'doormat', 'steppingStones', 'leakSensor', 'sprinkler', 'gardenLight', 'robotVacuum', 'lawnMower', 'cat', 'dog', 'petToy']

const SNIFF: ItemKind[] = ['streetTree', 'tree', 'hydrant', 'streetLamp', 'bollard', 'utilityPole', 'planter', 'streetBin', 'trafficSign', 'bush']

const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.z - a.z)
const inRect = (r: Rect, x: number, z: number, m = 0) => x >= r.x - m && x <= r.x + r.w + m && z >= r.z - m && z <= r.z + r.d + m

/** An item's local point (lx sideways, lz forward) in world space, using the item rotation (forward is (sin, cos)) */
export function local(it: { x: number; z: number; rot: number }, lx: number, lz: number): P {
  const c = Math.cos(it.rot)
  const s = Math.sin(it.rot)
  return { x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c }
}

/** The plan's street network (depends on the rooms and items; stable while they do not change) */
export function streetNet(level: Level): StreetNet {
  const out = level.rooms.filter(isOutdoor)
  const roadPieces: NetPiece[] = out
    .filter((r) => r.floor === 'road' || r.floor === 'crosswalk')
    .flatMap((r) => rectsOf(r).map((q) => ({ r: q, kind: r.floor === 'road' ? ('road' as const) : ('crosswalk' as const) })))
  const crossings = roadPieces.filter((p) => p.kind === 'crosswalk').map((p) => p.r)
  const walkRects = out.filter((r) => r.floor === 'sidewalk').flatMap(rectsOf)
  const walkPieces: NetPiece[] = [...walkRects.map((r) => ({ r, kind: 'road' as const })), ...crossings.map((r) => ({ r, kind: 'road' as const }))]
  const outdoorAt = (x: number, z: number) => {
    const r = roomAt(level.rooms, x, z)
    return Boolean(r && isOutdoor(r))
  }
  const play = level.items.filter((it) => (PLAY_KINDS as string[]).includes(it.kind) && outdoorAt(it.x, it.z))
  const benches = level.items.filter((it) => it.kind === 'bench' && outdoorAt(it.x, it.z))
  const sniff = level.items.filter((it) => SNIFF.includes(it.kind) && outdoorAt(it.x, it.z)).map((it) => ({ x: it.x, z: it.z }))
  const roadRects = roadPieces.map((p) => p.r)
  const roadBlocks = level.items
    .filter((it) => !FLAT.includes(it.kind))
    .flatMap((it) => footprints(it))
    .filter((b) => roadRects.some((r) => b.maxX > r.x && b.minX < r.x + r.w && b.maxZ > r.z && b.minZ < r.z + r.d))
  const key = JSON.stringify([roadPieces.map((p) => p.r), walkRects, play.map((p) => [p.x, p.z, p.rot, p.kind]), benches.map((b) => [b.x, b.z]), roadBlocks])
  return {
    key,
    roads: roadPieces.some((p) => p.kind === 'road') ? netPaths(roadPieces) : [],
    roadPieces,
    walks: walkRects.length ? netPaths(walkPieces) : [],
    walkRects: [...walkRects, ...crossings],
    crossings,
    play,
    benches,
    sniff,
    roadBlocks,
  }
}

/* ---------- polyline helpers ---------- */

function cumOf(pts: P[]) {
  const c = [0]
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]))
  return c
}
export const polyLen = (pts: P[]) => cumOf(pts)[pts.length - 1] ?? 0

/** Closest point to q on the polyline: position along the length and distance */
function project(pl: P[], q: P) {
  let best = { s: 0, d: Infinity }
  let acc = 0
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1]
    const b = pl[i]
    const l = dist(a, b)
    const t = l > 1e-9 ? Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.z - a.z) * (b.z - a.z)) / (l * l))) : 0
    const d = Math.hypot(a.x + (b.x - a.x) * t - q.x, a.z + (b.z - a.z) * t - q.z)
    if (d < best.d) best = { s: acc + l * t, d }
    acc += l
  }
  return best
}

/** Piece of the polyline from s0 to s1 (reversed when s1 < s0) */
function slice(pl: P[], s0: number, s1: number): P[] {
  const rev = s1 < s0
  const pts = rev ? [...pl].reverse() : pl
  const L = polyLen(pl)
  const a = rev ? L - s0 : s0
  const b = rev ? L - s1 : s1
  const cum = cumOf(pts)
  const at = (s: number): P => {
    for (let i = 1; i < pts.length; i++)
      if (cum[i] >= s - 1e-9) {
        const l = cum[i] - cum[i - 1]
        const t = l > 1e-9 ? (s - cum[i - 1]) / l : 0
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t }
      }
    return pts[pts.length - 1]
  }
  const out = [at(a)]
  for (let i = 0; i < pts.length; i++) if (cum[i] > a + 1e-6 && cum[i] < b - 1e-6) out.push(pts[i])
  out.push(at(b))
  return out
}

const dedupe = (pts: P[]) => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-4)

/** Drops collinear intermediate points (so short pieces do not count as corners) */
function simplify(pts: P[]): P[] {
  const p = dedupe(pts)
  if (p.length < 3) return p
  const out = [p[0]]
  for (let i = 1; i < p.length - 1; i++) {
    const a = out[out.length - 1]
    const b = p[i]
    const c = p[i + 1]
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
    const dot = (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)
    if (Math.abs(cross) < 1e-3 * dist(a, b) * dist(b, c) && dot > 0) continue
    out.push(b)
  }
  out.push(p[p.length - 1])
  return out
}

/**
 * A random route on the network: a branch weighted by its length, in a random direction; where its end touches the middle
 * (T) or the end of another branch, it continues from there (without turning back).
 */
export function pickRoute(paths: P[][], rnd: () => number): P[] | null {
  const usable = paths.filter((p) => p.length >= 2 && polyLen(p) > 0.5)
  if (!usable.length) return null
  const lens = usable.map(polyLen)
  let k = rnd() * lens.reduce((a, b) => a + b, 0)
  let i = 0
  while (i < lens.length - 1 && k > lens[i]) k -= lens[i++]
  let pts = rnd() < 0.5 ? [...usable[i]] : [...usable[i]].reverse()
  // Continue from the end: toward one end of the branch it touches (without reversing direction)
  const extend = (end: P, prev: P): P[] | null => {
    const dir = { x: end.x - prev.x, z: end.z - prev.z }
    const opts: P[][] = []
    usable.forEach((pl, j) => {
      if (j === i) return
      const L = lens[j]
      const pr = project(pl, end)
      if (pr.d > 0.25) return
      for (const to of [0, L]) {
        if (Math.abs(to - pr.s) < 1) continue
        const part = slice(pl, pr.s, to)
        const n = part.find((q) => dist(q, end) > 0.3)
        if (!n) continue
        const d2 = { x: n.x - end.x, z: n.z - end.z }
        if (dir.x * d2.x + dir.z * d2.z < -0.3 * Math.hypot(dir.x, dir.z) * Math.hypot(d2.x, d2.z)) continue
        opts.push(part)
      }
    })
    return opts.length ? opts[Math.floor(rnd() * opts.length)] : null
  }
  const tail = extend(pts[pts.length - 1], pts[pts.length - 2])
  if (tail) pts = pts.concat(tail.slice(1))
  const head = extend(pts[0], pts[1])
  if (head) pts = [...head].reverse().concat(pts.slice(1))
  return dedupe(pts)
}

/** Rounds the corners (a quadratic curve starting r before each corner) */
function roundCorners(pts: P[], r: number): P[] {
  if (pts.length < 3) return pts.slice()
  const out: P[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const l1 = dist(a, b)
    const l2 = dist(b, c)
    const cut = Math.min(r, l1 / 2, l2 / 2)
    const u1 = { x: (b.x - a.x) / l1, z: (b.z - a.z) / l1 }
    const u2 = { x: (c.x - b.x) / l2, z: (c.z - b.z) / l2 }
    if (u1.x * u2.x + u1.z * u2.z > 0.999 || cut < 0.05) {
      out.push(b)
      continue
    }
    const p0 = { x: b.x - u1.x * cut, z: b.z - u1.z * cut }
    const p2 = { x: b.x + u2.x * cut, z: b.z + u2.z * cut }
    for (let k = 0; k <= 10; k++) {
      const t = k / 10
      const m = 1 - t
      out.push({ x: m * m * p0.x + 2 * m * t * b.x + t * t * p2.x, z: m * m * p0.z + 2 * m * t * b.z + t * t * p2.z })
    }
  }
  out.push(pts[pts.length - 1])
  return dedupe(out)
}

/** Samples spaced ds apart */
function resample(pts: P[], ds: number): P[] {
  const cum = cumOf(pts)
  const len = cum[cum.length - 1]
  const n = Math.max(1, Math.ceil(len / ds))
  const out: P[] = []
  let j = 0
  for (let i = 0; i <= n; i++) {
    const s = (len * i) / n
    while (j < cum.length - 2 && cum[j + 1] < s) j++
    const l = cum[j + 1] - cum[j]
    const t = l > 1e-9 ? (s - cum[j]) / l : 0
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, z: pts[j].z + (pts[j + 1].z - pts[j].z) * t })
  }
  return out
}

/** Right normal at each sample (from the direction: (-tz, tx); the walker's right) */
function normals(pts: P[]): P[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: -(b.z - a.z) / l, z: (b.x - a.x) / l }
  })
}

/** Width, perpendicular to the direction, of the piece containing the point */
function widthAt(rects: Rect[], p: P, n: P) {
  const r = rects.find((q) => inRect(q, p.x, p.z, 0.01))
  if (!r) return 0
  // if the normal is close to x the width is along x (w), otherwise along z (d)
  return Math.abs(n.x) > Math.abs(n.z) ? r.w : r.d
}

function crossingsOf(base: P[], cum: number[], off: Float32Array, nrm: P[], rects: Rect[]) {
  const out: Track['cross'] = []
  for (const r of rects) {
    let s0 = -1
    let s1 = -1
    base.forEach((b, i) => {
      if (!inRect(r, b.x + nrm[i].x * off[i], b.z + nrm[i].z * off[i])) return
      if (s0 < 0) s0 = cum[i]
      s1 = cum[i]
    })
    if (s0 >= 0) out.push({ s0, s1, r })
  }
  return out.sort((a, b) => a.s0 - b.s0)
}

/* ---------- car ---------- */

/** Speed (m/s): ~27 km/h on a straight road, by radius in bends (lateral acceleration ~2.2 m/s²) */
export const CAR_SPEED = 7.5
const MIN_SPEED = 2.2
const LAT_ACC = 3.2
/** Braking (m/s²): a car slows down for a bend only as early as needed */
const BRAKE = 3
/** Half length and half width of a car (obstacle check; the largest in kit/outdoor.tsx > Car is the SUV, 4.5 × 1.9) */
const CAR_HL = 2.3
const CAR_HW = 0.95
/** Half the wheelbase: the body turns by where the front and rear axles are on the route (StreetLife) */
export const AXLE = 1.35

/** Whether the car footprint (direction dir) hits an obstacle: 5 points along, 3 across, 15 cm margin */
function carHits(blocks: Box2[], x: number, z: number, dx: number, dz: number) {
  if (!blocks.length) return false
  const nx = -dz
  const nz = dx
  for (const a of [-CAR_HL, -CAR_HL / 2, 0, CAR_HL / 2, CAR_HL])
    for (const b of [-CAR_HW, 0, CAR_HW]) {
      const px = x + dx * a + nx * b
      const pz = z + dz * a + nz * b
      if (blocks.some((q) => px > q.minX - 0.15 && px < q.maxX + 0.15 && pz > q.minZ - 0.15 && pz < q.maxZ + 0.15)) return true
    }
  return false
}

/** A car route on the road (right lane, slows in bends, passes items on the road); null when there is no road, it is too short or it is blocked */
export function carTrack(net: StreetNet, rnd: () => number): Track | null {
  const route = pickRoute(net.roads, rnd)
  if (!route || polyLen(route) < 8) return null
  const base = resample(roundCorners(simplify(route), 5), 0.5)
  const nrm = normals(base)
  const rects = net.roadPieces.map((p) => p.r)
  const width = base.map((b, i) => widthAt(rects, b, nrm[i]))
  const raw = width.map((w) => (w >= 4 ? Math.min(w / 4, 2) : 0))
  // The lane shifts smoothly where the width changes
  const lane = new Float32Array(raw.length)
  raw.forEach((_, i) => {
    let s = 0
    let n = 0
    for (let k = Math.max(0, i - 4); k <= Math.min(raw.length - 1, i + 4); k++) {
      s += raw[k]
      n++
    }
    lane[i] = s / n
  })
  const cum = cumOf(base)
  const tan = (i: number) => ({ x: nrm[i].z, z: -nrm[i].x })
  // In a bend a car on the inner lane swings toward the middle (so it does not mount the corner curb on narrow roads)
  {
    const inner = new Float32Array(base.length)
    for (let i = 0; i < base.length; i++) {
      const a = Math.max(0, i - 4)
      const b = Math.min(base.length - 1, i + 4)
      const ta = tan(a)
      const tb = tan(b)
      // Turning right (the next direction points toward the previous right normal): the right lane is the inner side
      const right = tb.x * nrm[a].x + tb.z * nrm[a].z
      inner[i] = Math.max(0, Math.min(1, (lane[i] > 0 ? right : -right) / 0.5)) * (1 - Math.abs(ta.x * tb.x + ta.z * tb.z) > 0.02 ? 1 : 0)
    }
    for (let i = 0; i < base.length; i++) {
      let k = 0
      for (let j = Math.max(0, i - 6); j <= Math.min(base.length - 1, i + 6); j++) k = Math.max(k, inner[j] * (1 - Math.abs(j - i) / 7))
      lane[i] *= 1 - 0.55 * k
    }
  }
  // Item on the road: shift to the nearest free offset off the lane (inside the road, 1 m from the edge); the shift starts 8 m ahead
  const off = new Float32Array(lane)
  if (net.roadBlocks.length) {
    const dev = new Float32Array(base.length)
    for (let i = 0; i < base.length; i++) {
      const t = tan(i)
      const at = (o: number) => carHits(net.roadBlocks, base[i].x + nrm[i].x * o, base[i].z + nrm[i].z * o, t.x, t.z)
      if (!at(lane[i])) continue
      const h = Math.max(0, (width[i] || 0) / 2 - 1)
      let best: number | null = null
      for (let o = -h; o <= h + 1e-6; o += 0.1) if (!at(o) && (best == null || Math.abs(o - lane[i]) < Math.abs(best - lane[i]))) best = o
      // No room to pass: this route is not used
      if (best == null) return null
      dev[i] = best - lane[i]
    }
    const R = 8
    for (let i = 0; i < base.length; i++) {
      let best = 0
      for (let k = 0; k < base.length; k++) {
        const d = Math.abs(cum[i] - cum[k])
        if (d >= R || !dev[k]) continue
        const v = dev[k] * Math.min(1, (1 - d / R) * 1.6)
        if (Math.abs(v) > Math.abs(best)) best = v
      }
      off[i] = lane[i] + best
    }
    // Still hitting after the shift (narrow spot): the route is not used
    for (let i = 0; i < base.length; i++) {
      const t = tan(i)
      if (carHits(net.roadBlocks, base[i].x + nrm[i].x * off[i], base[i].z + nrm[i].z * off[i], t.x, t.z)) return null
    }
  }
  // Speed limit from the road curvature (heading change between 1.5 m ahead and 1.5 m behind / length; shorter at the ends)
  const pos = base.map((b, i) => ({ x: b.x + nrm[i].x * off[i], z: b.z + nrm[i].z * off[i] }))
  const head = (i: number) => {
    const a = pos[Math.max(0, i - 1)]
    const b = pos[Math.min(pos.length - 1, i + 1)]
    return Math.atan2(b.x - a.x, b.z - a.z)
  }
  const limit = new Float32Array(base.length)
  for (let i = 0; i < base.length; i++) {
    const a = Math.max(1, i - 3)
    const b = Math.min(base.length - 2, i + 3)
    const turn = b > a ? Math.abs(Math.atan2(Math.sin(head(b) - head(a)), Math.cos(head(b) - head(a)))) : 0
    const len = Math.max(0.5, cum[b] - cum[a])
    const r = turn > 1e-3 ? len / turn : Infinity
    limit[i] = Math.max(MIN_SPEED, Math.min(CAR_SPEED, Math.sqrt(LAT_ACC * r)))
  }
  return { base, nrm, cum, len: cum[cum.length - 1], off, limit, cross: crossingsOf(base, cum, off, nrm, net.crossings) }
}

/* ---------- pedestrian ---------- */

/**
 * A walking route on the sidewalk. The pedestrian walks slightly right of the sidewalk center; when the way is blocked (an
 * item) they shift to the nearest free offset inside the sidewalk, smoothly (starting 1.4 m ahead). dog: the dog walks
 * 45 cm to the right or left of its owner.
 */
export function walkTrack(level: Level, net: StreetNet, rnd: () => number, dog = false): Track | null {
  const route = pickRoute(net.walks, rnd)
  if (!route || polyLen(route) < 4) return null
  const base = resample(roundCorners(route, 1.2), 0.2)
  const nrm = normals(base)
  const cum = cumOf(base)
  const g = personGrid(level)
  const half = base.map((b, i) => Math.max(0, widthAt(net.walkRects, b, nrm[i]) / 2 - 0.3))
  const free = (i: number, o: number) => isFree(g, base[i].x + nrm[i].x * o, base[i].z + nrm[i].z * o, true)
  /** Free offset closest to the preferred one (at least 0.35 m from avoid); otherwise the preferred one */
  const choose = (pref: number[], avoid?: Float32Array) => {
    const out = new Float32Array(base.length)
    base.forEach((_, i) => {
      const h = half[i]
      const p = Math.max(-h, Math.min(h, pref[i]))
      let best = p
      let bd = Infinity
      for (let o = -h; o <= h + 1e-6; o += 0.1) {
        if (avoid && Math.abs(o - avoid[i]) < 0.35) continue
        if (!free(i, o)) continue
        const d = Math.abs(o - p)
        if (d < bd) {
          bd = d
          best = o
        }
      }
      out[i] = best
    })
    // Smooth avoidance: at each point the largest required shift within 1.4 m, fading with distance
    const dev = Array.from(out, (o, i) => o - Math.max(-half[i], Math.min(half[i], pref[i])))
    const R = 1.4
    const smooth = new Float32Array(base.length)
    base.forEach((_, i) => {
      let best = 0
      for (let k = i; k >= 0 && cum[i] - cum[k] < R; k--) {
        const v = dev[k] * (1 - (cum[i] - cum[k]) / R)
        if (Math.abs(v) > Math.abs(best)) best = v
      }
      for (let k = i + 1; k < base.length && cum[k] - cum[i] < R; k++) {
        const v = dev[k] * (1 - (cum[k] - cum[i]) / R)
        if (Math.abs(v) > Math.abs(best)) best = v
      }
      const p = Math.max(-half[i], Math.min(half[i], pref[i]))
      smooth[i] = Math.max(-half[i], Math.min(half[i], p + best))
    })
    return smooth
  }
  const keep = base.map((_, i) => Math.min(0.35, half[i] * 0.5))
  const off = choose(keep)
  let off2: Float32Array | undefined
  if (dog) {
    const side = rnd() < 0.5 ? 1 : -1
    off2 = choose(Array.from(off, (o) => o + side * 0.45), off)
  }
  return { base, nrm, cum, len: cum[cum.length - 1], off, off2, cross: crossingsOf(base, cum, off, nrm, net.crossings) }
}

/** Route point at s (which 1: the dog's offset) */
export function posAt(t: Track, s: number, which: 0 | 1 = 0): P {
  const c = t.cum
  const v = Math.max(0, Math.min(t.len, s))
  let lo = 0
  let hi = c.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (c[m] <= v) lo = m
    else hi = m
  }
  const l = c[hi] - c[lo]
  const k = l > 1e-9 ? (v - c[lo]) / l : 0
  const off = which === 1 && t.off2 ? t.off2 : t.off
  const o = off[lo] + (off[hi] - off[lo]) * k
  const nx = t.nrm[lo].x + (t.nrm[hi].x - t.nrm[lo].x) * k
  const nz = t.nrm[lo].z + (t.nrm[hi].z - t.nrm[lo].z) * k
  return { x: t.base[lo].x + (t.base[hi].x - t.base[lo].x) * k + nx * o, z: t.base[lo].z + (t.base[hi].z - t.base[lo].z) * k + nz * o }
}

/** Route heading at s (radians; forward is (sin, cos)) */
export function dirAt(t: Track, s: number, which: 0 | 1 = 0) {
  const a = posAt(t, s - 0.3, which)
  const b = posAt(t, s + 0.3, which)
  return Math.atan2(b.x - a.x, b.z - a.z)
}

/** Speed limit at s: the highest speed that still lets the car brake to every limit within the next d meters (slows for a bend just in time) */
export function limitAhead(t: Track, s: number, d: number) {
  if (!t.limit) return Infinity
  let m = Infinity
  for (let i = 0; i < t.cum.length; i++) {
    if (t.cum[i] < s - 1) continue
    if (t.cum[i] > s + d) break
    m = Math.min(m, Math.sqrt(t.limit[i] ** 2 + 2 * BRAKE * Math.max(0, t.cum[i] - s)))
  }
  return m
}

/** Sniff spots along a walking route: their positions along the route (those closer than 1.3 m to it) */
export function sniffStops(t: Track, spots: P[]) {
  const out: { s: number; at: P }[] = []
  for (const q of spots) {
    let best = { s: 0, d: Infinity }
    t.base.forEach((b, i) => {
      const d = dist(b, q)
      if (d < best.d) best = { s: t.cum[i], d }
    })
    if (best.d < 1.3 && best.s > 1.5 && best.s < t.len - 1.5) out.push({ s: best.s, at: q })
  }
  return out.sort((a, b) => a.s - b.s)
}

/* ---------- playground ---------- */

/** Playground entrance: a spot in the playground's room facing the nearest sidewalk (otherwise the room edge) */
export function playEntrance(level: Level, net: StreetNet, at: P): P {
  const room = roomAt(level.rooms, at.x, at.z)
  const rects = room ? rectsOf(room) : []
  let target: P | null = null
  let bd = Infinity
  for (const pl of net.walks)
    for (const q of pl) {
      const d = dist(q, at)
      if (d < bd) {
        bd = d
        target = q
      }
    }
  // The point on the room edge closest to the target (sidewalk); otherwise the nearest edge
  let best: P = at
  bd = Infinity
  for (const r of rects) {
    const cands: P[] = [
      { x: Math.max(r.x + 0.4, Math.min(r.x + r.w - 0.4, (target ?? at).x)), z: r.z + 0.4 },
      { x: Math.max(r.x + 0.4, Math.min(r.x + r.w - 0.4, (target ?? at).x)), z: r.z + r.d - 0.4 },
      { x: r.x + 0.4, z: Math.max(r.z + 0.4, Math.min(r.z + r.d - 0.4, (target ?? at).z)) },
      { x: r.x + r.w - 0.4, z: Math.max(r.z + 0.4, Math.min(r.z + r.d - 0.4, (target ?? at).z)) },
    ]
    for (const c of cands) {
      const d = target ? dist(c, target) : dist(c, at)
      if (d < bd) {
        bd = d
        best = c
      }
    }
  }
  return best
}

/** Walking path on the people grid (outdoors allowed); otherwise straight */
export function walkPath(level: Level, from: P, to: P): P[] {
  const g = personGrid(level)
  const path = findPath(g, from, to, true)
  if (path?.length) {
    if (isFree(g, to.x, to.z, true)) path[path.length - 1] = to
    return path
  }
  return [to]
}

/* ---------- frequency ---------- */

export type Actor = 'car' | 'walker' | 'dog'

/** Wait until the next one (s): frequent by day, sparse at night, very sparse after midnight; fewer pedestrians in the rain */
export function gapOf(kind: Actor, night: boolean, hour: number, rain: boolean): [number, number] | null {
  const late = night && hour < 5
  let g: [number, number]
  if (kind === 'car') g = late ? [45, 120] : night ? [18, 45] : [7, 18]
  else if (kind === 'walker') g = late ? [100, 260] : night ? [30, 70] : [9, 22]
  else {
    if (late) return null
    const walkTime = (hour >= 6 && hour < 10) || (hour >= 17 && hour < 23)
    g = walkTime ? [25, 60] : night ? [70, 160] : [45, 110]
  }
  if (rain && kind !== 'car') g = [g[0] * 2, g[1] * 2]
  return g
}

/** Kids are in the playground by day when it does not rain */
export const kidsOut = (night: boolean, rain: boolean) => !night && !rain

/** Test and debug (window.__homescape.street()) and sounds (SoundScape) */
export const streetDebug = {
  active: false,
  cars: [] as { id: number; x: number; z: number; heading: number; speed: number }[],
  walkers: [] as { id: number; x: number; z: number; heading: number; speed: number; dog: boolean; waiting: boolean }[],
  dogs: [] as { id: number; x: number; z: number; moving: boolean; sniff: boolean; leash: number }[],
  kids: [] as { id: number; x: number; y: number; z: number; play: PlayKind | null; act: string }[],
  parent: null as { x: number; z: number; seated: boolean } | null,
  /** Center of the area where the kids play (play sound) */
  playAt: null as P | null,
  /** Spawned so far */
  seen: { car: 0, walker: 0, dog: 0, kids: 0 },
  /** Automatic spawning (tests turn it off and spawn only with force) */
  auto: true,
  /** Chance that the dog stops at a sniff spot along the way (tests set 1) */
  sniffChance: 0.6,
  /** Spawns one now (test); with via the route passes within 1 m of that point */
  force: (_kind: 'car' | 'walker' | 'dog' | 'kids' | 'leave', _via?: P) => false as boolean,
}
