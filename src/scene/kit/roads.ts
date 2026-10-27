import * as THREE from 'three'
import type { Rect } from '@/model/types'

/*
 * Road markings as a road network. Painting each road piece on its own made the arms of L and T roads cut across each
 * other's lines and drew the short arm in the wrong direction, so all road and crosswalk pieces (the room's pieces and
 * neighboring road rooms) are handled together:
 * - edge lines follow the outer outline of the network 30 cm inside, turn at corners (shorter at outer corners, longer at
 *   inner corners) and stop where an edge joins another road piece or a crosswalk; at an arm's dead end (no connection, no
 *   turn) they do not close the road across;
 * - the center line runs down the middle of each arm: the arm's direction comes from the pieces fully joined at its end
 *   edges (else the long side); an arm joining a side edge (T, L) extends to the middle of the main arm; at an L corner the
 *   main arm's line ends at the junction and turns; on a corner piece fully joined in both directions (three-piece L,
 *   four-way junction) the entries meet at the piece's center.
 * By width: under 2.5 m plain asphalt, up to 4.5 m edge lines only, up to 9 m a dashed center line (1.5 m dash, 1.5 m gap;
 * continuous around corners), above that a double solid center line.
 * One canvas texture per room (the room's bounding box); each piece samples its own region (roadSub).
 */

export interface NetPiece {
  r: Rect
  kind: 'road' | 'crosswalk'
}
interface P {
  x: number
  z: number
}
export interface RoadMarks {
  /** Edge lines (straight segments) */
  edges: [P, P][]
  /** Centre lines (joined polylines); double: 9 m and wider */
  centers: { pts: P[]; double: boolean }[]
}

const EPS = 0.02
const INSET = 0.3
type Side = 'l' | 'r' | 't' | 'b'

/** Span along an edge of a where b touches it */
function touch(a: Rect, b: Rect): { side: Side; lo: number; hi: number } | null {
  const zlo = Math.max(a.z, b.z)
  const zhi = Math.min(a.z + a.d, b.z + b.d)
  const xlo = Math.max(a.x, b.x)
  const xhi = Math.min(a.x + a.w, b.x + b.w)
  if (zhi - zlo > EPS) {
    if (Math.abs(b.x + b.w - a.x) < EPS) return { side: 'l', lo: zlo, hi: zhi }
    if (Math.abs(a.x + a.w - b.x) < EPS) return { side: 'r', lo: zlo, hi: zhi }
  }
  if (xhi - xlo > EPS) {
    if (Math.abs(b.z + b.d - a.z) < EPS) return { side: 't', lo: xlo, hi: xhi }
    if (Math.abs(a.z + a.d - b.z) < EPS) return { side: 'b', lo: xlo, hi: xhi }
  }
  return null
}

const edgeLen = (r: Rect, s: Side) => (s === 'l' || s === 'r' ? r.d : r.w)

type Axis = 'x' | 'z' | 'j'

/** Road pieces at most this far apart (m) count as adjacent: hand-drawn pieces often leave gaps of a few centimeters */
const WELD = 0.35

/**
 * Closes narrow gaps between pieces (for the markings only; the ground slab stays as drawn): a gap gets no edge line and
 * the pieces count as connected, so no double cross line appears in the middle of an arm.
 */
export function weld(pieces: NetPiece[]): NetPiece[] {
  const out = pieces.map((p) => ({ ...p, r: { ...p.r } }))
  // Overlapping pieces (an L arm reaching into the other arm): the piece whose cross span lies inside the other is trimmed
  // by the overlap so the two just touch (the wider piece covers the shared area)
  const within = (lo: number, hi: number, a: number, b: number) => lo >= a - EPS && hi <= b + EPS
  for (let i = 0; i < out.length; i++)
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue
      const a = out[i].r
      const b = out[j].r
      const xOver = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const zOver = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z)
      if (xOver <= EPS || zOver <= EPS) continue
      if (within(b.z, b.z + b.d, a.z, a.z + a.d)) {
        // b sticks out to the right: move its left edge to a's right edge; to the left: its right edge to a's left edge
        if (b.x + b.w > a.x + a.w + EPS && b.x >= a.x - EPS) {
          b.w = b.x + b.w - (a.x + a.w)
          b.x = a.x + a.w
        } else if (b.x < a.x - EPS && b.x + b.w <= a.x + a.w + EPS) b.w = a.x - b.x
      } else if (within(b.x, b.x + b.w, a.x, a.x + a.w)) {
        if (b.z + b.d > a.z + a.d + EPS && b.z >= a.z - EPS) {
          b.d = b.z + b.d - (a.z + a.d)
          b.z = a.z + a.d
        } else if (b.z < a.z - EPS && b.z + b.d <= a.z + a.d + EPS) b.d = a.z - b.z
      }
    }
  for (let i = 0; i < out.length; i++)
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue
      const a = out[i].r
      const b = out[j].r
      const zOver = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z)
      const xOver = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const gx = b.x - (a.x + a.w)
      const gz = b.z - (a.z + a.d)
      // Extend a up to b on its right (or in front); if they overlap slightly, shorten a to b's edge
      if (zOver > 0.5 && Math.abs(gx) > 1e-4 && Math.abs(gx) <= WELD && a.x < b.x) a.w += gx
      if (xOver > 0.5 && Math.abs(gz) > 1e-4 && Math.abs(gz) <= WELD && a.z < b.z) a.d += gz
    }
  return out
}

/** Markings of the network (pure geometry; testable) */
export function roadMarks(input: NetPiece[], paths = false): RoadMarks {
  // paths: for walking and driving paths (scene/streetPlan.ts): crosswalks count as road, narrow pieces get a center line too
  const pieces = weld(paths ? input.map((p) => ({ ...p, kind: 'road' as const })) : input)
  const roads = pieces.map((p, i) => ({ ...p, i })).filter((p) => p.kind === 'road')
  const contacts = pieces.map((a, i) => pieces.flatMap((b, j) => (i === j ? [] : (() => {
    const t = touch(a.r, b.r)
    return t ? [{ ...t, j }] : []
  })())))
  // Arm direction: the direction in which an end edge is fully (80%) joined; joined in both directions: junction piece; else the long side
  const axis: Axis[] = pieces.map((p, i) => {
    const full = (s: Side) => contacts[i].some((c) => c.side === s && c.hi - c.lo >= 0.8 * edgeLen(p.r, s))
    const tx = full('l') || full('r')
    const tz = full('t') || full('b')
    if (tx && tz) return 'j'
    if (tx) return 'x'
    if (tz) return 'z'
    return p.r.w >= p.r.d ? 'x' : 'z'
  })
  const across = (i: number) => (axis[i] === 'x' ? pieces[i].r.d : axis[i] === 'z' ? pieces[i].r.w : Math.min(pieces[i].r.w, pieces[i].r.d))
  const lined = (i: number) => pieces[i].kind === 'road' && (paths || across(i) >= 2.5)
  const centred = (i: number) => lined(i) && (paths || across(i) >= 4.5)
  /**
   * Dead ends of an arm: the end edge touches no piece and no arm joins a side edge near it (not an L corner). There the
   * edge line does not close the road across.
   */
  const dead = pieces.map((p, i) => {
    const out = new Set<Side>()
    if (p.kind !== 'road' || axis[i] === 'j') return out
    const alongX = axis[i] === 'x'
    const ends: [Side, Side] = alongX ? ['l', 'r'] : ['t', 'b']
    const s0 = alongX ? p.r.x : p.r.z
    const s1 = alongX ? p.r.x + p.r.w : p.r.z + p.r.d
    const sideOf: Side[] = alongX ? ['t', 'b'] : ['l', 'r']
    // An arm on a side edge reaching the end (within 75 cm): L corner, not a dead end
    const branches = contacts[i].filter((c) => sideOf.includes(c.side) && pieces[c.j].kind === 'road')
    if (!contacts[i].some((c) => c.side === ends[0]) && !branches.some((c) => c.lo - s0 <= 0.75)) out.add(ends[0])
    if (!contacts[i].some((c) => c.side === ends[1]) && !branches.some((c) => s1 - c.hi <= 0.75)) out.add(ends[1])
    return out
  })

  /* ---------- edge lines: the network's boundary ---------- */
  const xs = [...new Set(pieces.flatMap((p) => [p.r.x, p.r.x + p.r.w]).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)
  const zs = [...new Set(pieces.flatMap((p) => [p.r.z, p.r.z + p.r.d]).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)
  const owner = (x: number, z: number) => pieces.findIndex((p) => x > p.r.x && x < p.r.x + p.r.w && z > p.r.z && z < p.r.z + p.r.d)
  const nx = xs.length - 1
  const nz = zs.length - 1
  const cell: number[] = []
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) cell.push(owner((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2))
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : cell[j * nx + i])
  // Unit boundary edges: lined road inside, outside the network outside; with the inward normal
  interface E {
    a: P
    b: P
    n: P
  }
  const units: E[] = []
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const o = at(i, j)
      if (o < 0 || !lined(o)) continue
      const r = pieces[o].r
      // Dead end edges are not drawn
      const end = (side: Side, v: number, edge: number) => dead[o].has(side) && Math.abs(v - edge) < 1e-6
      if (at(i - 1, j) < 0 && !end('l', xs[i], r.x)) units.push({ a: { x: xs[i], z: zs[j] }, b: { x: xs[i], z: zs[j + 1] }, n: { x: 1, z: 0 } })
      if (at(i + 1, j) < 0 && !end('r', xs[i + 1], r.x + r.w)) units.push({ a: { x: xs[i + 1], z: zs[j] }, b: { x: xs[i + 1], z: zs[j + 1] }, n: { x: -1, z: 0 } })
      if (at(i, j - 1) < 0 && !end('t', zs[j], r.z)) units.push({ a: { x: xs[i], z: zs[j] }, b: { x: xs[i + 1], z: zs[j] }, n: { x: 0, z: 1 } })
      if (at(i, j + 1) < 0 && !end('b', zs[j + 1], r.z + r.d)) units.push({ a: { x: xs[i], z: zs[j + 1] }, b: { x: xs[i + 1], z: zs[j + 1] }, n: { x: 0, z: -1 } })
    }
  // Merge end-to-end units on the same line with the same inward normal
  const key = (e: E) => (e.n.x ? `v${e.a.x}|${e.n.x}` : `h${e.a.z}|${e.n.z}`)
  const groups = new Map<string, E[]>()
  for (const u of units) groups.set(key(u), [...(groups.get(key(u)) ?? []), u])
  const segs: E[] = []
  for (const g of groups.values()) {
    const vert = g[0].n.x !== 0
    g.sort((p, q) => (vert ? p.a.z - q.a.z : p.a.x - q.a.x))
    let cur = { ...g[0] }
    for (const u of g.slice(1)) {
      const cont = vert ? Math.abs(u.a.z - cur.b.z) < 1e-6 : Math.abs(u.a.x - cur.b.x) < 1e-6
      if (cont) cur.b = u.b
      else {
        segs.push(cur)
        cur = { ...u }
      }
    }
    segs.push(cur)
  }
  const same = (p: P, q: P) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6
  const edges: [P, P][] = []
  for (const s of segs) {
    const dir = { x: Math.sign(s.b.x - s.a.x), z: Math.sign(s.b.z - s.a.z) }
    // If the boundary turns at this end with a perpendicular edge: shorten at an outer corner (the other edge's inward
    // normal points along this edge), lengthen at an inner corner
    const adjust = (q: P, into: P) => {
      const other = segs.find((o) => o !== s && (same(o.a, q) || same(o.b, q)) && (o.n.x !== 0) !== (s.n.x !== 0))
      if (!other) return 0
      return other.n.x * into.x + other.n.z * into.z > 0 ? INSET : -INSET
    }
    const a0 = adjust(s.a, dir)
    const b0 = adjust(s.b, { x: -dir.x, z: -dir.z })
    const a = { x: s.a.x + dir.x * a0 + s.n.x * INSET, z: s.a.z + dir.z * a0 + s.n.z * INSET }
    const b = { x: s.b.x - dir.x * b0 + s.n.x * INSET, z: s.b.z - dir.z * b0 + s.n.z * INSET }
    if (Math.hypot(b.x - a.x, b.z - a.z) > 0.05) edges.push([a, b])
  }

  /* ---------- center lines ---------- */
  const raw: [P, P, boolean][] = []
  const wide = (i: number) => across(i) >= 9
  for (const p of roads) {
    const i = p.i
    if (!centred(i)) continue
    const r = p.r
    if (axis[i] === 'j') {
      // Junction piece: the center line of each fully joined neighbor runs to the piece's center
      const c = { x: r.x + r.w / 2, z: r.z + r.d / 2 }
      for (const t of contacts[i]) {
        const n = pieces[t.j]
        if (n.kind !== 'road' || t.hi - t.lo < 0.8 * edgeLen(r, t.side)) continue
        const nAxis = axis[t.j]
        const entry = t.side === 'l' || t.side === 'r' ? (nAxis === 'x' ? { x: t.side === 'l' ? r.x : r.x + r.w, z: n.r.z + n.r.d / 2 } : null) : nAxis === 'z' ? { x: n.r.x + n.r.w / 2, z: t.side === 't' ? r.z : r.z + r.d } : null
        if (entry) {
          const mid = t.side === 'l' || t.side === 'r' ? { x: c.x, z: entry.z } : { x: entry.x, z: c.z }
          raw.push([entry, mid, wide(i)], [mid, c, wide(i)])
        }
      }
      continue
    }
    const alongX = axis[i] === 'x'
    let s0 = alongX ? r.x : r.z
    let s1 = alongX ? r.x + r.w : r.z + r.d
    const mid = alongX ? r.z + r.d / 2 : r.x + r.w / 2
    const endSides: [Side, Side] = alongX ? ['l', 'r'] : ['t', 'b']
    const longSides: Side[] = alongX ? ['t', 'b'] : ['l', 'r']
    const hasEnd = (s: Side) => contacts[i].some((c) => c.side === s)
    // Arms joining a side edge extend to this arm's middle; if the arm is at this arm's end (L), this arm's line ends there
    let cut0: number | null = null
    let cut1: number | null = null
    for (const t of contacts[i]) {
      if (!longSides.includes(t.side)) continue
      const n = pieces[t.j]
      if (n.kind !== 'road' || !centred(t.j)) continue
      const nAxis = axis[t.j]
      const branchMid = nAxis === 'j' ? (t.lo + t.hi) / 2 : alongX ? n.r.x + n.r.w / 2 : n.r.z + n.r.d / 2
      // A neighbor that does not join this edge with its end (runs parallel to it) is not an arm
      if (nAxis !== 'j' && (alongX ? nAxis !== 'z' : nAxis !== 'x')) continue
      const edgeAt = t.side === 'l' ? r.x : t.side === 'r' ? r.x + r.w : t.side === 't' ? r.z : r.z + r.d
      if (nAxis !== 'j') raw.push(alongX ? [{ x: branchMid, z: edgeAt }, { x: branchMid, z: mid }, wide(t.j)] : [{ x: edgeAt, z: branchMid }, { x: mid, z: branchMid }, wide(t.j)])
      const reach = Math.max(across(i), across(t.j)) / 2 + 0.75
      if (!hasEnd(endSides[0]) && branchMid - s0 <= reach) cut0 = Math.max(cut0 ?? -Infinity, branchMid)
      if (!hasEnd(endSides[1]) && s1 - branchMid <= reach) cut1 = Math.min(cut1 ?? Infinity, branchMid)
    }
    if (cut0 != null) s0 = cut0
    if (cut1 != null) s1 = cut1
    if (s1 - s0 > 0.05) raw.push(alongX ? [{ x: s0, z: mid }, { x: s1, z: mid }, wide(i)] : [{ x: mid, z: s0 }, { x: mid, z: s1 }, wide(i)])
  }
  // Join segments that touch end to end into polylines (the dash pattern continues around corners)
  const centers: { pts: P[]; double: boolean }[] = []
  const left = raw.filter(([a, b]) => Math.hypot(b.x - a.x, b.z - a.z) > 1e-4)
  while (left.length) {
    const [a, b, dbl] = left.shift()!
    const pts = [a, b]
    let grew = true
    while (grew) {
      grew = false
      for (let k = 0; k < left.length; k++) {
        const [p, q] = left[k]
        const head = pts[0]
        const tail = pts[pts.length - 1]
        if (same(p, tail)) pts.push(q)
        else if (same(q, tail)) pts.push(p)
        else if (same(q, head)) pts.unshift(p)
        else if (same(p, head)) pts.unshift(q)
        else continue
        left.splice(k, 1)
        grew = true
        break
      }
    }
    centers.push({ pts, double: dbl })
  }
  return { edges, centers }
}

/**
 * Centre polylines of the network without the marking rules: every piece, crosswalks too, however narrow. Cars on the road
 * and pedestrians on the sidewalk follow these (scene/streetPlan.ts).
 */
export const netPaths = (pieces: NetPiece[]) => roadMarks(pieces, true).centers.map((c) => c.pts)

/* ---------- texture ---------- */

const ASPHALT = '#6d7286'
const MARK = '#f2f3f8'

export interface RoadTexture {
  tex: THREE.CanvasTexture
  box: { minX: number; minZ: number; w: number; d: number }
  /** The room's pieces with narrow gaps closed (the ground slab is drawn from these so no ground shows through a gap) */
  rects: Rect[]
}

/** The room's single canvas: asphalt, grain and the network markings that fall inside the room */
export function roadTexture(own: Rect[], pieces: NetPiece[]): RoadTexture {
  // The room's pieces come first in the network, in the same order (RoomMesh); take their welded versions
  const room = weld(pieces)
    .slice(0, own.length)
    .map((p) => p.r)
  const minX = Math.min(...room.map((r) => r.x))
  const minZ = Math.min(...room.map((r) => r.z))
  const w = Math.max(...room.map((r) => r.x + r.w)) - minX
  const d = Math.max(...room.map((r) => r.z + r.d)) - minZ
  const mpx = Math.min(64, 2048 / Math.max(w, d, 1))
  const c = document.createElement('canvas')
  c.width = Math.max(4, Math.round(w * mpx))
  c.height = Math.max(4, Math.round(d * mpx))
  const g = c.getContext('2d')!
  g.fillStyle = ASPHALT
  g.fillRect(0, 0, c.width, c.height)
  // Grain (seeded)
  let k = 7
  const rnd = () => (k = (k * 9301 + 49297) % 233280) / 233280
  for (let n = Math.round((c.width * c.height) / 70); n > 0; n--) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(24, 28, 44, 0.12)' : 'rgba(255, 255, 255, 0.08)'
    g.fillRect(Math.floor(rnd() * c.width), Math.floor(rnd() * c.height), 1 + Math.round(rnd()), 1 + Math.round(rnd()))
  }
  const X = (x: number) => (x - minX) * mpx
  const Z = (z: number) => (z - minZ) * mpx
  const marks = roadMarks(pieces)
  const lw = 0.12 * mpx
  g.strokeStyle = MARK
  g.lineCap = 'butt'
  g.lineJoin = 'miter'
  g.lineWidth = lw
  for (const [a, b] of marks.edges) {
    g.beginPath()
    g.moveTo(X(a.x), Z(a.z))
    g.lineTo(X(b.x), Z(b.z))
    g.stroke()
  }
  for (const line of marks.centers) {
    const path = () => {
      g.beginPath()
      g.moveTo(X(line.pts[0].x), Z(line.pts[0].z))
      for (const p of line.pts.slice(1)) g.lineTo(X(p.x), Z(p.z))
    }
    if (line.double) {
      // Double solid line: a thick white stroke with an asphalt stroke in the middle (stays parallel around corners)
      g.setLineDash([])
      g.lineWidth = lw * 3
      g.strokeStyle = MARK
      path()
      g.stroke()
      g.lineWidth = lw
      g.strokeStyle = ASPHALT
      path()
      g.stroke()
      g.strokeStyle = MARK
    } else {
      g.lineWidth = lw
      g.setLineDash([1.5 * mpx, 1.5 * mpx])
      g.lineDashOffset = 0
      path()
      g.stroke()
      g.setLineDash([])
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 8
  return { tex, box: { minX, minZ, w, d }, rects: room }
}

/** A piece's region of the room canvas (box top face: u along +x, v=1 at the -z edge) */
export function roadSub(t: RoadTexture, r: Rect) {
  const s = t.tex.clone()
  s.needsUpdate = true
  s.repeat.set(r.w / t.box.w, r.d / t.box.d)
  s.offset.set((r.x - t.box.minX) / t.box.w, 1 - (r.z + r.d - t.box.minZ) / t.box.d)
  return s
}
