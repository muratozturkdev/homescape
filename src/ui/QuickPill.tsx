import { ChevronRight, DoorClosed, DoorOpen } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { isActive } from '@/ha/derive'
import { useHa } from '@/ha/store'
import type { HassEntity } from '@/ha/types'
import { OPENS } from '@/model/containers'
import { activeLevel, useLayout } from '@/model/layoutStore'
import { useBins } from '@/scene/bins'
import { useView } from '@/scene/camera'
import { kick } from '@/scene/frame'
import { itemName, itemStateLabel, quickReadings } from './Bindings'
import { t } from '@/i18n'
import { QuickExtras, QuickMain } from './QuickActions'
import { quickPill, quickTarget, resetPill, useQuick, useQuickId } from './quickState'

/*
 * Quick pill (ui/quickState.ts): a single instance in the app, in the #quick-layer layer (outside the scene's event
 * container, so pressing the pill does not reach the camera controller). The scene writes its position
 * (scene/QuickAnchor.tsx > placePill); this component draws the content: main button and extra control by type
 * (ui/QuickActions.tsx), name and state with readings on two lines, and a details arrow (selects the item: the card on the
 * right opens, the pill closes). A selected item has no pill (one thing open at a time). On touch screens (coarse pointer)
 * the buttons are finger sized.
 */

export default function QuickPill() {
  const id = useQuickId()
  const pinned = useQuick((s) => s.pinned && s.id === id)
  const item = useLayout((s) => (id ? (activeLevel(s)?.items.find((i) => i.id === id) ?? null) : null))
  const view = useLayout((s) => s.mode === 'view')
  const fps = useView((s) => s.fps)
  const dashboard = useView((s) => s.dashboard)
  // While the pill is closed, entity changes do not redraw the component
  const entities = useHa((s) => (item ? s.entities : null))
  const ref = useRef<HTMLDivElement>(null)

  // No pill in edit mode, during the walk or on the dashboard
  useEffect(() => {
    if (!view || fps || dashboard) useQuick.getState().hide()
  }, [view, fps, dashboard])

  // A pill opened by touch closes on a touch outside it (touching another item opens that one)
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) useQuick.getState().hide()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [pinned])

  const shownId = item && view && !fps && !dashboard ? item.id : null
  // On every render (item changes, state text grows or shrinks): the scene draws a frame and the pill centers above the item again
  useLayoutEffect(() => {
    quickPill.el = shownId ? ref.current : null
    resetPill()
    if (shownId) kick()
  })

  if (!item || !shownId || !entities) return null
  const entity = item.entityId ? entities[item.entityId] : undefined
  const related = (item.extras ?? []).map((x) => entities[x]).filter((e): e is HassEntity => Boolean(e))
  const target = quickTarget(entity, related)
  const shown = entity ?? target
  if (!shown) return null
  const readings = quickReadings(item, entities)
  const details = () => {
    useQuick.getState().hide()
    useLayout.getState().select({ type: 'item', id: item.id })
  }
  const on = target ? isActive(target) : isActive(shown)
  return (
    <div
      ref={ref}
      // The scene writes its position (transform); hidden until placed
      style={{ visibility: 'hidden' }}
      className="pointer-events-auto absolute left-0 top-0 will-change-transform"
      onPointerEnter={() => useQuick.getState().keep()}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') useQuick.getState().leave()
      }}
      onPointerDown={() => useQuick.getState().keep()}
    >
      <div
        key={item.id}
        data-quick={item.id}
        className="quick-in glass flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-1 pr-1.5 shadow-lg pointer-coarse:gap-2 pointer-coarse:py-1.5 pointer-coarse:pl-1.5"
      >
        {target && <QuickMain target={target} />}
        <div className={`flex min-w-0 flex-col leading-tight ${target ? 'pl-0.5' : 'pl-2'}`}>
          <span className="max-w-44 truncate text-[12.5px] font-semibold text-ink pointer-coarse:text-[14px]">{itemName(item, entity)}</span>
          <span className={`flex max-w-52 items-center gap-1 truncate text-[11px] pointer-coarse:text-[12.5px] ${on ? 'font-medium text-ink' : 'text-ink-2'}`}>
            {on && <span className="size-1.5 shrink-0 rounded-full bg-sun shadow-[0_0_6px] shadow-sun" />}
            {itemStateLabel(item, shown)}
            {readings.length > 0 && <span className="font-mono tabular-nums text-ink-3"> · {readings.join(' · ')}</span>}
          </span>
        </div>
        {target && <QuickExtras target={target} />}
        {OPENS(item.kind) && <DoorsButton id={item.id} />}
        <button
          type="button"
          onClick={details}
          data-quick-details
          className="flex h-8 shrink-0 touch-manipulation items-center gap-1 rounded-full px-1.5 text-[11.5px] font-semibold text-brand hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:px-2.5 pointer-coarse:text-[13px]"
          title={t('Details and all controls')}
        >
          {pinned ? t('Details') : <ChevronRight size={15} className="text-ink-3" />}
        </button>
      </div>
    </div>
  )
}

/**
 * Cabinet doors (counter, wardrobe, dresser): on a cabinet with a linked light (under-counter LED) this button sits next to
 * the power button in the pill, so pressing the cabinet does not only open the doors and the light stays reachable
 */
function DoorsButton({ id }: { id: string }) {
  const open = useBins((s) => Boolean(s.open[id]))
  const label = open ? t('Close the doors') : t('Open the doors')
  return (
    <button
      type="button"
      data-quick-doors
      onClick={() => {
        useQuick.getState().keep()
        useBins.getState().toggle(id)
      }}
      className={`grid size-8 shrink-0 touch-manipulation place-items-center rounded-full hover:bg-surface-2 pointer-coarse:size-11 ${open ? 'text-brand' : 'text-ink-2'}`}
      aria-label={label}
      title={label}
      aria-pressed={open}
    >
      {open ? <DoorOpen size={16} /> : <DoorClosed size={16} />}
    </button>
  )
}
