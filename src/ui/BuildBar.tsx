import { Bath, Car, DoorOpen, Keyboard, Lightbulb, PawPrint, Plug, Radar, Search, ShieldCheck, Sofa, SquareDashed, SquarePlus, Thermometer, Trees, Tv, WashingMachine, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { CATALOG, GROUP_LABEL, ITEM_PRESETS, KINDS_BY_GROUP, type KindGroup } from '@/model/catalog'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { rectBounds } from '@/model/geometry'
import { presetRects, ROOM_PRESETS, usePlacement } from '@/model/placement'
import { DESK_ONLY, STACKABLE } from '@/model/rules'
import type { ItemKind } from '@/model/types'
import { formatNumber, lower, t } from '@/i18n'
import { KIND_ICON } from './kindIcons'
import { useThumbs } from './thumbStore'
import { beginCardDrag } from './usePlacementInput'

const ThumbnailFactory = lazy(() => import('@/scene/Thumbs'))

type Tab = 'room' | KindGroup

const GROUP_ICON: Record<KindGroup, typeof Sofa> = {
  furniture: Sofa,
  light: Lightbulb,
  climate: Thermometer,
  media: Tv,
  security: ShieldCheck,
  sensor: Radar,
  device: Plug,
  appliance: WashingMachine,
  bath: Bath,
  decor: Keyboard,
  pet: PawPrint,
  outdoor: Trees,
  garage: Car,
  structure: DoorOpen,
}
const ORDER: KindGroup[] = ['furniture', 'light', 'climate', 'media', 'security', 'sensor', 'device', 'appliance', 'bath', 'decor', 'pet', 'outdoor', 'garage', 'structure']
const TABS: { id: Tab; label: string; Icon: typeof Sofa }[] = [{ id: 'room', label: t('Rooms'), Icon: SquarePlus }, ...ORDER.map((g) => ({ id: g, label: GROUP_LABEL[g], Icon: GROUP_ICON[g] }))]

/** Search ignores case and accents: "sofa", "SOFA" and "Sofá" all match; the dotless i matches i */
const fold = (text: string) =>
  lower(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\u0131/g, 'i')

const DOMAIN_LABEL: Record<string, string> = {
  light: t('light'),
  switch: t('plug'),
  media_player: t('media'),
  climate: t('climate'),
  humidifier: t('humidity'),
  fan: t('fan'),
  camera: t('camera'),
  vacuum: t('vacuum'),
  alarm_control_panel: t('alarm'),
  binary_sensor: t('sensor'),
  sensor: t('sensor'),
  cover: t('curtain'),
  lock: t('lock'),
  remote: t('remote'),
  lawn_mower: t('lawn mower'),
  valve: t('valve'),
  water_heater: t('water heater'),
  siren: t('siren'),
  device_tracker: t('location'),
  event: t('event'),
  button: t('button'),
  weather: t('weather'),
}

function caption(kind: ItemKind) {
  const m = CATALOG[kind]
  if (DESK_ONLY.includes(kind)) return t('goes on a desk')
  if (STACKABLE.includes(kind)) return t('also fits on a desk')
  if (m.wall && !['furniture', 'appliance', 'bath', 'garage'].includes(m.group)) return t('on the wall')
  if (m.domains.length) return [...new Set(m.domains.slice(0, 2).map((d) => DOMAIN_LABEL[d] ?? d))].join(' · ')
  return `${formatNumber(m.size[0], 3)} × ${formatNumber(m.size[1], 3)} m`
}

function Card({ active, img, Icon, label, sub, onPointerDown, onClick }: {
  active: boolean
  img?: string
  Icon: typeof Sofa
  label: string
  sub: string
  onPointerDown?: (e: React.PointerEvent) => void
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{ touchAction: 'none' }}
      className={`group flex w-[104px] shrink-0 cursor-grab [@media(max-height:820px)]:w-[92px] select-none flex-col items-center gap-0.5 rounded-xl border px-1.5 pb-2 pt-1 transition-transform active:cursor-grabbing ${
        active ? 'border-brand bg-brand-50' : 'border-line bg-surface hover:-translate-y-0.5 hover:border-brand'
      }`}
    >
      <span className="grid h-[66px] w-full place-items-center [@media(max-height:820px)]:h-[46px]">
        {img ? <img src={img} alt="" draggable={false} className="h-[66px] w-[66px] object-contain drop-shadow-sm [@media(max-height:820px)]:h-[46px] [@media(max-height:820px)]:w-[46px] transition-transform group-hover:scale-105" /> : <Icon size={26} className="text-brand" />}
      </span>
      <span className="text-center text-[12px] font-semibold leading-tight text-ink">{label}</span>
      <span className="font-mono text-[10px] leading-tight text-ink-3">{sub}</span>
    </button>
  )
}

/** Build bar at the bottom in edit mode: drag a card into the scene and drop it. */
export default function BuildBar() {
  const empty = useLayout((s) => (activeLevel(s)?.rooms.length ?? 0) === 0)
  // An empty plan starts with rooms: open on the Rooms tab and return to it when the plan becomes empty
  const [tab, setTab] = useState<Tab>(() => (empty ? 'room' : 'furniture'))
  const [wasEmpty, setWasEmpty] = useState(empty)
  if (empty !== wasEmpty) {
    setWasEmpty(empty)
    if (empty) setTab('room')
  }
  const urls = useThumbs((s) => s.urls)
  const target = usePlacement((s) => s.target)
  const setTool = useLayout((s) => s.setTool)
  const tool = useLayout((s) => s.tool)
  // Item search across all tabs: by name, group or a device type that can be bound
  const [query, setQuery] = useState('')
  const q = fold(query.trim())
  const hits = (text: string) => fold(text).includes(q)
  const found = q
    ? {
        rooms: ROOM_PRESETS.filter((p) => hits(p.label)),
        kinds: (Object.keys(CATALOG) as ItemKind[]).filter((k) => hits(`${CATALOG[k].label} ${GROUP_LABEL[CATALOG[k].group]} ${CATALOG[k].domains.map((d) => DOMAIN_LABEL[d] ?? d).join(' ')}`)),
        presets: ITEM_PRESETS.filter((pr) => hits(`${pr.label} ${CATALOG[pr.kind].label}`)),
      }
    : null

  return (
    <nav className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-30 rounded-2xl lg:inset-x-4 lg:bottom-4" aria-label={t('Build bar')}>
      <Suspense fallback={null}>
        <ThumbnailFactory />
      </Suspense>
      <div className="flex items-center gap-1 border-b border-line px-2.5 pt-2">
        <label className="mb-1.5 mr-1 flex h-8 w-40 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 focus-within:border-brand sm:w-52">
          <Search size={14} className="shrink-0 text-ink-3" />
          <input
            id="build-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder={t('Search items')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          />
          {query && (
            <button type="button" aria-label={t('Clear search')} onClick={() => setQuery('')} className="text-ink-3 hover:text-ink">
              <X size={13} />
            </button>
          )}
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id)
                setQuery('')
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 pb-2 pt-1 text-[12.5px] font-semibold ${
                tab === id && !q ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto px-2.5 py-2.5 [scrollbar-width:thin]">
        {found ? (
          <>
            {found.rooms.length + found.kinds.length + found.presets.length === 0 && <p className="px-2 py-6 text-[13px] text-ink-3">{t('No items found for "{query}".', { query })}</p>}
            {found.rooms.map((p) => {
              const b = rectBounds(presetRects(p, 0))
              return (
                <Card
                  key={p.label}
                  active={target?.type === 'room' && target.preset.label === p.label}
                  img={(p.type === 'garden' && urls[`floor:${p.floor}`]) || (p.parts ? urls.roomL : urls.room)}
                  Icon={SquarePlus}
                  label={p.label}
                  sub={`${formatNumber(b.maxX, 3)} × ${formatNumber(b.maxZ, 3)} m`}
                  onPointerDown={(e) => beginCardDrag({ type: 'room', preset: p }, e)}
                />
              )
            })}
            {found.kinds.map((k) => (
              <Card
                key={k}
                active={target?.type === 'item' && target.kind === k && !target.preset}
                img={urls[k]}
                Icon={KIND_ICON[k]}
                label={CATALOG[k].label}
                sub={caption(k)}
                onPointerDown={(e) => beginCardDrag({ type: 'item', kind: k }, e)}
              />
            ))}
            {found.presets.map((pr) => (
              <Card
                key={pr.id}
                active={target?.type === 'item' && target.preset === pr.id}
                img={urls[`preset:${pr.id}`]}
                Icon={KIND_ICON[pr.kind]}
                label={pr.label}
                sub={pr.sub}
                onPointerDown={(e) => beginCardDrag({ type: 'item', kind: pr.kind, preset: pr.id, extra: pr.extra }, e)}
              />
            ))}
          </>
        ) : tab === 'room' ? (
          <>
            <Card
              active={tool === 'room'}
              Icon={SquareDashed}
              label={t('Draw freely')}
              sub={t('drag on the floor')}
              onClick={() => setTool(tool === 'room' ? 'select' : 'room')}
            />
            {ROOM_PRESETS.map((p) => {
              const b = rectBounds(presetRects(p, 0))
              return (
                <Card
                  key={p.label}
                  active={target?.type === 'room' && target.preset.label === p.label}
                  img={(p.type === 'garden' && urls[`floor:${p.floor}`]) || (p.parts ? urls.roomL : urls.room)}
                  Icon={SquarePlus}
                  label={p.label}
                  sub={`${formatNumber(b.maxX, 3)} × ${formatNumber(b.maxZ, 3)} m${p.parts || p.turn ? ` · ${t('R rotates')}` : ''}`}
                  onPointerDown={(e) => beginCardDrag({ type: 'room', preset: p }, e)}
                />
              )
            })}
          </>
        ) : (
          <>
            {KINDS_BY_GROUP[tab].map((k) => (
              <Card
                key={k}
                active={target?.type === 'item' && target.kind === k && !target.preset}
                img={urls[k]}
                Icon={KIND_ICON[k]}
                label={CATALOG[k].label}
                sub={caption(k)}
                onPointerDown={(e) => beginCardDrag({ type: 'item', kind: k }, e)}
              />
            ))}
            {/* Preset cards of the same kind (full-height window) */}
            {ITEM_PRESETS.filter((pr) => CATALOG[pr.kind].group === tab).map((pr) => (
              <Card
                key={pr.id}
                active={target?.type === 'item' && target.preset === pr.id}
                img={urls[`preset:${pr.id}`]}
                Icon={KIND_ICON[pr.kind]}
                label={pr.label}
                sub={pr.sub}
                onPointerDown={(e) => beginCardDrag({ type: 'item', kind: pr.kind, preset: pr.id, extra: pr.extra }, e)}
              />
            ))}
          </>
        )}
      </div>
    </nav>
  )
}
