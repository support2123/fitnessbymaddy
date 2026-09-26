# CONTENT ENGINE — how the 150-topic system actually runs
> The doctrine: *The variable is the container. The constant is the move.* Every post is a DECODE: **reframe → real system → one datum + citation → myth it kills → train-it turn → handoff.**
> Machine twins: `content/topics.json` · `content/topics.md` · `content/QUEUE.md` · `content/shows.json` · `content/hooks.json` · `content/citation-library.json` · `content/funnel.json`.

---

## 1 · THE CURRICULUM (15 pillars / 150 topics)
| # | Pillar (internal) | Surface name | Topics |
|---|---|---|---|
| 1 | SPACE — the synapse | **NEURAL** | 10 |
| 2 | AIR — the lung | **RESPIRATORY** | 10 |
| 3 | FIRE — the cell | **METABOLIC** | 12 |
| 4 | WATER — body fluid | **FLUID** | 11 |
| 5 | EARTH — the frame | **STRUCTURAL** | 11 |
| 6–15 | Sleep · Stress/Cortisol · Nutrition · Hormones · Recovery · Mobility · Women's Physiology · Ageing/Longevity · Mental Performance · Habit/Behavior | (plain-English names) | 9–14 each |

**Surface-naming policy (locked):** SPACE/AIR/FIRE/WATER/EARTH are **internal taxonomy only**. On any client-facing frame, caption or VO use **NEURAL · RESPIRATORY · METABOLIC · FLUID · STRUCTURAL**. Reason: the elemental names are the *pancha mahabhuta* and read as woo to exactly the skeptic we're courting (Critic-2 Tier-0).
**Pillar→program routing:** METABOLIC→Burn & Build→Customised · RESPIRATORY→HIIT→Customised · FLUID→Women/PCOS→Customised · STRUCTURAL→40+→Customised/Live · NEURAL→the adherence layer inside Customised & Live.
**Feed mix target (per 10 slots):** 55 % authority-builder · 30 % scroll-stopper · 15 % seller.
**Tag legend:** role (SS scroll-stopper · AB authority-builder · SL seller) × tier (T1 unaware → T5 peer) × funnel target. Every topic carries all three in `content/topics.json`.

## 2 · HOW A TOPIC BECOMES AN EPISODE (the 9 strikes)
| Strike | Stage | Tool | Gate |
|---|---|---|---|
| 1 | **Research** | `workflows/research-gauntlet.js` + the 6-angle brief | Maddy YES on the spine |
| 2 | **Script** | `workflows/script-gauntlet.js` → `SCRIPT-FINAL.md` | all CRITICALs fixed (mis-cites, overclaims, banned words) |
| 3 | **Voice** | `gen_vo_lib.py` (or `--scratch`) | `verify_vo.py` PASS (orphan audio ≤ 0.30 s, number eye-read) |
| 4 | **Timeline** | `assemble_vo.py` | beat windows follow the VO, not the reverse |
| 5 | **Score** | `bedlib.py` + `bed_<ep>.py` | one clock shared with the film |
| 6 | **Film** | `filmlib.py` + `film_<ep>.py` + `render_film.py` | preview stills looked at; no collisions |
| 7 | **QC** | `mix_master.py` + `qc_sweep.py` | −14.0 LUFS / −1.0 dBTP, decode clean, contact sheets read |
| 8 | **Fresh eyes** | `workflows/fresh-eyes-audit.js` | score ≥ 8, no un-fixed criticals |
| 9 | **Publish** | `publish_ig.py` + `make_cover.py` + caption pack | sterile PASS + `brand_gate.py` PASS |

Scaffold a new one with: `python3 tools/engine/new_episode.py <TOPIC_ID>` — it writes `segments.json` (6-beat skeleton), `film_<slug>.py`, `bed_<slug>.py`, `research.md`, `README.md`.

## 3 · THE FORMAT SLATE (9 formats, one system)
Mon **SCAN** (science reel) · Wed **STOP** (myth-bust) · Fri **RECEIPTS** (transformation) · Sun **FORM LAB** (Live) · daily **SCAN OF THE DAY** (stories) · monthly **MADE OF FIVE** (long-form tentpole) · carousels (Explain-Like-A-Scan) · Shorts cutdowns · SIT-DOWN (talking-head). Specs, KPIs and routing: `content/shows.json`.

## 4 · CAPTION (fixed 4 blocks — never re-ordered)
1. The reframe restated in one line (this is the previewed line → it must hook).
2. The number + **full citation**.
3. The myth killed (one).
4. The train-it instruction + the CTA (Body-Scan) + the keyword ask.
Sources footer: `Author YEAR · Journal · Author YEAR · Journal`. Platform spec + pins: `docs/PLAYBOOK.md` §7.

## 5 · THE CADENCE FLOOR
**Minimum-viable week (never go below):** 1 science reel + 1 myth-bust + 1 story sequence. A great theory week can't out-earn a shipped average week — the Wall (revenue per 1,000 reach) only moves when something ships.

## 6 · WHAT'S SAVED WHERE
| File | What it answers |
|---|---|
| `content/topics.json` / `topics.md` | what are the 150 topics, tagged + routed |
| `content/QUEUE.md` | what ships next (ordered, dated) |
| `content/hooks.json` | how to open (archetypes, bank, ready 20, bans) |
| `content/shows.json` | the 6 beats, the 8 shows, the 9 formats, naming |
| `content/citation-library.json` | what we may claim, at what strength, with what value |
| `content/funnel.json` | how a viewer becomes a Body-ID, a buyer, a receipt |
| `content/critic-backlog.json` | what's still missing / overclaimed (Critic 1 & 2) |
| `docs/BRAND-GUARDRAILS.md` | what we may NOT say, ever |
| `docs/PLAYBOOK.md` | hook / retention / format / platform craft |
| `docs/PIPELINE-OS.md` | agents, factory, metrics, flywheel, org |
| `docs/ROADMAP-90-DAY.md` | the rollout, week by week, with exit criteria |
| `docs/ERRATA-AND-CONFLICTS.md` | every place the sources disagree, and what we locked |
| `docs/FBM-PIPELINE-WORLD-CLASS.md` | the 9-stage production pipeline (master) |
