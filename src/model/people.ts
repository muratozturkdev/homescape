import type { Entities, HaRegistry, HassEntity } from '@/ha/types'
import { bindingsOf, itemLightIds } from './bindings'
import { isActive } from '@/ha/derive'
import { CATALOG, sizeOf } from './catalog'
import { counterSink } from './counter'
import { APERTURE_INSET, besideDoor, doorSides, exteriorSide, frontDoor, inRoom, isOutdoor, rectsOf, roomAt } from './geometry'
import { buildPetGrid, findPath, gridRoom, isFree, nearestFree, type PetGrid } from './pets'
import type { Item, ItemKind, Level, Room } from './types'

/*
 * People in the house, following the modes: a person is wherever motion was detected; there can be 2-3 people, reasoned
 * from the sensors (motion in both the bathroom and the kitchen means at least 2 people). At night they lie in bed; when
 * away they are outside the house.
 *
 * Pure logic (independent of the scene, testable): motion state of the rooms, mode, number of people, each person's target
 * spot and the walking route through the doors. Drawing and walking: scene/People.tsx.
 */

export type Pose = 'stand' | 'sit' | 'lie'
/** What the person is doing: chosen by their spot (activityFor), drawn by scene/humanAnim.ts. */
export type Activity = 'idle' | 'tv' | 'snack' | 'drink' | 'phone' | 'read' | 'type' | 'eat' | 'cook' | 'stir' | 'wash' | 'brush' | 'fridge' | 'fold' | 'sleep' | 'press' | 'browse' | 'gaze'
export interface Spot {
  x: number
  z: number
  /** Top of the seat or bed (0 when standing) */
  y: number
  /** Backward lean of a seated person's back (radians; upright if absent) */
  lean?: number
  /** Direction the person faces (like an item's rot: local +z forward) */
  rot: number
  pose: Pose
  /** Room they are in; null when outside */
  roomId: string | null
  /** The spot's item (seat, counter, toilet, bed...; none in the middle of a room) */
  use?: ItemKind | 'desk'
  /** What they do there (set at the end of planPeople; 'press' from the start when pressing a device) */
  activity?: Activity
  /** Height the hand reaches to when pressing a device (m) */
  reach?: number
}
export type PeopleMode = 'home' | 'sleep' | 'away'
export interface PeoplePlan {
  mode: PeopleMode
  count: number
  /** Rooms with strong activity: motion or a freshly switched on light (newest first) */
  active: string[]
  /** Rooms whose light has been on for a long time (weak hint) */
  lit: string[]
  /** Rooms with a computer on: someone sits at it (also in active) */
  desk: string[]
  spots: Spot[]
}

/** Motion and presence sensors */
const PRESENCE = ['motion', 'occupancy', 'presence']
/** After motion ends the person stays in that room this long (so brief motion does not make them leave at once) */
export const HOLD_MS = 3 * 60_000
/** Sleeping hours (without motion people are in bed at these hours even when night mode is not set) */
const lateNight = (now: number) => {
  const h = new Date(now).getHours()
  return h >= 23 || h < 7
}

/** The sensor's room: the room of the item it is bound to in the plan, else its HA area (if a room is linked to it). */
function sensorRoom(level: Level, registry: HaRegistry | null | undefined, id: string) {
  const it = level.items.find((i) => bindingsOf(i).includes(id))
  if (it) return roomAt(level.rooms, it.x, it.z)?.id
  const area = registry?.entityArea[id]
  return area ? level.rooms.find((r) => r.areaId === area)?.id : undefined
}

/**
 * For this long after a light is switched on it counts as "someone went there" (a fresh hint: it can raise the number of
 * people and gets someone out of bed at night). A light that has been on longer is a weak hint: an idle person goes there
 * while at home, but the count does not rise and sleepers stay in bed (lights left on must not crowd the house).
 */
export const LIGHT_FRESH_MS = 20 * 60_000

export interface RoomSignal {
  roomId: string
  /** Most recent time (now while there is motion; the moment the light came on) */
  at: number
  /** Strong hint: motion or a freshly switched on light */
  strong: boolean
  /** When the activity in the room started (light switched on, motion started): the person moves around the room by it */
  since: number
  /**
   * Position of the most recently switched on lamp: the person takes the seat next to it (a desk lamp: the desk's chair; a
   * floor lamp: the armchair next to it).
   */
  anchor?: { x: number; z: number }
}

/**
 * Activity of the rooms (switching a light on means someone went there, switching it off means they left):
 * - a motion / presence sensor is on, or went off less than HOLD_MS ago (strong); but if the room's light was switched off
 *   after the motion ended, the person has left and the hold is dropped;
 * - the room's light is on (lamps and LEDs bound to items in the plan; lights not in the plan by HA area): strong if it
 *   came on less than LIGHT_FRESH_MS ago, weak if earlier.
 * Newest activity first.
 */
export function roomSignals(level: Level, entities: Entities, registry: HaRegistry | null | undefined, now: number): RoomSignal[] {
  const out = new Map<string, RoomSignal>()
  // Position and time of the most recently switched on lamp in each room (to choose where the person sits)
  const anchors = new Map<string, { at: number; x: number; z: number }>()
  const add = (roomId: string, at: number, strong: boolean, since = at) => {
    const cur = out.get(roomId)
    out.set(roomId, { roomId, at: Math.max(cur?.at ?? 0, at), strong: Boolean(cur?.strong) || strong, since: Math.min(cur?.since ?? Infinity, since) })
  }
  const owner = new Map<string, Item>()
  const changedAt = (id: string) => Date.parse(entities[id]?.last_changed ?? '') || 0
  // Lights of the rooms: room -> entities
  const lights = new Map<string, Set<string>>()
  const seen = new Set<string>()
  for (const it of level.items) {
    const ids = itemLightIds(it)
    if (!ids.length) continue
    const room = roomAt(level.rooms, it.x, it.z)?.id
    if (!room) continue
    for (const id of ids) {
      seen.add(id)
      if (!owner.has(id)) owner.set(id, it)
      if (!lights.has(room)) lights.set(room, new Set())
      lights.get(room)!.add(id)
    }
  }
  for (const e of Object.values(entities)) {
    if (!e.entity_id.startsWith('light.') || seen.has(e.entity_id)) continue
    const room = sensorRoom(level, registry, e.entity_id)
    if (!room) continue
    if (!lights.has(room)) lights.set(room, new Set())
    lights.get(room)!.add(e.entity_id)
  }
  // When a light was last switched off in the room (if no light is on)
  const lastOff = (room: string) => {
    let t = 0
    for (const id of lights.get(room) ?? []) if (entities[id]?.state === 'off') t = Math.max(t, changedAt(id))
    return t
  }
  for (const [room, ids] of lights) {
    for (const id of ids) {
      const e = entities[id]
      if (e?.state !== 'on') continue
      const at = changedAt(id)
      add(room, at, now - at < LIGHT_FRESH_MS)
      const it = owner.get(id)
      // Ceiling lights (pendant, downlight, ceiling strip) do not point to a particular spot
      if (it && !['pendant', 'downlight', 'ceilingStrip'].includes(it.kind) && at >= (anchors.get(room)?.at ?? -1)) anchors.set(room, { at, x: it.x, z: it.z })
    }
  }
  for (const e of Object.values(entities)) {
    if (!e.entity_id.startsWith('binary_sensor.') || !PRESENCE.includes(String(e.attributes.device_class))) continue
    if (e.state !== 'on' && e.state !== 'off') continue
    const changed = changedAt(e.entity_id)
    if (e.state === 'off' && now - changed > HOLD_MS) continue
    const room = sensorRoom(level, registry, e.entity_id)
    if (!room) continue
    // Switched the light off after the motion ended and left
    if (e.state === 'off' && lastOff(room) >= changed && ![...(lights.get(room) ?? [])].some((id) => entities[id]?.state === 'on')) continue
    add(room, e.state === 'on' ? now : changed, true, changed)
  }
  return [...out.values()].map((s) => ({ ...s, anchor: anchors.get(s.roomId) })).sort((a, b) => b.at - a.at)
}

/** Rooms with strong activity (newest first): motion or a freshly switched on light. */
export const activeRooms = (level: Level, entities: Entities, registry: HaRegistry | null | undefined, now: number) =>
  roomSignals(level, entities, registry, now)
    .filter((s) => s.strong)
    .map((s) => s.roomId)

/** Mode: away (or vacation) outside; night mode, or late at night without any motion, in bed; at home otherwise. */
export function peopleMode(alarm: string | undefined, now: number, anyActive: boolean): PeopleMode {
  if (alarm === 'armed_away' || alarm === 'armed_vacation') return 'away'
  if (alarm === 'armed_night') return 'sleep'
  if (lateNight(now) && !anyActive) return 'sleep'
  return 'home'
}

/* ---------- spots ---------- */

const local = (it: Item, lx: number, lz: number) => ({ x: it.x + lx * Math.cos(it.rot) + lz * Math.sin(it.rot), z: it.z - lx * Math.sin(it.rot) + lz * Math.cos(it.rot) })
const itemsIn = (level: Level, room: Room) => level.items.filter((i) => roomAt(level.rooms, i.x, i.z)?.id === room.id)

/**
 * Seat sizes (kit/furniture.tsx): local z, top of the seat and backward lean of the back. The hips are 6 cm behind the
 * spot; the spot was chosen so the lower legs stay in front of the item and the back rests on the backrest.
 */
const SEAT = {
  armchair: { z: 0.12, y: 0.44, lean: 0.12 },
  chair: { z: 0.02, y: 0.495, lean: 0 },
  gamingChair: { z: 0.02, y: 0.505, lean: 0.12 },
}

/** Seats: sofa (2-3), armchair, chair, gaming chair. The person faces the item's local +z. */
function seats(level: Level, room: Room): Spot[] {
  const out: Spot[] = []
  for (const it of itemsIn(level, room)) {
    const base = (it.y ?? 0) + 0
    if (it.kind === 'sofa') {
      // Cushion top 0.49 m, the middle of the cushions (0.595 apart); the person sits on the cushion, leaning back slightly
      const n = (it.len ?? CATALOG.sofa.size[0]) >= 2 ? 3 : 2
      for (let k = 0; k < n; k++) out.push({ ...local(it, (k - (n - 1) / 2) * 0.595, 0.15), y: base + 0.48, lean: 0.12, rot: it.rot, pose: 'sit', roomId: room.id, use: 'sofa' })
    } else if (it.kind === 'armchair' || it.kind === 'chair' || it.kind === 'gamingChair') {
      const s = SEAT[it.kind]
      out.push({ ...local(it, 0, s.z), y: base + s.y, lean: s.lean, rot: it.rot, pose: 'sit', roomId: room.id, use: it.kind })
    }
  }
  return out
}

/**
 * Watching TV (people sit and watch while the TV is on, and eat and drink something): seats in the room of a TV that is on,
 * facing it (less than 60° off) and at most 6.5 m away, nearest first. Sofas, armchairs and chairs; chairs at a table or a
 * computer do not count.
 */
function tvSeats(level: Level, room: Room, entities: Entities): Spot[] {
  const tvs = itemsIn(level, room).filter((i) => i.kind === 'tv' && tvIsOn(i, entities))
  if (!tvs.length) return []
  const work = itemsIn(level, room).filter((i) => ['desk', 'computer', 'monitor', 'diningTable', 'roundTable'].includes(i.kind))
  return seats(level, room)
    .filter((s) => s.use !== 'gamingChair' && !work.some((w) => Math.hypot(w.x - s.x, w.z - s.z) < 1.2))
    .map((s) => {
      const best = Math.max(
        ...tvs.map((tv) => {
          const dx = tv.x - s.x
          const dz = tv.z - s.z
          const d = Math.hypot(dx, dz) || 1
          return d > 6.5 ? -1 : (Math.sin(s.rot) * dx + Math.cos(s.rot) * dz) / d - d * 0.01
        }),
      )
      return { s, best }
    })
    .filter((c) => c.best > 0.5)
    .sort((a, b) => b.best - a.best)
    .map((c) => c.s)
}

/**
 * Toilet (kit/furniture.tsx > Toilet): the top of the seat ring is 0.43 m, the person sits with their back to the tank,
 * facing forward (local +z); the hips are slightly behind the middle of the bowl (out of the tank). Idle people never go to
 * the toilet (not in seats).
 */
const TOILET = { z: 0.04, y: 0.43 }
function toiletSpots(level: Level, room: Room): Spot[] {
  return itemsIn(level, room)
    .filter((i) => i.kind === 'toilet')
    .map((it) => ({ ...local(it, 0, TOILET.z), y: (it.y ?? 0) + TOILET.y, lean: 0, rot: it.rot, pose: 'sit' as const, roomId: room.id, use: 'toilet' as const }))
}

/**
 * Standing work spots: in front of the counter, sink, stove, washbasin, fridge, washing machine (facing the item). A counter
 * with a built-in sink has two: in front of the sink (dishes, 'sink') and a free part of the counter away from the sink
 * (chopping, 'kitchenCounter').
 */
const WORK = ['kitchenCounter', 'sink', 'stove', 'washbasin', 'fridge', 'washer', 'mirrorCabinet', 'dresser']
function workSpots(level: Level, room: Room): Spot[] {
  const spot = (it: Item, x: number, use: ItemKind): Spot => ({ ...local(it, x, sizeOf(it.kind, it.len)[1] / 2 + 0.38), y: 0, rot: it.rot + Math.PI, pose: 'stand', roomId: room.id, use })
  return itemsIn(level, room)
    .filter((i) => WORK.includes(i.kind))
    .flatMap((it) => {
      const sink = counterSink(level.items, it)
      if (sink == null) return [spot(it, 0, it.kind)]
      const L = sizeOf(it.kind, it.len)[0]
      // Chopping spot: 0.65 m beside the sink (on the counter's longer side); none if closer than 0.25 m to the end, sink only
      const free = sink > 0 ? (sink - 0.65 >= -L / 2 + 0.25 ? sink - 0.65 : null) : sink + 0.65 <= L / 2 - 0.25 ? sink + 0.65 : null
      return free == null ? [spot(it, sink, 'sink')] : [spot(it, sink, 'sink'), spot(it, free, it.kind)]
    })
}

/** Middle of the room (the largest part of a multi-part room) */
function centre(room: Room): Spot {
  const r = rectsOf(room).sort((a, b) => b.w * b.d - a.w * a.d)[0]
  return { x: r.x + r.w / 2, z: r.z + r.d / 2, y: 0, rot: 0, pose: 'stand', roomId: room.id }
}

/** Beds: two spots in a double bed, one in a single; on the back, head at the headboard (local -z). */
function bedSpots(level: Level): Spot[] {
  const out: Spot[] = []
  for (const it of level.items.filter((i) => i.kind === 'bed')) {
    const roomId = roomAt(level.rooms, it.x, it.z)?.id ?? null
    const lx = sizeOf('bed', it.len)[0] >= 1.3 ? [-0.38, 0.38] : [0]
    for (const x of lx) out.push({ ...local(it, x, 0), y: 0.56, rot: it.rot, pose: 'lie', roomId, use: 'bed' })
  }
  return out
}

/** Outside the front door: 1.4 m out on the non-indoor side of the door (empty space, porch or garden), side by side along the wall. */
function outsideSpots(level: Level, n: number): Spot[] {
  const front = frontDoor(level.items, level.rooms)
  const out: Spot[] = []
  if (front) {
    const { door, side } = front
    const p = besideDoor(door, -side, 1.4)
    const fx = Math.sin(door.rot)
    const fz = Math.cos(door.rot)
    // Facing the door: the inside is usually the door's front, the waiting spot behind it; reversed for a door placed from outside (the porch)
    for (let k = 0; k < n; k++) {
      const s = (k - (n - 1) / 2) * 0.7
      out.push({ x: p.x + fz * s, z: p.z - fx * s, y: 0, rot: door.rot + (side > 0 ? 0 : Math.PI), pose: 'stand', roomId: null })
    }
    return out
  }
  // Without a front door, in front of the house (beyond the smallest z)
  const rs = level.rooms.flatMap(rectsOf)
  const minZ = Math.min(...rs.map((r) => r.z))
  const cx = rs.reduce((a, r) => a + r.x + r.w / 2, 0) / Math.max(1, rs.length)
  for (let k = 0; k < n; k++) out.push({ x: cx + (k - (n - 1) / 2) * 0.7, z: minZ - 1.4, y: 0, rot: 0, pose: 'stand', roomId: null })
  return out
}

/**
 * The person's spot in an active room: in a room with a toilet (bathroom, WC) they sit on the toilet; with a lamp just
 * switched on, the nearest seat within 1.6 m of it (desk lamp: the desk's chair, floor lamp: the armchair next to it);
 * else a seat, then in front of the counter / washbasin, else the middle.
 */
function activeSpot(level: Level, room: Room, used: Set<string>, anchor?: { x: number; z: number }, turn = 0, entities?: Entities): Spot {
  const wc = toiletSpots(level, room).find((s) => !used.has(key(s)))
  if (wc) return wc
  // With the TV on, the person in the room sits facing it
  const tv = entities && tvSeats(level, room, entities).find((s) => !used.has(key(s)))
  if (tv) return tv
  const near = anchor && turn === 0 && seatNear(level, room, used, anchor)
  if (near) return near
  // Moves around the room instead of doing just one thing: every WANDER_MS after the activity started they go to the next
  // spot. Work spots first in kitchens and bathrooms, seats first in other rooms.
  const work = workSpots(level, room)
  const pool = (work.length ? [...work, ...seats(level, room), ...browseSpots(level, room)] : [...seats(level, room), ...browseSpots(level, room), ...work]).filter((s) => !used.has(key(s)))
  if (pool.length) return pool[turn % pool.length]
  const c = centre(room)
  let k = 0
  while (used.has(key({ ...c, x: c.x + k * 0.5 }))) k++
  return { ...c, x: c.x + k * 0.5 }
}
const key = (s: { x: number; z: number }) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`

/** Wandering interval in a room: after the activity starts the person moves to another spot this often */
export const WANDER_MS = 90_000

/**
 * Standing spots to linger at while wandering: browse the books at the bookshelf, look out of the window, watch the
 * aquarium. The person faces the item.
 */
const BROWSE: Partial<Record<ItemKind, number>> = { bookshelf: 0.45, window: 0.55, aquarium: 0.5 }
function browseSpots(level: Level, room: Room): Spot[] {
  return itemsIn(level, room)
    .filter((i) => BROWSE[i.kind] != null && (i.kind !== 'window' || exteriorSide(i, level.rooms) > 0))
    .map((it) => ({ ...local(it, 0, sizeOf(it.kind, it.len)[1] / 2 + BROWSE[it.kind]!), y: 0, rot: it.rot + Math.PI, pose: 'stand' as const, roomId: room.id, use: it.kind }))
}

/**
 * Pressing a device by hand, as if the person switched it on (e.g. a TV or a diffuser): if the main entity of a bound
 * item came on within TOUCH_MS, someone walks up to the item and presses its button (nobody gets up when it goes off).
 * Desk lamps and computers are not here: whoever switches them on sits at the desk (desksInUse, seatNear). For ceiling
 * lights (pendant, downlight, strip, ceiling light, fan) they go to the room's wall switch, and not at all without one. At
 * most two devices at a time (the newest). Value: the height the hand reaches to (from the surface if the item stands on
 * one).
 */
export const TOUCH_MS = 30_000
const TOUCH: Partial<Record<ItemKind, number>> = {
  tv: 0.7,
  diffuser: 0.12,
  coffeeMachine: 0.25,
  kettle: 0.2,
  microwave: 0.2,
  airFryer: 0.2,
  washer: 0.8,
  dishwasher: 0.8,
  stove: 0.9,
  oven: 0.9,
  fan: 0.9,
  deskFan: 0.15,
  console: 0.1,
  speaker: 0.2,
  homepod: 0.15,
  soundbar: 0.1,
  humidifier: 0.3,
  airPurifier: 0.75,
  printer: 0.25,
  projector: 0.1,
  fireplace: 0.7,
  floorLamp: 1.0,
  tableLamp: 0.2,
  wallSwitch: 1.2,
  wallLight: 1.4,
  mirrorLight: 1.2,
}
const CEILING_LIGHTS: ItemKind[] = ['pendant', 'downlight', 'ceilingStrip', 'ceilingLight', 'ceilingFan', 'trackLight']

/**
 * Standing spot to reach a device from: its front, then its sides, then its back; the first one inside the room and free in
 * the person grid (the front may be blocked when the device is on a cabinet or TV unit), else the free point nearest to
 * its front. The person faces the device.
 */
function standNear(level: Level, room: Room, target: Item, d: number): { x: number; z: number; rot: number } | null {
  const g = personGrid(level)
  const w = sizeOf(target.kind, target.len)[0]
  const face = (p: { x: number; z: number }) => ({ ...p, rot: Math.atan2(target.x - p.x, target.z - p.z) })
  const cands = [local(target, 0, d), local(target, -(w / 2 + 0.38), 0.1), local(target, w / 2 + 0.38, 0.1), local(target, 0, -d)]
  for (const c of cands) if (inRoom(room, c.x, c.z) && isFree(g, c.x, c.z, true)) return face(c)
  const front = cands[0]
  const near = nearestFree(g, front.x, front.z, { room: gridRoom(g, target.x, target.z), max: 1.6, outdoor: true })
  return near && inRoom(room, near.x, near.z) ? face(near) : null
}

export function touchSpots(level: Level, entities: Entities, now: number): Spot[] {
  const events: { it: Item; at: number }[] = []
  for (const it of level.items) {
    if (!it.entityId || (TOUCH[it.kind] == null && !CEILING_LIGHTS.includes(it.kind))) continue
    const e = entities[it.entityId]
    const at = Date.parse(e?.last_changed ?? '') || 0
    if (!e || !at || now - at > TOUCH_MS || !isActive(e)) continue
    events.push({ it, at })
  }
  const out: Spot[] = []
  for (const { it } of events.sort((a, b) => b.at - a.at)) {
    if (out.length >= 2) break
    const room = roomAt(level.rooms, it.x, it.z)
    if (!room) continue
    // Ceiling light: the room's wall switch
    const target = CEILING_LIGHTS.includes(it.kind) ? itemsIn(level, room).find((i) => i.kind === 'wallSwitch') : it
    if (!target) continue
    const d = target.kind === 'wallSwitch' || target.kind === 'wallLight' || target.kind === 'mirrorLight' ? 0.42 : sizeOf(target.kind, target.len)[1] / 2 + 0.4
    const reach = Math.max(0.45, Math.min(1.55, target.y ? target.y + (TOUCH[target.kind] ?? 0.2) : (TOUCH[target.kind] ?? 0.9)))
    const at = standNear(level, room, target, d)
    if (!at) continue
    const s: Spot = { ...at, y: 0, pose: 'stand', roomId: room.id, use: target.kind, activity: 'press', reach }
    if (!out.some((o) => key(o) === key(s))) out.push(s)
  }
  return out
}

/** Nearest free seat within 1.6 m of a spot (the chair of a desk lamp or a computer). */
function seatNear(level: Level, room: Room, used: Set<string>, anchor: { x: number; z: number }) {
  return seats(level, room)
    .filter((s) => !used.has(key(s)))
    .map((s) => ({ s, d: Math.hypot(s.x - anchor.x, s.z - anchor.z) }))
    .filter((c) => c.d < 1.6)
    .sort((a, b) => a.d - b.d)[0]?.s
}

/* ---------- at the computer ---------- */

/** Items that count as computers: tower or laptop, and screens with a Ping sensor bound. */
const COMPUTERS: string[] = ['computer', 'monitor', 'monitorV']
/**
 * A Ping sensor not bound in the plan is recognized as a computer by its name (modem and internet connection do not
 * count). Keywords are data: Turkish and English, then common words in the other supported languages.
 */
const COMPUTER_NAME =
  /bilgisayar|computer|\bpc\b|\bmac\b|imac|macbook|mac ?mini|windows|laptop|desktop|rechner|ordenador|ordinateur|komputer|компьютер|ноутбук|パソコン|컴퓨터|노트북|电脑|कंप्यूटर/i
/** Sensor of the HA Ping integration: whether the device is visible on the network */
const isPing = (e: HassEntity | undefined): e is HassEntity => Boolean(e?.entity_id.startsWith('binary_sensor.') && e.attributes.device_class === 'connectivity')

export interface DeskUse {
  roomId: string
  /** When the computer came on */
  at: number
  /** Position of the computer (if not bound, of the room's screen or desk): the person sits on its chair */
  anchor?: { x: number; z: number }
}

/**
 * Computers that are on (someone sits at a computer that is on). The HA Ping sensor tells it is on (the computer is
 * visible on the network):
 * - bound to a computer or screen in the plan: that item is the spot;
 * - not bound (a sensor whose name says computer, e.g. "Mac", "Windows PC"): the computer, screen or desk of the room in
 *   its HA area;
 * - a computer item without Ping counts as on by its main entity (plug).
 * Two computers on the same desk (Mac and Windows on together) are one person. Newest first.
 */
export function desksInUse(level: Level, entities: Entities, registry: HaRegistry | null | undefined): DeskUse[] {
  const changedAt = (id: string) => Date.parse(entities[id]?.last_changed ?? '') || 0
  const out: DeskUse[] = []
  const seen = new Set<string>()
  for (const it of level.items) {
    if (!COMPUTERS.includes(it.kind)) continue
    const pings = bindingsOf(it).filter((id) => isPing(entities[id]))
    for (const id of pings) seen.add(id)
    const on = pings.length ? pings.filter((id) => entities[id].state === 'on') : it.kind === 'computer' && it.entityId && entities[it.entityId]?.state === 'on' ? [it.entityId] : []
    const roomId = roomAt(level.rooms, it.x, it.z)?.id
    if (on.length && roomId) out.push({ roomId, at: Math.max(...on.map(changedAt)), anchor: { x: it.x, z: it.z } })
  }
  for (const e of Object.values(entities)) {
    if (!isPing(e) || e.state !== 'on' || seen.has(e.entity_id)) continue
    if (!COMPUTER_NAME.test(`${String(e.attributes.friendly_name ?? '')} ${e.entity_id}`)) continue
    const room = level.rooms.find((r) => r.id === sensorRoom(level, registry, e.entity_id))
    if (!room) continue
    const inside = itemsIn(level, room)
    const at = inside.find((i) => COMPUTERS.includes(i.kind)) ?? inside.find((i) => i.kind === 'desk')
    out.push({ roomId: room.id, at: changedAt(e.entity_id), anchor: at && { x: at.x, z: at.z } })
  }
  out.sort((a, b) => b.at - a.at)
  // Same desk: within 1.5 m (or position unknown, same room)
  const same = (p: DeskUse, d: DeskUse) => p.roomId === d.roomId && (!p.anchor || !d.anchor || Math.hypot(p.anchor.x - d.anchor.x, p.anchor.z - d.anchor.z) < 1.5)
  return out.filter((d, k) => !out.slice(0, k).some((p) => same(p, d)))
}

/** At the computer: a free seat near the computer; without a chair, standing in front of the desk, facing it. */
function deskSpot(level: Level, room: Room, used: Set<string>, anchor?: { x: number; z: number }): Spot {
  if (anchor) {
    const seat = seatNear(level, room, used, anchor)
    if (seat) return seat
    const desk = itemsIn(level, room)
      .filter((i) => i.kind === 'desk' && Math.hypot(i.x - anchor.x, i.z - anchor.z) < 1.2)
      .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z))[0]
    if (desk) {
      const s: Spot = { ...local(desk, 0, sizeOf('desk', desk.len)[1] / 2 + 0.38), y: 0, rot: desk.rot + Math.PI, pose: 'stand', roomId: room.id, use: 'desk' }
      if (!used.has(key(s))) return s
    }
  }
  return activeSpot(level, room, used, anchor)
}

/** Idle spots for people in a house without motion: seats in the living room first, then other seats, then room middles. */
function idleSpots(level: Level): Spot[] {
  const living = level.rooms.filter((r) => itemsIn(level, r).some((i) => i.kind === 'sofa' || i.kind === 'tv'))
  const others = level.rooms.filter((r) => !living.includes(r))
  return [...living.flatMap((r) => seats(level, r)), ...others.flatMap((r) => seats(level, r)), ...level.rooms.map(centre)]
}

/* ---------- daily routine of idle people ---------- */

/**
 * Idle people do not sit in one place: a person not tied to a room by motion, light or a computer that is on moves to
 * another spot in the house every ROAM_MS (offset per person). The spot is weighted by the time of day: washbasin and
 * kitchen in the morning, table and counter at meal times, desk and bookshelf during the day, sofa in the evening (more so
 * with the TV on); rooms with a light on (weak hint) three times as often.
 */
export const ROAM_MS = 200_000

/** Repeatable random number per person and turn (0-1) */
const hash01 = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + 0.5) * 43758.5453
  return v - Math.floor(v)
}

function roamSpots(level: Level, entities: Entities, now: number, lit: string[]): { s: Spot; w: number }[] {
  const d = new Date(now)
  const h = d.getHours() + d.getMinutes() / 60
  const meal = (h >= 7 && h < 9) || (h >= 12 && h < 14) || (h >= 18.5 && h < 21)
  const prep = (h >= 6.5 && h < 8.5) || (h >= 11.5 && h < 13) || (h >= 17.5 && h < 20)
  const wash = (h >= 6 && h < 9.5) || h >= 21.5
  const day = h >= 9 && h < 18
  const out: { s: Spot; w: number }[] = []
  for (const room of level.rooms) {
    if (isOutdoor(room)) continue
    const boost = lit.includes(room.id) ? 3 : 1
    const tv = tvOn(level, room, entities)
    const near = (s: Spot, kinds: ItemKind[], r: number) => itemsIn(level, room).some((i) => kinds.includes(i.kind) && Math.hypot(i.x - s.x, i.z - s.z) < r)
    const add = (s: Spot, w: number) => w > 0 && out.push({ s, w: w * boost })
    for (const s of seats(level, room)) {
      if (s.use === 'sofa' || s.use === 'armchair') add(s, tv ? 4 : 2.5)
      else if (s.use === 'gamingChair') add(s, day ? 2 : 1.2)
      else if (near(s, ['diningTable', 'roundTable'], 1.3)) add(s, meal ? 4 : 0.5)
      else if (near(s, ['desk', 'computer', 'monitor'], 1.4)) add(s, day ? 2.2 : 1)
      else add(s, 1)
    }
    for (const s of workSpots(level, room)) {
      const k = s.use
      add(s, k === 'kitchenCounter' || k === 'stove' || k === 'sink' ? (prep ? 3 : 0.5) : k === 'washbasin' || k === 'mirrorCabinet' ? (wash ? 2.5 : 0.4) : k === 'fridge' ? 0.7 : k === 'washer' ? (day ? 0.6 : 0.2) : 0.6)
    }
    for (const s of browseSpots(level, room)) add(s, s.use === 'bookshelf' ? 1 : 0.8)
    for (const s of toiletSpots(level, room)) add(s, 0.35)
    add(centre(room), 0.25)
  }
  return out
}

/** Current spot of idle person k: the turn (ROAM_MS) is offset per person; a weighted spot that is not taken */
function roamSpot(cands: { s: Spot; w: number }[], used: Set<string>, k: number, now: number): Spot | null {
  const free = cands.filter((c) => !used.has(key(c.s)))
  if (!free.length) return null
  const slot = Math.floor((now + k * 73_000) / ROAM_MS)
  const total = free.reduce((a, c) => a + c.w, 0)
  let r = hash01(slot, k + 1) * total
  for (const c of free) {
    r -= c.w
    if (r <= 0) return c.s
  }
  return free[free.length - 1].s
}

export interface PeopleInput {
  level: Level
  entities: Entities
  registry?: HaRegistry | null
  /** State of the alarm (alarm_control_panel) */
  alarm?: string
  now: number
  /** Household size (from the settings; default 2) */
  residents: number
}

/** Plan of the people: mode, how many, who is where. */
export function planPeople({ level, entities, registry, alarm, now, residents }: PeopleInput): PeoplePlan {
  const signals = roomSignals(level, entities, registry, now)
  const anchorOf = new Map(signals.map((s) => [s.roomId, s.anchor]))
  // Someone sits at a computer that is on: strong activity; that room's motion and light are the same person
  const desks = desksInUse(level, entities, registry)
  const desk = [...new Set(desks.map((d) => d.roomId))]
  const moved = signals.filter((s) => s.strong && !desk.includes(s.roomId)).map((s) => s.roomId)
  const active = [...desk, ...moved]
  const lit = signals.filter((s) => !s.strong && !desk.includes(s.roomId)).map((s) => s.roomId)
  const mode = peopleMode(alarm, now, active.length > 0)
  // Every room with motion at the same time and every computer on is at least one person: more than the household (guests) up to 3 or the household size
  const count = mode === 'away' ? residents : Math.min(Math.max(3, residents), Math.max(residents, desks.length + moved.length))
  if (mode === 'away' || !level.rooms.length) return { mode, count, active, lit, desk, spots: outsideSpots(level, count) }
  const used = new Set<string>()
  const spots: Spot[] = []
  const take = (s: Spot) => {
    used.add(key(s))
    spots.push(s)
  }
  const roomOf = (id: string) => level.rooms.find((r) => r.id === id)
  // Someone walks to a device that was just switched and presses it (not while asleep). If someone will be in the device's
  // room anyway (motion or light) they go; else an idle person. Rooms with motion and computers in use never stay empty.
  const lived = [...moved, ...(mode === 'sleep' ? [] : lit)]
  const pressIn = new Map<string, Spot>()
  const spare: Spot[] = []
  if (mode === 'home')
    for (const t of touchSpots(level, entities, now)) {
      if (t.roomId && lived.includes(t.roomId) && !pressIn.has(t.roomId)) pressIn.set(t.roomId, t)
      else spare.push(t)
    }
  // Order: computers in use, rooms with strong activity, devices an idle person presses; while at home rooms with a light
  // on (a weak hint does not get anyone out of bed)
  for (const d of desks) {
    if (spots.length >= count) break
    const room = roomOf(d.roomId)
    if (room) take(deskSpot(level, room, used, d.anchor))
  }
  const sinceOf = new Map(signals.map((s) => [s.roomId, s.since]))
  const visit = (id: string) => {
    const room = roomOf(id)
    if (!room) return
    const t = pressIn.get(id)
    if (t && !used.has(key(t))) return take(t)
    // The next spot by the time since the room's activity started (wandering)
    const turn = Math.max(0, Math.floor((now - (sinceOf.get(id) ?? now)) / WANDER_MS))
    take(activeSpot(level, room, used, anchorOf.get(id), turn, entities))
  }
  for (const id of moved) if (spots.length < count) visit(id)
  for (const t of spare) if (spots.length < count && !used.has(key(t))) take(t)
  // Pressing a device in a room with a light on: the idle person going to that room presses it
  if (mode !== 'sleep') for (const t of pressIn.values()) if (spots.length < count && t.roomId && lit.includes(t.roomId) && !used.has(key(t))) take(t)
  // With the TV on, idle people sit facing it and watch (at home; not while asleep)
  if (mode === 'home')
    for (const room of level.rooms)
      for (const s of tvSeats(level, room, entities)) {
        if (spots.length >= count) break
        if (!used.has(key(s))) take(s)
      }
  // Idle people: at home they move around with the daily routine; beds while asleep
  if (mode !== 'sleep') {
    const cands = roamSpots(level, entities, now, lit)
    for (let k = 0; spots.length < count && k < 8; k++) {
      const s = roamSpot(cands, used, k, now)
      if (!s) break
      take(s)
    }
  }
  const rest = mode === 'sleep' ? [...bedSpots(level), ...idleSpots(level)] : idleSpots(level)
  for (const s of rest) {
    if (spots.length >= count) break
    if (!used.has(key(s))) take(s)
  }
  return { mode, count, active, lit, desk, spots: spots.map((s, k) => ({ ...s, activity: s.activity ?? activityFor(s, k, level, entities, now) })) }
}

/** Whether the TV is on (player or plug; not off, standby or unavailable) */
const tvIsOn = (tv: Item, entities: Entities) => bindingsOf(tv).some((id) => entities[id] && !['off', 'standby', 'unavailable', 'unknown'].includes(entities[id].state))
const tvOn = (level: Level, room: Room, entities: Entities) => itemsIn(level, room).some((i) => i.kind === 'tv' && tvIsOn(i, entities))

/**
 * What the person does at their spot: typing on the desk's chair, eating at the dining table (drinking water now and
 * then), watching on a seat facing a TV that is on (sipping from a mug, snacking from a bowl every 75 s), looking into the
 * fridge or drinking from a glass there, phone or book on a sofa or armchair while the TV is off (changing every 4 minutes
 * by person and time), phone on the toilet, chopping at the counter, stirring at the stove, washing at the sink and the
 * washing machine, brushing teeth at the washbasin and mirror cabinet, folding at the dresser, sleeping in bed; idle in the
 * middle of a room (checking the phone now and then).
 */
export function activityFor(s: Spot, k: number, level: Level, entities: Entities, now: number): Activity {
  if (s.pose === 'lie') return 'sleep'
  const room = level.rooms.find((r) => r.id === s.roomId)
  const near = (kinds: ItemKind[], d: number) => Boolean(room) && itemsIn(level, room!).some((i) => kinds.includes(i.kind) && Math.hypot(i.x - s.x, i.z - s.z) < d)
  const slot = Math.floor(now / 240_000) + k
  // Eating and drinking change more often (75 s; offset per person)
  const tick = Math.floor((now + k * 37_000) / 75_000)
  switch (s.use) {
    case 'toilet':
      return 'phone'
    case 'kitchenCounter':
      return 'cook'
    case 'stove':
      return 'stir'
    case 'sink':
    case 'washer':
      return 'wash'
    case 'washbasin':
    case 'mirrorCabinet':
      return 'brush'
    case 'fridge':
      // takes something from the fridge and drinks it standing
      return slot % 2 ? 'drink' : 'fridge'
    case 'dresser':
      return 'fold'
    case 'bookshelf':
      return 'browse'
    case 'window':
    case 'aquarium':
      return 'gaze'
    case 'desk':
    case 'gamingChair':
      return 'type'
    case 'chair':
      if (near(['computer', 'monitor', 'monitorV', 'keyboard'], 1.4)) return 'type'
      if (near(['diningTable', 'roundTable'], 1.3)) return tick % 3 === 2 ? 'drink' : 'eat'
      if (room && tvSeats(level, room, entities).some((t) => key(t) === key(s))) return tick % 3 === 1 ? 'snack' : 'tv'
      return slot % 2 ? 'read' : 'phone'
    case 'sofa':
    case 'armchair':
      // while watching TV, snacks from a bowl and sips from a mug now and then (in the tv pose)
      if (room && tvOn(level, room, entities)) return tick % 3 === 1 ? 'snack' : 'tv'
      return slot % 2 ? 'read' : 'phone'
  }
  return slot % 3 === 0 ? 'phone' : 'idle'
}

/* ---------- walking route ---------- */

interface Edge {
  a: string
  b: string
  pa: { x: number; z: number }
  pb: { x: number; z: number }
}

/**
 * Node of the room route: an indoor room or the outside ('out'). Outdoor rooms (porch, terrace, garden) count as outside
 * (the same split as geometry.ts > exteriorSide); otherwise a house with a porch in front had no route to the waiting spot
 * outside.
 */
const node = (r: Room | undefined) => (r && !isOutdoor(r) ? r.id : 'out')

/** Doors connect two rooms (a room and the outside for a front door); the passage points are 45 cm in front of the door on both sides. */
function doorEdges(level: Level): Edge[] {
  const out: Edge[] = []
  for (const d of level.items.filter((i) => i.kind === 'door')) {
    const { front, back } = doorSides(d, level.rooms)
    const a = node(front)
    const b = node(back)
    if (!front || a === b) continue
    const fx = Math.sin(d.rot)
    const fz = Math.cos(d.rot)
    const pa = { x: d.x + fx * 0.3, z: d.z + fz * 0.3 }
    const pb = { x: d.x - fx * (APERTURE_INSET + 0.45), z: d.z - fz * (APERTURE_INSET + 0.45) }
    out.push({ a, b, pa, pb })
  }
  return out
}

/** Walkable grid for people (rebuilt when the level's plan changes; pedestrians on the street use it too) */
const grids = new WeakMap<Level, PetGrid>()
export function personGrid(level: Level) {
  let g = grids.get(level)
  if (!g) grids.set(level, (g = buildPetGrid(level, 'person')))
  return g
}

/**
 * Walking route, so people do not walk through items and walls: A* on the grid as for pets (model/pets.ts; walls are only
 * crossed through door openings, large items are passed with an 18 cm margin, the front door leads to the garden); the
 * last point is the exact target (in front of the seat). Without a path on the grid (the target is outside the plan: the
 * waiting spot outside) the room route through the doors.
 */
export function route(level: Level, from: { x: number; z: number }, to: Spot) {
  const end = { x: to.x, z: to.z }
  if (level.rooms.length) {
    const g = personGrid(level)
    const inside = roomAt(level.rooms, to.x, to.z)
    const path = inside ? findPath(g, from, end, true) : null
    if (path?.length) {
      // Exactly to the target if it is free; if it falls inside an item (e.g. a diffuser on a TV unit) they stop at the
      // nearest free point instead of stepping into the item
      if (isFree(g, end.x, end.z, true)) path[path.length - 1] = end
      return path
    }
  }
  return doorRoute(level, from, to)
}

function doorRoute(level: Level, from: { x: number; z: number }, to: Spot) {
  const start = node(roomAt(level.rooms, from.x, from.z))
  const goal = node(level.rooms.find((r) => r.id === to.roomId))
  const end = { x: to.x, z: to.z }
  if (start === goal) return [end]
  const edges = doorEdges(level)
  const prev = new Map<string, { node: string; e: Edge; fwd: boolean }>()
  const queue = [start]
  const seen = new Set([start])
  while (queue.length) {
    const n = queue.shift()!
    if (n === goal) break
    for (const e of edges) {
      const fwd = e.a === n
      const next = fwd ? e.b : e.b === n ? e.a : null
      if (!next || seen.has(next)) continue
      seen.add(next)
      prev.set(next, { node: n, e, fwd })
      queue.push(next)
    }
  }
  if (!prev.has(goal)) return [end]
  const pts: { x: number; z: number }[] = [end]
  for (let n = goal; n !== start; ) {
    const p = prev.get(n)!
    pts.unshift(p.fwd ? p.e.pb : p.e.pa)
    pts.unshift(p.fwd ? p.e.pa : p.e.pb)
    n = p.node
  }
  return pts
}
