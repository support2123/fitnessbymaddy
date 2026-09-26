# FBM ENGINE PLAYBOOK — hooks, retention, formats, the show bible
> Source: `docs/DECODER-OS.md` §4 (Reframe Hook Bank) · §5 (Scroll-Stop OS) · §6 (Format & Platform OS) · §8 (Proof Moat).
> Machine-readable twins: `content/hooks.json` · `content/shows.json` · `content/topics.json`.

---

## 1 · THE HOOK SYSTEM
A hook is not a headline — it's a **cognitive event**. It must trigger three reflexes inside 1.5 s:
1. **Self-scan** — "that's happening inside *me*" (Myers 2010: self-referential content is remembered).
2. **Curiosity gap** — Loewenstein: curiosity spikes when we *feel* a gap in our knowledge.
3. **Pattern-break** — violates the expected grammar of a fitness page (which always promises).

**Non-negotiables:** first 3 words carry the claim · number in the first line · second person, present tense · hook <1.5 s · the claim must have a citation waiting (payoff by second 5–8, never inside the hook) · motion or a face by frame 3 — never a still logo.

**The Three-Word Test:** write the first three words on their own line. No tension → dead hook.
**The Screenshot Test:** freeze the hook frame — could a rival trainer screenshot and mock it? Rewrite.

### The 15 archetypes (full patterns + funnel routing: `content/hooks.json`)
Spec Sheet · Identity Reframe · Corrected Lie · Scale Shock · Hidden Mechanism · Two-Number Contrast · Proof-On-Body · Credential Counter-Intuitive · Named-Audience Callout · Myth Autopsy / Stop-Doing · Zoom-In · The Receipt · Question That Indicts · Live Deadline · Engineering Flex.
**Myth Autopsy has the highest save-rate** — one red strike-through per asset, no more.

### The Reframe Hook Bank (15 pre-written, ship-ready)
Including the ones already on film: *"You don't have abs. You have a pressure canister."* (EP-05's sibling in CORE), *"Soreness isn't damage healing. It's an alarm that's miscalibrated."*, *"You don't burn fat in the gym. You sign the invoice there and pay it in your sleep."* (bound the EPOC claim — keep it under ~7%).
**Rule:** a reframe may be poetic; the payoff must be literal, anatomical and cited.

### The 20 ready hooks
System-tagged (NEURAL / RESPIRATORY / METABOLIC / FLUID / STRUCTURAL + PCOS / 40+ / WOMEN / HIIT / ANCHOR) — in `content/hooks.json` under `ready_hooks_20`, each with its citation or honesty note.

### Do-not list
No uncited numbers · no woo words · no fear-bait · no bait-and-switch · no strawman myths · **no correlation sold as causation** · no borrowed signature lines un-attributed.

---

## 2 · RETENTION — the five-beat spine (inside any runtime)
| Beat | Window (30 s) | Device |
|---|---|---|
| **The Stop** | 0–1.5 s | hook formula + the number on screen |
| **The Stakes** | 1.5–5 s | "and here's why that changes how you should train" |
| **The Reveal** | 5–18 s | mechanism / number / demo + on-screen citation |
| **The Turn** | 18–25 s | "the real question isn't X, it's Y" |
| **Loop-Close + soft CTA** | 25–30 s | close the loop · seed the next reel or the Body-Scan |

**Long-form adaptation (MADE OF FIVE, 10–16 min):** the same spine at 30× — one reframe every 90–120 s, the number lands by minute 2, a myth dies every third minute, and the train-it turn is a real protocol on screen. Cold open = the film's best moment (frame 0), then contents card 0–4 s.

**Loop mechanics:** nested loops · delayed number · rehook at ~50% · end-is-the-beginning (last line answers the first → rewatch).

**The 3-second rule on the profile grid:** before reading a word, the grid should look like a wall of ticking numbers (see Clock HUD below).

---

## 3 · ONE CLOCK — the brand's visual signature
Every system keeps time; **everything that matters is a rate.** The page makes the viewer fluent in their own rates; the Body-Scan is where they get their numbers.

- **Clock HUD spec:** Space Mono, gold `#D4A148` on graphite `#101115`, fixed top-right of every asset. Examples: `12 / min` · `≈ 20 nm` · `100,000 / day` · `1.6 g/kg` · `66 days` · `~60 %` · `≈ 42 L` · `~10 yr`.
- **Grid effect:** scrolling the profile = a wall of numbers → instant recognition before a word is read.
- **Funnel reframe:** the free Body-Scan = "sync your clock — get your baseline rates".
- **In the film engine:** the HUD widget (`hud_gauge` / ring / trace in `filmlib.py`) is driven by the *same* clock function that drives the bed (`bed_<ep>.py`) — the same number ticking in picture and in score. EP-05's stand-clock (0.86 → 0.72 → 0.62 s) is the reference implementation.

---

## 4 · THE SHOW BIBLE (8 shows · naming · caption system)
Full grammar, beat emphasis, KPI and funnel per show: `content/shows.json`.

**Naming lockup:** `SHOW · No.0X · Subject` → *THE GAP · No.01 · The Synapse*. Episode numbers are permanent per show — new followers binge backward.
**File naming:** `FBM_[SHOW]_[No]_[subject]_[format]_v[n].mp4`
**Hashtag spine:** `#TheGap #MadeOfFive #FitnessByMaddy #TrainWithMaddy` + 3–5 topical.
**Caption = fixed 4 blocks:** (1) the reframe restated in one line → (2) the number + full citation → (3) the myth killed → (4) the train-it instruction + CTA. First line carries the hook (that's what's previewed), last line carries the ask.
**Sign-off (every asset, unchanged):** *"Read your clock. Then train it."*

---

## 5 · FORMAT & PLATFORM OS (what ships where)
Nine formats with spec, job, KPI and share-trigger live in `content/shows.json → formats_9`. Platform law:
- **Instagram Reels** — the discovery engine. 3 s retention > 65 %, avg view > 55 %, sends/reach > 1.5 %. Hook <1.5 s, Cite chip ≥2 s, burn-in captions (Anton), one CTA.
- **Instagram carousels** — the save engine (7–10 slides, 1080×1350, saves/reach > 4 %).
- **Stories** — the daily relationship: 3–7 frames, 2-drop arc, link sticker to the Scan.
- **YouTube long-form** — the authority vault: AVD > 45 %, CTR > 5 %; every long-form becomes 6–10 vertical cutdowns.
- **YouTube Shorts** — reuse the reels (no watermark), fresh title/thumb from the same number wall.
- **WhatsApp channel / broadcast** — 3-touch ladder only, never spam; reply-to-continue.
- **Facebook** — syndicate Reels + carousels; keep the same Cite chips (the screenshot test applies there too).
- **Posting cadence:** Mon SCAN (science reel) · Wed STOP (myth-bust) · Fri RECEIPTS (transformation) · Sun FORM LAB (Live 20–40 min) · daily SCAN OF THE DAY stories. One tentpole MADE OF FIVE long-form per month.
- **Spec locks:** graphite `#0A0B0E` · gold `#D4A148` · ivory `#F5F1E8`; captions Anton, Cite chips Space Mono, titles Cormorant Italic; 9:16 1080×1920 · 30 fps (60 fps for SCAN) · HOOK <1.5 s · Cite chip held ≥2 s · NASM-CPT lower-third on talking-head only.

---

## 6 · THE PROOF MOAT (why a rival can copy the format but not the page)
1. **Cite-or-delete** — no number ships without Author · Year · Journal (on screen and in the caption).
2. **Authority Map** — the peer ring we cite *and* answer: Schoenfeld (hypertrophy/volume), Helms (nutrition/physique), Contreras (stretch/ROM), Phillips (protein/muscle), Kandel (neuroscience), West (respiratory), Buono & Kolkhorst (hydration/thermoregulation), Gray's Anatomy, ISSN/ACSM/NSCA/NASM position stands.
3. **Numbers Registry** — one locked value per claim, used identically forever (`content/citation-library.json`).
4. **One Reference Body** — 70 kg M / 60 kg F, never mixed inside an asset.
5. **Confidence tiers 1/2/3** — the claim is stated at its true strength.
6. **Myth Autopsy table + graveyard** — the 10 kills + rapid-fire corpse list (`docs/BRAND-GUARDRAILS.md` §7).
7. **Public errata** — when we're wrong we publish the correction and reissue the receipt. This is a feature, not damage control.
8. **The One-Swap Test + Forbidden Lexicon** — metaphor out, organ in; zero mystical vocabulary, ever.
9. **Search-encyclopedia layer** — MADE OF FIVE long-forms are titled and filmed as reference content, each metadata-tagged (`show, number, subject, pillar, citation DOIs`) so YouTube search brings the same authority traffic a rival can't fake.
10. **Definition asymmetry** — a rival can copy a reel; they can't copy a page that has cited 300 claims and published its own corrections.

---

## 7 · CAPTION & CTA SYSTEM
- **Caption blocks (fixed order, always):** reframe line → number + full citation → myth killed → train-it + CTA.
- **CTA law:** one CTA only (default = Body-Scan); the ask lives in the last 2–3 s + the caption's final line; the pinned comment repeats the Scan link with the keyword ("Comment **SCAN** and I'll send it to your DMs").
- **Comment-keyword ladder** (SCAN · BURN · CONDITION · FLUID · FRAME · FOCUS) and the 4-step DM ladder: `content/funnel.json`.
- **Close types for every occasion:** Body-Scan · Coached-Not-Preached · Specificity · Receipt · Threshold (tripwire) · Comment-Keyword · Professional-Respect.
- **85 / 15 rule:** teaching carries ≥85 % of runtime; the sell never outweighs the lesson.
- **Sell-out test:** would a respected physician find the CTA acceptable? If not, rewrite.

---

## 8 · REPURPOSING — one long-form, twelve assets
Monthly MADE OF FIVE (16:9, 10–16 min) = the source rock → 6–10 vertical cutdowns · 2–3 carousels · 1 SIT-DOWN · 5–7 story frames · N quote cards. **Reverse loop:** an over-performing reel greenlights the next long-form. Routing table by content-type: `content/shows.json → topic_to_format_routing`.

---

## 9 · BRAND-SAFETY — the pre-publish gate
Run the 10-point checklist in `docs/BRAND-GUARDRAILS.md` §10, then `python3 tools/engine/brand_gate.py <ep_dir>`.
**The four automatic blocks:** mystical vocabulary · elemental labels on surface · an on-screen number with no citation · a mortality/longevity claim with no bounding line.
