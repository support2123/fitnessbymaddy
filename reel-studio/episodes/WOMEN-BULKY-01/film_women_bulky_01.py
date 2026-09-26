#!/usr/bin/env python3
"""WOMEN-BULKY-01 — cover-locked Tier B film module.

One question per beat; the same approved hero remains the visual world. The only
moving numeral is the program-time Living Clock, which travels from week 0 to week 4
and lands exactly when the comment CTA begins.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools", "engine"))
from filmlib import *  # noqa: F401,F403
from hero_open import hero_frame
from doctrine_kit import Box, assert_safe, clock_lands_on_cta

TL = json.load(open(os.path.join(HERE, "timeline.json")))
B = {key: list(value) for key, value in TL["seg"].items()}
TOTAL, FRAMES = TL["total"], TL["frames"]
EP = "WOMEN-BULKY-01"
TITLE = "BULKY IS NOT\nAN ACCIDENT."
HERO_SOURCE = os.path.join(HERE, "hero", "hero-reviewed-1080x1920.png")
CLOCK_START = B["m02"][0]
CTA_TIME = B["m05"][0]
CLOCK_FINAL = 4

# Deliberate static safe-zone proof for every load-bearing composition region.
assert_safe(Box(90, 270, 990, 740, "hero title"))
assert_safe(Box(90, 520, 990, 1180, "receipt and protocol cards"))
assert_safe(Box(90, 1360, 930, 1575, "Living Clock trace"))
assert_safe(Box(90, 650, 930, 1220, "CTA"))


def fade(t, window, edge=0.28):
    return win(t, window, edge)


def panel(base, x0, y0, x1, y1, opacity=1.0, edge="GOLD2", fill=(8, 10, 13, 196)):
    if opacity <= 0.001:
        return base
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rgba = fill[:3] + (int(fill[3] * opacity),)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=12, fill=rgba,
                           outline=C[edge] + (int(220 * opacity),), width=2)
    return Image.alpha_composite(base.convert("RGBA"), layer)


def dark_wash(base, strength=95):
    layer = Image.new("RGBA", (W, H), (7, 9, 12, strength))
    return Image.alpha_composite(base.convert("RGBA"), layer)


def living_clock(t, base):
    """One timing value expressed as environment, telemetry and an actual trace."""
    if t < CLOCK_START:
        return base
    u = clamp((t - CLOCK_START) / max(0.001, CTA_TIME - CLOCK_START))
    weeks = CLOCK_FINAL * ease(u)
    x0, x1, y = 90, 930, 1478
    marker = x0 + (x1 - x0) * (weeks / CLOCK_FINAL)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    # Environment: the advancing gold beam is physically present behind the typography.
    draw.rectangle([int(marker) - 3, 330, int(marker) + 3, 1360], fill=C["GOLD"] + (30,))
    draw.rectangle([x0, y, x1, y + 3], fill=C["DIM"] + (175,))
    draw.rectangle([x0, y, int(marker), y + 4], fill=C["GOLD"] + (240,))
    for week in range(CLOCK_FINAL + 1):
        x = int(x0 + (x1 - x0) * week / CLOCK_FINAL)
        draw.rectangle([x - 1, y - 10, x + 1, y + 14], fill=C["INK"] + (130,))
    draw.ellipse([int(marker) - 11, y - 10, int(marker) + 11, y + 12], fill=C["GOLD"], outline=C["INK"], width=2)
    base = Image.alpha_composite(base.convert("RGBA"), layer)
    base = put(base, text_img("ADAPTATION WINDOW", "mono", 19, "INK", tracking=3.0),
               (90, 1418), "lt", opacity=0.88, shadow=False)
    base = put(base, text_img("WEEK 0", "mono", 18, "DIM", tracking=1.4),
               (90, 1510), "lt", opacity=0.9, shadow=False)
    base = put(base, text_img("WEEK 4", "mono", 18, "DIM", tracking=1.4),
               (930, 1510), "rt", opacity=0.9, shadow=False)
    # Telemetry: deliberately labelled programme time, never a body-change claim.
    base = put(base, text_img(f"WEEK {int(round(weeks)):02d}", "monob", 24, "GOLD", tracking=2.2),
               (930, 900), "rt", opacity=0.92, shadow=False)
    return base


def chapter_tag(base, t):
    return chapter(base, t, [
        # The cover function already owns the m00 series masthead.
        (B["m01"], "THE FEAR"),
        (B["m02"], "THE TIME SCALE"),
        (B["m03"], "THE RECEIPT"),
        (B["m04"], "YOUR FIRST WEEK"),
        ([B["m05"][0], TOTAL], "START HERE"),
    ], left=90)


def hook_layer(base, t):
    o = fade(t, B["m00"])
    if o < 0.001:
        return base
    base = put(base, text_img("LIFTING DOES NOT", "mono", 22, "GOLD", tracking=3.6),
               (90, 805), "lt", opacity=o, shadow=False)
    base = put(base, text_img("MAKE YOU BULKY", "anton", 84, "INK", max_w=850),
               (90, 840), "lt", opacity=o)
    return base


def tax_layer(base, t):
    o = fade(t, B["m01"])
    if o < 0.001:
        return base
    base = dark_wash(base, 50)
    base = panel(base, 90, 690, 990, 1075, o, edge="RED", fill=(12, 10, 11, 205))
    base = put(base, text_img("THE MYTH", "mono", 22, "RED", tracking=4.0), (126, 735), "lt", opacity=o, shadow=False)
    base = put(base, text_img("ONE SESSION", "anton", 106, "INK"), (126, 785), "lt", opacity=o)
    base = put(base, text_img("CHANGES NOTHING.", "anton", 67, "DIM", max_w=760), (126, 915), "lt", opacity=o)
    base = italic_claim(base, "Fear is not evidence.", (126, 1015), col="CYAN", o=o, size=37)
    return base


def scale_layer(base, t):
    o = fade(t, B["m02"])
    if o < 0.001:
        return base
    base = dark_wash(base, 76)
    base = put(base, text_img("CHANGE IS MEASURED", "mono", 22, "GOLD", tracking=3.8),
               (90, 585), "lt", opacity=o, shadow=False)
    base = stat_stamp(base, t, B["m02"][0] + 0.30, "4 WEEKS", "MINIMUM STUDY WINDOW", col="GOLD", size=118,
                      xy=(90, 650), anchor="lt")
    base = put(base, text_img("TO 12 MONTHS", "anton", 79, "INK", max_w=800),
               (90, 815), "lt", opacity=o)
    base = italic_claim(base, "Not one workout.", (90, 960), col="CYAN", o=o, size=48)
    base = cite(base, "HAGSTROM ET AL. · SPORTS MED · 2020", o=o, bottom=330, left=90)
    return base


def receipt_layer(base, t):
    o = fade(t, B["m03"])
    if o < 0.001:
        return base
    base = dark_wash(base, 118)
    base = panel(base, 90, 540, 990, 1190, o, edge="GOLD", fill=(8, 10, 13, 228))
    base = put(base, text_img("THE RECEIPT", "mono", 22, "GOLD", tracking=4.0),
               (130, 590), "lt", opacity=o, shadow=False)
    base = stat_stamp(base, t, B["m03"][0] + 0.22, "10 STUDIES", "MATCHED PROGRAMMES", col="GOLD", size=102,
                      xy=(130, 642), anchor="lt")
    base = put(base, text_img("SAME RELATIVE\nGROWTH.", "anton", 74, "INK", leading=0.91),
               (130, 817), "lt", opacity=o)
    # Two equal, deliberately unnumbered response columns: this visualizes the matched-programme comparison
    # without inventing a percent value the paper did not claim.
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for x, label, col in ((310, "WOMEN", C["GOLD"]), (730, "MEN", C["CYAN"])):
        d.rectangle([x - 52, 1052, x + 52, 1118], fill=col + (220,))
        d.rectangle([x - 52, 1032, x + 52, 1052], fill=col + (90,))
        base = put(base, text_img(label, "mono", 19, "INK", tracking=2.4), (x, 1142), "ct", opacity=o, shadow=False)
    base = Image.alpha_composite(base.convert("RGBA"), layer)
    base = cite(base, "ROBERTS ET AL. · J STRENGTH COND RES · 2020", o=o, bottom=330, left=90)
    return base


def protocol_layer(base, t):
    o = fade(t, B["m04"])
    if o < 0.001:
        return base
    base = dark_wash(base, 105)
    base = put(base, text_img("YOUR FIRST WEEK", "mono", 22, "GOLD", tracking=4.0),
               (90, 545), "lt", opacity=o, shadow=False)
    base = put(base, text_img("THREE MOVEMENTS.", "anton", 80, "INK", max_w=900),
               (90, 590), "lt", opacity=o)
    rows = [("01", "SQUAT OR LEG PRESS"), ("02", "A ROW"), ("03", "A PRESS")]
    for i, (num, label) in enumerate(rows):
        at = B["m04"][0] + 0.65 + i * 0.45
        p = clamp((t - at) / 0.28)
        if p <= 0:
            continue
        y = 750 + i * 132
        base = panel(base, 90, y, 930, y + 100, o * p, edge="GOLD2", fill=(9, 11, 14, 205))
        base = put(base, text_img(num, "monob", 23, "GOLD", tracking=1.0), (126, y + 31), "lt", opacity=o * p, shadow=False)
        base = put(base, text_img(label, "anton", 43, "INK", max_w=650), (230, y + 24), "lt", opacity=o * p)
    base = italic_claim(base, "Add a rep before adding weight.", (90, 1172), col="CYAN", o=o, size=36)
    return base


def cta_layer(base, t):
    o = clamp((t - CTA_TIME) / 0.42)
    if o <= 0:
        return base
    base = dark_wash(base, 112)
    base = put(base, text_img("START ANYWAY.", "anton", 102, "INK", max_w=900), (90, 650), "lt", opacity=o)
    base = put(base, text_img("YOU DO NOT HAVE TO AVOID STRENGTH.", "corm", 43, "GOLD", max_w=830),
               (90, 790), "lt", opacity=o, shadow=False)
    base = panel(base, 90, 930, 930, 1142, o, edge="GOLD", fill=(35, 27, 13, 220))
    base = put(base, text_img("COMMENT THE LIFT", "mono", 22, "CYAN", tracking=3.0),
               (130, 968), "lt", opacity=o, shadow=False)
    base = put(base, text_img("YOU AVOID.", "anton", 76, "GOLD", max_w=700),
               (130, 1002), "lt", opacity=o, glow="GOLD2", glow_px=20)
    base = put(base, text_img("NEXT: THE REP RANGE MYTH.", "mono", 19, "INK", tracking=2.2),
               (90, 1200), "lt", opacity=o * 0.90, shadow=False)
    return base


def frame(t):
    # This exact computation is exported to hero/cover.png before final render.
    # The poster headline owns frame zero, then clears before the evidence screens so
    # the later proof never competes with the cover copy.
    hero_text_o = 1.0 - clamp((t - B["m00"][1]) / 0.42)
    base = hero_frame(t, HERO_SOURCE, TITLE, kicker="DECODE · WOMEN'S STRENGTH", hold_frames=21,
                      text_opacity=hero_text_o)
    base = chapter_tag(base, t)
    # The cover headline is the hook. Do not stack a second sentence over it.
    base = tax_layer(base, t)
    base = scale_layer(base, t)
    base = receipt_layer(base, t)
    base = protocol_layer(base, t)
    base = cta_layer(base, t)
    base = living_clock(t, base)
    if t >= CTA_TIME:
        assert clock_lands_on_cta(living_clock_value(CTA_TIME), CLOCK_FINAL)
    return finish(base, grain=0.026, vig=0.16, frame=int(t * FPS))


def living_clock_value(t):
    u = clamp((t - CLOCK_START) / max(0.001, CTA_TIME - CLOCK_START))
    return CLOCK_FINAL * ease(u)
