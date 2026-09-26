#!/usr/bin/env python3
"""FBM ENGINE · cover designer (the fbm-cover-designer agent's hands).

usage: make_cover.py <episode_dir> [--hero squeeze|hands|carry|body] [--word GRIP]
Writes cover.png (1080x1350 feed) and cover-story.png (1080x1920 story/reel cover).
Imagery-led · human figure in frame · series masthead · gold hook · source line.
"""
import argparse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import filmlib
from filmlib import C, ROOT, finish, put, photo, scrim, text_img, Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("ep_dir")
ap.add_argument("--hero", default="squeeze")
ap.add_argument("--word", default="GRIP")
ap.add_argument("--ep", default="DECODE · EP 05")
ap.add_argument("--hook", default="YOUR GRIP PREDICTS DEATH.")
ap.add_argument("--sub", default="BETTER THAN YOUR BLOOD PRESSURE DOES")
ap.add_argument("--src", default="LEONG 2015 · THE LANCET · PURE · 139,691 ADULTS")
ap.add_argument("--extra", default="COMMENT YOUR NUMBER · 30-SECOND TEST INSIDE")
a = ap.parse_args()

# Hero stills resolve per EPISODE SLUG, so every episode keeps its own art direction.
# --hero takes either a named preset (grip) or any still filename stem in the
# episode's public folder (e.g. --hero drop_crown for WATER-01).
_base = os.path.basename(os.path.abspath(a.ep_dir)).lower()          # water-01
PUB = os.path.join(ROOT, "remotion-composer", "public", "fbm", _base)
if not os.path.isdir(PUB):                                            # fall back to the pillar folder
    PUB = os.path.join(ROOT, "remotion-composer", "public", "fbm", _base.rsplit("-", 1)[0])
if not os.path.isdir(PUB):
    PUB = os.path.join(ROOT, "remotion-composer", "public", "fbm", "grip")
HEROES = {"squeeze": ("squeeze.jpg", ("teal_gold", 0.42), 0.16),
          "hands": ("golden_hands.jpg", ("gold", 0.30), 0.12),
          "carry": ("carry.jpg", ("teal_gold", 0.34), 0.20),
          "body": ("hero_body.jpg", ("cold",), 0.12),
          # WATER-01 art direction
          "drop_crown": ("drop_crown.jpg", ("teal_gold", 0.40), 0.16),
          "kidney_filter": ("kidney_filter.jpg", ("teal_gold", 0.34), 0.14),
          "body_water": ("body_water.jpg", ("cold",), 0.12),
          "sweat_skin": ("sweat_skin.jpg", ("teal_gold", 0.30), 0.18),
          "heart_tax": ("heart_tax.jpg", ("warm",), 0.18),
          "glass_meal": ("glass_meal.jpg", ("gold", 0.28), 0.14)}
if a.hero not in HEROES:                     # any still stem in the episode folder
    cand = os.path.join(PUB, a.hero + ".jpg")
    if os.path.exists(cand):
        HEROES[a.hero] = (a.hero + ".jpg", ("teal_gold", 0.34), 0.16)
fn, gr, dk = HEROES[a.hero]


def _cover_scrim(base, strength=232, h=None):
    """Bottom scrim for covers — the source/extra lines must read over any hero.
    (filmlib's gradient helpers bake to the module W/H, so they are built inside
    build() where filmlib.W/H are already set to the cover size.)"""
    return filmlib.Image.alpha_composite(base.convert("RGBA"),
                                         filmlib._grad_bottom(strength=strength, h=h))
src = os.path.join(PUB, fn)


def build(w, h, block_bottom):
    filmlib.W, filmlib.H = w, h
    filmlib._vignette.cache_clear(); filmlib._grad_top.cache_clear()
    filmlib._grad_bottom.cache_clear(); filmlib.photo_master.cache_clear()
    filmlib._grain_tiles.cache_clear(); filmlib.text_img.cache_clear()
    base = photo(Image.new("RGB", (w, h), C["BG"]), src, 0, z=1.02, opacity=1, grade=gr, dark=dk)
    base = scrim(base, top=0.30, bottom=0.78)
    base = put(base, text_img(a.ep, "mono", 26, "GOLD", tracking=10.0), (56, 92), "lt", shadow=False)
    d = ImageDraw.Draw(base)
    d.rectangle([56, 142, 156, 146], fill=C["GOLD2"])
    wt = text_img(a.word, "anton", int(w * 0.232), "INK", leading=0.9)
    base = put(base, wt, (w / 2, int(h * 0.33)), "cm", glow="GOLD2", glow_px=6)
    d = ImageDraw.Draw(base)
    d.rectangle([w / 2 - 110, int(h * 0.33) + wt.height / 2 + 26, w / 2 + 110, int(h * 0.33) + wt.height / 2 + 31],
                fill=C["GOLD2"])
    # a real scrim behind the text block: hooks/source must read over ANY hero still
    base = _cover_scrim(base, strength=205, h=int(h * 0.42))
    ht = text_img(a.hook, "anton", int(w * 0.061), "INK", leading=1.05, max_w=w - 150)
    st = text_img(a.sub, "mono", 21, "CYAN", tracking=3.0, max_w=w - 150)
    et = text_img(a.extra, "mono", 19, "GOLD", tracking=2.6, max_w=w - 150)
    total = ht.height + 16 + st.height + 26 + et.height
    y0 = h - block_bottom - total
    base = put(base, ht, (56, y0), "lt")
    base = put(base, st, (56, y0 + ht.height + 16), "lt", opacity=0.92, shadow=False)
    base = put(base, et, (56, y0 + ht.height + 16 + st.height + 26), "lt", opacity=0.95, shadow=False)
    base = put(base, text_img("MADDY · NASM-CPT · SPORTS NUTRITION", "mono", 18, "INK", tracking=2.6),
               (56, h - 64), "lb", opacity=0.7, shadow=False)
    return finish(base, grain=0.05, vig=0.55, frame=0)


feed = build(1080, 1350, 300)
story = build(1080, 1920, 400)
feed.save(os.path.join(a.ep_dir, "cover.png"))
story.save(os.path.join(a.ep_dir, "cover-story.png"))
print("wrote", os.path.join(a.ep_dir, "cover.png"), "and cover-story.png")
