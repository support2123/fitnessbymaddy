#!/usr/bin/env zsh
# FBM REEL STUDIO · doctrine-locked live-motion production orchestrator.
# Usage: zsh tools/engine/run_episode.sh <episode_dir> <film_module.py> [--scratch]
# This command intentionally stops before human Fresh Eyes and social upload.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EP="$ROOT/$1"
FILM="$ROOT/$2"
MODE="${3:-}"
PY=python3
cd "$ROOT"

echo "── 1/12 VO ───────────────────────────────────────────"
if [ "$MODE" = "--scratch" ]; then
  $PY tools/engine/gen_vo_scratch.py "$EP"
else
  $PY tools/engine/gen_vo_lib.py "$EP"
fi

echo "── 2/12 VO HARD GATE ──────────────────────────────────"
$PY tools/engine/verify_vo.py "$EP"

echo "── 3/12 TIMELINE, AUDIO LEADS ─────────────────────────"
$PY tools/engine/assemble_vo.py "$EP"

echo "── 4/12 LIVE ASSET PLAN ───────────────────────────────"
# First run writes the brief; it never silently invents or substitutes B-roll.
$PY tools/engine/motion_manifest.py "$EP" plan

echo "── 5/12 LIVE ASSET HARD GATE ───────────────────────────"
# Requires a selected MP4 for every beat. Missing motion stops before score/film.
$PY tools/engine/motion_manifest.py "$EP" validate --strict
$PY tools/engine/motion_qc.py "$EP"

echo "── 6/12 SCORE, ONE CLOCK ──────────────────────────────"
(cd "$EP" && PYTHONPATH="$ROOT/tools/engine" $PY bed_*.py)

echo "── 7/12 MANUAL TIMELINE DUCK + 48 kHz MASTER ──────────"
$PY tools/engine/mix_master.py "$EP"

echo "── 8/12 FILM, LIVE CLIPS + KINETIC TYPE ───────────────"
$PY tools/engine/render_film.py "$EP" "$FILM" "$EP/film.mp4"

echo "── 9/12 REMUX, ONE LOSSY VIDEO ENCODE ONLY ────────────"
$PY tools/engine/mux_av.py "$EP/film.mp4" "$EP/mix.m4a" "$EP/reel.mp4"

echo "── 10/12 TECHNICAL QC SWEEP ───────────────────────────"
$PY tools/engine/qc_sweep.py "$EP/reel.mp4" "$EP/qc"

echo "── 11/12 BRAND GATE ───────────────────────────────────"
$PY tools/engine/brand_gate.py "$EP"

echo "── 12/12 STERILE PUBLISH MASTER ───────────────────────"
NAME="$(basename "$EP")-PUBLISH.mp4"
$PY tools/engine/publish_ig.py "$EP/reel.mp4" "$EP/$NAME"
echo "TECHNICAL PIPELINE DONE → $EP/$NAME"
echo "NEXT REQUIRED: inspect all sheets, complete Fresh Eyes >= 8.5, record MOTION-QC PASS in production-manifest.json, then run tools/ops/preflight.py."
