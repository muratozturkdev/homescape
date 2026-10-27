import { useFrame, useThree, type ThreeElements } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { deviceClass, domainOf, isActive, lightColor, lightLevel, num } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { APERTURE_INSET, WALL_CUT_H, WALL_INNER_H } from '@/model/geometry'
import { roofView, useView } from '../camera'
import { markShadows } from '../frame'
import { Glow, Mist, Spin, useAmbient, useEased, useLitMaterial } from './effects'
import { C } from './palette'
import { Ball, Box, Cyl, mat, rng } from './primitives'
import { glowTexture, pegboardTexture, woodGrainTexture } from './textures'
import { gainOf, type Visual } from './visual'

/*
 * Garden, balcony, garage and building items: tree, bush, flower bed, garden lamp, string lights, sprinkler, robot mower,
 * barbecue, parasol, lounger, garden table, pool, hot tub, garden gate, fence, mailbox, solar panel, weather station,
 * swing, drying rack, awning; car, charging station, bicycle, motorcycle, workbench, tool board, metal shelf; stairs,
 * garage door. Local convention: origin at the center of the base on the floor, front faces +z, wall items have their back
 * at -z. Heavily repeated parts (leaves, fence boards, flowers, bulbs, steps) are one cached merged geometry: the selection
 * outline and box are measured from mesh geometry, so InstancedMesh is used only for effects outside the selection (drops,
 * bubbles).
 */

type P = { v: Visual }
type V3 = [number, number, number]
const DIM = '#9aa0b8'

/* ---------- shared helpers ---------- */

/** Part to merge: geometry, position, rotation (Euler or quaternion), scale, vertex color. */
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

/**
 * Merges parts into one geometry (one draw call, one shell for the selection). Parts with a color get vertex colors
 * (material uses vertexColors); uv is kept only for merges that use a texture.
 */
function merge(parts: Part[], uv = false) {
  const colored = parts.some((x) => x.c || x.g.attributes.color)
  const list = parts.map(({ g, p = [0, 0, 0], r = [0, 0, 0], q, s = 1, c }) => {
    const x = g.index ? g.toNonIndexed() : g.clone()
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color' && !(uv && name === 'uv')) x.deleteAttribute(name)
    if (typeof s === 'number') _s.setScalar(s)
    else _s.set(...s)
    x.applyMatrix4(_m.compose(_p.set(...p), q ?? _q.setFromEuler(_e.set(...r)), _s))
    // A part that already has colors (merged earlier) keeps them
    if (colored && (c || !x.attributes.color)) {
      _col.set(c ?? '#ffffff')
      const n = x.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = _col.r
        arr[i * 3 + 1] = _col.g
        arr[i * 3 + 2] = _col.b
      }
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

/** Rod (cylinder) part of radius r from a to b. */
function rod(a: V3, b: V3, r: number, c?: string, seg = 8): Part {
  _a.set(...a)
  _b.set(...b)
  const len = _a.distanceTo(_b)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, _b.sub(_a).normalize())
  return { g: cylG(r, len, seg), p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], q, c }
}

/** Cached geometries (built once per size or kind, never disposed). */
const geos = new Map<string, unknown>()
function cached<T>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined
  if (g === undefined) {
    g = make()
    geos.set(key, g)
  }
  return g
}

/** Shared material for the vertex colored merged geometries (built once, like the mat() cache). */
const vcMats = new Map<string, THREE.MeshStandardMaterial>()
function vcMat(roughness = 0.8, flat = false, double = false, metalness = 0) {
  const key = `${roughness}-${flat}-${double}-${metalness}`
  let m = vcMats.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, flatShading: flat, side: double ? THREE.DoubleSide : THREE.FrontSide })
    vcMats.set(key, m)
  }
  return m
}

/** Shared textured materials (wooden tops, steps): once per key. */
const texMats = new Map<string, THREE.Material>()
function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = texMats.get(key) as T | undefined
  if (!m) {
    m = make()
    texMats.set(key, m)
  }
  return m
}
const woodMat = (color: string) => sharedMat(`wood-${color}`, () => new THREE.MeshStandardMaterial({ map: woodGrainTexture(), color, roughness: 0.7 }))

type MeshProps = Omit<ThreeElements['mesh'], 'args' | 'material' | 'geometry' | 'ref'>
/** Mesh with a ready geometry and material (for merged parts). */
function M({ g, m, shadow = true, ...rest }: MeshProps & { g: THREE.BufferGeometry; m: THREE.Material; shadow?: boolean }) {
  return <mesh geometry={g} material={m} castShadow={shadow} receiveShadow {...rest} />
}

/** sRGB components of a color (0-1). */
function rgb01(hex: string): [number, number, number] {
  const n = parseInt(new THREE.Color(hex).getHexString(), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Repeating texture with every pixel written directly by f(u, v) => [r, g, b, a] (0-1, sRGB). No canvas gradients (see the
 * flicker note in textures.ts). Built once per key.
 */
const texCache = new Map<string, THREE.DataTexture>()
function pixelTexture(key: string, w: number, h: number, f: (u: number, v: number) => [number, number, number, number]) {
  let t = texCache.get(key)
  if (t) return t
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = f((x + 0.5) / w, (y + 0.5) / h)
      const i = (y * w + x) * 4
      for (let k = 0; k < 4; k++) data[i + k] = Math.round(Math.min(1, Math.max(0, px[k])) * 255)
    }
  t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.needsUpdate = true
  texCache.set(key, t)
  return t
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Eases towards a value and calls apply on every step (lid, flag, awning, garage door); requests frames and shadow updates
 * until it arrives. Snaps to the target on the first frame, and again when reset changes (the size changed).
 */
function useFollow(target: number, apply: (x: number) => void, speed = 3, reset?: unknown) {
  const cur = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    cur.current = null
    invalidate()
  }, [reset, invalidate])
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

/** First extra entity of this domain that is on (light, switch). */
const relatedOn = (v: Visual, domain: string) => v.related.find((e) => domainOf(e.entity_id) === domain && isActive(e))

/** Light that tints the water: the main entity if it is a light that is on, else an extra light that is on, else null. */
function tintLight(v: Visual) {
  if (v.bound && v.domain === 'light' && v.on) return { color: v.color, level: Math.max(0.3, v.level) }
  const e = relatedOn(v, 'light')
  return e ? { color: lightColor(e), level: Math.max(0.3, lightLevel(e)) * gainOf(v) } : null
}

/** Effect mesh: excluded from the selection box and from clicks. */
const AID = { userData: { selectionAid: true }, raycast: () => null } as const

/* ---------- tree ---------- */

const TRUNK = '#8b6545'
const TREE_KINDS = ['oak', 'pine', 'palm', 'olive']

/** Palm frond: a long leaf along local +x that arches and droops, folded along the middle; length 1, sized by scale. */
function frondGeometry() {
  return cached('frond', () => {
    const N = 12
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const y = 0.3 * Math.sin(t * Math.PI * 0.7) - 0.55 * t * t
      const hw = 0.13 * Math.pow(Math.sin(Math.min(1, t * 1.6) * (Math.PI / 2)), 0.8) * (1 - t * 0.85) + 0.01
      pos.push(t, y - hw * 0.25, -hw, t, y + hw * 0.18, 0, t, y - hw * 0.25, hw)
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
    return g
  })
}

/** The whole tree (trunk, branches, leaves) as one vertex colored geometry; once per kind, seeded (always the same). */
function treeGeometry(kind: string) {
  return cached(`tree-${kind}`, () => {
    const r = rng(17 + kind.length * 31)
    const parts: Part[] = []
    if (kind === 'pine') {
      parts.push({ g: cylG(0.13, 1.3, 9, 0.08), p: [0, 0.65, 0], c: TRUNK })
      const greens = ['#2f7d5b', C.leafDark, '#357f60', '#46a477', '#3a8f68']
      for (let i = 0; i < 5; i++) {
        const t = i / 4
        const rad = 0.78 - t * 0.52
        const h = 1.05 - t * 0.3
        parts.push({ g: new THREE.ConeGeometry(rad, h, 9), p: [0, 1.0 + i * 0.62 + h / 2, 0], r: [0, i * 0.7, 0], c: greens[i] })
      }
    } else if (kind === 'palm') {
      // Ringed, slightly curved trunk: segments alternate between two tones
      const pt = (t: number): V3 => [0.35 * t * t, 3.75 * t, 0]
      const n = 10
      for (let i = 0; i < n; i++) parts.push(rod(pt(i / n), pt((i + 1) / n), 0.13 - (i / n) * 0.045, i % 2 ? '#8a6a46' : '#a3825a', 9))
      const top = pt(1)
      const fr = frondGeometry()
      for (let i = 0; i < 9; i++) {
        const az = i * 2.39996 + r() * 0.3
        const up = 0.25 + r() * 0.35
        const len = 1.45 + r() * 0.35
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, az, up, 'YZX'))
        parts.push({ g: fr, p: [top[0], top[1] + 0.05, top[2]], q, s: len, c: i % 3 ? C.leaf : C.leafDark })
      }
      for (let i = 0; i < 3; i++) parts.push({ g: icoG(0.075, 1), p: [top[0] + Math.cos(i * 2.1) * 0.1, top[1] - 0.08, Math.sin(i * 2.1) * 0.1], c: '#7a5532' })
    } else if (kind === 'olive') {
      // Short, twisted trunk that forks in two; flattened gray green crown
      const bark = '#7d6a58'
      parts.push(rod([0, 0, 0], [0.08, 0.5, 0.03], 0.11, bark, 8), rod([0.08, 0.5, 0.03], [-0.04, 0.95, -0.05], 0.095, bark, 8))
      parts.push(rod([-0.04, 0.95, -0.05], [-0.32, 1.55, 0.14], 0.065, bark, 7), rod([-0.04, 0.95, -0.05], [0.3, 1.5, -0.1], 0.065, bark, 7), rod([-0.04, 0.95, -0.05], [0.04, 1.65, 0.05], 0.06, bark, 7))
      const greys = ['#8fa58a', '#a7b8a0', '#7b9276', '#98ad91']
      const blobs: [number, number, number, number][] = [[0, 1.95, 0, 0.55], [-0.38, 1.75, 0.18, 0.42], [0.36, 1.72, -0.12, 0.42], [0.1, 2.2, -0.15, 0.38], [-0.15, 2.15, 0.25, 0.35], [0.3, 2.0, 0.3, 0.33]]
      blobs.forEach(([x, y, z, rad], i) => parts.push({ g: icoG(rad, 1), p: [x, y, z], s: [1, 0.72, 1], r: [0, r() * 3, 0], c: greys[i % greys.length] }))
    } else {
      // Deciduous (oak style): thick trunk, two branches, clustered foliage balls
      parts.push({ g: cylG(0.17, 2.1, 10, 0.1), p: [0, 1.05, 0], c: TRUNK })
      parts.push(rod([0, 1.5, 0], [0.5, 2.25, 0.12], 0.06, TRUNK, 7), rod([0, 1.7, 0], [-0.45, 2.35, -0.15], 0.055, TRUNK, 7))
      const greens = [C.leaf, C.leafDark, '#4fae80', C.mint, '#45a173']
      parts.push({ g: icoG(0.8, 1), p: [0, 2.95, 0], c: greens[0] })
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + r() * 0.4
        const rad = 0.5 + r() * 0.14
        parts.push({ g: icoG(rad, 1), p: [Math.cos(a) * 0.62, 2.45 + r() * 0.5, Math.sin(a) * 0.62], r: [r() * 3, r() * 3, 0], c: greens[(i + 1) % greens.length] })
      }
      parts.push({ g: icoG(0.55, 1), p: [0.2, 3.55, -0.12], c: greens[3] }, { g: icoG(0.48, 1), p: [-0.28, 3.45, 0.22], c: greens[1] }, { g: icoG(0.42, 1), p: [0.05, 3.85, 0.05], c: greens[2] })
    }
    return merge(parts)
  })
}

/**
 * Tree (about 2.6-4.3 m; the crown may extend past the footprint). Kind Item.variant: 'oak' deciduous (trunk, branches,
 * clustered low poly foliage balls), 'pine' (stacked cones), 'palm' (ringed curved trunk, drooping fronds, coconuts),
 * 'olive' (short twisted trunk, gray green crown). One merged mesh, seeded: the same on every load.
 */
export function Tree({ v }: P) {
  const kind = TREE_KINDS.includes(v.opts.variant ?? '') ? v.opts.variant! : 'oak'
  return <M g={treeGeometry(kind)} m={vcMat(0.85, true, kind === 'palm')} />
}

/* ---------- bush ---------- */

/** Round bush: a few foliage balls with small flowers on top (built once). */
function roundBushGeometry() {
  return cached('bush-round', () => {
    const balls: [number, number, number, number, string][] = [
      [-0.2, 0.3, 0.02, 0.29, C.leaf],
      [0.2, 0.28, -0.03, 0.28, C.leafDark],
      [0, 0.42, 0, 0.32, '#4fae80'],
      [-0.08, 0.62, 0.04, 0.22, C.mint],
      [0.12, 0.56, -0.05, 0.2, C.leaf],
    ]
    const parts: Part[] = balls.map(([x, y, z, r, c], i) => ({ g: icoG(r, 1), p: [x, y, z], r: [i, i * 2, 0], c }))
    const r = rng(5)
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2
      const t = 0.3 + r() * 0.9
      parts.push({ g: icoG(0.035, 0), p: [Math.cos(a) * 0.28, 0.3 + t * 0.32, Math.sin(a) * 0.24 + 0.04], c: i % 2 ? '#ffffff' : '#ff8fc4' })
    }
    return merge(parts)
  })
}

/** Trimmed hedge: rounded box body with slight bumps on top and sides (once per length). */
function hedgeGeometry(L: number) {
  return cached(`hedge-${L.toFixed(2)}`, () => {
    const r = rng(Math.round(L * 100) + 3)
    const parts: Part[] = [{ g: rboxG(L, 1.0, 0.54, 0.09), p: [0, 0.52, 0], c: C.leafDark }]
    const greens = [C.leaf, '#4fae80', '#45a173', C.leafDark]
    const pick = () => greens[Math.floor(r() * greens.length)]
    // two rows on top and two layers on each side of irregular leaf clusters: the box shape stays, the surface looks bumpy
    const n = Math.max(2, Math.round((L - 0.1) / 0.2))
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 0.12 + (i * (L - 0.24)) / Math.max(1, n - 1)
      for (const z of [-0.13, 0.13]) parts.push({ g: icoG(0.17 + r() * 0.05, 1), p: [x + (r() - 0.5) * 0.08, 0.99 + r() * 0.03, z + (r() - 0.5) * 0.04], r: [0, r() * 3, 0], s: [1.1, 0.45, 1], c: pick() })
      for (const z of [-0.25, 0.25]) for (const y of [0.3, 0.68]) parts.push({ g: icoG(0.16 + r() * 0.05, 1), p: [x + (r() - 0.5) * 0.1, y + (r() - 0.5) * 0.12, z], r: [0, 0, r() * 3], s: [1.1, 1, 0.28], c: pick() })
    }
    return merge(parts)
  })
}

/**
 * Bush. Item.variant 'round' (default): a round bush of a few foliage balls with small flowers on top (~0.8 m).
 * 'hedge': trimmed hedge, length Item.len (default 1.5 m, along x), height ~1.1 m, depth 0.6 m.
 */
export function Bush({ v }: P) {
  if (v.opts.variant === 'hedge') return <M g={hedgeGeometry(v.opts.len ?? 1.5)} m={vcMat(0.9, true)} />
  return <M g={roundBushGeometry()} m={vcMat(0.9, true)} />
}

/* ---------- flower bed ---------- */

const BLOSSOMS = ['#ff6fae', C.coral, C.sun, '#b58cff', '#ffffff', '#ff8a3d', C.brandLight]

/** Flower bed flowers: two rows, each a stem, leaves at the base and a colored head (once per length, seeded). */
function flowersGeometry(L: number) {
  return cached(`flowers-${L.toFixed(2)}`, () => {
    const r = rng(Math.round(L * 100) + 11)
    const parts: Part[] = []
    const n = Math.max(3, Math.round((L - 0.16) / 0.14))
    for (const [row, z] of [[0, -0.11], [1, 0.11]] as const)
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + 0.1 + ((i + row * 0.5) * (L - 0.2)) / n
        const h = 0.16 + r() * 0.14
        const top: V3 = [x + (r() - 0.5) * 0.05, 0.12 + h, z + (r() - 0.5) * 0.05]
        parts.push(rod([x, 0.12, z], top, 0.007, C.leafDark, 5))
        parts.push({ g: icoG(0.05, 0), p: [x, 0.14, z], s: [1, 0.45, 1], c: r() > 0.5 ? C.leaf : '#4fae80' })
        parts.push({ g: icoG(0.038, 1), p: top, s: [1, 0.7, 1], c: BLOSSOMS[Math.floor(r() * BLOSSOMS.length)] })
      }
    return merge(parts)
  })
}

/** Flower bed border: four low boards or stones (once per length and kind). */
function bedBorderGeometry(L: number, stone: boolean) {
  return cached(`bed-border-${L.toFixed(2)}-${stone}`, () => {
    const h = 0.18
    const t = 0.05
    const g = (w: number, d: number) => (stone ? rboxG(w, h, d, 0.02) : boxG(w, h, d))
    return merge([
      { g: g(L, t), p: [0, h / 2, 0.3 - t / 2] },
      { g: g(L, t), p: [0, h / 2, -0.3 + t / 2] },
      { g: g(t, 0.6 - 2 * t), p: [L / 2 - t / 2, h / 2, 0] },
      { g: g(t, 0.6 - 2 * t), p: [-L / 2 + t / 2, h / 2, 0] },
    ])
  })
}

/**
 * Flower bed: length Item.len (default 1.5 m, along x), depth 0.6 m. Low border (Item.variant 'wood' or 'stone'), soil,
 * two rows of colorful flowers (stem, base leaves, head; one merged mesh).
 */
export function FlowerBed({ v }: P) {
  const L = v.opts.len ?? 1.5
  const stone = v.opts.variant === 'stone'
  return (
    <group>
      <M g={bedBorderGeometry(L, stone)} m={mat(stone ? '#cdd0da' : C.kraftDark, { roughness: 0.9 })} />
      <Box size={[L - 0.1, 0.12, 0.5]} position={[0, 0.06, 0]} color="#7a5a3c" />
      <M g={flowersGeometry(L)} m={vcMat(0.75, true)} />
    </group>
  )
}

/* ---------- garden lamp ---------- */

/** Light beam: full at the cone's tip (uv v = 1), fading towards its wide mouth (built once). */
const beamTexture = () => pixelTexture('beam', 4, 64, (_u, v) => [1, 1, 1, Math.pow(v, 1.6)])

/**
 * Garden lamp. Item.variant 'post' (default): ~1.1 m post with a lantern; 'bollard': ~0.6 m path light with a light band
 * on top; 'spike': ~0.15 m spotlight staked into the ground, facing up. The lamp follows v.on / v.color / v.level; at night
 * also a soft halo (a faint upward beam for the spotlight). Unavailable: the body is dimmed.
 */
export function GardenLight({ v }: P) {
  const kind = v.opts.variant === 'bollard' || v.opts.variant === 'spike' ? v.opts.variant : 'post'
  const body = v.unavailable ? DIM : '#2c3140'
  const lamp = useLitMaterial('#eef0f6', v.on, v.color, v.level, 1.8)
  const halo = v.on && v.night ? Math.min(0.9, 0.35 + 0.5 * v.level) : 0
  const beam = useMemo(
    // The beam fades from tip to mouth (no hard edge); very faint by day
    () => new THREE.MeshBasicMaterial({ map: beamTexture(), color: v.color, transparent: true, opacity: 0.12 * v.level * (v.night ? 1 : 0.25), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    [v.color, v.level, v.night],
  )
  useEffect(() => () => beam.dispose(), [beam])
  if (kind === 'bollard')
    return (
      <group>
        <Cyl r={0.085} h={0.03} position={[0, 0.015, 0]} color={body} segments={20} />
        <Cyl r={0.07} h={0.47} position={[0, 0.265, 0]} color={body} segments={20} />
        <Cyl r={0.066} h={0.08} position={[0, 0.54, 0]} material={lamp} segments={20} shadow={false} />
        <Cyl r={0.08} rTop={0.06} h={0.04} position={[0, 0.6, 0]} color={body} segments={20} />
        <Glow position={[0, 0.54, 0]} color={v.color} opacity={halo} size={0.8} />
      </group>
    )
  if (kind === 'spike')
    return (
      <group>
        <Cyl r={0.003} rTop={0.012} h={0.05} position={[0, 0.025, 0]} color={body} segments={8} shadow={false} />
        <Ball r={0.018} position={[0, 0.055, 0]} color={body} detail={1} shadow={false} />
        {/* spotlight housing facing up and slightly forward */}
        <group position={[0, 0.06, 0]} rotation-x={0.35}>
          <Cyl r={0.032} rTop={0.038} h={0.08} position={[0, 0.045, 0]} color={body} segments={16} />
          <Cyl r={0.032} h={0.006} position={[0, 0.087, 0]} material={lamp} segments={16} shadow={false} />
          {v.on && (
            <mesh position={[0, 0.09 + 0.45, 0]} rotation-x={Math.PI} material={beam} renderOrder={9} {...AID}>
              <coneGeometry args={[0.28, 0.9, 20, 1, true]} />
            </mesh>
          )}
        </group>
        <Glow position={[0, 0.15, 0.03]} color={v.color} opacity={halo} size={0.6} />
      </group>
    )
  return (
    <group>
      <Cyl r={0.09} h={0.04} position={[0, 0.02, 0]} color={body} segments={18} />
      <Cyl r={0.03} h={0.84} position={[0, 0.46, 0]} color={body} segments={12} />
      {/* lantern: base, lit glass, four corners, roof */}
      <Box size={[0.17, 0.025, 0.17]} position={[0, 0.89, 0]} color={body} />
      <Box size={[0.13, 0.17, 0.13]} position={[0, 0.99, 0]} material={lamp} shadow={false} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.018, 0.17, 0.018]} position={[sx * 0.068, 0.99, sz * 0.068]} color={body} shadow={false} />))}
      <Cyl r={0.125} rTop={0.012} h={0.09} position={[0, 1.12, 0]} rotation-y={Math.PI / 4} color={body} segments={4} />
      <Ball r={0.016} position={[0, 1.175, 0]} color={body} detail={1} shadow={false} />
      <Glow position={[0, 0.99, 0]} color={v.color} opacity={halo} size={1.1} />
    </group>
  )
}

/* ---------- string lights ---------- */

const POLE_H = 2.3
const SAG = 0.3

/** Catenary: height of the wire at x (POLE_H - 0.05 at the pole tops, sagging by SAG in the middle). */
function wireY(x: number, L: number) {
  const a = L * 0.6
  const k = (Math.cosh(x / a) - 1) / (Math.cosh(L / 2 / a) - 1)
  return POLE_H - 0.05 - SAG * (1 - k)
}

/** String light wire (tube), sockets and bulbs: once per length. Also returns the bulb positions for the halos. */
function stringGeometry(L: number) {
  return cached(`string-${L.toFixed(2)}`, () => {
    const span = L - 0.06
    const pts = Array.from({ length: 25 }, (_, i) => {
      const x = -span / 2 + (i / 24) * span
      return new THREE.Vector3(x, wireY(x, span), 0)
    })
    const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.005, 5)
    const n = Math.max(2, Math.floor(span / 0.3))
    const at: V3[] = Array.from({ length: n }, (_, i) => {
      const x = -span / 2 + ((i + 0.5) * span) / n
      return [x, wireY(x, span) - 0.06, 0]
    })
    const sockets = merge(at.map(([x, y, z]) => ({ g: cylG(0.012, 0.035, 8), p: [x, y + 0.035, z] as V3 })))
    const bulbs = merge(at.map(([x, y, z]) => ({ g: icoG(0.028, 1), p: [x, y, z] as V3, s: [1, 1.2, 1] as V3 })))
    const halo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(at.flat(), 3))
    return { wire, sockets, bulbs, halo }
  })
}

/**
 * Decorative string lights: length Item.len (default 3 m, along x). A slim ~2.3 m pole at each end, a wire sagging ~0.3 m
 * between them, a bulb every ~0.3 m (one merged mesh). The bulbs glow warm with v.on / v.color / v.level; at night a soft
 * halo around each bulb (a point cloud drawn in one call).
 */
export function StringLights({ v }: P) {
  const L = v.opts.len ?? 3
  const g = stringGeometry(L)
  const bulb = useLitMaterial('#f4efe0', v.on, v.color, v.level, 2)
  const halo = useMemo(
    () => new THREE.PointsMaterial({ map: glowTexture(), color: v.color, size: 0.9, sizeAttenuation: true, transparent: true, opacity: Math.min(1, 0.45 + 0.6 * v.level), depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [v.color, v.level],
  )
  useEffect(() => () => halo.dispose(), [halo])
  const pole = v.unavailable ? DIM : '#3a3f4f'
  return (
    <group>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (L / 2 - 0.03), 0, 0]}>
          <Cyl r={0.045} h={0.03} position={[0, 0.015, 0]} color={pole} segments={14} />
          <Cyl r={0.02} h={POLE_H} position={[0, POLE_H / 2, 0]} color={pole} segments={10} />
          <Ball r={0.025} position={[0, POLE_H + 0.01, 0]} color={pole} detail={1} shadow={false} />
        </group>
      ))}
      <M g={g.wire} m={mat(C.ink)} shadow={false} />
      <M g={g.sockets} m={mat('#2c3140')} shadow={false} />
      <M g={g.bulbs} m={bulb} shadow={false} />
      {v.on && v.night && <points geometry={g.halo} material={halo} renderOrder={10} {...AID} />}
    </group>
  )
}

/* ---------- sprinkler ---------- */

const JETS = 8
const DROPS = 64
const _o = new THREE.Object3D()

/**
 * Sprinkler head: a ring flush with the ground and a head that pops up while on. While on, water drops arc out in several
 * directions to a ~1.2 m radius (slowly rotating) and a wet patch appears around it. The drops are one InstancedMesh,
 * excluded from selection and clicks; frames are requested only while on.
 */
export function Sprinkler({ v }: P) {
  const on = v.on
  const drops = useRef<THREE.InstancedMesh>(null)
  const dropGeo = cached('drop', () => new THREE.SphereGeometry(1, 6, 5))
  const water = useMemo(() => new THREE.MeshBasicMaterial({ color: '#4fb0ff', transparent: true, opacity: 0.85, depthWrite: false }), [])
  useEffect(() => () => water.dispose(), [water])
  useAmbient(on)
  useFrame(({ clock }) => {
    const m = drops.current
    if (!m) return
    m.visible = on
    if (!on) return
    const t = clock.elapsedTime
    const per = DROPS / JETS
    for (let i = 0; i < DROPS; i++) {
      const j = i % JETS
      const ph = (t * 0.7 + Math.floor(i / JETS) / per + j * 0.13) % 1
      const a = (j / JETS) * Math.PI * 2 + t * 0.5
      const r = 0.05 + ph * 1.15
      _o.position.set(Math.cos(a) * r, 0.1 + 1.7 * ph * (1 - ph), Math.sin(a) * r)
      _o.scale.setScalar(0.032 * (1 - ph * 0.45))
      _o.updateMatrix()
      m.setMatrixAt(i, _o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  const body = v.unavailable ? DIM : '#3d4a3f'
  const rise = on ? 0.09 : 0.012
  return (
    <group>
      <Cyl r={0.075} h={0.02} position={[0, 0.01, 0]} color={body} segments={18} />
      <Cyl r={0.022} h={rise} position={[0, 0.02 + rise / 2, 0]} color={C.steel} segments={12} shadow={false} />
      <Cyl r={0.032} rTop={0.026} h={0.028} position={[0, 0.034 + rise, 0]} color={body} segments={12} shadow={false} />
      <instancedMesh ref={drops} args={[dropGeo, water, DROPS]} visible={false} frustumCulled={false} renderOrder={8} {...AID} />
      {on && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.004} renderOrder={2} {...AID}>
          <circleGeometry args={[1.2, 40]} />
          <meshBasicMaterial color="#5fa8d8" transparent opacity={0.12} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

/* ---------- robot mower ---------- */

const MOWER_DOCK = new THREE.Vector3(0, 0, 0.03)
const MOWER_DOCK_YAW = Math.PI
const _target = new THREE.Vector3()
const _prev = new THREE.Vector3()
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

/**
 * Robot lawn mower: charging station (base plate, post with an LED) and body (white shell, green cover, red stop button,
 * large rear wheels). While mowing (lawn_mower 'mowing' or v.on) it follows a smooth path within about ±1.5 m in front of
 * the station, turns towards its heading and spins the blade disc underneath; otherwise it returns to the station and
 * requests frames until it is docked. Docked and bound: the post LED is green (charging).
 */
export function LawnMower({ v }: P) {
  const body = useRef<THREE.Group>(null)
  const mowing = v.state === 'mowing' || v.on
  const invalidate = useThree((s) => s.invalidate)
  useAmbient(mowing)
  useEffect(() => invalidate(), [mowing, invalidate])
  useFrame((state, dt) => {
    const g = body.current
    if (!g) return
    const step = Math.min(dt, 0.1)
    if (!mowing && g.position.distanceToSquared(MOWER_DOCK) < 4e-6 && Math.abs(angleDiff(g.rotation.y, MOWER_DOCK_YAW)) < 0.002) return
    _prev.copy(g.position)
    if (mowing) {
      const t = state.clock.elapsedTime * 0.22
      _target.set(Math.sin(t) * 1.3, 0, 1.05 + Math.sin(t * 1.7 + 0.6) * 0.65)
    } else _target.copy(MOWER_DOCK)
    g.position.lerp(_target, Math.min(1, step * 2.5))
    // Turns towards its heading; near the station it turns to face the post (-z)
    const dx = g.position.x - _prev.x
    const dz = g.position.z - _prev.z
    let yaw = g.rotation.y
    if (!mowing && g.position.distanceTo(MOWER_DOCK) < 0.25) yaw = MOWER_DOCK_YAW
    else if (dx * dx + dz * dz > 1e-8) yaw = Math.atan2(dx, dz)
    g.rotation.y += angleDiff(yaw, g.rotation.y) * Math.min(1, step * 4)
    markShadows(1)
    if (!mowing) state.invalidate()
  })
  const docked = !mowing && v.state !== 'returning'
  const dockLed = useLitMaterial('#5a5f70', v.bound && !v.unavailable && docked, C.ok, 1, 2.4)
  const runLed = useLitMaterial('#5a5f70', mowing, C.ok, 1, 2.4)
  const shell = v.unavailable ? DIM : '#f1f2f6'
  return (
    <group>
      {/* station */}
      <Box size={[0.5, 0.012, 0.42]} position={[0, 0.006, 0]} color="#3a3f4c" radius={0.005} shadow={false} />
      <Box size={[0.17, 0.22, 0.05]} position={[0, 0.12, -0.19]} color="#3a3f4c" radius={0.02} />
      <Box size={[0.06, 0.012, 0.012]} position={[0, 0.2, -0.163]} material={dockLed} shadow={false} />
      {/* body (local +z is the driving direction) */}
      <group ref={body} position={[MOWER_DOCK.x, 0, MOWER_DOCK.z]} rotation-y={MOWER_DOCK_YAW}>
        <Box size={[0.34, 0.07, 0.36]} position={[0, 0.075, 0]} color="#2c3140" radius={0.025} />
        <Box size={[0.38, 0.11, 0.38]} position={[0, 0.15, 0.0]} color={shell} radius={0.05} />
        <Box size={[0.22, 0.02, 0.17]} position={[0, 0.21, -0.03]} color={C.leafDark} radius={0.008} shadow={false} />
        <Cyl r={0.028} h={0.02} position={[0, 0.215, 0.09]} color={C.alarm} segments={14} shadow={false} />
        <Ball r={0.01} position={[0.08, 0.208, 0.12]} material={runLed} shadow={false} />
        {[-1, 1].map((sx) => (
          <Cyl key={sx} r={0.085} h={0.045} position={[sx * 0.2, 0.085, -0.09]} rotation-z={Math.PI / 2} color="#23262e" segments={16} />
        ))}
        <Ball r={0.035} position={[0, 0.035, 0.13]} color="#23262e" detail={1} shadow={false} />
        <group position={[0, 0.03, 0.02]}>
          <Spin speed={mowing ? 14 : 0} axis="y">
            <Cyl r={0.1} h={0.006} color={C.steel} segments={16} shadow={false} />
            {[0, 1, 2].map((i) => (
              <Box key={i} size={[0.035, 0.004, 0.012]} position={[Math.cos((i * 2 * Math.PI) / 3) * 0.1, -0.004, Math.sin((i * 2 * Math.PI) / 3) * 0.1]} rotation-y={(-i * 2 * Math.PI) / 3} color={C.white} shadow={false} />
            ))}
          </Spin>
        </group>
      </group>
    </group>
  )
}

/* ---------- barbecue ---------- */

/** Barbecue coals: small lumps (built once). */
function coalsGeometry() {
  return cached('coals', () => {
    const r = rng(23)
    return merge(Array.from({ length: 16 }, () => {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * 0.17
      return { g: icoG(0.03 + r() * 0.012, 0), p: [Math.cos(a) * d, r() * 0.03, Math.sin(a) * d] as V3, r: [r() * 3, r() * 3, 0] as V3 }
    }))
  })
}

/** Kettle grill grate: a ring with parallel wires (built once). */
function kettleGrateGeometry() {
  return cached('kettle-grate', () => {
    const R = 0.235
    const parts: Part[] = [{ g: new THREE.TorusGeometry(R, 0.006, 5, 32), r: [Math.PI / 2, 0, 0] }]
    for (let i = -5; i <= 5; i++) {
      const z = i * 0.04
      const hw = Math.sqrt(Math.max(0, R * R - z * z))
      parts.push(rod([-hw, 0, z], [hw, 0, z], 0.004, undefined, 4))
    }
    return merge(parts)
  })
}

/** Gas grill grate: wires along the depth (built once). */
function gasGrateGeometry() {
  return cached('gas-grate', () => merge(Array.from({ length: 13 }, (_, i) => rod([-0.27 + i * 0.045, 0, -0.21], [-0.27 + i * 0.045, 0, 0.21], 0.005, undefined, 4))))
}

const bowlGeo = () => cached('kettle-bowl', () => new THREE.SphereGeometry(0.27, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2))
const lidGeo = () => cached('kettle-lid', () => new THREE.SphereGeometry(0.272, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2))
const hoodGeo = () => cached('gas-hood', () => new THREE.CylinderGeometry(0.24, 0.24, 0.6, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2))

/**
 * Barbecue (~1 m). Item.variant 'kettle' (default): round kettle on legs, hinged lid, ash catcher; 'gas': cart with a
 * cabinet, hinged hood, two side shelves, knobs. While on, the lid opens backwards, the coals / burners glow orange and
 * gray smoke rises (Mist); an orange halo at night.
 */
export function Grill({ v }: P) {
  const gas = v.opts.variant === 'gas'
  const on = v.on
  const lid = useRef<THREE.Group>(null)
  const fire = useLitMaterial('#3b3532', on, '#ff7a2a', 1, 1.7)
  const dark = v.unavailable ? DIM : '#2c3140'
  const steel = mat('#c3c8dc', { roughness: 0.35, metalness: 0.5 })
  const shell = mat(dark, { roughness: 0.45, metalness: 0.3 })
  const inner = useMemo(() => new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }), [dark])
  useEffect(() => () => inner.dispose(), [inner])
  useFollow(on ? (gas ? -1.25 : -1.7) : 0, (a) => {
    if (lid.current) lid.current.rotation.x = a
  })
  const top = gas ? 0.86 : 0.74
  const fx = (
    <>
      <group position={[0, top, 0]}>
        <Mist active={on} y={0.08} color="#8f949e" size={1.3} />
      </group>
      {on && <Glow position={[0, top, 0.05]} color="#ff8a3d" opacity={v.night ? 0.75 : 0.3} size={0.9} />}
    </>
  )
  if (gas)
    return (
      <group>
        {/* cart: cabinet, doors, feet */}
        <Box size={[0.58, 0.56, 0.46]} position={[0, 0.36, 0]} material={shell} radius={0.015} />
        {[-1, 1].map((sx) => (
          <group key={sx}>
            <Box size={[0.27, 0.46, 0.012]} position={[sx * 0.142, 0.36, 0.234]} material={steel} shadow={false} />
            <Box size={[0.015, 0.14, 0.02]} position={[sx * 0.03, 0.4, 0.248]} color={C.ink} shadow={false} />
          </group>
        ))}
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.035} h={0.08} position={[sx * 0.25, 0.04, sz * 0.19]} color={C.ink} segments={10} shadow={false} />))}
        {/* side shelves */}
        {[-1, 1].map((sx) => (
          <Box key={sx} size={[0.16, 0.025, 0.42]} position={[sx * 0.37, 0.8, 0]} material={steel} />
        ))}
        {/* firebox, burners, grate, knobs */}
        <Box size={[0.6, 0.2, 0.48]} position={[0, 0.74, 0]} material={shell} />
        {[-0.17, 0, 0.17].map((x) => (
          <Box key={x} size={[0.035, 0.012, 0.36]} position={[x, 0.846, 0]} material={fire} shadow={false} />
        ))}
        <M g={gasGrateGeometry()} m={steel} position={[0, 0.858, 0]} shadow={false} />
        {[-0.17, 0, 0.17].map((x) => (
          <Cyl key={x} r={0.022} h={0.025} position={[x, 0.72, 0.25]} rotation-x={Math.PI / 2} color={C.steel} segments={12} shadow={false} />
        ))}
        {/* hood: half cylinder hinged at the back */}
        <group ref={lid} position={[0, 0.84, -0.24]}>
          <group position={[0, 0, 0.24]} scale={[1, 0.72, 1]}>
            <mesh geometry={hoodGeo()} material={steel} castShadow receiveShadow />
          </group>
          <Cyl r={0.03} h={0.008} position={[0, 0.155, 0.36]} rotation-x={0.7} color={C.white} segments={14} shadow={false} />
          <Box size={[0.4, 0.022, 0.022]} position={[0, 0.08, 0.51]} color={C.ink} shadow={false} />
        </group>
        {fx}
      </group>
    )
  return (
    <group>
      {/* three legs, wheels, ash catcher */}
      {(
        [
          [0.3, 0.1],
          [-0.3, 0.1],
          [0, -0.24],
        ] as const
      ).map(([x, z]) => (
        <M key={`${x}${z}`} g={cached(`kettle-leg-${x}-${z}`, () => merge([rod([x * 0.62, 0.62, z * 0.75], [x, 0, z], 0.014)]))} m={shell} />
      ))}
      {[-1, 1].map((sx) => (
        <Cyl key={sx} r={0.055} h={0.03} position={[sx * 0.31, 0.055, 0.1]} rotation-z={Math.PI / 2} color={C.ink} segments={14} shadow={false} />
      ))}
      <Cyl r={0.1} rTop={0.11} h={0.035} position={[0, 0.32, 0]} material={steel} segments={18} />
      {/* kettle, coals, grate */}
      <mesh geometry={bowlGeo()} material={inner} position={[0, 0.75, 0]} castShadow receiveShadow />
      <M g={coalsGeometry()} m={fire} position={[0, 0.58, 0]} shadow={false} />
      <M g={kettleGrateGeometry()} m={steel} position={[0, 0.7, 0]} shadow={false} />
      <mesh position={[0, 0.75, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.27, 0.008, 6, 36]} />
        <meshStandardMaterial color={C.steel} metalness={0.5} roughness={0.35} />
      </mesh>
      {/* lid: hinged at the back, handle on top */}
      <group ref={lid} position={[0, 0.75, -0.27]}>
        <group position={[0, 0, 0.27]}>
          <mesh geometry={lidGeo()} material={inner} castShadow receiveShadow />
          <Box size={[0.13, 0.022, 0.03]} position={[0, 0.31, 0]} color={C.ink} shadow={false} />
          <Box size={[0.012, 0.04, 0.012]} position={[-0.05, 0.285, 0]} color={C.ink} shadow={false} />
          <Box size={[0.012, 0.04, 0.012]} position={[0.05, 0.285, 0]} color={C.ink} shadow={false} />
        </group>
      </group>
      {fx}
    </group>
  )
}

/* ---------- parasol ---------- */

const CANOPY_R = 1.3

/** Parasol ribs from the top to the edge and struts from the pole to the ribs (built once). */
function parasolRibsGeometry() {
  return cached('parasol-ribs', () => {
    const parts: Part[] = []
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8
      const sx = Math.sin(a)
      const sz = Math.cos(a)
      parts.push(rod([0, 2.52, 0], [sx * (CANOPY_R - 0.03), 2.15, sz * (CANOPY_R - 0.03)], 0.007, undefined, 5))
      parts.push(rod([0, 2.05, 0], [sx * 0.62, 2.33, sz * 0.62], 0.006, undefined, 5))
    }
    return merge(parts)
  })
}

/**
 * Parasol: heavy base, pole, octagonal canopy at ~2.2 m (radius ~1.3 m, extends past the footprint) with a valance at the
 * edge, ribs and struts underneath. Canopy color Item.body (default cream).
 */
export function Parasol({ v }: P) {
  const color = v.opts.body ?? '#f4efe6'
  const canopy = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }), [color])
  useEffect(() => () => canopy.dispose(), [canopy])
  const cone = cached('parasol-cone', () => new THREE.ConeGeometry(CANOPY_R, 0.38, 8, 1, true))
  const skirt = cached('parasol-skirt', () => new THREE.CylinderGeometry(CANOPY_R, CANOPY_R, 0.1, 8, 1, true))
  return (
    <group>
      <Cyl r={0.24} rTop={0.2} h={0.08} position={[0, 0.04, 0]} color="#4a4f5c" segments={24} />
      <Cyl r={0.022} h={2.5} position={[0, 1.27, 0]} color={C.white} segments={10} />
      <Cyl r={0.035} h={0.08} position={[0, 2.05, 0]} color={C.white} segments={10} shadow={false} />
      <mesh geometry={cone} material={canopy} position={[0, 2.35, 0]} rotation-y={Math.PI / 8} castShadow receiveShadow />
      <mesh geometry={skirt} material={canopy} position={[0, 2.11, 0]} rotation-y={Math.PI / 8} castShadow receiveShadow />
      <M g={parasolRibsGeometry()} m={mat(C.white)} shadow={false} />
      <Ball r={0.035} position={[0, 2.56, 0]} color={C.white} detail={1} shadow={false} />
    </group>
  )
}

/* ---------- lounger ---------- */

/**
 * Sun lounger: wooden frame (side rails, legs, wheels at the head end), slatted base, cushion; raised backrest with a small
 * pillow at the -z end. Cushion color Item.body (default light blue).
 */
export function Lounger({ v }: P) {
  const cushion = v.opts.body ?? C.brandPale
  const wood = C.kraft
  return (
    <group>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.31, 0, 0]}>
          <Box size={[0.05, 0.06, 1.86]} position={[0, 0.3, 0]} color={wood} />
          <Box size={[0.05, 0.28, 0.05]} position={[0, 0.14, 0.86]} color={wood} />
          <Box size={[0.05, 0.2, 0.05]} position={[0, 0.2, -0.8]} color={wood} />
          <Cyl r={0.08} h={0.035} position={[sx * 0.02, 0.08, -0.84]} rotation-z={Math.PI / 2} color={C.ink} segments={16} />
        </group>
      ))}
      <Box size={[0.6, 0.03, 1.24]} position={[0, 0.33, 0.32]} color={C.kraftDark} />
      <Box size={[0.62, 0.05, 0.05]} position={[0, 0.3, 0.9]} color={wood} />
      <Box size={[0.6, 0.08, 1.22]} position={[0, 0.385, 0.33]} color={cushion} radius={0.035} />
      {/* backrest: extends from the hinge towards -z, raised */}
      <group position={[0, 0.35, -0.28]} rotation-x={0.75}>
        <Box size={[0.58, 0.03, 0.62]} position={[0, 0, -0.31]} color={C.kraftDark} />
        <Box size={[0.6, 0.08, 0.62]} position={[0, 0.055, -0.31]} color={cushion} radius={0.035} />
        <Box size={[0.42, 0.09, 0.2]} position={[0, 0.13, -0.5]} color={C.white} radius={0.04} />
      </group>
      <M g={cached('lounger-strut', () => merge([rod([-0.22, 0.3, -0.6], [-0.22, 0.6, -0.55], 0.012), rod([0.22, 0.3, -0.6], [0.22, 0.6, -0.55], 0.012)]))} m={mat(C.kraftDark)} shadow={false} />
    </group>
  )
}

/* ---------- garden table ---------- */

/** Garden chair (local front +z): wooden seat and back slats, dark metal legs; four of them on the table's diagonals (built once). */
function patioChairsGeometry() {
  return cached('patio-chairs', () => {
    const metal = '#3a3f4f'
    const wood = C.kraft
    const chair = merge([
      { g: rboxG(0.44, 0.035, 0.42, 0.01), p: [0, 0.45, 0], c: wood },
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => rod([sx * 0.19, 0, sz * 0.18], [sx * 0.19, 0.44, sz * 0.18], 0.014, metal, 6))),
      rod([-0.19, 0.44, -0.18], [-0.2, 0.92, -0.24], 0.014, metal, 6),
      rod([0.19, 0.44, -0.18], [0.2, 0.92, -0.24], 0.014, metal, 6),
      ...[0.6, 0.71, 0.82].map((y): Part => ({ g: boxG(0.42, 0.06, 0.018), p: [0, y, -0.18 - (y - 0.44) * 0.125], r: [-0.12, 0, 0], c: wood })),
    ])
    const d = 0.66
    return merge(
      [0, 1, 2, 3].map((i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2
        const x = Math.cos(a) * d
        const z = Math.sin(a) * d
        return { g: chair, p: [x, 0, z] as V3, r: [0, Math.atan2(-x, -z), 0] as V3 }
      }),
    )
  })
}

/**
 * Garden table: round wooden top ~1 m across, single leg with a cross base, parasol hole in the middle; four chairs on the
 * diagonals facing the table (one merged mesh).
 */
export function OutdoorTable() {
  return (
    <group>
      <Cyl r={0.5} h={0.04} position={[0, 0.73, 0]} material={woodMat(C.kraft)} segments={36} />
      <Cyl r={0.502} h={0.012} position={[0, 0.704, 0]} color={C.kraftDark} segments={36} shadow={false} />
      <Cyl r={0.025} h={0.003} position={[0, 0.751, 0]} color={C.ink} segments={12} shadow={false} />
      <Cyl r={0.035} h={0.7} position={[0, 0.36, 0]} color="#3a3f4f" segments={12} />
      <Box size={[0.6, 0.03, 0.06]} position={[0, 0.015, 0]} rotation-y={Math.PI / 4} color="#3a3f4f" />
      <Box size={[0.6, 0.03, 0.06]} position={[0, 0.015, 0]} rotation-y={-Math.PI / 4} color="#3a3f4f" />
      <M g={patioChairsGeometry()} m={vcMat(0.7)} />
    </group>
  )
}

/* ---------- pool ---------- */

const COPING = 0.15

/** Pool water texture: dark blue in the middle, lighter towards the edges, a light tile band at the edge, a dark lane line on the bottom (once per size). */
function poolTexture(w: number, d: number) {
  const W = w >= d ? 256 : Math.max(32, Math.round((256 * w) / d))
  const H = w >= d ? Math.max(32, Math.round((256 * d) / w)) : 256
  const deep = rgb01('#1f6fd1')
  const light = rgb01('#86d6f5')
  const tile = rgb01('#d9f3fb')
  const lane = rgb01('#1650a8')
  return pixelTexture(`pool-${w.toFixed(1)}x${d.toFixed(1)}`, W, H, (u, v) => {
    const x = u * w
    const z = v * d
    const e = Math.min(x, w - x, z, d - z)
    if (e < 0.05) return [...tile, 1]
    const t = smooth(0.05, 0.9, e)
    const long = w >= d
    const across = long ? Math.abs(z - d / 2) : Math.abs(x - w / 2)
    const along = long ? Math.min(x, w - x) : Math.min(z, d - z)
    const k = across < 0.05 && along > 0.6 ? 0.85 : 0
    return [mix(mix(light[0], deep[0], t), lane[0], k), mix(mix(light[1], deep[1], t), lane[1], k), mix(mix(light[2], deep[2], t), lane[2], k), 1]
  })
}

/** Underwater caustics: wavy, crossing light lines; tiles seamlessly (built once). */
function causticTexture() {
  return pixelTexture('caustic', 256, 256, (u, v) => {
    const P2 = Math.PI * 2
    const n1 = Math.sin(P2 * (2 * u + 0.35 * Math.sin(P2 * (2 * v + 0.3 * Math.sin(P2 * u)))))
    const n2 = Math.sin(P2 * (2 * v + 0.35 * Math.sin(P2 * (2 * u + 0.25 * Math.sin(P2 * v)))))
    const c = Math.exp(-((n1 / 0.2) ** 2)) + Math.exp(-((n2 / 0.2) ** 2))
    return [1, 1, 1, Math.min(1, c) * 0.6]
  })
}

/** Pool coping (stone edge), once per size. */
function copingGeometry(w: number, d: number) {
  return cached(`coping-${w.toFixed(2)}x${d.toFixed(2)}`, () =>
    merge([
      { g: rboxG(w, 0.05, COPING, 0.015), p: [0, 0.025, d / 2 - COPING / 2] },
      { g: rboxG(w, 0.05, COPING, 0.015), p: [0, 0.025, -d / 2 + COPING / 2] },
      { g: boxG(COPING, 0.05, d - 2 * COPING), p: [w / 2 - COPING / 2, 0.025, 0] },
      { g: boxG(COPING, 0.05, d - 2 * COPING), p: [-w / 2 + COPING / 2, 0.025, 0] },
    ]),
  )
}

/** The two curved pool ladder rails: rise from the water and bend over the coping (built once). */
function poolLadderGeometry() {
  return cached('pool-ladder', () => {
    const pts = (x: number) =>
      [
        [x, 0.02, 0.1],
        [x, 0.6, 0.1],
        [x, 0.76, 0.07],
        [x, 0.8, 0],
        [x, 0.76, -0.07],
        [x, 0.6, -0.08],
        [x, 0.05, -0.08],
      ].map(([a, b, c]) => new THREE.Vector3(a, b, c))
    return merge([-0.22, 0.22].map((x) => ({ g: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(x)), 24, 0.02, 8) })))
  })
}

/**
 * Pool: width Item.len (default 4 m, x), length Item.len2 (2.5 m, z). The ground cannot be cut, so it sits flush with the
 * surface: ~15 cm stone coping (top at ~5 cm), the water surface (dark middle, light blue edges, lane line), caustics and a
 * ladder on top. While the pump runs (main entity a switch that is on, or an extra switch that is on) the caustics drift
 * slowly. With a light bound (main entity a light that is on, or an extra light that is on) the water glows in that
 * light's color; a halo above it at night.
 */
export function Pool({ v }: P) {
  const w = Math.max(1, v.opts.len ?? 4)
  const d = Math.max(1, v.opts.len2 ?? 2.5)
  const iw = w - 2 * COPING
  const id = d - 2 * COPING
  const pump = (v.domain === 'switch' && v.on) || Boolean(relatedOn(v, 'switch'))
  const light = tintLight(v)
  const lc = light?.color
  const ll = light?.level ?? 0
  const tex = poolTexture(w, d)
  const water = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.12,
        metalness: 0.1,
        emissive: lc ?? '#000000',
        emissiveMap: lc ? tex : null,
        emissiveIntensity: lc ? ll * (v.night ? 0.9 : 0.45) : 0,
      }),
    [tex, lc, ll, v.night],
  )
  const caustic = useMemo(() => {
    const t = causticTexture().clone()
    t.needsUpdate = true
    t.repeat.set(iw / 1.4, id / 1.4)
    return { t, m: new THREE.MeshBasicMaterial({ map: t, color: '#e8fbff', transparent: true, opacity: 0.5, depthWrite: false }) }
  }, [iw, id])
  useEffect(() => () => water.dispose(), [water])
  useEffect(
    () => () => {
      caustic.t.dispose()
      caustic.m.dispose()
    },
    [caustic],
  )
  const overlay = useRef<THREE.Mesh>(null)
  useAmbient(pump, true)
  useFrame((_, dt) => {
    const map = (overlay.current?.material as THREE.MeshBasicMaterial | undefined)?.map
    if (!pump || !map) return
    const s = Math.min(dt, 0.1)
    map.offset.x = (map.offset.x + s * 0.035) % 1
    map.offset.y = (map.offset.y + s * 0.022) % 1
  })
  return (
    <group>
      <M g={copingGeometry(w, d)} m={mat('#e8e4da', { roughness: 0.9 })} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} material={water} receiveShadow>
        <planeGeometry args={[iw, id]} />
      </mesh>
      <mesh ref={overlay} rotation-x={-Math.PI / 2} position-y={0.024} material={caustic.m} renderOrder={3} {...AID}>
        <planeGeometry args={[iw, id]} />
      </mesh>
      <M g={poolLadderGeometry()} m={mat(C.steel, { roughness: 0.25, metalness: 0.6 })} position={[w / 2 - 0.7, 0, -d / 2 + COPING]} />
      {light && v.night && <Glow position={[0, 0.25, 0]} color={light.color} opacity={Math.min(0.8, light.level * 0.6)} size={Math.min(iw, id) * 1.6} />}
    </group>
  )
}

/* ---------- hot tub ---------- */

const TUB_WATER = 0.82
const BUBBLES = 28
const BUBBLE_SEEDS = (() => {
  const r = rng(41)
  return Array.from({ length: BUBBLES }, () => ({ x: (r() - 0.5) * 1.3, z: (r() - 0.5) * 1.3, ph: r(), sp: 0.6 + r() * 0.6 }))
})()

/** Hot tub rim: a four-piece frame (built once). */
function tubRimGeometry() {
  return cached('tub-rim', () =>
    merge([
      { g: rboxG(2.0, 0.12, 0.2, 0.03), p: [0, 0.84, 0.9] },
      { g: rboxG(2.0, 0.12, 0.2, 0.03), p: [0, 0.84, -0.9] },
      { g: boxG(0.2, 0.12, 1.6), p: [0.9, 0.84, 0] },
      { g: boxG(0.2, 0.12, 1.6), p: [-0.9, 0.84, 0] },
    ]),
  )
}

/**
 * Hot tub (2 × 2 m, ~0.9 m): wood-clad body with rounded corners, light rim, two headrests, a control panel on the edge;
 * water at ~0.8 m. While on (v.on) bubbles boil on the surface (one InstancedMesh) and light steam rises (Mist). If the
 * main entity is a light that is on, or an extra light is on, the water glows in that color; a halo above it at night.
 */
export function HotTub({ v }: P) {
  const on = v.on
  const light = tintLight(v)
  const lc = light?.color
  const ll = light?.level ?? 0
  const bubbles = useRef<THREE.InstancedMesh>(null)
  const bubbleGeo = cached('bubble', () => new THREE.SphereGeometry(1, 8, 6))
  const foam = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false }), [])
  const water = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3aa9e6',
        roughness: 0.1,
        metalness: 0.1,
        transparent: true,
        opacity: 0.88,
        emissive: lc ?? '#000000',
        emissiveIntensity: lc ? ll * (v.night ? 1 : 0.3) : 0,
      }),
    [lc, ll, v.night],
  )
  useEffect(
    () => () => {
      foam.dispose()
      water.dispose()
    },
    [foam, water],
  )
  const led = useLitMaterial('#5a5f70', on, C.cool, 1, 2.2)
  useAmbient(on)
  useFrame(({ clock }) => {
    const m = bubbles.current
    if (!m) return
    m.visible = on
    if (!on) return
    const t = clock.elapsedTime
    BUBBLE_SEEDS.forEach((b, i) => {
      const ph = (t * b.sp + b.ph) % 1
      _o.position.set(b.x + Math.sin(t * 2 + i) * 0.02, TUB_WATER - 0.02 + ph * 0.05, b.z)
      _o.scale.setScalar(0.012 + Math.sin(ph * Math.PI) * 0.03)
      _o.updateMatrix()
      m.setMatrixAt(i, _o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })
  const shell = v.unavailable ? mat(DIM) : woodMat('#a07c5a')
  return (
    <group>
      <Box size={[1.96, 0.78, 1.96]} position={[0, 0.39, 0]} material={shell} radius={0.12} />
      <M g={tubRimGeometry()} m={mat('#eef0f5', { roughness: 0.4 })} />
      <Box size={[1.6, 0.01, 1.6]} position={[0, 0.785, 0]} color="#bfe6f5" shadow={false} />
      <mesh rotation-x={-Math.PI / 2} position-y={TUB_WATER} material={water} renderOrder={3}>
        <planeGeometry args={[1.6, 1.6]} />
      </mesh>
      {[-0.45, 0.45].map((x) => (
        <Box key={x} size={[0.32, 0.06, 0.13]} position={[x, 0.93, -0.86]} color="#3a3f4c" radius={0.03} shadow={false} />
      ))}
      <Box size={[0.2, 0.025, 0.1]} position={[0.62, 0.912, 0.9]} color="#3a3f4c" radius={0.01} shadow={false} />
      <Box size={[0.06, 0.008, 0.02]} position={[0.62, 0.928, 0.9]} material={led} shadow={false} />
      <instancedMesh ref={bubbles} args={[bubbleGeo, foam, BUBBLES]} visible={false} frustumCulled={false} renderOrder={4} {...AID} />
      <group position={[0, TUB_WATER, 0]}>
        <Mist active={on} y={0.05} color="#ffffff" size={1.7} />
      </group>
      {light && v.night && <Glow position={[0, 1.0, 0]} color={light.color} opacity={Math.min(0.8, light.level * 0.6)} size={2.2} />}
    </group>
  )
}

/* ---------- garden gate ---------- */

const coverOpen = (state: string, attrs: Record<string, unknown>) => state === 'open' || state === 'opening' || (num(attrs.current_position) ?? 0) > 0
const CONTACT = ['door', 'opening', 'garage_door', 'window', '']

/** Is this the gate's contact sensor or motor (a cover, or a door / opening sensor). */
const isContact = (e: HassEntity) => {
  const d = domainOf(e.entity_id)
  return d === 'cover' || (d === 'binary_sensor' && CONTACT.includes(deviceClass(e)))
}

/**
 * Is the garden gate open: from the opening state if there is one (main entity a cover or binary_sensor, an extra cover or
 * door sensor); otherwise when the lock (main or extra) is unlocked / open.
 */
function gateOpen(v: Visual) {
  const contacts = v.related.filter(isContact)
  const main = v.domain === 'cover' || v.domain === 'binary_sensor'
  if (main || contacts.length) {
    const own = v.domain === 'cover' ? coverOpen(v.state, v.attrs) : v.domain === 'binary_sensor' && v.on
    return own || contacts.some((e) => (domainOf(e.entity_id) === 'cover' ? coverOpen(e.state, e.attributes) : isActive(e)))
  }
  const lock = v.domain === 'lock' ? v.state : v.related.find((e) => domainOf(e.entity_id) === 'lock')?.state
  return lock === 'unlocked' || lock === 'open'
}

/** Gate leaf (hinge at local x 0, 0.98 m wide): wood has a frame, vertical boards and a diagonal brace; metal a frame and bars (built once). */
function gateLeafGeometry(metal: boolean) {
  return cached(`gate-${metal}`, () => {
    const W = 0.98
    const parts: Part[] = []
    if (metal) {
      const c = '#2f3442'
      parts.push({ g: boxG(0.04, 1.0, 0.04), p: [0.02, 0.55, 0], c }, { g: boxG(0.04, 1.0, 0.04), p: [W - 0.02, 0.55, 0], c })
      parts.push({ g: boxG(W, 0.04, 0.04), p: [W / 2, 0.07, 0], c }, { g: boxG(W, 0.04, 0.04), p: [W / 2, 1.03, 0], c }, { g: boxG(W, 0.03, 0.03), p: [W / 2, 0.85, 0], c })
      for (let i = 1; i < 10; i++) {
        const x = (i * W) / 10
        parts.push({ g: cylG(0.009, 0.96, 6), p: [x, 0.55, 0], c }, { g: new THREE.ConeGeometry(0.018, 0.05, 6), p: [x, 1.075, 0], c })
      }
    } else {
      const c = C.kraft
      const dark = C.kraftDark
      for (let i = 0; i < 8; i++) parts.push({ g: boxG(0.105, 0.98, 0.022), p: [0.06 + i * 0.123, 0.56, 0.012], c: i % 2 ? c : '#e0b47c' })
      parts.push({ g: boxG(W, 0.08, 0.03), p: [W / 2, 0.22, -0.014], c: dark }, { g: boxG(W, 0.08, 0.03), p: [W / 2, 0.9, -0.014], c: dark })
      parts.push({ g: boxG(Math.hypot(W - 0.1, 0.6), 0.07, 0.028), p: [W / 2, 0.56, -0.014], r: [0, 0, Math.atan2(0.6, W - 0.1)], c: dark })
    }
    parts.push({ g: boxG(0.05, 0.03, 0.06), p: [W - 0.04, 0.8, 0.03], c: C.ink })
    return merge(parts)
  })
}

/**
 * Garden gate (1.2 m): two posts and a single leaf swinging on the hinge at -x (Item.variant 'wood' boards, 'metal' bars).
 * Open: cover open / opening or position > 0; lock unlocked / open; binary_sensor on (an extra door sensor or motor takes
 * precedence). The leaf swings smoothly ~85° forward (+z).
 */
export function Gate({ v }: P) {
  const metal = v.opts.variant === 'metal'
  const leaf = useEased(gateOpen(v) ? -1.48 : 0, 3)
  const post = metal ? '#2f3442' : C.kraftDark
  return (
    <group>
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.55, 0, 0]}>
          <Box size={[0.1, 1.2, 0.1]} position={[0, 0.6, 0]} color={post} />
          {metal ? <Ball r={0.045} position={[0, 1.24, 0]} color={post} detail={1} shadow={false} /> : <Cyl r={0.075} rTop={0.01} h={0.07} position={[0, 1.235, 0]} rotation-y={Math.PI / 4} color={post} segments={4} shadow={false} />}
        </group>
      ))}
      {[0.25, 0.85].map((y) => (
        <Box key={y} size={[0.05, 0.06, 0.04]} position={[-0.49, y, 0]} color={C.ink} shadow={false} />
      ))}
      <group ref={leaf} position={[-0.495, 0, 0]}>
        <M g={gateLeafGeometry(metal)} m={vcMat(metal ? 0.45 : 0.8, false, false, metal ? 0.4 : 0)} />
      </group>
    </group>
  )
}

/* ---------- fence ---------- */

/** Fence parts, once per kind and length: wood has posts, rails and pointed boards; metal posts, rails and bars; glass steel posts and a handrail. */
function fenceGeometry(kind: string, L: number) {
  return cached(`fence-${kind}-${L.toFixed(2)}`, () => {
    const posts = Math.max(1, Math.round(L / 1.2))
    const postX = Array.from({ length: posts + 1 }, (_, i) => -L / 2 + 0.035 + (i * (L - 0.07)) / posts)
    if (kind === 'glass') {
      const steel = merge([...postX.map((x): Part => ({ g: boxG(0.05, 1.0, 0.05), p: [x, 0.5, 0] })), { g: rboxG(L, 0.04, 0.07, 0.015), p: [0, 1.02, 0] }])
      const glass = merge(postX.slice(1).map((x, i): Part => ({ g: boxG(x - postX[i] - 0.07, 0.86, 0.014), p: [(x + postX[i]) / 2, 0.52, 0] })))
      return { a: steel, b: glass }
    }
    if (kind === 'metal') {
      const c = '#2f3442'
      const parts: Part[] = [...postX.map((x): Part => ({ g: boxG(0.06, 1.06, 0.06), p: [x, 0.53, 0] })), { g: boxG(L, 0.04, 0.03), p: [0, 0.1, 0] }, { g: boxG(L, 0.04, 0.03), p: [0, 0.95, 0] }]
      const n = Math.max(2, Math.round(L / 0.11))
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + ((i + 0.5) * L) / n
        parts.push({ g: cylG(0.009, 0.85, 6), p: [x, 0.525, 0] }, { g: icoG(0.018, 0), p: [x, 0.985, 0] })
      }
      return { a: merge(parts.map((p) => ({ ...p, c }))), b: null }
    }
    const parts: Part[] = [...postX.map((x): Part => ({ g: boxG(0.07, 1.05, 0.07), p: [x, 0.525, 0], c: C.kraftDark })), { g: boxG(L, 0.06, 0.025), p: [0, 0.3, -0.012], c: C.kraftDark }, { g: boxG(L, 0.06, 0.025), p: [0, 0.8, -0.012], c: C.kraftDark }]
    const n = Math.max(2, Math.round(L / 0.12))
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + ((i + 0.5) * L) / n
      parts.push({ g: boxG(0.08, 0.9, 0.02), p: [x, 0.5, 0.012], c: '#e2c08f' }, { g: new THREE.ConeGeometry(0.0566, 0.07, 4), p: [x, 0.985, 0.012], r: [0, Math.PI / 4, 0], s: [1, 1, 0.25], c: '#e2c08f' })
    }
    return { a: merge(parts), b: null }
  })
}

/**
 * Fence: length Item.len (default 2 m, along x), ~1 m high. Item.variant 'wood' (default): posts, two rails, pointed
 * boards; 'metal': dark posts, rails, bars with ball tips; 'glass': balcony glass panels, steel posts and a top handrail.
 * Repeated parts are one merged mesh per kind and length.
 */
export function Fence({ v }: P) {
  const L = v.opts.len ?? 2
  const kind = v.opts.variant === 'metal' || v.opts.variant === 'glass' ? v.opts.variant : 'wood'
  const g = fenceGeometry(kind, L)
  if (kind === 'glass')
    return (
      <group>
        <M g={g.a} m={mat(C.steel, { roughness: 0.25, metalness: 0.6 })} />
        <M g={g.b!} m={mat(C.glass, { roughness: 0.08, opacity: 0.32 })} shadow={false} />
      </group>
    )
  return <M g={g.a} m={vcMat(kind === 'metal' ? 0.45 : 0.85, false, false, kind === 'metal' ? 0.4 : 0)} />
}

/* ---------- mailbox ---------- */

/**
 * Mailbox (~1.1 m): post, box with a half cylinder roof, door and handle at the front, red flag on the right side. When
 * there is mail (v.on) the flag rises smoothly and a small warm halo appears in front of the door. Body color Item.body
 * (default brand blue).
 */
export function Mailbox({ v }: P) {
  const body = v.unavailable ? DIM : (v.opts.body ?? C.brand)
  const flag = useRef<THREE.Group>(null)
  useFollow(v.on ? 0 : -Math.PI / 2, (a) => {
    if (flag.current) flag.current.rotation.x = a
  })
  const roof = cached('mailbox-roof', () => new THREE.CylinderGeometry(0.11, 0.11, 0.24, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2))
  return (
    <group>
      <Box size={[0.08, 0.9, 0.08]} position={[0, 0.45, 0]} color="#3a3f4f" />
      <Box size={[0.16, 0.02, 0.16]} position={[0, 0.89, 0]} color="#3a3f4f" shadow={false} />
      <Box size={[0.22, 0.12, 0.24]} position={[0, 0.96, 0]} color={body} />
      <mesh geometry={roof} material={mat(body)} position={[0, 1.02, 0]} castShadow receiveShadow />
      <Box size={[0.2, 0.2, 0.008]} position={[0, 0.98, 0.122]} color={C.offWhite} shadow={false} />
      <Box size={[0.05, 0.015, 0.015]} position={[0, 1.04, 0.132]} color={C.ink} shadow={false} />
      <group ref={flag} position={[0.118, 0.96, 0.03]}>
        <Box size={[0.01, 0.16, 0.012]} position={[0, 0.08, 0]} color={C.alarm} shadow={false} />
        <Box size={[0.008, 0.06, 0.08]} position={[0, 0.13, -0.04]} color={C.alarm} shadow={false} />
      </group>
      {v.on && <Glow position={[0, 0.98, 0.16]} color="#ffd29a" opacity={v.night ? 0.6 : 0.25} size={0.4} />}
    </group>
  )
}

/* ---------- solar panel ---------- */

/** Solar cells: 10 × 6 dark blue cells, silver gaps, thin bus bars (built once). */
function solarTexture() {
  const gap = rgb01('#c8d2ea')
  const bus = rgb01('#5c6f9e')
  const c0 = rgb01('#1d2f6b')
  const c1 = rgb01('#2c4a94')
  return pixelTexture('solar', 512, 256, (u, v) => {
    const cu = (u * 10) % 1
    const cv = (v * 6) % 1
    if (cu < 0.025 || cu > 0.975 || cv < 0.04 || cv > 0.96) return [...gap, 1]
    if (Math.abs(cu - 1 / 3) < 0.008 || Math.abs(cu - 2 / 3) < 0.008) return [...bus, 1]
    const t = cv * 0.7 + 0.15 * Math.sin(u * 9)
    return [mix(c0[0], c1[0], t), mix(c0[1], c1[1], t), mix(c0[2], c1[2], t), 1]
  })
}

/** Panel mount: ground rails, short front and long rear legs, diagonal braces (built once). */
function solarFrameGeometry() {
  return cached('solar-frame', () => {
    const parts: Part[] = []
    for (const x of [-0.7, 0.7]) {
      parts.push({ g: boxG(0.05, 0.04, 1.0), p: [x, 0.02, 0] })
      parts.push({ g: boxG(0.04, 0.28, 0.04), p: [x, 0.16, 0.42] }, { g: boxG(0.04, 0.78, 0.04), p: [x, 0.41, -0.42] })
      parts.push(rod([x, 0.04, 0.42], [x, 0.7, -0.4], 0.014, undefined, 6))
    }
    parts.push({ g: boxG(1.44, 0.04, 0.04), p: [0, 0.3, -0.42] })
    return merge(parts)
  })
}

/**
 * Solar panel (1.7 × 1.1 m): aluminum framed panel with a dark blue cell texture, tilted ~30° on a mount; the high edge
 * is at -z. While producing (main entity a sensor with a value > 0, or an extra power sensor > 0) the cells glow slightly.
 */
export function SolarPanel({ v }: P) {
  const power = (e: HassEntity) => domainOf(e.entity_id) === 'sensor' && deviceClass(e) === 'power' && (num(e.state) ?? 0) > 0
  const producing = (v.domain === 'sensor' && (num(v.state) ?? 0) > 0) || v.related.some(power)
  const cells = sharedMat(`solar-${producing}`, () => {
    const map = solarTexture()
    return new THREE.MeshStandardMaterial({ map, roughness: 0.28, metalness: 0.35, emissive: producing ? '#5b86ff' : '#000000', emissiveMap: producing ? map : null, emissiveIntensity: producing ? 0.55 : 0 })
  })
  const alu = mat('#d5d9e6', { roughness: 0.3, metalness: 0.6 })
  return (
    <group>
      <M g={solarFrameGeometry()} m={alu} />
      <group position={[0, 0.55, 0]} rotation-x={0.52}>
        <Box size={[1.68, 0.035, 1.02]} material={alu} />
        <mesh position-y={0.0185} rotation-x={-Math.PI / 2} material={cells} receiveShadow>
          <planeGeometry args={[1.62, 0.96]} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- weather station ---------- */

/** Anemometer rotor: hub, three arms, hemispherical cups (built once). */
function anemometerGeometry() {
  return cached('anemometer', () => {
    const cup = new THREE.SphereGeometry(0.022, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)
    const parts: Part[] = [{ g: cylG(0.012, 0.02, 10), c: C.steel }]
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, a, 0, 'YXZ'))
      parts.push({ g: boxG(0.07, 0.005, 0.005), p: [Math.cos(a) * 0.035, 0, -Math.sin(a) * 0.035], r: [0, a, 0], c: C.steel })
      parts.push({ g: cup, p: [Math.cos(a) * 0.075, 0, -Math.sin(a) * 0.075], q, c: C.white })
    }
    return merge(parts)
  })
}

/**
 * Weather station (~1.6 m): post, white stacked radiation shield, small solar panel; an arm on top with a wind vane at one
 * end (turns to wind_bearing if present) and a cup anemometer at the other. While bound the anemometer spins slowly
 * (proportional to wind_speed if present).
 */
export function WeatherStation({ v }: P) {
  const body = v.unavailable ? DIM : C.white
  const wind = num(v.attrs.wind_speed)
  const bearing = num(v.attrs.wind_bearing)
  const speed = v.bound && !v.unavailable ? 1.6 + Math.min(40, wind ?? 10) * 0.12 : 0
  return (
    <group>
      <Cyl r={0.1} h={0.03} position={[0, 0.015, 0]} color="#5a6072" segments={18} />
      <Cyl r={0.018} h={1.5} position={[0, 0.76, 0]} color={C.steel} segments={10} />
      {/* radiation shield */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Cyl key={i} r={0.075} rTop={0.068} h={0.012} position={[0, 1.0 + i * 0.03, 0]} color={body} segments={20} shadow={i === 5} />
      ))}
      <Cyl r={0.045} h={0.16} position={[0, 1.08, 0]} color="#e3e6ef" segments={14} shadow={false} />
      {/* solar panel */}
      <group position={[0, 1.27, 0.05]} rotation-x={0.6}>
        <Box size={[0.11, 0.006, 0.08]} color="#1d2f6b" shadow={false} />
      </group>
      <Box size={[0.26, 0.02, 0.02]} position={[0, 1.49, 0]} color={C.steel} shadow={false} />
      {/* wind vane */}
      <Cyl r={0.005} h={0.06} position={[-0.12, 1.52, 0]} color={C.steel} segments={6} shadow={false} />
      <group position={[-0.12, 1.55, 0]} rotation-y={bearing == null ? 0.6 : (-bearing * Math.PI) / 180}>
        <Box size={[0.01, 0.01, 0.2]} color={C.ink} shadow={false} />
        <Box size={[0.004, 0.05, 0.06]} position={[0, 0.01, -0.09]} color={C.ink} shadow={false} />
        <Cyl r={0.014} rTop={0} h={0.04} position={[0, 0, 0.11]} rotation-x={Math.PI / 2} color={C.alarm} segments={8} shadow={false} />
      </group>
      {/* anemometer */}
      <Cyl r={0.005} h={0.06} position={[0.12, 1.52, 0]} color={C.steel} segments={6} shadow={false} />
      <group position={[0.12, 1.555, 0]}>
        <Spin speed={speed} axis="y">
          <M g={anemometerGeometry()} m={vcMat(0.5, false, true)} shadow={false} />
        </Spin>
      </group>
    </group>
  )
}

/* ---------- swing ---------- */

/** Swing: two A-frame legs, top beam, cross braces, ropes and seat as one vertex colored geometry (built once). */
function swingGeometry() {
  return cached('swing', () => {
    const wood = C.kraft
    const dark = C.kraftDark
    const rope = '#c9bfa8'
    const parts: Part[] = []
    for (const x of [-0.94, 0.94]) {
      parts.push(rod([x, 0, 0.55], [x, 2.0, 0], 0.04, wood, 8), rod([x, 0, -0.55], [x, 2.0, 0], 0.04, wood, 8))
      parts.push({ g: boxG(0.05, 0.05, 0.84), p: [x, 0.5, 0], c: dark })
    }
    parts.push({ g: cylG(0.055, 2.0, 12), p: [0, 2.03, 0], r: [0, 0, Math.PI / 2], c: dark })
    for (const x of [-0.24, 0.24]) parts.push(rod([x, 1.98, 0], [x, 0.48, -0.08], 0.008, rope, 5), rod([x, 1.98, 0], [x, 0.48, 0.08], 0.008, rope, 5))
    parts.push({ g: rboxG(0.58, 0.045, 0.22, 0.015), p: [0, 0.46, 0], c: C.terracotta })
    return merge(parts)
  })
}

/** Swing (2 × 1.2 m): wooden frame with two A-frame legs, beam at ~2 m, seat hanging on ropes (static, one mesh). */
export function Swing() {
  return <M g={swingGeometry()} m={vcMat(0.8)} />
}

/* ---------- clothes drying rack ---------- */

/** Drying rack frame: crossed legs at both ends, lines on top (built once). */
function rackFrameGeometry() {
  return cached('rack-frame', () => {
    const parts: Part[] = []
    for (const x of [-0.68, 0.68]) {
      parts.push(rod([x, 0, -0.27], [x, 0.9, 0.27], 0.01, undefined, 6), rod([x, 0, 0.27], [x, 0.9, -0.27], 0.01, undefined, 6))
      parts.push(rod([x, 0.9, -0.28], [x, 0.9, 0.28], 0.008, undefined, 6))
    }
    for (let i = 0; i < 7; i++) parts.push(rod([-0.68, 0.9, -0.27 + i * 0.09], [0.68, 0.9, -0.27 + i * 0.09], 0.005, undefined, 5))
    return merge(parts)
  })
}

/** Colorful laundry hanging on the lines: T-shirt, towel, shorts, socks (built once). */
function clothesGeometry() {
  return cached('clothes', () =>
    merge([
      { g: boxG(0.34, 0.34, 0.015), p: [-0.35, 0.72, -0.18], c: C.coral },
      { g: boxG(0.5, 0.1, 0.016), p: [-0.35, 0.85, -0.18], c: C.coral },
      { g: boxG(0.45, 0.48, 0.02), p: [0.25, 0.65, 0.09], c: C.brandLight },
      { g: boxG(0.452, 0.04, 0.022), p: [0.25, 0.48, 0.09], c: C.white },
      { g: boxG(0.3, 0.28, 0.015), p: [0.45, 0.76, -0.09], c: C.mint },
      { g: boxG(0.3, 0.2, 0.012), p: [-0.05, 0.8, 0.27], c: C.white },
      { g: boxG(0.07, 0.16, 0.012), p: [-0.5, 0.82, 0.27], c: C.sun },
      { g: boxG(0.07, 0.16, 0.012), p: [-0.41, 0.82, 0.27], c: C.sun },
    ]),
  )
}

/** Clothes drying rack (1.4 × 0.6 m): white folding frame with crossed legs, lines and a few colorful pieces of laundry. */
export function ClothesRack() {
  return (
    <group>
      <M g={rackFrameGeometry()} m={mat('#e6e8ef', { roughness: 0.4, metalness: 0.3 })} />
      <M g={clothesGeometry()} m={vcMat(0.9)} />
    </group>
  )
}

/* ---------- awning ---------- */

/** Awning fabric: colored and cream stripes (once per color); one period is two stripes. */
function stripeTexture(color: string) {
  const a = rgb01(color)
  const b = rgb01('#f6f3ec')
  return pixelTexture(`stripe-${color}`, 64, 4, (u) => (u < 0.5 ? [...a, 1] : [...b, 1]))
}
const STRIPE = 0.3

/** Awning fabric and valance: width along x, fabric along local z 0..1 (stretched by scale); stripe count set in the uv by length. */
function awningGeometry(L: number) {
  return cached(`awning-${L.toFixed(2)}`, () => {
    const scaleUv = (g: THREE.BufferGeometry) => {
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (L / STRIPE))
      return g
    }
    const fabric = scaleUv(new THREE.PlaneGeometry(L - 0.08, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5))
    const valance = scaleUv(new THREE.PlaneGeometry(L - 0.08, 0.14).translate(0, -0.1, 0.035))
    return { fabric, valance }
  })
}

const AWNING_REACH = 1.35
const AWNING_SLOPE = 0.2
const AWNING_Y = 2.37
const AWNING_Z = -0.6
const ARM = 0.75
const X_AXIS = new THREE.Vector3(1, 0, 0)
const _sh = new THREE.Vector3()
const _el = new THREE.Vector3()
const _en = new THREE.Vector3()

/** Places an arm between two points (the box is ARM long, along local x). */
function placeArm(m: THREE.Object3D | null, a: THREE.Vector3, b: THREE.Vector3) {
  if (!m) return
  m.position.addVectors(a, b).multiplyScalar(0.5)
  _a.subVectors(b, a).normalize()
  m.quaternion.setFromUnitVectors(X_AXIS, _a)
}

/**
 * Awning (wall item, back at -z): cassette on the wall at ~2.3-2.5 m, striped fabric (stripe color Item.body, default
 * brand blue), front profile and valance, two folding arms. The fabric extends up to 1.35 m towards +z (~1.4 m along the
 * slope) with a slight downward slope: for a cover current_position / 100, for other entities fully out while on and
 * retracted while off; out when there is no entity (thumbnail). It extends and retracts smoothly, the arms fold at the
 * elbow.
 */
export function Awning({ v }: P) {
  const L = v.opts.len ?? 3
  const color = v.opts.body ?? C.brand
  const pos = num(v.attrs.current_position)
  const ext = v.domain === 'cover' ? (pos != null ? Math.min(1, Math.max(0, pos / 100)) : coverOpen(v.state, v.attrs) ? 1 : 0) : v.domain ? (v.on ? 1 : 0) : 1
  const g = awningGeometry(L)
  const cloth = sharedMat(`awning-${color}`, () => new THREE.MeshStandardMaterial({ map: stripeTexture(color), roughness: 0.85, side: THREE.DoubleSide }))
  const fabric = useRef<THREE.Mesh>(null)
  const front = useRef<THREE.Group>(null)
  const arms = useRef<(THREE.Mesh | null)[]>([])
  const shoulder = L / 2 - 0.12
  useFollow(
    ext,
    (f) => {
      const l = (f * AWNING_REACH) / Math.cos(AWNING_SLOPE)
      if (fabric.current) fabric.current.scale.z = Math.max(0.001, l)
      if (front.current) front.current.position.z = l
      ;[-1, 1].forEach((s, i) => {
        _sh.set(s * shoulder, AWNING_Y - 0.08, -0.71)
        _en.set(s * shoulder, AWNING_Y - l * Math.sin(AWNING_SLOPE) - 0.04, AWNING_Z + l * Math.cos(AWNING_SLOPE))
        const half = Math.min(ARM, _sh.distanceTo(_en) / 2)
        const off = Math.sqrt(ARM * ARM - half * half)
        _el.addVectors(_sh, _en).multiplyScalar(0.5)
        _el.x -= s * off
        placeArm(arms.current[i * 2], _sh, _el)
        placeArm(arms.current[i * 2 + 1], _el, _en)
      })
    },
    2.2,
    L,
  )
  const alu = mat('#eef0f5', { roughness: 0.4, metalness: 0.3 })
  return (
    <group>
      <Box size={[L, 0.14, 0.16]} position={[0, AWNING_Y + 0.05, -0.67]} material={alu} radius={0.035} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.08, 0.12, 0.05]} position={[s * shoulder, AWNING_Y - 0.08, -0.725]} material={alu} shadow={false} />
      ))}
      <group position={[0, AWNING_Y, AWNING_Z]} rotation-x={AWNING_SLOPE}>
        <mesh ref={fabric} geometry={g.fabric} material={cloth} castShadow receiveShadow />
        <group ref={front}>
          <Box size={[L - 0.04, 0.05, 0.06]} position={[0, -0.02, 0]} material={alu} />
          <mesh geometry={g.valance} material={cloth} castShadow />
        </group>
      </group>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            arms.current[i] = m
          }}
          material={alu}
          castShadow
        >
          <boxGeometry args={[ARM, 0.03, 0.03]} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- car ---------- */

type CarSpec = {
  /** width, wheel radius and center height, half wheelbase, wheel arch, underside */
  W: number
  wr: number
  wy: number
  wb: number
  arch: number
  bottom: number
  /** outline of the lower body: from front bottom to rear bottom (side profile, u = z, v = y) */
  outline: [number, number][]
  cabin: [number, number][]
  roof: [number, number][]
  /** [y, z] position of the headlight, tail light and grille */
  head: [number, number]
  tail: [number, number]
  grille: [number, number]
  /** B pillar and (on the SUV) roof rails */
  bPillar: number
  rails?: boolean
}

const CARS: Record<string, CarSpec> = {
  sedan: {
    W: 1.8,
    wr: 0.33,
    wy: 0.33,
    wb: 1.36,
    arch: 0.4,
    bottom: 0.2,
    outline: [[2.15, 0.2], [2.2, 0.42], [2.18, 0.6], [2.04, 0.76], [1.4, 0.87], [0.8, 0.93], [-1.45, 0.96], [-2.0, 0.94], [-2.18, 0.84], [-2.2, 0.45], [-2.15, 0.2]],
    cabin: [[0.82, 0.92], [-0.08, 1.38], [-0.95, 1.4], [-1.5, 0.95]],
    roof: [[0.0, 1.36], [-0.1, 1.45], [-0.95, 1.47], [-1.08, 1.38]],
    head: [0.66, 2.16],
    tail: [0.82, -2.18],
    grille: [0.46, 2.22],
    bPillar: -0.5,
  },
  suv: {
    W: 1.9,
    wr: 0.38,
    wy: 0.38,
    wb: 1.4,
    arch: 0.46,
    bottom: 0.3,
    outline: [[2.18, 0.3], [2.24, 0.52], [2.22, 0.8], [2.1, 0.98], [1.3, 1.06], [0.95, 1.08], [-2.05, 1.1], [-2.22, 1.0], [-2.24, 0.45], [-2.18, 0.3]],
    cabin: [[0.95, 1.07], [0.12, 1.66], [-1.95, 1.68], [-2.12, 1.1]],
    roof: [[0.15, 1.63], [0.05, 1.72], [-1.95, 1.74], [-2.06, 1.63]],
    head: [0.88, 2.21],
    tail: [0.95, -2.26],
    grille: [0.64, 2.27],
    bPillar: -0.55,
    rails: true,
  },
  hatch: {
    W: 1.76,
    wr: 0.31,
    wy: 0.31,
    wb: 1.25,
    arch: 0.39,
    bottom: 0.19,
    outline: [[1.92, 0.19], [1.98, 0.42], [1.96, 0.6], [1.8, 0.76], [1.25, 0.85], [0.72, 0.91], [-1.75, 0.95], [-1.97, 0.86], [-1.98, 0.45], [-1.92, 0.19]],
    cabin: [[0.74, 0.9], [-0.1, 1.44], [-1.45, 1.47], [-1.82, 0.95]],
    roof: [[-0.06, 1.41], [-0.15, 1.51], [-1.45, 1.53], [-1.62, 1.43]],
    head: [0.66, 1.94],
    tail: [0.8, -1.99],
    grille: [0.45, 2.0],
    bPillar: -0.45,
  },
}

/** Extrudes a side profile along x (the width) with rounded edges; centered. */
function extrudeSide(shape: THREE.Shape, width: number, bevel: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.75, bevelSegments: 2, curveSegments: 10 })
  g.rotateY(-Math.PI / 2)
  g.translate((width - 2 * bevel) / 2, 0, 0)
  g.computeVertexNormals()
  return g
}
const polyShape = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))

/** Car parts, once per kind: lower body (with wheel arches), glass cabin, roof, pillars and mirrors, wheels. */
function carGeometry(kind: string) {
  return cached(`car-${kind}`, () => {
    const s = CARS[kind]
    const lower = new THREE.Shape()
    const start = s.outline[s.outline.length - 1]
    lower.moveTo(start[0], start[1])
    for (const zc of [-s.wb, s.wb]) {
      lower.lineTo(zc - s.arch, s.bottom)
      lower.lineTo(zc - s.arch, s.wy)
      lower.absarc(zc, s.wy, s.arch, Math.PI, 0, true)
      lower.lineTo(zc + s.arch, s.bottom)
    }
    for (const [x, y] of s.outline.slice(0, -1)) lower.lineTo(x, y)
    const Wc = s.W - 0.28
    const xc = Wc / 2 + 0.005
    const [ws, wt] = [s.cabin[0], s.cabin[1]]
    const [rt, rb] = [s.cabin[2], s.cabin[3]]
    const trim: Part[] = [
      // A, B and C pillars on both sides
      ...[-1, 1].flatMap((sx) => [
        rod([sx * xc, ws[1], ws[0]], [sx * xc, wt[1], wt[0]], 0.035, undefined, 6),
        rod([sx * xc, rt[1], rt[0]], [sx * xc, rb[1], rb[0]], 0.045, undefined, 6),
        { g: boxG(0.03, wt[1] - ws[1], 0.08), p: [sx * xc, (wt[1] + ws[1]) / 2, s.bPillar] as V3 },
        // side mirror
        { g: rboxG(0.12, 0.08, 0.07, 0.02), p: [sx * (s.W / 2 + 0.05), ws[1] + 0.07, ws[0] - 0.08] as V3 },
        { g: boxG(0.08, 0.025, 0.03), p: [sx * (s.W / 2 - 0.0), ws[1] + 0.05, ws[0] - 0.08] as V3 },
      ]),
    ]
    if (s.rails) for (const sx of [-1, 1]) trim.push({ g: boxG(0.04, 0.04, (rt[0] - wt[0]) * -0.85), p: [sx * (Wc / 2 - 0.12), s.roof[2][1] + 0.025, (wt[0] + rt[0]) / 2] })
    const wheelX = s.W / 2 - 0.13
    const wheels: Part[] = []
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const p: V3 = [sx * wheelX, s.wy, sz * s.wb]
        wheels.push({ g: cylG(s.wr, 0.22, 20), p, r: [0, 0, Math.PI / 2], c: '#23262e' })
        wheels.push({ g: cylG(s.wr * 0.62, 0.226, 16), p, r: [0, 0, Math.PI / 2], c: '#c3c8dc' })
        wheels.push({ g: cylG(s.wr * 0.22, 0.232, 10), p, r: [0, 0, Math.PI / 2], c: '#5a6072' })
      }
    return {
      lower: extrudeSide(lower, s.W, 0.07),
      cabin: extrudeSide(polyShape(s.cabin), Wc, 0.03),
      roof: extrudeSide(polyShape(s.roof), Wc + 0.04, 0.025),
      trim: merge(trim),
      wheels: merge(wheels),
    }
  })
}

const CAR_KINDS = ['sedan', 'suv', 'hatch']
const isAway = (domain: string, state: string) => (domain === 'device_tracker' || domain === 'person') && !['home', 'unavailable', 'unknown', ''].includes(state)

/**
 * Car (1.9 × 4.6 m; length along z, front with headlights at +z, rear with red tail lights at -z). Item.variant 'sedan'
 * (default), 'suv', 'hatch'; body color Item.body (default red). Lower body with rounded edges, wheel arches, dark glass
 * cabin, roof, pillars, mirrors, four wheels with rims.
 * States: away (main or extra device_tracker / person not 'home') the car becomes a faint transparent ghost and parking
 * lines appear on the ground; while charging (extra binary_sensor battery_charging on, or the main switch on) a green
 * pulsing light at the rear left charge port; while unlocked (main or extra lock 'unlocked') the side indicators glow amber.
 */
export function Car({ v }: P) {
  const kind = CAR_KINDS.includes(v.opts.variant ?? '') ? v.opts.variant! : 'sedan'
  const s = CARS[kind]
  const g = carGeometry(kind)
  const color = v.opts.body ?? '#c8323c'
  const away = isAway(v.domain, v.state) || v.related.some((e) => isAway(domainOf(e.entity_id), e.state))
  const charging =
    (v.domain === 'switch' && v.on) ||
    (v.domain === 'binary_sensor' && v.attrs.device_class === 'battery_charging' && v.on) ||
    v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && deviceClass(e) === 'battery_charging' && isActive(e))
  const unlocked = (v.domain === 'lock' && v.state === 'unlocked') || v.related.some((e) => domainOf(e.entity_id) === 'lock' && e.state === 'unlocked')
  const paint = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.25 }), [color])
  const ghost = useMemo(() => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.5 }), [color])
  useEffect(
    () => () => {
      paint.dispose()
      ghost.dispose()
    },
    [paint, ghost],
  )
  const amber = useLitMaterial('#d9c7a5', unlocked && !away, C.warn, 1, 2.2)
  const port = useLitMaterial('#3a3f4c', charging && !away, C.ok, 1, 2.4)
  const pulse = useRef<THREE.SpriteMaterial>(null)
  const pulsing = charging && !away
  useAmbient(pulsing)
  useFrame(({ clock }) => {
    if (!pulsing || !pulse.current) return
    pulse.current.opacity = (v.night ? 0.55 : 0.3) + 0.3 * Math.sin(clock.elapsedTime * 3.2)
  })
  const m = (x: THREE.Material) => (away ? ghost : x)
  const sh = !away
  const glass = mat('#2a3550', { roughness: 0.12, metalness: 0.4 })
  const dark = mat(C.ink, { roughness: 0.6 })
  const headM = mat('#fdf6e3', { emissive: '#fff1c9', emissiveIntensity: 0.45, roughness: 0.2 })
  const tailM = mat(C.alarm, { emissive: '#ff3b30', emissiveIntensity: 0.35, roughness: 0.3 })
  const hx = s.W / 2 - 0.3
  // rear plate: slightly behind the bumper's lower corner (outside the rounded edge)
  const plate = s.outline[s.outline.length - 2]
  const portAt: V3 = [-(s.W / 2 + 0.003), s.outline[6][1] - 0.13, -s.wb - s.arch - 0.08]
  return (
    <group>
      <M g={g.lower} m={m(paint)} shadow={sh} />
      <M g={g.cabin} m={m(glass)} shadow={sh} />
      <M g={g.roof} m={m(paint)} shadow={sh} />
      <M g={g.trim} m={m(paint)} shadow={sh} />
      <M g={g.wheels} m={away ? ghost : vcMat(0.6)} shadow={sh} />
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <Box size={[0.36, 0.09, 0.06]} position={[sx * hx, s.head[0], s.head[1]]} material={m(headM)} shadow={false} radius={0.02} />
          <Box size={[0.34, 0.08, 0.05]} position={[sx * hx, s.tail[0], s.tail[1]]} material={m(tailM)} shadow={false} radius={0.02} />
          <Box size={[0.016, 0.04, 0.12]} position={[sx * (s.W / 2 + 0.004), s.head[0] + 0.04, s.wb + s.arch + 0.12]} material={m(amber)} shadow={false} />
          <Box size={[0.02, 0.022, 0.05]} position={[sx * (s.W / 2 + 0.11), s.cabin[0][1] + 0.05, s.cabin[0][0] - 0.06]} material={m(amber)} shadow={false} />
        </group>
      ))}
      <Box size={[s.W * 0.42, 0.13, 0.04]} position={[0, s.grille[0], s.grille[1]]} material={m(dark)} shadow={false} radius={0.015} />
      <Box size={[0.42, 0.1, 0.015]} position={[0, (s.tail[0] + plate[1]) / 2, plate[0] - 0.06]} material={m(mat(C.white))} shadow={false} />
      <Box size={[0.012, 0.08, 0.1]} position={portAt} material={m(port)} shadow={false} />
      {pulsing && (
        <sprite position={[portAt[0] - 0.08, portAt[1], portAt[2]]} scale={[0.6, 0.6, 0.6]} renderOrder={10}>
          <spriteMaterial ref={pulse} map={glowTexture()} color={C.ok} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </sprite>
      )}
      {away && (
        <>
          {/* parking lines: show the spot and the selection box while the car is away */}
          {[-1, 1].map((sx) => (
            <Box key={sx} size={[0.06, 0.004, 4.5]} position={[sx * 0.92, 0.002, 0]} color={C.white} shadow={false} />
          ))}
          <Box size={[1.9, 0.004, 0.06]} position={[0, 0.002, -2.27]} color={C.white} shadow={false} />
        </>
      )}
    </group>
  )
}

/* ---------- charging station ---------- */

/**
 * EV charger (wall item, back at -z; 0.9-1.5 m): box with rounded corners, dark front panel, LED ring, coiled cable and
 * plug below. LED: neutral when not bound, green when bound and idle (ready), blue and pulsing while charging (v.on);
 * dimmed when unavailable.
 */
export function EvCharger({ v }: P) {
  const charging = v.bound && v.on && !v.unavailable
  const ready = v.bound && !v.on && !v.unavailable
  const color = charging ? '#3d8bff' : ready ? C.ok : '#e3e6ef'
  const led = useMemo(
    () => new THREE.MeshStandardMaterial({ color, emissive: charging || ready ? color : '#000000', emissiveIntensity: charging || ready ? 1.4 : 0, roughness: 0.4 }),
    [color, charging, ready],
  )
  useEffect(() => () => led.dispose(), [led])
  const ring = useRef<THREE.Mesh>(null)
  useAmbient(charging)
  useFrame(({ clock }) => {
    const m = ring.current?.material as THREE.MeshStandardMaterial | undefined
    if (!charging || !m) return
    m.emissiveIntensity = 0.7 + 1.3 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3))
  })
  const body = v.unavailable ? DIM : C.white
  return (
    <group>
      <Box size={[0.26, 0.38, 0.11]} position={[0, 1.31, -0.015]} color={body} radius={0.035} />
      <Box size={[0.2, 0.28, 0.006]} position={[0, 1.33, 0.041]} color="#2c3140" shadow={false} radius={0.002} />
      <mesh ref={ring} position={[0, 1.36, 0.046]} material={led}>
        <torusGeometry args={[0.045, 0.007, 8, 32]} />
      </mesh>
      <Cyl r={0.01} h={0.006} position={[0, 1.36, 0.046]} rotation-x={Math.PI / 2} color={C.white} segments={12} shadow={false} />
      {/* cable: leaves the bottom of the box, coiled, with the plug at its end */}
      <Cyl r={0.011} h={0.05} position={[0, 1.105, -0.03]} color={C.ink} segments={8} shadow={false} />
      {[0, 1].map((i) => (
        <mesh key={i} position={[i * 0.012, 1.0 - i * 0.006, -0.035 + i * 0.016]} castShadow>
          <torusGeometry args={[0.08, 0.011, 6, 28]} />
          <meshStandardMaterial color={C.ink} roughness={0.6} />
        </mesh>
      ))}
      <Box size={[0.035, 0.06, 0.04]} position={[-0.06, 0.95, 0.0]} rotation-z={0.5} color="#3a3f4c" radius={0.01} shadow={false} />
      {charging && v.night && <Glow position={[0, 1.36, 0.08]} color={color} opacity={0.6} size={0.35} />}
    </group>
  )
}

/* ---------- bicycle ---------- */

/** Bicycle wheel: tire, rim, hub, 12 spokes; in the yz plane (merged once, used twice). */
function wheelParts(z: number, y: number, r: number, hub = 0.025): Part[] {
  const parts: Part[] = [
    { g: new THREE.TorusGeometry(r, 0.02, 6, 32), p: [0, y, z], r: [0, Math.PI / 2, 0], c: '#23262e' },
    { g: new THREE.TorusGeometry(r - 0.025, 0.007, 4, 32), p: [0, y, z], r: [0, Math.PI / 2, 0], c: '#c3c8dc' },
    { g: cylG(hub, 0.06, 10), p: [0, y, z], r: [0, 0, Math.PI / 2], c: '#5a6072' },
  ]
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    parts.push(rod([0, y, z], [0, y + Math.sin(a) * (r - 0.03), z + Math.cos(a) * (r - 0.03)], 0.0018, '#c3c8dc', 3))
  }
  return parts
}

const BIKE = { R: [0, 0.34, -0.52] as V3, F: [0, 0.34, 0.52] as V3, BB: [0, 0.3, -0.02] as V3, S: [0, 0.82, -0.18] as V3, HT: [0, 0.86, 0.36] as V3, HB: [0, 0.72, 0.4] as V3 }

/** Bicycle: frame tubes (colored by the material) and the other parts (vertex colored), once per kind. */
function bikeGeometry(ebike: boolean) {
  return cached(`bike-${ebike}`, () => {
    const { R, F, BB, S, HT, HB } = BIKE
    const at = (p: V3, dx: number): V3 => [p[0] + dx, p[1], p[2]]
    const frame = merge([
      rod(BB, S, 0.016),
      rod(S, HT, 0.016),
      rod(BB, HB, ebike ? 0.026 : 0.02),
      rod(HB, HT, 0.022),
      ...[-1, 1].flatMap((sx) => [rod(at(R, sx * 0.04), at(BB, sx * 0.02), 0.01, undefined, 6), rod(at(R, sx * 0.035), at(S, sx * 0.01), 0.009, undefined, 6), rod(at(HB, sx * 0.03), at(F, sx * 0.045), 0.012, undefined, 6)]),
    ])
    const dark = '#2c3140'
    const steel = '#c3c8dc'
    const parts: Part[] = [
      ...wheelParts(R[2], R[1], 0.33, ebike ? 0.07 : 0.025),
      ...wheelParts(F[2], F[1], 0.33),
      rod(S, [0, 0.93, -0.22], 0.012, steel, 6),
      { g: rboxG(0.09, 0.045, 0.24, 0.02), p: [0, 0.95, -0.22], c: dark },
      rod(HT, [0, 0.96, 0.34], 0.014, dark, 6),
      { g: cylG(0.011, 0.56, 8), p: [0, 0.96, 0.33], r: [0, 0, Math.PI / 2], c: dark },
      ...[-1, 1].map((sx): Part => ({ g: cylG(0.016, 0.1, 8), p: [sx * 0.24, 0.96, 0.33], r: [0, 0, Math.PI / 2], c: '#5a6072' })),
      { g: cylG(0.085, 0.012, 20), p: [0.05, BB[1], BB[2]], r: [0, 0, Math.PI / 2], c: steel },
      rod([0.07, BB[1], BB[2]], [0.07, BB[1] - 0.16, BB[2] + 0.05], 0.01, steel, 6),
      rod([-0.07, BB[1], BB[2]], [-0.07, BB[1] + 0.16, BB[2] - 0.05], 0.01, steel, 6),
      { g: boxG(0.09, 0.02, 0.06), p: [0.11, BB[1] - 0.16, BB[2] + 0.05], c: dark },
      { g: boxG(0.09, 0.02, 0.06), p: [-0.11, BB[1] + 0.16, BB[2] - 0.05], c: dark },
      rod([-0.03, BB[1] - 0.02, BB[2] - 0.08], [-0.13, 0.005, -0.2], 0.008, dark, 6),
    ]
    if (ebike) {
      // battery along the down tube with an LED spot on top; small display on the handlebar
      const d = new THREE.Vector3(...HB).sub(new THREE.Vector3(...BB))
      const len = d.length()
      d.normalize()
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d)
      // top side of the tube (perpendicular in the yz plane, up and back)
      const mid: V3 = [0, (BB[1] + HB[1]) / 2 + d.z * 0.045, (BB[2] + HB[2]) / 2 - d.y * 0.045]
      parts.push({ g: rboxG(0.075, len * 0.62, 0.07, 0.02), p: mid, q, c: dark })
      parts.push({ g: rboxG(0.06, 0.04, 0.035, 0.008), p: [0, 1.0, 0.33], r: [-0.5, 0, 0], c: dark })
    }
    return { frame, parts: merge(parts) }
  })
}

/** Position of the e-bike battery LED: the upper end of the battery on the down tube. */
const BIKE_LED: V3 = [0, 0.667, 0.232]

/**
 * Bicycle (0.6 × 1.75 m, along z, front +z): spoked wheels, frame tubes (color Item.body, default brand blue), saddle,
 * handlebar, cranks and pedals, kickstand. Item.variant 'ebike': battery on the down tube, rear hub motor, display on the
 * handlebar; the battery LED glows green while an extra battery sensor (device_class battery) is bound.
 */
export function Bicycle({ v }: P) {
  const ebike = v.opts.variant === 'ebike'
  const g = bikeGeometry(ebike)
  const color = v.opts.body ?? C.brand
  const battery = ebike && (v.attrs.device_class === 'battery' || v.related.some((e) => deviceClass(e) === 'battery'))
  const led = useLitMaterial('#5a5f70', battery, C.ok, 1, 2.4)
  return (
    <group>
      <M g={g.frame} m={mat(color, { roughness: 0.35, metalness: 0.3 })} />
      <M g={g.parts} m={vcMat(0.55)} />
      {ebike && <Ball r={0.015} position={BIKE_LED} material={led} shadow={false} />}
    </group>
  )
}

/* ---------- motorcycle ---------- */

/** Motorcycle / scooter: body colored parts and the rest (vertex colored), once per kind. */
function motoGeometry(scooter: boolean) {
  return cached(`moto-${scooter}`, () => {
    const dark = '#2c3140'
    const steel = '#c3c8dc'
    const tyre = (z: number, y: number, r: number, t: number): Part[] => [
      { g: new THREE.TorusGeometry(r, t, 8, 28), p: [0, y, z], r: [0, Math.PI / 2, 0], c: '#23262e' },
      { g: cylG(r - t * 0.6, 0.08, 18), p: [0, y, z], r: [0, 0, Math.PI / 2], c: steel },
      { g: cylG(r * 0.35, 0.1, 12), p: [0, y, z], r: [0, 0, Math.PI / 2], c: '#5a6072' },
    ]
    if (scooter) {
      const body = merge([
        { g: rboxG(0.4, 0.62, 0.06, 0.03), p: [0, 0.64, 0.42], r: [-0.25, 0, 0] },
        rod([0, 0.6, 0.5], [0, 1.03, 0.38], 0.045, undefined, 10),
        { g: rboxG(0.62, 0.07, 0.1, 0.03), p: [0, 1.07, 0.38] },
        { g: icoG(0.3, 2), p: [0, 0.55, -0.42], s: [0.68, 0.78, 1.2] },
        { g: rboxG(0.17, 0.07, 0.34, 0.03), p: [0, 0.5, 0.68] },
      ])
      const parts = merge([
        ...tyre(-0.62, 0.24, 0.19, 0.05),
        ...tyre(0.68, 0.24, 0.19, 0.05),
        { g: rboxG(0.32, 0.06, 0.6, 0.02), p: [0, 0.3, 0.08], c: dark },
        { g: rboxG(0.3, 0.09, 0.6, 0.04), p: [0, 0.84, -0.32], c: dark },
        rod([0, 0.5, 0.62], [0, 0.24, 0.68], 0.022, steel, 8),
        { g: cylG(0.06, 0.05, 16), p: [0, 1.08, 0.45], r: [Math.PI / 2, 0, 0], c: '#fdf6e3' },
        { g: rboxG(0.12, 0.05, 0.04, 0.01), p: [0, 0.72, -0.94], c: C.alarm },
        ...[-1, 1].map((sx): Part => ({ g: cylG(0.02, 0.1, 8), p: [sx * 0.33, 1.07, 0.38], r: [0, 0, Math.PI / 2], c: dark })),
        { g: boxG(0.3, 0.04, 0.04), p: [0, 0.14, -0.2], c: dark },
      ])
      return { body, parts }
    }
    const body = merge([
      { g: icoG(0.2, 2), p: [0, 0.86, 0.16], s: [0.75, 0.6, 1.25] },
      { g: rboxG(0.2, 0.1, 0.36, 0.04), p: [0, 0.88, -0.64], r: [-0.2, 0, 0] },
      { g: rboxG(0.15, 0.03, 0.3, 0.012), p: [0, 0.64, 0.72], r: [0.25, 0, 0] },
      { g: rboxG(0.3, 0.22, 0.12, 0.05), p: [0, 0.98, 0.58], r: [0.3, 0, 0] },
    ])
    const parts = merge([
      ...tyre(-0.68, 0.32, 0.27, 0.055),
      ...tyre(0.7, 0.32, 0.27, 0.055),
      { g: rboxG(0.28, 0.3, 0.42, 0.04), p: [0, 0.45, 0.0], c: '#3a3f4c' },
      ...[0.36, 0.42, 0.48].map((y): Part => ({ g: boxG(0.34, 0.012, 0.3), p: [0, y, 0.05], c: '#5a6072' })),
      { g: rboxG(0.26, 0.08, 0.55, 0.035), p: [0, 0.84, -0.3], c: dark },
      rod([0, 0.95, 0.48], [0, 0.45, -0.25], 0.03, dark, 8),
      ...[-1, 1].flatMap((sx) => [rod([sx * 0.08, 0.42, -0.25], [sx * 0.08, 0.32, -0.68], 0.022, dark, 8), rod([sx * 0.09, 1.0, 0.47], [sx * 0.09, 0.32, 0.7], 0.022, steel, 8)]),
      { g: cylG(0.014, 0.66, 8), p: [0, 1.08, 0.44], r: [0, 0, Math.PI / 2], c: dark },
      { g: cylG(0.075, 0.08, 18), p: [0, 0.95, 0.66], r: [Math.PI / 2, 0, 0], c: '#fdf6e3' },
      rod([0.12, 0.32, 0.12], [0.16, 0.42, -0.86], 0.04, steel, 10),
      { g: rboxG(0.12, 0.05, 0.04, 0.01), p: [0, 0.9, -0.83], c: C.alarm },
      rod([-0.1, 0.32, -0.08], [-0.2, 0.0, -0.14], 0.012, dark, 6),
    ])
    return { body, parts }
  })
}

/**
 * Motorcycle / scooter (0.8 × 2.1 m, along z, front +z). Item.variant 'motorbike' (default): thick tires, engine block,
 * tank, seat, tail, front fork and headlight, exhaust; leaning slightly left on its kickstand. 'scooter': small wheels,
 * floorboard, front shield, rounded rear body, headlight on the handlebar; upright on its center stand. Body color
 * Item.body.
 */
export function Motorcycle({ v }: P) {
  const scooter = v.opts.variant === 'scooter'
  const g = motoGeometry(scooter)
  const color = v.opts.body ?? (scooter ? C.mint : '#d94a3d')
  return (
    <group rotation-z={scooter ? 0 : 0.06}>
      <M g={g.body} m={mat(color, { roughness: 0.3, metalness: 0.25 })} />
      <M g={g.parts} m={vcMat(0.5, false, false, 0.2)} />
    </group>
  )
}

/* ---------- workbench ---------- */

/** Workbench steel frame: legs, upper and lower rails (built once). */
function benchFrameGeometry() {
  return cached('bench-frame', () => {
    const parts: Part[] = []
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ g: boxG(0.05, 0.85, 0.05), p: [sx * 0.76, 0.425, sz * 0.285] })
    for (const sz of [-1, 1]) parts.push({ g: boxG(1.5, 0.05, 0.03), p: [0, 0.82, sz * 0.285] }, { g: boxG(1.5, 0.04, 0.03), p: [0, 0.13, sz * 0.285] })
    for (const sx of [-1, 1]) parts.push({ g: boxG(0.03, 0.04, 0.55), p: [sx * 0.76, 0.13, 0] })
    return merge(parts)
  })
}

/** Vise, toolbox and drawer fronts (vertex colored, built once). */
function benchPartsGeometry() {
  return cached('bench-parts', () => {
    const dark = '#3a3f4c'
    const steel = '#c3c8dc'
    const parts: Part[] = [
      // vise: at the front left corner
      { g: boxG(0.14, 0.05, 0.12), p: [-0.58, 0.925, 0.22], c: dark },
      { g: boxG(0.16, 0.08, 0.04), p: [-0.58, 0.99, 0.2], c: dark },
      { g: boxG(0.16, 0.08, 0.04), p: [-0.58, 0.99, 0.29], c: dark },
      { g: cylG(0.012, 0.2, 8), p: [-0.58, 0.97, 0.36], r: [Math.PI / 2, 0, 0], c: steel },
      { g: cylG(0.008, 0.18, 6), p: [-0.58, 0.97, 0.45], r: [0, 0, Math.PI / 2], c: steel },
      // toolbox
      { g: rboxG(0.3, 0.12, 0.16, 0.015), p: [0.38, 0.96, -0.16], c: C.alarm },
      { g: boxG(0.12, 0.02, 0.02), p: [0.38, 1.04, -0.16], c: C.ink },
      { g: boxG(0.012, 0.04, 0.012), p: [0.33, 1.025, -0.16], c: C.ink },
      { g: boxG(0.012, 0.04, 0.012), p: [0.43, 1.025, -0.16], c: C.ink },
    ]
    // drawer cabinet: on the right, three drawers
    parts.push({ g: boxG(0.5, 0.5, 0.52), p: [0.45, 0.55, 0], c: C.brand })
    for (const y of [0.39, 0.55, 0.71]) parts.push({ g: boxG(0.46, 0.14, 0.012), p: [0.45, y, 0.265], c: C.brandLight }, { g: boxG(0.14, 0.018, 0.02), p: [0.45, y + 0.03, 0.276], c: steel })
    return merge(parts)
  })
}

/**
 * Workbench (1.6 × 0.65 m, ~0.9 m, back against the wall at -z): wooden top and lower shelf, steel frame, a three-drawer
 * cabinet on the right, a vise at the front left corner, a toolbox on top.
 */
export function Workbench() {
  const wood = woodMat(C.kraft)
  return (
    <group>
      <Box size={[1.6, 0.05, 0.65]} position={[0, 0.875, 0]} material={wood} />
      <Box size={[1.5, 0.025, 0.56]} position={[0, 0.16, 0]} material={wood} />
      <M g={benchFrameGeometry()} m={mat('#4a5060', { roughness: 0.5, metalness: 0.4 })} />
      <M g={benchPartsGeometry()} m={vcMat(0.55, false, false, 0.15)} />
    </group>
  )
}

/* ---------- tool board ---------- */

/** Board panel: uv scaled so the hole texture repeats densely across the board (built once). */
function toolBoardGeometry() {
  return cached('toolboard', () => {
    const g = new THREE.BoxGeometry(1.2, 0.8, 0.012)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * 1.4)
    return g
  })
}

/** Tools on the board: hammer, wrench, saw, pliers, screwdrivers, tape measure, hooks (vertex colored, built once). */
function toolsGeometry() {
  return cached('tools', () => {
    const steel = '#c3c8dc'
    const dark = '#3a3f4c'
    const blade = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.44, 0.03), new THREE.Vector2(0.44, 0.1), new THREE.Vector2(0, 0.15)]))
    const parts: Part[] = [
      // hammer
      { g: boxG(0.03, 0.3, 0.02), p: [-0.45, 1.5, 0.0], c: C.kraft },
      { g: boxG(0.13, 0.04, 0.035), p: [-0.45, 1.66, 0.0], c: dark },
      // open-end wrench
      { g: boxG(0.025, 0.22, 0.01), p: [-0.25, 1.48, -0.005], c: steel },
      { g: new THREE.TorusGeometry(0.03, 0.01, 6, 16, Math.PI * 1.4), p: [-0.25, 1.62, -0.005], r: [0, 0, -Math.PI * 0.2], c: steel },
      { g: new THREE.TorusGeometry(0.022, 0.008, 6, 16), p: [-0.25, 1.355, -0.005], c: steel },
      // saw
      { g: blade, p: [-0.1, 1.15, -0.012], c: steel },
      { g: rboxG(0.13, 0.13, 0.025, 0.03), p: [-0.14, 1.22, -0.005], c: C.coral },
      // pliers
      rod([0.18, 1.62, 0.0], [0.26, 1.4, 0.0], 0.008, steel, 6),
      rod([0.26, 1.62, 0.0], [0.18, 1.4, 0.0], 0.008, steel, 6),
      rod([0.26, 1.4, 0.0], [0.28, 1.3, 0.0], 0.012, C.alarm, 6),
      rod([0.18, 1.4, 0.0], [0.16, 1.3, 0.0], 0.012, C.alarm, 6),
      // tape measure
      { g: cylG(0.045, 0.03, 18), p: [0.2, 1.76, 0.0], r: [Math.PI / 2, 0, 0], c: C.sun },
    ]
    // screwdrivers
    ;[C.sun, C.brand, C.alarm].forEach((c, i) => {
      const x = 0.42 + i * 0.06
      parts.push({ g: cylG(0.014, 0.08, 10), p: [x, 1.7, 0.0], c }, { g: cylG(0.004, 0.11, 6), p: [x, 1.605, 0.0], c: steel })
    })
    // hooks
    for (const [x, y] of [
      [-0.45, 1.69],
      [-0.25, 1.66],
      [0.22, 1.66],
      [0.42, 1.75],
      [0.48, 1.75],
      [0.54, 1.75],
      [0.2, 1.8],
      [-0.14, 1.3],
    ])
      parts.push({ g: boxG(0.008, 0.008, 0.03), p: [x, y, -0.012], c: steel })
    return merge(parts)
  })
}

/**
 * Tool board (wall item, back at -z; 1.1-1.9 m): pegboard (pegboardTexture, color Item.body, default kraft), wooden edge
 * trim; a hammer, wrench, saw, pliers, screwdrivers and tape measure hanging on it (one mesh).
 */
export function ToolWall({ v }: P) {
  const color = v.opts.body ?? '#e2c08f'
  const board = sharedMat(`toolwall-${color}`, () => new THREE.MeshStandardMaterial({ map: pegboardTexture(), color, roughness: 0.8 }))
  const trim = cached('toolwall-trim', () =>
    merge([
      { g: boxG(1.2, 0.03, 0.02), p: [0, 1.885, -0.02] },
      { g: boxG(1.2, 0.03, 0.02), p: [0, 1.115, -0.02] },
      { g: boxG(0.03, 0.74, 0.02), p: [-0.585, 1.5, -0.02] },
      { g: boxG(0.03, 0.74, 0.02), p: [0.585, 1.5, -0.02] },
    ]),
  )
  return (
    <group>
      <M g={toolBoardGeometry()} m={board} position={[0, 1.5, -0.024]} />
      <M g={trim} m={mat(C.kraftDark)} shadow={false} />
      <M g={toolsGeometry()} m={vcMat(0.5, false, false, 0.2)} />
    </group>
  )
}

/* ---------- metal shelf ---------- */

/** Metal shelf: uprights, four shelves, cardboard boxes and bins on them; one vertex colored geometry (built once, seeded). */
function storageRackGeometry() {
  return cached('storage-rack', () => {
    const r = rng(29)
    const parts: Part[] = []
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push({ g: boxG(0.035, 1.9, 0.035), p: [sx * 0.58, 0.95, sz * 0.2], c: '#4a5060' })
    const shelves = [0.1, 0.65, 1.2, 1.75]
    for (const y of shelves) parts.push({ g: boxG(1.2, 0.025, 0.45), p: [0, y, 0], c: C.steel }, { g: boxG(1.2, 0.04, 0.012), p: [0, y - 0.005, 0.222], c: '#9aa0b8' })
    const bins = ['#8f9ef0', C.mint, '#c3c8dc', C.coral]
    shelves.forEach((y, k) => {
      let x = -0.56
      while (x < 0.4) {
        const w = 0.28 + r() * 0.14
        if (x + w > 0.57) break
        const h = k === 3 ? 0.12 + r() * 0.1 : 0.2 + r() * 0.24
        const kraft = r() > 0.4
        const cx = x + w / 2
        if (kraft) {
          parts.push({ g: boxG(w - 0.02, h, 0.36), p: [cx, y + 0.0125 + h / 2, -0.02], c: r() > 0.5 ? C.kraft : '#cf9d62' })
          parts.push({ g: boxG(0.05, h + 0.002, 0.362), p: [cx, y + 0.0125 + h / 2, -0.02], c: '#a87a45' })
        } else {
          const c = bins[Math.floor(r() * bins.length)]
          parts.push({ g: boxG(w - 0.03, h, 0.38), p: [cx, y + 0.0125 + h / 2, -0.01], c })
          parts.push({ g: boxG(w - 0.01, 0.025, 0.4), p: [cx, y + 0.0125 + h + 0.012, -0.01], c: '#5a6072' })
        }
        x += w + 0.02
      }
    })
    return merge(parts)
  })
}

/** Metal shelf (1.2 × 0.45 m, ~1.9 m, back against the wall): dark steel uprights, four galvanized shelves, cardboard boxes and lidded bins (one mesh). */
export function StorageRack() {
  return <M g={storageRackGeometry()} m={vcMat(0.7, false, false, 0.15)} />
}

/* ---------- stairs ---------- */

const STEPS = 14
const STAIR_H = 2.8
const STAIR_L = 3.2
const RISE = STAIR_H / STEPS
const RUN = STAIR_L / STEPS

/** Stair parts (built once): wooden treads (uv kept), white risers, two stringers, railing on the +x side. */
function stairsGeometry() {
  return cached('stairs', () => {
    const treads: Part[] = []
    const risers: Part[] = []
    for (let i = 0; i < STEPS; i++) {
      const top = (i + 1) * RISE
      const zf = STAIR_L / 2 - i * RUN
      treads.push({ g: boxG(0.9, 0.04, RUN + 0.02), p: [0, top - 0.02, zf - RUN / 2 + 0.01] })
      risers.push({ g: boxG(0.9, RISE - 0.04, 0.02), p: [0, i * RISE + (RISE - 0.04) / 2, zf - 0.01] })
    }
    const side = new THREE.Shape([
      new THREE.Vector2(1.62, 0),
      new THREE.Vector2(1.62, 0.28),
      new THREE.Vector2(-1.25, 2.86),
      new THREE.Vector2(-1.6, 2.86),
      new THREE.Vector2(-1.6, 2.55),
      new THREE.Vector2(1.2, 0),
    ])
    const plate = new THREE.ExtrudeGeometry(side, { depth: 0.05, bevelEnabled: false }).rotateY(-Math.PI / 2)
    const stringers = merge([{ g: plate, p: [-0.45, 0, 0] }, { g: plate, p: [0.5, 0, 0] }])
    // railing: newel posts at the bottom and top, sloped handrail, one baluster per step
    const x = 0.46
    const y0 = 1.08
    const z0 = 1.5
    const y1 = STAIR_H + 0.88
    const z1 = -1.5
    const railY = (z: number) => y0 + ((z0 - z) / (z0 - z1)) * (y1 - y0)
    const rail: Part[] = [
      { g: boxG(0.08, 1.12, 0.08), p: [x, 0.56, z0], c: C.kraftDark },
      { g: boxG(0.08, 0.92, 0.08), p: [x, STAIR_H + 0.46, z1], c: C.kraftDark },
      rod([x, y0 + 0.04, z0], [x, y1 + 0.04, z1], 0.03, C.kraftDark, 10),
    ]
    for (let i = 1; i < STEPS - 1; i++) {
      const z = STAIR_L / 2 - (i + 0.5) * RUN
      rail.push(rod([x, (i + 1) * RISE, z], [x, railY(z), z], 0.012, C.white, 6))
    }
    return { treads: merge(treads, true), risers: merge(risers), stringers, rail: merge(rail) }
  })
}

/**
 * Stairs (1 × 3.2 m): 14 steps from the first step at the +z end up to 2.8 m (the floor height) at the -z end; wooden
 * treads (woodGrainTexture), white risers and stringers, railing on the +x side (newel posts, handrail, balusters).
 * Repeated parts are merged: four meshes in total.
 */
export function Stairs() {
  const g = stairsGeometry()
  return (
    <group>
      <M g={g.treads} m={woodMat(C.kraft)} />
      <M g={g.risers} m={mat(C.offWhite)} />
      <M g={g.stringers} m={mat(C.white)} />
      <M g={g.rail} m={vcMat(0.6)} />
    </group>
  )
}

/**
 * Railing around the stairwell opening on the floor above (model/stairwell.ts > railEdges): the same dark wooden handrail
 * (95 cm) and corner posts as the stair railing, with thin white balusters between them (12 cm apart). Edges are in world
 * coordinates (local to the floor).
 */
export function StairwellRail({ edges }: { edges: { a: { x: number; z: number }; b: { x: number; z: number } }[] }) {
  const key = JSON.stringify(edges)
  const g = useMemo(() => {
    const parts: Part[] = []
    for (const { a, b } of JSON.parse(key) as typeof edges) {
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      const ang = Math.atan2(b.x - a.x, b.z - a.z)
      parts.push({ g: boxG(0.07, 0.06, len + 0.07), p: [(a.x + b.x) / 2, 0.95, (a.z + b.z) / 2], r: [0, ang, 0], c: C.kraftDark })
      for (const q of [a, b]) parts.push({ g: boxG(0.08, 0.98, 0.08), p: [q.x, 0.49, q.z], c: C.kraftDark })
      const n = Math.max(1, Math.floor(len / 0.12))
      for (let i = 1; i < n; i++) {
        const t = i / n
        parts.push({ g: boxG(0.025, 0.92, 0.025), p: [a.x + (b.x - a.x) * t, 0.46, a.z + (b.z - a.z) * t], c: C.white })
      }
    }
    return parts.length ? merge(parts) : null
  }, [key])
  useEffect(() => () => g?.dispose(), [g])
  return g ? <M g={g} m={vcMat(0.6)} /> : null
}

/* ---------- garage door ---------- */

/*
 * Same local layout as Door (APERTURE_INSET = 0.21): room boundary at z = -0.21, wall -0.26..-0.16; the door panels sit
 * just in front of the wall's inner face. Opening 2.4 × 2.25 m. The panels rise on the vertical track, turn inwards (+z)
 * through an arc of radius R below the ceiling and run along the horizontal track.
 */
const GD_EDGE = -APERTURE_INSET
const GD_W = 2.4
const GD_H = 2.25
const GD_PANELS = 4
const GD_PH = GD_H / GD_PANELS
const GD_Z = -0.135
const GD_R = 0.28
const GD_ARC = (Math.PI * GD_R) / 2
const _ta = { y: 0, z: 0 }
const _tb = { y: 0, z: 0 }

/** Point on the track at s (arc length from the bottom): vertical, arc, horizontal. */
function trackAt(s: number, out: { y: number; z: number }) {
  if (s <= GD_H) {
    out.y = s
    out.z = GD_Z
  } else if (s <= GD_H + GD_ARC) {
    const a = (s - GD_H) / GD_R
    out.y = GD_H + GD_R * Math.sin(a)
    out.z = GD_Z + GD_R * (1 - Math.cos(a))
  } else {
    out.y = GD_H + GD_R
    out.z = GD_Z + GD_R + (s - GD_H - GD_ARC)
  }
}

/** Door panel: main slab with raised panels on both faces (a dark glass band on the top panel) (built once). */
function garagePanelGeometry(glass: boolean) {
  return cached(`gd-panel-${glass}`, () => {
    const parts: Part[] = [{ g: boxG(GD_W - 0.02, GD_PH - 0.012, 0.045), c: '#f3f4fb' }]
    for (const z of [-0.025, 0.025])
      for (const x of [-0.6, 0.6]) {
        if (glass) for (const dx of [-0.25, 0.25]) parts.push({ g: boxG(0.4, GD_PH * 0.42, 0.006), p: [x + dx, 0, z], c: '#2a3550' })
        else parts.push({ g: boxG(1.0, GD_PH * 0.55, 0.006), p: [x, 0, z], c: '#e1e4ee' })
      }
    return merge(parts)
  })
}

/** Curved track pieces, horizontal tracks and the opener rail (built once). */
function garageTracksGeometry() {
  return cached('gd-tracks', () => {
    const parts: Part[] = []
    for (const sx of [-1, 1]) {
      parts.push({ g: new THREE.TorusGeometry(GD_R, 0.02, 4, 10, Math.PI / 2), p: [sx * 1.215, GD_H, GD_Z + GD_R], r: [0, Math.PI / 2, 0] })
      parts.push({ g: boxG(0.04, 0.05, 2.1), p: [sx * 1.215, GD_H + GD_R, GD_Z + GD_R + 1.05] })
    }
    parts.push({ g: boxG(0.05, 0.04, 2.5), p: [0, GD_H + GD_R + 0.03, GD_Z + 1.4] })
    return merge(parts)
  })
}

/** Garage door opening (0-1) and whether it is moving: from the cover motor (main or extra), else the on state. */
function garageState(v: Visual) {
  const cover = v.domain === 'cover' ? { state: v.state, attributes: v.attrs } : v.related.find((e) => domainOf(e.entity_id) === 'cover')
  const moving = cover?.state === 'opening' || cover?.state === 'closing'
  const pos = cover ? num(cover.attributes.current_position) : null
  if (pos != null) return { f: Math.min(1, Math.max(0, pos / 100)), moving }
  if (cover && (cover.state === 'open' || cover.state === 'opening')) return { f: 1, moving }
  return { f: v.on || v.related.some((e) => isContact(e) && isActive(e)) ? 1 : 0, moving }
}

const _wp = new THREE.Vector3()
const _wd = new THREE.Vector3()

/** Wall height (same rule as devices.tsx > useWallHeight): low for interior walls and in plan view, cut down on an exterior wall facing the camera. */
function useWallHeight(ref: React.RefObject<THREE.Group | null>, interior: boolean, full: number, apply: (h: number) => void) {
  const h = useRef(full)
  const invalidate = useThree((s) => s.invalidate)
  const innerFull = useView((s) => s.innerWalls === 'full')
  useEffect(() => invalidate(), [interior, innerFull, invalidate])
  useFrame((state, dt) => {
    const g = ref.current
    if (!g) return
    let target = full
    // Full height in walk mode and while the roof is down (same as RoomMesh > Wall)
    if (useView.getState().fps || roofView.covered) target = full
    else if (useView.getState().plan) target = WALL_INNER_H
    else if (interior) target = innerFull ? full : WALL_INNER_H
    else {
      g.getWorldPosition(_wp)
      g.getWorldDirection(_wd)
      const dx = state.camera.position.x - _wp.x
      const dz = state.camera.position.z - _wp.z
      if ((-_wd.x * dx - _wd.z * dz) / (Math.hypot(dx, dz) || 1) > 0.2) target = WALL_CUT_H
    }
    const d = target - h.current
    if (Math.abs(d) < 0.001) return
    h.current += d * Math.min(1, dt * 8)
    apply(h.current)
    markShadows(1)
    state.invalidate()
  })
}

/**
 * Garage door (wall opening like Door; footprint 2.6 × 0.2, opening 2.4 × 2.25 m): frame (two sides and top), threshold,
 * sectional door of four horizontal panels (glass band on the top panel), vertical tracks, curved and horizontal tracks
 * at the ceiling, motorized opener. Opening: the cover's current_position / 100, else fully open for open / opening,
 * otherwise closed; v.on (a door sensor) also counts as open. While opening the panels slide up, turn inwards (+z) through
 * the arc and run below the ceiling, settling smoothly. While moving (opening / closing) the opener LED glows. When the
 * wall is low (cut exterior wall, plan view) the door lowers with it, and an open door's panels are hidden.
 */
export function GarageDoor({ v }: P) {
  const root = useRef<THREE.Group>(null)
  const tall = useRef<THREE.Group>(null)
  const chain = useRef<THREE.Group>(null)
  const panels = useRef<(THREE.Mesh | null)[]>([])
  const hRef = useRef(GD_H)
  const fRef = useRef(0)
  const { f, moving } = garageState(v)
  const led = useLitMaterial('#5a5f70', moving, C.sun, 1, 2.4)
  const show = () => {
    if (chain.current) chain.current.visible = hRef.current > 1.2 || fRef.current < 0.02
  }
  useWallHeight(root, v.interior, GD_H, (h) => {
    hRef.current = h
    if (tall.current) tall.current.scale.y = Math.max(0.02, h / GD_H)
    show()
  })
  useFollow(
    f,
    (x) => {
      fRef.current = x
      const shift = x * (GD_H + 0.08)
      panels.current.forEach((m, i) => {
        if (!m) return
        trackAt(i * GD_PH + shift + 0.004, _ta)
        trackAt((i + 1) * GD_PH + shift - 0.004, _tb)
        m.position.set(0, (_ta.y + _tb.y) / 2, (_ta.z + _tb.z) / 2)
        m.rotation.x = Math.atan2(_tb.z - _ta.z, _tb.y - _ta.y)
      })
      show()
    },
    1.2,
  )
  const frame = v.unavailable ? DIM : C.white
  const steel = mat('#9aa0b8', { roughness: 0.4, metalness: 0.5 })
  return (
    <group ref={root}>
      <group ref={tall}>
        <Box size={[0.1, GD_H + 0.04, 0.24]} position={[-GD_W / 2 - 0.05, (GD_H + 0.04) / 2, GD_EDGE]} color={frame} />
        <Box size={[0.1, GD_H + 0.04, 0.24]} position={[GD_W / 2 + 0.05, (GD_H + 0.04) / 2, GD_EDGE]} color={frame} />
        <Box size={[GD_W + 0.2, 0.1, 0.24]} position={[0, GD_H + 0.05, GD_EDGE]} color={frame} />
        {[-1, 1].map((sx) => (
          <Box key={sx} size={[0.04, GD_H, 0.05]} position={[sx * 1.215, GD_H / 2, GD_Z]} material={steel} shadow={false} />
        ))}
        <group ref={chain}>
          {Array.from({ length: GD_PANELS }, (_, i) => (
            <mesh
              key={i}
              ref={(m) => {
                panels.current[i] = m
              }}
              geometry={garagePanelGeometry(i === GD_PANELS - 1)}
              material={vcMat(0.55)}
              castShadow
              receiveShadow
            />
          ))}
        </group>
      </group>
      <Box size={[GD_W, 0.012, 0.22]} position={[0, 0.006, GD_EDGE]} color={C.concrete} shadow={false} />
      {/* ceiling tracks and opener */}
      <M g={garageTracksGeometry()} m={steel} shadow={false} />
      <Box size={[0.3, 0.13, 0.4]} position={[0, GD_H + GD_R - 0.02, GD_Z + 2.75]} color={C.offWhite} radius={0.03} />
      <Ball r={0.015} position={[0, GD_H + GD_R - 0.09, GD_Z + 2.9]} material={led} shadow={false} />
    </group>
  )
}
