import { useEffect } from 'react'
import { useHa } from '@/ha/store'
import { ceilingFit } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { presetRects, usePlacement, type PlaceTarget } from '@/model/placement'
import { t } from '@/i18n'

/*
 * Placement input (like in a game):
 * - Press and hold a card, drag it into the scene, release: it is placed.
 * - Tap a card and release: switches to "click to place" mode; it goes where you click in the scene.
 * - Releasing with ⇧ held keeps the tool on, so you can place several in a row.
 * - Releasing on an invalid spot places nothing and shows the reason. Right click or Esc cancels.
 */

let pressAt: { x: number; y: number } | null = null

export function beginCardDrag(target: PlaceTarget, e: React.PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  pressAt = { x: e.clientX, y: e.clientY }
  useLayout.getState().select(null)
  usePlacement.getState().start(target, 'drag')
  usePlacement.getState().pointer(e.clientX, e.clientY, false)
}

const overCanvas = (x: number, y: number) => document.elementFromPoint(x, y)?.tagName === 'CANVAS'

function commit(keep: boolean) {
  const p = usePlacement.getState()
  const { target, result } = p
  if (!target || !result) return
  if (!result.ok) {
    useHa.setState({ notice: t("Can't place it here: {reason}", { reason: result.reason ?? t('invalid spot') }) })
    if (p.via === 'drag') p.cancel()
    return
  }
  const L = useLayout.getState()
  if (target.type === 'item') {
    // A ceiling strip fits the room part it is dropped on (Ghost draws it at the same spot)
    const fit = target.kind === 'ceilingStrip' ? ceilingFit(activeLevel(L)?.rooms ?? [], result.x, result.z) : null
    if (fit) L.addItem('ceilingStrip', fit.x, fit.z, 0, target.entityId ?? null, undefined, { len: fit.len, len2: fit.len2 })
    else
      L.addItem(target.kind, result.x, result.z, result.rot, target.entityId ?? null, result.y, {
        ...target.extra,
        ...(target.kind === 'tv' ? { variant: result.y != null ? 'stand' : 'wall' } : {}),
      })
  } else {
    const n = (activeLevel(L)?.rooms.length ?? 0) + 1
    const [main, ...parts] = presetRects(target.preset, result.rot).map((r) => ({ ...r, x: r.x + result.x, z: r.z + result.z }))
    L.addRoom({ name: target.preset.name ?? t('Room {n}', { n }), ...main, ...(parts.length ? { parts } : {}), floor: target.preset.floor ?? 'wood', areaId: null, ...(target.preset.type ? { type: target.preset.type } : {}) })
  }
  // An item linked to an entity is placed once; others can be placed in a row with ⇧
  if (!keep || (target.type === 'item' && target.entityId)) p.cancel()
}

export function usePlacementInput() {
  useEffect(() => {
    let canvasDown: { x: number; y: number } | null = null

    const onMove = (e: PointerEvent) => {
      const p = usePlacement.getState()
      if (p.target) p.pointer(e.clientX, e.clientY, overCanvas(e.clientX, e.clientY))
    }
    const onDown = (e: PointerEvent) => {
      const p = usePlacement.getState()
      if (!p.target || p.via !== 'click') return
      if (e.button === 2) return p.cancel()
      if (e.button === 0 && overCanvas(e.clientX, e.clientY)) canvasDown = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      const p = usePlacement.getState()
      if (!p.target) return
      if (p.via === 'drag') {
        const moved = pressAt ? Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) : 99
        pressAt = null
        if (moved < 6) {
          // The card was tapped and released: switch to click to place mode
          usePlacement.setState({ via: 'click' })
          return
        }
        if (overCanvas(e.clientX, e.clientY)) commit(e.shiftKey)
        else p.cancel()
        return
      }
      if (canvasDown && e.button === 0 && Math.hypot(e.clientX - canvasDown.x, e.clientY - canvasDown.y) < 6 && overCanvas(e.clientX, e.clientY)) commit(e.shiftKey)
      canvasDown = null
    }
    const onContext = (e: MouseEvent) => {
      if (usePlacement.getState().target) {
        e.preventDefault()
        usePlacement.getState().cancel()
      }
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('contextmenu', onContext, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('contextmenu', onContext, true)
    }
  }, [])
}
