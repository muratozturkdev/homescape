import type { Item, ItemKind, Level } from './types'

/*
 * Camera mounts (GitHub PR #14): a camera hangs on a house wall (the default) or outside on a tree trunk, a fence or a gate
 * post. A mounted camera keeps its support's id (Item.mountTargetId) and follows it: settleCameras puts it back on the
 * support after every plan change (layoutStore > change), and it goes when the support goes.
 */

export type CameraMountSurface = NonNullable<Item['mountSurface']>
export type CameraMountData = Pick<Item, 'mountSurface' | 'mountTargetId' | 'mountPoint' | 'mountYaw' | 'mountSide'>
type MountPoint = NonNullable<Item['mountPoint']>
/** What cameraAnchor reads from a camera */
type Mounted = CameraMountData & { kind: ItemKind; y?: number }

export interface CameraAnchor {
  x: number
  z: number
  rot: number
  y: number
}

/** Height the camera model is drawn at (kit): a camera's Item.y is the offset from it. */
export const CAMERA_BASE_HEIGHT = 2.3

/** The item kind of each support and the points a camera can go on; a wall is no item. */
export const CAMERA_SUPPORTS: Record<Exclude<CameraMountSurface, 'wall'>, { kind: ItemKind; points: MountPoint[] }> = {
  tree: { kind: 'tree', points: ['trunk'] },
  fence: { kind: 'fence', points: ['panel', 'postLeft', 'postRight', 'postCenter'] },
  gate: { kind: 'gate', points: ['postLeft', 'postRight'] },
}

const supportOf = (surface?: CameraMountSurface) => (surface && surface !== 'wall' ? CAMERA_SUPPORTS[surface] : undefined)

export const cameraSurface = (item: Mounted): CameraMountSurface => (item.kind === 'camera' ? (item.mountSurface ?? 'wall') : 'wall')

export const isCameraMountTarget = (camera: Mounted, target: Item) => supportOf(cameraSurface(camera))?.kind === target.kind

/** Default mounting height above the ground. */
export const defaultCameraHeight = (surface: CameraMountSurface) => (surface === 'tree' ? 1.8 : surface === 'fence' ? 0.85 : surface === 'gate' ? 1 : CAMERA_BASE_HEIGHT)

/** Where a camera sits on its support: position, heading (rot) and Item.y (offset from the model's own height). */
export function cameraAnchor(camera: Mounted, target: Item): CameraAnchor | null {
  if (!isCameraMountTarget(camera, target)) return null
  const surface = cameraSurface(camera)
  const point = camera.mountPoint
  // Mounted on the far side of a fence or a gate, the camera faces the other way
  const reversed = (surface === 'fence' || surface === 'gate') && camera.mountSide === 'back'
  const rot = target.rot + ((camera.mountYaw ?? 0) * Math.PI) / 180 + (reversed ? Math.PI : 0)
  const height = camera.y != null ? CAMERA_BASE_HEIGHT + camera.y : defaultCameraHeight(surface)
  // In the support's own frame: out from the trunk, on a fence's panel or one of its posts, on a gate's posts (they stay
  // put while the leaf swings)
  let localX = 0
  let localZ = 0
  if (surface === 'tree') localZ = 0.2
  if (surface === 'fence') {
    const length = target.len ?? 2
    const posts = Math.max(1, Math.round(length / 1.2))
    const left = -length / 2 + 0.035
    const right = length / 2 - 0.035
    if (point === 'postLeft') localX = left
    else if (point === 'postRight') localX = right
    else if (point === 'postCenter') localX = left + (Math.round(posts / 2) * (right - left)) / posts
    localZ = point === 'panel' ? 0.1 : 0.12
  }
  if (surface === 'gate') {
    localX = point === 'postRight' ? 0.55 : -0.55
    localZ = 0.12
  }
  if (reversed) localZ = -localZ
  const c = Math.cos(target.rot)
  const s = Math.sin(target.rot)
  return { x: target.x + localX * c + localZ * s, z: target.z - localX * s + localZ * c, rot, y: height - CAMERA_BASE_HEIGHT }
}

/** The anchor of a camera on its support among the items; null when it is not mounted or the support is not there. */
export function resolveCameraAnchor(camera: Mounted, items: Item[]): CameraAnchor | null {
  if (camera.kind !== 'camera' || !camera.mountTargetId) return null
  const target = items.find((it) => it.id === camera.mountTargetId)
  return target ? cameraAnchor(camera, target) : null
}

/** The closest mounting point on a tree, a fence or a gate within maxDistance of x, z (placing a camera, scene/Ghost.tsx). */
export function findCameraMount(items: Item[], x: number, z: number, maxDistance = 0.45): (CameraAnchor & CameraMountData) | null {
  let best: (CameraAnchor & CameraMountData) | null = null
  let bestDistance = maxDistance
  for (const target of items) {
    const surface = (Object.keys(CAMERA_SUPPORTS) as Exclude<CameraMountSurface, 'wall'>[]).find((k) => CAMERA_SUPPORTS[k].kind === target.kind)
    if (!surface) continue
    // The side of the fence or gate the pointer is on
    const localZ = (x - target.x) * Math.sin(target.rot) + (z - target.z) * Math.cos(target.rot)
    const side: Item['mountSide'] = surface === 'tree' ? undefined : localZ < 0 ? 'back' : 'front'
    for (const point of CAMERA_SUPPORTS[surface].points) {
      const mount: CameraMountData = { mountSurface: surface, mountTargetId: target.id, mountPoint: point, mountYaw: 0, mountSide: side }
      const anchor = cameraAnchor({ kind: 'camera', ...mount }, target)
      if (!anchor) continue
      const distance = Math.hypot(x - anchor.x, z - anchor.z)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { ...anchor, ...mount }
      }
    }
  }
  return best
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-4

/**
 * Puts every mounted camera back on its support (moved, turned or resized with it); a camera whose support is gone goes
 * too. Runs after every plan change (layoutStore > change).
 */
export function settleCameras(level: Level): Level {
  if (!level.items.some((it) => it.kind === 'camera' && it.mountTargetId)) return level
  let changed = false
  const items = level.items.flatMap((it) => {
    if (it.kind !== 'camera' || !it.mountTargetId || cameraSurface(it) === 'wall') return [it]
    const target = level.items.find((o) => o.id === it.mountTargetId)
    if (!target) {
      changed = true
      return []
    }
    const a = cameraAnchor(it, target)
    if (!a || (near(a.x, it.x) && near(a.z, it.z) && near(a.rot, it.rot) && near(a.y, it.y ?? 0))) return [it]
    changed = true
    return [{ ...it, x: a.x, z: a.z, rot: a.rot, y: a.y }]
  })
  return changed ? { ...level, items } : level
}
