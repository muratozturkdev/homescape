import { Download, Eraser, ShieldCheck, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useHa } from '@/ha/store'
import { exportLayout, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { t, tn } from '@/i18n'

/*
 * "Start from scratch": clears the plan (rooms, items, doors) so the home can be drawn again on empty ground.
 * The removed plan is backed up automatically and can be restored from the empty plan card; it can also be downloaded as a
 * file. The HA connection, sign-in and theme are untouched.
 */

/** Translated text with <b>...</b> marks drawn bold */
const bold = (text: string) => text.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i} className="text-ink">{part}</b> : part))

export default function ResetDialog({ onClose }: { onClose: () => void }) {
  // zustand 5: a selector that returns a new object on every call loops forever; select the counts separately
  const rooms = useLayout((s) => (s.layout?.levels ?? []).reduce((a, x) => a + x.rooms.length, 0))
  const items = useLayout((s) => (s.layout?.levels ?? []).reduce((a, x) => a + x.items.length, 0))

  const confirm = () => {
    useLayout.getState().clearAll()
    useView.getState().request({ kind: 'house' })
    useHa.setState({ notice: t('Plan cleared. Drag a room from the Rooms tab below or draw one on the ground with Free draw.') })
    onClose()
  }

  // Portal to body so it opens above the whole UI instead of inside the toolbar's z-30 layer
  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="glass w-full max-w-[440px] rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Start from scratch')}>
        <div className="flex items-start justify-between border-b border-line px-5 pb-3 pt-4">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-miss">{t('Clear the plan')}</p>
            <h2 className="text-[17px] font-semibold">{t('Draw the home from scratch')}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg border border-line text-ink-2" title={t('Close')}>
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-3 px-5 py-4 text-[13px] leading-relaxed text-ink-2">
          <p>
            {bold(
              t('<b>{rooms}</b> and <b>{items}</b> (doors and Home Assistant links included) are removed; you draw your home again on empty ground.', {
                rooms: tn(rooms, '{count} room', '{count} rooms'),
                items: tn(items, '{count} item', '{count} items'),
              }),
            )}
          </p>
          <p className="flex gap-2 rounded-xl bg-ok-50 px-3 py-2.5">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ok" />
            <span>
              {bold(
                t(
                  'This plan is backed up automatically; if you change your mind, <b>Restore the previous plan</b> on the empty plan card brings it back. Your Home Assistant connection and theme setting stay the same.',
                ),
              )}
            </span>
          </p>
          <button type="button" onClick={exportLayout} className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-brand hover:bg-brand-50">
            <Download size={14} />
            {t('Also download as a file (JSON)')}
          </button>
        </div>
        <div className="flex gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line py-2.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-2">
            {t('Cancel')}
          </button>
          <button type="button" onClick={confirm} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-miss py-2.5 text-[13px] font-semibold text-white hover:brightness-95">
            <Eraser size={15} />
            {t('Clear and start')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
