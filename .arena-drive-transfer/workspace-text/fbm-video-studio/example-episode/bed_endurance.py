import sys, json, numpy as np
sys.path.insert(0, "/Users/mandeepjakhar/fbm-video-studio/OpenMontage/remotion-composer/tools/engine")
from bedlib import Bed, SR

T = json.load(open("timeline.json"))
S = {k: v[0] for k, v in T["seg"].items()}
DUR = T["total"]
b = Bed(DUR)
b.drone()
# beat sections
b.tone(82.41, 0.045, 0.85, S["m04"] + 0.6)                      # hook tension E2
b.pad([174.61, 220.0, 261.63], 0.026, S["m04"], S["m07"] + 0.4) # engine warmth F
b.tone(97.999, 0.040, S["m07"], S["m09"] + 0.5)                 # study seriousness G2
b.tone(146.83, 0.026, S["m09"], S["m14"] + 0.4)                 # mistake clinical D3
b.tone(110.0, 0.036, S["m14"], S["m18"] + 0.4)                  # myth driving A2
b.pad([130.81, 164.81, 196.0], 0.026, S["m18"], S["m20"] + 0.5) # lifters build C
b.pad([174.61, 261.63, 349.23, 523.25], [0.038, 0.028, 0.018, 0.011][0], S["m20"], DUR)
for f, a in [(261.63, 0.028), (349.23, 0.018), (523.25, 0.011)]:
    b.tone(f, a, S["m20"], DUR, detune=0.4, rise=1.4, fall=2.6)
# THE HEARTBEAT — variable rate 70→50, phase-continuous (the film uses the same keys)
PRE = S["m01"] - 0.85
KT = [0.0, 8.0 + PRE, 30.0 + PRE, 55.0 + PRE, 85.0 + PRE, 108.0 + PRE, 122.3 + PRE, DUR]
KV = [70.0, 70.0, 64.0, 58.0, 54.0, 52.0, 50.0, 50.0]
def rate(t):
    for i in range(1, len(KT)):
        if t <= KT[i]:
            u = (t - KT[i-1]) / (KT[i] - KT[i-1])
            return KV[i-1] + (KV[i] - KV[i-1]) * u
    return KV[-1]
t = 0.40
while t < DUR - 4.2:
    per = 60.0 / rate(t)
    for off, amp in ((0.0, 0.11), (0.28, 0.068)):
        st = t + off
        i = int(st * SR); L = int(0.16 * SR)
        if i + L < b.n:
            d = np.exp(-np.linspace(0, 9, L))
            b.out[i:i+L] += amp * d * np.sin(2 * np.pi * 47 * np.arange(L) / SR)
    t += per
# impacts on beat turns + risers into reveals
for sid, amp, f0 in [("m01",0.30,52),("m04",0.28,46),("m07",0.30,44),("m12",0.26,50),("m14",0.26,46),("m19",0.24,50),("m22",0.30,60)]:
    b.impact(S[sid] + 0.05, amp, f0)
for sid in ["m07", "m12", "m22"]:
    b.riser(S[sid] - 1.45, 1.4, 0.09)
# ticks under the big counters (hook number + study n)
b.ticks(S["m02"], S["m02"] + 3.4)
b.ticks(S["m07"], S["m07"] + 2.6)
b.write("bed.wav")

