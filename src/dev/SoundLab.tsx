import { Play } from 'lucide-react'
import { useState } from 'react'
import { audition, useSound } from '@/audio/engine'
import { hasSample, SCATTER, shotSample, voiceSample } from '@/audio/samples'
import type { ShotName } from '@/audio/shots'
import type { VoiceName } from '@/audio/voices'

/*
 * Sound lab (developer tool; #sounds in the address bar): every sound of the app on one page, unpositioned and at full
 * level. Next to each sound its source: "recording" (generated with Stable Audio 3, public/sounds) or "synth" (Web Audio).
 * Continuous sounds play for 5 s (with a slider where they have a parameter: fan speed, rain intensity...); short sounds
 * play once. For listening to the sounds and tuning their realism; the rest of the app is not loaded.
 */

const VOICE_GROUPS: [string, [VoiceName, string, string?][]][] = [
  [
    'Kitchen and appliances',
    [
      ['fridge', 'Fridge'],
      ['fridgeOpen', 'Fridge door open'],
      ['washer', 'Washer'],
      ['dryer', 'Dryer'],
      ['dishwasher', 'Dishwasher'],
      ['microwave', 'Microwave'],
      ['coffee', 'Coffee machine'],
      ['kettle', 'Kettle'],
      ['ovenFan', 'Oven, air fryer, heater'],
      ['sizzle', 'Sizzle in a pan'],
      ['chop', 'Chopping'],
      ['dishes', 'Washing dishes'],
      ['cutlery', 'Eating: cutlery'],
    ],
  ],
  [
    'Water',
    [
      ['tap', 'Tap'],
      ['shower', 'Shower'],
      ['fountain', 'Garden pond, fountain'],
      ['sprinkler', 'Sprinkler'],
      ['bubbles', 'Hot tub', 'Bubbles'],
      ['aquarium', 'Aquarium'],
      ['poolPump', 'Pool pump'],
    ],
  ],
  [
    'Climate',
    [
      ['fan', 'Fan', 'Speed'],
      ['ceilingFan', 'Ceiling fan', 'Speed'],
      ['ac', 'AC indoor unit'],
      ['compressor', 'AC outdoor unit'],
      ['purifier', 'Air purifier, dehumidifier'],
      ['diffuser', 'Diffuser'],
      ['boiler', 'Boiler firing'],
      ['fire', 'Fireplace'],
      ['tick', 'Ticking radiator'],
    ],
  ],
  [
    'Electronics and machines',
    [
      ['pcFan', 'Computer, console fan', 'Fan'],
      ['nas', 'NAS'],
      ['coil', 'Charging, battery'],
      ['tvShow', 'TV program', 'Program'],
      ['tvMenu', 'TV home menu'],
      ['music', 'Music on a speaker', 'Song'],
      ['vacuumBot', 'Robot vacuum'],
      ['vacuum', 'Vacuum cleaner'],
      ['mower', 'Robot mower'],
      ['motor', 'Curtain / garage door motor', 'Curtain ↔ garage'],
    ],
  ],
  [
    'Alerts',
    [
      ['siren', 'Siren'],
      ['smokeAlarm', 'Smoke detector'],
      ['leakBeep', 'Water leak'],
      ['pending', 'Alarm delay'],
    ],
  ],
  [
    'People',
    [
      ['typing', 'Keyboard'],
      ['brush', 'Brushing teeth'],
      ['pageTurn', 'Turning pages'],
      ['rustle', 'Rustle (laundry, books)'],
      ['snore', 'Sleeping', 'Snoring'],
    ],
  ],
  [
    'Animals',
    [
      ['purr', 'Purring'],
      ['patter', 'Paw steps', 'Cat ↔ dog'],
      ['crunch', 'Eating kibble'],
      ['lap', 'Drinking water'],
      ['scratch', 'Scratching'],
      ['lick', 'Licking'],
      ['toy', 'Dog playing with a toy'],
      ['birdsVisit', 'Birds landing in the garden'],
      ['squirrel', 'Squirrel'],
    ],
  ],
  [
    'Outdoors',
    [
      ['birds', 'Daytime birds'],
      ['crickets', 'Night crickets'],
      ['wind', 'Wind', 'Strength'],
      ['rain', 'Rain', 'Intensity'],
      ['city', 'City hum'],
    ],
  ],
]

const SHOT_GROUPS: [string, [ShotName, string, string?][]][] = [
  [
    'Switches, doors, locks',
    [
      ['click', 'Light switch'],
      ['relay', 'Smart plug'],
      ['doorOpen', 'Door opening'],
      ['doorClose', 'Door closing'],
      ['windowOpen', 'Window opening'],
      ['windowClose', 'Window closing'],
      ['lock', 'Locked'],
      ['unlock', 'Unlocked'],
      ['dingDong', 'Doorbell'],
      ['button', 'Smart button'],
      ['valve', 'Water valve'],
      ['cabinetOpen', 'Cabinet door opening'],
      ['cabinetClose', 'Cabinet door closing'],
      ['drawerOpen', 'Drawer opening'],
      ['drawerClose', 'Drawer closing'],
    ],
  ],
  [
    'Device beeps',
    [
      ['tvOn', 'TV on'],
      ['tvOff', 'TV off'],
      ['acOn', 'AC on'],
      ['acOff', 'AC off'],
      ['beep', 'Beep'],
      ['done', 'Machine done'],
      ['microDone', 'Microwave done'],
      ['kettleClick', 'Kettle off'],
      ['botStart', 'Robot vacuum started'],
      ['botDock', 'Robot vacuum docked'],
      ['armed', 'Alarm armed'],
      ['disarmed', 'Alarm disarmed'],
      ['kibble', 'Pet feeder'],
      ['grind', 'Coffee grinder'],
    ],
  ],
  [
    'People and animals',
    [
      ['flush', 'Toilet flush'],
      ['meow', 'Meow'],
      ['meow', 'Yawn', 'yawn'],
      ['purr', 'Short purr'],
      ['hiss', 'Hiss'],
      ['bark', 'Bark'],
      ['bark', 'Double bark', 'double'],
      ['bark', 'Small dog', 'small double'],
      ['bark', 'Sleepy "Woof?"', 'sleepy'],
      ['squeak', 'Toy'],
      ['land', 'Landing after a jump'],
    ],
  ],
  [
    'Steps',
    [
      ['step', 'Wood floor', 'wood'],
      ['step', 'Tile, concrete', 'hard'],
      ['step', 'Carpet', 'soft'],
      ['step', 'Grass', 'grass'],
      ['step', 'Gravel', 'gravel'],
      ['step', 'Water', 'water'],
      ['step', 'Stairs', 'stairs'],
    ],
  ],
  [
    'Outdoors and interface',
    [
      ['carPass', 'Passing car', '5'],
      ['thunder', 'Thunder'],
      ['place', 'Item placed'],
      ['placeRoom', 'Room placed'],
      ['remove', 'Removed'],
      ['rotate', 'Rotated'],
      ['deny', 'Cannot place'],
      ['chime', 'Info'],
    ],
  ],
]

function Source({ rec }: { rec: boolean }) {
  return <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${rec ? 'bg-ok-50 text-ok' : 'bg-surface-2 text-ink-3'}`}>{rec ? 'recording' : 'synth'}</span>
}

function VoiceRow({ name, label, param }: { name: VoiceName; label: string; param?: string }) {
  const [p, setP] = useState(0.5)
  const rec = Boolean(voiceSample(name, p)) || hasSample(SCATTER[name]?.[0])
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2">
      <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white" onClick={() => audition('voice', name, { p, seconds: 5 })} title="Play for 5 s">
        <Play size={14} />
      </button>
      <span className="min-w-0 flex-1 text-[13px] text-ink">{label}</span>
      <Source rec={rec} />
      {param && (
        <label className="flex items-center gap-2 text-[11px] text-ink-3">
          {param}
          <input type="range" min={0} max={1} step={0.1} value={p} onChange={(e) => setP(Number(e.target.value))} className="w-24" />
        </label>
      )}
    </div>
  )
}

export default function SoundLab() {
  const volume = useSound((s) => s.volume)
  return (
    <main className="min-h-dvh bg-ground px-4 py-6 text-ink">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Sound lab</h1>
            <p className="text-[13px] text-ink-3">Every sound of the app, unpositioned and at full level. Continuous sounds play for 5 s.</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => useSound.getState().setVolume(Number(e.target.value))} />
          </label>
        </header>
        <section className="grid gap-4">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-3">Continuous sounds</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {VOICE_GROUPS.map(([title, rows]) => (
              <div key={title} className="grid content-start gap-1.5">
                <h3 className="text-[13px] font-semibold text-ink-2">{title}</h3>
                {rows.map(([n, label, param]) => (
                  <VoiceRow key={n} name={n} label={label} param={param} />
                ))}
              </div>
            ))}
          </div>
        </section>
        <section className="grid gap-4">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-3">Short sounds</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {SHOT_GROUPS.map(([title, rows]) => (
              <div key={title} className="grid content-start gap-1.5">
                <h3 className="text-[13px] font-semibold text-ink-2">{title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {rows.map(([n, label, v]) => (
                    <button key={`${n}${v ?? ''}`} type="button" className="flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-[13px] text-ink hover:bg-surface-2" onClick={() => audition('shot', n, { v })}>
                      <Play size={12} className="text-brand" />
                      {label}
                      <Source rec={Boolean(shotSample(n, v))} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
