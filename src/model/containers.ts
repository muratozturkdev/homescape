import { t } from '@/i18n'
import { sizeOf } from './catalog'
import { isWallMounted, SURFACE_Y, wallSpan } from './rules'
import type { Item, ItemKind } from './types'

/*
 * Cabinet interiors: items can go inside anything that opens (cabinets, drawers, the TV unit; e.g. a boiler inside a
 * cabinet). Pure helpers: the compartments of furniture with doors or drawers, which compartment of which cabinet an item
 * is in, carrying the contents along when a cabinet moves, placing an item into a compartment. Drawn by kit/furniture.tsx
 * (doors and drawers open with Visual.open) and ItemNode (opening, and items in a drawer sliding with it).
 */

/** Compartment in the cabinet's local frame: its floor (y, from the cabinet's base), free height, depth range (z, front +z). */
export interface Compartment {
  label: string
  y: number
  h: number
  z0: number
  z1: number
  /** Drawer: slides forward when opened (with its contents) */
  drawer?: boolean
}

/** How far a drawer slides forward when opened (m) */
export const DRAWER_SLIDE = 0.3

/** Compartments of furniture with doors or drawers (same sizes as the kit/furniture.tsx models). */
export const INTERIOR: Partial<Record<ItemKind, Compartment[]>> = {
  wardrobe: [
    { label: t('Bottom compartment'), y: 0.06, h: 0.52, z0: -0.27, z1: 0.27 },
    { label: t('Middle compartment'), y: 0.62, h: 0.96, z0: -0.27, z1: 0.27 },
    { label: t('Top shelf'), y: 1.62, h: 0.4, z0: -0.27, z1: 0.27 },
  ],
  wardrobeSingle: [
    { label: t('Bottom compartment'), y: 0.06, h: 0.45, z0: -0.27, z1: 0.27 },
    { label: t('Top compartment'), y: 0.55, h: 1.47, z0: -0.27, z1: 0.27 },
  ],
  tvUnit: [{ label: t('Inside the unit'), y: 0.05, h: 0.38, z0: -0.18, z1: 0.17 }],
  shoeCabinet: [
    { label: t('Bottom shelf'), y: 0.05, h: 0.38, z0: -0.15, z1: 0.14 },
    { label: t('Top shelf'), y: 0.46, h: 0.38, z0: -0.15, z1: 0.14 },
  ],
  nightstand: [
    { label: t('Bottom compartment'), y: 0.04, h: 0.22, z0: -0.17, z1: 0.17 },
    { label: t('Drawer'), y: 0.29, h: 0.13, z0: -0.16, z1: 0.16, drawer: true },
  ],
  dresser: [
    { label: t('Bottom drawer'), y: 0.1, h: 0.17, z0: -0.19, z1: 0.19, drawer: true },
    { label: t('Middle drawer'), y: 0.33, h: 0.17, z0: -0.19, z1: 0.19, drawer: true },
    { label: t('Top drawer'), y: 0.56, h: 0.17, z0: -0.19, z1: 0.19, drawer: true },
  ],
  drawerUnit: [
    { label: t('Drawer {n}', { n: 1 }), y: 0.04, h: 0.12, z0: -0.22, z1: 0.22, drawer: true },
    { label: t('Drawer {n}', { n: 2 }), y: 0.21, h: 0.12, z0: -0.22, z1: 0.22, drawer: true },
    { label: t('Drawer {n}', { n: 3 }), y: 0.38, h: 0.12, z0: -0.22, z1: 0.22, drawer: true },
    { label: t('Drawer {n}', { n: 4 }), y: 0.55, h: 0.12, z0: -0.22, z1: 0.22, drawer: true },
  ],
  kitchenCounter: [
    { label: t('Base cabinet'), y: 0.08, h: 0.34, z0: -0.27, z1: 0.26 },
    { label: t('Base cabinet shelf'), y: 0.46, h: 0.34, z0: -0.27, z1: 0.26 },
    { label: t('Wall cabinet'), y: 1.67, h: 0.26, z0: -0.29, z1: 0.02 },
    { label: t('Wall cabinet shelf'), y: 1.96, h: 0.26, z0: -0.29, z1: 0.02 },
  ],
  bookshelf: [
    { label: t('Shelf {n}', { n: 1 }), y: 0.05, h: 0.45, z0: -0.14, z1: 0.16 },
    { label: t('Shelf {n}', { n: 2 }), y: 0.545, h: 0.45, z0: -0.14, z1: 0.16 },
    { label: t('Shelf {n}', { n: 3 }), y: 1.045, h: 0.45, z0: -0.14, z1: 0.16 },
    { label: t('Shelf {n}', { n: 4 }), y: 1.545, h: 0.4, z0: -0.14, z1: 0.16 },
  ],
}

/** Furniture with doors or drawers (that opens): the bookshelf has open shelves and does not open. */
export const OPENS = (kind: ItemKind) => Boolean(INTERIOR[kind]) && kind !== 'bookshelf'

/** Cabinet width (local x; Item.len for adjustable lengths) */
const widthOf = (c: Item) => sizeOf(c.kind, c.len)[0]

/** A world point in the cabinet's local frame */
export function toLocal(c: Pick<Item, 'x' | 'z' | 'rot'>, x: number, z: number) {
  const dx = x - c.x
  const dz = z - c.z
  const cs = Math.cos(c.rot)
  const sn = Math.sin(c.rot)
  return { lx: dx * cs - dz * sn, lz: dx * sn + dz * cs }
}

/** A local point in the world */
export function toWorld(c: Pick<Item, 'x' | 'z' | 'rot'>, lx: number, lz: number) {
  const cs = Math.cos(c.rot)
  const sn = Math.sin(c.rot)
  return { x: c.x + lx * cs + lz * sn, z: c.z - lx * sn + lz * cs }
}

/** The item's base (m): the bottom edge for wall-mounted items (boiler pipes included), Item.y for the others */
const baseY = (it: Item) => (isWallMounted(it.kind, it.variant, it.mount) ? wallSpan(it)[0] : (it.y ?? 0))

type Hit = { box: Item; comp: Compartment; index: number } | null
/**
 * Cache per item list and item object (lists are immutable, every change is a new array). Every item asks for its
 * cabinet and contents on each render; without the cache a level change cost the square of the item count (walk mode
 * froze on the stairs of the American sample house).
 */
const hits = new WeakMap<Item[], WeakMap<Item, Hit>>()
const groups = new WeakMap<Item[], Map<string, Item[]>>()

/** Whether the item is inside a cabinet: which cabinet, which compartment. Its base is inside the compartment and its footprint center inside the cabinet. */
export function containerOf(items: Item[], it: Item): Hit {
  let m = hits.get(items)
  if (!m) hits.set(items, (m = new WeakMap()))
  if (m.has(it)) return m.get(it)!
  const r = findContainer(items, it)
  m.set(it, r)
  return r
}

function findContainer(items: Item[], it: Item): Hit {
  if (INTERIOR[it.kind] && it.y == null) return null
  for (const c of items) {
    if (c.id === it.id) continue
    const comps = INTERIOR[c.kind]
    if (!comps) continue
    const { lx, lz } = toLocal(c, it.x, it.z)
    if (Math.abs(lx) > widthOf(c) / 2 - 0.02) continue
    const y = baseY(it) - (c.y ?? 0)
    const index = comps.findIndex((k) => lz > k.z0 - 0.03 && lz < k.z1 + 0.03 && y > k.y - 0.03 && y < k.y + k.h - 0.02)
    if (index >= 0) return { box: c, comp: comps[index], index }
  }
  return null
}

/** Contents of the cabinet (grouped once per list) */
export function contentsOf(items: Item[], box: Item): Item[] {
  let g = groups.get(items)
  if (!g) {
    g = new Map()
    for (const i of items) {
      const c = containerOf(items, i)
      if (c) g.set(c.box.id, [...(g.get(c.box.id) ?? []), i])
    }
    groups.set(items, g)
  }
  return (g.get(box.id) ?? []).filter((i) => i.id !== box.id)
}

/**
 * When a cabinet moves or rotates its contents go with it, keeping their local positions. Patches of the changed items
 * (cabinet and items before the move; the cabinet's next position).
 */
export function carryPatches(items: Item[], box: Item, next: Pick<Item, 'x' | 'z' | 'rot'>): { id: string; patch: Partial<Item> }[] {
  if (!INTERIOR[box.kind]) return []
  return contentsOf(items, box).map((it) => {
    const { lx, lz } = toLocal(box, it.x, it.z)
    const p = toWorld(next, lx, lz)
    return { id: it.id, patch: { x: p.x, z: p.z, rot: it.rot + (next.rot - box.rot) } }
  })
}

/** Changes the item's position and rotation together with its contents if it is a cabinet: rotate buttons, R key. List of patches. */
export function moveWithContents(items: Item[], id: string, patch: Partial<Item>): { id: string; patch: Partial<Item> }[] {
  const it = items.find((i) => i.id === id)
  if (!it) return []
  const next = { x: patch.x ?? it.x, z: patch.z ?? it.z, rot: patch.rot ?? it.rot }
  return [...carryPatches(items, it, next), { id, patch }]
}

/**
 * A small item dropped onto open-shelf furniture without a top surface (bookshelf) sits on the first shelf it fits.
 * Height of the shelf floor below the drop point.
 */
export function shelfAt(items: Item[], x: number, z: number, kind: ItemKind, ignoreId?: string): number | undefined {
  const [, d] = sizeOf(kind)
  for (const c of items) {
    if (c.id === ignoreId || SURFACE_Y[c.kind] != null) continue
    const comps = INTERIOR[c.kind]
    if (!comps) continue
    const { lx, lz } = toLocal(c, x, z)
    const [w, cd] = sizeOf(c.kind, c.len)
    if (Math.abs(lx) > w / 2 - 0.03 || Math.abs(lz) > cd / 2) continue
    const k = comps.find((q) => d <= q.z1 - q.z0 + 0.01)
    if (k) return (c.y ?? 0) + k.y
  }
  return undefined
}

/**
 * Puts the item into a compartment of the cabinet: it drops to the compartment floor, turns the same way as the cabinet
 * and shifts just enough to stay inside the compartment in width and depth (staying near its middle). If it does not
 * fit, the reason.
 */
export function placeInside(box: Item, index: number, it: Item): { patch: Partial<Item> } | { reason: string } {
  const comp = INTERIOR[box.kind]?.[index]
  if (!comp) return { reason: t('This cabinet has no such compartment') }
  const [w, d] = sizeOf(it.kind, it.len, it.len2)
  const hw = widthOf(box) / 2 - 0.03
  if (w > hw * 2 || d > comp.z1 - comp.z0 + 0.01) return { reason: t('{place} is too narrow for this item', { place: comp.label }) }
  const { lx } = toLocal(box, it.x, it.z)
  const x = Math.max(-hw + w / 2, Math.min(hw - w / 2, lx))
  const z = (comp.z0 + comp.z1) / 2
  const p = toWorld(box, x, z)
  return { patch: { x: p.x, z: p.z, rot: box.rot, y: (box.y ?? 0) + comp.y } }
}
