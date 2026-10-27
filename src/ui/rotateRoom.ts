import { useHa } from '@/ha/store'
import { inRoom, rectBounds, rectsOf } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { overlapsRoom } from '@/model/rules'
import type { Rect } from '@/model/types'
import { t } from '@/i18n'

/*
 * Rotating a room (roads too): the room turns 90° with all its parts and the items in it around the middle of its bounding
 * box (dir 1 clockwise, -1 counterclockwise, seen from above in the plan). If it would overlap another room it does not
 * turn and the reason is shown. One undo step (⌘Z). In edit mode with a room selected: R (⇧R reverse) or "Rotate" on the
 * room's card.
 */

const round = (v: number) => Math.round(v * 1000) / 1000

export function rotateRoom(id: string, dir: 1 | -1 = 1): boolean {
  const s = useLayout.getState()
  const lv = activeLevel(s)
  const room = lv?.rooms.find((r) => r.id === id)
  if (!lv || !room) return false
  const rects = rectsOf(room)
  const b = rectBounds(rects)
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  // Clockwise (x right, z down): (dx, dz) -> (-dz, dx); counterclockwise: (dz, -dx)
  const pt = (x: number, z: number) => (dir > 0 ? { x: cx - (z - cz), z: cz + (x - cx) } : { x: cx + (z - cz), z: cz - (x - cx) })
  const turn = (r: Rect): Rect =>
    dir > 0 ? { x: round(cx - (r.z + r.d - cz)), z: round(cz + (r.x - cx)), w: r.d, d: r.w } : { x: round(cx + (r.z - cz)), z: round(cz - (r.x + r.w - cx)), w: r.d, d: r.w }
  const next = rects.map(turn)
  if (overlapsRoom(next, lv.rooms, room.id)) {
    useHa.setState({ notice: t("Can't rotate: it overlaps another room. Make room first or move the room.") })
    return false
  }
  const items = lv.items.filter((it) => inRoom(room, it.x, it.z))
  s.checkpoint()
  const [main, ...parts] = next
  s.updateRoom(id, { x: main.x, z: main.z, w: main.w, d: main.d, ...(room.parts?.length ? { parts } : {}) }, false)
  for (const it of items) {
    const p = pt(it.x, it.z)
    s.updateItem(it.id, { x: round(p.x), z: round(p.z), rot: it.rot - dir * (Math.PI / 2) }, false)
  }
  return true
}
