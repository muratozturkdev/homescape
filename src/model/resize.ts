import { WALL_IN } from './geometry'
import { footprints, layerOf, surfaceAt } from './rules'
import type { Item, Rect } from './types'

/*
 * When a room (or a part) is resized from one edge, items follow:
 * - Items near that wall (footprint within BAND of the wall's inner face: wall items, furniture against the wall, doors
 *   and windows in that wall) slide with the edge by the same amount.
 * - When shrinking, a wall that hits an item further inside pushes it (no item ends up inside the wall).
 * - Items on sliding surfaces (desk, coffee table, cabinet) go with them.
 * Other items stay put. The drag arrives step by step, so as the wall approaches, items enter its band and get pushed.
 */

export type Edge = 'left' | 'right' | 'back' | 'front'

/** Items this close (m) to the wall slide with the wall. */
const BAND = 0.35

export const edgeValue = (r: Rect, edge: Edge) => (edge === 'left' ? r.x : edge === 'right' ? r.x + r.w : edge === 'back' ? r.z : r.z + r.d)

/** Rect change that moves the edge to v. */
export function edgePatch(r: Rect, edge: Edge, v: number): Partial<Rect> {
  if (edge === 'right') return { w: v - r.x }
  if (edge === 'left') return { x: v, w: r.x + r.w - v }
  if (edge === 'front') return { d: v - r.z }
  return { z: v, d: r.z + r.d - v }
}

export function shiftItemsWithEdge(items: Item[], rect: Rect, edge: Edge, newV: number): Item[] {
  const oldV = edgeValue(rect, edge)
  const d = newV - oldV
  if (!d) return items
  const alongX = edge === 'left' || edge === 'right'
  const out = edge === 'right' || edge === 'front' ? 1 : -1
  const pad = 0.05
  const inRect = (it: Item) => it.x >= rect.x - pad && it.x <= rect.x + rect.w + pad && it.z >= rect.z - pad && it.z <= rect.z + rect.d + pad
  const moved = new Map<string, number>()

  for (const it of items) {
    if (!inRect(it) || layerOf(it.kind, it.y, it.variant, it.mount) === 'top') continue
    // For multi-part footprints like an L counter, the outer edge spans all parts
    const parts = footprints(it)
    const b = { minX: Math.min(...parts.map((q) => q.minX)), maxX: Math.max(...parts.map((q) => q.maxX)), minZ: Math.min(...parts.map((q) => q.minZ)), maxZ: Math.max(...parts.map((q) => q.maxZ)) }
    // The item's outer edge facing this wall, and the wall's inner face
    const extent = alongX ? (out > 0 ? b.maxX : b.minX) : out > 0 ? b.maxZ : b.minZ
    const gap = out * (oldV - out * WALL_IN - extent)
    let shift = 0
    if (gap <= BAND) shift = d
    else if (d * out < 0) {
      // When shrinking, push the item if the new inner face passes it
      const over = out * (extent - (newV - out * WALL_IN))
      if (over > 0) shift = -out * over
    }
    if (shift) moved.set(it.id, shift)
  }
  // Items on a surface go with it (keyboard on the desk, lamp on the coffee table)
  for (const it of items) {
    if (moved.has(it.id) || layerOf(it.kind, it.y, it.variant, it.mount) !== 'top') continue
    const s = surfaceAt(items, it.x, it.z, it.id)
    if (s && moved.has(s.item.id)) moved.set(it.id, moved.get(s.item.id)!)
  }
  if (!moved.size) return items
  return items.map((it) => {
    const s = moved.get(it.id)
    if (!s) return it
    return alongX ? { ...it, x: it.x + s } : { ...it, z: it.z + s }
  })
}
