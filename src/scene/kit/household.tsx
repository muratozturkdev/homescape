import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { deviceClass, domainOf, isActive, num } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { formatNumber } from '@/i18n'
import { treeScale } from '@/model/catalog'
import { WALL_H } from '@/model/geometry'
import { assistRing, clockHands, clockText, distanceM, parkingBar, phoneState } from '@/model/household'
import { markShadows } from '../frame'
import { Airflow, Glow, Mist, MusicNotes, Ripple, Spin, useAmbient, useLitMaterial } from './effects'
import { C } from './palette'
import { Ball, Box, Cyl, mat } from './primitives'
import { Flames } from './smart'
import { artTexture } from './textures'
import type { Visual } from './visual'

/*
 * Household items: lights, climate, media, security, sensors, smart devices, kitchen, bath, furniture, decor, pets, garden,
 * garage and structure items that complete the catalog. Same local convention as kit/smart.tsx: origin at the center of the
 * footprint on the floor, front at +z, width along x; wall items have their back at local z = -depth/2 and are drawn at
 * their real height (rules.ts > WALL_SPAN); ceiling items hang from WALL_H; items on a surface start at y = 0 (ItemNode lifts
 * them onto the surface). Animations request frames only while active (useAmbient); geometries and transparent materials
 * are cached at module level. State logic that the checks test lives in model/household.ts.
 */

type P = { v: Visual }

const TAU = Math.PI * 2

const MONO = '"JetBrains Mono", ui-monospace, monospace'

/** Effect meshes (halo, cone, steam) must not catch clicks. */
const noHit = () => null

/** Body color: pale gray when unavailable, otherwise the color picked on the card (Item.body) or the default. */
const bodyOf = (v: Visual, def: string) => (v.unavailable ? '#9aa0b8' : (v.opts.body ?? def))

/** Glowing part: emissive in its own color while lit, plain otherwise (cached by value). */
const glowing = (color: string, lit: boolean, k = 1.6) => (lit ? mat(color, { emissive: color, emissiveIntensity: Math.round(k * 10) / 10 }) : mat('#4a4e5a'))

/** The bound entities as records: the main one first, then the extras (for items whose state comes from several) */
const entitiesOf = (v: Visual): HassEntity[] => [...(v.bound ? [{ entity_id: `${v.domain}.main`, state: v.state, attributes: v.attrs } as unknown as HassEntity] : []), ...v.related]

const relatedOf = (v: Visual, domain: string) => (v.domain === domain ? { state: v.state, attributes: v.attrs } : v.related.find((e) => domainOf(e.entity_id) === domain))

const geos = new Map<string, THREE.BufferGeometry>()

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T) {
  let g = geos.get(key) as T | undefined
  if (!g) {
    g = make()
    geos.set(key, g)
  }
  return g
}

const torus = (r: number, tube: number, seg = 32) => geo(`t${r},${tube},${seg}`, () => new THREE.TorusGeometry(r, tube, 8, seg))

const disc = (r: number, seg = 32) => geo(`d${r},${seg}`, () => new THREE.CircleGeometry(r, seg))

const plane = (w: number, h: number) => geo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h))

/** Open ended cone: apex at +y (h/2), base at -y. */
const cone = (r: number, h: number, seg = 16) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg, 1, true))

/** Transparent surface (glass, water): one material per color and opacity; no depth write, the contents stay visible. */
const clears = new Map<string, THREE.MeshStandardMaterial>()

function clear(color: string, opacity: number, roughness = 0.08) {
  const key = `${color},${opacity},${roughness}`
  let m = clears.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness, metalness: 0.1, depthWrite: false })
    clears.set(key, m)
  }
  return m
}

/** Small display textures with text (clock, scale, inverter): cached by key, the least recently used disposed. */
const texts = new Map<string, THREE.CanvasTexture>()

function textTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let t = texts.get(key)
  if (t) {
    texts.delete(key)
    texts.set(key, t)
    return t
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texts.set(key, t)
  if (texts.size > 48) {
    const [oldKey, old] = texts.entries().next().value!
    texts.delete(oldKey)
    old.dispose()
  }
  return t
}

/** Display with one line of text, centered: green LCD, white screen or dim when off */
function lcdTexture(text: string, style: 'lcd' | 'screen' | 'off') {
  return textTexture(`lcd-${style}-${text}`, 256, 96, (g) => {
    g.fillStyle = style === 'lcd' ? '#0e2a1e' : style === 'screen' ? '#202a4a' : '#1b2036'
    g.fillRect(0, 0, 256, 96)
    g.fillStyle = style === 'lcd' ? '#7dffb2' : style === 'screen' ? '#ffffff' : 'rgba(255, 255, 255, 0.35)'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 52px ${MONO}`
    const w = g.measureText(text).width
    if (w > 236) g.font = `600 ${Math.floor((52 * 236) / w)}px ${MONO}`
    g.fillText(text, 128, 52)
  })
}

/** A display material on a text texture (disposed with its component; the texture stays in the cache) */
function useDisplay(text: string, style: 'lcd' | 'screen' | 'off') {
  const tex = lcdTexture(text, style)
  const m = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex])
  useEffect(() => () => m.dispose(), [m])
  return m
}

/** The current time, refreshed every half minute (clocks); requests a frame when it changes. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date())
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
      invalidate()
    }, ms)
    return () => clearInterval(id)
  }, [ms, invalidate])
  return now
}

/** Eases a value toward target and applies it each frame until it arrives (a flap, a lid, a door). */
function useEase(target: number, apply: (v: number) => void, speed = 6) {
  const cur = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [target, invalidate])
  useFrame((state, dt) => {
    if (cur.current === null) {
      cur.current = target
      apply(target)
      return
    }
    const d = target - cur.current
    if (Math.abs(d) < 0.0005) return
    cur.current = Math.abs(d) < 0.002 ? target : cur.current + d * Math.min(1, dt * speed)
    apply(cur.current)
    markShadows(1)
    state.invalidate()
  })
}

/** Pulses the scale of a mesh while active (a ring, a status light). */
function usePulse(active: boolean, speed = 6, amount = 0.12) {
  const ref = useRef<THREE.Mesh>(null)
  useAmbient(active)
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const s = active ? 1 + amount * Math.sin(clock.elapsedTime * speed) : 1
    m.scale.set(s, s, s)
  })
  return ref
}

/** Shows and hides a part at a rate while active (a blinking light); always shown while inactive. */
function useBlink(active: boolean, hz = 1.5) {
  const ref = useRef<THREE.Mesh>(null)
  useAmbient(active, true)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.visible = !active || Math.sin(clock.elapsedTime * hz * TAU) > 0
  })
  return ref
}

/** Whether a timestamp state (an event entity) is less than ms old; re-renders when it gets old. */
function useRecent(stamp: string, ms: number) {
  const at = Date.parse(stamp)
  const [, tick] = useState(0)
  const fresh = Number.isFinite(at) && Date.now() - at < ms
  useEffect(() => {
    if (!fresh) return
    const id = setTimeout(() => tick((n) => n + 1), ms - (Date.now() - at) + 50)
    return () => clearTimeout(id)
  }, [fresh, at, ms])
  return fresh
}

/* ---------- lights ---------- */

/**
 * Plug-in night light (in an outlet, 30 cm up): a small dome that glows warm when on, brighter while a bound motion or
 * occupancy sensor sees someone (or when the sensor itself is the main entity).
 */
export function NightLight({ v }: P) {
  const motion = v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(deviceClass(e)) && isActive(e))
  const lit = v.on || motion
  const k = lit ? (motion || v.domain === 'binary_sensor' ? 1 : 0.55) : 0
  const lens = useLitMaterial('#f1ede4', lit, v.color, Math.max(k, 0.3), 2.2)
  const Y = 0.3
  return (
    <group>
      <Box size={[0.07, 0.1, 0.03]} position={[0, Y, -0.01]} color={C.white} radius={0.012} />
      <Cyl r={0.027} h={0.014} position={[0, Y - 0.012, 0.008]} rotation={[Math.PI / 2, 0, 0]} material={lens} segments={20} shadow={false} />
      {lit && <Glow position={[0, Y - 0.05, 0.05]} color={v.color} opacity={(v.night ? 0.8 : 0.35) * k} size={0.6} />}
    </group>
  )
}

/**
 * Twin floodlight (outdoors on the house wall, 2.45 m): a wall box with two angled heads; when on the lenses light and a
 * wide halo falls below. With a camera bound as an extra a small dome camera sits between the heads, its lens dot lit
 * while the camera records or streams.
 */
export function Floodlight({ v }: P) {
  const lens = useLitMaterial('#dfe3ea', v.on, v.color, v.level || 1, 2.6)
  const cam = relatedOf(v, 'camera')
  const live = Boolean(cam && ['recording', 'streaming'].includes(cam.state))
  const Y = 2.45
  return (
    <group>
      <Box size={[0.12, 0.08, 0.05]} position={[0, Y + 0.02, -0.075]} color="#2a2c33" radius={0.01} />
      {[-0.08, 0.08].map((x) => (
        <group key={x} position={[x, Y - 0.02, -0.02]} rotation={[0.55, x > 0 ? -0.3 : 0.3, 0]}>
          <Box size={[0.13, 0.09, 0.06]} color="#2a2c33" radius={0.01} />
          <Box size={[0.11, 0.07, 0.006]} position={[0, 0, 0.031]} material={lens} shadow={false} />
        </group>
      ))}
      {cam && <Ball r={0.022} position={[0, Y - 0.07, -0.02]} color="#15171d" />}
      {cam && <Ball r={0.006} position={[0, Y - 0.08, 0.0]} material={glowing(C.alarm, live)} shadow={false} />}
      {v.on && <Glow position={[0, Y - 0.12, 0.2]} color={v.color} opacity={v.night ? 0.9 : 0.35} size={1.2} />}
    </group>
  )
}

/** Honeycomb of seven hexagonal light panels on the wall, a center height of 1.62 m. */
const HEX_TILES: [number, number][] = [
  [0, 0],
  [0.15, 0.087],
  [0.15, -0.087],
  [-0.15, 0.087],
  [-0.15, -0.087],
  [0.3, 0],
  [-0.3, 0],
]
const hexTile = () => geo('hex-tile', () => new THREE.CylinderGeometry(0.096, 0.096, 0.016, 6))

/**
 * Light panels (hexagon tiles on the wall): white tiles when off; when on each tile glows in the light's color, shifted a
 * little in hue tile by tile, brighter with the brightness.
 */
export function LightPanels({ v }: P) {
  const Y = 1.62
  const tiles = useMemo(
    () =>
      HEX_TILES.map((_, i) => {
        const c = new THREE.Color(v.color)
        c.offsetHSL((i - 3) * 0.03, 0, 0)
        return `#${c.getHexString()}`
      }),
    [v.color],
  )
  const k = v.on ? 0.6 + v.level : 0
  return (
    <group>
      {HEX_TILES.map(([x, y], i) => (
        <mesh key={i} position={[x, Y + y, -0.012]} rotation={[Math.PI / 2, 0, 0]} geometry={hexTile()} material={v.on ? glowing(tiles[i], true, k) : mat('#eceef4')} castShadow />
      ))}
      {v.on && <Glow position={[0, Y, 0.1]} color={v.color} opacity={v.night ? 0.7 : 0.3} size={1.4} />}
    </group>
  )
}

/** Neon sign tube shapes in the sign's plane (x right, y up, about 0.45 m wide) */
const NEON_SHAPES: Record<string, { pts: [number, number][]; closed: boolean }> = {
  heart: {
    pts: Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * TAU
      return [0.011 * 16 * Math.sin(a) ** 3, 0.011 * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) + 0.02] as [number, number]
    }),
    closed: true,
  },
  wave: { pts: Array.from({ length: 16 }, (_, i) => [-0.24 + (i / 15) * 0.48, 0.07 * Math.sin((i / 15) * TAU * 1.5)] as [number, number]), closed: false },
  bolt: {
    pts: [
      [0.06, 0.19],
      [-0.09, 0.0],
      [0.02, 0.0],
      [-0.06, -0.19],
      [0.1, 0.03],
      [-0.01, 0.03],
      [0.06, 0.19],
    ],
    closed: true,
  },
}
const neonTube = (kind: string) =>
  geo(`neon-${kind}`, () => {
    const s = NEON_SHAPES[kind]
    const curve = new THREE.CatmullRomCurve3(
      s.pts.map(([x, y]) => new THREE.Vector3(x, y, 0)),
      s.closed,
      'catmullrom',
      kind === 'bolt' ? 0.05 : 0.5,
    )
    return new THREE.TubeGeometry(curve, 96, 0.009, 8, s.closed)
  })

/**
 * Neon sign on a clear acrylic backboard (wall, 1.7 m): a tube shape (heart, wave or bolt, Item.variant) in its color
 * (Item.body; a bound color light gives its own). Pale glass tube when off, a strong glow and halo when on.
 */
export function NeonSign({ v }: P) {
  const kind = v.opts.variant && NEON_SHAPES[v.opts.variant] ? v.opts.variant : 'heart'
  const color = v.domain === 'light' && v.on ? v.color : (v.opts.body ?? '#e2564b')
  const Y = 1.7
  return (
    <group position={[0, Y, -0.012]}>
      <Box size={[0.6, 0.46, 0.008]} position={[0, 0, -0.008]} material={clear('#ffffff', 0.16, 0.2)} shadow={false} />
      <mesh geometry={neonTube(kind)} material={v.on ? glowing(color, true, 2.4) : mat('#dcdde6', { roughness: 0.3 })} />
      {v.on && <Glow position={[0, 0, 0.06]} color={color} opacity={v.night ? 0.95 : 0.45} size={1.1} />}
    </group>
  )
}

/* ---------- climate ---------- */

/**
 * Portable air conditioner (on the floor by a wall, 0.75 m): a tower on casters with a display and a top flap, the exhaust
 * hose into the wall behind it. While it cools the flap opens and cool air streams out.
 */
export function PortableAc({ v }: P) {
  const body = bodyOf(v, '#f4f5f8')
  const cooling = v.on && (v.domain !== 'climate' || ['cool', 'dry', 'fan_only', 'auto', 'heat_cool'].includes(v.state))
  const disp = useLitMaterial(C.screenOff, v.on, C.cool, 0.9, 1.6)
  const flap = useRef<THREE.Group>(null)
  useEase(cooling ? -0.9 : 0, (a) => {
    if (flap.current) flap.current.rotation.x = a
  })
  return (
    <group>
      <Box size={[0.4, 0.7, 0.34]} position={[0, 0.39, 0]} color={body} radius={0.04} />
      {[-0.14, 0.14].flatMap((x) => [-0.12, 0.12].map((z) => <Cyl key={`${x}${z}`} r={0.022} h={0.035} position={[x, 0.018, z]} color={C.inkSoft} segments={12} />))}
      <group ref={flap} position={[0, 0.745, 0.15]}>
        <Box size={[0.32, 0.012, 0.12]} position={[0, 0, -0.06]} color={body} shadow={false} />
      </group>
      <Box size={[0.11, 0.035, 0.006]} position={[0, 0.62, 0.171]} material={disp} shadow={false} />
      <Cyl r={0.055} h={0.12} position={[0, 0.5, -0.2]} rotation={[Math.PI / 2, 0, 0]} color="#d8dbe3" segments={16} />
      <Airflow active={cooling} color={C.cool} y={0.76} />
    </group>
  )
}

/**
 * Wood or pellet stove (on the floor by a wall): a black stove on legs with a glass door and a flue pipe up to the ceiling.
 * While it heats flames flicker behind the glass and a warm halo spreads into the room.
 */
export function WoodStove({ v }: P) {
  const body = bodyOf(v, '#2b2d33')
  const heating = v.on && (v.domain !== 'climate' || v.state !== 'off')
  return (
    <group>
      {[-0.23, 0.23].flatMap((x) => [-0.18, 0.18].map((z) => <Box key={`${x}${z}`} size={[0.04, 0.14, 0.04]} position={[x, 0.07, z]} color={body} />))}
      <Box size={[0.56, 0.52, 0.36]} position={[0, 0.4, -0.06]} color={body} radius={0.02} />
      {/* front frame around the firebox: open behind the glass, so the flames show inside */}
      <Box size={[0.56, 0.12, 0.12]} position={[0, 0.6, 0.18]} color={body} />
      <Box size={[0.56, 0.12, 0.12]} position={[0, 0.2, 0.18]} color={body} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.1, 0.28, 0.12]} position={[s * 0.23, 0.4, 0.18]} color={body} />
      ))}
      <Box size={[0.36, 0.28, 0.01]} position={[0, 0.4, 0.125]} color="#15161a" shadow={false} />
      {[-0.06, 0.06].map((x) => (
        <Cyl key={x} r={0.025} h={0.3} position={[x, 0.29, 0.18]} rotation={[0, 0, Math.PI / 2 + x * 2]} color="#6b4a34" segments={8} />
      ))}
      <Box size={[0.36, 0.28, 0.006]} position={[0, 0.4, 0.237]} material={clear(heating ? '#ffb27a' : '#9aa0b8', heating ? 0.25 : 0.22, 0.1)} shadow={false} />
      <Cyl r={0.07} h={WALL_H - 0.66} position={[0, 0.66 + (WALL_H - 0.66) / 2, -0.08]} color={body} segments={16} />
      {heating && (
        <group position={[0, 0, 0.17]} scale={0.75}>
          <Flames y={0.38} night={v.night} />
        </group>
      )}
    </group>
  )
}

/**
 * Extractor fan (high on the wall, 2.2 m): a square grille with blades behind it that spin while the fan runs, faster
 * with the speed (percentage).
 */
export function ExhaustFan({ v }: P) {
  const pct = num(v.attrs.percentage)
  const speed = v.on ? 6 + ((pct ?? 60) / 100) * 18 : 0
  const Y = 2.2
  return (
    <group position={[0, Y, -0.025]}>
      <Box size={[0.28, 0.28, 0.04]} color={C.white} radius={0.02} />
      <mesh position={[0, 0, 0.021]} geometry={disc(0.11, 28)} material={mat('#2a2d38')} />
      <group position={[0, 0, 0.024]}>
        <Spin speed={speed} axis="z">
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} size={[0.03, 0.1, 0.004]} position={[Math.sin((i / 4) * TAU) * 0.05, Math.cos((i / 4) * TAU) * 0.05, 0]} rotation={[0, 0, -(i / 4) * TAU]} color={C.steel} shadow={false} />
          ))}
        </Spin>
      </group>
      {[-0.08, -0.04, 0, 0.04, 0.08].map((y) => (
        <Box key={y} size={[0.24, 0.008, 0.006]} position={[0, y, 0.03]} color={C.white} shadow={false} />
      ))}
    </group>
  )
}

/* ---------- media ---------- */

/**
 * Turntable (on a surface): a wooden plinth, a black platter with a red label, the tonearm at the back right. While the
 * bound player plays the record spins, the arm swings onto it and notes rise.
 */
export function Turntable({ v }: P) {
  const playing = v.domain === 'media_player' ? v.state === 'playing' : v.on
  const arm = useRef<THREE.Group>(null)
  useEase(playing ? 0.45 : 0, (a) => {
    if (arm.current) arm.current.rotation.y = a
  })
  return (
    <group>
      <Box size={[0.44, 0.08, 0.34]} position={[0, 0.04, 0]} color={bodyOf(v, '#6b4a34')} radius={0.01} />
      <Box size={[0.42, 0.004, 0.32]} position={[0, 0.082, 0]} color="#1f2024" shadow={false} />
      <group position={[-0.05, 0.088, 0]}>
        <Spin speed={playing ? 3.5 : 0} axis="y">
          <Cyl r={0.15} h={0.006} color="#141416" segments={40} />
          <Cyl r={0.05} h={0.007} position={[0.01, 0.0005, 0]} color="#e2564b" segments={24} shadow={false} />
        </Spin>
      </group>
      <group ref={arm} position={[0.17, 0.1, -0.12]}>
        <Cyl r={0.018} h={0.03} color={C.steel} segments={12} />
        <Box size={[0.012, 0.01, 0.21]} position={[-0.03, 0.012, 0.1]} rotation={[0, 0.25, 0]} color={C.steel} shadow={false} />
      </group>
      <MusicNotes active={playing} y={0.16} size={0.05} />
    </group>
  )
}

/**
 * Floor-standing speaker (about 1 m): a tall cabinet with two woofers and a tweeter. While the bound player plays the
 * woofers pulse, harder with the volume, and notes rise above it.
 */
export function FloorSpeaker({ v }: P) {
  const playing = v.domain === 'media_player' && v.state === 'playing'
  const vol = num(v.attrs.volume_level) ?? 0.5
  const cones = useRef<THREE.Group>(null)
  useAmbient(playing)
  useFrame(({ clock }) => {
    const g = cones.current
    if (!g) return
    const s = playing ? 1 + 0.07 * vol * Math.max(0, Math.sin(clock.elapsedTime * 14)) : 1
    for (const c of g.children) c.scale.set(s, s, 1)
  })
  return (
    <group>
      <Box size={[0.24, 1.0, 0.28]} position={[0, 0.52, 0]} color={bodyOf(v, '#2a2c33')} radius={0.015} />
      {[-0.08, 0.08].map((x) => (
        <Cyl key={x} r={0.02} h={0.02} position={[x, 0.01, 0]} color={C.inkSoft} segments={10} />
      ))}
      <group ref={cones} position={[0, 0, 0.141]}>
        {[0.32, 0.56].map((y) => (
          <mesh key={y} position={[0, y, 0]} geometry={disc(0.075)} material={mat('#141518')} />
        ))}
      </group>
      <mesh position={[0, 0.82, 0.141]} geometry={disc(0.028)} material={mat('#3a3d47')} />
      <MusicNotes active={playing} y={1.08} size={0.07} />
    </group>
  )
}

/** Streaming box (on a surface): a small rounded box with a status light that glows while on and pulses while it plays. */
export function StreamingBox({ v }: P) {
  const playing = v.state === 'playing'
  const led = useLitMaterial('#3a3d47', v.on, '#ffffff', 1, 2.2)
  const ref = usePulse(playing, 4, 0.3)
  return (
    <group>
      <Box size={[0.098, 0.035, 0.098]} position={[0, 0.0175, 0]} color={bodyOf(v, '#16171b')} radius={0.014} />
      <mesh ref={ref} position={[0.03, 0.02, 0.0495]} geometry={disc(0.004, 12)} material={led} />
    </group>
  )
}

/**
 * Smart display (on a surface): a screen tilted back on a speaker base. With a bound entity the screen shows the time
 * while idle and a bright tint while it plays; dark when unbound or unavailable.
 */
export function SmartDisplay({ v }: P) {
  const now = useNow()
  const live = v.bound && !v.unavailable
  const playing = v.domain === 'media_player' && v.state === 'playing'
  const screen = useDisplay(live ? clockText(now) : '', live ? 'screen' : 'off')
  return (
    <group>
      <Box size={[0.2, 0.05, 0.1]} position={[0, 0.025, -0.01]} color={bodyOf(v, '#e9e6e1')} radius={0.02} />
      <group position={[0, 0.1, 0.02]} rotation={[-0.3, 0, 0]}>
        <Box size={[0.19, 0.13, 0.012]} color="#1d1f24" radius={0.008} />
        <mesh position={[0, 0, 0.0065]} geometry={plane(0.17, 0.11)} material={playing ? mat('#8f7cff', { emissive: '#8f7cff', emissiveIntensity: 0.9 }) : screen} />
      </group>
    </group>
  )
}

/**
 * Voice assistant (a speaker puck on a surface): its LED ring follows the assist_satellite state, steady blue while
 * listening, a spinning light while processing, pulsing while responding (model/household.ts > assistRing).
 */
export function VoiceAssistant({ v }: P) {
  const ring = assistRing(v.domain, v.state)
  const lit = ring !== 'off'
  const color = ring === 'listen' ? '#4f9dff' : ring === 'spin' ? '#8f7cff' : '#4fc3ff'
  const led = useLitMaterial('#3a3d47', lit, color, 1, 2.6)
  const spin = useRef<THREE.Group>(null)
  const pulse = usePulse(ring === 'pulse', 8, 0.08)
  useAmbient(ring === 'spin')
  useFrame((_, dt) => {
    if (spin.current && ring === 'spin') spin.current.rotation.y += Math.min(dt, 0.1) * 6
  })
  return (
    <group>
      <Cyl r={0.043} h={0.03} position={[0, 0.015, 0]} color={bodyOf(v, '#1d1f24')} segments={32} />
      <group ref={spin} position={[0, 0.031, 0]}>
        <mesh ref={pulse} name="assist-ring" userData={{ state: ring }} rotation-x={Math.PI / 2} geometry={torus(0.036, 0.004, 32)} material={led} />
        {ring === 'spin' && <Ball r={0.006} position={[0.036, 0.002, 0]} color="#ffffff" shadow={false} />}
      </group>
      {lit && <Glow position={[0, 0.04, 0]} color={color} opacity={v.night ? 0.6 : 0.3} size={0.25} />}
    </group>
  )
}

/* ---------- security ---------- */

/**
 * Safe (on the floor): a steel box with a dial on the door. Bound to a lock, a light on the door is red while locked and
 * green while unlocked; the door swings open while a bound door sensor is open (or the lock reports open).
 */
export function Safe({ v }: P) {
  const lock = relatedOf(v, 'lock')
  const sensed = (v.domain === 'binary_sensor' && v.on) || v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && isActive(e))
  const open = sensed || lock?.state === 'open'
  const unlocked = lock ? lock.state === 'unlocked' || lock.state === 'open' : false
  const door = useRef<THREE.Group>(null)
  useEase(open ? -1.2 : 0, (a) => {
    if (door.current) door.current.rotation.y = a
  })
  const light = lock ? (unlocked ? C.ok : C.alarm) : '#5a5e6b'
  return (
    <group>
      <Box size={[0.44, 0.5, 0.4]} position={[0, 0.25, -0.02]} color={bodyOf(v, '#3a3d47')} radius={0.01} />
      <group ref={door} position={[-0.2, 0, 0.18]}>
        <Box size={[0.4, 0.46, 0.03]} position={[0.2, 0.25, 0.015]} color="#4a4e5a" radius={0.008} />
        <Cyl r={0.045} h={0.02} position={[0.24, 0.27, 0.04]} rotation={[Math.PI / 2, 0, 0]} color={C.steel} segments={20} />
        <Box size={[0.012, 0.08, 0.02]} position={[0.36, 0.25, 0.04]} color={C.steel} shadow={false} />
        <Ball r={0.008} position={[0.33, 0.42, 0.034]} material={glowing(light, Boolean(lock), 1.4)} shadow={false} />
      </group>
    </group>
  )
}

/** Fire extinguisher on its wall bracket (low on the wall, 0.3 to 0.83 m): red cylinder, valve, handle and hose. */
export function FireExtinguisher() {
  return (
    <group>
      <Box size={[0.08, 0.08, 0.02]} position={[0, 0.6, -0.07]} color={C.inkSoft} />
      <Cyl r={0.06} h={0.45} position={[0, 0.52, 0]} color="#d8322c" segments={20} />
      <Cyl r={0.022} h={0.06} position={[0, 0.775, 0]} color="#2a2c33" segments={12} />
      <Box size={[0.1, 0.012, 0.025]} position={[0.03, 0.81, 0]} color="#2a2c33" />
      <Cyl r={0.008} h={0.24} position={[0.075, 0.64, 0.02]} rotation={[0, 0, 0.12]} color="#1d1f24" segments={8} />
      <Box size={[0.06, 0.1, 0.002]} position={[0, 0.5, 0.061]} color={C.white} shadow={false} />
    </group>
  )
}

/**
 * Doorbell chime (on the wall, 1.85 m): a round white unit with a light ring. The ring flashes while a bound siren or
 * switch is on, and for a few seconds after a bound doorbell event fires.
 */
export function Chime({ v }: P) {
  const recent = useRecent(v.domain === 'event' ? v.state : '', 12_000)
  const ringing = (v.domain !== 'event' && v.on) || recent
  const ring = useLitMaterial('#d5d8e2', ringing, '#4fc3ff', 1, 2.6)
  const ref = usePulse(ringing, 9, 0.12)
  const Y = 1.85
  return (
    <group position={[0, Y, -0.008]}>
      <Cyl r={0.065} h={0.03} rotation={[Math.PI / 2, 0, 0]} color={C.white} segments={32} />
      <mesh ref={ref} position={[0, 0, 0.016]} geometry={torus(0.05, 0.004, 32)} material={ring} />
      {[-0.015, 0, 0.015].map((x) => (
        <Ball key={x} r={0.004} position={[x, 0, 0.016]} color={C.steel} shadow={false} />
      ))}
      {ringing && <Glow position={[0, 0, 0.06]} color="#4fc3ff" opacity={v.night ? 0.7 : 0.4} size={0.45} />}
    </group>
  )
}

/* ---------- sensors ---------- */

/**
 * Garage parking sensor (on the wall, 1 m): five LED segments that light from the bound distance sensor, green while the
 * car is far, amber when close, red when it should stop; dark while the bay is empty (a bound occupancy sensor is off).
 * model/household.ts > parkingBar.
 */
export function ParkingSensor({ v }: P) {
  const ents = entitiesOf(v)
  const dist = ents.find((e) => domainOf(e.entity_id) === 'sensor')
  const occ = ents.find((e) => domainOf(e.entity_id) === 'binary_sensor')
  const bar = parkingBar(distanceM(dist), occ ? isActive(occ) : Boolean(dist))
  const Y = 1.0
  return (
    <group position={[0, Y, -0.01]}>
      <Box size={[0.14, 0.1, 0.03]} color="#2a2c33" radius={0.01} />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box key={i} size={[0.018, 0.05, 0.004]} position={[-0.048 + i * 0.024, 0, 0.016]} material={glowing(bar.color, i < bar.lit, 1.8)} shadow={false} />
      ))}
      {bar.lit > 0 && <Glow position={[0, 0, 0.05]} color={bar.color} opacity={v.night ? 0.6 : 0.3} size={0.3} />}
    </group>
  )
}

/* ---------- smart devices ---------- */

/**
 * Smart home hub (on a surface): a flat rounded box with a status light, green while connected, amber when a bound update
 * entity offers an update, red when unavailable or a bound connectivity sensor is off.
 */
export function SmartHub({ v }: P) {
  const ents = entitiesOf(v)
  const update = ents.some((e) => domainOf(e.entity_id) === 'update' && e.state === 'on')
  const down = v.unavailable || ents.some((e) => domainOf(e.entity_id) === 'binary_sensor' && deviceClass(e) === 'connectivity' && e.state === 'off')
  const color = !v.bound ? '#5a5e6b' : down ? C.alarm : update ? C.warn : C.ok
  return (
    <group>
      <Box size={[0.112, 0.03, 0.112]} position={[0, 0.015, 0]} color={v.unavailable ? '#9aa0b8' : (v.opts.body ?? '#e9ebf0')} radius={0.02} />
      <mesh position={[0, 0.0305, 0.035]} rotation-x={-Math.PI / 2} geometry={disc(0.007, 16)} material={glowing(color, v.bound, 1.8)} />
      {v.bound && v.night && <Glow position={[0, 0.04, 0.035]} color={color} opacity={0.35} size={0.15} />}
    </group>
  )
}

const RACK_UNITS = [0.25, 0.45, 0.7, 0.95]

/** Server or network rack (on the floor by a wall, 1.2 m): a dark cabinet with a glass door and four devices whose port and disk lights blink while on. */
export function ServerRack({ v }: P) {
  const on = v.bound && v.on
  const leds = useRef<THREE.Group>(null)
  useAmbient(on, true)
  useFrame(({ clock }) => {
    const g = leds.current
    if (!g || !on) return
    const t = clock.elapsedTime
    for (let i = 0; i < g.children.length; i++) g.children[i].visible = Math.sin(t * (3 + (i % 5)) + i * 1.7) > -0.3
  })
  return (
    <group>
      {/* cabinet behind the equipment, a frame in front of it and a glass door */}
      <Box size={[0.58, 1.2, 0.5]} position={[0, 0.6, -0.04]} color="#24262c" radius={0.01} />
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.05, 1.2, 0.08]} position={[sx * 0.265, 0.6, 0.25]} color="#24262c" />
      ))}
      <Box size={[0.58, 0.06, 0.08]} position={[0, 1.17, 0.25]} color="#24262c" />
      <Box size={[0.58, 0.06, 0.08]} position={[0, 0.03, 0.25]} color="#24262c" />
      {RACK_UNITS.map((y) => (
        <Box key={y} size={[0.46, 0.12, 0.03]} position={[0, y, 0.225]} color="#3a3d47" shadow={false} />
      ))}
      <Box size={[0.48, 1.08, 0.008]} position={[0, 0.6, 0.286]} material={clear('#9aa8c8', 0.2, 0.15)} shadow={false} />
      <group ref={leds} visible={on}>
        {RACK_UNITS.flatMap((y, r) => [0, 1, 2, 3, 4, 5].map((i) => <mesh key={`${r}${i}`} position={[-0.18 + i * 0.03, y + 0.02, 0.2415]} geometry={disc(0.005, 8)} material={glowing(i % 3 ? C.ok : '#4fc3ff', true, 2)} />))}
      </group>
    </group>
  )
}

/**
 * Solar inverter (on the wall, 1.15 to 1.75 m): a white box with a display that shows the bound power sensor and a light
 * that is green while it produces.
 */
export function SolarInverter({ v }: P) {
  const live = v.bound && !v.unavailable
  const n = v.domain === 'sensor' ? num(v.state) : null
  const unit = typeof v.attrs.unit_of_measurement === 'string' ? v.attrs.unit_of_measurement : ''
  const screen = useDisplay(live && n != null ? `${formatNumber(Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10, 1)} ${unit}`.trim() : '---', live ? 'lcd' : 'off')
  const producing = live && (n ?? 0) > 0
  const Y = 1.45
  return (
    <group>
      <Box size={[0.42, 0.56, 0.16]} position={[0, Y, -0.01]} color={v.unavailable ? '#9aa0b8' : (v.opts.body ?? '#eef0f4')} radius={0.02} />
      <Box size={[0.16, 0.07, 0.006]} position={[0, Y + 0.12, 0.072]} color="#2a2d38" radius={0.006} shadow={false} />
      <mesh position={[0, Y + 0.12, 0.0755]} geometry={plane(0.14, 0.052)} material={screen} />
      <Ball r={0.007} position={[0.14, Y + 0.12, 0.072]} material={glowing(C.ok, producing, 2)} shadow={false} />
      {[-0.12, 0.12].map((x) => (
        <Box key={x} size={[0.05, 0.08, 0.04]} position={[x, Y - 0.31, 0.02]} color="#2a2c33" />
      ))}
    </group>
  )
}

/**
 * Phone on a wireless charger (on a surface): drawn see-through while its device tracker is away, the charger ring lit
 * while it charges and the battery level on the screen (model/household.ts > phoneState).
 */
export function Phone({ v }: P) {
  const ph = phoneState(entitiesOf(v))
  const live = v.bound && !v.unavailable && !ph.away
  const screen = useDisplay(live && ph.battery != null ? `${ph.battery}%` : '', live && ph.battery != null ? 'screen' : 'off')
  const body = ph.away ? mat('#1d1f24', { opacity: 0.25 }) : mat('#1d1f24')
  return (
    <group>
      <Cyl r={0.05} h={0.008} position={[0, 0.004, 0]} color="#e9ebf0" segments={28} />
      <mesh position={[0, 0.0085, 0]} rotation-x={Math.PI / 2} geometry={torus(0.044, 0.002, 28)} material={glowing(C.ok, ph.charging && !ph.away, 2)} />
      <Box name="phone-body" size={[0.072, 0.008, 0.15]} position={[0, 0.013, 0]} material={body} radius={0.004} />
      {!ph.away && <mesh position={[0, 0.0175, 0]} rotation-x={-Math.PI / 2} geometry={plane(0.064, 0.138)} material={screen} />}
    </group>
  )
}

/**
 * UPS (on the floor or a shelf): a black tower whose light is green on mains power and blinks amber while it runs on its
 * battery (a bound power sensor off, or a status sensor saying battery).
 */
export function Ups({ v }: P) {
  const ents = entitiesOf(v)
  const onBattery = ents.some((e) => (domainOf(e.entity_id) === 'binary_sensor' && ['power', 'plug'].includes(deviceClass(e)) && e.state === 'off') || (domainOf(e.entity_id) === 'sensor' && /\b(on battery|ob)\b/i.test(e.state)))
  const live = v.bound && !v.unavailable
  const blink = useBlink(live && onBattery, 1.5)
  return (
    <group>
      <Box size={[0.15, 0.24, 0.36]} position={[0, 0.12, 0]} color="#1d1f24" radius={0.012} />
      <Box size={[0.09, 0.03, 0.004]} position={[0, 0.2, 0.181]} color="#2a2d38" shadow={false} />
      <mesh ref={blink} position={[0, 0.2, 0.1835]} geometry={disc(0.008, 12)} material={glowing(onBattery ? C.warn : C.ok, live, 2)} />
    </group>
  )
}

/* ---------- kitchen ---------- */

/**
 * Toaster (on a counter): two slots with toast. While on the slots glow orange and the toast is down; when it turns off
 * the toast pops up.
 */
export function Toaster({ v }: P) {
  const body = bodyOf(v, '#e9ebf0')
  const slot = useLitMaterial('#2a2c33', v.on, '#ff7a3d', 1, 2)
  const toast = useRef<THREE.Group>(null)
  useEase(v.on ? 0 : 0.05, (y) => {
    if (toast.current) toast.current.position.y = y
  })
  return (
    <group>
      <Box size={[0.27, 0.18, 0.16]} position={[0, 0.09, 0]} color={body} radius={0.03} />
      {[-0.035, 0.035].map((z) => (
        <Box key={z} size={[0.17, 0.006, 0.026]} position={[0, 0.181, z]} material={slot} shadow={false} />
      ))}
      <group ref={toast}>
        {[-0.035, 0.035].map((z) => (
          <Box key={z} size={[0.12, 0.1, 0.016]} position={[0, 0.14, z]} color="#d9a06a" radius={0.008} />
        ))}
      </group>
      <Box size={[0.02, 0.035, 0.03]} position={[0.145, v.on ? 0.05 : 0.13, 0]} color="#2a2c33" radius={0.006} />
      {v.on && <Glow position={[0, 0.2, 0]} color="#ff7a3d" opacity={v.night ? 0.5 : 0.25} size={0.3} />}
    </group>
  )
}

/** Multicooker or rice cooker (on a counter): a round pot with a lid and a display; while on the display glows and steam rises. */
export function Multicooker({ v }: P) {
  const body = bodyOf(v, '#f2f2f4')
  const disp = useLitMaterial(C.screenOff, v.on, '#ffb35a', 0.9, 1.6)
  // Rice cooker type (Item.variant 'rice'): a rounder body under a domed lid with a carry handle, steam from the vent
  if (v.opts.variant === 'rice')
    return (
      <group>
        <Cyl r={0.13} rTop={0.14} h={0.17} position={[0, 0.085, 0]} color={body} segments={32} />
        <group position={[0, 0.17, 0]} scale={[1, 0.42, 1]}>
          <Ball r={0.14} position={[0, 0, 0]} color={body} />
        </group>
        <Box size={[0.16, 0.014, 0.02]} position={[0, 0.235, 0]} color="#c9ccd4" />
        <Cyl r={0.012} h={0.012} position={[0.05, 0.226, -0.03]} color="#2a2c33" segments={10} />
        <Box size={[0.07, 0.03, 0.01]} position={[0, 0.1, 0.138]} material={disp} shadow={false} />
        <group position={[0.05, 0.23, -0.03]}>
          <Mist active={v.on} y={0.04} size={0.26} />
        </group>
      </group>
    )
  return (
    <group>
      <Cyl r={0.14} rTop={0.13} h={0.2} position={[0, 0.1, 0]} color={body} segments={32} />
      <Cyl r={0.135} h={0.04} position={[0, 0.22, 0]} color="#c9ccd4" segments={32} />
      <Cyl r={0.02} h={0.02} position={[0.05, 0.25, -0.04]} color="#2a2c33" segments={12} />
      <Box size={[0.09, 0.04, 0.01]} position={[0, 0.12, 0.13]} material={disp} shadow={false} />
      <group position={[0.05, 0.2, -0.04]}>
        <Mist active={v.on} y={0.06} size={0.3} />
      </group>
    </group>
  )
}

/** Fruit pieces in the blender jar: position on the drink's surface, size, color */
const BLENDER_FRUIT: [number, number, number, string][] = [
  [0.034, 0.004, 0.02, '#e2304a'],
  [-0.03, 0.022, 0.018, '#f3d36b'],
  [0.006, -0.036, 0.016, '#7cc35a'],
  [-0.012, -0.004, 0.014, '#e2304a'],
]

/**
 * Blender (on a counter): motor base with a dial and a light strip, a glass jar with a lid and a handle, a pink smoothie
 * with fruit pieces on top. While on (its plug, or a fan entity: faster at a higher percentage) the strip lights up and
 * the drink spins with its fruit pieces (the part named "blender-contents").
 */
export function Blender({ v }: P) {
  const body = bodyOf(v, '#2a2c33')
  const strip = useLitMaterial('#4a4e5a', v.on, '#7ad7ff', 1, 2)
  const pct = v.domain === 'fan' ? num(v.attrs.percentage) : null
  const speed = v.on && !v.unavailable ? 14 + ((pct ?? 60) / 100) * 16 : 0
  const glass = clear('#9fbdd6', 0.42, 0.04)
  return (
    <group>
      {/* motor base: dial and light strip at the front */}
      <Box size={[0.16, 0.1, 0.15]} position={[0, 0.05, 0]} color={body} radius={0.02} />
      <Cyl r={0.022} h={0.014} position={[0, 0.048, 0.077]} rotation={[Math.PI / 2, 0, 0]} color="#c9ccd4" segments={18} />
      <Box size={[0.1, 0.008, 0.004]} position={[0, 0.085, 0.0755]} material={strip} shadow={false} />
      {/* jar: collar, glass, lid with a cap, handle on the side */}
      <Cyl r={0.062} h={0.02} position={[0, 0.11, 0]} color={body} segments={24} />
      <Cyl r={0.062} rTop={0.072} h={0.22} position={[0, 0.23, 0]} material={glass} segments={24} shadow={false} />
      <Cyl r={0.075} h={0.018} position={[0, 0.349, 0]} color={body} segments={24} />
      <Cyl r={0.022} h={0.02} position={[0, 0.367, 0]} color="#c9ccd4" segments={14} />
      <Box size={[0.014, 0.15, 0.03]} position={[0.092, 0.24, 0]} color={body} radius={0.005} />
      {[0.17, 0.31].map((y) => (
        <Box key={y} size={[0.026, 0.014, 0.022]} position={[0.08, y, 0]} color={body} shadow={false} />
      ))}
      {/* the drink, its surface and the fruit pieces spin together while on */}
      <Cyl r={0.06} rTop={0.065} h={0.12} position={[0, 0.18, 0]} color="#e46a8c" segments={24} shadow={false} />
      <group position={[0, 0.24, 0]}>
        <Spin speed={speed} axis="y" name="blender-contents">
          <Box size={[0.1, 0.003, 0.012]} position={[0, 0.002, 0]} color="#f3a3b8" shadow={false} />
          {BLENDER_FRUIT.map(([x, z, s, c]) => (
            <Box key={`${x}${z}`} size={[s, s, s]} position={[x, s / 3, z]} rotation={[0.4, x * 20, 0.3]} color={c} shadow={false} />
          ))}
        </Spin>
      </group>
      {v.on && <Glow position={[0, 0.09, 0.09]} color="#7ad7ff" opacity={v.night ? 0.45 : 0.2} size={0.18} />}
    </group>
  )
}

/**
 * Chest freezer (on the floor): a white chest whose lid opens while a bound lid sensor is open; a frost blue light shines
 * inside then. A bound temperature sensor shows on its small display.
 */
export function Freezer({ v }: P) {
  const ents = entitiesOf(v)
  const open = ents.some((e) => domainOf(e.entity_id) === 'binary_sensor' && ['door', 'opening', ''].includes(deviceClass(e)) && isActive(e))
  const temp = ents.find((e) => domainOf(e.entity_id) === 'sensor' && deviceClass(e) === 'temperature')
  const n = temp ? num(temp.state) : null
  const screen = useDisplay(n != null ? `${formatNumber(Math.round(n), 0)}°` : '', n != null && !v.unavailable ? 'lcd' : 'off')
  const lid = useRef<THREE.Group>(null)
  useEase(open ? -1.1 : 0, (a) => {
    if (lid.current) lid.current.rotation.x = a
  })
  return (
    <group>
      <Box size={[1.0, 0.8, 0.65]} position={[0, 0.4, 0]} color={bodyOf(v, '#f4f5f8')} radius={0.03} />
      <Box size={[0.92, 0.02, 0.57]} position={[0, 0.79, 0]} material={open ? glowing('#bfe3ff', true, 1.2) : mat('#dfe2ea')} shadow={false} />
      <group ref={lid} position={[0, 0.8, -0.325]}>
        <Box size={[1.0, 0.06, 0.65]} position={[0, 0.03, 0.325]} color={bodyOf(v, '#f4f5f8')} radius={0.025} />
        <Box size={[0.3, 0.025, 0.03]} position={[0, 0.03, 0.65]} color={C.steel} />
      </group>
      <Box size={[0.12, 0.05, 0.006]} position={[0.32, 0.68, 0.326]} color="#2a2d38" shadow={false} />
      <mesh position={[0.32, 0.68, 0.3295]} geometry={plane(0.1, 0.038)} material={screen} />
      {open && <Glow position={[0, 0.95, 0]} color="#bfe3ff" opacity={v.night ? 0.6 : 0.3} size={0.9} />}
    </group>
  )
}

/** Wine fridge (on the floor by a wall): a dark cabinet with a glass door and racks of bottles that light up while on. */
export function WineFridge({ v }: P) {
  const lit = v.on
  const body = bodyOf(v, '#1d1f24')
  const inside = useLitMaterial('#2a2c33', lit, v.domain === 'light' ? v.color : '#9fd0ff', 1, 1.2)
  return (
    <group>
      {/* cabinet open at the front behind the glass door: lit back wall, wire shelves with bottles lying on them */}
      <Box size={[0.5, 0.86, 0.3]} position={[0, 0.43, -0.13]} color={body} radius={0.012} />
      <Box size={[0.42, 0.74, 0.01]} position={[0, 0.45, 0.025]} material={inside} shadow={false} />
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.04, 0.86, 0.26]} position={[sx * 0.23, 0.43, 0.15]} color={body} />
      ))}
      <Box size={[0.5, 0.06, 0.26]} position={[0, 0.83, 0.15]} color={body} />
      <Box size={[0.5, 0.08, 0.26]} position={[0, 0.04, 0.15]} color={body} />
      {[0.2, 0.38, 0.56, 0.74].flatMap((y) => [
        <Box key={`s${y}`} size={[0.42, 0.006, 0.24]} position={[0, y - 0.026, 0.15]} color={C.steel} shadow={false} />,
        ...[-0.14, -0.05, 0.04, 0.13].map((x, i) => <Cyl key={`${y}${x}`} r={0.022} h={0.22} position={[x, y, 0.15]} rotation={[Math.PI / 2, 0, 0]} color={i % 2 ? '#5a1e2a' : '#2f4a2a'} segments={10} />),
      ])}
      <Box size={[0.44, 0.76, 0.006]} position={[0, 0.45, 0.284]} material={clear('#c9d6e8', 0.22, 0.1)} shadow={false} />
      <Box size={[0.02, 0.3, 0.03]} position={[0.2, 0.5, 0.3]} color={C.steel} />
      {lit && <Glow position={[0, 0.45, 0.35]} color={v.domain === 'light' ? v.color : '#9fd0ff'} opacity={v.night ? 0.45 : 0.2} size={0.7} />}
    </group>
  )
}

/**
 * Ironing board with an iron: a board with a rounded nose on crossed legs, the iron resting at the wide end. With a smart
 * plug bound, the soleplate glows and the iron puffs steam while the plug is on.
 */
export function IroningBoard({ v }: P) {
  const on = v.on
  const H = 0.86
  const metal = mat('#c9ccd4', { metalness: 0.45, roughness: 0.4 })
  const cover = mat(bodyOf(v, '#8fd8bd'), { roughness: 0.95 })
  const lean = Math.atan2(0.65, H - 0.02)
  return (
    <group>
      {[-1, 1].map((s) =>
        [-0.12, 0.12].map((z) => <Box key={`${s}${z}`} size={[0.022, Math.hypot(0.65, H - 0.02), 0.022]} position={[-s * 0.075, (H - 0.02) / 2, z]} rotation={[0, 0, -s * lean]} material={metal} />),
      )}
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.03, 0.03, 0.3]} position={[s * 0.4, 0.015, 0]} color="#2a2c33" />
      ))}
      <Box size={[1.0, 0.025, 0.38]} position={[-0.15, H, 0]} material={cover} radius={0.008} />
      <Cyl r={0.19} h={0.025} position={[0.35, H, 0]} scale={[1.45, 1, 1]} material={cover} segments={28} />
      <Box size={[0.16, 0.01, 0.26]} position={[-0.58, H + 0.015, 0]} material={metal} />
      <group position={[-0.56, H + 0.02, 0]} rotation-y={Math.PI / 2}>
        <Box size={[0.12, 0.02, 0.24]} position={[0, 0.01, 0]} material={glowing('#ff8a3d', on, 0.8)} radius={0.008} />
        <Box size={[0.1, 0.07, 0.2]} position={[0, 0.055, -0.01]} color="#4f9dff" radius={0.03} />
        <Box size={[0.03, 0.03, 0.15]} position={[0, 0.12, -0.02]} color={C.white} radius={0.012} />
        <Box size={[0.025, 0.05, 0.025]} position={[0, 0.1, 0.05]} color={C.white} />
        <Mist active={on} y={0.06} size={0.25} color="#eef3ff" />
      </group>
    </group>
  )
}

/* ---------- bathroom ---------- */

/** Bathroom scale (on the floor): a glass plate whose display shows the bound weight sensor. */
export function BathScale({ v }: P) {
  const live = v.bound && !v.unavailable
  const n = v.domain === 'sensor' ? num(v.state) : null
  const unit = typeof v.attrs.unit_of_measurement === 'string' ? v.attrs.unit_of_measurement : ''
  const screen = useDisplay(live && n != null ? `${formatNumber(Math.round(n * 10) / 10, 1)} ${unit}`.trim() : '', live && n != null ? 'screen' : 'off')
  return (
    <group>
      <Box size={[0.3, 0.025, 0.3]} position={[0, 0.0125, 0]} color={bodyOf(v, '#f4f5f8')} radius={0.02} />
      <Box size={[0.29, 0.004, 0.29]} position={[0, 0.027, 0]} material={clear('#e9f2ff', 0.5, 0.05)} shadow={false} />
      <mesh position={[0, 0.03, -0.09]} rotation-x={-Math.PI / 2} geometry={plane(0.1, 0.04)} material={screen} />
    </group>
  )
}

/**
 * Electric toothbrush on its charging base (on a surface): the ring on the handle glows while the bound state says it is
 * running, the base light glows while it charges otherwise.
 */
export function Toothbrush({ v }: P) {
  const running = v.domain === 'sensor' ? /run|brush|on/i.test(v.state) : v.on
  const live = v.bound && !v.unavailable
  return (
    <group>
      <Cyl r={0.028} rTop={0.025} h={0.03} position={[0, 0.015, 0]} color="#e9ebf0" segments={20} />
      <mesh position={[0, 0.031, 0.0]} rotation-x={Math.PI / 2} geometry={torus(0.022, 0.0015, 20)} material={glowing(C.ok, live && !running, 1.6)} />
      <Cyl r={0.013} rTop={0.011} h={0.17} position={[0, 0.115, 0]} color={bodyOf(v, '#ffffff')} segments={16} />
      <mesh position={[0, 0.1, 0]} rotation-x={Math.PI / 2} geometry={torus(0.0135, 0.002, 16)} material={glowing('#4f9dff', running, 2)} />
      <Cyl r={0.005} h={0.05} position={[0, 0.22, 0]} color="#d9dce4" segments={8} />
      <Box size={[0.012, 0.016, 0.01]} position={[0, 0.235, 0.006]} color="#4fc3ff" shadow={false} />
    </group>
  )
}

/**
 * Sauna cabin (a free-standing 1.8 m cabin, indoors or in the garden): wooden walls, a glass door, benches and a stove
 * with stones. While it heats the stones glow, the cabin is lit warm inside and heat shimmers above the stove.
 */
export function Sauna({ v }: P) {
  const wood = mat(bodyOf(v, '#c99a63'), { roughness: 0.75 })
  const heating = v.on && (v.domain !== 'climate' || v.state !== 'off')
  const stones = useLitMaterial('#5a5e6b', heating, '#ff7a3d', 1, 1.8)
  const H = 2.0
  return (
    <group>
      <Box size={[1.8, 0.04, 1.8]} position={[0, 0.02, 0]} material={wood} />
      <Box size={[1.8, H, 0.06]} position={[0, H / 2, -0.87]} material={wood} />
      <Box size={[0.06, H, 1.8]} position={[-0.87, H / 2, 0]} material={wood} />
      <Box size={[0.06, H, 1.8]} position={[0.87, H / 2, 0]} material={wood} />
      <Box size={[1.1, H, 0.06]} position={[-0.35, H / 2, 0.87]} material={wood} />
      <Box size={[0.6, H - 0.1, 0.02]} position={[0.55, (H - 0.1) / 2 + 0.02, 0.88]} material={clear('#ffd7a8', 0.35, 0.1)} shadow={false} />
      <Box size={[1.6, 0.06, 0.5]} position={[0, 0.45, -0.55]} material={wood} />
      <Box size={[1.6, 0.06, 0.45]} position={[0, 0.9, -0.62]} material={wood} />
      <Box size={[0.4, 0.45, 0.4]} position={[0.55, 0.26, 0.35]} color="#2b2d33" radius={0.02} />
      {[-0.1, 0, 0.1].flatMap((x) => [-0.08, 0.06].map((z) => <Ball key={`${x}${z}`} r={0.05} position={[0.55 + x, 0.52, 0.35 + z]} material={stones} flat detail={0} />))}
      {heating && <Glow position={[0, 1.4, 0]} color="#ffb35a" opacity={v.night ? 0.6 : 0.3} size={2.2} />}
      <group position={[0.55, 0.5, 0.35]}>
        <Mist active={heating} y={0.1} size={0.4} color="#fff3e4" />
      </group>
    </group>
  )
}

/* ---------- furniture ---------- */

/** Bar stool: a round seat at counter height on a chrome post with a foot ring; tucks under a counter or a table. */
export function BarStool({ v }: P) {
  const chrome = mat('#cfd4dc', { metalness: 0.6, roughness: 0.25 })
  return (
    <group>
      <Cyl r={0.2} h={0.02} position={[0, 0.01, 0]} material={chrome} segments={28} />
      <Cyl r={0.025} h={0.62} position={[0, 0.33, 0]} material={chrome} segments={14} />
      <mesh position={[0, 0.3, 0]} rotation-x={Math.PI / 2} geometry={torus(0.15, 0.01, 24)} material={chrome} />
      <Cyl r={0.19} h={0.06} position={[0, 0.66, 0]} color={v.opts.body ?? '#1f2440'} segments={28} />
    </group>
  )
}

/** Baby crib: a slatted cot with a mattress; a mobile hangs above it and turns while a bound switch or player is on. */
export function Crib({ v }: P) {
  const wood = mat(v.opts.body ?? '#ffffff', { roughness: 0.7 })
  const W = 0.72
  const L = 1.32
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.05, 0.95, 0.05]} position={[(sx * (W - 0.05)) / 2, 0.475, (sz * (L - 0.05)) / 2]} material={wood} />))}
      <Box size={[W - 0.06, 0.12, L - 0.06]} position={[0, 0.3, 0]} color="#e8edf6" radius={0.03} />
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Box size={[0.03, 0.04, L]} position={[(sx * (W - 0.03)) / 2, 0.9, 0]} material={wood} />
          {Array.from({ length: 11 }, (_, i) => (
            <Box key={i} size={[0.018, 0.52, 0.018]} position={[(sx * (W - 0.03)) / 2, 0.62, -L / 2 + 0.1 + i * ((L - 0.2) / 10)]} material={wood} />
          ))}
        </group>
      ))}
      {[-1, 1].map((sz) => (
        <Box key={sz} size={[W, 0.6, 0.03]} position={[0, 0.65, (sz * (L - 0.03)) / 2]} material={wood} />
      ))}
      <Cyl r={0.008} h={0.5} position={[(W - 0.05) / 2, 1.2, -L / 2 + 0.2]} color={C.steel} segments={8} />
      <group position={[(W - 0.05) / 2 - 0.15, 1.42, -L / 2 + 0.2]}>
        <Spin speed={v.on ? 0.8 : 0} axis="y">
          {[0, 1, 2, 3].map((i) => (
            <Ball key={i} r={0.03} position={[Math.sin((i / 4) * TAU) * 0.13, -0.12, Math.cos((i / 4) * TAU) * 0.13]} color={['#f2b8c6', '#8fd8bd', '#f5c04a', '#8f9ef0'][i]} />
          ))}
          <Box size={[0.3, 0.008, 0.008]} position={[0, 0, 0]} color={C.white} shadow={false} />
          <Box size={[0.008, 0.008, 0.3]} position={[0, 0, 0]} color={C.white} shadow={false} />
        </Spin>
      </group>
    </group>
  )
}

/** Pouf, bean bag or ottoman (Item.variant) in the fabric color (Item.body). */
export function Pouf({ v }: P) {
  const fabric = mat(v.opts.body ?? '#8fd8bd', { roughness: 0.95 })
  if (v.opts.variant === 'beanbag')
    return (
      <group>
        <Ball r={0.36} position={[0, 0.25, 0]} scale={[1, 0.62, 1]} material={fabric} detail={3} />
        <Ball r={0.22} position={[0, 0.42, -0.14]} scale={[1.3, 0.8, 0.7]} material={fabric} detail={2} />
      </group>
    )
  if (v.opts.variant === 'ottoman')
    return (
      <group>
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.02} h={0.1} position={[sx * 0.2, 0.05, sz * 0.2]} color="#5a3a28" segments={10} />))}
        <Box size={[0.5, 0.3, 0.5]} position={[0, 0.25, 0]} material={fabric} radius={0.05} />
      </group>
    )
  return <Cyl r={0.24} rTop={0.22} h={0.42} position={[0, 0.21, 0]} material={fabric} segments={28} />
}

const COAT_COLORS = ['#34416c', '#a87a45', '#8a3b3b', '#5a6e5a']

/** Coat rack: a dark pole on a round base with hooks, coats, a scarf and a hat. */
export function CoatRack({ v }: P) {
  const pole = mat(v.opts.body ?? '#3a2a20', { roughness: 0.6 })
  return (
    <group>
      <Cyl r={0.2} h={0.03} position={[0, 0.015, 0]} material={pole} segments={24} />
      <Cyl r={0.02} h={1.75} position={[0, 0.9, 0]} material={pole} segments={12} />
      <Ball r={0.035} position={[0, 1.8, 0]} material={pole} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * TAU + 0.4
        return (
          <group key={i} rotation-y={a}>
            <Box size={[0.012, 0.012, 0.14]} position={[0, 1.66, 0.07]} rotation={[-0.5, 0, 0]} material={pole} />
            {i < 3 && <Box size={[0.3, 0.8, 0.1]} position={[0, 1.22, 0.13]} color={COAT_COLORS[i]} radius={0.04} />}
          </group>
        )
      })}
      <Cyl r={0.15} rTop={0.1} h={0.12} position={[0, 1.88, 0]} color="#2a2c33" segments={24} />
    </group>
  )
}

/** Treadmill: a running deck with a belt and a console. While on, the console glows and stripes run along the belt. */
export function Treadmill({ v }: P) {
  const belt = useRef<THREE.Group>(null)
  const disp = useLitMaterial(C.screenOff, v.on, '#7dffb2', 0.9, 1.6)
  useAmbient(v.on)
  useFrame((_, dt) => {
    const g = belt.current
    if (!g || !v.on) return
    for (const c of g.children) {
      c.position.z += Math.min(dt, 0.1) * 1.4
      if (c.position.z > 0.7) c.position.z -= 1.4
    }
  })
  return (
    <group>
      <Box size={[0.8, 0.14, 1.75]} position={[0, 0.07, 0.02]} color="#2a2c33" radius={0.03} />
      <Box size={[0.52, 0.01, 1.45]} position={[0, 0.145, 0.06]} color="#15161a" shadow={false} />
      <group ref={belt}>
        {Array.from({ length: 7 }, (_, i) => (
          <Box key={i} size={[0.5, 0.004, 0.02]} position={[0, 0.152, -0.7 + i * 0.2]} color="#3a3d47" shadow={false} />
        ))}
      </group>
      {[-0.36, 0.36].map((x) => (
        <Box key={x} size={[0.04, 1.2, 0.05]} position={[x, 0.7, -0.78]} rotation={[0.15, 0, 0]} color="#3a3d47" />
      ))}
      <Box size={[0.76, 0.2, 0.12]} position={[0, 1.28, -0.86]} rotation={[0.4, 0, 0]} color="#2a2c33" radius={0.02} />
      <Box size={[0.3, 0.1, 0.006]} position={[0, 1.3, -0.8]} rotation={[0.4, 0, 0]} material={disp} shadow={false} />
    </group>
  )
}

/** Exercise bike: a frame with a saddle, handlebar, screen and front flywheel that spins while on. */
export function ExerciseBike({ v }: P) {
  const disp = useLitMaterial(C.screenOff, v.on, '#4fc3ff', 0.9, 1.6)
  const frame = mat(bodyOf(v, '#2a2c33'))
  return (
    <group>
      <Box size={[0.5, 0.05, 0.08]} position={[0, 0.025, 0.45]} material={frame} />
      <Box size={[0.5, 0.05, 0.08]} position={[0, 0.025, -0.45]} material={frame} />
      {/* base beam joining the feet and both posts, and the flywheel guard */}
      <Box size={[0.07, 0.06, 0.95]} position={[0, 0.06, 0]} material={frame} />
      <Box size={[0.06, 0.06, 0.4]} position={[0, 0.3, 0.12]} rotation={[0.55, 0, 0]} material={frame} />
      <Box size={[0.08, 0.8, 0.08]} position={[0, 0.45, -0.25]} rotation={[-0.35, 0, 0]} material={frame} />
      <Box size={[0.08, 0.9, 0.08]} position={[0, 0.5, 0.3]} rotation={[0.25, 0, 0]} material={frame} />
      <Box size={[0.24, 0.06, 0.28]} position={[0, 0.93, -0.38]} color="#15161a" radius={0.03} />
      <Box size={[0.44, 0.03, 0.03]} position={[0, 1.02, 0.42]} color={C.steel} />
      <Box size={[0.2, 0.13, 0.03]} position={[0, 1.1, 0.4]} rotation={[-0.5, 0, 0]} material={disp} radius={0.01} />
      <group position={[0, 0.32, 0.36]} rotation-y={Math.PI / 2}>
        <Spin speed={v.on ? 7 : 0} axis="z">
          <Cyl r={0.2} h={0.05} rotation={[Math.PI / 2, 0, 0]} color="#c9ccd4" segments={28} />
          <Box size={[0.36, 0.02, 0.055]} color="#7a7f8f" shadow={false} />
        </Spin>
      </group>
    </group>
  )
}

/**
 * Rowing machine / indoor rower.
 * Local +z is the front; all measurements are in meters.
 */
export function RowingMachine({ v }: P) {
  const frame = bodyOf(v, '#30343b')
  const dark = '#17191e'
  const metal = '#adb5c2'

  return (
    <group>
      {/* Long central aluminum rail */}
      <Box
        size={[0.11, 0.10, 1.75]}
        position={[0, 0.25, 0]}
        color={metal}
        radius={0.015}
      />

      {/* Rear stabilizer */}
      <Box
        size={[0.58, 0.06, 0.10]}
        position={[0, 0.07, 0.94]}
        color={frame}
        radius={0.025}
      />

      {/* Front stabilizer */}
      <Box
        size={[0.60, 0.07, 0.12]}
        position={[0, 0.07, -0.92]}
        color={frame}
        radius={0.025}
      />

      {/* Upright front support */}
      <Box
        size={[0.10, 0.38, 0.10]}
        position={[0, 0.23, -0.80]}
        color={frame}
        radius={0.015}
      />

      {/* Flywheel housing */}
      <group position={[0, 0.43, -0.78]}>
        <Cyl
          r={0.23}
          h={0.15}
          rotation={[0, 0, Math.PI / 2]}
          color={dark}
          segments={32}
        />
        <Cyl
          r={0.17}
          h={0.155}
          rotation={[0, 0, Math.PI / 2]}
          color={metal}
          segments={32}
        />
        <Cyl
          r={0.06}
          h={0.16}
          rotation={[0, 0, Math.PI / 2]}
          color={frame}
        />
      </group>

      {/* Footrests */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box
            size={[0.13, 0.025, 0.35]}
            position={[side * 0.18, 0.16, -0.48]}
            rotation={[-0.25, 0, 0]}
            color={dark}
            radius={0.012}
          />
          <Box
            size={[0.14, 0.035, 0.04]}
            position={[side * 0.18, 0.22, -0.53]}
            color={frame}
          />
        </group>
      ))}

      {/* Sliding seat - initially stationary */}
      <Box
        size={[0.35, 0.07, 0.30]}
        position={[0, 0.34, 0.38]}
        color={dark}
        radius={0.04}
      />

      {/* Handlebar */}
      <Cyl
        r={0.018}
        h={0.46}
        rotation={[0, 0, Math.PI / 2]}
        position={[0, 0.45, -0.40]}
        color={dark}
      />

      {/* Handle cable */}
      <Box
        size={[0.008, 0.008, 0.40]}
        position={[0, 0.45, -0.62]}
        color={metal}
      />

      {/* Monitor arm */}
      <Box
        size={[0.035, 0.45, 0.035]}
        position={[0, 0.82, -0.77]}
        rotation={[0.25, 0, 0]}
        color={frame}
      />

      {/* Performance monitor */}
      <Box
        size={[0.22, 0.16, 0.06]}
        position={[0, 1.06, -0.71]}
        rotation={[-0.2, 0, 0]}
        color={dark}
        radius={0.012}
      />

      {/* Monitor screen */}
      <Box
        size={[0.18, 0.12, 0.008]}
        position={[0, 1.06, -0.675]}
        color={v.on ? '#69d5ac' : '#45515e'}
      />
    </group>
  )
}

/** Yoga mat: flat on the floor (walked on like a rug) or rolled up (Item.variant 'rolled'), in its color (Item.body). */
export function YogaMat({ v }: P) {
  const color = v.opts.body ?? '#8f6cf0'
  if (v.opts.variant === 'rolled') return <Cyl r={0.07} h={0.61} position={[0, 0.07, 0]} rotation={[0, 0, Math.PI / 2]} color={color} segments={20} />
  return <Box size={[0.61, 0.006, 1.83]} position={[0, 0.003, 0]} color={color} radius={0.002} shadow={false} />
}

/**
 * Piano against the wall: an upright piano (Item.variant 'upright', the default) or a slim digital piano ('digital'). A
 * digital piano bound to a player lights its music stand while it is on.
 */
export function Piano({ v }: P) {
  const wood = mat(v.opts.body ?? '#1d1f24', { roughness: 0.35 })
  const keys = mat('#f6f5f0')
  if (v.opts.variant === 'digital')
    return (
      <group>
        {[-0.68, 0.68].map((x) => (
          <Box key={x} size={[0.04, 0.72, 0.3]} position={[x, 0.36, -0.1]} material={wood} />
        ))}
        <Box size={[1.4, 0.12, 0.34]} position={[0, 0.78, -0.08]} material={wood} radius={0.01} />
        <Box size={[1.3, 0.02, 0.15]} position={[0, 0.85, 0.02]} material={keys} shadow={false} />
        <Box size={[0.6, 0.18, 0.02]} position={[0, 0.98, -0.2]} rotation={[-0.2, 0, 0]} material={v.on ? glowing('#fff3dc', true, 0.8) : wood} />
      </group>
    )
  return (
    <group>
      <Box size={[1.5, 1.25, 0.3]} position={[0, 0.625, -0.15]} material={wood} radius={0.01} />
      <Box size={[1.42, 0.1, 0.3]} position={[0, 0.74, 0.12]} material={wood} />
      <Box size={[1.32, 0.02, 0.14]} position={[0, 0.8, 0.12]} material={keys} shadow={false} />
      {Array.from({ length: 18 }, (_, i) => (
        <Box key={i} size={[0.02, 0.012, 0.08]} position={[-0.62 + i * 0.073, 0.815, 0.09]} color="#15161a" shadow={false} />
      ))}
      {[-0.68, 0.68].map((x) => (
        <Box key={x} size={[0.05, 0.7, 0.06]} position={[x, 0.35, 0.22]} material={wood} />
      ))}
    </group>
  )
}

/** Office chair: a five-star base on casters, gas lift, padded seat, a tall back and armrests (seat and back in Item.body). */
export function OfficeChair({ v }: P) {
  const fabric = mat(v.opts.body ?? '#c3c8dc', { roughness: 0.9 })
  const frame = mat('#2a2c33', { roughness: 0.5, metalness: 0.2 })
  const chrome = mat('#c9ccd4', { roughness: 0.3, metalness: 0.5 })
  return (
    <group>
      {Array.from({ length: 5 }, (_, i) => (
        <group key={i} rotation-y={(i / 5) * TAU}>
          <Box size={[0.045, 0.035, 0.27]} position={[0, 0.075, 0.135]} material={frame} />
          <Ball r={0.03} position={[0, 0.03, 0.26]} material={frame} />
        </group>
      ))}
      <Cyl r={0.025} h={0.34} position={[0, 0.26, 0]} material={chrome} segments={12} />
      <Box size={[0.2, 0.04, 0.2]} position={[0, 0.42, 0]} material={frame} />
      <Box size={[0.5, 0.07, 0.48]} position={[0, 0.465, 0.02]} material={fabric} radius={0.03} />
      <Box size={[0.06, 0.26, 0.035]} position={[0, 0.58, -0.235]} material={frame} />
      <Box size={[0.46, 0.5, 0.06]} position={[0, 0.88, -0.25]} rotation={[-0.1, 0, 0]} material={fabric} radius={0.04} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.265, 0, 0]}>
          <Box size={[0.025, 0.2, 0.025]} position={[0, 0.58, -0.02]} material={frame} />
          <Box size={[0.06, 0.03, 0.24]} position={[0, 0.69, 0]} material={frame} radius={0.012} />
        </group>
      ))}
    </group>
  )
}

/* ---------- decor ---------- */

/** Wall clock (on the wall, 1.8 m): a round face whose hands show the local time (model/household.ts > clockHands). */
export function WallClock({ v }: P) {
  const now = useNow()
  const { hour, minute } = clockHands(now)
  const Y = 1.8
  return (
    <group position={[0, Y, -0.012]}>
      <Cyl r={0.16} h={0.03} rotation={[Math.PI / 2, 0, 0]} color={v.opts.body ?? '#2a2c33'} segments={40} />
      <mesh position={[0, 0, 0.0155]} geometry={disc(0.145, 40)} material={mat('#f6f5f0')} />
      {Array.from({ length: 12 }, (_, i) => (
        <Box key={i} size={[0.008, i % 3 ? 0.012 : 0.022, 0.002]} position={[Math.sin((i / 12) * TAU) * 0.125, Math.cos((i / 12) * TAU) * 0.125, 0.017]} rotation={[0, 0, -(i / 12) * TAU]} color="#2a2c33" shadow={false} />
      ))}
      <group name="hour-hand" position={[0, 0, 0.019]} rotation-z={-hour}>
        <Box size={[0.012, 0.075, 0.003]} position={[0, 0.032, 0]} color="#1d1f24" shadow={false} />
      </group>
      <group name="minute-hand" position={[0, 0, 0.021]} rotation-z={-minute}>
        <Box size={[0.008, 0.11, 0.003]} position={[0, 0.048, 0]} color="#1d1f24" shadow={false} />
      </group>
      <Cyl r={0.008} h={0.006} position={[0, 0, 0.023]} rotation={[Math.PI / 2, 0, 0]} color={C.alarm} segments={12} shadow={false} />
    </group>
  )
}

/** Alarm clock or wake-up light (on a surface): digits show the time; with a light bound, its dome glows in the light's color. */
export function AlarmClock({ v }: P) {
  const now = useNow()
  const screen = useDisplay(clockText(now), 'lcd')
  const lit = v.domain === 'light' && v.on
  return (
    <group>
      <Box size={[0.15, 0.08, 0.08]} position={[0, 0.04, 0]} color={bodyOf(v, '#f2f2ee')} radius={0.02} />
      <mesh position={[0, 0.045, 0.0405]} geometry={plane(0.1, 0.035)} material={screen} />
      <Ball r={0.045} position={[0, 0.09, -0.005]} scale={[1, 0.6, 0.8]} material={lit ? glowing(v.color, true, 0.6 + v.level) : mat('#f7f4ea')} />
      {lit && <Glow position={[0, 0.12, 0]} color={v.color} opacity={v.night ? 0.7 : 0.3} size={0.5} />}
    </group>
  )
}

/** Vase with flowers (on a surface or the floor): tulips, bare branches or dried grasses (Item.variant), the vase in Item.body. */
export function Vase({ v }: P) {
  const kind = v.opts.variant ?? 'tulips'
  const vase = mat(v.opts.body ?? '#ffffff', { roughness: 0.3 })
  const stems = kind === 'branches' ? '#7a5236' : kind === 'dried' ? '#c9a26a' : '#3e9e72'
  return (
    <group>
      <Cyl r={0.05} rTop={0.035} h={0.2} position={[0, 0.1, 0]} material={vase} segments={24} />
      {[-0.4, -0.15, 0.1, 0.35].map((a, i) => (
        <group key={i} position={[0, 0.2, 0]} rotation={[Math.sin(a * 3) * 0.25, 0, a]}>
          <Cyl r={0.004} h={kind === 'tulips' ? 0.2 : 0.32} position={[0, kind === 'tulips' ? 0.1 : 0.16, 0]} color={stems} segments={6} shadow={false} />
          {kind === 'tulips' && <Ball r={0.022} position={[0, 0.21, 0]} scale={[1, 1.4, 1]} color={['#e2564b', '#f2b8c6', '#f5c04a', '#ff8a7a'][i]} />}
          {kind === 'dried' && <Box size={[0.02, 0.08, 0.004]} position={[0, 0.34, 0]} color="#e3cfa2" shadow={false} />}
        </group>
      ))}
    </group>
  )
}

/** Photo frame standing on a surface: a printed picture, or a digital frame (Item.variant 'digital') that glows while bound. */
export function PhotoFrame({ v }: P) {
  const tex = useMemo(() => artTexture(), [])
  const digital = v.opts.variant === 'digital'
  const photo = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: digital && v.bound && !v.unavailable ? 0.6 : 0 }), [tex, digital, v.bound, v.unavailable])
  useEffect(() => () => photo.dispose(), [photo])
  return (
    <group rotation-x={-0.15}>
      <Box size={[0.2, 0.15, 0.015]} position={[0, 0.08, 0]} color={digital ? '#1d1f24' : (v.opts.body ?? '#c9a26a')} radius={0.004} />
      <mesh position={[0, 0.08, 0.0081]} geometry={plane(digital ? 0.18 : 0.16, digital ? 0.12 : 0.11)} material={photo} />
      <Box size={[0.015, 0.12, 0.012]} position={[0, 0.06, -0.04]} rotation={[0.45, 0, 0]} color={C.inkSoft} />
    </group>
  )
}

/**
 * Three pillar candles on a tray (on a surface). With a light or switch bound (LED candles) the flames flicker and glow
 * while on; unbound they stand unlit.
 */
export function Candles({ v }: P) {
  const flames = useRef<THREE.Group>(null)
  const on = v.on
  useAmbient(on)
  useFrame(({ clock }) => {
    const g = flames.current
    if (!g || !on) return
    const t = clock.elapsedTime
    g.children.forEach((c, i) => c.scale.set(1, 0.85 + 0.2 * Math.sin(t * (9 + i * 2.3) + i), 1))
  })
  const wax = mat(v.opts.body ?? '#f6f1e6', { roughness: 0.8 })
  const candles: [number, number][] = [
    [-0.06, 0.12],
    [0.0, 0.08],
    [0.06, 0.15],
  ]
  return (
    <group>
      <Cyl r={0.11} h={0.012} position={[0, 0.006, 0]} color={C.steel} segments={28} />
      {candles.map(([x, h], i) => (
        <Cyl key={i} r={0.028} h={h} position={[x, 0.012 + h / 2, (i - 1) * 0.02]} material={wax} segments={18} />
      ))}
      <group ref={flames} visible={on}>
        {candles.map(([x, h], i) => (
          <mesh key={i} position={[x, 0.032 + h, (i - 1) * 0.02]} geometry={cone(0.008, 0.03, 8)} raycast={noHit}>
            <meshBasicMaterial color="#ffd76a" transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {on && <Glow position={[0, 0.18, 0]} color="#ffb35a" opacity={v.night ? 0.8 : 0.35} size={0.6} />}
    </group>
  )
}

/** Bulbs spiralling up the tree (model space, a 2 m tree); taller trees get more of them so they do not look sparse. */
function treeBulbs(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const y = 0.35 + (i / n) * 1.3
    const r = 0.48 * (1 - (y - 0.3) / 1.55)
    const a = i * 2.4
    return { x: Math.sin(a) * r, y, z: Math.cos(a) * r, color: ['#ff4f5e', '#f5c04a', '#4fc3ff', '#8fd8bd'][i % 4] }
  })
}

/**
 * Christmas tree: stacked green cones, baubles and a star; while on (a bound plug or light) the lights twinkle and the star
 * glows. Drawn as a 2 m tree and scaled to its height (Item.len, catalog TREE_DEF_H). Stand Item.variant: 'pot' (default)
 * or 'ground' (planted outdoors: a bare trunk in a mound of earth).
 */
export function ChristmasTree({ v }: P) {
  const bulbs = useRef<THREE.Group>(null)
  const k = treeScale(v.opts.len)
  const planted = v.opts.variant === 'ground'
  const list = useMemo(() => treeBulbs(k > 1.4 ? 40 : 22), [k])
  useAmbient(v.on, true)
  useFrame(({ clock }) => {
    const g = bulbs.current
    if (!g || !v.on) return
    const t = clock.elapsedTime
    for (let i = 0; i < g.children.length; i++) g.children[i].visible = Math.sin(t * 2.2 + i * 1.3) > -0.5
  })
  return (
    <group scale={k}>
      {planted ? (
        <>
          <Cyl r={0.34} rTop={0.3} h={0.03} position={[0, 0.015, 0]} color="#4a3a2c" segments={20} />
          <Cyl r={0.05} h={0.36} position={[0, 0.2, 0]} color="#6b4a34" segments={10} />
        </>
      ) : (
        <>
          <Cyl r={0.2} rTop={0.24} h={0.25} position={[0, 0.125, 0]} color="#8a3b3b" segments={20} />
          <Cyl r={0.04} h={0.2} position={[0, 0.3, 0]} color="#6b4a34" segments={10} />
        </>
      )}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.65 + i * 0.4, 0]} castShadow>
          <coneGeometry args={[0.5 - i * 0.13, 0.7, 18]} />
          <meshStandardMaterial color="#2f6b46" roughness={0.9} />
        </mesh>
      ))}
      <group ref={bulbs}>
        {list.map((b, i) => (
          <Ball key={i} r={0.025} position={[b.x, b.y, b.z]} material={glowing(b.color, v.on, 2)} detail={1} shadow={false} />
        ))}
      </group>
      <Ball r={0.06} position={[0, 1.95, 0]} material={glowing('#f5c04a', v.on, 2.2)} detail={0} flat />
      {v.on && <Glow position={[0, 1.0, 0]} color="#ffd76a" opacity={v.night ? 0.5 : 0.2} size={1.6} />}
    </group>
  )
}

/** Wall shelf (on the wall, top at 1.52 m): a floating board on two brackets; small items stand on it (rules.ts > surfaceAt). */
export function WallShelf({ v }: P) {
  const wood = mat(v.opts.body ?? '#c9a26a', { roughness: 0.6 })
  return (
    <group>
      <Box size={[0.8, 0.03, 0.22]} position={[0, 1.505, 0]} material={wood} />
      {[-0.3, 0.3].map((x) => (
        <Box key={x} size={[0.02, 0.12, 0.16]} position={[x, 1.43, -0.02]} color="#2a2c33" />
      ))}
    </group>
  )
}

/** Hanging plant: a pot in a macrame hanger on cords from the ceiling, trailing leaves. */
export function HangingPlant() {
  const leaf = mat(C.leaf, { roughness: 0.8 })
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <Cyl key={i} r={0.003} h={0.62} position={[Math.sin((i / 3) * TAU) * 0.06, WALL_H - 0.31, Math.cos((i / 3) * TAU) * 0.06]} rotation={[Math.cos((i / 3) * TAU) * 0.1, 0, -Math.sin((i / 3) * TAU) * 0.1]} color="#e9dcc4" segments={4} shadow={false} />
      ))}
      <Cyl r={0.12} rTop={0.14} h={0.14} position={[0, WALL_H - 0.7, 0]} color="#e98b6d" segments={20} />
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * TAU
        return <Ball key={i} r={0.07} position={[Math.sin(a) * 0.12, WALL_H - 0.72 - (i % 3) * 0.12, Math.cos(a) * 0.12]} scale={[1, 1.6, 0.6]} material={leaf} detail={1} />
      })}
    </group>
  )
}

/**
 * Memo board (on the wall, 1.1 to 1.7 m): a whiteboard with one written line per open item of a bound to-do list (at most
 * six), and a red pin while a bound calendar has an event on.
 */
export function Whiteboard({ v }: P) {
  const ents = entitiesOf(v)
  const todo = ents.find((e) => domainOf(e.entity_id) === 'todo')
  const lines = Math.min(6, Math.max(0, Math.round(num(todo?.state) ?? 0)))
  const event = ents.some((e) => domainOf(e.entity_id) === 'calendar' && e.state === 'on')
  const Y = 1.4
  return (
    <group position={[0, Y, -0.008]}>
      <Box size={[0.9, 0.6, 0.02]} color={C.steel} radius={0.01} />
      <Box size={[0.86, 0.56, 0.004]} position={[0, 0, 0.011]} color="#fbfbfd" shadow={false} />
      {Array.from({ length: lines }, (_, i) => (
        <Box key={i} size={[0.3 + ((i * 37) % 30) / 100, 0.012, 0.002]} position={[-0.38 + (0.15 + ((i * 37) % 30) / 200), 0.2 - i * 0.07, 0.014]} color="#3f56e0" shadow={false} />
      ))}
      {event && <Ball r={0.018} position={[0.33, 0.2, 0.022]} color={C.alarm} />}
      <Box size={[0.4, 0.02, 0.04]} position={[0, -0.3, 0.02]} color={C.steel} />
    </group>
  )
}

/** Standing (cheval) mirror: a full-length mirror tilted back slightly between two posts on feet; the frame in Item.body. */
export function ChevalMirror({ v }: P) {
  const frame = mat(v.opts.body ?? '#8a5a3b', { roughness: 0.6 })
  const glass = mat('#dfe8f5', { metalness: 0.75, roughness: 0.08, emissive: '#cfdcf0', emissiveIntensity: 0.15 })
  const W = 0.5
  const H = 1.3
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (W / 2 + 0.04), 0, 0]}>
          <Box size={[0.05, 0.03, 0.46]} position={[0, 0.015, 0]} material={frame} radius={0.01} />
          <Box size={[0.04, 1.6, 0.04]} position={[0, 0.8, 0]} material={frame} />
          <Ball r={0.026} position={[0, 1.62, 0]} material={frame} />
          <Cyl r={0.018} h={0.03} position={[-s * 0.03, 1.03, 0]} rotation={[0, 0, Math.PI / 2]} color={C.steel} segments={10} />
        </group>
      ))}
      <group position={[0, 1.03, 0]} rotation-x={-0.08}>
        <Box size={[W + 0.04, H + 0.04, 0.03]} material={frame} radius={0.012} />
        <mesh geometry={plane(W - 0.02, H - 0.02)} material={glass} position={[0, 0, 0.0155]} />
      </group>
    </group>
  )
}

/* ---------- pets ---------- */

/** Pet water fountain (on the floor): a bowl with a dome spout; water ripples while the pump is on. */
export function PetFountain({ v }: P) {
  return (
    <group>
      <Cyl r={0.12} rTop={0.11} h={0.08} position={[0, 0.04, 0]} color={bodyOf(v, '#e9ebf0')} segments={28} />
      <mesh position={[0, 0.081, 0]} rotation-x={-Math.PI / 2} geometry={disc(0.1, 28)} material={clear('#7fc0ff', 0.55, 0.05)} />
      <Ball r={0.04} position={[0, 0.1, 0]} scale={[1, 0.7, 1]} color={bodyOf(v, '#e9ebf0')} />
      {/* small rings on the water while the pump runs (Ripple is room sized: scaled down) */}
      <group position={[0, 0.085, 0]} scale={0.07}>
        <Ripple active={v.on} color="#bfe3ff" at={[0, 0, 0]} />
      </group>
    </group>
  )
}

/**
 * Pet door (low on a wall or door): a frame with a flap that swings while a bound sensor sees a pet pass; bound to a lock,
 * a light shows red while locked and green while open.
 */
export function PetDoor({ v }: P) {
  const lock = relatedOf(v, 'lock')
  const passing = (v.domain === 'binary_sensor' && v.on) || v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && isActive(e))
  const flap = useRef<THREE.Group>(null)
  useEase(passing ? 0.9 : 0, (a) => {
    if (flap.current) flap.current.rotation.x = a
  })
  const light = lock ? (lock.state === 'locked' ? C.alarm : C.ok) : '#5a5e6b'
  return (
    <group position={[0, 0.27, -0.015]}>
      <Box size={[0.3, 0.3, 0.03]} color={C.white} radius={0.01} />
      <group ref={flap} position={[0, 0.12, 0.016]}>
        <Box size={[0.22, 0.22, 0.008]} position={[0, -0.11, 0]} material={clear('#9aa8c8', 0.55, 0.2)} shadow={false} />
      </group>
      <Ball r={0.007} position={[0.12, 0.13, 0.017]} material={glowing(light, Boolean(lock), 1.6)} shadow={false} />
    </group>
  )
}

/**
 * Pet cage: a bird cage, a small animal cage with an exercise wheel or a glass terrarium (Item.variant). Bound to a light
 * or switch, the terrarium's heat lamp glows while on; the wheel turns while on.
 */
export function PetCage({ v }: P) {
  const kind = v.opts.variant ?? 'bird'
  const wire = mat('#c9ccd4', { metalness: 0.4, roughness: 0.4 })
  if (kind === 'terrarium')
    return (
      <group>
        <Box size={[0.6, 0.04, 0.4]} position={[0, 0.02, 0]} color="#1d1f24" />
        <Box size={[0.58, 0.08, 0.38]} position={[0, 0.08, 0]} color="#c9a26a" />
        <Box size={[0.6, 0.4, 0.4]} position={[0, 0.24, 0]} material={clear('#d9efe6', 0.25, 0.05)} shadow={false} />
        <Box size={[0.6, 0.02, 0.4]} position={[0, 0.45, 0]} color="#1d1f24" />
        <Ball r={0.06} position={[-0.12, 0.16, 0.05]} color={C.leafDark} />
        <Cyl r={0.04} h={0.05} position={[0.15, 0.48, 0]} material={glowing('#ff8a3d', v.on, 2)} segments={16} />
        {v.on && <Glow position={[0.15, 0.4, 0]} color="#ff8a3d" opacity={v.night ? 0.6 : 0.3} size={0.5} />}
      </group>
    )
  if (kind === 'small')
    return (
      <group>
        <Box size={[0.6, 0.1, 0.4]} position={[0, 0.05, 0]} color="#8fd8bd" />
        <Box size={[0.6, 0.3, 0.4]} position={[0, 0.25, 0]} material={clear('#d9dde6', 0.18, 0.3)} shadow={false} />
        <group position={[0.15, 0.2, 0]}>
          <Spin speed={v.on ? 4 : 0} axis="z">
            <mesh geometry={torus(0.08, 0.008, 20)} material={wire} />
            <Box size={[0.16, 0.006, 0.006]} material={wire} shadow={false} />
          </Spin>
        </group>
      </group>
    )
  return (
    <group>
      <Cyl r={0.18} h={0.04} position={[0, 0.02, 0]} color="#f2f2ee" segments={24} />
      {Array.from({ length: 12 }, (_, i) => (
        <Cyl key={i} r={0.003} h={0.4} position={[Math.sin((i / 12) * TAU) * 0.17, 0.24, Math.cos((i / 12) * TAU) * 0.17]} material={wire} segments={4} shadow={false} />
      ))}
      <Ball r={0.17} position={[0, 0.44, 0]} scale={[1, 0.45, 1]} material={clear('#c9ccd4', 0.35, 0.3)} detail={1} />
      <Box size={[0.24, 0.006, 0.006]} position={[0, 0.25, 0]} color="#a87a45" shadow={false} />
      <Ball r={0.035} position={[0.02, 0.29, 0]} scale={[0.8, 1, 1.3]} color="#f5c04a" />
    </group>
  )
}

/** Chicken coop (in the garden): a raised wooden house with a ramp; its door slides up as far as a bound cover is open. */
export function ChickenCoop({ v }: P) {
  const wood = mat(v.opts.body ?? '#b0663a', { roughness: 0.8 })
  const pos = v.domain === 'cover' ? (num(v.attrs.current_position) ?? (v.state === 'open' ? 100 : 0)) : v.on ? 100 : 0
  const door = useRef<THREE.Group>(null)
  useEase((pos / 100) * 0.22, (y) => {
    if (door.current) door.current.position.y = y
  })
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.06, 0.4, 0.06]} position={[sx * 0.55, 0.2, sz * 0.35]} material={wood} />))}
      <Box size={[1.2, 0.6, 0.8]} position={[0, 0.7, 0]} material={wood} />
      <Box size={[1.3, 0.05, 0.95]} position={[0.0, 1.06, 0]} rotation={[0, 0, 0.12]} color="#5a3a28" />
      <group ref={door}>
        <Box size={[0.24, 0.26, 0.02]} position={[0.3, 0.55, 0.41]} color="#7a4a2a" />
      </group>
      <Box size={[0.22, 0.03, 0.7]} position={[0.3, 0.22, 0.65]} rotation={[0.55, 0, 0]} material={wood} />
    </group>
  )
}

/* ---------- garden ---------- */

/** Hose reel with a tap (low on the outside house wall): green hose on a reel; water drips from the nozzle while the bound valve is open. */
export function HoseReel({ v }: P) {
  const open = v.on
  return (
    <group>
      <Box size={[0.08, 0.08, 0.06]} position={[0.16, 0.65, -0.09]} color={C.steel} />
      <Cyl r={0.012} h={0.08} position={[0.16, 0.6, -0.05]} rotation={[Math.PI / 2, 0, 0]} color="#b08452" segments={10} />
      <Box size={[0.04, 0.5, 0.04]} position={[-0.05, 0.42, -0.1]} color="#2a2c33" />
      <group position={[-0.05, 0.45, 0]} rotation-z={Math.PI / 2}>
        <Cyl r={0.2} h={0.14} color="#2f9e54" segments={28} />
        <Cyl r={0.21} h={0.02} position={[0, 0.07, 0]} color="#2a2c33" segments={28} />
        <Cyl r={0.21} h={0.02} position={[0, -0.07, 0]} color="#2a2c33" segments={28} />
      </group>
      <Cyl r={0.012} h={0.3} position={[0.1, 0.15, 0.06]} rotation={[0.3, 0, 0.4]} color="#2f9e54" segments={8} />
      <group position={[0.18, 0.02, 0.12]} scale={0.15}>
        <Ripple active={open} color="#bfe3ff" at={[0, 0, 0]} />
      </group>
    </group>
  )
}

/** Rain barrel (in the garden): a barrel whose side gauge follows a bound level sensor (percent). */
export function RainBarrel({ v }: P) {
  const pct = v.domain === 'sensor' ? Math.max(0, Math.min(100, num(v.state) ?? 0)) : 0
  const h = 0.9
  return (
    <group>
      <Cyl r={0.3} rTop={0.27} h={h} position={[0, h / 2, 0]} color={bodyOf(v, '#3e6b4a')} segments={28} />
      <Cyl r={0.27} h={0.02} position={[0, h + 0.01, 0]} color="#2a2c33" segments={28} />
      <Box size={[0.05, h - 0.1, 0.01]} position={[0, h / 2, 0.29]} material={clear('#ffffff', 0.4, 0.2)} shadow={false} />
      {v.bound && <Box size={[0.035, ((h - 0.12) * pct) / 100 + 0.001, 0.012]} position={[0, 0.06 + ((h - 0.12) * pct) / 200, 0.292]} material={glowing('#4f9dff', true, 0.8)} shadow={false} />}
      <Cyl r={0.015} h={0.06} position={[0.18, 0.12, 0.24]} rotation={[Math.PI / 2, 0, 0]} color={C.steel} segments={8} />
    </group>
  )
}

/**
 * Greenhouse (in the garden, 2.5 x 2 m): a glass house on an aluminium frame with a pitched roof and plants inside. The
 * roof vent opens as far as a bound cover is open; a bound switch is the grow light, a purple glow while on.
 */
export function Greenhouse({ v }: P) {
  const frame = mat('#c9ccd4', { metalness: 0.5, roughness: 0.4 })
  const glass = clear('#e9f6ff', 0.22, 0.05)
  const roofGlass = clear('#e9f6ff', 0.32, 0.05)
  const cover = relatedOf(v, 'cover')
  const vent = cover ? (num(cover.attributes.current_position) ?? (cover.state === 'open' ? 100 : 0)) / 100 : 0
  const grow = (v.domain === 'switch' && v.on) || v.related.some((e) => domainOf(e.entity_id) === 'switch' && isActive(e))
  const W = 2.5
  const D = 2.0
  const H = 1.9
  const RISE = 0.45
  const pitch = Math.atan2(RISE, D / 2)
  const slope = Math.hypot(RISE, D / 2)
  const flap = useRef<THREE.Group>(null)
  useEase(pitch - vent * 0.6, (a) => {
    if (flap.current) flap.current.rotation.x = a
  })
  return (
    <group>
      <Box size={[W, 0.06, D]} position={[0, 0.03, 0]} color="#8a8f9c" />
      <Box size={[W, H, 0.01]} position={[0, H / 2, -D / 2]} material={glass} shadow={false} />
      <Box size={[W, H, 0.01]} position={[0, H / 2, D / 2]} material={glass} shadow={false} />
      <Box size={[0.01, H, D]} position={[-W / 2, H / 2, 0]} material={glass} shadow={false} />
      <Box size={[0.01, H, D]} position={[W / 2, H / 2, 0]} material={glass} shadow={false} />
      {/* frame: corner and middle posts, eave rails, ridge and the gable rafters */}
      {[-1, 0, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.04, H, 0.04]} position={[(sx * W) / 2, H / 2, (sz * D) / 2]} material={frame} />))}
      {[-1, 1].map((sz) => (
        <Box key={sz} size={[W, 0.04, 0.04]} position={[0, H, (sz * D) / 2]} material={frame} />
      ))}
      <Box size={[W, 0.05, 0.05]} position={[0, H + RISE, 0]} material={frame} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Box key={`r${sx}${sz}`} size={[0.04, 0.04, slope]} position={[(sx * W) / 2, H + RISE / 2, (sz * D) / 4]} rotation={[sz * pitch, 0, 0]} material={frame} />),
      )}
      {[-1, 1].map((sz) => (
        <Box key={sz} size={[W, 0.01, slope]} position={[0, H + RISE / 2, (sz * D) / 4]} rotation={[sz * pitch, 0, 0]} material={roofGlass} shadow={false} />
      ))}
      {/* roof vent on the front slope, hinged at the ridge */}
      <group ref={flap} position={[0, H + RISE + 0.03, 0]} rotation-x={pitch}>
        <Box size={[0.8, 0.025, 0.55]} position={[0, 0, 0.3]} material={frame} />
      </group>
      {[-0.8, -0.3, 0.2, 0.7].map((x) => (
        <group key={x}>
          <Box size={[0.36, 0.25, 0.3]} position={[x, 0.18, -0.55]} color="#a87a45" />
          <Ball r={0.16} position={[x, 0.42, -0.55]} color={C.leafDark} detail={1} />
        </group>
      ))}
      <Box size={[1.9, 0.7, 0.4]} position={[0, 0.35, 0.6]} color="#a87a45" />
      {[-0.6, 0, 0.6].map((x) => (
        <Ball key={x} r={0.13} position={[x, 0.78, 0.6]} color={C.leaf} detail={1} />
      ))}
      {grow && <Glow position={[0, 1.2, 0]} color="#c77dff" opacity={v.night ? 0.7 : 0.35} size={2.6} />}
    </group>
  )
}

/** Hammock cloth: a sagging sheet, its long sides curling up a little (cached geometry). */
const hammockCloth = () =>
  geo('hammock', () => {
    const g = new THREE.PlaneGeometry(2.2, 0.8, 18, 4)
    g.rotateX(-Math.PI / 2)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / 1.1
      const z = p.getZ(i) / 0.4
      p.setY(i, (1 - x * x) * (-0.36 + 0.07 * z * z))
    }
    g.computeVertexNormals()
    return g
  })

/** Hammock on a wooden stand (in the garden): the cloth sags between two spreader bars hung from the posts (Item.body). */
export function Hammock({ v }: P) {
  const wood = mat('#a87a45', { roughness: 0.7 })
  const color = v.opts.body ?? '#e2564b'
  const cloth = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }), [color])
  useEffect(() => () => cloth.dispose(), [cloth])
  const rope = Math.atan2(0.26, 0.2)
  return (
    <group>
      <Box size={[2.95, 0.08, 0.1]} position={[0, 0.04, 0]} material={wood} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box size={[0.1, 0.06, 0.8]} position={[s * 1.42, 0.03, 0]} material={wood} />
          <Box size={[0.08, 1.2, 0.08]} position={[s * 1.4, 0.66, 0]} rotation={[0, 0, s * 0.06]} material={wood} />
          <Box size={[0.04, 0.04, 0.82]} position={[s * 1.1, 1.0, 0]} material={wood} />
          <Cyl r={0.008} h={Math.hypot(0.26, 0.2)} position={[s * 1.23, 1.1, 0]} rotation={[0, 0, -s * rope]} color="#e8dcc2" segments={6} />
        </group>
      ))}
      <mesh position={[0, 1.0, 0]} geometry={hammockCloth()} material={cloth} castShadow receiveShadow />
    </group>
  )
}

/** Patio heater (in the garden): a tall pole with a mushroom head that glows orange with a warm halo while on. */
export function PatioHeater({ v }: P) {
  const on = v.on && (v.domain !== 'climate' || v.state !== 'off')
  const steel = mat('#c9ccd4', { metalness: 0.55, roughness: 0.3 })
  return (
    <group>
      <Cyl r={0.25} h={0.06} position={[0, 0.03, 0]} material={steel} segments={24} />
      <Cyl r={0.2} h={0.5} position={[0, 0.3, 0]} color="#2a2c33" segments={24} />
      <Cyl r={0.03} h={1.5} position={[0, 1.3, 0]} material={steel} segments={12} />
      <Cyl r={0.06} h={0.3} position={[0, 2.0, 0]} material={glowing('#ff7a3d', on, 2.2)} segments={16} />
      <Cyl r={0.4} rTop={0.06} h={0.18} position={[0, 2.25, 0]} material={steel} segments={28} />
      {on && <Glow position={[0, 1.95, 0]} color="#ff8a3d" opacity={v.night ? 0.9 : 0.4} size={1.6} />}
    </group>
  )
}

/** Fire pit (in the garden): a ring of stones with logs; while on flames flicker and it lights the garden at night. */
export function FirePit({ v }: P) {
  return (
    <group>
      {Array.from({ length: 12 }, (_, i) => (
        <Ball key={i} r={0.12} position={[Math.sin((i / 12) * TAU) * 0.42, 0.09, Math.cos((i / 12) * TAU) * 0.42]} scale={[1, 0.75, 1]} color={i % 2 ? '#8a8f9c' : '#a6a9b4'} detail={0} flat />
      ))}
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} geometry={disc(0.34)} material={mat('#2a2421')} />
      {[0.3, 1.6, 2.7].map((a) => (
        <Cyl key={a} r={0.04} h={0.5} position={[0, 0.07, 0]} rotation={[Math.PI / 2, a, 0]} color="#6b4a34" segments={8} />
      ))}
      {v.on && <Flames y={0.08} night={v.night} />}
    </group>
  )
}

const BIRDS: [number, number, string][] = [
  [-0.12, 0.05, '#e2564b'],
  [0.13, -0.04, '#4f9dff'],
]

/** Bird feeder on a post (in the garden): a little house with seed; birds sit and peck while a bound sensor sees a visit. */
export function BirdFeeder({ v }: P) {
  const visit = (v.domain === 'binary_sensor' && v.on) || v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && isActive(e))
  const birds = useRef<THREE.Group>(null)
  useAmbient(visit)
  useFrame(({ clock }) => {
    const g = birds.current
    if (!g || !visit) return
    g.children.forEach((c, i) => (c.rotation.x = Math.max(0, Math.sin(clock.elapsedTime * 7 + i * 2)) * 0.6))
  })
  const wood = mat('#a87a45', { roughness: 0.8 })
  return (
    <group>
      <Cyl r={0.03} h={1.4} position={[0, 0.7, 0]} material={wood} segments={10} />
      <Box size={[0.36, 0.03, 0.3]} position={[0, 1.42, 0]} material={wood} />
      <Box size={[0.2, 0.16, 0.16]} position={[0, 1.52, 0]} material={clear('#f2f2ee', 0.5, 0.3)} shadow={false} />
      <Box size={[0.4, 0.03, 0.34]} position={[0, 1.64, 0]} rotation={[0, 0, 0.2]} color="#5a3a28" />
      <group ref={birds} visible={visit}>
        {BIRDS.map(([x, z, c], i) => (
          <group key={i} position={[x, 1.46, z]}>
            <Ball r={0.035} position={[0, 0.03, 0]} scale={[1, 0.9, 1.3]} color={c} />
            <Ball r={0.02} position={[0, 0.06, 0.04]} color={c} />
          </group>
        ))}
      </group>
    </group>
  )
}

/* ---------- garage ---------- */

/** Portable generator (garage or garden): a frame with the engine and a tank; while it runs it shakes a little and puffs exhaust. */
export function Generator({ v }: P) {
  const body = useRef<THREE.Group>(null)
  const running = v.on
  useAmbient(running)
  useFrame(({ clock }) => {
    if (body.current) body.current.position.x = running ? Math.sin(clock.elapsedTime * 55) * 0.003 : 0
  })
  return (
    <group>
      <group ref={body}>
        <Box size={[0.62, 0.42, 0.42]} position={[0, 0.27, 0]} color={bodyOf(v, '#e2a33a')} radius={0.03} />
        <Box size={[0.5, 0.12, 0.36]} position={[0, 0.54, 0]} color="#2a2c33" radius={0.03} />
        <Box size={[0.2, 0.12, 0.01]} position={[0.15, 0.3, 0.215]} color="#2a2c33" shadow={false} />
      </group>
      {/* tube frame on both ends: two posts and two rails each, a carrying bar on top */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.34, 0, 0]}>
          {[-0.22, 0.22].map((z) => (
            <Box key={z} size={[0.03, 0.62, 0.03]} position={[0, 0.31, z]} color="#1d1f24" />
          ))}
          <Box size={[0.03, 0.03, 0.47]} position={[0, 0.03, 0]} color="#1d1f24" />
          <Box size={[0.03, 0.03, 0.47]} position={[0, 0.61, 0]} color="#1d1f24" />
        </group>
      ))}
      <Box size={[0.71, 0.03, 0.03]} position={[0, 0.63, 0]} color="#1d1f24" />
      {[-1, 1].map((s) => (
        <Cyl key={s} r={0.06} h={0.05} position={[s * 0.3, 0.06, 0.2]} rotation={[0, 0, Math.PI / 2]} color="#1d1f24" segments={14} />
      ))}
      <group position={[-0.32, 0.3, -0.12]}>
        <Mist active={running} y={0.05} size={0.35} color="#bfc3cf" />
      </group>
    </group>
  )
}

/** Ladder: leaning against a wall (Item.variant 'leaning', the default) or a free-standing step ladder ('step'). */
export function Ladder({ v }: P) {
  const metal = mat(v.opts.body ?? '#c9ccd4', { metalness: 0.4, roughness: 0.4 })
  if (v.opts.variant === 'step') {
    // A-frame hinged at the top: the step side leans to the front, the back legs to the back (within the 30 cm footprint)
    const TOP = 1.22
    const LEG = 1.25
    return (
      <group>
        {[-1, 1].map((s) => (
          <group key={s} position={[0, TOP, 0]} rotation-x={-s * 0.115}>
            {[-0.2, 0.2].map((x) => (
              <Box key={x} size={[0.04, LEG, 0.04]} position={[x, -LEG / 2, 0]} material={metal} />
            ))}
            {s > 0 && [0.3, 0.6, 0.9].map((d) => <Box key={d} size={[0.4, 0.03, 0.09]} position={[0, -LEG + d, 0.01]} material={metal} />)}
            {s < 0 && <Box size={[0.4, 0.03, 0.03]} position={[0, -LEG + 0.35, 0]} material={metal} />}
          </group>
        ))}
        <Box size={[0.44, 0.04, 0.16]} position={[0, TOP + 0.02, 0]} material={metal} />
      </group>
    )
  }
  const tilt = 0.18
  return (
    <group position={[0, 0, 0.05]} rotation-x={-tilt}>
      {[-0.2, 0.2].map((x) => (
        <Box key={x} size={[0.045, 2.2, 0.06]} position={[x, 1.1, 0]} material={metal} />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <Box key={i} size={[0.4, 0.03, 0.04]} position={[0, 0.25 + i * 0.3, 0]} material={metal} />
      ))}
    </group>
  )
}

/* ---------- structure ---------- */

/**
 * Skylight (in the ceiling): a framed glass pane that tilts up and out as far as a bound cover is open (or while a bound
 * window sensor is open). Daylight falls through it as a soft glow.
 */
export function Skylight({ v }: P) {
  const pos = v.domain === 'cover' ? (num(v.attrs.current_position) ?? (v.state === 'open' ? 100 : 0)) : v.on ? 100 : 0
  const sash = useRef<THREE.Group>(null)
  useEase((pos / 100) * 0.5, (a) => {
    if (sash.current) sash.current.rotation.x = -a
  })
  const Y = WALL_H - 0.02
  return (
    <group>
      {/* frame in the ceiling (a ring of four bars) and the glass sash hinged at its back edge */}
      {[-1, 1].map((sx) => (
        <Box key={`x${sx}`} size={[0.06, 0.06, 1.2]} position={[sx * 0.37, Y, 0]} color={C.white} />
      ))}
      {[-1, 1].map((sz) => (
        <Box key={`z${sz}`} size={[0.8, 0.06, 0.06]} position={[0, Y, sz * 0.57]} color={C.white} />
      ))}
      <group ref={sash} position={[0, Y - 0.01, -0.54]}>
        <Box size={[0.68, 0.02, 1.08]} position={[0, 0, 0.54]} material={clear('#cfe6ff', 0.45, 0.05)} shadow={false} />
        <Box size={[0.68, 0.03, 0.03]} position={[0, 0, 1.07]} color={C.white} shadow={false} />
      </group>
      {!v.night && <Glow position={[0, Y - 0.3, 0]} color="#fff7e0" opacity={0.25} size={1.2} />}
    </group>
  )
}

/** Column or pillar from the floor to the ceiling: round or square (Item.variant), in Item.body. */
export function Column({ v }: P) {
  const color = v.opts.body ?? '#ffffff'
  if (v.opts.variant === 'square')
    return (
      <group>
        <Box size={[0.35, 0.08, 0.35]} position={[0, 0.04, 0]} color={color} />
        <Box size={[0.28, WALL_H - 0.16, 0.28]} position={[0, WALL_H / 2, 0]} color={color} />
        <Box size={[0.35, 0.08, 0.35]} position={[0, WALL_H - 0.04, 0]} color={color} />
      </group>
    )
  return (
    <group>
      <Cyl r={0.17} h={0.08} position={[0, 0.04, 0]} color={color} segments={24} />
      <Cyl r={0.13} h={WALL_H - 0.16} position={[0, WALL_H / 2, 0]} color={color} segments={24} />
      <Cyl r={0.17} h={0.08} position={[0, WALL_H - 0.04, 0]} color={color} segments={24} />
    </group>
  )
}
