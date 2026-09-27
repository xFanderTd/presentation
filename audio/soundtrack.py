"""Процедурный саундтрек к ролику: музыка + звуковые эффекты, синхронные с таймлайном.

Все звуки синтезируются с нуля (без сэмплов): тайко, кото (Karplus–Strong), пэды,
«хор» на формантах, суб-бас, райзеры, удары, «разрезы», интерфейсные клики.
Запуск: python3 audio/soundtrack.py  →  build/soundtrack.wav
"""
import json
import math
import pathlib
import subprocess
import wave

import numpy as np
from scipy import signal

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48000
RNG = np.random.default_rng(20240930)


def load_timeline():
    js = "global.window={};require('./src/timeline.js');process.stdout.write(JSON.stringify(window.TIMELINE))"
    return json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT))


TL = load_timeline()
DUR = TL["duration"] + 1.0
N = int(DUR * SR)
BEAT, BAR = TL["beat"], TL["bar"]
STEP = BEAT / 4  # шестнадцатая

# Шины (стерео)
music = np.zeros((2, N))
drums = np.zeros((2, N))
sfx = np.zeros((2, N))
verb = np.zeros((2, N))  # посыл на реверберацию


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def add(bus, t0, sig, gain=1.0, pan=0.0, send=0.0):
    """Добавить моно-сигнал с панорамой (equal power) и посылом на ревер."""
    i0 = int(round(t0 * SR))
    if i0 >= N or len(sig) == 0:
        return
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    n = min(len(sig), N - i0)
    a = (pan + 1) * math.pi / 4
    gl, gr = math.cos(a) * gain, math.sin(a) * gain
    bus[0, i0:i0 + n] += sig[:n] * gl
    bus[1, i0:i0 + n] += sig[:n] * gr
    if send:
        verb[0, i0:i0 + n] += sig[:n] * gl * send
        verb[1, i0:i0 + n] += sig[:n] * gr * send


def lp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, f1, f2, order=2):
    return signal.sosfilt(signal.butter(order, [f1, min(f2, SR * 0.45)], "band", fs=SR, output="sos"), x)


def noise(dur):
    return RNG.standard_normal(int(dur * SR))


def svf_sweep(x, fc, q=0.5):
    """Полосовой state-variable фильтр с переменной частотой среза (fc — массив)."""
    out = np.empty_like(x)
    low = band = 0.0
    f = 2 * np.sin(np.pi * np.clip(fc, 20, SR * 0.2) / SR)
    for i in range(len(x)):
        fi = f[i]
        low += fi * band
        high = x[i] - low - q * band
        band += fi * high
        out[i] = band
    return out


# ---------------------------------------------------------------- генераторы
TABLE_N = 4096
_ph = np.arange(TABLE_N) / TABLE_N
SAW = sum(np.sin(2 * np.pi * k * _ph) / k for k in range(1, 33)) * 0.55


def osc(freq, dur, table=SAW, phase=0.0):
    n = int(dur * SR)
    f = np.full(n, freq) if np.isscalar(freq) else freq[:n]
    ph = (phase + np.cumsum(f) / SR) % 1.0
    idx = ph * TABLE_N
    i0 = idx.astype(int)
    fr = idx - i0
    return table[i0] * (1 - fr) + table[(i0 + 1) % TABLE_N] * fr


def adsr(n, a, d, s, r, sustain_len=None):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    e = np.full(n, s, dtype=float)
    e[:a] = np.linspace(0, 1, a, endpoint=False) if a else e[:a]
    e[a:a + d] = np.linspace(1, s, len(e[a:a + d]))
    if r:
        e[-r:] *= np.linspace(1, 0, len(e[-r:]))
    return e


def pluck(freq, dur=2.2, bright=0.6, decay=0.996):
    """Кото/сямисэн: Karplus–Strong через lfilter."""
    n = int(dur * SR)
    L = max(2, int(round(SR / freq - 0.5)))
    exc = np.zeros(n)
    burst = RNG.uniform(-1, 1, L)
    burst = lp(burst, 1500 + bright * 7000, 1)
    exc[:L] = burst
    a = np.zeros(L + 2)
    a[0] = 1
    a[L] = a[L + 1] = -decay / 2
    y = signal.lfilter([1.0], a, exc)
    y = y + 0.35 * bp(y, 700, 3200)  # «корпус»
    env = np.exp(-tvec(dur) / (dur * 0.5))
    return y * env / (np.max(np.abs(y)) + 1e-9)


def bell(freq, dur=2.5, ratio=3.5, index=2.2):
    t = tvec(dur)
    ind = index * np.exp(-t * 3.0)
    s = np.sin(2 * np.pi * freq * t + ind * np.sin(2 * np.pi * freq * ratio * t))
    s += 0.35 * np.sin(2 * np.pi * freq * 2.01 * t) * np.exp(-t * 2.5)
    return s * np.exp(-t * 1.8) * np.minimum(1, t * 400)


def taiko(pitch=1.0, dur=1.6, slap=0.5):
    t = tvec(dur)
    f = 55 * pitch * (1 + 1.2 * np.exp(-t * 28))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 3.8)
    body += 0.35 * np.sin(ph * 1.58) * np.exp(-t * 7) + 0.18 * np.sin(ph * 2.24) * np.exp(-t * 11)
    sl = bp(noise(dur), 150, 1600) * np.exp(-t * 45) * slap
    x = np.tanh((body + sl) * 1.6)
    return x * np.minimum(1, t * 2000)


def kick(dur=0.7, tight=1.0):
    t = tvec(dur)
    f = 46 + 110 * np.exp(-t * 30 * tight)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6 * tight)
    click = hp(noise(0.004), 2000) * 0.25
    s[: len(click)] += click
    return np.tanh(s * 1.4)


def clap(dur=0.6):
    t = tvec(dur)
    n = bp(noise(dur), 900, 5200)
    env = np.zeros_like(t)
    for k, off in enumerate([0, 0.011, 0.023, 0.034]):
        env += (t >= off) * np.exp(-(t - off).clip(0) * (90 if k < 3 else 16))
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30) * 0.4
    return (n * env + tone) * 0.6


def hat(open_=False):
    dur = 0.35 if open_ else 0.07
    t = tvec(dur)
    return hp(noise(dur), 7500, 4) * np.exp(-t * (9 if open_ else 70))


def shaker():
    t = tvec(0.12)
    return bp(noise(0.12), 4500, 11000) * np.sin(np.pi * np.clip(t / 0.12, 0, 1)) ** 2


# ---------------------------------------------------------------- гармония
CHORDS = {
    "Dm": ([50, 53, 57, 62, 64], 38),
    "Bb": ([46, 50, 53, 58, 62], 34),
    "Gm": ([43, 50, 55, 58, 62], 31),
    "Eb": ([51, 55, 58, 62, 63], 39),
    "F": ([53, 57, 60, 65, 67], 29),
    "C": ([48, 55, 60, 64, 67], 36),
    "A": ([45, 52, 57, 61, 64], 33),
}
PROG = (
    ["Dm"] * 4  # вступление
    + ["Dm", "Bb", "Gm", "Eb", "Dm", "Bb"]  # мир
    + ["Dm", "Bb", "Gm", "A", "Dm", "Bb", "Gm", "Eb"]  # иерархия
    + ["Dm", "Dm", "Eb", "Dm", "Eb", "Dm", "Bb", "Gm", "A"]  # ранги
    + ["Dm", "Bb", "Gm", "Eb", "Dm", "Bb", "A"]  # слагаемые
    + ["Dm", "Dm", "Bb", "Gm", "Eb", "Dm", "A", "Dm", "Bb", "Eb", "Dm", "Bb", "Gm", "A"]  # рейтинг
    + ["Dm", "Bb", "F", "C", "Dm", "Bb", "F", "C", "A"]  # потенциал
    + ["Dm", "Bb", "Gm", "Dm", "Dm", "Dm"]  # финал
)
IN_SCALE = [2, 3, 7, 9, 10]  # D In: D Eb G A Bb
MINOR_PENTA = [2, 5, 7, 9, 0]  # D F G A C


def scale_note(deg, base=62, scale=IN_SCALE):
    pcs = sorted(scale)
    octv, i = divmod(deg, len(pcs))
    root_pc = base % 12
    rel = [((p - root_pc) % 12) for p in pcs]
    rel.sort()
    return base + 12 * octv + rel[i]


# Интенсивность слоёв по тактам: pad, choir, bass, koto, drums-паттерн
def section(bar):
    t = bar * BAR
    if t < 5:
        return dict(pad=0.55, cut=500, choir=0, bass="drone", koto=0, drums=None)
    if t < 10:
        return dict(pad=0.8, cut=1300, choir=0.25, bass="drone", koto="sparse", drums="sparse")
    if t < 25:
        return dict(pad=0.75, cut=1500, choir=0, bass="long", koto="arp8", drums="half" if t >= 15 else "sparse")
    if t < 45:
        return dict(pad=0.7, cut=2000, choir=0, bass="pulse8", koto="arp16", drums="groove")
    if t < 47.5:
        return dict(pad=0.7, cut=1600, choir=0, bass="long", koto="sparse", drums="sparse")
    if t < 57.5:
        return dict(pad=0.65, cut=900 + (t - 47.5) * 150, choir=0.2, bass="long", koto="tremolo" if t >= 52.5 else "sparse", drums="build" if t >= 55 else None)
    if t < 60:
        return dict(pad=0.95, cut=3200, choir=0.7, bass="pulse8", koto="arp16", drums="epic")
    if t < 67.5:
        return dict(pad=0.8, cut=2200, choir=0.55, bass="long", koto="arp8", drums="half")
    if t < 85:
        return dict(pad=0.7, cut=2200, choir=0, bass="pulse8", koto="arp16", drums="groove")
    if t < 87.5:
        return dict(pad=0.7, cut=1600, choir=0, bass="long", koto="sparse", drums="sparse")
    if t < 100:
        return dict(pad=0.8, cut=2800, choir=0.2, bass="pulse16", koto="arp16", drums="drive")
    if t < 102.5:
        return dict(pad=0.7, cut=1800, choir=0.3, bass="long", koto="tremolo", drums="build")
    if t < 110:
        return dict(pad=1.0, cut=3400, choir=0.8, bass="pulse8", koto="arp16", drums="epic")
    if t < 112.5:
        return dict(pad=0.9, cut=2400, choir=0.7, bass="long", koto=0, drums=None)
    if t < 120:
        return dict(pad=0.65, cut=1100, choir=0.3, bass="long", koto="sparse", drums="heart")
    if t < 122.5:
        return dict(pad=0.6, cut=1400, choir=0, bass="long", koto="sparse", drums="sparse")
    if t < 132.5:
        return dict(pad=0.7, cut=1900, choir=0.25, bass="long", koto="melody", drums="light")
    if t < 140:
        return dict(pad=0.8, cut=2600, choir=0.4, bass="pulse8", koto="melody", drums="half")
    if t < 142.5:
        return dict(pad=0.75, cut=2000, choir=0.4, bass="long", koto="tremolo", drums="build")
    if t < 150:
        return dict(pad=0.7, cut=1500, choir=0.35, bass="long", koto="sparse", drums=None)
    return dict(pad=0.9, cut=2400, choir=0.7, bass="drone", koto=0, drums=None)


# ---------------------------------------------------------------- музыка
def render_music():
    nbars = int(math.ceil(TL["duration"] / BAR))
    for b in range(nbars):
        t0 = b * BAR
        name = PROG[min(b, len(PROG) - 1)]
        notes, root = CHORDS[name]
        S = section(b)
        last = b == nbars - 1
        seg = BAR + (3.5 if last else 1.2)

        # Пэд: суперсо, фильтр, мягкая атака, «хвост» перекрывает следующий такт
        pad = np.zeros(int(seg * SR))
        for k, m in enumerate(notes[:4]):
            for det in (-0.09, 0.0, 0.11):
                pad += osc(mtof(m + det), seg, phase=RNG.random()) * (0.9 if k else 1.0)
        pad = lp(pad, S["cut"])
        env = np.minimum(1, tvec(seg) / 0.35) * np.clip((seg - tvec(seg)) / (1.2 if not last else 3.5), 0, 1)
        pad = hp(pad, 140)
        add(music, t0, pad * env, 0.03 * S["pad"], pan=-0.35, send=0.35)
        add(music, t0, lp(pad, S["cut"] * 0.6) * env, 0.026 * S["pad"], pan=0.35, send=0.35)

        # «Хор» — пила через форманты «а»
        if S["choir"]:
            ch = np.zeros(int(seg * SR))
            vib = 1 + 0.004 * np.sin(2 * np.pi * 5.1 * tvec(seg))
            for m in notes[1:4]:
                for det in (-0.07, 0.07):
                    ch += osc(mtof(m + 12 + det) * vib, seg, phase=RNG.random())
            form = bp(ch, 650, 900) + 0.7 * bp(ch, 1000, 1300) + 0.25 * bp(ch, 2500, 3100)
            env = np.minimum(1, tvec(seg) / 0.6) * np.clip((seg - tvec(seg)) / 1.2, 0, 1)
            add(music, t0, form * env, 0.07 * S["choir"], pan=0.0, send=0.7)

        # Бас
        f = mtof(root)
        if S["bass"] in ("drone", "long"):
            tt = tvec(seg)
            bs = np.sin(2 * np.pi * f * tt) + (0.35 if S["bass"] == "drone" else 0.0) * np.sin(2 * np.pi * f / 2 * tt)
            bs = np.tanh(bs * 1.8) * np.minimum(1, tt / 0.2) * np.clip((seg - tt) / 1.0, 0, 1)
            add(music, t0, bs, 0.055 if S["bass"] == "long" else 0.07)
        else:
            step = BEAT / 2 if S["bass"] == "pulse8" else BEAT / 4
            for i in range(int(BAR / step)):
                d = step * 0.9
                tt = tvec(d)
                bs = np.tanh((np.sin(2 * np.pi * f * tt) + 0.6 * np.sin(2 * np.pi * 2 * f * tt)) * 1.6)
                bs *= np.exp(-tt * 5) * np.minimum(1, tt / 0.004) * np.clip((d - tt) / 0.02, 0, 1)
                add(music, t0 + i * step, lp(bs, 1400), 0.075 if i % 2 == 0 else 0.055)

        # Кото / сямисэн
        k = S["koto"]
        scale = MINOR_PENTA if 120 <= t0 < 142.5 else IN_SCALE
        if k == "sparse":
            for i, (beat, deg) in enumerate([(0, 0), (1.5, 3), (2.5, 2), (3.5, 4)]):
                if RNG.random() < 0.8:
                    m = scale_note(deg + int(RNG.integers(0, 3)), 62, scale)
                    add(music, t0 + beat * BEAT, pluck(mtof(m), 2.4, 0.5), 0.18, pan=RNG.uniform(-0.6, 0.6), send=0.5)
        elif k in ("arp8", "arp16"):
            step = BEAT / 2 if k == "arp8" else BEAT / 4
            pattern = [0, 2, 4, 5, 3, 4, 6, 4] if k == "arp8" else [0, 2, 4, 2, 5, 4, 2, 4, 6, 4, 2, 4, 5, 4, 3, 2]
            for i in range(int(BAR / step)):
                deg = pattern[i % len(pattern)] + (1 if (b % 2 and i % 4 == 3) else 0)
                m = scale_note(deg, 62 if name not in ("Gm", "Eb") else 55, scale)
                vel = 0.16 if i % 4 == 0 else 0.1
                add(music, t0 + i * step, pluck(mtof(m), 1.3, 0.7 if k == "arp16" else 0.5), vel, pan=0.6 * math.sin(i * 0.9), send=0.3)
        elif k == "tremolo":
            for i in range(16):
                m = scale_note(4 + (i // 8), 62, scale)
                add(music, t0 + i * STEP, pluck(mtof(m), 0.6, 0.8), 0.05 + 0.05 * i / 16, pan=0.3 if i % 2 else -0.3, send=0.4)
        elif k == "melody":
            phrase = [(0, 4, 1.5), (1.5, 3, 0.5), (2, 2, 1.0), (3, 1, 1.0)] if b % 2 == 0 else [(0, 2, 1.0), (1, 3, 0.5), (1.5, 4, 1.5), (3, 6, 1.0)]
            for beat, deg, _ in phrase:
                m = scale_note(deg, 62, scale)
                add(music, t0 + beat * BEAT, pluck(mtof(m), 2.6, 0.45, 0.9975), 0.22, pan=0.1, send=0.6)
                add(music, t0 + beat * BEAT + 0.012, pluck(mtof(m + 12), 1.4, 0.3), 0.04, pan=-0.3, send=0.6)

        # Ударные
        pat = S["drums"]
        if pat:
            render_drums(t0, pat, b)


def render_drums(t0, pat, b):
    def at(step):
        return t0 + step * STEP

    if pat == "sparse":
        add(drums, at(0), taiko(0.9), 0.35, send=0.5)
    elif pat == "half":
        add(drums, at(0), taiko(1.0), 0.38, send=0.45)
        add(drums, at(0), kick(), 0.35)
        add(drums, at(10), kick(), 0.25)
        add(drums, at(8), clap(), 0.22, send=0.5)
        for s in range(0, 16, 2):
            add(drums, at(s), shaker(), 0.05 if s % 4 else 0.07, pan=0.3)
    elif pat == "light":
        add(drums, at(0), kick(tight=1.3), 0.25)
        add(drums, at(8), taiko(1.3, slap=0.2), 0.18, send=0.5)
        for s in range(0, 16, 2):
            add(drums, at(s + (0.3 if s % 4 else 0)), shaker(), 0.045, pan=0.35)
    elif pat == "groove":
        for s in (0, 6, 10):
            add(drums, at(s), kick(), 0.34 if s == 0 else 0.26)
        add(drums, at(0), taiko(0.95), 0.25, send=0.4)
        add(drums, at(4), clap(), 0.2, send=0.35)
        add(drums, at(12), clap(), 0.22, send=0.35)
        for s in range(16):
            add(drums, at(s), hat(open_=(s == 14)), 0.045 if s % 2 else 0.07, pan=0.25)
        if b % 4 == 3:
            for s, p in zip((12, 13, 14, 15), (1.5, 1.3, 1.15, 1.0)):
                add(drums, at(s), taiko(p, 0.8), 0.22, pan=0.2 * (s - 13.5), send=0.4)
    elif pat == "drive":
        for s in (0, 4, 8, 12):
            add(drums, at(s), kick(), 0.34)
        for s in (4, 12):
            add(drums, at(s), clap(), 0.22, send=0.35)
        add(drums, at(0), taiko(0.9), 0.3, send=0.45)
        add(drums, at(10), taiko(1.2), 0.2, send=0.45)
        for s in range(16):
            add(drums, at(s), hat(open_=(s % 4 == 2)), 0.05 if s % 2 else 0.075, pan=-0.2)
        if b % 2 == 1:
            for s, p in zip((13, 14, 15), (1.4, 1.2, 1.0)):
                add(drums, at(s), taiko(p, 0.7), 0.22, pan=0.15 * (s - 14), send=0.4)
    elif pat == "epic":
        add(drums, at(0), taiko(0.75, 2.0, 0.8), 0.55, send=0.6)
        add(drums, at(0), kick(1.0, 0.8), 0.4)
        add(drums, at(6), taiko(1.0), 0.3, send=0.5)
        add(drums, at(8), clap(), 0.28, send=0.6)
        add(drums, at(8), taiko(0.85), 0.35, send=0.5)
        add(drums, at(11), taiko(1.1), 0.25, send=0.5)
        for s in range(0, 16, 2):
            add(drums, at(s), hat(), 0.05, pan=0.3)
        for s, p in zip((13, 14, 15), (1.35, 1.2, 1.05)):
            add(drums, at(s), taiko(p, 0.8), 0.25, pan=0.2 * (s - 14), send=0.45)
    elif pat == "build":
        # дробь с ускорением к следующему такту
        s = 0.0
        while s < 16:
            vol = 0.06 + 0.2 * (s / 16) ** 2
            add(drums, at(s), clap(0.25), vol, pan=0.1 * math.sin(s), send=0.3)
            s += 2 if s < 8 else (1 if s < 12 else 0.5)
        add(drums, at(0), taiko(0.9), 0.3, send=0.5)
    elif pat == "heart":
        for s, v in ((0, 0.3), (2.5, 0.2), (8, 0.3), (10.5, 0.2)):
            add(drums, at(s), kick(0.6, 0.8), v)


# ---------------------------------------------------------------- эффекты
def fx_impact(t, power=1.0, tail=2.5):
    d = 3.5 + tail * 0.4
    tt = tvec(d)
    f = 32 + 70 * np.exp(-tt * 5)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.8)
    punch = np.tanh(lp(noise(d), 380) * 3) * np.exp(-tt * 9)
    crack = hp(noise(d), 2500) * np.exp(-tt * 40)
    wash = lp(noise(d), 3500) * np.exp(-tt / (tail * 0.45))
    x = sub * 0.8 + punch * 0.6 + crack * 0.4 + wash * 0.16
    x *= np.minimum(1, tt * 3000)
    add(sfx, t, np.tanh(x * 1.4), 0.62 * power, send=0.5)
    add(sfx, t, taiko(0.6, 2.5, 0.9), 0.45 * power, send=0.7)


def fx_riser(t, end, gain=0.8):
    d = end - t
    tt = tvec(d)
    p = tt / d
    fc = 250 * (7000 / 250) ** (p ** 1.4)
    nz = svf_sweep(noise(d), fc, 0.35) * 0.4
    tone = osc(110 * 2 ** (3 * p ** 1.6), d) * 0.25 + osc(165 * 2 ** (3 * p ** 1.6), d) * 0.15
    env = p ** 2.2
    x = (nz + lp(tone, 5000)) * env
    x[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    add(sfx, t, x, 0.5 * gain, pan=-0.2, send=0.4)
    add(sfx, t + 0.013, x, 0.5 * gain, pan=0.2, send=0.4)


def fx_reverse(t, end, gain=0.8):
    d = end - t
    tt = tvec(d)
    x = hp(noise(d), 3000) * np.exp((tt - d) * 3.2)
    add(sfx, t, x, 0.28 * gain, send=0.6)


def fx_whoosh(t, dur=1.0, gain=0.5):
    tt = tvec(dur)
    p = tt / dur
    fc = 300 + 3500 * np.sin(np.pi * p) ** 1.5
    x = svf_sweep(noise(dur), fc, 0.6) * np.sin(np.pi * p) ** 2
    n = len(x)
    pans = np.linspace(-0.8, 0.8, n)
    L = x * np.cos((pans + 1) * np.pi / 4)
    R = x * np.sin((pans + 1) * np.pi / 4)
    i0 = int(t * SR)
    m = min(n, N - i0)
    sfx[0, i0:i0 + m] += L[:m] * gain * 0.55
    sfx[1, i0:i0 + m] += R[:m] * gain * 0.55
    verb[:, i0:i0 + m] += np.vstack([L[:m], R[:m]]) * gain * 0.2


def fx_slash(t, gain=1.0):
    d = 0.42
    tt = tvec(d)
    p = tt / d
    fc = 900 * (9000 / 900) ** p
    sw = svf_sweep(noise(d), fc, 0.4) * np.sin(np.pi * p) ** 1.5
    add(sfx, t, sw, 0.45 * gain, pan=-0.3, send=0.3)
    # металлический «звон» клинка в момент разреза
    dr = 1.4
    tr = tvec(dr)
    ringsig = sum(a * np.sin(2 * np.pi * 2350 * r * tr) * np.exp(-tr * dcy) for r, a, dcy in ((1, 1, 3.5), (2.76, 0.5, 5), (5.4, 0.3, 8), (8.93, 0.15, 11)))
    ringsig = ringsig + hp(noise(dr), 6000) * np.exp(-tr * 30) * 0.6
    add(sfx, t + 0.3, ringsig * np.minimum(1, tr * 3000), 0.09 * gain, pan=0.35, send=0.5)
    add(sfx, t + 0.3, lp(noise(0.25), 600) * np.exp(-tvec(0.25) * 18), 0.3 * gain)


def fx_tick(t, gain=0.5, note=0):
    d = 0.06
    tt = tvec(d)
    f = 2600 + 180 * note
    x = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 90) + hp(noise(d), 4000) * np.exp(-tt * 300) * 0.5
    add(sfx, t, x, 0.16 * gain, pan=0.2 * math.sin(note * 1.7), send=0.15)


def fx_blip(t, note=0, gain=0.5):
    m = scale_note(note, 74)
    d = 0.5
    tt = tvec(d)
    x = np.sin(2 * np.pi * mtof(m) * tt + 1.2 * np.exp(-tt * 20) * np.sin(2 * np.pi * mtof(m) * 2 * tt)) * np.exp(-tt * 9)
    add(sfx, t, x * np.minimum(1, tt * 2000), 0.13 * gain, pan=0.3 * math.sin(note), send=0.4)


def fx_bell(t, note=0, gain=0.6):
    m = scale_note(note, 74)
    add(sfx, t, bell(mtof(m), 3.0), 0.12 * gain, pan=0.25 * math.cos(note), send=0.6)


def fx_glitch(t, gain=0.6):
    for i in range(14):
        tt0 = t + RNG.uniform(0, 0.42)
        d = RNG.uniform(0.012, 0.05)
        tt = tvec(d)
        if RNG.random() < 0.5:
            x = np.sign(np.sin(2 * np.pi * RNG.uniform(200, 1800) * tt))
        else:
            x = np.round(noise(d) * 3) / 3
        x = lp(x, 6000) * np.hanning(len(x))
        add(sfx, tt0, x, 0.12 * gain, pan=RNG.uniform(-0.9, 0.9), send=0.1)


def fx_card(t, power=0.55):
    add(sfx, t, taiko(0.7, 2.2, 0.9), 0.55 * power, send=0.7)
    tt = tvec(1.8)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 50 * np.exp(-tt * 8)) / SR) * np.exp(-tt * 2.5)
    add(sfx, t, sub, 0.45 * power)
    add(sfx, t, hp(noise(0.3), 1500) * np.exp(-tvec(0.3) * 14), 0.12 * power, send=0.6)


def fx_hit(t, power=0.5, note=0):
    add(sfx, t, taiko(0.8 + 0.12 * note, 1.8, 0.8), 0.6 * power, send=0.6)
    add(sfx, t, kick(0.8, 0.9), 0.35 * power)
    add(sfx, t, bell(mtof(scale_note(note, 62)), 2.0, 1.4, 1.5), 0.06 * power, send=0.8)


def fx_node(t, note=0, gain=0.7):
    fx_tick(t, 0.8 * gain, note)
    tt = tvec(0.25)
    add(sfx, t, np.sin(2 * np.pi * 110 * tt) * np.exp(-tt * 18), 0.22 * gain)
    fx_bell(t + 0.02, note, 0.5 * gain)


def fx_cardlet(t, note=0, gain=0.7):
    fx_whoosh(t - 0.18, 0.4, 0.35 * gain)
    fx_bell(t, note, 0.8 * gain)
    add(sfx, t, taiko(1.4, 0.8, 0.3), 0.14 * gain, send=0.4)


def render_sfx():
    for c in TL["cues"]:
        t, ty = c["t"], c["type"]
        g = c.get("gain", 1.0)
        if ty == "impact":
            fx_impact(t, c.get("power", 1.0), c.get("tail", 2.5))
        elif ty == "riser":
            fx_riser(t, c["end"], g)
        elif ty == "reverse":
            fx_reverse(t, c["end"], g)
        elif ty == "whoosh":
            fx_whoosh(t, c.get("dur", 1.0), g)
        elif ty == "slash":
            fx_slash(t, g)
        elif ty == "tick":
            fx_tick(t, g, c.get("note", 0))
        elif ty == "blip":
            fx_blip(t, c.get("note", 0), g)
        elif ty == "bell":
            fx_bell(t, c.get("note", 0), g)
        elif ty == "glitch":
            fx_glitch(t, g)
        elif ty == "card":
            fx_card(t, c.get("power", 0.55))
        elif ty == "hit":
            fx_hit(t, c.get("power", 0.5), c.get("note", 0))
        elif ty == "node":
            fx_node(t, c.get("note", 0), g)
        elif ty == "cardlet":
            fx_cardlet(t, c.get("note", 0), g)


# ---------------------------------------------------------------- сведение
def reverb_ir(dur=3.2):
    tt = tvec(dur)
    irs = []
    for ch in range(2):
        n = RNG.standard_normal(len(tt)) * np.exp(-tt / (dur * 0.28))
        n = lp(n, 5500) * (1 - np.exp(-tt * 120))
        irs.append(n / np.sqrt(np.sum(n ** 2)))
    return irs


def duck_env():
    """Приглушение музыки на ударах, чтобы они «пробивали» микс."""
    env = np.ones(N)
    for c in TL["cues"]:
        if c["type"] in ("impact", "card", "hit"):
            depth = 0.55 * c.get("power", 0.6)
            i0 = int(c["t"] * SR)
            L = int(1.2 * SR)
            k = 1 - depth * np.exp(-np.arange(L) / (0.35 * SR))
            seg = env[i0:i0 + L]
            env[i0:i0 + L] = np.minimum(seg, k[: len(seg)])
    return env


def main():
    print("музыка…")
    render_music()
    print("эффекты…")
    render_sfx()
    print("сведение…")
    d = duck_env()
    mix = (music + drums * 0.9) * d + sfx
    ir = reverb_ir()
    wet = np.vstack([signal.fftconvolve(verb[i], ir[i])[:N] for i in range(2)])
    mix = mix + wet * 0.55
    mix = np.vstack([hp(mix[i], 34, 3) for i in range(2)])
    # мастер-эквалайзер: полка −5 дБ ниже ~90 Гц и лёгкий подъём «присутствия» 1.2–5 кГц
    mix = np.vstack([mix[i] - 0.45 * lp(mix[i], 90) + 0.35 * bp(mix[i], 1200, 5000) for i in range(2)])
    # мягкая компрессия огибающей + лимитер
    rms = np.sqrt(lp(np.mean(mix ** 2, axis=0), 8, 1).clip(1e-9))
    target = 0.16
    gain = np.clip(target / rms, 0.5, 2.2) ** 0.35
    mix = mix * gain
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    # затухания
    fade_in = np.minimum(1, np.arange(N) / (0.02 * SR))
    tt = np.arange(N) / SR
    fade_out = np.clip((TL["duration"] - tt) / 2.0, 0, 1)
    mix = mix * fade_in * fade_out
    mix = mix[:, : int(TL["duration"] * SR)]
    peak = np.max(np.abs(mix))
    mix = mix / peak * 10 ** (-1 / 20)
    out = ROOT / "build" / "soundtrack.wav"
    out.parent.mkdir(exist_ok=True)
    pcm = (mix.T * 32767).astype("<i2")
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    # отчёт об уровнях по сценам
    for s in TL["scenes"]:
        a, b = int(s["start"] * SR), int(s["end"] * SR)
        seg = mix[:, a:b]
        print(f"  {s['id']:<10} RMS {20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12):6.1f} dBFS   пик {20 * np.log10(np.max(np.abs(seg)) + 1e-12):5.1f}")
    print("→", out)


if __name__ == "__main__":
    main()
