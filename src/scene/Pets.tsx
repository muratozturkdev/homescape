import { useCursor } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { play } from '@/audio/engine'
import { passDoors } from './doorTraffic'
import { useHa } from '@/ha/store'
import { activeLevel, useLayout } from '@/model/layoutStore'
import {
  ACTION_LABEL,
  buildPetGrid,
  chooseGoal,
  chooseReaction,
  feedingNow,
  findPath,
  freshNeeds,
  gridRoom,
  isFree,
  nearestFree,
  petMode,
  petPlaces,
  pickVisitor,
  planVisitor,
  randomSpot,
  tickNeeds,
  visitorAt,
  VISITOR_LABEL,
  type PetAction,
  type PetGoal,
  type PetGrid,
  type PetMode,
  type PetNeeds,
  type PetPlace,
  type ReactionPlan,
  type Species,
  type VisitorKind,
  type VisitorPlan,
  type VisitorView,
} from '@/model/pets'
import type { Item, Level } from '@/model/types'
import { useQuick } from '@/ui/quickState'
import { clickSlop, pointerKind, useView } from './camera'
import { fpsDebug } from './FpsControls'
import { ambientEnter, ambientLeave } from './frame'
import { useAmbient } from './kit/effects'
import { peopleDebug } from './People'
import { PetBody } from './PetBody'
import { animatePet, restState, type PetAnimState, type PetRefs } from './petAnim'
import { usePetLive, petKey } from './petLive'
import { petsDebug } from './petsDebug'
import { birdParts, butterflyParts, CAT_LOOKS, DOG_LOOKS, FRAME, petLook, petMaterial, squirrelParts, type BirdKind, type PetLook } from './petModel'
import { rng } from './kit/primitives'

/*
 * Pets and animals passing by outside. Cats and dogs in the home move on their own like NPCs and can be interacted with.
 * Decision logic in model/pets.ts.
 *
 * - In view mode every cat and dog item on the active floor becomes an animal: it picks a task by its needs (food, water,
 *   sleep, play, affection, roaming, a high perch, watching out of the window), walks only through doors (A* on a grid),
 *   jumps onto furniture, and on arrival sits, lies down, curls up to sleep, grooms, stretches, eats or drinks. A dog
 *   follows the people in the home; a cat curls up next to someone sitting or avoids someone walking; at night and when
 *   the home is empty they mostly sleep.
 * - Clicking (tapping; in walk mode a click with the crosshair or E) triggers a reaction: meow, purring with hearts,
 *   rolling over; bark, tail wag, spinning around, jumping, sitting pretty. The speech bubble faces the camera. Item clicks
 *   and the quick toggle pill keep working: only the animal's invisible hit box takes the event and stops it there.
 * - In walk mode the dog runs to the player; the cat rubs against them or walks away.
 * - Outside, every 30-90 s a visitor (birds, the neighbor's cat, a stray dog, butterflies, a squirrel) passes the house.
 * Frames: every frame while walking, jumping or reacting; at the ambient rate when idle (24 fps, half when all are asleep;
 * none in light mode). They stay out of the shadow map (cheap), with a contact shadow under the feet.
 */

const MAX_PETS = 6
/** Speeds (m/s; scale 1): walk, trot, run */
const SPEED: Record<Species, Record<PetGoal['pace'], number>> = { cat: { walk: 0.55, trot: 1.15, run: 2.5 }, dog: { walk: 0.85, trot: 1.6, run: 3.2 } }
/** One step cycle (m; scale 1) */
const STRIDE: Record<Species, number[]> = { cat: [0.32, 0.45, 0.75], dog: [0.62, 0.9, 1.45] }
const TURN = 7
const HOP_T = 0.5

const noRay = () => {}
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const approachTo = (v: number, to: number, step: number) => (Math.abs(to - v) <= step ? to : v + Math.sign(to - v) * step)
const ease = (x: number) => x * x * (3 - 2 * x)

/* ---------- speech bubble ---------- */

const bubbleCache = new Map<string, THREE.CanvasTexture>()
/** Bubble texture: white rounded pill, dark text; a pink heart when hearts is set; purple "z z" when asleep. */
function bubbleTexture(text: string, hearts: boolean, sleep = false) {
  const key = `${text}|${hearts}|${sleep}`
  let t = bubbleCache.get(key)
  if (t) return t
  const W = 256
  const H = 128
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  if (sleep) {
    g.fillStyle = '#8f7cff'
    g.font = `800 64px "Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('z', 98, 82)
    g.font = `800 46px "Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif`
    g.fillText('z', 150, 46)
  } else {
    const r = 40
    const bw = Math.min(W - 12, 52 + text.length * 19 + (hearts ? 36 : 0))
    const x0 = (W - bw) / 2
    const y0 = 14
    const bh = 78
    g.fillStyle = 'rgba(27, 32, 66, 0.16)'
    g.beginPath()
    g.roundRect(x0 + 2, y0 + 5, bw, bh, r)
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.roundRect(x0, y0, bw, bh, r)
    g.fill()
    // tail
    g.beginPath()
    g.moveTo(W / 2 - 12, y0 + bh - 2)
    g.lineTo(W / 2, y0 + bh + 22)
    g.lineTo(W / 2 + 12, y0 + bh - 2)
    g.closePath()
    g.fill()
    g.fillStyle = '#1b2042'
    g.font = `700 38px "Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    // maxWidth narrows long translations to fit the pill
    g.fillText(text, W / 2 - (hearts ? 16 : 0), y0 + bh / 2 + 2, bw - 40 - (hearts ? 36 : 0))
    if (hearts) {
      g.fillStyle = '#ff6f9c'
      g.font = `700 34px system-ui, sans-serif`
      g.fillText('♥', x0 + bw - 30, y0 + bh / 2 + 2)
    }
  }
  t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  bubbleCache.set(key, t)
  return t
}

/* ---------- animal state ---------- */

interface Blend {
  walk: number
  sit: number
  lie: number
  curl: number
  groom: number
  stretch: number
  eat: number
  crouch: number
  roll: number
  jump: number
}
const BLEND_KEYS: (keyof Blend)[] = ['walk', 'sit', 'lie', 'curl', 'groom', 'stretch', 'eat', 'crouch', 'roll', 'jump']

interface Agent {
  id: string
  species: Species
  variant: string
  look: PetLook
  home: { x: number; z: number; rot: number }
  x: number
  z: number
  /** Height of the surface it stands on */
  y: number
  heading: number
  speed: number
  path: { x: number; z: number }[]
  goal: PetGoal | null
  /** End of the stay after arriving (Infinity before arriving) */
  until: number
  arrived: boolean
  hop: { fx: number; fz: number; fy: number; tx: number; tz: number; ty: number; t: number; dur: number; arc: number } | null
  b: Blend
  gait: number
  phase: number
  tailUp: number
  wag: number
  needs: PetNeeds
  last: PetAction | null
  react: { plan: ReactionPlan; t0: number; then: 'resume' | 'rethink' | 'avoid' } | null
  petted: number[]
  lookYaw: number
  lookPitch: number
  lookNext: number
  lookT: [number, number]
  blinkNext: number
  blinkUntil: number
  earNext: number
  earUntil: number
  seed: number
  rnd: () => number
  followAt: number
  zoomLeft: number
  pounceT: number
  sillAt: number
  roomIdx: number
  extraY: number
  spin: number
}

function newAgent(it: Item, i: number): Agent {
  const species = it.kind === 'cat' ? 'cat' : 'dog'
  const rnd = rng(Math.floor((Math.abs(it.x * 97.3 + it.z * 31.7) + i * 13) * 1000) + 7)
  return {
    id: it.id,
    species,
    variant: it.variant ?? '',
    look: petLook(species, it.variant),
    home: { x: it.x, z: it.z, rot: it.rot },
    x: it.x,
    z: it.z,
    y: 0,
    heading: it.rot,
    speed: 0,
    path: [],
    goal: null,
    until: 0,
    arrived: true,
    hop: null,
    b: { walk: 0, sit: 1, lie: 0, curl: 0, groom: 0, stretch: 0, eat: 0, crouch: 0, roll: 0, jump: 0 },
    gait: 0,
    phase: 0,
    tailUp: 0.5,
    wag: 0,
    needs: freshNeeds(rnd),
    last: null,
    react: null,
    petted: [],
    lookYaw: 0,
    lookPitch: 0,
    lookNext: 0,
    lookT: [0, 0],
    blinkNext: 1 + rnd() * 3,
    blinkUntil: 0,
    earNext: 2 + rnd() * 4,
    earUntil: 0,
    seed: i * 1.9 + 0.4,
    rnd,
    followAt: 0,
    zoomLeft: 0,
    pounceT: 0,
    sillAt: 0,
    roomIdx: -1,
    extraY: 0,
    spin: 0,
  }
}

/** Approximate eye height of the animal above the ground and the bubble height (m) */
const headY = (a: Agent) => (FRAME[a.species].hipY + 0.22 * (a.species === 'cat' ? 0.5 : 1)) * a.look.scale + a.y
const bubbleY = (a: Agent) => (a.species === 'cat' ? 0.62 : 1.02) * a.look.scale * (a.species === 'cat' ? 1.15 : 1) + a.y

/* ---------- component ---------- */

interface World {
  level: Level
  grids: Record<Species, PetGrid>
  places: Record<Species, PetPlace[]>
  mode: PetMode
  day: boolean
  feeding: boolean
}

/**
 * Bubbles of the sleepy bark and the double bark, taken from chooseReaction itself so the sound choice does not depend on
 * the bubble text or the language (sleeping dog; r = 0.7 picks the jump with the double bark).
 */
const sleepyBark = () => chooseReaction('dog', { sleeping: true, recent: 0 }, () => 0).bubble
const doubleBark = () => chooseReaction('dog', { sleeping: false, recent: 0 }, () => 0.7).bubble

/** Reaction sound (audio/shots.ts): meow, purr, hiss, yawn; bark (higher for a small dog), also barks when spinning or jumping */
function reactSound(a: Agent, plan: ReactionPlan) {
  const at = { x: a.x, y: a.y + (a.species === 'cat' ? 0.3 : 0.55), z: a.z }
  const o = { bus: 'pets' as const, ref: 1.2 }
  const small = a.variant === 'terrier' ? 'small' : ''
  switch (plan.kind) {
    case 'meow':
      return play('meow', at, o)
    case 'purr':
      return play('purr', at, o)
    case 'roll':
      play('purr', at, o)
      return play('meow', at, { ...o, gain: 0.6 })
    case 'hiss':
      return play('hiss', at, o)
    case 'yawn':
      return play('meow', at, { ...o, v: 'yawn', gain: 0.7 })
    case 'bark':
      return play('bark', at, { ...o, v: `${small} ${plan.bubble === sleepyBark() ? 'sleepy' : plan.bubble === doubleBark() ? 'double' : ''}` })
    case 'spin':
    case 'jump':
      return play('bark', at, { ...o, v: `${small} double`, gain: 0.8 })
  }
}

/** The pets on the active floor (in view mode). */
export function Pets() {
  const mode = useLayout((s) => s.mode)
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  const [hour, setHour] = useState<number | null>(null)
  // visitors are decoration: none in light mode or while the dashboard is open
  const lite = useView((s) => s.lite)
  const dashboard = useView((s) => s.dashboard)
  // clock (for night mode and the feeder; every 15 s)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    petsDebug.setHour = (h) => {
      setHour(h)
      setNow(Date.now())
    }
  }, [])
  const alarm = useMemo(() => Object.values(entities).find((e) => e.entity_id.startsWith('alarm_control_panel.'))?.state, [entities])
  const h = hour ?? new Date(now).getHours()
  const petMd = petMode(alarm, h)
  // daytime: the sun in HA is above the horizon (otherwise 07:00-19:00); for the sunny spot and daytime visitors
  const sun = entities['sun.sun']?.state
  const day = hour == null && sun ? sun === 'above_horizon' : h >= 7 && h < 19
  const feeding = useMemo(() => (level ? feedingNow(level, entities, now) : false), [level, entities, now])
  const pets = useMemo(() => (level ? level.items.filter((i) => i.kind === 'cat' || i.kind === 'dog').slice(0, MAX_PETS) : []), [level])
  const live = mode === 'view' && Boolean(level) && pets.length > 0
  useEffect(() => {
    petsDebug.mode = petMd
  }, [petMd])
  // the items of live pets are not drawn by the edit component (kit/pets.tsx)
  useEffect(() => {
    usePetLive.getState().set(live ? pets.map((p) => petKey(p)) : [])
    petsDebug.live = live ? pets.length : 0
    if (!live) petsDebug.pets = []
  }, [live, pets])
  useEffect(() => () => usePetLive.getState().set([]), [])
  return (
    <>
      {live && level && <PetsLive level={level} pets={pets} mode={petMd} day={day} feeding={feeding} />}
      {mode === 'view' && level && !lite && !dashboard && (level.elevation ?? 0) === 0 && <Visitors level={level} night={petMd === 'night' || !day} />}
    </>
  )
}

function PetsLive({ level, pets, mode, day, feeding }: { level: Level; pets: Item[]; mode: PetMode; day: boolean; feeding: boolean }) {
  const agents = useRef(new Map<string, Agent>())
  const refs = useRef(new Map<string, PetRefs>())
  const proxies = useRef(new Map<string, THREE.Object3D>())
  const bubbles = useRef(new Map<string, { group: THREE.Sprite; mat: THREE.SpriteMaterial; key: string }>())
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const lite = useView((s) => s.lite)
  const fps = useView((s) => s.fps)
  const grids = useMemo(() => ({ cat: buildPetGrid(level, 'cat'), dog: buildPetGrid(level, 'dog') }), [level])
  const places = useMemo(() => ({ cat: petPlaces(level, 'cat'), dog: petPlaces(level, 'dog') }), [level])
  const world = useRef<World>({ level, grids, places, mode, day, feeding })
  const ambient = useRef<'none' | 'slow' | 'full'>('none')

  // sync the animals with the items (a new one sits at its home, a moved one gets a new home)
  useEffect(() => {
    const map = agents.current
    const ids = new Set(pets.map((p) => p.id))
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id)
    pets.forEach((it, i) => {
      const a = map.get(it.id)
      if (!a || a.species !== (it.kind === 'cat' ? 'cat' : 'dog')) {
        map.set(it.id, newAgent(it, i))
        return
      }
      if (a.variant !== (it.variant ?? '')) {
        a.variant = it.variant ?? ''
        a.look = petLook(a.species, it.variant)
      }
      if (a.home.x !== it.x || a.home.z !== it.z || a.home.rot !== it.rot) {
        a.home = { x: it.x, z: it.z, rot: it.rot }
        a.until = 0
      }
    })
    invalidate()
  }, [pets, invalidate])

  // they rethink when the mode changes (night, home empty), when food is served or when the plan changes
  useEffect(() => {
    const w = world.current
    const changed = w.mode !== mode || (feeding && !w.feeding) || w.level !== level
    world.current = { level, grids, places, mode, day, feeding }
    if (!changed) return
    const now = performance.now() / 1000
    for (const a of agents.current.values()) {
      if (a.goal?.action === 'sleep' && mode !== 'home') continue
      if (a.react || a.hop) {
        a.until = Math.min(a.until, now)
        continue
      }
      // stops and rethinks (not all at the same moment)
      a.path = []
      a.arrived = true
      a.until = now + a.rnd() * 2
    }
    invalidate()
  }, [level, grids, places, mode, day, feeding, invalidate])

  /* ----- thinking: the next task and path ----- */
  const think = (a: Agent, t: number, forced?: PetGoal) => {
    const w = world.current
    const grid = w.grids[a.species]
    const outdoor = a.species === 'dog' && w.mode === 'home'
    const people = (peopleDebug.persons ?? []).map((p) => ({ x: p.x, z: p.z, sitting: p.pose !== 'stand', walking: p.walking }))
    const taken = [...agents.current.values()].filter((o) => o !== a && o.goal).map((o) => ({ x: o.goal!.x, z: o.goal!.z }))
    const player = fps && useView.getState().fps ? { x: fpsDebug.x, z: fpsDebug.z } : null
    const room = gridRoom(grid, a.x, a.z)
    // Roaming, so pets do not stay in one room: one in five picks a random spot in the current room, the rest a random
    // spot in another room of the home
    const others = grid.rooms.map((_, i) => i).filter((i) => i !== room)
    const wander = () => {
      if (room >= 0 && a.rnd() < 0.2) return randomSpot(grid, a.rnd, false, room) ?? randomSpot(grid, a.rnd, false)
      const target = others.length ? others[Math.floor(a.rnd() * others.length)] : undefined
      return (target != null ? randomSpot(grid, a.rnd, false, target) : null) ?? randomSpot(grid, a.rnd, false)
    }
    let goal: PetGoal | null = forced ?? null
    let path: { x: number; z: number }[] | null = null
    for (let tries = 0; tries < 4; tries++) {
      goal ??= chooseGoal({
        species: a.species,
        places: w.places[a.species],
        home: a.home,
        pos: { x: a.x, z: a.z },
        needs: a.needs,
        mode: w.mode,
        day: w.day,
        people,
        player,
        taken,
        feeding: w.feeding,
        last: a.last,
        wander,
        sillOk: (p) => sillVisible(p),
        outdoor,
        rnd: a.rnd,
      })
      path = findPath(grid, { x: a.x, z: a.z }, { x: goal.x, z: goal.z }, outdoor)
      if (path) break
      goal = null
    }
    if (!goal || !path) {
      goal = { action: 'sit', x: a.x, z: a.z, y: a.y, rot: null, pose: 'sit', stay: 3 + a.rnd() * 3, pace: 'walk' }
      path = []
    }
    // when up high, jumps down first (unless the task stays in place)
    const stayHere = Math.hypot(goal.x - a.x, goal.z - a.z) < 0.05 && Math.abs(goal.y - a.y) < 0.02
    if (a.y > 0.02 && !stayHere) {
      const land = nearestFree(grid, a.x, a.z, { room: gridRoom(grid, a.x, a.z), outdoor, max: 1.5 }) ?? nearestFree(grid, a.x, a.z, { outdoor, max: 2 })
      if (land) {
        a.hop = { fx: a.x, fz: a.z, fy: a.y, tx: land.x, tz: land.z, ty: 0, t: 0, dur: HOP_T, arc: 0.12 }
        path = findPath(grid, land, { x: goal.x, z: goal.z }, outdoor) ?? []
      }
    }
    if (stayHere) path = []
    a.goal = goal
    a.path = path
    a.arrived = false
    a.until = Infinity
    a.zoomLeft = goal.action === 'zoomies' ? 2 + Math.floor(a.rnd() * 3) : 0
    a.pounceT = 0
    a.followAt = t + 1
    a.sillAt = t + 0.5
  }

  /** Whether the window sill is visible: yes in walk mode; from above, no when the window wall faces the camera (cut away). */
  const sillVisible = (p: PetPlace) => {
    if (useView.getState().fps) return true
    if (useView.getState().plan) return false
    const it = world.current.level.items.find((i) => i.id === p.itemId)
    if (!it) return false
    const dx = camera.position.x - it.x
    const dz = camera.position.z - it.z
    // the item's +z points into the room; the outward normal is the opposite
    return (-Math.sin(it.rot) * dx - Math.cos(it.rot) * dz) / (Math.hypot(dx, dz) || 1) <= 0.2
  }

  /** Click, tap or E in walk mode: reaction */
  const pokeRef = useRef<(a: Agent, t: number) => unknown>(() => null)
  const poke = (a: Agent, t: number) => {
    a.petted = a.petted.filter((x) => t - x < 10)
    const sleeping = a.goal?.action === 'sleep' && a.b.lie > 0.5
    const plan = chooseReaction(a.species, { sleeping, recent: a.petted.length }, a.rnd)
    a.petted.push(t)
    a.needs = { ...a.needs, love: Math.min(1, a.needs.love + 0.3), fun: Math.min(1, a.needs.fun + 0.1) }
    a.react = { plan, t0: t, then: plan.kind === 'hiss' ? 'avoid' : sleeping ? 'rethink' : 'resume' }
    a.spin = 0
    reactSound(a, plan)
    invalidate()
    return plan
  }
  useEffect(() => {
    pokeRef.current = poke
  })

  // test hooks
  useEffect(() => {
    petsDebug.command = (id, action, x, z) => {
      const a = agents.current.get(id)
      if (!a) return false
      const t = performance.now() / 1000
      const pose = action === 'sleep' ? (a.species === 'cat' ? 'curl' : 'lie') : action === 'sit' ? 'sit' : 'stand'
      const greet = action === 'greet'
      think(a, t, { action, x: x ?? a.x, z: z ?? a.z, y: 0, rot: null, pose: greet ? 'sit' : pose, stay: action === 'wander' ? 4 : 30, pace: greet ? 'run' : 'walk', follow: greet ? 'player' : undefined })
      invalidate()
      return true
    }
    petsDebug.poke = (id) => {
      const a = agents.current.get(id)
      if (!a) return null
      return poke(a, performance.now() / 1000).bubble
    }
    return () => {
      petsDebug.command = () => false
      petsDebug.poke = () => null
    }
  })

  // walk mode click with the crosshair or E: reacts when looking at an animal (the FpsControls item target stays empty on animals)
  useEffect(() => {
    if (!fps) return
    const ray = new THREE.Raycaster()
    ray.far = 3.2
    const center = new THREE.Vector2(0, 0)
    const hit = () => {
      ray.setFromCamera(center, camera)
      let best: { id: string; d: number } | null = null
      for (const [id, o] of proxies.current) {
        const h = ray.intersectObject(o, false)[0]
        if (h && (!best || h.distance < best.d)) best = { id, d: h.distance }
      }
      const a = best && agents.current.get(best.id)
      if (a) poke(a, performance.now() / 1000)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' && document.pointerLockElement) hit()
    }
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 && e.pointerType === 'mouse' && document.pointerLockElement) hit()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  })

  // release the ambient frame rate
  useEffect(
    () => () => {
      if (ambient.current !== 'none') ambientLeave(ambient.current === 'slow')
      ambient.current = 'none'
    },
    [],
  )

  const tmpState = useRef(restState())
  // register callbacks of the animal components (by id; stable)
  const hooks = useMemo<NpcHooks>(
    () => ({
      refs: (id, r) => void (r ? refs.current.set(id, r) : refs.current.delete(id)),
      proxy: (id, o) => void (o ? proxies.current.set(id, o) : proxies.current.delete(id)),
      bubble: (id, b) => void (b ? bubbles.current.set(id, { ...b, key: '' }) : bubbles.current.delete(id)),
      poke: (id) => {
        const ag = agents.current.get(id)
        if (ag) pokeRef.current(ag, performance.now() / 1000)
      },
    }),
    [],
  )

  const doorAt = useRef(0)
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const t = performance.now() / 1000
    const w = world.current
    let busy = false
    let reacting = false
    let allAsleep = true
    const out: (typeof petsDebug)['pets'] = []
    const people = peopleDebug.persons ?? []
    const player = useView.getState().fps ? { x: fpsDebug.x, z: fpsDebug.z } : null
    for (const a of agents.current.values()) {
      const grid = w.grids[a.species]
      const sc = a.look.scale
      const prevX = a.x
      const prevZ = a.z
      // the next task
      if (!a.react && !a.hop && a.arrived && t >= a.until) {
        if (a.goal) a.last = a.goal.action
        think(a, t)
      }
      let moving: 'still' | 'walk' | 'run' = 'still'
      const T: Blend = { walk: 0, sit: 0, lie: 0, curl: 0, groom: 0, stretch: 0, eat: 0, crouch: 0, roll: 0, jump: 0 }
      let wagT = a.species === 'dog' ? 0.25 : 0
      let tailT = 0.7
      let mouth = 0
      let tongue = false
      let blink = false
      let lookAtCam = false
      const g = a.goal
      a.extraY = 0

      // the path is refreshed when the followed person or player moved (the path may become empty)
      if (!a.react && !a.hop && g?.follow && a.path.length && t > a.followAt) retarget(a, g, t)

      if (a.react) {
        // ----- reaction -----
        const r = a.react
        const p = (t - r.t0) / r.plan.dur
        a.speed = approachTo(a.speed, 0, dt * 6)
        lookAtCam = true
        switch (r.plan.kind) {
          case 'meow':
            mouth = p < 0.35 ? 1 : 0
            tailT = 1
            T.sit = a.b.sit > 0.5 ? 1 : 0
            break
          case 'purr':
            blink = true
            tailT = 0.9
            T.sit = Math.max(a.b.sit, a.b.lie) > 0.5 ? 1 : 0
            break
          case 'roll':
            T.roll = p < 0.85 ? 1 : 0
            break
          case 'hiss':
            mouth = 1
            T.crouch = 0.6
            tailT = 0.1
            break
          case 'yawn':
            mouth = p > 0.15 && p < 0.6 ? 1 : 0
            T.lie = 1
            break
          case 'bark':
            mouth = (p < 0.25 || (p > 0.42 && p < 0.62)) ? 1 : 0
            wagT = 1
            break
          case 'spin':
            a.heading += dt * (Math.PI * 2) / (r.plan.dur * 0.8)
            T.walk = p < 0.85 ? 1 : 0
            a.phase += dt * 9
            wagT = 1
            break
          case 'jump': {
            const q = Math.min(1, p / 0.55)
            a.extraY = Math.sin(q * Math.PI) * 0.3 * sc
            T.jump = q < 1 ? 1 : 0
            wagT = 1
            tongue = true
            break
          }
          case 'sitPretty':
            T.sit = 1
            wagT = 1
            tongue = true
            break
        }
        reacting = true
        if (p >= 1) {
          a.react = null
          if (r.then === 'avoid') {
            const far = randomSpot(grid, a.rnd, false)
            think(a, t, far ? { action: 'avoid', x: far.x, z: far.z, y: 0, rot: null, pose: 'sit', stay: 4, pace: 'trot' } : undefined)
          } else if (r.then === 'rethink') {
            a.last = 'sleep'
            a.until = 0
            a.arrived = true
          }
        }
        busy = true
      } else if (a.hop) {
        // ----- jumping (onto furniture, down) -----
        const hp = a.hop
        hp.t += dt
        const k = Math.min(1, hp.t / hp.dur)
        const e = ease(k)
        a.x = hp.fx + (hp.tx - hp.fx) * e
        a.z = hp.fz + (hp.tz - hp.fz) * e
        a.y = hp.fy + (hp.ty - hp.fy) * e + Math.sin(k * Math.PI) * hp.arc
        const dir = Math.atan2(hp.tx - hp.fx, hp.tz - hp.fz)
        if (Math.hypot(hp.tx - hp.fx, hp.tz - hp.fz) > 0.05) a.heading += Math.max(-TURN * 2 * dt, Math.min(TURN * 2 * dt, angDiff(a.heading, dir)))
        T.jump = k < 0.92 ? 1 : 0
        if (k >= 1) {
          a.y = hp.ty
          a.hop = null
        }
        busy = true
        moving = 'walk'
      } else if (a.path.length && g) {
        // ----- walking -----
        const pnt = a.path[0]
        const dx = pnt.x - a.x
        const dz = pnt.z - a.z
        const d = Math.hypot(dx, dz)
        const dir = Math.atan2(dx, dz)
        const off = Math.abs(angDiff(a.heading, dir))
        a.heading += Math.max(-TURN * dt, Math.min(TURN * dt, angDiff(a.heading, dir)))
        let left = d
        for (let k = 1; k < a.path.length; k++) left += Math.hypot(a.path[k].x - a.path[k - 1].x, a.path[k].z - a.path[k - 1].z)
        const top = SPEED[a.species][g.pace] * Math.sqrt(sc)
        const want = Math.min(top * (off > 1 ? 0.35 : 1), Math.max(0.25, left * 2))
        a.speed = approachTo(a.speed, want, (g.pace === 'run' ? 7 : 3.5) * dt)
        const move = Math.min(d, a.speed * dt)
        if (d > 1e-4) {
          const nx = a.x + (dx / d) * move
          const nz = a.z + (dz / d) * move
          a.x = nx
          a.z = nz
        }
        if (d - move < 1e-3) a.path.shift()
        const gi = a.speed > SPEED[a.species].trot * Math.sqrt(sc) * 1.1 ? 2 : a.speed > SPEED[a.species].walk * Math.sqrt(sc) * 1.15 ? 1 : 0
        a.gait = approachTo(a.gait, gi, dt * 3)
        const stride = STRIDE[a.species][Math.round(a.gait)] * sc
        a.phase += (move / stride) * Math.PI * 2
        T.walk = 1
        tailT = g.action === 'avoid' ? 0.25 : 0.95
        if (g.follow || g.action === 'greet') wagT = 0.8
        moving = g.pace === 'run' ? 'run' : 'walk'
        busy = true
        // arrived: jump onto a surface or to a spot it could not walk to
        if (!a.path.length) arrive(a, g, t)
      } else if (g) {
        // ----- task in place -----
        if (!a.arrived) arrive(a, g, t)
        a.speed = 0
        a.gait = approachTo(a.gait, 0, dt * 3)
        if (g.rot != null && g.action !== 'play' && Math.abs(angDiff(a.heading, g.rot)) > 0.03) {
          const turn = Math.max(-TURN * 0.6 * dt, Math.min(TURN * 0.6 * dt, angDiff(a.heading, g.rot)))
          a.heading += turn
          a.phase += Math.abs(turn) * 2.2
          T.walk = Math.min(0.5, Math.abs(angDiff(a.heading, g.rot)))
          busy = true
        }
        if (g.follow) {
          if (t > a.followAt) retarget(a, g, t)
          wagT = a.species === 'dog' ? 0.9 : 0
          tongue = a.species === 'dog'
          lookAtCam = g.follow === 'player'
        }
        const act = g.action
        if (act === 'eat' || act === 'drink' || act === 'sniff') T.eat = 1
        else if (act === 'groom') {
          T.sit = 1
          T.groom = 1
        } else if (act === 'stretch' || act === 'scratch') T.stretch = 1
        else if (act === 'pounce') {
          // crouches, wiggles, pounces forward (once), then sits
          a.pounceT += dt
          if (a.pounceT < 1.8) {
            T.crouch = 1
            tailT = 0.2
          } else if (a.pounceT < 5) {
            const fx = a.x + Math.sin(a.heading) * 0.55
            const fz = a.z + Math.cos(a.heading) * 0.55
            if (isFree(grid, fx, fz)) a.hop = { fx: a.x, fz: a.z, fy: a.y, tx: fx, tz: fz, ty: a.y, t: 0, dur: 0.42, arc: 0.18 }
            a.pounceT = 5
          } else T.sit = 1
          busy = true
        } else if (act === 'play') {
          // at the toy: a dog bows (play invitation) and bounces around it, a cat lies in wait and pounces on it
          a.pounceT += dt
          const toy = g.place ?? g
          const d = Math.hypot(toy.x - a.x, toy.z - a.z)
          if (d > 0.08) a.heading += Math.max(-TURN * dt, Math.min(TURN * dt, angDiff(a.heading, Math.atan2(toy.x - a.x, toy.z - a.z))))
          const dog = a.species === 'dog'
          const cyc = dog ? 1.6 : 2.4
          const at = dog ? 0.9 : 1.6
          const ph = a.pounceT % cyc
          const prev = (a.pounceT - dt) % cyc
          if (ph < at) {
            if (dog) T.stretch = 1
            else T.crouch = 1
          }
          if (ph >= at && prev < at) {
            // a dog to the side around the toy, a cat onto the toy
            const ang = Math.atan2(a.x - toy.x, a.z - toy.z) + (dog ? (a.rnd() < 0.5 ? 1 : -1) * 1.1 : 0)
            const r = dog ? 0.35 + 0.25 * sc : 0.12
            const tx = toy.x + Math.sin(ang) * r
            const tz = toy.z + Math.cos(ang) * r
            if (isFree(grid, tx, tz)) a.hop = { fx: a.x, fz: a.z, fy: a.y, tx, tz, ty: a.y, t: 0, dur: 0.4, arc: dog ? 0.14 : 0.16 }
          }
          if (dog) {
            wagT = 1
            tongue = true
          } else tailT = 0.35
          busy = true
        } else if (act === 'rub') {
          // weaves around the player's legs
          if (player && Math.hypot(player.x - a.x, player.z - a.z) < 1.2) {
            const ang = Math.atan2(a.x - player.x, a.z - player.z) + dt * 1.4
            const nx = player.x + Math.sin(ang) * 0.38
            const nz = player.z + Math.cos(ang) * 0.38
            if (isFree(grid, nx, nz)) {
              const mv = Math.hypot(nx - a.x, nz - a.z)
              a.heading = ang + Math.PI / 2
              a.x = nx
              a.z = nz
              a.phase += (mv / (STRIDE.cat[0] * sc)) * Math.PI * 2
              T.walk = 1
            }
            tailT = 1
            busy = true
          }
        } else if (g.pose === 'sit') T.sit = 1
        else if (g.pose === 'lie') T.lie = 1
        else if (g.pose === 'curl') {
          T.lie = 1
          T.curl = act === 'sleep' || act === 'rest' ? 1 : 0.6
        }
        if (act === 'sleep' && g.pose !== 'curl') {
          T.lie = 1
          T.curl = 1
        }
        if (act === 'watch' || act === 'perch') tailT = 0.4
        // jumps down when the wall is cut away while sitting on the sill
        if (g.place?.kind === 'sill' && t > a.sillAt) {
          a.sillAt = t + 0.5
          if (!sillVisible(g.place)) a.until = 0
        }
      }

      // affection fills up when people are near; the dog wags its tail
      const nearPeople = people.some((p) => Math.hypot(p.x - a.x, p.z - a.z) < 1.5) || Boolean(player && Math.hypot(player.x - a.x, player.z - a.z) < 1.5)
      if (nearPeople && a.species === 'dog' && !a.react) wagT = Math.max(wagT, 0.6)
      a.needs = tickNeeds(a.needs, a.goal?.action ?? 'idle', dt, moving, nearPeople)

      // blends move smoothly toward their targets
      for (const k of BLEND_KEYS) {
        const rate = k === 'jump' ? 9 : k === 'walk' ? 6 : 2.6
        const v = approachTo(a.b[k], T[k], dt * rate)
        if (Math.abs(v - a.b[k]) > 1e-4) busy = true
        a.b[k] = v
      }
      a.wag = approachTo(a.wag, wagT, dt * 2)
      a.tailUp = approachTo(a.tailUp, tailT, dt * 1.5)
      const asleep = a.b.curl > 0.8 && !a.react
      if (!asleep) allAsleep = false

      // looking: at the camera during a reaction and in walk mode, otherwise around now and then
      if (lookAtCam) {
        const cx = state.camera.position.x - a.x
        const cz = state.camera.position.z - a.z
        const yaw = angDiff(a.heading, Math.atan2(cx, cz))
        const pitch = Math.atan2(state.camera.position.y - headY(a), Math.hypot(cx, cz))
        a.lookT = [Math.max(-1.1, Math.min(1.1, yaw)), Math.max(-0.2, Math.min(0.6, pitch))]
      } else if (t > a.lookNext) {
        a.lookT = asleep ? [0, 0] : [(a.rnd() - 0.5) * 1.2, (a.rnd() - 0.3) * 0.35]
        a.lookNext = t + 1.5 + a.rnd() * 4
      }
      a.lookYaw += (a.lookT[0] - a.lookYaw) * Math.min(1, dt * 4)
      a.lookPitch += (a.lookT[1] - a.lookPitch) * Math.min(1, dt * 4)
      if (t > a.blinkNext) {
        a.blinkUntil = t + 0.12
        a.blinkNext = t + 2.5 + a.rnd() * 3.5
      }
      if (t > a.earNext) {
        a.earUntil = t + 0.18
        a.earNext = t + 3 + a.rnd() * 6
      }

      // check that it did not pass through a wall (test): a room change needs a door nearby
      const ri = gridRoom(grid, a.x, a.z)
      if (ri >= 0 && a.roomIdx >= 0 && ri !== a.roomIdx && !a.hop) {
        const nearDoor = w.level.items.some((it) => (it.kind === 'door' || it.kind === 'garageDoor') && Math.hypot(it.x - (a.x + prevX) / 2, it.z - (a.z + prevZ) / 2) < 1.1)
        if (!nearDoor) petsDebug.wallCross += 1
      }
      if (ri >= 0) a.roomIdx = ri

      // drawing
      const r = refs.current.get(a.id)
      if (r) {
        r.root.position.set(a.x, a.y + a.extraY, a.z)
        r.root.rotation.y = a.heading
        const s: PetAnimState = tmpState.current
        Object.assign(s, a.b)
        s.t = t
        s.seed = a.seed
        s.phase = a.phase
        s.gait = a.gait
        s.tailUp = a.tailUp
        s.wag = a.wag
        s.turn = 0
        s.lookYaw = a.lookYaw
        s.lookPitch = a.lookPitch
        s.blink = blink || t < a.blinkUntil
        s.mouth = mouth
        s.tongue = tongue || (a.species === 'dog' && moving === 'run')
        s.earFlick = t < a.earUntil ? 1 : 0
        animatePet(r, s, a.species)
      }
      // bubble: words during a reaction, "z z" when asleep
      const bb = bubbles.current.get(a.id)
      if (bb) {
        const text = a.react ? a.react.plan.bubble : asleep ? 'zz' : ''
        const key = a.react ? `${text}|${a.react.plan.hearts}` : text
        bb.group.visible = Boolean(text)
        if (text) {
          if (bb.key !== key) {
            bb.key = key
            bb.mat.map = text === 'zz' ? bubbleTexture('', false, true) : bubbleTexture(text, a.react?.plan.hearts ?? false)
            bb.mat.needsUpdate = true
          }
          const bob = a.react ? Math.min(1, (t - a.react.t0) * 5) : 1
          bb.group.position.set(a.x, bubbleY(a) + 0.06 * Math.sin(t * 2), a.z)
          // the bubble is ~5% of the screen height (smaller when asleep), the same at any field of view (walk mode 70°)
          const fov = (state.camera as THREE.PerspectiveCamera).fov ?? 50
          // smaller on narrow screens (phones), where the home itself looks small
          const narrow = Math.min(1, (state.size.width / Math.max(1, state.size.height)) * 1.1)
          const k = 2 * Math.tan((fov * Math.PI) / 360) * (text === 'zz' ? 0.045 : 0.08) * bob * narrow
          bb.group.scale.set(k * 2, k, 1)
        }
      }
      out.push({
        id: a.id,
        species: a.species,
        variant: a.variant,
        x: a.x,
        z: a.z,
        y: a.y,
        roomId: ri >= 0 ? w.level.rooms[ri].id : null,
        action: a.goal?.action ?? null,
        label: a.goal ? ACTION_LABEL[a.goal.action] : '',
        pose: a.b.roll > 0.5 ? 'roll' : a.b.lie > 0.5 ? (a.b.curl > 0.5 ? 'curl' : 'lie') : a.b.sit > 0.5 ? 'sit' : a.b.walk > 0.5 ? 'walk' : 'stand',
        moving: moving !== 'still' || a.path.length > 0,
        react: a.react?.plan.kind ?? null,
        bubble: a.react?.plan.bubble ?? null,
        needs: { ...a.needs },
        heading: a.heading,
      })
    }
    petsDebug.pets = out
    // An animal reaching a closed door opens it (scene/doorTraffic.ts), checked five times per second
    if (t - doorAt.current > 0.2) {
      doorAt.current = t
      passDoors(w.level, out.filter((q) => q.moving).map((q) => ({ x: q.x, z: q.z })))
    }
    // frames: a click reaction every frame (instant and smooth); walking, jumping and idle motion at the ambient rate (24 fps,
    // like the robot vacuum), half when all are asleep. No ambient animation in light mode: every frame while walking and in transitions.
    const want = lite || !agents.current.size ? 'none' : allAsleep ? 'slow' : 'full'
    if (want !== ambient.current) {
      if (ambient.current !== 'none') ambientLeave(ambient.current === 'slow')
      if (want !== 'none') ambientEnter(want === 'slow')
      ambient.current = want
    }
    petsDebug.ambient = want
    if (reacting || (lite && busy)) {
      petsDebug.busy += 1
      state.invalidate()
    }
  })

  /** Arrived at the goal: jumps onto the surface or to a spot in a blocked cell, starts the task timer. */
  function arrive(a: Agent, g: PetGoal, t: number) {
    const far = Math.hypot(g.x - a.x, g.z - a.z)
    if ((far > 0.06 || Math.abs(g.y - a.y) > 0.02) && far < 1.4 && !a.hop) {
      const up = g.y - a.y
      a.hop = { fx: a.x, fz: a.z, fy: a.y, tx: g.x, tz: g.z, ty: g.y, t: 0, dur: up > 0.6 ? HOP_T * 1.3 : HOP_T * (up > 0.1 ? 1 : 0.7), arc: Math.max(0.08, up * 0.35) }
      return
    }
    if (g.action === 'zoomies' && a.zoomLeft > 0) {
      a.zoomLeft -= 1
      const grid = world.current.grids[a.species]
      const p = randomSpot(grid, a.rnd, false, gridRoom(grid, a.x, a.z)) ?? randomSpot(grid, a.rnd, false)
      const path = p && findPath(grid, { x: a.x, z: a.z }, p)
      if (p && path) {
        a.goal = { ...g, x: p.x, z: p.z }
        a.path = path
        return
      }
    }
    a.arrived = true
    a.until = t + g.stay
  }

  /** Refreshes the path when the followed person or player moved; stops and sits when close. */
  function retarget(a: Agent, g: PetGoal, t: number) {
    a.followAt = t + 1
    const grid = world.current.grids[a.species]
    const persons = peopleDebug.persons ?? []
    const target = g.follow === 'player' ? (useView.getState().fps ? { x: fpsDebug.x, z: fpsDebug.z } : null) : persons[g.who ?? 0]
    if (!target) {
      a.until = Math.min(a.until, t)
      a.path = []
      a.arrived = true
      return
    }
    const d = Math.hypot(target.x - a.x, target.z - a.z)
    const keep = (g.follow === 'player' ? 0.75 : 0.9) * (a.species === 'dog' ? 1 : 0.6)
    if (d < keep + 0.15) {
      a.path = []
      a.heading += 0
      g.rot = Math.atan2(target.x - a.x, target.z - a.z)
      if (!a.arrived) arrive(a, { ...g, x: a.x, z: a.z, y: a.y }, t)
      return
    }
    const end = a.path[a.path.length - 1]
    if (!end || Math.hypot(end.x - target.x, end.z - target.z) > keep + 0.5) {
      const tx = target.x + ((a.x - target.x) / (d || 1)) * keep
      const tz = target.z + ((a.z - target.z) / (d || 1)) * keep
      const path = findPath(grid, { x: a.x, z: a.z }, { x: tx, z: tz }, a.species === 'dog' && world.current.mode === 'home')
      if (path) {
        g.x = tx
        g.z = tz
        a.path = path
        a.arrived = false
        a.until = Math.max(a.until, t + 4)
      }
    }
  }

  return (
    <>
      {pets.map((it) => (
        <PetNpc key={it.id} id={it.id} look={petLook(it.kind === 'cat' ? 'cat' : 'dog', it.variant)} hooks={hooks} />
      ))}
    </>
  )
}

/* ---------- single animal: body, hit box, bubble ---------- */

interface NpcHooks {
  refs: (id: string, r: PetRefs | null) => void
  proxy: (id: string, o: THREE.Object3D | null) => void
  bubble: (id: string, b: { group: THREE.Sprite; mat: THREE.SpriteMaterial } | null) => void
  poke: (id: string) => void
}

const PROXY = { cat: { size: [0.24, 0.34, 0.62] as const, y: 0.19 }, dog: { size: [0.36, 0.62, 1.05] as const, y: 0.36 } }

function PetNpc({ id, look, hooks }: { id: string; look: PetLook; hooks: NpcHooks }) {
  const [hover, setHover] = useState(false)
  useCursor(hover)
  const register = useMemo(() => (r: PetRefs | null) => hooks.refs(id, r), [hooks, id])
  // always the same size on screen (readable from afar, does not grow in walk mode); drawn in front of walls (readable like a label)
  const bubbleMat = useMemo(() => new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false, sizeAttenuation: false }), [])
  useEffect(() => () => bubbleMat.dispose(), [bubbleMat])
  const P = PROXY[look.species]
  return (
    <>
      <PetBody look={look} register={register}>
        <mesh
          ref={(o) => hooks.proxy(id, o)}
          position={[0, P.y, 0.02]}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            // with the pointer locked in walk mode, Pets' own listener handles the click (crosshair)
            if (document.pointerLockElement) return
            e.stopPropagation()
            if (e.delta > clickSlop(pointerKind.last)) return
            hooks.poke(id)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            if (document.pointerLockElement) return
            setHover(true)
            // The quick pill of an item on the way must not cover the animal (the pointer came to the animal, not to the pill)
            useQuick.getState().dismiss()
          }}
          onPointerOut={() => setHover(false)}
        >
          <boxGeometry args={[...P.size]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </PetBody>
      <sprite ref={(o) => hooks.bubble(id, o ? { group: o, mat: bubbleMat } : null)} material={bubbleMat} center={[0.5, 0]} raycast={noRay} renderOrder={14} visible={false} />
    </>
  )
}

/* ---------- outdoor visitors ---------- */

/** Wait between visitors (s) */
const VISIT_GAP: [number, number] = [30, 90]

function Visitors({ level, night }: { level: Level; night: boolean }) {
  const [plan, setPlan] = useState<{ plan: VisitorPlan; speed: number; id: number } | null>(null)
  const camera = useThree((s) => s.camera)
  const rnd = visitorRnd
  const levelRef = useRef(level)
  const nightRef = useRef(night)
  useEffect(() => {
    levelRef.current = level
    nightRef.current = night
  }, [level, night])

  const spawn = useMemo(
    () => (kind?: VisitorKind, speed = 1, side?: VisitorView['side']) => {
      const lv = levelRef.current
      if (!lv.rooms.length) return false
      const b = lv.rooms.flatMap((r) => [r.x, r.x + r.w])
      const c = lv.rooms.flatMap((r) => [r.z, r.z + r.d])
      const cx = (Math.min(...b) + Math.max(...b)) / 2
      const cz = (Math.min(...c) + Math.max(...c)) / 2
      const view = { x: camera.position.x - cx, z: camera.position.z - cz }
      // a spot visible on screen: near the center so it is not hidden under the cards (right card, bottom bar, top bar)
      const v = new THREE.Vector3()
      const seen = (x: number, z: number) => {
        v.set(x, 0.2, z).project(camera)
        return v.z < 1 && Math.abs(v.x + 0.15) < 0.62 && v.y > -0.62 && v.y < 0.7
      }
      const p = planVisitor(kind ?? pickVisitor(lv, nightRef.current, rnd), lv, { view, seen, side }, rnd)
      if (!p) return false
      setPlan({ plan: p, speed, id: Date.now() })
      petsDebug.visitorsSeen += 1
      return true
    },
    [camera, rnd],
  )

  // timer: when one ends, a new one 30-90 s later
  useEffect(() => {
    if (plan) {
      const id = window.setTimeout(() => setPlan(null), (plan.plan.total / plan.speed) * 1000 + 300)
      return () => window.clearTimeout(id)
    }
    const id = window.setTimeout(() => spawn(), (VISIT_GAP[0] + rnd() * (VISIT_GAP[1] - VISIT_GAP[0])) * 1000)
    return () => window.clearTimeout(id)
  }, [plan, spawn, rnd])

  useEffect(() => {
    petsDebug.forceVisitor = (kind, speed = 1, side) => spawn(kind, speed, side)
    return () => {
      petsDebug.forceVisitor = () => false
      petsDebug.visitor = null
    }
  }, [spawn])
  useEffect(() => {
    if (!plan) petsDebug.visitor = null
  }, [plan])

  if (!plan) return null
  return <Visitor key={plan.id} plan={plan.plan} speed={plan.speed} level={level} />
}

/** Visitor randomness (different on every load) */
const visitorRnd = rng(Math.floor(Math.random() * 1e6) + 1)
/** Small visitors are drawn a bit larger (so they stand out from above; bird ~30 cm, squirrel ~35 cm, butterfly ~25 cm wingspan) */
const SMALL_SCALE: Partial<Record<VisitorKind, number>> = { birds: 1.5, squirrel: 1.5, butterflies: 2 }
const BUTTERFLY_COLORS = ['#f0a63a', '#8f6cf0', '#5fb8e8', '#f27aa8']
const BIRD_KINDS: BirdKind[] = ['sparrow', 'robin', 'tit']

function Visitor({ plan, speed, level }: { plan: VisitorPlan; speed: number; level: Level }) {
  const t0 = useRef<number | null>(null)
  const groups = useRef<(THREE.Group | null)[]>([])
  const wings = useRef<[THREE.Group | null, THREE.Group | null][]>([])
  const tails = useRef<(THREE.Group | null)[]>([])
  const petRefs = useRef<PetRefs | null>(null)
  const heading = useRef<number[]>([])
  const phase = useRef(0)
  const animRef = useRef(restState())
  const look = plan.kind === 'cat' ? CAT_LOOKS.tuxedo : DOG_LOOKS.stray
  const registerPet = useMemo(() => (r: PetRefs | null) => void (petRefs.current = r), [])
  // the ambient rate (24 fps) is enough: they pass calmly
  useAmbient(true)

  useFrame((state, delta) => {
    const now = performance.now() / 1000
    t0.current ??= now
    const t = (now - t0.current) * speed
    const at = visitorAt(plan, t)
    const dt = Math.min(delta, 0.1) * speed
    if (!at) {
      groups.current.forEach((g) => g && (g.visible = false))
      if (petRefs.current) petRefs.current.root.visible = false
      petsDebug.visitor = null
      return
    }
    petsDebug.visitor = { kind: plan.kind, label: VISITOR_LABEL[plan.kind], x: at.x, y: at.y, z: at.z, act: at.act, t, total: plan.total, count: plan.count }
    // fades in at the start, fades out at the end
    const fade = Math.min(1, t / 0.4, (plan.total - t) / 0.5)
    if (plan.kind === 'cat' || plan.kind === 'dog') {
      const r = petRefs.current
      if (r) {
        r.root.visible = true
        const h = heading.current[0] ?? at.heading
        heading.current[0] = h + Math.max(-6 * dt, Math.min(6 * dt, angDiff(h, at.heading)))
        r.root.position.set(at.x, at.y, at.z)
        r.root.rotation.y = heading.current[0]
        r.root.scale.setScalar(look.scale * Math.max(0.001, fade))
        // step phase follows the path speed (so the feet do not slide)
        const st = plan.steps[at.step]
        const pv = plan.steps[at.step - 1]
        const sp = at.moving ? Math.hypot(st.x - pv.x, st.z - pv.z) / Math.max(0.01, st.dur) : 0
        const species: Species = plan.kind === 'cat' ? 'cat' : 'dog'
        const gait = at.act === 'trot' ? 1 : at.act === 'run' ? 2 : 0
        phase.current += ((sp * dt) / (STRIDE[species][gait] * look.scale)) * Math.PI * 2
        const anim = animRef.current
        Object.assign(anim, restState())
        anim.t = now
        anim.seed = 3.3
        anim.walk = at.moving && at.act !== 'jump' ? 1 : 0
        anim.gait = gait
        anim.phase = phase.current
        anim.sit = at.act === 'sit' || at.act === 'groom' ? 1 : 0
        anim.groom = at.act === 'groom' ? 1 : 0
        anim.eat = at.act === 'sniff' ? 1 : 0
        anim.jump = at.act === 'jump' ? 1 : 0
        anim.tailUp = species === 'cat' ? 0.95 : 0.55
        anim.wag = species === 'dog' ? 0.3 : 0
        anim.blink = now % 4 < 0.12
        if (at.act === 'sit') {
          // stops and looks at the camera
          const cx = state.camera.position.x - at.x
          const cz = state.camera.position.z - at.z
          anim.lookYaw = Math.max(-1, Math.min(1, angDiff(heading.current[0], Math.atan2(cx, cz))))
          anim.lookPitch = 0.4
        }
        animatePet(r, anim, species)
      }
    } else {
      for (let i = 0; i < plan.count; i++) {
        const g = groups.current[i]
        if (!g) continue
        g.visible = true
        const ph = plan.seed * 0.001 + i * 2.1
        // in a flock each one is slightly offset and delayed
        const ox = Math.sin(ph * 3.1) * 0.35 * (i ? 1 : 0)
        const oz = Math.cos(ph * 2.3) * 0.35 * (i ? 1 : 0)
        let x = at.x + ox
        let y = at.y
        let z = at.z + oz
        const h0 = heading.current[i] ?? at.heading
        let head = at.heading
        const [wl, wr] = wings.current[i] ?? [null, null]
        let flap = 0
        let fold = 0
        let pitch = 0
        let roll = 0
        if (plan.kind === 'birds') {
          if (at.act === 'fly') {
            flap = Math.sin(now * 26 + i) * 0.9
            pitch = at.y > 0.05 ? -0.15 : 0
            y += Math.sin(now * 3 + i) * 0.05
          } else {
            fold = 1
            if (at.act === 'peck') {
              const peck = Math.max(0, Math.sin(now * 7 + i * 1.7))
              pitch = 0.55 * peck * peck
              head = h0 + Math.sin(now * 0.7 + i) * 0.6
            } else if (at.act === 'hop') y += Math.abs(Math.sin(at.f * Math.PI * 3)) * 0.06
          }
          g.rotation.set(pitch, 0, 0, 'YXZ')
        } else if (plan.kind === 'butterflies') {
          const fl = at.act === 'flutter'
          if (fl) {
            x += Math.sin(now * 1.3 + i * 2) * 0.35
            y += Math.sin(now * 2.1 + i) * 0.15 + 0.1
            z += Math.sin(now * 0.9 + i * 3) * 0.35
            flap = Math.sin(now * 18 + i) * 1.1
            head = Math.atan2(Math.cos(now * 1.3 + i * 2) * 1.3 * 0.35, Math.cos(now * 0.9 + i * 3) * 0.9 * 0.35)
          } else {
            flap = 0.6 + Math.sin(now * 2 + i) * 0.5
            y = 0.48 + i * 0.05
          }
          roll = 0
        } else if (plan.kind === 'squirrel') {
          if (at.act === 'run') y += Math.abs(Math.sin(now * 16)) * 0.05
          if (at.act === 'climb' || (at.act === 'sit' && at.y > 0.3)) {
            pitch = -Math.PI / 2 + 0.2
            const tree = level.items.find((it) => it.kind === 'tree' && Math.hypot(it.x - at.x, it.z - at.z) < 0.6)
            if (tree) head = Math.atan2(tree.x - at.x, tree.z - at.z)
          } else if (at.act === 'sit') pitch = -0.6
          const tl = tails.current[i]
          if (tl) tl.rotation.x = Math.sin(now * (at.act === 'run' ? 14 : 3)) * 0.25
        }
        const hh = h0 + Math.max(-8 * dt, Math.min(8 * dt, angDiff(h0, head)))
        heading.current[i] = hh
        g.position.set(x, y, z)
        g.rotation.set(pitch, hh, roll, 'YXZ')
        g.scale.setScalar(Math.max(0.001, fade) * (SMALL_SCALE[plan.kind] ?? 1))
        if (wl && wr) {
          if (fold) {
            wl.rotation.set(0, Math.PI / 2 - 0.15, -0.2)
            wr.rotation.set(0, -Math.PI / 2 + 0.15, 0.2)
          } else {
            wl.rotation.set(0, 0, flap)
            wr.rotation.set(0, 0, -flap)
          }
        }
      }
    }
  })

  if (plan.kind === 'cat' || plan.kind === 'dog') return <PetBody look={look} register={registerPet} />
  const items = Array.from({ length: plan.count }, (_, i) => i)
  return (
    <>
      {items.map((i) => {
        if (plan.kind === 'birds') {
          const g = birdParts(BIRD_KINDS[(plan.seed + i) % BIRD_KINDS.length])
          return (
            <group key={i} ref={(o) => void (groups.current[i] = o)} visible={false}>
              <mesh geometry={g.body} material={petMaterial} raycast={noRay} />
              <group ref={(o) => void ((wings.current[i] ??= [null, null])[0] = o)} position={[0.03, 0.09, 0]}>
                <mesh geometry={g.wing} material={petMaterial} raycast={noRay} />
              </group>
              <group ref={(o) => void ((wings.current[i] ??= [null, null])[1] = o)} position={[-0.03, 0.09, 0]} scale={[-1, 1, 1]}>
                <mesh geometry={g.wing} material={petMaterial} raycast={noRay} />
              </group>
            </group>
          )
        }
        if (plan.kind === 'butterflies') {
          const g = butterflyParts(BUTTERFLY_COLORS[(plan.seed + i) % BUTTERFLY_COLORS.length])
          return (
            <group key={i} ref={(o) => void (groups.current[i] = o)} visible={false}>
              <mesh geometry={g.body} material={petMaterial} raycast={noRay} />
              <group ref={(o) => void ((wings.current[i] ??= [null, null])[0] = o)}>
                <mesh geometry={g.wing} material={petMaterial} raycast={noRay} />
              </group>
              <group ref={(o) => void ((wings.current[i] ??= [null, null])[1] = o)} scale={[-1, 1, 1]}>
                <mesh geometry={g.wing} material={petMaterial} raycast={noRay} />
              </group>
            </group>
          )
        }
        const g = squirrelParts()
        return (
          <group key={i} ref={(o) => void (groups.current[i] = o)} visible={false}>
            <mesh geometry={g.body} material={petMaterial} raycast={noRay} />
            <group ref={(o) => void (tails.current[i] = o)} position={[0, 0.07, -0.08]}>
              <mesh geometry={g.tail} material={petMaterial} raycast={noRay} />
            </group>
          </group>
        )
      })}
    </>
  )
}
