# FBM Reel Studio

The end-to-end, doctrine-locked production system for FitnessByMaddy science reels.

This directory is intentionally separate from the static website at the repository root. It does **not** change the live site or publish to Instagram by itself.

## What is locked

- Full-bleed, cover-locked hero from frame zero. No black or contents-card opens.
- Runtime router: Tier A (15–30s), B (30–60s), or C (60–120s), always choosing the shortest complete teaching shape.
- Twelve hook archetypes, named-vs-teased slate tracking, and the Viral 6/6 pass gate.
- Design tokens, safe-zone law, living-clock specification, type hierarchy, sound protocol, and technical delivery spec.
- Citation-first scripts, voice verification, audio-led timelines, QC, Fresh Eyes score **>= 8.5**, brand gate, and sterile publish.

Read `docs/OPERATING-LAYER.md` first. The complete upstream source doctrine remains immutable in `doctrine/source/`.

## Studio layout

```text
reel-studio/
├── config/studio.json          # machine-readable production constants
├── content/                    # citations, topics, hooks, shows, hero concepts, slate state
├── doctrine/source/            # imported master spec and the three doctrines
├── docs/                       # operating layer + inherited research/brand documentation
├── tools/engine/               # portable tools and reusable film components
├── episodes/                   # one folder per reel; only source/metadata is committed
├── templates/                  # request card and episode manifest
└── tools/ops/                  # intake, hero planning, preflight gates
```

## Start a reel

Use a Request Card, not a loose prompt:

```text
TOPIC: Why women do not become bulky from lifting
DURATION: auto
TIP: Correct the testosterone myth and give a first-week strength protocol.
```

Create the episode shell:

```bash
cd reel-studio
python3 tools/ops/intake.py \
  --topic "Why women do not become bulky from lifting" \
  --duration auto \
  --tip "Correct the testosterone myth and give a first-week strength protocol." \
  --episode WOMEN-BULKY-01
```

The command makes `episodes/WOMEN-BULKY-01/` with a request record, planning decision, production manifest, research brief, script skeleton, and hero directory. It deliberately stops **before** voice generation: Research approval and the final script are human gates.

## Hero open

Plan the cover-locked first frame after the script spine is approved:

```bash
python3 tools/ops/hero_open.py episodes/WOMEN-BULKY-01 --concept "THE CONFRONTATION GAZE"
```

It writes a generation-ready prompt, framing map, exact first-second movement plan, and cover-lock checklist. Generate the still without baked text, composite the type in the film, and record the final still path in `hero/hero-open.json` before rendering.

## Produce, then gate

The inherited portable engine remains available under `tools/engine/`.

```bash
# once on a production machine
zsh tools/engine/bootstrap_env.sh

# after research + final script + hero asset exist
zsh tools/engine/run_episode.sh episodes/WOMEN-BULKY-01 episodes/WOMEN-BULKY-01/film_women_bulky.py --scratch

# do not publish from a scratch narration authority asset
zsh tools/engine/swap_voice.sh episodes/WOMEN-BULKY-01 episodes/WOMEN-BULKY-01/film_women_bulky.py

# before release
python3 tools/ops/preflight.py episodes/WOMEN-BULKY-01
```

`preflight.py` requires the 10 strikes to be recorded. It does not accept a technical render as proof of a good reel: hero/cover, script 6/6, world-class QC, Fresh Eyes >= 8.5, citation and brand gates all have to be green.

## Secrets and heavy media

- Voice credentials only live in environment variables or `~/.fbm.env`; never commit them.
- Keep raw hero images, raw VO, render intermediates, and full upload masters out of Git. The `.gitignore` protects the common paths.
- Preserve source, prompt, cover-lock JSON, timeline, script, citations, audit, caption, and the final master checksum so any episode can be rebuilt exactly.

## No automatic posting

A final, sterile H.264 master, cover PNG, caption, pinned comment, source list, and metric handoff are produced for human upload. Publishing remains a deliberate human action.
