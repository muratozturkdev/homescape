import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BUS_LABEL, BUSES, unlock, useSound } from '@/audio/engine'
import { t } from '@/i18n'

/*
 * Sound button in the top bar; clicking opens a menu: sound on/off, master volume, and a switch and level for each sound
 * type (appliances and climate, TV and music, doors and switches, alerts and notifications, people, animals, outdoors and
 * weather, interface). The settings are kept in this browser (audio/engine.ts > useSound).
 */

function Switch({ on, onChange, label, id }: { on: boolean; onChange: () => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export function SoundIcon({ size = 16 }: { size?: number }) {
  const on = useSound((s) => s.on)
  const volume = useSound((s) => s.volume)
  if (!on || volume === 0) return <VolumeX size={size} />
  return volume < 0.34 ? <Volume size={size} /> : volume < 0.67 ? <Volume1 size={size} /> : <Volume2 size={size} />
}

/** Menu content: in the top bar popover and in the "More" menu on phones */
export function SoundPanel() {
  const on = useSound((s) => s.on)
  const volume = useSound((s) => s.volume)
  const buses = useSound((s) => s.buses)
  const levels = useSound((s) => s.levels)
  const running = useSound((s) => s.running)
  const { setOn, setVolume, setBus, setLevel } = useSound.getState()
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink">{t('Sound')}</span>
        <Switch id="sound-on" on={on} onChange={() => setOn(!on)} label={t('Turn sound on or off')} />
      </div>
      <label className={`grid gap-1.5 ${on ? '' : 'opacity-50'}`}>
        <span className="flex justify-between text-[12px] font-semibold text-ink-2">
          {t('Master volume')}
          <span className="font-mono tabular-nums text-ink">{t('{percent}%', { percent: Math.round(volume * 100) })}</span>
        </span>
        <input id="sound-volume" type="range" min={0} max={1} step={0.05} value={volume} disabled={!on} onChange={(e) => setVolume(Number(e.target.value))} />
      </label>
      <div className={`grid gap-2.5 border-t border-line pt-3 ${on ? '' : 'opacity-50'}`}>
        <span className="font-mono text-[10.5px] uppercase tracking-widest text-ink-3">{t('Sound types')}</span>
        {BUSES.map((b) => (
          <div key={b} className="grid gap-1" data-bus={b}>
            <div className="flex items-center justify-between gap-3">
              <span className={`text-[12.5px] ${buses[b] ? 'text-ink' : 'text-ink-3'}`}>{BUS_LABEL[b]}</span>
              <span className="flex items-center gap-2">
                <span className="w-9 text-right font-mono text-[11px] tabular-nums text-ink-2">{t('{percent}%', { percent: Math.round(levels[b] * 100) })}</span>
                <Switch id={`sound-bus-${b}`} on={buses[b]} onChange={() => setBus(b, !buses[b])} label={BUS_LABEL[b]} />
              </span>
            </div>
            <input
              id={`sound-level-${b}`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={levels[b]}
              disabled={!on || !buses[b]}
              aria-label={t('{name} level', { name: BUS_LABEL[b] })}
              onChange={(e) => setLevel(b, Number(e.target.value))}
            />
          </div>
        ))}
      </div>
      <span className="text-[11px] leading-snug text-ink-3">
        {on && !running
          ? t('The browser turns sound on at the first click.')
          : t('Sounds come from where the device is: louder as you come closer, muffled from another room during a walk.')}
      </span>
    </div>
  )
}

export function SoundButton() {
  const [open, setOpen] = useState(false)
  const on = useSound((s) => s.on)
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
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        id="sound-toggle"
        onClick={() => {
          unlock()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        className={`grid size-9 place-items-center rounded-xl border ${on ? 'border-line bg-surface text-ink-2 hover:text-ink' : 'border-line bg-surface text-ink-3'}`}
        title={on ? t('Sound on: levels and channels') : t('Sound off')}
      >
        <SoundIcon />
      </button>
      {open && (
        <div id="sound-menu" className="glass absolute right-0 top-[calc(100%+8px)] z-50 max-h-[calc(100dvh-90px)] w-80 overflow-y-auto rounded-2xl p-3.5">
          <SoundPanel />
        </div>
      )}
    </div>
  )
}
