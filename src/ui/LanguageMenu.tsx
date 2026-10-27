import { Check, Languages } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { currentLang, LANGUAGES, type Lang, savedLang, setLang, t } from '@/i18n'

/*
 * Language menu: "Automatic" (the Home Assistant user's language inside Home Assistant, else the device language, else
 * English) and every supported language under its own name. Picking one saves it and reloads the page (src/i18n). The
 * button sits in the top bar on wide screens; on narrow screens the list opens from a row of the "More" menu.
 */

/** The list itself (popover of the button, and the More menu) */
export function LanguageList() {
  const saved = savedLang()
  const active = currentLang()
  const row = (on: boolean) => `flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] touch-manipulation pointer-coarse:min-h-11 ${on ? 'bg-brand-50 font-semibold text-ink' : 'text-ink hover:bg-surface-2'}`
  const pick = (code: Lang | null) => {
    if (code === saved) return
    setLang(code)
  }
  return (
    <div className="grid gap-0.5" data-language-list>
      <button type="button" data-language="auto" className={row(saved == null)} onClick={() => pick(null)}>
        <Check size={15} className={`shrink-0 ${saved == null ? 'text-brand' : 'text-transparent'}`} />
        <span className="flex-1">{t('Automatic')}</span>
        {saved == null && <span className="text-[11px] text-ink-3">{LANGUAGES.find((l) => l.code === active)?.name}</span>}
      </button>
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" lang={l.code} data-language={l.code} className={row(saved === l.code)} onClick={() => pick(l.code)}>
          <Check size={15} className={`shrink-0 ${saved === l.code ? 'text-brand' : 'text-transparent'}`} />
          <span className="flex-1">{l.name}</span>
          <span className="font-mono text-[10.5px] uppercase text-ink-3">{l.code}</span>
        </button>
      ))}
    </div>
  )
}

/** Top bar button (wide screens) */
export function LanguageButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])
  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        id="language-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-ink-2 hover:text-ink"
        title={t('Language')}
      >
        <Languages size={16} />
        <span className="font-mono text-[11px] font-semibold uppercase">{currentLang()}</span>
      </button>
      {open && (
        <div id="language-menu" className="glass absolute right-0 top-[calc(100%+8px)] z-50 max-h-[calc(100dvh-90px)] w-60 overflow-y-auto rounded-2xl p-2" role="dialog" aria-label={t('Language')}>
          <LanguageList />
        </div>
      )}
    </div>
  )
}
