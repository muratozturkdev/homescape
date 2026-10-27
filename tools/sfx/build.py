"""
Homescape sound recordings. The sounds are generated locally with Stable Audio 3 Small-SFX (effects) and Small-Music
(speaker music) (Stability AI, open weights, Stability AI Community License; https://github.com/Stability-AI/stable-audio-3,
MLX).

Usage (the stable-audio-3 repository next to Homescape, ../stable-audio-3; setup: optimized/mlx/install.sh):
    SA3=../stable-audio-3/optimized/mlx
    $SA3/.venv/bin/python tools/sfx/build.py            # generates missing takes, processes, writes public/sounds and src/audio/samples.json
    $SA3/.venv/bin/python tools/sfx/build.py fridge door-open   # (re)generate only these
    $SA3/.venv/bin/python tools/sfx/build.py --process  # only reprocess, no generation

Raw takes (WAV) live outside the repository: $SA3/output/homescape/. Processing:
- loop: 1 s is dropped at the start and end (the model's intro and fade), the middle becomes a seamless loop with an
  equal-power crossfade;
- shot: silent head and tail are trimmed, short fade in and fade out;
- slice: single hits are cut from a long take (a walk) (footsteps);
all mono, level normalized, written as AAC (.m4a, 96 kb/s) to public/sounds/.
Chosen take: the best of several seeds of the same sound (shot: peak to body ratio; loop: least level fluctuation).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SA3 = Path(os.environ.get('SA3', ROOT.parent / 'stable-audio-3' / 'optimized' / 'mlx'))
RAW = SA3 / 'output' / 'homescape'
OUT = ROOT / 'public' / 'sounds'
MANIFEST = ROOT / 'src' / 'audio' / 'samples.json'
SR = 44100

# (id, kind, model, duration s, number of takes, prompt, extra options)
L, S, C = 'loop', 'shot', 'slice'
SFX, MUSIC = 'sm-sfx', 'sm-music'
NEG = 'voices, speech, music'
CATALOG: list[tuple] = [
    # --- kitchen and appliances ---
    ('fridge', L, SFX, 22, 2, 'refrigerator compressor humming in a quiet kitchen, steady low electrical drone'),
    ('fridge-open', L, SFX, 14, 1, 'open refrigerator door, fridge hum, glass bottles and jars clinking gently'),
    ('washer', L, SFX, 24, 2, 'front loading washing machine running a wash cycle, drum turning, water sloshing, indoors'),
    ('dryer', L, SFX, 22, 1, 'tumble dryer running, clothes tumbling and softly thumping inside the drum'),
    ('dishwasher', L, SFX, 22, 1, 'dishwasher running behind a closed door, water spraying and swishing inside, muffled'),
    ('microwave', L, SFX, 16, 1, 'microwave oven running, electrical hum, fan and rotating turntable'),
    ('coffee', L, SFX, 14, 1, 'espresso machine brewing, vibrating pump buzz, coffee pouring into a cup'),
    ('kettle', L, SFX, 18, 1, 'electric kettle coming to a boil, water rumbling and bubbling'),
    ('oven-fan', L, SFX, 16, 1, 'kitchen oven convection fan running, steady soft whir'),
    ('sizzle', L, SFX, 18, 2, 'food sizzling in a hot frying pan, oil crackling, kitchen'),
    ('chop', L, SFX, 16, 2, 'chopping vegetables with a kitchen knife on a wooden cutting board, steady rhythm'),
    ('dishes', L, SFX, 20, 2, 'washing dishes in a kitchen sink, tap water running, plates and glasses clinking'),
    ('cutlery', L, SFX, 18, 1, 'eating a meal at a table, fork and knife clinking on ceramic plates', {'neg': NEG}),
    # --- water ---
    ('tap', L, SFX, 16, 1, 'kitchen faucet running, water pouring into a steel sink'),
    ('shower', L, SFX, 18, 1, 'shower running in a bathroom, water spraying and splashing on tiles'),
    ('fountain', L, SFX, 18, 1, 'small garden fountain, water splashing and trickling into a stone basin'),
    ('sprinkler', L, SFX, 16, 1, 'impact lawn sprinkler ticking and spraying water on grass'),
    ('hottub', L, SFX, 16, 1, 'hot tub jets bubbling, water churning'),
    ('aquarium', L, SFX, 16, 1, 'aquarium air pump bubbling, water filter trickling, quiet room'),
    ('pool-pump', L, SFX, 14, 1, 'swimming pool pump motor humming outdoors'),
    # --- climate ---
    ('fan', L, SFX, 14, 1, 'electric fan running on medium speed, steady airflow whoosh'),
    ('ceiling-fan', L, SFX, 14, 1, 'ceiling fan spinning, soft rhythmic whooshing blades'),
    ('ac', L, SFX, 16, 1, 'indoor air conditioner unit blowing cool air, soft hum'),
    ('compressor', L, SFX, 16, 1, 'outdoor air conditioner condenser unit running, compressor hum and fan'),
    ('purifier', L, SFX, 14, 1, 'air purifier running, soft steady fan noise'),
    ('diffuser', L, SFX, 12, 1, 'ultrasonic aroma diffuser running, quiet mist hiss and tiny water bubbles'),
    ('boiler', L, SFX, 16, 1, 'gas combi boiler burning, soft flame roar and circulation pump hum'),
    ('fire', L, SFX, 22, 2, 'fireplace with crackling burning wood, gentle pops and hiss'),
    ('radiator', L, SFX, 14, 1, 'central heating radiator, quiet water gurgling and metal ticking'),
    # --- electronics and machines ---
    ('pc-fan', L, SFX, 12, 1, 'desktop computer running, quiet cooling fan whir'),
    ('nas', L, SFX, 14, 1, 'network storage server running, hard drives clicking and seeking, fan hum'),
    ('tv-show', L, SFX, 30, 2, 'television in a living room playing a talk show, people talking on TV, studio audience laughing'),
    ('vacuum-bot', L, SFX, 14, 1, 'robot vacuum cleaner running on the floor, motor whine and spinning brushes'),
    ('vacuum', L, SFX, 12, 1, 'cordless stick vacuum cleaner running, high pitched suction', {'region': (1.0, 6.0)}),
    ('mower', L, SFX, 16, 1, 'robotic lawn mower cutting grass, electric motor whirring'),
    ('motor-blinds', L, SFX, 8, 1, 'motorized window blinds moving, small electric motor whirring', {'region': (0.5, 4.4)}),
    ('motor-garage', L, SFX, 10, 1, 'garage door opener running, chain drive rumbling and motor hum'),
    ('siren', L, SFX, 10, 1, 'home security alarm siren wailing loudly'),
    # --- people ---
    ('typing', L, SFX, 16, 2, 'typing on a computer keyboard at a desk, office', {'neg': NEG}),
    ('brush', L, SFX, 10, 1, 'brushing teeth with a toothbrush, scrubbing close up'),
    ('snore', L, SFX, 20, 1, 'person sleeping, slow deep breathing and soft snoring'),
    # --- animals ---
    ('purr', L, SFX, 12, 1, 'cat purring contentedly, close up'),
    ('patter-dog', L, SFX, 10, 1, 'small dog walking on a wooden floor, claws clicking'),
    ('crunch', L, SFX, 10, 1, 'dog eating dry kibble from a bowl, crunching'),
    ('lap', L, SFX, 10, 1, 'dog drinking water from a bowl, lapping'),
    ('scratch', L, SFX, 10, 1, 'cat scratching a sisal scratching post'),
    ('lick', L, SFX, 10, 1, 'cat grooming itself, licking fur, quiet'),
    ('birds-near', L, SFX, 16, 1, 'small birds chirping and twittering close by in a garden, sparrows'),
    # --- outdoors ---
    ('birds', L, SFX, 26, 2, 'morning birdsong in a suburban garden, several birds singing, distant'),
    ('crickets', L, SFX, 22, 1, 'crickets chirping on a warm summer night'),
    ('wind', L, SFX, 26, 1, 'gentle wind blowing outdoors, soft breeze through trees'),
    ('wind-strong', L, SFX, 22, 1, 'strong gusty wind blowing outdoors'),
    ('rain', L, SFX, 26, 1, 'steady rain falling on a roof and garden'),
    ('rain-heavy', L, SFX, 22, 1, 'heavy downpour, intense rain pouring'),
    ('city', L, SFX, 26, 1, 'distant city traffic ambience, faraway cars and hum'),
    # night and street: night ambience, passing cars, children playing in the park
    ('night', L, SFX, 26, 2, 'quiet suburban neighbourhood at night, very distant highway hum, soft night air, faraway crickets', {'neg': NEG}),
    ('frogs', L, SFX, 22, 2, 'frogs croaking around a small garden pond at night'),
    ('kids-play', L, SFX, 24, 3, 'children playing and laughing at a playground outdoors, happy shouts and giggles, park'),
    ('car-drive', L, SFX, 16, 3, 'steady engine and tyre noise of a car cruising slowly on asphalt, constant level, no pass by'),
    # --- music ---
    ('tv-menu', L, MUSIC, 24, 1, 'calm ambient electronic background music, soft warm pads, gentle'),
    ('music-1', L, MUSIC, 64, 1, 'lofi hip hop chill beat with mellow piano and soft drums'),
    ('music-2', L, MUSIC, 64, 1, 'acoustic guitar pop instrumental, warm and upbeat'),
    ('music-3', L, MUSIC, 64, 1, 'smooth jazz piano trio, relaxed late night'),
    ('music-4', L, MUSIC, 64, 1, 'upbeat electronic pop instrumental with bright synths'),
    # --- short sounds ---
    ('click', S, SFX, 2, 3, 'light switch being flipped, single sharp plastic click, close up'),
    ('relay', S, SFX, 3, 5, 'a single electrical relay click, quiet room', {'keep': 2}),
    ('door-open', S, SFX, 4, 6, 'a wooden door unlatches and swings open with a short creak, quiet house', {'keep': 3}),
    ('door-close', S, SFX, 3, 3, 'wooden interior door closing shut, latch click and soft thud'),
    ('window-open', S, SFX, 3, 2, 'opening a window, handle turning and the sash sliding'),
    ('window-close', S, SFX, 3, 2, 'closing a window shut, frame thud and latch click'),
    ('lock', S, SFX, 4, 5, 'a smart lock motor whirs briefly and the deadbolt clunks shut, quiet hallway', {'keep': 2}),
    ('unlock', S, SFX, 4, 5, 'a smart lock motor whirs and the deadbolt slides open with a clunk, quiet hallway', {'keep': 2}),
    ('dingdong', S, SFX, 3.5, 2, 'classic two tone doorbell chime, ding dong'),
    ('button', S, SFX, 1, 2, 'pressing a small plastic button, soft click'),
    ('valve', S, SFX, 3, 1, 'water valve opening, pipes rushing with water'),
    ('cabinet-open', S, SFX, 2, 3, 'kitchen cabinet door opening, wooden hinge, soft'),
    ('cabinet-close', S, SFX, 2, 3, 'kitchen cabinet door closing, soft wooden thud'),
    ('drawer-open', S, SFX, 2, 3, 'wooden drawer sliding open'),
    ('drawer-close', S, SFX, 2, 3, 'wooden drawer sliding shut with a soft knock'),
    ('kettle-click', S, SFX, 4, 5, 'the switch of an electric kettle clicks off once, quiet kitchen', {'keep': 2}),
    ('kibble', S, SFX, 3, 2, 'pet food dispenser dropping dry kibble into a metal bowl'),
    ('grind', S, SFX, 4, 1, 'coffee grinder grinding coffee beans'),
    ('flush', S, SFX, 8, 2, 'toilet flushing, water rushing down and the tank refilling'),
    ('page', S, SFX, 3, 6, 'a single page of a book being turned, quiet room', {'keep': 3}),
    ('rustle', S, SFX, 2, 3, 'fabric rustling, folding clothes'),
    ('squeak', S, SFX, 3, 6, 'a rubber dog toy squeaks once when squeezed', {'keep': 3}),
    ('squirrel', S, SFX, 3, 2, 'squirrel chattering'),
    ('meow', S, SFX, 2, 4, 'domestic cat meowing once'),
    ('meow-yawn', S, SFX, 2, 1, 'cat yawning with a small squeak'),
    ('purr-short', S, SFX, 3, 1, 'cat purring briefly, close up'),
    ('hiss', S, SFX, 2, 2, 'angry cat hissing'),
    ('bark', S, SFX, 5, 6, 'a single loud bark from a medium sized dog, then silence', {'keep': 4}),
    ('bark-small', S, SFX, 5, 6, 'a small terrier dog yaps once, then silence', {'keep': 3}),
    ('bark-sleepy', S, SFX, 5, 4, 'a sleepy dog lets out one soft low woof, quiet room', {'keep': 1, 'max': 1.2}),
    ('land', S, SFX, 1, 2, 'small animal jumping down onto a wooden floor, soft thump'),
    ('car-pass', S, SFX, 7, 3, 'single car driving past on a street, approaching and receding'),
    ('thunder', S, SFX, 6, 2, 'distant thunder rumbling'),
    ('owl', S, SFX, 5, 6, 'an owl hoots softly twice at night in the woods, then silence', {'keep': 3}),
    ('bark-far', S, SFX, 5, 5, 'a dog barks a few times far away in the neighbourhood at night, then silence', {'keep': 3}),
    ('trampoline', S, SFX, 2, 5, 'a child lands on a garden trampoline once, springs creak and boing', {'keep': 3}),
    ('place', S, SFX, 1, 2, 'placing a small wooden object on a table, soft thock'),
    ('place-room', S, SFX, 1, 1, 'heavy wooden box placed down on a floor, soft thud'),
    ('remove', S, SFX, 1, 1, 'soft quick whoosh'),
    # --- footsteps: cut one by one from a walk ---
    ('step-wood', C, SFX, 12, 1, 'footsteps walking slowly on a wooden floor indoors, shoes'),
    ('step-hard', C, SFX, 12, 1, 'footsteps walking slowly on a tiled floor, shoes'),
    ('step-soft', C, SFX, 12, 1, 'footsteps walking slowly on carpet'),
    ('step-grass', C, SFX, 12, 1, 'footsteps walking slowly on grass'),
    ('step-gravel', C, SFX, 12, 1, 'footsteps walking slowly on gravel'),
    ('step-water', C, SFX, 12, 1, 'footsteps splashing slowly through shallow water'),
    ('step-stairs', C, SFX, 12, 1, 'footsteps walking up wooden stairs'),
]


def seed_of(sid: str, take: int) -> int:
    return int(hashlib.md5(f'{sid}:{take}'.encode()).hexdigest()[:7], 16)


def generate(entry, force=False):
    sid, kind, model, secs, takes, prompt, *rest = entry
    opt = rest[0] if rest else {}
    RAW.mkdir(parents=True, exist_ok=True)
    for t in range(takes):
        out = RAW / f'{sid}~{t}.wav'
        if out.exists() and not force:
            continue
        cmd = [str(SA3 / '.venv/bin/python'), 'scripts/sa3_mlx.py', '--prompt', prompt, '--dit', model, '--decoder', 'same-s',
               '--seconds', str(secs), '--seed', str(seed_of(sid, t)), '--out', str(out)]
        if opt.get('neg'):
            cmd += ['--cfg', '3', '--negative-prompt', opt['neg']]
        r = subprocess.run(cmd, cwd=SA3, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists():
            print(f'  ! {sid}~{t} could not be generated: {r.stderr[-400:]}')
        else:
            print(f'  + {sid}~{t}')


# ---------- processing ----------

def mono(path):
    x, sr = sf.read(path, always_2d=True, dtype='float32')
    assert sr == SR, (path, sr)
    x = x.mean(axis=1)
    x = x - x.mean()
    # drop below 25 Hz: subtract a 40 ms moving average (with a cumulative sum, O(n))
    n = SR // 25
    c = np.cumsum(np.concatenate([np.zeros(1, dtype=np.float64), x.astype(np.float64)]))
    lo = np.arange(len(x)) - n // 2
    hi = np.minimum(len(x), lo + n)
    lo = np.maximum(0, lo)
    avg = (c[hi] - c[lo]) / (hi - lo)
    return (x - avg).astype(np.float32)


def envelope(x, ms=10):
    n = max(1, int(SR * ms / 1000))
    k = np.ones(n) / n
    return np.convolve(np.abs(x), k, mode='same')


def fade(x, fin=0.003, fout=0.04):
    a = min(len(x) // 3, int(SR * fin))
    b = min(len(x) // 3, int(SR * fout))
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b) ** 2
    return x


def db(v):
    return 20 * np.log10(max(v, 1e-9))


def steady(x, region=None):
    """Part to loop: the given region, or 1 s dropped at both ends and then silent or fading parts left at the ends (level
    10 dB below the median) trimmed: a coffee machine stopping, a vacuum slowing down, music fading out."""
    if region:
        return x[int(region[0] * SR): int(region[1] * SR)]
    cut = int(SR * 1.0)
    if len(x) > 4 * cut:
        x = x[cut:-cut]
    w = int(SR * 0.25)
    lv = np.array([20 * np.log10(np.sqrt((x[i:i + w] ** 2).mean()) + 1e-9) for i in range(0, len(x) - w, w)])
    if not len(lv):
        return x
    ok = np.where(lv > np.median(lv) - 10)[0]
    a, b = ok[0] * w, (ok[-1] + 1) * w
    return x[a:b] if b - a > SR * 3 else x


def make_loop(x, xfade):
    n = int(SR * xfade)
    body = x[:-n].copy()
    tail = x[-n:]
    t = np.linspace(0, np.pi / 2, n)
    body[:n] = body[:n] * np.sin(t) + tail * np.cos(t)
    return body


def trim_shot(x, max_s):
    """Cuts out the loudest event (from groups separated by more than 250 ms of silence): the second click at the end of a
    cabinet opening or the handle sound before a door closes is dropped; the press and release of a click (close together)
    stay together."""
    env = envelope(x, 5)
    peak = env.max()
    if peak <= 0:
        return x[: int(SR * 0.2)]
    loud = env > peak * 10 ** (-35 / 20)
    idx = np.where(loud)[0]
    gap = int(SR * 0.25)
    groups = []
    s0 = p = idx[0]
    for i in idx[1:]:
        if i - p > gap:
            groups.append((s0, p))
            s0 = i
        p = i
    groups.append((s0, p))
    a, b = max(groups, key=lambda g: env[g[0]:g[1] + 1].max())
    # the group's decay: until it drops to -45 dB
    tail = np.where(env[b:] < peak * 10 ** (-45 / 20))[0]
    b = b + (tail[0] if len(tail) else len(env) - b)
    start = max(0, a - int(SR * 0.01))
    end = min(len(x), b + int(SR * 0.05))
    y = x[start:end][: int(SR * max_s)]
    return fade(y.copy(), 0.003, min(0.15, len(y) / SR * 0.2))


def clarity(x):
    """How clear the event is: ratio of the envelope peak to its median (dB). Low when the model produced noise instead of an event."""
    env = envelope(x, 10)
    return 20 * np.log10(env.max() / (np.median(env) + 1e-9))


def slices(x, n=8):
    env = envelope(x, 8)
    hi, lo = env.max() * 0.3, env.max() * 0.12
    onsets = []
    armed = True
    for i in range(0, len(env), 64):
        if armed and env[i] > hi:
            onsets.append(i)
            armed = False
        elif not armed and env[i] < lo:
            armed = True
    onsets = [o for k, o in enumerate(onsets) if k == 0 or o - onsets[k - 1] > SR * 0.22]
    hits = []
    for k, o in enumerate(onsets):
        s = max(0, o - int(SR * 0.03))
        e = min(len(x), o + int(SR * 0.38), (onsets[k + 1] - int(SR * 0.02)) if k + 1 < len(onsets) else len(x))
        seg = fade(x[s:e].copy(), 0.004, 0.08)
        hits.append((float(np.abs(seg).max()), seg))
    hits.sort(key=lambda h: -h[0])
    return [h[1] for h in hits[:n]]


def level_loop(x, target=-22.0):
    rms = np.sqrt((x ** 2).mean())
    g = 10 ** ((target - db(rms)) / 20)
    y = x * g
    # peak headroom: when the pitch is varied per source (±4%), interpolation can overshoot the peak a little
    pk = np.abs(y).max()
    if pk > 0.8:
        y *= 0.8 / pk
    return y


def level_shot(x, peak=-4.0):
    pk = np.abs(x).max()
    return x * (10 ** (peak / 20) / max(pk, 1e-9))


def score_loop(x):
    """Loop suitability: the level of short windows should fluctuate little (no sudden bursts, no silent gaps)."""
    w = int(SR * 0.5)
    rms = np.array([np.sqrt((x[i:i + w] ** 2).mean()) + 1e-9 for i in range(0, len(x) - w, w)])
    return -np.std(20 * np.log10(rms))


def encode(x, path: Path):
    tmp = path.with_suffix('.tmp.wav')
    sf.write(tmp, x.astype(np.float32), SR, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(tmp), '-ac', '1', '-ar', str(SR), '-c:a', 'aac', '-b:a', '96k', str(path)], check=True)
    tmp.unlink()


def process(entry, manifest):
    sid, kind, model, secs, takes, prompt, *rest = entry
    opt = rest[0] if rest else {}
    raws = [RAW / f'{sid}~{t}.wav' for t in range(takes) if (RAW / f'{sid}~{t}.wav').exists()]
    if not raws:
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob(f'{sid}.*m4a'):
        old.unlink()
    for old in OUT.glob(f'{sid}-[0-9]*.m4a'):
        old.unlink()
    files, durs = [], []
    if kind == L:
        xf = 2.5 if model == MUSIC else 1.2
        cands = [make_loop(steady(mono(r), opt.get('region')), xf) for r in raws]
        best = max(cands, key=score_loop)
        y = level_loop(best, -18.0 if model == MUSIC else -22.0)
        name = f'{sid}.m4a'
        encode(y, OUT / name)
        files, durs = [name], [round(len(y) / SR, 3)]
    elif kind == S:
        xs = sorted((mono(r) for r in raws), key=clarity, reverse=True)
        good = [x for x in xs if clarity(x) >= 18] or xs[:1]
        for t, x in enumerate(good[: opt.get('keep', len(good))]):
            y = level_shot(trim_shot(x, opt.get('max', secs)))
            name = f'{sid}-{t + 1}.m4a'
            encode(y, OUT / name)
            files.append(name)
            durs.append(round(len(y) / SR, 3))
    else:
        hits = slices(mono(raws[0]))
        for t, h in enumerate(hits):
            y = level_shot(h)
            name = f'{sid}-{t + 1}.m4a'
            encode(y, OUT / name)
            files.append(name)
            durs.append(round(len(y) / SR, 3))
    manifest[sid] = {'files': files, 'loop': kind == L, 'dur': durs}
    print(f'  = {sid}: {len(files)} files')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only_process = '--process' in sys.argv
    entries = [e for e in CATALOG if not args or e[0] in args]
    if not only_process:
        for e in entries:
            generate(e, force=bool(args))
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    for e in entries:
        process(e, manifest)
    known = {e[0] for e in CATALOG}
    manifest = {k: v for k, v in sorted(manifest.items()) if k in known}
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')
    print(f'{len(manifest)} sounds, manifest {MANIFEST}')


if __name__ == '__main__':
    main()
