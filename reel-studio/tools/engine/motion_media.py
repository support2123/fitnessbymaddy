#!/usr/bin/env python3
"""Live MP4 background reader for the portable Pillow renderer.

The renderer stays frame-accurate without pre-decoding gigabytes of video into RAM.
Each selected beat clip is decoded sequentially through one ffmpeg process, looped only
when its approved motion-manifest row permits looping. Missing media is a hard error;
there is intentionally no still-image fallback in this layer.
"""
from __future__ import annotations

import atexit
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance

import binpaths
from filmlib import C, H, W, clamp


class LiveMotionError(RuntimeError):
    pass


def _load_manifest(ep: Path) -> dict[str, Any]:
    path = ep / "motion-manifest.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LiveMotionError(f"missing live-motion manifest: {path}") from exc
    if not isinstance(data.get("beats"), list):
        raise LiveMotionError(f"invalid live-motion manifest: {path}")
    return data


class _ClipReader:
    def __init__(self, path: Path, loop: bool, fps: int) -> None:
        self.path = path
        self.loop = loop
        self.fps = fps
        self.frame_bytes = W * H * 3
        self.proc: subprocess.Popen[bytes] | None = None
        self.next_index = 0
        self._start()

    def _command(self) -> list[str]:
        # The scale/crop sequence is an intentional cover crop: all providers and stock
        # sources become a consistent 9:16 working canvas before typography is layered.
        cmd = [binpaths.ffmpeg(), "-v", "error", "-nostdin"]
        if self.loop:
            cmd += ["-stream_loop", "-1"]
        cmd += ["-i", str(self.path), "-an", "-vf",
                f"fps={self.fps},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        return cmd

    def _start(self) -> None:
        self.close()
        self.proc = subprocess.Popen(self._command(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.next_index = 0

    def close(self) -> None:
        if self.proc is None:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def _read(self) -> Image.Image:
        if self.proc is None or self.proc.stdout is None:
            raise LiveMotionError(f"decoder did not start for {self.path}")
        raw = self.proc.stdout.read(self.frame_bytes)
        if len(raw) != self.frame_bytes:
            detail = b""
            if self.proc.stderr is not None:
                detail = self.proc.stderr.read(2000)
            msg = detail.decode("utf-8", "replace").strip() or "unexpected end of live clip"
            raise LiveMotionError(f"{self.path}: {msg}")
        return Image.frombytes("RGB", (W, H), raw).convert("RGBA")

    def frame(self, index: int) -> Image.Image:
        if index < 0:
            index = 0
        # Preview/surgical renders can seek backwards; restart rather than return a stale frame.
        if index < self.next_index:
            self._start()
        image: Image.Image | None = None
        while self.next_index <= index:
            image = self._read()
            self.next_index += 1
        assert image is not None
        return image


class MotionDeck:
    """Manifest-driven live background deck, one reader per selected beat clip."""
    def __init__(self, episode_dir: str | Path) -> None:
        self.ep = Path(episode_dir).resolve()
        self.data = _load_manifest(self.ep)
        self.fps = int(self.data.get("fps", 30))
        self.rows = {str(row.get("id")): row for row in self.data["beats"]}
        self.readers: dict[str, _ClipReader] = {}
        atexit.register(self.close)

    def close(self) -> None:
        for reader in self.readers.values():
            reader.close()
        self.readers.clear()

    def row(self, beat_id: str) -> dict[str, Any]:
        try:
            return self.rows[beat_id]
        except KeyError as exc:
            raise LiveMotionError(f"motion-manifest has no beat {beat_id!r}") from exc

    def frame(self, beat_id: str, t: float, beat_start: float, dark: float = 0.0) -> Image.Image:
        row = self.row(beat_id)
        path = (self.ep / str(row["clip_file"])).resolve()
        if not path.is_file():
            raise LiveMotionError(f"required live clip is missing for {beat_id}: {path}")
        reader = self.readers.get(beat_id)
        if reader is None:
            reader = _ClipReader(path, bool(row.get("loop")), self.fps)
            self.readers[beat_id] = reader
        # Add a small headroom offset; a clip can start a few frames before its text beat.
        index = int(max(0.0, t - beat_start) * self.fps)
        image = reader.frame(index)
        if dark > 0:
            image = ImageEnhance.Brightness(image.convert("RGB")).enhance(1.0 - clamp(dark)).convert("RGBA")
        # House grade is applied once here as a restrained graphite unifier. Creative color
        # match happens upstream; this prevents per-clip LUT drift in the render layer.
        veil = Image.new("RGBA", (W, H), C["BG"] + (18,))
        return Image.alpha_composite(image, veil)


def live_scene(deck: MotionDeck, beat_id: str, t: float, window: list[float] | tuple[float, float], dark: float = 0.0) -> Image.Image:
    """Small ergonomic wrapper used by film modules."""
    return deck.frame(beat_id, t, float(window[0]), dark=dark)
