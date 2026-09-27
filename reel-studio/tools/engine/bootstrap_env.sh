#!/usr/bin/env zsh
# FBM REEL STUDIO · bootstrap a fresh portable production machine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "── isolated python environment ──"
# Modern Debian/Ubuntu images correctly reject system-wide pip installs (PEP 668).
# Keep the studio portable and avoid touching the host interpreter.
VENV="$ROOT/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
PY="$VENV/bin/python"

echo "── python dependencies ──"
# imageio-ffmpeg ships a usable binary in its wheel; static-ffmpeg remains a fallback.
# OpenCV is required by the live-motion gate for actual optical-flow inspection.
"$PY" -m pip install --quiet pillow numpy opencv-python-headless imageio-ffmpeg static-ffmpeg faster-whisper piper-tts

echo "── scratch voice for timeline proofs only ──"
mkdir -p ~/.cache/piper
for f in onnx onnx.json; do
  if [ ! -f ~/.cache/piper/en_US-ryan-high.$f ] && ! curl -fsSL \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.$f" \
    -o ~/.cache/piper/en_US-ryan-high.$f; then
    echo "WARN: scratch Piper voice download failed; clone/external-voice workflows remain available." >&2
  fi
done

echo "── open-licence font fallbacks ──"
mkdir -p remotion-composer/public/fonts
while IFS='|' read -r url name; do
  if [ ! -f "remotion-composer/public/fonts/$name" ] && ! curl -fsSL "$url" -o "remotion-composer/public/fonts/$name"; then
    echo "WARN: could not fetch optional font $name; renderer will use its installed fallback." >&2
  fi
done <<'FONTS'
https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf|Anton-Regular.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/SpaceMono-Regular.ttf|SpaceMono-Regular.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/SpaceMono-Bold.ttf|SpaceMono-Bold.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf|DMSans-var.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf|CormorantGaramond-Italic.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf|CormorantGaramond.ttf
FONTS

"$PY" - <<'PY'
import sys
sys.path.insert(0, 'tools/engine')
import binpaths
print('ffmpeg:', binpaths.ffmpeg())
PY

echo "READY. Use .venv/bin/python (or activate with: source .venv/bin/activate)."
echo "Set ELEVENLABS_API_KEY and FBM_VOICE_ID outside git only when generating fresh authority-voice renders."
