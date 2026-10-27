import { Check, Cloud, CloudFog, CloudHail, CloudLightning, CloudMoon, CloudRain, CloudRainWind, CloudSnow, CloudSun, type LucideIcon, type LucideProps, Moon, Snowflake, Sun, Wind, Zap } from 'lucide-react'
import { createElement, useEffect, useRef, useState } from 'react'
import { useHa } from '@/ha/store'
import { currentWeather, SKIES, skyLabel, type Sky, useWeather, useWeatherPref, weatherEntities, weatherEntity } from '@/ha/weather'
import { t } from '@/i18n'
import { useNight } from '@/scene/useNight'

/*
 * The "Weather" tile in the top row (ha/weather.ts, scene/Weather.tsx): the state and temperature of the Home Assistant
 * weather entity; the scene follows this weather. Clicking opens: which weather entity to use (when there are several), and
 * a preview (a weather picked independently of Home Assistant, for this session only). On narrow screens the same picker is
 * in the "More" menu of the top bar.
 */

const ICON: Record<Sky, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  rain: CloudRain,
  pour: CloudRainWind,
  thunder: Zap,
  storm: CloudLightning,
  snow: Snowflake,
  sleet: CloudSnow,
  hail: CloudHail,
  fog: CloudFog,
  wind: Wind,
}
const skyIcon = (sky: Sky, night: boolean) => (night && sky === 'clear' ? Moon : night && sky === 'partly' ? CloudMoon : ICON[sky])
/** Icon of a weather (the moon instead of the sun at night) */
const SkyIcon = ({ sky, night, ...props }: { sky: Sky; night: boolean } & LucideProps) => createElement(skyIcon(sky, night), props)

/** Entity choice and preview list (the tile's popover, and the menu on narrow screens) */
export function WeatherPicker({ onPick }: { onPick?: () => void }) {
  const night = useNight()
  const { preview, entity: pick, setPreview, setEntity } = useWeatherPref()
  const w = useWeather()
  // Home Assistant's own weather (shown on the "Automatic" row while a preview is on)
  const haEntity = useHa((s) => weatherEntity(s.entities, pick))
  const haSky = haEntity ? currentWeather({ [haEntity.entity_id]: haEntity }, { preview: null, entity: haEntity.entity_id }).sky : null
  // Only ids and names of the entities (so the picker does not redraw on every temperature change)
  const list = useHa((s) =>
    weatherEntities(s.entities)
      .map((e) => `${e.entity_id}\t${String(e.attributes.friendly_name ?? e.entity_id)}`)
      .join('\n'),
  )
  const all = list ? list.split('\n').map((l) => l.split('\t') as [string, string]) : []
  const chip = (on: boolean) =>
    `flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-left text-[12.5px] touch-manipulation pointer-coarse:min-h-11 ${on ? 'bg-brand text-white' : 'bg-surface-2 text-ink hover:bg-line'}`
  return (
    <div className="grid gap-3" data-weather-picker>
      {all.length > 1 && (
        <div className="grid gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{t('Weather entity')}</p>
          {all.map(([id, name]) => {
            const on = (w.entity?.entity_id ?? null) === id
            return (
              <button
                key={id}
                type="button"
                data-weather-entity={id}
                onClick={() => setEntity(pick === id ? null : id)}
                className="flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-left text-[12.5px] text-ink hover:bg-surface-2"
              >
                <Check size={15} className={`shrink-0 ${on ? 'text-brand' : 'text-transparent'}`} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="truncate font-mono text-[10.5px] text-ink-3">{id}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="grid gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{t('Weather in the scene')}</p>
        <button
          type="button"
          data-weather-sky="auto"
          onClick={() => {
            setPreview(null)
            onPick?.()
          }}
          className={chip(!preview)}
        >
          <SkyIcon sky={haSky ?? 'clear'} night={night} size={16} className="shrink-0" />
          <span className="flex-1">{t('Automatic (Home Assistant)')}</span>
          <span className="text-[11px] opacity-75">{haSky ? skyLabel(haSky) : t('no entity')}</span>
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          {SKIES.map((s) => {
            return (
              <button
                key={s}
                type="button"
                data-weather-sky={s}
                onClick={() => {
                  setPreview(preview === s ? null : s)
                  onPick?.()
                }}
                className={chip(preview === s)}
              >
                <SkyIcon sky={s} night={night} size={16} className="shrink-0" />
                <span className="truncate">{skyLabel(s)}</span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] leading-snug text-ink-3">{t('A preview is independent of Home Assistant and lasts only for this session. On Automatic the scene changes with the weather in Home Assistant.')}</p>
      </div>
    </div>
  )
}

export function WeatherTile() {
  const w = useWeather()
  const night = useNight()
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
  const label = skyLabel(w.sky)
  // Without a weather entity in Home Assistant (and no preview) the scene stays clear
  const value = w.preview ? label : !w.entity ? '-' : w.temperature != null ? `${Math.round(w.temperature)}${w.unit}` : label
  const sub = w.preview ? t('preview') : !w.entity ? t('no entity in HA, preview') : w.temperature != null ? label : 'Home Assistant'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id="kpi-weather"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={t('Weather: the scene follows the weather in Home Assistant')}
        className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-3 text-left xl:gap-3 xl:py-2.5 xl:pl-2.5 xl:pr-4"
      >
        <div className={`grid size-9 place-items-center rounded-xl xl:size-11 ${w.preview ? 'bg-brand text-white' : 'icon-tile'}`}>
          <SkyIcon sky={w.sky} night={night} className="size-[18px] xl:size-5" strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <p className="text-[12px] font-medium text-ink-2">{t('Weather')}</p>
          <p className="font-mono text-[16px] font-semibold tabular-nums xl:text-[19px]">{value}</p>
          <p className="hidden text-[11px] text-ink-3 xl:block">{sub}</p>
        </div>
      </button>
      {open && (
        <div className="glass absolute left-0 top-[calc(100%+8px)] w-[340px] max-w-[calc(100vw-32px)] rounded-2xl p-3" role="dialog" aria-label={t('Weather')}>
          <WeatherPicker />
        </div>
      )}
    </div>
  )
}
