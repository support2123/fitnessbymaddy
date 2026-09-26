# episodes/WATER-01 — DECODE · EP 06 · "The Tax"

The fluid flagship. 121.14 s vertical reel, 1080×1920 @ 30 fps, one CTA, one clock.
**Shipped cut: Hindi narration, English on-screen text.** The English-narration cut is archived
(`WATER-01-EN-VIEW.mp4`, `segments-en.json`, `mix-en.m4a`).

## What ships

| file | what it is |
|---|---|
| `WATER-01-PUBLISH.mp4` | the delivery master — 66,613,719 B · 121.17 s · 3635 f · h264 1080×1920 · 30 fps · AAC 44.1 kHz stereo · −14.0 LUFS / LRA 2.0 / TPK −1.2 dBTP · decode clean · sterile PASS |
| `cover.png` | Instagram feed cover, 1080×1350 |
| `cover-story.png` | story / Reels cover, 1080×1920 |
| `SCRIPT-FINAL.md` | script, timeline map, 4-pass gauntlet, citation binding |
| `CAPTION.md` | feed caption, pinned comment, hashtags, publish checklist |
| `FACT-CHECK.md` | claim-by-claim proof table: 18 claims → locked citations, tiers, honest bounds, defect log |
| `FRESH-EYES-AUDIT.md` | the outsider read, score and ship call |
| `previews/` | 6 boundary frames — what the film looks like, kept as a small visual record |
| `qc/` | QC contact sheets + frame grabs (kept for the archive) |

## How it was made (one pass, in order)

```sh
# 1a · Hindi voice: takes live in vo_hi/, then the SAME locked chain + per-beat pacing fit
cd episodes/WATER-01
PYTHONPATH=../../tools/engine python3 ../../tools/engine/chain_vo.py . vo_hi --fit-cap 1.28
# 1b · English scratch voice (offline fallback / EN archive)
python3 ../../tools/engine/gen_vo_scratch.py .
python3 ../../tools/engine/verify_vo.py .        # duration + lint
python3 ../../tools/engine/assemble_vo.py .      # -> vo.wav, durs.json, timeline.json

# 2 · score (imports the film's pulse() — one clock for picture and sound)
PYTHONPATH=<repo>/tools/engine python3 bed_water.py

# 3 · mix  (-14.0 LUFS, TP target -1.3 so the AAC master lands <= -1.0 dBTP)
python3 ../../tools/engine/mix_master.py .

# 4 · picture — preview every beat boundary FIRST, then render
PYTHONPATH=tools/engine python3 tools/engine/render_film.py episodes/WATER-01 \
        episodes/WATER-01/film_water.py /tmp/p.png --preview 34.0
PYTHONPATH=tools/engine python3 tools/engine/render_film.py episodes/WATER-01 \
        episodes/WATER-01/film_water.py render.mp4

# 5 · finish
python3 tools/engine/mux_av.py render.mp4 mix.m4a reel.mp4
ffmpeg -i reel.mp4 -c:v libx264 -crf 20 -r 30 -c:a copy reel-delivery.mp4
python3 tools/engine/qc_sweep.py reel-delivery.mp4 qc/
python3 tools/engine/publish_ig.py reel-delivery.mp4 WATER-01-PUBLISH.mp4
python3 tools/engine/make_cover.py . --hero drop_crown --word WATER --ep "DECODE · EP 06" \
        --hook "YOU ONLY HOLD FIVE." --sub "THE WATER TAX YOUR HEART PAYS"
```

Orchestrated: `zsh tools/engine/run_episode.sh episodes/WATER-01 episodes/WATER-01/film_water.py --scratch`

## Two masters (why)

| master | where | size | use |
|---|---|---|---|
| `WATER-01-INSTA-MASTER.mp4` | `~/.cache/serve-water/` (served, not snapshotted) | 192.8 MB · **13.35 Mbps** | Instagram / YouTube upload — single crf15/slow encode, audio copied bit-for-bit, sterile |
| `WATER-01-PUBLISH.mp4` | this folder | 63.5 MB · 4.4 Mbps | compact master that stays in the repo (repo budget is ~128 MB) |

The high-quality master is produced with ONE lossy encode, then only stream-copies:
render (crf15, preset slow) → mux the shipped AAC track with `-c copy` → `publish_ig.py` strips
metadata with `-c copy`. Regenerate:

```sh
FBM_RENDER_CRF=15 FBM_RENDER_PRESET=slow PYTHONPATH=tools/engine \
  python3 tools/engine/render_film.py episodes/WATER-01 episodes/WATER-01/film_water.py /tmp/hq.mp4
ffmpeg -i episodes/WATER-01/WATER-01-PUBLISH.mp4 -vn -c:a copy /tmp/a.m4a
ffmpeg -i /tmp/hq.mp4 -i /tmp/a.m4a -map 0:v -map 1:a -c copy -movflags +faststart /tmp/raw.mp4
python3 tools/engine/publish_ig.py /tmp/raw.mp4 ~/.cache/serve-water/WATER-01-INSTA-MASTER.mp4
```

## Watch + download server

```sh
python3 tools/engine/serve_episode.py ~/.cache/serve-water 8000
```
One page: the best MP4 streams in a player at the top, and directly under it are **direct MP4
download buttons** (`?dl=1` → `Content-Disposition: attachment`). Range requests are supported, so
a dropped download resumes. No HTML is ever handed out as a "download".

## Voice

Shipped on the scratch voice with the full Hollywood post-chain (highpass → presence 3.2 kHz →
air 8.5/11 kHz → compressor → de-esser → short plate → limiter). A cloned voice drops in with
`tools/engine/swap_voice.sh episodes/WATER-01` the moment a key, a voice id and a sample exist —
it re-runs voice → timeline → score → mix → QC and refuses to run without them.

## Rebuild history

Rebuilt twice on 24 Sep 2026, both times because a workspace restore dropped the previous
binaries while keeping `qc/`. The sources are text and cheap; the render is not (~28 min). Since
the rebuild the folder also keeps `previews/` so the look survives even if the video does not.

Five defects were caught by the boundary preview pass and fixed in the engine:

1. `stat_stamp` aligned labels on `anchor.endswith()` — off-frame for right/centre stamps. Now `anchor[0]`.
2. a single top-level overlay opacity zeroed every cite chip and the pulse HUD from beat 2 onward. Now per-beat.
3. m07's protocol rows sat under the headline block. Rows now start at 700, receipt stamp at 1120.
4. m03's ECG trace crossed its own stat label. Trace moved to y 900, with the subtitle line below it.
5. `binpaths.probe()` returned raw stderr on ffmpeg-only boxes (broke duration parsing and the
   h264-only publish guard). It now answers duration, codec and tag queries in kind.

Plus the mix's true-peak target moved to −1.3 dBTP so the AAC-encoded master lands at or below the
sealed −1.0 dBTP rule. Details in `docs/LESSONS-LOG.md`.
