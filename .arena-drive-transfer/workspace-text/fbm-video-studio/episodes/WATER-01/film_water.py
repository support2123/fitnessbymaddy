#!/usr/bin/env python3
"""
DECODE EP 06 · WATER · "The Tax"  —  1080x1920 · 30fps
Episode P04_WATER-02 from content/topics.json, widened into the fluid flagship.

THE DECODE 6 beats (content/shows.json) carried over a 10-beat runtime:
  0 contents · 1 reframe hook · 2 real system · 3 ONE datum + citation ·
  4 honesty (road vs lab) · 5 myth + danger (EAH) · 6 the filter (proof) ·
  7 train-it turn · 8 the receipt (cramps) · 9 handoff (one CTA)

ONE CLOCK: THE PULSE. The heart rate climbs 60 -> 69 bpm across the datum beat
(+3 bpm per 1% body water lost, Adams 2014) and settles back at 60 after the
honesty beat. The same closed form drives the on-screen beat dot, the ECG trace,
the ring and the score (bed_water.py imports pulse()).
COLD OPEN: frame 0 is the film's best moment, the +3 BPM slam.

REBUILD 2 (24 Sep 2026, after the second snapshot restore) — this module carries
every fix from the first rebuild plus the ones found in the boundary previews:
  · per-beat overlay opacity (a single top-level `o` zeroed cites + HUD from beat 2)
  · protocol rows start at ROW0 700, stamp at 1120 (kicker block ends at 400)
  · m03 trace at y 900 so it never crosses its own stat label
  · chips written as flowing prose — the wrapper wraps, we never hand-break lines
"""
import json, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from filmlib import *          # noqa

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(ROOT, "remotion-composer", "public", "fbm", "water-01")
TL = json.load(open(os.path.join(HERE, "timeline.json")))
B = {k: list(v) for k, v in TL["seg"].items()}
TOTAL = TL["total"]; FRAMES = TL["frames"]
EP = "DECODE · EP 06"
TITLE = "WATER"
ITEMS = ["THE 7,500 LITRE FACT", "THE 3 BEAT TAX", "THE 8 GLASS LIE", "THE PROTOCOL"]

# ---- the film's best moment: the +3 BPM slam (cold open source) -------------
FLASH_SRC = B["m03"][0] + 3.05


# ---------------------------------------------------------------- ONE CLOCK
def _bpm(t):
    a, c = B["m03"][0], B["m03"][1]
    d = B["m04"][1]
    if t < a:
        return 60.0
    if a <= t <= c:
        return ip(t, [a, c], [60.0, 69.0])
    if c < t <= d:
        back = min(1.0, (t - c) / max(0.8, (d - c)))
        return 69.0 - 9.0 * back
    return 60.0


def _beats(t):
    """closed-form integral of bpm/60 (beats elapsed) across the three segments"""
    a, c, d = B["m03"][0], B["m03"][1], B["m04"][1]
    tot = 0.0
    if t <= a:
        return t
    tot += a                                                        # 60 bpm
    if t <= c:
        u = t - a; T = max(0.1, c - a)
        return tot + u + (9.0 / 60.0) * (u * u / (2.0 * T))          # ramp 60->69
    T = max(0.1, c - a)
    tot += T + (9.0 / 60.0) * T * 0.5
    if t <= d:
        u = t - c; T2 = max(0.1, d - c)
        return tot + u + (9.0 / 60.0) * (u - u * u / (2.0 * T2)) - (9.0 / 60.0) * u
    tot += (d - c) - (9.0 / 60.0) * (d - c) * 0.5
    return tot + (t - d)


def pulse(t):
    """(phase 0..1, total beats int, bpm)."""
    b = _beats(t)
    return b % 1.0, int(b), _bpm(t)


def pulse_spike(ph, sharp=0.055):
    """double-thump envelope of a heartbeat, normalised 0..1"""
    return math.exp(-((ph - 0.04) / sharp) ** 2) + 0.42 * math.exp(-((ph - 0.20) / (sharp * 1.5)) ** 2)


# ---------------------------------------------------------------- photography
PHOTOS = {
    "drop":   dict(path=os.path.join(PUB, "drop_crown.jpg"),  grade=("teal_gold", 0.40), dark=0.14),
    "runner": dict(path=os.path.join(PUB, "heart_tax.jpg"),   grade=("warm",),          dark=0.16),
    "body":   dict(path=os.path.join(PUB, "body_water.jpg"),  grade=("cold",),          dark=0.10),
    "brain":  dict(path=os.path.join(PUB, "brain_fluid.jpg"), grade=("teal_gold", 0.34), dark=0.12),
    "plasma": dict(path=os.path.join(PUB, "blood_plasma.jpg"), grade=("gold", 0.30),     dark=0.14),
    "sweat":  dict(path=os.path.join(PUB, "sweat_skin.jpg"),  grade=("teal_gold", 0.30), dark=0.16),
    "salt":   dict(path=os.path.join(PUB, "salt_crystal.jpg"), grade=("cold",),         dark=0.14),
    "kidney": dict(path=os.path.join(PUB, "kidney_filter.jpg"), grade=("teal_gold", 0.34), dark=0.12),
    "glass":  dict(path=os.path.join(PUB, "glass_meal.jpg"),  grade=("warm",),          dark=0.12),
    "muscle": dict(path=os.path.join(PUB, "muscle_fiber.jpg"), grade=("teal_gold", 0.28), dark=0.16),
    # CTA close: the same vessel the protocol was taught on, pushed to gold (end-is-the-beginning).
    # Swap in hands_water.jpg here when the per-turn image budget allows — one-line change.
    "hands":  dict(path=os.path.join(PUB, "glass_meal.jpg"),  grade=("gold", 0.34),      dark=0.12),
}


def photos(t):
    """Scene stack — one camera move per window, later shots on top."""
    base = solid(t, [0, 1], [C["BG"], C["BG"]])
    S = [
        ("drop",   B["m00"][0] - 0.2, 1.02, 1.16, (0.02, 0.01), (-0.02, -0.01), 0.5),
        ("runner", B["m01"][0] - 0.4, 1.16, 1.02, (0.03, 0.02), (-0.04, -0.02), 0.6),
        ("body",   B["m02"][0] - 0.4, 1.14, 1.02, (-0.02, 0.02), (0.02, -0.02), 0.5),
        ("brain",  B["m02"][0] + 4.6, 1.06, 1.14, (0.0, 0.02), (0.0, -0.02), 0.5),
        ("plasma", B["m03"][0] - 0.4, 1.12, 1.0,  (-0.03, -0.02), (0.03, 0.02), 0.5),
        ("sweat",  B["m04"][0] - 0.4, 1.14, 1.02, (0.02, 0.0), (-0.02, 0.0), 0.5),
        ("salt",   B["m05"][0] - 0.4, 1.10, 1.02, (-0.02, 0.02), (0.02, -0.02), 0.45),
        ("drop",   B["m05"][0] + 5.2, 1.04, 1.14, (0.0, 0.0), (0.0, -0.02), 0.5),
        ("kidney", B["m06"][0] - 0.4, 1.14, 1.0,  (0.03, 0.0), (-0.03, 0.0), 0.5),
        ("glass",  B["m07"][0] - 0.4, 1.10, 1.02, (0.0, 0.03), (0.0, -0.02), 0.5),
        ("muscle", B["m08"][0] - 0.4, 1.12, 1.0,  (-0.02, 0.0), (0.02, 0.0), 0.5),
        ("hands",  B["m09"][0] - 0.5, 1.0, 1.14,  (0.0, 0.0), (0.0, -0.02), 0.6),
    ]
    for key, t0, z0, z1, p0, p1, fade in S:
        if t < t0 or t > t0 + 60:
            continue
        o = ip(t, [t0, t0 + fade], [0, 1])
        if t > B["m09"][1] + 0.4 and key != "hands":
            continue
        if o <= 0.001:
            continue
        dt = max(0.4, t - t0)
        zz = ip(dt, [0, 60], [z0, z1]); px = ip(dt, [0, 60], [p0[0], p1[0]]); py = ip(dt, [0, 60], [p0[1], p1[1]])
        p = PHOTOS[key]
        base = photo(base, p["path"], t, z=zz, pan=(px, py), opacity=o, grade=p["grade"], dark=p["dark"]).convert("RGB")
    return base


# ---------------------------------------------------------------- water FX
def ripple(base, t, at, y=1560, life=2.4, col="CYAN", alpha=0.30):
    """Expanding water surface ripple. Pure geometry + blur, cheap at 30 fps."""
    if not (at <= t <= at + life):
        return base
    u = (t - at) / life
    lay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    c = C[col]
    for k in (0.0, 0.34, 0.62):
        v = u - k
        if v <= 0:
            continue
        rr = int(60 + v * 900)
        a = int(alpha * 255 * (1 - v) ** 2)
        d.ellipse([W / 2 - rr * 1.9, y - rr * 0.42, W / 2 + rr * 1.9, y + rr * 0.42],
                  outline=c + (a,), width=max(2, int(7 * (1 - v))))
    lay = lay.filter(ImageFilter.GaussianBlur(7))
    return Image.alpha_composite(base.convert("RGBA"), lay)


def drip(base, t, t0, x=None, period=0.62, y0=250, y1=1180, o=1.0):
    """A falling glowing droplet + its splash ring — the filter beat's metronome."""
    if t < t0:
        return base
    x = W - 132 if x is None else x
    T = t - t0
    k = int(T / period); u = (T / period) % 1.0
    fall = ip(u, [0, 0.62], [0, 1])
    y = y0 + (y1 - y0) * (fall ** 1.7)                      # gravity
    if fall < 1.0:
        r = 12
        base = glow_dot(base, (x, y), r, "CYAN", 0.55 * o)
        base = glow_dot(base, (x - 5, y - 6), 4, "INK", 0.85 * o)
    else:
        su = (u - 0.62) / 0.38
        land = t0 + k * period + 0.62 * period
        if su <= 1.0:
            base = ripple(base, t, land, y=y, life=0.38, col="CYAN", alpha=0.34)
    return base


# ---------------------------------------------------------------- the HUD
def pulse_hud(base, t, show_from=None, o=1.0, x=None, y=286):
    """THE ONE CLOCK, on screen: beat dot + ring + live bpm, top-right (kit zone)."""
    if show_from is not None and t < show_from:
        return base
    x = x if x is not None else W - 96
    ph, n, bpm = pulse(t)
    sp = pulse_spike(ph)
    base = ring(base, (x, y), 46, "GOLD", width=3, alpha=0.55 * o, start=0.0, end=ph)
    base = glow_dot(base, (x, y), 20 + 18 * sp, "GOLD", (0.28 + 0.42 * sp) * o)
    base = glow_dot(base, (x, y), 7, "INK", 0.9 * o)
    tb = text_img(f"{int(round(bpm))}", "anton", 54, "GOLD")
    base = put(base, tb, (x - 96, y), "rm", opacity=o)
    base = put(base, text_img("BPM", "mono", 17, "DIM", tracking=3.0), (x - 96, y + 34), "rm",
               opacity=0.85 * o, shadow=False)
    return base


def pulse_trace(base, t, t0, xywh, span=9.0, o=1.0, col="CYAN"):
    """Scrolling ECG written by the same clock — the beat you can see."""
    if t < t0:
        return base
    x, y, w, h = xywh
    pts = []
    N = 150
    for i in range(N):
        tt = t - span + span * i / (N - 1)
        if tt < 0:
            continue
        pq, _, _ = pulse(tt)
        v = -pulse_spike(pq, 0.10)
        pts.append((i / (N - 1), 0.55 + v * 0.62))
    base = trace(base, xywh, pts, col=col, width=3, glow=12, alpha=0.9 * o)
    d = ImageDraw.Draw(base)
    d.line([(x, y + h * 0.55), (x + w, y + h * 0.55)], fill=C["DIM"] + (90,), width=1)
    return base


# ---------------------------------------------------------------- film
def frame(t: float) -> Image.Image:
    # COLD OPEN: frame 0 is the +3 BPM slam, then the film resolves back in time
    tt = cold_open_t(t, FLASH_SRC, 0.85)
    base = photos(tt)
    base = scrim(base, top=0.34, bottom=0.66)

    # ---------- BEAT 0 · contents (top layer) -------------------------------
    if tt < B["m00"][1] + 1.3:
        base = contents_card(base, tt, B["m00"][1] + 0.35, EP, TITLE, ITEMS,
                             item_ats=[B["m00"][0] + o for o in (0.85, 1.82, 2.79, 3.76)])
        base = ripple(base, tt, 0.35, y=1560, life=2.6)
        return finish(base, frame=int(t * FPS))

    o = 1.0                        # per-beat, set inside each block below

    # ---------- BEAT 1 · REFRAME HOOK --------------------------------------
    if B["m01"][0] - 0.35 <= tt <= B["m01"][1] + 0.4:
        s0 = B["m01"][0]
        o = win(tt, [s0 - 0.25, B["m01"][1] + 0.15], 0.4)
        base = head(base, "YOU ONLY\nHOLD FIVE.", it="the fleet behind every beat", o=win(tt, [s0 - 0.2, s0 + 3.4]))
        base = stat_stamp(base, tt, s0 + 1.35, "7,500 L", "PUSHED THROUGH YOUR BODY EVERY SINGLE DAY", "GOLD",
                          size=146, xy=(56, 690), anchor="lt")
        base = pulse_hud(base, tt, show_from=s0 + 1.6, o=win(tt, [s0 + 1.6, s0 + 2.2]))
        base = cite(base, "CARDIAC OUTPUT ≈ 5 L / MIN · GUYTON & HALL · TEXTBOOK OF MEDICAL PHYSIOLOGY", o=o)

    # ---------- BEAT 2 · REAL SYSTEM --------------------------------------
    elif B["m02"][0] - 0.35 <= tt <= B["m02"][1] + 0.4:
        s0 = B["m02"][0]
        o = win(tt, [s0 - 0.25, B["m02"][1] + 0.15], 0.4)
        base = kicker(base, (56, 250), "THE SYSTEM", "SIXTY PERCENT\nOF YOU IS WATER", "TWO THIRDS OF IT INSIDE YOUR CELLS",
                      o=win(tt, [s0 - 0.2, s0 + 4.4]))
        v = ip(tt, [s0 + 0.9, s0 + 2.6], [0.0, 0.60])
        base = ring(base, (W - 150, 640), 104, "GOLD", width=10, alpha=0.9, start=0.0, end=v)
        base = ring(base, (W - 150, 640), 104, "DIM", width=2, alpha=0.5, start=0.0, end=1.0)
        base = put(base, text_img(f"{int(round(v * 100))}", "anton", 84, "INK"), (W - 150, 600), "cm",
                   opacity=min(1, v * 4))
        base = put(base, text_img("PERCENT", "mono", 17, "GOLD", tracking=3.0), (W - 150, 682), "cm", shadow=False)
        base = stat_stamp(base, tt, s0 + 2.9, "42 L", "AT 70 KG · THE BRAIN ITSELF IS 73%", "CYAN",
                          size=120, xy=(56, 700), anchor="lt")
        base = pulse_hud(base, tt, o=o)
        base = cite(base, "BUONO & KOLKHORST · GRAY'S ANATOMY · MITCHELL 1945 (BRAIN WATER)", o=o)

    # ---------- BEAT 3 · ONE DATUM + CITATION ------------------------------
    elif B["m03"][0] - 0.35 <= tt <= B["m03"][1] + 0.4:
        s0 = B["m03"][0]
        o = win(tt, [s0 - 0.25, B["m03"][1] + 0.15], 0.4)
        base = kicker(base, (56, 250), "THE TAX", "SAME PACE.\nMORE BEATS.", "WHAT WATER LOSS ACTUALLY COSTS",
                      o=win(tt, [s0 - 0.2, s0 + 4.6]))
        pts = [(0.0, 0.92), (0.22, 0.78), (0.44, 0.62), (0.66, 0.44), (0.88, 0.26), (1.0, 0.20)]
        grow = ip(tt, [s0 + 0.5, s0 + 3.4], [0, 1])
        base = trace(base, (56, 900, W - 260, 250), [(x * grow, y) for x, y in pts if x * grow <= 1.0],
                     col="CYAN", width=5, glow=14)
        base = put(base, text_img("0%", "mono", 17, "DIM", tracking=2.0), (56, 1170), "lt", shadow=False)
        base = put(base, text_img("3% LOST", "mono", 17, "DIM", tracking=2.0), (56 + (W - 260) - 90, 1170), "lt",
                   shadow=False)
        base = stat_stamp(base, tt, s0 + 3.05, "+3 BPM", "CLAIMED FOR EVERY 1% OF BODY WATER LOST", "GOLD",
                          size=168, xy=(W - 56, 690), anchor="rt")
        base = pulse_trace(base, tt, s0 + 1.0, (56, 1250, W - 112, 120), span=9.0)
        base = pulse_hud(base, tt, o=o, y=1400)
        base = cite(base, "ADAMS 2014 · SPORTS MED (SYSTEMATIC REVIEW) · MONTAIN & COYLE 1992 · J APPL PHYSIOL", o=o)

    # ---------- BEAT 4 · HONESTY (road vs lab) -----------------------------
    elif B["m04"][0] - 0.35 <= tt <= B["m04"][1] + 0.4:
        s0 = B["m04"][0]
        o = win(tt, [s0 - 0.25, B["m04"][1] + 0.15], 0.4)
        base = head(base, "THE ROAD\nDISAGREES.", it="the 2% rule came from the lab", o=win(tt, [s0 - 0.2, s0 + 4.6]))
        base = honesty_chip(base, (W / 2, 640),
                            "BELOW 2%, PERFORMANCE HOLDS",
                            "in real time-trial conditions, dehydration up to about 4% of body mass did not "
                            "slow athletes down. the 2% line came from fixed-intensity lab protocols. "
                            "treat it as a baseline, never as a threat.",
                            o=ip(tt, [s0 + 0.6, s0 + 1.3, s0 + 7.6, s0 + 8.3], [0, 1, 1, 0]))
        base = stat_stamp(base, tt, s0 + 8.0, "4%", "REAL-WORLD LOSS THAT DID NOT SLOW THE TIME TRIAL",
                          "CYAN", size=118, xy=(56, 700), anchor="lt")
        base = pulse_hud(base, tt, o=o)
        base = cite(base, "GOULET 2012 · SPORTS MED (META-ANALYSIS) · CHEUVRONT & KENEFICK 2014 · COMPREHENSIVE PHYS", o=o)

    # ---------- BEAT 5 · MYTH + DANGER -------------------------------------
    elif B["m05"][0] - 0.35 <= tt <= B["m05"][1] + 0.4:
        s0 = B["m05"][0]
        o = win(tt, [s0 - 0.25, B["m05"][1] + 0.15], 0.4)
        base = myth_strike(base, tt, s0 + 1.5, "8 GLASSES A DAY", after=None, size=92,
                           xy=(56, H - HEAD_BOTTOM - 150))
        base = kicker(base, (56, 250), "NO BASIS", "ONE LINE,\nREAD HALFWAY.", "A 1945 REPORT THAT SAID FOOD COUNTS TOO",
                      o=win(tt, [s0 - 0.2, s0 + 3.2]))
        # DURATION-AWARE (added for the Hindi cut, where this beat runs shorter):
        # the danger turn starts as early as the beat allows, the chip always gets its
        # full readable hold, and when there is no room left after the fade the number
        # rides inside the chip headline instead of getting its own stamp.
        dur = B["m05"][1] - s0
        a = s0 + max(4.6, min(9.2, dur - 7.6))
        long_beat = dur >= 17.4
        chip_head = "WATER OUTRUNS SODIUM" if long_beat else "WATER OUTRUNS SODIUM\n14 DEAD SINCE 1981"
        chip_out = min(a + 7.0, s0 + dur - 0.75)
        base = put(base, text_img("BUT PAST THIRST,", "anton", 62, "INK"),
                   (56, H - HEAD_BOTTOM), "lb", opacity=win(tt, [a - 0.1, a + 1.0]))
        base = honesty_chip(base, (W / 2, 700),
                            chip_head,
                            "exercise-associated hyponatraemia. drinking past thirst dilutes blood "
                            "sodium. at least 14 athletes have died of it since 1981. this is why the "
                            "guidance is drink to thirst, not to a number.",
                            o=ip(tt, [a + 0.35, a + 1.0, chip_out - 0.6, chip_out], [0, 1, 1, 0]))
        if long_beat:
            base = stat_stamp(base, tt, a + 7.4, "14", "ATHLETES · SINCE 1981 · PREVENTABLE", "CYAN",
                              size=140, xy=(56, 700), anchor="lt")
        base = pulse_hud(base, tt, o=o)
        base = cite(base, "HEW-BUTLER 2015 · 3RD INTERNATIONAL EAH CONSENSUS · CLIN J SPORT MED · VALTIN 2002 · AJP", o=o)

    # ---------- BEAT 6 · THE FILTER (proof) --------------------------------
    elif B["m06"][0] - 0.35 <= tt <= B["m06"][1] + 0.4:
        s0 = B["m06"][0]
        o = win(tt, [s0 - 0.25, B["m06"][1] + 0.15], 0.4)
        base = kicker(base, (56, 250), "THE FILTER", "YOUR KIDNEYS\nDO THIS DAILY", "AND THIRST IS THEIR ALARM",
                      o=win(tt, [s0 - 0.2, s0 + 4.4]))
        base = roll_counter(base, tt, s0 + 0.7, s0 + 3.6, 180, step=10, col="INK", size=172,
                            label="LITRES FILTERED EVERY DAY", xy=(56, 700), anchor="lt")
        base = drip(base, tt, s0 + 0.7, x=W - 132, period=0.66, y0=300, y1=1120, o=o)
        base = stat_stamp(base, tt, s0 + 4.0, "99%", "RETURNED TO YOUR BLOOD", "GOLD", size=128,
                          xy=(56, 1210), anchor="lt")
        base = pulse_hud(base, tt, o=o, y=286)
        base = cite(base, "GUYTON & HALL · RENAL FILTRATION RATE ≈ 180 L / DAY · TEXTBOOK OF MEDICAL PHYSIOLOGY", o=o)

    # ---------- BEAT 7 · TRAIN-IT TURN -------------------------------------
    elif B["m07"][0] - 0.35 <= tt <= B["m07"][1] + 0.4:
        s0 = B["m07"][0]
        o = win(tt, [s0 - 0.25, B["m07"][1] + 0.15], 0.4)
        base = kicker(base, (56, 250), "THE PROTOCOL", "WEIGH IN.\nWEIGH OUT.", "THE ONLY NUMBER THAT IS YOURS",
                      o=win(tt, [s0 - 0.2, s0 + 4.6]))
        ROW0 = 700          # clear of the kicker block (HEAD_BOTTOM 400) — the rows live in the
        items = [("WEIGH BEFORE AND AFTER", "EVERY KILO LOST IS 1 LITRE"),   # lower half so nothing
                 ("DRINK IT BACK", "1.2 TO 1.5 TIMES THAT OVER 3 HOURS"),    # ever sits on the headline
                 ("KEEP IT SMALL", "STAY BELOW 2 PERCENT AT 70 KG")]
        for i, (a_, b_) in enumerate(items):
            a = s0 + 1.15 + i * 1.15
            p = ip(tt, [a, a + 0.5], [0, 1])
            if p <= 0.01:
                continue
            d = ImageDraw.Draw(base)
            d.rectangle([56, ROW0 + i * 96, 56 + int(6 * p), ROW0 + 68 + i * 96], fill=C["GOLD2"])
            base = put(base, text_img(a_, "anton", 44, "INK"), (86, ROW0 - 4 + i * 96), "lt", opacity=p, clip=p)
            base = put(base, text_img(b_, "mono", 18, "GOLD", tracking=2.2), (88, ROW0 + 48 + i * 96), "lt",
                       opacity=p * 0.9, shadow=False)
        base = stat_stamp(base, tt, s0 + 4.5, "1.4 KG", "THE 2% LINE AT 70 KG", "CYAN", size=124,
                          xy=(56, 1120), anchor="lt")
        base = pulse_hud(base, tt, o=o)
        base = cite(base, "ACSM POSITION STAND · 2015 EAH CONSENSUS: DRINK TO THIRST · 1.2 to 1.5 × LOSS", o=o)

    # ---------- BEAT 8 · THE RECEIPT (cramps) ------------------------------
    elif B["m08"][0] - 0.35 <= tt <= B["m08"][1] + 0.4:
        s0 = B["m08"][0]
        o = win(tt, [s0 - 0.25, B["m08"][1] + 0.15], 0.4)
        base = head(base, "THE SALT STORY\nDOESN'T HOLD.", it="cramps were never proven to be electrolytes",
                    o=win(tt, [s0 - 0.2, s0 + 4.6]))
        base = honesty_chip(base, (W / 2, 640),
                            "CRAMPS ≠ A SALT PROBLEM",
                            "across 161 kilometres, blood sodium did not separate the runners who "
                            "cramped from the ones who did not. fix fluid, sleep, load and pacing first. "
                            "sodium is a maybe, not a mechanism.",
                            o=ip(tt, [s0 + 0.6, s0 + 1.3, s0 + 7.4, s0 + 8.1], [0, 1, 1, 0]))
        base = pulse_hud(base, tt, o=o)
        base = cite(base, "HOFFMAN & STUEMPFL 2015 · SPORTS MED OPEN · 161 KM ULTRAMARATHON COHORT", o=o)

    # ---------- BEAT 9 · HANDOFF (one CTA) ---------------------------------
    elif tt >= B["m09"][0] - 0.5:
        s0 = B["m09"][0]
        o = win(tt, [s0 - 0.25, B["m09"][1] + 0.15], 0.4)
        base = cta_block(base, tt, s0, "COMMENT\nWATER.", "the litres you lost today",
                         "HOW MUCH DID YOU SWEAT OUT?", "TYPE IT BELOW", "FREE BODY-ID SCAN",
                         "MADDY · NASM-CPT · SPORTS NUTRITION")
        base = pulse_hud(base, tt, o=o, y=286)
        base = put(base, text_img("READ YOUR CLOCK. THEN TRAIN IT.", "mono", 19, "DIM", tracking=5.0),
                   (W / 2, 150), "ct", opacity=ip(tt, [s0 + 6.6, s0 + 7.3], [0, 1]), shadow=False)
        base = ripple(base, tt, s0 + 0.6, y=1300, life=2.6)

    base = chapter(base, tt, [
        (B["m01"], "01 · THE RATE"), (B["m02"], "02 · THE SYSTEM"), (B["m03"], "03 · THE TAX"),
        (B["m04"], "04 · THE HONEST PART"), (B["m05"], "05 · THE LIE"), (B["m06"], "06 · THE FILTER"),
        (B["m07"], "07 · THE PROTOCOL"), (B["m08"], "08 · THE RECEIPT"), (B["m09"], "09 · YOUR TURN"),
    ])
    if tt >= B["m01"][0] - 0.2:
        base = cred_third(base, tt, from_=B["m01"][0] + 1.4, hold=3.2)
    if t < 0.28:
        base = tfade(base, t / 0.28)
    base = finish(base, grain=0.055, vig=0.58, frame=int(t * FPS))
    return base
