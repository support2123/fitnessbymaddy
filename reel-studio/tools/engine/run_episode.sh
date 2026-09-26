#!/usr/bin/env zsh
# FBM REEL STUDIO · one-episode portable production orchestrator.
# Usage: zsh tools/engine/run_episode.sh <episode_dir> <film_module.py> [--scratch]
# This command intentionally stops before human Fresh Eyes and social upload.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EP="$ROOT/$1"
FILM="$ROOT/$2"
MODE="${3:-}"
PY=python3
cd "$ROOT"

echo "── 1/10 VO ───────────────────────────────────────────"
if [ "$MODE" = "--scratch" ]; then
  $PY tools/engine/gen_vo_scratch.py "$EP"
else
  $PY tools/engine/gen_vo_lib.py "$EP"
fi

echo "── 2/10 VO HARD GATE ──────────────────────────────────"
$PY tools/engine/verify_vo.py "$EP"

echo "── 3/10 TIMELINE, AUDIO LEADS ─────────────────────────"
$PY tools/engine/assemble_vo.py "$EP"

echo "── 4/10 SCORE, ONE CLOCK ──────────────────────────────"
(cd "$EP" && PYTHONPATH="$ROOT/tools/engine" $PY bed_*.py)

echo "── 5/10 MANUAL TIMELINE DUCK + 48 kHz MASTER ──────────"
$PY tools/engine/mix_master.py "$EP"

echo "── 6/10 FILM, HERO FROM FRAME ZERO ────────────────────"
$PY tools/engine/render_film.py "$EP" "$FILM" "$EP/film.mp4"

echo "── 7/10 REMUX, ONE LOSSY VIDEO ENCODE ONLY ────────────"
$PY tools/engine/mux_av.py "$EP/film.mp4" "$EP/mix.m4a" "$EP/reel.mp4"

echo "── 8/10 QC SWEEP ──────────────────────────────────────"
$PY tools/engine/qc_sweep.py "$EP/reel.mp4" "$EP/qc"

echo "── 9/10 BRAND GATE ────────────────────────────────────"
$PY tools/engine/brand_gate.py "$EP"

echo "── 10/10 STERILE PUBLISH MASTER ───────────────────────"
NAME="$(basename "$EP")-PUBLISH.mp4"
$PY tools/engine/publish_ig.py "$EP/reel.mp4" "$EP/$NAME"
echo "TECHNICAL PIPELINE DONE → $EP/$NAME"
echo "NEXT REQUIRED: inspect all sheets, complete Fresh Eyes >= 8.5, fill production-manifest.json, then run tools/ops/preflight.py."
