import { t } from '@/i18n'
import { isLightKind } from './catalog'
import type { Item, ItemKind } from './types'

/*
 * Item ↔ Home Assistant bindings. Items are independent of HA; the user binds as many entities to an item as they like.
 * The first is the "main" entity (3D look + main control), the others add information and controls.
 */

/** All entities bound to the item: the main one first, then the extras (no duplicates). */
export function bindingsOf(item: Item): string[] {
  const out: string[] = []
  if (item.entityId) out.push(item.entityId)
  for (const id of item.extras ?? []) if (!out.includes(id)) out.push(id)
  return out
}

export const isBound = (item: Item) => Boolean(item.entityId) || (item.extras?.length ?? 0) > 0

/** Whether the entity is bound to any item in the plan. */
export const boundAnywhere = (items: Item[], id: string) => items.some((it) => it.entityId === id || it.extras?.includes(id))

/**
 * Domains that can be the item's actual device: for a TV what drives the screen (media player, remote, plug), for a
 * diffuser what drives the mist. If the main entity is not one of these (the TV's backlight was bound first), binding the
 * actual device makes it the main one; the light stays as an extra and becomes the LED source (otherwise the screen
 * stayed dark while the TV was on).
 */
const PRIMARY: Partial<Record<ItemKind, string[]>> = {
  tv: ['media_player', 'remote', 'switch'],
  diffuser: ['humidifier', 'switch', 'fan'],
  ceilingFan: ['fan', 'switch'],
  // The boiler's actual device is a climate (heating) or water heater entity; a plug goes to the extras
  boiler: ['climate', 'water_heater'],
  car: ['device_tracker', 'person'],
}
const domain = (id: string) => id.split('.')[0]
const isPrimaryFor = (kind: ItemKind, id: string) => PRIMARY[kind]?.includes(domain(id)) ?? false

/** Bind: becomes the main entity if there is none, else an extra; an actual device replaces a main entity that is not one. */
export function withBinding(item: Item, id: string): Partial<Item> {
  if (bindingsOf(item).includes(id)) return {}
  if (!item.entityId) return { entityId: id }
  if (isPrimaryFor(item.kind, id) && !isPrimaryFor(item.kind, item.entityId)) return { entityId: id, extras: [item.entityId, ...(item.extras ?? [])] }
  return { extras: [...(item.extras ?? []), id] }
}

/** For saved plans (version 5 migration): swaps the main entity with an extra when the extra is the actual device and the main one is not. */
export function primaryFirst(item: Item): Item {
  if (!PRIMARY[item.kind] || !item.entityId || isPrimaryFor(item.kind, item.entityId)) return item
  const better = (item.extras ?? []).find((id) => isPrimaryFor(item.kind, id))
  return better ? { ...item, ...asMain(item, better) } : item
}

/** Unbind: when the main entity is removed, the first extra becomes the main one. */
export function withoutBinding(item: Item, id: string): Partial<Item> {
  // Removing the entity driving the LED sets the LED choice back to automatic
  const led = item.ledEntity === id ? { ledEntity: undefined } : {}
  if (item.entityId === id) {
    const [next, ...rest] = item.extras ?? []
    return { entityId: next ?? null, extras: rest, ...led }
  }
  return { extras: (item.extras ?? []).filter((x) => x !== id), ...led }
}

/** Make an extra the main entity; the old main entity moves to the front of the extras. */
export function asMain(item: Item, id: string): Partial<Item> {
  if (item.entityId === id) return {}
  const extras = (item.extras ?? []).filter((x) => x !== id)
  if (item.entityId) extras.unshift(item.entityId)
  return { entityId: id, extras }
}

/**
 * Entity recognized as a TV backlight from its name (Govee/RGBIC "TV Backlight", Ambilight). Keywords are data: Turkish
 * and English, then common words in the other supported languages.
 */
export const TV_BACKLIGHT =
  /backlight|ambilight|bias ?light|tv[ _-]?arka|arka ?ışık|tv[ _-]?led|hintergrundbeleuchtung|retroilumina|rétroéclairage|retroeclairage|retroillumina|achtergrondverlichting|podświetlenie|podswietlenie|подсветка|バックライト|백라이트|背光|बैकलाइट/i

/**
 * The item's LED option. On a TV without a choice: the backlight counts as on when a light is bound (binding the light is
 * enough, no extra button press), off when "None" was chosen explicitly.
 */
export function ledOf(item: Item): NonNullable<Item['led']> {
  if (item.led) return item.led
  if (item.kind === 'tv' && bindingsOf(item).some((id) => id.startsWith('light.'))) return 'back'
  if (item.kind === 'bed' && ledSource(item)) return 'strip'
  if (item.kind === 'diffuser' && ledSource(item)) return 'strip'
  if (item.kind === 'ceilingFan' && ledSource(item)) return 'under'
  return 'none'
}

/**
 * Entity driving the LED feature: the one chosen on the card (Item.ledEntity), else automatic by kind: the first light on
 * a TV, a light or a switch that looks like a headboard light on a bed, the main entity on a counter (if it is a light or
 * a switch), the first light on a diffuser and a ceiling fan.
 */
export function ledSource(item: Item): string | undefined {
  if (item.ledEntity && bindingsOf(item).includes(item.ledEntity)) return item.ledEntity
  if (item.kind === 'tv' || item.kind === 'diffuser' || item.kind === 'ceilingFan') return bindingsOf(item).find((id) => id.startsWith('light.'))
  if (item.kind === 'bed') return headboardSource(item)
  if (item.kind === 'kitchenCounter') return item.entityId && (item.entityId.startsWith('light.') || item.entityId.startsWith('switch.')) ? item.entityId : undefined
  return undefined
}

/** Tag of the entity driving the LED in the binding rows ("Backlight", "Headboard light", "Counter LED"). */
export function ledTag(item: Item, id: string): string | null {
  if (ledOf(item) === 'none' || ledSource(item) !== id) return null
  if (item.kind === 'tv') return t('Backlight')
  if (item.kind === 'bed') return t('Headboard light')
  if (item.kind === 'kitchenCounter') return t('Counter LED')
  if (item.kind === 'diffuser') return t('Ring light')
  if (item.kind === 'ceilingFan') return t('Fan light')
  return null
}

/** Switch recognized as a headboard light from its entity id (an LED driven by a plug or a relay). Keywords are data. */
export const HEADBOARD = /basl|headboard|led|lamba|isik|light|kopfteil|cabecero|cabeceira|tete_de_lit|testiera|hoofdbord|zaglowek|licht|luz|lumiere|luce|lamp/i

/** Binding that drives the headboard light: a light first, else a switch whose name looks like a headboard light. */
export function headboardSource(item: Item): string | undefined {
  const ids = bindingsOf(item)
  return ids.find((id) => id.startsWith('light.')) ?? ids.find((id) => id.startsWith('switch.') && HEADBOARD.test(id))
}

/**
 * The TV backlight used to be a separate "LED strip" item (the automatic plan put it behind the TV). It is now an option
 * of the TV: a strip right next to the TV (60 cm) bound to a TV backlight is removed, its bindings become extras of the
 * TV and the TV's backlight is turned on.
 */
export function foldTvBacklights(items: Item[]): Item[] {
  const tvs = items.filter((i) => i.kind === 'tv')
  if (!tvs.length) return items
  const drop = new Set<string>()
  const patched = new Map<string, Item>()
  for (const s of items) {
    if (s.kind !== 'ledStrip' || !s.entityId?.startsWith('light.') || !TV_BACKLIGHT.test(`${s.name ?? ''} ${s.entityId}`)) continue
    const tv = tvs.find((t) => Math.hypot(t.x - s.x, t.z - s.z) < 0.6)
    if (!tv) continue
    const cur = patched.get(tv.id) ?? tv
    const extras = [...(cur.extras ?? [])]
    for (const id of bindingsOf(s)) if (id !== cur.entityId && !extras.includes(id)) extras.push(id)
    patched.set(tv.id, { ...cur, extras, led: 'back' })
    drop.add(s.id)
  }
  if (!drop.size) return items
  return items.filter((i) => !drop.has(i.id)).map((i) => patched.get(i.id) ?? i)
}

/** Number of outlets on a power strip (Item.variant '2'...'8', default 5). */
export const socketCount = (item: { variant?: string }) => Math.min(8, Math.max(2, Number(item.variant) || 5))

/** Domains that drive an outlet (each outlet of a smart power strip is a switch). */
export const SOCKET_DOMAINS = ['switch', 'light', 'input_boolean']
export const isSocketEntity = (id: string) => SOCKET_DOMAINS.includes(id.split('.')[0])

/**
 * Which outlet of a power strip a binding drives: switch-like bindings go to outlet 1, 2, ... in binding order. With a
 * single switch bound, all outlets light up with it. null on other items or for entities that are not switches.
 */
export function socketLabel(item: Item, id: string): string | null {
  if (item.kind !== 'powerStrip' || !isSocketEntity(id)) return null
  const ids = bindingsOf(item).filter(isSocketEntity)
  if (ids.length === 1) return t('All outlets')
  const i = ids.indexOf(id)
  return i < socketCount(item) ? t('Outlet {n}', { n: i + 1 }) : t('No outlet left')
}

/** Whether the item lights the room ("Light intensity" slider on the card): lamps, mirror cabinet, counter, bed, TV, diffuser and ceiling fan with the LED on. */
export function emitsLight(item: Item): boolean {
  if (isLightKind(item.kind) || item.kind === 'mirrorCabinet') return true
  if (item.kind === 'kitchenCounter' || item.kind === 'bed' || item.kind === 'tv' || item.kind === 'diffuser' || item.kind === 'ceilingFan') return ledOf(item) !== 'none'
  return false
}

/**
 * The item's bindings that count as lights (room and home light counters, "turn off the room's lights"): lamps, headboard
 * light, counter LED, TV backlight, mirror cabinet and dresser light.
 */
export function itemLightIds(item: Item): string[] {
  if (isLightKind(item.kind)) return item.entityId ? [item.entityId] : []
  const led = ledOf(item)
  if (item.kind === 'bed' || item.kind === 'tv' || item.kind === 'kitchenCounter' || item.kind === 'diffuser' || item.kind === 'ceilingFan') {
    const id = led === 'none' ? undefined : ledSource(item)
    return id ? [id] : []
  }
  const lit = (id?: string | null) => (id && (id.startsWith('light.') || id.startsWith('switch.')) ? [id] : [])
  if (item.kind === 'mirrorCabinet' || item.kind === 'dresser') return lit(item.entityId)
  return []
}
