import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { placePill, quickPill, quickPoints, useQuickId } from '@/ui/quickState'
import { quickObjects } from './hoverTargets'

/*
 * Position of the quick on/off pill (ui/quickState.ts > placePill): the screen box of the pill's item is computed in every
 * drawn frame (the pill follows the item when the camera turns or zooms). The box is measured once from the item's visible
 * body: parts that ignore raycasts, such as glows, light pools and halos, do not count (a lamp's light on the floor must
 * not push the pill down). React does not re-render; the DOM is written only when the position changes.
 */

const local = new THREE.Box3()
const part = new THREE.Box3()
const inv = new THREE.Matrix4()
const rel = new THREE.Matrix4()
const v = new THREE.Vector3()
let boxOf: THREE.Object3D | null = null
/** Pointed point in the item's own group (stays on the same spot of the item when the camera turns) */
const hit = new THREE.Vector3()
let hitOf: object | null = null

/** Box of the item's body in its own group (raycastable, visible meshes) */
function measure(root: THREE.Object3D) {
  local.makeEmpty()
  root.updateWorldMatrix(true, true)
  inv.copy(root.matrixWorld).invert()
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.raycast !== THREE.Mesh.prototype.raycast) return
    const g = m.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    if (!g.boundingBox || g.boundingBox.isEmpty()) return
    local.union(part.copy(g.boundingBox).applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld)))
  })
  if (local.isEmpty()) local.set(v.set(-0.2, 0, -0.2), new THREE.Vector3(0.2, 0.6, 0.2))
  boxOf = root
}

export function QuickAnchor() {
  const invalidate = useThree((s) => s.invalidate)
  // Hovered or selected item (ui/quickState.ts > useQuickId)
  const id = useQuickId()
  useEffect(() => {
    boxOf = null
    if (id) invalidate()
  }, [id, invalidate])

  useFrame(({ camera, size }) => {
    if (!id || !quickPill.el) return
    const o = quickObjects.get(id)
    if (!o) return placePill(null, true)
    if (boxOf !== o) measure(o)
    const p = quickPoints.get(id) ?? null
    if (p !== hitOf) {
      hitOf = p
      if (p) hit.set(p.x, p.y, p.z).applyMatrix4(inv.copy(o.matrixWorld).invert())
    }
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    let behind = 0
    for (let k = 0; k < 8; k++) {
      v.set(k & 1 ? local.max.x : local.min.x, k & 2 ? local.max.y : local.min.y, k & 4 ? local.max.z : local.min.z)
      v.applyMatrix4(o.matrixWorld).project(camera)
      if (v.z > 1) behind++
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    // Behind the camera or fully off screen: the pill is hidden
    const off = behind === 8 || right < 0 || left > size.width || bottom < 0 || top > size.height
    let at: { x: number; y: number } | undefined
    if (hitOf && !off) {
      v.copy(hit).applyMatrix4(o.matrixWorld).project(camera)
      if (v.z <= 1) at = { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height }
    }
    placePill(off ? null : { left, right, top, bottom }, true, at)
  })
  return null
}
