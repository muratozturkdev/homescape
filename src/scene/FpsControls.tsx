import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { stepAt } from '@/audio/floor'
import { passDoors } from './doorTraffic'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'
import { toggle } from '@/ha/actions'
import type { HassEntity } from '@/ha/types'
import { roomAt } from '@/model/geometry'
import { activeLevel, FLOOR_H, levelName, useLayout } from '@/model/layoutStore'
import { itemName, itemStateLabel } from '@/ui/Bindings'
import { cameraApi, useView } from './camera'
import { useBins } from './bins'
import { OPENS } from '@/model/containers'
import { railEdges, stairwellsOf } from '@/model/stairwell'
import { ACTIVE_LEVEL, buildColliders, EYE, indoorAt, resolve, RUN, spawnPoint, stairHeight, touchInput, useFps, WALK } from './fps'
import { quickTarget } from '@/ui/quickState'

/*
 * First person walk controller: walk through the home at eye level and control it, like in a game. While on, the orbit
 * camera is removed (Scene) and the camera sits at eye height:
 * - Desktop: clicking the scene locks the pointer; the mouse looks, WASD / arrows walk, ⇧ runs. The linked item under the
 *   crosshair is highlighted: a click or E toggles it, F opens its detail card (the pointer is released). Esc releases
 *   the pointer, a second Esc exits.
 * - Touch: the joystick at the bottom left walks, dragging the screen looks, tapping an item toggles it (ItemNode).
 * - Walls, railings and large items block the way; doors can be passed. Climbing the stairs leads to the upper floor,
 *   going down from the upper floor leads to the lower one (fps.ts > stairHeight).
 * Frames are requested only while moving, looking or crossing stairs (frameloop="demand").
 */

/** Test hook (window.__homescape.fps / fpsTeleport): position in the last frame and a teleport request for the next frame. */
export const fpsDebug = { x: 0, z: 0, h: 0, yaw: 0, pitch: 0 }
export const fpsTeleport: { to: { x: number; z: number; yaw?: number; pitch?: number } | null } = { to: null }

const SENS = 0.0022
const LOOK_TOUCH = 0.006
const center = new THREE.Vector2(0, 0)
/** Crosshair ray (module level: not rebuilt every frame) */
const ray = new THREE.Raycaster()
ray.far = 6

/** Whether the object and all its ancestors are visible (hidden item parts must not be aimed at). */
function visibleChain(o: THREE.Object3D | null) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false
  return true
}

/** Item id from a hit: ItemNode's inner group carries userData.itemId. */
function itemOf(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) if (typeof p.userData.itemId === 'string') return p.userData.itemId
  return null
}

export function FpsControls() {
  const fps = useView((s) => s.fps)
  return fps ? <FpsRig /> : null
}

function FpsRig() {
  const get = useThree((s) => s.get)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  const level = useLayout((s) => activeLevel(s))
  const levels = useLayout((s) => s.layout?.levels)
  // The stairwell edges other than the arrival end act like walls (model/stairwell.ts)
  const colliders = useMemo(() => {
    if (!level) return { segs: [], boxes: [] }
    const rails = stairwellsOf(levels ?? [], level).flatMap((w) => railEdges(w, []))
    return buildColliders(level, rails)
  }, [level, levels])
  const st = useRef({ x: 0, z: 0, yaw: 0, pitch: -0.05, h: 0, stride: 0, foot: 0, aimAt: 0, placed: false, keys: new Set<string>() })

  // On enter: camera settings, start point; on exit the old settings come back and the pointer lock is released
  useEffect(() => {
    // The camera is taken through the getter, not the hook (a value returned by a React hook must not be mutated)
    const camera = get().camera as THREE.PerspectiveCamera
    const saved = { near: camera.near, fov: camera.fov }
    camera.near = 0.05
    camera.fov = 70
    camera.updateProjectionMatrix()
    cameraApi.setFpsCamera(camera)
    const L = useLayout.getState()
    const lv = activeLevel(L)
    const sel = L.selection
    // Start in the selected room or in the selected item's room, if there is one
    let roomId: string | null = null
    if (sel?.type === 'room') roomId = sel.id
    else if (sel?.type === 'item' && lv) {
      const it = lv.items.find((i) => i.id === sel.id)
      roomId = it ? (roomAt(lv.rooms, it.x, it.z)?.id ?? null) : null
    }
    if (lv) {
      const sp = spawnPoint(lv, roomId)
      Object.assign(st.current, { x: sp.x, z: sp.z, yaw: sp.yaw, pitch: -0.05, h: 0 })
    }
    L.select(null)
    invalidate()
    return () => {
      camera.near = saved.near
      camera.fov = saved.fov
      camera.updateProjectionMatrix()
      cameraApi.setFpsCamera(null)
      if (document.pointerLockElement) document.exitPointerLock()
      useFps.getState().setAim(null)
      useFps.getState().setLocked(false)
    }
  }, [get, invalidate])

  // Keyboard, pointer lock and look
  useEffect(() => {
    const el = gl.domElement
    const keys = st.current.keys
    const isField = (t: EventTarget | null) => {
      const n = t as HTMLElement | null
      return Boolean(n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable))
    }
    const act = () => {
      const aim = useFps.getState().aim
      if (!aim) return
      const lv = activeLevel(useLayout.getState())
      const it = lv?.items.find((i) => i.id === aim.itemId)
      if (!it) return
      const ents = useHa.getState().entities
      const target = quickTarget(it.entityId ? ents[it.entityId] : undefined, (it.extras ?? []).map((id) => ents[id]).filter((e): e is HassEntity => Boolean(e)))
      if (target) void toggle(target)
      // Cabinet, drawer: opens and closes the door
      else if (OPENS(it.kind)) useBins.getState().toggle(it.id)
      else details()
    }
    const details = () => {
      const aim = useFps.getState().aim
      if (!aim) return
      if (document.pointerLockElement) document.exitPointerLock()
      useLayout.getState().select({ type: 'item', id: aim.itemId })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isField(e.target)) return
      if (e.code === 'Escape') {
        // With a locked pointer the browser releases it on Esc; otherwise exit walk mode (close an open card first)
        if (useLayout.getState().selection) useLayout.getState().select(null)
        else if (!document.pointerLockElement) useView.getState().setFps(false)
        return
      }
      if (e.code === 'KeyE' || e.code === 'Enter') return act()
      if (e.code === 'KeyF') return details()
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        e.preventDefault()
        keys.add(e.code)
        invalidate()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)
    const onBlur = () => keys.clear()
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      const s = st.current
      s.yaw -= e.movementX * SENS
      s.pitch = Math.max(-1.45, Math.min(1.45, s.pitch - e.movementY * SENS))
      invalidate()
    }
    // Touch: dragging a finger on the canvas looks around; a short tap toggles the item (ItemNode click)
    let touch: { id: number; x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touch = { id: e.pointerId, x: e.clientX, y: e.clientY }
        return
      }
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (document.pointerLockElement === el) act()
      else void el.requestPointerLock?.()?.catch?.(() => undefined)
    }
    const onTouchMove = (e: PointerEvent) => {
      if (!touch || e.pointerId !== touch.id) return
      touchInput.lookX += e.clientX - touch.x
      touchInput.lookY += e.clientY - touch.y
      touch.x = e.clientX
      touch.y = e.clientY
      invalidate()
    }
    const onTouchUp = (e: PointerEvent) => {
      if (touch && e.pointerId === touch.id) touch = null
    }
    const onLock = () => {
      useFps.getState().setLocked(document.pointerLockElement === el)
      if (document.pointerLockElement === el) useLayout.getState().select(null)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onLock)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onTouchMove)
    window.addEventListener('pointerup', onTouchUp)
    window.addEventListener('pointercancel', onTouchUp)
    return () => {
      el.removeEventListener('pointermove', onTouchMove)
      window.removeEventListener('pointerup', onTouchUp)
      window.removeEventListener('pointercancel', onTouchUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLock)
      el.removeEventListener('pointerdown', onDown)
      keys.clear()
    }
  }, [gl, invalidate])

  useFrame((state, delta) => {
    const s = st.current
    const L = useLayout.getState()
    const lv = activeLevel(L)
    if (!lv) return
    const dt = Math.min(delta, 0.1)
    const k = s.keys
    if (fpsTeleport.to) {
      s.x = fpsTeleport.to.x
      s.z = fpsTeleport.to.z
      if (fpsTeleport.to.yaw != null) s.yaw = fpsTeleport.to.yaw
      if (fpsTeleport.to.pitch != null) s.pitch = fpsTeleport.to.pitch
      fpsTeleport.to = null
      s.placed = false
    }
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + touchInput.fwd
    let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + touchInput.side
    const len = Math.hypot(f, r)
    if (len > 1) {
      f /= len
      r /= len
    }
    // Touch look (the HUD accumulates it, it is consumed here)
    let looked = false
    if (touchInput.lookX || touchInput.lookY) {
      s.yaw -= touchInput.lookX * LOOK_TOUCH
      s.pitch = Math.max(-1.45, Math.min(1.45, s.pitch - touchInput.lookY * LOOK_TOUCH))
      touchInput.lookX = 0
      touchInput.lookY = 0
      looked = true
    }
    const moving = len > 0.01
    if (moving) {
      const run = k.has('ShiftLeft') || k.has('ShiftRight') || touchInput.run
      const speed = (run ? RUN : WALK) * dt
      const dx = (-Math.sin(s.yaw) * f + Math.cos(s.yaw) * r) * speed
      const dz = (-Math.cos(s.yaw) * f - Math.sin(s.yaw) * r) * speed
      ;[s.x, s.z] = resolve(s.x + dx, s.z + dz, colliders.segs, colliders.boxes)
      s.stride += Math.hypot(dx, dz)
      // The walking player opens closed doors too (scene/doorTraffic.ts)
      passDoors(lv, [{ x: s.x, z: s.z }])
      // Footstep sound: at every low point of the head bob, by the floor under the foot
      const foot = Math.floor((s.stride * 5.2) / (Math.PI * 2) + 0.25)
      if (foot !== s.foot) {
        s.foot = foot
        stepAt(lv, s.x, s.z, { gain: run ? 0.55 : 0.38, y: s.h + 0.05 })
      }
    }

    // Stairs: climbs on stairs of this floor, descends when above stairs of the floor below; the floor changes past the halfway point
    const e0 = lv.elevation ?? 0
    const levels = L.layout?.levels ?? []
    const up = levels.find((l) => (l.elevation ?? 0) === e0 + 1)
    const down = levels.find((l) => (l.elevation ?? 0) === e0 - 1)
    let target = 0
    for (const it of lv.items) if (it.kind === 'stairs') target = Math.max(target, stairHeight(it, s.x, s.z) ?? 0)
    if (!target && down) for (const it of down.items) if (it.kind === 'stairs') {
      const hh = stairHeight(it, s.x, s.z)
      if (hh != null) target = hh - FLOOR_H
    }
    if (target > FLOOR_H - 0.35 && up) {
      L.setLevel(up.id)
      s.h -= FLOOR_H
      useHa.setState({ notice: `${levelName(up)}` })
    } else if (target < -0.35 && down) {
      L.setLevel(down.id)
      s.h += FLOOR_H
      useHa.setState({ notice: `${levelName(down)}` })
    }
    const dh = target - s.h
    s.h = Math.abs(dh) < 0.002 ? target : s.h + dh * Math.min(1, dt * 12)

    // Slight head bob while walking
    const bob = moving ? Math.sin(s.stride * 5.2) * 0.025 : 0
    state.camera.position.set(s.x, s.h + EYE + bob, s.z)
    state.camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ')
    Object.assign(fpsDebug, { x: s.x, z: s.z, h: s.h, yaw: s.yaw, pitch: s.pitch })
    // Indoors or outdoors (eye adaptation to the ambient light); while walking, on enter and after a teleport
    if (moving || !s.placed) {
      s.placed = true
      useFps.getState().setIndoor(Boolean(indoorAt(activeLevel(useLayout.getState()) ?? lv, s.x, s.z)))
    }

    // Aim: ~10 times per second, the first visible object under the crosshair (does not see through walls)
    const now = state.clock.elapsedTime
    if (now - s.aimAt > 0.1 || moving || looked) {
      s.aimAt = now
      ray.setFromCamera(center, state.camera)
      ray.camera = state.camera
      // Only the active floor's content and up to 7 m (other floors are drawn in walk mode too; raycasting the whole scene is expensive)
      ray.far = 7
      const active = scene.getObjectByName(ACTIVE_LEVEL)
      const hits = ray.intersectObjects(active ? [active] : scene.children, true)
      const first = hits.find((h) => visibleChain(h.object))
      const id = first ? itemOf(first.object) : null
      // Nearby cabinet with doors, dresser, drawer: its name and whether it is open under the crosshair; a click or E opens and closes it (scene/bins.ts)
      const bin = id ? lv.items.find((i) => i.id === id && OPENS(i.kind)) : undefined
      const it = id ? lv.items.find((i) => i.id === id) : undefined
      const ents = useHa.getState().entities
      const e = it?.entityId ? ents[it.entityId] : undefined
      const related = (it?.extras ?? []).map((x) => ents[x]).filter((x): x is HassEntity => Boolean(x))
      const shown = e ?? quickTarget(undefined, related)
      if (it && shown) useFps.getState().setAim({ itemId: it.id, name: itemName(it, e), state: itemStateLabel(it, shown), toggle: Boolean(quickTarget(e, related)) })
      else if (bin && first!.distance < 2.5) useFps.getState().setAim({ itemId: bin.id, name: itemName(bin, undefined), state: useBins.getState().open[bin.id] ? t('Open') : t('Closed'), toggle: true })
      else useFps.getState().setAim(null)
    }

    if (moving || looked || Math.abs(dh) > 0.002) state.invalidate()
  })

  return null
}
