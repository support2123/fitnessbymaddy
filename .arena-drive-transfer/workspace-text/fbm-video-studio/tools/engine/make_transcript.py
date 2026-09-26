#!/usr/bin/env python3
"""FBM ENGINE · transcript joiner — usage: make_transcript.py <episode_dir>
Joins segments.json text with timeline.json times -> transcript.txt
(the `transcript` arg for the fresh-eyes-audit workflow)."""
import sys, json, pathlib
ep = pathlib.Path(sys.argv[1])
cfg = json.load(open(ep / "segments.json"))
T = json.load(open(ep / "timeline.json"))["seg"]
lines = [f"{T[s['id']][0]:.1f} {s['text']}" for s in cfg["segments"]]
(ep / "transcript.txt").write_text("\n".join(lines))
print("\n".join(lines))

