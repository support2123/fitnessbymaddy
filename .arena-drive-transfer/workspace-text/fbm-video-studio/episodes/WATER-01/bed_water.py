#!/usr/bin/env python3
"""EP-06 · WATER — the score. Recipe on bedlib, driven by timeline.json so every
impact lands on a measured beat boundary.

ONE CLOCK: the pulse. The same closed form the film uses (60 bpm -> 69 across the
datum beat, back to 60 after the honesty beat) drives the heartbeat layer here, so
picture and score tick together. The kidney beat gets a water-drip metronome; the
protocol beat gets a rising three-step figure; the CTA resolves to an open F chord.

Run:  cd episodes/WATER-01 && PYTHONPATH=<repo>/tools/engine python3 bed_water.py
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools", "engine"))
from bedlib import Bed, SR  # noqa

T = json.load(open("timeline.json"))
S = {k: v[0] for k, v in T["seg"].items()}
E = {k: v[1] for k, v in T["seg"].items()}
DUR = T["total"]


def ip(t, xs, ys):
    if t <= xs[0]:
        return ys[0]
    if t >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if t <= xs[i]:
            u = (t - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + (ys[i] - ys[i - 1]) * u
    return ys[-1]


b = Bed(DUR)

# ---------------------------------------------------------------- the beds
b.drone(55.0, 0.072)                                                   # deep F, the body's hum
b.pad([174.61, 220.0, 261.63], 0.024, S["m00"], E["m01"])              # contents: warm F
b.tone(82.41, 0.044, S["m01"], E["m02"], rise=0.9, fall=1.0)           # hook: E2 tension
b.pad([164.81, 196.0, 246.94], 0.026, S["m02"], E["m03"])              # the system: E minor
b.tone(97.999, 0.040, S["m03"], E["m04"] + 0.4)                        # the tax: G2 gravity
b.riser(S["m03"] - 1.6, 1.6, 0.115)                                    # into the number
b.pad([146.83, 174.61, 220.0], 0.024, S["m04"], E["m05"])              # honesty: open D minor
b.tone(110.0, 0.038, S["m05"], E["m06"] + 0.4, rise=0.5)               # the lie: A2, tighter
b.tone(130.81, 0.032, S["m06"], E["m07"])                              # the filter: C3 steady
b.pad([130.81, 164.81, 196.0], 0.026, S["m07"], E["m08"])              # protocol: C resolved
b.tone(88.0, 0.030, S["m08"], E["m09"])                                # the receipt: F2, dry
b.pad([174.61, 261.63, 349.23], 0.030, S["m09"], DUR)                  # CTA: open F major
for f, a in [(261.63, 0.026), (349.23, 0.017), (523.25, 0.010)]:
    b.tone(f, a, S["m09"], DUR, detune=0.4, rise=1.4, fall=2.6)

# ---------------------------------------------------------------- ONE CLOCK
def bpm(t):
    a, c, d = S["m03"], E["m03"], E["m04"]
    if t < a:
        return 60.0
    if a <= t <= c:
        return ip(t, [a, c], [60.0, 69.0])
    if c < t <= d:
        return 69.0 - 9.0 * min(1.0, (t - c) / max(0.8, (d - c)))
    return 60.0


t0 = S["m01"] + 1.1
t1 = E["m05"]
step = 4.0
t = t0
while t < t1:
    p = 60.0 / bpm(t + step * 0.5)
    amp = 0.150 if t < S["m03"] else 0.185          # the tax beat hits harder
    b.heartbeat(t, min(t + step, t1), period=p, amp=amp)
    t += step

# ---------------------------------------------------------------- hits
b.impact(S["m01"] + 1.35, 0.20, 46)                 # hook: the 7,500 L stat lands
b.impact(S["m02"] + 2.9, 0.17, 52)                  # the 42 L stat
b.sub_drop(S["m03"] + 0.35, 0.24, 1.5)              # the datum slams
b.impact(S["m03"] + 3.05, 0.22, 40)                 # +3 BPM
b.riser(S["m05"] + 4.0, 1.3, 0.10)                  # into the warning
b.sub_drop(S["m05"] + 4.95, 0.20, 1.3)
b.impact(S["m05"] + 4.95, 0.19, 44)                 # the hyponatraemia line (the danger)
b.impact(S["m06"] + 4.0, 0.18, 56)                  # the 99% return
b.impact(S["m07"] + 4.5, 0.18, 48)                  # 1.4 kg stamp
b.impact(S["m09"], 0.20, 42)                        # CTA slam
b.sub_drop(S["m09"], 0.18, 1.9)

# ---------------------------------------------------------------- textures
b.ticks(S["m06"], E["m06"], every=0.66, amp=0.042)  # the drip metronome
for i, off in enumerate((1.15, 2.30, 3.45)):
    b.stand_tick(S["m07"] + off, amp=0.062, f=740.0 + i * 90)
b.ticks(S["m08"] + 0.6, E["m08"], every=1.0, amp=0.030)

b.write("bed.wav")
print(f"bed.wav written · {DUR:.2f}s")
