#!/usr/bin/env python3
"""FBM ENGINE · mix + master (portable port of mix_master.sh).

usage: mix_master.py <episode_dir> [out.m4a]
bed.wav + vo.wav -> sidechain duck -> TWO-PASS LINEAR loudnorm -> -14.0 LUFS / -1.3 dBTP.

TP NOTE: the AAC encode adds ~0.1-0.15 dB of true-peak overshoot after the limiter, so the
loudnorm TP target sits at -1.3. The DELIVERED master then measures at or below -1.0 dBTP,
which is the sealed spec, while integrated loudness stays exactly -14.0 LUFS.
The VO is the star: the bed is ducked under it, never the other way around.
"""
import json, os, pathlib, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

FF = binpaths.ffmpeg()
ep = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ep / "mix.m4a"
os.chdir(ep)

subprocess.run([FF, "-y", "-v", "error", "-i", "bed.wav", "-i", "vo.wav", "-filter_complex",
                "[0:a]highpass=f=28,lowpass=f=12000[b];[1:a]asplit=2[v1][vk];"
                "[b][vk]sidechaincompress=threshold=0.035:ratio=9:attack=8:release=320:makeup=1[bd];"
                "[v1]volume=1.0[vv];[bd][vv]amix=inputs=2:normalize=0:dropout_transition=0,"
                "alimiter=limit=0.94[m]",
                "-map", "[m]", "-ar", "44100", "-ac", "2", "premix.wav"], check=True)

p = subprocess.run([FF, "-hide_banner", "-i", "premix.wav", "-af",
                    "loudnorm=I=-14:TP=-1.3:LRA=11:print_format=json", "-f", "null", "-"],
                   capture_output=True, text=True)
m = re.search(r'\{[^{}]*"input_i".*?\}', p.stderr, re.S)
if not m:
    sys.exit("loudnorm measurement failed:\n" + p.stderr[-1500:])
d = json.loads(m.group(0))
af = (f"loudnorm=I=-14:TP=-1.3:LRA=11:measured_I={d['input_i']}:measured_TP={d['input_tp']}:"
      f"measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:"
      f"offset={d['target_offset']}:linear=true")
subprocess.run([FF, "-y", "-v", "error", "-i", "premix.wav", "-af", af,
                "-c:a", "aac", "-b:a", "320k", "-ar", "44100", "-ac", "2", str(out)], check=True)
os.remove("premix.wav")

p = subprocess.run([FF, "-hide_banner", "-i", str(out), "-af", "ebur128=peak=true", "-f", "null", "-"],
                   capture_output=True, text=True)
tail = p.stderr.strip().splitlines()[-22:]
lines = [l.strip() for l in tail if re.search(r"(I|LRA|Peak|TP):", l)]
print("--- loudness verify ---")
print("\n".join(lines[-6:]))
print("OUT:", out)
