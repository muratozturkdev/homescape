import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { CATALOG, isLightKind, ITEM_PRESETS } from '@/model/catalog'
import { wallRuns } from '@/model/geometry'
import { useThumbs } from '@/ui/thumbStore'
import type { FloorMaterial, ItemKind } from '@/model/types'
import { C } from './kit/palette'
import { Box } from './kit/primitives'
import { KIT } from './kit/registry'
import { floorTexture } from './kit/textures'
import { OFF_VISUAL, type Visual } from './kit/visual'
import { GroundEdging } from './RoomMesh'
import { withoutRoomLights } from './roomLights'

/*
 * Images of the cards in the bottom bar: the REAL 3D model of each item is drawn in turn on a small offscreen canvas and
 * stored as PNG. Once per session, in the background (~2 s).
 */

/**
 * Thumbnail of the outdoor ground cards (road, sidewalk, pond...): a slab with the ground's own texture. Sized per
 * ground so the road's center line, the crosswalk stripes and the parking bays show.
 */
const GROUND_THUMB: Partial<Record<FloorMaterial, [number, number]>> = { road: [6, 5], sidewalk: [3, 2], crosswalk: [2.5, 5], parking: [6, 5.5], gravel: [2.4, 1.8], water: [2.4, 1.8], grass: [2.4, 1.8], concrete: [2.4, 1.8] }

const KEYS: string[] = ['room', 'roomL', ...Object.keys(GROUND_THUMB).map((f) => `floor:${f}`), ...(Object.keys(CATALOG) as ItemKind[]), ...ITEM_PRESETS.map((p) => `preset:${p.id}`)]
const DIR = new THREE.Vector3(0.95, 0.8, 1.35).normalize()

function thumbVisual(kind: ItemKind): Visual {
  // Lamps (including those in other groups, such as garden lamps and string lights) and devices with screens look on in thumbnails
  const lit = isLightKind(kind) || kind === 'tv' || kind === 'monitor' || kind === 'console'
  return { ...OFF_VISUAL, bound: true, on: lit, level: lit ? 0.9 : 0, state: lit ? 'on' : 'off', domain: lit ? 'light' : '' }
}

function MiniRoom() {
  return (
    <group>
      <Box size={[3, 0.12, 2.6]} position={[0, -0.06, 0]} color={C.woodFloor} />
      <Box size={[3, 1, 0.1]} position={[0, 0.5, -1.25]} color={C.wall} />
      <Box size={[0.1, 1, 2.6]} position={[-1.45, 0.5, 0]} color={C.wall} />
      <Box size={[0.1, 0.18, 2.6]} position={[1.45, 0.09, 0]} color={C.wall} />
      <Box size={[3, 0.18, 0.1]} position={[0, 0.09, 1.25]} color={C.wall} />
    </group>
  )
}

/** Thumbnail of an L-shaped room: two floor parts, no wall on the shared edge. */
function MiniRoomL() {
  return (
    <group>
      <Box size={[3, 0.12, 1.1]} position={[0, -0.06, -0.75]} color={C.woodFloor} />
      <Box size={[1.1, 0.12, 1.5]} position={[-0.95, -0.06, 0.55]} color={C.woodFloor} />
      <Box size={[3, 1, 0.1]} position={[0, 0.5, -1.25]} color={C.wall} />
      <Box size={[0.1, 1, 2.6]} position={[-1.45, 0.5, 0]} color={C.wall} />
      <Box size={[0.1, 0.18, 1.1]} position={[1.45, 0.09, -0.75]} color={C.wall} />
      <Box size={[1.9, 0.18, 0.1]} position={[0.55, 0.09, -0.25]} color={C.wall} />
      <Box size={[0.1, 0.18, 1.5]} position={[-0.45, 0.09, 0.55]} color={C.wall} />
      <Box size={[1.1, 0.18, 0.1]} position={[-0.95, 0.09, 1.25]} color={C.wall} />
    </group>
  )
}

/** Ground slab: the ground texture on top, white sides; a curb in front of the sidewalk, stones around the pond. */
function MiniGround({ floor }: { floor: FloorMaterial }) {
  const [w, d] = GROUND_THUMB[floor] ?? [2.4, 1.8]
  const tex = useMemo(() => floorTexture(floor, w, d), [floor, w, d])
  useEffect(() => () => tex.dispose(), [tex])
  const runs = useMemo(() => {
    const all = wallRuns({ id: 'thumb', name: '', floor, x: -w / 2, z: -d / 2, w, d, type: 'garden' }, [])
    return floor === 'sidewalk' ? all.filter((r) => r.side === 'front') : all
  }, [floor, w, d])
  return (
    <group>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[w, 0.12, d]} />
        <meshStandardMaterial attach="material-0" color={C.white} />
        <meshStandardMaterial attach="material-1" color={C.white} />
        <meshStandardMaterial attach="material-2" map={tex} roughness={floor === 'water' ? 0.15 : 0.85} />
        <meshStandardMaterial attach="material-3" color={C.white} />
        <meshStandardMaterial attach="material-4" color={C.white} />
        <meshStandardMaterial attach="material-5" color={C.white} />
      </mesh>
      {(floor === 'sidewalk' || floor === 'water') && <GroundEdging runs={runs} floor={floor} />}
    </group>
  )
}

const visibleChain = (o: THREE.Object3D) => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false
  return true
}

function Capture() {
  const [i, setI] = useState(0)
  const group = useRef<THREE.Group>(null)
  const frame = useRef(0)
  const key = KEYS[i]

  useFrame(({ gl, scene, camera }) => {
    frame.current += 1
    const g = group.current
    if (!g) return
    if (frame.current === 2) {
      // Bounding box from visible meshes only (halos and hidden effects excluded).
      const box = new THREE.Box3()
      g.updateWorldMatrix(true, true)
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && visibleChain(o)) box.expandByObject(o, true)
      })
      const center = box.getCenter(new THREE.Vector3())
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.15)
      const cam = camera as THREE.PerspectiveCamera
      const dist = (radius / Math.sin((cam.fov * Math.PI) / 360)) * 1.02
      cam.position.copy(center).addScaledVector(DIR, dist)
      cam.near = dist / 50
      cam.far = dist * 10
      cam.lookAt(center)
      cam.updateProjectionMatrix()
    }
    if (frame.current === 4) {
      withoutRoomLights(() => {
        gl.render(scene, camera)
        useThumbs.getState().set(key, gl.domElement.toDataURL('image/png'))
      })
      frame.current = 0
      if (i + 1 < KEYS.length) setI(i + 1)
      else useThumbs.getState().finish()
    }
  })

  // Preset card: the kind's component with the card's settings (height of a full-height window) and the height offset
  const preset = key.startsWith('preset:') ? ITEM_PRESETS.find((p) => `preset:${p.id}` === key) : undefined
  const kind = (preset?.kind ?? key) as ItemKind
  const ground = key.startsWith('floor:') ? (key.slice(6) as FloorMaterial) : null
  const Comp = key === 'room' || key === 'roomL' || ground ? null : KIT[kind]
  const v = !Comp ? null : preset ? { ...thumbVisual(kind), opts: { ...preset.extra }, at: { x: 0, z: 0, rot: 0, y: preset.extra.y } } : thumbVisual(kind)
  return (
    <group ref={group}>
      {Comp && v ? (
        <group position-y={preset?.extra.y ?? 0}>
          <Comp key={key} v={v} />
        </group>
      ) : ground ? (
        <MiniGround key={key} floor={ground} />
      ) : key === 'roomL' ? (
        <MiniRoomL />
      ) : (
        <MiniRoom />
      )}
    </group>
  )
}

/** Runs offscreen and removes itself when done (frees the WebGL context). */
export default function ThumbnailFactory() {
  const done = useThumbs((s) => s.done)
  if (done) return null
  return (
    <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 160, height: 160, pointerEvents: 'none' }}>
      <Canvas
        dpr={2}
        frameloop="always"
        camera={{ fov: 30, position: [3, 3, 4] }}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0)
          gl.toneMapping = THREE.NeutralToneMapping
        }}
      >
        <hemisphereLight args={['#ffffff', '#c6cbea', 1.4]} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} />
        <Capture />
      </Canvas>
    </div>
  )
}
