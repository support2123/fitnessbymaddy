#!/usr/bin/env python3
"""FBM ENGINE · film renderer (offline twin of the Remotion render step).

Usage:
  python3 render_film.py <episode_dir> <film_module.py> <out.mp4> [--start S] [--end S] [--preview T.png]

Renders the film module's frame(t) at 1080x1920/30fps and pipes raw RGB straight
into libx264 (no PNG scratch, no browser, no GPU). `--preview T` renders ONE frame
for QC — this is how you check a design without burning a full render.
"""
import argparse, importlib.util, os, sys, time
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

ap = argparse.ArgumentParser()
ap.add_argument("ep_dir"); ap.add_argument("film"); ap.add_argument("out")
ap.add_argument("--start", type=float, default=None)
ap.add_argument("--end", type=float, default=None)
ap.add_argument("--preview", default=None)
ap.add_argument("--fps", type=int, default=30)
a = ap.parse_args()

spec = importlib.util.spec_from_file_location("film_mod", a.film)
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
W, H, FPS = mod.W, mod.H, a.fps
TOTAL = mod.TOTAL

if a.preview is not None:
    t = float(a.preview)
    im = mod.frame(t)
    im.save(a.out)
    print(f"preview t={t:.2f}s -> {a.out}")
    sys.exit(0)

t0 = a.start if a.start is not None else 0.0
t1 = a.end if a.end is not None else TOTAL
f0, f1 = int(round(t0 * FPS)), int(round(t1 * FPS))
n = f1 - f0
print(f"RENDER {mod.TITLE} · {n} frames ({t0:.2f}s → {t1:.2f}s) · {W}x{H}@{FPS}")

cmd = [binpaths.ffmpeg(), "-y", "-v", "error", "-threads", "0",
       "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
       "-an", "-c:v", "libx264",
       "-preset", os.environ.get("FBM_RENDER_PRESET", "slow"),
       "-crf", os.environ.get("FBM_RENDER_CRF", "15"),
       "-profile:v", "high", "-pix_fmt", "yuv420p",
       "-g", str(FPS * 2), "-movflags", "+faststart", a.out]
import subprocess
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
t_start = time.time()
for i in range(f0, f1):
    t = i / FPS
    im = mod.frame(t)
    p.stdin.write(im.convert("RGB").tobytes())
    if i % 30 == 0:
        el = time.time() - t_start
        done = i - f0 + 1
        print(f"  {t:6.2f}s  frame {done}/{n}  {done/max(el,1e-9):4.1f} fps render  eta {max(0,(n-done)/max(done/max(el,1e-9),1e-9)):5.0f}s", flush=True)
p.stdin.close()
rc = p.wait()
print("ffmpeg rc:", rc, f"· wall {time.time()-t_start:.1f}s")
sys.exit(rc)
