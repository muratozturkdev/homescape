import { Blinds, ChevronDown, ChevronUp, House, Lock, LockOpen, Minus, Pause, Play, Plus, Power, ShieldCheck, ShieldOff, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { coverCommand, MOMENTARY, mediaPlayPause, setBrightness, setFanPercentage, setTemperature, toggle, vacuumCommand } from '@/ha/actions'
import { domainOf, isActive, num } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { formatNumber, t, tc } from '@/i18n'
import { useQuick } from './quickState'

/*
 * Actions of the quick pill (ui/QuickPill.tsx). The main button depends on the device type: power (light, plug, fan,
 * climate, media), lock, cover, run (scene, script, button), vacuum (start / return to dock), alarm (arm / disarm). Next to
 * it an extra control by type: brightness for lights, a speed slider for fans, target temperature -/+ for climate, play /
 * pause for media, stop for a moving cover. While dragging, the slider sends commands sparingly, and the last value on
 * release. On touch screens (coarse pointer) the buttons are 44 px.
 */

const btn = (on: boolean) =>
  `grid size-9 shrink-0 touch-manipulation place-items-center rounded-full transition-colors pointer-coarse:size-11 ${on ? 'bg-sun text-white shadow-[0_0_12px] shadow-sun/60' : 'bg-brand text-white hover:bg-brand-600'}`
const ghost = 'grid size-8 shrink-0 touch-manipulation place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:size-11'

/** Main button: icon and action by type; tests find it by `data-quick-toggle` */
export function QuickMain({ target }: { target: HassEntity }) {
  const d = domainOf(target.entity_id)
  const on = isActive(target)
  const keep = () => useQuick.getState().keep()
  let Icon = Power
  let label = on ? t('Turn off') : t('Turn on')
  let active = on
  if (MOMENTARY.includes(d)) {
    Icon = Play
    label = t('Run')
    active = false
  } else if (d === 'lock') {
    const locked = target.state === 'locked'
    Icon = locked ? Lock : LockOpen
    label = locked ? t('Unlock') : tc('action', 'Lock')
    active = !locked
  } else if (d === 'cover') {
    Icon = Blinds
    label = on ? t('Close cover') : t('Open cover')
  } else if (d === 'vacuum' || d === 'lawn_mower') {
    Icon = on ? House : Play
    label = on ? t('Send to dock') : t('Start')
  } else if (d === 'alarm_control_panel') {
    const off = target.state === 'disarmed'
    Icon = off ? ShieldOff : ShieldCheck
    label = off ? t('Arm alarm (away)') : t('Disarm alarm')
    active = !off
  }
  return (
    <button
      type="button"
      data-quick-toggle
      aria-label={label}
      title={label}
      onClick={(ev) => {
        ev.stopPropagation()
        keep()
        void toggle(target)
      }}
      className={btn(active)}
    >
      <Icon size={16} strokeWidth={2.4} className="pointer-coarse:size-5" />
    </button>
  )
}

/** Slider (brightness, speed): sends every 0.25 s while dragging and the last value on release */
function QuickSlider({ value, label, onSet }: { value: number; label: string; onSet: (v: number) => void }) {
  const [local, setLocal] = useState<number | null>(null)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const shown = local ?? value
  const send = (v: number) => {
    clearTimeout(timer.current)
    const now = performance.now()
    if (now - last.current > 250) {
      last.current = now
      onSet(v)
    } else timer.current = setTimeout(() => onSet(v), 250)
  }
  const done = () => {
    if (local == null) return
    clearTimeout(timer.current)
    onSet(local)
    setLocal(null)
  }
  return (
    <label className="flex shrink-0 items-center gap-1.5 pl-1" title={label}>
      <input
        type="range"
        min={1}
        max={100}
        value={Math.round(shown)}
        aria-label={label}
        data-quick-slider
        onChange={(e) => {
          const v = Number(e.target.value)
          setLocal(v)
          useQuick.getState().keep()
          send(v)
        }}
        onPointerUp={done}
        onKeyUp={done}
        onBlur={done}
        className="h-6 w-24 cursor-pointer touch-none accent-[var(--brand)] pointer-coarse:h-9 pointer-coarse:w-32"
      />
      <span className="w-8 text-right font-mono text-[11px] tabular-nums text-ink-2 pointer-coarse:text-[12.5px]">{t('{percent}%', { percent: Math.round(shown) })}</span>
    </label>
  )
}

/** Extra control by type (null when there is none) */
export function QuickExtras({ target }: { target: HassEntity }) {
  const d = domainOf(target.entity_id)
  const on = isActive(target)
  const keep = () => useQuick.getState().keep()
  if (d === 'light' && on) {
    const modes = (target.attributes.supported_color_modes as string[] | undefined) ?? []
    const dimmable = num(target.attributes.brightness) != null || modes.some((m) => m !== 'onoff')
    if (!dimmable) return null
    const pct = ((num(target.attributes.brightness) ?? 255) / 255) * 100
    return <QuickSlider value={pct} label={t('Brightness')} onSet={(v) => void setBrightness(target, v)} />
  }
  if (d === 'fan' && on && num(target.attributes.percentage) != null) {
    return <QuickSlider value={num(target.attributes.percentage) ?? 0} label={t('Fan speed')} onSet={(v) => void setFanPercentage(target, v)} />
  }
  if (d === 'climate' && target.state !== 'off') {
    const temp = num(target.attributes.temperature)
    if (temp == null) return null
    const step = num(target.attributes.target_temp_step) ?? 0.5
    const min = num(target.attributes.min_temp) ?? 7
    const max = num(target.attributes.max_temp) ?? 35
    const set = (v: number) => {
      keep()
      void setTemperature(target, Math.min(max, Math.max(min, Math.round(v / step) * step)))
    }
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" className={ghost} onClick={() => set(temp - step)} aria-label={t('Lower temperature')} title={t('Lower temperature')} data-quick-minus>
          <Minus size={15} />
        </button>
        <span className="min-w-12 text-center font-mono text-[13px] font-semibold tabular-nums text-ink pointer-coarse:text-[14px]">{formatNumber(temp, 1, step < 1 ? 1 : 0)}°</span>
        <button type="button" className={ghost} onClick={() => set(temp + step)} aria-label={t('Raise temperature')} title={t('Raise temperature')} data-quick-plus>
          <Plus size={15} />
        </button>
      </div>
    )
  }
  if (d === 'media_player' && on && target.state !== 'standby') {
    const playing = target.state === 'playing'
    return (
      <button
        type="button"
        className={ghost}
        onClick={() => {
          keep()
          void mediaPlayPause(target)
        }}
        aria-label={playing ? t('Pause') : t('Play')}
        title={playing ? t('Pause') : t('Play')}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
    )
  }
  if (d === 'cover') {
    const moving = target.state === 'opening' || target.state === 'closing'
    return (
      <div className="flex shrink-0 items-center">
        <button type="button" className={ghost} onClick={() => (keep(), void coverCommand(target, 'open_cover'))} aria-label={t('Open cover')} title={t('Open cover')}>
          <ChevronUp size={16} />
        </button>
        {moving && (
          <button type="button" className={ghost} onClick={() => (keep(), void coverCommand(target, 'stop_cover'))} aria-label={t('Stop')} title={t('Stop')}>
            <Square size={13} />
          </button>
        )}
        <button type="button" className={ghost} onClick={() => (keep(), void coverCommand(target, 'close_cover'))} aria-label={t('Close cover')} title={t('Close cover')}>
          <ChevronDown size={16} />
        </button>
      </div>
    )
  }
  if (d === 'vacuum' && on) {
    return (
      <button type="button" className={ghost} onClick={() => (keep(), void vacuumCommand(target, 'pause'))} aria-label={t('Pause')} title={t('Pause')}>
        <Pause size={16} />
      </button>
    )
  }
  return null
}
