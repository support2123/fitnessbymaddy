#!/bin/zsh
# FBM ENGINE · QC sweep — usage: qc_sweep.sh <final.mp4> <out_dir>
# One command = decode check + specs + loudness + AI-marker scan + timestamped
# contact sheets (frame every 2.5 s, 10-up). Look at EVERY sheet before delivery.
set -e
IN="$1"; OD="${2:-qc_out}"; mkdir -p "$OD"
echo "=== SPECS ==="
ffprobe -v error -show_entries format=duration,bit_rate -show_entries stream=codec_name,width,height,r_frame_rate -of default=nw=1 "$IN"
echo "=== DECODE (khaali = clean) ==="
ffmpeg -v error -i "$IN" -f null - 2>&1 | head -5
echo "=== LOUDNESS ==="
ffmpeg -hide_banner -i "$IN" -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:" | tail -3
echo "=== AI-MARKER SCAN ==="
python3 - "$IN" <<'EOF'
import sys
d=open(sys.argv[1],'rb').read(); z=d[:3_000_000]+d[-3_000_000:]
bad=[b'c2pa',b'jumb',b'XMP_',b'x:xmpmeta',b'DigitalSourceType',b'trainedAlgorithmicMedia',b'GenAI',b'SynthID',b'ElevenLabs']
tool=[b'Lavf',b'Remotion']
f=[m.decode(errors='replace') for m in bad if m in z]
t=[m.decode(errors='replace') for m in tool if m in z]
if f: print("FAIL:",f)
elif t: print("tool tags present (Lavf/Remotion) — EXPECTED pre-publish; publish_ig.sh strips them. Sterile gate = Strike 9.")
else: print("PASS — sterile")
EOF
echo "=== CONTACT SHEETS ==="
ffmpeg -y -v error -i "$IN" -vf "fps=0.4,scale=270:480" -start_number 0 "$OD/fr_%03d.png"
python3 - "$OD" <<'EOF'
import subprocess, glob, sys, os, re, shutil
od=sys.argv[1]; fr=sorted(glob.glob(os.path.join(od,'fr_*.png')))
for s in range((len(fr)+9)//10):
    chunk=fr[s*10:(s+1)*10]
    if len(chunk)==1:
        shutil.copy(chunk[0], os.path.join(od,f'sheet{s}.png')); continue
    ins=[]; fc=[]
    for i,f in enumerate(chunk):
        t=int(re.search(r'fr_(\d+)',os.path.basename(f)).group(1))*2.5
        ins+=['-i',f]
        fc.append(f"[{i}]drawtext=text='{t:.0f}s':x=8:y=8:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.6[v{i}]")
    fc.append(''.join(f"[v{i}]" for i in range(len(chunk)))+f"hstack=inputs={len(chunk)}[o]")
    subprocess.run(['ffmpeg','-y','-v','error']+ins+['-filter_complex',';'.join(fc),'-map','[o]',os.path.join(od,f'sheet{s}.png')],check=True)
print("sheets:",len(glob.glob(os.path.join(od,'sheet*.png'))))
EOF
echo "DONE — ab har sheet ko AANKH se dekho: $OD/sheet*.png"

