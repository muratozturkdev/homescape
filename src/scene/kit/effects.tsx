import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useView } from '../camera'
import { ambientEnter, ambientLeave, markShadows } from '../frame'
import { glowTexture, lineGlowTexture, washTexture } from './textures'

/* Effects that make state visible: glow, light, mist, airflow, motion ripple. */

/** Surface material that glows when on (bulb, display, LED). One per item; disposed when the component unmounts. */
export function useLitMaterial(base: string, on: boolean, color: string, level = 1, strength = 1.6) {
  const m = useMemo(() => {
    const lit = on && level > 0
    return new THREE.MeshStandardMaterial({
      color: lit ? color : base,
      emissive: lit ? color : '#000000',
      emissiveIntensity: lit ? 0.35 + level * strength : 0,
      roughness: 0.45,
    })
  }, [base, on, color, level, strength])
  useEffect(() => () => m.dispose(), [m])
  return m
}

/** Soft light halo facing the camera. */
export function Glow({ position, color, opacity, size = 1.4 }: { position: [number, number, number]; color: string; opacity: number; size?: number }) {
  const tex = useMemo(() => glowTexture(), [])
  if (opacity <= 0.01) return null
  return (
    <sprite position={position} scale={[size, size, size]} renderOrder={10}>
      <spriteMaterial map={tex} color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  )
}

/** Shared properties of additive light materials. */
const ADDITIVE = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide } as const

type GroupProps = { position?: [number, number, number]; rotation?: [number, number, number] }

/**
 * Glow of an LED strip itself: a continuous band of light `length` long along local x (not a row of dotted halos).
 * Two planes, one vertical and one horizontal: it reads as a band from every angle.
 */
export function StripGlow({ length, width = 0.1, color, opacity, ...g }: GroupProps & { length: number; width?: number; color: string; opacity: number }) {
  const tex = useMemo(() => lineGlowTexture(), [])
  if (opacity <= 0.01) return null
  return (
    <group {...g}>
      <mesh renderOrder={10}>
        <planeGeometry args={[length + width, width * 2]} />
        <meshBasicMaterial map={tex} color={color} opacity={opacity} {...ADDITIVE} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} renderOrder={10}>
        <planeGeometry args={[length + width, width * 2]} />
        <meshBasicMaterial map={tex} color={color} opacity={opacity} {...ADDITIVE} />
      </mesh>
    </group>
  )
}

/**
 * Light on the surface a strip shines on: `length` × `depth` in the local XY plane, bright at the top edge (y = +depth/2),
 * fading downward. Rotate the group to lay it on a wall (down/up), a counter or the floor; place it 3-5 mm off the surface.
 */
export function Wash({ length, depth, color, opacity, ...g }: GroupProps & { length: number; depth: number; color: string; opacity: number }) {
  const tex = useMemo(() => washTexture(), [])
  if (opacity <= 0.01) return null
  return (
    <group {...g}>
      <mesh renderOrder={9}>
        <planeGeometry args={[length, depth]} />
        <meshBasicMaterial map={tex} color={color} opacity={opacity} {...ADDITIVE} />
      </mesh>
    </group>
  )
}


/**
 * Requests frames at a low rate while an ambient animation (steam, airflow, ripple, fan blades, vacuum) is active.
 * Not in lite mode: there the animation only advances while the camera moves.
 */
export function useAmbient(active: boolean, slow = false) {
  const lite = useView((s) => s.lite)
  useEffect(() => {
    if (!active || lite) return
    ambientEnter(slow)
    return () => ambientLeave(slow)
  }, [active, lite, slow])
}

/** Diffuser mist: spheres that rise and fade. */
export function Mist({ active, y = 0.3, color = '#ffffff', size = 1 }: { active: boolean; y?: number; color?: string; size?: number }) {
  const group = useRef<THREE.Group>(null)
  const seeds = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ phase: i / 7, dx: Math.sin(i * 2.1) * 0.05, dz: Math.cos(i * 1.7) * 0.05 })), [])
  useAmbient(active)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    g.visible = active
    if (!active) return
    g.children.forEach((child, i) => {
      const s = seeds[i]
      const t = (clock.elapsedTime * 0.35 + s.phase) % 1
      child.position.set(s.dx * size * (1 + t * 3), y + t * 0.7 * Math.sqrt(size), s.dz * size * (1 + t * 3))
      child.scale.setScalar((0.05 + t * 0.12) * size)
      ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.55
    })
  })
  return (
    <group ref={group} visible={false}>
      {seeds.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 10, 10]} />
          <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Music note shapes (♪ single, ♫ beamed pair): flat shape geometry, centered, about 1 unit tall. Built once.
 * No font is loaded (instead of drei Text); sized by scale.
 */
let noteGeos: THREE.ShapeGeometry[] | null = null
function noteGeometries() {
  if (noteGeos) return noteGeos
  const head = (x: number, y: number) => new THREE.Shape().absellipse(x, y, 0.5, 0.36, 0, Math.PI * 2, false, 0.35)
  const rect = (x0: number, y0: number, x1: number, y1: number) => new THREE.Shape().moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).closePath()
  const flag = new THREE.Shape().moveTo(0.5, 2).bezierCurveTo(0.8, 1.72, 1.2, 1.5, 0.98, 0.92).bezierCurveTo(1.02, 1.36, 0.82, 1.5, 0.5, 1.6).closePath()
  const beam = new THREE.Shape().moveTo(0.38, 1.62).lineTo(1.9, 1.87).lineTo(1.9, 2.17).lineTo(0.38, 1.92).closePath()
  const single = new THREE.ShapeGeometry([head(0, 0), rect(0.38, 0.05, 0.5, 2), flag], 8)
  const double = new THREE.ShapeGeometry([head(0, 0), head(1.4, 0.25), rect(0.38, 0.05, 0.5, 1.9), rect(1.78, 0.3, 1.9, 2.15), beam], 8)
  noteGeos = [single, double].map((g) => {
    g.center()
    g.computeBoundingBox()
    const h = g.boundingBox!.max.y - g.boundingBox!.min.y
    return g.scale(1 / h, 1 / h, 1) as THREE.ShapeGeometry
  })
  return noteGeos
}

const NOTE_COLORS = ['#8f7cff', '#ff6fae', '#4fc3ff', '#b58cff', '#ff8fc4']
const _q = new THREE.Quaternion()
const _qz = new THREE.Quaternion()
const _z = new THREE.Vector3(0, 0, 1)

/**
 * Music notes rising from a playing speaker: five notes face the camera, sway upward, fade in and out. size: note
 * height (m), y: start height. Requests frames only while active (useAmbient); excluded from the selection box and
 * outline (selectionAid).
 */
export function MusicNotes({ active, y, size = 0.07, speed = 1 }: { active: boolean; y: number; size?: number; speed?: number }) {
  const group = useRef<THREE.Group>(null)
  const geos = useMemo(() => noteGeometries(), [])
  const seeds = useMemo(() => Array.from({ length: 5 }, (_, i) => ({ phase: i / 5, sway: 1.7 * i, side: i % 2 ? 1 : -1, geo: i % 3 === 1 ? 1 : 0, color: NOTE_COLORS[i] })), [])
  useAmbient(active)
  useFrame(({ clock, camera }) => {
    const g = group.current
    if (!g) return
    g.visible = active
    if (!active) return
    // Face the camera: undo the group's world rotation, apply the camera's
    g.getWorldQuaternion(_q).invert().multiply(camera.quaternion)
    const t = clock.elapsedTime * 0.3 * speed
    g.children.forEach((child, i) => {
      const s = seeds[i]
      const ph = (t + s.phase) % 1
      child.position.set(s.side * 0.05 + Math.sin(ph * 5 + s.sway) * 0.07, y + ph * 0.7, Math.cos(s.sway) * 0.04)
      child.quaternion.copy(_q).multiply(_qz.setFromAxisAngle(_z, Math.sin(clock.elapsedTime * 2.2 + s.sway) * 0.3))
      child.scale.setScalar(size * (0.75 + 0.35 * Math.sin(ph * Math.PI)))
      ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.min(1, ph / 0.15) * Math.pow(1 - ph, 0.7) * 0.95
    })
  })
  return (
    <group ref={group} visible={false}>
      {seeds.map((s, i) => (
        <mesh key={i} geometry={geos[s.geo]} renderOrder={12} userData={{ selectionAid: true }}>
          <meshBasicMaterial color={s.color} transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/** Airflow ribbons coming out of an AC. */
export function Airflow({ active, color, y = 2 }: { active: boolean; color: string; y?: number }) {
  const group = useRef<THREE.Group>(null)
  useAmbient(active)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    g.visible = active
    if (!active) return
    g.children.forEach((child, i) => {
      const t = (clock.elapsedTime * 0.45 + i / g.children.length) % 1
      child.position.set((i - 2) * 0.18, y - t * 0.9, 0.15 + t * 1.1)
      ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.45
    })
  })
  return (
    <group ref={group} visible={false}>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} rotation={[-0.7, 0, 0]}>
          <planeGeometry args={[0.12, 0.42]} />
          <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Rings spreading on the floor: when motion / presence is detected. */
export function Ripple({ active, color, at = [0, 0.03, 1] }: { active: boolean; color: string; at?: [number, number, number] }) {
  const group = useRef<THREE.Group>(null)
  useAmbient(active)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    g.visible = active
    if (!active) return
    g.children.forEach((child, i) => {
      const t = (clock.elapsedTime * 0.6 + i / 3) % 1
      child.scale.setScalar(0.3 + t * 1.6)
      ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.5
    })
  })
  return (
    <group ref={group} position={at} rotation-x={-Math.PI / 2} visible={false}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} renderOrder={6}>
          <ringGeometry args={[0.92, 1, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Spins its children around the given axis (like fan blades). Stops when speed is 0. */
export function Spin({ speed, axis = 'z', children }: { speed: number; axis?: 'y' | 'z'; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null)
  useAmbient(Boolean(speed))
  useFrame((_, dt) => {
    // No big jumps at a low frame rate.
    if (g.current && speed) g.current.rotation[axis] += Math.min(dt, 0.1) * speed
  })
  return <group ref={g}>{children}</group>
}

/** Rotation that eases toward a value (like a door opening). Requests frames and shadows until done. */
export function useEased(target: number, speed = 6) {
  const ref = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [target, invalidate])
  useFrame((state, dt) => {
    const g = ref.current
    if (!g) return
    const d = target - g.rotation.y
    if (Math.abs(d) < 0.0005) return
    g.rotation.y += d * Math.min(1, dt * speed)
    markShadows(1)
    state.invalidate()
  })
  return ref
}
