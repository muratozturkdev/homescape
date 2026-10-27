import { useHa } from '@/ha/store'
import { CATALOG, sizeOf } from '@/model/catalog'
import { wallSnap } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { checkItem, DEFAULT_MOUNT_Y, isWallMounted, mountRange, surfaceAt, wallSpan } from '@/model/rules'
import type { Item } from '@/model/types'
import { t } from '@/i18n'

/*
 * Height of wall-mounted items (they can move up and down on the wall). Item.y: offset from the default height (for an LED
 * strip: the strip's height above the floor). The card's slider, Page Up / Page Down and the up-down handle in the scene
 * all go through here: the value stays within limits and does not collide with other items on the wall (when their
 * heights overlap too).
 */

/** Current height value of the item (Item.y or the default) */
export const mountY = (item: Item) => item.y ?? DEFAULT_MOUNT_Y[item.kind] ?? 0

/** Height of the item's center above the floor (m) */
export function mountCenter(item: Item) {
  const [a, b] = wallSpan(item)
  return (a + b) / 2
}

/** Whether the height follows the rules (other items on the wall) */
export function checkMount(item: Item, y: number) {
  const level = activeLevel(useLayout.getState())
  if (!level) return { ok: false, reason: t('No plan') }
  return checkItem(level, { kind: item.kind, x: item.x, z: item.z, rot: item.rot, y, variant: item.variant, mount: item.mount, len: item.len, len2: item.len2 }, item.id)
}

/**
 * Sets the height to y (clamped to the limits). If it breaks a rule a notice appears and nothing changes; else it is written.
 * record: whether it becomes a separate undo step (false while dragging the slider, with a checkpoint at the start).
 */
export function setMountY(item: Item, y: number, record = true) {
  if (!isWallMounted(item.kind, item.variant, item.mount)) return false
  const { min, max } = mountRange(item.kind, item.variant, item.len2)
  const v = Math.round(Math.min(max, Math.max(min, y)) * 100) / 100
  if (v === mountY(item)) return true
  const chk = checkMount(item, v)
  if (!chk.ok) {
    useHa.setState({ notice: t('Not possible at this height: {reason}', { reason: chk.reason ?? '' }) })
    return false
  }
  useLayout.getState().updateItem(item.id, { y: v }, record)
  return true
}

/**
 * Hangs a power strip on the wall or takes it down (Item.mount). Hanging snaps it to the nearest wall (within 1.2 m) and
 * resets the height offset; taking it down moves it 6 cm from the wall into the room, onto a table or coffee table below it
 * if there is one, else onto the floor. If it breaks a rule a notice appears and nothing changes.
 */
export function setWallMount(item: Item, wall: boolean) {
  const L = useLayout.getState()
  const level = activeLevel(L)
  if (!level || (item.mount === 'wall') === wall) return
  let patch: Partial<Item>
  if (wall) {
    const w = wallSnap(level.rooms, item.x, item.z, CATALOG[item.kind].size[1], 1.2, sizeOf(item.kind, item.len)[0], false, true)
    if (!w) return useHa.setState({ notice: t('To hang it on the wall, first move it next to a wall (no wall within {distance} m)', { distance: 1.2 }) })
    patch = { mount: 'wall', x: w.x, z: w.z, rot: w.rot, y: undefined }
  } else {
    const x = Math.round((item.x + Math.sin(item.rot) * 0.06) * 1000) / 1000
    const z = Math.round((item.z + Math.cos(item.rot) * 0.06) * 1000) / 1000
    patch = { mount: undefined, x, z, y: surfaceAt(level.items, x, z, item.id)?.y }
  }
  const n = { ...item, ...patch }
  const chk = checkItem(level, { kind: n.kind, x: n.x, z: n.z, rot: n.rot, y: n.y, variant: n.variant, mount: n.mount, len: n.len, len2: n.len2 }, item.id)
  if (!chk.ok) {
    const reason = chk.reason ?? ''
    return useHa.setState({ notice: wall ? t("Can't hang it on the wall: {reason}", { reason }) : t("Can't put it down here: {reason}", { reason }) })
  }
  L.updateItem(item.id, patch)
}

/**
 * Slides a wall-mounted item d meters along the wall (arrow keys ←/→). It does not leave the wall: after sliding it must
 * still stick to the same wall (end of the wall, corner) and pass the rules (other items on the wall, doors). Otherwise a
 * notice appears and nothing changes.
 */
export function nudgeAlongWall(item: Item, d: number) {
  const L = useLayout.getState()
  const level = activeLevel(L)
  if (!level) return
  const x = Math.round((item.x + Math.cos(item.rot) * d) * 1000) / 1000
  const z = Math.round((item.z - Math.sin(item.rot) * d) * 1000) / 1000
  const aperture = item.kind === 'window'
  const w = wallSnap(level.rooms, x, z, CATALOG[item.kind].size[1], 0.05, sizeOf(item.kind, item.len)[0], aperture, item.mount === 'wall')
  const turn = w ? Math.abs(Math.atan2(Math.sin(w.rot - item.rot), Math.cos(w.rot - item.rot))) : 1
  if (!w || turn > 0.01) return useHa.setState({ notice: t('Reached the end of the wall') })
  const chk = checkItem(level, { kind: item.kind, x: w.x, z: w.z, rot: item.rot, y: item.y, variant: item.variant, mount: item.mount, len: item.len, len2: item.len2 }, item.id)
  if (!chk.ok) return useHa.setState({ notice: t("Can't slide it here: {reason}", { reason: chk.reason ?? '' }) })
  L.updateItem(item.id, { x: w.x, z: w.z })
}
