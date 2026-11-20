import { CATALOG, garageDoorWidth, isSlidingDoor, isWallOpening, OPENING_DOOR_H, SLIDING_DOOR, sizeOf, WALL_OPENING, WINDOW_BOTTOM, windowSize } from './catalog'
import type { Item, Level, Rect, Room, RoomType } from './types'

/*
 * Plan geometry: snapping, room parts, wall runs, sticking to walls, wall openings.
 *
 * A room is made of one or more rectangles (parts): the main rectangle (x, z, w, d) plus `parts`.
 * L, T and U hallways and rooms are built this way. Walls are drawn along the edge of the UNION of the parts:
 * there is no wall where two parts of the same room meet.
 *
 * Walls are CENTERED on the room boundary, so a wall shared by two rooms is not twice as thick: half of an exterior wall
 * is inside and half outside; each room draws half the thickness of a shared wall on its own side, together one wall.
 * So the inner face is everywhere WALL_IN inside the boundary and aligned. At corners the wall ends are extended by
 * WALL_IN (closing the outer corner and the inner corner of an L).
 */

export const WALL_T = 0.1
/** Distance of the wall's inner face from the room boundary (half the thickness) */
export const WALL_IN = WALL_T / 2
export const WALL_H = 2.6
/** Interior wall height (floor plan feel) and the cut height of exterior walls facing the camera */
export const WALL_INNER_H = 0.38
/** Height of a half wall (Room.half): a low divider, about counter height */
export const HALF_WALL_H = 1.05
export const WALL_CUT_H = 0.16
/** Doors and windows start this far inside the room boundary (their geometry is drawn from the boundary, wall centered) */
export const APERTURE_INSET = 0.21

export const snap = (v: number, step: number) => Math.round(v / step) * step

/** Outdoor rooms: balcony and terrace (railing along the edge), garden (no walls). */
const OUTDOOR: RoomType[] = ['balcony', 'terrace', 'garden']
export const isOutdoor = (room: Pick<Room, 'type'>) => OUTDOOR.includes(room.type ?? 'room')
/**
 * Street surface (road, crosswalk, sidewalk, parking): not a room of the house; left out of the bottom room bar, the side
 * panel's room list and the name labels in the scene in view mode. Edit mode keeps its label (with its size).
 */
export const isStreetSurface = (room: Pick<Room, 'type' | 'floor'>) => isOutdoor(room) && ['road', 'crosswalk', 'sidewalk', 'parking'].includes(room.floor)

export type Side = 'back' | 'front' | 'left' | 'right'

/* ---------- parts ---------- */

/** All rectangles of the room: the main one first, then the extra parts. */
export function rectsOf(room: Room): Rect[] {
  const main = { x: room.x, z: room.z, w: room.w, d: room.d }
  return room.parts?.length ? [main, ...room.parts] : [main]
}

export const inRect = (r: Rect, x: number, z: number) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d

/** Whether the point is inside any part of the room (edges included). */
export const inRoom = (room: Room, x: number, z: number) => rectsOf(room).some((r) => inRect(r, x, z))

export function roomAt(rooms: Room[], x: number, z: number) {
  return rooms.find((r) => inRoom(r, x, z))
}

/** Bounding box of the rectangles. */
export function rectBounds(rects: Rect[]) {
  if (!rects.length) return { minX: -4, maxX: 4, minZ: -3, maxZ: 3 }
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    maxX: Math.max(...rects.map((r) => r.x + r.w)),
    minZ: Math.min(...rects.map((r) => r.z)),
    maxZ: Math.max(...rects.map((r) => r.z + r.d)),
  }
}

export const bounds = (rooms: Room[]) => rectBounds(rooms.flatMap(rectsOf))

/** Area of the union of the parts (overlapping parts count once). */
export function roomArea(room: Room) {
  const rects = rectsOf(room)
  if (rects.length === 1) return room.w * room.d
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b)
  const zs = [...new Set(rects.flatMap((r) => [r.z, r.z + r.d]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cz = (zs[j] + zs[j + 1]) / 2
      if (rects.some((r) => inRect(r, cx, cz))) area += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j])
    }
  return area
}

/** Point of the room label: center of the largest part (so it does not fall into the gap of an L). */
export function labelPoint(room: Room) {
  const big = rectsOf(room).reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a))
  return { x: big.x + big.w / 2, z: big.z + big.d / 2 }
}

/** The room with its rectangles shifted by (dx, dz). */
export const shiftRoom = <T extends Room>(room: T, dx: number, dz: number): T => ({
  ...room,
  x: room.x + dx,
  z: room.z + dz,
  ...(room.parts ? { parts: room.parts.map((p) => ({ ...p, x: p.x + dx, z: p.z + dz })) } : {}),
})

/* ---------- wall runs ---------- */

export interface WallRun {
  side: Side
  horizontal: boolean
  /** Wall line: the room edge (z when horizontal, x when vertical) */
  line: number
  /** Start and end along the wall in world coordinates (x when horizontal, z when vertical) */
  a0: number
  a1: number
  /** Interior wall: another room on the other side (drawn low) */
  interior: boolean
  /** The room on the other side (indoor or outdoor); none when the run faces open space */
  neighbor?: string
  /** Half wall (Room.half): HALF_WALL_H high; floor items lean on it, only low wall items hang on it */
  half?: boolean
  /** Center of the part the run belongs to (for the facing-the-camera test) */
  cx: number
  cz: number
}

const OUT: Record<Side, number> = { back: -1, front: 1, left: -1, right: 1 }

/**
 * Walls left out (Room.open): the wall between two rooms is open when either room lists the other, so a shared wall
 * opens for both rooms at once; an edge facing open space is open when the room lists that side.
 */
export function wallOpen(room: Room, side: Side, neighbor?: Room) {
  if (neighbor) return Boolean(room.open?.includes(neighbor.id) || neighbor.open?.includes(room.id))
  return Boolean(room.open?.includes(side))
}

/** Half walls (Room.half), the same way: either room listing the other, or the room listing the side. Open wins. */
export function wallHalf(room: Room, side: Side, neighbor?: Room) {
  if (neighbor) return Boolean(room.half?.includes(neighbor.id) || neighbor.half?.includes(room.id))
  return Boolean(room.half?.includes(side))
}

/** Which wall of the room a run belongs to (Room.open entry): the room on the other side, or the side facing open space */
export const wallKey = (run: Pick<WallRun, 'neighbor' | 'side'>) => run.neighbor ?? run.side

/**
 * The room's real walls: each part's edge is split at the corners of the other parts and of neighbor rooms, and the
 * outside of each segment is checked. If the outside is this room again (where parts meet) there is no wall; another room
 * makes an interior wall; empty space an exterior wall. Consecutive segments of the same kind on one line are merged.
 *
 * Outdoor spaces (balcony, terrace, garden): an indoor room treats its edge next to an outdoor space as an exterior wall
 * (full thickness, half of it reaching into the balcony); the outdoor space's own runs are only its edges facing empty
 * space (a railing or nothing, RoomMesh decides), edges with a neighbor are skipped. mode 'house': the outdoor space's
 * edges facing the house wall (wall items hang there from outside: awning, outdoor wall light).
 *
 * Walls left out (Room.open, wallOpen) are skipped; mode 'open' returns only those (the open edges, drawn as a guide in
 * edit mode). mode 'edges': every edge of the union, ignoring neighbors and open walls (outlines, sticking to a wall).
 * Half walls (Room.half, wallHalf) are runs with half set; a half run never merges with a full one.
 * byWall: a run never spans two neighbors, so each run is one wall (wallKey) that can be selected and left out; otherwise
 * runs of the same kind merge across neighbors (and carry no neighbor when they span several), as items, strips, the walk
 * and the pets expect.
 */
export function wallRuns(room: Room, rooms: Room[], mode: 'walls' | 'house' | 'open' | 'edges' = 'walls', byWall = false): WallRun[] {
  const own = rectsOf(room)
  const others = mode === 'edges' ? [] : rooms.filter((o) => o.id !== room.id)
  const coordsX = [...own, ...others.flatMap(rectsOf)].flatMap((r) => [r.x, r.x + r.w])
  const coordsZ = [...own, ...others.flatMap(rectsOf)].flatMap((r) => [r.z, r.z + r.d])
  const runs: WallRun[] = []
  const covered = (side: Side, line: number, m: number) => runs.some((r) => r.side === side && Math.abs(r.line - line) < 1e-6 && m > r.a0 && m < r.a1)

  for (const p of own) {
    const sides: [Side, boolean, number, number, number][] = [
      ['back', true, p.z, p.x, p.x + p.w],
      ['front', true, p.z + p.d, p.x, p.x + p.w],
      ['left', false, p.x, p.z, p.z + p.d],
      ['right', false, p.x + p.w, p.z, p.z + p.d],
    ]
    for (const [side, horizontal, line, lo, hi] of sides) {
      const cuts = [...new Set([lo, hi, ...(horizontal ? coordsX : coordsZ).filter((c) => c > lo + 1e-6 && c < hi - 1e-6)])].sort((a, b) => a - b)
      for (let i = 0; i < cuts.length - 1; i++) {
        const a0 = cuts[i]
        const a1 = cuts[i + 1]
        const m = (a0 + a1) / 2
        const ox = horizontal ? m : line + OUT[side] * 0.05
        const oz = horizontal ? line + OUT[side] * 0.05 : m
        if (inRoom(room, ox, oz) || covered(side, line, m)) continue
        const neighbor = others.find((o) => inRoom(o, ox, oz))
        if (mode !== 'edges' && wallOpen(room, side, neighbor) !== (mode === 'open')) continue
        let interior: boolean
        if (mode === 'house') {
          if (!neighbor || isOutdoor(neighbor)) continue
          interior = false
        } else if (isOutdoor(room)) {
          if (neighbor) continue
          interior = false
        } else interior = Boolean(neighbor && !isOutdoor(neighbor))
        const prev = runs[runs.length - 1]
        const next = neighbor?.id
        const half = mode !== 'edges' && mode !== 'open' && wallHalf(room, side, neighbor)
        if (prev && prev.side === side && Math.abs(prev.line - line) < 1e-6 && Math.abs(prev.a1 - a0) < 1e-6 && prev.interior === interior && Boolean(prev.half) === half && (!byWall || prev.neighbor === next)) {
          prev.a1 = a1
          if (prev.neighbor !== next) delete prev.neighbor
        } else runs.push({ side, horizontal, line, a0, a1, interior, ...(next ? { neighbor: next } : {}), ...(half ? { half: true } : {}), cx: p.x + p.w / 2, cz: p.z + p.d / 2 })
      }
    }
  }
  return runs
}

/** Edge shared by two rectangles: which side of a and the common range (null if none). */
export function sharedEdge(a: Rect, b: Rect): { side: Side; lo: number; hi: number } | null {
  const EPS = 0.06
  const ox0 = Math.max(a.x, b.x)
  const ox1 = Math.min(a.x + a.w, b.x + b.w)
  const oz0 = Math.max(a.z, b.z)
  const oz1 = Math.min(a.z + a.d, b.z + b.d)
  if (ox1 - ox0 > 0) {
    if (Math.abs(a.z - (b.z + b.d)) < EPS) return { side: 'back', lo: ox0, hi: ox1 }
    if (Math.abs(a.z + a.d - b.z) < EPS) return { side: 'front', lo: ox0, hi: ox1 }
  }
  if (oz1 - oz0 > 0) {
    if (Math.abs(a.x - (b.x + b.w)) < EPS) return { side: 'left', lo: oz0, hi: oz1 }
    if (Math.abs(a.x + a.w - b.x) < EPS) return { side: 'right', lo: oz0, hi: oz1 }
  }
  return null
}

/**
 * Places a wall item on the inner face of the nearest real wall (not where parts meet).
 * null when there is no wall within maxDist. depth: how far the item sticks out of the wall.
 * With width, the item stays out of the side walls and sticks to a corner within 30 cm of it (cabinet, shower, counter).
 * aperture: doors and windows; their positions are relative to the room boundary, not the inner face (APERTURE_INSET).
 */
const WALL_ROT: Record<Side, number> = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }

/** The runs without the spans of the cut runs on the same side and line (an edge minus its open walls). */
function cutRuns(runs: WallRun[], cuts: WallRun[]): WallRun[] {
  if (!cuts.length) return runs
  return runs.flatMap((r) => {
    let pieces: [number, number][] = [[r.a0, r.a1]]
    for (const c of cuts) {
      if (c.side !== r.side || Math.abs(c.line - r.line) > 1e-6) continue
      pieces = pieces.flatMap(([a, b]): [number, number][] => (c.a1 <= a || c.a0 >= b ? [[a, b]] : ([[a, c.a0], [c.a1, b]] as [number, number][]).filter(([x, y]) => y - x > 1e-6)))
    }
    return pieces.map(([a0, a1]) => ({ ...r, a0, a1 }))
  })
}

/**
 * exact: the corner margin is only half the item's length (not at least 0.2 m) and wide items are not pulled into the
 * corner, so a wall-mounted power strip can go anywhere on the wall.
 * top: the highest point of a wall-mounted item or opening above the floor (rules.ts > wallTop): a half wall only takes
 * items below its top (a plug yes, a painting or a window no). Floor items (a counter) lean on half walls too.
 */
export function wallSnap(rooms: Room[], x: number, z: number, depth: number, maxDist = 0.6, width?: number, aperture = false, exact = false, top?: number, extra: WallRun[] = [], exterior = false) {
  let best: { x: number; z: number; rot: number; dist: number } | null = null
  const inset = aperture ? APERTURE_INSET : WALL_IN + depth / 2 + 0.01
  const ROT = WALL_ROT
  const tall = top != null && top > HALF_WALL_H - 0.02
  // extra: walls that are not rooms' walls, like the stairs' side walls (model/stairs.ts > stairsWallRuns); no door or
  // window goes into them
  // exterior: the outer faces of the house walls too, with no garden in front (an outdoor wall light, rules.ts > checkItem)
  const outward: Record<Side, Side> = { back: 'front', front: 'back', left: 'right', right: 'left' }
  const exteriorRuns: WallRun[] =
    exterior && !aperture
      ? rooms.filter((room) => !isOutdoor(room)).flatMap((room) => wallRuns(room, rooms).filter((r) => !r.interior && !(tall && r.half)).map((r) => ({ ...r, side: outward[r.side] })))
      : []
  const groups = [...rooms.map((room) =>
    // Outdoors the only wall is the house wall: items do not hang on a garden or balcony edge but on the house's outer face
    isOutdoor(room)
      ? wallRuns(room, rooms, 'house').filter((r) => !(tall && r.half))
      : cutRuns(wallRuns(room, [], 'edges'), [...wallRuns(room, rooms, 'open'), ...(tall ? wallRuns(room, rooms).filter((r) => r.half) : [])]),
  ), aperture ? [] : extra, exteriorRuns]
  for (const runs of groups) {
    for (const run of runs) {
      const along = run.horizontal ? x : z
      if (along < run.a0 - 0.2 || along > run.a1 + 0.2) continue
      const half = exact ? Math.max((width ?? 0) / 2, 0.02) : Math.max((width ?? 0) / 2, 0.2)
      const lo = run.a0 + WALL_IN + half
      const hi = run.a1 - WALL_IN - half
      let a = lo <= hi ? Math.min(Math.max(along, lo), hi) : (run.a0 + run.a1) / 2
      if (!exact && width && width >= 0.5 && lo <= hi) {
        if (Math.abs(a - lo) < 0.3) a = lo
        else if (Math.abs(a - hi) < 0.3) a = hi
      }
      const face = run.line - OUT[run.side] * inset
      const dist = Math.abs((run.horizontal ? z : x) - face)
      if (dist < maxDist && (!best || dist < best.dist))
        best = run.horizontal ? { x: a, z: face, rot: ROT[run.side], dist } : { x: face, z: a, rot: ROT[run.side], dist }
    }
  }
  return best as { x: number; z: number; rot: number; dist: number } | null
}

/**
 * Whether an item that sticks to walls stands against one, exactly where wallSnap puts it (a kitchen counter in an island
 * does not; rules.ts > FREESTANDING).
 */
export function backOnWall(rooms: Room[], it: Pick<Item, 'kind' | 'x' | 'z' | 'rot' | 'len'>, extra: WallRun[] = []) {
  const w = wallSnap(rooms, it.x, it.z, CATALOG[it.kind].size[1], 0.05, sizeOf(it.kind, it.len)[0], false, false, undefined, extra)
  if (!w) return false
  const d = w.rot - it.rot
  return Math.hypot(w.x - it.x, w.z - it.z) < 0.03 && Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.01
}

/**
 * Inner length of the wall of the room that a wall item at (x, z) facing rot hangs on (between the side walls); null when
 * it hangs on none. An LED strip cannot be made longer than its wall.
 */
export function wallLengthAt(room: Room, x: number, z: number, rot: number) {
  for (const run of wallRuns(room, [], 'edges')) {
    const d = rot - WALL_ROT[run.side]
    if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > 0.01) continue
    const along = run.horizontal ? x : z
    const perp = run.horizontal ? z : x
    if (along < run.a0 || along > run.a1 || Math.abs(perp - run.line) > 0.5) continue
    return run.a1 - run.a0 - 2 * WALL_IN
  }
  return null
}

/**
 * Save version 3 migration: when walls were centered on the boundary, the inner face moved 5 cm toward the wall. Wall
 * items stuck to the old inner face (wallSnap or the automatic plan) move toward the wall by the same amount so they do
 * not float, and items stuck to a corner also toward the side wall. Only items at the old sticking distance (±1.2 cm);
 * doors and windows do not change.
 */
export function settleWallItems(level: Level): Item[] {
  const shift = WALL_T - WALL_IN
  const same = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.01
  return level.items.map((it) => {
    const meta = CATALOG[it.kind]
    if (!meta?.wall || isAperture(it.kind)) return it
    const room = roomAt(level.rooms, it.x, it.z)
    if (!room) return it
    const depth = meta.size[1]
    const half = Math.max(sizeOf(it.kind, it.len)[0] / 2, 0.2)
    for (const run of wallRuns(room, [], 'edges')) {
      if (!same(it.rot, WALL_ROT[run.side])) continue
      const perp = run.horizontal ? it.z : it.x
      const along = run.horizontal ? it.x : it.z
      if (along < run.a0 - 0.05 || along > run.a1 + 0.05) continue
      const dist = Math.abs(perp - run.line)
      if (Math.abs(dist - (WALL_T + depth / 2 + 0.01)) > 0.012 && Math.abs(dist - (WALL_T + depth / 2 + 0.02)) > 0.012) continue
      let a = along
      if (Math.abs(along - (run.a0 + WALL_T + half)) < 0.012) a -= shift
      else if (Math.abs(along - (run.a1 - WALL_T - half)) < 0.012) a += shift
      const p = perp + OUT[run.side] * shift
      return run.horizontal ? { ...it, x: a, z: p } : { ...it, x: p, z: a }
    }
    return it
  })
}

/* ---------- door and window openings ---------- */

export interface Opening {
  /** Start and end along the wall in world coordinates (x on a horizontal wall, z on a vertical one) */
  a0: number
  a1: number
  /** Bottom and top height of the opening */
  y0: number
  y1: number
}

const APERTURE: Record<string, { half: number; y0: number; y1: number }> = {
  door: { half: 0.5, y0: 0, y1: 2.23 },
  window: { half: 0.58, y0: 0.9, y1: 2.1 },
  // Garage door: 2.25 m high, 2.4 m wide unless its card says otherwise (Item.len; kit/outdoor.tsx > GarageDoor)
  garageDoor: { half: 1.2, y0: 0, y1: 2.25 },
}

/** Items that cut an opening in the wall: positioned relative to the room boundary, not the inner face (APERTURE_INSET). */
export const isAperture = (kind: string) => kind === 'door' || kind === 'window' || kind === 'garageDoor'

/**
 * Wall line a door/window sits in. The item stands at the wall's inner face with its front (local +z) facing the room;
 * the wall line (room edge) is APERTURE_INSET behind the item. null when not axis-aligned (e.g. rotated by 15°).
 */
export function apertureOf(it: Item) {
  const base = APERTURE[it.kind]
  if (!base) return null
  // A window can be raised or lowered (Item.y offset) and resized (width len, height len2): the hole in the wall follows
  // its size and position. A door is always on the floor.
  const win = it.kind === 'window'
  const dy = win ? (it.y ?? 0) : 0
  const { w, h } = windowSize(it)
  // A sliding glass door is as wide as its card says (Item.len); a hinged door is always 1 m. A wall opening has its own
  // width and height (Item.len2, up to the ceiling: then no wall is left above it).
  const spec = win
    ? { half: w / 2 - 0.02, y0: WINDOW_BOTTOM + dy, y1: WINDOW_BOTTOM + h + dy }
    : isSlidingDoor(it)
      ? { ...base, half: (it.len ?? SLIDING_DOOR.def) / 2 }
      : isWallOpening(it)
        ? { half: (it.len ?? WALL_OPENING.def) / 2, y0: 0, y1: Math.min(WALL_H, it.len2 ?? OPENING_DOOR_H) }
        : it.kind === 'garageDoor'
          ? { ...base, half: garageDoorWidth(it) / 2 }
          : base
  const fx = Math.sin(it.rot)
  const fz = Math.cos(it.rot)
  if (Math.abs(Math.abs(fz) - 1) < 0.01) return { horizontal: true, line: it.z - Math.sign(fz) * APERTURE_INSET, along: it.x, ...spec }
  if (Math.abs(Math.abs(fx) - 1) < 0.01) return { horizontal: false, line: it.x - Math.sign(fx) * APERTURE_INSET, along: it.z, ...spec }
  return null
}

/** Indoor wall runs an opening (door, window, doorless opening) sits in: one per room the wall belongs to. */
function openingRuns(item: Item, rooms: Room[]): WallRun[] {
  const a = apertureOf(item)
  if (!a) return []
  const on = (r: WallRun) => r.horizontal === a.horizontal && Math.abs(r.line - a.line) <= 0.08 && a.along >= r.a0 && a.along <= r.a1
  return rooms.filter((room) => !isOutdoor(room)).flatMap((room) => wallRuns(room, rooms).filter(on))
}

/** The indoor wall run an opening sits in. */
export const openingWallRun = (item: Item, rooms: Room[]): WallRun | undefined => openingRuns(item, rooms)[0]

/** Whether an opening is in a half-height wall. */
export const openingOnHalfWall = (item: Item, rooms: Room[]) => openingRuns(item, rooms).some((r) => r.half)

/** The widest an opening can be in its wall (its ends stay clear of the corners), rounded down to 5 cm. */
export function openingMaxWidth(item: Item, rooms: Room[]): number | undefined {
  const run = openingWallRun(item, rooms)
  if (!run) return undefined
  return Math.max(0, Math.floor((run.a1 - run.a0 - 2 * WALL_IN + 1e-6) * 20) / 20)
}

/** Openings in a wall run. A door in the neighbor room cuts the shared wall too. */
export function runOpenings(run: WallRun, items: Item[]): Opening[] {
  const out: Opening[] = []
  for (const it of items) {
    const a = apertureOf(it)
    if (!a || a.horizontal !== run.horizontal || Math.abs(a.line - run.line) > 0.08) continue
    if (a.along < run.a0 || a.along > run.a1) continue
    out.push({ a0: a.along - a.half, a1: a.along + a.half, y0: a.y0, y1: a.y1 })
  }
  return out
}

/** Rooms on both sides of a door: in front (where the item is) and behind (empty space if none). Exterior door test: exteriorSide. */
export function doorSides(it: Item, rooms: Room[]) {
  const a = apertureOf(it)
  if (!a) return { front: roomAt(rooms, it.x, it.z), back: undefined }
  const fx = Math.sin(it.rot)
  const fz = Math.cos(it.rot)
  const bx = it.x - fx * (APERTURE_INSET + 0.3)
  const bz = it.z - fz * (APERTURE_INSET + 0.3)
  return { front: roomAt(rooms, it.x, it.z), back: roomAt(rooms, bx, bz) }
}

/**
 * Whether this is an exterior door of the house (or a window facing outside): one side is an indoor room, the other
 * empty space or an outdoor room (porch, terrace, garden). Returns the inside's side: 1 the front (the item's room), -1
 * the back (door placed from outside, from the porch); 0 when not an exterior door. Outdoor rooms count as outside, so a
 * house with a porch or garden in front of the door (the American sample house) still has a front door: walk mode starts
 * there and arriving people come in through it.
 */
export function exteriorSide(it: Item, rooms: Room[]): -1 | 0 | 1 {
  const { front, back } = doorSides(it, rooms)
  const inFront = Boolean(front && !isOutdoor(front))
  const inBack = Boolean(back && !isOutdoor(back))
  return inFront === inBack ? 0 : inFront ? 1 : -1
}

/**
 * The plan's (first) exterior door and the inside's side: walk mode starts here, arriving people enter here, people away
 * wait in front of it. A hinged door comes first: a sliding glass door is usually the patio door, not the front door, and a
 * doorless wall opening counts only when there is no door at all.
 */
export function frontDoor(items: Item[], rooms: Room[], stairwell = false) {
  // In a flat (apartment mode, model/apartment.ts) the entrance opens onto the stairwell: a door with nothing behind it
  // comes before a door to the balcony
  if (stairwell)
    for (const it of items) {
      const side = it.kind === 'door' && !isSlidingDoor(it) && !isWallOpening(it) ? exteriorSide(it, rooms) : 0
      if (!side) continue
      const { front, back } = doorSides(it, rooms)
      if (!(side > 0 ? back : front)) return { door: it, side }
    }
  // Hinged doors first, then sliding glass doors; a doorless wall opening only when the house has no real door
  const rank = (it: Item) => (isWallOpening(it) ? 2 : isSlidingDoor(it) ? 1 : 0)
  for (const pass of [0, 1, 2])
    for (const it of items) {
      const side = it.kind === 'door' && rank(it) === pass ? exteriorSide(it, rooms) : 0
      if (side) return { door: it, side }
    }
  return null
}

/** Point dist (m) away from the door's wall line; side 1 in front (the item's room), -1 behind. */
export function besideDoor(it: Item, side: number, dist: number) {
  const k = side * dist - APERTURE_INSET
  return { x: it.x + Math.sin(it.rot) * k, z: it.z + Math.cos(it.rot) * k }
}

/* ---------- ceiling strip ---------- */

/** Ceiling strip fitted to the room part under the point: the part's center, sizes 15 cm inside the walls. */
export function ceilingFit(rooms: Room[], x: number, z: number) {
  for (const room of rooms)
    for (const r of rectsOf(room))
      if (inRect(r, x, z)) return { x: r.x + r.w / 2, z: r.z + r.d / 2, len: Math.max(0.6, r.w - 0.3), len2: Math.max(0.6, r.d - 0.3) }
  return null
}

/* ---------- what goes with a removed area ---------- */


/**
 * A point just behind a wall light, inside the room whose wall it hangs on. A light on the outside of a house wall stands
 * outside every room; it belongs to that room (rules.ts > checkItem), moves with it and goes when it is deleted.
 */
export function behindWall(it: { x: number; z: number; rot: number }) {
  const back = WALL_IN + CATALOG.wallLight.size[1] / 2 + 0.06
  return { x: it.x - Math.sin(it.rot) * back, z: it.z - Math.cos(it.rot) * back }
}

/** Whether an item is in the room: inside it, or a light on the outside of its wall (behindWall). */
export function ownsItem(room: Room, it: Item, rooms: Room[]) {
  if (inRoom(room, it.x, it.z)) return true
  if (it.kind !== 'wallLight' || roomAt(rooms, it.x, it.z)) return false
  const b = behindWall(it)
  return inRoom(room, b.x, b.z)
}
/**
 * Items deleted together with a room or room part: those inside the area (not belonging to a remaining room) and doors
 * from a neighbor room that open into this area. area: the removed rectangles; keep: the rooms left after deleting.
 */
export function areaContents(items: Item[], area: Rect[], keep: Room[]): Item[] {
  const inArea = (x: number, z: number) => area.some((r) => inRect(r, x, z)) && !roomAt(keep, x, z)
  return items.filter((it) => {
    if (inArea(it.x, it.z)) return true
    // A light on the outside of a house wall (outside every room) goes with the room behind the wall
    if (it.kind === 'wallLight' && !roomAt(keep, it.x, it.z)) {
      const b = behindWall(it)
      return inArea(b.x, b.z)
    }
    if (it.kind !== 'door' || !apertureOf(it)) return false
    // If the door's back (other side) is in the removed area it now opens into nothing: it goes too.
    const bx = it.x - Math.sin(it.rot) * (APERTURE_INSET + 0.3)
    const bz = it.z - Math.cos(it.rot) * (APERTURE_INSET + 0.3)
    return inArea(bx, bz)
  })
}
