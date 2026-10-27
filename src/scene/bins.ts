import { create } from 'zustand'
import { containerOf, contentsOf } from '@/model/containers'
import { activeLevel, useLayout } from '@/model/layoutStore'

/*
 * Openness of cabinet doors (items can be placed inside cabinets, drawers and anything that opens; model/containers.ts).
 * In edit mode a cabinet stays open when it holds items or when it or an item inside it is selected (the inside is visible,
 * items can be moved). In view mode it is closed; clicking the door opens it, clicking again closes it (not on hover;
 * useBins.toggle; in walk mode a click with the crosshair or E). A linked device inside (such as a boiler) is reachable
 * while the cabinet is open.
 */

interface BinState {
  /** Cabinets opened by a click in view mode */
  open: Record<string, boolean>
  toggle: (id: string) => void
  close: (id: string) => void
}

/** Tests and debugging: last openness of the cabinets (written by ItemNode) */
export const binsDebug: Record<string, boolean> = {}

export const useBins = create<BinState>((set, get) => ({
  open: {},
  toggle: (id) => {
    const rest = { ...get().open }
    if (rest[id]) delete rest[id]
    else rest[id] = true
    set({ open: rest })
  },
  close: (id) => {
    if (!get().open[id]) return
    const rest = { ...get().open }
    delete rest[id]
    set({ open: rest })
  },
}))

/** Whether cabinet (id) is open now: in edit mode when it holds items or it / an item inside is selected, in view mode when clicked open. */
export function useBinOpen(boxId: string | null) {
  const edit = useLayout((s) => s.mode === 'edit')
  const hot = useBins((s) => (boxId ? Boolean(s.open[boxId]) : false))
  const selected = useLayout((s) => {
    if (!boxId || s.selection?.type !== 'item') return false
    if (s.selection.id === boxId) return s.mode === 'edit'
    const lv = activeLevel(s)
    const it = lv?.items.find((i) => i.id === s.selection!.id)
    return Boolean(lv && it && containerOf(lv.items, it)?.box.id === boxId)
  })
  const filled = useLayout((s) => {
    if (!boxId || s.mode !== 'edit') return false
    const lv = activeLevel(s)
    const box = lv?.items.find((i) => i.id === boxId)
    return Boolean(lv && box && contentsOf(lv.items, box).length)
  })
  if (!boxId) return false
  return edit ? filled || selected : hot || selected
}
