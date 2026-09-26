#!/usr/bin/env python3
"""
DECODE EP-05 · GRIP · "The Squeeze"  —  1080x1920 · 30fps
Film DEFINITION for the Python engine (the TSX twin of src/fbm/films/Grip01.tsx).

Every beat window comes from timeline.json (VO-led: audio leads, visuals follow).
ONE CLOCK: the stand tick (the chair-stand metronome) drives the pulse dot, the
on-screen count, the ring, and the score (bed_grip.py imports the same function).
COLD OPEN: frame 0 shows the film's best moment (the 16% gold slam), then normal.
"""
import json, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from filmlib import *          # noqa

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(ROOT, "remotion-composer", "public", "fbm", "grip")
TL = json.load(open(os.path.join(HERE, "timeline.json")))
B = {k: list(v) for k, v in TL["seg"].items()}
TOTAL = TL["total"]; FRAMES = TL["frames"]
EP = "DECODE · EP 05"
TITLE = "GRIP"
ITEMS = ["WHAT IT PREDICTS", "WHY THE HAND", "THE 30 SECOND TEST", "THE FIX"]

# ---- the film's best moment: the 16% gold slam (cold open source) -----------
FLASH_SRC = B["m02"][0] + 5.05


# ---------------------------------------------------------------- ONE CLOCK
def stand_clock(t):
    """Returns (phase 0..1, count int, spike 0..1). Ticks through m05+m06:
    starts when the test is being explained, accelerates into the count."""
    a, b = B["m05"][0] + 2.6, B["m06"][1] + 0.4
    if t < a:
        return 0.0, 0, 0.0
    T = t - a
    if T > 42:
        return 0.0, 24, 0.0
    period = ip(T, [0, 6, 12], [0.86, 0.72, 0.62])          # accelerates
    k = int(T / period)
    ph = (T / period) % 1.0
    spike = math.exp(-((ph - 0.06) / 0.075) ** 2) + 0.34 * math.exp(-((ph - 0.26) / 0.10) ** 2)
    return ph, k, spike


# ---------------------------------------------------------------- photography
PHOTOS = {
    "squeeze":   dict(path=os.path.join(PUB, "squeeze.jpg"),   grade=("teal_gold", 0.42), dark=0.16),
    "body":      dict(path=os.path.join(PUB, "hero_body.jpg"), grade=("cold",), dark=0.10),
    "forearm":   dict(path=os.path.join(PUB, "forearm_anatomy.jpg"), grade=("cold",), dark=0.12),
    "dyno":      dict(path=os.path.join(PUB, "dynamometer.jpg"), grade=("teal_gold", 0.30), dark=0.14),
    "chair":     dict(path=os.path.join(PUB, "chair_stand.jpg"), grade=("warm",), dark=0.12),
    "hang":      dict(path=os.path.join(PUB, "hang.jpg"),      grade=("cold",), dark=0.16),
    "carry":     dict(path=os.path.join(PUB, "carry.jpg"),     grade=("teal_gold", 0.34), dark=0.20),
    "hands":     dict(path=os.path.join(PUB, "golden_hands.jpg"), grade=("gold", 0.34), dark=0.10),
}


def shot(base, key, t, t0, z=(1.06, 1.0), pan=((0, 0), (0, 0)), fade=0.45, dim=0.0, **kw):
    """One camera move over one time window; crossfades in/out over `fade`."""
    o = ip(t, [t0, t0 + fade, t0 + kw.get("hold", 999) - 0.5, t0 + kw.get("hold", 999)],
           [0, 1, 1, 0]) if "hold" in kw else ip(t, [t0, t0 + fade], [0, 1])
    if o <= 0.001:
        return base
    dt = t - t0
    zz = ip(dt, [0, max(4.0, dt + 0.01)], list(z))
    px = ip(dt, [0, max(4.0, dt + 0.01)], [pan[0][0], pan[1][0]])
    py = ip(dt, [0, max(4.0, dt + 0.01)], [pan[0][1], pan[1][1]])
    p = PHOTOS[key]
    im = photo(base, p["path"], t, z=zz, pan=(px, py), opacity=o,
               grade=p["grade"], dark=p["dark"] + dim)
    return im if isinstance(im, Image.Image) and base.mode == "RGB" else Image.blend(base.convert("RGB"), im.convert("RGB"), 1.0)


def photos(t):
    """Scene stack — only the shots whose window covers t are drawn (later = on top)."""
    base = solid(t, [0, 1], [C["BG"], C["BG"]])
    S = [
        ("squeeze", B["m00"][0] - 0.2, 1.02, 1.14, (0.02, 0.0), (-0.02, 0.0), 0.5),
        ("body",    B["m01"][0] - 0.4, 1.16, 1.02, (0.03, 0.02), (-0.04, -0.02), 0.6),
        ("dyno",    B["m03"][0] - 0.4, 1.12, 1.0,  (-0.03, -0.02), (0.03, 0.02), 0.5),
        ("forearm", B["m03"][0] + 3.0, 1.10, 1.01, (0.0, 0.03), (0.0, -0.03), 0.5),
        ("body",    B["m04"][0] - 0.4, 1.03, 1.10, (0.0, 0.0), (0.0, 0.02), 0.6),
        ("chair",   B["m05"][0] - 0.4, 1.12, 1.02, (-0.02, 0.0), (0.02, 0.0), 0.5),
        ("chair",   B["m06"][0] - 0.4, 1.02, 1.14, (0.02, 0.01), (-0.02, -0.01), 0.5),
        ("hang",    B["m07"][0] - 0.4, 1.14, 1.02, (0.0, 0.03), (0.0, -0.02), 0.5),
        ("carry",   B["m07"][0] + 3.4, 1.12, 1.0,  (-0.03, 0.0), (0.03, 0.0), 0.5),
        ("hands",   B["m08"][0] - 0.5, 1.0, 1.13,  (0.0, 0.0), (0.0, -0.02), 0.6),
    ]
    for key, t0, z0, z1, p0, p1, fade in S:
        if t < t0 or t > t0 + 40:
            continue
        o = ip(t, [t0, t0 + fade], [0, 1])
        if t > B["m08"][1] + 0.4 and key != "hands":
            continue
        dt = max(0.4, (t - t0))
        zz = ip(dt, [0, 60], [z0, z1]); px = ip(dt, [0, 60], [p0[0], p1[0]]); py = ip(dt, [0, 60], [p0[1], p1[1]])
        if t < t0 - 0.05 or o <= 0.001:
            continue
        p = PHOTOS[key]
        base = photo(base, p["path"], t, z=zz, pan=(px, py), opacity=o, grade=p["grade"], dark=p["dark"]).convert("RGB")
    return base


# ---------------------------------------------------------------- overlays
def hud_gauge(base, t, t0, v_from=0.18, v_to=0.92, label="GRIP FORCE", col="CYAN", live=True, x=None):
    """The living widget: a force bar + pulse dot, top-right (kit's top-right zone)."""
    x = x if x is not None else W - 62
    y = 300
    v = ip(t, [t0, t0 + 3.2], [v_from, v_to])
    ph, cnt, sp = stand_clock(t)
    bar_w, bar_h = 300, 12
    d = ImageDraw.Draw(base)
    d.rectangle([x - bar_w, y + 150, x, y + 150 + bar_h], fill=(35, 45, 52))
    d.rectangle([x - bar_w, y + 150, x - bar_w + int(bar_w * v), y + 150 + bar_h], fill=C[col])
    base = put(base, text_img(label, "mono", 19, col, tracking=3.0), (x, y + 108), "rt", shadow=False)
    base = put(base, text_img(f"{int(v*100)}", "anton", 54, col), (x, y + 40), "rt", shadow=False)
    if live and t > B["m05"][0] + 2.6:
        base = glow_dot(base, (x - 12, y + 22), 16 + 30 * sp, "GOLD", 0.30 + 0.45 * sp)
        base = glow_dot(base, (x - 12, y + 22), 9, "GOLD", 0.95)
    return base


def frame(t: float) -> Image.Image:
    tt = cold_open_t(t, FLASH_SRC, 0.80)
    base = photos(tt)
    base = scrim(base, top=0.34, bottom=0.62)

    # ============================== m00 · CONTENTS (top layer) ==============
    if tt < B["m00"][1] + 1.2:
        base = contents_card(base, tt, B["m00"][1] + 0.35, EP, TITLE, ITEMS,
                             item_ats=[B["m00"][0] + o for o in (0.55, 1.25, 1.95, 2.65)])
        base = finish(base, frame=int(t * FPS))
        return base

    # ============================== m01 · THE PREDICTOR =====================
    if B["m01"][0] - 0.35 <= tt <= B["m01"][1] + 0.35:
        o = win(tt, B["m01"])
        base = scrim(base, top=0.34, bottom=0.72)
        base = hud_gauge(base, tt, B["m01"][0] - 0.6, 0.22, 0.94, "GRIP FORCE", "CYAN")
        base = head(base, "YOUR GRIP\nPREDICTS\nDEATH.", "better than your blood pressure does",
                    itc="CYAN", o=o, clip=ip(tt, [B["m01"][0] + 0.05, B["m01"][0] + 0.75], [0, 1]))
        base = cite(base, "LEONG 2015 · THE LANCET · PURE · 139,691 ADULTS · 17 COUNTRIES", o=o)
        if tt > B["m01"][0] + 3.4:
            base = put(base, text_img("AND YOU CAN TEST IT IN 5 SECONDS", "mono", 22, "GOLD", tracking=3.4),
                       (56, 1152), "lt", opacity=ip(tt, [B["m01"][0] + 3.4, B["m01"][0] + 3.9], [0, 1]) * o,
                       shadow=False)

    # ============================== m02 · THE STUDY =========================
    elif B["m02"][0] - 0.35 <= tt <= B["m02"][1] + 0.35:
        o = win(tt, B["m02"]); s0 = B["m02"][0]
        base = grid_bg(base, tt, o=0.07, off=(tt * 8) % 92)
        base = scrim(base, top=0.30, bottom=0.66)
        # the falling-grip risk curve (self-drawing, left half)
        u = clamp((tt - s0 - 0.3) / 3.2)
        pts = [(i / 40, 0.86 - 0.66 * (1 - (i / 40)) ** 0.55) for i in range(int(40 * u) + 1)]
        base = trace(base, (90, 400, 420, 300), pts, col="RED" if u > 0.95 else "CYAN", width=5, glow=12)
        base = put(base, text_img("GRIP DOWN", "mono", 18, "RED", tracking=2.4), (90, 745), "lt", shadow=False)
        base = put(base, text_img("RISK UP", "mono", 18, "RED", tracking=2.4), (470, 385), "rt", shadow=False)
        base = roll_counter(base, tt, s0 + 0.15, s0 + 2.5, 139691, step=1, size=150,
                            col="INK", xy=(56, 880), anchor="lb", label="ADULTS. 17 COUNTRIES. 4 YEARS.")
        if tt > s0 + 3.1:
            f = ip(tt, [s0 + 3.1, s0 + 3.5], [0, 1])
            chip = Image.new("RGBA", (250, 108), (10, 11, 14, 200))
            d = ImageDraw.Draw(chip); d.rectangle([0, 0, 249, 107], outline=C["RED"] + (255,), width=4)
            chip = put(chip, text_img("5 KG", "anton", 56, "RED"), (125, 20), "ct", shadow=False)
            base = put(base, chip, (720, 700 + 120 * (1 - f)), "lt", opacity=f, shadow=False)
            base = put(base, text_img("LESS GRIP", "mono", 18, "INK", tracking=2.6), (845, 824 + 120 * (1 - f)),
                       "ct", opacity=f * 0.7, shadow=False)
        if tt > s0 + 4.35:                                  # THE GOLD SLAM
            base = flash(base, ip(tt, [s0 + 4.35, s0 + 4.52, s0 + 4.9], [0.55, 0.22, 0]))
            base = sweep(base, tt, s0 + 4.3, 1.0, col=(255, 226, 170), alpha=0.22)
            base = stat_stamp(base, tt, s0 + 4.35, "16%", None, "GOLD", size=210, xy=(900, 1120), anchor="rb")
            base = put(base, text_img("HIGHER RISK OF DYING", "mono", 22, "INK", tracking=3.0),
                       (900, 1184), "rt", opacity=ip(tt, [s0 + 4.5, s0 + 4.9], [0, 1]) * 0.9, shadow=False)
        base = head(base, "EVERY 5 KG\nLESS GRIP.", "measured across 17 countries, four years", o=o)
        base = cite(base, "LEONG ET AL 2015 · THE LANCET 386:266-273 · PURE STUDY · ALL-CAUSE MORTALITY", o=o)

    # ============================== m03 · WHY THE HAND ======================
    elif B["m03"][0] - 0.35 <= tt <= B["m03"][1] + 0.35:
        o = win(tt, B["m03"]); s0 = B["m03"][0]
        base = scrim(base, top=0.36, bottom=0.70)
        if tt < s0 + 3.0:
            base = kicker(base, (56, 250), "THE CLINIC", "THE CHEAPEST\nWINDOW INTO MUSCLE",
                          "A DYNAMOMETER COSTS LESS THAN A BLOOD PRESSURE CUFF", o=win(tt, [s0 - 0.1, s0 + 3.1]))
            base = put(base, text_img("$40", "anton", 92, "CYAN"), (W - 70, 322), "rt",
                       opacity=win(tt, [s0 + 0.4, s0 + 3.0]), glow="TEAL", glow_px=24) 
            base = cite(base, "PURE INVESTIGATORS 2015 · \"SIMPLE, QUICK, AND INEXPENSIVE\" · LANCET", o=win(tt, [s0, s0 + 3.0]))
        if tt > s0 + 2.5:
            o2 = win(tt, [s0 + 2.5, B["m03"][1] + 0.3])
            base = kicker(base, (56, 250), "WHAT IT READS", "A PROXY FOR\nTOTAL MUSCLE",
                          "MUSCLE MASS · NERVE DRIVE · RESERVE", o=o2)
            base = put(base, text_img("TENDONS + FLEXORS", "mono", 18, "GOLD", tracking=3.0),
                       (W - 62, 1180), "rt", opacity=o2 * 0.9, shadow=False)
            base = glow_dot(base, (W - 250, 1105), 26, "GOLD", 0.35 * o2)
            base = cite(base, "SAYER & KIRKWOOD 2015 · LANCET · \"A BIOMARKER OF AGEING ACROSS THE LIFE COURSE\"", o=o2)

    # ============================== m04 · HONESTY ===========================
    elif B["m04"][0] - 0.35 <= tt <= B["m04"][1] + 0.35:
        o = win(tt, B["m04"]); s0 = B["m04"][0]
        base = scrim(base, top=0.36, bottom=0.74)
        base = honesty_chip(base, (W / 2, 470), "A PROXY, NOT A VERDICT",
                            "OBSERVATIONAL DATA. CAUSATION IS STILL UNPROVEN.", o=o)
        base = italic_claim(base, "a weak grip does not kill you",  (56, H - HEAD_BOTTOM - 210), "CYAN", o=o, size=44)
        base = italic_claim(base, "it marks a body losing its reserve", (56, H - HEAD_BOTTOM - 138), "GOLD", o=o, size=44)
        base = cite(base, "LEONG 2015 INTERPRETATION: WHETHER RAISING STRENGTH LOWERS MORTALITY IS UNTESTED", o=o)

    # ============================== m05 · THE TEST ==========================
    elif B["m05"][0] - 0.35 <= tt <= B["m05"][1] + 1.6:
        o = win(tt, B["m05"]); s0 = B["m05"][0]
        base = scrim(base, top=0.30, bottom=0.74)
        steps = [("01", "SIT. ARMS CROSSED ON YOUR CHEST."), ("02", "FEET FLAT. BACK STRAIGHT."),
                 ("03", "STAND AND SIT. COUNT THEM.")]
        for i, (n, s_) in enumerate(steps):
            a = s0 + 2.5 + i * 1.05
            p = ip(tt, [a, a + 0.5], [0, 1])
            if p <= 0.01:
                continue
            base = put(base, text_img(n, "mono", 25, "GOLD", tracking=2.0), (56, 1160 + i * 76), "lt",
                       opacity=p * o, shadow=False)
            base = put(base, text_img(s_, "anton", 42, "INK"), (116, 1154 + i * 76), "lt",
                       opacity=p * o, clip=p)
        # the clock's face: ring + count, top-right
        ph, cnt, sp = stand_clock(tt)
        base = hud_gauge(base, tt, s0 - 0.5, 0.30, 0.55, "GRAVITY LOAD", "TEAL", live=True)
        if tt > s0 + 2.4:
            base = ring(base, (W - 210, 700), 118, "GOLD", 6, 0.30)
            base = ring(base, (W - 210, 700), 118, "GOLD", 10, 0.75, 0, min(1, cnt / 12))
            base = put(base, text_img(f"{cnt}", "anton", 132, "GOLD"), (W - 210, 700), "cm",
                       glow="GOLD2", glow_px=26)
            base = put(base, text_img("STANDS", "mono", 20, "INK", tracking=4.0), (W - 210, 800), "ct", shadow=False)
        base = head(base, "THE 30\nSECOND TEST.", "sit to stand, arms crossed", o=win(tt, [B["m05"][0] - 0.2, B["m05"][0] + 2.6]))
        base = cite(base, "30-SECOND CHAIR STAND · RIKLI & JONES 1999 · CDC STEADI FALL-RISK SCREEN", o=o)

    # ============================== m06 · THE NUMBER ========================
    elif B["m06"][0] - 0.35 <= tt <= B["m06"][1] + 0.35:
        o = win(tt, B["m06"]); s0 = B["m06"][0]
        base = scrim(base, top=0.34, bottom=0.72)
        base = stat_stamp(base, tt, s0 + 0.35, "12", None, "GOLD", size=200, xy=(56, 640), anchor="lt")
        base = put(base, text_img("STANDS IN 30 SECONDS", "mono", 22, "INK", tracking=3.2), (60, 842), "lt",
                   opacity=ip(tt, [s0 + 0.6, s0 + 1.0], [0, 1]) * 0.85, shadow=False)
        base = italic_claim(base, "below average after sixty", (56, 884), "CYAN", o=ip(tt, [s0 + 1.1, s0 + 1.6], [0, 1]), size=40)
        # norms ladder (below-average cut-offs)
        rows = [("MEN 60-64", 14), ("WOMEN 60-64", 12), ("MEN 65-69", 12), ("WOMEN 65-69", 11)]
        y = 1020
        for i, (lab, v) in enumerate(rows):
            p = ip(tt, [s0 + 1.5 + i * 0.42, s0 + 1.9 + i * 0.42], [0, 1])
            if p <= 0.01:
                continue
            d = ImageDraw.Draw(base)
            d.rectangle([56, y + 8, 56 + int(200 * p), y + 14], fill=C["DIM"])
            base = put(base, text_img(lab, "mono", 17, "INK", tracking=1.6), (56, y - 16), "lt",
                       opacity=p * 0.85, shadow=False)
            base = put(base, text_img(f"{v}", "anton", 38, "GOLD"), (292, y - 16), "lt", opacity=p)
            y += 60
        # the live count keeps running under the number
        ph, cnt, sp = stand_clock(tt)
        base = glow_dot(base, (W - 90, 1010), 14 + 26 * sp, "GOLD", 0.3 + 0.4 * sp)
        base = cite(base, "BELOW-AVERAGE CUT-OFFS · RIKLI & JONES 1999 · N=7,183 · THE LANCET-INDEXED NORMS", o=o)

    # ============================== m07 · THE FIX ===========================
    elif B["m07"][0] - 0.35 <= tt <= B["m07"][1] + 0.35:
        o = win(tt, B["m07"]); s0 = B["m07"][0]
        base = scrim(base, top=0.30, bottom=0.74)
        base = kicker(base, (56, 250), "THE FIX", "LOAD THE HAND", "LIKE EVERY OTHER MUSCLE YOU OWN",
                      o=win(tt, [s0 - 0.1, s0 + 3.3]))
        items = [("HANG FROM A BAR", "2 × 30 SECONDS"), ("CARRY SOMETHING HEAVY", "40 SECONDS × 3"),
                 ("ADD A LITTLE", "+2 KG EVERY TWO WEEKS")]
        for i, (a_, b_) in enumerate(items):
            a = s0 + 3.35 + i * 1.05
            p = ip(tt, [a, a + 0.5], [0, 1])
            if p <= 0.01:
                continue
            d = ImageDraw.Draw(base)
            d.rectangle([56, 300 + i * 96, 56 + int(6 * p), 368 + i * 96], fill=C["GOLD2"])
            base = put(base, text_img(a_, "anton", 46, "INK"), (86, 296 + i * 96), "lt", opacity=p, clip=p)
            base = put(base, text_img(b_, "mono", 19, "GOLD", tracking=2.4), (88, 350 + i * 96), "lt",
                       opacity=p * 0.9, shadow=False)
        base = stat_stamp(base, tt, s0 + 6.6, "+4 KG", "MEAN GRIP GAIN · 22 RANDOMISED TRIALS", "CYAN",
                          size=96, xy=(56, 700), anchor="lt")
        base = cite(base, "AKBAŞ 2025 · J CLIN MED 14:6882 · LARGEST GAINS IN THE OLDEST HANDS", o=o)

    # ============================== m08 · CTA ===============================
    elif tt >= B["m08"][0] - 0.5:
        s0 = B["m08"][0]
        base = scrim(base, top=0.26, bottom=0.80)
        base = cta_block(base, tt, s0, "COMMENT\nYOUR NUMBER.", "the stands you counted",
                         "HOW MANY DID YOU GET?", "TYPE IT BELOW", "FREE BODY-ID SCAN",
                         "MADDY · NASM-CPT · SPORTS NUTRITION")
        base = put(base, text_img("DECODE · EP 06   SOON", "mono", 19, "DIM", tracking=5.0),
                   (W / 2, 150), "ct", opacity=ip(tt, [s0 + 7.0, s0 + 7.6], [0, 1]), shadow=False)

    base = chapter(base, tt, [
        (B["m01"], "01 · THE PREDICTOR"), (B["m02"], "02 · THE STUDY"), (B["m03"], "03 · WHY THE HAND"),
        (B["m04"], "04 · THE HONEST PART"), (B["m05"], "05 · THE TEST"), (B["m06"], "06 · THE NUMBER"),
        (B["m07"], "07 · THE FIX"), (B["m08"], "08 · YOUR TURN"),
    ])
    if tt >= B["m01"][0] - 0.2:
        base = cred_third(base, tt, from_=B["m01"][0] + 1.4, hold=3.2)
    if t < 0.28:
        base = tfade(base, t / 0.28)
    base = finish(base, grain=0.055, vig=0.58, frame=int(t * FPS))
    return base
