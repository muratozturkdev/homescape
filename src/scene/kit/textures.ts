import * as THREE from 'three'
import type { FloorMaterial } from '@/model/types'
import { C } from './palette'

/* All textures are drawn on a 2D canvas at runtime; no files are loaded. */

const cache = new Map<string, THREE.CanvasTexture>()

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!] as const
}

function base(key: string, draw: (g: CanvasRenderingContext2D, size: number) => void, size = 256) {
  let t = cache.get(key)
  if (!t) {
    const [c, g] = canvas(size)
    draw(g, size)
    t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    cache.set(key, t)
  }
  return t
}

/**
 * Floor texture; returns a copy with its repeat set for the room size. flow: traffic direction of a road (from the road
 * pieces it connects to, computed by RoomMesh); without it the road runs along the long side of the area.
 */
export function floorTexture(kind: FloorMaterial, w: number, d: number, flow?: 'x' | 'z' | null) {
  // Road, crosswalk and parking markings follow the area's orientation (below, markedFloor)
  if (kind === 'road' || kind === 'crosswalk' || kind === 'parking') return markedFloor(kind, w, d, flow ?? null)
  const src = base(`floor-${kind}`, (g, s) => {
    if (kind === 'wood') {
      g.fillStyle = C.woodFloor
      g.fillRect(0, 0, s, s)
      g.strokeStyle = C.woodLine
      g.lineWidth = 2
      for (let i = 0; i < 8; i++) {
        const y = i * 32
        g.beginPath()
        g.moveTo(0, y + 1)
        g.lineTo(s, y + 1)
        g.stroke()
        const seam = ((i * 97) % s) + 0.5
        g.beginPath()
        g.moveTo(seam, y)
        g.lineTo(seam, y + 32)
        g.stroke()
      }
    } else if (kind === 'tile') {
      g.fillStyle = C.tile
      g.fillRect(0, 0, s, s)
      g.strokeStyle = C.tileLine
      g.lineWidth = 4
      for (let i = 0; i <= 2; i++) {
        g.beginPath()
        g.moveTo(0, i * (s / 2))
        g.lineTo(s, i * (s / 2))
        g.moveTo(i * (s / 2), 0)
        g.lineTo(i * (s / 2), s)
        g.stroke()
      }
    } else if (kind === 'carpet') {
      g.fillStyle = C.carpet
      g.fillRect(0, 0, s, s)
      const img = g.getImageData(0, 0, s, s)
      for (let i = 0; i < img.data.length; i += 4) {
        const n = ((i * 2654435761) % 255) / 255 - 0.5
        img.data[i] += n * 10
        img.data[i + 1] += n * 10
        img.data[i + 2] += n * 10
      }
      g.putImageData(img, 0, 0)
    } else if (kind === 'grass') {
      // Grass: green ground, short light and dark blade strokes
      g.fillStyle = '#93c46f'
      g.fillRect(0, 0, s, s)
      let seed = 3
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
      g.lineWidth = 1.4
      for (let i = 0; i < 1400; i++) {
        const x = rnd() * s
        const y = rnd() * s
        g.strokeStyle = rnd() > 0.5 ? 'rgba(70, 130, 50, 0.45)' : 'rgba(190, 230, 140, 0.4)'
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + (rnd() - 0.5) * 3, y - 3 - rnd() * 4)
        g.stroke()
      }
    } else if (kind === 'deck') {
      // Wooden deck: wide dark boards with gaps between them
      g.fillStyle = '#b98a5c'
      g.fillRect(0, 0, s, s)
      for (let i = 0; i < 4; i++) {
        const y = i * (s / 4)
        g.fillStyle = i % 2 ? '#c49668' : '#b48558'
        g.fillRect(0, y + 3, s, s / 4 - 6)
        g.fillStyle = 'rgba(60, 35, 15, 0.55)'
        g.fillRect(0, y, s, 3)
      }
    } else if (kind === 'paving') {
      // Paving: staggered rows of square stones, light joints
      g.fillStyle = '#c9c4ba'
      g.fillRect(0, 0, s, s)
      const n = 4
      const t = s / n
      for (let r = 0; r < n; r++)
        for (let c = -1; c < n; c++) {
          const x = c * t + (r % 2 ? t / 2 : 0)
          g.fillStyle = (r * 7 + c * 3) % 3 === 0 ? '#d8d4cb' : (r + c) % 2 ? '#d1ccc2' : '#dcd8d0'
          g.fillRect(x + 3, r * t + 3, t - 6, t - 6)
        }
    } else if (kind === 'sidewalk') {
      // Sidewalk: 40 cm light gray square tiles, dark joints, slight tone change from tile to tile
      g.fillStyle = '#b4b8c5'
      g.fillRect(0, 0, s, s)
      const n = 4
      const t = s / n
      const tones = ['#dcdee6', '#d3d6df', '#e2e4ea', '#d7d9e1']
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          g.fillStyle = tones[(r * 3 + c * 5 + ((r * c) % 3)) % tones.length]
          g.fillRect(c * t + 2, r * t + 2, t - 4, t - 4)
        }
      speckle(g, s, 5, 900, 'rgba(90, 96, 120, 0.08)', 'rgba(255, 255, 255, 0.18)')
    } else if (kind === 'gravel') {
      // Gravel: warm beige ground, small overlapping round stones (stones crossing an edge continue on the opposite side)
      g.fillStyle = '#cdc3b1'
      g.fillRect(0, 0, s, s)
      let seed = 21
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
      const stones = ['#e9e3d7', '#d9d0bf', '#c2b8a5', '#f3efe7', '#b5aa96', '#dcd6cc']
      for (let i = 0; i < 1500; i++) {
        const x = rnd() * s
        const y = rnd() * s
        const rx = 1.6 + rnd() * 2.8
        const ry = rx * (0.6 + rnd() * 0.35)
        const a = rnd() * Math.PI
        const col = stones[Math.floor(rnd() * stones.length)]
        for (const ox of [-s, 0, s])
          for (const oy of [-s, 0, s]) {
            if (x + ox < -6 || x + ox > s + 6 || y + oy < -6 || y + oy > s + 6) continue
            g.fillStyle = 'rgba(80, 66, 46, 0.22)'
            g.beginPath()
            g.ellipse(x + ox + 0.6, y + oy + 0.9, rx, ry, a, 0, Math.PI * 2)
            g.fill()
            g.fillStyle = col
            g.beginPath()
            g.ellipse(x + ox, y + oy, rx, ry, a, 0, Math.PI * 2)
            g.fill()
          }
      }
    } else if (kind === 'water') {
      // Water (pond): wavy bands from deep to light blue and light wave crests; integer frequencies tile seamlessly
      const img = g.createImageData(s, s)
      const deep = [61, 143, 214]
      const light = [124, 196, 238]
      const P2 = Math.PI * 2
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const u = x / s
          const v = y / s
          const w1 = Math.sin(P2 * (2 * v + 0.18 * Math.sin(P2 * (3 * u + 0.4 * Math.sin(P2 * v)))))
          const w2 = Math.sin(P2 * (3 * u + 2 * v + 0.25 * Math.sin(P2 * 2 * v)))
          const t = 0.5 + 0.32 * w1 + 0.18 * w2
          const crest = Math.max(0, w1 * 0.6 + w2 * 0.4 - 0.72) * 2.2
          const i = (y * s + x) * 4
          for (let k = 0; k < 3; k++) img.data[i + k] = Math.min(255, Math.round(deep[k] + (light[k] - deep[k]) * t + (255 - light[k]) * crest))
          img.data[i + 3] = 255
        }
      g.putImageData(img, 0, 0)
    } else {
      g.fillStyle = C.concrete
      g.fillRect(0, 0, s, s)
      g.strokeStyle = '#d8d9e2'
      g.lineWidth = 3
      g.strokeRect(1.5, 1.5, s - 3, s - 3)
    }
  })
  const scale = kind === 'tile' ? 1.2 : kind === 'wood' ? 1.6 : kind === 'grass' ? 2.5 : kind === 'deck' ? 1.4 : kind === 'sidewalk' ? 1.6 : kind === 'gravel' ? 1.4 : kind === 'water' ? 3 : 2
  const t = src.clone()
  t.needsUpdate = true
  t.repeat.set(w / scale, d / scale)
  return t
}

/** Seeded fine grain (sidewalk, asphalt): n dots of 1-2 px, half dark and half light. */
function speckle(g: CanvasRenderingContext2D, s: number, seed: number, n: number, dark: string, light: string, h = s) {
  let k = seed
  const rnd = () => (k = (k * 9301 + 49297) % 233280) / 233280
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() > 0.5 ? dark : light
    g.fillRect(Math.floor(rnd() * s), Math.floor(rnd() * h), 1 + Math.round(rnd()), 1 + Math.round(rnd()))
  }
}

/*
 * Outdoor floors. Road, crosswalk and parking markings follow the area's orientation: a road runs in the direction where
 * it connects to another road piece or a crosswalk (a short piece in between is drawn the right way too), otherwise along
 * its long side; crosswalk stripes run parallel to traffic and line up in the crossing direction. The texture repeats
 * along the flow (one period: dash + gap, crosswalk stripe + asphalt, parking bay) and covers the other side (the road
 * width) once. So the texture is drawn per width (in 25 cm steps); markings keep the same thickness at every width. If the
 * area is turned (depth larger than width) the same drawing is rotated by 90°.
 */

/** Asphalt and road marking colors: soft dark gray blue that suits the pastel scene, off-white paint. */
const ASPHALT = '#6d7286'
const MARK = '#f2f3f8'
/** Pixels per meter in marked floor textures. */
const MPX = 64

type MarkKind = 'road' | 'crosswalk' | 'parking'
/** Period (m): road 1.5 m dash + 1.5 m gap, crosswalk 50 cm stripe + 50 cm asphalt, parking 2.5 m bay. */
const PERIOD: Record<MarkKind, number> = { road: 3, crosswalk: 1, parking: 2.5 }

/**
 * Draws the markings laid out lengthwise: x along (P px = one period), y across (A px = area width, across m).
 * Edge lines 30 cm inside; a narrow single lane road (2.5-4.5 m) gets only edge lines, two lanes (4.5-9 m) a dashed center
 * line, four lanes (9 m and up) a double solid center line plus dashed lines between lanes. Roads under 2.5 m are plain asphalt.
 */
function drawMarks(kind: MarkKind, g: CanvasRenderingContext2D, P: number, A: number, across: number) {
  g.fillStyle = kind === 'parking' ? '#757a8d' : ASPHALT
  g.fillRect(0, 0, P, A)
  speckle(g, P, kind.length * 13, Math.round((P * A) / 70), 'rgba(24, 28, 44, 0.12)', 'rgba(255, 255, 255, 0.08)', A)
  g.fillStyle = MARK
  const m = (x: number) => x * MPX
  if (kind === 'road') {
    const lw = m(0.12)
    if (across >= 2.5)
      for (const y of [m(0.3), A - m(0.3) - lw]) g.fillRect(0, y, P, lw)
    if (across >= 9) {
      g.fillRect(0, A / 2 - lw * 1.3, P, lw)
      g.fillRect(0, A / 2 + lw * 0.3, P, lw)
      for (const y of [A / 4, (3 * A) / 4]) g.fillRect(0, y - lw / 2, P / 2, lw)
    } else if (across >= 4.5) g.fillRect(0, A / 2 - lw / 2, P / 2, lw)
  } else if (kind === 'crosswalk') {
    // Crosswalk: 50 cm stripes across the full width (parallel to traffic), 20 cm asphalt at the ends
    const edge = Math.min(m(0.2), A * 0.1)
    g.fillRect(0, edge, P / 2, A - 2 * edge)
  } else {
    // Parking: a line along the back edge, a 5 m deep bay line every 2.5 m; two rows when wider than 10.5 m
    const lw = m(0.1)
    const two = across >= 10.5
    const depth = two ? 5 : Math.max(1, Math.min(5, across - 0.5))
    g.fillRect(0, m(0.12), P, lw)
    g.fillRect(0, 0, lw / 2, m(0.12 + depth))
    g.fillRect(P - lw / 2, 0, lw / 2, m(0.12 + depth))
    if (two) {
      g.fillRect(0, A - m(0.12) - lw, P, lw)
      g.fillRect(0, A - m(0.12 + depth), lw / 2, m(0.12 + depth))
      g.fillRect(P - lw / 2, A - m(0.12 + depth), lw / 2, m(0.12 + depth))
    }
  }
}

const markCache = new Map<string, THREE.CanvasTexture>()
/** Road, crosswalk and parking texture: a centered copy that repeats along the flow (or long side) and covers the width once. */
function markedFloor(kind: MarkKind, w: number, d: number, flow: 'x' | 'z' | null) {
  // Axis the pattern repeats along: traffic direction for a road, crossing direction for a crosswalk (across traffic); long side if unknown
  const alongX = flow && kind !== 'parking' ? (kind === 'road') === (flow === 'x') : w >= d
  const across = Math.max(0.5, Math.round((alongX ? d : w) * 4) / 4)
  const len = alongX ? w : d
  const period = PERIOD[kind]
  const A = Math.min(1024, Math.round(across * MPX))
  const P = Math.round(period * MPX)
  const key = `${kind}-${across}-${alongX ? 'x' : 'z'}`
  let src = markCache.get(key)
  if (!src) {
    const c = document.createElement('canvas')
    c.width = alongX ? P : A
    c.height = alongX ? A : P
    const g = c.getContext('2d')!
    // With the long side on z the lengthwise axis is the canvas vertical: the drawing turns 90° (x' -> down, y' -> left)
    if (!alongX) {
      g.translate(A, 0)
      g.rotate(Math.PI / 2)
    }
    drawMarks(kind, g, P, A, across)
    src = new THREE.CanvasTexture(c)
    src.colorSpace = THREE.SRGBColorSpace
    src.wrapS = src.wrapT = THREE.RepeatWrapping
    src.anisotropy = 8
    markCache.set(key, src)
  }
  const t = src.clone()
  t.needsUpdate = true
  // Pattern symmetric about the area center: the middle of a stripe/bay or of a gap sits in the center
  const off = (((kind === 'parking' ? 0.5 : 0.25) - len / (2 * period)) % 1 + 1) % 1
  if (alongX) {
    t.repeat.set(len / period, 1)
    t.offset.set(off, 0)
  } else {
    t.repeat.set(1, len / period)
    t.offset.set(0, off)
  }
  return t
}

/**
 * Glint sliding over pond water: light wave crests (white, alpha only), integer frequencies: seamless.
 * RoomMesh slides it slowly over the water.
 */
export function waterGlintTexture() {
  const t = dataTexture('water-glint', 128, (u, v) => {
    const P2 = Math.PI * 2
    const a = Math.sin(P2 * (3 * u + 0.35 * Math.sin(P2 * (2 * v + 0.2 * Math.sin(P2 * u)))))
    const b = Math.sin(P2 * (2 * v - u + 0.3 * Math.sin(P2 * 3 * u)))
    const c = Math.exp(-((a / 0.14) ** 2)) * 0.55 + Math.exp(-((b / 0.12) ** 2)) * 0.4
    return [1, 1, 1, Math.min(1, c) * 0.5]
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/*
 * Light textures (halo, TV backlight, strip band, surface wash) are NOT drawn with canvas gradients: Chrome adds random
 * dithering to gradients against banding, and a magnified texture then shows dotted noise on screen. Instead every pixel
 * is written straight from a smooth function (DataTexture; white, alpha only). u: left to right, v: bottom to top (0-1).
 */
const dataCache = new Map<string, THREE.DataTexture>()
/** Every pixel is written directly from f(u, v) => [r, g, b, a] (0-1); colors in sRGB. */
function dataTexture(key: string, size: number, f: (u: number, v: number) => [number, number, number, number]) {
  let t = dataCache.get(key)
  if (t) return t
  const data = new Uint8Array(size * size * 4)
  const byte = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = f((x + 0.5) / size, (y + 0.5) / size)
      const i = (y * size + x) * 4
      for (let k = 0; k < 4; k++) data[i + k] = byte(px[k])
    }
  }
  t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  dataCache.set(key, t)
  return t
}
/** White texture with alpha only. */
const alphaTexture = (key: string, size: number, f: (u: number, v: number) => number) => dataTexture(key, size, (u, v) => [1, 1, 1, f(u, v)])

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** Soft ends: the left and right 12% fade to transparent (so strip ends do not look cut off). */
const ends = (u: number) => smooth(0, 0.12, u) * smooth(0, 0.12, 1 - u)

/** Soft radial texture for light glow: bright center, fading smoothly toward the edge. */
export function glowTexture() {
  return alphaTexture('glow', 128, (u, v) => {
    const r = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2)
    return Math.pow(1 - r, 2.2) * (0.55 + 0.45 * Math.exp(-r * r * 18))
  })
}

/** Soft rectangular halo: solid center (TV panel sized), fading toward the edges. For the TV backlight. */
export function softRectTexture() {
  return alphaTexture('soft-rect', 256, (u, v) => {
    const dx = Math.max(0.21 - u, 0, u - 0.79)
    const dy = Math.max(0.25 - v, 0, v - 0.75)
    const d = Math.hypot(dx, dy)
    return 0.95 * Math.exp(-((d / 0.075) ** 2))
  })
}

/** Strip light band: bright center, bell curve falloff to both sides; soft ends. LED strip glow. */
export function lineGlowTexture() {
  return alphaTexture('line-glow', 128, (u, v) => {
    const d = Math.abs(v - 0.5) * 2
    return Math.exp(-((d * 3) ** 2)) * ends(u)
  })
}

/** Closed ring band (around a cylinder): bright center, fading to the top and bottom edges; no end fade so there is no seam around it. */
export function bandGlowTexture() {
  return alphaTexture('band-glow', 64, (_u, v) => Math.exp(-(((v - 0.5) * 2 * 2.6) ** 2)))
}

/** Light on a surface: bright at the top edge (at the strip), exponential falloff with distance; soft ends. */
export function washTexture() {
  return alphaTexture('wash', 128, (u, v) => {
    const t = 1 - v
    return Math.exp(-4.2 * t) * (1 - t) ** 1.5 * ends(u)
  })
}

/**
 * Colored wave on the HomePod's top touch surface (Siri / while playing music). Three colored lobes in a circle twist
 * with the radius into a spiral and fade softly toward the edge. variant 0: purple, blue, pink; 1: cyan, green, purple
 * (two layers spin in opposite directions, making colors that pass through each other).
 */
const SIRI: [number, number, number][][] = [
  [
    [0.62, 0.3, 1],
    [0.18, 0.45, 1],
    [1, 0.3, 0.75],
  ],
  [
    [0.2, 0.85, 1],
    [0.3, 1, 0.6],
    [0.75, 0.35, 1],
  ],
]
export function siriTexture(variant: 0 | 1) {
  return dataTexture(`siri-${variant}`, 128, (u, v) => {
    const x = u * 2 - 1
    const y = v * 2 - 1
    const r = Math.hypot(x, y)
    if (r >= 1) return [0, 0, 0, 0]
    const ang = Math.atan2(y, x) + r * (variant ? -2.6 : 2.2)
    let cr = 0
    let cg = 0
    let cb = 0
    let w = 0
    SIRI[variant].forEach((c, k) => {
      const d = Math.cos(ang - (k * 2 * Math.PI) / 3)
      const lobe = Math.pow(Math.max(0, d), 2.4)
      cr += c[0] * lobe
      cg += c[1] * lobe
      cb += c[2] * lobe
      w += lobe
    })
    const n = Math.max(w, 1e-3)
    // Light center (near white), colored ring zone, fading edge.
    const core = Math.exp(-((r / 0.35) ** 2)) * 0.55
    const ring = Math.exp(-(((r - 0.55) / 0.3) ** 2))
    const a = Math.min(1, w * 0.9 * ring + core) * smooth(1, 0.82, r)
    return [cr / n + core, cg / n + core, cb / n + core, a]
  })
}

/**
 * Wood grain (diffuser body): wavy warm dark grain on a white ground; multiplied by the material color (light or dark
 * wood). Integer wave count: no seam on the lathed body (u runs around it). Seeded, the same every time.
 */
export function woodGrainTexture() {
  return base(
    'wood-grain',
    (g, s) => {
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, s, s)
      let seed = 7
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
      for (let i = 0; i < 46; i++) {
        const y0 = rnd() * s
        const amp = 3 + rnd() * 12
        const freq = 1 + Math.floor(rnd() * 3)
        const ph = rnd() * Math.PI * 2
        g.strokeStyle = `rgba(70, 38, 14, ${0.07 + rnd() * 0.2})`
        g.lineWidth = 0.8 + rnd() * 2.4
        g.beginPath()
        for (let x = 0; x <= s; x += 4) {
          const y = y0 + Math.sin((x / s) * Math.PI * 2 * freq + ph) * amp
          if (x === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
    },
    512,
  )
}

/** SKÅDIS style pegboard: vertical slots (staggered). White ground, color comes from the material. */
export function pegboardTexture() {
  return base('pegboard', (g, s) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#c9cde0'
    const cols = 8
    const rows = 6
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = ((c + (r % 2 ? 0.5 : 0.25)) / cols) * s
        const y = ((r + 0.5) / rows) * s
        g.beginPath()
        g.roundRect(x - 3, y - 11, 6, 22, 3)
        g.fill()
      }
  })
}

/** Painting: pastel abstract composition (in the project's colors). */
export function artTexture() {
  return base('art', (g, s) => {
    g.fillStyle = '#f4efe6'
    g.fillRect(0, 0, s, s)
    g.fillStyle = C.brandPale
    g.fillRect(0, s * 0.62, s, s * 0.38)
    g.fillStyle = C.coral
    g.beginPath()
    g.arc(s * 0.32, s * 0.4, s * 0.17, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = C.brand
    g.beginPath()
    g.arc(s * 0.7, s * 0.62, s * 0.24, Math.PI, 0)
    g.fill()
    g.fillStyle = C.sun
    g.fillRect(s * 0.56, s * 0.18, s * 0.08, s * 0.32)
    g.strokeStyle = C.ink
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(s * 0.12, s * 0.8)
    g.bezierCurveTo(s * 0.35, s * 0.7, s * 0.5, s * 0.92, s * 0.88, s * 0.78)
    g.stroke()
  })
}

/** Keyboard keys: top view, light keys on a dark base. */
export function keyboardTexture() {
  return base(
    'keyboard',
    (g, s) => {
      g.fillStyle = '#2a2e40'
      g.fillRect(0, 0, s, s)
      g.fillStyle = '#e9ebf5'
      const rows = 5
      for (let r = 0; r < rows; r++) {
        const n = r === 4 ? 1 : 13
        const y = 6 + r * ((s - 12) / rows)
        const h = (s - 12) / rows - 6
        if (r === 4) {
          g.fillRect(s * 0.28, y, s * 0.44, h)
          continue
        }
        for (let c = 0; c < n; c++) g.fillRect(6 + c * ((s - 12) / n), y, (s - 12) / n - 5, h)
      }
    },
    256,
  )
}

/* ---------- rug ---------- */

const rugCache = new Map<string, THREE.CanvasTexture>()
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
/** Moves a color toward white (to 255) or black (to 0) by k. */
const tone = (hex: string, to: number, k: number, a = 1) => {
  const [r, g, b] = rgbOf(hex)
  return `rgba(${Math.round(r + (to - r) * k)}, ${Math.round(g + (to - g) * k)}, ${Math.round(b + (to - b) * k)}, ${a})`
}
const paleOf = (hex: string) => {
  const [r, g, b] = rgbOf(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

/** Irregular soft-edged spot (cowhide): the corners of a jagged polygon joined by curves. */
function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rnd: () => number) {
  const n = 11
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const k = 0.62 + rnd() * 0.6
    return [x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k] as const
  })
  g.beginPath()
  const mid = (i: number) => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2] as const
  g.moveTo(...mid(0))
  for (let i = 1; i <= n; i++) g.quadraticCurveTo(pts[i % n][0], pts[i % n][1], ...mid(i))
  g.fill()
}

/**
 * Rug texture (kit/furniture.tsx > Rug). Drawn at the rug's aspect ratio (long side 512 px): border, spots and stripes
 * keep the same thickness in every direction. The pattern is measured in meters (px/m); the color is the ground on a plain
 * rug, the spots on cowhide, the stripes on zebra, the fleece on sheepskin.
 */
export function rugTexture(shape: string, color: string, w: number, d: number) {
  const long = 512
  const short = Math.max(64, Math.round((long * Math.min(w, d)) / Math.max(w, d) / 32) * 32)
  const W = w >= d ? long : short
  const H = w >= d ? short : long
  const key = `${shape}-${color}-${W}x${H}`
  let t = rugCache.get(key)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const m = W / Math.max(0.1, w)
  let seed = 11
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
  const pale = paleOf(color)
  if (shape === 'rect' || shape === 'round') {
    // Ground, weave rows, border and inner line (narrower on a small rug)
    const k = Math.min(1, Math.min(w, d) / 1.4)
    g.fillStyle = color
    g.fillRect(0, 0, W, H)
    for (let y = 0; y < H; y += 3) {
      g.fillStyle = pale ? `rgba(0, 0, 0, ${y % 6 ? 0.02 : 0.045})` : `rgba(255, 255, 255, ${y % 6 ? 0.02 : 0.04})`
      g.fillRect(0, y, W, 1.5)
    }
    const band = tone(color, pale ? 0 : 255, pale ? 0.2 : 0.28)
    const line = tone(color, pale ? 0 : 255, pale ? 0.13 : 0.2)
    const ring = (inset: number, lw: number, style: string) => {
      g.lineWidth = lw * m
      g.strokeStyle = style
      const i = (inset + lw / 2) * m
      if (shape === 'rect') g.strokeRect(i, i, W - 2 * i, H - 2 * i)
      else {
        g.beginPath()
        g.ellipse(W / 2, H / 2, Math.max(1, W / 2 - i), Math.max(1, H / 2 - i), 0, 0, Math.PI * 2)
        g.stroke()
      }
    }
    ring(0.07 * k, 0.08 * k, band)
    ring(0.24 * k, 0.015 * k, line)
    if (shape === 'round') {
      g.fillStyle = tone(color, pale ? 0 : 255, pale ? 0.1 : 0.15)
      g.beginPath()
      g.ellipse(W / 2, H / 2, W * 0.14, H * 0.14, 0, 0, Math.PI * 2)
      g.fill()
    }
  } else if (shape === 'cowhide') {
    // Cream hide, fine hair marks, large irregular spots
    g.fillStyle = '#f1e9db'
    g.fillRect(0, 0, W, H)
    g.fillStyle = 'rgba(120, 90, 60, 0.06)'
    for (let i = 0; i < 900; i++) g.fillRect(rnd() * W, rnd() * H, 1, 3 + rnd() * 4)
    g.fillStyle = color
    for (let i = 0; i < 10; i++) {
      const r = (0.08 + rnd() * 0.18) * m
      blob(g, rnd() * W, rnd() * H, r * (0.8 + rnd() * 0.6), r, rnd)
    }
  } else if (shape === 'zebra') {
    // Cream ground; wavy stripes running down both sides from the spine, a spine line in the middle
    g.fillStyle = '#f3efe6'
    g.fillRect(0, 0, W, H)
    g.fillStyle = color
    const gap = 0.12 * m
    for (let y0 = gap * 0.3; y0 < H + gap; y0 += gap) {
      const th = gap * (0.38 + rnd() * 0.18)
      const ph = rnd() * Math.PI * 2
      const at = (x: number) => y0 + Math.sin((x / W) * Math.PI * 3 + ph) * gap * 0.25 + ((x / W - 0.5) ** 2) * gap * 2.2
      g.beginPath()
      for (let x = 0; x <= W; x += 6) g.lineTo(x, at(x) - th / 2)
      for (let x = W; x >= 0; x -= 6) g.lineTo(x, at(x) + th / 2 * (0.6 + 0.4 * Math.abs(Math.sin(x / 40 + ph))))
      g.closePath()
      g.fill()
    }
    g.fillRect(W / 2 - 0.018 * m, 0, 0.036 * m, H)
  } else {
    // Sheepskin: fleece color, slight darkening toward the edge, curly fleece rings
    g.fillStyle = color
    g.fillRect(0, 0, W, H)
    const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.55)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grad.addColorStop(1, 'rgba(60, 45, 30, 0.22)')
    g.fillStyle = grad
    g.fillRect(0, 0, W, H)
    g.lineWidth = 1.4
    for (let i = 0; i < 1600; i++) {
      g.strokeStyle = rnd() > 0.5 ? tone(color, 255, 0.45, 0.4) : tone(color, 0, 0.18, 0.35)
      const r = 2 + rnd() * 4
      const a = rnd() * Math.PI * 2
      g.beginPath()
      g.arc(rnd() * W, rnd() * H, r, a, a + Math.PI * (1 + rnd()))
      g.stroke()
    }
  }
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  rugCache.set(key, t)
  return t
}
