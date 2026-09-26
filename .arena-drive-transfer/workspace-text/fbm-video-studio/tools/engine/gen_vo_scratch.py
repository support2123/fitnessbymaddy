#!/usr/bin/env python3
"""FBM ENGINE · SCRATCH VO (offline placeholder voice, NOT for delivery).

usage: gen_vo_scratch.py <episode_dir> [seg_id ...]
Renders segments.json with a local neural voice (piper) so the timeline, the film,
the score and the QC chain can be built and proofed BEFORE the real cloned VO is
generated. The delivered reel always carries the ONE cloned voice (Strike 3) —
this file exists so a missing API key never blocks the pipeline.
Needs: pip install piper-tts + a voice under ~/.cache/piper/ (see bootstrap_env.sh)
"""
import json, os, pathlib, subprocess, sys, wave
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

VOICE = os.environ.get("FBM_SCRATCH_VOICE", os.path.expanduser("~/.cache/piper/en_US-ryan-high.onnx"))
# ---- VOICE v2 (2026-09-24) — broadcast-grade placeholder chain -------------
#  de-rumble · two narrow de-mud cuts · body · presence · air · soft-knee comp ·
#  de-ess · ONE short room reflection (a real room, not a plate) · limiter.
#  Same chain shape is applied to the cloned VO by gen_vo_lib.py — so the film is
#  mixed against the same tonal target either way.
CHAIN = ("highpass=f=75,"
         "equalizer=f=250:t=q:w=1.1:g=-3.0,equalizer=f=400:t=q:w=1.2:g=-2.4,"
         "equalizer=f=190:t=q:w=1.0:g=1.2,lowshelf=f=150:g=1.6,"
         "equalizer=f=1500:t=q:w=1.1:g=-1.6,equalizer=f=3200:t=q:w=0.8:g=5.0,"
         "equalizer=f=8500:t=q:w=1.2:g=2.6,highshelf=f=11000:g=3.0,"
         "acompressor=threshold=-19dB:ratio=2.5:attack=10:release=230:makeup=2.2,"
         "deesser=i=0.18,"
         "aecho=0.85:0.9:11:0.055,"
         "alimiter=limit=0.92:attack=5:release=60")
TRIM = ("silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,"
        "silenceremove=start_periods=1:start_silence=0.10:start_threshold=-50dB,areverse")


def main():
    ep = pathlib.Path(sys.argv[1]); only = set(sys.argv[2:])
    if not os.path.exists(VOICE):
        sys.exit(f"scratch voice missing: {VOICE} — run tools/engine/bootstrap_env.sh")
    from piper import PiperVoice
    v = PiperVoice.load(VOICE)
    cfg = json.load(open(ep / "segments.json"))
    durs = json.load(open(ep / "durs.json")) if (ep / "durs.json").exists() else {}
    for s in cfg["segments"]:
        sid = s["id"]
        if only and sid not in only:
            continue
        raw = ep / f"{sid}.scratch.wav"
        cfgp = v.config
        cfgp.length_scale = round(1.0 / float(s.get("speed", 0.94)), 3)
        with wave.open(str(raw), "wb") as w:
            v.synthesize_wav(s["text"], w)
        out = ep / f"p_{sid}.wav"
        subprocess.run([binpaths.ffmpeg(), "-y", "-v", "error", "-i", str(raw), "-af", f"{CHAIN},{TRIM}",
                        "-ar", "44100", "-ac", "1", str(out)], check=True)
        d = float(binpaths.probe(str(out)).strip().splitlines()[0])
        durs[sid] = round(d, 3)
        print(f"{sid}  scratch  {d:5.2f}s")
    json.dump(durs, open(ep / "durs.json", "w"), indent=1)


if __name__ == "__main__":
    main()
