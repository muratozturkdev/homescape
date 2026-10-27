import manifest from './samples.json'
import type { ShotName } from './shots'
import type { VoiceName } from './voices'

/*
 * Sound recordings: natural and mechanical sounds are recordings generated locally with Stable Audio 3 (tools/sfx/build.py;
 * files in public/sounds/, list in samples.json). If a sound has a recording the engine plays it, else it is synthesized
 * (audio/voices.ts, shots.ts): electronic beeps (AC remote, microwave, alarm, robot vacuum, TV power on) stay synthesized
 * on purpose. Recordings are fetched and decoded when first needed (cached per context); short sounds are preloaded when
 * sound is turned on.
 */

export interface SampleInfo {
  files: string[]
  loop: boolean
  dur: number[]
}

export const SAMPLES = manifest as Record<string, SampleInfo>
export const hasSample = (id: string | null | undefined): id is string => Boolean(id && SAMPLES[id]?.files.length)

const url = (f: string) => `${import.meta.env.BASE_URL}sounds/${f}`
const bytes = new Map<string, Promise<ArrayBuffer>>()
const decoded = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer[]>>>()
const ready = new WeakMap<BaseAudioContext, Map<string, AudioBuffer[]>>()

function fetchBytes(file: string) {
  let p = bytes.get(file)
  if (!p) {
    p = fetch(url(file)).then((r) => {
      if (!r.ok) throw new Error(`${file}: ${r.status}`)
      return r.arrayBuffer()
    })
    bytes.set(file, p)
    p.catch(() => bytes.delete(file))
  }
  return p
}

/** Decodes the recording (all its variants) in this context; cached */
export function loadSample(ctx: BaseAudioContext, id: string): Promise<AudioBuffer[]> {
  let m = decoded.get(ctx)
  if (!m) decoded.set(ctx, (m = new Map()))
  let p = m.get(id)
  if (!p) {
    const info = SAMPLES[id]
    p = Promise.all((info?.files ?? []).map((f) => fetchBytes(f).then((b) => ctx.decodeAudioData(b.slice(0))))).then((bufs) => {
      let r = ready.get(ctx)
      if (!r) ready.set(ctx, (r = new Map()))
      r.set(id, bufs)
      return bufs
    })
    m.set(id, p)
    p.catch(() => m!.delete(id))
  }
  return p
}

/** Immediately if decoded (else undefined) */
export const readySample = (ctx: BaseAudioContext, id: string) => ready.get(ctx)?.get(id)

/** Recording of a continuous sound (null: synthesized) */
export function voiceSample(voice: VoiceName, p = 0): string | null {
  const direct: Partial<Record<VoiceName, string>> = {
    fridge: 'fridge',
    fridgeOpen: 'fridge-open',
    washer: 'washer',
    dryer: 'dryer',
    dishwasher: 'dishwasher',
    microwave: 'microwave',
    coffee: 'coffee',
    kettle: 'kettle',
    ovenFan: 'oven-fan',
    sizzle: 'sizzle',
    chop: 'chop',
    dishes: 'dishes',
    cutlery: 'cutlery',
    tap: 'tap',
    shower: 'shower',
    fountain: 'fountain',
    sprinkler: 'sprinkler',
    bubbles: 'hottub',
    aquarium: 'aquarium',
    poolPump: 'pool-pump',
    fan: 'fan',
    ceilingFan: 'ceiling-fan',
    ac: 'ac',
    compressor: 'compressor',
    purifier: 'purifier',
    diffuser: 'diffuser',
    boiler: 'boiler',
    fire: 'fire',
    tick: 'radiator',
    pcFan: 'pc-fan',
    nas: 'nas',
    tvShow: 'tv-show',
    tvMenu: 'tv-menu',
    vacuumBot: 'vacuum-bot',
    vacuum: 'vacuum',
    mower: 'mower',
    siren: 'siren',
    typing: 'typing',
    brush: 'brush',
    snore: 'snore',
    purr: 'purr',
    crunch: 'crunch',
    lap: 'lap',
    scratch: 'scratch',
    lick: 'lick',
    birdsVisit: 'birds-near',
    birds: 'birds',
    crickets: 'crickets',
    city: 'city',
    night: 'night',
    frogs: 'frogs',
    kids: 'kids-play',
    carDrive: 'car-drive',
  }
  let id: string | null = direct[voice] ?? null
  if (voice === 'music') id = `music-${1 + (Math.floor(p * 4) % 4)}`
  else if (voice === 'motor') id = p > 0.5 ? 'motor-garage' : 'motor-blinds'
  else if (voice === 'patter') id = p > 0.5 ? 'patter-dog' : null
  else if (voice === 'wind') id = p > 0.5 ? 'wind-strong' : 'wind'
  else if (voice === 'rain') id = p > 0.5 ? 'rain-heavy' : 'rain'
  return hasSample(id) ? id : null
}

/** Continuous sound made of short recordings played now and then: [recording, shortest and longest gap (s)] */
export const SCATTER: Partial<Record<VoiceName, [string, number, number]>> = {
  pageTurn: ['page', 10, 28],
  rustle: ['rustle', 0.9, 2.6],
  toy: ['squeak', 0.9, 2.8],
  squirrel: ['squirrel', 2, 5],
}

/** Recording of a short sound (null: synthesized) */
export function shotSample(name: ShotName, v?: string): string | null {
  const direct: Partial<Record<ShotName, string>> = {
    click: 'click',
    relay: 'relay',
    doorOpen: 'door-open',
    doorClose: 'door-close',
    windowOpen: 'window-open',
    windowClose: 'window-close',
    lock: 'lock',
    unlock: 'unlock',
    dingDong: 'dingdong',
    button: 'button',
    valve: 'valve',
    cabinetOpen: 'cabinet-open',
    cabinetClose: 'cabinet-close',
    drawerOpen: 'drawer-open',
    drawerClose: 'drawer-close',
    kettleClick: 'kettle-click',
    kibble: 'kibble',
    grind: 'grind',
    flush: 'flush',
    purr: 'purr-short',
    hiss: 'hiss',
    squeak: 'squeak',
    land: 'land',
    carPass: 'car-pass',
    thunder: 'thunder',
    owl: 'owl',
    barkFar: 'bark-far',
    trampoline: 'trampoline',
    place: 'place',
    placeRoom: 'place-room',
    remove: 'remove',
  }
  let id: string | null = direct[name] ?? null
  if (name === 'step') id = `step-${v === 'deck' ? 'wood' : (v ?? 'hard')}`
  else if (name === 'meow') id = v === 'yawn' ? 'meow-yawn' : 'meow'
  else if (name === 'bark') id = v?.includes('sleepy') ? 'bark-sleepy' : v?.includes('small') ? 'bark-small' : 'bark'
  return hasSample(id) ? id : null
}

/** Short recordings preloaded when sound is turned on (no delay on first play) */
export const PRELOAD = Object.keys(SAMPLES).filter((id) => !SAMPLES[id].loop)
