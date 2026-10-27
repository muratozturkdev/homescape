import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { t } from '@/i18n'
import { Glow, useAmbient, useEased, useLitMaterial } from './effects'
import { C, STREET_LAMP_AUTO } from './palette'
import { Ball, Box, Cyl, mat, rng } from './primitives'
import { artTexture } from './textures'
import type { Visual } from './visual'

/*
 * Front yard and street furniture, so the outside of a home can be modeled too: street lamp, park bench, street litter bin,
 * wheelie bin, recycling bins, fire hydrant, traffic sign, bollard, bike rack, bus stop, stepping stones, rock, large
 * planter, pergola / gazebo, fountain, bird bath, slide, trampoline, sandbox, street tree, utility pole, outdoor shower,
 * manhole cover, speed bump, traffic cone, garden shed, picnic table (the dog house is with the pet items). Local
 * convention: origin at the center of the base on the floor, front faces +z. Multi-part bodies are one cached merged
 * geometry (vertex colored); water drops are a single InstancedMesh excluded from selection that requests frames only
 * while on (useAmbient).
 */

type P = { v: Visual }
type V3 = [number, number, number]
const DIM = '#9aa0b8'
/** Dark painted cast metal (lamp post, bench legs, bus stop frame) */
const IRON = '#3a3f52'
const WOOD = '#c49a6c'
const WOOD_DARK = '#a67c52'

/* ---------- shared helpers (same pattern as outdoor.tsx) ---------- */

type Part = { g: THREE.BufferGeometry; p?: V3; r?: V3; q?: THREE.Quaternion; s?: V3 | number; c?: string }

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _col = new THREE.Color()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/** Merges parts into one geometry; parts with a color get vertex colors (material uses vertexColors). */
function merge(parts: Part[]) {
  const colored = parts.some((x) => x.c || x.g.attributes.color)
  const list = parts.map(({ g, p = [0, 0, 0], r = [0, 0, 0], q, s = 1, c }) => {
    const x = g.index ? g.toNonIndexed() : g.clone()
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') x.deleteAttribute(name)
    if (typeof s === 'number') _s.setScalar(s)
    else _s.set(...s)
    x.applyMatrix4(_m.compose(_p.set(...p), q ?? _q.setFromEuler(_e.set(...r)), _s))
    if (colored && (c || !x.attributes.color)) {
      _col.set(c ?? '#ffffff')
      const n = x.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) arr.set([_col.r, _col.g, _col.b], i * 3)
      x.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    return x
  })
  const out = mergeGeometries(list, false)!
  for (const x of list) x.dispose()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

const boxG = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const rboxG = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2))
const cylG = (r: number, h: number, seg = 12, rTop = r) => new THREE.CylinderGeometry(rTop, r, h, seg)
const icoG = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail)
const latheG = (pts: [number, number][], seg = 28) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg)

/** Rod of radius r from a to b. */
function rod(a: V3, b: V3, r: number, c?: string, seg = 8): Part {
  _a.set(...a)
  _b.set(...b)
  const len = _a.distanceTo(_b)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, _b.sub(_a).normalize())
  return { g: cylG(r, len, seg), p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, c }
}

/** Cached geometries and textures (built once per size or kind, never disposed). */
const store = new Map<string, unknown>()
function cached<T>(key: string, make: () => T): T {
  let g = store.get(key) as T | undefined
  if (g === undefined) {
    g = make()
    store.set(key, g)
  }
  return g
}

/** Shared material for the vertex colored merged geometries. */
function vcMat(roughness = 0.8, flat = false, metalness = 0) {
  return cached(`vc-${roughness}-${flat}-${metalness}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, flatShading: flat }))
}

type MeshProps = { position?: V3; rotation?: V3; scale?: V3 | number; renderOrder?: number }
/** Mesh with a ready geometry and material. */
function M({ g, m, shadow = true, ...rest }: MeshProps & { g: THREE.BufferGeometry; m: THREE.Material; shadow?: boolean }) {
  return <mesh geometry={g} material={m} castShadow={shadow} receiveShadow {...rest} />
}

/** Effect mesh (light beam, drop, ripple): excluded from the selection box and from clicks. */
const AID = { userData: { selectionAid: true }, raycast: () => null } as const

/** Small canvas texture (sign face, manhole pattern); drawn once per key. */
function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  return cached(`tex-${key}`, () => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    draw(c.getContext('2d')!)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
  })
}

const SIGN_FONT = '"Plus Jakarta Sans Variable", Arial, Helvetica, sans-serif'
/** Bold sign font of `px` pixels, shrunk until `text` fits in `maxW` pixels (translated sign texts can be longer); returns g.font */
function fitFont(g: CanvasRenderingContext2D, text: string, px: number, maxW: number) {
  let size = px
  g.font = `800 ${size}px ${SIGN_FONT}`
  while (g.measureText(text).width > maxW && size > 8) g.font = `800 ${(size *= 0.92)}px ${SIGN_FONT}`
  return g.font
}

/** Shared sphere geometry for water drops. */
const dropGeo = () => cached('drop', () => new THREE.SphereGeometry(1, 6, 5))
const _o = new THREE.Object3D()

/* ---------- street lamp ---------- */

const LAMP_H = 3.9
/** Beam texture: full at the cone's apex (uv v = 1), fading towards the ground. */
const beamTexture = () =>
  cached('lamp-beam', () => {
    const data = new Uint8Array(4 * 64 * 4)
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4
        data.set([255, 255, 255, Math.round(Math.pow((y + 0.5) / 64, 1.3) * 255)], i)
      }
    const t = new THREE.DataTexture(data, 4, 64, THREE.RGBAFormat)
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  })

/** Post, arms and luminaire housings (once per model). The arm's end is at local +z (turn the arm towards the road). */
function streetLampGeometry(model: string) {
  return cached(`street-lamp-${model}`, () => {
    if (model === 'classic') {
      const H = 3.0
      const parts: Part[] = [
        { g: cylG(0.17, 0.12, 20, 0.14), p: [0, 0.06, 0] },
        { g: cylG(0.11, 0.55, 16, 0.075), p: [0, 0.39, 0] },
        { g: cylG(0.055, H - 0.6, 12, 0.045), p: [0, 0.6 + (H - 0.6) / 2, 0] },
        { g: cylG(0.07, 0.06, 14), p: [0, H, 0] },
        // lantern: base, four corner posts, roof, finial
        { g: boxG(0.3, 0.04, 0.3), p: [0, H + 0.05, 0] },
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ g: boxG(0.025, 0.36, 0.025), p: [sx * 0.135, H + 0.25, sz * 0.135] as V3 }))),
        { g: cylG(0.25, 0.14, 4, 0.02), p: [0, H + 0.5, 0], r: [0, Math.PI / 4, 0] },
        { g: icoG(0.035, 1), p: [0, H + 0.6, 0] },
      ]
      return merge(parts)
    }
    const parts: Part[] = [
      { g: cylG(0.16, 0.1, 20, 0.14), p: [0, 0.05, 0] },
      { g: cylG(0.1, 0.5, 16, 0.085), p: [0, 0.35, 0] },
      { g: cylG(0.07, LAMP_H - 0.5, 12, 0.05), p: [0, 0.5 + (LAMP_H - 0.5) / 2, 0] },
      { g: icoG(0.055, 1), p: [0, LAMP_H, 0] },
    ]
    for (const sz of model === 'double' ? [1, -1] : [1]) {
      parts.push(rod([0, LAMP_H - 0.12, 0], [0, LAMP_H + 0.02, sz * 0.4], 0.03), rod([0, LAMP_H + 0.02, sz * 0.4], [0, LAMP_H + 0.06, sz * 0.86], 0.028))
      parts.push(rod([0, LAMP_H - 0.45, 0], [0, LAMP_H - 0.02, sz * 0.32], 0.016))
      parts.push({ g: rboxG(0.24, 0.09, 0.5, 0.04), p: [0, LAMP_H + 0.04, sz * 1.02], r: [sz * 0.06, 0, 0] })
    }
    return merge(parts)
  })
}

/** Local positions of the street lamp lenses (kept in sync with roomLights.ts > STREET_LAMP). */
const STREET_LAMP_LIGHTS: Record<string, V3[]> = {
  single: [[0, LAMP_H - 0.06, 1.02]],
  double: [
    [0, LAMP_H - 0.06, 1.02],
    [0, LAMP_H - 0.06, -1.02],
  ],
  classic: [[0, 3.25, 0]],
}

/**
 * Street lamp (~4 m). Item.variant 'single' (one arm, default): a downward facing luminaire at the end of an arm reaching
 * forward (+z) from the top of the post; 'double' arms on both sides; 'classic' a ~3.6 m classic lantern. While the bound
 * light or switch is on, the lens glows; at night a halo below the lens and a soft cone of light to the ground. Lighting
 * the room (road, sidewalk) is done in roomLights.ts > SPEC: the light falls into the room under the lens at the arm's
 * end, and a little into the post's room if that differs.
 */
export function StreetLamp({ v: given }: P) {
  // A street lamp without a bound entity turns on by itself at night; a bound one follows its state in HA
  const v = !given.bound && given.night ? { ...given, on: true, level: 1, color: STREET_LAMP_AUTO } : given
  const model = v.opts.variant === 'double' || v.opts.variant === 'classic' ? v.opts.variant : 'single'
  const lens = useLitMaterial('#eef0f6', v.on, v.color, v.level, 2)
  const night = v.on && v.night
  const halo = night ? Math.min(0.95, 0.4 + 0.5 * v.level) : 0
  const beam = useMemo(
    () => new THREE.MeshBasicMaterial({ map: beamTexture(), color: v.color, transparent: true, opacity: 0.1 * Math.max(0.3, v.level), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
    [v.color, v.level],
  )
  useEffect(() => () => beam.dispose(), [beam])
  const body = mat(v.unavailable ? DIM : IRON, { roughness: 0.55, metalness: 0.25 })
  const spots = STREET_LAMP_LIGHTS[model]
  return (
    <group>
      <M g={streetLampGeometry(model)} m={body} />
      {model === 'classic' ? (
        <>
          <Box size={[0.24, 0.32, 0.24]} position={[0, 3.25, 0]} material={lens} shadow={false} />
          <Glow position={[0, 3.25, 0]} color={v.color} opacity={halo} size={1.6} />
        </>
      ) : (
        spots.map((s, i) => (
          <group key={i}>
            <Box size={[0.17, 0.02, 0.38]} position={[0, s[1], s[2]]} material={lens} shadow={false} />
            <Glow position={[0, s[1] - 0.08, s[2]]} color={v.color} opacity={halo} size={1.5} />
            {night && (
              <mesh position={[0, s[1] / 2, s[2]]} material={beam} renderOrder={9} {...AID}>
                <coneGeometry args={[1.5, s[1], 24, 1, true]} />
              </mesh>
            )}
          </group>
        ))
      )}
    </group>
  )
}

/* ---------- park bench ---------- */

/** Bench slats (seat and back) and cast legs; once per length and kind. */
function benchGeometry(L: number, back: boolean) {
  return cached(`bench-${L.toFixed(2)}-${back}`, () => {
    const slats: Part[] = [0.17, 0.03, -0.11].map((z) => ({ g: rboxG(L, 0.035, 0.12, 0.012), p: [0, 0.445, z] as V3 }))
    if (back) slats.push(...[0.6, 0.76].map((y, i) => ({ g: rboxG(L, 0.12, 0.03, 0.012), p: [0, y, -0.2 - i * 0.035] as V3, r: [-0.2, 0, 0] as V3 })))
    const frames: Part[] = []
    const xs = [-(L / 2 - 0.12), L / 2 - 0.12, ...(L > 2.1 ? [0] : [])]
    for (const x of xs) {
      frames.push(rod([x, 0, 0.21], [x, 0.43, 0.19], 0.022), rod([x, 0.42, 0.23], [x, 0.42, -0.19], 0.02))
      frames.push({ g: boxG(0.06, 0.02, 0.1), p: [x, 0.01, 0.21] }, { g: boxG(0.06, 0.02, 0.1), p: [x, 0.01, -0.2] })
      if (back) {
        frames.push(rod([x, 0, -0.2], [x, 0.43, -0.17], 0.022), rod([x, 0.43, -0.17], [x, 0.86, -0.28], 0.02))
        // armrests only at the ends
        if (x !== 0) frames.push(rod([x, 0.43, 0.21], [x, 0.63, 0.2], 0.018), rod([x, 0.63, 0.22], [x, 0.63, -0.2], 0.022))
      } else frames.push(rod([x, 0, -0.2], [x, 0.43, -0.18], 0.022))
    }
    return { slats: merge(slats), frames: merge(frames) }
  })
}

/**
 * Park bench: length Item.len (default 1.6 m, along x). Item.variant 'park' (default): three seat slats and two back
 * slats, dark cast legs with armrests; 'flat' has no back. Slat color Item.top. Front faces +z (a seated person faces +z).
 */
export function Bench({ v }: P) {
  const L = v.opts.len ?? 1.6
  const g = benchGeometry(L, v.opts.variant !== 'flat')
  return (
    <group>
      <M g={g.slats} m={mat(v.opts.top ?? WOOD, { roughness: 0.75 })} />
      <M g={g.frames} m={mat(IRON, { roughness: 0.5, metalness: 0.3 })} />
    </group>
  )
}

/* ---------- bins ---------- */

/** Post-mounted street litter bin (~1.1 m): post on a concrete base, green cylindrical bin in front, open top with a steel band. */
export function StreetBin() {
  return (
    <group>
      <Box size={[0.22, 0.04, 0.22]} position={[0, 0.02, -0.14]} color="#d4d5dc" radius={0.01} />
      <Cyl r={0.035} h={1.08} position={[0, 0.54, -0.14]} color={IRON} segments={12} />
      <Cyl r={0.2} rTop={0.21} h={0.5} position={[0, 0.72, 0.05]} color="#3f7d5e" segments={24} />
      <Cyl r={0.215} h={0.04} position={[0, 0.97, 0.05]} color={C.steel} segments={24} />
      <Cyl r={0.18} h={0.006} position={[0, 0.992, 0.05]} color="#20242f" segments={24} shadow={false} />
      <Box size={[0.08, 0.1, 0.03]} position={[0, 0.78, -0.12]} color={IRON} />
    </group>
  )
}

/** Wheelie bin body: a box tapering towards the bottom (built once). */
const wheelieBodyGeo = () => cached('wheelie-body', () => new THREE.CylinderGeometry(0.43, 0.37, 0.95, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.22))

/**
 * Wheelie bin (240 L, ~1.05 m): body tapering towards the bottom, lid, two wheels and a handle at the back. Body color
 * Item.body (gray, green, blue paper, yellow packaging, brown organic).
 */
export function WheelieBin({ v }: P) {
  const color = v.opts.body ?? '#5d6274'
  return (
    <group>
      <mesh geometry={wheelieBodyGeo()} material={mat(color, { roughness: 0.6 })} position={[0, 0.5, 0]} castShadow receiveShadow />
      <Box size={[0.64, 0.05, 0.78]} position={[0, 1.0, 0.01]} color={color} radius={0.02} />
      <Box size={[0.5, 0.03, 0.05]} position={[0, 0.99, 0.41]} color={color} radius={0.01} />
      <Cyl r={0.018} h={0.6} position={[0, 0.98, -0.42]} rotation={[0, 0, Math.PI / 2]} color="#2a2d36" segments={10} />
      {[-0.25, 0.25].map((x) => (
        <Cyl key={x} r={0.1} h={0.06} position={[x, 0.1, -0.3]} rotation={[0, 0, Math.PI / 2]} color="#2a2d36" segments={18} />
      ))}
    </group>
  )
}

/** Recycling symbol: three arrows forming a triangle (white on transparent). */
const recycleTexture = () =>
  canvasTexture('recycle', 128, 128, (g) => {
    g.strokeStyle = '#ffffff'
    g.fillStyle = '#ffffff'
    g.lineWidth = 11
    g.lineCap = 'round'
    const pts = [0, 1, 2].map((k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3
      return [64 + Math.cos(a) * 44, 68 + Math.sin(a) * 44] as const
    })
    for (let k = 0; k < 3; k++) {
      const [x0, y0] = pts[k]
      const [x1, y1] = pts[(k + 1) % 3]
      const sx = x0 + (x1 - x0) * 0.22
      const sy = y0 + (y1 - y0) * 0.22
      const ex = x0 + (x1 - x0) * 0.72
      const ey = y0 + (y1 - y0) * 0.72
      g.beginPath()
      g.moveTo(sx, sy)
      g.lineTo(ex, ey)
      g.stroke()
      const a = Math.atan2(y1 - y0, x1 - x0)
      g.beginPath()
      g.moveTo(ex + Math.cos(a) * 14, ey + Math.sin(a) * 14)
      g.lineTo(ex + Math.cos(a + 2.2) * 14, ey + Math.sin(a + 2.2) * 14)
      g.lineTo(ex + Math.cos(a - 2.2) * 14, ey + Math.sin(a - 2.2) * 14)
      g.closePath()
      g.fill()
    }
  })

const RECYCLE = ['#3d6fd6', '#e6b52e', '#3e9e72']

/** Recycling bins: three bins side by side, blue (paper), yellow (packaging), green (glass); slot in the lid, symbol on the front. */
export function RecycleBins() {
  const sign = useMemo(() => new THREE.MeshBasicMaterial({ map: recycleTexture(), transparent: true, depthWrite: false }), [])
  useEffect(() => () => sign.dispose(), [sign])
  return (
    <group>
      {RECYCLE.map((c, i) => {
        const x = (i - 1) * 0.49
        return (
          <group key={c} position={[x, 0, 0]}>
            <Box size={[0.46, 0.92, 0.5]} position={[0, 0.46, 0]} color={c} radius={0.04} />
            <Box size={[0.48, 0.06, 0.52]} position={[0, 0.95, 0]} color={c} radius={0.025} />
            <Cyl r={0.09} h={0.012} position={[0, 0.985, 0.08]} color="#20242f" segments={20} shadow={false} />
            <mesh position={[0, 0.58, 0.252]} material={sign} {...AID}>
              <planeGeometry args={[0.24, 0.24]} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/* ---------- fire hydrant ---------- */

/** Fire hydrant (~0.75 m): red body, flanged base, dome, two side outlets and one front outlet (steel caps). */
export function Hydrant() {
  const red = '#d9463d'
  const parts = useMemo(
    () =>
      cached('hydrant', () =>
        merge([
          { g: cylG(0.14, 0.05, 20), p: [0, 0.025, 0], c: red },
          { g: cylG(0.095, 0.5, 20), p: [0, 0.3, 0], c: red },
          { g: cylG(0.112, 0.05, 20), p: [0, 0.56, 0], c: red },
          { g: icoG(0.1, 2), p: [0, 0.59, 0], s: [1, 0.85, 1], c: red },
          { g: cylG(0.03, 0.06, 5), p: [0, 0.69, 0], c: C.steel },
          { g: cylG(0.042, 0.11, 14), p: [0.12, 0.42, 0], r: [0, 0, Math.PI / 2], c: red },
          { g: cylG(0.042, 0.11, 14), p: [-0.12, 0.42, 0], r: [0, 0, Math.PI / 2], c: red },
          { g: cylG(0.05, 0.03, 6), p: [0.18, 0.42, 0], r: [0, 0, Math.PI / 2], c: C.steel },
          { g: cylG(0.05, 0.03, 6), p: [-0.18, 0.42, 0], r: [0, 0, Math.PI / 2], c: C.steel },
          { g: cylG(0.058, 0.1, 14), p: [0, 0.36, 0.12], r: [Math.PI / 2, 0, 0], c: red },
          { g: cylG(0.066, 0.035, 6), p: [0, 0.36, 0.18], r: [Math.PI / 2, 0, 0], c: C.steel },
        ]),
      ),
    [],
  )
  return <M g={parts} m={vcMat(0.45, false, 0.15)} />
}

/* ---------- traffic sign ---------- */

/** Sign faces (canvas, 256 px): the shape comes from the geometry, the texture is painted to the edges. */
function signTexture(kind: string) {
  return canvasTexture(`sign-${kind}`, 256, 256, (g) => {
    const font = (px: number) => `800 ${px}px ${SIGN_FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    if (kind === 'stop') {
      g.fillStyle = '#d23a33'
      g.fillRect(0, 0, 256, 256)
      g.strokeStyle = '#ffffff'
      g.lineWidth = 12
      g.beginPath()
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4
        g.lineTo(128 + Math.cos(a) * 112, 128 - Math.sin(a) * 112)
      }
      g.stroke()
      g.fillStyle = '#ffffff'
      const text = t('STOP')
      g.font = fitFont(g, text, 86, 188)
      g.fillText(text, 128, 134)
    } else if (kind === 'parking' || kind === 'crossing') {
      g.fillStyle = '#1f5fbf'
      g.fillRect(0, 0, 256, 256)
      g.strokeStyle = '#ffffff'
      g.lineWidth = 10
      g.strokeRect(14, 14, 228, 228)
      g.fillStyle = '#ffffff'
      if (kind === 'parking') {
        g.font = font(170)
        g.fillText('P', 128, 140)
      } else {
        g.beginPath()
        g.moveTo(128, 40)
        g.lineTo(220, 206)
        g.lineTo(36, 206)
        g.closePath()
        g.fill()
        g.fillStyle = '#1f2440'
        g.beginPath()
        g.arc(132, 102, 13, 0, Math.PI * 2)
        g.fill()
        g.lineWidth = 11
        g.lineCap = 'round'
        g.strokeStyle = '#1f2440'
        g.beginPath()
        g.moveTo(128, 122)
        g.lineTo(122, 160)
        g.moveTo(122, 160)
        g.lineTo(104, 190)
        g.moveTo(122, 160)
        g.lineTo(142, 188)
        g.moveTo(126, 132)
        g.lineTo(150, 150)
        g.moveTo(126, 132)
        g.lineTo(106, 146)
        g.stroke()
      }
    } else if (kind === 'speed') {
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, 256, 256)
      g.strokeStyle = '#d23a33'
      g.lineWidth = 30
      g.beginPath()
      g.arc(128, 128, 110, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#1f2440'
      g.font = font(104)
      g.fillText('30', 128, 136)
    } else if (kind === 'noEntry') {
      g.fillStyle = '#d23a33'
      g.fillRect(0, 0, 256, 256)
      g.fillStyle = '#ffffff'
      g.fillRect(48, 106, 160, 44)
    } else {
      // Yield: inverted triangle with a red border (geometry corners: bottom center, top right, top left)
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, 256, 256)
      g.strokeStyle = '#d23a33'
      g.lineWidth = 34
      g.lineJoin = 'round'
      g.beginPath()
      g.moveTo(128, 222)
      g.lineTo(222, 68)
      g.lineTo(34, 68)
      g.closePath()
      g.stroke()
    }
  })
}

const SIGN_KINDS = ['stop', 'parking', 'crossing', 'speed', 'noEntry', 'yield']
const SIGN_Y = 2.1

/** Sign geometry: stop is an octagon, parking and crossing square, speed and no entry round, yield an inverted triangle (built once). */
function signGeometry(kind: string) {
  return cached(`sign-geo-${kind}`, () => {
    if (kind === 'stop') return new THREE.CircleGeometry(0.34, 8, Math.PI / 8)
    if (kind === 'parking' || kind === 'crossing') return new THREE.PlaneGeometry(0.56, 0.56)
    if (kind === 'yield') return new THREE.CircleGeometry(0.42, 3, -Math.PI / 2)
    return new THREE.CircleGeometry(0.3, 32)
  })
}

/**
 * Traffic sign (~2.4 m): galvanized post with the sign on top (front faces +z). Item.variant: 'stop' (red octagon),
 * 'parking' (blue P), 'crossing' pedestrian crossing, 'speed' speed limit 30, 'noEntry' no entry, 'yield'.
 */
export function TrafficSign({ v }: P) {
  const kind = SIGN_KINDS.includes(v.opts.variant ?? '') ? v.opts.variant! : 'stop'
  const face = useMemo(() => new THREE.MeshStandardMaterial({ map: signTexture(kind), roughness: 0.5 }), [kind])
  useEffect(() => () => face.dispose(), [face])
  const geo = signGeometry(kind)
  const back = mat('#b9bdc9', { roughness: 0.6, metalness: 0.3 })
  return (
    <group>
      <Cyl r={0.03} h={SIGN_Y + 0.3} position={[0, (SIGN_Y + 0.3) / 2, 0]} color={C.steel} segments={12} />
      <Cyl r={0.032} h={0.012} position={[0, SIGN_Y + 0.306, 0]} color={IRON} segments={12} />
      <mesh geometry={geo} material={face} position={[0, SIGN_Y, 0.042]} castShadow />
      <mesh geometry={geo} material={back} position={[0, SIGN_Y, 0.034]} rotation={[0, Math.PI, 0]} castShadow />
      {[-0.12, 0.12].map((dy) => (
        <Box key={dy} size={[0.08, 0.03, 0.03]} position={[0, SIGN_Y + dy, 0.03]} color={C.steel} shadow={false} />
      ))}
    </group>
  )
}

/* ---------- bollard ---------- */

/** Bollard. Item.variant 'steel' (default): 90 cm stainless steel, domed top, white reflective bands; 'concrete': low concrete. */
export function Bollard({ v }: P) {
  if (v.opts.variant === 'concrete')
    return (
      <group>
        <Cyl r={0.19} rTop={0.16} h={0.5} position={[0, 0.25, 0]} color="#d9dae0" segments={24} />
        <Ball r={0.16} position={[0, 0.5, 0]} scale={[1, 0.55, 1]} color="#d9dae0" detail={2} />
      </group>
    )
  const steel = mat('#c6cbd8', { roughness: 0.35, metalness: 0.2 })
  return (
    <group>
      <Cyl r={0.07} h={0.86} position={[0, 0.43, 0]} material={steel} segments={20} />
      <Ball r={0.07} position={[0, 0.86, 0]} scale={[1, 0.45, 1]} material={steel} detail={2} />
      <Cyl r={0.072} h={0.05} position={[0, 0.74, 0]} color="#f6f7fb" segments={20} shadow={false} />
      <Cyl r={0.072} h={0.02} position={[0, 0.66, 0]} color="#f6f7fb" segments={20} shadow={false} />
    </group>
  )
}

/* ---------- bike rack ---------- */

/** Inverted U bike stand (60 cm along local z, 75 cm high; built once). */
const hoopGeo = () =>
  cached('hoop', () => {
    const pts: V3[] = [
      [0, 0, -0.3],
      [0, 0.52, -0.3],
      [0, 0.68, -0.24],
      [0, 0.74, -0.1],
      [0, 0.75, 0],
      [0, 0.74, 0.1],
      [0, 0.68, 0.24],
      [0, 0.52, 0.3],
      [0, 0, 0.3],
    ]
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)), false, 'catmullrom', 0.1), 28, 0.025, 8)
  })

/** Bike rack: length Item.len (default 1.5 m, along x), an inverted U steel stand every ~60 cm (one merged mesh). */
export function BikeRack({ v }: P) {
  const L = v.opts.len ?? 1.5
  const g = useMemo(
    () =>
      cached(`bike-rack-${L.toFixed(2)}`, () => {
        const n = Math.max(2, Math.round((L - 0.2) / 0.6) + 1)
        return merge(Array.from({ length: n }, (_, i) => ({ g: hoopGeo(), p: [-L / 2 + 0.12 + (i * (L - 0.24)) / (n - 1), 0, 0] as V3 })))
      }),
    [L],
  )
  return <M g={g} m={mat('#bfc5d3', { roughness: 0.35, metalness: 0.2 })} />
}

/* ---------- bus stop ---------- */

const busStopTexture = () =>
  canvasTexture('bus-stop', 256, 64, (g) => {
    g.fillStyle = '#1f5fbf'
    g.fillRect(0, 0, 256, 64)
    g.fillStyle = '#ffffff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const text = t('BUS STOP')
    g.font = fitFont(g, text, 40, 232)
    g.fillText(text, 128, 35)
  })

/**
 * Bus stop shelter (3.2 × 1.5 m, ~2.5 m): dark frame, frosted glass back and side panel, light flat roof, wooden bench
 * inside, illuminated advertising panel on the right side (glows faintly at night), blue "BUS STOP" sign at the front of
 * the roof. Open side faces +z (the road).
 */
export function BusStop({ v }: P) {
  const frame = mat(IRON, { roughness: 0.5, metalness: 0.3 })
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false }), [])
  const ad = useMemo(() => new THREE.MeshStandardMaterial({ map: artTexture(), emissive: '#ffffff', emissiveMap: artTexture(), emissiveIntensity: v.night ? 0.55 : 0.08, roughness: 0.4 }), [v.night])
  const sign = useMemo(() => new THREE.MeshStandardMaterial({ map: busStopTexture(), roughness: 0.5 }), [])
  useEffect(
    () => () => {
      glass.dispose()
      ad.dispose()
      sign.dispose()
    },
    [glass, ad, sign],
  )
  return (
    <group>
      {[-1.5, 1.5].flatMap((x) => [-0.62, 0.55].map((z) => <Box key={`${x}${z}`} size={[0.07, 2.38, 0.07]} position={[x, 1.19, z]} material={frame} />))}
      <Box size={[3.3, 0.08, 1.5]} position={[0, 2.42, -0.03]} color="#eceef4" radius={0.03} />
      <Box size={[3.32, 0.03, 1.52]} position={[0, 2.37, -0.03]} material={frame} shadow={false} />
      <Box size={[2.92, 1.9, 0.02]} position={[0, 1.22, -0.62]} material={glass} shadow={false} renderOrder={2} />
      <Box size={[0.02, 1.9, 1.1]} position={[-1.5, 1.22, -0.04]} material={glass} shadow={false} renderOrder={2} />
      {/* advertising panel (right side) */}
      <Box size={[0.08, 1.5, 1.0]} position={[1.5, 1.1, -0.04]} material={frame} />
      <mesh position={[1.456, 1.1, -0.04]} rotation={[0, -Math.PI / 2, 0]} material={ad}>
        <planeGeometry args={[0.9, 1.38]} />
      </mesh>
      {/* bench */}
      <Box size={[2.2, 0.05, 0.38]} position={[-0.15, 0.46, -0.4]} color={WOOD} radius={0.015} />
      {[-1.1, 0.8].map((x) => (
        <Box key={x} size={[0.05, 0.44, 0.3]} position={[x, 0.22, -0.42]} material={frame} />
      ))}
      {/* sign */}
      <Box size={[1.0, 0.26, 0.04]} position={[-0.8, 2.6, 0.62]} material={frame} />
      <mesh position={[-0.8, 2.6, 0.642]} material={sign}>
        <planeGeometry args={[0.94, 0.22]} />
      </mesh>
    </group>
  )
}

/* ---------- stepping stones ---------- */

const STONE_GREYS = ['#cbc8c0', '#bdb9b1', '#d8d5cd', '#c4c1b9']

/** Stepping stones: length Item.len (default 2.4 m, along x), a flat, irregular round stone every ~55 cm (built once). */
export function SteppingStones({ v }: P) {
  const L = v.opts.len ?? 2.4
  const g = useMemo(
    () =>
      cached(`stepping-${L.toFixed(2)}`, () => {
        const r = rng(Math.round(L * 100) + 9)
        const n = Math.max(2, Math.round(L / 0.55))
        return merge(
          Array.from({ length: n }, (_, i) => ({
            g: cylG(0.2, 0.05, 9),
            p: [-L / 2 + ((i + 0.5) * L) / n, 0.025, (i % 2 ? 0.07 : -0.07) + (r() - 0.5) * 0.04] as V3,
            r: [0, r() * 3, 0] as V3,
            s: [0.9 + r() * 0.25, 1, 0.8 + r() * 0.2] as V3,
            c: STONE_GREYS[Math.floor(r() * STONE_GREYS.length)],
          })),
        )
      }),
    [L],
  )
  return <M g={g} m={vcMat(0.9, true)} />
}

/* ---------- rock ---------- */

/** Irregular rock: an icosahedron with welded vertices displaced by a seeded random (no cracks in the surface). */
function rockGeometry(r: number, seed: number) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(r, 1).deleteAttribute('uv').deleteAttribute('normal'))
  const rnd = rng(seed)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const k = 0.82 + rnd() * 0.3
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k)
  }
  g.computeVertexNormals()
  return g
}

/** Rock. Item.variant 'cluster' (default): a group of three rocks; 'boulder' one large rock with a pebble at its foot. */
export function Rock({ v }: P) {
  const boulder = v.opts.variant === 'boulder'
  const g = cached(`rock-${boulder}`, () =>
    merge(
      boulder
        ? [
            { g: rockGeometry(0.5, 3), p: [0, 0.26, 0], s: [1.05, 0.72, 0.85], c: '#aeb2bd' },
            { g: rockGeometry(0.13, 8), p: [0.42, 0.06, 0.24], s: [1, 0.7, 1], c: '#c2c5ce' },
          ]
        : [
            { g: rockGeometry(0.36, 5), p: [-0.15, 0.18, -0.05], s: [1.1, 0.75, 0.9], c: '#aeb2bd' },
            { g: rockGeometry(0.25, 6), p: [0.27, 0.12, 0.12], s: [1, 0.7, 1], c: '#c2c5ce' },
            { g: rockGeometry(0.15, 7), p: [0.08, 0.07, -0.26], s: [1, 0.65, 1.1], c: '#9ea3af' },
          ],
    ),
  )
  return <M g={g} m={vcMat(0.95, true)} />
}

/* ---------- large planter ---------- */

const PLANTER_BODY: Record<string, string> = { wood: WOOD_DARK, concrete: '#d6d7de', corten: '#9b5a37' }
const BLOSSOMS = ['#ff6fae', C.coral, C.sun, '#b58cff', '#ffffff']

/** Planter plants: a row of round shrubs with flowers in between (once per length). */
function planterPlants(L: number) {
  return cached(`planter-plants-${L.toFixed(2)}`, () => {
    const r = rng(Math.round(L * 100) + 4)
    const n = Math.max(2, Math.round(L / 0.32))
    const greens = [C.leaf, C.leafDark, '#4fae80', '#45a173']
    const parts: Part[] = []
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 0.16 + (i * (L - 0.32)) / Math.max(1, n - 1)
      parts.push({ g: icoG(0.15 + r() * 0.05, 1), p: [x, 0.6 + r() * 0.04, (r() - 0.5) * 0.08], r: [r() * 3, r() * 3, 0], c: greens[Math.floor(r() * greens.length)] })
      if (i < n - 1) parts.push({ g: icoG(0.04, 1), p: [x + (L - 0.32) / Math.max(1, n - 1) / 2, 0.66 + r() * 0.05, 0.12], c: BLOSSOMS[Math.floor(r() * BLOSSOMS.length)] })
    }
    return merge(parts)
  })
}

/**
 * Large planter (street / garden type, 50 cm): length Item.len (default 1.2 m, along x). Item.variant 'wood' (horizontal
 * board lines), 'concrete', 'corten' (weathering steel). Filled with soil, a row of shrubs and flowers.
 */
export function Planter({ v }: P) {
  const L = v.opts.len ?? 1.2
  const kind = PLANTER_BODY[v.opts.variant ?? ''] ? v.opts.variant! : 'wood'
  const c = PLANTER_BODY[kind]
  return (
    <group>
      <Box size={[L, 0.5, 0.5]} position={[0, 0.25, 0]} color={c} radius={kind === 'concrete' ? 0.04 : 0.008} />
      {kind === 'wood' && [0.13, 0.26, 0.39].map((y) => <Box key={y} size={[L + 0.006, 0.012, 0.506]} position={[0, y, 0]} color="#8a6440" shadow={false} />)}
      <Box size={[L - 0.08, 0.03, 0.42]} position={[0, 0.49, 0]} color="#6e5038" shadow={false} />
      <M g={planterPlants(L)} m={vcMat(0.85, true)} />
    </group>
  )
}

/* ---------- pergola / gazebo ---------- */

/** Pergola posts, beams, slats and a climbing plant on one corner (built once). */
function pergolaGeometry() {
  return cached('pergola', () => {
    const parts: Part[] = []
    for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4]) parts.push({ g: boxG(0.12, 2.4, 0.12), p: [x, 1.2, z], c: WOOD })
    for (const z of [-1.4, 1.4]) parts.push({ g: boxG(3.3, 0.16, 0.08), p: [0, 2.36, z], c: WOOD_DARK })
    for (let i = 0; i < 10; i++) parts.push({ g: boxG(0.06, 0.12, 3.3), p: [-1.5 + (i * 3) / 9, 2.5, 0], c: WOOD })
    const r = rng(12)
    const greens = [C.leaf, C.leafDark, '#4fae80']
    for (let i = 0; i < 9; i++) parts.push({ g: icoG(0.18 + r() * 0.1, 1), p: [-1.45 + r() * 1.3, 2.6 + r() * 0.08, 1.2 + r() * 0.35], c: greens[i % 3] })
    for (let i = 0; i < 4; i++) parts.push({ g: icoG(0.13, 1), p: [1.45 + (r() - 0.5) * 0.1, 0.5 + i * 0.5, 1.47], c: greens[i % 3] })
    return merge(parts)
  })
}

/** Gazebo white posts, roof frame and four-sided pitched roof (built once). */
function gazeboGeometry() {
  return cached('gazebo', () => {
    const parts: Part[] = []
    for (const x of [-1.35, 1.35]) for (const z of [-1.35, 1.35]) parts.push({ g: cylG(0.07, 2.3, 12), p: [x, 1.15, z], c: '#f4f2ee' })
    for (const z of [-1.35, 1.35]) parts.push({ g: boxG(2.86, 0.14, 0.1), p: [0, 2.3, z], c: '#f4f2ee' }, { g: boxG(0.1, 0.14, 2.86), p: [z, 2.3, 0], c: '#f4f2ee' })
    parts.push({ g: new THREE.ConeGeometry(2.25, 1.0, 4, 1), p: [0, 2.87, 0], r: [0, Math.PI / 4, 0], c: '#5f6680' })
    parts.push({ g: icoG(0.07, 1), p: [0, 3.4, 0], c: C.sun })
    // low railing between the posts (back and sides)
    for (const [x0, z0, x1, z1] of [
      [-1.35, -1.35, 1.35, -1.35],
      [-1.35, -1.35, -1.35, 1.35],
      [1.35, -1.35, 1.35, 1.35],
    ])
      parts.push(rod([x0, 0.8, z0], [x1, 0.8, z1], 0.03, '#f4f2ee'))
    return merge(parts)
  })
}

/**
 * Pergola / gazebo (3 × 3 m, ~2.6-3.4 m). Item.variant 'pergola' (default): four wooden posts, two beams, slatted roof,
 * a climbing plant on one corner; 'gazebo': white posts, dark four-sided pitched roof, low railing at the back and sides.
 * On the ceiling layer (rules.ts > CEILING): garden tables, benches and loungers go underneath.
 */
export function Pergola({ v }: P) {
  if (v.opts.variant === 'gazebo') return <M g={gazeboGeometry()} m={vcMat(0.75, true)} />
  return <M g={pergolaGeometry()} m={vcMat(0.8, true)} />
}

/* ---------- fountain ---------- */

const POOL_WATER = 0.36
const BOWL_Y = 0.92
const JET_N = 32
const SPILL_N = 32

const fountainRimGeo = () =>
  cached('fountain-rim', () =>
    latheG([
      [0.72, 0.26],
      [0.72, 0.42],
      [0.76, 0.46],
      [0.86, 0.46],
      [0.9, 0.42],
      [0.92, 0],
    ], 40),
  )
const fountainBowlGeo = () =>
  cached('fountain-bowl', () =>
    latheG([
      [0.0, 0.0],
      [0.18, 0.02],
      [0.33, 0.1],
      [0.4, 0.17],
      [0.38, 0.19],
      [0.32, 0.14],
      [0.0, 0.1],
    ], 32),
  )

/**
 * Garden fountain (Ø 1.8 m): round pool with a stone rim, a pedestal in the middle, a stone bowl and nozzle on top. While
 * the pump's plug or valve is on, water arcs from the nozzle into the bowl like a dome and spills from the bowl's edge
 * into the pool (one InstancedMesh), with ripples spreading in the pool; off, the water is still. Requests frames only
 * while on.
 */
export function Fountain({ v }: P) {
  const on = v.on
  const drops = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.Group>(null)
  const water = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5fb0e6', roughness: 0.08, metalness: 0.1 }), [])
  const spray = useMemo(() => new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.85, depthWrite: false }), [])
  useEffect(
    () => () => {
      water.dispose()
      spray.dispose()
    },
    [water, spray],
  )
  useAmbient(on)
  useFrame(({ clock }) => {
    const m = drops.current
    const g = rings.current
    if (!m || !g) return
    m.visible = on
    g.visible = on
    if (!on) return
    const t = clock.elapsedTime
    for (let i = 0; i < JET_N + SPILL_N; i++) {
      const jet = i < JET_N
      const k = jet ? i : i - JET_N
      const a = (k / (jet ? JET_N : SPILL_N)) * Math.PI * 2 * 3 + (jet ? 0 : 0.4)
      const ph = (t * (jet ? 0.9 : 0.7) + ((k * 7) % 16) / 16) % 1
      if (jet) {
        const r = 0.03 + ph * 0.26
        _o.position.set(Math.cos(a) * r, BOWL_Y + 0.28 + 0.62 * ph - 0.78 * ph * ph, Math.sin(a) * r)
        _o.scale.setScalar(0.018)
      } else {
        const r = 0.4 + ph * 0.12
        _o.position.set(Math.cos(a) * r, BOWL_Y + 0.17 - (BOWL_Y + 0.17 - POOL_WATER) * ph * ph, Math.sin(a) * r)
        _o.scale.set(0.014, 0.03, 0.014)
      }
      _o.updateMatrix()
      m.setMatrixAt(i, _o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    g.children.forEach((c, i) => {
      const ph = (t * 0.45 + i / 2) % 1
      c.scale.setScalar(0.5 + ph * 0.24)
      ;((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.5
    })
  })
  const stone = mat('#e6e1d6', { roughness: 0.85 })
  return (
    <group>
      <M g={fountainRimGeo()} m={stone} />
      <mesh rotation-x={-Math.PI / 2} position-y={POOL_WATER} material={water} receiveShadow>
        <circleGeometry args={[0.73, 40]} />
      </mesh>
      <Cyl r={0.15} rTop={0.1} h={BOWL_Y - POOL_WATER} position={[0, (BOWL_Y + POOL_WATER) / 2, 0]} material={stone} segments={20} />
      <M g={fountainBowlGeo()} m={stone} position={[0, BOWL_Y, 0]} />
      <mesh rotation-x={-Math.PI / 2} position-y={BOWL_Y + 0.15} material={water}>
        <circleGeometry args={[0.33, 32]} />
      </mesh>
      <Cyl r={0.045} rTop={0.03} h={0.16} position={[0, BOWL_Y + 0.2, 0]} material={stone} segments={14} />
      <Ball r={0.04} position={[0, BOWL_Y + 0.29, 0]} material={stone} detail={1} />
      <instancedMesh ref={drops} args={[dropGeo(), spray, JET_N + SPILL_N]} visible={false} frustumCulled={false} renderOrder={8} {...AID} />
      <group ref={rings} position={[0, POOL_WATER + 0.004, 0]} rotation-x={-Math.PI / 2} visible={false}>
        {[0, 1].map((i) => (
          <mesh key={i} renderOrder={6} {...AID}>
            <ringGeometry args={[0.92, 1, 40]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/* ---------- bird bath ---------- */

/** Bird bath (~0.8 m): stone pedestal and shallow bowl with water, a small blue bird on the rim. */
export function BirdBath() {
  const stone = mat('#e2ddd2', { roughness: 0.85 })
  const bowl = cached('birdbath-bowl', () =>
    latheG([
      [0.0, 0.0],
      [0.12, 0.01],
      [0.24, 0.06],
      [0.27, 0.1],
      [0.25, 0.11],
      [0.2, 0.08],
      [0.0, 0.06],
    ]),
  )
  return (
    <group>
      <Cyl r={0.16} rTop={0.13} h={0.06} position={[0, 0.03, 0]} material={stone} segments={20} />
      <Cyl r={0.09} rTop={0.06} h={0.62} position={[0, 0.37, 0]} material={stone} segments={16} />
      <M g={bowl} m={stone} position={[0, 0.68, 0]} />
      <Cyl r={0.21} h={0.004} position={[0, 0.77, 0]} color="#6cbbea" segments={28} shadow={false} />
      <group position={[0.21, 0.8, 0.05]} rotation={[0, -0.6, 0]}>
        <Ball r={0.04} scale={[1.4, 1, 1]} color="#6f8fd0" detail={1} />
        <Ball r={0.028} position={[0.045, 0.035, 0]} color="#6f8fd0" detail={1} />
        <Cyl r={0.008} rTop={0.001} h={0.03} position={[0.078, 0.035, 0]} rotation={[0, 0, -Math.PI / 2]} color={C.sun} segments={6} shadow={false} />
        <Box size={[0.05, 0.012, 0.03]} position={[-0.065, 0.012, 0]} rotation={[0, 0, 0.4]} color="#4f6fb5" shadow={false} />
      </group>
    </group>
  )
}

/* ---------- playground ---------- */

/**
 * Slide (0.8 × 2.8 m, ~2.2 m): ladder at the back (-z), platform at 1.2 m with railing and a small roof; a channel slide
 * running down forward (+z) from the platform. Slide color Item.body (default orange), frame in the brand blue.
 */
export function Slide({ v }: P) {
  const chute = mat(v.opts.body ?? '#f0a63a', { roughness: 0.35 })
  const frame = mat(C.brand, { roughness: 0.5 })
  const ang = Math.atan2(0.95, 1.95)
  const len = Math.hypot(0.95, 1.95)
  return (
    <group>
      {[-0.33, 0.33].flatMap((x) => [-1.25, -0.65].map((z) => <Box key={`${x}${z}`} size={[0.06, 1.95, 0.06]} position={[x, 0.975, z]} material={frame} />))}
      <Box size={[0.72, 0.06, 0.66]} position={[0, 1.2, -0.95]} color="#f4f2ee" radius={0.015} />
      {[-0.33, 0.33].map((x) => (
        <Box key={x} size={[0.04, 0.04, 0.66]} position={[x, 1.55, -0.95]} material={frame} />
      ))}
      <mesh position={[0, 2.12, -0.95]} rotation={[0, Math.PI / 4, 0]} material={mat(C.coral, { roughness: 0.6 })} castShadow>
        <coneGeometry args={[0.6, 0.34, 4]} />
      </mesh>
      {/* ladder */}
      {[-0.25, 0.25].map((x) => (
        <Box key={x} size={[0.05, 1.28, 0.05]} position={[x, 0.62, -1.36]} rotation={[-0.1, 0, 0]} material={frame} />
      ))}
      {[0.22, 0.47, 0.72, 0.97].map((y) => (
        <Box key={y} size={[0.5, 0.035, 0.06]} position={[0, y, -1.385 + y * 0.1]} color="#f4f2ee" shadow={false} />
      ))}
      {/* chute */}
      <group position={[0, (1.2 + 0.25) / 2, (-0.62 + 1.33) / 2]} rotation={[ang, 0, 0]}>
        <Box size={[0.5, 0.035, len]} material={chute} radius={0.012} />
        {[-0.26, 0.26].map((x) => (
          <Box key={x} size={[0.035, 0.13, len]} position={[x, 0.05, 0]} material={chute} radius={0.012} />
        ))}
      </group>
      <Box size={[0.5, 0.035, 0.18]} position={[0, 0.23, 1.38]} material={chute} radius={0.012} />
      {[-0.22, 0.22].map((x) => (
        <Box key={x} size={[0.04, 0.22, 0.04]} position={[x, 0.11, 1.32]} material={frame} />
      ))}
    </group>
  )
}

/** Fine grid of the trampoline net (white, alpha only; repeating). */
const netTexture = () =>
  cached('net-tex', () => {
    const N = 16
    const data = new Uint8Array(N * N * 4)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) data.set([255, 255, 255, x < 2 || y < 2 ? 200 : 18], (y * N + x) * 4)
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(48, 10)
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  })

/** Trampoline (Ø 2.5 m): six legs, blue edge pad, black jumping mat, safety net on eight poles (transparent grid). */
export function Trampoline() {
  const net = useMemo(() => new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.9 }), [])
  useEffect(() => () => net.dispose(), [net])
  const g = cached('trampoline', () => {
    const parts: Part[] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      parts.push(rod([Math.cos(a) * 1.18, 0, Math.sin(a) * 1.18], [Math.cos(a) * 1.2, 0.64, Math.sin(a) * 1.2], 0.025, '#2c3140'))
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2
      parts.push(rod([Math.cos(a) * 1.25, 0.6, Math.sin(a) * 1.25], [Math.cos(a) * 1.25, 2.25, Math.sin(a) * 1.25], 0.022, '#2c3140'))
    }
    parts.push({ g: new THREE.TorusGeometry(1.2, 0.08, 8, 48), p: [0, 0.66, 0], r: [Math.PI / 2, 0, 0], c: C.brand })
    parts.push({ g: new THREE.CircleGeometry(1.13, 40), p: [0, 0.655, 0], r: [-Math.PI / 2, 0, 0], c: '#23262f' })
    parts.push({ g: new THREE.TorusGeometry(1.25, 0.018, 6, 48), p: [0, 2.25, 0], r: [Math.PI / 2, 0, 0], c: '#2c3140' })
    return merge(parts)
  })
  return (
    <group>
      <M g={g} m={vcMat(0.7)} />
      <mesh position={[0, 1.45, 0]} material={net} renderOrder={2}>
        <cylinderGeometry args={[1.25, 1.25, 1.6, 40, 1, true]} />
      </mesh>
    </group>
  )
}

/** Sandbox (1.6 × 1.6 m): wooden frame, corner seats, sand, a small sandcastle, red bucket and blue shovel. */
export function Sandbox() {
  const g = cached('sandbox', () => {
    const parts: Part[] = []
    for (const s of [-1, 1]) parts.push({ g: boxG(1.6, 0.26, 0.07), p: [0, 0.13, s * 0.765], c: WOOD }, { g: boxG(0.07, 0.26, 1.46), p: [s * 0.765, 0.13, 0], c: WOOD })
    for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push({ g: boxG(0.28, 0.03, 0.28), p: [x * 0.66, 0.275, z * 0.66], c: WOOD_DARK })
    parts.push({ g: boxG(1.46, 0.18, 1.46), p: [0, 0.09, 0], c: '#ecd9a8' })
    parts.push({ g: icoG(0.22, 1), p: [-0.25, 0.18, 0.15], s: [1.3, 0.35, 1], c: '#e6d09a' })
    // castle: two towers with a keep between them
    parts.push({ g: boxG(0.22, 0.1, 0.12), p: [0.18, 0.23, -0.25], c: '#e1c98d' })
    for (const x of [0.06, 0.3]) parts.push({ g: cylG(0.05, 0.16, 10), p: [x, 0.26, -0.25], c: '#e1c98d' }, { g: new THREE.ConeGeometry(0.06, 0.08, 10), p: [x, 0.38, -0.25], c: '#e1c98d' })
    // bucket and shovel
    parts.push({ g: cylG(0.055, 0.12, 14, 0.07), p: [0.42, 0.24, 0.32], c: C.alarm }, { g: cylG(0.06, 0.012, 14), p: [0.42, 0.302, 0.32], c: '#c84438' })
    parts.push({ g: boxG(0.025, 0.02, 0.26), p: [-0.4, 0.19, -0.35], r: [0, 0.6, 0], c: C.brand }, { g: boxG(0.09, 0.012, 0.1), p: [-0.33, 0.19, -0.25], r: [0, 0.6, 0], c: C.brand })
    return merge(parts)
  })
  return <M g={g} m={vcMat(0.85)} />
}

/* ---------- street tree ---------- */

/** Tree grate, trunk and crown (once per kind). */
function streetTreeGeometry(kind: string) {
  return cached(`street-tree-${kind}`, () => {
    const parts: Part[] = []
    // cast grate: outer frame, short bars forming an inner ring, soil in the middle
    for (const s of [-1, 1]) parts.push({ g: boxG(1.2, 0.03, 0.08), p: [0, 0.015, s * 0.56], c: IRON }, { g: boxG(0.08, 0.03, 1.04), p: [s * 0.56, 0.015, 0], c: IRON })
    for (let i = 0; i < 9; i++) {
      const x = -0.44 + i * 0.11
      if (Math.abs(x) < 0.2) continue
      parts.push({ g: boxG(0.03, 0.025, 1.04), p: [x, 0.0125, 0], c: '#4a4f62' })
    }
    for (const z of [-0.44, -0.33, -0.22, 0.22, 0.33, 0.44]) parts.push({ g: boxG(0.36, 0.025, 0.03), p: [0, 0.0125, z], c: '#4a4f62' })
    parts.push({ g: cylG(0.2, 0.01, 18), p: [0, 0.005, 0], c: '#6e5038' })
    const r = rng(kind.length * 7 + 3)
    if (kind === 'columnar') {
      parts.push({ g: cylG(0.08, 1.2, 9, 0.06), p: [0, 0.6, 0], c: '#8b6545' })
      const greens = ['#2f7d5b', C.leafDark, '#357f60', '#3a8f68']
      for (let i = 0; i < 6; i++) parts.push({ g: icoG(0.42 - i * 0.04, 1), p: [(r() - 0.5) * 0.08, 1.35 + i * 0.5, (r() - 0.5) * 0.08], s: [1, 1.25, 1], r: [0, r() * 3, 0], c: greens[i % greens.length] })
    } else {
      parts.push({ g: cylG(0.09, 2.3, 10, 0.065), p: [0, 1.15, 0], c: '#8b6545' })
      parts.push(rod([0, 1.9, 0], [0.32, 2.5, 0.08], 0.04, '#8b6545', 7), rod([0, 2.0, 0], [-0.3, 2.55, -0.12], 0.035, '#8b6545', 7))
      const greens = [C.leaf, C.leafDark, '#4fae80', C.mint, '#45a173']
      parts.push({ g: icoG(0.62, 1), p: [0, 2.95, 0], c: greens[0] })
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r() * 0.4
        parts.push({ g: icoG(0.4 + r() * 0.1, 1), p: [Math.cos(a) * 0.5, 2.7 + r() * 0.45, Math.sin(a) * 0.5], r: [r() * 3, r() * 3, 0], c: greens[(i + 1) % greens.length] })
      }
      parts.push({ g: icoG(0.42, 1), p: [0.08, 3.5, 0.02], c: greens[3] })
    }
    return merge(parts)
  })
}

/**
 * Street tree (~3.9 m): 1.2 m square cast grate set into the sidewalk, slim trunk. Item.variant 'round' (default): a round
 * crown like a linden; 'columnar' a tall narrow crown like a cypress.
 */
export function StreetTree({ v }: P) {
  return <M g={streetTreeGeometry(v.opts.variant === 'columnar' ? 'columnar' : 'round')} m={vcMat(0.85, true)} />
}

/* ---------- utility pole ---------- */

/** Utility pole (~5.5 m). Item.variant 'wood' (default) or 'concrete': crossarm, insulators, transformer. */
export function UtilityPole({ v }: P) {
  const concrete = v.opts.variant === 'concrete'
  const g = cached(`pole-${concrete}`, () => {
    const pole = concrete ? '#c9cbd3' : '#8b6b4e'
    const arm = concrete ? '#9ea3b0' : '#6f5238'
    const parts: Part[] = [
      { g: cylG(0.13, 5.4, 12, 0.09), p: [0, 2.7, 0], c: pole },
      { g: boxG(1.7, 0.1, 0.1), p: [0, 5.05, 0], c: arm },
      rod([0, 4.6, 0], [0.55, 5.0, 0], 0.025, arm, 6),
      rod([0, 4.6, 0], [-0.55, 5.0, 0], 0.025, arm, 6),
      { g: cylG(0.2, 0.55, 16), p: [0, 4.0, 0.3], c: '#a9aebb' },
      { g: cylG(0.21, 0.04, 16), p: [0, 4.29, 0.3], c: '#8d93a3' },
      { g: boxG(0.1, 0.06, 0.18), p: [0, 4.0, 0.12], c: '#8d93a3' },
    ]
    for (const x of [-0.72, -0.25, 0.25, 0.72]) parts.push({ g: cylG(0.035, 0.12, 10, 0.025), p: [x, 5.16, 0], c: '#9fd3c7' })
    for (const x of [-0.08, 0.08]) parts.push({ g: cylG(0.025, 0.1, 8), p: [x, 4.36, 0.3], c: '#e9ebf3' })
    return merge(parts)
  })
  return <M g={g} m={vcMat(0.8)} />
}

/* ---------- outdoor shower ---------- */

const SHOWER_N = 48

/**
 * Outdoor shower: 80 cm wooden slatted floor, steel post at the back (-z), an arm reaching forward with a wide head on top,
 * a foot tap low down. While its valve or switch is on, drops fall from the head and the floor gets wet (requests frames
 * only while on).
 */
export function OutdoorShower({ v }: P) {
  const on = v.on
  const drops = useRef<THREE.InstancedMesh>(null)
  const spray = useMemo(() => new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.85, depthWrite: false }), [])
  useEffect(() => () => spray.dispose(), [spray])
  useAmbient(on)
  useFrame(({ clock }) => {
    const m = drops.current
    if (!m) return
    m.visible = on
    if (!on) return
    const t = clock.elapsedTime
    for (let i = 0; i < SHOWER_N; i++) {
      const ph = (t * 1.3 + (i * 0.618) % 1) % 1
      const a = i * 2.4
      const r = 0.02 + ((i * 37) % 10) / 100 + ph * 0.05
      _o.position.set(Math.cos(a) * r, 2.18 - ph * 2.1, 0.12 + Math.sin(a) * r)
      _o.scale.set(0.009, 0.035, 0.009)
      _o.updateMatrix()
      m.setMatrixAt(i, _o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  const deck = cached('shower-deck', () => merge(Array.from({ length: 6 }, (_, i) => ({ g: boxG(0.8, 0.04, 0.11), p: [0, 0.02, -0.34 + i * 0.136] as V3, c: i % 2 ? WOOD : WOOD_DARK }))))
  const steel = mat(v.unavailable ? DIM : '#c3c8d6', { roughness: 0.3, metalness: 0.25 })
  return (
    <group>
      <M g={deck} m={vcMat(0.8)} />
      <Cyl r={0.03} h={2.25} position={[0, 1.165, -0.3]} material={steel} segments={12} />
      <Cyl r={0.02} h={0.44} position={[0, 2.28, -0.08]} rotation={[Math.PI / 2, 0, 0]} material={steel} segments={10} />
      <Cyl r={0.12} rTop={0.06} h={0.05} position={[0, 2.24, 0.12]} material={steel} segments={24} />
      <Cyl r={0.015} h={0.14} position={[0, 0.42, -0.23]} rotation={[Math.PI / 2, 0, 0]} material={steel} segments={8} />
      <Box size={[0.08, 0.02, 0.03]} position={[0, 1.1, -0.26]} material={steel} shadow={false} />
      <instancedMesh ref={drops} args={[dropGeo(), spray, SHOWER_N]} visible={false} frustumCulled={false} renderOrder={8} {...AID} />
      {on && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.043} renderOrder={2} {...AID}>
          <circleGeometry args={[0.32, 28]} />
          <meshBasicMaterial color="#4a6f8f" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

/* ---------- road items ---------- */

/** Manhole cover pattern: dark cast iron, outer ring, inner ring and a diagonal grid. */
const manholeTexture = () =>
  canvasTexture('manhole', 256, 256, (g) => {
    g.fillStyle = '#555a6b'
    g.fillRect(0, 0, 256, 256)
    g.strokeStyle = '#6d7284'
    g.lineWidth = 6
    for (let i = -256; i < 512; i += 22) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + 256, 256)
      g.moveTo(i + 256, 0)
      g.lineTo(i, 256)
      g.stroke()
    }
    g.strokeStyle = '#7a7f90'
    g.lineWidth = 16
    g.beginPath()
    g.arc(128, 128, 116, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 8
    g.beginPath()
    g.arc(128, 128, 60, 0, Math.PI * 2)
    g.stroke()
  })

/** Manhole cover (Ø 64 cm): set into the road, cast iron cover raised 1.5 cm (can be driven over). */
export function Manhole() {
  const m = useMemo(() => new THREE.MeshStandardMaterial({ map: manholeTexture(), roughness: 0.6, metalness: 0.3 }), [])
  useEffect(() => () => m.dispose(), [m])
  return (
    <mesh position={[0, 0.008, 0]} material={m} receiveShadow>
      <cylinderGeometry args={[0.32, 0.33, 0.016, 36]} />
    </mesh>
  )
}

/** Speed bump: length Item.len (default 3 m, along x), 45 cm wide, 7 cm high; yellow and black segments (once per length). */
export function SpeedBump({ v }: P) {
  const L = v.opts.len ?? 3
  const g = useMemo(
    () =>
      cached(`bump-${L.toFixed(2)}`, () => {
        const n = Math.max(2, Math.round(L / 0.45))
        const w = L / n
        return merge(Array.from({ length: n }, (_, i) => ({ g: rboxG(w - 0.006, 0.07, 0.45, 0.03), p: [-L / 2 + w * (i + 0.5), 0.035, 0] as V3, c: i % 2 ? '#2a2d36' : C.sun })))
      }),
    [L],
  )
  return <M g={g} m={vcMat(0.6)} />
}

/** Traffic cone (~65 cm): dark square base, orange cone, two white reflective bands. */
export function TrafficCone() {
  const g = cached('cone', () => {
    const H = 0.62
    const r0 = 0.14
    const r1 = 0.025
    const at = (y: number) => r0 + (r1 - r0) * (y / H)
    const band = (y0: number, y1: number): Part => ({ g: cylG(at(y0) + 0.002, y1 - y0, 20, at(y1) + 0.002), p: [0, 0.03 + (y0 + y1) / 2, 0], c: '#f6f7fb' })
    return merge([{ g: rboxG(0.34, 0.03, 0.34, 0.01), p: [0, 0.015, 0], c: '#2a2d36' }, { g: cylG(r0, H, 20, r1), p: [0, 0.03 + H / 2, 0], c: '#f26b2a' }, band(0.24, 0.31), band(0.4, 0.45)])
  })
  return <M g={g} m={vcMat(0.55)} />
}

/* ---------- garden shed ---------- */

/** Triangular gable (front and back): w width, h height, t thickness; base at local y 0, thickness t along z. */
function gableGeo(w: number, h: number, t: number) {
  const s = new THREE.Shape().moveTo(-w / 2, 0).lineTo(w / 2, 0).lineTo(0, h).closePath()
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2)
}

/** Vertical board siding texture (white base, multiplied by the material color). */
const sidingTexture = () =>
  canvasTexture('siding', 128, 128, (g) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(40, 30, 20, 0.16)'
      g.fillRect(i * 16, 0, 2, 128)
      g.fillStyle = i % 2 ? 'rgba(255, 255, 255, 0)' : 'rgba(0, 0, 0, 0.03)'
      g.fillRect(i * 16 + 2, 0, 14, 128)
    }
  })

/**
 * Garden shed (2.2 × 1.8 m, ~2.4 m): body clad in vertical boards (color Item.body), dark gable roof, white framed double
 * door at the front, small window on the side. With a door sensor or lock bound, the doors swing outwards while open.
 */
export function GardenShed({ v }: P) {
  const color = v.opts.body ?? '#a6bc9d'
  const walls = useMemo(() => {
    const t = sidingTexture().clone()
    t.needsUpdate = true
    t.wrapS = THREE.RepeatWrapping
    t.repeat.set(2, 1)
    return new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.85 })
  }, [color])
  useEffect(
    () => () => {
      walls.map?.dispose()
      walls.dispose()
    },
    [walls],
  )
  const roof = cached('shed-roof', () =>
    merge([
      { g: boxG(2.42, 0.05, 1.12), p: [0, 2.15, 0.46], r: [0.46, 0, 0], c: '#5f6680' },
      { g: boxG(2.42, 0.05, 1.12), p: [0, 2.15, -0.46], r: [-0.46, 0, 0], c: '#5f6680' },
      { g: gableGeo(1.7, 0.45, 0.02), p: [1.05, 1.9, 0], r: [0, Math.PI / 2, 0], c: '#f4f2ee' },
      { g: gableGeo(1.7, 0.45, 0.02), p: [-1.05, 1.9, 0], r: [0, Math.PI / 2, 0], c: '#f4f2ee' },
    ]),
  )
  const open = v.bound && v.on
  const left = useEased(open ? -1.25 : 0)
  const right = useEased(open ? 1.25 : 0)
  const trim = '#f4f2ee'
  return (
    <group>
      <mesh position={[0, 0.95, 0]} material={walls} castShadow receiveShadow>
        <boxGeometry args={[2.1, 1.9, 1.7]} />
      </mesh>
      <M g={roof} m={vcMat(0.7)} />
      <Box size={[1.08, 1.66, 0.012]} position={[0, 0.85, 0.852]} color="#2a2d36" shadow={false} />
      <group ref={left} position={[-0.52, 0, 0.87]}>
        <Box size={[0.5, 1.6, 0.04]} position={[0.26, 0.84, 0]} color={trim} />
        <Box size={[0.025, 0.12, 0.03]} position={[0.46, 0.9, 0.03]} color={C.steel} shadow={false} />
      </group>
      <group ref={right} position={[0.52, 0, 0.87]}>
        <Box size={[0.5, 1.6, 0.04]} position={[-0.26, 0.84, 0]} color={trim} />
        <Box size={[0.025, 0.12, 0.03]} position={[-0.46, 0.9, 0.03]} color={C.steel} shadow={false} />
      </group>
      <Box size={[0.03, 0.48, 0.58]} position={[1.055, 1.3, 0]} color={trim} shadow={false} />
      <Box size={[0.035, 0.38, 0.48]} position={[1.06, 1.3, 0]} color="#bcd9f5" shadow={false} />
    </group>
  )
}

/* ---------- picnic table ---------- */

/** Picnic table (1.8 × 1.6 m): five-board top, attached benches on both sides, crossed A legs (one merged mesh). */
export function PicnicTable() {
  const g = cached('picnic', () => {
    const parts: Part[] = []
    for (let i = 0; i < 5; i++) parts.push({ g: rboxG(1.8, 0.045, 0.13, 0.01), p: [0, 0.75, -0.28 + i * 0.14], c: i % 2 ? WOOD : WOOD_DARK })
    for (const s of [-1, 1]) for (const k of [0, 1]) parts.push({ g: rboxG(1.8, 0.04, 0.12, 0.01), p: [0, 0.44, s * (0.56 + k * 0.13)], c: k ? WOOD_DARK : WOOD })
    for (const x of [-0.62, 0.62]) {
      parts.push({ g: boxG(0.06, 0.06, 1.56), p: [x, 0.39, 0], c: WOOD_DARK }, { g: boxG(0.06, 0.05, 0.7), p: [x, 0.705, 0], c: WOOD_DARK })
      parts.push(rod([x, 0, 0.6], [x, 0.72, -0.08], 0.035, WOOD_DARK, 6), rod([x, 0, -0.6], [x, 0.72, 0.08], 0.035, WOOD_DARK, 6))
    }
    return merge(parts)
  })
  return <M g={g} m={vcMat(0.8)} />
}
