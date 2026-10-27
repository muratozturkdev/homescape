import { burst, chain, type Noise, rand, ring, semi, tone } from './dsp'

/*
 * Short sounds (one-shot): play once when something happens (light switch, door opening and closing, lock, doorbell, a
 * device's done melody, toilet flush, step, bark, interface). Each is scheduled at time t and returns its duration (s);
 * `v` is a sound specific variant (floor of a step, size of a dog). Level: peak ~0.2-0.5.
 */

export type ShotFn = (ctx: BaseAudioContext, n: Noise, out: AudioNode, t: number, v?: string) => number

/** Creak: trembling sawtooth through a narrow filter */
function creak(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, lo: number, hi: number, gain: number) {
  const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: lo })
  const curve = new Float32Array(24).map(() => rand(lo, hi))
  o.frequency.setValueCurveAtTime(curve, t, dur)
  const f = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000, Q: 4 })
  const g = new GainNode(ctx, { gain: 0 })
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.2)
  g.gain.setValueAtTime(gain, t + dur * 0.7)
  g.gain.linearRampToValueAtTime(0, t + dur)
  chain(o, f, g, out)
  o.start(t)
  o.stop(t + dur + 0.05)
}

/** Door latch: short metallic ring */
const latch = (ctx: BaseAudioContext, out: AudioNode, t: number, gain = 0.12) => ring(ctx, out, t, [rand(1700, 1900), rand(2800, 3000), rand(4000, 4300)], 0.07, gain)

/** Thud: a door closing, an item being placed */
function thud(ctx: BaseAudioContext, n: Noise, out: AudioNode, t: number, f: number, gain: number) {
  tone(ctx, out, t, { f0: f, f1: f * 0.58, dur: 0.3, gain })
  burst(ctx, n, out, t, { color: 'brown', type: 'lowpass', freq: 320, dur: 0.15, gain: gain * 0.9 })
}

/** Melody: notes (Hz) and their durations */
function melody(ctx: BaseAudioContext, out: AudioNode, t: number, notes: number[], d: number, gain: number, type: OscillatorType = 'sine') {
  notes.forEach((f, i) => tone(ctx, out, t + i * d, { type, f0: f, dur: d * 0.95, gain, hold: true, lowpass: 3500 }))
  return notes.length * d
}

/** Footstep; v: floor (wood, hard, soft, grass, gravel, water, deck, stairs) */
function step(ctx: BaseAudioContext, n: Noise, out: AudioNode, t: number, v = 'hard') {
  const g = rand(0.8, 1.15)
  switch (v) {
    case 'wood':
    case 'deck':
    case 'stairs':
      tone(ctx, out, t, { f0: rand(85, 110), f1: 55, dur: 0.07, gain: 0.22 * g * (v === 'stairs' ? 1.4 : 1) })
      burst(ctx, n, out, t, { freq: v === 'deck' ? 500 : 700, Q: 1.2, dur: 0.05, gain: 0.12 * g })
      if (Math.random() < 0.06) creak(ctx, out, t + 0.02, 0.25, 180, 320, 0.025)
      return 0.12
    case 'soft':
      burst(ctx, n, out, t, { color: 'pink', type: 'lowpass', freq: 320, dur: 0.07, gain: 0.2 * g })
      return 0.1
    case 'grass':
      burst(ctx, n, out, t, { freq: rand(2200, 3200), Q: 0.7, dur: 0.12, attack: 0.03, gain: 0.11 * g })
      burst(ctx, n, out, t, { color: 'pink', type: 'lowpass', freq: 250, dur: 0.05, gain: 0.06 * g })
      return 0.15
    case 'gravel':
      for (let i = 0; i < 9; i++) burst(ctx, n, out, t + rand(0, 0.11), { freq: rand(1500, 3500), Q: 1.5, dur: 0.012, gain: rand(0.07, 0.16) * g })
      burst(ctx, n, out, t, { color: 'pink', type: 'lowpass', freq: 300, dur: 0.06, gain: 0.08 * g })
      return 0.16
    case 'water':
      burst(ctx, n, out, t, { freq: 900, freqTo: 1600, Q: 0.8, dur: 0.22, attack: 0.02, gain: 0.12 * g })
      return 0.25
    default:
      // hard floor (tile, concrete, asphalt, stone): heel click and a light scuff
      burst(ctx, n, out, t, { type: 'highpass', freq: 1600, dur: 0.025, gain: 0.13 * g })
      tone(ctx, out, t, { f0: rand(140, 170), f1: 90, dur: 0.05, gain: 0.1 * g })
      burst(ctx, n, out, t + 0.03, { freq: 2500, Q: 0.8, dur: 0.05, gain: 0.03 * g })
      return 0.1
  }
}

/** Cat meow: glottal source with rising and falling pitch, gliding formant ("mi-aow"). v 'yawn': yawn (long, low) */
function meow(ctx: BaseAudioContext, out: AudioNode, t: number, v?: string) {
  const yawn = v === 'yawn'
  const d = yawn ? 1.1 : rand(0.55, 0.8)
  const p = rand(0.85, 1.2) * (yawn ? 0.75 : 1)
  const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 420 * p })
  o.frequency.setValueAtTime(420 * p, t)
  o.frequency.linearRampToValueAtTime(700 * p, t + d * 0.3)
  o.frequency.linearRampToValueAtTime(560 * p, t + d * 0.65)
  o.frequency.linearRampToValueAtTime(380 * p, t + d)
  const vib = new OscillatorNode(ctx, { frequency: 6 })
  vib.connect(new GainNode(ctx, { gain: 14 })).connect(o.frequency)
  const f1 = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 3 })
  f1.frequency.setValueAtTime(800, t)
  f1.frequency.linearRampToValueAtTime(1700, t + d * 0.35)
  f1.frequency.linearRampToValueAtTime(1000, t + d)
  const f2 = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2700, Q: 5 })
  const g = new GainNode(ctx, { gain: 0 })
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.5, t + 0.06)
  g.gain.setValueAtTime(0.45, t + d * 0.7)
  g.gain.linearRampToValueAtTime(0, t + d)
  o.connect(f1).connect(g)
  o.connect(f2).connect(new GainNode(ctx, { gain: 0.4 })).connect(g)
  g.connect(out)
  o.start(t)
  vib.start(t)
  o.stop(t + d + 0.05)
  vib.stop(t + d + 0.05)
  return d
}

/** Bark: v 'small' small dog (high), 'double' twice, 'sleepy' a single sleepy "woof?" */
function bark(ctx: BaseAudioContext, n: Noise, out: AudioNode, t: number, v?: string) {
  const small = v?.includes('small')
  const count = v?.includes('double') ? 2 : v?.includes('sleepy') ? 1 : Math.random() < 0.4 ? 2 : 1
  const p = (small ? 1.7 : 1) * rand(0.9, 1.1)
  for (let i = 0; i < count; i++) {
    const at = t + i * rand(0.28, 0.36)
    const d = 0.16
    const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 300 * p })
    o.frequency.setValueAtTime(330 * p, at)
    o.frequency.linearRampToValueAtTime(560 * p, at + d * 0.3)
    o.frequency.exponentialRampToValueAtTime(260 * p, at + d)
    const f = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000 * p, Q: 1.5 })
    const g = new GainNode(ctx, { gain: 0 })
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(v?.includes('sleepy') ? 0.25 : 0.5, at + 0.012)
    g.gain.setTargetAtTime(0, at + 0.05, 0.04)
    chain(o, f, g, out)
    o.start(at)
    o.stop(at + d + 0.1)
    burst(ctx, n, out, at, { freq: 1500 * p, Q: 0.8, dur: 0.1, gain: 0.18 })
  }
  return count * 0.36
}

export const SHOTS = {
  /* ---------- switches, doors, locks ---------- */
  /** Wall switch: press and release */
  click: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { freq: 2800, Q: 1.5, dur: 0.008, gain: 0.25 })
    tone(ctx, out, t, { f0: 300, f1: 200, dur: 0.02, gain: 0.06 })
    burst(ctx, n, out, t + 0.06, { freq: 3200, Q: 1.5, dur: 0.006, gain: 0.14 })
    return 0.1
  },
  /** Smart plug, relay */
  relay: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { type: 'highpass', freq: 1500, dur: 0.006, gain: 0.22 })
    ring(ctx, out, t, [3200, 4700], 0.03, 0.05)
    return 0.06
  },
  doorOpen: (ctx, n, out, t) => {
    latch(ctx, out, t)
    creak(ctx, out, t + 0.08, 0.7, 120, 260, 0.05)
    burst(ctx, n, out, t + 0.12, { color: 'pink', type: 'lowpass', freq: 600, dur: 0.5, attack: 0.2, gain: 0.08 })
    return 0.9
  },
  doorClose: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'pink', type: 'lowpass', freq: 700, dur: 0.18, attack: 0.1, gain: 0.07 })
    thud(ctx, n, out, t + 0.15, 85, 0.42)
    latch(ctx, out, t + 0.17, 0.08)
    return 0.55
  },
  windowOpen: (ctx, n, out, t) => {
    ring(ctx, out, t, [2200, 3400], 0.05, 0.06)
    burst(ctx, n, out, t + 0.05, { color: 'pink', freq: 1200, freqTo: 2000, Q: 0.8, dur: 0.5, attack: 0.15, gain: 0.08 })
    return 0.6
  },
  windowClose: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'pink', freq: 1800, freqTo: 1100, Q: 0.8, dur: 0.35, attack: 0.1, gain: 0.07 })
    tone(ctx, out, t + 0.33, { f0: 140, f1: 90, dur: 0.12, gain: 0.16 })
    ring(ctx, out, t + 0.36, [2300, 3500], 0.05, 0.05)
    return 0.5
  },
  /** Smart lock: motor whine and the thud of the bolt */
  lock: (ctx, n, out, t) => {
    tone(ctx, out, t, { type: 'sawtooth', f0: 300, f1: 340, dur: 0.35, gain: 0.04, hold: true, lowpass: 1500, linear: true })
    tone(ctx, out, t + 0.35, { f0: 160, f1: 90, dur: 0.08, gain: 0.25 })
    burst(ctx, n, out, t + 0.35, { freq: 1500, dur: 0.02, gain: 0.15 })
    return 0.5
  },
  unlock: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 180, f1: 100, dur: 0.07, gain: 0.22 })
    burst(ctx, n, out, t, { freq: 1700, dur: 0.02, gain: 0.14 })
    tone(ctx, out, t + 0.06, { type: 'sawtooth', f0: 340, f1: 300, dur: 0.35, gain: 0.04, hold: true, lowpass: 1500, linear: true })
    return 0.45
  },
  /** Doorbell: "ding dong" */
  dingDong: (ctx, _n, out, t) => {
    for (const [f, at] of [
      [659.3, 0],
      [523.3, 0.55],
    ]) {
      tone(ctx, out, t + at, { f0: f, dur: 1.6, gain: 0.22 })
      tone(ctx, out, t + at, { f0: f * 2, dur: 1, gain: 0.05 })
      tone(ctx, out, t + at, { f0: f * 3.01, dur: 0.6, gain: 0.02 })
    }
    return 2.2
  },
  /** Cabinet door: magnetic latch, short creak; a soft thud when closing */
  cabinetOpen: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { freq: 1800, Q: 2, dur: 0.012, gain: 0.16 })
    creak(ctx, out, t + 0.04, 0.28, 200, 380, 0.025)
    burst(ctx, n, out, t + 0.05, { color: 'pink', type: 'lowpass', freq: 500, dur: 0.3, attack: 0.1, gain: 0.05 })
    return 0.4
  },
  cabinetClose: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'pink', type: 'lowpass', freq: 600, dur: 0.15, attack: 0.08, gain: 0.04 })
    tone(ctx, out, t + 0.12, { f0: 150, f1: 95, dur: 0.12, gain: 0.2 })
    burst(ctx, n, out, t + 0.12, { freq: 1600, Q: 2, dur: 0.01, gain: 0.12 })
    return 0.3
  },
  /** Drawer: sliding on a wooden runner, a light knock at the end */
  drawerOpen: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'pink', freq: 700, freqTo: 1100, Q: 0.9, dur: 0.32, attack: 0.05, gain: 0.14 })
    tone(ctx, out, t + 0.3, { f0: 190, f1: 130, dur: 0.05, gain: 0.1 })
    return 0.4
  },
  drawerClose: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'pink', freq: 1100, freqTo: 700, Q: 0.9, dur: 0.26, attack: 0.04, gain: 0.13 })
    tone(ctx, out, t + 0.25, { f0: 160, f1: 100, dur: 0.1, gain: 0.2 })
    return 0.4
  },
  /** Coffee machine grinder (when turned on) */
  grind: (ctx, n, out, t) => {
    tone(ctx, out, t, { type: 'sawtooth', f0: 170, f1: 185, dur: 2.6, gain: 0.05, hold: true, lowpass: 1400, linear: true })
    for (let i = 0; i < 70; i++) burst(ctx, n, out, t + rand(0.05, 2.5), { freq: rand(1800, 4200), Q: 1.5, dur: 0.012, gain: rand(0.05, 0.14) })
    burst(ctx, n, out, t, { color: 'pink', freq: 2200, Q: 0.7, dur: 2.6, attack: 0.1, gain: 0.08 })
    return 2.7
  },
  /** Smart button */
  button: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { freq: 3500, Q: 2, dur: 0.005, gain: 0.3 })
    return 0.03
  },

  /* ---------- device beeps and melodies ---------- */
  tvOn: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'brown', type: 'lowpass', freq: 200, dur: 0.04, gain: 0.2 })
    tone(ctx, out, t + 0.2, { f0: 880, dur: 0.4, gain: 0.06 })
    tone(ctx, out, t + 0.32, { f0: 1318.5, dur: 0.5, gain: 0.05 })
    return 0.9
  },
  tvOff: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { color: 'brown', type: 'lowpass', freq: 200, dur: 0.03, gain: 0.12 })
    tone(ctx, out, t, { f0: 600, f1: 300, dur: 0.15, gain: 0.05 })
    return 0.2
  },
  beep: (ctx, _n, out, t) => {
    tone(ctx, out, t, { f0: 2000, dur: 0.08, gain: 0.12, hold: true })
    return 0.1
  },
  /** AC remote: one beep when turning on, two when turning off */
  acOn: (ctx, _n, out, t) => {
    tone(ctx, out, t, { f0: 2400, dur: 0.07, gain: 0.1, hold: true })
    return 0.1
  },
  acOff: (ctx, _n, out, t) => {
    tone(ctx, out, t, { f0: 2400, dur: 0.06, gain: 0.1, hold: true })
    tone(ctx, out, t + 0.12, { f0: 2400, dur: 0.06, gain: 0.1, hold: true })
    return 0.2
  },
  /** Washer or dishwasher done */
  done: (ctx, _n, out, t) => melody(ctx, out, t, [784, 988, 1175, 1568, 1175, 1568], 0.18, 0.06, 'square'),
  /** Microwave done: three long beeps */
  microDone: (ctx, _n, out, t) => {
    for (let i = 0; i < 3; i++) tone(ctx, out, t + i * 0.45, { f0: 1000, dur: 0.25, gain: 0.1, hold: true })
    return 1.2
  },
  /** Kettle or coffee machine turned off: the "click" of the switch */
  kettleClick: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { freq: 1500, Q: 1.2, dur: 0.012, gain: 0.22 })
    tone(ctx, out, t, { f0: 400, f1: 250, dur: 0.04, gain: 0.08 })
    return 0.06
  },
  botStart: (ctx, _n, out, t) => melody(ctx, out, t, [880, 1108.7, 1318.5], 0.12, 0.08),
  botDock: (ctx, _n, out, t) => melody(ctx, out, t, [1318.5, 1108.7, 880], 0.12, 0.08),
  /** Alarm armed, disarmed */
  armed: (ctx, _n, out, t) => melody(ctx, out, t, [660, 990], 0.18, 0.1),
  disarmed: (ctx, _n, out, t) => melody(ctx, out, t, [990, 660], 0.18, 0.1),
  /** Pet feeder: motor and falling kibble */
  kibble: (ctx, n, out, t) => {
    tone(ctx, out, t, { type: 'sawtooth', f0: 220, f1: 240, dur: 0.5, gain: 0.03, hold: true, lowpass: 1200, linear: true })
    for (let i = 0; i < 22; i++) burst(ctx, n, out, t + 0.15 + rand(0, 0.6), { freq: rand(2500, 5000), Q: 2, dur: 0.008, gain: rand(0.1, 0.22) })
    return 0.9
  },
  /** Water valve: thud and the rush of water */
  valve: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 150, f1: 90, dur: 0.1, gain: 0.2 })
    burst(ctx, n, out, t + 0.05, { freq: 1500, Q: 0.6, dur: 0.6, attack: 0.05, gain: 0.1 })
    return 0.7
  },
  /** Toilet flush: lever, rushing water, gurgle, hiss while the tank refills */
  flush: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 200, f1: 120, dur: 0.06, gain: 0.15 })
    burst(ctx, n, out, t + 0.1, { freq: 900, freqTo: 450, Q: 0.6, dur: 3.2, attack: 0.25, gain: 0.32 })
    for (let i = 0; i < 14; i++) {
      const f = rand(150, 420)
      tone(ctx, out, t + 1 + rand(0, 2), { f0: f, f1: f * 1.8, dur: 0.05, gain: 0.05 })
    }
    burst(ctx, n, out, t + 2.6, { type: 'highpass', freq: 3000, dur: 4, attack: 1, gain: 0.05 })
    return 6.8
  },

  /* ---------- people and animals ---------- */
  step,
  meow: (ctx, _n, out, t, v) => meow(ctx, out, t, v),
  bark,
  /** Short cat purr (when petted) */
  purr: (ctx, n, out, t) => {
    const s = new AudioBufferSourceNode(ctx, { buffer: n.brown, loop: true })
    const g = new GainNode(ctx, { gain: 0 })
    const am = new GainNode(ctx, { gain: 0.5 })
    const lfo = new OscillatorNode(ctx, { type: 'square', frequency: 26 })
    lfo.connect(new GainNode(ctx, { gain: 0.5 })).connect(am.gain)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.25, t + 0.3)
    g.gain.setValueAtTime(0.25, t + 2.4)
    g.gain.linearRampToValueAtTime(0, t + 2.9)
    chain(s, new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 170 }), am, g, out)
    s.start(t)
    lfo.start(t)
    s.stop(t + 3)
    lfo.stop(t + 3)
    return 3
  },
  hiss: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { type: 'highpass', freq: 2500, dur: 0.9, attack: 0.05, gain: 0.25 })
    burst(ctx, n, out, t + 0.75, { freq: 2000, dur: 0.06, gain: 0.25 })
    return 1
  },
  /** A toy squeaks when squeezed */
  squeak: (ctx, _n, out, t) => {
    tone(ctx, out, t, { f0: 1800, f1: 2600, dur: 0.08, gain: 0.1, linear: true })
    tone(ctx, out, t + 0.08, { f0: 2600, f1: 2000, dur: 0.1, gain: 0.08, linear: true })
    return 0.2
  },
  /** An animal landing after a jump, an item falling */
  land: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 120, f1: 70, dur: 0.08, gain: 0.12 })
    burst(ctx, n, out, t, { color: 'pink', type: 'lowpass', freq: 400, dur: 0.05, gain: 0.08 })
    return 0.1
  },

  /* ---------- outdoors ---------- */
  /** Passing car: engine and tire hum; the engine moves the position (play(..., { to })) */
  carPass: (ctx, n, out, t, v) => {
    const dur = Number(v) || 5
    const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 88 })
    o.frequency.setValueAtTime(88, t)
    o.frequency.setTargetAtTime(70, t + dur / 2, 0.25)
    const g = new GainNode(ctx, { gain: 0 })
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + dur * 0.3)
    g.gain.setValueAtTime(0.5, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0, t + dur)
    chain(o, new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 450 }), new GainNode(ctx, { gain: 0.25 }), g)
    const s = new AudioBufferSourceNode(ctx, { buffer: n.pink, loop: true })
    chain(s, new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 750, Q: 0.6 }), new GainNode(ctx, { gain: 0.5 }), g)
    g.connect(out)
    o.start(t)
    s.start(t, rand(0, 2))
    o.stop(t + dur + 0.05)
    s.stop(t + dur + 0.05)
    return dur
  },
  /** Owl: two soft hoots (without a recording) */
  owl: (ctx, _n, out, t) => {
    for (const [d, f] of [
      [0, 390],
      [0.55, 370],
    ])
      tone(ctx, out, t + d, { f0: f, f1: f - 30, dur: 0.38, gain: 0.08 })
    return 1
  },
  /** A dog barking in the distance */
  barkFar: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { type: 'bandpass', freq: 650, Q: 1.2, dur: 0.12, gain: 0.12 })
    return 0.2
  },
  /** Trampoline springs (a child landing) */
  trampoline: (ctx, _n, out, t) => {
    tone(ctx, out, t, { f0: 180, f1: 320, dur: 0.18, gain: 0.08 })
    return 0.22
  },
  thunder: (ctx, n, out, t) => {
    const d = rand(3, 5)
    burst(ctx, n, out, t, { color: 'brown', type: 'lowpass', freq: 320, freqTo: 110, dur: d, attack: 0.08, gain: 0.7 })
    if (Math.random() < 0.5) burst(ctx, n, out, t, { freq: 1500, Q: 0.5, dur: 0.3, gain: 0.25 })
    return d
  },

  /* ---------- interface ---------- */
  place: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 220, f1: 170, dur: 0.09, gain: 0.22 })
    burst(ctx, n, out, t, { freq: 1800, dur: 0.01, gain: 0.07 })
    return 0.12
  },
  placeRoom: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 140, f1: 90, dur: 0.16, gain: 0.28 })
    burst(ctx, n, out, t, { color: 'brown', type: 'lowpass', freq: 500, dur: 0.08, gain: 0.14 })
    return 0.2
  },
  remove: (ctx, n, out, t) => {
    tone(ctx, out, t, { f0: 620, f1: 240, dur: 0.12, gain: 0.1 })
    burst(ctx, n, out, t, { type: 'highpass', freq: 3000, freqTo: 800, dur: 0.1, gain: 0.04 })
    return 0.15
  },
  rotate: (ctx, n, out, t) => {
    burst(ctx, n, out, t, { freq: 2600, Q: 3, dur: 0.01, gain: 0.18 })
    tone(ctx, out, t, { f0: 900, dur: 0.02, gain: 0.05 })
    return 0.04
  },
  deny: (ctx, _n, out, t) => {
    tone(ctx, out, t, { type: 'square', f0: 140, dur: 0.12, gain: 0.08, hold: true, lowpass: 600 })
    tone(ctx, out, t + 0.16, { type: 'square', f0: 130, dur: 0.14, gain: 0.08, hold: true, lowpass: 600 })
    return 0.32
  },
  /** Mode change, panel opening: two soft notes */
  chime: (ctx, _n, out, t) => {
    tone(ctx, out, t, { f0: 660 * semi(0), dur: 0.25, gain: 0.04 })
    tone(ctx, out, t + 0.07, { f0: 660 * semi(7), dur: 0.3, gain: 0.035 })
    return 0.4
  },
} satisfies Record<string, ShotFn>

export type ShotName = keyof typeof SHOTS
export const SHOT_NAMES = Object.keys(SHOTS) as ShotName[]
