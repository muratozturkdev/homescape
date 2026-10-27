import { burst, chain, type Kit, rand, semi, tone } from './dsp'

/*
 * Music on speakers and the TV program, without files (audio/voices.ts > music, tvShow). Not a real song or broadcast: it
 * only has to sound like "music is playing in the room" or "someone is talking on TV".
 */

/** Repeatable random number generator from a seed (each speaker plays its own song) */
function seeded(seed: number) {
  let s = Math.floor(Math.abs(seed) * 1e4) % 2147483647 || 7
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** Chord progressions (semitones from the root): I V vi IV, vi IV I V, I vi IV V, ii V I vi */
const PROGRESSIONS = [
  [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
  [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]],
  [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]],
  [[2, 5, 9], [7, 11, 14], [0, 4, 7], [9, 12, 16]],
]

/**
 * Self-playing music: drums (kick, snare, hi-hat), bass, arpeggio and pad; every 16 bars a 4-bar break without drums.
 * Tempo, key, progression and style (calm lo-fi or lively pop) come from the seed.
 */
export function music(k: Kit, out: AudioNode, seed: number) {
  const r = seeded(seed * 9301 + 49297)
  const bpm = 84 + Math.floor(r() * 34)
  const eighth = 60 / bpm / 2
  const root = 110 * semi(Math.floor(r() * 9))
  const prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)]
  const calm = r() < 0.45
  const bus = k.gain(0.9)
  chain(bus, k.filter('lowpass', calm ? 5200 : 8000), out)
  const ctx = k.ctx
  let step = 0
  k.every(k.t + 0.1, (t) => {
    const bar = Math.floor(step / 8)
    const s = step % 8
    const chord = prog[bar % 4]
    const drums = bar % 16 < 12
    if (drums) {
      if (s === 0 || s === 4 || (!calm && s === 5 && r() < 0.5)) {
        tone(ctx, bus, t, { f0: 140, f1: 45, dur: 0.28, gain: calm ? 0.32 : 0.45 })
        burst(ctx, k.n, bus, t, { type: 'highpass', freq: 2000, dur: 0.005, gain: 0.04 })
      }
      if (s === 2 || s === 6) {
        burst(ctx, k.n, bus, t, { freq: calm ? 1200 : 1800, Q: 0.6, dur: 0.16, gain: calm ? 0.1 : 0.2 })
        tone(ctx, bus, t, { type: 'triangle', f0: 220, f1: 180, dur: 0.08, gain: 0.08 })
      }
      burst(ctx, k.n, bus, t, { type: 'highpass', freq: 7000, dur: 0.035, gain: s % 2 ? 0.07 : 0.04 })
    }
    // bass: root and fifth, eighth notes
    if ([0, 3, 4, 6].includes(s)) {
      const n = s === 6 && r() < 0.5 ? chord[2] : chord[0]
      tone(ctx, bus, t, { type: 'triangle', f0: (root / 2) * semi(n), dur: eighth * 0.95, gain: 0.22, attack: 0.01, lowpass: 600 })
    }
    // arpeggio: chord notes one octave up
    if (r() < (calm ? 0.45 : 0.65)) {
      const n = chord[Math.floor(r() * 3)] + (r() < 0.3 ? 12 : 0)
      tone(ctx, bus, t, { type: calm ? 'triangle' : 'square', f0: root * 2 * semi(n), dur: 0.25, gain: calm ? 0.06 : 0.035, lowpass: 2400 })
    }
    // pad: chord at the start of the bar, lasts four beats
    if (s === 0)
      for (const n of chord) tone(ctx, bus, t, { type: 'triangle', f0: root * semi(n), dur: eighth * 8, gain: 0.03, attack: 0.25, hold: true, lowpass: 1500 })
    step++
    return t + eighth
  })
}

/** First two formants of vowels (Hz), IPA a, e, ɯ, i, o, ø, u, y */
const VOWELS: [number, number][] = [
  [800, 1250],
  [500, 1850],
  [380, 1450],
  [300, 2250],
  [500, 900],
  [420, 1600],
  [340, 800],
  [300, 1650],
]

/**
 * TV program: two people talking through a TV speaker (narrow band). A glottal source (sawtooth) goes through two formant
 * filters; vowel and pitch change per syllable, pauses between sentences, the speakers take turns (low and high voice).
 * Soft background music underneath; audience laughter now and then.
 */
export function talk(k: Kit, out: AudioNode, seed: number) {
  const r = seeded(seed * 7919 + 13)
  const spk = k.gain(1)
  chain(spk, k.filter('highpass', 170), k.filter('lowpass', 3400), out)
  const glottal = k.osc('sawtooth', 130)
  const vg = k.gain(0)
  const f1 = k.filter('bandpass', 700, 5)
  const f2 = k.filter('bandpass', 1300, 7)
  glottal.connect(f1).connect(k.gain(3.2)).connect(vg)
  glottal.connect(f2).connect(k.gain(2)).connect(vg)
  chain(k.noise('white'), k.filter('bandpass', 2400, 1), k.gain(0.2), vg)
  vg.connect(spk)
  // background music: soft chord, changes every 4 s
  const bed = k.gain(0.5)
  bed.connect(spk)
  const notes = [0, 4, 7].map((n) => k.osc('triangle', 220 * semi(n)))
  notes.forEach((o) => o.connect(k.gain(0.02)).connect(bed))
  let chord = 0
  k.every(k.t + 4, (t) => {
    chord = (chord + 1) % 4
    PROGRESSIONS[0][chord].forEach((n, i) => notes[i].frequency.setTargetAtTime(220 * semi(n), t, 0.3))
    return t + 4
  })
  let base = r() < 0.5 ? 115 : 210
  let turn = 8 + Math.floor(r() * 20)
  k.every(k.t + 0.2, (t) => {
    if (r() < 0.1) {
      vg.gain.setTargetAtTime(0, t, 0.03)
      if (r() < 0.06) burst(k.ctx, k.n, spk, t + 0.1, { color: 'pink', freq: 1400, Q: 0.6, dur: 1.6, attack: 0.25, gain: 0.08 })
      return t + rand(0.25, 0.8)
    }
    const [a, b] = VOWELS[Math.floor(r() * VOWELS.length)]
    f1.frequency.setTargetAtTime(a, t, 0.025)
    f2.frequency.setTargetAtTime(b, t, 0.025)
    glottal.frequency.setTargetAtTime(base * rand(0.86, 1.2), t, 0.05)
    const d = rand(0.1, 0.24)
    vg.gain.setTargetAtTime(rand(0.08, 0.14), t, 0.015)
    vg.gain.setTargetAtTime(0.012, t + d * 0.72, 0.025)
    if (--turn <= 0) {
      base = base > 160 ? rand(100, 130) : rand(190, 235)
      turn = 8 + Math.floor(r() * 24)
      return t + d + rand(0.3, 0.6)
    }
    return t + d
  })
}
