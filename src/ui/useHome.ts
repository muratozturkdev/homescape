import { useMemo } from 'react'
import { deviceClass, domainOf, isActive, num } from '@/ha/derive'
import { useHa } from '@/ha/store'
import type { HassEntity } from '@/ha/types'
import { bindingsOf, itemLightIds } from '@/model/bindings'
import { isLightKind } from '@/model/catalog'
import { inRoom } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import type { Item, Room } from '@/model/types'
import { formatNumber } from '@/i18n'

/* Derived home data the UI needs: room statistics, counters */

export interface RoomStats {
  temp: number | null
  humidity: number | null
  lightsOn: number
  lights: number
  lightEntities: HassEntity[]
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

const inRoomItem = (r: Room, it: Item) => inRoom(r, it.x, it.z)

export function useRoomStats(): Record<string, RoomStats> {
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  const registry = useHa((s) => s.registry)

  return useMemo(() => {
    const out: Record<string, RoomStats> = {}
    if (!level) return out
    const byArea = new Map<string, HassEntity[]>()
    if (registry) {
      for (const [id, area] of Object.entries(registry.entityArea)) {
        if (!area || !entities[id]) continue
        if (!byArea.has(area)) byArea.set(area, [])
        byArea.get(area)!.push(entities[id])
      }
    }
    for (const r of level.rooms) {
      const areaEnts = (r.areaId && byArea.get(r.areaId)) || []
      const items = level.items.filter((it) => inRoomItem(r, it))
      // All entities bound to the items in the room (main + extras) and the entities in the room's HA area
      const itemEnts = items.flatMap(bindingsOf).map((id) => entities[id]).filter((e): e is HassEntity => Boolean(e))
      const pool = [...new Set([...areaEnts, ...itemEnts])]
      const reading = (dc: string) =>
        pool
          .filter((e) => e.attributes.device_class === dc && e.entity_id.startsWith('sensor.'))
          .map((e) => num(e.state))
          .filter((n): n is number => n != null)
      const temps = reading('temperature')
      const hums = reading('humidity')
      // Lamps and lights bound to items (headboard, counter LED, TV backlight...)
      const lightEntities = [...new Set(items.flatMap(itemLightIds))].map((id) => entities[id]).filter((e): e is HassEntity => Boolean(e))
      out[r.id] = {
        temp: avg(temps),
        humidity: avg(hums),
        lights: lightEntities.length,
        lightsOn: lightEntities.filter(isActive).length,
        lightEntities,
      }
    }
    return out
  }, [level, entities, registry])
}

export interface HomeTotals {
  lightsOn: number
  lights: number
  avgTemp: number | null
  openings: number
  devicesOn: number
}

export function useHomeTotals(stats: Record<string, RoomStats>): HomeTotals {
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  return useMemo(() => {
    const items = level?.items ?? []
    const bound = items.filter((it) => it.entityId && entities[it.entityId])
    const st = Object.values(stats)
    // A door / window is open when its bound door / window sensor or door / window type cover (garage, garden gate) is open.
    // An open curtain, blind or shade (cover: curtain, blind, shade, shutter, awning) does not count as an open window.
    const isOpening = (e?: HassEntity) =>
      Boolean(e) &&
      ((domainOf(e!.entity_id) === 'cover' && ['door', 'garage', 'gate', 'window'].includes(deviceClass(e))) || (domainOf(e!.entity_id) === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e)))) &&
      isActive(e)
    return {
      lights: st.reduce((a, s) => a + s.lights, 0),
      lightsOn: st.reduce((a, s) => a + s.lightsOn, 0),
      avgTemp: avg(st.map((s) => s.temp).filter((n): n is number => n != null)),
      openings: items.filter((it) => ['door', 'window', 'garageDoor', 'gate'].includes(it.kind) && bindingsOf(it).some((id) => isOpening(entities[id]))).length,
      devicesOn: bound.filter((it) => !isLightKind(it.kind) && ['switch', 'media_player', 'climate', 'fan', 'humidifier', 'vacuum', 'lawn_mower', 'water_heater', 'valve', 'siren'].includes(it.entityId!.split('.')[0]) && isActive(entities[it.entityId!])).length,
    }
  }, [level, entities, stats])
}

/** Number with a fixed number of decimals for display; '-' when missing */
export const fmt = (n: number | null, digits = 1) => formatNumber(n, digits, digits)
