import { create } from 'zustand'
import { t } from '@/i18n'
import { chain, Kit, makeNoise, type Noise, rand } from './dsp'
import { hasSample, loadSample, PRELOAD, readySample, SCATTER, shotSample, voiceSample } from './samples'
import { SHOTS, type ShotName } from './shots'
import { VOICES, type VoiceName } from './voices'

/*
 * Sound. Every sound is a recording (audio/samples.ts) or synthesized with Web Audio (audio/voices.ts continuous sounds,
 * audio/shots.ts short sounds, audio/music.ts music and TV). Sounds are positioned in 3D: in the walkthrough the listener is
 * at the eye, in the bird's-eye view a little above the point the camera looks at (zooming in brings the room's sounds
 * forward); sounds get quieter with distance and come from left and right. In the walkthrough, sound from another room or
 * from outside is muffled (setMuffler). At most MAX_LOOPS continuous sounds play at once (the loudest ones). The browser
 * starts audio on the first touch; it stops while the tab is hidden. Settings (on, level, buses) are saved in this browser.
 */

/**
 * Sound types: each type has its own bus, on/off switch and level. A sound's type comes from its name (voiceBus, shotBus);
 * the caller passes one when the context needs it (the sizzle of a stove is an appliance, a person stirring is people).
 */
export type Bus = 'appliance' | 'media' | 'home' | 'alert' | 'people' | 'pets' | 'nature' | 'ui'
export const BUSES: Bus[] = ['appliance', 'media', 'home', 'alert', 'people', 'pets', 'nature', 'ui']
export const BUS_LABEL: Record<Bus, string> = {
  appliance: t('Appliances and climate'),
  media: t('TV and music'),
  home: t('Doors, switches, cabinets'),
  alert: t('Alerts and notifications'),
  people: t('People'),
  pets: t('Animals'),
  nature: t('Outdoors and weather'),
  ui: t('Interface'),
}
/** Base share of each type in the mix (the user's level is multiplied by it) */
const BUS_GAIN: Record<Bus, number> = { appliance: 1, media: 1, home: 1, alert: 1, people: 1, pets: 1, nature: 0.8, ui: 0.55 }
const MAKEUP = 3

const all = <T,>(v: T) => Object.fromEntries(BUSES.map((b) => [b, v])) as Record<Bus, T>

interface Prefs {
  on: boolean
  volume: number
  buses: Record<Bus, boolean>
  /** Level of each type, 0-1 */
  levels: Record<Bus, number>
}
const KEY = 'homescape-sound'
const DEFAULT: Prefs = { on: true, volume: 0.7, buses: all(true), levels: all(1) }
/** Mapping of the old four-bus setting to the new types */
const OLD: Record<string, Bus[]> = { device: ['appliance', 'media', 'home', 'alert'], life: ['people', 'pets'], outdoor: ['nature'], ui: ['ui'] }
const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d)

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as { on?: boolean; volume?: number; buses?: Record<string, boolean>; levels?: Record<string, number> }
      const buses = all(true)
      for (const [k, v] of Object.entries(p.buses ?? {})) for (const b of OLD[k] ?? (BUSES.includes(k as Bus) ? [k as Bus] : [])) buses[b] = v !== false
      const levels = all(1)
      for (const b of BUSES) levels[b] = clamp01(p.levels?.[b], 1)
      return { on: p.on ?? DEFAULT.on, volume: clamp01(p.volume, DEFAULT.volume), buses, levels }
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT
}

interface SoundState extends Prefs {
  /** Whether the audio context is running (the browser starts it on the first touch) */
  running: boolean
  setOn: (on: boolean) => void
  setVolume: (v: number) => void
  setBus: (b: Bus, on: boolean) => void
  setLevel: (b: Bus, v: number) => void
}

const save = () => {
  const { on, volume, buses, levels } = useSound.getState()
  try {
    localStorage.setItem(KEY, JSON.stringify({ on, volume, buses, levels }))
  } catch {
    /* storage unavailable */
  }
}

export const useSound = create<SoundState>((set, get) => ({
  ...readPrefs(),
  running: false,
  setOn: (on) => {
    set({ on })
    save()
    if (on) unlock()
    applyPrefs()
  },
  setVolume: (volume) => {
    set({ volume: Math.min(1, Math.max(0, volume)) })
    save()
    applyPrefs()
  },
  setBus: (b, on) => {
    set({ buses: { ...get().buses, [b]: on } })
    save()
    applyPrefs()
  },
  setLevel: (b, v) => {
    set({ levels: { ...get().levels, [b]: clamp01(v, 1) } })
    save()
    applyPrefs()
  },
}))

/** Default type of a continuous sound */
export function voiceBus(voice: VoiceName): Bus {
  if (['tvShow', 'tvMenu', 'music'].includes(voice)) return 'media'
  if (['siren', 'smokeAlarm', 'leakBeep', 'pending'].includes(voice)) return 'alert'
  if (['typing', 'chop', 'dishes', 'cutlery', 'brush', 'pageTurn', 'rustle', 'snore', 'fridgeOpen', 'kids'].includes(voice)) return 'people'
  if (['purr', 'patter', 'crunch', 'lap', 'scratch', 'lick', 'toy', 'birdsVisit', 'squirrel'].includes(voice)) return 'pets'
  if (['birds', 'crickets', 'wind', 'rain', 'city', 'night', 'frogs', 'carDrive'].includes(voice)) return 'nature'
  return 'appliance'
}

/** Default type of a short sound */
export function shotBus(name: ShotName): Bus {
  if (['click', 'relay', 'doorOpen', 'doorClose', 'windowOpen', 'windowClose', 'lock', 'unlock', 'button', 'valve', 'cabinetOpen', 'cabinetClose', 'drawerOpen', 'drawerClose'].includes(name)) return 'home'
  if (['dingDong', 'armed', 'disarmed', 'beep', 'done', 'microDone', 'botStart', 'botDock', 'acOn', 'acOff'].includes(name)) return 'alert'
  if (['tvOn', 'tvOff'].includes(name)) return 'media'
  if (['step', 'flush', 'trampoline'].includes(name)) return 'people'
  if (['meow', 'bark', 'purr', 'hiss', 'squeak', 'land', 'kibble'].includes(name)) return 'pets'
  if (['carPass', 'thunder', 'owl', 'barkFar'].includes(name)) return 'nature'
  if (['place', 'placeRoom', 'remove', 'rotate', 'deny', 'chime'].includes(name)) return 'ui'
  return 'appliance'
}

/* ---------- context ---------- */

let ctx: AudioContext | null = null
let noise: Noise | null = null
let master: GainNode | null = null
let analyser: AnalyserNode | null = null
const buses = {} as Record<Bus, GainNode>
let gestured = false
let suspendT: ReturnType<typeof setTimeout> | undefined

function build() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return false
  const c = new AC({ latencyHint: 'interactive' })
  ctx = c
  noise = makeNoise(c)
  master = new GainNode(c, { gain: 0 })
  const comp = new DynamicsCompressorNode(c, { threshold: -14, knee: 10, ratio: 4, attack: 0.005, release: 0.25 })
  analyser = new AnalyserNode(c, { fftSize: 1024 })
  chain(master, comp, analyser, c.destination)
  for (const b of BUSES) {
    buses[b] = new GainNode(c, { gain: 0 })
    buses[b].connect(master)
  }
  // Short recordings upfront: no delay on the first door or the first step
  for (const id of PRELOAD) void loadSample(c, id).catch(() => {})
  c.onstatechange = () => {
    const running = c.state === 'running'
    useSound.setState({ running })
    if (running) {
      startFrame()
      applyLoops()
    }
  }
  applyPrefs()
  return true
}

/** Starts audio (after a user gesture; browser rule) */
export function unlock() {
  if (!useSound.getState().on) return
  if (!ctx && !build()) return
  // In a hidden tab it is built but suspended; visibilitychange resumes it when visible
  if (!ctx) return
  if (document.hidden) void ctx.suspend()
  else if (ctx.state !== 'running') void ctx.resume().catch(() => {})
}

function applyPrefs() {
  const s = useSound.getState()
  if (!ctx || !master) return
  const t = ctx.currentTime
  // The ear perceives level logarithmically: square of the slider; MAKEUP compensates for quiet distant sounds (the compressor holds the peaks)
  master.gain.setTargetAtTime(s.on ? s.volume * s.volume * MAKEUP : 0, t, 0.08)
  for (const b of BUSES) buses[b].gain.setTargetAtTime(s.buses[b] ? BUS_GAIN[b] * s.levels[b] * s.levels[b] : 0, t, 0.08)
  clearTimeout(suspendT)
  if (!s.on) {
    // While off the context is suspended: no CPU use
    suspendT = setTimeout(() => {
      if (!useSound.getState().on) void ctx?.suspend()
    }, 400)
  } else if (ctx.state === 'suspended' && gestured && !document.hidden) void ctx.resume().catch(() => {})
  applyLoops()
}

let installed = false
/** Listeners that start audio on the first touch and stop it while the tab is hidden (App installs them once) */
export function installSound() {
  if (installed) return
  installed = true
  const go = () => {
    gestured = true
    unlock()
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, go, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) void ctx.suspend()
    else if (useSound.getState().on && gestured) void ctx.resume().catch(() => {})
  })
}

/* ---------- listener ---------- */

export interface Pose {
  x: number
  y: number
  z: number
  /** View direction and camera up (unit vectors) */
  fx: number
  fy: number
  fz: number
  ux: number
  uy: number
  uz: number
}

let poseOf: (() => Pose | null) | null = null
let muffler: ((x: number, z: number) => number) | null = null
/** Position and orientation of the listener (SoundScape connects it to the camera) */
export const setPoseSource = (fn: (() => Pose | null) | null) => {
  poseOf = fn
}
/** Muffling 0-1: sound from another room or from outside in the walkthrough (SoundScape connects it) */
export const setMuffler = (fn: ((x: number, z: number) => number) | null) => {
  muffler = fn
}

const lp: Pose = { x: 0, y: 8, z: 8, fx: 0, fy: -1, fz: -1, ux: 0, uy: 1, uz: 0 }
let raf = 0
function startFrame() {
  if (!raf) raf = requestAnimationFrame(frame)
}
function frame() {
  raf = 0
  if (!ctx || ctx.state !== 'running') return
  const p = poseOf?.()
  if (p) setListener(p)
  raf = requestAnimationFrame(frame)
}

function setListener(p: Pose) {
  if (!ctx) return
  const moved = Math.abs(p.x - lp.x) + Math.abs(p.y - lp.y) + Math.abs(p.z - lp.z) > 0.005 || Math.abs(p.fx - lp.fx) + Math.abs(p.fy - lp.fy) + Math.abs(p.fz - lp.fz) > 0.002
  if (!moved) return
  Object.assign(lp, p)
  const L = ctx.listener
  const t = ctx.currentTime
  if (L.positionX) {
    L.positionX.setTargetAtTime(p.x, t, 0.03)
    L.positionY.setTargetAtTime(p.y, t, 0.03)
    L.positionZ.setTargetAtTime(p.z, t, 0.03)
    L.forwardX.setTargetAtTime(p.fx, t, 0.03)
    L.forwardY.setTargetAtTime(p.fy, t, 0.03)
    L.forwardZ.setTargetAtTime(p.fz, t, 0.03)
    L.upX.setTargetAtTime(p.ux, t, 0.03)
    L.upY.setTargetAtTime(p.uy, t, 0.03)
    L.upZ.setTargetAtTime(p.uz, t, 0.03)
  } else {
    L.setPosition(p.x, p.y, p.z)
    L.setOrientation(p.fx, p.fy, p.fz, p.ux, p.uy, p.uz)
  }
}

/** Low-pass cutoff (Hz) and gain loss by muffling */
const cutoff = (m: number) => 18000 * Math.pow(450 / 18000, m)
const muffleGain = (m: number) => 1 - 0.45 * m
const ROLLOFF = 1.15

function panner(c: BaseAudioContext, x: number, y: number, z: number, ref: number) {
  return new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: ref, rolloffFactor: ROLLOFF, maxDistance: 120, positionX: x, positionY: y, positionZ: z })
}

/* ---------- recordings (audio/samples.ts) ---------- */

/** Music and TV keep their pitch; other recordings play at a slightly different pitch per source (two fridges do not sound the same) */
const STEADY = ['tvShow', 'tvMenu', 'music']

/** Starts a continuous sound: a seamless loop of its recording (from a random point), a recording played now and then, or synthesis */
function startVoice(kit: Kit, out: AudioNode, voice: VoiceName, p: number) {
  const id = voiceSample(voice, p)
  if (id) {
    const begin = (bufs: AudioBuffer[]) => {
      if (kit.stopped || !bufs.length) return
      const b = bufs[Math.floor(Math.random() * bufs.length)]
      const s = new AudioBufferSourceNode(kit.ctx, { buffer: b, loop: true, playbackRate: STEADY.includes(voice) ? 1 : rand(0.96, 1.04) })
      s.connect(out)
      s.start(kit.ctx.currentTime, Math.random() * b.duration)
      kit.track(s)
    }
    const now = readySample(kit.ctx, id)
    if (now) begin(now)
    else void loadSample(kit.ctx, id).then(begin).catch(() => {})
    return
  }
  const sc = SCATTER[voice]
  if (sc && hasSample(sc[0])) {
    const [sid, lo, hi] = sc
    void loadSample(kit.ctx, sid).catch(() => {})
    kit.every(kit.t + rand(0.2, Math.min(lo, 2.5)), (t) => {
      const bufs = readySample(kit.ctx, sid)
      if (bufs?.length) kit.track(playBuffer(kit.ctx, out, t, pickBuffer(sid, bufs), rand(0.94, 1.06)))
      return t + rand(lo, hi)
    })
    return
  }
  VOICES[voice](kit, out, p)
}

const lastPick = new Map<string, number>()
/** One of the variants; never the previous one again */
function pickBuffer(id: string, bufs: AudioBuffer[]) {
  let i = Math.floor(Math.random() * bufs.length)
  if (bufs.length > 1 && i === lastPick.get(id)) i = (i + 1) % bufs.length
  lastPick.set(id, i)
  return bufs[i]
}

function playBuffer(c: BaseAudioContext, out: AudioNode, t: number, b: AudioBuffer, rate = 1) {
  const s = new AudioBufferSourceNode(c, { buffer: b, playbackRate: rate })
  s.connect(out)
  s.start(t)
  return s
}

/** Plays a short recording and returns its duration (a dog's double bark is two variants in a row) */
function playShotBuffers(c: BaseAudioContext, out: AudioNode, t: number, id: string, bufs: AudioBuffer[], name: ShotName, v?: string) {
  const rate = name === 'step' ? rand(0.92, 1.08) : name === 'carPass' || name === 'thunder' || name === 'flush' ? 1 : rand(0.95, 1.05)
  const b = pickBuffer(id, bufs)
  playBuffer(c, out, t, b, rate)
  let dur = b.duration / rate
  if (name === 'bark' && v?.includes('double')) {
    const b2 = pickBuffer(id, bufs)
    playBuffer(c, out, t + Math.min(0.42, dur * 0.8), b2, rate * rand(0.97, 1.03))
    dur = Math.min(0.42, dur * 0.8) + b2.duration / rate
  }
  return dur
}

/* ---------- continuous sounds ---------- */

export interface LoopSpec {
  /** Stable key: the same key keeps the same sound going (like an item id) */
  key: string
  voice: VoiceName
  x: number
  y: number
  z: number
  /** Sound type (default from the sound's name: voiceBus) */
  bus?: Bus
  gain?: number
  /** Full level up to this distance (m) */
  ref?: number
  /** Sound specific parameter (voices.ts) */
  p?: number
}

interface LiveLoop {
  spec: LoopSpec
  kit: Kit
  input: GainNode
  filter: BiquadFilterNode
  pan: PannerNode
  muffle: number
}

const MAX_LOOPS = 14
const live = new Map<string, LiveLoop>()
let wanted: LoopSpec[] = []

/** Full list of continuous sounds that should play (SoundScape sends it ~3 times/s); the engine handles the rest */
export function setLoops(specs: LoopSpec[]) {
  wanted = specs.map((s) => (s.bus ? s : { ...s, bus: voiceBus(s.voice) }))
  applyLoops()
}

function loudness(s: LoopSpec, m: number) {
  const d = Math.hypot(s.x - lp.x, s.y - lp.y, s.z - lp.z)
  const ref = s.ref ?? 1.5
  return (s.gain ?? 1) * (ref / (ref + ROLLOFF * Math.max(0, d - ref))) * muffleGain(m)
}

function stopLoop(v: LiveLoop) {
  if (!ctx) return
  v.input.gain.cancelScheduledValues(ctx.currentTime)
  v.input.gain.setTargetAtTime(0, ctx.currentTime, 0.15)
  setTimeout(() => {
    v.kit.stop()
    v.pan.disconnect()
  }, 900)
}

function applyLoops() {
  const s = useSound.getState()
  if (!ctx || !noise || ctx.state !== 'running' || !s.on) {
    for (const v of live.values()) stopLoop(v)
    live.clear()
    return
  }
  const c = ctx
  const scored = wanted
    .filter((w) => s.buses[w.bus!] && s.levels[w.bus!] > 0)
    .map((w) => {
      const m = muffler?.(w.x, w.z) ?? 0
      return { w, m, l: loudness(w, m) }
    })
    .filter((x) => x.l > 0.006)
    .sort((a, b) => b.l - a.l)
    .slice(0, MAX_LOOPS)
  const keep = new Set(scored.map((x) => x.w.key))
  for (const [key, v] of live)
    if (!keep.has(key)) {
      stopLoop(v)
      live.delete(key)
    }
  const t = c.currentTime
  for (const { w, m } of scored) {
    let v = live.get(w.key)
    if (v && (v.spec.voice !== w.voice || (v.spec.p ?? 0) !== (w.p ?? 0) || v.spec.bus !== w.bus)) {
      stopLoop(v)
      live.delete(w.key)
      v = undefined
    }
    if (!v) {
      const input = new GainNode(c, { gain: 0 })
      const filter = new BiquadFilterNode(c, { type: 'lowpass', frequency: cutoff(m), Q: 0.5 })
      const pan = panner(c, w.x, w.y, w.z, w.ref ?? 1.5)
      chain(input, filter, pan, buses[w.bus!])
      const kit = new Kit(c, noise)
      startVoice(kit, input, w.voice, w.p ?? 0)
      input.gain.setTargetAtTime((w.gain ?? 1) * muffleGain(m), t, 0.3)
      v = { spec: w, kit, input, filter, pan, muffle: m }
      live.set(w.key, v)
      continue
    }
    const o = v.spec
    if (o.x !== w.x || o.y !== w.y || o.z !== w.z) {
      v.pan.positionX.setTargetAtTime(w.x, t, 0.1)
      v.pan.positionY.setTargetAtTime(w.y, t, 0.1)
      v.pan.positionZ.setTargetAtTime(w.z, t, 0.1)
    }
    if (o.gain !== w.gain || Math.abs(v.muffle - m) > 0.01) v.input.gain.setTargetAtTime((w.gain ?? 1) * muffleGain(m), t, 0.2)
    if (Math.abs(v.muffle - m) > 0.01) v.filter.frequency.setTargetAtTime(cutoff(m), t, 0.15)
    v.muffle = m
    v.spec = w
  }
}

/* ---------- short sounds ---------- */

export interface ShotOpts {
  gain?: number
  bus?: Bus
  /** Sound specific variant (floor of a step, size of a dog) */
  v?: string
  ref?: number
  /** Moves the source here while the sound plays (passing car) */
  to?: { x: number; y?: number; z: number }
}

let alive = 0
const log: { name: string; at: number; played: boolean; x?: number; z?: number }[] = []

/** Plays a short sound: from `at` when given (positioned), else at the listener's ear (interface). */
export function play(name: ShotName, at?: { x: number; y?: number; z: number } | null, o: ShotOpts = {}) {
  const s = useSound.getState()
  const bus = o.bus ?? shotBus(name)
  const entry = { name, at: Math.round(performance.now()), played: false, x: at?.x, z: at?.z }
  log.push(entry)
  if (log.length > 120) log.shift()
  if (!ctx || !noise || ctx.state !== 'running' || !s.on || !s.buses[bus] || s.levels[bus] <= 0) return false
  if (alive > 28 || (name === 'step' && alive > 18)) return false
  const c = ctx
  const t = c.currentTime + 0.01
  const out = new GainNode(c, { gain: o.gain ?? 1 })
  let tail: AudioNode = out
  let pan: PannerNode | null = null
  if (at) {
    const y = at.y ?? 1
    if (Math.hypot(at.x - lp.x, y - lp.y, at.z - lp.z) > 45 && !o.to) return false
    const m = muffler?.(at.x, at.z) ?? 0
    if (m > 0.01) {
      out.gain.value *= muffleGain(m)
      const f = new BiquadFilterNode(c, { type: 'lowpass', frequency: cutoff(m), Q: 0.5 })
      tail.connect(f)
      tail = f
    }
    pan = panner(c, at.x, y, at.z, o.ref ?? 1.5)
    tail.connect(pan)
    tail = pan
  }
  tail.connect(buses[bus])
  alive++
  entry.played = true
  const last = tail
  const fire = (t0: number, dur: number) => {
    if (pan && o.to) {
      pan.positionX.linearRampToValueAtTime(o.to.x, t0 + dur)
      pan.positionZ.linearRampToValueAtTime(o.to.z, t0 + dur)
      if (o.to.y != null) pan.positionY.linearRampToValueAtTime(o.to.y, t0 + dur)
    }
    setTimeout(
      () => {
        alive--
        out.disconnect()
        last.disconnect()
      },
      (dur + 0.6) * 1000,
    )
  }
  const sid = shotSample(name, o.v)
  if (!sid) {
    fire(t, SHOTS[name](c, noise, out, t, o.v))
    return true
  }
  const bufs = readySample(c, sid)
  if (bufs?.length) {
    fire(t, playShotBuffers(c, out, t, sid, bufs, name, o.v))
    return true
  }
  // Recording not decoded yet: play it when it arrives (skip it if too late)
  const asked = performance.now()
  void loadSample(c, sid)
    .then((b) => {
      if (performance.now() - asked > 800 || !b.length) return fire(c.currentTime, 0)
      const t1 = c.currentTime + 0.01
      fire(t1, playShotBuffers(c, out, t1, sid, b, name, o.v))
    })
    .catch(() => fire(c.currentTime, 0))
  return true
}

/* ---------- lab, tests ---------- */

/** Sound lab: plays a sound directly, unpositioned (a continuous sound stops after `seconds`) */
export function audition(kind: 'voice' | 'shot', name: string, opt: { p?: number; v?: string; seconds?: number } = {}) {
  gestured = true
  unlock()
  if (!ctx || !noise || !master) return
  const out = new GainNode(ctx, { gain: 1 })
  out.connect(master)
  if (kind === 'voice') {
    const kit = new Kit(ctx, noise)
    startVoice(kit, out, name as VoiceName, opt.p ?? 0.5)
    setTimeout(
      () => {
        out.gain.setTargetAtTime(0, ctx!.currentTime, 0.1)
        setTimeout(() => {
          kit.stop()
          out.disconnect()
        }, 600)
      },
      (opt.seconds ?? 4) * 1000,
    )
  } else {
    const c = ctx
    const sid = shotSample(name as ShotName, opt.v)
    const go = (bufs?: AudioBuffer[]) => {
      const t = c.currentTime + 0.02
      const d = sid && bufs?.length ? playShotBuffers(c, out, t, sid, bufs, name as ShotName, opt.v) : SHOTS[name as ShotName](c, noise!, out, t, opt.v)
      setTimeout(() => out.disconnect(), (d + 0.5) * 1000)
    }
    if (sid) void loadSample(c, sid).then(go).catch(() => go())
    else go()
  }
}

/** Renders a sound offline and measures its level (level test): RMS of the active part and peak */
export async function measure(kind: 'voice' | 'shot', name: string, opt: { p?: number; v?: string; seconds?: number } = {}) {
  const sr = 22050
  const sec = opt.seconds ?? 4
  const off = new OfflineAudioContext(1, Math.floor(sr * sec), sr)
  const n = makeNoise(off)
  const out = new GainNode(off, { gain: 1 })
  out.connect(off.destination)
  let dur = sec
  if (kind === 'voice') {
    const id = voiceSample(name as VoiceName, opt.p ?? 0.5) ?? SCATTER[name as VoiceName]?.[0]
    if (hasSample(id)) await loadSample(off, id)
    startVoice(new Kit(off, n), out, name as VoiceName, opt.p ?? 0.5)
  } else {
    const sid = shotSample(name as ShotName, opt.v)
    dur = sid ? playShotBuffers(off, out, 0.05, sid, await loadSample(off, sid), name as ShotName, opt.v) : SHOTS[name as ShotName](off, n, out, 0.05, opt.v)
  }
  const buf = await off.startRendering()
  const d = buf.getChannelData(0)
  const end = Math.min(d.length, Math.floor((dur + 0.1) * sr))
  let sum = 0
  let peak = 0
  let nan = false
  for (let i = 0; i < end; i++) {
    const x = d[i]
    if (!Number.isFinite(x)) nan = true
    sum += x * x
    peak = Math.max(peak, Math.abs(x))
  }
  return { rms: Math.sqrt(sum / Math.max(1, end)), peak, nan, dur }
}

/** Tests and debugging (window.__homescape.sound()) */
export function soundDebug() {
  const s = useSound.getState()
  let rms = 0
  if (analyser && ctx?.state === 'running') {
    const a = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(a)
    rms = Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length)
  }
  return {
    on: s.on,
    volume: s.volume,
    buses: s.buses,
    levels: s.levels,
    /** Bus gain of each type (base share × level squared; 0 when off) */
    gains: Object.fromEntries(BUSES.map((b) => [b, buses[b] ? Math.round(buses[b].gain.value * 1000) / 1000 : null])),
    state: ctx?.state ?? 'none',
    time: ctx ? Math.round(ctx.currentTime * 1000) / 1000 : 0,
    listener: { x: lp.x, y: lp.y, z: lp.z },
    loops: [...live.values()].map((v) => ({ key: v.spec.key, voice: v.spec.voice, bus: v.spec.bus, muffle: Math.round(v.muffle * 100) / 100, x: v.spec.x, z: v.spec.z })),
    wanted: wanted.map((w) => ({ key: w.key, voice: w.voice, bus: w.bus })),
    log: log.slice(-80),
    rms,
    alive,
  }
}
