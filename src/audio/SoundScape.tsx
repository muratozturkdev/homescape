import { useEffect } from 'react'
import { deviceClass, domainOf, isActive } from '@/ha/derive'
import { useHa } from '@/ha/store'
import type { Entities, HassEntity } from '@/ha/types'
import { currentWeather } from '@/ha/weather'
import { bindingsOf } from '@/model/bindings'
import { bounds, doorSides, isAperture, isOutdoor, rectsOf, roomAt } from '@/model/geometry'
import { activeLevel, useLayout } from '@/model/layoutStore'
import type { Item, ItemKind, Level } from '@/model/types'
import { cameraApi, useView } from '@/scene/camera'
import { fpsDebug } from '@/scene/FpsControls'
import { indoorAt } from '@/scene/fps'
import { peopleDebug } from '@/scene/People'
import { petsDebug } from '@/scene/petsDebug'
import { streetDebug } from '@/scene/streetPlan'
import { sunOf } from '@/scene/sun'
import { amb } from './ambienceState'
import { rand } from './dsp'
import { type Bus, installSound, type LoopSpec, play, setLoops, setMuffler, setPoseSource, useSound } from './engine'
import type { ShotName } from './shots'
import type { VoiceName } from './voices'

/*
 * Sounds of the house. This component renders nothing: ~3 times/s it reads the plan, HA states, people, pets and weather
 * and hands the engine the list of continuous sounds that should play (audio/engine.ts > setLoops); when an HA state changes
 * it plays short sounds (light switch, door, lock, doorbell, a device's done melody...); in edit mode an interface sound
 * when an item is placed, removed or rotated. Steps and pet reactions play where they happen (People.tsx, FpsControls.tsx,
 * Pets.tsx).
 */

const TICK_MS = 300

/** Height of the sound: ceiling items 2.4 m, wall-mounted items at their own height, floor items 0.7 m */
const CEILING: ItemKind[] = ['ceilingFan', 'ceilingLight', 'downlight', 'pendant', 'smokeDetector', 'siren']
const heightOf = (it: Item) => (CEILING.includes(it.kind) ? 2.4 : it.y != null ? it.y + 0.2 : 0.7)

/** 0-1 seed from the item id (each speaker a different song, each TV a different program) */
const seedOf = (id: string) => {
  let h = 7
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003
  return (h % 1000) / 1000
}

const TV_DOMAINS = ['media_player', 'remote']
/** Whether the TV screen is on and playing (same rule as kit/devices.tsx > tvScreenOf) */
function tvState(main: HassEntity | undefined, rel: HassEntity[]) {
  const self = main && TV_DOMAINS.includes(domainOf(main.entity_id))
  const ents = rel.filter((e) => TV_DOMAINS.includes(domainOf(e.entity_id)))
  if (!self && !ents.length) return { on: Boolean(main) && domainOf(main!.entity_id) !== 'light' && isActive(main), playing: false }
  return { on: (self && isActive(main)) || ents.some(isActive), playing: (self && main!.state === 'playing') || ents.some((e) => e.state === 'playing') }
}

const isRainy = (w?: string) => Boolean(w && /rain|pouring|lightning|hail/.test(w))

/**
 * Whether a device is running (for sound): isActive always counts sensors as on (so the card shows a value); here a power
 * sensor above 8 W or a current above 0.05 A means running, other sensors (battery, temperature) do not count. A binary
 * sensor of class "running", "power", "plug" or "moving" means running when on.
 */
function running(e?: HassEntity) {
  if (!e) return false
  const d = domainOf(e.entity_id)
  if (d === 'sensor') {
    const v = Number(e.state)
    const dc = deviceClass(e)
    if (!Number.isFinite(v)) return false
    return dc === 'power' ? v > 8 : dc === 'current' ? v > 0.05 : false
  }
  if (d === 'binary_sensor') return ['running', 'power', 'plug', 'moving', 'heat', 'sound', 'vibration'].includes(deviceClass(e) ?? '') && e.state === 'on'
  return isActive(e)
}

/**
 * A plugged-in machine at work (washer, dryer, dishwasher, stick vacuum): a plug that is on does not mean it runs (for a
 * vacuum it is the charger). With a power sensor, above 8 W; else the machine's own state ("run", "washing" as in Home
 * Connect; "cleaning" for a vacuum).
 */
function busy(all: HassEntity[]) {
  const power = all.find((e) => domainOf(e.entity_id) === 'sensor' && deviceClass(e) === 'power' && Number.isFinite(Number(e.state)))
  if (power) return Number(power.state) > 8
  return all.some((e) => {
    const d = domainOf(e.entity_id)
    if (d === 'vacuum') return e.state === 'cleaning'
    if (d === 'sensor' || d === 'binary_sensor' || d === 'select') return running(e) || /^(run|running|washing|drying|rinsing|spinning|active)$/i.test(e.state)
    return false
  })
}

/** Continuous sound of an item: which sound, its level and parameter (null: none) */
function itemVoice(it: Item, main: HassEntity | undefined, rel: HassEntity[]): { voice: VoiceName; gain?: number; p?: number; ref?: number } | null {
  const on = running(main) || rel.some(running)
  const all = [main, ...rel].filter(Boolean) as HassEntity[]
  // Alerting sensors (smoke, water leak): when the binary sensor is on
  const alert = isActive(main) || rel.some(isActive)
  const st = main?.state ?? ''
  const pct = Number(main?.attributes.percentage)
  switch (it.kind) {
    case 'fridge':
      return { voice: 'fridge', gain: 0.55 }
    case 'aquarium':
      return { voice: 'aquarium', gain: 0.7 }
    case 'tv': {
      const s = tvState(main, rel)
      return s.playing ? { voice: 'tvShow', p: seedOf(it.id), gain: 0.9, ref: 2 } : s.on ? { voice: 'tvMenu', gain: 0.5 } : null
    }
    case 'projector': {
      const s = tvState(main, rel)
      return s.playing ? { voice: 'tvShow', p: seedOf(it.id), gain: 0.9, ref: 2 } : s.on ? { voice: 'pcFan', p: 1, gain: 0.7 } : null
    }
    case 'speaker':
    case 'homepod':
    case 'soundbar':
      return [main, ...rel].some((e) => e?.state === 'playing') ? { voice: 'music', p: seedOf(it.id), gain: 0.8, ref: 2 } : null
    case 'console':
      return on ? { voice: 'pcFan', p: 0.6, gain: 0.6 } : null
    case 'computer':
      return on ? { voice: 'pcFan', p: 0.3, gain: 0.6 } : null
    case 'nas':
      return !main || on ? { voice: 'nas', gain: 0.5 } : null
    case 'acUnit':
      return on ? { voice: 'ac', gain: 0.7 } : null
    case 'acOutdoor':
      return on ? { voice: 'compressor', gain: 0.8 } : null
    case 'fan':
    case 'wallFan':
    case 'deskFan':
      return on ? { voice: 'fan', p: Number.isFinite(pct) ? pct / 100 : 0.6, gain: 0.7 } : null
    case 'ceilingFan':
      return on ? { voice: 'ceilingFan', p: Number.isFinite(pct) ? pct / 100 : 0.5, gain: 0.7 } : null
    case 'airPurifier':
    case 'humidifier':
    case 'dehumidifier':
      return on ? { voice: 'purifier', gain: 0.6 } : null
    case 'heater':
    case 'oven':
    case 'airFryer':
      return on ? { voice: 'ovenFan', gain: 0.6 } : null
    case 'diffuser':
      return on ? { voice: 'diffuser', gain: 0.8 } : null
    case 'boiler':
    case 'waterHeater': {
      const act = main?.attributes.hvac_action
      const burning = typeof act === 'string' ? act === 'heating' : on
      return burning ? { voice: 'boiler', gain: it.kind === 'boiler' ? 0.8 : 0.5 } : null
    }
    case 'fireplace':
      return on ? { voice: 'fire', gain: 0.9 } : null
    case 'radiator':
    case 'towelWarmer':
      return on ? { voice: 'tick', gain: 0.6 } : null
    case 'washer':
      return busy(all) ? { voice: 'washer', gain: 0.8 } : null
    case 'dryer':
      return busy(all) ? { voice: 'dryer', gain: 0.8 } : null
    case 'dishwasher':
      return busy(all) ? { voice: 'dishwasher', gain: 0.7 } : null
    case 'microwave':
      return on ? { voice: 'microwave', gain: 0.7 } : null
    case 'coffeeMachine':
      return on ? { voice: 'coffee', gain: 0.7 } : null
    case 'kettle':
      return on ? { voice: 'kettle', gain: 0.8 } : null
    case 'stove':
    case 'grill':
      return on ? { voice: 'sizzle', gain: 0.7 } : null
    case 'robotVacuum':
      return st === 'cleaning' || st === 'returning' ? { voice: 'vacuumBot', gain: 0.8 } : null
    case 'stickVacuum':
      return busy(all) ? { voice: 'vacuum', gain: 0.8 } : null
    case 'lawnMower':
      return on ? { voice: 'mower', gain: 0.9, ref: 3 } : null
    case 'shower':
    case 'outdoorShower':
      return on ? { voice: 'shower', gain: 0.8 } : null
    case 'fountain':
      return on ? { voice: 'fountain', gain: 0.8, ref: 2.5 } : null
    case 'sprinkler':
      return on ? { voice: 'sprinkler', gain: 0.7, ref: 2.5 } : null
    case 'hotTub':
      return on ? { voice: 'bubbles', p: 1, gain: 0.8 } : null
    case 'pool':
      return on ? { voice: 'poolPump', gain: 0.6 } : null
    case 'siren':
      return alert && main && ['siren', 'switch'].includes(domainOf(main.entity_id)) ? { voice: 'siren', gain: 1, ref: 4 } : null
    case 'alarmPanel':
      return st === 'triggered' ? { voice: 'siren', gain: 1, ref: 4 } : st === 'arming' || st === 'pending' ? { voice: 'pending', gain: 0.7 } : null
    case 'smokeDetector':
      return alert && main && domainOf(main.entity_id) !== 'sensor' ? { voice: 'smokeAlarm', gain: 1, ref: 3 } : null
    case 'leakSensor':
      return alert && main && domainOf(main.entity_id) !== 'sensor' ? { voice: 'leakBeep', gain: 0.8 } : null
    case 'evCharger':
    case 'homeBattery':
      return on ? { voice: 'coil', gain: 0.5 } : null
  }
  return null
}

/** Sound of a person's activity */
function personVoice(activity: string, near: (k: ItemKind[]) => boolean): VoiceName | null {
  switch (activity) {
    case 'type':
      return 'typing'
    case 'wash':
      return near(['washer', 'dryer']) ? 'rustle' : 'dishes'
    case 'cook':
      return 'chop'
    case 'stir':
      return 'sizzle'
    case 'brush':
      return 'brush'
    case 'fridge':
      return 'fridgeOpen'
    case 'eat':
      return 'cutlery'
    case 'read':
      return 'pageTurn'
    case 'fold':
    case 'browse':
      return 'rustle'
    case 'sleep':
      return 'snore'
  }
  return null
}

/* ---------- muffling (walkthrough) ---------- */

interface Hear {
  /** undefined: bird's-eye view (no muffling); null: listener outside; else the id of the indoor room */
  room: string | null | undefined
  level: Level | null
  /** Muffling between two rooms: "a|b" */
  pair: Map<string, number>
}
const hear: Hear = { room: undefined, level: null, pair: new Map() }

/** Muffling between rooms: joined by an open (or sensorless) door 0.3; door closed or not joined 0.6; inside to outside 0.72 (open window or door 0.45) */
function pairMuffles(level: Level, ents: Entities) {
  const m = new Map<string, number>()
  const set = (a: string, b: string, v: number) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`
    m.set(k, Math.min(m.get(k) ?? 1, v))
  }
  for (const it of level.items) {
    if (!isAperture(it.kind)) continue
    const { front, back } = doorSides(it, level.rooms)
    const e = it.entityId ? ents[it.entityId] : undefined
    const open = !e || isActive(e)
    const a = front && !isOutdoor(front) ? front.id : 'out'
    const b = back && !isOutdoor(back) ? back.id : 'out'
    if (a === b) continue
    const outside = a === 'out' || b === 'out'
    if (it.kind === 'window') {
      if (outside && e && open) set(a, b, 0.45)
    } else set(a, b, outside ? (open && e ? 0.45 : 0.72) : open ? 0.3 : 0.6)
  }
  return m
}

function muffleAt(x: number, z: number) {
  if (hear.room === undefined || !hear.level) return 0
  const r = roomAt(hear.level.rooms, x, z)
  const src = r && !isOutdoor(r) ? r.id : null
  if (src === hear.room) return 0
  const a = src ?? 'out'
  const b = hear.room ?? 'out'
  const k = a < b ? `${a}|${b}` : `${b}|${a}`
  return hear.pair.get(k) ?? (a === 'out' || b === 'out' ? 0.72 : 0.6)
}

/* ---------- outdoors ---------- */


/**
 * Whether it is night (for sound): same rule as the scene (scene/useNight.ts): theme "night", or on "automatic" the sun
 * below the horizon; on automatic without a sun entity, approximated from the clock.
 */
function nightNow(ents: Entities, now: number) {
  const theme = useLayout.getState().theme
  if (theme === 'night') return true
  if (theme === 'day') return false
  const sun = ents['sun.sun']
  return sun ? sun.state === 'below_horizon' : sunOf(undefined, now).elevation <= -2
}


/*
 * Day and night ambience: by day birds, plus city hum when there is a road; at night a quiet night floor (very distant
 * road, light air), crickets, frogs when there is a pond, now and then an owl in the trees and a distant barking dog; the
 * city hum gets quieter. With street life on, the sound of passing cars moves with the cars themselves
 * (life > streetDebug.cars); with it off, a car made of sound only passes now and then.
 */
function ambience(level: Level, ents: Entities, now: number, out: LoopSpec[]) {
  const outdoorRooms = level.rooms.filter(isOutdoor)
  const all = level.rooms.length ? bounds(level.rooms) : { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }
  const night = nightNow(ents, now)
  const day = !night
  // Same as the weather in the scene (ha/weather.ts: the chosen weather entity or the preview of the "Weather" tile on top)
  const sky = currentWeather(ents)
  const weather = sky.state
  const rain = isRainy(weather)
  // In windy weather, in storms and when HA reports a high wind speed
  const windy = sky.fx.wind >= 0.6
  // Two emitters: 4 m outside two opposite corners of the house (muffled from inside in the walkthrough)
  const spots = [
    { x: all.minX - 4, z: all.minZ - 4 },
    { x: all.maxX + 4, z: all.maxZ + 4 },
  ]
  out.push({ key: 'amb:wind', voice: 'wind', x: spots[0].x, y: 2, z: spots[1].z, bus: 'nature', gain: windy ? 0.55 : 0.22, p: windy ? 0.8 : 0.2, ref: 6 })
  spots.forEach((s, i) => {
    if (rain) out.push({ key: `amb:rain:${i}`, voice: 'rain', x: s.x, y: 3, z: s.z, bus: 'nature', gain: 0.55, p: weather === 'pouring' ? 1 : 0.3, ref: 8 })
    else if (day) out.push({ key: `amb:birds:${i}`, voice: 'birds', x: s.x, y: 4, z: s.z, bus: 'nature', gain: 0.35, ref: 6 })
    else out.push({ key: `amb:crickets:${i}`, voice: 'crickets', x: s.x, y: 0.3, z: s.z, bus: 'nature', gain: 0.4, ref: 6 })
  })
  if (night) {
    // Night floor from above the middle of the house (same level everywhere, muffled inside in the walkthrough)
    out.push({ key: 'amb:night', voice: 'night', x: (all.minX + all.maxX) / 2, y: 8, z: (all.minZ + all.maxZ) / 2, bus: 'nature', gain: 0.45, ref: 12 })
    // Frogs when there is a pond
    const pond = outdoorRooms.find((r) => r.floor === 'water')
    if (pond && !rain) {
      const r = rectsOf(pond)[0]
      out.push({ key: 'amb:frogs', voice: 'frogs', x: r.x + r.w / 2, y: 0.2, z: r.z + r.d / 2, bus: 'nature', gain: 0.5, ref: 3 })
    }
    // Now and then an owl in one of the trees (else far from the house)
    if (!rain && now > amb.owlAt) {
      amb.owlAt = now + rand(28, 75) * 1000
      const trees = level.items.filter((it) => it.kind === 'tree' || it.kind === 'streetTree')
      const t = trees.length ? trees[Math.floor(Math.random() * trees.length)] : { x: all.maxX + 12, z: all.minZ - 12 }
      play('owl', { x: t.x, y: 5, z: t.z }, { bus: 'nature', gain: 0.7, ref: 6 })
    }
    if (now > amb.dogAt) {
      amb.dogAt = now + rand(45, 120) * 1000
      // A dog at the other end of the neighborhood barks two or three times
      const a = Math.random() * Math.PI * 2
      const r = Math.max(all.maxX - all.minX, all.maxZ - all.minZ) / 2 + 22
      const at = { x: (all.minX + all.maxX) / 2 + Math.cos(a) * r, y: 1, z: (all.minZ + all.maxZ) / 2 + Math.sin(a) * r }
      const n = 2 + Math.floor(Math.random() * 2)
      for (let k = 0; k < n; k++) window.setTimeout(() => play('barkFar', at, { bus: 'nature', gain: 0.8, ref: 10 }), k * rand(550, 900))
    }
  }
  // Thunder plays with the lightning in scene/Weather.tsx (a little after the flash)
  // With a road: distant city hum and now and then a passing car (along the road, from one end to the other)
  const roads = outdoorRooms.filter((r) => r.floor === 'road')
  if (roads.length) {
    const r = rectsOf(roads[0])[0]
    out.push({ key: 'amb:city', voice: 'city', x: r.x + r.w / 2, y: 1, z: r.z + r.d / 2, bus: 'nature', gain: night ? 0.1 : 0.3, ref: 8 })
    // With street life on, cars are visible and their sound moves with them
    if (streetDebug.active) amb.carAt = now + 5000
    if (now > amb.carAt) {
      amb.carAt = now + (night ? rand(25, 70) : rand(9, 28)) * 1000
      const road = rectsOf(roads[Math.floor(Math.random() * roads.length)])[0]
      const alongX = road.w >= road.d
      const lane = rand(0.3, 0.7)
      const dir = Math.random() < 0.5
      const span = 30
      const cx = road.x + road.w / 2
      const cz = road.z + road.d / 2
      const from = alongX ? { x: cx + (dir ? -span : span), z: road.z + road.d * lane } : { x: road.x + road.w * lane, z: cz + (dir ? -span : span) }
      const to = alongX ? { x: cx + (dir ? span : -span), z: from.z } : { x: from.x, z: cz + (dir ? span : -span) }
      const dur = rand(4.5, 7)
      play('carPass', { ...from, y: 0.6 }, { bus: 'nature', v: String(dur), to, ref: 4 })
    }
  }
}

/* ---------- living beings ---------- */

function life(level: Level, now: number, out: LoopSpec[]) {
  const near = (x: number, z: number) => (kinds: ItemKind[]) => level.items.some((i) => kinds.includes(i.kind) && Math.hypot(i.x - x, i.z - z) < 1.3)
  peopleDebug.persons.forEach((ps, i) => {
    if (ps.walking || (ps.act ?? 1) < 0.5) return
    const voice = personVoice(ps.activity, near(ps.x, ps.z))
    if (!voice) return
    // The hands are in front of the person
    const x = ps.x + Math.sin(ps.heading) * 0.35
    const z = ps.z + Math.cos(ps.heading) * 0.35
    out.push({ key: `person:${i}`, voice, x, y: ps.pose === 'lie' ? 0.6 : 1, z, bus: 'people', gain: voice === 'snore' ? 0.5 : 0.8, p: voice === 'snore' ? (i % 2 ? 0.8 : 0.2) : 0, ref: 1.2 })
  })
  for (const pt of petsDebug.pets) {
    const dog = pt.species === 'dog'
    const base = { key: `pet:${pt.id}`, x: pt.x, y: pt.y + 0.2, z: pt.z, bus: 'pets' as Bus, ref: 1 }
    if (pt.react) continue
    // A cat's paws are silent; a dog's claws click on hard floors
    if (pt.moving) {
      if (dog) out.push({ ...base, voice: 'patter', p: 1, gain: 0.6 })
    }
    else if (dog && pt.action === 'play') out.push({ ...base, voice: 'toy', gain: 0.7 })
    else if (pt.action === 'eat') out.push({ ...base, voice: 'crunch', gain: 0.6 })
    else if (pt.action === 'drink') out.push({ ...base, voice: 'lap', gain: 0.6 })
    else if (pt.action === 'scratch') out.push({ ...base, voice: 'scratch', gain: 0.6 })
    else if (pt.action === 'groom') out.push({ ...base, voice: 'lick', gain: 0.5 })
    else if (pt.action === 'sleep') out.push(dog ? { ...base, voice: 'snore', p: 0.2, gain: 0.35 } : { ...base, voice: 'purr', gain: 0.25 })
    else if (!dog && (pt.action === 'rub' || pt.action === 'rest')) out.push({ ...base, voice: 'purr', gain: 0.35 })
  }
  // Street: engine and tires of a passing car (from a point ahead of it so the sound does not lag), claws of a dog being
  // walked, children at the playground
  for (const c of streetDebug.cars) {
    const k = Math.min(1, c.speed / 7.5)
    out.push({ key: `car:${c.id}`, voice: 'carDrive', x: c.x + Math.sin(c.heading) * c.speed * 0.15, y: 0.6, z: c.z + Math.cos(c.heading) * c.speed * 0.15, bus: 'nature', gain: 0.35 + 0.65 * k, ref: 3 })
  }
  for (const d of streetDebug.dogs) if (d.moving) out.push({ key: `streetdog:${d.id}`, voice: 'patter', x: d.x, y: 0.2, z: d.z, bus: 'pets', p: 1, gain: 0.35, ref: 1 })
  if (streetDebug.playAt) out.push({ key: 'kids', voice: 'kids', x: streetDebug.playAt.x, y: 1, z: streetDebug.playAt.z, bus: 'people', gain: 0.7, ref: 4 })
  // Visiting animals: birds and squirrels make sound; a dog barks now and then, a cat meows
  const v = petsDebug.visitor
  if (v) {
    if (v.kind === 'birds') out.push({ key: 'visitor', voice: 'birdsVisit', x: v.x, y: v.y + 0.3, z: v.z, bus: 'pets', gain: 0.9, ref: 2 })
    else if (v.kind === 'squirrel') out.push({ key: 'visitor', voice: 'squirrel', x: v.x, y: v.y, z: v.z, bus: 'pets', gain: 0.7, ref: 1.5 })
    else if ((v.kind === 'dog' || v.kind === 'cat') && now > amb.visitorCallAt) {
      const first = amb.lastVisitor !== `${v.kind}${v.count}`
      amb.lastVisitor = `${v.kind}${v.count}`
      amb.visitorCallAt = now + rand(5, 12) * 1000
      if (!first || Math.random() < 0.7) play(v.kind === 'dog' ? 'bark' : 'meow', { x: v.x, y: v.y + 0.4, z: v.z }, { bus: 'pets', ref: 1.5 })
    }
  }
}

/* ---------- state changes ---------- */

const transient = new Map<string, { voice: VoiceName; until: number; p: number; it: Item }>()

function onEntities(prev: Entities, next: Entities) {
  if (!Object.keys(prev).length) return
  const lv = activeLevel(useLayout.getState())
  if (!lv) return
  const index = new Map<string, Item[]>()
  for (const it of lv.items) for (const id of bindingsOf(it)) index.set(id, [...(index.get(id) ?? []), it])
  let clicks = 0
  const now = Date.now()
  for (const id in next) {
    const a = prev[id]
    const b = next[id]
    if (!a || a === b || (a.state === b.state && a.last_changed === b.last_changed)) continue
    const dom = domainOf(id)
    const it = index.get(id)?.[0]
    if (dom === 'alarm_control_panel' && a.state !== b.state) {
      const at = it ? { x: it.x, y: heightOf(it), z: it.z } : null
      if (b.state.startsWith('armed_')) play('armed', at)
      else if (b.state === 'disarmed') play('disarmed', at)
      else if (b.state === 'arming') play('beep', at)
      continue
    }
    if (!it) continue
    const at = { x: it.x, y: heightOf(it), z: it.z }
    const was = isActive(a)
    const is = isActive(b)
    const changed = a.state !== b.state
    let shot: ShotName | null = null
    // Smart pet feeder and valve: whatever entity they are bound to
    if (it.kind === 'petFeeder') shot = 'kibble'
    else if (it.kind === 'waterValve' || dom === 'valve') shot = changed ? 'valve' : null
    else if (it.kind === 'doorbell') shot = dom !== 'binary_sensor' || b.state === 'on' ? 'dingDong' : null
    else if (it.kind === 'smartButton') shot = 'button'
    else if (!changed) continue
    else if (dom === 'light') shot = clicks++ < 3 ? 'click' : null
    else if (dom === 'lock') shot = b.state === 'locked' ? 'lock' : b.state === 'unlocked' || b.state === 'open' ? 'unlock' : null
    else if (dom === 'binary_sensor' && isAperture(it.kind)) {
      const dc = deviceClass(b)
      if (!dc || ['door', 'window', 'opening', 'garage_door'].includes(dc)) {
        if (it.kind === 'window') shot = is ? 'windowOpen' : 'windowClose'
        else if (it.kind === 'garageDoor') transient.set(it.id, { voice: 'motor', until: now + 6000, p: 1, it })
        else shot = is ? 'doorOpen' : 'doorClose'
      }
    } else if (dom === 'cover') {
      // While moving, the "opening/closing" loop (itemVoice); a direct switch to open/closed gives a short motor sound
      if (!['opening', 'closing'].includes(b.state)) transient.set(it.id, { voice: 'motor', until: now + (it.kind === 'garageDoor' || it.kind === 'gate' ? 6000 : 2800), p: it.kind === 'garageDoor' || it.kind === 'gate' ? 1 : 0, it })
    } else if (dom === 'media_player') shot = !was && is ? 'tvOn' : was && !is ? 'tvOff' : null
    else if (dom === 'climate') shot = !was && is ? 'acOn' : was && !is ? 'acOff' : null
    else if (dom === 'vacuum') shot = b.state === 'cleaning' && a.state !== 'cleaning' ? 'botStart' : b.state === 'docked' ? 'botDock' : null
    else if (['switch', 'input_boolean', 'fan', 'humidifier', 'water_heater'].includes(dom)) shot = 'relay'
    // Device finished its job
    if (['washer', 'dryer', 'dishwasher'].includes(it.kind)) {
      if (busy([a]) && !busy([b])) shot = 'done'
      else if (dom === 'switch') shot = 'relay'
    } else if (was && !is) {
      if (it.kind === 'microwave') shot = 'microDone'
      else if (it.kind === 'kettle' || it.kind === 'coffeeMachine') shot = 'kettleClick'
    } else if (!was && is && it.kind === 'coffeeMachine') shot = 'grind'
    if (shot) play(shot, at)
  }
}

/* ---------- interface ---------- */

function onLayout(s: ReturnType<typeof useLayout.getState>, p: ReturnType<typeof useLayout.getState>) {
  if (s.layout === p.layout || s.levelId !== p.levelId || s.mode !== 'edit') return
  const a = activeLevel(p)
  const b = activeLevel(s)
  if (!a || !b || a === b) return
  const ui = { bus: 'ui' as Bus }
  if (b.rooms.length > a.rooms.length) return void play('placeRoom', null, ui)
  if (b.rooms.length < a.rooms.length || b.items.length < a.items.length) return void play('remove', null, ui)
  if (b.items.length > a.items.length) return void play('place', null, ui)
  const sel = s.selection?.type === 'item' ? s.selection.id : null
  if (sel) {
    const x = a.items.find((i) => i.id === sel)
    const y = b.items.find((i) => i.id === sel)
    if (x && y && x.rot !== y.rot) play('rotate', null, ui)
  }
}

/* ---------- loop ---------- */

function tick() {
  if (!useSound.getState().running) return
  const L = useLayout.getState()
  const lv = activeLevel(L)
  if (!lv) return setLoops([])
  const ents = useHa.getState().entities
  const now = Date.now()
  const fps = useView.getState().fps
  // Room of the listener in the walkthrough (for muffling)
  hear.level = lv
  hear.room = fps ? (indoorAt(lv, fpsDebug.x, fpsDebug.z)?.id ?? null) : undefined
  if (fps) hear.pair = pairMuffles(lv, ents)
  const out: LoopSpec[] = []
  for (const it of lv.items) {
    const main = it.entityId ? ents[it.entityId] : undefined
    const rel = (it.extras ?? []).map((id) => ents[id]).filter(Boolean) as HassEntity[]
    let v = itemVoice(it, main, rel)
    // Motor while a curtain, awning or garage door moves
    if (!v && main && domainOf(main.entity_id) === 'cover' && ['opening', 'closing'].includes(main.state)) v = { voice: 'motor', p: it.kind === 'garageDoor' || it.kind === 'gate' ? 1 : 0, gain: 0.7 }
    if (!v) continue
    out.push({ key: it.id, voice: v.voice, x: it.x, y: heightOf(it), z: it.z, gain: v.gain, p: v.p, ref: v.ref })
  }
  for (const [id, tr] of transient) {
    if (now > tr.until) transient.delete(id)
    else if (!out.some((o) => o.key === id)) out.push({ key: id, voice: tr.voice, x: tr.it.x, y: heightOf(tr.it), z: tr.it.z, gain: 0.7, p: tr.p })
  }
  // Alarm triggered but no panel item: siren from the middle of the house
  const alarm = Object.values(ents).find((e) => domainOf(e.entity_id) === 'alarm_control_panel' && e.state === 'triggered')
  if (alarm && !out.some((o) => o.voice === 'siren')) {
    const b = bounds(lv.rooms)
    out.push({ key: 'alarm', voice: 'siren', x: (b.minX + b.maxX) / 2, y: 2.4, z: (b.minZ + b.maxZ) / 2, gain: 1, ref: 5 })
  }
  life(lv, now, out)
  ambience(lv, ents, now, out)
  setLoops(out)
}

export function SoundScape() {
  useEffect(() => {
    installSound()
    setPoseSource(() => cameraApi.pose())
    setMuffler(muffleAt)
    const id = setInterval(tick, TICK_MS)
    const offHa = useHa.subscribe((s, p) => {
      if (s.entities !== p.entities) onEntities(p.entities, s.entities)
    })
    const offLayout = useLayout.subscribe(onLayout)
    const offRun = useSound.subscribe((s, p) => {
      if (s.running && !p.running) tick()
    })
    return () => {
      clearInterval(id)
      offHa()
      offLayout()
      offRun()
      setLoops([])
      setPoseSource(null)
      setMuffler(null)
    }
  }, [])
  return null
}
