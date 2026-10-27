import { activeHomeId, homesOf, useLayout } from '@/model/layoutStore'
import type { Layout } from '@/model/types'
import { useView } from '@/scene/camera'

/*
 * Switching between homes is a camera move, not a curtain overlay: the homes stand as if side by side in one world. The
 * camera rises above the home and glides sideways; once the old home leaves the frame the home switches, the new one enters
 * from the other side of the frame, and the camera descends and focuses on it. Only the active home is drawn: the new home
 * is not in the scene until the switch. The flight is scene/HomeFlight.tsx (registered by the scene); with "reduce motion"
 * on, during a walk or when the scene is not ready, it switches directly.
 */

export interface FlightRequest {
  /** Changes the home (switchHome, addHome, sample home) */
  fn: () => void
  /** In the home list the next home is to the right (1), the previous one to the left (-1) */
  dir: 1 | -1
  /** Plan of the target home (when known): the top of the flight is high enough to show both homes comfortably */
  peek?: () => Layout | null
}

let runner: ((r: FlightRequest) => boolean) | null = null

/** The flight component in the scene registers here (null: unregisters); it returns true when it takes the request */
export function registerHomeFlight(r: ((req: FlightRequest) => boolean) | null) {
  runner = r
}

const reduced = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

export function switchHomeAnimated(fn: () => void, dir: 1 | -1 = 1, peek?: () => Layout | null) {
  if (!reduced() && !useView.getState().fps && runner?.({ fn, dir, peek })) return
  fn()
  useView.getState().request({ kind: 'house' })
}

/** Plan of a saved home (inactive homes keep their plans in the home list) */
export const homeLayout = (id: string) => homesOf(useLayout.getState()).find((h) => h.id === id)?.layout ?? null

/** Whether the target home comes after the active one in the list (fly right) or before it (fly left) */
export function homeDir(id: string): 1 | -1 {
  const s = useLayout.getState()
  const list = homesOf(s)
  return list.findIndex((h) => h.id === id) < list.findIndex((h) => h.id === activeHomeId(s)) ? -1 : 1
}
