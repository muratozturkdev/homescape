import { useFrame, useThree } from '@react-three/fiber'
import type CameraControlsImpl from 'camera-controls'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { bounds } from '@/model/geometry'
import { activeHomeId, activeLevel, FLOOR_H, useLayout } from '@/model/layoutStore'
import type { Layout } from '@/model/types'
import { registerHomeFlight, type FlightRequest } from '@/ui/homeSwitch'
import { cameraApi, flightDebug, homeFlight, useView } from './camera'

/*
 * Flight between homes (ui/homeSwitch.ts): the camera flies up and over to the other home, which stays unseen until the
 * switch. Homes behave as if they stood side by side in one world, but only the active home is drawn:
 * 1. Take-off: the camera rises, tilts close to a bird's eye view, turns to the home's default heading and glides sideways
 *    with increasing speed (next home to the right, previous to the left). The path is just long enough for the old home
 *    (with its shadow and roof) to leave the frame completely.
 * 2. Switch: the home changes while the old one is out of frame. The ground has the same color everywhere, so the camera
 *    is moved to the new home's coordinates (the new home sits just outside the frame, in the travel direction); no jump
 *    shows on screen. Until this moment the new home is not in the scene.
 * 3. Landing: the camera slows down, glides to the new home, descends and settles into the home's usual framing.
 * During the flight the user's camera input is off and framing requests (CameraRig) wait.
 */

/** Take-off and landing durations (s) */
const OUT_S = 1.1
const IN_S = 1.5
/** Tilt at the top, close to a bird's eye view (radians, 0 is straight down) */
const PEAK_POLAR = 0.35
/** Empty ground crossed between the old home leaving and the new home entering (m) */
const GAP = 4

interface Pose {
  tx: number
  ty: number
  tz: number
  d: number
  polar: number
  az: number
  fx: number
  fy: number
}

interface Flight {
  req: FlightRequest
  stage: 'out' | 'cruise' | 'in'
  t: number
  from: Pose
  peak: { d: number; polar: number; az: number }
  ux: number
  uz: number
  /** Horizontal distance during take-off (m) and the speed at the top (m/s) */
  A: number
  v: number
  /** Extra distance when the old home is still in frame after take-off (m) */
  extra: number
  /** Horizontal distance during landing (m), the arrival framing and the heading at the start of the landing */
  B: number
  to: Pose | null
  az0: number
  restore: { enabled: boolean; maxDistance: number }
  t0: number
}

const sstep = (x: number) => x * x * (3 - 2 * x)
const wrap = (a: number) => {
  const r = (a + Math.PI) % (Math.PI * 2)
  return (r < 0 ? r + Math.PI * 2 : r) - Math.PI
}

const sph = new THREE.Spherical()
const off = new THREE.Vector3()
const probe = new THREE.PerspectiveCamera()
const frustum = new THREE.Frustum()
const mat = new THREE.Matrix4()
const v0 = new THREE.Vector3()
const v1 = new THREE.Vector3()

/** Box the home takes in the scene: rooms of all floors, from the top floor up to the roof; with a margin for shadows and eaves */
function homeBox(layout: Layout | null, out: THREE.Box3) {
  const levels = layout?.levels ?? []
  const b = bounds(levels.flatMap((l) => l.rooms))
  const elev = Math.max(0, ...levels.map((l) => l.elevation ?? 0))
  const top = (elev + 1) * FLOOR_H + 4
  const pad = 2 + top * 0.3
  return out.set(v0.set(b.minX - pad, -elev * FLOOR_H - 0.5, b.minZ - pad), v1.set(b.maxX + pad, top, b.maxZ + pad))
}

/** Whether the camera sees the box in this pose (without focus offset) */
function sees(real: THREE.PerspectiveCamera, tx: number, ty: number, tz: number, d: number, polar: number, az: number, box: THREE.Box3) {
  probe.fov = real.fov
  probe.aspect = real.aspect
  probe.near = real.near
  probe.far = real.far
  probe.zoom = real.zoom
  probe.updateProjectionMatrix()
  off.setFromSpherical(sph.set(d, polar, az))
  probe.position.set(tx + off.x, ty + off.y, tz + off.z)
  probe.lookAt(tx, ty, tz)
  probe.updateMatrixWorld()
  return frustum.setFromProjectionMatrix(mat.multiplyMatrices(probe.projectionMatrix, probe.matrixWorldInverse)).intersectsBox(box)
}

/** Whether the real camera sees the box right now */
function seesNow(real: THREE.PerspectiveCamera, box: THREE.Box3) {
  real.updateMatrixWorld()
  return frustum.setFromProjectionMatrix(mat.multiplyMatrices(real.projectionMatrix, real.matrixWorldInverse)).intersectsBox(box)
}

/** Shortest s at which the box leaves the frame in the top pose with target (x, z) + u*s (in half meter steps) */
function clearance(real: THREE.PerspectiveCamera, x: number, z: number, ux: number, uz: number, peak: Flight['peak'], box: THREE.Box3) {
  for (let s = 0; s < 800; s += 0.5) if (!sees(real, x + ux * s, 0, z + uz * s, peak.d, peak.polar, peak.az, box)) return s
  return 800
}

function current(c: CameraControlsImpl): Pose {
  const t = c.getTarget(v0, false)
  const f = c.getFocalOffset(v1, false)
  return { tx: t.x, ty: t.y, tz: t.z, d: c.distance, polar: c.polarAngle, az: c.azimuthAngle, fx: f.x, fy: f.y }
}

function poseOf(f: ReturnType<typeof cameraApi.framePose>): Pose {
  const [tx, ty, tz] = f.target
  const dx = f.position[0] - tx
  const dy = f.position[1] - ty
  const dz = f.position[2] - tz
  const d = Math.hypot(dx, dy, dz)
  return { tx, ty, tz, d, polar: Math.acos(dy / d), az: Math.atan2(dx, dz), fx: f.focal[0], fy: f.focal[1] }
}

function put(c: CameraControlsImpl, p: Pose) {
  void c.moveTo(p.tx, p.ty, p.tz, false)
  void c.rotateTo(p.az, p.polar, false)
  void c.dollyTo(p.d, false)
  void c.setFocalOffset(p.fx, p.fy, 0, false)
}

const homeRooms = () => activeLevel(useLayout.getState())?.rooms ?? []

/** During the flight the user's camera input is off and the distance limit is wide; restored afterwards */
function hold(c: CameraControlsImpl, restore: Flight['restore']) {
  c.enabled = false
  c.maxDistance = Math.max(restore.maxDistance, 400)
  homeFlight.active = true
}
function release(c: CameraControlsImpl, restore: Flight['restore']) {
  c.enabled = restore.enabled
  c.maxDistance = restore.maxDistance
  homeFlight.active = false
  flightDebug.stage = 'idle'
}

export function HomeFlight() {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null
  const invalidate = useThree((s) => s.invalidate)
  const flight = useRef<Flight | null>(null)
  const oldBox = useRef(new THREE.Box3())
  const newBox = useRef(new THREE.Box3())

  useEffect(() => {
    if (!controls) return
    const c = controls
    const start = (req: FlightRequest, restore: Flight['restore']) => {
      const real = c.camera as THREE.PerspectiveCamera
      const from = current(c)
      const fit = poseOf(cameraApi.framePose(homeRooms(), 0.4))
      // Also the framing of the target home when known (so the camera does not climb again while landing at a large home)
      const next = req.peek?.()
      const lv = next ? (next.levels.find((l) => (l.elevation ?? 0) === 0) ?? next.levels[0]) : null
      const nextD = lv ? poseOf(cameraApi.framePose(lv.rooms, 0.4)).d : 0
      const plan = useView.getState().plan
      // Top: the distance that shows both homes completely or one and a half times the current distance (capped so the fog stays within the far plane)
      const peak = { d: Math.min(200, Math.max(30, Math.max(from.d, fit.d, nextD) * 1.5)), polar: plan ? from.polar : PEAK_POLAR, az: fit.az }
      // Travel direction: right of the screen at the top (next home) or left (previous home)
      const ux = Math.cos(peak.az) * req.dir
      const uz = -Math.sin(peak.az) * req.dir
      homeBox(useLayout.getState().layout, oldBox.current)
      const A = clearance(real, from.tx, from.tz, ux, uz, peak, oldBox.current) + GAP / 2
      hold(c, restore)
      flight.current = { req, stage: 'out', t: 0, from, peak, ux, uz, A, v: (3 * A) / OUT_S, extra: 0, B: 0, to: null, az0: 0, restore, t0: performance.now() }
      flightDebug.stage = 'out'
      flightDebug.last = {
        homeBefore: activeHomeId(useLayout.getState()),
        homeAfter: '',
        startD: from.d,
        peakD: peak.d,
        endD: 0,
        oldInView: true,
        newInView: true,
        switchMs: 0,
        totalMs: 0,
        dir: req.dir,
      }
      invalidate()
    }
    registerHomeFlight((req) => {
      const f = flight.current
      // If the home has not switched yet only the target changes (the flight goes on); while landing a new flight starts from the current pose
      if (f && f.stage !== 'in') {
        f.req = req
        return true
      }
      start(req, f ? f.restore : { enabled: c.enabled, maxDistance: c.maxDistance })
      return true
    })
    return () => {
      registerHomeFlight(null)
      const f = flight.current
      if (!f) return
      // Flight interrupted by the scene unmounting: the home still switches
      flight.current = null
      release(c, f.restore)
      if (f.stage !== 'in') f.req.fn()
    }
  }, [controls, invalidate])

  useFrame((state, delta) => {
    const f = flight.current
    const c = controls
    if (!f || !c) return
    // Building the scene after the switch can take a frame: a long frame does not make the motion jump, it continues where it was
    const dt = Math.min(delta, 1 / 30)
    f.t += dt
    const real = c.camera as THREE.PerspectiveCamera
    const { from, peak, ux, uz } = f

    if (f.stage === 'out' || f.stage === 'cruise') {
      const tau = Math.min(1, f.t / OUT_S)
      const s = sstep(tau)
      if (f.stage === 'cruise') f.extra += f.v * dt
      const x = f.A * tau * tau * tau + f.extra
      put(c, {
        tx: from.tx + ux * x,
        ty: from.ty * (1 - s),
        tz: from.tz + uz * x,
        d: from.d + (peak.d - from.d) * s,
        polar: from.polar + (peak.polar - from.polar) * s,
        az: from.az + wrap(peak.az - from.az) * s,
        fx: from.fx * (1 - s),
        fy: from.fy * (1 - s),
      })
      c.update(0)
      if (tau >= 1) {
        // If the old home is still in frame (the window was resized) the camera goes a bit further at the same speed
        const visible = seesNow(real, oldBox.current)
        if (visible && f.extra < 400) f.stage = 'cruise'
        else {
          // ----- switch: the old home is out of frame -----
          const dbg = flightDebug.last!
          dbg.oldInView = visible
          dbg.switchMs = performance.now() - f.t0
          f.req.fn()
          useView.setState({ focus: { kind: 'house' } })
          const to = poseOf(cameraApi.framePose(homeRooms(), 0.4))
          homeBox(useLayout.getState().layout, newBox.current)
          // The new home is in the travel direction, just outside the frame: B back from the target home's framing
          f.B = clearance(real, to.tx, to.tz, -ux, -uz, peak, newBox.current) + GAP / 2
          f.az0 = c.azimuthAngle
          f.to = to
          f.stage = 'in'
          f.t = 0
          flightDebug.stage = 'in'
          dbg.homeAfter = activeHomeId(useLayout.getState())
          put(c, { tx: to.tx - ux * f.B, ty: 0, tz: to.tz - uz * f.B, d: peak.d, polar: peak.polar, az: f.az0, fx: 0, fy: 0 })
          c.update(0)
          dbg.newInView = seesNow(real, newBox.current)
        }
      }
      state.invalidate()
      return
    }

    // ----- landing -----
    const to = f.to!
    const tau = Math.min(1, f.t / IN_S)
    const e = 1 - (1 - tau) ** 3
    const s = sstep(tau)
    put(c, {
      tx: to.tx - ux * f.B * (1 - e),
      ty: to.ty * s,
      tz: to.tz - uz * f.B * (1 - e),
      d: peak.d + (to.d - peak.d) * s,
      polar: peak.polar + (to.polar - peak.polar) * s,
      az: f.az0 + wrap(to.az - f.az0) * s,
      fx: to.fx * s,
      fy: to.fy * s,
    })
    c.update(0)
    if (tau >= 1) {
      flight.current = null
      release(c, f.restore)
      flightDebug.runs += 1
      const dbg = flightDebug.last!
      dbg.endD = c.distance
      dbg.totalMs = performance.now() - f.t0
    }
    state.invalidate()
  })

  return null
}
