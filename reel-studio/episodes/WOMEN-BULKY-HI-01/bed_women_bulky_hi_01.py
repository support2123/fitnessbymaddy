#!/usr/bin/env python3
"""WOMEN-BULKY-01 — restrained, narration-first score recipe.

Every impact follows an actual reveal. The movement section receives a light metronome
texture only; all voice windows are manually ducked later from timeline.json.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools", "engine"))
from bedlib import Bed

T = json.load(open(os.path.join(HERE, "timeline.json")))
S = {key: value[0] for key, value in T["seg"].items()}
E = {key: value[1] for key, value in T["seg"].items()}

bed = Bed(T["total"])
bed.drone(f=55.0, amp=0.052)
bed.pad([146.83, 174.61, 220.0], 0.014, 0.0, T["total"], detune=0.24)
# Question, time-scale proof, research receipt, simple protocol, owned CTA.
bed.impact(S["m01"] + 0.16, 0.12, 46)
bed.riser(max(0.0, S["m02"] - 0.85), 0.85, 0.050)
bed.impact(S["m02"] + 0.28, 0.11, 52)
bed.riser(max(0.0, S["m03"] - 1.05), 1.05, 0.070)
bed.sub_drop(S["m03"] + 0.24, 0.14, 1.1)
bed.impact(S["m03"] + 0.24, 0.13, 40)
bed.ticks(S["m04"] + 0.70, E["m04"] - 0.45, every=0.60, amp=0.018)
bed.riser(max(0.0, S["m05"] - 0.85), 0.85, 0.055)
bed.impact(S["m05"] + 0.10, 0.13, 44)
bed.write("bed.wav")
