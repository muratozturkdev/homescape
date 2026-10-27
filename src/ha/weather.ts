import { create } from 'zustand'
import { msg, t } from '@/i18n'
import { num } from './derive'
import { useHa } from './store'
import type { Entities, HassEntity } from './types'

/*
 * Weather. The state of a Home Assistant weather.* entity becomes the weather in the scene (scene/Weather.tsx): rain,
 * downpour, snow, sleet, hail, clouds (the sun dims, the sky turns grey), fog, wind (tilts the precipitation) and
 * lightning. Home Assistant's wind speed and bearing (wind_speed, wind_bearing) tilt the precipitation, and the cloud
 * coverage (cloud_coverage) closes the sky. The sound uses the same weather (audio/SoundScape.tsx). Which entity: the one
 * the user picked, else met.no's forecast_* or one named home, else the first weather.*. Preview (the "Weather" tile in
 * the top row): a weather picked independently of Home Assistant, for this session only, never saved. No three.js here.
 */

export type Sky = 'clear' | 'partly' | 'cloudy' | 'rain' | 'pour' | 'thunder' | 'storm' | 'snow' | 'sleet' | 'hail' | 'fog' | 'wind'

/** Home Assistant weather conditions (the state of a weather entity) */
const SKY_OF: Record<string, Sky> = {
  sunny: 'clear',
  'clear-night': 'clear',
  partlycloudy: 'partly',
  cloudy: 'cloudy',
  exceptional: 'cloudy',
  rainy: 'rain',
  pouring: 'pour',
  lightning: 'thunder',
  'lightning-rainy': 'storm',
  snowy: 'snow',
  'snowy-rainy': 'sleet',
  hail: 'hail',
  fog: 'fog',
  windy: 'wind',
  'windy-variant': 'wind',
}

/** Home Assistant condition for a previewed weather (for code that reads the Home Assistant state, like the sound) */
const STATE_OF: Record<Sky, string> = {
  clear: 'sunny',
  partly: 'partlycloudy',
  cloudy: 'cloudy',
  rain: 'rainy',
  pour: 'pouring',
  thunder: 'lightning',
  storm: 'lightning-rainy',
  snow: 'snowy',
  sleet: 'snowy-rainy',
  hail: 'hail',
  fog: 'fog',
  wind: 'windy',
}

const SKY_LABEL: Record<Sky, string> = {
  clear: msg('Clear'),
  partly: msg('Partly cloudy'),
  cloudy: msg('Cloudy'),
  rain: msg('Rainy'),
  pour: msg('Pouring'),
  thunder: msg('Thunder'),
  storm: msg('Thunderstorm'),
  snow: msg('Snowy'),
  sleet: msg('Sleet'),
  hail: msg('Hail'),
  fog: msg('Foggy'),
  wind: msg('Windy'),
}
/** Name of a weather in the current language */
export const skyLabel = (sky: Sky) => t(SKY_LABEL[sky])
/** Order of the preview list */
export const SKIES: Sky[] = ['clear', 'partly', 'cloudy', 'rain', 'pour', 'storm', 'thunder', 'snow', 'sleet', 'hail', 'fog', 'wind']

/** Effects of a weather in the scene (0-1): rain, snow and hail density, clouds (dim the sun), fog, wind, lightning */
export interface WeatherFx {
  rain: number
  snow: number
  hail: number
  cloud: number
  fog: number
  wind: number
  lightning: boolean
}
const fx = (p: Partial<WeatherFx>): WeatherFx => ({ rain: 0, snow: 0, hail: 0, cloud: 0, fog: 0, wind: 0.1, lightning: false, ...p })
const FX: Record<Sky, WeatherFx> = {
  clear: fx({}),
  partly: fx({ cloud: 0.35 }),
  cloudy: fx({ cloud: 0.75, wind: 0.2 }),
  rain: fx({ rain: 0.5, cloud: 0.85, fog: 0.15, wind: 0.2 }),
  pour: fx({ rain: 1, cloud: 1, fog: 0.3, wind: 0.35 }),
  thunder: fx({ cloud: 0.9, wind: 0.3, lightning: true }),
  storm: fx({ rain: 0.85, cloud: 1, fog: 0.25, wind: 0.65, lightning: true }),
  snow: fx({ snow: 0.75, cloud: 0.8, fog: 0.2, wind: 0.15 }),
  sleet: fx({ rain: 0.35, snow: 0.45, cloud: 0.85, fog: 0.2, wind: 0.25 }),
  hail: fx({ hail: 0.8, rain: 0.3, cloud: 0.9, wind: 0.4 }),
  fog: fx({ fog: 1, cloud: 0.55, wind: 0.05 }),
  wind: fx({ cloud: 0.3, wind: 1 }),
}

const ENTITY_KEY = 'homescape-weather-entity'
const readPick = () => {
  try {
    return localStorage.getItem(ENTITY_KEY)
  } catch {
    return null
  }
}

interface WeatherPref {
  /** Preview: this weather instead of Home Assistant's (session only; null: from Home Assistant) */
  preview: Sky | null
  /** Weather entity picked by the user (null: automatic) */
  entity: string | null
  setPreview: (s: Sky | null) => void
  setEntity: (id: string | null) => void
}
export const useWeatherPref = create<WeatherPref>((set) => ({
  preview: null,
  entity: readPick(),
  setPreview: (preview) => set({ preview }),
  setEntity: (entity) => {
    try {
      if (entity) localStorage.setItem(ENTITY_KEY, entity)
      else localStorage.removeItem(ENTITY_KEY)
    } catch {
      /* storage unavailable */
    }
    set({ entity })
  },
}))

/** Weather entities of the home (listed in the picker) */
export const weatherEntities = (entities: Entities) => Object.values(entities).filter((e) => e.entity_id.startsWith('weather.'))

/** Weather entity to use: the picked one, else met.no's forecast_* or one named home, else the first */
export function weatherEntity(entities: Entities, pick: string | null = useWeatherPref.getState().entity): HassEntity | undefined {
  if (pick && entities[pick]) return entities[pick]
  const all = weatherEntities(entities)
  return all.find((e) => /^weather\.forecast_|\.home$/.test(e.entity_id)) ?? all[0]
}

export interface Weather {
  entity?: HassEntity
  /** Condition in Home Assistant's terms (for a preview, its equivalent); undefined without an entity and a preview */
  state?: string
  sky: Sky
  fx: WeatherFx
  preview: boolean
  temperature: number | null
  unit: string
  /** Wind speed (km/h, if given) */
  windKmh: number | null
  /** Direction the wind comes from (degrees clockwise from north; Home Assistant's wind_bearing, if given) */
  windBearing: number | null
}

/** Current weather: the preview if any, else the Home Assistant weather entity (else clear, no effects) */
export function currentWeather(entities: Entities, pref: Pick<WeatherPref, 'preview' | 'entity'> = useWeatherPref.getState()): Weather {
  const entity = weatherEntity(entities, pref.entity)
  const temperature = num(entity?.attributes.temperature)
  const unit = String(entity?.attributes.temperature_unit ?? '°C')
  const wsUnit = String(entity?.attributes.wind_speed_unit ?? 'km/h')
  const ws = num(entity?.attributes.wind_speed)
  const windKmh = ws == null ? null : wsUnit === 'm/s' ? ws * 3.6 : wsUnit === 'mph' ? ws * 1.609 : ws
  const windBearing = num(entity?.attributes.wind_bearing)
  if (pref.preview) return { entity, state: STATE_OF[pref.preview], sky: pref.preview, fx: FX[pref.preview], preview: true, temperature, unit, windKmh, windBearing }
  const sky = (entity && SKY_OF[entity.state]) || 'clear'
  const base = FX[sky]
  // Home Assistant's wind speed tilts the precipitation too (fully from 45 km/h)
  const wind = windKmh == null ? base.wind : Math.max(base.wind, Math.min(1, windKmh / 45))
  // With a cloud coverage (met.no: cloud_coverage %) the sky closes accordingly; precipitation keeps at least its own clouds
  const cov = num(entity?.attributes.cloud_coverage)
  const precip = base.rain > 0 || base.snow > 0 || base.hail > 0 || base.lightning
  const cloud = cov == null ? base.cloud : precip ? Math.max(base.cloud, Math.min(1, cov / 100)) : Math.min(1, (cov / 100) * 0.85)
  return { entity, state: entity?.state, sky, fx: { ...base, wind, cloud }, preview: false, temperature, unit, windKmh, windBearing }
}

/** For the UI: recomputed when the entity or the preview changes */
export function useWeather(): Weather {
  const pref = useWeatherPref()
  const entity = useHa((s) => weatherEntity(s.entities, pref.entity))
  const entities = entity ? { [entity.entity_id]: entity } : {}
  return currentWeather(entities, { preview: pref.preview, entity: entity?.entity_id ?? null })
}
