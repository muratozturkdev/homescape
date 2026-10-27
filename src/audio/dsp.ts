/*
 * Building blocks of sound synthesis (audio/engine.ts, voices.ts, shots.ts): noise buffers (white, pink, brown), node
 * builders, envelope, event scheduler. All take a BaseAudioContext: the same sound plays in a live AudioContext and renders
 * in an OfflineAudioContext (sound lab and level test; dev/SoundLab.tsx, tools/sound-check.mjs).
 */

export interface Noise {
  white: AudioBuffer
  pink: AudioBuffer
  brown: AudioBuffer
}

/** Loopable 3 s noises: white, pink (Paul Kellet filter), brown (integrated white). */
export function makeNoise(ctx: BaseAudioContext): Noise {
  const len = Math.floor(ctx.sampleRate * 3)
  const mk = () => ctx.createBuffer(1, len, ctx.sampleRate)
  const white = mk()
  const pink = mk()
  const brown = mk()
  const w = white.getChannelData(0)
  const p = pink.getChannelData(0)
  const b = brown.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  let last = 0
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1
    w[i] = x
    b0 = 0.99886 * b0 + x * 0.0555179
    b1 = 0.99332 * b1 + x * 0.0750759
    b2 = 0.969 * b2 + x * 0.153852
    b3 = 0.8665 * b3 + x * 0.3104856
    b4 = 0.55 * b4 + x * 0.5329522
    b5 = -0.7616 * b5 - x * 0.016898
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11
    b6 = x * 0.115926
    last = (last + 0.02 * x) / 1.02
    b[i] = last * 3.5
  }
  // No click at the loop seam: crossfade the ends over a short time
  for (const d of [p, b]) {
    const n = Math.floor(ctx.sampleRate * 0.02)
    for (let i = 0; i < n; i++) {
      const k = i / n
      d[len - 1 - i] = d[len - 1 - i] * k + d[i] * (1 - k)
    }
  }
  return { white, pink, brown }
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)
export const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]
/** Semitones: frequency factor */
export const semi = (n: number) => Math.pow(2, n / 12)
export const isOffline = (ctx: BaseAudioContext) => typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext

/**
 * Event scheduler: fn(t) schedules an event at time t and returns the time of the next one (null: done). Live, every 100 ms
 * it schedules 0.3 s ahead (events left behind while the tab sleeps are skipped); offline rendering schedules all upfront.
 */
export function every(ctx: BaseAudioContext, start: number, fn: (t: number) => number | null): () => void {
  let next: number | null = start
  const offline = isOffline(ctx)
  const horizon = () => (offline ? (ctx as OfflineAudioContext).length / ctx.sampleRate : ctx.currentTime + 0.3)
  const pump = () => {
    const h = horizon()
    let guard = 0
    while (next != null && next < h && guard++ < 400) next = fn(Math.max(next, offline ? 0 : ctx.currentTime + 0.01))
  }
  pump()
  if (offline) return () => {}
  const id = setInterval(pump, 100)
  return () => clearInterval(id)
}

/** Connects the nodes in order, returns the last one. */
export function chain<T extends AudioNode>(...nodes: [...AudioNode[], T]): T {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
  return nodes[nodes.length - 1] as T
}

/**
 * Continuous sound builder: collects sources and timers, stop() silences them all. All nodes of a sound connect to `out`;
 * the engine routes `out` (muffling filter, position, bus).
 */
export class Kit {
  private srcs: AudioScheduledSourceNode[] = []
  private timers: (() => void)[] = []
  /** Whether stop() was called (a recording that arrives late must not start) */
  stopped = false
  ctx: BaseAudioContext
  n: Noise
  constructor(ctx: BaseAudioContext, n: Noise) {
    this.ctx = ctx
    this.n = n
  }
  get t() {
    return this.ctx.currentTime
  }
  noise(color: keyof Noise = 'white', rate = 1) {
    const buf = this.n[color]
    const s = new AudioBufferSourceNode(this.ctx, { buffer: buf, loop: true, playbackRate: rate })
    s.start(this.t, Math.random() * buf.duration)
    this.srcs.push(s)
    return s
  }
  osc(type: OscillatorType, freq: number, detune = 0) {
    const o = new OscillatorNode(this.ctx, { type, frequency: freq, detune })
    o.start(this.t)
    this.srcs.push(o)
    return o
  }
  filter(type: BiquadFilterType, freq: number, Q = 0.7) {
    return new BiquadFilterNode(this.ctx, { type, frequency: freq, Q })
  }
  gain(v = 1) {
    return new GainNode(this.ctx, { gain: v })
  }
  /** Modulates a parameter with an oscillator: param += sin(rate) * depth */
  lfo(rate: number, depth: number, param: AudioParam, type: OscillatorType = 'sine') {
    const o = this.osc(type, rate)
    o.connect(this.gain(depth)).connect(param)
    return o
  }
  /**
   * Slow random walk: every `step` seconds the parameter glides to a new value in [lo, hi] (wind strength, machine load).
   */
  wander(param: AudioParam, lo: number, hi: number, step: number, smooth = step / 3) {
    this.every(this.t, (t) => {
      param.setTargetAtTime(rand(lo, hi), t, smooth)
      return t + step * rand(0.6, 1.4)
    })
  }
  every(start: number, fn: (t: number) => number | null) {
    this.timers.push(every(this.ctx, start, fn))
  }
  /** Tracks a source built outside (stop() stops it too); if the sound already stopped, stops the source now and returns false */
  track(s: AudioScheduledSourceNode) {
    if (this.stopped) {
      try {
        s.stop()
      } catch {
        /* not started */
      }
      return false
    }
    this.srcs.push(s)
    return true
  }
  stop() {
    this.stopped = true
    for (const s of this.srcs) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    for (const f of this.timers) f()
    this.srcs = []
    this.timers = []
  }
}

/* ---------- single events (short sounds and hits inside continuous sounds) ---------- */

export interface BurstOpts {
  color?: keyof Noise
  type?: BiquadFilterType
  freq: number
  Q?: number
  dur: number
  gain: number
  attack?: number
  /** The filter frequency glides here over the duration */
  freqTo?: number
  rate?: number
}

/** Filtered noise hit: click, step, rustle, crackle. */
export function burst(ctx: BaseAudioContext, n: Noise, out: AudioNode, t: number, o: BurstOpts) {
  const buf = n[o.color ?? 'white']
  const s = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: o.rate ?? 1 })
  const f = new BiquadFilterNode(ctx, { type: o.type ?? 'bandpass', frequency: o.freq, Q: o.Q ?? 1 })
  if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + o.dur)
  const g = new GainNode(ctx, { gain: 0 })
  const a = o.attack ?? 0.002
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(o.gain, t + a)
  g.gain.setTargetAtTime(0, t + a, Math.max(0.001, (o.dur - a) / 4))
  chain(s, f, g, out)
  s.start(t, Math.random() * Math.max(0, buf.duration - o.dur * (o.rate ?? 1) - 0.1))
  s.stop(t + o.dur + 0.05)
}

export interface ToneOpts {
  type?: OscillatorType
  f0: number
  f1?: number
  dur: number
  gain: number
  attack?: number
  /** true: steady for the duration, short release at the end (beep); false: exponential decay (hit) */
  hold?: boolean
  /** Pitch glide: linear (true) or exponential */
  linear?: boolean
  lowpass?: number
}

/** Tone with a pitch glide: beep, thump (kick), bird chirp. */
export function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts) {
  const osc = new OscillatorNode(ctx, { type: o.type ?? 'sine', frequency: o.f0 })
  if (o.f1 && o.f1 !== o.f0) {
    if (o.linear) osc.frequency.linearRampToValueAtTime(o.f1, t + o.dur)
    else osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur)
  }
  const g = new GainNode(ctx, { gain: 0 })
  const a = o.attack ?? 0.004
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(o.gain, t + a)
  if (o.hold) {
    g.gain.setValueAtTime(o.gain, t + Math.max(a, o.dur - 0.015))
    g.gain.linearRampToValueAtTime(0, t + o.dur)
  } else g.gain.setTargetAtTime(0, t + a, Math.max(0.002, (o.dur - a) / 4))
  if (o.lowpass) chain(osc, new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lowpass, Q: 0.7 }), g, out)
  else chain(osc, g, out)
  osc.start(t)
  osc.stop(t + o.dur + 0.05)
}

/** Ringing with inharmonic partials: metal (cutlery, latch), ceramic (plate), glass (bottle). */
export function ring(ctx: BaseAudioContext, out: AudioNode, t: number, freqs: number[], dur: number, gain: number) {
  freqs.forEach((f, i) => tone(ctx, out, t, { f0: f * rand(0.98, 1.02), dur: dur * (1 - i * 0.15), gain: gain / (1 + i * 0.6), attack: 0.001 }))
}

/** Drives a parameter with an envelope: from 0 to peak at t, then exponential decay */
export function env(p: AudioParam, t: number, peak: number, attack: number, decay: number, base = 0) {
  p.setValueAtTime(base, t)
  p.linearRampToValueAtTime(peak, t + attack)
  p.setTargetAtTime(base, t + attack, decay / 4)
}
