#!/usr/bin/env python3
"""FBM ENGINE · bed synthesis library (unchanged from the shipped Mac baseline).

Each episode writes a ~30-line recipe:
    from bedlib import Bed
    b = Bed(116.33)
    b.drone(); b.tone(82.41, 0.045, 0.85, 13.6); b.pad([174.61, 220.0, 261.63], 0.028, 13.4, 33.2)
    b.heartbeat(1.2, 13.0); b.impact(6.45, 0.34, 46); b.riser(8.6, 1.6, 0.10); b.ticks(35.0, 38.4)
    b.write("bed.wav")
The voice is the star — keep amps at these scales.
"""
import numpy as np, wave

SR = 48000


class Bed:
    def __init__(self, dur):
        self.dur = dur
        self.n = int(SR * dur)
        self.t = np.arange(self.n) / SR
        self.out = np.zeros(self.n)

    def _env(self, a, b, rise=0.8, fall=1.2):
        e = np.zeros(self.n)
        i0, i1 = int(a * SR), int(min(b, self.dur) * SR)
        e[i0:i1] = 1.0
        r, f = int(rise * SR), int(fall * SR)
        w = max(1, i1 - i0)
        r = max(1, min(r, w)); f = max(1, min(f, w))
        if i0 + r <= self.n: e[i0:i0 + r] = np.linspace(0, 1, r)
        e[i1 - f:i1] = np.minimum(e[i1 - f:i1], np.linspace(1, 0, f))
        return e

    def tone(self, f, amp, a, b, detune=0.0, rise=0.8, fall=1.2):
        e = self._env(a, b, rise, fall)
        s = np.sin(2 * np.pi * f * self.t)
        if detune:
            s = 0.5 * s + 0.5 * np.sin(2 * np.pi * (f + detune) * self.t)
        self.out += amp * s * e

    def pad(self, freqs, amp, a, b, detune=0.35):
        for f in freqs:
            self.tone(f, amp, a, b, detune=detune, rise=1.5, fall=1.5)

    def drone(self, f=55.0, amp=0.085):
        lfo = 0.80 + 0.20 * np.sin(2 * np.pi * 0.055 * self.t)
        self.out += amp * np.sin(2 * np.pi * f * self.t) * self._env(0, self.dur, 2, 3) * lfo
        self.out += amp * 0.35 * np.sin(2 * np.pi * f * 2 * self.t) * self._env(0, self.dur, 2, 3) * lfo

    def heartbeat(self, a, b, period=1.15, amp=0.16):
        k = 0
        while a + k * period < b:
            for off, g in ((0.0, amp), (0.30, amp * 0.62)):
                st = a + k * period + off
                i = int(st * SR); L = int(0.18 * SR)
                if i + L >= self.n: break
                d = np.exp(-np.linspace(0, 9, L))
                self.out[i:i + L] += g * d * np.sin(2 * np.pi * 48 * np.arange(L) / SR)
            k += 1

    def impact(self, st, amp=0.30, f0=48):
        i = int(st * SR); L = min(int(1.1 * SR), self.n - i - 1)
        if L <= 0: return
        d = np.exp(-np.linspace(0, 6.5, L))
        sweep = np.linspace(f0, f0 * 0.55, L)
        self.out[i:i + L] += amp * d * np.sin(2 * np.pi * np.cumsum(sweep) / SR)

    def riser(self, st, dur=1.5, amp=0.10):
        i = int(st * SR); L = int(dur * SR)
        if i + L >= self.n: return
        k = np.linspace(0, 1, L)
        self.out[i:i + L] += amp * (k ** 2) * np.sin(2 * np.pi * np.cumsum(np.linspace(180, 900, L)) / SR)

    def ticks(self, a, b, every=0.20, amp=0.045):
        k = 0
        while a + k * every < b:
            i = int((a + k * every) * SR); L = int(0.05 * SR)
            if i + L < self.n:
                d = np.exp(-np.linspace(0, 12, L))
                self.out[i:i + L] += amp * d * np.sin(2 * np.pi * 2400 * np.arange(L) / SR)
            k += 1

    def stand_tick(self, st, amp=0.075, f=880.0):
        """EP-05 addition: the chair-stand metronome tick (one stand = one tick)."""
        i = int(st * SR); L = int(0.09 * SR)
        if i + L >= self.n or i < 0: return
        d = np.exp(-np.linspace(0, 10, L))
        k = np.arange(L) / SR
        self.out[i:i + L] += amp * d * (0.7 * np.sin(2 * np.pi * f * k) + 0.3 * np.sin(2 * np.pi * f * 2.02 * k))

    def sub_drop(self, st, amp=0.22, dur=1.4):
        """EP-05 addition: the reveal sub-drop under a big stat slam."""
        i = int(st * SR); L = min(int(dur * SR), self.n - i - 1)
        if L <= 0: return
        k = np.linspace(0, 1, L)
        f = 120 * np.exp(-3.1 * k) + 26
        d = np.exp(-2.4 * k)
        self.out[i:i + L] += amp * d * np.sin(2 * np.pi * np.cumsum(f) / SR)

    def write(self, path="bed.wav"):
        o = np.tanh(self.out * 1.05) * 0.92
        pk = np.max(np.abs(o)) or 1.0
        o = o / pk * 0.72
        w = wave.open(str(path), "wb")
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((o * 32767).astype("<i2").tobytes())
        w.close()
        print(f"{path}  {self.dur:.2f}s  peak {pk:.3f}")


def rate_at(t, KT, KV):
    """piecewise-linear rate (the film and the bed share the SAME keys)."""
    for i in range(1, len(KT)):
        if t <= KT[i]:
            u = (t - KT[i - 1]) / (KT[i] - KT[i - 1])
            return KV[i - 1] + (KV[i] - KV[i - 1]) * u
    return KV[-1]


def stand_times(a, b, f0=0.86, f1=0.62, acc=6.0):
    """the same clock the film uses: period ramps f0 -> f1 over `acc` seconds."""
    out, st, T = [], a, 0.0
    while st < b:
        T += 0.0
        period = f0 + (f1 - f0) * min(1.0, T / acc)
        st += period
        out.append(st)
        T += period
    return out
