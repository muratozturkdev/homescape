import { create } from 'zustand'
import { AMERICAN_NAME, isAmericanLayout } from '@/demo/american'
import { t } from '@/i18n'
import { activeHomeId, homesOf, useLayout, type HomeEntry } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import type { Layout } from '@/model/types'
import { useView } from '@/scene/camera'
import { useHa } from './store'
import type { HaSource } from './types'

/*
 * Syncing the home plan between devices. The plan used to live only in the browser; while connected to a live Home
 * Assistant it is also kept in Home Assistant's per-user storage (frontend user data, key `homescape-plan`; where Home
 * Assistant's own frontend keeps its settings, per user): every device signed in with the same Home Assistant user sees
 * the same homes, and a change on one device reaches the others right away. No sync on the demo connection.
 *
 * Synced: the list of homes and their plans (except the sample home: each device sets it up from the menu). Not synced
 * (per device): active home, open floor, selection, camera.
 *
 * Rules (so that on the first sync one device's plan does not overwrite another's):
 * - A "fresh" plan on this device (not edited by hand: the sample plan set up on first start or the plan generated from
 *   Home Assistant areas; all room and item ids created within FRESH_MS of each other, no edit since syncing, a single
 *   home) is never written to Home Assistant; it takes the plan from Home Assistant if there is one, otherwise it waits.
 * - If Home Assistant has no plan, a hand-edited plan is written there.
 * - On a device that synced before, if only one side changed, that side wins; if both changed, the latest edit wins.
 * - A device that never synced and has a hand-edited plan asks the user when Home Assistant has a different plan
 *   (ui/SyncPrompt.tsx).
 * Before the plan on this device is replaced with the one from Home Assistant, it is backed up in this browser
 * (`homescape-sync-backup`).
 */

const KEY = 'homescape-plan'
const META_KEY = 'homescape-sync'
const BACKUP_KEY = 'homescape-sync-backup'
/** Former name of BACKUP_KEY, moved over once (migrateBackupKey) */
const OLD_BACKUP_KEY = 'homescape-sync-yedek'
/** Ids created within this many ms count as "set up in one go" */
const FRESH_MS = 120_000
const PUSH_MS = 1200
/** Read at this interval when the Home Assistant version does not report changes */
const POLL_MS = 15_000

interface SyncHome {
  id: string
  name: string
  layout: Layout | null
}
interface Remote {
  v: 1
  updatedAt: string
  device: string
  homeId: string
  homes: SyncHome[]
}
interface Meta {
  device: string
  /** Last synced Home Assistant version (updatedAt) and the signature of the plan at that time */
  base: string | null
  sig: string | null
  /** Last hand edit on this device */
  editedAt: string | null
}

export type SyncStatus = 'off' | 'waiting' | 'synced' | 'error'
export const useSync = create<{ status: SyncStatus; at: string | null; conflict: Remote | null }>(() => ({ status: 'off', at: null, conflict: null }))

function readMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as Meta | null
    if (m?.device) return m
  } catch {
    /* storage unavailable or corrupt */
  }
  return { device: `device-${Math.random().toString(36).slice(2, 10)}`, base: null, sig: null, editedAt: null }
}
let meta = readMeta()
function saveMeta(patch: Partial<Meta>) {
  meta = { ...meta, ...patch }
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* storage unavailable: valid for this session */
  }
}

/** One-time move of the backup from its former key */
function migrateBackupKey() {
  try {
    const old = localStorage.getItem(OLD_BACKUP_KEY)
    if (old === null || localStorage.getItem(BACKUP_KEY) !== null) return
    localStorage.setItem(BACKUP_KEY, old)
    localStorage.removeItem(OLD_BACKUP_KEY)
  } catch {
    /* storage unavailable or full: the old key stays */
  }
}
migrateBackupKey()

const isDemoHome = (h: HomeEntry, layout: Layout | null | undefined) => isAmericanLayout(layout) || h.name === AMERICAN_NAME

/** Synced homes: in list order, the active home's plan from the store; the sample home excluded */
function localHomes(): SyncHome[] {
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  return homesOf(s)
    .map((h) => ({ h, layout: h.id === cur ? s.layout : (h.layout ?? null) }))
    .filter(({ h, layout }) => !isDemoHome(h, layout))
    .map(({ h, layout }) => ({ id: h.id, name: h.name, layout }))
}
const sigOf = (homes: SyncHome[]) => JSON.stringify(homes.map((h) => [h.id, h.name, h.layout]))
const namesOf = (homes: { id: string; name: string }[]) => homes.map((h) => `${h.id}:${h.name}`).join('|')

/** Plan not edited by hand (see the top of the file) */
function isFresh(homes: SyncHome[]) {
  if (meta.editedAt || homes.length > 1) return false
  const ts: number[] = []
  for (const h of homes)
    for (const l of h.layout?.levels ?? [])
      for (const x of [l, ...l.rooms, ...l.items]) {
        const m = /^[a-z]+-([0-9a-z]+)-/.exec(x.id)
        if (m) ts.push(parseInt(m[1], 36))
      }
  return !ts.length || Math.max(...ts) - Math.min(...ts) < FRESH_MS
}

function parse(v: unknown): Remote | null {
  const r = v as Remote | null
  if (!r || r.v !== 1 || !Array.isArray(r.homes) || !r.homes.length || typeof r.updatedAt !== 'string') return null
  if (!r.homes.every((h) => typeof h.id === 'string' && (!h.layout || (h.layout.version === 1 && Array.isArray(h.layout.levels))))) return null
  return r
}

let src: HaSource | null = null
let remote: Remote | null = null
/** Store changes while applying the remote plan do not count as edits */
let applying = false
let pushTimer: ReturnType<typeof setTimeout> | undefined
let stopFns: (() => void)[] = []

function keepBackup(homes: SyncHome[]) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), homes }))
  } catch {
    /* storage full or unavailable */
  }
}

async function push(homes: SyncHome[], sig: string, first: boolean) {
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  const value: Remote = { v: 1, updatedAt: new Date().toISOString(), device: meta.device, homeId: homes.some((h) => h.id === cur) ? cur : homes[0].id, homes }
  const size = JSON.stringify(value).length
  if (size > 3_000_000) {
    useHa.setState({ notice: t('The home plan is too large to save to Home Assistant; it stays on this device.') })
    return
  }
  const at = src
  try {
    await at?.userData?.set(KEY, value)
  } catch {
    useSync.setState({ status: 'error' })
    return
  }
  if (at !== src) return
  remote = value
  saveMeta({ base: value.updatedAt, sig })
  useSync.setState({ status: 'synced', at: value.updatedAt })
  if (first) useHa.setState({ notice: t('Home plan saved to Home Assistant: devices signed in with the same user (like an iPad) see these homes.') })
}

/** Applies the plan from Home Assistant to this device (active home and open floor stay per device, the sample home is kept) */
function adopt(r: Remote, backup: boolean, announce: boolean) {
  // Not applied while dragging: retried after the drop
  if (usePlacement.getState().moving) {
    setTimeout(() => void reconcile(remote), 800)
    return
  }
  if (backup) keepBackup(localHomes())
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  const local = homesOf(s)
  const demo = local.filter((h) => isDemoHome(h, h.id === cur ? s.layout : h.layout))
  const keep = demo.some((h) => h.id === cur) ? cur : r.homes.some((h) => h.id === cur) ? cur : (r.homes.find((h) => h.id === r.homeId) ?? r.homes[0]).id
  const levelOf = (id: string, layout: Layout | null) => {
    const was = id === cur ? s.levelId : local.find((h) => h.id === id)?.levelId
    return layout?.levels.some((l) => l.id === was) ? was : (layout?.levels.find((l) => (l.elevation ?? 0) === 0)?.id ?? layout?.levels[0]?.id ?? null)
  }
  const list: HomeEntry[] = [
    ...r.homes.map((h) => ({ id: h.id, name: h.name, layout: h.layout, levelId: levelOf(h.id, h.layout) })),
    ...demo.map((h) => (h.id === cur ? { id: h.id, name: h.name, layout: s.layout, levelId: s.levelId } : h)),
  ]
  const active = list.find((h) => h.id === keep)!
  const layout = active.layout ?? s.layout
  const sel = s.selection
  const selOk = sel && layout?.levels.some((l) => (sel.type === 'item' ? l.items : l.rooms).some((x) => x.id === sel.id))
  applying = true
  try {
    useLayout.setState({
      homes: list.map((h) => (h.id === keep ? { id: h.id, name: h.name } : h)),
      homeId: keep,
      layout,
      levelId: active.levelId ?? layout?.levels[0]?.id ?? null,
      selection: selOk ? sel : null,
      multi: null,
      past: [],
      future: [],
    })
  } finally {
    applying = false
  }
  remote = r
  lastSig = sigOf(localHomes())
  saveMeta({ base: r.updatedAt, sig: lastSig })
  useSync.setState({ status: 'synced', at: r.updatedAt, conflict: null })
  if (announce) {
    if (!useView.getState().fps) useView.getState().request({ kind: 'house' })
    useHa.setState({ notice: t('Home plan loaded from Home Assistant (the version saved on another device).') })
  }
}

/** Compares the plan in Home Assistant with the one on this device and decides which one stays */
async function reconcile(r: Remote | null) {
  if (!src?.userData || useSync.getState().conflict) return
  remote = r
  const homes = localHomes()
  if (!homes.length) return
  const sig = sigOf(homes)
  if (!r) {
    // No plan in Home Assistant: a hand-edited plan is written, a fresh plan waits (for another device's plan)
    if (isFresh(homes) || !useLayout.getState().layout) return useSync.setState({ status: 'waiting' })
    return push(homes, sig, true)
  }
  if (sigOf(r.homes) === sig) {
    saveMeta({ base: r.updatedAt, sig })
    return useSync.setState({ status: 'synced', at: r.updatedAt })
  }
  if (!meta.base) {
    // This device syncs for the first time
    if (isFresh(homes) || !useLayout.getState().layout) return adopt(r, false, true)
    return useSync.setState({ conflict: r })
  }
  // Echo of our own write
  if (r.device === meta.device && r.updatedAt === meta.base) return
  const localChanged = sig !== meta.sig
  const remoteChanged = r.updatedAt !== meta.base
  if (localChanged && !remoteChanged) return push(homes, sig, false)
  if (!localChanged) return adopt(r, false, false)
  // Both changed: the latest edit stays, the other is backed up
  if (meta.editedAt && meta.editedAt > r.updatedAt) return push(homes, sig, false)
  return adopt(r, true, true)
}

/** The user's choice on a conflict (ui/SyncPrompt.tsx) */
export function resolveConflict(choice: 'remote' | 'local') {
  const r = useSync.getState().conflict
  if (!r) return
  useSync.setState({ conflict: null })
  if (choice === 'remote') adopt(r, true, true)
  else {
    const homes = localHomes()
    void push(homes, sigOf(homes), true)
  }
}

/** The plan changed on this device: undo history moved, a home was added / removed / renamed (may be a hand edit) */
let editHint = false
/** Signature of the plan last seen on this device (switching homes does not change it: not an edit) */
let lastSig: string | null = null

/** A moment later: if the content really changed, mark it as an edit and, when connected, write it to Home Assistant */
function onLocalChange() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    const hint = editHint
    editHint = false
    if (!src?.userData && !hint) return
    const homes = localHomes()
    const sig = sigOf(homes)
    if (hint && lastSig !== null && sig !== lastSig) saveMeta({ editedAt: new Date().toISOString() })
    lastSig = sig
    if (!src?.userData || useSync.getState().conflict || !homes.length || sig === meta.sig) return
    // If the Home Assistant copy did not change, write directly; otherwise compare
    if (remote && meta.base && remote.updatedAt === meta.base) void push(homes, sig, false)
    else void reconcile(remote)
  }, PUSH_MS)
}

function stop() {
  clearTimeout(pushTimer)
  for (const f of stopFns) f()
  stopFns = []
  src = null
  remote = null
  useSync.setState({ status: 'off', conflict: null })
}

async function start(source: HaSource | null) {
  stop()
  if (!source || source.kind !== 'live' || !source.userData) return
  src = source
  const data = source.userData
  try {
    const first = parse(await data.get(KEY))
    if (src !== source) return
    await reconcile(first)
  } catch {
    if (src === source) useSync.setState({ status: 'error' })
    return
  }
  const off = await data.subscribe(KEY, (v) => {
    if (src === source) void reconcile(parse(v))
  })
  if (src !== source) return off?.()
  if (off) stopFns.push(off)
  else {
    // No change reports: read at an interval and when the tab becomes visible
    const read = () =>
      void data.get(KEY).then(
        (v) => {
          if (src === source) void reconcile(parse(v))
        },
        () => {},
      )
    const timer = setInterval(read, POLL_MS)
    const vis = () => document.visibilityState === 'visible' && read()
    document.addEventListener('visibilitychange', vis)
    stopFns.push(() => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', vis)
    })
  }
}

/** Starts syncing: set up again when the connection changes; watches local changes */
export function startPlanSync() {
  const offHa = useHa.subscribe((s, p) => {
    if (s.source !== p.source) void start(s.source)
  })
  lastSig = sigOf(localHomes())
  const offLayout = useLayout.subscribe((s, p) => {
    if (applying || (s.layout === p.layout && s.homes === p.homes)) return
    // A generated plan leaves the history empty and does not count as an edit
    if (s.past.length !== p.past.length || s.future.length !== p.future.length || namesOf(homesOf(s)) !== namesOf(homesOf(p))) editHint = true
    onLocalChange()
  })
  void start(useHa.getState().source)
  return () => {
    offHa()
    offLayout()
    stop()
  }
}

/** Test hook: sync status and this device's record */
export const syncDebug = () => ({ ...useSync.getState(), meta: { ...meta }, remote: remote ? { updatedAt: remote.updatedAt, device: remote.device, homes: remote.homes.length } : null })
