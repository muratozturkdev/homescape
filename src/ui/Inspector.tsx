import { Check, ChevronDown, ChevronUp, PanelBottomOpen, Compass, Copy, PersonStanding, Power, Fish, Group, History, Lightbulb, Link, Pencil, RotateCcw, RotateCw, Search, SquarePlus, Trash2, TriangleAlert, WandSparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canToggle, toggle, turnOffAll } from '@/ha/actions'
import { friendlyName, isActive, relativeTime, stateLabel } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { bindingsOf, boundAnywhere, emitsLight, isBound, ledOf, ledSource } from '@/model/bindings'
import { BEAM, BODY_COLORS, CATALOG, CONSOLE_LEN, consoleModel, ITEM_PRESETS, OPTIONS, RESIZABLE, RESIZABLE2, sizeOf, TOP_COLORS } from '@/model/catalog'
import { kindFor, modelName, variantFor } from '@/model/generate'
import { doorSides, isOutdoor, isStreetSurface, rectsOf, roomArea, roomAt, wallSnap } from '@/model/geometry'
import { groupFamily, groupMates, heatingSummary } from '@/model/groups'
import { activeHomeId, activeLevel, homesOf, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { maxWidth, PANEL_DEFAULT, usePanel } from './panelState'
import { checkItem, isWallMounted, MOUNTABLE, mountRange, overlapsRoom, SURFACE_Y, surfaceAt } from '@/model/rules'
import { containerOf, INTERIOR, moveWithContents, placeInside, toLocal } from '@/model/containers'
import { counterSink } from '@/model/counter'
import { mountCenter, mountY, setMountY, setWallMount } from './mount'
import type { FloorMaterial, Item, ItemKind, Room, RoomType } from '@/model/types'
import { currentLang, lower, t, tn } from '@/i18n'
import { useView } from '@/scene/camera'
import { BindingEditor, BindingSummary, itemName, itemStateLabel } from './Bindings'
import { EntityControls } from './Controls'
import { removeRoom, removeRoomPart, roomContentsCount } from './removal'
import { rotateRoom } from './rotateRoom'
import { regenerateFromHa } from './regenerate'
import { KIND_ICON } from './kindIcons'
import { fmt, type RoomStats } from './useHome'

const panel = 'glass pointer-events-auto flex max-h-full flex-col overflow-hidden rounded-2xl'
/** Card body: a single column that never scrolls sideways (index.css > .panel-body). */
const body = 'panel-body grid overflow-y-auto px-5 py-4'

/** Segmented choice button (Yes / No, On the wall / On a table...): easy to hit, text that does not fit is truncated. */
const seg = (on: boolean) =>
  `min-h-10 min-w-0 flex-1 truncate rounded-lg px-2 text-[12.5px] font-semibold transition-colors ${on ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface hover:text-ink'}`

/** Translated text with a React node in place of one {placeholder}, wherever the language puts it in the sentence */
function rich(text: string, name: string, node: React.ReactNode) {
  const [before, after = ''] = text.split(`{${name}}`)
  return (
    <>
      {before}
      {node}
      {after}
    </>
  )
}

function Header({ eyebrow, title, Icon, onClose, extra }: { eyebrow: string; title: string; Icon?: React.ComponentType<{ size?: number }>; onClose?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
      {Icon && (
        <div className="icon-tile grid size-11 shrink-0 place-items-center rounded-xl">
          <Icon size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-brand">{eyebrow}</p>
        <h2 className="truncate text-[16px] font-semibold">{title}</h2>
      </div>
      {extra}
      {onClose && (
        <button type="button" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2" title={t('Close')}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

function StatePill({ on, text }: { on: boolean; text: string }) {
  return <span className={`w-fit rounded-lg px-2.5 py-1 text-[12px] font-semibold ${on ? 'bg-ok-50 text-ok' : 'bg-surface-2 text-ink-2'}`}>{text}</span>
}

/** Number of members in the item's group (0 when not grouped). */
const useGroupSize = (item: Item) => useLayout((s) => (item.group ? (activeLevel(s)?.items.filter((i) => i.group === item.group).length ?? 0) : 0))
/** Summary of the heating group ("1 boiler, 3 radiators"); empty when not in a heating group. */
const useHeatingSummary = (item: Item) =>
  useLayout((s) => (item.group && groupFamily(item.kind) === 'heating' ? heatingSummary(activeLevel(s)?.items.filter((i) => i.group === item.group) ?? []) : ''))

/**
 * Item group (Item.group): a light group (lights bound to the same entity) or a heating group (boilers and radiators):
 * member count and the note that bindings change together; "Select group" (multi-selection), "Remove from group" (the
 * bindings stay). To group: in edit mode select an area or click with ⌘ / Ctrl, then use "Group N lights" or "Group N
 * radiators with the boiler" in the bar below.
 */
function GroupInfo({ item }: { item: Item }) {
  const n = useGroupSize(item)
  const heating = useHeatingSummary(item)
  if (n < 2) return null
  const L = useLayout.getState()
  return (
    <div className="grid gap-2 rounded-xl bg-brand-50 p-3">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Group size={15} className="shrink-0 text-brand" />
        {heating ? t('Heating group: {summary}', { summary: heating }) : tn(n, 'Group of {count} light', 'Group of {count} lights')}
      </p>
      <p className="text-[11.5px] leading-relaxed text-ink-2">
        {heating
          ? t('Bindings apply to all devices in the group together; when the boiler heats, the radiators warm up too.')
          : t('Bindings apply to all lights in the group together; they all turn on and off with the same entity.')}
      </p>
      <div className="flex gap-1.5">
        <button type="button" className={seg(false)} onClick={() => L.setMulti({ rooms: [], items: groupMates(activeLevel(L)?.items ?? [], item.id) })}>
          {t('Select group')}
        </button>
        <button
          type="button"
          className={seg(false)}
          onClick={() => {
            L.ungroupItem(item.id)
            useHa.setState({ notice: heating ? t('Device removed from the heating group; its bindings stay.') : t('Light removed from the group; its bindings stay.') })
          }}
        >
          {t('Remove from group')}
        </button>
      </div>
    </div>
  )
}

/* ---------- item: view ---------- */

function ItemView({ item, room }: { item: Item; room?: Room }) {
  const entity = useHa((s) => (item.entityId ? s.entities[item.entityId] : undefined))
  const select = useLayout((s) => s.select)
  const setMode = useLayout((s) => s.setMode)
  const meta = CATALOG[item.kind]
  const title = itemName(item, entity)
  const groupSize = useGroupSize(item)
  const heating = useHeatingSummary(item)

  return (
    <div className={panel}>
      <Header eyebrow={`${meta.label}${room ? ` · ${room.name}` : ''}`} title={title} Icon={KIND_ICON[item.kind]} onClose={() => select(null)} />
      <div className={`${body} gap-4`}>
        {entity && (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <StatePill on={isActive(entity)} text={itemStateLabel(item, entity)} />
              {friendlyName(entity) !== title && <span className="min-w-0 truncate text-[12px] font-medium text-ink-2">{friendlyName(entity)}</span>}
              <span className="shrink-0 text-[12px] text-ink-3">{relativeTime(entity.last_changed)}</span>
            </div>
            <EntityControls e={entity} />
          </>
        )}
        {!entity && item.entityId && (
          <p className="flex gap-2 rounded-xl bg-warn-50 px-3 py-2.5 text-[13px] text-ink-2">
            <TriangleAlert size={16} className="shrink-0 text-warn" />
            <span>{rich(t('{entity} was not found in this Home Assistant. You can bind another entity in edit mode.'), 'entity', <b className="font-mono text-[12px]">{item.entityId}</b>)}</span>
          </p>
        )}
        {(item.kind === 'aquarium' || item.kind === 'fishbowl') && <AquariumFeed item={item} />}
        <BindingSummary item={item} />
        {groupSize > 1 && (
          <p className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <Group size={14} className="text-brand" />
            {heating
              ? t('Part of a heating group ({summary}): heats up with the boiler', { summary: heating })
              : tn(groupSize, 'Part of a group of {count} light: they all turn on together', 'Part of a group of {count} lights: they all turn on together')}
          </p>
        )}
        {entity && <p className="font-mono text-[11px] text-ink-3">{entity.entity_id}</p>}
        {!isBound(item) && (
          <div className="grid gap-3">
            <p className="text-[13px] leading-relaxed text-ink-2">
              {t('No Home Assistant entity is bound to this item yet. You can bind any entity: a light, a plug, a temperature and humidity sensor, a lock...')}
            </p>
            <button
              type="button"
              onClick={() => {
                setMode('edit')
                select({ type: 'item', id: item.id })
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-brand-600"
            >
              <Link size={15} />
              {t('Bind in edit mode')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- item: edit ---------- */

/** Color chips: the selected one gets a brand blue ring. */
function Swatches({ list, value, onPick }: { list: [string, string][]; value?: string; onPick: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {list.map(([name, hex]) => (
        <button
          key={hex}
          type="button"
          title={name}
          aria-label={name}
          onClick={() => onPick(hex)}
          className={`size-7 rounded-full ring-offset-2 ring-offset-[var(--surface-solid)] transition-shadow ${value === hex ? 'ring-2 ring-brand' : 'ring-1 ring-line hover:ring-ink-3'}`}
          style={{ background: hex }}
        />
      ))}
    </div>
  )
}

/** Preset window sizes: standard (1.2 m, sill at 0.9 m) or full height (2.1 m, 8 cm above the floor). Checked against the rules. */
function WindowPresets({ item }: { item: Item }) {
  if (item.kind !== 'window') return null
  const full = ITEM_PRESETS.find((p) => p.id === 'windowFull')!.extra
  const presets: [string, Partial<Item>][] = [
    [t('Standard'), { len2: 1.2, y: undefined }],
    [t('Full height'), { len2: full.len2, y: full.y }],
  ]
  const isOn = (p: Partial<Item>) => (item.len2 ?? 1.2) === p.len2 && (item.y ?? 0) === (p.y ?? 0)
  const apply = (label: string, p: Partial<Item>) => {
    const level = activeLevel(useLayout.getState())
    if (!level) return
    const chk = checkItem(level, { kind: item.kind, x: item.x, z: item.z, rot: item.rot, y: p.y, len: item.len, len2: p.len2, variant: item.variant }, item.id)
    if (!chk.ok) return useHa.setState({ notice: t("{option} won't work: {reason}", { option: label, reason: chk.reason ?? '' }) })
    useLayout.getState().updateItem(item.id, p)
  }
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-semibold text-ink-2">{t('Preset size')}</span>
      <div className="flex gap-1.5">
        {presets.map(([label, p]) => (
          <button key={label} type="button" className={seg(isOn(p))} onClick={() => apply(label, p)}>
            {label}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-ink-3">{t('You can also set the width and height with the sliders below.')}</span>
    </div>
  )
}

/** Height of a wall-mounted item: its center above the floor (m). The slider changes Item.y and is checked against the rules (ui/mount.ts). */
function MountHeight({ item }: { item: Item }) {
  if (!isWallMounted(item.kind, item.variant, item.mount)) return null
  const { min, max } = mountRange(item.kind, item.variant, item.len2)
  const base = mountY(item)
  const mid = mountCenter(item)
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between text-[12px] font-semibold text-ink-2">
        {t('Height on the wall (center)')}
        <span className="font-mono tabular-nums text-ink">{fmt(mid, 2)} m</span>
      </span>
      <input
        id={`mount-${item.id}`}
        type="range"
        min={Math.round((mid + min - base) * 100) / 100}
        max={Math.round((mid + max - base) * 100) / 100}
        step={0.01}
        value={Math.round(mid * 100) / 100}
        onPointerDown={() => useLayout.getState().checkpoint()}
        onChange={(e) => setMountY(item, base + (Number(e.target.value) - mid), false)}
      />
      <span className="text-[11px] text-ink-3">
        {t('Drag the item to move it along the wall, raise it with the arrow next to it. Keyboard: ← → along the wall, ↑ ↓ or Page Up / Page Down for the height (with ⇧ in 25 cm steps).')}
      </span>
    </label>
  )
}

/**
 * Picks the entity that drives the LED feature (TV backlight, headboard, counter LED) separately, so a TV and its backlight
 * can be bound to different entities. The choice is bound as an extra entity; the binding added for the previous LED
 * entity is removed. "Automatic": the bindings.ts > ledSource rule.
 */
function LedEntityPicker({ item, label }: { item: Item; label: string }) {
  const entities = useHa((s) => s.entities)
  const options = useMemo(
    () =>
      Object.values(entities)
        .filter((e) => e.entity_id.startsWith('light.') || e.entity_id.startsWith('switch.'))
        .sort((a, b) => friendlyName(a).localeCompare(friendlyName(b), currentLang())),
    [entities],
  )
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  // The opened list must not stay hidden below the card: scroll it into view
  useEffect(() => {
    if (open) listRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open])
  const auto = ledSource({ ...item, ledEntity: undefined })
  const autoName = auto && entities[auto] ? friendlyName(entities[auto]) : undefined
  const cur = item.ledEntity ? entities[item.ledEntity] : undefined
  const needle = lower(q.trim())
  const shown = needle ? options.filter((e) => lower(`${friendlyName(e)} ${e.entity_id}`).includes(needle)) : options
  const pick = (id: string) => {
    const L = useLayout.getState()
    const prev = item.ledEntity
    let extras = item.extras ?? []
    if (prev && prev !== id && prev !== item.entityId) extras = extras.filter((x) => x !== prev)
    if (id && id !== item.entityId && !extras.includes(id)) extras = [...extras, id]
    L.updateItem(item.id, { extras, ledEntity: id || undefined })
    setOpen(false)
    setQ('')
  }
  /** A list row: large name, small entity id; the dot of a light that is on glows. The selected row is in the brand color. */
  const row = (id: string, title: string, sub: string, on?: boolean) => {
    const sel = (item.ledEntity ?? '') === id
    return (
      <button
        key={id || 'auto'}
        type="button"
        role="option"
        aria-selected={sel}
        data-ledent={id}
        onClick={() => pick(id)}
        className={`flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${sel ? 'bg-brand text-white' : 'text-ink hover:bg-surface'}`}
      >
        <span className={`size-2 shrink-0 rounded-full ${on == null ? 'bg-transparent' : on ? 'bg-sun shadow-[0_0_6px_var(--color-sun)]' : sel ? 'bg-white/50' : 'bg-ink-3/40'}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{title}</span>
          <span className={`block truncate font-mono text-[10.5px] ${sel ? 'text-white/75' : 'text-ink-3'}`}>{sub}</span>
        </span>
        {sel && <Check size={16} className="shrink-0" />}
      </button>
    )
  }
  return (
    <div className="grid gap-1.5" onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      <button
        id={`ledent-${item.id}`}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left transition-colors ${open ? 'border-brand' : 'border-line hover:border-ink-3'}`}
      >
        <span className="icon-tile grid size-8 shrink-0 place-items-center rounded-lg">
          <Lightbulb size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{cur ? friendlyName(cur) : (item.ledEntity ?? t('Automatic'))}</span>
          <span className="block truncate text-[11px] text-ink-3">
            {cur ? cur.entity_id : item.ledEntity ? t('Not found in this Home Assistant') : autoName ? t('Now: {name}', { name: autoName }) : t('The item has no light of its own')}
          </span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={listRef} className="grid gap-1.5 rounded-xl border border-line bg-surface-2 p-1.5">
          {options.length > 6 && (
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 focus-within:border-brand">
              <Search size={15} className="shrink-0 text-ink-3" />
              <input
                id={`ledent-q-${item.id}`}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('Search lights (name or id)')}
                className="min-w-0 flex-1 bg-transparent text-[13px]"
                // The outer box shows the focus ring (focus-within); the global :focus-visible rule is unlayered, an inline style overrides it
                style={{ outline: 'none' }}
              />
            </label>
          )}
          <div role="listbox" aria-label={label} className="grid max-h-64 gap-0.5 overflow-y-auto">
            {!needle && row('', t('Automatic'), autoName ? t('Uses {name}', { name: autoName }) : t("Uses the item's own light"))}
            {shown.map((e) => row(e.entity_id, friendlyName(e), e.entity_id, isActive(e)))}
            {shown.length === 0 && <p className="px-2.5 py-3 text-[12px] text-ink-3">{t('No matching lights or plugs.')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Light intensity (Item.intensity), since every product is differently bright: 10%-300%. The light cast into the room and
 * the visible glow use this factor; the brightness in Home Assistant applies on top. Back at 100% the field is removed (default).
 */
function LightIntensity({ item }: { item: Item }) {
  if (!emitsLight(item)) return null
  const pct = Math.round((item.intensity ?? 1) * 100)
  const { updateItem, checkpoint } = useLayout.getState()
  const set = (p: number, record: boolean) => updateItem(item.id, { intensity: p === 100 ? undefined : p / 100 }, record)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`intensity-${item.id}`} className="text-[12px] font-semibold text-ink-2">
          {t('Light intensity')}
        </label>
        <span className="flex items-center gap-2">
          {pct !== 100 && (
            <button type="button" onClick={() => set(100, true)} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand-50">
              {t('Default')}
            </button>
          )}
          <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">{t('{value}%', { value: pct })}</span>
        </span>
      </div>
      <input id={`intensity-${item.id}`} type="range" min={10} max={300} step={5} value={pct} onPointerDown={() => checkpoint()} onChange={(e) => set(Number(e.target.value), false)} />
      <span className="text-[11px] text-ink-3">{t('Every product is differently bright: match the light in the scene to the real one. The brightness in Home Assistant applies on top.')}</span>
    </div>
  )
}

/**
 * Beam angle of a recessed spot (Item.beam): 20°-150°; a narrow angle lights one spot, a wide one spreads into the room.
 * Back at 90° the field is removed.
 */
function BeamAngle({ item }: { item: Item }) {
  if (item.kind !== 'downlight' || item.variant === 'omni') return null
  const deg = item.beam ?? BEAM.def
  const { updateItem, checkpoint } = useLayout.getState()
  const set = (d: number, record: boolean) => updateItem(item.id, { beam: d === BEAM.def ? undefined : d }, record)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`beam-${item.id}`} className="text-[12px] font-semibold text-ink-2">
          {t('Beam angle')}
        </label>
        <span className="flex items-center gap-2">
          {deg !== BEAM.def && (
            <button type="button" onClick={() => set(BEAM.def, true)} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand hover:bg-brand-50">
              {t('Default')}
            </button>
          )}
          <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">{deg}°</span>
        </span>
      </div>
      <input id={`beam-${item.id}`} type="range" min={BEAM.min} max={BEAM.max} step={5} value={deg} onPointerDown={() => checkpoint()} onChange={(e) => set(Number(e.target.value), false)} />
      <span className="text-[11px] text-ink-3">{t('A narrow angle focuses the light on one spot, a wide angle spreads it into the room.')}</span>
    </div>
  )
}

/** Kinds whose variant changes the footprint (an L counter has two parts, a wall TV sits on another layer). */
const SHAPE_VARIANTS: Item['kind'][] = ['kitchenCounter', 'tv']

/** TV height when its placement changes: on the wall it hangs (none), on its stand it sits on the unit or table below. */
function tvHeight(item: Item, variant: string) {
  const level = activeLevel(useLayout.getState())
  return variant === 'wall' || !level ? undefined : surfaceAt(level.items, item.x, item.z, item.id)?.y
}

/** Settings of items like desks and cabinets: length, drawers, top and body color. */
function FurnitureOptions({ item }: { item: Item }) {
  const opt = OPTIONS[item.kind]
  const range = RESIZABLE[item.kind]
  const range2 = RESIZABLE2[item.kind]
  const { updateItem, checkpoint } = useLayout.getState()
  if (!opt && !range) return null
  const len = item.len ?? CATALOG[item.kind].size[0]
  const len2 = item.len2 ?? range2?.def ?? 0
  const isL = item.variant === 'lLeft' || item.variant === 'lRight'
  /**
   * Settings that change the length, shape or height go through the rules first; if the result does not fit, the reason is
   * shown. Settings that only change the look (curtain type, mirror, oven placement...) skip the rules: they apply even when
   * the item stands somewhere against the rules for some reason.
   */
  const tryPatch = (patch: Partial<Item>, record = true, what?: string) => {
    const level = activeLevel(useLayout.getState())
    if (!level) return
    const shapes = 'len' in patch || 'len2' in patch || 'y' in patch || ('variant' in patch && SHAPE_VARIANTS.includes(item.kind))
    if (!shapes) return updateItem(item.id, patch, record)
    // A wall-mounted power strip snaps to the wall again when it gets longer: at the end of a wall it slides in, never past it
    if (item.mount === 'wall' && 'len' in patch) {
      const w = wallSnap(level.rooms, item.x, item.z, CATALOG[item.kind].size[1], 0.2, sizeOf(item.kind, patch.len)[0], false, true)
      if (w) patch = { ...patch, x: w.x, z: w.z }
    }
    const next = { ...item, ...patch }
    const chk = checkItem(level, { kind: next.kind, x: next.x, z: next.z, rot: next.rot, y: next.y, len: next.len, len2: next.len2, variant: next.variant, mount: next.mount, swing: next.swing }, item.id)
    if (!chk.ok) return useHa.setState({ notice: what ? t("{option} doesn't fit: {reason}", { option: what, reason: chk.reason ?? '' }) : t("This setting doesn't fit: {reason}", { reason: chk.reason ?? '' }) })
    updateItem(item.id, patch, record)
  }
  const clampTo = (r: { min: number; max: number }, v: number) => Math.round(Math.min(r.max, Math.max(r.min, v)) * 100) / 100
  const tryLen = (v: number, record: boolean) => {
    if (!range) return
    const n = clampTo(range, v)
    tryPatch({ len: n }, record, `${fmt(n, 1)} m`)
  }
  return (
    <div className="grid gap-3">
      {range && (
        <label className="grid gap-1.5">
          <span className="flex justify-between text-[12px] font-semibold text-ink-2">
            {range.label ?? t('Length')}
            <span className="font-mono tabular-nums text-ink">{fmt(len, 2)} m</span>
          </span>
          <input
            id={`len-${item.id}`}
            type="range"
            min={range.min}
            max={range.max}
            step={0.05}
            value={len}
            onPointerDown={() => checkpoint()}
            onChange={(e) => tryLen(Number(e.target.value), false)}
          />
        </label>
      )}
      {item.kind === 'console' &&
        (() => {
          // Model and orientation together form Item.variant; the footprint length (Item.len) follows it (checked against the rules)
          const { brand, pose } = consoleModel(item.variant)
          const set = (b: string, ps: string, label: string) => tryPatch({ variant: `${b}-${ps}`, len: CONSOLE_LEN[`${b}-${ps}`] }, true, label)
          return (
            <>
              <div className="grid gap-1.5">
                <span className="text-[12px] font-semibold text-ink-2">{t('Model')}</span>
                <div className="flex gap-1.5">
                  <button type="button" className={seg(brand === 'ps5')} onClick={() => set('ps5', pose, 'PlayStation')}>
                    PlayStation
                  </button>
                  <button type="button" className={seg(brand === 'xbox')} onClick={() => set('xbox', pose, 'Xbox')}>
                    Xbox
                  </button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <span className="text-[12px] font-semibold text-ink-2">{t('Orientation')}</span>
                <div className="flex gap-1.5">
                  <button type="button" className={seg(pose === 'v')} onClick={() => set(brand, 'v', t('Vertical'))}>
                    {t('Vertical')}
                  </button>
                  <button type="button" className={seg(pose === 'h')} onClick={() => set(brand, 'h', t('Horizontal'))}>
                    {t('Horizontal')}
                  </button>
                </div>
              </div>
            </>
          )
        })()}
      {MOUNTABLE.includes(item.kind) && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Placement')}</span>
          <div className="flex gap-1.5">
            <button type="button" className={seg(item.mount !== 'wall')} onClick={() => setWallMount(item, false)}>
              {t('Floor or table')}
            </button>
            <button type="button" className={seg(item.mount === 'wall')} onClick={() => setWallMount(item, true)}>
              {t('On the wall')}
            </button>
          </div>
        </div>
      )}
      {opt?.variants && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{opt.variantLabel ?? t('Type')}</span>
          {/* Five or more options (rug shape, curtain) in rows of three so the labels are not cut off */}
          <div className={opt.variants.length > 4 ? 'grid grid-cols-3 gap-1.5' : 'flex gap-1.5'}>
            {opt.variants.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={seg((item.variant ?? opt.variantDef ?? opt.variants![0][0]) === k)}
                onClick={() => tryPatch({ variant: k, ...(opt.variantLen ? { len: opt.variantLen[k] } : {}), ...(item.kind === 'tv' ? { y: tvHeight(item, k) } : {}) }, true, label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {range2 && (!range2.onlyL || isL) && (
        <label className="grid gap-1.5">
          <span className="flex justify-between text-[12px] font-semibold text-ink-2">
            {range2.label}
            <span className="font-mono tabular-nums text-ink">{fmt(len2, 2)} m</span>
          </span>
          <input
            id={`len2-${item.id}`}
            type="range"
            min={range2.min}
            max={range2.max}
            step={0.05}
            value={len2}
            onPointerDown={() => checkpoint()}
            onChange={(e) => {
              const n = clampTo(range2, Number(e.target.value))
              tryPatch({ len2: n }, false, `${fmt(n, 1)} m`)
            }}
          />
        </label>
      )}
      {opt?.led && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{opt.ledLabel ?? 'LED'}</span>
          <div className="flex gap-1.5">
            {opt.led.map(([k, label]) => (
              <button key={k} type="button" className={seg(ledOf(item) === k)} onClick={() => updateItem(item.id, { led: k })}>
                {label}
              </button>
            ))}
          </div>
          {opt.ledEntityLabel && ledOf(item) !== 'none' && <LedEntityPicker item={item} label={opt.ledEntityLabel} />}
          {opt.ledHint && <span className="text-[11px] text-ink-3">{opt.ledHint}</span>}
        </div>
      )}
      {opt?.drawers && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Drawers')}</span>
          <div className="flex gap-1.5">
            {(
              [
                ['none', t('None')],
                ['left', t('On the left')],
                ['right', t('On the right')],
                ['both', t('Both sides')],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={seg((item.drawers ?? 'none') === k)} onClick={() => updateItem(item.id, { drawers: k })}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ink-3">{t('Left and right as seen by the person sitting at the desk.')}</span>
        </div>
      )}
      {item.kind === 'kitchenCounter' &&
        (() => {
          // Built-in sink (model/counter.ts): when not chosen, in the center unless a separate sink stands next to the counter
          const lv = activeLevel(useLayout.getState())
          const at = lv ? counterSink(lv.items, item) : null
          const L = item.len ?? CATALOG.kitchenCounter.size[0]
          const cur = item.sink ?? (at == null ? 'none' : 'center')
          return (
            <div className="grid gap-1.5" id="counter-sink">
              <span className="text-[12px] font-semibold text-ink-2">{t('Sink')}</span>
              <div className="flex gap-1.5">
                {(
                  [
                    ['none', t('None')],
                    ['left', t('On the left')],
                    ['center', t('Center')],
                    ['right', t('On the right')],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} type="button" data-sink={k} disabled={k !== 'none' && L < 0.9} className={seg(cur === k)} onClick={() => updateItem(item.id, { sink: k })}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-ink-3">
                {L < 0.9
                  ? t('A sink needs a counter of at least {length} m.', { length: 0.9 })
                  : t('The steel basin and tap are built into the counter; left and right as seen standing in front of it.')}
              </span>
            </div>
          )
        })()}
      {opt?.shape && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Shape')}</span>
          <div className="flex gap-1.5">
            {(
              [
                ['square', t('Square')],
                ['round', t('Round')],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={seg((item.shape ?? 'square') === k)} onClick={() => updateItem(item.id, { shape: k })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {opt?.corner && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Corner')}</span>
          <div className="flex gap-1.5">
            {(
              [
                ['left', t('Left wall')],
                ['right', t('Right wall')],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={seg((item.hinge ?? 'left') === k)} onClick={() => updateItem(item.id, { hinge: k })}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ink-3">{t('Stands against the back wall and the side wall you pick; it snaps into the corner when you bring it close.')}</span>
        </div>
      )}
      {opt?.top && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{opt.top}</span>
          <Swatches list={opt.topList ?? TOP_COLORS} value={item.top ?? opt.topDef ?? '#ffffff'} onPick={(hex) => updateItem(item.id, { top: hex })} />
        </div>
      )}
      {opt?.body && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{opt.body}</span>
          <Swatches list={opt.bodyList ?? BODY_COLORS} value={item.body ?? opt.bodyDef} onPick={(hex) => updateItem(item.id, { body: hex })} />
        </div>
      )}
      {opt?.note && <p className="text-[11px] leading-relaxed text-ink-3">{opt.note}</p>}
    </div>
  )
}

/** Recognizes a bound automatic feeder by its name or id (feed / yem / besle and the word in other languages) */
const FEEDER = /feed|yem|besle|futter|voer|karm|aliment|comida|nourri|mangiat|корм|餌|먹이|喂|饲|खिला/i

/** Aquarium: feed the fish (they come up to the surface). Also runs a bound automatic feeder if there is one. */
function AquariumFeed({ item }: { item: Item }) {
  const entities = useHa((s) => s.entities)
  const feeder = bindingsOf(item)
    .map((id) => entities[id])
    .find((e) => e && ['button', 'input_button', 'script', 'switch'].includes(e.entity_id.split('.')[0]) && FEEDER.test(`${friendlyName(e)} ${e.entity_id}`))
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="grid gap-2 rounded-xl bg-surface-2 p-3">
      <button
        type="button"
        onClick={() => {
          useLayout.getState().updateItem(item.id, { fedAt: new Date().toISOString() }, false)
          if (feeder) void toggle(feeder)
          useHa.setState({ notice: feeder ? t('{name} started, the fish are being fed.', { name: friendlyName(feeder) }) : t('The fish are being fed.') })
        }}
        className="flex items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-[13px] font-semibold text-white hover:bg-brand-600"
      >
        <Fish size={16} />
        {t('Feed')}
      </button>
      <p className="text-[11.5px] text-ink-3">
        {item.fedAt ? t('Last fed: {time}', { time: relativeTime(item.fedAt) }) : t('Not fed yet.')}
        {feeder ? ` · ${t('Feeder: {name}', { name: friendlyName(feeder) })}` : ` · ${t('Bind an automatic feeder (button, script or plug) and it runs too.')}`}
      </p>
    </div>
  )
}

/** Opening direction of a door or window: hinge side and the side it opens to (room names on an inner door). */
function OpeningEdit({ item }: { item: Item }) {
  const rooms = useLayout((s) => activeLevel(s)?.rooms)
  const { updateItem } = useLayout.getState()
  const { front, back } = doorSides(item, rooms ?? [])
  const door = item.kind === 'door'
  const hinge = item.hinge ?? 'left'
  const swing = item.swing ?? 'in'
  const inLabel = door && back ? (front?.name ?? t('This room')) : t('Inward')
  const outLabel = door && back ? back.name : t('Outward')
  const inTitle = door && back ? (front ? t('Opens into {room}', { room: front.name }) : t('Opens into this room')) : t('Opens into the room')
  return (
    <div className="grid gap-2">
      <span className="text-[12px] font-semibold text-ink-2">{t('Opening direction')}</span>
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <span className="text-[11px] text-ink-3">{t('Hinge')}</span>
        <div className="flex min-w-0 gap-1.5">
          <button type="button" className={seg(hinge === 'left')} onClick={() => updateItem(item.id, { hinge: 'left' })}>
            {t('Left')}
          </button>
          <button type="button" className={seg(hinge === 'right')} onClick={() => updateItem(item.id, { hinge: 'right' })}>
            {t('Right')}
          </button>
        </div>
        <span className="text-[11px] text-ink-3">{t('Opens')}</span>
        <div className="flex min-w-0 gap-1.5">
          <button type="button" className={seg(swing === 'in')} onClick={() => updateItem(item.id, { swing: 'in' })} title={inTitle}>
            {inLabel}
          </button>
          <button type="button" className={seg(swing === 'out')} onClick={() => updateItem(item.id, { swing: 'out' })} title={door && back ? t('Opens into {room}', { room: outLabel }) : t('Opens outward')}>
            {outLabel}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-ink-3">
        {door
          ? t('Hinge side as seen from inside the room, facing the door. The direction shows as a blue arc in the scene; you can also flip it from the bubble above.')
          : t('Hinge side as seen from inside the room, facing the window. The direction shows as a blue arc in the scene; you can also flip it from the bubble above.')}
      </p>
    </div>
  )
}

/**
 * Boiler or radiator: turns the item into a wall-hung boiler (or back into a radiator); its bindings and group stay, and it
 * snaps to the nearest wall with its new size. If it does not fit, the reason is shown.
 */
const HEAT_KINDS: [ItemKind, string][] = [
  ['boiler', t('Boiler')],
  ['radiator', t('Radiator')],
]
function HeatingKind({ item }: { item: Item }) {
  if (!HEAT_KINDS.some(([k]) => k === item.kind)) return null
  const swap = (kind: ItemKind) => {
    const level = activeLevel(useLayout.getState())
    if (!level || kind === item.kind) return
    const [w, d] = CATALOG[kind].size
    const at = wallSnap(level.rooms, item.x, item.z, d, 0.6, w, false, true)
    const patch: Partial<Item> = { kind, ...(at ? { x: at.x, z: at.z, rot: at.rot } : {}), y: undefined, len: undefined, variant: undefined }
    const next = { ...item, ...patch }
    const chk = checkItem(level, { kind, x: next.x, z: next.z, rot: next.rot }, item.id)
    if (!chk.ok) return useHa.setState({ notice: t("{item} doesn't fit here: {reason}", { item: CATALOG[kind].label, reason: chk.reason ?? '' }) })
    useLayout.getState().updateItem(item.id, patch)
  }
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-semibold text-ink-2">{t('Type')}</span>
      <div className="flex gap-1.5">
        {HEAT_KINDS.map(([k, label]) => (
          <button key={k} type="button" data-heat-kind={k} className={seg(item.kind === k)} onClick={() => swap(k)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Inside or on top of a cabinet (a TV unit, anything that opens): when the item stands on or inside furniture with doors,
 * drawers or shelves, "On top" and its compartments (lower compartment, shelf, drawer...) can be picked; the item drops to
 * the base of the chosen compartment and is centered. A wall-mounted item (boiler) stays on the wall behind the cabinet:
 * placing the cabinet in front of it is enough.
 */
function Placement({ item }: { item: Item }) {
  const level = useLayout((s) => activeLevel(s))
  if (!level || INTERIOR[item.kind] || isWallMounted(item.kind, item.variant, item.mount)) return null
  const box = level.items.find((c) => {
    if (c.id === item.id || !INTERIOR[c.kind]) return false
    const { lx, lz } = toLocal(c, item.x, item.z)
    const [w, d] = sizeOf(c.kind, c.len)
    return Math.abs(lx) < w / 2 && Math.abs(lz) < d / 2
  })
  if (!box) return null
  const comps = INTERIOR[box.kind]!
  const cur = containerOf(level.items, item)
  const topY = SURFACE_Y[box.kind]
  const onTop = !cur && topY != null && Math.abs((item.y ?? 0) - topY - (box.y ?? 0)) < 0.03
  const put = (i: number) => {
    const r = placeInside(box, i, item)
    if ('reason' in r) return useHa.setState({ notice: r.reason })
    useLayout.getState().updateItem(item.id, r.patch)
  }
  return (
    <div className="grid gap-1.5" id="item-placement">
      <span className="text-[12px] font-semibold text-ink-2">{t('{item}: where to put it', { item: CATALOG[box.kind].label })}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {topY != null && (
          <button type="button" className={seg(onTop)} onClick={() => useLayout.getState().updateItem(item.id, { y: (box.y ?? 0) + topY })}>
            {t('On top')}
          </button>
        )}
        {comps.map((c, i) => (
          <button key={c.label} type="button" data-compartment={i} className={seg(cur?.box.id === box.id && cur.index === i)} onClick={() => put(i)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ItemEdit({ item, room }: { item: Item; room?: Room }) {
  const { updateItem, deleteItem, duplicateItem, select } = useLayout.getState()
  const entity = useHa((s) => (item.entityId ? s.entities[item.entityId] : undefined))
  const meta = CATALOG[item.kind]
  // The contents of a cabinet rotate with it (model/containers.ts)
  const rotate = (deg: number) => {
    const lv = activeLevel(useLayout.getState())
    const moves = lv ? moveWithContents(lv.items, item.id, { rot: item.rot + (deg * Math.PI) / 180 }) : []
    moves.forEach((m, i) => updateItem(m.id, m.patch, i === 0))
  }

  return (
    <div className={panel}>
      <Header eyebrow={`${t('Edit')} · ${meta.label}${room ? ` · ${room.name}` : ''}`} title={itemName(item, entity)} Icon={KIND_ICON[item.kind]} onClose={() => select(null)} />
      <div className={`${body} gap-4`}>
        <label className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Name')}</span>
          <input
            id={`name-${item.id}`}
            value={item.name ?? ''}
            placeholder={itemName({ ...item, name: undefined }, entity)}
            onChange={(e) => updateItem(item.id, { name: e.target.value || undefined }, false)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
          />
        </label>

        {(item.kind === 'door' || item.kind === 'window') && <OpeningEdit item={item} />}
        <HeatingKind item={item} />
        <Placement item={item} />
        <WindowPresets item={item} />
        <MountHeight item={item} />
        <FurnitureOptions item={item} />
        <LightIntensity item={item} />
        <BeamAngle item={item} />

        <GroupInfo item={item} />
        <BindingEditor key={item.id} item={item} room={room} />

        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Rotate')}</span>
          <div className="flex gap-2">
            {[-90, -15, 15, 90].map((d) => (
              <button key={d} type="button" onClick={() => rotate(d)} className="flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-surface-2 text-[12.5px] font-semibold text-ink-2 hover:bg-surface hover:text-ink">
                {d < 0 ? <RotateCcw size={13} /> : <RotateCw size={13} />}
                {Math.abs(d)}°
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-3">{t('Tip: drag the item to move it; wall items snap to the nearest wall. The R key rotates by 90°.')}</p>
        </div>
      </div>
      <div className="flex gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={() => duplicateItem(item.id)} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-2 text-[13px] font-semibold text-ink-2 hover:bg-surface-2">
          <Copy size={15} />
          {t('Duplicate')}
        </button>
        <button type="button" onClick={() => deleteItem(item.id)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-miss-50 py-2 text-[13px] font-semibold text-miss hover:brightness-95">
          <Trash2 size={15} />
          {t('Delete')}
        </button>
      </div>
    </div>
  )
}

/* ---------- room ---------- */

const FLOORS: [FloorMaterial, string][] = [
  ['wood', t('Wood')],
  ['tile', t('Tile')],
  ['carpet', t('Carpet')],
  ['concrete', t('Concrete')],
  ['paving', t('Stone')],
  ['deck', t('Deck')],
  ['grass', t('Grass')],
  // Front of the house and the street: road and parking lines run along the long side of the area
  ['road', t('Road')],
  ['sidewalk', t('Sidewalk')],
  ['crosswalk', t('Crosswalk')],
  ['parking', t('Parking')],
  ['gravel', t('Gravel')],
  ['water', t('Water')],
]

/** Room types: outdoor areas have no walls; balconies and terraces get a railing on their open edges. Each type brings its floor. */
const FLOORS_DEFAULT: FloorMaterial[] = ['wood', 'concrete', 'deck', 'paving', 'grass']
const ROOM_TYPES: [RoomType, string, FloorMaterial][] = [
  ['room', t('Room'), 'wood'],
  ['garage', t('Garage'), 'concrete'],
  ['balcony', t('Balcony'), 'deck'],
  ['terrace', t('Terrace'), 'paving'],
  ['garden', t('Garden'), 'grass'],
]

function RoomView({ room, stats }: { room: Room; stats?: RoomStats }) {
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  const select = useLayout((s) => s.select)
  const items = (level?.items ?? []).filter((it) => bindingsOf(it).some((id) => entities[id]) && roomAt([room], it.x, it.z))
  return (
    <div className={panel}>
      <Header eyebrow={t('Room')} title={room.name} onClose={() => select(null)} />
      <div className={`${body} gap-4`}>
        <div className="grid grid-cols-3 gap-2">
          {[
            [t('Temperature'), stats?.temp != null ? `${fmt(stats.temp)}°` : '-'],
            [t('Humidity'), stats?.humidity != null ? t('{value}%', { value: fmt(stats.humidity, 0) }) : '-'],
            [t('Lights'), stats ? `${stats.lightsOn}/${stats.lights}` : '-'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
              <p className="text-[11px] text-ink-3">{k}</p>
              <p className="font-mono text-[16px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        {stats && stats.lightsOn > 0 && (
          <button type="button" onClick={() => turnOffAll(stats.lightEntities)} className="rounded-xl bg-sun-50 py-2 text-[13px] font-semibold text-ink ring-1 ring-sun/40">
            {t('Turn off all lights in the room')}
          </button>
        )}
        {/* The first-person walk starts in this room (FpsControls starts from the selected room) */}
        <button type="button" id="room-walk" onClick={() => useView.getState().setFps(true)} className="flex items-center justify-center gap-2 rounded-xl bg-surface-2 py-2 text-[13px] font-semibold text-ink-2 hover:text-brand">
          <PersonStanding size={15} />
          {t('Walk this room (first person)')}
        </button>
        <div className="grid gap-1">
          {items.length === 0 && <p className="text-[13px] text-ink-3">{t('No bound devices in this room.')}</p>}
          {items.map((it) => {
            const e = entities[bindingsOf(it).find((id) => entities[id])!]
            const Icon = KIND_ICON[it.kind]
            // On / off right in the row
            const tog = canToggle(e) ? e : bindingsOf(it).map((id) => entities[id]).find((x) => x && canToggle(x))
            return (
              <div key={it.id} className="flex items-center gap-1 rounded-xl hover:bg-surface-2">
                <button type="button" onClick={() => select({ type: 'item', id: it.id })} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${isActive(e) ? 'bg-sun-50 text-sun' : 'bg-surface-2 text-ink-3'}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{itemName(it, it.entityId ? entities[it.entityId] : undefined)}</span>
                  <span className="shrink-0 text-[12px] text-ink-2">{stateLabel(e)}</span>
                </button>
                {tog && (
                  <button type="button" aria-label={t('Turn on or off')} onClick={() => void toggle(tog)} className={`mr-1.5 grid size-8 shrink-0 place-items-center rounded-full ${isActive(tog) ? 'bg-sun text-white' : 'bg-surface-2 text-ink-2 hover:text-brand'}`}>
                    <Power size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Deletes a room with everything in it: items, devices, doors. The first click says what will be deleted and asks for
 * confirmation; a second click within 4 s deletes. ⌘Z brings it back. Keyboard: Delete while the room is selected.
 */
function DeleteRoomButton({ room }: { room: Room }) {
  const [armed, setArmed] = useState(false)
  const n = useLayout((s) => (s.layout ? roomContentsCount(room.id) : 0))
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])
  return (
    <button
      type="button"
      onClick={() => (armed ? removeRoom(room.id) : setArmed(true))}
      className={`flex w-full flex-col items-center justify-center rounded-xl py-2 font-semibold transition-colors ${armed ? 'bg-miss text-white' : 'bg-miss-50 text-miss'}`}
    >
      <span className="flex items-center gap-2 text-[13px]">
        <Trash2 size={15} />
        {armed ? t('Are you sure? Click again') : t('Delete the room with everything in it')}
      </span>
      <span className={`text-[11px] font-medium ${armed ? 'text-white/85' : 'text-miss/80'}`}>
        {n ? tn(n, 'The {count} item or door in it is deleted too · ⌘Z undoes', 'The {count} items and doors in it are deleted too · ⌘Z undoes') : t('The room is empty · ⌘Z undoes')}
      </span>
    </button>
  )
}

/** Extra parts of a room (L, T, U shape): their sizes, deleting them and drawing a new part. */
function RoomParts({ room }: { room: Room }) {
  const { setTool } = useLayout.getState()
  const tool = useLayout((s) => s.tool)
  const parts = room.parts ?? []
  const setSize = (i: number, k: 'w' | 'd', v: number) => {
    if (!(v >= 0.5)) return
    const rooms = activeLevel(useLayout.getState())?.rooms ?? []
    const next = { ...room, parts: parts.map((p, j) => (j === i ? { ...p, [k]: v } : p)) }
    if (overlapsRoom(rectsOf(next), rooms, room.id)) return useHa.setState({ notice: t('Rooms cannot overlap; this runs into the neighboring room.') })
    const p = parts[i]
    useLayout.getState().resizeEdge(room.id, i, k === 'w' ? 'right' : 'front', k === 'w' ? p.x + v : p.z + v)
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink-2">{t('Shape')}</span>
        <span className="font-mono text-[11px] text-ink-3">{fmt(roomArea(room), 1)} m²</span>
      </div>
      {parts.map((p, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] items-end gap-2">
          {(['w', 'd'] as const).map((k) => (
            <label key={k} className="grid min-w-0 gap-1">
              <span className="text-[11px] text-ink-3">
                {k === 'w' ? t('Part {number} · width', { number: i + 2 }) : t('Part {number} · depth', { number: i + 2 })}
              </span>
              <input
                id={`part-${room.id}-${i}-${k}`}
                type="number"
                step={0.25}
                min={0.5}
                value={p[k]}
                onChange={(e) => setSize(i, k, Number(e.target.value))}
                className="w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[13px] tabular-nums"
              />
            </label>
          ))}
          <button type="button" onClick={() => removeRoomPart(room.id, i)} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-miss-50 hover:text-miss" title={t('Delete the part with everything in it')}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setTool(tool === 'part' ? 'select' : 'part')}
        className={`flex items-center justify-center gap-2 rounded-xl border py-2 text-[12.5px] font-semibold ${tool === 'part' ? 'border-brand bg-brand-50 text-brand' : 'border-line text-ink-2 hover:border-brand hover:text-brand'}`}
      >
        <SquarePlus size={15} />
        {tool === 'part' ? t('Drag on the floor to draw… (Esc: cancel)') : t('Add a part (L, T, U shape)')}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-3">{t('Start at the edge of the room and drag outward: the new part joins the room, with no wall where they meet. For an L-shaped hallway one arm is enough.')}</p>
    </div>
  )
}

function RoomEdit({ room }: { room: Room }) {
  const { updateRoom, select } = useLayout.getState()
  const areas = useHa((s) => s.registry?.areas ?? [])
  return (
    <div className={panel}>
      <Header eyebrow={`${t('Edit')} · ${t('Room')}`} title={room.name} onClose={() => select(null)} />
      <div className={`${body} gap-4`}>
        <label className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Name')}</span>
          <input id={`room-${room.id}`} value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value }, false)} className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand" />
        </label>
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Type')}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {ROOM_TYPES.map(([type, label, floor]) => (
              <button
                key={type}
                type="button"
                data-room-type={type}
                // In a room with a default floor, a new type brings its own floor too (grass for a garden, deck for a balcony...)
                onClick={() => updateRoom(room.id, { type, ...(FLOORS_DEFAULT.includes(room.floor) ? { floor } : {}) })}
                className={seg((room.type ?? 'room') === type)}
              >
                {label}
              </button>
            ))}
          </div>
          {isOutdoor(room) && (
            <span className="text-[11px] text-ink-3">
              {room.type === 'garden'
                ? t('Outdoor area: no walls. Items like wall lights and awnings can hang on the outside of the house wall.')
                : t('Outdoor area: no walls, a railing on the edges facing open space. Items like wall lights and awnings can hang on the outside of the house wall.')}
            </span>
          )}
        </div>
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Flooring')}</span>
          <div className="grid grid-cols-4 gap-1.5">
            {FLOORS.map(([f, label]) => (
              <button key={f} type="button" onClick={() => updateRoom(room.id, { floor: f })} className={seg(room.floor === f)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Home Assistant area')}</span>
          <select id={`area-${room.id}`} value={room.areaId ?? ''} onChange={(e) => updateRoom(room.id, { areaId: e.target.value || null })} className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px]">
            <option value="">{t('Not linked')}</option>
            {areas.map((a) => (
              <option key={a.area_id} value={a.area_id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-ink-3">{t("The room's temperature and humidity come from the sensors in this area.")}</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['w', t('Width')],
              ['d', t('Depth')],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="grid min-w-0 gap-1">
              <span className="text-[11px] text-ink-3">{room.parts?.length ? (k === 'w' ? t('Main part · width') : t('Main part · depth')) : label} (m)</span>
              <input
                id={`${k}-${room.id}`}
                type="number"
                step={0.25}
                min={1}
                value={room[k]}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v < 1) return
                  const rooms = activeLevel(useLayout.getState())?.rooms ?? []
                  if (overlapsRoom({ ...room, [k]: v }, rooms, room.id)) {
                    useHa.setState({ notice: t('Rooms cannot overlap; this runs into the neighboring room.') })
                    return
                  }
                  // Width moves the right wall, depth the front wall; the items on that wall come along
                  useLayout.getState().resizeEdge(room.id, -1, k === 'w' ? 'right' : 'front', k === 'w' ? room.x + v : room.z + v)
                }}
                className="w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[13px] tabular-nums"
              />
            </label>
          ))}
        </div>
        <RoomParts room={room} />
        <div className="flex gap-1.5">
          {([-1, 1] as const).map((d) => (
            <button
              key={d}
              type="button"
              id={d > 0 ? 'room-rotate' : 'room-rotate-back'}
              onClick={() => rotateRoom(room.id, d)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink-2 hover:text-ink"
              title={d > 0 ? t('Rotate the room 90° clockwise (R)') : t('Rotate the room 90° counterclockwise (⇧R)')}
            >
              {d < 0 ? <RotateCcw size={14} /> : <RotateCw size={14} />}
              {d > 0 ? t('Rotate') : t('Rotate back')}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3">{t('Tip: drag the floor of the room to move it (the items inside come along), resize it with the blue handles on the edges, rotate it by 90° with R.')}</p>
      </div>
      <div className="border-t border-line px-5 py-3">
        <DeleteRoomButton room={room} />
      </div>
    </div>
  )
}

/* ---------- no selection ---------- */

/** Compass bearing of the top of the plan (Layout.up), so the sun comes in through the right windows on the walk (scene/sun.ts). */
const BEARINGS: [number, string][] = [
  [0, t('North')],
  [45, t('Northeast')],
  [90, t('East')],
  [135, t('Southeast')],
  [180, t('South')],
  [225, t('Southwest')],
  [270, t('West')],
  [315, t('Northwest')],
]

function BearingPicker() {
  const up = useLayout((s) => s.layout?.up ?? 0)
  const setBearing = useLayout((s) => s.setBearing)
  const options = BEARINGS.some(([d]) => d === up) ? BEARINGS : [...BEARINGS, [up, `${up}°`] as [number, string]]
  return (
    <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]" title={t('Sets which side of the house the sun shines on: on the walk the sunlight comes in through the right windows')}>
      <Compass size={15} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-ink-2">{t('Top of the plan (direction)')}</span>
      <select id="plan-bearing" value={up} onChange={(e) => setBearing(Number(e.target.value))} className="cursor-pointer bg-transparent text-right font-semibold outline-none">
        {options.map(([d, name]) => (
          <option key={d} value={d}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Overview({ stats }: { stats: Record<string, RoomStats> }) {
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  const source = useHa((s) => s.source)
  const select = useLayout((s) => s.select)
  const request = useView((s) => s.request)
  const bound = (level?.items ?? []).flatMap(bindingsOf)
  const missing = bound.filter((id) => !entities[id]).length
  const mismatch = bound.length > 0 && Object.keys(entities).length > 0 && missing / bound.length > 0.5
  // Collapsible: when collapsed only the header shows; the choice is remembered
  const [small, setSmall] = useState(() => {
    try {
      return localStorage.getItem('homescape-overview-small') === '1'
    } catch {
      return false
    }
  })
  const toggleSmall = () => {
    setSmall(!small)
    try {
      localStorage.setItem('homescape-overview-small', small ? '0' : '1')
    } catch {
      /* storage unavailable */
    }
  }
  const home = useLayout((s) => homesOf(s).find((h) => h.id === activeHomeId(s))?.name ?? t('My home'))

  return (
    <div className={panel}>
      <Header
        eyebrow={source?.kind === 'live' ? t('Live') : t('Demo')}
        title={home}
        extra={
          <button type="button" id="overview-toggle" onClick={toggleSmall} className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2" title={small ? t('Show rooms') : t('Collapse')} aria-expanded={!small}>
            {small ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        }
      />
      {!small && <div className={`${body} gap-3`}>
        {mismatch && (
          <div className="grid gap-2 rounded-xl bg-warn-50 p-3 text-[13px] text-ink-2">
            <p className="flex gap-2">
              <TriangleAlert size={16} className="shrink-0 text-warn" />
              {t('Most devices in this plan are not in the connected Home Assistant.')}
            </p>
            <button type="button" onClick={regenerateFromHa} className="rounded-lg bg-brand py-2 text-[12px] font-semibold text-white">
              {t('Build the plan from this Home Assistant')}
            </button>
          </div>
        )}
        {(level?.rooms.length ?? 0) === 0 && (
          <div className="grid gap-2 rounded-xl bg-surface-2 p-3">
            <p className="text-[13px] text-ink-2">{t('The plan is empty. Switch to edit mode, draw the rooms and place the devices.')}</p>
            <button type="button" onClick={() => useLayout.getState().setMode('edit')} className="flex items-center justify-center gap-2 rounded-lg bg-brand py-2 text-[12.5px] font-semibold text-white hover:bg-brand-600">
              <Pencil size={14} />
              {t('Draw your home')}
            </button>
          </div>
        )}
        {(level?.rooms ?? [])
          .filter((r) => !isStreetSurface(r))
          .map((r) => {
          const s = stats[r.id]
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                select({ type: 'room', id: r.id })
                request({ kind: 'room', id: r.id })
              }}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:border-brand"
            >
              <span className={`size-2.5 rounded-full ${s?.lightsOn ? 'bg-sun' : 'bg-line'}`} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.name}</span>
              <span className="font-mono text-[12px] tabular-nums text-ink-2">{s?.temp != null ? `${fmt(s.temp)}°` : ''}</span>
              <span className="text-[12px] text-ink-3">{s?.lights ? tn(s.lights, '{on}/{count} light', '{on}/{count} lights', { on: s.lightsOn }) : ''}</span>
            </button>
          )
        })}
        {(level?.rooms.length ?? 0) > 0 && <BearingPicker />}
        <p className="text-[12px] leading-relaxed text-ink-3">
          {t('Hover over an item: its button turns it on or off, a click shows the details. Click the door of a cabinet or drawer to open it, click again to close it. Dashboard at the top for all controls, Edit to shape the home.')}
        </p>
      </div>}
    </div>
  )
}

/**
 * Devices in HA that could go in the plan but are bound to no item (recomputed on every change). All floors of the home
 * are checked, so a device bound to an item upstairs does not show as unbound while the ground floor is open.
 */
function useUnboundDevices() {
  const levels = useLayout((s) => s.layout?.levels)
  const entities = useHa((s) => s.entities)
  const registry = useHa((s) => s.registry)
  return useMemo(() => {
    const skipped = new Set(registry?.skip ?? [])
    const areaName = new Map((registry?.areas ?? []).map((a) => [a.area_id, a.name]))
    const items = (levels ?? []).flatMap((l) => l.items)
    return Object.values(entities)
      .filter((e) => !skipped.has(e.entity_id) && !boundAnywhere(items, e.entity_id))
      .flatMap((e) => {
        const model = registry?.entityModel?.[e.entity_id] ?? ''
        const kind = kindFor(e, model)
        if (!kind) return []
        // The model of the kind (HomePod mini) and a card name carrying the room's name are written to the item on placement
        const variant = variantFor(kind, e, model)
        const name = modelName(kind, friendlyName(e), areaName.get(registry?.entityArea[e.entity_id] ?? ''), variant)
        return [{ e, kind, extra: variant || name ? { variant, name } : undefined }]
      })
      .sort((a, b) => friendlyName(a.e).localeCompare(friendlyName(b.e), currentLang()))
  }, [entities, levels, registry])
}

const STEPS: Record<'empty' | 'edit', [string, string][]> = {
  empty: [
    [t('Rooms'), t('Drag a ready-made room from the Rooms tab below into the scene, or draw one on the floor with Draw freely.')],
    [t('Side by side'), t('Move rooms close to each other; the edges snap and never overlap. Select a room to resize it with the handles and give it a name and a Home Assistant area.')],
    [t('Doors'), t('Drag doors and windows from their tab onto a wall, or complete the inner doors automatically with the door button on the left.')],
    [t('Items and devices'), t('Place furniture and devices and bind Home Assistant entities. You can place a device straight from the list below.')],
  ],
  edit: [
    [t('Place'), t('Drag a card from the bar below into the scene and drop it. Green: it fits; red: the reason it does not is shown. R rotates.')],
    [t('Edit'), t('Drag an item to move it; rotate, duplicate or delete it with the bubble above it. Select a room to drag it, resize it with the handles.')],
    [t('Bind'), t('Select an item and bind as many Home Assistant entities as you like. The first one drives the 3D view; the others, like temperature, humidity or a plug, show on the card.')],
  ],
}

function EditHelp() {
  const empty = useLayout((s) => (activeLevel(s)?.rooms.length ?? 0) === 0)
  const backup = useLayout((s) => s.backup)
  const hasRegistry = useHa((s) => Boolean(s.registry))
  const list = useUnboundDevices()
  const [more, setMore] = useState(false)
  const shown = more ? list : list.slice(0, 8)
  return (
    <div className={panel}>
      <Header eyebrow={empty ? t('Empty plan') : t('Edit')} title={empty ? t('Draw your home') : t('Shape your home')} Icon={Pencil} />
      <div className={`${body} gap-3 text-[13px] leading-relaxed text-ink-2`}>
        <ol className="grid gap-2">
          {STEPS[empty ? 'empty' : 'edit'].map(([title, text], i) => (
            <li key={title} className="grid grid-cols-[24px_1fr] gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-brand-50 font-mono text-[11px] font-semibold text-brand">{i + 1}</span>
              <span>
                <b className="font-semibold text-ink">{title}.</b> {text}
              </span>
            </li>
          ))}
        </ol>
        {empty && hasRegistry && (
          <button type="button" onClick={regenerateFromHa} className="flex items-center justify-center gap-2 rounded-xl border border-line py-2 text-[12.5px] font-semibold text-ink-2 hover:border-brand hover:text-brand">
            <WandSparkles size={15} />
            {t('Or set it up automatically from the Home Assistant areas')}
          </button>
        )}
        {backup && (
          <button
            type="button"
            onClick={() => {
              useLayout.getState().restoreBackup()
              useView.getState().request({ kind: 'house' })
              useHa.setState({ notice: t('Previous plan restored.') })
            }}
            className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-left text-[12.5px] hover:bg-brand-50"
          >
            <History size={15} className="shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <b className="font-semibold text-ink">{t('Restore the previous plan')}</b>
              <span className="block text-[11px] text-ink-3">
                {tn(backup.layout.levels.reduce((a, l) => a + l.rooms.length, 0), '{count} room · cleared {date}', '{count} rooms · cleared {date}', {
                  date: new Date(backup.at).toLocaleString(currentLang(), { dateStyle: 'medium', timeStyle: 'short' }),
                })}
              </span>
            </span>
          </button>
        )}
        {list.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-[12px] font-semibold text-ink">{t('Devices not bound to any item ({count})', { count: list.length })}</p>
            {shown.map(({ e, kind, extra }) => {
              const Icon = KIND_ICON[kind]
              return (
                <button
                  key={e.entity_id}
                  type="button"
                  data-unbound={e.entity_id}
                  onClick={() => usePlacement.getState().start({ type: 'item', kind, entityId: e.entity_id, extra }, 'click')}
                  className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                  title={t('Click, then place it in a room')}
                >
                  <Icon size={16} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{extra?.name ?? friendlyName(e)}</span>
                    {extra?.name && <span className="block truncate text-[11px] text-ink-3">{friendlyName(e)}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-brand">{t('Place')}</span>
                </button>
              )
            })}
            {list.length > shown.length && (
              <button type="button" onClick={() => setMore(true)} className="w-fit px-2 text-[12px] font-semibold text-brand">
                {tn(list.length - shown.length, '+{count} more device', '+{count} more devices')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Inspector({ stats }: { stats: Record<string, RoomStats> }) {
  const fps = useView((s) => s.fps)
  // Whether the panel is open (ui/panelState.ts): when closed it slides out to the right (down on narrow screens) and hides
  const open = usePanel((s) => s.open)
  const level = useLayout((s) => activeLevel(s))
  const selection = useLayout((s) => s.selection)
  const mode = useLayout((s) => s.mode)

  let content: React.ReactNode
  if (selection?.type === 'item') {
    const item = level?.items.find((i) => i.id === selection.id)
    const room = item && level ? roomAt(level.rooms, item.x, item.z) : undefined
    content = item ? mode === 'edit' ? <ItemEdit item={item} room={room} /> : <ItemView item={item} room={room} /> : null
  } else if (selection?.type === 'room') {
    const room = level?.rooms.find((r) => r.id === selection.id)
    content = room ? mode === 'edit' ? <RoomEdit room={room} /> : <RoomView room={room} stats={stats[room.id]} /> : null
  }
  // On a phone the edit help covers the scene: show it only on wide screens (an empty plan has nothing to cover, so show it)
  const helpOnly = !content && mode === 'edit' && (level?.rooms.length ?? 0) > 0
  // In the first-person walk only the card of the selected device (F) shows; the overview must not cover the screen
  if (!content && fps) return null
  if (!content) content = mode === 'edit' ? <EditHelp /> : <Overview stats={stats} />

  return (
    <>
      <aside
        id="side-panel"
        data-open={open ? '1' : '0'}
        aria-hidden={open ? undefined : true}
        className={`pointer-events-none absolute inset-x-3 z-30 flex max-h-(--sheet) flex-col justify-end transition-[translate,opacity,visibility] duration-200 ease-out lg:inset-x-auto lg:right-4 lg:top-4 lg:max-h-none lg:w-(--panel-w) lg:justify-start ${
          mode === 'edit' ? 'bottom-[176px] lg:bottom-[184px]' : 'bottom-[76px] lg:bottom-[84px]'
        } ${helpOnly ? 'hidden lg:flex' : ''} ${open ? '' : 'invisible translate-y-[calc(100%+80px)] opacity-0 lg:translate-x-[calc(100%+24px)] lg:translate-y-0'}`}
      >
        <SheetGrip />
        <div className="relative flex min-h-0 flex-col">
          <WidthGrip />
          {content}
        </div>
      </aside>
      {/* Button that opens the closed panel on narrow screens (on wide screens it is in the tool column) */}
      {!open && !helpOnly && (
        <button
          type="button"
          id="panel-open-sheet"
          onClick={() => usePanel.getState().setOpen(true)}
          className={`glass pointer-events-auto absolute right-3 z-30 flex h-10 touch-manipulation items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-ink-2 shadow-lg lg:hidden ${mode === 'edit' ? 'bottom-[184px]' : 'bottom-[84px]'}`}
          title={t('Open panel')}
        >
          <PanelBottomOpen size={16} className="text-brand" />
          {t('Panel')}
        </button>
      )}
    </>
  )
}

/**
 * Left edge of the panel on wide screens (ui/panelState.ts): drag to narrow or widen the panel; a double click restores
 * the default width. Works with mouse and touch.
 */
function WidthGrip() {
  const drag = useRef<{ x: number; w: number } | null>(null)
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    delete document.body.dataset.resizing
  }
  return (
    <div
      id="panel-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Panel width')}
      title={t('Drag to narrow or widen the panel (double-click: default width)')}
      className="group pointer-events-auto absolute -left-3.5 top-0 z-10 hidden h-full w-4 cursor-ew-resize touch-none lg:block"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, w: Math.min(usePanel.getState().width, maxWidth(window.innerWidth)) }
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.dataset.resizing = '1'
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) usePanel.getState().setWidth(Math.min(maxWidth(window.innerWidth), d.w + d.x - e.clientX))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => usePanel.getState().setWidth(PANEL_DEFAULT)}
    >
      <span className="absolute left-1/2 top-[min(50%,220px)] h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3/45 shadow-sm transition-colors group-hover:bg-brand group-active:bg-brand" />
    </div>
  )
}

/** Grip of the bottom sheet on narrow screens: pull up to grow, down to shrink; a close button next to it */
function SheetGrip() {
  const drag = useRef<{ y: number; f: number } | null>(null)
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <div className="pointer-events-auto mb-1.5 flex shrink-0 items-center justify-center gap-2 lg:hidden">
      <div
        id="sheet-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('Panel height')}
        title={t('Drag to grow or shrink the panel')}
        className="glass flex h-8 w-28 cursor-ns-resize touch-none items-center justify-center rounded-full"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, f: usePanel.getState().sheet }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) usePanel.getState().setSheet(d.f + (d.y - e.clientY) / Math.max(1, window.innerHeight - 64))
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="h-1.5 w-12 rounded-full bg-ink-3/50" />
      </div>
      <button
        type="button"
        id="panel-close-sheet"
        onClick={() => usePanel.getState().setOpen(false)}
        className="glass grid size-8 touch-manipulation place-items-center rounded-full text-ink-2"
        title={t('Close panel')}
        aria-label={t('Close panel')}
      >
        <ChevronDown size={16} />
      </button>
    </div>
  )
}
