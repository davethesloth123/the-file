#!/usr/bin/env python3
"""Procedural audio for The File — committed WAVs, like the texture maps.

Pure stdlib synthesis (wave/struct/math/random with fixed seeds — the tool
is deterministic, reruns produce identical bytes). Mono 16-bit 22050 Hz.

  step_stone_walk_{0..3}.wav   boot on wet stone, unhurried
  step_stone_hurry_{0..3}.wav  the same boot, harder and shorter
  step_wood_{0..3}.wav         interior floorboards
  ambience_city.wav            wind bed + distant tram drone, seamless loop

Bible §11: sparse and diegetic. There is no detection stinger in this tool
and there must never be one.
"""
import math
import os
import random
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/audio')
SR = 22050


def save(name, samples):
    path = os.path.join(OUT, name)
    peak = max(1e-9, max(abs(s) for s in samples))
    norm = 0.92 / peak if peak > 0.92 else 1.0
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(
            struct.pack('<h', int(max(-1, min(1, s * norm)) * 32767)) for s in samples))
    print(f'{name:26s} {os.path.getsize(path)//1024}KB')


class Biquad:
    """RBJ cookbook band-pass (constant skirt gain)."""
    def __init__(self, f0, q):
        w0 = 2 * math.pi * f0 / SR
        alpha = math.sin(w0) / (2 * q)
        b0, b1, b2 = math.sin(w0) / 2, 0.0, -math.sin(w0) / 2
        a0, a1, a2 = 1 + alpha, -2 * math.cos(w0), 1 - alpha
        self.c = (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
        self.x1 = self.x2 = self.y1 = self.y2 = 0.0

    def run(self, x):
        b0, b1, b2, a1, a2 = self.c
        y = b0 * x + b1 * self.x1 + b2 * self.x2 - a1 * self.y1 - a2 * self.y2
        self.x2, self.x1 = self.x1, x
        self.y2, self.y1 = self.y1, y
        return y


def footstep(seed, hard=False, wood=False):
    rng = random.Random(seed)
    dur = 0.075 if hard else 0.09
    n = int(SR * dur)
    heel = Biquad(2600 + rng.uniform(-350, 350), 1.1)
    body = Biquad((650 if not wood else 380) + rng.uniform(-60, 60), 0.9)
    out = []
    thump_f = (95 if not wood else 130) + rng.uniform(-8, 8)
    for i in range(n):
        t = i / SR
        s = 0.0
        # heel click: first few ms of band-passed noise
        if t < 0.006:
            s += heel.run(rng.uniform(-1, 1)) * (1.4 if hard else 1.0)
        # body: damped noise burst
        tau = 0.022 if hard else 0.035
        s += body.run(rng.uniform(-1, 1)) * math.exp(-t / tau) * 0.9
        # sole thump
        s += math.sin(2 * math.pi * thump_f * t) * math.exp(-t / 0.05) * (0.45 if not wood else 0.6)
        out.append(s)
    return out


def ambience(seconds=14.0):
    """Wind bed with slow swell + a faint tram drone that comes and goes.
    Built from oscillators and filtered noise with loop-periodic LFOs, so
    the file is a seamless loop by construction."""
    rng = random.Random(977)
    n = int(SR * seconds)
    wind = Biquad(240, 0.5)
    out = []
    two_pi = 2 * math.pi
    for i in range(n):
        t = i / seconds / SR          # 0..1 through the loop
        # loop-periodic LFOs (integer cycles per loop)
        swell = 0.55 + 0.45 * math.sin(two_pi * (2 * t + 0.25))
        gust = 0.5 + 0.5 * math.sin(two_pi * (5 * t + 0.6))
        s = wind.run(rng.uniform(-1, 1)) * 0.28 * swell * (0.7 + 0.3 * gust)
        # distant tram: a beat-frequency hum, present for part of the loop
        tram_env = max(0.0, math.sin(two_pi * (t + 0.1))) ** 3
        tt = i / SR
        s += (math.sin(two_pi * 68 * tt) + math.sin(two_pi * 68.7 * tt)) * 0.045 * tram_env
        s += math.sin(two_pi * 210 * tt) * 0.015 * tram_env
        out.append(s)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for k in range(4):
        save(f'step_stone_walk_{k}.wav', footstep(100 + k))
        save(f'step_stone_hurry_{k}.wav', footstep(200 + k, hard=True))
        save(f'step_wood_{k}.wav', footstep(300 + k, wood=True))
    save('ambience_city.wav', ambience())


if __name__ == '__main__':
    main()
