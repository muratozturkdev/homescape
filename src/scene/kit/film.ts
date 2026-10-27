import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { t } from '@/i18n'
import { useAmbient } from './effects'

/*
 * Film playing on a TV. No video file: each TV draws a small canvas (384x216) at 24 frames per second and uses it as the
 * screen texture. Letterboxed (2.39:1), five scenes of 8 seconds each with fades in between, a slow camera push in, film
 * grain and a vignette:
 * 1. Sea at sunset: setting sun, reflection on the water, a drifting sailboat, flapping gulls;
 * 2. City at night: stars, moon, layered buildings with flickering windows, headlights and tail lights on the road;
 * 3. Mountain trail at dawn: layered mountains, fog, pines passing by, a hiker with a backpack (the camera follows them);
 * 4. Evening dialogue: two people facing each other in a warmly lit room, speakers take turns, subtitles;
 * 5. Desert road: low sun, distant cliffs, road lines streaming past, a car kicking up dust.
 * When paused (media player "paused") the picture freezes with a pause sign in the middle and a progress bar below. Each
 * TV starts the film at a different point (item position). No frames are requested in lite mode (the picture stops).
 */

const W = 384
const H = 216
/** Letterbox bar (2.39:1) */
const BAR = Math.round((H - W / 2.39) / 2)
const CH = H - 2 * BAR
const SCENE_S = 8
const FADE_S = 0.35
const FPS = 24

type Ctx = CanvasRenderingContext2D

const rnd = (i: number, s: number) => {
  const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453
  return v - Math.floor(v)
}
const TAU = Math.PI * 2

function vgrad(c: Ctx, y0: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(0, y0, 0, y1)
  for (const [k, col] of stops) g.addColorStop(k, col)
  return g
}

function glow(c: Ctx, x: number, y: number, r: number, inner: string, outer: string) {
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  c.fillStyle = g
  c.fillRect(x - r, y - r, r * 2, r * 2)
}

/* ---------- 1. sea at sunset ---------- */
function sunset(c: Ctx, u: number, T: number) {
  const hz = CH * 0.56
  c.fillStyle = vgrad(c, 0, hz, [
    [0, '#231c49'],
    [0.45, '#7b396a'],
    [0.8, '#ea7d47'],
    [1, '#ffc27a'],
  ])
  c.fillRect(0, 0, W, hz)
  // the sun sinks toward the horizon (stays behind the sea)
  const sx = W * 0.64
  const sy = hz - 9 + u * 1.5
  glow(c, sx, sy, 70, 'rgba(255,214,150,0.85)', 'rgba(255,140,80,0)')
  c.fillStyle = '#fff3d4'
  c.beginPath()
  c.arc(sx, sy, 13, 0, TAU)
  c.fill()
  // cloud streaks
  c.fillStyle = 'rgba(120,50,90,0.45)'
  for (let i = 0; i < 4; i++) {
    const y = hz * (0.28 + i * 0.13)
    const x = ((i * 97 + u * (3 + i)) % (W + 160)) - 80
    c.fillRect(x, y, 90 + i * 25, 2.2)
  }
  // sea
  c.fillStyle = vgrad(c, hz, CH, [
    [0, '#7a3d5c'],
    [1, '#141229'],
  ])
  c.fillRect(0, hz, W, CH - hz)
  // reflection: short shimmering lines below the sun
  for (let i = 0; i < 28; i++) {
    const k = i / 28
    const y = hz + 1.5 + k * (CH - hz)
    const wid = (10 + 46 * k) * (0.55 + 0.45 * Math.sin(T * 2.3 + i * 1.7))
    c.fillStyle = `rgba(255,${Math.round(205 - 60 * k)},130,${(0.62 * (1 - k) + 0.08).toFixed(2)})`
    c.fillRect(sx - wid / 2 + Math.sin(T * 1.7 + i) * 3, y, wid, 1.3)
  }
  // wave lines
  c.fillStyle = 'rgba(255,255,255,0.05)'
  for (let i = 0; i < 18; i++) {
    const y = hz + 4 + rnd(i, 4) * (CH - hz - 6)
    const x = ((rnd(i, 5) * W + T * (6 + y * 0.05)) % (W + 40)) - 20
    c.fillRect(x, y, 14 + rnd(i, 6) * 20, 1)
  }
  // sailboat
  const bx = W * (0.1 + u * 0.035)
  const by = hz + 20 + Math.sin(T * 1.3) * 0.8
  c.fillStyle = '#0f0b1f'
  c.beginPath()
  c.moveTo(bx - 17, by)
  c.lineTo(bx + 17, by)
  c.lineTo(bx + 12, by + 5)
  c.lineTo(bx - 13, by + 5)
  c.closePath()
  c.fill()
  c.fillRect(bx - 1, by - 32, 1.6, 32)
  c.beginPath()
  c.moveTo(bx + 1.5, by - 31)
  c.lineTo(bx + 16, by - 2)
  c.lineTo(bx + 1.5, by - 2)
  c.closePath()
  c.fill()
  c.beginPath()
  c.moveTo(bx - 1.5, by - 27)
  c.lineTo(bx - 14, by - 2)
  c.lineTo(bx - 1.5, by - 2)
  c.closePath()
  c.fill()
  // gulls
  c.strokeStyle = '#1b1430'
  c.lineWidth = 1.3
  c.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const x = ((u * 16 + i * 41 + 20) % (W + 40)) - 20
    const y = hz * (0.3 + 0.12 * i) + Math.sin(T * 0.9 + i) * 3
    const f = Math.sin(T * 7 + i * 2) * 3
    c.beginPath()
    c.moveTo(x - 6, y - f)
    c.quadraticCurveTo(x - 2.5, y - 2, x, y)
    c.quadraticCurveTo(x + 2.5, y - 2, x + 6, y - f)
    c.stroke()
  }
}

/* ---------- 2. city at night ---------- */
function city(c: Ctx, u: number, T: number) {
  const road = CH * 0.8
  c.fillStyle = vgrad(c, 0, road, [
    [0, '#03050e'],
    [1, '#1d2856'],
  ])
  c.fillRect(0, 0, W, road)
  for (let i = 0; i < 55; i++) {
    const a = 0.3 + 0.7 * Math.abs(Math.sin(T * 1.3 + i * 2.1))
    c.fillStyle = `rgba(255,255,240,${(a * 0.8).toFixed(2)})`
    c.fillRect(rnd(i, 1) * W, rnd(i, 2) * road * 0.55, 1, 1)
  }
  glow(c, W * 0.82, CH * 0.17, 26, 'rgba(240,236,214,0.35)', 'rgba(240,236,214,0)')
  c.fillStyle = '#efe9d2'
  c.beginPath()
  c.arc(W * 0.82, CH * 0.17, 8, 0, TAU)
  c.fill()
  // buildings: far and near layer (the near one scrolls faster)
  for (const [layer, speed, col, hMin, hMax] of [
    [0, 2, '#141a37', 0.25, 0.5],
    [1, 6, '#090c1f', 0.32, 0.72],
  ] as const) {
    let x = -((u * speed) % 400)
    let i = 0
    while (x < W + 10) {
      const bw = 22 + rnd(i, 10 + layer) * 30
      const bh = road * (hMin + rnd(i, 20 + layer) * (hMax - hMin))
      const top = road - bh
      c.fillStyle = col
      c.fillRect(x, top, bw - 2, bh)
      // windows
      for (let wy = top + 5; wy < road - 6; wy += 6)
        for (let wx = x + 3; wx < x + bw - 6; wx += 5) {
          const k = Math.floor(wx * 7 + wy * 13)
          const lit = rnd(k, 3 + layer) > 0.6
          const flick = rnd(k, 7) > 0.96 && Math.sin(T * 2 + k) > 0
          if (!lit || flick) continue
          c.fillStyle = layer ? 'rgba(255,210,120,0.85)' : 'rgba(255,214,140,0.45)'
          c.fillRect(wx, wy, 2.2, 2.6)
        }
      x += bw
      i++
    }
  }
  // road, lane line, car lights
  c.fillStyle = '#0a0c15'
  c.fillRect(0, road, W, CH - road)
  c.fillStyle = 'rgba(255,255,255,0.25)'
  for (let k = 0; k < 10; k++) c.fillRect(((k * 46 - u * 30) % (W + 46)) + (k * 46 - u * 30 < 0 ? W + 46 : 0) - 23, road + (CH - road) * 0.5, 18, 1)
  for (let i = 0; i < 5; i++) {
    const right = i % 2 === 0
    const sp = 70 + rnd(i, 30) * 50
    const span = W + 80
    let x = ((T * sp + rnd(i, 31) * span) % span) - 40
    if (!right) x = W - x
    const y = road + (CH - road) * (right ? 0.75 : 0.28)
    if (right) {
      glow(c, x + 6, y, 12, 'rgba(255,250,225,0.8)', 'rgba(255,250,225,0)')
      c.fillStyle = '#fffbe8'
      c.fillRect(x + 4, y - 1, 3, 2)
    } else {
      glow(c, x, y, 9, 'rgba(255,60,50,0.7)', 'rgba(255,60,50,0)')
      c.fillStyle = '#ff4a3a'
      c.fillRect(x - 1, y - 1, 3, 2)
    }
  }
}

/* ---------- 3. mountain trail at dawn ---------- */
function ridge(c: Ctx, base: number, amp: number, shift: number, seed: number, col: string) {
  c.fillStyle = col
  c.beginPath()
  c.moveTo(0, CH)
  for (let x = 0; x <= W; x += 6) {
    const s = (x + shift) * 0.012
    const y = base - amp * (0.55 * Math.sin(s + seed) + 0.3 * Math.sin(s * 2.3 + seed * 2) + 0.15 * Math.sin(s * 5.1 + seed * 3))
    c.lineTo(x, y)
  }
  c.lineTo(W, CH)
  c.closePath()
  c.fill()
}

function forest(c: Ctx, u: number, T: number) {
  const gy = CH * 0.86
  c.fillStyle = vgrad(c, 0, CH * 0.62, [
    [0, '#8fa9d4'],
    [0.7, '#e9c3a6'],
    [1, '#f7d2a8'],
  ])
  c.fillRect(0, 0, W, CH)
  glow(c, W * 0.72, CH * 0.44, 60, 'rgba(255,236,200,0.75)', 'rgba(255,220,180,0)')
  ridge(c, CH * 0.52, 20, u * 3, 1, '#9aa8c7')
  ridge(c, CH * 0.62, 18, u * 7 + 140, 4, '#7385a8')
  // fog
  c.fillStyle = vgrad(c, CH * 0.52, CH * 0.75, [
    [0, 'rgba(255,255,255,0)'],
    [0.5, 'rgba(255,245,235,0.4)'],
    [1, 'rgba(255,255,255,0)'],
  ])
  c.fillRect(0, CH * 0.52, W, CH * 0.23)
  ridge(c, CH * 0.74, 12, u * 13 + 300, 7, '#46567a')
  // ground and path
  c.fillStyle = '#25322a'
  c.fillRect(0, gy - 2, W, CH - gy + 2)
  c.fillStyle = '#5b5544'
  c.fillRect(0, gy + 2, W, 4)
  // pines (near; they scroll fast because the camera moves with the hiker)
  const step = 58
  const off = (u * 26) % step
  for (let k = -1; k < W / step + 2; k++) {
    const i = k + Math.floor((u * 26) / step)
    const x = k * step - off + rnd(i, 40) * 20
    const h = 46 + rnd(i, 41) * 34
    c.fillStyle = '#15201a'
    c.fillRect(x - 1.5, gy - h * 0.25, 3, h * 0.25 + 2)
    for (let t = 0; t < 4; t++) {
      const y0 = gy - h * 0.2 - t * h * 0.2
      const w = (h * 0.32) * (1 - t * 0.2)
      c.beginPath()
      c.moveTo(x - w, y0)
      c.lineTo(x + w, y0)
      c.lineTo(x, y0 - h * 0.34)
      c.closePath()
      c.fill()
    }
  }
  // hiker (with a backpack)
  const p = T * 5.2
  const x = W * 0.42
  const bob = Math.abs(Math.sin(p)) * 1.2
  const hip = gy - 15 - bob
  c.strokeStyle = '#0e1511'
  c.fillStyle = '#0e1511'
  c.lineCap = 'round'
  c.lineWidth = 3
  for (const s of [1, -1]) {
    const a = Math.sin(p) * 0.55 * s
    c.beginPath()
    c.moveTo(x, hip)
    c.lineTo(x + Math.sin(a) * 15, hip + Math.cos(a) * 15)
    c.stroke()
  }
  c.fillRect(x - 4, hip - 17, 8, 18)
  c.fillRect(x - 9, hip - 16, 6, 11)
  c.lineWidth = 2.2
  for (const s of [1, -1]) {
    const a = -Math.sin(p) * 0.6 * s
    c.beginPath()
    c.moveTo(x + 1, hip - 15)
    c.lineTo(x + 1 + Math.sin(a) * 12, hip - 15 + Math.cos(a) * 12)
    c.stroke()
  }
  c.beginPath()
  c.arc(x + 1, hip - 22, 4.2, 0, TAU)
  c.fill()
}

/* ---------- 4. evening dialogue ---------- */
/** Subtitles of the dialogue scene */
const LINES = [
  t('Why are you telling me this now?'),
  t('Because I have no time left.'),
  t('I have to leave before morning.'),
  t("Then I'm coming with you."),
  t('This time will be different, I promise.'),
  t('You always say that.'),
  t('Trust me, just this once.'),
  t('Fine. But this is the last time.'),
]

function person(c: Ctx, x: number, facing: 1 | -1, lit: boolean, T: number, talking: boolean) {
  const y = CH * 0.44 + (talking ? Math.sin(T * 9) * 0.7 : 0)
  c.fillStyle = lit ? '#1a1013' : '#120a0d'
  // shoulders
  c.beginPath()
  c.moveTo(x - 46, CH)
  c.quadraticCurveTo(x - 40, y + 34, x - 8, y + 26)
  c.lineTo(x + 8, y + 26)
  c.quadraticCurveTo(x + 40, y + 34, x + 46, CH)
  c.closePath()
  c.fill()
  // neck and head (nose on the side the face looks to)
  c.fillRect(x - 6, y + 10, 12, 18)
  c.beginPath()
  c.ellipse(x, y, 15, 19, 0, 0, TAU)
  c.fill()
  c.beginPath()
  c.moveTo(x + facing * 13, y - 2)
  c.lineTo(x + facing * 18, y + 5)
  c.lineTo(x + facing * 13, y + 8)
  c.closePath()
  c.fill()
  // rim light from the lamp between them
  c.strokeStyle = lit ? 'rgba(255,178,100,0.85)' : 'rgba(255,170,100,0.35)'
  c.lineWidth = 1.6
  c.beginPath()
  if (facing > 0) c.ellipse(x, y, 15, 19, 0, -1.2, 1.1)
  else c.ellipse(x, y, 15, 19, 0, Math.PI - 1.1, Math.PI + 1.2)
  c.stroke()
  c.beginPath()
  c.moveTo(x + facing * 10, y + 27)
  c.quadraticCurveTo(x + facing * 38, y + 34, x + facing * 44, CH)
  c.stroke()
}

function dialogue(c: Ctx, u: number, T: number, cycle: number) {
  const g = c.createRadialGradient(W * 0.5, CH * 0.35, 10, W * 0.5, CH * 0.5, W * 0.6)
  g.addColorStop(0, '#5a3220')
  g.addColorStop(1, '#140b0c')
  c.fillStyle = g
  c.fillRect(0, 0, W, CH)
  // blurry lights in the background
  for (let i = 0; i < 14; i++) {
    const x = rnd(i, 50) * W + Math.sin(T * 0.25 + i) * 4
    const y = rnd(i, 51) * CH * 0.75
    const r = 6 + rnd(i, 52) * 12
    const a = 0.12 + rnd(i, 53) * 0.2
    glow(c, x, y, r, `rgba(255,${Math.round(170 + rnd(i, 54) * 60)},110,${a.toFixed(2)})`, 'rgba(255,170,110,0)')
  }
  // table lamp between them
  glow(c, W * 0.5, CH * 0.62, 50, 'rgba(255,200,130,0.5)', 'rgba(255,170,100,0)')
  const beat = Math.floor(u / 2)
  const speaker = beat % 2
  person(c, W * 0.27, 1, speaker === 0, T, speaker === 0)
  person(c, W * 0.73, -1, speaker === 1, T, speaker === 1)
  // subtitle (squeezed to fit when a translation is long)
  const line = LINES[(cycle * 4 + beat) % LINES.length]
  if (u % 2 > 0.15 && u % 2 < 1.9) {
    c.font = '600 11px system-ui, -apple-system, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'alphabetic'
    c.lineJoin = 'round'
    c.lineWidth = 3
    c.strokeStyle = 'rgba(0,0,0,0.85)'
    c.strokeText(line, W / 2, CH - 9, W - 24)
    c.fillStyle = '#fbf6e8'
    c.fillText(line, W / 2, CH - 9, W - 24)
  }
}

/* ---------- 5. desert road ---------- */
function desert(c: Ctx, u: number, T: number) {
  const hz = CH * 0.48
  c.fillStyle = vgrad(c, 0, hz, [
    [0, '#3a2a5c'],
    [0.6, '#f27f48'],
    [1, '#ffd08a'],
  ])
  c.fillRect(0, 0, W, hz)
  // the sun sinks a little during the scene
  const sy = hz - 8 + u * 0.6
  glow(c, W * 0.5, sy, 64, 'rgba(255,236,190,0.8)', 'rgba(255,170,100,0)')
  c.fillStyle = '#fff0c8'
  c.beginPath()
  c.arc(W * 0.5, sy, 15, 0, TAU)
  c.fill()
  // distant cliffs
  c.fillStyle = '#6d3326'
  c.beginPath()
  c.moveTo(0, hz)
  c.lineTo(0, hz - 14)
  c.lineTo(36, hz - 15)
  c.lineTo(46, hz - 6)
  c.lineTo(110, hz - 7)
  c.lineTo(120, hz)
  c.moveTo(250, hz)
  c.lineTo(262, hz - 18)
  c.lineTo(318, hz - 19)
  c.lineTo(328, hz - 9)
  c.lineTo(W, hz - 10)
  c.lineTo(W, hz)
  c.closePath()
  c.fill()
  c.fillStyle = vgrad(c, hz, CH, [
    [0, '#c27c4b'],
    [1, '#5a3122'],
  ])
  c.fillRect(0, hz, W, CH - hz)
  // road (perspective)
  const vx = W / 2
  c.fillStyle = '#2b2226'
  c.beginPath()
  c.moveTo(vx - 3, hz)
  c.lineTo(vx + 3, hz)
  c.lineTo(vx + W * 0.62, CH)
  c.lineTo(vx - W * 0.62, CH)
  c.closePath()
  c.fill()
  // center line and roadside posts stream past
  for (let k = 0; k < 12; k++) {
    const s = (k / 12 + T * 0.55) % 1
    const q = s * s
    const y = hz + (CH - hz) * q
    c.fillStyle = 'rgba(255,236,190,0.9)'
    c.fillRect(vx - (0.5 + q * 2.5), y, 1 + q * 5, 1 + q * 10)
    const px = W * 0.7 * q
    c.fillStyle = '#3a2620'
    c.fillRect(vx - px - 6 * q - 1, y - 14 * q, 1 + q * 2, 14 * q)
    c.fillRect(vx + px + 6 * q, y - 14 * q, 1 + q * 2, 14 * q)
  }
  // car (from behind) and dust
  const cx = vx + Math.sin(T * 0.8) * 6
  const cy = CH - 30 + Math.sin(T * 7) * 0.6
  for (let i = 0; i < 14; i++) {
    const s = (i / 14 + T * 1.2) % 1
    const side = i % 2 ? 1 : -1
    c.fillStyle = `rgba(214,170,120,${(0.35 * (1 - s)).toFixed(2)})`
    c.beginPath()
    c.arc(cx + side * (22 + s * 30), cy + 16 - s * 10, 3 + s * 9, 0, TAU)
    c.fill()
  }
  c.fillStyle = '#16100f'
  c.beginPath()
  c.moveTo(cx - 32, cy + 16)
  c.lineTo(cx - 32, cy + 2)
  c.lineTo(cx - 20, cy - 10)
  c.lineTo(cx + 20, cy - 10)
  c.lineTo(cx + 32, cy + 2)
  c.lineTo(cx + 32, cy + 16)
  c.closePath()
  c.fill()
  c.fillRect(cx - 30, cy + 15, 10, 6)
  c.fillRect(cx + 20, cy + 15, 10, 6)
  glow(c, cx - 24, cy + 5, 9, 'rgba(255,60,40,0.8)', 'rgba(255,60,40,0)')
  glow(c, cx + 24, cy + 5, 9, 'rgba(255,60,40,0.8)', 'rgba(255,60,40,0)')
  c.fillStyle = '#ff4a36'
  c.fillRect(cx - 28, cy + 3, 8, 3)
  c.fillRect(cx + 20, cy + 3, 8, 3)
  c.fillStyle = 'rgba(120,150,190,0.35)'
  c.fillRect(cx - 17, cy - 8, 34, 7)
}

const SCENES: ((c: Ctx, u: number, T: number, cycle: number) => void)[] = [sunset, city, forest, dialogue, desert]

interface Film {
  canvas: HTMLCanvasElement
  ctx: Ctx
  tex: THREE.CanvasTexture
  material: THREE.MeshBasicMaterial
  grain: CanvasPattern | null
  vignette: CanvasGradient
  /** Last drawn moment (s, clock), time inside the film and its offset from the clock (resumes where it paused) */
  last: number
  t: number
  offset: number | null
  paused: boolean
}

function makeGrain(ctx: Ctx) {
  const n = document.createElement('canvas')
  n.width = n.height = 64
  const g = n.getContext('2d')
  if (!g) return null
  const img = g.createImageData(64, 64)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return ctx.createPattern(n, 'repeat')
}

function makeFilm(): Film | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  const material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)')
  return { canvas, ctx, tex, material, grain: makeGrain(ctx), vignette, last: -1, t: 0, offset: null, paused: false }
}

/** Frame of the film at time t; paused: pause sign and progress bar */
function draw(f: Film, t: number, paused: boolean) {
  const c = f.ctx
  const total = SCENE_S * SCENES.length
  const ft = ((t % total) + total) % total
  const idx = Math.floor(ft / SCENE_S)
  const u = ft - idx * SCENE_S
  const cycle = Math.floor(t / total)
  c.save()
  c.fillStyle = '#000'
  c.fillRect(0, 0, W, H)
  c.beginPath()
  c.rect(0, BAR, W, CH)
  c.clip()
  c.translate(0, BAR)
  // slow camera push in
  const z = 1 + 0.035 * (u / SCENE_S)
  c.translate(W / 2, CH / 2)
  c.scale(z, z)
  c.translate(-W / 2, -CH / 2)
  SCENES[idx](c, u, t, cycle)
  c.restore()
  // grain, vignette, fade between scenes
  c.save()
  c.beginPath()
  c.rect(0, BAR, W, CH)
  c.clip()
  if (f.grain) {
    c.globalAlpha = 0.07
    c.globalCompositeOperation = 'overlay'
    c.translate(Math.floor(rnd(Math.floor(t * FPS), 9) * 64), Math.floor(rnd(Math.floor(t * FPS), 8) * 64))
    c.fillStyle = f.grain
    c.fillRect(-64, -64, W + 128, H + 128)
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
  }
  c.fillStyle = f.vignette
  c.fillRect(0, BAR, W, CH)
  const fade = Math.min(1, u / FADE_S, (SCENE_S - u) / FADE_S)
  if (fade < 1) {
    c.fillStyle = `rgba(0,0,0,${(1 - fade).toFixed(3)})`
    c.fillRect(0, BAR, W, CH)
  }
  if (paused) {
    c.fillStyle = 'rgba(0,0,0,0.35)'
    c.fillRect(0, BAR, W, CH)
    c.fillStyle = 'rgba(255,255,255,0.92)'
    c.beginPath()
    c.roundRect(W / 2 - 13, H / 2 - 16, 9, 32, 3)
    c.roundRect(W / 2 + 4, H / 2 - 16, 9, 32, 3)
    c.fill()
    const y = H - BAR - 12
    c.fillStyle = 'rgba(255,255,255,0.3)'
    c.fillRect(W * 0.08, y, W * 0.84, 3)
    const k = ((t / 600) % 1) * 0.8 + 0.1
    c.fillStyle = '#ffffff'
    c.fillRect(W * 0.08, y, W * 0.84 * k, 3)
    c.beginPath()
    c.arc(W * 0.08 + W * 0.84 * k, y + 1.5, 5, 0, TAU)
    c.fill()
  }
  c.restore()
  f.tex.needsUpdate = true
}

/** One tick: draws 24 times per second while playing, once when paused (frame freezes), resumes where it left off */
function tick(film: Film, now: number, paused: boolean, seed: number) {
  if (film.offset == null) {
    film.offset = seed * 11
    film.t = now + film.offset
  }
  if (paused) {
    if (!film.paused) {
      draw(film, film.t, true)
      film.paused = true
    }
    return
  }
  if (film.paused) {
    film.offset = film.t - now
    film.paused = false
    film.last = -1
  }
  // The ambient rate is 24 fps too: some slack so timing jitter does not skip frames
  if (film.last >= 0 && now - film.last < 0.8 / FPS) return
  film.last = now
  film.t = now + film.offset
  draw(film, film.t, false)
}

/**
 * TV screen material: the film when on (24 fps while playing, frozen frame when paused), the given material when off.
 * seed (item position): TVs start at different points of the film.
 */
export function useFilm(on: boolean, paused: boolean, off: THREE.Material, seed = 0) {
  const film = useMemo(() => makeFilm(), [])
  useEffect(
    () => () => {
      film?.tex.dispose()
      film?.material.dispose()
    },
    [film],
  )
  useAmbient(on && !paused)
  useFrame(({ clock }) => {
    if (on && film) tick(film, clock.elapsedTime, paused, seed)
  })
  return on && film ? film.material : off
}
