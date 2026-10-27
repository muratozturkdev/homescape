import { lower } from '@/i18n'
import { APERTURE_INSET, doorSides, rectsOf, sharedEdge, type Side } from './geometry'
import { uid } from './ids'
import { checkItem } from './rules'
import type { Item, Level, Rect, Room } from './types'

/*
 * Interior doors: puts doors between neighbor rooms so that every room can be reached.
 * The house grows like a tree: it starts at the entrance (else the living room) and every room gets a door from its best
 * neighbor. Bathrooms and bedrooms do not lead on to other rooms (leaves); hallways and living rooms do.
 * Existing doors are kept; only rooms that cannot reach each other are connected.
 */

/** A shared wall must be at least this long for a door (frame + corner margins) */
const MIN_SHARED = 1.3

/** Lower case for keyword matching: the Turkish dotted and dotless i match the same in every UI language. */
export const foldName = (s: string) => lower(s).replace(/\u0307/g, '').replace(/ı/g, 'i')
/** Keyword pattern for text folded with foldName */
export const keywords = (r: RegExp) => new RegExp(r.source.replace(/ı/g, 'i'), r.flags)

/**
 * Room kinds recognized from room and area names (folded with foldName; also used by generate.ts > roomType). Keywords
 * are data, not UI text: Turkish and English, then common words in de, es, fr, it, nl, pl, pt, ru, ja, ko, zh, hi.
 */
export const ROOM_WORDS = {
  entrance:
    keywords(/giriş|giris|antre|hol\b|koridor|entrance|entry|entryway|hall|corridor|foyer|lobby|mudroom|flur|diele|eingang|entrada|recibidor|pasillo|vestíbulo|entrée|entree|couloir|ingresso|corridoio|\bhal\b|\bgang\b|przedpokój|przedpokoj|korytarz|corredor|прихожая|коридор|холл|玄関|廊下|현관|복도|玄关|门厅|走廊|प्रवेश|गलियारा/),
  living:
    keywords(/oturma|salon|living|lounge|wohnzimmer|salón|\bsala\b|séjour|sejour|soggiorno|salotto|woonkamer|pokój dzienny|гостиная|зал|リビング|居間|거실|客厅|起居室|बैठक|लिविंग/),
  kitchen: keywords(/mutfak|kitchen|küche|kuche|kueche|cocina|cuisine|cucina|keuken|kuchnia|cozinha|кухня|キッチン|台所|주방|부엌|厨房|रसोई/),
  office:
    keywords(/çalışma|calisma|ofis|office|study|arbeitszimmer|büro|buero|estudio|oficina|despacho|bureau|studio|ufficio|studeerkamer|kantoor|gabinet|biuro|escritório|escritorio|кабинет|офис|書斎|オフィス|서재|사무실|书房|办公室|अध्ययन|ऑफिस/),
  bedroom:
    keywords(/yatak|bed|schlafzimmer|dormitorio|habitación|chambre|camera da letto|slaapkamer|sypialnia|quarto|спальня|寝室|ベッドルーム|침실|卧室|शयनकक्ष|बेडरूम/),
  bathroom:
    keywords(/banyo|bath|wc|tuvalet|toilet|duş|\bbad|dusche|baño|bano|aseo|salle de bain|bagno|łazienka|lazienka|banheiro|casa de banho|ванная|туалет|санузел|浴室|トイレ|風呂|욕실|화장실|卫生间|洗手间|बाथरूम|शौचालय/),
}

/** Priority for leading on to other rooms: lower is a better "main room". */
function rank(r: Room) {
  const n = foldName(r.name)
  if (ROOM_WORDS.entrance.test(n)) return 0
  if (ROOM_WORDS.living.test(n)) return 1
  if (ROOM_WORDS.kitchen.test(n)) return 2
  if (ROOM_WORDS.office.test(n)) return 4
  if (ROOM_WORDS.bedroom.test(n)) return 5
  if (ROOM_WORDS.bathroom.test(n)) return 9
  return 3
}

/**
 * Longest wall room a shares with b: which side of which part of a, and the common range.
 * Rooms can have several parts (L, T); every pair of parts is tried.
 */
function shared(a: Room, b: Room): { part: Rect; side: Side; lo: number; hi: number } | null {
  let best: { part: Rect; side: Side; lo: number; hi: number } | null = null
  for (const pa of rectsOf(a))
    for (const pb of rectsOf(b)) {
      const sh = sharedEdge(pa, pb)
      if (sh && sh.hi - sh.lo >= MIN_SHARED && (!best || sh.hi - sh.lo > best.hi - best.lo)) best = { part: pa, ...sh }
    }
  return best
}

/** Door on the given wall of the part at position `u` along the wall (the leaf opens into the room). */
function doorAt(room: Rect, side: Side, u: number): Item {
  const id = uid('it')
  switch (side) {
    case 'back':
      return { id, kind: 'door', x: u, z: room.z + APERTURE_INSET, rot: 0 }
    case 'front':
      return { id, kind: 'door', x: u, z: room.z + room.d - APERTURE_INSET, rot: Math.PI }
    case 'left':
      return { id, kind: 'door', x: room.x + APERTURE_INSET, z: u, rot: Math.PI / 2 }
    case 'right':
      return { id, kind: 'door', x: room.x + room.w - APERTURE_INSET, z: u, rot: -Math.PI / 2 }
  }
}

/**
 * The hinge goes on the side near the corner, so the open leaf rests against the side wall (as in real homes).
 * The local x axis is (cos rot, -sin rot) in the world; hinge left = local -0.46, right = +0.46.
 */
function cornerHinge(d: Item, room: Rect, side: Side): 'left' | 'right' {
  const c = Math.cos(d.rot)
  const s = Math.sin(d.rot)
  const horizontal = side === 'back' || side === 'front'
  const toEnd = (lx: number) => {
    const px = d.x + lx * c
    const pz = d.z - lx * s
    return horizontal ? Math.min(px - room.x, room.x + room.w - px) : Math.min(pz - room.z, room.z + room.d - pz)
  }
  return toEnd(0.46) < toEnd(-0.46) ? 'right' : 'left'
}

/**
 * Looks for a free spot on the shared wall. Like in real homes it starts near a corner (alternating between both ends,
 * moving inward in 5 cm steps); it tries a door opening into the child room first, then the other way.
 */
function placeDoor(level: Level, child: Room, parent: Room): Item | null {
  for (const [room, other] of [
    [child, parent],
    [parent, child],
  ]) {
    const sh = shared(room, other)
    if (!sh) continue
    const lo = sh.lo + 0.65
    const hi = sh.hi - 0.65
    if (hi < lo) continue
    for (let k = 0; lo + k * 0.05 <= hi - k * 0.05 + 1e-6; k++) {
      // Front/right end first: the templates mostly put furniture along the back and left walls.
      for (const u of [hi - k * 0.05, lo + k * 0.05]) {
        const d = doorAt(sh.part, sh.side, Math.round(u * 100) / 100)
        if (checkItem(level, { kind: 'door', x: d.x, z: d.z, rot: d.rot }).ok) return { ...d, hinge: cornerHinge(d, sh.part, sh.side) }
      }
    }
  }
  return null
}

/** New interior doors connecting rooms that cannot reach each other (returned, not added to the plan). */
export function connectRooms(level: Level): Item[] {
  const rooms = level.rooms
  if (rooms.length < 2) return []
  const parent = new Map(rooms.map((r) => [r.id, r.id]))
  const find = (id: string): string => {
    const p = parent.get(id)!
    if (p === id) return id
    const root = find(p)
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => parent.set(find(a), find(b))

  // Existing doors already connect.
  for (const it of level.items) {
    if (it.kind !== 'door') continue
    const { front, back } = doorSides(it, rooms)
    if (front && back && front.id !== back.id) union(front.id, back.id)
  }

  const hub = [...rooms].sort((a, b) => rank(a) - rank(b) || b.w * b.d - a.w * a.d)[0]
  const edges: { a: Room; b: Room; len: number }[] = []
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const sh = shared(rooms[i], rooms[j])
      if (sh) edges.push({ a: rooms[i], b: rooms[j], len: sh.hi - sh.lo })
    }

  const added: Item[] = []
  const failed = new Set<(typeof edges)[number]>()
  let work: Level = { ...level, items: [...level.items] }
  for (;;) {
    const hubRoot = find(hub.id)
    let best: { e: (typeof edges)[number]; par: Room; child: Room; score: number } | null = null
    for (const e of edges) {
      if (failed.has(e) || find(e.a.id) === find(e.b.id)) continue
      const aHub = find(e.a.id) === hubRoot
      const bHub = find(e.b.id) === hubRoot
      // Grow from the hub: the side connected to the hub becomes the "main room".
      const [par, child] = aHub ? [e.a, e.b] : bHub ? [e.b, e.a] : rank(e.a) <= rank(e.b) ? [e.a, e.b] : [e.b, e.a]
      const score = (aHub || bHub ? 0 : 100) + rank(par) * 10 + rank(child) * 0.5 - e.len * 0.1
      if (!best || score < best.score) best = { e, par, child, score }
    }
    if (!best) break
    const door = placeDoor(work, best.child, best.par)
    if (!door) {
      failed.add(best.e)
      continue
    }
    added.push(door)
    work = { ...work, items: [...work.items, door] }
    union(best.e.a.id, best.e.b.id)
  }
  return added
}
