import { create } from 'zustand'
import { play } from '@/audio/engine'
import { deviceClass, domainOf, isActive } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { bindingsOf } from '@/model/bindings'
import { exteriorSide } from '@/model/geometry'
import type { Item, Level } from '@/model/types'

/*
 * Door traffic: a person, pet or the walk mode player reaching a closed door opens it, so nobody walks through closed doors;
 * shortly after the last pass the door closes by itself. Visual only: the door sensor in HA is not touched (if the sensor
 * says open, the door is open anyway). Soft door sounds on open and close (audio/shots.ts > doorOpen, doorClose). Keyed by
 * door position (Visual.at; kit/devices.tsx > Door).
 */

/** A walker within this distance (m) of a door opens it */
const NEAR = 1.4
/** How long the door stays open after the last pass (ms) */
const HOLD = 1600

interface Entry {
  until: number
  x: number
  z: number
  /** The door was already open: no sound on close */
  quiet?: boolean
}

export const doorKey = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`

export const useDoorTraffic = create<{ open: Record<string, Entry> }>(() => ({ open: {} }))

let timer: ReturnType<typeof setTimeout> | undefined

function sweep() {
  timer = undefined
  const now = performance.now()
  const cur = useDoorTraffic.getState().open
  const next: Record<string, Entry> = {}
  let left = Infinity
  for (const [k, e] of Object.entries(cur)) {
    if (e.until > now) {
      next[k] = e
      left = Math.min(left, e.until - now)
    } else if (!e.quiet) play('doorClose', { x: e.x, y: 1, z: e.z }, { gain: 0.35, bus: 'home' })
  }
  useDoorTraffic.setState({ open: next })
  if (left < Infinity) timer = setTimeout(sweep, left + 20)
}

/**
 * Whether HA decides if the door is open: it has a bound door or window sensor or a cover, or a bound lock that is locked.
 * Such a door does not open when someone comes near; it is drawn open when the sensor says open and closed otherwise.
 */
function controlled(d: Item) {
  const ents = useHa.getState().entities
  const bound = bindingsOf(d).map((id) => ents[id]).filter(Boolean)
  return bound.some(
    (e) =>
      domainOf(e.entity_id) === 'cover' ||
      (domainOf(e.entity_id) === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e) ?? '')) ||
      (domainOf(e.entity_id) === 'lock' && e.state === 'locked'),
  )
}

/**
 * Whether the door is already drawn open (kit/devices.tsx > doorState): its sensor or cover is open; an interior door without
 * a sensor is open (unless locked), an exterior door is closed. Exterior door per geometry.ts > exteriorSide: a door leading
 * to a porch or garden is exterior too.
 */
function drawnOpen(level: Level, d: Item) {
  const ents = useHa.getState().entities
  const bound = bindingsOf(d).map((id) => ents[id]).filter(Boolean)
  const contacts = bound.filter((e) => domainOf(e.entity_id) === 'cover' || (domainOf(e.entity_id) === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e) ?? '')))
  if (contacts.length) return contacts.some(isActive)
  if (bound.some((e) => domainOf(e.entity_id) === 'lock' && e.state === 'locked')) return false
  return !exteriorSide(d, level.rooms)
}

/**
 * Positions of the walkers: nearby doors open or their open time is extended. Callers pass them a few times per second
 * (People, Pets, FpsControls). A door already drawn open makes no sound.
 */
export function passDoors(level: Level, movers: { x: number; z: number }[]) {
  if (!movers.length) return
  const now = performance.now()
  const cur = useDoorTraffic.getState().open
  let next: Record<string, Entry> | null = null
  for (const d of level.items) {
    if (d.kind !== 'door') continue
    if (!movers.some((m) => Math.hypot(m.x - d.x, m.z - d.z) < NEAR)) continue
    // A door with a sensor (or lock) is decided by HA: walkers do not open it
    if (controlled(d)) continue
    const k = doorKey(d.x, d.z)
    const e = cur[k]
    // Extend only when less than half the time is left (so the state does not change every frame)
    if (e && e.until - now > HOLD / 2) continue
    next ??= { ...cur }
    const already = drawnOpen(level, d)
    if (!e && !already) play('doorOpen', { x: d.x, y: 1, z: d.z }, { gain: 0.35, bus: 'home' })
    next[k] = { until: now + HOLD, x: d.x, z: d.z, quiet: already }
  }
  if (!next) return
  useDoorTraffic.setState({ open: next })
  if (!timer) timer = setTimeout(sweep, HOLD + 20)
}
