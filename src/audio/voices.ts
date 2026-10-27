import { burst, chain, type Kit, rand, ring, tone } from './dsp'
import { music, talk } from './music'

/*
 * Continuous sounds (loops): they play while a condition lasts (device on, a person washing dishes, crickets at night).
 * Each sound builds its own nodes from the Kit and connects them to `out`; the engine (audio/engine.ts) handles position,
 * muffling and level. p: sound specific parameter (fan speed, rain intensity, snoring, dog or cat...). Levels are balanced
 * with tools/sound-check.mjs: each sound's own output is ~0.03-0.15 RMS.
 */

export type VoiceFn = (k: Kit, out: AudioNode, p: number) => void

/** Mains hum (100 Hz on a 50 Hz grid) */
const hum = (k: Kit, out: AudioNode, g: number, f = 100) => k.osc('sine', f).connect(k.gain(g)).connect(out)

/** Running water: from a narrow tap (p 0) to a wide shower (p 1); the hiss fluctuates fast, with splashes */
function water(k: Kit, out: AudioNode, p: number) {
  const g = k.gain(0.2 + 0.08 * p)
  chain(k.noise('white'), k.filter('highpass', 380), k.filter('bandpass', 1700 + 1500 * p, 0.45), g, out)
  k.wander(g.gain, 0.15 + 0.06 * p, 0.26 + 0.1 * p, 0.05, 0.015)
  chain(k.noise('pink'), k.filter('lowpass', 600), k.gain(0.04 + 0.05 * p), out)
  k.every(k.t, (t) => {
    burst(k.ctx, k.n, out, t, { freq: rand(1500, 4200), Q: 2, dur: 0.02, gain: rand(0.03, 0.07) })
    return t + rand(0.03, 0.11)
  })
}

/** Bubble: short tone with rising pitch */
const bubble = (k: Kit, out: AudioNode, t: number, lo: number, hi: number, gain: number) => {
  const f = rand(lo, hi)
  tone(k.ctx, out, t, { f0: f, f1: f * rand(1.7, 2.4), dur: rand(0.018, 0.035), gain, attack: 0.002 })
}

/** Bird chirp phrases: sparrow, thrush song, great tit "tee-cher" */
function birdPhrase(k: Kit, out: AudioNode, t: number, gain: number) {
  const kind = Math.floor(rand(0, 3))
  if (kind === 0) {
    const n = Math.floor(rand(3, 7))
    for (let i = 0; i < n; i++) {
      const f = rand(3600, 4600)
      tone(k.ctx, out, t + i * rand(0.08, 0.12), { f0: f, f1: f * rand(1.15, 1.45), dur: 0.05, gain: gain * rand(0.7, 1) })
    }
    return t + n * 0.11
  }
  if (kind === 1) {
    const n = Math.floor(rand(6, 11))
    let at = t
    for (let i = 0; i < n; i++) {
      const f = rand(2300, 4400)
      const d = rand(0.06, 0.13)
      tone(k.ctx, out, at, { f0: f, f1: f * rand(0.8, 1.25), dur: d, gain: gain * rand(0.5, 0.9), attack: 0.01 })
      at += d + rand(0.01, 0.05)
    }
    return at
  }
  const n = Math.floor(rand(2, 5))
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.3
    tone(k.ctx, out, at, { f0: 5200, f1: 4300, dur: 0.09, gain: gain * 0.8 })
    tone(k.ctx, out, at + 0.12, { f0: 3900, f1: 3700, dur: 0.1, gain: gain * 0.7 })
  }
  return t + n * 0.3
}

/** Keyboard: bursts of 3 to 12 keys with pauses; now and then the space bar and a mouse click */
function typing(k: Kit, out: AudioNode) {
  let left = 0
  k.every(k.t + rand(0, 0.5), (t) => {
    if (left <= 0) {
      left = Math.floor(rand(3, 13))
      if (Math.random() < 0.2) {
        burst(k.ctx, k.n, out, t, { freq: 4200, Q: 3, dur: 0.006, gain: 0.08 })
        burst(k.ctx, k.n, out, t + 0.11, { freq: 4200, Q: 3, dur: 0.006, gain: 0.07 })
      }
      return t + rand(0.3, 1.5)
    }
    left--
    if (Math.random() < 0.12) {
      burst(k.ctx, k.n, out, t, { freq: 1500, Q: 1.2, dur: 0.03, gain: 0.16 })
      tone(k.ctx, out, t, { f0: 170, f1: 120, dur: 0.04, gain: 0.07 })
    } else {
      burst(k.ctx, k.n, out, t, { freq: rand(2600, 4600), Q: 2, dur: 0.012, gain: rand(0.09, 0.16) })
      tone(k.ctx, out, t, { f0: rand(260, 380), f1: 200, dur: 0.02, gain: 0.04 })
    }
    return t + rand(0.07, 0.17)
  })
}

export const VOICES = {
  /* ---------- kitchen and appliances ---------- */
  /** Fridge: compressor hum that slowly swells and fades (runs even when not connected) */
  fridge: (k, out) => {
    const g = k.gain(1)
    g.connect(out)
    hum(k, g, 0.035)
    hum(k, g, 0.012, 200)
    k.osc('triangle', 50).connect(k.gain(0.018)).connect(g)
    chain(k.noise('brown'), k.filter('lowpass', 240), k.gain(0.12), g)
    k.wander(g.gain, 0.7, 1.1, 7)
  },
  /** Fridge door open: hum and clinking bottles and jars */
  fridgeOpen: (k, out) => {
    hum(k, out, 0.03)
    chain(k.noise('pink'), k.filter('lowpass', 700), k.gain(0.06), out)
    k.every(k.t + 0.3, (t) => {
      ring(k.ctx, out, t, [rand(2300, 2800), rand(3500, 4000), rand(5400, 6200)], 0.35, 0.05)
      return t + rand(0.7, 2.2)
    })
  },
  washer: (k, out) => {
    const g = k.gain(0.32)
    chain(k.noise('brown'), k.filter('lowpass', 170), g, out)
    k.lfo(0.45, 0.14, g.gain)
    const slosh = k.gain(0)
    chain(k.noise('pink'), k.filter('bandpass', 700, 0.8), slosh, out)
    k.every(k.t, (t) => {
      slosh.gain.setTargetAtTime(rand(0.12, 0.22), t, 0.25)
      slosh.gain.setTargetAtTime(0.02, t + 0.9, 0.35)
      return t + rand(1.8, 2.6)
    })
    const m = k.gain(0.01)
    k.osc('sine', 260).connect(m).connect(out)
    k.wander(m.gain, 0.004, 0.016, 4)
  },
  dryer: (k, out) => {
    chain(k.noise('pink'), k.filter('lowpass', 1200), k.gain(0.18), out)
    chain(k.noise('brown'), k.filter('lowpass', 120), k.gain(0.28), out)
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { color: 'brown', type: 'lowpass', freq: 320, dur: 0.12, gain: rand(0.2, 0.4) })
      tone(k.ctx, out, t, { f0: 75, f1: 50, dur: 0.1, gain: 0.1 })
      if (Math.random() < 0.15) ring(k.ctx, out, t + 0.02, [2200, 3300], 0.08, 0.04)
      return t + rand(0.55, 1.4)
    })
  },
  dishwasher: (k, out) => {
    const spray = k.gain(0.16)
    chain(k.noise('white'), k.filter('bandpass', 1400, 0.6), spray, out)
    k.lfo(0.3, 0.07, spray.gain)
    chain(k.noise('brown'), k.filter('lowpass', 150), k.gain(0.16), out)
    hum(k, out, 0.01)
  },
  microwave: (k, out) => {
    chain(k.osc('sawtooth', 100), k.filter('lowpass', 500), k.gain(0.035), out)
    hum(k, out, 0.02, 200)
    chain(k.noise('pink'), k.filter('lowpass', 1400), k.gain(0.18), out)
    chain(k.noise('brown'), k.filter('lowpass', 100), k.gain(0.08), out)
  },
  /** Coffee machine: vibrating pump buzz, steam hiss, drips */
  coffee: (k, out) => {
    const pump = k.gain(0.11)
    chain(k.osc('sawtooth', 50), k.filter('lowpass', 380), pump, out)
    k.lfo(3, 0.03, pump.gain)
    const hiss = k.gain(0.04)
    chain(k.noise('white'), k.filter('highpass', 2600), hiss, out)
    k.wander(hiss.gain, 0.01, 0.1, 0.8)
    k.every(k.t + 0.5, (t) => {
      tone(k.ctx, out, t, { f0: rand(800, 1100), f1: 1700, dur: 0.04, gain: 0.03 })
      return t + rand(0.3, 0.8)
    })
  },
  /** Boiling kettle: rumble, boiling crackle, hiss */
  kettle: (k, out) => {
    const r = k.gain(0.22)
    chain(k.noise('brown'), k.filter('lowpass', 320), r, out)
    k.wander(r.gain, 0.14, 0.3, 1.2)
    chain(k.noise('white'), k.filter('highpass', 3000), k.gain(0.05), out)
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: rand(1200, 3000), dur: 0.01, gain: rand(0.04, 0.11) })
      return t + rand(0.02, 0.12)
    })
  },
  /** Small device heating with a fan: air fryer, oven, heater */
  ovenFan: (k, out) => {
    chain(k.noise('pink'), k.filter('lowpass', 1600), k.gain(0.2), out)
    chain(k.noise('brown'), k.filter('lowpass', 150), k.gain(0.08), out)
    hum(k, out, 0.012)
  },
  /** Sizzle in a pan (stove on, a person stirring, grill) */
  sizzle: (k, out) => {
    const g = k.gain(0.12)
    chain(k.noise('white'), k.filter('highpass', 2400), g, out)
    k.wander(g.gain, 0.05, 0.2, 0.06, 0.02)
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: 3000, dur: 0.008, gain: rand(0.08, 0.3) })
      return t + rand(0.04, 0.3)
    })
  },
  /** A person chopping: dull knife hits on the board */
  chop: (k, out) => {
    k.every(k.t + rand(0, 0.4), (t) => {
      if (Math.random() < 0.13) return t + rand(1, 2.5)
      tone(k.ctx, out, t, { f0: rand(180, 240), f1: 110, dur: 0.06, gain: 0.2 })
      burst(k.ctx, k.n, out, t, { freq: 900, Q: 1, dur: 0.04, gain: 0.16 })
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: 3500, dur: 0.008, gain: 0.06 })
      return t + rand(0.3, 0.46)
    })
  },
  /** Dishes: tap and clinking plates and glasses */
  dishes: (k, out) => {
    water(k, out, 0)
    k.every(k.t + 0.4, (t) => {
      if (Math.random() < 0.5) ring(k.ctx, out, t, [rand(1100, 1500), rand(2600, 3200)], 0.3, 0.09)
      else ring(k.ctx, out, t, [rand(2700, 3000), rand(4000, 4300), rand(6000, 6400)], 0.4, 0.05)
      return t + rand(0.8, 2.6)
    })
  },
  /** Cutlery touching plates while eating */
  cutlery: (k, out) => {
    k.every(k.t + rand(0, 1), (t) => {
      if (Math.random() < 0.7) ring(k.ctx, out, t, [rand(2000, 2600), rand(3200, 4200), rand(5200, 6600)], 0.22, 0.07)
      else ring(k.ctx, out, t, [rand(850, 1000), rand(1800, 2100)], 0.2, 0.06)
      return t + rand(1.1, 4)
    })
  },

  /* ---------- water ---------- */
  tap: (k, out) => water(k, out, 0),
  shower: (k, out) => water(k, out, 1),
  fountain: (k, out) => {
    const g = k.gain(0.35)
    chain(k.noise('pink'), k.filter('bandpass', 1200, 0.5), g, out)
    k.wander(g.gain, 0.26, 0.45, 0.3)
    k.every(k.t, (t) => {
      tone(k.ctx, out, t, { f0: rand(900, 2400), f1: rand(1400, 3600), dur: 0.03, gain: 0.06 })
      return t + rand(0.04, 0.2)
    })
  },
  /** Impact sprinkler: turns with a "tick tick", fast return at the end */
  sprinkler: (k, out) => {
    chain(k.noise('white'), k.filter('highpass', 2600), k.gain(0.04), out)
    let n = 0
    k.every(k.t, (t) => {
      n++
      const back = n % 34 > 20
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: 2800, dur: back ? 0.012 : 0.03, gain: back ? 0.09 : 0.18 })
      return t + (back ? 0.045 : 0.17)
    })
  },
  /** Bubbles: p 1 hot tub, p 0 aquarium */
  bubbles: (k, out, p) => {
    chain(k.noise('brown'), k.filter('lowpass', 380), k.gain(0.06 + 0.16 * p), out)
    hum(k, out, 0.008)
    k.every(k.t, (t) => {
      bubble(k, out, t, 300, 800, 0.03 + 0.04 * p)
      return t + rand(0.02, 0.1) / (0.3 + p)
    })
  },
  aquarium: (k, out) => {
    hum(k, out, 0.01)
    const g = k.gain(0.04)
    chain(k.noise('pink'), k.filter('bandpass', 1800, 1), g, out)
    k.wander(g.gain, 0.02, 0.06, 0.5)
    k.every(k.t, (t) => {
      bubble(k, out, t, 400, 900, 0.035)
      return t + rand(0.08, 0.35)
    })
  },
  poolPump: (k, out) => {
    chain(k.noise('brown'), k.filter('lowpass', 200), k.gain(0.15), out)
    hum(k, out, 0.012)
  },

  /* ---------- climate ---------- */
  /** Fan (floor, desk, wall): p speed */
  fan: (k, out, p) => {
    const g = k.gain(0.3)
    chain(k.noise('pink'), k.filter('bandpass', 350 + 500 * p, 0.6), g, out)
    k.lfo(6 + 8 * p, 0.05, g.gain)
    chain(k.noise('brown'), k.filter('lowpass', 200), k.gain(0.1), out)
    hum(k, out, 0.008)
  },
  /** Ceiling fan: "whoosh" of the blades, a light tick now and then */
  ceilingFan: (k, out, p) => {
    const g = k.gain(0.24)
    chain(k.noise('pink'), k.filter('lowpass', 520), g, out)
    k.lfo(2 + 2 * p, 0.12, g.gain)
    k.every(k.t + rand(0, 2), (t) => {
      burst(k.ctx, k.n, out, t, { freq: 1800, Q: 4, dur: 0.02, gain: 0.03 })
      return t + rand(1.8, 4.5)
    })
  },
  /** AC indoor unit: airflow and fan */
  ac: (k, out) => {
    chain(k.noise('pink'), k.filter('lowpass', 900), k.gain(0.26), out)
    chain(k.noise('brown'), k.filter('lowpass', 180), k.gain(0.12), out)
    const air = k.gain(0.12)
    chain(k.noise('white'), k.filter('bandpass', 2500, 0.8), air, out)
    k.wander(air.gain, 0.06, 0.16, 5)
    hum(k, out, 0.006)
  },
  /** AC outdoor unit, heat pump: compressor whine and fan blade */
  compressor: (k, out) => {
    chain(k.osc('sawtooth', 100), k.filter('lowpass', 420), k.gain(0.05), out)
    k.osc('sine', 50).connect(k.gain(0.05)).connect(out)
    chain(k.noise('brown'), k.filter('lowpass', 300), k.gain(0.22), out)
    const fan = k.gain(0.12)
    chain(k.noise('pink'), k.filter('bandpass', 600, 0.7), fan, out)
    k.lfo(1.2, 0.04, fan.gain)
  },
  /** Air purifier, dehumidifier and humidifier */
  purifier: (k, out) => {
    chain(k.noise('pink'), k.filter('bandpass', 700, 0.5), k.gain(0.24), out)
    chain(k.noise('brown'), k.filter('lowpass', 250), k.gain(0.08), out)
  },
  /** Diffuser: fine mist hiss and tiny bubbles */
  diffuser: (k, out) => {
    chain(k.noise('white'), k.filter('highpass', 4200), k.gain(0.025), out)
    k.every(k.t, (t) => {
      bubble(k, out, t, 500, 900, 0.035)
      return t + rand(0.2, 0.9)
    })
  },
  /** Boiler firing: flame roar, flickering combustion, pump */
  boiler: (k, out) => {
    const g = k.gain(0.28)
    chain(k.noise('brown'), k.filter('lowpass', 220), g, out)
    k.wander(g.gain, 0.22, 0.32, 1.5)
    const fl = k.gain(0.05)
    chain(k.noise('pink'), k.filter('bandpass', 500, 1), fl, out)
    k.lfo(7, 0.02, fl.gain)
    k.osc('sine', 50).connect(k.gain(0.018)).connect(out)
    hum(k, out, 0.008, 150)
  },
  /** Fireplace: low flame rumble, crackles and an occasional pop */
  fire: (k, out) => {
    const g = k.gain(0.16)
    chain(k.noise('brown'), k.filter('lowpass', 420), g, out)
    k.wander(g.gain, 0.1, 0.22, 0.6)
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: rand(1500, 4000), dur: rand(0.005, 0.02), gain: rand(0.05, 0.25) })
      if (Math.random() < 0.08) {
        burst(k.ctx, k.n, out, t, { freq: 600, dur: 0.05, gain: 0.3 })
        tone(k.ctx, out, t, { f0: 140, f1: 70, dur: 0.06, gain: 0.12 })
      }
      return t + rand(0.03, 0.25)
    })
  },
  /** Dry heat: electric heater, towel warmer (only a light tick) */
  tick: (k, out) => {
    k.every(k.t + rand(0, 3), (t) => {
      burst(k.ctx, k.n, out, t, { freq: rand(1500, 2500), Q: 3, dur: 0.01, gain: 0.05 })
      return t + rand(2, 8)
    })
  },

  /* ---------- electronics ---------- */
  /** Computer, console, projector fan (p 1 is louder) */
  pcFan: (k, out, p) => {
    chain(k.noise('pink'), k.filter('bandpass', 1000, 0.8), k.gain(0.1 + 0.12 * p), out)
    hum(k, out, 0.004, 120)
  },
  /** NAS: fan and occasional disk ticking */
  nas: (k, out) => {
    chain(k.noise('pink'), k.filter('bandpass', 1100, 0.8), k.gain(0.06), out)
    k.every(k.t + rand(0, 2), (t) => {
      const n = Math.floor(rand(1, 6))
      for (let i = 0; i < n; i++) burst(k.ctx, k.n, out, t + i * rand(0.02, 0.06), { freq: 3500, Q: 3, dur: 0.005, gain: 0.08 })
      return t + rand(0.4, 4)
    })
  },
  /** EV charging, home battery: coil whine */
  coil: (k, out) => {
    hum(k, out, 0.012)
    chain(k.noise('pink'), k.filter('bandpass', 3000, 3), k.gain(0.03), out)
  },
  /** TV playing: muffled talk from the speaker and background music */
  tvShow: (k, out, p) => talk(k, out, p),
  /** TV on, not playing: soft home menu music and selection clicks */
  tvMenu: (k, out) => {
    const pad = k.gain(0)
    chain(pad, k.filter('lowpass', 1800), out)
    for (const f of [261.6, 329.6, 493.9]) k.osc('sine', f).connect(k.gain(0.03)).connect(pad)
    pad.gain.setTargetAtTime(1, k.t, 1)
    k.lfo(0.15, 0.25, pad.gain)
    k.every(k.t + 2.2, (t) => {
      tone(k.ctx, out, t, { f0: 1200, dur: 0.03, gain: 0.02 })
      return t + 2.2
    })
  },
  /** Speaker playing: self-generated music (a different song on each speaker) */
  music: (k, out, p) => music(k, out, p),

  /* ---------- cleaning and garden machines ---------- */
  vacuumBot: (k, out) => {
    chain(k.osc('sawtooth', 190), k.filter('bandpass', 950, 3), k.gain(0.08), out)
    chain(k.noise('pink'), k.filter('bandpass', 1500, 0.7), k.gain(0.26), out)
    const brush = k.gain(0.08)
    chain(k.noise('brown'), k.filter('lowpass', 300), brush, out)
    k.lfo(14, 0.04, brush.gain)
  },
  vacuum: (k, out) => {
    chain(k.noise('pink'), k.filter('bandpass', 1800, 0.6), k.gain(0.7), out)
    chain(k.osc('sawtooth', 520), k.filter('bandpass', 1600, 4), k.gain(0.1), out)
    hum(k, out, 0.01, 260)
  },
  mower: (k, out) => {
    const e = k.gain(0.16)
    chain(k.osc('sawtooth', 95), k.filter('lowpass', 700), e, out)
    k.lfo(22, 0.05, e.gain)
    chain(k.noise('pink'), k.filter('bandpass', 900, 0.8), k.gain(0.14), out)
    chain(k.noise('brown'), k.filter('lowpass', 200), k.gain(0.1), out)
  },
  /** Motor: p 0 curtain, awning (thin); p 1 garage door, gate (deep, chain rattle) */
  motor: (k, out, p) => {
    chain(k.osc('sawtooth', 160 - 80 * p), k.filter('lowpass', 500), k.gain(0.1), out)
    k.osc('sine', 800 - 300 * p).connect(k.gain(0.01)).connect(out)
    chain(k.noise('brown'), k.filter('lowpass', 200), k.gain(0.05 + 0.15 * p), out)
    if (p > 0.5)
      k.every(k.t, (t) => {
        burst(k.ctx, k.n, out, t, { freq: 2500, Q: 2, dur: 0.01, gain: 0.03 })
        return t + 0.07
      })
  },

  /* ---------- alerts ---------- */
  siren: (k, out) => {
    const o = k.osc('sawtooth', 900)
    k.lfo(0.8, 330, o.frequency, 'triangle')
    const o2 = k.osc('square', 905)
    k.lfo(0.8, 330, o2.frequency, 'triangle')
    const g = k.gain(0.22)
    chain(o, k.filter('bandpass', 1100, 0.7), g, out)
    chain(o2, k.filter('bandpass', 1100, 0.7), k.gain(0.5), g)
  },
  /** Smoke detector: three high beeps, pause */
  smokeAlarm: (k, out) => {
    k.every(k.t, (t) => {
      for (let i = 0; i < 3; i++) tone(k.ctx, out, t + i, { type: 'square', f0: 3100, dur: 0.5, gain: 0.08, hold: true, lowpass: 6000 })
      return t + 4.5
    })
  },
  /** Water leak: double short beep every second */
  leakBeep: (k, out) => {
    k.every(k.t, (t) => {
      tone(k.ctx, out, t, { type: 'square', f0: 2600, dur: 0.1, gain: 0.07, hold: true, lowpass: 5000 })
      tone(k.ctx, out, t + 0.18, { type: 'square', f0: 2600, dur: 0.1, gain: 0.07, hold: true, lowpass: 5000 })
      return t + 1.2
    })
  },
  /** Alarm entry and exit delay: one beep per second */
  pending: (k, out) => {
    k.every(k.t, (t) => {
      tone(k.ctx, out, t, { f0: 1800, dur: 0.1, gain: 0.12, hold: true })
      return t + 1
    })
  },

  /* ---------- people's activities ---------- */
  typing: (k, out) => typing(k, out),
  /** Brushing teeth: fast back and forth scrubbing */
  brush: (k, out) => {
    const g = k.gain(0.06)
    chain(k.noise('white'), k.filter('bandpass', 4500, 1), g, out)
    k.lfo(4.5, 0.055, g.gain, 'triangle')
  },
  /** Someone reading: turns a page now and then */
  pageTurn: (k, out) => {
    k.every(k.t + rand(1, 5), (t) => {
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: 2500, freqTo: 1200, dur: 0.35, attack: 0.12, gain: 0.3 })
      return t + rand(12, 30)
    })
  },
  /** Folding laundry, browsing a bookshelf: fabric and paper rustle */
  rustle: (k, out) => {
    k.every(k.t + rand(0, 1), (t) => {
      burst(k.ctx, k.n, out, t, { color: 'pink', freq: rand(1200, 2500), Q: 0.8, dur: rand(0.2, 0.5), attack: 0.08, gain: rand(0.25, 0.5) })
      return t + rand(0.6, 2.2)
    })
  },
  /** Sleeping: deep breathing; p > 0.5 snores */
  snore: (k, out, p) => {
    const buzz = k.gain(0)
    chain(k.osc('sawtooth', rand(48, 62)), k.filter('lowpass', 280), buzz, out)
    k.every(k.t + rand(0, 2), (t) => {
      burst(k.ctx, k.n, out, t, { color: 'pink', freq: 700, Q: 0.7, dur: 1.5, attack: 0.6, gain: 0.2 })
      if (p > 0.5) {
        buzz.gain.setTargetAtTime(0.12, t + 0.3, 0.2)
        buzz.gain.setTargetAtTime(0, t + 1.3, 0.1)
      }
      burst(k.ctx, k.n, out, t + 1.9, { color: 'pink', freq: 500, Q: 0.7, dur: 1.6, attack: 0.3, gain: 0.14 })
      return t + rand(3.8, 4.6)
    })
  },

  /* ---------- animals ---------- */
  /** Cat purr: low rumble trembling at 26 Hz; swells with the breath */
  purr: (k, out) => {
    const g = k.gain(0.12)
    const br = k.gain(1)
    chain(k.noise('brown'), k.filter('lowpass', 170), g, br, out)
    k.lfo(26, 0.11, g.gain, 'square')
    k.every(k.t, (t) => {
      br.gain.setTargetAtTime(1, t, 0.3)
      br.gain.setTargetAtTime(0.6, t + 1.2, 0.3)
      return t + rand(2.2, 2.8)
    })
  },
  /** Paw steps: p 0 cat (soft), p 1 dog (claw clicks) */
  patter: (k, out, p) => {
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { type: 'lowpass', freq: 400, dur: 0.02, gain: 0.1 + 0.06 * p })
      if (p > 0.5) burst(k.ctx, k.n, out, t + 0.005, { type: 'highpass', freq: 3500, dur: 0.006, gain: 0.14 })
      return t + rand(0.12, 0.18)
    })
  },
  /** Dog playing with a toy: squeaks and paws */
  toy: (k, out) => {
    k.every(k.t + rand(0.2, 1), (t) => {
      tone(k.ctx, out, t, { f0: rand(1600, 2000), f1: rand(2400, 2800), dur: 0.08, gain: 0.12, linear: true })
      tone(k.ctx, out, t + 0.08, { f0: 2600, f1: 1900, dur: 0.1, gain: 0.09, linear: true })
      return t + rand(0.8, 2.6)
    })
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { type: 'lowpass', freq: 400, dur: 0.02, gain: 0.12 })
      return t + rand(0.1, 0.25)
    })
  },
  /** Kibble crunch */
  crunch: (k, out) => {
    k.every(k.t, (t) => {
      const n = Math.floor(rand(1, 4))
      for (let i = 0; i < n; i++) burst(k.ctx, k.n, out, t + i * 0.04, { freq: rand(1500, 3500), Q: 0.8, dur: 0.03, gain: 0.1 })
      return t + rand(0.15, 0.4)
    })
  },
  /** Drinking water: tongue lapping */
  lap: (k, out) => {
    k.every(k.t, (t) => {
      tone(k.ctx, out, t, { f0: rand(500, 700), f1: 1100, dur: 0.05, gain: 0.05 })
      burst(k.ctx, k.n, out, t, { freq: 1500, dur: 0.03, gain: 0.04 })
      return t + rand(0.25, 0.32)
    })
  },
  /** Scratching post */
  scratch: (k, out) => {
    k.every(k.t, (t) => {
      if (Math.random() < 0.1) return t + rand(0.6, 1.2)
      burst(k.ctx, k.n, out, t, { freq: 2500, Q: 0.7, dur: 0.09, attack: 0.03, gain: 0.12 })
      return t + rand(0.12, 0.2)
    })
  },
  /** Licking */
  lick: (k, out) => {
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { freq: 2000, Q: 1, dur: 0.06, gain: 0.09 })
      return t + rand(0.35, 0.6)
    })
  },
  /** Birds landing in the garden */
  birdsVisit: (k, out) => {
    k.every(k.t + 0.2, (t) => birdPhrase(k, out, t, 0.07) + rand(0.4, 1.6))
  },
  /** Squirrel: fast clicking chatter */
  squirrel: (k, out) => {
    k.every(k.t + 0.5, (t) => {
      for (let i = 0; i < 10; i++) burst(k.ctx, k.n, out, t + i * 0.075, { freq: rand(2500, 3500), Q: 3, dur: 0.012, gain: 0.18 })
      return t + rand(2, 5)
    })
  },

  /* ---------- outdoors ---------- */
  /** Daytime birds: songs near and far */
  birds: (k, out) => {
    k.every(k.t + rand(0, 2), (t) => birdPhrase(k, out, t, rand(0.04, 0.12)) + rand(0.8, 4))
  },
  /** Night crickets */
  crickets: (k, out) => {
    for (const [f, off] of [
      [4600, 0],
      [4300, 0.27],
    ])
      k.every(k.t + off, (t) => {
        const n = Math.floor(rand(3, 5))
        for (let i = 0; i < n; i++) tone(k.ctx, out, t + i * 0.032, { f0: f, dur: 0.018, gain: 0.035, hold: true })
        return t + rand(0.55, 0.7)
      })
  },
  /** Wind: p strength (0 breeze, 1 strong); swells by itself */
  wind: (k, out, p) => {
    const bp = k.filter('bandpass', 400, 0.6)
    const g = k.gain(0.15 + 0.25 * p)
    chain(k.noise('pink'), bp, g, out)
    k.wander(bp.frequency, 250, 700 + 300 * p, 3)
    k.wander(g.gain, 0.06 + 0.12 * p, 0.2 + 0.3 * p, 2.5)
    chain(k.noise('brown'), k.filter('lowpass', 150), k.gain(0.05 + 0.15 * p), out)
  },
  /** Rain: p 0 rain, 1 downpour */
  rain: (k, out, p) => {
    chain(k.noise('white'), k.filter('highpass', 500), k.filter('lowpass', 7000), k.gain(0.1 + 0.1 * p), out)
    chain(k.noise('pink'), k.filter('lowpass', 800), k.gain(0.08 + 0.06 * p), out)
    k.every(k.t, (t) => {
      burst(k.ctx, k.n, out, t, { type: 'highpass', freq: rand(2000, 6000), dur: 0.006, gain: rand(0.02, 0.08) })
      return t + rand(0.005, 0.04) / (1 + p)
    })
  },
  /** Distant city hum (when there is a road) */
  city: (k, out) => {
    chain(k.noise('brown'), k.filter('lowpass', 120), k.gain(0.18), out)
    const g = k.gain(0.04)
    chain(k.noise('pink'), k.filter('bandpass', 400, 0.5), g, out)
    k.wander(g.gain, 0.02, 0.06, 4)
  },
  /** Quiet night floor: very distant road hum, light air */
  night: (k, out) => {
    chain(k.noise('brown'), k.filter('lowpass', 90), k.gain(0.1), out)
    const g = k.gain(0.02)
    chain(k.noise('pink'), k.filter('bandpass', 900, 0.4), g, out)
    k.wander(g.gain, 0.01, 0.03, 5)
  },
  /** Pond frogs (night) */
  frogs: (k, out) => {
    k.every(k.t + rand(0, 1), (t) => {
      const n = Math.floor(rand(2, 5))
      for (let i = 0; i < n; i++) tone(k.ctx, out, t + i * 0.09, { type: 'sawtooth', f0: rand(150, 190), dur: 0.06, gain: 0.05, lowpass: 900 })
      return t + rand(0.6, 1.6)
    })
  },
  /** Children at the playground: silent without a recording (no synthesized children's voices) */
  kids: () => {},
  /** Car driving by: engine and tire hum (the sound moves with the car) */
  carDrive: (k, out) => {
    chain(k.noise('brown'), k.filter('lowpass', 220), k.gain(0.3), out)
    chain(k.noise('pink'), k.filter('bandpass', 700, 0.6), k.gain(0.08), out)
  },
} satisfies Record<string, VoiceFn>

export type VoiceName = keyof typeof VOICES

/** For the sound lab and tests: list of continuous sounds */
export const VOICE_NAMES = Object.keys(VOICES) as VoiceName[]
