import { useThree } from '@react-three/fiber'
import type CameraControlsImpl from 'camera-controls'
import { useEffect } from 'react'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { usePanel } from '@/ui/panelState'
import { cameraApi, homeFlight, registerControls, useView } from './camera'

function apply() {
  const level = activeLevel(useLayout.getState())
  // During a flight between homes the flight drives the camera (the framing request after the home switch must not break it)
  if (!level || homeFlight.active) return
  const { focus } = useView.getState()
  if (focus.kind === 'room') {
    const room = level.rooms.find((r) => r.id === focus.id)
    if (room) return cameraApi.frame([room], 0.6)
  }
  cameraApi.frame(level.rooms, 0.4)
}

/** Applies framing requests (home, room, plan view); fits the home on first load and when the window changes. */
export function CameraRig() {
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null
  const nonce = useView((s) => s.nonce)
  const plan = useView((s) => s.plan)
  const levelId = useLayout((s) => s.levelId)
  const hasLayout = useLayout((s) => Boolean(s.layout))
  // In edit mode the build bar at the bottom grows, so the framing is recomputed.
  const mode = useLayout((s) => s.mode)
  // The framing is refreshed when the plan becomes empty and when the first room is drawn (empty ground from afar, first room up close).
  const empty = useLayout((s) => (activeLevel(s)?.rooms.length ?? 0) === 0)

  useEffect(() => {
    registerControls(controls)
    return () => registerControls(null)
  }, [controls])

  useEffect(() => {
    if (controls) apply()
  }, [controls, nonce, plan, levelId, hasLayout, mode, empty])

  // When the right panel opens, closes or changes width the scene center shifts (the framing stays)
  useEffect(
    () =>
      usePanel.subscribe((p, q) => {
        if (p.open !== q.open || p.width !== q.width || p.sheet !== q.sheet) cameraApi.reoffset()
      }),
    [],
  )

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(apply, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return null
}
