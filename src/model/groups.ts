import { tn } from '@/i18n'
import { isLightKind } from './catalog'
import type { Item, ItemKind } from './types'

/*
 * Item groups (Item.group). Light groups (grouped lights bind to the same entity) and heating groups: boiler, radiators,
 * towel warmer and thermostat. Once grouped, all of them bind to the same main and extra entities; an entity later bound
 * to, removed from or made main on one member applies to all (layoutStore). State comes from the entity, so they switch
 * together, and the radiators warm up while the boiler heats. A group holds one family only (no light with a radiator).
 */

export type GroupFamily = 'light' | 'heating'

/** Heating family: parts of central heating (boiler first: the group's binding is taken from it) */
export const HEATING: ItemKind[] = ['boiler', 'radiator', 'towelWarmer', 'thermostat']

/** Family the item can be grouped in; null if it cannot be grouped. */
export function groupFamily(kind: ItemKind): GroupFamily | null {
  if (isLightKind(kind)) return 'light'
  return HEATING.includes(kind) ? 'heating' : null
}

/** Summary of a heating group: "1 boiler, 3 radiators" (towel warmers and thermostats count too). */
export function heatingSummary(items: Pick<Item, 'kind'>[]) {
  const n = (k: ItemKind) => items.filter((i) => i.kind === k).length
  const parts: [number, (c: number) => string][] = [
    [n('boiler'), (c) => tn(c, '{count} boiler', '{count} boilers')],
    [n('radiator'), (c) => tn(c, '{count} radiator', '{count} radiators')],
    [n('towelWarmer'), (c) => tn(c, '{count} towel warmer', '{count} towel warmers')],
    [n('thermostat'), (c) => tn(c, '{count} thermostat', '{count} thermostats')],
  ]
  return parts
    .filter(([c]) => c > 0)
    .map(([c, w]) => w(c))
    .join(', ')
}

/** Ids of the item's group mates (itself included); only itself when not grouped. */
export function groupMates(items: Item[], id: string): string[] {
  const it = items.find((i) => i.id === id)
  if (!it?.group) return [id]
  return items.filter((i) => i.group === it.group).map((i) => i.id)
}

/** Clears the mark of groups left with a single member (after ungrouping or deleting). */
export function dropLoneGroups(items: Item[]): Item[] {
  const count = new Map<string, number>()
  for (const i of items) if (i.group) count.set(i.group, (count.get(i.group) ?? 0) + 1)
  if (![...count.values()].some((n) => n < 2)) return items
  return items.map((i) => (i.group && (count.get(i.group) ?? 0) < 2 ? { ...i, group: undefined } : i))
}
