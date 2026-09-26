#!/usr/bin/env python3
"""FBM ENGINE · VO assembler (portable) — usage: assemble_vo.py <episode_dir>

Reads segments.json (gaps/lead/tail) + durs.json + p_<id>.wav, builds
  vo.wav          full voice track, VO-led placement
  timeline.json   {"seg":{id:[start,end]}, "total":s, "frames":n, "fps":n}
Audio leads, visuals follow: every beat window in the film comes from these
measured numbers, never from estimates.
"""
import json, pathlib, subprocess, sys
sys.path.insert(0, pathlib.Path(__file__).parent)
import binpaths

ep = pathlib.Path(sys.argv[1])
cfg = json.load(open(ep / "segments.json"))
D = json.load(open(ep / "durs.json"))
LEAD = cfg.get("lead", 0.85); TAIL = cfg.get("tail", 3.5)
GAP = cfg.get("gaps", {}); FPS = cfg.get("fps", 30)
ids = [s["id"] for s in cfg["segments"]]
missing = [i for i in ids if i not in D or not (ep / f"p_{i}.wav").exists()]
if missing:
    raise SystemExit(f"missing VO for: {', '.join(missing)} — run gen_vo_lib.py first")

t = LEAD; T = {}; parts = []
for i in ids:
    T[i] = [round(t, 3), round(t + D[i], 3)]
    parts.append((i, round(t, 3)))
    t += D[i] + GAP.get(i, 0.40)
total = t + TAIL
json.dump({"seg": T, "total": round(total, 3), "fps": FPS, "frames": round(total * FPS)},
          open(ep / "timeline.json", "w"), indent=1)

ins, filts = [], []
for n, (i, st) in enumerate(parts):
    ins += ["-i", str(ep / f"p_{i}.wav")]
    filts.append(f"[{n}:a]adelay={int(st*1000)}|{int(st*1000)},apad=whole_dur={total}[a{n}]")
mix = "".join(f"[a{n}]" for n in range(len(parts)))
fc = ";".join(filts) + f";{mix}amix=inputs={len(parts)}:normalize=0:dropout_transition=0[vo]"
subprocess.run([binpaths.ffmpeg(), "-y", "-v", "error"] + ins +
               ["-filter_complex", fc, "-map", "[vo]", "-t", str(total),
                "-ar", "44100", "-ac", "1", str(ep / "vo.wav")], check=True)
print(f"TOTAL {total:.2f}s = {int(total//60)}:{total%60:05.2f} · frames@{FPS} = {round(total*FPS)}")
for i in ids:
    print(f"  {i} {T[i][0]:7.2f} -> {T[i][1]:7.2f}   ({D[i]:5.2f}s)")
