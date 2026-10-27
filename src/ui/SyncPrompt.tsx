import { CloudDownload, CloudUpload, RefreshCw } from 'lucide-react'
import { resolveConflict, useSync } from '@/ha/planSync'
import { currentLang, t, tn } from '@/i18n'

/*
 * Home plan conflict (ha/planSync.ts): this device has a plan edited by hand that was never synced, and Home Assistant has
 * a plan from another device. The user chooses which one stays; taking the one in HA backs up the plan of this device in
 * this browser.
 */
export default function SyncPrompt() {
  const conflict = useSync((s) => s.conflict)
  if (!conflict) return null
  const when = new Date(conflict.updatedAt)
  const at = Number.isNaN(when.getTime()) ? '' : when.toLocaleString(currentLang(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  const n = conflict.homes.length
  const text =
    n > 1
      ? at
        ? tn(
            n,
            'Home Assistant has {count} home saved from another device ({date}). Which one should stay? The other one is backed up in this browser.',
            'Home Assistant has {count} homes saved from another device ({date}). Which one should stay? The other one is backed up in this browser.',
            { date: at },
          )
        : tn(
            n,
            'Home Assistant has {count} home saved from another device. Which one should stay? The other one is backed up in this browser.',
            'Home Assistant has {count} homes saved from another device. Which one should stay? The other one is backed up in this browser.',
          )
      : at
        ? t('Home Assistant has a home plan saved from another device ({date}). Which one should stay? The other one is backed up in this browser.', { date: at })
        : t('Home Assistant has a home plan saved from another device. Which one should stay? The other one is backed up in this browser.')
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-[60] flex justify-center px-4">
      <div id="sync-prompt" role="dialog" aria-label={t('Home plan sync')} className="glass pointer-events-auto w-full max-w-md rounded-2xl p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="icon-tile grid size-10 shrink-0 place-items-center rounded-xl">
            <RefreshCw size={18} className="text-brand" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-brand">Home Assistant</p>
            <h2 className="text-[15px] font-semibold text-ink">{t('The home plan on this device is different')}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{text}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            id="sync-use-remote"
            onClick={() => resolveConflict('remote')}
            className="flex min-h-10 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl bg-brand px-3 text-[13px] font-semibold text-white hover:bg-brand-600"
          >
            <CloudDownload size={16} />
            {t('Use the one in Home Assistant')}
          </button>
          <button
            type="button"
            id="sync-use-local"
            onClick={() => resolveConflict('local')}
            className="flex min-h-10 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2"
          >
            <CloudUpload size={16} />
            {t('Save the one on this device')}
          </button>
        </div>
      </div>
    </div>
  )
}
