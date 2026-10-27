import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'
import { rectsOf, snap } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { magnetEdge, overlapsRoom } from '@/model/rules'
import type { Rect, Room } from '@/model/types'
import { cameraApi, cameraKey, clickSlop, pointerKind, useView } from './camera'
import { C } from './kit/palette'
import { mat } from './kit/primitives'
import { weatherLight } from './weatherState'

/*
 * Ground and editing tools:
 * - Clicking empty space clears the selection (dragging and releasing does not).
 * - "Free draw": drag on the ground to draw a room; edges snap to neighboring rooms, rooms cannot overlap.
 * - "Add part": draw a rectangular part on the selected room (L, T, U shapes); it must touch or overlap the room and
 *   cannot overlap another room. There is no wall where parts join.
 * - The edge handles of the selected room change its size; they snap to neighbors and never overlap them.
 * - While placing (build bar) the ground does nothing; Ghost and usePlacementInput do the work.
 */

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3()
const MIN = 1
/** Minimum part size (smaller than a room, for narrow parts such as a hallway arm) */
const MIN_PART = 0.5
const busy = () => Boolean(usePlacement.getState().target) || cameraKey()
const notice = (msg: string) => useHa.setState({ notice: msg })

type Draft = { x0: number; z0: number; x1: number; z1: number }

const rectOf = (d: Draft) => ({ x: Math.min(d.x0, d.x1), z: Math.min(d.z0, d.z1), w: Math.abs(d.x1 - d.x0), d: Math.abs(d.z1 - d.z0) })

/** Whether the part overlaps the room or shares at least 0.5 m of edge with it (so the union stays one piece). */
function touchesRoom(r: Rect, room: Room) {
  return rectsOf(room).some((p) => {
    const ox = Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x)
    const oz = Math.min(r.z + r.d, p.z + p.d) - Math.max(r.z, p.z)
    return (ox > 0.01 && oz > 0.01) || (Math.abs(oz) < 0.02 && ox >= 0.5) || (Math.abs(ox) < 0.02 && oz >= 0.5)
  })
}

const selectedRoom = () => {
  const s = useLayout.getState()
  return s.selection?.type === 'room' ? activeLevel(s)?.rooms.find((r) => r.id === s.selection!.id) : undefined
}

/** Area selection: rooms fully inside the box and items whose position is in the box. */
function pickArea(r: Rect) {
  const level = activeLevel(useLayout.getState())
  if (!level) return { rooms: [], items: [] }
  const e = 0.02
  const inBox = (x: number, z: number) => x >= r.x - e && x <= r.x + r.w + e && z >= r.z - e && z <= r.z + r.d + e
  return {
    rooms: level.rooms.filter((rm) => rectsOf(rm).every((p) => inBox(p.x, p.z) && inBox(p.x + p.w, p.z + p.d))).map((rm) => rm.id),
    items: level.items.filter((it) => inBox(it.x, it.z)).map((it) => it.id),
  }
}

/** Why the drawn rectangle is invalid, if it is (for the room or the part tool). */
function draftProblem(r: Rect, tool: 'room' | 'part', rooms: Room[]): string | null {
  if (tool === 'part') {
    const room = selectedRoom()
    if (!room) return t('First select the room to add the part to.')
    if (r.w < MIN_PART || r.d < MIN_PART) return t('A part must be at least {size} × {size} m.', { size: MIN_PART })
    if (!touchesRoom(r, room)) return t("The part must touch the room: start drawing at the room's edge.")
    if (overlapsRoom(r, rooms, room.id)) return t('Rooms cannot overlap.')
    return null
  }
  if (r.w < MIN || r.d < MIN) return t('A room must be at least {size} × {size} m.', { size: MIN })
  if (overlapsRoom(r, rooms)) return t('Rooms cannot overlap.')
  return null
}

/** Ground color by weather: turns white under snow, darker when wet in the rain (scene/Weather.tsx > weatherLight) */
const SNOW_GROUND = new THREE.Color('#f1f4f8')
let groundKey = ''
function tintGround(m: THREE.MeshStandardMaterial, base: string) {
  const { snow, wet } = weatherLight
  const key = `${base},${snow.toFixed(3)},${wet.toFixed(3)}`
  if (key === groundKey) return
  groundKey = key
  m.color.set(base).lerp(SNOW_GROUND, snow * 0.9).multiplyScalar(1 - 0.14 * wet * (1 - snow))
}

/** y: height of the ground plane (on an upper floor it drops to the ground floor level so the lower floors show). */
export function Ground({ night, y = 0 }: { night: boolean; y?: number }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const drawing = useRef(false)
  const rooms = () => activeLevel(useLayout.getState())?.rooms ?? []

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const s = useLayout.getState()
    if (s.mode !== 'edit' || (s.tool !== 'room' && s.tool !== 'part' && s.tool !== 'area') || e.button !== 0 || busy()) return
    if (!e.ray.intersectPlane(plane, hit)) return
    e.stopPropagation()
    const area = s.tool === 'area'
    const x = area ? snap(hit.x, 0.05) : magnetEdge(snap(hit.x, 0.25), rooms(), 'x')
    const z = area ? snap(hit.z, 0.05) : magnetEdge(snap(hit.z, 0.25), rooms(), 'z')
    drawing.current = true
    setDraft({ x0: x, z0: z, x1: x, z1: z })
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drawing.current || !e.ray.intersectPlane(plane, hit)) return
    const area = useLayout.getState().tool === 'area'
    const x1 = area ? snap(hit.x, 0.05) : magnetEdge(snap(hit.x, 0.25), rooms(), 'x')
    const z1 = area ? snap(hit.z, 0.05) : magnetEdge(snap(hit.z, 0.25), rooms(), 'z')
    setDraft((d) => (d && (d.x1 !== x1 || d.z1 !== z1) ? { ...d, x1, z1 } : d))
  }

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drawing.current) return
    drawing.current = false
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    const d = draft
    setDraft(null)
    if (!d) return
    const r = rectOf(d)
    const s = useLayout.getState()
    if (s.tool === 'area') {
      const picked = pickArea(r)
      s.setTool('select')
      if (!picked.rooms.length && !picked.items.length) return notice(t('No rooms or items in the selected area.'))
      s.setMulti(picked)
      return
    }
    const tool = s.tool === 'part' ? 'part' : 'room'
    const problem = draftProblem(r, tool, rooms())
    if (problem) return notice(problem)
    if (tool === 'part') {
      const room = selectedRoom()!
      s.addPart(room.id, r)
      notice(t('Part added to {room}. Resize it with the handles; ⌘Z undoes.', { room: room.name }))
    } else s.addRoom({ name: t('Room {n}', { n: rooms().length + 1 }), ...r, floor: 'wood', areaId: null })
    s.setTool('select')
  }

  const tool = useLayout((s) => (s.tool === 'part' ? 'part' : s.tool === 'area' ? 'area' : 'room'))
  const fps = useView((s) => s.fps)
  const draftRect = draft ? rectOf(draft) : null
  const draftBad = draftRect && tool !== 'area' ? Boolean(draftProblem(draftRect, tool, rooms())) : false
  const ground = useRef<THREE.MeshStandardMaterial>(null)
  const base = night ? C.groundNight : fps ? '#a9b596' : C.ground
  useFrame(() => {
    if (ground.current) tintGround(ground.current, base)
  })

  return (
    <group>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, -0.125 + y, 0]}
        receiveShadow
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onClick={(e) => {
          // Dragging the camera and releasing must not clear the selection: real clicks only.
          const s = useLayout.getState()
          if (s.tool === 'select' && e.delta <= clickSlop(pointerKind.last) && !busy()) s.select(null)
        }}
        onDoubleClick={() => !busy() && useView.getState().request({ kind: 'house' })}
      >
        {/*
         * The edge lies beyond the camera's far plane (400 m): the fog grows with camera distance (Scene > FogRange), so the
         * edge of a 300 m ground poked out of the fog at low angles; now the ground is clipped where the fog is complete.
         */}
        <planeGeometry args={[1200, 1200]} />
        {/* In walk mode a grassy world shows through the windows (light lavender in the bird's eye view) */}
        <meshStandardMaterial ref={ground} roughness={1} />
      </mesh>
      {draftRect && (
        <mesh
          position={[draftRect.x + draftRect.w / 2, 0.06, draftRect.z + draftRect.d / 2]}
          scale={[Math.max(0.05, draftRect.w), 0.12, Math.max(0.05, draftRect.d)]}
          material={mat(draftBad ? C.alarm : tool === 'area' ? C.sun : C.brand, { opacity: tool === 'area' ? 0.22 : 0.35 })}
        >
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      )}
    </group>
  )
}

type Edge = 'left' | 'right' | 'back' | 'front'

/** Edge handle of a part (part = -1 for the main rectangle). */
function Handle({ room, part, edge }: { room: Room; part: number; edge: Edge }) {
  const [hover, setHover] = useState(false)
  const dragging = useRef<{ blocked: boolean } | null>(null)
  const rect = part < 0 ? room : room.parts![part]
  const pos: [number, number, number] =
    edge === 'left'
      ? [rect.x, 0.2, rect.z + rect.d / 2]
      : edge === 'right'
        ? [rect.x + rect.w, 0.2, rect.z + rect.d / 2]
        : edge === 'back'
          ? [rect.x + rect.w / 2, 0.2, rect.z]
          : [rect.x + rect.w / 2, 0.2, rect.z + rect.d]
  const horizontal = edge === 'back' || edge === 'front'

  return (
    <mesh
      position={pos}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = horizontal ? 'ns-resize' : 'ew-resize'
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ''
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || busy()) return
        e.stopPropagation()
        useLayout.getState().checkpoint()
        dragging.current = { blocked: false }
        ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
        cameraApi.setEnabled(false)
      }}
      onPointerMove={(e) => {
        if (!dragging.current || !e.ray.intersectPlane(plane, hit)) return
        const level = activeLevel(useLayout.getState())
        const room0 = level?.rooms.find((x) => x.id === room.id)
        const r = part < 0 ? room0 : room0?.parts?.[part]
        if (!level || !room0 || !r) return
        const min = part < 0 ? MIN : MIN_PART
        const v = magnetEdge(snap(horizontal ? hit.z : hit.x, 0.25), level.rooms, horizontal ? 'z' : 'x', room0.id)
        let patch: Partial<Rect> | null = null
        if (edge === 'right' && v - r.x >= min) patch = { w: v - r.x }
        if (edge === 'left' && r.x + r.w - v >= min) patch = { x: v, w: r.x + r.w - v }
        if (edge === 'front' && v - r.z >= min) patch = { d: v - r.z }
        if (edge === 'back' && r.z + r.d - v >= min) patch = { z: v, d: r.z + r.d - v }
        if (!patch) return
        const next = part < 0 ? { ...room0, ...patch } : { ...room0, parts: room0.parts!.map((p, i) => (i === part ? { ...p, ...patch } : p)) }
        if (overlapsRoom(rectsOf(next), level.rooms, room0.id)) {
          if (!dragging.current.blocked) notice(t('Rooms cannot overlap; stopped at the edge of the neighboring room.'))
          dragging.current.blocked = true
          return
        }
        // Items near that wall move with the edge (resizeEdge).
        useLayout.getState().resizeEdge(room0.id, part, edge, v, false)
      }}
      onPointerUp={(e) => {
        dragging.current = null
        ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
        cameraApi.setEnabled(true)
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <boxGeometry args={horizontal ? [0.7, 0.22, 0.22] : [0.22, 0.22, 0.7]} />
      <meshStandardMaterial color={hover ? C.sun : C.brand} />
    </mesh>
  )
}

/** Resize handles of the selected room in edit mode. */
export function RoomHandles() {
  const room = useLayout((s) => {
    if (s.mode !== 'edit' || s.selection?.type !== 'room') return null
    const id = s.selection.id
    return activeLevel(s)?.rooms.find((r) => r.id === id) ?? null
  })
  if (!room) return null
  // Four edge handles for the main rectangle and for every extra part.
  const parts = [-1, ...(room.parts ?? []).map((_, i) => i)]
  return (
    <group>
      {parts.flatMap((part) =>
        (['left', 'right', 'back', 'front'] as Edge[]).map((e) => <Handle key={`${part}-${e}`} room={room} part={part} edge={e} />),
      )}
    </group>
  )
}
