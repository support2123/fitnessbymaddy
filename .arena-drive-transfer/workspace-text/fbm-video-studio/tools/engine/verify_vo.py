#!/usr/bin/env python3
"""FBM ENGINE · VO HARD GATE (portable) — usage: verify_vo.py <episode_dir> [--fast]

MANDATORY before any mix: manifest-driven (a missing p_<id>.wav is a FAIL, never a
silent skip) + whisper dual-model word-overlap + artifact scan (voiced energy
outside word timestamps; runs > 0.30 s = FAIL). Digits are whisper false-negatives —
eye-read the flagged lines. Requires: pip install faster-whisper
"""
import json, os, re, subprocess, sys, unicodedata
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

EP = sys.argv[1]; FAST = "--fast" in sys.argv
os.chdir(EP)
SEG = json.load(open("segments.json"))
LINES = {s["id"]: s["text"] for s in SEG["segments"]}
NUM = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
       "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12",
       "thirteen": "13", "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
       "eighteen": "18", "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40",
       "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90",
       "hundred": "100", "thousand": "1000", "million": "1000000"}


def norm(s):
    s = unicodedata.normalize("NFC", s.lower())
    s = re.sub(r"[^a-z0-9\u0900-\u097f ]", "", s)
    out = []
    for w in s.split():
        if w.isdigit():
            w = str(int(w))                                  # 139,000 -> 139000
        out.append(NUM.get(w, w))
    return out


def pcm(path):
    raw = subprocess.run([binpaths.ffmpeg(), "-v", "error", "-i", path, "-f", "f32le",
                          "-ac", "1", "-ar", "16000", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


try:
    from faster_whisper import WhisperModel
except Exception:
    sys.exit("faster-whisper missing: pip install faster-whisper")

models = [("base", WhisperModel("base", device="cpu", compute_type="int8"))]
if not FAST:
    models.append(("small", WhisperModel("small", device="cpu", compute_type="int8")))

fails, warns, missing = [], [], []
for sid in LINES:
    f = f"p_{sid}.wav"
    if not os.path.exists(f):
        missing.append(sid); continue
    wantL = norm(LINES[sid]); want = set(wantL)
    has_num = any(w.isdigit() for w in wantL)
    best, besttxt, bestwords = -1.0, "", []
    for mname, m in models:
        segs, _ = m.transcribe(f, language="en", word_timestamps=True, beam_size=5)
        segs = list(segs)
        txt = " ".join(s.text for s in segs).strip()
        got = set(norm(txt))
        ov = len(want & got) / max(1, len(want))
        if ov >= best:
            best, besttxt = ov, txt
            bestwords = [(w.start, w.end) for s in segs for w in (s.words or [])]
    a = pcm(f)
    hop, n = 160, len(a) // 160
    rms = np.array([np.sqrt(np.mean(a[i*hop:(i+1)*hop]**2) + 1e-12) for i in range(n)])
    thr = max(rms.max() * 0.06, 0.004)
    voiced = rms > thr
    inword = np.zeros(n, bool)
    for s, e in bestwords:
        inword[max(0, int(s*100) - 8): min(n, int(e*100) + 8)] = True
    orphan = voiced & ~inword
    runs, cur = [], 0
    for v in orphan:
        if v: cur += 1
        else:
            if cur: runs.append(cur / 100)
            cur = 0
    if cur: runs.append(cur / 100)
    worst = max(runs) if runs else 0.0
    flag = ""
    if best < 0.80: flag += " TEXT"
    if worst > 0.30: flag += " ARTIFACT"
    tag = " [EYE-READ: numbers]" if (has_num and best < 0.95) else ""
    print(f"{sid}  overlap {best:5.0%}  orphan {worst:4.2f}s {('FAIL' + flag) if flag else 'ok'}{tag}")
    if flag:
        (fails if (best < 0.65 or worst > 0.45) else warns).append((sid, best, worst, besttxt))

print("\n" + "=" * 60)
if missing:
    print(f"MISSING p_<id>.wav for: {', '.join(missing)}  → run gen_vo_lib.py for these")
for sid, ov, wo, txt in fails + warns:
    print(f"\n{sid}  overlap {ov:.0%}  orphan {wo:.2f}s\n  WANT: {LINES[sid]}\n  HEARD: {txt}")
print("\nRESULT:", "FAIL" if (fails or missing) else ("REVIEW" if warns else "PASS — all segments clean"))
sys.exit(1 if (fails or missing) else 0)
