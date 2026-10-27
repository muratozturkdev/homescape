import { DoorOpen, Power, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { canToggle, toggle } from '@/ha/actions'
import { friendlyName, isActive, stateLabel } from '@/ha/derive'
import { useHa } from '@/ha/store'
import { bindingsOf } from '@/model/bindings'
import { CATALOG, GROUP_LABEL } from '@/model/catalog'
import { inRoom } from '@/model/geometry'
import { levelName, useLayout } from '@/model/layoutStore'
import type { Item, Level, Room } from '@/model/types'
import { lower, t } from '@/i18n'
import { useView } from '@/scene/camera'
import { itemName } from './Bindings'
import { KIND_ICON } from './kindIcons'

/*
 * Quick search: opens with ⌘K / Ctrl+K or /. Searches the items on every floor (name, kind, group, the bound entity's name
 * and id) and the rooms. The power button on a row toggles the item directly; clicking a row (or Enter) switches to its
 * floor, selects the item and moves the camera to its room.
 */

/** Lower case without accents, so "lamba" finds "Lâmba" and "cafe" finds "Café"; the dotless i matches i */
const fold = (text: string) =>
  lower(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\u0131/g, 'i')

type Hit = { type: 'item'; item: Item; level: Level; room?: Room } | { type: 'room'; room: Room; level: Level }

export default function SearchPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const layout = useLayout((s) => s.layout)
  const entities = useHa((s) => s.entities)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const field = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !field && !useView.getState().fps)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('homescape:search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('homescape:search', onOpen)
    }
  }, [])
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0)
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    const q = fold(query.trim())
    if (!layout || !q) return []
    const out: Hit[] = []
    for (const level of layout.levels) {
      for (const room of level.rooms) if (fold(room.name).includes(q)) out.push({ type: 'room', room, level })
      for (const item of level.items) {
        const ids = bindingsOf(item)
        const text = [itemName(item, item.entityId ? entities[item.entityId] : undefined), CATALOG[item.kind].label, GROUP_LABEL[CATALOG[item.kind].group], ...ids, ...ids.map((id) => friendlyName(entities[id]))].join(' ')
        if (fold(text).includes(q)) out.push({ type: 'item', item, level, room: level.rooms.find((r) => inRoom(r, item.x, item.z)) })
      }
    }
    // Bound items first
    return out.sort((a, b) => Number(b.type === 'item' && Boolean(b.item.entityId)) - Number(a.type === 'item' && Boolean(a.item.entityId))).slice(0, 40)
  }, [layout, entities, query])

  if (!open) return null
  // Closing clears the query (the next opening starts empty)
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const go = (h: Hit) => {
    const L = useLayout.getState()
    const v = useView.getState()
    if (v.dashboard) v.setDashboard(false)
    if (L.levelId !== h.level.id) L.setLevel(h.level.id)
    if (h.type === 'room') {
      L.select({ type: 'room', id: h.room.id })
      v.request({ kind: 'room', id: h.room.id })
    } else {
      L.select({ type: 'item', id: h.item.id })
      if (h.room) v.request({ kind: 'room', id: h.room.id })
    }
    close()
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] flex items-start justify-center bg-black/25 px-4 pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass w-full max-w-[560px] overflow-hidden rounded-2xl" role="dialog" aria-label={t('Search items')}>
        <label className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-ink-3" />
          <input
            ref={input}
            id="search-palette"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              if (e.key === 'ArrowDown') setIndex((i) => Math.min(hits.length - 1, i + 1))
              if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
              if (e.key === 'Enter' && hits[index]) go(hits[index])
            }}
            placeholder={t('Search items, devices or rooms (light, TV, kitchen...)')}
            className="field-bare h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 sm:block">Esc</kbd>
          <button type="button" aria-label={t('Close')} onClick={close} className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
            <X size={16} />
          </button>
        </label>
        <div className="max-h-[56vh] overflow-y-auto p-2">
          {!query && <p className="px-3 py-4 text-[13px] text-ink-3">{t('Search everything in your plan. Click a row to show the item; the power button turns it on or off.')}</p>}
          {query && !hits.length && <p className="px-3 py-4 text-[13px] text-ink-3">{t('No results.')}</p>}
          {hits.map((h, i) => {
            const key = h.type === 'room' ? `r${h.room.id}` : `i${h.item.id}`
            if (h.type === 'room')
              return (
                <button key={key} type="button" onClick={() => go(h)} onMouseEnter={() => setIndex(i)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === index ? 'bg-brand-50' : ''}`}>
                  <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-ink-3">
                    <DoorOpen size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{h.room.name}</span>
                    <span className="block text-[11.5px] text-ink-3">{t('Room')}{layout && layout.levels.length > 1 ? ` · ${levelName(h.level)}` : ''}</span>
                  </span>
                </button>
              )
            const e = h.item.entityId ? entities[h.item.entityId] : undefined
            const Icon = KIND_ICON[h.item.kind]
            const tog = e && canToggle(e) ? e : undefined
            return (
              <div key={key} onMouseEnter={() => setIndex(i)} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === index ? 'bg-brand-50' : ''}`} data-search-hit={h.item.id}>
                <button type="button" onClick={() => go(h)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${e && isActive(e) ? 'bg-sun-50 text-sun' : 'bg-surface-2 text-ink-3'}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{itemName(h.item, e)}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {CATALOG[h.item.kind].label}
                      {h.room ? ` · ${h.room.name}` : ''}
                      {layout && layout.levels.length > 1 ? ` · ${levelName(h.level)}` : ''}
                      {e ? ` · ${stateLabel(e)}` : ` · ${t('not connected')}`}
                    </span>
                  </span>
                </button>
                {tog && (
                  <button type="button" aria-label={t('Turn on or off')} onClick={() => void toggle(tog)} className={`grid size-8 shrink-0 place-items-center rounded-full ${isActive(tog) ? 'bg-sun text-white' : 'bg-brand text-white'}`}>
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
