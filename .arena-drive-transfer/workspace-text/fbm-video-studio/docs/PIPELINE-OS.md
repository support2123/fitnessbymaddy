# FBM DECODER OS — THE SYSTEM (agents · factory · metrics · flywheel)
> Source: `docs/DECODER-OS.md` §3 (Decode Engine + citation spine) · §6 (Format & Platform OS) · §8 (Proof Moat) · §9 (The Machine) · §10 (90-day rollout) · §11 (Brand-safety) · Critic appendix.
> This is the *operating* layer. Craft rules → `docs/PLAYBOOK.md`. Hard bans → `docs/BRAND-GUARDRAILS.md`. Money → `content/funnel.json`.

---

## 1 · THE 13-AGENT CONTENT OS
Two ways to run this system: **the AI-agent version** (what the OS document specifies) and **the pipeline version shipped here** (scriptable, reproducible, no Node/Tool dependency).

| # | Agent | Job | Ship status in this repo |
|---|---|---|---|
| 1 | **Research** | 6-angle gauntlet per topic, citation-first | ✅ `workflows/research-gauntlet.js` + `episodes/*/research.md` (+ `new_episode.py` writes the brief) |
| 2 | **Script** | DECODE 6-beat script from the research pack | ✅ `workflows/script-gauntlet.js` → `episodes/*/SCRIPT-FINAL.md` (EP-05 shipped) |
| 3 | **Hook** | generate + score 15–20 hooks, pick one | ✅ engine in `content/hooks.json` (archetypes + bank + do-not list) |
| 4 | **Voice** | cloned VO, style 0, lints | ✅ `gen_vo_lib.py` + `verify_vo.py` (gate) — ⚠ blocked on the real voice ID (see Pending) |
| 5 | **Timeline** | word-level VO → beat windows (one clock) | ✅ `assemble_vo.py` → `timeline.json` |
| 6 | **Score** | bed synthesized to the timeline, phase-locked | ✅ `bedlib.py` + `bed_<ep>.py` |
| 7 | **Film** | the DECODE beats rendered over real footage | ✅ `filmlib.py` + `film_<ep>.py` + `render_film.py` (1080×1920@30) |
| 8 | **QC** | specs, decode, loudness, AI-marker scan, contact sheets | ✅ `qc_sweep.py` (+ `mix_master.py` for −14.0 LUFS / −1.0 dBTP) |
| 9 | **Fresh-eyes** | adversarial audit, score ≥ 8 to ship | ✅ `workflows/fresh-eyes-audit.js` → `FRESH-EYES-AUDIT.md` (EP-05: 8.1/10) |
| 10 | **Publish** | sterile export (no metadata/SEI), cover, caption, pinned comment | ✅ `publish_ig.py` + `make_cover.py` + `CAPTION.md` |
| 11 | **Funnel** | comment-keyword → DM ladder → quiz → plan | 🟡 doctrine locked (`content/funnel.json`); wiring on the site/GHL side pending |
| 12 | **Analytics** | ER, save/share rate, revenue-per-1,000-reach | 🟡 metric model defined; needs a sheet/BI hookup |
| 13 | **Critic** | adversarial gaps + overclaim audit (Critic 1 & 2) | ✅ backlog persisted: `docs/CRITIC-BACKLOG.md` + `content/critic-backlog.json` |

Bootstrap in the DECODER OS (W1–2 of the rollout): **Maddy_v1** voice preset · **Cite_v1** preset · `citation-library.json` seeded with 30 locked claims · Z-Anatomy glTF anatomy assets · LUTs **Editorial Athletic** (hero) / **Clean Athletic 40 %** (utility). In this repo the citation library is seeded with **50 locked claims** and the anatomy layer is satisfied by generated stills + écorché renders until GLBs land.

---

## 2 · THE TWO PRODUCTION LINES
- **LINE A — the engine render** (this repo): Remotion **reference path** (`src/fbm/kit/FbmFilmKit.tsx`, `src/fbm/films/*.tsx`) and the **portable Python path** (`tools/engine/*`, the shipped EP-05 route). Deterministic, scriptable, cheap to iterate: `render_film.py` → `-c copy` splice for design fixes → one crf20 delivery pass.
- **LINE B — the studio line** (DaVinci Resolve): where human-grade editorial time is spent on hero films (MADE OF FIVE tentpoles) — colour, sound polish, longer cut. Both lines converge on the same **QC + brand gate + publish** tail.
- **Handoff rule:** anything that leaves Line B must still pass `qc_sweep.py` + `brand_gate.py` + sterile export — the tail is shared, so no asset escapes the doctrine.

## 3 · THE CITATION LIBRARY (the actual moat)
`content/citation-library.json` — every claim that can be spoken on camera, with: `cite_id`, claim, **locked value**, source, **confidence tier**, status, and the honesty note.
- **Rule:** *no cite → cut, never soften.*
- Confidence tiers drive the verbs (fact / "one study found" / "an estimate").
- Reference bodies: 70 kg M default; 60 kg F when female-specific — state the difference.
- Myth-kill receipts (15 entries) and the graveyard live in `docs/BRAND-GUARDRAILS.md` §7.
- Errata: any changed value is logged in `docs/ERRATA-AND-CONFLICTS.md` and the old asset is corrected, not deleted.

## 4 · THE METRIC MODEL (what we watch, in what order)
North star = **share-rate** (shares > saves on hero content) — the signal that the *authority* is landing, not just the reach.
Leading indicators: save-rate 1–3 % · follow-rate 3–8 % on breakouts (baseline ER 0.16 % → target 0.5 % by day 90 → 1 %+ by day 180).
Funnel instrumentation: quiz-starts (~0.13 % of reach) → completion 60–75 % → capture 90 %+ → quiz→tripwire 4–8 % → tripwire→core 8–15 % → core→Live 5–10 %.
**The wall number: revenue per 1,000 reach** — folds ER, quiz conversion and ascension into one honest figure. Targets per lesson use UTM `content=system-topic` so we learn which *lesson* sells (the same data the topic table's `→program` column predicts).
Illustrative steady-state arithmetic lives in `content/funnel.json → steady_state_illustration` — **labelled illustrative, never published as a promise.**

## 5 · THE FLYWHEEL
Long-form (source rock) → vertical cutdowns → the cutdown that over-performs greenlights the next long-form → the Scan turns viewers into Body-IDs → Body-IDs become plan buyers → buyers become **RECEIPTS** (proof on real people) → receipts feed the next film (with consent).
Content → attention → authority → Body-ID database → personalised content → more attention. Every turn adds a *citation*, so the wheel gets heavier for a rival to copy.

## 6 · ORG & COST MODEL (who does what)
- **Maddy** — the on-camera voice, clinical judgement, the final YES. Non-delegable: the research YES, the script YES, the publish YES.
- **Producer/editor** — runs Line A (or Line B), assembles captions/covers, keeps the QC log.
- **Research/script agent** — gauntlet runner, citation hygiene, `citation-library.json` upkeep.
- **Growth/ops** — comment-keyword handling, DM ladder, quiz webhook, analytics.
- **Cost shape** — Line A is compute-only (VO cloning is the one recurring API cost); Line B is human hours. The engine exists so 80 % of the slate never touches Line B.

## 7 · IDENTITY CONSTANTS (never drift)
Own category **BODY LITERACY** · positioning *"the trainer who decodes the body and mind you live in — sourced, not sold"* · essence **DECODE · PROVE · TRAIN** · enemy **THE CONFIDENT LIE** (bro-science · guru-woo · quick-fix) · HE/HIM · secular · English · 85 % teach / 15 % ask.
**Positioning rules:** attack claims, never people · the body is the hero, never Maddy · nothing on screen that a peer could not co-sign.

## 8 · PENDING WIRING (what still needs a human or a key)
| Item | Blocker | Owner |
|---|---|---|
| Real cloned VO on hero assets | `ELEVENLABS_API_KEY` + `FBM_VOICE_ID` | Maddy |
| Comment-keyword → DM automation | IG/ManyChat (or manual first month) | growth |
| Quiz → plan routing + UTM capture | site + email/WhatsApp tool | ops |
| Analytics board (ER, save/share, revenue per 1,000 reach) | sheet/BI hookup | growth |
| Anatomy GLBs (Z-Anatomy) for Line A films | asset download + rig test | editor |
| GLP-1 flagship pillar (Critic 1 · 2.1) | research gauntlet + Maddy YES | research |
