#!/usr/bin/env bash
# FBM ENGINE · swap the cloned voice in (or out) of a finished episode.
#
# usage:  zsh tools/engine/swap_voice.sh <episode_dir> [film_module.py]
# e.g.    zsh tools/engine/swap_voice.sh episodes/WATER-01 episodes/WATER-01/film_water.py
#
# WHY THIS EXISTS
#   EP-05 and EP-06 were built on the offline scratch voice (piper) because no
#   ELEVENLABS_API_KEY / FBM_VOICE_ID existed on the machine. The film, score, QC
#   and publish chains are all voice-agnostic — only the audio spine changes. This
#   script re-runs exactly the audio-dependent steps, in order, and stops on the
#   first failure so a half-swapped episode can never be published.
#
# PROVIDE THE KEY (never commit it):
#   export ELEVENLABS_API_KEY=...        # or write it into ~/.fbm.env
#   export FBM_VOICE_ID=...              # or write it into <episode_dir>/voice.txt
set -euo pipefail

EP="${1:?usage: swap_voice.sh <episode_dir> [film_module.py]}"
FILM="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -z "${ELEVENLABS_API_KEY:-}" ] && ! grep -qs ELEVENLABS_API_KEY "$HOME/.fbm.env"; then
  echo "BLOCKED: no ELEVENLABS_API_KEY (env or ~/.fbm.env). The clone cannot be rendered without it." >&2
  echo "         Once it exists, re-run this exact command — nothing else needs to change." >&2
  exit 2
fi
if [ -z "${FBM_VOICE_ID:-}" ] && [ ! -f "$EP/voice.txt" ]; then
  echo "BLOCKED: no FBM_VOICE_ID (env or $EP/voice.txt)." >&2
  exit 2
fi

echo "== 1/6 VOICE · clone render + clean chain (voice v2) =="
python3 tools/engine/gen_vo_lib.py "$EP"

echo "== 2/6 GATE · verify_vo (orphan audio <= 0.30 s, number eye-read) =="
python3 tools/engine/verify_vo.py "$EP"

echo "== 3/6 TIMELINE · assemble_vo (audio leads, visuals follow) =="
python3 tools/engine/assemble_vo.py "$EP"

echo "== 4/6 SCORE · bed (one clock, re-derived from the new timeline) =="
( cd "$EP" && PYTHONPATH="$ROOT/tools/engine" python3 bed_$(basename "$EP" | cut -d- -f1 | tr 'A-Z' 'a-z').py )

echo "== 5/6 MIX · -14.0 LUFS / -1.0 dBTP =="
python3 tools/engine/mix_master.py "$EP"

if [ -n "$FILM" ]; then
  echo "== 6/6 FILM · full re-render (beat windows moved with the VO) + mux + QC =="
  PYTHONPATH=tools/engine python3 tools/engine/render_film.py "$EP" "$FILM" "$EP/film.mp4"
  python3 tools/engine/mux_av.py "$EP/film.mp4" "$EP/mix.m4a" "$EP/reel.mp4"
  python3 tools/engine/qc_sweep.py "$EP/reel.mp4" "$EP/qc"
  echo "-- remember: publish_ig.py <reel> <episode>-PUBLISH.mp4, then look at every sheet --"
else
  echo "== 6/6 FILM · skipped (pass the film module path to re-render) =="
fi
echo "DONE — the episode now carries the cloned voice."
