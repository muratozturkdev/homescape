import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/*
 * Character model, stylized like game characters: large head and eyes, distinctive hair (bun with bandana, ponytail, spiky,
 * tousled). Modern everyday clothes: knit sweater, hoodie, printed tee, open shirt over a tee; jeans, chinos; sneakers. Built
 * in code so it can be animated (image based characters cannot move). Each bone segment (head, chest, upper arm, thigh...)
 * merges colored primitives into one geometry (vertex colors, one material): about 20 draw calls per person.
 * Stylized proportions (short legs, large head: about 5.5 heads tall); the sitting math fits real furniture (humanAnim.ts):
 * hip joint 0.82 m, thigh 0.37, shin 0.37, sole 0.075; shoulder 1.19, head joint 1.33, top ~1.66 m. Local +z forward,
 * x < 0 is the person's right (n, negative), x > 0 their left (p, positive).
 */

export type HairStyle = 'bun' | 'ponytail' | 'spiky' | 'tousled'

/** Leg dimensions (m): hip joint height above the ground, thigh, shin (knee to ankle), sole (ankle to ground) */
export const LEG = { hip: 0.82, thigh: 0.37, shin: 0.37, sole: 0.075 }

/** Top: tee (short sleeves), knit sweater (long sleeves, ribbed), hoodie (hood, drawstrings, kangaroo pocket) */
export type TopStyle = 'tee' | 'sweater' | 'hoodie'

export interface Look {
  skin: string
  hair: string
  hairStyle: HairStyle
  /** Bandana, hair tie, tee print, shoe stripe */
  accent: string
  /** Top color and style */
  top: string
  topStyle: TopStyle
  /** Optional open shirt over the tee (sleeves rolled up) */
  overshirt?: string
  /** Pants: jeans (cuffed hems) or chinos */
  pants: string
  jeans: boolean
  /** Sneakers: upper and sole */
  shoes: string
  sole: string
  eyes: string
  blanket: string
  /** Shoulder and body width factor */
  build: number
}

/** The household: four people in casual modern clothes (slightly cool colors). */
export const LOOKS: Look[] = [
  { skin: '#f0c6a6', hair: '#6a4430', hairStyle: 'bun', accent: '#5b8fab', top: '#d9b04f', topStyle: 'sweater', pants: '#7f9dc4', jeans: true, shoes: '#f3f2ee', sole: '#e3ddd0', eyes: '#4a3526', blanket: '#d6e2f2', build: 0.92 },
  { skin: '#ddb08e', hair: '#4b3326', hairStyle: 'ponytail', accent: '#7c70a8', top: '#4f7c99', topStyle: 'hoodie', pants: '#2d3039', jeans: false, shoes: '#f5f5f5', sole: '#cfd2da', eyes: '#3b2b20', blanket: '#e6dcef', build: 0.94 },
  { skin: '#f1ccb0', hair: '#c0642f', hairStyle: 'spiky', accent: '#e3b04a', top: '#2f4566', topStyle: 'tee', pants: '#c6b08a', jeans: false, shoes: '#6b4a35', sole: '#efe8da', eyes: '#41603a', blanket: '#d5e5ee', build: 1.06 },
  { skin: '#b98262', hair: '#3a281d', hairStyle: 'tousled', accent: '#d65f4a', top: '#efeae0', topStyle: 'tee', overshirt: '#687a3e', pants: '#3d5068', jeans: true, shoes: '#2d2f36', sole: '#f0f0f0', eyes: '#2f2219', blanket: '#e5edd8', build: 1 },
]

/* ---------- merging ---------- */

type V3 = [number, number, number]
interface Prim {
  g: THREE.BufferGeometry
  c: string | THREE.Color
  p?: V3
  /** Euler (radians, XYZ) */
  r?: V3
  /** Orientation (instead of Euler) */
  q?: THREE.Quaternion
  s?: V3
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** Places primitives by position, rotation and scale and merges them with their colors into one geometry. */
function bake(prims: Prim[]): THREE.BufferGeometry {
  const parts = prims.map(({ g, c, p = [0, 0, 0], r = [0, 0, 0], q, s = [1, 1, 1] }) => {
    // The rounded box is non-indexed and the other primitives are indexed: make all non-indexed so they can merge
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

const SPH = new THREE.SphereGeometry(1, 24, 16)
const SPH_LO = new THREE.SphereGeometry(1, 14, 10)
const cyl = (rt: number, rb: number, h: number, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg)
const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 14)
const torus = (r: number, tube: number, arc = Math.PI * 2, seg = 32) => new THREE.TorusGeometry(r, tube, 8, seg, arc)
const rbox = (w: number, h: number, d: number, rad: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2, h / 2, d / 2))
const cone = (r: number, h: number, seg = 14) => new THREE.ConeGeometry(r, h, seg)
/** Hair cap: sphere slice from the top down to thetaLength */
const HAIR_CAP = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.54)

const tint = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k)
const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t)
const UP = new THREE.Vector3(0, 1, 0)
/** Rotation turning +y toward dir */
const toward = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())

/* ---------- head: face and hair ---------- */

/** Skull and jaw ellipsoids (from the head joint; face toward +z) */
const SKULL = { c: [0, 0.14, 0] as V3, r: [0.128, 0.14, 0.13] as V3 }
const JAW = { c: [0, 0.075, 0.025] as V3, r: [0.112, 0.085, 0.11] as V3 }

/** Front surface (z) of the face at (x, y): the front one of the two ellipsoids */
function surf(x: number, y: number) {
  const one = (e: { c: V3; r: V3 }) => {
    const k = 1 - ((x - e.c[0]) / e.r[0]) ** 2 - ((y - e.c[1]) / e.r[1]) ** 2
    return k > 0 ? e.c[2] + e.r[2] * Math.sqrt(k) : -1
  }
  return Math.max(one(SKULL), one(JAW))
}

/** Eye position (from the head joint) */
export const EYE = { x: 0.05, y: 0.12 }
export const eyeZ = () => surf(EYE.x, EYE.y) - 0.006

function face(look: Look): Prim[] {
  const skin = look.skin
  const out: Prim[] = [
    { g: SPH, c: skin, p: SKULL.c, s: SKULL.r },
    { g: SPH, c: skin, p: JAW.c, s: JAW.r },
    // nose and ears
    { g: SPH, c: mix(skin, '#c97b6e', 0.18), p: [0, 0.088, surf(0, 0.088) + 0.002], s: [0.018, 0.016, 0.017] },
  ]
  for (const sx of [-1, 1]) {
    out.push({ g: SPH, c: skin, p: [sx * 0.126, 0.122, -0.002], s: [0.022, 0.036, 0.03] })
    out.push({ g: SPH, c: mix(skin, '#c97b6e', 0.25), p: [sx * 0.132, 0.122, 0.002], s: [0.01, 0.022, 0.018] })
    // eye: white, iris, pupil, highlight, upper lash line
    const ex = sx * EYE.x
    const z = eyeZ()
    out.push({ g: SPH, c: '#fbfaf7', p: [ex, EYE.y, z], s: [0.034, 0.04, 0.017] })
    out.push({ g: SPH, c: look.eyes, p: [ex + sx * 0.002, EYE.y - 0.003, z + 0.009], s: [0.024, 0.028, 0.01] })
    out.push({ g: SPH_LO, c: '#15100e', p: [ex + sx * 0.002, EYE.y - 0.003, z + 0.014], s: [0.013, 0.015, 0.0065] })
    out.push({ g: SPH_LO, c: '#ffffff', p: [ex + sx * 0.002 + 0.008, EYE.y + 0.01, z + 0.018], s: [0.0068, 0.0068, 0.0035] })
    out.push({ g: cap(0.005, 0.048), c: '#2a1c16', p: [ex, EYE.y + 0.035, z + 0.008], r: [0.25, 0, Math.PI / 2 + sx * 0.12] })
    // brow
    out.push({ g: cap(0.008, 0.038), c: tint(look.hair, 0.75), p: [sx * 0.052, 0.182, surf(sx * 0.052, 0.182) + 0.003], r: [0.15, 0, Math.PI / 2 - sx * 0.14] })
    // cheek blush
    out.push({ g: SPH_LO, c: mix(skin, '#ee8a82', 0.42), p: [sx * 0.074, 0.074, surf(sx * 0.074, 0.074) - 0.002], s: [0.024, 0.015, 0.006] })
  }
  // smiling mouth: lower arc
  out.push({ g: torus(0.02, 0.0042, Math.PI * 0.7, 14), c: '#8a3f3a', p: [0, 0.066, surf(0, 0.05) - 0.001], r: [0, 0, -0.85 * Math.PI] })
  return out
}

/** Bandana or hair band: a ring on the forehead tilted toward the back */
const band = (look: Look): Prim => ({ g: torus(1, 0.11, Math.PI * 2, 44), c: look.accent, p: [0, 0.178, -0.012], r: [Math.PI / 2 - 0.52, 0, 0], s: [0.137, 0.142, 0.137] })

/** Shared hair cap: crown and nape, hairline on the forehead (leaves the face open) */
const hairCap = (look: Look, k = 1): Prim => ({ g: HAIR_CAP, c: look.hair, p: [0, 0.142, -0.006], r: [-0.62, 0, 0], s: [0.137 * k, 0.15 * k, 0.142 * k] })

/** Point and outward direction on the skull surface (theta from the top, phi clockwise from the front, in degrees) */
function onSkull(theta: number, phi: number, out = 1.0) {
  const t = (theta * Math.PI) / 180
  const f = (phi * Math.PI) / 180
  const dir = new THREE.Vector3(Math.sin(t) * Math.sin(f), Math.cos(t), Math.sin(t) * Math.cos(f))
  const pos = new THREE.Vector3(SKULL.c[0] + dir.x * SKULL.r[0] * out, SKULL.c[1] + dir.y * SKULL.r[1] * out, SKULL.c[2] + dir.z * SKULL.r[2] * out)
  return { pos, dir }
}

function hair(look: Look): Prim[] {
  const h = look.hair
  const lighter = tint(h, 1.18)
  const out: Prim[] = [hairCap(look)]
  // fringe: tufts combed to the side
  const bangs = (list: [number, number, number, number][]) => {
    for (const [x, y, rz, w] of list) out.push({ g: SPH, c: h, p: [x, y, surf(x, y) - 0.01], r: [0.35, 0, rz], s: [w, 0.032, 0.04] })
  }
  if (look.hairStyle === 'bun') {
    bangs([
      [-0.058, 0.222, 0.55, 0.062],
      [0.0, 0.236, -0.15, 0.056],
      [0.062, 0.218, -0.6, 0.052],
    ])
    for (const sx of [-1, 1]) out.push({ g: cap(0.019, 0.07), c: h, p: [sx * 0.118, 0.1, 0.045], r: [0.1, 0, sx * 0.12] })
    // bun: high at the back, puffy; band at its base
    out.push({ g: SPH, c: h, p: [0, 0.3, -0.07], s: [0.078, 0.072, 0.078] })
    out.push({ g: SPH_LO, c: lighter, p: [0.03, 0.33, -0.05], s: [0.04, 0.03, 0.04] })
    out.push({ g: SPH_LO, c: lighter, p: [-0.032, 0.318, -0.1], s: [0.035, 0.03, 0.035] })
    out.push({ g: torus(0.058, 0.014), c: look.accent, p: [0, 0.248, -0.062], r: [Math.PI / 2 - 0.55, 0, 0] })
    out.push(band(look))
    // bandana knot and ends at the side
    out.push({ g: SPH_LO, c: look.accent, p: [0.118, 0.22, 0.05], s: [0.018, 0.018, 0.018] })
    out.push({ g: SPH, c: look.accent, p: [0.13, 0.245, 0.07], r: [0, 0.5, 0.7], s: [0.038, 0.02, 0.01] })
    out.push({ g: SPH, c: look.accent, p: [0.135, 0.2, 0.075], r: [0, 0.5, -0.5], s: [0.034, 0.019, 0.01] })
  } else if (look.hairStyle === 'ponytail') {
    bangs([
      [-0.05, 0.228, 0.35, 0.07],
      [0.045, 0.226, -0.45, 0.064],
    ])
    for (const sx of [-1, 1]) out.push({ g: cap(0.02, 0.09), c: h, p: [sx * 0.12, 0.092, 0.04], r: [0.12, 0, sx * 0.1] })
    out.push(band(look))
  } else if (look.hairStyle === 'spiky') {
    // spiky: tips sticking out and slightly up and back on the crown, sides and back; a fringe rising off the forehead
    const spikes: [number, number, number][] = [
      [58, -28, 0.11],
      [52, 4, 0.12],
      [60, 34, 0.1],
      [18, 0, 0.12],
      [24, 70, 0.11],
      [24, -70, 0.11],
      [30, 160, 0.12],
      [12, 120, 0.1],
      [12, -120, 0.1],
      [62, 82, 0.09],
      [62, -82, 0.09],
      [74, 112, 0.09],
      [74, -112, 0.09],
      [58, 150, 0.1],
      [58, -150, 0.1],
      [80, 178, 0.09],
      [42, 128, 0.11],
      [42, -128, 0.11],
    ]
    for (const [t, f, len] of spikes) {
      const { pos, dir } = onSkull(t, f, 0.96)
      const d = dir.clone().add(new THREE.Vector3(0, 0.45, f > -40 && f < 40 && t > 40 ? 0.15 : -0.3)).normalize()
      out.push({ g: cone(0.042, len), c: Math.abs(f) > 100 ? tint(h, 0.92) : h, p: [pos.x + d.x * len * 0.4, pos.y + d.y * len * 0.4, pos.z + d.z * len * 0.4], q: toward(d) })
    }
    out.push({ g: SPH, c: h, p: [0, 0.2, -0.02], s: [0.12, 0.09, 0.12] })
  } else {
    // tousled short wavy hair: tufts on top, a curly fringe falling on the forehead
    const tufts: [number, number][] = [
      [10, 0],
      [22, 60],
      [22, -60],
      [28, 150],
      [28, -150],
      [32, 0],
      [40, 100],
      [40, -100],
      [48, 30],
      [48, -40],
      [55, 160],
    ]
    tufts.forEach(([t, f], i) => {
      const { pos, dir } = onSkull(t, f, 1.02)
      out.push({ g: SPH, c: i % 3 === 0 ? lighter : h, p: [pos.x, pos.y, pos.z], q: toward(dir.clone().add(new THREE.Vector3(0, 0, -0.6))), s: [0.05, 0.075, 0.04] })
    })
    out.push({ g: SPH, c: h, p: [0.035, 0.236, 0.095], r: [-0.25, 0, -0.55], s: [0.08, 0.03, 0.045] })
    out.push({ g: SPH, c: lighter, p: [-0.04, 0.244, 0.08], r: [-0.2, 0, 0.5], s: [0.055, 0.026, 0.04] })
    for (const sx of [-1, 1]) out.push({ g: SPH, c: h, p: [sx * 0.122, 0.16, 0.0], s: [0.02, 0.05, 0.06] })
  }
  return out
}

/* ---------- parts ---------- */

export type PartName = 'pelvis' | 'thigh' | 'shin' | 'foot' | 'spine' | 'chest' | 'upperArm' | 'forearm' | 'hand' | 'neck' | 'head' | 'tail' | 'lid'

function build(look: Look): Record<PartName, THREE.BufferGeometry> {
  const b = look.build
  const top = look.top
  const rib = tint(top, 0.86)
  const T = LEG.thigh
  const S = LEG.shin
  const pantsDark = tint(look.pants, 0.82)
  const long = look.topStyle !== 'tee'
  const over = look.overshirt
  const pelvis: Prim[] = [
    // top of the pants (hips) and waistband
    { g: SPH, c: look.pants, p: [0, -0.03, -0.012], s: [0.14 * b, 0.095, 0.095] },
    { g: cyl(0.15, 0.15, 0.05, 26), c: pantsDark, p: [0, 0.035, 0], s: [b, 1, 0.8] },
    // the hem of the top falls over the waist (ribbed band on sweaters and hoodies)
    { g: cyl(0.16, 0.166, 0.075, 26), c: long ? rib : top, p: [0, 0.075, 0], s: [b, 1, 0.8] },
  ]
  if (look.jeans) {
    // front pockets and seam line of the jeans
    for (const sx of [-1, 1]) pelvis.push({ g: cap(0.004, 0.06), c: tint(look.pants, 1.18), p: [sx * 0.085 * b, 0.0, 0.1], r: [0.1, 0, sx * 0.7] })
  }
  if (over) {
    // tails of the open shirt: on both sides over the tee
    for (const sx of [-1, 1]) pelvis.push({ g: rbox(0.12, 0.09, 0.03, 0.01), c: over, p: [sx * 0.095 * b, 0.07, 0.115], r: [0, sx * -0.35, 0] })
  }
  // straight leg pants: thick at the hip, tapering toward the knee; round knee (so the joint does not show)
  const thigh: Prim[] = [
    { g: SPH, c: look.pants, p: [0, -0.01, 0], s: [0.09, 0.09, 0.09] },
    { g: cyl(0.09, 0.074, T - 0.02, 22), c: look.pants, p: [0, -T / 2, 0] },
    { g: SPH, c: look.pants, p: [0, -T + 0.005, 0.004], s: [0.074, 0.074, 0.076] },
  ]
  const shin: Prim[] = [
    { g: cyl(0.073, 0.068, S - 0.05, 22), c: look.pants, p: [0, -(S - 0.05) / 2, 0] },
    // hem: cuffed on jeans, plain on chinos; sock below
    look.jeans ? { g: cyl(0.074, 0.074, 0.035, 22), c: tint(look.pants, 1.15), p: [0, -S + 0.06, 0] } : { g: cyl(0.069, 0.069, 0.02, 22), c: pantsDark, p: [0, -S + 0.05, 0] },
    { g: cyl(0.048, 0.046, 0.05, 16), c: '#f1f0ec', p: [0, -S + 0.02, 0] },
  ]
  // sneaker: upper, thick sole, toe cap, lacing area, colored stripe on the side
  const foot: Prim[] = [
    { g: rbox(0.106, 0.075, 0.2, 0.035), c: look.shoes, p: [0, -0.03, 0.04] },
    { g: SPH, c: look.shoes, p: [0, -0.045, 0.13], s: [0.053, 0.04, 0.06] },
    { g: rbox(0.114, 0.03, 0.25, 0.012), c: look.sole, p: [0, -0.062, 0.05] },
    { g: rbox(0.06, 0.012, 0.09, 0.005), c: tint(look.shoes, 0.8), p: [0, 0.005, 0.07], r: [-0.25, 0, 0] },
    { g: rbox(0.112, 0.016, 0.1, 0.006), c: look.accent, p: [0, -0.035, 0.03], r: [0, 0, 0], s: [1, 1, 1] },
  ]
  const spine: Prim[] = [{ g: SPH, c: top, p: [0, 0.08, 0], s: [0.155 * b, 0.13, 0.12] }]
  const chest: Prim[] = [
    { g: SPH, c: top, p: [0, 0.06, 0], s: [0.18 * b, 0.17, 0.13] },
    // shoulders
    { g: SPH, c: top, p: [-0.158 * b, 0.122, 0], s: [0.064, 0.058, 0.064] },
    { g: SPH, c: top, p: [0.158 * b, 0.122, 0], s: [0.064, 0.058, 0.064] },
    // crew neck (thick rib on the sweater)
    { g: torus(0.066, look.topStyle === 'sweater' ? 0.02 : 0.013, Math.PI * 2, 22), c: look.topStyle === 'tee' ? tint(top, 0.9) : rib, p: [0, 0.192, 0.006], r: [Math.PI / 2 - 0.25, 0, 0] },
  ]
  if (look.topStyle === 'tee' && !over) {
    // tee print
    chest.push({ g: rbox(0.09, 0.06, 0.01, 0.012), c: look.accent, p: [0, 0.07, 0.127], r: [-0.12, 0, 0] })
    chest.push({ g: rbox(0.05, 0.012, 0.012, 0.004), c: '#f4efe4', p: [0, 0.07, 0.132], r: [-0.12, 0, 0] })
  }
  if (look.topStyle === 'sweater') {
    // knit texture: horizontal knit bands on the chest
    for (const y of [0.0, 0.05, 0.1]) chest.push({ g: torus(0.1, 0.006, Math.PI * 0.7, 18), c: rib, p: [0, y, 0.084], r: [Math.PI / 2 - 0.1, 0, Math.PI * 1.15], s: [1.45 * b, 1.18, 1] })
  }
  if (look.topStyle === 'hoodie') {
    // hood bunched at the nape, two drawstrings in front, kangaroo pocket on the belly
    chest.push({ g: SPH, c: rib, p: [0, 0.2, -0.085], s: [0.13 * b, 0.075, 0.08] })
    chest.push({ g: torus(0.075, 0.03, Math.PI * 2, 22), c: rib, p: [0, 0.2, -0.005], r: [Math.PI / 2 - 0.25, 0, 0] })
    for (const sx of [-1, 1]) chest.push({ g: cap(0.005, 0.1), c: '#f3f3f3', p: [sx * 0.03, 0.115, 0.126], r: [0.15, 0, 0] })
    spine.push({ g: rbox(0.2 * b, 0.1, 0.03, 0.02), c: rib, p: [0, 0.04, 0.105], r: [0.05, 0, 0] })
  }
  if (over) {
    // open shirt: a shell over the tee, open at the front (the tee shows), collar points and buttons
    chest.push({ g: SPH, c: over, p: [0, 0.055, -0.004], s: [0.19 * b, 0.172, 0.134] })
    chest.push({ g: rbox(0.1, 0.27, 0.03, 0.014), c: top, p: [0, 0.06, 0.118], r: [-0.08, 0, 0] })
    for (const sx of [-1, 1]) {
      chest.push({ g: rbox(0.06, 0.05, 0.012, 0.006), c: tint(over, 1.1), p: [sx * 0.06, 0.175, 0.105], r: [-0.5, sx * 0.4, sx * 0.5] })
      for (const y of [0.13, 0.06, -0.01]) chest.push({ g: SPH_LO, c: '#e8e2d2', p: [sx * 0.055, y, 0.13 - Math.abs(y - 0.06) * 0.1], s: [0.007, 0.007, 0.004] })
    }
    spine.push({ g: SPH, c: over, p: [0, 0.075, -0.004], s: [0.163 * b, 0.13, 0.124] })
    spine.push({ g: rbox(0.11, 0.17, 0.03, 0.014), c: top, p: [0, 0.08, 0.108] })
  }
  const sleeve = over ?? top
  const upperArm: Prim[] = [{ g: SPH, c: sleeve, p: [0, 0, 0], s: [0.066, 0.066, 0.066] }]
  if (over || long) {
    // long sleeve (rolled up to the elbow on the shirt)
    upperArm.push({ g: cyl(0.066, 0.06, 0.24), c: sleeve, p: [0, -0.12, 0] })
    upperArm.push({ g: SPH, c: sleeve, p: [0, -0.262, 0], s: [0.058, 0.058, 0.058] })
    if (over) upperArm.push({ g: torus(0.058, 0.02, Math.PI * 2, 22), c: tint(over, 1.12), p: [0, -0.235, 0], r: [Math.PI / 2, 0, 0] })
  } else {
    // tee: short sleeve, skin below
    upperArm.push({ g: cyl(0.068, 0.064, 0.13), c: top, p: [0, -0.065, 0] })
    upperArm.push({ g: torus(0.063, 0.008, Math.PI * 2, 22), c: tint(top, 0.85), p: [0, -0.128, 0], r: [Math.PI / 2, 0, 0] })
    upperArm.push({ g: cap(0.046, 0.12), c: look.skin, p: [0, -0.19, 0] })
    upperArm.push({ g: SPH, c: look.skin, p: [0, -0.262, 0], s: [0.045, 0.045, 0.045] })
  }
  // forearm: fabric with a ribbed cuff on sweaters and hoodies, skin with a rolled shirt or a tee
  const forearm: Prim[] = long && !over
    ? [
        { g: cap(0.05, 0.14), c: top, p: [0, -0.1, 0] },
        { g: cyl(0.047, 0.047, 0.04, 18), c: rib, p: [0, -0.205, 0] },
      ]
    : [{ g: cap(0.043, 0.15), c: look.skin, p: [0, -0.11, 0] }]
  // fist (right hand; the left hand mirrors it): thumb forward and inward
  const hand: Prim[] = [
    { g: SPH, c: look.skin, p: [0, -0.05, 0.004], s: [0.044, 0.053, 0.048] },
    { g: cap(0.016, 0.03), c: look.skin, p: [0.022, -0.038, 0.034], r: [-0.5, 0, -0.35] },
    { g: SPH_LO, c: tint(look.skin, 0.96), p: [0, -0.068, 0.03], s: [0.038, 0.022, 0.02] },
  ]
  const neck: Prim[] = [{ g: cap(0.048, 0.05), c: look.skin, p: [0, 0.03, 0] }]
  const head: Prim[] = [...face(look), ...hair(look)]
  // ponytail: on its own joint at the back of the head (swings when walking)
  const tail: Prim[] =
    look.hairStyle === 'ponytail'
      ? [
          { g: torus(0.026, 0.012, Math.PI * 2, 16), c: look.accent, p: [0, -0.005, -0.012], r: [0.5, 0, 0] },
          { g: SPH, c: look.hair, p: [0, -0.035, -0.045], s: [0.052, 0.062, 0.055] },
          { g: SPH, c: look.hair, p: [0, -0.1, -0.062], s: [0.047, 0.07, 0.046] },
          { g: SPH, c: tint(look.hair, 1.12), p: [0, -0.17, -0.05], s: [0.034, 0.062, 0.034] },
          { g: SPH_LO, c: look.hair, p: [0, -0.225, -0.034], s: [0.02, 0.03, 0.02] },
        ]
      : []
  // eyelid (visible when blinking): a skin colored half ellipsoid covering the eye
  const lid: Prim[] = [{ g: SPH, c: tint(look.skin, 0.93), p: [0, 0, 0.004], s: [0.033, 0.037, 0.019] }]
  return {
    pelvis: bake(pelvis),
    thigh: bake(thigh),
    shin: bake(shin),
    foot: bake(foot),
    spine: bake(spine),
    chest: bake(chest),
    upperArm: bake(upperArm),
    forearm: bake(forearm),
    hand: bake(hand),
    neck: bake(neck),
    head: bake(head),
    tail: tail.length ? bake(tail) : new THREE.BufferGeometry(),
    lid: bake(lid),
  }
}

const cache = new Map<Look, Record<PartName, THREE.BufferGeometry>>()
/** Part geometries of a person (built once per look). */
export function humanParts(look: Look) {
  let g = cache.get(look)
  if (!g) cache.set(look, (g = build(look)))
  return g
}

/** Shared material of the characters: vertex colors, soft matte surface (room lights light it too). */
export const humanMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 })

/* ---------- held props ---------- */

export type PropName = 'phone' | 'book' | 'knife' | 'brush' | 'mug' | 'bowl' | 'glass'

let props: Record<PropName, THREE.BufferGeometry> | null = null
/** Hand props (from the right wrist; inside the fist): phone, open book, knife, toothbrush, mug, snack bowl, glass of water. */
export function propParts() {
  if (props) return props
  props = {
    phone: bake([
      { g: rbox(0.072, 0.145, 0.01, 0.007), c: '#1f2430', p: [0, 0, 0] },
      { g: rbox(0.062, 0.128, 0.002, 0.005), c: '#8fb6e8', p: [0, 0.002, 0.0055] },
    ]),
    book: bake([
      // two covers open in a V, pages between them
      { g: rbox(0.13, 0.18, 0.008, 0.003), c: '#9a3f3f', p: [-0.064, 0, -0.012], r: [0, 0.32, 0] },
      { g: rbox(0.13, 0.18, 0.008, 0.003), c: '#9a3f3f', p: [0.064, 0, -0.012], r: [0, -0.32, 0] },
      { g: rbox(0.122, 0.17, 0.014, 0.003), c: '#f4efe2', p: [-0.06, 0, -0.004], r: [0, 0.32, 0] },
      { g: rbox(0.122, 0.17, 0.014, 0.003), c: '#f4efe2', p: [0.06, 0, -0.004], r: [0, -0.32, 0] },
    ]),
    knife: bake([
      { g: rbox(0.022, 0.1, 0.022, 0.006), c: '#3a2a20', p: [0, 0, 0] },
      { g: rbox(0.03, 0.13, 0.004, 0.002), c: '#cfd3dc', p: [0, -0.11, 0.004] },
    ]),
    brush: bake([
      { g: cyl(0.006, 0.006, 0.16, 8), c: '#5aa7d8', p: [0, 0, 0] },
      { g: rbox(0.012, 0.028, 0.016, 0.003), c: '#f4f4f4', p: [0, 0.088, 0.008] },
    ]),
    mug: bake([
      { g: cyl(0.04, 0.036, 0.09, 18), c: '#e9e4da', p: [0, 0, 0] },
      { g: torus(0.025, 0.007, Math.PI * 2, 14), c: '#e9e4da', p: [0.045, 0, 0], r: [0, 0, 0] },
      { g: cyl(0.034, 0.034, 0.004, 18), c: '#5a3a28', p: [0, 0.041, 0] },
    ]),
    // Popcorn bowl: shallow, red striped, kernels on top
    bowl: bake([
      { g: cyl(0.085, 0.055, 0.06, 20), c: '#d9473f', p: [0, 0, 0] },
      { g: cyl(0.087, 0.087, 0.012, 20), c: '#f4efe6', p: [0, 0.026, 0] },
      ...Array.from({ length: 9 }, (_, i) => ({ g: SPH_LO, c: i % 3 ? '#fbf3d6' : '#f2dc8f', p: [Math.cos(i * 2.4) * 0.045 * (i % 2 ? 1 : 0.5), 0.04, Math.sin(i * 2.4) * 0.045 * (i % 2 ? 1 : 0.5)] as [number, number, number], s: [0.022, 0.018, 0.022] as [number, number, number] })),
    ]),
    // Glass: translucent blue, water inside
    glass: bake([
      { g: cyl(0.033, 0.028, 0.11, 18), c: '#cfe3f2', p: [0, 0, 0] },
      { g: cyl(0.03, 0.026, 0.07, 18), c: '#8fc4ea', p: [0, -0.016, 0] },
    ]),
  }
  return props
}
