import { create } from 'zustand'
import { AMERICAN_NAME, isAmericanLayout } from '@/demo/american'
import { t } from '@/i18n'
import { activeHomeId, homesOf, importLayout, migrateLayout, STORE_VERSION, useLayout, type HomeEntry } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import type { Layout } from '@/model/types'
import { useView } from '@/scene/camera'
import { useHa } from './store'
import type { HaSource } from './types'

/*
 * Syncing the home plan between devices. While connected to a live Home Assistant the plan is kept in Home Assistant's
 * per-user storage (frontend user data, key `homescape-plan`; where Home Assistant's own frontend keeps its settings, per
 * user): every device signed in with the same Home Assistant user sees the same homes, and a change on one device reaches
 * the others right away. No sync on the demo connection.
 *
 * Synced: the list of homes and their plans (except the sample home: each device sets it up from the menu). Not synced
 * (per device): active home, open floor, selection, camera.
 *
 * Other people's homes depend on these rules; losing a plan is the worst thing this file can do:
 * - Nothing is written unless what is in Home Assistant was read first. A failed read is not "no plan": it changes nothing.
 * - Data this version cannot read (unknown format, a plan saved by a newer version) is never overwritten: sync stops, edits
 *   stay on this device, and only the user can replace unreadable data (the old value is kept in `homescape-plan-unreadable`).
 * - Only hand edits are written. A plan that appeared by itself (generated on first start, or because this browser lost its
 *   plan) is never written over the plan in Home Assistant; the plan in Home Assistant comes back instead.
 * - A "fresh" plan on this device (not edited by hand) takes the plan from Home Assistant if there is one, otherwise it waits.
 * - If Home Assistant has no plan, a hand-edited plan is written there.
 * - On a device that synced before, if only one side changed, that side wins; if both changed, the latest edit wins.
 * - A device that never synced with this account and has a hand-edited plan asks the user when Home Assistant has a
 *   different plan (ui/SyncPrompt.tsx). The sync record belongs to one Home Assistant user: another user in the same browser
 *   counts as a first sync.
 * - Plans in Home Assistant carry their format (`schema`) and are migrated when they arrive, like saved plans in the browser.
 *
 * Copies: before the plan on this device is replaced, it is kept in this browser (`homescape-sync-backup`, newest first).
 * Before a large change is written (or once a day) the previous version stays in Home Assistant (`homescape-plan-backups`).
 * ui/PlanHistory.tsx lists both and restores them.
 */

const KEY = 'homescape-plan'
const HA_BACKUPS_KEY = 'homescape-plan-backups'
const HA_UNREADABLE_KEY = 'homescape-plan-unreadable'
const META_KEY = 'homescape-sync'
const BACKUP_KEY = 'homescape-sync-backup'
/** Former name of BACKUP_KEY, moved over once (migrateBackupKey) */
const OLD_BACKUP_KEY = 'homescape-sync-yedek'
/** Plans written before `schema` existed have this format */
const FIRST_SCHEMA = 5
/** Ids created within this many ms count as "set up in one go" */
const FRESH_MS = 120_000
const PUSH_MS = 1200
/** Read at this interval when the Home Assistant version does not report changes */
const POLL_MS = 15_000
/** After a failed read: try again after this long */
const RETRY_MS = 30_000
/** Copies kept in this browser (it shares its storage quota with Home Assistant's frontend when served by it) */
const LOCAL_COPIES = 5
const LOCAL_CHARS = 1_500_000
/** Copies kept in Home Assistant, and the time between daily copies */
const HA_COPIES = 3
const HA_CHARS = 2_000_000
const DAY_MS = 24 * 3_600_000

export interface SyncHome {
  id: string
  name: string
  layout: Layout | null
}
interface Remote {
  v: 1
  /** Format of the plans (STORE_VERSION of the app that wrote them) */
  schema?: number
  updatedAt: string
  device: string
  homeId: string
  homes: SyncHome[]
}
/** What Home Assistant holds: nothing, a plan, or data this version must not touch */
type Stored = { kind: 'none' } | { kind: 'plan'; remote: Remote } | { kind: 'blocked'; why: BlockReason }
export type BlockReason = 'newer' | 'unreadable'
interface Meta {
  device: string
  /** Last synced Home Assistant version (updatedAt) and the signature of the plan at that time */
  base: string | null
  sig: string | null
  /** Last hand edit on this device */
  editedAt: string | null
  /** A hand edit that is not in Home Assistant yet, and a short hash of the plan it produced */
  dirty?: boolean
  editHash?: string
  /** Home Assistant user this record belongs to */
  owner?: string | null
}
/** A saved copy of the homes */
export interface PlanCopy {
  at: string
  schema: number
  homes: SyncHome[]
  /** Where the copy is kept */
  where?: 'device' | 'ha'
}

export type SyncStatus = 'off' | 'waiting' | 'synced' | 'error' | 'blocked'
export const useSync = create<{ status: SyncStatus; at: string | null; conflict: Remote | null; blocked: BlockReason | null }>(() => ({ status: 'off', at: null, conflict: null, blocked: null }))

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
const hashOf = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}
/**
 * The plan here is the result of a hand edit that is not in Home Assistant yet. The hash ties the edit to its plan: if this
 * browser loses the plan afterwards, the generated plan that replaces it is not that edit. Records from before `dirty`
 * existed: a hand edit newer than the last sync.
 */
function isDirty(sig: string) {
  if (meta.dirty === undefined) return Boolean(meta.editedAt && meta.base && meta.editedAt > meta.base)
  return meta.dirty && meta.editHash === hashOf(sig)
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

const levelsOf = (homes: SyncHome[]) => homes.flatMap((h) => h.layout?.levels ?? [])
/** Rooms and items in the homes */
export const planSize = (homes: SyncHome[]) => ({
  homes: homes.length,
  rooms: levelsOf(homes).reduce((a, l) => a + l.rooms.length, 0),
  items: levelsOf(homes).reduce((a, l) => a + l.items.length, 0),
})
const hasContent = (homes: SyncHome[]) => levelsOf(homes).some((l) => l.rooms.length || l.items.length)

/** All ids created in one go: the plan was generated, nobody worked on it */
function looksGenerated(homes: SyncHome[]) {
  if (homes.length > 1) return false
  const ts: number[] = []
  for (const l of levelsOf(homes))
    for (const x of [l, ...l.rooms, ...l.items]) {
      const m = /^[a-z]+-([0-9a-z]+)-/.exec(x.id)
      if (m) ts.push(parseInt(m[1], 36))
    }
  return !ts.length || Math.max(...ts) - Math.min(...ts) < FRESH_MS
}
/** Plan not edited by hand (see the top of the file) */
const isFresh = (homes: SyncHome[]) => !meta.editedAt && looksGenerated(homes)

/** A write that would lose much of the plan in Home Assistant: fewer homes or much less content, or mostly other rooms */
function bigChange(cur: SyncHome[], next: SyncHome[]) {
  const a = planSize(cur)
  const b = planSize(next)
  if (b.homes < a.homes || b.rooms + b.items < (a.rooms + a.items) * 0.7) return true
  const ids = new Set(levelsOf(next).flatMap((l) => l.rooms.map((r) => r.id)))
  const old = levelsOf(cur).flatMap((l) => l.rooms)
  return old.length > 0 && old.filter((r) => ids.has(r.id)).length < old.length / 2
}

/** Decides what the value in Home Assistant is. Anything unexpected is "blocked", never "none": it must not be overwritten */
function classify(v: unknown): Stored {
  if (v == null) return { kind: 'none' }
  const r = v as Partial<Remote> & { v?: unknown }
  if (typeof r !== 'object' || typeof r.v !== 'number') return { kind: 'blocked', why: 'unreadable' }
  if (r.v > 1 || (r.schema ?? FIRST_SCHEMA) > STORE_VERSION) return { kind: 'blocked', why: 'newer' }
  if (r.v !== 1 || !Array.isArray(r.homes) || !r.homes.length || typeof r.updatedAt !== 'string') return { kind: 'blocked', why: 'unreadable' }
  for (const h of r.homes) {
    if (typeof h?.id !== 'string') return { kind: 'blocked', why: 'unreadable' }
    if (h.layout && h.layout.version > 1) return { kind: 'blocked', why: 'newer' }
    if (h.layout && (h.layout.version !== 1 || !Array.isArray(h.layout.levels))) return { kind: 'blocked', why: 'unreadable' }
  }
  return { kind: 'plan', remote: r as Remote }
}

/** The homes of a copy brought up to this version's format */
const upgraded = (homes: SyncHome[], from: number) => (from < STORE_VERSION ? homes.map((h) => (h.layout ? { ...h, layout: migrateLayout(h.layout, from) } : h)) : homes)

let src: HaSource | null = null
/** Store changes while applying a plan do not count as edits */
let applying = false
let pushTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let stopFns: (() => void)[] = []

/** The local copies, newest first (older versions kept a single one) */
function localCopies(): PlanCopy[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? 'null') as PlanCopy | PlanCopy[] | null
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((c) => Array.isArray(c?.homes))
  } catch {
    return []
  }
}

/** Keeps the homes of this device in this browser before something replaces them */
function keepBackup(homes: SyncHome[]) {
  if (!hasContent(homes)) return
  const list = localCopies()
  if (list[0] && sigOf(list[0].homes) === sigOf(homes)) return
  const next: PlanCopy[] = [{ at: new Date().toISOString(), schema: STORE_VERSION, homes }, ...list].slice(0, LOCAL_COPIES)
  while (next.length > 1 && JSON.stringify(next).length > LOCAL_CHARS) next.pop()
  // Storage full: older copies go first
  while (next.length) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(next))
      return
    } catch {
      next.pop()
    }
  }
}

function haCopies(v: unknown): PlanCopy[] {
  const items = (v as { items?: PlanCopy[] } | null)?.items
  return Array.isArray(items) ? items.filter((c) => Array.isArray(c?.homes) && typeof c.at === 'string') : []
}

/** Before a large change, and once a day, the version being replaced stays in Home Assistant */
async function keepRemoteCopy(cur: Remote, next: SyncHome[]) {
  const data = src?.userData
  if (!data) return
  const list = haCopies(await data.get(HA_BACKUPS_KEY))
  if (list[0]?.at === cur.updatedAt) return
  const due = !list[0] || Date.now() - Date.parse(list[0].at) > DAY_MS
  if (!due && !bigChange(cur.homes, next)) return
  const items: PlanCopy[] = [{ at: cur.updatedAt, schema: cur.schema ?? FIRST_SCHEMA, homes: cur.homes }, ...list].slice(0, HA_COPIES)
  while (items.length > 1 && JSON.stringify(items).length > HA_CHARS) items.pop()
  await data.set(HA_BACKUPS_KEY, { v: 1, items })
}

/** Writes this device's plan to Home Assistant; `cur` is what was just read there */
async function push(homes: SyncHome[], sig: string, first: boolean, cur: Remote | null) {
  const at = src
  const data = at?.userData
  if (!data) return
  const s = useLayout.getState()
  const active = activeHomeId(s)
  const value: Remote = { v: 1, schema: STORE_VERSION, updatedAt: new Date().toISOString(), device: meta.device, homeId: homes.some((h) => h.id === active) ? active : homes[0].id, homes }
  if (JSON.stringify(value).length > 3_000_000) {
    useHa.setState({ notice: t('The home plan is too large to save to Home Assistant; it stays on this device.') })
    return
  }
  try {
    if (cur) await keepRemoteCopy(cur, homes)
    await data.set(KEY, value)
  } catch {
    if (at === src) useSync.setState({ status: 'error' })
    return
  }
  if (at !== src) return
  saveMeta({ base: value.updatedAt, sig, dirty: false })
  useSync.setState({ status: 'synced', at: value.updatedAt, blocked: null })
  if (first) useHa.setState({ notice: t('Home plan saved to Home Assistant: devices signed in with the same user (like an iPad) see these homes.') })
}

/** Puts homes on this device (active home and open floor stay per device, the sample home is kept) */
function applyHomes(homes: SyncHome[], preferred: string | undefined) {
  const s = useLayout.getState()
  const cur = activeHomeId(s)
  const local = homesOf(s)
  const demo = local.filter((h) => isDemoHome(h, h.id === cur ? s.layout : h.layout))
  const keep = demo.some((h) => h.id === cur) ? cur : homes.some((h) => h.id === cur) ? cur : (homes.find((h) => h.id === preferred) ?? homes[0]).id
  const levelOf = (id: string, layout: Layout | null) => {
    const was = id === cur ? s.levelId : local.find((h) => h.id === id)?.levelId
    return layout?.levels.some((l) => l.id === was) ? was : (layout?.levels.find((l) => (l.elevation ?? 0) === 0)?.id ?? layout?.levels[0]?.id ?? null)
  }
  const list: HomeEntry[] = [
    ...homes.map((h) => ({ id: h.id, name: h.name, layout: h.layout, levelId: levelOf(h.id, h.layout) })),
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
}

/** Applies the plan from Home Assistant to this device */
function adopt(r: Remote, backup: boolean, announce: boolean) {
  // Not applied while dragging: retried after the drop
  if (usePlacement.getState().moving) {
    setTimeout(() => void pull(), 800)
    return
  }
  if (backup) keepBackup(localHomes())
  applyHomes(upgraded(r.homes, r.schema ?? FIRST_SCHEMA), r.homeId)
  lastSig = sigOf(localHomes())
  saveMeta({ base: r.updatedAt, sig: lastSig, dirty: false })
  useSync.setState({ status: 'synced', at: r.updatedAt, conflict: null, blocked: null })
  if (announce) {
    if (!useView.getState().fps) useView.getState().request({ kind: 'house' })
    useHa.setState({ notice: t('Home plan loaded from Home Assistant (the version saved on another device).') })
  }
}

function block(why: BlockReason) {
  const was = useSync.getState().blocked
  useSync.setState({ status: 'blocked', blocked: why })
  if (was !== why) useHa.setState({ notice: blockText(why) })
}
export const blockText = (why: BlockReason) =>
  why === 'newer'
    ? t('Home Assistant has a plan saved by a newer version of Homescape. Update Homescape on this device; until then changes stay on this device.')
    : t('The plan in Home Assistant could not be read. It was left untouched and changes stay on this device.')

/** Compares what Home Assistant holds with this device and decides which one stays */
async function reconcile(stored: Stored) {
  if (!src?.userData || useSync.getState().conflict) return
  if (stored.kind === 'blocked') return block(stored.why)
  const homes = localHomes()
  if (!homes.length) return
  const sig = sigOf(homes)
  const ready = Boolean(useLayout.getState().layout)
  if (stored.kind === 'none') {
    // No plan in Home Assistant: a hand-edited plan is written, a fresh plan waits (for another device's plan)
    if (!ready || isFresh(homes)) return useSync.setState({ status: 'waiting', blocked: null })
    return push(homes, sig, true, null)
  }
  const r = stored.remote
  if (sigOf(r.homes) === sig) {
    saveMeta({ base: r.updatedAt, sig, dirty: false })
    return useSync.setState({ status: 'synced', at: r.updatedAt, blocked: null })
  }
  if (!meta.base) {
    // This device syncs with this account for the first time
    if (!ready || isFresh(homes)) return adopt(r, false, true)
    return useSync.setState({ conflict: r, blocked: null })
  }
  const remoteChanged = r.updatedAt !== meta.base
  const edited = sig !== meta.sig && isDirty(sig)
  // Echo of our own write, or a plan that was migrated when it arrived
  if (!remoteChanged && sig === meta.sig) return useSync.setState({ status: 'synced', at: r.updatedAt, blocked: null })
  // The plan here differs without a hand edit: this browser lost its plan and generated one. Home Assistant's plan comes back
  if (!edited && !remoteChanged) return adopt(r, ready && !looksGenerated(homes), true)
  if (edited && !remoteChanged) return push(homes, sig, false, r)
  if (!edited) return adopt(r, true, false)
  // Both changed: the latest edit stays, the other is backed up
  if (meta.editedAt && meta.editedAt > r.updatedAt) return push(homes, sig, false, r)
  return adopt(r, true, true)
}

/** Reads what Home Assistant holds right now and acts on it. A failed read changes nothing */
async function pull() {
  const at = src
  if (!at?.userData) return
  let value: unknown
  try {
    value = await at.userData.get(KEY)
  } catch {
    if (at === src) useSync.setState({ status: 'error' })
    return
  }
  if (at === src) await reconcile(classify(value))
}

/** The user's choice on a conflict (ui/SyncPrompt.tsx) */
export function resolveConflict(choice: 'remote' | 'local') {
  const r = useSync.getState().conflict
  if (!r) return
  useSync.setState({ conflict: null })
  if (choice === 'remote') adopt(r, true, true)
  else {
    const homes = localHomes()
    void push(homes, sigOf(homes), true, r)
  }
}

/** Only for unreadable data, on the user's request: the old value is kept in Home Assistant, this device's plan replaces it */
export async function replaceUnreadable() {
  const data = src?.userData
  const homes = localHomes()
  if (!data || !homes.length || useSync.getState().blocked !== 'unreadable') return
  try {
    await data.set(HA_UNREADABLE_KEY, await data.get(KEY))
  } catch {
    return useSync.setState({ status: 'error' })
  }
  await push(homes, sigOf(homes), true, null)
}

/** Copies of the plan, newest first: in this browser and in Home Assistant */
export async function planHistory(): Promise<PlanCopy[]> {
  const device = localCopies().map((c): PlanCopy => ({ ...c, schema: c.schema ?? FIRST_SCHEMA, where: 'device' }))
  let ha: PlanCopy[] = []
  try {
    if (src?.userData) ha = haCopies(await src.userData.get(HA_BACKUPS_KEY)).map((c) => ({ ...c, where: 'ha' }))
  } catch {
    /* the copies in this browser are still listed */
  }
  return [...device, ...ha].filter((c) => c.schema <= STORE_VERSION).sort((a, b) => b.at.localeCompare(a.at))
}

/** Puts a copy back: what is here now is kept first, and on a connection the copy goes to Home Assistant like an edit */
export function restorePlan(copy: Pick<PlanCopy, 'homes' | 'schema'>) {
  keepBackup(localHomes())
  applyHomes(upgraded(copy.homes, copy.schema), copy.homes[0]?.id)
  lastSig = sigOf(localHomes())
  saveMeta({ editedAt: new Date().toISOString(), dirty: true, editHash: hashOf(lastSig) })
  useView.getState().request({ kind: 'house' })
  void pull()
}

/** Downloads all homes as one file */
export function exportHomes() {
  const body = { kind: 'homescape-homes', schema: STORE_VERSION, exportedAt: new Date().toISOString(), homes: localHomes() }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }))
  a.download = 'homescape-homes.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Opens a file saved by exportHomes (all homes) or exportLayout (one plan) */
export async function importPlanFile(file: File) {
  const data = JSON.parse(await file.text()) as { kind?: string; schema?: number; homes?: SyncHome[] }
  if (data?.kind !== 'homescape-homes') return importLayout(file)
  const schema = data.schema ?? FIRST_SCHEMA
  if (schema > STORE_VERSION) throw new Error(t('This file was saved by a newer version of Homescape.'))
  if (!Array.isArray(data.homes) || !data.homes.length) throw new Error(t('This file is not a Homescape plan.'))
  restorePlan({ homes: data.homes, schema })
}

/** Changes that are not hand edits (the plan generated on first start): true while one runs */
let systemChange = false
/** Runs a plan change that is not a hand edit: it is not written to Home Assistant */
export function withoutEdit(fn: () => void) {
  systemChange = true
  try {
    fn()
  } finally {
    systemChange = false
  }
}

/** The plan changed on this device (may be a hand edit) */
let editHint = false
/** Signature of the plan last seen on this device (switching homes does not change it: not an edit) */
let lastSig: string | null = null

/** A moment later: if the content really changed, mark it as an edit and, when connected, compare with Home Assistant */
function onLocalChange() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    const hint = editHint
    editHint = false
    const homes = localHomes()
    const sig = sigOf(homes)
    if (hint && lastSig !== null && sig !== lastSig) saveMeta({ editedAt: new Date().toISOString(), dirty: true, editHash: hashOf(sig) })
    lastSig = sig
    if (!src?.userData || useSync.getState().conflict || !homes.length || sig === meta.sig) return
    void pull()
  }, PUSH_MS)
}

function stop() {
  clearTimeout(pushTimer)
  clearTimeout(retryTimer)
  for (const f of stopFns) f()
  stopFns = []
  src = null
  useSync.setState({ status: 'off', conflict: null, blocked: null })
}

async function start(source: HaSource | null) {
  stop()
  if (!source || source.kind !== 'live' || !source.userData) return
  src = source
  const data = source.userData
  try {
    // The sync record belongs to one account: with another user the plan here is not a version of theirs
    const owner = (await data.owner?.()) ?? null
    if (src !== source) return
    if (owner && meta.owner && owner !== meta.owner) {
      keepBackup(localHomes())
      saveMeta({ owner, base: null, sig: null, dirty: false })
    } else if (owner && !meta.owner) saveMeta({ owner })
    const first = classify(await data.get(KEY))
    if (src !== source) return
    await reconcile(first)
  } catch {
    if (src === source) {
      useSync.setState({ status: 'error' })
      retryTimer = setTimeout(() => {
        if (src === source) void start(source)
      }, RETRY_MS)
    }
    return
  }
  const off = await data.subscribe(KEY, (v) => {
    if (src === source) void reconcile(classify(v))
  })
  if (src !== source) return off?.()
  if (off) stopFns.push(off)
  else {
    // No change reports: read at an interval and when the tab becomes visible
    const timer = setInterval(() => void pull(), POLL_MS)
    const vis = () => document.visibilityState === 'visible' && void pull()
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
    if (!systemChange) editHint = true
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
export const syncDebug = () => ({ ...useSync.getState(), meta: { ...meta } })
