import { Maximize, Share, SquarePlus, Tablet, X } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { t } from '@/i18n'
import { toggleFullscreen, useFsGuide } from './fullscreen'

/*
 * Fullscreen guide for iPad (ui/fullscreen.ts). In fullscreen iPadOS always shows the status bar and its own X button; the
 * way to open without the address bar, tabs and X is to add Homescape to the home screen. The home screen app has storage
 * separate from the browser: the home plan comes from Home Assistant (ha/planSync.ts), and the HA sign-in is done once.
 */

/** Translated step text: {icon} becomes the icon, <b>...</b> is bold */
function rich(text: string, icon: ReactNode) {
  return text.split(/(\{icon\}|<b>.*?<\/b>)/).map((part, i) =>
    part === '{icon}' ? <Fragment key={i}>{icon}</Fragment> : part.startsWith('<b>') ? <b key={i}>{part.slice(3, -4)}</b> : part,
  )
}

export default function HomeScreenGuide() {
  const open = useFsGuide((s) => s.open)
  if (!open) return null
  const close = () => useFsGuide.setState({ open: false })
  const step = 'flex items-start gap-3 rounded-xl bg-surface-2 p-3'
  const num = 'grid size-6 shrink-0 place-items-center rounded-full bg-brand font-mono text-[12px] font-semibold text-white'
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4" onClick={close}>
      <div id="home-screen-guide" role="dialog" aria-label={t('Fullscreen on iPad')} className="glass w-full max-w-[440px] rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="icon-tile grid size-11 shrink-0 place-items-center rounded-xl">
            <Tablet size={20} className="text-brand" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-brand">{t('Fullscreen')}</p>
            <h2 className="text-[16px] font-semibold text-ink">{t('Add it to the home screen to open it without bars on iPad')}</h2>
          </div>
          <button type="button" onClick={close} className="grid size-9 shrink-0 touch-manipulation place-items-center rounded-full text-ink-3 hover:bg-surface-2" aria-label={t('Close')}>
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          {t(
            'iPadOS does not let a page that goes fullscreen in the browser hide the status bar at the top and its own X button. Homescape opened from the icon on the home screen opens without the address bar, tabs and X; the status bar takes the color of the app.',
          )}
        </p>
        <ol className="mt-3 grid gap-2 text-[13px] text-ink">
          <li className={step}>
            <span className={num}>1</span>
            <span>
              {rich(t('Tap the {icon} <b>Share</b> icon in the address bar (top right in Chrome, next to the address in Safari).'), <Share size={14} className="inline -translate-y-px text-brand" />)}
            </span>
          </li>
          <li className={step}>
            <span className={num}>2</span>
            <span>
              {rich(t('Choose {icon} <b>Add to Home Screen</b>; if there is an "Open as Web App" option, leave it on.'), <SquarePlus size={14} className="inline -translate-y-px text-brand" />)}
            </span>
          </li>
          <li className={step}>
            <span className={num}>3</span>
            <span>{t('Open it with the Homescape icon on the home screen. Sign in to Home Assistant there once: your home plan comes from Home Assistant.')}</span>
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={close} className="flex min-h-11 flex-1 touch-manipulation items-center justify-center rounded-xl bg-brand px-4 text-[13.5px] font-semibold text-white hover:bg-brand-600">
            {t('Got it')}
          </button>
          <button
            type="button"
            id="fullscreen-anyway"
            onClick={() => {
              close()
              void toggleFullscreen()
            }}
            className="flex min-h-11 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-ink-2 hover:bg-surface-2"
          >
            <Maximize size={15} />
            {t('Fullscreen anyway')}
          </button>
        </div>
      </div>
    </div>
  )
}
