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

