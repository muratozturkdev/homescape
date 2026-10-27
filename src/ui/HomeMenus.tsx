import { Check, ChevronDown, House, Layers, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AMERICAN_NAME, americanLayout } from '@/demo/american'
import { findAmericanHome, openAmericanHome } from '@/demo/demoHomes'
import { homeDir, homeLayout, switchHomeAnimated } from './homeSwitch'
import { useSync } from '@/ha/planSync'
import { useHa } from '@/ha/store'
import { activeHomeId, activeLevel, homesOf, levelName, useLayout } from '@/model/layoutStore'
import { type RoofMode, type RoofStyle, useView } from '@/scene/camera'
import { floorNumber, t, tn } from '@/i18n'

/** Roof display options */
const ROOF_MODES: [RoofMode, string][] = [
  ['auto', t('Auto')],
  ['on', t('Always')],
  ['off', t('Hidden')],
]
/** Roof styles: tiled hip roof, flat concrete roof (with parapet) */
const ROOF_STYLES: [RoofStyle, string][] = [
  ['tile', t('Tiled')],
  ['concrete', t('Concrete')],
]

/*
 * Home and floor pickers, for homes with several floors and for several homes with switching between them. Two dropdowns
 * on the left of the top bar: homes (switch, rename, delete, new home) and floors (switch, add above, basement, copy rooms,
 * rename, delete, show lower floors). All homes use the same Home Assistant.
 */

/** Dropdown below its button; closes on an outside click or Esc. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

const trigger = 'flex h-9 max-w-[180px] items-center gap-1.5 rounded-xl border border-line bg-surface px-2 text-[12.5px] font-semibold text-ink-2 hover:text-ink sm:px-2.5'
const menu = 'glass absolute left-0 top-[calc(100%+8px)] z-50 grid w-[290px] gap-1 rounded-2xl p-2'
const row = (on: boolean) => `group flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-left text-[13px] ${on ? 'bg-brand-50 font-semibold text-brand' : 'text-ink hover:bg-surface-2'}`
const iconBtn = 'grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface hover:text-ink'
/** Button waiting for confirmation (deletes on the second click): red. A separate class because the hover colors of iconBtn overrode the red and left a white icon on white. */
const confirmBtn = 'grid size-7 shrink-0 place-items-center rounded-lg bg-miss text-white'

/** Inline name editing: Enter saves, Esc cancels. */
function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial)
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(v)
        if (e.key === 'Escape') onDone(null)
      }}
      onBlur={() => onDone(v)}
      className="min-h-9 min-w-0 flex-1 rounded-lg border border-brand bg-surface px-2 text-[13px] outline-none"
    />
  )
}

export function HomeSwitcher() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [resetAsk, setResetAsk] = useState(false)
  // The selector must not return a new array (zustand would rerender every time): select the raw fields, build the list outside
  const rawHomes = useLayout((s) => s.homes)
  const rawId = useLayout((s) => s.homeId)
  const homes = homesOf({ homes: rawHomes, homeId: rawId })
  const homeId = activeHomeId({ homes: rawHomes, homeId: rawId })
  const ref = useDismiss(open, () => setOpen(false))
  const current = homes.find((h) => h.id === homeId) ?? homes[0]
  const L = () => useLayout.getState()
  // Homes synced through Home Assistant (ha/planSync.ts)
  const sync = useSync((s) => s.status)

  return (
    <div ref={ref} className="relative">
      <button type="button" id="home-switcher" className={trigger} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Homes: switch or add a new home')}>
        <House size={15} className="shrink-0 text-brand" />
        <span className="hidden truncate sm:inline">{current.name}</span>
        <ChevronDown size={14} className="hidden shrink-0 text-ink-3 sm:block" />
      </button>
      {open && (
        <div className={menu} role="menu" aria-label={t('Homes')}>
          <p className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">{t('Homes')}</p>
          {homes.map((h) =>
            editing === h.id ? (
              <div key={h.id} className="flex items-center gap-1 px-1">
                <NameInput
                  initial={h.name}
                  onDone={(name) => {
                    if (name) L().renameHome(h.id, name)
                    setEditing(null)
                  }}
                />
              </div>
            ) : (
              <div key={h.id} className={row(h.id === homeId)}>
                <button
                  type="button"
                  data-home={h.name}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2"
                  onClick={() => {
                    setOpen(false)
                    if (h.id === homeId) return
                    switchHomeAnimated(() => L().switchHome(h.id), homeDir(h.id), () => homeLayout(h.id))
                  }}
                >
                  {h.id === homeId ? <Check size={15} className="shrink-0" /> : <House size={15} className="shrink-0 text-ink-3" />}
                  <span className="truncate">{h.name}</span>
                </button>
                <button type="button" className={iconBtn} title={t('Rename')} onClick={() => setEditing(h.id)}>
                  <Pencil size={13} />
                </button>
                {homes.length > 1 && (
                  <button
                    type="button"
                    className={confirm === h.id ? confirmBtn : iconBtn}
                    title={confirm === h.id ? t('Click again to delete') : t('Delete home')}
                    onClick={() => {
                      if (confirm !== h.id) return setConfirm(h.id)
                      L().deleteHome(h.id)
                      setConfirm(null)
                      useHa.setState({ notice: t('"{name}" deleted.', { name: h.name }) })
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ),
          )}
          <div className="my-1 h-px bg-line" />
          {adding ? (
            <div className="flex items-center gap-1 px-1">
              <NameInput
                initial={t('Home {number}', { number: homes.length + 1 })}
                onDone={(name) => {
                  setAdding(false)
                  if (name === null) return
                  setOpen(false)
                  const title = name || t('Home {number}', { number: homes.length + 1 })
                  switchHomeAnimated(() => L().addHome(title))
                  useHa.setState({ notice: t('New home created: draw its rooms from the Rooms tab below. Switch to your other homes from the home menu.') })
                }}
              />
            </div>
          ) : (
            <button type="button" id="home-add" className={row(false)} onClick={() => setAdding(true)}>
              <Plus size={15} className="text-brand" />
              {t('Add a new home')}
            </button>
          )}
          <ExampleHomes
            resetAsk={resetAsk}
            setResetAsk={setResetAsk}
            close={() => {
              setOpen(false)
              setResetAsk(false)
            }}
          />
          <p className="px-2 pt-1 text-[11px] leading-relaxed text-ink-3">
            {t('Each home has its own plan and floors; all of them use the same Home Assistant connection.')}
            {sync === 'synced' && ` ${t('Homes are stored in Home Assistant: every device signed in with the same user (iPad, phone) sees these homes.')}`}
            {sync === 'waiting' && ` ${t('No home plan is stored in Home Assistant yet: it is saved there when you make a change on this device.')}`}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Example homes: the American house and its street (demo/american.ts), with every item of the app, for testing. Created
 * as a new home when missing, otherwise switched to; "Reset" restores only that home's plan to its initial state (two
 * clicks). Other homes are not touched.
 */
function ExampleHomes({ resetAsk, setResetAsk, close }: { resetAsk: boolean; setResetAsk: (v: boolean) => void; close: () => void }) {
  // The selector returns only a boolean (not a new object on every render)
  const exists = useLayout(() => findAmericanHome() !== null)
  const live = useHa((s) => s.settings.mode === 'live')
  const open = (reset: boolean) => {
    close()
    const id = findAmericanHome()
    // Already in the example home (reset): no flight, the home is refreshed in place
    if (id && id === activeHomeId(useLayout.getState())) {
      openAmericanHome(reset)
      useView.getState().request({ kind: 'house' })
    } else switchHomeAnimated(() => openAmericanHome(reset), id ? homeDir(id) : 1, () => (id && !reset && homeLayout(id)) || americanLayout())
    useHa.setState({
      notice: live
        ? t("American house opened. Even with a live connection the example home's devices run locally; no commands reach your real home.")
        : reset
          ? t('American house reset: street, front and back yard, two floors. The devices run locally, no Home Assistant needed.')
          : t('American house opened: street, front and back yard, two floors; every item of the app is here. The devices run locally, no Home Assistant needed.'),
    })
  }
  return (
    <>
      <p className="px-2 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">{t('Example homes')}</p>
      <div className={row(false)}>
        <button type="button" id="home-demo-american" className="flex min-h-10 min-w-0 flex-1 items-center gap-2" onClick={() => open(false)} title={t('Example home that uses every item: for testing and trying things out')}>
          <Sparkles size={15} className="shrink-0 text-brand" />
          <span className="truncate">{AMERICAN_NAME}</span>
        </button>
        {exists && (
          <button
            type="button"
            id="home-demo-american-reset"
            className={resetAsk ? confirmBtn : iconBtn}
            title={resetAsk ? t('Click again to reset (changes in this home are lost)') : t('Reset')}
            onClick={() => {
              if (!resetAsk) return setResetAsk(true)
              open(true)
            }}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </>
  )
}

export function FloorSwitcher() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [copy, setCopy] = useState(true)
  const [confirm, setConfirm] = useState<string | null>(null)
  const levels = useLayout((s) => s.layout?.levels)
  const active = useLayout((s) => activeLevel(s))
  const mode = useLayout((s) => s.mode)
  const lower = useView((s) => s.lowerFloors)
  const roof = useView((s) => s.roof)
  const homeId = useLayout((s) => activeHomeId(s))
  const roofStyle = useView((s) => s.roofStyle[homeId] ?? 'tile')
  const ref = useDismiss(open, () => setOpen(false))
  if (!levels || !active) return null
  const L = () => useLayout.getState()
  // Top to bottom: the highest floor first in the menu (like elevator buttons)
  const sorted = [...levels].sort((a, b) => (b.elevation ?? 0) - (a.elevation ?? 0))
  const add = (below: boolean) => {
    const id = L().addLevel({ below, copyRooms: copy })
    if (!id) return
    setOpen(false)
    useView.getState().request({ kind: 'house' })
    useHa.setState({
      notice: below
        ? t('Basement added.')
        : copy
          ? t('New floor added with the rooms of the floor below. Put stairs on the floor below: the first-person walk then moves between floors.')
          : t('New floor added.'),
    })
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" id="floor-switcher" className={trigger} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('Floors: switch or add a floor')}>
        <Layers size={15} className="shrink-0 text-brand" />
        <span className="hidden truncate sm:inline">{levelName(active)}</span>
        {levels.length > 1 && <span className="rounded-md bg-surface-2 px-1 font-mono text-[10.5px] text-ink-3">{levels.length}</span>}
        <ChevronDown size={14} className="hidden shrink-0 text-ink-3 sm:block" />
      </button>
      {open && (
        <div className={menu} role="menu" aria-label={t('Floors')}>
          <p className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">{t('Floors')}</p>
          {sorted.map((l) =>
            editing === l.id ? (
              <div key={l.id} className="flex items-center gap-1 px-1">
                <NameInput
                  initial={levelName(l)}
                  onDone={(name) => {
                    if (name) L().renameLevel(l.id, name)
                    setEditing(null)
                  }}
                />
              </div>
            ) : (
              <div key={l.id} className={row(l.id === active.id)}>
                <button
                  type="button"
                  data-level={levelName(l)}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2"
                  onClick={() => {
                    L().setLevel(l.id)
                    setOpen(false)
                  }}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 font-mono text-[11px] font-semibold">{(l.elevation ?? 0) === 0 ? t('G') : (l.elevation ?? 0) < 0 ? t('B{number}', { number: -(l.elevation ?? 0) }) : floorNumber(l.elevation ?? 0)}</span>
                  <span className="truncate">{levelName(l)}</span>
                  <span className="ml-auto shrink-0 text-[11px] font-normal text-ink-3">{tn(l.rooms.length, '{count} room', '{count} rooms')}</span>
                </button>
                {mode === 'edit' && (
                  <button type="button" className={iconBtn} title={t('Rename')} onClick={() => setEditing(l.id)}>
                    <Pencil size={13} />
                  </button>
                )}
                {mode === 'edit' && levels.length > 1 && (
                  <button
                    type="button"
                    className={confirm === l.id ? confirmBtn : iconBtn}
                    title={confirm === l.id ? t('Click again to delete (⌘Z brings it back)') : t('Delete the floor with everything on it')}
                    onClick={() => {
                      if (confirm !== l.id) return setConfirm(l.id)
                      L().deleteLevel(l.id)
                      setConfirm(null)
                    }}
                  >
                    {confirm === l.id ? <X size={13} /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            ),
          )}
          <div className="my-1 h-px bg-line" />
          <button type="button" id="floor-add-up" className={row(false)} onClick={() => add(false)}>
            <Plus size={15} className="text-brand" />
            {t('Add a floor above')}
          </button>
          <button type="button" id="floor-add-down" className={row(false)} onClick={() => add(true)}>
            <Plus size={15} className="text-brand" />
            {t('Add a basement')}
          </button>
          <label className="flex min-h-9 items-center gap-2 px-2.5 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            {t("Copy this floor's rooms to the new floor")}
          </label>
          <label className="flex min-h-9 items-center gap-2 px-2.5 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={lower} onChange={(e) => useView.getState().setLowerFloors(e.target.checked)} />
            {t('Show lower floors below')}
          </label>
          {/* Roof (scene/Roofs.tsx): on Auto it shows from afar and comes off when zooming in */}
          <div className="grid gap-1.5 px-2.5 pb-1 pt-1.5">
            <span className="text-[12.5px] text-ink-2">{t('Roof')}</span>
            <div className="flex gap-1" role="radiogroup" aria-label={t('Roof')}>
              {ROOF_MODES.map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  id={`roof-${m}`}
                  role="radio"
                  aria-checked={roof === m}
                  onClick={() => useView.getState().setRoof(m)}
                  className={`min-h-8 flex-1 rounded-lg text-[12px] font-semibold ${roof === m ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] leading-snug text-ink-3">{t('Auto: shown when viewed from afar, removed when you zoom in or focus on a room.')}</span>
            <span className="mt-1 text-[12.5px] text-ink-2">{t('Roof style')}</span>
            <div className="flex gap-1" role="radiogroup" aria-label={t('Roof style')}>
              {ROOF_STYLES.map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  id={`roof-style-${m}`}
                  role="radio"
                  aria-checked={roofStyle === m}
                  onClick={() => useView.getState().setRoofStyle(activeHomeId(useLayout.getState()), m)}
                  className={`min-h-8 flex-1 rounded-lg text-[12px] font-semibold ${roofStyle === m ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
