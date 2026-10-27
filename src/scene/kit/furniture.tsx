import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { domainOf, isActive, lightColor, lightLevel } from '@/ha/derive'
import { t } from '@/i18n'
import { HEADBOARD } from '@/model/bindings'
import { CATALOG, RUG_DEFAULT } from '@/model/catalog'
import { DRAWER_SLIDE } from '@/model/containers'
import { SINK_W } from '@/model/counter'
import { markShadows } from '../frame'
import { StripGlow, useEased, useLitMaterial, Wash } from './effects'
import { BOOK_COLORS, C } from './palette'
import { Ball, Box, Cyl, mat, rng } from './primitives'
import { rugTexture } from './textures'
import { gainOf, type Visual } from './visual'

/*
 * Furniture: not bound to HA, makes the home recognizable. Dimensions match the footprints in the catalog.
 * Local convention: origin at the center of the base on the floor, front faces +z.
 */

/* ---------- cabinet interiors: carcass, door, drawer ---------- */

/*
 * Furniture with doors and drawers holds items inside (every part that opens; compartments in model/containers.ts >
 * INTERIOR). The carcass is hollow (sides, bottom, top, back, shelves); doors swing on their hinges, drawers slide out
 * (Visual.open; for drawers only those with items inside, all of them if none). Closed, it looks like a solid cabinet.
 */
const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`
const T = 0.018

/** Hollow carcass, open at the front; shelves (heights from the carcass bottom). top false: the countertop covers it (room for the sink bowl) */
function Carcass({ w, h, d, y = 0, z = 0, color, shelves = [], top = true }: { w: number; h: number; d: number; y?: number; z?: number; color: string; shelves?: number[]; top?: boolean }) {
  const inner = shade(color, 0.9)
  return (
    <group position={[0, y, z]}>
      <Box size={[T, h, d]} position={[-w / 2 + T / 2, h / 2, 0]} color={color} />
      <Box size={[T, h, d]} position={[w / 2 - T / 2, h / 2, 0]} color={color} />
      <Box size={[w, T, d]} position={[0, T / 2, 0]} color={color} />
      {top && <Box size={[w, T, d]} position={[0, h - T / 2, 0]} color={color} />}
      <Box size={[w - 2 * T, h - 2 * T, 0.012]} position={[0, h / 2, -d / 2 + 0.006]} color={inner} shadow={false} />
      {shelves.map((sy) => (
        <Box key={sy} size={[w - 2 * T, T, d - 0.03]} position={[0, sy, -0.01]} color={color} />
      ))}
    </group>
  )
}

/** Hinged door: swings about 100° on the hinge edge; handle on the free edge */
function SwingDoor({ w, h, at, hinge, open, color, handle = 0.3 }: { w: number; h: number; at: [number, number, number]; hinge: 'l' | 'r'; open: number; color: string; handle?: number }) {
  const s = hinge === 'l' ? 1 : -1
  const ref = useEased(open * -s * 1.8)
  return (
    <group ref={ref} position={[at[0] - (s * w) / 2, at[1], at[2]]}>
      <Box size={[w, h, T]} position={[(s * w) / 2, 0, 0]} color={color} shadow={false} />
      {handle > 0 && <Box size={[0.022, Math.min(handle, h * 0.5), 0.022]} position={[s * (w - 0.045), h * 0.12, 0.02]} color={C.steel} shadow={false} />}
    </group>
  )
}

/** Sliding drawer: front, sides, back and bottom (open top); slides DRAWER_SLIDE forward when open */
function Drawer({ w, h, d, at, open, color }: { w: number; h: number; d: number; at: [number, number, number]; open: number; color: string }) {
  const ref = useRef<THREE.Group>(null)
  const invalidate = useThree((st) => st.invalidate)
  const target = open * DRAWER_SLIDE
  useEffect(() => invalidate(), [target, invalidate])
  useFrame((state, dt) => {
    const g = ref.current
    if (!g) return
    const dz = target - g.position.z
    if (Math.abs(dz) < 0.0005) return
    g.position.z += dz * Math.min(1, dt * 6)
    markShadows(1)
    state.invalidate()
  })
  const inner = shade(color, 0.92)
  return (
    <group position={at}>
      <group ref={ref}>
        <Box size={[w, h, T]} position={[0, 0, d / 2]} color={color} shadow={false} />
        <Box size={[w * 0.36, 0.014, 0.018]} position={[0, h * 0.22, d / 2 + 0.014]} color={C.steel} shadow={false} />
        <Box size={[w - 0.04, 0.012, d - 0.03]} position={[0, -h / 2 + 0.02, 0]} color={inner} shadow={false} />
        <Box size={[0.012, h - 0.04, d - 0.03]} position={[-w / 2 + 0.026, -0.01, 0]} color={inner} shadow={false} />
        <Box size={[0.012, h - 0.04, d - 0.03]} position={[w / 2 - 0.026, -0.01, 0]} color={inner} shadow={false} />
        <Box size={[w - 0.04, h - 0.04, 0.012]} position={[0, -0.01, -d / 2 + 0.03]} color={inner} shadow={false} />
      </group>
    </group>
  )
}

/* ---------- kitchen sink ---------- */

// No environment map: high metalness turns steel dark, so use a light color with little metalness
const steelBright = mat('#dfe3ea', { roughness: 0.28, metalness: 0.25 })
const steelBowl = mat('#c3c8d1', { roughness: 0.42, metalness: 0.15 })

/**
 * Countertop (top surface at y + 0.025). With a sink (sinkAt: local x) the top is split into pieces around the bowl: a
 * hollow steel bowl (19 cm deep, with drain and rim) and a gooseneck faucet at the back (body, arc, spout, lever).
 */
function CounterTop({ len, color, sinkAt, y = 0.885, d = 0.62 }: { len: number; color: string; sinkAt?: number; y?: number; d?: number }) {
  if (sinkAt == null) return <Box size={[len, 0.05, d]} position={[0, y, 0]} color={color} />
  const hw = SINK_W / 2
  const z0 = -0.18
  const z1 = 0.22
  const top = y + 0.025
  const L0 = -len / 2
  const L1 = len / 2
  const D = 0.19
  const cz = (z0 + z1) / 2
  return (
    <group>
      {sinkAt - hw > L0 + 0.001 && <Box size={[sinkAt - hw - L0, 0.05, d]} position={[(L0 + sinkAt - hw) / 2, y, 0]} color={color} />}
      {L1 - (sinkAt + hw) > 0.001 && <Box size={[L1 - (sinkAt + hw), 0.05, d]} position={[(sinkAt + hw + L1) / 2, y, 0]} color={color} />}
      <Box size={[SINK_W, 0.05, z0 + d / 2]} position={[sinkAt, y, (-d / 2 + z0) / 2]} color={color} />
      <Box size={[SINK_W, 0.05, d / 2 - z1]} position={[sinkAt, y, (z1 + d / 2) / 2]} color={color} />
      {/* bowl: bottom, four sides, drain; thin rim on top */}
      <group position={[sinkAt, top, cz]}>
        <Box size={[SINK_W - 0.02, 0.01, z1 - z0 - 0.02]} position={[0, -D, 0]} material={steelBowl} shadow={false} />
        <Box size={[0.01, D, z1 - z0]} position={[-hw + 0.005, -D / 2, 0]} material={steelBowl} shadow={false} />
        <Box size={[0.01, D, z1 - z0]} position={[hw - 0.005, -D / 2, 0]} material={steelBowl} shadow={false} />
        <Box size={[SINK_W, D, 0.01]} position={[0, -D / 2, (z0 - z1) / 2 + 0.005]} material={steelBowl} shadow={false} />
        <Box size={[SINK_W, D, 0.01]} position={[0, -D / 2, (z1 - z0) / 2 - 0.005]} material={steelBowl} shadow={false} />
        <Cyl r={0.032} h={0.006} position={[0, -D + 0.008, 0]} color={C.inkSoft} segments={18} shadow={false} />
        {[-1, 1].map((sx) => (
          <Box key={`x${sx}`} size={[0.018, 0.006, z1 - z0 + 0.036]} position={[sx * (hw + 0.009), 0.003, 0]} material={steelBright} shadow={false} />
        ))}
        {[-1, 1].map((sz) => (
          <Box key={`z${sz}`} size={[SINK_W + 0.036, 0.006, 0.018]} position={[0, 0.003, sz * ((z1 - z0) / 2 + 0.009)]} material={steelBright} shadow={false} />
        ))}
      </group>
      {/* gooseneck faucet: body at the back, arc up and forward, spout pointing down; lever on the side */}
      <group position={[sinkAt, top, -0.245]}>
        <Cyl r={0.026} h={0.03} position={[0, 0.015, 0]} material={steelBright} segments={18} />
        <Cyl r={0.014} h={0.27} position={[0, 0.165, 0]} material={steelBright} segments={14} />
        <mesh position={[0, 0.3, 0.095]} rotation={[0, -Math.PI / 2, 0]} material={steelBright} castShadow>
          <torusGeometry args={[0.095, 0.014, 10, 24, Math.PI]} />
        </mesh>
        <Cyl r={0.014} h={0.06} position={[0, 0.27, 0.19]} material={steelBright} segments={14} />
        <Cyl r={0.017} h={0.012} position={[0, 0.24, 0.19]} color={C.inkSoft} segments={14} shadow={false} />
        <Box size={[0.012, 0.012, 0.09]} position={[0.03, 0.13, 0.02]} rotation={[0.35, 0.5, 0]} material={steelBright} />
      </group>
    </group>
  )
}

/** Is compartment i open: while the cabinet is open, the compartments that hold items (all of them if none do) */
const partOpen = (v: Visual, i: number) => (v.open ? (!v.openParts?.length || v.openParts.includes(i) ? v.open : 0) : 0)

const legs4 = (w: number, d: number, h: number, color: string = C.ink, r = 0.03) =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={r} h={h} position={[sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06)]} color={color} />))

export function Sofa() {
  // Seat top at 0.49 m (a real sofa): a seated person's feet reach the floor; the back cushions keep them forward
  // (seats in model/people.ts, pose in scene/Human.tsx)
  return (
    <group>
      {legs4(2.1, 0.8, 0.08)}
      <Box size={[2.2, 0.28, 0.9]} position={[0, 0.22, 0]} color={C.brand} radius={0.08} />
      <Box size={[2.2, 0.62, 0.24]} position={[0, 0.62, -0.33]} color={C.brand} radius={0.08} />
      <Box size={[0.22, 0.5, 0.9]} position={[-1, 0.39, 0]} color={C.brand} radius={0.08} />
      <Box size={[0.22, 0.5, 0.9]} position={[1, 0.39, 0]} color={C.brand} radius={0.08} />
      {[-0.595, 0, 0.595].map((x) => (
        <group key={x}>
          <Box size={[0.58, 0.14, 0.66]} position={[x, 0.42, 0.11]} color={C.brandLight} radius={0.06} />
          <Box size={[0.58, 0.4, 0.16]} position={[x, 0.68, -0.14]} rotation={[-0.12, 0, 0]} color={C.brandLight} radius={0.07} />
        </group>
      ))}
      <Box size={[0.28, 0.26, 0.1]} position={[0.75, 0.62, 0]} rotation={[-0.15, -0.65, 0.08]} color={C.sun} radius={0.045} />
    </group>
  )
}

export function Armchair() {
  return (
    <group>
      {legs4(0.8, 0.75, 0.08)}
      <Box size={[0.9, 0.36, 0.85]} position={[0, 0.26, 0]} color={C.coral} radius={0.08} />
      <Box size={[0.9, 0.55, 0.2]} position={[0, 0.6, -0.32]} color={C.coral} radius={0.07} />
      <Box size={[0.18, 0.5, 0.85]} position={[-0.36, 0.42, 0]} color={C.coral} radius={0.07} />
      <Box size={[0.18, 0.5, 0.85]} position={[0.36, 0.42, 0]} color={C.coral} radius={0.07} />
      <Box size={[0.54, 0.4, 0.14]} position={[0, 0.64, -0.15]} rotation={[-0.12, 0, 0]} color={C.coral} radius={0.06} />
    </group>
  )
}

export function CoffeeTable() {
  return (
    <group>
      <Box size={[1.1, 0.07, 0.6]} position={[0, 0.4, 0]} color={C.kraft} radius={0.03} />
      {legs4(1.1, 0.6, 0.37, C.ink, 0.025)}
      <Box size={[0.28, 0.04, 0.2]} position={[-0.25, 0.455, 0.02]} rotation={[0, 0.25, 0]} color={C.coral} />
      <Cyl r={0.05} h={0.1} position={[0.28, 0.485, 0.06]} color={C.white} />
    </group>
  )
}

/** Small round side table: wooden top, single leg, round base, a cup on top. Lamps and diffusers can stand on it. */
export function RoundTable() {
  return (
    <group>
      <Cyl r={0.3} h={0.04} position={[0, 0.45, 0]} color={C.kraft} segments={40} />
      <Cyl r={0.302} h={0.012} position={[0, 0.426, 0]} color={C.kraftDark} segments={40} shadow={false} />
      <Cyl r={0.028} h={0.4} position={[0, 0.22, 0]} color={C.ink} segments={16} />
      <Cyl r={0.15} rTop={0.13} h={0.03} position={[0, 0.015, 0]} color={C.ink} segments={32} />
      <Cyl r={0.04} rTop={0.045} h={0.07} position={[0.1, 0.505, 0.06]} color={C.white} segments={20} />
      <Cyl r={0.06} h={0.006} position={[0.1, 0.473, 0.06]} color={C.coral} segments={24} shadow={false} />
    </group>
  )
}

/** Rug outline in the unit square (0-1; y = 1 is the item's back, -z). Hides have four legs; the sheepskin is a soft blob. */
function rugOutline(shape: string): THREE.Vector2[] {
  const V = (x: number, y: number) => new THREE.Vector2(x, y)
  if (shape === 'round') return Array.from({ length: 96 }, (_, i) => V(0.5 + Math.cos((i / 96) * Math.PI * 2) * 0.5, 0.5 + Math.sin((i / 96) * Math.PI * 2) * 0.5))
  if (shape === 'sheep') {
    return Array.from({ length: 128 }, (_, i) => {
      const a = (i / 128) * Math.PI * 2
      // Slightly wavy edge with four short leg bumps on the diagonals
      const r = 0.9 + 0.035 * Math.sin(3 * a + 0.5) + 0.025 * Math.sin(7 * a + 1.3) + 0.06 * Math.max(0, -Math.cos(4 * a)) ** 6
      return V(0.5 + Math.cos(a) * r * 0.49, 0.5 + Math.sin(a) * r * 0.49)
    })
  }
  if (shape === 'cowhide') {
    // Right half from neck to tail; the left half mirrors it. The centripetal curve does not self-intersect at the pointed legs.
    const half: [number, number][] = [
      [0.5, 0.985], [0.585, 0.965], [0.615, 0.9], [0.7, 0.875], [0.82, 0.92], [0.93, 0.995], [0.985, 0.95], [0.92, 0.84], [0.875, 0.74], [0.895, 0.6],
      [0.88, 0.46], [0.9, 0.34], [0.95, 0.2], [0.995, 0.06], [0.94, 0.015], [0.84, 0.11], [0.72, 0.15], [0.62, 0.1], [0.555, 0.03], [0.5, 0.0],
    ]
    const left = half.slice(1, -1).reverse().map(([x, y]) => [1 - x, y] as [number, number])
    const curve = new THREE.CatmullRomCurve3([...half, ...left].map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal')
    return curve.getSpacedPoints(160).slice(0, -1).map((p) => V(p.x, p.y))
  }
  // Rectangle with slightly rounded corners
  const r = 0.02
  const pts: THREE.Vector2[] = []
  const corners: [number, number, number][] = [[1 - r, 1 - r, 0], [r, 1 - r, Math.PI / 2], [r, r, Math.PI], [1 - r, r, (Math.PI * 3) / 2]]
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 4; k++) pts.push(V(cx + Math.cos(a0 + (k / 4) * (Math.PI / 2)) * r, cy + Math.sin(a0 + (k / 4) * (Math.PI / 2)) * r))
  return pts
}

/** Rug geometry: the unit outline extruded (puffy edge for the sheepskin), laid flat and centered; built once per shape. */
const rugGeos = new Map<string, THREE.BufferGeometry>()
function rugGeometry(shape: string) {
  const key = shape === 'zebra' ? 'cowhide' : shape
  let g = rugGeos.get(key)
  if (g) return g
  const sheep = key === 'sheep'
  const depth = sheep ? 0.02 : key === 'cowhide' ? 0.005 : 0.012
  const bevel = 0.012
  g = new THREE.ExtrudeGeometry(new THREE.Shape(rugOutline(key)), { depth, bevelEnabled: sheep, bevelThickness: bevel, bevelSize: 0.025, bevelSegments: 3, curveSegments: 4 })
  // UVs come from the outline's 0-1 square (top face); then center, lay flat (thickness up) and lift 1 mm off the floor
  g.translate(-0.5, -0.5, 0)
  g.rotateX(-Math.PI / 2)
  g.translate(0, (sheep ? bevel : 0) + 0.001, 0)
  rugGeos.set(key, g)
  return g
}

/**
 * Rug: shape Item.variant (rectangle, round, cowhide, zebra hide, sheepskin), width Item.len, length Item.len2, color
 * Item.body. The unit outline is scaled to size (round becomes oval when width and length differ); the pattern is drawn
 * at the size's aspect ratio.
 */
export function Rug({ v }: { v: Visual }) {
  const shape = v.opts.variant ?? 'rect'
  const w = v.opts.len ?? CATALOG.rug.size[0]
  const d = v.opts.len2 ?? CATALOG.rug.size[1]
  const color = v.opts.body ?? RUG_DEFAULT[shape] ?? RUG_DEFAULT.rect
  const material = useMemo(() => new THREE.MeshStandardMaterial({ map: rugTexture(shape, color, w, d), roughness: shape === 'sheep' ? 1 : 0.9 }), [shape, color, w, d])
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={rugGeometry(shape)} material={material} scale={[w, 1, d]} receiveShadow />
}

/* ---------- doormat ---------- */

const matCache = new Map<string, THREE.CanvasTexture>()
/**
 * Doormat texture (Item.variant): coir (fibrous brown, dark border), rubber (anthracite, grid of holes), welcome (text on
 * coir), striped (colored bands). 200 px per meter, so width and length extend the pattern instead of stretching it.
 */
function doormatTexture(kind: string, color: string, w: number, d: number) {
  const key = `${kind}-${color}-${w.toFixed(2)}-${d.toFixed(2)}`
  let tex = matCache.get(key)
  if (tex) return tex
  const P = 200
  const c = document.createElement('canvas')
  c.width = Math.max(32, Math.round(w * P))
  c.height = Math.max(32, Math.round(d * P))
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  let k = 11
  const rnd = () => (k = (k * 9301 + 49297) % 233280) / 233280
  const shadeHex = (hex: string, f: number) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
    return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`
  }
  const fibre = (base: string) => {
    g.fillStyle = base
    g.fillRect(0, 0, W, H)
    for (let i = 0; i < (W * H) / 6; i++) {
      g.fillStyle = shadeHex(color, 0.7 + rnd() * 0.55)
      g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 1, 2 + Math.round(rnd() * 3))
    }
  }
  if (kind === 'rubber') {
    g.fillStyle = shadeHex(color === '#b08452' ? '#4a4f5c' : color, 0.75)
    g.fillRect(0, 0, W, H)
    g.fillStyle = 'rgba(0, 0, 0, 0.55)'
    const step = 0.06 * P
    for (let y = step; y < H - step / 2; y += step) for (let x = step; x < W - step / 2; x += step) g.fillRect(x - 0.012 * P, y - 0.02 * P, 0.024 * P, 0.04 * P)
  } else if (kind === 'striped') {
    const stripes = [color, shadeHex(color, 1.35), shadeHex(color, 0.7)]
    const sw = 0.07 * P
    for (let x = 0, i = 0; x < W; x += sw, i++) {
      g.fillStyle = stripes[i % 3]
      g.fillRect(x, 0, sw, H)
    }
  } else fibre(shadeHex(color, 0.9))
  // border
  const e = 0.035 * P
  g.strokeStyle = shadeHex(color, 0.45)
  g.lineWidth = e
  g.strokeRect(e / 2, e / 2, W - e, H - e)
  if (kind === 'welcome') {
    g.fillStyle = shadeHex(color, 0.35)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let size = Math.min(H * 0.32, (W * 0.8) / 7)
    g.font = `800 ${size}px system-ui, sans-serif`
    const text = t('WELCOME')
    while (g.measureText(text).width > W * 0.82 && size > 6) g.font = `800 ${(size *= 0.92)}px system-ui, sans-serif`
    g.fillText(text, W / 2, H / 2)
  }
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  matCache.set(key, tex)
  return tex
}

/** Doormat: 1.5 cm thick, adjustable width and length (Item.len, Item.len2); type and color on the card. */
export function Doormat({ v }: { v: Visual }) {
  const w = v.opts.len ?? CATALOG.doormat.size[0]
  const d = v.opts.len2 ?? CATALOG.doormat.size[1]
  const kind = v.opts.variant ?? 'coir'
  const color = v.opts.body ?? (kind === 'rubber' ? '#4a4f5c' : '#b08452')
  const material = useMemo(() => new THREE.MeshStandardMaterial({ map: doormatTexture(kind, color, w, d), roughness: kind === 'rubber' ? 0.75 : 1 }), [kind, color, w, d])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh position={[0, 0.0075, 0]} material={material} receiveShadow>
      <boxGeometry args={[w, 0.015, d]} />
    </mesh>
  )
}

/** State of the LED entity picked on the card (among the extra entities; same rule as bindings.ts > ledSource), else null. */
function pickedLed(v: Visual) {
  const id = v.opts.ledEntity
  const e = id ? v.related.find((x) => x.entity_id === id) : undefined
  return e ? { on: isActive(e), level: Math.max(0.35, lightLevel(e) || 1) * gainOf(v), color: lightColor(e) } : null
}

/** Source of the headboard light (main or extra entity): the one picked on the card, else a light, else a switch whose name looks like a headboard light. */
function headboardLight(v: Visual) {
  const picked = pickedLed(v)
  if (picked) return picked
  const self = v.bound && (v.domain === 'light' || v.domain === 'switch') ? { on: v.on, level: v.level, color: v.color, d: v.domain } : null
  const light = v.related.find((e) => domainOf(e.entity_id) === 'light')
  if (light) return { on: isActive(light), level: Math.max(0.35, lightLevel(light)) * gainOf(v), color: lightColor(light) }
  if (self?.d === 'light') return self
  const sw = v.related.find((e) => domainOf(e.entity_id) === 'switch' && HEADBOARD.test(e.entity_id))
  if (sw) return { on: isActive(sw), level: gainOf(v), color: lightColor(sw) }
  return self
}

/**
 * Bed. Headboard light Item.led: 'strip' is a horizontal LED strip on the front of the headboard below its top edge with a
 * soft halo in front; 'back' is a hidden LED behind the headboard casting a rectangular halo on the wall. It glows while
 * the bound light or plug is on, takes the light's color and also lights the room slightly (roomLights.ts).
 */
export function Bed({ v }: { v: Visual }) {
  const src = headboardLight(v)
  // Not chosen: strip if a light is bound; only for a bed in the plan (ghosts and thumbnails have no v.at)
  const mode = v.opts.led ?? (src && v.at ? 'strip' : 'none')
  const on = Boolean(src?.on)
  const color = src?.color ?? '#ffd29a'
  const level = src?.level ?? 1
  const strip = useLitMaterial('#d9dbe6', on, color, level, 2.6)
  return (
    <group>
      <Box size={[1.7, 0.3, 2.05]} position={[0, 0.2, 0]} color={C.kraft} radius={0.04} />
      <Box size={[1.62, 0.2, 1.95]} position={[0, 0.44, 0.02]} color={C.white} radius={0.06} />
      <Box size={[1.7, 0.85, 0.08]} position={[0, 0.55, -1.0]} color={C.kraftDark} radius={0.03} />
      {mode === 'strip' && (
        <>
          <Box size={[1.56, 0.022, 0.016]} position={[0, 0.905, -0.952]} material={strip} shadow={false} />
          {on && (
            <>
              <StripGlow length={1.56} width={0.07} position={[0, 0.905, -0.944]} color={color} opacity={level * (v.night ? 1 : 0.6)} />
              {/* light spreading down the headboard face */}
              <Wash length={1.64} depth={0.62} position={[0, 0.895 - 0.31, -0.955]} color={color} opacity={level * (v.night ? 0.75 : 0.36)} />
            </>
          )}
        </>
      )}
      {mode === 'back' && (
        <>
          <Box size={[1.5, 0.02, 0.02]} position={[0, 0.94, -1.05]} material={strip} shadow={false} />
          {on && (
            <>
              <StripGlow length={1.5} width={0.06} position={[0, 0.96, -1.05]} color={color} opacity={level * (v.night ? 0.9 : 0.48)} />
              {/* light spreading up the wall from behind the headboard */}
              <Wash length={2.1} depth={0.95} position={[0, 0.975 + 0.475, -1.064]} rotation={[0, 0, Math.PI]} color={color} opacity={level * (v.night ? 0.8 : 0.4)} />
            </>
          )}
        </>
      )}
      <Box size={[0.6, 0.12, 0.38]} position={[-0.4, 0.6, -0.72]} color={C.offWhite} radius={0.05} />
      <Box size={[0.6, 0.12, 0.38]} position={[0.4, 0.6, -0.72]} color={C.offWhite} radius={0.05} />
      <Box size={[1.66, 0.06, 1.15]} position={[0, 0.56, 0.38]} color={C.brandLight} radius={0.03} />
    </group>
  )
}

export function Nightstand({ v }: { v: Visual }) {
  // Open compartment below, drawer on top (model/containers.ts: 0 lower compartment, 1 drawer)
  return (
    <group>
      <Carcass w={0.45} h={0.48} d={0.4} color={C.white} shelves={[0.27]} />
      <Drawer w={0.41} h={0.17} d={0.36} at={[0, 0.365, -0.01]} open={partOpen(v, 1)} color={C.brandPale} />
    </group>
  )
}

/** Two-door wardrobe: carcass and door colors are selectable (v.opts.body / top). */
export function Wardrobe({ v }: { v: Visual }) {
  const body = v.opts.body ?? C.white
  const door = v.opts.top ?? C.sunPale
  const open = v.open ?? 0
  return (
    <group>
      <Carcass w={1.4} h={2.1} d={0.6} color={body} shelves={[0.6, 1.6]} />
      {/* hanging rail */}
      <Cyl r={0.012} h={1.34} position={[0, 1.5, 0]} rotation={[0, 0, Math.PI / 2]} color={C.steel} segments={10} shadow={false} />
      <SwingDoor w={0.69} h={2.06} at={[-0.35, 1.05, 0.309]} hinge="l" open={open} color={door} />
      <SwingDoor w={0.69} h={2.06} at={[0.35, 1.05, 0.309]} hinge="r" open={open} color={door} />
    </group>
  )
}

/**
 * Dresser with mirror: wide three-drawer body, top in a separate color, framed mirror leaning on the wall at the back.
 * Lamps and pots can stand on the top (surface at 0.81 m). With a light or plug bound, the mirror frame glows.
 */
export function Dresser({ v }: { v: Visual }) {
  const body = v.opts.body ?? C.white
  const top = v.opts.top ?? '#dcb98c'
  const glow = useLitMaterial(C.white, v.on, v.on ? v.color : C.white, v.level || 1, 1.4)
  const mirror = useMemo(() => new THREE.MeshStandardMaterial({ color: '#dfe8f5', metalness: 0.75, roughness: 0.08, emissive: '#cfdcf0', emissiveIntensity: 0.15 }), [])
  return (
    <group>
      {[-0.44, 0.44].flatMap((x) => [-0.17, 0.17].map((z) => <Cyl key={`${x}${z}`} r={0.018} h={0.06} position={[x, 0.03, z]} color={C.ink} segments={10} shadow={false} />))}
      <group position={[0, 0.06, 0]}>
        <Drawers w={1} h={0.72} d={0.45} color={body} n={3} v={v} />
      </group>
      <Box size={[1.02, 0.025, 0.47]} position={[0, 0.795, 0]} color={top} radius={0.008} />
      {/* mirror: at the back, resting on the top */}
      <Box size={[0.78, 0.82, 0.03]} position={[0, 1.235, -0.19]} material={v.bound && v.on ? glow : mat(body)} radius={0.02} />
      <mesh position={[0, 1.235, -0.173]} material={mirror}>
        <planeGeometry args={[0.68, 0.72]} />
      </mesh>
    </group>
  )
}

/**
 * Mirror cabinet: wall-hung, 60 × 70 cm, two mirrored doors; above the washbasin (center at 1.5 m).
 * With a light bound, the strip on its bottom edge glows and lights the washbasin.
 */
export function MirrorCabinet({ v }: { v: Visual }) {
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#dfe8f5', metalness: 0.75, roughness: 0.08, emissive: '#cfdcf0', emissiveIntensity: 0.15 }), [])
  const strip = useLitMaterial(C.offWhite, v.on, v.on ? v.color : C.white, v.level || 1, 1.6)
  return (
    <group>
      <Box size={[0.6, 0.7, 0.14]} position={[0, 1.5, -0.01]} color={v.opts.body ?? C.white} radius={0.015} />
      <mesh material={glass} position={[-0.148, 1.5, 0.0625]}>
        <planeGeometry args={[0.285, 0.66]} />
      </mesh>
      <mesh material={glass} position={[0.148, 1.5, 0.0625]}>
        <planeGeometry args={[0.285, 0.66]} />
      </mesh>
      <Box size={[0.56, 0.016, 0.03]} position={[0, 1.145, 0.03]} material={strip} shadow={false} />
      {v.on && (
        <>
          <StripGlow length={0.56} width={0.05} position={[0, 1.14, 0.04]} color={v.color} opacity={v.level * (v.night ? 0.85 : 0.4)} />
          {/* wall face at local z -0.09: spreads down the wall and onto the washbasin from below the cabinet */}
          <Wash length={0.72} depth={0.7} position={[0, 1.14 - 0.35, -0.086]} color={v.color} opacity={v.level * (v.night ? 0.5 : 0.22)} />
        </>
      )}
    </group>
  )
}

/** Laundry basket: wicker style box, lid ajar, a piece of laundry sticking out. */
export function LaundryBasket() {
  return (
    <group>
      <Box size={[0.45, 0.55, 0.35]} position={[0, 0.275, 0]} color={C.kraft} radius={0.04} />
      {[0.14, 0.27, 0.4].map((y) => (
        <Box key={y} size={[0.455, 0.02, 0.355]} position={[0, y, 0]} color={C.kraftDark} shadow={false} />
      ))}
      <Box size={[0.2, 0.08, 0.14]} position={[0.08, 0.57, 0.02]} rotation={[0.2, 0.3, 0.1]} color={C.coral} radius={0.03} shadow={false} />
      <Box size={[0.46, 0.03, 0.36]} position={[-0.02, 0.6, -0.04]} rotation={[-0.35, 0, 0]} color={C.kraftDark} radius={0.01} />
    </group>
  )
}

/** Trash bin: pedal bin, stainless body, white lid. */
export function TrashBin() {
  return (
    <group>
      <Cyl r={0.14} rTop={0.15} h={0.42} position={[0, 0.21, 0]} color={C.steel} segments={24} />
      <Cyl r={0.155} h={0.035} position={[0, 0.437, 0]} color={C.white} segments={24} />
      <Box size={[0.1, 0.02, 0.06]} position={[0, 0.03, 0.15]} color={C.ink} />
    </group>
  )
}

/** Single-door wardrobe (60 cm): the door is hinged on the right, handle on the left. Colors as for the two-door wardrobe. */
export function WardrobeSingle({ v }: { v: Visual }) {
  const body = v.opts.body ?? C.white
  const door = v.opts.top ?? C.sunPale
  return (
    <group>
      <Carcass w={0.6} h={2.1} d={0.6} color={body} shelves={[0.53]} />
      <SwingDoor w={0.59} h={2.06} at={[0, 1.05, 0.309]} hinge="r" open={v.open ?? 0} color={door} />
    </group>
  )
}

/**
 * Shower enclosure 90 × 90: square (glass at the front and side, sliding door line at the corner) or round (quarter circle
 * curved glass). Stands against the back wall (-z) and the left side wall; with v.hingeRight against the right wall
 * (mirrored). The shower head is on the back wall, not the ceiling.
 */
export function Shower({ v }: { v: Visual }) {
  const round = v.opts.shape === 'round'
  const S = 0.9
  const H = 1.95
  const glass = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#dff1ff', transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    [],
  )
  const tray = mat(C.white, { roughness: 0.4 })
  const frame = C.steel
  return (
    <group scale-x={v.hingeRight ? -1 : 1}>
      {round ? (
        <>
          {/* quarter circle tray and curved glass: corner at (-S/2, -S/2), arc from the front to the right */}
          <mesh position={[-S / 2, 0.03, -S / 2]} material={tray} castShadow receiveShadow>
            <cylinderGeometry args={[S, S, 0.06, 32, 1, false, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[-S / 2, 0.06 + H / 2, -S / 2]} material={glass} renderOrder={4}>
            <cylinderGeometry args={[S - 0.02, S - 0.02, H, 32, 1, true, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[-S / 2, 0.06 + H, -S / 2]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[S - 0.02, 0.012, 6, 32, Math.PI / 2]} />
            <meshStandardMaterial color={frame} roughness={0.4} />
          </mesh>
        </>
      ) : (
        <>
          <Box size={[S, 0.06, S]} position={[0, 0.03, 0]} material={tray} />
          {/* front and right glass, thin frame, corner post */}
          <mesh position={[0, 0.06 + H / 2, S / 2 - 0.01]} material={glass} renderOrder={4}>
            <boxGeometry args={[S, H, 0.012]} />
          </mesh>
          <mesh position={[S / 2 - 0.01, 0.06 + H / 2, 0]} material={glass} renderOrder={4}>
            <boxGeometry args={[0.012, H, S]} />
          </mesh>
          <Box size={[0.025, H, 0.025]} position={[S / 2 - 0.01, 0.06 + H / 2, S / 2 - 0.01]} color={frame} shadow={false} />
          <Box size={[S, 0.02, 0.02]} position={[0, 0.06 + H, S / 2 - 0.01]} color={frame} shadow={false} />
          <Box size={[0.02, 0.02, S]} position={[S / 2 - 0.01, 0.06 + H, 0]} color={frame} shadow={false} />
          <Box size={[0.012, H - 0.1, 0.02]} position={[0.02, 0.06 + H / 2, S / 2]} color={frame} shadow={false} />
        </>
      )}
      {/* drain, mixer, riser pipe and head (on the back wall) */}
      <Cyl r={0.04} h={0.004} position={[-S / 2 + 0.3, 0.062, -S / 2 + 0.3]} color={C.steel} segments={16} shadow={false} />
      <Box size={[0.14, 0.06, 0.05]} position={[-S / 2 + 0.3, 1.05, -S / 2 + 0.03]} color={C.steel} />
      <Cyl r={0.012} h={1.0} position={[-S / 2 + 0.3, 1.55, -S / 2 + 0.03]} color={C.steel} segments={8} />
      <Cyl r={0.09} h={0.02} position={[-S / 2 + 0.3, 2.05, -S / 2 + 0.12]} rotation={[0.35, 0, 0]} color={C.steel} segments={20} />
    </group>
  )
}

/** Chest of drawers: hollow, the drawers slide (compartments 0, 1, 2... from the bottom up). */
function Drawers({ w, h, d, color, n, v }: { w: number; h: number; d: number; color: string; n: number; v: Visual }) {
  const dh = (h - 0.04) / n
  return (
    <group>
      <Carcass w={w} h={h} d={d} color={color} />
      {Array.from({ length: n }, (_, i) => (
        <Drawer key={i} w={w - 0.03} h={dh - 0.016} d={d - 0.04} at={[0, 0.02 + dh * (i + 0.5), -0.01]} open={partOpen(v, i)} color={color} />
      ))}
    </group>
  )
}

/** Drawer pedestal: a box with drawer fronts and handles (front faces +z). */
function DrawerStack({ x, w, h, d, color, n = 3 }: { x: number; w: number; h: number; d: number; color: string; n?: number }) {
  const dh = (h - 0.04) / n
  return (
    <group position={[x, 0, 0]}>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} radius={0.012} />
      {Array.from({ length: n }, (_, i) => {
        const y = 0.02 + dh * (i + 0.5)
        return (
          <group key={i}>
            <Box size={[w - 0.03, dh - 0.016, 0.012]} position={[0, y, d / 2 + 0.004]} color={color} shadow={false} />
            <Box size={[w * 0.36, 0.014, 0.018]} position={[0, y + dh * 0.22, d / 2 + 0.014]} color={C.steel} shadow={false} />
          </group>
        )
      })}
    </group>
  )
}

/**
 * Desk: adjustable length (v.opts.len), selectable top and body colors, optional drawer pedestal on the left, right or
 * both sides (left and right as seen by the person sitting at the desk; desk front is +z).
 */
export function Desk({ v }: { v: Visual }) {
  const L = v.opts.len ?? 1.4
  const D = 0.7
  const top = v.opts.top ?? C.white
  const legs = v.opts.body ?? C.ink
  const drawerColor = v.opts.body ?? C.white
  const dr = v.opts.drawers ?? 'none'
  const PED = 0.42
  return (
    <group>
      <Box size={[L, 0.05, D]} position={[0, 0.725, 0]} color={top} radius={0.02} />
      {([-1, 1] as const).map((sgn) => {
        const has = dr === 'both' || (dr === 'left' && sgn < 0) || (dr === 'right' && sgn > 0)
        return has ? (
          <DrawerStack key={sgn} x={sgn * (L / 2 - PED / 2 - 0.02)} w={PED} h={0.7} d={D - 0.06} color={drawerColor} />
        ) : (
          <Box key={sgn} size={[0.05, 0.7, D - 0.04]} position={[sgn * (L / 2 - 0.04), 0.35, 0]} color={legs} />
        )
      })}
    </group>
  )
}

/** Drawer unit (like a rolling pedestal): four drawers, top in a separate color. Fits under a desk. */
export function DrawerUnit({ v }: { v: Visual }) {
  return (
    <group>
      <Drawers w={0.42} h={0.69} d={0.5} color={v.opts.body ?? C.white} n={4} v={v} />
      <Box size={[0.42, 0.025, 0.5]} position={[0, 0.7, 0]} color={v.opts.top ?? v.opts.body ?? C.white} radius={0.008} />
    </group>
  )
}

export function Chair() {
  return (
    <group>
      {legs4(0.44, 0.44, 0.44, C.ink, 0.022)}
      <Box size={[0.5, 0.06, 0.5]} position={[0, 0.46, 0]} color={C.sun} radius={0.03} />
      <Box size={[0.5, 0.48, 0.05]} position={[0, 0.74, -0.22]} color={C.sun} radius={0.03} />
    </group>
  )
}

export function DiningTable() {
  return (
    <group>
      <Box size={[1.4, 0.06, 0.85]} position={[0, 0.75, 0]} color={C.white} radius={0.03} />
      {legs4(1.4, 0.85, 0.72, C.kraft, 0.03)}
      <Cyl r={0.08} rTop={0.16} h={0.08} position={[0, 0.82, 0]} color={C.brandPale} />
      <Ball r={0.055} position={[0.02, 0.88, 0.02]} color={C.sun} />
      <Ball r={0.05} position={[-0.06, 0.87, -0.03]} color={C.coral} />
    </group>
  )
}

/**
 * Counter run: base cabinets with doors, countertop, wall cabinets; optional LED.
 * Local: length along x, front faces +z, back against the wall. LED "under": below the wall cabinets, lights the counter;
 * "plinth": in the plinth, lights the floor.
 */
function CounterRun({ len, top, body, door, led, lit, v, uppers = true, sinkAt }: { len: number; top: string; body: string; door: string; led: NonNullable<Visual['opts']['led']>; lit: THREE.Material; v: Visual; uppers?: boolean; sinkAt?: number }) {
  const n = Math.max(1, Math.round(len / 0.5))
  const dw = len / n
  const fronts = Array.from({ length: n }, (_, i) => -len / 2 + dw * (i + 0.5))
  // Base cabinet: plinth, hollow carcass with a shelf, hinged doors; wall cabinet likewise (compartments 0-1 base, 2-3 wall)
  const lower = Math.max(partOpen(v, 0), partOpen(v, 1))
  const upper = Math.max(partOpen(v, 2), partOpen(v, 3))
  return (
    <group>
      <Box size={[len, 0.08, 0.52]} position={[0, 0.04, -0.04]} color={shade(body, 0.8)} />
      <Carcass w={len} h={0.78} d={0.6} y={0.08} color={body} shelves={[0.37]} top={sinkAt == null} />
      {fronts.map((x, i) => (
        <SwingDoor key={x} w={dw - 0.012} h={0.74} at={[x, 0.47, 0.309]} hinge={i % 2 ? 'r' : 'l'} open={lower} color={door} handle={0.14} />
      ))}
      <CounterTop len={len + 0.02} color={top} sinkAt={sinkAt} />
      {uppers && <Carcass w={len} h={0.6} d={0.34} y={1.65} z={-0.13} color={body} shelves={[0.3]} />}
      {uppers &&
        fronts.map((x, i) => (
          <SwingDoor key={x} w={dw - 0.012} h={0.58} at={[x, 1.95, 0.049]} hinge={i % 2 ? 'r' : 'l'} open={upper} color={door} handle={0.14} />
        ))}
      {led === 'under' && uppers && (
        <>
          <Box size={[len - 0.04, 0.012, 0.02]} position={[0, 1.643, 0.0]} material={lit} shadow={false} />
          {v.on && (
            <>
              <StripGlow length={len - 0.04} width={0.05} position={[0, 1.636, 0.0]} color={v.color} opacity={v.level * (v.night ? 1 : 0.6)} />
              {/* counter surface: bright at the back (by the wall), fading towards the front */}
              <Wash length={len} depth={0.6} position={[0, 0.913, 0]} rotation={[-Math.PI / 2, 0, 0]} color={v.color} opacity={v.level * (v.night ? 0.8 : 0.4)} />
              {/* backsplash: from below the wall cabinets down to the counter */}
              <Wash length={len} depth={0.72} position={[0, 1.643 - 0.36, -0.316]} color={v.color} opacity={v.level * (v.night ? 0.72 : 0.34)} />
            </>
          )}
        </>
      )}
      {led === 'plinth' && (
        <>
          <Box size={[len - 0.04, 0.012, 0.012]} position={[0, 0.03, 0.27]} material={lit} shadow={false} />
          {v.on && (
            <>
              <StripGlow length={len - 0.04} width={0.04} position={[0, 0.03, 0.28]} color={v.color} opacity={v.level * (v.night ? 1 : 0.55)} />
              {/* floor: fading forward from the cabinet base */}
              <Wash length={len} depth={0.5} position={[0, 0.004, 0.27 + 0.25]} rotation={[-Math.PI / 2, 0, 0]} color={v.color} opacity={v.level * (v.night ? 0.8 : 0.4)} />
            </>
          )}
        </>
      )}
    </group>
  )
}

/**
 * Kitchen counter: adjustable length (v.opts.len); the L variants (left or right corner) add a second run along the side
 * wall (len2: total length of that run from the corner). Counter and cabinet colors are selectable. With a light bound, the
 * LED follows that light.
 */
export function KitchenCounter({ v }: { v: Visual }) {
  const L = v.opts.len ?? 2
  const D = 0.6
  const top = v.opts.top ?? C.offWhite
  const body = v.opts.body ?? C.white
  const door = v.opts.body ? v.opts.body : C.brandPale
  const led = v.opts.led ?? 'none'
  // The LED follows the entity picked on the card, else the counter's main entity
  const picked = pickedLed(v)
  const lv: Visual = picked ? { ...v, on: picked.on, color: picked.color, level: picked.level } : v
  const lit = useLitMaterial(C.offWhite, lv.on, lv.color, lv.level || 1, 2)
  const variant = v.opts.variant ?? 'straight'
  const isL = variant === 'lLeft' || variant === 'lRight'
  const leg = Math.max(D + 0.2, v.opts.len2 ?? 1.8)
  const sx = variant === 'lRight' ? 1 : -1
  const run = { top, body, door, led, lit, v: lv }
  return (
    <group>
      <CounterRun len={L} {...run} sinkAt={v.opts.sinkAt} />
      {isL && (
        // Run along the side wall: starts after the corner square, its front faces into the room (towards the opposite corner).
        <group position={[sx * (L / 2 - D / 2), 0, D / 2 + (leg - D) / 2]} rotation-y={sx > 0 ? -Math.PI / 2 : Math.PI / 2}>
          {/* No wall cabinets on this run: there may be no side wall (it can reach into the room like a peninsula). */}
          <CounterRun len={leg - D} {...run} uppers={false} led={led === 'under' ? 'none' : led} />
        </group>
      )}
    </group>
  )
}

export function Fridge() {
  return (
    <group>
      <Box size={[0.74, 1.9, 0.68]} position={[0, 0.95, 0]} color={C.white} radius={0.05} />
      <Box size={[0.75, 0.02, 0.02]} position={[0, 1.28, 0.34]} color={C.steel} shadow={false} />
      <Box size={[0.03, 0.36, 0.04]} position={[0.28, 1.55, 0.36]} color={C.steel} />
      <Box size={[0.03, 0.44, 0.04]} position={[0.28, 0.9, 0.36]} color={C.steel} />
    </group>
  )
}

export function Stove() {
  return (
    <group>
      <Box size={[0.74, 0.86, 0.6]} position={[0, 0.43, 0]} color={C.white} />
      <Box size={[0.76, 0.04, 0.62]} position={[0, 0.88, 0]} color={C.ink} />
      {[-0.16, 0.16].flatMap((x) => [-0.13, 0.13].map((z) => <Cyl key={`${x}${z}`} r={0.09} h={0.012} position={[x, 0.905, z]} color={C.inkSoft} shadow={false} />))}
      <Box size={[0.6, 0.42, 0.02]} position={[0, 0.42, 0.305]} color={C.ink} shadow={false} />
      <Box size={[0.76, 0.12, 0.48]} position={[0, 1.82, -0.06]} color={C.steel} />
      <Box size={[0.28, 0.68, 0.26]} position={[0, 2.22, -0.16]} color={C.steel} />
    </group>
  )
}

/** Sink cabinet: plinth, two-door base cabinet, inset steel bowl and gooseneck faucet (CounterTop). */
export function Sink() {
  return (
    <group>
      <Box size={[1, 0.08, 0.52]} position={[0, 0.04, -0.04]} color={shade(C.white, 0.8)} />
      <Carcass w={1} h={0.78} d={0.6} y={0.08} color={C.white} top={false} />
      <SwingDoor w={0.49} h={0.74} at={[-0.25, 0.47, 0.309]} hinge="l" open={0} color={C.brandPale} handle={0.14} />
      <SwingDoor w={0.49} h={0.74} at={[0.25, 0.47, 0.309]} hinge="r" open={0} color={C.brandPale} handle={0.14} />
      <CounterTop len={1.02} color={C.offWhite} sinkAt={0} />
    </group>
  )
}

export function Bathtub() {
  return (
    <group>
      <Box size={[1.6, 0.55, 0.75]} position={[0, 0.275, 0]} color={C.white} radius={0.08} />
      <Box size={[1.4, 0.02, 0.56]} position={[0, 0.555, 0]} material={mat('#bfe0ff', { roughness: 0.15 })} shadow={false} />
      <Cyl r={0.02} h={0.2} position={[-0.7, 0.68, -0.3]} color={C.steel} />
    </group>
  )
}

export function Toilet() {
  return (
    <group>
      <Box size={[0.38, 0.36, 0.16]} position={[0, 0.55, -0.24]} color={C.white} radius={0.04} />
      <Cyl r={0.17} rTop={0.19} h={0.4} position={[0, 0.2, 0.05]} color={C.white} />
      <Cyl r={0.2} h={0.03} position={[0, 0.415, 0.05]} color={C.offWhite} />
    </group>
  )
}

export function Washbasin() {
  return (
    <group>
      <Box size={[0.6, 0.5, 0.42]} position={[0, 0.55, 0]} color={C.white} radius={0.03} />
      <Box size={[0.42, 0.02, 0.28]} position={[0, 0.81, 0.02]} color={C.steel} shadow={false} />
      <Cyl r={0.018} h={0.18} position={[0, 0.88, -0.15]} color={C.steel} />
    </group>
  )
}

export function ShoeCabinet({ v }: { v: Visual }) {
  const open = v.open ?? 0
  return (
    <group>
      <Carcass w={1} h={0.9} d={0.35} color={C.white} shelves={[0.44]} />
      <SwingDoor w={0.49} h={0.86} at={[-0.25, 0.45, 0.184]} hinge="l" open={open} color={C.sunPale} handle={0.16} />
      <SwingDoor w={0.49} h={0.86} at={[0.25, 0.45, 0.184]} hinge="r" open={open} color={C.sunPale} handle={0.16} />
      <Cyl r={0.07} h={0.18} position={[0.3, 0.99, 0]} color={C.terracotta} />
      <Ball r={0.1} position={[0.3, 1.13, 0]} color={C.leaf} flat detail={1} />
    </group>
  )
}

export function Bookshelf() {
  const books = useMemo(() => {
    const rand = rng(11)
    const out: { x: number; y: number; w: number; h: number; color: string }[] = []
    for (const base of [0.05, 0.55, 1.05, 1.55]) {
      let x = -0.54
      while (x < 0.5) {
        const w = 0.05 + rand() * 0.06
        if (rand() < 0.12) {
          x += w * 1.6
          continue
        }
        const h = 0.24 + rand() * 0.16
        out.push({ x: x + w / 2, y: base + h / 2, w, h, color: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)] })
        x += w + 0.008
      }
    }
    return out
  }, [])
  return (
    <group>
      <Box size={[0.05, 2, 0.35]} position={[-0.6, 1, 0]} color={C.white} />
      <Box size={[0.05, 2, 0.35]} position={[0.6, 1, 0]} color={C.white} />
      <Box size={[1.25, 0.05, 0.35]} position={[0, 1.975, 0]} color={C.white} />
      <Box size={[1.25, 0.05, 0.35]} position={[0, 0.025, 0]} color={C.white} />
      <Box size={[1.25, 2, 0.02]} position={[0, 1, -0.165]} color={C.brandPale} />
      {[0.52, 1.02, 1.52].map((y) => (
        <Box key={y} size={[1.15, 0.035, 0.32]} position={[0, y, 0]} color={C.white} />
      ))}
      {books.map((b, i) => (
        <Box key={i} size={[b.w, b.h, 0.24]} position={[b.x, b.y, 0.02]} color={b.color} shadow={false} />
      ))}
    </group>
  )
}

export function Plant() {
  return (
    <group>
      <Cyl r={0.2} rTop={0.24} h={0.42} position={[0, 0.21, 0]} color={C.terracotta} />
      <Ball r={0.3} position={[0, 0.82, 0]} color={C.leaf} flat detail={1} />
      <Ball r={0.24} position={[0.18, 1.02, 0.08]} color={C.leafDark} flat detail={1} />
      <Ball r={0.18} position={[-0.12, 1.18, -0.05]} color={C.mint} flat detail={1} />
    </group>
  )
}

/**
 * TV unit: adjustable length (Item.len, 0.8-3.2 m), number of doors follows the length (one per ~90 cm).
 * Surface at 0.5 m (rules.ts > SURFACE_Y): holds a TV, console, lamp or pot. Door and body colors are selectable.
 */
export function TvUnit({ v }: { v: Visual }) {
  const L = v.opts.len ?? 1.8
  const D = 0.42
  const H = 0.48
  const n = Math.max(2, Math.round(L / 0.9))
  const gap = 0.02
  const doorW = (L - 0.04 - (n - 1) * gap) / n
  const body = v.opts.body ?? C.white
  const door = v.opts.top ?? C.brandPale
  const open = v.open ?? 0
  return (
    <group>
      <Carcass w={L} h={H} d={D} y={0.01} color={body} />
      {Array.from({ length: n }, (_, i) => (
        <SwingDoor key={i} w={doorW} h={H - 0.03} at={[-L / 2 + 0.02 + doorW / 2 + i * (doorW + gap), 0.01 + H / 2, D / 2 + 0.009]} hinge={i % 2 ? 'r' : 'l'} open={open} color={door} handle={0.1} />
      ))}
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.05, 0.02, D - 0.1]} position={[sx * (L / 2 - 0.12), 0.01, 0]} color={C.ink} shadow={false} />
      ))}
    </group>
  )
}

/**
 * Gaming chair: five-star base with casters, gas lift, racing seat (side bolsters), slightly reclined high back (wings,
 * center stripe), head and lumbar pillows, armrests. Front faces +z (towards the desk). Body color Item.body, stripe color
 * Item.top (bright colors). Fits under a desk (rules.ts > TUCKS).
 */
export function GamingChair({ v }: { v: Visual }) {
  const body = v.opts.body ?? C.ink
  const accent = v.opts.top ?? '#e2564b'
  const legs = [0, 1, 2, 3, 4].map((i) => (i * Math.PI * 2) / 5)
  return (
    <group>
      {/* five-star base and casters */}
      {legs.map((a) => (
        <group key={a} rotation-y={a}>
          <Box size={[0.05, 0.035, 0.3]} position={[0, 0.07, 0.15]} color={C.ink} shadow={false} />
          <Ball r={0.028} position={[0, 0.03, 0.29]} color={C.inkSoft} detail={1} shadow={false} />
        </group>
      ))}
      <Cyl r={0.045} h={0.06} position={[0, 0.09, 0]} color={C.ink} segments={14} shadow={false} />
      <Cyl r={0.026} h={0.28} position={[0, 0.24, 0]} color={C.steel} segments={12} />
      <Box size={[0.24, 0.04, 0.24]} position={[0, 0.39, 0]} color={C.ink} shadow={false} />
      {/* seat and side bolsters */}
      <Box size={[0.54, 0.09, 0.52]} position={[0, 0.455, 0.02]} color={body} radius={0.035} />
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.07, 0.06, 0.48]} position={[sx * 0.245, 0.51, 0.02]} color={accent} radius={0.02} shadow={false} />
      ))}
      {/* armrests */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.31, 0, -0.02]}>
          <Box size={[0.04, 0.22, 0.05]} position={[0, 0.6, 0]} color={C.ink} shadow={false} />
          <Box size={[0.08, 0.035, 0.26]} position={[0, 0.725, 0.02]} color={C.ink} radius={0.012} />
        </group>
      ))}
      {/* backrest: slightly reclined */}
      <group position={[0, 0.5, -0.25]} rotation-x={-0.12}>
        <Box size={[0.5, 0.88, 0.1]} position={[0, 0.46, 0]} color={body} radius={0.04} />
        {[-1, 1].map((sx) => (
          <Box key={sx} size={[0.07, 0.62, 0.13]} position={[sx * 0.245, 0.36, 0.02]} color={accent} radius={0.025} shadow={false} />
        ))}
        <Box size={[0.07, 0.58, 0.102]} position={[0, 0.4, 0.004]} color={accent} shadow={false} />
        {/* head and lumbar pillows */}
        <Box size={[0.26, 0.12, 0.07]} position={[0, 0.78, 0.075]} color={C.ink} radius={0.03} shadow={false} />
        <Box size={[0.3, 0.13, 0.07]} position={[0, 0.2, 0.075]} color={C.ink} radius={0.03} shadow={false} />
      </group>
    </group>
  )
}
