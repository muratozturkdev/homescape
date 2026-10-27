import { ArrowDown, ArrowUp, Crosshair, House, Pause, Play, Power, Scissors, SkipBack, SkipForward, Square, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  canToggle,
  coverCommand,
  mediaCommand,
  MOMENTARY,
  mowerCommand,
  selectOption,
  selectSource,
  setFanOscillate,
  setFanPercentage,
  setFanPreset,
  setHumidifierMode,
  setHumidity,
  setNumber,
  setValvePosition,
  setWaterMode,
  setWaterTemp,
  vacuumCommand,
  mediaPlayPause,
  setBrightness,
  setCoverPosition,
  setCoverTilt,
  setKelvin,
  setRgb,
  setVolume,
  toggle,
} from '@/ha/actions'
import { domainOf, isActive, isReading, lightColor, num, stateLabel, supportsBrightness, supportsColor, supportsColorTemp } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { t, tc } from '@/i18n'
import { AlarmControl } from './AlarmControl'
import { ClimateControl } from './ClimateControl'

/* Controls by entity domain. All of them go to the active source: demo or a real HA. */

const SWATCHES: [number, number, number][] = [
  [255, 120, 90],
  [255, 196, 90],
  [120, 220, 150],
  [90, 170, 255],
  [120, 110, 255],
  [255, 110, 200],
]
const KELVINS: [string, number][] = [
  [t('Warm'), 2700],
  [t('Neutral'), 4000],
  [t('Cold'), 6000],
]

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${active ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

function Slider({ label, value, min = 0, max = 100, unit = '%', onCommit }: { label: string; value: number; min?: number; max?: number; unit?: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between text-[12px] text-ink-2">
        {label}
        <span className="font-mono tabular-nums text-ink">
          {Math.round(shown)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => {
          if (draft != null) onCommit(draft)
          setDraft(null)
        }}
        onKeyUp={() => {
          if (draft != null) onCommit(draft)
          setDraft(null)
        }}
      />
    </label>
  )
}

export function PowerButton({ e }: { e: HassEntity }) {
  if (!canToggle(e)) return null
  const on = isActive(e)
  const d = domainOf(e.entity_id)
  const verb = MOMENTARY.includes(d)
    ? t('Run')
    : d === 'lock'
      ? e.state === 'locked'
        ? t('Unlock')
        : tc('action', 'Lock')
      : d === 'vacuum'
        ? on
          ? t('Return to dock')
          : t('Start cleaning')
        : d === 'alarm_control_panel'
          ? on
            ? t('Disarm')
            : t('Arm (away)')
          : on
            ? t('Turn off')
            : t('Turn on')
  return (
    <button
      type="button"
      onClick={() => toggle(e)}
      className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-colors ${
        on ? 'bg-sun-50 text-ink ring-1 ring-sun/50' : 'bg-brand text-white hover:bg-brand-600'
      }`}
    >
      <Power size={16} />
      {verb}
    </button>
  )
}

export function EntityControls({ e }: { e: HassEntity }) {
  const d = domainOf(e.entity_id)
  const on = isActive(e)

  if (['number', 'input_number', 'select', 'input_select'].includes(d)) return <ValueControl e={e} />
  if (d === 'camera') return <CameraSnapshot e={e} />
  if (isReading(e)) {
    return <p className="rounded-xl bg-surface-2 px-4 py-3 font-mono text-[22px] font-semibold tabular-nums">{stateLabel(e)}</p>
  }

  return (
    <div className="grid gap-3">
      {/* Climate and alarm turn on and off with their mode buttons (Off) */}
      {d !== 'climate' && d !== 'alarm_control_panel' && <PowerButton e={e} />}

      {d === 'light' && on && supportsBrightness(e) && (
        <Slider label={t('Brightness')} value={((num(e.attributes.brightness) ?? 255) / 255) * 100} min={1} onCommit={(v) => setBrightness(e, v)} />
      )}
      {d === 'light' && supportsColor(e) && (
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((rgb) => (
            <button
              key={rgb.join()}
              type="button"
              onClick={() => setRgb(e, rgb)}
              className="size-7 rounded-full border-2 border-surface shadow ring-1 ring-line"
              style={{ background: `rgb(${rgb.join(',')})` }}
              title={t('Color')}
            />
          ))}
          <span className="ml-1 size-5 rounded-full ring-1 ring-line" style={{ background: on ? lightColor(e) : 'transparent' }} title={t('Current color')} />
        </div>
      )}
      {d === 'light' && supportsColorTemp(e) && (
        <div className="flex gap-2">
          {KELVINS.map(([label, k]) => (
            <Chip key={k} onClick={() => setKelvin(e, k)} active={num(e.attributes.color_temp_kelvin) === k}>
              {label}
            </Chip>
          ))}
        </div>
      )}

      {d === 'climate' && <ClimateControl e={e} />}

      {d === 'media_player' && ['playing', 'paused', 'idle', 'on'].includes(e.state) && (
        <button type="button" onClick={() => mediaPlayPause(e)} className="flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl bg-surface-2 px-3 text-[13px] font-semibold">
          {e.state === 'playing' ? <Pause size={16} /> : <Play size={16} />}
          {e.state === 'playing' ? t('Pause') : t('Play')}
          {typeof e.attributes.media_title === 'string' && <span className="truncate font-normal text-ink-2">· {e.attributes.media_title}</span>}
        </button>
      )}

      {d === 'media_player' && on && num(e.attributes.volume_level) != null && (
        <Slider label={t('Volume')} value={Math.round((num(e.attributes.volume_level) ?? 0) * 100)} onCommit={(v) => setVolume(e, v)} />
      )}

      {d === 'cover' && <Slider label={t('Position')} value={num(e.attributes.current_position) ?? (on ? 100 : 0)} onCommit={(v) => setCoverPosition(e, v)} />}
      {d === 'cover' && num(e.attributes.current_tilt_position) != null && (
        <Slider label={t('Slat tilt')} value={num(e.attributes.current_tilt_position) ?? 0} onCommit={(v) => setCoverTilt(e, v)} />
      )}

      {d === 'alarm_control_panel' && <AlarmControl e={e} />}

      {/* Fan: speed, oscillation, preset */}
      {d === 'fan' && on && num(e.attributes.percentage) != null && (
        <Slider label={t('Speed')} value={num(e.attributes.percentage) ?? 0} onCommit={(v) => setFanPercentage(e, v)} />
      )}
      {d === 'fan' && (typeof e.attributes.oscillating === 'boolean' || listOf(e.attributes.preset_modes).length > 0) && (
        <div className="flex flex-wrap gap-2">
          {typeof e.attributes.oscillating === 'boolean' && (
            <Chip active={Boolean(e.attributes.oscillating)} onClick={() => setFanOscillate(e, !e.attributes.oscillating)}>
              {t('Oscillation')}
            </Chip>
          )}
          {listOf(e.attributes.preset_modes).map((m) => (
            <Chip key={m} active={e.attributes.preset_mode === m} onClick={() => setFanPreset(e, m)}>
              {m}
            </Chip>
          ))}
        </div>
      )}

      {/* Humidifier / dehumidifier: target humidity, mode */}
      {d === 'humidifier' && num(e.attributes.humidity) != null && (
        <Slider label={t('Target humidity')} value={num(e.attributes.humidity) ?? 50} min={num(e.attributes.min_humidity) ?? 30} max={num(e.attributes.max_humidity) ?? 80} onCommit={(v) => setHumidity(e, v)} />
      )}
      {d === 'humidifier' && listOf(e.attributes.available_modes).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {listOf(e.attributes.available_modes).map((m) => (
            <Chip key={m} active={e.attributes.mode === m} onClick={() => setHumidifierMode(e, m)}>
              {m}
            </Chip>
          ))}
        </div>
      )}

      {/* Water heater (tank heater, boiler hot water): target temperature and operation mode */}
      {d === 'water_heater' && num(e.attributes.temperature) != null && (
        <Slider label={t('Water temperature')} unit="°" value={num(e.attributes.temperature) ?? 50} min={num(e.attributes.min_temp) ?? 30} max={num(e.attributes.max_temp) ?? 75} onCommit={(v) => setWaterTemp(e, v)} />
      )}
      {d === 'water_heater' && listOf(e.attributes.operation_list).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {listOf(e.attributes.operation_list).map((m) => (
            <Chip key={m} active={e.state === m} onClick={() => setWaterMode(e, m)}>
              {stateLabel({ ...e, state: m })}
            </Chip>
          ))}
        </div>
      )}

      {/* Valve (irrigation, water, gas): position */}
      {d === 'valve' && num(e.attributes.current_position) != null && (
        <Slider label={t('Position')} value={num(e.attributes.current_position) ?? 0} onCommit={(v) => setValvePosition(e, v)} />
      )}

      {/* Cover (garage door, garden gate, curtain, awning): open, stop, close */}
      {d === 'cover' && (
        <div className="grid grid-cols-3 gap-2">
          <Chip onClick={() => coverCommand(e, 'open_cover')}>
            <span className="flex items-center justify-center gap-1">
              <ArrowUp size={14} /> {tc('action', 'Open')}
            </span>
          </Chip>
          <Chip onClick={() => coverCommand(e, 'stop_cover')}>
            <span className="flex items-center justify-center gap-1">
              <Square size={12} /> {t('Stop')}
            </span>
          </Chip>
          <Chip onClick={() => coverCommand(e, 'close_cover')}>
            <span className="flex items-center justify-center gap-1">
              <ArrowDown size={14} /> {t('Close')}
            </span>
          </Chip>
        </div>
      )}

      {/* Media: previous, next, mute, source */}
      {d === 'media_player' && on && (
        <div className="flex flex-wrap gap-2">
          <Chip onClick={() => mediaCommand(e, 'media_previous_track')}>
            <SkipBack size={14} />
          </Chip>
          <Chip onClick={() => mediaCommand(e, 'media_next_track')}>
            <SkipForward size={14} />
          </Chip>
          {typeof e.attributes.is_volume_muted === 'boolean' && (
            <Chip active={Boolean(e.attributes.is_volume_muted)} onClick={() => mediaCommand(e, 'volume_mute')}>
              {e.attributes.is_volume_muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </Chip>
          )}
        </div>
      )}
      {d === 'media_player' && on && listOf(e.attributes.source_list).length > 0 && (
        <select value={String(e.attributes.source ?? '')} onChange={(ev) => selectSource(e, ev.target.value)} className="min-h-10 rounded-xl border border-line bg-surface px-3 text-[13px]">
          {!e.attributes.source && <option value="">{t('Choose source')}</option>}
          {listOf(e.attributes.source_list).map((src) => (
            <option key={src} value={src}>
              {src}
            </option>
          ))}
        </select>
      )}

      {/* Robot vacuum and lawn mower: pause, locate, dock */}
      {d === 'vacuum' && (
        <div className="flex flex-wrap gap-2">
          <Chip onClick={() => vacuumCommand(e, 'pause')}>
            <Pause size={14} />
          </Chip>
          <Chip onClick={() => vacuumCommand(e, 'locate')}>
            <span className="flex items-center gap-1">
              <Crosshair size={14} /> {t('Locate')}
            </span>
          </Chip>
        </div>
      )}
      {d === 'lawn_mower' && (
        <div className="grid grid-cols-3 gap-2">
          <Chip active={e.state === 'mowing'} onClick={() => mowerCommand(e, 'start_mowing')}>
            <span className="flex items-center justify-center gap-1">
              <Scissors size={14} /> {t('Mow')}
            </span>
          </Chip>
          <Chip active={e.state === 'paused'} onClick={() => mowerCommand(e, 'pause')}>
            <Pause size={14} />
          </Chip>
          <Chip active={e.state === 'docked'} onClick={() => mowerCommand(e, 'dock')}>
            <span className="flex items-center justify-center gap-1">
              <House size={14} /> {t('Dock')}
            </span>
          </Chip>
        </div>
      )}
    </div>
  )
}

/** List of strings in an HA attribute (preset_modes, source_list, operation_list...). */
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Number and select entities (number, input_number, select, input_select): a slider or a dropdown. */
export function ValueControl({ e }: { e: HassEntity }) {
  const d = domainOf(e.entity_id)
  if (d === 'number' || d === 'input_number') {
    const min = num(e.attributes.min) ?? 0
    const max = num(e.attributes.max) ?? 100
    const unit = typeof e.attributes.unit_of_measurement === 'string' ? e.attributes.unit_of_measurement : ''
    return <Slider label={t('Value')} unit={unit ? ` ${unit}` : ''} value={num(e.state) ?? min} min={min} max={max} onCommit={(v) => setNumber(e, v)} />
  }
  if (d === 'select' || d === 'input_select') {
    return (
      <select value={e.state} onChange={(ev) => selectOption(e, ev.target.value)} className="min-h-10 rounded-xl border border-line bg-surface px-3 text-[13px]">
        {listOf(e.attributes.options).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  return null
}

/**
 * Camera image: HA's entity_picture URL (camera_proxy, carries an access token) is proxied through the same origin and
 * refreshed every 10 seconds. No image in demo mode.
 */
export function CameraSnapshot({ e }: { e: HassEntity }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000)
    return () => clearInterval(id)
  }, [])
  const src = typeof e.attributes.entity_picture === 'string' ? e.attributes.entity_picture : null
  if (!src) return <p className="grid aspect-video place-items-center rounded-xl bg-surface-2 text-[12px] text-ink-3">{t('No image')}</p>
  return <img src={`${src}${src.includes('?') ? '&' : '?'}t=${tick}`} alt={String(e.attributes.friendly_name ?? t('Camera'))} className="aspect-video w-full rounded-xl bg-surface-2 object-cover" />
}
