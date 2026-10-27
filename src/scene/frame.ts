/*
 * On-demand rendering (frameloop="demand"): the scene is drawn only when something changes.
 * - Camera movement: drei CameraControls requests frames itself.
 * - 3D object properties changed through React: R3F requests frames itself.
 * - Smooth transitions (wall height, door opening, selection ring): they request frames until they finish.
 * - Ambient animations (AC airflow, steam, waves, fan, robot vacuum): AmbientTicker requests them at a low rate.
 * - UI (DOM) side: through kick() (e.g. so a new label can be positioned).
 * The shadow map is not redrawn every frame either, only when the scene changes (markShadows).
 * This file is also used in the main bundle: it does not import three or R3F.
 */

let invalidate: () => void = () => {}

/** The scene (tests and debugging: dev/sceneProbe.ts) */
export const sceneRef: { scene: { traverse: (fn: (o: { userData: Record<string, unknown> }) => void) => void } | null } = { scene: null }

export function registerInvalidate(fn: (() => void) | null) {
  invalidate = fn ?? (() => {})
}

/** Requests one frame. */
export const kick = () => invalidate()

/* ---------- shadows ---------- */

let shadowFrames = 0

/** Redraws the shadow map in the next n frames (an item moved, a door opened, the wall height changed...). */
export function markShadows(n = 2) {
  if (n > shadowFrames) shadowFrames = n
  invalidate()
}

/** ShadowManager asks every frame: draw shadows in this frame? */
export function takeShadowFrame() {
  if (shadowFrames <= 0) return false
  shadowFrames -= 1
  return true
}

/* ---------- ambient animations ---------- */

let ambient = 0
/** Slow ambient animations (aquarium fish): half the frame rate is enough. */
let slow = 0

export const ambientEnter = (isSlow = false) => {
  if (isSlow) slow += 1
  else ambient += 1
  invalidate()
}
export const ambientLeave = (isSlow = false) => {
  if (isSlow) slow = Math.max(0, slow - 1)
  else ambient = Math.max(0, ambient - 1)
}
export const ambientActive = () => ambient > 0
export const slowAmbientActive = () => slow > 0
export const ambientCount = () => ambient + slow

/** Frame rate of ambient animations: looks smooth but is not 60 (saves power). */
export const AMBIENT_FPS = 24
