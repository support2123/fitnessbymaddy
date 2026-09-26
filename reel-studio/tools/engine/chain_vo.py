#!/usr/bin/env python3
"""chain_vo.py <ep_dir> <src_dir> [seg_id ...]

Takes externally generated per-segment voice files (any sample rate / channel count —
e.g. the Hindi platform-TTS takes in vo_hi/), runs them through the SAME locked
broadcast chain the scratch voice uses (imported live from gen_vo_scratch.py, so the
two paths can never drift) and writes the files assemble_vo.py expects:

    p_<id>.wav   48 kHz mono, de-rumbled, de-mudded, presence + air, compressed,
                 de-essed, one short room reflection, limited
    durs.json    measured durations, the numbers the whole timeline is built from

FIT (per-beat pacing, added for the Hindi cut):
  Hindi needs roughly 25% more time than English for the same script, so a straight
  read pushes the reel to ~2:20. We speed each beat up ONLY as far as a cap allows
  (default 1.25x, atempo preserves pitch) and never past MIN[id] — the shortest
  duration that beat's on-screen choreography needs (chips hold 6.4 to 7.6 s, stat
  stamps need their beat, the CTA must not rush). Beats already short enough stay
  untouched, which is why the close still breathes.
  Override: --fit-cap 1.2 --no-fit

Usage:  python3 tools/engine/chain_vo.py episodes/WATER-01 vo_hi
"""
import json, os, pathlib, re, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths
from gen_vo_scratch import CHAIN, TRIM          # one chain, two voice sources

# shortest the picture can be without clipping its own choreography (seconds)
MIN = {"m00": 7.3, "m01": 7.6, "m02": 9.5, "m03": 8.4, "m04": 8.9, "m05": 14.8,
       "m06": 9.6, "m07": 12.0, "m08": 8.6, "m09": 8.2}


def dur(path):
    return float(binpaths.probe(str(path)).strip().splitlines()[0])


def main():
    args = [a for a in sys.argv[1:]]
    cap = 1.25
    if "--no-fit" in args:
        cap = 1.0; args.remove("--no-fit")
    if "--fit-cap" in args:
        i = args.index("--fit-cap"); cap = float(args[i + 1]); del args[i:i + 2]
    ep = pathlib.Path(args[0]); src = ep / args[1]; only = set(args[2:])
    cfg = json.load(open(ep / "segments.json"))
    durs = {}
    FF = binpaths.ffmpeg()
    rows = []
    for s in cfg["segments"]:
        sid = s["id"]
        if only and sid not in only:
            continue
        take = src / f"{sid}.wav"
        if not take.exists():
            sys.exit(f"missing take: {take}")
        out = ep / f"p_{sid}.wav"

        # pass 1 · chain + trim only, to measure the real spoken length
        tmp = ep / f"_tmp_{sid}.wav"
        subprocess.run([FF, "-y", "-v", "error", "-i", str(take),
                        "-af", f"{CHAIN},{TRIM}", "-ar", "48000", "-ac", "1", str(tmp)], check=True)
        natural = dur(tmp)

        # pass 2 · how far are we allowed to push this beat?
        floor = MIN.get(sid, 6.0)
        target = max(floor, natural / cap) if cap > 1.0 else natural
        tempo = max(1.0, min(cap, natural / target))
        if tempo > 1.005:
            subprocess.run([FF, "-y", "-v", "error", "-i", str(take),
                            "-af", f"atempo={tempo:.4f},{CHAIN},{TRIM}",
                            "-ar", "48000", "-ac", "1", str(out)], check=True)
        else:
            os.replace(tmp, out); tmp = None
        if tmp and tmp.exists():
            os.remove(tmp)
        d = dur(out)
        durs[sid] = round(d, 3)
        rows.append((sid, natural, tempo, d, floor))
        print(f"{sid}  natural {natural:5.2f}s · tempo x{tempo:4.2f} · final {d:5.2f}s (min {floor:4.1f})")

    json.dump(durs, open(ep / "durs.json", "w"), indent=1)
    G = cfg.get("gaps", {}); overhead = cfg.get("lead", 0.85) + cfg.get("tail", 3.5) \
        + sum(G.get(s["id"], 0.4) for s in cfg["segments"])
    tot = sum(durs.values()) + overhead
    print(f"speech {sum(durs.values()):.2f}s + pacing {overhead:.2f}s = reel {tot:.2f}s "
          f"({int(tot // 60)}:{tot % 60:04.1f})")


if __name__ == "__main__":
    main()
