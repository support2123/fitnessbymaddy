#!/usr/bin/env python3
"""FBM ENGINE · episode scaffolder — from a topic in the DECODER OS curriculum to a runnable episode dir.

usage:
  python3 new_episode.py --list [--pillar P03_FIRE] [--role seller|authority_builder|scroll_stopper] [--tier T2]
  python3 new_episode.py <TOPIC_ID | "slug of the title"> [--ep EP-06] [--slug SLUG]

Creates episodes/<SLUG>/ with:
  segments.json   — the DECODE 6-beat skeleton, pre-filled with the topic + hook + citation placeholder
  film_<slug>.py  — film module stub wired to filmlib (kit components, ONE clock, cold open)
  bed_<slug>.py   — bed recipe stub that reads timeline.json
  research.md     — research-gauntlet brief for this topic (angles + gate)
  README.md       — the 9-strike checklist + gates for this episode

Nothing here generates VO or renders. Strike 1 (research) and Strike 2 (script gauntlet) come first —
this tool exists so the skeleton never drifts from the doctrine.
"""
import argparse, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOPICS = json.load(open(os.path.join(ROOT, "content", "topics.json")))
CITES = json.load(open(os.path.join(ROOT, "content", "citation-library.json")))
SHOWS = json.load(open(os.path.join(ROOT, "content", "shows.json")))
BEATS = SHOWS["decode_6_beats"]


def slugify(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s)[:48]


def find_topic(q):
    q = q.strip().lower()
    for t in TOPICS["topics"]:
        if t["id"].lower() == q:
            return t
    hits = [t for t in TOPICS["topics"] if q in t["title"].lower()]
    return hits[0] if len(hits) == 1 else (hits or None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("topic", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--pillar"); ap.add_argument("--role"); ap.add_argument("--tier")
    ap.add_argument("--ep", default="EP-06"); ap.add_argument("--slug")
    a = ap.parse_args()

    if a.list or not a.topic:
        rows = TOPICS["topics"]
        for f, k in (("pillar_key", a.pillar), ("role", a.role), ("tier", a.tier)):
            if k:
                rows = [t for t in rows if t[f] == k]
        for t in rows:
            print(f"{t['id']:18} {t['role'][:17]:18} {t['tier']:3} {t['funnel'] or '—':12} {t['title'][:66]}")
        print(f"\n{len(rows)} topics · fill an episode with:  python3 tools/engine/new_episode.py <TOPIC_ID>")
        return

    hit = find_topic(a.topic)
    if not hit:
        sys.exit(f"no topic matched {a.topic!r} — run --list")
    if isinstance(hit, list):
        sys.exit("ambiguous: " + ", ".join(f"{t['id']} ({t['title'][:40]})" for t in hit))

    t = hit
    slug = (a.slug or slugify(t["title"])).upper()
    ep_dir = os.path.join(ROOT, "episodes", f"{slug}-01")
    os.makedirs(ep_dir, exist_ok=True)
    src = f"{t['pillar']} · {t.get('surface') or ''} · {t['role']} · {t['tier']}".strip(" ·")

    # ---- segments.json : the 6-beat skeleton ----
    hook = t["title"].rstrip(".")
    detail = (t["detail"] or "").rstrip(".")
    segs = {"segments": [
        {"id": "m00", "text": "Here is what we cover. ...", "stability": 0.52, "speed": 0.95,
         "_beat": "0 · contents card (speak the chapter list)"},
        {"id": "m01", "text": f"{hook}.", "stability": 0.50, "speed": 0.92,
         "_beat": "1 · REFRAME HOOK — ≤11 words, number first, no setup"},
        {"id": "m02", "text": f"{detail} ...", "stability": 0.52, "speed": 0.94,
         "_beat": "2 · REAL SYSTEM — name the anatomy precisely"},
        {"id": "m03", "text": "TODO one datum only.", "stability": 0.54, "speed": 0.94,
         "_beat": "3 · ONE DATUM + CITATION — exactly one number, sourced on screen"},
        {"id": "m04", "text": "TODO myth it kills.", "stability": 0.52, "speed": 0.93,
         "_beat": "4 · MYTH IT KILLS — a real, popular belief (red strike, one only)"},
        {"id": "m05", "text": "TODO the train-it turn.", "stability": 0.50, "speed": 0.93,
         "_beat": "5 · TRAIN-IT TURN — one concrete instruction (save-bait)"},
        {"id": "m06", "text": "TODO the handoff.", "stability": 0.50, "speed": 0.92,
         "_beat": "6 · HANDOFF — one CTA only (Body-Scan) + sign-off"},
    ],
        "gaps": {"m00": 0.55, "m01": 0.55, "m02": 0.50, "m03": 0.70, "m04": 0.50, "m05": 0.55, "m06": 0.0},
        "lead": 0.85, "tail": 3.5, "fps": 30,
        "_skeleton": "THE DECODE — 6 beats, same order, always (content/shows.json)",
        "_source_topic": dict(id=t["id"], title=t["title"], pillar=src, role=t["role"], tier=t["tier"], funnel=t["funnel"]),
        "_gates": ["Strike 1 research → research.md → Maddy YES",
                   "Strike 2 script-gauntlet → CRITICALs fixed → then VO",
                   "brand_gate.py must PASS before publish"]}
    json.dump(segs, open(os.path.join(ep_dir, "segments.json"), "w"), indent=1, ensure_ascii=False)

    # ---- film module stub ----
    film = f'''#!/usr/bin/env python3
"""DECODE {a.ep} · {t['title'][:60].upper()}  ·  1080x1920 · 30fps
Scaffolded from content/topics.json topic {t['id']} ({src}).

THE DECODE 6 beats (content/shows.json) → beat windows come from timeline.json (VO-led).
ONE CLOCK: define the living signal of THIS episode below and share it with bed_{slug.lower()}.py.
COLD OPEN: frame 0 shows the film's best moment (cold_open_t).
"""
import json, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from filmlib import *      # noqa

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(ROOT, "remotion-composer", "public", "fbm", "{slug.lower()}")
TL = json.load(open(os.path.join(HERE, "timeline.json")))
B = {{k: list(v) for k, v in TL["seg"].items()}}
TOTAL, FRAMES = TL["total"], TL["frames"]
EP = "DECODE · {a.ep}"
TITLE = "{t['title'].split()[0].upper()}"
ITEMS = ["..."]

# ---- the film's best moment (cold open source: the datum slam) -------
FLASH_SRC = B["m03"][0] + 1.10


def the_clock(t):
    """THE ONE CLOCK of this episode — drives the HUD, counters and the score.
    Replace with this episode's living signal (a rate / a phase / a count)."""
    a, b = B["m03"][0], B["m03"][1] + 0.5
    if t < a:
        return 0.0, 0
    T = t - a
    period = 1.0
    return (T / period) % 1.0, int(T / period)


def photos(t):
    """Scene stack: photo() with a camera move per beat. Keep a human body in frame."""
    return solid(t, [0, 1], [C["BG"], C["BG"]])


def frame(t: float) -> Image.Image:
    tt = cold_open_t(t, FLASH_SRC, 0.80)
    base = photos(tt)
    base = scrim(base, top=0.34, bottom=0.66)

    # BEAT 0 · contents card (top layer; hook overlays gated until it dissolves)
    if tt < B["m00"][1] + 1.2:
        base = contents_card(base, tt, B["m00"][1] + 0.35, EP, TITLE, ITEMS,
                             item_ats=[B["m00"][0] + o for o in (0.55, 1.25, 1.95, 2.65)])
        return finish(base, frame=int(t * FPS))

    # BEAT 1 · reframe hook  → Head + the film's hero visual + cold-open energy
    # BEAT 2 · real system    → kicker naming the anatomy + the render
    # BEAT 3 · ONE datum      → StatStamp (measured) or RollCounter (accumulating) + Cite + HUD
    # BEAT 4 · myth it kills  → myth_strike(base, tt, at, "MYTH", "TRUTH")
    # BEAT 5 · train-it turn  → numbered instruction rows
    # BEAT 6 · handoff        → cta_block(...)  (one CTA only)
    ph, cnt = the_clock(tt)
    base = chapter(base, tt, [
        (B["m01"], "01 · THE REFRAME"), (B["m02"], "02 · THE SYSTEM"), (B["m03"], "03 · THE NUMBER"),
        (B["m04"], "04 · THE MYTH"), (B["m05"], "05 · TRAIN IT"), (B["m06"], "06 · YOUR TURN"),
    ])
    base = cite(base, "TODO AUTHOR YEAR · JOURNAL")   # every stat needs its chip
    return finish(base, grain=0.055, vig=0.58, frame=int(t * FPS))
'''
    open(os.path.join(ep_dir, f"film_{slug.lower()}.py"), "w").write(film)

    bed = f'''#!/usr/bin/env python3
"""DECODE {a.ep} · {t['title'][:50]} — the score (recipe on bedlib, driven by timeline.json)."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools", "engine"))
from bedlib import Bed   # noqa

T = json.load(open("timeline.json"))
S = {{k: v[0] for k, v in T["seg"].items()}}
E = {{k: v[1] for k, v in T["seg"].items()}}
b = Bed(T["total"])
b.drone()
b.pad([174.61, 220.0, 261.63], 0.024, S["m00"], E["m01"])        # contents
b.tone(82.41, 0.042, S["m01"], E["m02"])                          # hook tension
b.riser(S["m03"] - 1.2, 1.2, 0.11)                                # into the datum
b.sub_drop(S["m03"] + 0.35, 0.30, 1.6); b.impact(S["m03"] + 0.35, 0.16, 40)
b.impact(S["m04"] + 0.3, 0.20, 54)                                # the myth strike
b.tone(110.0, 0.034, S["m05"], E["m06"] + 0.4)                     # train-it drive
b.sub_drop(S["m06"], 0.20, 1.8); b.impact(S["m06"], 0.18, 44)      # CTA slam
# ONE CLOCK: mirror film_{slug.lower()}.py's the_clock() with stand_tick()/heartbeat() when the episode has a rate
b.write("bed.wav")
'''
    open(os.path.join(ep_dir, f"bed_{slug.lower()}.py"), "w").write(bed)

    # citation candidates for this pillar
    sys_name = (t.get("surface") or "").lower()
    cand = [c for c in CITES["entries"] if sys_name and sys_name[:5] in c["cite_id"].lower()][:8] or CITES["entries"][:8]
    research = f"""# RESEARCH BRIEF — {t['id']} · {t['title']}
**Pillar:** {t['pillar']} ({t.get('element')} → {t.get('surface')}) · **role** {t['role']} · **tier** {t['tier']} · **funnel** {t['funnel'] or '—'}
**Doctrine:** THE DECODE, 6 beats (`content/shows.json`) · voice laws + guardrails (`docs/BRAND-GUARDRAILS.md`)
**Source topic:** `content/topics.json` → `{t['id']}` — detail: {t['detail'] or '(none)'}

## Strike 1 angles (run `workflows/research-gauntlet.js` with these briefs)
1. **anatomy** — what structure is actually involved; name it precisely (écorché-grade).
2. **stakes** — what goes wrong without it; strongest prospective/RCT evidence.
3. **importance** — force transfer / performance / longevity (ASSOCIATION language only).
4. **mistakes** — the controlled trials that killed the popular method.
5. **skip/myths** — the myth this topic kills (must be a REAL, popular belief).
6. **history** — optional colour; drop it if runtime is tight.

## Citation candidates already in the spine (`content/citation-library.json`)
{chr(10).join(f"- `{c['cite_id']}` — {c['claim']} → **{c['locked_value']}** · {c['source']} [{c['confidence_tier']}]" for c in cand)}

## Gates for this episode
- [ ] Every number resolves to a `status: locked` entry (no cite → cut, not softened)
- [ ] One datum in Beat 3 (if it needs two numbers, it is two episodes)
- [ ] Correlation vs causation bounded if this touches mortality/longevity
- [ ] `python3 tools/engine/brand_gate.py <ep_dir>` passes before publish
- [ ] Fresh-eyes audit scores ≥ 8 and no un-fixed criticals
"""
    open(os.path.join(ep_dir, "research.md"), "w").write(research)

    readme = f"""# {a.ep} · {t['title']}  ({slug}-01)

Scaffolded {__import__('time').strftime('%Y-%m-%d')} from `content/topics.json` → `{t['id']}`.
**Pillar:** {src} · **funnel:** {t['funnel'] or '—'} · **show slot:** pick from `content/shows.json`

## The DECODE (6 beats — same order, always)
| # | Beat | Budget | On-screen |
|---|---|---|---|
| 1 | Reframe hook | 0–3 s · ≤11 words | full-bleed word card |
| 2 | Real system | 3–8 s | anatomy render / diagram |
| 3 | **One datum + citation** | 8–15 s | number huge + Cite chip + Clock HUD |
| 4 | Myth it kills | 15–22 s | one red strike-through |
| 5 | Train-it turn | 22–27 s | numbered instruction (sets/reps/g) |
| 6 | Handoff (one CTA) | last 3 s | end-card + "Read your clock. Then train it." |

## Run order
```bash
python3 tools/engine/gen_vo_lib.py      episodes/{slug}-01          # or gen_vo_scratch.py --scratch
python3 tools/engine/verify_vo.py       episodes/{slug}-01
python3 tools/engine/assemble_vo.py     episodes/{slug}-01
cd episodes/{slug}-01 && PYTHONPATH=../../tools/engine python3 bed_{slug.lower()}.py && cd ../..
python3 tools/engine/mix_master.py      episodes/{slug}-01
python3 tools/engine/render_film.py     episodes/{slug}-01 episodes/{slug}-01/film_{slug.lower()}.py episodes/{slug}-01/film.mp4
python3 tools/engine/mux_av.py episodes/{slug}-01/film.mp4 episodes/{slug}-01/mix.m4a episodes/{slug}-01/reel.mp4
python3 tools/engine/qc_sweep.py        episodes/{slug}-01/reel.mp4 episodes/{slug}-01/qc
python3 tools/engine/brand_gate.py      episodes/{slug}-01
python3 tools/engine/publish_ig.py      episodes/{slug}-01/reel.mp4 episodes/{slug}-01/{slug}-01-PUBLISH.mp4
```

## Gates
- [ ] research.md → Maddy YES (Strike 1)
- [ ] script gauntlet → all CRITICALs fixed (Strike 2) → `SCRIPT-FINAL.md`
- [ ] verify_vo PASS (artifact 0, overlap ≥ 80 %)
- [ ] mix = −14.0 LUFS / −1.0 dBTP
- [ ] every sheet in `qc/` looked at + ±1 s sync spot-checks
- [ ] **brand_gate PASS** (lexicon · citations · pronouns · prices · causation)
- [ ] fresh-eyes audit ≥ 8, then publish (sterile PASS)
- [ ] cover (`make_cover.py`) + caption pack (`CAPTION.md`) + pinned comment + seeds
"""
    open(os.path.join(ep_dir, "README.md"), "w").write(readme)

    print(f"created episodes/{slug}-01/")
    for f in sorted(os.listdir(ep_dir)):
        print("  ", f)
    print("\nNEXT: Strike 1 — fill research.md, run the gauntlet, get Maddy's YES. Then Strike 2 (script) BEFORE any VO call.")


if __name__ == "__main__":
    main()
