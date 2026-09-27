#!/usr/bin/env python3
"""
FBM FILM LIB (Python) — the offline port of src/fbm/kit/FbmFilmKit.tsx.
Same components, same layout law, same colors, same fonts — but it renders
frame-by-frame with Pillow so the pipeline runs on any CPU box with no browser,
no GPU and no Remotion install. (Remotion path stays the production default;
this is the portable twin, and it is what rendered EP-05.)

LESSONS BAKED IN (do not "simplify" these away — each one cost an episode):
  · RollCounter is INVISIBLE before t0            (no premature 0 on screen)
  · StatStamp LANDS at full value with a pop      (never tweens 19 -> 16)
  · ItalicClaim carries its own scrim             (never illegible on bright 3D)
  · Head/Cite bottom-left, chapter top-left,      (IG UI safe zone bottom 330px)
    nothing critical in the bottom ~330 px
  · a translucent HUMAN body must be in frame     (isolated organ = rejected)
LAYOUT LAW (identical to the TSX kit):
  headline bottom:400 · citation bottom:330 · chapter top:46 · cred top:250
"""
from __future__ import annotations
import math, os, functools, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops, ImageEnhance

W, H = 1080, 1920
FPS = 30
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(ROOT, "remotion-composer", "public", "fonts")
FONT_FILES = {
    "anton": "Anton-Regular.ttf",
    "mono": "SpaceMono-Regular.ttf",
    "monob": "SpaceMono-Bold.ttf",
    "corm": "CormorantGaramond-Italic.ttf",
    "cormb": "CormorantGaramond.ttf",
    "dm": "DMSans-var.ttf",
}
C = {
    "INK": (237, 230, 214), "GOLD": (232, 188, 106), "GOLD2": (212, 161, 72),
    "RED": (255, 59, 48), "TEAL": (63, 181, 196), "CYAN": (127, 227, 236),
    "DIM": (107, 111, 115), "BG": (10, 11, 14), "WHITE": (255, 255, 255),
}


# ---------------------------------------------------------------- easing / time
def clamp(v, a=0.0, b=1.0):
    return a if v < a else (b if v > b else v)


def ip(t, xs, ys):
    """clamped piecewise-linear interpolate (kit's `ip`)."""
    if t <= xs[0]:
        return float(ys[0])
    if t >= xs[-1]:
        return float(ys[-1])
    for i in range(1, len(xs)):
        if t <= xs[i]:
            u = (t - xs[i - 1]) / max(1e-9, (xs[i] - xs[i - 1]))
            return float(ys[i - 1] + (ys[i] - ys[i - 1]) * u)
    return float(ys[-1])


def win(t, w, fade=0.4):
    """fade in over `fade`, out over 0.35 — the kit's `win`."""
    return ip(t, [w[0], w[0] + fade, w[1] - 0.35, w[1]], [0, 1, 1, 0])


def ease(u):
    u = clamp(u)
    return u * u * (3 - 2 * u)


def cold_open_t(t, src, dur=0.8):
    """frame zero shows the film's best moment; everything after runs as-is."""
    return src + t if t < dur else t


def window_of(seg, sid, pad=(0.0, 0.0)):
    a, b = seg[sid]
    return [a - pad[0], b + pad[1]]


# ---------------------------------------------------------------- text engine
@functools.lru_cache(maxsize=256)
def _font(key, size):
    return ImageFont.truetype(os.path.join(FONTS, FONT_FILES[key]), size)


def _line_w(draw, s, font, tracking):
    if not s:
        return 0.0
    w = 0.0
    for ch in s:
        w += draw.textlength(ch, font=font) + tracking
    return w - tracking


@functools.lru_cache(maxsize=4096)
def text_img(text: str, key="anton", size=100, color="INK", tracking=0.0,
             leading=1.06, align="left", max_w=None, weight=None) -> Image.Image:
    """Render text (multi-line via \\n or word-wrap) to a cropped RGBA layer."""
    col = C[color] if isinstance(color, str) else tuple(color)
    font = _font(key, size)
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    lines = []
    for hard in str(text).split("\n"):
        if max_w:
            cur = ""
            for word in hard.split(" "):
                trial = (cur + " " + word).strip()
                if _line_w(probe, trial, font, tracking) > max_w and cur:
                    lines.append(cur); cur = word
                else:
                    cur = trial
            lines.append(cur)
        else:
            lines.append(hard)
    lh = int(size * leading)
    wid = int(max(_line_w(probe, ln, font, tracking) for ln in lines) + size * 0.35 + 8)
    img = Image.new("RGBA", (max(4, wid), lh * len(lines) + int(size * 0.42)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    asc, desc = font.getmetrics()
    for i, ln in enumerate(lines):
        if align == "center":
            x = (img.width - _line_w(probe, ln, font, tracking)) / 2
        elif align == "right":
            x = img.width - _line_w(probe, ln, font, tracking)
        else:
            x = 0
        y = i * lh + (lh - (asc + desc)) / 2
        x = int(x)
        for ch in ln:
            d.text((x, y), ch, font=font, fill=col)
            x += probe.textlength(ch, font=font) + tracking
    return img.crop(img.getbbox() or (0, 0, 4, 4))


def put(base, timg: Image.Image, xy, anchor="lt", opacity=1.0, shadow=True,
        glow=None, glow_px=26, clip=None, clip_dir="h", scale=1.0):
    """Composite a text layer. anchor: l/c/r + t/m/b  (e.g. 'lb', 'ct')."""
    if timg is None or opacity <= 0.001:
        return base
    im = timg
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    if clip is not None and clip < 0.999:
        c = clamp(clip)
        if clip_dir == "h":
            im = im.crop((0, 0, max(1, int(im.width * c)), im.height))
        else:
            im = im.crop((0, 0, im.width, max(1, int(im.height * c))))
    if opacity < 0.999:
        a = im.getchannel("A").point(lambda v: int(v * opacity))
        im = im.copy(); im.putalpha(a)
    x, y = xy
    if "c" in anchor[0]:
        x -= im.width / 2
    elif "r" in anchor[0]:
        x -= im.width
    if "m" in anchor[1]:
        y -= im.height / 2
    elif "b" in anchor[1]:
        y -= im.height
    x, y = int(x), int(y)
    if glow:
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        layer.paste(im, (x, y), im)
        gcol = C[glow] if isinstance(glow, str) else tuple(glow)
        solid = Image.new("RGBA", base.size, (0, 0, 0, 0))
        solid.paste(Image.new("RGBA", im.size, gcol + (255,)), (x, y), im)
        gl = solid.filter(ImageFilter.GaussianBlur(glow_px))
        base = Image.alpha_composite(base.convert("RGBA"), gl)
        base = Image.alpha_composite(base, layer)
        return base.convert(base.mode if base.mode != "RGBA" else "RGBA")
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        dark = Image.new("RGBA", im.size, (8, 9, 12, 255))
        sh.paste(dark, (x + 3, y + 5), im)
        sh = sh.filter(ImageFilter.GaussianBlur(11))
        base = Image.alpha_composite(base.convert("RGBA"), sh)
    base = Image.alpha_composite(base.convert("RGBA"), Image.new("RGBA", base.size, (0, 0, 0, 0)))
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(im, (x, y), im)
    return Image.alpha_composite(base, layer)


# ---------------------------------------------------------------- kit (1:1 port)
HEAD_BOTTOM, CITE_BOTTOM, CHAP_TOP, CRED_TOP = 400, 330, 46, 250


def head(base, big, it=None, itc="GOLD", left=56, right=90, o=1.0, size=100, clip=None):
    t = text_img(big, "anton", size, "INK", leading=0.98)
    base = put(base, t, (left, H - HEAD_BOTTOM), "lb", opacity=o, clip=clip)
    y = H - HEAD_BOTTOM - t.height
    if o > 0.001:
        d = ImageDraw.Draw(base)
        d.rectangle([left, y - 26, left + 120, y - 22], fill=C["GOLD2"])
    if it:
        ti = text_img(it, "corm", 40, itc, max_w=W - left - right)
        base = put(base, ti, (left, y - 40), "lb", opacity=o)
    return base


def cite(base, txt, o=1.0, bottom=CITE_BOTTOM, left=56):
    t = text_img(txt, "mono", 18, "INK", tracking=1.2, max_w=W - left - 130)
    chip = Image.new("RGBA", (t.width + 30, t.height + 20), (10, 11, 14, 165))
    chip.paste(t, (14, 10), t)
    d = ImageDraw.Draw(chip)
    d.rectangle([0, 0, 3, chip.height], fill=C["GOLD2"])
    return put(base, chip, (left, H - bottom), "lb", opacity=o, shadow=False)


def chapter(base, t, tags, left=56):
    for w, label in tags:
        if w[0] <= t < w[1]:
            o = win(t, w, 0.3) * 0.95
            if o <= 0.001:
                return base
            ti = text_img(label, "mono", 21, "GOLD", tracking=6.0)
            base = put(base, ti, (left, CHAP_TOP), "lt", opacity=o, shadow=False)
            d = ImageDraw.Draw(base)
            d.rectangle([left, CHAP_TOP + 40, left + 54, CHAP_TOP + 42], fill=C["GOLD2"])
            return base
    return base


def kicker(base, xy, small, big, sub=None, o=1.0, anchor="lt", big_size=72):
    x, y = xy
    if o <= 0.001:
        return base
    ts = text_img(small, "mono", 21, "GOLD", tracking=3.6)
    tb = text_img(big, "anton", big_size, "INK", leading=1.0)
    if anchor == "ct":
        x -= tb.width / 2
    base = put(base, ts, (x, y), "lt", opacity=o, shadow=False)
    y += ts.height + 8
    base = put(base, tb, (x, y), "lt", opacity=o)
    y += tb.height + 4
    d = ImageDraw.Draw(base)
    d.rectangle([x, y + 4, x + 92, y + 7], fill=C["GOLD2"])
    if sub:
        base = put(base, text_img(sub, "mono", 19, "INK", tracking=1.6), (x, y + 18), "lt",
                   opacity=o * 0.75, shadow=False)
    return base


def kinetic_words(base, txt, xy, t, at, size=88, col="INK", max_w=850,
                  emphasis=None, stagger=0.105, rise=22, glow=None):
    """Word-by-word kinetic type: clip-mask + y-rise + seven-frame overshoot.

    Fixed facts must use :func:`stat_stamp`; this function is for language and claims.
    Exactly one `emphasis` word is allowed per call (red italic by default), which keeps
    a line legible instead of turning the entire sentence into a template panel.
    """
    if t < at:
        return base
    x0, y0 = xy
    raw_lines = [line.split() for line in str(txt).split("\\n")]
    placed = []
    used_emphasis = False
    line_y = y0
    word_index = 0
    for raw_words in raw_lines:
        rows, current, width = [], [], 0
        for word in raw_words:
            probe = text_img(word, "anton", size, col)
            # A deliberate word gap remains legible after the seven-frame pop scale;
            # .18 collapsed adjacent Anton glyphs in delivery previews ("THENFOLLOW").
            gap = int(size * .30) if current else 0
            if current and width + gap + probe.width > max_w:
                rows.append(current); current, width = [], 0; gap = 0
            current.append((word, probe.width)); width += gap + probe.width
        if current:
            rows.append(current)
        for row in rows or [[]]:
            x = x0
            for word, nominal_w in row:
                normalized = re.sub(r"[^A-Za-z0-9]+", "", word).upper()
                emph = bool(emphasis and not used_emphasis and normalized == str(emphasis).upper())
                style = "corm" if emph else "anton"
                word_col = "RED" if emph else col
                img = text_img(word, style, size if not emph else int(size * .94), word_col)
                onset = at + word_index * stagger
                p = clamp((t - onset) / (7 / FPS))
                if p > 0.001:
                    scale = 1.16 - .16 * ease(p)
                    y = line_y - rise * (1 - ease(p))
                    base = put(base, img, (x, y), "lt", opacity=min(1, p * 2.8),
                               scale=scale, clip=ease(p), clip_dir="h", glow=glow if not emph else "RED")
                x += nominal_w + int(size * .30)
                word_index += 1
                if emph:
                    used_emphasis = True
            line_y += int(size * .92)
    return base


def stat_stamp(base, t, at, txt, label=None, col="GOLD", size=132, xy=None, anchor="lb", pop=1.35):
    """MEASURED CONSTANT — lands at full value with a scale pop (never counts)."""
    if t < at:
        return base
    u = (t - at) / 0.28
    k = ip(u, [0, 1], [pop, 1.0])
    o = ip(t, [at, at + 0.10], [0, 1])
    ti = text_img(txt, "anton", size, col, leading=0.92)
    if xy is None:
        xy = (56, H - HEAD_BOTTOM)
    base = put(base, ti, xy, anchor, opacity=o, scale=k, glow=col, glow_px=30)
    if label:
        tl = text_img(label, "mono", 21, "INK", tracking=2.4)
        # alignment follows the anchor's FIRST char — l/c/r. (Was anchor.endswith(), which is
        # False for every top anchor: "rt"/"ct" end in "t", so right/centre stamps pushed their
        # label off the right edge of the frame. Caught in the EP-06 rebuild preview pass.)
        al = "rt" if anchor[0] == "r" else ("ct" if anchor[0] == "c" else "lt")
        if "b" in anchor:                      # baseline anchors: label just under the baseline
            base = put(base, tl, (xy[0], xy[1] + 12), al, opacity=o * 0.8, shadow=False)
        else:                                  # top anchors: label under the NUMBER, same alignment
            base = put(base, tl, (xy[0], xy[1] + int(ti.height * k) + 10), al, opacity=o * 0.8, shadow=False)
    return base


def roll_counter(base, t, t0, t1, to, step=10, label=None, col="INK",
                 size=170, xy=None, anchor="lb", fmt="{:,.0f}"):
    """ACCUMULATING total — invisible before t0."""
    if t < t0 or xy is None:
        return base
    v = round(ip(t, [t0, t1], [0, to]) / step) * step
    ti = text_img(fmt.format(v), "anton", size, col)
    base = put(base, ti, xy, anchor, glow=None)
    if label:
        base = put(base, text_img(label, "mono", 21, "GOLD", tracking=2.6),
                   (xy[0], xy[1] + 14 if "b" in anchor else xy[1] + ti.height), "lt", shadow=False)
    return base


def italic_claim(base, txt, xy, col="CYAN", o=1.0, size=40, anchor="lt"):
    """Key claim + its own scrim — can never sit illegible on a bright frame."""
    t = text_img(txt, "corm", size, col, max_w=int(W * 0.78))
    chip = Image.new("RGBA", (t.width + 32, t.height + 12), (10, 11, 14, 184))
    chip.paste(t, (16, 6), t)
    return put(base, chip, xy, anchor, opacity=o, shadow=True)


def honesty_chip(base, xy, big, sub, o=1.0):
    tb = text_img(big, "anton", 46, "CYAN", leading=1.0)
    ts = text_img(sub, "mono", 19, "INK", tracking=1.8, leading=1.5, max_w=int(W * 0.74))
    w = max(tb.width, ts.width) + 52
    chip = Image.new("RGBA", (int(w), tb.height + ts.height + 46), (10, 11, 14, 200))
    d = ImageDraw.Draw(chip)
    d.rectangle([0, 0, chip.width - 1, chip.height - 1], outline=C["CYAN"] + (255,), width=2)
    chip = put(chip, tb, (26, 14), "lt", opacity=o, shadow=False)
    chip = put(chip, ts, (26, 16 + tb.height + 8), "lt", opacity=o * 0.85, shadow=False)
    # NOTE: composite the WHOLE chip at opacity o — otherwise a faded chip leaves an
    # empty cyan box on screen once its body text has already gone (bug found on EP-06).
    return put(base, chip, xy, "cm", opacity=o, shadow=True)


def cta_block(base, t, tip, headline, italic, question, ask, pill, cred):
    """Kit order, top-down: headline · italic · question · THE ASK (dominant) ·
    quiet funnel pill · credential. The comment ask visually DOMINATES the pill."""
    o = ip(t, [tip, tip + 0.7], [0, 1])
    q = ip(t, [tip + 4.2, tip + 5.0], [0, 1])
    bio = ip(t, [tip + 6.2, tip + 7.0], [0, 1])
    if o <= 0.001:
        return base
    th = text_img(headline, "anton", 84, "INK", leading=1.0, max_w=W - 150)
    ti = text_img(italic, "corm", 42, "GOLD", max_w=W - 150)
    tq = text_img(question, "mono", 25, "CYAN", tracking=3.0, max_w=W - 150)
    ta = text_img(ask, "anton", 74, "GOLD", leading=1.0, max_w=W - 140)
    tp = text_img(pill, "anton", 30, "GOLD")
    chip = Image.new("RGBA", (tp.width + 48, tp.height + 22), (60, 45, 18, 205))
    d = ImageDraw.Draw(chip)
    d.rectangle([0, 0, chip.width - 1, chip.height - 1], outline=C["GOLD2"] + (255,), width=2)
    chip = put(chip, tp, (24, 11), "lt", shadow=False)
    tcred = text_img(cred, "mono", 19, "GOLD", tracking=2.4)
    total = th.height + 18 + ti.height + 44 + tq.height + 16 + ta.height + 30 + chip.height + 26 + tcred.height
    y = H - HEAD_BOTTOM - total
    base = put(base, th, (56, y), "lt", opacity=o); y += th.height + 18
    base = put(base, ti, (56, y), "lt", opacity=o); y += ti.height + 44
    if q > 0.001:
        base = put(base, tq, (56, y), "lt", opacity=q, shadow=False); y += tq.height + 16
        base = put(base, ta, (56, y), "lt", opacity=q, glow="GOLD2", glow_px=28); y += ta.height + 30
    if bio > 0.001:
        base = put(base, chip, (56, y), "lt", opacity=bio * 0.95, shadow=False)
        base = put(base, text_img("LINK IN BIO", "mono", 21, "INK", tracking=2.0),
                   (56 + chip.width + 22, y + 10), "lt", opacity=bio * 0.85, shadow=False)
        y += chip.height + 26
        base = put(base, tcred, (56, y), "lt", opacity=bio * 0.9, shadow=False)
    return base


def cred_third(base, t, from_=1.6, hold=3.3, o_scale=1.0):
    o = ip(t, [from_, from_ + 0.5, from_ + hold + 0.5, from_ + hold + 1.0], [0, 1, 1, 0]) * o_scale
    if o <= 0.001:
        return base
    tn = text_img("MADDY", "anton", 50, "INK")
    ts = text_img("NASM-CPT · SPORTS NUTRITION", "mono", 19, "GOLD", tracking=3.0)
    base = put(base, tn, (72, CRED_TOP), "lt", opacity=o)
    base = put(base, ts, (72, CRED_TOP + tn.height + 8), "lt", opacity=o, shadow=False)
    d = ImageDraw.Draw(base)
    d.rectangle([56, CRED_TOP + 6, 60, CRED_TOP + tn.height + ts.height + 10], fill=C["GOLD2"])
    return base


def contents_card(base, t, until, ep, title, items, item_ats=None):
    """Opening WHAT WE COVER menu. Renders as the TOP layer; hook overlays are
    gated until it dissolves."""
    if t > until + 0.12:
        return base
    o = ip(t, [until - 0.45, until], [1, 0])
    veil = Image.new("RGBA", (W, H), (10, 11, 14, int(232 * o)))
    base = Image.alpha_composite(base.convert("RGBA"), veil)
    ep_t = text_img(ep, "mono", 23, "GOLD", tracking=9.0)
    base = put(base, ep_t, (W / 2, 150), "ct", opacity=o, shadow=False)
    title_t = text_img(title, "anton", 150, "INK", leading=0.95)
    base = put(base, title_t, (W / 2, 196), "ct", opacity=o)
    d = ImageDraw.Draw(base)
    d.rectangle([W / 2 - 60, 196 + title_t.height + 22, W / 2 + 60, 196 + title_t.height + 26], fill=C["GOLD2"])
    y = 560
    base = put(base, text_img("WHAT WE COVER", "anton", 58, "GOLD", tracking=1.0),
               (110, y), "lt", opacity=ip(t, [0.30, 0.55], [0, 1]) * o, shadow=False)
    base = put(base, text_img("IN THIS VIDEO", "mono", 20, "CYAN", tracking=7.0),
               (112, y + 74), "lt", opacity=ip(t, [0.40, 0.65], [0, 1]) * o, shadow=False)
    y += 138
    for i, it in enumerate(items):
        a = (item_ats[i] if item_ats else 0.55 + i * 0.11)
        p = ip(t, [a, a + 0.30], [0, 1])
        if p <= 0.001:
            continue
        num = text_img(f"{i+1:02d}", "mono", 25, "GOLD")
        base = put(base, num, (110 - (1 - p) * 46, y), "lt", opacity=p * o, shadow=False)
        base = put(base, text_img(it, "anton", 50, "INK", leading=1.0, max_w=W - 250),
                   (176 - (1 - p) * 46, y - 8), "lt", opacity=p * o)
        y += 62
    return put(base, text_img("MADDY · NASM-CPT · SPORTS NUTRITION", "mono", 20, "INK", tracking=3.0),
               (W / 2, H - 340), "cb", opacity=ip(t, [1.6, 2.1], [0, 1]) * o * 0.75, shadow=False)


def myth_strike(base, t, at, txt, after=None, size=84, xy=None):
    s = ip(t, [at, at + 0.6], [0, 1]); a = ip(t, [at + 0.8, at + 1.5], [0, 1])
    if s <= 0:
        return base
    xy = xy or (56, H - HEAD_BOTTOM)
    col = "DIM" if s > 0.5 else "INK"
    ti = text_img(txt, "anton", size, col)
    base = put(base, ti, xy, "lb")
    if s > 0.4:
        d = ImageDraw.Draw(base)
        y = xy[1] - ti.height * 0.42
        d.rectangle([xy[0], y, xy[0] + ti.width * s, y + 8], fill=C["RED"])
    if after and a > 0:
        base = put(base, text_img(after, "anton", size, "GOLD"), (xy[0], xy[1] + 12), "lt", opacity=a)
    return base


def bar_pair(base, t, t0, xy, a, b, unit, height=430):
    """a/b = (label, pct_value, color). Bars grow once, then hold."""
    p = ip(t, [t0, t0 + 2.6], [0, 1])
    if p <= 0:
        return base
    x0, y0 = xy
    for i, (lab, v, col) in enumerate((a, b)):
        cx = x0 + i * 300
        hgt = int(v * height / 100 * p)
        val = text_img(f"{int(round(v*p))}{unit}", "anton", 62, col)
        base = put(base, val, (cx, y0), "ct", opacity=min(1, p * 3))
        d = ImageDraw.Draw(base)
        d.rectangle([int(cx - 62), int(y0 + val.height + 14), int(cx + 62),
                     int(y0 + val.height + 14 + hgt)],
                    fill=C[col] if isinstance(col, str) else col)
        base = put(base, text_img(lab, "mono", 19, "INK", tracking=2.0), (cx, y0 + val.height + 22 + hgt),
                   "ct", opacity=0.85, shadow=False)
    return put(base, text_img(unit, "mono", 19, "INK", tracking=2.0),
               (x0 + 150, y0 + height + 150), "ct", opacity=0.6, shadow=False)


# ---------------------------------------------------------------- media / fx
@functools.lru_cache(maxsize=24)
def photo_master(path, width_scale=1.55, grade=("none",), dark=0.0, blur=0.0):
    """Pre-graded master (cropped to frame AR, oversized for Ken-Burns moves)."""
    im = Image.open(path).convert("RGB")
    tw, th = int(W * width_scale), int(H * width_scale)
    sc = max(tw / im.width, th / im.height)
    im = im.resize((int(im.width * sc + 1), int(im.height * sc + 1)), Image.LANCZOS)
    l = (im.width - tw) // 2; tp = (im.height - th) // 2
    im = im.crop((l, tp, l + tw, tp + th))
    mode = grade[0]
    if mode == "teal_gold":
        im = _duotone(im, ((10, 14, 22), (34, 52, 62), (232, 188, 106)), grade[1])
    elif mode == "cold":
        im = ImageEnhance.Color(im).enhance(0.55)
        im = _tint(im, (14, 22, 30), 0.32)
    elif mode == "gold":
        im = _duotone(im, ((16, 10, 6), (70, 44, 18), (255, 214, 140)), grade[1])
    elif mode == "warm":
        im = _tint(im, (40, 22, 8), 0.22)
    if dark > 0:
        im = ImageEnhance.Brightness(im).enhance(1.0 - dark)
    if blur > 0:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return im


def _tint(im, col, amount):
    ov = Image.new("RGB", im.size, col)
    return Image.blend(im, ov, amount)


def _duotone(im, cols, amount=0.55):
    g = im.convert("L")
    sh = Image.new("RGB", im.size, cols[0])
    mid = Image.new("RGB", im.size, cols[1])
    hi = Image.new("RGB", im.size, cols[2])
    a = Image.composite(mid, sh, g.point(lambda v: min(255, v * 3)))
    b = Image.composite(hi, a, g.point(lambda v: max(0, (v - 120) * 3)))
    return Image.blend(im.convert("RGB"), b, amount)


def photo(base, path, t, z=1.0, pan=(0.0, 0.0), opacity=1.0, grade=("none",), dark=0.0, blur=0.0,
          width_scale=1.55, tilt=0.0):
    """Camera-driven paste: z = zoom (1 = the master crop), pan = normalized offset."""
    m = photo_master(path, width_scale, tuple(grade), dark, blur)
    cw, ch = int(m.width / z), int(m.height / z)
    cx = (m.width - cw) / 2 + pan[0] * (m.width - cw) / 2
    cy = (m.height - ch) / 2 + pan[1] * (m.height - ch) / 2
    cx = clamp(cx, 0, m.width - cw); cy = clamp(cy, 0, m.height - ch)
    im = m.crop((int(cx), int(cy), int(cx + cw), int(cy + ch))).resize((W, H), Image.BILINEAR)
    if tilt:
        im = im.rotate(tilt, resample=Image.BILINEAR, center=(W / 2, H / 2))
        im = im.resize((W, H), Image.BILINEAR)
    if opacity < 0.999:
        im = Image.blend(base.convert("RGB"), im, clamp(opacity))
    return im.convert("RGBA") if opacity < 0.999 else im


@functools.lru_cache(maxsize=8)
def _vignette(strength=0.62):
    y, x = np.mgrid[0:H, 0:W]
    dx = (x - W / 2) / (W / 2); dy = (y - H / 2) / (H / 2)
    r = np.sqrt(dx * dx * 0.85 + dy * dy * 0.7)
    a = np.clip((r - 0.42) / 0.85, 0, 1) ** 1.5 * strength * 255
    arr = np.zeros((H, W, 4), np.uint8)
    arr[..., 3] = a.astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


@functools.lru_cache(maxsize=8)
def _grad_top(strength=210, h=430, color=(10, 11, 14)):
    arr = np.zeros((H, W, 4), np.uint8)
    ramp = (np.linspace(1, 0, h) ** 1.4 * strength).astype(np.uint8)
    arr[:h, :, 0], arr[:h, :, 1], arr[:h, :, 2] = color
    arr[:h, :, 3] = ramp[:, None]
    return Image.fromarray(arr, "RGBA")


@functools.lru_cache(maxsize=8)
def _grad_bottom(strength=232, h=760, color=(10, 11, 14)):
    arr = np.zeros((H, W, 4), np.uint8)
    ramp = (np.linspace(0, 1, h) ** 1.25 * strength).astype(np.uint8)
    arr[H - h:, :, 0], arr[H - h:, :, 1], arr[H - h:, :, 2] = color
    arr[H - h:, :, 3] = ramp[:, None]
    return Image.fromarray(arr, "RGBA")


@functools.lru_cache(maxsize=6)
def _grain_tiles(n=5):
    rng = np.random.default_rng(7)
    tiles = []
    for _ in range(n):
        g = rng.normal(128, 26, (H // 2, W // 2)).clip(0, 255).astype(np.uint8)
        tiles.append(Image.fromarray(g, "L").resize((W, H), Image.BILINEAR))
    return tiles


def finish(base, grain=0.055, vig=0.60, frame=0):
    """Global grade lock: grain + vignette, applied once per frame, top-most."""
    im = base.convert("RGBA")
    if vig > 0:
        im = Image.alpha_composite(im, _vignette(vig))
    if grain > 0:
        g = _grain_tiles()[frame % 5].convert("RGB")
        im = Image.blend(im.convert("RGB"), ImageChops.add(im.convert("RGB"), g, scale=2.6), grain * 4)
        im = im.convert("RGBA")
    return im.convert("RGB")


def scrim(base, top=0, bottom=0):
    im = base.convert("RGBA")
    if top:
        im = Image.alpha_composite(im, _grad_top(int(top * 255)))
    if bottom:
        im = Image.alpha_composite(im, _grad_bottom(int(bottom * 255)))
    return im


def flash(base, amount, col="WHITE"):
    if amount <= 0.001:
        return base
    c = C[col] if isinstance(col, str) else col
    ov = Image.new("RGBA", base.size, c + (int(clamp(amount) * 255),))
    return Image.alpha_composite(base.convert("RGBA"), ov)


def sweep(base, t, at, dur=0.9, col=(255, 235, 190), w=340, alpha=0.15):
    """Light sweep across the frame on reveals (premium-feeling, costs nothing)."""
    if not (at <= t <= at + dur):
        return base
    u = (t - at) / dur
    x = -w + u * (W + 2 * w)
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    for i in range(0, w, 4):
        a = int(alpha * 255 * math.sin(math.pi * (i / w)) ** 1.3)
        xs = int(x - w / 2 + i + (0 - H) * 0.35)
        d.line([(xs, 0), (xs + H * 0.35, H)], fill=col + (a,), width=5)
    band = band.filter(ImageFilter.GaussianBlur(26))
    return Image.alpha_composite(base.convert("RGBA"), band)


def glow_dot(base, xy, r, col="GOLD", alpha=0.5, soft=1.0):
    lay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    c = C[col] if isinstance(col, str) else col
    d.ellipse([xy[0] - r, xy[1] - r, xy[0] + r, xy[1] + r], fill=c + (int(alpha * 255),))
    lay = lay.filter(ImageFilter.GaussianBlur(r * 0.85 * soft))
    return Image.alpha_composite(base.convert("RGBA"), lay)


def ring(base, xy, r, col="GOLD", width=3, alpha=1.0, start=0.0, end=1.0):
    lay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    c = C[col] if isinstance(col, str) else col
    d.arc([xy[0] - r, xy[1] - r, xy[0] + r, xy[1] + r], int(360 * start) - 90,
          int(360 * end) - 90, fill=c + (int(255 * alpha),), width=width)
    return Image.alpha_composite(base.convert("RGBA"), lay)


def trace(base, xywh, pts, col="CYAN", width=4, glow=10, alpha=1.0, head=True):
    """Self-drawing line chart (grip-force / risk curve). pts = [(x,y) normalized]."""
    x, y, w, h = xywh
    lay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    c = C[col] if isinstance(col, str) else col
    P = [(x + px * w, y + py * h) for px, py in pts]
    if len(P) > 1:
        d.line(P, fill=c + (int(255 * alpha),), width=width, joint="curve")
    if head and P:
        d.ellipse([P[-1][0] - 9, P[-1][1] - 9, P[-1][0] + 9, P[-1][1] + 9], fill=c + (255,))
    g = lay.filter(ImageFilter.GaussianBlur(glow))
    return Image.alpha_composite(Image.alpha_composite(base.convert("RGBA"), g), lay)


def grid_bg(base, t=0.0, o=0.10, step=92, off=0.0):
    lay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for i in range(-1, W // step + 2):
        d.line([(i * step + off, 0), (i * step + off, H)], fill=(90, 150, 170, int(255 * o)), width=1)
    for j in range(-1, H // step + 2):
        d.line([(0, j * step + off * 0.5), (W, j * step + off * 0.5)], fill=(90, 150, 170, int(255 * o)), width=1)
    return Image.alpha_composite(base.convert("RGBA"), lay)


def solid(t, ints, cols):
    """animated solid bg interpolation"""
    r = ip(t, ints, [c[0] for c in cols]); g = ip(t, ints, [c[1] for c in cols]); b = ip(t, ints, [c[2] for c in cols])
    return Image.new("RGB", (W, H), (int(r), int(g), int(b)))


def tfade(base, a):
    if a >= 0.999:
        return base
    return Image.blend(Image.new("RGB", (W, H), C["BG"]), base.convert("RGB"), clamp(a))
