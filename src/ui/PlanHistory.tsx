import { Download, History, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportHomes, planHistory, planSize, replaceUnreadable, restorePlan, useSync, type PlanCopy } from '@/ha/planSync'
import { useHa } from '@/ha/store'
import { currentLang, t, tn } from '@/i18n'
import { usePlanHistory } from './planHistoryState'

/*
 * Plan history (ha/planSync.ts): the copies kept automatically in this browser and in Home Assistant, each of which can be
 * put back, and a download of all homes. Restoring keeps the current plan as a copy first, so it can be undone here too.
 */
export default function PlanHistory() {
  const open = usePlanHistory((s) => s.open)
  return open ? <Window /> : null
}

function Window() {
  const [copies, setCopies] = useState<PlanCopy[] | null>(null)
  const [ask, setAsk] = useState<number | null>(null)
  const blocked = useSync((s) => s.blocked)
  const close = () => usePlanHistory.setState({ open: false })
  useEffect(() => {
    let live = true
    void planHistory().then((list) => {
      if (live) setCopies(list)
    })
    return () => {
      live = false
    }
  }, [])
  const restore = (c: PlanCopy, i: number) => {
    if (ask !== i) return setAsk(i)
    restorePlan(c)
    useHa.setState({ notice: t('Home plan restored.') })
    close()
  }
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4" onClick={close}>
      <div id="plan-history" role="dialog" aria-label={t('Plan history')} className="glass flex max-h-[80dvh] w-full max-w-[460px] flex-col rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="icon-tile grid size-10 shrink-0 place-items-center rounded-xl">
              <History size={18} className="text-brand" />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold text-ink">{t('Plan history')}</h2>
              <p className="text-[12px] leading-snug text-ink-2">{t('Copies kept automatically before your plan is replaced. Restoring one keeps the current plan as a copy first.')}</p>
            </div>
          </div>
          <button type="button" onClick={close} aria-label={t('Close')} className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-1.5 overflow-y-auto px-3 py-3">
          {copies?.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-3">{t('No copies yet.')}</p>}
          {copies?.map((c, i) => {
            const n = planSize(c.homes)
            const when = new Date(c.at)
            return (
              <div key={`${c.where}-${c.at}-${i}`} data-plan-backup={c.where} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{Number.isNaN(when.getTime()) ? c.at : when.toLocaleString(currentLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="truncate text-[11.5px] text-ink-3">
                    {tn(n.homes, '{count} home', '{count} homes')} · {tn(n.rooms, '{count} room', '{count} rooms')} · {tn(n.items, '{count} item', '{count} items')} · {c.where === 'ha' ? 'Home Assistant' : t('This browser')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => restore(c, i)}
                  className={`flex min-h-9 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold ${ask === i ? 'bg-brand text-white' : 'text-brand hover:bg-surface'}`}
                >
                  <RotateCcw size={13} />
                  {ask === i ? t('Click again to restore') : t('Restore')}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <button type="button" id="plan-history-export" onClick={exportHomes} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Download size={14} />
            {t('Download all homes')}
          </button>
          {blocked === 'unreadable' && (
            <button
              type="button"
              id="plan-history-replace"
              onClick={() => {
                void replaceUnreadable()
                close()
              }}
              className="ml-auto flex min-h-9 items-center rounded-lg px-2 text-[12.5px] font-semibold text-miss hover:bg-miss-50"
            >
              {t('Replace it with the plan on this device')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
