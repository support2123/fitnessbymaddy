#!/usr/bin/env python3
"""make_viewer.py <ep_dir> [--embed-height N]

Builds the two lightweight viewers for an episode from its PUBLISH master:
  <EP>-VIEW.mp4    480x854 · crf30 · mono 64k · faststart   — for Quick Look / downloads
  <EP>-PLAYER.html small embedded copy + poster frame       — for the in-app preview tab

Why this exists: the workspace snapshot is best-effort capped near 128 MB, and two
1080x1920 masters already eat ~95 MB of that. Any large new artifact can silently
fail the turn-end snapshot, and the NEXT restore then reverts to an older state —
which is exactly how the first playback copies kept vanishing. So the viewers have
to be tiny (a few MB total) and regenerable in under two minutes.

Usage:  python3 tools/engine/make_viewer.py episodes/WATER-01
"""
import base64, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import binpaths

EP = sys.argv[1].rstrip("/")
MAX_MB = 12.0                       # hard ceiling for the whole viewer set


def mib(p):
    return os.path.getsize(p) / 1048576


def main():
    name = os.path.basename(EP)
    pub = os.path.join(EP, f"{name}-PUBLISH.mp4")
    if not os.path.exists(pub):
        sys.exit(f"FATAL: {pub} not found — nothing to view.")
    FF = binpaths.ffmpeg()

    # 1 · the download / Quick Look copy
    view = os.path.join(EP, f"{name}-VIEW.mp4")
    subprocess.run([FF, "-y", "-v", "error", "-i", pub,
                    "-vf", "scale=480:854:flags=lanczos",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "30", "-r", "30",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-ac", "1",
                    "-movflags", "+faststart", view], check=True)

    # 2 · the in-tab player: even smaller stream + one poster frame, both embedded
    embed = os.path.join(EP, "_embed.mp4")
    subprocess.run([FF, "-y", "-v", "error", "-i", pub,
                    "-vf", "scale=360:640:flags=lanczos",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "34", "-r", "30",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "48k", "-ac", "1",
                    "-movflags", "+faststart", embed], check=True)
    poster = "/tmp/_viewer_poster.jpg"
    subprocess.run([FF, "-y", "-v", "error", "-ss", "32.0", "-i", pub, "-frames:v", "1",
                    "-vf", "scale=360:-2", poster], check=True)

    b64v = base64.b64encode(open(embed, "rb").read()).decode()
    b64p = base64.b64encode(open(poster, "rb").read()).decode()
    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} — viewer</title></head>
<body style="margin:0;background:#0A0B0E;color:#EDE6D6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;padding:18px 12px 40px;min-height:100vh">
<div style="width:100%;max-width:520px">
<div style="font:600 12px/1 sans-serif;letter-spacing:4.5px;color:#E8BC6A;margin:4px 0 10px">DECODE</div>
<h1 style="margin:0 0 4px;font:800 34px/1 sans-serif;letter-spacing:1px">{name}</h1>
<div style="font:500 13px/1.5 sans-serif;color:#3FB5C4;letter-spacing:1.6px;margin-bottom:14px">PLAYER &middot; PRESS PLAY, SOUND ON</div>
<video controls playsinline preload="metadata" poster="data:image/jpeg;base64,{b64p}"
 style="width:100%;border-radius:14px;background:#000;box-shadow:0 18px 50px rgba(0,0,0,.65);display:block">
<source src="data:video/mp4;base64,{b64v}" type="video/mp4">
Your browser cannot play this file. Open {name}-VIEW.mp4 in the same folder instead.</video>
<div style="font:400 12.5px/1.65 sans-serif;color:#9A9384;margin-top:14px">
Playback here is a light copy. The full-quality master is <b style="color:#EDE6D6">{name}-PUBLISH.mp4</b>
(1080&times;1920), and <b style="color:#EDE6D6">{name}-VIEW.mp4</b> is the small file for Quick Look on a laptop.
</div></div></body></html>"""
    player = os.path.join(EP, f"{name}-PLAYER.html")
    open(player, "w").write(html)
    os.remove(embed)

    total = mib(view) + mib(player)
    print(f"VIEW   {mib(view):6.2f} MB  {view}")
    print(f"PLAYER {mib(player):6.2f} MB  {player}")
    print(f"viewers total {total:.2f} MB" + ("  OK" if total <= MAX_MB else "  OVER BUDGET"))


if __name__ == "__main__":
    main()
