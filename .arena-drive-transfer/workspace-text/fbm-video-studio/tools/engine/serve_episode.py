#!/usr/bin/env python3
"""serve_episode.py <dir> [port] — watch-and-download server for an episode.

One page, video ke saath hi download:
  · the best MP4 in the folder streams in a player at the top (HTTP range, resume-capable)
  · right under it, gold DIRECT MP4 download buttons — no HTML is ever served as a download
    (the page itself is a page; every ⬇ link is a real .mp4 with Content-Disposition: attachment)

Query flags on any file URL:
  ?dl=1   force attachment (this is what the ⬇ buttons use)
  default inline, so <video src> can stream the same file
MP4s support Range, so a dropped download resumes instead of restarting.

usage:  python3 tools/engine/serve_episode.py <dir> [port]
"""
import html
import http.server
import os
import sys
import urllib.parse

DIR = os.path.abspath(sys.argv[1])
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000

EXT = {
    ".mp4": ("VIDEO", "video/mp4"), ".mp3": ("AUDIO", "audio/mpeg"),
    ".jpg": ("IMAGE", "image/jpeg"), ".png": ("IMAGE", "image/png"),
    ".html": ("PAGE", "text/html"), ".md": ("DOC", "text/markdown"),
    ".txt": ("DOC", "text/plain"), ".sha256": ("CHECKSUM", "text/plain"),
}


def human(n):
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{n / 1024:.0f} kB"


def collect():
    files = []
    for f in sorted(os.listdir(DIR)):
        p = os.path.join(DIR, f)
        if os.path.isfile(p) and os.path.splitext(f)[1].lower() in EXT:
            files.append((f, os.path.getsize(p)))
    files.sort(key=lambda x: -x[1])
    return files


def build_page(files):
    mp4s = [f for f in files if f[0].lower().endswith(".mp4")]
    # hero = the designated top-quality master if it exists, else the biggest MP4
    top = [f for f in mp4s if "INSTA" in f[0].upper() or "MASTER" in f[0].upper()]
    hero = (top or mp4s or [(None, 0)])[0][0]
    rest = [(n, s) for n, s in files if n != hero]

    def dl_btn(name, size, primary=False, note=""):
        style = ("background:linear-gradient(180deg,#F0CE87,#D4A148);color:#0A0B0E;font-weight:800"
                 if primary else "background:#1A1C20;color:#EDE6D6;border:1px solid #2A2D33")
        return (f'<a href="/{urllib.parse.quote(name)}?dl=1" '
                f'style="display:block;text-decoration:none;border-radius:12px;padding:14px 16px;{style};'
                f'margin-bottom:8px">'
                f'<span style="font:800 15px/1.3 -apple-system,BlinkMacSystemFont,sans-serif">'
                f'&#11015; DOWNLOAD MP4 &middot; {html.escape(note or name)}</span>'
                f'<span style="display:block;font:500 11.5px/1.7 sans-serif;opacity:.78;margin-top:3px">'
                f'{html.escape(name)} &middot; {human(size)} &middot; direct MP4, saves straight to Downloads</span></a>')

    dl = ""
    if mp4s:
        label = "TOP QUALITY (Instagram master)" if hero and (hero in [t[0] for t in top]) \
            else "MASTER (current best)"
        dl += dl_btn(hero, dict(mp4s)[hero], primary=True, note=label)
        for n, s in mp4s[1:]:
            dl += dl_btn(n, s, note="lite / backup")

    others = "".join(
        f'<a href="/{urllib.parse.quote(n)}?dl=1" style="display:flex;justify-content:space-between;'
        f'gap:12px;padding:10px 14px;border-radius:10px;background:#121417;border:1px solid #202329;'
        f'color:#EDE6D6;text-decoration:none;margin-bottom:6px;font:500 13px/1.4 sans-serif">'
        f'<span>{html.escape(n)}<span style="display:block;font:400 11px/1.6 sans-serif;color:#8A8478">'
        f'{EXT[os.path.splitext(n)[1].lower()][0]} &middot; {human(s)}</span></span>'
        f'<span style="color:#E8BC6A">&#11015;</span></a>' for n, s in rest)

    player = (f'<video controls playsinline preload="metadata" src="/{urllib.parse.quote(hero)}" '
              f'style="width:100%;border-radius:14px;background:#000;display:block;'
              f'box-shadow:0 18px 50px rgba(0,0,0,.6)"></video>') if hero else ""

    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>WATER-01 · watch + download</title></head>
<body style="margin:0;background:#0A0B0E;color:#EDE6D6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:18px 14px 48px">
<div style="max-width:620px;margin:0 auto">
<div style="font:600 12px/1 sans-serif;letter-spacing:4.5px;color:#E8BC6A;margin-bottom:10px">DECODE &middot; EP 06</div>
<h1 style="margin:0 0 4px;font:800 30px/1 sans-serif">WATER &middot; The Tax</h1>
<div style="font:500 13px/1.6 sans-serif;color:#3FB5C4;letter-spacing:1.2px;margin-bottom:16px">
2:01 &middot; 1080&times;1920 &middot; 30 fps &middot; HINDI VO &middot; &minus;14.0 LUFS</div>
{player}
<div style="margin:14px 0 6px;font:600 12px/1 sans-serif;letter-spacing:3px;color:#8A8478">DOWNLOAD</div>
{dl}
<div style="height:1px;background:linear-gradient(90deg,#D4A148,rgba(212,161,72,0));margin:16px 0 12px"></div>
<div style="font:600 12px/1 sans-serif;letter-spacing:3px;color:#8A8478;margin-bottom:8px">OTHER FILES</div>
{others}
<div style="font:400 11.5px/1.8 sans-serif;color:#6E6A62;margin-top:14px">
Direct MP4 links &middot; resume supported (a broken download continues where it stopped) &middot;
verify with <code style="color:#9A9384">shasum -a 256 WATER-01-PUBLISH.mp4</code> against the .sha256 file.
</div></div></body></html>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)

    def _is_dl(self):
        q = urllib.parse.urlparse(self.path).query
        return urllib.parse.parse_qs(q).get("dl", ["0"])[0] == "1"

    def send_file(self, path):
        size = os.path.getsize(path)
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            a, _, b = rng.split("=", 1)[1].split(",")[0].partition("-")
            if a:
                start = int(a)
            if b:
                end = min(int(b), size - 1)
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if self._is_dl():
            self.send_header("Content-Disposition",
                             f'attachment; filename="{os.path.basename(path)}"')
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(262144, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        if path in ("/", "/index.html"):
            body = build_page(collect()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        local = os.path.join(DIR, path.lstrip("/"))
        if os.path.isfile(local):
            return self.send_file(local)
        self.send_error(404, "not here")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    if not os.path.isdir(DIR):
        sys.exit(f"FATAL: {DIR} is not a folder")
    print(f"watch + download · {DIR} · http://0.0.0.0:{PORT}/")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
