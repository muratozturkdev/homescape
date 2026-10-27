import { uid } from './ids'
import type { Item } from './types'

/*
 * Item migrations of saved plans (used by the layoutStore persist migrate). Others: bindings.ts > foldTvBacklights
 * (version 2), geometry.ts > settleWallItems (version 3).
 */

/**
 * Version 4: the TV and the TV unit became separate items. Before, 'tv' was one piece with its unit (no placement
 * variant). Every old TV becomes a TV unit at the same spot (1.8 m, the old length) with a standing TV on top; the TV's
 * bindings and settings stay on the TV. The unit moves 4 cm toward the wall so it rests against the new inner face.
 */
export function splitTvUnits(items: Item[]): Item[] {
  const out: Item[] = []
  for (const it of items) {
    if (it.kind !== 'tv' || it.variant) {
      out.push(it)
      continue
    }
    const back = 0.04
    out.push({ id: uid('it'), kind: 'tvUnit', x: it.x - Math.sin(it.rot) * back, z: it.z - Math.cos(it.rot) * back, rot: it.rot, len: 1.8 })
    out.push({ ...it, variant: 'stand', y: 0.5 })
  }
  return out
}
