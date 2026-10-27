import { isActive } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { CATALOG } from '@/model/catalog'
import { Copy, FlipHorizontal2, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { itemName, itemStateLabel, quickReadings } from './Bindings'
import { hasQuick } from './quickState'
import type { Item, Room } from '@/model/types'
import { isStreetSurface, roomArea } from '@/model/geometry'
import { registerLabel } from '@/scene/labels'
import { t, tn } from '@/i18n'
import { fmt, type RoomStats } from './useHome'

/** Cycles the opening direction: left-in -> right-in -> right-out -> left-out -> back to the start */
function nextOpening(item: Item): Pick<Item, 'hinge' | 'swing'> {
  const hinge = item.hinge ?? 'left'
  const swing = item.swing ?? 'in'
  if (swing === 'in') return hinge === 'left' ? { hinge: 'right', swing: 'in' } : { hinge: 'right', swing: 'out' }
  return hinge === 'right' ? { hinge: 'left', swing: 'out' } : { hinge: 'left', swing: 'in' }
}

/** Container whose position LabelProjector writes every frame */
function Anchor({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      ref={(el) => {
        registerLabel(id, el)
        return () => registerLabel(id, null)
      }}
      className="absolute left-0 top-0 will-change-transform"
      style={{ transform: 'translate3d(-9999px, -9999px, 0)' }}
    >
      {children}
    </div>
  )
}

function RoomTag({ room, stats, edit }: { room: Room; stats?: RoomStats; edit: boolean }) {
  return (
    <Anchor id={`room-${room.id}`}>
      <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--glass-border)] bg-[var(--surface)] py-1 pl-3 pr-3 shadow-sm backdrop-blur">
        <span className="text-[12px] font-semibold text-ink">{room.name}</span>
        {edit ? (
          <span className="hidden font-mono text-[11px] tabular-nums text-ink-3 sm:inline">
            {room.parts?.length ? `${fmt(roomArea(room), 1)} m²` : `${fmt(room.w, 2)} × ${fmt(room.d, 2)} m`}
          </span>
        ) : (
          <>
            {stats?.temp != null && <span className="font-mono text-[11px] tabular-nums text-ink-2">{fmt(stats.temp)}°</span>}
            {stats?.humidity != null && <span className="font-mono text-[11px] tabular-nums text-ink-3">{t('{percent}%', { percent: fmt(stats.humidity, 0) })}</span>}
            {!!stats?.lightsOn && <span className="size-2 rounded-full bg-sun shadow-[0_0_8px] shadow-sun" title={tn(stats.lightsOn, '{count} light on', '{count} lights on')} />}
          </>
        )}
      </div>
    </Anchor>
  )
}

function SelectedTag() {
  const item = useLayout((s) => {
    if (s.selection?.type !== 'item') return null
    const id = s.selection.id
    return activeLevel(s)?.items.find((i) => i.id === id) ?? null
  })
  const edit = useLayout((s) => s.mode === 'edit')
  const moving = usePlacement((s) => (item && s.moving?.id === item.id ? s.moving : null))
  const entity = useHa((s) => (item?.entityId ? s.entities[item.entityId] : undefined))
  const entities = useHa((s) => s.entities)
  if (!item) return null
  // In view mode an item with a quick pill has no status tag: the pill takes its place (one card above the item; ui/quickState.ts)
  if (!edit && hasQuick(item, entities)) return null
  const readings = quickReadings(item, entities)
  const name = itemName(item, entity)
  const L = useLayout.getState()
  const act = 'pointer-events-auto grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink'

  if (moving && !moving.ok) {
    return (
      <Anchor id="selected-item">
        <div className="whitespace-nowrap rounded-full bg-miss px-3 py-1.5 text-[12px] font-semibold text-white shadow-md">
          {name} · {moving.reason}
        </div>
      </Anchor>
    )
  }

  return (
    <Anchor id="selected-item">
      <div className="flex flex-col items-center gap-1.5">
        {edit && !moving && (
          <div className="glass flex items-center gap-0.5 rounded-full p-1" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className={act} title={t('Rotate left (⇧R)')} onClick={() => L.updateItem(item.id, { rot: item.rot - Math.PI / 2 })}>
              <RotateCcw size={15} />
            </button>
            <button type="button" className={act} title={t('Rotate right (R)')} onClick={() => L.updateItem(item.id, { rot: item.rot + Math.PI / 2 })}>
              <RotateCw size={15} />
            </button>
            {(item.kind === 'door' || item.kind === 'window') && (
              <button type="button" className={act} title={t('Flip the opening direction')} onClick={() => L.updateItem(item.id, nextOpening(item))}>
                <FlipHorizontal2 size={15} />
              </button>
            )}
            <button type="button" className={act} title={t('Duplicate')} onClick={() => L.duplicateItem(item.id)}>
              <Copy size={15} />
            </button>
            <button type="button" className={`${act} hover:!text-miss`} title={t('Delete (Delete key)')} onClick={() => L.deleteItem(item.id)}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
        <div data-selected-tag={item.id} className="flex items-center gap-2 whitespace-nowrap rounded-full border border-brand bg-[var(--surface-solid)] py-1 pl-1 pr-3 shadow-md">
          <span className={`size-5 rounded-full ${entity ? (isActive(entity) ? 'bg-sun' : 'bg-ink-3') : 'bg-line'}`} />
          <span className="text-[12px] font-semibold text-ink">{name}</span>
          {entity && <span className="text-[11px] text-ink-2">· {itemStateLabel(item, entity)}</span>}
          {readings.length > 0 && <span className="font-mono text-[11px] tabular-nums text-ink-2">· {readings.join(' · ')}</span>}
        </div>
      </div>
    </Anchor>
  )
}

/** Status text above the placement ghost: "drop" or "click" when the spot is valid, else the reason */
function GhostTag() {
  const target = usePlacement((s) => s.target)
  const result = usePlacement((s) => s.result)
  const via = usePlacement((s) => s.via)
  if (!target) return null
  const label = target.type === 'room' ? target.preset.label : CATALOG[target.kind].label
  return (
    <Anchor id="ghost">
      {result && (
        <div
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold shadow-md ${
            result.ok ? 'bg-[var(--surface-solid)] text-ink ring-2 ring-ok' : 'bg-miss text-white'
          }`}
        >
          {label} · {result.ok ? (via === 'drag' ? t('drop to place') : t('click to place')) : result.reason}
          {result.ok && (target.type === 'item' || target.preset.parts) && <span className="ml-2 font-mono text-[10.5px] font-medium text-ink-3">{t('R to rotate')}</span>}
        </div>
      )}
    </Anchor>
  )
}

/** Label layer above the 3D scene and below the UI */
export default function PinLayer({ stats }: { stats: Record<string, RoomStats> }) {
  const level = useLayout((s) => activeLevel(s))
  const edit = useLayout((s) => s.mode === 'edit')
  // While placing, the ghost's tag stands out: room tags fade and the selection tag hides
  const placing = usePlacement((s) => Boolean(s.target))
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className={`transition-opacity duration-200 ${placing ? 'opacity-25' : ''}`}>
        {/* Street surfaces (road, sidewalk, crosswalk, parking) show no name in view mode; in edit mode they show with their size */}
        {(level?.rooms ?? [])
          .filter((r) => edit || !isStreetSurface(r))
          .map((r) => (
            <RoomTag key={r.id} room={r} stats={stats[r.id]} edit={edit} />
          ))}
      </div>
      {!placing && <SelectedTag />}
      <GhostTag />
    </div>
  )
}
