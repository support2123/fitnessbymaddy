#!/usr/bin/env python3
"""FBM ENGINE · binary locator — makes the toolchain portable (no hard-coded Mac paths).

Order: $FBM_FFMPEG/$FBM_FFPROBE env → tools/bin/ → imageio_ffmpeg (bundled ffmpeg)
→ static_ffmpeg → PATH. `probe()` deliberately falls back to ffmpeg parsing when a
real ffprobe binary is unavailable, so a failed static_ffmpeg archive fetch can never
block a render on an otherwise capable imageio runtime.
Run `zsh tools/engine/bootstrap_env.sh` once on a fresh box to install the pip fallbacks.
"""
import os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BIN = os.path.join(ROOT, "tools", "bin")


def _find(name, env_var):
    if os.environ.get(env_var) and os.path.exists(os.environ[env_var]):
        return os.environ[env_var]
    local = os.path.join(BIN, name)
    if os.path.exists(local):
        return local
    if name == "ffmpeg":
        # imageio-ffmpeg's wheel contains a usable Linux binary; prefer it over the
        # network-fetching fallback so a transient GitHub failure does not slow every
        # frame/render command.
        try:
            import imageio_ffmpeg
            candidate = imageio_ffmpeg.get_ffmpeg_exe()
            if os.path.exists(candidate):
                return candidate
        except Exception:
            pass
        try:
            import static_ffmpeg
            ff, _fp = static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
            if os.path.exists(ff):
                return ff
        except Exception:
            pass
    else:
        # Never fetch a large archive merely to probe metadata. `probe()` below
        # handles a missing ffprobe with the already-available ffmpeg binary.
        p = shutil.which(name)
        if p:
            return p
        sys.exit(f"FATAL: {name} not found; binpaths.probe will use ffmpeg fallback")
    p = shutil.which(name)
    if p:
        return p
    sys.exit(f"FATAL: {name} not found. Run: zsh tools/engine/bootstrap_env.sh")


def ffmpeg():
    return _find("ffmpeg", "FBM_FFMPEG")


def ffprobe():
    return _find("ffprobe", "FBM_FFPROBE")


def run(args, **kw):
    return subprocess.run([ffmpeg()] + args, **kw)


def probe(path, entries="format=duration,bit_rate", stream=False):
    """ffprobe replacement for ffmpeg-only boxes, shaped like ffprobe -of default=nw=1:nk=1.

    Callers ask three kinds of question, so the fallback answers in kind:
      duration family  -> "seconds\nbitrate"        (gen_vo_scratch does float(line[0]))
      stream=codec... -> one value per line, in the requested order (publish_ig wants h264)
      tags             -> "key=value" per line, empty string when the file carries none
    Bug history: v1 returned raw stderr, which broke duration parsing on ffmpeg 7 (extra
    "Guessed Channel Layout" lines); v2 parsed only duration, which broke the codec guard.
    This version handles both. Verified against EP-05's shipped file.
    """
    try:
        cmd = [ffprobe(), "-v", "error", "-show_entries", entries,
               "-select_streams", "v:0" if stream else "a:0", "-of", "default=nw=1:nk=1", path]
        out = subprocess.run(cmd, capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except SystemExit:
        pass

    err = subprocess.run([ffmpeg(), "-hide_banner", "-i", path],
                         capture_output=True, text=True).stderr
    dm = re.search(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)", err)
    secs = (int(dm.group(1)) * 3600 + int(dm.group(2)) * 60 + float(dm.group(3))) if dm else None
    bm = re.search(r"bitrate:\s*(\d+)\s*kb/s", err)
    vm = re.search(r"Video:\s*([A-Za-z0-9_]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})", err)
    fm = re.search(r"(\d+(?:\.\d+)?)\s*fps", err)

    if "tags" in entries:
        STRUCT = {"Metadata", "Duration", "Stream", "Input", "Output", "Chapters", "Handler"}
        rows = []
        for k, v in re.findall(r"^\s{4,}([A-Za-z0-9_\-\.]+)\s*:\s*(.*)$", err, re.M):
            if k in STRUCT or "Start:" in v:
                continue
            rows.append(f"{k}={v.strip()}")
        return "\n".join(rows)

    if "codec_name" in entries or entries.strip().startswith("stream="):
        vals = []
        if "codec_name" in entries:
            vals.append(vm.group(1) if vm else "N/A")
        if "width" in entries:
            vals.append(vm.group(2) if vm else "N/A")
        if "height" in entries:
            vals.append(vm.group(3) if vm else "N/A")
        if "r_frame_rate" in entries:
            vals.append(f"{int(round(float(fm.group(1))))}/1" if fm else "N/A")
        if "nb_frames" in entries:
            vals.append("N/A")
        if "duration" in entries:
            vals.append(f"{secs:.6f}" if secs is not None else "N/A")
        if "bit_rate" in entries:
            vals.append(bm.group(1) if bm else "N/A")
        if vals:
            return "\n".join(vals)

    if secs is None:
        return err                      # nothing parseable: hand back the real complaint
    return f"{secs:.6f}\n{bm.group(1) if bm else ''}".strip()


if __name__ == "__main__":
    print("ffmpeg :", ffmpeg())
    print("ffprobe:", ffprobe())
