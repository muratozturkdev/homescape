import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Line2 } from 'three-stdlib'
import { play } from '@/audio/engine'
import { stepAt } from '@/audio/floor'
import { domainOf } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { activeLevel, useLayout } from '@/model/layoutStore'
import type { Activity } from '@/model/people'
import type { Item, Level } from '@/model/types'
import { type StreetKinds, useView } from './camera'
import { markShadows } from './frame'
import { Human } from './Human'
import { animateHuman, type AnimState, type HumanRefs } from './humanAnim'
import type { Look } from './humanModel'
import { useAmbient } from './kit/effects'
import { Car } from './kit/outdoor'
import { rng } from './kit/primitives'
import { OFF_VISUAL, type Visual } from './kit/visual'
import { PetBody } from './PetBody'
import { animatePet, restState, type PetRefs } from './petAnim'
import { DOG_LOOKS, type PetLook } from './petModel'
import {
  AXLE,
  CAR_SPEED,
  carTrack,
  dirAt,
  gapOf,
  kidsOut,
  limitAhead,
  local,
  PLAY_CAP,
  playEntrance,
  posAt,
  sniffStops,
  streetDebug,
  streetNet,
  walkPath,
  walkTrack,
  type P,
  type PlayKind,
  type StreetNet,
  type Track,
} from './streetPlan'
import { useNight } from './useNight'

/*
 * Street life: cars pass on the roads now and then, people walk on the sidewalks, some walk a dog on a leash, kids play in
 * the playgrounds. Logic in scene/streetPlan.ts.
 * - Cars enter at one end of a road and leave at the other (right lane), slow down in bends, keep their distance to the
 *   car ahead, and stop to give way when a pedestrian is on (or waiting at) a crosswalk. At night the headlights are on
 *   and light the road ahead.
 * - Pedestrians walk on the sidewalk around items; before crossing at a crosswalk they wait while a car approaches.
 * - Dog walkers: a leashed dog beside its owner (the leash is a line sagging from the hand to the collar); it stops to
 *   sniff at trees, lamps and hydrants and barks now and then.
 * - Playground (slide, trampoline, sandbox, swing): by day and without rain 1-3 kids come: they climb the slide ladder and
 *   slide, bounce on the trampoline, sit and dig at a sandbox corner, sit on the swing; if a bench is nearby an adult sits
 *   and looks at their phone. They leave after a few minutes, or right away when night or rain starts.
 * Frequency by hour (sparse at night, very sparse after midnight). In view mode, not in light mode. Cars, pedestrians
 * (including dog walkers) and kids can be switched on and off separately (People panel, useView.street); a type that is
 * switched off leaves at once. Sounds in audio/SoundScape.tsx (streetDebug).
 */

const CAR_SLOTS = 2
const WALK_SLOTS = 3
const KID_SLOTS = 3
const KID_SCALE = 0.62
/** The dog walks this far ahead of its owner (m) */
const DOG_LEAD = 0.55
const DOG_STRIDE = 0.62
const STRIDE = 1.3

const CAR_VARIANTS = ['sedan', 'suv', 'hatch']
const CAR_COLORS = ['#c8323c', '#2f4566', '#e8e6df', '#3a3d46', '#4f7c99', '#d9b04f', '#687a3e', '#8a8f9c', '#1f2126']

/** Passers-by: eight adults dressed differently from the household */
const ADULTS: Look[] = [
  { skin: '#e8bc9a', hair: '#2b211c', hairStyle: 'tousled', accent: '#c94f3d', top: '#3d5a80', topStyle: 'hoodie', pants: '#2b2d35', jeans: false, shoes: '#e9e7e1', sole: '#d4d0c6', eyes: '#3a2a20', blanket: '#ddd', build: 1.04 },
  { skin: '#8d5a3b', hair: '#17110e', hairStyle: 'bun', accent: '#e0b44a', top: '#b5473f', topStyle: 'sweater', pants: '#30415c', jeans: true, shoes: '#2a2b30', sole: '#efefef', eyes: '#251a12', blanket: '#ddd', build: 0.92 },
  { skin: '#f3d2b8', hair: '#d9b26a', hairStyle: 'ponytail', accent: '#5aa087', top: '#e9e4d8', topStyle: 'tee', overshirt: '#7a8fa8', pants: '#5d6b4a', jeans: false, shoes: '#c9a27a', sole: '#f2ece0', eyes: '#3d5f7a', blanket: '#ddd', build: 0.95 },
  { skin: '#c99470', hair: '#4a4744', hairStyle: 'spiky', accent: '#3f7fbf', top: '#2e3a2f', topStyle: 'sweater', pants: '#8a7a62', jeans: false, shoes: '#3b2d24', sole: '#e8e2d6', eyes: '#2f2219', blanket: '#ddd', build: 1.08 },
  { skin: '#b07a55', hair: '#2a1d16', hairStyle: 'ponytail', accent: '#d6669a', top: '#6f4a8e', topStyle: 'hoodie', pants: '#22252c', jeans: false, shoes: '#f4f4f4', sole: '#dcdcdc', eyes: '#2b1e15', blanket: '#ddd', build: 0.93 },
  { skin: '#f0c6a6', hair: '#9a9590', hairStyle: 'tousled', accent: '#e6a23c', top: '#8c2f39', topStyle: 'tee', overshirt: '#3b4252', pants: '#6e7f99', jeans: true, shoes: '#5a4030', sole: '#efe7d8', eyes: '#47613f', blanket: '#ddd', build: 1.02 },
  { skin: '#6e4630', hair: '#120d0a', hairStyle: 'spiky', accent: '#f2c14e', top: '#f2c14e', topStyle: 'tee', pants: '#2f3c55', jeans: true, shoes: '#dfe3ea', sole: '#c8ccd4', eyes: '#1f150f', blanket: '#ddd', build: 1.05 },
  { skin: '#e6b896', hair: '#7a3f22', hairStyle: 'bun', accent: '#4c9a8a', top: '#4c9a8a', topStyle: 'sweater', pants: '#d7cdbb', jeans: false, shoes: '#704b36', sole: '#f1eadc', eyes: '#4a3526', blanket: '#ddd', build: 0.9 },
]
/** Kids in the playground (small scale) and the adult with them */
const KIDS: Look[] = [
  { skin: '#f1ccb0', hair: '#c0642f', hairStyle: 'ponytail', accent: '#f0a63a', top: '#e85d75', topStyle: 'tee', pants: '#4a6fa5', jeans: true, shoes: '#f4f4f4', sole: '#f06b4f', eyes: '#41603a', blanket: '#ddd', build: 0.86 },
  { skin: '#a8714f', hair: '#1c1410', hairStyle: 'spiky', accent: '#3fbf9b', top: '#3fbf9b', topStyle: 'hoodie', pants: '#2d3039', jeans: false, shoes: '#e94f37', sole: '#f2f2f2', eyes: '#2b1e15', blanket: '#ddd', build: 0.86 },
  { skin: '#e9c09f', hair: '#e3c07a', hairStyle: 'bun', accent: '#8f6cf0', top: '#f2d24b', topStyle: 'sweater', pants: '#7c5cbf', jeans: false, shoes: '#ffffff', sole: '#8f6cf0', eyes: '#3d5f7a', blanket: '#ddd', build: 0.86 },
]
const PARENT: Look = { skin: '#d9a985', hair: '#3a281d', hairStyle: 'ponytail', accent: '#5b8fab', top: '#55657a', topStyle: 'sweater', pants: '#2d3039', jeans: false, shoes: '#e9e7e1', sole: '#d4d0c6', eyes: '#3b2b20', blanket: '#ddd', build: 0.95 }
const DOGS = ['golden', 'labrador', 'terrier', 'dalmatian']

/** Car position and heading: midpoint of the front and rear axle positions on the route and the direction between them */
function carPose(t: Track, s: number) {
  const f = posAt(t, s + AXLE)
  const r = posAt(t, s - AXLE)
  return { p: { x: (f.x + r.x) / 2, z: (f.z + r.z) / 2 }, h: Math.atan2(f.x - r.x, f.z - r.z) }
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const toward = (v: number, to: number, step: number) => (Math.abs(to - v) <= step ? to : v + Math.sign(to - v) * step)
const turnTo = (h: number, to: number, step: number) => h + Math.max(-step, Math.min(step, angDiff(h, to)))
const smooth = (x: number) => x * x * (3 - 2 * x)

/* ---------- actors ---------- */

interface CarActor {
  on: boolean
  id: number
  t: Track
  s: number
  v: number
}

interface DogActor {
  look: PetLook
  phase: number
  heading: number
  sniff: P | null
  waitT: number
  stops: { s: number; at: P }[]
  anim: ReturnType<typeof restState>
}

interface WalkActor {
  on: boolean
  id: number
  t: Track
  s: number
  v: number
  vmax: number
  heading: number
  stride: number
  foot: number
  seed: number
  stopUntil: number
  waiting: boolean
  dog: DogActor | null
}

interface Body {
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  walk: number
  stride: number
  foot: number
  speed: number
  sit: number
  seatY: number
  lean: number
  act: number
  activity: Activity
  fade: number
}

/** Next step of a kid (or of the adult with them) */
type Step =
  | { k: 'walk'; path: P[]; speed: number }
  | { k: 'move'; from: [number, number, number]; to: [number, number, number]; dur: number; t: number; heading: number; pitch?: number; sit?: number; seatY?: number }
  | { k: 'sit'; seat: { x: number; z: number; y: number; rot: number }; app: P; dur: number; t: number; activity: Activity; sway?: boolean; lean?: number }
  | { k: 'bounce'; at: P; y: number; dur: number; t: number; heading: number }
  | { k: 'fade'; out: boolean; t: number }

interface PlayActor {
  on: boolean
  id: number
  b: Body
  queue: Step[]
  spot: Item | null
  leaving: boolean
  seed: number
  kid: boolean
  /** Landing of the last bounce (trampoline sound) */
  land: number
}

const newBody = (p: P): Body => ({ x: p.x, y: 0, z: p.z, heading: 0, pitch: 0, walk: 0, stride: 0, foot: 0, speed: 0, sit: 0, seatY: 0.45, lean: 0, act: 0, activity: 'idle', fade: 0 })

/* ---------- headlight beam ---------- */

let beamTex: THREE.CanvasTexture | null = null
/** Headlight light on the road: a warm white fan that widens and fades away from the car */
function beamTexture() {
  if (beamTex) return beamTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  const img = g.createImageData(64, 128)
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 64; x++) {
      const v = y / 127
      const spread = 0.25 + 0.75 * v
      const u = Math.abs(x / 63 - 0.5) * 2
      const side = Math.max(0, 1 - u / spread)
      const a = Math.pow(side, 1.6) * Math.pow(1 - v, 1.3) * Math.min(1, v * 6)
      img.data.set([255, 240, 205, Math.round(a * 255)], (y * 64 + x) * 4)
    }
  g.putImageData(img, 0, 0)
  beamTex = new THREE.CanvasTexture(c)
  return beamTex
}

function Beams() {
  const m = useMemo(() => new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [])
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [])
  useEffect(
    () => () => {
      m.dispose()
      glow.dispose()
    },
    [m, glow],
  )
  return (
    <group>
      {/* headlight light on the ground (in front, +z) and the red glow of the tail lights */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 2.2 + 3.6]} material={m} renderOrder={3} raycast={() => {}}>
        <planeGeometry args={[3.4, 7.2]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, -2.75]} material={glow} renderOrder={3} raycast={() => {}}>
        <planeGeometry args={[1.8, 0.9]} />
      </mesh>
    </group>
  )
}

/* ---------- component ---------- */

/** Draws the street life (in view mode, when enabled, not in light mode) */
export function StreetLife() {
  const kinds = useView((s) => s.street)
  const show = kinds.cars || kinds.walkers || kinds.kids
  const lite = useView((s) => s.lite)
  const mode = useLayout((s) => s.mode)
  const level = useLayout((s) => activeLevel(s))
  const night = useNight()
  const weather = useHa((s) => Object.values(s.entities).find((e) => domainOf(e.entity_id) === 'weather')?.state)
  const rain = Boolean(weather && /rain|pouring|lightning|hail|snow/.test(weather))
  const net = useMemo(() => (level ? streetNet(level) : null), [level])
  const has = Boolean(net && (net.roads.length || net.walks.length || net.play.length))
  const visible = show && !lite && mode === 'view' && Boolean(level) && has
  useEffect(() => {
    if (visible) return
    streetDebug.active = false
    streetDebug.cars = []
    streetDebug.walkers = []
    streetDebug.dogs = []
    streetDebug.kids = []
    streetDebug.parent = null
    streetDebug.playAt = null
    streetDebug.force = () => false
  }, [visible])
  if (!visible || !level || !net) return null
  return <Street key={net.key} level={level} net={net} night={night} rain={rain} kinds={kinds} />
}

function Street({ level, net, night, rain, kinds }: { level: Level; net: StreetNet; night: boolean; rain: boolean; kinds: StreetKinds }) {
  const invalidate = useThree((s) => s.invalidate)
  const rnd = useMemo(() => rng(Math.floor(Math.random() * 1e6) + 1), [])
  const ids = useRef(1)
  const cars = useRef<CarActor[]>(Array.from({ length: CAR_SLOTS }, () => ({ on: false, id: 0, t: null as unknown as Track, s: 0, v: 0 })))
  const walkers = useRef<WalkActor[]>(
    Array.from({ length: WALK_SLOTS }, () => ({ on: false, id: 0, t: null as unknown as Track, s: 0, v: 0, vmax: 1.3, heading: 0, stride: 0, foot: 0, seed: 0, stopUntil: 0, waiting: false, dog: null })),
  )
  const players = useRef<PlayActor[]>(
    Array.from({ length: KID_SLOTS + 1 }, (_, i) => ({ on: false, id: 0, b: newBody({ x: 0, z: 0 }), queue: [], spot: null, leaving: false, seed: i * 2.3 + 0.7, kid: i < KID_SLOTS, land: 0 })),
  )
  const carGroups = useRef<(THREE.Group | null)[]>([])
  const walkRefs = useRef<(HumanRefs | null)[]>([])
  const playRefs = useRef<(HumanRefs | null)[]>([])
  const dogRef = useRef<PetRefs | null>(null)
  const leash = useRef<Line2 | null>(null)
  const [carLooks, setCarLooks] = useState(() => Array.from({ length: CAR_SLOTS }, (_, i) => ({ variant: CAR_VARIANTS[i % 3], body: CAR_COLORS[i] })))
  const [walkLooks, setWalkLooks] = useState(() => Array.from({ length: WALK_SLOTS }, (_, i) => i))
  const [dogLook, setDogLook] = useState<PetLook>(DOG_LOOKS.golden)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const env = useRef({ night, rain, kinds })
  useEffect(() => {
    env.current = { night, rain, kinds }
  }, [night, rain, kinds])
  // A type that is switched off leaves at once
  useEffect(() => {
    if (!kinds.cars) for (const c of cars.current) c.on = false
    if (!kinds.walkers) for (const w of walkers.current) w.on = false
    if (!kinds.kids) for (const a of players.current) a.on = false
    invalidate()
  }, [kinds, invalidate])
  const regWalk = useMemo(() => Array.from({ length: WALK_SLOTS }, (_, i) => (r: HumanRefs | null) => void (walkRefs.current[i] = r)), [])
  const regPlay = useMemo(() => Array.from({ length: KID_SLOTS + 1 }, (_, i) => (r: HumanRefs | null) => void (playRefs.current[i] = r)), [])
  const regDog = useMemo(() => (r: PetRefs | null) => void (dogRef.current = r), [])
  useAmbient(busy)

  const wake = () => {
    if (!busyRef.current) {
      busyRef.current = true
      setBusy(true)
    }
    invalidate()
  }

  /* ----- spawning ----- */
  const spawnCar = () => {
    if (!env.current.kinds.cars) return false
    const i = cars.current.findIndex((c) => !c.on)
    if (i < 0) return false
    // Try a few more times if a short branch was picked
    let t = carTrack(net, rnd)
    for (let n = 0; !t && n < 6; n++) t = carTrack(net, rnd)
    if (!t) return false
    // Only one car at a time on a single lane (narrow) road
    const narrow = (x: Track) => x.off.reduce((a, b) => a + b, 0) / x.off.length < 0.5
    if (cars.current.some((c) => c.on && (narrow(c.t) || narrow(t)))) return false
    // Wait if another car is at the entrance
    const p0 = posAt(t, 0)
    if (cars.current.some((c) => c.on && Math.hypot(posAt(c.t, c.s).x - p0.x, posAt(c.t, c.s).z - p0.z) < 8)) return false
    cars.current[i] = { on: true, id: ids.current++, t, s: 0, v: Math.min(CAR_SPEED, limitAhead(t, 0, 10)) }
    setCarLooks((l) => l.map((x, k) => (k === i ? { variant: CAR_VARIANTS[Math.floor(rnd() * 3)], body: CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)] } : x)))
    streetDebug.seen.car++
    wake()
    return true
  }
  const spawnWalker = (withDog: boolean, via?: P) => {
    if (!env.current.kinds.walkers) return false
    // A dog walker only in slot 0 (a single dog is drawn)
    const i = withDog ? (walkers.current[0].on ? -1 : 0) : walkers.current.findIndex((w, k) => !w.on && k > 0)
    if (i < 0) return false
    let t = walkTrack(level, net, rnd, withDog)
    for (let n = 0; !t && n < 6; n++) t = walkTrack(level, net, rnd, withDog)
    // Test: the route passes near the given point
    for (let n = 0; via && t && n < 40 && !t.base.some((b) => Math.hypot(b.x - via.x, b.z - via.z) < 1); n++) t = walkTrack(level, net, rnd, withDog)
    if (!t) return false
    const seed = rnd() * 10
    const w: WalkActor = {
      on: true,
      id: ids.current++,
      t,
      s: 0,
      v: 0.6,
      vmax: withDog ? 1.05 + rnd() * 0.2 : 1.2 + rnd() * 0.3 + (env.current.night ? 0.1 : 0),
      heading: dirAt(t, 0),
      stride: 0,
      foot: 0,
      seed,
      stopUntil: 0,
      waiting: false,
      dog: null,
    }
    if (withDog) {
      const look = DOG_LOOKS[DOGS[Math.floor(rnd() * DOGS.length)]]
      w.dog = { look, phase: 0, heading: dirAt(t, DOG_LEAD, 1), sniff: null, waitT: 0, stops: sniffStops(t, net.sniff), anim: restState() }
      setDogLook(look)
    }
    walkers.current[i] = w
    setWalkLooks((l) => l.map((x, k) => (k === i ? Math.floor(rnd() * ADULTS.length) : x)))
    streetDebug.seen[withDog ? 'dog' : 'walker']++
    wake()
    return true
  }

  /** A kid's next game: equipment with a free spot (prefers a different one than before); its steps go into the queue */
  const nextPlay = (a: PlayActor) => {
    const used = (it: Item) => players.current.filter((o) => o.on && o !== a && o.kid && o.spot?.id === it.id).length
    const free = net.play.filter((it) => used(it) < PLAY_CAP[it.kind as PlayKind])
    if (!free.length) return false
    const other = free.filter((it) => it.id !== a.spot?.id)
    const it = (other.length && rnd() < 0.75 ? other : free)[Math.floor(rnd() * (other.length && rnd() < 0.75 ? other : free).length)]
    a.spot = it
    const b = a.b
    const kind = it.kind as PlayKind
    const k = players.current.indexOf(a)
    const run = 1.9 + rnd() * 0.4
    const go = (to: P) => a.queue.push({ k: 'walk', path: walkPath(level, { x: b.x, z: b.z }, to), speed: run })
    if (kind === 'slide') {
      const foot = local(it, 0, -1.78)
      go(foot)
      const rounds = 2 + Math.floor(rnd() * 2)
      const top = local(it, 0, -0.95)
      const hi = local(it, 0, -0.62)
      const lo = local(it, 0, 1.33)
      const end = local(it, 0, 1.78)
      for (let n = 0; n < rounds; n++) {
        if (n > 0) {
          // After sliding down, walks around the side back to the ladder
          const side = local(it, 0.85, 1.6)
          const back = local(it, 0.85, -1.78)
          a.queue.push({ k: 'walk', path: [side, back, foot], speed: run })
        }
        a.queue.push({ k: 'move', from: [foot.x, 0, foot.z], to: [top.x, 1.23, top.z], dur: 2.1, t: 0, heading: it.rot })
        a.queue.push({ k: 'move', from: [top.x, 1.23, top.z], to: [hi.x, 1.23, hi.z], dur: 0.6, t: 0, heading: it.rot, sit: 1, seatY: 0.08 })
        a.queue.push({ k: 'move', from: [hi.x, 1.21, hi.z], to: [lo.x, 0.26, lo.z], dur: 1.15, t: 0, heading: it.rot, pitch: Math.atan2(0.95, 1.95), sit: 1, seatY: 0.08 })
        a.queue.push({ k: 'move', from: [lo.x, 0.26, lo.z], to: [end.x, 0, end.z], dur: 0.45, t: 0, heading: it.rot, sit: 0, seatY: 0.08 })
      }
    } else if (kind === 'trampoline') {
      // The one of the four edge sides closest to where the kid comes from; inside, each kid has its own spot
      const sides = [0, 1, 2, 3].map((q) => local(it, Math.sin((q * Math.PI) / 2) * 1.55, Math.cos((q * Math.PI) / 2) * 1.55))
      const edge = sides.reduce((p, q) => (Math.hypot(q.x - b.x, q.z - b.z) < Math.hypot(p.x - b.x, p.z - b.z) ? q : p))
      const ang = it.rot + (k % 2 ? 1 : -1) * 0.9
      const inner = { x: it.x + Math.sin(ang) * 0.45, z: it.z + Math.cos(ang) * 0.45 }
      const hIn = Math.atan2(inner.x - edge.x, inner.z - edge.z)
      go(edge)
      a.queue.push({ k: 'move', from: [edge.x, 0, edge.z], to: [inner.x, 0.66, inner.z], dur: 0.7, t: 0, heading: hIn })
      a.queue.push({ k: 'bounce', at: inner, y: 0.66, dur: 8 + rnd() * 7, t: 0, heading: hIn + Math.PI })
      a.queue.push({ k: 'move', from: [inner.x, 0.66, inner.z], to: [edge.x, 0, edge.z], dur: 0.7, t: 0, heading: hIn + Math.PI })
    } else if (kind === 'sandbox') {
      const taken = players.current.filter((o) => o.on && o !== a && o.spot?.id === it.id).map((o) => o.seed)
      const q = taken.length ? (Math.floor(a.seed) + 2) % 4 : Math.floor(rnd() * 4)
      const sx = q % 2 ? 1 : -1
      const sz = q < 2 ? 1 : -1
      const seat = local(it, sx * 0.66, sz * 0.66)
      const app = local(it, sx * 1.08, sz * 1.08)
      go(app)
      a.queue.push({ k: 'sit', seat: { x: seat.x, z: seat.z, y: 0.29, rot: Math.atan2(it.x - seat.x, it.z - seat.z) }, app, dur: 10 + rnd() * 10, t: 0, activity: 'wash' })
    } else {
      const seat = local(it, 0, 0)
      const app = local(it, 0, 0.88)
      go(app)
      a.queue.push({ k: 'sit', seat: { x: seat.x, z: seat.z, y: 0.46, rot: it.rot }, app, dur: 9 + rnd() * 8, t: 0, activity: 'idle', sway: true })
    }
    return true
  }

  const kidsState = useRef({ until: 0, entrance: null as P | null })
  const spawnKids = () => {
    if (!env.current.kinds.kids || !net.play.length || players.current.some((p) => p.on)) return false
    const c = net.play.reduce((s, it) => ({ x: s.x + it.x / net.play.length, z: s.z + it.z / net.play.length }), { x: 0, z: 0 })
    const ent = playEntrance(level, net, c)
    const cap = net.play.reduce((s, it) => s + PLAY_CAP[it.kind as PlayKind], 0)
    const n = Math.max(1, Math.min(KID_SLOTS, cap, 1 + Math.floor(rnd() * 3)))
    kidsState.current = { until: Date.now() + (150 + rnd() * 150) * 1000, entrance: ent }
    for (let i = 0; i < n; i++) {
      const a = players.current[i]
      a.on = true
      a.id = ids.current++
      a.b = newBody({ x: ent.x + (i - 1) * 0.5, z: ent.z })
      a.queue = [{ k: 'fade', out: false, t: 0 }]
      a.spot = null
      a.leaving = false
      nextPlay(a)
    }
    // If a bench is nearby an adult sits and waits
    const bench = net.benches.filter((it) => Math.hypot(it.x - c.x, it.z - c.z) < 18).sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0]
    const pa = players.current[KID_SLOTS]
    if (bench) {
      const L = bench.len ?? 1.6
      const seat = local(bench, -L / 4, 0.03)
      const app = local(bench, -L / 4, 0.62)
      pa.on = true
      pa.id = ids.current++
      pa.b = newBody({ x: ent.x, z: ent.z + 0.6 })
      pa.spot = bench
      pa.leaving = false
      pa.queue = [
        { k: 'fade', out: false, t: 0 },
        { k: 'walk', path: walkPath(level, ent, app), speed: 1.2 },
        { k: 'sit', seat: { x: seat.x, z: seat.z, y: 0.46, rot: bench.rot }, app, dur: 1e9, t: 0, activity: 'phone', lean: 0.12 },
      ]
    }
    streetDebug.seen.kids++
    wake()
    return true
  }
  const leaveKids = () => {
    const ent = kidsState.current.entrance
    let any = false
    for (const a of players.current) {
      if (!a.on || a.leaving) continue
      any = true
      a.leaving = true
      // Leaves without finishing the current step: a stand up step when sitting, then walks to the entrance and fades out
      const cur = a.queue[0]
      a.queue = []
      if (cur && cur.k === 'sit') a.queue.push({ ...cur, dur: Math.min(cur.dur, cur.t + 0.01) })
      else if (cur && cur.k === 'bounce') a.queue.push({ ...cur, dur: cur.t + 0.01 }, { k: 'move', from: [cur.at.x, cur.y, cur.at.z], to: [cur.at.x + Math.sin(cur.heading) * 1.1, 0, cur.at.z + Math.cos(cur.heading) * 1.1], dur: 0.7, t: 0, heading: cur.heading })
      else if (cur && cur.k === 'move') a.queue.push(cur)
      a.queue.push({ k: 'walk', path: ent ? walkPath(level, { x: a.b.x, z: a.b.z }, ent) : [], speed: a.kid ? 1.5 : 1.2 }, { k: 'fade', out: true, t: 0 })
    }
    if (any) wake()
    return any
  }

  /* ----- timer ----- */
  useEffect(() => {
    const next = { car: 0, walker: 0, dog: 0, kids: 0 }
    const plan = (kind: 'car' | 'walker' | 'dog', first = false) => {
      const g = gapOf(kind, env.current.night, new Date().getHours(), env.current.rain)
      next[kind] = g ? Date.now() + (first ? rnd() * g[0] : g[0] + rnd() * (g[1] - g[0])) * 1000 : Infinity
    }
    plan('car', true)
    plan('walker', true)
    plan('dog', true)
    next.kids = Date.now() + (4 + rnd() * 10) * 1000
    const id = window.setInterval(() => {
      const now = Date.now()
      const { night: nt, rain: rn } = env.current
      // Test: with automatic spawning off the timers keep moving forward (kids still leave at night or in the rain)
      if (!streetDebug.auto) for (const k of ['car', 'walker', 'dog'] as const) next[k] = Math.max(next[k], now + 1000)
      if (now > next.car) {
        if (net.roads.length) spawnCar()
        plan('car')
      }
      if (now > next.walker) {
        if (net.walks.length) spawnWalker(false)
        plan('walker')
      }
      if (now > next.dog) {
        if (net.walks.length) spawnWalker(true)
        plan('dog')
      }
      const out = players.current.some((p) => p.on)
      if (net.play.length && kidsOut(nt, rn)) {
        if (!out && now > next.kids && streetDebug.auto) {
          spawnKids()
          next.kids = Infinity
        } else if (out && now > kidsState.current.until) leaveKids()
      } else if (out) leaveKids()
      if (!out && next.kids === Infinity && !players.current.some((p) => p.on)) next.kids = now + (60 + rnd() * 120) * 1000
    }, 500)
    streetDebug.active = true
    streetDebug.force = (kind, via) => {
      if (kind === 'car') return spawnCar()
      if (kind === 'walker') return spawnWalker(false, via)
      if (kind === 'dog') return spawnWalker(true, via)
      if (kind === 'kids') return spawnKids()
      return leaveKids()
    }
    return () => {
      window.clearInterval(id)
      streetDebug.active = false
      streetDebug.force = () => false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, level])

  /* ----- frame ----- */
  const leashPts = useMemo(() => new Float32Array(12 * 3), [])
  const v1 = useMemo(() => new THREE.Vector3(), [])
  const v2 = useMemo(() => new THREE.Vector3(), [])
  const anim = useRef<AnimState>({ t: 0, walk: 0, phase: 0, pace: 1, sit: 0, lie: 0, seatY: 0.45, lean: 0, activity: 'idle', act: 0, actAge: 0, reach: 1, lookYaw: 0, lookPitch: 0, blink: false, seed: 0 })

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const now = state.clock.elapsedTime
    const wall = performance.now() / 1000
    let moving = false
    let alive = false

    /* cars */
    const cs = cars.current
    cs.forEach((c, i) => {
      const g = carGroups.current[i]
      if (!g) return
      g.visible = c.on
      if (!c.on) return
      alive = true
      let target = Math.min(CAR_SPEED, limitAhead(c.t, c.s, 14))
      // Stops before the crosswalk when a pedestrian is on it (or at its edge)
      for (const x of c.t.cross) {
        if (c.s > x.s0 - 1.2) continue
        if (x.s0 - c.s > 25) break
        const busyX = walkers.current.some((w) => {
          if (!w.on) return false
          const p = posAt(w.t, w.s)
          return p.x > x.r.x - 0.9 && p.x < x.r.x + x.r.w + 0.9 && p.z > x.r.z - 0.9 && p.z < x.r.z + x.r.d + 0.9
        })
        if (busyX) {
          const room = x.s0 - 2.8 - c.s
          target = Math.min(target, room <= 0.05 ? 0 : Math.sqrt(2 * 4 * room))
        }
      }
      // Body from the front and rear axle positions on the route (in a bend the rear wheel tracks inside, the car does not spin in place)
      const { p: me, h } = carPose(c.t, c.s)
      // Gap to the car ahead
      for (const o of cs) {
        if (o === c || !o.on) continue
        const op = carPose(o.t, o.s).p
        const dx = op.x - me.x
        const dz = op.z - me.z
        const along = dx * Math.sin(h) + dz * Math.cos(h)
        const side = Math.abs(dx * Math.cos(h) - dz * Math.sin(h))
        if (along > 0 && along < 14 && side < 1.6) {
          const gap = along - 5.2
          target = Math.min(target, gap <= 0 ? 0 : o.v + Math.sqrt(2 * 5 * gap))
        }
      }
      c.v = toward(c.v, target, (target < c.v ? 7 : 2.8) * dt)
      c.s += c.v * dt
      if (c.s >= c.t.len) {
        c.on = false
        g.visible = false
        return
      }
      g.position.set(me.x, 0, me.z)
      g.rotation.y = h
      g.scale.setScalar(Math.max(0.001, Math.min(1, c.s / 2.5, (c.t.len - c.s) / 2.5)))
      if (c.v > 0.05) moving = true
    })

    /* pedestrians and the dog */
    const ws = walkers.current
    ws.forEach((w, i) => {
      const r = walkRefs.current[i]
      if (!r) return
      r.root.visible = w.on
      if (i === 0 && dogRef.current) dogRef.current.root.visible = w.on && Boolean(w.dog)
      if (i === 0 && leash.current) leash.current.visible = w.on && Boolean(w.dog)
      if (!w.on) return
      alive = true
      let target = w.vmax
      const d = w.dog
      if (wall < w.stopUntil) target = 0
      else if (d) {
        d.sniff = null
        const st = d.stops[0]
        if (st && w.s >= st.s - DOG_LEAD) {
          d.stops.shift()
          if (rnd() < streetDebug.sniffChance) {
            w.stopUntil = wall + 2 + rnd() * 2.5
            d.sniff = st.at
            target = 0
            if (rnd() < 0.2) play('bark', { x: st.at.x, y: 0.5, z: st.at.z }, { bus: 'pets', v: d.look.scale < 0.65 ? 'small' : undefined, gain: 0.6 })
          }
        }
      }
      // At the crosswalk edge: waits if a car is approaching (and not slowing down)
      w.waiting = false
      for (const x of w.t.cross) {
        if (w.s > x.s0 - 0.05 || x.s0 - w.s > 1.2) continue
        const danger = cs.some((c) => {
          if (!c.on || c.v < 1.2) return false
          const xc = c.t.cross.find((q) => q.r === x.r)
          return Boolean(xc && c.s < xc.s1 + 2.5 && xc.s0 - c.s < 14)
        })
        if (danger) {
          target = 0
          w.waiting = true
        }
      }
      w.v = toward(w.v, target, 2.4 * dt)
      w.s += w.v * dt
      if (w.s >= w.t.len) {
        w.on = false
        r.root.visible = false
        return
      }
      const p = posAt(w.t, w.s)
      if (w.v > 0.05) w.heading = turnTo(w.heading, dirAt(w.t, w.s), 6 * dt)
      w.stride += ((w.v * dt) / STRIDE) * Math.PI * 2
      const foot = Math.floor(w.stride / Math.PI)
      if (foot !== w.foot) {
        if (w.v > 0.4) stepAt(level, p.x, p.z, { gain: 0.3 })
        w.foot = foot
      }
      const fade = Math.max(0.001, Math.min(1, w.s / 0.8, (w.t.len - w.s) / 0.8))
      r.root.position.set(p.x, 0, p.z)
      r.root.rotation.y = w.heading
      r.root.scale.setScalar(fade)
      const a = anim.current
      const walkAmt = Math.min(1, w.v / 0.5)
      Object.assign(a, {
        t: now + w.seed * 10,
        walk: walkAmt,
        phase: w.stride + i,
        pace: Math.max(0.45, Math.min(1.15, w.v / 1.25)),
        sit: 0,
        lie: 0,
        seatY: 0.45,
        lean: 0,
        activity: 'idle' as Activity,
        act: 0,
        actAge: 0,
        reach: 1,
        lookYaw: d?.sniff ? 0.5 : 0.25 * Math.sin(now * 0.3 + w.seed),
        lookPitch: d?.sniff ? 0.35 : 0,
        blink: (now + w.seed) % 3.7 < 0.12,
        seed: w.seed,
      })
      animateHuman(r, a)
      if (w.v > 0.05) moving = true
      // Dog: DOG_LEAD ahead of its owner, beside them; bends to the ground when sniffing, sits while waiting
      if (d && i === 0 && dogRef.current) {
        const pr = dogRef.current
        const sd = w.s + DOG_LEAD
        const dp = d.sniff ? null : posAt(w.t, sd, 1)
        if (dp) pr.root.position.set(dp.x, 0, dp.z)
        const want = d.sniff ? Math.atan2(d.sniff.x - pr.root.position.x, d.sniff.z - pr.root.position.z) : w.v > 0.05 ? dirAt(w.t, sd, 1) : d.heading
        d.heading = turnTo(d.heading, want, 6 * dt)
        pr.root.rotation.y = d.heading
        pr.root.scale.setScalar(d.look.scale * fade)
        d.phase += ((w.v * dt) / (DOG_STRIDE * d.look.scale)) * Math.PI * 2
        d.waitT = w.v < 0.05 && !d.sniff ? d.waitT + dt : 0
        const da = d.anim
        Object.assign(da, restState())
        da.t = now
        da.seed = 5.1
        da.walk = Math.min(1, w.v / 0.4)
        da.gait = 0
        da.phase = d.phase
        da.eat = d.sniff ? 1 : 0
        da.sit = d.waitT > 1.2 ? 1 : 0
        da.tailUp = 0.6
        da.wag = d.sniff ? 0.7 : 0.35
        da.blink = now % 4.3 < 0.12
        da.tongue = !d.sniff && w.v > 0.3
        animatePet(pr, da, 'dog')
        // Leash: from the owner's hand on the dog side to the dog's neck, sagging when slack (if the skeleton is in the scene)
        if (!r.root.parent || !pr.root.parent) return
        const side = (w.t.off2?.[0] ?? 0) - w.t.off[0] >= 0 ? 0 : 1
        r.hand[side].getWorldPosition(v1)
        pr.neck.getWorldPosition(v2)
        v2.y += 0.02
        const span = v1.distanceTo(v2)
        const sag = Math.max(0, 0.35 - span * 0.18)
        for (let k = 0; k < 12; k++) {
          const t = k / 11
          leashPts[k * 3] = v1.x + (v2.x - v1.x) * t
          leashPts[k * 3 + 1] = v1.y + (v2.y - v1.y) * t - sag * 4 * t * (1 - t)
          leashPts[k * 3 + 2] = v1.z + (v2.z - v1.z) * t
        }
        leash.current?.geometry.setPositions(leashPts)
        streetDebug.dogs = [{ id: w.id, x: pr.root.position.x, z: pr.root.position.z, moving: w.v > 0.05, sniff: Boolean(d.sniff), leash: span }]
      }
    })
    if (!ws[0].on || !ws[0].dog) streetDebug.dogs = []

    /* playground */
    const ps = players.current
    ps.forEach((pl, i) => {
      const r = playRefs.current[i]
      if (!r) return
      r.root.visible = pl.on
      if (!pl.on) return
      alive = true
      const b = pl.b
      const st = pl.queue[0]
      let targetWalk = 0
      let bounceY = 0
      if (!st) {
        // A kid done with a game moves on to the next one (waits if there is no spot)
        if (pl.kid && !pl.leaving) nextPlay(pl)
      } else if (st.k === 'fade') {
        st.t += dt
        b.fade = st.out ? Math.max(0, 1 - st.t / 0.6) : Math.min(1, st.t / 0.6)
        if (st.t >= 0.6) {
          pl.queue.shift()
          if (st.out) {
            pl.on = false
            r.root.visible = false
            return
          }
        }
      } else if (st.k === 'walk') {
        const q = st.path[0]
        if (!q) pl.queue.shift()
        else {
          const dx = q.x - b.x
          const dz = q.z - b.z
          const dd = Math.hypot(dx, dz)
          const dir = Math.atan2(dx, dz)
          b.heading = turnTo(b.heading, dir, 7 * dt)
          b.speed = toward(b.speed, st.speed * (Math.abs(angDiff(b.heading, dir)) > 1 ? 0.4 : 1), 4 * dt)
          const mv = Math.min(dd, b.speed * dt)
          if (dd > 1e-4) {
            b.x += (dx / dd) * mv
            b.z += (dz / dd) * mv
          }
          b.stride += (mv / (STRIDE * (pl.kid ? KID_SCALE : 1))) * Math.PI * 2
          if (dd - mv < 1e-3) st.path.shift()
          targetWalk = 1
          moving = true
        }
        b.y = 0
        b.pitch = 0
        b.sit = toward(b.sit, 0, dt * 3)
      } else if (st.k === 'move') {
        st.t += dt
        const k = smooth(Math.min(1, st.t / st.dur))
        b.x = st.from[0] + (st.to[0] - st.from[0]) * k
        b.y = st.from[1] + (st.to[1] - st.from[1]) * k
        b.z = st.from[2] + (st.to[2] - st.from[2]) * k
        b.heading = turnTo(b.heading, st.heading, 8 * dt)
        b.pitch = st.pitch ?? 0
        if (st.sit != null) {
          b.sit = toward(b.sit, st.sit, dt * 4)
          b.seatY = st.seatY ?? b.seatY
        } else {
          b.sit = toward(b.sit, 0, dt * 4)
          // Steps on the ladder or while bouncing
          b.stride += dt * 7
          targetWalk = 0.6
        }
        if (st.t >= st.dur) pl.queue.shift()
        moving = true
      } else if (st.k === 'sit') {
        st.t += dt
        const into = Math.min(1, st.t / 0.8)
        const outK = st.t > st.dur ? Math.min(1, (st.t - st.dur) / 0.8) : 0
        const k = smooth(into) * (1 - smooth(outK))
        b.heading = turnTo(b.heading, st.seat.rot, 8 * dt)
        b.x = st.app.x + (st.seat.x - st.app.x) * k
        b.z = st.app.z + (st.seat.z - st.app.z) * k
        b.y = 0
        b.pitch = 0
        b.sit = k
        b.seatY = st.seat.y / (pl.kid ? KID_SCALE : 1)
        b.lean = st.lean ?? 0
        b.activity = st.activity
        b.act = toward(b.act, k > 0.95 && outK === 0 ? 1 : 0, dt * 2)
        if (st.sway) b.z += Math.sin(now * 2.2) * 0.03 * k
        if (outK >= 1) {
          pl.queue.shift()
          b.act = 0
          b.activity = 'idle'
        }
      } else if (st.k === 'bounce') {
        st.t += dt
        const T = 0.78
        const ph = (st.t % T) / T
        const h = Math.sin(ph * Math.PI)
        bounceY = h * 0.42
        b.x = st.at.x
        b.z = st.at.z
        b.y = st.y + bounceY
        b.heading = turnTo(b.heading, st.heading + Math.sin(st.t * 0.4) * 0.8, 3 * dt)
        b.sit = 0.25 * (1 - h) * (1 - h)
        b.seatY = 0.6
        const landN = Math.floor(st.t / T)
        if (landN !== pl.land) {
          pl.land = landN
          play('trampoline', { x: b.x, y: 0.7, z: b.z }, { gain: 0.5 })
        }
        if (st.t >= st.dur) pl.queue.shift()
        moving = true
      }
      b.walk = toward(b.walk, targetWalk, dt * 5)
      // Footstep sound (while walking)
      const foot = Math.floor(b.stride / Math.PI)
      if (foot !== b.foot) {
        if (b.walk > 0.5 && b.y < 0.05) stepAt(level, b.x, b.z, { gain: pl.kid ? 0.2 : 0.3 })
        b.foot = foot
      }
      const sc = pl.kid ? KID_SCALE : 1
      r.root.rotation.order = 'YXZ'
      r.root.position.set(b.x, b.y, b.z)
      r.root.rotation.set(b.pitch, b.heading, 0)
      r.root.scale.setScalar(sc * Math.max(0.001, b.fade))
      const a = anim.current
      Object.assign(a, {
        t: now + pl.seed * 10,
        walk: b.walk,
        phase: b.stride + i,
        pace: pl.kid ? 1.15 : 0.9,
        sit: b.sit,
        lie: 0,
        seatY: b.seatY,
        lean: b.lean,
        activity: b.activity,
        act: b.act,
        actAge: now,
        reach: 1,
        lookYaw: 0.3 * Math.sin(now * 0.5 + pl.seed),
        lookPitch: b.activity === 'wash' ? 0.4 : bounceY > 0 ? -0.2 : 0,
        blink: (now + pl.seed) % 3.3 < 0.12,
        seed: pl.seed,
      })
      animateHuman(r, a)
      r.shadow.visible = b.y < 0.05 && b.sit < 0.5
    })

    /* state (tests, sounds) */
    streetDebug.cars = cs.filter((c) => c.on).map((c) => {
      const { p, h } = carPose(c.t, c.s)
      return { id: c.id, x: p.x, z: p.z, heading: h, speed: c.v }
    })
    streetDebug.walkers = ws
      .filter((w) => w.on)
      .map((w) => {
        const p = posAt(w.t, w.s)
        return { id: w.id, x: p.x, z: p.z, heading: w.heading, speed: w.v, dog: Boolean(w.dog), waiting: w.waiting }
      })
    const kids = ps.filter((p) => p.on && p.kid)
    streetDebug.kids = kids.map((p) => ({ id: p.id, x: p.b.x, y: p.b.y, z: p.b.z, play: p.leaving ? null : ((p.spot?.kind as PlayKind) ?? null), act: p.queue[0]?.k ?? 'idle' }))
    const pa = ps[KID_SLOTS]
    streetDebug.parent = pa.on ? { x: pa.b.x, z: pa.b.z, seated: pa.b.sit > 0.9 } : null
    const playing = kids.filter((p) => !p.leaving && p.spot)
    streetDebug.playAt = playing.length ? { x: playing.reduce((s, p) => s + p.spot!.x, 0) / playing.length, z: playing.reduce((s, p) => s + p.spot!.z, 0) / playing.length } : null

    if (moving) {
      markShadows(1)
      state.invalidate()
    }
    if (!alive && busyRef.current) {
      busyRef.current = false
      setBusy(false)
    }
  })

  const visual = (i: number): Visual => ({ ...OFF_VISUAL, night, opts: { variant: carLooks[i].variant, body: carLooks[i].body } })
  return (
    <>
      {carLooks.map((_, i) => (
        <group key={i} ref={(g) => void (carGroups.current[i] = g)} visible={false}>
          <Car v={visual(i)} />
          {night && <Beams />}
        </group>
      ))}
      {walkLooks.map((li, i) => (
        // Not remounted when the look changes (during a remount the old skeleton, already detached from the scene, would be read for a frame)
        <Human key={`w${i}`} look={ADULTS[li]} register={regWalk[i]} />
      ))}
      <PetBody look={dogLook} register={regDog} />
      <Line ref={leash} points={Array.from({ length: 12 }, (_, k) => [k * 0.01, 0, 0] as [number, number, number])} color="#2a2420" lineWidth={2.4} visible={false} />
      {KIDS.map((look, i) => (
        <Human key={`k${i}`} look={look} register={regPlay[i]} />
      ))}
      <Human key="parent" look={PARENT} register={regPlay[KID_SLOTS]} />
    </>
  )
}
