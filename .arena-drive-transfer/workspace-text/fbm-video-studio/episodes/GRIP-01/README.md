# EP-05 · GRIP · "The Squeeze"

| | |
|---|---|
| Series | DECODE · EP 05 |
| Runtime | 71.83 s · 1080×1920 · 30 fps · 2151 frames |
| Hook | "Your grip predicts death better than your blood pressure does." (Leong 2015, The Lancet — PURE, 139,691 adults, 17 countries) |
| Beats | contents → predictor → study (16% slam) → why the hand → honesty → the 30-second test → the number → the fix → CTA |
| Loudness | −14.0 LUFS integrated · −1.0 dBTP (verified) |
| Sterile gate | PASS (zero tool/AI markers) |
| Fresh-eyes score | 8.1/10 — SHIP WITH TWEAKS (both fixes applied before delivery) |

## Files
- `GRIP-01-PUBLISH.mp4` — **the delivered reel** (sterile)
- `reel-delivery.mp4` — pre-publish master · `film.mp4` — silent film · `mix.m4a` — final audio
- `cover.png` (1080×1350 feed) · `cover-story.png` (1080×1920)
- `CAPTION.md` — caption + pinned comment + seeds + reply template + posting checklist
- `SCRIPT-FINAL.md` — locked script + full gauntlet record (every critic finding + fix)
- `FRESH-EYES-AUDIT.md` — independent audit, scores, sync spot-checks
- `timeline.json` — the measured VO-led windows the film is built on
- `film_grip.py` · `bed_grip.py` · `segments.json` — the episode's source

## Rebuild
```bash
zsh tools/engine/run_episode.sh episodes/GRIP-01 episodes/GRIP-01/film_grip.py --scratch
# real voice instead of the scratch placeholder:
export ELEVENLABS_API_KEY=... FBM_VOICE_ID=...
python3 tools/engine/gen_vo_lib.py episodes/GRIP-01   # then re-run strikes 4-9
```
⚠️ The delivered MP4 carries a **scratch narration** (offline voice) — see the honesty note in
`FRESH-EYES-AUDIT.md`. The edit is fully VO-led: regenerating the clone rebuilds the timeline
and the film re-renders against the new measured times, with no design change.
