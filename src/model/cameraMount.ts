
import type { Item } from './types'

export type CameraMountSurface =
  NonNullable<Item['mountSurface']>

export const CAMERA_BASE_HEIGHT = 2.3

export function cameraSurface(
  item: Item,
): CameraMountSurface {
  return item.kind === 'camera'
    ? (item.mountSurface ?? 'wall')
    : 'wall'
}

export function isCameraMountTarget(
  camera: Item,
  target: Item,
): boolean {
  switch (cameraSurface(camera)) {
    case 'tree':
      return target.kind === 'tree'
    case 'fence':
      return target.kind === 'fence'
    case 'gate':
      return target.kind === 'gate'
    default:
      return false
  }
}

export interface CameraAnchor {
  x: number
  z: number
  rot: number
  y: number
}

/** Default mounting heights, measured from the floor. */
export function defaultCameraHeight(
  surface: CameraMountSurface,
): number {
  switch (surface) {
    case 'tree':
      return 1.8
    case 'fence':
      return 0.85
    case 'gate':
      return 1.0
    default:
      return CAMERA_BASE_HEIGHT
  }
}

/**
 * Calculate a camera position from an existing support.
 *
 * x/z: camera position in world coordinates
 * rot: camera heading in radians
 * y: offset for the existing Camera model,
 *    which already draws at 2.3 m.
 */
export function cameraAnchor(
  camera: Item,
  target: Item,
): CameraAnchor | null {
  if (!isCameraMountTarget(camera, target)) return null

  const surface = cameraSurface(camera)
  const point = camera.mountPoint
  const yaw = ((camera.mountYaw ?? 0) * Math.PI) / 180

  const reversed =
    (surface === 'fence' || surface === 'gate') &&
    camera.mountSide === 'back'

  const rot = target.rot + yaw + (reversed ? Math.PI : 0)
  const height =
    camera.y != null
      ? CAMERA_BASE_HEIGHT + camera.y
      : defaultCameraHeight(surface)

  let localX = 0
  let localZ = 0

  if (surface === 'tree') {
    // Initial approximate trunk clearance.
    // We'll refine this using tree variant and size.
    localZ = 0.2
  }

  if (surface === 'fence') {
    const length = target.len ?? 2
    const posts = Math.max(1, Math.round(length / 1.2))
    const left = -length / 2 + 0.035
    const right = length / 2 - 0.035

    if (point === 'postLeft') {
      localX = left
    } else if (point === 'postRight') {
      localX = right
    } else if (point === 'postCenter') {
      const middle = Math.round(posts / 2)
      localX = left + middle * (right - left) / posts
    }

    localZ = point === 'panel' ? 0.1 : 0.12
  }

  if (surface === 'gate') {
    // Gate leaf moves, but the gate posts remain fixed.
    localX = point === 'postRight' ? 0.55 : -0.55
    localZ = 0.12
  }

    // Mount the camera on the opposite face of the support.
  if (reversed) localZ = -localZ

  // Convert support-local position to world coordinates.
  const c = Math.cos(target.rot)
  const s = Math.sin(target.rot)

return {
  x: target.x + localX * c + localZ * s,
  z: target.z - localX * s + localZ * c,
  rot,
  y: height - CAMERA_BASE_HEIGHT,
 }
}
/** Find and resolve a camera's selected supporting item. */
export function resolveCameraAnchor(
  camera: Item,
  items: Item[],
): CameraAnchor | null {
  if (camera.kind !== 'camera') return null
  if (!camera.mountTargetId) return null

  const target = items.find(
    (item) => item.id === camera.mountTargetId,
  )

  if (!target) return null

  return cameraAnchor(camera, target)
}
export type CameraMountData = Pick<
  Item,
  'mountSurface' |
  'mountTargetId' |
  'mountPoint' |
  'mountYaw' |
  'mountSide'
>

export function findCameraMount(
  items: Item[],
  x: number,
  z: number,
  maxDistance = 0.45,
): (CameraAnchor & CameraMountData) | null {
  let best: (CameraAnchor & CameraMountData) | null = null
  let bestDistance = maxDistance

  for (const target of items) {
    const surface = target.kind

    if (
      surface !== 'tree' &&
      surface !== 'fence' &&
      surface !== 'gate'
    ) continue

    const points: NonNullable<Item['mountPoint']>[] =
      surface === 'tree'
        ? ['trunk']
        : surface === 'fence'
          ? ['panel', 'postLeft', 'postCenter', 'postRight']
          : ['postLeft', 'postRight']

        // Determine which side of the support the pointer is on.
    const dx = x - target.x
    const dz = z - target.z

    const localZ =
      dx * Math.sin(target.rot) +
      dz * Math.cos(target.rot)

    const side: Item['mountSide'] =
      surface === 'tree'
        ? undefined
        : localZ < 0 ? 'back' : 'front'

    for (const point of points) {
    const mount: CameraMountData = {
      mountSurface: surface,
      mountTargetId: target.id,
      mountPoint: point,
      mountYaw: 0,
      mountSide: side,
      }

      const anchor = cameraAnchor(
        {
          id: 'preview',
          kind: 'camera',
          x,
          z,
          rot: 0,
          ...mount,
        },
        target,
      )

      if (!anchor) continue

      const distance = Math.hypot(
        x - anchor.x,
        z - anchor.z,
      )

      if (distance < bestDistance) {
        bestDistance = distance
        best = { ...anchor, ...mount }
      }
    }
  }

  return best
}
