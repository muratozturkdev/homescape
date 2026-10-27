import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  Droplets,
  Flame,
  House,
  Lightbulb,
  Lock,
  LockOpen,
  Minus,
  Pause,
  Play,
  Plug,
  Plus,
  Power,
  Shield,
  Sparkles,
  Square,
  Thermometer,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { canToggle, coverCommand, MOMENTARY, mediaPlayPause, setBrightness, setTemperature, toggle, turnOffAll } from '@/ha/actions'
import { deviceClass, domainOf, friendlyName, isActive, isReading, isUnavailable, num, stateLabel, supportsBrightness } from '@/ha/derive'
import { useHa } from '@/ha/store'
import type { HassEntity } from '@/ha/types'
import { t, tc, tn } from '@/i18n'
import { bindingsOf, itemLightIds } from '@/model/bindings'
import { inRoom, isOutdoor, isStreetSurface } from '@/model/geometry'
import { activeHomeId, homesOf, levelName, useLayout } from '@/model/layoutStore'
import type { Item, Level, Room } from '@/model/types'
import { useView } from '@/scene/camera'
import { AlarmControl, alarmTone } from './AlarmControl'
import { itemName } from './Bindings'
import { CameraSnapshot } from './Controls'
import { KIND_ICON } from './kindIcons'
import { fmt } from './useHome'

/*
 * Dashboard: the "Dashboard" tab of the top bar. The rooms of every floor as cards, with a direct control on each device
 * row (on/off, brightness, target temperature, cover open/stop/close, play/pause, lock); a summary and quick actions on
 * top (all lights, scenes), and on the side security, cameras, energy, media, people and devices not in the plan. Columns
 * drop as the screen narrows; everything stays reachable by scrolling. Clicking a device name selects it in the 3D view.
 */

const card = 'glass rounded-2xl p-4'
const h2 = 'mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink'

/** iOS-like on/off switch. */
function Switch({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-sun' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

const small = 'grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2 hover:text-ink'

/** Control at the end of a row, by entity domain. */
function RowControl({ e }: { e: HassEntity }) {
  const d = domainOf(e.entity_id)
  const on = isActive(e)
  if (isUnavailable(e)) return <span className="text-[12px] text-ink-3">{t('Unavailable')}</span>
  if (d === 'climate') {
    const target = num(e.attributes.temperature)
    const step = num(e.attributes.target_temp_step) ?? 0.5
    return (
      <div className="flex items-center gap-1">
        {target != null && (
          <>
            <button type="button" className={small} aria-label={t('Lower target')} onClick={() => setTemperature(e, target - step)}>
              <Minus size={14} />
            </button>
            <span className="w-11 text-center font-mono text-[13px] font-semibold tabular-nums">{fmt(target)}°</span>
            <button type="button" className={small} aria-label={t('Raise target')} onClick={() => setTemperature(e, target + step)}>
              <Plus size={14} />
            </button>
          </>
        )}
        <Switch on={on} onChange={() => void toggle(e)} label={t('Turn climate on or off')} />
      </div>
    )
  }
  if (d === 'cover') {
    return (
      <div className="flex items-center gap-1">
        <button type="button" className={small} aria-label={tc('action', 'Open')} onClick={() => coverCommand(e, 'open_cover')}>
          <ArrowUp size={14} />
        </button>
        <button type="button" className={small} aria-label={t('Stop')} onClick={() => coverCommand(e, 'stop_cover')}>
          <Square size={11} />
        </button>
        <button type="button" className={small} aria-label={t('Close')} onClick={() => coverCommand(e, 'close_cover')}>
          <ArrowDown size={14} />
        </button>
      </div>
    )
  }
  if (d === 'lock') {
    const locked = e.state === 'locked'
    return (
      <button type="button" onClick={() => void toggle(e)} className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold ${locked ? 'bg-ok-50 text-ok' : 'bg-warn-50 text-warn'}`}>
        {locked ? <Lock size={13} /> : <LockOpen size={13} />}
        {locked ? t('Locked') : tc('action', 'Lock')}
      </button>
    )
  }
  if (d === 'media_player') {
    return (
      <div className="flex items-center gap-1">
        {on && (
          <button type="button" className={small} aria-label={e.state === 'playing' ? t('Pause') : t('Play')} onClick={() => mediaPlayPause(e)}>
            {e.state === 'playing' ? <Pause size={14} /> : <Play size={14} />}
          </button>
        )}
        <Switch on={on} onChange={() => void toggle(e)} label={t('Turn on or off')} />
      </div>
    )
  }
  if (MOMENTARY.includes(d)) {
    return (
      <button type="button" onClick={() => void toggle(e)} className="h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brand-600">
        {t('Run')}
      </button>
    )
  }
  if (d === 'vacuum' || d === 'lawn_mower') {
    return (
      <button type="button" onClick={() => void toggle(e)} className={`h-8 rounded-lg px-3 text-[12px] font-semibold ${on ? 'bg-sun-50 text-ink' : 'bg-brand text-white hover:bg-brand-600'}`}>
        {on ? t('To dock') : t('Start')}
      </button>
    )
  }
  if (canToggle(e)) return <Switch on={on} onChange={() => void toggle(e)} label={t('Turn on or off')} />
  return <span className="max-w-32 truncate text-right font-mono text-[12.5px] tabular-nums text-ink-2">{stateLabel(e)}</span>
}

/** A device row: icon, name, state, control; a brightness slider below a light that is on. */
function DeviceRow({ e, item, Icon, onOpen }: { e: HassEntity; item?: Item; Icon: LucideIcon; onOpen?: () => void }) {
  const on = isActive(e)
  const [draft, setDraft] = useState<number | null>(null)
  const light = domainOf(e.entity_id) === 'light' && on && supportsBrightness(e)
  const b = ((num(e.attributes.brightness) ?? 255) / 255) * 100
  // The item's main entity shows the item's name, extras (like the light behind a TV) their own name
  const name = item && item.entityId === e.entity_id ? itemName(item, e) : friendlyName(e)
  return (
    <div className="grid grid-cols-1 gap-1.5 rounded-xl px-1.5 py-1.5 hover:bg-surface-2/60" data-dash-row={e.entity_id}>
      <div className="flex min-h-9 items-center gap-2.5">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${on && !isReading(e) ? 'bg-sun-50 text-sun' : 'bg-surface-2 text-ink-3'}`}>
          <Icon size={16} />
        </span>
        <button type="button" onClick={onOpen} disabled={!onOpen} className="min-w-0 flex-1 text-left disabled:cursor-default">
          <p className="truncate text-[13px] font-medium text-ink">{name}</p>
          <p className="truncate text-[11.5px] text-ink-3">{stateLabel(e)}</p>
        </button>
        <RowControl e={e} />
      </div>
      {light && (
        <input
          type="range"
          min={1}
          max={100}
          aria-label={t('Brightness')}
          value={draft ?? b}
          onChange={(ev) => setDraft(Number(ev.target.value))}
          onPointerUp={() => {
            if (draft != null) void setBrightness(e, draft)
            setDraft(null)
          }}
          onKeyUp={() => {
            if (draft != null) void setBrightness(e, draft)
            setDraft(null)
          }}
          className="ml-[42px] w-[calc(100%-42px)]"
        />
      )}
    </div>
  )
}

/** Main entities of the room's items (controllable ones first) and the room's lights. */
function roomDevices(room: Room, level: Level, entities: Record<string, HassEntity>) {
  const items = level.items.filter((it) => inRoom(room, it.x, it.z))
  const seen = new Set<string>()
  const rows: { e: HassEntity; item: Item }[] = []
  for (const it of items) {
    for (const id of bindingsOf(it)) {
      const e = entities[id]
      if (!e || seen.has(id)) continue
      // Sensors among the extras (temperature, humidity, battery...) go to the room header; rows only for main or controllable entities
      if (id !== it.entityId && !canToggle(e)) continue
      seen.add(id)
      rows.push({ e, item: it })
    }
  }
  rows.sort((a, b) => Number(isReading(a.e)) - Number(isReading(b.e)))
  const lights = [...new Set(items.flatMap(itemLightIds))].map((id) => entities[id]).filter((e): e is HassEntity => Boolean(e))
  return { rows, lights }
}

function RoomCard({ room, level, entities, areaEnts, onOpen }: { room: Room; level: Level; entities: Record<string, HassEntity>; areaEnts: HassEntity[]; onOpen: (item: Item) => void }) {
  const { rows, lights } = useMemo(() => roomDevices(room, level, entities), [room, level, entities])
  const pool = [...areaEnts, ...rows.map((r) => r.e)]
  const reading = (dc: string) => {
    const xs = pool.filter((e) => e.entity_id.startsWith('sensor.') && deviceClass(e) === dc).map((e) => num(e.state)).filter((n): n is number => n != null)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }
  const temp = reading('temperature')
  const hum = reading('humidity')
  const lightsOn = lights.filter(isActive)
  return (
    <section className={card} data-dash-room={room.name}>
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{room.name}</p>
        {temp != null && (
          <span className="flex items-center gap-1 font-mono text-[12px] tabular-nums text-ink-2">
            <Thermometer size={13} />
            {fmt(temp)}°
          </span>
        )}
        {hum != null && (
          <span className="flex items-center gap-1 font-mono text-[12px] tabular-nums text-ink-2">
            <Droplets size={13} />
            {t('{value}%', { value: fmt(hum, 0) })}
          </span>
        )}
      </div>
      {lights.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <Lightbulb size={15} className={lightsOn.length ? 'text-sun' : 'text-ink-3'} />
          <span className="flex-1 text-[12.5px] text-ink-2">
            {tn(lights.length, '{on}/{count} light on', '{on}/{count} lights on', { on: lightsOn.length })}
          </span>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[12px] font-semibold text-brand hover:bg-surface"
            onClick={() => {
              if (lightsOn.length) turnOffAll(lightsOn)
              else for (const l of lights) void toggle(l)
            }}
          >
            {lightsOn.length ? t('Turn all off') : t('Turn all on')}
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-2 text-[12.5px] text-ink-3">{t('No bound devices in this room.')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-0.5">
          {rows.map(({ e, item }) => (
            <DeviceRow key={`${item.id}-${e.entity_id}`} e={e} item={item} Icon={KIND_ICON[item.kind]} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Order of the card (cards appear in this order when the Dashboard opens) */
const rise = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties

/**
 * Masonry layout: each card goes into the shortest column, so no gap stays under a short card next to a long one. The
 * column count comes from the container width (three from 1000 px, two from 620 px). A card's height is estimated from its
 * rows, so cards do not move when a device is switched on or off.
 */
function Masonry({ items }: { items: { key: string; weight: number; node: ReactNode }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(2)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = (w: number) => setCols(w >= 1000 ? 3 : w >= 620 ? 2 : 1)
    set(el.clientWidth)
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const columns: { h: number; list: typeof items }[] = Array.from({ length: cols }, () => ({ h: 0, list: [] }))
  for (const it of items) {
    // Shortest column (the left one on a tie)
    const c = columns.reduce((m, x) => (x.h < m.h - 1 ? x : m), columns[0])
    c.list.push(it)
    c.h += it.weight
  }
  return (
    <div ref={ref} className="flex items-start gap-3" data-masonry={cols}>
      {columns.map((c, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {c.list.map((it) => (
            <Fragment key={it.key}>{it.node}</Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Estimated height of a room card (px): header, light strip, rows (a bit more for lights that may get a brightness slider) */
function roomWeight(room: Room, level: Level, entities: Record<string, HassEntity>) {
  const { rows, lights } = roomDevices(room, level, entities)
  const dim = rows.filter((r) => domainOf(r.e.entity_id) === 'light' && supportsBrightness(r.e)).length
  return 64 + (lights.length ? 50 : 0) + Math.max(1, rows.length) * 51 + dim * 12
}

/** Side card: title and rows; not drawn when empty. */
function SideCard({ title, Icon, children, empty }: { title: string; Icon: LucideIcon; children: React.ReactNode; empty: boolean }) {
  if (empty) return null
  return (
    <section className={card}>
      <p className={h2}>
        <Icon size={15} className="text-brand" />
        {title}
      </p>
      <div className="grid grid-cols-1 gap-1">{children}</div>
    </section>
  )
}

const DOMAIN_ICON: Record<string, LucideIcon> = {
  light: Lightbulb,
  switch: Plug,
  lock: Lock,
  camera: Camera,
  climate: Thermometer,
  media_player: Play,
  scene: Sparkles,
  script: Sparkles,
  person: Users,
  sensor: Zap,
}

export default function Dashboard({ leaving = false }: { leaving?: boolean }) {
  const layout = useLayout((s) => s.layout)
  const rawHomes = useLayout((s) => s.homes)
  const rawId = useLayout((s) => s.homeId)
  const entities = useHa((s) => s.entities)
  const registry = useHa((s) => s.registry)
  const [others, setOthers] = useState(false)
  const home = homesOf({ homes: rawHomes, homeId: rawId }).find((h) => h.id === activeHomeId({ homes: rawHomes, homeId: rawId }))
  const levels = useMemo(() => [...(layout?.levels ?? [])].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0)), [layout])
  const all = useMemo(() => Object.values(entities), [entities])

  const byArea = useMemo(() => {
    const m = new Map<string, HassEntity[]>()
    for (const [id, area] of Object.entries(registry?.entityArea ?? {})) {
      if (!area || !entities[id]) continue
      if (!m.has(area)) m.set(area, [])
      m.get(area)!.push(entities[id])
    }
    return m
  }, [registry, entities])

  const bound = useMemo(() => new Set(levels.flatMap((l) => l.items.flatMap(bindingsOf))), [levels])
  const planLights = useMemo(() => [...new Set(levels.flatMap((l) => l.items.flatMap(itemLightIds)))].map((id) => entities[id]).filter((e): e is HassEntity => Boolean(e)), [levels, entities])
  const lightsOn = planLights.filter(isActive)
  const alarm = all.find((e) => e.entity_id.startsWith('alarm_control_panel.'))
  const scenes = all.filter((e) => e.entity_id.startsWith('scene.') || e.entity_id.startsWith('script.')).slice(0, 16)
  const locks = all.filter((e) => e.entity_id.startsWith('lock.'))
  const cameras = all.filter((e) => e.entity_id.startsWith('camera.'))
  const safety = all.filter((e) => e.entity_id.startsWith('binary_sensor.') && ['smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety', 'problem'].includes(deviceClass(e)))
  const openings = all.filter((e) => e.entity_id.startsWith('binary_sensor.') && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e)) && e.state === 'on')
  const power = all.filter((e) => e.entity_id.startsWith('sensor.') && deviceClass(e) === 'power' && num(e.state) != null)
  const totalW = power.reduce((a, e) => a + (String(e.attributes.unit_of_measurement) === 'kW' ? (num(e.state) ?? 0) * 1000 : (num(e.state) ?? 0)), 0)
  const media = all.filter((e) => e.entity_id.startsWith('media_player.') && isActive(e))
  const people = all.filter((e) => e.entity_id.startsWith('person.'))
  const temps = levels.flatMap((l) => l.rooms).flatMap((r) => (r.areaId ? (byArea.get(r.areaId) ?? []) : [])).filter((e) => e.entity_id.startsWith('sensor.') && deviceClass(e) === 'temperature').map((e) => num(e.state)).filter((n): n is number => n != null)
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null
  const CONTROL = ['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'lock', 'humidifier', 'vacuum', 'lawn_mower', 'valve', 'water_heater', 'siren']
  const unplaced = all.filter((e) => CONTROL.includes(domainOf(e.entity_id)) && !bound.has(e.entity_id) && !registry?.skip.includes(e.entity_id))

  const open = (item: Item, level: Level) => {
    const L = useLayout.getState()
    useView.getState().setDashboard(false)
    if (L.levelId !== level.id) L.setLevel(level.id)
    L.select({ type: 'item', id: item.id })
    const room = level.rooms.find((r) => inRoom(r, item.x, item.z))
    if (room) useView.getState().request({ kind: 'room', id: room.id })
  }

  const chip = (Icon: LucideIcon, label: string, value: string, hot = false) => (
    <div className="glass flex min-w-0 items-center gap-3 rounded-2xl py-2.5 pl-2.5 pr-4">
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${hot ? 'bg-sun-50 text-sun' : 'icon-tile'}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[11.5px] text-ink-2">{label}</span>
        <span className="block truncate font-mono text-[17px] font-semibold tabular-nums">{value}</span>
      </span>
    </div>
  )

  return (
    <div id="dashboard" className={`pointer-events-auto absolute inset-0 z-30 overflow-y-auto bg-ground/80 backdrop-blur-md [scrollbar-gutter:stable] ${leaving ? 'dash-out' : 'dash-in'}`}>
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 p-4 pb-10 lg:p-6">
        <div className="dash-rise flex flex-wrap items-end gap-3" style={rise(0)}>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-brand">{t('Dashboard')}</p>
            <h1 className="truncate text-[22px] font-bold tracking-tight">{home?.name ?? t('My home')}</h1>
          </div>
          {lightsOn.length > 0 && (
            <button type="button" id="dash-lights-off" onClick={() => turnOffAll(lightsOn)} className="flex h-10 items-center gap-2 rounded-xl bg-sun-50 px-3 text-[13px] font-semibold text-ink ring-1 ring-sun/40">
              <Power size={15} />
              {t('Turn off all lights ({count})', { count: lightsOn.length })}
            </button>
          )}
        </div>

        <div className="dash-rise grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" style={rise(1)}>
          {chip(Lightbulb, t('Lights on'), `${lightsOn.length}/${planLights.length}`, lightsOn.length > 0)}
          {chip(Thermometer, t('Average temperature'), avgTemp == null ? '-' : `${fmt(avgTemp)}°`)}
          {chip(House, t('Open doors / windows'), openings.length ? String(openings.length) : t('None'), openings.length > 0)}
          {chip(Zap, t('Power now'), power.length ? (totalW >= 1000 ? `${fmt(totalW / 1000, 2)} kW` : `${fmt(totalW, 0)} W`) : '-')}
          {alarm ? chip(Shield, t('Security'), stateLabel(alarm), alarm.state === 'triggered') : chip(Users, t('People at home'), people.length ? `${people.filter((p) => p.state === 'home').length}/${people.length}` : '-')}
        </div>

        {scenes.length > 0 && (
          <section className={`${card} dash-rise`} style={rise(2)}>
            <p className={h2}>
              <Sparkles size={15} className="text-brand" />
              {t('Scenes and scripts')}
            </p>
            <div className="flex flex-wrap gap-2">
              {scenes.map((e) => (
                <button key={e.entity_id} type="button" onClick={() => void toggle(e)} className="flex h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-[13px] font-semibold text-ink hover:bg-brand-50 hover:text-brand">
                  <Sparkles size={14} />
                  {friendlyName(e)}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid grid-cols-1 gap-5">
            {levels.map((l) => (
              <div key={l.id} className="grid grid-cols-1 gap-3">
                {levels.length > 1 && <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-3">{levelName(l)}</p>}
                {l.rooms.length === 0 ? (
                  <p className={`${card} text-[13px] text-ink-3`}>{t('No rooms on this floor. Draw rooms in edit mode.')}</p>
                ) : (
                  <Masonry
                    items={l.rooms
                      // Street surfaces and outdoor areas without devices (garden, neighbor's lot) are not on the Dashboard
                      .filter((r) => !isStreetSurface(r) && (!isOutdoor(r) || roomDevices(r, l, entities).rows.length > 0))
                      .map((r, i) => ({
                        key: r.id,
                        weight: roomWeight(r, l, entities),
                        node: (
                          <div className="dash-rise" style={rise(3 + i)}>
                            <RoomCard room={r} level={l} entities={entities} areaEnts={r.areaId ? (byArea.get(r.areaId) ?? []) : []} onOpen={(it) => open(it, l)} />
                          </div>
                        ),
                      }))}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="dash-rise grid grid-cols-1 gap-4" style={rise(3)}>
            {alarm && (
              <section className={card}>
                <p className={h2}>
                  <Shield size={15} className="text-brand" />
                  {t('Security')}
                  <span className={`ml-auto rounded-lg px-2 py-0.5 text-[11.5px] ${alarmTone(alarm.state)}`}>{stateLabel(alarm)}</span>
                </p>
                <AlarmControl e={alarm} />
              </section>
            )}
            <SideCard title={t('Locks')} Icon={Lock} empty={!locks.length}>
              {locks.map((e) => (
                <DeviceRow key={e.entity_id} e={e} Icon={Lock} />
              ))}
            </SideCard>
            <SideCard title={t('Safety sensors')} Icon={Flame} empty={!safety.length}>
              {safety.map((e) => (
                <DeviceRow key={e.entity_id} e={e} Icon={e.state === 'on' ? Flame : Shield} />
              ))}
            </SideCard>
            <SideCard title={t('Cameras')} Icon={Camera} empty={!cameras.length}>
              <div className="grid grid-cols-2 gap-2">
                {cameras.slice(0, 6).map((e) => (
                  <figure key={e.entity_id} className="grid gap-1">
                    <CameraSnapshot e={e} />
                    <figcaption className="truncate text-[11.5px] text-ink-2">{friendlyName(e)}</figcaption>
                  </figure>
                ))}
              </div>
            </SideCard>
            <SideCard title={t('Now playing')} Icon={Play} empty={!media.length}>
              {media.map((e) => (
                <DeviceRow key={e.entity_id} e={e} Icon={Play} />
              ))}
            </SideCard>
            <SideCard title={t('Energy')} Icon={Zap} empty={!power.length}>
              {[...power]
                .sort((a, b) => (num(b.state) ?? 0) - (num(a.state) ?? 0))
                .slice(0, 8)
                .map((e) => (
                  <DeviceRow key={e.entity_id} e={e} Icon={Zap} />
                ))}
            </SideCard>
            <SideCard title={t('People')} Icon={Users} empty={!people.length}>
              {people.map((e) => (
                <DeviceRow key={e.entity_id} e={e} Icon={Users} />
              ))}
            </SideCard>
            {unplaced.length > 0 && (
              <section className={card}>
                <button type="button" onClick={() => setOthers((o) => !o)} className={`${h2} mb-0 w-full`} aria-expanded={others}>
                  <Plug size={15} className="text-brand" />
                  {t('Devices not in the plan')}
                  <span className="ml-auto flex items-center gap-1 text-[12px] font-normal text-ink-3">
                    {unplaced.length}
                    <ChevronDown size={14} className={others ? 'rotate-180' : ''} />
                  </span>
                </button>
                {others && (
                  <div className="mt-3 grid grid-cols-1 gap-1">
                    {unplaced.slice(0, 60).map((e) => (
                      <DeviceRow key={e.entity_id} e={e} Icon={DOMAIN_ICON[domainOf(e.entity_id)] ?? Plug} />
                    ))}
                  </div>
                )}
              </section>
            )}
            <p className="px-1 text-[11.5px] leading-relaxed text-ink-3">
              {t('Click a device name to select it in the 3D view. Switch to the Edit tab to place devices in the plan.')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
