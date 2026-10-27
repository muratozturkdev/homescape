import { useCursor } from '@react-three/drei'
import { type ThreeEvent } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { play } from '@/audio/engine'
import { domainOf, isActive, isUnavailable, lightColor, lightLevel } from '@/ha/derive'
import { isSimulated, useHa } from '@/ha/store'
import type { HassEntity } from '@/ha/types'
import { toggle } from '@/ha/actions'
import { t } from '@/i18n'
import { isBound } from '@/model/bindings'
import { CATALOG, isLightKind, sizeOf } from '@/model/catalog'
import { doorSides, isAperture, isOutdoor, snap, wallSnap } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { APPLIANCE_STACK, checkItem, isWallMounted, snapsToWall, STACKABLE, surfaceAt } from '@/model/rules'
import { counterSink } from '@/model/counter'
import { carryPatches, containerOf, contentsOf, DRAWER_SLIDE, INTERIOR, OPENS, shelfAt, toLocal } from '@/model/containers'
import type { Item } from '@/model/types'
import { cameraApi, cameraKey, clickSlop, DRAG_PX, isTouchPointer, pointerKind } from './camera'
import { DEFAULT_Y, KIT } from './kit/registry'
import { useFps } from './fps'
import { pointAt, quickTarget, useQuick } from '@/ui/quickState'
import { quickObjects } from './hoverTargets'
import { ItemSelection } from './Selection'
import { OFF_VISUAL, type Visual } from './kit/visual'
import { binsDebug, useBinOpen, useBins } from './bins'

const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
/** Cabinets whose drawer slides out when opened (the others swing a door) */
const DRAWER_KINDS: Item['kind'][] = ['dresser', 'drawerUnit', 'nightstand']
const hit = new THREE.Vector3()

interface Props {
  item: Item
  entity?: HassEntity
  /** Extra linked entities */
  related: HassEntity[]
  night: boolean
  /**
   * The item's floor and whether it is on an inactive floor (Scene > Levels): items of an inactive floor cannot be clicked,
   * selected or opened. Switching floors does not rebuild the component, only this flag changes (rebuilding froze walk
   * mode when going upstairs).
   */
  levelId?: string
  still?: boolean
}

const busy = () => Boolean(usePlacement.getState().target) || cameraKey()
/** Kind of the last press (mouse, pen, touch): to detect touch on click (Safari's click event has no pointerType). */

/**
 * The whole scene must not rebuild on every state update from HA: an item re-renders only when its own data, its entity
 * or its extra entities change.
 */
export const ItemNode = memo(ItemNodeImpl, (a, b) => {
  if (a.item !== b.item || a.entity !== b.entity || a.night !== b.night || a.still !== b.still || a.levelId !== b.levelId) return false
  if (a.related === b.related) return true
  return a.related.length === b.related.length && a.related.every((e, i) => e === b.related[i])
})

function ItemNodeImpl({ item, entity, related, night, levelId, still = false }: Props) {
  const Comp = KIT[item.kind]
  // The item's floor (the active floor when not given)
  const lvOf = (s: Parameters<typeof activeLevel>[0]) => (levelId ? s.layout?.levels.find((l) => l.id === levelId) : activeLevel(s))
  const meta = CATALOG[item.kind]
  const single = useLayout((s) => s.selection?.type === 'item' && s.selection.id === item.id)
  const inMulti = useLayout((s) => Boolean(s.multi?.items.includes(item.id)))
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const bad = usePlacement((s) => s.moving?.id === item.id && !s.moving.ok)
  const [hover, setHover] = useState(false)
  // Whether the door/window is in a wall between two rooms (an interior door is drawn low, with a swing arc on the floor).
  // When an outdoor area (garden, porch) is behind it, it is in an exterior wall (same as geometry.ts > wallRuns and
  // roomLights): when facing the camera it is cut with its wall, otherwise a garden-facing window or door would stay full
  // height above the cut wall.
  const interior = useLayout((s) => {
    if (!isAperture(item.kind)) return false
    const back = doorSides(item, lvOf(s)?.rooms ?? []).back
    return Boolean(back && !isOutdoor(back))
  })
  const edit = useLayout((s) => s.mode === 'edit') && !still
  // In view mode only linked (controllable) items are clickable
  // Cabinets and drawers are clickable in view mode too: opens and closes the door (scene/bins.ts)
  const opensKind = OPENS(item.kind)
  const interactive = !still && (edit || isBound(item) || opensKind)
  // In first person walk mode the item under the crosshair is highlighted
  const aimed = useFps((s) => s.aim?.itemId === item.id)
  const hingeRight = item.hinge === 'right'
  const swingOut = item.swing === 'out'
  const { len, drawers, top, body, fedAt, shape, variant, len2, led, ledEntity, intensity, mount, beam } = item
  // Built-in sink of the kitchen counter (model/counter.ts): in the middle unless there is a separate sink next to it
  const sinkAt = useLayout((s) => (item.kind === 'kitchenCounter' ? (counterSink(lvOf(s)?.items ?? [], item) ?? undefined) : undefined))
  const opts = useMemo(
    () => ({ len, drawers, top, body, fedAt, shape, variant, len2, led, ledEntity, intensity, mount, beam, sinkAt }),
    [len, drawers, top, body, fedAt, shape, variant, len2, led, ledEntity, intensity, mount, beam, sinkAt],
  )
  useCursor(hover && interactive && !busy())
  // If the quick on/off pill opens on this item, it is placed by this group's body (scene/QuickAnchor.tsx)
  useEffect(() => {
    const o = inner.current
    if (!o || still || !interactive) return
    quickObjects.set(item.id, o)
    return () => {
      if (quickObjects.get(item.id) === o) quickObjects.delete(item.id)
    }
  }, [item.id, still, interactive])
  const drag = useRef<{ ox: number; oz: number; sx: number; sy: number; started: boolean } | null>(null)
  // Cabinets and drawers (model/containers.ts): whether the cabinet itself is open and which compartments hold items; if
  // the item is inside a cabinet, which one (keeps the cabinet open on hover; in a drawer it slides out with the drawer)
  const opens = OPENS(item.kind)
  const open = useBinOpen(opens && !still ? item.id : null)
  useEffect(() => {
    if (opens) binsDebug[item.id] = open
  }, [opens, open, item.id])
  // Sound when a door or drawer opens or closes (audio/shots.ts); not for those opened all at once on a mode switch
  const lastOpen = useRef<{ open: boolean; edit: boolean } | null>(null)
  useEffect(() => {
    if (!opens) return
    const prev = lastOpen.current
    lastOpen.current = { open, edit }
    if (!prev || prev.open === open || prev.edit !== edit) return
    const drawer = DRAWER_KINDS.includes(item.kind)
    play(drawer ? (open ? 'drawerOpen' : 'drawerClose') : open ? 'cabinetOpen' : 'cabinetClose', { x: item.x, y: 0.6, z: item.z }, { gain: 0.8 })
  }, [opens, open, edit, item.kind, item.x, item.z])
  const partsKey = useLayout((s) => {
    if (!opens) return ''
    const lv = lvOf(s)
    if (!lv) return ''
    return [...new Set(contentsOf(lv.items, item).map((it) => containerOf(lv.items, it)?.index ?? -1))].sort().join(',')
  })
  const openParts = useMemo(() => (partsKey ? partsKey.split(',').map(Number) : undefined), [partsKey])
  const inBox = useLayout((s) => {
    const lv = lvOf(s)
    const c = lv && !opens ? containerOf(lv.items, item) : null
    return c ? `${c.box.id}|${c.comp.drawer ? 1 : 0}|${c.box.rot}` : ''
  })
  const [boxId, inDrawer, boxRot] = inBox ? inBox.split('|') : [null, '0', '0']
  const boxOpen = useBinOpen(still ? null : boxId)
  // An item in a drawer slides forward with the drawer when it opens (towards the cabinet front, in the item's own frame)
  const ride = useRef<THREE.Group>(null)
  const slide = inDrawer === '1' && boxOpen ? DRAWER_SLIDE : 0
  const rideTo: [number, number] = [Math.sin(Number(boxRot) - item.rot) * slide, Math.cos(Number(boxRot) - item.rot) * slide]
  useFrame((state, dt) => {
    const g = ride.current
    if (!g) return
    const dx = rideTo[0] - g.position.x
    const dz = rideTo[1] - g.position.z
    if (Math.abs(dx) < 0.0005 && Math.abs(dz) < 0.0005) return
    const k = Math.min(1, dt * 6)
    g.position.x += dx * k
    g.position.z += dz * k
    state.invalidate()
  })

  const v: Visual = useMemo(() => {
    const opening = { related, interior, hingeRight, swingOut, edit, opts, at: { x: item.x, z: item.z, rot: item.rot, y: item.y } }
    if (!entity) return { ...OFF_VISUAL, bound: Boolean(item.entityId), night, unavailable: Boolean(item.entityId), ...opening, open: open ? 1 : 0, openParts }
    const on = isActive(entity)
    return {
      ...opening,
      bound: true,
      on,
      // The light intensity factor (Item.intensity) is applied to the shown level: bulbs, strips and glows shine with it.
      level: (isLightKind(item.kind) ? lightLevel(entity) : on ? 1 : 0) * (intensity ?? 1),
      color: lightColor(entity),
      unavailable: isUnavailable(entity),
      state: entity.state,
      attrs: entity.attributes,
      domain: domainOf(entity.entity_id),
      night,
      open: open ? 1 : 0,
      openParts,
    }
  }, [entity, item.entityId, item.kind, item.x, item.z, item.rot, item.y, night, related, interior, hingeRight, swingOut, edit, opts, intensity, open, openParts])

  const y = item.y ?? DEFAULT_Y[item.kind] ?? 0
  // The model is not re-rendered unless its look changes (selection, hover and floor change only update this node)
  const model = useMemo(() => <Comp v={v} />, [Comp, v])

  /*
   * In view mode pressing does nothing (the camera pans, a click selects).
   * In edit mode pressing prepares a drag; the move starts once the pointer travels DRAG_PX.
   * While moving the rules are checked (the ring turns red); dropped on an invalid spot, the item goes back.
   */
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const s = useLayout.getState()
    if (s.mode !== 'edit' || s.tool !== 'select' || e.button !== 0 || busy()) return
    if (!e.ray.intersectPlane(plane, hit)) return
    e.stopPropagation()
    drag.current = { ox: item.x - hit.x, oz: item.z - hit.z, sx: e.nativeEvent.clientX, sy: e.nativeEvent.clientY, started: false }
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    cameraApi.setEnabled(false)
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || !e.ray.intersectPlane(plane, hit)) return
    if (!d.started) {
      if (Math.hypot(e.nativeEvent.clientX - d.sx, e.nativeEvent.clientY - d.sy) < DRAG_PX) return
      d.started = true
      useLayout.getState().checkpoint()
      useLayout.getState().select({ type: 'item', id: item.id })
    }
    const level = activeLevel(useLayout.getState())
    if (!level) return
    let x = snap(hit.x + d.ox, 0.05)
    let z = snap(hit.z + d.oz, 0.05)
    let rot = item.rot
    let onWall = true
    let ny: number | undefined
    // A wall mounted item keeps its height while moved and always snaps to a wall.
    const mounted = isWallMounted(item.kind, item.variant, item.mount)
    if (STACKABLE.includes(item.kind) && !mounted) ny = surfaceAt(level.items, x, z, item.id)?.y ?? shelfAt(level.items, x, z, item.kind, item.id)
    if (snapsToWall(item.kind, item.mount) && (ny == null || mounted)) {
      const w = wallSnap(level.rooms, x, z, meta.size[1], 0.6, sizeOf(item.kind, item.len)[0], isAperture(item.kind), item.mount === 'wall')
      if (w) ({ x, z, rot } = w)
      else onWall = false
    }
    // Appliance stack: after snapping to the wall it climbs onto a machine below it, if there is one.
    if (APPLIANCE_STACK.includes(item.kind)) ny = surfaceAt(level.items, x, z, item.id, APPLIANCE_STACK)?.y
    // A TV on a stand climbs onto the unit/table below it after snapping to the wall; a wall mounted TV stays hung above the floor.
    if (item.kind === 'tv' && !mounted) ny = surfaceAt(level.items, x, z, item.id)?.y
    if (mounted) ny = item.y
    // An item inside a cabinet stays in its compartment while dragged inside the cabinet (does not climb on top)
    const cur = level.items.find((i) => i.id === item.id) ?? item
    const box = !mounted ? containerOf(level.items, cur) : null
    if (box) {
      const { lx, lz } = toLocal(box.box, x, z)
      const [bw, bd] = sizeOf(box.box.kind, box.box.len)
      if (Math.abs(lx) < bw / 2 - 0.03 && Math.abs(lz) < bd / 2) ny = cur.y
    }
    const chk = checkItem(level, { kind: item.kind, x, z, rot, y: ny, swing: item.swing, len: item.len, len2: item.len2, variant: item.variant, mount: item.mount }, item.id, onWall)
    usePlacement.getState().setMoving({ id: item.id, ok: chk.ok, reason: chk.reason })
    if (x !== item.x || z !== item.z || rot !== item.rot || ny !== item.y) {
      // Moving a cabinet carries its contents along (their local positions are kept)
      if (INTERIOR[item.kind]) for (const c of carryPatches(level.items, cur, { x, z, rot })) useLayout.getState().updateItem(c.id, c.patch, false)
      useLayout.getState().updateItem(item.id, { x, z, rot, y: ny }, false)
    }
  }

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    cameraApi.setEnabled(true)
    const m = usePlacement.getState().moving
    if (d.started && m?.id === item.id && !m.ok) {
      useLayout.getState().revertCheckpoint()
      useHa.setState({ notice: t('Cannot place it here: {reason}. The item went back to where it was.', { reason: m.reason ?? t('invalid spot') }) })
    }
    usePlacement.getState().setMoving(null)
  }

  return (
    <group ref={outer} position={[item.x, 0, item.z]} rotation-y={item.rot}>
      <group
        ref={inner}
        position={[0, y, 0]}
        userData={{ itemId: item.id }}
        onPointerDown={interactive ? onDown : undefined}
        onPointerMove={interactive ? onMove : undefined}
        onPointerUp={interactive ? onUp : undefined}
        onClick={still ? undefined : (e) => {
          const s = useLayout.getState()
          // An unlinked item is not clickable but does not pass the click through either (a sofa in front must not toggle the lamp behind it)
          if (!interactive) return e.stopPropagation()
          // In first person walk mode with a locked pointer FpsControls handles the click (crosshair)
          if (document.pointerLockElement) return
          if (s.tool !== 'select' || e.delta > clickSlop(pointerKind.last) || busy()) return
          e.stopPropagation()
          // Cabinet, dresser, drawer in view mode: a click opens the door, another click closes it (no card opens).
          // On a cabinet with a linked light (such as an under-counter LED) a tap does not open the doors but the pill,
          // which offers both the LED and the doors; with a mouse the pill already shows on hover, so a click opens the doors
          if (s.mode === 'view' && opens && isTouchPointer() && quickTarget(entity, related)) {
            pointAt(item.id, e.point)
            useQuick.getState().show(item.id, true)
            return
          }
          if (s.mode === 'view' && opens) return useBins.getState().toggle(item.id)
          // On touch in view mode a tap toggles the item directly; the pill stays for a few seconds with "Details".
          // A mouse click does the same on the demo home's locally simulated devices; in other homes a click opens the detail
          // card (so a real device is not toggled by accident)
          const touch = isTouchPointer()
          const sim = s.mode === 'view' ? quickTarget(entity, related) : null
          if (sim && isSimulated(sim.entity_id)) {
            void toggle(sim)
            pointAt(item.id, e.point)
            useQuick.getState().show(item.id, true)
            return
          }
          if (touch && s.mode === 'view') {
            const target = quickTarget(entity, related)
            if (target) {
              void toggle(target)
              pointAt(item.id, e.point)
              useQuick.getState().show(item.id, true)
              return
            }
          }
          // In edit mode ⌘-click (Ctrl on Windows) adds the item to or removes it from the multi selection (to group lights).
          // ⇧ and ⌥ are not used because they rotate the camera.
          if ((e.nativeEvent.metaKey || e.nativeEvent.ctrlKey) && s.mode === 'edit') {
            const cur = s.multi ?? { rooms: [], items: s.selection?.type === 'item' ? [s.selection.id] : [] }
            const items = cur.items.includes(item.id) ? cur.items.filter((x) => x !== item.id) : [...cur.items, item.id]
            s.setMulti({ rooms: cur.rooms, items })
            return
          }
          s.select({ type: 'item', id: item.id })
        }}
        onDoubleClick={still ? undefined : (e) => {
          if (!interactive || busy()) return
          e.stopPropagation()
          cameraApi.focusPoint(item.x, Math.min(1.2, y + 0.5), item.z)
        }}
        onPointerOver={still ? undefined : (e) => {
          e.stopPropagation()
          if (document.pointerLockElement) return
          if (!interactive) return
          setHover(true)
          if (!edit && !busy()) {
            pointAt(item.id, e.point)
            useQuick.getState().show(item.id)
          }
        }}
        onPointerOut={still ? undefined : () => {
          setHover(false)
          if (!edit) useQuick.getState().leave()
        }}
      >
        <group ref={ride}>{model}</group>
      </group>
      <ItemSelection item={item} mode={single ? 'single' : inMulti ? 'multi' : (hover && interactive && !busy()) || aimed ? 'hover' : 'none'} bad={bad} target={inner} frame={outer} />
    </group>
  )
}
