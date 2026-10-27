import { Droplets, Fan, Flame, Minus, Plus, Power, Snowflake, Sparkles, ThermometerSun, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { setFanMode, setHvacMode, setPresetMode, setSwingMode, setTemperature, setTempRange } from '@/ha/actions'
import { isUnavailable, num } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { formatNumber, t } from '@/i18n'

/*
 * Climate control (boiler, air conditioner), like in HomeKit and Home Assistant. Round dial: drag the target temperature
 * or step it with − / +; the room temperature is a small mark on the dial. Modes, fan, vane and preset as far as the entity
 * supports them (supported_features and the mode lists). The command goes to HA once, shortly after the last change (no
 * flood of calls while dragging the dial or pressing + repeatedly).
 */

/** HA climate feature bits (ClimateEntityFeature) */
export const CLIMATE_FEATURE = { TARGET_TEMPERATURE: 1, TARGET_TEMPERATURE_RANGE: 2, FAN_MODE: 8, PRESET_MODE: 16, SWING_MODE: 32 }

const MODE: Record<string, { label: string; color: string; Icon: LucideIcon }> = {
  off: { label: t('Off'), color: '#9aa0b8', Icon: Power },
  heat: { label: t('Heat'), color: '#ff7a45', Icon: Flame },
  cool: { label: t('Cool'), color: '#3d8bff', Icon: Snowflake },
  heat_cool: { label: t('Heat / cool'), color: '#2fbf71', Icon: ThermometerSun },
  auto: { label: t('Auto'), color: '#2fbf71', Icon: Sparkles },
  dry: { label: t('Dry'), color: '#e6b52e', Icon: Droplets },
  fan_only: { label: t('Fan'), color: '#3cc6c6', Icon: Fan },
}
const ACTION: Record<string, string> = {
  heating: t('Heating'),
  cooling: t('Cooling'),
  idle: t('Idle'),
  off: t('Off'),
  drying: t('Drying'),
  fan: t('Fan running'),
  preheating: t('Preheating'),
  defrosting: t('Defrosting'),
}
const FAN: Record<string, string> = {
  auto: t('Auto'),
  quiet: t('Quiet'),
  low: t('Low'),
  medium: t('Medium'),
  middle: t('Middle'),
  high: t('High'),
  top: t('Highest'),
  focus: t('Focus'),
  diffuse: t('Diffuse'),
  on: t('On'),
  off: t('Off'),
}
const SWING: Record<string, string> = { off: t('Off'), on: t('On'), stop: t('Stop'), swing: t('Swing'), vertical: t('Vertical'), horizontal: t('Horizontal'), both: t('Both ways'), windnice: 'Windnice' }
const PRESET: Record<string, string> = { none: t('None'), away: t('Away'), boost: t('Boost'), eco: t('Eco'), comfort: t('Comfort'), home: t('At home'), sleep: t('Sleep'), activity: t('Activity') }

const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : [])
const deg = (v: number, step: number) => `${formatNumber(v, step < 1 ? 1 : 0, step < 1 ? 1 : 0)}°`

/* ---------- dial ---------- */

const R = 82
const C0 = 100
const START = 135
const SWEEP = 270
const toXY = (angle: number) => [C0 + R * Math.cos((angle * Math.PI) / 180), C0 + R * Math.sin((angle * Math.PI) / 180)] as const
function arc(a0: number, a1: number) {
  const [x0, y0] = toXY(a0)
  const [x1, y1] = toXY(a1)
  return `M ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

function Dial({
  value,
  min,
  max,
  step,
  color,
  current,
  disabled,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  color: string
  current: number | null
  disabled: boolean
  onChange: (v: number, final: boolean) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const angleOf = (v: number) => START + (SWEEP * (Math.min(max, Math.max(min, v)) - min)) / (max - min)
  const snap = (v: number) => Math.round(Math.min(max, Math.max(min, Math.round(v / step) * step)) * 100) / 100
  const fromPointer = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect()
    const x = ((cx - r.left) / r.width) * 200 - C0
    const y = ((cy - r.top) / r.height) * 200 - C0
    let rel = ((Math.atan2(y, x) * 180) / Math.PI - START + 720) % 360
    if (rel > SWEEP) rel = rel > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP
    return snap(min + (rel / SWEEP) * (max - min))
  }
  const a = angleOf(value)
  const [kx, ky] = toXY(a)
  const cur = current != null && current >= min && current <= max ? toXY(angleOf(current)) : null
  return (
    <svg
      ref={svg}
      viewBox="0 0 200 200"
      className={`size-[200px] touch-none select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={t('Target temperature')}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        if (disabled) return
        dragging.current = true
        svg.current?.setPointerCapture(e.pointerId)
        onChange(fromPointer(e.clientX, e.clientY), false)
      }}
      onPointerMove={(e) => dragging.current && onChange(fromPointer(e.clientX, e.clientY), false)}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        onChange(fromPointer(e.clientX, e.clientY), true)
      }}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
        if (!d || disabled) return
        e.preventDefault()
        e.stopPropagation() // arrow keys must not move the camera
        onChange(snap(value + d * step), true)
      }}
    >
      <path d={arc(START, START + SWEEP)} fill="none" stroke="var(--line)" strokeWidth={14} strokeLinecap="round" />
      <path d={arc(START, Math.max(START + 0.5, a))} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
      {cur && <circle cx={cur[0]} cy={cur[1]} r={3.2} fill="var(--ink-2)" />}
      <circle cx={kx} cy={ky} r={11} fill="#ffffff" stroke={color} strokeWidth={4} />
    </svg>
  )
}

/* ---------- control ---------- */

/** − value + : large touch targets (44 px) */
function Stepper({ label, value, step, snap, disabled, onSet }: { label?: string; value: number; step: number; snap: (v: number) => number; disabled: boolean; onSet: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-24 text-[12px] font-semibold text-ink-2">{label}</span>}
      <button type="button" disabled={disabled} onClick={() => onSet(snap(value - step))} className="grid size-11 place-items-center rounded-xl bg-surface text-ink-2 shadow-sm hover:text-ink disabled:opacity-50" title={t('Decrease')} aria-label={t('Decrease')}>
        <Minus size={18} />
      </button>
      <span className="min-w-20 text-center font-mono text-[18px] font-semibold tabular-nums">{deg(value, step)}</span>
      <button type="button" disabled={disabled} onClick={() => onSet(snap(value + step))} className="grid size-11 place-items-center rounded-xl bg-surface text-ink-2 shadow-sm hover:text-ink disabled:opacity-50" title={t('Increase')} aria-label={t('Increase')}>
        <Plus size={18} />
      </button>
    </div>
  )
}

function Chips({ title, items, labels, value, onPick, disabled }: { title: string; items: string[]; labels: Record<string, string>; value?: string; onPick: (v: string) => void; disabled: boolean }) {
  if (!items.length) return null
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-semibold text-ink-2">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onPick(m)}
            className={`min-h-10 rounded-lg px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${value === m ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
          >
            {labels[m] ?? m}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ClimateControl({ e }: { e: HassEntity }) {
  const a = e.attributes
  const f = num(a.supported_features) ?? 0
  const dead = isUnavailable(e)
  const mode = MODE[e.state] ?? MODE.off
  const min = num(a.min_temp) ?? 7
  const max = num(a.max_temp) ?? 35
  const step = num(a.target_temp_step) ?? 0.5
  const target = num(a.temperature)
  const low = num(a.target_temp_low)
  const high = num(a.target_temp_high)
  const hasTarget = target != null && (f === 0 || (f & CLIMATE_FEATURE.TARGET_TEMPERATURE) !== 0)
  const hasRange = !hasTarget && low != null && high != null
  const current = num(a.current_temperature)
  const action = typeof a.hvac_action === 'string' ? ACTION[a.hvac_action] : undefined

  // Draft: the value picked with the dial or + / − that has not gone to HA yet (or not come back from HA)
  const [draft, setDraft] = useState<number | null>(null)
  const [draftRange, setDraftRange] = useState<[number, number] | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const later = (fn: () => unknown, delay: number, clear: () => void) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void Promise.resolve(fn()).finally(() => window.setTimeout(clear, 900)), delay)
  }
  const sendTarget = (v: number, final: boolean) => {
    setDraft(v)
    later(() => setTemperature(e, v), final ? 0 : 700, () => setDraft(null))
  }
  const sendRange = (lo: number, hi: number) => {
    setDraftRange([lo, hi])
    later(() => setTempRange(e, lo, hi), 700, () => setDraftRange(null))
  }
  const shown = draft ?? target ?? min
  const snap = (v: number) => Math.round(Math.min(max, Math.max(min, Math.round(v / step) * step)) * 100) / 100
  const [lo, hi] = draftRange ?? [low ?? min, high ?? max]

  const modes = list(a.hvac_modes)
  return (
    <div className="grid gap-3">
      {dead && <p className="rounded-xl bg-warn-50 px-3 py-2 text-[12.5px] text-ink-2">{t("Home Assistant can't reach the device right now; the settings may change when it is back.")}</p>}
      <div className="grid justify-items-center gap-2 rounded-2xl bg-surface-2 px-3 py-3">
        {hasTarget ? (
          <>
            <div className="relative">
              <Dial value={shown} min={min} max={max} step={step} color={mode.color} current={current} disabled={dead} onChange={sendTarget} />
              <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: mode.color }}>
                  {mode.label}
                </p>
                <p id={`clim-target-${e.entity_id}`} className="font-mono text-[34px] font-semibold leading-tight tabular-nums">
                  {deg(shown, step)}
                </p>
                <p className="text-[11.5px] text-ink-2">
                  {current != null ? t('Now {temperature}', { temperature: deg(current, 0.1) }) : t('No room temperature')}
                  {action ? ` · ${action}` : ''}
                </p>
              </div>
            </div>
            <Stepper value={shown} step={step} snap={snap} disabled={dead} onSet={(v) => sendTarget(v, false)} />
          </>
        ) : hasRange ? (
          <div className="grid w-full gap-2 py-1">
            <p className="text-center text-[12px] text-ink-2">
              {current != null ? t('Now {temperature}', { temperature: deg(current, 0.1) }) : ''}
              {action ? ` · ${action}` : ''}
            </p>
            <Stepper label={t('Heat below')} value={lo} step={step} snap={snap} disabled={dead} onSet={(v) => sendRange(Math.min(v, hi - step), hi)} />
            <Stepper label={t('Cool above')} value={hi} step={step} snap={snap} disabled={dead} onSet={(v) => sendRange(lo, Math.max(v, lo + step))} />
          </div>
        ) : (
          <div className="py-2 text-center">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: mode.color }}>
              {mode.label}
            </p>
            <p className="font-mono text-[30px] font-semibold tabular-nums">{current != null ? deg(current, 0.1) : '-'}</p>
            <p className="text-[11.5px] text-ink-3">{t("Room temperature · the target temperature of this device can't be set from Home Assistant")}</p>
          </div>
        )}
      </div>

      {modes.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t('Mode')}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {modes.map((m) => {
              const meta = MODE[m] ?? { label: m, color: '#9aa0b8', Icon: Power }
              const on = e.state === m
              return (
                <button
                  key={m}
                  type="button"
                  disabled={dead}
                  data-hvac={m}
                  onClick={() => setHvacMode(e, m)}
                  className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50 ${on ? 'text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                  style={on ? { background: meta.color } : undefined}
                >
                  <meta.Icon size={17} />
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {(f & CLIMATE_FEATURE.FAN_MODE) !== 0 && (
        <Chips title={t('Fan')} items={list(a.fan_modes)} labels={FAN} value={String(a.fan_mode ?? '')} onPick={(m) => setFanMode(e, m)} disabled={dead} />
      )}
      {(f & CLIMATE_FEATURE.SWING_MODE) !== 0 && (
        <Chips title={t('Vane')} items={list(a.swing_modes)} labels={SWING} value={String(a.swing_mode ?? '')} onPick={(m) => setSwingMode(e, m)} disabled={dead} />
      )}
      {(f & CLIMATE_FEATURE.PRESET_MODE) !== 0 && (
        <Chips title={t('Preset')} items={list(a.preset_modes)} labels={PRESET} value={String(a.preset_mode ?? '')} onPick={(m) => setPresetMode(e, m)} disabled={dead} />
      )}
    </div>
  )
}
