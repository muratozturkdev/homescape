"""Spectrogram image (sound review): PNG with a log-frequency spectrogram and waveform for each WAV file.
Usage: .venv/bin/python spectro.py out.png a.wav b.wav ...  (the Python in stable-audio-3/optimized/mlx/.venv)
"""
import sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

W, H = 900, 150


def spec_img(path):
    x, sr = sf.read(path, always_2d=True)
    x = x.mean(axis=1)
    n = 2048
    hop = max(256, len(x) // W)
    win = np.hanning(n)
    frames = []
    for i in range(0, max(1, len(x) - n), hop):
        frames.append(np.abs(np.fft.rfft(x[i:i + n] * win)))
    S = np.array(frames).T + 1e-9
    db = 20 * np.log10(S / S.max())
    freqs = np.fft.rfftfreq(n, 1 / sr)
    # log frequency axis: 40 Hz - 16 kHz
    rows = np.geomspace(40, 16000, H)
    idx = np.clip(np.searchsorted(freqs, rows), 0, len(freqs) - 1)
    img = db[idx][::-1]
    img = np.clip((img + 80) / 80, 0, 1)
    img = (img * 255).astype(np.uint8)
    im = Image.fromarray(img).resize((W, H))
    # waveform strip
    wave = Image.new('L', (W, 40), 0)
    d = ImageDraw.Draw(wave)
    seg = np.array_split(np.abs(x), W)
    for i, s in enumerate(seg):
        v = float(s.max()) if len(s) else 0
        d.line([(i, 20 - v * 20), (i, 20 + v * 20)], fill=200)
    out = Image.new('L', (W, H + 40 + 14), 30)
    out.paste(im, (0, 14))
    out.paste(wave, (0, H + 14))
    ImageDraw.Draw(out).text((4, 1), f"{path.split('/')[-1]}  {len(x)/sr:.1f}s  peak {np.abs(x).max():.2f}  rms {np.sqrt((x**2).mean()):.3f}", fill=255)
    return out


def main():
    out, files = sys.argv[1], sys.argv[2:]
    ims = [spec_img(f) for f in files]
    sheet = Image.new('L', (W, sum(i.height for i in ims)), 0)
    y = 0
    for i in ims:
        sheet.paste(i, (0, y))
        y += i.height
    sheet.save(out)


main()
