import { create } from 'zustand'
import { APERTURE_INSET, besideDoor, frontDoor, inRoom, isOutdoor, rectsOf, runOpenings, WALL_IN, wallRuns } from '@/model/geometry'
import { FLOOR_H } from '@/model/layoutStore'
import { footprints, layerOf, type Box2 } from '@/model/rules'
import type { Item, Level } from '@/model/types'

/*
 * First person walk mode: walk through the home at eye level and control everything, like in a game. Pure helpers:
 * collision geometry (walls, railings, large items), stair height, start point; and the state shared between the scene
 * and the HUD (aimed item, pointer lock, touch input).
 */

/** Eye height (m) and the person's radius (collisions). */
export const EYE = 1.62
export const RADIUS = 0.24
/** Walking and running speed (m/s). */
export const WALK = 2.1
export const RUN = 4

/** Name of the active floor's scene group (Scene > Levels; aiming in walk mode only looks at it) */
export const ACTIVE_LEVEL = 'level-active'

/** Wall piece: the segment (x1, z1)-(x2, z2) and half its thickness. */
export interface Seg {
  x1: number
  z1: number
  x2: number
  z2: number
  half: number
}

/**
 * Floor items you can walk through: rugs, stairs (you climb them), roaming and very small items; flat items on the road
 * (manhole, speed bump, stepping stones); cats and dogs (the item position is only their home, the animal roams:
 * scene/Pets.tsx).
 */
const WALKABLE: string[] = ['rug', 'doormat', 'stairs', 'robotVacuum', 'lawnMower', 'leakSensor', 'sprinkler', 'door', 'window', 'garageDoor', 'stringLights', 'parasol', 'gardenLight', 'plant', 'steppingStones', 'manhole', 'speedBump', 'cat', 'dog', 'petToy']

/**
 * Collision geometry of a floor: walls of indoor rooms (door openings are gaps), balcony and terrace railings, footprints
 * of large floor items. The garden edge is open.
 */
export function buildColliders(level: Level, rails: { a: { x: number; z: number }; b: { x: number; z: number } }[] = []): { segs: Seg[]; boxes: Box2[] } {
  // Railings around the stairwell on the upper floor (model/stairwell.ts): you cannot fall in from the side, you go down at the arrival end
  const segs: Seg[] = rails.map(({ a, b }) => ({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, half: 0.05 }))
  for (const room of level.rooms) {
    const kind = room.type ?? 'room'
    if (kind === 'garden') continue
    for (const run of wallRuns(room, level.rooms)) {
      const rail = isOutdoor(room)
      // Openings that start at the floor (door, garage door; not full-height windows: window y0 > 0) are passages
      const gaps = rail ? [] : runOpenings(run, level.items).filter((o) => o.y0 < 0.1).sort((a, b) => a.a0 - b.a0)
      let a = run.a0 - (rail ? 0 : WALL_IN)
      const end = run.a1 + (rail ? 0 : WALL_IN)
      const push = (s: number, e: number) => {
        if (e - s < 0.01) return
        segs.push(run.horizontal ? { x1: s, z1: run.line, x2: e, z2: run.line, half: rail ? 0.03 : WALL_IN } : { x1: run.line, z1: s, x2: run.line, z2: e, half: rail ? 0.03 : WALL_IN })
      }
      for (const g of gaps) {
        push(a, g.a0)
        a = Math.max(a, g.a1)
      }
      push(a, end)
    }
  }
  const boxes: Box2[] = []
  for (const it of level.items) {
    if (WALKABLE.includes(it.kind)) continue
    if (layerOf(it.kind, it.y, it.variant, it.mount) !== 'floor') continue
    for (const b of footprints({ kind: it.kind, x: it.x, z: it.z, rot: it.rot, len: it.len, len2: it.len2, variant: it.variant, mount: it.mount }, 0.04)) {
      // Very thin poles and small items are not obstacles (lamp stand, sensor)
      if (Math.min(b.maxX - b.minX, b.maxZ - b.minZ) < 0.18) continue
      boxes.push(b)
    }
  }
  return { segs, boxes }
}

/** Position of the circle (the person) pushed out of walls and boxes. Several passes: in corners it can touch two walls at once. */
export function resolve(x: number, z: number, segs: Seg[], boxes: Box2[], r = RADIUS): [number, number] {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false
    for (const s of segs) {
      const dx = s.x2 - s.x1
      const dz = s.z2 - s.z1
      const len2 = dx * dx + dz * dz || 1e-9
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / len2))
      const cx = s.x1 + dx * t
      const cz = s.z1 + dz * t
      const ox = x - cx
      const oz = z - cz
      const d = Math.hypot(ox, oz)
      const min = r + s.half
      if (d < min) {
        const nx = d > 1e-6 ? ox / d : -dz / Math.sqrt(len2)
        const nz = d > 1e-6 ? oz / d : dx / Math.sqrt(len2)
        x = cx + nx * min
        z = cz + nz * min
        moved = true
      }
    }
    for (const b of boxes) {
      const cx = Math.max(b.minX, Math.min(b.maxX, x))
      const cz = Math.max(b.minZ, Math.min(b.maxZ, z))
      const ox = x - cx
      const oz = z - cz
      const d = Math.hypot(ox, oz)
      if (d >= r) continue
      if (d > 1e-6) {
        x = cx + (ox / d) * r
        z = cz + (oz / d) * r
      } else {
        // Inside the box: out through the nearest edge
        const exits: [number, number, number][] = [
          [x - b.minX, b.minX - r, z],
          [b.maxX - x, b.maxX + r, z],
          [z - b.minZ, x, b.minZ - r],
          [b.maxZ - z, x, b.maxZ + r],
        ]
        exits.sort((p, q) => p[0] - q[0])
        x = exits[0][1]
        z = exits[0][2]
      }
      moved = true
    }
    if (!moved) break
  }
  return [x, z]
}

/**
 * Foot height on stairs (m, from the floor of the level): the stairs start at the local +z end and reach the floor height
 * at the -z end (kit/outdoor.tsx > Stairs). null outside the stairs.
 */
export function stairHeight(it: Item, x: number, z: number): number | null {
  const c = Math.cos(it.rot)
  const s = Math.sin(it.rot)
  const dx = x - it.x
  const dz = z - it.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  if (Math.abs(lx) > 0.55 || Math.abs(lz) > 1.65) return null
  return Math.max(0, Math.min(1, (1.6 - lz) / 3.2)) * FLOOR_H
}

/**
 * Start point: the selected room or the inner side of the front door (even when a porch or garden is in front of it:
 * geometry.ts > frontDoor), else the center of the first indoor room; looking towards the room center.
 */
export function spawnPoint(level: Level, roomId?: string | null): { x: number; z: number; yaw: number } {
  const center = (id?: string | null) => {
    const r = level.rooms.find((q) => q.id === id) ?? level.rooms.find((q) => !isOutdoor(q)) ?? level.rooms[0]
    if (!r) return { x: 0, z: 0 }
    const big = rectsOf(r).reduce((a, b) => (b.w * b.d > a.w * a.d ? b : a))
    return { x: big.x + big.w / 2, z: big.z + big.d / 2 }
  }
  if (roomId) {
    const c = center(roomId)
    return { ...c, yaw: 0 }
  }
  const front = frontDoor(level.items, level.rooms)
  if (front) {
    // 81 cm inside the wall, looking in through the door (view -sin(yaw), -cos(yaw)). The inside is usually in front of
    // the door (local +z); behind it when the door was placed from outside (from the porch).
    const { door, side } = front
    return { ...besideDoor(door, side, APERTURE_INSET + 0.6), yaw: door.rot + (side > 0 ? Math.PI : 0) }
  }
  return { ...center(null), yaw: 0 }
}

/** Which indoor room the point is in (for the rooms that get a ceiling). */
export const indoorAt = (level: Level, x: number, z: number) => level.rooms.find((r) => !isOutdoor(r) && inRoom(r, x, z))

/* ---------- shared state ---------- */

export interface Aim {
  itemId: string
  name: string
  state: string
  /** Whether it supports a quick on/off toggle */
  toggle: boolean
}

interface FpsState {
  /** Linked item under the crosshair */
  aim: Aim | null
  /** Whether the pointer is locked (desktop: a click locks it, Esc releases it) */
  locked: boolean
  /** Whether the person is indoors (the eye adapts to less light inside: Scene > Lights ambient light) */
  indoor: boolean
  setAim: (a: Aim | null) => void
  setLocked: (on: boolean) => void
  setIndoor: (on: boolean) => void
}

export const useFps = create<FpsState>((set, get) => ({
  aim: null,
  locked: false,
  indoor: true,
  setIndoor: (indoor) => {
    if (get().indoor !== indoor) set({ indoor })
  },
  setAim: (aim) => {
    const p = get().aim
    if (p?.itemId === aim?.itemId && p?.state === aim?.state && p?.name === aim?.name && p?.toggle === aim?.toggle) return
    set({ aim })
  },
  setLocked: (locked) => set({ locked }),
}))

/** Touch input (virtual joystick and look drag): the HUD writes it, the scene reads it every frame. */
export const touchInput = { fwd: 0, side: 0, lookX: 0, lookY: 0, run: false }
