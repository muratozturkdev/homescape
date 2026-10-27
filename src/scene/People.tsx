import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { play } from '@/audio/engine'
import { stepAt } from '@/audio/floor'
import { passDoors } from './doorTraffic'
import { useHa } from '@/ha/store'
import { besideDoor, frontDoor } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { planPeople, route, type Activity, type PeoplePlan, type Pose, type Spot } from '@/model/people'
import type { Level } from '@/model/types'
import { useView } from './camera'
import { markShadows } from './frame'
import { Human } from './Human'
import { animateHuman, type HumanRefs } from './humanAnim'
import { LOOKS } from './humanModel'
import { useAmbient } from './kit/effects'

/*
 * People in the home (logic in model/people.ts): one person per spot of the plan; when the spot changes they walk through
 * the doors and, on arrival, sit, lie down or stand. In view mode and when enabled (useView.people). Four person slots are
 * always drawn; visibility and position are set every frame through refs (no React state). Clicks pass through.
 * Motion: they speed up when walking and slow down in bends and on arrival, the body turns smoothly toward the heading
 * (stepping when turning in place); they stop in front of the seat, turn around and sit down, and stand up first when
 * leaving; once settled they do their activity (humanAnim.ts), look around and blink. At the ambient rate when idle
 * (24 fps; none in light mode), every frame while walking.
 */

const MAX = 4
/** Walking speed (m/s), acceleration (m/s²), step cycle (m; two steps) */
const SPEED = 1.25
const ACCEL = 3
const STRIDE = 1.3
/** Body turn rate (rad/s) and sit down or stand up time (s) */
const TURN = 6
const SIT_TIME = 0.9

interface Walker {
  x: number
  z: number
  /** Heading of the body (turns smoothly) */
  heading: number
  path: { x: number; z: number }[]
  target: Spot
  /** Where the person stops before sitting or lying down (in front of the seat, beside the bed) and the seat itself */
  app: { x: number; z: number }
  seat: { x: number; z: number; y: number; lean: number } | null
  from: { x: number; z: number } | null
  stride: number
  speed: number
  walk: number
  sit: number
  lie: number
  act: number
  /** When the activity started (seconds, clock) */
  actSince: number
  activity: Activity
  look: { yaw: number; pitch: number; tYaw: number; tPitch: number; next: number }
  blink: { next: number; until: number }
  seed: number
  /** Index of the last step (footstep sound: one per half of the walk cycle) */
  foot: number
}

/** Test and debug (window.__homescape.people()): the last plan and each person's position, pose and activity. */
export const peopleDebug: { plan: PeoplePlan | null; persons: { x: number; z: number; pose: Pose; walking: boolean; roomId: string | null; activity: Activity; heading: number; act: number }[] } = { plan: null, persons: [] }

const same = (a: Spot | undefined, b: Spot) => Boolean(a) && Math.abs(a!.x - b.x) < 0.01 && Math.abs(a!.z - b.z) < 0.01 && a!.pose === b.pose

/** Outside of the front door (45 cm outside the wall; may be a porch or garden): people arriving later enter here. */
function entrance(level: Level) {
  const f = frontDoor(level.items, level.rooms)
  return f ? besideDoor(f.door, -f.side, 0.45) : null
}

/** Point to stop at before reaching the spot: 42 cm in front of the seat (the person turns their back to it), the near side of the bed. */
function approach(s: Spot, from: { x: number; z: number }) {
  if (s.pose === 'sit') return { x: s.x + Math.sin(s.rot) * 0.42, z: s.z + Math.cos(s.rot) * 0.42 }
  if (s.pose === 'lie') {
    const ax = Math.cos(s.rot)
    const az = -Math.sin(s.rot)
    const side = (from.x - s.x) * ax + (from.z - s.z) * az >= 0 ? 1 : -1
    return { x: s.x + ax * 0.75 * side, z: s.z + az * 0.75 * side }
  }
  return { x: s.x, z: s.z }
}

/** Shortest angle difference from a to b */
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
const approachTo = (v: number, to: number, step: number) => (Math.abs(to - v) <= step ? to : v + Math.sign(to - v) * step)
const ease = (x: number) => x * x * (3 - 2 * x)
/** Repeatable per person random number */
const rnd = (seed: number, n: number) => {
  const v = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453
  return v - Math.floor(v)
}

function newWalker(s: Spot, start: { x: number; z: number }, seated: boolean, i: number): Walker {
  const app = approach(s, start)
  const w: Walker = {
    x: start.x,
    z: start.z,
    heading: s.rot,
    path: [],
    target: s,
    app,
    seat: null,
    from: null,
    stride: 0,
    speed: 0,
    walk: 0,
    sit: 0,
    lie: 0,
    act: 0,
    actSince: 0,
    activity: s.activity ?? 'idle',
    look: { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, next: 0 },
    blink: { next: 1 + i, until: 0 },
    seed: i * 1.7 + 0.3,
    foot: 0,
  }
  // On first load everyone is already in place and at their activity
  if (seated) {
    w.x = s.x
    w.z = s.z
    w.act = 1
    if (s.pose !== 'stand') {
      w.seat = { x: s.x, z: s.z, y: s.y, lean: s.lean ?? 0 }
      w.from = app
      if (s.pose === 'sit') w.sit = 1
      else w.lie = 1
    }
  }
  return w
}

/** One person's motion for this frame; true while moving or transitioning. */
function step(w: Walker, dt: number, t: number): boolean {
  const T = w.target
  const seated = w.sit > 0.001 || w.lie > 0.001
  const leaving = seated && (w.path.length > 0 || !w.seat || Math.abs(w.seat.x - T.x) > 0.01 || Math.abs(w.seat.z - T.z) > 0.01)
  let busy = false
  if (leaving) {
    // Stands up first (from the seat to the point in front of it)
    w.sit = Math.max(0, w.sit - dt / SIT_TIME)
    w.lie = Math.max(0, w.lie - dt / SIT_TIME)
    w.act = Math.max(0, w.act - dt * 4)
    const k = ease(Math.max(w.sit, w.lie))
    if (w.seat && w.from) {
      w.x = w.from.x + (w.seat.x - w.from.x) * k
      w.z = w.from.z + (w.seat.z - w.from.z) * k
    }
    if (w.sit === 0 && w.lie === 0) w.seat = null
    return true
  }
  if (w.path.length) {
    const p = w.path[0]
    const dx = p.x - w.x
    const dz = p.z - w.z
    const d = Math.hypot(dx, dz)
    const dir = Math.atan2(dx, dz)
    const off = Math.abs(angDiff(w.heading, dir))
    w.heading += Math.max(-TURN * dt, Math.min(TURN * dt, angDiff(w.heading, dir)))
    // Slows down in bends and when approaching the last point
    let left = d
    for (let k = 1; k < w.path.length; k++) left += Math.hypot(w.path[k].x - w.path[k - 1].x, w.path[k].z - w.path[k - 1].z)
    const want = Math.min(SPEED * (off > 0.9 ? 0.45 : 1), Math.max(0.35, left * 1.6))
    w.speed = approachTo(w.speed, want, ACCEL * dt)
    const move = Math.min(d, w.speed * dt)
    if (d > 1e-4) {
      w.x += (dx / d) * move
      w.z += (dz / d) * move
    }
    if (d - move < 1e-3) w.path.shift()
    w.stride += (move / STRIDE) * Math.PI * 2
    w.walk = Math.min(1, w.walk + dt * 5)
    w.act = Math.max(0, w.act - dt * 4)
    return true
  }
  // Arrived: stops, turns to the heading (stepping in place while turning), sits or lies down, then starts the activity
  w.speed = 0
  const off = angDiff(w.heading, T.rot)
  const turning = Math.abs(off) > 0.03
  if (turning) {
    const turn = Math.max(-TURN * 0.8 * dt, Math.min(TURN * 0.8 * dt, off))
    w.heading += turn
    w.stride += Math.abs(turn) * 1.6
    busy = true
  }
  const shuffle = turning ? Math.min(0.35, Math.abs(off)) : 0
  w.walk = approachTo(w.walk, shuffle, dt * 4)
  if (w.walk > 0.001) busy = true
  if (Math.abs(off) < 0.15 && T.pose !== 'stand' && w.walk < 0.2) {
    if (!w.seat) {
      w.seat = { x: T.x, z: T.z, y: T.y, lean: T.lean ?? 0 }
      w.from = { x: w.x, z: w.z }
    }
    if (T.pose === 'sit' && w.sit < 1) {
      w.sit = Math.min(1, w.sit + dt / SIT_TIME)
      busy = true
    }
    if (T.pose === 'lie' && w.lie < 1) {
      w.lie = Math.min(1, w.lie + dt / SIT_TIME)
      busy = true
    }
    const k = ease(Math.max(w.sit, w.lie))
    w.x = w.from!.x + (w.seat.x - w.from!.x) * k
    w.z = w.from!.z + (w.seat.z - w.from!.z) * k
  }
  // Settled: activity (if it changed, drops the old one first and switches to the new one)
  const settled = T.pose === 'stand' ? !turning && w.walk < 0.05 : Math.max(w.sit, w.lie) > 0.99
  const next = T.activity ?? 'idle'
  if (next !== w.activity) {
    w.act = Math.max(0, w.act - dt * 3)
    if (w.act === 0) {
      w.activity = next
      w.actSince = t
    }
    busy = true
  } else if (settled && w.act < 1) {
    if (w.act === 0) w.actSince = t
    w.act = Math.min(1, w.act + dt * 1.6)
    busy = true
  }
  // Looking around and blinking
  if (t > w.look.next) {
    const free = w.activity === 'idle' || w.activity === 'tv' ? 1 : 0.25
    w.look.tYaw = (rnd(w.seed, t) - 0.5) * 1.1 * free
    w.look.tPitch = (rnd(w.seed + 3, t) - 0.4) * 0.25 * free
    w.look.next = t + 2 + rnd(w.seed + 7, t) * 4
  }
  w.look.yaw += (w.look.tYaw - w.look.yaw) * Math.min(1, dt * 2.5)
  w.look.pitch += (w.look.tPitch - w.look.pitch) * Math.min(1, dt * 2.5)
  if (t > w.blink.next) {
    w.blink.until = t + 0.13
    w.blink.next = t + 2.5 + rnd(w.seed + 11, t) * 3.5
  }
  return busy
}

function Crowd({ plan, level }: { plan: PeoplePlan; level: Level }) {
  const walkers = useRef<(Walker | null)[]>(Array(MAX).fill(null))
  const refs = useRef<(HumanRefs | null)[]>(Array(MAX).fill(null))
  const registers = useMemo(() => Array.from({ length: MAX }, (_, i) => (r: HumanRefs | null) => void (refs.current[i] = r)), [])
  const invalidate = useThree((s) => s.invalidate)
  // Idle people still breathe, look around and do their activity: frames at the ambient rate
  useAmbient(true)

  // When the plan changes: give each spot to the nearest person (someone already there stays), set up a walking route if needed
  useEffect(() => {
    const ws = walkers.current
    const firstTime = ws.every((w) => !w)
    const door = entrance(level)
    const spots = plan.spots.slice(0, MAX)
    const free = new Set(ws.map((w, i) => (w ? i : -1)).filter((i) => i >= 0))
    const assigned = new Set<number>()
    for (const s of spots) {
      let best = -1
      let bd = Infinity
      for (const i of free) {
        const w = ws[i]!
        const d = same(w.target, s) ? -1 : Math.hypot(w.x - s.x, w.z - s.z)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (best < 0) {
        // New person: in place on first load, entering through the front door when arriving later
        best = ws.findIndex((w, i) => !w && !assigned.has(i))
        if (best < 0) continue
        const start = firstTime || !door ? { x: s.x, z: s.z } : door
        const w = newWalker(s, start, firstTime || !door, best)
        if (!firstTime && door) w.path = route(level, start, { ...s, ...w.app })
        ws[best] = w
      } else {
        free.delete(best)
        const w = ws[best]!
        if (!same(w.target, s)) {
          // Someone getting up from the toilet flushes it
          if (w.target.use === 'toilet' && w.sit > 0.5) play('flush', { x: w.target.x, y: 0.5, z: w.target.z })
          // If sitting, sets off from the point where they stand up
          const from = w.from && (w.sit > 0 || w.lie > 0) ? w.from : { x: w.x, z: w.z }
          w.target = s
          w.app = approach(s, from)
          w.path = route(level, from, { ...s, ...w.app })
        } else w.target = s
      }
      assigned.add(best)
    }
    // People dropped from the plan disappear
    ws.forEach((_, i) => {
      if (!assigned.has(i)) ws[i] = null
    })
    peopleDebug.plan = plan
    invalidate()
  }, [plan, level, invalidate])

  const doorAt = useRef(0)
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const t = state.clock.elapsedTime
    let moving = false
    walkers.current.forEach((w, i) => {
      const r = refs.current[i]
      if (!r) return
      r.root.visible = Boolean(w)
      if (!w) return
      moving = step(w, dt, t) || moving
      // Footstep sound: on each half of the walk cycle (quieter when turning in place)
      const foot = Math.floor(w.stride / Math.PI)
      if (foot !== w.foot) {
        if (w.walk > 0.25) stepAt(level, w.x, w.z, { gain: w.path.length ? 0.45 : 0.2 })
        w.foot = foot
      }
      r.root.position.set(w.x, 0, w.z)
      r.root.rotation.y = w.heading
      const seat = w.seat ?? { y: w.target.y, lean: w.target.lean ?? 0 }
      animateHuman(r, {
        t: t + w.seed * 10,
        walk: w.walk,
        phase: w.stride + i,
        pace: Math.max(0.45, Math.min(1.15, w.speed / SPEED + (w.path.length ? 0 : 0.5))),
        sit: w.sit,
        lie: w.lie,
        seatY: seat.y,
        lean: seat.lean,
        activity: w.activity,
        act: w.act,
        actAge: t - w.actSince,
        reach: w.target.reach ?? 1,
        lookYaw: w.look.yaw,
        lookPitch: w.look.pitch,
        blink: t < w.blink.until,
        seed: w.seed,
      })
    })
    // A person reaching a closed door opens it (scene/doorTraffic.ts), checked five times per second
    if (t - doorAt.current > 0.2 || t < doorAt.current) {
      doorAt.current = t
      passDoors(level, walkers.current.flatMap((w) => (w && w.path.length ? [{ x: w.x, z: w.z }] : [])))
    }
    peopleDebug.persons = walkers.current.flatMap((w) =>
      w
        ? [
            {
              x: w.x,
              z: w.z,
              pose: (w.sit > 0.5 ? 'sit' : w.lie > 0.5 ? 'lie' : 'stand') as Pose,
              walking: w.path.length > 0,
              roomId: w.target.roomId,
              activity: w.activity,
              heading: w.heading,
              act: w.act,
            },
          ]
        : [],
    )
    // Every frame while walking and sitting down (the shadow with it), at the ambient rate when idle
    if (moving) {
      markShadows(1)
      state.invalidate()
    }
  })

  return (
    <>
      {LOOKS.slice(0, MAX).map((look, i) => (
        <Human key={i} look={look} register={registers[i]} />
      ))}
    </>
  )
}

/** The people plan (alarm mode, motion sensors, household, time). Used by the scene and the People panel in the toolbar. */
export function usePeoplePlan() {
  const residents = useView((s) => s.residents)
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  const registry = useHa((s) => s.registry)
  // Clock for the wait after motion ends and for bedtime (every 15 s)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  const alarm = useMemo(() => Object.values(entities).find((e) => e.entity_id.startsWith('alarm_control_panel.'))?.state, [entities])
  const plan = useMemo(() => (level ? planPeople({ level, entities, registry, alarm, now, residents }) : null), [level, entities, registry, alarm, now, residents])
  return { plan, level }
}

/** Draws the people (in view mode, when enabled). */
export function People() {
  const show = useView((s) => s.people)
  const mode = useLayout((s) => s.mode)
  const { plan, level } = usePeoplePlan()
  const visible = show && mode === 'view' && Boolean(plan && level)
  useEffect(() => {
    if (visible) return
    peopleDebug.plan = show ? plan : null
    peopleDebug.persons = []
  }, [visible, show, plan])
  if (!visible || !plan || !level) return null
  return <Crowd plan={plan} level={level} />
}
