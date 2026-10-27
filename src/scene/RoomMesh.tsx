import { useFrame, useThree, type ThreeElements, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { inRoom, isOutdoor, rectBounds, rectsOf, runOpenings, shiftRoom, snap, WALL_CUT_H, WALL_H, WALL_IN, WALL_INNER_H, WALL_T, wallRuns, type Opening, type Side, type WallRun } from '@/model/geometry'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'
import { activeLevel, FLOOR_H, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { magnetRoom, overlapsRoom } from '@/model/rules'
import type { FloorMaterial, Level, Rect, Room } from '@/model/types'
import { cameraApi, cameraKey, DRAG_PX, roofView, useView } from './camera'
import { markShadows } from './frame'
import { useAmbient } from './kit/effects'
import { C } from './kit/palette'
import { mat, rng } from './kit/primitives'
import { floorTexture, waterGlintTexture } from './kit/textures'
import { roadSub, roadTexture, type NetPiece, type RoadTexture } from './kit/roads'
import { StairwellRail } from './kit/outdoor'
import { ceilingHoles, railEdges, stairwellsOf, subtractRects, type Stairwell } from '@/model/stairwell'

/*
 * Room: a floor slab per part + wall runs along the outline of the union (geometry.ts > wallRuns).
 * Wall height: interior walls low (like a floor plan), exterior walls facing the camera cut, far exterior walls full
 * height. Recomputed every frame as the camera turns.
 */

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const NORMAL: Record<Side, [number, number]> = { back: [0, -1], front: [0, 1], left: [-1, 0], right: [1, 0] }
const OUT: Record<Side, number> = { back: -1, front: 1, left: -1, right: 1 }
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3()

/** Wall piece: [a0, a1] along the wall, [y0, y1] in height (between, below and above the openings). */
interface Piece {
  a0: number
  a1: number
  y0: number
  y1: number
}

function pieces(s0: number, s1: number, openings: Opening[]): Piece[] {
  const out: Piece[] = []
  let cursor = s0
  for (const op of [...openings].sort((a, b) => a.a0 - b.a0)) {
    const o0 = Math.max(op.a0, s0)
    const o1 = Math.min(op.a1, s1)
    if (o1 - o0 < 0.01) continue
    if (o0 > cursor) out.push({ a0: cursor, a1: o0, y0: 0, y1: WALL_H })
    if (op.y0 > 0) out.push({ a0: o0, a1: o1, y0: 0, y1: op.y0 })
    if (op.y1 < WALL_H) out.push({ a0: o0, a1: o1, y0: op.y1, y1: WALL_H })
    cursor = Math.max(cursor, o1)
  }
  if (s1 - cursor > 0.001) out.push({ a0: cursor, a1: s1, y0: 0, y1: WALL_H })
  return out
}

/** A wall run and the openings in it (passed to RoomMesh as a text signature). */
type RunData = WallRun & { openings: Opening[] }

/**
 * A wall stops clicks and hover: objects behind a visible wall cannot be selected. R3F only dispatches the ray among
 * objects with listeners; a wall without one could not get in the way, so the click went through to the item behind. With
 * the select tool the frontmost wall stops the event; the room drawing and area selection tools let it through. Does not
 * affect a captured drag (pointer capture): R3F still delivers to the captured object.
 */
const stopAtWall = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
  if (useLayout.getState().tool === 'select') e.stopPropagation()
}
const WALL_EVENTS = { onPointerDown: stopAtWall, onPointerMove: stopAtWall, onPointerOver: stopAtWall, onClick: stopAtWall, onDoubleClick: stopAtWall }

/**
 * Wall height: all low in the plan view; an interior wall, depending on the setting, full height (not cut while the camera
 * turns, hides what is behind; default) or low (floor plan); an exterior wall is cut when facing the camera, else full.
 */
function Wall({ run, interior, plan, innerFull, still, fps }: { run: RunData; interior: boolean; plan: boolean; innerFull: boolean; still?: boolean; fps?: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const h = useRef(WALL_H)
  const { horizontal, side, line, a0, a1, cx, cz, openings } = run
  // The wall is centered on the room boundary: an exterior wall has full thickness (half of it outside), a shared interior
  // wall only this room's half (the neighbor draws the other half, together one wall). The ends extend by WALL_IN: outer
  // corners and the inner corner of an L close, and it overlaps a straight neighboring run (same material, invisible).
  const thick = interior ? WALL_IN : WALL_T
  const fixed = interior ? line - OUT[side] * (WALL_IN / 2) : line
  const parts = useMemo(() => pieces(a0 - WALL_IN, a1 + WALL_IN, openings), [a0, a1, openings])
  const invalidate = useThree((s) => s.invalidate)
  const settled = useRef(false)
  // Re-layout when the pieces or the interior/exterior state change (on-demand rendering does not draw a frame by itself).
  useEffect(() => {
    settled.current = false
    invalidate()
  }, [parts, interior, plan, innerFull, invalidate])

  useFrame((state, dt) => {
    const { camera } = state
    let target = WALL_H
    // In first person walk mode all walls are full height (no cut or low walls)
    if (useView.getState().fps || roofView.covered) target = WALL_H
    else if (plan) target = WALL_INNER_H
    else if (interior) target = innerFull ? WALL_H : WALL_INNER_H
    else {
      const dx = camera.position.x - cx
      const dz = camera.position.z - cz
      const l = Math.hypot(dx, dz) || 1
      const [nx, nz] = NORMAL[side]
      if ((nx * dx + nz * dz) / l > 0.2) target = WALL_CUT_H
    }
    const d = target - h.current
    if (Math.abs(d) < 0.001 && settled.current) return
    h.current = Math.abs(d) < 0.001 ? target : h.current + d * Math.min(1, dt * 8)
    settled.current = h.current === target
    // Update the shadows too while the height changes; request frames until done.
    markShadows(1)
    if (!settled.current) state.invalidate()
    parts.forEach((p, i) => {
      const m = refs.current[i]
      if (!m) return
      const top = Math.min(p.y1, h.current)
      m.visible = top - p.y0 > 0.005
      m.scale.y = Math.max(0.001, top - p.y0)
      m.position.y = (p.y0 + top) / 2
    })
  })

  return (
    <group>
      {parts.map((p, i) => {
        const mid = (p.a0 + p.a1) / 2
        const len = p.a1 - p.a0
        return (
          <mesh
            key={`${p.a0.toFixed(3)}-${p.y0}`}
            ref={(m) => {
              refs.current[i] = m
            }}
            geometry={unitBox}
            material={fps ? wallFpsMat : mat(C.wall)}
            position={horizontal ? [mid, (p.y0 + p.y1) / 2, fixed] : [fixed, (p.y0 + p.y1) / 2, mid]}
            scale={horizontal ? [len, p.y1 - p.y0, thick] : [thick, p.y1 - p.y0, len]}
            castShadow
            receiveShadow
            {...(still ? {} : WALL_EVENTS)}
          />
        )
      })}
    </group>
  )
}

/**
 * Balcony and terrace railing (outdoor): 1 m high along the edges facing open space, steel posts, a top rail and frosted
 * glass panels. No railing on the edge facing the house (the house wall is there).
 */
const RAIL_H = 1
/** Ceiling in first person walk mode: only visible from below (does not block the bird's eye camera). */
const ceilingMat = new THREE.MeshStandardMaterial({ color: '#fbfbff', side: THREE.FrontSide, roughness: 0.9 })
/**
 * Ceiling that blocks the sun in walk mode (sunlight only enters through windows and doors) without light leaking at the
 * corners:
 * - The ceiling's shadow is cast by an invisible thick block above it (ROOF_T, out to the outer faces of the walls), not
 *   by the paper-thin plane. With the plane as caster, caster and receiver had the same depth where the wall meets the
 *   ceiling, and the shadow bias let light leak through as a jagged line. The block's top is 30 cm higher: outside the bias.
 * - Walls enter the shadow map with both faces (the sun-facing outer face is recorded): this removes the vertical line
 *   leaking at a corner where two walls meet, which had the same depth as the other wall's inner face.
 * The block only casts shadows: it writes no color or depth and is not clickable.
 */
const ROOF_T = 0.3
const roofShadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide })
const wallFpsMat = (() => {
  const m = mat(C.wall).clone()
  m.shadowSide = THREE.DoubleSide
  return m
})()
const noRaycast = () => null
const railGlass = new THREE.MeshStandardMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false })
function Railing({ run }: { run: RunData }) {
  const steel = mat(C.inkSoft)
  const { horizontal, line, a0, a1 } = run
  const len = a1 - a0
  const n = Math.max(1, Math.round(len / 1.2))
  const at = (a: number, y: number): [number, number, number] => (horizontal ? [a, y, line] : [line, y, a])
  const along = (l: number, h: number, t: number): [number, number, number] => (horizontal ? [l, h, t] : [t, h, l])
  return (
    <group>
      <mesh geometry={unitBox} material={steel} position={at((a0 + a1) / 2, RAIL_H)} scale={along(len, 0.05, 0.06)} castShadow />
      <mesh geometry={unitBox} material={railGlass} position={at((a0 + a1) / 2, RAIL_H / 2 + 0.03)} scale={along(len - 0.04, RAIL_H - 0.12, 0.015)} renderOrder={2} />
      {Array.from({ length: n + 1 }, (_, i) => (
        <mesh key={i} geometry={unitBox} material={steel} position={at(a0 + (len * i) / n, RAIL_H / 2)} scale={along(0.04, RAIL_H, 0.04)} castShadow />
      ))}
    </group>
  )
}

/** Outline of the selected room: a thin brand blue line along the wall runs (correct for L shapes too). */
function Outline({ runs }: { runs: RunData[] }) {
  const m = mat(C.brand)
  const t = 0.05
  return (
    <group>
      {runs.map((r, i) => {
        const fixed = r.line - OUT[r.side] * (t / 2)
        const mid = (r.a0 + r.a1) / 2
        const len = r.a1 - r.a0
        return (
          <mesh
            key={i}
            material={m}
            geometry={unitBox}
            position={r.horizontal ? [mid, 0.02, fixed] : [fixed, 0.02, mid]}
            scale={r.horizontal ? [len, 0.02, t] : [t, 0.02, len]}
          />
        )
      })}
    </group>
  )
}

/*
 * Edges of outdoor grounds (to model the outside, like the front of a house): a concrete curb on sidewalk edges facing a
 * road, grass, gravel, water or open space (7 cm above the ground, 15 cm wide); none on edges facing a neighbor with the
 * same ground, the house, a terrace or concrete. The sidewalk surface is not raised: items stand on the ground (y 0), and a
 * raised sidewalk would bury lamps and benches. A pond is 4 cm below the ground (water surface) with round stones along
 * its edge (except edges joining another pond); a glint layer drifts slowly over the water.
 */
const CURB_W = 0.15
const CURB_H = 0.07
const CURB_FACING: FloorMaterial[] = ['road', 'crosswalk', 'parking', 'grass', 'gravel', 'water']
const WATER_Y = -0.04
const curbMat = mat('#eceef4', { roughness: 0.9 })
const rimMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 })
const RIM_STONES = ['#cfc8bb', '#bdb5a6', '#ddd7cc', '#aea795', '#c7c2b8']

/** Pond edge stones: a flat, irregular stone every ~30 cm along each run (one merged geometry, vertex colors). */
function pondRimGeometry(runs: WallRun[]) {
  const base = new THREE.IcosahedronGeometry(1, 0)
  const parts: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const col = new THREE.Color()
  for (const r of runs) {
    const len = r.a1 - r.a0
    const n = Math.max(2, Math.ceil(len / 0.24))
    const rnd = rng(Math.round((r.line * 7 + r.a0 * 13) * 100) + 5)
    for (let i = 0; i <= n; i++) {
      const a = r.a0 + (len * i) / n
      const inset = r.line - OUT[r.side] * (0.09 + rnd() * 0.04)
      const rad = 0.1 + rnd() * 0.045
      const g = base.clone().toNonIndexed()
      g.deleteAttribute('uv')
      m.compose(new THREE.Vector3(r.horizontal ? a : inset, 0.015, r.horizontal ? inset : a), q.setFromEuler(e.set(rnd() * 0.3, rnd() * 6, rnd() * 0.3)), new THREE.Vector3(rad * (1 + rnd() * 0.3), rad * 0.45, rad))
      g.applyMatrix4(m)
      col.set(RIM_STONES[Math.floor(rnd() * RIM_STONES.length)])
      const c = new Float32Array(g.attributes.position.count * 3)
      for (let k = 0; k < c.length; k += 3) c.set([col.r, col.g, col.b], k)
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      parts.push(g)
    }
  }
  base.dispose()
  const out = parts.length ? mergeGeometries(parts, false) : new THREE.BufferGeometry()
  for (const g of parts) g.dispose()
  return out
}

/**
 * Sidewalk curb or pond stones along the given edge runs (runs are drawn towards the inside of the room). The build bar
 * thumbnail uses it too.
 */
export function GroundEdging({ runs, floor }: { runs: WallRun[]; floor: FloorMaterial }) {
  const stones = useMemo(() => (floor === 'water' ? pondRimGeometry(runs) : null), [floor, runs])
  useEffect(() => () => stones?.dispose(), [stones])
  if (stones) return <mesh geometry={stones} material={rimMat} castShadow receiveShadow raycast={noRaycast} />
  return (
    <group>
      {runs.map((r, i) => {
        const fixed = r.line - OUT[r.side] * (CURB_W / 2)
        const mid = (r.a0 + r.a1) / 2
        const len = r.a1 - r.a0
        return (
          <mesh
            key={i}
            geometry={unitBox}
            material={curbMat}
            position={r.horizontal ? [mid, CURB_H / 2, fixed] : [fixed, CURB_H / 2, mid]}
            scale={r.horizontal ? [len, CURB_H, CURB_W] : [CURB_W, CURB_H, len]}
            castShadow
            receiveShadow
            raycast={noRaycast}
          />
        )
      })}
    </group>
  )
}

/** Glint drifting over the pond water (slow ambient animation; stops on statically drawn lower floors and in lite mode). */
function WaterGlint({ rect, y, still }: { rect: Rect; y: number; still: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const m = useMemo(() => {
    const t = waterGlintTexture().clone()
    t.needsUpdate = true
    t.repeat.set(rect.w / 2.4, rect.d / 2.4)
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.6, depthWrite: false })
  }, [rect.w, rect.d])
  useEffect(
    () => () => {
      m.map?.dispose()
      m.dispose()
    },
    [m],
  )
  useAmbient(!still, true)
  useFrame((_, dt) => {
    const map = (ref.current?.material as THREE.MeshBasicMaterial | undefined)?.map
    if (still || !map) return
    const s = Math.min(dt, 0.1)
    map.offset.x = (map.offset.x + s * 0.03) % 1
    map.offset.y = (map.offset.y + s * 0.017) % 1
  })
  return (
    <mesh ref={ref} position={[rect.x + rect.w / 2, y, rect.z + rect.d / 2]} rotation-x={-Math.PI / 2} material={m} renderOrder={2} raycast={noRaycast}>
      <planeGeometry args={[rect.w, rect.d]} />
    </mesh>
  )
}

/** Road grounds whose traffic flow connects: road and crosswalk. */
const ROADWAY: FloorMaterial[] = ['road', 'crosswalk']

/**
 * Traffic direction of a road part: x when its left or right edge connects (at least 0.9 m) to another road or crosswalk
 * part, z when its front or back edge does; null when both or neither (the long side wins). A short in-between road
 * part (the 5 × 7 m on the other side of the crosswalk) is thus drawn in the same direction as the main road.
 */
function roadFlow(r: Rect, others: Rect[]): 'x' | 'z' | null {
  let x = false
  let z = false
  for (const o of others) {
    const zOver = Math.min(r.z + r.d, o.z + o.d) - Math.max(r.z, o.z)
    const xOver = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)
    if (zOver > 0.9 && (Math.abs(o.x + o.w - r.x) < 0.02 || Math.abs(r.x + r.w - o.x) < 0.02)) x = true
    if (xOver > 0.9 && (Math.abs(o.z + o.d - r.z) < 0.02 || Math.abs(r.z + r.d - o.z) < 0.02)) z = true
  }
  return x === z ? null : x ? 'x' : 'z'
}

/** A sub-region of the whole part's texture (the pieces around a stairwell continue the pattern without shifting) */
function subTex(t: THREE.Texture, full: Rect, r: Rect) {
  const rx = t.repeat.x
  const ry = t.repeat.y
  t.offset.set(t.offset.x + ((r.x - full.x) / full.w) * rx, t.offset.y + ((full.z + full.d - r.z - r.d) / full.d) * ry)
  t.repeat.set((r.w / full.w) * rx, (r.d / full.d) * ry)
  return t
}

/** Floor slab of a part. Overlapping parts are raised a millimeter each so they do not z-fight. full: the whole part when split by a hole */
function Floor({ rect, full, floor, index, handlers, still, flow, road }: { rect: Rect; full?: Rect; floor: Room['floor']; index: number; handlers: ThreeElements['mesh']; still: boolean; flow?: 'x' | 'z' | null; road?: RoadTexture | null }) {
  // On a road the texture comes from the room's road network canvas (kit/roads.ts): the part samples its own region
  const tex = useMemo(
    () => (road ? roadSub(road, rect) : full ? subTex(floorTexture(floor, full.w, full.d, flow), full, rect) : floorTexture(floor, rect.w, rect.d, flow)),
    [road, floor, rect, full, flow],
  )
  useEffect(() => () => tex.dispose(), [tex])
  const water = floor === 'water'
  const top = (water ? WATER_Y : 0) + index * 0.001
  return (
    <>
      <mesh position={[rect.x + rect.w / 2, top - 0.06, rect.z + rect.d / 2]} receiveShadow {...handlers}>
        <boxGeometry args={[rect.w, 0.12, rect.d]} />
        <meshStandardMaterial attach="material-0" color={C.white} />
        <meshStandardMaterial attach="material-1" color={C.white} />
        <meshStandardMaterial attach="material-2" map={tex} roughness={water ? 0.12 : 0.85} metalness={water ? 0.08 : 0} />
        <meshStandardMaterial attach="material-3" color={C.white} />
        <meshStandardMaterial attach="material-4" color={C.white} />
        <meshStandardMaterial attach="material-5" color={C.white} />
      </mesh>
      {water && <WaterGlint rect={rect} y={top + 0.004} still={still} />}
    </>
  )
}

/**
 * With level the room is drawn statically (floors below the active floor, Scene > LowerLevels): that floor's walls, no
 * selection and no clicks.
 */
export function RoomMesh({ room, level: fixed, still: stillProp }: { room: Room; rooms: Room[]; level?: Level; still?: boolean }) {
  // Inactive floor (Scene > Levels): not clickable or selectable; the component stays the same so a floor change does not rebuild it
  const still = stillProp ?? Boolean(fixed)
  const selected = useLayout((s) => !still && ((s.selection?.type === 'room' && s.selection.id === room.id) || Boolean(s.multi?.rooms.includes(room.id))))
  const plan = useView((s) => s.plan)
  const innerFull = useView((s) => s.innerWalls === 'full')
  const fps = useView((s) => s.fps)
  // In first person walk mode indoor rooms get a ceiling; not over the stairs (stairwell)
  const stairwell = useLayout((s) => (fixed ?? activeLevel(s))?.items.some((it) => it.kind === 'stairs' && inRoom(room, it.x, it.z)) ?? false)
  // Stairwells (model/stairwell.ts): the hole that stairs on the floor below open in this room's floor; the hole that
  // stairs in this room open in the ceiling (the ceiling is open there in walk mode)
  const wellSig = useLayout((s) => {
    const l = fixed ?? activeLevel(s)
    if (!l || !s.layout) return '[]'
    const mine = rectsOf(room)
    const hit = (r: Rect) => mine.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.z < q.z + q.d && r.z + r.d > q.z)
    return JSON.stringify(stairwellsOf(s.layout.levels, l).filter((w) => hit(w.r)))
  })
  const wells = useMemo(() => JSON.parse(wellSig) as Stairwell[], [wellSig])
  // Whether a floor is below: a band between floors under the exterior walls (the lower floor's wall ends at 2.6 m, the
  // upper floor starts at 2.8 m, which left a visible gap)
  const stacked = useLayout((s) => {
    const l = fixed ?? activeLevel(s)
    const e = l?.elevation ?? 0
    return e > 0 && Boolean(s.layout?.levels.some((o) => (o.elevation ?? 0) === e - 1))
  })
  const ceilSig = useLayout((s) => (stairwell ? JSON.stringify(ceilingHoles(fixed ?? activeLevel(s)!)) : '[]'))
  const ceilHoles = useMemo(() => JSON.parse(ceilSig) as Rect[], [ceilSig])
  // Wall runs and openings are selected by text signature: walls are not rebuilt while other items are dragged.
  const sig = useLayout((s) => {
    const l = fixed ?? activeLevel(s)
    if (!l) return '[]'
    const me = l.rooms.find((r) => r.id === room.id) ?? room
    return JSON.stringify(wallRuns(me, l.rooms).map((r) => ({ ...r, openings: runOpenings(r, l.items) })))
  })
  const runs = useMemo(() => JSON.parse(sig) as RunData[], [sig])
  const rects = useMemo(() => rectsOf(room), [room])
  const kind = room.type ?? 'room'
  const outdoor = isOutdoor(room)
  // Edges for sidewalk curbs and pond stones: the curb on edges facing a road, grass, water or open space; for a pond all
  // edges except those joining another pond (by text signature: not rebuilt while an item is dragged)
  const edging = outdoor && (room.floor === 'sidewalk' || room.floor === 'water') ? room.floor : null
  const edgeSig = useLayout((s) => {
    if (!edging) return '[]'
    const l = fixed ?? activeLevel(s)
    if (!l) return '[]'
    const me = l.rooms.find((r) => r.id === room.id) ?? room
    const quiet = l.rooms.filter((o) => o.id !== me.id && (edging === 'water' ? o.floor === 'water' : !(isOutdoor(o) && CURB_FACING.includes(o.floor))))
    return JSON.stringify(wallRuns(me, [me, ...quiet]))
  })
  const edgeRuns = useMemo(() => JSON.parse(edgeSig) as WallRun[], [edgeSig])
  // Traffic direction of every road and crosswalk part (from neighboring road parts; parts of the same room count too)
  const flowSig = useLayout((s) => {
    if (!ROADWAY.includes(room.floor)) return ''
    const l = fixed ?? activeLevel(s)
    const me = l?.rooms.find((r) => r.id === room.id) ?? room
    const mine = rectsOf(me)
    const others = (l?.rooms ?? []).filter((o) => o.id !== me.id && ROADWAY.includes(o.floor)).flatMap(rectsOf)
    return mine.map((r, i) => roadFlow(r, [...others, ...mine.filter((_, j) => j !== i)]) ?? '-').join(',')
  })
  const flows = flowSig ? flowSig.split(',').map((f) => (f === '-' ? null : (f as 'x' | 'z'))) : []
  // Road: markings are drawn for the whole road network at once (L, T, junction; kit/roads.ts). Network: this room's parts
  // and the other road and crosswalk rooms (by text signature: not redrawn while an item is dragged)
  const netSig = useLayout((s) => {
    if (room.floor !== 'road') return ''
    const l = fixed ?? activeLevel(s)
    const me = l?.rooms.find((r) => r.id === room.id) ?? room
    const pieces: NetPiece[] = [
      ...rectsOf(me).map((r) => ({ r, kind: 'road' as const })),
      ...(l?.rooms ?? []).filter((o) => o.id !== me.id && ROADWAY.includes(o.floor)).flatMap((o) => rectsOf(o).map((r) => ({ r, kind: o.floor === 'road' ? ('road' as const) : ('crosswalk' as const) }))),
    ]
    return JSON.stringify({ mine: rectsOf(me), pieces })
  })
  const road = useMemo(() => {
    if (!netSig) return null
    const { mine, pieces } = JSON.parse(netSig) as { mine: Rect[]; pieces: NetPiece[] }
    return roadTexture(mine, pieces)
  }, [netSig])
  useEffect(() => () => road?.tex.dispose(), [road])
  // The selection line of an outdoor area follows all edges (its runs are only the edges facing open space)
  const edges = useMemo(() => (outdoor ? wallRuns(room, []).map((r) => ({ ...r, openings: [] })) : null), [outdoor, room])
  const drag = useRef<{ x: number; z: number; bx: number; bz: number; sx: number; sy: number; started: boolean; blocked: boolean } | null>(null)

  /*
   * A room can be dragged (with all its parts) only when it is ALREADY SELECTED and in edit mode.
   * Dragging on the floor of an unselected room rotates the camera; clicking selects the room.
   * While moving, the edges snap to neighboring rooms (magnet); it cannot overlap another room.
   */
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const s = useLayout.getState()
    if (s.mode !== 'edit' || s.tool !== 'select' || e.button !== 0 || cameraKey() || usePlacement.getState().target) return
    if (!(s.selection?.type === 'room' && s.selection.id === room.id) || !e.ray.intersectPlane(plane, hit)) return
    e.stopPropagation()
    const b = rectBounds(rectsOf(room))
    drag.current = { x: hit.x, z: hit.z, bx: b.minX, bz: b.minZ, sx: e.nativeEvent.clientX, sy: e.nativeEvent.clientY, started: false, blocked: false }
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    cameraApi.setEnabled(false)
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || !e.ray.intersectPlane(plane, hit)) return
    if (!d.started) {
      if (Math.hypot(e.nativeEvent.clientX - d.sx, e.nativeEvent.clientY - d.sy) < DRAG_PX) return
      d.started = true
      useLayout.getState().checkpoint()
    }
    const level = activeLevel(useLayout.getState())
    const cur = level?.rooms.find((r) => r.id === room.id)
    if (!level || !cur) return
    // The room's bounding box snaps to neighbors; all parts shift by the same amount.
    const b = rectBounds(rectsOf(cur))
    const box = { x: d.bx + snap(hit.x - d.x, 0.25), z: d.bz + snap(hit.z - d.z, 0.25), w: b.maxX - b.minX, d: b.maxZ - b.minZ }
    const cand = magnetRoom(box, level.rooms, cur.id)
    const dx = cand.x - b.minX
    const dz = cand.z - b.minZ
    if (!dx && !dz) return
    if (overlapsRoom(rectsOf(shiftRoom(cur, dx, dz)), level.rooms, cur.id)) {
      if (!d.blocked) useHa.setState({ notice: t('Rooms cannot overlap.') })
      d.blocked = true
      return
    }
    useLayout.getState().moveRoom(cur.id, dx, dz)
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    drag.current = null
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    cameraApi.setEnabled(true)
  }
  const handlers: ThreeElements['mesh'] = still ? {} : {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onClick: (e) => {
      const s = useLayout.getState()
      if (s.tool !== 'select' || e.delta > DRAG_PX || cameraKey() || usePlacement.getState().target) return
      e.stopPropagation()
      s.select({ type: 'room', id: room.id })
    },
    onDoubleClick: (e) => {
      e.stopPropagation()
      useView.getState().request({ kind: 'room', id: room.id })
    },
  }

  return (
    <group>
      {rects.map((r, i) => {
        const pieces = wells.length && !road ? subtractRects(r, wells.map((w) => w.r)) : null
        if (!pieces || (pieces.length === 1 && pieces[0].w === r.w && pieces[0].d === r.d))
          return <Floor key={i} rect={road?.rects[i] ?? r} floor={room.floor} index={i} handlers={handlers} still={still} flow={flows[i]} road={road} />
        return pieces.map((p, k) => <Floor key={`${i}-${k}`} rect={p} full={r} floor={room.floor} index={i} handlers={handlers} still={still} flow={flows[i]} road={null} />)
      })}
      {/* Stairwell railing (except the arrival end and edges along a wall) */}
      {wells
        .filter((w) => inRoom(room, w.r.x + w.r.w / 2, w.r.z + w.r.d / 2))
        .map((w) => (
          <StairwellRail key={w.id} edges={railEdges(w, rects)} />
        ))}
      {edging && edgeRuns.length > 0 && <GroundEdging runs={edgeRuns} floor={edging} />}
      {!outdoor &&
        runs.map((r) => <Wall key={`${r.side}${r.line.toFixed(3)}${r.a0.toFixed(3)}`} run={r} interior={r.interior} plan={plan} innerFull={innerFull} still={still} fps={fps && !still} />)}
      {stacked &&
        !outdoor &&
        runs
          .filter((r) => !r.interior)
          .map((r) => {
            const a0 = r.a0 - WALL_IN
            const a1 = r.a1 + WALL_IN
            const mid = (a0 + a1) / 2
            const band = FLOOR_H - WALL_H + 0.01
            return (
              <mesh
                key={`b${r.side}${r.line.toFixed(3)}${r.a0.toFixed(3)}`}
                geometry={unitBox}
                material={mat(C.wall)}
                position={r.horizontal ? [mid, -band / 2 + 0.005, r.line] : [r.line, -band / 2 + 0.005, mid]}
                scale={r.horizontal ? [a1 - a0, band, WALL_T] : [WALL_T, band, a1 - a0]}
                castShadow
                receiveShadow
                {...(still ? {} : WALL_EVENTS)}
              />
            )
          })}
      {(kind === 'balcony' || kind === 'terrace') && runs.map((r) => <Railing key={`${r.side}${r.line.toFixed(3)}${r.a0.toFixed(3)}`} run={r} />)}
      {selected && <Outline runs={edges ?? runs} />}
      {fps &&
        !outdoor &&
        rects.flatMap((r, i) =>
          // Parts overhang by 2 cm (onto the wall): no hairline gap between two ceiling parts in an L room; the ceiling is
          // open above the stairs (stairwell)
          (ceilHoles.length ? subtractRects(r, ceilHoles) : [r]).map((q, k) => {
            const grow = q === r ? 0.04 : 0
            return (
              <mesh key={`c${i}-${k}`} position={[q.x + q.w / 2, WALL_H + 0.001 * i, q.z + q.d / 2]} rotation-x={Math.PI / 2} material={ceilingMat}>
                <planeGeometry args={[q.w + grow, q.d + grow]} />
              </mesh>
            )
          }),
        )}
      {/* No sun from above in the stairwell either (the upper floor and the roof block it): the block is there too */}
      {fps &&
        !outdoor &&
        rects.map((r, i) => (
          <mesh key={`s${i}`} geometry={unitBox} material={roofShadowMat} position={[r.x + r.w / 2, WALL_H + ROOF_T / 2, r.z + r.d / 2]} scale={[r.w + WALL_T, ROOF_T, r.d + WALL_T]} castShadow raycast={noRaycast} />
        ))}
    </group>
  )
}
