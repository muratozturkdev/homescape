import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAmbient, useLitMaterial } from './effects'
import { C } from './palette'
import { Ball, Box, Cyl, mat, rng } from './primitives'
import { useScreen } from './screens'
import { artTexture, keyboardTexture, pegboardTexture } from './textures'
import { monitorOn, type Visual } from './visual'

/*
 * Desk and decor: keyboard, mouse, mouse pad, portrait monitor, desk plant, pegboard (SKÅDIS style), painting, aquarium.
 * Desktop items have their origin at their base (ItemNode lifts them onto the desk top).
 * Wall items have their back at local -z and their front facing +z.
 */

type P = { v: Visual }

export function Keyboard() {
  const tex = keyboardTexture()
  return (
    <group>
      <Box size={[0.44, 0.018, 0.14]} position={[0, 0.009, 0]} color={C.ink} radius={0.006} />
      <mesh position={[0, 0.0185, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.42, 0.12]} />
        <meshStandardMaterial map={tex} roughness={0.6} />
      </mesh>
    </group>
  )
}

export function Mouse() {
  return (
    <group>
      <Ball r={0.03} position={[0, 0.02, 0]} scale={[1.1, 0.55, 1.75]} color={C.offWhite} detail={2} />
      <Box size={[0.003, 0.004, 0.03]} position={[0, 0.035, -0.025]} color={C.steel} shadow={false} />
    </group>
  )
}

export function MousePad() {
  return <Box size={[0.36, 0.004, 0.28]} position={[0, 0.002, 0]} color={C.inkSoft} radius={0.002} shadow={false} />
}

/** Portrait monitor: the screen glows while on. */
export function MonitorV({ v }: P) {
  // While on: a scrolling document (kit/screens.ts)
  const screen = useScreen(monitorOn(v), 2, mat(C.screenOff, { roughness: 0.25 }), Math.abs((v.at?.x ?? 0) * 3.1 + (v.at?.z ?? 0) * 1.7))
  return (
    <group>
      <Box size={[0.2, 0.02, 0.16]} position={[0, 0.01, 0]} color={C.ink} />
      <Box size={[0.04, 0.16, 0.04]} position={[0, 0.09, -0.03]} color={C.ink} />
      <Box size={[0.38, 0.64, 0.03]} position={[0, 0.5, -0.02]} color={C.ink} radius={0.01} />
      <Box size={[0.34, 0.6, 0.01]} position={[0, 0.5, 0.0]} material={screen} shadow={false} />
    </group>
  )
}

/** Desk plant: a succulent and a tiny cactus in a small white pot. */
export function DeskPlant() {
  return (
    <group>
      <Cyl r={0.055} rTop={0.065} h={0.09} position={[0, 0.045, 0]} color={C.white} segments={20} />
      <Cyl r={0.058} h={0.008} position={[0, 0.087, 0]} color={C.kraftDark} segments={20} shadow={false} />
      <Ball r={0.035} position={[-0.02, 0.11, 0.01]} color={C.leaf} flat detail={1} />
      <Ball r={0.028} position={[0.025, 0.105, -0.015]} color={C.mint} flat detail={1} />
      <Cyl r={0.016} h={0.09} position={[0.01, 0.14, 0.02]} color={C.leafDark} segments={10} />
      <Ball r={0.012} position={[0.01, 0.19, 0.02]} color={C.coral} shadow={false} />
    </group>
  )
}

/**
 * SKÅDIS style pegboard (76 × 56 cm): perforated board texture, small shelf with a pot, pen cup, headphones on a hook,
 * small basket. Hangs on the wall above the desk (center at 1.3 m).
 */
export function Pegboard({ v }: P) {
  const tex = pegboardTexture()
  const board = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, color: v.opts.body ?? '#ffffff', roughness: 0.8 }), [tex, v.opts.body])
  const B = -0.025 // front face of the board
  return (
    <group>
      <mesh position={[0, 1.3, -0.03]} material={board} castShadow receiveShadow>
        <boxGeometry args={[0.76, 0.56, 0.012]} />
      </mesh>
      {/* shelf and pot */}
      <Box size={[0.3, 0.012, 0.1]} position={[-0.18, 1.42, B + 0.05]} color={C.white} />
      <Cyl r={0.035} h={0.06} position={[-0.25, 1.456, B + 0.05]} color={C.terracotta} segments={14} />
      <Ball r={0.035} position={[-0.25, 1.51, B + 0.05]} color={C.leaf} flat detail={1} />
      <Box size={[0.06, 0.08, 0.05]} position={[-0.12, 1.466, B + 0.05]} color={C.brandPale} />
      {/* pen cup */}
      <Cyl r={0.03} h={0.09} position={[0.2, 1.2, B + 0.035]} color={C.sun} segments={14} />
      <Cyl r={0.004} h={0.09} position={[0.19, 1.27, B + 0.035]} color={C.ink} segments={6} shadow={false} />
      <Cyl r={0.004} h={0.08} position={[0.21, 1.265, B + 0.03]} color={C.brand} segments={6} shadow={false} />
      {/* hook and headphones */}
      <Box size={[0.012, 0.012, 0.06]} position={[0.2, 1.47, B + 0.03]} color={C.steel} shadow={false} />
      <mesh position={[0.2, 1.4, B + 0.06]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.07, 0.012, 8, 20, Math.PI]} />
        <meshStandardMaterial color={C.ink} roughness={0.5} />
      </mesh>
      <Box size={[0.03, 0.06, 0.05]} position={[0.13, 1.37, B + 0.06]} color={C.ink} shadow={false} />
      <Box size={[0.03, 0.06, 0.05]} position={[0.27, 1.37, B + 0.06]} color={C.ink} shadow={false} />
      {/* basket */}
      <Box size={[0.18, 0.07, 0.07]} position={[-0.15, 1.12, B + 0.04]} color={C.mint} radius={0.01} />
    </group>
  )
}

/** Painting: thin frame, pastel abstract picture (front faces +z). Centre height 1.55 m. */
export function Painting({ v }: P) {
  const tex = artTexture()
  return (
    <group>
      <Box size={[0.8, 0.6, 0.03]} position={[0, 1.55, -0.01]} color={v.opts.body ?? C.ink} />
      <mesh position={[0, 1.55, 0.0065]}>
        <planeGeometry args={[0.72, 0.52]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
    </group>
  )
}

/* ---------- mirror and soap dispenser ---------- */

/** Mirror surface: light blue gray, metallic and glossy instead of a real reflection. */
function useMirrorMaterial() {
  return useMemo(() => new THREE.MeshStandardMaterial({ color: '#dfe8f5', metalness: 0.75, roughness: 0.08, emissive: '#cfdcf0', emissiveIntensity: 0.15 }), [])
}

/** Mirror: full length (55 × 160 cm, 25 cm above the floor) or small round (55 cm, at eye level). The frame color is selectable. */
export function Mirror({ v }: P) {
  const glass = useMirrorMaterial()
  const frame = v.opts.body ?? C.kraftDark
  if (v.opts.variant === 'small')
    return (
      <group position={[0, 1.55, -0.012]}>
        <mesh>
          <torusGeometry args={[0.265, 0.018, 10, 40]} />
          <meshStandardMaterial color={frame} roughness={0.5} />
        </mesh>
        <mesh material={glass} position={[0, 0, 0.002]}>
          <circleGeometry args={[0.255, 40]} />
        </mesh>
      </group>
    )
  return (
    <group>
      <Box size={[0.56, 1.62, 0.03]} position={[0, 1.06, -0.012]} color={frame} radius={0.012} />
      <mesh material={glass} position={[0, 1.06, 0.0045]}>
        <planeGeometry args={[0.5, 1.56]} />
      </mesh>
    </group>
  )
}

/** Soap dispenser: a pump bottle; placed on a washbasin, sink or counter. */
export function SoapDispenser() {
  return (
    <group>
      <Cyl r={0.028} rTop={0.024} h={0.1} position={[0, 0.05, 0]} color={C.mint} segments={16} />
      <Cyl r={0.012} h={0.02} position={[0, 0.11, 0]} color={C.white} segments={10} shadow={false} />
      <Cyl r={0.006} h={0.035} position={[0, 0.135, 0]} color={C.white} segments={8} shadow={false} />
      <Box size={[0.012, 0.01, 0.04]} position={[0, 0.15, 0.015]} color={C.white} shadow={false} />
    </group>
  )
}

/* ---------- small round fishbowl ---------- */

const BOWL_R = 0.13
const BOWL_Y = 0.14
const BOWL_WATER = BOWL_Y + 0.05
const BOWL_FISH = [
  { color: '#ff8a3d', speed: 0.9, phase: 0, size: 0.9 },
  { color: '#f5c04a', speed: 0.7, phase: 2.6, size: 0.75 },
]

/**
 * Small round fishbowl for a desk: open glass bowl, water, colored gravel, a tiny plant, two fish.
 * The fish swim in circles (slow ambient animation) and rise to the surface when fed.
 */
export function Fishbowl({ v }: P) {
  const fish = useRef<(THREE.Group | null)[]>([])
  const food = useRef<THREE.Group>(null)
  const fedAt = v.opts.fedAt ? Date.parse(v.opts.fedAt) : 0
  useAmbient(true, true)
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }), [])
  const water = useMemo(
    () => new THREE.MeshStandardMaterial({ color: v.on ? '#7fd3ff' : '#8fc6e6', emissive: v.on ? '#3aa8e8' : '#000000', emissiveIntensity: v.on ? 0.3 : 0, transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    [v.on],
  )
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const since = (Date.now() - fedAt) / 1000
    const feeding = fedAt > 0 && since >= 0 && since < FEED_SECONDS
    if (food.current) {
      food.current.visible = feeding
      if (feeding)
        food.current.children.forEach((c, i) => {
          const sink = Math.min(1, since * (0.03 + (i % 3) * 0.008))
          c.position.set(-0.03 + (i % 3) * 0.03, BOWL_WATER - sink * 0.12, -0.02 + (i % 2) * 0.04)
        })
    }
    BOWL_FISH.forEach((f, i) => {
      const g = fish.current[i]
      if (!g) return
      const a = t * f.speed + f.phase
      const r = feeding ? 0.025 : 0.06
      const y = feeding ? BOWL_WATER - 0.025 : BOWL_Y - 0.02 + Math.sin(a * 0.7) * 0.025
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
      g.rotation.y = -a - Math.PI / 2
    })
  })
  return (
    <group>
      <Cyl r={0.07} rTop={0.06} h={0.012} position={[0, 0.006, 0]} color={C.ink} segments={24} />
      <mesh position={[0, BOWL_Y, 0]} material={glass} renderOrder={4}>
        {/* sphere open at the top: the top cap is cut off */}
        <sphereGeometry args={[BOWL_R, 28, 18, 0, Math.PI * 2, 0.62, Math.PI - 0.62]} />
      </mesh>
      <mesh position={[0, BOWL_Y, 0]} material={water} renderOrder={3}>
        <sphereGeometry args={[BOWL_R - 0.006, 24, 14, 0, Math.PI * 2, Math.acos((BOWL_WATER - BOWL_Y) / (BOWL_R - 0.006)), Math.PI]} />
      </mesh>
      <mesh position={[0, BOWL_WATER, 0]} rotation-x={-Math.PI / 2} material={water} renderOrder={3}>
        <circleGeometry args={[Math.sqrt((BOWL_R - 0.006) ** 2 - (BOWL_WATER - BOWL_Y) ** 2), 28]} />
      </mesh>
      <Cyl r={0.075} h={0.025} position={[0, BOWL_Y - BOWL_R + 0.03, 0]} color="#f2c9a0" segments={20} shadow={false} />
      <Cyl r={0.006} h={0.08} position={[0.04, BOWL_Y - BOWL_R + 0.08, -0.03]} color={C.leaf} segments={6} shadow={false} />
      <Ball r={0.018} position={[0.04, BOWL_Y - BOWL_R + 0.12, -0.03]} color={C.leaf} flat detail={0} shadow={false} />
      {BOWL_FISH.map((f, i) => (
        <group
          key={i}
          ref={(g) => {
            fish.current[i] = g
          }}
        >
          <Fish color={f.color} size={f.size * 0.6} />
        </group>
      ))}
      <group ref={food} visible={false}>
        {Array.from({ length: 6 }, (_, i) => (
          <Ball key={i} r={0.004} color={C.kraftDark} detail={0} shadow={false} />
        ))}
      </group>
    </group>
  )
}

/* ---------- aquarium ---------- */

const TANK = { w: 0.96, d: 0.38, y0: 0.72, h: 0.46 }
const WATER_TOP = TANK.y0 + TANK.h - 0.05
const FISH = [
  { color: '#ff8a3d', speed: 0.55, phase: 0, size: 1 },
  { color: '#f5c04a', speed: 0.42, phase: 1.7, size: 0.85 },
  { color: '#3f56e0', speed: 0.65, phase: 3.1, size: 0.8 },
  { color: '#ff8a7a', speed: 0.5, phase: 4.4, size: 0.9 },
  { color: '#ffffff', speed: 0.38, phase: 5.6, size: 0.75 },
]
/** How long (s) the fish stay at the surface eating after feeding */
export const FEED_SECONDS = 9

function Fish({ color, size }: { color: string; size: number }) {
  return (
    <group scale={size * 1.35}>
      <Ball r={0.03} scale={[1.6, 1, 0.55]} color={color} detail={1} shadow={false} />
      <mesh position={[-0.055, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.022, 0.035, 4]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <Ball r={0.006} position={[0.035, 0.008, 0.012]} color={C.ink} detail={0} shadow={false} />
    </group>
  )
}

/**
 * Aquarium: glass tank on a cabinet with water, sand, plants and a stone; the fish swim all the time (slow ambient
 * animation, 12 fps). When fed (item.fedAt) food flakes sink from the surface and the fish rush to them.
 * If the main entity is a light or switch it is the aquarium lamp: while on, the hood light and the water glow.
 */
export function Aquarium({ v }: P) {
  const fish = useRef<(THREE.Group | null)[]>([])
  const food = useRef<THREE.Group>(null)
  const fedAt = v.opts.fedAt ? Date.parse(v.opts.fedAt) : 0
  useAmbient(true, true)
  const water = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: v.on ? '#7fd3ff' : '#8fc6e6',
        emissive: v.on ? '#3aa8e8' : '#000000',
        emissiveIntensity: v.on ? 0.35 : 0,
        transparent: true,
        opacity: 0.32,
        roughness: 0.1,
        depthWrite: false,
      }),
    [v.on],
  )
  const lamp = useLitMaterial(C.steel, v.on, '#dff3ff', 0.9, 1.4)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const since = (Date.now() - fedAt) / 1000
    const feeding = fedAt > 0 && since >= 0 && since < FEED_SECONDS
    // Food flakes sink slowly from the surface
    if (food.current) {
      food.current.visible = feeding
      if (feeding)
        food.current.children.forEach((c, i) => {
          const sink = Math.min(1, (since * (0.25 + (i % 3) * 0.05)) / TANK.h)
          c.position.set(-0.1 + (i % 4) * 0.06, WATER_TOP - sink * (TANK.h - 0.12), -0.04 + (i % 3) * 0.04)
          c.visible = since < FEED_SECONDS - (i % 3)
        })
    }
    FISH.forEach((f, i) => {
      const g = fish.current[i]
      if (!g) return
      const s = f.speed
      // Free swimming: a drifting Lissajous path inside the tank
      let x = Math.sin(t * s + f.phase) * (TANK.w / 2 - 0.1)
      let y = TANK.y0 + 0.2 + Math.sin(t * s * 0.6 + f.phase * 2) * 0.1
      let z = Math.cos(t * s * 0.8 + f.phase) * (TANK.d / 2 - 0.08)
      let dx = Math.cos(t * s + f.phase) * s
      let dz = -Math.sin(t * s * 0.8 + f.phase) * s * 0.8
      if (feeding) {
        // Rush to the food: small circles around it near the surface
        const k = Math.min(1, since / 1.5)
        const fx = -0.03 + Math.cos(t * 2 + i) * 0.08
        const fz = Math.sin(t * 2 + i) * 0.06
        const fy = WATER_TOP - 0.06 - (i % 2) * 0.04
        x += (fx - x) * k
        y += (fy - y) * k
        z += (fz - z) * k
        dx = -Math.sin(t * 2 + i)
        dz = Math.cos(t * 2 + i)
      }
      g.position.set(x, y, z)
      g.rotation.y = Math.atan2(-dz, dx)
    })
  })

  const body = v.opts.body ?? C.white
  return (
    <group>
      {/* cabinet */}
      <Box size={[1, 0.7, 0.42]} position={[0, 0.35, 0]} color={body} radius={0.015} />
      <Box size={[0.46, 0.6, 0.01]} position={[-0.24, 0.36, 0.212]} color={body} shadow={false} />
      <Box size={[0.46, 0.6, 0.01]} position={[0.24, 0.36, 0.212]} color={body} shadow={false} />
      <Box size={[0.012, 0.12, 0.02]} position={[-0.03, 0.4, 0.225]} color={C.steel} shadow={false} />
      <Box size={[0.012, 0.12, 0.02]} position={[0.03, 0.4, 0.225]} color={C.steel} shadow={false} />
      {/* tank: bottom and top frame, corner posts, glass */}
      <Box size={[TANK.w + 0.02, 0.02, TANK.d + 0.02]} position={[0, TANK.y0 + 0.01, 0]} color={C.ink} />
      {/* top: open frame (so the water is visible from above) and a slim lamp at the back */}
      <Box size={[TANK.w + 0.02, 0.02, 0.02]} position={[0, TANK.y0 + TANK.h, TANK.d / 2]} color={C.ink} shadow={false} />
      <Box size={[TANK.w + 0.02, 0.02, 0.02]} position={[0, TANK.y0 + TANK.h, -TANK.d / 2]} color={C.ink} shadow={false} />
      <Box size={[0.02, 0.02, TANK.d + 0.02]} position={[-TANK.w / 2, TANK.y0 + TANK.h, 0]} color={C.ink} shadow={false} />
      <Box size={[0.02, 0.02, TANK.d + 0.02]} position={[TANK.w / 2, TANK.y0 + TANK.h, 0]} color={C.ink} shadow={false} />
      <Box size={[TANK.w - 0.08, 0.025, 0.07]} position={[0, TANK.y0 + TANK.h + 0.012, -TANK.d / 2 + 0.05]} color={C.ink} shadow={false} />
      <Box size={[TANK.w - 0.12, 0.004, 0.05]} position={[0, TANK.y0 + TANK.h - 0.002, -TANK.d / 2 + 0.05]} material={lamp} shadow={false} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.012, TANK.h, 0.012]} position={[sx * (TANK.w / 2), TANK.y0 + TANK.h / 2, sz * (TANK.d / 2)]} color={C.ink} shadow={false} />))}
      <mesh position={[0, TANK.y0 + TANK.h / 2, 0]}>
        <boxGeometry args={[TANK.w, TANK.h, TANK.d]} />
        <meshStandardMaterial color="#e8f6ff" transparent opacity={0.12} roughness={0.05} depthWrite={false} />
      </mesh>
      {/* water, sand, stone, plants */}
      <mesh position={[0, TANK.y0 + (WATER_TOP - TANK.y0) / 2, 0]} material={water} renderOrder={3}>
        <boxGeometry args={[TANK.w - 0.02, WATER_TOP - TANK.y0, TANK.d - 0.02]} />
      </mesh>
      <Box size={[TANK.w - 0.02, 0.04, TANK.d - 0.02]} position={[0, TANK.y0 + 0.04, 0]} color="#e9d8b4" shadow={false} />
      <Ball r={0.07} position={[0.25, TANK.y0 + 0.08, -0.06]} scale={[1.3, 0.7, 1]} color={C.steel} flat detail={0} shadow={false} />
      <Cyl r={0.012} h={0.26} position={[-0.36, TANK.y0 + 0.19, -0.1]} color={C.leafDark} segments={6} shadow={false} />
      <Cyl r={0.012} h={0.2} position={[-0.32, TANK.y0 + 0.16, -0.06]} color={C.leaf} segments={6} shadow={false} />
      <Cyl r={0.01} h={0.3} position={[0.36, TANK.y0 + 0.21, 0.08]} color={C.leaf} segments={6} shadow={false} />
      <Ball r={0.04} position={[-0.34, TANK.y0 + 0.3, -0.08]} color={C.leaf} flat detail={0} shadow={false} />
      {FISH.map((f, i) => (
        <group
          key={i}
          ref={(g) => {
            fish.current[i] = g
          }}
        >
          <Fish color={f.color} size={f.size} />
        </group>
      ))}
      <group ref={food} visible={false}>
        {Array.from({ length: 9 }, (_, i) => (
          <Ball key={i} r={0.006} color={C.kraftDark} detail={0} shadow={false} />
        ))}
      </group>
    </group>
  )
}

/**
 * Leaf geometry (built once): a long narrow leaf along local +x that first rises, then droops towards the tip; narrow base,
 * widest in the middle, pointed tip, slightly folded along the midrib. Length 1, sized by scale.
 */
let leafGeo: THREE.BufferGeometry | null = null
function palmLeaf() {
  if (leafGeo) return leafGeo
  const N = 14
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const x = t
    const y = 0.32 * Math.sin(t * Math.PI * 0.62) - 0.42 * t * t
    const hw = 0.055 * Math.sin(Math.min(1, t * 2.4) * (Math.PI / 2)) * Math.pow(1 - t, 0.9) + 0.004 * (1 - t)
    const fold = hw * 0.35
    pos.push(x, y, -hw, x, y + fold, 0, x, y, hw)
  }
  for (let i = 0; i < N; i++) {
    const a = i * 3
    const b = a + 3
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  leafGeo = g
  return g
}

/** Leaf layout (seeded, the same in every pot): direction (golden angle), rise angle, length, color. */
const PALM_LEAVES = (() => {
  const r = rng(11)
  return Array.from({ length: 15 }, (_, i) => {
    const inner = i < 5
    return {
      az: i * 2.39996 + r() * 0.3,
      up: inner ? 0.95 + r() * 0.35 : 0.35 + r() * 0.4,
      len: inner ? 0.19 + r() * 0.05 : 0.22 + r() * 0.07,
      dark: i % 3 === 0,
    }
  })
})()

/**
 * Mini palm (yucca / dracaena style): pot, short ringed trunk, long narrow pointed leaves arching and drooping in every
 * direction from the top; about 40 cm in total. Desktop item (surfaces only). Pot color is Item.body.
 */
export function DeskPalm({ v }: { v: Visual }) {
  const pot = v.opts.body ?? C.white
  const leaf = useMemo(() => new THREE.MeshStandardMaterial({ color: C.leaf, roughness: 0.6, side: THREE.DoubleSide }), [])
  const leafDark = useMemo(() => new THREE.MeshStandardMaterial({ color: C.leafDark, roughness: 0.6, side: THREE.DoubleSide }), [])
  useEffect(
    () => () => {
      leaf.dispose()
      leafDark.dispose()
    },
    [leaf, leafDark],
  )
  const geo = palmLeaf()
  const top = 0.2
  return (
    <group>
      <Cyl r={0.05} rTop={0.062} h={0.1} position={[0, 0.05, 0]} color={pot} segments={20} />
      <Cyl r={0.064} h={0.012} position={[0, 0.1, 0]} color={pot} segments={20} shadow={false} />
      <Cyl r={0.057} h={0.006} position={[0, 0.098, 0]} color={C.kraftDark} segments={20} shadow={false} />
      {/* ringed trunk */}
      {[0, 1, 2, 3].map((k) => (
        <Cyl key={k} r={0.016 - k * 0.0015} rTop={0.014 - k * 0.0015} h={0.026} position={[0, 0.113 + k * 0.024, 0]} color={k % 2 ? C.kraftDark : C.kraft} segments={10} shadow={false} />
      ))}
      {PALM_LEAVES.map((l, i) => (
        <group key={i} position={[0, top, 0]} rotation-y={l.az}>
          <mesh geometry={geo} material={l.dark ? leafDark : leaf} rotation-z={l.up} scale={[l.len, l.len, l.len]} castShadow />
        </group>
      ))}
    </group>
  )
}
