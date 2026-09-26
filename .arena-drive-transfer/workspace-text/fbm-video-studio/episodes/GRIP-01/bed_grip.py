#!/usr/bin/env python3
"""EP-05 · GRIP — the score. ~40-line recipe on bedlib, driven by timeline.json so
every impact lands exactly on a measured beat boundary. ONE CLOCK: the chair-stand
metronome (same closed form the film uses) drives the ticks under the test beats.
Run:  cd episodes/GRIP-01 && PYTHONPATH=<repo>/tools/engine python3 bed_grip.py
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools", "engine"))
from bedlib import Bed, SR  # noqa

T = json.load(open("timeline.json"))
S = {k: v[0] for k, v in T["seg"].items()}
E = {k: v[1] for k, v in T["seg"].items()}
DUR = T["total"]
b = Bed(DUR)


def ip(t, xs, ys):
    if t <= xs[0]: return ys[0]
    if t >= xs[-1]: return ys[-1]
    for i in range(1, len(xs)):
        if t <= xs[i]:
            u = (t - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + (ys[i] - ys[i - 1]) * u
    return ys[-1]


# ---- bed -------------------------------------------------------------------
b.drone(55.0, 0.075)
b.pad([174.61, 220.0, 261.63], 0.024, S["m00"], E["m01"])              # contents: warm F
b.tone(82.41, 0.042, S["m01"], E["m02"], rise=0.9, fall=1.0)           # hook: tension E2
b.riser(S["m02"] - 1.5, 1.5, 0.11)                                     # into the study
b.tone(97.999, 0.040, S["m02"], E["m03"] + 0.4)                        # Lancet seriousness G2
b.heartbeat(S["m02"] + 0.2, E["m02"], period=1.10, amp=0.13)           # dread pulse
b.tone(146.83, 0.026, S["m03"], E["m04"] + 0.4)                        # clinic D3
b.pad([164.81, 196.0, 246.94], 0.024, S["m04"], E["m05"])              # honesty: E minor, open
b.tone(110.0, 0.034, S["m05"], E["m06"] + 0.4)                         # the test: driving A2
b.pad([130.81, 164.81, 196.0], 0.024, S["m07"], E["m08"])              # the fix: C, resolved
b.pad([174.61, 261.63, 349.23], 0.030, S["m08"], DUR)                  # CTA: open chord
for f, a in [(261.63, 0.026), (349.23, 0.017), (523.25, 0.010)]:
    b.tone(f, a, S["m08"], DUR, detune=0.4, rise=1.4, fall=2.6)

# ---- THE ONE CLOCK: chair-stand metronome (same closed form as film_grip.py) --
tick_a = S["m05"] + 2.6
t0 = tick_a; k = 0
while t0 < E["m06"] + 0.2:
    Tn = t0 - tick_a
    if Tn > 42: break
    period = ip(Tn, [0, 6, 12], [0.86, 0.72, 0.62])
    b.stand_tick(t0, amp=0.062 + 0.02 * max(0, 1 - Tn / 12), f=760 + 120 * min(1, Tn / 12))
    k += 1
    Tn = k * period
    t0 = tick_a + Tn
b.ticks(S["m06"], E["m06"], every=0.34, amp=0.030)                     # under the norms ladder

# ---- STORY-BEAT SFX ---------------------------------------------------------
def whoosh(st, dur=0.55, amp=0.055, f0=300, f1=3600):
    i, L = int(st * SR), int(dur * SR)
    if i < 0 or i + L >= b.n: return
    rng = np.random.default_rng(int(st * 1000) % 9999)
    n = rng.normal(0, 1, L)
    k = np.linspace(0, 1, L)
    env = np.sin(np.pi * k) ** 1.6
    # cheap band-sweep: ring-modulate noise with a rising sine
    sw = np.sin(2 * np.pi * np.cumsum(np.linspace(f0, f1, L)) / SR)
    b.out[i:i + L] += amp * env * n * (0.55 + 0.45 * sw)

for st in (S["m02"] - 0.35, S["m03"] - 0.35, S["m05"] - 0.35, S["m07"] - 0.35, S["m08"] - 0.35):
    whoosh(st, 0.5, 0.05)
b.impact(S["m01"] + 0.15, 0.26, 46)                                    # the claim lands
b.riser(S["m02"] + 3.6, 0.75, 0.12)                                    # into the 16% slam
b.sub_drop(S["m02"] + 4.35, 0.30, 1.6); b.impact(S["m02"] + 4.35, 0.16, 40)
b.impact(S["m03"] + 2.5, 0.16, 60)                                     # proxy reveal
b.riser(S["m06"] + 0.1, 0.6, 0.08)
b.impact(S["m06"] + 0.35, 0.22, 52)                                    # the 12 lands
b.riser(S["m07"] + 6.1, 0.6, 0.09)
b.impact(S["m07"] + 6.6, 0.20, 50)                                     # +4 KG
b.sub_drop(S["m08"], 0.20, 1.8); b.impact(S["m08"], 0.18, 44)          # CTA slam

b.write("bed.wav")
print(f"segments: {k} stand ticks · dur {DUR:.2f}s")
