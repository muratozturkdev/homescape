import { t } from '@/i18n'
import { CATALOG, sizeOf, WINDOW_BOTTOM, windowSize } from './catalog'
import { inRoom, rectsOf, roomAt, WALL_H, WALL_IN } from './geometry'
import type { Item, ItemKind, Level, Rect, Room } from './types'

/*
 * Placement rules (like in a game): an item can only be dropped at a valid spot.
 * - It must be inside a room, with its footprint not sticking out of the room.
 * - Wall items must sit on a wall.
 * - It must not overlap items in the same layer (floor-floor, wall-wall, ceiling-ceiling).
 * - Small items can go on surfaces like desks, coffee tables and TV units (stacking).
 * - Rooms cannot overlap; edges stick together when they come close (magnet).
 */

export type Layer = 'floor' | 'wall' | 'ceiling' | 'rug' | 'top'

/**
 * Wall-mounted items: their height is adjustable (Item.y = offset up/down from the default; for an LED strip the strip's
 * height above the floor). Items standing on the floor against a wall (cabinet, counter, fridge) are not in this list.
 */
export const WALL_MOUNTED: ItemKind[] = ['wallLight', 'ledStrip', 'mirrorLight', 'acUnit', 'camera', 'motionSensor', 'tempSensor', 'alarmPanel', 'wallSwitch', 'plug', 'window', 'painting', 'pegboard', 'mirror', 'mirrorCabinet', 'wallFan', 'thermostat', 'waterHeater', 'boiler', 'towelWarmer', 'projectorScreen', 'wallPanel', 'doorbell', 'siren', 'powerMeter', 'waterValve', 'awning', 'evCharger', 'toolWall']

/**
 * Items that can optionally hang on a wall (Item.mount 'wall', e.g. a power strip). While hung they behave like wall
 * items (wall layer, stick to the wall, adjustable height).
 */
export const MOUNTABLE: ItemKind[] = ['powerStrip']

/** Default for items without a height: the LED strip is drawn from the strip itself (others 0: at their own height). */
export const DEFAULT_MOUNT_Y: Partial<Record<ItemKind, number>> = { ledStrip: 2.45 }

/**
 * Vertical range of wall-mounted items (m): bottom and top edge above the floor at height offset 0 (relative to the strip
 * for an LED strip). Measured from the selection box. Two wall items only collide when they overlap both along the wall
 * and in this range: a painting can hang above a plug or a switch.
 */
const WALL_SPAN: Record<string, [number, number]> = {
  wallLight: [1.85, 2.09],
  ledStrip: [-0.02, 0.02],
  mirrorLight: [1.02, 1.94],
  acUnit: [2.03, 2.33],
  camera: [2.17, 2.34],
  motionSensor: [2.21, 2.29],
  tempSensor: [1.355, 1.445],
  alarmPanel: [1.31, 1.59],
  wallSwitch: [1.15, 1.25],
  plug: [0.255, 0.385],
  window: [0.87, 2.2],
  painting: [1.25, 1.85],
  pegboard: [1.02, 1.58],
  'mirror:tall': [0.25, 1.87],
  'mirror:small': [1.267, 1.833],
  mirrorCabinet: [1.137, 1.85],
  wallFan: [1.853, 2.264],
  'tv:wall': [0.89, 1.71],
  // Power strip on the wall: body vertical, its center 30 cm above the floor (devices.tsx > PowerStrip, STRIP_WALL_Y)
  powerStrip: [0.2625, 0.3375],
  // Smart home devices (kit/smart.tsx; projector screen rolled up)
  thermostat: [1.4, 1.5],
  waterHeater: [1.185, 2.1],
  boiler: [1.0, 1.92],
  towelWarmer: [0.585, 1.415],
  projectorScreen: [2.385, 2.49],
  wallPanel: [1.3, 1.52],
  doorbell: [1.3, 1.45],
  siren: [2.1, 2.345],
  powerMeter: [1.5, 1.9],
  waterValve: [0.3, 0.6],
  // Outdoor and garage (kit/outdoor.tsx)
  awning: [2.2, 2.49],
  evCharger: [0.9, 1.5],
  toolWall: [1.1, 1.9],
}
function spanOf(kind: ItemKind, variant?: string, len2?: number): [number, number] {
  // Window: bottom edge 0.9 (sill 3 cm below), curtain rail 10 cm on top; height Item.len2
  if (kind === 'window') return [WINDOW_BOTTOM - 0.03, WINDOW_BOTTOM + windowSize({ len2 }).h + 0.1]
  return WALL_SPAN[kind === 'mirror' ? `mirror:${variant ?? 'tall'}` : kind === 'tv' ? 'tv:wall' : kind] ?? [0, WALL_H]
}

/** Whether the item hangs on a wall (wall TV and wall-mounted power strip included): its height is adjustable. */
export const isWallMounted = (kind: ItemKind, variant?: string, mount?: Item['mount']) =>
  WALL_MOUNTED.includes(kind) || (kind === 'tv' && variant === 'wall') || (mount === 'wall' && MOUNTABLE.includes(kind))

/** Whether it sticks to the nearest wall while dragged: a wall item in the catalog or hung on the wall. */
export const snapsToWall = (kind: ItemKind, mount?: Item['mount']) => Boolean(CATALOG[kind].wall) || (mount === 'wall' && MOUNTABLE.includes(kind))

/** Current vertical range of a wall-mounted item, above the floor (m). */
export function wallSpan(s: { kind: ItemKind; variant?: string; y?: number; len2?: number }): [number, number] {
  const [a, b] = spanOf(s.kind, s.variant, s.len2)
  const base = s.y ?? DEFAULT_MOUNT_Y[s.kind] ?? 0
  return [a + base, b + base]
}

/** Height (Item.y) limits: the item stays within the wall, 2 cm from the floor and the ceiling. */
export function mountRange(kind: ItemKind, variant?: string, len2?: number) {
  const [a, b] = spanOf(kind, variant, len2)
  return { min: Math.round((0.02 - a) * 100) / 100, max: Math.round((WALL_H - 0.02 - b) * 100) / 100 }
}

/** Top height of the surface (m): furniture that small items can be put on. */
export const SURFACE_Y: Partial<Record<ItemKind, number>> = {
  desk: 0.75,
  diningTable: 0.78,
  coffeeTable: 0.44,
  roundTable: 0.47,
  tvUnit: 0.5,
  nightstand: 0.48,
  kitchenCounter: 0.91,
  shoeCabinet: 0.9,
  drawerUnit: 0.72,
  dresser: 0.81,
  washbasin: 0.8,
  sink: 0.91,
  washer: 0.86,
  dryer: 0.86,
  dishwasher: 0.86,
  workbench: 0.9,
  storageRack: 0.42,
}

/** Small items that can be stacked on a surface. */
export const STACKABLE: ItemKind[] = ['monitor', 'deskLamp', 'console', 'vibrationSensor', 'diffuser', 'keyboard', 'mouse', 'mousePad', 'monitorV', 'deskPlant', 'deskPalm', 'fishbowl', 'soapDispenser', 'deskFan', 'powerStrip', 'homepod', 'deskCamera', 'tableLamp', 'humidifier', 'speaker', 'soundbar', 'computer', 'airQuality', 'smartButton', 'router', 'nas', 'printer', 'coffeeMachine', 'kettle', 'microwave', 'airFryer']

/** Items that only go on a surface (desk, coffee table, cabinet, washbasin): pointless on the floor. */
export const DESK_ONLY: ItemKind[] = ['keyboard', 'mouse', 'mousePad', 'monitorV', 'deskPlant', 'deskPalm', 'fishbowl', 'soapDispenser', 'deskFan', 'tableLamp', 'coffeeMachine', 'kettle', 'microwave', 'airFryer', 'smartButton']

/** Appliances that stack (a dryer on a washing machine): only on each other. */
export const APPLIANCE_STACK: ItemKind[] = ['washer', 'dryer', 'dishwasher']

/**
 * Chairs can tuck under tables and desks, a drawer unit under a desk. A power strip on the floor can go under a table or a
 * coffee table (partly under it is no collision).
 */
const TUCKS: Partial<Record<ItemKind, ItemKind[]>> = { chair: ['diningTable', 'desk'], gamingChair: ['desk', 'diningTable'], drawerUnit: ['desk'], powerStrip: ['desk', 'diningTable', 'coffeeTable', 'roundTable'] }

/**
 * Ceiling items (ceiling layer: no collision with floor and wall items). The pergola / gazebo is in this layer too, like a
 * roof: a garden table, bench or sun lounger goes under it.
 */
export const CEILING: ItemKind[] = ['pendant', 'downlight', 'ceilingStrip', 'ceilingFan', 'ceilingLight', 'trackLight', 'projector', 'smokeDetector', 'pergola']

export function layerOf(kind: ItemKind, y?: number, variant?: string, mount?: Item['mount']): Layer {
  if (kind === 'rug' || kind === 'doormat') return 'rug'
  if (mount === 'wall' && MOUNTABLE.includes(kind)) return 'wall'
  // A wall TV is in the wall layer: no collision with the unit below or the console/lamp on it.
  if (kind === 'tv' && variant === 'wall') return 'wall'
  if (CEILING.includes(kind)) return 'ceiling'
  if (WALL_MOUNTED.includes(kind)) return 'wall'
  if (y != null && y > 0.05) return 'top'
  return 'floor'
}

export interface Box2 {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Axis-aligned box of the rotated footprint. */
export function footprint(kind: ItemKind, x: number, z: number, rot: number, shrink = 0, len?: number, len2?: number): Box2 {
  const [w, d] = sizeOf(kind, len, len2)
  const c = Math.abs(Math.cos(rot))
  const s = Math.abs(Math.sin(rot))
  const hw = (w * c + d * s) / 2 - shrink
  const hd = (w * s + d * c) / 2 - shrink
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd }
}

const overlap = (a: Box2, b: Box2) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
const anyOverlap = (as: Box2[], bs: Box2[]) => as.some((a) => bs.some((b) => overlap(a, b)))
const T = 0.02
const wallOverlap = (as: Box2[], bs: Box2[]) => as.some((a) => bs.some((b) => a.minX < b.maxX - T && a.maxX > b.minX + T && a.minZ < b.maxZ - T && a.maxZ > b.minZ + T))

/** Axis-aligned box of a rotated w × d rectangle with local center (cx, cz). */
function localBox(x: number, z: number, rot: number, cx: number, cz: number, w: number, d: number, shrink: number): Box2 {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const wx = x + cx * c + cz * s
  const wz = z - cx * s + cz * c
  const ac = Math.abs(c)
  const as = Math.abs(s)
  const hw = (w * ac + d * as) / 2 - shrink
  const hd = (w * as + d * ac) / 2 - shrink
  return { minX: wx - hw, maxX: wx + hw, minZ: wz - hd, maxZ: wz + hd }
}

/** An item with a shape: kind, position, rotation and size settings (an L counter is two rectangles). */
export type Shape = { kind: ItemKind; x: number; z: number; rot: number; len?: number; len2?: number; variant?: string; mount?: Item['mount'] }

/** Footprint rectangle in the item's own (local) frame: center (cx, cz) and w × d. The selection frame draws it too. */
export interface LocalRect {
  cx: number
  cz: number
  w: number
  d: number
}

/**
 * Local footprint rectangles of the item. Most items are one rectangle; an L counter is the main arm plus the arm along
 * the side wall (beyond the corner square). So the inner corner of the L counts as free and items can go there.
 */
export function localFootprints(s: Omit<Shape, 'x' | 'z' | 'rot'>): LocalRect[] {
  const [w, d] = sizeOf(s.kind, s.len, s.len2)
  const main = { cx: 0, cz: 0, w, d }
  if (s.kind !== 'kitchenCounter' || (s.variant !== 'lLeft' && s.variant !== 'lRight')) return [main]
  const L = s.len ?? CATALOG.kitchenCounter.size[0]
  const D = CATALOG.kitchenCounter.size[1]
  const leg = Math.max(D + 0.2, s.len2 ?? 1.8)
  const sx = s.variant === 'lRight' ? 1 : -1
  return [main, { cx: sx * (L / 2 - D / 2), cz: D / 2 + (leg - D) / 2, w: D, d: leg - D }]
}

/** Footprint rectangles of the item (in the world, axis-aligned boxes). */
export function footprints(s: Shape, shrink = 0): Box2[] {
  return localFootprints(s).map((r) => localBox(s.x, s.z, s.rot, r.cx, r.cz, r.w, r.d, shrink))
}

/**
 * A door's passage area: the opening's width (0.92 m), 0.9 m to the side the leaf opens to, 0.35 m to the other side
 * (the wall line is at local z = -0.21). No floor or wall item may go there; rugs, ceiling and tabletop items are fine.
 */
export function doorZone(x: number, z: number, rot: number, swing: 'in' | 'out' = 'in'): Box2 {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  // For a door opening outward the area is mirrored at the wall line.
  const [z0, z1] = swing === 'out' ? [-0.21 - 0.9, -0.21 + 0.35] : [-0.21 - 0.35, 0.9]
  const pts = [
    [-0.46, z0],
    [0.46, z0],
    [-0.46, z1],
    [0.46, z1],
  ].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c])
  return {
    minX: Math.min(...pts.map((q) => q[0])),
    maxX: Math.max(...pts.map((q) => q[0])),
    minZ: Math.min(...pts.map((q) => q[1])),
    maxZ: Math.max(...pts.map((q) => q[1])),
  }
}

const FREE_NEAR_DOOR: Layer[] = ['rug', 'top', 'ceiling']

/** Candidate being checked: kind, position, rotation; the swing direction for doors. */
type Cand = Shape & { y?: number; swing?: 'in' | 'out' }

/** Whether this item blocks a door's passage area (the automatic plan moves furniture away from doors). */
export function blocksDoor(items: Item[], cand: Cand) {
  if (FREE_NEAR_DOOR.includes(layerOf(cand.kind, cand.y, cand.variant, cand.mount))) return false
  const boxes = cand.kind === 'door' ? [doorZone(cand.x, cand.z, cand.rot, cand.swing)] : footprints(cand, 0.04)
  return items.some((it) => it.kind === 'door' && anyOverlap(boxes, [doorZone(it.x, it.z, it.rot, it.swing)]))
}

/** The surface under a point (the highest one). only: only these kinds count as surfaces (appliance stacking). */
export function surfaceAt(items: Item[], x: number, z: number, ignoreId?: string, only?: ItemKind[]) {
  let best: { item: Item; y: number } | null = null
  for (const it of items) {
    if (it.id === ignoreId || (only && !only.includes(it.kind))) continue
    const s = SURFACE_Y[it.kind]
    if (s == null) continue
    // If it stands on something itself (a dryer on a washing machine), its surface is that much higher.
    const y = s + (it.y != null && it.y > 0.05 ? it.y : 0)
    const inside = footprints(it, 0.05).some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)
    if (inside && (!best || y > best.y)) best = { item: it, y }
  }
  return best
}

export interface Check {
  ok: boolean
  reason?: string
}

/**
 * Whether the footprint is inside the room without entering the walls (the inner face is WALL_IN inside the boundary).
 * Rooms can have several parts (L, T): from every point of a 10 cm grid on the box, going a wall thickness in all four
 * directions must stay inside the room. There is no wall where parts meet, so items crossing there are fine.
 */
function fitsRoom(room: Room, box: Box2, t: number) {
  const m = WALL_IN - t
  const nx = Math.max(1, Math.ceil((box.maxX - box.minX) / 0.1))
  const nz = Math.max(1, Math.ceil((box.maxZ - box.minZ) / 0.1))
  for (let i = 0; i <= nx; i++) {
    const x = box.minX + ((box.maxX - box.minX) * i) / nx
    for (let j = 0; j <= nz; j++) {
      const z = box.minZ + ((box.maxZ - box.minZ) * j) / nz
      if (!inRoom(room, x - m, z) || !inRoom(room, x + m, z) || !inRoom(room, x, z - m) || !inRoom(room, x, z + m)) return false
    }
  }
  return true
}

/** Can the item go at this spot? ignoreId: the moved item itself. */
export function checkItem(level: Level, cand: Cand, ignoreId?: string, onWall = true): Check {
  const room = roomAt(level.rooms, cand.x, cand.z)
  if (!room) return { ok: false, reason: t('Drop it inside a room') }
  const layer = layerOf(cand.kind, cand.y, cand.variant, cand.mount)
  const wallish = snapsToWall(cand.kind, cand.mount)
  if (wallish && (cand.y == null || isWallMounted(cand.kind, cand.variant, cand.mount)) && !onWall) return { ok: false, reason: t('Move it closer to a wall') }

  if (DESK_ONLY.includes(cand.kind) && cand.y == null) return { ok: false, reason: t('Put it on a desk or a table') }
  // A wall-mounted item must stay within the wall (height and window size)
  if (isWallMounted(cand.kind, cand.variant, cand.mount)) {
    const [a, b] = wallSpan(cand)
    if (a < -0.005 || b > WALL_H + 0.005) return { ok: false, reason: t('Does not fit on the wall (sticks out at the floor or the ceiling)') }
  }
  const boxes = footprints(cand, 0.04)
  // The backs of wall items touch the wall; no overflow check for them.
  if (layer !== 'top' && layer !== 'ceiling' && !(wallish && layer !== 'floor') && !boxes.every((b) => fitsRoom(room, b, 0.02))) {
    return { ok: false, reason: t('Sticks out of the room') }
  }
  // The ceiling strip is a ring around the room: it collides with nothing.
  if (layer === 'rug' || layer === 'top' || cand.kind === 'ceilingStrip') return { ok: true }

  for (const it of level.items) {
    if (it.id === ignoreId) continue
    const name = it.name || CATALOG[it.kind].label
    if (it.kind === 'ceilingStrip') continue
    if (cand.kind === 'door' || it.kind === 'door') {
      if (FREE_NEAR_DOOR.includes(layerOf(it.kind, it.y, it.variant, it.mount)) || FREE_NEAR_DOOR.includes(layer)) continue
      const a = cand.kind === 'door' ? [doorZone(cand.x, cand.z, cand.rot, cand.swing)] : boxes
      const b = it.kind === 'door' ? [doorZone(it.x, it.z, it.rot, it.swing)] : footprints(it, 0.04)
      if (anyOverlap(a, b)) return { ok: false, reason: cand.kind === 'door' ? t('Doorway blocked by {name}', { name }) : t('Blocks a doorway') }
      continue
    }
    if (layerOf(it.kind, it.y, it.variant, it.mount) !== layer) continue
    if (TUCKS[cand.kind]?.includes(it.kind) || TUCKS[it.kind]?.includes(cand.kind)) continue
    // On the wall: no collision when their heights differ (a painting above a plug). Footprints are not shrunk, 2 cm margin
    // instead: thin wall items (a 5 cm painting) shrunk by 4 cm got a negative footprint and collided with nothing.
    if (layer === 'wall') {
      const [a0, a1] = wallSpan(cand)
      const [b0, b1] = wallSpan(it)
      if (a1 <= b0 + 0.01 || b1 <= a0 + 0.01) continue
      if (wallOverlap(footprints(cand), footprints(it))) return { ok: false, reason: t('Too close to {name}', { name }) }
      continue
    }
    if (anyOverlap(boxes, footprints(it, 0.04))) {
      return { ok: false, reason: t('Too close to {name}', { name }) }
    }
  }
  return { ok: true }
}

/* ---------- rooms ---------- */

const EPS = 0.01

const rectsOverlap = (r: Rect, o: Rect) => r.x < o.x + o.w - EPS && r.x + r.w > o.x + EPS && r.z < o.z + o.d - EPS && r.z + r.d > o.z + EPS

/** Whether the rectangle(s) overlap any part of another room (sharing an edge is fine). */
export function overlapsRoom(r: Rect | Rect[], rooms: Room[], ignoreId?: string) {
  const mine = Array.isArray(r) ? r : [r]
  return rooms.some((o) => o.id !== ignoreId && rectsOf(o).some((or) => mine.some((m) => rectsOverlap(m, or))))
}

/** Sticks a room rectangle to the edges of neighbor rooms (within 0.35 m). */
export function magnetRoom<T extends Rect>(r: T, rooms: Room[], ignoreId?: string, dist = 0.35): T {
  let { x, z } = r
  let bx = dist
  let bz = dist
  for (const o of rooms.filter((rm) => rm.id !== ignoreId).flatMap(rectsOf)) {
    const nearZ = r.z < o.z + o.d + dist && r.z + r.d > o.z - dist
    const nearX = r.x < o.x + o.w + dist && r.x + r.w > o.x - dist
    if (nearZ) {
      for (const [from, to] of [
        [r.x, o.x + o.w], // left edge to the neighbor's right
        [r.x + r.w, o.x], // right edge to the neighbor's left
        [r.x, o.x], // left edges aligned
        [r.x + r.w, o.x + o.w], // right edges aligned
      ]) {
        const dlt = to - from
        if (Math.abs(dlt) < bx) {
          bx = Math.abs(dlt)
          x = r.x + dlt
        }
      }
    }
    if (nearX) {
      for (const [from, to] of [
        [r.z, o.z + o.d],
        [r.z + r.d, o.z],
        [r.z, o.z],
        [r.z + r.d, o.z + o.d],
      ]) {
        const dlt = to - from
        if (Math.abs(dlt) < bz) {
          bz = Math.abs(dlt)
          z = r.z + dlt
        }
      }
    }
  }
  return { ...r, x, z }
}

/** Sticks a resized edge to neighbor edges. */
export function magnetEdge(v: number, rooms: Room[], axis: 'x' | 'z', ignoreId?: string, dist = 0.35) {
  let best = v
  let bd = dist
  for (const o of rooms.filter((rm) => rm.id !== ignoreId).flatMap(rectsOf)) {
    for (const e of axis === 'x' ? [o.x, o.x + o.w] : [o.z, o.z + o.d]) {
      if (Math.abs(e - v) < bd) {
        bd = Math.abs(e - v)
        best = e
      }
    }
  }
  return best
}
