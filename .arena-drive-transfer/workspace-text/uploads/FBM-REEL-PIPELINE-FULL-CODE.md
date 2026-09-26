# FBM REEL PIPELINE — FULL SOURCE (single-file export for AI ingestion)
# 4 shipped episodes · no API keys inside (env-only) · voice id = placeholder

## FILE INDEX
- README.md
- docs/ENGINE-PLAYBOOK.md
- tools/engine/README.md
- tools/engine/segments.example.json
- tools/engine/gen_vo.py
- tools/engine/verify_vo.py
- tools/engine/assemble_vo.py
- tools/engine/bedlib.py
- tools/engine/mix_master.sh
- tools/engine/qc_sweep.sh
- tools/engine/make_transcript.py
- tools/publish_ig.sh
- src/remotion.config.ts
- src/fbm/kit/FbmFilmKit.tsx
- src/fbm/films/CoreSpine.tsx
- src/fbm/films/EnduranceHeart.tsx
- src/fbm/films/Endurance01.tsx
- src/fbm/films/Core01.tsx
- workflows/research-gauntlet.js
- workflows/script-gauntlet.js
- workflows/fresh-eyes-audit.js
- example-episode/segments.json
- example-episode/bed_endurance.py
- example-episode/timeline.json
- docs/dependencies.json
- docs/root-registration-example.txt

---



================================================================================
## FILE: README.md
================================================================================

# FBM REEL PIPELINE — end-to-end science-reel engine (DECODE series)

A complete, battle-tested pipeline that turns a topic into a publish-ready Instagram science reel:
**research → adversarial script QA → voice-clone VO with hard gates → VO-led timeline → synthesized score → 3D+kinetic-type film (Remotion) → QC sweep → independent audit → sterile publish.**
It has shipped 4 episodes (STRENGTH, BREATH, CORE, ENDURANCE) for a 2.1M-follower fitness brand. Every rule in here was paid for by a real failure — treat the constraints as load-bearing.

## Stack
- **Remotion** (React → MP4) + three.js (`@remotion/three`, `@react-three/postprocessing`) — the film
- **ElevenLabs** TTS (voice clone, `eleven_multilingual_v2`) — the narration
- **faster-whisper** (base+small, int8, CPU) — VO verification gates
- **ffmpeg** — audio chains, mixing, loudness, QC, publish
- **numpy** — procedural score synthesis (`bedlib.py`)
- Orchestration: any agent framework; the three `workflows/*.js` files show the exact critic/auditor prompts and schemas.

Env: Node 20+, `npm i` with `docs/dependencies.json`, Python venv with `faster-whisper numpy trimesh`, `ELEVENLABS_API_KEY` in an env file (NEVER in code — this export contains no keys; the voice_id in `gen_vo.py` is a placeholder to replace with your own cloned voice).

## The 9-stage flow (full SOP in docs/ENGINE-PLAYBOOK.md)
1. **RESEARCH** — `workflows/research-gauntlet.js`: 6 parallel angles, every fact carries author+year+journal + a 1-10 hook score. Gate: human approves the research doc before any script.
2. **SCRIPT** — draft short declarative lines, then `workflows/script-gauntlet.js`: 4 adversarial critics (retention · fact-check · TTS-safety · brand). Gate: all CRITICAL findings fixed **before** a single TTS call. This regularly catches things like post-hoc causation claims, homophones that flip a protocol 10×, and misquoted study populations.
3. **VOICE** — `tools/engine/gen_vo.py <ep_dir>`: reads `segments.json` (see `tools/engine/segments.example.json`), lints text (em-dash/ellipsis/semicolon are FORBIDDEN — they cause audible hesitation artifacts; the word "under" is a known ASR mishear), calls ElevenLabs per line (style=0, similarity 0.75, per-line stability 0.50-0.62 and speed 0.90-0.98), then applies the NATSEG ffmpeg clean-up chain + silence trim. Gate: `verify_vo.py` — manifest-driven (a missing segment file FAILS, never silently skips), dual-model whisper word-overlap, and an **artifact scan** (voiced energy outside word timestamps; runs >0.3 s = FAIL). Digits are whisper false-negatives — eye-read the flagged lines.
4. **TIMELINE** — `assemble_vo.py`: concatenates with per-segment gaps → `vo.wav` + `timeline.json`. **Audio leads, visuals follow**: every beat window in the film comes from measured times, never estimates.
5. **SCORE** — `bedlib.py` (Bed class: drone/pad/heartbeat/impact/riser/ticks) in a ~30-line per-episode recipe that READS `timeline.json`, so impacts land on beat boundaries automatically. Then `mix_master.sh`: sidechain-duck the bed under the voice, two-pass LINEAR loudnorm to **-14.0 LUFS / -1.0 dBTP** (verified in output).
6. **FILM** — `src/fbm/kit/FbmFilmKit.tsx` (components with the mistakes designed OUT — see below) + real anatomy (`CoreSpine.tsx`: body shell + articulated spine; `EnduranceHeart.tsx`: lungs + procedural beating heart phase-locked to a bpm curve). `Endurance01.tsx` is the complete reference film. Register in Root (see `docs/root-registration-example.txt`), `durationInFrames` from `timeline.json`. Render needs `--gl=angle` on macOS (in `remotion.config.ts`); GLTF still-frames render black — QC via short video renders.
7. **QC SWEEP** — `qc_sweep.sh final.mp4 out/`: decode check, loudness, AI-marker scan, timestamped contact sheets every 2.5 s. A human (or vision model) must LOOK at every sheet; also spot-check that each spoken number lands on its visual within ±1 s.
8. **FRESH EYES** — `workflows/fresh-eyes-audit.js`: an independent creative-director + compliance auditor score the finished film from the contact sheets (the builder is biased). Fix criticals, re-render, re-sweep.
9. **PUBLISH** — `tools/publish_ig.sh`: strips ALL container metadata + x264 SEI so the file carries zero tool/AI markers (C2PA/XMP/Lavf/Remotion/SynthID scan must print PASS), auto-archives any previous version, h264-only guard.

## Kit components = crystallized failures (FbmFilmKit.tsx)
- `RollCounter` — invisible until its count starts (a premature "0" on screen shipped once; never again)
- `StatStamp` — measured constants LAND at full value with a pop; never tween ("20 ms" on screen while the VO says "thirty" is a bug class)
- `ItalicClaim` — key claims carry their own scrim (a headline number was once illegible over bright 3D)
- `CTABlock` — the comment ask visually DOMINATES the funnel pill, with a priming question line; one voiced CTA only
- `ContentsCard` — opening "WHAT WE COVER" menu; the VO SPEAKS the chapter list and each row cascades in at its spoken timestamp (`itemAts` measured via whisper word-timestamps); render it as the TOP layer and gate the first beat's overlays until it dissolves
- `coldOpenT` — frame zero shows the film's best moment (motion payoff in the first seconds; a bare title card is a scroll-past)
- `CredThird` — credential lower-third with a reserved collision-free zone
- Layout law: headline bottom-left (bottom:400), citation chip bottom:330, chapter tag top:46, live stat widget top-right; nothing critical in the bottom ~330 px (platform UI) — and **a translucent human body must fill the frame** (an isolated organ/bone reads cold and was rejected by the operator).

## One-clock principle
Whatever the episode's living signal is (breath rate, heart rate), ONE phase-integrated clock drives the 3D organ, the on-screen counter, the ECG/trace, and the score's pulse — and its final value lands exactly on the CTA line (`beatPhaseVar` in `EnduranceHeart.tsx` handles a changing rate without phase jumps).

## Per-episode run (condensed)
```bash
EP=vo/MY-EPISODE && mkdir -p $EP        # 1-2: research + script via workflows
cp tools/engine/segments.example.json $EP/segments.json   # write your lines
python3 tools/engine/gen_vo.py $EP
<venv>/python tools/engine/verify_vo.py $EP               # must PASS
python3 tools/engine/assemble_vo.py $EP
cd $EP && PYTHONPATH=../../tools/engine <venv>/python bed_myepisode.py && cd -
zsh tools/engine/mix_master.sh $EP && cp $EP/mix.m4a public/…/ep.m4a
# build <Ep>.tsx from Endurance01.tsx pattern, windows = timeline.json
npx remotion render src/index.tsx FBM-EP out.mp4 --concurrency=4
zsh tools/engine/qc_sweep.sh out.mp4 qc/                  # look at every sheet
# fresh-eyes workflow → fix → re-render
zsh tools/publish_ig.sh out.mp4 FINAL.mp4                 # sterile PASS required
```

## Hard rules that are easy to lose
1. English only, secular, science-cited on screen (author+year on every stat), honest bounding of thin evidence ("39 people. A signal, not a promise.") — this honesty chip out-performs hype.
2. One consistent cloned voice; emotion via sentence craft + subtle per-line settings, never voice-splicing (splicing = instant AI-feel).
3. Audio-only fixes = REMUX over the last render (`-map 0:v -c:v copy`), never a fresh render.
4. Comment trigger = a literal answer the viewer can type without translating (a number they already own: "4, 6 or 8", "your resting heart rate").
5. The word "AI" never appears in any client-facing text; the publish gate enforces zero tool metadata.



================================================================================
## FILE: docs/ENGINE-PLAYBOOK.md
================================================================================

# FBM VIRAL VIDEO ENGINE — THE PLAYBOOK
## DECODE series ka poora production system · 9 strikes, har strike = TOOL + RULE + GATE
*Built 2026-09-20 from EP-01 (STRENGTH) + EP-02 (BREATH) + EP-03 (CORE) ke saare sealed lessons. Ye file = episode banane ka single source of truth.*

**Studio:** `~/fbm-video-studio/OpenMontage/remotion-composer/`
**Engine tools:** `tools/engine/` · **Component kit:** `src/fbm/kit/FbmFilmKit.tsx` · **Anatomy:** `src/fbm/films/mbmm/CoreSpine.tsx` (BodyShell + SpineColumn + canister) + `public/fbm/mbmm/*.glb`
**Episode home:** `06-Content/instagram/<TOPIC>-01/` (research, script, caption, audit). **VO working dir:** `remotion-composer/vo/<TOPIC>/` — segments.json yahin banta hai (template: `tools/engine/segments.example.json`, schema: gen_vo.py docstring).
**Series map:** STRENGTH-01 = EP-01 · BREATH = EP-02 · CORE-01 = EP-03. Finals: `FBM MACHINE/05-Videos/reels-final/` (naye ep se pehle pichhli 2 finals ke frames kholo).
**Whisper/numpy tools ka interpreter:** `~/fbm-video-studio/OpenMontage/.venv/bin/python` (system python3 me faster_whisper NAHI hai).

---

## STRIKE 1 · RESEARCH
- **Tool:** saved workflow **`research-gauntlet`** — `Workflow({name:'research-gauntlet', args:{topic:"..."}})` — 6 parallel cited-facts agents (FACTS schema: fact + source + hook_potential 1-10 + best_one_liner per angle).
- **Rule:** har fact ke saath source (author + year + journal). Topic ke 6 angles: anatomy · protection/stakes · importance/performance · mistakes · why-people-skip/myths · history.
- **Gate:** RESEARCH-THINKING.md banao → **Maddy approve kare, tabhi script**. Uski apni recordings me topic pe kuch bola ho to quote karo — script ka spine wahi banta hai.

## STRIKE 2 · SCRIPT
- **Tool:** saved workflow **`script-gauntlet`** — `Workflow({name:'script-gauntlet', args:{script, research}})` — 4 critics (retention · facts · TTS-safety · brand).
- **Rule:** hook = NUMBER pehle, setup baad me. 2 signposts max. Ek fact ek hi baar. CTA me EK ask. Evidence patli ho to bound karo ("39 people, a signal not a promise"). TTS text: periods/commas ONLY, no "under", short sentences, numbers spelled for cadence.
- **Gate:** saare CRITICAL findings fix, THEN VO. (EP-03 me isi ne "so they deleted it" jaisa dunkable claim pakda tha.)

## STRIKE 3 · VOICE (sealed baseline)
- **Tool:** `tools/engine/gen_vo.py <ep_dir>` — segments.json → generate + NATSEG chain + trim + durs.json. Voice `YOUR_ELEVENLABS_VOICE_ID` · multilingual_v2 · style=0 · sim 0.75 · stability 0.50-0.62/beat · speed 0.90-0.98/line.
- **Rule:** EK consistent voice. Emotion sirf sentence-craft + subtle settings se. Hindi words Devanagari inline. Audio-only change = REMUX, kabhi fresh render nahi.
- **Gate:** `~/fbm-video-studio/OpenMontage/.venv/bin/python tools/engine/verify_vo.py <ep_dir>` — manifest-driven (har segment ki p_<id>.wav zaroori, missing = FAIL) + whisper dual-model overlap + **artifact-scan (>0.3s orphan = FAIL)**. Ye gate skip karna = 1/10 voice ship karna (ho chuka hai). `[EYE-READ: numbers]` tag wali lines aankh se padho.
- **Audio-fix loop (ek line badli to):** `gen_vo.py <ep> m07` → verify_vo → assemble_vo → bed (agar total badla) → mix_master → **REMUX**: `ffmpeg -y -i film.mp4 -i <ep>/mix.m4a -map 0:v -map 1:a -c:v copy -c:a copy out.mp4` → qc_sweep + publish_ig. Fresh render kabhi nahi.

## STRIKE 4 · TIMELINE (VO-led)
- **Tool:** `tools/engine/assemble_vo.py <ep_dir>` — gaps ke saath vo.wav + timeline.json.
- **Rule:** audio pehle, visuals follow. Beat windows timeline.json ke measured times se, andaaze se nahi. Gaps: beat-change 0.70-0.75s, andar 0.30-0.45s, hook ke baad 0.50-0.55s.
- **Gate:** total 1:45-2:00 zone me (research film); 110s+ speech hai to script trim karo, gaps nahi.

## STRIKE 5 · SOUND
- **Tool:** `tools/engine/bedlib.py` — Bed class (drone/pad/heartbeat/impact/riser/ticks) → ~30-line episode recipe. Phir `tools/engine/mix_master.sh <ep_dir>` — sidechain duck + two-pass LINEAR loudnorm.
- **Run:** recipe file `<ep_dir>/bed_<topic>.py` me; `Bed(dur)` = timeline.json ka `total`; chalao: `cd <ep_dir> && PYTHONPATH=<remotion-composer>/tools/engine ~/fbm-video-studio/OpenMontage/.venv/bin/python bed_<topic>.py` (bed.wav CWD me girta hai, mix_master use wahi chahiye).
- **Rule:** VO star hai. Impacts story-beats pe (buckle, stamp, reveal), risers reveals se 1.5s pehle, ticks sirf counters ke neeche.
- **Gate:** verify me **-14.0 LUFS integrated, TP ≤ -1.0** print hona chahiye.

## STRIKE 6 · FILM (visuals)
- **Tool:** `src/fbm/kit/FbmFilmKit.tsx` — Head/Cite/Chapter/Kicker/RollCounter/StatStamp/MythStrike/RubberStamp/BarPair/HonestyChip/ItalicClaim/CTABlock/CredThird/coldOpenT. 3D: CoreSpine.tsx (BodyShell mandatory).
- **Rules (layout law — todna mana hai):**
  1. **Human body shell har film me** — akela organ/bone reject hota hai (EP-03 v1 isi pe reject hua). Do-act pattern best: structure akela → body uske around materialise.
  2. Headline **bottom-left 400** · citation 330 · chapter top 46 · IG bottom ~330px + top-left username zone khaali.
  3. **Cold open + contents:** `coldOpenT()` backdrop (film ka best gold moment) ke upar **`ContentsCard`** 0-4s — "WHAT WE COVER" + numbered chapters cascade (Maddy standing format, 2026-09-21). Card TOP layer pe render karo (JSX me last), hook overlays `t >= 3.95` se gate karo, VO neeche chalta rahe. Card dissolve hote hi pehla stat-slam lande.
  4. Counters: accumulating totals = `RollCounter` (t0 se pehle INVISIBLE) · measured constants = `StatStamp` (kabhi count-up nahi — "20 ms" jabki VO "30" bole = bug class).
  5. Key claims bright 3D pe = `ItalicClaim` (built-in scrim). Section kickers hamesha gold (`Kicker`).
  6. Colour story: cool neutral · RED danger/crush · GOLD resolve/hero · cyan science accents. Red sirf myth-strikes + danger.
  7. Camera narrate kare — data beats pe naya angle/push, 70s locked-off frontal nahi.
  8. Har stat ka on-screen citation (`Cite`). NASM credential opening lower-third (`CredThird` — uske reserve zone x<650 y230-360 me kuch aur nahi).
- **FILM WIRING:** (a) `cp <ep_dir>/mix.m4a public/fbm/mbmm/<topic>.m4a`; (b) nayi film `src/fbm/films/mbmm/<Topic>01.tsx` — Core01.tsx ka pattern copy karo, `const B = {...}` beat windows timeline.json ke `seg` times se; (c) `src/Root.tsx` me register: `<Composition id="FBM-<TOPIC>-01" durationInFrames={timeline.frames} defaultProps={{mix:"fbm/mbmm/<topic>.m4a"}} .../>`; (d) render: `npx remotion render src/index.tsx FBM-<TOPIC>-01 out.mp4 --concurrency=4` (remotion-composer se).
- **Gate:** `--gl=angle` baked in remotion.config.ts. GLTF stills BLACK render hote hain — QC hamesha short VIDEO render se. Render errors pe full log padho (tail-2 ne pehle error chhupaya tha).

## STRIKE 7 · QC SWEEP
- **Tool:** `tools/engine/qc_sweep.sh <final.mp4> <out_dir>` — decode + specs + LUFS + sterile-scan + timestamped contact sheets (har 2.5s).
- **Rule:** HAR sheet aankh se dekho. Sync spot-check: bola hua number apne visual pe ±1s me land kare. Marker scan me sirf `Lavf/Remotion` dikhe to wo pre-publish EXPECTED hai (publish_ig strip karta hai); asli FAIL = C2PA/XMP/SynthID/ElevenLabs class.
- **Gate:** koi collision/illegible/premature-counter mila to fix + re-render. Delivery se pehle sheet-pass zaroori.

## STRIKE 8 · FRESH EYES
- **Tool:** saved workflow **`fresh-eyes-audit`** — `Workflow({name:'fresh-eyes-audit', args:{video, sheets_dir, transcript}})`. `transcript` banane ke liye: `python3 tools/engine/make_transcript.py <ep_dir>` (segments.json + timeline.json jodta hai).
- **Rule:** SHIP WITH TWEAKS aaye to tweaks list Maddy ko dikhाओ scores ke saath — chhupाओ mat (satya rule).
- **Gate:** dono auditors ke CRITICAL/broken findings fix hone ke baad hi final.

## STRIKE 9 · SHIP
- **Tool:** `tools/publish_ig.sh <in> <out>` — metadata strip + sterile verify. Cover = **fbm-cover-designer** agent (imagery-led, human figure, series masthead DECODE · EP NN). Caption = **fbm-caption-writer** agent (story, never summary; "AI" shabd kabhi nahi).
- **Rule:** comment-trigger = literal type-able answer ("COMMENT 4, 6 OR 8") + question line ("HOW MANY DID YOU GET?"). Comment ask visually dominant, funnel pill quiet secondary. Seed comments + pinned-reply template caption file me.
- **Gate:** publish_ig PASS ke bina koi file reels-final me nahi jaati. Purane versions archive (`_archive-*`), delete kabhi nahi (Vrat 6).

---

## EPISODE CHECKLIST (print-and-run)
```
[ ] 1  Research workflow → RESEARCH-THINKING.md → Maddy YES
[ ] 2  Script draft → script-gauntlet → criticals fixed → SCRIPT-FINAL.md
[ ] 3  segments.json → gen_vo.py → verify_vo.py PASS (artifact 0)
[ ] 4  assemble_vo.py → timeline.json → beat windows film me
[ ] 5  bed recipe → mix_master.sh → -14.0 LUFS verified
[ ] 6  Film: kit components + BodyShell + cold-open + camera moves
[ ] 7  qc_sweep.sh → har sheet dekhi → sync spot-checks
[ ] 8  fresh-eyes-audit → criticals fixed → (re-sweep if re-rendered)
[ ] 9  publish_ig PASS → reels-final → cover agent → caption agent → deliver
```

**Level target:** har episode pichhle se ek cheez me upar (L10 standing rule). Naya episode shuru karne se PEHLE pichhli 2 shipped films ke frames kholo — grammar match karo, phir naya idea upar rakho.



================================================================================
## FILE: tools/engine/README.md
================================================================================

# FBM ENGINE tools — ek episode ka flow
Episode dir kahin bhi bana sakte ho (scratchpad best). Order:
  1. cp segments.example.json <ep>/segments.json   # apni lines daalo
  2. python3 gen_vo.py <ep>                        # generate + NATSEG + durs.json
  3. <venv>/python verify_vo.py <ep>               # HARD GATE (whisper + artifact)
  4. python3 assemble_vo.py <ep>                   # vo.wav + timeline.json
  5. bed recipe (bedlib.Bed) -> <ep>/bed.wav
  6. zsh mix_master.sh <ep> <ep>/mix.m4a           # -14 LUFS two-pass
  7. mix.m4a -> remotion public/, film me windows = timeline.json se
  8. render -> zsh qc_sweep.sh final.mp4 qc_out/   # sheets AANKH se dekho
  9. Workflow fresh-eyes-audit -> fixes -> zsh ../publish_ig.sh
Poora SOP: "FBM MACHINE/05-Videos/ENGINE-PLAYBOOK.md"
venv (whisper/numpy): ~/fbm-video-studio/OpenMontage/.venv/bin/python



================================================================================
## FILE: tools/engine/segments.example.json
================================================================================

```json
{
  "segments": [
    {"id": "m01", "text": "Two kilograms. That is all it takes to make a bare human spine buckle.", "stability": 0.50, "speed": 0.92},
    {"id": "m02", "text": "Strip the muscles away, and a two litre bottle folds this column in half.", "stability": 0.50, "speed": 0.93}
  ],
  "gaps": {"m01": 0.55, "m02": 0.75},
  "lead": 0.85,
  "tail": 3.5
}

```


================================================================================
## FILE: tools/engine/gen_vo.py
================================================================================

```python
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
            f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128",
            data=body, headers={"xi-api-key": K, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw.write_bytes(r.read())
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{sid} FAIL {e.code}: {e.read()[:400]}")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw),
                        "-af", f"{CHAIN},{TRIM}", "-ar", "44100", "-ac", "1", str(out)], check=True)
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

```


================================================================================
## FILE: tools/engine/verify_vo.py
================================================================================

```python
#!/Users/mandeepjakhar/fbm-video-studio/OpenMontage/.venv/bin/python
"""FBM ENGINE · VO HARD GATE — usage:
  ~/fbm-video-studio/OpenMontage/.venv/bin/python verify_vo.py <episode_dir>

MANDATORY before any mix (skipping this shipped a 1/10 voice once).
Manifest-driven: every segment in segments.json MUST have p_<id>.wav — a missing
file is a FAIL, never a silent skip. Gates per segment:
  (1) whisper dual-model word-overlap vs the intended text (Devanagari kept,
      digits/number-words normalised; low-score digit lines get an EYE-READ tag)
  (2) artifact scan — voiced energy outside word timestamps; runs > 0.30 s = FAIL
"""
import json, re, sys, os, subprocess, unicodedata
import numpy as np
from faster_whisper import WhisperModel

EP = sys.argv[1] if len(sys.argv) > 1 else "."
os.chdir(EP)
SEG = json.load(open("segments.json"))
LINES = {s["id"]: s["text"] for s in SEG["segments"]}

NUM = {"zero":"0","one":"1","two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7",
       "eight":"8","nine":"9","ten":"10","eleven":"11","twelve":"12","fifteen":"15","twenty":"20",
       "thirty":"30","forty":"40","fifty":"50","sixty":"60","seventy":"70","eighty":"80","ninety":"90",
       "hundred":"100","thousand":"1000"}
def norm(s):
    s = unicodedata.normalize("NFC", s.lower())
    s = re.sub(r"[^a-z0-9ऀ-ॿ ]", "", s)
    return [NUM.get(w, w) for w in s.split()]

models = [("base", WhisperModel("base", device="cpu", compute_type="int8")),
          ("small", WhisperModel("small", device="cpu", compute_type="int8"))]

def pcm(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

fails, warns, missing = [], [], []
for sid in LINES:
    f = f"p_{sid}.wav"
    if not os.path.exists(f):
        missing.append(sid)
        continue
    wantL = norm(LINES[sid]); want = set(wantL)
    has_dev = any("ऀ" <= ch <= "ॿ" for ch in LINES[sid])
    has_num = any(w.isdigit() for w in wantL)
    best, besttxt, bestwords = -1.0, "", []
    for mname, m in models:
        segs, _ = m.transcribe(f, language=None if has_dev else "en", word_timestamps=True, beam_size=5)
        segs = list(segs)
        txt = " ".join(s.text for s in segs).strip()
        got = set(norm(txt))
        ov = len(want & got) / max(1, len(want))
        if ov >= best:                       # >= so bestwords is captured even at 0
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
    print(f"MISSING p_<id>.wav for: {', '.join(missing)}  → run gen_vo.py for these")
for sid, ov, wo, txt in fails + warns:
    print(f"\n{sid}  overlap {ov:.0%}  orphan {wo:.2f}s\n  WANT: {LINES[sid]}\n  HEARD: {txt}")
print("\nRESULT:", "FAIL" if (fails or missing) else ("REVIEW" if warns else "PASS — all segments clean"))
sys.exit(1 if (fails or missing) else 0)

```


================================================================================
## FILE: tools/engine/assemble_vo.py
================================================================================

```python
#!/usr/bin/env python3
"""FBM ENGINE · VO assembler — usage: assemble_vo.py <episode_dir>

Reads segments.json (gaps/lead/tail) + durs.json + p_<id>.wav, builds:
  vo.wav          — full voice track, VO-led placement
  timeline.json   — {"seg":{id:[start,end]}, "total":s, "frames":n}
The film's beat windows come from timeline.json — audio leads, visuals follow."""
import sys, json, pathlib, subprocess

ep = pathlib.Path(sys.argv[1])
cfg = json.load(open(ep / "segments.json"))
D = json.load(open(ep / "durs.json"))
LEAD = cfg.get("lead", 0.85); TAIL = cfg.get("tail", 3.5)
GAP = cfg.get("gaps", {})
ids = [s["id"] for s in cfg["segments"]]
FPS = cfg.get("fps", 30)
missing = [i for i in ids if i not in D]
if missing:
    raise SystemExit(f"durs.json missing: {', '.join(missing)} — run gen_vo.py for these first")

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
subprocess.run(["ffmpeg", "-y", "-v", "error"] + ins +
               ["-filter_complex", fc, "-map", "[vo]", "-t", str(total),
                "-ar", "44100", "-ac", "1", str(ep / "vo.wav")], check=True)
print(f"TOTAL {total:.2f}s = {int(total//60)}:{total%60:05.2f} · frames@{FPS} = {round(total*FPS)}")
for i in ids: print(f"  {i} {T[i][0]:7.2f} -> {T[i][1]:7.2f}")

```


================================================================================
## FILE: tools/engine/bedlib.py
================================================================================

```python
#!/usr/bin/env python3
"""FBM ENGINE · bed synthesis library. Each episode writes a ~30-line recipe:

    from bedlib import Bed
    b = Bed(116.33)
    b.drone()                                   # foundation, whole film
    b.tone(82.41, 0.045, 0.85, 13.6)            # section colour (freq, amp, a, b)
    b.pad([174.61, 220.0, 261.63], 0.028, 13.4, 33.2)   # chord pad
    b.heartbeat(1.2, 13.0)                      # tension pulse
    b.impact(6.45, 0.34, 46)                    # hits on story beats
    b.riser(8.6, 1.6, 0.10)                     # into reveals
    b.ticks(35.0, 38.4)                         # under data counters
    b.write("bed.wav")

The voice is the star — keep amps at these scales."""
import numpy as np, wave

SR = 44100

class Bed:
    def __init__(self, dur):
        self.dur = dur
        self.n = int(SR * dur)
        self.t = np.arange(self.n) / SR
        self.out = np.zeros(self.n)

    def _env(self, a, b, rise=0.8, fall=1.2):
        e = np.zeros(self.n)
        i0, i1 = int(a * SR), int(min(b, self.dur) * SR)
        e[i0:i1] = 1.0
        r, f = int(rise * SR), int(fall * SR)
        w = max(1, i1 - i0)
        r = max(1, min(r, w)); f = max(1, min(f, w))   # ramps stay inside the window
        if i0 + r <= self.n: e[i0:i0 + r] = np.linspace(0, 1, r)
        e[i1 - f:i1] = np.minimum(e[i1 - f:i1], np.linspace(1, 0, f))
        return e

    def tone(self, f, amp, a, b, detune=0.0, rise=0.8, fall=1.2):
        e = self._env(a, b, rise, fall)
        s = np.sin(2 * np.pi * f * self.t)
        if detune:
            s = 0.5 * s + 0.5 * np.sin(2 * np.pi * (f + detune) * self.t)
        self.out += amp * s * e

    def pad(self, freqs, amp, a, b, detune=0.35):
        for f in freqs:
            self.tone(f, amp, a, b, detune=detune, rise=1.5, fall=1.5)

    def drone(self, f=55.0, amp=0.085):
        lfo = 0.80 + 0.20 * np.sin(2 * np.pi * 0.055 * self.t)
        self.out += amp * np.sin(2 * np.pi * f * self.t) * self._env(0, self.dur, 2, 3) * lfo
        self.out += amp * 0.35 * np.sin(2 * np.pi * f * 2 * self.t) * self._env(0, self.dur, 2, 3) * lfo

    def heartbeat(self, a, b, period=1.15, amp=0.16):
        k = 0
        while a + k * period < b:
            for off, g in ((0.0, amp), (0.30, amp * 0.62)):
                st = a + k * period + off
                i = int(st * SR); L = int(0.18 * SR)
                if i + L >= self.n: break
                d = np.exp(-np.linspace(0, 9, L))
                self.out[i:i + L] += g * d * np.sin(2 * np.pi * 48 * np.arange(L) / SR)
            k += 1

    def impact(self, st, amp=0.30, f0=48):
        i = int(st * SR); L = min(int(1.1 * SR), self.n - i - 1)
        if L <= 0: return
        d = np.exp(-np.linspace(0, 6.5, L))
        sweep = np.linspace(f0, f0 * 0.55, L)
        self.out[i:i + L] += amp * d * np.sin(2 * np.pi * np.cumsum(sweep) / SR)

    def riser(self, st, dur=1.5, amp=0.10):
        i = int(st * SR); L = int(dur * SR)
        if i + L >= self.n: return
        k = np.linspace(0, 1, L)
        self.out[i:i + L] += amp * (k ** 2) * np.sin(2 * np.pi * np.cumsum(np.linspace(180, 900, L)) / SR)

    def ticks(self, a, b, every=0.20, amp=0.045):
        k = 0
        while a + k * every < b:
            i = int((a + k * every) * SR); L = int(0.05 * SR)
            if i + L < self.n:
                d = np.exp(-np.linspace(0, 12, L))
                self.out[i:i + L] += amp * d * np.sin(2 * np.pi * 2400 * np.arange(L) / SR)
            k += 1

    def write(self, path="bed.wav"):
        o = np.tanh(self.out * 1.05) * 0.92
        pk = np.max(np.abs(o)) or 1.0
        o = o / pk * 0.72
        w = wave.open(str(path), "wb")
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((o * 32767).astype("<i2").tobytes())
        w.close()
        print(f"{path}  {self.dur:.2f}s  peak {pk:.3f}")

```


================================================================================
## FILE: tools/engine/mix_master.sh
================================================================================

```bash
#!/bin/zsh
# FBM ENGINE · mix + master — usage: mix_master.sh <episode_dir> [out.m4a]
# bed.wav + vo.wav -> sidechain duck -> TWO-PASS LINEAR loudnorm to -14.0 LUFS / -1.0 TP.
set -e
EP="$(cd "$1" && pwd)"
OUT="${2:-$EP/mix.m4a}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac
cd "$EP"
ffmpeg -y -v error -i bed.wav -i vo.wav -filter_complex \
"[0:a]highpass=f=28,lowpass=f=12000[b];[1:a]asplit=2[v1][vk];\
[b][vk]sidechaincompress=threshold=0.035:ratio=9:attack=8:release=320:makeup=1[bd];\
[v1]volume=1.0[vv];[bd][vv]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.94[m]" \
 -map "[m]" -ar 44100 -ac 2 premix.wav
ffmpeg -hide_banner -i premix.wav -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null - 2>ln.txt
python3 - "$OUT" <<'PYEOF'
import json, re, subprocess, sys
d = json.loads(re.search(r'\{[^{}]*"input_i".*?\}', open('ln.txt').read(), re.S).group(0))
af = (f"loudnorm=I=-14:TP=-1.0:LRA=11:measured_I={d['input_i']}:measured_TP={d['input_tp']}:"
      f"measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:"
      f"offset={d['target_offset']}:linear=true")
subprocess.run(["ffmpeg","-y","-v","error","-i","premix.wav","-af",af,
                "-c:a","aac","-b:a","320k","-ar","44100","-ac","2",sys.argv[1]],check=True)
PYEOF
echo "--- verify ---"
ffmpeg -hide_banner -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -A2 "Integrated loudness" | head -3
rm -f premix.wav ln.txt
echo "OUT: $OUT"

```


================================================================================
## FILE: tools/engine/qc_sweep.sh
================================================================================

```bash
#!/bin/zsh
# FBM ENGINE · QC sweep — usage: qc_sweep.sh <final.mp4> <out_dir>
# One command = decode check + specs + loudness + AI-marker scan + timestamped
# contact sheets (frame every 2.5 s, 10-up). Look at EVERY sheet before delivery.
set -e
IN="$1"; OD="${2:-qc_out}"; mkdir -p "$OD"
echo "=== SPECS ==="
ffprobe -v error -show_entries format=duration,bit_rate -show_entries stream=codec_name,width,height,r_frame_rate -of default=nw=1 "$IN"
echo "=== DECODE (khaali = clean) ==="
ffmpeg -v error -i "$IN" -f null - 2>&1 | head -5
echo "=== LOUDNESS ==="
ffmpeg -hide_banner -i "$IN" -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -3
echo "=== AI-MARKER SCAN ==="
python3 - "$IN" <<'EOF'
import sys
d=open(sys.argv[1],'rb').read(); z=d[:3_000_000]+d[-3_000_000:]
bad=[b'c2pa',b'jumb',b'XMP_',b'x:xmpmeta',b'DigitalSourceType',b'trainedAlgorithmicMedia',b'GenAI',b'SynthID',b'ElevenLabs']
tool=[b'Lavf',b'Remotion']
f=[m.decode(errors='replace') for m in bad if m in z]
t=[m.decode(errors='replace') for m in tool if m in z]
if f: print("FAIL:",f)
elif t: print("tool tags present (Lavf/Remotion) — EXPECTED pre-publish; publish_ig.sh strips them. Sterile gate = Strike 9.")
else: print("PASS — sterile")
EOF
echo "=== CONTACT SHEETS ==="
ffmpeg -y -v error -i "$IN" -vf "fps=0.4,scale=270:480" -start_number 0 "$OD/fr_%03d.png"
python3 - "$OD" <<'EOF'
import subprocess, glob, sys, os, re, shutil
od=sys.argv[1]; fr=sorted(glob.glob(os.path.join(od,'fr_*.png')))
for s in range((len(fr)+9)//10):
    chunk=fr[s*10:(s+1)*10]
    if len(chunk)==1:
        shutil.copy(chunk[0], os.path.join(od,f'sheet{s}.png')); continue
    ins=[]; fc=[]
    for i,f in enumerate(chunk):
        t=int(re.search(r'fr_(\d+)',os.path.basename(f)).group(1))*2.5
        ins+=['-i',f]
        fc.append(f"[{i}]drawtext=text='{t:.0f}s':x=8:y=8:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.6[v{i}]")
    fc.append(''.join(f"[v{i}]" for i in range(len(chunk)))+f"hstack=inputs={len(chunk)}[o]")
    subprocess.run(['ffmpeg','-y','-v','error']+ins+['-filter_complex',';'.join(fc),'-map','[o]',os.path.join(od,f'sheet{s}.png')],check=True)
print("sheets:",len(glob.glob(os.path.join(od,'sheet*.png'))))
EOF
echo "DONE — ab har sheet ko AANKH se dekho: $OD/sheet*.png"

```


================================================================================
## FILE: tools/engine/make_transcript.py
================================================================================

```python
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

```


================================================================================
## FILE: tools/publish_ig.sh
================================================================================

```bash
#!/bin/zsh
# publish_ig.sh <in.mp4> [out.mp4] — FBM/MBMM permanent publish step.
# Strips ALL container metadata + tool tags + x264 SEI so the upload carries
# zero AI/C2PA/XMP/tool markers (camera-export-sterile), then verifies.
set -e
IN="$1"; OUT="${2:-${1%.*}-PUBLISH.mp4}"
VC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$IN")
[ "$VC" = "h264" ] || { echo "FAIL: video codec is $VC — SEI strip (remove_types=6) is h264-only. Re-encode or extend the script."; exit 1; }
if [ -f "$OUT" ]; then
  A="$(dirname "$OUT")/_archive-$(date +%Y%m%d-%H%M)-$(basename "$OUT")"
  mv "$OUT" "$A"; echo "archived old version -> $A"
fi
ffmpeg -y -v error -i "$IN" -map 0 -c copy \
  -map_metadata -1 -map_chapters -1 \
  -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -bsf:v 'filter_units=remove_types=6' \
  -movflags +faststart "$OUT"
echo "--- verify: format tags (must be empty) ---"
ffprobe -v error -show_entries format_tags -of default=nw=1 "$OUT" || true
echo "--- verify: stream tags (must be empty/und) ---"
ffprobe -v error -show_entries stream_tags -of default=nw=1 "$OUT" || true
echo "--- verify: AI-marker scan in metadata zones ---"
python3 - "$OUT" <<'EOF'
import sys
d=open(sys.argv[1],'rb').read()
zones=d[:3_000_000]+d[-3_000_000:]
bad=[b'c2pa',b'jumb',b'uuid\xbe{\xcf\x97',b'XMP_',b'x:xmpmeta',b'adobe:ns:meta',b'DigitalSourceType',b'trainedAlgorithmicMedia',b'GenAI',b'SynthID',b'Lavf',b'Remotion',b'edge-tts',b'ElevenLabs']
fail=[m.decode(errors='replace') for m in bad if m in zones]
print("FAIL — markers found:",fail) if fail else print("PASS — sterile, upload-ready")
sys.exit(1 if fail else 0)
EOF
echo "OUT: $OUT ($(du -h "$OUT" | cut -f1))"

```


================================================================================
## FILE: src/remotion.config.ts
================================================================================

```ts
// FBM pipeline defaults. --gl=angle is REQUIRED for any 3D (ThreeCanvas) comp on this Mac:
// the default backend fails with "Error creating WebGL context".
import { Config } from "@remotion/cli/config";
Config.setChromiumOpenGlRenderer("angle");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

```


================================================================================
## FILE: src/fbm/kit/FbmFilmKit.tsx
================================================================================

```tsx
// FBM FILM KIT — the permanent component library for DECODE-series films.
// Every hard-won lesson from EP-01..03 is baked INTO these components, so a new
// episode cannot repeat an old mistake:
//   · RollCounter is invisible until its count starts (no premature "0" on screen)
//   · StatStamp lands measured constants at full value (never tweens 20→30 under a spoken "30")
//   · ItalicClaim carries its own scrim (never illegible over bright 3D)
//   · Kicker/Head/Cite live at the approved bottom-left positions, clear of IG UI
//   · CTABlock puts the comment ask visually ABOVE the funnel pill, with a question line
// Layout law: headline bottom:400 · citation bottom:330 · chapter top:46 · nothing
// critical below y≈1590. A translucent human body (CoreSpine → BodyShell) is
// MANDATORY in every film — an isolated organ/bone alone gets rejected.
import React from "react";
import { interpolate } from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import { loadFont as loadMono } from "@remotion/google-fonts/SpaceMono";
import { loadFont as loadCorm } from "@remotion/google-fonts/CormorantGaramond";

const anton = loadAnton(), dm = loadDM(), mono = loadMono(), corm = loadCorm();
export const F = { anton: anton.fontFamily, dm: dm.fontFamily, mono: mono.fontFamily, corm: corm.fontFamily };
export const C = {
  INK: "#EDE6D6", GOLD: "#E8BC6A", GOLD2: "#D4A148", RED: "#FF3B30",
  TEAL: "#3FB5C4", CYAN: "#7FE3EC", DIM: "#6B6F73", BG: "#0A0B0E",
};
export const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ip = (t: number, a: number[], b: number[]) => interpolate(t, a, b, cl);
export const win = (t: number, w: number[], fade = 0.4) =>
  ip(t, [w[0], w[0] + fade, w[1] - 0.35, w[1]], [0, 1, 1, 0]);

// Cold-open: play a flash of the film's best moment at t=0, then run normally.
// Usage in the film's Stage/Rig: const st = coldOpenT(t, 7.6, 0.8) — the first
// 0.8 s shows the moment at 7.6 s (e.g. the buckle), everything after runs as-is.
export const coldOpenT = (t: number, srcT: number, dur = 0.8) => (t < dur ? srcT + t : t);

const SHADOW = "0 0 30px rgba(10,11,14,0.96), 0 3px 18px rgba(10,11,14,0.92)";

// ---- layout-law components ------------------------------------------------
export const Head: React.FC<{ big: string; it?: string; itc?: string }> = ({ big, it, itc = C.GOLD }) => (
  <div style={{ position: "absolute", left: 56, right: 90, bottom: 400 }}>
    <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 100, lineHeight: 0.95, whiteSpace: "pre-line", textShadow: SHADOW }}>{big}</div>
    <div style={{ height: 4, width: 120, background: C.GOLD2, margin: "14px 0 10px", boxShadow: `0 0 12px ${C.GOLD2}` }} />
    {it && <div style={{ fontFamily: F.corm, fontStyle: "italic", color: itc, fontSize: 40, opacity: 0.95, textShadow: SHADOW }}>{it}</div>}
  </div>
);

export const Cite: React.FC<{ txt: string }> = ({ txt }) => (
  <div style={{ position: "absolute", bottom: 330, left: 56, right: 120 }}>
    <div style={{ display: "inline-block", borderLeft: `3px solid ${C.GOLD2}`, background: "rgba(10,11,14,0.62)", padding: "8px 14px 8px 12px", borderRadius: "0 8px 8px 0" }}>
      <span style={{ fontFamily: F.mono, color: C.INK, fontSize: 17.5, opacity: 0.74, letterSpacing: "0.08em" }}>{txt}</span>
    </div>
  </div>
);

export const Chapter: React.FC<{ t: number; tags: Array<[number[], string]> }> = ({ t, tags }) => {
  const cur = tags.find(([w]) => t >= w[0] && t < w[1]);
  if (!cur) return null;
  return (
    <div style={{ position: "absolute", top: 46, left: 56, opacity: win(t, cur[0], 0.3) * 0.95 }}>
      <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 22, letterSpacing: "0.3em" }}>{cur[1]}</div>
      <div style={{ height: 2, width: 54, background: C.GOLD2, marginTop: 8, opacity: 0.7 }} />
    </div>
  );
};

// Section kicker for mid-frame labels — ALWAYS gold-treated (the grey MULTIFIDUS
// kicker was flagged as the emptiest frame of EP-03; this component is the fix).
export const Kicker: React.FC<{ small: string; big: string; sub?: string; o?: number; right?: boolean }> = ({ small, big, sub, o = 1, right }) => (
  <div style={{ opacity: o, textAlign: right ? "right" : "left" }}>
    <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 22, letterSpacing: "0.18em" }}>{small}</div>
    <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 72, lineHeight: 1, textShadow: SHADOW }}>{big}</div>
    {sub && <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 20, opacity: 0.72, marginTop: 8 }}>{sub}</div>}
    <div style={{ height: 3, width: 92, background: C.GOLD2, marginTop: 10, boxShadow: `0 0 10px ${C.GOLD2}`, marginLeft: right ? "auto" : 0 }} />
  </div>
);

export const TypeOn: React.FC<{ t: number; from: number; dur?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ t, from, dur = 0.85, children, style }) => {
  const p = ip(t, [from, from + dur], [0, 1]);
  return <div style={{ ...style, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, opacity: p > 0 ? 1 : 0 }}>{children}</div>;
};

// A key claim in italic — carries its own chip so it can NEVER sit illegible on
// bright 3D (the "8 to 31 percent over gold rings" failure).
export const ItalicClaim: React.FC<{ txt: string; col?: string }> = ({ txt, col = C.CYAN }) => (
  <div style={{ display: "inline-block", background: "rgba(10,11,14,0.72)", borderRadius: 8, padding: "6px 16px" }}>
    <span style={{ fontFamily: F.corm, fontStyle: "italic", color: col, fontSize: 40 }}>{txt}</span>
  </div>
);

// ---- numbers --------------------------------------------------------------
// RollCounter: for totals that ACCUMULATE (4,200 reps). Invisible before t0.
export const RollCounter: React.FC<{
  t: number; t0: number; t1: number; to: number; step?: number;
  label?: string; col?: string; size?: number; fmt?: (n: number) => string;
}> = ({ t, t0, t1, to, step = 10, label, col = C.INK, size = 170, fmt }) => {
  if (t < t0) return null;
  const v = Math.round(ip(t, [t0, t1], [0, to]) / step) * step;
  return (
    <div>
      <div style={{ fontFamily: F.anton, color: col, fontSize: size, lineHeight: 0.9, textShadow: SHADOW }}>{fmt ? fmt(v) : v.toLocaleString()}</div>
      {label && <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 23, letterSpacing: "0.12em", marginTop: 8 }}>{label}</div>}
    </div>
  );
};

// StatStamp: for MEASURED CONSTANTS (30 ms, 56%, 2 kg). Never counts up —
// lands at full value with a scale pop, timed to the spoken word.
export const StatStamp: React.FC<{ t: number; at: number; txt: string; label?: string; col?: string; size?: number }> = ({ t, at, txt, label, col = C.GOLD, size = 132 }) => {
  if (t < at) return null;
  const k = ip(t, [at, at + 0.28], [1.35, 1]);
  return (
    <div style={{ transform: `scale(${k})`, transformOrigin: "left bottom" }}>
      <div style={{ fontFamily: F.anton, color: col, fontSize: size, lineHeight: 0.9, textShadow: `0 0 30px ${col}55, ${SHADOW}` }}>{txt}</div>
      {label && <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, letterSpacing: "0.1em", opacity: 0.78, marginTop: 6 }}>{label}</div>}
    </div>
  );
};

// ---- editorial devices ----------------------------------------------------
export const MythStrike: React.FC<{ t: number; at: number; txt: string; after?: string; size?: number }> = ({ t, at, txt, after, size = 84 }) => {
  const s = ip(t, [at, at + 0.6], [0, 1]);
  const a = ip(t, [at + 0.8, at + 1.5], [0, 1]);
  return (
    <div>
      <div style={{ display: "inline-block", position: "relative" }}>
        <div style={{ fontFamily: F.anton, color: s > 0.5 ? C.DIM : C.INK, fontSize: size, textShadow: SHADOW }}>{txt}</div>
        <div style={{ position: "absolute", top: "50%", left: 0, height: 8, width: `${s * 100}%`, background: C.RED, boxShadow: `0 0 18px ${C.RED}` }} />
      </div>
      {after && <div style={{ fontFamily: F.anton, color: C.GOLD, fontSize: size, opacity: a, textShadow: SHADOW }}>{after}</div>}
    </div>
  );
};

export const RubberStamp: React.FC<{ t: number; at: number; txt: string }> = ({ t, at, txt }) => {
  const s = ip(t, [at, at + 0.55], [0, 1]);
  if (s <= 0) return null;
  return (
    <div style={{ textAlign: "center", transform: `scale(${2 - s})`, opacity: s }}>
      <span style={{ fontFamily: F.anton, color: C.RED, fontSize: 56, border: `6px solid ${C.RED}`, padding: "10px 26px", transform: "rotate(-5deg)", display: "inline-block", background: "rgba(10,11,14,0.7)" }}>{txt}</span>
    </div>
  );
};

export const BarPair: React.FC<{ t: number; t0: number; a: [string, number, string]; b: [string, number, string]; unit: string }> = ({ t, t0, a, b, unit }) => {
  const p = ip(t, [t0, t0 + 3.2], [0, 1]);
  if (p <= 0) return null;
  return (
    <div style={{ opacity: Math.min(1, p * 3) }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 430 }}>
        {[a, b].map(([lab, v, c], i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F.anton, color: c, fontSize: 68 }}>{Math.round(v * p)}%</div>
            <div style={{ width: 132, height: v * 3.2 * p, background: c, borderRadius: 10, marginTop: 10, boxShadow: `0 0 22px ${c}` }} />
            <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 20, marginTop: 12, opacity: 0.8, letterSpacing: "0.08em" }}>{lab}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, textAlign: "center", opacity: 0.7, letterSpacing: "0.1em" }}>{unit}</div>
    </div>
  );
};

// The honesty chip — "39 PEOPLE. ONE TRIAL. A SIGNAL, NOT A PROMISE."
// Flagged best-in-class by the EP-03 audit. Use one whenever the evidence is thin.
export const HonestyChip: React.FC<{ big: string; sub: string; o?: number }> = ({ big, sub, o = 1 }) => (
  <div style={{ textAlign: "center", opacity: o }}>
    <div style={{ display: "inline-block", border: `2px solid ${C.CYAN}`, borderRadius: 10, padding: "14px 26px", background: "rgba(10,11,14,0.72)" }}>
      <div style={{ fontFamily: F.anton, color: C.CYAN, fontSize: 48 }}>{big}</div>
      <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 22, opacity: 0.82, marginTop: 8, letterSpacing: "0.08em" }}>{sub}</div>
    </div>
  </div>
);

// ---- CTA ------------------------------------------------------------------
// Comment ask is the HERO (feeds the algorithm); the funnel pill is quiet
// secondary. The question line converts an instruction into identity bait.
export const CTABlock: React.FC<{ t: number; at: number; headline: string; italic: string; question: string; ask: string; pill: string }> = ({ t, at, headline, italic, question, ask, pill }) => {
  const o = ip(t, [at, at + 0.7], [0, 1]);
  const q = ip(t, [at + 4.6, at + 5.4], [0, 1]);
  const bio = ip(t, [at + 6.6, at + 7.4], [0, 1]);
  return (
    <div style={{ position: "absolute", left: 56, right: 80, bottom: 400, opacity: o }}>
      <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 86, lineHeight: 0.98, whiteSpace: "pre-line" }}>{headline}</div>
      <div style={{ fontFamily: F.corm, fontStyle: "italic", color: C.GOLD, fontSize: 42, marginTop: 16 }}>{italic}</div>
      <div style={{ fontFamily: F.mono, color: C.CYAN, fontSize: 27, letterSpacing: "0.12em", marginTop: 30, opacity: q }}>{question}</div>
      <div style={{ fontFamily: F.anton, color: C.GOLD, fontSize: 74, marginTop: 10, textShadow: `0 0 28px ${C.GOLD2}`, opacity: q }}>{ask}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 26, opacity: bio * 0.92 }}>
        <div style={{ background: "rgba(212,161,72,0.16)", border: `2px solid ${C.GOLD2}`, color: C.GOLD, fontFamily: F.anton, fontSize: 30, padding: "10px 24px", borderRadius: 12 }}>{pill}</div>
        <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, letterSpacing: "0.08em", opacity: 0.85 }}>LINK IN BIO ⬆</div>
      </div>
      <div style={{ marginTop: 22, fontFamily: F.mono, color: C.GOLD, fontSize: 20, letterSpacing: "0.12em", opacity: 0.9 * bio }}>MADDY · NASM-CPT · SPORTS NUTRITION</div>
    </div>
  );
};

// Credential lower-third. Reserve zone: x<650, y 230-360 — nothing else may
// enter it during the hold (the EP-03 "2 KG over NASM" collision rule).
export const CredThird: React.FC<{ t: number; from?: number; hold?: number }> = ({ t, from = 1.6, hold = 3.3 }) => {
  const o = ip(t, [from, from + 0.5, from + hold + 0.5, from + hold + 1.0], [0, 1, 1, 0]);
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 56, top: 250, opacity: o }}>
      <div style={{ borderLeft: `4px solid ${C.GOLD2}`, paddingLeft: 16 }}>
        <div style={{ fontFamily: F.anton, fontStyle: "italic", color: C.INK, fontSize: 52, lineHeight: 1 }}>MADDY</div>
        <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 20, letterSpacing: "0.16em", marginTop: 7 }}>NASM-CPT · SPORTS NUTRITION</div>
      </div>
    </div>
  );
};

// Opening contents card — "WHAT WE COVER" value-menu (Maddy format, 2026-09-21).
// Sits over the cold-open backdrop for ~4s while the VO hook plays underneath,
// then dissolves into the first stat slam. Items cascade fast so it reads as
// momentum, not a static index.
export const ContentsCard: React.FC<{ t: number; until: number; ep: string; title: string; items: string[]; itemAts?: number[] }> = ({ t, until, ep, title, items, itemAts }) => {
  if (t > until + 0.1) return null;
  const o = ip(t, [until - 0.45, until], [1, 0]);
  return (
    <AbsoluteFillDiv style={{ opacity: o }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 120% 90% at 50% 40%, rgba(10,11,14,0.84) 0%, rgba(10,11,14,0.92) 100%)" }} />
      <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 24, letterSpacing: "0.32em", paddingLeft: "0.32em" }}>{ep}</div>
        <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 150, lineHeight: 0.92, marginTop: 18 }}>{title}</div>
        <div style={{ height: 4, width: 120, background: C.GOLD2, margin: "22px auto 0", boxShadow: `0 0 14px ${C.GOLD2}` }} />
      </div>
      <div style={{ position: "absolute", top: 560, left: 110, right: 90 }}>
        <div style={{ fontFamily: F.anton, color: C.GOLD, fontSize: 58, letterSpacing: "0.06em", marginBottom: 8, opacity: ip(t, [0.30, 0.55], [0, 1]), textShadow: "0 0 22px rgba(212,161,72,0.35)" }}>WHAT WE COVER</div>
        <div style={{ fontFamily: F.mono, color: C.CYAN, fontSize: 21, letterSpacing: "0.26em", marginBottom: 26, opacity: ip(t, [0.40, 0.65], [0, 1]) }}>IN THIS VIDEO</div>
        {items.map((it, i) => {
          const a = itemAts ? itemAts[i] : 0.55 + i * 0.11;
          const p = ip(t, [a, a + 0.30], [0, 1]);
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 22, marginBottom: 26, opacity: p, transform: `translateX(${(1 - p) * -46}px)` }}>
              <span style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 26, width: 46 }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontFamily: F.anton, color: C.INK, fontSize: 52, letterSpacing: "0.01em" }}>{it}</span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", bottom: 340, left: 0, right: 0, textAlign: "center", opacity: ip(t, [1.6, 2.1], [0, 1]) }}>
        <span style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, letterSpacing: "0.14em", opacity: 0.7 }}>MADDY · NASM-CPT · SPORTS NUTRITION</span>
      </div>
    </AbsoluteFillDiv>
  );
};
const AbsoluteFillDiv: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div style={{ position: "absolute", inset: 0, ...style }}>{children}</div>
);

```


================================================================================
## FILE: src/fbm/films/CoreSpine.tsx
================================================================================

```tsx
// CoreSpine — real 15-vertebra thoracolumbar column (extracted from skeleton.glb)
// driven as a forward-kinematic chain, plus the procedural pressure canister
// (TVA corset rings + diaphragm dome + pelvic-floor bowl).
// Used by CORE 01. Module-level cache + delayRender, same pattern as Strength01.
import React from "react";
import * as THREE from "three";
import { staticFile, delayRender, continueRender } from "remotion";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Vert = { g: THREE.Group; c: THREE.Vector3 };
let SPINE: Vert[] | null = null;
let BODY: THREE.Group | null = null;

// ---- body shell (écorché) — the human the spine lives in -----------------
// Same asset and treatment as the BREATH film: a translucent figure that fills
// the frame, with the anatomy glowing inside it.
export const useBody = () => {
  const [ready, setReady] = React.useState<boolean>(!!BODY);
  const [handle] = React.useState(() => (BODY ? null : delayRender("core-body", { timeout: 240000 })));
  React.useEffect(() => {
    if (BODY) return;
    const L = new GLTFLoader();
    L.load(staticFile("fbm/mbmm/ecorche.glb"), (gl) => {
      const s = gl.scene;
      s.traverse((o: any) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) {
            o.userData._base = o.material.color ? o.material.color.clone() : new THREE.Color(1, 1, 1);
            if (o.material.emissive !== undefined) { o.material.emissive = new THREE.Color(0x000000); o.material.emissiveIntensity = 0; }
            o.material.depthWrite = false;          // shell must not occlude the spine
          }
        }
      });
      s.updateMatrixWorld(true);
      const bx = new THREE.Box3().setFromObject(s);
      const c = bx.getCenter(new THREE.Vector3());
      const z = bx.getSize(new THREE.Vector3());
      const sc = 3.6 / Math.max(z.x, z.y, z.z);
      s.scale.setScalar(sc); s.position.set(-c.x * sc, -c.y * sc, -c.z * sc);
      BODY = s; setReady(true);
    });
  }, []);
  React.useEffect(() => { if (ready && handle != null) continueRender(handle); }, [ready, handle]);
  return ready;
};

// shell 0..1 = visibility · heat 0..1 = stress/red · gold 0..1 = living gold
export const BodyShell: React.FC<{ shell: number; heat?: number; gold?: number }> = ({ shell, heat = 0, gold = 0 }) => {
  if (!BODY || shell <= 0.001) return null;
  const cool = new THREE.Color("#5D7D8C");
  const warm = new THREE.Color("#C9705E");
  const gld = new THREE.Color("#D4A148");
  const tint = cool.clone().lerp(warm, heat).lerp(gld, 0.72 * gold);
  BODY.traverse((o: any) => {
    if (!o.isMesh || !o.material) return;
    if (o.material.color) o.material.color.copy((o.userData._base as THREE.Color) || new THREE.Color(1, 1, 1)).lerp(tint, 0.82);
    if (o.material.emissive) {
      o.material.emissive.setRGB(0.055 * heat + 0.075 * gold, 0.028 + 0.042 * gold, 0.052 - 0.03 * heat);
      o.material.emissiveIntensity = 0.12 + 0.26 * gold;
    }
    o.material.transparent = true;
    o.material.opacity = shell;
  });
  return <primitive object={BODY} />;
};

// ---- loader -------------------------------------------------------------
export const useSpine = () => {
  const [ready, setReady] = React.useState<boolean>(!!SPINE);
  const [handle] = React.useState(() => (SPINE ? null : delayRender("core-spine", { timeout: 180000 })));
  React.useEffect(() => {
    if (SPINE) return;
    const L = new GLTFLoader();
    L.load(staticFile("fbm/mbmm/spine.glb"), (gl) => {
      const s = gl.scene;
      s.updateMatrixWorld(true);
      // collect V00..VNN meshes, bake world transform, normalise to unit height
      const found: Array<{ m: THREE.Mesh; i: number }> = [];
      s.traverse((o: any) => {
        if (o.isMesh && /^V\d\d/.test(o.name || "")) found.push({ m: o as THREE.Mesh, i: parseInt(o.name.slice(1, 3), 10) });
      });
      found.sort((a, b) => a.i - b.i);
      const box = new THREE.Box3().setFromObject(s);
      const size = box.getSize(new THREE.Vector3());
      const sc = 3.0 / size.y;                    // column = 3 units tall
      const mid = box.getCenter(new THREE.Vector3());

      const verts: Vert[] = found.map(({ m }) => {
        const geo = (m.geometry as THREE.BufferGeometry).clone();
        geo.applyMatrix4(m.matrixWorld);          // bake node transform
        geo.translate(-mid.x, -box.min.y, -mid.z); // base at y=0, centred x/z
        geo.scale(sc, sc, sc);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 0.62, metalness: 0.06, transparent: true, opacity: 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        const bb = new THREE.Box3().setFromObject(mesh);
        const c = bb.getCenter(new THREE.Vector3());
        // pivot group sits at the vertebra centre; mesh offsets back so it draws in place
        const g = new THREE.Group();
        mesh.position.set(-c.x, -c.y, -c.z);
        g.add(mesh);
        g.position.copy(c);
        return { g, c: c.clone() };
      });
      SPINE = verts;
      setReady(true);
    });
  }, []);
  React.useEffect(() => { if (ready && handle != null) continueRender(handle); }, [ready, handle]);
  return ready;
};

export const spineHeight = () => (SPINE ? SPINE[SPINE.length - 1].c.y + 0.16 : 3.0);

// ---- the column ---------------------------------------------------------
// buckle 0..1  — Euler-style failure: S-curve + forward flexion, worst mid-column
// gold   0..1  — bone → living gold (muscle-supported)
// crush  0..1  — vertical compression (sit-up beat)
export const SpineColumn: React.FC<{ buckle: number; gold: number; crush?: number; opacity?: number }> = ({ buckle, gold, crush = 0, opacity = 1 }) => {
  const root = React.useRef<THREE.Group>(null);
  if (!SPINE) return null;
  const n = SPINE.length;

  // forward kinematics along the chain
  let pos = SPINE[0].c.clone();
  let rot = new THREE.Quaternion();
  const boneCol = new THREE.Color("#DCD4C4");
  const goldCol = new THREE.Color("#E8BC6A");
  const failCol = new THREE.Color("#FF3B30");

  for (let i = 0; i < n; i++) {
    const v = SPINE[i];
    if (i > 0) {
      const u = i / (n - 1);
      // first + second buckling modes → an S that fails forward
      const lat = 0.112 * Math.sin(Math.PI * u) + 0.062 * Math.sin(2 * Math.PI * u);
      const fwd = 0.085 * Math.sin(Math.PI * u) + 0.024 * Math.sin(3 * Math.PI * u);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(fwd * buckle, 0, lat * buckle, "XYZ"));
      rot = rot.clone().multiply(q);
      const seg = SPINE[i].c.clone().sub(SPINE[i - 1].c);
      seg.y *= 1 - 0.17 * crush;                 // discs compress
      pos = pos.clone().add(seg.applyQuaternion(rot));
    }
    v.g.position.copy(pos);
    v.g.quaternion.copy(rot);
    const mesh = v.g.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const stress = buckle * Math.sin(Math.PI * (i / (n - 1)));   // mid-column takes the damage
    mat.color.copy(boneCol).lerp(goldCol, gold).lerp(failCol, 0.55 * stress * (1 - gold));
    mat.emissive = new THREE.Color().copy(goldCol).multiplyScalar(0.34 * gold + 0.10 * stress);
    mat.emissiveIntensity = 1;
    mat.opacity = opacity;
    mat.transparent = opacity < 1;
  }
  return <group ref={root}>{SPINE.map((v, i) => <primitive key={i} object={v.g} />)}</group>;
};

// ---- the pressure canister ---------------------------------------------
// p 0..1 = how built the cylinder is · press 0..1 = intra-abdominal pressure
const Ring: React.FC<{ y: number; r: number; op: number; col: string; tube?: number }> = ({ y, r, op, col, tube = 0.026 }) => (
  <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
    <torusGeometry args={[r, tube, 8, 64]} />
    <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.85} transparent opacity={op} roughness={0.4} />
  </mesh>
);

export const PressureCanister: React.FC<{ p: number; press?: number; showRoof?: number; showFloor?: number }> = ({ p, press = 0, showRoof = 1, showFloor = 1 }) => {
  const H = 3.0;
  const N = 15;
  const squeeze = 1 - 0.10 * press;
  const GOLD = "#E8BC6A", TEAL = "#3FB5C4", CY = "#7FE3EC";
  return (
    <group>
      {/* TVA corset — 360° rings, widest at the waist */}
      {Array.from({ length: N }).map((_, i) => {
        const u = i / (N - 1);
        const y = 0.28 + u * (H - 0.62);
        const prof = 0.60 + 0.30 * Math.sin(Math.PI * Math.min(1, u * 1.08));
        const appear = Math.max(0, Math.min(1, p * (N + 2) - i));   // build bottom-up
        return <Ring key={i} y={y} r={prof * squeeze} op={0.46 * appear} col={GOLD} tube={0.022} />;
      })}
      {/* vertical fascia lines */}
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const r = 0.80 * squeeze;
        return (
          <mesh key={`f${i}`} position={[Math.cos(a) * r, H / 2, Math.sin(a) * r]}>
            <boxGeometry args={[0.012, H * 0.78, 0.012]} />
            <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.55} transparent opacity={0.16 * p} />
          </mesh>
        );
      })}
      {/* diaphragm — the roof */}
      <mesh position={[0, H - 0.34 + 0.10 * press, 0]} scale={[0.82 * squeeze, 0.40, 0.82 * squeeze]}>
        <sphereGeometry args={[1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={CY} emissive={TEAL} emissiveIntensity={0.7} transparent opacity={0.52 * p * showRoof} side={THREE.DoubleSide} wireframe />
      </mesh>
      {/* pelvic floor — the base */}
      <mesh position={[0, 0.34 - 0.05 * press, 0]} rotation={[Math.PI, 0, 0]} scale={[0.70 * squeeze, 0.32, 0.70 * squeeze]}>
        <sphereGeometry args={[1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={CY} emissive={TEAL} emissiveIntensity={0.7} transparent opacity={0.52 * p * showFloor} side={THREE.DoubleSide} wireframe />
      </mesh>
    </group>
  );
};

// ---- multifidus — the deep stabiliser that wastes after a back-pain episode ----
// show 0..1 = present · waste 0..1 = atrophy (shrinks + dims + desaturates)
export const Multifidus: React.FC<{ show: number; waste: number }> = ({ show, waste }) => {
  if (!SPINE) return null;
  const lo = Math.floor(SPINE.length * 0.55);               // lumbar region only
  const strands: React.ReactNode[] = [];
  for (let i = lo; i < SPINE.length - 1; i++) {
    const a = SPINE[i].g.position, b = SPINE[i + 1].g.position;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b) * 1.65;
    for (const s of [-1, 1]) {
      strands.push(
        <mesh key={`${i}${s}`} position={[mid.x + s * 0.17, mid.y, mid.z - 0.20]} rotation={[0, 0, s * 0.10]}>
          <capsuleGeometry args={[0.055 * (1 - 0.55 * waste), len, 4, 10]} />
          <meshStandardMaterial
            color={waste > 0.5 ? "#8A6F5C" : "#C94B3F"}
            emissive={"#C94B3F"} emissiveIntensity={0.42 * (1 - waste)}
            transparent opacity={show * (0.80 - 0.50 * waste)} roughness={0.55} />
        </mesh>
      );
    }
  }
  return <group>{strands}</group>;
};

```


================================================================================
## FILE: src/fbm/films/EnduranceHeart.tsx
================================================================================

```tsx
// EnduranceHeart — EP-04's engine visuals.
// HONESTY NOTE: muscles.glb has no usable cardiac geometry (its "Right atrium"
// cluster turned out to be pectoral muscle sheets — verified by per-mesh QC).
// So the heart is a PROCEDURAL luminous core (Whoop-style glow organ) placed
// between the REAL BodyParts3D lungs — no fake anatomy, and the read is instant:
// a light in the chest that beats. Rate, ECG, counter and 3D all run off ONE clock.
import React from "react";
import * as THREE from "three";
import { staticFile, delayRender, continueRender } from "remotion";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

let LUNG: THREE.Group | null = null;

const fitTo = (s: THREE.Group, h: number, prep: (o: any) => void) => {
  s.traverse((o: any) => { if (o.isMesh) { o.frustumCulled = false; prep(o); } });
  s.updateMatrixWorld(true);
  const bx = new THREE.Box3().setFromObject(s);
  const c = bx.getCenter(new THREE.Vector3()); const z = bx.getSize(new THREE.Vector3());
  const sc = h / Math.max(z.x, z.y, z.z);
  s.scale.setScalar(sc); s.position.set(-c.x * sc, -c.y * sc, -c.z * sc);
  return s;
};

export const useLungs = () => {
  const [ready, setReady] = React.useState<boolean>(!!LUNG);
  const [handle] = React.useState(() => (LUNG ? null : delayRender("endu-lungs", { timeout: 180000 })));
  React.useEffect(() => {
    if (LUNG) return;
    new GLTFLoader().load(staticFile("fbm/mbmm/lungs.glb"), (g) => {
      LUNG = fitTo(g.scene, 0.66, (o) => {
        o.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#2a7787"), emissive: new THREE.Color("#0e515c"),
          emissiveIntensity: 0.06, roughness: 0.58, metalness: 0,
          transparent: true, opacity: 0.92,
        });
      });
      setReady(true);
    });
  }, []);
  React.useEffect(() => { if (ready && handle != null) continueRender(handle); }, [ready, handle]);
  return ready;
};

// One clock for everything: sharp systole spike + softer refill.
export const beatPhase = (t: number, bpm: number) => {
  const p = (t * bpm / 60) % 1;
  return Math.exp(-Math.pow((p - 0.10) / 0.085, 2)) + 0.42 * Math.exp(-Math.pow((p - 0.30) / 0.10, 2));
};

// Integrated phase for a CHANGING bpm (piecewise-linear), so the beat never
// jumps when the rate animates 70 → 45. Mirrors BreathReel's breathPhase.
export const beatPhaseVar = (t: number, T: number[], V: number[]) => {
  let ph = 0;
  for (let i = 1; i < T.length; i++) {
    const t0 = T[i - 1], t1 = T[i];
    if (t <= t0) break;
    const te = Math.min(t, t1);
    const rEnd = V[i - 1] + (V[i] - V[i - 1]) * ((te - t0) / (t1 - t0));
    ph += ((V[i - 1] + rEnd) / 2) * (te - t0) / 60;
    if (te === t) return ph;
  }
  if (t > T[T.length - 1]) ph += (V[V.length - 1] / 60) * (t - T[T.length - 1]);
  return ph;
};
export const spike = (phase: number) => {
  const p = phase % 1;
  return Math.exp(-Math.pow((p - 0.10) / 0.085, 2)) + 0.42 * Math.exp(-Math.pow((p - 0.30) / 0.10, 2));
};

// The luminous heart-core: an organic cluster (ventricle mass + two atrial
// lobes + aortic stub) that swells on the clock and lights the chest.
// s = beat spike 0..1 · grow = athlete's-heart size · amp = stroke-volume pulse
export const HeartCore: React.FC<{
  s: number; grow?: number; amp?: number; gold?: number; heat?: number;
  opacity?: number; scale?: number; pos?: [number, number, number];
}> = ({ s, grow = 0, amp = 0.07, gold = 0, heat = 0, opacity = 1, scale = 1, pos = [0, 0, 0] }) => {
  const base = new THREE.Color("#C4453A").lerp(new THREE.Color("#E8BC6A"), 0.75 * gold);
  const emis = new THREE.Color("#8F1F1A").lerp(new THREE.Color("#D4A148"), 0.8 * gold)
    .lerp(new THREE.Color("#FF3B30"), 0.35 * heat);
  const k = scale * (1 + 0.24 * grow) * (1 + amp * s);
  const glow = 0.9 + 1.6 * s;
  const M = (o = 1) => (
    <meshStandardMaterial color={base} emissive={emis} emissiveIntensity={glow}
      transparent opacity={opacity * o} roughness={0.42} />
  );
  return (
    <group position={pos} scale={k} rotation={[0.12, -0.25, 0.28]}>
      {/* ventricle mass — tapered toward the apex (down-left) */}
      <mesh position={[0, -0.045, 0]} scale={[0.82, 1.05, 0.78]}>
        <sphereGeometry args={[0.115, 28, 22]} />{M()}
      </mesh>
      <mesh position={[-0.038, -0.10, 0.010]} scale={[0.66, 0.78, 0.62]}>
        <sphereGeometry args={[0.105, 24, 18]} />{M()}
      </mesh>
      {/* atrial lobes */}
      <mesh position={[0.045, 0.055, -0.008]} scale={[0.66, 0.58, 0.64]}>
        <sphereGeometry args={[0.1, 22, 16]} />{M(0.95)}
      </mesh>
      <mesh position={[-0.048, 0.05, 0.016]} scale={[0.56, 0.52, 0.54]}>
        <sphereGeometry args={[0.1, 22, 16]} />{M(0.95)}
      </mesh>
      {/* aortic stub */}
      <mesh position={[0.014, 0.105, 0]} rotation={[0, 0, -0.5]}>
        <cylinderGeometry args={[0.034, 0.052, 0.13, 16]} />{M(0.9)}
      </mesh>
      {/* inner light — throws the beat onto the lungs and shell */}
      <pointLight color={gold > 0.5 ? "#E8BC6A" : "#FF5A4A"} intensity={0.55 + 1.5 * s} distance={1.9} decay={2} />
    </group>
  );
};

// ECG trace for SVG overlays, phase-locked to the same clock.
// phase = beatPhaseVar(t, T, V) — pass the film's rate keyframes.
export const ecgPath = (phase: number, x0: number, x1: number, y0: number, h: number, beats = 4) => {
  const W = x1 - x0; const pts: string[] = []; const N = 240;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = (u * beats + 1 - (phase % 1)) % 1;
    let y = 0;
    y += 0.08 * Math.exp(-Math.pow((p - 0.16) / 0.03, 2));
    y -= 0.12 * Math.exp(-Math.pow((p - 0.235) / 0.008, 2));
    y += 1.00 * Math.exp(-Math.pow((p - 0.25) / 0.009, 2));
    y -= 0.28 * Math.exp(-Math.pow((p - 0.268) / 0.010, 2));
    y += 0.16 * Math.exp(-Math.pow((p - 0.40) / 0.035, 2));
    pts.push(`${i ? "L" : "M"}${(x0 + u * W).toFixed(1)} ${(y0 - y * h).toFixed(1)}`);
  }
  return pts.join(" ");
};

// Lungs colour/state driver (hero support, not the star this episode).
export const Lungs: React.FC<{ s: number; gold?: number; heat?: number; opacity?: number; pos?: [number, number, number]; breathAmp?: number; breathS?: number }> = ({ s, gold = 0, heat = 0, opacity = 1, pos = [0, 0.8, 0.14], breathAmp = 0.05, breathS = 0 }) => {
  const g = React.useRef<THREE.Group>(null);
  if (!LUNG) return null;
  const lc = new THREE.Color("#2a7787").lerp(new THREE.Color("#C94B3F"), heat).lerp(new THREE.Color("#D4A148"), 0.5 * gold);
  const le = new THREE.Color("#0e515c").lerp(new THREE.Color("#FF7A66"), heat).lerp(new THREE.Color("#E8BC6A"), 0.55 * gold);
  LUNG.traverse((o: any) => {
    if (o.isMesh && o.material) {
      o.material.color.copy(lc); o.material.emissive.copy(le);
      o.material.emissiveIntensity = 0.05 + 0.10 * s;
      o.material.opacity = opacity;
    }
  });
  if (g.current) {
    g.current.scale.setScalar(1 + breathAmp * breathS);
    g.current.position.set(pos[0], pos[1] + 0.02 * breathS, pos[2]);
  }
  return <group ref={g}><primitive object={LUNG} /></group>;
};

```


================================================================================
## FILE: src/fbm/films/Endurance01.tsx
================================================================================

```tsx
// ENDURANCE 01 · "Ten and a Half Million" — 1080×1920 · 30fps · 3886f (129.54s)
// DECODE EP 04 — first full film BUILT BY THE ENGINE (kit components, VO toolchain,
// heartbeat bed all phase-locked to ONE clock: the heart rate, 70 → 50 bpm).
// Hero: translucent body + real BodyParts3D lungs + luminous heart-core.
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { C, F, ip, win, coldOpenT, Head, Cite, Chapter, Kicker, StatStamp, RollCounter, MythStrike, HonestyChip, ItalicClaim, CTABlock, CredThird } from "../../kit/FbmFilmKit";
import { ContentsCard } from "../../kit/FbmFilmKit";
import { useBody, BodyShell } from "./CoreSpine";
import { useLungs, Lungs, HeartCore, beatPhaseVar, spike, ecgPath } from "./EnduranceHeart";

// ---- ONE clock: the heart rate across the film (bed uses the same keys) ----
const KT = [0, 8, 30, 55, 85, 108, 122.3, 129.54];
const KV = [70, 70, 64, 58, 54, 52, 50, 50];
const bpmAt = (t: number) => ip(t, KT, KV);

// ---- VO-led beat windows (timeline.json) ----
const B = {
  cover: [0, 0.0], hook: [0.0, 12.0], engine: [11.9, 28.5], study: [28.4, 43.1],
  grey: [43.0, 76.7], myth: [76.6, 99.1], lift: [99.0, 111.5], proto: [111.4, 118.0], cta: [117.9, 129.54],
};
const FLASH = 118.9;
const PRE = 8.401;                        // m00 "what we cover" + gap — sab purane times shifted-t me same rehte hain                       // cold-open source: the gold resolve

// ============================== 3D ==============================
const Rig: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t0 = f / fps;
  const t = coldOpenT(t0 - PRE, FLASH + PRE, 0.70);
  const cam = useThree((s) => s.camera);
  const K = [0.85, 6, 12, 16, 26, 28.5, 43, 47, 62, 76.7, 85, 99, 105, 111.5, 118, 129.6];
  const z = [4.9, 4.1, 3.4, 3.35, 3.4, 4.6, 4.8, 4.4, 4.6, 4.3, 4.6, 3.8, 4.1, 4.4, 4.4, 4.6];
  const ly = [0.80, 0.78, 0.76, 0.78, 0.76, 0.66, 0.62, 0.64, 0.62, 0.64, 0.62, 0.72, 0.72, 0.68, 0.70, 0.72];
  const yaw = [-0.12, -0.04, 0.10, 0.26, -0.14, -0.20, 0.14, 0.20, -0.10, 0.22, 0.30, -0.16, -0.24, 0.10, 0.02, -0.10];
  const Z = ip(t, K, z), L = ip(t, K, ly), A = ip(t, K, yaw) + 0.04 * Math.sin(t * 0.29);
  cam.position.set(Math.sin(A) * Z, L + 0.32, Math.cos(A) * Z);
  cam.lookAt(0, L, 0); (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
  return null;
};

const Stage: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t0 = f / fps;
  const t = coldOpenT(t0 - PRE, FLASH + PRE, 0.70);
  const s = spike(beatPhaseVar(t, KT, KV));
  const grow = ip(t, [15.6, 22.7], [0, 1]);                       // chambers stretch on m05
  const heat = ip(t, [46.6, 48.5, 59.0, 61.5], [0, 0.55, 0.55, 0]);   // grey-zone strain
  const gold = Math.max(ip(t, [104.9, 111.0], [0, 0.45]), ip(t, [117.9, 121.0], [0, 1]));
  const shell = ip(t, [0, 0.9, 28.4, 29.4, 42.9, 43.9, 76.5, 77.5, 98.9, 99.9, 117.8, 118.8, 129.6],
                      [0.17, 0.17, 0.17, 0.13, 0.13, 0.16, 0.16, 0.13, 0.13, 0.18, 0.18, 0.26, 0.26]);
  const organOp = ip(t, [0, 28.4, 29.4, 42.9, 43.9, 76.5, 77.5, 98.9, 99.9, 129.6],
                        [1, 1, 0.45, 0.45, 0.8, 0.8, 0.5, 0.5, 1, 1]);
  const breath = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 4.4);
  return (
    <>
      <ambientLight intensity={0.38 + 0.08 * gold} />
      <directionalLight position={[3.5, 4, 3]} intensity={1.35 + 0.4 * gold} color={heat > 0.3 ? "#ffd9cc" : "#fff0dd"} />
      <directionalLight position={[-3.5, 2, -2.5]} intensity={1.25} color="#8fd8e6" />
      <BodyShell shell={shell} heat={heat * 0.5} gold={gold} />
      <Lungs s={s} gold={gold} heat={heat * 0.4} opacity={0.40 * organOp} breathS={breath} breathAmp={0.04} />
      <HeartCore s={s} grow={grow} amp={0.06 + 0.05 * grow} gold={gold} heat={heat} opacity={organOp} scale={1.0} pos={[-0.04, 0.84, 0.18]} />
    </>
  );
};

// ============================== OVERLAY ==============================
const TAGS: Array<[number[], string]> = [
  [B.hook, "01 · THE SAVINGS"], [B.engine, "02 · THE ENGINE"], [B.study, "03 · THE PREDICTOR"],
  [B.grey, "04 · THE GREY ZONE"], [B.myth, "05 · THE MYTH"], [B.lift, "06 · FOR LIFTERS"], [B.proto, "07 · THE PROTOCOL"]];

const BpmWidget: React.FC<{ t: number }> = ({ t }) => {
  const bpm = Math.round(bpmAt(t));
  const s = spike(beatPhaseVar(t, KT, KV));
  const gold = t > 117.9;
  const col = gold ? C.GOLD : C.CYAN;
  return (
    <div style={{ position: "absolute", top: 44, right: 56, textAlign: "right" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "flex-end" }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, background: col, transform: `scale(${0.7 + 0.5 * s})`, boxShadow: `0 0 ${10 + 18 * s}px ${col}` }} />
        <span style={{ fontFamily: F.anton, color: C.INK, fontSize: 62, lineHeight: 1 }}>{bpm}</span>
        <span style={{ fontFamily: F.mono, color: col, fontSize: 22, letterSpacing: "0.1em" }}>BPM</span>
      </div>
      <svg viewBox="0 0 360 90" style={{ width: 360, marginTop: 6, opacity: 0.85 }}>
        <path d={ecgPath(beatPhaseVar(t, KT, KV), 6, 354, 62, 46, 3)} fill="none" stroke={col} strokeWidth={3} strokeLinecap="round" />
      </svg>
    </div>
  );
};

const Overlay: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps - PRE;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Chapter t={t} tags={TAGS} />
      <BpmWidget t={t} />
      <CredThird t={t} from={5.6} hold={3.0} />

      {/* series tag — small, after the hook has landed (no title-card open) */}
      {t > 900 && (
        <div style={{ position: "absolute", top: 110, left: 56, opacity: ip(t, [3.0, 3.6, 10.8, 11.5], [0, 0.8, 0.8, 0]) }}>
          <span style={{ fontFamily: F.mono, color: C.GOLD, fontSize: 21, letterSpacing: "0.3em" }}>DECODE · EP 04</span>
        </div>
      )}

      {/* HOOK */}
      {t >= 0.62 && t < B.hook[1] + 0.3 && (() => {
        const o = win(t, B.hook);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 385 }}>
              <StatStamp t={t} at={0.95} txt="10.5 MILLION" label="HEARTBEATS SAVED · EVERY YEAR" col={C.GOLD} size={126} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 648, opacity: ip(t, [5.2, 6.0], [0, 1]) }}>
              <div style={{ fontFamily: F.mono, color: C.CYAN, fontSize: 27, letterSpacing: "0.08em", background: "rgba(10,11,14,0.6)", display: "inline-block", padding: "8px 14px", borderRadius: 8 }}>
                70 → 50 RESTING · 28,800 FEWER / DAY
              </div>
            </div>
            <Head big={"TEN AND A HALF\nMILLION."} it="same life, less work" />
            <Cite txt="ARITHMETIC: 20 BPM × 1,440 MIN × 365 · RESTING-HR RANGES: FAGARD 2003, HEART" />
          </div>
        );
      })()}

      {/* ENGINE */}
      {t >= B.engine[0] && t < B.engine[1] + 0.3 && (() => {
        const o = win(t, B.engine);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 300 }}>
              <StatStamp t={t} at={17.6} txt="+60–80%" label="CHAMBER VOLUME · ELITE ENDURANCE ATHLETES" col={C.GOLD} size={118} />
            </div>
            <div style={{ position: "absolute", right: 62, top: 620, textAlign: "right" }}>
              <StatStamp t={t} at={25.2} txt="30 BPM" label="ELITE CYCLISTS WAKE HERE" col={C.CYAN} size={96} />
            </div>
            <Head big={"YOUR HEART IS\nAN ENGINE."} it="almost nobody trains it on purpose" itc={C.CYAN} />
            <Cite txt="MORGANROTH 1975 ANNALS INT MED (181/160 vs 101 mL) · PELLICCIA 1999 · FAGARD 2003 · MUJIKA 2012" />
          </div>
        );
      })()}

      {/* STUDY */}
      {t >= B.study[0] && t < B.study[1] + 0.3 && (() => {
        const o = win(t, B.study);
        const n = Math.round(ip(t, [29.0, 32.2], [0, 122007]));
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 300 }}>
              <RollCounter t={t} t0={29.0} t1={32.2} to={122007} step={1000} label="PEOPLE TESTED · CLEVELAND CLINIC" size={132} fmt={(v) => v.toLocaleString()} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 620, opacity: ip(t, [32.8, 33.8], [0, 1]) }}>
              <div style={{ fontFamily: F.anton, color: C.RED, fontSize: 66, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>UNFIT ≈ SMOKING</div>
              <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 21, opacity: 0.78, marginTop: 8, letterSpacing: "0.08em" }}>AS A PREDICTOR OF DEATH</div>
            </div>
            <div style={{ position: "absolute", right: 62, top: 860, textAlign: "right" }}>
              <StatStamp t={t} at={38.2} txt="1/5TH" label="THE RISK · FITTEST vs LEAST FIT" col={C.GOLD} size={104} />
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 1130, textAlign: "center", opacity: ip(t, [40.6, 41.6], [0, 1]) }}>
              <HonestyChip big="NO CEILING IN THE DATA." sub="OBSERVATIONAL COHORT · 8.4 YEARS · IT PREDICTS, IT DOES NOT PROMISE" />
            </div>
            <Head big={"THE\nPREDICTOR."} it="one number, one hundred twenty thousand lives" itc={C.RED} />
            <Cite txt="MANDSAGER ET AL. 2018, JAMA NETWORK OPEN · n=122,007 · ADJUSTED HR 0.20 ELITE vs LOW" />
          </div>
        );
      })()}

      {/* GREY ZONE */}
      {t >= B.grey[0] && t < B.grey[1] + 0.3 && (() => {
        const o = win(t, B.grey);
        const drift = ip(t, [47.0, 53.5], [0, 1]);
        const fix = ip(t, [61.6, 62.6], [0, 1]);
        const zones = [["EASY", C.TEAL, 0.72], ["THE GREY MIDDLE", C.RED, 1], ["HARD", C.GOLD2, 0.72]] as const;
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            {t < 62.5 && (
              <div style={{ position: "absolute", left: 56, right: 66, top: 386, opacity: ip(t, [44.0, 45.0], [0, 1]) * (1 - fix) }}>
                {zones.map(([lab, col, op], i) => {
                  const hot = i === 1;
                  const dots = hot ? Math.round(2 + 8 * drift) : Math.round(6 - 4 * drift);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, opacity: op }}>
                      <div style={{ width: 210, fontFamily: F.mono, color: col, fontSize: 22, letterSpacing: "0.08em" }}>{lab}</div>
                      <div style={{ flex: 1, height: 54, border: `2px solid ${col}`, borderRadius: 10, background: hot ? `rgba(255,59,48,${0.10 + 0.16 * drift})` : "rgba(10,11,14,0.5)", display: "flex", alignItems: "center", paddingLeft: 12, gap: 10 }}>
                        {Array.from({ length: dots }).map((_, k) => (
                          <div key={k} style={{ width: 16, height: 16, borderRadius: 8, background: col, opacity: 0.9 }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div style={{ fontFamily: F.corm, fontStyle: "italic", color: C.RED, fontSize: 38, marginTop: 10, opacity: drift }}>every run becomes a race, every race becomes a jog</div>
              </div>
            )}
            {fix > 0 && (
              <div style={{ position: "absolute", left: 56, top: 320, opacity: fix }}>
                <StatStamp t={t} at={62.6} txt="80% EASY" label="HOW THE FASTEST HUMANS TRAIN" col={C.TEAL} size={122} />
                <div style={{ marginTop: 26 }}><ItalicClaim txt="truly easy. full sentences easy." col={C.TEAL} /></div>
                <div style={{ marginTop: 40 }}>
                  <StatStamp t={t} at={69.4} txt="4 MIN × 4 · +7%" label="ENGINE GROWTH · 8 WEEKS · TRAINED ADULTS" col={C.GOLD} size={84} />
                </div>
              </div>
            )}
            <Head big={"THE GREY\nZONE."} it={t < 62 ? "where progress goes quiet" : "the fix is eighty twenty"} itc={t < 62 ? C.RED : C.TEAL} />
            <Cite txt={t < 62 ? "FOSTER 2001 (DRIFT) · STÖGGL & SPERLICH 2014 (THRESHOLD: NO SIG. VO2 GAIN)" : "SEILER & KJERLAND 2006 (~80% EASY) · PERSINGER 2004 (TALK TEST) · HELGERUD 2007 (4×4 +7.2%)"} />
          </div>
        );
      })()}

      {/* MYTH */}
      {t >= B.myth[0] && t < B.myth[1] + 0.3 && (() => {
        const o = win(t, B.myth);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 310 }}>
              <MythStrike t={t} at={86.9} txt={'"CARDIO KILLS GAINS"'} size={76} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 470, opacity: ip(t, [80.8, 81.8], [0, 1]) }}>
              <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 24, letterSpacing: "0.08em", background: "rgba(10,11,14,0.6)", display: "inline-block", padding: "10px 16px", borderRadius: 8 }}>
                b. 1980 · ONE STUDY · SIX DAYS A WEEK OF BRUTAL CARDIO
              </div>
            </div>
            <div style={{ position: "absolute", left: 56, top: 640 }}>
              <StatStamp t={t} at={89.9} txt="ZERO" label="MUSCLE DIFFERENCE · 43 STUDIES POOLED · 2022" col={C.GOLD} size={150} />
            </div>
            <div style={{ position: "absolute", left: 56, right: 66, top: 1024, opacity: ip(t, [93.3, 93.7], [0, 1]) }}>
              <div style={{ fontFamily: F.anton, color: C.CYAN, fontSize: 46, textShadow: "0 0 24px rgba(10,11,14,0.95)" }}>HARD CARDIO + HEAVY LIFTS: HOURS APART.</div>
              <div style={{ fontFamily: F.anton, color: C.INK, fontSize: 46, marginTop: 8, textShadow: "0 0 24px rgba(10,11,14,0.95)" }}>CHASING SIZE: BIKE OVER LONG RUNS.</div>
            </div>
            <Head big={"THE\nMYTH."} it={t > 88.4 ? "forty three studies later, the fear is dead" : "the fear was born in a lab, in 1980"} itc={C.GOLD} />
            <Cite txt="HICKSON 1980 (ORIGIN) · SCHUMANN 2022 SPORTS MED (SMD −0.01, 43 STUDIES) · WILSON 2012 JSCR" />
          </div>
        );
      })()}

      {/* LIFTERS */}
      {t >= B.lift[0] && t < B.lift[1] + 0.3 && (() => {
        const o = win(t, B.lift);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 320 }}>
              <Kicker small="WHAT LIFTERS MISS" big="REST IS AEROBIC" sub="PHOSPHOCREATINE REFILLS OXIDATIVELY BETWEEN SETS" />
            </div>
            <div style={{ position: "absolute", left: 56, top: 620, opacity: ip(t, [101.8, 102.8], [0, 1]) }}>
              <ItalicClaim txt="a fitter heart refills your strength faster" col={C.GOLD} />
            </div>
            <div style={{ position: "absolute", left: 56, top: 800 }}>
              <StatStamp t={t} at={106.2} txt="75 → 45" label="LIFELONG TRAINERS · HEARTS TESTING 30 YEARS YOUNGER" col={C.GOLD} size={110} />
            </div>
            <Head big={"FOR\nLIFTERS."} it="the engine feeds the iron" />
            <Cite txt="HASELER 1999 J APPL PHYSIOL (PCr · O2) · GRIES 2018 J APPL PHYSIOL (LIFELONG COHORT)" />
          </div>
        );
      })()}

      {/* PROTOCOL */}
      {t >= B.proto[0] && t < B.proto[1] + 0.3 && (() => {
        const o = win(t, B.proto);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, right: 66, top: 340 }}>
              {[["2–3 × EASY", "CONVERSATION PACE · FULL SENTENCES", C.TEAL, 112.2],
                ["1 × HARD", "INTERVALS · EARN IT", C.GOLD, 115.7]].map(([a, b, col, at], i) => (
                <div key={i} style={{ opacity: ip(t, [at as number, (at as number) + 0.7], [0, 1]), marginBottom: 34 }}>
                  <div style={{ fontFamily: F.anton, color: col as string, fontSize: 96, lineHeight: 1 }}>{a}</div>
                  <div style={{ fontFamily: F.mono, color: C.INK, fontSize: 23, opacity: 0.8, letterSpacing: "0.1em", marginTop: 8 }}>{b}</div>
                </div>
              ))}
            </div>
            <Head big={"THE\nPROTOCOL."} it="every week, for the rest of your life" itc={C.TEAL} />
            <Cite txt="WHO 150–300 MIN/WEEK BASELINE · SEILER 2010 (INTENSITY DISTRIBUTION)" />
          </div>
        );
      })()}

      {/* CTA */}
      {t >= B.cta[0] && (
        <AbsoluteFill style={{ background: "linear-gradient(100deg, rgba(10,11,14,0.72) 0%, rgba(10,11,14,0.38) 44%, transparent 70%)", opacity: ip(t, [B.cta[0], B.cta[0] + 0.8], [0, 1]) }} />
      )}
      {t >= B.cta[0] && (
        <CTABlock t={t} at={B.cta[0] + 0.4}
          headline={"THREE BILLION\nBEATS."}
          italic="train it, and every beat costs less"
          question="WHAT IS YOUR MORNING NUMBER?"
          ask="COMMENT YOUR RESTING HR ⬇"
          pill="BODY SCAN — FREE" />
      )}
      <ContentsCard t={t + PRE} until={PRE + 0.70} ep="DECODE · EP 04" title="ENDURANCE"
        items={["THE SAVINGS", "THE ENGINE", "THE DEATH PREDICTOR", "THE GREY ZONE", "THE GAINS MYTH", "FOR LIFTERS", "THE PROTOCOL"]}
        itemAts={[2.06, 2.84, 3.50, 4.46, 5.28, 6.16, 7.00]} />
    </AbsoluteFill>
  );
};

// ============================== FILM ==============================
export const Endurance01: React.FC<{ mix?: string }> = ({ mix }) => {
  const b = useBody(); const l = useLungs();
  return (
    <AbsoluteFill style={{ background: "#0A0B0E" }}>
      {mix && <Audio src={staticFile(mix)} />}
      <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 1.1, 4.9], fov: 42 }}>
        <Rig />
        {b && l && <Stage />}
        <EffectComposer disableNormalPass>
          <Bloom intensity={0.95} luminanceThreshold={0.34} luminanceSmoothing={0.3} mipmapBlur radius={0.74} />
          <Vignette darkness={0.62} offset={0.3} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 94% 84% at 50% 44%, transparent 50%, rgba(0,0,0,.68) 100%)", pointerEvents: "none" }} />
      <Overlay />
    </AbsoluteFill>
  );
};
export const calcEndurance01 = () => ({ durationInFrames: 4138, fps: 30, width: 1080, height: 1920 });

```


================================================================================
## FILE: src/fbm/films/Core01.tsx
================================================================================

```tsx
// CORE 01 · "Two Kilograms" — 1080×1920 · 30fps · 3490f (116.33s)
// DECODE EP 03.
// Act 1 (0-33s): the bare 15-vertebra column alone on stage — it buckles under 2 kg,
//   gets sheathed in gold, then gets its pressure cylinder.
// Act 2 (33s-end): the camera pulls back, the column shrinks into anatomical place and
//   the HUMAN materialises around it — the same translucent écorché shell the BREATH and
//   STRENGTH films use, filling the frame, with the spine glowing inside it.
// Copy sits bottom-left (the approved STRENGTH position, clear of Instagram's username row).
import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadDM } from "@remotion/google-fonts/DMSans";
import { loadFont as loadMono } from "@remotion/google-fonts/SpaceMono";
import { loadFont as loadCorm } from "@remotion/google-fonts/CormorantGaramond";
import { useSpine, useBody, BodyShell, SpineColumn, PressureCanister, Multifidus } from "./CoreSpine";

const anton = loadAnton(), dm = loadDM(), mono = loadMono(), corm = loadCorm();
const F = { anton: anton.fontFamily, dm: dm.fontFamily, mono: mono.fontFamily, corm: corm.fontFamily };
const INK = "#EDE6D6", GOLD = "#E8BC6A", GOLD2 = "#D4A148", RED = "#FF3B30", TEAL = "#3FB5C4", CYAN = "#7FE3EC", DIM = "#6B6F73";
const cl = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ip = (t: number, a: number[], b: number[]) => interpolate(t, a, b, cl);

const B = {
  cover: [0, 0.85], hook: [0.85, 13.45], cyl: [13.35, 32.95], crunch: [32.90, 44.95],
  situp: [44.90, 64.20], multi: [64.15, 83.35], comp: [83.30, 93.35], gen: [93.30, 104.75], cta: [104.70, 116.33],
};
const win = (t: number, w: number[], fade = 0.4) => ip(t, [w[0], w[0] + fade, w[1] - 0.35, w[1]], [0, 1, 1, 0]);

// ============================== 3D ==============================
const Rig: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const cam = useThree((s) => s.camera);
  const K = [0, 5, 9.6, 13.4, 20, 28, 32.9, 35.5, 45, 50, 54, 64, 70, 77, 83, 93, 100, 105, 116.4];
  const z = [6.5, 5.9, 5.6, 5.9, 6.7, 6.7, 7.0, 6.2, 6.0, 4.8, 4.4, 4.7, 3.4, 3.9, 5.6, 5.3, 5.1, 5.6, 5.4];
  const ly = [1.70, 1.62, 1.35, 1.50, 1.50, 1.58, 1.55, 0.35, 0.20, 0.42, 0.44, 0.46, 0.46, 0.44, 0.35, 0.18, 0.18, 0.20, 0.15];
  const yaw = [-0.14, -0.06, 0.06, 0.12, 0.50, 1.10, 1.15, 0.30, 0.16, -0.05, -0.12, -0.18, -0.30, -0.16, 0.22, 0.30, 0.30, 0.08, -0.08];
  const Z = ip(t, K, z), L = ip(t, K, ly), A = ip(t, K, yaw);
  const ang = A + 0.045 * Math.sin(t * 0.31);
  cam.position.set(Math.sin(ang) * Z, L + 0.20, Math.cos(ang) * Z);
  cam.lookAt(0, L, 0); (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
  return null;
};

const Lights: React.FC<{ gold: number; back: number; heat: number }> = ({ gold, back, heat }) => (
  <>
    <ambientLight intensity={0.32 + 0.10 * gold} />
    <directionalLight position={[4.5, 4.5, 3.2]} intensity={1.40 + 0.5 * gold} color={heat > 0.4 ? "#ffd9cc" : "#fff1dc"} />
    <directionalLight position={[-4.5, 2.5, -3]} intensity={0.95 + 1.3 * back} color={heat > 0.4 ? "#e8927f" : "#8fd8e6"} />
    <spotLight position={[-3.2, 4.5, 3]} angle={0.5} penumbra={1} intensity={0.62} color="#dff6ff" />
    <pointLight position={[0, 0.6, 3.4]} intensity={0.14 + 0.24 * gold} color="#aef0ff" />
  </>
);

const Stage: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const buckle = ip(t, [5.9, 9.2, 9.9, 11.2], [0, 1, 1, 0]);
  const gold = ip(t, [10.2, 12.8], [0, 1]);
  const p = ip(t, [14.3, 24.2, 31.4, 33.2], [0, 1, 1, 0]);
  const roof = ip(t, [20.4, 21.6], [0, 1]);
  const floor = ip(t, [22.0, 23.2], [0, 1]);
  const press = Math.max(ip(t, [26.4, 27.0, 27.9, 28.4], [0, 1, 1, 0]), ip(t, [29.6, 30.1, 31.0, 31.5], [0, 1, 1, 0]));
  const crush = ip(t, [47.8, 52.6, 53.6, 55.0], [0, 1, 1, 0]);
  const mShow = ip(t, [64.8, 66.2, 82.4, 83.2], [0, 1, 1, 0]);
  const mWaste = ip(t, [67.6, 70.4], [0, 1]);

  // ACT 1 → ACT 2: the column shrinks into anatomical place, the body arrives around it
  const fit = ip(t, [32.4, 34.5], [0, 1]);
  const fs = 1 - 0.717 * fit;                 // 3.0-unit hero column → 0.85-unit in-body column
  const shell = ip(t,
    [0, 33.2, 35.0, 44.6, 45.6, 55.4, 56.2, 63.8, 64.6, 83.0, 84.0, 93.0, 93.8, 104.2, 105.4, 116.4],
    [0, 0, 0.17, 0.17, 0.26, 0.26, 0.15, 0.15, 0.24, 0.24, 0.22, 0.22, 0.30, 0.30, 0.36, 0.36]);
  const op = ip(t,
    [0, 32.6, 34.0, 44.4, 45.4, 55.5, 56.2, 63.6, 64.4, 83.0, 84.0, 93.0, 93.8, 104.2, 105.2, 116.4],
    [1, 1, 0.30, 0.30, 0.95, 0.95, 0.34, 0.34, 0.95, 0.95, 0.55, 0.55, 0.22, 0.22, 0.85, 0.85]);
  const back = ip(t, [83.4, 85.0, 92.4, 93.2], [0, 1, 1, 0]);
  const heat = Math.max(crush * 0.8, ip(t, [66.8, 70.4, 82.0, 83.2], [0, 0.38, 0.38, 0]));
  const ctaGold = ip(t, [105.2, 108.2], [0, 1]);
  const goldNow = Math.max(gold * (1 - 0.5 * crush), 0.18 * back, 0.9 * ctaGold);

  return (
    <>
      <Lights gold={goldNow} back={back} heat={heat} />
      <BodyShell shell={shell} heat={heat} gold={ctaGold} />
      <group scale={fs} position={[0, 0.36 * fit, -0.06 * fit]}>
        <SpineColumn buckle={buckle} gold={goldNow} crush={crush} opacity={op} />
        {p > 0.01 && <PressureCanister p={p} press={press} showRoof={roof} showFloor={floor} />}
        {mShow > 0.01 && <Multifidus show={mShow} waste={mWaste} />}
      </group>
    </>
  );
};

// ============================== 2D KIT ==============================
const TypeOn: React.FC<{ t: number; from: number; dur?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ t, from, dur = 0.85, children, style }) => {
  const p = ip(t, [from, from + dur], [0, 1]);
  return <div style={{ ...style, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, opacity: p > 0 ? 1 : 0 }}>{children}</div>;
};

// bottom-left editorial headline — the approved STRENGTH / BREATH position
const Head: React.FC<{ big: string; it?: string; itc?: string }> = ({ big, it, itc = GOLD }) => (
  <div style={{ position: "absolute", left: 56, right: 90, bottom: 400 }}>
    <div style={{ fontFamily: F.anton, color: INK, fontSize: 100, lineHeight: 0.95, textShadow: "0 3px 28px rgba(0,0,0,0.9)" }}>{big}</div>
    <div style={{ height: 4, width: 120, background: GOLD2, margin: "14px 0 10px", boxShadow: `0 0 12px ${GOLD2}` }} />
    {it && <div style={{ fontFamily: F.corm, fontStyle: "italic", color: itc, fontSize: 40, opacity: 0.95, textShadow: "0 2px 18px rgba(0,0,0,0.85)" }}>{it}</div>}
  </div>
);

const Cite: React.FC<{ txt: string }> = ({ txt }) => (
  <div style={{ position: "absolute", bottom: 330, left: 56, right: 120 }}>
    <div style={{ display: "inline-block", borderLeft: `3px solid ${GOLD2}`, background: "rgba(10,11,14,0.55)", padding: "8px 14px 8px 12px", borderRadius: "0 8px 8px 0" }}>
      <span style={{ fontFamily: F.mono, color: INK, fontSize: 17.5, opacity: 0.72, letterSpacing: "0.08em" }}>{txt}</span>
    </div>
  </div>
);

const Chapter: React.FC<{ t: number }> = ({ t }) => {
  const tags: Array<[number[], string]> = [
    [B.hook, "01 · THE COLLAPSE"], [B.cyl, "02 · THE CYLINDER"], [B.crunch, "03 · MISTAKE ONE"],
    [B.situp, "04 · MISTAKE TWO"], [B.multi, "05 · THE SHUTDOWN"], [B.comp, "06 · THE GAP"], [B.gen, "07 · THE ANATOMY"]];
  const cur = tags.find(([w]) => t >= w[0] && t < w[1]);
  if (!cur) return null;
  return (
    <div style={{ position: "absolute", top: 46, left: 56, opacity: win(t, cur[0], 0.3) * 0.95 }}>
      <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 22, letterSpacing: "0.3em" }}>{cur[1]}</div>
      <div style={{ height: 2, width: 54, background: GOLD2, marginTop: 8, opacity: 0.7 }} />
    </div>
  );
};

const AbBlocks: React.FC<{ n: number; label: string; pct: string; hero?: boolean }> = ({ n, label, pct, hero }) => (
  <div style={{ textAlign: "center", opacity: hero ? 1 : 0.8 }}>
    <svg viewBox="0 0 120 200" style={{ width: 164 }}>
      <rect x="18" y="14" width="84" height="174" rx="16" fill="rgba(10,11,14,0.55)" stroke={hero ? GOLD : "#7D8892"} strokeWidth={3} />
      {Array.from({ length: n }).map((_, i) => (
        <rect key={i} x={i % 2 ? 62 : 24} y={20 + Math.floor(i / 2) * (168 / Math.ceil(n / 2))}
          width="34" height={168 / Math.ceil(n / 2) - 9} rx="7" fill={hero ? GOLD2 : "#59636D"} opacity={hero ? 0.94 : 0.85} />
      ))}
    </svg>
    <div style={{ fontFamily: F.anton, color: hero ? GOLD : INK, fontSize: 50, marginTop: 8 }}>{label}</div>
    <div style={{ fontFamily: F.mono, color: hero ? GOLD : INK, fontSize: 20, opacity: hero ? 0.9 : 0.7, marginTop: 4 }}>{pct}</div>
  </div>
);

// ============================== OVERLAY ==============================
const Overlay: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Chapter t={t} />

      {/* COVER */}
      {t < B.cover[1] + 0.45 && (() => {
        const und = ip(t, [0.08, 0.6], [0, 1]); const o = ip(t, [B.cover[1], B.cover[1] + 0.4], [1, 0]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", top: 46, left: 56, fontFamily: F.mono, color: GOLD, fontSize: 25, letterSpacing: "0.3em" }}>DECODE · EP 03</div>
            <div style={{ position: "absolute", left: 0, right: 0, top: "46%", transform: "translateY(-50%)", textAlign: "center" }}>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 250, lineHeight: 0.9 }}>CORE</div>
              <div style={{ height: 5, background: GOLD2, width: `${und * 44}%`, margin: "22px auto 0", boxShadow: `0 0 16px ${GOLD2}` }} />
            </div>
          </div>
        );
      })()}

      {/* credential lower-third */}
      {t > 1.6 && t < 5.4 && (() => {
        const o = ip(t, [1.6, 2.1, 4.9, 5.4], [0, 1, 1, 0]);
        return (
          <div style={{ position: "absolute", left: 56, top: 250, opacity: o }}>
            <div style={{ borderLeft: `4px solid ${GOLD2}`, paddingLeft: 16 }}>
              <div style={{ fontFamily: F.anton, fontStyle: "italic", color: INK, fontSize: 52, lineHeight: 1 }}>MADDY</div>
              <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 20, letterSpacing: "0.16em", marginTop: 7 }}>NASM-CPT · SPORTS NUTRITION</div>
            </div>
          </div>
        );
      })()}

      {/* ---------- HOOK ---------- */}
      {t >= B.hook[0] && t < B.hook[1] + 0.3 && (() => {
        const o = win(t, B.hook);
        const kg = ip(t, [1.0, 2.0], [0, 1]);
        const drop = ip(t, [5.7, 6.4], [0, 1]);
        const fail = ip(t, [6.5, 7.4], [0, 1]);
        const save = ip(t, [10.4, 11.6], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: "50%", top: 300 + 140 * drop, transform: "translateX(-50%)", opacity: kg * (1 - save) }}>
              <div style={{ width: 210, height: 96, borderRadius: 12, border: `4px solid ${drop > 0.5 ? RED : INK}`, background: "rgba(10,11,14,0.78)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontFamily: F.anton, color: drop > 0.5 ? RED : INK, fontSize: 60 }}>2 KG</span>
              </div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 19, opacity: 0.62, textAlign: "center", marginTop: 10, letterSpacing: "0.12em" }}>A TWO LITRE BOTTLE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1090, opacity: fail * (1 - save) }}>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 82, textShadow: "0 0 32px rgba(10,11,14,0.98)" }}>THE COLUMN FAILS</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 22, opacity: 0.72, marginTop: 12, letterSpacing: "0.14em" }}>LIGAMENTS ONLY · NO MUSCLE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1090, opacity: save }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 82, textShadow: "0 0 32px rgba(10,11,14,0.98)" }}>ONE SYSTEM HOLDS IT</div>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 22, opacity: 0.82, marginTop: 12, letterSpacing: "0.14em" }}>AND MOST TRAINING MISSES IT</div>
            </div>
            <Head big={"TWO\nKILOGRAMS."} it="that is the whole margin" />
            <Cite txt="LUCAS & BRESLER 1961 · UC BIOMECHANICS LAB · BARE LIGAMENTOUS SPINE BUCKLES ≈20 N" />
          </div>
        );
      })()}

      {/* ---------- CYLINDER ---------- */}
      {t >= B.cyl[0] && t < B.cyl[1] + 0.3 && (() => {
        const o = win(t, B.cyl);
        const n29 = Math.round(ip(t, [15.4, 18.6], [1, 29]));
        const roofL = ip(t, [20.6, 21.4], [0, 1]);
        const floorL = ip(t, [22.2, 23.0], [0, 1]);
        const fire = ip(t, [29.4, 30.0], [0, 1]);
        const ms = Math.round(ip(t, [29.7, 30.9], [0, 30]));
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", right: 62, top: 300, textAlign: "right" }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 132, lineHeight: 0.9, textShadow: `0 0 30px ${GOLD2}` }}>{n29}</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, letterSpacing: "0.1em", opacity: 0.78 }}>PAIRS OF MUSCLES<br />NOT ONE SIX PACK</div>
            </div>
            <div style={{ position: "absolute", left: 56, top: 470, opacity: roofL }}>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 25, letterSpacing: "0.16em" }}>◤ ROOF</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 46 }}>DIAPHRAGM</div>
            </div>
            <div style={{ position: "absolute", left: 56, top: 1010, opacity: floorL }}>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 25, letterSpacing: "0.16em" }}>◣ BASE</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 46 }}>PELVIC FLOOR</div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 1160, textAlign: "center", opacity: fire }}>
              <div style={{ display: "inline-block", background: "rgba(10,11,14,0.88)", border: `2px solid ${GOLD2}`, borderRadius: 12, padding: "16px 30px" }}>
                <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 70, lineHeight: 1 }}>{ms} MILLISECONDS EARLY</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, opacity: 0.8, marginTop: 10, letterSpacing: "0.12em" }}>THE BRACE HAPPENS BEFORE THE MOVE</div>
              </div>
            </div>
            <Head big={"A PRESSURE\nCYLINDER."} it="pressure alone stiffens the spine 8 to 31 percent" itc={CYAN} />
            <Cite txt="AKUTHOTA & NADLER 2004 · HODGES 2005 J BIOMECH (IAP) · HODGES & RICHARDSON 1996 SPINE" />
          </div>
        );
      })()}

      {/* ---------- MISTAKE ONE ---------- */}
      {t >= B.crunch[0] && t < B.crunch[1] + 0.3 && (() => {
        const o = win(t, B.crunch);
        const reps = Math.round(ip(t, [34.5, 38.4], [0, 4200]) / 10) * 10;
        const zero = ip(t, [38.8, 39.6], [0, 1]);
        const split = ip(t, [40.8, 41.8], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center" }}>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 176, lineHeight: 0.9, textShadow: "0 0 30px rgba(10,11,14,0.95)" }}>{reps.toLocaleString()}</div>
              <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 24, letterSpacing: "0.14em", marginTop: 8 }}>AB REPS · 6 WEEKS · 5 DAYS A WEEK</div>
            </div>
            <div style={{ position: "absolute", left: 120, right: 120, top: 640, opacity: zero }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, color: INK, fontSize: 20, opacity: 0.7 }}><span>BODY FAT %</span><span>WAIST</span><span>SKINFOLD</span></div>
              <div style={{ display: "flex", gap: 18, marginTop: 12 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{ flex: 1, height: 22, borderRadius: 11, background: "#232d34" }}>
                    <div style={{ height: "100%", width: "100%", background: DIM, borderRadius: 11 }} />
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 96, textAlign: "center", marginTop: 26, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>NO CHANGE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1090, opacity: split }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 54 }}>LOADING BUILDS IT.</div>
              <div style={{ fontFamily: F.anton, color: CYAN, fontSize: 54, marginTop: 6 }}>A DEFICIT UNCOVERS IT.</div>
            </div>
            <Head big={"MISTAKE\nONE."} it="the reps were never the problem" itc={RED} />
            <Cite txt="VISPUTE ET AL. 2011, J STRENGTH COND RES · n=24 · 7 EXERCISES · DIET HELD CONSTANT" />
          </div>
        );
      })()}

      {/* ---------- MISTAKE TWO ---------- */}
      {t >= B.situp[0] && t < B.situp[1] + 0.3 && (() => {
        const o = win(t, B.situp);
        const n = Math.round(ip(t, [48.0, 51.4], [0, 3400]) / 50) * 50;
        const limit = ip(t, [51.8, 52.8], [0, 1]);
        const army = ip(t, [55.6, 56.6], [0, 1]);
        const pct = Math.round(ip(t, [57.4, 60.0], [0, 56]));
        const stamp = ip(t, [61.6, 62.2], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 300, opacity: 1 - army }}>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 120, lineHeight: 0.9, textShadow: `0 0 28px rgba(255,59,48,0.45)` }}>{n.toLocaleString()}</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, letterSpacing: "0.1em", opacity: 0.78 }}>NEWTONS THROUGH YOUR<br />LOWER SPINE · ONE REP</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1030, opacity: limit * (1 - army) }}>
              <div style={{ height: 3, background: RED, boxShadow: `0 0 16px ${RED}` }} />
              <div style={{ display: "inline-block", background: "rgba(10,11,14,0.88)", padding: "12px 20px", borderRadius: 8, marginTop: 12 }}>
                <div style={{ fontFamily: F.anton, color: "#FF6A5C", fontSize: 42 }}>WORKPLACE SAFETY ACTION LIMIT</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 20, opacity: 0.82, marginTop: 8, letterSpacing: "0.06em" }}>THE POINT WHERE EMPLOYERS MUST STEP IN</div>
              </div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center", opacity: army }}>
              <div style={{ fontFamily: F.mono, color: CYAN, fontSize: 24, letterSpacing: "0.2em" }}>1,500 SOLDIERS TRACKED</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 200, lineHeight: 0.92, marginTop: 14, textShadow: "0 0 32px rgba(10,11,14,0.95)" }}>{pct}%</div>
              <div style={{ fontFamily: F.mono, color: GOLD, fontSize: 24, letterSpacing: "0.12em", marginTop: 4 }}>OF FITNESS TEST INJURIES<br />TRACED TO THE SIT UP</div>
            </div>
            {stamp > 0 && (
              <div style={{ position: "absolute", left: 0, right: 0, top: 1090, textAlign: "center", transform: `scale(${2 - stamp})`, opacity: stamp }}>
                <span style={{ fontFamily: F.anton, color: RED, fontSize: 56, border: `6px solid ${RED}`, padding: "10px 26px", transform: "rotate(-5deg)", display: "inline-block", background: "rgba(10,11,14,0.7)" }}>NOT IN THE TEST ANY MORE</span>
              </div>
            )}
            <Head big={"MISTAKE\nTWO."} it="one rep, at the industrial limit" itc={RED} />
            <Cite txt="McGILL, CLIN BIOMECH (SIT-UP ≈3,300–3,500 N) · NIOSH ACTION LIMIT · EVANS ET AL. 2005, MILITARY MEDICINE" />
          </div>
        );
      })()}

      {/* ---------- THE SHUTDOWN ---------- */}
      {t >= B.multi[0] && t < B.multi[1] + 0.3 && (() => {
        const o = win(t, B.multi);
        const name = ip(t, [66.0, 67.0], [0, 1]);
        const gone = ip(t, [69.6, 70.6], [0, 1]);
        const bars = ip(t, [72.2, 75.4], [0, 1]);
        const honest = ip(t, [77.6, 78.6], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 56, top: 290, opacity: name * (1 - bars) }}>
              <div style={{ fontFamily: F.mono, color: "#E8907F", fontSize: 22, letterSpacing: "0.18em" }}>DEEP STABILISER</div>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 72, lineHeight: 1, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>MULTIFIDUS</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 20, opacity: 0.7, marginTop: 8 }}>SPANS 1 TO 3 VERTEBRAE</div>
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1060, opacity: gone * (1 - bars) }}>
              <div style={{ fontFamily: F.anton, color: RED, fontSize: 70, textShadow: "0 0 28px rgba(10,11,14,0.96)" }}>IT WASTES. AND STAYS OFF.</div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, opacity: 0.74, marginTop: 10, letterSpacing: "0.1em" }}>EVEN AFTER THE PAIN IS GONE</div>
            </div>
            <div style={{ position: "absolute", left: 110, right: 110, top: 300, opacity: bars }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 430 }}>
                {[["NO TRAINING", 84, RED], ["TRAINED", 30, GOLD]].map(([lab, v, c], i) => (
                  <div key={i} style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: F.anton, color: c as string, fontSize: 68 }}>{Math.round((v as number) * bars)}%</div>
                    <div style={{ width: 132, height: (v as number) * 3.2 * bars, background: c as string, borderRadius: 10, marginTop: 10, boxShadow: `0 0 22px ${c}` }} />
                    <div style={{ fontFamily: F.mono, color: INK, fontSize: 20, marginTop: 12, opacity: 0.8, letterSpacing: "0.08em" }}>{lab as string}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: F.mono, color: INK, fontSize: 21, textAlign: "center", opacity: 0.7, letterSpacing: "0.1em" }}>ONE YEAR RECURRENCE RATE</div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 1060, textAlign: "center", opacity: honest }}>
              <div style={{ display: "inline-block", border: `2px solid ${CYAN}`, borderRadius: 10, padding: "14px 26px", background: "rgba(10,11,14,0.72)" }}>
                <div style={{ fontFamily: F.anton, color: CYAN, fontSize: 48 }}>39 PEOPLE. ONE TRIAL.</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 22, opacity: 0.82, marginTop: 8, letterSpacing: "0.08em" }}>A SIGNAL, NOT A PROMISE</div>
              </div>
            </div>
            <Head big={"THE\nSHUTDOWN."} it="the muscle you never see is the one that quits" itc="#E8907F" />
            <Cite txt="HIDES, RICHARDSON & JULL, SPINE 1996 (ATROPHY) · HIDES, JULL & RICHARDSON, SPINE 2001 (RCT, n=39)" />
          </div>
        );
      })()}

      {/* ---------- THE GAP ---------- */}
      {t >= B.comp[0] && t < B.comp[1] + 0.3 && (() => {
        const o = win(t, B.comp);
        const bars = ip(t, [87.4, 90.0], [0, 1]);
        const flat = ip(t, [90.6, 91.6], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <svg viewBox="0 0 1080 620" style={{ position: "absolute", left: 0, top: 290, opacity: bars > 0 ? 1 : 0 }}>
              <line x1="120" y1="500" x2="960" y2="500" stroke="#3a3f45" strokeWidth={2} />
              <line x1="120" y1={500 - 350} x2="960" y2={500 - 350} stroke={DIM} strokeWidth={2} strokeDasharray="10 10" />
              <text x="960" y={500 - 362} textAnchor="end" fontFamily={F.mono} fontSize={24} fill={DIM}>100% OF MAXIMUM</text>
              <rect x="220" y={500 - 405 * bars} width="190" height={405 * bars} fill={CYAN} opacity={0.92} rx={9} />
              <text x="315" y="546" textAnchor="middle" fontFamily={F.mono} fontSize={26} fill={CYAN}>SPINAL ERECTORS</text>
              <rect x="672" y={500 - 78 * bars} width="190" height={78 * bars} fill={DIM} rx={9} />
              <text x="767" y="546" textAnchor="middle" fontFamily={F.mono} fontSize={26} fill={INK} opacity={0.75}>FRONT ABS</text>
            </svg>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1060, opacity: flat }}>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 56, lineHeight: 1.04, textShadow: "0 0 26px rgba(10,11,14,0.95)" }}>MORE WEIGHT DOES<br />NOT CHANGE THAT.</div>
            </div>
            <Head big={"THE GAP."} it="your compounds only cover the back half" itc={CYAN} />
            <Cite txt="HAMLYN, BEHM & YOUNG 2007 JSCR (SQUAT/DEADLIFT @80% 1RM) · NUZZO ET AL. 2008 JSCR" />
          </div>
        );
      })()}

      {/* ---------- THE ANATOMY ---------- */}
      {t >= B.gen[0] && t < B.gen[1] + 0.3 && (() => {
        const o = win(t, B.gen);
        const set = ip(t, [95.6, 96.6], [0, 1]);
        const rule = ip(t, [100.4, 101.4], [0, 1]);
        return (
          <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <div style={{ position: "absolute", left: 60, right: 60, top: 560, display: "flex", justifyContent: "space-between", opacity: set }}>
              <AbBlocks n={4} label="FOUR" pct="THE REST" />
              <AbBlocks n={6} label="SIX" pct="6 IN 10 PEOPLE" hero />
              <AbBlocks n={8} label="EIGHT" pct="2 IN 10 PEOPLE" />
            </div>
            <div style={{ position: "absolute", left: 56, right: 90, top: 1020, opacity: rule }}>
              <div style={{ borderTop: `1px solid ${DIM}`, borderBottom: `1px solid ${DIM}`, padding: "18px 0", background: "rgba(10,11,14,0.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 27 }}>
                  <span style={{ color: INK, opacity: 0.82 }}>HOW MANY</span><span style={{ color: DIM }}>BORN WITH IT</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 27, marginTop: 14 }}>
                  <span style={{ color: GOLD }}>HOW THICK</span><span style={{ color: GOLD }}>TRAINING</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 27, marginTop: 14 }}>
                  <span style={{ color: CYAN }}>WHETHER THEY SHOW</span><span style={{ color: CYAN }}>BODY FAT</span>
                </div>
              </div>
            </div>
            <Head big={"THE\nANATOMY."} it="count is inherited, thickness is earned" />
            <Cite txt="ANSON & McVAY CADAVER SERIES · TENDINOUS INTERSECTIONS: ~60% THREE · ~22% FOUR · ~15% TWO" />
          </div>
        );
      })()}

      {/* ---------- CTA ---------- */}
      {t >= B.cta[0] && (() => {
        const o = ip(t, [B.cta[0], B.cta[0] + 0.7], [0, 1]);
        const ask = ip(t, [110.8, 111.8], [0, 1]);
        const bio = ip(t, [112.4, 113.4], [0, 1]);
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,11,14,0.28) 0%, rgba(10,11,14,0.05) 24%, rgba(10,11,14,0.52) 58%, rgba(10,11,14,0.95) 84%)" }} />
            <div style={{ position: "absolute", left: 56, right: 80, bottom: 400 }}>
              <div style={{ fontFamily: F.anton, color: INK, fontSize: 86, lineHeight: 0.98 }}>TRAIN IT LIKE<br />A MUSCLE.</div>
              <div style={{ fontFamily: F.corm, fontStyle: "italic", color: GOLD, fontSize: 42, marginTop: 16 }}>load it. add weight. respect the only spine you get</div>
              <div style={{ fontFamily: F.anton, color: GOLD, fontSize: 66, marginTop: 30, textShadow: `0 0 26px ${GOLD2}`, opacity: ask }}>COMMENT 4, 6 OR 8 ⬇</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 26, opacity: bio }}>
                <div style={{ background: GOLD2, color: "#0A0B0E", fontFamily: F.anton, fontSize: 36, padding: "13px 28px", borderRadius: 12 }}>YOUR BODY SCAN — FREE</div>
                <div style={{ fontFamily: F.mono, color: INK, fontSize: 22, letterSpacing: "0.08em", opacity: 0.88 }}>LINK IN BIO ⬆</div>
              </div>
              <div style={{ marginTop: 22, fontFamily: F.mono, color: GOLD, fontSize: 20, letterSpacing: "0.12em", opacity: 0.9 * bio }}>MADDY · NASM-CPT · SPORTS NUTRITION</div>
            </div>
          </AbsoluteFill>
        );
      })()}
    </AbsoluteFill>
  );
};

// ============================== FILM ==============================
export const Core01: React.FC<{ mix?: string }> = ({ mix }) => {
  const spineReady = useSpine();
  const bodyReady = useBody();
  return (
    <AbsoluteFill style={{ background: "#0A0B0E" }}>
      {mix && <Audio src={staticFile(mix)} />}
      <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 1.9, 6.5], fov: 42 }}>
        <Rig />
        {spineReady && bodyReady && <Stage />}
        <EffectComposer disableNormalPass>
          <Bloom intensity={0.86} luminanceThreshold={0.40} luminanceSmoothing={0.3} mipmapBlur radius={0.72} />
          <Vignette darkness={0.64} offset={0.28} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 94% 84% at 50% 44%, transparent 50%, rgba(0,0,0,.70) 100%)", pointerEvents: "none" }} />
      <Overlay />
    </AbsoluteFill>
  );
};
export const calcCore01 = () => ({ durationInFrames: 3490, fps: 30, width: 1080, height: 1920 });

```


================================================================================
## FILE: workflows/research-gauntlet.js
================================================================================

```javascript
export const meta = {
  name: 'research-gauntlet',
  description: 'Six parallel cited-research agents for a DECODE episode: anatomy, stakes/protection, importance, mistakes, skip/myths, history',
  whenToUse: 'Strike 1 of every episode. args = {topic, briefs?} — briefs optionally overrides the six angle briefs.',
  phases: [{ title: 'Research' }],
}
const TOPIC = args?.topic
if (!TOPIC) throw new Error('args.topic required')
const ANGLES = args?.briefs || [
  { key: 'anatomy', name: `WHAT ${TOPIC} REALLY IS (anatomy/physiology)`, brief: 'The real structure and mechanism, named muscles/organs/systems, the landmark lab studies with numbers.' },
  { key: 'stakes', name: `PROTECTION AND STAKES — what goes wrong without it`, brief: 'Injury, disease and disability data; the strongest prospective/RCT evidence; global burden numbers.' },
  { key: 'importance', name: `IMPORTANCE AND PERFORMANCE — why it matters as much as anything else`, brief: 'Force transfer, performance meta-analyses, longevity/function links, trainability evidence (MRI/EMG).' },
  { key: 'mistakes', name: `MISTAKES PEOPLE MAKE`, brief: 'The controlled experiments that killed popular methods; injury data on common exercises; institutional reversals.' },
  { key: 'skip', name: `WHY PEOPLE SKIP IT + VISIBILITY MYTHS`, brief: 'The "X is enough" debates settled by data; genetics vs training splits; visibility thresholds.' },
  { key: 'history', name: `HISTORY`, brief: 'Who trained this before the word existed; when science arrived; the institutional turning points with dates.' },
]
const FACTS = { type: 'object', properties: {
  angle: { type: 'string' },
  facts: { type: 'array', items: { type: 'object', properties: {
    fact: { type: 'string', description: 'one precise, numeric-where-possible fact' },
    source: { type: 'string', description: 'author/org + year (+ journal); REAL sources only' },
    hook_potential: { type: 'number', description: '1-10 scroll-stopping power on a 2.1M fitness page' },
  }, required: ['fact', 'source', 'hook_potential'] } },
  best_one_liner: { type: 'string' },
}, required: ['angle', 'facts', 'best_one_liner'] }

phase('Research')
const out = await parallel(ANGLES.map(a => () =>
  agent(`Deep, citation-verified research for a world-class fitness-education video on ${TOPIC}. Your angle: ${a.name}.\n${a.brief}\nRules: 8-12 facts, each with a real citation (author + year + journal/org). Numbers over adjectives. If a claim is famous but shaky, say so in the fact. No invented sources — an uncertain citation must be marked "verify".`,
    { label: `research:${a.key}`, phase: 'Research', schema: FACTS, effort: 'high' })))
const ok = out.filter(Boolean)
log(`angles done: ${ok.length}/6`)
return ok

```


================================================================================
## FILE: workflows/script-gauntlet.js
================================================================================

```javascript
export const meta = {
  name: 'script-gauntlet',
  description: 'Four adversarial critics stress-test a reel script BEFORE VO and render (retention, facts, TTS-safety, brand)',
  whenToUse: 'Every DECODE episode: after the script draft, before generating any VO. args = {script, research, extra?}',
  phases: [{ title: 'Critique' }],
}

const SCRIPT = args?.script || ''
const RESEARCH = args?.research || '(no research pack provided — flag every uncited claim)'
const EXTRA = args?.extra || ''
if (!SCRIPT) throw new Error('args.script required — pass the numbered VO lines')

const CONTEXT = `PRODUCTION CONTEXT YOU MUST RESPECT:
- Instagram reel script for FitnessByMaddy (2.1M followers). Maddy is the coach, NASM-CPT, he/him always.
- Spoken by an ElevenLabs voice clone over a designed animation film (no talking head).
- HARD TTS RULES (violations have produced audible artifacts): NO em-dashes, NO ellipses, NO semicolons. Periods and commas only. Short sentences. The word "under" has been misheard as "on the" — avoid it. Avoid: calm, stress (bare), is talking, cant, high, under at critical spots.
- FBM brand: English only, secular, science-backed, anti-guru. No Hindi/Sanskrit/spiritual vocabulary and no medical claims, cures, or guaranteed results. ONE exception: a Maddy-approved Hindi word for this episode is allowed and must appear in Devanagari inline (TTS rule) — flag it only if it is missing Devanagari or was not declared in the extra context. Honestly bound thin evidence (state n, "a signal not a promise").
- One CTA voiced. Comment trigger must be a literal answer the viewer can type without translating.
- The previous shipped episode is the quality bar. ${EXTRA}`

phase('Critique')
const CRITIQUE = {
  type: 'object',
  properties: {
    critic: { type: 'string' },
    verdict: { type: 'string', description: 'SHIP_AS_IS or NEEDS_EDITS or MAJOR_REWRITE' },
    issues: { type: 'array', items: { type: 'object', properties: {
      line: { type: 'string' }, severity: { type: 'string', description: 'critical / major / minor' },
      problem: { type: 'string' }, fix: { type: 'string', description: 'exact replacement wording obeying TTS rules' },
    }, required: ['line', 'severity', 'problem', 'fix'] } },
    strongest_single_improvement: { type: 'string' },
  },
  required: ['critic', 'verdict', 'issues', 'strongest_single_improvement'],
}

const CRITICS = [
  { label: 'retention', prompt: 'You are a world-class short-form retention strategist (2M+ follower accounts). Adversarially critique PURELY for watch-time and virality: first-3s hook (setup-before-payoff = death), a drop-off map by line, dead zones (especially 12-40s), one fresh hook per 10-15s window, signpost bloat, abstraction failures, comment-trigger friction, competing CTAs, and whether the runtime is earned. Cite line numbers, propose concrete rewrites.' },
  { label: 'facts', prompt: 'You are a rigorous exercise-science fact checker. Audit EVERY factual claim against the research pack: overstatements, misattributions, post-hoc causation ("so they..."), ranges stated as flat values, absolutes where the finding is "no significant change", protocol details wrong (what exactly did the study do), sample sizes, and anything a knowledgeable rival could screenshot. For each: CLAIM -> what research supports -> VERDICT (accurate/overstated/needs qualifier/wrong) -> corrected wording. Flag anything readable as a medical claim.' },
  { label: 'tts-safety', prompt: 'You are a TTS + speech-recognition QA specialist for an ElevenLabs clone pipeline verified by Whisper. Find: banned punctuation, breath-risk sentences, known mishear words, ambiguous numbers, homophone collisions, tense breaks mid-sentence, dangling pronouns ("it" with wrong referent), unstressed line endings, jargon-as-verb. Quote, explain the failure mode, give exact replacements.' },
  { label: 'brand', prompt: 'You are the FitnessByMaddy brand and compliance gate. Line-by-line: forbidden vocabulary (Hindi/Sanskrit/spiritual), pronouns (he/him), medical/cure/guarantee claims, advice that belongs with a clinician, guru register ("truth", preacher lines), talking down, honesty of the CTA, and screenshot-ammunition. Also judge: does it sound like a coach who read the papers or a listicle? Give the single strongest authority-raising improvement.' },
]

const out = await parallel(CRITICS.map(c => () =>
  agent(`${c.prompt}\n\n=== SCRIPT ===\n${SCRIPT}\n\n=== RESEARCH ===\n${RESEARCH}\n\n=== CONTEXT ===\n${CONTEXT}`,
    { label: c.label, phase: 'Critique', schema: CRITIQUE, effort: 'high' })))

const ok = out.filter(Boolean)
log(`critics: ${ok.map(r => r.verdict).join(' · ')}`)
return ok

```


================================================================================
## FILE: workflows/fresh-eyes-audit.js
================================================================================

```javascript
export const meta = {
  name: 'fresh-eyes-audit',
  description: 'Independent creative-director + compliance audit of a FINISHED reel from contact sheets + transcript (the builder is biased — these agents are not)',
  whenToUse: 'After final render + qc_sweep.sh. args = {video, sheets_dir, transcript, extra?}. Run BEFORE delivering to Maddy.',
  phases: [{ title: 'Audit' }],
}

const V = args?.video, SD = args?.sheets_dir, TR = args?.transcript || ''
if (!V || !SD) throw new Error('args.video and args.sheets_dir required')

phase('Audit')
const brief = (role) => `${role}

THE FILM: a DECODE-series designed-animation reel for FitnessByMaddy (2.1M, science-based, NASM-credible, anti-guru).
VIEW the timestamped contact sheets in ${SD} (Read tool, files sheet*.png; timestamps burned top-left).
Pull at least 3 full-res frames yourself for anything you want to judge properly:
  ffmpeg -y -ss <t> -i "${V}" -frames:v 1 /tmp/f.png   (then Read /tmp/f.png)

NARRATION WITH TIMINGS:
${TR}

${args?.extra || ''}
Be adversarial and specific — timestamps on every finding. Do not flatter. End with: SCORE /10 (5=average edited fitness reel, 7=strong branded content, 9=best-in-class science reel), your 3 highest-impact improvements, and a verdict line: SHIP AS IS / SHIP WITH TWEAKS / REBUILD.`

const out = await parallel([
  () => agent(brief(`You are a world-class short-form creative director (Cleo Abram / Johnny Harris tier). Audit: HOOK latency (does a motion payoff land in the first 3s?), visual craft (best/worst frames), clarity at every beat, pacing and dead stretches, retention-risk timestamps, CTA setup (does the viewer know exactly what to type, and does the comment ask visually dominate the funnel pill?), and anything broken/misaligned/illegible/amateur.`),
    { label: 'creative-director', phase: 'Audit', effort: 'high' }),
  () => agent(brief(`You are the brand + claims compliance auditor. Check every on-screen text in the sheets: forbidden vocabulary (Hindi/Sanskrit/spiritual/the word "AI"), pronouns, medical or guaranteed-result claims, citation presence on every stat, NASM credential presence, honest bounding of thin evidence, Instagram safe zones (nothing critical in the bottom ~330px or over the top-left username area), typos, and number consistency between narration and on-screen figures.`),
    { label: 'compliance', phase: 'Audit', effort: 'high' }),
])
return out.filter(Boolean)

```


================================================================================
## FILE: example-episode/segments.json
================================================================================

```json
{
 "segments": [
  {
   "id": "m00",
   "text": "Here is what we cover in this video. The savings. The engine. The death predictor. The grey zone. The gains myth. For lifters. And finally, the protocol.",
   "stability": 0.52,
   "speed": 0.95
  },
  {
   "id": "m01",
   "text": "Ten and a half million.",
   "stability": 0.5,
   "speed": 0.92
  },
  {
   "id": "m02",
   "text": "That is roughly how many beats your heart saves each year, if training drops your resting heart rate from seventy to fifty.",
   "stability": 0.52,
   "speed": 0.94
  },
  {
   "id": "m03",
   "text": "Same life. Less work. Here is how you get it.",
   "stability": 0.5,
   "speed": 0.92
  },
  {
   "id": "m04",
   "text": "Your heart is an engine. Almost nobody trains it on purpose.",
   "stability": 0.54,
   "speed": 0.94
  },
  {
   "id": "m05",
   "text": "Train it long enough and its chambers stretch. In elite endurance athletes, the main chamber holds sixty to eighty percent more blood.",
   "stability": 0.58,
   "speed": 0.95
  },
  {
   "id": "m06",
   "text": "More blood per beat, fewer beats for the same job. Elite cyclists wake up at thirty beats a minute.",
   "stability": 0.56,
   "speed": 0.95
  },
  {
   "id": "m07",
   "text": "The Cleveland Clinic tested more than one hundred and twenty thousand people. Being unfit predicted death about as strongly as smoking.",
   "stability": 0.58,
   "speed": 0.94
  },
  {
   "id": "m08",
   "text": "And the curve never flattened. The fittest had one fifth the risk of the least fit. No ceiling in the data.",
   "stability": 0.56,
   "speed": 0.93
  },
  {
   "id": "m09",
   "text": "But almost everyone trains this wrong. Probably you too.",
   "stability": 0.52,
   "speed": 0.93
  },
  {
   "id": "m10",
   "text": "Every run becomes a race. Track real runners and the easy days creep harder. The hard days go soft. Everything lands in the grey middle.",
   "stability": 0.55,
   "speed": 0.95
  },
  {
   "id": "m11",
   "text": "And once you are trained, that middle zone builds almost nothing. One nine week trial could not measurably grow the engine.",
   "stability": 0.56,
   "speed": 0.95
  },
  {
   "id": "m12",
   "text": "The fix is old. The best endurance athletes on Earth go easy about eighty percent of the time. Truly easy. Full sentences easy.",
   "stability": 0.54,
   "speed": 0.94
  },
  {
   "id": "m13",
   "text": "The other twenty percent, properly hard. In trained adults, intervals of four minutes near max grew the engine seven percent in eight weeks.",
   "stability": 0.56,
   "speed": 0.95
  },
  {
   "id": "m14",
   "text": "Lifters, stay with me. Cardio does not kill your gains.",
   "stability": 0.52,
   "speed": 0.93
  },
  {
   "id": "m15",
   "text": "That fear comes from one study in nineteen eighty. People lifted heavy and piled brutal cardio on top, six days a week.",
   "stability": 0.55,
   "speed": 0.95
  },
  {
   "id": "m16",
   "text": "Forty three modern studies, pooled in twenty twenty two. Muscle difference from adding cardio, zero.",
   "stability": 0.54,
   "speed": 0.93
  },
  {
   "id": "m17",
   "text": "One rule though. Keep hard cardio and heavy lifting hours apart. And if you are chasing size, the bike is the safer pick.",
   "stability": 0.55,
   "speed": 0.95
  },
  {
   "id": "m18",
   "text": "Here is what lifters miss. Your rest between sets is aerobic. A fitter heart refills your strength faster.",
   "stability": 0.56,
   "speed": 0.94
  },
  {
   "id": "m19",
   "text": "Lifelong endurance compounds. Seventy five year olds who never quit had hearts testing like typical forty five year olds.",
   "stability": 0.58,
   "speed": 0.94
  },
  {
   "id": "m20",
   "text": "The protocol. Two or three easy sessions a week, conversation pace.",
   "stability": 0.52,
   "speed": 0.93
  },
  {
   "id": "m21",
   "text": "One hard day. Intervals. Earn it.",
   "stability": 0.5,
   "speed": 0.92
  },
  {
   "id": "m22",
   "text": "Your heart will beat about three billion times. Train it, and every beat costs less.",
   "stability": 0.52,
   "speed": 0.92
  },
  {
   "id": "m23",
   "text": "Comment your resting heart rate. The number your watch shows this morning.",
   "stability": 0.5,
   "speed": 0.92
  }
 ],
 "gaps": {
  "m01": 0.6,
  "m02": 0.45,
  "m03": 0.75,
  "m04": 0.4,
  "m05": 0.4,
  "m06": 0.75,
  "m07": 0.45,
  "m08": 0.75,
  "m09": 0.4,
  "m10": 0.4,
  "m11": 0.45,
  "m12": 0.4,
  "m13": 0.75,
  "m14": 0.4,
  "m15": 0.35,
  "m16": 0.45,
  "m17": 0.4,
  "m18": 0.45,
  "m19": 0.75,
  "m20": 0.35,
  "m21": 0.6,
  "m22": 0.55,
  "m23": 0.0,
  "m00": 0.75
 },
 "lead": 0.4,
 "tail": 3.5,
 "fps": 30
}
```


================================================================================
## FILE: example-episode/bed_endurance.py
================================================================================

```python
import sys, json, numpy as np
sys.path.insert(0, "/Users/mandeepjakhar/fbm-video-studio/OpenMontage/remotion-composer/tools/engine")
from bedlib import Bed, SR

T = json.load(open("timeline.json"))
S = {k: v[0] for k, v in T["seg"].items()}
DUR = T["total"]
b = Bed(DUR)
b.drone()
# beat sections
b.tone(82.41, 0.045, 0.85, S["m04"] + 0.6)                      # hook tension E2
b.pad([174.61, 220.0, 261.63], 0.026, S["m04"], S["m07"] + 0.4) # engine warmth F
b.tone(97.999, 0.040, S["m07"], S["m09"] + 0.5)                 # study seriousness G2
b.tone(146.83, 0.026, S["m09"], S["m14"] + 0.4)                 # mistake clinical D3
b.tone(110.0, 0.036, S["m14"], S["m18"] + 0.4)                  # myth driving A2
b.pad([130.81, 164.81, 196.0], 0.026, S["m18"], S["m20"] + 0.5) # lifters build C
b.pad([174.61, 261.63, 349.23, 523.25], [0.038, 0.028, 0.018, 0.011][0], S["m20"], DUR)
for f, a in [(261.63, 0.028), (349.23, 0.018), (523.25, 0.011)]:
    b.tone(f, a, S["m20"], DUR, detune=0.4, rise=1.4, fall=2.6)
# THE HEARTBEAT — variable rate 70→50, phase-continuous (the film uses the same keys)
PRE = S["m01"] - 0.85
KT = [0.0, 8.0 + PRE, 30.0 + PRE, 55.0 + PRE, 85.0 + PRE, 108.0 + PRE, 122.3 + PRE, DUR]
KV = [70.0, 70.0, 64.0, 58.0, 54.0, 52.0, 50.0, 50.0]
def rate(t):
    for i in range(1, len(KT)):
        if t <= KT[i]:
            u = (t - KT[i-1]) / (KT[i] - KT[i-1])
            return KV[i-1] + (KV[i] - KV[i-1]) * u
    return KV[-1]
t = 0.40
while t < DUR - 4.2:
    per = 60.0 / rate(t)
    for off, amp in ((0.0, 0.11), (0.28, 0.068)):
        st = t + off
        i = int(st * SR); L = int(0.16 * SR)
        if i + L < b.n:
            d = np.exp(-np.linspace(0, 9, L))
            b.out[i:i+L] += amp * d * np.sin(2 * np.pi * 47 * np.arange(L) / SR)
    t += per
# impacts on beat turns + risers into reveals
for sid, amp, f0 in [("m01",0.30,52),("m04",0.28,46),("m07",0.30,44),("m12",0.26,50),("m14",0.26,46),("m19",0.24,50),("m22",0.30,60)]:
    b.impact(S[sid] + 0.05, amp, f0)
for sid in ["m07", "m12", "m22"]:
    b.riser(S[sid] - 1.45, 1.4, 0.09)
# ticks under the big counters (hook number + study n)
b.ticks(S["m02"], S["m02"] + 3.4)
b.ticks(S["m07"], S["m07"] + 2.6)
b.write("bed.wav")

```


================================================================================
## FILE: example-episode/timeline.json
================================================================================

```json
{
 "seg": {
  "m00": [
   0.4,
   8.501
  ],
  "m01": [
   9.251,
   10.623
  ],
  "m02": [
   11.223,
   17.021
  ],
  "m03": [
   17.471,
   19.973
  ],
  "m04": [
   20.723,
   23.633
  ],
  "m05": [
   24.033,
   31.068
  ],
  "m06": [
   31.468,
   36.386
  ],
  "m07": [
   37.136,
   44.213
  ],
  "m08": [
   44.663,
   50.967
  ],
  "m09": [
   51.717,
   54.584
  ],
  "m10": [
   54.984,
   63.183
  ],
  "m11": [
   63.583,
   69.37
  ],
  "m12": [
   69.82,
   76.367
  ],
  "m13": [
   76.767,
   84.697
  ],
  "m14": [
   85.447,
   88.403
  ],
  "m15": [
   88.803,
   94.756
  ],
  "m16": [
   95.106,
   100.856
  ],
  "m17": [
   101.306,
   107.325
  ],
  "m18": [
   107.725,
   112.941
  ],
  "m19": [
   113.391,
   119.499
  ],
  "m20": [
   120.249,
   123.612
  ],
  "m21": [
   123.962,
   126.073
  ],
  "m22": [
   126.673,
   130.194
  ],
  "m23": [
   130.744,
   134.445
  ]
 },
 "total": 137.945,
 "fps": 30,
 "frames": 4138
}
```


================================================================================
## FILE: docs/dependencies.json
================================================================================

```json
{
 "dependencies": {
  "@react-three/fiber": "^8.18.0",
  "@react-three/postprocessing": "^2.19.1",
  "@remotion/captions": "^4.0.484",
  "@remotion/cli": "^4.0.484",
  "@remotion/google-fonts": "^4.0.484",
  "@remotion/media": "^4.0.484",
  "@remotion/player": "^4.0.484",
  "@remotion/three": "^4.0.522",
  "@remotion/transitions": "^4.0.484",
  "d3-geo": "^3.1.1",
  "postprocessing": "^6.39.4",
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "remotion": "^4.0.484",
  "three": "^0.169.0",
  "topojson-client": "^3.1.0",
  "world-atlas": "^2.0.2"
 },
 "devDependencies": {
  "@types/react": "^18.2.0",
  "typescript": "^5.3.0"
 }
}
```


================================================================================
## FILE: docs/root-registration-example.txt
================================================================================

import { Endurance01, calcEndurance01 } from "./fbm/films/mbmm/Endurance01";
      <Composition id="FBM-ENDURANCE-01" component={Endurance01} durationInFrames={4138} fps={30} width={1080} height={1920} defaultProps={{ mix: "fbm/mbmm/endurance.m4a" }} calculateMetadata={calcEndurance01} />

