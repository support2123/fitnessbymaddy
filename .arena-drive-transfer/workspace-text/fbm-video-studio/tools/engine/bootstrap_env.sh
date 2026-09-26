#!/usr/bin/env zsh
# FBM ENGINE · bootstrap a fresh machine (no Mac paths assumed).
# usage: zsh tools/engine/bootstrap_env.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
echo "── python deps ──"
pip install --quiet pillow numpy static-ffmpeg faster-whisper piper-tts
echo "── scratch voice (piper, for offline timelines only) ──"
mkdir -p ~/.cache/piper
for f in onnx onnx.json; do
  [ -f ~/.cache/piper/en_US-ryan-high.$f ] || curl -sL \
   "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.$f" \
   -o ~/.cache/piper/en_US-ryan-high.$f
done
echo "── fonts (open-licence, same as the Remotion kit) ──"
mkdir -p remotion-composer/public/fonts
for f in "anton/Anton-Regular.ttf" "spacemono/SpaceMono-Regular.ttf" "spacemono/SpaceMono-Bold.ttf" \
         "dmsans/DMSans%5Bopsz%2Cwght%5D.ttf"; do
  n=$(basename "$f" | sed 's/%5B.*/-var.ttf/; s/DMSans-var.ttf/DMSans-var.ttf/')
  [ -f "remotion-composer/public/fonts/$n" ] || curl -sL "https://raw.githubusercontent.com/google/fonts/main/ofl/$f" \
    -o "remotion-composer/public/fonts/$n"
done
python3 -c "import sys; sys.path.insert(0,'tools/engine'); import binpaths; print('ffmpeg', binpaths.ffmpeg())"
echo "── secrets: export ELEVENLABS_API_KEY=... and FBM_VOICE_ID=... (never commit them) ──"
echo "READY."
