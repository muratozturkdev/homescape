import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { deviceClass, domainOf, isActive, num } from '@/ha/derive'
import { currentLang, formatNumber } from '@/i18n'
import { WALL_H } from '@/model/geometry'
import { markShadows } from '../frame'
import { Airflow, Glow, Mist, MusicNotes, Ripple, Spin, useAmbient, useLitMaterial } from './effects'
import { C } from './palette'
import { Ball, Box, Cyl, mat, rng } from './primitives'
import { glowTexture, keyboardTexture } from './textures'
import type { Visual } from './visual'

/*
 * Smart home items: ceiling and table lights, climate devices, media, security, sensors, network devices, small kitchen
 * appliances. All built in code, all showing their state.
 * Local convention: origin at the center of the footprint on the floor, front at +z, width along x. Wall items have their
 * back at local z = -depth/2 (touching the wall) and are drawn at their real height; ceiling items have their top at
 * WALL_H. Items placed on a desk start at the surface they sit on (up from y = 0).
 * Continuous animations request frames only while active (useAmbient); geometry, transparent materials and textures are
 * cached at module level.
 */

type P = { v: Visual }
const DIM = '#9aa0b8'
const TAU = Math.PI * 2
const MONO = '"JetBrains Mono", ui-monospace, monospace'
/** Effect meshes (halo, cone, puddle) must not catch clicks. */
const noHit = () => null

/** Body color: pale gray when unavailable, otherwise the color picked on the card (Item.body) or the default. */
const bodyOf = (v: Visual, def: string) => (v.unavailable ? DIM : (v.opts.body ?? def))

/** Multiplies a color by k (k < 1 darker, k > 1 lighter; overflowing channels are clipped). */
const tint = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`

/** Status color by value thresholds: good, fair, poor. */
const grade = (n: number, ok: number, warn: number) => (n < ok ? C.ok : n < warn ? C.warn : C.alarm)

/* ---------- shared caches and helpers ---------- */

/** Torus, disc, cone and plane geometries: same sizes share one geometry, never disposed. */
const geos = new Map<string, THREE.BufferGeometry>()
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T) {
  let g = geos.get(key) as T | undefined
  if (!g) {
    g = make()
    geos.set(key, g)
  }
  return g
}
const torus = (r: number, tube: number, seg = 40) => geo(`t${r},${tube},${seg}`, () => new THREE.TorusGeometry(r, tube, 8, seg))
const disc = (r: number, seg = 40) => geo(`d${r},${seg}`, () => new THREE.CircleGeometry(r, seg))
/** Open ended cone: apex at +y (h/2), base at -y. */
const cone = (r: number, h: number, seg = 16) => geo(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg, 1, true))
const plane = (w: number, h: number) => geo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h))
const sphere = (r: number, seg = 16) => geo(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)))

/** Transparent surface (glass, water tank): one material per color and opacity; no depth write, the contents stay visible. */
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

/**
 * Small display textures with text (thermostat dial, power meter): cached by value. Values vary a lot, so the least
 * recently used one is disposed (at most TEXT_MAX textures).
 */
const texts = new Map<string, THREE.CanvasTexture>()
const TEXT_MAX = 48
function textTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let t = texts.get(key)
  if (t) {
    // the most recently used moves to the end
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
  if (texts.size > TEXT_MAX) {
    const [oldKey, old] = texts.entries().next().value!
    texts.delete(oldKey)
    old.dispose()
  }
  return t
}

/**
 * Pulses a part that glows when on (doorbell ring, detector light, siren). Pass the returned ref to the part's mesh; its
 * material (useLitMaterial) is changed through the mesh. peak: full brightness (0.35 + level × strength).
 */
function usePulse(active: boolean, peak: number, speed = 5, floor = 0.15) {
  const ref = useRef<THREE.Mesh>(null)
  useAmbient(active)
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!active || !mesh) return
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * speed)
    ;(mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = peak * (floor + (1 - floor) * k)
  })
  return ref
}

/**
 * Slowly blinking network lights (like data traffic). Pass the returned ref to the group holding the lights; each child
 * mesh's userData.blink picks the phase (1 or 2; steady without it). Slow ambient animation.
 */
function useBlink(active: boolean, peak: number) {
  const ref = useRef<THREE.Group>(null)
  useAmbient(active, true)
  useFrame(({ clock }) => {
    const g = ref.current
    if (!active || !g) return
    const t = clock.elapsedTime
    const a = Math.sin(t * 2.4) > -0.25 ? peak : 0.12
    const b = Math.sin(t * 3.7 + 1.3) > 0.1 ? peak : 0.12
    for (let i = 0; i < g.children.length; i++) {
      const m = g.children[i] as THREE.Mesh
      const ph = m.userData.blink
      if (ph) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = ph === 1 ? a : b
    }
  })
  return ref
}

/** Pulsing halo (siren, alarming detector, ringing doorbell). Drawn only while active; requests its own frames. */
function PulseGlow({ position, color, size, opacity, speed = 5 }: { position: [number, number, number]; color: string; size: number; opacity: number; speed?: number }) {
  const ref = useRef<THREE.Sprite>(null)
  const tex = useMemo(() => glowTexture(), [])
  useAmbient(true)
  useFrame(({ clock }) => {
    const s = ref.current
    if (!s) return
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * speed)
    ;(s.material as THREE.SpriteMaterial).opacity = opacity * (0.2 + 0.8 * k)
    s.scale.setScalar(size * (0.8 + 0.3 * k))
  })
  return (
    <sprite ref={ref} position={position} scale={[size, size, size]} renderOrder={10} raycast={noHit}>
      <spriteMaterial map={tex} color={color} transparent opacity={opacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </sprite>
  )
}

/** Eases toward a value and calls apply on each step; requests no frames once settled. Snaps on the first frame. */
function useSettle(target: number, apply: (x: number) => void, speed = 2.5) {
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
    if (Math.abs(d) < 0.001) {
      if (cur.current !== target) {
        cur.current = target
        apply(target)
      }
      return
    }
    cur.current += d * Math.min(1, dt * speed)
    apply(cur.current)
    markShadows(1)
    state.invalidate()
  })
}

/* ---------- lights ---------- */

/**
 * Flush ceiling light: thin rim and opal diffuser. Item.variant 'round' (default) a round drum with a flat dome, 'square' a
 * square panel. When on the diffuser glows in the light's color and intensity with a soft halo below. Rim color Item.body.
 */
export function CeilingLight({ v }: P) {
  const square = v.opts.variant === 'square'
  const rim = bodyOf(v, C.white)
  const opal = useLitMaterial(v.unavailable ? DIM : C.offWhite, v.on, v.color, v.level, 1.3)
  const k = v.on ? v.level * (v.night ? 0.75 : 0.35) : 0
  const T = WALL_H
  return (
    <group>
      {square ? (
        <>
          <Box size={[0.43, 0.018, 0.43]} position={[0, T - 0.009, 0]} color={rim} radius={0.004} shadow={false} />
          <Box size={[0.41, 0.05, 0.41]} position={[0, T - 0.043, 0]} material={opal} radius={0.012} shadow={false} />
          <Box size={[0.38, 0.012, 0.38]} position={[0, T - 0.072, 0]} material={opal} radius={0.005} shadow={false} />
        </>
      ) : (
        <>
          <Cyl r={0.215} h={0.018} position={[0, T - 0.009, 0]} color={rim} segments={48} shadow={false} />
          <Cyl r={0.2} rTop={0.208} h={0.05} position={[0, T - 0.043, 0]} material={opal} segments={48} shadow={false} />
          <Ball r={0.2} detail={3} position={[0, T - 0.068, 0]} scale={[1, 0.14, 1]} material={opal} shadow={false} />
          {/* thin metal ring under the drum */}
          <mesh position={[0, T - 0.068, 0]} rotation-x={Math.PI / 2} geometry={torus(0.2, 0.004, 48)} material={mat(rim, { metalness: 0.4, roughness: 0.4 })} />
        </>
      )}
      <Glow position={[0, T - 0.17, 0]} color={v.color} opacity={k} size={1.3} />
    </group>
  )
}

/**
 * Track light: a rail just below the ceiling (length Item.len, default 1.2 m; along x) with evenly spaced spot heads (one
 * every 40 cm, at least two). The heads tilt down and forward (+z); when on the lenses glow and each casts a thin light
 * cone. Rail and head color Item.body (default black).
 */
export function TrackLight({ v }: P) {
  const len = v.opts.len ?? 1.2
  const n = Math.max(2, Math.round(len / 0.4))
  const body = bodyOf(v, C.ink)
  const lens = useLitMaterial('#3a3f55', v.on, v.color, v.level, 2.2)
  const beam = useMemo(
    () => new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: 0.06 * v.level * (v.night ? 1.6 : 1), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
    [v.color, v.level, v.night],
  )
  useEffect(() => () => beam.dispose(), [beam])
  const T = WALL_H
  const Z = -0.02
  return (
    <group>
      <Box size={[len, 0.034, 0.034]} position={[0, T - 0.017, Z]} color={body} radius={0.004} shadow={false} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.012, 0.036, 0.036]} position={[s * (len / 2 - 0.006), T - 0.018, Z]} color={body} shadow={false} />
      ))}
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[-len / 2 + ((i + 0.5) * len) / n, T - 0.034, Z]}>
          {/* adapter and neck */}
          <Box size={[0.03, 0.018, 0.03]} position={[0, -0.009, 0]} color={body} shadow={false} />
          <Cyl r={0.006} h={0.03} position={[0, -0.033, 0]} color={body} segments={8} shadow={false} />
          {/* head: tilted down and forward; lens, a thin light cone and a small halo when on */}
          <group position={[0, -0.05, 0]} rotation-x={-0.45}>
            <Cyl r={0.032} rTop={0.028} h={0.1} position={[0, -0.05, 0]} color={body} segments={20} shadow={false} />
            <Cyl r={0.026} h={0.004} position={[0, -0.1, 0]} material={lens} segments={20} shadow={false} />
            {v.on && (
              <>
                <mesh position={[0, -0.7, 0]} geometry={cone(0.28, 1.2, 20)} material={beam} renderOrder={9} userData={{ selectionAid: true }} raycast={noHit} />
                <Glow position={[0, -0.12, 0]} color={v.color} opacity={v.level * (v.night ? 0.8 : 0.4)} size={0.22} />
              </>
            )}
          </group>
        </group>
      ))}
    </group>
  )
}

/**
 * Table lamp (on a desk or nightstand, ~50 cm). Item.variant 'classic' (default): ceramic body, brass neck, fabric drum
 * shade; lit from inside when on. 'globe': opal glass globe on a small base, glowing all over when on.
 * Body color Item.body, shade / globe color Item.top.
 */
export function TableLamp({ v }: P) {
  const globe = v.opts.variant === 'globe'
  const body = bodyOf(v, globe ? '#c9a46a' : '#e8dcc8')
  const shade = useLitMaterial(v.opts.top ?? (globe ? '#f6f4ef' : '#f3ead8'), v.on, v.color, v.level, globe ? 1.4 : 0.9)
  const brass = mat('#c9a46a', { metalness: 0.6, roughness: 0.35 })
  const k = v.on ? v.level * (v.night ? 0.7 : 0.3) : 0
  if (globe)
    return (
      <group>
        <Cyl r={0.065} rTop={0.055} h={0.045} position={[0, 0.0225, 0]} material={mat(body, { roughness: 0.4, metalness: 0.3 })} segments={28} />
        <Cyl r={0.035} rTop={0.03} h={0.02} position={[0, 0.055, 0]} material={brass} segments={20} shadow={false} />
        <Ball r={0.13} detail={3} position={[0, 0.185, 0]} material={shade} shadow={false} />
        <Glow position={[0, 0.19, 0]} color={v.color} opacity={k} size={0.9} />
      </group>
    )
  return (
    <group>
      <Cyl r={0.07} rTop={0.065} h={0.018} position={[0, 0.009, 0]} material={mat(body, { roughness: 0.3 })} segments={28} />
      <Ball r={0.08} detail={3} position={[0, 0.11, 0]} scale={[1, 1.15, 1]} material={mat(body, { roughness: 0.3 })} />
      <Cyl r={0.022} rTop={0.016} h={0.03} position={[0, 0.205, 0]} material={mat(body, { roughness: 0.3 })} segments={18} shadow={false} />
      <Cyl r={0.006} h={0.12} position={[0, 0.27, 0]} material={brass} segments={8} shadow={false} />
      <Cyl r={0.15} rTop={0.115} h={0.2} position={[0, 0.39, 0]} material={shade} segments={36} shadow={false} />
      <Glow position={[0, 0.37, 0]} color={v.color} opacity={k} size={1} />
    </group>
  )
}

/* ---------- climate ---------- */

/** Thermostat dial: dark face, ticks in the ring color along an arc open at the bottom, target temperature in the center (a short dash without one). */
function dialTexture(target: number | null, ring: string) {
  const label = target == null ? '' : formatNumber(target, 1)
  return textTexture(`dial-${label}-${ring}`, 256, 256, (g) => {
    const s = 256
    g.fillStyle = '#111426'
    g.fillRect(0, 0, s, s)
    g.strokeStyle = ring
    g.lineWidth = 4
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.75 + (i / 40) * Math.PI * 1.5
      const r1 = s * (i % 5 ? 0.43 : 0.455)
      g.globalAlpha = i % 5 ? 0.45 : 0.95
      g.beginPath()
      g.moveTo(s / 2 + Math.cos(a) * s * 0.39, s / 2 + Math.sin(a) * s * 0.39)
      g.lineTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1)
      g.stroke()
    }
    g.globalAlpha = 1
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (label) {
      g.fillStyle = '#ffffff'
      g.font = `600 ${label.length > 2 ? 72 : 92}px ${MONO}`
      g.fillText(label, s / 2, s / 2 + 2)
      g.fillStyle = ring
      g.font = `500 34px ${MONO}`
      g.fillText('°', s / 2, s * 0.75)
    } else {
      g.fillStyle = 'rgba(255, 255, 255, 0.35)'
      g.fillRect(s * 0.4, s / 2 - 3, s * 0.2, 6)
    }
  })
}

/**
 * Thermostat (Nest style round dial, center 1.45 m above the floor; 1.40-1.50 m): wall plate, metal ring, dark glass face.
 * The ring light is orange while heating (hvac_action 'heating'), blue while cooling, soft white when idle; while bound the
 * face shows the target temperature (temperature). While heating or cooling at night, a faint halo in front of the dial.
 */
export function Thermostat({ v }: P) {
  const action = String(v.attrs.hvac_action ?? '')
  const heating = action === 'heating' || (!action && v.state === 'heat')
  const cooling = action === 'cooling' || (!action && v.state === 'cool')
  const ring = heating ? C.heat : cooling ? C.cool : '#e8ecff'
  const live = v.bound && !v.unavailable
  const t = num(v.attrs.temperature) ?? num(v.attrs.target_temp_low)
  const target = live && t != null ? Math.round(t * 2) / 2 : null
  const tex = live ? dialTexture(target, ring) : dialTexture(null, '#8d93ae')
  const glow = useLitMaterial('#8d93ae', live, ring, heating || cooling ? 1 : 0.5, 2)
  const face = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, color: live ? '#ffffff' : '#7a7f96', toneMapped: false }), [tex, live])
  useEffect(() => () => face.dispose(), [face])
  const Y = 1.45
  return (
    <group>
      <Cyl r={0.05} h={0.004} position={[0, Y, -0.013]} rotation={[Math.PI / 2, 0, 0]} color={C.offWhite} segments={40} shadow={false} />
      <Cyl r={0.042} h={0.022} position={[0, Y, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat('#d4d7e0', { metalness: 0.65, roughness: 0.28 })} segments={44} />
      <mesh position={[0, Y, 0.0112]} geometry={disc(0.037, 44)} material={face} />
      <mesh position={[0, Y, 0.0114]} geometry={torus(0.0375, 0.0016, 48)} material={glow} />
      {live && (heating || cooling) && v.night && <Glow position={[0, Y, 0.04]} color={ring} opacity={0.35} size={0.22} />}
    </group>
  )
}

/** Perforated body texture (air purifier): staggered hole grid on a white ground; multiplied by the material color. */
let perfTex: THREE.CanvasTexture | null = null
function perforated() {
  if (perfTex) return perfTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = 'rgba(40, 44, 64, 0.5)'
  for (let r = 0; r < 8; r++)
    for (let k = 0; k < 8; k++) {
      g.beginPath()
      g.arc(k * 16 + (r % 2 ? 12 : 4), r * 16 + 8, 3, 0, TAU)
      g.fill()
    }
  perfTex = new THREE.CanvasTexture(c)
  perfTex.colorSpace = THREE.SRGBColorSpace
  perfTex.wrapS = perfTex.wrapT = THREE.RepeatWrapping
  perfTex.repeat.set(10, 6)
  perfTex.anisotropy = 8
  return perfTex
}

/** PM2.5 (µg/m³): from the item's own attribute (pm25 / pm2_5), from its state when bound to a PM2.5 sensor, or from a related PM2.5 sensor. */
function pm25Of(v: Visual) {
  const own = num(v.attrs.pm25) ?? num(v.attrs.pm2_5)
  if (own != null) return own
  if (v.domain === 'sensor' && v.attrs.device_class === 'pm25') return num(v.state)
  const s = v.related.find((e) => deviceClass(e) === 'pm25')
  return s ? num(s.state) : null
}

/**
 * Air purifier (on the floor, ~58 cm): dark base, perforated cylinder body, dark grille bowl on top, a fan spinning when
 * on (speed from percentage) and an air quality ring: PM2.5 < 12 green, < 35 orange, above that red; green when on with no
 * value. A small display dot at the front in the same color. Body color Item.body.
 */
export function AirPurifier({ v }: P) {
  const body = bodyOf(v, '#f4f4f6')
  const pm = pm25Of(v)
  const aq = pm == null ? C.ok : grade(pm, 12, 35)
  const shell = useMemo(() => new THREE.MeshStandardMaterial({ color: body, map: perforated(), roughness: 0.7 }), [body])
  useEffect(() => () => shell.dispose(), [shell])
  const ring = useLitMaterial('#c9cdda', v.on, aq, 1, 2.2)
  const speed = v.on ? 5 + ((num(v.attrs.percentage) ?? 50) / 100) * 9 : 0
  const grille = mat('#c9cdda', { roughness: 0.5 })
  return (
    <group>
      <Cyl r={0.125} rTop={0.13} h={0.04} position={[0, 0.02, 0]} color="#3a3d47" segments={40} />
      <Cyl r={0.13} h={0.46} position={[0, 0.27, 0]} material={shell} segments={48} />
      <Cyl r={0.13} rTop={0.122} h={0.04} position={[0, 0.52, 0]} color={body} segments={48} />
      {/* top grille: dark bowl, spinning fan, grille rings, air quality ring */}
      <Cyl r={0.1} h={0.006} position={[0, 0.541, 0]} color="#2a2d38" segments={40} shadow={false} />
      <group position={[0, 0.547, 0]}>
        <Spin speed={speed} axis="y">
          {[0, 1, 2, 3, 4].map((i) => (
            <group key={i} rotation-y={(i * TAU) / 5}>
              <Box size={[0.075, 0.003, 0.022]} position={[0.05, 0, 0]} rotation-x={0.35} color="#8d93ae" shadow={false} />
            </group>
          ))}
          <Cyl r={0.018} h={0.006} color="#c9cdda" segments={16} shadow={false} />
        </Spin>
      </group>
      {[0.04, 0.075].map((r) => (
        <mesh key={r} position={[0, 0.553, 0]} rotation-x={-Math.PI / 2} geometry={torus(r, 0.0025)} material={grille} />
      ))}
      <mesh position={[0, 0.543, 0]} rotation-x={-Math.PI / 2} geometry={torus(0.11, 0.006, 48)} material={ring} />
      <Box size={[0.05, 0.03, 0.006]} position={[0, 0.47, 0.128]} color="#1b2036" radius={0.004} shadow={false} />
      <Ball r={0.005} position={[0, 0.47, 0.132]} material={ring} shadow={false} />
      {v.on && <Glow position={[0, 0.58, 0]} color={aq} opacity={v.night ? 0.45 : 0.18} size={0.45} />}
    </group>
  )
}

/**
 * Humidifier (on a desk, ~30 cm): white base, translucent water tank with water inside, mist outlet on top. When on, mist
 * rises from the outlet and a blue LED lights up at the front. Body color Item.body.
 */
export function Humidifier({ v }: P) {
  const body = bodyOf(v, C.white)
  const led = useLitMaterial('#8d93ae', v.on, C.cool, 1, 2.4)
  return (
    <group>
      <Cyl r={0.1} rTop={0.096} h={0.08} position={[0, 0.04, 0]} color={body} segments={36} />
      <Cyl r={0.088} h={0.17} position={[0, 0.165, 0]} material={clear('#d8ecff', 0.4)} segments={36} shadow={false} />
      <Cyl r={0.08} h={0.11} position={[0, 0.136, 0]} material={clear('#6fb6ff', 0.45, 0.15)} segments={30} shadow={false} />
      <Cyl r={0.092} rTop={0.07} h={0.03} position={[0, 0.265, 0]} color={body} segments={36} />
      <Cyl r={0.022} rTop={0.018} h={0.02} position={[0, 0.29, 0]} color={C.offWhite} segments={16} shadow={false} />
      <Cyl r={0.012} h={0.003} position={[0, 0.3, 0]} color="#2a2d38" segments={12} shadow={false} />
      {/* front button and LED */}
      <Box size={[0.022, 0.01, 0.006]} position={[0, 0.03, 0.097]} rotation-x={-0.05} color={C.offWhite} radius={0.003} shadow={false} />
      <Ball r={0.005} position={[0, 0.055, 0.097]} material={led} shadow={false} />
      <Mist active={v.on} y={0.3} size={0.6} />
    </group>
  )
}

/**
 * Dehumidifier (on the floor, on casters, ~56 cm): rectangular body, lower intake grille and water tank window at the
 * front, outlet grille and display on top. When on the display glows blue and air flows up and forward from the top
 * grille. Body Item.body.
 */
export function Dehumidifier({ v }: P) {
  const body = bodyOf(v, C.white)
  const led = useLitMaterial(C.screenOff, v.on, '#4f9dff', 1, 1.8)
  const H = 0.52
  const y0 = 0.03
  const F = 0.11
  const top = y0 + H
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Ball key={`${sx}${sz}`} r={0.016} position={[sx * 0.13, 0.016, sz * 0.08]} color="#3a3d47" detail={1} shadow={false} />))}
      <Box size={[0.33, H, 0.23]} position={[0, y0 + H / 2, -0.005]} color={body} radius={0.03} />
      {/* lower front grille and water tank window */}
      {Array.from({ length: 7 }, (_, i) => (
        <Box key={i} size={[0.2, 0.008, 0.006]} position={[-0.03, 0.1 + i * 0.03, F]} color={C.steel} shadow={false} />
      ))}
      <Box size={[0.04, 0.12, 0.004]} position={[0.115, 0.17, F]} material={mat('#9fd0ff', { roughness: 0.15 })} radius={0.002} shadow={false} />
      <Box size={[0.04, 0.004, 0.005]} position={[0.115, 0.15, F + 0.001]} color="#4f9dff" shadow={false} />
      {/* top outlet grille, display and LED */}
      <Box size={[0.24, 0.004, 0.12]} position={[0, top + 0.002, -0.035]} color="#2a2d38" shadow={false} />
      {[-0.08, -0.04, 0, 0.04, 0.08].map((x) => (
        <Box key={x} size={[0.008, 0.004, 0.11]} position={[x, top + 0.004, -0.035]} color={C.steel} shadow={false} />
      ))}
      <Box size={[0.09, 0.004, 0.035]} position={[0, top + 0.002, 0.07]} color={C.screenOff} radius={0.002} shadow={false} />
      <Box size={[0.04, 0.003, 0.012]} position={[0, top + 0.004, 0.07]} material={led} shadow={false} />
      {/* outgoing air: Airflow flows down, a negative vertical scale turns it upward */}
      <group position={[0, top + 0.01, -0.035]} scale={[0.4, -0.55, 0.35]}>
        <Airflow active={v.on} color="#cfe8ff" y={0} />
      </group>
    </group>
  )
}

/**
 * Oil filled heater (on the floor, on casters, ~62 cm): vertical fins, lower and upper connecting pipes, a control box at
 * the right end (knob on top, light at the front), feet with casters. When on the fins turn warm orange, the light comes on
 * and a warm halo glows in front. Body color Item.body.
 */
export function Heater({ v }: P) {
  const base = bodyOf(v, C.white)
  const fins = useLitMaterial(base, v.on, C.heat, 0.55, 0.6)
  const led = useLitMaterial('#8d93ae', v.on, '#ff7a2a', 1, 2.4)
  return (
    <group>
      {/* feet with casters */}
      {[-0.17, 0.13].map((x) => (
        <group key={x}>
          <Box size={[0.035, 0.03, 0.22]} position={[x, 0.1, 0]} color={C.inkSoft} radius={0.008} />
          {[-0.09, 0.09].map((z) => (
            <group key={z}>
              <Cyl r={0.006} h={0.05} position={[x, 0.06, z]} color={C.inkSoft} segments={8} shadow={false} />
              <Ball r={0.02} position={[x, 0.02, z]} color={C.ink} detail={1} shadow={false} />
            </group>
          ))}
        </group>
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <Box key={i} size={[0.045, 0.5, 0.2]} position={[-0.27 + i * 0.06, 0.37, 0]} material={fins} radius={0.02} />
      ))}
      {[0.16, 0.58].map((y) => (
        <Cyl key={y} r={0.014} h={0.5} position={[-0.03, y, 0]} rotation={[0, 0, Math.PI / 2]} material={fins} segments={12} shadow={false} />
      ))}
      {/* control box */}
      <Box size={[0.07, 0.16, 0.13]} position={[0.265, 0.5, 0]} color={base} radius={0.015} />
      <Cyl r={0.02} h={0.012} position={[0.265, 0.586, 0]} color={C.steel} segments={18} shadow={false} />
      <Ball r={0.006} position={[0.265, 0.46, 0.066]} material={led} shadow={false} />
      {v.on && <Glow position={[0, 0.4, 0.22]} color={C.heat} opacity={v.night ? 0.6 : 0.28} size={1.2} />}
    </group>
  )
}

/**
 * Water heater (on the wall; 1.185-2.10 m): vertical white cylinder (40 cm diameter), domed ends, wall bracket at the back,
 * cold/hot water pipes below, a small display and light at the front. While running (on, or water_heater mode not 'off')
 * the display and light are orange; a faint halo in front at night. Body color Item.body.
 */
export function WaterHeater({ v }: P) {
  const body = bodyOf(v, C.white)
  const mode = String(v.attrs.operation_mode ?? v.attrs.current_operation ?? v.state)
  const heating = v.on || (v.domain === 'water_heater' && v.bound && !v.unavailable && mode !== 'off')
  const screen = useLitMaterial(C.screenOff, heating, C.heat, 0.8, 1.4)
  const led = useLitMaterial('#8d93ae', heating, '#ff8a2a', 1, 2.4)
  const R = 0.2
  const Z = -0.225 + R
  return (
    <group>
      <Box size={[0.26, 0.05, 0.02]} position={[0, 1.95, -0.215]} color={C.steel} shadow={false} />
      <Cyl r={R} h={0.7} position={[0, 1.7, Z]} color={body} segments={48} />
      <Ball r={R} detail={3} position={[0, 2.05, Z]} scale={[1, 0.25, 1]} color={body} />
      <Ball r={R} detail={3} position={[0, 1.35, Z]} scale={[1, 0.25, 1]} color={body} />
      <Cyl r={R + 0.002} h={0.02} position={[0, 1.42, Z]} color={C.steel} segments={48} shadow={false} />
      {/* pipes: cold on the left (blue ring), hot on the right (red ring) */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cyl r={0.011} h={0.13} position={[s * 0.06, 1.25, Z]} color={C.steel} segments={10} shadow={false} />
          <Cyl r={0.015} h={0.014} position={[s * 0.06, 1.22, Z]} color={s < 0 ? '#4f9dff' : C.alarm} segments={12} shadow={false} />
        </group>
      ))}
      {/* display */}
      <Box size={[0.11, 0.07, 0.012]} position={[0, 1.62, Z + R - 0.003]} color={C.ink} radius={0.004} shadow={false} />
      <Box size={[0.075, 0.035, 0.003]} position={[-0.008, 1.625, Z + R + 0.0045]} material={screen} shadow={false} />
      <Ball r={0.005} position={[0.04, 1.6, Z + R + 0.005]} material={led} shadow={false} />
      {heating && v.night && <Glow position={[0, 1.62, Z + R + 0.08]} color={C.heat} opacity={0.3} size={0.35} />}
    </group>
  )
}

/**
 * Combi boiler (on the wall; 1.0-1.92 m): rounded white wall hung body (44 x 72 x 30 cm, bottom edge at 1.2 m), a gray
 * control strip at the bottom (display, two knobs, light), plumbing pipes and valves below it (flow/return red-blue). While
 * heating (climate: hvac_action 'heating', or on when unknown; water heater: mode not 'off'; plug: on) the display and light
 * are orange with a flame colored halo in front. Radiators grouped with the boiler bind to the same entity and all warm up
 * when it heats (model/groups.ts). Body color Item.body.
 */
export function Boiler({ v }: P) {
  const body = bodyOf(v, C.white)
  const mode = String(v.attrs.operation_mode ?? v.attrs.current_operation ?? v.state)
  const heating = v.bound && !v.unavailable && (v.domain === 'water_heater' ? mode !== 'off' : v.on && (v.domain !== 'climate' || v.attrs.hvac_action === 'heating' || v.attrs.hvac_action == null))
  const screen = useLitMaterial(C.screenOff, heating, C.heat, 0.8, 1.4)
  const led = useLitMaterial('#8d93ae', heating, '#ff8a2a', 1, 2.4)
  const D = 0.3
  const Z = -0.17 + D / 2
  const F = Z + D / 2
  return (
    <group>
      <Box size={[0.44, 0.72, D]} position={[0, 1.56, Z]} color={body} radius={0.03} />
      {/* control strip: display, two knobs, light */}
      <Box size={[0.4, 0.1, 0.012]} position={[0, 1.3, F + 0.004]} color="#d7dae6" radius={0.01} shadow={false} />
      <Box size={[0.1, 0.045, 0.006]} position={[-0.08, 1.3, F + 0.012]} color={C.ink} radius={0.004} shadow={false} />
      <Box size={[0.08, 0.03, 0.003]} position={[-0.08, 1.3, F + 0.0155]} material={screen} shadow={false} />
      {[0.06, 0.13].map((x) => (
        <Cyl key={x} r={0.018} h={0.018} position={[x, 1.3, F + 0.018]} rotation={[Math.PI / 2, 0, 0]} color={C.steel} segments={18} shadow={false} />
      ))}
      <Ball r={0.006} position={[0, 1.3, F + 0.013]} material={led} shadow={false} />
      {/* plumbing: five pipes, flow/return valves colored */}
      {[-0.16, -0.08, 0, 0.08, 0.16].map((x, i) => (
        <group key={x}>
          <Cyl r={0.011} h={0.2} position={[x, 1.1, Z - 0.03]} color={i === 2 ? '#c98a4b' : C.steel} segments={10} shadow={false} />
          {(i === 0 || i === 4) && <Box size={[0.04, 0.018, 0.03]} position={[x, 1.08, Z - 0.03]} color={i === 0 ? C.alarm : '#4f9dff'} radius={0.004} shadow={false} />}
        </group>
      ))}
      {heating && <Glow position={[0, 1.42, F + 0.12]} color={C.heat} opacity={v.night ? 0.5 : 0.22} size={0.7} />}
    </group>
  )
}

/** Towel warmer rails (height above the floor): a towel hangs in the gap. */
const TOWEL_RAILS = [0.66, 0.74, 0.82, 0.9, 0.98, 1.12, 1.2, 1.28, 1.36]

/**
 * Towel warmer (on the wall; 0.585-1.415 m): two vertical pipes with horizontal rails between them (ladder), wall brackets,
 * a folded towel hung over the 1.12 m rail. When on the rails turn warm orange with a faint warm halo in front. Rail color
 * Item.body, towel color Item.top.
 */
export function TowelWarmer({ v }: P) {
  const base = bodyOf(v, '#eef0f5')
  const rails = useLitMaterial(base, v.on, C.heat, 0.5, 0.55)
  const towel = v.opts.top ?? '#9cc3e6'
  const Z = -0.01
  return (
    <group>
      {[-0.22, 0.22].map((x) => (
        <group key={x}>
          <Cyl r={0.014} h={0.8} position={[x, 1.0, Z]} material={rails} segments={14} />
          <Ball r={0.015} position={[x, 1.4, Z]} material={rails} detail={1} shadow={false} />
          <Ball r={0.015} position={[x, 0.6, Z]} material={rails} detail={1} shadow={false} />
          {[0.7, 1.3].map((y) => (
            <Cyl key={y} r={0.009} h={0.03} position={[x, y, -0.025]} rotation={[Math.PI / 2, 0, 0]} color={C.steel} segments={10} shadow={false} />
          ))}
        </group>
      ))}
      {TOWEL_RAILS.map((y) => (
        <Cyl key={y} r={0.009} h={0.44} position={[0, y, Z]} rotation={[0, 0, Math.PI / 2]} material={rails} segments={10} shadow={false} />
      ))}
      {/* folded towel: long flap at the front, short at the back, a fold wrapping the rail on top */}
      <Cyl r={0.017} h={0.3} position={[0, 1.122, Z]} rotation={[0, 0, Math.PI / 2]} color={towel} segments={12} />
      <Box size={[0.3, 0.22, 0.012]} position={[0, 1.01, Z + 0.016]} color={towel} radius={0.004} />
      <Box size={[0.3, 0.15, 0.012]} position={[0, 1.045, Z - 0.016]} color={tint(towel, 0.9)} radius={0.004} shadow={false} />
      <Box size={[0.3, 0.012, 0.014]} position={[0, 0.93, Z + 0.017]} color={tint(towel, 0.82)} shadow={false} />
      {v.on && <Glow position={[0, 1.0, 0.12]} color={C.heat} opacity={v.night ? 0.45 : 0.2} size={0.9} />}
    </group>
  )
}

/** Fireplace flames: x, height factor, phase, color; core: yellow core flames at the front. */
const FLAMES = [
  { x: -0.21, s: 0.75, ph: 0.3, c: '#ff6a1f', core: false },
  { x: -0.12, s: 1, ph: 1.7, c: '#ff8a2a', core: false },
  { x: -0.02, s: 1.2, ph: 3.1, c: '#ff7a24', core: false },
  { x: 0.08, s: 0.95, ph: 4.2, c: '#ff9a3a', core: false },
  { x: 0.18, s: 0.8, ph: 5.3, c: '#ff6a1f', core: false },
  { x: -0.08, s: 0.62, ph: 2.2, c: '#ffd76a', core: true },
  { x: 0.03, s: 0.72, ph: 0.9, c: '#ffd76a', core: true },
  { x: 0.13, s: 0.55, ph: 3.8, c: '#ffd76a', core: true },
]

/** Flickering flames: additive cones flicker in height, width and opacity; the warm halo in front flickers too. Mounted only when on. */
function Flames({ y, night }: { y: number; night: boolean }) {
  const group = useRef<THREE.Group>(null)
  const halo = useRef<THREE.Sprite>(null)
  const tex = useMemo(() => glowTexture(), [])
  useAmbient(true)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = clock.elapsedTime
    for (let i = 0; i < g.children.length; i++) {
      const f = FLAMES[i]
      const child = g.children[i] as THREE.Mesh
      const k = 0.78 + 0.16 * Math.sin(t * 7.3 + f.ph) + 0.09 * Math.sin(t * 13.1 + f.ph * 2.3)
      const w = f.s * (0.9 + 0.1 * Math.sin(t * 5.2 + f.ph))
      child.scale.set(w, f.s * k, w)
      child.position.y = y + 0.09 * f.s * k
      ;(child.material as THREE.MeshBasicMaterial).opacity = (f.core ? 0.75 : 0.55) * (0.8 + 0.2 * Math.sin(t * 9.7 + f.ph))
    }
    if (halo.current) (halo.current.material as THREE.SpriteMaterial).opacity = (night ? 0.7 : 0.32) * (0.85 + 0.15 * Math.sin(t * 6.1))
  })
  return (
    <group>
      <group ref={group}>
        {FLAMES.map((f, i) => (
          <mesh key={i} position={[f.x, y + 0.09 * f.s, f.core ? 0 : -0.025]} scale={f.s} geometry={cone(0.05, 0.18, 10)} renderOrder={f.core ? 11 : 10} userData={{ selectionAid: true }} raycast={noHit}>
            <meshBasicMaterial color={f.c} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      <sprite ref={halo} position={[0, y + 0.1, 0.22]} scale={[1.5, 1.5, 1.5]} renderOrder={10} raycast={noHit}>
        <spriteMaterial map={tex} color="#ff8a3d" transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  )
}

/**
 * Electric fireplace (on the floor, back to the wall, ~75 cm): hearth stone, two jambs, a lintel with a mantel shelf; a
 * dark firebox in the middle (back and side lining, ash floor) with a log pile and ember bed inside, glass at the front.
 * When on the embers glow orange, the flames flicker and a warm halo spreads into the room. Body color Item.body, shelf
 * color Item.top.
 */
export function Fireplace({ v }: P) {
  const body = bodyOf(v, C.white)
  const shelf = v.opts.top ?? '#dcb98c'
  const embers = useLitMaterial('#3a2a26', v.on, '#ff6a2a', 0.8, 1.6)
  const soot = '#1d1a1f'
  const log = '#6a4630'
  return (
    <group>
      <Box size={[1.2, 0.1, 0.28]} position={[0, 0.05, -0.01]} color={body} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.2, 0.61, 0.26]} position={[s * 0.5, 0.405, -0.02]} color={body} />
      ))}
      <Box size={[0.8, 0.19, 0.26]} position={[0, 0.615, -0.02]} color={body} />
      <Box size={[1.2, 0.04, 0.3]} position={[0, 0.73, 0]} color={shelf} radius={0.006} />
      {/* firebox: dark back and side lining, ash floor */}
      <Box size={[0.8, 0.42, 0.02]} position={[0, 0.31, -0.13]} color={soot} shadow={false} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.006, 0.42, 0.24]} position={[s * 0.397, 0.31, -0.01]} color={soot} shadow={false} />
      ))}
      <Box size={[0.8, 0.006, 0.24]} position={[0, 0.103, -0.01]} color={soot} shadow={false} />
      {/* ember bed and logs */}
      <Box size={[0.62, 0.02, 0.16]} position={[0, 0.113, -0.01]} material={embers} radius={0.006} shadow={false} />
      <Cyl r={0.03} h={0.52} position={[0, 0.136, -0.05]} rotation={[0, 0.12, Math.PI / 2]} color={log} segments={10} shadow={false} />
      <Cyl r={0.028} h={0.48} position={[0.02, 0.134, 0.03]} rotation={[0, -0.15, Math.PI / 2]} color={tint(log, 0.85)} segments={10} shadow={false} />
      <Cyl r={0.025} h={0.4} position={[-0.02, 0.185, -0.01]} rotation={[0, 0.6, Math.PI / 2]} color={tint(log, 1.1)} segments={10} shadow={false} />
      {v.on && <Flames y={0.15} night={v.night} />}
      <Box size={[0.8, 0.42, 0.006]} position={[0, 0.31, 0.105]} material={clear('#2a2230', 0.18, 0.05)} shadow={false} />
    </group>
  )
}

/**
 * AC outdoor unit (on the balcony floor, ~54 cm): a box on feet, a round fan grille at the front (+z) with blades behind it,
 * service cover and louvers on the right. While running (on, or any bound climate entity on) the blades spin. Body Item.body.
 */
export function AcOutdoor({ v }: P) {
  const body = bodyOf(v, '#eef0f5')
  const running = v.on || v.related.some((e) => domainOf(e.entity_id) === 'climate' && isActive(e))
  const steel = mat(C.steel, { metalness: 0.4, roughness: 0.4 })
  const H = 0.5
  const y0 = 0.035
  const Zc = -0.01
  const F = Zc + 0.135
  const fx = -0.12
  const fy = y0 + H / 2
  return (
    <group>
      {[-0.3, 0.3].map((x) => (
        <Box key={x} size={[0.07, y0, 0.29]} position={[x, y0 / 2, 0]} color={C.inkSoft} />
      ))}
      <Box size={[0.78, H, 0.27]} position={[0, fy, Zc]} color={body} radius={0.015} />
      {/* fan: dark bowl, spinning blades, grille rings and cross bars */}
      <Cyl r={0.19} h={0.008} position={[fx, fy, F + 0.002]} rotation={[Math.PI / 2, 0, 0]} color="#3a3f50" segments={40} shadow={false} />
      <group position={[fx, fy, F + 0.012]}>
        <Spin speed={running ? 9 : 0}>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation-z={(i * TAU) / 3}>
              <Box size={[0.07, 0.15, 0.004]} position={[0, 0.09, 0]} rotation-y={0.35} color="#8d93ae" shadow={false} />
            </group>
          ))}
          <Cyl r={0.03} h={0.02} rotation={[Math.PI / 2, 0, 0]} color="#5a5f70" segments={18} shadow={false} />
        </Spin>
      </group>
      {[0.185, 0.13, 0.075].map((r) => (
        <mesh key={r} position={[fx, fy, F + 0.024]} geometry={torus(r, 0.0035, 48)} material={steel} />
      ))}
      <Box size={[0.37, 0.006, 0.004]} position={[fx, fy, F + 0.024]} material={steel} shadow={false} />
      <Box size={[0.006, 0.37, 0.004]} position={[fx, fy, F + 0.024]} material={steel} shadow={false} />
      {/* service cover and louvers on the right */}
      <Box size={[0.2, 0.42, 0.004]} position={[0.27, fy, F + 0.002]} color={tint(body, 0.95)} shadow={false} />
      {Array.from({ length: 8 }, (_, i) => (
        <Box key={i} size={[0.17, 0.006, 0.006]} position={[0.27, fy - 0.16 + i * 0.045, F + 0.005]} color={C.steel} shadow={false} />
      ))}
    </group>
  )
}

/* ---------- media ---------- */

const SPEAKER_BLUE = '#36c4ff'

/** Nest Mini style fabric dome (lathe profile, 10 cm diameter, 4.5 cm tall), built once. */
let domeGeo: THREE.LatheGeometry | null = null
function nestDome() {
  if (domeGeo) return domeGeo
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.047, 0)]
  for (let i = 0; i <= 16; i++) {
    const a = ((i / 16) * Math.PI) / 2
    pts.push(new THREE.Vector2(Math.max(0, 0.05 * Math.cos(a)), 0.006 + 0.039 * Math.sin(a)))
  }
  domeGeo = new THREE.LatheGeometry(pts, 48)
  return domeGeo
}

/**
 * Smart speaker (on a desk). Item.variant 'echo' (default): fabric cylinder with a light ring and four buttons on top;
 * 'nest': fabric dome with four light dots on top; 'sonos': tall rounded box with a touch area and a light on top. While
 * playing (state 'playing') the ring / lights glow cyan-blue and music notes rise (not when muted). Fabric color Item.body.
 */
export function Speaker({ v }: P) {
  const variant = v.opts.variant ?? 'echo'
  const playing = v.state === 'playing'
  const muted = v.attrs.is_volume_muted === true
  const fabric = bodyOf(v, variant === 'nest' ? '#e6e3dc' : variant === 'sonos' ? '#24262d' : '#3a3d47')
  const led = useLitMaterial('#5a5f70', playing, SPEAKER_BLUE, 1, 2.6)
  const pad = useMemo(() => tint(fabric, 0.75), [fabric])
  const cloth = mat(fabric, { roughness: 0.95 })
  const H = variant === 'nest' ? 0.045 : variant === 'sonos' ? 0.16 : 0.146
  return (
    <group>
      {variant === 'nest' ? (
        <>
          <mesh geometry={nestDome()} material={cloth} castShadow receiveShadow />
          {[-1.5, -0.5, 0.5, 1.5].map((k) => (
            <Ball key={k} r={0.0028} position={[k * 0.011, 0.0445, 0.006]} material={led} shadow={false} />
          ))}
        </>
      ) : variant === 'sonos' ? (
        <>
          <Box size={[0.12, 0.16, 0.12]} position={[0, 0.08, 0]} material={cloth} radius={0.028} />
          <Box size={[0.06, 0.002, 0.045]} position={[0, 0.1605, -0.005]} color={pad} radius={0.001} shadow={false} />
          <Ball r={0.0028} position={[0, 0.1605, 0.03]} material={led} shadow={false} />
        </>
      ) : (
        <>
          <Cyl r={0.044} h={0.006} position={[0, 0.003, 0]} color="#1b1d23" segments={32} />
          <Cyl r={0.044} h={0.126} position={[0, 0.069, 0]} material={cloth} segments={40} />
          <Cyl r={0.044} h={0.014} position={[0, 0.139, 0]} color="#2a2c33" segments={40} />
          <mesh position={[0, 0.1462, 0]} rotation-x={-Math.PI / 2} geometry={torus(0.039, 0.0028, 48)} material={led} />
          {[0, 1, 2, 3].map((i) => (
            <Cyl key={i} r={0.004} h={0.002} position={[Math.cos((i * TAU) / 4 + TAU / 8) * 0.018, 0.1465, Math.sin((i * TAU) / 4 + TAU / 8) * 0.018]} color="#5a5f70" segments={10} shadow={false} />
          ))}
        </>
      )}
      <MusicNotes active={playing && !muted} y={H + 0.04} size={0.1} />
      {playing && v.night && <Glow position={[0, H + 0.01, 0]} color={SPEAKER_BLUE} opacity={0.4} size={0.25} />}
    </group>
  )
}

/**
 * Soundbar (on a TV unit, 88 cm, ~7 cm): long rounded body, fabric grille at the front, three buttons on top, an LED at
 * the bottom front (white when on). Small music notes rise while playing. Body color Item.body.
 */
export function Soundbar({ v }: P) {
  const playing = v.state === 'playing'
  const muted = v.attrs.is_volume_muted === true
  const body = bodyOf(v, '#24262d')
  const fabric = useMemo(() => `#${new THREE.Color(body).lerp(new THREE.Color('#808080'), 0.22).getHexString()}`, [body])
  const led = useLitMaterial('#5a5f70', v.on, '#e8f0ff', 1, 2.2)
  return (
    <group>
      <Box size={[0.88, 0.064, 0.094]} position={[0, 0.032, 0]} color={body} radius={0.014} />
      <Box size={[0.85, 0.042, 0.004]} position={[0, 0.034, 0.0465]} color={fabric} radius={0.002} shadow={false} />
      {[-0.03, 0, 0.03].map((x) => (
        <Cyl key={x} r={0.006} h={0.002} position={[x, 0.0645, 0]} color={tint(body, 1.6)} segments={12} shadow={false} />
      ))}
      <Box size={[0.03, 0.003, 0.002]} position={[0, 0.0085, 0.0475]} material={led} shadow={false} />
      <MusicNotes active={playing && !muted} y={0.09} size={0.07} />
    </group>
  )
}

/** Projector beam texture: bright at the lens, fading with distance. No gradient: written row by row straight into the data. */
let beamTex: THREE.DataTexture | null = null
function beamTexture() {
  if (beamTex) return beamTex
  const n = 64
  const data = new Uint8Array(4 * n * 4)
  for (let y = 0; y < n; y++) {
    const a = Math.round((0.15 + 0.85 * Math.pow(1 - (y + 0.5) / n, 1.4)) * 255)
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = a
    }
  }
  beamTex = new THREE.DataTexture(data, 4, n, THREE.RGBAFormat)
  beamTex.magFilter = THREE.LinearFilter
  beamTex.minFilter = THREE.LinearFilter
  beamTex.needsUpdate = true
  return beamTex
}

/**
 * Light beam: a 3 m long truncated pyramid with a rectangular section (close to 16:9), narrow at the lens, wide at the
 * end. Along local +z; a four sided cylinder rotated 45° and scaled to the aspect. Built once.
 */
const BEAM_L = 3
const beamGeo = () => geo('beam', () => new THREE.CylinderGeometry(0.8, 0.035, BEAM_L, 4, 1, true, Math.PI / 4))

/**
 * Projector (on the ceiling): ceiling plate, short downrod, clamp, body (2.31-2.41 m), lens at the front (+z), vents on the
 * side. When on the lens glows and a faint beam (3 m) widens forward and slightly down. Body Item.body.
 */
export function Projector({ v }: P) {
  const body = bodyOf(v, C.white)
  const lens = useLitMaterial('#2a3050', v.on, '#dfe8ff', 1, 2.2)
  const status = useLitMaterial('#8d93ae', v.on, '#4f9dff', 1, 2.4)
  const beam = useMemo(
    () => new THREE.MeshBasicMaterial({ map: beamTexture(), color: '#dfe8ff', transparent: true, opacity: v.night ? 0.16 : 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
    [v.night],
  )
  useEffect(() => () => beam.dispose(), [beam])
  const Y = 2.36
  const lx = 0.07
  return (
    <group>
      {/* ceiling mount */}
      <Cyl r={0.055} h={0.012} position={[0, WALL_H - 0.006, 0]} color={body} segments={24} shadow={false} />
      <Cyl r={0.012} h={0.17} position={[0, WALL_H - 0.097, 0]} color={C.steel} segments={10} shadow={false} />
      <Box size={[0.14, 0.012, 0.1]} position={[0, Y + 0.056, 0]} color={C.steel} shadow={false} />
      {/* body, lens, vents, IR receiver, status light */}
      <Box size={[0.32, 0.1, 0.26]} position={[0, Y, 0]} color={body} radius={0.02} />
      <Cyl r={0.04} h={0.03} position={[lx, Y, 0.145]} rotation={[Math.PI / 2, 0, 0]} color={C.ink} segments={28} shadow={false} />
      <Cyl r={0.03} h={0.004} position={[lx, Y, 0.161]} rotation={[Math.PI / 2, 0, 0]} material={lens} segments={28} shadow={false} />
      {[-0.03, -0.01, 0.01, 0.03].map((y) => (
        <Box key={y} size={[0.004, 0.008, 0.16]} position={[0.16, Y + y, -0.02]} color="#3a3d47" shadow={false} />
      ))}
      <Box size={[0.04, 0.02, 0.003]} position={[-0.08, Y, 0.1305]} color="#2a2d38" shadow={false} />
      <Ball r={0.004} position={[-0.11, Y + 0.05, 0.09]} material={status} shadow={false} />
      {v.on && (
        <group position={[lx, Y, 0.163]} rotation-x={0.15}>
          <mesh position={[0, 0, BEAM_L / 2]} rotation-x={Math.PI / 2} scale={[1.6, 1, 0.9]} geometry={beamGeo()} material={beam} renderOrder={9} userData={{ selectionAid: true }} raycast={noHit} />
          <Glow position={[0, 0, 0.02]} color="#dfe8ff" opacity={v.night ? 0.8 : 0.45} size={0.3} />
        </group>
      )}
    </group>
  )
}

/**
 * Projector screen (on the wall; housing 2.41-2.49 m, width Item.len, default 2 m). The screen drops from the housing: by
 * the opening percentage when bound to a cover motor (current_position / 100; 1 fully down, 0 rolled up), otherwise fully
 * down when on and rolled up when off. Drops at most 1.3 m (bottom bar down to 1.085 m); moves smoothly and requests no
 * frames once settled. Black borders on both sides. Housing color Item.body.
 */
export function ProjectorScreen({ v }: P) {
  const len = v.opts.len ?? 2
  const body = bodyOf(v, C.white)
  const target = v.domain === 'cover' ? Math.min(1, Math.max(0, (num(v.attrs.current_position) ?? (v.on ? 100 : 0)) / 100)) : v.on ? 1 : 0
  const cloth = useRef<THREE.Group>(null)
  const bar = useRef<THREE.Group>(null)
  const DROP = 1.3
  const TOP = 2.41
  useSettle(target, (f) => {
    const h = f * DROP
    if (cloth.current) {
      cloth.current.visible = h > 0.004
      cloth.current.scale.y = Math.max(0.001, h)
    }
    if (bar.current) bar.current.position.y = TOP - h
  })
  const W = len - 0.1
  return (
    <group>
      <Box size={[len, 0.08, 0.08]} position={[0, 2.45, -0.01]} color={body} radius={0.02} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.025, 0.085, 0.085]} position={[s * (len / 2 - 0.0125), 2.45, -0.01]} color={C.inkSoft} shadow={false} />
      ))}
      {/* screen: top edge under the housing; drops with the group's vertical scale (1 unit = 1 m) */}
      <group ref={cloth} position={[0, TOP, 0]} visible={false}>
        <Box size={[W, 1, 0.003]} position={[0, -0.5, -0.001]} color="#1d1f26" shadow={false} />
        <Box size={[W - 0.08, 1, 0.003]} position={[0, -0.5, 0.001]} color="#f6f7fb" shadow={false} />
      </group>
      <group ref={bar} position={[0, TOP, 0]}>
        <Box size={[W + 0.02, 0.025, 0.02]} position={[0, -0.0125, 0]} color={C.inkSoft} radius={0.006} shadow={false} />
      </group>
    </group>
  )
}

/** Whether the computer is on: main entity on, or a related Ping sensor (binary_sensor, connectivity) 'on'. */
const computerOn = (v: Visual) => v.on || v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && deviceClass(e) === 'connectivity' && e.state === 'on')

const RGB = ['#ff3df0', '#3dd8ff', '#8f6cff']

/** Case fan (12 cm): frame ring (RGB, lit when on), hub and spinning blades. Front at +z. */
function CaseFan({ ring, speed }: { ring: THREE.Material; speed: number }) {
  return (
    <group>
      <mesh geometry={torus(0.054, 0.006, 32)} material={ring} />
      <Spin speed={speed}>
        {[0, 1, 2, 3, 4].map((i) => (
          <group key={i} rotation-z={(i * TAU) / 5}>
            <Box size={[0.026, 0.04, 0.003]} position={[0, 0.03, 0]} rotation-y={0.4} color="#2a2d38" shadow={false} />
          </group>
        ))}
        <Cyl r={0.016} h={0.014} rotation={[Math.PI / 2, 0, 0]} color="#1b1d23" segments={16} shadow={false} />
      </Spin>
    </group>
  )
}

/**
 * Desktop tower (20 × 45 × 45 cm): glass side panel at +x (the default scene view looks from +x/+z, so the RGB insides
 * show); inside: motherboard, CPU cooler, graphics card, PSU shroud, fans.
 */
function Tower({ v, on }: P & { on: boolean }) {
  const body = bodyOf(v, '#1f2229')
  const r0 = useLitMaterial('#3a3d47', on, RGB[0], 1, 2.4)
  const r1 = useLitMaterial('#3a3d47', on, RGB[1], 1, 2.4)
  const r2 = useLitMaterial('#3a3d47', on, RGB[2], 1, 2.4)
  const power = useLitMaterial('#8d93ae', on, '#ffffff', 1, 2.4)
  const panel = mat(body, { roughness: 0.5 })
  const speed = on ? 14 : 0
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.03, 0.015, 0.05]} position={[sx * 0.07, 0.0075, sz * 0.17]} color="#111318" shadow={false} />))}
      {/* case: bottom, top, left side, back, front; right side (+x) glass */}
      <Box size={[0.2, 0.008, 0.45]} position={[0, 0.019, 0]} material={panel} />
      <Box size={[0.2, 0.008, 0.45]} position={[0, 0.461, 0]} material={panel} />
      <Box size={[0.008, 0.45, 0.45]} position={[-0.096, 0.24, 0]} material={panel} />
      <Box size={[0.2, 0.45, 0.008]} position={[0, 0.24, -0.221]} material={panel} />
      <Box size={[0.2, 0.45, 0.012]} position={[0, 0.24, 0.219]} material={panel} radius={0.004} />
      <Box size={[0.006, 0.38, 0.004]} position={[0.07, 0.24, 0.2265]} material={r1} shadow={false} />
      <Cyl r={0.008} h={0.004} position={[-0.06, 0.43, 0.227]} rotation={[Math.PI / 2, 0, 0]} material={power} segments={14} shadow={false} />
      <Box size={[0.004, 0.434, 0.434]} position={[0.098, 0.24, 0]} material={clear('#2a3046', 0.25)} shadow={false} />
      {/* inside: motherboard, cooler (fan faces the glass), graphics card (RGB strip), PSU shroud */}
      <Box size={[0.004, 0.3, 0.3]} position={[-0.09, 0.29, -0.04]} color="#1c2129" shadow={false} />
      <Box size={[0.04, 0.11, 0.11]} position={[-0.065, 0.33, -0.06]} color={C.steel} shadow={false} />
      <group position={[-0.04, 0.33, -0.06]} rotation-y={Math.PI / 2}>
        <CaseFan ring={r1} speed={speed} />
      </group>
      <Box size={[0.15, 0.04, 0.26]} position={[-0.01, 0.19, 0]} color="#2b2f38" shadow={false} />
      <Box size={[0.002, 0.008, 0.2]} position={[0.066, 0.2, 0]} material={r2} shadow={false} />
      <Box size={[0.19, 0.09, 0.44]} position={[0, 0.068, 0]} material={panel} shadow={false} />
      {/* two fans at the front, one at the back */}
      {[0.19, 0.32].map((y, i) => (
        <group key={y} position={[0.01, y, 0.19]}>
          <CaseFan ring={i ? r1 : r0} speed={speed} />
        </group>
      ))}
      <group position={[0.01, 0.37, -0.19]}>
        <CaseFan ring={r2} speed={speed} />
      </group>
      {on && v.night && <Glow position={[0.18, 0.28, 0]} color="#b05cff" opacity={0.35} size={0.7} />}
    </group>
  )
}

/** Mac mini (20 × 20 × 5 cm): square aluminum body, dark base ring below, white status light at the front. */
function MacMini({ v, on }: P & { on: boolean }) {
  const led = useLitMaterial('#8d93ae', on, '#ffffff', 1, 2.4)
  return (
    <group>
      <Cyl r={0.075} h={0.006} position={[0, 0.003, 0]} color="#2a2c33" segments={32} shadow={false} />
      <Box size={[0.2, 0.044, 0.2]} position={[0, 0.028, 0]} material={mat(bodyOf(v, '#d6d9e0'), { metalness: 0.55, roughness: 0.32 })} radius={0.02} />
      <mesh position={[0, 0.0502, 0]} rotation-x={-Math.PI / 2} geometry={disc(0.012, 24)} material={mat('#b9bcc6', { metalness: 0.5, roughness: 0.3 })} />
      <Ball r={0.0022} position={[0.085, 0.02, 0.1002]} material={led} shadow={false} />
      {on && v.night && <Glow position={[0.085, 0.02, 0.12]} color="#ffffff" opacity={0.3} size={0.08} />}
    </group>
  )
}

/** Laptop keyboard: the texture of decor Keyboard, one shared material. */
let kbMat: THREE.MeshStandardMaterial | null = null
const keyboardMaterial = () => (kbMat ??= new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.6 }))

/** Open laptop (32 × 22 cm): aluminum base, keyboard, trackpad; lid open ~105°, screen glows when on. */
function Laptop({ v, on }: P & { on: boolean }) {
  const screen = useLitMaterial(C.screenOff, on, '#4a63e6', 0.7, 1)
  const alu = mat(bodyOf(v, '#c9ccd4'), { metalness: 0.5, roughness: 0.35 })
  return (
    <group>
      <Box size={[0.32, 0.014, 0.22]} position={[0, 0.007, 0]} material={alu} radius={0.005} />
      <mesh position={[0, 0.0142, -0.025]} rotation-x={-Math.PI / 2} geometry={plane(0.27, 0.1)} material={keyboardMaterial()} />
      <Box size={[0.1, 0.001, 0.065]} position={[0, 0.0145, 0.065]} color="#b4b8c2" shadow={false} />
      <group position={[0, 0.014, -0.108]} rotation-x={-0.26}>
        <Box size={[0.32, 0.21, 0.006]} position={[0, 0.105, -0.003]} material={alu} radius={0.004} />
        <Box size={[0.31, 0.2, 0.001]} position={[0, 0.105, 0.0005]} color="#111318" shadow={false} />
        <Box size={[0.29, 0.18, 0.001]} position={[0, 0.108, 0.0012]} material={screen} shadow={false} />
      </group>
      {on && v.night && <Glow position={[0, 0.12, 0.05]} color="#4a63e6" opacity={0.3} size={0.5} />}
    </group>
  )
}

/** All in one (iMac style): thin display body with a colored chin, white bezel, stand; screen glows when on. */
function IMac({ v, on }: P & { on: boolean }) {
  const screen = useLitMaterial(C.screenOff, on, '#4a63e6', 0.7, 1)
  const shell = mat(bodyOf(v, '#c9d6e8'), { roughness: 0.4, metalness: 0.2 })
  return (
    <group>
      <Box size={[0.15, 0.006, 0.13]} position={[0, 0.003, -0.03]} material={shell} radius={0.003} />
      <Box size={[0.13, 0.22, 0.008]} position={[0, 0.115, -0.05]} material={shell} radius={0.003} />
      <Box size={[0.54, 0.42, 0.012]} position={[0, 0.28, -0.04]} material={shell} radius={0.01} />
      <Box size={[0.53, 0.33, 0.002]} position={[0, 0.325, -0.0335]} color="#f4f5f8" shadow={false} />
      <Box size={[0.5, 0.29, 0.002]} position={[0, 0.33, -0.032]} material={screen} shadow={false} />
      {on && v.night && <Glow position={[0, 0.33, 0.06]} color="#4a63e6" opacity={0.35} size={0.8} />}
    </group>
  )
}

/**
 * Computer (on a desk or the floor). Item.variant 'tower' (default): case with a glass side panel, RGB fans light up and
 * spin when on; 'mini': Mac mini, white status light when on; 'laptop': open laptop, screen glows when on; 'imac': all in
 * one, screen glows when on. On: main entity on, or a related Ping sensor (connectivity) 'on'. Body color Item.body.
 */
export function Computer({ v }: P) {
  const on = computerOn(v)
  const variant = v.opts.variant ?? 'tower'
  if (variant === 'mini') return <MacMini v={v} on={on} />
  if (variant === 'laptop') return <Laptop v={v} on={on} />
  if (variant === 'imac') return <IMac v={v} on={on} />
  return <Tower v={v} on={on} />
}

/** Wall tablet screen: dark background, analog clock, temperature, weather, light tiles, energy chart (drawn once). */
let dashTex: THREE.CanvasTexture | null = null
function dashboardTexture() {
  if (dashTex) return dashTex
  const W = 512
  const H = 360
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#10152e'
  g.fillRect(0, 0, W, H)
  const tile = (x: number, y: number, w: number, h: number, fill: string) => {
    g.fillStyle = fill
    g.beginPath()
    g.roundRect(x, y, w, h, 16)
    g.fill()
  }
  const TILE = '#1d2452'
  // clock: face, ticks, hour and minute hands (10:10)
  tile(16, 16, 180, 160, TILE)
  const cx = 106
  const cy = 96
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  g.lineCap = 'round'
  g.lineWidth = 4
  g.beginPath()
  g.arc(cx, cy, 58, 0, TAU)
  g.stroke()
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    g.beginPath()
    g.moveTo(cx + Math.cos(a) * 48, cy + Math.sin(a) * 48)
    g.lineTo(cx + Math.cos(a) * 53, cy + Math.sin(a) * 53)
    g.stroke()
  }
  g.lineWidth = 6
  g.beginPath()
  g.moveTo(cx, cy)
  g.lineTo(cx + Math.cos(-Math.PI / 2 - (TAU * 10.17) / 12) * 30, cy + Math.sin(-Math.PI / 2 - (TAU * 10.17) / 12) * 30)
  g.stroke()
  g.lineWidth = 4
  g.beginPath()
  g.moveTo(cx, cy)
  g.lineTo(cx + Math.cos(-Math.PI / 2 + (TAU * 10) / 60) * 44, cy + Math.sin(-Math.PI / 2 + (TAU * 10) / 60) * 44)
  g.stroke()
  // temperature and humidity
  tile(208, 16, 140, 160, TILE)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = C.heat
  g.font = `600 60px ${MONO}`
  g.fillText(`${formatNumber(22)}°`, 278, 88)
  g.fillStyle = 'rgba(255, 255, 255, 0.55)'
  g.font = `500 24px ${MONO}`
  // percent sign placement follows the language (46%, %46, 46 %)
  g.fillText(new Intl.NumberFormat(currentLang(), { style: 'percent' }).format(0.46), 278, 142)
  // weather: sun and cloud
  tile(360, 16, 136, 160, TILE)
  g.fillStyle = C.sun
  g.beginPath()
  g.arc(412, 80, 26, 0, TAU)
  g.fill()
  g.fillStyle = '#dfe4ff'
  g.beginPath()
  g.arc(440, 110, 22, 0, TAU)
  g.arc(462, 116, 18, 0, TAU)
  g.arc(420, 120, 16, 0, TAU)
  g.fill()
  // light tiles: the ones that are on are yellow
  ;[true, false, true, false].forEach((lit, i) => {
    const x = 16 + i * 122
    tile(x, 190, 112, 76, lit ? '#39408f' : TILE)
    g.fillStyle = lit ? C.sun : 'rgba(255, 255, 255, 0.3)'
    g.beginPath()
    g.arc(x + 30, 228, 14, 0, TAU)
    g.fill()
    g.fillStyle = lit ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.3)'
    g.fillRect(x + 54, 218, 42, 6)
    g.fillRect(x + 54, 232, 28, 6)
  })
  // energy chart
  tile(16, 278, 480, 66, TILE)
  g.strokeStyle = C.mint
  g.lineWidth = 4
  g.lineJoin = 'round'
  g.beginPath()
  for (let i = 0; i <= 24; i++) {
    const x = 32 + i * 18.6
    const y = 326 - (Math.sin(i * 0.7) * 0.5 + 0.5) * 24 - (i % 5 === 0 ? 6 : 0)
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
  dashTex = new THREE.CanvasTexture(c)
  dashTex.colorSpace = THREE.SRGBColorSpace
  dashTex.anisotropy = 8
  return dashTex
}

/**
 * Wall tablet (on the wall; 1.30-1.52 m): thin bezel tablet showing a small home dashboard (clock, temperature, weather,
 * lights, energy chart), front camera on top. Bright when on; dim but readable when off or unbound, dark when unavailable.
 * Bezel color Item.body.
 */
export function WallPanel({ v }: P) {
  const frame = bodyOf(v, C.ink)
  const tex = dashboardTexture()
  const screen = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, color: v.unavailable ? '#2a2e40' : v.on ? '#ffffff' : '#62677e', toneMapped: false }), [tex, v.on, v.unavailable])
  useEffect(() => () => screen.dispose(), [screen])
  const Y = 1.41
  return (
    <group>
      <Box size={[0.3, 0.22, 0.012]} position={[0, Y, -0.009]} color={frame} radius={0.01} />
      <mesh position={[0, Y, -0.0028]} geometry={plane(0.27, 0.19)} material={screen} />
      <Ball r={0.002} position={[0, Y + 0.101, -0.0028]} color="#2a2e40" shadow={false} />
      {v.on && v.night && <Glow position={[0, Y, 0.06]} color="#7f95ff" opacity={0.25} size={0.5} />}
    </group>
  )
}

/* ---------- security ---------- */

const RING_BLUE = '#3d8bff'

/**
 * Video doorbell (on the wall; 1.30-1.45 m): slim dark body, camera glass and lens on top, round button with a light ring
 * below. While bound the ring is faint white; while ringing (on) it glows blue and pulses with a blue halo in front. Body Item.body.
 */
export function Doorbell({ v }: P) {
  const body = bodyOf(v, '#2a2c33')
  const live = v.bound && !v.unavailable
  const ringing = v.on
  const ring = useLitMaterial('#8d93ae', live || ringing, ringing ? RING_BLUE : '#cfe0ff', ringing ? 1 : 0.25, 2.4)
  const pulse = usePulse(ringing, 0.35 + 2.4, 6)
  const Y = 1.375
  return (
    <group>
      <Box size={[0.046, 0.15, 0.026]} position={[0, Y, -0.007]} color={body} radius={0.012} />
      <Box size={[0.036, 0.05, 0.002]} position={[0, Y + 0.042, 0.006]} color="#111318" radius={0.001} shadow={false} />
      <Cyl r={0.011} h={0.004} position={[0, Y + 0.045, 0.007]} rotation={[Math.PI / 2, 0, 0]} color="#05060a" segments={20} shadow={false} />
      <Ball r={0.004} position={[0, Y + 0.045, 0.009]} color="#33457a" shadow={false} />
      <Cyl r={0.013} h={0.004} position={[0, Y - 0.04, 0.007]} rotation={[Math.PI / 2, 0, 0]} color="#d9dce3" segments={24} shadow={false} />
      <mesh ref={pulse} position={[0, Y - 0.04, 0.0075]} geometry={torus(0.0155, 0.0022, 32)} material={ring} />
      {ringing && <PulseGlow position={[0, Y - 0.04, 0.03]} color={RING_BLUE} size={0.3} opacity={v.night ? 0.9 : 0.55} speed={6} />}
    </group>
  )
}

/** Label ring color by detector type: smoke gray, carbon monoxide orange, gas blue. */
const DETECTOR_RING: Record<string, string> = { smoke: '#c3c8dc', co: C.warn, gas: '#5d76ff' }

/**
 * Smoke / gas detector (on the ceiling): white disc, vent ring on the side, flat dome below, test button and a label ring
 * colored by type (Item.variant 'smoke' default, 'co', 'gas'). When detecting (on) a red light and a red halo pulse; while
 * bound and calm a small steady green light. Body color Item.body.
 */
export function SmokeDetector({ v }: P) {
  const kind = v.opts.variant ?? 'smoke'
  const body = bodyOf(v, C.white)
  const alarm = v.on
  const led = useLitMaterial('#8d93ae', alarm || (v.bound && !v.unavailable), alarm ? C.alarm : C.ok, 1, 2.5)
  const pulse = usePulse(alarm, 0.35 + 2.5, 7, 0.05)
  const T = WALL_H
  return (
    <group>
      <Cyl r={0.062} rTop={0.06} h={0.012} position={[0, T - 0.006, 0]} color={body} segments={40} shadow={false} />
      <Cyl r={0.058} rTop={0.06} h={0.03} position={[0, T - 0.027, 0]} color={body} segments={40} shadow={false} />
      <mesh position={[0, T - 0.027, 0]} rotation-x={Math.PI / 2} geometry={torus(0.0595, 0.002, 48)} material={mat('#c9cdda')} />
      <Ball r={0.056} detail={3} position={[0, T - 0.042, 0]} scale={[1, 0.14, 1]} color={body} shadow={false} />
      <mesh position={[0, T - 0.0495, 0]} rotation-x={Math.PI / 2} geometry={torus(0.032, 0.0025, 40)} material={mat(DETECTOR_RING[kind] ?? DETECTOR_RING.smoke)} />
      <Cyl r={0.014} h={0.004} position={[0, T - 0.051, 0]} color={C.offWhite} segments={24} shadow={false} />
      {kind === 'gas' && <Box size={[0.03, 0.002, 0.006]} position={[0, T - 0.048, -0.022]} color="#5d76ff" shadow={false} />}
      <mesh ref={pulse} position={[0.03, T - 0.048, 0.03]} geometry={sphere(0.004, 12)} material={led} />
      {alarm && <PulseGlow position={[0, T - 0.12, 0]} color={C.alarm} size={0.9} opacity={v.night ? 0.9 : 0.6} speed={7} />}
    </group>
  )
}

/** Puddle: flat shape with an irregular edge (seeded, the same for every sensor), ~34 cm across. Built once. */
let puddleGeo: THREE.ShapeGeometry | null = null
function puddle() {
  if (puddleGeo) return puddleGeo
  const r = rng(7)
  const n = 14
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU
    const k = 0.17 * (0.72 + r() * 0.42)
    return new THREE.Vector2(Math.cos(a) * k, Math.sin(a) * k)
  })
  const s = new THREE.Shape()
  s.moveTo(pts[0].x, pts[0].y)
  s.splineThru([...pts.slice(1), pts[0]])
  puddleGeo = new THREE.ShapeGeometry(s, 24)
  return puddleGeo
}

/**
 * Leak sensor (on the floor, ~2 cm): small white disc with a logo plate and light on top. When wet (on) the light glows
 * blue, a blue puddle appears around it and blue ripples spread on the floor. Body color Item.body.
 */
export function LeakSensor({ v }: P) {
  const body = bodyOf(v, C.white)
  const wet = v.on
  const led = useLitMaterial('#8d93ae', wet, '#4f9dff', 1, 2.5)
  return (
    <group>
      <Cyl r={0.033} rTop={0.03} h={0.018} position={[0, 0.009, 0]} color={body} segments={32} />
      <Cyl r={0.022} h={0.002} position={[0, 0.0185, 0]} color={C.offWhite} segments={24} shadow={false} />
      <Ball r={0.003} position={[0, 0.0185, 0.018]} material={led} shadow={false} />
      {wet && (
        <mesh position={[0, 0.0015, 0]} rotation-x={-Math.PI / 2} geometry={puddle()} renderOrder={4} userData={{ selectionAid: true }} raycast={noHit}>
          <meshStandardMaterial color="#5aa8ff" transparent opacity={0.42} roughness={0.05} metalness={0.1} depthWrite={false} />
        </mesh>
      )}
      <group scale={0.22}>
        <Ripple active={wet} color="#4f9dff" at={[0, 0.012, 0]} />
      </group>
    </group>
  )
}

/**
 * Siren (on the wall; 2.10-2.345 m): white box, speaker slots at the front, red dome on top. While sounding (on) the dome
 * flashes red (fast pulse) with a red halo pulsing in front. Body color Item.body.
 */
export function Siren({ v }: P) {
  const body = bodyOf(v, C.white)
  const on = v.on
  const dome = useLitMaterial('#b8343c', on, C.alarm, 1, 2.6)
  const pulse = usePulse(on, 0.35 + 2.6, 10, 0.05)
  return (
    <group>
      <Box size={[0.16, 0.2, 0.06]} position={[0, 2.2, -0.02]} color={body} radius={0.015} />
      {[2.14, 2.17, 2.2, 2.23].map((y) => (
        <Box key={y} size={[0.09, 0.006, 0.003]} position={[0, y, 0.0105]} color={C.steel} shadow={false} />
      ))}
      <mesh ref={pulse} position={[0, 2.3, 0]} scale={[1, 0.9, 1]} geometry={sphere(0.05, 28)} material={dome} castShadow />
      {on && <PulseGlow position={[0, 2.3, 0.08]} color={C.alarm} size={1.3} opacity={v.night ? 0.95 : 0.6} speed={10} />}
    </group>
  )
}

/* ---------- sensors ---------- */

/** Air quality thresholds (good, fair) per device_class: CO₂ ppm, PM2.5 µg/m³, AQI. */
const AQ_LIMITS: Record<string, [number, number]> = { carbon_dioxide: [800, 1200], pm25: [12, 35], aqi: [50, 100] }

/** Air quality color: the main sensor's value if it has thresholds, else the first related sensor with thresholds; null (neutral) without a value. */
function airColor(v: Visual) {
  let lim = v.domain === 'sensor' ? AQ_LIMITS[String(v.attrs.device_class ?? '')] : undefined
  let n = lim ? num(v.state) : null
  if (n == null) {
    const e = v.related.find((x) => domainOf(x.entity_id) === 'sensor' && AQ_LIMITS[deviceClass(x)] && num(x.state) != null)
    if (e) {
      lim = AQ_LIMITS[deviceClass(e)]
      n = num(e.state)
    }
  }
  return n != null && lim ? grade(n, lim[0], lim[1]) : null
}

/**
 * Air quality sensor (on a desk, ~12 cm): small white tower, vent rings, dark cap with a light ring on top.
 * The ring follows the value: CO₂ < 800 green, < 1200 orange, above that red; PM2.5 12 / 35; AQI 50 / 100 (main or related
 * sensor). Neutral without a value or while unbound. Body color Item.body.
 */
export function AirQuality({ v }: P) {
  const body = bodyOf(v, C.white)
  const live = v.bound && !v.unavailable
  const color = airColor(v)
  const ring = useLitMaterial('#c9cdda', live, color ?? '#dfe6ff', color ? 1 : 0.35, 2.2)
  const vent = mat('#c9cdda')
  return (
    <group>
      <Cyl r={0.04} rTop={0.036} h={0.1} position={[0, 0.05, 0]} color={body} segments={32} />
      {[0.02, 0.03, 0.04].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2} geometry={torus(0.0395, 0.0012, 32)} material={vent} />
      ))}
      <mesh position={[0, 0.1, 0]} rotation-x={Math.PI / 2} geometry={torus(0.0365, 0.0035, 36)} material={ring} />
      <Cyl r={0.036} rTop={0.032} h={0.012} position={[0, 0.106, 0]} color="#2a2d38" segments={32} shadow={false} />
      {live && color && v.night && <Glow position={[0, 0.11, 0]} color={color} opacity={0.4} size={0.25} />}
    </group>
  )
}

/** Smart button (on a desk or wall, ~2 cm): round base, push cap, a soft light ring between them (lit when on). */
export function SmartButton({ v }: P) {
  const body = bodyOf(v, C.white)
  const led = useLitMaterial('#c9cdda', v.on, C.brandLight, 1, 2.4)
  return (
    <group>
      <Cyl r={0.028} rTop={0.026} h={0.013} position={[0, 0.0065, 0]} color={body} segments={32} />
      <Cyl r={0.021} rTop={0.02} h={0.006} position={[0, 0.016, 0]} color={C.offWhite} segments={32} shadow={false} />
      <mesh position={[0, 0.0132, 0]} rotation-x={Math.PI / 2} geometry={torus(0.0235, 0.0016, 36)} material={led} />
      {v.on && <Glow position={[0, 0.03, 0]} color={C.brandLight} opacity={v.night ? 0.6 : 0.3} size={0.15} />}
    </group>
  )
}

/* ---------- devices ---------- */

const BLINK_PEAK = 0.35 + 2.4

/**
 * Modem / router (on a desk, ~19 cm with antennas): flat body, vent lines on top, five lights at the front, three antennas at
 * the back (the side ones tilted out). On, or bound and available: green lights; two steady, three blinking slowly (slow
 * ambient animation). Body color Item.body.
 */
export function Router({ v }: P) {
  const active = v.on || (v.bound && !v.unavailable)
  const body = bodyOf(v, '#2a2c33')
  const power = useLitMaterial('#5a5f70', active, C.ok, 1, 2.4)
  const wifi = useLitMaterial('#5a5f70', active, C.ok, 1, 2.4)
  const lan = useLitMaterial('#5a5f70', active, C.ok, 1, 2.4)
  const blink = useBlink(active, BLINK_PEAK)
  // [material, phase]: power steady, Wi-Fi and LAN blink in different phases
  const leds: [THREE.Material, number][] = [
    [power, 0],
    [wifi, 1],
    [lan, 2],
    [wifi, 1],
    [power, 0],
  ]
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.008} h={0.005} position={[sx * 0.1, 0.0025, sz * 0.05]} color="#15161b" segments={10} shadow={false} />))}
      <Box size={[0.24, 0.035, 0.14]} position={[0, 0.0225, 0]} color={body} radius={0.01} />
      {[-0.04, -0.02, 0, 0.02, 0.04].map((z) => (
        <Box key={z} size={[0.16, 0.001, 0.006]} position={[0, 0.0405, z]} color="#15161b" shadow={false} />
      ))}
      <group ref={blink}>
        {leds.map(([m, ph], i) => (
          <Box key={i} size={[0.008, 0.004, 0.002]} position={[-0.06 + i * 0.03, 0.024, 0.0705]} material={m} userData={{ blink: ph }} shadow={false} />
        ))}
      </group>
      {[-0.09, 0, 0.09].map((x) => (
        <group key={x} position={[x, 0.04, -0.062]} rotation-z={-Math.sign(x) * 0.12}>
          <Cyl r={0.009} h={0.02} rotation={[0, 0, Math.PI / 2]} color={body} segments={12} shadow={false} />
          <Box size={[0.016, 0.145, 0.008]} position={[0, 0.0775, 0]} color={body} radius={0.004} />
        </group>
      ))}
    </group>
  )
}

/**
 * NAS (on a desk, ~21 cm): dark box, four drive bays at the front (a light on each), power button and status light on the
 * left. When on the lights are blue; the drive lights blink slowly. Body color Item.body.
 */
export function Nas({ v }: P) {
  const body = bodyOf(v, '#2a2c33')
  const power = useLitMaterial('#5a5f70', v.on, '#4f9dff', 1, 2.4)
  const a = useLitMaterial('#5a5f70', v.on, '#4f9dff', 1, 2.4)
  const b = useLitMaterial('#5a5f70', v.on, '#4f9dff', 1, 2.4)
  const blink = useBlink(v.on, BLINK_PEAK)
  const F = 0.119
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.012} h={0.005} position={[sx * 0.065, 0.0025, sz * 0.09]} color="#15161b" segments={12} shadow={false} />))}
      <Box size={[0.17, 0.2, 0.23]} position={[0, 0.105, 0]} color={body} radius={0.01} />
      <Box size={[0.155, 0.18, 0.004]} position={[0, 0.105, 0.116]} color="#15161b" radius={0.003} shadow={false} />
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[-0.038 + i * 0.033, 0.1, F]}>
          <Box size={[0.03, 0.155, 0.006]} color="#3a3d47" radius={0.002} shadow={false} />
          <Box size={[0.016, 0.004, 0.002]} position={[0, -0.06, 0.004]} color="#15161b" shadow={false} />
        </group>
      ))}
      {/* drive lights (above each bay) and status light: blink in two phases */}
      <group ref={blink}>
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} size={[0.006, 0.004, 0.002]} position={[-0.038 + i * 0.033, 0.17, F + 0.004]} material={i % 2 ? a : b} userData={{ blink: i % 2 ? 1 : 2 }} shadow={false} />
        ))}
        <Box size={[0.006, 0.004, 0.002]} position={[-0.067, 0.15, F + 0.0005]} material={a} userData={{ blink: 1 }} shadow={false} />
      </group>
      <Cyl r={0.006} h={0.004} position={[-0.067, 0.17, 0.12]} rotation={[Math.PI / 2, 0, 0]} material={power} segments={14} shadow={false} />
    </group>
  )
}

/** Whether the printer is printing: state 'printing' (may be a sensor) or a non-sensor main entity that is on. */
const isPrinting = (v: Visual) => /^printing$/i.test(v.state) || (v.on && v.domain !== 'sensor')

/** Inkjet / laser printer (~19 cm): body, scanner lid, output slot and tray, control panel; paper comes out while printing. */
function PaperPrinter({ v, printing }: P & { printing: boolean }) {
  const body = bodyOf(v, C.white)
  const awake = v.on || printing
  const screen = useLitMaterial(C.screenOff, awake, '#7fb2ff', 0.8, 1.2)
  const led = useLitMaterial('#8d93ae', awake, C.ok, 1, 2.4)
  const sheet = useRef<THREE.Group>(null)
  useAmbient(printing)
  useFrame(({ clock }) => {
    const s = sheet.current
    if (!printing || !s) return
    s.position.z = -0.13 + ((clock.elapsedTime * 0.28) % 1) * 0.2
  })
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.03, 0.006, 0.03]} position={[sx * 0.17, 0.003, -0.03 + sz * 0.11]} color={C.inkSoft} shadow={false} />))}
      <Box size={[0.42, 0.15, 0.28]} position={[0, 0.081, -0.03]} color={body} radius={0.015} />
      <Box size={[0.42, 0.03, 0.28]} position={[0, 0.171, -0.03]} color={C.offWhite} radius={0.01} />
      {/* output slot, output tray and its lip, cassette line */}
      <Box size={[0.3, 0.012, 0.006]} position={[0, 0.08, 0.109]} color="#2a2d38" shadow={false} />
      <Box size={[0.28, 0.006, 0.065]} position={[0, 0.058, 0.142]} color={body} shadow={false} />
      <Box size={[0.28, 0.012, 0.004]} position={[0, 0.064, 0.173]} color={body} shadow={false} />
      <Box size={[0.38, 0.003, 0.004]} position={[0, 0.035, 0.111]} color={C.steel} shadow={false} />
      {/* control panel */}
      <Box size={[0.1, 0.006, 0.05]} position={[0.13, 0.189, 0.07]} color="#2a2d38" radius={0.003} shadow={false} />
      <Box size={[0.06, 0.002, 0.034]} position={[0.12, 0.1925, 0.07]} material={screen} shadow={false} />
      <Ball r={0.004} position={[0.165, 0.193, 0.07]} material={led} shadow={false} />
      {printing && (
        <group ref={sheet} position={[0, 0.068, -0.13]}>
          <Box size={[0.21, 0.002, 0.26]} color="#ffffff" shadow={false} />
          {[-0.09, -0.06, -0.03, 0, 0.03, 0.06].map((z) => (
            <Box key={z} size={[z === 0.06 ? 0.09 : 0.16, 0.001, 0.006]} position={[z === 0.06 ? -0.035 : 0, 0.0015, z]} color="#9aa0b8" shadow={false} />
          ))}
        </group>
      )}
    </group>
  )
}

/** 3D printer (open frame, ~44 cm): base, gantry frame, moving bed, X axis and print head, a part in the filament color. */
const BED = 0.105
function Printer3d({ v, printing }: P & { printing: boolean }) {
  const frame = bodyOf(v, '#2a2c33')
  const fil = v.opts.top ?? '#ff7a45'
  const part = useLitMaterial(fil, printing, fil, 0.3, 0.8)
  const nozzle = useLitMaterial('#c9a46a', printing, '#ff8a3d', 1, 2)
  const screen = useLitMaterial(C.screenOff, v.on || printing, '#7fb2ff', 0.8, 1.2)
  const gantry = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const bed = useRef<THREE.Group>(null)
  const piece = useRef<THREE.Group>(null)
  const parked = useRef(false)
  const invalidate = useThree((s) => s.invalidate)
  useAmbient(printing)
  useEffect(() => invalidate(), [printing, invalidate])
  useFrame(({ clock }) => {
    const g = gantry.current
    const h = head.current
    const b = bed.current
    const p = piece.current
    if (!g || !h || !b || !p) return
    if (!printing) {
      // When stopped, park once: head at the back left, part at its finished height
      if (parked.current) return
      parked.current = true
      g.position.y = BED + 0.15
      h.position.x = -0.12
      b.position.z = 0.05
      p.scale.y = 0.045
      markShadows(1)
      return
    }
    parked.current = false
    const t = clock.elapsedTime
    // The part grows layer by layer (5 cm in 50 s, then restarts); head and bed trace small circles over the part
    const layer = 0.004 + ((t * 0.02) % 1) * 0.05
    p.scale.y = layer
    g.position.y = BED + layer
    h.position.x = Math.sin(t * 2.3) * 0.022
    b.position.z = Math.cos(t * 1.9) * 0.022
    markShadows(1)
  })
  return (
    <group>
      <Box size={[0.4, 0.06, 0.34]} position={[0, 0.03, 0]} color={frame} radius={0.01} />
      <Box size={[0.08, 0.035, 0.004]} position={[0.12, 0.03, 0.171]} material={screen} shadow={false} />
      {/* gantry frame: two uprights and a top beam */}
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.03, 0.36, 0.04]} position={[s * 0.19, 0.24, -0.02]} color={frame} />
      ))}
      <Box size={[0.41, 0.03, 0.04]} position={[0, 0.42, -0.02]} color={frame} />
      {/* moving bed with the part on it */}
      <group ref={bed} position={[0, 0, 0.05]}>
        <Box size={[0.18, 0.03, 0.18]} position={[0, 0.08, 0]} color="#1b1d23" shadow={false} />
        <Box size={[0.26, 0.008, 0.24]} position={[0, BED - 0.004, 0]} color="#c9a46a" shadow={false} />
        <group position={[0, BED, 0]}>
          <group ref={piece} scale-y={0.045}>
            <Cyl r={0.028} rTop={0.022} h={1} position={[0, 0.5, 0]} material={part} segments={20} shadow={false} />
          </group>
        </group>
      </group>
      {/* X axis and head: the nozzle sits on top of the part */}
      <group ref={gantry} position={[0, BED + 0.15, 0]}>
        <Box size={[0.36, 0.016, 0.016]} position={[0, 0.05, -0.02]} color={C.steel} shadow={false} />
        <group ref={head} position={[-0.12, 0, 0]}>
          <Box size={[0.05, 0.06, 0.045]} position={[0, 0.042, 0]} color="#ff7a1a" radius={0.006} />
          <Cyl r={0.012} h={0.004} position={[0, 0.045, 0.0235]} rotation={[Math.PI / 2, 0, 0]} color="#2a2d38" segments={14} shadow={false} />
          <Cyl r={0.003} rTop={0.007} h={0.012} position={[0, 0.006, 0]} material={nozzle} segments={10} shadow={false} />
        </group>
      </group>
      {printing && v.night && <Glow position={[0, BED + 0.03, 0.05]} color="#ff8a3d" opacity={0.3} size={0.25} />}
    </group>
  )
}

/**
 * Printer (on a desk). Item.variant 'paper' (default): inkjet / laser printer; while printing (state 'printing' or a
 * non-sensor main entity on) paper slides out of the slot. '3d': open frame 3D printer; while printing the head and bed
 * move, the part grows layer by layer and glows faintly, the nozzle is orange. Body / frame Item.body, filament Item.top.
 */
export function Printer({ v }: P) {
  const printing = isPrinting(v)
  return v.opts.variant === '3d' ? <Printer3d v={v} printing={printing} /> : <PaperPrinter v={v} printing={printing} />
}

/** Kibble in the bowl (seeded, the same in every feeder). */
const KIBBLE = (() => {
  const r = rng(5)
  return Array.from({ length: 14 }, () => {
    const a = r() * TAU
    const d = Math.sqrt(r()) * 0.042
    return [Math.cos(a) * d, r() * 0.006, Math.sin(a) * d] as [number, number, number]
  })
})()

/**
 * Pet feeder (on the floor, ~34 cm): body at the back with a translucent hopper full of kibble and a lid on top, a bowl
 * tray at the front with kibble in a stainless bowl, a chute from the body to the bowl. Green light at the front when on.
 * Body color Item.body.
 */
export function PetFeeder({ v }: P) {
  const body = bodyOf(v, C.white)
  const led = useLitMaterial('#8d93ae', v.on, C.ok, 1, 2.4)
  const kibble = '#b98048'
  return (
    <group>
      <Box size={[0.22, 0.12, 0.15]} position={[0, 0.06, -0.07]} color={body} radius={0.025} />
      <Cyl r={0.085} h={0.17} position={[0, 0.205, -0.07]} material={clear('#e6f2ff', 0.35)} segments={32} shadow={false} />
      <Cyl r={0.078} h={0.12} position={[0, 0.181, -0.07]} color={kibble} segments={28} shadow={false} />
      <Cyl r={0.09} rTop={0.085} h={0.025} position={[0, 0.3025, -0.07]} color={body} segments={32} />
      <Cyl r={0.02} h={0.02} position={[0, 0.325, -0.07]} color={C.offWhite} segments={16} shadow={false} />
      {/* front: bowl tray, chute, stainless bowl and kibble */}
      <Box size={[0.22, 0.03, 0.15]} position={[0, 0.015, 0.075]} color={body} radius={0.012} />
      <Box size={[0.05, 0.03, 0.035]} position={[0, 0.1, 0.02]} color={body} radius={0.008} shadow={false} />
      <Cyl r={0.055} rTop={0.065} h={0.035} position={[0, 0.0475, 0.075]} material={mat('#c9ccd4', { metalness: 0.6, roughness: 0.3 })} segments={32} />
      <Ball r={0.05} position={[0, 0.065, 0.075]} scale={[1, 0.2, 1]} color={kibble} detail={2} shadow={false} />
      {KIBBLE.map((p, i) => (
        <Ball key={i} r={0.007} position={[p[0], 0.072 + p[1], 0.075 + p[2]]} color={i % 3 ? kibble : tint(kibble, 0.8)} detail={0} shadow={false} />
      ))}
      <Ball r={0.005} position={[0.07, 0.095, 0.0055]} material={led} shadow={false} />
      {v.on && v.night && <Glow position={[0.07, 0.095, 0.03]} color={C.ok} opacity={0.4} size={0.12} />}
    </group>
  )
}

/** Text on the power meter display: whole number from 100 up, otherwise one decimal; with the unit. */
function meterText(n: number, unit: string) {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10
  return `${formatNumber(r, 1)}${unit ? ` ${unit}` : ''}`
}

/** Power meter display: right aligned value on a green LCD (the text shrinks if it does not fit); dim when unbound. */
function meterTexture(text: string, live: boolean) {
  return textTexture(`meter-${live ? 1 : 0}-${text}`, 256, 96, (g) => {
    g.fillStyle = live ? '#0e2a1e' : '#1b2036'
    g.fillRect(0, 0, 256, 96)
    g.fillStyle = live ? '#7dffb2' : 'rgba(255, 255, 255, 0.4)'
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    g.font = `600 48px ${MONO}`
    const w = g.measureText(text).width
    if (w > 228) g.font = `600 ${Math.floor((48 * 228) / w)}px ${MONO}`
    g.fillText(text, 242, 52)
  })
}

/**
 * Power meter (on the wall; 1.50-1.90 m): meter box with an LCD display and a green light on top, four breakers below. When
 * the main entity is a sensor the display shows its value and unit (unit_of_measurement); otherwise dashes. Green light
 * while bound. Body Item.body.
 */
export function PowerMeter({ v }: P) {
  const body = bodyOf(v, '#eef0f4')
  const live = v.bound && !v.unavailable
  const n = v.domain === 'sensor' ? num(v.state) : null
  const unit = typeof v.attrs.unit_of_measurement === 'string' ? v.attrs.unit_of_measurement : ''
  const tex = meterTexture(live && n != null ? meterText(n, unit) : '---', live)
  const lcd = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, color: live ? '#ffffff' : '#9aa0b8', toneMapped: false }), [tex, live])
  useEffect(() => () => lcd.dispose(), [lcd])
  const led = useLitMaterial('#8d93ae', live, C.ok, 1, 2.4)
  const Y = 1.7
  return (
    <group>
      <Box size={[0.28, 0.4, 0.08]} position={[0, Y, -0.01]} color={body} radius={0.015} />
      <Box size={[0.2, 0.09, 0.006]} position={[0, Y + 0.1, 0.032]} color="#2a2d38" radius={0.006} shadow={false} />
      <mesh position={[0, Y + 0.1, 0.0355]} geometry={plane(0.17, 0.064)} material={lcd} />
      <Ball r={0.005} position={[0.115, Y + 0.165, 0.031]} material={led} shadow={false} />
      <Box size={[0.24, 0.012, 0.004]} position={[0, Y + 0.02, 0.031]} color={C.steel} shadow={false} />
      {[-0.075, -0.025, 0.025, 0.075].map((x) => (
        <group key={x}>
          <Box size={[0.04, 0.08, 0.02]} position={[x, Y - 0.08, 0.035]} color={C.white} radius={0.004} />
          <Box size={[0.012, 0.022, 0.012]} position={[x, Y - 0.07, 0.048]} color={x < 0 ? C.alarm : C.inkSoft} shadow={false} />
        </group>
      ))}
    </group>
  )
}

/* ---------- kitchen appliances ---------- */

/**
 * Coffee machine (on a counter, ~38 cm): rear body, a top head overhanging the front (display, two spouts), drip tray and
 * grate, bean hopper lid on top. When on the display lights up, a cup of coffee appears on the grate and thin steam rises
 * from it. Body color Item.body.
 */
export function CoffeeMachine({ v }: P) {
  const body = bodyOf(v, '#2a2c33')
  const steel = mat('#c9ccd4', { metalness: 0.6, roughness: 0.3 })
  const led = useLitMaterial(C.screenOff, v.on, '#ffd27a', 0.9, 1.6)
  return (
    <group>
      <Box size={[0.24, 0.36, 0.2]} position={[0, 0.18, -0.065]} color={body} radius={0.02} />
      <Box size={[0.24, 0.07, 0.13]} position={[0, 0.255, 0.1]} color={body} radius={0.015} />
      <Box size={[0.24, 0.035, 0.13]} position={[0, 0.0175, 0.1]} color={body} radius={0.01} />
      <Box size={[0.2, 0.004, 0.1]} position={[0, 0.037, 0.1]} material={steel} shadow={false} />
      <Cyl r={0.055} h={0.02} position={[0, 0.37, -0.07]} color="#3a3d47" segments={28} />
      {[-0.012, 0.012].map((x) => (
        <Cyl key={x} r={0.007} h={0.03} position={[x, 0.205, 0.1]} material={steel} segments={12} shadow={false} />
      ))}
      <Box size={[0.1, 0.03, 0.004]} position={[0, 0.258, 0.166]} material={led} shadow={false} />
      {[-0.08, 0.08].map((x) => (
        <Cyl key={x} r={0.008} h={0.004} position={[x, 0.258, 0.166]} rotation={[Math.PI / 2, 0, 0]} material={steel} segments={12} shadow={false} />
      ))}
      {v.on && (
        <group position={[0, 0.039, 0.1]}>
          <Cyl r={0.03} rTop={0.034} h={0.07} position={[0, 0.035, 0]} color={C.white} segments={20} />
          <mesh position={[0, 0.0705, 0]} rotation-x={-Math.PI / 2} geometry={disc(0.032, 20)} material={mat('#6b3e22')} />
          <mesh position={[0.038, 0.038, 0]} geometry={torus(0.014, 0.004, 16)} material={mat(C.white)} />
          <Mist active y={0.07} size={0.25} />
        </group>
      )}
      {v.on && v.night && <Glow position={[0, 0.258, 0.2]} color="#ffd27a" opacity={0.3} size={0.25} />}
    </group>
  )
}

/**
 * Kettle (on a counter, ~23 cm): dark base, slightly tapering body, lid and knob, spout at the front, handle at the back,
 * water level window on the side. When on a blue light ring and halo glow at the base and steam comes from the spout.
 * Body color Item.body.
 */
export function Kettle({ v }: P) {
  const body = bodyOf(v, C.white)
  const ring = useLitMaterial('#8d93ae', v.on, '#4f9dff', 1, 2.6)
  return (
    <group>
      <Cyl r={0.08} rTop={0.078} h={0.022} position={[0, 0.011, 0]} color="#2a2c33" segments={32} />
      <mesh position={[0, 0.026, 0]} rotation-x={Math.PI / 2} geometry={torus(0.071, 0.004, 40)} material={ring} />
      <Cyl r={0.07} rTop={0.06} h={0.17} position={[0, 0.111, 0]} color={body} segments={32} />
      <Cyl r={0.06} rTop={0.05} h={0.018} position={[0, 0.205, 0]} color={body} segments={32} />
      <Cyl r={0.012} h={0.014} position={[0, 0.221, 0]} color="#2a2c33" segments={14} shadow={false} />
      <Cyl r={0.014} rTop={0.009} h={0.06} position={[0, 0.175, 0.07]} rotation={[0.9, 0, 0]} color={body} segments={14} />
      {/* handle */}
      <Box size={[0.022, 0.13, 0.02]} position={[0, 0.12, -0.082]} color="#2a2c33" radius={0.008} />
      <Box size={[0.022, 0.022, 0.03]} position={[0, 0.18, -0.07]} color="#2a2c33" radius={0.006} shadow={false} />
      <Box size={[0.022, 0.022, 0.025]} position={[0, 0.06, -0.072]} color="#2a2c33" radius={0.006} shadow={false} />
      <Box size={[0.003, 0.09, 0.014]} position={[0.066, 0.1, 0]} material={clear('#7fc0ff', 0.7, 0.15)} shadow={false} />
      {v.on && <Glow position={[0, 0.03, 0]} color="#4f9dff" opacity={v.night ? 0.6 : 0.3} size={0.35} />}
      <group position={[0, 0, 0.093]}>
        <Mist active={v.on} y={0.195} size={0.3} />
      </group>
    </group>
  )
}

/**
 * Microwave (on a counter, ~29 cm): hollow body (cavity lining, turntable, plate), dark door with glass, control panel on
 * the right (display, two knobs, door button). When on the cavity glows warm yellow (visible through the glass), the
 * turntable spins, the display lights up and a warm halo falls in front. Body color Item.body.
 */
export function Microwave({ v }: P) {
  const body = bodyOf(v, '#e9ebf2')
  const dark = '#2a2c33'
  const cavity = useLitMaterial('#cfd3df', v.on, '#ffcf7a', 0.75, 0.9)
  const display = useLitMaterial(C.screenOff, v.on, '#7dffb2', 0.9, 1.4)
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.012} h={0.01} position={[sx * 0.2, 0.005, sz * 0.14]} color={dark} segments={10} shadow={false} />))}
      {/* body: bottom, top, left, back, control block on the right */}
      <Box size={[0.48, 0.02, 0.36]} position={[0, 0.02, 0]} color={body} />
      <Box size={[0.48, 0.02, 0.36]} position={[0, 0.28, 0]} color={body} radius={0.008} />
      <Box size={[0.02, 0.24, 0.36]} position={[-0.23, 0.15, 0]} color={body} />
      <Box size={[0.48, 0.24, 0.02]} position={[0, 0.15, -0.17]} color={body} />
      <Box size={[0.12, 0.24, 0.36]} position={[0.18, 0.15, 0]} color={body} />
      {/* cavity lining: back, floor, ceiling, both sides */}
      <Box size={[0.34, 0.24, 0.004]} position={[-0.05, 0.15, -0.158]} material={cavity} shadow={false} />
      <Box size={[0.34, 0.004, 0.33]} position={[-0.05, 0.032, 0.005]} material={cavity} shadow={false} />
      <Box size={[0.34, 0.004, 0.33]} position={[-0.05, 0.268, 0.005]} material={cavity} shadow={false} />
      <Box size={[0.004, 0.24, 0.33]} position={[0.118, 0.15, 0.005]} material={cavity} shadow={false} />
      <Box size={[0.004, 0.24, 0.33]} position={[-0.218, 0.15, 0.005]} material={cavity} shadow={false} />
      {/* turntable and plate */}
      <group position={[-0.05, 0.036, 0]}>
        <Spin speed={v.on ? 1.4 : 0} axis="y">
          <Cyl r={0.12} h={0.006} position={[0, 0.003, 0]} material={mat('#dfe9f5', { roughness: 0.15 })} segments={40} shadow={false} />
          <Cyl r={0.045} rTop={0.055} h={0.035} position={[0.045, 0.0235, 0]} color={C.coral} segments={24} shadow={false} />
          <mesh position={[0.045, 0.0412, 0]} rotation-x={-Math.PI / 2} geometry={disc(0.05, 24)} material={mat(C.sunPale)} />
        </Spin>
      </group>
      {/* door: frame around the window, and glass */}
      <Box size={[0.36, 0.05, 0.012]} position={[-0.06, 0.265, 0.186]} color={dark} shadow={false} />
      <Box size={[0.36, 0.05, 0.012]} position={[-0.06, 0.035, 0.186]} color={dark} shadow={false} />
      <Box size={[0.05, 0.18, 0.012]} position={[-0.215, 0.15, 0.186]} color={dark} shadow={false} />
      <Box size={[0.04, 0.18, 0.012]} position={[0.1, 0.15, 0.186]} color={dark} shadow={false} />
      <Box size={[0.27, 0.18, 0.004]} position={[-0.055, 0.15, 0.184]} material={clear('#1b2036', 0.42, 0.05)} shadow={false} />
      {/* control panel */}
      <Box size={[0.115, 0.27, 0.006]} position={[0.18, 0.15, 0.183]} color="#3a3d47" shadow={false} />
      <Box size={[0.07, 0.025, 0.003]} position={[0.18, 0.245, 0.1875]} material={display} shadow={false} />
      {[0.16, 0.09].map((y) => (
        <Cyl key={y} r={0.02} h={0.015} position={[0.18, y, 0.193]} rotation={[Math.PI / 2, 0, 0]} color={C.steel} segments={20} shadow={false} />
      ))}
      <Box size={[0.06, 0.02, 0.006]} position={[0.18, 0.04, 0.188]} color={C.steel} shadow={false} />
      {v.on && <Glow position={[-0.05, 0.15, 0.32]} color="#ffcf7a" opacity={v.night ? 0.55 : 0.22} size={0.6} />}
    </group>
  )
}

/**
 * Air fryer (on a counter, ~32 cm): rounded body, drawer and handle at the front, display on top and a rear vent. When on
 * the display glows orange (a faint halo at night). Body color Item.body.
 */
export function AirFryer({ v }: P) {
  const body = bodyOf(v, '#24262d')
  const drawer = useMemo(() => tint(body, 1.25), [body])
  const display = useLitMaterial(C.screenOff, v.on, '#ff9a3c', 1, 1.6)
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.012} h={0.01} position={[sx * 0.1, 0.005, -0.02 + sz * 0.1]} color="#15161b" segments={10} shadow={false} />))}
      <Box size={[0.27, 0.3, 0.29]} position={[0, 0.16, -0.02]} color={body} radius={0.06} />
      <Box size={[0.23, 0.14, 0.03]} position={[0, 0.1, 0.125]} color={drawer} radius={0.02} />
      <Box size={[0.07, 0.035, 0.03]} position={[0, 0.118, 0.147]} color="#3a3d47" radius={0.01} />
      <Box size={[0.1, 0.004, 0.06]} position={[0, 0.311, 0.02]} material={display} radius={0.002} shadow={false} />
      <Box size={[0.15, 0.003, 0.04]} position={[0, 0.3105, -0.1]} color="#15161b" shadow={false} />
      {v.on && v.night && <Glow position={[0, 0.33, 0.02]} color="#ff9a3c" opacity={0.35} size={0.25} />}
    </group>
  )
}

/* ---------- water and energy ---------- */

/**
 * Main water valve (on the wall, 0.30-0.60 m; a smart valve that shuts off on a leak): copper pipe coming out of the wall,
 * brass valve body in the middle with a motorized actuator on it. When open (valve 'open' or switch on) the lever runs along
 * the pipe and the actuator light is blue; when closed the lever is across the pipe and the light is red. Unlit while unbound.
 */
export function WaterValve({ v }: P) {
  const open = v.on
  const led = useLitMaterial('#8d93ae', v.bound && !v.unavailable, open ? C.cool : C.alarm, 1, 2.4)
  const copper = mat('#c8875a', { metalness: 0.55, roughness: 0.35 })
  const brass = mat('#c9a44c', { metalness: 0.6, roughness: 0.3 })
  return (
    <group>
      {/* pipe coming out of the wall, running up and down */}
      <Cyl r={0.018} h={0.3} position={[0, 0.45, -0.03]} material={copper} />
      <Cyl r={0.026} h={0.07} position={[0, 0.45, -0.03]} material={brass} segments={14} />
      {/* motorized actuator (facing forward) and status light */}
      <Box size={[0.08, 0.07, 0.07]} position={[0, 0.45, 0.025]} color={bodyOf(v, '#2a2d36')} radius={0.012} />
      <Cyl r={0.008} h={0.004} position={[0, 0.47, 0.061]} rotation={[Math.PI / 2, 0, 0]} material={led} segments={12} shadow={false} />
      {/* lever: vertical when open (along the pipe), horizontal when closed */}
      <group position={[0, 0.45, 0.065]} rotation={[0, 0, open ? 0 : Math.PI / 2]}>
        <Box size={[0.016, 0.1, 0.012]} position={[0, -0.035, 0]} color={open ? C.cool : C.alarm} radius={0.004} shadow={false} />
      </group>
      {v.night && v.bound && <Glow position={[0, 0.47, 0.08]} color={open ? C.cool : C.alarm} opacity={0.35} size={0.12} />}
    </group>
  )
}

/**
 * Home battery (on the floor against the wall, ~1.15 m; solar storage, Powerwall style): slim white body with a vertical
 * light bar at the front. When the main entity is a percentage (%) sensor the bar fills that far (orange when low, otherwise
 * green); while charging (battery_charging on among related entities, or the main switch on) the bar pulses slowly.
 */
export function HomeBattery({ v }: P) {
  const body = bodyOf(v, '#f4f4f6')
  const pct = v.domain === 'sensor' && v.attrs.unit_of_measurement === '%' ? num(v.state) : null
  const level = pct == null ? (v.bound ? 1 : 0) : Math.min(1, Math.max(0, pct / 100))
  const charging = v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && deviceClass(e) === 'battery_charging' && isActive(e)) || (v.domain === 'switch' && v.on)
  const color = pct != null && pct < 20 ? C.warn : C.ok
  const bar = useRef<THREE.Mesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  useAmbient(charging, true)
  useEffect(() => invalidate(), [charging, level, invalidate])
  useFrame(({ clock }) => {
    const m = bar.current?.material as THREE.MeshStandardMaterial | undefined
    if (!m) return
    m.emissiveIntensity = charging ? 0.9 + Math.sin(clock.elapsedTime * 2.4) * 0.5 : 1
  })
  const h = 0.6 * level
  return (
    <group>
      <Box size={[0.72, 1.12, 0.13]} position={[0, 0.58, -0.005]} color={body} radius={0.04} />
      <Box size={[0.66, 1.06, 0.01]} position={[0, 0.58, 0.061]} color={tint(body, 0.96)} radius={0.03} shadow={false} />
      {/* light bar: empty track and filled part (bottom up) */}
      <Box size={[0.02, 0.6, 0.006]} position={[0, 0.62, 0.068]} color="#d8dbe4" shadow={false} />
      {h > 0.005 && (
        <mesh ref={bar} position={[0, 0.32 + h / 2, 0.071]}>
          <boxGeometry args={[0.022, h, 0.006]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} toneMapped={false} />
        </mesh>
      )}
      {v.night && level > 0 && <Glow position={[0, 0.32 + h / 2, 0.1]} color={color} opacity={0.3} size={0.5} />}
    </group>
  )
}
