#!/usr/bin/env python3
"""FBM ENGINE · VO generator (portable port of tools/engine/gen_vo.py).

Usage:
  python3 gen_vo_lib.py <episode_dir> [seg_id ...]        # generate + clean + durs.json

Voice comes from env FBM_VOICE_ID (never hard-coded, never committed) or a local
<episode_dir>/voice.txt fallback. Model = eleven_multilingual_v2, style=0 always —
the sealed baseline. Text lint blocks em-dash / ellipsis / semicolon (audible
hesitation artifacts) and warns on the known "under"/"on the" mishear.
"""
import json, os, pathlib, re, subprocess, sys, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

MODEL = "eleven_multilingual_v2"
# VOICE v2 (2026-09-24) — the same broadcast chain the offline scratch voice uses,
#  so the film is mixed against one tonal target whether the line was cloned or not.
#  Keep CHAINv2 in sync with gen_vo_scratch.py (there is a diff guard in verify_vo.py).
CHAIN = ("afftdn=nr=6:nf=-42," +                           # clone floor: gentle spectral de-noise
         "highpass=f=75,"
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
BANNED = ["\u2014", "\u2013", "...", "\u2026", ";"]


def lint(sid, text):
    for b in BANNED:
        if b in text:
            raise SystemExit(f"TTS LINT FAIL {sid}: banned punctuation {b!r} — periods/commas only")
    if re.search(r"\bunder\b", text, re.I):
        print(f"  WARNING {sid}: contains 'under' — known mishear. Reword if it carries a fact.")
    if re.search(r"\bAI\b", text):
        raise SystemExit(f"TTS LINT FAIL {sid}: the word AI never appears in client-facing text")


def key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if k:
        return k.strip()
    for cand in (pathlib.Path.home() / ".fbm.env", pathlib.Path.home() / "fbm-video-studio/OpenMontage/.env"):
        if cand.exists():
            for ln in cand.read_text().splitlines():
                if ln.startswith("ELEVENLABS_API_KEY="):
                    return ln.split("=", 1)[1].strip()
    raise SystemExit("no ELEVENLABS_API_KEY (env or ~/.fbm.env)")


def voice_id(ep: pathlib.Path):
    v = os.environ.get("FBM_VOICE_ID")
    if v:
        return v.strip()
    f = ep / "voice.txt"
    if f.exists():
        return f.read_text().strip()
    raise SystemExit("no voice id: export FBM_VOICE_ID=... or write <episode_dir>/voice.txt")


def main():
    ep = pathlib.Path(sys.argv[1]); only = set(sys.argv[2:])
    cfg = json.load(open(ep / "segments.json"))
    K, V = key(), voice_id(ep)
    durs = json.load(open(ep / "durs.json")) if (ep / "durs.json").exists() else {}
    for s in cfg["segments"]:
        sid = s["id"]
        if only and sid not in only:
            continue
        out = ep / f"p_{sid}.wav"
        if out.exists() and not only:
            print(f"{sid}  exists  ({out.stat().st_size//1024} kB) — skip (pass the id to force)")
            continue
        lint(sid, s["text"])
        body = json.dumps({
            "text": s["text"], "model_id": MODEL,
            "voice_settings": {
                "stability": s.get("stability", 0.55), "similarity_boost": 0.75,
                "style": 0.0, "use_speaker_boost": True, "speed": s.get("speed", 0.94),
            },
        }).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{V}?output_format=mp3_44100_128",
            data=body, headers={"xi-api-key": K, "Content-Type": "application/json"})
        raw = ep / f"{sid}.mp3"
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                raw.write_bytes(r.read())
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{sid} FAIL {e.code}: {e.read()[:400]}")
        subprocess.run([binpaths.ffmpeg(), "-y", "-v", "error", "-i", str(raw),
                        "-af", f"{CHAIN},{TRIM}", "-ar", "44100", "-ac", "1", str(out)], check=True)
        txt = binpaths.probe(str(out))
        m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", txt)
        if m:
            d = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        else:
            d = float(txt.strip().splitlines()[0]) if txt.strip() else 0.0
        durs[sid] = round(d, 3)
        print(f"{sid}  ok  {d:5.2f}s")
    json.dump(durs, open(ep / "durs.json", "w"), indent=1)
    print("durs.json updated ·", len(durs), "segments")


if __name__ == "__main__":
    main()
