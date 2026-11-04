import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { floorNumber, t } from '@/i18n'
import { asMain, foldTvBacklights, isBound, primaryFirst, withBinding, withoutBinding } from './bindings'
import { connectRooms } from './doors'
import { areaContents, inRoom, rectsOf, settleWallItems, shiftRoom } from './geometry'
import { dropLoneGroups, groupMates } from './groups'
import { splitTvUnits } from './migrate'
import { edgePatch, shiftItemsWithEdge, type Edge } from './resize'
import { uid } from './ids'
import type { Item, ItemKind, Layout, Level, Rect, Room, Selection } from './types'

/*
 * House plan state: plan, selection, mode, tool and undo / redo history.
 * Persistence: in the browser (localStorage). A drag does not write every frame to the history; checkpoint() is called
 * once when the drag starts, then updates use record: false.
 */

export type Mode = 'view' | 'edit'
/** select: select/move · room: draw a free room · part: draw a part onto the selected room (L, T, U) · area: area select (bulk delete) */
export type Tool = 'select' | 'room' | 'part' | 'area'

/**
 * A home (several homes can be added and switched between). The active home's plan lives in `layout` (the whole app reads
 * it); the plans of the other homes are kept here. All homes use the same Home Assistant.
 */
export interface HomeEntry {
  id: string
  name: string
  /** Plan and last open level of an inactive home (empty for the active home) */
  layout?: Layout | null
  levelId?: string | null
}

/** Height between levels (wall 2.6 + slab 0.2): lower levels are drawn this far down in the scene. */
export const FLOOR_H = 2.8

/** Rooms and items picked by area select (for bulk delete; not persisted). */
export interface MultiSelection {
  rooms: string[]
  items: string[]
}
export type Theme = 'auto' | 'day' | 'night'

const HISTORY = 60

const STORE_KEY = 'homescape-layout-v1'
/** Format of saved plans; plans in Home Assistant carry it too (ha/planSync.ts) */
export const STORE_VERSION = 5

/** Writes a copy of the raw record to a separate key (silently skipped when storage is unavailable). */
function keepCopy(key: string, raw: string | null) {
  if (!raw) return
  try {
    localStorage.setItem(key, raw)
  } catch {
    /* storage full or unavailable */
  }
}

/*
 * Save guard (a user's edited plan was once lost this way): if the migration throws, zustand does not load the plan, the
 * app thinks there is no plan, builds the demo home and overwrites the record on the first change. During development,
 * saving layoutStore.ts makes the open page rerun the module and read the record again, so half-written migration code can
 * wipe real data. Safeguards:
 * 1. If the record has an older version, its raw form is copied to `homescape-layout-v1-backup-s<version>` BEFORE migrating.
 * 2. The migration never throws: on an error the plan loads as it is, unmigrated.
 * 3. If loading still fails, the raw record is copied to `homescape-layout-v1-rescue` before it can be overwritten.
 */

/**
 * Older versions named these keys `-yedek-s<version>` and `-kurtarma` (Turkish for backup and rescue). Renames them once:
 * the value is copied when the new key is missing, then the old key is removed. Never throws.
 */
function renameBackupKeys() {
  try {
    const oldKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith(`${STORE_KEY}-yedek-s`) || k === `${STORE_KEY}-kurtarma`)) oldKeys.push(k)
    }
    for (const k of oldKeys) {
      const next = k === `${STORE_KEY}-kurtarma` ? `${STORE_KEY}-rescue` : `${STORE_KEY}-backup-s${k.slice(`${STORE_KEY}-yedek-s`.length)}`
      try {
        const raw = localStorage.getItem(k)
        if (raw != null && localStorage.getItem(next) == null) localStorage.setItem(next, raw)
        if (localStorage.getItem(next) != null) localStorage.removeItem(k)
      } catch {
        /* storage full: the old key stays */
      }
    }
  } catch {
    /* storage unavailable */
  }
}
renameBackupKeys()

const guardedStorage = createJSONStorage<Partial<LayoutState>>(() => ({
  getItem: (name) => {
    const raw = localStorage.getItem(name)
    if (!raw) return raw
    try {
      const v = (JSON.parse(raw) as { version?: unknown }).version
      if (typeof v === 'number' && v !== STORE_VERSION) keepCopy(`${name}-backup-s${v}`, raw)
    } catch {
      keepCopy(`${name}-rescue`, raw)
    }
    return raw
  },
  // A full browser storage must not break editing: the app shows a notice (App.tsx)
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      window.dispatchEvent(new Event('homescape:storage-failed'))
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
}))

interface LayoutState {
  layout: Layout | null
  levelId: string | null
  mode: Mode
  tool: Tool
  selection: Selection
  /** Area selection (bulk): never at the same time as a single selection */
  multi: MultiSelection | null
  theme: Theme
  past: Layout[]
  future: Layout[]
  /** Entities the automatic plan could not place */
  unplaced: string[]
  /** Last plan cleared with "Start over": kept so it can be restored (persisted) */
  backup: { layout: Layout; at: string } | null
  /** Homes (empty: a single home, "My home") and the id of the active home */
  homes: HomeEntry[]
  homeId: string | null

  setLayout: (layout: Layout, unplaced?: string[]) => void
  /** Clears the plan (rooms, items, doors) after backing it up. The HA connection and the theme stay. */
  clearAll: () => void
  /** Brings back the cleared plan (the current plan goes into the undo history) */
  restoreBackup: () => void
  setMode: (mode: Mode) => void
  setTool: (tool: Tool) => void
  select: (sel: Selection) => void
  setMulti: (m: MultiSelection | null) => void
  /** Deletes the rooms (with everything in them) and items of the area selection in one undo step */
  deleteMulti: () => void
  setTheme: (theme: Theme) => void

  checkpoint: () => void
  /** Go back to the last checkpoint and drop it from the history (to undo a drag dropped at an invalid spot) */
  revertCheckpoint: () => void
  undo: () => void
  redo: () => void

  addRoom: (r: Omit<Room, 'id'>) => string
  updateRoom: (id: string, patch: Partial<Room>, record?: boolean) => void
  moveRoom: (id: string, dx: number, dz: number) => void
  deleteRoom: (id: string) => void
  /**
   * Moves an edge of the room (part = -1) or of one of its parts to v; items near that wall slide along, items hit by the
   * wall while shrinking are pushed (model/resize.ts). Validation (minimum size, overlap) is up to the caller.
   */
  resizeEdge: (roomId: string, part: number, edge: Edge, v: number, record?: boolean) => void
  /** Add / change / remove a rectangular part of a room (L, T, U shape). index: position in the parts array */
  addPart: (roomId: string, rect: Rect) => void
  updatePart: (roomId: string, index: number, patch: Partial<Rect>, record?: boolean) => void
  removePart: (roomId: string, index: number) => void

  addItem: (kind: ItemKind, x: number, z: number, rot?: number, entityId?: string | null, y?: number, extra?: Partial<Item>) => string
  updateItem: (id: string, patch: Partial<Item>, record?: boolean) => void
  deleteItem: (id: string) => void
  duplicateItem: (id: string) => void
  /** Adds several items in one undo step (like automatic interior doors) */
  addItems: (items: Item[]) => void

  /** Bind an HA entity to an item (main if there is none, else an extra). For a grouped item, to the whole group (model/groups.ts). */
  bind: (itemId: string, entityId: string) => void
  unbind: (itemId: string, entityId: string) => void
  makeMain: (itemId: string, entityId: string) => void
  /** Makes the items one group: the bindings of the first bound member are copied to all. Returns the group id. */
  groupItems: (ids: string[]) => string | null
  /** Removes the item from its group (its bindings stay); a group left with one member dissolves. */
  ungroupItem: (id: string) => void

  /** Adds a new (empty) home and switches to it. Returns its id. */
  addHome: (name: string) => string
  /** Switches to another home: the current home's plan is stored, the chosen one's plan opens (the undo history resets). */
  switchHome: (id: string) => void
  renameHome: (id: string, name: string) => void
  /** Deletes a home (not the last one); deleting the active home switches to another one. */
  deleteHome: (id: string) => void

  /** Adds a level (on top, or a basement with below) and switches to it; copyRooms copies the current level's rooms (except gardens). */
  addLevel: (opts?: { below?: boolean; copyRooms?: boolean }) => string | null
  setLevel: (id: string) => void
  renameLevel: (id: string, name: string) => void
  /** Compass direction of the top of the plan (degrees, 0 north): the sun's angle relative to the house (Layout.up). */
  setBearing: (deg: number) => void
  /** Deletes a level with everything on it (not the last one). */
  deleteLevel: (id: string) => void
}

/** Saved homes; old records (no home list) have a single home, "My home". */
export const homesOf = (s: Pick<LayoutState, 'homes' | 'homeId'>): HomeEntry[] => (s.homes?.length ? s.homes : [{ id: s.homeId ?? 'home-main', name: t('My home') }])
export const activeHomeId = (s: Pick<LayoutState, 'homes' | 'homeId'>) => s.homeId ?? homesOf(s)[0].id

/**
 * Level name stored by old versions for the single level of a new plan (Turkish for "Home"). Saved data: it still counts as
 * no name. New plans store an empty name.
 */
const LEGACY_LEVEL_NAME = 'Ev'
/** Whether the level has no name of its own (its shown name comes from its number) */
export const unnamedLevel = (l: Pick<Level, 'name'>) => !l.name || l.name === LEGACY_LEVEL_NAME

/** Shown name of a level: its own name, else from its number. */
export function levelName(l: Level) {
  if (!unnamedLevel(l)) return l.name
  const e = l.elevation ?? 0
  return e === 0 ? t('Ground floor') : e < 0 ? (e === -1 ? t('Basement') : t('Basement {n}', { n: -e })) : t('Floor {n}', { n: floorNumber(e) })
}

/** Empty plan: one level, no rooms. layout is not null, so the automatic plan is not built again. */
export const emptyLayout = (): Layout => ({ version: 1, levels: [{ id: uid('lvl'), name: '', rooms: [], items: [] }] })

export const activeLevel = (s: Pick<LayoutState, 'layout' | 'levelId'>): Level | null =>
  s.layout?.levels.find((l) => l.id === s.levelId) ?? s.layout?.levels[0] ?? null

function mapLevel(layout: Layout, levelId: string | null, fn: (l: Level) => Level): Layout {
  const id = levelId ?? layout.levels[0]?.id
  return { ...layout, levels: layout.levels.map((l) => (l.id === id ? fn(l) : l)) }
}


/**
 * Brings a plan saved in format `from` up to STORE_VERSION: plans from the browser and from Home Assistant go through the
 * same steps. A step that fails is skipped (the plan loads unmigrated), so this never throws.
 */
export function migrateLayout(layout: Layout, from: number): Layout {
  let lay = layout
  const step = (name: string, fn: (l: Layout) => Layout) => {
    try {
      lay = fn(lay)
    } catch (e) {
      console.error(`Plan migration (${name}) failed; the plan was loaded unmigrated`, e)
    }
  }
  const items = (fn: (l: Level) => Item[]) => (x: Layout): Layout => ({ ...x, levels: x.levels.map((l) => ({ ...l, items: fn(l) })) })
  if (from < 1) step('interior doors', items((l) => [...l.items, ...connectRooms(l)]))
  if (from < 2) step('TV backlight', items((l) => foldTvBacklights(l.items)))
  if (from < 3) step('centered walls', items((l) => settleWallItems(l)))
  if (from < 4) step('separate TV unit', items((l) => splitTvUnits(l.items)))
  if (from < 5) step('actual device as main entity', items((l) => l.items.map(primaryFirst)))
  return lay
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => {
      /** Applies a change to the plan; with record true the previous state goes into the history. */
      const change = (fn: (l: Level) => Level, record = true) => {
        const { layout, levelId, past } = get()
        if (!layout) return
        set({
          layout: mapLevel(layout, levelId, fn),
          ...(record ? { past: [...past, layout].slice(-HISTORY), future: [] } : {}),
        })
      }

      return {
        layout: null,
        levelId: null,
        mode: 'view',
        tool: 'select',
        selection: null,
        multi: null,
        theme: 'auto',
        past: [],
        future: [],
        unplaced: [],
        backup: null,
        homes: [],
        homeId: null,

        clearAll: () => {
          const { layout } = get()
          const hasContent = layout?.levels.some((l) => l.rooms.length || l.items.length)
          if (layout && hasContent) set({ backup: { layout, at: new Date().toISOString() } })
          get().setLayout(emptyLayout())
          set({ mode: 'edit', tool: 'select' })
        },
        restoreBackup: () => {
          const b = get().backup
          if (!b) return
          get().setLayout(b.layout)
          set({ backup: null })
        },

        setLayout: (layout, unplaced = []) => {
          const prev = get().layout
          set({
            layout,
            levelId: layout.levels[0]?.id ?? null,
            selection: null,
            unplaced,
            past: prev ? [...get().past, prev].slice(-HISTORY) : [],
            future: [],
          })
        },
        setMode: (mode) => set({ mode, tool: 'select', multi: null }),
        // While drawing a part the selected room stays selected (the part is added to it); free drawing clears the selection.
        setTool: (tool) => set({ tool, selection: tool === 'room' ? null : get().selection }),
        select: (selection) => set({ selection, multi: null }),
        setMulti: (multi) => set({ multi: multi && (multi.rooms.length || multi.items.length) ? multi : null, selection: null }),
        deleteMulti: () => {
          const m = get().multi
          if (!m) return
          change((l) => {
            const keep = l.rooms.filter((r) => !m.rooms.includes(r.id))
            const area = l.rooms.filter((r) => m.rooms.includes(r.id)).flatMap(rectsOf)
            const gone = new Set([...m.items, ...areaContents(l.items, area, keep).map((it) => it.id)])
            return { ...l, rooms: keep, items: l.items.filter((it) => !gone.has(it.id)) }
          })
          set({ multi: null, selection: null })
        },
        setTheme: (theme) => set({ theme }),

        checkpoint: () => {
          const { layout, past } = get()
          if (layout) set({ past: [...past, layout].slice(-HISTORY), future: [] })
        },
        revertCheckpoint: () => {
          const { past } = get()
          const prev = past[past.length - 1]
          if (prev) set({ layout: prev, past: past.slice(0, -1) })
        },
        undo: () => {
          const { past, layout, future } = get()
          const prev = past[past.length - 1]
          if (!prev || !layout) return
          set({ layout: prev, past: past.slice(0, -1), future: [layout, ...future] })
        },
        redo: () => {
          const { past, layout, future } = get()
          const next = future[0]
          if (!next || !layout) return
          set({ layout: next, past: [...past, layout], future: future.slice(1) })
        },

        addRoom: (r) => {
          const id = uid('room')
          change((l) => ({ ...l, rooms: [...l.rooms, { ...r, id }] }))
          set({ selection: { type: 'room', id } })
          return id
        },
        updateRoom: (id, patch, record = true) => change((l) => ({ ...l, rooms: l.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }), record),
        moveRoom: (id, dx, dz) =>
          change((l) => {
            const room = l.rooms.find((r) => r.id === id)
            if (!room) return l
            return {
              ...l,
              // Together with all its parts.
              rooms: l.rooms.map((r) => (r.id === id ? shiftRoom(r, dx, dz) : r)),
              // Moving a room also moves the items inside it (in any of its parts).
              items: l.items.map((it) => (inRoom(room, it.x, it.z) ? { ...it, x: it.x + dx, z: it.z + dz } : it)),
            }
          }, false),
        resizeEdge: (roomId, part, edge, v, record = true) =>
          change((l) => {
            const room = l.rooms.find((r) => r.id === roomId)
            const rect = part < 0 ? room : room?.parts?.[part]
            if (!room || !rect) return l
            const patch = edgePatch(rect, edge, v)
            const rooms = l.rooms.map((r) =>
              r.id !== roomId ? r : part < 0 ? { ...r, ...patch } : { ...r, parts: r.parts!.map((p, i) => (i === part ? { ...p, ...patch } : p)) },
            )
            return { ...l, rooms, items: shiftItemsWithEdge(l.items, rect, edge, v) }
          }, record),
        addPart: (roomId, rect) =>
          change((l) => ({ ...l, rooms: l.rooms.map((r) => (r.id === roomId ? { ...r, parts: [...(r.parts ?? []), rect] } : r)) })),
        updatePart: (roomId, index, patch, record = true) =>
          change(
            (l) => ({
              ...l,
              rooms: l.rooms.map((r) => (r.id === roomId && r.parts?.[index] ? { ...r, parts: r.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)) } : r)),
            }),
            record,
          ),
        // Removing a part also removes its items and doors opening into it (items in the remaining parts stay).
        removePart: (roomId, index) =>
          change((l) => {
            const room = l.rooms.find((r) => r.id === roomId)
            const part = room?.parts?.[index]
            if (!room || !part) return l
            const rooms = l.rooms.map((r) => (r.id === roomId ? { ...r, parts: (r.parts ?? []).filter((_, i) => i !== index) } : r))
            const gone = new Set(areaContents(l.items, [part], rooms).map((it) => it.id))
            return { ...l, rooms, items: l.items.filter((it) => !gone.has(it.id)) }
          }),
        // A room is deleted with everything: its items, devices, doors and doors from neighbors opening into it.
        deleteRoom: (id) => {
          change((l) => {
            const room = l.rooms.find((r) => r.id === id)
            if (!room) return l
            const rooms = l.rooms.filter((r) => r.id !== id)
            const gone = new Set(areaContents(l.items, rectsOf(room), rooms).map((it) => it.id))
            return { ...l, rooms, items: l.items.filter((it) => !gone.has(it.id)) }
          })
          set({ selection: null })
        },

        addItem: (kind, x, z, rot = 0, entityId = null, y, extra) => {
          const id = uid('it')
          change((l) => ({ ...l, items: [...l.items, { id, kind, x, z, rot, entityId, ...(y != null ? { y } : {}), ...extra }] }))
          set({ selection: { type: 'item', id }, unplaced: entityId ? get().unplaced.filter((e) => e !== entityId) : get().unplaced })
          return id
        },
        updateItem: (id, patch, record = true) => change((l) => ({ ...l, items: l.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }), record),
        deleteItem: (id) => {
          change((l) => ({ ...l, items: dropLoneGroups(l.items.filter((it) => it.id !== id)) }))
          set({ selection: null })
        },
        duplicateItem: (id) => {
          const src = activeLevel(get())?.items.find((it) => it.id === id)
          if (!src) return
          // A copy of a grouped light stays in the group with its bindings (to add spots to a group); other copies are unbound.
          const copy = src.group
            ? { ...src, id: uid('it'), x: src.x + 0.5, z: src.z + 0.5, name: undefined }
            : { ...src, id: uid('it'), x: src.x + 0.5, z: src.z + 0.5, entityId: null, extras: [], name: undefined }
          change((l) => ({ ...l, items: [...l.items, copy] }))
          set({ selection: { type: 'item', id: copy.id } })
        },
        addItems: (items) => {
          if (items.length) change((l) => ({ ...l, items: [...l.items, ...items] }))
        },

        bind: (itemId, entityId) => {
          const level = activeLevel(get())
          if (!level?.items.some((i) => i.id === itemId)) return
          const ids = groupMates(level.items, itemId)
          change((l) => ({ ...l, items: l.items.map((it) => (ids.includes(it.id) ? { ...it, ...withBinding(it, entityId) } : it)) }))
          set({ unplaced: get().unplaced.filter((e) => e !== entityId) })
        },
        unbind: (itemId, entityId) => {
          const level = activeLevel(get())
          if (!level?.items.some((i) => i.id === itemId)) return
          const ids = groupMates(level.items, itemId)
          change((l) => ({ ...l, items: l.items.map((it) => (ids.includes(it.id) ? { ...it, ...withoutBinding(it, entityId) } : it)) }))
        },
        makeMain: (itemId, entityId) => {
          const level = activeLevel(get())
          if (!level?.items.some((i) => i.id === itemId)) return
          const ids = groupMates(level.items, itemId)
          change((l) => ({ ...l, items: l.items.map((it) => (ids.includes(it.id) ? { ...it, ...asMain(it, entityId) } : it)) }))
        },
        groupItems: (ids) => {
          const level = activeLevel(get())
          const members = level?.items.filter((i) => ids.includes(i.id)) ?? []
          if (members.length < 2) return null
          const gid = uid('grp')
          // The first bound member in selection order is the source: its main and extra entities go to all
          const src = ids.map((id) => members.find((m) => m.id === id)).find((m) => m && isBound(m))
          const binding = src ? { entityId: src.entityId ?? null, extras: [...(src.extras ?? [])] } : {}
          change((l) => ({ ...l, items: dropLoneGroups(l.items.map((it) => (ids.includes(it.id) ? { ...it, group: gid, ...binding } : it))) }))
          return gid
        },
        ungroupItem: (id) => {
          change((l) => ({ ...l, items: dropLoneGroups(l.items.map((it) => (it.id === id ? { ...it, group: undefined } : it))) }))
        },

        addHome: (name) => {
          const s = get()
          const cur = activeHomeId(s)
          const id = uid('home')
          const saved = homesOf(s).map((h) => (h.id === cur ? { id: h.id, name: h.name, layout: s.layout, levelId: s.levelId } : h))
          const layout = emptyLayout()
          set({
            homes: [...saved, { id, name: name.trim() || t('Home {n}', { n: saved.length + 1 }) }],
            homeId: id,
            layout,
            levelId: layout.levels[0].id,
            selection: null,
            multi: null,
            past: [],
            future: [],
            unplaced: [],
            mode: 'edit',
            tool: 'select',
          })
          return id
        },
        switchHome: (id) => {
          const s = get()
          const cur = activeHomeId(s)
          const target = homesOf(s).find((h) => h.id === id)
          if (!target || id === cur) return
          const homes = homesOf(s).map((h) => (h.id === cur ? { id: h.id, name: h.name, layout: s.layout, levelId: s.levelId } : h.id === id ? { id: h.id, name: h.name } : h))
          const layout = target.layout ?? emptyLayout()
          set({
            homes,
            homeId: id,
            layout,
            levelId: target.levelId && layout.levels.some((l) => l.id === target.levelId) ? target.levelId : (layout.levels[0]?.id ?? null),
            selection: null,
            multi: null,
            past: [],
            future: [],
            unplaced: [],
            tool: 'select',
          })
        },
        renameHome: (id, name) => {
          const s = get()
          if (!name.trim()) return
          set({ homes: homesOf(s).map((h) => (h.id === id ? { ...h, name: name.trim() } : h)), homeId: activeHomeId(s) })
        },
        deleteHome: (id) => {
          const s = get()
          const list = homesOf(s)
          if (list.length <= 1) return
          if (id === activeHomeId(s)) get().switchHome(list.find((h) => h.id !== id)!.id)
          set({ homes: homesOf(get()).filter((h) => h.id !== id) })
        },

        addLevel: (opts = {}) => {
          const { layout, past } = get()
          const cur = activeLevel(get())
          if (!layout || !cur) return null
          const elevs = layout.levels.map((l) => l.elevation ?? 0)
          const elevation = opts.below ? Math.min(...elevs) - 1 : Math.max(...elevs) + 1
          const rooms = opts.copyRooms ? cur.rooms.filter((r) => r.type !== 'garden').map((r) => ({ ...r, id: uid('room'), areaId: null })) : []
          const lvl: Level = { id: uid('lvl'), name: '', rooms, items: [], elevation }
          lvl.name = levelName(lvl)
          // The unnamed level of a single-level plan gets its shown name ("Ground floor") as its name
          const levels = [...layout.levels.map((l) => (unnamedLevel(l) ? { ...l, name: levelName({ ...l, name: '' }) } : l)), lvl].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
          set({ layout: { ...layout, levels }, levelId: lvl.id, selection: null, multi: null, past: [...past, layout].slice(-HISTORY), future: [] })
          return lvl.id
        },
        setLevel: (id) => {
          if (!get().layout?.levels.some((l) => l.id === id)) return
          set({ levelId: id, selection: null, multi: null })
        },
        renameLevel: (id, name) => {
          const { layout, past } = get()
          if (!layout || !name.trim()) return
          set({ layout: { ...layout, levels: layout.levels.map((l) => (l.id === id ? { ...l, name: name.trim() } : l)) }, past: [...past, layout].slice(-HISTORY), future: [] })
        },
        setBearing: (deg) => {
          const { layout, past } = get()
          if (!layout) return
          const up = ((Math.round(deg) % 360) + 360) % 360
          if ((layout.up ?? 0) === up) return
          set({ layout: { ...layout, up }, past: [...past, layout].slice(-HISTORY), future: [] })
        },
        deleteLevel: (id) => {
          const { layout, past, levelId } = get()
          if (!layout || layout.levels.length <= 1) return
          const levels = layout.levels.filter((l) => l.id !== id)
          const active = levelId === id || !levels.some((l) => l.id === levelId) ? (levels.find((l) => (l.elevation ?? 0) === 0) ?? levels[0]).id : levelId
          set({ layout: { ...layout, levels }, levelId: active, selection: null, multi: null, past: [...past, layout].slice(-HISTORY), future: [] })
        },
      }
    },
    {
      name: STORE_KEY,
      storage: guardedStorage,
      // v1: interior doors arrived. Old plans get doors between rooms that cannot reach each other, once.
      // v2: the TV backlight became an option of the TV. A backlight strip placed behind the TV joins the TV (in the backup too).
      // Migration steps must not throw (see the save guard above); each step is tried on its own.
      // v3: walls were centered on the room boundary; wall items stuck to the old inner face move 5 cm toward the wall.
      // v4: TV and TV unit were split; an old TV becomes a unit with a standing TV on top.
      // v5: a TV/diffuser whose main entity is not the actual device (backlight bound first): the actual device among the extras becomes the main one.
      version: STORE_VERSION,
      migrate: (persisted, from) => {
        const st = persisted as { layout: Layout | null; backup?: { layout: Layout } | null; homes?: HomeEntry[] }
        if (st.layout) st.layout = migrateLayout(st.layout, from)
        if (st.backup?.layout) st.backup = { ...st.backup, layout: migrateLayout(st.backup.layout, from) }
        if (st.homes) st.homes = st.homes.map((h) => (h.layout ? { ...h, layout: migrateLayout(h.layout, from) } : h))
        return st as LayoutState
      },
      onRehydrateStorage: () => (_state, error) => {
        if (!error) return
        console.error('The saved plan could not be loaded; keeping the raw record', error)
        try {
          keepCopy(`${STORE_KEY}-rescue`, localStorage.getItem(STORE_KEY))
        } catch {
          /* storage unavailable */
        }
      },
      partialize: (s) => ({ layout: s.layout, levelId: s.levelId, theme: s.theme, unplaced: s.unplaced, backup: s.backup, homes: s.homes, homeId: s.homeId }),
    },
  ),
)

/** Exports the plan as a JSON file (backup and sharing). */
export function exportLayout() {
  const layout = useLayout.getState().layout
  if (!layout) return
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'homescape-plan.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function importLayout(file: File) {
  const data = JSON.parse(await file.text()) as Layout
  if (data?.version !== 1 || !Array.isArray(data.levels)) throw new Error(t('This file is not a Homescape plan.'))
  useLayout.getState().setLayout(data)
}
