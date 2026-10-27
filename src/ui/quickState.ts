import { create } from 'zustand'
import { canToggle } from '@/ha/actions'
import type { HassEntity } from '@/ha/types'
import { useLayout } from '@/model/layoutStore'
import type { Item } from '@/model/types'
import { panelSpace, WIDE_PX } from './panelState'

/*
 * State of the quick on/off pill: hovering an item shows a button that toggles it; on touch screens one tap does it.
 * There is a single pill (ui/QuickPill.tsx, mounted once in App); which item it belongs to lives here, and
 * scene/QuickAnchor.tsx writes its screen position every frame (no React redraw). This file has no three import (the
 * main UI bundle must not pull in three).
 *
 * Mouse: the pill appears after a short pause on an item (so it does not flash on every item the cursor passes) and waits
 * a little after the cursor leaves so the cursor can reach it. While the pill is open, it moves to another item only if
 * the cursor stays on that item for a moment (an item on the way to the pill must not steal it). A pill opened by touch
 * (pinned) disappears when its time runs out, on a tap outside it or when the camera turns elsewhere.
 */

/** Delays (ms): first show, switching items while the pill is open, switching while moving toward the pill, hiding after leaving */
const SHOW_MS = 90
const SWITCH_MS = 140
const LEAVING_MS = 320
const LEAVE_MS = 420
/** A pill opened by touch stays this long (renewed by each touch on the pill) */
const PIN_MS = 5000

interface QuickState {
  /** Item whose pill is shown */
  id: string | null
  /** Opened by touch (or by a click in the sample home): disappears when the time runs out, not when the cursor leaves */
  pinned: boolean
  show: (id: string, pinned?: boolean) => void
  /** The cursor left the item or the pill: hide after a short wait */
  leave: () => void
  /** The cursor (or finger) is on the pill: cancel hiding, renew the time of a pinned pill */
  keep: () => void
  /** The cursor moved to something else (a pet): it is not heading for the pill, so it hides at once (a pinned pill stays) */
  dismiss: () => void
  hide: () => void
}

/**
 * World point where the cursor (or finger) touches the item: the pill sits horizontally in line with it, just above the
 * cursor (on a tall item, e.g. not at the top of a pendant's cord). Not state: changing it does not redraw React.
 */
export const quickPoints = new Map<string, { x: number; y: number; z: number }>()
/** Stores the pointed point (on hover or touch), per item (it stays until the pill moves to another item) */
export function pointAt(id: string, p: { x: number; y: number; z: number } | undefined) {
  if (!p) return
  if (quickPoints.size > 64) quickPoints.clear()
  quickPoints.set(id, { x: p.x, y: p.y, z: p.z })
}

let showTimer: ReturnType<typeof setTimeout> | undefined
let leaveTimer: ReturnType<typeof setTimeout> | undefined
/** The cursor just left the item with the pill (it may be heading for the pill) */
let leaving = false

export const useQuick = create<QuickState>((set, get) => {
  const clear = () => {
    clearTimeout(showTimer)
    clearTimeout(leaveTimer)
  }
  const pinTimer = () => {
    clearTimeout(leaveTimer)
    leaveTimer = setTimeout(() => set({ id: null, pinned: false }), PIN_MS)
  }
  return {
    id: null,
    pinned: false,
    show: (id, pinned = false) => {
      if (pinned) {
        clear()
        leaving = false
        set({ id, pinned: true })
        pinTimer()
        return
      }
      const cur = get()
      if (cur.pinned) return
      clearTimeout(leaveTimer)
      clearTimeout(showTimer)
      if (cur.id === id) {
        leaving = false
        return
      }
      const delay = !cur.id ? SHOW_MS : leaving ? LEAVING_MS : SWITCH_MS
      showTimer = setTimeout(() => {
        leaving = false
        set({ id, pinned: false })
      }, delay)
    },
    leave: () => {
      clearTimeout(showTimer)
      if (get().pinned || !get().id) return
      leaving = true
      clearTimeout(leaveTimer)
      leaveTimer = setTimeout(() => {
        leaving = false
        set({ id: null })
      }, LEAVE_MS)
    },
    keep: () => {
      clearTimeout(showTimer)
      leaving = false
      if (get().pinned) pinTimer()
      else clearTimeout(leaveTimer)
    },
    hide: () => {
      clear()
      leaving = false
      set({ id: null, pinned: false })
    },
    dismiss: () => {
      if (get().pinned) return
      clear()
      leaving = false
      if (get().id) set({ id: null })
    },
  }
})

/**
 * Item whose pill is shown: the hovered (or touched) item; a selected item has no pill. Only one thing is open at a time:
 * hovering shows only the quick pill; clicking (selecting) shows only the detail card on the right, the pill closes, and in
 * view mode the status tag above the item does not appear either (ui/PinLayer.tsx > SelectedTag). Hovering another item
 * while one is selected shows that item's pill.
 */
export function useQuickId() {
  const hover = useQuick((s) => s.id)
  const selected = useLayout((s) => (s.mode === 'view' && s.selection?.type === 'item' ? s.selection.id : null))
  return hover && hover !== selected ? hover : null
}

/** Whether the item has a pill (a linked entity, or an extra that can be toggled) */
export function hasQuick(item: Item, entities: Record<string, HassEntity>) {
  if (item.entityId && entities[item.entityId]) return true
  return (item.extras ?? []).some((id) => canToggle(entities[id]))
}

/** Entity the quick button controls: the main entity if it can be toggled, else the first extra that can */
export function quickTarget(entity: HassEntity | undefined, related: HassEntity[]) {
  if (entity && canToggle(entity)) return entity
  return related.find((e) => canToggle(e))
}

/** DOM element of the pill (registered by ui/QuickPill.tsx); the scene writes its position */
export const quickPill = { el: null as HTMLDivElement | null }

/** Space taken by the top / bottom bars (px): the pill does not cover them (right panel: ui/panelState.ts > panelSpace) */
const TOP_PX = 64
const BOTTOM_PX = 84
const GAP = 10
/** The pill is at most this far above the cursor (px): when the top of the item is higher, the pill stays near the cursor */
const REACH = 40

/** Last written position: the DOM is not touched when it has not changed */
let last = ''

/**
 * Positions the pill (called every frame by scene/QuickAnchor.tsx). box: the item's box on screen; at: screen position of
 * the pointed point (else the middle of the box). Horizontally the pill is in line with the pointed point; vertically
 * above the top of the item but at most REACH px above the cursor; below the cursor when there is no room above. It stays
 * inside the screen edges, the right panel and the bars. box null: the item is off screen (the pill hides).
 */
export function placePill(box: { left: number; right: number; top: number; bottom: number } | null, panel: boolean, at?: { x: number; y: number }) {
  const el = quickPill.el
  if (!el) return
  if (!box) {
    if (last !== 'hidden') {
      el.style.visibility = 'hidden'
      last = 'hidden'
    }
    return
  }
  const w = el.offsetWidth
  const h = el.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const right = vw - (panel ? panelSpace(vw) : 0) - 8
  // Below the top bar (lower by the status bar height in the home screen app)
  const minY = (document.querySelector('header')?.getBoundingClientRect().bottom ?? TOP_PX) + 6
  // On narrow screens it does not cover the open bottom sheet (the right panel)
  let floor = vh - BOTTOM_PX
  if (panel && vw < WIDE_PX) {
    const sheet = document.getElementById('side-panel')
    if (sheet?.dataset.open === '1') {
      const r = sheet.getBoundingClientRect()
      if (r.height > 0 && r.top < floor) floor = r.top - 4
    }
  }
  const maxY = floor - h - 6
  const px = at ? Math.max(box.left, Math.min(box.right, at.x)) : (box.left + box.right) / 2
  const py = at ? Math.max(box.top, Math.min(box.bottom, at.y)) : (box.top + box.bottom) / 2
  let x = px - w / 2
  x = Math.max(8, Math.min(right - w, x))
  let y = Math.max(box.top, py - REACH) - GAP - h
  let below = false
  if (y < minY) {
    // No room above: below the cursor (clear of the cursor icon)
    y = Math.min(box.bottom, py + 28) + GAP
    below = true
  }
  y = Math.max(minY, Math.min(maxY, y))
  // It does not cover the info tiles at the top (#kpi-tiles): it moves below the cursor, else below the tiles. Each tile
  // counts on its own: when the tiles wrap into two rows, the empty end of the second row stays free
  const tiles = [...(document.getElementById('kpi-tiles')?.children ?? [])].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0)
  const hits = (yy: number) => tiles.some((r) => x < r.right + 6 && x + w > r.left - 6 && yy < r.bottom + 6 && yy + h > r.top - 6)
  const kpi = tiles.length ? { bottom: Math.max(...tiles.map((r) => r.bottom)) } : null
  if (hits(y)) {
    const under = Math.max(minY, Math.min(maxY, Math.min(box.bottom, py + 28) + GAP))
    y = hits(under) && kpi ? Math.min(maxY, kpi.bottom + 8) : under
    below = true
  }
  const key = `${Math.round(x)},${Math.round(y)},${below ? 1 : 0}`
  if (key === last) return
  last = key
  el.style.visibility = 'visible'
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
  el.dataset.side = below ? 'below' : 'above'
}

/** When the pill is remounted (another item) the position is written again */
export function resetPill() {
  last = ''
}
