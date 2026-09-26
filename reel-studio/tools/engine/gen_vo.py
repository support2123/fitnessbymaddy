#!/usr/bin/env python3
"""FBM ENGINE · VO generator — the SEALED baseline, parametrised per episode.

Usage:
  python3 gen_vo.py <episode_dir> [seg_id ...]

<episode_dir>/segments.json:
{
  "segments": [
    {"id":"m01","text":"...","stability":0.50,"speed":0.92},
    ...
  ],
  "gaps": {"m01":0.55, "...":0.40},          # silence AFTER each segment (assemble step)
  "lead":0.85, "tail":3.5                      # cover hold / end-card time
}

SEALED BASELINE (Maddy-approved · style=0 always · similarity 0.75 · stability
0.50-0.62 per beat · speed 0.90-0.98 per line · periods/commas only in text ·
Hindi words in Devanagari inline). Do not change without his aadesh.
"""
import os, re, sys, json, pathlib, subprocess, urllib.request, urllib.error

VOICE = "YOUR_ELEVENLABS_VOICE_ID"   # "Maddy" IVC — THE voice, sealed
MODEL = "eleven_multilingual_v2"
CHAIN = ("afftdn=nr=7:nf=-40,equalizer=f=350:t=q:w=1.2:g=-8,equalizer=f=620:t=q:w=1.2:g=-3,"
         "lowshelf=f=125:g=2.5,acompressor=threshold=-25dB:ratio=2:attack=15:release=220:makeup=3,"
         "equalizer=f=1300:t=q:w=1.0:g=1.5,equalizer=f=3100:t=q:w=0.9:g=5.5,highshelf=f=8800:g=3,deesser=i=0.22")
TRIM = ("silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,"
        "silenceremove=start_periods=1:start_silence=0.10:start_threshold=-50dB,areverse")

BANNED = ["\u2014", "\u2013", "...", "\u2026", ";"]
def lint(sid, text):
    for b in BANNED:
        if b in text:
            raise SystemExit(f"TTS LINT FAIL {sid}: banned punctuation {b!r} — periods/commas only")
    if re.search(r"\bunder\b", text, re.I):
        print(f"  WARNING {sid}: contains 'under' — known mishear (heard as 'on the'). Reword if it carries a key fact.")

def key():
    env = pathlib.Path.home() / "fbm-video-studio/OpenMontage/.env"
    if not env.exists():
        raise SystemExit(f"no .env at {env}")
    for ln in env.read_text().splitlines():
        if ln.startswith("ELEVENLABS_API_KEY="):
            return ln.split("=", 1)[1].strip()
    raise SystemExit("no ELEVENLABS_API_KEY in .env")

def main():
    ep = pathlib.Path(sys.argv[1]); only = set(sys.argv[2:])
    cfg = json.load(open(ep / "segments.json"))
    K = key()
    durs = {}
    for s in cfg["segments"]:
        sid = s["id"]
        if only and sid not in only:
            continue
        lint(sid, s["text"])
        raw = ep / f"{sid}.mp3"; out = ep / f"p_{sid}.wav"
        body = json.dumps({
            "text": s["text"], "model_id": MODEL,
            "voice_settings": {
                "stability": s.get("stability", 0.55),
                "similarity_boost": 0.75,
                "style": 0.0,                      # style=0 ALWAYS — sealed
                "use_speaker_boost": True,
                "speed": s.get("speed", 0.94),
            },
        }).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_48000_128",
            data=body, headers={"xi-api-key": K, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw.write_bytes(r.read())
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{sid} FAIL {e.code}: {e.read()[:400]}")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw),
                        "-af", f"{CHAIN},{TRIM}", "-ar", "48000", "-ac", "1", str(out)], check=True)
        pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                             "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True)
        if not pr.stdout.strip():
            raise SystemExit(f"{sid}: ffprobe returned no duration — processed wav bad?")
        d = float(pr.stdout.strip())
        durs[sid] = round(d, 3)
        print(f"{sid}  ok  {d:5.2f}s")
    old = {}
    dj = ep / "durs.json"
    if dj.exists():
        old = json.load(open(dj))
    old.update(durs)
    json.dump(old, open(dj, "w"), indent=1)
    print("durs.json updated ·", len(old), "segments")

if __name__ == "__main__":
    main()

