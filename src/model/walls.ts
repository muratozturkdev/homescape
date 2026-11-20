import { CATALOG, isWallOpening } from './catalog'
import { apertureOf, HALF_WALL_H, isAperture, isOutdoor, isStreetSurface, wallKey, wallRuns, type Side, type WallRun } from './geometry'
import { isWallMounted, wallSpan } from './rules'
import type { Item, Level, Room } from './types'

/*
 * Walls left out (open plan, a passage without a door, a porch open to the garden). Home Assistant areas are functional
 * zones, not always rooms with walls: an open kitchen and living room stay two rooms (own name, area, floor and stats)
 * with no wall in between. A wall is named from one room by its key (geometry.ts > wallKey): the neighbor room's id or
 * the side facing open space. Room.open lists the walls left out; the wall between two rooms opens for both when either
 * room lists the other, so it stays open when one of them is moved, resized or rotated next to the other again.
 * Room.half lists half walls (HALF_WALL_H, a low divider) the same way; a wall in both lists is open.
 */

/** A wall standing (full height), half height or left out */
export type WallState = 'wall' | 'half' | 'open'

export interface RoomWall {
  key: string
  /** The room on the other side; none for an edge facing open space */
  neighbor?: Room
  /** Side of the room the wall is on (of its longest run) */
  side: Side
  /** Length along the room (m) */
  length: number
  state: WallState
  /** state === 'open' */
  open: boolean
}

/** Whether the room has walls or railings that can be left out (not a garden or a street surface). */
export const hasWalls = (room: Room) => room.type !== 'garden' && !isStreetSurface(room)

const SIDES: Side[] = ['back', 'right', 'front', 'left']

/** The room's walls, standing and left out, one entry per key; for a balcony or terrace its railing edges. */
export function roomWalls(room: Room, rooms: Room[]): RoomWall[] {
  if (!hasWalls(room)) return []
  const out = new Map<string, RoomWall & { longest: number }>()
  const add = (runs: WallRun[], open: boolean) => {
    for (const r of runs) {
      const key = wallKey(r)
      const len = r.a1 - r.a0
      const state: WallState = open ? 'open' : r.half ? 'half' : 'wall'
      const w = out.get(key) ?? { key, neighbor: r.neighbor ? rooms.find((o) => o.id === r.neighbor) : undefined, side: r.side, length: 0, state, open, longest: 0 }
      w.length += len
      if (len > w.longest) {
        w.longest = len
        w.side = r.side
      }
      out.set(key, w)
    }
  }
  add(wallRuns(room, rooms, 'walls', true), false)
  add(wallRuns(room, rooms, 'open', true), true)
  // Rooms first (by name), then the edges facing open space clockwise from the back
  return [...out.values()]
    .map(({ key, neighbor, side, length, state, open }) => ({ key, neighbor, side, length, state, open }))
    .sort((a, b) => (a.neighbor && b.neighbor ? a.neighbor.name.localeCompare(b.neighbor.name) : a.neighbor ? -1 : b.neighbor ? 1 : SIDES.indexOf(a.side) - SIDES.indexOf(b.side)))
}

/** Whether the item is in the wall run or hangs on it (on either side): a door, a window, a wall light, a wall TV... */
function onRun(it: Item, r: WallRun) {
  if (isAperture(it.kind)) {
    const a = apertureOf(it)
    return Boolean(a && a.horizontal === r.horizontal && Math.abs(a.line - r.line) <= 0.08 && a.along >= r.a0 && a.along <= r.a1)
  }
  if (!isWallMounted(it.kind, it.variant, it.mount)) return false
  // A wall item faces straight out of its wall and stands its half depth in front of it
  const face = r.horizontal ? Math.cos(it.rot) : Math.sin(it.rot)
  if (Math.abs(Math.abs(face) - 1) > 0.01) return false
  const perp = r.horizontal ? it.z : it.x
  const along = r.horizontal ? it.x : it.z
  return Math.abs(perp - r.line) < CATALOG[it.kind].size[1] / 2 + 0.15 && along >= r.a0 - 0.05 && along <= r.a1 + 0.05
}

/** Whether the item still fits on a half wall: a doorless opening, or a wall-mounted item whose top is below the wall's top (a plug, a strip). */
const fitsHalf = (it: Item) => isWallOpening(it) || (!isAperture(it.kind) && wallSpan(it)[1] <= HALF_WALL_H - 0.02)

/**
 * Items that go when a wall changes to `to`: left out, the doors and windows in it and every item hanging on it; made a
 * half wall, the doors and windows and the hanging items that do not fit under its top. Floor items always stay.
 */
export function wallItems(level: Level, room: Room, key: string, to: WallState = 'open'): Item[] {
  if (to === 'wall') return []
  const runs = wallRuns(room, level.rooms, 'walls', true).filter((r) => wallKey(r) === key)
  return runs.length ? level.items.filter((it) => runs.some((r) => onRun(it, r)) && !(to === 'half' && fitsHalf(it))) : []
}

/** The room with these open and half wall lists (empty lists are left out) */
const withLists = (room: Room, open: string[], half: string[]): Room => {
  const { open: _o, half: _h, ...rest } = room
  return { ...rest, ...(open.length ? { open: [...new Set(open)] } : {}), ...(half.length ? { half: [...new Set(half)] } : {}) }
}

/**
 * The level with walls of the room set to a state: standing, half or left out. The items that no longer fit go with it
 * (wallItems). The wall between two rooms is kept in this room's lists only: the neighbor's entry for it is cleared.
 */
export function withWalls(level: Level, roomId: string, keys: string[], state: WallState): Level {
  const room = level.rooms.find((r) => r.id === roomId)
  if (!room || !keys.length) return level
  const gone = new Set(keys.flatMap((k) => wallItems(level, room, k, state)).map((it) => it.id))
  const set = new Set(keys)
  const rooms = level.rooms.map((r) => {
    if (r.id === roomId) {
      const open = (r.open ?? []).filter((k) => !set.has(k))
      const half = (r.half ?? []).filter((k) => !set.has(k))
      if (state === 'open') open.push(...keys)
      if (state === 'half') half.push(...keys)
      return withLists(r, open, half)
    }
    if (set.has(r.id) && (r.open?.includes(roomId) || r.half?.includes(roomId)))
      return withLists(r, (r.open ?? []).filter((k) => k !== roomId), (r.half ?? []).filter((k) => k !== roomId))
    return r
  })
  return { ...level, rooms, items: gone.size ? level.items.filter((it) => !gone.has(it.id)) : level.items }
}

/** Sides after turning the room 90° (dir 1 clockwise seen from above, ui/rotateRoom.ts); room ids stay. */
const CW: Record<Side, Side> = { back: 'right', right: 'front', front: 'left', left: 'back' }
const CCW: Record<Side, Side> = { right: 'back', front: 'right', left: 'front', back: 'left' }
export const turnOpen = (open: string[], dir: 1 | -1) => open.map((k) => (isSide(k) ? (dir > 0 ? CW : CCW)[k] : k))
/** Whether a Room.open entry is a side facing open space (else it is a neighbor room's id) */
export const isSide = (k: string): k is Side => k in CW

/** Indoor rooms joined to this one by an open or a half wall: a lamp lights them too (scene/roomLights.ts). */
export function openNeighbors(room: Room, rooms: Room[]): Room[] {
  if (isOutdoor(room)) return []
  const joins = [...wallRuns(room, rooms, 'open', true), ...wallRuns(room, rooms, 'walls', true).filter((r) => r.half)]
  const ids = new Set(joins.flatMap((r) => (r.neighbor ? [r.neighbor] : [])))
  return rooms.filter((r) => ids.has(r.id) && !isOutdoor(r))
}
