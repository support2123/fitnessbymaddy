#!/usr/bin/env python3
"""FBM ENGINE · audio-only fix = REMUX (never a fresh render).

usage: mux_av.py <video.mp4> <audio.m4a|wav> <out.mp4>
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

v, a, out = sys.argv[1], sys.argv[2], sys.argv[3]
subprocess.run([binpaths.ffmpeg(), "-y", "-v", "error", "-i", v, "-i", a,
                "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out], check=True)
print("muxed:", out, f"{os.path.getsize(out)/1e6:.1f} MB")
