import type CameraControlsImpl from 'camera-controls'
import type { Camera } from 'three'
import { create } from 'zustand'
import { bounds } from '@/model/geometry'
import { useLayout } from '@/model/layoutStore'
import type { Room } from '@/model/types'
import { panelSpace, sheetSpace } from '@/ui/panelState'

/*
 * Camera API: access from outside the Canvas (UI buttons, dragging) and framing math.
 * In camera-controls setFocalOffset shifts the camera: +x moves the scene LEFT, +y moves the scene UP.
 */

let controls: CameraControlsImpl | null = null
/** No orbit controls in first person walk mode: FpsControls registers the camera (for the project test hook) */
let fpsCamera: Camera | null = null

export const FOV = 32
/** View direction from the target to the camera (isometric feel) */
const DIR = [0.55, 0.72, 0.68] as const
/** Vertical shift caused by the top bar and the bottom room bar (px) */
const BIAS_PX = 30
/** In edit mode the bottom build bar is this much taller than the room bar (px) */
const BUILD_BAR_EXTRA_PX = 120
/** Editing on a phone: shift to the middle of the gap between the top bar (~64) and the build bar (~190), and the total vertical margin */
const NARROW_EDIT_UP_PX = 64
const NARROW_EDIT_USED_PX = 260

export type FocusTarget = { kind: 'house' } | { kind: 'room'; id: string }
/** What a left drag does: rotates (default) or pans (hand button, remembered). */
export type LeftDrag = 'pan' | 'rotate'

// v2: the default became "rotate"; the key was renewed so an old "pan" choice is not carried over.
const LEFT_KEY = 'homescape-left-drag-v2'
const LITE_KEY = 'homescape-lite'
const INNER_KEY = 'homescape-inner-walls'
const PEOPLE_KEY = 'homescape-people'
const STREET_KEY = 'homescape-street'

export interface StreetKinds {
  cars: boolean
  walkers: boolean
  kids: boolean
}
/** Saved roof types (by home id) */
function readRoofStyle(): Record<string, RoofStyle> {
  try {
    const v = JSON.parse(readPref(ROOF_STYLE_KEY) ?? '{}') as Record<string, RoofStyle>
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Saved street life choice (all on when missing) */
function readStreet(): StreetKinds {
  const all = { cars: true, walkers: true, kids: true }
  try {
    const v = JSON.parse(readPref(STREET_KEY) ?? 'null') as Partial<StreetKinds> | null
    return v && typeof v === 'object' ? { ...all, ...v } : all
  } catch {
    return all
  }
}
const RESIDENTS_KEY = 'homescape-residents'
const LOWER_KEY = 'homescape-lower-floors'
// v2: the old roof button switched to "Always" (which turned off lifting on approach); the new button toggles between Auto and Hidden
const ROOF_KEY = 'homescape-roof-v2'
/**
 * Roof display: auto (visible from afar; lifts when zooming in, selecting a room, in edit mode and in the plan view),
 * always, off.
 */
export type RoofMode = 'auto' | 'on' | 'off'
/** Roof type: tiled hip roof or flat concrete roof */
export type RoofStyle = 'tile' | 'concrete'
const ROOF_STYLE_KEY = 'homescape-roof-style'
/** Interior walls: full height (default, hides what is behind) or low (like a floor plan). */
export type InnerWalls = 'full' | 'low'
function readPref(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: valid for this session only */
  }
}
const readLeftDrag = (): LeftDrag => (readPref(LEFT_KEY) === 'pan' ? 'pan' : 'rotate')

interface ViewState {
  /** Top-down plan view */
  plan: boolean
  /** Space held: a left drag pans the camera, item/room interaction pauses */
  panKey: boolean
  /** ⌥ or ⇧ held: a left drag rotates the camera, item/room interaction pauses */
  rotateKey: boolean
  leftDrag: LeftDrag
  /** Lite mode (weak computers): no shadows, no ambient animations, 1x resolution. Remembered. */
  lite: boolean
  /** Height of interior walls (full height is not cut while the camera turns) */
  innerWalls: InnerWalls
  /** Whether people in the home are shown (scene/People.tsx; in view mode). Remembered. */
  people: boolean
  /**
   * Street life (scene/StreetLife.tsx), each kind can be turned on and off separately: cars passing on the road,
   * pedestrians and dog walkers on the sidewalk, children on the playground. Remembered.
   */
  street: StreetKinds
  /** Household: number of people at home when there is no motion (1-4, default 2). Remembered. */
  residents: number
  /** Whether lower floors are drawn below the active floor (building view in a multi-storey home). Remembered. */
  lowerFloors: boolean
  /** Roof display (scene/Roofs.tsx). Remembered. */
  roof: RoofMode
  /** Roof type of the homes (by home id; tile when missing). Remembered. */
  roofStyle: Record<string, RoofStyle>
  /** Whether first person (FPS) walk mode is on (scene/FpsControls.tsx) */
  fps: boolean
  /** Whether the dashboard (control panel) is open (ui/Dashboard.tsx) */
  dashboard: boolean
  /** Latest framing request for CameraRig to carry out; nonce increases with every request */
  focus: FocusTarget
  nonce: number
  setPlan: (plan: boolean) => void
  setPanKey: (on: boolean) => void
  setRotateKey: (on: boolean) => void
  setLeftDrag: (mode: LeftDrag) => void
  setLite: (on: boolean) => void
  setInnerWalls: (v: InnerWalls) => void
  setPeople: (on: boolean) => void
  setStreet: (kind: keyof StreetKinds, on: boolean) => void
  setResidents: (n: number) => void
  setLowerFloors: (on: boolean) => void
  setRoof: (mode: RoofMode) => void
  setRoofStyle: (homeId: string, style: RoofStyle) => void
  setFps: (on: boolean) => void
  setDashboard: (on: boolean) => void
  request: (focus: FocusTarget) => void
}

export const useView = create<ViewState>()((set, get) => ({
  plan: false,
  panKey: false,
  rotateKey: false,
  leftDrag: readLeftDrag(),
  lite: readPref(LITE_KEY) === '1',
  innerWalls: readPref(INNER_KEY) === 'low' ? 'low' : 'full',
  people: readPref(PEOPLE_KEY) !== '0',
  street: readStreet(),
  residents: Math.min(4, Math.max(1, Number(readPref(RESIDENTS_KEY)) || 2)),
  lowerFloors: readPref(LOWER_KEY) !== '0',
  roof: (['auto', 'on', 'off'] as const).find((m) => m === readPref(ROOF_KEY)) ?? 'auto',
  roofStyle: readRoofStyle(),
  fps: false,
  dashboard: false,
  focus: { kind: 'house' },
  nonce: 0,
  setPlan: (plan) => set({ plan, nonce: get().nonce + 1 }),
  setPanKey: (panKey) => set({ panKey }),
  setRotateKey: (rotateKey) => set({ rotateKey }),
  setLeftDrag: (leftDrag) => {
    writePref(LEFT_KEY, leftDrag)
    set({ leftDrag })
  },
  setLite: (lite) => {
    writePref(LITE_KEY, lite ? '1' : '0')
    set({ lite })
  },
  setInnerWalls: (innerWalls) => {
    writePref(INNER_KEY, innerWalls)
    set({ innerWalls })
  },
  setPeople: (people) => {
    writePref(PEOPLE_KEY, people ? '1' : '0')
    set({ people })
  },
  setStreet: (kind, on) => {
    const street = { ...get().street, [kind]: on }
    writePref(STREET_KEY, JSON.stringify(street))
    set({ street })
  },
  setResidents: (residents) => {
    writePref(RESIDENTS_KEY, String(residents))
    set({ residents })
  },
  setLowerFloors: (lowerFloors) => {
    writePref(LOWER_KEY, lowerFloors ? '1' : '0')
    set({ lowerFloors })
  },
  setRoof: (roof) => {
    writePref(ROOF_KEY, roof)
    set({ roof })
  },
  setRoofStyle: (homeId, style) => {
    const roofStyle = { ...get().roofStyle, [homeId]: style }
    writePref(ROOF_STYLE_KEY, JSON.stringify(roofStyle))
    set({ roofStyle })
  },
  setFps: (fps) => set({ fps, ...(fps ? { plan: false, dashboard: false } : { nonce: get().nonce + 1 }) }),
  setDashboard: (dashboard) => set({ dashboard }),
  request: (focus) => set({ focus, nonce: get().nonce + 1 }),
}))

/** Whether a camera key is held (Space pans, ⌥/⇧ rotates): items and rooms cannot be dragged or selected meanwhile. */
export const cameraKey = () => {
  const v = useView.getState()
  return v.panKey || v.rotateKey
}

/** Minimum movement for a drag not to count as a click (px). */
export const DRAG_PX = 4
/**
 * Maximum slip that still counts as a click: a finger slides a few pixels while tapping (on iPad a tap counted as a drag
 * and the item did not toggle), so touch and pen get a wider margin.
 */
export const clickSlop = (pointerType?: string) => (pointerType === 'touch' || pointerType === 'pen' ? 14 : DRAG_PX)

/**
 * Kind of the last press (mouse, touch, pen): written on the window in the capture phase at press time. The click event's
 * own type cannot be trusted: on iPad WebKit can report a click from a finger tap as "mouse"; the tap then took the
 * "select" path instead of "toggle" and the quick pill never showed in a live home.
 */
export const pointerKind = { last: 'mouse' }
if (typeof window !== 'undefined')
  window.addEventListener(
    'pointerdown',
    (e) => {
      pointerKind.last = e.pointerType || 'mouse'
    },
    { capture: true, passive: true },
  )
/** Whether the last press was a finger (or a pen) */
export const isTouchPointer = () => pointerKind.last === 'touch' || pointerKind.last === 'pen'

export function registerControls(c: CameraControlsImpl | null) {
  controls = c
}

function viewport() {
  const w = window.innerWidth
  const h = window.innerHeight
  const edit = useLayout.getState().mode === 'edit'
  const wide = w >= 1024
  // Extra vertical space taken by the UI (px): the framing fits into an area that much shorter.
  const used = !edit ? 0 : wide ? BUILD_BAR_EXTRA_PX : NARROW_EDIT_USED_PX
  return { w, h, wide, edit, used }
}

const tanHalf = Math.tan((FOV * Math.PI) / 360)
const worldPerPx = (d: number, h: number) => (2 * d * tanHalf) / h

function panelOffset(d: number): [number, number, number] {
  const { h, wide, edit, used } = viewport()
  const wpp = worldPerPx(d, h)
  // +y moves the scene up. On a wide screen by half the build bar's extra height;
  // on a phone above the bottom card in view mode, between the top bar and the build bar in edit mode.
  // With the right panel (ui/panelState.ts) open the scene moves left by half the panel width; centered when closed
  if (wide) return [(panelSpace() / 2) * wpp, (-BIAS_PX + used / 2) * wpp, 0]
  // On a narrow screen the scene moves up while the bottom card is open (proportional to the card height), centered when closed
  return [0, (edit ? NARROW_EDIT_UP_PX : Math.min(0.5, sheetSpace()) * 0.4 * h) * wpp, 0]
}

function fit(b: ReturnType<typeof bounds>, plan: boolean) {
  const { w, h, wide, used } = viewport()
  const free = wide ? w - panelSpace(w) - 24 : w
  const vfree = (h - used) / h
  const bw = b.maxX - b.minX
  const bd = b.maxZ - b.minZ
  if (plan) {
    // KPI cards on top, the room bar at the bottom: a wider vertical margin.
    const dW = (bw * 1.22) / (2 * tanHalf * (free / h))
    const dH = (bd * 1.6) / (2 * tanHalf * vfree)
    return Math.max(dW, dH, 6)
  }
  const span = (bw * 0.78 + bd * 0.63) * 1.08
  const vspan = (bw * 0.45 + bd * 0.62) * 0.75 + 2.4
  return Math.max(span / (2 * tanHalf * (free / h)), (vspan / (2 * tanHalf * vfree)) * 1.25, 7)
}

export const cameraApi = {
  setEnabled: (on: boolean) => {
    if (controls) controls.enabled = on
  },
  /**
   * Mouse mapping (default: rotate):
   * - left drag rotates, pans or (while placing / drawing a room) does nothing, according to `left`;
   * - right and middle drag do the opposite of the user's left button choice (`base`): if left rotates, they pan.
   * Touch: one finger acts like the left button; two fingers zoom and do what one finger does not.
   * ACTION comes from the scene (this file is in the main bundle; keeps three/drei out of it).
   * camera-controls 3: SCREEN_PAN pans in the ground plane (horizontal = sideways, vertical = forward);
   * TRUCK lifts the target instead and does not feel like a map. verticalDragToForward no longer exists.
   */
  mapButtons: (left: LeftDrag | 'none', base: LeftDrag, ACTION: typeof CameraControlsImpl.ACTION) => {
    if (!controls) return
    controls.mouseButtons.left = left === 'none' ? ACTION.NONE : left === 'rotate' ? ACTION.ROTATE : ACTION.SCREEN_PAN
    const other = base === 'rotate' ? ACTION.SCREEN_PAN : ACTION.ROTATE
    controls.mouseButtons.middle = other
    controls.mouseButtons.right = other
    controls.touches.one = left === 'none' ? ACTION.NONE : left === 'rotate' ? ACTION.TOUCH_ROTATE : ACTION.TOUCH_SCREEN_PAN
    // TOUCH_DOLLY_SCREEN_PAN exists at runtime but is missing from the camera-controls 3.1 type definitions.
    // (TOUCH_DOLLY_TRUCK is not used: vertical movement lifts the target off the ground.)
    const dollyPan = ACTION.TOUCH_DOLLY_SCREEN_PAN as unknown as typeof ACTION.TOUCH_DOLLY_ROTATE
    controls.touches.two = base === 'rotate' ? dollyPan : ACTION.TOUCH_DOLLY_ROTATE
  },
  /** Test hook: the camera's target and angles. */
  debug: () => {
    if (!controls) return null
    // Copy the vector from the camera to keep three out of the main bundle.
    const t = controls.getTarget(controls.camera.position.clone())
    return {
      target: [t.x, t.y, t.z],
      azimuth: controls.azimuthAngle,
      polar: controls.polarAngle,
      distance: controls.distance,
      buttons: { left: controls.mouseButtons.left, right: controls.mouseButtons.right },
    }
  },
  /** Walk mode camera (FpsControls registers it on enter and clears it on exit). */
  setFpsCamera: (cam: Camera | null) => {
    fpsCamera = cam
  },
  /**
   * Audio listener (audio/engine.ts): the eye in walk mode; in the bird's eye view a third of the way from the look-at point
   * towards the camera (at least 2.5 m): when zooming in the listener comes down into the room and that room's sounds
   * stand out. The orientation is the camera's.
   */
  pose: () => {
    const fps = useView.getState().fps
    const cam = fps ? fpsCamera : controls?.camera
    if (!cam) return null
    const f = cam.getWorldDirection(cam.position.clone())
    const u = cam.position.clone().set(0, 1, 0).applyQuaternion(cam.quaternion)
    let { x, y, z } = cam.position
    if (!fps && controls) {
      const t = controls.getTarget(cam.position.clone())
      const d = Math.hypot(x - t.x, y - t.y, z - t.z) || 1
      const k = Math.min(d, Math.max(2.5, d * 0.32)) / d
      x = t.x + (x - t.x) * k
      y = t.y + (y - t.y) * k
      z = t.z + (z - t.z) * k
    }
    return { x, y, z, fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z }
  },
  /** Test hook: screen position of a world point (the canvas fills the window); from the eye camera in walk mode. */
  project: (x: number, y: number, z: number) => {
    const cam = controls?.camera ?? fpsCamera
    if (!cam) return null
    const v = cam.position.clone().set(x, y, z).project(cam)
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight }
  },
  /** Distance from the camera to its look-at point (bird's eye view; automatic roof display) */
  distance: () => controls?.distance ?? null,
  /** When the panel opens, closes or resizes: the framing stays, only the scene's center on screen shifts */
  reoffset: () => {
    if (!controls || useView.getState().fps) return
    void controls.setFocalOffset(...panelOffset(controls.distance), true)
  },
  zoomIn: () => controls?.dolly(3, true),
  zoomOut: () => controls?.dolly(-3, true),
  /** Two-finger horizontal swipe on a trackpad: instant rotation in radians. */
  rotateBy: (rad: number) => {
    if (controls) void controls.rotate(rad, 0, true)
  },
  /** Q / E: rotate the camera by degrees. */
  rotate: (deg: number) => {
    if (controls) void controls.rotate((deg * Math.PI) / 180, 0, true)
  },
  /** Panning with the arrow keys: x right, z forward (in the ground plane). */
  pan: (x: number, z: number) => {
    if (!controls) return
    if (x) void controls.truck(x, 0, true)
    if (z) void controls.forward(z, true)
  },

  /**
   * Framing: target, camera position (before the focal offset) and focal offset. `frame` applies it; the flight between
   * homes (scene/HomeFlight.tsx) uses it as the arrival framing.
   */
  framePose: (rooms: Room[], pad = 0) => {
    const b = bounds(rooms)
    const bb = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad }
    const plan = useView.getState().plan
    const d = fit(bb, plan)
    const cx = (bb.minX + bb.maxX) / 2
    const cz = (bb.minZ + bb.maxZ) / 2
    const len = Math.hypot(...DIR)
    const position: [number, number, number] = plan ? [cx, d, cz + 0.001] : [cx + (DIR[0] / len) * d, (DIR[1] / len) * d, cz + (DIR[2] / len) * d]
    return { target: [cx, 0, cz] as [number, number, number], position, focal: panelOffset(d) }
  },
  /** Fits the given rooms (or the whole home) into the area not covered by the cards. */
  frame: (rooms: Room[], pad = 0) => {
    if (!controls) return
    const f = cameraApi.framePose(rooms, pad)
    controls.setLookAt(...f.position, ...f.target, true)
    controls.setFocalOffset(...f.focal, true)
  },

  /** Close-up of an item. */
  focusPoint: (x: number, y: number, z: number) => {
    if (!controls || useView.getState().plan) return
    const d = 9
    const len = Math.hypot(...DIR)
    controls.setLookAt(x + (DIR[0] / len) * d, y + (DIR[1] / len) * d, z + (DIR[2] / len) * d, x, y, z, true)
    controls.setFocalOffset(...panelOffset(d), true)
  },
}

/** Whether a flight between homes is running (written by scene/HomeFlight.tsx): meanwhile CameraRig does not apply framing requests */
export const homeFlight = { active: false }

/** Test hook (window.__homescape.homeFlight) */
export const flightDebug = {
  stage: 'idle' as 'idle' | 'out' | 'cruise' | 'in',
  runs: 0,
  last: null as null | {
    homeBefore: string
    homeAfter: string
    startD: number
    peakD: number
    endD: number
    /** Whether the old home at the switch and the new home in the first frame were in frame (with the real camera's frustum) */
    oldInView: boolean
    newInView: boolean
    switchMs: number
    totalMs: number
    dir: number
  },
}

/**
 * Whether the active floor's roof is down (written by scene/Roofs.tsx; kept in this three-free file so the UI bundle does
 * not pull in three): while it is down, exterior walls facing the camera are not cut (RoomMesh > Wall)
 */
export const roofView = { covered: false, alpha: {} as Record<string, number> }

/**
 * Removes the roof completely / brings it back (roof button in the right tool column and T): from Hidden to Auto (down
 * from afar, lifts on approach), otherwise to Hidden. "Always" is in the floor menu.
 */
export function toggleRoof() {
  const v = useView.getState()
  v.setRoof(v.roof === 'off' ? 'auto' : 'off')
  return v.roof !== 'off'
}
