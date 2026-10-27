import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { isOutdoor, rectsOf, WALL_H, WALL_T } from '@/model/geometry'
import type { Item, Level, Rect } from '@/model/types'

/*
 * Roof. The roof of each floor covers the part of its indoor rooms (rooms, garage) that upper floors do not cover: in a two
 * storey home the upper floor's roof and the roof of the single storey garage next to it are separate. The shape is a hip
 * roof (sloped on all four sides): its height is proportional to the L∞ distance to the eaves edge (the outer edge; an
 * edge leaning against an upper floor is not an eave, the roof rises towards it). For any right-angled plan (L, T, U)
 * planar faces, valleys at inner corners and hips at outer corners come out by themselves. It is computed on a grid
 * aligned with the room edges (chessboard distance transform, heights at grid corners); faces are flat shaded. The eaves
 * overhang the wall by 40 cm, have a soffit and a fascia board and sit on top of the walls (LIFT). A fireplace gets a
 * chimney through the roof. Displayed by Scene > Roofs (visible from afar, lifts when zooming in).
 */

export const ROOF_PITCH = 0.62
export const ROOF_OVERHANG = 0.4
/** Maximum ridge height above the wall top (on a wide plan the top flattens) */
export const ROOF_MAX = 3.2

const THICK = 0.12
/**
 * The roof sits on top of the walls: the outer wall sticks out WALL_T/2 beyond the room edge; the underside of the roof is
 * raised so it clears the wall top by 1 cm at that outer face. Otherwise the 12 cm thick roof sinks into the wall and the
 * top of the wall's outer half shows as a gray strip above the roof along the eaves and at inner corners.
 */
const LIFT = THICK + ROOF_PITCH * (WALL_T / 2) + 0.01

export interface RoofGeo {
  top: THREE.BufferGeometry
  trim: THREE.BufferGeometry
  chimneys: { x: number; z: number; y0: number; y1: number }[]
  /** Area it covers (for display) */
  box: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }
}

const indoorRects = (l: Level) => l.rooms.filter((r) => !isOutdoor(r)).flatMap(rectsOf)
const inAny = (rs: Rect[], x: number, z: number) => rs.some((q) => x > q.x && x < q.x + q.w && z > q.z && z < q.z + q.d)

/**
 * Grid step: the largest step that divides the coordinates so the room edges fall on grid lines (25, 12.5, 10, 5 cm); 15 cm
 * when none fits. When they fit, ridge, hip and valley lines pass exactly through grid points (no saw teeth).
 */
function cellFor(rects: Rect[]) {
  const vals = rects.flatMap((r) => [r.x, r.z, r.x + r.w, r.z + r.d])
  for (const c of [0.25, 0.125, 0.1, 0.05]) if (vals.every((v) => Math.abs(v / c - Math.round(v / c)) < 1e-3)) return c
  return 0.15
}

/** Flat concrete roof: slab top 20 cm above the wall, parapet 50 cm above the slab, 15 cm thick */
const SLAB = 0.2
const PARAPET_H = 0.5
const PARAPET_T = 0.15

/** Roof geometry of a floor (the indoor area upper floors do not cover); null without a roof. style: tiled hip roof or flat concrete roof */
export function roofGeometry(level: Level, above: Level[], style: 'tile' | 'concrete' = 'tile'): RoofGeo | null {
  const own = indoorRects(level)
  if (!own.length) return null
  const cover = above.flatMap(indoorRects)
  if (style === 'concrete') return flatRoof(level, own, cover)
  const CELL = cellFor([...own, ...cover])
  // Eaves overhang is a multiple of the grid step (40-50 cm)
  const r = Math.max(1, Math.round(ROOF_OVERHANG / CELL))
  const OVER = r * CELL
  const pad = OVER + CELL * 3
  const minX = Math.floor((Math.min(...own.map((q) => q.x)) - pad) / CELL) * CELL
  const minZ = Math.floor((Math.min(...own.map((q) => q.z)) - pad) / CELL) * CELL
  const maxX = Math.max(...own.map((q) => q.x + q.w)) + pad
  const maxZ = Math.max(...own.map((q) => q.z + q.d)) + pad
  const nx = Math.ceil((maxX - minX) / CELL)
  const nz = Math.ceil((maxZ - minZ) / CELL)
  const N = nx * nz
  const cx = (i: number) => minX + (i + 0.5) * CELL
  const cz = (j: number) => minZ + (j + 0.5) * CELL
  // Cells: under the roof (indoor area not covered by the upper floor) and the upper floor's footprint
  const roofed = new Uint8Array(N)
  const covered = new Uint8Array(N)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = cx(i)
      const z = cz(j)
      const k = j * nx + i
      covered[k] = inAny(cover, x, z) ? 1 : 0
      roofed[k] = !covered[k] && inAny(own, x, z) ? 1 : 0
    }
  if (!roofed.some(Boolean)) return null
  // Eaves: the area under the roof grows by the overhang in L∞ (it does not spill into the upper floor)
  const rowMax = new Uint8Array(N)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      let v = 0
      for (let d = -r; d <= r && !v; d++) {
        const ii = i + d
        if (ii >= 0 && ii < nx && roofed[j * nx + ii]) v = 1
      }
      rowMax[j * nx + i] = v
    }
  const eave = new Uint8Array(N)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (covered[j * nx + i]) continue
      let v = 0
      for (let d = -r; d <= r && !v; d++) {
        const jj = j + d
        if (jj >= 0 && jj < nz && rowMax[jj * nx + i]) v = 1
      }
      eave[j * nx + i] = v
    }
  const INF = 1e9
  /** Chessboard distance transform (two passes, 8 neighbors); init: start distance (sources 0 or r, the rest INF) */
  const chess = (w: number, h: number, init: (i: number, j: number) => number) => {
    const d = new Float64Array(w * h)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d[j * w + i] = init(i, j)
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : d[j * w + i])
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = j * w + i
        if (d[k]) d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i - 1, j - 1) + 1, at(i, j - 1) + 1, at(i + 1, j - 1) + 1)
      }
    for (let j = h - 1; j >= 0; j--)
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i
        if (d[k]) d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i + 1, j + 1) + 1, at(i, j + 1) + 1, at(i - 1, j + 1) + 1)
      }
    return d
  }
  // Sources: outside the eaves (neither roof nor upper floor) 0; upper floor r (the overhang): at the edge leaning against
  // the upper floor the roof ends at wall top height and rises from there too (hip). Otherwise it would climb to ridge
  // height towards the upper floor and cover its windows.
  const cellInit = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : eave[j * nx + i] ? INF : covered[j * nx + i] ? r : 0)
  const dc = chess(nx, nz, cellInit)
  const vx = nx + 1
  const dv = chess(vx, nz + 1, (i, j) => Math.min(cellInit(i - 1, j - 1), cellInit(i, j - 1), cellInit(i - 1, j), cellInit(i, j)))
  // Height: at the eaves edge below the wall top by the slope over the overhang, rising inwards; the top (ridge) at most
  // ROOF_MAX (the limit lies on a grid line, so the edge of the flat part is not a jagged line either)
  const cap = Math.round((ROOF_MAX / ROOF_PITCH + OVER) / CELL)
  const hOf = (d: number) => WALL_H + LIFT + ROOF_PITCH * (Math.min(d, cap) * CELL - OVER)
  const vid = new Int32Array(vx * (nz + 1)).fill(-1)
  const pos: number[] = []
  const vert = (i: number, j: number) => {
    const k = j * vx + i
    if (vid[k] < 0) {
      vid[k] = pos.length / 3
      pos.push(minX + i * CELL, hOf(dv[k]), minZ + j * CELL)
    }
    return vid[k]
  }
  const idx: number[] = []
  const tri = (a: number, b: number, c: number) => idx.push(a, b, c)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (!eave[j * nx + i]) continue
      const a = vert(i, j)
      const b = vert(i + 1, j)
      const c = vert(i, j + 1)
      const d = vert(i + 1, j + 1)
      // Diagonal: the one closer to the true height at the cell center (the crease runs along that diagonal)
      const mid = hOf(dc[j * nx + i] - 0.5)
      const y = (v: number) => pos[v * 3 + 1]
      if (Math.abs((y(a) + y(d)) / 2 - mid) <= Math.abs((y(b) + y(c)) / 2 - mid)) {
        tri(a, c, d)
        tri(a, d, b)
      } else {
        tri(a, c, b)
        tri(b, c, d)
      }
    }
  const top = new THREE.BufferGeometry()
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  top.setIndex(idx)
  top.computeVertexNormals()
  // Underside (the same surface lower by the thickness, reversed) and fascia board (edges used by a single triangle)
  const tpos: number[] = []
  const P = (v: number, dy = 0) => [pos[v * 3], pos[v * 3 + 1] - dy, pos[v * 3 + 2]]
  for (let t = 0; t < idx.length; t += 3) tpos.push(...P(idx[t], THICK), ...P(idx[t + 2], THICK), ...P(idx[t + 1], THICK))
  const edges = new Map<string, [number, number, number]>()
  for (let t = 0; t < idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const u = idx[t + e]
      const w = idx[t + ((e + 1) % 3)]
      const key = u < w ? `${u},${w}` : `${w},${u}`
      const cur = edges.get(key)
      edges.set(key, cur ? [cur[0], cur[1], cur[2] + 1] : [u, w, 1])
    }
  for (const [u, w, n] of edges.values()) {
    if (n !== 1) continue
    // Vertical strip facing outwards (same winding as the triangle: u -> w faces out on the outer edge)
    tpos.push(...P(u), ...P(w, THICK), ...P(w), ...P(u), ...P(u, THICK), ...P(w, THICK))
  }
  const trim = new THREE.BufferGeometry()
  trim.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3))
  trim.computeVertexNormals()
  // Chimneys: above the fireplaces under the roof, 70 cm out of the roof
  const chimneys = level.items
    .filter((it: Item) => it.kind === 'fireplace')
    .flatMap((it) => {
      const i = Math.floor((it.x - minX) / CELL)
      const j = Math.floor((it.z - minZ) / CELL)
      const k = j * nx + i
      if (i < 0 || j < 0 || i >= nx || j >= nz || !roofed[k]) return []
      return [{ x: it.x, z: it.z, y0: WALL_H - 0.1, y1: hOf(dc[k] - 0.5) + 0.7 }]
    })
  let maxY = WALL_H
  for (let k = 1; k < pos.length; k += 3) maxY = Math.max(maxY, pos[k])
  return { top, trim, chimneys, box: { minX, maxX, minZ, maxZ, maxY } }
}

/**
 * Flat concrete roof (selectable instead of tiles): a flat slab above the indoor area the upper floor does not cover (no
 * eaves, flush with the wall) and a parapet on the outer edges; no parapet on the edge leaning against the upper floor.
 * The slab is merged into greedy rectangles on the grid (few triangles).
 */
function flatRoof(level: Level, own: Rect[], cover: Rect[]): RoofGeo | null {
  const CELL = cellFor([...own, ...cover])
  const minX = Math.floor((Math.min(...own.map((q) => q.x)) - CELL) / CELL) * CELL
  const minZ = Math.floor((Math.min(...own.map((q) => q.z)) - CELL) / CELL) * CELL
  const maxX = Math.max(...own.map((q) => q.x + q.w)) + CELL
  const maxZ = Math.max(...own.map((q) => q.z + q.d)) + CELL
  const nx = Math.ceil((maxX - minX) / CELL)
  const nz = Math.ceil((maxZ - minZ) / CELL)
  const at = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return 0
    const x = minX + (i + 0.5) * CELL
    const z = minZ + (j + 0.5) * CELL
    // 1 roof, 2 upper floor, 0 outside
    return inAny(cover, x, z) ? 2 : inAny(own, x, z) ? 1 : 0
  }
  const grid = new Uint8Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) grid[j * nx + i] = at(i, j)
  const g = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : grid[j * nx + i])
  if (!grid.some((v) => v === 1)) return null
  const top = WALL_H + SLAB
  // Slab: the longest run row by row, extended downwards at the same width
  const used = new Uint8Array(nx * nz)
  const pos: number[] = []
  const idx: number[] = []
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (g(i, j) !== 1 || used[j * nx + i]) continue
      let i2 = i
      while (i2 + 1 < nx && g(i2 + 1, j) === 1 && !used[j * nx + i2 + 1]) i2++
      let j2 = j
      const rowFree = (jj: number) => {
        for (let k = i; k <= i2; k++) if (g(k, jj) !== 1 || used[jj * nx + k]) return false
        return true
      }
      while (j2 + 1 < nz && rowFree(j2 + 1)) j2++
      for (let jj = j; jj <= j2; jj++) for (let k = i; k <= i2; k++) used[jj * nx + k] = 1
      const x0 = minX + i * CELL
      const x1 = minX + (i2 + 1) * CELL
      const z0 = minZ + j * CELL
      const z1 = minZ + (j2 + 1) * CELL
      const b = pos.length / 3
      pos.push(x0, top, z0, x1, top, z0, x0, top, z1, x1, top, z1)
      // two upward facing triangles (a, c, b) and (b, c, d)
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
  const slab = new THREE.BufferGeometry()
  slab.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  slab.setIndex(idx)
  slab.computeVertexNormals()
  // Parapet: edge runs facing outwards (none on edges facing the upper floor); a box from the wall top to the parapet top.
  // The parapet also covers the outer face of the outer wall (the wall sticks out WALL_T/2 beyond the room edge, otherwise
  // a 5 cm gray ledge of wall top shows at the foot of the parapet); the run ends extend by the same amount, closing corners
  const OUT = WALL_T / 2 + 0.01
  const boxes: THREE.BufferGeometry[] = []
  const y0 = WALL_H - 0.02
  const y1 = top + PARAPET_H
  const box = (x0: number, z0: number, x1: number, z1: number) => {
    const b = new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0))
    b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    boxes.push(b.index ? b.toNonIndexed() : b)
  }
  // Horizontal edges (constant z): top of row j (j-1 outside) and bottom (j+1 outside)
  for (const [dj, inward] of [
    [-1, 1],
    [1, -1],
  ] as const)
    for (let j = 0; j < nz; j++) {
      let start = -1
      for (let i = 0; i <= nx; i++) {
        const edge = i < nx && g(i, j) === 1 && g(i, j + dj) === 0
        if (edge && start < 0) start = i
        if (!edge && start >= 0) {
          const zEdge = minZ + (dj < 0 ? j : j + 1) * CELL
          box(minX + start * CELL - OUT, zEdge - inward * OUT, minX + i * CELL + OUT, zEdge + inward * PARAPET_T)
          start = -1
        }
      }
    }
  // Vertical edges (constant x)
  for (const [di, inward] of [
    [-1, 1],
    [1, -1],
  ] as const)
    for (let i = 0; i < nx; i++) {
      let start = -1
      for (let j = 0; j <= nz; j++) {
        const edge = j < nz && g(i, j) === 1 && g(i + di, j) === 0
        if (edge && start < 0) start = j
        if (!edge && start >= 0) {
          const xEdge = minX + (di < 0 ? i : i + 1) * CELL
          box(xEdge - inward * OUT, minZ + start * CELL - OUT, xEdge + inward * PARAPET_T, minZ + j * CELL + OUT)
          start = -1
        }
      }
    }
  const trim = boxes.length ? (mergeGeometries(boxes, false) ?? new THREE.BufferGeometry()) : new THREE.BufferGeometry()
  boxes.forEach((b) => b.dispose())
  const chimneys = level.items
    .filter((it: Item) => it.kind === 'fireplace' && g(Math.floor((it.x - minX) / CELL), Math.floor((it.z - minZ) / CELL)) === 1)
    .map((it) => ({ x: it.x, z: it.z, y0: WALL_H - 0.1, y1: top + 1 }))
  return { top: slab, trim, chimneys, box: { minX, maxX, minZ, maxZ, maxY: y1 } }
}
