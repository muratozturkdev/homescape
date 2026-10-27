import type { Entities, HaSnapshot, HaSource, HassEntity } from './types'

/*
 * Demo source: starts with the states of the snapshot, applies service calls locally the way HA would and now and then
 * triggers sensors so the scene looks alive. It never touches a real home.
 */

type Data = Record<string, unknown>

const ON_OFF_DOMAINS = ['light', 'switch', 'fan', 'humidifier', 'input_boolean']

function ids(data: Data): string[] {
  const v = data.entity_id
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

/*
 * Entities of the sample homes (demo/demoHomes.ts, the American house): present in the demo source only while that home is
 * open, so they do not crowd the "not connected devices" list and the counters of other homes. They come first in the list:
 * the first alarm and the first weather are the sample home's. The live source never sees them.
 */
let extras: HassEntity[] = []
const extraHooks = new Set<() => void>()

/** Puts the sample home's entities into the demo source or removes them (empty list); existing ones keep their state. */
export function setDemoExtras(list: HassEntity[]) {
  extras = list
  extraHooks.forEach((fn) => fn())
}

/** Whether the sample home's entities are present (for the local simulation layer on a live connection; ha/store.ts) */
export const hasDemoExtras = () => extras.length > 0
/** Whether the entity belongs to the sample home */
export const isDemoExtra = (id: string) => extras.some((e) => e.entity_id === id)

/** Notifies when the sample home's entities change (ha/store.ts); returns an unsubscribe function */
export function onDemoExtras(fn: () => void) {
  extraHooks.add(fn)
  return () => {
    extraHooks.delete(fn)
  }
}

export function createDemoSource(snapshot: HaSnapshot): HaSource {
  let entities: Entities = Object.fromEntries(
    snapshot.entities.map(({ entity_id, state, attributes, last_changed }) => [entity_id, { entity_id, state, attributes, last_changed }]),
  )
  const listeners = new Set<(e: Entities) => void>()
  const emit = () => listeners.forEach((l) => l(entities))
  // Sample home entities first (they keep their state), then the others; entities dropped from the list are removed
  let extraIds = new Set<string>()
  const applyExtras = () => {
    const next: Entities = {}
    for (const e of extras) next[e.entity_id] = entities[e.entity_id] ?? { ...e }
    for (const [id, e] of Object.entries(entities)) if (!extraIds.has(id) && !(id in next)) next[id] = e
    extraIds = new Set(extras.map((e) => e.entity_id))
    entities = next
  }
  applyExtras()
  const onExtras = () => {
    applyExtras()
    emit()
  }
  extraHooks.add(onExtras)

  const patch = (id: string, state?: string, attrs?: Data) => {
    const prev = entities[id]
    if (!prev) return
    const next: HassEntity = {
      ...prev,
      state: state ?? prev.state,
      attributes: { ...prev.attributes, ...(attrs ?? {}) },
      last_changed: state && state !== prev.state ? new Date().toISOString() : prev.last_changed,
    }
    entities = { ...entities, [id]: next }
  }

  const apply = (domain: string, service: string, data: Data) => {
    for (const id of ids(data)) {
      const e = entities[id]
      if (!e) continue
      const d = id.split('.')[0]
      if (service === 'toggle') {
        if (d === 'media_player') patch(id, e.state === 'off' ? 'on' : 'off')
        else if (d === 'cover' || d === 'valve') patch(id, e.state === 'open' ? 'closed' : 'open', { current_position: e.state === 'open' ? 0 : 100 })
        else patch(id, e.state === 'on' ? 'off' : 'on')
      } else if (service === 'turn_on') {
        const attrs: Data = {}
        if (typeof data.brightness_pct === 'number') attrs.brightness = Math.round((data.brightness_pct as number) * 2.55)
        else if (d === 'light' && e.attributes.brightness == null) attrs.brightness = 255
        if (Array.isArray(data.rgb_color)) Object.assign(attrs, { rgb_color: data.rgb_color, color_mode: 'rgb' })
        if (typeof data.color_temp_kelvin === 'number') Object.assign(attrs, { color_temp_kelvin: data.color_temp_kelvin, color_mode: 'color_temp', rgb_color: null })
        // A water heater turned on switches to its operating mode (eco); everything else to "on"
        patch(id, d === 'water_heater' ? 'eco' : 'on', attrs)
      } else if (service === 'turn_off') {
        patch(id, 'off')
      } else if (domain === 'media_player' && service === 'media_play_pause') {
        patch(id, e.state === 'playing' ? 'paused' : 'playing', e.attributes.volume_level == null ? { volume_level: 0.4 } : undefined)
      } else if (domain === 'media_player' && service === 'volume_set') {
        patch(id, undefined, { volume_level: Number(data.volume_level) })
      } else if (domain === 'climate' && service === 'set_hvac_mode') {
        const mode = String(data.hvac_mode)
        patch(id, mode, { hvac_action: mode === 'off' ? 'off' : mode === 'cool' ? 'cooling' : 'heating' })
      } else if (domain === 'climate' && service === 'set_temperature') {
        if (data.target_temp_low != null) patch(id, undefined, { target_temp_low: data.target_temp_low, target_temp_high: data.target_temp_high })
        else {
          // When heating, it heats if the target is above the room temperature, else idles (demo)
          const cur = Number(e.attributes.current_temperature)
          const t = Number(data.temperature)
          const act = e.state === 'heat' ? (t > cur ? 'heating' : 'idle') : e.state === 'cool' ? (t < cur ? 'cooling' : 'idle') : e.attributes.hvac_action
          patch(id, undefined, { temperature: t, hvac_action: act })
        }
      } else if (domain === 'climate' && (service === 'set_fan_mode' || service === 'set_swing_mode' || service === 'set_preset_mode')) {
        const key = service.replace('set_', '')
        patch(id, undefined, { [key]: data[key] })
      } else if (domain === 'cover') {
        if (service === 'open_cover') patch(id, 'open', { current_position: 100 })
        if (service === 'close_cover') patch(id, 'closed', { current_position: 0 })
        if (service === 'set_cover_position') {
          const p = Number(data.position)
          patch(id, p > 0 ? 'open' : 'closed', { current_position: p })
        }
        if (service === 'set_cover_tilt_position') patch(id, undefined, { current_tilt_position: Number(data.tilt_position) })
      } else if (domain === 'lock') {
        patch(id, service === 'lock' ? 'locked' : 'unlocked')
      } else if (domain === 'alarm_control_panel') {
        const map: Record<string, string> = { alarm_arm_away: 'armed_away', alarm_arm_home: 'armed_home', alarm_arm_night: 'armed_night', alarm_arm_vacation: 'armed_vacation', alarm_arm_custom_bypass: 'armed_custom_bypass', alarm_disarm: 'disarmed', alarm_trigger: 'triggered' }
        if (map[service]) patch(id, map[service])
      } else if (domain === 'vacuum') {
        const map: Record<string, string> = { start: 'cleaning', pause: 'paused', return_to_base: 'docked', stop: 'idle' }
        if (map[service]) patch(id, map[service])
      } else if (domain === 'humidifier' && service === 'set_mode') {
        patch(id, undefined, { mode: data.mode })
      } else if (domain === 'fan' && service === 'set_percentage') {
        patch(id, Number(data.percentage) > 0 ? 'on' : 'off', { percentage: data.percentage })
      } else if (domain === 'fan' && service === 'oscillate') {
        patch(id, undefined, { oscillating: Boolean(data.oscillating) })
      } else if (domain === 'fan' && service === 'set_preset_mode') {
        patch(id, 'on', { preset_mode: data.preset_mode })
      } else if (domain === 'humidifier' && service === 'set_humidity') {
        patch(id, undefined, { humidity: Number(data.humidity) })
      } else if (domain === 'lawn_mower') {
        const map: Record<string, string> = { start_mowing: 'mowing', pause: 'paused', dock: 'docked' }
        if (map[service]) patch(id, map[service])
      } else if (domain === 'valve') {
        if (service === 'open_valve') patch(id, 'open', { current_position: 100 })
        if (service === 'close_valve') patch(id, 'closed', { current_position: 0 })
        if (service === 'set_valve_position') patch(id, Number(data.position) > 0 ? 'open' : 'closed', { current_position: Number(data.position) })
      } else if (domain === 'water_heater') {
        if (service === 'set_temperature') patch(id, undefined, { temperature: Number(data.temperature) })
        if (service === 'set_operation_mode') patch(id, String(data.operation_mode))
      } else if (domain === 'media_player' && (service === 'media_next_track' || service === 'media_previous_track')) {
        patch(id, 'playing')
      } else if (domain === 'media_player' && service === 'volume_mute') {
        patch(id, undefined, { is_volume_muted: Boolean(data.is_volume_muted) })
      } else if (domain === 'media_player' && service === 'select_source') {
        patch(id, undefined, { source: data.source })
      } else if (service === 'set_value') {
        patch(id, String(data.value))
      } else if (service === 'select_option') {
        patch(id, String(data.option))
      } else if (ON_OFF_DOMAINS.includes(d)) {
        // unknown service: ignore
      }
    }
    emit()
  }

  // Keep the scene alive: now and then a motion/occupancy or door sensor turns "on" briefly (the sample home's too).
  const timers: ReturnType<typeof setTimeout>[] = []
  const pulse = setInterval(() => {
    const lively = Object.values(entities).filter((e) => {
      const dc = e.attributes.device_class
      return e.entity_id.startsWith('binary_sensor.') && (dc === 'motion' || dc === 'occupancy' || dc === 'door' || dc === 'opening')
    })
    if (!lively.length || document.hidden) return
    const e = lively[Math.floor(Math.random() * lively.length)]
    if (entities[e.entity_id]?.state === 'unavailable') return
    patch(e.entity_id, 'on')
    emit()
    timers.push(
      setTimeout(() => {
        patch(e.entity_id, 'off')
        emit()
      }, 5000),
    )
  }, 14000)

  return {
    kind: 'demo',
    label: 'Demo',
    subscribe(cb) {
      listeners.add(cb)
      cb(entities)
      return () => listeners.delete(cb)
    },
    async callService(domain, service, data) {
      apply(domain, service, data)
    },
    inject(e) {
      entities = { ...entities, [e.entity_id]: e }
      emit()
    },
    async registry() {
      return {
        areas: snapshot.areas,
        entityArea: Object.fromEntries(snapshot.entities.map((e) => [e.entity_id, e.area_id])),
        skip: [],
        entityModel: Object.fromEntries(snapshot.entities.flatMap((e) => (e.device_model ? [[e.entity_id, e.device_model]] : []))),
      }
    },
    close() {
      clearInterval(pulse)
      timers.forEach(clearTimeout)
      listeners.clear()
      extraHooks.delete(onExtras)
    },
  }
}
