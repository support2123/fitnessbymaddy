#!/bin/zsh
# FBM ENGINE · mix + master — usage: mix_master.sh <episode_dir> [out.m4a]
# bed.wav + vo.wav -> sidechain duck -> TWO-PASS LINEAR loudnorm to -14.0 LUFS / -1.0 TP.
set -e
EP="$(cd "$1" && pwd)"
OUT="${2:-$EP/mix.m4a}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac
cd "$EP"
ffmpeg -y -v error -i bed.wav -i vo.wav -filter_complex \
"[0:a]highpass=f=28,lowpass=f=12000[b];[1:a]asplit=2[v1][vk];\
[b][vk]sidechaincompress=threshold=0.035:ratio=9:attack=8:release=320:makeup=1[bd];\
[v1]volume=1.0[vv];[bd][vv]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.94[m]" \
 -map "[m]" -ar 44100 -ac 2 premix.wav
ffmpeg -hide_banner -i premix.wav -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null - 2>ln.txt
python3 - "$OUT" <<'PYEOF'
import json, re, subprocess, sys
d = json.loads(re.search(r'\{[^{}]*"input_i".*?\}', open('ln.txt').read(), re.S).group(0))
af = (f"loudnorm=I=-14:TP=-1.0:LRA=11:measured_I={d['input_i']}:measured_TP={d['input_tp']}:"
      f"measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:"
      f"offset={d['target_offset']}:linear=true")
subprocess.run(["ffmpeg","-y","-v","error","-i","premix.wav","-af",af,
                "-c:a","aac","-b:a","320k","-ar","44100","-ac","2",sys.argv[1]],check=True)
PYEOF
echo "--- verify ---"
ffmpeg -hide_banner -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | grep -A2 "Integrated loudness" | head -3
rm -f premix.wav ln.txt
echo "OUT: $OUT"

