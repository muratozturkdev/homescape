import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { rng } from './kit/primitives'

/*
 * Pet and outdoor visitor models: cats and dogs placed in the home roam on their own and can be interacted with; animals
 * visit outside. Same approach as the people (humanModel.ts): each bone segment merges colored primitives into one geometry
 * (vertex colors, one shared material), large shiny eyes, soft rounded shapes. About 20 draw calls per cat. Real-world sizes
 * (cat nose to tail base ~47 cm, golden ~88 cm, terrier ~57 cm); stylized proportions (large head). Local +z forward,
 * x < 0 is the animal's right (N, negative), x > 0 its left (P, positive).
 */

export type Species = 'cat' | 'dog'
export type Pattern = 'none' | 'tabby' | 'spots' | 'tuxedo' | 'patches'

export interface PetLook {
  key: string
  species: Species
  coat: string
  /** Chest, muzzle, belly */
  light: string
  /** Pattern color: tabby stripe, spot, patch */
  dark: string
  pattern: Pattern
  eyes: string
  nose: string
  /** Inner ear */
  earIn: string
  ears: 'cat' | 'floppy' | 'pointy'
  /** Light colored paws (socks) */
  socks?: boolean
  /** Whisker color */
  whisker?: string
  /** Feathered tail (golden) */
  plume?: boolean
  collar?: string
  scale: number
}

/** Cat coats (Item.variant): orange tabby, black, white, grey; the neighbor's cat is a tuxedo (visitor). */
export const CAT_LOOKS: Record<string, PetLook> = {
  tabby: { key: 'cat-tabby', species: 'cat', coat: '#e8a05a', light: '#f8e3c4', dark: '#c0662e', pattern: 'tabby', eyes: '#9cc04a', nose: '#e58f8f', earIn: '#f2b3a8', ears: 'cat', scale: 0.86 },
  black: { key: 'cat-black', species: 'cat', coat: '#2c2b33', light: '#3a3944', dark: '#24232a', pattern: 'none', eyes: '#d9cf4a', nose: '#4a3a40', earIn: '#5a4650', ears: 'cat', whisker: '#d9d9de', scale: 0.84 },
  white: { key: 'cat-white', species: 'cat', coat: '#f5f2ec', light: '#ffffff', dark: '#e3ddd3', pattern: 'none', eyes: '#6fb6e8', nose: '#f19aa6', earIn: '#f6b8c0', ears: 'cat', whisker: '#9a9aa2', scale: 0.84 },
  grey: { key: 'cat-grey', species: 'cat', coat: '#98a0ae', light: '#d9dde6', dark: '#7a8291', pattern: 'tabby', eyes: '#7fc38a', nose: '#c98a96', earIn: '#d8a9b3', ears: 'cat', socks: true, scale: 0.86 },
  tuxedo: { key: 'cat-tuxedo', species: 'cat', coat: '#26252c', light: '#f4f2ee', dark: '#1e1d23', pattern: 'tuxedo', eyes: '#a8d05a', nose: '#e59aa2', earIn: '#6a5560', ears: 'cat', socks: true, whisker: '#f2f2f2', scale: 0.82 },
}

/** Dog breeds (Item.variant): golden, black labrador, small terrier, dalmatian; the stray dog (visitor). */
export const DOG_LOOKS: Record<string, PetLook> = {
  golden: { key: 'dog-golden', species: 'dog', coat: '#dba45e', light: '#f0cd95', dark: '#c48a45', pattern: 'none', eyes: '#5b3a22', nose: '#2a2020', earIn: '#c48a45', ears: 'floppy', plume: true, collar: '#e2564b', scale: 0.84 },
  labrador: { key: 'dog-labrador', species: 'dog', coat: '#2d2c32', light: '#3a3940', dark: '#25242a', pattern: 'none', eyes: '#7a5230', nose: '#151416', earIn: '#26252b', ears: 'floppy', collar: '#3f56e0', scale: 0.84 },
  terrier: { key: 'dog-terrier', species: 'dog', coat: '#f3efe6', light: '#ffffff', dark: '#b07a48', pattern: 'patches', eyes: '#3b2a1e', nose: '#1d1a1a', earIn: '#e8b0a0', ears: 'pointy', collar: '#2fbf71', scale: 0.55 },
  dalmatian: { key: 'dog-dalmatian', species: 'dog', coat: '#f6f3ec', light: '#ffffff', dark: '#22212a', pattern: 'spots', eyes: '#4a3424', nose: '#1d1a1a', earIn: '#d9d2c8', ears: 'floppy', collar: '#f0a63a', scale: 0.82 },
  stray: { key: 'dog-stray', species: 'dog', coat: '#a77a4f', light: '#d8b585', dark: '#7d5634', pattern: 'none', eyes: '#3b2a1e', nose: '#1d1a1a', earIn: '#c99a80', ears: 'pointy', scale: 0.7 },
}

export const CAT_DEF = 'tabby'
export const DOG_DEF = 'golden'

/** Look from the item species and variant */
export function petLook(species: Species, variant?: string): PetLook {
  const list = species === 'cat' ? CAT_LOOKS : DOG_LOOKS
  return list[variant ?? ''] ?? list[species === 'cat' ? CAT_DEF : DOG_DEF]
}

/**
 * Skeleton dimensions (scale 1; root on the ground under the middle of the body). Hip and shoulder joint height, hip to
 * shoulder, leg segments, body ellipsoids (rump and chest), neck and head position, tail.
 */
export interface PetFrame {
  hipY: number
  shY: number
  ls: number
  upper: number
  lower: number
  rumpC: V3
  rumpR: V3
  chestC: V3
  chestR: V3
  neck: V3
  head: V3
  headR: number
  tailBase: V3
  tailSeg: number
  tailR: number
  ear: V3
  /** Height of the body center when lying down (belly on the ground) */
  lieY: number
  /** Hip height when sitting */
  sitY: number
}

type V3 = [number, number, number]

export const FRAME: Record<Species, PetFrame> = {
  cat: {
    hipY: 0.2,
    shY: 0.2,
    ls: 0.22,
    upper: 0.1,
    lower: 0.1,
    rumpC: [0, 0.015, 0.03],
    rumpR: [0.072, 0.075, 0.14],
    chestC: [0, 0.012, -0.035],
    chestR: [0.074, 0.082, 0.135],
    neck: [0, 0.058, 0.075],
    head: [0, 0.055, 0.035],
    headR: 0.082,
    tailBase: [0, 0.045, -0.12],
    tailSeg: 0.075,
    tailR: 0.021,
    ear: [0.047, 0.058, -0.008],
    lieY: 0.072,
    sitY: 0.075,
  },
  dog: {
    hipY: 0.4,
    shY: 0.42,
    ls: 0.42,
    upper: 0.2,
    lower: 0.21,
    rumpC: [0, 0.025, 0.06],
    rumpR: [0.12, 0.125, 0.25],
    chestC: [0, 0.01, -0.05],
    chestR: [0.13, 0.155, 0.23],
    neck: [0, 0.1, 0.14],
    head: [0, 0.12, 0.065],
    headR: 0.12,
    tailBase: [0, 0.075, -0.2],
    tailSeg: 0.085,
    tailR: 0.03,
    ear: [0.093, 0.07, -0.01],
    lieY: 0.13,
    sitY: 0.12,
  },
}

/* ---------- merging (same approach as humanModel.ts > bake) ---------- */

interface Prim {
  g: THREE.BufferGeometry
  c: string | THREE.Color
  p?: V3
  r?: V3
  q?: THREE.Quaternion
  s?: V3
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** Places the primitives and merges them with their colors into one geometry (vertex colors, non-indexed). */
export function bake(prims: Prim[]): THREE.BufferGeometry {
  if (!prims.length) return new THREE.BufferGeometry()
  const parts = prims.map(({ g, c, p = [0, 0, 0], r = [0, 0, 0], q, s = [1, 1, 1] }) => {
    const geo = g.index ? g.toNonIndexed() : g.clone()
    if (geo.attributes.uv) geo.deleteAttribute('uv')
    _m.compose(_p.set(...p), q ?? _q.setFromEuler(_e.set(...r)), _s.set(...s))
    geo.applyMatrix4(_m)
    const col = c instanceof THREE.Color ? c : new THREE.Color(c)
    const n = geo.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r
      arr[i * 3 + 1] = col.g
      arr[i * 3 + 2] = col.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return geo
  })
  const out = mergeGeometries(parts, false) ?? new THREE.BufferGeometry()
  for (const g of parts) g.dispose()
  out.computeBoundingSphere()
  return out
}

/* ---------- primitives (unit size; sized by scale) ---------- */

const SPH = new THREE.SphereGeometry(1, 14, 10)
const SPH_LO = new THREE.SphereGeometry(1, 8, 6)
const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 2, 9)
const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg)
const cone = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg)
const torus = (r: number, tube: number, arc = Math.PI * 2, seg = 18) => new THREE.TorusGeometry(r, tube, 5, seg, arc)

const tint = (hex: string | THREE.Color, k: number) => new THREE.Color(hex).multiplyScalar(k)
const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t)
const UP = new THREE.Vector3(0, 1, 0)
const toward = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())

/** Point and normal on the ellipsoid surface (center c, radii r) in direction d */
function onEllipsoid(c: V3, r: V3, d: V3, out = 1) {
  const v = new THREE.Vector3(d[0] / r[0], d[1] / r[1], d[2] / r[2]).normalize()
  const pos: V3 = [c[0] + v.x * r[0] * out, c[1] + v.y * r[1] * out, c[2] + v.z * r[2] * out]
  const n = new THREE.Vector3(v.x / r[0], v.y / r[1], v.z / r[2]).normalize()
  return { pos, n }
}

/** Stripe wrapping over the body ellipsoid (tabby pattern): a partial ring in the ellipsoid's z section */
function band(c: V3, r: V3, z: number, color: string | THREE.Color, w = 0.012, arc = 0.75): Prim {
  const k = Math.sqrt(Math.max(0.05, 1 - ((z - c[2]) / r[2]) ** 2))
  return { g: torus(1, 0.06, Math.PI * arc, 14), c: color, p: [c[0], c[1], z], r: [0, 0, Math.PI * (0.5 - arc / 2)], s: [r[0] * k * 1.02, r[1] * k * 1.02, w / 0.06] }
}

/** Ring around a vertical limb (leg, tail segment): at height y, radius r, thickness w */
function ring(y: number, r: number, color: string | THREE.Color, w = 0.008): Prim {
  return { g: torus(1, 0.08, Math.PI * 2, 12), c: color, p: [0, y, 0], r: [Math.PI / 2, 0, 0], s: [r * 1.04, r * 1.04, w / 0.08] }
}

/** Flat mark stuck to the surface (spot, patch) */
function spot(c: V3, r: V3, d: V3, size: number, color: string | THREE.Color, flat = 0.006): Prim {
  const { pos, n } = onEllipsoid(c, r, d, 0.985)
  return { g: SPH_LO, c: color, p: pos, q: toward(n), s: [size, flat, size * 0.8] }
}

/* ---------- parts ---------- */

export type PetPart = 'rump' | 'chest' | 'head' | 'earN' | 'earP' | 'lids' | 'mouth' | 'tongue' | 'upperF' | 'lowerF' | 'upperH' | 'lowerH' | 'tail0' | 'tail1' | 'tail2' | 'tail3'

/** Eye: dark rim, iris, pupil (vertical slit for cats), two highlights */
function eye(look: PetLook, x: number, y: number, z: number, size: number, cat: boolean): Prim[] {
  const sx = Math.sign(x) || 1
  const out: Prim[] = []
  if (cat) {
    out.push({ g: SPH, c: '#2a2224', p: [x, y, z - 0.002 * size], s: [0.025 * size, 0.028 * size, 0.011 * size] })
    out.push({ g: SPH, c: look.eyes, p: [x, y, z + 0.0015 * size], s: [0.0215 * size, 0.0245 * size, 0.011 * size] })
    out.push({ g: SPH_LO, c: '#14100f', p: [x, y - 0.001 * size, z + 0.008 * size], s: [0.0065 * size, 0.019 * size, 0.0065 * size] })
  } else {
    out.push({ g: SPH, c: '#fbfaf7', p: [x, y, z - 0.002 * size], s: [0.026 * size, 0.028 * size, 0.012 * size] })
    out.push({ g: SPH, c: look.eyes, p: [x + sx * 0.002 * size, y - 0.002 * size, z + 0.004 * size], s: [0.02 * size, 0.022 * size, 0.011 * size] })
    out.push({ g: SPH_LO, c: '#120d0b', p: [x + sx * 0.002 * size, y - 0.002 * size, z + 0.01 * size], s: [0.012 * size, 0.013 * size, 0.0065 * size] })
  }
  out.push({ g: SPH_LO, c: '#ffffff', p: [x + 0.007 * size, y + 0.009 * size, z + 0.013 * size], s: [0.0062 * size, 0.0062 * size, 0.003 * size] })
  out.push({ g: SPH_LO, c: '#ffffff', p: [x - 0.006 * size, y - 0.008 * size, z + 0.012 * size], s: [0.003 * size, 0.003 * size, 0.0018 * size] })
  return out
}

/** Eye position: front surface of the head ellipsoid */
function eyeZ(R: [number, number, number], x: number, y: number) {
  const k = 1 - (x / R[0]) ** 2 - (y / R[1]) ** 2
  return R[2] * Math.sqrt(Math.max(0, k))
}

function catParts(look: PetLook): Record<PetPart, THREE.BufferGeometry> {
  const F = FRAME.cat
  const coat = look.coat
  const light = look.light
  const dark = look.dark
  const tabby = look.pattern === 'tabby'
  const tux = look.pattern === 'tuxedo'
  const rump: Prim[] = [
    { g: SPH, c: coat, p: F.rumpC, s: F.rumpR },
    // belly (light, underneath)
    { g: SPH, c: tux ? light : mix(coat, light, 0.7), p: [0, F.rumpC[1] - 0.03, F.rumpC[2] + 0.02], s: [F.rumpR[0] * 0.78, F.rumpR[1] * 0.7, F.rumpR[2] * 0.85] },
  ]
  const chest: Prim[] = [
    { g: SPH, c: coat, p: F.chestC, s: F.chestR },
    // nape and neck: soft transition to the head
    { g: SPH, c: coat, p: [0, F.neck[1] - 0.005, F.neck[2] - 0.005], s: [0.056, 0.06, 0.06] },
    // chest bib
    { g: SPH, c: light, p: [0, F.chestC[1] - 0.02, F.chestC[2] + 0.075], s: [0.05, 0.062, 0.05] },
  ]
  if (tabby) {
    for (const z of [-0.07, -0.025, 0.02, 0.065]) rump.push(band(F.rumpC, F.rumpR, z, dark, 0.014))
    for (const z of [-0.04, 0.0]) chest.push(band(F.chestC, F.chestR, z, dark, 0.013, 0.55))
  }
  // head
  const R: [number, number, number] = [F.headR * 1.08, F.headR * 0.95, F.headR * 0.95]
  const head: Prim[] = [
    { g: SPH, c: coat, p: [0, 0, 0], s: R },
    // cheek fluff
    { g: SPH, c: coat, p: [-0.042, -0.026, 0.022], s: [0.052, 0.042, 0.048] },
    { g: SPH, c: coat, p: [0.042, -0.026, 0.022], s: [0.052, 0.042, 0.048] },
    // whisker pads and chin
    { g: SPH, c: light, p: [-0.016, -0.031, 0.067], s: [0.022, 0.018, 0.018] },
    { g: SPH, c: light, p: [0.016, -0.031, 0.067], s: [0.022, 0.018, 0.018] },
    { g: SPH, c: light, p: [0, -0.047, 0.056], s: [0.018, 0.012, 0.014] },
    // nose: small downward triangle
    { g: cone(0.011, 0.012, 3), c: look.nose, p: [0, -0.012, 0.081], r: [0.25, 0, Math.PI], s: [1.2, 1, 0.6] },
    // mouth: two small arcs ("w")
    { g: torus(0.008, 0.0016, Math.PI, 10), c: tint(look.nose, 0.55), p: [-0.008, -0.03, 0.084], r: [0, 0, Math.PI] },
    { g: torus(0.008, 0.0016, Math.PI, 10), c: tint(look.nose, 0.55), p: [0.008, -0.03, 0.084], r: [0, 0, Math.PI] },
  ]
  if (tux) {
    head.push({ g: SPH, c: light, p: [0, -0.03, 0.05], s: [0.045, 0.03, 0.035] })
  }
  if (tabby) {
    // "M" stripes on the forehead
    for (const [x, rz] of [
      [-0.016, 0.2],
      [0, 0],
      [0.016, -0.2],
    ] as const)
      head.push({ g: cap(0.0035, 0.022), c: dark, p: [x, 0.05, eyeZ(R, x, 0.05) - 0.002], r: [0.6, 0, rz] })
  }
  const ey = 0.008
  for (const sx of [-1, 1]) {
    const ex = sx * 0.034
    head.push(...eye(look, ex, ey, eyeZ(R, ex, ey) - 0.004, 1, true))
    // whiskers: three thin strands
    for (let k = 0; k < 3; k++)
      head.push({ g: cyl(0.0011, 0.0011, 0.075, 4), c: look.whisker ?? '#f7f5f0', p: [sx * 0.062, -0.034 + (k - 1) * 0.0065, 0.058], r: [0, sx * 0.3, sx * (Math.PI / 2 + (k - 1) * 0.16)] })
  }
  const lids: Prim[] = []
  for (const sx of [-1, 1]) {
    const ex = sx * 0.034
    const z = eyeZ(R, ex, ey) - 0.002
    lids.push({ g: SPH, c: tint(coat, 0.95), p: [ex, ey, z], s: [0.026, 0.029, 0.013] })
    lids.push({ g: cap(0.0022, 0.03), c: '#2a2224', p: [ex, ey - 0.004, z + 0.012], r: [0, 0, Math.PI / 2] })
  }
  const mouth: Prim[] = [{ g: SPH, c: '#7a3540', p: [0, -0.043, 0.07], s: [0.013, 0.011, 0.006] }]
  // ears (on their own joints so they can move)
  const ear = (): Prim[] => [
    { g: cone(0.034, 0.062, 4), c: coat, p: [0, 0.026, 0], r: [0, Math.PI / 4, 0], s: [1, 1, 0.55] },
    { g: cone(0.022, 0.044, 4), c: look.earIn, p: [0, 0.022, 0.009], r: [0, Math.PI / 4, 0], s: [1, 1, 0.4] },
  ]
  // legs: upper (shoulder or hip bulge) and lower (paw)
  const paw = look.socks || tux ? light : coat
  const upperF: Prim[] = [
    { g: SPH, c: coat, p: [0, -0.005, 0], s: [0.04, 0.045, 0.045] },
    { g: cap(0.028, F.upper * 0.7), c: coat, p: [0, -F.upper / 2, 0] },
  ]
  const lowerF: Prim[] = [
    { g: cap(0.024, F.lower * 0.6), c: coat, p: [0, -F.lower * 0.42, 0] },
    { g: SPH, c: paw, p: [0, -F.lower + 0.02, 0.01], s: [0.028, 0.02, 0.034] },
  ]
  const upperH: Prim[] = [
    { g: SPH, c: coat, p: [0, -0.012, 0.004], s: [0.05, 0.062, 0.062] },
    { g: cap(0.03, F.upper * 0.65), c: coat, p: [0, -F.upper / 2, -0.004] },
  ]
  const lowerH: Prim[] = [
    { g: cap(0.024, F.lower * 0.6), c: coat, p: [0, -F.lower * 0.42, 0] },
    { g: SPH, c: paw, p: [0, -F.lower + 0.02, 0.012], s: [0.029, 0.02, 0.036] },
  ]
  if (tabby) {
    upperF.push(ring(-F.upper * 0.6, 0.028, dark))
    upperH.push(ring(-F.upper * 0.55, 0.03, dark))
    lowerF.push(ring(-F.lower * 0.35, 0.024, dark, 0.007))
    lowerH.push(ring(-F.lower * 0.35, 0.024, dark, 0.007))
  }
  // tail: four segments tapering to the tip; ringed on tabbies, dark tip (not white) on tuxedos
  const tail = (i: number): Prim[] => {
    const r = F.tailR * (1 - i * 0.1)
    const banded = tabby && i % 2 === 1
    const out: Prim[] = [{ g: cap(r, F.tailSeg), c: banded ? dark : coat, p: [0, F.tailSeg / 2, 0] }]
    if (tabby && i % 2 === 0) out.push(ring(F.tailSeg * 0.8, r, dark, 0.014))
    return out
  }
  return {
    rump: bake(rump),
    chest: bake(chest),
    head: bake(head),
    earN: bake(ear()),
    earP: bake(ear()),
    lids: bake(lids),
    mouth: bake(mouth),
    tongue: new THREE.BufferGeometry(),
    upperF: bake(upperF),
    lowerF: bake(lowerF),
    upperH: bake(upperH),
    lowerH: bake(lowerH),
    tail0: bake(tail(0)),
    tail1: bake(tail(1)),
    tail2: bake(tail(2)),
    tail3: bake(tail(3)),
  }
}

function dogParts(look: PetLook): Record<PetPart, THREE.BufferGeometry> {
  const F = FRAME.dog
  const coat = look.coat
  const light = look.light
  const dark = look.dark
  const rnd = rng(look.key.length * 31 + 7)
  const rump: Prim[] = [
    { g: SPH, c: coat, p: F.rumpC, s: F.rumpR },
    { g: SPH, c: mix(coat, light, 0.75), p: [0, F.rumpC[1] - 0.05, F.rumpC[2] + 0.03], s: [F.rumpR[0] * 0.78, F.rumpR[1] * 0.68, F.rumpR[2] * 0.8] },
  ]
  const chest: Prim[] = [
    { g: SPH, c: coat, p: F.chestC, s: F.chestR },
    // neck: thick transition from chest to head
    { g: SPH, c: coat, p: [0, F.neck[1] + 0.02, F.neck[2] + 0.01], s: [0.085, 0.11, 0.09] },
    // chest (light)
    { g: SPH, c: light, p: [0, F.chestC[1] - 0.03, F.chestC[2] + 0.12], s: [0.09, 0.11, 0.09] },
  ]
  if (look.collar) {
    chest.push({ g: torus(0.088, 0.015, Math.PI * 2, 28), c: look.collar, p: [0, F.neck[1] + 0.035, F.neck[2] + 0.015], r: [Math.PI / 2 - 0.7, 0, 0], s: [1, 1.05, 1] })
    chest.push({ g: cyl(0.018, 0.018, 0.006, 14), c: '#f2c84a', p: [0, F.neck[1] - 0.03, F.neck[2] + 0.085], r: [Math.PI / 2 - 0.4, 0, 0] })
  }
  if (look.pattern === 'spots') {
    for (let i = 0; i < 16; i++) rump.push(spot(F.rumpC, F.rumpR, [rnd() * 2 - 1, 0.2 + rnd() * 0.8, rnd() * 2 - 1], 0.02 + rnd() * 0.018, dark))
    for (let i = 0; i < 10; i++) chest.push(spot(F.chestC, F.chestR, [rnd() * 2 - 1, 0.1 + rnd() * 0.9, rnd() * 1.6 - 1], 0.018 + rnd() * 0.016, dark))
  } else if (look.pattern === 'patches') {
    rump.push(spot(F.rumpC, F.rumpR, [0.3, 1, -0.2], 0.11, dark, 0.01))
    chest.push(spot(F.chestC, F.chestR, [-0.6, 0.8, -0.3], 0.07, dark, 0.01))
  }
  const R: [number, number, number] = [F.headR, F.headR * 0.92, F.headR * 0.95]
  const muzzle = look.pattern === 'none' ? mix(coat, light, 0.55) : light
  const head: Prim[] = [
    { g: SPH, c: coat, p: [0, 0, 0], s: R },
    { g: SPH, c: coat, p: [-0.05, -0.04, 0.03], s: [0.07, 0.06, 0.07] },
    { g: SPH, c: coat, p: [0.05, -0.04, 0.03], s: [0.07, 0.06, 0.07] },
    // muzzle (bridge and jaw)
    { g: SPH, c: coat, p: [0, -0.012, 0.1], s: [0.05, 0.042, 0.075] },
    { g: SPH, c: muzzle, p: [0, -0.045, 0.115], s: [0.063, 0.052, 0.095] },
    { g: SPH, c: tint(muzzle, 0.95), p: [0, -0.072, 0.1], s: [0.045, 0.026, 0.06] },
    // nose and its highlight
    { g: SPH, c: look.nose, p: [0, -0.022, 0.205], s: [0.03, 0.022, 0.022] },
    { g: SPH_LO, c: '#8a8a92', p: [0.008, -0.012, 0.222], s: [0.008, 0.005, 0.004] },
    // mouth line
    { g: torus(0.016, 0.0026, Math.PI, 10), c: tint(look.nose, 1.6), p: [-0.016, -0.066, 0.19], r: [0.2, 0, Math.PI] },
    { g: torus(0.016, 0.0026, Math.PI, 10), c: tint(look.nose, 1.6), p: [0.016, -0.066, 0.19], r: [0.2, 0, Math.PI] },
  ]
  if (look.pattern === 'patches') head.push(spot([0, 0, 0], R, [0.6, 0.5, 0.6], 0.045, dark, 0.008))
  if (look.pattern === 'spots') for (let i = 0; i < 5; i++) head.push(spot([0, 0, 0], R, [rnd() * 2 - 1, rnd(), rnd() * 0.6 - 0.4], 0.012 + rnd() * 0.01, dark))
  const ey = 0.028
  for (const sx of [-1, 1]) {
    const ex = sx * 0.047
    head.push(...eye(look, ex, ey, eyeZ(R, ex, ey) - 0.003, 1.15, false))
    // brow bump
    head.push({ g: SPH_LO, c: tint(coat, 1.12), p: [sx * 0.047, 0.065, eyeZ(R, ex, 0.065) - 0.006], s: [0.02, 0.01, 0.012] })
  }
  const lids: Prim[] = []
  for (const sx of [-1, 1]) {
    const ex = sx * 0.047
    const z = eyeZ(R, ex, ey) - 0.001
    lids.push({ g: SPH, c: tint(coat, 0.95), p: [ex, ey, z], s: [0.031, 0.033, 0.015] })
    lids.push({ g: cap(0.0028, 0.034), c: '#2a2224', p: [ex, ey - 0.006, z + 0.014], r: [0, 0, Math.PI / 2] })
  }
  const mouth: Prim[] = [{ g: SPH, c: '#5a2830', p: [0, -0.078, 0.16], s: [0.04, 0.018, 0.045] }]
  const tongue: Prim[] = [{ g: SPH, c: '#ec7484', p: [0, -0.09, 0.17], r: [0.5, 0, 0], s: [0.026, 0.008, 0.045] }]
  const earCol = look.pattern === 'patches' ? dark : look.pattern === 'spots' ? tint(dark, 1.4) : tint(coat, 0.86)
  const ear = (sx: number): Prim[] =>
    look.ears === 'floppy'
      ? [{ g: SPH, c: earCol, p: [sx * 0.014, -0.065, 0.006], r: [0, 0, sx * 0.12], s: [0.026, 0.085, 0.062] }]
      : [
          { g: cone(0.042, 0.085, 4), c: earCol, p: [0, 0.036, 0], r: [0, Math.PI / 4, 0], s: [1, 1, 0.5] },
          { g: cone(0.026, 0.058, 4), c: look.earIn, p: [0, 0.03, 0.011], r: [0, Math.PI / 4, 0], s: [1, 1, 0.35] },
        ]
  const paw = look.socks ? light : look.pattern === 'none' ? tint(coat, 1.04) : light
  const legSpots = (y0: number, n: number): Prim[] =>
    look.pattern === 'spots' ? Array.from({ length: n }, (_, i) => spot([0, y0 - i * 0.06, 0], [0.042, 0.06, 0.042], [rnd() * 2 - 1, 0, rnd() * 2 - 1], 0.014, dark, 0.005)) : []
  const upperF: Prim[] = [
    { g: SPH, c: coat, p: [0, -0.01, 0], s: [0.065, 0.075, 0.075] },
    { g: cap(0.045, F.upper * 0.7), c: coat, p: [0, -F.upper / 2, 0] },
    ...legSpots(-0.06, 2),
  ]
  const lowerF: Prim[] = [
    { g: cap(0.037, F.lower * 0.62), c: coat, p: [0, -F.lower * 0.42, 0] },
    { g: SPH, c: paw, p: [0, -F.lower + 0.03, 0.018], s: [0.045, 0.032, 0.058] },
    ...legSpots(-0.05, 2),
  ]
  const upperH: Prim[] = [
    { g: SPH, c: coat, p: [0, -0.02, 0.005], s: [0.08, 0.1, 0.1] },
    { g: cap(0.048, F.upper * 0.62), c: coat, p: [0, -F.upper / 2, -0.01] },
    ...legSpots(-0.08, 2),
  ]
  const lowerH: Prim[] = [
    { g: cap(0.036, F.lower * 0.62), c: coat, p: [0, -F.lower * 0.42, 0] },
    { g: SPH, c: paw, p: [0, -F.lower + 0.03, 0.02], s: [0.045, 0.032, 0.06] },
    ...legSpots(-0.05, 2),
  ]
  const tail = (i: number): Prim[] => {
    const r = F.tailR * (1 - i * 0.16)
    const out: Prim[] = [{ g: cap(r, F.tailSeg), c: coat, p: [0, F.tailSeg / 2, 0] }]
    // golden: feathered tail (light fringe underneath)
    if (look.plume) out.push({ g: SPH, c: light, p: [0, F.tailSeg / 2, -r * 0.9], s: [r * 1.1, F.tailSeg * 0.62, r * 1.6] })
    if (look.pattern === 'spots' && i < 3) out.push(spot([0, F.tailSeg / 2, 0], [r, F.tailSeg / 2, r], [1, 0, 0.3], 0.012, dark, 0.004))
    if (look.pattern === 'patches' && i === 3) out[0].c = light
    return out
  }
  return {
    rump: bake(rump),
    chest: bake(chest),
    head: bake(head),
    earN: bake(ear(-1)),
    earP: bake(ear(1)),
    lids: bake(lids),
    mouth: bake(mouth),
    tongue: bake(tongue),
    upperF: bake(upperF),
    lowerF: bake(lowerF),
    upperH: bake(upperH),
    lowerH: bake(lowerH),
    tail0: bake(tail(0)),
    tail1: bake(tail(1)),
    tail2: bake(tail(2)),
    tail3: bake(tail(3)),
  }
}

const cache = new Map<string, Record<PetPart, THREE.BufferGeometry>>()
/** Part geometries of an animal (built once per look). */
export function petParts(look: PetLook) {
  let g = cache.get(look.key)
  if (!g) cache.set(look.key, (g = look.species === 'cat' ? catParts(look) : dogParts(look)))
  return g
}

/** Shared material of the animals: vertex colors, matte like soft fur (room lights light it too). */
export const petMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })

/* ---------- outdoor visitors: bird, squirrel, butterfly ---------- */

export type BirdKind = 'sparrow' | 'robin' | 'tit'
const BIRD_COLORS: Record<BirdKind, { body: string; belly: string; head: string; wing: string }> = {
  sparrow: { body: '#9b7653', belly: '#e9dcc6', head: '#7b5a3e', wing: '#6f5038' },
  robin: { body: '#8a7a68', belly: '#ef8a4a', head: '#8a7a68', wing: '#6e6152' },
  tit: { body: '#7fae6a', belly: '#f2d75a', head: '#3f6fb0', wing: '#5f8fc9' },
}

const birdCache = new Map<string, { body: THREE.BufferGeometry; wing: THREE.BufferGeometry }>()
/** Bird (~20 cm, stylized): body, head, beak, eyes, tail and legs in one geometry; wings separate (they flap). Local +z forward. */
export function birdParts(kind: BirdKind) {
  let g = birdCache.get(kind)
  if (g) return g
  const c = BIRD_COLORS[kind]
  const body: Prim[] = [
    { g: SPH, c: c.body, p: [0, 0.075, 0], s: [0.05, 0.048, 0.075] },
    { g: SPH, c: c.belly, p: [0, 0.062, 0.022], s: [0.04, 0.038, 0.055] },
    { g: SPH, c: c.head, p: [0, 0.118, 0.055], s: [0.038, 0.036, 0.038] },
    { g: SPH, c: c.belly, p: [0, 0.104, 0.075], s: [0.022, 0.018, 0.016] },
    { g: cone(0.012, 0.03, 8), c: '#f0a63a', p: [0, 0.114, 0.098], r: [Math.PI / 2, 0, 0] },
    { g: cone(0.03, 0.07, 8), c: c.wing, p: [0, 0.088, -0.09], r: [-Math.PI / 2 - 0.35, 0, 0], s: [1, 1, 0.35] },
    { g: cyl(0.004, 0.004, 0.045, 5), c: '#d08a3a', p: [-0.016, 0.022, 0.01] },
    { g: cyl(0.004, 0.004, 0.045, 5), c: '#d08a3a', p: [0.016, 0.022, 0.01] },
  ]
  for (const sx of [-1, 1]) {
    body.push({ g: SPH_LO, c: '#15100e', p: [sx * 0.027, 0.124, 0.075], s: [0.008, 0.009, 0.006] })
    body.push({ g: SPH_LO, c: '#ffffff', p: [sx * 0.028 + 0.002, 0.128, 0.08], s: [0.0028, 0.0028, 0.002] })
  }
  // wing: flat drop extending outward from the shoulder (the right wing is mirrored by scale)
  const wing: Prim[] = [{ g: SPH, c: c.wing, p: [0.055, 0, -0.01], s: [0.06, 0.008, 0.042] }, { g: SPH_LO, c: tint(c.wing, 0.8), p: [0.085, -0.002, -0.02], s: [0.03, 0.006, 0.026] }]
  g = { body: bake(body), wing: bake(wing) }
  birdCache.set(kind, g)
  return g
}

let squirrel: { body: THREE.BufferGeometry; tail: THREE.BufferGeometry } | null = null
/** Squirrel (~22 cm body plus bushy tail): body, head, ears, eyes and legs in one geometry; tail separate (it sways). */
export function squirrelParts() {
  if (squirrel) return squirrel
  const coat = '#b5652e'
  const belly = '#f1d9b8'
  const body: Prim[] = [
    { g: SPH, c: coat, p: [0, 0.07, -0.01], s: [0.05, 0.052, 0.085] },
    { g: SPH, c: belly, p: [0, 0.056, 0.02], s: [0.036, 0.036, 0.055] },
    { g: SPH, c: coat, p: [0, 0.11, 0.075], s: [0.04, 0.038, 0.042] },
    { g: SPH, c: belly, p: [0, 0.098, 0.108], s: [0.02, 0.017, 0.015] },
    { g: SPH_LO, c: '#2a1d18', p: [0, 0.103, 0.118], s: [0.006, 0.005, 0.004] },
    { g: SPH, c: coat, p: [-0.03, 0.03, -0.045], s: [0.024, 0.03, 0.04] },
    { g: SPH, c: coat, p: [0.03, 0.03, -0.045], s: [0.024, 0.03, 0.04] },
    { g: SPH, c: tint(coat, 0.9), p: [-0.022, 0.014, 0.05], s: [0.012, 0.03, 0.014] },
    { g: SPH, c: tint(coat, 0.9), p: [0.022, 0.014, 0.05], s: [0.012, 0.03, 0.014] },
  ]
  for (const sx of [-1, 1]) {
    body.push({ g: cone(0.012, 0.032, 6), c: coat, p: [sx * 0.022, 0.15, 0.066], r: [0, 0, -sx * 0.25] })
    body.push({ g: SPH_LO, c: '#15100e', p: [sx * 0.025, 0.118, 0.1], s: [0.008, 0.009, 0.006] })
    body.push({ g: SPH_LO, c: '#ffffff', p: [sx * 0.025 + 0.003, 0.122, 0.105], s: [0.0025, 0.0025, 0.002] })
  }
  const tail: Prim[] = [
    { g: SPH, c: coat, p: [0, 0.07, -0.03], r: [-0.5, 0, 0], s: [0.042, 0.08, 0.05] },
    { g: SPH, c: tint(coat, 1.1), p: [0, 0.15, -0.05], r: [0.3, 0, 0], s: [0.05, 0.075, 0.055] },
    { g: SPH, c: tint(coat, 1.18), p: [0, 0.2, -0.0], r: [1.0, 0, 0], s: [0.04, 0.05, 0.045] },
  ]
  squirrel = { body: bake(body), tail: bake(tail) }
  return squirrel
}

const butterflyCache = new Map<string, { body: THREE.BufferGeometry; wing: THREE.BufferGeometry }>()
/** Butterfly (~12 cm wingspan): thin body and antennae; wings separate (they flap). Color from the seed. */
export function butterflyParts(color: string) {
  let g = butterflyCache.get(color)
  if (g) return g
  const body: Prim[] = [
    { g: cap(0.006, 0.04), c: '#2a2430', p: [0, 0, 0], r: [Math.PI / 2, 0, 0] },
    { g: cyl(0.0012, 0.0012, 0.03, 4), c: '#2a2430', p: [-0.006, 0.012, 0.03], r: [0.7, 0, 0.3] },
    { g: cyl(0.0012, 0.0012, 0.03, 4), c: '#2a2430', p: [0.006, 0.012, 0.03], r: [0.7, 0, -0.3] },
  ]
  // left wing (+x); the right wing mirrors it: upper and lower wing, dark edge, white dot in the middle
  const wing: Prim[] = [
    { g: SPH, c: tint(color, 0.55), p: [0.032, 0, 0.012], r: [0, 0.4, 0], s: [0.034, 0.002, 0.026] },
    { g: SPH, c: color, p: [0.03, 0.001, 0.012], r: [0, 0.4, 0], s: [0.029, 0.002, 0.022] },
    { g: SPH, c: tint(color, 0.55), p: [0.022, 0, -0.018], r: [0, -0.5, 0], s: [0.022, 0.002, 0.017] },
    { g: SPH, c: mix(color, '#ffffff', 0.25), p: [0.021, 0.001, -0.017], r: [0, -0.5, 0], s: [0.018, 0.002, 0.013] },
    { g: SPH_LO, c: '#ffffff', p: [0.04, 0.003, 0.018], s: [0.005, 0.001, 0.005] },
  ]
  g = { body: bake(body), wing: bake(wing) }
  butterflyCache.set(color, g)
  return g
}
