import { Check, ChevronDown, Plus, Power, Search, Star, TriangleAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { deviceClass, domainOf, friendlyName, isActive, isReading, isUnavailable, roleLabel, stateLabel } from '@/ha/derive'
import { useHa } from '@/ha/store'
import type { HassEntity } from '@/ha/types'
import { bindingsOf, ledTag, socketLabel } from '@/model/bindings'
import { CATALOG } from '@/model/catalog'
import { activeLevel, useLayout } from '@/model/layoutStore'
import type { Item, ItemKind, Room } from '@/model/types'
import { canToggle, MOMENTARY, toggle } from '@/ha/actions'
import { currentLang, lower, t } from '@/i18n'
import { EntityControls } from './Controls'

/*
 * Binding Home Assistant entities to items. An item is independent of HA; any entity can be bound to any item. The first
 * bound entity is the "main" one: it drives the 3D view and the main control. The others (temperature, humidity, plug,
 * lock, battery...) are read or controlled on the card.
 */

/** Entities that go well with an item kind (device_class or domain): ranked higher in the suggestions. */
const COMPANION: Partial<Record<ItemKind, string[]>> = {
  acUnit: ['temperature', 'humidity', 'power', 'energy'],
  radiator: ['temperature', 'humidity', 'power'],
  boiler: ['temperature', 'pressure', 'power', 'energy'],
  fan: ['temperature', 'humidity', 'power'],
  diffuser: ['humidity', 'power', 'light'],
  deskCamera: ['camera', 'power', 'motion'],
  stickVacuum: ['outlet', 'power', 'battery'],
  tv: ['power', 'energy', 'remote', 'light'],
  powerStrip: ['outlet', 'power', 'energy', 'voltage', 'current'],
  waterDispenser: ['power', 'energy', 'temperature'],
  console: ['power', 'energy'],
  monitor: ['power'],
  door: ['door', 'opening', 'garage_door', 'lock', 'motion', 'battery'],
  window: ['window', 'opening', 'cover', 'battery'],
  bed: ['occupancy', 'presence', 'temperature', 'light'],
  fridge: ['power', 'energy', 'temperature', 'door'],
  stove: ['power', 'gas', 'smoke'],
  sink: ['moisture'],
  washbasin: ['moisture'],
  bathtub: ['moisture', 'humidity'],
  sofa: ['occupancy', 'presence'],
  desk: ['occupancy', 'presence', 'power'],
  tempSensor: ['temperature', 'humidity', 'battery'],
  motionSensor: ['motion', 'occupancy', 'presence', 'illuminance', 'battery'],
  plug: ['power', 'energy', 'voltage', 'current'],
  dresser: ['light', 'switch'],
  mirrorCabinet: ['light', 'switch'],
  washer: ['power', 'energy', 'switch', 'vibration'],
  dryer: ['power', 'energy', 'switch', 'vibration'],
  dishwasher: ['power', 'energy', 'switch', 'moisture'],
  oven: ['power', 'energy', 'temperature', 'switch'],
  wallFan: ['fan', 'switch', 'temperature'],
  deskFan: ['fan', 'switch', 'temperature'],
}

/** Suggestion score: a domain that fits the kind +3, a good companion +2, in the same HA area as the room +2. */
export function suggestScore(kind: ItemKind, e: HassEntity, areaId: string | null | undefined, entityArea: Record<string, string | null>) {
  const d = domainOf(e.entity_id)
  let s = 0
  if (CATALOG[kind].domains.includes(d)) s += 3
  const comp = COMPANION[kind]
  if (comp && (comp.includes(deviceClass(e)) || comp.includes(d))) s += 2
  if (areaId && entityArea[e.entity_id] === areaId) s += 2
  return s
}

/* ---------- Edit: binding list + picker ---------- */

function BoundRow({ item, id, main, e }: { item: Item; id: string; main: boolean; e?: HassEntity }) {
  const L = useLayout.getState()
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${main ? 'border-brand bg-brand-50' : 'border-line'}`}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{e ? friendlyName(e) : id}</span>
          {main && <span className="shrink-0 rounded-md bg-brand px-1.5 py-px text-[10px] font-semibold text-white">{t('Main')}</span>}
        </span>
        <span className="block truncate text-[11px] text-ink-3">
          {e ? (
            [socketLabel(item, id) ?? ledTag(item, id), roleLabel(e), stateLabel(e)].filter(Boolean).join(' · ')
          ) : (
            <span className="inline-flex items-center gap-1 text-warn">
              <TriangleAlert size={11} /> {t('not in this Home Assistant')}
            </span>
          )}
        </span>
      </span>
      {!main && (
        <button type="button" onClick={() => L.makeMain(item.id, id)} className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-sun" title={t('Make main: this entity drives the 3D view')}>
          <Star size={14} />
        </button>
      )}
      <button type="button" onClick={() => L.unbind(item.id, id)} className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-miss" title={t('Remove binding')}>
        <X size={14} />
      </button>
    </div>
  )
}

function EntityPicker({ item, room, onClose }: { item: Item; room?: Room; onClose: () => void }) {
  const entities = useHa((s) => s.entities)
  const entityArea = useHa((s) => s.registry?.entityArea)
  const items = useLayout((s) => activeLevel(s)?.items)
  const [q, setQ] = useState('')
  const bound = bindingsOf(item)

  // Which entity is bound to which other item, for the "on Sofa" hint
  const usedBy = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items ?? []) {
      if (it.id === item.id) continue
      for (const id of bindingsOf(it)) if (!m.has(id)) m.set(id, it.name || CATALOG[it.kind].label)
    }
    return m
  }, [items, item.id])

  const scored = useMemo(
    () =>
      Object.values(entities)
        .map((e) => ({ e, s: suggestScore(item.kind, e, room?.areaId, entityArea ?? {}) }))
        .sort((a, b) => b.s - a.s || friendlyName(a.e).localeCompare(friendlyName(b.e), currentLang())),
    [entities, entityArea, item.kind, room?.areaId],
  )
  const hasSuggestions = scored.some((x) => x.s > 0)
  const [all, setAll] = useState(!hasSuggestions)

  const list = useMemo(() => {
    const needle = lower(q.trim())
    return scored
      .filter(({ e, s }) => (needle ? lower(`${friendlyName(e)} ${e.entity_id} ${roleLabel(e)}`).includes(needle) : all || s > 0))
      .slice(0, 100)
  }, [scored, q, all])

  const L = useLayout.getState()
  const chip = (on: boolean) => `rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${on ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`

  return (
    <div className="grid gap-2 rounded-xl border border-line p-2.5">
      <div className="flex items-center gap-1.5">
        <button type="button" className={chip(!all)} onClick={() => setAll(false)} disabled={!hasSuggestions}>
          {t('Suggested')}
        </button>
        <button type="button" className={chip(all)} onClick={() => setAll(true)}>
          {t('All entities')}
        </button>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-brand hover:bg-brand-50">
          {t('Done')}
        </button>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3">
        <Search size={15} className="text-ink-3" />
        <input
          id={`q-${item.id}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Name, entity_id or type (temperature, humidity...)')}
          className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-line" data-testid="entity-list">
        {list.length === 0 && <p className="px-3 py-3 text-[12px] text-ink-3">{t('No matching entities.')}</p>}
        {list.map(({ e, s }) => {
          const on = bound.includes(e.entity_id)
          const other = usedBy.get(e.entity_id)
          return (
            <button
              key={e.entity_id}
              type="button"
              data-entity={e.entity_id}
              onClick={() => (on ? L.unbind(item.id, e.entity_id) : L.bind(item.id, e.entity_id))}
              className={`flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-0 ${on ? 'bg-brand-50' : 'hover:bg-surface-2'}`}
            >
              <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${on ? 'border-brand bg-brand text-white' : 'border-line'}`}>{on && <Check size={12} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{friendlyName(e)}</span>
                <span className="block truncate font-mono text-[10.5px] text-ink-3">
                  {e.entity_id}
                  {other && <span className="font-sans text-ink-2"> · {t('on {item}', { item: other })}</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] text-ink-2">{stateLabel(e)}</span>
                <span className={`block text-[10px] ${s > 0 ? 'text-brand' : 'text-ink-3'}`}>{roleLabel(e)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BindingEditor({ item, room }: { item: Item; room?: Room }) {
  const entities = useHa((s) => s.entities)
  const ids = bindingsOf(item)
  const [adding, setAdding] = useState(ids.length === 0)
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-ink-2">{t('Home Assistant bindings')}</p>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-brand hover:bg-brand-50">
            <Plus size={14} />
            {t('Bind entity')}
          </button>
        )}
      </div>
      {ids.map((id) => (
        <BoundRow key={id} item={item} id={id} main={id === item.entityId} e={entities[id]} />
      ))}
      {ids.length > 0 && <p className="text-[11px] leading-relaxed text-ink-3">{t('The main entity drives the 3D view and the main button; the others are shown on the card. Use the star to make one main.')}</p>}
      {ids.length === 0 && !adding && <p className="text-[12px] text-ink-3">{t('No bound entities.')}</p>}
      {adding && <EntityPicker item={item} room={room} onClose={() => setAdding(false)} />}
    </div>
  )
}

/* ---------- View: extra entities ---------- */

/** tag: a short item specific label (the socket number on a power strip). */
function ExtraRow({ e, tag }: { e: HassEntity; tag?: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`size-2 shrink-0 rounded-full ${isActive(e) ? 'bg-sun' : 'bg-line'}`} />
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{friendlyName(e)}</span>
            <span className="block text-[11px] text-ink-3">{[tag, roleLabel(e), stateLabel(e)].filter(Boolean).join(' · ')}</span>
          </span>
          <ChevronDown size={14} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {canToggle(e) && (
          <button
            type="button"
            onClick={() => toggle(e)}
            className={`grid size-8 shrink-0 place-items-center rounded-lg ${isActive(e) ? 'bg-sun-50 text-ink ring-1 ring-sun/50' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
            title={MOMENTARY.includes(domainOf(e.entity_id)) ? t('Run') : isActive(e) ? t('Turn off') : t('Turn on')}
          >
            <Power size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-line px-3 py-3">
          <EntityControls e={e} />
        </div>
      )}
    </div>
  )
}

/** Bound entities other than the main one: readings as tiles, controllable ones as expandable rows. */
export function BindingSummary({ item }: { item: Item }) {
  const entities = useHa((s) => s.entities)
  const extras = bindingsOf(item)
    .filter((id) => id !== item.entityId)
    .map((id) => entities[id])
    .filter((e): e is HassEntity => Boolean(e))
  if (!extras.length) return null
  const readings = extras.filter(isReading)
  const actions = extras.filter((e) => !isReading(e))
  return (
    <div className="grid gap-2">
      {readings.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {readings.map((e) => (
            <div key={e.entity_id} className="min-w-0 rounded-xl bg-surface-2 px-3 py-2" title={`${friendlyName(e)} (${e.entity_id})`}>
              <p className="truncate text-[11px] text-ink-3">{roleLabel(e)}</p>
              <p className="truncate font-mono text-[16px] font-semibold tabular-nums">{stateLabel(e)}</p>
            </div>
          ))}
        </div>
      )}
      {actions.map((e) => (
        <ExtraRow key={e.entity_id} e={e} tag={socketLabel(item, e.entity_id) ?? ledTag(item, e.entity_id)} />
      ))}
    </div>
  )
}

/** Short readings for the label: "24.2 °C · 55%". */
export function quickReadings(item: Item, entities: Record<string, HassEntity>) {
  return bindingsOf(item)
    .filter((id) => id !== item.entityId)
    .map((id) => entities[id])
    .filter((e): e is HassEntity => Boolean(e) && domainOf(e!.entity_id) === 'sensor' && ['temperature', 'humidity', 'power', 'battery'].includes(deviceClass(e)))
    .slice(0, 3)
    .map((e) => stateLabel(e))
}

/**
 * Status text of an item (card and label): a plug bound to a stick vacuum reads "Charging" when on and "Not charging" when
 * off; other items show the entity state.
 */
export function itemStateLabel(item: Item, entity: HassEntity) {
  if (item.kind === 'stickVacuum' && domainOf(entity.entity_id) === 'switch' && !isUnavailable(entity)) return isActive(entity) ? t('Charging') : t('Not charging')
  return stateLabel(entity)
}

/**
 * Display name of an item: the name the user gave it; else the main entity's name if that entity is the item itself
 * (climate on an air conditioner, light on a lamp); else the kind's name. A sensor bound to a sofa does not rename the sofa.
 */
export function itemName(item: Item, entity?: HassEntity) {
  if (item.name) return item.name
  if (entity && CATALOG[item.kind].domains.includes(domainOf(entity.entity_id))) return friendlyName(entity)
  return CATALOG[item.kind].label
}
