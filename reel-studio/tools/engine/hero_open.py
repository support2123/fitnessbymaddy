#!/usr/bin/env python3
"""Reusable cover-locked Hero Open for the portable film renderer.

Use `hero_frame()` as the base layer for every new episode. At frame zero it renders a
static poster-identical image. After the configured hold it introduces a restrained
push, depth-like particle drift, and one gold pulse without cutting away from the hero.
"""
from __future__ import annotations

import functools
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from filmlib import C, H, W, clamp, ease, put, text_img


@functools.lru_cache(maxsize=16)
def _image(path: str) -> Image.Image:
    return Image.open(path).convert("RGB")


def _cover_crop(source: Image.Image, scale: float, focal=(0.5, 0.43)) -> Image.Image:
    """Fill 1080x1920 while keeping the approved upper-mid focal point visible."""
    ratio = max(W / source.width, H / source.height) * scale
    resized = source.resize((round(source.width * ratio), round(source.height * ratio)), Image.Resampling.LANCZOS)
    x = int(clamp(focal[0], 0, 1) * resized.width - W / 2)
    y = int(clamp(focal[1], 0, 1) * resized.height - H / 2)
    x = max(0, min(x, resized.width - W))
    y = max(0, min(y, resized.height - H))
    return resized.crop((x, y, x + W, y + H)).convert("RGBA")


def _atmosphere(base: Image.Image, t: float, amount: float) -> Image.Image:
    if amount <= 0:
        return base
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for i in range(32):
        x = (i * 197 + int(t * (11 + i % 5))) % W
        y = (i * 331 + int(t * (4 + i % 3))) % H
        r = 1 + (i % 3)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(232, 188, 106, int(32 * amount)))
    return Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(1.2)))


def hero_frame(
    t: float,
    image_path: str | Path,
    title: str,
    kicker: str = "DECODE",
    hold_frames: int = 21,
    focal=(0.5, 0.43),
) -> Image.Image:
    """Return a frame-zero-safe hero layer with title composited in reserved top space.

    `hold_frames` should be 15–30 at 30 fps. The call at t=0 is the cover PNG source.
    """
    hold = hold_frames / 30.0
    move = clamp((t - hold) / 1.2)
    scale = 1.0 + 0.06 * ease(move)
    base = _cover_crop(_image(str(image_path)), scale, focal)
    # Type stays visible at frame zero, so the exported cover and first frame can match exactly.
    base = put(base, text_img(kicker.upper(), "monob", 32, "INK", tracking=4), (90, 280), "lt", opacity=0.86, shadow=False)
    base = put(base, text_img(title.upper(), "anton", 144, "INK", tracking=-1.5, max_w=900, align="left"), (90, 390), "lt", opacity=1.0, shadow=True)
    if t > hold:
        base = _atmosphere(base, t - hold, min(1.0, move * 1.4))
        pulse = math.exp(-((t - hold - 0.55) / 0.13) ** 2) * 0.10
        if pulse > 0.001:
            glow = Image.new("RGBA", (W, H), C["GOLD"] + (int(255 * pulse),))
            base = Image.alpha_composite(base, glow)
    return base


def export_cover(image_path: str | Path, out_path: str | Path, title: str, kicker: str = "DECODE", hold_frames: int = 21) -> None:
    """Export the exact t=0 cover image; use this file manually in the social upload UI."""
    hero_frame(0.0, image_path, title, kicker, hold_frames).convert("RGB").save(out_path, quality=96)
