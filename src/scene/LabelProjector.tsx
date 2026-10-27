import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { CATALOG } from '@/model/catalog'
import { labelPoint, rectBounds } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { presetRects, usePlacement } from '@/model/placement'
import { DEFAULT_Y } from './kit/registry'
import { labelEntries } from './labels'

/** Label id → 3D point; read from the current plan every frame (the label follows a moved room or item). */
function anchorFor(id: string, out: THREE.Vector3) {
  if (id === 'ghost') {
    const { target, result } = usePlacement.getState()
    if (!target || !result) return false
    if (target.type === 'room') {
      const b = rectBounds(presetRects(target.preset, result.rot))
      out.set(result.x + b.maxX / 2, 0.8, result.z + b.maxZ / 2)
    }
    else {
      const base = DEFAULT_Y[target.kind] ?? 0
      out.set(result.x, result.y != null ? result.y + CATALOG[target.kind].labelY - base : CATALOG[target.kind].labelY, result.z)
    }
    return true
  }
  const s = useLayout.getState()
  const level = activeLevel(s)
  if (!level) return false
  if (id.startsWith('room-')) {
    const r = level.rooms.find((x) => `room-${x.id}` === id)
    if (!r) return false
    const lp = labelPoint(r)
    out.set(lp.x, 0.15, lp.z)
    return true
  }
  if (id === 'selected-item' && s.selection?.type === 'item') {
    const selId = s.selection.id
    const it = level.items.find((x) => x.id === selId)
    if (!it) return false
    // labelY in the catalog is relative to the default height; shift it when the item is raised (e.g. on a table).
    const base = DEFAULT_Y[it.kind] ?? 0
    out.set(it.x, it.y != null ? it.y + CATALOG[it.kind].labelY - base : CATALOG[it.kind].labelY, it.z)
    return true
  }
  return false
}

export function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    for (const [id, el] of labelEntries()) {
      if (!anchorFor(id, v)) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      v.project(camera)
      const off = v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      // Leave unchanged labels alone: needless style writes strain the browser.
      const tf = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`
      if (el.dataset.tf !== tf) {
        el.dataset.tf = tf
        el.style.transform = tf
      }
      const vis = off ? 'hidden' : 'visible'
      if (el.style.visibility !== vis) el.style.visibility = vis
    }
  })
  return null
}
