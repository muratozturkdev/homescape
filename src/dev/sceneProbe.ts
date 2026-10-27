import * as THREE from 'three'
import { sceneRef } from '@/scene/frame'

/*
 * Scene probes for the test hooks (window.__homescape.pick, itemObject): first visible hit and an item's group in the
 * scene. Tests and debugging only; the app does not use them.
 */

const scene = () => sceneRef.scene as unknown as THREE.Scene | null

function visible(o: THREE.Object3D | null) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false
  return true
}
function itemOf(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.itemId === 'string') return p.userData.itemId
  return null
}

/** First visible hit from (x, y, z) in direction (dx, dy, dz): height, distance, item id */
export function pick(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
  const s = scene()
  if (!s) return null
  const r = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz).normalize())
  // Meshes only (raycasting a Sprite needs a camera)
  const meshes: THREE.Object3D[] = []
  s.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o)
  })
  const hit = r.intersectObjects(meshes, false).find((h) => visible(h.object))
  return hit ? { y: hit.point.y, distance: hit.distance, itemId: itemOf(hit.object) } : null
}

/** An item's group in the scene: its uuid (changes when rebuilt) and world height */
export function itemObject(id: string) {
  const s = scene()
  if (!s) return null
  let found: THREE.Object3D | null = null
  s.traverse((o) => {
    if (!found && o.userData.itemId === id) found = o
  })
  if (!found) return null
  const o = found as THREE.Object3D
  const p = o.getWorldPosition(new THREE.Vector3())
  return { uuid: o.uuid, y: p.y, visible: visible(o) }
}
