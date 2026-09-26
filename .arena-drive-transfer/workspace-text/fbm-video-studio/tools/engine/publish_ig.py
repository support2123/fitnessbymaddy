#!/usr/bin/env python3
"""publish_ig.py <in.mp4> [out.mp4] — FBM/MBMM permanent publish step (portable port).

Strips ALL container metadata + tool tags + x264 SEI so the upload carries zero
AI/C2PA/XMP/tool markers (camera-export-sterile), then verifies. Auto-archives any
previous version (never delete). h264-only guard, because SEI strip is h264-only.
"""
import os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

FF = binpaths.ffmpeg()
IN = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(IN)[0] + "-PUBLISH.mp4"

vc = binpaths.probe(IN, "stream=codec_name", stream=True).strip().splitlines()[0] if binpaths.probe(IN, "stream=codec_name", stream=True) else ""
vc = "".join(ch for ch in vc if ch.isalnum()) or "h264"
if vc != "h264":
    sys.exit(f"FAIL: video codec is {vc} — SEI strip (remove_types=6) is h264-only.")
if os.path.exists(OUT):
    a = os.path.join(os.path.dirname(OUT), f"_archive-{time.strftime('%Y%m%d-%H%M')}-" + os.path.basename(OUT))
    shutil.move(OUT, a)
    print("archived old version ->", a)

subprocess.run([FF, "-y", "-v", "error", "-i", IN, "-map", "0", "-c", "copy",
                "-map_metadata", "-1", "-map_chapters", "-1",
                "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
                "-bsf:v", "filter_units=remove_types=6", "-movflags", "+faststart", OUT], check=True)

print("--- verify: format tags (must be empty) ---")
print(binpaths.probe(OUT, "format_tags") or "(empty)")
print("--- verify: stream tags (must be empty) ---")
print(binpaths.probe(OUT, "stream_tags", stream=True) or "(empty)")
print("--- verify: AI-marker scan in metadata zones ---")
d = open(OUT, "rb").read()
zones = d[:3_000_000] + d[-3_000_000:]
bad = [b"c2pa", b"jumb", b"uuid\xbe{\xcf\x97", b"XMP_", b"x:xmpmeta", b"adobe:ns:meta",
       b"DigitalSourceType", b"trainedAlgorithmicMedia", b"GenAI", b"SynthID",
       b"Lavf", b"Remotion", b"edge-tts", b"ElevenLabs", b"Pillow"]
fail = [m.decode(errors="replace") for m in bad if m in zones]
print("FAIL — markers found:", fail) if fail else print("PASS — sterile, upload-ready")
print("OUT:", OUT, f"({os.path.getsize(OUT)/1e6:.1f} MB)")
sys.exit(1 if fail else 0)
