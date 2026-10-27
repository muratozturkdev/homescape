import { CATALOG } from './catalog'
import type { Item } from './types'

/*
 * Built-in sink of the kitchen counter, with a faucet. Chosen on the card (Item.sink: none, left, center, right); when not
 * chosen it sits in the middle unless a separate sink item stands within 1 m of either end of the counter, so the
 * automatic plan does not get two sinks next to each other. Drawn by kit/furniture.tsx > CounterRun; the person's washing
 * spot is in model/people.ts > workSpots.
 */

/** Sink width and distance from the counter end (m) */
export const SINK_W = 0.56
const EDGE = 0.45
const CORNER = 0.6 + SINK_W / 2 + 0.06

/** Center of the counter's built-in sink along local x; null without a sink. */
export function counterSink(items: Item[], c: Item): number | null {
  if (c.kind !== 'kitchenCounter') return null
  const L = c.len ?? CATALOG.kitchenCounter.size[0]
  if (L < 0.9) return null
  let side = c.sink
  if (!side) {
    const ax = Math.cos(c.rot)
    const az = -Math.sin(c.rot)
    const near = items.some((i) => {
      if (i.kind !== 'sink') return false
      const along = (i.x - c.x) * ax + (i.z - c.z) * az
      const across = Math.abs(-(i.x - c.x) * az + (i.z - c.z) * ax)
      return across < 0.6 && Math.abs(along) < L / 2 + 1
    })
    side = near ? 'none' : 'center'
  }
  if (side === 'none') return null
  // On an L counter it stays out of the corner square (0.6 m): at that end it starts one arm depth inward
  const lo = -L / 2 + (c.variant === 'lLeft' ? CORNER : EDGE)
  const hi = L / 2 - (c.variant === 'lRight' ? CORNER : EDGE)
  if (lo > hi) return null
  const x = side === 'left' ? lo : side === 'right' ? hi : 0
  return Math.min(hi, Math.max(lo, x))
}
