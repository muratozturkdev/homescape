import type * as THREE from 'three'
import type { Activity } from '@/model/people'
import { LEG, type PropName } from './humanModel'

/*
 * Character motion, so people move realistically and do things instead of standing still. A pure function: from the
 * person's state (walk blend and step phase, sit and lie blend, activity, time) it computes the joint angles and applies
 * them to the skeleton. Components are blended, transitions are smooth:
 * - standing: breathing (chest), weight shift (hips slide sideways, one knee bends slightly), arms swing loosely;
 * - walking: thigh, knee (bends in the swing) and ankle (heel strike, toe push off); the hips rise and fall, rotate and
 *   shift sideways, the torso and shoulders counter rotate, the arms swing with the opposite leg (the elbow bends going
 *   forward), the head stays steady;
 * - sitting: the hips go down onto the seat, the soles rest on the floor, the back leans back; lying: on the back, the
 *   blanket rises with the breath;
 * - activities (people.ts > Activity): phone, book, TV, keyboard, eating, chopping, stirring, washing, brushing teeth,
 *   fridge, folding; looking around when idle; blinking.
 * Joint directions: +x on the x axis swings a limb back (the knee bends backward, the toes point down) and bends the
 * torso and head forward.
 */

export interface HumanRefs {
  root: THREE.Group
  body: THREE.Group
  hips: THREE.Group
  spine: THREE.Group
  chest: THREE.Group
  neck: THREE.Group
  head: THREE.Group
  tail: THREE.Group
  /** [right (x < 0), left] */
  thigh: [THREE.Group, THREE.Group]
  knee: [THREE.Group, THREE.Group]
  foot: [THREE.Group, THREE.Group]
  arm: [THREE.Group, THREE.Group]
  elbow: [THREE.Group, THREE.Group]
  hand: [THREE.Group, THREE.Group]
  lids: [THREE.Object3D, THREE.Object3D]
  props: Record<PropName, THREE.Object3D>
  blanket: THREE.Object3D
  zzz: THREE.Object3D
  shadow: THREE.Object3D
}

/** Thigh length (hip joint to knee) and knee to sole: leg angles of the sitting pose (humanModel > LEG). */
export const THIGH = LEG.thigh
export const SOLE = LEG.shin + LEG.sole
export const HIP_Y = LEG.hip

export interface AnimState {
  /** Seconds (with a per person offset) */
  t: number
  /** Walk blend 0-1 and step phase (radians; one cycle per ~1.3 m) */
  walk: number
  phase: number
  /** Speed factor (0.4-1.2): amplitude of the stride and arm swing */
  pace: number
  /** Sit and lie blend 0-1 */
  sit: number
  lie: number
  seatY: number
  lean: number
  /** Activity and its blend (1 once settled); time since the activity started (s) */
  activity: Activity
  act: number
  actAge: number
  /** Height the hand reaches to when pressing a device (m) */
  reach: number
  /** Head look offset (left-right, up-down; radians) */
  lookYaw: number
  lookPitch: number
  /** Whether the eyes are blinking */
  blink: boolean
  /** Per person seed (so motions are not in sync) */
  seed: number
}

type Pose = Record<(typeof KEYS)[number], number>
const KEYS = [
  'hipX', 'hipY', 'hipZ', 'hipRX', 'hipRY', 'hipRZ',
  'spX', 'spY', 'spZ', 'chX', 'chY', 'chZ', 'nkX', 'hdX', 'hdY', 'hdZ',
  'thNX', 'thNZ', 'thPX', 'thPZ', 'knN', 'knP', 'ftN', 'ftP',
  'arNX', 'arNY', 'arNZ', 'arPX', 'arPY', 'arPZ', 'elN', 'elP', 'elNY', 'elPY',
  'hnNX', 'hnNY', 'hnNZ', 'hnPX', 'hnPY', 'hnPZ',
  'bdX', 'bdY', 'bdZ', 'tlX', 'tlZ',
] as const

const zero = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Moves a toward b by t (in place) */
function blend(a: Pose, b: Pose, t: number) {
  if (t <= 0) return a
  for (const k of KEYS) a[k] = lerp(a[k], b[k], Math.min(1, t))
  return a
}
const smooth = (x: number) => x * x * (3 - 2 * x)
const pos = (x: number) => Math.max(0, x)

/** Standing: breathing, weight shift, loose arms */
function stand(s: AnimState): Pose {
  const p = zero()
  const t = s.t
  const shift = Math.sin(t * 0.33 + s.seed)
  p.hipY = HIP_Y - 0.004 - 0.006 * Math.abs(shift)
  p.hipX = 0.018 * shift
  p.hipRZ = 0.035 * shift
  p.spZ = -0.03 * shift
  p.chZ = -0.015 * shift
  // the weight bearing leg is straight, the other knee bends slightly
  p.knN = 0.03 + 0.07 * pos(shift)
  p.knP = 0.03 + 0.07 * pos(-shift)
  p.thNX = -0.035 * pos(shift)
  p.thPX = -0.035 * pos(-shift)
  p.ftN = -(p.thNX + p.knN)
  p.ftP = -(p.thPX + p.knP)
  p.thNZ = -0.03
  p.thPZ = 0.03
  // breathing: the chest rises slightly
  p.chX = -0.018 * Math.sin(t * 1.7 + s.seed)
  p.nkX = 0.02
  p.arNZ = -0.09
  p.arPZ = 0.09
  p.arNX = 0.03 * Math.sin(t * 0.9 + s.seed)
  p.arPX = -0.03 * Math.sin(t * 0.9 + s.seed + 1)
  p.elN = -0.16
  p.elP = -0.16
  p.hnNX = 0.05
  p.hnPX = 0.05
  return p
}

/** Walk cycle */
function walk(s: AnimState): Pose {
  const p = zero()
  const a = s.phase
  const sn = Math.sin(a)
  const cs = Math.cos(a)
  const amp = s.pace
  // thighs: the right leg is in front when sin > 0
  p.thNX = -0.52 * sn * amp
  p.thPX = 0.52 * sn * amp
  p.thNZ = -0.02
  p.thPZ = 0.02
  // knee: bends a lot in the swing (leg moving forward), a little in the stance
  p.knN = 0.08 + 1.05 * amp * pos(Math.cos(a + 0.6)) ** 1.4
  p.knP = 0.08 + 1.05 * amp * pos(Math.cos(a + Math.PI + 0.6)) ** 1.4
  // foot: sole parallel to the ground in the stance, toes up when reaching forward (heel strike), toes down behind (push off)
  const foot = (th: number, kn: number, swing: number) => -(th + kn) * (1 - swing) + swing * 0.25 - 0.12 * pos(-th) * (1 - swing)
  p.ftN = foot(p.thNX, p.knN, smooth(pos(Math.cos(a + 0.4))))
  p.ftP = foot(p.thPX, p.knP, smooth(pos(Math.cos(a + Math.PI + 0.4))))
  // hips: highest when the legs are vertical, rotate toward the forward leg, shift over the stance leg
  p.hipY = HIP_Y - 0.03 * amp + 0.032 * amp * Math.abs(cs)
  p.hipRY = 0.12 * sn * amp
  p.hipX = 0.02 * cs
  p.hipRZ = 0.045 * cs
  // torso and shoulders rotate against the hips and lean slightly forward; the head stays steady
  p.spX = 0.05 * amp
  p.spY = -0.1 * sn * amp
  p.chY = -0.1 * sn * amp
  p.spZ = -0.03 * cs
  p.hdY = 0.06 * sn * amp
  p.hdX = -0.04
  p.nkX = 0.02
  // arms swing with the opposite leg; the elbow of the forward arm bends more
  p.arNX = 0.48 * sn * amp
  p.arPX = -0.48 * sn * amp
  p.arNZ = -0.1
  p.arPZ = 0.1
  p.elN = -0.25 - 0.55 * pos(-sn) * amp
  p.elP = -0.25 - 0.55 * pos(sn) * amp
  p.hnNX = 0.1
  p.hnPX = 0.1
  // the ponytail swings with the steps
  p.tlX = 0.12 * Math.abs(cs) - 0.04
  p.tlZ = 0.14 * sn * amp
  return p
}

/** Sitting: hips down onto the seat, feet on the floor, back leaning back, hands on the thighs */
function sit(s: AnimState): Pose {
  const p = zero()
  p.hipY = s.seatY + 0.075
  p.hipZ = -0.06
  const knee = s.seatY + 0.05
  const tilt = knee > SOLE ? Math.asin(Math.min((knee - SOLE) / THIGH, 0.6)) : 0
  const reach = knee < SOLE ? Math.acos(Math.max(0, knee / SOLE)) : 0
  p.thNX = p.thPX = -Math.PI / 2 + tilt
  p.thNZ = -0.06
  p.thPZ = 0.06
  p.knN = p.knP = Math.PI / 2 - tilt - reach
  p.ftN = p.ftP = -(p.thNX + p.knN)
  p.spX = -0.06 - s.lean
  p.hdX = s.lean * 0.75
  // the arm keeps its world angle: hands on the thighs
  p.arNX = p.arPX = -0.32 + s.lean
  p.arNZ = -0.08
  p.arPZ = 0.08
  p.elN = p.elP = -0.75
  p.hnNX = p.hnPX = 0.25
  // breathing
  p.chX = -0.015 * Math.sin(s.t * 1.6 + s.seed)
  return p
}

/** Lying: on the back, head toward local -z (headboard), arms at the sides */
function lie(s: AnimState): Pose {
  const p = zero()
  p.bdX = -Math.PI / 2
  p.bdY = s.seatY + 0.11
  p.bdZ = 0.82
  p.hipY = HIP_Y
  p.arNZ = -0.14
  p.arPZ = 0.14
  p.elN = p.elP = -0.12
  p.hdX = -0.12
  p.ftN = p.ftP = 0.4
  p.chX = -0.03 * Math.sin(s.t * 1.1 + s.seed)
  return p
}

/* ---------- activities: move the arms, head and torso into the activity pose ---------- */

/** Prop held for the activity (in the right hand) */
export const PROP_OF: Partial<Record<Activity, PropName>> = { phone: 'phone', read: 'book', cook: 'knife', stir: 'knife', brush: 'brush', tv: 'mug', snack: 'bowl', drink: 'glass' }

/**
 * Activity poses. Arm angles were computed from where the hand must end up (a search over the shoulder, elbow and wrist
 * chain: the hand in front of the chest for the phone, at chest height for a book, on the keyboard at a desk, on the
 * counter, in the sink, at the stove, at the mouth...; the elbow stays at the side below the shoulder). Values are for the
 * right arm (n); the left arm mirrors them (same x, y and z negated).
 */
type Arm = [number, number, number, number]

/**
 * Reaching with the hand (pressing a button, taking a book from a shelf): torso lean, crouch (hip drop) and right arm per
 * height. Values were found by searching the joint chain (hand 0.42 m in front); heights in between blend linearly.
 */
const REACH: [number, number, number, Arm][] = [
  [0.5, 0.35, 0.16, [-0.85, 0, 0.15, -0.05]],
  [0.75, 0.25, 0, [-0.65, 0.3, 0.1, -0.55]],
  [1.0, 0.1, 0, [-0.45, 0.2, 0.1, -1.4]],
  [1.25, 0.04, 0, [-0.9, 0, 0.35, -1.5]],
  [1.5, 0, 0, [-1.75, 0, 0.2, -0.8]],
]
function reachPose(y: number): { lean: number; drop: number; arm: Arm } {
  const i = Math.max(0, Math.min(REACH.length - 2, REACH.findIndex((r) => r[0] > y) - 1))
  const [y0, l0, d0, a0] = REACH[i]
  const [y1, l1, d1, a1] = REACH[i + 1]
  const k = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)))
  return { lean: lerp(l0, l1, k), drop: lerp(d0, d1, k), arm: a0.map((v, j) => lerp(v, a1[j], k)) as Arm }
}

function work(p: Pose, s: AnimState) {
  const t = s.t
  const w = s.act
  const set = (k: keyof Pose, v: number) => (p[k] = lerp(p[k], v, w))
  const add = (k: keyof Pose, v: number) => (p[k] += v * w)
  const armN = ([x, y, z, e]: Arm) => {
    set('arNX', x)
    set('arNY', y)
    set('arNZ', z)
    set('elN', e)
  }
  const armP = ([x, y, z, e]: Arm) => {
    set('arPX', x)
    set('arPY', -y)
    set('arPZ', -z)
    set('elP', e)
  }
  const mixArm = (a: Arm, b: Arm, k: number): Arm => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)]
  const seated = s.sit > 0.5
  switch (s.activity) {
    case 'phone': {
      // the right hand holds the phone in front of the chest, the left supports it from below; head down; the thumb taps now and then
      armN(seated ? [-0.85, 0.4, 0.25, -1.65] : [-0.7, 0.5, 0.2, -2])
      armP(seated ? [-0.75, 0.35, 0.25, -1.5] : [-0.6, 0.45, 0.2, -1.85])
      set('hnNX', 0.25 + 0.06 * pos(Math.sin(t * 9 + s.seed)) * (Math.sin(t * 0.7) > 0 ? 1 : 0))
      set('hdX', 0.42)
      set('nkX', 0.12)
      add('hdY', 0.06 * Math.sin(t * 0.4 + s.seed))
      break
    }
    case 'read': {
      // book in both hands in front of the chest; now and then the right hand turns a page
      const turn = smooth(pos(Math.sin(t * 0.7 + s.seed) - 0.92) / 0.08)
      armN(mixArm([-0.9, 0.4, 0, -1.65], [-0.95, 0.1, 0.35, -1.5], turn))
      armP([-0.9, 0.4, 0, -1.65])
      set('hnNY', 0.3)
      set('hnPY', -0.3)
      set('hdX', 0.4)
      set('nkX', 0.08)
      add('hdY', 0.08 * Math.sin(t * 0.5 + s.seed))
      break
    }
    case 'tv': {
      // watches leaning back, hands in the lap; takes a sip from the mug now and then
      const sip = smooth(pos(Math.sin(t * 0.32 + s.seed) - 0.75) / 0.25)
      add('spX', -0.05)
      armN(mixArm([0, 0.3, -0.15, -1.25], [-1.2, 0.6, 0.2, -1.95], sip))
      armP([0, 0.3, -0.15, -1.25])
      set('hdX', -0.06 + 0.1 * sip)
      break
    }
    case 'snack': {
      // watching TV with the bowl in the right hand in the lap; the left hand takes from the bowl to the mouth, the head tilts slightly; eyes on the TV
      const bite = smooth(pos(Math.sin(t * 1.1 + s.seed) - 0.45) / 0.55)
      // bowl in the lap, opening up (the same arm as the mug in the lap: the shoulder does not lift forward, the bowl does not tilt)
      add('spX', seated ? -0.03 : 0.02)
      armN(seated ? [0.02, 0.3, -0.12, -1.3] : [0.05, 0.25, -0.1, -1.45])
      armP(mixArm([-0.15, 0.45, 0.05, -1.35], [-1.45, 0.6, 0.2, -1.9], bite))
      set('hdX', -0.02 + 0.12 * bite)
      break
    }
    case 'drink': {
      // glass in the right hand in front of the chest; now and then lifts it for a sip, head back
      const sip = smooth(pos(Math.sin(t * 0.55 + s.seed) - 0.55) / 0.45)
      armN(mixArm(seated ? [0, 0.3, -0.15, -1.25] : [0.05, 0.25, -0.1, -1.45], [-1.25, 0.6, 0.2, -1.95], sip))
      armP(seated ? [0, 0.3, -0.15, -1.25] : [0.05, 0.05, -0.1, -0.2])
      set('hdX', 0.05 - 0.2 * sip)
      break
    }
    case 'type': {
      // hands on the keyboard at the desk, fingers press in turn; now and then the right hand goes to the mouse; head toward the screen
      const mouse = smooth(pos(Math.sin(t * 0.25 + s.seed) - 0.6) / 0.4)
      set('spX', seated ? 0.06 : 0.12)
      armN(seated ? [-0.6, 0, 0.2 - 0.18 * mouse, -1.35] : [-0.3, -0.1, 0.2 - 0.18 * mouse, -0.85])
      armP(seated ? [-0.6, 0, 0.2, -1.35] : [-0.3, -0.1, 0.2, -0.85])
      set('hnNX', 0.1 * pos(Math.sin(t * 13 + s.seed)) * (1 - mouse))
      set('hnPX', 0.1 * pos(Math.sin(t * 13 + s.seed + 2.1)))
      set('hdX', 0.12)
      add('hdY', 0.05 * Math.sin(t * 0.6 + s.seed))
      break
    }
    case 'eat': {
      // hands on the table; now and then the right hand brings a bite to the mouth
      const bite = smooth(pos(Math.sin(t * 1.3 + s.seed) - 0.55) / 0.45)
      set('spX', 0.08)
      armN(mixArm([-0.5, 0, 0.2, -1.55], [-1.45, 0.6, 0.2, -1.85], bite))
      armP([-0.5, 0, 0.2, -1.55])
      set('hdX', 0.2 - 0.15 * bite)
      break
    }
    case 'cook': {
      // chops at the counter: the right hand with the knife moves up and down quickly, the left holds; torso leaning forward
      const chop = Math.sin(t * 8 + s.seed)
      set('spX', 0.16)
      armN([-0.3, 0.1, 0.25, -1.55 + 0.22 * chop])
      armP([-0.35, 0, 0.25, -1.45])
      set('hnNX', 0.2 * chop)
      set('hdX', 0.45)
      break
    }
    case 'stir': {
      // stirs the pot at the stove: the right hand circles, the left holds the pot handle
      set('spX', 0.1)
      armN([-0.5 + 0.1 * Math.sin(t * 3 + s.seed), 0.4, -0.05 + 0.1 * Math.cos(t * 3 + s.seed), -1.6])
      armP([-0.35, 0, 0.25, -1.45])
      set('hdX', 0.4)
      break
    }
    case 'wash': {
      // at the sink or the machine: both hands in front, scrubbing
      const rub = Math.sin(t * 5 + s.seed)
      set('spX', 0.2)
      armN([-0.45 + 0.05 * rub, 0.1, 0.25, -1.2])
      armP([-0.45 - 0.05 * rub, 0.1, 0.25, -1.2])
      set('hnNZ', 0.3 * rub)
      set('hnPZ', -0.3 * rub)
      set('hdX', 0.45)
      break
    }
    case 'brush': {
      // brushes teeth at the basin: the right hand at the mouth, the brush moves side to side; the left hand on the basin edge
      set('spX', 0.06)
      armN([-1.4, 0.6 + 0.12 * Math.sin(t * 9 + s.seed), 0.15, -1.85])
      armP([-0.35, 0, 0.25, -1.2])
      set('hnNY', 0.6)
      set('hdX', 0.05)
      break
    }
    case 'fridge': {
      // the right hand holds the door, the left reaches in and back; head inside
      const reach = 0.5 + 0.5 * Math.sin(t * 0.8 + s.seed)
      set('spX', 0.12)
      armN([-0.75, -0.6, -0.1, -1.55])
      armP(mixArm([-0.2, 0, 0.1, -0.4], [-1.25, 0.6, -0.1, -0.95], reach))
      set('hdX', 0.3)
      set('hdY', -0.12)
      break
    }
    case 'press': {
      // reaches to the device and presses its button two or three times, then lowers the hand and looks at the device
      const r = reachPose(s.reach)
      const k = s.actAge < 3.2 ? 1 : Math.max(0, 1 - (s.actAge - 3.2) / 0.6)
      const tap = s.actAge < 3.2 ? pos(Math.sin(s.actAge * 6)) : 0
      const kw = w * k
      const setK = (key: keyof Pose, v: number) => (p[key] = lerp(p[key], v, kw))
      setK('spX', r.lean)
      setK('arNX', r.arm[0])
      setK('arNY', r.arm[1])
      setK('arNZ', r.arm[2])
      setK('elN', r.arm[3] + 0.15 * tap)
      setK('hnNX', -0.15 - 0.25 * tap)
      setK('hdX', 0.25)
      if (r.drop > 0) {
        // low button: crouches (thighs forward, knees bent, soles on the floor)
        const c = r.drop / 0.16
        setK('hipY', p.hipY - r.drop)
        setK('thNX', -0.7 * c)
        setK('thPX', -0.7 * c)
        setK('knN', 1.27 * c)
        setK('knP', 1.27 * c)
        setK('ftN', -0.57 * c)
        setK('ftP', -0.57 * c)
      }
      set('hdX', 0.2)
      break
    }
    case 'browse': {
      // looks over the shelves of the bookcase (the head scans slowly), now and then reaches for a book
      const take = smooth(pos(Math.sin(t * 0.45 + s.seed) - 0.7) / 0.3)
      const r = reachPose(1.25)
      armN(mixArm([0, 0, -0.08, -0.2], r.arm, take))
      set('hdY', 0.35 * Math.sin(t * 0.3 + s.seed))
      set('hdX', -0.05 + 0.15 * Math.sin(t * 0.21 + s.seed))
      set('arPX', 0.25)
      set('elP', -1.1)
      break
    }
    case 'gaze': {
      // looks out of the window or into the aquarium: hands clasped behind, the head moves gently
      armN([0.35, 0, -0.12, -1.0])
      armP([0.35, 0, -0.12, -1.0])
      set('hdY', 0.15 * Math.sin(t * 0.25 + s.seed))
      set('hdX', 0.05)
      break
    }
    case 'fold': {
      // folds laundry at the wardrobe: both hands in front rise and fall together
      const f = Math.sin(t * 2.2 + s.seed)
      set('spX', 0.12)
      armN([-0.3 - 0.15 * f, 0.1, 0.2, -1.55])
      armP([-0.3 - 0.15 * f, 0.1, 0.2, -1.55])
      set('hdX', 0.4)
      break
    }
    default:
      break
  }
}

/** Applies the resulting pose to the skeleton. */
function apply(r: HumanRefs, p: Pose) {
  const [tn, tp] = r.thigh
  const [kn, kp] = r.knee
  const [fn, fp] = r.foot
  const [an, ap] = r.arm
  const [en, ep] = r.elbow
  const [hn, hp] = r.hand
  r.body.rotation.set(p.bdX, 0, 0)
  r.body.position.set(0, p.bdY, p.bdZ)
  r.hips.position.set(p.hipX, p.hipY, p.hipZ)
  r.hips.rotation.set(p.hipRX, p.hipRY, p.hipRZ)
  r.spine.rotation.set(p.spX, p.spY, p.spZ)
  r.chest.rotation.set(p.chX, p.chY, p.chZ)
  r.neck.rotation.set(p.nkX, 0, 0)
  r.head.rotation.set(p.hdX, p.hdY, p.hdZ, 'YXZ')
  r.tail.rotation.set(p.tlX, 0, p.tlZ)
  tn.rotation.set(p.thNX, 0, p.thNZ)
  tp.rotation.set(p.thPX, 0, p.thPZ)
  kn.rotation.set(p.knN, 0, 0)
  kp.rotation.set(p.knP, 0, 0)
  fn.rotation.set(p.ftN, 0, 0)
  fp.rotation.set(p.ftP, 0, 0)
  an.rotation.set(p.arNX, p.arNY, p.arNZ)
  ap.rotation.set(p.arPX, p.arPY, p.arPZ)
  en.rotation.set(p.elN, p.elNY, 0)
  ep.rotation.set(p.elP, p.elPY, 0)
  hn.rotation.set(p.hnNX, p.hnNY, p.hnNZ)
  hp.rotation.set(p.hnPX, p.hnPY, p.hnPZ)
}

/** The person's pose for this frame: blends the components, adds the activity and the gaze, applies it to the skeleton. */
export function animateHuman(r: HumanRefs, s: AnimState) {
  // Base: standing; shifts toward sitting and lying; walking goes on top of standing
  const p = stand(s)
  if (s.sit > 0) blend(p, sit(s), smooth(s.sit))
  if (s.lie > 0) blend(p, lie(s), smooth(s.lie))
  if (s.walk > 0) blend(p, walk(s), smooth(s.walk))
  if (s.act > 0 && s.walk < 0.5) work(p, s)
  // gaze: the head's own offset (small during activities, large when idle)
  p.hdY += s.lookYaw * (1 - s.walk)
  p.hdX += s.lookPitch * (1 - s.walk)
  apply(r, p)
  r.lids[0].visible = r.lids[1].visible = s.blink && s.lie < 0.5
  // held prop; blanket and "z z" while sleeping; no shadow while lying
  const prop = s.act > 0.5 && s.walk < 0.2 ? PROP_OF[s.activity] : undefined
  for (const [name, o] of Object.entries(r.props)) o.visible = name === prop
  r.blanket.visible = s.lie > 0.6
  r.zzz.visible = s.lie > 0.9 && s.activity === 'sleep'
  r.shadow.visible = s.lie < 0.5
  if (r.blanket.visible) {
    r.blanket.position.set(0, s.seatY + 0.2, 0.3)
    r.blanket.scale.y = 1 + 0.04 * Math.sin(s.t * 1.1 + s.seed)
  }
  if (r.zzz.visible) r.zzz.position.set(0.1, s.seatY + 0.45 + 0.03 * Math.sin(s.t * 1.5), -0.82)
}
