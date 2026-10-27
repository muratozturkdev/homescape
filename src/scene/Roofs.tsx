import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { isOutdoor } from '@/model/geometry'
import { activeHomeId, activeLevel, FLOOR_H, useLayout } from '@/model/layoutStore'
import type { Level } from '@/model/types'
import { cameraApi, roofView, useView } from './camera'
import { markShadows } from './frame'
import { roofGeometry, type RoofGeo } from './roof'
import { weatherLight } from './weatherState'

/*
 * Roof display: homes have roofs, yet the inside stays visible. The shape is in scene/roof.ts. The setting is in the floor
 * menu (`useView.roof`):
 * - Auto (default): in view mode the roof shows while looking at the whole home from afar; when zooming in (the camera
 *   comes closer than the size of the home), focusing a room, selecting something, in edit mode and in the plan view, the
 *   roof lifts and fades (like the lid of a dollhouse) and comes down when zooming out. Exposed roofs of the floors below
 *   the active floor (a single storey garage next to a two storey home) follow the same rule.
 * - Always: the roof of the active floor is always shown too. Off: no roof.
 * In first person walk mode all floors and their roofs are drawn (the ceiling covers from inside). The roof is not
 * clickable (whatever is below it gets selected).
 */

const ROOF = '#b8644f'
const TRIM = '#eceef4'
const BRICK = '#a4553f'
/** Flat concrete roof: slab and parapet */
const SLAB = '#a3a7b0'
const PARAPET = '#d3d6dd'
const noRay = () => {}
/** Snow cover (scene/Weather.tsx > weatherLight.snow): the roof turns white, the edges a little */
const SNOW = new THREE.Color('#f4f7fb')
function snowOn(en: Entry, snow: number) {
  en.top.color.set(en.base).lerp(SNOW, snow * 0.85)
  en.trim.color.set(en.trimBase).lerp(SNOW, snow * 0.4)
}

/** What shapes the roof: indoor rooms of the floors and fireplaces (not rebuilt while an item is dragged) */
function sigOf(levels: Level[]) {
  return JSON.stringify(
    levels.map((l) => [
      l.id,
      l.elevation ?? 0,
      l.rooms.filter((r) => !isOutdoor(r)).map((r) => [r.x, r.z, r.w, r.d, r.parts ?? null]),
      l.items.filter((i) => i.kind === 'fireplace').map((i) => [i.x, i.z]),
    ]),
  )
}

interface Entry {
  id: string
  elevation: number
  geo: RoofGeo
  top: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  brick: THREE.MeshStandardMaterial
  base: string
  trimBase: string
}

const ease = (x: number) => x * x * (3 - 2 * x)

export function Roofs() {
  const sig = useLayout((s) => (s.layout ? sigOf(s.layout.levels) : ''))
  // Roof type of the home ("Roof type" in the floor menu; per home)
  const homeId = useLayout((s) => activeHomeId(s))
  const style = useView((s) => s.roofStyle[homeId] ?? 'tile')
  const entries = useMemo<Entry[]>(() => {
    const levels = (useLayout.getState().layout?.levels ?? []).filter((l) => (l.elevation ?? 0) >= 0)
    const flat = style === 'concrete'
    return levels.flatMap((l) => {
      const e = l.elevation ?? 0
      const geo = roofGeometry(
        l,
        levels.filter((o) => (o.elevation ?? 0) > e),
        style,
      )
      if (!geo) return []
      const top = new THREE.MeshStandardMaterial({ color: flat ? SLAB : ROOF, roughness: flat ? 0.95 : 0.82, flatShading: true, transparent: true })
      const trim = new THREE.MeshStandardMaterial({ color: flat ? PARAPET : TRIM, roughness: flat ? 0.9 : 0.7, transparent: true, side: THREE.DoubleSide })
      const brick = new THREE.MeshStandardMaterial({ color: BRICK, roughness: 0.9, transparent: true })
      return [{ id: l.id, elevation: e, geo, top, trim, brick, base: flat ? SLAB : ROOF, trimBase: flat ? PARAPET : TRIM }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, style])
  useEffect(
    () => () => {
      for (const e of entries) {
        e.geo.top.dispose()
        e.geo.trim.dispose()
        e.top.dispose()
        e.trim.dispose()
        e.brick.dispose()
      }
    },
    [entries],
  )

  const level = useLayout((s) => activeLevel(s))
  const mode = useLayout((s) => s.mode)
  const selected = useLayout((s) => Boolean(s.selection))
  const pref = useView((s) => s.roof)
  const plan = useView((s) => s.plan)
  const fps = useView((s) => s.fps)
  const lower = useView((s) => s.lowerFloors)
  const focus = useView((s) => s.focus)
  const e0 = level?.elevation ?? 0
  const groups = useRef(new Map<string, THREE.Group>())
  const alpha = useRef(new Map<string, number>())
  const near = useRef(false)
  const snowShown = useRef<{ entries: Entry[]; snow: number } | null>(null)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    let changing = false
    let covered = false
    // One nearness for the whole home (diagonal of the largest roof): all roofs lift and come down together
    const diag = Math.max(0, ...entries.map((en) => Math.hypot(en.geo.box.maxX - en.geo.box.minX, en.geo.box.maxZ - en.geo.box.minZ)))
    // Lifts when approaching the home: from slightly outside the home's diagonal
    const limit = Math.max(12, diag)
    const d = cameraApi.distance() ?? Infinity
    near.current = near.current ? d < limit * 1.15 : d < limit
    for (const en of entries) {
      const g = groups.current.get(en.id)
      if (!g) continue
      // Whether this floor is drawn (same rule as Scene > Levels)
      const drawn = fps || en.elevation === e0 || (lower && en.elevation < e0)
      let want = false
      if (pref !== 'off' && drawn) {
        // Exposed roofs of lower floors (garage) follow the same rule: they lift when zooming in
        if (fps || pref === 'on') want = true
        // Lifts when zooming in (threshold: the home's diagonal; 15% hysteresis on the way back, so it does not flicker)
        else if (mode === 'view' && !plan && focus.kind === 'house' && !selected) want = !near.current
      }
      const a0 = alpha.current.get(en.id)
      const a = a0 == null ? (want ? 1 : 0) : Math.max(0, Math.min(1, a0 + (want ? 1 : -1) * dt * 2.5))
      alpha.current.set(en.id, a)
      roofView.alpha[en.id] = a
      if (a0 !== a) changing = true
      g.visible = a > 0.01
      g.position.y = (en.elevation - e0) * FLOOR_H + (1 - ease(a)) * 2.5
      en.top.opacity = en.trim.opacity = en.brick.opacity = ease(a)
      if (en.elevation === e0 && a > 0.5) covered = true
    }
    const snow = Math.round(weatherLight.snow * 200) / 200
    if (snowShown.current?.entries !== entries || snowShown.current.snow !== snow) {
      snowShown.current = { entries, snow }
      for (const en of entries) snowOn(en, snow)
      changing = true
    }
    // While the roof is down the walls are full height (the home looks closed); once it lifts, walls facing the camera are cut again
    if (covered !== roofView.covered) {
      roofView.covered = covered
      changing = true
    }
    if (changing) {
      markShadows(1)
      state.invalidate()
    }
  })

  return (
    <>
      {entries.map((en) => (
        <group
          key={en.id}
          ref={(g) => {
            if (g) groups.current.set(en.id, g)
            else groups.current.delete(en.id)
          }}
          visible={false}
        >
          <mesh geometry={en.geo.top} material={en.top} castShadow receiveShadow raycast={noRay} />
          <mesh geometry={en.geo.trim} material={en.trim} castShadow raycast={noRay} />
          {en.geo.chimneys.map((c, i) => (
            <mesh key={i} position={[c.x, (c.y0 + c.y1) / 2, c.z]} material={en.brick} castShadow raycast={noRay}>
              <boxGeometry args={[0.6, c.y1 - c.y0, 0.6]} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  )
}
