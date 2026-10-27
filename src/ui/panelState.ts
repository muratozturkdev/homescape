import { create } from 'zustand'

/*
 * The card panel on the right (ui/Inspector.tsx), resizable and closable so it fits tablets. On wide screens (1024 px and
 * up) it is a column on the right: dragging its left edge narrows or widens it (a double click restores the default); on
 * narrow screens it is a bottom sheet that the handle on top raises or lowers. Both can be closed and opened. Remembered.
 * The camera framing (scene/camera.ts), the quick pill (ui/quickState.ts), the tool column and the middle bars follow the
 * real width of the panel (CSS variables --panel, --panel-w, --sheet). This file has no three import.
 */

const KEY = 'homescape-panel'
export const PANEL_MIN = 280
export const PANEL_MAX = 620
export const PANEL_DEFAULT = 380
/** Height limits of the bottom sheet on narrow screens (fraction of the screen) */
export const SHEET_MIN = 0.2
export const SHEET_MAX = 0.8
export const SHEET_DEFAULT = 0.5
/** Right margin of the panel (16) and the gap to the tool column (12: the width handle is there) */
const GAP = 28
export const WIDE_PX = 1024

interface Prefs {
  open: boolean
  width: number
  sheet: number
}
interface PanelState extends Prefs {
  setOpen: (open: boolean) => void
  toggle: () => void
  setWidth: (w: number) => void
  setSheet: (f: number) => void
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** On wide screens the panel is at most half the screen */
export const maxWidth = (vw: number) => Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(vw * 0.5)))

function read(): Prefs {
  const d: Prefs = { open: true, width: PANEL_DEFAULT, sheet: SHEET_DEFAULT }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null
    if (!v || typeof v !== 'object') return d
    return {
      open: typeof v.open === 'boolean' ? v.open : d.open,
      width: typeof v.width === 'number' ? clamp(v.width, PANEL_MIN, PANEL_MAX) : d.width,
      sheet: typeof v.sheet === 'number' ? clamp(v.sheet, SHEET_MIN, SHEET_MAX) : d.sheet,
    }
  } catch {
    return d
  }
}
function write(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: valid for this session */
  }
}

export const usePanel = create<PanelState>((set, get) => {
  const save = (patch: Partial<Prefs>) => {
    set(patch)
    const { open, width, sheet } = get()
    write({ open, width, sheet })
  }
  return {
    ...read(),
    setOpen: (open) => save({ open }),
    toggle: () => save({ open: !get().open }),
    setWidth: (w) => save({ width: clamp(Math.round(w), PANEL_MIN, PANEL_MAX) }),
    setSheet: (f) => save({ sheet: clamp(f, SHEET_MIN, SHEET_MAX) }),
  }
})

/** Space the panel takes on the right on wide screens (px, margins included); 0 when closed or on narrow screens */
export function panelSpace(vw = window.innerWidth) {
  const p = usePanel.getState()
  return vw >= WIDE_PX && p.open ? Math.min(p.width, maxWidth(vw)) + GAP : 0
}

/** Largest height fraction the bottom sheet takes on narrow screens; 0 when closed */
export function sheetSpace() {
  const p = usePanel.getState()
  return p.open ? p.sheet : 0
}

/** CSS variables: --panel (space on the right; when closed the tool column sits at the edge), --panel-w, --sheet */
export function applyPanelVars() {
  const vw = window.innerWidth
  const p = usePanel.getState()
  const root = document.documentElement.style
  const w = Math.min(p.width, maxWidth(vw))
  root.setProperty('--panel', `${p.open ? w + GAP : 16}px`)
  root.setProperty('--panel-w', `${w}px`)
  root.setProperty('--sheet', `${Math.round(p.sheet * 100)}%`)
}
