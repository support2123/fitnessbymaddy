#!/usr/bin/env zsh
# FBM REEL STUDIO · bootstrap a fresh portable production machine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "── python dependencies ──"
pip install --quiet pillow numpy static-ffmpeg faster-whisper piper-tts

echo "── scratch voice for timeline proofs only ──"
mkdir -p ~/.cache/piper
for f in onnx onnx.json; do
  [ -f ~/.cache/piper/en_US-ryan-high.$f ] || curl -fsSL \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.$f" \
    -o ~/.cache/piper/en_US-ryan-high.$f
done

echo "── open-licence font fallbacks ──"
mkdir -p remotion-composer/public/fonts
while IFS='|' read -r url name; do
  [ -f "remotion-composer/public/fonts/$name" ] || curl -fsSL "$url" -o "remotion-composer/public/fonts/$name"
done <<'FONTS'
https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf|Anton-Regular.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/SpaceMono-Regular.ttf|SpaceMono-Regular.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/SpaceMono-Bold.ttf|SpaceMono-Bold.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf|DMSans-var.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf|CormorantGaramond-Italic.ttf
https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf|CormorantGaramond.ttf
FONTS

python3 - <<'PY'
import sys
sys.path.insert(0, 'tools/engine')
import binpaths
print('ffmpeg:', binpaths.ffmpeg())
PY

echo "READY. Set ELEVENLABS_API_KEY and FBM_VOICE_ID outside git for final authority-voice renders."
