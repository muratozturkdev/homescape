import { domainOf, isActive } from './derive'
import { useHa } from './store'
import type { HassEntity } from './types'

/* Domain-aware commands called by the UI. All of them go to the active source (demo or live). */

const call = (domain: string, service: string, data: Record<string, unknown>) => useHa.getState().call(domain, service, data)

/** Domains that can be controlled with a single button. Others (sensor, number, select...) are only shown. */
const ACTIONABLE = [
  'light',
  'switch',
  'fan',
  'humidifier',
  'media_player',
  'cover',
  'lock',
  'climate',
  'vacuum',
  'alarm_control_panel',
  'input_boolean',
  'automation',
  'siren',
  'valve',
  'water_heater',
  'remote',
  'lawn_mower',
  'button',
  'input_button',
  'scene',
  'script',
]

/** Domains that run once per press and have no on/off state. */
export const MOMENTARY = ['button', 'input_button', 'scene', 'script']

export function canToggle(e?: HassEntity) {
  if (!e || e.state === 'unavailable') return false
  return ACTIONABLE.includes(domainOf(e.entity_id))
}

export function toggle(e: HassEntity) {
  const entity_id = e.entity_id
  const d = domainOf(entity_id)
  switch (d) {
    case 'lock':
      return call('lock', e.state === 'locked' ? 'unlock' : 'lock', { entity_id })
    case 'climate': {
      const modes = Array.isArray(e.attributes.hvac_modes) ? (e.attributes.hvac_modes as string[]) : []
      const onMode = modes.find((m) => m !== 'off') ?? 'heat'
      return call('climate', 'set_hvac_mode', { entity_id, hvac_mode: e.state === 'off' ? onMode : 'off' })
    }
    case 'vacuum':
      return call('vacuum', isActive(e) ? 'return_to_base' : 'start', { entity_id })
    case 'lawn_mower':
      return call('lawn_mower', isActive(e) ? 'dock' : 'start_mowing', { entity_id })
    case 'water_heater':
      return call('water_heater', e.state === 'off' ? 'turn_on' : 'turn_off', { entity_id })
    case 'cover':
      // Garage door, garden gate, curtain: close if open or opening, otherwise open
      return call('cover', isActive(e) ? 'close_cover' : 'open_cover', { entity_id })
    case 'alarm_control_panel':
      return call('alarm_control_panel', e.state === 'disarmed' ? 'alarm_arm_away' : 'alarm_disarm', { entity_id })
    case 'button':
    case 'input_button':
      return call(d, 'press', { entity_id })
    case 'scene':
    case 'script':
      return call(d, 'turn_on', { entity_id })
    default:
      // light, switch, fan, humidifier, media_player, cover, input_boolean
      return call(d, 'toggle', { entity_id })
  }
}

export const setBrightness = (e: HassEntity, pct: number) => call('light', 'turn_on', { entity_id: e.entity_id, brightness_pct: Math.round(pct) })
export const setRgb = (e: HassEntity, rgb: [number, number, number]) => call('light', 'turn_on', { entity_id: e.entity_id, rgb_color: rgb })
export const setKelvin = (e: HassEntity, k: number) => call('light', 'turn_on', { entity_id: e.entity_id, color_temp_kelvin: k })
export const setTemperature = (e: HassEntity, t: number) => call('climate', 'set_temperature', { entity_id: e.entity_id, temperature: t })
export const setHvacMode = (e: HassEntity, mode: string) => call('climate', 'set_hvac_mode', { entity_id: e.entity_id, hvac_mode: mode })
export const setCoverPosition = (e: HassEntity, p: number) => call('cover', 'set_cover_position', { entity_id: e.entity_id, position: Math.round(p) })
/** Blind slat tilt (%; 100 = slats horizontal, open). */
export const setCoverTilt = (e: HassEntity, p: number) => call('cover', 'set_cover_tilt_position', { entity_id: e.entity_id, tilt_position: Math.round(p) })
export const mediaPlayPause = (e: HassEntity) => call('media_player', 'media_play_pause', { entity_id: e.entity_id })
/** Volume (%; Home Assistant expects 0-1). */
export const setVolume = (e: HassEntity, pct: number) => call('media_player', 'volume_set', { entity_id: e.entity_id, volume_level: Math.round(pct) / 100 })
export type AlarmService = 'alarm_arm_away' | 'alarm_arm_home' | 'alarm_arm_night' | 'alarm_arm_vacation' | 'alarm_arm_custom_bypass' | 'alarm_disarm' | 'alarm_trigger'
/** Alarm mode; on a panel that requires a code, the code is sent too. */
export const alarmAction = (e: HassEntity, service: AlarmService, code?: string) =>
  call('alarm_control_panel', service, { entity_id: e.entity_id, ...(code ? { code } : {}) })

/* Climate: fan, swing, preset and two-sided target (heat-cool). Home Assistant climate.set_* services. */
export const setFanMode = (e: HassEntity, fan_mode: string) => call('climate', 'set_fan_mode', { entity_id: e.entity_id, fan_mode })
export const setSwingMode = (e: HassEntity, swing_mode: string) => call('climate', 'set_swing_mode', { entity_id: e.entity_id, swing_mode })
export const setPresetMode = (e: HassEntity, preset_mode: string) => call('climate', 'set_preset_mode', { entity_id: e.entity_id, preset_mode })
export const setTempRange = (e: HassEntity, low: number, high: number) => call('climate', 'set_temperature', { entity_id: e.entity_id, target_temp_low: low, target_temp_high: high })

/* Detailed commands for fan, humidifier, water heater, valve, cover and media (dashboard and card). */
export const setFanPercentage = (e: HassEntity, pct: number) => call('fan', 'set_percentage', { entity_id: e.entity_id, percentage: Math.round(pct) })
export const setFanOscillate = (e: HassEntity, on: boolean) => call('fan', 'oscillate', { entity_id: e.entity_id, oscillating: on })
export const setFanPreset = (e: HassEntity, preset_mode: string) => call('fan', 'set_preset_mode', { entity_id: e.entity_id, preset_mode })
export const setHumidity = (e: HassEntity, humidity: number) => call('humidifier', 'set_humidity', { entity_id: e.entity_id, humidity: Math.round(humidity) })
export const setHumidifierMode = (e: HassEntity, mode: string) => call('humidifier', 'set_mode', { entity_id: e.entity_id, mode })
export const setWaterTemp = (e: HassEntity, temperature: number) => call('water_heater', 'set_temperature', { entity_id: e.entity_id, temperature })
export const setWaterMode = (e: HassEntity, operation_mode: string) => call('water_heater', 'set_operation_mode', { entity_id: e.entity_id, operation_mode })
export const setValvePosition = (e: HassEntity, p: number) => call('valve', 'set_valve_position', { entity_id: e.entity_id, position: Math.round(p) })
export const coverCommand = (e: HassEntity, cmd: 'open_cover' | 'close_cover' | 'stop_cover') => call('cover', cmd, { entity_id: e.entity_id })
export const mediaCommand = (e: HassEntity, cmd: 'media_next_track' | 'media_previous_track' | 'volume_mute') =>
  call('media_player', cmd, cmd === 'volume_mute' ? { entity_id: e.entity_id, is_volume_muted: !e.attributes.is_volume_muted } : { entity_id: e.entity_id })
export const selectSource = (e: HassEntity, source: string) => call('media_player', 'select_source', { entity_id: e.entity_id, source })
export const vacuumCommand = (e: HassEntity, cmd: 'start' | 'pause' | 'return_to_base' | 'locate') => call('vacuum', cmd, { entity_id: e.entity_id })
export const mowerCommand = (e: HassEntity, cmd: 'start_mowing' | 'pause' | 'dock') => call('lawn_mower', cmd, { entity_id: e.entity_id })
export const setNumber = (e: HassEntity, value: number) => call(e.entity_id.split('.')[0], 'set_value', { entity_id: e.entity_id, value })
export const selectOption = (e: HassEntity, option: string) => call(e.entity_id.split('.')[0], 'select_option', { entity_id: e.entity_id, option })

/** Turns off all the given entities that are on (e.g. every light in a room). */
export function turnOffAll(entities: HassEntity[]) {
  for (const e of entities) if (isActive(e)) void toggle(e)
}
