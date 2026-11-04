import { ArrowDown, Group, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { openDemoHome } from '@/demo/demoHomes'
import { startPlanSync, withoutEdit } from '@/ha/planSync'
import { useHa } from '@/ha/store'
import { t, tn } from '@/i18n'
import { groupFamily, HEATING, heatingSummary } from '@/model/groups'
import { moveWithContents } from '@/model/containers'
import { rotateRoom } from '@/ui/rotateRoom'
import type { Item } from '@/model/types'
import { AlarmBanner } from '@/ui/AlarmBanner'
import { generateLayout } from '@/model/generate'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { cameraApi, toggleRoof, useView } from '@/scene/camera'
import { useNight } from '@/scene/useNight'
import { kick } from '@/scene/frame'
import BuildBar from '@/ui/BuildBar'
import ConnectDialog from '@/ui/ConnectDialog'
import Dashboard from '@/ui/Dashboard'
import FpsHud from '@/ui/FpsHud'
import { applyPanelVars, usePanel } from '@/ui/panelState'
import HomeScreenGuide from '@/ui/HomeScreenGuide'
import { isStandalone } from '@/ui/fullscreen'
import QuickPill from '@/ui/QuickPill'
import PlanHistory from '@/ui/PlanHistory'
import SyncPrompt from '@/ui/SyncPrompt'
import SearchPalette from '@/ui/SearchPalette'
import EditToolbar from '@/ui/EditToolbar'
import Inspector from '@/ui/Inspector'
import KpiTiles from '@/ui/KpiTiles'
import MapControls from '@/ui/MapControls'
import PinLayer from '@/ui/PinLayer'
import RoomBar from '@/ui/RoomBar'
import Toast from '@/ui/Toast'
import TopBar from '@/ui/TopBar'
import { useHomeTotals, useRoomStats } from '@/ui/useHome'
import { multiCounts, removeMulti, removeRoom } from '@/ui/removal'
import { usePlacementInput } from '@/ui/usePlacementInput'
import { mountY, nudgeAlongWall, setMountY } from '@/ui/mount'
import { isWallMounted } from '@/model/rules'

const Scene = lazy(() => import('@/scene/Scene'))
/** In the home screen app the connection dialog opened once by itself (once closed, it does not open again) */
const STANDALONE_ASKED = 'homescape-standalone-asked'
function askStandalone() {
  if (!isStandalone() || useHa.getState().settings.mode !== 'demo') return false
  try {
    return localStorage.getItem(STANDALONE_ASKED) !== '1'
  } catch {
    return true
  }
}

/** On first start without a plan, generates one from the areas of the connected source (demo or live). */
function useAutoLayout() {
  const hasLayout = useLayout((s) => Boolean(s.layout))
  const registry = useHa((s) => s.registry)
  const entities = useHa((s) => s.entities)
  const ready = Object.keys(entities).length > 0
  useEffect(() => {
    if (hasLayout || !registry || !ready) return
    const { layout, unplaced } = generateLayout(registry, entities)
    // Not a hand edit: a generated plan is never written over the plan in Home Assistant
    withoutEdit(() => {
      useLayout.getState().setLayout(layout, unplaced)
      useLayout.setState({ past: [] })
    })
  }, [hasLayout, registry, ready, entities])
}

const isField = (el: EventTarget | null) => {
  const node = el as HTMLElement | null
  return Boolean(node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable))
}

/** ⌥ or ⇧ held: left drag rotates the camera (the cursor becomes "move"). */
function setRotate(on: boolean) {
  if (useView.getState().rotateKey === on) return
  useView.getState().setRotateKey(on)
  if (on) document.body.dataset.rotate = '1'
  else delete document.body.dataset.rotate
}

function setPan(on: boolean) {
  if (useView.getState().panKey === on) return
  useView.getState().setPanKey(on)
  if (on) document.body.dataset.pan = '1'
  else {
    delete document.body.dataset.pan
    delete document.body.dataset.grabbing
  }
}

/*
 * Keyboard and mouse shortcuts (help card: MapControls > ?):
 * left drag: rotate (the hand button in the map controls switches it to pan) · right/middle drag: pan
 * ⌥ / ⇧ + left drag: rotate (in hand mode) · two-finger sideways swipe on a trackpad: rotate
 * WASD / arrow keys: pan · Q / E: rotate 45°
 * + / -: zoom · F: focus the selected room or the home · Esc: drop placement, tool, selection
 * Space held + drag: pan even over an item or room
 * Edit: R rotate (the ghost while placing), Delete delete, ⌘Z / ⇧⌘Z undo / redo
 */
function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isField(e.target)) return
      // In first-person walk FpsControls handles the keys (WASD walks, Esc exits)
      if (useView.getState().fps) return
      const s = useLayout.getState()

      if (e.key === 'Alt' || e.key === 'Shift') {
        if (e.key === 'Alt') e.preventDefault() // on Windows, keep focus off the browser menu
        setRotate(true)
        return
      }

      if (e.code === 'Space') {
        e.preventDefault() // no page scroll, no click on the focused button
        if (!e.repeat) setPan(true)
        return
      }

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      const placing = usePlacement.getState()
      if (e.key === 'Escape') {
        if (placing.target) placing.cancel()
        else if (s.multi) s.setMulti(null)
        else if (s.tool !== 'select') s.setTool('select')
        else s.select(null)
        return
      }
      const key = e.key.toLowerCase()
      if (placing.target && key === 'r' && !mod) {
        placing.rotate(e.shiftKey ? -1 : 1)
        return
      }
      if (!mod && (key === 'q' || key === 'e')) return cameraApi.rotate(key === 'q' ? 45 : -45)
      if (!mod && 'wasd'.includes(key) && key.length === 1) {
        const step = e.shiftKey ? 3 : 1.5
        cameraApi.pan(key === 'a' ? -step : key === 'd' ? step : 0, key === 'w' ? step : key === 's' ? -step : 0)
        return
      }
      if (e.key === '+' || e.key === '=') return cameraApi.zoomIn()
      if (e.key === '-' || e.key === '_') return cameraApi.zoomOut()
      // Hide / show the roof (scene/roof.ts)
      if (key === 't' && !mod) {
        toggleRoof()
        return
      }
      // Close / open the right panel (ui/panelState.ts)
      if (key === 'p' && !mod) {
        usePanel.getState().toggle()
        return
      }
      if (e.key.toLowerCase() === 'f' && !mod) {
        const room = s.selection?.type === 'room' ? s.selection.id : null
        useView.getState().request(room ? { kind: 'room', id: room } : { kind: 'house' })
        return
      }

      // Selected wall-mounted item: Page Up / Page Down moves it 5 cm up / down (25 cm with ⇧).
      if ((e.key === 'PageUp' || e.key === 'PageDown') && s.mode === 'edit' && s.selection?.type === 'item') {
        const sel = s.selection
        const item = activeLevel(s)?.items.find((i) => i.id === sel.id)
        if (item && isWallMounted(item.kind, item.variant, item.mount)) {
          e.preventDefault()
          setMountY(item, mountY(item) + (e.key === 'PageUp' ? 1 : -1) * (e.shiftKey ? 0.25 : 0.05))
        }
        return
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const dz = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
        const sel = s.selection
        if (s.mode === 'edit' && sel?.type === 'item') {
          const item = activeLevel(s)?.items.find((i) => i.id === sel.id)
          const step = e.shiftKey ? 0.25 : 0.05
          // A wall-mounted item stays on its wall: ←/→ along the wall, ↑/↓ height (ui/mount.ts, goes through the rules)
          if (item && isWallMounted(item.kind, item.variant, item.mount)) {
            if (dz) setMountY(item, mountY(item) - dz * step)
            else nudgeAlongWall(item, dx * step)
          } else if (item) s.updateItem(item.id, { x: item.x + dx * step, z: item.z + dz * step })
        } else if (s.mode === 'edit' && sel?.type === 'room') {
          s.checkpoint()
          s.moveRoom(sel.id, dx * 0.25, dz * 0.25)
        } else cameraApi.pan(dx * 1.5, -dz * 1.5)
        return
      }

      // Delete with an area selection: everything selected is deleted in one step.
      if (s.mode === 'edit' && s.multi && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removeMulti()
        return
      }
      // Delete with a room selected: the room goes with everything in it (items, doors); ⌘Z brings it back.
      if (s.mode === 'edit' && s.selection?.type === 'room' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removeRoom(s.selection.id)
        return
      }
      // R with a room selected: the room turns 90° with all its parts and items (⇧R the other way; ui/rotateRoom.ts)
      if (s.mode === 'edit' && s.selection?.type === 'room' && e.key.toLowerCase() === 'r' && !mod) {
        e.preventDefault()
        rotateRoom(s.selection.id, e.shiftKey ? -1 : 1)
        return
      }
      if (s.mode !== 'edit' || s.selection?.type !== 'item') return
      const id = s.selection.id
      const item = activeLevel(s)?.items.find((i) => i.id === id)
      if (!item) return
      if (e.key === 'Delete' || e.key === 'Backspace') s.deleteItem(id)
      // When a cabinet turns, its contents turn with it (model/containers.ts)
      if (e.key.toLowerCase() === 'r' && !mod) {
        const lv = activeLevel(s)
        const moves = lv ? moveWithContents(lv.items, id, { rot: item.rot + (e.shiftKey ? -1 : 1) * (Math.PI / 2) }) : []
        moves.forEach((m, i) => s.updateItem(m.id, m.patch, i === 0))
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 'Shift') {
        if (e.key === 'Alt' && !isField(e.target)) e.preventDefault()
        // Keep rotating while the other key is still held.
        setRotate(e.key === 'Alt' ? e.shiftKey : e.altKey)
      }
      if (e.code === 'Space') {
        if (!isField(e.target)) e.preventDefault()
        setPan(false)
      }
    }
    const onBlur = () => {
      setPan(false)
      setRotate(false)
    }
    const onPointerDown = () => {
      if (useView.getState().panKey) document.body.dataset.grabbing = '1'
    }
    const onPointerUp = () => delete document.body.dataset.grabbing

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [])
}

/** Shown during an area selection: how many rooms and items are selected, Delete / Cancel. */
function MultiBar() {
  const multi = useLayout((s) => s.multi)
  const roomsN = useLayout((s) => (s.multi ? multiCounts().rooms : 0))
  const itemsN = useLayout((s) => (s.multi ? multiCounts().items : 0))
  if (!multi) return null
  const selected =
    roomsN && itemsN
      ? t('{rooms} and {items} selected', { rooms: tn(roomsN, '{count} room', '{count} rooms'), items: tn(itemsN, '{count} item', '{count} items') })
      : roomsN
        ? tn(roomsN, '{count} room selected', '{count} rooms selected')
        : tn(itemsN, '{count} item selected', '{count} items selected')
  // The lights or the heating devices (boiler, radiator, towel warmer, thermostat) in the selection can become one group:
  // their links change together (model/groups.ts). A group has one family: with both selected there are two buttons.
  const level = activeLevel(useLayout.getState())
  const picked = multi.items.map((id) => level?.items.find((i) => i.id === id)).filter((i): i is Item => Boolean(i))
  const lights = picked.filter((it) => groupFamily(it.kind) === 'light').map((it) => it.id)
  // Boiler first: the group's link is taken from it (the first linked member)
  const heat = picked.filter((it) => groupFamily(it.kind) === 'heating').sort((a, b) => HEATING.indexOf(a.kind) - HEATING.indexOf(b.kind))
  const boilers = heat.filter((it) => it.kind === 'boiler').length
  const rest = heat.length - boilers
  const allRadiators = heat.every((it) => it.kind === 'boiler' || it.kind === 'radiator')
  const heatLabel =
    boilers === 1 && rest > 0
      ? allRadiators
        ? tn(rest, 'Group the boiler with {count} radiator', 'Group the boiler with {count} radiators')
        : tn(rest, 'Group the boiler with {count} device', 'Group the boiler with {count} devices')
      : boilers === 0 && allRadiators
        ? tn(rest, 'Group {count} radiator', 'Group {count} radiators')
        : tn(heat.length, 'Group {count} heating device', 'Group {count} heating devices')
  const group = (ids: string[], notice: string) => {
    const L = useLayout.getState()
    if (!L.groupItems(ids)) return
    L.select({ type: 'item', id: ids[0] })
    useHa.setState({ notice })
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[196px] z-40 flex justify-center px-4 lg:pr-(--panel)">
      <div className="glass pointer-events-auto flex items-center gap-3 rounded-2xl py-2 pl-4 pr-2" role="status">
        <span className="text-[13px] font-semibold text-ink">{selected}</span>
        <span className="hidden text-[11.5px] text-ink-3 sm:inline">{t('rooms include their contents · ⌘ / Ctrl-click: add / remove')}</span>
        {lights.length >= 2 && (
          <button
            type="button"
            onClick={() => group(lights, tn(lights.length, '{count} light grouped: their links now change together.', '{count} lights grouped: their links now change together.'))}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-600"
          >
            <Group size={14} />
            {tn(lights.length, 'Group {count} light', 'Group {count} lights')}
          </button>
        )}
        {heat.length >= 2 && (
          <button
            type="button"
            id="group-heating"
            title={t('The boiler, radiators, towel warmer and thermostat are linked to the same entity: when the boiler heats, the radiators warm up too')}
            onClick={() => group(heat.map((it) => it.id), t('Heating group created ({summary}): their links now change together.', { summary: heatingSummary(heat) }))}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-600"
          >
            <Group size={14} />
            {heatLabel}
          </button>
        )}
        <button type="button" onClick={removeMulti} className="flex items-center gap-1.5 rounded-xl bg-miss px-3 py-1.5 text-[12.5px] font-semibold text-white hover:brightness-95">
          <Trash2 size={14} />
          {t('Delete')}
        </button>
        <button type="button" onClick={() => useLayout.getState().setMulti(null)} className="rounded-xl px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:bg-surface-2">
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

/** In the middle of the scene on an empty plan: a gentle hint on where to start. */
function EmptyHint() {
  const empty = useLayout((s) => (activeLevel(s)?.rooms.length ?? 0) === 0)
  const placing = usePlacement((s) => Boolean(s.target))
  const drawing = useLayout((s) => s.tool !== 'select')
  if (!empty || placing || drawing) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[38%] z-20 flex justify-center px-4 lg:pr-(--panel)">
      <div className="glass flex max-w-[420px] flex-col items-center gap-1 rounded-2xl px-5 py-3 text-center">
        <p className="text-[14px] font-semibold text-ink">{t('Empty ground: draw your home')}</p>
        <p className="text-[12.5px] leading-relaxed text-ink-2">{t('Drag a room here from the Rooms tab below, or draw one by dragging on the ground with Free draw.')}</p>
        <ArrowDown size={18} className="mt-1 animate-bounce text-brand motion-reduce:animate-none" />
      </div>
    </div>
  )
}

/** Once on first start: a short hint that introduces the controls. */
function useFirstHint() {
  useEffect(() => {
    let seen = false
    try {
      seen = localStorage.getItem('homescape-hint-controls') === '1'
      localStorage.setItem('homescape-hint-controls', '1')
    } catch {
      /* storage unavailable */
    }
    if (seen) return
    const timer = setTimeout(
      () =>
        useHa.setState({
          notice: t('Tip: drag to rotate; to pan, right-drag or hold Space and drag; the wheel zooms. The hand button at the top right switches left drag to pan.'),
        }),
      1500,
    )
    return () => clearTimeout(timer)
  }, [])
}

/** A layer that opens and closes stays mounted for ms more while leaving (for the exit animation) */
function usePresence(on: boolean, ms: number) {
  const [prev, setPrev] = useState(on)
  const [closing, setClosing] = useState(false)
  // The moment of closing is caught during render (no synchronous state change in an effect)
  if (prev !== on) {
    setPrev(on)
    setClosing(!on)
  }
  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => setClosing(false), ms)
    return () => window.clearTimeout(timer)
  }, [closing, ms])
  return { mounted: on || closing, leaving: !on && closing }
}

export default function App() {
  // Homescape opened from the home screen has storage separate from the browser (iPadOS), so the Home Assistant connection
  // is missing there: without a connection (demo) the connection dialog opens by itself on first start and says why. Once
  // closed, it is not asked again (connect from the top bar).
  const [welcome, setWelcome] = useState(askStandalone)
  const [connectOpen, setConnectOpen] = useState(welcome)
  const mode = useLayout((s) => s.mode)
  const dashboard = useView((s) => s.dashboard) && mode === 'view'
  const dash = usePresence(dashboard, 200)
  const fps = useView((s) => s.fps)
  const night = useNight()
  // The status bar (home screen app) and the browser's bar take the top bar color; dark at night (ui/fullscreen.ts)
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#151b38' : '#f7f8fd')
    // In the home screen app the app paints under the status bar (index.css): at night the same dark as the top bar, by day dark blue
    document.body.dataset.night = night ? '1' : '0'
    if (isStandalone()) document.body.dataset.standalone = '1'
  }, [night])
  const stats = useRoomStats()
  const totals = useHomeTotals(stats)

  useAutoLayout()
  useShortcuts()
  useFirstHint()
  usePlacementInput()

  // Lite mode marks the body (CSS turns off the frosted glass).
  const lite = useView((s) => s.lite)
  useEffect(() => {
    if (lite) document.body.dataset.lite = '1'
    else delete document.body.dataset.lite
  }, [lite])

  // Switching to view mode cancels an unfinished placement.
  useEffect(() => {
    if (mode !== 'edit') usePlacement.getState().cancel()
  }, [mode])

  // The home plan is kept in the live Home Assistant and synced between devices (ha/planSync.ts)
  useEffect(() => startPlanSync(), [])

  // The right panel's width and open state live in CSS variables (the tool column, middle bands and bottom card follow them)
  useEffect(() => {
    applyPanelVars()
    const off = usePanel.subscribe(applyPanelVars)
    window.addEventListener('resize', applyPanelVars)
    return () => {
      off()
      window.removeEventListener('resize', applyPanelVars)
    }
  }, [])

  useEffect(() => {
    // The browser could not save the plan (localStorage.setItem failed): tell the user once a minute at most
    let told = 0
    const onFail = () => {
      if (Date.now() - told < 60_000) return
      told = Date.now()
      useHa.setState({ notice: t('This browser could not save the plan: its storage is full or unavailable. Changes may be lost when the page closes.') })
    }
    window.addEventListener('homescape:storage-failed', onFail)
    return () => window.removeEventListener('homescape:storage-failed', onFail)
  }, [])

  useEffect(() => {
    void useHa.getState().boot()
    window.__homescape = {
      select: (sel) => useLayout.getState().select(sel),
      setMode: (m) => useLayout.getState().setMode(m),
      setTheme: (theme) => useLayout.getState().setTheme(theme),
      focusRoom: (id) => useView.getState().request({ kind: 'room', id }),
      planView: (on) => useView.getState().setPlan(on),
      getState: () => ({ layout: useLayout.getState(), ha: { status: useHa.getState().status, entities: Object.keys(useHa.getState().entities).length } }),
      camera: () => cameraApi.debug(),
      // Camera commands and framing (tests do not import the camera module: after HMR it would be a second copy)
      cameraPan: (x, z) => cameraApi.pan(x, z),
      framePose: (rooms, pad) => cameraApi.framePose(rooms, pad),
      project: (x, y, z) => cameraApi.project(x, y, z),
      perf: () => import('@/scene/perf').then((m) => ({ ...m.perf })),
      roomLights: () => import('@/scene/roomLights').then((m) => m.lastRoomLights()),
      lighting: () => import('@/scene/sun').then((m) => ({ ...m.lightDebug })),
      people: () => import('@/scene/People').then((m) => JSON.parse(JSON.stringify(m.peopleDebug))),
      bins: () => import('@/scene/bins').then((m) => ({ ...m.binsDebug })),
      homeFlight: () => import('@/scene/camera').then((m) => JSON.parse(JSON.stringify(m.flightDebug))),
      pets: () => import('@/scene/petsDebug').then((m) => m.petsDebug),
      street: () => import('@/scene/streetPlan').then((m) => m.streetDebug),
      roof: () => import('@/scene/camera').then((m) => ({ ...m.roofView })),
      weather: () => import('@/scene/weatherState').then((m) => ({ ...m.weatherDebug, light: { ...m.weatherLight } })),
      weatherPreview: (sky) => import('@/ha/weather').then((m) => m.useWeatherPref.getState().setPreview((sky ?? null) as never)),
      fakeLive: () => import('@/dev/fakeLive').then((m) => m.fakeLive()),
      doorTraffic: () => import('@/scene/doorTraffic').then((m) => Object.keys(m.useDoorTraffic.getState().open)),
      fakeLiveCalls: () => import('@/dev/fakeLive').then((m) => [...m.fakeCalls]),
      sync: () => import('@/ha/planSync').then((m) => JSON.parse(JSON.stringify(m.syncDebug()))),
      fakeUser: (patch) => import('@/dev/fakeLive').then((m) => void Object.assign(m.fakeUserData, patch)),
      fakeBackups: () => import('@/dev/fakeLive').then((m) => m.fakeUserData.get('homescape-plan-backups')),
      fakeRemote: (value) => import('@/dev/fakeLive').then((m) => (value === undefined ? m.fakeUserData.get('homescape-plan') : (m.fakeUserData.put('homescape-plan', value), m.fakeUserData.get('homescape-plan')))),
      demo: () => useHa.getState().connectDemo(),
      pick: (x, y, z, dx, dy, dz) => import('@/dev/sceneProbe').then((m) => m.pick(x, y, z, dx, dy, dz)),
      itemObject: (id) => import('@/dev/sceneProbe').then((m) => m.itemObject(id)),
      sound: () => import('@/audio/engine').then((m) => m.soundDebug()),
      soundUnlock: () => import('@/audio/engine').then((m) => m.unlock()),
      soundNight: () => import('@/audio/ambienceState').then((m) => m.ambienceDebug.callNow()),
      soundMeasure: (kind, name, opt) => import('@/audio/engine').then((m) => m.measure(kind, name, opt)),
      soundPlay: (name, at, opt) => import('@/audio/engine').then((m) => m.play(name as never, at, opt)),
      fps: () => import('@/scene/FpsControls').then((m) => ({ ...m.fpsDebug })),
      fpsTeleport: (x, z, yaw, pitch) =>
        import('@/scene/FpsControls').then((m) => {
          m.fpsTeleport.to = { x, z, yaw, pitch }
          kick()
        }),
      entity: (id) => useHa.getState().entities[id] ?? null,
      entityIds: () => Object.keys(useHa.getState().entities),
      // Test: writes an entity state locally in demo mode (never touches a real home; does nothing in live mode).
      setEntity: (e) => {
        const src = useHa.getState().source
        if (src?.kind !== 'demo' || !src.inject) return false
        src.inject({ last_changed: new Date().toISOString(), ...e })
        return true
      },
      placement: () => {
        const { target, via, rot, result } = usePlacement.getState()
        return { target, via, rot, result, notice: useHa.getState().notice }
      },
      // Sample home (demo/demoHomes.ts): sets it up if missing, otherwise switches to it (reset: sets it up again); returns the home's id
      loadDemo: (name, reset) => openDemoHome(name, reset),
      // Test: service call on the demo source (applied locally); does nothing on a live connection
      call: async (domain, service, data) => {
        if (useHa.getState().source?.kind !== 'demo') return false
        await useHa.getState().call(domain, service, data)
        return true
      },
    }
  }, [])

  return (
    <main data-night={night} className="relative h-dvh w-full overflow-hidden bg-ground text-ink">
      <div className="absolute inset-0">
        <Suspense fallback={<p className="grid h-full place-items-center font-mono text-xs uppercase tracking-widest text-ink-3">{t('Building the home')}</p>}>
          <Scene />
        </Suspense>
      </div>
      {/* Quick on/off pill for items (ui/QuickPill.tsx, placed by scene/QuickAnchor.tsx): on a layer apart from the scene events */}
      <div id="quick-layer" className="pointer-events-none absolute inset-0 z-[40] overflow-hidden">
        <QuickPill />
      </div>
      {!fps && <PinLayer stats={stats} />}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <TopBar onConnect={() => setConnectOpen(true)} />
        <div className="relative flex-1">
          {fps ? (
            <>
              <FpsHud />
              <Inspector stats={stats} />
            </>
          ) : (
            <>
              {!dashboard && (
                <>
                  {mode === 'view' ? <KpiTiles totals={totals} /> : <EditToolbar />}
                  <MapControls />
                  <Inspector stats={stats} />
                  {mode === 'edit' ? <BuildBar /> : <RoomBar stats={stats} />}
                </>
              )}
              {/* The dashboard stays briefly while leaving and fades out (index.css > dash-out) */}
              {dash.mounted && <Dashboard leaving={dash.leaving} />}
            </>
          )}
        </div>
      </div>
      {mode === 'edit' && <EmptyHint />}
      {mode === 'edit' && <MultiBar />}
      <AlarmBanner />
      <SearchPalette />
      <SyncPrompt />
      <PlanHistory />
      <HomeScreenGuide />
      <Toast />
      {connectOpen && (
        <ConnectDialog
          welcome={welcome}
          onClose={() => {
            if (welcome) {
              try {
                localStorage.setItem(STANDALONE_ASKED, '1')
              } catch {
                /* storage unavailable */
              }
              setWelcome(false)
            }
            setConnectOpen(false)
          }}
        />
      )}
    </main>
  )
}
