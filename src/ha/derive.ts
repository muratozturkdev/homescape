import { formatNumber, t, tn } from '@/i18n'
import type { HassEntity } from './types'

/* Pure helpers that derive visuals and text from an entity state. Used by both the scene and the UI. */

export const domainOf = (entityId: string) => entityId.split('.')[0]

export function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export function friendlyName(e?: HassEntity) {
  const n = e?.attributes.friendly_name
  return typeof n === 'string' ? n.trim() : (e?.entity_id ?? '')
}

export function isUnavailable(e?: HassEntity) {
  return !e || e.state === 'unavailable' || e.state === 'unknown'
}

/** Is the device "running / on / triggered"? */
export function isActive(e?: HassEntity): boolean {
  if (!e || isUnavailable(e)) return false
  switch (domainOf(e.entity_id)) {
    case 'media_player':
      return !['off', 'standby'].includes(e.state)
    case 'climate':
      return e.state !== 'off'
    case 'cover':
      return e.state === 'open' || e.state === 'opening'
    case 'lock':
      return e.state === 'unlocked' || e.state === 'open'
    case 'alarm_control_panel':
      return e.state !== 'disarmed'
    case 'vacuum':
      return e.state === 'cleaning' || e.state === 'returning'
    case 'lawn_mower':
      return e.state === 'mowing' || e.state === 'returning'
    case 'valve':
      return e.state === 'open' || e.state === 'opening'
    case 'water_heater':
      return e.state !== 'off'
    case 'camera':
      return e.state === 'recording' || e.state === 'streaming'
    case 'device_tracker':
    case 'person':
      return e.state === 'home'
    case 'sensor':
      return true
    default:
      return e.state === 'on'
  }
}

/** Light intensity 0-1 (0 when off). 1 when on without brightness info. */
export function lightLevel(e?: HassEntity) {
  if (!isActive(e)) return 0
  const b = num(e!.attributes.brightness)
  return b == null ? 1 : Math.max(0.12, b / 255)
}

function hex(r: number, g: number, b: number) {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Approximate RGB from a color temperature (K). */
export function kelvinToHex(k: number) {
  const h = k / 100
  const r = h <= 66 ? 255 : 329.7 * Math.pow(h - 60, -0.1332)
  const g = h <= 66 ? 99.47 * Math.log(h) - 161.12 : 288.12 * Math.pow(h - 60, -0.0755)
  const b = h >= 66 ? 255 : h <= 19 ? 0 : 138.52 * Math.log(h - 10) - 305.04
  return hex(r, g, b)
}

const WARM = '#ffd29a'

/** Visible color of the light. */
export function lightColor(e?: HassEntity) {
  if (!e) return WARM
  const rgb = e.attributes.rgb_color
  if (Array.isArray(rgb) && rgb.length >= 3 && e.attributes.color_mode !== 'color_temp') return hex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]))
  const k = num(e.attributes.color_temp_kelvin)
  if (k) return kelvinToHex(k)
  return WARM
}

const LABELS: Record<string, Record<string, string>> = {
  media_player: { off: t('Off'), on: t('On'), playing: t('Playing'), paused: t('Paused'), idle: t('Idle'), standby: t('Standby'), buffering: t('Buffering') },
  climate: { off: t('Off'), heat: t('Heat'), cool: t('Cool'), heat_cool: t('Auto'), auto: t('Auto'), dry: t('Dry'), fan_only: t('Fan') },
  cover: { open: t('Open'), closed: t('Closed'), opening: t('Opening'), closing: t('Closing') },
  lock: { locked: t('Locked'), unlocked: t('Unlocked'), jammed: t('Jammed'), locking: t('Locking'), unlocking: t('Unlocking'), open: t('Open') },
  alarm_control_panel: {
    disarmed: t('Disarmed'),
    armed_away: t('Armed away'),
    armed_home: t('Armed home'),
    armed_night: t('Armed night'),
    armed_vacation: t('Armed vacation'),
    armed_custom_bypass: t('Armed custom'),
    arming: t('Arming'),
    pending: t('Pending'),
    triggered: t('Alarm triggered'),
  },
  vacuum: { cleaning: t('Cleaning'), docked: t('Docked'), returning: t('Returning to dock'), idle: t('Idle'), paused: t('Paused'), error: t('Error') },
  lawn_mower: { mowing: t('Mowing'), docked: t('Docked'), returning: t('Returning to dock'), paused: t('Paused'), error: t('Error') },
  valve: { open: t('Open'), closed: t('Closed'), opening: t('Opening'), closing: t('Closing') },
  water_heater: { off: t('Off'), eco: t('Eco'), electric: t('Electric'), gas: t('Gas'), heat_pump: t('Heat pump'), high_demand: t('High demand'), performance: t('Performance') },
  camera: { idle: t('Idle'), recording: t('Recording'), streaming: t('Live') },
  device_tracker: { home: t('At home'), not_home: t('Away') },
  person: { home: t('At home'), not_home: t('Away') },
}

const OPEN_CLOSED: [string, string] = [t('Open'), t('Closed')]
const ON_OFF: [string, string] = [t('On'), t('Off')]
const BINARY: Record<string, [string, string]> = {
  door: OPEN_CLOSED,
  garage_door: OPEN_CLOSED,
  opening: OPEN_CLOSED,
  window: OPEN_CLOSED,
  motion: [t('Motion detected'), t('No motion')],
  occupancy: [t('Occupied'), t('Unoccupied')],
  presence: [t('Occupied'), t('Unoccupied')],
  vibration: [t('Vibration detected'), t('No vibration')],
  smoke: [t('Smoke detected'), t('All clear')],
  gas: [t('Gas detected'), t('All clear')],
  carbon_monoxide: [t('CO detected'), t('All clear')],
  moisture: [t('Water detected'), t('No water')],
  connectivity: [t('Connected'), t('Disconnected')],
  battery_charging: [t('Charging'), t('Not charging')],
  plug: [t('Plugged in'), t('Unplugged')],
  problem: [t('Problem detected'), t('No problem')],
  safety: [t('Unsafe'), t('Safe')],
  tamper: [t('Tampered'), t('Intact')],
  light: [t('Light detected'), t('No light')],
  power: [t('Powered'), t('No power')],
  sound: [t('Sound detected'), t('No sound')],
  running: [t('Running'), t('Stopped')],
}

/** State shown to the user, in the current language */
export function stateLabel(e?: HassEntity) {
  if (!e) return t('Not connected')
  if (e.state === 'unavailable') return t('Unavailable')
  if (e.state === 'unknown') return t('Unknown')
  const d = domainOf(e.entity_id)
  if (d === 'sensor') {
    const unit = typeof e.attributes.unit_of_measurement === 'string' ? e.attributes.unit_of_measurement : ''
    const n = num(e.state)
    return n == null ? e.state : `${formatNumber(n, 1)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`
  }
  if (d === 'binary_sensor') {
    const pair = BINARY[String(e.attributes.device_class)] ?? ON_OFF
    return e.state === 'on' ? pair[0] : pair[1]
  }
  return LABELS[d]?.[e.state] ?? (e.state === 'on' ? ON_OFF[0] : e.state === 'off' ? ON_OFF[1] : e.state)
}

/** Like "3 min ago" */
export function relativeTime(iso?: string) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return t('just now')
  if (s < 3600) return tn(Math.round(s / 60), '{count} min ago', '{count} min ago')
  if (s < 86400) return tn(Math.round(s / 3600), '{count} h ago', '{count} h ago')
  return tn(Math.round(s / 86400), '{count} day ago', '{count} days ago')
}

export function colorModes(e?: HassEntity): string[] {
  const m = e?.attributes.supported_color_modes
  return Array.isArray(m) ? (m as string[]) : []
}

export const supportsBrightness = (e?: HassEntity) => colorModes(e).some((m) => m !== 'onoff')
export const supportsColor = (e?: HassEntity) => colorModes(e).some((m) => ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(m))
export const supportsColorTemp = (e?: HassEntity) => colorModes(e).includes('color_temp')

/* ---------- role: what an entity means on an item (read from Home Assistant, the user does not classify it) ---------- */

const DC_LABEL: Record<string, string> = {
  temperature: t('Temperature'),
  humidity: t('Humidity'),
  power: t('Power'),
  energy: t('Energy'),
  battery: t('Battery'),
  illuminance: t('Light level'),
  carbon_dioxide: 'CO₂',
  pm25: 'PM2.5',
  voltage: t('Voltage'),
  current: t('Electric current'),
  pressure: t('Pressure'),
  door: t('Door'),
  window: t('Window'),
  opening: t('Contact'),
  garage_door: t('Garage door'),
  motion: t('Motion'),
  occupancy: t('Occupancy'),
  presence: t('Presence'),
  vibration: t('Vibration'),
  moisture: t('Water leak'),
  smoke: t('Smoke'),
  gas: t('Gas'),
  plug: t('Plug'),
  connectivity: t('Connectivity'),
}

const DOMAIN_LABEL: Record<string, string> = {
  light: t('Light'),
  switch: t('Switch'),
  climate: t('Climate'),
  media_player: t('Media'),
  cover: t('Cover'),
  lock: t('Lock'),
  fan: t('Fan'),
  humidifier: t('Humidifier'),
  vacuum: t('Vacuum'),
  camera: t('Camera'),
  alarm_control_panel: t('Alarm'),
  sensor: t('Sensor'),
  binary_sensor: t('Sensor'),
  input_boolean: t('Helper'),
  button: t('Button'),
  input_button: t('Button'),
  scene: t('Scene'),
  script: t('Script'),
  automation: t('Automation'),
  number: t('Number'),
  select: t('Selection'),
  person: t('Person'),
  device_tracker: t('Location'),
  weather: t('Weather'),
  remote: t('Remote'),
  siren: t('Siren'),
  valve: t('Valve'),
  water_heater: t('Water heater'),
}

/** Name of the entity's kind: the device_class first (Temperature, Humidity, Power...), else the domain */
export function roleLabel(e?: HassEntity) {
  if (!e) return ''
  const dc = String(e.attributes.device_class ?? '')
  return DC_LABEL[dc] ?? DOMAIN_LABEL[domainOf(e.entity_id)] ?? domainOf(e.entity_id)
}

/** Is it a read-only value (sensor, binary sensor, weather, person...)? */
export function isReading(e?: HassEntity) {
  if (!e) return false
  return ['sensor', 'binary_sensor', 'weather', 'person', 'device_tracker', 'sun', 'number', 'select', 'input_number', 'input_select', 'input_text', 'update', 'event'].includes(domainOf(e.entity_id))
}

export const deviceClass = (e?: HassEntity) => String(e?.attributes.device_class ?? '')
