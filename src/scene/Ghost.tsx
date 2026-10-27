import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { t } from '@/i18n'
import { CATALOG, sizeOf } from '@/model/catalog'
import { ceilingFit, isAperture, rectBounds, snap, wallRuns, wallSnap } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { presetRects, usePlacement, type RoomPreset } from '@/model/placement'
import { APPLIANCE_STACK, checkItem, magnetRoom, overlapsRoom, snapsToWall, STACKABLE, surfaceAt } from '@/model/rules'
import { shelfAt } from '@/model/containers'
import type { Item, ItemKind } from '@/model/types'
import { C } from './kit/palette'
import { DEFAULT_Y, KIT } from './kit/registry'
import { OFF_VISUAL, type Visual } from './kit/visual'

/*
 * Placement ghost: follows the pointer, snaps to the grid and to walls, climbs onto a surface when there is one and checks
 * the rules. Writes the result to usePlacement; dropping happens in usePlacementInput in App.
 */

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
const hit = new THREE.Vector3()
const OK = new THREE.Color(C.ok)
const BAD = new THREE.Color(C.alarm)

const GHOST_VISUAL: Visual = { ...OFF_VISUAL, bound: true, on: true, level: 0.8, state: 'on', domain: 'light' }

/** Pointer point on the ground; null when the pointer is not over the canvas. */
function floorPoint(camera: THREE.Camera, canvas: HTMLCanvasElement) {
  const { screen, overCanvas } = usePlacement.getState()
  if (!screen || !overCanvas) return null
  const r = canvas.getBoundingClientRect()
  ndc.set(((screen.x - r.left) / r.width) * 2 - 1, -((screen.y - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  return raycaster.ray.intersectPlane(plane, hit)
}

/** Replaces the ghost's materials with translucent copies. */
function useGhostMaterials(ref: React.RefObject<THREE.Group | null>, key: string) {
  useLayoutEffect(() => {
    const made: THREE.Material[] = []
    ref.current?.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.material) return
      const swap = (src: THREE.Material) => {
        const c = src.clone()
        c.transparent = true
        c.opacity = Math.min(src.opacity, 0.62)
        c.depthWrite = false
        made.push(c)
        return c
      }
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material)
      m.castShadow = false
    })
    return () => made.forEach((m) => m.dispose())
  }, [ref, key])
}

function ItemGhost({ kind, extra }: { kind: ItemKind; extra?: Partial<Item> }) {
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const plate = useRef<THREE.MeshBasicMaterial>(null)
  const Comp = KIT[kind]
  const meta = CATALOG[kind]
  // TV: previewed on its stand (on top) when a TV unit/table is under the pointer, else wall mounted.
  const [variant, setVariant] = useState<string | undefined>(undefined)
  // The preset card's settings (height of a full-height window) show in the ghost too
  const ghostV = useMemo(
    () => (variant || extra ? { ...GHOST_VISUAL, opts: { len: extra?.len, len2: extra?.len2, variant: variant ?? extra?.variant, mount: extra?.mount }, at: { x: 0, z: 0, rot: 0, y: extra?.y } } : GHOST_VISUAL),
    [variant, extra],
  )
  useGhostMaterials(inner, `${kind}-${variant ?? ''}`)

  useFrame(({ camera, gl, clock, invalidate }) => {
    // Continuous rendering while placing, to follow the pointer (the user is interacting).
    invalidate()
    const g = outer.current
    const level = activeLevel(useLayout.getState())
    const p = floorPoint(camera, gl.domElement)
    if (!g || !level || !p) {
      if (g) g.visible = false
      usePlacement.getState().setResult(null)
      return
    }
    let x = snap(p.x, 0.05)
    let z = snap(p.z, 0.05)
    let rot = usePlacement.getState().rot
    let y: number | undefined
    let onWall = true
    if (snapsToWall(kind, extra?.mount)) {
      const w = wallSnap(level.rooms, x, z, meta.size[1], 1, sizeOf(kind, extra?.len)[0], isAperture(kind), extra?.mount === 'wall')
      if (w) ({ x, z, rot } = w)
      else onWall = false
    }
    if (STACKABLE.includes(kind) && extra?.mount !== 'wall') y = surfaceAt(level.items, x, z)?.y ?? shelfAt(level.items, x, z, kind)
    else if (APPLIANCE_STACK.includes(kind)) y = surfaceAt(level.items, x, z, undefined, APPLIANCE_STACK)?.y
    let tvMode: string | undefined
    if (kind === 'tv') {
      y = surfaceAt(level.items, x, z)?.y
      tvMode = y != null ? 'stand' : 'wall'
      if (tvMode !== variant) setVariant(tvMode)
    }
    if (extra?.y != null && y == null) y = extra.y
    const chk = checkItem(level, { kind, x, z, rot, y, variant: tvMode ?? extra?.variant, mount: extra?.mount, len: extra?.len, len2: extra?.len2 }, undefined, onWall)

    // A ceiling strip fits the room part under the pointer; the ghost stretches the 3 × 3 model to that size.
    const fit = kind === 'ceilingStrip' ? ceilingFit(level.rooms, x, z) : null
    if (fit) {
      x = fit.x
      z = fit.z
      rot = 0
      g.scale.set(fit.len / 3, 1, fit.len2 / 3)
    } else g.scale.set(1, 1, 1)
    g.visible = true
    g.position.set(x, 0, z)
    g.rotation.y = rot
    inner.current?.position.set(0, (y ?? DEFAULT_Y[kind] ?? 0) + Math.sin(clock.elapsedTime * 5) * 0.015 + 0.02, 0)
    plate.current?.color.copy(chk.ok ? OK : BAD)
    usePlacement.getState().setResult({ x, z, rot, y, ok: chk.ok, reason: chk.reason })
  })

  return (
    <group ref={outer} visible={false}>
      <group ref={inner}>
        <Comp key={variant ?? ''} v={ghostV} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} renderOrder={8}>
        <planeGeometry args={[meta.size[0] + 0.12, meta.size[1] + 0.12]} />
        <meshBasicMaterial ref={plate} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Preset room ghost: a floor per part + low walls along the outline; R rotates it by 90° (L shape). */
function RoomGhost({ preset }: { preset: RoomPreset }) {
  const g = useRef<THREE.Group>(null)
  const floors = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const rot = usePlacement((s) => s.rot)
  const rects = useMemo(() => presetRects(preset, rot), [preset, rot])
  const size = useMemo(() => rectBounds(rects), [rects])
  // Preview walls: wall runs of a temporary room (without neighbors).
  const runs = useMemo(() => wallRuns({ id: 'ghost', name: '', floor: 'wood', ...rects[0], parts: rects.slice(1) }, []), [rects])

  useFrame(({ camera, gl, invalidate }) => {
    invalidate()
    const level = activeLevel(useLayout.getState())
    const p = floorPoint(camera, gl.domElement)
    if (!g.current || !level || !p) {
      if (g.current) g.current.visible = false
      usePlacement.getState().setResult(null)
      return
    }
    const W = size.maxX
    const D = size.maxZ
    const o = magnetRoom({ x: snap(p.x - W / 2, 0.25), z: snap(p.z - D / 2, 0.25), w: W, d: D }, level.rooms)
    const placed = rects.map((r) => ({ ...r, x: r.x + o.x, z: r.z + o.z }))
    const ok = !overlapsRoom(placed, level.rooms)
    g.current.visible = true
    g.current.position.set(o.x, 0, o.z)
    for (const f of floors.current) f?.color.copy(ok ? OK : BAD)
    usePlacement.getState().setResult({ x: o.x, z: o.z, rot, ok, reason: ok ? undefined : t('Rooms cannot overlap') })
  })

  const thick = 0.1
  return (
    <group ref={g} visible={false}>
      {rects.map((r, i) => (
        <mesh key={i} geometry={unit} position={[r.x + r.w / 2, 0.03 + i * 0.001, r.z + r.d / 2]} scale={[r.w, 0.06, r.d]} renderOrder={8}>
          <meshBasicMaterial
            ref={(m) => {
              floors.current[i] = m
            }}
            transparent
            opacity={0.35}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {runs.map((r, i) => {
        // The wall is centered on the boundary, the ends extend by half the thickness (corners close); same as a real wall.
        const fixed = r.line
        const mid = (r.a0 + r.a1) / 2
        const len = r.a1 - r.a0 + thick
        return (
          <mesh key={i} geometry={unit} position={r.horizontal ? [mid, 0.2, fixed] : [fixed, 0.2, mid]} scale={r.horizontal ? [len, 0.4, thick] : [thick, 0.4, len]}>
            <meshStandardMaterial color={C.wall} transparent opacity={0.7} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}

export function Ghost() {
  const target = usePlacement((s) => s.target)
  if (!target) return null
  return target.type === 'item' ? (
    <ItemGhost key={`${target.kind}-${target.preset ?? ''}`} kind={target.kind} extra={target.extra} />
  ) : (
    <RoomGhost key={target.preset.label} preset={target.preset} />
  )
}
