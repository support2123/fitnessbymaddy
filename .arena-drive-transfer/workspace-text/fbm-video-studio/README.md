# FBM REEL PIPELINE — end-to-end science-reel engine (DECODE series)

A complete, battle-tested pipeline that turns a topic into a publish-ready Instagram science reel:
**research → adversarial script QA → VO (hard gates) → VO-led timeline → synthesized score → designed film → QC sweep → independent audit → sterile publish.**

Shipped so far: **STRENGTH · BREATH · CORE · ENDURANCE** (4 episodes)
**New in this repo: EP-05 · GRIP** — first episode produced by the *portable* engine
(no Mac, no browser, no GPU, no API key needed to build the film).

---

## Two render paths, one grammar

| | Production path (original) | Portable path (this repo, EP-05) |
|---|---|---|
| Film | Remotion + three.js (`src/fbm/…`) | `tools/engine/filmlib.py` — same kit, ported to Pillow |
| Needed | Node 20, Chromium, `--gl=angle` | Python 3 + Pillow + ffmpeg |
| VO | ElevenLabs clone (`tools/engine/gen_vo.py`) | same tool — `gen_vo_scratch.py` for offline timelines |
| Output | identical 1080×1920/30 films, same layout law | ✔ |

The **kit components are identical in both** — `Head`, `Cite`, `Chapter`, `StatStamp`,
`RollCounter`, `ItalicClaim`, `HonestyChip`, `CTABlock`, `CredThird`, `ContentsCard`,
`coldOpen` — so a lesson learned once is enforced everywhere.

## The 9-stage flow (full SOP in `docs/ENGINE-PLAYBOOK.md`)
1. **RESEARCH** — `workflows/research-gauntlet.js` (6 angles, each fact cited + hook-scored). Gate: Maddy approves before any script. → `docs/RESEARCH-GRIP-01.md`
2. **SCRIPT** — `workflows/script-gauntlet.js` (retention · facts · TTS-safety · brand). Gate: all CRITICALs fixed **before** a single TTS call. → `episodes/GRIP-01/SCRIPT-FINAL.md`
3. **VOICE** — `gen_vo.py` (ElevenLabs clone, sealed settings) or `gen_vo_scratch.py` (offline). Gate: `verify_vo.py` — manifest-driven + whisper dual-model overlap + artifact scan (>0.3 s orphan = FAIL).
4. **TIMELINE** — `assemble_vo.py` → `vo.wav` + `timeline.json`. **Audio leads, visuals follow.**
5. **SCORE** — `bedlib.py` recipe per episode (`episodes/GRIP-01/bed_grip.py`), impacts land on measured beats; `mix_master.py` = sidechain duck + two-pass LINEAR loudnorm → **-14.0 LUFS / -1.0 dBTP** (verified in output).
6. **FILM** — `episodes/GRIP-01/film_grip.py`, every beat window from `timeline.json`; one clock drives the visual pulse, the on-screen count and the score.
7. **QC SWEEP** — `qc_sweep.py` → specs, decode check, loudness, AI-marker scan, timestamped contact sheets. Look at EVERY sheet.
8. **FRESH EYES** — `workflows/fresh-eyes-audit.js` (independent creative director + compliance auditor, scored /10).
9. **PUBLISH** — `publish_ig.py` strips every container/tool marker; sterile PASS required. Cover via `make_cover.py`, caption via `CAPTION.md`.

## Run an episode (portable path)
```bash
zsh tools/engine/bootstrap_env.sh                      # once per machine
export ELEVENLABS_API_KEY=...   FBM_VOICE_ID=...       # real VO (never committed)
zsh tools/engine/run_episode.sh episodes/GRIP-01 episodes/GRIP-01/film_grip.py --scratch
# → episodes/GRIP-01/GRIP-01-PUBLISH.mp4   (+ qc/ sheets)
```
Single steps: `gen_vo_lib.py` → `verify_vo.py` → `assemble_vo.py` → `bed_*.py` → `mix_master.py` → `render_film.py` → `mux_av.py` → `qc_sweep.py` → `publish_ig.py`.
Preview one design frame without rendering: `render_film.py <ep> <film.py> /tmp/f.png --preview 42.5`

## Hard rules that are easy to lose
1. English only, secular, science-cited on screen (author+year on every stat), thin evidence honestly bounded.
2. ONE consistent voice; emotion via sentence craft + subtle per-line settings, never voice-splicing.
3. Audio-only fix = **REMUX** over the last render (`mux_av.py`), never a fresh render.
4. Comment trigger = a literal answer the viewer can type without translating.
5. The word "AI" never appears in client-facing text; the publish gate enforces zero tool metadata.
6. A translucent **human body must be in frame** — an isolated organ reads cold and gets rejected.

## The content OS that drives the engine (added 2026-09-24)
The pipeline no longer starts at "pick a topic" — it starts at **THE DECODER OS** (full text: `docs/DECODER-OS.md`):

- **THE DECODE — 6 beats, every post:** reframe → real system → **one datum + citation** → myth it kills → train-it turn → handoff (one CTA). Skeleton + naming: `content/shows.json`.
- **150 topics, 15 pillars:** `content/topics.json` / `topics.md` — every topic tagged role (SS/AB/SL) · tier (T1–T5) · funnel program.
- **Citation spine:** `content/citation-library.json` (58 claims, all `status: locked`) — *no cite → cut, never soften*.
- **Hooks:** `content/hooks.json` (15 archetypes + 15-hook reframe bank + 20 ready hooks + do-not list).
- **Funnel:** `content/funnel.json` (value ladder · comment keywords SCAN/BURN/CONDITION/FLUID/FRAME/FOCUS · DM ladder · metric model · revenue per 1,000 reach).
- **Queue:** `content/QUEUE.md` — Wave 1 (launch slate, #4 already shipped) · Wave 2 (closing the critic gaps).
- **Rules & craft:** `docs/BRAND-GUARDRAILS.md` (10-point pre-publish gate, forbidden lexicon, surface-naming policy, medical scope) · `docs/PLAYBOOK.md` · `docs/PIPELINE-OS.md` · `docs/CONTENT-ENGINE.md` · `docs/ROADMAP-90-DAY.md` · `docs/CRITIC-BACKLOG.md` · `docs/ERRATA-AND-CONFLICTS.md`.
- **New tools:** `python3 tools/engine/new_episode.py --list` (browse 150 topics) · `new_episode.py <TOPIC_ID>` (scaffold a full episode dir) · `python3 tools/engine/brand_gate.py episodes/<EP>` (pre-publish scan: woo lexicon · elemental names · citations · pronouns · price drift · hype verbs).

**Naming law:** SPACE/AIR/FIRE/WATER/EARTH are internal taxonomy only. Every client-facing frame uses **NEURAL · RESPIRATORY · METABOLIC · FLUID · STRUCTURAL**.

## Secrets
Nothing sensitive lives in this repo: the ElevenLabs key comes from `ELEVENLABS_API_KEY`
(env or `~/.fbm.env`) and the cloned voice from `FBM_VOICE_ID` (env or the episode's
`voice.txt`, which is git-ignored). Fonts are Google-Fonts open licence.
