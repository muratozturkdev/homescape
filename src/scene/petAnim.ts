import type * as THREE from 'three'
import { FRAME, type Species } from './petModel'

/*
 * Pet motion: the animals move on their own like NPCs. A pure function (like humanAnim.ts): from the animal state (walk blend
 * and step phase, gait, sit, lie, curl up to sleep, groom, stretch, eat, stalking crouch, roll on the back, jump) it computes
 * the joint angles and applies them to the skeleton. Postures are blended, transitions are smooth.
 * - Gait: lateral sequence at a walk (hind left, fore left, hind right, fore right), diagonal pairs at a trot, hind and fore
 *   pairs at a gallop; amplitude and knee lift follow the speed; the body bobs, and rocks back and forth at a gallop.
 * - Tail: a cat's is upright with a curled tip when walking and wrapped around the paws on the ground when sitting; a dog's
 *   wags (fast when happy).
 * - The head looks around, ears twitch, the body breathes (slowly when asleep), eyes blink; meows and barks open the mouth.
 * Joint directions: on legs +x swings the limb back (paw to the rear), on the body (pelvis) -x lifts the front, at the tail
 * base -x raises the tail up and back, z moves it sideways (wag).
 */

export interface PetRefs {
  root: THREE.Group
  body: THREE.Group
  pelvis: THREE.Group
  chest: THREE.Group
  neck: THREE.Group
  head: THREE.Group
  /** [right (x < 0), left] */
  ears: [THREE.Group, THREE.Group]
  /** hind right, hind left, fore right, fore left */
  legs: [THREE.Group, THREE.Group, THREE.Group, THREE.Group]
  knees: [THREE.Group, THREE.Group, THREE.Group, THREE.Group]
  tail: [THREE.Group, THREE.Group, THREE.Group, THREE.Group]
  rump: THREE.Object3D
  chestMesh: THREE.Object3D
  lids: THREE.Object3D
  mouth: THREE.Object3D
  tongue: THREE.Object3D
  shadow: THREE.Object3D
}

export interface PetAnimState {
  t: number
  seed: number
  /** Walk blend 0-1, step phase (radians), gait: 0 walk, 1 trot, 2 gallop */
  walk: number
  phase: number
  gait: number
  /** Posture blends 0-1 */
  sit: number
  lie: number
  /** Curled up asleep (on top of lying) */
  curl: number
  /** Cat grooming (on top of sitting) */
  groom: number
  /** Stretch or play bow */
  stretch: number
  eat: number
  /** Stalking crouch (before pouncing) */
  crouch: number
  /** Rolling on the back */
  roll: number
  /** In the air (jumping) */
  jump: number
  /** Tail raise 0-1, wag 0-1 */
  tailUp: number
  wag: number
  /** Body bend while turning (-1..1) */
  turn: number
  lookYaw: number
  lookPitch: number
  blink: boolean
  /** Mouth opening 0-1 (meow, bark, yawn) */
  mouth: number
  tongue: boolean
  /** Ear twitch 0-1 */
  earFlick: number
}

export const restState = (over: Partial<PetAnimState> = {}): PetAnimState => ({
  t: 0,
  seed: 0,
  walk: 0,
  phase: 0,
  gait: 0,
  sit: 0,
  lie: 0,
  curl: 0,
  groom: 0,
  stretch: 0,
  eat: 0,
  crouch: 0,
  roll: 0,
  jump: 0,
  tailUp: 0.5,
  wag: 0,
  turn: 0,
  lookYaw: 0,
  lookPitch: 0,
  blink: false,
  mouth: 0,
  tongue: false,
  earFlick: 0,
  ...over,
})

const KEYS = [
  'dy', 'rz', 'pitch', 'pz', 'bendX', 'bendY', 'neckX', 'neckY', 'headX', 'headY', 'headZ',
  'l0', 'l1', 'l2', 'l3', 'z0', 'z1', 'z2', 'z3', 'k0', 'k1', 'k2', 'k3',
  't0x', 't0z', 'tcx', 'tcz', 'tipX', 'earX', 'earZ',
] as const
type Pose = Record<(typeof KEYS)[number], number>

const zero = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function blend(a: Pose, b: Pose, t: number) {
  if (t <= 0.0001) return a
  const k = Math.min(1, t)
  for (const key of KEYS) a[key] = lerp(a[key], b[key], k)
  return a
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const TAU = Math.PI * 2

/** Standing: breathing, slight weight shift, head up; a cat's tail raised (tailUp), a dog's half raised. */
function stand(s: PetAnimState, cat: boolean): Pose {
  const p = zero()
  const sway = Math.sin(s.t * 0.4 + s.seed)
  p.pz = 0.02 * sway
  p.k0 = 0.12
  p.k1 = 0.12
  p.l0 = -0.08
  p.l1 = -0.08
  p.k2 = 0.05
  p.k3 = 0.05
  p.neckX = -0.12
  p.headX = 0.1
  if (cat) {
    // tail: upright with the tip curled forward when raised, otherwise hanging back
    p.t0x = lerp(-1.25, -0.25, s.tailUp)
    p.tcx = lerp(0.12, -0.12, s.tailUp)
    p.tipX = lerp(0.1, 0.55, s.tailUp)
    p.t0z = 0.12 * Math.sin(s.t * 0.7 + s.seed)
  } else {
    p.t0x = lerp(-1.55, -0.7, s.tailUp)
    p.tcx = 0.12
    p.tipX = 0.1
  }
  return p
}

/** Walking: leg phases per gait (walk, trot, gallop); amplitude and knee lift grow with speed. */
function walk(s: PetAnimState, cat: boolean, base: Pose): Pose {
  const p = { ...base }
  const g = clamp(s.gait, 0, 2)
  // leg order: hind right, hind left, fore right, fore left
  const WALK = [0, 0.5, 0.25, 0.75]
  const TROT = [0, 0.5, 0.5, 0]
  const RUN = [0, 0.12, 0.55, 0.67]
  const a = g <= 1 ? lerp(0.42, 0.58, g) : lerp(0.58, 0.9, g - 1)
  const b = g <= 1 ? lerp(0.75, 0.95, g) : lerp(0.95, 1.25, g - 1)
  for (let i = 0; i < 4; i++) {
    const off = g <= 1 ? lerp(WALK[i], TROT[i], g) : lerp(TROT[i], RUN[i], g - 1)
    const ph = s.phase + off * TAU
    const swing = -a * Math.sin(ph)
    const lift = b * Math.max(0, Math.cos(ph))
    ;(p as Record<string, number>)[`l${i}`] = swing + (i < 2 ? -0.05 : 0)
    ;(p as Record<string, number>)[`k${i}`] = lift + (i < 2 ? 0.15 : 0.05) * (1 - Math.max(0, Math.cos(ph)))
  }
  // body: bobs slightly at a walk; rocks back and forth and bounds at a gallop
  const run = Math.max(0, g - 1)
  p.dy = -0.012 * Math.abs(Math.sin(s.phase * 2)) * (1 - run) + run * 0.03 * Math.sin(s.phase)
  p.pitch = run * 0.13 * Math.sin(s.phase + 0.6)
  p.bendX = -run * 0.12 * Math.sin(s.phase + 1.2)
  p.pz = 0.025 * Math.sin(s.phase) * (1 - run)
  // keep the head steady: the neck counters the body rocking
  p.neckX = base.neckX - p.pitch * 0.8 + run * 0.12
  // tail: upright with a slight sway on a cat, slightly raised and wagging with the steps on a dog
  if (cat) {
    p.t0x = lerp(base.t0x, -0.5, run)
    p.t0z = 0.12 * Math.sin(s.phase * 0.5)
  } else {
    p.t0x = lerp(base.t0x, -1.1, run)
    p.t0z = 0.18 * Math.sin(s.phase)
  }
  return p
}

/** Sitting: hips on the ground, front of the body raised, forelegs straight, hind legs folded; tail on the ground around the paws. */
function sit(s: PetAnimState, cat: boolean, F: (typeof FRAME)['cat']): Pose {
  const p = zero()
  const front = F.upper + F.lower
  const pitch = Math.asin(clamp((front - F.sitY - (F.shY - F.hipY)) / F.ls, 0.1, 0.95))
  p.dy = F.sitY - F.hipY
  p.pitch = -pitch
  p.l2 = pitch
  p.l3 = pitch
  p.k2 = 0.02
  p.k3 = 0.02
  p.l0 = -1.35 + pitch
  p.l1 = -1.35 + pitch
  p.k0 = 2.5
  p.k1 = 2.5
  p.z0 = -0.2
  p.z1 = 0.2
  p.neckX = pitch * 0.75 - 0.08
  p.headX = pitch * 0.25 + 0.05
  // breathing
  p.bendX = 0.015 * Math.sin(s.t * 1.9 + s.seed)
  if (cat) {
    p.t0x = -1.85 + pitch
    p.t0z = 0.4
    p.tcz = 0.55
    p.tcx = 0.05
    p.tipX = 0.25 + 0.15 * Math.sin(s.t * 0.8 + s.seed)
  } else {
    p.t0x = -1.85 + pitch
    p.tcx = 0.15
    p.tipX = 0.1
  }
  return p
}

/** Lying: belly on the ground; a cat tucks the front paws under the chest (loaf), a dog stretches them forward (sphinx); hind legs to the sides. */
function lie(_s: PetAnimState, cat: boolean, F: (typeof FRAME)['cat']): Pose {
  const p = zero()
  p.dy = F.lieY - F.hipY
  p.pitch = -0.06
  if (cat) {
    p.l2 = 1.3
    p.l3 = 1.3
    p.k2 = -2.85
    p.k3 = -2.85
  } else {
    p.l2 = -0.95
    p.l3 = -0.95
    p.k2 = -0.62
    p.k3 = -0.62
  }
  p.l0 = -1.45
  p.l1 = -1.45
  p.k0 = 2.75
  p.k1 = 2.75
  p.z0 = -0.32
  p.z1 = 0.32
  p.neckX = -0.05
  p.headX = 0.05
  p.t0x = -1.62
  p.t0z = 0.35
  p.tcz = cat ? 0.42 : 0.25
  p.tipX = 0
  return p
}

/** Curled up asleep: a cat turns the head aside onto the tail, the tail wraps forward; a dog rests the head on the paws. */
function curl(s: PetAnimState, cat: boolean, base: Pose): Pose {
  const p = { ...base }
  if (cat) {
    p.rz = 0.18
    p.bendY = 0.42
    p.neckY = 1.15
    p.neckX = 0.45
    p.headX = 0.25
    p.headZ = 0.45
    p.t0z = 0.9
    p.tcz = 0.75
    p.l2 = 1.0
    p.l3 = 1.0
  } else {
    p.rz = 0.2
    p.neckX = 0.62
    p.headX = 0.22
    p.headZ = 0.12
    p.t0z = 0.7
    p.tcz = 0.45
  }
  // slow, deep breathing while asleep
  p.bendX = 0.02 * Math.sin(s.t * 1.1 + s.seed)
  return p
}

/** Cat grooming: sits, lifts a paw and licks it; now and then turns the head and licks its side. */
function groom(s: PetAnimState, base: Pose): Pose {
  const p = { ...base }
  const pitch = -base.pitch
  const flank = Math.sin(s.t * 0.45 + s.seed) > 0.55
  const lick = 0.11 * Math.sin(s.t * 10)
  if (flank) {
    p.neckY = 1.5
    p.neckX = pitch + 0.55
    p.headX = 0.3 + lick
    p.headZ = 0.2
  } else {
    p.l3 = -2.15 + pitch
    p.k3 = 1.95
    p.neckX = pitch * 0.75 + 0.3
    p.neckY = 0.32
    p.headZ = -0.3
    p.headX = 0.2 + lick
  }
  return p
}

/** Stretch (play bow): forelegs reach forward, chest goes down, hips up, tail upright. */
function stretch(s: PetAnimState, F: (typeof FRAME)['cat']): Pose {
  const p = zero()
  p.dy = -0.12 * F.hipY
  p.pitch = 0.38
  p.l2 = -1.45
  p.l3 = -1.45
  p.k2 = 0.1
  p.k3 = 0.1
  p.l0 = -0.25
  p.l1 = -0.25
  p.k0 = 0.2
  p.k1 = 0.2
  p.neckX = -0.75
  p.headX = 0.05
  p.t0x = -0.2
  p.tipX = 0.3
  p.t0z = 0.15 * Math.sin(s.t * 3)
  return p
}

/** Eating or drinking: head bowed to the bowl, bobbing slightly; a cat crouches a little. */
function eat(s: PetAnimState, cat: boolean, base: Pose, F: (typeof FRAME)['cat']): Pose {
  const p = { ...base }
  p.dy = (cat ? -0.22 : -0.08) * F.hipY
  p.k0 = cat ? 0.9 : 0.3
  p.k1 = cat ? 0.9 : 0.3
  p.l0 = cat ? -0.5 : -0.2
  p.l1 = cat ? -0.5 : -0.2
  p.k2 = cat ? 0.6 : 0.15
  p.k3 = cat ? 0.6 : 0.15
  p.l2 = cat ? -0.3 : -0.1
  p.l3 = cat ? -0.3 : -0.1
  p.neckX = cat ? 1.0 : 0.95
  p.headX = 0.35 + 0.08 * Math.sin(s.t * 7)
  return p
}

/** Stalking crouch: body low, hips wiggling (a cat before pouncing), tail tip twitching. */
function crouch(s: PetAnimState, F: (typeof FRAME)['cat']): Pose {
  const p = zero()
  p.dy = -0.36 * F.hipY
  p.pitch = 0.04
  p.l0 = -0.75
  p.l1 = -0.75
  p.k0 = 1.5
  p.k1 = 1.5
  p.l2 = -0.55
  p.l3 = -0.55
  p.k2 = 1.15
  p.k3 = 1.15
  p.z2 = -0.15
  p.z3 = 0.15
  p.pz = 0.12 * Math.sin(s.t * 13)
  p.neckX = 0.15
  p.headX = -0.15
  p.t0x = -1.5
  p.tipX = 0.5 * Math.sin(s.t * 9)
  return p
}

/** Rolling on the back: the body turns over, paws in the air sway gently, head tilted to the side. */
function roll(s: PetAnimState, F: (typeof FRAME)['cat']): Pose {
  const p = zero()
  p.dy = F.lieY - F.hipY + 0.01
  p.rz = 2.75
  const w = 0.2 * Math.sin(s.t * 3)
  p.l0 = -1.0 + w
  p.l1 = -1.0 - w
  p.k0 = 1.4
  p.k1 = 1.4
  p.l2 = -1.25 - w
  p.l3 = -1.25 + w
  p.k2 = 1.6
  p.k3 = 1.6
  p.neckX = -0.25
  p.headZ = 0.45
  p.t0x = -1.6
  p.tcz = 0.3
  return p
}

/** Jumping: legs tucked, tail stretched back. */
function jump(base: Pose): Pose {
  const p = { ...base }
  p.l0 = -0.85
  p.l1 = -0.85
  p.k0 = 1.3
  p.k1 = 1.3
  p.l2 = -0.95
  p.l3 = -0.95
  p.k2 = 1.0
  p.k3 = 1.0
  p.pitch = -0.15
  p.t0x = -1.35
  return p
}

/** Computes the animal's pose for this frame and applies it to the skeleton. */
export function animatePet(r: PetRefs, s: PetAnimState, species: Species) {
  const cat = species === 'cat'
  const F = FRAME[species]
  let p = stand(s, cat)
  if (s.walk > 0.001) p = blend(p, walk(s, cat, p), s.walk)
  if (s.sit > 0.001) {
    let sp = sit(s, cat, F)
    if (s.groom > 0.001) sp = blend(sp, groom(s, sp), s.groom)
    p = blend(p, sp, s.sit)
  }
  if (s.lie > 0.001) {
    let lp = lie(s, cat, F)
    if (s.curl > 0.001) lp = blend(lp, curl(s, cat, lp), s.curl)
    p = blend(p, lp, s.lie)
  }
  if (s.eat > 0.001) p = blend(p, eat(s, cat, p, F), s.eat)
  if (s.stretch > 0.001) p = blend(p, stretch(s, F), s.stretch)
  if (s.crouch > 0.001) p = blend(p, crouch(s, F), s.crouch)
  if (s.roll > 0.001) p = blend(p, roll(s, F), s.roll)
  if (s.jump > 0.001) p = blend(p, jump(p), s.jump)

  // looking around (off while asleep); the body bends while turning
  const awake = 1 - s.curl
  p.neckY += clamp(s.lookYaw, -1.1, 1.1) * 0.6 * awake + s.turn * 0.25
  p.headY += clamp(s.lookYaw, -1.1, 1.1) * 0.4 * awake
  p.neckX -= clamp(s.lookPitch, -0.6, 0.6) * 0.5 * awake
  p.headX -= clamp(s.lookPitch, -0.6, 0.6) * 0.5 * awake
  p.bendY += s.turn * 0.22
  // the head lifts slightly when the mouth opens (meow, bark)
  p.neckX -= s.mouth * 0.18
  p.headX -= s.mouth * 0.12

  // tail wag: fast on a dog, a slow sway on a cat
  const wagHz = cat ? 1.4 : 7 + s.wag * 4
  p.t0z += s.wag * (cat ? 0.35 : 0.75) * Math.sin(s.t * wagHz * TAU * 0.5)

  // ears: twitching, and pinned back when running
  p.earZ = s.earFlick * 0.5
  p.earX = cat ? Math.max(0, s.gait - 1) * 0.4 : Math.max(0, s.gait - 0.6) * 0.6 + s.jump * 0.5

  apply(r, p, s, cat)
}

function apply(r: PetRefs, p: Pose, s: PetAnimState, cat: boolean) {
  const F = cat ? FRAME.cat : FRAME.dog
  r.body.position.y = F.hipY + p.dy
  r.body.rotation.z = p.rz
  r.pelvis.rotation.set(p.pitch, 0, p.pz)
  r.chest.rotation.set(p.bendX, p.bendY, 0)
  r.neck.rotation.set(p.neckX, p.neckY, 0)
  r.head.rotation.set(p.headX, p.headY, p.headZ)
  const L = [p.l0, p.l1, p.l2, p.l3]
  const Z = [p.z0, p.z1, p.z2, p.z3]
  const K = [p.k0, p.k1, p.k2, p.k3]
  for (let i = 0; i < 4; i++) {
    r.legs[i].rotation.set(L[i], 0, Z[i])
    r.knees[i].rotation.x = K[i]
  }
  r.tail[0].rotation.set(p.t0x, 0, p.t0z)
  for (let i = 1; i < 4; i++) r.tail[i].rotation.set(p.tcx + (i === 3 ? p.tipX : 0) + (i === 2 ? p.tipX * 0.5 : 0), 0, p.tcz)
  // ears: a cat's twitch outward, a dog's floppy ears swing back
  const ez = cat ? 0.32 : 0
  r.ears[0].rotation.set(p.earX, 0, ez + p.earZ)
  r.ears[1].rotation.set(p.earX, 0, -ez - p.earZ * 0.6)
  // breathing: the body swells slightly (slowly when asleep)
  const br = 1 + 0.025 * Math.sin(s.t * (s.curl > 0.5 ? 1.1 : 2.2) + s.seed)
  r.rump.scale.set(br, br, 1)
  r.chestMesh.scale.set(br, br, 1)
  r.lids.visible = s.blink || s.curl > 0.6
  r.mouth.visible = s.mouth > 0.3
  r.tongue.visible = s.tongue && s.mouth < 0.3
  // soft ground shadow: widens when lying, shrinks in the air
  const spread = 1 + s.lie * 0.25 + s.roll * 0.2
  r.shadow.scale.set(spread * (1 - s.jump * 0.3), spread * (1 - s.jump * 0.3), 1)
}
