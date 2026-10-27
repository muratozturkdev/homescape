import { deviceClass, domainOf, isActive } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'

/** Values derived from entity state that decide how an item looks in the scene. */
export interface Visual {
  /** Bound to a HA entity */
  bound: boolean
  /** On / running / triggered */
  on: boolean
  /** Light intensity 0-1 */
  level: number
  /** Light color */
  color: string
  unavailable: boolean
  state: string
  attrs: Record<string, unknown>
  domain: string
  /** Night mode: lights cast real light, the scene darkens */
  night: boolean
  /** Item position in the plan (world): for items that build themselves around the room (a ceiling strip follows the room walls) */
  at?: { x: number; z: number; rot: number; y?: number }
  /** Extra bound entities (lock or sensor on a door, temperature sensor next to an AC...) */
  related: HassEntity[]
  /** Door/window sits in a (low) interior wall shared by two rooms */
  interior: boolean
  /** Door/window: hinge on the right, opens to the other side of the wall */
  hingeRight: boolean
  swingOut: boolean
  /** Edit mode: swing direction marks (arcs) show on every door and window */
  edit: boolean
  /** User settings of the item: desk length, drawers, colors, last aquarium feeding */
  opts: ItemOpts
  /**
   * Cabinets and drawers (model/containers.ts): how far the doors are open (0-1) and the compartments that hold items
   * (only those drawers open; an empty cabinet opens all).
   */
  open?: number
  openParts?: number[]
}

export interface ItemOpts {
  len?: number
  drawers?: 'none' | 'left' | 'right' | 'both'
  top?: string
  body?: string
  fedAt?: string
  shape?: 'square' | 'round'
  variant?: string
  len2?: number
  led?: 'none' | 'under' | 'plinth' | 'back' | 'strip'
  /** Entity that drives the LED (picked on the card; one of the related entities) */
  ledEntity?: string
  /** Light intensity multiplier (Item.intensity, default 1) */
  intensity?: number
  /** Wall mounted (Item.mount; power strip) */
  mount?: 'wall'
  /** Beam angle of a downlight (degrees, Item.beam) */
  beam?: number
  /** Built-in sink of a kitchen counter: its center on the counter's local x (omitted when there is none; model/counter.ts) */
  sinkAt?: number
}

/**
 * Light intensity multiplier (Item.intensity). v.level already includes it (ItemNode); items whose LED follows another
 * entity (headboard, counter, TV backlight, diffuser) multiply that entity's level by it.
 */
export const gainOf = (v: Visual) => v.opts.intensity ?? 1

/** Network presence of a computer: sensor of the HA Ping integration (binary_sensor, device_class connectivity). */
const isPing = (e: HassEntity) => domainOf(e.entity_id) === 'binary_sensor' && deviceClass(e) === 'connectivity'

/**
 * Whether the monitor screen is on. With the computer's Ping sensor bound, the screen lights only while the computer is
 * visible on the network; if the monitor's plug or light is bound too, that must be on as well. Without Ping: the main entity.
 */
export function monitorOn(v: Visual): boolean {
  const mainPing = v.bound && v.domain === 'binary_sensor' && v.attrs.device_class === 'connectivity'
  const pings = v.related.filter(isPing)
  if (!mainPing && !pings.length) return v.on
  const pc = (mainPing && v.on) || pings.some(isActive)
  const power = [...(v.domain === 'switch' || v.domain === 'light' ? [v.on] : []), ...v.related.filter((e) => ['switch', 'light'].includes(domainOf(e.entity_id))).map((e) => isActive(e))]
  return pc && (!power.length || power.some(Boolean))
}

export const OFF_VISUAL: Visual = {
  bound: false,
  on: false,
  level: 0,
  color: '#ffd29a',
  unavailable: false,
  state: '',
  attrs: {},
  domain: '',
  night: false,
  related: [],
  interior: false,
  hingeRight: false,
  swingOut: false,
  edit: false,
  opts: {},
}
