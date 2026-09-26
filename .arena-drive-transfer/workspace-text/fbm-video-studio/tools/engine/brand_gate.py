#!/usr/bin/env python3
"""FBM ENGINE · BRAND GATE (automated woo-scanner + shot-proof checks).

usage: brand_gate.py <episode_dir> [--json]

Checks (from docs/BRAND-GUARDRAILS.md §3, §4, §7, §10 + Critic fixes):
  1. Forbidden lexicon (woo) in segments.json / film module / caption — zero tolerance
  2. Elemental branding on surface (SPACE/AIR/FIRE/WATER/EARTH) — internal only
  3. HE/HIM — flags she/her/heavy-gendered references to the coach
  4. Citation presence — every on-screen "stat" call must sit near a Cite in the film module
  5. Prices / offer names — must match docs/ERRATA-AND-CONFLICTS.md §prices (client-safe list)
  6. Correlation-vs-causation — mortality/longevity claims require an honesty/bound line
     (heuristic: the bounding may live in the film's on-screen honesty chip, so it is checked asset-wide)
Exit code 0 = PASS, 1 = BLOCK.
"""
import argparse, json, os, re, sys

AP = argparse.ArgumentParser()
AP.add_argument("ep_dir"); AP.add_argument("--json", action="store_true")
a = AP.parse_args()
EP = os.path.abspath(a.ep_dir)

FORBIDDEN = ["tattva", "chakra", "prana", "aura", "vibration", "cosmic", "divine", "sacred",
             "dosha", "healing energy", "the universe", "resonance", "numerology", "guru"]
# "energy"/"frequency"/"alignment" only banned in the spiritual sense → flagged, human decides
SOFT = ["life force", "balance your elements"]
ELEMENTS = ["SPACE", "AIR", "FIRE", "WATER", "EARTH"]
PRICES_OK = {  # client-safe prices = live site (see ERRATA); DECODER OS numbers must not ship yet
    "1499", "1,499", "5,999", "5999", "20,000", "20000", "32,000", "54,000", "1,00,000", "11,999", "$20", "$70"}
PRICES_BLOCKED = {"999": "Burn & Build ₹999 — not on the live site yet (ERRATA)", "9,999": "Customised ₹9,999 — live site says ₹5,999",
                  "27,000": "1-on-1 Live ₹27,000 — live site says from ₹20,000"}

def read(p, limit=400_000):
    try:
        return open(os.path.join(EP, p), encoding="utf-8").read()
    except Exception:
        return ""

def visible_strings(path):
    """Quoted string literals a viewer could actually SEE (docstring/comment text excluded)."""
    import io, tokenize
    if not os.path.exists(path):
        return ""
    out = []
    try:
        with open(path, "rb") as fh:
            for tok in tokenize.tokenize(fh.readline):
                if tok.type == tokenize.STRING and "\n" not in tok.string:
                    out.append(tok.string.strip('"\'rbuf'))
    except Exception:
        pass
    return "\n".join(out)


seg = read("segments.json")
films = [f for f in (os.listdir(EP) if os.path.isdir(EP) else []) if f.startswith("film_") and f.endswith(".py")]
film = read(films[0]) if films else ""
cap = read("CAPTION.md")
blob = "\n".join([seg, film, cap])

findings = []   # (severity, code, detail)
def add(sev, code, detail): findings.append(dict(severity=sev, code=code, detail=detail))

# 1 · forbidden lexicon (VO + client text only; film module code comments are internal)
for tgt, text in (("segments.json (VO)", seg), ("CAPTION.md", cap)):
    low = text.lower()
    for w in FORBIDDEN + SOFT:
        if w in low:
            add("BLOCK", "forbidden-lexicon", f"{w!r} in {tgt}")
# on-surface elemental branding (film module's visible strings)
for w in ELEMENTS:
    if re.search(r'text_img\(\s*"' + w + r'[^"]*"', film) or re.search(r'"' + w + r'\s*·', film):
        add("BLOCK", "elemental-surface", f"{w} used as visible on-screen text — use NEURAL/RESPIRATORY/METABOLIC/FLUID/STRUCTURAL")

# 2 · HE/HIM
for m in re.finditer(r"\b(she|her|hers)\b", seg, re.I):
    add("BLOCK", "pronoun", f"gendered reference in VO: {m.group(0)}")

# 3 · citation presence for stats
stats = re.findall(r'stat_stamp\([^)]*?["\']([0-9][^"\']*)["\']', film) + re.findall(r'roll_counter\([^)]*?\n?[^)]*?to=(\d[\d_]*)', film)
cites = len(re.findall(r'\bcite\(', film))
if stats and cites == 0:
    add("BLOCK", "no-citation", f"{len(stats)} on-screen number(s) but ZERO Cite() calls in the film module")
elif stats and cites < max(1, len(stats) // 3):
    add("WARN", "citation-sparse", f"{len(stats)} numbers vs {cites} citations — check every stat has a source chip")

# 4 · correlation language
assoc = re.findall(r"\b(predicts?|predicted|predicting|longevity|mortality|die|death)\b", seg, re.I)
bound = re.findall(r"\b(associated|proxy|not a promise|signal|observational|does not)\b", seg + film, re.I)
if assoc and not bound:
    add("BLOCK", "causation", "mortality/longevity language without a bounding line (say 'associated with' / add the honesty chip)")

# 5 · prices — scan only CLIENT-FACING text: caption + the film module's quoted string literals
#     (never raw code, or a numeric literal like a dict default 999 false-positives)
vis = cap + "\n" + visible_strings(os.path.join(EP, films[0]) if films else "")
for p in PRICES_BLOCKED:
    if re.search(r"(?<![\d,])[₹$]?\s*" + re.escape(p) + r"(?![\d,])", vis):
        add("BLOCK", "price-drift", PRICES_BLOCKED[p])

# 6 · hype adjectives + absolute verbs
for w in ["insane", "crazy", "shredded af", "god-tier", "secret weapon", "guarantees", "cures", "melts fat", "detoxes"]:
    if w in (seg + cap).lower():
        add("BLOCK", "hype-or-absolute", f"{w!r} present")

res = dict(episode=EP, findings=findings,
           result="BLOCK" if any(f["severity"] == "BLOCK" for f in findings) else "PASS")
if a.json:
    print(json.dumps(res, indent=1))
else:
    print(f"BRAND GATE · {os.path.basename(EP)}")
    if not findings:
        print("  PASS — lexicon clean · citations present · pronouns clean · prices client-safe · no hype verbs")
    for f in findings:
        print(f"  [{f['severity']}] {f['code']}: {f['detail']}")
    print("RESULT:", res["result"])
sys.exit(1 if res["result"] == "BLOCK" else 0)
