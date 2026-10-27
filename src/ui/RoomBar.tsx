import { House } from 'lucide-react'
import { isStreetSurface } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { t } from '@/i18n'
import { fmt, type RoomStats } from './useHome'

/** Bottom bar: rooms; a click selects the room and moves the camera there */
export default function RoomBar({ stats }: { stats: Record<string, RoomStats> }) {
  const level = useLayout((s) => activeLevel(s))
  const selection = useLayout((s) => s.selection)
  const select = useLayout((s) => s.select)
  const request = useView((s) => s.request)
  // Street surfaces (road, sidewalk, crosswalk, parking) are not rooms of the home: not in the bar
  const rooms = (level?.rooms ?? []).filter((r) => !isStreetSurface(r))

  return (
    <nav className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-30 flex items-center gap-2 rounded-2xl px-2.5 py-2 lg:inset-x-4 lg:bottom-4">
      <button
        type="button"
        onClick={() => {
          select(null)
          request({ kind: 'house' })
        }}
        className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-brand px-3 text-[13px] font-semibold text-white hover:bg-brand-600"
        title={t('Whole home')}
      >
        <House size={16} />
        <span className="hidden sm:inline">{t('Whole home')}</span>
      </button>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none]">
        {rooms.map((r) => {
          const s = stats[r.id]
          const active = selection?.type === 'room' && selection.id === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                select({ type: 'room', id: r.id })
                request({ kind: 'room', id: r.id })
              }}
              className={`flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-[13px] transition-colors ${
                active ? 'border-brand bg-brand-50 text-brand' : 'border-line bg-surface text-ink-2 hover:text-ink'
              }`}
            >
              <span className={`size-2 rounded-full ${s?.lightsOn ? 'bg-sun shadow-[0_0_8px] shadow-sun' : 'bg-line'}`} />
              <span className="font-semibold">{r.name}</span>
              {s?.temp != null && <span className="font-mono text-[12px] tabular-nums text-ink-3">{fmt(s.temp)}°</span>}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
