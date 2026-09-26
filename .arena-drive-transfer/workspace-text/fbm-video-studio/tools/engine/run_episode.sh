#!/usr/bin/env zsh
# FBM ENGINE · one-episode orchestrator (portable port of the per-episode run).
# usage: zsh tools/engine/run_episode.sh <episode_dir> <film_module.py> [--scratch]
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EP="$ROOT/$1"; FILM="$ROOT/$2"; SCRATCH="${3:-}"
PY=python3
cd "$ROOT"

echo "── 1/9 VO ─────────────────────────────────────────────"
if [ "$SCRATCH" = "--scratch" ]; then
  $PY tools/engine/gen_vo_scratch.py "$EP"
else
  $PY tools/engine/gen_vo_lib.py "$EP"
fi

echo "── 2/9 VO HARD GATE (whisper + artifact scan) ──────────"
$PY tools/engine/verify_vo.py "$EP" || echo "!! gate flagged — eye-read the lines above"

echo "── 3/9 TIMELINE (VO-led) ──────────────────────────────"
$PY tools/engine/assemble_vo.py "$EP"

echo "── 4/9 SCORE (bed recipe reads timeline.json) ─────────"
(cd "$EP" && PYTHONPATH="$ROOT/tools/engine" $PY bed_*.py)

echo "── 5/9 MIX + MASTER (-14 LUFS) ────────────────────────"
$PY tools/engine/mix_master.py "$EP"

echo "── 6/9 FILM RENDER ────────────────────────────────────"
$PY tools/engine/render_film.py "$EP" "$FILM" "$EP/film.mp4"

echo "── 7/9 MUX ────────────────────────────────────────────"
$PY tools/engine/mux_av.py "$EP/film.mp4" "$EP/mix.m4a" "$EP/reel.mp4"

echo "── 8/10 DELIVERY PASS (crf20 · pinned 30 fps) ─────────"
# concat/re-encode steps can drift the container to 29.97 — pin the rate here
$PY - "$EP" <<'PYEOF'
import subprocess, sys, os
sys.path.insert(0, "tools/engine"); import binpaths
ep = sys.argv[1]
subprocess.run([binpaths.ffmpeg(), "-y", "-v", "error", "-i", f"{ep}/reel.mp4",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
                "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
                f"{ep}/reel-delivery.mp4"], check=True)
PYEOF

echo "── 9/10 QC SWEEP ──────────────────────────────────────"
$PY tools/engine/qc_sweep.py "$EP/reel-delivery.mp4" "$EP/qc"

echo "── 10/10 PUBLISH (sterile gate) ───────────────────────"
NAME="$(basename "$EP")-PUBLISH.mp4"
$PY tools/engine/publish_ig.py "$EP/reel-delivery.mp4" "$EP/$NAME"
echo "DONE → $EP/$NAME"
