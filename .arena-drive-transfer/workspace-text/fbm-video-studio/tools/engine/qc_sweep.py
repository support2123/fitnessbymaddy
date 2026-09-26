#!/usr/bin/env python3
"""FBM ENGINE · QC sweep (portable port of qc_sweep.sh).

usage: qc_sweep.py <final.mp4> <out_dir>
One command = decode check + specs + loudness + AI-marker scan + timestamped
contact sheets (a frame every 2.5 s, 10-up). Look at EVERY sheet before delivery.
"""
import glob, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths
from PIL import Image, ImageDraw, ImageFont

FF = binpaths.ffmpeg()
IN, OD = sys.argv[1], sys.argv[2]
os.makedirs(OD, exist_ok=True)
W = 540

print("=== SPECS ===")
print(binpaths.probe(IN, "stream=codec_name,width,height,r_frame_rate,nb_frames", stream=True))
print(binpaths.probe(IN, "format=duration,bit_rate,size"))
print("=== DECODE (empty = clean) ===")
p = subprocess.run([FF, "-v", "error", "-i", IN, "-f", "null", "-"], capture_output=True, text=True)
print(p.stderr[:900] or "(clean)")
print("=== LOUDNESS ===")
p = subprocess.run([FF, "-hide_banner", "-i", IN, "-af", "ebur128=peak=true", "-f", "null", "-"],
                   capture_output=True, text=True)
for l in p.stderr.strip().splitlines()[-24:]:
    if re.search(r"(I:|LRA:|Peak:|Threshold:)", l):
        print(l.strip())
print("=== AI-MARKER SCAN ===")
d = open(IN, "rb").read()
z = d[:3_000_000] + d[-3_000_000:]
bad = [b"c2pa", b"jumb", b"XMP_", b"x:xmpmeta", b"DigitalSourceType", b"trainedAlgorithmicMedia",
       b"GenAI", b"SynthID", b"ElevenLabs", b"Remotion"]
tool = [b"Lavf", b"libx264", b"Pillow"]
f = [m.decode(errors="replace") for m in bad if m in z]
t = [m.decode(errors="replace") for m in tool if m in z]
if f:
    print("FAIL:", f)
elif t:
    print("tool tags present (pre-publish expected):", t, "— publish_ig strips container tags; sterile gate = Strike 9")
else:
    print("PASS — sterile")

print("=== CONTACT SHEETS ===")
ff = os.path.join(OD, "fr_%03d.png")
subprocess.run([FF, "-y", "-v", "error", "-i", IN, "-vf", "fps=0.4,scale=270:480", ff], check=True)
fr = sorted(glob.glob(os.path.join(OD, "fr_*.png")))
try:
    font = ImageFont.truetype(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                                           "remotion-composer/public/fonts/SpaceMono-Bold.ttf"), 26)
except Exception:
    font = ImageFont.load_default()
for s in range((len(fr) + 9) // 10):
    chunk = fr[s * 10:(s + 1) * 10]
    sheet = Image.new("RGB", (270 * len(chunk), 480), (10, 11, 14))
    for i, fpath in enumerate(chunk):
        t = int(re.search(r"fr_(\d+)", os.path.basename(fpath)).group(1)) * 2.5
        im = Image.open(fpath).convert("RGB")
        dr = ImageDraw.Draw(im)
        dr.rectangle([6, 6, 92, 40], fill=(0, 0, 0))
        dr.text((12, 10), f"{t}s", font=font, fill=(255, 214, 10))
        sheet.paste(im, (i * 270, 0))
    sheet.save(os.path.join(OD, f"sheet{s}.png"))
print("sheets:", len(glob.glob(os.path.join(OD, "sheet*.png"))))
print(f"DONE — ab har sheet ko AANKH se dekho: {OD}/sheet*.png")
