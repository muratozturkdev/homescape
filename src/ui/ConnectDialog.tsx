import { KeyRound, LogIn, LogOut, X } from 'lucide-react'
import { useState } from 'react'
import { PROXY_TARGET, useHa } from '@/ha/store'
import { t } from '@/i18n'

/*
 * Connection dialog. The password is never typed into this app:
 * "Sign in with Home Assistant" takes the user to Home Assistant's own login page (OAuth).
 * The token option is for a long-lived token the user created in their HA profile.
 */
/** welcome: opened by itself at the first launch from the home screen (separate storage from the browser, the connection does not carry over) */
export default function ConnectDialog({ onClose, welcome = false }: { onClose: () => void; welcome?: boolean }) {
  const settings = useHa((s) => s.settings)
  const status = useHa((s) => s.status)
  const error = useHa((s) => s.error)
  const source = useHa((s) => s.source)
  const embedded = useHa((s) => s.embedded)
  const { connectLive, connectDemo, disconnect } = useHa.getState()
  const [url, setUrl] = useState(settings.hassUrl || (PROXY_TARGET ? location.origin : ''))
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const viaProxy = Boolean(PROXY_TARGET) && url === location.origin

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="glass w-full max-w-[460px] rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('Home Assistant connection')}>
        <div className="flex items-start justify-between border-b border-line px-5 pb-3 pt-4">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-brand">{t('Connection')}</p>
            <h2 className="text-[17px] font-semibold">{t('Connect to Home Assistant')}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg border border-line text-ink-2" title={t('Close')}>
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-4 text-[13px]">
          {welcome && (
            <p id="standalone-welcome" className="rounded-xl bg-brand-50 px-3 py-2.5 leading-relaxed text-ink">
              {t(
                'Homescape on the home screen uses storage separate from the browser (an iPadOS rule), so the connection and sign-in from the browser do not carry over. Sign in with Home Assistant here once; the home plan you saved on the computer then comes from Home Assistant by itself.',
              )}
            </p>
          )}
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-ink-2">
            {t('Now:')} <b className="text-ink">{source?.kind === 'live' ? t('Live · {name}', { name: source.label }) : t('Demo')}</b>
            {status === 'connecting' && ` · ${t('connecting')}`}
          </p>
          {error && <p className="rounded-xl bg-miss-50 px-3 py-2 text-miss">{error}</p>}
          {/* Inside Home Assistant the frontend's own login is used (ha/embed.ts): nothing to set up */}
          {embedded && <p id="embedded-connection" className="leading-relaxed text-ink-2">{t('Homescape is running inside Home Assistant and uses your Home Assistant login. There is nothing to set up.')}</p>}

          <div className={embedded ? 'hidden' : 'contents'}>
          <label className="grid gap-1.5">
            <span className="font-semibold text-ink-2">{t('Home Assistant address')}</span>
            <input id="hass-url" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="http://homeassistant.local:8123" className="rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px] outline-none focus:border-brand" />
            <span className="text-[11.5px] leading-relaxed text-ink-3">
              {viaProxy
                ? t('The development server is a proxy to {target}; there is no need to change this address.', { target: PROXY_TARGET })
                : t("If you connect from another address, add this page's address to the http > cors_allowed_origins list in Home Assistant's configuration.yaml.")}
            </span>
          </label>

          <button
            type="button"
            disabled={!url || status === 'connecting'}
            onClick={() => connectLive(url)}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-[14px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            <LogIn size={16} />
            {t('Sign in with Home Assistant')}
          </button>
          <p className="-mt-2 text-center text-[11.5px] text-ink-3">{t("Home Assistant's own login page opens; your password never reaches this app.")}</p>

          <div className="rounded-xl border border-line">
            <button type="button" onClick={() => setShowToken((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 font-semibold text-ink-2">
              <KeyRound size={15} />
              {t('Connect with a long-lived token')}
            </button>
            {showToken && (
              <div className="grid gap-2 border-t border-line px-3 py-3">
                <input id="hass-token" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder={t('Token you created in your HA profile')} autoComplete="off" className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-brand" />
                <label className="flex items-center gap-2 text-[12px] text-ink-2">
                  <input id="hass-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  {t('Remember in this browser (check this only on your own device)')}
                </label>
                <button type="button" disabled={!url || !token} onClick={() => connectLive(url, token, remember)} className="rounded-lg bg-surface-2 py-2 font-semibold text-ink disabled:opacity-50">
                  {t('Connect with token')}
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => connectDemo()} className="flex-1 rounded-xl border border-line py-2 font-semibold text-ink-2 hover:bg-surface-2">
              {t('Switch to demo mode')}
            </button>
            {source?.kind === 'live' && (
              <button type="button" onClick={() => disconnect()} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-miss-50 py-2 font-semibold text-miss">
                <LogOut size={15} />
                {t('Sign out')}
              </button>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
