import type { DashboardLayout } from './types'

/*
 * Arranging the Dashboard (ui/Dashboard.tsx): pure helpers over DashboardLayout (model/types.ts). Orders only list what
 * the user moved; anything new (a room drawn later, a device bound later) keeps its default place at the end, so the saved
 * layout never hides or drops content by itself.
 */

export const roomKey = (id: string) => `room:${id}`

/** The keys in the saved order; keys missing from it follow in their given order */
export function arrange(keys: string[], order: string[] | undefined): string[] {
  if (!order?.length) return keys
  const at = new Map(order.map((k, i) => [k, i]))
  return keys
    .map((k, i) => ({ k, i, o: at.get(k) ?? Infinity }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((x) => x.k)
}

/** The global order with one section's keys replaced by their new order (sections are arranged separately) */
const merge = (order: string[] | undefined, section: string[], next: string[]) => [...(order ?? []).filter((k) => !section.includes(k)), ...next]

/** Moves `key` one place earlier (-1) or later (+1) among `keys` (the section in its current arrangement) */
export function step(order: string[] | undefined, keys: string[], key: string, dir: -1 | 1): string[] {
  const list = arrange(keys, order)
  const i = list.indexOf(key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return order ?? []
  ;[list[i], list[j]] = [list[j], list[i]]
  return merge(order, keys, list)
}

/** Puts `key` at the place of `target` (dragged and dropped): before it when moving up, after it when moving down */
export function place(order: string[] | undefined, keys: string[], key: string, target: string): string[] {
  const list = arrange(keys, order)
  const from = list.indexOf(key)
  const to = list.indexOf(target)
  if (from < 0 || to < 0 || from === to) return order ?? []
  list.splice(from, 1)
  list.splice(to, 0, key)
  return merge(order, keys, list)
}

const toggleIn = (list: string[] | undefined, key: string) => (list?.includes(key) ? list.filter((k) => k !== key) : [...(list ?? []), key])

export const isHidden = (d: DashboardLayout | undefined, key: string) => Boolean(d?.hidden?.includes(key))
export const toggleHidden = (d: DashboardLayout, key: string): DashboardLayout => ({ ...d, hidden: toggleIn(d.hidden, key) })

export const isRowHidden = (d: DashboardLayout | undefined, card: string, row: string) => Boolean(d?.rows?.[card]?.hidden?.includes(row))
export const rowOrder = (d: DashboardLayout | undefined, card: string) => d?.rows?.[card]?.order
const withRows = (d: DashboardLayout, card: string, patch: { order?: string[]; hidden?: string[] }): DashboardLayout => ({ ...d, rows: { ...d.rows, [card]: { ...d.rows?.[card], ...patch } } })
export const toggleRow = (d: DashboardLayout, card: string, row: string) => withRows(d, card, { hidden: toggleIn(d.rows?.[card]?.hidden, row) })
export const stepRow = (d: DashboardLayout, card: string, rows: string[], row: string, dir: -1 | 1) => withRows(d, card, { order: step(d.rows?.[card]?.order, rows, row, dir) })

export const isPinned = (d: DashboardLayout | undefined, entityId: string) => Boolean(d?.favorites?.includes(entityId))
export const togglePin = (d: DashboardLayout, entityId: string): DashboardLayout => ({ ...d, favorites: toggleIn(d.favorites, entityId) })
export function stepPin(d: DashboardLayout, entityId: string, dir: -1 | 1): DashboardLayout {
  const list = [...(d.favorites ?? [])]
  const i = list.indexOf(entityId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return d
  ;[list[i], list[j]] = [list[j], list[i]]
  return { ...d, favorites: list }
}

/** True when the layout has nothing left to keep (it is then removed from the plan) */
export const isDefault = (d: DashboardLayout) => !d.order?.length && !d.hidden?.length && !d.favorites?.length && !Object.values(d.rows ?? {}).some((r) => r.order?.length || r.hidden?.length)
